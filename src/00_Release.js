/** AKORT 4.0 release contract. */
var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

var AKORT_RELEASE_DEFINITION = {
  system: 'AKORT analytical monitoring system',
  version: '4.0.0-alpha.6',
  channel: 'alpha',
  environment: 'DEV',
  schemaVersion: '4.0-core-1',
  operationSchemaVersion: '4.0-operation-1',
  rawSchemaVersion: '4.0-raw-1',
  parserSchemaVersion: '4.0-parser-1',
  publishSchemaVersion: '4.0-publish-1',
  dependencySchemaVersion: '4.0-dependency-1',
  baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
  baselineDate: '2026-07-10',
  productionCompatibility: '3.1.7',
  purpose: 'Incremental Publish: affected-series closure, dependent periods, price and industry dynamics, revisions, latest points, aggregate refresh and triple reconciliation',
  serviceTables: Object.freeze(['SYSTEM_SETTINGS','RELEASE_REGISTRY','OPERATION_QUEUE','OPERATION_STEPS','SYSTEM_LOG','RAW_STAGE','RAW_LOAD_REGISTRY','RAW_REVERSAL_LOG','SOURCE_PROFILE_REGISTRY','PARSER_STAGE','PARSER_ISSUES','PUBLISH_IMPACT','PUBLISH_RUNS','PUBLISH_RECONCILIATION']),
  rawTargets: Object.freeze(['RAW_PRICES_WEEKLY','RAW_PRICES_MONTHLY','RAW_INDUSTRY']),
  publishTargets: Object.freeze(['PUBLISH_PRICES_WEEKLY','PUBLISH_PRICES_MONTHLY','PUBLISH_INDUSTRY','PUBLISH_PRICE_AGGREGATES']),
  calculatedIndicators: Object.freeze(['YoY','MoM','WoW','December','YTD','MA4','markup pp','latest period']),
  operationPhases: Object.freeze(['DISCOVER','VALIDATE','PARSE','STAGE','COMMIT_RAW','UPDATE_PUBLISH','UPDATE_AGGREGATES','UPDATE_STATUS','QUICK_AUDIT','SUCCESS']),
  sourceFiles: Object.freeze(['00_Release.js','01_Config.js','02_Core.js','03_OperationEngine.js','04_TestOperationHandlers.js','05_RawStore.js','06_ExistingSourceParsers.js','07_IncrementalPublish.js','08_EntryPoints.js','09_Alpha3Tests.js','10_Alpha4Tests.js','11_Alpha5Tests.js','12_Alpha6Tests.js'])
};
AKORT_RELEASE_DEFINITION.manifest = function () { return {
  system:AKORT.Release.system,version:AKORT.Release.version,channel:AKORT.Release.channel,environment:AKORT.Release.environment,
  schemaVersion:AKORT.Release.schemaVersion,operationSchemaVersion:AKORT.Release.operationSchemaVersion,rawSchemaVersion:AKORT.Release.rawSchemaVersion,
  parserSchemaVersion:AKORT.Release.parserSchemaVersion,publishSchemaVersion:AKORT.Release.publishSchemaVersion,dependencySchemaVersion:AKORT.Release.dependencySchemaVersion,
  baselineLabel:AKORT.Release.baselineLabel,baselineDate:AKORT.Release.baselineDate,productionCompatibility:AKORT.Release.productionCompatibility,purpose:AKORT.Release.purpose,
  serviceTables:AKORT.Release.serviceTables.slice(),rawTargets:AKORT.Release.rawTargets.slice(),publishTargets:AKORT.Release.publishTargets.slice(),calculatedIndicators:AKORT.Release.calculatedIndicators.slice(),operationPhases:AKORT.Release.operationPhases.slice(),sourceFiles:AKORT.Release.sourceFiles.slice()
}; };
AKORT.Release = Object.freeze(AKORT_RELEASE_DEFINITION);
function AKORT_alpha6ReleaseInfo(){var r=AKORT.Release.manifest();console.log(JSON.stringify(r,null,2));return r;}
