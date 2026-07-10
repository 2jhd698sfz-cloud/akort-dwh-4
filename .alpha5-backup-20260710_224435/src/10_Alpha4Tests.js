var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Alpha4Tests = (function () {
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

  function rawRows_(spreadsheet, targetTable) {
    var sheet = spreadsheet.getSheetByName(targetTable);
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function rowsForKey_(spreadsheet, targetTable, businessKey) {
    return rawRows_(spreadsheet, targetTable).filter(function (row) {
      return AKORT.RawStore.businessKey(targetTable, row) === businessKey;
    }).sort(function (a, b) { return Number(a.version_no || 0) - Number(b.version_no || 0); });
  }

  function latestForKey_(spreadsheet, targetTable, businessKey) {
    return rowsForKey_(spreadsheet, targetTable, businessKey).filter(function (row) {
      var value = row.is_latest;
      return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
    });
  }

  function source_(suiteId, suffix, hashSuffix) {
    return {
      targetTable: 'RAW_PRICES_WEEKLY',
      sourceId: 'ALPHA4_TEST_' + suiteId + '_' + suffix,
      sourceName: 'ALPHA4_TEST_' + suffix,
      sourceHash: AKORT.Core.sha256('ALPHA4|' + suiteId + '|' + hashSuffix)
    };
  }

  function runSmokeTest() {
    return AKORT.Core.safeRun('ALPHA4_SMOKE_TEST', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var publish = SpreadsheetApp.openById(config.resources.publishSpreadsheetId);
      var suiteId = AKORT.Core.Id.execution();
      var cleanupBefore = AKORT.RawStore.Test.cleanup('ALPHA4_TEST_');
      var tests = [];
      var target = 'RAW_PRICES_WEEKLY';
      var baseRow = {
        dataset_code: 'ALPHA4_TEST_DATASET',
        category_id: 'ALPHA4_TEST_CATEGORY_' + suiteId,
        value_type: 'PRICE_INDEX',
        index_type: 'TEST',
        observation_date: '2099-01-01',
        value: 100,
        source_published_at: '2099-01-02'
      };
      var key = AKORT.RawStore.businessKey(target, AKORT.RawStore.normalizeRow(target, baseRow));
      var initialLoadId = '';
      var revisionLoadId = '';

      var before = {
        rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
        rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
        rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
        publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
        publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
        publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
        publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
      };

      tests.push(test_('raw_store_contract', function () {
        require_(AKORT.Release.version === '4.0.0-alpha.4', 'RELEASE_VERSION_MISMATCH', 'Unexpected alpha.4 release version.');
        require_(AKORT.Release.rawSchemaVersion === '4.0-raw-1', 'RAW_SCHEMA_VERSION_MISMATCH', 'Unexpected RAW schema version.');
        ['RAW_STAGE', 'RAW_LOAD_REGISTRY', 'RAW_REVERSAL_LOG'].forEach(function (name) {
          var sheet = dwh.getSheetByName(name);
          require_(!!sheet, 'RAW_SERVICE_TABLE_MISSING', 'Missing alpha.4 service table ' + name);
          var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
          require_(JSON.stringify(actual) === JSON.stringify(AKORT.RawStore.Tables[name]), 'RAW_SERVICE_SCHEMA_MISMATCH', 'Schema mismatch in ' + name, { actual: actual, expected: AKORT.RawStore.Tables[name] });
        });
        return { rawSchemaVersion: AKORT.Release.rawSchemaVersion, serviceTables: Object.keys(AKORT.RawStore.Tables) };
      }));

      tests.push(test_('business_key_and_content_hash', function () {
        var normalizedA = AKORT.RawStore.normalizeRow(target, baseRow);
        var normalizedB = AKORT.RawStore.normalizeRow(target, baseRow);
        var keyA = AKORT.RawStore.businessKey(target, normalizedA);
        var keyB = AKORT.RawStore.businessKey(target, normalizedB);
        var hashA = AKORT.RawStore.contentHash(target, normalizedA);
        var hashB = AKORT.RawStore.contentHash(target, normalizedB);
        require_(keyA === keyB, 'BUSINESS_KEY_NOT_DETERMINISTIC', 'Business key is not deterministic.');
        require_(hashA === hashB, 'CONTENT_HASH_NOT_DETERMINISTIC', 'Content hash is not deterministic.');
        var changed = {};
        Object.keys(baseRow).forEach(function (field) { changed[field] = baseRow[field]; });
        changed.value = 101;
        require_(AKORT.RawStore.contentHash(target, AKORT.RawStore.normalizeRow(target, changed)) !== hashA, 'CONTENT_HASH_IGNORES_VALUE', 'Content hash did not change with the observation value.');
        return { businessKey: keyA, contentHash: hashA };
      }));

      tests.push(test_('initial_commit', function () {
        var src = source_(suiteId, 'INITIAL', 'INITIAL');
        var result = AKORT.RawStore.storeNormalized(src, [baseRow], { operationId: 'ALPHA4_TEST_DIRECT_INITIAL' });
        initialLoadId = result.begin.loadId;
        require_(result.commit.status === 'COMMITTED', 'INITIAL_COMMIT_STATUS', 'Initial RAW load did not commit.', result);
        require_(Number(result.commit.inserted) === 1 && Number(result.commit.revised) === 0, 'INITIAL_COMMIT_COUNTS', 'Initial RAW load counts are incorrect.', result.commit);
        var history = rowsForKey_(dwh, target, key);
        require_(history.length === 1, 'INITIAL_ROW_COUNT', 'Initial RAW commit did not append exactly one row.', history);
        require_(Number(history[0].version_no) === 1 && String(history[0].revision_type) === 'INITIAL', 'INITIAL_VERSION_CONTRACT', 'Initial version metadata is incorrect.', history[0]);
        require_(latestForKey_(dwh, target, key).length === 1, 'INITIAL_LATEST_CONTRACT', 'Initial row is not uniquely latest.');
        return { loadId: initialLoadId, observationId: history[0].observation_id };
      }));

      tests.push(test_('duplicate_source_protection', function () {
        var beforeCount = rowsForKey_(dwh, target, key).length;
        var src = source_(suiteId, 'INITIAL_DUPLICATE', 'INITIAL');
        var begin = AKORT.RawStore.beginLoad(src, { operationId: 'ALPHA4_TEST_DUPLICATE' });
        require_(begin.reused === true && begin.loadId === initialLoadId, 'DUPLICATE_SOURCE_NOT_REUSED', 'Duplicate source hash did not reuse the committed load.', begin);
        var commit = AKORT.RawStore.commitLoad(begin.loadId);
        require_(commit.reused === true, 'DUPLICATE_COMMIT_NOT_IDEMPOTENT', 'Repeated commit was not idempotent.', commit);
        require_(rowsForKey_(dwh, target, key).length === beforeCount, 'DUPLICATE_APPENDED_RAW', 'Duplicate source appended another RAW row.');
        return { loadId: begin.loadId, reused: begin.reused, rawRows: beforeCount };
      }));

      tests.push(test_('unchanged_content', function () {
        var src = source_(suiteId, 'UNCHANGED', 'UNCHANGED_SOURCE');
        var result = AKORT.RawStore.storeNormalized(src, [baseRow], { operationId: 'ALPHA4_TEST_UNCHANGED' });
        require_(Number(result.commit.unchanged) === 1, 'UNCHANGED_NOT_DETECTED', 'Same business content was not classified as unchanged.', result.commit);
        require_(Number(result.commit.inserted) === 0 && Number(result.commit.revised) === 0, 'UNCHANGED_MUTATED_RAW', 'Unchanged content mutated RAW.', result.commit);
        require_(rowsForKey_(dwh, target, key).length === 1, 'UNCHANGED_ROW_COUNT', 'Unchanged content appended a RAW row.');
        return { loadId: result.begin.loadId, action: 'UNCHANGED' };
      }));

      tests.push(test_('revision_logic', function () {
        var revisedRow = {};
        Object.keys(baseRow).forEach(function (field) { revisedRow[field] = baseRow[field]; });
        revisedRow.value = 101;
        var src = source_(suiteId, 'REVISION', 'REVISION');
        var result = AKORT.RawStore.storeNormalized(src, [revisedRow], { operationId: 'ALPHA4_TEST_REVISION' });
        revisionLoadId = result.begin.loadId;
        require_(Number(result.commit.revised) === 1, 'REVISION_NOT_CLASSIFIED', 'Changed content was not classified as a revision.', result.commit);
        var history = rowsForKey_(dwh, target, key);
        require_(history.length === 2, 'REVISION_HISTORY_COUNT', 'Revision did not preserve two physical versions.', history);
        require_(Number(history[0].is_latest) === 0 && Number(history[1].is_latest) === 1, 'REVISION_LATEST_FLAGS', 'Revision latest flags are incorrect.', history);
        require_(Number(history[1].version_no) === 2 && String(history[1].revision_type) === 'REVISION', 'REVISION_METADATA', 'Revision metadata is incorrect.', history[1]);
        require_(Number(history[1].value) === 101, 'REVISION_VALUE', 'Latest revision value is incorrect.', history[1]);
        return { loadId: revisionLoadId, versions: history.map(function (row) { return { version: row.version_no, latest: row.is_latest, value: row.value }; }) };
      }));

      tests.push(test_('logical_reversal', function () {
        var idempotencyKey = 'ALPHA4_TEST_' + suiteId + '_REVERSAL';
        var queued = AKORT.OperationEngine.enqueue('RAW_REVERSAL_V4', {
          targetLoadId: revisionLoadId,
          reason: 'Alpha.4 smoke reversal'
        }, { idempotencyKey: idempotencyKey, maxAttempts: 3 });
        require_(queued.ok, 'REVERSAL_OPERATION_QUEUE_FAILED', 'RAW_REVERSAL_V4 operation was not queued.', queued);
        var operationId = queued.data.operationId;
        var executed = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        require_(executed.ok && executed.status === 'SUCCESS', 'REVERSAL_OPERATION_FAILED', 'RAW_REVERSAL_V4 did not reach SUCCESS.', executed);
        var operationStatus = AKORT.OperationEngine.status(operationId);
        var reversal = operationStatus.data.operation.checkpoint.rawStore.reversal;
        require_(reversal && Number(reversal.reversedRows) === 1, 'REVERSAL_ROW_COUNT', 'Logical reversal did not reverse one row.', reversal);
        var history = rowsForKey_(dwh, target, key);
        require_(history.length === 2, 'REVERSAL_DELETED_HISTORY', 'Logical reversal physically deleted RAW history.', history);
        require_(Number(history[0].is_latest) === 1 && Number(history[1].is_latest) === 0, 'REVERSAL_LATEST_FLAGS', 'Logical reversal did not restore the previous version.', history);
        require_(String(AKORT.RawStore.Test.findLoad(revisionLoadId).status) === 'REVERSED', 'REVERSAL_LOAD_STATUS', 'Reversed load is not marked REVERSED.');
        var beforeRepeat = operationStatus.data.steps.length;
        var repeated = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        require_(repeated.ok && repeated.status === 'SUCCESS', 'REVERSAL_REPEAT_FAILED', 'Repeated reversal operation did not remain successful.', repeated);
        require_(AKORT.OperationEngine.status(operationId).data.steps.length === beforeRepeat, 'REVERSAL_REEXECUTED', 'Repeated reversal operation created new steps.');
        return { operationId: operationId, targetLoadId: revisionLoadId, reversalLoadId: reversal.reversalLoadId, restoredObservationId: history[0].observation_id };
      }));

      tests.push(test_('operation_engine_integration', function () {
        var opRow = {
          dataset_code: 'ALPHA4_TEST_DATASET',
          category_id: 'ALPHA4_TEST_OPERATION_' + suiteId,
          value_type: 'PRICE_INDEX',
          index_type: 'TEST',
          observation_date: '2099-02-01',
          value: 200,
          source_published_at: '2099-02-02'
        };
        var sourceId = 'ALPHA4_TEST_' + suiteId + '_OPERATION';
        var queued = AKORT.OperationEngine.enqueue('RAW_LOAD_V4', {
          targetTable: target,
          sourceId: sourceId,
          sourceName: sourceId,
          sourceHash: AKORT.Core.sha256(sourceId),
          rows: [opRow]
        }, { idempotencyKey: sourceId, maxAttempts: 3 });
        require_(queued.ok, 'RAW_OPERATION_QUEUE_FAILED', 'RAW_LOAD_V4 operation was not queued.', queued);
        var operationId = queued.data.operationId;
        var executed = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        require_(executed.ok && executed.status === 'SUCCESS', 'RAW_OPERATION_FAILED', 'RAW_LOAD_V4 operation did not reach SUCCESS.', executed);
        var status = AKORT.OperationEngine.status(operationId);
        var checkpoint = status.data.operation.checkpoint;
        require_(checkpoint.rawStore && checkpoint.rawStore.loadId, 'RAW_OPERATION_LOAD_ID_MISSING', 'Operation checkpoint does not contain load_id.', checkpoint);
        require_(checkpoint.rawStore.audit && checkpoint.rawStore.audit.ok === true, 'RAW_OPERATION_AUDIT_MISSING', 'Operation checkpoint does not contain a successful RAW audit.', checkpoint);
        require_(status.data.steps.map(function (step) { return String(step.phase); }).join('|') === AKORT.OperationEngine.Phases.join('|'), 'RAW_OPERATION_PHASE_SEQUENCE', 'RAW_LOAD_V4 did not follow the complete phase sequence.', status.data.steps);
        return { operationId: operationId, loadId: checkpoint.rawStore.loadId, phases: status.data.steps.map(function (step) { return step.phase; }) };
      }));

      var cleanupAfter = AKORT.RawStore.Test.cleanup('ALPHA4_TEST_');

      tests.push(test_('baseline_and_publish_restored', function () {
        var after = {
          rawWeeklyRows: physicalRowCount_(dwh, 'RAW_PRICES_WEEKLY'),
          rawMonthlyRows: physicalRowCount_(dwh, 'RAW_PRICES_MONTHLY'),
          rawIndustryRows: physicalRowCount_(dwh, 'RAW_INDUSTRY'),
          publishWeeklyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_WEEKLY'),
          publishMonthlyRows: physicalRowCount_(publish, 'PUBLISH_PRICES_MONTHLY'),
          publishIndustryRows: physicalRowCount_(publish, 'PUBLISH_INDUSTRY'),
          publishAggregateRows: physicalRowCount_(publish, 'PUBLISH_PRICE_AGGREGATES')
        };
        require_(JSON.stringify(after) === JSON.stringify(before), 'ALPHA4_TEST_CLEANUP_FAILED', 'Smoke test did not restore RAW and Publish physical counts.', { before: before, after: after, cleanup: cleanupAfter });
        var expected = config.baselinePhysicalExpected;
        Object.keys(expected).forEach(function (field) {
          require_(Number(after[field]) === Number(expected[field]), 'BASELINE_EXPECTATION_MISMATCH', 'Physical row count differs from verified baseline for ' + field, { expected: expected[field], actual: after[field] });
        });
        return { before: before, after: after, cleanup: cleanupAfter };
      }));

      var ok = tests.every(function (test) { return test.status === 'PASS'; });
      context.logger.info('Alpha.4 smoke test completed', {
        suiteId: suiteId,
        status: ok ? 'PASS' : 'FAIL',
        cleanupBefore: cleanupBefore,
        cleanupAfter: cleanupAfter,
        tests: tests.map(function (test) { return { id: test.id, status: test.status }; })
      }, { eventCode: ok ? 'ALPHA4_SMOKE_PASS' : 'ALPHA4_SMOKE_FAIL' });

      return ok
        ? AKORT.Result.success('Alpha.4 Raw Store smoke test passed.', {
          suiteId: suiteId,
          cleanupBefore: cleanupBefore,
          cleanupAfter: cleanupAfter,
          tests: tests,
          rawStore: AKORT.RawStore.statusSummary()
        })
        : AKORT.Result.failure('ALPHA4_SMOKE_TEST_FAILED', 'One or more Raw Store checks failed.', {
          suiteId: suiteId,
          cleanupBefore: cleanupBefore,
          cleanupAfter: cleanupAfter,
          tests: tests
        });
    }, { lock: false, persistLogs: true });
  }

  return { runSmokeTest: runSmokeTest };
})();
