'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '43_Beta16OperatorFacade.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const contract = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'beta-1', 'BETA16_OPERATOR_FACADE_CONTRACT.json'),
  'utf8'
));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

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

function harness(nonTerminal) {
  const calls = { continued: [], status: [], printed: [] };
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
    AKORT: {
      Result: {
        success: (message, data) => ({
          ok: true, status: 'SUCCESS', message, data
        }),
        failure: (code, message, details) => ({
          ok: false, status: 'FAILED', code, message, details
        })
      },
      Beta14OperationalHardening: {
        status: () => ({
          ok: true,
          data: {
            operationInventory: {
              nonTerminalCount: nonTerminal.length,
              nonTerminal
            }
          }
        })
      },
      Beta16FullAuditRetention: {
        continueAudit: (operationId) => {
          calls.continued.push(operationId);
          return { ok: true, operationId };
        },
        status: (operationId) => {
          calls.status.push(operationId);
          return { ok: true, operationId: operationId || '' };
        }
      }
    },
    AKORT_printResult_: (result) => {
      calls.printed.push(result);
      return result;
    }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: sourcePath }).runInContext(context);
  return { context, calls };
}

test('source and contract pin the r4 operator facade', () => {
  new vm.Script(source, { filename: sourcePath });
  assert.strictEqual(contract.packageVersion, '4.0.0-beta.1.6.4');
  assert.strictEqual(contract.contractVersion, '4.0-beta16-operator-facade-1');
  assert(source.includes("var PACKAGE_VERSION = '4.0.0-beta.1.6.4';"));
});

test('facade reuses accepted hardening status and Beta.1.6 module', () => {
  assert(source.includes('AKORT.Beta14OperationalHardening.status()'));
  assert(source.includes('AKORT.Beta16FullAuditRetention.continueAudit('));
  assert(source.includes('AKORT.Beta16FullAuditRetention.status('));
  assert.strictEqual(contract.acceptedExecutor, 'AKORT.OperationEngine');
});

test('public operator functions require no arguments and print JSON', () => {
  assert(source.includes('function AKORT_beta16FullAuditContinueLatest()'));
  assert(source.includes('function AKORT_beta16FullAuditStatusLatest()'));
  assert((source.match(/AKORT_printResult_\(/g) || []).length >= 2);
  assert.strictEqual(contract.requiresOperationArgument, false);
});

test('one active Full Audit is resolved and continued exactly once', () => {
  const runtime = harness([{
    operation_id: 'OP_FULL_AUDIT_1',
    operation_type: 'FULL_AUDIT_V4',
    status: 'QUEUED',
    requested_at: '2026-08-05T09:59:36.000Z'
  }]);
  const result = runtime.context.AKORT.Beta16OperatorFacade.continueLatest();
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(runtime.calls.continued, ['OP_FULL_AUDIT_1']);
});

test('non-Full-Audit operations are ignored', () => {
  const runtime = harness([{
    operation_id: 'OP_OTHER',
    operation_type: 'OTHER_OPERATION',
    status: 'RUNNING',
    requested_at: '2026-08-05T10:00:00.000Z'
  }]);
  const result = runtime.context.AKORT.Beta16OperatorFacade.continueLatest();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA16_ACTIVE_AUDIT_NOT_FOUND');
  assert.deepStrictEqual(runtime.calls.continued, []);
});

test('multiple active Full Audits fail closed', () => {
  const runtime = harness([
    {
      operation_id: 'OP_A',
      operation_type: 'FULL_AUDIT_V4',
      status: 'QUEUED',
      requested_at: '2026-08-05T09:59:36.000Z'
    },
    {
      operation_id: 'OP_B',
      operation_type: 'FULL_AUDIT_V4',
      status: 'RUNNING',
      requested_at: '2026-08-05T10:00:00.000Z'
    }
  ]);
  const result = runtime.context.AKORT.Beta16OperatorFacade.continueLatest();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'BETA16_ACTIVE_AUDIT_AMBIGUOUS');
  assert.deepStrictEqual(runtime.calls.continued, []);
});

test('status uses active operation and falls back to latest evidence', () => {
  const active = harness([{
    operation_id: 'OP_ACTIVE',
    operation_type: 'FULL_AUDIT_V4',
    status: 'PAUSED',
    requested_at: '2026-08-05T09:59:36.000Z'
  }]);
  active.context.AKORT.Beta16OperatorFacade.statusLatest();
  assert.deepStrictEqual(active.calls.status, ['OP_ACTIVE']);

  const completed = harness([]);
  completed.context.AKORT.Beta16OperatorFacade.statusLatest();
  assert.deepStrictEqual(completed.calls.status, [undefined]);
});

test('facade contains no prohibited physical or scheduling APIs', () => {
  [
    'DriveApp.', 'SpreadsheetApp.', 'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger', 'setTrashed(', 'moveToTrash(',
    'deleteFile(', 'OperationEngine.enqueue('
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.physicalDeletion, false);
  assert.strictEqual(contract.driveEnumeration, false);
  assert.strictEqual(contract.productionWrite, false);
  assert.strictEqual(contract.enablesUserPipeline, false);
});

test('facade suite is wired into full regression', () => {
  assert.strictEqual(
    pkg.scripts['test:beta16-operator-facade'],
    'node tests/beta16_operator_facade_static.test.js'
  );
  assert(pkg.scripts.test.includes('npm run test:beta16-operator-facade'));
});

console.log(JSON.stringify({
  suite: 'beta16_operator_facade_static',
  packageVersion: contract.packageVersion,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
