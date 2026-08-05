'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '44_Beta11RestoreRehearsal.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const engine = fs.readFileSync(
  path.join(root, 'src', '03_OperationEngine.js'),
  'utf8'
);
const hardening = fs.readFileSync(
  path.join(root, 'src', '38_Beta14OperationalHardening.js'),
  'utf8'
);
const contract = JSON.parse(fs.readFileSync(
  path.join(
    root,
    'docs',
    'beta-1',
    'BETA11_RESTORE_REHEARSAL_CONTRACT.json'
  ),
  'utf8'
));
const markdown = fs.readFileSync(
  path.join(
    root,
    'docs',
    'beta-1',
    'BETA11_RESTORE_REHEARSAL_CONTRACT.md'
  ),
  'utf8'
);
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

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

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach((key) => {
      result[key] = canonicalize(value[key]);
    });
    return result;
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function loadModule() {
  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Boolean,
    Array,
    isNaN,
    isFinite,
    AKORT: {
      Core: {
        canonicalJson,
        sha256,
        safeJson: JSON.stringify,
        now: () => '2026-08-05T10:00:00.000Z'
      }
    }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: sourcePath }).runInContext(context);
  return context.AKORT.Beta11RestoreRehearsal;
}

test('r6 metadata and exact backup target are pinned', () => {
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.1.7');
  assert.strictEqual(
    contract.contractVersion,
    '4.0-beta11-isolated-restore-rehearsal-2'
  );
  assert.strictEqual(contract.baseRelease, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    contract.baseCommit,
    'cc5451f3bfaad4a294f07c31a7c0b76b71f14299'
  );
  assert.strictEqual(contract.defaultBackupId, 'BKP_DAILY_20260805');
  assert(source.includes("var DEFAULT_BACKUP_ID = 'BKP_DAILY_20260805';"));
});

test('source and suite are syntax-valid', () => {
  new vm.Script(source, { filename: sourcePath });
  new vm.Script(fs.readFileSync(__filename, 'utf8'), {
    filename: __filename
  });
});

test('accepted Operation Engine registers the restore handler', () => {
  assert(engine.includes('AKORT.Beta11RestoreRehearsalHandlers'));
  assert(
    engine.includes(
      'AKORT.Beta11RestoreRehearsalHandlers.supports(type)'
    )
  );
  assert.strictEqual(contract.acceptedExecutor, 'AKORT.OperationEngine');
  assert.strictEqual(contract.operationType, 'BETA11_RESTORE_REHEARSAL');
});

test('Beta.1.4 serializes rehearsal as snapshot-exclusive', () => {
  assert(
    hardening.includes("if (type === 'BETA11_RESTORE_REHEARSAL')")
  );
  const start = hardening.indexOf(
    "if (type === 'BETA11_RESTORE_REHEARSAL')"
  );
  const boundary = hardening.slice(start, start + 160);
  assert(boundary.includes("return 'SNAPSHOT_EXCLUSIVE';"));
  assert.strictEqual(
    contract.guardedEnqueue,
    'AKORT.Beta14OperationalHardening.enqueueGuarded'
  );
});

test('public no-argument operator API is exact', () => {
  contract.publicApi.forEach((name) => {
    assert(source.includes('function ' + name + '()'), name);
  });
  assert.strictEqual(contract.publicApi.length, 6);
});

test('rehearsal uses isolated backup copies and deterministic evidence', () => {
  assert(source.includes("var ROOT_FOLDER_NAME = '09_Проверка восстановления';"));
  assert(source.includes("state.folderName = 'RESTORE_REHEARSAL__'"));
  assert(source.includes("state.dwhRestoreName = 'RESTORED_DWH__'"));
  assert(source.includes("state.publishRestoreName = 'RESTORED_PUBLISH__'"));
  assert(source.includes("state.evidenceName = 'AKORT_RESTORE_REHEARSAL_EVIDENCE__'"));
  assert(source.includes('.makeCopy(name, folder)'));
  assert(source.includes('createOrAdoptEvidence_('));
  assert.strictEqual(contract.restoreMode, 'ISOLATED_BACKUP_COPY_ONLY');
});

test('backup manifest hash and member binding are mandatory', () => {
  assert(source.includes('BETA11_RESTORE_MANIFEST_HASH_MISMATCH'));
  assert(source.includes('BETA11_RESTORE_MANIFEST_BINDING_MISMATCH'));
  assert(source.includes('AKORT.Core.canonicalJson(parsed)'));
  assert(source.includes('parsed.members && parsed.members.dwh'));
  assert(source.includes('parsed.members && parsed.members.publish'));
});

test('workbook comparison covers values formulas formats and metadata', () => {
  [
    'getSpreadsheetLocale()',
    'getSpreadsheetTimeZone()',
    'getNamedRanges()',
    'isSheetHidden()',
    'getFrozenRows()',
    'getFrozenColumns()',
    'getMaxRows()',
    'getMaxColumns()',
    'getValues()',
    'getFormulasR1C1()',
    'getNumberFormats()'
  ].forEach((token) => assert(source.includes(token), token));
  [
    'CELL_VALUES',
    'FORMULAS_R1C1',
    'NUMBER_FORMATS',
    'NAMED_RANGES',
    'SHEET_DIMENSIONS'
  ].forEach((item) => assert(contract.comparisonScope.includes(item), item));
});

test('comparison is bounded resumable and fingerprinted', () => {
  assert(source.includes('var CHUNK_CELL_LIMIT = 20000;'));
  assert(source.includes('var MAX_CELLS_PER_INVOCATION = 640000;'));
  assert(source.includes('var MAX_CHUNKS_PER_INVOCATION = 40;'));
  assert(source.includes('var MAX_HANDLER_MS = 210000;'));
  assert(source.includes('repeatPhase: true'));
  assert(source.includes("phase === 'PREPARING_AGGREGATE_IMPACT'"));
  assert(source.includes("phase === 'MATERIALIZING_AGGREGATE_INPUTS'"));
  assert(source.includes('workbookFingerprint'));
  assert(source.includes('sheetResults'));
});

test('chain fingerprint and normalization are deterministic', () => {
  const module = loadModule();
  assert.strictEqual(
    module.Test.nextChainHash('a', 'b'),
    module.Test.nextChainHash('a', 'b')
  );
  assert.notStrictEqual(
    module.Test.nextChainHash('a', 'b'),
    module.Test.nextChainHash('a', 'c')
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(module.Test.normalizeMatrix([[1, true, null]]))),
    [[1, true, '']]
  );
});

test('r7 compact progress is checkpoint-only and bounded', () => {
  assert(
    source.includes(
      'function AKORT_beta11RestoreRehearsalProgressLatest()'
    )
  );
  assert(source.includes('function progressLatest()'));
  assert(source.includes("'OPERATION_QUEUE'"));
  assert(source.includes('completedCells'));
  assert(source.includes('totalCells'));
  assert(source.includes('rowCursor'));
  assert.strictEqual(
    contract.compactProgress.entrypoint,
    'AKORT_beta11RestoreRehearsalProgressLatest'
  );
  assert.strictEqual(contract.compactProgress.readsOperationQueueOnly, true);
  assert.strictEqual(contract.compactProgress.writesDataPlane, false);
  assert.strictEqual(
    contract.boundedExecution.maxCellsPerInvocation,
    640000
  );
  assert.strictEqual(
    contract.boundedExecution.maxChunksPerInvocation,
    40
  );
  assert.strictEqual(contract.boundedExecution.maxHandlerMs, 210000);
  assert.strictEqual(
    contract.boundedExecution.checkpointCompatibleWithR6,
    true
  );
});

test('active DEV configuration and data plane remain untouched', () => {
  [
    'setTrashed(',
    'moveToTrash(',
    'deleteFile(',
    'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger',
    'setProperty(\'PUBLISH_USER_PIPELINE_ENABLED\'',
    'resources.dwhSpreadsheetId =',
    'resources.publishSpreadsheetId ='
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.changesActiveDevConfiguration, false);
  assert.strictEqual(contract.writesRaw, false);
  assert.strictEqual(contract.writesPublish, false);
  assert.strictEqual(contract.productionWrite, false);
  assert.strictEqual(contract.enablesUserPipeline, false);
  assert(markdown.includes('never points `99_LocalConfig`'));
});

test('no new queue executor dispatcher table or trigger is created', () => {
  assert.strictEqual(contract.createsTrigger, false);
  assert.strictEqual(contract.deletesTrigger, false);
  assert.strictEqual(contract.physicalDeletion, false);
  assert(!source.includes('AKORT.OperationEngine.enqueue('));
  assert(!source.includes('insertSheet('));
  assert(!source.includes('createTextFinder('));
});

test('immutable evidence retains IDs fingerprints and safety boundary', () => {
  assert.strictEqual(contract.evidence.format, 'IMMUTABLE_JSON_FILE');
  assert.strictEqual(contract.evidence.containsSourceAndRestoredIds, true);
  assert.strictEqual(contract.evidence.containsWorkbookFingerprints, true);
  assert.strictEqual(contract.evidence.containsSheetFingerprints, true);
  assert.strictEqual(contract.evidence.containsSafetyBoundary, true);
  [
    'evidenceId',
    'evidenceHash',
    'dwhWorkbookFingerprint',
    'publishWorkbookFingerprint',
    'productionTouched: false',
    'activeDevConfigurationChanged: false',
    'dataPlaneWrite: false'
  ].forEach((token) => assert(source.includes(token), token));
});

test('user pipeline and forbidden fixture remain protected', () => {
  assert(
    !/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source)
  );
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

test('restore suite is wired once at the end of full regression', () => {
  const command = 'npm run test:beta11-restore-rehearsal';
  assert.strictEqual(
    pkg.scripts['test:beta11-restore-rehearsal'],
    'node tests/beta11_restore_rehearsal_static.test.js'
  );
  const commands = pkg.scripts.test.split(' && ');
  assert.strictEqual(commands.filter((item) => item === command).length, 1);
  assert.strictEqual(commands[commands.length - 1], command);
});

console.log(JSON.stringify({
  suite: 'beta11_restore_rehearsal_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  defaultBackupId: contract.defaultBackupId,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
