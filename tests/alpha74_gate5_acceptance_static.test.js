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
  assert.equal(H.Version, '4.0-alpha74-gate5-acceptance-9');
  assert.equal(H.Release, '4.0.0-alpha.7.4.11');
  assert.equal(H.EvidenceSchemaVersion, '4.0-alpha74-gate5-evidence-9');
  assert.equal(H.StateSchemaVersion, '4.0-alpha74-gate5-state-9');
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

test('sequential replay latest is finalized with a durable scan and apply cursor', () => {
  context.AKORT.IncrementalPublish.Gate5.fullBuildChunk = function (_spreadsheetId, stage, work) {
    assert.equal(stage, 'AGGREGATES_LATEST');
    if (!work) {
      return {
        stage,
        phase: 'PREPARE',
        rowsProcessed: 0,
        rowsScanned: 0,
        total: 2500,
        complete: false,
        work: {
          workSchemaVersion: '4.0-alpha74-gate5-full-work-2',
          stage,
          phase: 'INDEX_SCAN',
          cursor: 0,
          total: 2500,
          chunkRows: 1000,
          prepared: true
        }
      };
    }
    const cursor = work.cursor;
    const count = Math.min(1000, work.total - cursor);
    const next = cursor + count;
    if (work.phase === 'INDEX_SCAN') {
      const nextWork = Object.assign({}, work, {
        phase: next >= work.total ? 'APPLY_FLAGS' : 'INDEX_SCAN',
        cursor: next >= work.total ? 0 : next
      });
      return {
        stage,
        phase: 'INDEX_SCAN',
        rowsProcessed: 0,
        rowsScanned: count,
        total: work.total,
        complete: false,
        work: nextWork
      };
    }
    return {
      stage,
      phase: 'APPLY_FLAGS',
      rowsProcessed: count,
      rowsScanned: 0,
      total: work.total,
      complete: next >= work.total,
      work: next >= work.total ? null : Object.assign({}, work, { cursor: next })
    };
  };
  const state = {
    phase: 'FINALIZE_REPLAY',
    replayLatestWork: null,
    artifacts: { sequentialReplay: { id: 'REPLAY_TEST' } },
    metrics: null
  };
  for (let index = 0; index < 7; index += 1) H.Test.finalizeReplayStep(state);
  assert.equal(state.phase, 'NORMALIZE');
  assert.equal(state.replayLatestWork, null);
  assert.equal(state.metrics.replayLatestRowsScanned, 2500);
  assert.equal(state.metrics.replayLatestRowsUpdated, 2500);
  assert.equal(state.metrics.replayLatestChunks, 6);
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

test('durable stage normalizes Date payload and row identity to one publication period', () => {
  const source = publishRow('Овощи', '2026-01-05', 1.25);
  source.period_start = new Date('2026-01-04T21:00:00.000Z');
  const records = H.Test.stageRecords([source], identity);
  const payload = JSON.parse(records[0].row_payload_json);
  assert.equal(payload.period_start, '2026-01-04');
  assert.equal(records[0].period_start, '2026-01-04');
  assert.equal(
    records[0].aggregate_row_key,
    `${records[0].aggregate_series_key}|2026-01-04`
  );
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

test('fast replay coalesces physical rows and limits the candidate series window', () => {
  assert.deepEqual(
    Array.from(H.Test.rowBlocks([9, 3, 4, 4, 7, 8, 20])),
    [
      { start: 3, end: 4, count: 2 },
      { start: 7, end: 9, count: 3 },
      { start: 20, end: 20, count: 1 }
    ]
  );
  const rows = [];
  for (let index = 0; index < 40; index += 1) {
    rows.push(publishRow(`SERIES_${String(index).padStart(2, '0')}`, '2026-01-04', index));
  }
  const records = H.Test.stageRecords(rows, identity);
  const firstWindow = H.Test.candidateStageRecords(records, 0);
  const secondWindow = H.Test.candidateStageRecords(records, 32);
  assert.equal(A.Test.validateStageRows(firstWindow, identity).seriesCount, 32);
  assert.equal(A.Test.validateStageRows(secondWindow, identity).seriesCount, 8);
});

test('fast replay scans only identity columns and fetches only affected physical rows', () => {
  const target = [
    publishRow('Овощи', '2026-01-04', 1),
    publishRow('Молоко', '2026-01-04', 2),
    publishRow('Овощи', '2026-01-11', 3)
  ];
  const matrix = target.map(row => headers.map(header => row[header]));
  const sheet = {
    getName: () => 'PUBLISH_PRICE_AGGREGATES',
    getLastColumn: () => headers.length,
    getLastRow: () => matrix.length + 1,
    getRange(row, column, rowCount, columnCount) {
      assert.equal(row, 1);
      assert.equal(column, 1);
      assert.equal(rowCount, 1);
      assert.equal(columnCount, headers.length);
      return { getValues: () => [headers.slice()] };
    }
  };
  const spreadsheet = {
    getId: () => 'FAST_REPLAY_TEST',
    getSheetByName: name => name === 'PUBLISH_PRICE_AGGREGATES' ? sheet : null
  };
  const calls = [];
  const identityIndexes = [0, 2, 3, 5, 6, 7, 9, 10, 23];
  context.SpreadsheetApp = { openById: () => spreadsheet };
  context.Sheets = {
    Spreadsheets: {
      Values: {
        batchGet(_spreadsheetId, options) {
          calls.push(Array.from(options.ranges));
          if (options.ranges.length === identityIndexes.length) {
            return {
              valueRanges: identityIndexes.map(column => ({
                values: matrix.map(row => [row[column]])
              }))
            };
          }
          return {
            valueRanges: options.ranges.map(range => {
              const match = String(range).match(/!A(\d+):AC(\d+)$/);
              assert(match);
              const start = Number(match[1]) - 2;
              const end = Number(match[2]) - 1;
              return { values: matrix.slice(start, end) };
            })
          };
        }
      }
    }
  };
  const staged = H.Test.stageRecords(
    [publishRow('Овощи', '2026-01-18', 4)],
    identity
  );
  const result = H.Test.readAggregateRowsForStage('FAST_REPLAY_TEST', staged);
  assert.equal(result.scanRows, 3);
  assert.equal(result.scanCells, 27);
  assert.equal(result.affectedRows, 2);
  assert.equal(result.affectedRanges, 2);
  assert.deepEqual(result.rows.map(row => row.__row), [2, 4]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 9);
  assert.equal(calls[1].length, 2);
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
  const explicitRetryable = Object.assign(new Error('Atomic read-back remains uncertain'), {
    code: 'ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN',
    details: { retryable: true }
  });
  const fatal = H.Test.classifyError(Object.assign(new Error('Schema mismatch'), { code: 'SCHEMA_MISMATCH' }));
  assert.equal(quota.kind, 'QUOTA');
  assert.equal(quota.retryable, true);
  assert.equal(transient.kind, 'TRANSIENT');
  assert.equal(transient.retryable, true);
  assert.equal(H.Test.classifyError(explicitRetryable).kind, 'TRANSIENT');
  assert.equal(H.Test.classifyError(explicitRetryable).retryable, true);
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

test('durable aggregate resume preserves the exact replay frontier and artifact', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-4',
    release: '4.0.0-alpha.7.4.6',
    executionId: 'A74_GATE5_DF285AC01AC327DD5F35',
    status: 'STOPPED',
    phase: 'STOPPED',
    replayGroupCount: 12,
    replayGroupIndex: 0,
    replayStage: 'AGGREGATES',
    replayItemCursor: 150,
    aggregateSeriesCursor: 0,
    aggregateBatchWork: null,
    fullStageIndex: 7,
    fullBuildWork: null,
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'PRESERVED_REPLAY' }
    },
    recovery: {
      mode: 'REPLAY_ONLY_CANONICAL_INDEX_RECOVERY',
      recoveredFromExecutionId: 'A74_GATE5_CDEFB6487105607FB35F'
    },
    metrics: {
      workerExecutions: 20,
      fullBuildRowsMaterialized: 97070,
      fullBuildStagesPrepared: 7,
      replayPriceRowsWritten: 3528,
      replayAggregateCombosProcessed: 150,
      replayAggregateRowsCalculated: 1750,
      replayAggregateSeriesPublished: 140
    }
  };
  const resumed = H.Test.buildDurableResumeState(source, 'A74_GATE5_DURABLE_RESUME');
  assert.equal(resumed.stateSchemaVersion, '4.0-alpha74-gate5-state-9');
  assert.equal(resumed.release, '4.0.0-alpha.7.4.11');
  assert.equal(resumed.executionId, 'A74_GATE5_DURABLE_RESUME');
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(resumed.phase, 'SEQUENTIAL_REPLAY');
  assert.equal(resumed.replayGroupIndex, 0);
  assert.equal(resumed.replayStage, 'AGGREGATES');
  assert.equal(resumed.replayItemCursor, 150);
  assert.equal(resumed.aggregateSeriesCursor, 0);
  assert.equal(resumed.aggregateBatchWork, null);
  assert.equal(resumed.artifacts.sequentialReplay.id, 'PRESERVED_REPLAY');
  assert.equal(resumed.metrics.replayPriceRowsWritten, 3528);
  assert.equal(resumed.metrics.replayAggregateCombosProcessed, 150);
  assert.equal(resumed.metrics.replayAggregateSeriesPublished, 140);
  assert.equal(resumed.recovery.mode, 'DURABLE_AGGREGATE_BATCH_RESUME');
  assert.equal(resumed.recovery.canonicalReplayRecovery.mode, 'REPLAY_ONLY_CANONICAL_INDEX_RECOVERY');
  assert.equal(resumed.recovery.durableAggregateBatchResume.preservedItemCursor, 150);
  assert.equal(resumed.recovery.durableAggregateBatchResume.preservedSequentialReplay, true);
  assert(Buffer.byteLength(JSON.stringify(resumed), 'utf8') < 8500);
});

test('exact triggerless legacy partial batch is adopted by replaying from combo cursor', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-4',
    release: '4.0.0-alpha.7.4.6',
    executionId: 'A74_GATE5_LEGACY_PARTIAL',
    status: 'RUNNING',
    phase: 'SEQUENTIAL_REPLAY',
    replayGroupCount: 12,
    replayGroupIndex: 0,
    replayStage: 'AGGREGATES',
    replayItemCursor: 150,
    aggregateSeriesCursor: 64,
    aggregateBatchWork: null,
    fullStageIndex: 7,
    fullBuildWork: null,
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'PRESERVED_REPLAY' }
    },
    metrics: {
      fullBuildRowsMaterialized: 97070,
      fullBuildStagesPrepared: 7,
      replayAggregateCombosProcessed: 200,
      replayAggregateRowsCalculated: 3465,
      replayAggregateSeriesPublished: 204
    },
    lastStep: {
      stage: 'AGGREGATES',
      comboCursor: 150,
      comboTotal: 381,
      seriesCursor: 64,
      seriesTotal: 105
    }
  };
  const adoption = H.Test.legacyPartialAdoption(source, 0);
  assert.equal(adoption.eligible, true);
  assert.equal(adoption.mode, 'ORPHANED_RUNNING_PARTIAL_SERIES');
  assert.equal(adoption.replayPolicy, 'REPLAY_PARTIAL_BATCH_FROM_COMBO_CURSOR');
  assert.equal(H.Test.legacyPartialAdoption(source, 1).eligible, false);
  const altered = JSON.parse(JSON.stringify(source));
  altered.replayItemCursor = 151;
  assert.equal(H.Test.legacyPartialAdoption(altered, 0).eligible, false);
  const resumed = H.Test.buildDurableResumeState(
    source,
    'A74_GATE5_PARTIAL_ADOPTED',
    { legacyPartialAdoption: adoption }
  );
  assert.equal(resumed.stateSchemaVersion, '4.0-alpha74-gate5-state-9');
  assert.equal(resumed.release, '4.0.0-alpha.7.4.11');
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(resumed.phase, 'SEQUENTIAL_REPLAY');
  assert.equal(resumed.replayItemCursor, 150);
  assert.equal(resumed.aggregateSeriesCursor, 0);
  assert.equal(resumed.aggregateBatchWork, null);
  assert.equal(resumed.artifacts.sequentialReplay.id, 'PRESERVED_REPLAY');
  assert.equal(
    resumed.recovery.durableAggregateBatchResume.replayPolicy,
    'REPLAY_PARTIAL_BATCH_FROM_COMBO_CURSOR'
  );
  assert.equal(
    resumed.recovery.durableAggregateBatchResume.legacyPartialSeriesCursorReplayed,
    64
  );
  assert.equal(resumed.metrics.legacyPartialBatchAdoptions, 1);
  assert.equal(resumed.metrics.legacyPartialSeriesCursorReplayed, 64);
  assert(Buffer.byteLength(JSON.stringify(resumed), 'utf8') < 8500);
});

test('failed exact-duplicate incident preserves the durable cache for physical repair', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-6',
    release: '4.0.0-alpha.7.4.8',
    executionId: 'A74_GATE5_DUPLICATE_SOURCE',
    status: 'FAILED',
    phase: 'FAILED',
    failureCode: 'AGGREGATE_TARGET_DUPLICATE_ROW_KEY',
    replayGroupCount: 12,
    replayGroupIndex: 0,
    replayStage: 'AGGREGATES',
    replayItemCursor: 175,
    aggregateSeriesCursor: 0,
    aggregateBatchWork: {
      workSchemaVersion: '4.0-alpha74-gate5-aggregate-work-1',
      groupIndex: 0,
      loadId: 'LOAD_GATE5',
      comboCursor: 175,
      comboCount: 25,
      comboTotal: 381,
      recordCount: 875,
      seriesCount: 105,
      seriesCursor: 0,
      stageFingerprint: 'STAGE_FP',
      identity: identity
    },
    fullStageIndex: 7,
    fullBuildWork: null,
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'PRESERVED_REPLAY' }
    },
    metrics: {
      fullBuildRowsMaterialized: 97070,
      fullBuildStagesPrepared: 7,
      replayAggregateCombosProcessed: 250,
      replayAggregateRowsCalculated: 5180,
      replayAggregateSeriesPublished: 309
    }
  };
  const incident = H.Test.exactDuplicateIncident(source, 0);
  assert.equal(incident.eligible, true);
  assert.equal(incident.preserveAggregateBatch, true);
  assert.equal(H.Test.exactDuplicateIncident(source, 1).eligible, false);
  const resumed = H.Test.buildDurableResumeState(
    source,
    'A74_GATE5_DUPLICATE_RECOVERY',
    {
      legacyPartialAdoption: { eligible: false },
      exactDuplicateIncident: {
        ...incident,
        exactDuplicateLogicalRows: 517,
        exactDuplicateRows: 517
      }
    }
  );
  assert.equal(resumed.stateSchemaVersion, '4.0-alpha74-gate5-state-9');
  assert.equal(resumed.release, '4.0.0-alpha.7.4.11');
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(resumed.phase, 'SEQUENTIAL_REPLAY');
  assert.equal(resumed.replayItemCursor, 175);
  assert.equal(resumed.aggregateSeriesCursor, 0);
  assert.equal(resumed.aggregateBatchWork.recordCount, 875);
  assert.equal(resumed.aggregateBatchWork.seriesCount, 105);
  assert.equal(resumed.artifacts.sequentialReplay.id, 'PRESERVED_REPLAY');
  assert.equal(resumed.recovery.mode, 'DURABLE_EXACT_DUPLICATE_REPAIR_RESUME');
  assert.equal(resumed.recovery.durableAggregateBatchResume.preservedAggregateBatch, true);
  assert.equal(resumed.recovery.durableAggregateBatchResume.exactDuplicateLogicalRows, 517);
  assert.equal(resumed.metrics.exactDuplicateRecoveryAdoptions, 1);
  assert(Buffer.byteLength(JSON.stringify(resumed), 'utf8') < 8500);
});

test('terminal .9 atomic-uncertain checkpoint preserves its cached batch for period-identity repair', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-7',
    release: '4.0.0-alpha.7.4.9',
    executionId: 'A74_GATE5_PERIOD_IDENTITY_SOURCE',
    status: 'STOPPED',
    phase: 'STOPPED',
    failureCode: 'STOPPED_MANUALLY',
    lastError: {
      code: 'ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN'
    },
    replayGroupCount: 12,
    replayGroupIndex: 0,
    replayStage: 'AGGREGATES',
    replayItemCursor: 175,
    aggregateSeriesCursor: 0,
    aggregateBatchWork: {
      workSchemaVersion: '4.0-alpha74-gate5-aggregate-work-1',
      groupIndex: 0,
      loadId: 'LOAD_GATE5',
      comboCursor: 175,
      comboCount: 25,
      comboTotal: 381,
      recordCount: 875,
      seriesCount: 105,
      seriesCursor: 0,
      stageFingerprint: 'STAGE_FP',
      identity: identity
    },
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'PRESERVED_REPLAY' }
    },
    metrics: {
      fullBuildRowsMaterialized: 97070,
      fullBuildStagesPrepared: 7
    }
  };
  const incident = H.Test.periodIdentityIncident(source, 0);
  assert.equal(incident.eligible, true);
  assert.equal(incident.preserveAggregateBatch, true);
  assert.equal(H.Test.periodIdentityIncident(source, 1).eligible, false);
  const failedSource = JSON.parse(JSON.stringify(source));
  failedSource.status = 'FAILED';
  failedSource.phase = 'FAILED';
  failedSource.failureCode = 'ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN';
  const failedIncident = H.Test.periodIdentityIncident(failedSource, 0);
  assert.equal(failedIncident.eligible, true);
  assert.equal(
    failedIncident.mode,
    'FAILED_ATOMIC_UNCERTAIN_PERIOD_IDENTITY_WITH_DURABLE_BATCH'
  );
  const resumed = H.Test.buildDurableResumeState(
    source,
    'A74_GATE5_PERIOD_IDENTITY_RECOVERY',
    {
      legacyPartialAdoption: { eligible: false },
      exactDuplicateIncident: { eligible: false },
      periodIdentityIncident: {
        ...incident,
        stagePeriodIdentityMismatches: 875,
        exactDuplicateLogicalRows: 529,
        exactDuplicateRows: 529
      }
    }
  );
  assert.equal(resumed.stateSchemaVersion, '4.0-alpha74-gate5-state-9');
  assert.equal(resumed.release, '4.0.0-alpha.7.4.11');
  assert.equal(resumed.replayItemCursor, 175);
  assert.equal(resumed.aggregateSeriesCursor, 0);
  assert.equal(resumed.aggregateBatchWork.recordCount, 875);
  assert.equal(resumed.recovery.mode, 'DURABLE_PERIOD_IDENTITY_REPAIR_RESUME');
  assert.equal(resumed.recovery.durableAggregateBatchResume.preservedAggregateBatch, true);
  assert.equal(resumed.recovery.durableAggregateBatchResume.stagePeriodIdentityMismatches, 875);
  assert.equal(resumed.metrics.periodIdentityRecoveryAdoptions, 1);
  assert(Buffer.byteLength(JSON.stringify(resumed), 'utf8') < 8500);
});

test('stopped .10 checkpoint adopts the fast target scan without losing a partial durable batch', () => {
  const source = {
    stateSchemaVersion: '4.0-alpha74-gate5-state-8',
    release: '4.0.0-alpha.7.4.10',
    executionId: 'A74_GATE5_ALPHA7410_SOURCE',
    status: 'STOPPED',
    phase: 'STOPPED',
    failureCode: 'STOPPED_MANUALLY',
    replayGroupCount: 12,
    replayGroupIndex: 1,
    replayStage: 'AGGREGATES',
    replayItemCursor: 25,
    aggregateSeriesCursor: 64,
    aggregateBatchWork: {
      workSchemaVersion: '4.0-alpha74-gate5-aggregate-work-1',
      groupIndex: 1,
      loadId: 'LOAD_SECOND',
      comboCursor: 25,
      comboCount: 25,
      comboTotal: 369,
      recordCount: 875,
      seriesCount: 105,
      seriesCursor: 64,
      stageFingerprint: 'STAGE_FP',
      identity
    },
    artifacts: {
      baselineCanonical: { id: 'BASELINE' },
      liveSnapshot: { id: 'LIVE_SNAPSHOT' },
      fullBuild: { id: 'FULL_BUILD' },
      sequentialReplay: { id: 'PRESERVED_REPLAY' }
    },
    metrics: {
      fullBuildRowsMaterialized: 97070,
      fullBuildStagesPrepared: 7,
      replayAggregateSeriesPublished: 1318
    }
  };
  const adoption = H.Test.performanceResume(source, 0);
  assert.equal(adoption.eligible, true);
  assert.equal(adoption.boundary, 'DURABLE_SERIES');
  assert.equal(adoption.preserveAggregateBatch, true);
  assert.equal(H.Test.performanceResume(source, 1).eligible, false);
  const currentReleaseSource = JSON.parse(JSON.stringify(source));
  currentReleaseSource.stateSchemaVersion = '4.0-alpha74-gate5-state-9';
  currentReleaseSource.release = '4.0.0-alpha.7.4.11';
  assert.equal(H.Test.performanceResume(currentReleaseSource, 0).eligible, true);
  const resumed = H.Test.buildDurableResumeState(
    source,
    'A74_GATE5_FAST_TARGET_SCAN',
    {
      legacyPartialAdoption: { eligible: false },
      exactDuplicateIncident: { eligible: false },
      periodIdentityIncident: { eligible: false },
      performanceResume: adoption
    }
  );
  assert.equal(resumed.stateSchemaVersion, '4.0-alpha74-gate5-state-9');
  assert.equal(resumed.release, '4.0.0-alpha.7.4.11');
  assert.equal(resumed.replayGroupIndex, 1);
  assert.equal(resumed.replayItemCursor, 25);
  assert.equal(resumed.aggregateSeriesCursor, 64);
  assert.equal(resumed.aggregateBatchWork.seriesCursor, 64);
  assert.equal(resumed.recovery.mode, 'DURABLE_FAST_TARGET_SCAN_RESUME');
  assert.equal(
    resumed.recovery.durableAggregateBatchResume.performanceResumeBoundary,
    'DURABLE_SERIES'
  );
  assert.equal(resumed.metrics.performanceRecoveryAdoptions, 1);
  assert(Buffer.byteLength(JSON.stringify(resumed), 'utf8') < 8500);
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
  assert(harness.includes("AGGREGATE_WORK_SCHEMA_VERSION = '4.0-alpha74-gate5-aggregate-work-1'"));
  assert(harness.includes("AGGREGATE_CACHE_SHEET = 'GATE5_AGGREGATE_BATCH_STAGE'"));
  assert(harness.includes("phase: 'MATERIALIZE_AGGREGATE_BATCH'"));
  assert(harness.includes("phase: 'PUBLISH_AGGREGATE_BATCH'"));
  assert(harness.includes("phase: 'FINALIZE_REPLAY_LATEST'"));
  assert(harness.includes("STOP_REQUEST_KEY = 'AKORT_ALPHA74_GATE5_STOP_REQUEST_V1'"));
  assert(harness.includes('stopRequested_()'));
  assert(harness.includes('buildDurableResumeState_'));
  assert(harness.includes('legacyPartialAdoption_'));
  assert(harness.includes('exactDuplicateIncident_'));
  assert(harness.includes('periodIdentityIncident_'));
  assert(harness.includes('performanceResume_'));
  assert(harness.includes('readAggregateRowsForStage_'));
  assert(harness.includes('readAggregateTailRows_'));
  assert(harness.includes('Sheets.Spreadsheets.Values.batchGet'));
  assert(harness.includes('DURABLE_EXACT_DUPLICATE_REPAIR_RESUME'));
  assert(harness.includes('DURABLE_PERIOD_IDENTITY_REPAIR_RESUME'));
  assert(harness.includes('DURABLE_FAST_TARGET_SCAN_RESUME'));
  assert(harness.includes('REPLAY_PARTIAL_BATCH_FROM_COMBO_CURSOR'));
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
  assert(entries.includes('AKORT_alpha74Gate5ResumeReplay'));
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
