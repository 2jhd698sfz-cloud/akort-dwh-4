const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const source = fs.readFileSync(
  'src/36_Beta13FailureInjection.js',
  'utf8'
);
const engine = fs.readFileSync(
  'src/03_OperationEngine.js',
  'utf8'
);
const handler = fs.readFileSync(
  'src/04_TestOperationHandlers.js',
  'utf8'
);
const beta12 = fs.readFileSync(
  'src/35_Beta12RollbackFacade.js',
  'utf8'
);
const contract = JSON.parse(fs.readFileSync(
  'docs/beta-1/BETA13_FAILURE_INJECTION_CONTRACT.json',
  'utf8'
));
const packageJson = JSON.parse(fs.readFileSync(
  'package.json',
  'utf8'
));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS', name);
  } catch (error) {
    failed += 1;
    console.error('FAIL', name);
    console.error(error && error.stack || error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function sha256(text) {
  return crypto.createHash('sha256')
    .update(String(text))
    .digest('hex');
}

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  return '{' + Object.keys(value).sort().map(
    (key) => JSON.stringify(key) + ':' + canonical(value[key])
  ).join(',') + '}';
}

const sandbox = {
  AKORT: {
    Core: {
      error(code, message, details) {
        const error = new Error(message);
        error.code = code;
        error.details = details || {};
        return error;
      },
      sha256,
      canonicalJson: canonical,
      safeRun(code, fn) {
        return fn({
          executionId: 'EXE_TEST',
          logger: {
            info() {},
            warn() {},
            error() {}
          }
        });
      },
      now() {
        return '2026-08-05T00:00:00.000Z';
      },
      Sheets: {
        readObjects() {
          return [];
        }
      }
    },
    Result: {
      success(message, data) {
        return { ok: true, status: 'SUCCESS', message, data };
      },
      failure(code, message, data) {
        return { ok: false, status: 'FAILURE', code, message, data };
      },
      paused(message, data) {
        return { ok: true, status: 'PAUSED', message, data };
      }
    },
    Config: {
      load() {
        return {
          resources: {
            dwhSpreadsheetId: 'DWH',
            publishSpreadsheetId: 'PUBLISH'
          }
        };
      },
      readSystemSettings() {
        return {
          OPERATION_TEST_MODE: true,
          PUBLISH_USER_PIPELINE_ENABLED: false
        };
      }
    },
    EnvironmentGuard: {
      assertDev() {
        return true;
      }
    },
    OperationEngine: {}
  },
  console
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const facade = sandbox.AKORT.Beta13FailureInjection;

test('source is syntax-valid and pins the overlay contract', () => {
  new Function(source);
  assert(source.includes(
    "var PACKAGE_VERSION = '4.0.0-beta.1.3.1';"
  ));
  assert(source.includes(
    "var CONTRACT_VERSION = '4.0-beta13-failure-injection-1';"
  ));
  assert(source.includes(
    "var BASE_RELEASE = '4.0.0-alpha.7.4.42';"
  ));
  assert(!source.includes('__BASE_COMMIT__'));
});

test('runtime package version remains the accepted Alpha.7.4 release', () => {
  assert(packageJson.version === '4.0.0-alpha.7.4.42');
  assert(beta12.includes(
    "var PACKAGE_VERSION = '4.0.0-beta.1.2.5';"
  ));
});

test('Operation Engine exposes the reused execution APIs', () => {
  [
    'enqueue: enqueue',
    'run: run',
    'resume: resume',
    'recoverFailedPhase: recoverFailedPhase',
    'requestStop: requestStop',
    'status: status'
  ].forEach((marker) => {
    assert(engine.includes(marker), marker);
  });
});

test('Operation Engine routes ALPHA3 test types to the accepted handler', () => {
  assert(engine.includes("type.indexOf('ALPHA3_TEST_') === 0"));
  assert(engine.includes('AKORT.TestOperationHandlers'));
  assert(engine.includes('.execute(phase'));
});

test('accepted test handler has retryable, fatal and pause semantics', () => {
  assert(handler.includes("test.failMode === 'RETRYABLE'"));
  assert(handler.includes("'TEST_RETRYABLE_ERROR'"));
  assert(handler.includes("'TEST_FATAL_ERROR'"));
  assert(handler.includes('result.pause = true'));
  assert(handler.includes('noDataMutation: true'));
});

test('all five scenarios are exact and bounded', () => {
  const scenarios = facade.Scenarios;
  assert(Object.keys(scenarios).length === 5);
  assert(
    scenarios.RETRYABLE_ONCE.test.failPhase === 'VALIDATE'
  );
  assert(
    scenarios.RETRYABLE_ONCE.test.failMode === 'RETRYABLE'
  );
  assert(
    scenarios.FATAL_RECOVERY.test.failPhase === 'PARSE'
  );
  assert(
    scenarios.FATAL_RECOVERY.firstStatus === 'FAILED'
  );
  assert(
    scenarios.HANDLER_PAUSE.test.pauseAfterPhase === 'STAGE'
  );
  assert(scenarios.SAFE_STOP.preRunStop === true);
  assert(scenarios.DEAD_LETTER.maxAttempts === 2);
  assert(
    scenarios.DEAD_LETTER.terminalStatus === 'DEAD_LETTER'
  );
});

test('scenario names fail closed', () => {
  assert(
    facade.Test.normalizeScenario('retryable-once') ===
      'RETRYABLE_ONCE'
  );
  let caught = null;
  try {
    facade.Test.normalizeScenario('unknown');
  } catch (error) {
    caught = error;
  }
  assert(caught && caught.code === 'BETA13_SCENARIO_UNSUPPORTED');
});

test('confirmation token is deterministic and sentinel-bound', () => {
  const definition = facade.Test.scenario('RETRYABLE_ONCE');
  const first = facade.Test.binding(definition, {
    fingerprint: 'AAA'
  });
  const second = facade.Test.binding(definition, {
    fingerprint: 'BBB'
  });
  assert(facade.Test.token(first) === facade.Test.token(first));
  assert(facade.Test.token(first) !== facade.Test.token(second));
});

test('sentinel comparison identifies unchanged and changed sheets', () => {
  const base = {
    fingerprint: 'ROOT_A',
    resources: [{
      resourceCode: 'DWH',
      sheets: [{
        sheetName: 'RAW_PRICES_WEEKLY',
        fingerprint: 'SHEET_A',
        lastRow: 10
      }]
    }]
  };
  const same = JSON.parse(JSON.stringify(base));
  const unchanged = facade.Test.compareSentinels(base, same);
  assert(unchanged.unchanged === true);
  same.resources[0].sheets[0].fingerprint = 'SHEET_B';
  same.fingerprint = 'ROOT_B';
  const changed = facade.Test.compareSentinels(base, same);
  assert(changed.unchanged === false);
  assert(changed.changes.length === 1);
});

test('next-action logic is scenario-specific', () => {
  const fatal = facade.Test.scenario('FATAL_RECOVERY');
  const retry = facade.Test.scenario('RETRYABLE_ONCE');
  assert(
    facade.Test.nextAction(fatal, 'FAILED') ===
      'EXACT_FAILED_PHASE_RECOVERY'
  );
  assert(
    facade.Test.nextAction(retry, 'RETRY_PENDING') ===
      'CONTINUE'
  );
  assert(
    facade.Test.nextAction(retry, 'SUCCESS') === 'NONE'
  );
});

test('facade does not contain data-plane write APIs', () => {
  [
    '.setValues(',
    '.setValue(',
    '.appendRow(',
    '.deleteRow(',
    '.insertSheet(',
    'DriveApp.',
    'ScriptApp.newTrigger',
    'AKORT.RawStore.',
    'AKORT.IncrementalPublish.',
    'AKORT.AggregateIntegration.'
  ].forEach((marker) => {
    assert(!source.includes(marker), marker);
  });
});

test('allowed writes are limited to existing control-plane APIs', () => {
  assert(source.includes('AKORT.OperationEngine.enqueue'));
  assert(source.includes('AKORT.OperationEngine.run'));
  assert(source.includes('AKORT.OperationEngine.resume'));
  assert(source.includes(
    'AKORT.OperationEngine.recoverFailedPhase'
  ));
  assert(source.includes(
    'AKORT.OperationEngine.requestStop'
  ));
  assert(source.includes(
    'PropertiesService.getScriptProperties()'
  ));
});

test('safety guards require DEV test mode and disabled user pipeline', () => {
  assert(source.includes('AKORT.EnvironmentGuard.assertDev()'));
  assert(source.includes('OPERATION_TEST_MODE'));
  assert(source.includes('PUBLISH_USER_PIPELINE_ENABLED'));
  assert(source.includes('BETA13_OTHER_ACTIVE_OPERATION'));
});

test('data sentinel covers RAW, reversal, aggregate and Publish sheets', () => {
  [
    'RAW_PRICES_WEEKLY',
    'RAW_PRICES_MONTHLY',
    'RAW_INDUSTRY',
    'RAW_LOAD_REGISTRY',
    'RAW_REVERSAL_LOG',
    'AGGREGATE_STAGE',
    'PUBLISH_PRICES_WEEKLY',
    'PUBLISH_PRICES_MONTHLY',
    'PUBLISH_INDUSTRY',
    'PUBLISH_PRICE_AGGREGATES'
  ].forEach((sheet) => {
    assert(source.includes("'" + sheet + "'"), sheet);
  });
});

test('exact fatal recovery is fully constrained', () => {
  assert(source.includes(
    'AKORT.OperationEngine.recoverFailedPhase'
  ));
  assert(source.includes("phase: 'PARSE'"));
  assert(source.includes("errorCode: 'TEST_FATAL_ERROR'"));
  assert(source.includes("status: 'FAILED'"));
});

test('manual wrappers exist for every scenario lifecycle', () => {
  [
    'RetryableOnce',
    'FatalRecovery',
    'HandlerPause',
    'SafeStop',
    'DeadLetter'
  ].forEach((name) => {
    ['Preview', 'Start', 'Continue', 'Status'].forEach(
      (action) => {
        assert(source.includes(
          'function AKORT_beta13' + action + name + '()'
        ));
      }
    );
  });
});

test('contract documents reuse and no data mutation', () => {
  assert(contract.packageVersion === '4.0.0-beta.1.3.1');
  assert(
    contract.contractVersion ===
      '4.0-beta13-failure-injection-1'
  );
  assert(contract.reuse.newQueue === false);
  assert(contract.reuse.newExecutor === false);
  assert(contract.reuse.operationEngineModified === false);
  assert(contract.reuse.testHandlerModified === false);
  assert(contract.safety.productionWrite === false);
  assert(contract.safety.createsTrigger === false);
  assert(contract.dataSentinel.fullTableDigest === false);
});

test('package wiring runs the Beta.1.3 suite once', () => {
  assert(
    packageJson.scripts['test:beta13-failure-injection'] ===
      'node tests/beta13_failure_injection_static.test.js'
  );
  const matches = (
    packageJson.scripts.test.match(
      /npm run test:beta13-failure-injection/g
    ) || []
  ).length;
  assert(matches === 1);
});

console.log(
  `Beta.1.3 failure-injection tests: ${passed} passed, ${failed} failed`
);
if (failed) process.exit(1);
