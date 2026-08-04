const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function allSourceFiles() {
  return fs.readdirSync(path.join(root, 'src'))
    .filter(file => /\.js$/.test(file))
    .sort();
}

const packageJson = JSON.parse(source('package.json'));
const release = source('src/00_Release.js');
const gate6 = source('src/28_Alpha74Gate6Acceptance.js');
const gate7 = source('src/29_Alpha74Gate7Acceptance.js');
const runner = source('src/30_Alpha74Gate7Runner.js');
const bootstrap = source('src/31_Beta10Bootstrap.js');
const gap = JSON.parse(source('docs/beta-1/BETA10_GAP_MATRIX.json'));
const contract = source('docs/beta-1/BETA10_BOOTSTRAP_CONTRACT.md');
const files = allSourceFiles();
const combined = files.map(file => source('src/' + file)).join('\n');
const combinedRuntime = combined;

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

test('accepted Alpha.7.4 runtime release remains exact', () => {
  assert(release.includes("version: '4.0.0-alpha.7.4.42'"));
  assert(release.includes("channel: 'alpha'"));
  assert.equal(packageJson.version, '4.0.0-alpha.7.4.42');
  assert(gate6.includes("var RELEASE = '4.0.0-alpha.7.4.35';"));
  assert(gate7.includes("var RELEASE = '4.0.0-alpha.7.4.42';"));
  assert(runner.includes("var RELEASE = '4.0.0-alpha.7.4.42';"));
});

test('Beta.1.0 overlay contract is explicit and syntax-valid', () => {
  new vm.Script(bootstrap, { filename: '31_Beta10Bootstrap.js' });
  [
    "var PACKAGE_VERSION = '4.0.0-beta.1.0.1';",
    "var CONTRACT_VERSION = '4.0-beta1-contract-1';",
    "var GAP_SCHEMA_VERSION = '4.0-beta1-gap-matrix-1';",
    "var BASE_RELEASE = '4.0.0-alpha.7.4.42';",
    "var BASE_COMMIT = '28d9827a8b80f1bdda615e00bab22d35cd8130cc';",
    "evidenceId: 'G7E_5F028CEB97F66118A57E5B6C'",
    'acceptedDataPlaneImmutable: true',
    'physicalWrites: false',
    'enablesUserPipeline: false'
  ].forEach(marker => assert(bootstrap.includes(marker), marker));
});

test('Beta.1.0 exposes read-only public status functions', () => {
  [
    'function AKORT_beta10Status()',
    'function AKORT_beta10Contract()',
    'function AKORT_beta10GapMatrix()'
  ].forEach(marker => assert(bootstrap.includes(marker), marker));
  assert(!bootstrap.includes('function AKORT_beta10Install'));
});

test('Beta.1.0 contains no physical-write or scheduling API', () => {
  [
    'SpreadsheetApp',
    'DriveApp',
    'PropertiesService',
    'ScriptApp',
    '.setValue(',
    '.setValues(',
    '.appendRow(',
    '.insertSheet(',
    '.newTrigger(',
    'OperationEngine.enqueue('
  ].forEach(marker => assert(!bootstrap.includes(marker), marker));
});

test('gap matrix is complete and machine-readable', () => {
  assert.equal(gap.schemaVersion, '4.0-beta1-gap-matrix-1');
  assert.equal(gap.packageVersion, '4.0.0-beta.1.0.1');
  assert.equal(gap.baseRelease, '4.0.0-alpha.7.4.42');
  assert.equal(gap.baseCommit, '28d9827a8b80f1bdda615e00bab22d35cd8130cc');
  assert.equal(gap.gate7Evidence.evidenceId, 'G7E_5F028CEB97F66118A57E5B6C');
  assert.equal(gap.requirements.length, 7);

  const ids = gap.requirements.map(item => item.requirementId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    gap.requirements.map(item => item.gapStatus),
    [
      'ALREADY_IMPLEMENTED',
      'MISSING',
      'PARTIAL',
      'PARTIAL',
      'PARTIAL',
      'PARTIAL',
      'PARTIAL'
    ]
  );

  gap.requirements.forEach(item => {
    assert(item.existingComponents.length > 0, item.requirementId);
    assert(item.exactGap, item.requirementId);
    assert(item.minimalDelta, item.requirementId);
    assert(item.acceptanceTest, item.requirementId);
  });
});

test('accepted engines remain singletons', () => {
  assert.equal((combined.match(/AKORT\.OperationEngine\s*=/g) || []).length, 1);
  assert.equal((combined.match(/AKORT\.RawStore\s*=/g) || []).length, 1);
  assert.equal((combined.match(/AKORT\.IncrementalPublish\s*=/g) || []).length, 1);
  assert.equal((combined.match(/AKORT\.AggregateIntegration\s*=/g) || []).length, 1);
});

test('general user pipeline is not enabled', () => {
  const dangerous = [
    /PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i,
    /PUBLISH_USER_PIPELINE_ENABLED['"]?\s*,\s*true\b/i,
    /setting_key\s*:\s*['"]PUBLISH_USER_PIPELINE_ENABLED['"][\s\S]{0,180}setting_value\s*:\s*(?:true|['"]TRUE['"])/i
  ];
  dangerous.forEach(pattern => assert(!pattern.test(combinedRuntime), String(pattern)));
});

test('forbidden backup fixture is absent', () => {
  assert(!fs.existsSync(path.join(
    root,
    'src/12_Alpha6Tests.js.backup-smoke-fixture-20260713_135449'
  )));
  const forbidden = fs.readdirSync(path.join(root, 'src'))
    .filter(file => /\.backup-|\.bak$|\.tmp$/.test(file));
  assert.deepEqual(forbidden, []);
});

test('Beta.1.0 suite is wired into full regression', () => {
  assert.equal(
    packageJson.scripts['test:beta10-bootstrap'],
    'node tests/beta10_bootstrap_static.test.js'
  );
  assert(packageJson.scripts.test.includes('npm run test:beta10-bootstrap'));
});

test('normative documentation preserves the minimal-change boundary', () => {
  [
    'does not implement backup',
    'accepted Alpha.7.4 runtime release remains unchanged',
    'does not create tables or triggers',
    'does not enable `PUBLISH_USER_PIPELINE_ENABLED`',
    'Only after that inventory'
  ].forEach(marker => assert(contract.includes(marker), marker));
});

const failed = tests.filter(item => item.status !== 'PASS');

console.log(JSON.stringify({
  suite: 'beta10_bootstrap_static',
  packageVersion: gap.packageVersion,
  baseRelease: gap.baseRelease,
  sourceFiles: files.length,
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
