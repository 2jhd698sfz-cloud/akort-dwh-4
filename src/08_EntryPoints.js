var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Run first after clasp push and authorization. */
function AKORT_alpha1SmokeTest() {
  var result = AKORT.Alpha1Tests.runSmokeTest();

  console.log(JSON.stringify(result, null, 2));

  return result;
}

/** Start a new resumable baseline snapshot. */
function AKORT_alpha1StartBaseline() {
  var result = AKORT.Baseline.start();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Resume the baseline snapshot from its last saved checkpoint. */
function AKORT_alpha1ContinueBaseline() {
  var result = AKORT.Baseline.continueRun();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Return current checkpoint and the latest completed report link. */
function AKORT_alpha1BaselineStatus() {
  return AKORT.Baseline.status();
}

/** Clear only the active checkpoint. It never deletes report files or data. */
function AKORT_alpha1ResetBaselineState() {
  return AKORT.Baseline.reset();
}

/** Show masked configuration values for troubleshooting. */
function AKORT_alpha1ConfigSummary() {
  return AKORT.Config.describe();
}

/** Read-only environment validation. */
function AKORT_alpha1EnvironmentCheck() {
  return AKORT.EnvironmentGuard.verify();
}
