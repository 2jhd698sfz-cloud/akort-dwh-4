const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/34_Beta12RollbackInventory.js'), 'utf8'
);
const raw = fs.readFileSync(path.join(root, 'src/05_RawStore.js'), 'utf8');
const engine = fs.readFileSync(
  path.join(root, 'src/03_OperationEngine.js'), 'utf8'
);
const entries = fs.readFileSync(path.join(root, 'src/08_EntryPoints.js'), 'utf8');
const inventory = JSON.parse(fs.readFileSync(
  path.join(root, 'docs/beta-1/BETA12_ROLLBACK_INVENTORY.json'), 'utf8'
));
const packageJson = JSON.parse(fs.readFileSync(
  path.join(root, 'package.json'), 'utf8'
));

let total = 0;
let failed = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('inventory source is syntax-valid and pins accepted Beta.1.1 base', () => {
  new vm.Script(source, { filename: '34_Beta12RollbackInventory.js' });
  assert(source.includes("var PACKAGE_VERSION = '4.0.0-beta.1.2.1';"));
  assert(source.includes("var BASE_RELEASE = '4.0.0-alpha.7.4.42';"));
  assert(source.includes(
    "var BASE_COMMIT = '05e5b473d3867b6519472f265b20554b9bbe4040';"
  ));
  assert.equal(packageJson.version, '4.0.0-alpha.7.4.42');
});

test('inventory module is strictly read-only', () => {
  [
    'SpreadsheetApp', 'DriveApp', 'PropertiesService', 'ScriptApp',
    '.enqueue(', '.run(', '.resume(', '.reverseLoad(', '.reverseLoadStep(',
    '.setValue(', '.setValues(', '.appendRow(', '.makeCopy('
  ].forEach((token) => assert(!source.includes(token), token));
  assert(source.includes("writeBoundary: 'READ_ONLY'"));
  assert(source.includes('physicalWrites: false'));
  assert(source.includes('enqueuesOperations: false'));
  assert(source.includes('runsOperations: false'));
});

test('accepted Raw Store reversal primitives are present', () => {
  [
    "RAW_REVERSAL_LOG",
    "function reverseLoadStep(",
    "function inspectReversal(",
    "function reversalSnapshot(",
    "function auditLoad(",
    "var REVERSAL_TYPE = 'RAW_REVERSAL_V4';"
  ].forEach((token) => assert(raw.includes(token), token));
});

test('accepted reversal handler already updates dependencies and audits', () => {
  [
    'AKORT.IncrementalPublish.planReversal',
    'AKORT.IncrementalPublish.applyPublishStep',
    'AKORT.AggregateIntegration.execute',
    "if (phase === 'UPDATE_STATUS')",
    "if (phase === 'QUICK_AUDIT')"
  ].forEach((token) => assert(raw.includes(token), token));
});

test('accepted Operation Engine supplies idempotent execution and recovery', () => {
  [
    'function findByIdempotencyKey_(',
    'function enqueue(',
    'function run(',
    'function resume(',
    'function recoverFailedPhase(',
    'function status('
  ].forEach((token) => assert(engine.includes(token), token));
  assert(engine.includes('options.idempotencyKey'));
});

test('mandatory reason is genuinely absent from the low-level handler', () => {
  assert(raw.includes(
    "input.reason || 'Operation Engine logical reversal'"
  ));
  const reasonGap = inventory.gaps.find(
    (item) => item.gapId === 'B12-G03-REASON'
  );
  assert(reasonGap);
  assert.equal(reasonGap.status, 'MISSING');
});

test('general Beta.1.2 rollback facade is genuinely absent before implementation', () => {
  [
    'AKORT_beta12RollbackPreview',
    'AKORT_beta12RollbackSubmit',
    'AKORT_beta12RollbackStatus'
  ].forEach((token) => {
    assert(!entries.includes(token), token + ' unexpectedly exists in EntryPoints');
    assert(!raw.includes(token), token + ' unexpectedly exists in RawStore');
  });
});

test('inventory classifies exact minimal gaps', () => {
  assert.equal(inventory.requirementId, 'BETA1.2-ARBITRARY-ROLLBACK');
  assert.equal(inventory.acceptedReuse.length, 4);
  assert.equal(inventory.gaps.length, 6);
  const statuses = inventory.gaps.reduce((out, item) => {
    out[item.status] = (out[item.status] || 0) + 1;
    return out;
  }, {});
  assert.deepEqual(statuses, { PARTIAL: 1, MISSING: 5 });
  assert.equal(
    inventory.eligibilityPolicy.runtimeSetting,
    'RAW_REVERSAL_POLICY=LATEST_LOAD_ONLY'
  );
  assert.equal(inventory.confirmationContract.writesDuringPreview, false);
  assert.equal(inventory.confirmationContract.submitRevalidation, true);
});

test('implementation boundary forbids a second subsystem', () => {
  const boundary = inventory.implementationBoundary;
  [
    'newQueue', 'newExecutor', 'newRawSchema', 'newPublishSchema',
    'newAggregateSchema', 'methodologyChange', 'productionWrite',
    'generalUserPipelineEnablement'
  ].forEach((key) => assert.equal(boundary[key], false, key));
  assert(source.includes('newQueue: false'));
  assert(source.includes('newExecutor: false'));
});

test('general user pipeline remains disabled across Apps Script sources', () => {
  const srcDir = path.join(root, 'src');
  const files = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js'));
  const forbidden = /PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i;
  files.forEach((name) => {
    const text = fs.readFileSync(path.join(srcDir, name), 'utf8');
    assert(!forbidden.test(text), name);
  });
});

test('inventory suite is wired into full regression', () => {
  assert.equal(
    packageJson.scripts['test:beta12-rollback-inventory'],
    'node tests/beta12_rollback_inventory_static.test.js'
  );
  assert(
    packageJson.scripts.test.includes(
      'npm run test:beta12-rollback-inventory'
    )
  );
});

console.log(JSON.stringify({
  suite: 'beta12_rollback_inventory_static',
  packageVersion: inventory.packageVersion,
  baseRelease: inventory.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
