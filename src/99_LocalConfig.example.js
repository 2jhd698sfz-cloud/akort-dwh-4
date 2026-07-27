/**
 * Copy this file to 99_LocalConfig.js and replace every placeholder.
 * 99_LocalConfig.js is excluded by .gitignore but is uploaded by clasp.
 */
// var AKORT_LOCAL_CONFIG = Object.freeze({
//   environment: 'DEV',
//   expectedScriptId: 'DEV_SCRIPT_ID',
//   baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
//   baselineReportId: 'SUCCESSFUL_ALPHA1_BASELINE_REPORT_ID',
//   resources: {
//     dwhSpreadsheetId: 'DEV_DWH_ID',
//     publishSpreadsheetId: 'DEV_PUBLISH_ID',
//     devRootFolderId: 'DEV_ROOT_FOLDER_ID',
//     devTablesFolderId: 'DEV_TABLES_FOLDER_ID',
//     testFilesFolderId: 'TEST_FILES_FOLDER_ID',
//     testResultsFolderId: 'TEST_RESULTS_FOLDER_ID',
//     releasesFolderId: 'RELEASES_FOLDER_ID',
//     docsFolderId: 'DOCS_FOLDER_ID',
//     alpha71BaselinePublishSpreadsheetId: 'IMMUTABLE_ALPHA71_BASELINE_PUBLISH_ID'
//   },
//   expectedNames: {
//     dwh: 'АКОРТ — DWH TECH 4.0 DEV',
//     publish: 'АКОРТ — Publish 4.0 DEV',
//     devRoot: '07_Разработка системы 4.0'
//   },
//   blockedResourceIds: ['PRODUCTION_ID_1', 'PRODUCTION_ID_2'],
//   baselineExpected: {
//     rawObservationRows: 27899,
//     publishMainRows: 35434,
//     aggregateRows: 61636,
//     weeklyLatestRows: 157,
//     monthlyLatestRows: 378,
//     aggregateLatestRows: 1364
//   },
//   baselinePhysicalExpected: {
//     rawWeeklyRows: 13711,
//     rawMonthlyRows: 11970,
//     rawIndustryRows: 2266,
//     publishWeeklyRows: 20211,
//     publishMonthlyRows: 12957,
//     publishIndustryRows: 2266,
//     publishAggregateRows: 61636
//   },
//   baseline: { chunkRows: 500, executionBudgetMs: 220000 },
//   system: {
//     logLevel: 'INFO',
//     lockTimeoutMs: 30000,
//     maxOperationAttempts: 3,
//     timezone: 'Europe/Moscow',
//     operationExecutionBudgetMs: 180000,
//     operationMaxStepsPerRun: 3,
//     operationMinRemainingMs: 15000,
//     operationLeaseMs: 120000,
//     rawSchemaVersion: '4.0-raw-1',
//     rawStageBatchSize: 500,
//     rawDuplicatePolicy: 'REUSE_COMMITTED',
//     rawReversalPolicy: 'LATEST_LOAD_ONLY',
//     rawStoreEnabled: true,
//     parserSchemaVersion: '4.0-parser-1',
//     parserProfileMinScore: 60,
//     parserProfileMinMargin: 15,
//     parserFailOnUnmapped: true,
//     parserTempConversionEnabled: true,
//     parserStageBatchSize: 500,
//     publishSchemaVersion: '4.0-publish-1',
//     publishDependencyVersion: '4.0-dependency-1',
//     publishEngineEnabled: true,
//     publishWriteBatchSize: 1000,
//     publishReconciliationChunkRows: 500,
//     publishReconciliationTolerance: 0
//   }
// });

// Alpha.6 uses Config.resources.publishSpreadsheetId and testResultsFolderId for DEV-only reconciliation files.
