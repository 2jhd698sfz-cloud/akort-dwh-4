var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Alpha.7.4 pure smoke tests. No Google Drive or spreadsheet writes. */
AKORT.Alpha74Tests = (function () {
  function assert_(condition, code, details) {
    if (!condition) throw AKORT.Core.error(code, 'Alpha.7.4 smoke-test assertion failed.', details || {});
  }

  function calculatedRow_(period) {
    var series = 'TEST|weekly|group|G|price|wow|SUM_CONTRIBUTIONS|W|M';
    return {
      calculation_id: 'A74_SMOKE',
      aggregate_series_key: series,
      aggregate_row_key: series + '|' + period,
      dataset_code: 'TEST',
      frequency: 'weekly',
      aggregate_level: 'group',
      aggregate_subject_id: 'G',
      aggregate_name: 'Test group',
      category_id: '',
      value_type: 'price',
      index_type: 'wow',
      period_start: period,
      weight_rule_id: 'W',
      membership_rule_id: 'M',
      aggregate_change_pp: 1,
      applied_members_count: 1,
      applied_weight_sum: 1,
      publication_allowed: true
    };
  }

  function runSmokeTest() {
    return AKORT.Core.safeRun('ALPHA74_SMOKE_TEST', function () {
      AKORT.EnvironmentGuard.assertDev();
      var integration = AKORT.AggregateIntegration;
      assert_(integration.OperationSchemaVersion === '4.0-operation-2', 'A74_OPERATION_SCHEMA');
      assert_(integration.StageHeaders.length === 16, 'A74_STAGE_SCHEMA');
      assert_(AKORT.AggregateContract.Headers.length === 29, 'A74_PUBLISH_SCHEMA');
      assert_(integration.Test.classifyRecovery('B', 'A', 'B') === 'BEFORE', 'A74_RECOVERY_BEFORE');
      assert_(integration.Test.classifyRecovery('B', 'A', 'A') === 'AFTER', 'A74_RECOVERY_AFTER');
      assert_(integration.Test.classifyRecovery('B', 'A', 'X') === 'THIRD_STATE', 'A74_RECOVERY_THIRD');

      var identity = {
        operationId: 'A74_SMOKE_OPERATION',
        loadId: 'A74_SMOKE_LOAD',
        planId: 'A74_SMOKE_PLAN',
        planFingerprint: 'A74_SMOKE_PLAN_FP',
        calculationId: 'A74_SMOKE',
        weightSnapshotId: 'A74_SMOKE_WEIGHT'
      };
      var staged = integration.Test.buildStageRecord(calculatedRow_('2026-01-08'), identity);
      var validation = integration.Test.validateStageRows([staged], identity);
      assert_(validation.rowCount === 1 && validation.seriesCount === 1, 'A74_STAGE_VALIDATION', validation);
      return AKORT.Result.success('Alpha.7.4 pure smoke test passed.', {
        release: integration.Release,
        operationSchemaVersion: integration.OperationSchemaVersion,
        stageRows: validation.rowCount,
        series: validation.seriesCount,
        physicalWrites: false
      });
    }, { lock: false, persistLogs: false });
  }

  return Object.freeze({ runSmokeTest: runSmokeTest });
})();
