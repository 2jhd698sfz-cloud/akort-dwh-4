'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '42_Beta16FullAuditRetention.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const core = fs.readFileSync(path.join(root, 'src', '02_Core.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src', '03_OperationEngine.js'), 'utf8');
const hardening = fs.readFileSync(path.join(root, 'src', '38_Beta14OperationalHardening.js'), 'utf8');
const inventoryTest = fs.readFileSync(
  path.join(root, 'tests', 'beta16_full_audit_retention_inventory_static.test.js'),
  'utf8'
);
const contract = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'beta-1', 'BETA16_FULL_AUDIT_RETENTION_CONTRACT.json'),
  'utf8'
));
const markdown = fs.readFileSync(
  path.join(root, 'docs', 'beta-1', 'BETA16_FULL_AUDIT_RETENTION_CONTRACT.md'),
  'utf8'
);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let total = 0;
let failed = 0;
function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach((key) => {
      result[key] = canonicalize(value[key]);
    });
    return result;
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function loadModule() {
  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Boolean,
    Array,
    AKORT: {
      Core: {
        canonicalJson,
        safeJson: JSON.stringify,
        sha256,
        now: () => '2026-08-05T09:00:00.000Z'
      },
      Release: {
        version: '4.0.0-alpha.7.4.42',
        baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
        manifest: () => ({
          baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
          baselineDate: '2026-07-10'
        })
      },
      Result: {
        success: (message, data) => ({ ok: true, message, data }),
        failure: (code, message, details) => ({ ok: false, code, message, details })
      }
    }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: sourcePath }).runInContext(context);
  return context.AKORT.Beta16FullAuditRetention;
}

test('r3 metadata pins accepted inventory head and runtime', () => {
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.6.3');
  assert.strictEqual(contract.contractVersion, '4.0-beta16-full-audit-retention-1');
  assert.strictEqual(contract.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(contract.baseCommit, '55fd0f2379ed19ad7461dc00d3711ab80c4ff4d1');
  assert(source.includes("var BASE_COMMIT = '55fd0f2379ed19ad7461dc00d3711ab80c4ff4d1';"));
});

test('source and test are syntax-valid', () => {
  new vm.Script(source, { filename: sourcePath });
  new vm.Script(fs.readFileSync(__filename, 'utf8'), { filename: __filename });
});

test('Core materializes the exact two Beta.1.6 read models', () => {
  assert(core.includes('FULL_AUDIT_EVIDENCE: ['));
  assert(core.includes('RETENTION_REGISTRY: ['));
  contract.readModels.FULL_AUDIT_EVIDENCE.forEach((header) => {
    assert(core.includes("'" + header + "'"), 'evidence header ' + header);
  });
  contract.readModels.RETENTION_REGISTRY.forEach((header) => {
    assert(core.includes("'" + header + "'"), 'retention header ' + header);
  });
});

test('accepted Operation Engine registers the one Full Audit handler', () => {
  assert(engine.includes('AKORT.Beta16FullAuditHandlers'));
  assert(engine.includes('AKORT.Beta16FullAuditHandlers.supports(type)'));
  assert(source.includes("return String(operationType || '') === 'FULL_AUDIT_V4';"));
  assert.strictEqual(contract.operationType, 'FULL_AUDIT_V4');
  assert.strictEqual(contract.acceptedExecutor, 'AKORT.OperationEngine');
});

test('Beta.1.4 guard serializes Full Audit as snapshot-exclusive', () => {
  assert(hardening.includes("if (type === 'FULL_AUDIT_V4')"));
  assert(hardening.includes("return 'SNAPSHOT_EXCLUSIVE';"));
  assert(hardening.includes("'FULL_AUDIT_V4'"));
  assert.strictEqual(contract.guardedEnqueue,
    'AKORT.Beta14OperationalHardening.enqueueGuarded');
});

test('Full Audit spans the accepted resumable phase contract', () => {
  [
    'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW',
    'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS', 'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST', 'RECONCILING_AGGREGATES',
    'UPDATE_STATUS', 'QUICK_AUDIT', 'FINALIZING'
  ].forEach((phase) => {
    assert(source.includes("phase === '" + phase + "'"), phase);
  });
  assert(source.includes('context.checkpoint.handlerState.beta16FullAudit'));
  assert(source.includes('AKORT.OperationEngine.resume(operationId, { maxSteps: 50 })'));
});

test('non-Core source schemas preserve accepted module ownership', () => {
  assert(source.includes('var NON_CORE_SOURCE_HEADERS = {'));
  assert(source.includes('RAW_LOAD_REGISTRY: ['));
  assert(source.includes('PUBLISH_RECONCILIATION: ['));
  assert(source.includes('function expectedHeaders_(name)'));
  assert(!source.includes('var expected = AKORT.Core.Tables[name] || [];'));
  assert.deepStrictEqual(
    contract.schemaOwnership.rawStore,
    ['RAW_LOAD_REGISTRY']
  );
  assert.deepStrictEqual(
    contract.schemaOwnership.incrementalPublish,
    ['PUBLISH_RECONCILIATION']
  );
  assert(!contract.schemaOwnership.core.includes('RAW_LOAD_REGISTRY'));
  assert(!contract.schemaOwnership.core.includes('PUBLISH_RECONCILIATION'));
});

test('audit reads only bounded service registries', () => {
  assert(source.includes('var MAX_TAIL_ROWS = 25;'));
  assert(source.includes('Math.min(Number(maximum || MAX_TAIL_ROWS), total)'));
  assert.strictEqual(contract.tailRowsPerSource, 25);
  [
    'RELEASE_REGISTRY', 'OPERATION_QUEUE', 'OPERATION_STEPS',
    'SYSTEM_LOG', 'RAW_LOAD_REGISTRY', 'PUBLISH_RECONCILIATION',
    'BACKUP_REGISTRY', 'DATASET_STATUS', 'ISSUE_REGISTRY'
  ].forEach((name) => assert(contract.authoritativeSourceTables.includes(name), name));
});

test('physical RAW and Publish targets are not read or written', () => {
  [
    "'RAW_PRICES_WEEKLY'", "'RAW_PRICES_MONTHLY'", "'RAW_INDUSTRY'",
    "'PUBLISH_PRICES_WEEKLY'", "'PUBLISH_PRICES_MONTHLY'",
    "'PUBLISH_INDUSTRY'", "'PUBLISH_PRICE_AGGREGATES'",
    'publishSpreadsheetId'
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.readsPhysicalRawTargets, false);
  assert.strictEqual(contract.readsPhysicalPublishTargets, false);
  assert.strictEqual(contract.dataPlaneWrite, false);
});

test('retention has no physical deletion or Drive enumeration path', () => {
  [
    'DriveApp.', 'setTrashed(', 'moveToTrash(', 'deleteFile(',
    'getFiles()', 'getFilesByName(', 'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger'
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.retentionPolicy.dryRunOnly, true);
  assert.strictEqual(contract.retentionPolicy.physicalDeletion, false);
  assert.strictEqual(contract.retentionPolicy.driveEnumeration, false);
  assert.strictEqual(contract.createsTrigger, false);
});

test('retention planner protects mandatory artifacts and only reviews old backups', () => {
  const module = loadModule();
  const nowMs = Date.parse('2026-08-05T09:00:00.000Z');
  const plan = module.Test.planRetention({
    auditId: 'AUD_TEST',
    operationId: 'OP_TEST',
    plannedAt: '2026-08-05T09:00:00.000Z',
    nowMs,
    releases: [{
      release_id: 'REL_CURRENT', version: '4.0.0-alpha.7.4.42',
      status: 'INSTALLED', installed_at: '2026-08-04T15:00:00.000Z'
    }],
    backups: [
      { backup_id: 'BKP_NEW_1', status: 'SUCCESS', finished_at: '2026-08-05T01:00:00.000Z' },
      { backup_id: 'BKP_NEW_2', status: 'SUCCESS', finished_at: '2026-08-04T01:00:00.000Z' },
      { backup_id: 'BKP_OLD', status: 'SUCCESS', finished_at: '2026-05-01T01:00:00.000Z' }
    ],
    operations: [{ operation_id: 'OP_ACTIVE', operation_type: 'X', status: 'PAUSED', requested_at: '2026-08-05T08:00:00.000Z' }],
    audits: [{ audit_id: 'AUD_PRIOR', audit_status: 'PASS', finished_at: '2026-08-01T00:00:00.000Z' }],
    gate7: { accepted: true, evidenceId: 'G7E', evidenceHash: 'HASH', acceptedAt: '2026-08-04T13:00:00.000Z' }
  });
  assert.strictEqual(plan.dryRun, true);
  assert.strictEqual(plan.physicalDeletion, false);
  assert(plan.rows.every((row) => Number(row.physical_deletion) === 0));
  assert(plan.rows.some((row) => row.artifact_class === 'ACCEPTED_RELEASE' && Number(row.protected_flag) === 1));
  assert(plan.rows.some((row) => row.artifact_class === 'GATE_ACCEPTANCE_EVIDENCE' && Number(row.protected_flag) === 1));
  assert(plan.rows.some((row) => row.artifact_class === 'VERIFIED_BASELINE' && Number(row.protected_flag) === 1));
  assert(plan.rows.some((row) => row.artifact_class === 'ACTIVE_OPERATION_CHECKPOINT' && Number(row.protected_flag) === 1));
  assert(plan.rows.some((row) => row.artifact_id === 'BKP_OLD' && row.candidate_action === 'REVIEW_FOR_RETENTION'));
});

test('retention plan is deterministic and fingerprinted', () => {
  const module = loadModule();
  const request = {
    auditId: 'AUD_X', operationId: 'OP_X', plannedAt: '2026-08-05T09:00:00.000Z',
    nowMs: Date.parse('2026-08-05T09:00:00.000Z'),
    releases: [{ release_id: 'R', version: 'V', installed_at: '2026-08-04T00:00:00.000Z' }],
    backups: [{ backup_id: 'B', status: 'SUCCESS', finished_at: '2026-08-04T01:00:00.000Z' }],
    operations: [], audits: [], gate7: { accepted: false }
  };
  const left = module.Test.planRetention(request);
  const right = module.Test.planRetention(JSON.parse(JSON.stringify(request)));
  assert.strictEqual(left.fingerprint, right.fingerprint);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(left.rows)), JSON.parse(JSON.stringify(right.rows)));
  assert(left.rows.every((row) => row.snapshot_fingerprint === left.fingerprint));
});


function runtimeHarness() {
  class Range {
    constructor(sheet, row, col, numRows, numCols) {
      this.sheet = sheet;
      this.row = row;
      this.col = col;
      this.numRows = numRows;
      this.numCols = numCols;
    }
    getValues() {
      const values = [];
      for (let r = 0; r < this.numRows; r += 1) {
        const source = this.sheet.values[this.row - 1 + r] || [];
        const row = [];
        for (let c = 0; c < this.numCols; c += 1) {
          row.push(source[this.col - 1 + c] === undefined ? '' : source[this.col - 1 + c]);
        }
        values.push(row);
      }
      return values;
    }
    setValues(values) {
      for (let r = 0; r < this.numRows; r += 1) {
        const targetRow = this.row - 1 + r;
        this.sheet.values[targetRow] = this.sheet.values[targetRow] || [];
        for (let c = 0; c < this.numCols; c += 1) {
          this.sheet.values[targetRow][this.col - 1 + c] = values[r][c];
        }
      }
      return this;
    }
    clearContent() {
      for (let r = 0; r < this.numRows; r += 1) {
        const targetRow = this.row - 1 + r;
        this.sheet.values[targetRow] = this.sheet.values[targetRow] || [];
        for (let c = 0; c < this.numCols; c += 1) {
          this.sheet.values[targetRow][this.col - 1 + c] = '';
        }
      }
      return this;
    }
  }
  class Sheet {
    constructor(headers, objects) {
      this.headers = headers.slice();
      this.values = [headers.slice()];
      (objects || []).forEach((object) => {
        this.values.push(headers.map((header) => object[header] === undefined ? '' : object[header]));
      });
    }
    getLastRow() {
      let last = 0;
      this.values.forEach((row, index) => {
        if ((row || []).some((value) => value !== '')) last = index + 1;
      });
      return last;
    }
    getLastColumn() { return this.headers.length; }
    getRange(row, col, numRows, numCols) {
      return new Range(this, row, col, numRows, numCols);
    }
  }
  const evidenceHeaders = contract.readModels.FULL_AUDIT_EVIDENCE;
  const retentionHeaders = contract.readModels.RETENTION_REGISTRY;
  const tables = {
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
      'finished_at', 'checkpoint_json', 'result_json', 'error_code', 'error_message', 'release_version'
    ],
    SYSTEM_LOG: [
      'log_id', 'logged_at', 'level', 'component', 'operation_id', 'step_id',
      'execution_id', 'event_code', 'message', 'details_json', 'release_version'
    ],
    RAW_LOAD_REGISTRY: [
      'load_id', 'operation_id', 'source_id', 'source_name', 'source_hash', 'target_table',
      'status', 'rows_received', 'rows_staged', 'rows_inserted', 'rows_revised',
      'rows_unchanged', 'rows_reversed', 'started_at', 'finished_at', 'error_code',
      'error_message', 'release_version'
    ],
    PUBLISH_RECONCILIATION: [
      'reconciliation_id', 'checked_at', 'full_build_id', 'incremental_build_id',
      'sheet_name', 'baseline_rows', 'full_rows', 'incremental_rows', 'baseline_hash',
      'full_hash', 'incremental_hash', 'full_equals_baseline', 'incremental_equals_full',
      'status', 'details_json', 'release_version'
    ],
    BACKUP_REGISTRY: [
      'backup_id', 'operation_id', 'request_type', 'status', 'scheduled_date',
      'backup_folder_id', 'dwh_source_id', 'dwh_backup_id', 'dwh_backup_name',
      'dwh_backup_url', 'publish_source_id', 'publish_backup_id', 'publish_backup_name',
      'publish_backup_url', 'manifest_file_id', 'manifest_url', 'manifest_hash',
      'operation_boundary_json', 'started_at', 'finished_at', 'error_code',
      'error_message', 'release_version', 'created_by'
    ],
    DATASET_STATUS: [
      'dataset_id', 'dataset_label', 'source_table', 'source_status', 'health_status',
      'freshness_status', 'latest_activity_at', 'age_minutes', 'freshness_threshold_minutes',
      'latest_record_key', 'latest_period', 'latest_load_id', 'active_operation_id',
      'active_phase', 'progress_percent', 'checkpoint_cursor', 'latest_backup_id',
      'trigger_status', 'issue_count', 'next_action', 'observed_at',
      'snapshot_fingerprint', 'release_version'
    ],
    ISSUE_REGISTRY: [
      'issue_key', 'source_table', 'source_record_key', 'dataset_id', 'operation_id',
      'severity', 'issue_code', 'lifecycle_status', 'source_status', 'first_seen_at',
      'last_seen_at', 'occurrence_count', 'summary', 'details_json', 'resolution',
      'next_action', 'observed_at', 'snapshot_fingerprint', 'release_version'
    ],
    FULL_AUDIT_EVIDENCE: evidenceHeaders,
    RETENTION_REGISTRY: retentionHeaders
  };
  const rows = {
    RELEASE_REGISTRY: [{
      release_id: 'REL_CURRENT', version: '4.0.0-alpha.7.4.42', status: 'INSTALLED',
      installed_at: '2026-08-04T15:26:29.478Z'
    }],
    OPERATION_QUEUE: [{
      operation_id: 'OP_AUDIT', operation_type: 'FULL_AUDIT_V4', status: 'RUNNING',
      current_phase: 'DISCOVER', requested_at: '2026-08-05T08:50:00.000Z',
      started_at: '2026-08-05T08:50:01.000Z', release_version: '4.0.0-alpha.7.4.42'
    }],
    OPERATION_STEPS: [],
    SYSTEM_LOG: [{ log_id: 'LOG', logged_at: '2026-08-05T08:49:00.000Z', level: 'INFO' }],
    RAW_LOAD_REGISTRY: [{
      load_id: 'LOAD', operation_id: 'OP_OLD', status: 'COMMITTED',
      started_at: '2026-08-04T13:00:00.000Z', finished_at: '2026-08-04T13:06:00.000Z'
    }],
    PUBLISH_RECONCILIATION: [{
      reconciliation_id: 'REC', checked_at: '2026-08-03T20:30:57.289Z', status: 'SUCCESS'
    }],
    BACKUP_REGISTRY: [{
      backup_id: 'BKP_DAILY_20260805', operation_id: 'OP_BACKUP', status: 'SUCCESS',
      dwh_backup_name: 'DWH backup', started_at: '2026-08-05T01:05:00.000Z',
      finished_at: '2026-08-05T01:07:14.896Z'
    }],
    DATASET_STATUS: [{
      dataset_id: 'SYSTEM_RELEASE', health_status: 'HEALTHY', observed_at: '2026-08-05T08:07:14.821Z',
      snapshot_fingerprint: 'DATASET_FP', release_version: '4.0.0-alpha.7.4.42'
    }],
    ISSUE_REGISTRY: [],
    FULL_AUDIT_EVIDENCE: [],
    RETENTION_REGISTRY: []
  };
  const sheets = {};
  Object.keys(tables).forEach((name) => { sheets[name] = new Sheet(tables[name], rows[name]); });
  const spreadsheet = { getSheetByName: (name) => sheets[name] || null };
  const coreTables = Object.assign({}, tables);
  delete coreTables.RAW_LOAD_REGISTRY;
  delete coreTables.PUBLISH_RECONCILIATION;
  const makeError = (code, message, details) => {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  };
  const context = {
    console, Date, JSON, Math, Object, String, Number, Boolean, Array,
    Session: { getEffectiveUser: () => ({ getEmail: () => 'analyst@example.com' }) },
    SpreadsheetApp: { openById: () => spreadsheet },
    Utilities: {
      formatDate: () => '20260805T090000000Z',
      getUuid: () => '00000000-0000-0000-0000-ABCDEF123456'
    },
    AKORT: {
      Core: {
        Tables: coreTables,
        Sheets: {
          readObjects: (sheet) => {
            const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
            return values.slice(1).map((row, index) => {
              const object = { __row: index + 2 };
              values[0].forEach((header, col) => { object[header] = row[col]; });
              return object;
            });
          }
        },
        canonicalJson,
        safeJson: (value) => JSON.stringify(value),
        sha256,
        now: () => new Date().toISOString(),
        error: makeError,
        safeRun: (name, fn) => {
          try {
            const value = fn({ executionId: 'EXE_TEST', logger: {} });
            return value && typeof value.ok === 'boolean' ? value : { ok: true, status: 'SUCCESS', data: value };
          } catch (error) {
            return { ok: false, status: 'FAILED', code: error.code, message: error.message, details: error.details };
          }
        }
      },
      Result: {
        success: (message, data) => ({ ok: true, status: 'SUCCESS', message, data }),
        failure: (code, message, details) => ({ ok: false, status: 'FAILED', code, message, details })
      },
      Release: {
        version: '4.0.0-alpha.7.4.42', baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
        manifest: () => ({ baselineLabel: 'VERIFIED_BASELINE_2026-07-10', baselineDate: '2026-07-10' })
      },
      EnvironmentGuard: { assertDev: () => true },
      Config: {
        readSystemSettings: () => ({ PUBLISH_USER_PIPELINE_ENABLED: false }),
        load: () => ({ resources: { dwhSpreadsheetId: 'DWH' } })
      },
      Beta15CompactObservability: {
        status: () => ({ ok: true, data: { healthy: true, issueCount: 0, datasetCount: 8, overallStatus: 'HEALTHY', nextActions: [] } })
      },
      Alpha74Gate7Acceptance: {
        status: () => ({ ok: true, data: {
          gate7Accepted: true, implementationStatus: 'GATE7_ACCEPTED',
          industryState: { evidenceId: 'G7E_TEST', evidenceHash: 'G7_HASH', acceptedAt: '2026-08-04T13:08:44.181Z' },
          previewState: { matrixFingerprint: 'MATRIX_FP' }
        } })
      },
      Beta14OperationalHardening: {
        enqueueGuarded: () => ({ ok: true, data: {} }),
        status: () => ({ ok: true, data: { operationInventory: { nonTerminalCount: 0 } } })
      },
      OperationEngine: {
        enqueue: () => ({ ok: true, data: {} }),
        status: () => ({ ok: true, data: {} }),
        resume: () => ({ ok: true })
      }
    }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: sourcePath }).runInContext(context);
  return { module: context.AKORT.Beta16FullAuditRetention, sheets };
}

test('preflight passes when accepted non-Core registries are absent from Core.Tables', () => {
  const harness = runtimeHarness();
  const result = harness.module.preflight();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.readyToInstall, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.data.blockers)), []);
});

test('all Full Audit phases converge in an in-memory Apps Script runtime', () => {
  const harness = runtimeHarness();
  const operationContext = {
    operation: { operation_id: 'OP_AUDIT', operation_type: 'FULL_AUDIT_V4' },
    checkpoint: {
      input: { auditId: 'AUD_RUNTIME', reason: 'Runtime verification', retentionDryRun: true },
      handlerState: {}
    }
  };
  [
    'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW',
    'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS', 'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST', 'RECONCILING_AGGREGATES',
    'UPDATE_STATUS', 'QUICK_AUDIT', 'FINALIZING'
  ].forEach((phase) => {
    const outcome = harness.module.__executePhaseForHandler(phase, operationContext);
    assert(outcome && typeof outcome === 'object', phase);
  });
  const evidence = harness.sheets.FULL_AUDIT_EVIDENCE;
  const retention = harness.sheets.RETENTION_REGISTRY;
  assert.strictEqual(evidence.getLastRow(), 2);
  assert(retention.getLastRow() > 1);
  const evidenceRow = evidence.getRange(2, 1, 1, evidence.getLastColumn()).getValues()[0];
  const statusIndex = contract.readModels.FULL_AUDIT_EVIDENCE.indexOf('audit_status');
  assert.strictEqual(evidenceRow[statusIndex], 'PASS');
  const physicalIndex = contract.readModels.RETENTION_REGISTRY.indexOf('physical_deletion');
  const dryRunIndex = contract.readModels.RETENTION_REGISTRY.indexOf('dry_run');
  retention.getRange(2, 1, retention.getLastRow() - 1, retention.getLastColumn()).getValues()
    .forEach((row) => {
      assert.strictEqual(Number(row[physicalIndex]), 0);
      assert.strictEqual(Number(row[dryRunIndex]), 1);
    });
});

test('failed checks produce fail-closed evidence semantics', () => {
  const module = loadModule();
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(module.Test.checkSummary([
      { status: 'PASS' }, { status: 'WARN' }, { status: 'FAIL' }
    ]))),
    {
      total: 3, passed: 1, warned: 1, failed: 1,
      status: 'FAIL', nextAction: 'REVIEW_FULL_AUDIT_FAILURES'
    }
  );
  assert(source.includes("requiresReview: true"));
  assert(source.includes("'BETA16_FULL_AUDIT_FAILED'"));
});

test('public facade is narrow and has no delete or execute-retention API', () => {
  contract.publicApi.forEach((name) => assert(source.includes('function ' + name + '('), name));
  ['Delete', 'ExecuteRetention', 'ApplyRetention', 'Purge'].forEach((word) => {
    assert(!contract.publicApi.some((name) => name.includes(word)), word);
  });
});

test('r1 inventory regression is phase-aware after r2 closes the gap', () => {
  assert(inventoryTest.includes('implementationPresent'));
  assert(inventoryTest.includes('gap is absent before r2 or closed exactly by r2'));
});

test('user pipeline, production and singleton boundaries remain protected', () => {
  assert(!/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source));
  assert.strictEqual(contract.productionWrite, false);
  assert.strictEqual(contract.enablesUserPipeline, false);
  assert.strictEqual(contract.newQueue, false);
  assert.strictEqual(contract.newExecutor, false);
  assert.strictEqual(contract.newDispatcher, false);
  assert(markdown.includes('no second queue, executor, dispatcher or trigger'));
});

test('forbidden backup fixture remains absent', () => {
  assert(!fs.existsSync(path.join(
    root, 'src', '12_Alpha6Tests.js.backup-smoke-fixture-20260713_135449'
  )));
});

test('r2 suite is wired after the inventory suite', () => {
  assert.strictEqual(
    pkg.scripts['test:beta16-full-audit-retention'],
    'node tests/beta16_full_audit_retention_static.test.js'
  );
  const inventoryCommand = 'npm run test:beta16-full-audit-retention-inventory';
  const implementationCommand = 'npm run test:beta16-full-audit-retention';
  const commands = pkg.scripts.test.split(' && ');
  assert(commands.includes(inventoryCommand));
  assert(commands.includes(implementationCommand));
  assert(commands.indexOf(inventoryCommand) < commands.indexOf(implementationCommand));
});

console.log(JSON.stringify({
  suite: 'beta16_full_audit_retention_static',
  packageVersion: contract.packageVersion,
  total,
  failed
}, null, 2));
if (failed) process.exit(1);
