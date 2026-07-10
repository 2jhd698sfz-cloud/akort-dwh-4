var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Alpha1Tests = (function () {
  function test_(id, fn) {
    try {
      var data = fn();
      return { id: id, status: 'PASS', data: data === undefined ? null : data, error: null };
    } catch (error) {
      return { id: id, status: 'FAIL', data: null, error: String(error.message || error) };
    }
  }

  function runSmokeTest() {
    var tests = [];
    tests.push(test_('release_version', function () {
      if (AKORT.Release.version !== '4.0.0-alpha.1') throw new Error('Unexpected release version');
      return AKORT.Release.version;
    }));
    tests.push(test_('result_contract', function () {
      var result = AKORT.Result.success('ok', { value: 1 });
      if (!result.ok || result.status !== 'SUCCESS') throw new Error('Result contract failed');
      return result;
    }));
    tests.push(test_('hash_determinism', function () {
      var a = AKORT.Baseline.hashValuesForTest([[1, 'x', true], [new Date('2026-07-10T00:00:00Z'), '', null]]);
      var b = AKORT.Baseline.hashValuesForTest([[1, 'x', true], [new Date('2026-07-10T00:00:00Z'), '', null]]);
      if (a !== b) throw new Error('Hash is not deterministic');
      return a;
    }));
    tests.push(test_('environment_guard', function () {
      return AKORT.EnvironmentGuard.assertDev();
    }));

    var ok = tests.every(function (item) { return item.status === 'PASS'; });
    return ok
      ? AKORT.Result.success('Alpha.1 smoke test passed.', { tests: tests, config: AKORT.Config.describe() })
      : AKORT.Result.failure('SMOKE_TEST_FAILED', 'One or more alpha.1 smoke tests failed.', { tests: tests, config: AKORT.Config.describe() });
  }

  return { runSmokeTest: runSmokeTest };
})();
