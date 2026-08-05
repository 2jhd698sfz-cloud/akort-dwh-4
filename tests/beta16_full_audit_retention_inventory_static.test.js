'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src',
  '41_Beta16FullAuditRetentionInventory.js'
);
const contractPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA16_FULL_AUDIT_RETENTION_INVENTORY.json'
);
const markdownPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA16_FULL_AUDIT_RETENTION_INVENTORY.md'
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

test('metadata pins accepted Beta.1.5 head and runtime', () => {
  assert.strictEqual(pkg.version, '4.0.0-alpha.7.4.42');
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.6.1');
  assert.strictEqual(
    contract.contractVersion,
    '4.0-beta16-full-audit-retention-inventory-1'
  );
  assert.strictEqual(contract.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    contract.baseCommit,
    '86f8aa96fd6034bbf657e7159d3985066b67dbc6'
  );
});

test('inventory source is syntax-valid with exact entrypoints', () => {
  new vm.Script(source, { filename: sourcePath });
  [
    'AKORT_beta16FullAuditRetentionInventoryContract',
    'AKORT_beta16FullAuditRetentionInventory'
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
    'AKORT.Beta14OperationalHardening.enqueueGuarded(',
    'setProperty(',
    'deleteProperty(',
    'setTrashed('
  ].forEach((token) => {
    assert(!source.includes(token), 'forbidden token: ' + token);
  });
  Object.values(contract.writes).forEach((value) => {
    assert.strictEqual(value, false);
  });
});

test('inventory reads accepted registries through bounded tails only', () => {
  assert(source.includes('var MAX_TAIL_ROWS = 25;'));
  assert(source.includes('Math.min(MAX_TAIL_ROWS, totalRows)'));
  assert(source.includes('Math.min(MAX_TAIL_ROWS, total)'));
  assert.strictEqual(contract.boundedness.tailRowsPerSource, 25);
  assert.strictEqual(contract.boundedness.fullRegistryScan, false);
  assert.strictEqual(contract.boundedness.returnsSourceRows, false);
});

test('physical RAW and Publish targets are never inspected', () => {
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
    assert(!source.includes(token), token);
  });
  assert.strictEqual(
    contract.boundedness.readsPhysicalRawTargets,
    false
  );
  assert.strictEqual(
    contract.boundedness.readsPhysicalPublishTargets,
    false
  );
});

test('accepted Operation Engine remains the only executor', () => {
  const operationEngine = fs.readFileSync(
    path.join(root, 'src', '03_OperationEngine.js'),
    'utf8'
  );
  [
    "'QUICK_AUDIT'",
    'function enqueue(',
    'function run(',
    'function resume(',
    'function requestStop(',
    'function recoverFailedPhase('
  ].forEach((marker) => {
    assert(operationEngine.includes(marker), marker);
  });
  assert.strictEqual(
    contract.acceptedReuse.operationEngine,
    'AKORT.OperationEngine'
  );
});

test('accepted audit and protection inputs exist', () => {
  const checks = [
    ['src/07_IncrementalPublish.js', 'PUBLISH_RECONCILIATION'],
    ['src/29_Alpha74Gate7Acceptance.js', 'GATE7'],
    ['src/33_Beta11PairedBackup.js', 'BACKUP_REGISTRY'],
    ['src/38_Beta14OperationalHardening.js',
      'AKORT.Beta14OperationalHardening'],
    ['src/40_Beta15CompactObservability.js',
      'AKORT.Beta15CompactObservability']
  ];
  checks.forEach(([file, marker]) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert(text.includes(marker), file + ': ' + marker);
  });
});

test('Full Audit gap is absent before r2 or closed exactly by r2', () => {
  const core = fs.readFileSync(
    path.join(root, 'src', '02_Core.js'),
    'utf8'
  );
  const implementationPath = path.join(
    root,
    'src',
    '42_Beta16FullAuditRetention.js'
  );
  const implementationPresent = fs.existsSync(implementationPath);
  if (!implementationPresent) {
    assert(!core.includes('FULL_AUDIT_EVIDENCE'));
    assert(!core.includes('RETENTION_REGISTRY'));
  } else {
    const implementation = fs.readFileSync(implementationPath, 'utf8');
    const engine = fs.readFileSync(
      path.join(root, 'src', '03_OperationEngine.js'),
      'utf8'
    );
    assert(core.includes('FULL_AUDIT_EVIDENCE: ['));
    assert(core.includes('RETENTION_REGISTRY: ['));
    assert(implementation.includes("'FULL_AUDIT_V4'"));
    assert(engine.includes('AKORT.Beta16FullAuditHandlers'));
  }
  assert(source.includes("'FULL_AUDIT_V4'"));
  assert(source.includes("'FULL_AUDIT_EVIDENCE'"));
  assert(source.includes("'RETENTION_REGISTRY'"));
  assert(markdown.includes('No `FULL_AUDIT_V4` handler'));
});

test('retention is dry-run only and protects required artifacts', () => {
  assert.strictEqual(contract.writes.physicalDeletion, false);
  assert(contract.protectedArtifactClasses.includes(
    'ACCEPTED_RELEASE'
  ));
  assert(contract.protectedArtifactClasses.includes(
    'GATE_ACCEPTANCE_EVIDENCE'
  ));
  assert(contract.protectedArtifactClasses.includes(
    'VERIFIED_BASELINE'
  ));
  assert(contract.protectedArtifactClasses.includes(
    'REQUIRED_PAIRED_BACKUP'
  ));
  assert(markdown.includes('always emit `dry_run=true`'));
});

test('no second queue, executor, dispatcher or trigger is introduced', () => {
  [
    'newQueue',
    'newExecutor',
    'newDispatcher',
    'createTrigger',
    'installTrigger'
  ].forEach((token) => {
    assert(!source.includes(token), token);
  });
  assert.strictEqual(contract.writes.createsTrigger, false);
  assert.strictEqual(contract.writes.createsOperation, false);
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
    pkg.scripts['test:beta16-full-audit-retention-inventory'],
    'node tests/beta16_full_audit_retention_inventory_static.test.js'
  );
  assert(
    pkg.scripts.test.includes(
      'npm run test:beta16-full-audit-retention-inventory'
    )
  );
});

console.log(JSON.stringify({
  suite: 'beta16_full_audit_retention_inventory_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
