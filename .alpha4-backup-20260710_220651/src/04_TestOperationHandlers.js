var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.3 handlers intentionally perform no RAW, Publish, Drive-file or aggregate writes.
 * They only mutate the in-memory checkpoint object supplied by OperationEngine.
 */
AKORT.TestOperationHandlers = (function () {
  function normalizeTestConfig_(checkpoint) {
    var input = checkpoint.input || {};
    var test = input.test || {};
    return {
      pauseAfterPhase: test.pauseAfterPhase ? String(test.pauseAfterPhase) : '',
      failPhase: test.failPhase ? String(test.failPhase) : '',
      failMode: String(test.failMode || '').toUpperCase(),
      failTimes: Number(test.failTimes || 0)
    };
  }

  function execute(phase, context) {
    var operation = context.operation || {};
    var checkpoint = context.checkpoint;
    if (!checkpoint) throw AKORT.Core.error('CHECKPOINT_REQUIRED', 'Test handler requires a checkpoint.');

    var type = String(operation.operation_type || '');
    if (type.indexOf('ALPHA3_TEST_') !== 0 && type.indexOf('ALPHA3_DEMO_') !== 0) {
      throw AKORT.Core.error('REAL_HANDLER_NOT_IMPLEMENTED', 'Alpha.3 only supports test and demo operation types.', {
        operationType: type,
        retryable: false
      });
    }

    checkpoint.handlerState = checkpoint.handlerState || { calls: {} };
    checkpoint.handlerState.calls = checkpoint.handlerState.calls || {};
    var calls = Number(checkpoint.handlerState.calls[phase] || 0) + 1;
    checkpoint.handlerState.calls[phase] = calls;

    var test = normalizeTestConfig_(checkpoint);
    if (test.failPhase === phase && calls <= test.failTimes) {
      if (test.failMode === 'RETRYABLE') {
        throw AKORT.Core.error('TEST_RETRYABLE_ERROR', 'Expected retryable alpha.3 test error.', {
          retryable: true,
          phase: phase,
          call: calls,
          failTimes: test.failTimes
        });
      }
      throw AKORT.Core.error('TEST_FATAL_ERROR', 'Expected fatal alpha.3 test error.', {
        retryable: false,
        phase: phase,
        call: calls,
        failTimes: test.failTimes
      });
    }

    var result = {
      handler: 'TEST_ONLY',
      phase: phase,
      call: calls,
      noDataMutation: true,
      marker: AKORT.Core.sha256(operation.operation_id + '|' + phase + '|' + calls).slice(0, 16)
    };

    if (test.pauseAfterPhase === phase) result.pause = true;
    return result;
  }

  return { execute: execute };
})();
