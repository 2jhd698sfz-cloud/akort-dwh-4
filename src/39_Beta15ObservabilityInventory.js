var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.5 r1: read-only inventory for the compact observability read model.
 * The inventory reads service registries only. It never scans physical RAW or
 * Publish targets and never materializes DATASET_STATUS or ISSUE_REGISTRY.
 */
AKORT.Beta15ObservabilityInventory = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.5.1';
  var CONTRACT_VERSION = '4.0-beta15-observability-inventory-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '00d1c5e139f2304cf248e1b6ca0e222459c2ed53';
  var MAX_TAIL_ROWS = 25;

  var SOURCE_TABLES = [
    {
      name: 'RELEASE_REGISTRY',
      owner: 'AKORT.Core',
      keyFields: ['release_id', 'version'],
      statusField: 'status',
      timeFields: ['installed_at'],
      headers: [
        'release_id', 'version', 'release_channel', 'schema_version',
        'installed_at', 'installed_by', 'git_commit', 'manifest_hash',
        'baseline_report_id', 'status', 'notes'
      ]
    },
    {
      name: 'OPERATION_QUEUE',
      owner: 'AKORT.OperationEngine',
      keyFields: ['operation_id', 'operation_type'],
      statusField: 'status',
      timeFields: ['finished_at', 'started_at', 'requested_at'],
      headers: [
        'operation_id', 'operation_type', 'status', 'priority',
        'current_phase', 'requested_at', 'started_at', 'finished_at',
        'attempt_no', 'max_attempts', 'checkpoint_json', 'error_code',
        'error_message', 'created_by', 'release_version'
      ]
    },
    {
      name: 'OPERATION_STEPS',
      owner: 'AKORT.OperationEngine',
      keyFields: ['step_id', 'operation_id'],
      statusField: 'status',
      timeFields: ['finished_at', 'started_at'],
      headers: [
        'step_id', 'operation_id', 'phase', 'status', 'attempt_no',
        'started_at', 'finished_at', 'checkpoint_json', 'result_json',
        'error_code', 'error_message', 'release_version'
      ]
    },
    {
      name: 'SYSTEM_LOG',
      owner: 'AKORT.Core',
      keyFields: ['log_id', 'event_code'],
      statusField: 'level',
      timeFields: ['logged_at'],
      headers: [
        'log_id', 'logged_at', 'level', 'component', 'operation_id',
        'step_id', 'execution_id', 'event_code', 'message',
        'details_json', 'release_version'
      ]
    },
    {
      name: 'RAW_LOAD_REGISTRY',
      owner: 'AKORT.RawStore',
      keyFields: ['load_id', 'target_table'],
      statusField: 'status',
      timeFields: ['finished_at', 'started_at'],
      headers: [
        'load_id', 'operation_id', 'source_id', 'source_name',
        'source_hash', 'target_table', 'status', 'rows_received',
        'rows_staged', 'rows_inserted', 'rows_revised',
        'rows_unchanged', 'rows_reversed', 'started_at', 'finished_at',
        'error_code', 'error_message', 'release_version'
      ]
    },
    {
      name: 'PUBLISH_RUNS',
      owner: 'AKORT.IncrementalPublish',
      keyFields: ['publish_run_id', 'load_id'],
      statusField: 'status',
      timeFields: ['finished_at', 'started_at'],
      headers: [
        'publish_run_id', 'operation_id', 'load_id', 'mode', 'status',
        'weekly_series_count', 'monthly_series_count',
        'industry_series_count', 'aggregate_combo_count',
        'publish_rows_written', 'aggregate_rows_written', 'started_at',
        'finished_at', 'error_code', 'error_message', 'release_version'
      ]
    },
    {
      name: 'PUBLISH_RECONCILIATION',
      owner: 'AKORT.IncrementalPublish',
      keyFields: ['reconciliation_id', 'sheet_name'],
      statusField: 'status',
      timeFields: ['checked_at'],
      headers: [
        'reconciliation_id', 'checked_at', 'full_build_id',
        'incremental_build_id', 'sheet_name', 'baseline_rows',
        'full_rows', 'incremental_rows', 'baseline_hash', 'full_hash',
        'incremental_hash', 'full_equals_baseline',
        'incremental_equals_full', 'status', 'details_json',
        'release_version'
      ]
    },
    {
      name: 'PARSER_ISSUES',
      owner: 'AKORT.ExistingSourceParsers',
      keyFields: ['issue_id', 'issue_code'],
      statusField: 'status',
      timeFields: ['created_at'],
      headers: [
        'issue_id', 'operation_id', 'source_file_id', 'profile_id',
        'severity', 'issue_code', 'source_label', 'source_row',
        'source_column', 'details_json', 'status', 'created_at',
        'release_version'
      ]
    },
    {
      name: 'BACKUP_REGISTRY',
      owner: 'AKORT.Beta11PairedBackup',
      keyFields: ['backup_id', 'operation_id'],
      statusField: 'status',
      timeFields: ['finished_at', 'started_at'],
      headers: [
        'backup_id', 'operation_id', 'request_type', 'status',
        'scheduled_date', 'backup_folder_id', 'dwh_source_id',
        'dwh_backup_id', 'dwh_backup_name', 'dwh_backup_url',
        'publish_source_id', 'publish_backup_id', 'publish_backup_name',
        'publish_backup_url', 'manifest_file_id', 'manifest_url',
        'manifest_hash', 'operation_boundary_json', 'started_at',
        'finished_at', 'error_code', 'error_message', 'release_version',
        'created_by'
      ]
    },
    {
      name: 'TRIGGER_OWNERSHIP_REGISTRY',
      owner: 'AKORT.Beta14OperationalHardening',
      keyFields: ['process_id', 'handler'],
      statusField: 'status',
      timeFields: ['observed_at'],
      headers: [
        'process_id', 'owner_module', 'handler', 'lifecycle',
        'expected_minimum', 'expected_maximum', 'observed_count',
        'status', 'next_action', 'trigger_ids_json', 'event_types_json',
        'trigger_sources_json', 'observed_at', 'registry_fingerprint',
        'release_version'
      ]
    }
  ];

  var TARGET_TABLES = ['DATASET_STATUS', 'ISSUE_REGISTRY'];

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

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA15_BASE_RELEASE_MISMATCH',
        'Beta.1.5 inventory requires the accepted Alpha.7.4 runtime.',
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
        'Beta.1.5 inventory cannot run after user-pipeline enablement.',
        { retryable: false }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function dateMs_(value) {
    var parsed = Date.parse(text_(value));
    return isNaN(parsed) ? 0 : parsed;
  }

  function rowObject_(headers, row) {
    var object = {};
    headers.forEach(function (header, index) {
      object[header] = row[index];
    });
    return object;
  }

  function tailRows_(sheet, headers) {
    var rowCount = Math.max(0, sheet.getLastRow() - 1);
    var count = Math.min(MAX_TAIL_ROWS, rowCount);
    if (!count) return [];
    var startRow = sheet.getLastRow() - count + 1;
    return sheet.getRange(
      startRow,
      1,
      count,
      headers.length
    ).getValues().map(function (row) {
      return rowObject_(headers, row);
    });
  }

  function latestTimestamp_(rows, fields) {
    var best = '';
    var bestMs = 0;
    (rows || []).forEach(function (row) {
      (fields || []).forEach(function (field) {
        var value = text_(row[field]);
        var parsed = dateMs_(value);
        if (parsed > bestMs) {
          bestMs = parsed;
          best = value;
        }
      });
    });
    return best;
  }

  function keySummary_(row, fields) {
    if (!row) return '';
    return (fields || []).map(function (field) {
      return field + '=' + text_(row[field]);
    }).join('|');
  }

  function tailSummary_(rows, definition) {
    var counts = {};
    var statusField = definition.statusField;
    (rows || []).forEach(function (row) {
      var status = text_(row[statusField]) || 'BLANK';
      counts[status] = Number(counts[status] || 0) + 1;
    });
    var last = rows.length ? rows[rows.length - 1] : null;
    return {
      rowsRead: rows.length,
      latestTimestamp: latestTimestamp_(rows, definition.timeFields),
      lastRecordKey: keySummary_(last, definition.keyFields),
      lastStatus: last ? text_(last[statusField]) : '',
      statusCounts: counts
    };
  }

  function inspectSource_(spreadsheet, definition) {
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      return {
        name: definition.name,
        owner: definition.owner,
        status: 'ABSENT',
        schemaMatches: false,
        rows: 0,
        columns: 0,
        tail: {
          rowsRead: 0,
          latestTimestamp: '',
          lastRecordKey: '',
          lastStatus: '',
          statusCounts: {}
        },
        nextAction: 'RESTORE_REQUIRED_SOURCE_TABLE'
      };
    }
    var columnCount = Math.max(1, sheet.getLastColumn());
    var actual = sheet.getRange(
      1,
      1,
      1,
      columnCount
    ).getValues()[0].map(String);
    var schemaMatches =
      JSON.stringify(actual) === JSON.stringify(definition.headers);
    var rows = schemaMatches ? tailRows_(sheet, definition.headers) : [];
    return {
      name: definition.name,
      owner: definition.owner,
      status: schemaMatches ? 'READY' : 'SCHEMA_MISMATCH',
      schemaMatches: schemaMatches,
      rows: Math.max(0, sheet.getLastRow() - 1),
      columns: sheet.getLastColumn(),
      expectedColumns: definition.headers.length,
      tail: tailSummary_(rows, definition),
      nextAction: schemaMatches ? 'NONE' : 'REVIEW_SOURCE_SCHEMA'
    };
  }

  function inspectTarget_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      return {
        name: name,
        status: 'ABSENT',
        rows: 0,
        columns: 0,
        headers: [],
        nextAction: 'IMPLEMENT_COMPACT_READ_MODEL'
      };
    }
    var columns = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(1, 1, 1, columns)
      .getValues()[0].map(String);
    return {
      name: name,
      status: 'UNEXPECTEDLY_PRESENT',
      rows: Math.max(0, sheet.getLastRow() - 1),
      columns: sheet.getLastColumn(),
      headers: headers,
      nextAction: 'MANUAL_REVIEW'
    };
  }

  function beta14Reuse_() {
    var module = AKORT.Beta14OperationalHardening;
    if (!module || typeof module.contract !== 'function') {
      return {
        available: false,
        contractVersion: '',
        packageVersion: '',
        nextAction: 'RESTORE_BETA14_HARDENING'
      };
    }
    var contract = module.contract();
    return {
      available: true,
      contractVersion: text_(contract.contractVersion),
      packageVersion: text_(contract.packageVersion),
      normalizedNextActions:
        (contract.normalizedNextActions || []).slice(),
      registry: text_(contract.registry),
      nextAction: 'NONE'
    };
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      mode: 'READ_ONLY_OBSERVABILITY_INVENTORY',
      sourceTables: SOURCE_TABLES.map(function (definition) {
        return {
          name: definition.name,
          owner: definition.owner,
          headers: definition.headers.slice(),
          keyFields: definition.keyFields.slice(),
          statusField: definition.statusField,
          timeFields: definition.timeFields.slice()
        };
      }),
      targetTables: TARGET_TABLES.slice(),
      maxTailRowsPerSource: MAX_TAIL_ROWS,
      readsRawTargets: false,
      readsPublishTargets: false,
      fullRegistryScan: false,
      returnsSourceRows: false,
      createsTable: false,
      updatesTable: false,
      createsTrigger: false,
      deletesTrigger: false,
      mutatesOperation: false,
      dataPlaneWrite: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  function inventory() {
    return AKORT.Core.safeRun(
      'BETA15_OBSERVABILITY_INVENTORY',
      function () {
        assertBase_();
        var spreadsheet = dwh_();
        var sources = SOURCE_TABLES.map(function (definition) {
          return inspectSource_(spreadsheet, definition);
        });
        var targets = TARGET_TABLES.map(function (name) {
          return inspectTarget_(spreadsheet, name);
        });
        var beta14 = beta14Reuse_();
        var blockers = [];

        sources.forEach(function (source) {
          if (!source.schemaMatches) {
            blockers.push(source.name + ':' + source.status);
          }
        });
        targets.forEach(function (target) {
          if (target.status !== 'ABSENT') {
            blockers.push(target.name + ':' + target.status);
          }
        });
        if (!beta14.available) {
          blockers.push('BETA14_OPERATIONAL_HARDENING_UNAVAILABLE');
        }

        var missingTargets = targets.filter(function (target) {
          return target.status === 'ABSENT';
        }).map(function (target) {
          return target.name;
        });

        return AKORT.Result.success(
          'Beta.1.5 observability inventory loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            observedAt: AKORT.Core.now(),
            sourceInventory: sources,
            targetInventory: targets,
            beta14Reuse: beta14,
            implementationReady: blockers.length === 0,
            blockers: blockers,
            exactRemainingGap: [
              'DATASET_STATUS is not materialized.',
              'ISSUE_REGISTRY is not materialized.',
              'No bounded projection refresh combines accepted registries.',
              'Freshness policy is not materialized.',
              'Issue lifecycle normalization is not materialized.',
              'No compact status API reads only the materialized read models.'
            ],
            missingReadModels: missingTargets,
            readBoundary: {
              workbook: 'DEV_DWH_ONLY',
              maxTailRowsPerSource: MAX_TAIL_ROWS,
              rawTargetsRead: false,
              publishTargetsRead: false,
              sourceRowsReturned: false
            },
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    SourceTables: clone_(SOURCE_TABLES),
    TargetTables: TARGET_TABLES.slice(),
    contract: contract,
    inventory: inventory,
    Test: Object.freeze({
      tailSummary: tailSummary_,
      keySummary: keySummary_,
      latestTimestamp: latestTimestamp_
    })
  });
})();

function AKORT_beta15ObservabilityInventoryContract() {
  var result = AKORT.Result.success(
    'Beta.1.5 observability inventory contract loaded.',
    AKORT.Beta15ObservabilityInventory.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta15ObservabilityInventory() {
  var result = AKORT.Beta15ObservabilityInventory.inventory();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
