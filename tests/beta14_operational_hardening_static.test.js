'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src',
  '38_Beta14OperationalHardening.js'
);
const corePath = path.join(root, 'src', '02_Core.js');
const backupPath = path.join(
  root,
  'src',
  '33_Beta11PairedBackup.js'
);
const rollbackPath = path.join(
  root,
  'src',
  '35_Beta12RollbackFacade.js'
);
const contractPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA14_OPERATIONAL_HARDENING_CONTRACT.json'
);
const markdownPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA14_OPERATIONAL_HARDENING_CONTRACT.md'
);
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');
const backup = fs.readFileSync(backupPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');
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

test('r2 metadata pins the accepted r1 commit and runtime', () => {
  assert.strictEqual(pkg.version, '4.0.0-alpha.7.4.42');
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.4.2');
  assert.strictEqual(
    contract.contractVersion,
    '4.0-beta14-operational-hardening-1'
  );
  assert.strictEqual(contract.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    contract.baseCommit,
    'a32bdf1ddbb4975a1f905825c745c9004c6324fe'
  );
});

test('hardening source is syntax-valid and exposes exact entrypoints', () => {
  new vm.Script(source, { filename: sourcePath });
  [
    'AKORT_beta14HardeningContract',
    'AKORT_beta14HardeningPreflight',
    'AKORT_beta14HardeningInstall',
    'AKORT_beta14HardeningRefresh',
    'AKORT_beta14HardeningStatus'
  ].forEach((name) => {
    assert(source.includes('function ' + name + '()'), name);
  });
});

test('Core adds exactly one bounded trigger registry schema', () => {
  const headers = contract.serviceTables.headers;
  assert(core.includes('TRIGGER_OWNERSHIP_REGISTRY: ['));
  headers.forEach((header) => {
    assert(core.includes("'" + header + "'"), header);
  });
  assert.deepStrictEqual(
    contract.serviceTables.added,
    ['TRIGGER_OWNERSHIP_REGISTRY']
  );
});

test('hardening creates or deletes no trigger', () => {
  assert(!/\bScriptApp\.newTrigger\s*\(/.test(source));
  assert(!/\bScriptApp\.deleteTrigger\s*\(/.test(source));
  assert.strictEqual(contract.writes.createsTrigger, false);
  assert.strictEqual(contract.writes.deletesTrigger, false);
});

test('accepted Operation Engine remains the only executor', () => {
  assert.strictEqual(contract.acceptedReuse.executor, 'AKORT.OperationEngine');
  assert.strictEqual(contract.acceptedReuse.newQueue, false);
  assert.strictEqual(contract.acceptedReuse.newExecutor, false);
  assert.strictEqual(contract.acceptedReuse.newDispatcher, false);
  assert.strictEqual(contract.acceptedReuse.operationEngineModified, false);
  assert.strictEqual(
    (source.match(/AKORT\.OperationEngine\.enqueue\s*\(/g) || []).length,
    1
  );
  assert(markdown.includes('delegates the actual enqueue'));
});

test('shared guard is integrated into both accepted write facades', () => {
  assert(
    backup.includes(
      'var queued = AKORT.Beta14OperationalHardening.enqueueGuarded('
    )
  );
  assert(
    rollback.includes(
      'var queued = AKORT.Beta14OperationalHardening.enqueueGuarded('
    )
  );
  assert(!backup.includes('var queued = AKORT.OperationEngine.enqueue('));
  assert(!rollback.includes('var queued = AKORT.OperationEngine.enqueue('));
  assert.strictEqual(contract.guardIntegration.length, 2);
});

test('start reservation closes the pre-check enqueue race', () => {
  assert(source.includes("'AKORT_BETA14_START_RESERVATION_V1'"));
  assert(source.includes('RESERVATION_TTL_MS = 180000'));
  assert(source.includes("AKORT.Core.Locks.withScriptLock("));
  assert(source.includes('reserveStart_('));
  assert(source.includes('releaseStart_('));
  assert(source.includes('finally {'));
  assert.strictEqual(contract.startReservation.ttlMs, 180000);
  assert.strictEqual(
    contract.startReservation.invalidReservationBehavior,
    'FAIL_CLOSED'
  );
});

test('operation class conflicts are explicit and fail closed', () => {
  [
    'SNAPSHOT_EXCLUSIVE',
    'DATA_PLANE_EXCLUSIVE',
    'CONTROL_PLANE_TEST',
    'UNKNOWN_OPERATION_CLASS',
    'BETA14_INCOMPATIBLE_OPERATION_ACTIVE',
    'BETA14_REQUESTED_OPERATION_CLASS_UNKNOWN',
    'BETA14_ACTIVE_CHECKPOINT_INVALID'
  ].forEach((value) => assert(source.includes(value), value));
  assert(source.includes('classesConflict_('));
  assert(source.includes('assertCanStart'));
});

test('watchdog uses lease-aware normalized next actions', () => {
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
    assert(source.includes("'" + action + "'"), action);
    assert(contract.normalizedNextActions.includes(action), action);
  });
  assert(source.includes("'STALE_RUNNING_EXPIRED_LEASE'"));
  assert(source.includes("'STALE_RUNNING_WITHOUT_LEASE'"));
  assert(source.includes('lease.active'));
  assert(source.includes('lease.expired'));
});

test('registry covers declared and unregistered trigger owners', () => {
  assert.strictEqual(contract.triggerProcesses.length, 5);
  contract.triggerProcesses.forEach((process) => {
    assert(source.includes("'" + process.processId + "'"));
    assert(source.includes("'" + process.handler + "'"));
  });
  assert(source.includes("'UNREGISTERED_TRIGGER_OWNER'"));
  assert(source.includes("'DUPLICATE_TRIGGER_OWNER'"));
  assert(source.includes("'STALE_CLOSED_PROCESS_TRIGGER'"));
  assert(source.includes('registry_fingerprint'));
});

test('installation is non-reentrant and refresh is registry-only', () => {
  const coreInstall = source.indexOf('var core = AKORT.Core.install();');
  const installLock = source.indexOf("'BETA14_HARDENING_INSTALL'");
  assert(coreInstall >= 0);
  assert(installLock > coreInstall);
  assert.strictEqual(contract.writes.refreshWritesRegistryOnly, true);
  assert.strictEqual(contract.writes.mutatesExistingOperation, false);
  assert.strictEqual(contract.writes.mutatesDataPlane, false);
});

test('user pipeline, production and accepted methodology remain protected', () => {
  assert.strictEqual(contract.writes.productionWrite, false);
  assert.strictEqual(contract.writes.enablesUserPipeline, false);
  assert(!/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source));

  [
    'RAW_PRICES_WEEKLY',
    'RAW_PRICES_MONTHLY',
    'RAW_INDUSTRY',
    'PUBLISH_PRICES_WEEKLY',
    'PUBLISH_PRICES_MONTHLY',
    'PUBLISH_INDUSTRY',
    'PUBLISH_PRICE_AGGREGATES'
  ].forEach((tableName) => {
    assert(
      !source.includes("'" + tableName + "'"),
      'unexpected data-plane table reference: ' + tableName
    );
  });

  const writeStart = source.indexOf('function writeRegistry_(');
  const writeEnd = source.indexOf('function registryState_(', writeStart);
  assert(writeStart >= 0, 'writeRegistry_ boundary is missing');
  assert(writeEnd > writeStart, 'writeRegistry_ boundary is invalid');

  const registryWriter = source.slice(writeStart, writeEnd);
  const outsideRegistryWriter =
    source.slice(0, writeStart) + source.slice(writeEnd);

  assert(registryWriter.includes('readTable_(dwh_(), REGISTRY)'));
  assert.strictEqual(
    (registryWriter.match(/\.setValues\s*\(/g) || []).length,
    1
  );
  assert.strictEqual(
    (registryWriter.match(/\.clearContent\s*\(/g) || []).length,
    1
  );
  assert.strictEqual(
    (outsideRegistryWriter.match(/\.setValues\s*\(/g) || []).length,
    0
  );
  assert.strictEqual(
    (outsideRegistryWriter.match(/\.clearContent\s*\(/g) || []).length,
    0
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

test('r2 suite is wired into full regression', () => {
  assert.strictEqual(
    pkg.scripts['test:beta14-operational-hardening'],
    'node tests/beta14_operational_hardening_static.test.js'
  );
  assert(
    pkg.scripts.test.includes(
      'npm run test:beta14-operational-hardening'
    )
  );
});

console.log(JSON.stringify({
  suite: 'beta14_operational_hardening_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
