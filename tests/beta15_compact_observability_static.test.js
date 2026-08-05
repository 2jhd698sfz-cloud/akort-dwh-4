'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src',
  '40_Beta15CompactObservability.js'
);
const corePath = path.join(root, 'src', '02_Core.js');
const inventoryTestPath = path.join(
  root,
  'tests',
  'beta15_observability_inventory_static.test.js'
);
const contractPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA15_COMPACT_OBSERVABILITY_CONTRACT.json'
);
const markdownPath = path.join(
  root,
  'docs',
  'beta-1',
  'BETA15_COMPACT_OBSERVABILITY_CONTRACT.md'
);
const packagePath = path.join(root, 'package.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');
const inventoryTest = fs.readFileSync(inventoryTestPath, 'utf8');
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

function canonical(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      out[key] = canonical(value[key]);
    });
    return out;
  }
  return value;
}

function fakeHash(text) {
  let value = 2166136261;
  String(text).split('').forEach((char) => {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  });
  return (value >>> 0).toString(16).padStart(8, '0').repeat(8);
}

const phases = [
  'DISCOVER',
  'VALIDATE',
  'PARSE',
  'STAGE',
  'COMMIT_RAW',
  'UPDATE_PUBLISH',
  'UPDATE_STATUS',
  'QUICK_AUDIT',
  'FINALIZING',
  'SUCCESS'
];

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
  isFinite,
  AKORT: {
    Result: {
      success(message, data) {
        return { ok: true, status: 'SUCCESS', message, data };
      },
      failure(code, message, details) {
        return { ok: false, status: 'FAILED', code, message, details };
      }
    },
    Release: {
      version: '4.0.0-alpha.7.4.42',
      manifest() {
        return { operationPhases: phases.slice() };
      }
    },
    Core: {
      Tables: {},
      safeJson: JSON.stringify,
      canonicalJson(value) {
        return JSON.stringify(canonical(value));
      },
      sha256: fakeHash,
      error(code, message, details) {
        const error = new Error(message);
        error.code = code;
        error.details = details;
        return error;
      },
      safeRun(component, fn) {
        return fn();
      }
    },
    Beta15ObservabilityInventory: {
      PackageVersion: '4.0.0-beta.1.5.1',
      SourceTables: []
    },
    Beta14OperationalHardening: {
      classifyOperation(row) {
        const status = String(row.status || '');
        return {
          stale: status === 'PAUSED',
          checkpointInvalid: false,
          classification:
            status === 'DEAD_LETTER'
              ? 'TERMINAL_DEAD_LETTER'
              : status === 'PAUSED'
                ? 'STALE_PAUSED'
                : 'TERMINAL_SUCCESS',
          nextAction:
            status === 'DEAD_LETTER'
              ? 'REVIEW_DEAD_LETTER'
              : status === 'PAUSED'
                ? 'RESUME_FROM_CHECKPOINT'
                : 'NONE',
          ageMinutes: 10
        };
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context, {
  filename: sourcePath
});
const moduleUnderTest = context.AKORT.Beta15CompactObservability;
const helpers = moduleUnderTest.Test;

test('metadata and contract pin the accepted inventory commit', () => {
  assert.strictEqual(pkg.version, '4.0.0-alpha.7.4.42');
  assert.strictEqual(
    moduleUnderTest.PackageVersion,
    '4.0.0-beta.1.5.2'
  );
  assert.strictEqual(
    moduleUnderTest.ContractVersion,
    '4.0-beta15-compact-observability-1'
  );
  assert.strictEqual(
    moduleUnderTest.BaseCommit,
    'dfe0733432a2cf978ccecaac6b753019a1331a9e'
  );
  assert.strictEqual(
    contract.baseCommit,
    'dfe0733432a2cf978ccecaac6b753019a1331a9e'
  );
});

test('source is syntax-valid and exposes only the five planned APIs', () => {
  new vm.Script(source, { filename: sourcePath });
  [
    'AKORT_beta15CompactObservabilityContract',
    'AKORT_beta15CompactObservabilityPreflight',
    'AKORT_beta15CompactObservabilityInstall',
    'AKORT_beta15CompactObservabilityRefresh',
    'AKORT_beta15CompactObservabilityStatus'
  ].forEach((name) => {
    assert(source.includes('function ' + name + '()'), name);
  });
});

test('Core materializes exactly the two compact read-model schemas', () => {
  assert(core.includes('DATASET_STATUS: ['));
  assert(core.includes('ISSUE_REGISTRY: ['));
  moduleUnderTest.DatasetHeaders.forEach((header) => {
    assert(core.includes("'" + header + "'"), header);
  });
  moduleUnderTest.IssueHeaders.forEach((header) => {
    assert(core.includes("'" + header + "'"), header);
  });
  assert.strictEqual(contract.readModels.DATASET_STATUS.length, 23);
  assert.strictEqual(contract.readModels.ISSUE_REGISTRY.length, 19);
});

test('refresh reads only bounded service-registry tails', () => {
  assert(source.includes('var MAX_TAIL_ROWS = 25;'));
  assert(source.includes(
    'var count = Math.min(MAX_TAIL_ROWS, inspection.rows);'
  ));
  assert(source.includes(
    'var startRow = inspection.sheet.getLastRow() - count + 1;'
  ));
  assert.strictEqual(contract.boundedness.tailRowsPerSource, 25);
  assert.strictEqual(
    contract.boundedness.sourceRegistryFullScan,
    false
  );
});

test('implementation never names or opens physical data targets', () => {
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
  assert.strictEqual(contract.boundedness.readsRawTargets, false);
  assert.strictEqual(contract.boundedness.readsPublishTargets, false);
});

test('compact status reads only the two materialized projections', () => {
  const start = source.indexOf('  function status() {');
  const end = source.indexOf('  function contract() {', start);
  assert(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert(body.includes('TARGET_DATASET_STATUS'));
  assert(body.includes('TARGET_ISSUE_REGISTRY'));
  assert(body.includes('readProjection_('));
  assert(!body.includes('readSources_('));
  assert(!body.includes('readTail_('));
  [
    'RELEASE_REGISTRY',
    'OPERATION_QUEUE',
    'SYSTEM_LOG',
    'RAW_LOAD_REGISTRY',
    'PUBLISH_RUNS',
    'PUBLISH_RECONCILIATION',
    'PARSER_ISSUES',
    'BACKUP_REGISTRY',
    'TRIGGER_OWNERSHIP_REGISTRY'
  ].forEach((name) => {
    assert(!body.includes("'" + name + "'"), name);
  });
  assert.strictEqual(
    contract.boundedness.statusReadsSourceRegistries,
    false
  );
});

test('write boundary is limited to DATASET_STATUS and ISSUE_REGISTRY', () => {
  [
    'DriveApp.',
    'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger',
    'AKORT.OperationEngine.enqueue(',
    '.appendRow(',
    'deleteSheet(',
    'setProperty(',
    'deleteProperty('
  ].forEach((token) => {
    assert(!source.includes(token), token);
  });
  assert(source.includes(
    'writeProjection_(\n        spreadsheet,\n        TARGET_DATASET_STATUS'
  ));
  assert(source.includes(
    'writeProjection_(\n        spreadsheet,\n        TARGET_ISSUE_REGISTRY'
  ));
  assert.strictEqual(contract.safety.createsTrigger, false);
  assert.strictEqual(contract.safety.deletesTrigger, false);
  assert.strictEqual(contract.safety.mutatesOperation, false);
  assert.strictEqual(contract.safety.dataPlaneWrite, false);
});

test('freshness policy is explicit and deterministic', () => {
  const policies = contract.freshnessPolicies;
  assert.strictEqual(policies.length, 8);
  const byId = Object.fromEntries(
    policies.map((policy) => [policy.datasetId, policy])
  );
  assert.strictEqual(byId.RAW_LOADS.thresholdMinutes, 20160);
  assert.strictEqual(byId.PUBLISH_RUNS.thresholdMinutes, 20160);
  assert.strictEqual(byId.BACKUPS.thresholdMinutes, 2160);
  assert.strictEqual(byId.TRIGGERS.thresholdMinutes, 10080);
  assert.deepStrictEqual(
    Array.from(contract.issueLifecycles),
    ['OPEN', 'RETRYING', 'REVIEW', 'OBSERVED']
  );
});

test('freshness helper distinguishes current, stale and not-applicable', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  assert.strictEqual(
    helpers.freshness(
      '2026-08-05T11:00:00.000Z',
      120,
      now
    ).status,
    'CURRENT'
  );
  assert.strictEqual(
    helpers.freshness(
      '2026-08-05T08:00:00.000Z',
      120,
      now
    ).status,
    'STALE'
  );
  assert.strictEqual(
    helpers.freshness('', 0, now).status,
    'NOT_APPLICABLE'
  );
});

test('operation progress and checkpoint cursor are compact', () => {
  assert.strictEqual(helpers.phaseProgress('DISCOVER'), 0);
  assert.strictEqual(helpers.phaseProgress('SUCCESS'), 100);
  assert.strictEqual(
    helpers.checkpointCursor({
      checkpoint_json: JSON.stringify({ nextPhase: 'UPDATE_STATUS' })
    }),
    'UPDATE_STATUS'
  );
  assert.strictEqual(
    helpers.checkpointCursor({
      checkpoint_json: JSON.stringify({
        control: { stopRequested: true }
      })
    }),
    'STOP_REQUESTED'
  );
});

test('Beta.1.3 control-plane incidents are excluded from current issues', () => {
  assert.strictEqual(
    helpers.isControlTest('ALPHA3_TEST_BETA13_DEAD_LETTER'),
    true
  );
  assert.strictEqual(
    helpers.isControlTest('ALPHA3_DEMO_SAMPLE'),
    true
  );
  assert.strictEqual(
    helpers.isControlTest('SOURCE_FILE_LOAD_V4'),
    false
  );
  assert(source.includes("type.indexOf('BETA13_') >= 0"));
});

test('latest-per-key logic suppresses superseded reconciliation failures', () => {
  const rows = helpers.latestBy(
    [
      {
        __row: 2,
        sheet_name: 'A',
        status: 'FAIL',
        checked_at: '2026-08-01T00:00:00.000Z'
      },
      {
        __row: 3,
        sheet_name: 'A',
        status: 'SUCCESS',
        checked_at: '2026-08-02T00:00:00.000Z'
      },
      {
        __row: 4,
        sheet_name: 'B',
        status: 'PASS',
        checked_at: '2026-08-03T00:00:00.000Z'
      }
    ],
    'sheet_name',
    ['checked_at']
  );
  const bySheet = Object.fromEntries(
    Array.from(rows).map((row) => [row.sheet_name, row.status])
  );
  assert.strictEqual(bySheet.A, 'SUCCESS');
  assert.strictEqual(bySheet.B, 'PASS');
});

test('issue normalization is stable and severity-aware', () => {
  assert.strictEqual(helpers.normalizeSeverity('fatal'), 'CRITICAL');
  assert.strictEqual(helpers.normalizeSeverity('warn'), 'WARNING');
  assert.strictEqual(helpers.normalizeSeverity('other'), 'INFO');
  assert(source.includes('occurrence_count'));
  assert(source.includes('first_seen_at'));
  assert(source.includes('last_seen_at'));
  assert(source.includes('resolution'));
});

test('install keeps the Core lock non-reentrant', () => {
  const coreCall = source.indexOf('var core = AKORT.Core.install();');
  const installLock = source.indexOf(
    "'BETA15_COMPACT_OBSERVABILITY_INSTALL'"
  );
  assert(coreCall >= 0);
  assert(installLock > coreCall);
  assert(markdown.includes('Core.install completes before'));
});

test('inventory regression becomes phase-aware after implementation', () => {
  assert(inventoryTest.includes(
    "test('read-model gap is historical or closed exactly by r2'"
  ));
  assert(inventoryTest.includes(
    "'40_Beta15CompactObservability.js'"
  ));
});

test('safety boundaries and full regression wiring remain exact', () => {
  assert.strictEqual(contract.safety.productionWrite, false);
  assert.strictEqual(contract.safety.enablesUserPipeline, false);
  assert.strictEqual(contract.safety.createsQueue, false);
  assert.strictEqual(contract.safety.createsExecutor, false);
  assert.strictEqual(contract.safety.createsDispatcher, false);
  assert(
    !/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source)
  );
  assert.strictEqual(
    pkg.scripts['test:beta15-compact-observability'],
    'node tests/beta15_compact_observability_static.test.js'
  );
  assert(
    pkg.scripts.test.includes(
      'npm run test:beta15-compact-observability'
    )
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

console.log(JSON.stringify({
  suite: 'beta15_compact_observability_static',
  packageVersion: contract.packageVersion,
  baseRelease: contract.baseRelease,
  total,
  failed
}, null, 2));

if (failed) process.exit(1);
