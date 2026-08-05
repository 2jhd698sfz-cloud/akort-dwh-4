const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/35_Beta12RollbackFacade.js'),
  'utf8'
);
const raw = fs.readFileSync(
  path.join(root, 'src/05_RawStore.js'), 'utf8'
);
const publish = fs.readFileSync(
  path.join(root, 'src/07_IncrementalPublish.js'),
  'utf8'
);
const engine = fs.readFileSync(
  path.join(root, 'src/03_OperationEngine.js'),
  'utf8'
);
const hardening = fs.readFileSync(
  path.join(root, 'src/38_Beta14OperationalHardening.js'),
  'utf8'
);
const contract = JSON.parse(fs.readFileSync(
  path.join(
    root,
    'docs/beta-1/BETA12_ROLLBACK_FACADE_CONTRACT.json'
  ),
  'utf8'
));
const packageJson = JSON.parse(fs.readFileSync(
  path.join(root, 'package.json'), 'utf8'
));

let total = 0;
let failed = 0;

function test(name, fn) {
  total += 1;
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error(
      'FAIL ' + name + ': ' + error.message
    );
  }
}

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
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
  return crypto.createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function akortError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  AKORT: {
    Result: {
      success(message, data) {
        return {
          ok: true,
          status: 'SUCCESS',
          message,
          data
        };
      },
      paused(message, data) {
        return {
          ok: true,
          status: 'PAUSED',
          message,
          data
        };
      },
      failure(code, message, details) {
        return {
          ok: false,
          status: 'FAILED',
          code,
          message,
          details
        };
      }
    },
    Core: {
      error: akortError,
      sha256,
      canonicalJson,
      now() {
        return '2026-08-04T00:00:00.000Z';
      }
    },
    RawStore: {
      Specs: {
        RAW_PRICES_WEEKLY: {},
        RAW_PRICES_MONTHLY: {},
        RAW_INDUSTRY: {}
      },
      businessKey(target, row) {
        return target + '|' + String(row.key || '');
      }
    }
  }
};

vm.runInNewContext(source, sandbox, {
  filename: '35_Beta12RollbackFacade.js'
});
const facade = sandbox.AKORT.Beta12RollbackFacade;

function checkpointRow(overrides = {}) {
  const token = overrides.token || 'TOKEN';
  const target = overrides.target || 'LOAD_1';
  const reasonHash = overrides.reasonHash ||
    sha256('Valid rollback reason');
  return {
    operation_id: overrides.operationId || 'OP_1',
    operation_type:
      overrides.operationType || 'RAW_REVERSAL_V4',
    status: overrides.status || 'PAUSED',
    checkpoint_json:
      overrides.checkpointJson || JSON.stringify({
        input: {
          targetLoadId: target,
          beta12: {
            packageVersion:
              '4.0.0-beta.1.2.5',
            confirmationToken: token,
            reasonHash
          }
        },
        meta: {
          idempotencyKey:
            'BETA12_ROLLBACK_' + token
        }
      })
  };
}

function sourceOperationRow(overrides = {}) {
  const idempotencyKey = overrides.idempotencyKey ||
    'SOURCE_FILE_LOAD_CURRENT';
  return {
    operation_id: overrides.operationId || 'OP_SOURCE_1',
    operation_type:
      overrides.operationType || 'SOURCE_FILE_LOAD_V4',
    status: overrides.status || 'SUCCESS',
    created_by: overrides.createdBy || 'unknown',
    release_version:
      overrides.releaseVersion || '4.0.0-alpha.7.4.42',
    checkpoint_json:
      overrides.checkpointJson || JSON.stringify({
        input: {
          fileName: overrides.fileName || 'AKORT_WEEKLY_W27',
          sourceName:
            overrides.sourceName || 'AKORT_WEEKLY_W27'
        },
        meta: {
          idempotencyKey
        },
        handlerState: {
          file: {
            fileName: overrides.fileName || 'AKORT_WEEKLY_W27'
          },
          profile: {
            profileId: 'AKORT_WEEKLY_W00'
          },
          sourceHash: 'SOURCE_HASH'
        }
      })
  };
}

function compactStatus(status, errorCode, errorMessage) {
  return {
    operation: {
      status,
      errorCode: errorCode || '',
      errorMessage: errorMessage || ''
    }
  };
}

function codes(result) {
  return result.blockers.map((item) => item.code);
}

test('r5 source is syntax-valid and pins the accepted base', () => {
  new vm.Script(source, {
    filename: '35_Beta12RollbackFacade.js'
  });
  assert(source.includes(
    "var PACKAGE_VERSION = '4.0.0-beta.1.2.5';"
  ));
  assert(source.includes(
    "var CONTRACT_VERSION = " +
    "'4.0-beta12-rollback-facade-4';"
  ));
  assert(source.includes(
    "var BASE_COMMIT = " +
    "'ad27642024690546b16a2b33fa4d3ba8d5dfb8ee';"
  ));
  assert.equal(
    packageJson.version,
    '4.0.0-alpha.7.4.42'
  );
});

test('accepted RAW_REVERSAL_V4 remains the only data plane', () => {
  assert(source.includes(
    "var OPERATION_TYPE = 'RAW_REVERSAL_V4';"
  ));
  assert(source.includes(
    'AKORT.Beta14OperationalHardening.enqueueGuarded('
  ));
  assert(!source.includes(
    'AKORT.OperationEngine.enqueue('
  ));
  assert.equal(
    (hardening.match(/AKORT\.OperationEngine\.enqueue\s*\(/g) || []).length,
    1
  );
  assert(source.includes(
    'AKORT.OperationEngine.run('
  ));
  assert(!source.includes('reverseLoadStep('));
  assert(/var\s+REVERSAL_TYPE\s*=\s*['"]RAW_REVERSAL_V4['"]/.test(raw));
  assert(/function\s+enqueue\s*\(/.test(engine));
  assert(/function\s+run\s*\(/.test(engine));
});

test('preview implementation contains no write or execution API', () => {
  const start = source.indexOf(
    '  function previewData_('
  );
  const end = source.indexOf(
    '\n  function preview(', start
  );
  assert(start >= 0 && end > start);
  const body = source.slice(start, end);
  [
    '.enqueue(',
    '.run(',
    '.resume(',
    '.setValue(',
    '.setValues(',
    '.appendRow(',
    '.insertSheet(',
    '.makeCopy(',
    'PropertiesService',
    'ScriptApp'
  ].forEach((token) => {
    assert(!body.includes(token), token);
  });
  assert(body.includes(
    'AKORT.IncrementalPublish.planReversal('
  ));
  assert(body.includes(
    'AKORT.IncrementalPublish.summarizePlan('
  ));
});

test('reason normalization is dynamic and bounded', () => {
  assert.equal(
    facade.Test.normalizeReason(
      '  Valid   rollback   reason  '
    ),
    'Valid rollback reason'
  );
  assert.throws(
    () => facade.Test.normalizeReason('too short'),
    (error) => error.code ===
      'BETA12_REASON_TOO_SHORT'
  );
  assert.throws(
    () => facade.Test.normalizeReason(
      'x'.repeat(501)
    ),
    (error) => error.code ===
      'BETA12_REASON_TOO_LONG'
  );
});

test('checkpoint parsing fails closed', () => {
  const parsed = facade.Test.parseCheckpoint(
    JSON.stringify({ input: { a: 1 } }),
    'OP_OK'
  );
  assert.equal(parsed.input.a, 1);
  assert.throws(
    () => facade.Test.parseCheckpoint(
      '{broken', 'OP_BAD'
    ),
    (error) => error.code ===
      'BETA12_OPERATION_CHECKPOINT_INVALID'
  );
  assert.throws(
    () => facade.Test.parseCheckpoint('', 'OP_EMPTY'),
    (error) => error.code ===
      'BETA12_OPERATION_CHECKPOINT_MISSING'
  );
});

test('accepted evidence protection covers load identity fields', () => {
  assert.equal(
    facade.Test.protectedLoad({
      load_id: 'LOAD_ALPHA74_GATE7_CANARY'
    }),
    true
  );
  assert.equal(
    facade.Test.protectedLoad({
      source_name: 'ALPHA5_TEST_SAMPLE'
    }),
    true
  );
  assert.equal(
    facade.Test.protectedLoad({
      load_id: 'LOAD_CURRENT_2026',
      source_name: 'Current weekly prices'
    }),
    false
  );
});

test('source-operation provenance blocks Gate restore ancestry', () => {
  const load = {
    load_id: 'LOAD_CURRENT',
    operation_id: 'OP_SOURCE_1'
  };
  const regular = facade.Test.sourceOperationProvenance(
    load,
    [sourceOperationRow()]
  );
  assert.equal(regular.traceable, true);
  assert.equal(regular.protected, false);
  assert.equal(regular.blockers.length, 0);
  assert(regular.fingerprint);

  const gateRestore = facade.Test.sourceOperationProvenance(
    load,
    [sourceOperationRow({
      idempotencyKey:
        'ALPHA74_GATE6_RESTORE_A74_GATE6_37FAED6EF952F9BB5FD4'
    })]
  );
  assert.equal(gateRestore.protected, true);
  assert(gateRestore.markerMatches.includes('ALPHA74_GATE6'));
  assert(codes(gateRestore).includes(
    'BETA12_ACCEPTANCE_EVIDENCE_PROTECTED'
  ));
});

test('source-operation provenance is complete and fail-closed', () => {
  const missingId = facade.Test.sourceOperationProvenance(
    { load_id: 'LOAD_CURRENT' },
    []
  );
  assert(codes(missingId).includes(
    'BETA12_SOURCE_OPERATION_ID_MISSING'
  ));

  const notFound = facade.Test.sourceOperationProvenance(
    {
      load_id: 'LOAD_CURRENT',
      operation_id: 'OP_MISSING'
    },
    []
  );
  assert(codes(notFound).includes(
    'BETA12_SOURCE_OPERATION_NOT_FOUND'
  ));

  const notSuccess = facade.Test.sourceOperationProvenance(
    {
      load_id: 'LOAD_CURRENT',
      operation_id: 'OP_SOURCE_1'
    },
    [sourceOperationRow({ status: 'RUNNING' })]
  );
  assert(codes(notSuccess).includes(
    'BETA12_SOURCE_OPERATION_NOT_SUCCESS'
  ));

  const reversalLoad = facade.Test.sourceOperationProvenance(
    {
      load_id: 'LOAD_REV',
      operation_id: 'OP_SOURCE_1'
    },
    [sourceOperationRow({
      operationType: 'RAW_REVERSAL_V4'
    })]
  );
  assert(codes(reversalLoad).includes(
    'BETA12_REVERSAL_LOAD_INELIGIBLE'
  ));

  assert.throws(
    () => facade.Test.sourceOperationProvenance(
      {
        load_id: 'LOAD_CURRENT',
        operation_id: 'OP_SOURCE_1'
      },
      [
        sourceOperationRow(),
        sourceOperationRow()
      ]
    ),
    (error) => error.code ===
      'BETA12_SOURCE_OPERATION_CONFLICT'
  );
});

test('source provenance is bound to preview and confirmation', () => {
  assert(contract.eligibility.requiresSourceOperation);
  assert(contract.eligibility.requiresSuccessfulSourceOperation);
  assert(
    contract.eligibility
      .protectsEvidenceBySourceOperationCheckpoint
  );
  assert(
    contract.confirmation.boundFields.includes(
      'sourceOperationFingerprint'
    )
  );
  assert.equal(
    contract.confirmation.sourceOperationDriftBehavior,
    'INVALIDATE_CONFIRMATION_TOKEN'
  );
  assert(source.includes(
    'sourceOperationFingerprint: sourceProvenance.fingerprint'
  ));
  assert(source.includes(
    'sourceOperationFingerprint:\n' +
    '                previewData.fingerprints.sourceOperation'
  ));
});

test('eligibility mirrors latest-load-only policy', () => {
  const load = {
    load_id: 'LOAD_2',
    target_table: 'RAW_PRICES_WEEKLY',
    status: 'COMMITTED',
    source_name: 'Current data'
  };
  const oldRow = {
    key: 'A',
    observation_id: 'OBS_1',
    version_no: 1,
    load_id: 'LOAD_1',
    __row: 2
  };
  const target = {
    key: 'A',
    observation_id: 'OBS_2',
    version_no: 2,
    load_id: 'LOAD_2',
    __row: 3
  };
  const eligible = facade.Test.buildEligibility(
    load,
    [target],
    [oldRow, target],
    [
      { load_id: 'LOAD_1', status: 'COMMITTED' },
      load
    ],
    [],
    []
  );
  assert.equal(eligible.eligible, true);
  assert.equal(
    eligible.predecessors[0]
      .restored.observation_id,
    'OBS_1'
  );

  const later = {
    key: 'A',
    observation_id: 'OBS_3',
    version_no: 3,
    load_id: 'LOAD_3',
    __row: 4
  };
  const blocked = facade.Test.buildEligibility(
    load,
    [target],
    [oldRow, target, later],
    [
      { load_id: 'LOAD_1', status: 'COMMITTED' },
      load,
      { load_id: 'LOAD_3', status: 'COMMITTED' }
    ],
    [],
    []
  );
  assert(codes(blocked).includes(
    'BETA12_LATER_ACTIVE_REVISION_EXISTS'
  ));

  const ignoredReversedLater =
    facade.Test.buildEligibility(
      load,
      [target],
      [oldRow, target, later],
      [
        { load_id: 'LOAD_1', status: 'COMMITTED' },
        load,
        { load_id: 'LOAD_3', status: 'REVERSED' }
      ],
      [],
      []
    );
  assert.equal(ignoredReversedLater.eligible, true);
});

test('eligibility blocks reversal evidence and active operation', () => {
  const load = {
    load_id: 'LOAD_2',
    target_table: 'RAW_PRICES_WEEKLY',
    status: 'COMMITTED',
    source_name: 'Current data'
  };
  const target = {
    key: 'A',
    observation_id: 'OBS_2',
    version_no: 1,
    load_id: 'LOAD_2',
    __row: 2
  };
  const active = checkpointRow({
    target: 'LOAD_2',
    status: 'PAUSED'
  });
  const result = facade.Test.buildEligibility(
    load,
    [target],
    [target],
    [load],
    [{ target_load_id: 'LOAD_2', status: 'SUCCESS' }],
    [active]
  );
  assert(codes(result).includes(
    'BETA12_EXISTING_REVERSAL_LOG'
  ));
  assert(codes(result).includes(
    'BETA12_ACTIVE_REVERSAL_EXISTS'
  ));
});

test('confirmation token is deterministic and value-sensitive', () => {
  const binding = {
    targetLoadId: 'LOAD_1',
    reasonHash: 'A',
    targetRowCount: 2
  };
  const first =
    facade.Test.confirmationToken(binding);
  const second =
    facade.Test.confirmationToken({
      targetRowCount: 2,
      reasonHash: 'A',
      targetLoadId: 'LOAD_1'
    });
  const changed =
    facade.Test.confirmationToken({
      targetLoadId: 'LOAD_1',
      reasonHash: 'B',
      targetRowCount: 2
    });
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('existing submission matching is exact and duplicate-safe', () => {
  const row = checkpointRow();
  const found =
    facade.Test.findExistingSubmissionInRows(
      [row],
      'LOAD_1',
      'Valid rollback reason',
      'TOKEN'
    );
  assert.equal(found.operationId, 'OP_1');
  assert.equal(
    found.idempotencyKey,
    'BETA12_ROLLBACK_TOKEN'
  );

  assert.throws(
    () => facade.Test.findExistingSubmissionInRows(
      [row],
      'LOAD_OTHER',
      'Valid rollback reason',
      'TOKEN'
    ),
    (error) => error.code ===
      'BETA12_EXISTING_SUBMISSION_MISMATCH'
  );

  assert.throws(
    () => facade.Test.findExistingSubmissionInRows(
      [row, checkpointRow({
        operationId: 'OP_2'
      })],
      'LOAD_1',
      'Valid rollback reason',
      'TOKEN'
    ),
    (error) => error.code ===
      'BETA12_IDEMPOTENCY_CONFLICT'
  );
});

test('submission result preserves success pause and failure', () => {
  const success = facade.Test.submissionResult(
    compactStatus('SUCCESS'),
    { ok: true, status: 'SUCCESS' },
    { adoptedExisting: false }
  );
  assert.equal(success.status, 'SUCCESS');

  const paused = facade.Test.submissionResult(
    compactStatus('PAUSED'),
    { ok: true, status: 'PAUSED' },
    { adoptedExisting: false }
  );
  assert.equal(paused.status, 'PAUSED');

  const terminalFailure =
    facade.Test.submissionResult(
      compactStatus(
        'FAILED',
        'RAW_FAILURE',
        'RAW failed'
      ),
      {
        ok: false,
        status: 'FAILED',
        code: 'RAW_FAILURE'
      },
      { adoptedExisting: true }
    );
  assert.equal(terminalFailure.ok, false);
  assert.equal(
    terminalFailure.code,
    'RAW_FAILURE'
  );

  const invocationFailure =
    facade.Test.submissionResult(
      compactStatus('RUNNING'),
      {
        ok: false,
        status: 'FAILED',
        code: 'LOCK_FAILURE',
        message: 'Lock failed'
      },
      { adoptedExisting: true }
    );
  assert.equal(invocationFailure.ok, false);
  assert.equal(
    invocationFailure.code,
    'LOCK_FAILURE'
  );
});

test('submit order adopts repeats and validates new requests', () => {
  const start = source.indexOf(
    '  function submit('
  );
  const end = source.indexOf(
    '\n  function contract(', start
  );
  const body = source.slice(start, end);

  const normalizedAt = body.search(
    /var\s+normalizedReason\s*=\s*normalizeReason_\(reason\)/
  );
  const tokenRequiredAt = body.search(
    /if\s*\(!provided\)/
  );
  const firstExistingAt = body.search(
    /var\s+existing\s*=\s*findExistingSubmission_\s*\(/
  );
  const previewAt = body.search(
    /var\s+previewData\s*=\s*previewData_\s*\(/
  );
  const secondExistingMatch =
    /\n\s*existing\s*=\s*findExistingSubmission_\s*\(/g;
  secondExistingMatch.lastIndex = previewAt;
  const secondExisting =
    secondExistingMatch.exec(body);
  const secondExistingAt =
    secondExisting ? secondExisting.index : -1;
  const exactTokenAt = body.search(
    /if\s*\(\s*provided\s*!==\s*previewData\.confirmationToken\s*\)/
  );
  const enqueueAt = body.search(
    /AKORT\.Beta14OperationalHardening\.enqueueGuarded\s*\(/
  );

  assert(
    normalizedAt >= 0 &&
    tokenRequiredAt > normalizedAt &&
    firstExistingAt > tokenRequiredAt &&
    previewAt > firstExistingAt &&
    secondExistingAt > previewAt &&
    exactTokenAt > secondExistingAt &&
    enqueueAt > exactTokenAt
  );
});

test('compact status avoids OPERATION_STEPS and full engine status', () => {
  const start = source.indexOf(
    '  function statusData_('
  );
  const end = source.indexOf(
    '\n  function status(', start
  );
  const body = source.slice(start, end);
  assert(body.includes("'OPERATION_QUEUE'"));
  assert(body.includes("'RAW_LOAD_REGISTRY'"));
  assert(body.includes("'RAW_REVERSAL_LOG'"));
  assert(!body.includes("'OPERATION_STEPS'"));
  assert(!body.includes(
    'AKORT.OperationEngine.status('
  ));
  assert.equal(
    contract.compactStatus.doesNotReadOperationSteps,
    true
  );
});

test('public API is narrow and explicit', () => {
  [
    'function AKORT_beta12RollbackPreview(',
    'function AKORT_beta12RollbackSubmit(',
    'function AKORT_beta12RollbackStatus(',
    'function AKORT_beta12RollbackContract()'
  ].forEach((token) => {
    assert(source.includes(token), token);
  });
  assert.equal(contract.publicApi.length, 3);
  assert(!source.includes(
    'AKORT_beta12RollbackAutomatic'
  ));
});

test('facade creates no schema trigger or production path', () => {
  [
    'ScriptApp.newTrigger',
    'insertSheet(',
    'createSheet',
    'makeCopy('
  ].forEach((token) => {
    assert(!source.includes(token), token);
  });
  assert.equal(contract.dataPlane.newQueue, false);
  assert.equal(contract.dataPlane.newExecutor, false);
  assert.equal(contract.safety.newTrigger, false);
  assert.equal(contract.safety.productionWrite, false);
  assert.equal(
    contract.safety.generalUserPipelineEnablement,
    false
  );
});

test('accepted dependency APIs used by the facade are exported', () => {
  assert(/businessKey\s*:\s*businessKey_/.test(raw));
  assert(/Specs\s*:\s*clone_\(SPECS\)/.test(raw));
  assert(
    /planReversal\s*:\s*planReversal/.test(publish)
  );
  assert(
    /summarizePlan\s*:\s*summarizePlan_/.test(publish)
  );
});

test('general user pipeline remains disabled', () => {
  const srcDir = path.join(root, 'src');
  const files = fs.readdirSync(srcDir)
    .filter((name) => name.endsWith('.js'));
  const forbidden =
    /PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i;
  files.forEach((name) => {
    const text = fs.readFileSync(
      path.join(srcDir, name), 'utf8'
    );
    assert(!forbidden.test(text), name);
  });
});

test('r5 suite remains wired once into full regression', () => {
  assert.equal(
    packageJson.scripts[
      'test:beta12-rollback-facade'
    ],
    'node tests/beta12_rollback_facade_static.test.js'
  );
  const occurrences =
    packageJson.scripts.test.split(
      'npm run test:beta12-rollback-facade'
    ).length - 1;
  assert.equal(occurrences, 1);
});

console.log(JSON.stringify({
  suite: 'beta12_rollback_facade_static',
  packageVersion: contract.packageVersion,
  contractVersion: contract.contractVersion,
  baseRelease: contract.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
