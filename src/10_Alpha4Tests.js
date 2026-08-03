var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.4 compatibility regression for alpha.6.
 * The original monolithic test approached the Apps Script execution ceiling as
 * the historical RAW tables grew. This implementation persists a checkpoint
 * and executes one bounded segment per invocation.
 */
AKORT.Alpha4Tests = (function () {
  var STATE_KEY = 'AKORT_ALPHA4_SMOKE_STATE_V2';
  var STATE_VERSION = 2;
  var TARGET = 'RAW_PRICES_WEEKLY';

  function clone_(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

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

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function physicalRowCount_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return -1;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  function baselineCounts_(config) {
    var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
    var publish = SpreadsheetApp.openById(config.resources.publishSpreadsheetId);
    return {
      rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
      rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
      rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
      publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
      publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
      publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
      publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
    };
  }

  function rawRows_(spreadsheet, targetTable) {
    return AKORT.Core.Sheets.readObjects(spreadsheet.getSheetByName(targetTable));
  }

  function rowsForKey_(spreadsheet, targetTable, businessKey) {
    return rawRows_(spreadsheet, targetTable).filter(function (row) {
      return AKORT.RawStore.businessKey(targetTable, row) === businessKey;
    }).sort(function (a, b) {
      return Number(a.version_no || 0) - Number(b.version_no || 0);
    });
  }

  function latestForKey_(spreadsheet, targetTable, businessKey) {
    return rowsForKey_(spreadsheet, targetTable, businessKey).filter(function (row) {
      return truthy_(row.is_latest);
    });
  }

  function source_(state, suffix, hashSuffix) {
    return {
      targetTable: TARGET,
      sourceId: 'ALPHA4_TEST_' + state.suiteId + '_' + suffix,
      sourceName: 'ALPHA4_TEST_' + suffix,
      sourceHash: AKORT.Core.sha256('ALPHA4|' + state.suiteId + '|' + hashSuffix)
    };
  }

  function loadState_() {
    var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
    if (!raw) return null;
    var state = JSON.parse(raw);
    if (Number(state.stateVersion || 0) !== STATE_VERSION) {
      throw AKORT.Core.error('ALPHA4_SMOKE_STATE_VERSION_MISMATCH', 'Stored alpha.4 smoke-test state is incompatible.', {
        expected: STATE_VERSION,
        actual: state.stateVersion || null
      });
    }
    return state;
  }

  function saveState_(state) {
    state.updatedAt = AKORT.Core.now();
    PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
    return state;
  }

  function clearState_() {
    PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
  }

  function addOrReplaceTest_(state, result) {
    state.tests = state.tests || [];
    var replaced = false;
    state.tests = state.tests.map(function (item) {
      if (String(item.id) !== String(result.id)) return item;
      replaced = true;
      return result;
    });
    if (!replaced) state.tests.push(result);
    return result;
  }

  function publicState_(state) {
    if (!state) return null;
    return {
      stateVersion: state.stateVersion,
      suiteId: state.suiteId,
      status: state.status,
      phase: state.phase,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      initialLoadId: state.initialLoadId || '',
      revisionLoadId: state.revisionLoadId || '',
      cleanupBefore: clone_(state.cleanupBefore || null),
      cleanupAfter: clone_(state.cleanupAfter || null),
      tests: clone_(state.tests || [])
    };
  }

  function failIfNeeded_(state, result) {
    addOrReplaceTest_(state, result);
    if (result.status === 'FAIL') {
      state.status = 'FAILED';
      state.error = clone_(result.error);
      saveState_(state);
      return true;
    }
    return false;
  }

  function paused_(state, message) {
    saveState_(state);
    return AKORT.Result.paused(message, publicState_(state));
  }

  function initialize_() {
    var config = AKORT.Config.load();
    var cleanupBefore = AKORT.RawStore.Test.cleanup('ALPHA4_TEST_');
    var suiteId = AKORT.Core.Id.execution();
    var baseRow = {
      dataset_code: 'ALPHA4_TEST_DATASET',
      category_id: 'ALPHA4_TEST_CATEGORY_' + suiteId,
      value_type: 'PRICE_INDEX',
      index_type: 'TEST',
      observation_date: '2099-01-01',
      value: 100,
      source_published_at: '2099-01-02'
    };
    var key = AKORT.RawStore.businessKey(TARGET, AKORT.RawStore.normalizeRow(TARGET, baseRow));
    var state = {
      stateVersion: STATE_VERSION,
      suiteId: suiteId,
      status: 'RUNNING',
      phase: 'CONTRACT',
      startedAt: AKORT.Core.now(),
      updatedAt: AKORT.Core.now(),
      cleanupBefore: cleanupBefore,
      cleanupAfter: null,
      before: baselineCounts_(config),
      baseRow: baseRow,
      businessKey: key,
      initialLoadId: '',
      revisionLoadId: '',
      tests: [],
      error: null
    };
    saveState_(state);
    return state;
  }

  function runContract_(state, config, dwh) {
    var contract = test_('raw_store_contract', function () {
      require_(['4.0.0-alpha.4', '4.0.0-alpha.5', '4.0.0-alpha.6', '4.0.0-alpha.6.2.4', '4.0.0-alpha.7.4', '4.0.0-alpha.7.4.1', '4.0.0-alpha.7.4.2', '4.0.0-alpha.7.4.3', '4.0.0-alpha.7.4.4', '4.0.0-alpha.7.4.5', '4.0.0-alpha.7.4.6', '4.0.0-alpha.7.4.7', '4.0.0-alpha.7.4.8', '4.0.0-alpha.7.4.9', '4.0.0-alpha.7.4.10', '4.0.0-alpha.7.4.11', '4.0.0-alpha.7.4.12', '4.0.0-alpha.7.4.13', '4.0.0-alpha.7.4.14', '4.0.0-alpha.7.4.15', '4.0.0-alpha.7.4.16', '4.0.0-alpha.7.4.17', '4.0.0-alpha.7.4.18', '4.0.0-alpha.7.4.19', '4.0.0-alpha.7.4.20', '4.0.0-alpha.7.4.21', '4.0.0-alpha.7.4.22', '4.0.0-alpha.7.4.23', '4.0.0-alpha.7.4.24', '4.0.0-alpha.7.4.25', '4.0.0-alpha.7.4.26', '4.0.0-alpha.7.4.27', '4.0.0-alpha.7.4.28', '4.0.0-alpha.7.4.29', '4.0.0-alpha.7.4.30', '4.0.0-alpha.7.4.31', '4.0.0-alpha.7.4.32', '4.0.0-alpha.7.4.33'].indexOf(AKORT.Release.version) >= 0,
        'RELEASE_VERSION_MISMATCH', 'Unexpected release version for alpha.4 compatibility regression.');
      require_(AKORT.Release.rawSchemaVersion === '4.0-raw-1',
        'RAW_SCHEMA_VERSION_MISMATCH', 'Unexpected RAW schema version.');
      ['RAW_STAGE', 'RAW_LOAD_REGISTRY', 'RAW_REVERSAL_LOG'].forEach(function (name) {
        var sheet = dwh.getSheetByName(name);
        require_(!!sheet, 'RAW_SERVICE_TABLE_MISSING', 'Missing alpha.4 service table ' + name);
        var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
        require_(JSON.stringify(actual) === JSON.stringify(AKORT.RawStore.Tables[name]),
          'RAW_SERVICE_SCHEMA_MISMATCH', 'Schema mismatch in ' + name,
          { actual: actual, expected: AKORT.RawStore.Tables[name] });
      });
      return { rawSchemaVersion: AKORT.Release.rawSchemaVersion, serviceTables: Object.keys(AKORT.RawStore.Tables) };
    });
    if (failIfNeeded_(state, contract)) return AKORT.Result.failure(contract.error.code, contract.error.message, publicState_(state));

    var hashTest = test_('business_key_and_content_hash', function () {
      var normalizedA = AKORT.RawStore.normalizeRow(TARGET, state.baseRow);
      var normalizedB = AKORT.RawStore.normalizeRow(TARGET, state.baseRow);
      var keyA = AKORT.RawStore.businessKey(TARGET, normalizedA);
      var keyB = AKORT.RawStore.businessKey(TARGET, normalizedB);
      var hashA = AKORT.RawStore.contentHash(TARGET, normalizedA);
      var hashB = AKORT.RawStore.contentHash(TARGET, normalizedB);
      require_(keyA === keyB, 'BUSINESS_KEY_NOT_DETERMINISTIC', 'Business key is not deterministic.');
      require_(hashA === hashB, 'CONTENT_HASH_NOT_DETERMINISTIC', 'Content hash is not deterministic.');
      var changed = clone_(state.baseRow);
      changed.value = 101;
      require_(AKORT.RawStore.contentHash(TARGET, AKORT.RawStore.normalizeRow(TARGET, changed)) !== hashA,
        'CONTENT_HASH_IGNORES_VALUE', 'Content hash did not change with the observation value.');
      return { businessKey: keyA, contentHash: hashA };
    });
    if (failIfNeeded_(state, hashTest)) return AKORT.Result.failure(hashTest.error.code, hashTest.error.message, publicState_(state));

    state.phase = 'INITIAL';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after contract checks. Run AKORT_alpha4SmokeTest again.');
  }

  function runInitial_(state, config, dwh) {
    var initial = test_('initial_commit', function () {
      var result = AKORT.RawStore.storeNormalized(source_(state, 'INITIAL', 'INITIAL'), [state.baseRow], {
        operationId: 'ALPHA4_TEST_DIRECT_INITIAL_' + state.suiteId
      });
      state.initialLoadId = result.begin.loadId;
      var history = rowsForKey_(dwh, TARGET, state.businessKey);
      require_(history.length === 1, 'INITIAL_ROW_COUNT', 'Initial RAW commit did not produce exactly one physical version.', history);
      require_(Number(history[0].version_no) === 1 && String(history[0].revision_type) === 'INITIAL',
        'INITIAL_VERSION_CONTRACT', 'Initial version metadata is incorrect.', history[0]);
      require_(latestForKey_(dwh, TARGET, state.businessKey).length === 1,
        'INITIAL_LATEST_CONTRACT', 'Initial row is not uniquely latest.');
      return { loadId: state.initialLoadId, observationId: history[0].observation_id, reused: result.begin.reused === true };
    });
    if (failIfNeeded_(state, initial)) return AKORT.Result.failure(initial.error.code, initial.error.message, publicState_(state));

    var duplicate = test_('duplicate_source_protection', function () {
      var beforeCount = rowsForKey_(dwh, TARGET, state.businessKey).length;
      var begin = AKORT.RawStore.beginLoad(source_(state, 'INITIAL_DUPLICATE', 'INITIAL'), {
        operationId: 'ALPHA4_TEST_DUPLICATE_' + state.suiteId
      });
      require_(begin.reused === true && begin.loadId === state.initialLoadId,
        'DUPLICATE_SOURCE_NOT_REUSED', 'Duplicate source hash did not reuse the committed load.', begin);
      var commit = AKORT.RawStore.commitLoad(begin.loadId);
      require_(commit.reused === true, 'DUPLICATE_COMMIT_NOT_IDEMPOTENT', 'Repeated commit was not idempotent.', commit);
      require_(rowsForKey_(dwh, TARGET, state.businessKey).length === beforeCount,
        'DUPLICATE_APPENDED_RAW', 'Duplicate source appended another RAW row.');
      return { loadId: begin.loadId, reused: true, rawRows: beforeCount };
    });
    if (failIfNeeded_(state, duplicate)) return AKORT.Result.failure(duplicate.error.code, duplicate.error.message, publicState_(state));

    state.phase = 'UNCHANGED';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after initial and duplicate checks. Run AKORT_alpha4SmokeTest again.');
  }

  function runUnchanged_(state, config, dwh) {
    var unchanged = test_('unchanged_content', function () {
      var result = AKORT.RawStore.storeNormalized(source_(state, 'UNCHANGED', 'UNCHANGED_SOURCE'), [state.baseRow], {
        operationId: 'ALPHA4_TEST_UNCHANGED_' + state.suiteId
      });
      var history = rowsForKey_(dwh, TARGET, state.businessKey);
      require_(history.length === 1, 'UNCHANGED_ROW_COUNT', 'Unchanged content appended a RAW row.', history);
      require_(latestForKey_(dwh, TARGET, state.businessKey).length === 1,
        'UNCHANGED_LATEST_CONTRACT', 'Unchanged content broke latest-row uniqueness.');
      return { loadId: result.begin.loadId, action: 'UNCHANGED', reused: result.begin.reused === true };
    });
    if (failIfNeeded_(state, unchanged)) return AKORT.Result.failure(unchanged.error.code, unchanged.error.message, publicState_(state));

    state.phase = 'REVISION';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after unchanged-content check. Run AKORT_alpha4SmokeTest again.');
  }

  function runRevision_(state, config, dwh) {
    var revision = test_('revision_logic', function () {
      var revisedRow = clone_(state.baseRow);
      revisedRow.value = 101;
      var result = AKORT.RawStore.storeNormalized(source_(state, 'REVISION', 'REVISION'), [revisedRow], {
        operationId: 'ALPHA4_TEST_REVISION_' + state.suiteId
      });
      state.revisionLoadId = result.begin.loadId;
      var history = rowsForKey_(dwh, TARGET, state.businessKey);
      require_(history.length === 2, 'REVISION_HISTORY_COUNT', 'Revision did not preserve two physical versions.', history);
      require_(Number(history[0].is_latest) === 0 && Number(history[1].is_latest) === 1,
        'REVISION_LATEST_FLAGS', 'Revision latest flags are incorrect.', history);
      require_(Number(history[1].version_no) === 2 && String(history[1].revision_type) === 'REVISION',
        'REVISION_METADATA', 'Revision metadata is incorrect.', history[1]);
      require_(Number(history[1].value) === 101, 'REVISION_VALUE', 'Latest revision value is incorrect.', history[1]);
      return {
        loadId: state.revisionLoadId,
        reused: result.begin.reused === true,
        versions: history.map(function (row) {
          return { version: row.version_no, latest: row.is_latest, value: row.value };
        })
      };
    });
    if (failIfNeeded_(state, revision)) return AKORT.Result.failure(revision.error.code, revision.error.message, publicState_(state));

    state.phase = 'REVERSAL';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after revision check. Run AKORT_alpha4SmokeTest again.');
  }

  function runReversal_(state, config, dwh) {
    var reversalTest = test_('logical_reversal', function () {
      require_(!!state.revisionLoadId, 'REVISION_LOAD_ID_MISSING', 'Revision load ID is missing from the smoke checkpoint.');
      var idempotencyKey = 'ALPHA4_TEST_' + state.suiteId + '_REVERSAL';
      var queued = AKORT.OperationEngine.enqueue('RAW_REVERSAL_V4', {
        targetLoadId: state.revisionLoadId,
        reason: 'Alpha.4 resumable smoke reversal'
      }, { idempotencyKey: idempotencyKey, maxAttempts: 3 });
      require_(queued.ok, 'REVERSAL_OPERATION_QUEUE_FAILED', 'RAW_REVERSAL_V4 operation was not queued.', queued);
      var operationId = queued.data.operationId;
      var executed = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
      require_(executed.ok && executed.status === 'SUCCESS',
        'REVERSAL_OPERATION_FAILED', 'RAW_REVERSAL_V4 did not reach SUCCESS.', executed);
      var operationStatus = AKORT.OperationEngine.status(operationId);
      var reversal = operationStatus.data.operation.checkpoint.rawStore.reversal;
      require_(reversal && Number(reversal.reversedRows) === 1,
        'REVERSAL_ROW_COUNT', 'Logical reversal did not reverse one row.', reversal);
      var history = rowsForKey_(dwh, TARGET, state.businessKey);
      require_(history.length === 2, 'REVERSAL_DELETED_HISTORY', 'Logical reversal physically deleted RAW history.', history);
      require_(Number(history[0].is_latest) === 1 && Number(history[1].is_latest) === 0,
        'REVERSAL_LATEST_FLAGS', 'Logical reversal did not restore the previous version.', history);
      require_(String(AKORT.RawStore.Test.findLoad(state.revisionLoadId).status) === 'REVERSED',
        'REVERSAL_LOAD_STATUS', 'Reversed load is not marked REVERSED.');
      var beforeRepeat = operationStatus.data.steps.length;
      var repeated = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
      require_(repeated.ok && repeated.status === 'SUCCESS',
        'REVERSAL_REPEAT_FAILED', 'Repeated reversal operation did not remain successful.', repeated);
      require_(AKORT.OperationEngine.status(operationId).data.steps.length === beforeRepeat,
        'REVERSAL_REEXECUTED', 'Repeated reversal operation created new steps.');
      return {
        operationId: operationId,
        targetLoadId: state.revisionLoadId,
        reversalLoadId: reversal.reversalLoadId,
        restoredObservationId: history[0].observation_id
      };
    });
    if (failIfNeeded_(state, reversalTest)) return AKORT.Result.failure(reversalTest.error.code, reversalTest.error.message, publicState_(state));

    state.phase = 'OPERATION';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after logical reversal. Run AKORT_alpha4SmokeTest again.');
  }

  function runOperation_(state, config, dwh) {
    var operationTest = test_('operation_engine_integration', function () {
      var opRow = {
        dataset_code: 'ALPHA4_TEST_DATASET',
        category_id: 'ALPHA4_TEST_OPERATION_' + state.suiteId,
        value_type: 'PRICE_INDEX',
        index_type: 'TEST',
        observation_date: '2099-02-01',
        value: 200,
        source_published_at: '2099-02-02'
      };
      var sourceId = 'ALPHA4_TEST_' + state.suiteId + '_OPERATION';
      var queued = AKORT.OperationEngine.enqueue('RAW_LOAD_V4', {
        targetTable: TARGET,
        sourceId: sourceId,
        sourceName: sourceId,
        sourceHash: AKORT.Core.sha256(sourceId),
        rows: [opRow]
      }, { idempotencyKey: sourceId, maxAttempts: 3 });
      require_(queued.ok, 'RAW_OPERATION_QUEUE_FAILED', 'RAW_LOAD_V4 operation was not queued.', queued);
      var operationId = queued.data.operationId;
      var executed = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
      require_(executed.ok && executed.status === 'SUCCESS',
        'RAW_OPERATION_FAILED', 'RAW_LOAD_V4 operation did not reach SUCCESS.', executed);
      var status = AKORT.OperationEngine.status(operationId);
      var checkpoint = status.data.operation.checkpoint;
      require_(checkpoint.rawStore && checkpoint.rawStore.loadId,
        'RAW_OPERATION_LOAD_ID_MISSING', 'Operation checkpoint does not contain load_id.', checkpoint);
      require_(checkpoint.rawStore.audit && checkpoint.rawStore.audit.ok === true,
        'RAW_OPERATION_AUDIT_MISSING', 'Operation checkpoint does not contain a successful RAW audit.', checkpoint);
      require_(status.data.steps.map(function (step) { return String(step.phase); }).join('|') === AKORT.OperationEngine.Phases.join('|'),
        'RAW_OPERATION_PHASE_SEQUENCE', 'RAW_LOAD_V4 did not follow the complete phase sequence.', status.data.steps);
      return {
        operationId: operationId,
        loadId: checkpoint.rawStore.loadId,
        phases: status.data.steps.map(function (step) { return step.phase; })
      };
    });
    if (failIfNeeded_(state, operationTest)) return AKORT.Result.failure(operationTest.error.code, operationTest.error.message, publicState_(state));

    state.phase = 'FINALIZE';
    return paused_(state, 'Alpha.4 smoke checkpoint saved after Operation Engine integration. Run AKORT_alpha4SmokeTest once more to clean up and finalize.');
  }

  function finalize_(state, config) {
    state.cleanupAfter = AKORT.RawStore.Test.cleanup('ALPHA4_TEST_');
    var baseline = test_('baseline_and_publish_restored', function () {
      var after = baselineCounts_(config);
      require_(JSON.stringify(after) === JSON.stringify(state.before),
        'ALPHA4_TEST_CLEANUP_FAILED', 'Smoke test did not restore RAW and Publish physical counts.',
        { before: state.before, after: after, cleanup: state.cleanupAfter });
      var expected = config.baselinePhysicalExpected;
      Object.keys(expected).forEach(function (field) {
        require_(Number(after[field]) === Number(expected[field]),
          'BASELINE_EXPECTATION_MISMATCH', 'Physical row count differs from verified baseline for ' + field,
          { expected: expected[field], actual: after[field] });
      });
      return { before: state.before, after: after, cleanup: state.cleanupAfter };
    });
    if (failIfNeeded_(state, baseline)) return AKORT.Result.failure(baseline.error.code, baseline.error.message, publicState_(state));

    state.status = 'SUCCESS';
    state.phase = 'SUCCESS';
    state.finishedAt = AKORT.Core.now();
    saveState_(state);
    return AKORT.Result.success('Alpha.4 Raw Store smoke test passed.', publicState_(state));
  }

  function runSmokeTest() {
    return AKORT.Core.safeRun('ALPHA4_SMOKE_TEST', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var state = loadState_();
      if (!state) {
        state = initialize_();
        context.logger.info('Alpha.4 resumable smoke test initialized.', publicState_(state), {
          eventCode: 'ALPHA4_SMOKE_INITIALIZED'
        });
        return AKORT.Result.paused('Alpha.4 smoke test initialized. Run AKORT_alpha4SmokeTest again to execute the first segment.', publicState_(state));
      }
      if (state.status === 'SUCCESS') {
        return AKORT.Result.success('Alpha.4 Raw Store smoke test already passed.', publicState_(state));
      }
      if (state.status === 'FAILED') {
        return AKORT.Result.failure(
          state.error && state.error.code ? state.error.code : 'ALPHA4_SMOKE_TEST_FAILED',
          state.error && state.error.message ? state.error.message : 'Alpha.4 smoke test is in FAILED state. Reset it before retrying.',
          publicState_(state)
        );
      }

      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var result;
      if (state.phase === 'CONTRACT') result = runContract_(state, config, dwh);
      else if (state.phase === 'INITIAL') result = runInitial_(state, config, dwh);
      else if (state.phase === 'UNCHANGED') result = runUnchanged_(state, config, dwh);
      else if (state.phase === 'REVISION') result = runRevision_(state, config, dwh);
      else if (state.phase === 'REVERSAL') result = runReversal_(state, config, dwh);
      else if (state.phase === 'OPERATION') result = runOperation_(state, config, dwh);
      else if (state.phase === 'FINALIZE') result = finalize_(state, config);
      else throw AKORT.Core.error('ALPHA4_SMOKE_PHASE_INVALID', 'Unsupported alpha.4 smoke-test phase.', { phase: state.phase });

      context.logger.info('Alpha.4 resumable smoke segment completed.', {
        suiteId: state.suiteId,
        phase: state.phase,
        status: result.status,
        tests: (state.tests || []).map(function (item) { return { id: item.id, status: item.status }; })
      }, { eventCode: state.phase === 'SUCCESS' ? 'ALPHA4_SMOKE_PASS' : 'ALPHA4_SMOKE_CHECKPOINT' });
      return result;
    }, { lock: false, persistLogs: true });
  }

  function status() {
    var state = loadState_();
    if (!state) return AKORT.Result.success('No active alpha.4 smoke-test checkpoint.', { status: 'NOT_STARTED' });
    return state.status === 'FAILED'
      ? AKORT.Result.failure(state.error && state.error.code ? state.error.code : 'ALPHA4_SMOKE_TEST_FAILED',
          state.error && state.error.message ? state.error.message : 'Alpha.4 smoke test failed.', publicState_(state))
      : AKORT.Result.success('Alpha.4 smoke-test checkpoint loaded.', publicState_(state));
  }

  function reset() {
    return AKORT.Core.safeRun('ALPHA4_SMOKE_RESET', function () {
      AKORT.EnvironmentGuard.assertDev();
      var cleanup = AKORT.RawStore.Test.cleanup('ALPHA4_TEST_');
      clearState_();
      return AKORT.Result.success('Alpha.4 smoke-test checkpoint and test artifacts were cleared.', {
        cleanup: cleanup,
        nextAction: 'Run AKORT_alpha4SmokeTest to initialize a new resumable test.'
      });
    }, { lock: false, persistLogs: true });
  }

  return {
    runSmokeTest: runSmokeTest,
    status: status,
    reset: reset
  };
})();
