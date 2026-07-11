/**
 * AKORT 4.0 release contract.
 * All modules attach to one global namespace because Apps Script has no ES modules.
 */
var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

var AKORT_RELEASE_DEFINITION = {
  system: 'AKORT analytical monitoring system',
  version: '4.0.0-alpha.5',
  channel: 'alpha',
  environment: 'DEV',
  schemaVersion: '4.0-core-1',
  operationSchemaVersion: '4.0-operation-1',
  rawSchemaVersion: '4.0-raw-1',
  parserSchemaVersion: '4.0-parser-1',
  baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
  baselineDate: '2026-07-10',
  productionCompatibility: '3.1.7',
  purpose: 'Existing Source Parsers: twelve controlled source profiles, structural detection, exact mapping, unit normalization, parser staging and Operation Engine integration',
  serviceTables: Object.freeze([
    'SYSTEM_SETTINGS',
    'RELEASE_REGISTRY',
    'OPERATION_QUEUE',
    'OPERATION_STEPS',
    'SYSTEM_LOG',
    'RAW_STAGE',
    'RAW_LOAD_REGISTRY',
    'RAW_REVERSAL_LOG',
    'SOURCE_PROFILE_REGISTRY',
    'PARSER_STAGE',
    'PARSER_ISSUES'
  ]),
  parserProfiles: Object.freeze([
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
  ]),
  rawTargets: Object.freeze([
    'RAW_PRICES_WEEKLY',
    'RAW_PRICES_MONTHLY',
    'RAW_INDUSTRY'
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
    '05_RawStore.js',
    '06_ExistingSourceParsers.js',
    '08_EntryPoints.js',
    '09_Alpha3Tests.js',
    '10_Alpha4Tests.js',
    '11_Alpha5Tests.js',
    'appsscript.json'
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
    rawSchemaVersion: AKORT.Release.rawSchemaVersion,
    parserSchemaVersion: AKORT.Release.parserSchemaVersion,
    baselineLabel: AKORT.Release.baselineLabel,
    baselineDate: AKORT.Release.baselineDate,
    productionCompatibility: AKORT.Release.productionCompatibility,
    purpose: AKORT.Release.purpose,
    serviceTables: AKORT.Release.serviceTables.slice(),
    parserProfiles: AKORT.Release.parserProfiles.slice(),
    rawTargets: AKORT.Release.rawTargets.slice(),
    operationPhases: AKORT.Release.operationPhases.slice(),
    sourceFiles: AKORT.Release.sourceFiles.slice()
  };
};

AKORT.Release = Object.freeze(AKORT_RELEASE_DEFINITION);

function AKORT_alpha5ReleaseInfo() {
  var result = AKORT.Release.manifest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
