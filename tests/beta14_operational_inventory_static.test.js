'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '37_Beta14OperationalInventory.js');
const jsonPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA14_OPERATIONAL_HARDENING_INVENTORY.json'
);
const mdPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA14_OPERATIONAL_HARDENING_INVENTORY.md'
);
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const inventory = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const markdown = fs.readFileSync(mdPath, 'utf8');
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

test('accepted runtime and Beta.1.3 base commit are exact', () => {
  assert.strictEqual(pkg.version, '4.0.0-alpha.7.4.42');
  assert.strictEqual(inventory.packageVersion, '4.0.0-beta.1.4.1');
  assert.strictEqual(
    inventory.contractVersion,
    '4.0-beta14-operational-inventory-1'
  );
  assert.strictEqual(inventory.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    inventory.baseCommit,
    '1055d39229213e17b93faeced44dce57ea55346c'
  );
});

test('inventory source is syntax-valid and exposes read-only entrypoints', () => {
  new vm.Script(source, { filename: sourcePath });
  assert(source.includes('function AKORT_beta14OperationalInventoryContract()'));
  assert(source.includes('function AKORT_beta14OperationalInventory()'));
  assert(source.includes("mode: 'READ_ONLY_RUNTIME_INVENTORY'"));
});

test('inventory contains no mutation or scheduling API', () => {
  [
    /\bsetValue\s*\(/,
    /\bsetValues\s*\(/,
    /\bappendRow\s*\(/,
    /\binsertSheet\s*\(/,
    /\bdeleteSheet\s*\(/,
    /\bnewTrigger\s*\(/,
    /\bdeleteTrigger\s*\(/,
    /\bsetProperty\s*\(/,
    /\bdeleteProperty\s*\(/,
    /\bmakeCopy\s*\(/,
    /\bcreateFile\s*\(/,
    /\bcreateFolder\s*\(/,
    /\bDriveApp\b/
  ].forEach((pattern) => assert(!pattern.test(source), String(pattern)));
  assert(source.includes('persistLogs: false'));
});

test('trigger owner inventory is exact and bounded', () => {
  assert.strictEqual(inventory.triggerProcesses.length, 5);
  const byId = Object.fromEntries(
    inventory.triggerProcesses.map((item) => [item.processId, item])
  );
  assert.strictEqual(byId.BETA11_DAILY_BACKUP.minimum, 1);
  assert.strictEqual(byId.BETA11_DAILY_BACKUP.maximum, 1);
  assert.strictEqual(byId.BETA11_BACKUP_WORKER.maximum, 1);
  assert.strictEqual(byId.ALPHA74_GATE6_WORKER.maximum, 0);
  assert.strictEqual(byId.ALPHA74_GATE7_RUNNER.maximum, 0);
  assert.strictEqual(
    byId.ALPHA6_RECONCILIATION_DISPATCHER.maximum,
    0
  );
});

test('runtime source recognizes every declared trigger handler', () => {
  inventory.triggerProcesses.forEach((item) => {
    assert(source.includes("'" + item.handler + "'"), item.handler);
  });
  assert(source.includes('UNREGISTERED_TRIGGER_OWNER'));
  assert(source.includes('DUPLICATE_TRIGGER_OWNER'));
  assert(source.includes('STALE_CLOSED_PROCESS_TRIGGER'));
});

test('stale operation matrix and normalized next actions are explicit', () => {
  assert.deepStrictEqual(
    inventory.operationClassification.staleThresholdMinutes,
    {
      QUEUED: 15,
      RUNNING: 5,
      PAUSED: 1440,
      RETRY_PENDING: 30
    }
  );
  [
    'RUN_FROM_QUEUE',
    'WAIT_ACTIVE_LEASE',
    'RESUME_FROM_CHECKPOINT',
    'RETRY_FROM_CHECKPOINT',
    'REVIEW_STOPPED_CHECKPOINT',
    'REVIEW_FAILED_OPERATION',
    'MANUAL_REVIEW',
    'REVIEW_DEAD_LETTER'
  ].forEach((action) => {
    assert(
      inventory.operationClassification.normalizedNextActions.includes(action),
      action
    );
    assert(source.includes("'" + action + "'"), action);
  });
});

test('operation classifier is lease-aware and fail-closed', () => {
  assert(source.includes("'ACTIVE_RUNNING'"));
  assert(source.includes("'STALE_RUNNING_EXPIRED_LEASE'"));
  assert(source.includes("'STALE_RUNNING_WITHOUT_LEASE'"));
  assert(source.includes("'INVALID_CHECKPOINT'"));
  assert(source.includes("'MANUAL_REVIEW'"));
  assert(source.includes('lease.expired'));
  assert(source.includes('checkpoint.__invalid'));
});

test('write conflict classes reuse existing operation types', () => {
  assert.deepStrictEqual(
    inventory.writeConflictClasses.SNAPSHOT_EXCLUSIVE,
    ['BETA11_PAIRED_BACKUP']
  );
  assert.deepStrictEqual(
    inventory.writeConflictClasses.DATA_PLANE_EXCLUSIVE,
    ['SOURCE_FILE_LOAD_V4', 'RAW_LOAD_V4', 'RAW_REVERSAL_V4']
  );
  assert(source.includes('SNAPSHOT_DATA_PLANE_OVERLAP'));
  assert(source.includes('MULTIPLE_DATA_PLANE_OPERATIONS'));
  assert(source.includes('MULTIPLE_SNAPSHOT_OPERATIONS'));
});

test('minimal implementation delta forbids architectural duplication', () => {
  assert.strictEqual(inventory.acceptedReuse.newQueue, false);
  assert.strictEqual(inventory.acceptedReuse.newExecutor, false);
  assert.strictEqual(inventory.acceptedReuse.newDispatcher, false);
  assert(markdown.includes('A second queue, executor, dispatcher'));
  assert(markdown.includes('TRIGGER_OWNERSHIP_REGISTRY'));
  assert(markdown.includes('assertCanStart'));
});

test('user pipeline and production remain protected', () => {
  assert.strictEqual(inventory.writes.inventoryWrites, false);
  assert.strictEqual(inventory.writes.productionWrite, false);
  assert.strictEqual(inventory.writes.enablesUserPipeline, false);
  assert(!/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source));
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

test('Beta.1.4 inventory suite is wired into full regression', () => {
  assert.strictEqual(
    pkg.scripts['test:beta14-operational-inventory'],
    'node tests/beta14_operational_inventory_static.test.js'
  );
  assert(
    pkg.scripts.test.includes(
      'npm run test:beta14-operational-inventory'
    )
  );
});

console.log(JSON.stringify({
  suite: 'beta14_operational_inventory_static',
  packageVersion: inventory.packageVersion,
  baseRelease: inventory.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
