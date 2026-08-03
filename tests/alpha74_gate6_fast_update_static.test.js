const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const publish = read('src/07_IncrementalPublish.js');
const aggregate = read('src/21_Alpha74AggregateIntegration.js');
const gate6 = read('src/28_Alpha74Gate6Acceptance.js');
const rawHandlers = read('src/05_RawStore.js');
const sourceHandlers = read('src/06_ExistingSourceParsers.js');
const industryInput = read('src/27_Alpha74IndustryInput.js');
const operationEngine = read('src/03_OperationEngine.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function body(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0, `missing start marker: ${start}`);
  assert(to > from, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('regular price Publish is a durable complete-series state machine', () => {
  assert(publish.includes("state.workSchemaVersion='4.0-publish-work-1'"));
  assert(publish.includes("var stages=['WEEKLY','MONTHLY','INDUSTRY']"));
  assert(publish.includes('state.planFingerprint!==fingerprint'));
  assert(publish.includes('state.cursor=end'));
  assert(publish.includes('repeatPhase:true,bounded:true'));
  assert(publish.includes("mode:'INCREMENTAL_PUBLISH_DURABLE'"));
  assert(publish.includes("PUBLISH_PRICE_SERIES_PER_STEP:{value:25"));
  assert(publish.includes("PUBLISH_INDUSTRY_SERIES_PER_STEP:{value:10"));
});

test('all live RAW and source-file handlers use bounded Publish checkpoints', () => {
  assert.equal((rawHandlers.match(/applyPublishStep\(/g) || []).length, 2);
  assert.equal((sourceHandlers.match(/applyPublishStep\(/g) || []).length, 1);
  assert.equal((rawHandlers.match(/\.applyPublish\(/g) || []).length, 0);
  assert.equal((sourceHandlers.match(/\.applyPublish\(/g) || []).length, 0);
  assert(rawHandlers.includes('state.publishWork = publishStep.work'));
  assert(rawHandlers.includes('state.publishWork = reversalPublishStep.work'));
  assert(sourceHandlers.includes('state.publishWork = publishStep.work'));
  assert(operationEngine.includes('outcome && outcome.repeatPhase === true'));
  assert(operationEngine.includes('saveCheckpoint_(operation, checkpoint)'));
  assert.equal((sourceHandlers.match(/profile_\('/g) || []).length, 12);
  assert(industryInput.includes("AKORT.OperationEngine.enqueue('RAW_LOAD_V4'"));
  assert(industryInput.includes("targetTable: 'RAW_INDUSTRY'"));
});

test('large weekly and monthly calculation sources are read once per worker invocation', () => {
  assert(publish.includes('var ALPHA74_PUBLISH_SOURCE_CACHE'));
  assert(publish.includes('ALPHA74_ACCEPTED_SOURCE_CACHE'));
  assert(publish.includes("schemaVersion:'4.0-alpha74-accepted-source-snapshot-1'"));
  assert(publish.includes('ALPHA74_PUBLISH_SOURCE_CACHE.raw[sheetName]'));
  assert(publish.includes('ALPHA74_ACCEPTED_SOURCE_CACHE.rowsBySheet'));
  assert(publish.includes('ALPHA74_ACCEPTED_SOURCE_CACHE.weights'));
});

test('aggregate target projection is indexed once and invalidated at the write boundary', () => {
  const targetStage = body(aggregate, 'function readTargetRowsForStage_', 'function readTargetRowsForCombos_');
  const targetCombos = body(aggregate, 'function readTargetRowsForCombos_', 'function readTargetTailRows_');
  assert(aggregate.includes('var ALPHA74_TARGET_READ_CACHE = null'));
  assert(aggregate.includes("schemaVersion: '4.0-alpha74-target-read-cache-1'"));
  assert(targetStage.includes('targetReadCache_(target)'));
  assert(targetCombos.includes('targetReadCache_(target)'));
  assert(!targetStage.includes('batchGetValues_('));
  assert(!targetCombos.includes('batchGetValues_('));
  assert(aggregate.includes('invalidateTargetReadCache_();'));
});

test('aggregate chunks are efficient but remain inside frozen atomic limits', () => {
  assert(publish.includes("PUBLISH_AGGREGATE_EXECUTION_ENABLED:{value:false,type:'BOOLEAN',preserveExisting:true"));
  assert(aggregate.includes('PUBLISH_AGGREGATE_MATERIALIZATION_COMBOS_PER_STEP: 250'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP: 2000'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP: 500'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP: 500'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_RECONCILIATION_SERIES_PER_STEP: 500'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS: 5000'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS: 100000'));
  assert(aggregate.includes('PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS: 500'));
  assert(aggregate.includes('attemptSize = Math.max(1, Math.floor(attemptSize / 2))'));
});

test('Gate 6 drains many durable checkpoints within one bounded trigger execution', () => {
  const runner = body(gate6, 'function runOperation_', 'function enqueueSourceFile_');
  assert(gate6.includes('var OPERATION_WORK_BUDGET_MS = 190000'));
  assert(gate6.includes('var MAX_OPERATION_RESUMES_PER_WORKER = 40'));
  assert(runner.includes('while (resumes < MAX_OPERATION_RESUMES_PER_WORKER'));
  assert(runner.includes('operationProgressFingerprint_'));
  assert(runner.includes('if (next === previous) break'));
  assert(runner.includes('minRemainingMs: 10000'));
  assert(gate6.includes('reversalWork: {'));
  assert(gate6.includes('publishWork: {'));
  assert(gate6.includes('handlerState: durableHandlerProgress_(checkpoint.handlerState)'));
  assert(gate6.includes('calculationCursor: aggregate.calculationCursor'));
  assert(gate6.includes('publishBatchCursor: aggregate.publishBatchCursor'));
  assert(aggregate.includes('state.artifactPersistence = clone_(boundedArtifactPersistence)'));
  assert(aggregate.includes('state.artifactPersistence = clone_(artifactPersistence)'));
});

let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error && error.stack || error);
  }
}
console.log(JSON.stringify({ suite: 'alpha74_gate6_fast_update_static', total: tests.length, failed }, null, 2));
if (failed) process.exit(1);
