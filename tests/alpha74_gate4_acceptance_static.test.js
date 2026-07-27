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

context.DriveApp = {
  getFileById(id) {
    return {
      getParents() {
        let consumed = false;
        return {
          hasNext() {
            return !consumed;
          },
          next() {
            consumed = true;
            return {
              getId() {
                return id === 'OUTSIDE_GATE4' ? 'OTHER_FOLDER' : 'TEST_FILES';
              }
            };
          }
        };
      }
    };
  }
};

let settings = {
  PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
  PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: false
};

context.AKORT = {
  Core: {
    sha256(value) {
      return crypto.createHash('sha256').update(String(value)).digest('hex');
    },
    now() {
      return '2026-07-27T00:00:00.000Z';
    },
    error(code, message, details) {
      const error = new Error(message);
      error.code = code;
      error.details = details || {};
      return error;
    }
  },
  Config: {
    readSystemSettings() {
      return { ...settings };
    },
    load() {
      return {
        resources: {
          publishSpreadsheetId: 'LIVE_PUBLISH',
          testFilesFolderId: 'TEST_FILES',
          testResultsFolderId: 'TEST_RESULTS'
        }
      };
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
load('src/21_Alpha74AggregateIntegration.js');
load('src/25_Alpha74Gate4Acceptance.js');

const A = context.AKORT.AggregateIntegration;
const H = context.AKORT.Alpha74Gate4Acceptance;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('Gate 4 metadata and timeout phase inventory are exact', () => {
  assert.equal(H.Version, '4.0-alpha74-gate4-acceptance-1');
  assert.equal(H.EvidenceSchemaVersion, '4.0-alpha74-gate4-evidence-1');
  assert.deepEqual(Array.from(H.TimeoutPhases), [
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES'
  ]);
});

test('timeout before/after matrix converges for every aggregate long phase', () => {
  const matrix = H.Test.runTimeoutMatrix();
  assert.equal(matrix.length, 7);
  matrix.forEach(result => {
    assert.equal(result.timeoutBefore, 'PASS');
    assert.equal(result.timeoutAfter, 'PASS');
    assert.equal(typeof result.durableFingerprint, 'string');
    assert(result.durableFingerprint.length >= 8);
  });
});

test('isolated physical writer requires execution-only flags and forbids live Publish', () => {
  const empty = { deletePhysicalRows: [], replacementRows: [] };
  const isolated = { getId() { return 'ISOLATED_GATE4'; } };
  const noOp = A.Gate4.atomicReplaceIsolated(isolated, empty);
  assert.equal(noOp.apiCalls, 0);
  assert.equal(noOp.noOp, true);

  assert.throws(
    () => A.Gate4.atomicReplaceIsolated({ getId() { return 'LIVE_PUBLISH'; } }, empty),
    error => error.code === 'AGGREGATE_GATE4_LIVE_TARGET_FORBIDDEN'
  );
  assert.throws(
    () => A.Gate4.atomicReplaceIsolated({ getId() { return 'OUTSIDE_GATE4'; } }, empty),
    error => error.code === 'AGGREGATE_GATE4_TARGET_OUTSIDE_TEST_FOLDER'
  );

  settings = {
    PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
    PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: true
  };
  assert.throws(
    () => A.Gate4.atomicReplaceIsolated(isolated, empty),
    error => error.code === 'AGGREGATE_GATE4_FLAGS_INVALID'
  );
  settings = {
    PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
    PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: false
  };
});

test('date-valued Google Sheets read-back has the same affected fingerprint as ISO stage rows', () => {
  const identity = {
    operationId: 'OP',
    loadId: 'LOAD',
    planId: 'PLAN',
    planFingerprint: 'PLAN_FP'
  };
  const stage = [H.Test.stageRecord(identity, '2026-01-08', 2, true)];
  const target = [H.Test.publishRow('AKORT_GATE4_ISOLATED', 'GATE4_PRIMARY', '2026-01-01', 1)];
  target[0].period_start = new Date(2026, 0, 1);
  target[0].period_label = new Date(2026, 0, 1);
  const replacement = A.Test.buildSeriesReplacement(target, stage);
  const readBack = replacement.replacementRows.map(row => {
    const period = row.period_start instanceof Date
      ? [
        row.period_start.getFullYear(),
        String(row.period_start.getMonth() + 1).padStart(2, '0'),
        String(row.period_start.getDate()).padStart(2, '0')
      ].join('-')
      : String(row.period_start).slice(0, 10);
    const parts = period.split('-').map(Number);
    return {
      ...row,
      period_start: new Date(
        parts[0],
        parts[1] - 1,
        parts[2],
        12,
        0,
        0,
        0
      ),
      period_label: row.period_label instanceof Date
        ? period
        : row.period_label
    };
  });
  assert.equal(A.Test.currentAffectedFingerprint(readBack, stage), replacement.afterFingerprint);
  assert.equal(A.Test.reconcileTarget(readBack, stage, replacement).ok, true);
});

test('numeric Google Sheets date serial has the same affected fingerprint as ISO stage rows', () => {
  const identity = {
    operationId: 'OP',
    loadId: 'LOAD',
    planId: 'PLAN',
    planFingerprint: 'PLAN_FP'
  };
  const stage = [H.Test.stageRecord(identity, '2026-01-08', 2, true)];
  const target = [H.Test.publishRow('AKORT_GATE4_ISOLATED', 'GATE4_PRIMARY', '2026-01-01', 1)];
  const replacement = A.Test.buildSeriesReplacement(target, stage);
  const serialReadBack = replacement.replacementRows.map(row => {
    const parts = String(row.period_start).slice(0, 10).split('-').map(Number);
    return {
      ...row,
      period_start: Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000 + 25569
    };
  });
  assert.equal(A.Test.currentAffectedFingerprint(serialReadBack, stage), replacement.afterFingerprint);
  assert.equal(A.Test.reconcileTarget(serialReadBack, stage, replacement).ok, true);
});

test('NOOP before/after identity is recovered without a physical rewrite', () => {
  const identity = {
    operationId: 'OP',
    loadId: 'LOAD',
    planId: 'PLAN',
    planFingerprint: 'PLAN_FP'
  };
  const stage = [H.Test.stageRecord(identity, '2026-01-08', 2, true)];
  const target = [
    H.Test.publishRow('AKORT_GATE4_ISOLATED', 'GATE4_PRIMARY', '2026-01-01', 1),
    H.Test.publishRow('AKORT_GATE4_ISOLATED', 'GATE4_PRIMARY', '2026-01-08', 2)
  ];
  target[0].is_latest_period = 0;
  const replacement = A.Test.buildSeriesReplacement(target, stage);
  assert.equal(replacement.beforeFingerprint, replacement.afterFingerprint);
  assert.equal(
    A.Test.classifyRecovery(
      replacement.beforeFingerprint,
      replacement.afterFingerprint,
      A.Test.currentAffectedFingerprint(target, stage)
    ),
    'AFTER'
  );
});

test('repository wiring exposes Gate 4 entrypoints and preserves regular-pipeline guard', () => {
  const integration = fs.readFileSync(path.join(root, 'src/21_Alpha74AggregateIntegration.js'), 'utf8');
  const harness = fs.readFileSync(path.join(root, 'src/25_Alpha74Gate4Acceptance.js'), 'utf8');
  const entries = fs.readFileSync(path.join(root, 'src/08_EntryPoints.js'), 'utf8');
  const release = fs.readFileSync(path.join(root, 'src/00_Release.js'), 'utf8');
  assert(integration.includes('AGGREGATE_GATE4_LIVE_TARGET_FORBIDDEN'));
  assert(integration.includes('AGGREGATE_GATE4_TARGET_OUTSIDE_TEST_FOLDER'));
  assert(integration.includes('Both Alpha.7.4 feature flags must be true at the regular physical-write boundary.'));
  assert(integration.includes("fields: 'userEnteredValue,userEnteredFormat.numberFormat'"));
  assert(harness.includes('livePublishPhysicalWrites: 0'));
  assert(harness.includes('dataLensConnectedTargetTouched: false'));
  assert(harness.includes('PASS_NO_AUTOMATIC_OVERWRITE'));
  assert(harness.includes('PASS_ONE_BATCHUPDATE_PER_MUTATION'));
  assert(entries.includes('AKORT_alpha74Gate4Status'));
  assert(entries.includes('AKORT_alpha74Gate4Acceptance'));
  assert(release.includes("'25_Alpha74Gate4Acceptance.js'"));
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
  suite: 'alpha74_gate4_acceptance_static',
  total: tests.length,
  failed
}, null, 2));

if (failed) process.exit(1);
