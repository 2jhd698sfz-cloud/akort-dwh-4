/** AKORT 4.0 release contract. */
var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

var AKORT_RELEASE_DEFINITION = {
  system: 'AKORT analytical monitoring system',
  version: '4.0.0-alpha.7.4.11',
  channel: 'alpha',
  environment: 'DEV',
  schemaVersion: '4.0-core-1',
  operationSchemaVersion: '4.0-operation-2',
  rawSchemaVersion: '4.0-raw-1',
  parserSchemaVersion: '4.0-parser-1',
  publishSchemaVersion: '4.0-publish-1',
  dependencySchemaVersion: '4.0-dependency-3',
  dispatcherSchemaVersion: '4.0-dispatcher-4',
  baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
  baselineDate: '2026-07-10',
  productionCompatibility: '3.1.7',
  purpose: 'Alpha.7.4 incremental aggregate integration with Alpha.6-style bounded target identity scans, affected-series-only reads, appended-tail verification, durable Gate 5 aggregate-batch materialization, staged/publication period-identity repair, exact-duplicate lost-response recovery, cursor-preserving replay resume, preserved full-build reuse and a controlled RAW_INDUSTRY operator form; regular physical publication remains gated',
  serviceTables: Object.freeze(['SYSTEM_SETTINGS','RELEASE_REGISTRY','OPERATION_QUEUE','OPERATION_STEPS','AGGREGATE_STAGE','SYSTEM_LOG','RAW_STAGE','RAW_LOAD_REGISTRY','RAW_REVERSAL_LOG','SOURCE_PROFILE_REGISTRY','PARSER_STAGE','PARSER_ISSUES','PUBLISH_IMPACT','PUBLISH_RUNS','PUBLISH_RECONCILIATION','INDUSTRY_INPUT','INDUSTRY_INPUT_LOG']),
  rawTargets: Object.freeze(['RAW_PRICES_WEEKLY','RAW_PRICES_MONTHLY','RAW_INDUSTRY']),
  publishTargets: Object.freeze(['PUBLISH_PRICES_WEEKLY','PUBLISH_PRICES_MONTHLY','PUBLISH_INDUSTRY']),
  plannedTargets: Object.freeze(['PUBLISH_PRICE_AGGREGATES']),
  calculatedIndicators: Object.freeze(['YoY','MoM','WoW','December','YTD','MA4','markup pp','latest period']),
  operationPhases: Object.freeze(['DISCOVER','VALIDATE','PARSE','STAGE','COMMIT_RAW','UPDATE_PUBLISH','PREPARING_AGGREGATE_IMPACT','MATERIALIZING_AGGREGATE_INPUTS','CALCULATING_AGGREGATE_SLICES','STAGING_AGGREGATE_ROWS','UPDATING_AGGREGATES','UPDATING_AGGREGATE_LATEST','RECONCILING_AGGREGATES','UPDATE_STATUS','QUICK_AUDIT','FINALIZING','SUCCESS']),
  sourceFiles: Object.freeze(['00_Release.js','01_Config.js','02_Core.js','03_OperationEngine.js','04_TestOperationHandlers.js','05_RawStore.js','06_Baseline.js','06_ExistingSourceParsers.js','07_Alpha1Tests.js','07_IncrementalPublish.js','08_EntryPoints.js','09_Alpha3Tests.js','10_Alpha4Tests.js','11_Alpha5Tests.js','12_Alpha6Tests.js','13_Alpha71AggregateContract.js','14_Alpha71ContractTests.js','15_Alpha72AggregateCalculator.js','16_Alpha72CalculatorTests.js','17_Alpha72GoldenAcceptance.js','18_Alpha73SpecialAggregateDefinitions.js','19_Alpha73RevisionPlanner.js','20_Alpha73Tests.js','21_Alpha74AggregateIntegration.js','22_Alpha74Tests.js','23_Alpha74Gate1Cleanup.js','24_Alpha74Gate3Acceptance.js','25_Alpha74Gate4Acceptance.js','26_Alpha74Gate5Acceptance.js','27_Alpha74IndustryInput.js'])
};
AKORT_RELEASE_DEFINITION.manifest = function () { return {
  system:AKORT.Release.system,version:AKORT.Release.version,channel:AKORT.Release.channel,environment:AKORT.Release.environment,
  schemaVersion:AKORT.Release.schemaVersion,operationSchemaVersion:AKORT.Release.operationSchemaVersion,rawSchemaVersion:AKORT.Release.rawSchemaVersion,
  parserSchemaVersion:AKORT.Release.parserSchemaVersion,publishSchemaVersion:AKORT.Release.publishSchemaVersion,dependencySchemaVersion:AKORT.Release.dependencySchemaVersion,dispatcherSchemaVersion:AKORT.Release.dispatcherSchemaVersion,
  baselineLabel:AKORT.Release.baselineLabel,baselineDate:AKORT.Release.baselineDate,productionCompatibility:AKORT.Release.productionCompatibility,purpose:AKORT.Release.purpose,
  serviceTables:AKORT.Release.serviceTables.slice(),rawTargets:AKORT.Release.rawTargets.slice(),publishTargets:AKORT.Release.publishTargets.slice(),plannedTargets:AKORT.Release.plannedTargets.slice(),calculatedIndicators:AKORT.Release.calculatedIndicators.slice(),operationPhases:AKORT.Release.operationPhases.slice(),sourceFiles:AKORT.Release.sourceFiles.slice()
}; };
AKORT.Release = Object.freeze(AKORT_RELEASE_DEFINITION);
function AKORT_alpha74ReleaseInfo(){var r=AKORT.Release.manifest();console.log(JSON.stringify(r,null,2));return r;}
function AKORT_alpha6ReleaseInfo(){return AKORT_alpha74ReleaseInfo();}
