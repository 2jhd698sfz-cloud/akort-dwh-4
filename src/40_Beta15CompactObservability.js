var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.5 r2: compact materialized observability read models.
 * Refresh reads bounded tails of accepted service registries only. Compact
 * status reads DATASET_STATUS and ISSUE_REGISTRY only.
 */
AKORT.Beta15CompactObservability = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.5.2';
  var CONTRACT_VERSION = '4.0-beta15-compact-observability-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = 'dfe0733432a2cf978ccecaac6b753019a1331a9e';
  var INVENTORY_PACKAGE = '4.0.0-beta.1.5.1';
  var MAX_TAIL_ROWS = 25;
  var MAX_DATASET_ROWS = 16;
  var MAX_ISSUE_ROWS = 250;
  var TARGET_DATASET_STATUS = 'DATASET_STATUS';
  var TARGET_ISSUE_REGISTRY = 'ISSUE_REGISTRY';

  var DATASET_HEADERS = [
    'dataset_id', 'dataset_label', 'source_table', 'source_status',
    'health_status', 'freshness_status', 'latest_activity_at',
    'age_minutes', 'freshness_threshold_minutes', 'latest_record_key',
    'latest_period', 'latest_load_id', 'active_operation_id',
    'active_phase', 'progress_percent', 'checkpoint_cursor',
    'latest_backup_id', 'trigger_status', 'issue_count', 'next_action',
    'observed_at', 'snapshot_fingerprint', 'release_version'
  ];

  var ISSUE_HEADERS = [
    'issue_key', 'source_table', 'source_record_key', 'dataset_id',
    'operation_id', 'severity', 'issue_code', 'lifecycle_status',
    'source_status', 'first_seen_at', 'last_seen_at', 'occurrence_count',
    'summary', 'details_json', 'resolution', 'next_action',
    'observed_at', 'snapshot_fingerprint', 'release_version'
  ];

  var FRESHNESS_POLICIES = [
    {
      datasetId: 'SYSTEM_RELEASE',
      datasetLabel: 'System release',
      sourceTable: 'RELEASE_REGISTRY',
      thresholdMinutes: 0,
      allowEmpty: false
    },
    {
      datasetId: 'OPERATIONS',
      datasetLabel: 'Operation engine',
      sourceTable: 'OPERATION_QUEUE',
      thresholdMinutes: 0,
      allowEmpty: true
    },
    {
      datasetId: 'RAW_LOADS',
      datasetLabel: 'RAW load registry',
      sourceTable: 'RAW_LOAD_REGISTRY',
      thresholdMinutes: 20160,
      allowEmpty: false
    },
    {
      datasetId: 'PUBLISH_RUNS',
      datasetLabel: 'Publish runs',
      sourceTable: 'PUBLISH_RUNS',
      thresholdMinutes: 20160,
      allowEmpty: false
    },
    {
      datasetId: 'RECONCILIATION',
      datasetLabel: 'Publish reconciliation',
      sourceTable: 'PUBLISH_RECONCILIATION',
      thresholdMinutes: 20160,
      allowEmpty: false
    },
    {
      datasetId: 'PARSER_QUALITY',
      datasetLabel: 'Parser quality',
      sourceTable: 'PARSER_ISSUES',
      thresholdMinutes: 0,
      allowEmpty: true
    },
    {
      datasetId: 'BACKUPS',
      datasetLabel: 'Paired backups',
      sourceTable: 'BACKUP_REGISTRY',
      thresholdMinutes: 2160,
      allowEmpty: false
    },
    {
      datasetId: 'TRIGGERS',
      datasetLabel: 'Trigger ownership',
      sourceTable: 'TRIGGER_OWNERSHIP_REGISTRY',
      thresholdMinutes: 10080,
      allowEmpty: false
    }
  ];

  var NON_TERMINAL = {
    QUEUED: true,
    RUNNING: true,
    PAUSED: true,
    RETRY_PENDING: true
  };

  var SUCCESS_STATES = {
    RELEASE_REGISTRY: { INSTALLED: true },
    RAW_LOAD_REGISTRY: { COMMITTED: true, REVERSED: true },
    PUBLISH_RUNS: { SUCCESS: true, NO_AGGREGATE_IMPACT: true },
    PUBLISH_RECONCILIATION: { PASS: true, SUCCESS: true },
    BACKUP_REGISTRY: { SUCCESS: true },
    TRIGGER_OWNERSHIP_REGISTRY: { OK: true }
  };

  var NEXT_ACTIONS = [
    'NONE',
    'RUN_OBSERVABILITY_REFRESH',
    'REFRESH_SOURCE_DATA',
    'REVIEW_ISSUES',
    'REVIEW_SOURCE_SCHEMA',
    'REVIEW_BACKUP',
    'REVIEW_TRIGGER_OWNER',
    'RUN_FROM_QUEUE',
    'WAIT_ACTIVE_LEASE',
    'RESUME_FROM_CHECKPOINT',
    'RETRY_FROM_CHECKPOINT',
    'REVIEW_STOPPED_CHECKPOINT',
    'REVIEW_FAILED_OPERATION',
    'MANUAL_REVIEW',
    'REVIEW_DEAD_LETTER',
    'REVIEW_UNKNOWN_STATUS'
  ];

  var ISSUE_LIFECYCLES = [
    'OPEN',
    'RETRYING',
    'REVIEW',
    'OBSERVED'
  ];

  function clone_(value) {
    return JSON.parse(JSON.stringify(
      value === undefined ? null : value
    ));
  }

  function text_(value) {
    return value === null || value === undefined
      ? ''
      : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      String(value || '').toUpperCase() === 'TRUE';
  }

  function iso_(value) {
    if (!value && value !== 0) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? '' : value.toISOString();
    }
    var parsed = Date.parse(String(value));
    return isNaN(parsed) ? '' : new Date(parsed).toISOString();
  }

  function dateMs_(value) {
    var normalized = iso_(value);
    return normalized ? Date.parse(normalized) : 0;
  }

  function ageMinutes_(value, nowMs) {
    var parsed = dateMs_(value);
    return parsed
      ? Math.max(0, Math.floor((nowMs - parsed) / 60000))
      : null;
  }

  function freshness_(latestActivityAt, thresholdMinutes, nowMs) {
    var threshold = Number(thresholdMinutes || 0);
    if (threshold <= 0) {
      return {
        status: 'NOT_APPLICABLE',
        ageMinutes: latestActivityAt
          ? ageMinutes_(latestActivityAt, nowMs)
          : null,
        thresholdMinutes: 0
      };
    }
    if (!latestActivityAt) {
      return {
        status: 'UNKNOWN',
        ageMinutes: null,
        thresholdMinutes: threshold
      };
    }
    var age = ageMinutes_(latestActivityAt, nowMs);
    return {
      status: age !== null && age <= threshold ? 'CURRENT' : 'STALE',
      ageMinutes: age,
      thresholdMinutes: threshold
    };
  }

  function sourceDefinitions_() {
    var module = AKORT.Beta15ObservabilityInventory;
    if (!module ||
        module.PackageVersion !== INVENTORY_PACKAGE ||
        !Array.isArray(module.SourceTables)) {
      throw AKORT.Core.error(
        'BETA15_INVENTORY_CONTRACT_MISSING',
        'Accepted Beta.1.5 observability inventory is unavailable.',
        { retryable: false }
      );
    }
    return clone_(module.SourceTables);
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA15_BASE_RELEASE_MISMATCH',
        'Beta.1.5 compact observability requires the accepted runtime.',
        {
          expected: BASE_RELEASE,
          actual: AKORT.Release.version,
          retryable: false
        }
      );
    }
    var settings = AKORT.Config.readSystemSettings();
    if (truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
      throw AKORT.Core.error(
        'BETA15_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Beta.1.5 cannot run after the general user pipeline is enabled.',
        { retryable: false }
      );
    }
    sourceDefinitions_();
    if (!AKORT.Beta14OperationalHardening ||
        typeof AKORT.Beta14OperationalHardening.classifyOperation !==
          'function') {
      throw AKORT.Core.error(
        'BETA15_OPERATION_WATCHDOG_MISSING',
        'Accepted Beta.1.4 operation classifier is unavailable.',
        { retryable: false }
      );
    }
  }

  function assertRuntimeMemory_() {
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA15_BASE_RELEASE_MISMATCH',
        'Compact status is not compatible with this runtime.',
        {
          expected: BASE_RELEASE,
          actual: AKORT.Release.version,
          retryable: false
        }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function headersEqual_(actual, expected) {
    return JSON.stringify((actual || []).map(String)) ===
      JSON.stringify((expected || []).map(String));
  }

  function inspectTable_(spreadsheet, name, expectedHeaders) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      return {
        name: name,
        status: 'ABSENT',
        schemaMatches: false,
        rows: 0,
        columns: 0,
        actualHeaders: [],
        expectedHeaders: expectedHeaders.slice(),
        sheet: null
      };
    }
    var columns = Math.max(1, sheet.getLastColumn());
    var actual = sheet.getRange(1, 1, 1, columns)
      .getValues()[0].map(String);
    return {
      name: name,
      status: 'PRESENT',
      schemaMatches: headersEqual_(actual, expectedHeaders),
      rows: Math.max(0, sheet.getLastRow() - 1),
      columns: sheet.getLastColumn(),
      actualHeaders: actual,
      expectedHeaders: expectedHeaders.slice(),
      sheet: sheet
    };
  }

  function requireTable_(spreadsheet, name, expectedHeaders) {
    var inspection = inspectTable_(
      spreadsheet,
      name,
      expectedHeaders
    );
    if (inspection.status !== 'PRESENT') {
      throw AKORT.Core.error(
        'BETA15_REQUIRED_TABLE_MISSING',
        'Required observability table is missing.',
        { table: name, retryable: false }
      );
    }
    if (!inspection.schemaMatches) {
      throw AKORT.Core.error(
        'BETA15_SERVICE_SCHEMA_MISMATCH',
        'Service-table schema differs from the accepted contract.',
        {
          table: name,
          expected: expectedHeaders,
          actual: inspection.actualHeaders,
          retryable: false
        }
      );
    }
    return inspection.sheet;
  }

  function rowsFromValues_(headers, values, startRow) {
    return (values || []).map(function (valuesRow, index) {
      var row = { __row: startRow + index };
      headers.forEach(function (header, column) {
        row[header] = valuesRow[column];
      });
      return row;
    });
  }

  function readTail_(spreadsheet, definition) {
    var inspection = inspectTable_(
      spreadsheet,
      definition.name,
      definition.headers
    );
    if (inspection.status !== 'PRESENT' ||
        !inspection.schemaMatches) {
      throw AKORT.Core.error(
        'BETA15_SOURCE_REGISTRY_INVALID',
        'Authoritative observability source is unavailable.',
        {
          table: definition.name,
          status: inspection.status,
          schemaMatches: inspection.schemaMatches,
          retryable: false
        }
      );
    }
    var count = Math.min(MAX_TAIL_ROWS, inspection.rows);
    if (!count) {
      return {
        name: definition.name,
        owner: definition.owner,
        totalRows: inspection.rows,
        rowsRead: 0,
        truncated: false,
        rows: [],
        definition: clone_(definition)
      };
    }
    var startRow = inspection.sheet.getLastRow() - count + 1;
    var values = inspection.sheet.getRange(
      startRow,
      1,
      count,
      definition.headers.length
    ).getValues();
    return {
      name: definition.name,
      owner: definition.owner,
      totalRows: inspection.rows,
      rowsRead: count,
      truncated: inspection.rows > count,
      rows: rowsFromValues_(
        definition.headers,
        values,
        startRow
      ),
      definition: clone_(definition)
    };
  }

  function readSources_(spreadsheet) {
    var byName = {};
    sourceDefinitions_().forEach(function (definition) {
      byName[definition.name] = readTail_(
        spreadsheet,
        definition
      );
    });
    return byName;
  }

  function rowTimestamp_(row, fields) {
    var best = '';
    var bestMs = 0;
    (fields || []).forEach(function (field) {
      var normalized = iso_(row && row[field]);
      var parsed = dateMs_(normalized);
      if (parsed > bestMs) {
        best = normalized;
        bestMs = parsed;
      }
    });
    return best;
  }

  function latestRow_(rows, fields) {
    var latest = null;
    var latestMs = -1;
    var latestRowNo = -1;
    (rows || []).forEach(function (row) {
      var parsed = dateMs_(rowTimestamp_(row, fields));
      var rowNo = Number(row.__row || 0);
      if (!latest ||
          parsed > latestMs ||
          (parsed === latestMs && rowNo > latestRowNo)) {
        latest = row;
        latestMs = parsed;
        latestRowNo = rowNo;
      }
    });
    return latest;
  }

  function latestBy_(rows, field, timeFields) {
    var latest = {};
    (rows || []).forEach(function (row) {
      var key = text_(row[field]) || '__EMPTY__';
      var current = latest[key];
      var candidateMs = dateMs_(rowTimestamp_(row, timeFields));
      var currentMs = current
        ? dateMs_(rowTimestamp_(current, timeFields))
        : -1;
      if (!current ||
          candidateMs > currentMs ||
          (candidateMs === currentMs &&
           Number(row.__row || 0) > Number(current.__row || 0))) {
        latest[key] = row;
      }
    });
    return Object.keys(latest).sort().map(function (key) {
      return latest[key];
    });
  }

  function isControlTest_(operationType) {
    var type = text_(operationType);
    return type.indexOf('ALPHA3_TEST_') === 0 ||
      type.indexOf('ALPHA3_DEMO_') === 0 ||
      type.indexOf('BETA13_') >= 0;
  }

  function compactRecordKey_(sourceTable, row) {
    var fields = {
      RELEASE_REGISTRY: ['release_id', 'version'],
      OPERATION_QUEUE: ['operation_id', 'operation_type'],
      SYSTEM_LOG: ['log_id', 'event_code'],
      RAW_LOAD_REGISTRY: ['load_id', 'target_table'],
      PUBLISH_RUNS: ['publish_run_id', 'load_id'],
      PUBLISH_RECONCILIATION: [
        'reconciliation_id',
        'sheet_name'
      ],
      PARSER_ISSUES: ['issue_id', 'issue_code'],
      BACKUP_REGISTRY: ['backup_id', 'operation_id'],
      TRIGGER_OWNERSHIP_REGISTRY: ['process_id', 'handler']
    }[sourceTable] || [];
    return fields.map(function (field) {
      return field + '=' + text_(row && row[field]);
    }).join('|');
  }

  function parseJson_(value) {
    if (value && typeof value === 'object') return clone_(value);
    if (value === '' || value === null || value === undefined) {
      return {};
    }
    try {
      return JSON.parse(String(value));
    } catch (ignored) {
      return { __invalid: true };
    }
  }

  function checkpointCursor_(row) {
    var checkpoint = parseJson_(row && row.checkpoint_json);
    if (checkpoint.__invalid) return 'INVALID_CHECKPOINT';
    if (checkpoint.control &&
        checkpoint.control.stopRequested === true) {
      return 'STOP_REQUESTED';
    }
    return text_(
      checkpoint.nextPhase ||
      checkpoint.currentPhase ||
      checkpoint.phase
    );
  }

  function phaseProgress_(phase) {
    var manifest = AKORT.Release.manifest();
    var phases = manifest && manifest.operationPhases || [];
    var index = phases.indexOf(text_(phase));
    if (index < 0 || phases.length < 2) return '';
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((index / (phases.length - 1)) * 100)
      )
    );
  }

  function normalizeSeverity_(value, fallback) {
    var severity = text_(value || fallback).toUpperCase();
    if (severity === 'CRITICAL' || severity === 'FATAL') {
      return 'CRITICAL';
    }
    if (severity === 'ERROR' || severity === 'FAIL') {
      return 'ERROR';
    }
    if (severity === 'WARN' || severity === 'WARNING') {
      return 'WARNING';
    }
    return 'INFO';
  }

  function severityRank_(severity) {
    return {
      INFO: 1,
      WARNING: 2,
      ERROR: 3,
      CRITICAL: 4
    }[normalizeSeverity_(severity)] || 1;
  }

  function issueIdentity_(sourceTable, sourceRecordKey, issueCode) {
    return 'ISS_' + AKORT.Core.sha256([
      sourceTable,
      sourceRecordKey,
      issueCode
    ].join('|')).slice(0, 28).toUpperCase();
  }

  function addIssue_(map, issue) {
    var key = issueIdentity_(
      issue.sourceTable,
      issue.sourceRecordKey,
      issue.issueCode
    );
    var firstSeen = iso_(issue.firstSeenAt || issue.lastSeenAt);
    var lastSeen = iso_(issue.lastSeenAt || issue.firstSeenAt);
    var existing = map[key];
    if (!existing) {
      map[key] = {
        issue_key: key,
        source_table: issue.sourceTable,
        source_record_key: issue.sourceRecordKey,
        dataset_id: issue.datasetId,
        operation_id: text_(issue.operationId),
        severity: normalizeSeverity_(issue.severity),
        issue_code: issue.issueCode,
        lifecycle_status: issue.lifecycleStatus || 'OPEN',
        source_status: text_(issue.sourceStatus),
        first_seen_at: firstSeen,
        last_seen_at: lastSeen,
        occurrence_count: 1,
        summary: text_(issue.summary),
        details_json: AKORT.Core.safeJson(issue.details || {}),
        resolution: text_(issue.resolution),
        next_action: text_(issue.nextAction || 'REVIEW_ISSUES')
      };
      return;
    }
    existing.occurrence_count += 1;
    if (firstSeen &&
        (!existing.first_seen_at ||
         dateMs_(firstSeen) < dateMs_(existing.first_seen_at))) {
      existing.first_seen_at = firstSeen;
    }
    if (lastSeen &&
        dateMs_(lastSeen) > dateMs_(existing.last_seen_at)) {
      existing.last_seen_at = lastSeen;
    }
    if (severityRank_(issue.severity) >
        severityRank_(existing.severity)) {
      existing.severity = normalizeSeverity_(issue.severity);
    }
  }

  function buildIssues_(sources, nowMs) {
    var issues = {};

    var operations = (sources.OPERATION_QUEUE.rows || [])
      .filter(function (row) {
        return !isControlTest_(row.operation_type);
      });
    latestBy_(
      operations,
      'operation_type',
      ['finished_at', 'started_at', 'requested_at']
    ).forEach(function (row) {
      var classified =
        AKORT.Beta14OperationalHardening.classifyOperation(
          row,
          nowMs
        );
      var status = text_(row.status);
      var report = status === 'FAILED' ||
        status === 'FAILED_REQUIRES_REVIEW' ||
        status === 'DEAD_LETTER' ||
        classified.stale === true ||
        classified.checkpointInvalid === true;
      if (!report) return;
      addIssue_(issues, {
        sourceTable: 'OPERATION_QUEUE',
        sourceRecordKey: compactRecordKey_(
          'OPERATION_QUEUE',
          row
        ),
        datasetId: 'OPERATIONS',
        operationId: row.operation_id,
        severity:
          status === 'DEAD_LETTER' ||
          status === 'FAILED_REQUIRES_REVIEW' ||
          classified.checkpointInvalid
            ? 'ERROR'
            : 'WARNING',
        issueCode: classified.classification,
        lifecycleStatus:
          status === 'DEAD_LETTER' ||
          status === 'FAILED_REQUIRES_REVIEW'
            ? 'REVIEW'
            : status === 'RETRY_PENDING'
              ? 'RETRYING'
              : 'OPEN',
        sourceStatus: status,
        firstSeenAt: row.started_at || row.requested_at,
        lastSeenAt:
          row.finished_at || row.started_at || row.requested_at,
        summary: 'Operation requires attention.',
        details: {
          operationType: row.operation_type,
          phase: row.current_phase,
          ageMinutes: classified.ageMinutes,
          checkpointCursor: checkpointCursor_(row)
        },
        nextAction: classified.nextAction
      });
    });

    (sources.SYSTEM_LOG.rows || []).forEach(function (row) {
      if (text_(row.level).toUpperCase() !== 'ERROR') return;
      if (text_(row.component).indexOf('BETA13') >= 0) return;
      addIssue_(issues, {
        sourceTable: 'SYSTEM_LOG',
        sourceRecordKey: compactRecordKey_('SYSTEM_LOG', row),
        datasetId: 'OPERATIONS',
        operationId: row.operation_id,
        severity: 'ERROR',
        issueCode: text_(row.event_code) || 'SYSTEM_ERROR',
        lifecycleStatus: 'OBSERVED',
        sourceStatus: row.level,
        firstSeenAt: row.logged_at,
        lastSeenAt: row.logged_at,
        summary: text_(row.message) || 'System error logged.',
        details: {
          component: text_(row.component),
          executionId: text_(row.execution_id)
        },
        nextAction: 'REVIEW_ISSUES'
      });
    });

    var rawLatest = latestBy_(
      sources.RAW_LOAD_REGISTRY.rows || [],
      'target_table',
      ['finished_at', 'started_at']
    );
    rawLatest.forEach(function (row) {
      var status = text_(row.status);
      if (SUCCESS_STATES.RAW_LOAD_REGISTRY[status] &&
          !text_(row.error_code)) return;
      addIssue_(issues, {
        sourceTable: 'RAW_LOAD_REGISTRY',
        sourceRecordKey: compactRecordKey_(
          'RAW_LOAD_REGISTRY',
          row
        ),
        datasetId: 'RAW_LOADS',
        operationId: row.operation_id,
        severity: 'ERROR',
        issueCode: text_(row.error_code) ||
          ('RAW_LOAD_' + (status || 'UNKNOWN')),
        lifecycleStatus: 'OPEN',
        sourceStatus: status,
        firstSeenAt: row.started_at,
        lastSeenAt: row.finished_at || row.started_at,
        summary: 'Latest RAW load state requires attention.',
        details: {
          targetTable: text_(row.target_table),
          loadId: text_(row.load_id)
        },
        nextAction: 'REVIEW_ISSUES'
      });
    });

    var publishLatest = latestRow_(
      sources.PUBLISH_RUNS.rows || [],
      ['finished_at', 'started_at']
    );
    if (publishLatest) {
      var publishStatus = text_(publishLatest.status);
      var publishAge = ageMinutes_(
        rowTimestamp_(
          publishLatest,
          ['finished_at', 'started_at']
        ),
        nowMs
      );
      var publishGood =
        SUCCESS_STATES.PUBLISH_RUNS[publishStatus] ||
        (publishStatus === 'FINALIZING' &&
         publishAge !== null &&
         publishAge <= 60);
      if (!publishGood || text_(publishLatest.error_code)) {
        addIssue_(issues, {
          sourceTable: 'PUBLISH_RUNS',
          sourceRecordKey: compactRecordKey_(
            'PUBLISH_RUNS',
            publishLatest
          ),
          datasetId: 'PUBLISH_RUNS',
          operationId: publishLatest.operation_id,
          severity:
            publishStatus === 'FINALIZING'
              ? 'WARNING'
              : 'ERROR',
          issueCode: text_(publishLatest.error_code) ||
            ('PUBLISH_' + (publishStatus || 'UNKNOWN')),
          lifecycleStatus:
            publishStatus === 'FINALIZING'
              ? 'RETRYING'
              : 'OPEN',
          sourceStatus: publishStatus,
          firstSeenAt: publishLatest.started_at,
          lastSeenAt:
            publishLatest.finished_at ||
            publishLatest.started_at,
          summary: 'Latest Publish run requires attention.',
          details: {
            publishRunId: text_(publishLatest.publish_run_id),
            loadId: text_(publishLatest.load_id),
            ageMinutes: publishAge
          },
          nextAction:
            publishStatus === 'FINALIZING'
              ? 'RETRY_FROM_CHECKPOINT'
              : 'REVIEW_ISSUES'
        });
      }
    }

    latestBy_(
      sources.PUBLISH_RECONCILIATION.rows || [],
      'sheet_name',
      ['checked_at']
    ).forEach(function (row) {
      var status = text_(row.status);
      if (SUCCESS_STATES.PUBLISH_RECONCILIATION[status]) return;
      addIssue_(issues, {
        sourceTable: 'PUBLISH_RECONCILIATION',
        sourceRecordKey: compactRecordKey_(
          'PUBLISH_RECONCILIATION',
          row
        ),
        datasetId: 'RECONCILIATION',
        severity: 'ERROR',
        issueCode: 'RECONCILIATION_' + (status || 'UNKNOWN'),
        lifecycleStatus: 'OPEN',
        sourceStatus: status,
        firstSeenAt: row.checked_at,
        lastSeenAt: row.checked_at,
        summary: 'Latest reconciliation state is not successful.',
        details: {
          sheetName: text_(row.sheet_name),
          reconciliationId: text_(row.reconciliation_id)
        },
        nextAction: 'REVIEW_ISSUES'
      });
    });

    (sources.PARSER_ISSUES.rows || []).forEach(function (row) {
      var status = text_(row.status).toUpperCase();
      if (status === 'RESOLVED' ||
          status === 'CLOSED' ||
          status === 'IGNORED') return;
      addIssue_(issues, {
        sourceTable: 'PARSER_ISSUES',
        sourceRecordKey: compactRecordKey_(
          'PARSER_ISSUES',
          row
        ),
        datasetId: 'PARSER_QUALITY',
        operationId: row.operation_id,
        severity: normalizeSeverity_(row.severity, 'WARNING'),
        issueCode: text_(row.issue_code) || 'PARSER_ISSUE',
        lifecycleStatus: 'OPEN',
        sourceStatus: status || 'OPEN',
        firstSeenAt: row.created_at,
        lastSeenAt: row.created_at,
        summary: 'Parser issue remains unresolved.',
        details: {
          profileId: text_(row.profile_id),
          sourceFileId: text_(row.source_file_id),
          sourceLabel: text_(row.source_label)
        },
        nextAction: 'REVIEW_ISSUES'
      });
    });

    var backupLatest = latestRow_(
      sources.BACKUP_REGISTRY.rows || [],
      ['finished_at', 'started_at']
    );
    if (backupLatest &&
        (text_(backupLatest.status) !== 'SUCCESS' ||
         text_(backupLatest.error_code))) {
      addIssue_(issues, {
        sourceTable: 'BACKUP_REGISTRY',
        sourceRecordKey: compactRecordKey_(
          'BACKUP_REGISTRY',
          backupLatest
        ),
        datasetId: 'BACKUPS',
        operationId: backupLatest.operation_id,
        severity:
          text_(backupLatest.status) === 'PARTIAL'
            ? 'WARNING'
            : 'ERROR',
        issueCode: text_(backupLatest.error_code) ||
          ('BACKUP_' +
           (text_(backupLatest.status) || 'UNKNOWN')),
        lifecycleStatus:
          text_(backupLatest.status) === 'PARTIAL'
            ? 'RETRYING'
            : 'OPEN',
        sourceStatus: backupLatest.status,
        firstSeenAt: backupLatest.started_at,
        lastSeenAt:
          backupLatest.finished_at ||
          backupLatest.started_at,
        summary: 'Latest paired backup requires attention.',
        details: {
          backupId: text_(backupLatest.backup_id),
          scheduledDate: text_(backupLatest.scheduled_date)
        },
        nextAction: 'REVIEW_BACKUP'
      });
    }

    (sources.TRIGGER_OWNERSHIP_REGISTRY.rows || [])
      .forEach(function (row) {
        if (text_(row.status) === 'OK') return;
        addIssue_(issues, {
          sourceTable: 'TRIGGER_OWNERSHIP_REGISTRY',
          sourceRecordKey: compactRecordKey_(
            'TRIGGER_OWNERSHIP_REGISTRY',
            row
          ),
          datasetId: 'TRIGGERS',
          severity: 'ERROR',
          issueCode: text_(row.status) ||
            'TRIGGER_OWNERSHIP_UNKNOWN',
          lifecycleStatus: 'OPEN',
          sourceStatus: row.status,
          firstSeenAt: row.observed_at,
          lastSeenAt: row.observed_at,
          summary: 'Trigger ownership requires attention.',
          details: {
            processId: text_(row.process_id),
            handler: text_(row.handler),
            observedCount: Number(row.observed_count || 0)
          },
          nextAction:
            text_(row.next_action) ||
            'REVIEW_TRIGGER_OWNER'
        });
      });

    var rows = Object.keys(issues).sort().map(function (key) {
      return issues[key];
    });
    if (rows.length > MAX_ISSUE_ROWS) {
      throw AKORT.Core.error(
        'BETA15_ISSUE_PROJECTION_LIMIT_EXCEEDED',
        'Normalized issue projection exceeds its frozen bound.',
        {
          maximum: MAX_ISSUE_ROWS,
          actual: rows.length,
          retryable: false
        }
      );
    }
    return rows;
  }

  function sourceStatus_(policy, source, nowMs) {
    var rows = source.rows || [];
    var latest = null;
    var status = '';
    var active = null;

    if (policy.datasetId === 'OPERATIONS') {
      rows = rows.filter(function (row) {
        return !isControlTest_(row.operation_type);
      });
      active = latestRow_(
        rows.filter(function (row) {
          return NON_TERMINAL[text_(row.status)] === true;
        }),
        ['started_at', 'requested_at']
      );
      latest = active || latestRow_(
        rows,
        ['finished_at', 'started_at', 'requested_at']
      );
      status = active
        ? text_(active.status)
        : latest
          ? text_(latest.status)
          : 'IDLE';
    } else if (policy.datasetId === 'RECONCILIATION') {
      var current = latestBy_(
        rows,
        'sheet_name',
        ['checked_at']
      );
      latest = latestRow_(current, ['checked_at']);
      var failures = current.filter(function (row) {
        return !SUCCESS_STATES.PUBLISH_RECONCILIATION[
          text_(row.status)
        ];
      });
      status = failures.length
        ? 'ATTENTION_REQUIRED'
        : current.length
          ? 'SUCCESS'
          : 'EMPTY';
    } else if (policy.datasetId === 'PARSER_QUALITY') {
      var open = rows.filter(function (row) {
        var rowStatus = text_(row.status).toUpperCase();
        return rowStatus !== 'RESOLVED' &&
          rowStatus !== 'CLOSED' &&
          rowStatus !== 'IGNORED';
      });
      latest = latestRow_(rows, ['created_at']);
      status = open.length ? 'ISSUES_PRESENT' : 'NO_ISSUES';
    } else if (policy.datasetId === 'TRIGGERS') {
      latest = latestRow_(rows, ['observed_at']);
      status = rows.every(function (row) {
        return text_(row.status) === 'OK';
      }) && rows.length
        ? 'OK'
        : rows.length
          ? 'ATTENTION_REQUIRED'
          : 'EMPTY';
    } else {
      latest = latestRow_(
        rows,
        source.definition.timeFields
      );
      status = latest
        ? text_(latest[source.definition.statusField])
        : 'EMPTY';
    }

    var activity = latest
      ? rowTimestamp_(latest, source.definition.timeFields)
      : '';
    var freshness = freshness_(
      activity,
      policy.thresholdMinutes,
      nowMs
    );
    var health = 'HEALTHY';
    var nextAction = 'NONE';

    if (!rows.length) {
      health = policy.allowEmpty ? 'HEALTHY' : 'UNKNOWN';
      nextAction = policy.allowEmpty
        ? 'NONE'
        : 'REVIEW_ISSUES';
    } else if (policy.datasetId === 'OPERATIONS') {
      if (active) {
        var classified =
          AKORT.Beta14OperationalHardening.classifyOperation(
            active,
            nowMs
          );
        health = classified.stale ? 'WARNING' : 'ACTIVE';
        nextAction = classified.nextAction;
      } else if (status === 'FAILED' ||
                 status === 'FAILED_REQUIRES_REVIEW' ||
                 status === 'DEAD_LETTER') {
        health = 'ERROR';
        nextAction = 'REVIEW_ISSUES';
      }
    } else if (policy.datasetId === 'PUBLISH_RUNS') {
      var publishAge = ageMinutes_(activity, nowMs);
      if (status === 'FINALIZING' &&
          publishAge !== null &&
          publishAge <= 60) {
        health = 'ACTIVE';
        nextAction = 'WAIT_ACTIVE_LEASE';
      } else if (status === 'FINALIZING') {
        health = 'WARNING';
        nextAction = 'RETRY_FROM_CHECKPOINT';
      } else if (!SUCCESS_STATES.PUBLISH_RUNS[status]) {
        health = status === 'EMPTY' ? 'UNKNOWN' : 'ERROR';
        nextAction = 'REVIEW_ISSUES';
      }
    } else if (policy.datasetId === 'PARSER_QUALITY') {
      if (status === 'ISSUES_PRESENT') {
        health = 'WARNING';
        nextAction = 'REVIEW_ISSUES';
      }
    } else if (policy.datasetId === 'RECONCILIATION') {
      if (status !== 'SUCCESS') {
        health = status === 'EMPTY' ? 'UNKNOWN' : 'ERROR';
        nextAction = 'REVIEW_ISSUES';
      }
    } else if (policy.datasetId === 'TRIGGERS') {
      if (status !== 'OK') {
        health = status === 'EMPTY' ? 'UNKNOWN' : 'ERROR';
        nextAction = 'REVIEW_TRIGGER_OWNER';
      }
    } else {
      var accepted = SUCCESS_STATES[policy.sourceTable] || {};
      if (!accepted[status]) {
        health = status === 'EMPTY' ? 'UNKNOWN' : 'ERROR';
        nextAction = policy.datasetId === 'BACKUPS'
          ? 'REVIEW_BACKUP'
          : 'REVIEW_ISSUES';
      }
    }

    if (freshness.status === 'STALE' &&
        health !== 'ERROR') {
      health = 'WARNING';
      nextAction = 'REFRESH_SOURCE_DATA';
    }

    return {
      latest: latest,
      active: active,
      sourceStatus: status,
      healthStatus: health,
      nextAction: nextAction,
      activity: activity,
      freshness: freshness
    };
  }

  function buildDatasetRows_(sources, issues, nowMs) {
    var issueCounts = {};
    var worstSeverity = {};
    (issues || []).forEach(function (issue) {
      issueCounts[issue.dataset_id] =
        Number(issueCounts[issue.dataset_id] || 0) + 1;
      if (!worstSeverity[issue.dataset_id] ||
          severityRank_(issue.severity) >
            severityRank_(worstSeverity[issue.dataset_id])) {
        worstSeverity[issue.dataset_id] = issue.severity;
      }
    });

    var rows = FRESHNESS_POLICIES.map(function (policy) {
      var source = sources[policy.sourceTable];
      var state = sourceStatus_(policy, source, nowMs);
      var latest = state.latest || {};
      var active = state.active || {};
      var health = state.healthStatus;
      var nextAction = state.nextAction;
      var count = Number(issueCounts[policy.datasetId] || 0);
      var severity = worstSeverity[policy.datasetId] || '';

      if (severityRank_(severity) >= severityRank_('ERROR')) {
        health = 'ERROR';
        nextAction = 'REVIEW_ISSUES';
      } else if (count && health !== 'ERROR') {
        health = 'WARNING';
        nextAction = nextAction === 'NONE'
          ? 'REVIEW_ISSUES'
          : nextAction;
      }

      return {
        dataset_id: policy.datasetId,
        dataset_label: policy.datasetLabel,
        source_table: policy.sourceTable,
        source_status: state.sourceStatus,
        health_status: health,
        freshness_status: state.freshness.status,
        latest_activity_at: state.activity,
        age_minutes: state.freshness.ageMinutes === null
          ? ''
          : state.freshness.ageMinutes,
        freshness_threshold_minutes:
          state.freshness.thresholdMinutes,
        latest_record_key: state.latest
          ? compactRecordKey_(policy.sourceTable, latest)
          : '',
        latest_period: state.activity
          ? state.activity.slice(0, 10)
          : '',
        latest_load_id: text_(latest.load_id),
        active_operation_id: text_(active.operation_id),
        active_phase: text_(active.current_phase),
        progress_percent: active.operation_id
          ? phaseProgress_(active.current_phase)
          : '',
        checkpoint_cursor: active.operation_id
          ? checkpointCursor_(active)
          : '',
        latest_backup_id: text_(latest.backup_id),
        trigger_status:
          policy.datasetId === 'TRIGGERS'
            ? state.sourceStatus
            : '',
        issue_count: count,
        next_action: nextAction
      };
    });

    if (rows.length > MAX_DATASET_ROWS) {
      throw AKORT.Core.error(
        'BETA15_DATASET_PROJECTION_LIMIT_EXCEEDED',
        'Dataset-status projection exceeds its frozen bound.',
        {
          maximum: MAX_DATASET_ROWS,
          actual: rows.length,
          retryable: false
        }
      );
    }
    return rows.sort(function (left, right) {
      return left.dataset_id.localeCompare(right.dataset_id);
    });
  }

  function stampSnapshot_(datasets, issues, observedAt) {
    var identity = {
      datasets: (datasets || []).map(function (row) {
        return clone_(row);
      }),
      issues: (issues || []).map(function (row) {
        return clone_(row);
      })
    };
    var fingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(identity)
    );
    (datasets || []).forEach(function (row) {
      row.observed_at = observedAt;
      row.snapshot_fingerprint = fingerprint;
      row.release_version = AKORT.Release.version;
    });
    (issues || []).forEach(function (row) {
      row.observed_at = observedAt;
      row.snapshot_fingerprint = fingerprint;
      row.release_version = AKORT.Release.version;
    });
    return fingerprint;
  }

  function buildSnapshot_() {
    assertBase_();
    var spreadsheet = dwh_();
    var sources = readSources_(spreadsheet);
    var nowMs = Date.now();
    var observedAt = new Date(nowMs).toISOString();
    var issues = buildIssues_(sources, nowMs);
    var datasets = buildDatasetRows_(sources, issues, nowMs);
    var fingerprint = stampSnapshot_(
      datasets,
      issues,
      observedAt
    );
    return {
      observedAt: observedAt,
      fingerprint: fingerprint,
      datasets: datasets,
      issues: issues,
      sourceReads: Object.keys(sources).sort().map(function (name) {
        return {
          name: name,
          totalRows: sources[name].totalRows,
          rowsRead: sources[name].rowsRead,
          truncated: sources[name].truncated
        };
      })
    };
  }

  function rowValues_(headers, object) {
    return headers.map(function (header) {
      var value = object[header];
      return value === undefined || value === null ? '' : value;
    });
  }

  function writeProjection_(spreadsheet, name, headers, objects) {
    var sheet = requireTable_(spreadsheet, name, headers);
    var existingRows = Math.max(0, sheet.getLastRow() - 1);
    if (existingRows) {
      sheet.getRange(
        2,
        1,
        existingRows,
        headers.length
      ).clearContent();
    }
    if (objects.length) {
      var requiredLastRow = objects.length + 1;
      if (requiredLastRow > sheet.getMaxRows()) {
        sheet.insertRowsAfter(
          sheet.getMaxRows(),
          requiredLastRow - sheet.getMaxRows()
        );
      }
      sheet.getRange(
        2,
        1,
        objects.length,
        headers.length
      ).setValues(objects.map(function (object) {
        return rowValues_(headers, object);
      }));
    }
    return {
      table: name,
      rowsWritten: objects.length
    };
  }

  function writeSnapshot_(snapshot) {
    var spreadsheet = dwh_();
    return {
      datasetStatus: writeProjection_(
        spreadsheet,
        TARGET_DATASET_STATUS,
        DATASET_HEADERS,
        snapshot.datasets
      ),
      issueRegistry: writeProjection_(
        spreadsheet,
        TARGET_ISSUE_REGISTRY,
        ISSUE_HEADERS,
        snapshot.issues
      ),
      observedAt: snapshot.observedAt,
      fingerprint: snapshot.fingerprint
    };
  }

  function targetInspection_() {
    var spreadsheet = dwh_();
    return [
      inspectTable_(
        spreadsheet,
        TARGET_DATASET_STATUS,
        DATASET_HEADERS
      ),
      inspectTable_(
        spreadsheet,
        TARGET_ISSUE_REGISTRY,
        ISSUE_HEADERS
      )
    ].map(function (inspection) {
      delete inspection.sheet;
      return inspection;
    });
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA15_COMPACT_OBSERVABILITY_PREFLIGHT',
      function () {
        assertBase_();
        var spreadsheet = dwh_();
        var blockers = [];
        var sourceInspection = sourceDefinitions_().map(
          function (definition) {
            var inspected = inspectTable_(
              spreadsheet,
              definition.name,
              definition.headers
            );
            if (inspected.status !== 'PRESENT') {
              blockers.push(
                'SOURCE_TABLE_MISSING:' + definition.name
              );
            } else if (!inspected.schemaMatches) {
              blockers.push(
                'SOURCE_SCHEMA_MISMATCH:' + definition.name
              );
            }
            return {
              name: definition.name,
              status: inspected.status,
              schemaMatches: inspected.schemaMatches,
              rows: inspected.rows,
              columns: inspected.columns
            };
          }
        );
        var targets = targetInspection_();
        targets.forEach(function (target) {
          if (target.status === 'PRESENT' &&
              !target.schemaMatches) {
            blockers.push(
              'TARGET_SCHEMA_MISMATCH:' + target.name
            );
          }
        });
        return blockers.length
          ? AKORT.Result.failure(
              'BETA15_COMPACT_OBSERVABILITY_PREFLIGHT_BLOCKED',
              'Beta.1.5 compact observability preflight found blockers.',
              {
                packageVersion: PACKAGE_VERSION,
                contractVersion: CONTRACT_VERSION,
                baseRelease: BASE_RELEASE,
                baseCommit: BASE_COMMIT,
                readyToInstall: false,
                blockers: blockers,
                sourceInspection: sourceInspection,
                targetInspection: targets,
                readBoundary: 'HEADERS_AND_ROW_COUNTS_ONLY',
                userPipelineEnabled: false,
                productionTouched: false
              }
            )
          : AKORT.Result.success(
              'Beta.1.5 compact observability preflight passed.',
              {
                packageVersion: PACKAGE_VERSION,
                contractVersion: CONTRACT_VERSION,
                baseRelease: BASE_RELEASE,
                baseCommit: BASE_COMMIT,
                readyToInstall: true,
                blockers: [],
                sourceInspection: sourceInspection,
                targetInspection: targets,
                readBoundary: 'HEADERS_AND_ROW_COUNTS_ONLY',
                userPipelineEnabled: false,
                productionTouched: false
              }
            );
      },
      { lock: false, persistLogs: false }
    );
  }

  function install() {
    var checked = preflight();
    if (!checked.ok) return checked;

    /*
     * Core.install owns its own Script Lock. It must finish before the
     * Beta.1.5 projection lock is acquired because Apps Script locks are not
     * re-entrant.
     */
    var core = AKORT.Core.install();
    if (!core.ok) return core;

    return AKORT.Core.safeRun(
      'BETA15_COMPACT_OBSERVABILITY_INSTALL',
      function () {
        assertBase_();
        var snapshot = buildSnapshot_();
        var written = writeSnapshot_(snapshot);
        return AKORT.Result.success(
          'Beta.1.5 compact observability installed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            preflight: checked.data,
            coreInstallation: core.data,
            projection: written,
            sourceReads: snapshot.sourceReads,
            issueCount: snapshot.issues.length,
            writeBoundary:
              'DATASET_STATUS_AND_ISSUE_REGISTRY_ONLY',
            createsTrigger: false,
            deletesTrigger: false,
            mutatesOperation: false,
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function refresh() {
    return AKORT.Core.safeRun(
      'BETA15_COMPACT_OBSERVABILITY_REFRESH',
      function () {
        assertBase_();
        requireTable_(
          dwh_(),
          TARGET_DATASET_STATUS,
          DATASET_HEADERS
        );
        requireTable_(
          dwh_(),
          TARGET_ISSUE_REGISTRY,
          ISSUE_HEADERS
        );
        var snapshot = buildSnapshot_();
        var written = writeSnapshot_(snapshot);
        return AKORT.Result.success(
          'Beta.1.5 compact observability refreshed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            projection: written,
            sourceReads: snapshot.sourceReads,
            issueCount: snapshot.issues.length,
            writeBoundary:
              'DATASET_STATUS_AND_ISSUE_REGISTRY_ONLY',
            createsTrigger: false,
            deletesTrigger: false,
            mutatesOperation: false,
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function readProjection_(spreadsheet, name, headers, maximumRows) {
    var sheet = requireTable_(spreadsheet, name, headers);
    var count = Math.max(0, sheet.getLastRow() - 1);
    if (count > maximumRows) {
      throw AKORT.Core.error(
        'BETA15_PROJECTION_READ_LIMIT_EXCEEDED',
        'Compact projection exceeds its frozen read bound.',
        {
          table: name,
          maximum: maximumRows,
          actual: count,
          retryable: false
        }
      );
    }
    if (!count) return [];
    return rowsFromValues_(
      headers,
      sheet.getRange(
        2,
        1,
        count,
        headers.length
      ).getValues(),
      2
    ).map(function (row) {
      delete row.__row;
      return row;
    });
  }

  function status() {
    return AKORT.Core.safeRun(
      'BETA15_COMPACT_OBSERVABILITY_STATUS',
      function () {
        assertRuntimeMemory_();
        var spreadsheet = dwh_();
        var datasets = readProjection_(
          spreadsheet,
          TARGET_DATASET_STATUS,
          DATASET_HEADERS,
          MAX_DATASET_ROWS
        );
        var issues = readProjection_(
          spreadsheet,
          TARGET_ISSUE_REGISTRY,
          ISSUE_HEADERS,
          MAX_ISSUE_ROWS
        );
        var severityCounts = {};
        var lifecycleCounts = {};
        issues.forEach(function (issue) {
          var severity = normalizeSeverity_(issue.severity);
          severityCounts[severity] =
            Number(severityCounts[severity] || 0) + 1;
          var lifecycle = text_(issue.lifecycle_status);
          lifecycleCounts[lifecycle] =
            Number(lifecycleCounts[lifecycle] || 0) + 1;
        });
        var errorCount =
          Number(severityCounts.ERROR || 0) +
          Number(severityCounts.CRITICAL || 0);
        var warningCount =
          Number(severityCounts.WARNING || 0);
        var datasetErrors = datasets.filter(function (dataset) {
          return text_(dataset.health_status) === 'ERROR';
        }).length;
        var datasetWarnings = datasets.filter(function (dataset) {
          return text_(dataset.health_status) === 'WARNING' ||
            text_(dataset.health_status) === 'UNKNOWN';
        }).length;
        var overall = errorCount || datasetErrors
          ? 'ERROR'
          : warningCount || datasetWarnings
            ? 'WARNING'
            : 'HEALTHY';
        var actions = {};
        datasets.concat(issues).forEach(function (row) {
          var action = text_(row.next_action);
          if (action && action !== 'NONE') actions[action] = true;
        });
        return AKORT.Result.success(
          'Beta.1.5 compact observability status loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            overallStatus: overall,
            healthy: overall === 'HEALTHY',
            datasetCount: datasets.length,
            issueCount: issues.length,
            severityCounts: severityCounts,
            lifecycleCounts: lifecycleCounts,
            nextActions: Object.keys(actions).sort(),
            datasets: datasets,
            issues: issues,
            readBoundary: [
              TARGET_DATASET_STATUS,
              TARGET_ISSUE_REGISTRY
            ],
            sourceRegistryReads: 0,
            rawTargetReads: 0,
            publishTargetReads: 0,
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      inventoryPackage: INVENTORY_PACKAGE,
      readModels: {
        DATASET_STATUS: DATASET_HEADERS.slice(),
        ISSUE_REGISTRY: ISSUE_HEADERS.slice()
      },
      freshnessPolicies: clone_(FRESHNESS_POLICIES),
      issueLifecycles: ISSUE_LIFECYCLES.slice(),
      normalizedNextActions: NEXT_ACTIONS.slice(),
      boundedness: {
        tailRowsPerSource: MAX_TAIL_ROWS,
        maximumDatasetRows: MAX_DATASET_ROWS,
        maximumIssueRows: MAX_ISSUE_ROWS,
        sourceRegistryFullScan: false,
        statusReadsSourceRegistries: false,
        readsRawTargets: false,
        readsPublishTargets: false
      },
      publicApi: [
        'AKORT_beta15CompactObservabilityContract',
        'AKORT_beta15CompactObservabilityPreflight',
        'AKORT_beta15CompactObservabilityInstall',
        'AKORT_beta15CompactObservabilityRefresh',
        'AKORT_beta15CompactObservabilityStatus'
      ],
      refreshMode: 'MANUAL_BOUNDED_PROJECTION',
      createsTrigger: false,
      deletesTrigger: false,
      mutatesOperation: false,
      createsQueue: false,
      createsExecutor: false,
      createsDispatcher: false,
      dataPlaneWrite: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    DatasetHeaders: DATASET_HEADERS.slice(),
    IssueHeaders: ISSUE_HEADERS.slice(),
    FreshnessPolicies: clone_(FRESHNESS_POLICIES),
    IssueLifecycles: ISSUE_LIFECYCLES.slice(),
    NextActions: NEXT_ACTIONS.slice(),
    contract: contract,
    preflight: preflight,
    install: install,
    refresh: refresh,
    status: status,
    Test: Object.freeze({
      freshness: freshness_,
      latestBy: latestBy_,
      isControlTest: isControlTest_,
      checkpointCursor: checkpointCursor_,
      phaseProgress: phaseProgress_,
      normalizeSeverity: normalizeSeverity_,
      buildIssues: buildIssues_,
      buildDatasetRows: buildDatasetRows_
    })
  });
})();

function AKORT_beta15CompactObservabilityContract() {
  var result = AKORT.Result.success(
    'Beta.1.5 compact observability contract loaded.',
    AKORT.Beta15CompactObservability.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta15CompactObservabilityPreflight() {
  var result = AKORT.Beta15CompactObservability.preflight();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta15CompactObservabilityInstall() {
  var result = AKORT.Beta15CompactObservability.install();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta15CompactObservabilityRefresh() {
  var result = AKORT.Beta15CompactObservability.refresh();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta15CompactObservabilityStatus() {
  var result = AKORT.Beta15CompactObservability.status();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
