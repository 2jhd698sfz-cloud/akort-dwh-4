var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.6 r1: read-only inventory for resumable Full Audit and retention.
 * The inventory reads accepted service registries only and never scans
 * physical RAW or Publish targets.
 */
AKORT.Beta16FullAuditRetentionInventory = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.6.1';
  var CONTRACT_VERSION =
    '4.0-beta16-full-audit-retention-inventory-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT =
    '86f8aa96fd6034bbf657e7159d3985066b67dbc6';
  var MAX_TAIL_ROWS = 25;
  var OPERATION_TYPE = 'FULL_AUDIT_V4';
  var TARGET_TABLES = [
    'FULL_AUDIT_EVIDENCE',
    'RETENTION_REGISTRY'
  ];

  var SOURCE_TABLES = [
    {
      name: 'RELEASE_REGISTRY',
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
      name: 'PUBLISH_RECONCILIATION',
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
      name: 'BACKUP_REGISTRY',
      statusField: 'status',
      timeFields: ['finished_at', 'started_at'],
      headers: [
        'backup_id', 'operation_id', 'request_type', 'status',
        'scheduled_date', 'backup_folder_id', 'dwh_source_id',
        'dwh_backup_id', 'dwh_backup_name', 'dwh_backup_url',
        'publish_source_id', 'publish_backup_id', 'publish_backup_name',
        'publish_backup_url', 'manifest_file_id', 'manifest_url',
        'manifest_hash', 'operation_boundary_json', 'started_at',
        'finished_at', 'error_code', 'error_message',
        'release_version', 'created_by'
      ]
    },
    {
      name: 'DATASET_STATUS',
      statusField: 'health_status',
      timeFields: ['observed_at'],
      headers: [
        'dataset_id', 'dataset_label', 'source_table', 'source_status',
        'health_status', 'freshness_status', 'latest_activity_at',
        'age_minutes', 'freshness_threshold_minutes',
        'latest_record_key', 'latest_period', 'latest_load_id',
        'active_operation_id', 'active_phase', 'progress_percent',
        'checkpoint_cursor', 'latest_backup_id', 'trigger_status',
        'issue_count', 'next_action', 'observed_at',
        'snapshot_fingerprint', 'release_version'
      ]
    },
    {
      name: 'ISSUE_REGISTRY',
      statusField: 'lifecycle_status',
      timeFields: ['last_seen_at', 'observed_at'],
      headers: [
        'issue_key', 'source_table', 'source_record_key', 'dataset_id',
        'operation_id', 'severity', 'issue_code', 'lifecycle_status',
        'source_status', 'first_seen_at', 'last_seen_at',
        'occurrence_count', 'summary', 'details_json', 'resolution',
        'next_action', 'observed_at', 'snapshot_fingerprint',
        'release_version'
      ]
    }
  ];

  var REQUIRED_MODULES = [
    {
      name: 'AKORT.OperationEngine',
      path: ['OperationEngine'],
      functions: [
        'enqueue', 'run', 'resume', 'requestStop',
        'recoverFailedPhase', 'status'
      ]
    },
    {
      name: 'AKORT.Beta14OperationalHardening',
      path: ['Beta14OperationalHardening'],
      functions: ['classifyOperation', 'enqueueGuarded', 'status']
    },
    {
      name: 'AKORT.Beta15CompactObservability',
      path: ['Beta15CompactObservability'],
      functions: ['status', 'refresh']
    },
    {
      name: 'AKORT.Beta11PairedBackup',
      path: ['Beta11PairedBackup'],
      functions: ['status']
    }
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

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA16_BASE_RELEASE_MISMATCH',
        'Beta.1.6 inventory requires the accepted runtime.',
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
        'BETA16_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Beta.1.6 inventory cannot run after user-pipeline enablement.',
        { retryable: false }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(
      config.resources.dwhSpreadsheetId
    );
  }

  function headersEqual_(actual, expected) {
    return JSON.stringify(actual.map(String)) ===
      JSON.stringify(expected.map(String));
  }

  function inspectTable_(spreadsheet, definition) {
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      return {
        name: definition.name,
        status: 'ABSENT',
        schemaMatches: false,
        rows: 0,
        columns: 0,
        rowsRead: 0,
        statusCounts: {},
        latestTimestamp: ''
      };
    }
    var columns = sheet.getLastColumn();
    var actual = columns
      ? sheet.getRange(1, 1, 1, columns).getValues()[0].map(String)
      : [];
    var totalRows = Math.max(0, sheet.getLastRow() - 1);
    var count = Math.min(MAX_TAIL_ROWS, totalRows);
    var values = count
      ? sheet.getRange(
          sheet.getLastRow() - count + 1,
          1,
          count,
          Math.min(columns, definition.headers.length)
        ).getValues()
      : [];
    var index = {};
    definition.headers.forEach(function (header, position) {
      index[header] = position;
    });
    var counts = {};
    var latestMs = 0;
    var latest = '';
    values.forEach(function (row) {
      var status = text_(row[index[definition.statusField]]);
      if (status) counts[status] = Number(counts[status] || 0) + 1;
      (definition.timeFields || []).forEach(function (field) {
        var value = row[index[field]];
        var parsed = Date.parse(String(value || ''));
        if (!isNaN(parsed) && parsed > latestMs) {
          latestMs = parsed;
          latest = new Date(parsed).toISOString();
        }
      });
    });
    return {
      name: definition.name,
      status: 'PRESENT',
      schemaMatches: headersEqual_(actual, definition.headers),
      rows: totalRows,
      columns: columns,
      rowsRead: count,
      statusCounts: counts,
      latestTimestamp: latest
    };
  }

  function inspectTarget_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    return {
      name: name,
      status: sheet ? 'PRESENT' : 'ABSENT',
      rows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
      columns: sheet ? sheet.getLastColumn() : 0,
      nextAction: sheet
        ? 'REVIEW_EXISTING_TARGET_BEFORE_R2'
        : 'IMPLEMENT_IN_R2'
    };
  }

  function resolvePath_(root, path) {
    var value = root;
    (path || []).forEach(function (key) {
      value = value && value[key];
    });
    return value;
  }

  function moduleInspection_(definition) {
    var module = resolvePath_(AKORT, definition.path);
    var functions = {};
    (definition.functions || []).forEach(function (name) {
      functions[name] = Boolean(
        module && typeof module[name] === 'function'
      );
    });
    return {
      name: definition.name,
      available: Boolean(module),
      functions: functions,
      complete: Boolean(module) &&
        Object.keys(functions).every(function (name) {
          return functions[name] === true;
        })
    };
  }

  function fullAuditOperationTail_(spreadsheet) {
    var definition = SOURCE_TABLES.filter(function (item) {
      return item.name === 'OPERATION_QUEUE';
    })[0];
    var sheet = spreadsheet.getSheetByName('OPERATION_QUEUE');
    if (!sheet || sheet.getLastRow() < 2) {
      return {
        operationType: OPERATION_TYPE,
        rowsRead: 0,
        observedCount: 0,
        statuses: {}
      };
    }
    var total = Math.max(0, sheet.getLastRow() - 1);
    var count = Math.min(MAX_TAIL_ROWS, total);
    var values = sheet.getRange(
      sheet.getLastRow() - count + 1,
      1,
      count,
      definition.headers.length
    ).getValues();
    var typeIndex = definition.headers.indexOf('operation_type');
    var statusIndex = definition.headers.indexOf('status');
    var statuses = {};
    var observed = 0;
    values.forEach(function (row) {
      if (text_(row[typeIndex]) !== OPERATION_TYPE) return;
      observed += 1;
      var status = text_(row[statusIndex]);
      statuses[status] = Number(statuses[status] || 0) + 1;
    });
    return {
      operationType: OPERATION_TYPE,
      rowsRead: count,
      observedCount: observed,
      statuses: statuses
    };
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      mode: 'READ_ONLY_FULL_AUDIT_RETENTION_INVENTORY',
      candidateOperationType: OPERATION_TYPE,
      authoritativeSourceTables: SOURCE_TABLES.map(function (item) {
        return item.name;
      }),
      candidateReadModels: TARGET_TABLES.slice(),
      tailRowsPerSource: MAX_TAIL_ROWS,
      physicalDeletion: false,
      readsPhysicalRawTargets: false,
      readsPhysicalPublishTargets: false,
      createsOperation: false,
      createsTable: false,
      createsTrigger: false,
      deletesTrigger: false,
      createsDriveFile: false,
      deletesDriveFile: false,
      dataPlaneWrite: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  function inventory() {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_RETENTION_INVENTORY',
      function () {
        assertBase_();
        var spreadsheet = dwh_();
        var sources = SOURCE_TABLES.map(function (definition) {
          return inspectTable_(spreadsheet, definition);
        });
        var targets = TARGET_TABLES.map(function (name) {
          return inspectTarget_(spreadsheet, name);
        });
        var modules = REQUIRED_MODULES.map(moduleInspection_);
        var operationTail = fullAuditOperationTail_(spreadsheet);
        var blockers = [];

        sources.forEach(function (source) {
          if (source.status !== 'PRESENT') {
            blockers.push('SOURCE_TABLE_MISSING:' + source.name);
          } else if (!source.schemaMatches) {
            blockers.push('SOURCE_SCHEMA_MISMATCH:' + source.name);
          }
        });
        modules.forEach(function (module) {
          if (!module.complete) {
            blockers.push('REQUIRED_MODULE_INCOMPLETE:' + module.name);
          }
        });
        if (operationTail.observedCount) {
          blockers.push('FULL_AUDIT_OPERATION_ALREADY_PRESENT');
        }
        targets.forEach(function (target) {
          if (target.status === 'PRESENT') {
            blockers.push('CANDIDATE_TARGET_ALREADY_PRESENT:' + target.name);
          }
        });

        return AKORT.Result.success(
          'Beta.1.6 Full Audit and retention inventory loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            observedAt: AKORT.Core.now(),
            sourceInventory: sources,
            moduleInventory: modules,
            fullAuditOperationInventory: operationTail,
            targetInventory: targets,
            implementationReady: blockers.length === 0,
            blockers: blockers,
            acceptedReuse: [
              'AKORT.OperationEngine',
              'QUICK_AUDIT',
              'PUBLISH_RECONCILIATION',
              'BACKUP_REGISTRY',
              'AKORT.Beta14OperationalHardening',
              'AKORT.Beta15CompactObservability',
              'accepted Gate 7 evidence'
            ],
            exactRemainingGap: [
              'FULL_AUDIT_V4 handler is not registered.',
              'Accepted checks are not one resumable operation.',
              'FULL_AUDIT_EVIDENCE is not materialized.',
              'RETENTION_REGISTRY is not materialized.',
              'Protected-artifact policy is not materialized.',
              'Retention dry-run planner is not implemented.',
              'No narrow Full Audit submit/status/evidence facade exists.'
            ],
            retentionBoundary: {
              dryRunOnly: true,
              physicalDeletion: false,
              driveEnumeration: false,
              protectedArtifactClasses: [
                'ACCEPTED_RELEASE',
                'GATE_ACCEPTANCE_EVIDENCE',
                'VERIFIED_BASELINE',
                'REQUIRED_PAIRED_BACKUP',
                'ACTIVE_OPERATION_CHECKPOINT',
                'LATEST_SUCCESSFUL_FULL_AUDIT'
              ]
            },
            readBoundary: {
              workbook: 'DEV_DWH_ONLY',
              maxTailRowsPerSource: MAX_TAIL_ROWS,
              physicalRawTargetReads: 0,
              physicalPublishTargetReads: 0,
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
    CandidateOperationType: OPERATION_TYPE,
    SourceTables: clone_(SOURCE_TABLES),
    TargetTables: TARGET_TABLES.slice(),
    contract: contract,
    inventory: inventory
  });
})();

function AKORT_beta16FullAuditRetentionInventoryContract() {
  var result = AKORT.Result.success(
    'Beta.1.6 Full Audit and retention inventory contract loaded.',
    AKORT.Beta16FullAuditRetentionInventory.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta16FullAuditRetentionInventory() {
  var result =
    AKORT.Beta16FullAuditRetentionInventory.inventory();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
