const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, Date, JSON, Math, Object, Array, String, Number, Boolean, Error, RegExp, isFinite });
context.AKORT = {
  Core: {
    sha256(value) {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(String(value)).digest('hex');
    },
    now() { return '2026-07-24T00:00:00.000Z'; },
    error(code, message, details) {
      const error = new Error(message);
      error.code = code;
      error.details = details || {};
      return error;
    }
  }
};

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

load('src/13_Alpha71AggregateContract.js');
load('src/21_Alpha74AggregateIntegration.js');

const A = context.AKORT.AggregateIntegration;
const C = context.AKORT.AggregateContract;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function calcRow(period, allowed = true) {
  const series = 'D|weekly|group|G|price|wow|SUM_CONTRIBUTIONS|W|M';
  return {
    row_type: 'AGGREGATE_RESULT',
    calculation_id: 'CALC',
    aggregate_series_key: series,
    aggregate_row_key: `${series}|${period}`,
    dataset_code: 'D',
    frequency: 'weekly',
    aggregate_level: 'group',
    aggregate_subject_id: 'G',
    aggregate_name: 'Group G',
    category_id: '',
    value_type: 'price',
    index_type: 'wow',
    period_start: period,
    calculation_method: 'SUM_CONTRIBUTIONS',
    weight_rule_id: 'W',
    membership_rule_id: 'M',
    category_value: null,
    category_change_pp: null,
    category_weight: null,
    aggregate_change_pp: 1.25,
    contribution_to_group_change_pp: null,
    contribution_to_basket_change_pp: null,
    contribution_to_total_cpi_pp: null,
    aggregate_value: null,
    aggregate_base_value: null,
    applied_members_count: 2,
    applied_weight_sum: 1,
    publication_allowed: allowed
  };
}

function identity() {
  return { operationId: 'OP1', loadId: 'LOAD1', planId: 'PLAN1', planFingerprint: 'PLAN_FP' };
}

function stage(period, allowed = true) {
  return A.Test.buildStageRecord(calcRow(period, allowed), {
    ...identity(),
    calculationId: 'CALC',
    weightSnapshotId: 'W_SNAPSHOT'
  });
}

function target(period, rowNumber, value = 1) {
  const row = A.Test.projectPublishRow(calcRow(period, true), { weightSnapshotId: 'W_SNAPSHOT' });
  row.aggregate_change_pp = value;
  row.__row = rowNumber;
  return row;
}

function unrelated(rowNumber) {
  const row = { ...target('2026-01-01', rowNumber) };
  row.dataset_code = 'OTHER';
  row.aggregate_id = 'OTHER_GROUP';
  row.aggregate_name = 'Other group';
  return row;
}

function seriesStage(seriesId, period) {
  const row = calcRow(period, true);
  row.aggregate_subject_id = seriesId;
  row.aggregate_name = `Group ${seriesId}`;
  row.aggregate_series_key = row.aggregate_series_key.replace('|G|', `|${seriesId}|`);
  row.aggregate_row_key = `${row.aggregate_series_key}|${period}`;
  return A.Test.buildStageRecord(row, {
    ...identity(),
    calculationId: 'CALC',
    weightSnapshotId: 'W_SNAPSHOT'
  });
}

function seriesTarget(seriesId, period, rowNumber) {
  const record = seriesStage(seriesId, period);
  return { ...JSON.parse(record.row_payload_json), __row: rowNumber };
}

test('A74 metadata and schemas are exact', () => {
  assert.equal(A.Version, '4.0-aggregate-integration-5');
  assert.equal(A.Release, '4.0.0-alpha.7.4.26');
  assert.equal(A.OperationSchemaVersion, '4.0-operation-2');
  assert.deepEqual(Array.from(A.Phases), [
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES'
  ]);
  assert.deepEqual(Array.from(A.StageHeaders), [
    'operation_id', 'load_id', 'plan_id', 'plan_fingerprint', 'calculation_id',
    'aggregate_series_key', 'aggregate_row_key', 'period_start', 'action',
    'row_payload_json', 'row_fingerprint', 'expected_target_fingerprint',
    'stage_status', 'created_at', 'verified_at', 'release_version'
  ]);
  assert.equal(C.Headers.length, 29);
  assert(!A.StageHeaders.some(header => /row_number|physical/i.test(header)));
});

test('atomic aggregate publication preserves the canonical Publish date contract', () => {
  const monthly = { frequency: 'monthly', period_start: '2023-04-01T09:00:00.000Z' };
  const weekly = { frequency: 'weekly' };
  assert.deepEqual(
    A.Test.userEnteredValue('2023-04-01', 'period_start', monthly),
    { numberValue: 45017.5 }
  );
  assert.deepEqual(
    A.Test.userEnteredValue('2023-03-31T21:00:00.000Z', 'period_label', monthly),
    { numberValue: 45017 }
  );
  assert.deepEqual(
    A.Test.userEnteredValue('2023-04-02', 'period_label', weekly),
    { stringValue: '2023-04-02' }
  );
});

test('monthly period label is canonicalized from period_start and repairs the exact UTC month shift', () => {
  const serialized = {
    frequency: 'monthly',
    period_start: '2026-07-01T09:00:00.000Z',
    period_label: '2026-06-30T21:00:00.000Z'
  };
  const brokenPhysical = {
    frequency: 'monthly',
    period_start: 46204.5,
    period_label: 46174,
    __row: 60959
  };
  const correctedPhysical = { ...brokenPhysical, period_label: 46204 };
  assert.deepEqual(
    A.Test.userEnteredValue(serialized.period_label, 'period_label', serialized),
    { numberValue: 46204 }
  );
  assert.equal(A.Test.monthlyPeriodLabelMismatch(brokenPhysical), true);
  assert.equal(A.Test.monthlyPeriodLabelMismatch(correctedPhysical), false);
  assert.deepEqual(
    Array.from(A.Test.fingerprintRowValues(serialized, ['period_start', 'period_label'])),
    ['2026-07-01', '2026-07']
  );
  assert.deepEqual(
    Array.from(A.Test.fingerprintRowValues(brokenPhysical, ['period_start', 'period_label'])),
    ['2026-07-01', '2026-07']
  );
});

test('monthly period-label recovery reads the durable stage through the installed adapter', () => {
  const source = fs.readFileSync(path.join(root, 'src/21_Alpha74AggregateIntegration.js'), 'utf8');
  assert(source.includes('var staged = DefaultAdapter.readCalculatedRows(identity);'));
  assert(!source.includes('readCalculatedRows_(identity)'));
});

test('PUBLISH_IMPACT is scoped, parsed and deduplicated', () => {
  const record = {
    impact_id: 'I1',
    operation_id: 'OP1',
    load_id: 'LOAD1',
    frequency: 'weekly',
    dataset_code: 'D',
    category_id: 'C',
    value_type: 'price',
    source_period: '2026-01-01',
    aggregate_combos_json: JSON.stringify([{ frequency: 'weekly', datasetCode: 'D', period: '2026-01-08', valueType: 'price', indexType: 'wow' }]),
    series_ids_json: '["S1"]',
    affected_periods_json: '["2026-01-08"]'
  };
  const result = A.Test.normalizeImpactRecords([record, { ...record }], 'OP1', 'LOAD1');
  assert.equal(result.recordCount, 1);
  assert.equal(result.aggregateComboCount, 1);
  assert.throws(
    () => A.Test.normalizeImpactRecords([{ ...record, load_id: 'OTHER' }], 'OP1', 'LOAD1'),
    error => error.code === 'AGGREGATE_IMPACT_SCOPE_MISMATCH'
  );
});

test('accepted Alpha.6 parity adapter deduplicates combos and creates exact publication identities', () => {
  const prepared = {
    records: [{
      aggregate_combos: [
        { frequency: 'weekly', datasetCode: 'D', period: '2026-01-08', valueType: 'price', indexType: 'wow' },
        { frequency: 'weekly', dataset_code: 'D', period_start: '2026-01-08', value_type: 'price', index_type: 'wow' }
      ]
    }]
  };
  const combos = A.Test.preparedCombos(prepared);
  assert.equal(combos.length, 1);
  assert.equal(combos[0].period, '2026-01-08');
  const projected = A.Test.projectPublishRow(calcRow('2026-01-08', true), { weightSnapshotId: 'W_SNAPSHOT' });
  const record = A.Test.directStageRecord(projected, 'UPSERT', identity());
  assert.equal(record.aggregate_row_key, `${record.aggregate_series_key}|2026-01-08`);
  assert.equal(record.action, 'UPSERT');
  assert.deepEqual(Object.keys(JSON.parse(record.row_payload_json)).sort(), Array.from(C.Headers).sort());
});

test('stage rows preserve logical identity and exact 29-column payload', () => {
  const row = stage('2026-01-08');
  const validation = A.Test.validateStageRows([row], identity());
  assert.equal(validation.rowCount, 1);
  assert.equal(validation.seriesCount, 1);
  assert.deepEqual(Object.keys(JSON.parse(row.row_payload_json)).sort(), Array.from(C.Headers).sort());
  assert.equal(row.action, 'UPSERT');
  assert.equal(stage('2026-01-08', false).action, 'DELETE');
});

test('stage fingerprint survives Google Sheets date coercion', () => {
  const row = stage('2026-01-08');
  row.period_start = new Date(2026, 0, 8);
  const validation = A.Test.validateStageRows([row], identity());
  assert.equal(validation.rowCount, 1);
  assert.equal(validation.seriesCount, 1);
});

test('large stage validation advances only by its durable row budget', () => {
  const rows = [];
  for (let index = 0; index < 235; index += 1) {
    rows.push(seriesStage(`G${index}`, '2026-01-08'));
  }
  const first = A.Test.validateStageRowsChunk(rows, identity(), 0, 100);
  const second = A.Test.validateStageRowsChunk(rows, identity(), first.cursor, 100);
  const third = A.Test.validateStageRowsChunk(rows, identity(), second.cursor, 100);
  assert.equal(first.cursor, 100);
  assert.equal(first.complete, false);
  assert.equal(second.cursor, 200);
  assert.equal(second.complete, false);
  assert.equal(third.cursor, 235);
  assert.equal(third.complete, true);
  assert.equal(first.stageFingerprint, third.stageFingerprint);
});

test('Gate 6 recovery snapshot validator is exact and synchronously bounded', () => {
  const rows = [];
  for (let index = 0; index < 392; index += 1) {
    rows.push(seriesStage(`RECOVERY_${index}`, '2026-01-08'));
  }
  const validation = A.validateRecoveryStageSnapshot(rows, identity());
  assert.equal(validation.complete, true);
  assert.equal(validation.rowCount, 392);
  assert.throws(
    () => A.validateRecoveryStageSnapshot(new Array(501).fill(rows[0]), identity()),
    error => error.code === 'AGGREGATE_RECOVERY_STAGE_SNAPSHOT_TOO_LARGE'
  );
});

test('full logical-series replacement retains unaffected periods and updates latest atomically', () => {
  const staged = [stage('2026-01-08')];
  const other = unrelated(4);
  const replacement = A.Test.buildSeriesReplacement([
    target('2026-01-01', 2, 0.5),
    target('2026-01-08', 3, 0.75),
    other
  ], staged);
  assert.equal(replacement.affectedSeriesKeys.length, 1);
  assert.equal(replacement.replacementRows.length, 2);
  assert.deepEqual(Array.from(replacement.deletePhysicalRows), [3, 2]);
  const latest = replacement.replacementRows.filter(row => Number(row.is_latest_period) === 1);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].period_start, '2026-01-08');
  assert.notEqual(replacement.beforeFingerprint, replacement.afterFingerprint);
  const afterTarget = [other].concat(replacement.replacementRows);
  assert.equal(A.Test.currentAffectedFingerprint(afterTarget, staged), replacement.afterFingerprint);
  const reconciliation = A.Test.reconcileTarget(afterTarget, staged, replacement);
  assert.equal(reconciliation.ok, true);
});

test('exact physical duplicates are repaired while preserving one canonical logical row', () => {
  const staged = [stage('2026-01-08')];
  const first = target('2026-01-01', 2, 0.5);
  const duplicate = { ...first, __row: 3 };
  const replacement = A.Test.buildSeriesReplacement([
    first,
    duplicate,
    target('2026-01-08', 4, 0.75)
  ], staged);
  assert.equal(replacement.requiresPhysicalRepair, true);
  assert.equal(replacement.exactDuplicateLogicalRows.length, 1);
  assert.equal(replacement.exactDuplicateRowCount, 1);
  assert.deepEqual(Array.from(replacement.exactDuplicatePhysicalRows), [3]);
  assert.deepEqual(Array.from(replacement.deletePhysicalRows), [4, 3, 2]);
  assert.equal(replacement.beforeRows.length, 2);
  assert.equal(replacement.replacementRows.length, 2);
  const reconciled = A.Test.reconcileTarget(
    replacement.replacementRows,
    staged,
    replacement
  );
  assert.equal(reconciled.ok, true);
});

test('legacy staged Monday identity is replaced by the Sunday publication identity', () => {
  const legacy = stage('2026-01-05');
  const payload = JSON.parse(legacy.row_payload_json);
  payload.period_start = '2026-01-04T21:00:00.000Z';
  legacy.row_payload_json = JSON.stringify(payload);
  const first = target('2026-01-04', 2, 0.5);
  const duplicate = { ...first, __row: 3 };
  const replacement = A.Test.buildSeriesReplacement([first, duplicate], [legacy]);
  assert.equal(replacement.requiresStagePeriodIdentityRepair, true);
  assert.equal(replacement.stagePeriodIdentityMismatchCount, 1);
  assert.equal(
    replacement.stagePeriodIdentityMismatches[0].publicationRowKey,
    `${legacy.aggregate_series_key}|2026-01-04`
  );
  assert.equal(replacement.requiresPhysicalRepair, true);
  assert.deepEqual(Array.from(replacement.deletePhysicalRows), [3, 2]);
  assert.equal(replacement.replacementRows.length, 1);
  assert.equal(replacement.replacementRows[0].period_start, '2026-01-04T21:00:00.000Z');
});

test('conflicting duplicate logical rows remain fail-closed', () => {
  const first = target('2026-01-01', 2, 0.5);
  const conflicting = { ...first, __row: 3, aggregate_change_pp: 0.6 };
  assert.throws(
    () => A.Test.buildSeriesReplacement([first, conflicting], [stage('2026-01-08')]),
    error => error.code === 'AGGREGATE_TARGET_DUPLICATE_ROW_KEY_CONFLICT' &&
      error.details.requiresReview === true
  );
});

test('non-publishable result deletes only its logical period and restores prior latest', () => {
  const staged = [stage('2026-01-08', false)];
  const replacement = A.Test.buildSeriesReplacement([
    target('2026-01-01', 2),
    target('2026-01-08', 3)
  ], staged);
  assert.equal(replacement.replacementRows.length, 1);
  assert.equal(replacement.replacementRows[0].period_start, '2026-01-01');
  assert.equal(replacement.replacementRows[0].is_latest_period, 1);
});

test('atomic batching keeps every logical series whole and respects row and cell limits', () => {
  const staged = ['G1', 'G2', 'G3'].map(seriesId => seriesStage(seriesId, '2026-01-08'));
  const targetRows = [];
  let rowNumber = 2;
  ['G1', 'G2', 'G3'].forEach(seriesId => {
    targetRows.push(seriesTarget(seriesId, '2026-01-01', rowNumber++));
    targetRows.push(seriesTarget(seriesId, '2026-01-08', rowNumber++));
  });
  const batches = A.Test.atomicSeriesBatches(targetRows, staged, {
    atomicMaxRows: 3,
    atomicMaxCells: 87,
    atomicMaxRequests: 10
  }).map(batch => Array.from(batch));
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map(batch => batch.length), [1, 1, 1]);
  assert.deepEqual(batches.flat().sort(), staged.map(row => row.aggregate_series_key).sort());
  assert.throws(
    () => A.Test.atomicSeriesBatches(targetRows, staged, {
      atomicMaxRows: 1,
      atomicMaxCells: 29,
      atomicMaxRequests: 10
    }),
    error => error.code === 'AGGREGATE_PUBLISH_SINGLE_SERIES_LIMIT_EXCEEDED'
  );
});

test('lost-response recovery distinguishes before, after and third state', () => {
  assert.equal(A.Test.classifyRecovery('BEFORE', 'AFTER', 'BEFORE'), 'BEFORE');
  assert.equal(A.Test.classifyRecovery('BEFORE', 'AFTER', 'AFTER'), 'AFTER');
  assert.equal(A.Test.classifyRecovery('BEFORE', 'AFTER', 'MIXED'), 'THIRD_STATE');
  assert.equal(A.Test.classifyRecovery('SAME', 'SAME', 'SAME'), 'AFTER');
});

test('bounded phase execution checkpoints and recovers to SUCCESS', () => {
  const impact = {
    impact_id: 'I1',
    operation_id: 'OP1',
    load_id: 'LOAD1',
    frequency: 'weekly',
    dataset_code: 'D',
    category_id: 'C',
    value_type: 'price',
    source_period: '2026-01-01',
    aggregate_combos_json: JSON.stringify([{ frequency: 'weekly', datasetCode: 'D', period: '2026-01-08', valueType: 'price', indexType: 'wow' }]),
    series_ids_json: '["S1"]',
    affected_periods_json: '["2026-01-08"]'
  };
  let artifact = null;
  let artifactPersistenceCalls = 0;
  let stageRows = [];
  const intents = {};
  let targetRows = [target('2025-12-25', 2), unrelated(3)];
  let finalized = false;
  const plan = {
    ok: true,
    plan_id: 'PLAN1',
    fingerprint: 'PLAN_FP',
    calculator_shared_input: {
      price_inputs: [],
      weight_snapshot: { snapshot_id: 'W_SNAPSHOT', hash: 'W_HASH', rule_rows: [] },
      membership_snapshot: { snapshot_id: 'M_SNAPSHOT', hash: 'M_HASH', rule_rows: [] },
      coverage_rules: [],
      base_inputs: [],
      options: {}
    },
    calculator_batches: ['2026-01-01', '2026-01-08'].map((period, index) => ({
      calculation_id: `B${index}`,
      impact_items: [{ combo_key: `K${index}`, target_period: period }],
      aggregate_definitions: [{ definition_id: `D${index}`, dataset_code: 'D', frequency: 'weekly', value_type: 'price', index_type: 'wow' }]
    }))
  };
  context.AKORT.AggregateCalculator = {
    Test: { sha256: context.AKORT.Core.sha256 },
    calculateBatch(request) {
      const period = request.impact_items[0].target_period;
      return { ok: true, rows: [{ ...calcRow(period), calculation_id: request.calculation_id }] };
    }
  };
  const adapter = {
    runtimeSettings() {
      return {
        PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
        PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: true,
        PUBLISH_AGGREGATE_CALCULATION_GROUPS_PER_STEP: 1,
        PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP: 1,
        PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP: 1,
        PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP: 1,
        PUBLISH_AGGREGATE_STAGE_STATUS_ROWS_PER_STEP: 1,
        PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS: 100,
        PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS: 2900,
        PUBLISH_AGGREGATE_ARTIFACT_CHUNK_CHARS: 30000
      };
    },
    readImpactRecords() { return [impact]; },
    materializeArtifact() { return { plan }; },
    persistInputArtifact(_identity, value) {
      artifact = JSON.parse(JSON.stringify(value));
      artifactPersistenceCalls += 1;
      return {
        complete: artifactPersistenceCalls > 1,
        persistedChunks: artifactPersistenceCalls,
        totalChunks: 2
      };
    },
    readInputArtifact() { return JSON.parse(JSON.stringify(artifact)); },
    upsertCalculatedRows(_identity, records) {
      records.forEach(record => {
        const existing = stageRows.find(row => row.aggregate_row_key === record.aggregate_row_key);
        if (!existing) stageRows.push(JSON.parse(JSON.stringify(record)));
      });
      return { total: stageRows.length };
    },
    readCalculatedRows() { return JSON.parse(JSON.stringify(stageRows)); },
    updateStageStatus() {},
    updateStageStatusChunk(_identity, _status, _fingerprint, cursor, maxRows) {
      const end = Math.min(stageRows.length, Number(cursor || 0) + Number(maxRows || 1));
      return { cursor: end, total: stageRows.length, complete: end >= stageRows.length };
    },
    updateStageExpectedFingerprint() {},
    persistPublishIntent(_identity, value, batchKey) {
      intents[batchKey || 'FINAL'] = JSON.parse(JSON.stringify(value));
    },
    readPublishIntent(_identity, batchKey) {
      const value = intents[batchKey || 'FINAL'];
      return value && JSON.parse(JSON.stringify(value));
    },
    readTargetRows() { return JSON.parse(JSON.stringify(targetRows)); },
    readTargetRowsForStage(records) {
      const signatures = new Set(records.map(record => A.Test.publicSignature(JSON.parse(record.row_payload_json))));
      return JSON.parse(JSON.stringify(targetRows.filter(row => signatures.has(A.Test.publicSignature(row)))));
    },
    atomicReplace(replacement) {
      const unaffected = targetRows.filter(row => A.Test.publicSignature(row) !== A.Test.publicSignature(replacement.replacementRows[0]));
      targetRows = unaffected.concat(replacement.replacementRows.map((row, index) => ({ ...row, __row: unaffected.length + index + 2 })));
    },
    recordReconciliation() {},
    finalize() { finalized = true; }
  };
  const executionContext = {
    operation: { operation_id: 'OP1' },
    checkpoint: { aggregate: { schemaVersion: '4.0-aggregate-stage-1', status: 'NOT_STARTED', calculationCursor: 0, stagingCursor: 0, batchNo: 0 } }
  };
  const options = { adapter, loadId: 'LOAD1', mode: 'REVISION' };
  A.execute('PREPARING_AGGREGATE_IMPACT', executionContext, options);
  const materializing = A.execute('MATERIALIZING_AGGREGATE_INPUTS', executionContext, options);
  assert.equal(materializing.repeatPhase, true);
  const materialized = A.execute('MATERIALIZING_AGGREGATE_INPUTS', executionContext, options);
  assert.equal(materialized.repeatPhase, false);
  const first = A.execute('CALCULATING_AGGREGATE_SLICES', executionContext, options);
  assert.equal(first.repeatPhase, true);
  const second = A.execute('CALCULATING_AGGREGATE_SLICES', executionContext, options);
  assert.equal(second.repeatPhase, false);
  let staging;
  do {
    staging = A.execute('STAGING_AGGREGATE_ROWS', executionContext, options);
  } while (staging.repeatPhase);
  let publishing;
  do {
    publishing = A.execute('UPDATING_AGGREGATES', executionContext, options);
  } while (publishing.repeatPhase);
  let latest;
  do {
    latest = A.execute('UPDATING_AGGREGATE_LATEST', executionContext, options);
  } while (latest.repeatPhase);
  let reconciliation;
  do {
    reconciliation = A.execute('RECONCILING_AGGREGATES', executionContext, options);
  } while (reconciliation.repeatPhase);
  let finalizing;
  do {
    finalizing = A.execute('FINALIZING', executionContext, options);
  } while (finalizing.repeatPhase);
  assert.equal(executionContext.checkpoint.aggregate.status, 'SUCCESS');
  assert.equal(finalized, true);
});

test('disabled-by-default gate prevents all adapter reads and writes', () => {
  let touched = false;
  const adapter = {
    runtimeSettings() { return {}; },
    readImpactRecords() { touched = true; return []; },
    finalize() {}
  };
  const executionContext = { operation: { operation_id: 'OP1' }, checkpoint: {} };
  const result = A.execute('PREPARING_AGGREGATE_IMPACT', executionContext, { adapter, loadId: 'LOAD1' });
  assert.equal(result.skipped, true);
  assert.equal(touched, false);
  assert.equal(executionContext.checkpoint.aggregate.status, 'SKIPPED_DISABLED');
});

test('large materialization without a durable chunk adapter is forbidden before planner execution', () => {
  const combos = Array.from({ length: 9 }, (_value, index) => ({
    frequency: 'monthly',
    datasetCode: 'D',
    period: `2026-${String(index + 1).padStart(2, '0')}`,
    valueType: 'price',
    indexType: 'mom'
  }));
  const impact = {
    impact_id: 'I_LARGE',
    operation_id: 'OP_LARGE',
    load_id: 'LOAD_LARGE',
    frequency: 'monthly',
    dataset_code: 'D',
    category_id: 'C',
    value_type: 'price',
    source_period: '2026-01',
    aggregate_combos_json: JSON.stringify(combos),
    series_ids_json: '[]',
    affected_periods_json: JSON.stringify(combos.map(combo => combo.period))
  };
  let plannerCalled = false;
  const adapter = {
    runtimeSettings() {
      return {
        PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
        PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: true,
        PUBLISH_AGGREGATE_MONOLITHIC_COMBO_LIMIT: 8
      };
    },
    readImpactRecords() { return [impact]; },
    materializeArtifact() { plannerCalled = true; return null; }
  };
  const executionContext = { operation: { operation_id: 'OP_LARGE' }, checkpoint: {} };
  const options = { adapter, loadId: 'LOAD_LARGE' };
  A.execute('PREPARING_AGGREGATE_IMPACT', executionContext, options);
  assert.throws(
    () => A.execute('MATERIALIZING_AGGREGATE_INPUTS', executionContext, options),
    error => error.code === 'AGGREGATE_MONOLITHIC_MATERIALIZATION_FORBIDDEN'
  );
  assert.equal(plannerCalled, false);
});

test('repository wiring removes deferred executor and hard-coded write probes', () => {
  const engine = fs.readFileSync(path.join(root, 'src/03_OperationEngine.js'), 'utf8');
  const raw = fs.readFileSync(path.join(root, 'src/05_RawStore.js'), 'utf8');
  const parser = fs.readFileSync(path.join(root, 'src/06_ExistingSourceParsers.js'), 'utf8');
  const entries = fs.readFileSync(path.join(root, 'src/08_EntryPoints.js'), 'utf8');
  const release = fs.readFileSync(path.join(root, 'src/00_Release.js'), 'utf8');
  const aggregate = fs.readFileSync(path.join(root, 'src/21_Alpha74AggregateIntegration.js'), 'utf8');
  const gate1Cleanup = fs.readFileSync(path.join(root, 'src/23_Alpha74Gate1Cleanup.js'), 'utf8');
  const gate3Acceptance = fs.readFileSync(path.join(root, 'src/24_Alpha74Gate3Acceptance.js'), 'utf8');
  assert(engine.includes("value: '4.0-operation-2'"));
  assert(engine.includes("FAILED_REQUIRES_REVIEW"));
  assert(!raw.includes('IncrementalPublish.applyAggregates'));
  assert(!parser.includes('IncrementalPublish.applyAggregates'));
  assert(!entries.includes('AKORT_probeIncrementalWrite'));
  assert(!entries.includes('AKORT_probeIncrementalRead'));
  assert(entries.includes('AKORT_alpha74ReadOnlyContractScan'));
  assert(entries.includes('AKORT_alpha74ReadOnlyPlan'));
  assert(entries.includes('AKORT_alpha74Gate1LegacyStatus'));
  assert(entries.includes('AKORT_alpha74Gate1CloseLegacyOperations'));
  assert(entries.includes('AKORT_alpha74Gate3RuntimeContextStatus'));
  assert(entries.includes('AKORT_alpha74Gate3NewPeriodPlan'));
  assert(entries.includes('AKORT_alpha74Gate3RevisionPlan'));
  assert(entries.includes('AKORT_alpha74Gate3ReversalPlan'));
  assert(entries.includes('AKORT_alpha74Gate3Acceptance'));
  assert(gate1Cleanup.includes("var EXPECTED_PROFILE = {"));
  assert(gate1Cleanup.includes("total: 4"));
  assert(gate1Cleanup.includes("alpha3Test: 3"));
  assert(gate1Cleanup.includes("alpha4SmokeReversal: 1"));
  assert(gate1Cleanup.includes("REVERSAL_TARGET_LOAD_PRESENT"));
  assert(gate1Cleanup.includes("REVERSAL_LOG_PRESENT"));
  assert(gate1Cleanup.includes("ACTIVE_LEASE"));
  assert(gate1Cleanup.includes("rawRowsChanged: 0"));
  assert(gate1Cleanup.includes("publishRowsChanged: 0"));
  assert(gate1Cleanup.includes("aggregateRowsChanged: 0"));
  assert(gate3Acceptance.includes("mode: 'IN_MEMORY_ACCEPTANCE_ONLY'"));
  assert(gate3Acceptance.includes("productionSettingsChanged: false"));
  assert(gate3Acceptance.includes("dataPlaneWrites: 0"));
  assert(gate3Acceptance.includes("evidenceFileWrites: 1"));
  assert(!gate3Acceptance.includes('PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON'));
  assert(!gate3Acceptance.includes('.setValue('));
  assert(!gate3Acceptance.includes('.appendRow('));
  assert(release.includes("'AGGREGATE_STAGE'"));
  assert(release.includes("'FINALIZING'"));
  assert(release.includes("'24_Alpha74Gate3Acceptance.js'"));
  assert(release.includes("version: '4.0.0-alpha.7.4.26'"));
  assert(release.includes('durable bounded work'));
  const boundedSettings = [
    'PUBLISH_AGGREGATE_MATERIALIZATION_COMBOS_PER_STEP',
    'PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP',
    'PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP',
    'PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP',
    'PUBLISH_AGGREGATE_RECONCILIATION_SERIES_PER_STEP',
    'PUBLISH_AGGREGATE_STAGE_STATUS_ROWS_PER_STEP',
    'PUBLISH_AGGREGATE_MONOLITHIC_COMBO_LIMIT'
  ];
  for (const setting of boundedSettings) {
    assert(aggregate.includes(setting), `missing bounded aggregate setting: ${setting}`);
  }
  assert(aggregate.includes('materializeArtifactChunk: acceptedParityChunk_'));
  assert(aggregate.includes('AGGREGATE_MONOLITHIC_MATERIALIZATION_FORBIDDEN'));
  assert(aggregate.includes("publicationMode: 'DURABLE_BOUNDED_LOGICAL_SERIES'"));
  const releaseContext = vm.createContext({ console, Object, JSON });
  releaseContext.AKORT = {};
  vm.runInContext(release, releaseContext, { filename: 'src/00_Release.js' });
  for (const sourceFile of Array.from(releaseContext.AKORT.Release.sourceFiles)) {
    assert(fs.existsSync(path.join(root, 'src', sourceFile)), `release source file is missing: ${sourceFile}`);
  }
});

test('Gate 1 cleanup classifier is fail-closed for the approved four-operation profile', () => {
  const source = fs.readFileSync(path.join(root, 'src/23_Alpha74Gate1Cleanup.js'), 'utf8');
  const context = vm.createContext({
    console,
    JSON,
    Date,
    Object,
    AKORT: {}
  });
  vm.runInContext(source, context, { filename: 'src/23_Alpha74Gate1Cleanup.js' });
  const cleanup = context.AKORT.Alpha74Gate1Cleanup;
  const classify = cleanup.Test.classifyLegacyOperation;
  const now = Date.parse('2026-07-27T00:00:00.000Z');
  const checkpoint = input => JSON.stringify({
    schemaVersion: '4.0-operation-1',
    nextPhase: 'VALIDATE',
    completedPhases: ['DISCOVER'],
    input: input || {},
    control: { stopRequested: false },
    meta: {},
    lease: null
  });
  const alpha3 = {
    operation_id: 'OP_ALPHA3_TEST_LEASE_EXAMPLE',
    operation_type: 'ALPHA3_TEST_LEASE',
    status: 'PAUSED',
    current_phase: 'VALIDATE',
    checkpoint_json: checkpoint({})
  };
  assert.equal(classify(alpha3, {}, now).classification, 'CANDIDATE');
  assert.equal(classify(alpha3, {}, now).kind, 'ALPHA3_TEST');
  assert.equal(classify(alpha3, {}, now).operationId, 'OP_ALPHA3_TEST_LEASE_EXAMPLE');

  const activeLease = JSON.parse(alpha3.checkpoint_json);
  activeLease.lease = { executionId: 'EXE_ACTIVE', expiresAt: '2026-07-27T00:05:00.000Z' };
  assert.equal(classify({ ...alpha3, checkpoint_json: JSON.stringify(activeLease) }, {}, now).reason, 'ACTIVE_LEASE');

  const reversal = {
    operation_id: 'OP_RAW_REVERSAL_V4_EXAMPLE',
    operation_type: 'RAW_REVERSAL_V4',
    status: 'RUNNING',
    current_phase: 'COMMIT_RAW',
    checkpoint_json: checkpoint({
      targetLoadId: 'LOAD_EXAMPLE',
      reason: 'Alpha.4 smoke reversal'
    })
  };
  assert.equal(classify(reversal, { targetLoadExists: false, reversalRecordExists: false }, now).kind, 'ALPHA4_SMOKE_REVERSAL');
  assert.equal(classify(reversal, { targetLoadExists: true, reversalRecordExists: false }, now).reason, 'REVERSAL_TARGET_LOAD_PRESENT');
  assert.equal(classify(reversal, { targetLoadExists: false, reversalRecordExists: true }, now).reason, 'REVERSAL_LOG_PRESENT');
  assert.equal(classify({ ...alpha3, operation_id: 'OP_REAL', operation_type: 'REAL_PIPELINE' }, {}, now).reason, 'UNSAFE_LEGACY_OPERATION');

  assert.equal(cleanup.Test.profileMatches({
    total: 4,
    alpha3Test: 3,
    alpha4SmokeReversal: 1
  }), true);
  assert.equal(cleanup.Test.profileMatches({
    total: 5,
    alpha3Test: 4,
    alpha4SmokeReversal: 1
  }), false);
});

let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error.stack || error);
  }
}
console.log(JSON.stringify({ suite: 'alpha74_aggregate_integration_static', total: tests.length, failed }, null, 2));
if (failed) process.exit(1);
