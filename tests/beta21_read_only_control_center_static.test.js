'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', '46_Beta21ReadOnlyControlCenter.js');
const htmlPath = path.join(root, 'src', 'Beta21ControlCenter.html');
const contractPath = path.join(root, 'docs', 'beta-2', 'BETA21_READ_ONLY_CONTROL_CENTER_CONTRACT.json');
const reusePath = path.join(root, 'docs', 'beta-2', 'BETA21_REUSE_MATRIX.md');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'src', 'appsscript.json');

const source = fs.readFileSync(sourcePath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const reuse = fs.readFileSync(reusePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

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

test('metadata pins accepted Beta.1 handoff', () => {
  assert(source.includes("var PACKAGE_VERSION = '4.0.0-beta.2.1.1';"));
  assert(source.includes("var CONTRACT_VERSION = '4.0-beta21-read-only-control-center-1';"));
  assert(source.includes("var BASE_RELEASE = '4.0.0-alpha.7.4.42';"));
  assert(source.includes("var BASE_COMMIT = '32945776e279528008cbd753e1f0321b3c52e91e';"));
  assert.strictEqual(contract.baseCommit, '32945776e279528008cbd753e1f0321b3c52e91e');
});

test('source and client are syntax-valid', () => {
  new vm.Script(source, { filename: sourcePath });
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(script, 'inline client script');
  new vm.Script(script[1], { filename: htmlPath });
});

test('public API is limited to contract preflight status and doGet', () => {
  [
    'function doGet()',
    'function AKORT_beta21ControlCenterContract()',
    'function AKORT_beta21ControlCenterPreflight()',
    'function AKORT_beta21ControlCenterStatus()'
  ].forEach((token) => assert(source.includes(token), token));
  assert.deepStrictEqual(contract.publicApi, [
    'doGet',
    'AKORT_beta21ControlCenterContract',
    'AKORT_beta21ControlCenterPreflight',
    'AKORT_beta21ControlCenterStatus'
  ]);
});

test('candidate reuses accepted read APIs only', () => {
  [
    'AKORT.Beta15CompactObservability.status()',
    'AKORT.Beta16OperatorFacade.statusLatest()',
    'AKORT.Config.load(',
    'AKORT.Config.readSystemSettings()'
  ].forEach((token) => assert(source.includes(token), token));
  assert(!source.includes('Beta15CompactObservability.refresh'));
  assert(reuse.includes('REUSE_MATRIX'));
});

test('candidate contains no backend operation or write path', () => {
  [
    'OperationEngine.enqueue',
    'OperationEngine.run',
    'OperationEngine.resume',
    'enqueueGuarded',
    '.setValue(',
    '.setValues(',
    '.clearContent(',
    '.appendRow(',
    '.insertRows',
    '.deleteRows',
    'DriveApp.create',
    'makeCopy(',
    'ScriptApp.newTrigger',
    'ScriptApp.deleteTrigger',
    'setProperty(',
    'deleteProperty('
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.safety.dataPlaneWrite, false);
  assert.strictEqual(contract.safety.serviceProjectionWrite, false);
  assert.strictEqual(contract.safety.createsOperation, false);
});

test('candidate never reads physical RAW or Publish targets', () => {
  [
    "'RAW_PRICES_WEEKLY'",
    "'RAW_PRICES_MONTHLY'",
    "'RAW_INDUSTRY'",
    "'PUBLISH_PRICES_WEEKLY'",
    "'PUBLISH_PRICES_MONTHLY'",
    "'PUBLISH_INDUSTRY'",
    "'PUBLISH_PRICE_AGGREGATES'"
  ].forEach((token) => assert(!source.includes(token), token));
  assert.strictEqual(contract.boundedness.readsPhysicalRawTargets, false);
  assert.strictEqual(contract.boundedness.readsPhysicalPublishTargets, false);
});

test('HTML is self-contained and safe by construction', () => {
  assert(html.includes('.AKORT_beta21ControlCenterStatus();'));
  assert(html.includes('textContent'));
  assert(!html.includes('innerHTML'));
  assert(!html.includes('<script src='));
  assert(!/https?:\/\/.*\.(js|css)/.test(html));
  assert(!html.includes('eval('));
});

test('refresh button rereads status and does not refresh projections', () => {
  assert(html.includes('Обновить экран'));
  assert(html.includes('AKORT_beta21ControlCenterStatus'));
  assert(!html.includes('ObservabilityRefresh'));
  assert(!source.includes('CompactObservability.refresh'));
});

test('access is server-side and fail-closed for missing identity', () => {
  assert(source.includes('Session.getActiveUser().getEmail()'));
  assert(source.includes("'BETA21_ACCESS_DENIED'"));
  assert(source.includes('assertAccess_();'));
  assert(source.includes('AKORT_BETA21_ALLOWED_EMAILS'));
});

test('userinfo email is the only new OAuth scope', () => {
  const scopes = manifest.oauthScopes;
  assert(scopes.includes('https://www.googleapis.com/auth/userinfo.email'));
  assert.strictEqual(new Set(scopes).size, scopes.length);
});

test('package wiring adds focused test to full regression', () => {
  assert.strictEqual(
    pkg.scripts['test:beta21-read-only-control-center'],
    'node tests/beta21_read_only_control_center_static.test.js'
  );
  assert(pkg.scripts.test.includes('npm run test:beta21-read-only-control-center'));
});

test('pipeline and production safety remain false', () => {
  assert(!/PUBLISH_USER_PIPELINE_ENABLED\s*[:=]\s*true\b/i.test(source));
  assert.strictEqual(contract.safety.enablesUserPipeline, false);
  assert.strictEqual(contract.safety.productionWrite, false);
});


test('status composes accepted DTOs without refreshing or writing', () => {
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
    globalThis: null,
    Session: {
      getActiveUser() {
        return { getEmail() { return 'owner@example.com'; } };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            if (name === 'AKORT_BETA21_ALLOWED_EMAILS') {
              return 'owner@example.com';
            }
            return '';
          }
        };
      }
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createTemplateFromFile() {
        return {
          evaluate() {
            return {
              setTitle() { return this; },
              setXFrameOptionsMode() { return this; }
            };
          }
        };
      },
      createHtmlOutput() {
        return { setTitle() { return this; } };
      }
    },
    AKORT_printResult_(value) { return value; },
    AKORT: {
      Release: { version: '4.0.0-alpha.7.4.42' },
      EnvironmentGuard: { assertDev() { return true; } },
      Result: {
        success(message, data) {
          return { ok: true, status: 'SUCCESS', message, data };
        },
        failure(code, message, details) {
          return { ok: false, status: 'FAILED', code, message, details };
        }
      },
      Core: {
        error(code, message, details) {
          const error = new Error(message);
          error.code = code;
          error.details = details;
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
        }
      },
      Config: {
        readSystemSettings() {
          return { PUBLISH_USER_PIPELINE_ENABLED: false };
        },
        load() {
          return {
            resources: {
              dwhSpreadsheetId: 'DWH',
              publishSpreadsheetId: 'PUB',
              devRootFolderId: 'ROOT',
              docsFolderId: 'DOCS'
            }
          };
        }
      },
      Beta15CompactObservability: {
        status() {
          return {
            ok: true,
            data: {
              overallStatus: 'HEALTHY',
              datasetCount: 3,
              issueCount: 0,
              nextActions: [],
              sourceRegistryReads: 0,
              rawTargetReads: 0,
              publishTargetReads: 0,
              datasets: [
                {
                  dataset_id: 'OPERATIONS',
                  dataset_label: 'Operations',
                  source_status: 'IDLE',
                  health_status: 'HEALTHY',
                  freshness_status: 'NOT_APPLICABLE',
                  progress_percent: '',
                  issue_count: 0,
                  next_action: 'NONE'
                },
                {
                  dataset_id: 'BACKUPS',
                  dataset_label: 'Backups',
                  source_status: 'SUCCESS',
                  health_status: 'HEALTHY',
                  freshness_status: 'CURRENT',
                  latest_backup_id: 'BKP_1',
                  latest_activity_at: '2026-08-06T00:00:00.000Z',
                  progress_percent: '',
                  issue_count: 0,
                  next_action: 'NONE'
                },
                {
                  dataset_id: 'TRIGGERS',
                  dataset_label: 'Triggers',
                  source_status: 'OK',
                  health_status: 'HEALTHY',
                  freshness_status: 'CURRENT',
                  latest_activity_at: '2026-08-06T00:00:00.000Z',
                  progress_percent: '',
                  issue_count: 0,
                  next_action: 'NONE'
                }
              ],
              issues: []
            }
          };
        }
      },
      Beta16OperatorFacade: {
        statusLatest() {
          return {
            ok: true,
            data: {
              operationId: '',
              operation: null,
              evidence: {
                audit_id: 'AUD_1',
                audit_status: 'SUCCESS',
                checks_total: 12,
                checks_passed: 12,
                checks_warned: 0,
                checks_failed: 0,
                evidence_hash: 'HASH'
              },
              retention: {
                rowCount: 2,
                dryRun: true,
                physicalDeletion: false
              }
            }
          };
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: sourcePath });
  const result = context.AKORT.Beta21ReadOnlyControlCenter.status();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.data.system.overallStatus, 'HEALTHY');
  assert.strictEqual(result.data.fullAudit.evidence.status, 'SUCCESS');
  assert.strictEqual(result.data.fullAudit.evidence.checksPassed, 12);
  assert.strictEqual(result.data.safety.rawTargetReads, 0);
  assert.strictEqual(result.data.safety.publishTargetReads, 0);
  assert.strictEqual(result.data.system.userPipelineEnabled, false);
});

console.log(JSON.stringify({ total, passed: total - failed, failed }));
if (failed) process.exit(1);
