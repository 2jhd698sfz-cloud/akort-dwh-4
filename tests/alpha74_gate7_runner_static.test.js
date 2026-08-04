const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    'utf8'
  );
}

const release = source('src/00_Release.js');
const gate6 = source('src/28_Alpha74Gate6Acceptance.js');
const gate7 = source('src/29_Alpha74Gate7Acceptance.js');
const industry = source('src/27_Alpha74IndustryInput.js');
const runner = source('src/30_Alpha74Gate7Runner.js');
const entrypoints = source('src/08_EntryPoints.js');
const packageJson = JSON.parse(source('package.json'));

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    tests.push({
      name,
      status: 'FAIL',
      error: error.message
    });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('candidate .41 and accepted Gate 6 pin are exact', () => {
  assert(release.includes("version: '4.0.0-alpha.7.4.41'"));
  assert.equal(packageJson.version, '4.0.0-alpha.7.4.41');
  assert(gate6.includes("var RELEASE = '4.0.0-alpha.7.4.35';"));
  assert(!gate6.includes("4.0.0-alpha.7.4.41"));
});

test('preview executes exactly one profile per invocation', () => {
  assert(gate7.includes('var PREVIEW_BATCH_SIZE = 1;'));
  assert(gate7.includes('state.items.push(compactPreviewItem_(item));'));
  assert(gate7.includes('saveState_(state);'));
});

test('exact .39 and .40 preview cursors are adopted rather than replayed', () => {
  [
    'var LEGACY_PREVIEW_CONTRACTS = Object.freeze([',
    "release: '4.0.0-alpha.7.4.39'",
    "version: '4.0-alpha74-gate7-acceptance-2'",
    "schemaVersion: '4.0-alpha74-gate7-state-2'",
    "release: '4.0.0-alpha.7.4.40'",
    "version: '4.0-alpha74-gate7-acceptance-3'",
    "schemaVersion: '4.0-alpha74-gate7-state-3'",
    'legacyPreviewContractMatches_',
    'adoptLegacyPreviewState_(state, control)',
    'ALPHA74_GATE7_LEGACY_CONTROL_MISMATCH',
    'ALPHA74_GATE7_LEGACY_STATE_INVALID'
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Industry canary reuses existing RAW and remains reversible', () => {
  [
    'function acceptancePrepareCanary()',
    'rawState.latestBySeries',
    'periodLabelForRaw_(',
    'acceptanceCanaryValue_(',
    "candidate.action !== 'REVISION'",
    'INDUSTRY_INPUT_GATE7_FORM_NOT_EMPTY',
    'INDUSTRY_INPUT_GATE7_CANARY_VALIDATION_FAILED',
    'prepareCanary: acceptancePrepareCanary'
  ].forEach(marker => assert(industry.includes(marker), marker));
  assert(!industry.includes('Math.random'));
});

test('lost Industry submit response adopts or recovers exact permit binding', () => {
  [
    'readIndustryPermitOptional_',
    'adoptIndustryLoadBinding_(state)',
    'ALPHA74_GATE7_INDUSTRY_SUBMIT_RECOVERY_FAILED',
    'Gate 7 Industry submission binding recovered.'
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('runner is orchestration-only and reuses accepted modules', () => {
  [
    'AKORT.Alpha74Gate7Acceptance.previewMatrix()',
    'AKORT.IndustryInput.install()',
    'AKORT.IndustryInput.Acceptance.prepareCanary()',
    'AKORT.Alpha74Gate7Acceptance.startIndustry()',
    'AKORT.Alpha74Gate7Acceptance.continueIndustry()',
    'AKORT.Alpha74Gate7Acceptance.finalize()'
  ].forEach(marker => assert(runner.includes(marker), marker));

  [
    'parseFileToStage',
    'stageToRaw',
    'RawStore.beginLoad',
    'IncrementalPublish.applyPublishStep',
    'AggregateIntegration.execute'
  ].forEach(marker => assert(!runner.includes(marker), marker));
});

test('runner uses one durable trigger and one bounded transition', () => {
  [
    "var WORKER_HANDLER = 'AKORT_alpha74Gate7Worker';",
    '.newTrigger(WORKER_HANDLER)',
    '.after(TRIGGER_DELAY_MS)',
    'clearWorkerTriggers_()',
    "state.phase = 'PREVIEW_ONE_PROFILE';",
    "state.phase = 'PREPARE_INDUSTRY_CANARY';",
    "state.phase = 'START_INDUSTRY_ACCEPTANCE';",
    "state.phase = 'CONTINUE_INDUSTRY_ACCEPTANCE';",
    "state.phase = 'FINALIZE_GATE7';",
    "state.phase = 'RESYNC_INDUSTRY_FORM';"
  ].forEach(marker => assert(runner.includes(marker), marker));
});

test('one-button public entrypoints are complete', () => {
  [
    'AKORT_alpha74Gate7Run',
    'AKORT_alpha74Gate7Worker',
    'AKORT_alpha74Gate7RunStatus',
    'AKORT_alpha74Gate7RunStop'
  ].forEach(name => assert(
    entrypoints.includes('function ' + name + '('),
    name
  ));
});

test('runner status is compact and stale runner state is rejected', () => {
  [
    'compactGateStatus_',
    'runnerStateContractMatches_',
    'latestProfile:',
    'gate7: compactGateStatus_(gateStatus_())',
    "existing.status === 'RUNNING' &&",
    'runnerStateContractMatches_(existing)'
  ].forEach(marker => assert(runner.includes(marker), marker));
});

test('runner test is wired into full regression', () => {
  assert.equal(
    packageJson.scripts['test:alpha74-gate7-runner'],
    'node tests/alpha74_gate7_runner_static.test.js'
  );
  assert(packageJson.scripts.test.includes(
    'npm run test:alpha74-gate7-runner'
  ));
});

const failed = tests.filter(item => item.status !== 'PASS');

console.log(JSON.stringify({
  suite: 'alpha74_gate7_runner_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
