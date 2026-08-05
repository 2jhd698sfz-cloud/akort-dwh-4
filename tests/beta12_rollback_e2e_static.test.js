const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('src/45_Beta12RollbackE2E.js');
const facade = read('src/35_Beta12RollbackFacade.js');
const hardening = read('src/38_Beta14OperationalHardening.js');
const restore = read('src/44_Beta11RestoreRehearsal.js');
const raw = read('src/05_RawStore.js');
const engine = read('src/03_OperationEngine.js');
const contract = JSON.parse(read('docs/beta-1/BETA12_ROLLBACK_E2E_CONTRACT.json'));
const markdown = read('docs/beta-1/BETA12_ROLLBACK_E2E_CONTRACT.md');
const packageJson = JSON.parse(read('package.json'));

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

function akortError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function functionBody(text, functionName, nextFunctionName) {
  const start = text.indexOf('  function ' + functionName + '(');
  assert(start >= 0, 'missing function ' + functionName);
  const end = nextFunctionName
    ? text.indexOf('\n  function ' + nextFunctionName + '(', start)
    : text.indexOf('\n  return Object.freeze({', start);
  assert(end > start, 'missing end boundary for ' + functionName);
  return text.slice(start, end);
}

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  AKORT: {
    Core: {
      error: akortError,
      sha256,
      canonicalJson,
      safeJson(value) { return JSON.stringify(value); },
      now() { return '2026-08-05T00:00:00.000Z'; }
    },
    Result: {
      success(message, data) { return { ok: true, status: 'SUCCESS', message, data }; },
      failure(code, message, details) {
        return { ok: false, status: 'FAILED', code, message, details };
      },
      paused(message, data) { return { ok: true, status: 'PAUSED', message, data }; }
    },
    RawStore: {
      businessKey(target, row) {
        return target + '|series_id=' + String(row.series_id || '') +
          '|period_start=' + String(row.period_start || '') +
          '|period_end=' + String(row.period_end || '');
      }
    }
  }
};
vm.runInNewContext(source, sandbox, { filename: '45_Beta12RollbackE2E.js' });
const harness = sandbox.AKORT.Beta12RollbackE2E;

const expectedPublicFunctions = [
  'AKORT_beta12RollbackE2EPreflight',
  'AKORT_beta12RollbackE2ECanarySubmit',
  'AKORT_beta12RollbackE2EContinueLatest',
  'AKORT_beta12RollbackE2ERollbackPreview',
  'AKORT_beta12RollbackE2ERollbackSubmit',
  'AKORT_beta12RollbackE2EStatusLatest',
  'AKORT_beta12RollbackE2EFinalizeLatest',
  'AKORT_beta12RollbackE2EContract'
];

const protectedMarkers = [
  'ALPHA3_TEST_', 'ALPHA3_DEMO_', 'ALPHA4_TEST_', 'ALPHA5_TEST_',
  'ALPHA74_GATE6', 'ALPHA74_GATE7', 'GATE6_', 'GATE7_'
];

test('source is syntax-valid and pins exact implementation base', () => {
  new vm.Script(source, { filename: '45_Beta12RollbackE2E.js' });
  assert.equal(harness.PackageVersion, '4.0.0-beta.1.2.7');
  assert.equal(harness.ContractVersion, '4.0-beta12-rollback-e2e-1');
  assert.equal(
    harness.ImplementationBaseHead,
    '157f017d842a27aa85e53de51d2d80fe8facb5bd'
  );
  assert.equal(
    harness.ImplementationBaseBranch,
    'codex/beta-1-operational-gap-closure'
  );
  assert.equal(harness.BaseRelease, '4.0.0-alpha.7.4.42');
});

test('accepted facade, hardening and restore bindings are exact', () => {
  assert(source.includes("var FACADE_PACKAGE = '4.0.0-beta.1.2.5';"));
  assert(source.includes("var FACADE_CONTRACT = '4.0-beta12-rollback-facade-4';"));
  assert(source.includes("var HARDENING_PACKAGE = '4.0.0-beta.1.4.2';"));
  assert(source.includes("var HARDENING_CONTRACT = '4.0-beta14-operational-hardening-1';"));
  assert(source.includes("var RESTORE_PACKAGE = '4.0.0-beta.1.1.7';"));
  assert(source.includes(
    "var RESTORE_CONTRACT = '4.0-beta11-isolated-restore-rehearsal-2';"
  ));
  assert(facade.includes("var PACKAGE_VERSION = '4.0.0-beta.1.2.5';"));
  assert(facade.includes(
    "var CONTRACT_VERSION = '4.0-beta12-rollback-facade-4';"
  ));
  assert(hardening.includes("var PACKAGE_VERSION = '4.0.0-beta.1.4.2';"));
  assert(hardening.includes(
    "var CONTRACT_VERSION = '4.0-beta14-operational-hardening-1';"
  ));
  assert(restore.includes("var PACKAGE_VERSION = '4.0.0-beta.1.1.7';"));
  assert(restore.includes(
    "var CONTRACT_VERSION = '4.0-beta11-isolated-restore-rehearsal-2';"
  ));
});

test('restore evidence binding and exact DEV IDs are pinned', () => {
  [
    'RRE_0F19BA90233D4B0C053C5659',
    '0f19ba90233d4b0c053c565957a6183d14c48a4405020964d38a270adf9e9d15',
    '3fff487ea06cc32bb86cd516434e9cd6c5bf62b618499b4c726126d305a972a3',
    '151LMCH-yam2Guba_2TzCUwzhc3javtct',
    '1d89EJVHtrZ4a8emcb-13OMjHMyh3mvW36LcxQf9Gk5s',
    '1tO_GmM02JSjOx05LYncsoqcqH4om9cVtr4pECxVCFBw',
    '1EvZx01xSMR6smJ2PNakKzlrEwT0OjV4J'
  ].forEach((value) => assert(source.includes(value), value));
  assert.equal(
    contract.acceptedBindings.restoreRehearsal.contractVersion,
    '4.0-beta11-isolated-restore-rehearsal-2'
  );
});

test('restore evidence file hash uses canonical JSON rather than raw file bytes', () => {
  const start = source.indexOf('function restoreEvidence_()');
  const end = source.indexOf('\n  function activeOperations_', start);
  assert(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert(body.includes('var evidence = parseJson_('));
  assert(body.includes('var fileHash = canonicalHash_(evidence);'));
  assert(!body.includes('AKORT.Core.sha256(content)'));
  assert(
    body.indexOf('var evidence = parseJson_(') <
      body.indexOf('var fileHash = canonicalHash_(evidence);')
  );
});

test('all public Apps Script functions exist and accept no arguments', () => {
  expectedPublicFunctions.forEach((name) => {
    const pattern = new RegExp('function\\s+' + name + '\\s*\\(\\s*\\)');
    assert(pattern.test(source), name);
  });
  assert.deepEqual(
    Array.from(harness.contract().publicFunctions),
    expectedPublicFunctions
  );
});

test('accepted operation types are reused with no new data-plane executor', () => {
  assert(source.includes("var RAW_LOAD_TYPE = 'RAW_LOAD_V4';"));
  assert(source.includes("var RAW_REVERSAL_TYPE = 'RAW_REVERSAL_V4';"));
  assert(source.includes('AKORT.Beta14OperationalHardening.enqueueGuarded('));
  assert(source.includes('AKORT.Beta12RollbackFacade.preview('));
  assert(source.includes('AKORT.Beta12RollbackFacade.submit('));
  assert(source.includes('AKORT.OperationEngine.run('));
  assert(!source.includes('AKORT.OperationEngine.enqueue('));
  assert(/var\s+LOAD_TYPE\s*=\s*['"]RAW_LOAD_V4['"]/.test(raw));
  assert(/var\s+REVERSAL_TYPE\s*=\s*['"]RAW_REVERSAL_V4['"]/.test(raw));
  assert(/function\s+enqueue\s*\(/.test(engine));
  assert(/function\s+run\s*\(/.test(engine));
});

test('preflight is read-only', () => {
  const body = functionBody(source, 'preflight', 'canaryValue_');
  [
    'saveState_(', 'enqueueGuarded(', 'OperationEngine.run(',
    'Beta12RollbackFacade.submit(', 'createFile(', 'createFolder(',
    'setContent(', 'setValue(', 'setValues(', 'appendRow('
  ].forEach((token) => assert(!body.includes(token), token));
  assert(body.includes('preflightData_()'));
});

test('canary submit cannot submit rollback', () => {
  const body = functionBody(source, 'canarySubmit', 'completedPhases_');
  assert(body.includes('enqueueGuarded('));
  assert(body.includes('RAW_LOAD_TYPE'));
  assert(!body.includes('Beta12RollbackFacade.preview('));
  assert(!body.includes('Beta12RollbackFacade.submit('));
  assert(!body.includes('RAW_REVERSAL_TYPE'));
});

test('continue latest runs only an exact stored operation and cannot enqueue', () => {
  const body = functionBody(source, 'continueLatest', 'previewBinding_');
  assert(body.includes('controller.canaryOperationId'));
  assert(body.includes('controller.rollbackOperationId'));
  assert(body.includes('AKORT.OperationEngine.run(operationId'));
  assert(!body.includes('enqueueGuarded('));
  assert(!body.includes('Beta12RollbackFacade.preview('));
  assert(!body.includes('Beta12RollbackFacade.submit('));
});

test('rollback preview performs no data-plane write or queue action', () => {
  const body = functionBody(source, 'rollbackPreview', 'rollbackSubmit');
  assert(body.includes('AKORT.Beta12RollbackFacade.preview('));
  [
    'enqueueGuarded(', 'OperationEngine.run(',
    'Beta12RollbackFacade.submit(', 'createFile(', 'createFolder(',
    'setContent(', 'setValue(', 'setValues(', 'appendRow('
  ].forEach((token) => assert(!body.includes(token), token));
  assert(body.includes('controlStateWrite: true'));
  assert(body.includes('dataPlaneWrite: false'));
});

test('rollback submit re-previews and binds to the stored exact target', () => {
  const body = functionBody(source, 'rollbackSubmit', 'validateRollback_');
  assert(body.includes('controller.previewBinding.targetLoadId'));
  assert(body.includes('controller.previewBinding.confirmationToken'));
  assert(body.includes('AKORT.Beta12RollbackFacade.preview('));
  assert(body.includes('bindingsEqual_(controller.previewBinding, freshBinding)'));
  assert(body.includes('AKORT.Beta12RollbackFacade.submit('));
  assert(!body.includes('candidateFromSnapshot_('));
  assert(!body.includes('enqueueGuarded('));
});

test('finalize verifies and writes evidence without executing rollback', () => {
  const body = functionBody(source, 'finalizeLatest', 'contract');
  assert(body.includes('validateCanary_(controller, true)'));
  assert(body.includes('validateRollback_(controller)'));
  assert(body.includes('evidenceChecks_('));
  assert(body.includes('folder.createFile('));
  assert(!body.includes('OperationEngine.run('));
  assert(!body.includes('enqueueGuarded('));
  assert(!body.includes('Beta12RollbackFacade.submit('));
  assert(!body.includes('Beta12RollbackFacade.preview('));
});

test('source identity is controlled E2E but does not collide with facade markers', () => {
  const identity = [
    harness.Test.sourceId,
    harness.Test.sourceName,
    harness.Test.rollbackReason
  ].join('|').toUpperCase();
  protectedMarkers.forEach((marker) => {
    assert(!identity.includes(marker), marker);
    assert.equal(harness.Test.sourceIdentityProtected(marker + 'X'), true);
  });
  assert.equal(harness.Test.sourceIdentityProtected(identity), false);
  assert(facade.includes("'ALPHA74_GATE6', 'ALPHA74_GATE7', 'GATE6_', 'GATE7_'"));
});

test('canary value is finite, minimal and different', () => {
  [0, 1, -1, 2215056.2, 0.000001].forEach((value) => {
    const next = harness.Test.canaryValue(value);
    assert(Number.isFinite(next));
    assert.notEqual(next, value);
    assert(Math.abs(next - value) <= Math.max(Math.abs(value) * 0.000002, 0.000002));
  });
  assert.throws(
    () => harness.Test.canaryValue('not-a-number'),
    (error) => error.code === 'BETA12_E2E_CANARY_VALUE_INVALID'
  );
});

test('confirmation binding equality is exact and canonical', () => {
  const left = { targetLoadId: 'LOAD_1', token: 'T', nested: { a: 1, b: 2 } };
  const reordered = { nested: { b: 2, a: 1 }, token: 'T', targetLoadId: 'LOAD_1' };
  const drifted = { nested: { b: 3, a: 1 }, token: 'T', targetLoadId: 'LOAD_1' };
  assert.equal(harness.Test.bindingsEqual(left, reordered), true);
  assert.equal(harness.Test.bindingsEqual(left, drifted), false);
});

test('full phase chain covers Publish, aggregate, reconciliation and quick audit', () => {
  const phases = Array.from(harness.Test.fullPhases);
  [
    'COMMIT_RAW', 'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS', 'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST', 'RECONCILING_AGGREGATES',
    'QUICK_AUDIT', 'FINALIZING', 'SUCCESS'
  ].forEach((phase) => assert(phases.includes(phase), phase));
});


test('candidate selection is deterministic and rejects protected or untraceable lineage', () => {
  const operation = {
    operation_id: 'OP_SOURCE_1',
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'SUCCESS',
    created_by: 'unknown',
    release_version: '4.0.0-alpha.7.4.42',
    checkpoint_json: JSON.stringify({
      input: { sourceName: 'Current industry data' },
      meta: { idempotencyKey: 'CURRENT_INDUSTRY_1' },
      handlerState: { sourceHash: 'HASH_1' }
    })
  };
  const row = {
    observation_id: 'OBS_1',
    series_id: 'SERIES_A',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    value: 100,
    version_no: 1,
    is_latest: true,
    load_id: 'LOAD_1'
  };
  const load = {
    load_id: 'LOAD_1',
    operation_id: 'OP_SOURCE_1',
    source_id: 'CURRENT_INDUSTRY_1',
    source_name: 'Current industry data',
    target_table: 'RAW_INDUSTRY',
    status: 'COMMITTED'
  };
  const selected = harness.Test.candidateFromSnapshot({
    rows: [row], loads: [load], reversals: [], operations: [operation]
  });
  assert.equal(selected.predecessorObservationId, 'OBS_1');
  assert.equal(selected.predecessorLoadId, 'LOAD_1');
  assert(selected.candidateFingerprint);

  const protectedLoad = Object.assign({}, load, {
    source_name: 'ALPHA74_GATE7 controlled data'
  });
  assert.throws(
    () => harness.Test.candidateFromSnapshot({
      rows: [row], loads: [protectedLoad], reversals: [], operations: [operation]
    }),
    (error) => error.code === 'BETA12_E2E_SAFE_CANDIDATE_NOT_FOUND'
  );

  assert.throws(
    () => harness.Test.candidateFromSnapshot({
      rows: [row], loads: [load], reversals: [], operations: []
    }),
    (error) => error.code === 'BETA12_E2E_SAFE_CANDIDATE_NOT_FOUND'
  );
});

test('preview binding requires exact one-row restoration and all fingerprints', () => {
  const data = {
    targetLoad: { loadId: 'LOAD_CANARY' },
    eligibility: { targetRowCount: 1 },
    restoration: { restoredRowCount: 1, unrestoredRowCount: 0 },
    confirmationToken: 'TOKEN',
    fingerprints: {
      lineage: 'LINEAGE', impact: 'IMPACT',
      sourceOperation: 'SOURCE', reason: 'REASON'
    },
    reason: harness.Test.rollbackReason
  };
  const binding = harness.Test.previewBinding(data);
  assert.equal(harness.Test.assertPreviewBinding(binding).targetLoadId, 'LOAD_CANARY');
  binding.unrestoredRowCount = 1;
  assert.throws(
    () => harness.Test.assertPreviewBinding(binding),
    (error) => error.code === 'BETA12_E2E_PREVIEW_BINDING_INVALID'
  );
});

test('final evidence contains at least twelve checks and all required fields', () => {
  assert(contract.acceptance.minimumChecks >= 12);
  const sourceChecks = (source.match(/check_\('/g) || []).length;
  assert(sourceChecks >= 15, String(sourceChecks));
  [
    'currentCommit', 'acceptedRestoreEvidenceId',
    'acceptedRestoreEvidenceHash', 'canaryOperationId', 'canaryLoadId',
    'canaryObservationId', 'predecessorObservationId',
    'rollbackOperationId', 'reversalLoadId', 'confirmationToken',
    'lineageFingerprint', 'impactFingerprint',
    'sourceOperationFingerprint', 'reasonHash', 'checksTotal',
    'checksPassed', 'evidenceId', 'evidenceHash', 'evidenceFileId',
    'evidenceFileUrl', 'completedAt', 'safety'
  ].forEach((field) => assert(source.includes(field), field));
});

test('forbidden cleanup, trigger and pipeline-enablement APIs are absent', () => {
  [
    /deleteRow\s*\(/,
    /deleteRows\s*\(/,
    /setTrashed\s*\(/,
    /deleteProperty\s*\(/,
    /ScriptApp\./,
    /newTrigger\s*\(/,
    /createTrigger\s*\(/,
    /PUBLISH_USER_PIPELINE_ENABLED[^\n]{0,80}(?:true|TRUE|1)/
  ].forEach((pattern) => assert(!pattern.test(source), pattern.toString()));
  assert(source.includes('physicalDeletion: false'));
  assert(source.includes('userPipelineEnabled: false'));
  assert(source.includes('evidenceCleanupPerformed: false'));
});

test('contract JSON and Markdown preserve fail-closed scope', () => {
  assert.equal(contract.schemaVersion, '4.0-beta12-rollback-e2e-1');
  assert.equal(contract.packageVersion, '4.0.0-beta.1.2.7');
  assert.equal(contract.scope.canaryOperationType, 'RAW_LOAD_V4');
  assert.equal(contract.scope.rollbackOperationType, 'RAW_REVERSAL_V4');
  assert.equal(contract.scope.targetTable, 'RAW_INDUSTRY');
  assert.equal(contract.scope.canaryRows, 1);
  assert.equal(contract.safety.failClosed, true);
  assert.equal(contract.safety.changesAcceptedCoreModules, false);
  assert(markdown.includes('4.0-beta11-isolated-restore-rehearsal-2'));
  assert(markdown.includes('157f017d842a27aa85e53de51d2d80fe8facb5bd'));
  assert(markdown.includes('does not add a queue, executor, handler, trigger, table'));
});

test('package.json wires E2E immediately before the final restore suite', () => {
  assert.equal(
    packageJson.scripts['test:beta12-rollback-e2e'],
    'node tests/beta12_rollback_e2e_static.test.js'
  );
  const commands = packageJson.scripts.test
    .split(/\s*&&\s*/)
    .filter(Boolean);
  assert.equal(
    commands[commands.length - 2],
    'npm run test:beta12-rollback-e2e'
  );
  assert.equal(
    commands[commands.length - 1],
    'npm run test:beta11-restore-rehearsal'
  );
  assert.equal(
    commands.filter((command) =>
      command === 'npm run test:beta12-rollback-e2e').length,
    1
  );
  assert.equal(
    commands.filter((command) =>
      command === 'npm run test:beta11-restore-rehearsal').length,
    1
  );
});

test('accepted core files remain the data plane and facade is source-provenance protected', () => {
  assert(raw.includes("var LOAD_TYPE = 'RAW_LOAD_V4';"));
  assert(raw.includes("var REVERSAL_TYPE = 'RAW_REVERSAL_V4';"));
  assert(hardening.includes('function enqueueGuarded(operationType, input, options)'));
  assert(facade.includes('function sourceOperationProvenance_('));
  assert(facade.includes('sourceOperationFingerprint'));
  assert(restore.includes('isolated restore rehearsal'));
});

console.log(JSON.stringify({
  suite: 'beta12_rollback_e2e_static',
  total,
  passed: total - failed,
  failed
}, null, 2));

if (failed) process.exit(1);
