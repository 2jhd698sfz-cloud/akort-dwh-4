'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '47_Beta22UserLoadWorkflow.js');
const htmlPath = path.join(root, 'src', 'Beta21ControlCenter.html');
const contractPath = path.join(root, 'docs', 'beta-2', 'BETA22_USER_LOAD_WORKFLOW_CONTRACT.json');
const reusePath = path.join(root, 'docs', 'beta-2', 'BETA22_REUSE_MATRIX.md');
const acceptancePath = path.join(root, 'docs', 'beta-2', 'BETA22_ACCEPTANCE_MATRIX.md');
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const reuse = fs.readFileSync(reusePath, 'utf8');
const acceptance = fs.readFileSync(acceptancePath, 'utf8');
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

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function iterator(items) {
  let index = 0;
  return {
    hasNext() { return index < items.length; },
    next() { return items[index++]; }
  };
}

function acknowledgmentFor(confirmation, overrides) {
  const binding = confirmation && confirmation.binding || {};
  return Object.assign({
    acknowledged: true,
    fileId: binding.fileId,
    fileName: binding.fileName
  }, overrides || {});
}

function createContext() {
  const propertyValues = {
    AKORT_BETA22_INCOMING_FOLDER_ID: 'INBOX',
    AKORT_BETA22_CONFIRMATION_SECRET: 'server-secret',
    AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED: 'FALSE'
  };
  let folderItems = [];
  const folder = {
    getId() { return 'INBOX'; },
    getName() { return 'DEV Incoming'; },
    getFiles() { return iterator(folderItems); }
  };
  const file = {
    getId() { return 'FILE_1'; },
    getName() { return 'weekly-2026-W31.xlsx'; },
    getMimeType() { return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; },
    getSize() { return 12345; },
    getLastUpdated() { return new Date('2026-08-06T01:00:00.000Z'); },
    getParents() { return iterator([folder]); }
  };
  folderItems = [file];
  const calls = { enqueue: 0, resume: 0, parserPreview: 0, parserInspect: 0, operationRun: 0 };
  const workflowOptions = { profileId: 'AKORT_WEEKLY_WIDE', year: '2026', week: '31' };
  const workflowKey = 'BETA22|' + crypto.createHash('sha256').update(canonical({
    operationType: 'SOURCE_FILE_LOAD_V4',
    fileId: 'FILE_1',
    sourceHash: 'HASH_1',
    profileId: 'AKORT_WEEKLY_WIDE',
    options: workflowOptions
  })).digest('hex');
  const operation = {
    operation_id: 'OP_1',
    operation_type: 'SOURCE_FILE_LOAD_V4',
    status: 'QUEUED',
    current_phase: 'DISCOVER',
    attempt_no: 0,
    max_attempts: 3,
    requested_at: '2026-08-06T01:01:00.000Z',
    checkpoint: {
      completedPhases: [],
      handlerState: {},
      input: {
        fileId: 'FILE_1',
        sourceId: 'FILE_1',
        profileId: 'AKORT_WEEKLY_WIDE',
        year: '2026',
        week: '31',
        beta22Binding: {
          schemaVersion: '4.0-beta22-operation-binding-1',
          userEmail: 'owner@example.com',
          fileId: 'FILE_1',
          sourceHash: 'HASH_1',
          structuralFingerprint: 'STRUCT_1',
          profileId: 'AKORT_WEEKLY_WIDE',
          targetTable: 'RAW_PRICES_WEEKLY',
          normalizedRowCount: 2,
          options: workflowOptions,
          confirmationFingerprint: 'CONFIRMATION_HASH'
        }
      },
      meta: { idempotencyKey: workflowKey }
    }
  };
  let operationSteps = [];
  let previewSourceHash = 'HASH_1';
  let previewStructuralFingerprint = 'STRUCT_1';
  let previewNormalizedRowCount = 2;
  let industryStatusResult = { ok: true, status: 'SUCCESS', data: { ready: true } };
  let industryValidateResult = { ok: true, status: 'SUCCESS', data: { valid: true } };
  let industrySubmitResult = { ok: true, status: 'SUCCESS', data: { operationId: 'INDUSTRY_OP' } };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    isNaN,
    encodeURIComponent,
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature(value, key) {
        return Array.from(
          crypto.createHmac('sha256', String(key))
            .update(String(value))
            .digest()
        );
      }
    },
    globalThis: null,
    AKORT_printResult_(value) { return value; },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) { return propertyValues[name] || ''; },
          setProperty(name, value) { propertyValues[name] = String(value); }
        };
      }
    },
    DriveApp: {
      getFolderById(id) {
        if (id !== 'INBOX') throw new Error('folder missing');
        return folder;
      },
      getFileById(id) {
        if (id !== 'FILE_1') throw new Error('file missing');
        return file;
      }
    },
    AKORT: {
      Release: { version: '4.0.0-alpha.7.4.42' },
      EnvironmentGuard: { assertDev() { return true; } },
      Result: {
        success(message, data) { return { ok: true, status: 'SUCCESS', message, data }; },
        failure(code, message, data) { return { ok: false, status: 'FAILED', code, message, data }; }
      },
      Core: {
        error(code, message, details) {
          const error = new Error(message);
          error.code = code;
          error.details = details || null;
          return error;
        },
        safeRun(component, fn) {
          try { return fn(); }
          catch (error) {
            return {
              ok: false,
              status: 'FAILED',
              code: error.code || 'ERROR',
              message: error.message,
              details: error.details || null
            };
          }
        },
        canonicalJson(value) { return canonical(value); },
        sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
      },
      Config: {
        readSystemSettings() { return { PUBLISH_USER_PIPELINE_ENABLED: false }; }
      },
      Beta21ReadOnlyControlCenter: {
        Test: {
          accessStatus() {
            return { authorized: true, email: 'owner@example.com', mode: 'SCRIPT_PROPERTY_ALLOWLIST' };
          }
        }
      },
      ExistingSourceParsers: {
        OperationType: 'SOURCE_FILE_LOAD_V4',
        inspectFile(fileId) {
          calls.parserInspect += 1;
          return {
            fileId,
            fileName: file.getName(),
            sourceHash: previewSourceHash,
            structuralFingerprint: previewStructuralFingerprint,
            profile: { profileId: 'AKORT_WEEKLY_WIDE', targetTable: 'RAW_PRICES_WEEKLY' },
            resolvedOptions: { year: '2026', week: '31' },
            structure: { ok: true }
          };
        },
        previewFile(fileId) {
          calls.parserPreview += 1;
          return {
            ok: true,
            status: 'SUCCESS',
            data: {
              fileId,
              fileName: file.getName(),
              sourceHash: previewSourceHash,
              structuralFingerprint: previewStructuralFingerprint,
              profile: { profileId: 'AKORT_WEEKLY_WIDE', targetTable: 'RAW_PRICES_WEEKLY' },
              confidence: { score: 100, margin: 100 },
              resolvedOptions: { year: '2026', week: '31' },
              sourceObservationCount: previewNormalizedRowCount,
              normalizedRowCount: previewNormalizedRowCount,
              monitoringScope: {},
              issues: [],
              sampleRows: [{ value: 1 }, { value: 2 }]
            }
          };
        }
      },
      Beta14OperationalHardening: {
        enqueueGuarded(operationType, input, options) {
          calls.enqueue += 1;
          assert.strictEqual(operationType, 'SOURCE_FILE_LOAD_V4');
          assert.strictEqual(input.fileId, 'FILE_1');
          assert(options.idempotencyKey.startsWith('BETA22|'));
          operation.checkpoint.input = input;
          operation.checkpoint.meta = { idempotencyKey: options.idempotencyKey };
          return { ok: true, status: 'SUCCESS', data: { operationId: 'OP_1', reused: false, operation } };
        }
      },
      OperationEngine: {
        status(id) {
          assert.strictEqual(id, 'OP_1');
          return { ok: true, status: 'SUCCESS', data: { operationId: id, operation, steps: operationSteps, stepCount: operationSteps.length } };
        },
        resume(id, options) {
          calls.resume += 1;
          assert.strictEqual(id, 'OP_1');
          assert.strictEqual(options.maxSteps, 1);
          const resumed = Object.assign({}, operation, { status: 'RUNNING', current_phase: 'VALIDATE' });
          operation.status = resumed.status;
          operation.current_phase = resumed.current_phase;
          return { ok: true, status: 'SUCCESS', data: { operationId: id, operation, steps: operationSteps, stepCount: operationSteps.length } };
        },
        run() { calls.operationRun += 1; throw new Error('must not run in submit'); }
      },
      IndustryInput: {
        status() { return industryStatusResult; },
        validate() { return industryValidateResult; },
        submit() { return industrySubmitResult; }
      }
    }
  };
  context.globalThis = context;
  return {
    context, propertyValues, calls, operation, file, folder,
    setFolderItems(items) { folderItems = items.slice(); },
    setOperationSteps(items) { operationSteps = items.slice(); },
    setPreviewIdentity(values) {
      values = values || {};
      if (Object.prototype.hasOwnProperty.call(values, 'sourceHash')) previewSourceHash = values.sourceHash;
      if (Object.prototype.hasOwnProperty.call(values, 'structuralFingerprint')) previewStructuralFingerprint = values.structuralFingerprint;
      if (Object.prototype.hasOwnProperty.call(values, 'normalizedRowCount')) previewNormalizedRowCount = values.normalizedRowCount;
    },
    setIndustryStatusResult(value) { industryStatusResult = value; },
    setIndustryValidateResult(value) { industryValidateResult = value; },
    setIndustrySubmitResult(value) { industrySubmitResult = value; }
  };
}

test('metadata pins accepted Beta.2.1 handoff', () => {
  assert(source.includes("var PACKAGE_VERSION = '4.0.0-beta.2.2.4';"));
  assert(source.includes("var CONTRACT_VERSION = '4.0-beta22-user-load-workflow-4';"));
  assert(source.includes("var BASE_COMMIT = '1512fbfd99769d208efc141154fbc0fb42a4f650';"));
  assert.strictEqual(contract.baseCommit, '1512fbfd99769d208efc141154fbc0fb42a4f650');
});

test('server and client syntax are valid', () => {
  new vm.Script(source, { filename: sourcePath });
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(script, 'inline client script');
  new vm.Script(script[1], { filename: htmlPath });
});

test('REUSE matrix covers accepted loading paths', () => {
  ['SOURCE_FILE_LOAD_V4', 'RAW_LOAD_V4', 'AKORT.ExistingSourceParsers.previewFile', 'AKORT.IndustryInput.submit', 'REUSE-FIRST / GAP-ONLY']
    .forEach((token) => assert(reuse.includes(token), token));
  assert(acceptance.includes('No duplicate backend'));
});

test('candidate reuses accepted parser, guard and operation APIs', () => {
  [
    'AKORT.ExistingSourceParsers.inspectFile',
    'AKORT.ExistingSourceParsers.previewFile',
    'AKORT.Beta14OperationalHardening.enqueueGuarded',
    'AKORT.OperationEngine.status',
    'AKORT.OperationEngine.resume',
    'AKORT.IndustryInput.status',
    'AKORT.IndustryInput.validate',
    'AKORT.IndustryInput.submit'
  ].forEach((token) => assert(source.includes(token), token));
});

test('candidate has no second parser, queue, executor or direct data write', () => {
  [
    'OperationEngine.enqueue(',
    'OperationEngine.run(',
    '.setValue(',
    '.setValues(',
    '.appendRow(',
    '.insertRows',
    '.deleteRows',
    'DriveApp.create',
    'makeCopy(',
    'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger'
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.safety.newOperationType, false);
  assert.strictEqual(contract.safety.newQueue, false);
  assert.strictEqual(contract.safety.newExecutor, false);
  assert.strictEqual(contract.safety.newDispatcher, false);
  assert.strictEqual(contract.safety.newParser, false);
});

test('incoming discovery is bounded by both returned and scanned files', () => {
  assert(source.includes('MAX_INCOMING_FILES = 50'));
  assert(source.includes('MAX_INCOMING_SCAN = 200'));
  assert(source.includes('scanned < MAX_INCOMING_SCAN'));
  assert(source.includes('directParentMatches_'));
  assert(source.includes('BETA22_FILE_OUTSIDE_INCOMING_FOLDER'));
  assert(!source.includes('getFoldersByName'));
  assert.strictEqual(contract.boundedness.directChildrenOnly, true);
  assert.strictEqual(contract.boundedness.maximumIncomingFiles, 50);
  assert.strictEqual(contract.boundedness.maximumIncomingScan, 200);
  assert.strictEqual(contract.boundedness.recursiveDiscovery, false);
  assert.strictEqual(contract.boundedness.movesFiles, false);
});

test('operation status and Continue require exact Beta.2.2 user binding', () => {
  [
    'OPERATION_BINDING_SCHEMA',
    'beta22Binding',
    'BETA22_OPERATION_BINDING_NOT_ALLOWED',
    'idempotencyKey !== expectedKey',
    'MAX_OPERATION_STEP_SUMMARIES = 12',
    'BETA22_OPERATION_SOURCE_CHANGED',
    'SOURCE_RECHECK_PHASES'
  ].forEach((token) => assert(source.includes(token), token));
  assert.strictEqual(contract.operationBinding.bindsAuthorizedUser, true);
  assert.strictEqual(contract.operationBinding.arbitrarySourceFileOperationIdsAllowed, false);
  assert.strictEqual(contract.boundedness.maximumOperationStepSummaries, 12);
});

test('fresh HMAC confirmation, acknowledgment and mandatory re-preview are present', () => {
  [
    'CONFIRMATION_TTL_MS = 10 * 60 * 1000',
    'Utilities.computeHmacSha256Signature',
    'confirmationSignature_',
    'assertConfirmation_',
    'assertAcknowledgment_',
    'BETA22_USER_CONFIRMATION_REQUIRED',
    'assertPreviewUnchanged_',
    'REPEAT_PREVIEW'
  ].forEach((token) => assert(source.includes(token), token));
  assert.strictEqual(contract.confirmation.ttlMs, 600000);
  assert.strictEqual(
    contract.confirmation.mode,
    'STATELESS_SERVER_HMAC_SIGNED_REPREVIEW_REQUIRED'
  );
  assert.strictEqual(
    contract.confirmation.explicitServerAcknowledgmentRequired,
    true
  );
});

test('submit is gated and does not execute full load inside UI request', () => {
  assert(source.includes("'BETA22_SUBMIT_DISABLED'"));
  assert(source.includes('executionStartedInsideUiCall: false'));
  assert(!source.includes('OperationEngine.run('));
  assert.strictEqual(contract.boundedness.runsFullLoadInsideUiCall, false);
});

test('Industry delegates preserve accepted result envelopes and have no controlled bypass', () => {
  assert(source.includes("'BETA22_INDUSTRY_SUBMIT_REQUIRES_GENERAL_PIPELINE'"));
  assert(source.includes('delegateAcceptedResult_'));
  assert(source.includes('AKORT.IndustryInput.submit()'));
  assert.strictEqual(contract.safety.industryBypass, false);
  assert.strictEqual(contract.industry.resultEnvelopePreserved, true);
  assert.strictEqual(contract.industry.validateWritesExistingFormStatusCells, true);
});

test('Control Center UI exposes load workflow and remains safe by construction', () => {
  [
    'Загрузка данных',
    'AKORT_beta22ListIncomingFiles',
    'AKORT_beta22PreviewFile',
    'AKORT_beta22SubmitFile',
    'AKORT_beta22OperationStatus',
    'AKORT_beta22ContinueOperation',
    'AKORT_beta22IndustryValidate',
    'invalidatePreview',
    'previewRequestSequence',
    'currentPreviewContextKey',
    'responseIsCurrent',
    'requestSequence === state.previewRequestSequence',
    "['optYear','optMonth','optWeek']"
  ].forEach((token) => assert(html.includes(token), token));
  assert(html.includes('textContent'));
  assert(!html.includes('innerHTML'));
  assert(!html.includes('eval('));
  assert(!html.includes('<script src='));
});

test('accepted parser temporary conversion is disclosed without claiming source or RAW writes', () => {
  assert.strictEqual(
    contract.boundedness.temporaryDriveConversionOwnedByAcceptedParser,
    true
  );
  assert.strictEqual(contract.boundedness.sourceFileMutation, false);
  assert.strictEqual(contract.safety.beta22OwnedDriveCopy, false);
  assert.strictEqual(contract.safety.acceptedParserTemporaryDriveCopy, true);
  assert.strictEqual(contract.safety.previewRawWrites, 0);
  assert.strictEqual(contract.safety.previewPublishWrites, 0);
  assert(reuse.includes('temporary converted Google Sheet'));
  assert(acceptance.includes('Temporary conversion boundary'));
  assert(html.includes('временную'));
  assert(html.includes('переместить её в корзину'));
});

test('public API is fixed by contract', () => {
  const names = [
    'AKORT_beta22Contract',
    'AKORT_beta22Preflight',
    'AKORT_beta22ListIncomingFiles',
    'AKORT_beta22InspectFile',
    'AKORT_beta22PreviewFile',
    'AKORT_beta22SubmitFile',
    'AKORT_beta22OperationStatus',
    'AKORT_beta22ContinueOperation',
    'AKORT_beta22IndustryStatus',
    'AKORT_beta22IndustryValidate',
    'AKORT_beta22IndustrySubmit'
  ];
  names.forEach((name) => assert(source.includes('function ' + name), name));
  assert.deepStrictEqual(contract.acceptedOperationTypes, ['SOURCE_FILE_LOAD_V4', 'RAW_LOAD_V4']);
});

test('package wiring adds focused suite to full regression', () => {
  assert.strictEqual(pkg.scripts['test:beta22-user-load-workflow'], 'node tests/beta22_user_load_workflow_static.test.js');
  assert(pkg.scripts.test.includes('npm run test:beta22-user-load-workflow'));
});

test('dynamic read-only list and preview produce a signed confirmation', () => {
  const { context, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const listed = context.AKORT.Beta22UserLoadWorkflow.listIncomingFiles();
  assert.strictEqual(listed.ok, true);
  assert.strictEqual(listed.data.fileCount, 1);
  const previewed = context.AKORT.Beta22UserLoadWorkflow.previewFile('FILE_1', {});
  assert.strictEqual(previewed.ok, true);
  assert.strictEqual(previewed.data.preview.ready, true);
  assert(previewed.data.confirmation.signature);
  assert.strictEqual(calls.parserPreview, 1);
  assert.strictEqual(calls.enqueue, 0);
});

test('dynamic incoming listing stops after the frozen scan ceiling', () => {
  const runtime = createContext();
  const unsupported = Array.from({ length: 250 }, (_, index) => ({
    getId() { return 'UNSUPPORTED_' + index; },
    getName() { return 'unsupported-' + index + '.txt'; },
    getMimeType() { return 'text/plain'; },
    getSize() { return 1; },
    getLastUpdated() { return new Date('2026-08-06T01:00:00.000Z'); },
    getParents() { return iterator([runtime.folder]); }
  }));
  runtime.setFolderItems(unsupported);
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.listIncomingFiles();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.scannedCount, 200);
  assert.strictEqual(result.data.fileCount, 0);
  assert.strictEqual(result.data.truncated, true);
});

test('dynamic incoming listing returns the latest fifty from the bounded scan window', () => {
  const runtime = createContext();
  const supported = Array.from({ length: 75 }, (_, index) => ({
    getId() { return 'SUPPORTED_' + index; },
    getName() { return 'supported-' + index + '.xlsx'; },
    getMimeType() { return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; },
    getSize() { return 1; },
    getLastUpdated() { return new Date(Date.UTC(2026, 0, 1, 0, index, 0)); },
    getParents() { return iterator([runtime.folder]); }
  }));
  runtime.setFolderItems(supported);
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.listIncomingFiles();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.scannedCount, 75);
  assert.strictEqual(result.data.supportedMatchCount, 75);
  assert.strictEqual(result.data.fileCount, 50);
  assert.strictEqual(result.data.files[0].fileId, 'SUPPORTED_74');
  assert.strictEqual(result.data.truncated, true);
});

test('dynamic operation access rejects a foreign or legacy source-file operation', () => {
  const runtime = createContext();
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  runtime.operation.checkpoint.input.beta22Binding.userEmail = 'other@example.com';
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.operationStatus('OP_1');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA22_OPERATION_BINDING_NOT_ALLOWED');
});

test('dynamic operation DTO returns only the frozen step-summary tail', () => {
  const runtime = createContext();
  runtime.setOperationSteps(Array.from({ length: 20 }, (_, index) => ({
    step_id: 'STEP_' + index, phase: 'PHASE_' + index, status: 'SUCCESS',
    attempt_no: index, started_at: 'S', finished_at: 'F',
    checkpoint_json: 'LARGE', result_json: 'LARGE'
  })));
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.operationStatus('OP_1');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.operation.stepCount, 20);
  assert.strictEqual(result.data.operation.displayedStepCount, 12);
  assert.strictEqual(result.data.operation.stepsTruncated, true);
  assert.strictEqual(result.data.operation.steps[0].stepId, 'STEP_8');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result.data.operation.steps[0], 'checkpoint_json'), false);
});

test('dynamic submit fails closed by default', () => {
  const { context, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const previewed = context.AKORT.Beta22UserLoadWorkflow.previewFile('FILE_1', {});
  const submitted = context.AKORT.Beta22UserLoadWorkflow.submitFile(previewed.data.confirmation);
  assert.strictEqual(submitted.ok, false);
  assert.strictEqual(submitted.code, 'BETA22_SUBMIT_DISABLED');
  assert.strictEqual(calls.enqueue, 0);
  assert.strictEqual(calls.operationRun, 0);
});

test('dynamic controlled submit rejects missing server acknowledgment', () => {
  const { context, propertyValues, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const previewed =
    context.AKORT.Beta22UserLoadWorkflow.previewFile('FILE_1', {});
  propertyValues.AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED = 'TRUE';
  const submitted =
    context.AKORT.Beta22UserLoadWorkflow.submitFile(
      previewed.data.confirmation
    );
  assert.strictEqual(submitted.ok, false);
  assert.strictEqual(
    submitted.code,
    'BETA22_USER_CONFIRMATION_REQUIRED'
  );
  assert.strictEqual(calls.enqueue, 0);
});

test('dynamic controlled submit rejects mismatched exact file acknowledgment', () => {
  const { context, propertyValues, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const previewed =
    context.AKORT.Beta22UserLoadWorkflow.previewFile('FILE_1', {});
  propertyValues.AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED = 'TRUE';
  const submitted =
    context.AKORT.Beta22UserLoadWorkflow.submitFile(
      previewed.data.confirmation,
      acknowledgmentFor(
        previewed.data.confirmation,
        { fileName: 'another-file.xlsx' }
      )
    );
  assert.strictEqual(submitted.ok, false);
  assert.strictEqual(
    submitted.code,
    'BETA22_USER_CONFIRMATION_REQUIRED'
  );
  assert.strictEqual(calls.enqueue, 0);
});

test('dynamic controlled submit re-previews and guarded-enqueues accepted operation only', () => {
  const { context, propertyValues, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const previewed = context.AKORT.Beta22UserLoadWorkflow.previewFile('FILE_1', {});
  propertyValues.AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED = 'TRUE';
  const submitted = context.AKORT.Beta22UserLoadWorkflow.submitFile(
    previewed.data.confirmation,
    acknowledgmentFor(previewed.data.confirmation)
  );
  assert.strictEqual(submitted.ok, true);
  assert.strictEqual(submitted.data.operationId, 'OP_1');
  assert.strictEqual(submitted.data.operationTypeReused, 'SOURCE_FILE_LOAD_V4');
  assert.strictEqual(calls.parserPreview, 2);
  assert.strictEqual(calls.enqueue, 1);
  assert.strictEqual(calls.operationRun, 0);
});

test('dynamic status and Continue use accepted Operation Engine and one bounded step', () => {
  const { context, propertyValues, calls } = createContext();
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const status = context.AKORT.Beta22UserLoadWorkflow.operationStatus('OP_1');
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.data.operation.operationType, 'SOURCE_FILE_LOAD_V4');
  propertyValues.AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED = 'TRUE';
  const continued = context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(continued.ok, true);
  assert.strictEqual(continued.data.sourceRecheck.checked, true);
  assert.strictEqual(calls.parserPreview, 1);
  assert.strictEqual(calls.resume, 1);
});


test('dynamic Continue rejects running and terminal operations', () => {
  const runtime = createContext();
  runtime.propertyValues = runtime.propertyValues || null;
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  runtime.operation.status = 'RUNNING';
  let result = runtime.context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA22_SUBMIT_DISABLED');
  runtime.context.PropertiesService.getScriptProperties().setProperty('AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED', 'TRUE');
  result = runtime.context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA22_OPERATION_CONTINUE_NOT_ALLOWED');
  runtime.operation.status = 'SUCCESS';
  result = runtime.context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA22_OPERATION_CONTINUE_NOT_ALLOWED');
});


test('dynamic Continue rejects a changed source before parser materialization', () => {
  const runtime = createContext();
  runtime.context.PropertiesService.getScriptProperties().setProperty('AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED', 'TRUE');
  runtime.setPreviewIdentity({ sourceHash: 'HASH_CHANGED' });
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA22_OPERATION_SOURCE_CHANGED');
  assert.strictEqual(runtime.calls.parserPreview, 1);
  assert.strictEqual(runtime.calls.resume, 0);
});

test('dynamic Continue skips source re-preview after parser materialization', () => {
  const runtime = createContext();
  runtime.context.PropertiesService.getScriptProperties().setProperty('AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED', 'TRUE');
  runtime.operation.current_phase = 'STAGE';
  runtime.operation.checkpoint.nextPhase = 'STAGE';
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.continueOperation('OP_1');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.sourceRecheck.checked, false);
  assert.strictEqual(result.data.sourceRecheck.reason, 'SOURCE_ALREADY_MATERIALIZED');
  assert.strictEqual(runtime.calls.parserPreview, 0);
  assert.strictEqual(runtime.calls.resume, 1);
});

test('dynamic Industry validation preserves an accepted failure envelope', () => {
  const runtime = createContext();
  runtime.setIndustryValidateResult({
    ok: false,
    status: 'FAILED',
    code: 'INDUSTRY_INPUT_VALIDATION_FAILED',
    message: 'Form contains errors.',
    details: { rawWrites: 0, publishWrites: 0 }
  });
  vm.runInNewContext(source, runtime.context, { filename: sourcePath });
  const result = runtime.context.AKORT.Beta22UserLoadWorkflow.industryValidate();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'INDUSTRY_INPUT_VALIDATION_FAILED');
  assert.strictEqual(result.details.rawWrites, 0);
});

test('candidate documents re-preview, async fencing and Industry form-write semantics', () => {
  assert.deepStrictEqual(
    contract.operationBinding.sourceRecheckPhases,
    ['DISCOVER', 'VALIDATE', 'PARSE']
  );
  assert.strictEqual(
    contract.operationBinding.repreviewBeforeContinue,
    true
  );
  assert.strictEqual(
    contract.operationBinding.inFlightPreviewContextFenced,
    true
  );
  assert.strictEqual(
    contract.industry.validateWritesExistingFormStatusCells,
    true
  );
  assert(acceptance.includes('Async preview fencing'));
  assert(reuse.includes('stale/out-of-order response ignored'));
});

console.log(JSON.stringify({ total, passed: total - failed, failed }));
if (failed) process.exit(1);
