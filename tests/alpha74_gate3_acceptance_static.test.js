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
  isFinite
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
      return '2026-07-27T00:00:00.000Z';
    },
    safeRun(_component, fn) {
      try {
        const value = fn({ executionId: 'EXE_GATE3_STATIC' });
        return value && typeof value.ok === 'boolean'
          ? value
          : context.AKORT.Result.success('Execution completed.', value);
      } catch (error) {
        return context.AKORT.Result.failure(
          error.code || 'UNEXPECTED_ERROR',
          error.message || String(error),
          {
            code: error.code || 'UNEXPECTED_ERROR',
            message: error.message || String(error),
            details: error.details || null
          }
        );
      }
    }
  },
  Result: {
    success(message, data) {
      return { ok: true, status: 'SUCCESS', message, data: data || null };
    },
    failure(code, message, details) {
      return { ok: false, status: 'FAILED', code, message, details: details || null };
    }
  },
  EnvironmentGuard: {
    assertDev() {
      return true;
    }
  }
};

function load(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

load('src/13_Alpha71AggregateContract.js');
load('src/15_Alpha72AggregateCalculator.js');
load('src/18_Alpha73SpecialAggregateDefinitions.js');
load('src/19_Alpha73RevisionPlanner.js');
load('src/21_Alpha74AggregateIntegration.js');
load('src/24_Alpha74Gate3Acceptance.js');

const C = context.AKORT.AggregateContract;
const D = context.AKORT.SpecialAggregateDefinitions;
const P = context.AKORT.AggregateRevisionPlanner;
const A = context.AKORT.AggregateIntegration;
const H = context.AKORT.Alpha74Gate3Acceptance;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function snapshot(id, rows, label) {
  const value = { snapshot_id: id, rule_rows: rows };
  value.hash = P.Test.snapshotIdentity(value, label).computed_hash;
  return value;
}

function fixture() {
  const definition = D.Test.normalizeDefinition({
    definition_version: 'V1',
    dataset_code: 'D',
    frequency: 'weekly',
    aggregate_level: 'group',
    aggregate_subject_id: 'G',
    aggregate_name: 'Group G',
    value_type: 'price',
    index_type: 'wow',
    calculation_method: 'SUM_CONTRIBUTIONS',
    weight_rule_id: 'W',
    membership_rule_id: 'M',
    coverage_rule_id: 'DEFAULT_COMPLETE_ONLY',
    output_unit: 'percentage_point',
    weight_scope: 'group',
    effective_from: '2020-01-01',
    status: 'ACCEPTED',
    provenance: 'STATIC_ACCEPTED_FIXTURE',
    source_map_id: 'STATIC_MAP_V1'
  });
  const membership = [{
    membership_rule_id: 'M',
    membership_version: 'MV1',
    aggregate_subject_id: 'G',
    category_id: 'C',
    allocation_factor: 1,
    include_flag: 1,
    effective_from: '2020-01-01',
    effective_to: '',
    status: 'ACTIVE'
  }];
  const weights = [{
    weight_rule_id: 'W',
    weight_version: 'WV1',
    weight_scope: 'group',
    category_id: 'C',
    weight_value: 1,
    effective_from: '2020-01-01',
    effective_to: '',
    status: 'ACTIVE'
  }];
  const identity = { ...definition, period_start: '2026-01-04', group_id: 'G' };
  return {
    context: {
      context_id: 'STATIC_WEEKLY',
      dataset_code: 'D',
      frequency: 'weekly',
      value_type: 'price',
      index_type: 'wow',
      period_start: '2026-01-04'
    },
    definitions: [definition],
    membershipSnapshot: snapshot('M_SNAPSHOT', membership, 'membership'),
    weightSnapshot: snapshot('W_SNAPSHOT', weights, 'weight'),
    priceInputs: [{
      dataset_code: 'D',
      frequency: 'weekly',
      series_id: 'S_C',
      category_id: 'C',
      value_type: 'price',
      index_type: 'wow',
      period_start: '2026-01-04',
      change_pp: 1,
      unit: 'percentage_point',
      current_state: 'VALID',
      change_state: 'VALID'
    }],
    coverageRules: [{ coverage_rule_id: 'DEFAULT_COMPLETE_ONLY', allow_partial: false }],
    baseInputs: [],
    frontierPeriods: ['2026-01-04', '2026-01-11'],
    sourceCategoryId: 'C',
    acceptedRowKeys: [C.aggregateRowKey(identity)],
    fingerprint: 'STATIC_FIXTURE_FP'
  };
}

function execute(scenario) {
  const value = fixture();
  const request = H.Test.buildPlannerRequest(value, scenario);
  const mode = scenario === 'REVERSAL' ? 'REVERSAL' : 'REVISION';
  const wrapped = A.planRequestReadOnly(request, mode);
  assert.equal(wrapped.ok, true);
  return H.Test.validatePlan(wrapped.data.plan, value, scenario);
}

test('Gate 3 metadata and scenario inventory are exact', () => {
  assert.equal(H.Version, '4.0-alpha74-gate3-acceptance-1');
  assert.equal(H.Release, '4.0.0-alpha.7.4.5');
  assert.deepEqual(Object.keys(H.Scenarios).sort(), ['NEW_PERIOD', 'REVERSAL', 'REVISION']);
});

test('NEW_PERIOD plans the accepted source period and blocks the absent future period', () => {
  const result = execute('NEW_PERIOD');
  assert.equal(result.status, 'SUCCESS_WITH_BLOCKED');
  assert.equal(result.plannedItems, 1);
  assert.equal(result.blockedItems, 1);
  assert.equal(result.physicalWrites, false);
});

test('REVISION includes the next accepted dependent weekly period', () => {
  const result = execute('REVISION');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.plannedItems, 2);
  assert.equal(result.blockedItems, 0);
  assert.equal(result.calculatorBatches, 2);
});

test('REVERSAL uses positive accepted-effect evidence and the revision dependency contract', () => {
  const value = fixture();
  const request = H.Test.buildPlannerRequest(value, 'REVERSAL');
  assert.equal(request.has_current_effect, true);
  assert.equal(request.current_effect_evidence.evidence_type, 'IMMUTABLE_ACCEPTED_BASELINE_FIXTURE');
  assert.equal(request.previous_price_inputs.length, 1);
  const result = execute('REVERSAL');
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.plannedItems, 2);
  assert.equal(result.blockedItems, 0);
});

test('Planner requests and fingerprints are deterministic', () => {
  const a = H.Test.buildPlannerRequest(fixture(), 'REVISION');
  const b = H.Test.buildPlannerRequest(fixture(), 'REVISION');
  const first = A.planRequestReadOnly(a, 'REVISION');
  const second = A.planRequestReadOnly(b, 'REVISION');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.data.plan.fingerprint, second.data.plan.fingerprint);
  assert.equal(first.data.plan.input_fingerprint, second.data.plan.input_fingerprint);
});

test('Invalid read-only mode fails closed', () => {
  const result = A.planRequestReadOnly({}, 'WRITE');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ALPHA74_READ_ONLY_PLAN_MODE_INVALID');
});

test('Data-plane comparison detects target and staging drift', () => {
  const before = {
    targetRows: 10,
    targetColumns: 29,
    logicalRows: 10,
    targetFingerprint: 'FP',
    duplicateLogicalRows: 0,
    latestFailures: 0,
    futureRows: 0,
    aggregateStageLastRow: 1,
    publishImpactLastRow: 1,
    featureFlags: { execution: 'FALSE', regularPipeline: 'FALSE' }
  };
  assert.equal(H.Test.assertDataPlaneUnchanged(before, JSON.parse(JSON.stringify(before))), true);
  const changed = JSON.parse(JSON.stringify(before));
  changed.aggregateStageLastRow = 2;
  assert.throws(
    () => H.Test.assertDataPlaneUnchanged(before, changed),
    error => error.code === 'ALPHA74_GATE3_DATA_PLANE_CHANGED'
  );
});

test('Harness source permits only the final JSON evidence write', () => {
  const source = fs.readFileSync(path.join(root, 'src/24_Alpha74Gate3Acceptance.js'), 'utf8');
  assert(source.includes("folder.createFile(name, serialized, 'application/json')"));
  assert(!source.includes('.setValue('));
  assert(!source.includes('.appendRow('));
  assert(!source.includes('PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON'));
  assert(source.includes('aggregateStageLastRow'));
  assert(source.includes('publishImpactLastRow'));
  assert(source.includes('targetFingerprintUnchanged'));
  assert(source.includes('featureFlagsDisabled'));
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

console.log(JSON.stringify({
  suite: 'alpha74_gate3_acceptance_static',
  total: tests.length,
  failed
}, null, 2));

if (failed) process.exit(1);
