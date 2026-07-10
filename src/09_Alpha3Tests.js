var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Alpha3Tests = (function () {
  function test_(id, fn) {
    try { return { id: id, status: 'PASS', data: fn(), error: null }; }
    catch (caught) {
      return {
        id: id,
        status: 'FAIL',
        data: null,
        error: {
          code: caught && caught.code ? caught.code : 'UNEXPECTED_ERROR',
          message: caught && caught.message ? caught.message : String(caught),
          details: caught && caught.details !== undefined ? caught.details : null
        }
      };
    }
  }

  function require_(condition, code, message, details) {
    if (!condition) throw AKORT.Core.error(code, message, details);
  }

  function physicalRowCount_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return -1;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  function operation_(operationId) {
    return AKORT.OperationEngine.Test.getOperation(operationId);
  }

  function steps_(operationId) {
    return AKORT.OperationEngine.Test.readSteps(operationId);
  }

  function phaseList_(operationId) {
    return steps_(operationId).map(function (step) { return String(step.phase); });
  }

  function runSmokeTest() {
    return AKORT.Core.safeRun('ALPHA3_SMOKE_TEST', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var publish = SpreadsheetApp.openById(config.resources.publishSpreadsheetId);
      var suiteId = AKORT.Core.Id.execution();
      var prefix = 'ALPHA3_TEST_';
      var cleanup = AKORT.OperationEngine.Test.cleanupByPrefix(prefix);
      var tests = [];
      var happyId = '';
      var happyKey = suiteId + '_HAPPY';
      var happyStepCount = 0;

      var before = {
        rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
        rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
        rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
        publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
        publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
        publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
        publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
      };

      tests.push(test_('phase_transition_contract', function () {
        var phases = AKORT.OperationEngine.Phases;
        for (var i = 0; i < phases.length - 1; i += 1) {
          AKORT.OperationEngine.assertTransition(phases[i], phases[i + 1]);
        }
        var invalidRejected = false;
        try { AKORT.OperationEngine.assertTransition('DISCOVER', 'PARSE'); }
        catch (caught) { invalidRejected = caught.code === 'INVALID_PHASE_TRANSITION'; }
        require_(invalidRejected, 'INVALID_TRANSITION_ACCEPTED', 'Invalid phase transition was not rejected.');
        return { phases: phases, invalidTransitionRejected: true };
      }));

      tests.push(test_('checkpoint_and_resume', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'HAPPY', {
          test: { pauseAfterPhase: 'PARSE' }
        }, { idempotencyKey: happyKey });
        require_(queued.ok, 'QUEUE_FAILED', 'Happy-path operation was not queued.', queued);
        happyId = queued.data.operationId;

        var first = AKORT.OperationEngine.run(happyId, { maxSteps: 50 });
        require_(first.ok && first.status === 'PAUSED', 'EXPECTED_PAUSE_MISSING', 'Operation did not pause after PARSE.', first);
        var paused = operation_(happyId);
        require_(String(paused.status) === 'PAUSED', 'PAUSE_STATUS_MISMATCH', 'Expected PAUSED status.', paused);
        require_(String(paused.current_phase) === 'STAGE', 'CHECKPOINT_PHASE_MISMATCH', 'Expected STAGE as the persisted next phase.', paused);
        require_(JSON.stringify(phaseList_(happyId)) === JSON.stringify(['DISCOVER', 'VALIDATE', 'PARSE']), 'PAUSED_STEP_SEQUENCE_MISMATCH', 'Unexpected step sequence before resume.', phaseList_(happyId));

        var resumed = AKORT.OperationEngine.resume(happyId, { maxSteps: 50 });
        require_(resumed.ok && resumed.status === 'SUCCESS', 'RESUME_FAILED', 'Operation did not reach SUCCESS after resume.', resumed);
        var expectedPhases = AKORT.OperationEngine.Phases;
        var actualPhases = phaseList_(happyId);
        require_(JSON.stringify(actualPhases) === JSON.stringify(expectedPhases), 'FINAL_STEP_SEQUENCE_MISMATCH', 'Full phase sequence is incorrect.', { expected: expectedPhases, actual: actualPhases });
        happyStepCount = actualPhases.length;
        return { operationId: happyId, pausedAt: 'STAGE', finalStatus: operation_(happyId).status, phases: actualPhases };
      }));

      tests.push(test_('repeat_and_idempotency', function () {
        var duplicate = AKORT.OperationEngine.enqueue(prefix + 'HAPPY', {
          test: { pauseAfterPhase: 'PARSE' }
        }, { idempotencyKey: happyKey });
        require_(duplicate.ok && duplicate.data.reused === true, 'IDEMPOTENCY_REUSE_FAILED', 'Idempotent enqueue did not return the existing operation.', duplicate);
        require_(duplicate.data.operationId === happyId, 'IDEMPOTENCY_ID_MISMATCH', 'Idempotent enqueue returned another operation ID.', duplicate.data);
        var repeated = AKORT.OperationEngine.run(happyId, { maxSteps: 50 });
        require_(repeated.ok && repeated.status === 'SUCCESS', 'COMPLETED_REPEAT_FAILED', 'Repeated run of completed operation did not return SUCCESS.', repeated);
        var afterSteps = steps_(happyId).length;
        require_(afterSteps === happyStepCount, 'DOUBLE_EXECUTION_DETECTED', 'Repeated run created additional steps.', { before: happyStepCount, after: afterSteps });
        return { operationId: happyId, stepCount: afterSteps, reused: true };
      }));

      tests.push(test_('double_execution_guard', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'LEASE', {}, { idempotencyKey: suiteId + '_LEASE' });
        var operationId = queued.data.operationId;
        AKORT.OperationEngine.Test.setActiveLease(operationId, 60000);
        var blocked = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(!blocked.ok && blocked.code === 'OPERATION_ALREADY_RUNNING', 'ACTIVE_LEASE_NOT_ENFORCED', 'Active lease did not block the second execution.', blocked);
        AKORT.OperationEngine.Test.clearLease(operationId);
        var continued = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(continued.ok && continued.status === 'PAUSED', 'LEASE_RECOVERY_FAILED', 'Operation did not continue after lease clearance.', continued);
        return { operationId: operationId, blockedCode: blocked.code, statusAfterClear: operation_(operationId).status };
      }));

      tests.push(test_('safe_stop', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'STOP', {}, { idempotencyKey: suiteId + '_STOP' });
        var operationId = queued.data.operationId;
        var requested = AKORT.OperationEngine.requestStop(operationId);
        require_(requested.ok, 'STOP_REQUEST_FAILED', 'Safe stop request failed.', requested);
        var stopped = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(stopped.ok && stopped.status === 'PAUSED', 'SAFE_STOP_FAILED', 'Operation did not remain safely paused.', stopped);
        require_(steps_(operationId).length === 0, 'STOP_EXECUTED_PHASE', 'A phase executed despite a pending stop request.', phaseList_(operationId));
        var resumed = AKORT.OperationEngine.resume(operationId, { maxSteps: 1 });
        require_(resumed.ok && resumed.status === 'PAUSED', 'STOP_RESUME_FAILED', 'Operation did not resume from the safe checkpoint.', resumed);
        require_(phaseList_(operationId)[0] === 'DISCOVER', 'STOP_RESUME_PHASE_MISMATCH', 'Resume did not start with DISCOVER.', phaseList_(operationId));
        return { operationId: operationId, stepsBeforeResume: 0, firstCompletedAfterResume: 'DISCOVER' };
      }));

      tests.push(test_('retry', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'RETRY', {
          test: { failPhase: 'DISCOVER', failMode: 'RETRYABLE', failTimes: 1 }
        }, { idempotencyKey: suiteId + '_RETRY', maxAttempts: 3 });
        var operationId = queued.data.operationId;
        var first = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(first.ok && first.status === 'PAUSED', 'RETRY_NOT_PAUSED', 'Retryable error did not return a resumable status.', first);
        require_(String(operation_(operationId).status) === 'RETRY_PENDING', 'RETRY_STATUS_MISMATCH', 'Expected RETRY_PENDING.', operation_(operationId));
        var second = AKORT.OperationEngine.resume(operationId, { maxSteps: 1 });
        require_(second.ok && second.status === 'PAUSED', 'RETRY_RESUME_FAILED', 'Operation did not continue after retry.', second);
        require_(String(operation_(operationId).current_phase) === 'VALIDATE', 'RETRY_CHECKPOINT_MISMATCH', 'Successful retry did not advance to VALIDATE.', operation_(operationId));
        var phases = phaseList_(operationId);
        require_(JSON.stringify(phases) === JSON.stringify(['DISCOVER', 'DISCOVER']), 'RETRY_STEP_HISTORY_MISMATCH', 'Retry history should contain two DISCOVER attempts.', phases);
        return { operationId: operationId, attemptNo: operation_(operationId).attempt_no, phases: phases };
      }));

      tests.push(test_('dead_letter', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'DEAD', {
          test: { failPhase: 'DISCOVER', failMode: 'RETRYABLE', failTimes: 5 }
        }, { idempotencyKey: suiteId + '_DEAD', maxAttempts: 2 });
        var operationId = queued.data.operationId;
        var first = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(first.ok && String(operation_(operationId).status) === 'RETRY_PENDING', 'FIRST_RETRY_FAILED', 'First retryable error should schedule a retry.', first);
        var second = AKORT.OperationEngine.resume(operationId, { maxSteps: 1 });
        require_(!second.ok && second.code === 'OPERATION_DEAD_LETTER', 'DEAD_LETTER_NOT_REACHED', 'Retry limit did not move the operation to dead letter.', second);
        var beforeRepeat = steps_(operationId).length;
        var third = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(!third.ok && third.code === 'OPERATION_DEAD_LETTER', 'DEAD_LETTER_REPEAT_CONTRACT', 'Dead-letter operation did not remain terminal.', third);
        require_(steps_(operationId).length === beforeRepeat, 'DEAD_LETTER_REEXECUTED', 'Dead-letter operation executed again.', { before: beforeRepeat, after: steps_(operationId).length });
        return { operationId: operationId, status: operation_(operationId).status, attemptNo: operation_(operationId).attempt_no };
      }));

      tests.push(test_('exception_handling', function () {
        var queued = AKORT.OperationEngine.enqueue(prefix + 'FATAL', {
          test: { failPhase: 'DISCOVER', failMode: 'FATAL', failTimes: 1 }
        }, { idempotencyKey: suiteId + '_FATAL' });
        var operationId = queued.data.operationId;
        var failed = AKORT.OperationEngine.run(operationId, { maxSteps: 1 });
        require_(!failed.ok && failed.code === 'TEST_FATAL_ERROR', 'FATAL_ERROR_CONTRACT', 'Fatal handler error was not normalized correctly.', failed);
        require_(String(operation_(operationId).status) === 'FAILED', 'FATAL_STATUS_MISMATCH', 'Fatal operation did not receive FAILED status.', operation_(operationId));
        return { operationId: operationId, status: operation_(operationId).status, errorCode: operation_(operationId).error_code };
      }));

      tests.push(test_('baseline_unchanged', function () {
        var after = {
          rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
          rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
          rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
          publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
          publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
          publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
          publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
        };
        require_(JSON.stringify(after) === JSON.stringify(before), 'BASELINE_CHANGED_DURING_ALPHA3_TEST', 'RAW or Publish physical counts changed during Operation Engine tests.', { before: before, after: after });
        var expected = config.baselinePhysicalExpected;
        Object.keys(expected).forEach(function (key) {
          require_(Number(after[key]) === Number(expected[key]), 'BASELINE_EXPECTATION_MISMATCH', 'Physical row count differs from verified baseline for ' + key, { expected: expected[key], actual: after[key] });
        });
        return after;
      }));

      var ok = tests.every(function (test) { return test.status === 'PASS'; });
      context.logger.info('Alpha.3 smoke test completed', {
        suiteId: suiteId,
        status: ok ? 'PASS' : 'FAIL',
        cleanup: cleanup,
        tests: tests.map(function (test) { return { id: test.id, status: test.status }; })
      }, { eventCode: ok ? 'ALPHA3_SMOKE_PASS' : 'ALPHA3_SMOKE_FAIL' });

      return ok
        ? AKORT.Result.success('Alpha.3 Operation Engine smoke test passed.', {
          suiteId: suiteId,
          cleanup: cleanup,
          tests: tests,
          engine: AKORT.OperationEngine.engineStatus().data
        })
        : AKORT.Result.failure('ALPHA3_SMOKE_TEST_FAILED', 'One or more Operation Engine checks failed.', {
          suiteId: suiteId,
          cleanup: cleanup,
          tests: tests
        });
    }, { lock: false, persistLogs: true });
  }

  return { runSmokeTest: runSmokeTest };
})();
