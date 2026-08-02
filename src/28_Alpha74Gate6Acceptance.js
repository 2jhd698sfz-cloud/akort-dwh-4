var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 6 authoritative DEV canary.
 *
 * The harness uses one previously unloaded weekly or monthly source file.
 * It creates recovery copies, fingerprints all four live Publish sheets,
 * executes SOURCE_FILE_LOAD_V4 through the regular pipeline, proves the
 * standard RAW_REVERSAL_V4 rollback, restores the same file through the
 * regular pipeline, and accepts only exact logical read-back at both
 * comparison boundaries. RAW_INDUSTRY is deliberately outside this canary:
 * it has no aggregate impact under the frozen Alpha.7.4 contract.
 */
AKORT.Alpha74Gate6Acceptance = (function () {
  var VERSION = '4.0-alpha74-gate6-acceptance-6';
  var EVIDENCE_SCHEMA = '4.0-alpha74-gate6-evidence-1';
  var STATE_SCHEMA = '4.0-alpha74-gate6-state-1';
  var RELEASE = '4.0.0-alpha.7.4.24';
  var BASELINE_HEADER_INCIDENT_RELEASE = '4.0.0-alpha.7.4.19';
  var RUNTIME_CONTEXT_INCIDENT_RELEASE = '4.0.0-alpha.7.4.20';
  var MONOLITHIC_STAGE_INCIDENT_RELEASE = '4.0.0-alpha.7.4.22';
  var STATE_PROPERTY = 'AKORT_ALPHA74_GATE6_STATE_V1';
  var CONTROL_SHEET = 'GATE6_CANARY_INPUT';
  var TRIGGER_HANDLER = 'AKORT_alpha74Gate6Worker';
  var TRIGGER_MINUTES = 1;
  var WORKER_LEASE_MS = 330000;
  var WORKER_BUDGET_MS = 240000;
  var DIGEST_CHUNK_ROWS = 1000;
  var MAX_WORKER_STEPS = 120;
  var MAX_CONSECUTIVE_ERRORS = 3;
  var TARGETS = Object.freeze([
    'PUBLISH_PRICES_WEEKLY',
    'PUBLISH_PRICES_MONTHLY',
    'PUBLISH_INDUSTRY',
    'PUBLISH_PRICE_AGGREGATES'
  ]);
  var AGGREGATE_PHASES = Object.freeze([
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES'
  ]);
  var TERMINAL_FAILURES = Object.freeze([
    'FAILED', 'FAILED_REQUIRES_REVIEW', 'DEAD_LETTER', 'CANCELLED'
  ]);

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      String(value || '').toUpperCase() === 'TRUE';
  }

  function clone_(value) {
    if (Array.isArray(value)) return value.map(clone_);
    if (value && typeof value === 'object') {
      if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = clone_(value[key]); });
      return out;
    }
    return value;
  }

  function stable_(value) {
    if (Array.isArray(value)) return value.map(stable_);
    if (value && typeof value === 'object') {
      if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
      var out = {};
      Object.keys(value).sort().forEach(function (key) { out[key] = stable_(value[key]); });
      return out;
    }
    if (typeof value === 'number' && !isFinite(value)) return null;
    return value;
  }

  function stableStringify_(value) {
    return JSON.stringify(stable_(value));
  }

  function hash_(value) {
    return AKORT.Core.sha256(typeof value === 'string' ? value : stableStringify_(value));
  }

  function error_(code, message, details) {
    return AKORT.Core.error(code, message, details || {});
  }

  function assert_(condition, code, message, details) {
    if (!condition) throw error_(code, message, details);
  }

  function now_() {
    return AKORT.Core.now ? AKORT.Core.now() : new Date().toISOString();
  }

  function timestamp_() {
    return Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd_HHmmss');
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (ignored) { return 'unknown'; }
  }

  function resources_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var resources = config && config.resources || {};
    ['dwhSpreadsheetId', 'publishSpreadsheetId', 'testResultsFolderId', 'releasesFolderId']
      .forEach(function (key) {
        assert_(text_(resources[key]), 'ALPHA74_GATE6_RESOURCE_MISSING', 'Gate 6 canonical resource is missing.', {
          resource: key,
          retryable: false
        });
      });
    assert_(text_(resources.dwhSpreadsheetId) !== text_(resources.publishSpreadsheetId),
      'ALPHA74_GATE6_RESOURCE_COLLISION', 'DWH and Publish must be distinct Gate 6 resources.', {
        retryable: false
      });
    return resources;
  }

  function parseFileId_(value) {
    var source = text_(value);
    if (!source) return '';
    var direct = source.match(/^[A-Za-z0-9_-]{20,}$/);
    if (direct) return direct[0];
    var path = source.match(/\/d\/([A-Za-z0-9_-]{20,})/);
    if (path) return path[1];
    var query = source.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
    return query ? query[1] : '';
  }

  function ensureControlSheet_() {
    var spreadsheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
    var sheet = spreadsheet.getSheetByName(CONTROL_SHEET);
    var created = false;
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CONTROL_SHEET);
      created = true;
    }
    var inputs = created ? [[''], [''], [''], [''], [''], ['']] : sheet.getRange('B4:B9').getValues();
    sheet.getRange('A1:C12').setValues([
      ['AKORT Alpha.7.4 Gate 6 — authoritative DEV canary', '', ''],
      ['Укажите один новый weekly/monthly файл. Gate 6 сам выполнит загрузку, откат и восстановление.', '', ''],
      ['Параметр', 'Значение', 'Подсказка'],
      ['Файл Google Drive', inputs[0][0], 'Вставьте ID или ссылку на исходный файл, который ещё не загружался'],
      ['profile_id', inputs[1][0], 'Необязательно; оставьте пустым для автоматического распознавания'],
      ['Год', inputs[2][0], 'Необязательно, если год однозначно определяется из файла'],
      ['Месяц', inputs[3][0], 'Необязательно; 1–12'],
      ['Неделя', inputs[4][0], 'Необязательно; 1–53'],
      ['Дата публикации', inputs[5][0], 'Необязательно; YYYY-MM-DD'],
      ['', '', ''],
      ['Статус проверки', created ? 'НЕ ПРОВЕРЕНО' : text_(sheet.getRange('B11').getValue()) || 'НЕ ПРОВЕРЕНО', 'Запустите AKORT_alpha74Gate6Validate'],
      ['Результат', created ? '' : sheet.getRange('B12').getValue(), 'После успешной проверки можно запускать Gate 6 Start']
    ]);
    sheet.setFrozenRows(3);
    sheet.setColumnWidth(1, 190);
    sheet.setColumnWidth(2, 360);
    sheet.setColumnWidth(3, 520);
    sheet.getRange('A1:C1').setBackground('#1f4e78').setFontColor('#ffffff').setFontWeight('bold');
    sheet.getRange('A3:C3').setBackground('#d9eaf7').setFontWeight('bold');
    sheet.getRange('B4:B9').setBackground('#fff2cc');
    sheet.getRange('B11:B12').setBackground('#e2f0d9').setWrap(true);
    sheet.getRange('A1:C12').setVerticalAlignment('middle');
    sheet.getRange('A2:C2').setWrap(true);
    sheet.setTabColor('#1f4e78');
    return { sheet: sheet, created: created };
  }

  function readCanaryOptions_() {
    var spreadsheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
    var sheet = spreadsheet.getSheetByName(CONTROL_SHEET);
    assert_(sheet, 'ALPHA74_GATE6_CONTROL_NOT_INSTALLED', 'Install the Gate 6 canary control sheet first.', {});
    var values = sheet.getRange('B4:B9').getValues().map(function (row) { return row[0]; });
    var fileId = parseFileId_(values[0]);
    assert_(fileId, 'ALPHA74_GATE6_FILE_ID_INVALID', 'Enter a valid Google Drive file ID or link in GATE6_CANARY_INPUT!B4.', {});
    function optionalInteger_(value, minimum, maximum, field) {
      if (text_(value) === '') return '';
      var parsed = Number(value);
      assert_(isFinite(parsed) && Math.floor(parsed) === parsed && parsed >= minimum && parsed <= maximum,
        'ALPHA74_GATE6_PERIOD_HINT_INVALID', 'Gate 6 period hint is invalid.', {
          field: field, value: value, minimum: minimum, maximum: maximum
        });
      return parsed;
    }
    return {
      fileId: fileId,
      profileId: text_(values[1]),
      year: optionalInteger_(values[2], 1900, 2200, 'year'),
      month: optionalInteger_(values[3], 1, 12, 'month'),
      week: optionalInteger_(values[4], 1, 53, 'week'),
      sourcePublishedAt: Object.prototype.toString.call(values[5]) === '[object Date]' && !isNaN(values[5].getTime())
        ? Utilities.formatDate(values[5], 'UTC', 'yyyy-MM-dd') : text_(values[5])
    };
  }

  function activeSourceLoad_(targetTable, sourceHash) {
    var spreadsheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
    var sheet = spreadsheet.getSheetByName('RAW_LOAD_REGISTRY');
    assert_(sheet, 'ALPHA74_GATE6_LOAD_REGISTRY_MISSING', 'RAW_LOAD_REGISTRY is missing.', {});
    var active = ['CREATED', 'STAGED', 'COMMITTING', 'COMMITTED'];
    return AKORT.Core.Sheets.readObjects(sheet).filter(function (row) {
      return text_(row.target_table) === text_(targetTable) && text_(row.source_hash) === text_(sourceHash) &&
        active.indexOf(text_(row.status)) >= 0;
    })[0] || null;
  }

  function validateCanarySpec_() {
    var options = readCanaryOptions_();
    var preview = AKORT.ExistingSourceParsers.previewFile(options.fileId, options);
    assert_(preview && preview.ok && preview.data,
      preview && preview.code || 'ALPHA74_GATE6_SOURCE_PREVIEW_FAILED',
      preview && preview.message || 'Gate 6 source preview failed.', preview && preview.details || {});
    var data = preview.data;
    var target = text_(data.profile && data.profile.targetTable);
    assert_(['RAW_PRICES_WEEKLY', 'RAW_PRICES_MONTHLY'].indexOf(target) >= 0,
      'ALPHA74_GATE6_SOURCE_TARGET_INVALID', 'Gate 6 canary must be a weekly or monthly price source file.', {
        targetTable: target,
        profileId: data.profile && data.profile.profileId || ''
      });
    assert_(Number(data.normalizedRowCount || 0) > 0,
      'ALPHA74_GATE6_SOURCE_EMPTY', 'Gate 6 source preview produced no normalized rows.', {});
    var blocking = (data.issues || []).filter(function (issue) { return text_(issue.severity) === 'ERROR'; });
    assert_(blocking.length === 0, 'ALPHA74_GATE6_SOURCE_BLOCKING_ISSUES', 'Gate 6 source has blocking parser or mapping issues.', {
      issueCount: blocking.length,
      issues: blocking.slice(0, 20)
    });
    var existing = activeSourceLoad_(target, data.sourceHash);
    assert_(!existing, 'ALPHA74_GATE6_SOURCE_ALREADY_LOADED', 'Choose a genuinely new weekly/monthly file: this exact content already has an active RAW load.', {
      loadId: existing && existing.load_id || '',
      status: existing && existing.status || '',
      targetTable: target,
      sourceHash: data.sourceHash
    });
    return {
      fileId: options.fileId,
      fileName: text_(data.fileName),
      profileId: text_(data.profile && data.profile.profileId),
      frequency: text_(data.profile && data.profile.frequency),
      targetTable: target,
      sourceHash: text_(data.sourceHash),
      normalizedRowCount: Number(data.normalizedRowCount || 0),
      sourceObservationCount: Number(data.sourceObservationCount || 0),
      year: data.resolvedOptions && data.resolvedOptions.year || '',
      month: data.resolvedOptions && data.resolvedOptions.month || '',
      week: data.resolvedOptions && data.resolvedOptions.week || '',
      sourcePublishedAt: options.sourcePublishedAt
    };
  }

  function writeValidation_(status, details) {
    var sheet = ensureControlSheet_().sheet;
    sheet.getRange('B11').setValue(status);
    sheet.getRange('B12').setValue(typeof details === 'string' ? details : JSON.stringify(details));
    SpreadsheetApp.flush();
  }

  function controlStatus_() {
    var sheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId).getSheetByName(CONTROL_SHEET);
    return {
      installed: !!sheet,
      sheet: CONTROL_SHEET,
      validationStatus: sheet ? text_(sheet.getRange('B11').getValue()) : 'NOT_INSTALLED',
      fileConfigured: sheet ? !!parseFileId_(sheet.getRange('B4').getValue()) : false
    };
  }

  function activeDataOperations_(allowedIds) {
    var allowed = {};
    (allowedIds || []).forEach(function (id) { if (text_(id)) allowed[text_(id)] = true; });
    var spreadsheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
    var sheet = spreadsheet.getSheetByName('OPERATION_QUEUE');
    assert_(sheet, 'ALPHA74_GATE6_OPERATION_QUEUE_MISSING', 'OPERATION_QUEUE is missing.', {});
    var types = ['SOURCE_FILE_LOAD_V4', 'RAW_LOAD_V4', 'RAW_REVERSAL_V4'];
    var statuses = ['QUEUED', 'RUNNING', 'PAUSED', 'RETRY_PENDING'];
    return AKORT.Core.Sheets.readObjects(sheet).filter(function (row) {
      return types.indexOf(text_(row.operation_type)) >= 0 && statuses.indexOf(text_(row.status)) >= 0 &&
        !allowed[text_(row.operation_id)];
    }).map(function (row) {
      return {
        operationId: text_(row.operation_id),
        operationType: text_(row.operation_type),
        status: text_(row.status),
        currentPhase: text_(row.current_phase)
      };
    });
  }

  function assertNoForeignDataOperations_(state) {
    var operations = state && state.operations || {};
    var active = activeDataOperations_([operations.canary, operations.reversal, operations.restore]);
    assert_(active.length === 0, 'ALPHA74_GATE6_FOREIGN_OPERATION_ACTIVE', 'Another data operation is active. Gate 6 must run alone.', {
      operations: active
    });
    return true;
  }

  function flagState_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      publishEngineEnabled: truthy_(settings.PUBLISH_ENGINE_ENABLED),
      executionEnabled: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
      regularPipelineEnabled: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED),
      userPipelineEnabled: truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)
    };
  }

  function settingSheet_() {
    var resources = resources_();
    var sheet = SpreadsheetApp.openById(resources.dwhSpreadsheetId).getSheetByName('SYSTEM_SETTINGS');
    assert_(sheet && sheet.getLastRow() >= 1, 'ALPHA74_GATE6_SETTINGS_MISSING', 'SYSTEM_SETTINGS is missing.', {});
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var required = ['setting_key', 'setting_value', 'value_type', 'environment', 'is_secret', 'is_active', 'description', 'updated_at', 'updated_by'];
    assert_(JSON.stringify(headers) === JSON.stringify(required),
      'ALPHA74_GATE6_SETTINGS_SCHEMA_MISMATCH', 'SYSTEM_SETTINGS schema changed.', {
        expected: required,
        actual: headers
      });
    return { sheet: sheet, headers: headers };
  }

  function setBooleanSetting_(key, value, description) {
    var table = settingSheet_();
    var values = table.sheet.getLastRow() > 1
      ? table.sheet.getRange(2, 1, table.sheet.getLastRow() - 1, table.headers.length).getValues()
      : [];
    var rowNumber = 0;
    values.forEach(function (row, index) {
      if (text_(row[0]) === key) rowNumber = index + 2;
    });
    var row = [key, value === true, 'BOOLEAN', 'DEV', 0, 1, description || '', now_(), currentUser_()];
    if (rowNumber) table.sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    return value === true;
  }

  function setJsonSetting_(key, value, description) {
    var table = settingSheet_();
    var values = table.sheet.getLastRow() > 1
      ? table.sheet.getRange(2, 1, table.sheet.getLastRow() - 1, table.headers.length).getValues()
      : [];
    var rowNumber = 0;
    values.forEach(function (row, index) {
      if (text_(row[0]) === key) rowNumber = index + 2;
    });
    var serialized = stableStringify_(value || {});
    var row = [key, serialized, 'JSON', 'DEV', 0, 1, description || '', now_(), currentUser_()];
    if (rowNumber) table.sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();
    return serialized;
  }

  function acceptedParityRuntimeContext_() {
    return {
      adapter_mode: 'ALPHA6_ACCEPTED_PARITY',
      adapter_contract_version: '4.0-alpha74-accepted-parity-1',
      accepted_by: 'ALPHA74_GATE5_FULL_HISTORY_PARITY',
      gate5_evidence_required: true,
      mutation_boundary: 'ALPHA74_ATOMIC_LOGICAL_SERIES'
    };
  }

  function normalizedJsonSetting_(value) {
    if (value === '' || value === null || value === undefined) return {};
    if (Object.prototype.toString.call(value) === '[object Object]') return clone_(value);
    if (typeof value !== 'string') {
      throw error_('ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID', 'Existing operational aggregate runtime-context setting is invalid JSON.', {
        valueType: typeof value
      });
    }
    try {
      if (!value.trim()) return {};
      var parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON root must be an object.');
      return parsed;
    } catch (caught) {
      throw error_('ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID', 'Existing operational aggregate runtime-context setting is invalid JSON.', {
        cause: String(caught && caught.message || caught)
      });
    }
  }

  function assertOperationalRuntimeContext_() {
    assert_(AKORT.AggregateIntegration && typeof AKORT.AggregateIntegration.assertOperationalRuntimeContext === 'function',
      'ALPHA74_GATE6_RUNTIME_CONTEXT_CHECK_UNAVAILABLE', 'Operational aggregate runtime-context check is unavailable.', {});
    return AKORT.AggregateIntegration.assertOperationalRuntimeContext();
  }

  function setRegularPipeline_(enabled) {
    return setBooleanSetting_(
      'PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED',
      enabled === true,
      'Gate 6 controlled regular aggregate pipeline flag'
    );
  }

  function setUserPipeline_(enabled) {
    return setBooleanSetting_(
      'PUBLISH_USER_PIPELINE_ENABLED',
      enabled === true,
      'Operator-initiated user loads; enabled only after Gate 7 acceptance'
    );
  }

  function loadState_() {
    var raw = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (caught) {
      throw error_('ALPHA74_GATE6_STATE_INVALID', 'Gate 6 checkpoint JSON is invalid.', {
        retryable: false,
        cause: String(caught && caught.message || caught)
      });
    }
  }

  function saveState_(state) {
    state.updatedAt = now_();
    var json = JSON.stringify(state);
    var bytes = Utilities.newBlob(json, 'application/json').getBytes().length;
    assert_(bytes <= 8500, 'ALPHA74_GATE6_STATE_TOO_LARGE', 'Gate 6 checkpoint exceeds the safe Script Properties size.', {
      bytes: bytes,
      maximum: 8500,
      retryable: false
    });
    PropertiesService.getScriptProperties().setProperty(STATE_PROPERTY, json);
    return state;
  }

  function triggers_() {
    return ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === TRIGGER_HANDLER;
    });
  }

  function deleteTriggers_() {
    var triggers = triggers_();
    triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    return triggers.length;
  }

  function ensureTrigger_() {
    var triggers = triggers_();
    if (!triggers.length) {
      ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyMinutes(TRIGGER_MINUTES).create();
      triggers = triggers_();
    }
    if (triggers.length > 1) {
      triggers.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      triggers = triggers_();
    }
    return triggers.length;
  }

  function gate5Accepted_() {
    assert_(AKORT.Alpha74Gate5Acceptance && typeof AKORT.Alpha74Gate5Acceptance.status === 'function',
      'ALPHA74_GATE6_GATE5_UNAVAILABLE', 'Gate 5 acceptance status is unavailable.', {});
    var result = AKORT.Alpha74Gate5Acceptance.status();
    var state = result && result.ok && result.data ? result.data.state : null;
    assert_(state && state.status === 'SUCCESS' && state.phase === 'SUCCESS',
      'ALPHA74_GATE6_GATE5_NOT_ACCEPTED', 'Gate 6 requires terminal SUCCESS Gate 5.', {
        gate5Status: state ? state.status : 'NOT_FOUND',
        gate5Phase: state ? state.phase : ''
      });
    assert_(state.evidence && text_(state.evidence.id) && text_(state.evidence.sha256),
      'ALPHA74_GATE6_GATE5_EVIDENCE_MISSING', 'Gate 5 SUCCESS has no verified evidence artifact.', {});
    return {
      executionId: state.executionId,
      release: state.release,
      evidence: clone_(state.evidence),
      acceptedDigest: text_(state.digests && state.digests.fullBuild && state.digests.fullBuild.hash || ''),
      rows: Number(state.digests && state.digests.fullBuild && state.digests.fullBuild.rows || 0)
    };
  }

  function copyArtifact_(sourceId, folderId, name, executionId, role) {
    var folder = DriveApp.getFolderById(folderId);
    var copy = DriveApp.getFileById(sourceId).makeCopy(name, folder);
    copy.setDescription([
      'AKORT Alpha.7.4 Gate 6 recovery copy',
      'execution_id=' + executionId,
      'role=' + role,
      'created_at=' + now_(),
      'Do not edit or delete before Gate 7 acceptance.'
    ].join('\n'));
    return {
      id: copy.getId(),
      name: copy.getName(),
      url: copy.getUrl(),
      role: role
    };
  }

  function createRecoveryArtifacts_(resources, executionId) {
    var stamp = timestamp_();
    return {
      dwhBackup: copyArtifact_(
        resources.dwhSpreadsheetId,
        resources.releasesFolderId,
        'AKORT_ALPHA74_GATE6_DWH_RECOVERY_' + stamp,
        executionId,
        'DWH_BEFORE_CANARY'
      ),
      publishBackup: copyArtifact_(
        resources.publishSpreadsheetId,
        resources.releasesFolderId,
        'AKORT_ALPHA74_GATE6_PUBLISH_RECOVERY_' + stamp,
        executionId,
        'PUBLISH_BEFORE_CANARY'
      )
    };
  }

  function emptyAccumulator_() {
    var out = [];
    for (var index = 0; index < 16; index += 1) out.push(0);
    return out;
  }

  function addHash_(accumulator, hex) {
    var carry = 0;
    var normalized = text_(hex).toLowerCase();
    assert_(/^[0-9a-f]{64}$/.test(normalized), 'ALPHA74_GATE6_DIGEST_HASH_INVALID', 'Gate 6 row digest is invalid.', {});
    for (var index = 0; index < 16; index += 1) {
      var end = 64 - index * 4;
      var total = Number(accumulator[index] || 0) + parseInt(normalized.slice(end - 4, end), 16) + carry;
      accumulator[index] = total % 65536;
      carry = Math.floor(total / 65536);
    }
    return accumulator;
  }

  function accumulatorHex_(accumulator) {
    return (accumulator || emptyAccumulator_()).slice().reverse().map(function (value) {
      return ('0000' + Number(value || 0).toString(16)).slice(-4);
    }).join('');
  }

  function canonicalCell_(value) {
    if (value === null || value === undefined || value === '') return 'N:';
    if (Object.prototype.toString.call(value) === '[object Date]') return 'D:' + value.toISOString();
    if (typeof value === 'number' && isFinite(value)) return 'F:' + String(value);
    if (typeof value === 'boolean') return 'B:' + (value ? '1' : '0');
    return 'S:' + JSON.stringify(String(value));
  }

  function addRowsToDigest_(work, values) {
    work.primary = work.primary || emptyAccumulator_();
    work.secondary = work.secondary || emptyAccumulator_();
    (values || []).forEach(function (row) {
      var rowHash = hash_(row.map(canonicalCell_).join('\u001f'));
      addHash_(work.primary, rowHash);
      addHash_(work.secondary, hash_('GATE6_ROW_SECONDARY|' + rowHash));
    });
    return work;
  }

  function digestValue_(work) {
    return hash_([
      'GATE6_ROW_MULTISET_V1',
      Number(work.rows || 0),
      Number(work.columns || 0),
      text_(work.headersHash),
      accumulatorHex_(work.primary),
      accumulatorHex_(work.secondary)
    ].join('|'));
  }

  function newScan_(bucket) {
    return { schemaVersion: '4.0-alpha74-gate6-scan-1', bucket: bucket, targetIndex: 0, work: null };
  }

  function expectedHeaders_(target) {
    if (target === 'PUBLISH_PRICE_AGGREGATES') return AKORT.AggregateContract.Headers.slice();
    var registry = AKORT.IncrementalPublish && AKORT.IncrementalPublish.PublishHeaders;
    var headers = registry && registry[target];
    assert_(Array.isArray(headers), 'ALPHA74_GATE6_PUBLISH_CONTRACT_MISSING',
      'Gate 6 cannot load the exported Publish header contract.', { target: target });
    return headers.slice();
  }

  function scanStep_(state, bucket, nextPhase) {
    var resources = resources_();
    assert_(text_(resources.publishSpreadsheetId) === text_(state.liveResources.publishSpreadsheetId),
      'ALPHA74_GATE6_PUBLISH_TARGET_CHANGED', 'Configured Publish target changed during Gate 6.', {});
    state.scan = state.scan || newScan_(bucket);
    assert_(state.scan.schemaVersion === '4.0-alpha74-gate6-scan-1' && state.scan.bucket === bucket,
      'ALPHA74_GATE6_SCAN_STATE_INVALID', 'Gate 6 scan checkpoint does not match the active phase.', {
        scan: state.scan,
        bucket: bucket
      });
    var target = TARGETS[Number(state.scan.targetIndex || 0)];
    if (!target) {
      state.scan = null;
      state.phase = nextPhase;
      return { phase: 'SCAN_COMPLETE', bucket: bucket, nextPhase: nextPhase };
    }
    var sheet = SpreadsheetApp.openById(resources.publishSpreadsheetId).getSheetByName(target);
    assert_(sheet, 'ALPHA74_GATE6_TARGET_MISSING', 'Gate 6 Publish target sheet is missing.', { target: target });
    var columns = sheet.getLastColumn();
    assert_(columns > 0, 'ALPHA74_GATE6_TARGET_EMPTY_SCHEMA', 'Gate 6 target has no columns.', { target: target });
    var headers = sheet.getRange(1, 1, 1, columns).getValues()[0].map(String);
    var expectedHeaders = expectedHeaders_(target);
    assert_(JSON.stringify(headers) === JSON.stringify(expectedHeaders),
      'ALPHA74_GATE6_PUBLISH_SCHEMA_MISMATCH', 'A Publish schema changed before or during Gate 6.', {
        target: target,
        expected: expectedHeaders,
        actual: headers
      });
    var rows = Math.max(0, sheet.getLastRow() - 1);
    var work = state.scan.work;
    if (!work) {
      work = state.scan.work = {
        target: target,
        cursor: 0,
        rows: rows,
        columns: columns,
        headersHash: hash_(headers),
        primary: emptyAccumulator_(),
        secondary: emptyAccumulator_(),
        chunks: 0
      };
    }
    assert_(work.target === target && Number(work.rows) === rows && Number(work.columns) === columns &&
      work.headersHash === hash_(headers),
      'ALPHA74_GATE6_TARGET_CHANGED_DURING_SCAN', 'A Publish target changed while Gate 6 was fingerprinting it.', {
        target: target,
        expected: work,
        actual: { rows: rows, columns: columns, headersHash: hash_(headers) }
      });
    var cursor = Number(work.cursor || 0);
    if (cursor < rows) {
      var count = Math.min(DIGEST_CHUNK_ROWS, rows - cursor);
      var values = sheet.getRange(cursor + 2, 1, count, columns).getValues();
      addRowsToDigest_(work, values);
      work.cursor = cursor + count;
      work.chunks = Number(work.chunks || 0) + 1;
      state.metrics.digestChunks = Number(state.metrics.digestChunks || 0) + 1;
      state.metrics.rowsScanned = Number(state.metrics.rowsScanned || 0) + count;
      return { phase: 'SCAN_CHUNK', bucket: bucket, target: target, cursor: work.cursor, total: rows };
    }
    state.digests[bucket] = state.digests[bucket] || {};
    state.digests[bucket][target] = {
      rows: rows,
      columns: columns,
      headersHash: work.headersHash,
      hash: digestValue_(work),
      chunks: work.chunks,
      mode: 'ROW_MULTISET_V1'
    };
    state.scan.targetIndex = Number(state.scan.targetIndex || 0) + 1;
    state.scan.work = null;
    return { phase: 'SCAN_TARGET_COMPLETE', bucket: bucket, target: target, digest: state.digests[bucket][target] };
  }

  function compareDigests_(left, right) {
    var mismatches = [];
    TARGETS.forEach(function (target) {
      var a = left && left[target];
      var b = right && right[target];
      if (!sameDigest_(a, b)) {
        mismatches.push({ target: target, left: clone_(a || null), right: clone_(b || null) });
      }
    });
    return { exact: mismatches.length === 0, mismatches: mismatches };
  }

  function sameDigest_(a, b) {
    return !!a && !!b && Number(a.rows) === Number(b.rows) && Number(a.columns) === Number(b.columns) &&
      text_(a.headersHash) === text_(b.headersHash) && text_(a.hash) === text_(b.hash);
  }

  function changedTargets_(left, right) {
    return TARGETS.filter(function (target) {
      return !sameDigest_(left && left[target], right && right[target]);
    });
  }

  function operation_(operationId) {
    var status = AKORT.OperationEngine.status(operationId);
    assert_(status && status.ok && status.data && status.data.operation,
      status && status.code || 'ALPHA74_GATE6_OPERATION_STATUS_FAILED',
      status && status.message || 'Gate 6 cannot load operation status.', {
        operationId: operationId,
        details: status && status.details || null
      });
    return status.data.operation;
  }

  function operationLoadId_(operation) {
    var checkpoint = operation && operation.checkpoint || {};
    var raw = checkpoint.rawStore || checkpoint.handlerState || {};
    return text_(raw.loadId || raw.reversal && raw.reversal.reversalLoadId || '');
  }

  function operationSummary_(operation, expectedType) {
    var checkpoint = operation && operation.checkpoint || {};
    var completed = checkpoint.completedPhases || [];
    var aggregate = checkpoint.aggregate || {};
    var raw = checkpoint.rawStore || checkpoint.handlerState || {};
    var missingPhases = AGGREGATE_PHASES.filter(function (phase) { return completed.indexOf(phase) < 0; });
    var summary = {
      operationId: text_(operation && operation.operation_id),
      operationType: text_(operation && operation.operation_type),
      status: text_(operation && operation.status),
      currentPhase: text_(operation && operation.current_phase),
      loadId: operationLoadId_(operation),
      aggregateStatus: text_(aggregate.status),
      aggregateTargetFingerprint: text_(aggregate.targetAfterFingerprint),
      completedAggregatePhases: AGGREGATE_PHASES.length - missingPhases.length,
      missingAggregatePhases: missingPhases,
      rawAuditOk: raw.audit ? raw.audit.ok === true :
        (expectedType === 'RAW_REVERSAL_V4' ||
          expectedType === 'SOURCE_FILE_LOAD_V4' && completed.indexOf('QUICK_AUDIT') >= 0),
      releaseVersion: text_(operation && operation.release_version)
    };
    summary.accepted = summary.status === 'SUCCESS' && summary.currentPhase === 'SUCCESS' &&
      summary.operationType === expectedType && missingPhases.length === 0 &&
      summary.aggregateStatus === 'SUCCESS' && summary.rawAuditOk;
    return summary;
  }

  function assertOperationAccepted_(operation, expectedType) {
    var summary = operationSummary_(operation, expectedType);
    assert_(summary.accepted, 'ALPHA74_GATE6_OPERATION_NOT_ACCEPTED', 'A Gate 6 operation did not complete the full regular pipeline.', summary);
    assert_(summary.loadId, 'ALPHA74_GATE6_OPERATION_LOAD_MISSING', 'A Gate 6 operation has no durable RAW load ID.', summary);
    var audit = AKORT.RawStore.auditLoad(summary.loadId);
    assert_(audit && audit.ok === true, 'ALPHA74_GATE6_RAW_AUDIT_FAILED', 'Gate 6 RAW read-back audit failed.', {
      operationId: summary.operationId,
      operationType: expectedType,
      audit: audit
    });
    summary.rawAudit = clone_(audit);
    summary.rawAuditOk = true;
    return summary;
  }

  function assertSourceHash_(operation, state, role) {
    var handler = operation && operation.checkpoint && operation.checkpoint.handlerState || {};
    var actual = text_(handler.sourceHash);
    assert_(actual && actual === text_(state.canarySource && state.canarySource.sourceHash),
      'ALPHA74_GATE6_SOURCE_CHANGED', 'The Gate 6 source file content changed after validation.', {
        role: role,
        expectedSourceHash: state.canarySource && state.canarySource.sourceHash || '',
        actualSourceHash: actual,
        fileId: state.canarySource && state.canarySource.fileId || ''
      });
    assert_(text_(handler.profile && handler.profile.profileId) === text_(state.canarySource.profileId) &&
      text_(handler.profile && handler.profile.targetTable) === text_(state.canarySource.targetTable),
      'ALPHA74_GATE6_SOURCE_PROFILE_CHANGED', 'The Gate 6 source profile differs from the validated canary contract.', {
        role: role,
        expectedProfileId: state.canarySource.profileId,
        actualProfileId: handler.profile && handler.profile.profileId || '',
        expectedTargetTable: state.canarySource.targetTable,
        actualTargetTable: handler.profile && handler.profile.targetTable || ''
      });
    return actual;
  }

  function runOperation_(operationId) {
    var before = operation_(operationId);
    if (before.status === 'SUCCESS' || TERMINAL_FAILURES.indexOf(before.status) >= 0) return before;
    AKORT.OperationEngine.resume(operationId, {
      maxSteps: 50,
      executionBudgetMs: 210000,
      minRemainingMs: 15000
    });
    return operation_(operationId);
  }

  function enqueueSourceFile_(state, role) {
    var source = state.canarySource || {};
    var queued = AKORT.ExistingSourceParsers.enqueueFile(source.fileId, {
      profileId: source.profileId || '',
      year: source.year || '',
      month: source.month || '',
      week: source.week || '',
      sourcePublishedAt: source.sourcePublishedAt || '',
      sourceId: source.fileId,
      sourceName: source.fileName,
      idempotencyKey: 'ALPHA74_GATE6_' + role + '_' + state.executionId,
      maxAttempts: 3
    });
    assert_(queued && queued.ok, queued && queued.code || 'ALPHA74_GATE6_SOURCE_ENQUEUE_FAILED',
      queued && queued.message || 'Gate 6 source file could not be queued.', queued && queued.details || {});
    return text_(queued.data && queued.data.operationId);
  }

  function enqueueReversal_(state) {
    var queued = AKORT.OperationEngine.enqueue('RAW_REVERSAL_V4', {
      targetLoadId: state.loads.canary,
      reason: 'Alpha.7.4 Gate 6 authoritative DEV rollback proof ' + state.executionId
    }, {
      idempotencyKey: 'ALPHA74_GATE6_REVERSAL_' + state.executionId,
      priority: 20,
      maxAttempts: 3
    });
    assert_(queued && queued.ok, queued && queued.code || 'ALPHA74_GATE6_REVERSAL_ENQUEUE_FAILED',
      queued && queued.message || 'Gate 6 reversal could not be queued.', queued && queued.details || {});
    return text_(queued.data.operationId);
  }

  function enqueueRestore_(state) {
    return enqueueSourceFile_(state, 'RESTORE');
  }

  function createEvidence_(state) {
    var resources = resources_();
    var flags = flagState_();
    var evidence = {
      schemaVersion: EVIDENCE_SCHEMA,
      release: RELEASE,
      gate6Version: VERSION,
      executionId: state.executionId,
      status: 'SUCCESS',
      startedAt: state.startedAt,
      finishedAt: state.acceptanceCompletedAt,
      gate5: clone_(state.gate5),
      recoveryArtifacts: clone_(state.artifacts),
      liveResources: clone_(state.liveResources),
      canarySource: clone_(state.canarySource),
      operations: {
        canary: assertOperationAccepted_(operation_(state.operations.canary), 'SOURCE_FILE_LOAD_V4'),
        reversal: assertOperationAccepted_(operation_(state.operations.reversal), 'RAW_REVERSAL_V4'),
        restore: assertOperationAccepted_(operation_(state.operations.restore), 'SOURCE_FILE_LOAD_V4')
      },
      digests: clone_(state.digests),
      assertions: {
        canaryChangedTargets: clone_(state.acceptance.canaryChangedTargets),
        rollbackExact: state.acceptance.rollbackExact === true,
        restoreExact: state.acceptance.restoreExact === true,
        aggregateContractScan: clone_(state.acceptance.aggregateContractScan),
        regularCyclesWithoutManualContinuation: 3,
        standardLogicalReversalUsed: true,
        backupsCreatedBeforeWrites: true
      },
      featureFlags: {
        publishEngineEnabled: flags.publishEngineEnabled,
        aggregateExecutionEnabled: flags.executionEnabled,
        aggregateRegularPipelineEnabled: flags.regularPipelineEnabled,
        userPipelineEnabled: flags.userPipelineEnabled
      },
      metrics: clone_(state.metrics)
    };
    var json = JSON.stringify(evidence, null, 2);
    var sha256 = hash_(json);
    var name = 'ALPHA74_GATE6_ACCEPTANCE_' + state.executionId + '.json';
    var folder = DriveApp.getFolderById(resources.testResultsFolderId);
    var existing = folder.getFilesByName(name);
    if (existing.hasNext()) {
      var existingFile = existing.next();
      var existingJson = existingFile.getBlob().getDataAsString('UTF-8');
      assert_(hash_(existingJson) === sha256, 'ALPHA74_GATE6_EVIDENCE_CONFLICT', 'An evidence file with the same execution ID has different content.', {
        fileId: existingFile.getId(),
        expectedSha256: sha256,
        actualSha256: hash_(existingJson)
      });
      assert_(!existing.hasNext(), 'ALPHA74_GATE6_EVIDENCE_DUPLICATE', 'More than one Gate 6 evidence file exists for the same execution.', {
        name: name
      });
      return {
        id: existingFile.getId(),
        name: existingFile.getName(),
        url: existingFile.getUrl(),
        sha256: sha256,
        bytes: existingJson.length,
        schemaVersion: EVIDENCE_SCHEMA,
        recoveredAfterLostResponse: true
      };
    }
    var blob = Utilities.newBlob(json, 'application/json', name);
    var file = folder.createFile(blob);
    return {
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      sha256: sha256,
      bytes: json.length,
      schemaVersion: EVIDENCE_SCHEMA
    };
  }

  function processStep_(state) {
    if (state.phase === 'BASELINE_SCAN') return scanStep_(state, 'baseline', 'ARM_CANARY');

    if (state.phase === 'ARM_CANARY') {
      assertNoForeignDataOperations_(state);
      var flags = flagState_();
      assert_(flags.publishEngineEnabled && flags.executionEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_FLAGS_INVALID', 'Gate 6 requires Publish and aggregate execution enabled while the user pipeline remains disabled.', flags);
      setRegularPipeline_(true);
      state.regularPipelineEnabledAt = now_();
      state.phase = 'SUBMIT_CANARY';
      return { phase: 'ARM_CANARY', regularPipelineEnabled: true };
    }

    if (state.phase === 'SUBMIT_CANARY') {
      if (!state.operations.canary) state.operations.canary = enqueueSourceFile_(state, 'CANARY');
      assert_(state.operations.canary, 'ALPHA74_GATE6_CANARY_OPERATION_MISSING', 'Gate 6 did not persist the canary operation ID.', {});
      state.phase = 'RUN_CANARY';
      return { phase: 'SUBMIT_CANARY', operationId: state.operations.canary };
    }

    if (state.phase === 'RUN_CANARY') {
      assertNoForeignDataOperations_(state);
      var canary = runOperation_(state.operations.canary);
      if (TERMINAL_FAILURES.indexOf(canary.status) >= 0) {
        throw error_(text_(canary.error_code) || 'ALPHA74_GATE6_CANARY_FAILED', text_(canary.error_message) || 'Gate 6 canary failed.', {
          operationId: state.operations.canary,
          status: canary.status
        });
      }
      if (canary.status !== 'SUCCESS') return { phase: 'RUN_CANARY', operationId: state.operations.canary, status: canary.status };
      assertSourceHash_(canary, state, 'CANARY');
      assertOperationAccepted_(canary, 'SOURCE_FILE_LOAD_V4');
      state.acceptance.canaryOperationAccepted = true;
      state.loads.canary = operationLoadId_(canary);
      assert_(state.loads.canary, 'ALPHA74_GATE6_CANARY_LOAD_MISSING', 'Gate 6 canary has no committed load ID.', {});
      state.phase = 'POST_CANARY_SCAN';
      return { phase: 'RUN_CANARY_COMPLETE', operationId: state.operations.canary, loadId: state.loads.canary };
    }

    if (state.phase === 'POST_CANARY_SCAN') return scanStep_(state, 'postCanary', 'VERIFY_CANARY');

    if (state.phase === 'VERIFY_CANARY') {
      assertNoForeignDataOperations_(state);
      var changed = changedTargets_(state.digests.baseline, state.digests.postCanary);
      assert_(changed.indexOf('PUBLISH_PRICE_AGGREGATES') >= 0,
        'ALPHA74_GATE6_AGGREGATES_NOT_CHANGED', 'The authoritative weekly/monthly canary did not change PUBLISH_PRICE_AGGREGATES.', {
          changedTargets: changed,
          source: state.canarySource
        });
      state.acceptance.canaryChangedTargets = changed;
      state.phase = 'ENQUEUE_REVERSAL';
      return { phase: 'VERIFY_CANARY', changedTargets: changed };
    }

    if (state.phase === 'ENQUEUE_REVERSAL') {
      assertNoForeignDataOperations_(state);
      state.operations.reversal = state.operations.reversal || enqueueReversal_(state);
      state.phase = 'RUN_REVERSAL';
      return { phase: 'ENQUEUE_REVERSAL', operationId: state.operations.reversal };
    }

    if (state.phase === 'RUN_REVERSAL') {
      assertNoForeignDataOperations_(state);
      var reversal = runOperation_(state.operations.reversal);
      if (TERMINAL_FAILURES.indexOf(reversal.status) >= 0) {
        throw error_(text_(reversal.error_code) || 'ALPHA74_GATE6_REVERSAL_FAILED', text_(reversal.error_message) || 'Gate 6 reversal failed.', {
          operationId: state.operations.reversal,
          status: reversal.status
        });
      }
      if (reversal.status !== 'SUCCESS') return { phase: 'RUN_REVERSAL', operationId: state.operations.reversal, status: reversal.status };
      assertOperationAccepted_(reversal, 'RAW_REVERSAL_V4');
      state.acceptance.reversalOperationAccepted = true;
      state.loads.reversal = operationLoadId_(reversal);
      state.phase = 'ROLLBACK_SCAN';
      return { phase: 'RUN_REVERSAL_COMPLETE', operationId: state.operations.reversal, loadId: state.loads.reversal };
    }

    if (state.phase === 'ROLLBACK_SCAN') return scanStep_(state, 'rollback', 'VERIFY_ROLLBACK');

    if (state.phase === 'VERIFY_ROLLBACK') {
      assertNoForeignDataOperations_(state);
      var rollback = compareDigests_(state.digests.baseline, state.digests.rollback);
      assert_(rollback.exact, 'ALPHA74_GATE6_ROLLBACK_MISMATCH', 'Logical reversal did not restore the exact pre-canary Publish state.', rollback);
      state.acceptance.rollbackExact = true;
      state.phase = 'ENQUEUE_RESTORE';
      return { phase: 'VERIFY_ROLLBACK', exact: true };
    }

    if (state.phase === 'ENQUEUE_RESTORE') {
      assertNoForeignDataOperations_(state);
      state.operations.restore = state.operations.restore || enqueueRestore_(state);
      state.phase = 'RUN_RESTORE';
      return { phase: 'ENQUEUE_RESTORE', operationId: state.operations.restore };
    }

    if (state.phase === 'RUN_RESTORE') {
      assertNoForeignDataOperations_(state);
      var restore = runOperation_(state.operations.restore);
      if (TERMINAL_FAILURES.indexOf(restore.status) >= 0) {
        throw error_(text_(restore.error_code) || 'ALPHA74_GATE6_RESTORE_FAILED', text_(restore.error_message) || 'Gate 6 restore failed.', {
          operationId: state.operations.restore,
          status: restore.status
        });
      }
      if (restore.status !== 'SUCCESS') return { phase: 'RUN_RESTORE', operationId: state.operations.restore, status: restore.status };
      assertSourceHash_(restore, state, 'RESTORE');
      assertOperationAccepted_(restore, 'SOURCE_FILE_LOAD_V4');
      state.acceptance.restoreOperationAccepted = true;
      state.loads.restore = operationLoadId_(restore);
      state.phase = 'FINAL_SCAN';
      return { phase: 'RUN_RESTORE_COMPLETE', operationId: state.operations.restore, loadId: state.loads.restore };
    }

    if (state.phase === 'FINAL_SCAN') return scanStep_(state, 'final', 'FINAL_VALIDATION');

    if (state.phase === 'FINAL_VALIDATION') {
      assertNoForeignDataOperations_(state);
      var restored = compareDigests_(state.digests.postCanary, state.digests.final);
      assert_(restored.exact, 'ALPHA74_GATE6_RESTORE_MISMATCH', 'Final Publish state differs from the accepted canary state.', restored);
      state.acceptance.restoreExact = true;
      var contract = AKORT.AggregateIntegration.readOnlyContractScan();
      assert_(contract && contract.ok && contract.data && contract.data.ok,
        contract && contract.code || 'ALPHA74_GATE6_AGGREGATE_CONTRACT_FAILED',
        contract && contract.message || 'Final aggregate contract scan failed.', contract && contract.details || {});
      state.acceptance.aggregateContractScan = {
        rows: contract.data.rows,
        columns: contract.data.columns,
        logicalRows: contract.data.logicalRows,
        duplicateLogicalRows: (contract.data.duplicateLogicalRows || []).length,
        latestFailures: (contract.data.latestFailures || []).length,
        futureRows: (contract.data.futureRows || []).length,
        fingerprint: contract.data.fingerprint,
        ok: contract.data.ok === true
      };
      state.acceptanceCompletedAt = now_();
      state.phase = 'SAVE_EVIDENCE';
      return { phase: 'FINAL_VALIDATION', aggregateContractScan: state.acceptance.aggregateContractScan };
    }

    if (state.phase === 'SAVE_EVIDENCE') {
      var finalFlags = flagState_();
      assert_(finalFlags.publishEngineEnabled && finalFlags.executionEnabled && finalFlags.regularPipelineEnabled && !finalFlags.userPipelineEnabled,
        'ALPHA74_GATE6_FINAL_FLAGS_INVALID', 'Gate 6 final feature flags are invalid.', finalFlags);
      state.evidence = createEvidence_(state);
      state.status = 'SUCCESS';
      state.phase = 'SUCCESS';
      state.finishedAt = now_();
      state.leaseUntil = '';
      deleteTriggers_();
      try { writeValidation_('GATE 6 SUCCESS', { executionId: state.executionId, evidence: state.evidence }); } catch (ignoredValidation) {}
      return { phase: 'SUCCESS', evidence: state.evidence };
    }

    if (state.phase === 'SUCCESS') return { phase: 'SUCCESS', terminal: true };
    throw error_('ALPHA74_GATE6_PHASE_INVALID', 'Gate 6 checkpoint has an unsupported phase.', { phase: state.phase });
  }

  function publicState_(state) {
    if (!state) return null;
    return {
      stateSchemaVersion: state.stateSchemaVersion,
      release: state.release,
      executionId: state.executionId,
      status: state.status,
      phase: state.phase,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      finishedAt: state.finishedAt || '',
      acceptanceCompletedAt: state.acceptanceCompletedAt || '',
      stoppedFromPhase: state.stoppedFromPhase || '',
      failedFromPhase: state.failedFromPhase || '',
      regularPipelineEnabledAt: state.regularPipelineEnabledAt || '',
      canarySource: clone_(state.canarySource || null),
      artifacts: clone_(state.artifacts || {}),
      operations: clone_(state.operations || {}),
      loads: clone_(state.loads || {}),
      digests: clone_(state.digests || {}),
      scan: state.scan ? {
        bucket: state.scan.bucket,
        targetIndex: state.scan.targetIndex,
        target: state.scan.work && state.scan.work.target || '',
        cursor: state.scan.work && state.scan.work.cursor || 0,
        total: state.scan.work && state.scan.work.rows || 0
      } : null,
      acceptance: clone_(state.acceptance || {}),
      evidence: clone_(state.evidence || null),
      recovery: clone_(state.recovery || null),
      metrics: clone_(state.metrics || {}),
      consecutiveErrors: Number(state.consecutiveErrors || 0),
      lastError: clone_(state.lastError || null),
      lastStep: clone_(state.lastStep || null),
      triggerCount: triggers_().length
    };
  }

  function status() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var flags = flagState_();
      var state = loadState_();
      var control = controlStatus_();
      var runtimeContextResult = AKORT.AggregateIntegration.operationalRuntimeContextStatus();
      var runtimeContext = {
        ready: !!(runtimeContextResult && runtimeContextResult.ok),
        code: runtimeContextResult && runtimeContextResult.code || '',
        details: runtimeContextResult && (runtimeContextResult.data || runtimeContextResult.details) || null
      };
      return AKORT.Result.success('Alpha.7.4 Gate 6 status loaded.', {
        release: RELEASE,
        version: VERSION,
        evidenceSchemaVersion: EVIDENCE_SCHEMA,
        stateSchemaVersion: STATE_SCHEMA,
        readyToStart: runtimeContext.ready && flags.publishEngineEnabled && flags.executionEnabled && !flags.regularPipelineEnabled && !flags.userPipelineEnabled &&
          control.installed && control.fileConfigured && control.validationStatus === 'ГОТОВО К GATE 6',
        flags: flags,
        control: control,
        runtimeContext: runtimeContext,
        targetSheets: TARGETS.slice(),
        cycleContract: ['SOURCE_FILE_LOAD_V4_CANARY', 'RAW_REVERSAL_V4_ROLLBACK', 'SOURCE_FILE_LOAD_V4_RESTORE'],
        worker: TRIGGER_HANDLER,
        state: publicState_(state),
        physicalWrites: state && state.status === 'RUNNING' && state.phase !== 'BASELINE_SCAN'
      });
    }, { lock: false, persistLogs: false });
  }

  function install() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_INSTALL', function () {
      AKORT.EnvironmentGuard.assertDev();
      gate5Accepted_();
      var flags = flagState_();
      assert_(!flags.regularPipelineEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_INSTALL_FLAGS_INVALID', 'Gate 6 control installation requires regular and user pipelines disabled.', flags);
      var installed = ensureControlSheet_();
      return AKORT.Result.success('Alpha.7.4 Gate 6 canary control sheet installed.', {
        release: RELEASE,
        version: VERSION,
        sheet: CONTROL_SHEET,
        created: installed.created,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: true });
  }

  function validate() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_VALIDATE', function () {
      AKORT.EnvironmentGuard.assertDev();
      gate5Accepted_();
      var flags = flagState_();
      assert_(!flags.regularPipelineEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_VALIDATE_FLAGS_INVALID', 'Gate 6 source validation requires regular and user pipelines disabled.', flags);
      var source = validateCanarySpec_();
      writeValidation_('ГОТОВО К GATE 6', {
        fileName: source.fileName,
        profileId: source.profileId,
        targetTable: source.targetTable,
        normalizedRowCount: source.normalizedRowCount,
        sourceHash: source.sourceHash
      });
      return AKORT.Result.success('Alpha.7.4 Gate 6 weekly/monthly source validation passed.', {
        release: RELEASE,
        source: source,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: true });
  }

  function start() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_START', function () {
      AKORT.EnvironmentGuard.assertDev();
      var flags = flagState_();
      assert_(flags.publishEngineEnabled && flags.executionEnabled && !flags.regularPipelineEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_START_FLAGS_INVALID', 'Gate 6 Start requires engine=TRUE, aggregate execution=TRUE, regular pipeline=FALSE and user pipeline=FALSE.', flags);
      assertOperationalRuntimeContext_();
      var existing = loadState_();
      if (existing && existing.status === 'RUNNING') {
        ensureTrigger_();
        return AKORT.Result.success('Alpha.7.4 Gate 6 is already running.', publicState_(existing));
      }
      var gate5 = gate5Accepted_();
      var canarySource = validateCanarySpec_();
      assertNoForeignDataOperations_(null);
      var resources = resources_();
      deleteTriggers_();
      var executionId = 'A74_GATE6_' + hash_([timestamp_(), Utilities.getUuid()]).slice(0, 20).toUpperCase();
      var state = {
        stateSchemaVersion: STATE_SCHEMA,
        release: RELEASE,
        executionId: executionId,
        status: 'RUNNING',
        phase: 'BASELINE_SCAN',
        startedAt: now_(),
        updatedAt: now_(),
        finishedAt: '',
        leaseUntil: '',
        regularPipelineEnabledAt: '',
        gate5: gate5,
        liveResources: {
          dwhSpreadsheetId: resources.dwhSpreadsheetId,
          publishSpreadsheetId: resources.publishSpreadsheetId
        },
        canarySource: canarySource,
        artifacts: createRecoveryArtifacts_(resources, executionId),
        operations: { canary: '', reversal: '', restore: '' },
        loads: { canary: '', reversal: '', restore: '' },
        digests: {},
        scan: null,
        acceptance: {},
        evidence: null,
        metrics: { workerExecutions: 0, steps: 0, digestChunks: 0, rowsScanned: 0, manualContinuationCalls: 0 },
        consecutiveErrors: 0,
        lastError: null,
        lastStep: null
      };
      saveState_(state);
      writeValidation_('GATE 6 ЗАПУЩЕН', {
        executionId: executionId,
        fileName: canarySource.fileName,
        targetTable: canarySource.targetTable,
        sourceHash: canarySource.sourceHash
      });
      ensureTrigger_();
      return AKORT.Result.success('Alpha.7.4 Gate 6 started. Recovery copies were created; the worker will run the three-cycle DEV canary automatically.', publicState_(state));
    }, { lock: true, persistLogs: true, lockTimeoutMs: 60000 });
  }

  function blankCycleIds_(value) {
    value = value || {};
    return !text_(value.canary) && !text_(value.reversal) && !text_(value.restore);
  }

  function baselineHeaderIncident_(state) {
    var metrics = state && state.metrics || {};
    var scan = state && state.scan || null;
    var artifacts = state && state.artifacts || {};
    return !!state &&
      state.stateSchemaVersion === STATE_SCHEMA &&
      state.release === BASELINE_HEADER_INCIDENT_RELEASE &&
      state.status === 'FAILED' && state.phase === 'FAILED' &&
      state.failedFromPhase === 'BASELINE_SCAN' &&
      state.lastError && state.lastError.code === 'ALPHA74_GATE6_UNEXPECTED_ERROR' &&
      text_(state.lastError.message).indexOf('AKORT_V300 is not defined') >= 0 &&
      blankCycleIds_(state.operations) && blankCycleIds_(state.loads) &&
      Object.keys(state.digests || {}).length === 0 &&
      scan && scan.schemaVersion === '4.0-alpha74-gate6-scan-1' &&
      scan.bucket === 'baseline' && Number(scan.targetIndex || 0) === 0 && !scan.work &&
      Number(metrics.digestChunks || 0) === 0 && Number(metrics.rowsScanned || 0) === 0 &&
      !!text_(artifacts.dwhBackup && artifacts.dwhBackup.id) &&
      !!text_(artifacts.publishBackup && artifacts.publishBackup.id);
  }

  function aggregateStageRowsForOperation_(operationId) {
    var spreadsheet = SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
    var sheet = spreadsheet.getSheetByName('AGGREGATE_STAGE');
    assert_(sheet, 'ALPHA74_GATE6_AGGREGATE_STAGE_MISSING', 'AGGREGATE_STAGE is missing.', {});
    return AKORT.Core.Sheets.readObjects(sheet).filter(function (row) {
      return text_(row.operation_id) === text_(operationId);
    });
  }

  function runtimeContextIncident_(state, operation) {
    var checkpoint = operation && operation.checkpoint || {};
    var completed = checkpoint.completedPhases || [];
    var aggregate = checkpoint.aggregate || {};
    return !!state && !!operation &&
      state.stateSchemaVersion === STATE_SCHEMA && state.release === RUNTIME_CONTEXT_INCIDENT_RELEASE &&
      state.status === 'FAILED' && state.phase === 'FAILED' && state.failedFromPhase === 'RUN_CANARY' &&
      state.lastError && state.lastError.code === 'AGGREGATE_RUNTIME_CONTEXT_MISSING' &&
      text_(state.operations && state.operations.canary) === text_(operation.operation_id) &&
      text_(operation.operation_type) === 'SOURCE_FILE_LOAD_V4' && text_(operation.status) === 'FAILED' &&
      text_(operation.current_phase) === 'MATERIALIZING_AGGREGATE_INPUTS' &&
      text_(operation.error_code) === 'AGGREGATE_RUNTIME_CONTEXT_MISSING' &&
      text_(checkpoint.nextPhase) === 'MATERIALIZING_AGGREGATE_INPUTS' &&
      completed.indexOf('COMMIT_RAW') >= 0 && completed.indexOf('UPDATE_PUBLISH') >= 0 &&
      completed.indexOf('PREPARING_AGGREGATE_IMPACT') >= 0 &&
      completed.indexOf('MATERIALIZING_AGGREGATE_INPUTS') < 0 &&
      text_(aggregate.status) === 'IMPACT_PREPARED' && !!operationLoadId_(operation) &&
      !!text_(state.artifacts && state.artifacts.dwhBackup && state.artifacts.dwhBackup.id) &&
      !!text_(state.artifacts && state.artifacts.publishBackup && state.artifacts.publishBackup.id);
  }

  function monolithicStageIncident_(state, operation) {
    var checkpoint = operation && operation.checkpoint || {};
    var completed = checkpoint.completedPhases || [];
    var aggregate = checkpoint.aggregate || {};
    var control = checkpoint.control || {};
    var calculated = Number(aggregate.calculationCursor || 0);
    var expected = Number(aggregate.calculationGroupCount || 0);
    return !!state && !!operation &&
      state.stateSchemaVersion === STATE_SCHEMA && state.release === MONOLITHIC_STAGE_INCIDENT_RELEASE &&
      state.status === 'STOPPED' && state.phase === 'STOPPED' && state.stoppedFromPhase === 'RUN_CANARY' &&
      text_(state.operations && state.operations.canary) === text_(operation.operation_id) &&
      text_(operation.operation_type) === 'SOURCE_FILE_LOAD_V4' &&
      ['PAUSED', 'RUNNING'].indexOf(text_(operation.status)) >= 0 &&
      text_(operation.current_phase) === 'STAGING_AGGREGATE_ROWS' &&
      text_(checkpoint.nextPhase) === 'STAGING_AGGREGATE_ROWS' &&
      control.stopRequested === true &&
      completed.indexOf('COMMIT_RAW') >= 0 && completed.indexOf('UPDATE_PUBLISH') >= 0 &&
      completed.indexOf('PREPARING_AGGREGATE_IMPACT') >= 0 &&
      completed.indexOf('MATERIALIZING_AGGREGATE_INPUTS') >= 0 &&
      completed.indexOf('CALCULATING_AGGREGATE_SLICES') >= 0 &&
      completed.indexOf('STAGING_AGGREGATE_ROWS') < 0 &&
      text_(aggregate.status) === 'CALCULATED' && expected > 0 && calculated === expected &&
      Number(aggregate.stagingCursor || 0) === 0 &&
      !text_(aggregate.stageFingerprint) && Number(aggregate.expectedStageRows || 0) === 0 &&
      !!operationLoadId_(operation) &&
      !!text_(state.artifacts && state.artifacts.dwhBackup && state.artifacts.dwhBackup.id) &&
      !!text_(state.artifacts && state.artifacts.publishBackup && state.artifacts.publishBackup.id);
  }

  function stageRecoveryBoundary_(rows) {
    var stageRows = rows || [];
    if (!stageRows.length) return '';
    var statuses = {};
    for (var index = 0; index < stageRows.length; index += 1) {
      var row = stageRows[index] || {};
      statuses[text_(row.stage_status)] = true;
      if (text_(row.expected_target_fingerprint) || text_(row.verified_at) ||
          text_(row.release_version) !== MONOLITHIC_STAGE_INCIDENT_RELEASE) return '';
    }
    var values = Object.keys(statuses);
    if (values.length !== 1) return '';
    if (values[0] === 'CALCULATED') return 'BEFORE_STAGE_STATUS_WRITE';
    if (values[0] === 'STAGED') return 'AFTER_STAGE_STATUS_WRITE_LOST_RESPONSE';
    return '';
  }

  function recoverRuntimeContextIncident() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_RECOVER_RUNTIME_CONTEXT', function () {
      AKORT.EnvironmentGuard.assertDev();
      var state = loadState_();
      var operationId = text_(state && state.operations && state.operations.canary);
      var operation = operationId ? operation_(operationId) : null;
      assert_(runtimeContextIncident_(state, operation),
        'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_SOURCE_INVALID', 'Gate 6 runtime-context recovery is restricted to the exact Alpha.7.4.20 canary incident.', {
          stateRelease: state && state.release || '',
          stateStatus: state && state.status || 'NOT_FOUND',
          failedFromPhase: state && state.failedFromPhase || '',
          operationId: operationId,
          operationStatus: operation && operation.status || '',
          operationPhase: operation && operation.current_phase || '',
          operationErrorCode: operation && operation.error_code || ''
        });
      var flags = flagState_();
      assert_(flags.publishEngineEnabled && flags.executionEnabled && !flags.regularPipelineEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_FLAGS_INVALID', 'Runtime-context recovery requires engine=TRUE, aggregate execution=TRUE, regular pipeline=FALSE and user pipeline=FALSE.', flags);
      assert_(triggers_().length === 0, 'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_TRIGGER_ACTIVE', 'Gate 6 recovery requires no active Gate 6 worker trigger.', {
        triggerCount: triggers_().length
      });
      assertNoForeignDataOperations_(state);
      ['dwhBackup', 'publishBackup'].forEach(function (key) {
        DriveApp.getFileById(state.artifacts[key].id).getName();
      });
      var inspected = AKORT.ExistingSourceParsers.inspectFile(state.canarySource.fileId, {
        profileId: state.canarySource.profileId || '',
        year: state.canarySource.year || '',
        month: state.canarySource.month || '',
        week: state.canarySource.week || '',
        sourcePublishedAt: state.canarySource.sourcePublishedAt || ''
      });
      assert_(text_(inspected.sourceHash) === text_(state.canarySource.sourceHash),
        'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_SOURCE_CHANGED', 'The Gate 6 canary source changed after the failed checkpoint.', {
          expectedSourceHash: state.canarySource.sourceHash,
          actualSourceHash: inspected.sourceHash
        });
      var stageRows = aggregateStageRowsForOperation_(operationId);
      assert_(stageRows.length === 0, 'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_STAGE_NOT_EMPTY', 'The failed canary already has aggregate stage rows and cannot use this exact recovery.', {
        operationId: operationId,
        stageRows: stageRows.length
      });
      var configured = AKORT.Config.readSystemSettings().PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON;
      var expectedContext = acceptedParityRuntimeContext_();
      var currentContext = normalizedJsonSetting_(configured);
      assert_(Object.keys(currentContext).length === 0 || stableStringify_(currentContext) === stableStringify_(expectedContext),
        'ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_CONFLICT', 'A different operational aggregate runtime context is already configured.', {
          configuredFingerprint: hash_(currentContext),
          expectedFingerprint: hash_(expectedContext)
        });
      if (!Object.keys(currentContext).length) {
        setJsonSetting_(
          'PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON',
          expectedContext,
          'Gate 5 accepted Alpha.6 parity adapter behind the Alpha.7.4 atomic logical-series boundary'
        );
      }
      var contextStatus = assertOperationalRuntimeContext_();
      var prepared = AKORT.OperationEngine.recoverFailedPhase(operationId, {
        operationType: 'SOURCE_FILE_LOAD_V4',
        phase: 'MATERIALIZING_AGGREGATE_INPUTS',
        errorCode: 'AGGREGATE_RUNTIME_CONTEXT_MISSING',
        reason: 'Alpha.7.4.22 exact Gate 6 operational runtime-context recovery'
      });
      assert_(prepared && prepared.ok, prepared && prepared.code || 'ALPHA74_GATE6_OPERATION_RECOVERY_FAILED',
        prepared && prepared.message || 'The failed canary operation could not be prepared for recovery.', prepared && prepared.details || {});
      state.release = RELEASE;
      state.status = 'RUNNING';
      state.phase = 'RUN_CANARY';
      state.finishedAt = '';
      state.failedFromPhase = '';
      state.stoppedFromPhase = '';
      state.leaseUntil = '';
      state.consecutiveErrors = 0;
      state.lastError = null;
      state.recovery = {
        mode: 'OPERATIONAL_RUNTIME_CONTEXT_CHECKPOINT_RECOVERY',
        recoveredFromRelease: RUNTIME_CONTEXT_INCIDENT_RELEASE,
        recoveredAt: now_(),
        operationId: operationId,
        loadId: operationLoadId_(operation),
        resumePhase: 'MATERIALIZING_AGGREGATE_INPUTS',
        preservedRecoveryCopies: true,
        repeatedRawCommit: false,
        repeatedPricePublish: false,
        runtimeAdapterMode: contextStatus.adapterMode
      };
      state.lastStep = {
        phase: 'RUNTIME_CONTEXT_RECOVERY_PREPARED',
        operationId: operationId,
        resumePhase: 'MATERIALIZING_AGGREGATE_INPUTS'
      };
      try {
        setRegularPipeline_(true);
        state.regularPipelineEnabledAt = now_();
        saveState_(state);
        writeValidation_('GATE 6 ВОЗОБНОВЛЁН', {
          executionId: state.executionId,
          operationId: operationId,
          phase: state.phase,
          recoveryMode: state.recovery.mode
        });
        ensureTrigger_();
      } catch (activationError) {
        deleteTriggers_();
        try { setRegularPipeline_(false); } catch (ignoredFlagCleanup) {}
        state.status = 'STOPPED';
        state.phase = 'STOPPED';
        state.stoppedFromPhase = 'RUN_CANARY';
        state.finishedAt = now_();
        state.lastError = {
          code: text_(activationError && activationError.code) || 'ALPHA74_GATE6_RUNTIME_CONTEXT_RECOVERY_ACTIVATION_FAILED',
          message: text_(activationError && activationError.message) || String(activationError),
          details: clone_(activationError && activationError.details || null)
        };
        try { saveState_(state); } catch (ignoredStateCleanup) {}
        throw activationError;
      }
      return AKORT.Result.success('Alpha.7.4 Gate 6 operational runtime context installed; the existing canary operation will continue from its aggregate checkpoint.', publicState_(state));
    }, { lock: true, persistLogs: true, lockTimeoutMs: 60000 });
  }

  function resume() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_RESUME', function () {
      AKORT.EnvironmentGuard.assertDev();
      var state = loadState_();
      var baselineIncident = baselineHeaderIncident_(state);
      var activeOperationId = text_(state && state.operations && state.operations.canary);
      var activeOperation = activeOperationId ? operation_(activeOperationId) : null;
      var monolithicStageIncident = monolithicStageIncident_(state, activeOperation);
      var monolithicStageRecovery = null;
      var manuallyStopped = state && state.status === 'STOPPED' && text_(state.stoppedFromPhase);
      assert_(baselineIncident || manuallyStopped,
        'ALPHA74_GATE6_RESUME_STATE_INVALID', 'Gate 6 Resume requires a manually stopped checkpoint or the exact Alpha.7.4.19 baseline-header incident.', {
          status: state ? state.status : 'NOT_FOUND',
          stoppedFromPhase: state ? state.stoppedFromPhase || '' : '',
          failedFromPhase: state ? state.failedFromPhase || '' : '',
          baselineHeaderIncident: baselineIncident
        });
      assert_(baselineIncident || monolithicStageIncident || (state.stateSchemaVersion === STATE_SCHEMA && state.release === RELEASE),
        'ALPHA74_GATE6_RESUME_SCHEMA_INVALID', 'Gate 6 checkpoint is not compatible with this release.', {
          stateSchemaVersion: state.stateSchemaVersion,
          release: state.release,
          monolithicStageIncident: monolithicStageIncident
        });
      var flags = flagState_();
      assert_(flags.publishEngineEnabled && flags.executionEnabled && !flags.regularPipelineEnabled && !flags.userPipelineEnabled,
        'ALPHA74_GATE6_RESUME_FLAGS_INVALID', 'Gate 6 Resume requires engine=TRUE, aggregate execution=TRUE, regular pipeline=FALSE and user pipeline=FALSE.', flags);
      var resources = resources_();
      assert_(text_(resources.dwhSpreadsheetId) === text_(state.liveResources.dwhSpreadsheetId) &&
        text_(resources.publishSpreadsheetId) === text_(state.liveResources.publishSpreadsheetId),
        'ALPHA74_GATE6_RESUME_RESOURCE_CHANGED', 'Canonical DWH or Publish changed after Gate 6 was stopped.', {});
      ['dwhBackup', 'publishBackup'].forEach(function (key) {
        assert_(state.artifacts && state.artifacts[key] && text_(state.artifacts[key].id),
          'ALPHA74_GATE6_RESUME_BACKUP_MISSING', 'A Gate 6 recovery artifact is missing from the checkpoint.', { artifact: key });
        DriveApp.getFileById(state.artifacts[key].id).getName();
      });
      if (monolithicStageIncident) {
        var incidentStageRows = aggregateStageRowsForOperation_(activeOperationId);
        var calculatedRows = incidentStageRows.filter(function (row) {
          return text_(row.aggregate_series_key).indexOf('__') !== 0;
        });
        var publishIntents = incidentStageRows.filter(function (row) {
          return text_(row.action) === 'PUBLISH_INTENT';
        });
        var expectedCalculatedRows = Number(activeOperation.checkpoint.aggregate.calculationGroupCount || 0);
        var stageRecoveryBoundary = stageRecoveryBoundary_(calculatedRows);
        assert_(calculatedRows.length === expectedCalculatedRows && publishIntents.length === 0 && !!stageRecoveryBoundary,
          'ALPHA74_GATE6_MONOLITHIC_STAGE_RECOVERY_BOUNDARY_INVALID', 'The stopped canary no longer matches a verified bounded staging recovery boundary.', {
          operationId: activeOperationId,
          expectedCalculatedRows: expectedCalculatedRows,
          actualCalculatedRows: calculatedRows.length,
          publishIntents: publishIntents.length,
          statuses: calculatedRows.map(function (row) { return text_(row.stage_status); }).filter(function (value, index, values) {
            return values.indexOf(value) === index;
          })
        });
        assert_(AKORT.AggregateIntegration && typeof AKORT.AggregateIntegration.validateRecoveryStageSnapshot === 'function',
          'ALPHA74_GATE6_STAGE_VALIDATOR_UNAVAILABLE', 'Exact aggregate stage recovery validator is unavailable.', {});
        var aggregateCheckpoint = activeOperation.checkpoint.aggregate || {};
        var stageValidation = AKORT.AggregateIntegration.validateRecoveryStageSnapshot(calculatedRows, {
          operationId: activeOperationId,
          loadId: operationLoadId_(activeOperation),
          planId: text_(aggregateCheckpoint.planId),
          planFingerprint: text_(aggregateCheckpoint.planFingerprint)
        });
        assert_(stageValidation.complete === true && Number(stageValidation.rowCount || 0) === expectedCalculatedRows,
          'ALPHA74_GATE6_STAGE_SNAPSHOT_VALIDATION_INCOMPLETE', 'The recovered aggregate stage snapshot did not pass exact bounded validation.', {
            expectedRows: expectedCalculatedRows,
            actualRows: Number(stageValidation.rowCount || 0),
            complete: stageValidation.complete === true
          });
        monolithicStageRecovery = {
          boundary: stageRecoveryBoundary,
          rowCount: Number(stageValidation.rowCount || 0),
          seriesCount: Number(stageValidation.seriesCount || 0),
          stageFingerprint: text_(stageValidation.stageFingerprint),
          adoptedStageStatusAfterLostResponse: stageRecoveryBoundary === 'AFTER_STAGE_STATUS_WRITE_LOST_RESPONSE'
        };
      }
      assertNoForeignDataOperations_(state);
      var inspected = AKORT.ExistingSourceParsers.inspectFile(state.canarySource.fileId, {
        profileId: state.canarySource.profileId || '',
        year: state.canarySource.year || '',
        month: state.canarySource.month || '',
        week: state.canarySource.week || '',
        sourcePublishedAt: state.canarySource.sourcePublishedAt || ''
      });
      assert_(text_(inspected.sourceHash) === text_(state.canarySource.sourceHash),
        'ALPHA74_GATE6_RESUME_SOURCE_CHANGED', 'The Gate 6 source file changed after the checkpoint was stopped.', {
          expectedSourceHash: state.canarySource.sourceHash,
          actualSourceHash: inspected.sourceHash
        });
      var resumePhase = baselineIncident ? 'BASELINE_SCAN' : state.stoppedFromPhase;
      if (baselineIncident) {
        state.recovery = {
          mode: 'BASELINE_HEADER_CONTRACT_RECOVERY',
          recoveredFromRelease: state.release,
          recoveredFromExecutionId: state.executionId,
          recoveredAt: now_(),
          preservedRecoveryCopies: true,
          preservedCanarySource: true,
          physicalWritesBeforeRecovery: false
        };
        state.release = RELEASE;
        state.scan = newScan_('baseline');
        state.failedFromPhase = '';
      }
      if (monolithicStageIncident) {
        var stageRecoveryMode = monolithicStageRecovery.adoptedStageStatusAfterLostResponse ?
          'BOUNDED_STAGE_AFTER_STATE_RECOVERY' : 'BOUNDED_AGGREGATE_PHASE_CHECKPOINT_RECOVERY';
        state.recovery = {
          mode: stageRecoveryMode,
          recoveredFromRelease: state.release,
          recoveredFromExecutionId: state.executionId,
          recoveredAt: now_(),
          operationId: activeOperationId,
          loadId: operationLoadId_(activeOperation),
          resumeOperationPhase: 'STAGING_AGGREGATE_ROWS',
          preservedRecoveryCopies: true,
          preservedRawCommit: true,
          preservedPricePublish: true,
          preservedAggregateCalculationRows: Number(activeOperation.checkpoint.aggregate.calculationGroupCount || 0),
          repeatedRawCommit: false,
          repeatedPricePublish: false,
          repeatedAggregateCalculation: false,
          physicalAggregatePublishStarted: false,
          stageRecoveryBoundary: monolithicStageRecovery.boundary,
          validatedStageRows: monolithicStageRecovery.rowCount,
          validatedStageSeries: monolithicStageRecovery.seriesCount,
          validatedStageFingerprint: monolithicStageRecovery.stageFingerprint,
          adoptedStageStatusAfterLostResponse: monolithicStageRecovery.adoptedStageStatusAfterLostResponse,
          boundedWorkSchemaVersion: '4.0-aggregate-bounded-work-1',
          previousRecovery: clone_(state.recovery || null)
        };
        state.release = RELEASE;
      }
      if (['BASELINE_SCAN', 'ARM_CANARY'].indexOf(resumePhase) < 0) setRegularPipeline_(true);
      state.status = 'RUNNING';
      state.phase = resumePhase;
      state.finishedAt = '';
      state.leaseUntil = '';
      state.stoppedFromPhase = '';
      state.lastError = null;
      state.consecutiveErrors = 0;
      state.lastStep = {
        phase: 'RESUMED',
        resumePhase: resumePhase,
        resumedAt: now_(),
        recoveryMode: baselineIncident ? 'BASELINE_HEADER_CONTRACT_RECOVERY' :
          monolithicStageIncident ? state.recovery.mode : 'MANUAL_STOP_RESUME'
      };
      saveState_(state);
      writeValidation_('GATE 6 ВОЗОБНОВЛЁН', { executionId: state.executionId, phase: resumePhase });
      ensureTrigger_();
      return AKORT.Result.success('Alpha.7.4 Gate 6 resumed from its durable checkpoint.', publicState_(state));
    }, { lock: true, persistLogs: true, lockTimeoutMs: 60000 });
  }

  function claimWorker_() {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return null;
    try {
      var state = loadState_();
      if (!state || state.status !== 'RUNNING') return null;
      var lease = Date.parse(text_(state.leaseUntil));
      if (isFinite(lease) && lease > Date.now()) return null;
      state.leaseUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
      state.metrics.workerExecutions = Number(state.metrics.workerExecutions || 0) + 1;
      saveState_(state);
      return state;
    } finally {
      lock.releaseLock();
    }
  }

  function checkpointWorker_(state) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return false;
    try {
      var current = loadState_();
      if (!current || current.executionId !== state.executionId || current.status !== 'RUNNING') return false;
      state.leaseUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
      saveState_(state);
      return true;
    } finally {
      lock.releaseLock();
    }
  }

  function normalizedError_(caught) {
    var details = caught && caught.details || null;
    var detailsJson = stableStringify_(details);
    if (detailsJson.length > 1200) {
      details = {
        truncated: true,
        sha256: hash_(detailsJson),
        preview: detailsJson.slice(0, 1000)
      };
    }
    return {
      code: caught && caught.code || 'ALPHA74_GATE6_UNEXPECTED_ERROR',
      message: caught && caught.message || String(caught),
      details: details,
      stack: caught && caught.stack ? String(caught.stack).slice(0, 1500) : ''
    };
  }

  function failClosed_(state, caught) {
    var normalized = normalizedError_(caught);
    state.consecutiveErrors = Number(state.consecutiveErrors || 0) + 1;
    state.lastError = normalized;
    var retryable = normalized.details && normalized.details.retryable === true;
    if (retryable && state.consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
      state.lastStep = { phase: state.phase, retryScheduled: true, error: normalized };
      state.leaseUntil = '';
      saveState_(state);
      return AKORT.Result.paused('Gate 6 transient error saved; the persistent worker will retry.', publicState_(state));
    }
    try { setRegularPipeline_(false); } catch (ignoredRegular) {}
    try { setUserPipeline_(false); } catch (ignoredUser) {}
    deleteTriggers_();
    state.failedFromPhase = state.phase;
    state.status = 'FAILED';
    state.phase = 'FAILED';
    state.finishedAt = now_();
    state.leaseUntil = '';
    state.lastStep = { phase: 'FAILED', error: normalized };
    saveState_(state);
    try { writeValidation_('GATE 6 FAILED', { executionId: state.executionId, error: normalized }); } catch (ignoredValidation) {}
    return AKORT.Result.failure(normalized.code, 'Gate 6 failed closed. Regular and user pipelines were disabled; recovery copies were preserved.', publicState_(state));
  }

  function worker() {
    var state = claimWorker_();
    if (!state) return AKORT.Result.success('Gate 6 worker skipped: no runnable checkpoint or another worker owns the lease.', null);
    var started = Date.now();
    try {
      var steps = 0;
      while (state.status === 'RUNNING' && Date.now() - started < WORKER_BUDGET_MS && steps < MAX_WORKER_STEPS) {
        var result = processStep_(state);
        state.lastStep = clone_(result);
        state.metrics.steps = Number(state.metrics.steps || 0) + 1;
        state.consecutiveErrors = 0;
        steps += 1;
        if (state.status === 'SUCCESS') {
          saveState_(state);
          return AKORT.Result.success('Alpha.7.4 Gate 6 authoritative DEV canary passed.', publicState_(state));
        }
        if (!checkpointWorker_(state)) return AKORT.Result.paused('Gate 6 worker yielded because the checkpoint changed.', publicState_(state));
        if (result && (result.phase === 'ARM_CANARY' || result.phase === 'SUBMIT_CANARY' ||
          result.phase === 'RUN_CANARY' || result.phase === 'ENQUEUE_REVERSAL' ||
          result.phase === 'RUN_REVERSAL' || result.phase === 'ENQUEUE_RESTORE' ||
          result.phase === 'RUN_RESTORE')) break;
      }
      state.leaseUntil = '';
      saveState_(state);
      ensureTrigger_();
      return AKORT.Result.paused('Alpha.7.4 Gate 6 checkpoint saved; the persistent worker will continue automatically.', publicState_(state));
    } catch (caught) {
      return failClosed_(state, caught);
    }
  }

  function activeOperationId_(state) {
    if (!state || !state.operations) return '';
    if (state.phase.indexOf('CANARY') >= 0) return text_(state.operations.canary);
    if (state.phase.indexOf('REVERS') >= 0 || state.phase.indexOf('ROLLBACK') >= 0) return text_(state.operations.reversal);
    if (state.phase.indexOf('RESTORE') >= 0 || state.phase === 'FINAL_SCAN' || state.phase === 'FINAL_VALIDATION') return text_(state.operations.restore);
    return '';
  }

  function stop() {
    return AKORT.Core.safeRun('ALPHA74_GATE6_STOP', function () {
      AKORT.EnvironmentGuard.assertDev();
      var state = loadState_();
      var operationId = activeOperationId_(state);
      if (operationId) {
        try { AKORT.OperationEngine.requestStop(operationId); } catch (ignoredStop) {}
      }
      setRegularPipeline_(false);
      setUserPipeline_(false);
      var removed = deleteTriggers_();
      if (state && state.status === 'RUNNING') {
        state.stoppedFromPhase = state.phase;
        state.status = 'STOPPED';
        state.phase = 'STOPPED';
        state.finishedAt = now_();
        state.leaseUntil = '';
        state.lastStep = { phase: 'STOPPED', operationStopRequested: !!operationId };
        saveState_(state);
      }
      try { writeValidation_('GATE 6 ОСТАНОВЛЕН', { executionId: state && state.executionId || '', phase: state && state.stoppedFromPhase || '' }); } catch (ignoredValidation) {}
      return AKORT.Result.success('Alpha.7.4 Gate 6 stopped fail-closed. Recovery copies were preserved.', {
        triggersRemoved: removed,
        operationStopRequested: operationId,
        state: publicState_(state)
      });
    }, { lock: false, persistLogs: true });
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    EvidenceSchemaVersion: EVIDENCE_SCHEMA,
    StateSchemaVersion: STATE_SCHEMA,
    ControlSheetName: CONTROL_SHEET,
    TargetSheets: TARGETS.slice(),
    install: install,
    validate: validate,
    status: status,
    start: start,
    resume: resume,
    recoverRuntimeContextIncident: recoverRuntimeContextIncident,
    worker: worker,
    stop: stop,
    Test: Object.freeze({
      stable: stable_,
      hash: hash_,
      parseFileId: parseFileId_,
      canonicalCell: canonicalCell_,
      addRowsToDigest: addRowsToDigest_,
      digestValue: digestValue_,
      expectedHeaders: expectedHeaders_,
      baselineHeaderIncident: baselineHeaderIncident_,
      runtimeContextIncident: runtimeContextIncident_,
      monolithicStageIncident: monolithicStageIncident_,
      stageRecoveryBoundary: stageRecoveryBoundary_,
      normalizedJsonSetting: normalizedJsonSetting_,
      compareDigests: compareDigests_,
      changedTargets: changedTargets_,
      operationSummary: operationSummary_
    })
  });
})();
