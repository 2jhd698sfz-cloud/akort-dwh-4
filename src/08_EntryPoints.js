var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Run first after clasp push and authorization. */
function AKORT_alpha1SmokeTest() {
  return AKORT.Alpha1Tests.runSmokeTest();
}

/** Start a new resumable baseline snapshot. */
function AKORT_alpha1StartBaseline() {
  return AKORT.Baseline.start();
}

/** Resume the baseline snapshot from its last saved checkpoint. */
function AKORT_alpha1ContinueBaseline() {
  return AKORT.Baseline.continueRun();
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
