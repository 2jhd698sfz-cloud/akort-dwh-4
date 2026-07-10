/**
 * AKORT 4.0 release contract.
 * All modules attach to one global namespace because Apps Script has no ES modules.
 */
var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

var AKORT_RELEASE_DEFINITION = {
  system: 'AKORT analytical monitoring system',
  version: '4.0.0-alpha.3',
  channel: 'alpha',
  environment: 'DEV',
  schemaVersion: '4.0-core-1',
  operationSchemaVersion: '4.0-operation-1',
  baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
  baselineDate: '2026-07-10',
  productionCompatibility: '3.1.7',
  purpose: 'Operation Engine: persisted state machine, checkpoints, resume, retry, dead-letter and test handlers without RAW or Publish changes',
  serviceTables: Object.freeze([
    'SYSTEM_SETTINGS',
    'RELEASE_REGISTRY',
    'OPERATION_QUEUE',
    'OPERATION_STEPS',
    'SYSTEM_LOG'
  ]),
  operationPhases: Object.freeze([
    'DISCOVER',
    'VALIDATE',
    'PARSE',
    'STAGE',
    'COMMIT_RAW',
    'UPDATE_PUBLISH',
    'UPDATE_AGGREGATES',
    'UPDATE_STATUS',
    'QUICK_AUDIT',
    'SUCCESS'
  ]),
  sourceFiles: Object.freeze([
    '00_Release.js',
    '01_Config.js',
    '02_Core.js',
    '03_OperationEngine.js',
    '04_TestOperationHandlers.js',
    '08_EntryPoints.js',
    '09_Alpha3Tests.js'
  ])
};

AKORT_RELEASE_DEFINITION.manifest = function () {
  return {
    system: AKORT.Release.system,
    version: AKORT.Release.version,
    channel: AKORT.Release.channel,
    environment: AKORT.Release.environment,
    schemaVersion: AKORT.Release.schemaVersion,
    operationSchemaVersion: AKORT.Release.operationSchemaVersion,
    baselineLabel: AKORT.Release.baselineLabel,
    baselineDate: AKORT.Release.baselineDate,
    productionCompatibility: AKORT.Release.productionCompatibility,
    purpose: AKORT.Release.purpose,
    serviceTables: AKORT.Release.serviceTables.slice(),
    operationPhases: AKORT.Release.operationPhases.slice(),
    sourceFiles: AKORT.Release.sourceFiles.slice()
  };
};

AKORT.Release = Object.freeze(AKORT_RELEASE_DEFINITION);

function AKORT_alpha3ReleaseInfo() {
  var result = AKORT.Release.manifest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
