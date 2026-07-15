var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

function AKORT_printResult_(result) { console.log(JSON.stringify(result, null, 2)); return result; }

function AKORT_alpha6Install(){return AKORT_printResult_(AKORT.IncrementalPublish.install());}
function AKORT_alpha6SmokeTest(){return AKORT_printResult_(AKORT.Alpha6Tests.runSmokeTest());}
function AKORT_alpha6Status(){return AKORT_printResult_(AKORT.Result.success('Incremental Publish status loaded.',AKORT.IncrementalPublish.statusSummary()));}
function AKORT_alpha6CreatePublishBackup(){return AKORT_printResult_(AKORT.IncrementalPublish.createPublishBackup());}
function AKORT_alpha6StartReconciliation(){return AKORT_printResult_(AKORT.IncrementalPublish.startReconciliation());}
function AKORT_alpha6ContinueReconciliation(){return AKORT_printResult_(AKORT.IncrementalPublish.continueReconciliation());}
function AKORT_alpha6ReconciliationStatus(){return AKORT_printResult_(AKORT.IncrementalPublish.reconciliationStatus());}
function AKORT_alpha6ResetReconciliation(){return AKORT_printResult_(AKORT.IncrementalPublish.resetReconciliation());}
function AKORT_alpha6StartReconciliationDispatcher(){return AKORT_printResult_(AKORT.IncrementalPublish.startReconciliationDispatcher());}
function AKORT_alpha6StopReconciliationDispatcher(){return AKORT_printResult_(AKORT.IncrementalPublish.stopReconciliationDispatcher());}
function AKORT_alpha6ReconciliationDispatcherStatus(){return AKORT_printResult_(AKORT.IncrementalPublish.reconciliationDispatcherStatus());}
function AKORT_alpha6ReconciliationDispatcherWorker(){return AKORT.IncrementalPublish.reconciliationDispatcherWorker();}
function AKORT_alpha624RecoverFailedReconciliation(){return AKORT_printResult_(AKORT.IncrementalPublish.recoverFailedReconciliation());}
function AKORT_alpha624PreRecoveryParityTest(){return AKORT_printResult_(AKORT.Core.safeRun('ALPHA624_PRE_RECOVERY_PARITY_TEST',function(){AKORT.EnvironmentGuard.assertDev();return AKORT.Result.success('Alpha.6.2.4 markup and monthly-index parity passed.',AKORT.IncrementalPublish.Test.parityProbe());},{lock:true,persistLogs:true}));}
function AKORT_alpha624MarkupParityTest(){return AKORT_alpha624PreRecoveryParityTest();}


/** Alpha.5: register the release and install parser profiles, staging and issue tables. */
function AKORT_alpha5Install() {
  return AKORT_printResult_(AKORT.ExistingSourceParsers.install());
}

/** Alpha.5: run all parser, mapping, conversion and Operation Engine acceptance checks. */
function AKORT_alpha5SmokeTest() {
  return AKORT_printResult_(AKORT.Alpha5Tests.runSmokeTest());
}

/** Alpha.5: show parser profiles, settings and service-table counts. */
function AKORT_alpha5Status() {
  return AKORT_printResult_(AKORT.Result.success('Existing Source Parsers status loaded.', AKORT.ExistingSourceParsers.statusSummary()));
}

/** Alpha.5: return the twelve supported source profiles without reading or changing data. */
function AKORT_alpha5ProfileCatalog() {
  return AKORT_printResult_(AKORT.Result.success('Existing source profile catalog loaded.', AKORT.ExistingSourceParsers.profiles()));
}

/** Alpha.4: register the release, install Operation Engine and create RAW Store service tables. */
function AKORT_alpha4Install() {
  return AKORT_printResult_(AKORT.RawStore.install());
}

/** Alpha.4: run staging, duplicate, revision, reversal and Operation Engine acceptance checks. */
function AKORT_alpha4SmokeTest() {
  return AKORT_printResult_(AKORT.Alpha4Tests.runSmokeTest());
}

/** Alpha.4: show RAW Store contract, settings, service-table counts and load statuses. */
function AKORT_alpha4Status() {
  return AKORT_printResult_(AKORT.Result.success('Raw Store status loaded.', AKORT.RawStore.statusSummary()));
}

/** Alpha.3 compatibility: register the current release and install Operation Engine settings. */
function AKORT_alpha3Install() {
  return AKORT_printResult_(AKORT.OperationEngine.install());
}

/** Alpha.3 compatibility regression with test handlers. */
function AKORT_alpha3SmokeTest() {
  return AKORT_printResult_(AKORT.Alpha3Tests.runSmokeTest());
}

/** Alpha.3 compatibility status. */
function AKORT_alpha3Status() {
  return AKORT_printResult_(AKORT.OperationEngine.engineStatus());
}

/** Alpha.3: create a test-only demo operation and pause it safely after PARSE. */
function AKORT_alpha3StartDemo() {
  return AKORT_printResult_(AKORT.OperationEngine.startDemo());
}

/** Alpha.3: continue the latest test-only demo operation to SUCCESS. */
function AKORT_alpha3ContinueDemo() {
  return AKORT_printResult_(AKORT.OperationEngine.continueDemo());
}

/** Alpha.3: show the latest test-only demo operation and step history. */
function AKORT_alpha3DemoStatus() {
  return AKORT_printResult_(AKORT.OperationEngine.demoStatus());
}

/** Alpha.2 compatibility: create or validate core service tables and register current release. */
function AKORT_alpha2Install() {
  return AKORT_printResult_(AKORT.Core.install());
}

/** Alpha.2 compatibility regression. */
function AKORT_alpha2SmokeTest() {
  return AKORT_printResult_(AKORT.Core.smokeTest());
}

/** Alpha.2 compatibility status. */
function AKORT_alpha2Status() {
  return AKORT_printResult_(AKORT.Core.status());
}

/** Alpha.1 compatibility regression. */
function AKORT_alpha1SmokeTest() {
  return AKORT_printResult_(AKORT.Alpha1Tests.runSmokeTest());
}

/** Start a new resumable baseline snapshot. */
function AKORT_alpha1StartBaseline() {
  return AKORT_printResult_(AKORT.Baseline.start());
}

/** Resume the baseline snapshot from its last saved checkpoint. */
function AKORT_alpha1ContinueBaseline() {
  return AKORT_printResult_(AKORT.Baseline.continueRun());
}

/** Return current checkpoint and the latest completed report link. */
function AKORT_alpha1BaselineStatus() {
  return AKORT_printResult_(AKORT.Baseline.status());
}

/** Clear only the active checkpoint. It never deletes report files or data. */
function AKORT_alpha1ResetBaselineState() {
  return AKORT_printResult_(AKORT.Baseline.reset());
}

/** Show masked configuration values for troubleshooting. */
function AKORT_alpha1ConfigSummary() {
  return AKORT_printResult_(AKORT.Config.describe());
}

/** Read-only environment validation. */
function AKORT_alpha1EnvironmentCheck() {
  return AKORT_printResult_(AKORT.EnvironmentGuard.verify());
}

/** Alpha.6 hotfix 1: show the resumable alpha.4 compatibility-test checkpoint. */
function AKORT_alpha4SmokeStatus() {
  return AKORT_printResult_(AKORT.Alpha4Tests.status());
}

/** Alpha.6 hotfix 1: delete only ALPHA4_TEST_* artifacts and clear the checkpoint. */
function AKORT_alpha4SmokeReset() {
  return AKORT_printResult_(AKORT.Alpha4Tests.reset());
}
function AKORT_probeIncrementalRead() {
  var id = '1ds8KXqdc-jir_dUCrTshRug4vG7hlqSiwxAbm6VhAbQ';
  var result = {};

  try {
    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName('PUBLISH_PRICES_WEEKLY');

    result = {
      ok: true,
      spreadsheetName: ss.getName(),
      sheetName: sheet.getName(),
      lastRow: sheet.getLastRow(),
      lastColumn: sheet.getLastColumn(),
      sample: sheet.getRange(1, 1, 2, 2).getDisplayValues()
    };
  } catch (error) {
    result = {
      ok: false,
      message: String(error.message || error),
      stack: String(error.stack || '')
    };
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
}
function AKORT_probeIncrementalWrite() {
  var id = '1ds8KXqdc-jir_dUCrTshRug4vG7hlqSiwxAbm6VhAbQ';
  var probeSheetName = '__AKORT_ACCESS_PROBE__';
  var result = {};

  try {
    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName(probeSheetName);

    if (!sheet) {
      sheet = ss.insertSheet(probeSheetName);
    }

    sheet.clear();
    sheet.getRange('A1:B2').setValues([
      ['probe', 'value'],
      [new Date().toISOString(), 'OK']
    ]);

    SpreadsheetApp.flush();

    result = {
      ok: true,
      writtenValue: sheet.getRange('B2').getDisplayValue()
    };

    ss.deleteSheet(sheet);
    SpreadsheetApp.flush();
  } catch (error) {
    result = {
      ok: false,
      message: String(error.message || error),
      stack: String(error.stack || '')
    };
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
}
