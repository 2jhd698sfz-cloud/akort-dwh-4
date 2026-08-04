const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const release = read('src/00_Release.js');
const config = read('src/01_Config.js');
const core = read('src/02_Core.js');
const engine = read('src/03_OperationEngine.js');
const incremental = read('src/07_IncrementalPublish.js');
const entrypoints = read('src/08_EntryPoints.js');
const beta10 = read('src/31_Beta10Bootstrap.js');
const inventorySource = read('src/32_Beta11BackupInventory.js');
const inventory = JSON.parse(read('docs/beta-1/BETA11_BACKUP_INVENTORY.json'));
const contractDoc = read('docs/beta-1/BETA11_BACKUP_INVENTORY.md');
const packageJson = JSON.parse(read('package.json'));
const pairedBackupPath = path.join(root, 'src/33_Beta11PairedBackup.js');
const pairedBackupImplemented = fs.existsSync(pairedBackupPath);
const pairedBackupSource = pairedBackupImplemented
  ? read('src/33_Beta11PairedBackup.js')
  : '';
const pairedBackupContractPath = path.join(
  root,
  'docs/beta-1/BETA11_PAIRED_BACKUP_CONTRACT.md'
);

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

test('accepted runtime and Beta.1.0 base remain exact', () => {
  assert(release.includes("version: '4.0.0-alpha.7.4.42'"));
  assert(beta10.includes("var PACKAGE_VERSION = '4.0.0-beta.1.0.1';"));
  assert.equal(inventory.baseCommit, 'e4dd3806996f832ab466f0a04d79e13e2ebfc1cd');
});

test('inventory source is syntax-valid and read-only', () => {
  new vm.Script(inventorySource, { filename: '32_Beta11BackupInventory.js' });
  [
    '.makeCopy(',
    '.createFile(',
    '.createFolder(',
    '.moveTo(',
    '.setTrashed(',
    '.setValue(',
    '.setValues(',
    'ScriptApp.',
    'SpreadsheetApp.'
  ].forEach(marker => assert(!inventorySource.includes(marker), marker));
  assert(inventorySource.includes("writeBoundary: 'READ_ONLY'"));
  assert(inventorySource.includes('physicalWrites: false'));
});

test('read-only DEV inventory entrypoint is complete', () => {
  [
    'AKORT.Beta11BackupInventory',
    'function AKORT_beta11BackupInventoryStatus()',
    'AKORT.EnvironmentGuard.assertDev()',
    'DriveApp.getFileById',
    'DriveApp.getFolderById'
  ].forEach(marker => assert(inventorySource.includes(marker), marker));
});

test('accepted Publish backup primitive exists and is exposed', () => {
  assert(incremental.includes('createPublishBackup:createPublishBackup'));
  assert(entrypoints.includes('function AKORT_alpha6CreatePublishBackup()'));
  assert(entrypoints.includes('AKORT.IncrementalPublish.createPublishBackup()'));
});

test('accepted Config already binds both source books and DEV folders', () => {
  [
    'dwhSpreadsheetId',
    'publishSpreadsheetId',
    'devRootFolderId',
    'devTablesFolderId',
    'testResultsFolderId'
  ].forEach(marker => assert(config.includes(marker), marker));
});

test('paired backup gap is absent before r2 or closed exactly by r2', () => {
  if (!pairedBackupImplemented) {
    assert(!core.includes('BACKUP_REGISTRY'));
    assert(!engine.includes('Beta11BackupHandlers'));
    assert(!engine.includes("BETA11_PAIRED_BACKUP"));
    return;
  }

  assert(core.includes('BACKUP_REGISTRY'));
  assert(engine.includes('AKORT.Beta11BackupHandlers.supports(type)'));
  assert(pairedBackupSource.includes(
    "var PACKAGE_VERSION = '4.0.0-beta.1.1.2';"
  ));
  assert(pairedBackupSource.includes(
    "var OPERATION_TYPE = 'BETA11_PAIRED_BACKUP';"
  ));
  assert.equal(
    (engine.match(/AKORT\.Beta11BackupHandlers\.supports\(type\)/g) || [])
      .length,
    1
  );
});

test('inventory matrix classifies reuse and exact missing deltas', () => {
  assert.equal(inventory.schemaVersion, '4.0-beta11-backup-inventory-1');
  assert.equal(inventory.packageVersion, '4.0.0-beta.1.1.1');
  assert.equal(inventory.baseRelease, '4.0.0-alpha.7.4.42');
  assert.equal(inventory.writeBoundary, 'READ_ONLY');
  assert.equal(inventory.findings.length, 7);
  assert(inventory.findings.some(item => item.id === 'B11-I-002' && item.status === 'REUSE_WITH_ADAPTER'));
  assert(inventory.findings.some(item => item.id === 'B11-I-005' && item.status === 'MISSING'));
  assert.equal(inventory.nextCandidate.packageVersion, '4.0.0-beta.1.1.2');
});

test('minimal-change documentation forbids a second subsystem', () => {
  [
    'must extend them rather than create a new backup subsystem',
    'one module-owned `BACKUP_REGISTRY` table',
    'one `BETA11_PAIRED_BACKUP` handler',
    'no second executor, queue or dispatcher'
  ].forEach(marker => assert(contractDoc.includes(marker), marker));

  if (pairedBackupImplemented) {
    assert(contractDoc.includes('Status after candidate r2'));
    assert(fs.existsSync(pairedBackupContractPath));
    assert(read('docs/beta-1/BETA11_PAIRED_BACKUP_CONTRACT.md').includes(
      'One paired backup is scheduled every calendar day'
    ));
  } else {
    assert(contractDoc.includes(
      'Daily scheduling is added only after the manual paired operation'
    ));
  }
});

test('user pipeline remains disabled in accepted runtime', () => {
  assert(incremental.includes('PUBLISH_USER_PIPELINE_ENABLED'));
  assert(incremental.includes('value:false'));
  assert(!inventorySource.includes('PUBLISH_USER_PIPELINE_ENABLED:true'));
  assert(!inventorySource.includes('PUBLISH_USER_PIPELINE_ENABLED = true'));
});

test('inventory suite is wired into the full regression', () => {
  assert.equal(
    packageJson.scripts['test:beta11-backup-inventory'],
    'node tests/beta11_backup_inventory_static.test.js'
  );
  assert(packageJson.scripts.test.includes('npm run test:beta11-backup-inventory'));
  assert(packageJson.scripts.test.includes('npm run test:beta10-bootstrap'));
});

const failed = tests.filter(item => item.status !== 'PASS');
console.log(JSON.stringify({
  suite: 'beta11_backup_inventory_static',
  packageVersion: inventory.packageVersion,
  baseRelease: inventory.baseRelease,
  total: tests.length,
  failed: failed.length
}, null, 2));
if (failed.length) process.exit(1);
