var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 7 automatic runner.
 *
 * It orchestrates existing accepted components and does not implement
 * another parser, RAW store, Publish writer or aggregate calculator.
 * One worker invocation performs one bounded transition.
 */
AKORT.Alpha74Gate7Runner = (function () {
  var VERSION = '4.0-alpha74-gate7-runner-1';
  var STATE_SCHEMA = '4.0-alpha74-gate7-runner-state-1';
  var RELEASE = '4.0.0-alpha.7.4.40';
  var STATE_PROPERTY = 'AKORT_ALPHA74_GATE7_RUNNER_STATE_V1';
  var WORKER_HANDLER = 'AKORT_alpha74Gate7Worker';
  var TRIGGER_DELAY_MS = 15000;
  var MAX_HISTORY = 24;

  function text_(value) {
    return value === null || value === undefined
      ? ''
      : String(value).trim();
  }

  function now_() {
    return new Date().toISOString();
  }

  function clone_(value) {
    return value === undefined
      ? undefined
      : JSON.parse(JSON.stringify(value));
  }

  function error_(code, message, details) {
    return AKORT.Core.error(code, message, details || {});
  }

  function resultData_(result, code, message) {
    if (!result || result.ok === false) {
      throw error_(
        result && result.code || code,
        result && result.message || message,
        result && (result.details || result.data) || {}
      );
    }
    return result.data || {};
  }

  function readState_() {
    var raw = PropertiesService
      .getScriptProperties()
      .getProperty(STATE_PROPERTY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (caught) {
      return {
        status: 'INVALID',
        errorCode: 'ALPHA74_GATE7_RUNNER_STATE_INVALID',
        errorMessage: caught.message || String(caught)
      };
    }
  }

  function saveState_(state) {
    state.schemaVersion = STATE_SCHEMA;
    state.release = RELEASE;
    state.version = VERSION;
    state.updatedAt = now_();
    state.history = (state.history || []).slice(-MAX_HISTORY);

    PropertiesService
      .getScriptProperties()
      .setProperty(STATE_PROPERTY, JSON.stringify(state));

    return state;
  }

  function publicState_(state) {
    if (!state) return null;
    return {
      status: text_(state.status),
      phase: text_(state.phase),
      startedAt: text_(state.startedAt),
      updatedAt: text_(state.updatedAt),
      finishedAt: text_(state.finishedAt),
      invocationCount: Number(state.invocationCount || 0),
      previewCursor: Number(state.previewCursor || 0),
      expectedProfiles: Number(state.expectedProfiles || 12),
      lastAction: text_(state.lastAction),
      lastMessage: text_(state.lastMessage),
      lastErrorCode: text_(state.lastErrorCode),
      lastErrorMessage: text_(state.lastErrorMessage),
      gate7Accepted: state.gate7Accepted === true,
      industryResynced: state.industryResynced === true,
      history: clone_(state.history || [])
    };
  }

  function clearWorkerTriggers_() {
    var deleted = 0;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === WORKER_HANDLER) {
        ScriptApp.deleteTrigger(trigger);
        deleted += 1;
      }
    });
    return deleted;
  }

  function scheduleWorker_() {
    clearWorkerTriggers_();
    ScriptApp
      .newTrigger(WORKER_HANDLER)
      .timeBased()
      .after(TRIGGER_DELAY_MS)
      .create();
    return true;
  }

  function historyEntry_(action, message, details) {
    return {
      at: now_(),
      action: text_(action),
      message: text_(message),
      details: clone_(details || {})
    };
  }

  function record_(state, action, message, details) {
    state.lastAction = action;
    state.lastMessage = message;
    state.history = state.history || [];
    state.history.push(historyEntry_(action, message, details));
    return saveState_(state);
  }

  function freshState_() {
    return {
      schemaVersion: STATE_SCHEMA,
      release: RELEASE,
      version: VERSION,
      status: 'RUNNING',
      phase: 'CHECK_GATE7',
      startedAt: now_(),
      updatedAt: now_(),
      finishedAt: '',
      invocationCount: 0,
      previewCursor: 0,
      expectedProfiles: 12,
      lastAction: '',
      lastMessage: '',
      lastErrorCode: '',
      lastErrorMessage: '',
      gate7Accepted: false,
      industryResynced: false,
      history: []
    };
  }

  function gateStatus_() {
    return resultData_(
      AKORT.Alpha74Gate7Acceptance.status(),
      'ALPHA74_GATE7_RUNNER_STATUS_FAILED',
      'Gate 7 status could not be loaded.'
    );
  }

  function checkpointAndSchedule_(
    state,
    action,
    message,
    details
  ) {
    record_(state, action, message, details);
    scheduleWorker_();
    return AKORT.Result.paused(message, publicState_(state));
  }

  function advance_(state) {
    state.invocationCount = Number(state.invocationCount || 0) + 1;
    state.status = 'RUNNING';
    state.lastErrorCode = '';
    state.lastErrorMessage = '';

    var gate = gateStatus_();
    state.previewCursor = Number(
      gate.previewState && gate.previewState.cursor || 0
    );
    state.expectedProfiles = Number(
      gate.expectedProfileCount || 12
    );

    if (gate.gate7Accepted) {
      state.gate7Accepted = true;

      if (!state.industryResynced) {
        state.phase = 'RESYNC_INDUSTRY_FORM';
        var syncData = resultData_(
          AKORT.IndustryInput.install(),
          'ALPHA74_GATE7_RUNNER_INDUSTRY_RESYNC_FAILED',
          'Industry form could not be resynchronized after exact reversal.'
        );
        state.industryResynced = true;
        return checkpointAndSchedule_(
          state,
          'RESYNC_INDUSTRY_FORM',
          'Gate 7 is accepted; Industry form was resynchronized.',
          syncData
        );
      }

      state.status = 'SUCCESS';
      state.phase = 'SUCCESS';
      state.finishedAt = now_();
      clearWorkerTriggers_();
      record_(
        state,
        'SUCCESS',
        'Alpha.7.4 Gate 7 automatic acceptance completed.',
        {
          previewProfiles: state.previewCursor,
          gate7Accepted: true,
          industryResynced: true
        }
      );
      return AKORT.Result.success(
        'Alpha.7.4 Gate 7 automatic acceptance completed.',
        publicState_(state)
      );
    }

    if (!gate.previewAccepted) {
      state.phase = 'PREVIEW_ONE_PROFILE';
      var previewData = resultData_(
        AKORT.Alpha74Gate7Acceptance.previewMatrix(),
        'ALPHA74_GATE7_RUNNER_PREVIEW_FAILED',
        'Gate 7 source-profile preview failed.'
      );
      state.previewCursor = Number(
        previewData.completedProfiles ||
        previewData.profileCount ||
        state.previewCursor
      );
      return checkpointAndSchedule_(
        state,
        'PREVIEW_ONE_PROFILE',
        'One Gate 7 source profile was checkpointed.',
        {
          completedProfiles: state.previewCursor,
          expectedProfiles: state.expectedProfiles,
          processedThisRun:
            clone_(previewData.processedThisRun || [])
        }
      );
    }

    if (!gate.industryInputInstalled) {
      state.phase = 'INSTALL_INDUSTRY_INPUT';
      var installData = resultData_(
        AKORT.IndustryInput.install(),
        'ALPHA74_GATE7_RUNNER_INDUSTRY_INSTALL_FAILED',
        'Industry Input could not be installed.'
      );
      return checkpointAndSchedule_(
        state,
        'INSTALL_INDUSTRY_INPUT',
        'Industry Input was installed from the accepted dimension.',
        installData
      );
    }

    if (!gate.industryState) {
      var inspection = resultData_(
        AKORT.IndustryInput.Acceptance.inspect(),
        'ALPHA74_GATE7_RUNNER_INDUSTRY_INSPECT_FAILED',
        'Industry acceptance form could not be inspected.'
      );
      var readyRows = inspection.readyRows || [];
      var noChangeRows = inspection.noChangeRows || [];

      if (!readyRows.length && !noChangeRows.length) {
        state.phase = 'PREPARE_INDUSTRY_CANARY';
        var canaryData = resultData_(
          AKORT.IndustryInput.Acceptance.prepareCanary(),
          'ALPHA74_GATE7_RUNNER_CANARY_FAILED',
          'Automatic Industry revision canary could not be prepared.'
        );
        return checkpointAndSchedule_(
          state,
          'PREPARE_INDUSTRY_CANARY',
          'One controlled Industry revision canary was prepared.',
          canaryData
        );
      }

      if (readyRows.length !== 1 || noChangeRows.length) {
        throw error_(
          'ALPHA74_GATE7_RUNNER_INDUSTRY_ROW_SET_INVALID',
          'Industry acceptance requires exactly one revision row and no additional populated rows.',
          {
            readyRows: readyRows,
            noChangeRows: noChangeRows,
            counts: inspection.counts || {}
          }
        );
      }

      state.phase = 'START_INDUSTRY_ACCEPTANCE';
      var startData = resultData_(
        AKORT.Alpha74Gate7Acceptance.startIndustry(),
        'ALPHA74_GATE7_RUNNER_INDUSTRY_START_FAILED',
        'Gate 7 Industry acceptance could not be started.'
      );
      return checkpointAndSchedule_(
        state,
        'START_INDUSTRY_ACCEPTANCE',
        'Gate 7 Industry load was started.',
        startData
      );
    }

    if (gate.industryState.status === 'INDUSTRY_ACCEPTED') {
      state.phase = 'FINALIZE_GATE7';
      var finalData = resultData_(
        AKORT.Alpha74Gate7Acceptance.finalize(),
        'ALPHA74_GATE7_RUNNER_FINALIZE_FAILED',
        'Gate 7 final evidence could not be written.'
      );
      state.gate7Accepted = true;
      return checkpointAndSchedule_(
        state,
        'FINALIZE_GATE7',
        'Gate 7 final evidence was written.',
        {
          evidenceId: text_(finalData.evidenceId),
          evidenceHash: text_(finalData.evidenceHash)
        }
      );
    }

    state.phase = 'CONTINUE_INDUSTRY_ACCEPTANCE';
    var continueData = resultData_(
      AKORT.Alpha74Gate7Acceptance.continueIndustry(),
      'ALPHA74_GATE7_RUNNER_INDUSTRY_CONTINUE_FAILED',
      'Gate 7 Industry acceptance could not be continued.'
    );
    return checkpointAndSchedule_(
      state,
      'CONTINUE_INDUSTRY_ACCEPTANCE',
      'One durable Industry acceptance phase was checkpointed.',
      continueData
    );
  }

  function start() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_RUNNER_START',
      function () {
        AKORT.EnvironmentGuard.assertDev();

        var existing = readState_();
        if (existing && existing.status === 'INVALID') {
          throw error_(
            existing.errorCode,
            existing.errorMessage,
            existing
          );
        }

        var state = existing && existing.status === 'RUNNING'
          ? existing
          : freshState_();

        state.status = 'RUNNING';
        state.finishedAt = '';
        state.lastErrorCode = '';
        state.lastErrorMessage = '';
        record_(
          state,
          'START',
          'Gate 7 automatic runner scheduled.',
          {}
        );
        scheduleWorker_();

        return AKORT.Result.paused(
          'Gate 7 automatic runner scheduled. No repeated manual execution is required.',
          publicState_(state)
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function worker() {
    var result = AKORT.Core.safeRun(
      'ALPHA74_GATE7_RUNNER_WORKER',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var state = readState_();
        if (!state) state = freshState_();

        if (state.status === 'INVALID') {
          throw error_(
            state.errorCode,
            state.errorMessage,
            state
          );
        }
        if (state.status === 'STOPPED') {
          clearWorkerTriggers_();
          return AKORT.Result.paused(
            'Gate 7 automatic runner is stopped.',
            publicState_(state)
          );
        }
        if (state.status === 'SUCCESS') {
          clearWorkerTriggers_();
          return AKORT.Result.success(
            'Gate 7 automatic runner is already complete.',
            publicState_(state)
          );
        }

        return advance_(state);
      },
      { lock: false, persistLogs: true }
    );

    if (!result || result.ok === false) {
      try {
        var failed = readState_() || freshState_();
        failed.status = 'FAILED';
        failed.phase = 'FAILED';
        failed.finishedAt = now_();
        failed.lastErrorCode = text_(result && result.code) ||
          'ALPHA74_GATE7_RUNNER_FAILED';
        failed.lastErrorMessage = text_(
          result && result.message
        ) || 'Gate 7 automatic runner failed.';
        record_(
          failed,
          'FAILED',
          failed.lastErrorMessage,
          {
            code: failed.lastErrorCode,
            details: clone_(
              result && (result.details || result.data) || {}
            )
          }
        );
        clearWorkerTriggers_();
      } catch (ignored) {}
    }

    return result;
  }

  function status() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_RUNNER_STATUS',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var state = readState_();
        return AKORT.Result.success(
          'Gate 7 automatic runner status loaded.',
          {
            release: RELEASE,
            version: VERSION,
            stateSchemaVersion: STATE_SCHEMA,
            workerHandler: WORKER_HANDLER,
            scheduledTriggers:
              ScriptApp.getProjectTriggers().filter(
                function (trigger) {
                  return trigger.getHandlerFunction() ===
                    WORKER_HANDLER;
                }
              ).length,
            state: publicState_(state),
            gate7: gateStatus_()
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function stop() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_RUNNER_STOP',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var state = readState_() || freshState_();
        state.status = 'STOPPED';
        state.phase = 'STOPPED';
        state.finishedAt = now_();
        var deleted = clearWorkerTriggers_();
        record_(
          state,
          'STOPPED',
          'Gate 7 automatic runner stopped safely.',
          { deletedTriggers: deleted }
        );
        return AKORT.Result.success(
          'Gate 7 automatic runner stopped safely.',
          publicState_(state)
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    StateSchemaVersion: STATE_SCHEMA,
    WorkerHandler: WORKER_HANDLER,
    start: start,
    worker: worker,
    status: status,
    stop: stop,
    Test: Object.freeze({
      publicState: publicState_,
      freshState: freshState_
    })
  });
})();
