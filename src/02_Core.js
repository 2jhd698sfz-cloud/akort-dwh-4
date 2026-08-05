var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Result = (function () {
  function success(message, data) {
    return { ok: true, status: 'SUCCESS', message: message || 'Completed successfully', data: data === undefined ? null : data, timestamp: new Date().toISOString() };
  }
  function paused(message, data) {
    return { ok: true, status: 'PAUSED', message: message || 'Operation paused at a safe checkpoint', data: data === undefined ? null : data, timestamp: new Date().toISOString() };
  }
  function failure(code, message, details) {
    return { ok: false, status: 'FAILED', code: code || 'UNEXPECTED_ERROR', message: message || 'Operation failed', details: details === undefined ? null : details, timestamp: new Date().toISOString() };
  }
  return { success: success, paused: paused, failure: failure };
})();

AKORT.Core = (function () {
  var TABLES = {
    SYSTEM_SETTINGS: [
      'setting_key', 'setting_value', 'value_type', 'environment', 'is_secret',
      'is_active', 'description', 'updated_at', 'updated_by'
    ],
    RELEASE_REGISTRY: [
      'release_id', 'version', 'release_channel', 'schema_version', 'installed_at',
      'installed_by', 'git_commit', 'manifest_hash', 'baseline_report_id', 'status', 'notes'
    ],
    OPERATION_QUEUE: [
      'operation_id', 'operation_type', 'status', 'priority', 'current_phase',
      'requested_at', 'started_at', 'finished_at', 'attempt_no', 'max_attempts',
      'checkpoint_json', 'error_code', 'error_message', 'created_by', 'release_version'
    ],
    OPERATION_STEPS: [
      'step_id', 'operation_id', 'phase', 'status', 'attempt_no', 'started_at',
      'finished_at', 'checkpoint_json', 'result_json', 'error_code', 'error_message',
      'release_version'
    ],
    AGGREGATE_STAGE: [
      'operation_id', 'load_id', 'plan_id', 'plan_fingerprint', 'calculation_id',
      'aggregate_series_key', 'aggregate_row_key', 'period_start', 'action',
      'row_payload_json', 'row_fingerprint', 'expected_target_fingerprint',
      'stage_status', 'created_at', 'verified_at', 'release_version'
    ],
    BACKUP_REGISTRY: [
      'backup_id', 'operation_id', 'request_type', 'status', 'scheduled_date',
      'backup_folder_id', 'dwh_source_id', 'dwh_backup_id', 'dwh_backup_name',
      'dwh_backup_url', 'publish_source_id', 'publish_backup_id',
      'publish_backup_name', 'publish_backup_url', 'manifest_file_id',
      'manifest_url', 'manifest_hash', 'operation_boundary_json',
      'started_at', 'finished_at', 'error_code', 'error_message',
      'release_version', 'created_by'
    ],
    TRIGGER_OWNERSHIP_REGISTRY: [
      'process_id', 'owner_module', 'handler', 'lifecycle',
      'expected_minimum', 'expected_maximum', 'observed_count', 'status',
      'next_action', 'trigger_ids_json', 'event_types_json',
      'trigger_sources_json', 'observed_at', 'registry_fingerprint',
      'release_version'
    ],
    DATASET_STATUS: [
      'dataset_id', 'dataset_label', 'source_table', 'source_status',
      'health_status', 'freshness_status', 'latest_activity_at',
      'age_minutes', 'freshness_threshold_minutes', 'latest_record_key',
      'latest_period', 'latest_load_id', 'active_operation_id',
      'active_phase', 'progress_percent', 'checkpoint_cursor',
      'latest_backup_id', 'trigger_status', 'issue_count', 'next_action',
      'observed_at', 'snapshot_fingerprint', 'release_version'
    ],
    ISSUE_REGISTRY: [
      'issue_key', 'source_table', 'source_record_key', 'dataset_id',
      'operation_id', 'severity', 'issue_code', 'lifecycle_status',
      'source_status', 'first_seen_at', 'last_seen_at', 'occurrence_count',
      'summary', 'details_json', 'resolution', 'next_action',
      'observed_at', 'snapshot_fingerprint', 'release_version'
    ],
    FULL_AUDIT_EVIDENCE: [
      'audit_id', 'operation_id', 'audit_status', 'audit_scope',
      'started_at', 'finished_at', 'checks_total', 'checks_passed',
      'checks_warned', 'checks_failed', 'retention_rows',
      'protected_artifacts', 'review_candidates', 'release_version',
      'base_commit', 'gate7_evidence_id', 'gate7_evidence_hash',
      'dataset_snapshot_fingerprint', 'source_snapshot_fingerprint',
      'retention_snapshot_fingerprint', 'evidence_hash', 'checks_json',
      'next_action', 'created_by'
    ],
    RETENTION_REGISTRY: [
      'retention_id', 'audit_id', 'operation_id', 'artifact_class',
      'artifact_id', 'artifact_name', 'artifact_source',
      'artifact_timestamp', 'age_days', 'retention_days',
      'protected_flag', 'protection_reason', 'candidate_action',
      'dry_run', 'physical_deletion', 'plan_status', 'next_action',
      'planned_at', 'snapshot_fingerprint', 'release_version'
    ],
    SYSTEM_LOG: [
      'log_id', 'logged_at', 'level', 'component', 'operation_id', 'step_id',
      'execution_id', 'event_code', 'message', 'details_json', 'release_version'
    ]
  };

  function AkortError(code, message, details) {
    this.name = 'AkortError';
    this.code = code || 'AKORT_ERROR';
    this.message = message || 'AKORT error';
    this.details = details === undefined ? null : details;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AkortError);
  }
  AkortError.prototype = Object.create(Error.prototype);
  AkortError.prototype.constructor = AkortError;

  function error(code, message, details) {
    return new AkortError(code, message, details);
  }

  function now() { return new Date().toISOString(); }

  function safeJson(value) {
    try { return JSON.stringify(value === undefined ? null : value); }
    catch (serializationError) { return JSON.stringify({ serializationError: String(serializationError) }); }
  }

  function canonicalize(value) {
    if (value === null || value === undefined) return value;
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === 'object') {
      var result = {};
      Object.keys(value).sort().forEach(function (key) { result[key] = canonicalize(value[key]); });
      return result;
    }
    return value;
  }

  function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }

  function sha256(text) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
    return bytes.map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function compactUuid_() { return Utilities.getUuid().replace(/-/g, '').slice(-12).toUpperCase(); }
  function timestampId_() {
    return Utilities.formatDate(new Date(), 'GMT', "yyyyMMdd'T'HHmmssSSS'Z'");
  }
  function normalizePrefix_(value, fallback) {
    var cleaned = String(value || fallback || 'GEN').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned.slice(0, 18) || fallback || 'GEN';
  }

  var Id = {
    execution: function () { return 'EXE_' + timestampId_() + '_' + compactUuid_(); },
    operation: function (type) { return 'OP_' + normalizePrefix_(type, 'GEN') + '_' + timestampId_() + '_' + compactUuid_(); },
    step: function (phase) { return 'ST_' + normalizePrefix_(phase, 'STEP') + '_' + timestampId_() + '_' + compactUuid_(); },
    log: function () { return 'LOG_' + timestampId_() + '_' + compactUuid_(); },
    release: function () { return 'REL_' + normalizePrefix_(AKORT.Release.version, 'RELEASE') + '_' + compactUuid_(); }
  };

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (e) { return 'unknown'; }
  }

  function headersEqual_(actual, expected) {
    return JSON.stringify(actual.map(String)) === JSON.stringify(expected.map(String));
  }

  function ensureSheet_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    var created = false;
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      created = true;
    }
    var lastColumn = sheet.getLastColumn();
    var existing = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
    var isBlank = existing.length === 0 || existing.every(function (value) { return value === ''; });
    if (sheet.getLastRow() === 0 || isBlank) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (!headersEqual_(existing, headers)) {
      throw error('SERVICE_SCHEMA_MISMATCH', 'Unexpected schema for service table ' + name, { expected: headers, actual: existing });
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    if (!sheet.getFilter() && sheet.getMaxRows() > 1) {
      try { sheet.getRange(1, 1, Math.max(2, sheet.getLastRow()), headers.length).createFilter(); } catch (e) {}
    }
    return { sheet: sheet, created: created };
  }

  function ensureServiceTables_(spreadsheet) {
    var result = [];
    Object.keys(TABLES).forEach(function (name) {
      var ensured = ensureSheet_(spreadsheet, name, TABLES[name]);
      result.push({ name: name, created: ensured.created, columns: TABLES[name].length });
    });
    return result;
  }

  function appendObject_(sheet, headers, object) {
    var row = headers.map(function (header) {
      var value = object[header];
      return value === undefined || value === null ? '' : value;
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
    return sheet.getLastRow();
  }

  function readObjects_(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = values[0].map(String);
    return values.slice(1).map(function (row, rowIndex) {
      var object = { __row: rowIndex + 2 };
      headers.forEach(function (header, i) { object[header] = row[i]; });
      return object;
    });
  }

  function withScriptLock_(label, fn, timeoutMs) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(Number(timeoutMs || 30000));
    } catch (lockError) {
      if (lockError && lockError.code) throw lockError;
      throw error('LOCK_ACQUISITION_FAILED', 'Could not acquire script lock: ' + String(label || 'unnamed'), { cause: String(lockError) });
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function persistSystemLogs_(entries) {
    if (!entries || !entries.length) return 0;
    var spreadsheet = getDwh_();
    var sheet = spreadsheet.getSheetByName('SYSTEM_LOG');
    if (!sheet) return 0;
    var rows = entries.map(function (entry) {
      return [
        entry.logId, entry.loggedAt, entry.level, entry.component, entry.operationId || '',
        entry.stepId || '', entry.executionId, entry.eventCode || '', entry.message,
        safeJson(entry.details), AKORT.Release.version
      ];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, TABLES.SYSTEM_LOG.length).setValues(rows);
    return rows.length;
  }

  var Logger = (function () {
    function create(context, options) {
      options = options || {};
      var executionId = options.executionId || Id.execution();
      var entries = [];
      var flushedCount = 0;

      function add_(level, message, details, metadata) {
        metadata = metadata || {};
        var entry = {
          logId: Id.log(),
          loggedAt: now(),
          level: level,
          component: context || '',
          operationId: metadata.operationId || options.operationId || '',
          stepId: metadata.stepId || options.stepId || '',
          executionId: executionId,
          eventCode: metadata.eventCode || '',
          message: String(message || ''),
          details: details === undefined ? null : details
        };
        entries.push(entry);
        var line = '[' + level + '] [' + executionId + '] [' + (context || '') + '] ' + entry.message;
        if (!options.silent) {
          if (level === 'ERROR') console.error(line, entry.details);
          else if (level === 'WARN') console.warn(line, entry.details);
          else console.log(line, entry.details);
        }
        return entry;
      }

      return {
        executionId: executionId,
        info: function (message, details, metadata) { return add_('INFO', message, details, metadata); },
        warn: function (message, details, metadata) { return add_('WARN', message, details, metadata); },
        error: function (message, details, metadata) { return add_('ERROR', message, details, metadata); },
        entries: function () { return entries.slice(); },
        rows: function () {
          return entries.map(function (entry) {
            return [entry.loggedAt, entry.level, entry.executionId, entry.component, entry.message, safeJson(entry.details)];
          });
        },
        flush: function () {
          var pending = entries.slice(flushedCount);
          var written = persistSystemLogs_(pending);
          flushedCount += written;
          return written;
        }
      };
    }
    return { create: create };
  })();

  function normalizeError_(caught) {
    return {
      code: caught && caught.code ? caught.code : 'UNEXPECTED_ERROR',
      message: caught && caught.message ? caught.message : String(caught),
      details: caught && caught.details !== undefined ? caught.details : null,
      name: caught && caught.name ? caught.name : 'Error',
      stack: caught && caught.stack ? String(caught.stack) : ''
    };
  }

  function safeRun(component, fn, options) {
    options = options || {};
    var logger = Logger.create(component, options);
    var runner = function () {
      try {
        logger.info('Execution started', null, { eventCode: 'EXECUTION_STARTED' });
        var value = fn({ logger: logger, executionId: logger.executionId });
        var result = value && typeof value.ok === 'boolean' ? value : AKORT.Result.success('Execution completed.', value);
        logger.info('Execution finished', { status: result.status }, { eventCode: 'EXECUTION_FINISHED' });
        if (options.persistLogs !== false) {
          try { logger.flush(); } catch (flushError) { console.error('SYSTEM_LOG flush failed', flushError); }
        }
        return result;
      } catch (caught) {
        var normalized = normalizeError_(caught);
        logger.error(normalized.message, normalized, { eventCode: normalized.code });
        if (options.persistLogs !== false) {
          try { logger.flush(); } catch (flushError) { console.error('SYSTEM_LOG flush failed', flushError); }
        }
        return AKORT.Result.failure(normalized.code, normalized.message, normalized);
      }
    };
    if (options.lock === false) return runner();
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return withScriptLock_(component, runner, options.lockTimeoutMs || config.system.lockTimeoutMs);
  }

  function settingDefaults_(config) {
    return [
      { setting_key: 'SYSTEM_ENVIRONMENT', setting_value: 'DEV', value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Active system environment' },
      { setting_key: 'CORE_SCHEMA_VERSION', setting_value: AKORT.Release.schemaVersion, value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Core service-table schema version' },
      { setting_key: 'LOG_LEVEL', setting_value: config.system.logLevel || 'INFO', value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Minimum system log level' },
      { setting_key: 'LOCK_TIMEOUT_MS', setting_value: Number(config.system.lockTimeoutMs || 30000), value_type: 'NUMBER', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Script lock wait timeout' },
      { setting_key: 'MAX_OPERATION_ATTEMPTS', setting_value: Number(config.system.maxOperationAttempts || 3), value_type: 'NUMBER', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Default retry limit for future operations' },
      { setting_key: 'TIMEZONE', setting_value: config.system.timezone || 'Europe/Moscow', value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'System timezone' },
      { setting_key: 'BASELINE_LABEL', setting_value: config.baselineLabel, value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Verified baseline label' },
      { setting_key: 'BASELINE_REPORT_ID', setting_value: config.baselineReportId || '', value_type: 'STRING', environment: 'DEV', is_secret: 1, is_active: 1, description: 'Successful alpha.1 baseline report ID' },
      { setting_key: 'PRODUCTION_COMPATIBILITY', setting_value: AKORT.Release.productionCompatibility, value_type: 'STRING', environment: 'DEV', is_secret: 0, is_active: 1, description: 'Production rollback compatibility version' }
    ];
  }

  function seedSettings_(spreadsheet, config) {
    var sheet = spreadsheet.getSheetByName('SYSTEM_SETTINGS');
    var existing = readObjects_(sheet);
    var keys = {};
    existing.forEach(function (row) { keys[String(row.setting_key)] = true; });
    var inserted = [];
    settingDefaults_(config).forEach(function (item) {
      if (keys[item.setting_key]) return;
      item.updated_at = now();
      item.updated_by = currentUser_();
      appendObject_(sheet, TABLES.SYSTEM_SETTINGS, item);
      inserted.push(item.setting_key);
    });
    return inserted;
  }

  function manifestHash_() { return sha256(canonicalJson(AKORT.Release.manifest())); }

  function registerRelease_(spreadsheet, config) {
    var sheet = spreadsheet.getSheetByName('RELEASE_REGISTRY');
    var rows = readObjects_(sheet);
    var hash = manifestHash_();
    var sameVersion = rows.filter(function (row) { return String(row.version) === AKORT.Release.version; });
    if (sameVersion.length) {
      var sameHash = sameVersion.filter(function (row) { return String(row.manifest_hash) === hash; });
      if (!sameHash.length) {
        throw error('RELEASE_MANIFEST_CONFLICT', 'Release version already exists with another manifest hash.', { version: AKORT.Release.version, expectedHash: hash });
      }
      return { action: 'ALREADY_REGISTERED', releaseId: sameHash[0].release_id, manifestHash: hash };
    }
    var record = {
      release_id: Id.release(),
      version: AKORT.Release.version,
      release_channel: AKORT.Release.channel,
      schema_version: AKORT.Release.schemaVersion,
      installed_at: now(),
      installed_by: currentUser_(),
      git_commit: PropertiesService.getScriptProperties().getProperty('AKORT_GIT_COMMIT') || '',
      manifest_hash: hash,
      baseline_report_id: config.baselineReportId || '',
      status: 'INSTALLED',
      notes: AKORT.Release.purpose
    };
    appendObject_(sheet, TABLES.RELEASE_REGISTRY, record);
    return { action: 'REGISTERED', releaseId: record.release_id, manifestHash: hash };
  }

  function install() {
    return safeRun('CORE_INSTALL', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load({ includeSystemSettings: false });
      var spreadsheet = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var tables = ensureServiceTables_(spreadsheet);
      var settingsInserted = seedSettings_(spreadsheet, config);
      var release = registerRelease_(spreadsheet, config);
      context.logger.info('Core Foundation installed', { tables: tables, settingsInserted: settingsInserted, release: release }, { eventCode: 'CORE_INSTALLED' });
      return AKORT.Result.success('Core Foundation installed successfully.', {
        release: AKORT.Release.manifest(),
        manifestHash: release.manifestHash,
        registration: release.action,
        serviceTables: tables,
        settingsInserted: settingsInserted
      });
    }, { lock: true, persistLogs: true });
  }

  function physicalRowCount_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return -1;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  function runTest_(id, fn) {
    try { return { id: id, status: 'PASS', data: fn(), error: null }; }
    catch (caught) { return { id: id, status: 'FAIL', data: null, error: normalizeError_(caught) }; }
  }

  function smokeTest() {
    return safeRun('CORE_SMOKE_TEST', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var publish = SpreadsheetApp.openById(config.resources.publishSpreadsheetId);
      var tests = [];

      tests.push(runTest_('namespace_akort', function () {
        if (!AKORT || !AKORT.Release || !AKORT.Config || !AKORT.Core) throw error('NAMESPACE_MISSING', 'AKORT namespace is incomplete.');
        return Object.keys(AKORT).sort();
      }));

      tests.push(runTest_('configuration', function () {
        if (config.environment !== 'DEV') throw error('CONFIG_ENVIRONMENT', 'Expected DEV configuration.');
        if (!config.system || config.system.schemaVersion !== AKORT.Release.schemaVersion) throw error('CONFIG_SCHEMA_VERSION', 'SYSTEM_SETTINGS schema version was not loaded.');
        return AKORT.Config.describe();
      }));

      tests.push(runTest_('service_table_schemas', function () {
        Object.keys(TABLES).forEach(function (name) {
          var sheet = dwh.getSheetByName(name);
          if (!sheet) throw error('SERVICE_TABLE_MISSING', 'Missing service table ' + name);
          var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          if (!headersEqual_(actual, TABLES[name])) throw error('SERVICE_SCHEMA_MISMATCH', 'Schema mismatch in ' + name, { expected: TABLES[name], actual: actual });
        });
        return Object.keys(TABLES);
      }));

      tests.push(runTest_('identifier_uniqueness', function () {
        var values = [Id.execution(), Id.execution(), Id.operation('CORE_TEST'), Id.operation('CORE_TEST'), Id.step('VALIDATE'), Id.step('VALIDATE'), Id.log(), Id.log()];
        var unique = {};
        values.forEach(function (value) { if (unique[value]) throw error('DUPLICATE_IDENTIFIER', 'Generated duplicate identifier: ' + value); unique[value] = true; });
        return values;
      }));

      tests.push(runTest_('script_lock', function () {
        return withScriptLock_('CORE_SMOKE_LOCK', function () { return 'LOCK_ACQUIRED'; }, config.system.lockTimeoutMs);
      }));

      tests.push(runTest_('exception_handling', function () {
        var result = safeRun('CORE_EXPECTED_EXCEPTION', function () {
          throw error('EXPECTED_TEST_EXCEPTION', 'Expected exception for smoke test.', { expected: true });
        }, { lock: false, persistLogs: false, silent: true });
        if (result.ok || result.code !== 'EXPECTED_TEST_EXCEPTION') throw error('EXCEPTION_CONTRACT_FAILED', 'Exception was not normalized correctly.', result);
        return result;
      }));

      tests.push(runTest_('release_manifest', function () {
        var expectedHash = manifestHash_();
        var rows = readObjects_(dwh.getSheetByName('RELEASE_REGISTRY'));
        var match = rows.filter(function (row) { return String(row.version) === AKORT.Release.version && String(row.manifest_hash) === expectedHash && String(row.status) === 'INSTALLED'; });
        if (!match.length) throw error('RELEASE_NOT_REGISTERED', 'Installed release is absent from RELEASE_REGISTRY.');
        return { manifestHash: expectedHash, releaseId: match[0].release_id };
      }));

      tests.push(runTest_('baseline_physical_counts_unchanged', function () {
        var expected = config.baselinePhysicalExpected;
        var actual = {
          rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
          rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
          rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
          publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
          publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
          publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
          publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
        };
        Object.keys(expected).forEach(function (key) {
          if (Number(actual[key]) !== Number(expected[key])) throw error('BASELINE_PHYSICAL_COUNT_CHANGED', 'Physical row count changed for ' + key, { expected: expected[key], actual: actual[key] });
        });
        return actual;
      }));

      tests.push(runTest_('system_logging', function () {
        var before = physicalRowCount_(dwh, 'SYSTEM_LOG');
        context.logger.info('System logging smoke event', { before: before }, { eventCode: 'CORE_SMOKE_LOG' });
        var written = context.logger.flush();
        var after = physicalRowCount_(dwh, 'SYSTEM_LOG');
        if (written < 1 || after <= before) throw error('SYSTEM_LOG_WRITE_FAILED', 'SYSTEM_LOG did not receive the smoke event.', { before: before, after: after, written: written });
        return { before: before, after: after, written: written };
      }));

      var ok = tests.every(function (test) { return test.status === 'PASS'; });
      return ok
        ? AKORT.Result.success('Alpha.2 Core Foundation smoke test passed.', { tests: tests, config: AKORT.Config.describe() })
        : AKORT.Result.failure('CORE_SMOKE_TEST_FAILED', 'One or more Core Foundation checks failed.', { tests: tests, config: AKORT.Config.describe() });
    }, { lock: false, persistLogs: true });
  }

  function status() {
    return safeRun('CORE_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var tables = {};
      Object.keys(TABLES).forEach(function (name) {
        var sheet = dwh.getSheetByName(name);
        tables[name] = sheet ? { rows: Math.max(0, sheet.getLastRow() - 1), columns: sheet.getLastColumn() } : null;
      });
      return AKORT.Result.success('Core Foundation status loaded.', {
        release: AKORT.Release.manifest(),
        manifestHash: manifestHash_(),
        config: AKORT.Config.describe(),
        serviceTables: tables
      });
    }, { lock: false, persistLogs: false });
  }

  return {
    Error: AkortError,
    error: error,
    now: now,
    safeJson: safeJson,
    canonicalJson: canonicalJson,
    sha256: sha256,
    Id: Id,
    Tables: TABLES,
    Sheets: { ensure: ensureSheet_, ensureServiceTables: ensureServiceTables_, appendObject: appendObject_, readObjects: readObjects_ },
    Locks: { withScriptLock: withScriptLock_ },
    Logger: Logger,
    safeRun: safeRun,
    install: install,
    smokeTest: smokeTest,
    status: status,
    manifestHash: manifestHash_
  };
})();

AKORT.Logger = AKORT.Core.Logger;

AKORT.EnvironmentGuard = (function () {
  function check_(name, fn) {
    try { return { check: name, status: 'PASS', actual: fn(), message: '' }; }
    catch (caught) { return { check: name, status: 'FAIL', actual: '', message: String(caught.message || caught) }; }
  }

  function verify() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var r = config.resources;
    var checks = [];
    checks.push(check_('environment_is_dev', function () {
      if (config.environment !== 'DEV') throw new Error('Expected DEV, got ' + config.environment);
      return config.environment;
    }));
    checks.push(check_('script_id_matches', function () {
      var actual = ScriptApp.getScriptId();
      if (actual !== config.expectedScriptId) throw new Error('Unexpected Script ID');
      return actual;
    }));
    checks.push(check_('resources_not_blocked', function () {
      var blocked = config.blockedResourceIds || [];
      var activeIds = Object.keys(r).map(function (key) { return r[key]; });
      var conflict = activeIds.filter(function (id) { return blocked.indexOf(id) >= 0; });
      if (conflict.length) throw new Error('DEV configuration points to blocked production resources');
      return 'no conflicts';
    }));
    checks.push(check_('dwh_name_matches', function () {
      var name = SpreadsheetApp.openById(r.dwhSpreadsheetId).getName();
      if (name !== config.expectedNames.dwh) throw new Error('Unexpected DWH name: ' + name);
      return name;
    }));
    checks.push(check_('publish_name_matches', function () {
      var name = SpreadsheetApp.openById(r.publishSpreadsheetId).getName();
      if (name !== config.expectedNames.publish) throw new Error('Unexpected Publish name: ' + name);
      return name;
    }));
    checks.push(check_('dev_root_name_matches', function () {
      var name = DriveApp.getFolderById(r.devRootFolderId).getName();
      if (name !== config.expectedNames.devRoot) throw new Error('Unexpected DEV root name: ' + name);
      return name;
    }));
    ['devTablesFolderId', 'testFilesFolderId', 'testResultsFolderId', 'releasesFolderId', 'docsFolderId'].forEach(function (key) {
      checks.push(check_('folder_access_' + key, function () { return DriveApp.getFolderById(r[key]).getName(); }));
    });
    return { ok: checks.every(function (item) { return item.status === 'PASS'; }), checks: checks, checkedAt: new Date().toISOString() };
  }

  function assertDev() {
    var result = verify();
    if (!result.ok) {
      var failures = result.checks.filter(function (item) { return item.status === 'FAIL'; }).map(function (item) { return item.check + ': ' + item.message; });
      throw AKORT.Core.error('DEV_ENVIRONMENT_GUARD_FAILED', 'DEV environment guard failed. ' + failures.join(' | '), { failures: failures });
    }
    return result;
  }
  return { verify: verify, assertDev: assertDev };
})();
