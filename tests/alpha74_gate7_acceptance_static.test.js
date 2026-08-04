const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const release = source('src/00_Release.js');
const gate6 = source('src/28_Alpha74Gate6Acceptance.js');
const gate7 = source('src/29_Alpha74Gate7Acceptance.js');
const industry = source('src/27_Alpha74IndustryInput.js');
const entrypoints = source('src/08_EntryPoints.js');
const integration = source('src/21_Alpha74AggregateIntegration.js');
const packageJson = JSON.parse(source('package.json'));

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    tests.push({ name, status: 'FAIL', error: error.message });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('Gate 7 candidate release is exact', () => {
  assert(release.includes("version: '4.0.0-alpha.7.4.39'"));
  assert(integration.includes("var RELEASE = '4.0.0-alpha.7.4.39';"));
  assert(industry.includes("var RELEASE = '4.0.0-alpha.7.4.39';"));
  assert.equal(packageJson.version, '4.0.0-alpha.7.4.39');
});

test('Accepted Gate 6 evidence remains pinned to .35', () => {
  assert(gate6.includes("var RELEASE = '4.0.0-alpha.7.4.35';"));
  assert(!gate6.includes("var RELEASE = '4.0.0-alpha.7.4.39';"));
});

test('Gate 7 metadata and state contracts are exact', () => {
  [
    "var VERSION = '4.0-alpha74-gate7-acceptance-2';",
    "var EVIDENCE_SCHEMA = '4.0-alpha74-gate7-evidence-1';",
    "var STATE_SCHEMA = '4.0-alpha74-gate7-state-2';",
    "'4.0-alpha74-gate7-industry-state-1'",
    "'4.0-alpha74-gate7-industry-permit-1'",
    "var EXPECTED_PROFILE_COUNT = 12;",
    "var PREVIEW_BATCH_SIZE = 2;",
    "var PREVIEW_ITEM_ENCODING = 'ARRAY_V1';"
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Control inventory and preview matrix remain exact', () => {
  [
    "var CONTROL_SHEET = 'GATE7_CONTROL_FILES';",
    'AKORT.ExistingSourceParsers.profiles()',
    'AKORT.ExistingSourceParsers.previewFile(',
    'ALPHA74_GATE7_PROFILE_RECOGNITION_MISMATCH',
    'ALPHA74_GATE7_PREVIEW_BLOCKING_ISSUES',
    'ALPHA74_GATE7_CONTROL_FILE_MUTATED',
    "state.status = 'PREVIEW_ACCEPTED';",
    'compactPreviewItem_(item)',
    'expandPreviewItems_(state.items)',
    'expandedItems.map(stablePreviewItem_)'
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Industry acceptance never enables the general user pipeline', () => {
  assert(gate7.includes('ALPHA74_GATE7_USER_PIPELINE_ALREADY_ENABLED'));
  assert(industry.includes(
    'INDUSTRY_INPUT_GATE7_USER_PIPELINE_MUST_REMAIN_DISABLED'
  ));
  [
    'writeSystemSettings',
    'setSystemSettings',
    'PUBLISH_USER_PIPELINE_ENABLED =',
    "PUBLISH_USER_PIPELINE_ENABLED: 'TRUE'"
  ].forEach(marker => {
    assert(!gate7.includes(marker), marker);
    assert(!industry.includes(marker), marker);
  });
});

test('Permit is one-time, exact-row and content-hash bound', () => {
  [
    'AKORT_ALPHA74_GATE7_INDUSTRY_PERMIT_V1',
    'INDUSTRY_INPUT_GATE7_PERMIT_AUTHORIZATION_MISMATCH',
    'INDUSTRY_INPUT_GATE7_ROW_SET_MISMATCH',
    'INDUSTRY_INPUT_GATE7_ROW_BINDING_MISMATCH',
    'INDUSTRY_INPUT_GATE7_CONTENT_HASH_MISMATCH',
    "permit.status = 'CLAIMED';",
    "permit.status = 'CONSUMED';",
    "permit.status = 'COMPLETE';"
  ].forEach(marker => assert(industry.includes(marker), marker));
});

test('Ordinary Industry submit remains independently gated', () => {
  const start = industry.indexOf('function submit()');
  const end = industry.indexOf('function continueLatest()', start);
  const ordinarySubmit = industry.slice(start, end);
  assert(ordinarySubmit.includes('assertLiveSubmissionReady_();'));
  assert(!ordinarySubmit.includes('assertAcceptanceRuntimeReady_();'));
});

test('Gate 7 lifecycle includes load, duplicate and reversal', () => {
  [
    "phase: 'RUN_LOAD'",
    "'ENQUEUE_DUPLICATE'",
    "'RUN_DUPLICATE'",
    "'ENQUEUE_REVERSAL'",
    "'RUN_REVERSAL'",
    "'INDUSTRY_ACCEPTED'",
    "'RAW_LOAD_V4'",
    "'RAW_REVERSAL_V4'",
    'ALPHA74_GATE7_DUPLICATE_CHANGED_STATE',
    'ALPHA74_GATE7_ROLLBACK_NOT_EXACT',
    "text_(audit.loadStatus) === 'REVERSED'"
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Duplicate and rollback proofs use deterministic snapshots', () => {
  [
    'acceptanceSnapshot',
    'publishIndustryDigest_',
    'rawFingerprint',
    'publishFingerprint',
    'assertSnapshotsEqual_(',
    'ALPHA74_GATE7_DUPLICATE_BEFORE_DRIFT',
    'ALPHA74_GATE7_FINAL_BASELINE_DRIFT'
  ].forEach(marker => assert(
    industry.includes(marker) || gate7.includes(marker),
    marker
  ));
});

test('Final evidence is single, hashed and source-backed', () => {
  [
    "var EVIDENCE_SHEET = 'GATE7_EVIDENCE';",
    'AKORT.AggregateIntegration.readOnlyContractScan()',
    'AKORT.Core.canonicalJson(core)',
    'AKORT.Core.Sheets.appendObject(',
    'ALPHA74_GATE7_EVIDENCE_CELL_CAPACITY_EXCEEDED',
    "industryState.status = 'GATE7_ACCEPTED';",
    '.deleteProperty(INDUSTRY_PERMIT_PROPERTY)'
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Gate 7 public entrypoints remain complete', () => {
  [
    'AKORT_alpha74Gate7Install',
    'AKORT_alpha74Gate7Status',
    'AKORT_alpha74Gate7PreviewMatrix',
    'AKORT_alpha74Gate7StartIndustry',
    'AKORT_alpha74Gate7ContinueIndustry',
    'AKORT_alpha74Gate7Finalize'
  ].forEach(name => assert(
    entrypoints.includes('function ' + name + '('),
    name
  ));
});

test('Gate 7 source has no generic data-plane entrypoint', () => {
  [
    'function AKORT_alpha74Gate7Generic',
    'function AKORT_alpha74Gate7SubmitRows',
    'function AKORT_alpha74Gate7EnableUserPipeline',
    'Math.random',
    'ScriptApp.newTrigger'
  ].forEach(marker => assert(!gate7.includes(marker), marker));
});

test('Gate 7 test remains wired into npm test', () => {
  assert.equal(
    packageJson.scripts['test:alpha74-gate7'],
    'node tests/alpha74_gate7_acceptance_static.test.js'
  );
  assert(packageJson.scripts.test.includes('npm run test:alpha74-gate7'));
});

const failed = tests.filter(item => item.status !== 'PASS');

console.log(JSON.stringify({
  suite: 'alpha74_gate7_acceptance_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
