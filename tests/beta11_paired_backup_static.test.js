const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const config = read('src/01_Config.js');
const core = read('src/02_Core.js');
const engine = read('src/03_OperationEngine.js');
const publish = read('src/07_IncrementalPublish.js');
const backup = read('src/33_Beta11PairedBackup.js');
const contract = JSON.parse(
  read('docs/beta-1/BETA11_PAIRED_BACKUP_CONTRACT.json')
);
const packageJson = JSON.parse(read('package.json'));
const combined = fs.readdirSync(path.join(root, 'src'))
  .filter(file => /\.js$/.test(file))
  .sort()
  .map(file => read('src/' + file))
  .join('\n');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('r5 source is syntax-valid and pins accepted base', () => {
  new vm.Script(backup, { filename: '33_Beta11PairedBackup.js' });
  assert(backup.includes("var PACKAGE_VERSION = '4.0.0-beta.1.1.5';"));
  assert(backup.includes("var BASE_RELEASE = '4.0.0-alpha.7.4.42';"));
  assert(backup.includes(
    "var BASE_COMMIT = '7c90ef1b2fb9abe860394c17ec24fe459b505b0e';"
  ));
});

test('schedule is daily at 04:00 Moscow', () => {
  assert(backup.includes("var TIMEZONE = 'Europe/Moscow';"));
  assert(backup.includes('var DAILY_HOUR = 4;'));
  assert(backup.includes('.atHour(DAILY_HOUR)'));
  assert(backup.includes('.nearMinute(0)'));
  assert(backup.includes('.everyDays(1)'));
  assert(backup.includes('.inTimezone(TIMEZONE)'));
  assert.equal(contract.schedule.nominalTime, '04:00');
  assert.equal(contract.schedule.triggerWindow, '03:45-04:15');
  assert.equal(contract.schedule.includesWeekends, true);
});

test('dedicated DEV backup folder is explicit', () => {
  assert(config.includes(
    "backupFolderId: p[PROPERTY_PREFIX + 'BACKUP_FOLDER_ID']"
  ));
  assert(backup.includes("var FOLDER_NAME = '08_Резервные копии';"));
  assert(backup.includes("var FOLDER_PROPERTY = 'AKORT_BACKUP_FOLDER_ID';"));
  assert(backup.includes('root.createFolder(FOLDER_NAME)'));
  assert(!backup.includes('testResultsFolderId'));
});

test('BACKUP_REGISTRY is an operational service table', () => {
  assert.equal((core.match(/BACKUP_REGISTRY\s*:/g) || []).length, 1);
  [
    "'backup_id', 'operation_id', 'request_type', 'status', 'scheduled_date'",
    "'dwh_source_id', 'dwh_backup_id', 'dwh_backup_name'",
    "'publish_source_id', 'publish_backup_id'",
    "'manifest_file_id'",
    "'manifest_hash'",
    "'operation_boundary_json'"
  ].forEach(marker => assert(core.includes(marker), marker));
});

test('accepted Operation Engine remains the only executor', () => {
  assert(engine.includes('AKORT.Beta11BackupHandlers.supports(type)'));
  assert(backup.includes("var OPERATION_TYPE = 'BETA11_PAIRED_BACKUP';"));
  assert(backup.includes('AKORT.OperationEngine.enqueue('));
  assert(backup.includes('AKORT.OperationEngine.run(operationId'));
  assert(backup.includes('AKORT.OperationEngine.resume(operationId'));
  assert.equal((combined.match(/AKORT\.OperationEngine\s*=/g) || []).length, 1);
  assert(!backup.includes('OPERATION_QUEUE:'));
});

test('Publish copy reuses accepted Alpha.6 primitive', () => {
  assert(publish.includes('function copyPublishBackup_(options)'));
  assert(publish.includes('function createPublishBackup(options)'));
  assert(publish.includes(
    'BackupCompatibility:Object.freeze({copyPublishBackup:copyPublishBackup_})'
  ));
  assert(backup.includes('compatibility.copyPublishBackup({'));
});

test('pair identity and manifest are deterministic', () => {
  assert(backup.includes("return 'BKP_DAILY_' + moscowDateKey_(date);"));
  assert(backup.includes("return 'BKP_MANUAL_' + timestampKey_()"));
  assert(backup.includes(
    "state.dwhName = state.dwhName || ('AKORT_DWH_TECH_4_BACKUP__'"
  ));
  assert(backup.includes(
    "state.publishName = state.publishName || ('AKORT_PUBLISH_4_BACKUP__'"
  ));
  assert(backup.includes("'AKORT_BACKUP_MANIFEST__' + state.backupId"));
});

test('lost-response adoption and PARTIAL resume are explicit', () => {
  assert(backup.includes('folder.getFilesByName(name)'));
  assert(backup.includes('adopted: true'));
  assert(backup.includes("dwhRow.status = 'PARTIAL';"));
  assert(backup.includes("publishRow.status = 'PARTIAL';"));
  assert.equal(contract.recovery.lostResponseAdoption, true);
  assert.equal(contract.recovery.resumeOnlyMissingMember, true);
});

test('operation boundary fails closed between pair members', () => {
  assert(backup.includes('operationBoundary_(context.operation.operation_id)'));
  assert(backup.includes("'BACKUP_BOUNDARY_CHANGED_AFTER_DWH_COPY'"));
  assert(backup.includes("'RUNNING' || status === 'QUEUED'"));
  assert.equal(contract.recovery.operationBoundaryFailClosed, true);
});

test('daily idempotency and retry are bounded', () => {
  assert(backup.includes('idempotencyKey: backupId'));
  assert(backup.includes('maxAttempts: 24'));
  assert(backup.includes('var RETRY_DELAY_MS = 10 * 60 * 1000;'));
  assert(backup.includes("'BACKUP_WAITING_FOR_OPERATION_QUIESCENCE'"));
  assert(backup.includes(
    "code === 'BACKUP_WAITING_FOR_OPERATION_QUIESCENCE'"
  ));
  assert(backup.includes("? 'WAITING'"));
});

test('terminal cleanup recognizes every Operation Engine result shape', () => {
  const sandbox = { console: { log() {} } };
  vm.createContext(sandbox);
  new vm.Script(backup, {
    filename: '33_Beta11PairedBackup.js'
  }).runInContext(sandbox);
  const detect = sandbox.AKORT.Beta11PairedBackup.Test.operationStatus;

  assert.equal(detect({
    data: {
      operation: { status: 'RETRY_PENDING' }
    }
  }), 'RETRY_PENDING');

  assert.equal(detect({
    details: {
      operation: { status: 'DEAD_LETTER' }
    }
  }), 'DEAD_LETTER');

  assert.equal(detect({
    data: {
      operation_id: 'OP_TEST',
      operation_type: 'BETA11_PAIRED_BACKUP',
      status: 'SUCCESS'
    }
  }), 'SUCCESS');

  assert.equal(detect({
    status: 'SUCCESS',
    data: { arbitrary: true }
  }), '');

  assert.equal(detect({
    data: {
      data: {
        operation: { status: 'PAUSED' }
      }
    }
  }), 'PAUSED');

  assert.equal(detect({
    details: {
      operation_id: 'OP_DETAILS',
      operation_type: 'BETA11_PAIRED_BACKUP',
      status: 'FAILED'
    }
  }), 'FAILED');

  assert.equal(contract.terminalCleanup.wrapperResultStatusIgnored, true);
  assert.equal(contract.terminalCleanup.clearsActiveOperationProperty, true);
  assert.equal(contract.terminalCleanup.deletesWorkerTrigger, true);
  assert.equal(contract.terminalCleanup.operatorPrecedenceAmbiguity, false);
  assert(!backup.includes(
    'container.operation_id && container.operation_type ? container : {}'
  ));
});

test('public API is narrow', () => {
  [
    'function AKORT_beta11DeploymentPreflight()',
    'function AKORT_beta11Install()',
    'function AKORT_beta11BackupNow()',
    'function AKORT_beta11DailyBackupTrigger()',
    'function AKORT_beta11BackupWorker()',
    'function AKORT_beta11BackupStatus(operationId)'
  ].forEach(marker => assert(backup.includes(marker), marker));
});

test('deployment preflight is read-only and explicit', () => {
  assert(backup.includes('function deploymentPreflight()'));
  assert(backup.includes("'BETA11_DEPLOYMENT_PREFLIGHT'"));
  assert(backup.includes("writeBoundary: 'READ_ONLY'"));
  assert(backup.includes('readyToInstall: blockers.length === 0'));
  assert(backup.includes("'BETA11_DEPLOYMENT_PREFLIGHT_BLOCKED'"));
  assert.equal(
    contract.deploymentPreflight.entrypoint,
    'AKORT_beta11DeploymentPreflight'
  );
  assert.equal(contract.deploymentPreflight.writeBoundary, 'READ_ONLY');
  assert.equal(contract.deploymentPreflight.nestedScriptLock, false);
});

test('installer never nests the Core Script Lock', () => {
  const start = backup.indexOf('  function install() {');
  const end = backup.indexOf('  function backupNow() {');
  assert(start >= 0 && end > start);
  const installBlock = backup.slice(start, end);
  const coreIndex = installBlock.indexOf('var core = AKORT.Core.install();');
  const betaLockIndex = installBlock.indexOf(
    "return AKORT.Core.safeRun(\n      'BETA11_PAIRED_BACKUP_INSTALL'"
  );
  assert(installBlock.includes('var preflight = deploymentPreflight();'));
  assert(coreIndex >= 0);
  assert(betaLockIndex > coreIndex);
  assert(!installBlock.includes(
    "return AKORT.Core.safeRun('BETA11_PAIRED_BACKUP_INSTALL', function ()"
  ));
});

test('retention is deferred and no deletion exists', () => {
  assert.equal(contract.retention.automaticDeletion, false);
  assert.equal(contract.retention.ownerRelease, 'Beta.1.6');
  assert(!backup.includes('.setTrashed(true)'));
  assert(!backup.includes('.setTrashed(false)'));
});

test('safety boundaries remain exact', () => {
  assert(backup.includes('AKORT.EnvironmentGuard.assertDev()'));
  assert(backup.includes("'BETA11_USER_PIPELINE_MUST_REMAIN_DISABLED'"));
  assert(!/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(combined));
  assert.equal(contract.boundaries.productionTouched, false);
  assert.equal(contract.boundaries.userPipelineEnabled, false);
  assert.equal(contract.boundaries.secondExecutor, false);
  assert.equal(contract.boundaries.secondQueue, false);
});

test('r5 suite is wired into full regression', () => {
  assert.equal(
    packageJson.scripts['test:beta11-paired-backup'],
    'node tests/beta11_paired_backup_static.test.js'
  );
  assert(packageJson.scripts.test.includes(
    'npm run test:beta11-paired-backup'
  ));
});

const failed = results.filter(item => item.status !== 'PASS');
console.log(JSON.stringify({
  suite: 'beta11_paired_backup_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  total: results.length,
  failed: failed.length
}, null, 2));
if (failed.length) process.exit(1);
