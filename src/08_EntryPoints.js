var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

function AKORT_printResult_(result) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Alpha.2: create or validate service tables and register the release. */
function AKORT_alpha2Install() {
  return AKORT_printResult_(AKORT.Core.install());
}

/** Alpha.2: run all Core Foundation acceptance checks. */
function AKORT_alpha2SmokeTest() {
  return AKORT_printResult_(AKORT.Core.smokeTest());
}

/** Alpha.2: show release, configuration and service-table status. */
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
