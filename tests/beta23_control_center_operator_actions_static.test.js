'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'src', '48_Beta23ControlCenterOperatorActions.js');
const uiPath = path.join(root, 'src', 'Beta21ControlCenter.html');
const packagePath = path.join(root, 'package.json');
const server = fs.readFileSync(serverPath, 'utf8');
const ui = fs.readFileSync(uiPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((key) => { out[key] = canonicalize(value[key]); });
    return out;
  }
  return value;
}

const context = {
  console,
  AKORT: {
    Release: { version: '4.0.0-alpha.7.4.42' },
    Core: {
      sha256(value) {
        return crypto.createHash('sha256').update(String(value)).digest('hex');
      },
      canonicalJson(value) { return JSON.stringify(canonicalize(value)); },
      error(code, message, details) {
        const error = new Error(message);
        error.code = code;
        error.details = details;
        return error;
      }
    },
    Result: {
      success(message, data) { return { ok: true, status: 'SUCCESS', message, data }; },
      failure(code, message, details) { return { ok: false, status: 'FAILED', code, message, details }; }
    }
  },
  Utilities: {},
  PropertiesService: {},
  SpreadsheetApp: {},
  Session: {},
  DriveApp: {},
  AKORT_printResult_(value) { return value; }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(server, context, { filename: serverPath });

const moduleUnderTest = context.AKORT.Beta23ControlCenterOperatorActions;
const test = moduleUnderTest.Test;
const contract = moduleUnderTest.contract();

assert.strictEqual(moduleUnderTest.PackageVersion, '4.0.0-beta.2.3.5');
assert.strictEqual(moduleUnderTest.ContractVersion, '4.0-beta23-control-center-operator-actions-2');
assert.strictEqual(moduleUnderTest.BaseCommit, '10430fe3a51b7b4b007f9442684fc0aed85f49e5');
assert.strictEqual(contract.reusePolicy, 'REUSE_FIRST_GAP_ONLY');
assert.strictEqual(contract.freshnessTable, 'USER_DATA_FRESHNESS');
assert.strictEqual(contract.freshnessStageTable, 'USER_DATA_FRESHNESS_STAGE');
assert.strictEqual(contract.freshnessTransaction, 'SCRIPT_LOCK_STAGE_READBACK_TARGET_READBACK_ROLLBACK');
assert.strictEqual(contract.freshnessUniqueKey, 'freshness_member_id');
assert.strictEqual(contract.freshnessGroupingKey, 'display_family_id|frequency|canonical_period_key');
assert.strictEqual(contract.mainStatusReadBoundary, 'USER_DATA_FRESHNESS_ONLY');
assert.strictEqual(contract.mainUiLanguage, 'RU_PLAIN_TEXT');
assert.strictEqual(contract.technicalCodesSurface, 'ADMIN_TECHNICAL_DETAILS_ONLY');
assert.strictEqual(contract.actionAuditPersistence, 'EXACTLY_ONE_DURABLE_SYSTEM_LOG_ROW_REQUIRED');
assert.strictEqual(contract.newOperationType, false);
assert.strictEqual(contract.newQueue, false);
assert.strictEqual(contract.newExecutor, false);
assert.strictEqual(contract.newDispatcher, false);
assert.strictEqual(contract.newWorker, false);
assert.strictEqual(contract.createsTrigger, false);
assert.strictEqual(contract.deletesTrigger, false);
assert.strictEqual(contract.rawWrite, false);
assert.strictEqual(contract.publishWrite, false);
assert.strictEqual(contract.productionWrite, false);
assert.strictEqual(contract.enablesUserPipeline, false);
assert.strictEqual(contract.restoreBackup, false);
assert.strictEqual(contract.physicalDelete, false);
assert.strictEqual(contract.DataLensMutation, false);

const expectedHeaders = [
  'freshness_member_id', 'display_family_id', 'dataset_code', 'profile_id',
  'series_id', 'indicator_code', 'indicator_name_ru', 'source_name_ru',
  'frequency', 'canonical_period_key', 'period_start', 'period_end',
  'period_label_ru', 'latest_load_id', 'latest_operation_id',
  'latest_loaded_at', 'quality_status', 'freshness_status', 'issue_count',
  'observed_at', 'snapshot_fingerprint', 'release_version'
];
assert.deepStrictEqual(Array.from(contract.freshnessHeaders), expectedHeaders);

const members = test.profileMembers();
assert.strictEqual(members.length, 14, 'AKORT purchase and retail must be separate members');
assert.strictEqual(new Set(members.map((row) => row.memberId)).size, members.length);
const expectedProfiles = [
  'AKORT_WEEKLY_W00',
  'ROSSTAT_WEEKLY_RETAIL_PRICES',
  'ROSSTAT_WEEKLY_RETAIL_CPI',
  'AKORT_MONTHLY_M00',
  'ROSSTAT_MONTHLY_RETAIL_PRICES_M00',
  'ROSSTAT_MONTHLY_RETAIL_CPI_M00',
  'ROSSTAT_MONTHLY_PURCHASE_INDEX_M00',
  'ROSSTAT_MONTHLY_PURCHASE_PRICES_M00',
  'ROSSTAT_MONTHLY_PPI_INDUSTRY_M00',
  'ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00',
  'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00',
  'ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00'
].sort();
assert.deepStrictEqual([...new Set(members.map((row) => row.profileId))].sort(), expectedProfiles);
const expectedFamilies = [
  'AKORT_WEEKLY_PRICES', 'ROSSTAT_WEEKLY_INDICATORS',
  'AKORT_MONTHLY_PRICES', 'ROSSTAT_MONTHLY_RETAIL',
  'ROSSTAT_MONTHLY_PURCHASE', 'ROSSTAT_MONTHLY_PRODUCER', 'INDUSTRY'
].sort();
assert.deepStrictEqual(Object.keys(test.displayFamilies()).sort(), expectedFamilies);

const rolesA = test.parseRoleAssignments(JSON.stringify({
  'viewer@example.com': 'VIEWER',
  'operator@example.com': 'operator',
  'admin@example.com': 'ADMIN'
}));
assert.strictEqual(rolesA['viewer@example.com'], 'VIEWER');
assert.strictEqual(rolesA['operator@example.com'], 'OPERATOR');
assert.strictEqual(rolesA['admin@example.com'], 'ADMIN');
const rolesB = test.parseRoleAssignments(JSON.stringify({
  viewers: ['v@example.com'], operators: ['o@example.com'], admins: ['a@example.com']
}));
assert.strictEqual(rolesB['v@example.com'], 'VIEWER');
assert.strictEqual(rolesB['o@example.com'], 'OPERATOR');
assert.strictEqual(rolesB['a@example.com'], 'ADMIN');

assert.strictEqual(test.canonicalFromParts('WEEKLY', 2026, 0, 7), '2026-W07');
assert.strictEqual(test.canonicalFromParts('MONTHLY', 2026, 7, 0), '2026-07');
assert.strictEqual(test.periodLabelRu('WEEKLY', '2026-W27'), '27-я неделя 2026 года');
assert.strictEqual(test.periodLabelRu('MONTHLY', '2026-07'), 'июль 2026 года');
assert.strictEqual(test.periodLabelRu('QUARTERLY', '2026-Q2'), '2-й квартал 2026 года');
assert.strictEqual(test.profileLabelRu('AKORT_WEEKLY_W00'), 'Недельные закупочные и розничные цены АКОРТ');
assert.strictEqual(test.periodLabelFromCanonical('2026-W27', 'AKORT_WEEKLY_W00'), '27-я неделя 2026 года');
assert.strictEqual(test.periodLabelFromCanonical('2026-07', 'AKORT_MONTHLY_M00'), 'июль 2026 года');

function fresh(overrides) {
  return Object.assign({
    freshness_member_id: 'M1', display_family_id: 'AKORT_WEEKLY_PRICES',
    dataset_code: 'AKORT_WEEKLY', profile_id: 'AKORT_WEEKLY_W00',
    series_id: '', indicator_code: 'AKORT_WEEKLY_RETAIL',
    indicator_name_ru: 'Розничные цены', source_name_ru: 'АКОРТ',
    frequency: 'WEEKLY', canonical_period_key: '2026-W27',
    period_start: '2026-07-01', period_end: '2026-07-07',
    period_label_ru: '27-я неделя 2026 года', latest_load_id: 'LOAD1',
    latest_operation_id: 'OP1', latest_loaded_at: '2026-08-06T10:00:00.000Z',
    quality_status: 'GOOD', freshness_status: 'CURRENT', issue_count: 0,
    observed_at: '2026-08-06T11:00:00.000Z', snapshot_fingerprint: 'FP',
    release_version: '4.0.0-alpha.7.4.42'
  }, overrides || {});
}
const grouped = test.groupFreshness([
  fresh(),
  fresh({ freshness_member_id: 'M2', indicator_name_ru: 'Закупочные цены', issue_count: 2, quality_status: 'WARNING' }),
  fresh({ freshness_member_id: 'M3', canonical_period_key: '2026-W28', period_label_ru: '28-я неделя 2026 года' }),
  fresh({ freshness_member_id: 'M4', display_family_id: 'ROSSTAT_WEEKLY_INDICATORS' }),
  fresh({ freshness_member_id: 'M5', display_family_id: 'INDUSTRY', dataset_code: 'INDUSTRY', series_id: 'S1', indicator_name_ru: 'Выпуск продукции' }),
  fresh({ freshness_member_id: 'M6', display_family_id: 'INDUSTRY', dataset_code: 'INDUSTRY', series_id: 'S2', indicator_name_ru: 'Запасы' }),
  fresh({ freshness_member_id: 'M7', canonical_period_key: '', period_label_ru: 'Период не определён' })
], false);
assert.strictEqual(grouped.length, 5, 'Grouping must split family, frequency and period exactly');
const merged = grouped.find((row) => row.displayFamilyId === 'AKORT_WEEKLY_PRICES' && row.canonicalPeriodKey === '2026-W27');
assert.strictEqual(merged.memberCount, 2);
assert.strictEqual(merged.issueCount, 2);
assert.strictEqual(merged.qualityStatus, 'WARNING');
const industry = grouped.find((row) => row.displayFamilyId === 'INDUSTRY');
assert.strictEqual(industry.memberCount, 2, 'Industry remains series-grain and groups only in UI');
const unknown = grouped.find((row) => row.canonicalPeriodKey === '');
assert.ok(unknown, 'Unknown period must be a separate group');
const adminGroups = test.groupFreshness([fresh()], true);
assert.strictEqual(adminGroups[0].members[0].latestLoadId, 'LOAD1');
assert.ok(adminGroups[0].members[0].technicalDetails);
assert.strictEqual(grouped[0].members[0].latestLoadId, undefined, 'Non-admin DTO must omit technical IDs');

const noDuplicates = test.uniqueMemberIds([fresh(), fresh({ freshness_member_id: 'M2' })]);
assert.strictEqual(noDuplicates.duplicates.length, 0);
const duplicates = test.uniqueMemberIds([fresh(), fresh()]);
assert.strictEqual(duplicates.duplicates.length, 1);

const weeklyMember = members.find((row) => row.memberId === 'AKORT_WEEKLY_RETAIL');
assert.strictEqual(test.rowMatchesMember({
  dataset_code: 'AKORT_WEEKLY', indicator_key: 'AKORT_WEEKLY_RETAIL',
  value_type: 'розница', index_type: ''
}, weeklyMember), true);
assert.strictEqual(test.rowMatchesMember({
  dataset_code: 'AKORT_WEEKLY', indicator_key: 'AKORT_WEEKLY_PURCHASE',
  value_type: 'закупка', index_type: ''
}, weeklyMember), false);

const ppiIndustry = members.find((row) => row.memberId === 'ROSSTAT_PPI_INDUSTRY_MONTHLY');
const ppiAgriculture = members.find((row) => row.memberId === 'ROSSTAT_PPI_AGRICULTURE_MONTHLY');
assert.strictEqual(ppiIndustry.sourceFileType, 'PPI_INDUSTRIAL');
assert.strictEqual(ppiAgriculture.sourceFileType, 'PPI_AGRI');
const mappings = [
  { is_active: true, dataset_code: 'ROSSTAT_MONTHLY', source_file_type: 'PPI_INDUSTRIAL', category_id: 'CAT_IND' },
  { is_active: true, dataset_code: 'ROSSTAT_MONTHLY', source_file_type: 'PPI_AGRI', category_id: 'CAT_AGR' }
];
const scopes = test.profileCategoryScopes(mappings);
const sharedPpiRow = {
  dataset_code: 'ROSSTAT_MONTHLY', category_id: 'CAT_IND',
  indicator_key: 'ROSSTAT_PPI_MONTHLY', value_type: 'Индекс цен производителей',
  index_type: '', month_start: '2026-06-01', year: 2026, month: 6,
  is_latest_period: true
};
assert.strictEqual(test.rowMatchesMember(sharedPpiRow, ppiIndustry, scopes[ppiIndustry.profileId]), true);
assert.strictEqual(test.rowMatchesMember(sharedPpiRow, ppiAgriculture, scopes[ppiAgriculture.profileId]), false,
  'Shared indicator keys must not collapse industry and agriculture profiles');
assert.strictEqual(test.rowMatchesMember(sharedPpiRow, ppiIndustry, {}), false,
  'A missing Rosstat mapping scope must fail closed');
assert.strictEqual(test.latestMatchingPublish([
  sharedPpiRow,
  Object.assign({}, sharedPpiRow, { category_id: 'CAT_AGR', month_start: '2026-05-01', year: 2026, month: 5 })
], ppiAgriculture, '2026-06', scopes[ppiAgriculture.profileId]), null,
  'A profile must not borrow another profile period when the preferred period is absent');

assert.strictEqual(test.freshnessRowsMatch([fresh()], [fresh()]), true);
assert.strictEqual(test.freshnessRowsMatch([fresh()], [fresh({ issue_count: 1 })]), false);

const previousSnapshot = [fresh({ freshness_member_id: 'OLD', canonical_period_key: '2026-W26' })];
const candidateSnapshot = [fresh({ freshness_member_id: 'NEW', canonical_period_key: '2026-W27' })];
let targetSnapshot = JSON.parse(JSON.stringify(previousSnapshot));
let stageSnapshot = [];
let firstTargetWrite = true;
assert.throws(() => test.runFreshnessTransaction({
  readTarget() { return JSON.parse(JSON.stringify(targetSnapshot)); },
  readStage() { return JSON.parse(JSON.stringify(stageSnapshot)); },
  writeStage(rows) { stageSnapshot = JSON.parse(JSON.stringify(rows)); },
  writeTarget(rows) {
    targetSnapshot = JSON.parse(JSON.stringify(rows));
    if (firstTargetWrite) {
      firstTargetWrite = false;
      const error = new Error('simulated target failure');
      error.code = 'SIMULATED_TARGET_FAILURE';
      throw error;
    }
  }
}, candidateSnapshot), /simulated target failure/);
assert.strictEqual(test.freshnessRowsMatch(targetSnapshot, previousSnapshot), true,
  'A failed target replacement must restore the previous projection exactly');
const successfulStore = { target: JSON.parse(JSON.stringify(previousSnapshot)), stage: [] };
const transactionResult = test.runFreshnessTransaction({
  readTarget() { return JSON.parse(JSON.stringify(successfulStore.target)); },
  readStage() { return JSON.parse(JSON.stringify(successfulStore.stage)); },
  writeStage(rows) { successfulStore.stage = JSON.parse(JSON.stringify(rows)); },
  writeTarget(rows) { successfulStore.target = JSON.parse(JSON.stringify(rows)); }
}, candidateSnapshot);
assert.strictEqual(transactionResult.readbackVerified, true);
assert.strictEqual(test.freshnessRowsMatch(successfulStore.target, candidateSnapshot), true);

assert.throws(() => test.assertAuditWritten(0), (error) => error && error.code === 'BETA23_ACTION_AUDIT_NOT_PERSISTED');
assert.strictEqual(test.assertAuditWritten(1), true);
let zeroFlushCallbackRuns = 0;
assert.throws(() => test.runAuditedAction(() => test.assertAuditWritten(0), () => { zeroFlushCallbackRuns += 1; }), (error) => error && error.code === 'BETA23_ACTION_AUDIT_NOT_PERSISTED');
assert.strictEqual(zeroFlushCallbackRuns, 0, 'flush() === 0 must block the delegated side effect');

let callbackRuns = 0;
assert.throws(() => test.runAuditedAction(() => { throw new Error('audit unavailable'); }, () => {
  callbackRuns += 1;
}), /audit unavailable/);
assert.strictEqual(callbackRuns, 0, 'A missing STARTED audit must fail before the side effect');
const auditPhases = [];
const auditedResult = test.runAuditedAction((phase) => { auditPhases.push(phase); }, () => {
  callbackRuns += 1;
  return { ok: true, status: 'SUCCESS', data: { operationId: 'OP1' } };
});
assert.strictEqual(auditedResult.ok, true);
assert.deepStrictEqual(auditPhases, ['STARTED', 'COMPLETED']);

const failedAuditPhases = [];
assert.throws(() => test.runAuditedAction((phase) => { failedAuditPhases.push(phase); }, () => {
  const error = new Error('delegated failure');
  error.code = 'DELEGATED_FAILURE';
  throw error;
}), /delegated failure/);
assert.deepStrictEqual(failedAuditPhases, ['STARTED', 'COMPLETED']);

function beta22Operation(email) {
  const workflow = {
    schemaVersion: '4.0-beta22-operation-binding-1',
    userEmail: email,
    fileId: 'FILE1', sourceHash: 'HASH1', structuralFingerprint: 'STRUCT1',
    profileId: 'AKORT_WEEKLY_W00', targetTable: 'RAW_PRICES_WEEKLY',
    normalizedRowCount: 50,
    options: { profileId: 'AKORT_WEEKLY_W00', year: '2026', week: '27' },
    confirmationFingerprint: 'CONFIRM1'
  };
  const idempotencyKey = 'BETA22|' + crypto.createHash('sha256').update(JSON.stringify(canonicalize({
    operationType: 'SOURCE_FILE_LOAD_V4', fileId: workflow.fileId,
    sourceHash: workflow.sourceHash, profileId: workflow.profileId,
    options: workflow.options
  }))).digest('hex');
  return {
    operation_type: 'SOURCE_FILE_LOAD_V4', created_by: email,
    checkpoint: {
      input: {
        fileId: 'FILE1', sourceId: 'FILE1', profileId: 'AKORT_WEEKLY_W00',
        year: '2026', week: '27', beta22Binding: workflow
      },
      meta: { idempotencyKey }
    }
  };
}
const exactOrigin = test.operationOriginResult(beta22Operation('operator@example.com'), 'operator@example.com');
assert.strictEqual(exactOrigin.allowed, true);
assert.strictEqual(test.operationOriginResult(beta22Operation('operator@example.com'), 'foreign@example.com').allowed, false);
const legacyOperation = beta22Operation('operator@example.com');
delete legacyOperation.checkpoint.input.beta22Binding;
assert.strictEqual(test.operationOriginResult(legacyOperation, 'operator@example.com').allowed, false,
  'Legacy or foreign operations must not be controllable by Beta.2.3');

assert.ok(server.includes("var ACTIONS_PROPERTY = 'AKORT_BETA23_OPERATOR_ACTIONS_ENABLED'"));
assert.ok(server.includes("var BETA22_GATE_PROPERTY = 'AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED'"));
assert.ok(server.includes("PUBLISH_USER_PIPELINE_ENABLED"));
assert.ok(server.includes("AKORT.Beta11PairedBackup.backupNow()"));
assert.ok(server.includes("AKORT.Beta16FullAuditRetention.submit("));
assert.ok(server.includes("AKORT.Beta12RollbackFacade.preview("));
assert.ok(server.includes("AKORT.Beta12RollbackFacade.submit("));
assert.ok(server.includes("AKORT.OperationEngine.resume(text_(operationId), { maxSteps: 1 })"));
assert.ok(server.includes("AKORT.OperationEngine.requestStop(text_(operationId))"));
assert.ok(server.includes("actionAudit_"));
assert.ok(server.includes('var written = logger.flush();'));
assert.ok(server.includes('if (Number(written) !== 1)'));
assert.ok(server.includes('BETA23_ACTION_AUDIT_NOT_PERSISTED'));
assert.ok(server.includes("fail closed before any delegated side effect"));
assert.ok(server.includes("FRESHNESS_STAGE_TABLE"));
assert.ok(server.includes("withFreshnessLock_"));
assert.ok(server.includes("BETA23_OPERATION_ORIGIN_NOT_ALLOWED"));
assert.ok(!server.includes("Beta.2.3 action audit write failed"));
assert.ok(server.includes("readBoundary: 'USER_DATA_FRESHNESS_ONLY'"));
assert.ok(!server.includes('SpreadsheetApp.openById("PROD'));
assert.ok(!server.includes('DriveApp.setTrashed'));
assert.ok(!server.includes('deleteRow('));
assert.ok(!server.includes('deleteSheet('));
assert.ok(!server.includes('ScriptApp.newTrigger'));
assert.ok(!server.includes('clasp push'));

const expectedApi = [
  'AKORT_beta23Overview',
  'AKORT_beta23RefreshDataFreshness', 'AKORT_beta23StartBackup',
  'AKORT_beta23StartQuickAudit', 'AKORT_beta23StartFullAudit',
  'AKORT_beta23SearchLoads', 'AKORT_beta23RollbackPreview',
  'AKORT_beta23RollbackSubmit', 'AKORT_beta23OperationStatus',
  'AKORT_beta23ContinueOperation', 'AKORT_beta23StopOperation',
  'AKORT_beta23RetryOperation'
];
expectedApi.forEach((name) => {
  assert.ok(server.includes(`function ${name}`), `${name} server wrapper missing`);
  assert.ok(ui.includes(`.${name}(`), `${name} explicit UI call missing`);
});
assert.ok(server.includes('function AKORT_beta23DataFreshness'), 'Freshness read wrapper missing');
assert.ok(ui.includes('Актуальность данных'));
assert.ok(ui.includes('Операции и откат'));
assert.ok(ui.includes('Технические сведения'));
assert.ok(ui.includes('Логический откат загрузки'));
assert.ok(ui.includes('Быстрая проверка'));
assert.ok(ui.includes('Полная проверка'));
assert.ok(!ui.includes('google.script.run['), 'Arbitrary client dispatch is forbidden');
assert.ok(!ui.includes('.AKORT_beta23Restore'), 'Backup restore must not exist');
assert.ok(!ui.includes('JSON.stringify(result.data'), 'Main flow must not dump raw result JSON');
assert.ok(ui.includes("state.role!=='ADMIN'"), 'Technical details must be hidden from non-admin roles');
const visibleMarkup = ui.slice(0, ui.indexOf('<script>'));
['DEV', 'Beta.2', 'Industry Input', 'RAW_LOAD_V4', 'load_id', 'operation_id', '2026-W27'].forEach((token) => {
  assert.ok(!visibleMarkup.includes(token), `Main visible markup must not expose technical token: ${token}`);
});
assert.ok(visibleMarkup.includes('Система аналитики 4.0 · тестовый контур'));
assert.ok(visibleMarkup.includes('Идентификатор загрузки'));
assert.ok(visibleMarkup.includes('Идентификатор операции'));
assert.ok(visibleMarkup.includes('Тип исходных данных'));
assert.ok(ui.includes('Права пользователя: ${roleRu(state.role)}'));
assert.ok(ui.includes('profileNameRu||profileRu(x.profileId)'));
assert.ok(ui.includes('periodRu||canonicalPeriodRu(x.period)'));
assert.ok(ui.includes("searchPeriodCanonical(el('searchPeriod').value)"));
assert.ok(!ui.includes('Запустить полную проверку системы в DEV?'));
assert.ok(!ui.includes('Пересобрать сведения об актуальности в DEV?'));
assert.ok(!ui.includes('Профиль: ${x.profile'));

[
  '.AKORT_beta21ControlCenterStatus();',
  'invalidatePreview',
  'previewRequestSequence',
  'currentPreviewContextKey',
  'responseIsCurrent',
  'requestSequence === state.previewRequestSequence',
  "['optYear','optMonth','optWeek']",
  'временную',
  'переместить её в корзину'
].forEach((token) => assert.ok(ui.includes(token), `Accepted shared-HTML compatibility marker missing: ${token}`));

assert.strictEqual(
  packageJson.scripts['test:beta23-control-center-operator-actions'],
  'node tests/beta23_control_center_operator_actions_static.test.js'
);
assert.ok(packageJson.scripts.test.includes('npm run test:beta23-control-center-operator-actions'));

console.log('Beta.2.3 Control Center operator actions static tests passed.');
