'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src',
  '39_Beta15ObservabilityInventory.js'
);
const contractPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA15_OBSERVABILITY_INVENTORY.json'
);
const markdownPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA15_OBSERVABILITY_INVENTORY.md'
);
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const markdown = fs.readFileSync(markdownPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

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

test('metadata pins accepted Beta.1.4 head and runtime', () => {
  assert.strictEqual(pkg.version, '4.0.0-alpha.7.4.42');
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.5.1');
  assert.strictEqual(
    contract.contractVersion,
    '4.0-beta15-observability-inventory-1'
  );
  assert.strictEqual(contract.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    contract.baseCommit,
    '00d1c5e139f2304cf248e1b6ca0e222459c2ed53'
  );
});

test('inventory source is syntax-valid with exact entrypoints', () => {
  new vm.Script(source, { filename: sourcePath });
  [
    'AKORT_beta15ObservabilityInventoryContract',
    'AKORT_beta15ObservabilityInventory'
  ].forEach((name) => {
    assert(source.includes('function ' + name + '()'), name);
  });
});

test('inventory is strictly read-only', () => {
  [
    '.setValues(',
    '.clearContent(',
    '.appendRow(',
    'insertSheet(',
    'deleteSheet(',
    'DriveApp.',
    'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger',
    'AKORT.OperationEngine.enqueue(',
    'setProperty(',
    'deleteProperty('
  ].forEach((token) => {
    assert(!source.includes(token), 'forbidden token: ' + token);
  });
  assert.strictEqual(contract.writes.createsTable, false);
  assert.strictEqual(contract.writes.updatesTable, false);
  assert.strictEqual(contract.writes.createsTrigger, false);
  assert.strictEqual(contract.writes.deletesTrigger, false);
  assert.strictEqual(contract.writes.mutatesOperation, false);
});

test('bounded reads use headers, row counts and at most 25 tail rows', () => {
  assert(source.includes('var MAX_TAIL_ROWS = 25;'));
  assert(source.includes('Math.min(MAX_TAIL_ROWS, rowCount)'));
  assert(source.includes('var startRow = sheet.getLastRow() - count + 1;'));
  assert.strictEqual(contract.boundedness.tailRowsPerSource, 25);
  assert.strictEqual(contract.boundedness.fullRegistryScan, false);
  assert.strictEqual(contract.boundedness.returnsSourceRows, false);
});

test('inventory never opens or names physical RAW and Publish targets', () => {
  [
    "'RAW_PRICES_WEEKLY'",
    "'RAW_PRICES_MONTHLY'",
    "'RAW_INDUSTRY'",
    "'PUBLISH_PRICES_WEEKLY'",
    "'PUBLISH_PRICES_MONTHLY'",
    "'PUBLISH_INDUSTRY'",
    "'PUBLISH_PRICE_AGGREGATES'",
    'publishSpreadsheetId'
  ].forEach((token) => {
    assert(!source.includes(token), 'physical target token: ' + token);
  });
  assert.strictEqual(contract.boundedness.readsRawTargets, false);
  assert.strictEqual(contract.boundedness.readsPublishTargets, false);
});

test('accepted source registries are inventoried without duplication', () => {
  [
    'RELEASE_REGISTRY',
    'OPERATION_QUEUE',
    'OPERATION_STEPS',
    'SYSTEM_LOG',
    'RAW_LOAD_REGISTRY',
    'PUBLISH_RUNS',
    'PUBLISH_RECONCILIATION',
    'PARSER_ISSUES',
    'BACKUP_REGISTRY',
    'TRIGGER_OWNERSHIP_REGISTRY'
  ].forEach((name) => {
    assert(source.includes("'" + name + "'"), name);
    assert(contract.sourceTables.includes(name), name);
  });
});

test('exact missing read models remain explicit', () => {
  assert(source.includes("'DATASET_STATUS'"));
  assert(source.includes("'ISSUE_REGISTRY'"));
  assert.strictEqual(
    contract.candidateReadModels.DATASET_STATUS.status,
    'MISSING'
  );
  assert.strictEqual(
    contract.candidateReadModels.ISSUE_REGISTRY.status,
    'MISSING'
  );
  assert(markdown.includes('Two read models are still absent'));
});

test('accepted Beta.1.4 watchdog is reused', () => {
  assert(source.includes('AKORT.Beta14OperationalHardening'));
  assert(source.includes("typeof module.contract !== 'function'"));
  assert.strictEqual(
    contract.reuse.operationWatchdog,
    'AKORT.Beta14OperationalHardening'
  );
  assert.strictEqual(contract.reuse.newQueue, false);
  assert.strictEqual(contract.reuse.newExecutor, false);
  assert.strictEqual(contract.reuse.newDispatcher, false);
});

test('current repository contains every declared authoritative source', () => {
  const checks = [
    ['src/02_Core.js', 'TRIGGER_OWNERSHIP_REGISTRY'],
    ['src/05_RawStore.js', 'RAW_LOAD_REGISTRY'],
    ['src/06_ExistingSourceParsers.js', 'PARSER_ISSUES'],
    ['src/07_IncrementalPublish.js', 'PUBLISH_RUNS'],
    ['src/33_Beta11PairedBackup.js', 'BACKUP_REGISTRY'],
    ['src/38_Beta14OperationalHardening.js',
      'AKORT.Beta14OperationalHardening']
  ];
  checks.forEach(([file, marker]) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert(text.includes(marker), file + ': ' + marker);
  });
});

test('user pipeline and production remain protected', () => {
  assert.strictEqual(contract.writes.dataPlaneWrite, false);
  assert.strictEqual(contract.writes.productionWrite, false);
  assert.strictEqual(contract.writes.enablesUserPipeline, false);
  assert(
    !/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source)
  );
});

test('forbidden backup fixture remains absent', () => {
  assert(
    !fs.existsSync(
      path.join(
        root,
        'src',
        '12_Alpha6Tests.js.backup-smoke-fixture-20260713_135449'
      )
    )
  );
});

test('inventory suite is wired into full regression', () => {
  assert.strictEqual(
    pkg.scripts['test:beta15-observability-inventory'],
    'node tests/beta15_observability_inventory_static.test.js'
  );
  assert(
    pkg.scripts.test.includes(
      'npm run test:beta15-observability-inventory'
    )
  );
});

console.log(JSON.stringify({
  suite: 'beta15_observability_inventory_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
