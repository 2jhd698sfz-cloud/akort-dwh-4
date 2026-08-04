const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
  Buffer,
  Date,
  JSON,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  RegExp,
  isFinite,
  parseInt,
  Utilities: {
    newBlob(value) {
      const bytes = Buffer.from(String(value), 'utf8');
      return { getBytes: () => Array.from(bytes) };
    }
  }
});

context.AKORT = {
  Core: {
    sha256(value) {
      return crypto.createHash('sha256').update(String(value)).digest('hex');
    },
    error(code, message, details) {
      const error = new Error(message);
      error.code = code;
      error.details = details || {};
      return error;
    },
    now() {
      return '2026-08-02T00:00:00.000Z';
    }
  }
};

vm.runInContext(
  fs.readFileSync(path.join(root, 'src/06_ExistingSourceParsers.js'), 'utf8'),
  context,
  { filename: 'src/06_ExistingSourceParsers.js' }
);

context.AKORT.IncrementalPublish = {
  PublishHeaders: {
    PUBLISH_PRICES_WEEKLY: ['weekly_header'],
    PUBLISH_PRICES_MONTHLY: ['monthly_header'],
    PUBLISH_INDUSTRY: ['industry_header']
  }
};
context.AKORT.AggregateContract = { Headers: ['aggregate_header'] };

vm.runInContext(
  fs.readFileSync(path.join(root, 'src/28_Alpha74Gate6Acceptance.js'), 'utf8'),
  context,
  { filename: 'src/28_Alpha74Gate6Acceptance.js' }
);

const G = context.AKORT.Alpha74Gate6Acceptance;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function digest(rows, headersHash = 'HEADERS') {
  const work = {
    rows: rows.length,
    columns: rows.length ? rows[0].length : 2,
    headersHash,
    primary: [],
    secondary: []
  };
  G.Test.addRowsToDigest(work, rows);
  return {
    rows: work.rows,
    columns: work.columns,
    headersHash,
    hash: G.Test.digestValue(work),
    mode: 'ROW_MULTISET_V1'
  };
}

function allTargets(value) {
  const out = {};
  for (const target of Array.from(G.TargetSheets)) out[target] = value[target] || digest([[target, 1]]);
  return out;
}

test('Gate 6 metadata and authoritative target set are exact', () => {
  assert.equal(G.Version, '4.0-alpha74-gate6-acceptance-17');
  assert.equal(G.Release, '4.0.0-alpha.7.4.35');
  assert.equal(G.EvidenceSchemaVersion, '4.0-alpha74-gate6-evidence-1');
  assert.equal(G.StateSchemaVersion, '4.0-alpha74-gate6-state-1');
  assert.equal(G.ControlSheetName, 'GATE6_CANARY_INPUT');
  assert.deepEqual(Array.from(G.TargetSheets), [
    'PUBLISH_PRICES_WEEKLY',
    'PUBLISH_PRICES_MONTHLY',
    'PUBLISH_INDUSTRY',
    'PUBLISH_PRICE_AGGREGATES'
  ]);
});

test('Gate 6 reads Publish schemas only through exported contracts', () => {
  assert.deepEqual(Array.from(G.Test.expectedHeaders('PUBLISH_PRICES_WEEKLY')), ['weekly_header']);
  assert.deepEqual(Array.from(G.Test.expectedHeaders('PUBLISH_PRICES_MONTHLY')), ['monthly_header']);
  assert.deepEqual(Array.from(G.Test.expectedHeaders('PUBLISH_INDUSTRY')), ['industry_header']);
  assert.deepEqual(Array.from(G.Test.expectedHeaders('PUBLISH_PRICE_AGGREGATES')), ['aggregate_header']);
});

test('exact Alpha.7.4.19 baseline-header failure is eligible for durable recovery only before writes', () => {
  const incident = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.19',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    status: 'FAILED',
    phase: 'FAILED',
    failedFromPhase: 'BASELINE_SCAN',
    operations: { canary: '', reversal: '', restore: '' },
    loads: { canary: '', reversal: '', restore: '' },
    digests: {},
    scan: {
      schemaVersion: '4.0-alpha74-gate6-scan-1',
      bucket: 'baseline',
      targetIndex: 0,
      work: null
    },
    metrics: { digestChunks: 0, rowsScanned: 0 },
    artifacts: {
      dwhBackup: { id: 'DWH_BACKUP' },
      publishBackup: { id: 'PUBLISH_BACKUP' }
    },
    lastError: {
      code: 'ALPHA74_GATE6_UNEXPECTED_ERROR',
      message: 'AKORT_V300 is not defined'
    }
  };
  assert.equal(G.Test.baselineHeaderIncident(incident), true);
  const afterWrite = JSON.parse(JSON.stringify(incident));
  afterWrite.operations.canary = 'OP_CANARY';
  assert.equal(G.Test.baselineHeaderIncident(afterWrite), false);
  const afterScan = JSON.parse(JSON.stringify(incident));
  afterScan.metrics.rowsScanned = 1;
  assert.equal(G.Test.baselineHeaderIncident(afterScan), false);
  const wrongError = JSON.parse(JSON.stringify(incident));
  wrongError.lastError.message = 'Some other failure';
  assert.equal(G.Test.baselineHeaderIncident(wrongError), false);
});

test('Gate 6 source parser treats terminal unit punctuation as equivalent', () => {
  const parser = context.AKORT.ExistingSourceParsers.Test;
  assert.equal(parser.unitKey('10 шт'), 'ten_pieces');
  assert.equal(parser.unitKey('10 шт.'), 'ten_pieces');
  assert.equal(parser.unitKey('шт.'), 'piece');
  assert.deepEqual(
    JSON.parse(JSON.stringify(parser.convertUnit(123.45, '10 шт', '10 шт.'))),
    { value: 123.45 }
  );
});

test('runtime-context setting accepts Config-typed objects and serialized JSON', () => {
  const typed = { adapter_mode: 'ALPHA6_ACCEPTED_PARITY' };
  assert.deepEqual(JSON.parse(JSON.stringify(G.Test.normalizedJsonSetting(typed))), typed);
  assert.deepEqual(
    JSON.parse(JSON.stringify(G.Test.normalizedJsonSetting('{"adapter_mode":"ALPHA6_ACCEPTED_PARITY"}'))),
    typed
  );
  assert.deepEqual(JSON.parse(JSON.stringify(G.Test.normalizedJsonSetting(null))), {});
  assert.throws(
    () => G.Test.normalizedJsonSetting('["not-an-object"]'),
    error => error.code === 'ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID'
  );
});

test('exact Alpha.7.4.20 runtime-context incident resumes only after RAW and price Publish and before aggregate staging', () => {
  const operationId = 'OP_SOURCE_FILE_LOAD_V4_CANARY';
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.20',
    status: 'FAILED',
    phase: 'FAILED',
    failedFromPhase: 'RUN_CANARY',
    operations: { canary: operationId, reversal: '', restore: '' },
    artifacts: {
      dwhBackup: { id: 'DWH_BACKUP' },
      publishBackup: { id: 'PUBLISH_BACKUP' }
    },
    lastError: { code: 'AGGREGATE_RUNTIME_CONTEXT_MISSING' }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'FAILED',
    current_phase: 'MATERIALIZING_AGGREGATE_INPUTS',
    error_code: 'AGGREGATE_RUNTIME_CONTEXT_MISSING',
    checkpoint: {
      nextPhase: 'MATERIALIZING_AGGREGATE_INPUTS',
      completedPhases: ['DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW', 'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT'],
      handlerState: { loadId: 'LOAD_CANARY' },
      aggregate: { status: 'IMPACT_PREPARED' }
    }
  };
  assert.equal(G.Test.runtimeContextIncident(state, operation), true);
  const beforePublish = JSON.parse(JSON.stringify(operation));
  beforePublish.checkpoint.completedPhases = beforePublish.checkpoint.completedPhases.filter(phase => phase !== 'UPDATE_PUBLISH');
  assert.equal(G.Test.runtimeContextIncident(state, beforePublish), false);
  const afterMaterialization = JSON.parse(JSON.stringify(operation));
  afterMaterialization.checkpoint.completedPhases.push('MATERIALIZING_AGGREGATE_INPUTS');
  assert.equal(G.Test.runtimeContextIncident(state, afterMaterialization), false);
});

test('exact stopped Alpha.7.4.22 pre-staging checkpoint is eligible for bounded phase recovery', () => {
  const operationId = 'OP_SOURCE_FILE_LOAD_V4_CANARY';
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.22',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    status: 'STOPPED',
    phase: 'STOPPED',
    stoppedFromPhase: 'RUN_CANARY',
    operations: { canary: operationId, reversal: '', restore: '' },
    artifacts: {
      dwhBackup: { id: 'DWH_BACKUP' },
      publishBackup: { id: 'PUBLISH_BACKUP' }
    }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'PAUSED',
    current_phase: 'STAGING_AGGREGATE_ROWS',
    checkpoint: {
      nextPhase: 'STAGING_AGGREGATE_ROWS',
      completedPhases: [
        'COMMIT_RAW', 'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
        'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES'
      ],
      control: { stopRequested: true },
      handlerState: { loadId: 'LOAD_CANARY' },
      aggregate: {
        status: 'CALCULATED',
        calculationCursor: 392,
        calculationGroupCount: 392,
        stagingCursor: 0,
        stageFingerprint: '',
        expectedStageRows: 0
      }
    }
  };
  assert.equal(G.Test.monolithicStageIncident(state, operation), true);
  const afterStagingStarted = JSON.parse(JSON.stringify(operation));
  afterStagingStarted.checkpoint.aggregate.stagingCursor = 1;
  assert.equal(G.Test.monolithicStageIncident(state, afterStagingStarted), false);
  const afterPublication = JSON.parse(JSON.stringify(operation));
  afterPublication.checkpoint.completedPhases.push('STAGING_AGGREGATE_ROWS');
  assert.equal(G.Test.monolithicStageIncident(state, afterPublication), false);
});

test('Gate 6 recognizes only exact uniform before/after stage-status recovery boundaries', () => {
  const row = status => ({
    stage_status: status,
    expected_target_fingerprint: '',
    verified_at: '',
    release_version: '4.0.0-alpha.7.4.22'
  });
  assert.equal(G.Test.stageRecoveryBoundary([row('CALCULATED'), row('CALCULATED')]), 'BEFORE_STAGE_STATUS_WRITE');
  assert.equal(G.Test.stageRecoveryBoundary([row('STAGED'), row('STAGED')]), 'AFTER_STAGE_STATUS_WRITE_LOST_RESPONSE');
  assert.equal(G.Test.stageRecoveryBoundary([row('CALCULATED'), row('STAGED')]), '');
  assert.equal(G.Test.stageRecoveryBoundary([{ ...row('STAGED'), expected_target_fingerprint: 'TARGET_FP' }]), '');
  assert.equal(G.Test.stageRecoveryBoundary([{ ...row('STAGED'), verified_at: '2026-08-02T00:00:00.000Z' }]), '');
  assert.equal(G.Test.stageRecoveryBoundary([{ ...row('STAGED'), release_version: '4.0.0-alpha.7.4.24' }]), '');
});

test('exact Alpha.7.4.24 monthly period-label readback incident is eligible only at the first publication boundary', () => {
  const operationId = 'OP_SOURCE_FILE_LOAD_V4_CANARY';
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.24',
    status: 'FAILED',
    phase: 'FAILED',
    failedFromPhase: 'RUN_CANARY',
    operations: { canary: operationId, reversal: '', restore: '' },
    artifacts: {
      dwhBackup: { id: 'DWH_BACKUP' },
      publishBackup: { id: 'PUBLISH_BACKUP' }
    },
    recovery: {
      mode: 'BOUNDED_STAGE_AFTER_STATE_RECOVERY',
      validatedStageRows: 392,
      validatedStageSeries: 392,
      validatedStageFingerprint: 'STAGE_FP'
    },
    lastError: { code: 'AGGREGATE_PUBLISH_READBACK_MISMATCH' }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'FAILED_REQUIRES_REVIEW',
    current_phase: 'UPDATING_AGGREGATES',
    error_code: 'AGGREGATE_PUBLISH_READBACK_MISMATCH',
    checkpoint: {
      nextPhase: 'UPDATING_AGGREGATES',
      completedPhases: [
        'COMMIT_RAW', 'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
        'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES',
        'STAGING_AGGREGATE_ROWS'
      ],
      handlerState: { loadId: 'LOAD_CANARY' },
      aggregate: {
        status: 'STAGED',
        expectedStageRows: 392,
        calculationGroupCount: 392,
        calculationCursor: 392,
        stagingCursor: 392,
        stageStatusCursor: 392,
        publishSeriesCursor: 0,
        publishBatches: [],
        stageFingerprint: 'STAGE_FP'
      }
    }
  };
  assert.equal(G.Test.monthlyPeriodLabelIncident(state, operation), true);
  const afterCursor = JSON.parse(JSON.stringify(operation));
  afterCursor.checkpoint.aggregate.publishSeriesCursor = 32;
  assert.equal(G.Test.monthlyPeriodLabelIncident(state, afterCursor), false);
  const wrongError = JSON.parse(JSON.stringify(operation));
  wrongError.error_code = 'AGGREGATE_PUBLISH_THIRD_STATE';
  assert.equal(G.Test.monthlyPeriodLabelIncident(state, wrongError), false);

  const prepared = JSON.parse(JSON.stringify(operation));
  prepared.status = 'PAUSED';
  prepared.error_code = '';
  assert.equal(G.Test.monthlyPeriodLabelOperationPrepared(state, prepared), true);
  prepared.checkpoint.aggregate.publishSeriesCursor = 32;
  assert.equal(G.Test.monthlyPeriodLabelOperationPrepared(state, prepared), false);
});

test('exact stopped Alpha.7.4.26 partial RAW reversal is eligible for durable chunk adoption', () => {
  const operationId = 'OP_RAW_REVERSAL_V4_20260802T191111384Z_3683C13EE282';
  const targetLoadId = 'LOAD_20260802T123559854Z_EFB27B040FBC';
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.26',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    status: 'STOPPED',
    phase: 'STOPPED',
    stoppedFromPhase: 'RUN_REVERSAL',
    operations: { canary: 'OP_CANARY', reversal: operationId, restore: '' },
    loads: { canary: targetLoadId, reversal: '', restore: '' },
    artifacts: { dwhBackup: { id: 'DWH_BACKUP' }, publishBackup: { id: 'PUBLISH_BACKUP' } }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'RAW_REVERSAL_V4',
    release_version: '4.0.0-alpha.7.4.26',
    status: 'PAUSED',
    current_phase: 'COMMIT_RAW',
    checkpoint: {
      nextPhase: 'COMMIT_RAW',
      completedPhases: ['DISCOVER', 'VALIDATE', 'PARSE', 'STAGE'],
      control: { stopRequested: true },
      aggregate: { status: 'NOT_STARTED' },
      rawStore: {}
    }
  };
  const inspection = {
    operationId,
    targetLoadId,
    targetTable: 'RAW_PRICES_WEEKLY',
    targetLoadStatus: 'COMMITTED',
    reversalLoadId: 'LOAD_REV_20260802T193440542Z_9D4AB8FFFF24',
    totalRows: 50,
    completedRows: 8,
    pendingRows: 42,
    complete: false
  };
  assert.equal(G.Test.rawReversalChunkIncident(state, operation, inspection), true);
  const restarted = JSON.parse(JSON.stringify(inspection));
  restarted.completedRows = 0;
  restarted.pendingRows = 50;
  assert.equal(G.Test.rawReversalChunkIncident(state, operation, restarted), false);
  const aggregateStarted = JSON.parse(JSON.stringify(operation));
  aggregateStarted.checkpoint.aggregate.status = 'IMPACT_PREPARED';
  assert.equal(G.Test.rawReversalChunkIncident(state, aggregateStarted, inspection), false);
});

test('exact stopped Alpha.7.4.29 rollback scan capacity incident resumes only after accepted reversal', () => {
  const operationId = 'OP_RAW_REVERSAL_V4_20260802T191111384Z_3683C13EE282';
  const targetLoadId = 'LOAD_20260802T123559854Z_EFB27B040FBC';
  const weekly = digest([['WEEKLY', 1]]);
  const monthly = digest([['MONTHLY', 1]]);
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.29',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    status: 'STOPPED',
    phase: 'STOPPED',
    stoppedFromPhase: 'ROLLBACK_SCAN',
    operations: { canary: 'OP_CANARY', reversal: operationId, restore: '' },
    loads: { canary: targetLoadId, reversal: 'LOAD_REVERSAL', restore: '' },
    artifacts: { dwhBackup: { id: 'DWH_BACKUP' }, publishBackup: { id: 'PUBLISH_BACKUP' } },
    digests: {
      baseline: { PUBLISH_PRICES_WEEKLY: weekly, PUBLISH_PRICES_MONTHLY: monthly },
      rollback: { PUBLISH_PRICES_WEEKLY: weekly, PUBLISH_PRICES_MONTHLY: monthly }
    },
    scan: {
      schemaVersion: '4.0-alpha74-gate6-scan-1',
      bucket: 'rollback',
      targetIndex: 2,
      work: null
    },
    acceptance: { canaryOperationAccepted: true, reversalOperationAccepted: true }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'RAW_REVERSAL_V4',
    status: 'SUCCESS',
    current_phase: 'SUCCESS'
  };
  assert.equal(G.Test.rollbackScanStateCapacityIncident(state, operation), true);
  const restoreStarted = JSON.parse(JSON.stringify(state));
  restoreStarted.operations.restore = 'OP_RESTORE';
  assert.equal(G.Test.rollbackScanStateCapacityIncident(restoreStarted, operation), false);
  const industryStarted = JSON.parse(JSON.stringify(state));
  industryStarted.scan.work = { target: 'PUBLISH_INDUSTRY', cursor: 1000 };
  assert.equal(G.Test.rollbackScanStateCapacityIncident(industryStarted, operation), false);
  const reversalNotAccepted = JSON.parse(JSON.stringify(state));
  reversalNotAccepted.acceptance.reversalOperationAccepted = false;
  assert.equal(G.Test.rollbackScanStateCapacityIncident(reversalNotAccepted, operation), false);
});

test('exact Alpha.7.4.30 weekly rollback period incident is eligible only at the +196 aggregate boundary', () => {
  const canaryOperationId = 'OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9';
  const reversalOperationId = 'OP_RAW_REVERSAL_V4_20260802T191111384Z_3683C13EE282';
  const canaryLoadId = 'LOAD_20260802T123559854Z_EFB27B040FBC';
  const exact = (rows, hash) => ({ rows, columns: 29, headersHash: 'AGGREGATE_HEADERS', hash, mode: 'ROW_MULTISET_V1' });
  const weekly = digest([['WEEKLY', 1]]);
  const monthly = digest([['MONTHLY', 1]]);
  const industry = digest([['INDUSTRY', 1]]);
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.30',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    status: 'FAILED',
    phase: 'FAILED',
    failedFromPhase: 'VERIFY_ROLLBACK',
    lastError: { code: 'ALPHA74_GATE6_ROLLBACK_MISMATCH' },
    operations: { canary: canaryOperationId, reversal: reversalOperationId, restore: '' },
    loads: { canary: canaryLoadId, reversal: 'LOAD_REV_20260802T193440542Z_9D4AB8FFFF24', restore: '' },
    acceptance: { canaryOperationAccepted: true, reversalOperationAccepted: true },
    scan: null,
    digests: {
      baseline: {
        PUBLISH_PRICES_WEEKLY: weekly,
        PUBLISH_PRICES_MONTHLY: monthly,
        PUBLISH_INDUSTRY: industry,
        PUBLISH_PRICE_AGGREGATES: exact(61636, 'BASELINE')
      },
      postCanary: { PUBLISH_PRICE_AGGREGATES: exact(62028, 'POST_CANARY') },
      rollback: {
        PUBLISH_PRICES_WEEKLY: weekly,
        PUBLISH_PRICES_MONTHLY: monthly,
        PUBLISH_INDUSTRY: industry,
        PUBLISH_PRICE_AGGREGATES: exact(61832, 'ROLLBACK')
      }
    },
    artifacts: { dwhBackup: { id: 'DWH_BACKUP' }, publishBackup: { id: 'PUBLISH_BACKUP' } }
  };
  const canaryOperation = {
    operation_id: canaryOperationId,
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'SUCCESS',
    current_phase: 'SUCCESS',
    checkpoint: {
      handlerState: { loadId: canaryLoadId },
      aggregate: {
        status: 'SUCCESS',
        expectedStageRows: 392,
        calculationGroupCount: 392,
        affectedSeriesKeys: new Array(392).fill(0).map((_, index) => `CANARY_${index}`),
        stageFingerprint: 'STAGE'
      }
    }
  };
  const reversalOperation = {
    operation_id: reversalOperationId,
    operation_type: 'RAW_REVERSAL_V4',
    status: 'SUCCESS',
    current_phase: 'SUCCESS',
    checkpoint: {
      rawStore: { loadId: 'LOAD_REV_20260802T193440542Z_9D4AB8FFFF24' },
      aggregate: {
        status: 'SUCCESS',
        expectedStageRows: 196,
        calculationGroupCount: 196,
        affectedSeriesKeys: new Array(196).fill(0).map((_, index) => `AKORT_MONTHLY_DERIVED|monthly|SERIES_${index}`)
      }
    }
  };
  assert.equal(G.Test.weeklyRollbackPeriodIncident(state, canaryOperation, reversalOperation), true);
  const safelyStopped = JSON.parse(JSON.stringify(state));
  safelyStopped.status = 'STOPPED';
  safelyStopped.phase = 'STOPPED';
  safelyStopped.stoppedFromPhase = 'VERIFY_ROLLBACK';
  safelyStopped.failedFromPhase = '';
  safelyStopped.lastError = null;
  assert.equal(G.Test.weeklyRollbackPeriodIncident(safelyStopped, canaryOperation, reversalOperation), true);
  const stillRunning = JSON.parse(JSON.stringify(state));
  stillRunning.status = 'RUNNING';
  stillRunning.phase = 'VERIFY_ROLLBACK';
  stillRunning.failedFromPhase = '';
  stillRunning.lastError = null;
  assert.equal(G.Test.weeklyRollbackPeriodIncident(stillRunning, canaryOperation, reversalOperation), false);
  const wrongBoundary = JSON.parse(JSON.stringify(state));
  wrongBoundary.digests.rollback.PUBLISH_PRICE_AGGREGATES.rows = 61831;
  assert.equal(G.Test.weeklyRollbackPeriodIncident(wrongBoundary, canaryOperation, reversalOperation), false);
  const restoreStarted = JSON.parse(JSON.stringify(state));
  restoreStarted.operations.restore = 'OP_RESTORE';
  assert.equal(G.Test.weeklyRollbackPeriodIncident(restoreStarted, canaryOperation, reversalOperation), false);
});

test('exact stopped Alpha.7.4.32 reversal checkpoint is recovered only after durable staging and before aggregate publication', () => {
  const operationId = 'OP_RAW_REVERSAL_V4_20260803T133248118Z_82520905BF9A';
  const targetLoadId = 'LOAD_20260803T123127832Z_3F2F34DAD46B';
  const reversalLoadId = 'LOAD_REV_56A66E1F8870698F19AC0F3093F9';
  const records = new Array(50).fill(0).map((_, index) => ({
    operation_id: operationId,
    reversal_load_id: reversalLoadId,
    target_load_id: targetLoadId,
    target_table: 'RAW_PRICES_WEEKLY',
    business_key: `KEY_${index}`,
    reversed_observation_id: `OBS_${index}`,
    restored_observation_id: `OLD_${index}`,
    status: 'SUCCESS'
  }));
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.32',
    executionId: 'A74_GATE6_37FAED6EF952F9BB5FD4',
    status: 'STOPPED',
    phase: 'STOPPED',
    stoppedFromPhase: 'RUN_REVERSAL',
    operations: {
      canary: 'OP_SOURCE_FILE_LOAD_V_20260803T123050299Z_BAD1844BD339',
      reversal: operationId,
      restore: ''
    },
    loads: { canary: targetLoadId, reversal: '', restore: '' },
    canarySource: {
      sourceHash: '5be97a7ca1743062394c3675f8d00228c3e5d287a35edeafee2b7866c4e74bde',
      targetTable: 'RAW_PRICES_WEEKLY',
      normalizedRowCount: 50
    },
    digests: {
      baseline: { PUBLISH_PRICE_AGGREGATES: { rows: 61636 } },
      postCanary: { PUBLISH_PRICE_AGGREGATES: { rows: 62028 } }
    },
    acceptance: {
      canaryOperationAccepted: true,
      canaryChangedTargets: [
        'PUBLISH_PRICES_WEEKLY', 'PUBLISH_PRICES_MONTHLY', 'PUBLISH_PRICE_AGGREGATES'
      ]
    },
    artifacts: { dwhBackup: { id: 'DWH_BACKUP' }, publishBackup: { id: 'PUBLISH_BACKUP' } }
  };
  const operation = {
    operation_id: operationId,
    operation_type: 'RAW_REVERSAL_V4',
    release_version: '4.0.0-alpha.7.4.32',
    status: 'PAUSED',
    current_phase: 'STAGING_AGGREGATE_ROWS',
    checkpoint: {
      nextPhase: 'STAGING_AGGREGATE_ROWS',
      completedPhases: [
        'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW', 'UPDATE_PUBLISH',
        'PREPARING_AGGREGATE_IMPACT', 'MATERIALIZING_AGGREGATE_INPUTS',
        'CALCULATING_AGGREGATE_SLICES'
      ],
      control: { stopRequested: true },
      rawStore: {
        loadId: reversalLoadId,
        reversal: { targetLoadId, reversalLoadId, reversedRows: 50, records },
        publishUpdate: { complete: true, weeklyRows: 13100, monthlyRows: 3100, industryRows: 0, publishRows: 16200 }
      },
      aggregate: {
        status: 'CALCULATED',
        materializationCursor: 72,
        materializationTotal: 72,
        calculationCursor: 392,
        calculationGroupCount: 392,
        stagingCursor: 0,
        expectedStageRows: 0,
        publishSeriesCursor: 0,
        publishBatches: []
      }
    }
  };
  const inspection = {
    operationId,
    targetLoadId,
    reversalLoadId,
    targetTable: 'RAW_PRICES_WEEKLY',
    targetLoadStatus: 'REVERSED',
    totalRows: 50,
    completedRows: 50,
    pendingRows: 0,
    complete: true
  };
  assert.equal(G.Test.reversalCheckpointCapacityIncident(state, operation, inspection), true);

  const stageRows = new Array(392).fill(0).map((_, index) => ({
    aggregate_series_key: `SERIES_${index}`,
    action: 'UPSERT',
    stage_status: 'STAGED',
    release_version: '4.0.0-alpha.7.4.32',
    expected_target_fingerprint: '',
    verified_at: ''
  }));
  const stage = G.Test.reversalCheckpointCapacityStage(stageRows);
  assert.equal(stage.exact, true);
  assert.equal(stage.calculated.length, 392);

  const publicationStarted = JSON.parse(JSON.stringify(operation));
  publicationStarted.checkpoint.aggregate.publishSeriesCursor = 1;
  assert.equal(G.Test.reversalCheckpointCapacityIncident(state, publicationStarted, inspection), false);
  const foreignCanaryState = JSON.parse(JSON.stringify(state));
  foreignCanaryState.operations.canary = 'OP_FOREIGN_CANARY';
  assert.equal(G.Test.reversalCheckpointCapacityIncident(foreignCanaryState, operation, inspection), false);
  const recordsAlreadyCompacted = JSON.parse(JSON.stringify(operation));
  delete recordsAlreadyCompacted.checkpoint.rawStore.reversal.records;
  assert.equal(G.Test.reversalCheckpointCapacityIncident(state, recordsAlreadyCompacted, inspection), false);
  stageRows[0].stage_status = 'VERIFIED';
  assert.equal(G.Test.reversalCheckpointCapacityStage(stageRows).exact, false);
});

test('exact Alpha.7.4.33 rollback scan is eligible only when all 50 restored predecessors belong to the old REVERSED load', () => {
  const canaryOperationId = 'OP_SOURCE_FILE_LOAD_V_20260803T123050299Z_BAD1844BD339';
  const reversalOperationId = 'OP_RAW_REVERSAL_V4_20260803T133248118Z_82520905BF9A';
  const targetLoadId = 'LOAD_20260803T123127832Z_3F2F34DAD46B';
  const reversalLoadId = 'LOAD_REV_56A66E1F8870698F19AC0F3093F9';
  const d = (rows, columns, headersHash, hash) => ({ rows, columns, headersHash, hash });
  const weeklyBaseline = d(20211, 36, '8fd026cde044bd1e3f08fef67e437557aa3b6c9b09510423f70676fbe2d422fa', '86b2bd53bbe264ca3616ec012154ef6a37c844ce7d531e5d196e0604af9476fa');
  const monthlyBaseline = d(12957, 33, '227a94e1197e10a18353460dcc1558a1b2ababa960c68604e5111d1046f4ee3f', 'b7a4f03c5439f0ef60997bfb86cdcbd0dc2ff0560bf63e8776aa8ff31eb6a430');
  const weeklyPost = d(20311, 36, weeklyBaseline.headersHash, '8d2d32f38a7fb68a6cc49f9c887e8432d9e0cde5ed0079d8c0d6c20d8dfe4612');
  const monthlyPost = d(13057, 33, monthlyBaseline.headersHash, '50b2f16f25f2365c2493a3f218066fc3c0b161cf4ae1b0beed2e96d96de8f657');
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.33',
    executionId: 'A74_GATE6_37FAED6EF952F9BB5FD4',
    status: 'FAILED', phase: 'FAILED', failedFromPhase: 'ROLLBACK_SCAN',
    operations: { canary: canaryOperationId, reversal: reversalOperationId, restore: '' },
    loads: { canary: targetLoadId, reversal: reversalLoadId, restore: '' },
    canarySource: {
      sourceHash: '5be97a7ca1743062394c3675f8d00228c3e5d287a35edeafee2b7866c4e74bde',
      targetTable: 'RAW_PRICES_WEEKLY', normalizedRowCount: 50
    },
    acceptance: { canaryOperationAccepted: true, reversalOperationAccepted: true },
    scan: { bucket: 'rollback', targetIndex: 2, work: null },
    digests: {
      baseline: {
        PUBLISH_PRICES_WEEKLY: weeklyBaseline,
        PUBLISH_PRICES_MONTHLY: monthlyBaseline,
        PUBLISH_PRICE_AGGREGATES: d(61636, 29, 'AGGREGATE_HEADERS', '4a9af3ebc4de06c0777410f480cfb0ad5d41e811f63be598db86d7a58fb3c62c')
      },
      postCanary: {
        PUBLISH_PRICES_WEEKLY: weeklyPost,
        PUBLISH_PRICES_MONTHLY: monthlyPost,
        PUBLISH_PRICE_AGGREGATES: d(62028, 29, 'AGGREGATE_HEADERS', 'ac7902c2a0e23a276de844704397eb2ec0c9c62dd06d48ebe3068228ba38ddad')
      },
      rollback: {
        PUBLISH_PRICES_WEEKLY: { ...weeklyPost },
        PUBLISH_PRICES_MONTHLY: { ...monthlyPost }
      }
    },
    artifacts: { dwhBackup: { id: 'DWH_BACKUP' }, publishBackup: { id: 'PUBLISH_BACKUP' } }
  };
  const canaryOperation = {
    operation_id: canaryOperationId, operation_type: 'SOURCE_FILE_LOAD_V4', status: 'SUCCESS', current_phase: 'SUCCESS',
    checkpoint: { handlerState: { loadId: targetLoadId } }
  };
  const reversalOperation = {
    operation_id: reversalOperationId, operation_type: 'RAW_REVERSAL_V4', status: 'SUCCESS', current_phase: 'SUCCESS',
    checkpoint: { rawStore: { loadId: reversalLoadId } }
  };
  const inspection = {
    targetLoadId, sourceOperationId: reversalOperationId, targetTable: 'RAW_PRICES_WEEKLY', targetLoadStatus: 'REVERSED',
    reversalLoadId, reversalRecordCount: 50, repairRows: 50, planFingerprint: 'REPAIR',
    invalidPreviousLoadIds: ['LOAD_20260802T123559854Z_EFB27B040FBC']
  };
  assert.equal(G.Test.reversedPredecessorIncident(state, canaryOperation, reversalOperation, inspection), true);
  const foreign = JSON.parse(JSON.stringify(inspection));
  foreign.invalidPreviousLoadIds = ['LOAD_FOREIGN'];
  assert.equal(G.Test.reversedPredecessorIncident(state, canaryOperation, reversalOperation, foreign), false);
  const partial = JSON.parse(JSON.stringify(inspection));
  partial.repairRows = 49;
  assert.equal(G.Test.reversedPredecessorIncident(state, canaryOperation, reversalOperation, partial), false);
});

test('active checkpoint compaction preserves comparison digests while removing repeated metadata', () => {
  const state = {
    digests: {
      baseline: { A: { rows: 1, columns: 2, headersHash: 'H', hash: 'X', chunks: 10, mode: 'ROW_MULTISET_V1' } },
      rollback: { A: { rows: 1, columns: 2, headersHash: 'H', hash: 'X', chunks: 10, mode: 'ROW_MULTISET_V1' } }
    },
    artifacts: { dwhBackup: { id: 'DWH', name: 'DWH', url: 'https://example.test/dwh' } },
    gate5: { evidence: { id: 'EVIDENCE', sha256: 'SHA', schemaVersion: 'SCHEMA', url: 'https://example.test/evidence', bytes: 100 } },
    recovery: null,
    metrics: {}
  };
  const compacted = G.Test.compactCheckpointState(state);
  assert.equal(compacted.digests.baseline.A.hash, 'X');
  assert.equal(compacted.digests.baseline.A.chunks, undefined);
  assert.equal(compacted.digests.rollback.A.mode, undefined);
  assert.equal(compacted.artifacts.dwhBackup.id, 'DWH');
  assert.equal(compacted.artifacts.dwhBackup.url, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(compacted.gate5.evidence)), {
    id: 'EVIDENCE', sha256: 'SHA', schemaVersion: 'SCHEMA'
  });
});

test('terminal checkpoint compaction stays below the Script Properties limit without dropping recovery evidence', () => {
  const state = {
    phase: 'FAILED',
    executionId: 'A74_GATE6_7F437567A3ABBFBE94F1',
    operations: { canary: 'OP_CANARY', reversal: 'OP_REVERSAL', restore: '' },
    digests: { baseline: { keep: 'BASELINE' }, rollback: { keep: 'ROLLBACK' } },
    recovery: {
      mode: 'ROLLBACK_SCAN_STATE_CAPACITY_RECOVERY',
      previousRecoveryLineage: new Array(8).fill(0).map((_, index) => ({
        mode: `RECOVERY_${index}`,
        recoveredFromExecutionId: `EXECUTION_${index}_${'X'.repeat(500)}`
      }))
    },
    metrics: { workerExecutions: 11, steps: 222, diagnostic: 'M'.repeat(1200) },
    lastError: {
      code: 'ALPHA74_GATE6_ROLLBACK_MISMATCH',
      message: 'Logical reversal did not restore the exact pre-canary Publish state.',
      details: { diagnostic: 'D'.repeat(1600) },
      stack: 'S'.repeat(1600)
    },
    lastStep: { phase: 'FAILED', error: { diagnostic: 'E'.repeat(1600) } }
  };
  const compacted = G.Test.compactTerminalState(state);
  assert(G.Test.stateBytes(compacted) <= 8500);
  assert.equal(compacted.executionId, 'A74_GATE6_7F437567A3ABBFBE94F1');
  assert.equal(compacted.operations.reversal, 'OP_REVERSAL');
  assert.equal(compacted.digests.baseline.keep, 'BASELINE');
  assert.equal(compacted.digests.rollback.keep, 'ROLLBACK');
  assert.equal(compacted.lastError.code, 'ALPHA74_GATE6_ROLLBACK_MISMATCH');
  assert.equal(compacted.lastStep.errorCode, 'ALPHA74_GATE6_ROLLBACK_MISMATCH');
});

test('Gate 6 compacts nested recovery history into bounded audit lineage', () => {
  const recovery = {
    mode: 'DURABLE_RAW_REVERSAL_CHUNK_RECOVERY',
    recoveredFromRelease: '4.0.0-alpha.7.4.26',
    operationId: 'OP_REVERSAL',
    durableCursorSource: 'RAW_REVERSAL_LOG_SUCCESS_OBSERVATION_IDS',
    previousRecovery: {
      mode: 'MONTHLY_PERIOD_LABEL_READBACK_RECOVERY',
      recoveredFromRelease: '4.0.0-alpha.7.4.24',
      operationId: 'OP_CANARY',
      repairedBatchKey: 'SERIES_000001_000032',
      previousRecovery: {
        mode: 'BOUNDED_STAGE_AFTER_STATE_RECOVERY',
        recoveredFromRelease: '4.0.0-alpha.7.4.22',
        operationId: 'OP_CANARY',
        validatedStageFingerprint: 'X'.repeat(2000),
        previousRecovery: {
          mode: 'OPERATIONAL_RUNTIME_CONTEXT_CHECKPOINT_RECOVERY',
          recoveredFromRelease: '4.0.0-alpha.7.4.20',
          operationId: 'OP_CANARY'
        }
      }
    }
  };
  const compacted = JSON.parse(JSON.stringify(G.Test.compactRecovery(recovery)));
  assert.equal(compacted.mode, 'DURABLE_RAW_REVERSAL_CHUNK_RECOVERY');
  assert.equal(compacted.previousRecovery, undefined);
  assert.deepEqual(
    compacted.previousRecoveryLineage.map(item => item.mode),
    [
      'MONTHLY_PERIOD_LABEL_READBACK_RECOVERY',
      'BOUNDED_STAGE_AFTER_STATE_RECOVERY',
      'OPERATIONAL_RUNTIME_CONTEXT_CHECKPOINT_RECOVERY'
    ]
  );
  assert(Buffer.byteLength(JSON.stringify(compacted), 'utf8') < 1800);
});

test('an already stopped Gate 6 checkpoint still routes its active operation for an idempotent stop request', () => {
  const state = {
    status: 'STOPPED',
    phase: 'STOPPED',
    stoppedFromPhase: 'RUN_REVERSAL',
    operations: { canary: 'OP_CANARY', reversal: 'OP_REVERSAL', restore: 'OP_RESTORE' }
  };
  assert.equal(G.Test.activeOperationId(state), 'OP_REVERSAL');
  state.stoppedFromPhase = 'RUN_CANARY';
  assert.equal(G.Test.activeOperationId(state), 'OP_CANARY');
  state.stoppedFromPhase = 'RUN_RESTORE';
  assert.equal(G.Test.activeOperationId(state), 'OP_RESTORE');
});

test('operation progress fingerprint changes for RAW reversal and every durable Publish handler cursor', () => {
  const operation = {
    status: 'PAUSED',
    current_phase: 'COMMIT_RAW',
    checkpoint: {
      completedPhases: ['DISCOVER', 'VALIDATE', 'PARSE', 'STAGE'],
      aggregate: { status: 'NOT_STARTED' },
      rawStore: {
        loadId: '',
        reversalWork: {
          workSchemaVersion: '4.0-raw-reversal-work-1',
          completedRows: 8,
          pendingRows: 42,
          totalRows: 50,
          chunkRows: 10
        }
      },
      handlerState: {}
    }
  };
  const initial = G.Test.operationProgressFingerprint(operation);
  assert.equal(initial, G.Test.operationProgressFingerprint(JSON.parse(JSON.stringify(operation))));

  const reversalAdvanced = JSON.parse(JSON.stringify(operation));
  reversalAdvanced.checkpoint.rawStore.reversalWork.completedRows = 18;
  reversalAdvanced.checkpoint.rawStore.reversalWork.pendingRows = 32;
  assert.notEqual(initial, G.Test.operationProgressFingerprint(reversalAdvanced));

  const rawPublishAdvanced = JSON.parse(JSON.stringify(operation));
  rawPublishAdvanced.current_phase = 'UPDATE_PUBLISH';
  rawPublishAdvanced.checkpoint.rawStore.publishWork = {
    workSchemaVersion: '4.0-publish-work-1',
    stage: 'INDUSTRY',
    cursor: 10,
    batches: 3,
    industryRows: 120
  };
  const rawPublish = G.Test.operationProgressFingerprint(rawPublishAdvanced);
  rawPublishAdvanced.checkpoint.rawStore.publishWork.cursor = 20;
  rawPublishAdvanced.checkpoint.rawStore.publishWork.batches = 4;
  assert.notEqual(rawPublish, G.Test.operationProgressFingerprint(rawPublishAdvanced));

  const sourcePublishAdvanced = JSON.parse(JSON.stringify(operation));
  sourcePublishAdvanced.current_phase = 'UPDATE_PUBLISH';
  sourcePublishAdvanced.checkpoint.rawStore = {};
  sourcePublishAdvanced.checkpoint.handlerState.publishWork = {
    workSchemaVersion: '4.0-publish-work-1',
    stage: 'MONTHLY',
    cursor: 25,
    batches: 1,
    monthlyRows: 3100
  };
  const sourcePublish = G.Test.operationProgressFingerprint(sourcePublishAdvanced);
  sourcePublishAdvanced.checkpoint.handlerState.publishWork.stage = 'INDUSTRY';
  sourcePublishAdvanced.checkpoint.handlerState.publishWork.cursor = 0;
  sourcePublishAdvanced.checkpoint.handlerState.publishWork.batches = 2;
  assert.notEqual(sourcePublish, G.Test.operationProgressFingerprint(sourcePublishAdvanced));

  const aggregateAdvanced = JSON.parse(JSON.stringify(operation));
  aggregateAdvanced.current_phase = 'CALCULATING_AGGREGATE_SLICES';
  aggregateAdvanced.checkpoint.aggregate = {
    status: 'CALCULATING',
    calculationCursor: 8,
    batchNo: 1,
    artifactPersistence: { persistedChunks: 25, totalChunks: 40, complete: false }
  };
  const aggregateFingerprint = G.Test.operationProgressFingerprint(aggregateAdvanced);
  aggregateAdvanced.checkpoint.aggregate.calculationCursor = 16;
  aggregateAdvanced.checkpoint.aggregate.batchNo = 2;
  assert.notEqual(aggregateFingerprint, G.Test.operationProgressFingerprint(aggregateAdvanced));

  const artifactAdvanced = JSON.parse(JSON.stringify(operation));
  artifactAdvanced.current_phase = 'MATERIALIZING_AGGREGATE_INPUTS';
  artifactAdvanced.checkpoint.aggregate = {
    status: 'MATERIALIZING_INPUTS',
    materializationCursor: 381,
    artifactPersistence: { persistedChunks: 25, totalChunks: 75, complete: false, fingerprint: 'ARTIFACT' }
  };
  const artifactFingerprint = G.Test.operationProgressFingerprint(artifactAdvanced);
  artifactAdvanced.checkpoint.aggregate.artifactPersistence.persistedChunks = 50;
  assert.notEqual(artifactFingerprint, G.Test.operationProgressFingerprint(artifactAdvanced));
});

test('control sheet accepts a Drive file ID or URL and rejects arbitrary text', () => {
  const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(G.Test.parseFileId(fileId), fileId);
  assert.equal(G.Test.parseFileId(`https://docs.google.com/spreadsheets/d/${fileId}/edit`), fileId);
  assert.equal(G.Test.parseFileId(`https://drive.google.com/open?id=${fileId}`), fileId);
  assert.equal(G.Test.parseFileId('не ссылка'), '');
});

test('row-multiset digest is order independent and value sensitive', () => {
  const first = digest([[1, 'A'], [2, 'B'], [3, 'C']]);
  const reordered = digest([[3, 'C'], [1, 'A'], [2, 'B']]);
  const changed = digest([[1, 'A'], [2, 'B'], [3, 'D']]);
  assert.equal(first.hash, reordered.hash);
  assert.notEqual(first.hash, changed.hash);
});

test('rollback and restore comparisons require every Publish target', () => {
  const baseline = allTargets({});
  const exact = allTargets({});
  assert.equal(G.Test.compareDigests(baseline, exact).exact, true);

  const changed = allTargets({
    PUBLISH_INDUSTRY: digest([['PUBLISH_INDUSTRY', 2]])
  });
  const comparison = G.Test.compareDigests(baseline, changed);
  assert.equal(comparison.exact, false);
  assert.deepEqual(
    Array.from(G.Test.changedTargets(baseline, changed)),
    ['PUBLISH_INDUSTRY']
  );
});

test('operation acceptance requires all aggregate phases, RAW audit and SUCCESS', () => {
  const phases = [
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES',
    'QUICK_AUDIT',
    'SUCCESS'
  ];
  const operation = {
    operation_id: 'OP_CANARY',
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'SUCCESS',
    current_phase: 'SUCCESS',
    release_version: '4.0.0-alpha.7.4.22',
    checkpoint: {
      completedPhases: phases,
      aggregate: { status: 'SUCCESS', targetAfterFingerprint: 'AFTER' },
      handlerState: { loadId: 'LOAD_CANARY', sourceHash: 'SOURCE_HASH' }
    }
  };
  const accepted = G.Test.operationSummary(operation, 'SOURCE_FILE_LOAD_V4');
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.completedAggregatePhases, 7);
  assert.equal(accepted.loadId, 'LOAD_CANARY');

  const missing = JSON.parse(JSON.stringify(operation));
  missing.checkpoint.completedPhases = phases.filter(phase => phase !== 'RECONCILING_AGGREGATES');
  assert.equal(G.Test.operationSummary(missing, 'SOURCE_FILE_LOAD_V4').accepted, false);
});

test('final evidence accepts the canary RAW audit only in the expected REVERSED lifecycle state', () => {
  const audit = {
    ok: false,
    loadId: 'LOAD_CANARY',
    loadStatus: 'REVERSED',
    staged: 50,
    committedStages: 50,
    expectedCommitted: 50,
    latestConflicts: []
  };
  assert.equal(G.Test.reversedCanaryAuditAccepted(audit), true);
  assert.equal(G.Test.reversedCanaryAuditAccepted({ ...audit, committedStages: 49 }), false);
  assert.equal(G.Test.reversedCanaryAuditAccepted({ ...audit, latestConflicts: ['DUPLICATE'] }), false);
  assert.equal(G.Test.reversedCanaryAuditAccepted({ ...audit, loadStatus: 'COMMITTED' }), false);
});

test('exact .34 SAVE_EVIDENCE incident is recoverable without replaying canary, rollback or restore', () => {
  const completedPhases = [
    'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW', 'UPDATE_PUBLISH',
    'PREPARING_AGGREGATE_IMPACT', 'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES', 'STAGING_AGGREGATE_ROWS', 'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST', 'RECONCILING_AGGREGATES', 'UPDATE_STATUS',
    'QUICK_AUDIT', 'FINALIZING', 'SUCCESS'
  ];
  function operation(id, type, loadId) {
    return {
      operation_id: id,
      operation_type: type,
      status: 'SUCCESS',
      current_phase: 'SUCCESS',
      checkpoint: {
        completedPhases,
        handlerState: { loadId, sourceHash: '5be97a7ca1743062394c3675f8d00228c3e5d287a35edeafee2b7866c4e74bde' },
        rawStore: { loadId },
        aggregate: { status: 'SUCCESS', targetAfterFingerprint: 'TARGET' }
      }
    };
  }
  const canary = operation(
    'OP_SOURCE_FILE_LOAD_V_20260803T123050299Z_BAD1844BD339',
    'SOURCE_FILE_LOAD_V4',
    'LOAD_20260803T123127832Z_3F2F34DAD46B'
  );
  const reversal = operation(
    'OP_RAW_REVERSAL_V4_20260803T173434397Z_DCC49C04030A',
    'RAW_REVERSAL_V4',
    'LOAD_REV_56A66E1F8870698F19AC0F3093F9'
  );
  const restore = operation(
    'OP_SOURCE_FILE_LOAD_V_20260803T193851648Z_4ECDB96C4D0F',
    'SOURCE_FILE_LOAD_V4',
    'LOAD_20260803T193958095Z_6EADF4F3F0AC'
  );
  const baseline = allTargets({});
  const postCanary = allTargets({
    PUBLISH_PRICES_WEEKLY: digest([['weekly', 2]]),
    PUBLISH_PRICES_MONTHLY: digest([['monthly', 2]]),
    PUBLISH_PRICE_AGGREGATES: digest([['aggregate', 2]])
  });
  const state = {
    stateSchemaVersion: '4.0-alpha74-gate6-state-1',
    release: '4.0.0-alpha.7.4.34',
    executionId: 'A74_GATE6_37FAED6EF952F9BB5FD4',
    status: 'FAILED',
    phase: 'FAILED',
    failedFromPhase: 'SAVE_EVIDENCE',
    acceptanceCompletedAt: '2026-08-03T20:52:10.354Z',
    operations: {
      canary: canary.operation_id,
      reversal: reversal.operation_id,
      restore: restore.operation_id
    },
    loads: {
      canary: 'LOAD_20260803T123127832Z_3F2F34DAD46B',
      reversal: 'LOAD_REV_56A66E1F8870698F19AC0F3093F9',
      restore: 'LOAD_20260803T193958095Z_6EADF4F3F0AC'
    },
    canarySource: { sourceHash: '5be97a7ca1743062394c3675f8d00228c3e5d287a35edeafee2b7866c4e74bde' },
    artifacts: { dwhBackup: { id: 'DWH' }, publishBackup: { id: 'PUBLISH' } },
    digests: {
      baseline,
      rollback: JSON.parse(JSON.stringify(baseline)),
      postCanary,
      final: JSON.parse(JSON.stringify(postCanary))
    },
    scan: null,
    evidence: null,
    acceptance: {
      canaryOperationAccepted: true,
      reversalOperationAccepted: true,
      restoreOperationAccepted: true,
      rollbackExact: true,
      restoreExact: true,
      aggregateContractScan: {
        ok: true,
        duplicateLogicalRows: 0,
        latestFailures: 0,
        futureRows: 0
      }
    },
    lastError: {
      code: 'ALPHA74_GATE6_RAW_AUDIT_FAILED',
      details: {
        operationId: canary.operation_id,
        operationType: 'SOURCE_FILE_LOAD_V4'
      }
    }
  };
  const canaryAudit = {
    ok: false,
    loadStatus: 'REVERSED',
    staged: 50,
    committedStages: 50,
    expectedCommitted: 50,
    latestConflicts: []
  };
  assert.equal(G.Test.evidenceFinalizationIncident(state, canary, reversal, restore, canaryAudit), true);
  const preparedRetry = JSON.parse(JSON.stringify(state));
  preparedRetry.release = '4.0.0-alpha.7.4.35';
  preparedRetry.status = 'STOPPED';
  preparedRetry.phase = 'STOPPED';
  preparedRetry.stoppedFromPhase = 'SAVE_EVIDENCE';
  preparedRetry.failedFromPhase = '';
  preparedRetry.lastError = null;
  preparedRetry.recovery = {
    mode: 'EVIDENCE_FINALIZATION_AFTER_REVERSED_CANARY',
    recoveredFromRelease: '4.0.0-alpha.7.4.34'
  };
  assert.equal(G.Test.evidenceFinalizationIncident(preparedRetry, canary, reversal, restore, canaryAudit), true);
  const wrongAudit = { ...canaryAudit, loadStatus: 'COMMITTED' };
  assert.equal(G.Test.evidenceFinalizationIncident(state, canary, reversal, restore, wrongAudit), false);
  const inexactRestore = JSON.parse(JSON.stringify(state));
  inexactRestore.digests.final.PUBLISH_PRICES_WEEKLY.hash = 'DIFFERENT';
  assert.equal(G.Test.evidenceFinalizationIncident(inexactRestore, canary, reversal, restore, canaryAudit), false);
});

test('source contract contains source-file canary, recovery copies, standard rollback, restore and fail-closed flags', () => {
  const source = fs.readFileSync(path.join(root, 'src/28_Alpha74Gate6Acceptance.js'), 'utf8');
  const entries = fs.readFileSync(path.join(root, 'src/08_EntryPoints.js'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'src/03_OperationEngine.js'), 'utf8');
  const publish = fs.readFileSync(path.join(root, 'src/07_IncrementalPublish.js'), 'utf8');
  const aggregate = fs.readFileSync(path.join(root, 'src/21_Alpha74AggregateIntegration.js'), 'utf8');
  assert(source.includes("var CONTROL_SHEET = 'GATE6_CANARY_INPUT'"));
  assert(source.includes('AKORT.ExistingSourceParsers.previewFile'));
  assert(source.includes('AKORT.ExistingSourceParsers.enqueueFile'));
  assert(source.includes('ALPHA74_GATE6_FOREIGN_OPERATION_ACTIVE'));
  assert(source.includes('ALPHA74_GATE6_RESUME_STATE_INVALID'));
  assert(source.includes('getFilesByName(name)'));
  assert(source.includes('ALPHA74_GATE6_EVIDENCE_CONFLICT'));
  assert(source.includes("['RAW_PRICES_WEEKLY', 'RAW_PRICES_MONTHLY']"));
  assert(source.includes("changed.indexOf('PUBLISH_PRICE_AGGREGATES') >= 0"));
  assert(source.includes('DWH_BEFORE_CANARY'));
  assert(source.includes('PUBLISH_BEFORE_CANARY'));
  assert(source.includes("enqueue('RAW_REVERSAL_V4'"));
  assert(source.includes("setRegularPipeline_(false)"));
  assert(source.includes("setUserPipeline_(false)"));
  assert(source.includes('regularCyclesWithoutManualContinuation: 3'));
  assert(source.includes('AKORT.IncrementalPublish.PublishHeaders'));
  assert(source.includes('BASELINE_HEADER_CONTRACT_RECOVERY'));
  assert(source.includes('OPERATIONAL_RUNTIME_CONTEXT_CHECKPOINT_RECOVERY'));
  assert(source.includes('BOUNDED_STAGE_AFTER_STATE_RECOVERY'));
  assert(source.includes('MONTHLY_PERIOD_LABEL_READBACK_RECOVERY'));
  assert(source.includes('DURABLE_RAW_REVERSAL_CHUNK_RECOVERY'));
  assert(source.includes('ROLLBACK_SCAN_STATE_CAPACITY_RECOVERY'));
  assert(source.includes('WEEKLY_ROLLBACK_PERIOD_CANONICAL_REPAIR'));
  assert(source.includes('WEEKLY_ROLLBACK_PERIOD_CANONICAL_RESTART'));
  assert(source.includes('REVERSAL_CHECKPOINT_CELL_CAPACITY_RECOVERY'));
  assert(source.includes('maxSeries: 16'));
  assert(aggregate.includes('Math.min(16, Number(options.maxSeries || 16))'));
  assert(source.includes('previousRecoveryLineage'));
  assert(source.indexOf('saveTerminalState_(state);') < source.indexOf('try { deleteTriggers_(); } catch (ignoredTriggerCleanup) {}'));
  assert(source.includes('validateRecoveryStageSnapshot'));
  assert(source.includes('recoverMonthlyPeriodLabelIntent'));
  assert(source.includes('AKORT.OperationEngine.recoverFailedPhase'));
  assert(entries.includes('AKORT_alpha74Gate6RecoverMonthlyPeriodLabel'));
  assert(entries.includes('AKORT_alpha74Gate6RecoverWeeklyRollbackPeriod'));
  assert(entries.includes('AKORT_alpha74Gate6RecoverReversalCheckpointCapacity'));
  assert(entries.includes('AKORT_alpha74Gate6RecoverEvidenceFinalization'));
  assert(source.includes('EVIDENCE_FINALIZATION_AFTER_REVERSED_CANARY'));
  assert(source.includes("expectedFinalLoadStatus: 'REVERSED'"));
  assert(source.includes('var alreadyRunning = existing && existing.release === RELEASE'));
  assert(source.includes('var alreadyComplete = existing && existing.release === RELEASE'));
  assert(engine.includes('expected.status || STATUSES.FAILED'));
  assert(engine.includes('OPERATION_CHECKPOINT_CELL_LIMIT_EXCEEDED'));
  assert(engine.includes("schemaVersion: '4.0-operation-cell-summary-1'"));
  assert(engine.includes('recoverReversalCheckpointCapacity'));
  assert(aggregate.includes("text_(context.accepted_by) !== 'ALPHA74_GATE5_FULL_HISTORY_PARITY'"));
  assert(aggregate.includes("text_(context.mutation_boundary) !== 'ALPHA74_ATOMIC_LOGICAL_SERIES'"));
  assert(aggregate.includes('context.gate5_evidence_required !== true'));
  assert(aggregate.includes("publicationMode: 'BOUNDED_ATOMIC_LOGICAL_SERIES_BATCHES'"));
  assert(!source.includes('AKORT_V300.HEADERS'));
  assert(publish.includes('PublishHeaders:PUBLISH_HEADERS'));
  assert(!source.includes('AKORT.IndustryInput.submit'));
  assert(!source.includes('deleteRow('));
  assert(!source.includes('clearContent('));
});

test('ordinary operator submit stays gated and is not used by Gate 6', () => {
  const source = fs.readFileSync(path.join(root, 'src/27_Alpha74IndustryInput.js'), 'utf8');
  assert(source.includes('PUBLISH_USER_PIPELINE_ENABLED'));
  assert(source.includes('INDUSTRY_INPUT_USER_PIPELINE_DISABLED'));
  assert(!source.includes('gate6CanaryExecutionId'));
  assert(!source.includes('assertCanaryAuthorized'));
});

let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error && error.stack || error);
  }
}

if (failed) {
  console.error(`${failed} Alpha.7.4 Gate 6 test(s) failed.`);
  process.exit(1);
}

console.log(`PASS ${tests.length} Alpha.7.4 Gate 6 tests.`);
