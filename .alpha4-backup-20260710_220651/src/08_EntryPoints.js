var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

function AKORT_printResult_(result) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Alpha.3: register the release and install Operation Engine settings. */
function AKORT_alpha3Install() {
  return AKORT_printResult_(AKORT.OperationEngine.install());
}

/** Alpha.3: run persisted-state-machine acceptance checks with test handlers. */
function AKORT_alpha3SmokeTest() {
  return AKORT_printResult_(AKORT.Alpha3Tests.runSmokeTest());
}

/** Alpha.3: show engine contract, settings and queue counts. */
function AKORT_alpha3Status() {
  return AKORT_printResult_(AKORT.OperationEngine.engineStatus());
}

/** Alpha.3: create a demo operation and pause it safely after PARSE. */
function AKORT_alpha3StartDemo() {
  return AKORT_printResult_(AKORT.OperationEngine.startDemo());
}

/** Alpha.3: continue the latest demo operation to SUCCESS. */
function AKORT_alpha3ContinueDemo() {
  return AKORT_printResult_(AKORT.OperationEngine.continueDemo());
}

/** Alpha.3: show the latest demo operation and its immutable step history. */
function AKORT_alpha3DemoStatus() {
  return AKORT_printResult_(AKORT.OperationEngine.demoStatus());
}

/** Alpha.2 compatibility: create or validate service tables and register current release. */
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
