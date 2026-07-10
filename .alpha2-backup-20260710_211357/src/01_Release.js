var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Release = Object.freeze({
  system: 'AKORT analytical monitoring system',
  version: '4.0.0-alpha.1',
  channel: 'alpha',
  environment: 'DEV',
  baselineLabel: 'VERIFIED_BASELINE_2026-07-10',
  baselineDate: '2026-07-10',
  productionCompatibility: '3.1.7',
  purpose: 'DEV foundation, environment guard, smoke tests and resumable baseline snapshot'
});

function AKORT_alpha1ReleaseInfo() {
  return JSON.parse(JSON.stringify(AKORT.Release));
}
