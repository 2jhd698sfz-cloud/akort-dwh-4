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
  assert.equal(G.Version, '4.0-alpha74-gate6-acceptance-1');
  assert.equal(G.Release, '4.0.0-alpha.7.4.18');
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
    release_version: '4.0.0-alpha.7.4.18',
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
