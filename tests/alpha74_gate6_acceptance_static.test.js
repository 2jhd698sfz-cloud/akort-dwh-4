const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
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
  parseInt
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
  assert.equal(G.Version, '4.0-alpha74-gate6-acceptance-11');
  assert.equal(G.Release, '4.0.0-alpha.7.4.29');
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
  assert(source.includes('validateRecoveryStageSnapshot'));
  assert(source.includes('recoverMonthlyPeriodLabelIntent'));
  assert(source.includes('AKORT.OperationEngine.recoverFailedPhase'));
  assert(entries.includes('AKORT_alpha74Gate6RecoverMonthlyPeriodLabel'));
  assert(engine.includes('expected.status || STATUSES.FAILED'));
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
