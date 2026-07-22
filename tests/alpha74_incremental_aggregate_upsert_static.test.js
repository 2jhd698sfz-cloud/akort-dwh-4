'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const repo = process.env.AKORT_ALPHA74_REPO || process.cwd();
const sourcePath = path.join(repo, 'src', '21_Alpha74AggregateUpsert.js');
const testsPath = path.join(repo, 'src', '22_Alpha74UpsertTests.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const testsSource = fs.readFileSync(testsPath, 'utf8');

const HEADERS = [
  'dataset_code','source_name','frequency','aggregate_level','aggregate_id','aggregate_name','category_id','product_group','product_name','value_type','index_type','period_start','year','quarter','month','period_label','category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count','coverage_weight_sum','is_latest_period','aggregate_value','aggregate_base_value'
];
function text(v){ return v == null ? '' : String(v).trim(); }
function periodKey(frequency, value){
  const f = text(frequency).toLowerCase();
  if (value instanceof Date) value = value.toISOString().slice(0,10);
  const s = text(value);
  if (f === 'monthly') {
    if (!/^\d{4}-\d{2}/.test(s)) throw Object.assign(new Error('bad month'), {code:'AGG_PERIOD_INVALID'});
    return s.slice(0,7);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw Object.assign(new Error('bad date'), {code:'AGG_PERIOD_INVALID'});
  return s.slice(0,10);
}
function subject(def){ return text(def.aggregate_subject_id || def.aggregate_id || def.group_id || def.category_id); }
function seriesKey(def){
  return [text(def.dataset_code),text(def.frequency).toLowerCase(),text(def.aggregate_level).toLowerCase(),subject(def),text(def.value_type),text(def.index_type).toLowerCase(),text(def.calculation_method),text(def.weight_rule_id),text(def.membership_rule_id || 'NONE')].join('|');
}
function rowKey(def){ return seriesKey(def) + '|' + periodKey(def.frequency, def.period_start); }
const context = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  isFinite,
  AKORT: {
    AggregateContract: {
      Headers: HEADERS.slice(),
      Test: {periodKey},
      aggregateSeriesKey: seriesKey,
      aggregateRowKey: rowKey,
    },
    AggregateCalculator: {
      calculateBatch: (request) => ({ok:true,status:'SUCCESS',calculation_id:request.calculation_id,rows:[]}),
      buildCalculationFingerprint: (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'),
      Test: {sha256: (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')},
    },
    AggregateRevisionPlanner: {
      buildLatestIntents: () => ({intents:[],conflicts:[],fingerprint:'LATEST'}),
    },
  },
  AKORT_printResult_: (x) => x,
};
vm.createContext(context);
vm.runInContext(source, context, {filename:sourcePath});
vm.runInContext(testsSource, context, {filename:testsPath});

const result = context.AKORT.Alpha74UpsertTests.runPureTests();
if (!result.ok || result.failed !== 0 || result.passed !== 65 || result.skipped !== 15 || result.total !== 80) {
  console.error(JSON.stringify(result, null, 2));
  throw new Error('Alpha.7.4 candidate-r2 pure/model test matrix failed.');
}

const required = [
  "var VERSION = '4.0-incremental-aggregate-refresh-2'",
  "RUNS: 'AGGREGATE_REFRESH_RUNS'",
  "QUEUE: 'AGGREGATE_REFRESH_QUEUE'",
  "BATCHES: 'AGGREGATE_REFRESH_BATCHES'",
  "BACKUP: 'AGGREGATE_REFRESH_BACKUP'",
  "plannerInput_(request, existingCanonicalRows, executeCalculator)",
  "input.execute_calculator = executeCalculator === true",
  "phase='CALCULATE_SLICES'",
  "function calculateSlicesPhase_",
  "function proveCalculationQueue_",
  "function proveMutationQueue_",
  "function verifyAffectedPhase_",
  "function verifyUnrelatedPhase_",
  "function rollbackVerifyAffectedPhase_",
  "function rollbackUnrelatedScanPhase_",
  "function physicalSeriesSubject_",
  "function physicalTargetKey_",
  "function legacyAggregateIdForRow_",
  "function mergeCalculatedCategoryRow_",
  "function syntheticCategoryDefinition_",
  "function categoryDefinitionsForRow_",
  "function readRowsForRun_",
  "version:'SHA256_LANES_V1'",
  "calculation_queue_start_row",
  "mutation_queue_start_row",
  "result_artifact_id",
  "ALPHA74_CALCULATION_QUEUE_INCOMPLETE",
  "ALPHA74_QUEUE_MODEL_BINDING_MISMATCH",
  "ALPHA74_AMBIGUOUS_WRITE",
  "userEnteredFormat.numberFormat",
  "Spreadsheets.batchUpdate",
  "AKORT_ALPHA74_ACTIVE_RUN_ID",
  "execution_enabled_default:false",
  "regular_pipeline_enabled:false",
];
for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`Missing candidate-r2 architecture marker: ${marker}`);
}
const forbidden = [
  "replayPlanner_(request,scan.rows,true)",
  "function verifyPhase_",
  "function rollbackVerifyPhase_",
  "readTable_(sheets.queue, QUEUE_HEADERS)",
  "readTable_(serviceSheets_().batches,BATCH_HEADERS)",
  "readTable_(serviceSheets_().backup,BACKUP_HEADERS)",
  "AGGREGATE_CANONICAL_REGISTRY",
  "clasp push --force",
];
for (const marker of forbidden) {
  if (source.includes(marker)) throw new Error(`Withdrawn or unbounded candidate marker remains: ${marker}`);
}
if (/function\s+AKORT_alpha74UpsertDispatcherWorker\(\)\{return AKORT_printResult_/.test(source)) throw new Error('Trigger worker must not wrap the result logger.');
if (!/while\(!TERMINAL\[text_\(result\.status\)\]/.test(source)) throw new Error('Dispatcher does not process multiple durable steps per invocation.');
if (/function visibleSeriesKey_\(row\)[\s\S]{0,300}row\.aggregate_id/.test(source)) throw new Error('Physical series identity still depends on period-derived aggregate_id.');
if (!source.includes("targetedCurrent_(targetSheet_(),slice,request,true,[])")) throw new Error('Rollback final verification does not use restored geometry.');
const mutationStart = source.indexOf('function processMutationPhase_');
const mutationEnd = source.indexOf('function verifyAffectedPhase_', mutationStart);
const mutationSource = source.slice(mutationStart, mutationEnd);
if (mutationSource.includes('getDataRange')) throw new Error('Mutation phase contains unbounded getDataRange.');
if (!mutationSource.includes('proveMutationQueue_')) throw new Error('Mutation phase lacks exact model/queue proof.');
const verifyStart = source.indexOf('function verifyAffectedPhase_');
const verifyEnd = source.indexOf('function rollbackSort_', verifyStart);
const verifySource = source.slice(verifyStart, verifyEnd);
if (verifySource.includes('getDataRange')) throw new Error('Final verification contains unbounded getDataRange.');
if (!verifySource.includes('verification_cursor')) throw new Error('Final verification lacks durable cursor.');
const rollbackVerifyStart = source.indexOf('function rollbackVerifyAffectedPhase_');
const rollbackVerifyEnd = source.indexOf('function rollbackVerifyGeometryPhase_', rollbackVerifyStart);
const rollbackVerifySource = source.slice(rollbackVerifyStart, rollbackVerifyEnd);
if (rollbackVerifySource.includes('getDataRange')) throw new Error('Rollback verification contains unbounded getDataRange.');
if (!rollbackVerifySource.includes('rollback_cursor')) throw new Error('Rollback verification lacks durable cursor.');

console.log(JSON.stringify({
  suite: result.suite,
  total: result.total,
  passed: result.passed,
  failed: result.failed,
  skipped: result.skipped,
  source_guard: 'PASS',
  status: 'PASS',
}, null, 2));
