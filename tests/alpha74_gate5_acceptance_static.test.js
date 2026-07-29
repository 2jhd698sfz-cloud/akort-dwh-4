const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const headers = [
  'dataset_code', 'source_name', 'frequency', 'aggregate_level',
  'aggregate_id', 'aggregate_name', 'category_id', 'product_group',
  'product_name', 'value_type', 'index_type', 'period_start', 'year',
  'quarter', 'month', 'period_label', 'category_value',
  'category_change_pp', 'category_weight', 'aggregate_change_pp',
  'contribution_to_group_change_pp', 'contribution_to_basket_change_pp',
  'contribution_to_total_cpi_pp', 'weight_source',
  'coverage_categories_count', 'coverage_weight_sum',
  'is_latest_period', 'aggregate_value', 'aggregate_base_value'
];

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function periodKey(frequency, value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) {
    return String(frequency).toLowerCase() === 'monthly' ? value.slice(0, 7) : value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return String(frequency).toLowerCase() === 'monthly'
    ? `${date.getUTCFullYear()}-${month}`
    : `${date.getUTCFullYear()}-${month}-${day}`;
}

const context = vm.createContext({
  console,
  JSON,
  Date,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  isFinite,
  parseInt,
  setTimeout,
  clearTimeout
});

context.AKORT = {
  Core: {
    sha256: sha,
    now: () => '2026-07-27T00:00:00.000Z',
    error(code, message, details) {
      const error = new Error(message);
      error.code = code;
      error.details = details || {};
      return error;
    }
  },
  AggregateContract: {
    Version: '4.0-aggregate-contract-1',
    Headers: headers,
    Test: { periodKey }
  },
  IncrementalPublish: {
    Gate5: {
      fullBuildChunk() {
        throw new Error('fullBuildChunk test adapter was not configured');
      }
    }
  }
};

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

load('src/21_Alpha74AggregateIntegration.js');
load('src/26_Alpha74Gate5Acceptance.js');

const A = context.AKORT.AggregateIntegration;
const H = context.AKORT.Alpha74Gate5Acceptance;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function publishRow(subject, period, value) {
  const row = {};
  for (const header of headers) row[header] = '';
  Object.assign(row, {
    dataset_code: 'AKORT_WEEKLY',
    source_name: 'AKORT',
    frequency: 'weekly',
    aggregate_level: 'group',
    aggregate_id: `AGG_${subject}`,
    aggregate_name: subject,
    product_group: subject,
    value_type: 'розница',
    index_type: 'wow',
    period_start: period,
    year: Number(period.slice(0, 4)),
    quarter: 1,
    month: 1,
    period_label: period,
    aggregate_change_pp: value,
    weight_source: 'AKORT_SALES_WEIGHTS',
    coverage_categories_count: 2,
    coverage_weight_sum: 1,
    is_latest_period: 0
  });
  return row;
}

const identity = {
  operationId: 'OP_GATE5',
  loadId: 'LOAD_GATE5',
  planId: 'PLAN_GATE5',
  planFingerprint: 'PLAN_FP_GATE5',
  calculationId: 'CALC_GATE5'
};

test('Gate 5 metadata and stage inventories are exact', () => {
  assert.equal(H.Version, '4.0-alpha74-gate5-acceptance-4');
  assert.equal(H.Release, '4.0.0-alpha.7.4.6');
  assert.equal(H.EvidenceSchemaVersion, '4.0-alpha74-gate5-evidence-4');
  assert.equal(H.StateSchemaVersion, '4.0-alpha74-gate5-state-4');
  assert.deepEqual(Array.from(H.FullStages), [
    'WEEKLY', 'MONTHLY', 'INDUSTRY', 'AGGREGATES_WEEKLY',
    'AGGREGATES_MONTHLY', 'AGGREGATES_SPECIAL', 'AGGREGATES_LATEST'
  ]);
  assert.deepEqual(Array.from(H.ReplayStages), ['WEEKLY', 'MONTHLY', 'INDUSTRY', 'AGGREGATES']);
});

test('blank price-level RAW index expands to canonical aggregate index types', () => {
  function formatDate(value, _timezone, pattern) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return pattern === 'yyyy-MM' ? `${year}-${month}` : `${year}-${month}-${day}`;
  }
  const incrementalContext = vm.createContext({
    console,
    JSON,
    Date,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isFinite,
    parseInt,
    Utilities: { formatDate },
    AKORT: {}
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/07_IncrementalPublish.js'), 'utf8'),
    incrementalContext,
    { filename: 'src/07_IncrementalPublish.js' }
  );
  const T = incrementalContext.AKORT.IncrementalPublish.Test;
  const weekly = T.expandAffected([{
    frequency: 'weekly',
    datasetCode: 'AKORT_WEEKLY',
    categoryId: 'C',
    valueType: 'розница',
    indexType: '',
    period: '2026-01-04'
  }]).aggregates;
  const monthly = T.expandAffected([{
    frequency: 'monthly',
    datasetCode: 'AKORT_MONTHLY',
    categoryId: 'C',
    valueType: 'розница',
    indexType: '',
    period: '2026-01-01'
  }]).aggregates;
  const weeklyTypes = Array.from(new Set(
    weekly.filter(item => item.frequency === 'weekly' && item.valueType === 'розница').map(item => item.indexType)
  )).sort();
  const monthlyTypes = Array.from(new Set(
    monthly.filter(item => item.frequency === 'monthly' && item.valueType === 'розница').map(item => item.indexType)
  )).sort();
  assert.deepEqual(weeklyTypes, ['december', 'wow', 'yoy']);
  assert.deepEqual(monthlyTypes, ['december', 'mom', 'yoy']);
});

test('full build advances only after durable bounded chunks complete', () => {
  context.AKORT.IncrementalPublish.Gate5.fullBuildChunk = function (_spreadsheetId, stage, work) {
    if (!work) {
      return {
        stage,
        phase: 'PREPARE',
        rowsProcessed: 0,
        rowsScanned: 0,
        complete: false,
        work: {
          workSchemaVersion: '4.0-alpha74-gate5-full-work-2',
          stage,
          phase: 'COPY_MATERIALIZED_ROWS',
          cursor: 0,
          total: 1200,
          chunkRows: 500,
          startRow: 2,
          materializedSheetName: 'GATE5_MATERIALIZED_WEEKLY',
          materializedRows: 1200,
          prepared: true
        },
        rowsMaterialized: 1200
      };
    }
    const next = Math.min(work.total, work.cursor + work.chunkRows);
    return {
      stage,
      phase: 'WRITE_ROWS',
      rowsProcessed: next - work.cursor,
      rowsScanned: 0,
      complete: next >= work.total,
      work: next >= work.total ? null : Object.assign({}, work, { cursor: next })
    };
  };
  const state = {
    phase: 'FULL_BUILD',
    fullStageIndex: 0,
    fullBuildWork: null,
    artifacts: { fullBuild: { id: 'FULL_BUILD_TEST' } },
    metrics: null
  };
  H.Test.fullBuildStep(state);
  assert.equal(state.fullStageIndex, 0);
  assert.equal(state.fullBuildWork.cursor, 0);
  H.Test.fullBuildStep(state);
  assert.equal(state.fullStageIndex, 0);
  assert.equal(state.fullBuildWork.cursor, 500);
  H.Test.fullBuildStep(state);
  assert.equal(state.fullBuildWork.cursor, 1000);
  H.Test.fullBuildStep(state);
  assert.equal(state.fullStageIndex, 1);
  assert.equal(state.fullBuildWork, null);
  assert.equal(state.metrics.fullBuildRowsProcessed, 1200);
  assert.equal(state.metrics.fullBuildRowsMaterialized, 1200);
  assert.equal(state.metrics.fullBuildChunks, 3);
  assert.equal(state.metrics.fullBuildStagesPrepared, 1);
});

test('publish rows become exact Alpha.7.4 stage records', () => {
  const records = H.Test.stageRecords([publishRow('Овощи', '2026-01-04', 1.25)], identity);
  assert.equal(records.length, 1);
  assert.equal(records[0].action, 'UPSERT');
  assert(records[0].aggregate_series_key.startsWith('A74_GATE5_SERIES_'));
  assert.equal(records[0].aggregate_row_key, `${records[0].aggregate_series_key}|2026-01-04`);
  const payload = JSON.parse(records[0].row_payload_json);
  assert.deepEqual(Object.keys(payload), headers);
  const validation = A.Test.validateStageRows(records, identity);
  assert.equal(validation.rowCount, 1);
  assert.equal(validation.seriesCount, 1);
});

test('bounded series batch respects atomic row, cell and request limits', () => {
  const records = H.Test.stageRecords([
    publishRow('Овощи', '2026-01-04', 1.25),
    publishRow('Молоко', '2026-01-04', 2.5)
  ], identity);
  const batch = H.Test.fitSeriesBatch([], records, 0, {
    maxRows: 5000,
    maxCells: 100000,
    maxRequests: 500
  });
  assert.equal(batch.seriesCount, 2);
  assert.equal(batch.nextCursor, 2);
  assert.equal(batch.replacement.replacementRowCount, 2);
  assert(batch.replacement.cellCount <= 100000);
});

test('one oversized logical series fails closed', () => {
  const records = H.Test.stageRecords([
    publishRow('Овощи', '2026-01-04', 1.25),
    publishRow('Овощи', '2026-01-11', 1.5)
  ], identity);
  assert.throws(
    () => H.Test.fitSeriesBatch([], records, 0, {
      maxRows: 1,
      maxCells: 29,
      maxRequests: 1
    }),
    error => error && error.code === 'ALPHA74_GATE5_ATOMIC_LIMIT_EXCEEDED'
  );
});

test('accepted load and reversal context is deterministic', () => {
  const groups = [
    { loadId: 'LOAD_A', reverseTargets: [], isReversal: false },
    { loadId: 'LOAD_B', reverseTargets: [], isReversal: false },
    { loadId: 'REV_A', reverseTargets: ['LOAD_A'], isReversal: true }
  ];
  const before = H.Test.replayContext(groups, 1);
  assert.deepEqual(Array.from(before.allowedLoadIds), ['LOAD_A', 'LOAD_B']);
  assert.deepEqual(Array.from(before.reversedLoadIds), []);
  const after = H.Test.replayContext(groups, 2);
  assert.deepEqual(Array.from(after.allowedLoadIds), ['LOAD_B']);
  assert.deepEqual(Array.from(after.reversedLoadIds), ['LOAD_A']);
});

test('canonical digest normalizes Google Sheets period types', () => {
  const row = { frequency: 'weekly' };
  assert.equal(H.Test.canonicalCell(new Date(Date.UTC(2026, 0, 4)), 'period_start', row), 'D:2026-01-04');
  assert.equal(H.Test.canonicalCell(1.25, 'aggregate_change_pp', row), 'F:1.25');
  assert.equal(H.Test.canonicalCell('', 'aggregate_change_pp', row), 'N:');
});

test('quota and transient errors retain automatic retry semantics', () => {
  const quota = H.Test.classifyError(new Error('Service invoked too many times for one day'));
  const transient = H.Test.classifyError(new Error('Service error: Spreadsheets'));
  const fatal = H.Test.classifyError(Object.assign(new Error('Schema mismatch'), { code: 'SCHEMA_MISMATCH' }));
  assert.equal(quota.kind, 'QUOTA');
  assert.equal(quota.retryable, true);
  assert.equal(transient.kind, 'TRANSIENT');
  assert.equal(transient.retryable, true);
  assert.equal(fatal.kind, 'FATAL');
  assert.equal(fatal.retryable, false);
});

test('third replay group fails closed when every aggregate batch is empty', () => {
  const state = {
    replayStage: 'AGGREGATES',
    replayGroupIndex: 2,
    metrics: {
      replayAggregateCombosProcessed: 480,
      replayAggregateRowsCalculated: 0
    }
  };
  assert.throws(
    () => H.Test.assertAggregateReplayProgress(state),
    error => error && error.code === 'ALPHA74_GATE5_AGGREGATE_REPLAY_EMPTY'
  );
  state.metrics.replayAggregateRowsCalculated = 1;
  assert.equal(H.Test.assertAggregateReplayProgress(state), true);
});

test('replay-only recovery preserves completed artifacts and resets replay state', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-3',
    release: '4.0.0-alpha.7.4.4',
    executionId: 'A74_GATE5_SOURCE',
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'SUPERSEDED_REPLAY' }
    },
    baselineExpected: { rows: 61636, dataHash: 'BASELINE_HASH' },
    liveBefore: { rows: 61636, dataHash: 'LIVE_HASH' },
    metrics: {
      workerExecutions: 248,
      fullBuildRowsProcessed: 158706,
      fullBuildRowsScanned: 61636,
      fullBuildRowsMaterialized: 97070,
      fullBuildChunks: 330,
      fullBuildStagesPrepared: 7,
      replayPriceRowsWritten: 18482,
      replayAggregateRowsCalculated: 0,
      replayAggregateSeriesPublished: 0
    }
  };
  const recovered = H.Test.buildReplayOnlyState(
    source,
    { id: 'NEW_REPLAY', name: 'AKORT_ALPHA74_GATE5_REPLAY_RECOVERY' },
    'A74_GATE5_RECOVERED'
  );
  assert.equal(recovered.phase, 'PREPARE_REPLAY');
  assert.equal(recovered.status, 'RUNNING');
  assert.equal(recovered.fullStageIndex, 7);
  assert.equal(recovered.artifacts.baselineCanonical.id, 'BASELINE');
  assert.equal(recovered.artifacts.fullBuild.id, 'FULL_BUILD');
  assert.equal(recovered.artifacts.sequentialReplay.id, 'NEW_REPLAY');
  assert.equal(recovered.metrics.fullBuildRowsMaterialized, 97070);
  assert.equal(recovered.metrics.replayPriceRowsWritten, 0);
  assert.equal(recovered.metrics.workerExecutions, 0);
  assert.equal(recovered.recovery.supersededReplay.id, 'SUPERSEDED_REPLAY');
  assert.equal(recovered.recovery.discardedReplayMetrics.priceRowsWritten, 18482);
  assert(Buffer.byteLength(JSON.stringify(recovered), 'utf8') < 8500);
});

test('repository wiring protects live Publish and exposes trigger-driven entrypoints', () => {
  const incremental = fs.readFileSync(path.join(root, 'src/07_IncrementalPublish.js'), 'utf8');
  const harness = fs.readFileSync(path.join(root, 'src/26_Alpha74Gate5Acceptance.js'), 'utf8');
  const entries = fs.readFileSync(path.join(root, 'src/08_EntryPoints.js'), 'utf8');
  const release = fs.readFileSync(path.join(root, 'src/00_Release.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert(incremental.includes('ALPHA74_GATE5_LIVE_TARGET_FORBIDDEN'));
  assert(incremental.includes('ALPHA74_GATE5_TARGET_OUTSIDE_TEST_FILES'));
  assert(incremental.includes('settings.aggregateRegularPipelineEnabled'));
  assert(incremental.includes('fullBuildChunk:gate5FullBuildChunk_'));
  assert(incremental.includes("GATE5_FULL_WORK_SCHEMA='4.0-alpha74-gate5-full-work-2'"));
  assert(incremental.includes("GATE5_FULL_CACHE_PREFIX='GATE5_MATERIALIZED_'"));
  assert(incremental.includes('gate5MaterializeFullRows_'));
  assert(incremental.includes('gate5ReadMaterializedChunk_'));
  const replayItemsBody = incremental.slice(
    incremental.indexOf('function replayStageItemsForGroup_'),
    incremental.indexOf('function initializeReplayWork_')
  );
  assert(replayItemsBody.includes('v310ExpandAffectedTargets_(affected).aggregates'));
  assert(!replayItemsBody.includes('function addSeed'));
  assert(incremental.includes('const indexTypes = v310AggregateIndexTypes_'));
  assert(incremental.includes('chunkRows:500'));
  assert(incremental.includes("phase:spec.mode==='LATEST'?'INDEX_SCAN':'MATERIALIZE_ROWS'"));
  const chunkBody = incremental.slice(
    incremental.indexOf('function gate5FullBuildChunk_'),
    incremental.indexOf('function gate5ReplayGroups_')
  );
  assert(!chunkBody.includes('gate5FullRows_('));
  assert(!incremental.includes('fullBuildStage:gate5FullBuildStage_'));
  assert(harness.includes("TRIGGER_HANDLER = 'AKORT_alpha74Gate5Worker'"));
  assert(harness.includes("triggerMode: 'PERSISTENT_EVERY_MINUTE'"));
  assert(harness.includes('fullBuildWork'));
  assert(harness.includes('fullBuildRowsScanned'));
  assert(harness.includes('fullBuildRowsMaterialized'));
  assert(harness.includes('ALPHA74_GATE5_STATE_VERSION_MISMATCH'));
  assert(harness.includes('ALPHA74_GATE5_AGGREGATE_REPLAY_EMPTY'));
  assert(harness.includes("mode: 'REPLAY_ONLY_CANONICAL_INDEX_RECOVERY'"));
  const overlapBranch = harness.slice(
    harness.indexOf('if (!lock.tryLock(1000))'),
    harness.indexOf('var startedMs = Date.now()')
  );
  assert(overlapBranch.includes('checkpointWrite: false'));
  assert(!overlapBranch.includes('saveState_('));
  assert(!harness.includes('PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED ='));
  assert(entries.includes('AKORT_alpha74Gate5Status'));
  assert(entries.includes('AKORT_alpha74Gate5Start'));
  assert(entries.includes('AKORT_alpha74Gate5RestartReplay'));
  assert(entries.includes('AKORT_alpha74Gate5Worker'));
  assert(entries.includes('AKORT_alpha74Gate5Stop'));
  assert(release.includes("'26_Alpha74Gate5Acceptance.js'"));
  assert(pkg.scripts.test.includes('test:alpha74-gate5'));
});

let failed = 0;
for (const current of tests) {
  try {
    current.fn();
    console.log(`PASS ${current.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${current.name}`);
    console.error(error && error.stack || error);
  }
}

console.log(JSON.stringify({
  suite: 'alpha74_gate5_acceptance_static',
  total: tests.length,
  failed
}, null, 2));

if (failed) process.exit(1);
