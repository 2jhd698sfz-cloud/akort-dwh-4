var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 5 full reconciliation and performance acceptance.
 *
 * The harness is deliberately isolated from the DataLens-connected Publish:
 * - immutable baseline and live Publish are copied before normalization;
 * - full build and sequential replay write only to Test Files workbooks;
 * - aggregate replay writes pass through the Alpha.7.4 logical-series boundary;
 * - a persistent one-minute trigger continues from a compact checkpoint.
 */
AKORT.Alpha74Gate5Acceptance = (function () {
  var VERSION = '4.0-alpha74-gate5-acceptance-5';
  var RELEASE = '4.0.0-alpha.7.4.7';
  var EVIDENCE_SCHEMA_VERSION = '4.0-alpha74-gate5-evidence-5';
  var STATE_SCHEMA_VERSION = '4.0-alpha74-gate5-state-5';
  var STATE_KEY = 'AKORT_ALPHA74_GATE5_STATE_V1';
  var STOP_REQUEST_KEY = 'AKORT_ALPHA74_GATE5_STOP_REQUEST_V1';
  var AGGREGATE_WORK_SCHEMA_VERSION = '4.0-alpha74-gate5-aggregate-work-1';
  var TRIGGER_HANDLER = 'AKORT_alpha74Gate5Worker';
  var TRIGGER_MINUTES = 1;
  var PROPERTY_MAX_BYTES = 8500;
  var WORKER_BUDGET_MS = 120000;
  var WORKER_MAX_STEPS = 12;
  var DIGEST_CHUNK_ROWS = 1000;
  var PRICE_REPLAY_CHUNK_ITEMS = 2;
  var AGGREGATE_COMBO_BATCH = 25;
  var AGGREGATE_SERIES_BATCH = 32;
  var MAX_CONSECUTIVE_ERRORS = 6;
  var TARGET_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var GROUP_SHEET = 'GATE5_REPLAY_GROUPS';
  var FRONTIER_SHEET = 'GATE5_FRONTIER';
  var AGGREGATE_CACHE_SHEET = 'GATE5_AGGREGATE_BATCH_STAGE';
  var DIGEST_SHEET = 'GATE5_DIGEST_PARTS';
  var EVIDENCE_INTENT_SHEET = 'GATE5_EVIDENCE_INTENT';
  var GROUP_HEADERS = Object.freeze([
    'sequence_no', 'load_id', 'loaded_at_ms', 'is_reversal',
    'reverse_targets_json', 'status'
  ]);
  var FULL_STAGES = Object.freeze([
    'WEEKLY',
    'MONTHLY',
    'INDUSTRY',
    'AGGREGATES_WEEKLY',
    'AGGREGATES_MONTHLY',
    'AGGREGATES_SPECIAL',
    'AGGREGATES_LATEST'
  ]);
  var REPLAY_STAGES = Object.freeze([
    'WEEKLY',
    'MONTHLY',
    'INDUSTRY',
    'AGGREGATES'
  ]);
  var NORMALIZE_TARGETS = Object.freeze([
    'baselineCanonical',
    'liveSnapshot',
    'fullBuild',
    'sequentialReplay'
  ]);
  var DIGEST_TARGETS = NORMALIZE_TARGETS;

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function clone_(value) {
    if (Array.isArray(value)) return value.map(clone_);
    if (value && typeof value === 'object') {
      if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = clone_(value[key]); });
      return out;
    }
    return value;
  }

  function stable_(value) {
    if (Array.isArray(value)) return value.map(stable_);
    if (value && typeof value === 'object') {
      if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
      var out = {};
      Object.keys(value).sort().forEach(function (key) {
        if (['__row', '_rowNumber', 'created_at', 'updated_at'].indexOf(key) < 0) out[key] = stable_(value[key]);
      });
      return out;
    }
    if (typeof value === 'number' && !isFinite(value)) return null;
    return value;
  }

  function hash_(value) {
    var serialized = typeof value === 'string' ? value : JSON.stringify(stable_(value));
    if (AKORT.Core && typeof AKORT.Core.sha256 === 'function') return AKORT.Core.sha256(serialized);
    return AKORT.AggregateIntegration.Test.hash(serialized);
  }

  function error_(code, message, details) {
    if (AKORT.Core && typeof AKORT.Core.error === 'function') return AKORT.Core.error(code, message, details || {});
    var error = new Error(message);
    error.code = code;
    error.details = details || {};
    return error;
  }

  function assert_(condition, code, message, details) {
    if (!condition) throw error_(code, message, details);
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function now_() {
    return AKORT.Core && typeof AKORT.Core.now === 'function' ? AKORT.Core.now() : new Date().toISOString();
  }

  function periodKey_(frequency, value) {
    return AKORT.AggregateContract.Test.periodKey(frequency, value);
  }

  function resources_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var resources = config.resources || {};
    [
      'dwhSpreadsheetId',
      'publishSpreadsheetId',
      'testFilesFolderId',
      'testResultsFolderId',
      'alpha71BaselinePublishSpreadsheetId'
    ].forEach(function (key) {
      assert_(text_(resources[key]), 'ALPHA74_GATE5_RESOURCE_MISSING', 'Gate 5 canonical resource is missing.', { resource: key });
    });
    return {
      dwhSpreadsheetId: text_(resources.dwhSpreadsheetId),
      publishSpreadsheetId: text_(resources.publishSpreadsheetId),
      testFilesFolderId: text_(resources.testFilesFolderId),
      testResultsFolderId: text_(resources.testResultsFolderId),
      baselineSpreadsheetId: text_(resources.alpha71BaselinePublishSpreadsheetId)
    };
  }

  function flagState_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      executionEnabled: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
      regularPipelineEnabled: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)
    };
  }

  function assertFlags_() {
    var flags = flagState_();
    assert_(flags.executionEnabled, 'ALPHA74_GATE5_EXECUTION_DISABLED', 'Gate 5 requires PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE.', flags);
    assert_(!flags.regularPipelineEnabled, 'ALPHA74_GATE5_REGULAR_PIPELINE_ENABLED', 'Gate 5 requires PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE.', flags);
    return flags;
  }

  function stateBytes_(state) {
    var serialized = JSON.stringify(state || {});
    if (typeof Utilities !== 'undefined' && Utilities.newBlob) return Utilities.newBlob(serialized).getBytes().length;
    return serialized.length;
  }

  function saveState_(state) {
    state.updatedAt = now_();
    var bytes = stateBytes_(state);
    assert_(bytes <= PROPERTY_MAX_BYTES, 'ALPHA74_GATE5_STATE_TOO_LARGE', 'Gate 5 checkpoint exceeds the safe Script Properties value size.', {
      bytes: bytes,
      maxBytes: PROPERTY_MAX_BYTES
    });
    PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
    return state;
  }

  function loadState_() {
    var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function requestStop_() {
    PropertiesService.getScriptProperties().setProperty(STOP_REQUEST_KEY, now_());
  }

  function clearStopRequest_() {
    PropertiesService.getScriptProperties().deleteProperty(STOP_REQUEST_KEY);
  }

  function stopRequested_() {
    return !!PropertiesService.getScriptProperties().getProperty(STOP_REQUEST_KEY);
  }

  function markStopped_(state) {
    if (!state || state.status !== 'RUNNING') return state;
    state.status = 'STOPPED';
    state.phase = 'STOPPED';
    state.finishedAt = now_();
    state.nextRetryAt = '';
    state.failureCode = 'STOPPED_MANUALLY';
    state.failureDetails = { artifactsPreserved: true };
    return state;
  }

  function triggers_() {
    return ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === TRIGGER_HANDLER;
    });
  }

  function deleteTriggers_() {
    var triggers = triggers_();
    triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    return triggers.length;
  }

  function ensureTrigger_() {
    var triggers = triggers_();
    if (!triggers.length) {
      ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyMinutes(TRIGGER_MINUTES).create();
      triggers = triggers_();
    }
    if (triggers.length > 1) {
      triggers.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
      triggers = triggers_();
    }
    return triggers.length;
  }

  function timestamp_() {
    return Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyyMMdd_HHmmss');
  }

  function createBook_(name, folderId) {
    var spreadsheet = SpreadsheetApp.create(name);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(DriveApp.getFolderById(folderId));
    AKORT.IncrementalPublish.Gate5.initializeBook(spreadsheet.getId());
    return {
      id: spreadsheet.getId(),
      name: spreadsheet.getName(),
      url: 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/edit'
    };
  }

  function copyBook_(sourceId, name, folderId) {
    var file = DriveApp.getFileById(sourceId).makeCopy(name, DriveApp.getFolderById(folderId));
    var spreadsheet = SpreadsheetApp.openById(file.getId());
    assert_(spreadsheet.getSheetByName(TARGET_SHEET), 'ALPHA74_GATE5_COPY_TARGET_MISSING', 'Gate 5 source copy does not contain the aggregate target.', {
      sourceId: sourceId,
      copyId: file.getId()
    });
    return {
      id: file.getId(),
      name: file.getName(),
      url: 'https://docs.google.com/spreadsheets/d/' + file.getId() + '/edit'
    };
  }

  function ensureAuxiliarySheet_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    var actual = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
    var blank = !actual.length || actual.every(function (value) { return text_(value) === ''; });
    if (blank) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    else assert_(JSON.stringify(actual.slice(0, headers.length)) === JSON.stringify(headers), 'ALPHA74_GATE5_AUX_SCHEMA_MISMATCH', 'Gate 5 auxiliary sheet schema mismatch.', {
      sheet: name,
      expected: headers,
      actual: actual
    });
    sheet.setFrozenRows(1);
    return sheet;
  }

  function writeReplayGroups_(state, groups) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var sheet = ensureAuxiliarySheet_(spreadsheet, GROUP_SHEET, GROUP_HEADERS.slice());
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, GROUP_HEADERS.length).clearContent();
    var rows = (groups || []).map(function (group, index) {
      return [
        index + 1,
        text_(group.loadId),
        Number(group.time || 0),
        group.isReversal === true ? 1 : 0,
        JSON.stringify(group.reverseTargets || []),
        'PENDING'
      ];
    });
    for (var cursor = 0; cursor < rows.length; cursor += 500) {
      var chunk = rows.slice(cursor, cursor + 500);
      sheet.getRange(cursor + 2, 1, chunk.length, GROUP_HEADERS.length).setValues(chunk);
    }
    return rows.length;
  }

  function readGroupRows_(state) {
    var sheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id).getSheetByName(GROUP_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, GROUP_HEADERS.length).getValues().map(function (row, index) {
      var targets;
      try { targets = JSON.parse(String(row[4] || '[]')); }
      catch (caught) { throw error_('ALPHA74_GATE5_GROUP_JSON_INVALID', 'Gate 5 replay group contains invalid reversal targets.', { row: index + 2 }); }
      return {
        __row: index + 2,
        sequenceNo: Number(row[0] || index + 1),
        loadId: text_(row[1]),
        time: Number(row[2] || 0),
        isReversal: Number(row[3] || 0) === 1,
        reverseTargets: targets,
        status: text_(row[5])
      };
    });
  }

  function updateGroupStatus_(state, group, status) {
    var sheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id).getSheetByName(GROUP_SHEET);
    sheet.getRange(group.__row, 6).setValue(status);
  }

  function replayContext_(groupRows, currentIndex) {
    var allowed = {}, reversed = {};
    groupRows.slice(0, currentIndex + 1).forEach(function (group) {
      if (group.isReversal || (group.reverseTargets || []).length) {
        (group.reverseTargets || []).forEach(function (loadId) {
          reversed[text_(loadId)] = true;
          delete allowed[text_(loadId)];
        });
      } else if (group.loadId) {
        allowed[group.loadId] = true;
      }
    });
    return {
      allowedLoadIds: Object.keys(allowed).sort(),
      reversedLoadIds: Object.keys(reversed).sort()
    };
  }

  function writeFrontier_(state, keys) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var sheet = ensureAuxiliarySheet_(spreadsheet, FRONTIER_SHEET, ['frontier_key']);
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
    var rows = (keys || []).map(function (key) { return [key]; });
    for (var cursor = 0; cursor < rows.length; cursor += 1000) {
      var chunk = rows.slice(cursor, cursor + 1000);
      sheet.getRange(cursor + 2, 1, chunk.length, 1).setValues(chunk);
    }
    return {
      count: rows.length,
      hash: hash_((keys || []).join('\n'))
    };
  }

  function readFrontier_(state) {
    var sheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id).getSheetByName(FRONTIER_SHEET);
    var count = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
    var keys = count ? sheet.getRange(2, 1, count, 1).getValues().map(function (row) { return text_(row[0]); }).filter(Boolean) : [];
    assert_(Number(state.frontierCount || 0) === keys.length, 'ALPHA74_GATE5_FRONTIER_COUNT_MISMATCH', 'Gate 5 replay frontier count changed.', {
      expected: Number(state.frontierCount || 0),
      actual: keys.length
    });
    assert_(text_(state.frontierHash) === hash_(keys.join('\n')), 'ALPHA74_GATE5_FRONTIER_HASH_MISMATCH', 'Gate 5 replay frontier hash changed.');
    return keys;
  }

  function readAggregateRows_(spreadsheetId) {
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(TARGET_SHEET);
    assert_(sheet, 'ALPHA74_GATE5_TARGET_SHEET_MISSING', 'Gate 5 aggregate target sheet is missing.', { spreadsheetId: spreadsheetId });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    assert_(JSON.stringify(headers) === JSON.stringify(AKORT.AggregateContract.Headers.slice()), 'ALPHA74_GATE5_TARGET_SCHEMA_MISMATCH', 'Gate 5 aggregate target schema changed.', {
      spreadsheetId: spreadsheetId,
      expected: AKORT.AggregateContract.Headers.slice(),
      actual: headers
    });
    if (sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    return values.map(function (row, index) {
      var object = { __row: index + 2 };
      headers.forEach(function (header, column) { object[header] = row[column]; });
      return object;
    });
  }

  function stageRecords_(publishRows, identity) {
    var headers = AKORT.AggregateContract.Headers.slice();
    return (publishRows || []).map(function (source) {
      var payload = {};
      headers.forEach(function (header) {
        payload[header] = source[header] === undefined || source[header] === null ? '' : source[header];
      });
      var signature = AKORT.AggregateIntegration.Test.publicSignature(payload);
      var seriesKey = 'A74_GATE5_SERIES_' + hash_(signature).slice(0, 24).toUpperCase();
      var period = periodKey_(payload.frequency, payload.period_start);
      var rowKey = seriesKey + '|' + period;
      var record = {
        operation_id: identity.operationId,
        load_id: identity.loadId,
        plan_id: identity.planId,
        plan_fingerprint: identity.planFingerprint,
        calculation_id: identity.calculationId,
        aggregate_series_key: seriesKey,
        aggregate_row_key: rowKey,
        period_start: period,
        action: 'UPSERT',
        row_payload_json: JSON.stringify(payload),
        row_fingerprint: '',
        expected_target_fingerprint: '',
        stage_status: 'STAGED',
        created_at: '',
        verified_at: '',
        release_version: RELEASE
      };
      record.row_fingerprint = hash_({
        seriesKey: seriesKey,
        rowKey: rowKey,
        period: period,
        action: record.action,
        payload: payload
      });
      return record;
    });
  }

  function aggregateStageHeaders_() {
    return AKORT.AggregateIntegration.StageHeaders.slice();
  }

  function writeAggregateBatchCache_(state, records, identity) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var headers = aggregateStageHeaders_();
    var sheet = ensureAuxiliarySheet_(spreadsheet, AGGREGATE_CACHE_SHEET, headers);
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
    }
    var rows = (records || []).map(function (record) {
      return headers.map(function (header) {
        return record[header] === undefined || record[header] === null ? '' : record[header];
      });
    });
    for (var cursor = 0; cursor < rows.length; cursor += 500) {
      var chunk = rows.slice(cursor, cursor + 500);
      sheet.getRange(cursor + 2, 1, chunk.length, headers.length).setValues(chunk);
    }
    SpreadsheetApp.flush();
    var validation = AKORT.AggregateIntegration.Test.validateStageRows(records || [], identity);
    return {
      recordCount: validation.rowCount,
      seriesCount: validation.seriesCount,
      stageFingerprint: validation.stageFingerprint
    };
  }

  function readAggregateBatchCache_(state, work) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var headers = aggregateStageHeaders_();
    var sheet = spreadsheet.getSheetByName(AGGREGATE_CACHE_SHEET);
    assert_(sheet, 'ALPHA74_GATE5_AGGREGATE_CACHE_MISSING', 'The durable aggregate replay batch cache is missing.', {
      spreadsheetId: state.artifacts.sequentialReplay.id
    });
    var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
    assert_(JSON.stringify(actual) === JSON.stringify(headers), 'ALPHA74_GATE5_AGGREGATE_CACHE_SCHEMA_MISMATCH', 'The durable aggregate replay batch cache schema changed.', {
      expected: headers,
      actual: actual
    });
    var count = Math.max(0, Number(work.recordCount || 0));
    assert_(count > 0 && sheet.getLastRow() >= count + 1, 'ALPHA74_GATE5_AGGREGATE_CACHE_INCOMPLETE', 'The durable aggregate replay batch cache is incomplete.', {
      expectedRows: count,
      availableRows: Math.max(0, sheet.getLastRow() - 1)
    });
    var records = sheet.getRange(2, 1, count, headers.length).getValues().map(function (row) {
      var record = {};
      headers.forEach(function (header, column) { record[header] = row[column]; });
      return record;
    });
    var validation = AKORT.AggregateIntegration.Test.validateStageRows(records, work.identity || {});
    assert_(
      validation.rowCount === count &&
        validation.seriesCount === Number(work.seriesCount || 0) &&
        validation.stageFingerprint === text_(work.stageFingerprint),
      'ALPHA74_GATE5_AGGREGATE_CACHE_FINGERPRINT_MISMATCH',
      'The durable aggregate replay batch cache no longer matches its checkpoint.',
      {
        expectedRows: count,
        actualRows: validation.rowCount,
        expectedSeries: Number(work.seriesCount || 0),
        actualSeries: validation.seriesCount,
        expectedFingerprint: text_(work.stageFingerprint),
        actualFingerprint: validation.stageFingerprint
      }
    );
    return records;
  }

  function stageSeries_(records) {
    var bySeries = {};
    (records || []).forEach(function (record) {
      var key = text_(record.aggregate_series_key);
      bySeries[key] = bySeries[key] || [];
      bySeries[key].push(record);
    });
    return {
      keys: Object.keys(bySeries).sort(),
      bySeries: bySeries
    };
  }

  function fitSeriesBatch_(targetRows, records, seriesCursor, limits) {
    var grouped = stageSeries_(records);
    var start = Math.max(0, Number(seriesCursor || 0));
    var remaining = grouped.keys.length - start;
    if (remaining <= 0) return { complete: true, seriesCount: 0, nextCursor: start, replacement: null, records: [] };
    var count = Math.min(AGGREGATE_SERIES_BATCH, remaining);
    while (count > 0) {
      var keys = grouped.keys.slice(start, start + count);
      var selected = [];
      keys.forEach(function (key) { selected = selected.concat(grouped.bySeries[key] || []); });
      AKORT.AggregateIntegration.Test.validateStageRows(selected, {
        operationId: selected[0].operation_id,
        loadId: selected[0].load_id,
        planId: selected[0].plan_id,
        planFingerprint: selected[0].plan_fingerprint
      });
      var replacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(targetRows, selected);
      if (replacement.replacementRowCount <= limits.maxRows &&
          replacement.cellCount <= limits.maxCells &&
          replacement.requestCount <= limits.maxRequests) {
        return {
          complete: false,
          seriesCount: count,
          nextCursor: start + count,
          totalSeries: grouped.keys.length,
          replacement: replacement,
          records: selected
        };
      }
      count = Math.floor(count / 2);
    }
    throw error_('ALPHA74_GATE5_ATOMIC_LIMIT_EXCEEDED', 'One logical aggregate series exceeds the Gate 5 atomic publication limit.', {
      seriesCursor: start,
      limits: limits
    });
  }

  function limits_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      maxRows: Math.max(1, Number(settings.PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS || 5000)),
      maxCells: Math.max(29, Number(settings.PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS || 100000)),
      maxRequests: Math.max(1, Number(settings.PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS || 500))
    };
  }

  function identityFor_(state, group, itemCursor) {
    var root = [state.executionId, group.loadId, state.replayStage, itemCursor].join('|');
    return {
      operationId: 'A74_GATE5_' + hash_(root).slice(0, 20).toUpperCase(),
      loadId: group.loadId,
      planId: 'A74_GATE5_PLAN_' + hash_(root + '|PLAN').slice(0, 20).toUpperCase(),
      planFingerprint: hash_(root + '|FINGERPRINT'),
      calculationId: 'A74_GATE5_CALC_' + hash_(root + '|CALC').slice(0, 20).toUpperCase()
    };
  }

  function metrics_(state) {
    var defaults = {
      workerExecutions: 0,
      steps: 0,
      fullBuildRowsProcessed: 0,
      fullBuildRowsScanned: 0,
      fullBuildRowsMaterialized: 0,
      fullBuildChunks: 0,
      fullBuildStagesPrepared: 0,
      replayPriceRowsWritten: 0,
      replayAggregateCombosProcessed: 0,
      replayAggregateRowsCalculated: 0,
      replayAggregateBatchesMaterialized: 0,
      replayAggregateCacheRowsWritten: 0,
      replayAggregatePublicationSteps: 0,
      replayAggregateSeriesPublished: 0,
      replayLatestRowsScanned: 0,
      replayLatestRowsUpdated: 0,
      replayLatestChunks: 0,
      atomicApiCalls: 0,
      atomicRequests: 0,
      maximumReplacementRows: 0,
      maximumReplacementCells: 0,
      maximumReplacementRequests: 0,
      quotaBackoffs: 0,
      transientRetries: 0,
      skippedOverlaps: 0,
      manualContinuationCalls: 0,
      totalWorkerDurationMs: 0,
      maximumWorkerDurationMs: 0
    };
    state.metrics = state.metrics || {};
    Object.keys(defaults).forEach(function (key) {
      if (state.metrics[key] === undefined || state.metrics[key] === null || state.metrics[key] === '') state.metrics[key] = defaults[key];
    });
    return state.metrics;
  }

  function assertAggregateReplayProgress_(state) {
    var metrics = metrics_(state);
    if (state.replayStage !== 'AGGREGATES' || Number(state.replayGroupIndex || 0) < 2) return true;
    assert_(
      Number(metrics.replayAggregateCombosProcessed || 0) === 0 ||
        Number(metrics.replayAggregateRowsCalculated || 0) > 0,
      'ALPHA74_GATE5_AGGREGATE_REPLAY_EMPTY',
      'Gate 5 processed aggregate replay combinations through the third load group without calculating any aggregate rows.',
      {
        groupIndex: Number(state.replayGroupIndex || 0),
        combosProcessed: Number(metrics.replayAggregateCombosProcessed || 0),
        rowsCalculated: Number(metrics.replayAggregateRowsCalculated || 0),
        canonicalIndexExpansionRequired: true
      }
    );
    return true;
  }

  function replayOnlyMetrics_(sourceState) {
    var source = metrics_(sourceState);
    var holder = { metrics: null };
    var recovered = metrics_(holder);
    [
      'fullBuildRowsProcessed',
      'fullBuildRowsScanned',
      'fullBuildRowsMaterialized',
      'fullBuildChunks',
      'fullBuildStagesPrepared'
    ].forEach(function (key) {
      recovered[key] = Number(source[key] || 0);
    });
    return recovered;
  }

  function buildReplayOnlyState_(sourceState, replayArtifact, executionId) {
    var artifacts = clone_(sourceState.artifacts || {});
    var supersededReplay = clone_(artifacts.sequentialReplay || null);
    artifacts.sequentialReplay = clone_(replayArtifact);
    var sourceMetrics = metrics_(sourceState);
    var startedAt = now_();
    return {
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      release: RELEASE,
      executionId: executionId,
      status: 'RUNNING',
      phase: 'PREPARE_REPLAY',
      startedAt: startedAt,
      updatedAt: startedAt,
      finishedAt: '',
      fullStageIndex: FULL_STAGES.length,
      fullBuildWork: null,
      replayGroupCount: 0,
      replayGroupIndex: 0,
      replayStage: REPLAY_STAGES[0],
      replayItemCursor: 0,
      aggregateSeriesCursor: 0,
      aggregateBatchWork: null,
      replayLatestWork: null,
      normalizeIndex: 0,
      digestIndex: 0,
      digestWork: null,
      digests: {},
      artifacts: artifacts,
      baselineExpected: clone_(sourceState.baselineExpected || {}),
      liveBefore: clone_(sourceState.liveBefore || {}),
      consecutiveErrors: 0,
      nextRetryAt: '',
      lastError: null,
      lastStep: null,
      evidence: null,
      failureCode: '',
      failureDetails: null,
      metrics: replayOnlyMetrics_(sourceState),
      recovery: {
        mode: 'REPLAY_ONLY_CANONICAL_INDEX_RECOVERY',
        recoveredFromExecutionId: text_(sourceState.executionId),
        recoveredFromRelease: text_(sourceState.release),
        recoveredFromStateSchemaVersion: text_(sourceState.stateSchemaVersion),
        recoveredAt: startedAt,
        preservedBaseline: true,
        preservedLiveSnapshot: true,
        preservedFullBuild: true,
        supersededReplay: supersededReplay,
        discardedReplayMetrics: {
          workerExecutions: Number(sourceMetrics.workerExecutions || 0),
          priceRowsWritten: Number(sourceMetrics.replayPriceRowsWritten || 0),
          aggregateRowsCalculated: Number(sourceMetrics.replayAggregateRowsCalculated || 0),
          aggregateSeriesPublished: Number(sourceMetrics.replayAggregateSeriesPublished || 0)
        }
      }
    };
  }

  function assertArtifactInTestFiles_(artifact, folderId, label) {
    assert_(artifact && text_(artifact.id), 'ALPHA74_GATE5_RECOVERY_ARTIFACT_MISSING', 'Gate 5 replay-only recovery is missing a preserved artifact.', {
      artifact: label
    });
    var file = DriveApp.getFileById(text_(artifact.id));
    var parents = file.getParents(), allowed = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === folderId) allowed = true;
    }
    assert_(allowed, 'ALPHA74_GATE5_RECOVERY_ARTIFACT_OUTSIDE_TEST_FILES', 'A preserved Gate 5 artifact is outside the canonical Test Files folder.', {
      artifact: label,
      spreadsheetId: text_(artifact.id)
    });
    var spreadsheet = SpreadsheetApp.openById(text_(artifact.id));
    var target = spreadsheet.getSheetByName(TARGET_SHEET);
    assert_(target, 'ALPHA74_GATE5_RECOVERY_TARGET_MISSING', 'A preserved Gate 5 artifact does not contain the aggregate target.', {
      artifact: label,
      spreadsheetId: text_(artifact.id)
    });
    var headers = target.getRange(1, 1, 1, target.getLastColumn()).getValues()[0].map(String);
    assert_(JSON.stringify(headers) === JSON.stringify(AKORT.AggregateContract.Headers.slice()), 'ALPHA74_GATE5_RECOVERY_SCHEMA_MISMATCH', 'A preserved Gate 5 artifact has an unexpected aggregate schema.', {
      artifact: label,
      spreadsheetId: text_(artifact.id)
    });
    return {
      spreadsheetId: text_(artifact.id),
      aggregateRows: Math.max(0, target.getLastRow() - 1)
    };
  }

  function assertReplayOnlyRecoverySource_(state, resources) {
    assert_(state, 'ALPHA74_GATE5_RECOVERY_STATE_MISSING', 'Gate 5 replay-only recovery requires the preserved stopped checkpoint.');
    assert_(state.status === 'STOPPED' && state.phase === 'STOPPED', 'ALPHA74_GATE5_RECOVERY_STATE_NOT_STOPPED', 'Gate 5 replay-only recovery requires a manually stopped checkpoint.', {
      status: state.status || '',
      phase: state.phase || ''
    });
    assert_(state.failureCode === 'STOPPED_MANUALLY', 'ALPHA74_GATE5_RECOVERY_STOP_REASON_INVALID', 'Gate 5 replay-only recovery is restricted to the manually stopped canonical-index incident.', {
      failureCode: state.failureCode || ''
    });
    assert_(
      ['4.0-alpha74-gate5-state-3', '4.0-alpha74-gate5-state-4', STATE_SCHEMA_VERSION].indexOf(text_(state.stateSchemaVersion)) >= 0,
      'ALPHA74_GATE5_RECOVERY_STATE_SCHEMA_INVALID',
      'Gate 5 replay-only recovery cannot reuse this checkpoint schema.',
      { stateSchemaVersion: state.stateSchemaVersion || '' }
    );
    assert_(
      ['4.0.0-alpha.7.4.4', '4.0.0-alpha.7.4.5', '4.0.0-alpha.7.4.6', RELEASE].indexOf(text_(state.release)) >= 0,
      'ALPHA74_GATE5_RECOVERY_RELEASE_INVALID',
      'Gate 5 replay-only recovery cannot reuse this release.',
      { release: state.release || '' }
    );
    var sourceMetrics = metrics_(state);
    assert_(
      Number(state.fullStageIndex || 0) >= FULL_STAGES.length &&
        !state.fullBuildWork &&
        Number(sourceMetrics.fullBuildStagesPrepared || 0) >= FULL_STAGES.length &&
        Number(sourceMetrics.fullBuildRowsMaterialized || 0) > 0,
      'ALPHA74_GATE5_RECOVERY_FULL_BUILD_INCOMPLETE',
      'Gate 5 replay-only recovery requires the completed preserved full build.',
      {
        fullStageIndex: Number(state.fullStageIndex || 0),
        fullBuildStagesPrepared: Number(sourceMetrics.fullBuildStagesPrepared || 0),
        fullBuildRowsMaterialized: Number(sourceMetrics.fullBuildRowsMaterialized || 0)
      }
    );
    assert_(
      Number(sourceMetrics.replayAggregateRowsCalculated || 0) === 0 &&
        Number(sourceMetrics.replayAggregateSeriesPublished || 0) === 0,
      'ALPHA74_GATE5_RECOVERY_INCIDENT_MISMATCH',
      'Gate 5 replay-only recovery is restricted to the zero-aggregate canonical-index incident.',
      {
        aggregateRowsCalculated: Number(sourceMetrics.replayAggregateRowsCalculated || 0),
        aggregateSeriesPublished: Number(sourceMetrics.replayAggregateSeriesPublished || 0)
      }
    );
    var inventories = {
      baselineCanonical: assertArtifactInTestFiles_(state.artifacts && state.artifacts.baselineCanonical, resources.testFilesFolderId, 'baselineCanonical'),
      liveSnapshot: assertArtifactInTestFiles_(state.artifacts && state.artifacts.liveSnapshot, resources.testFilesFolderId, 'liveSnapshot'),
      fullBuild: assertArtifactInTestFiles_(state.artifacts && state.artifacts.fullBuild, resources.testFilesFolderId, 'fullBuild')
    };
    assert_(inventories.fullBuild.aggregateRows > 0, 'ALPHA74_GATE5_RECOVERY_FULL_BUILD_EMPTY', 'The preserved full build contains no aggregate rows.', inventories.fullBuild);
    var live = AKORT.AggregateContract.inventory();
    assert_(
      Number(live.rows) === Number(state.liveBefore && state.liveBefore.rows || 0) &&
        text_(live.data_hash) === text_(state.liveBefore && state.liveBefore.dataHash),
      'ALPHA74_GATE5_RECOVERY_LIVE_CHANGED',
      'DEV Publish changed after the preserved Gate 5 snapshot, so replay-only recovery cannot reuse it.',
      {
        expectedRows: Number(state.liveBefore && state.liveBefore.rows || 0),
        actualRows: Number(live.rows || 0),
        expectedDataHash: text_(state.liveBefore && state.liveBefore.dataHash),
        actualDataHash: text_(live.data_hash)
      }
    );
    return inventories;
  }

  function buildDurableResumeState_(sourceState, executionId) {
    var state = clone_(sourceState || {});
    var resumedAt = now_();
    var sourceRecovery = clone_(state.recovery || {});
    var priorCanonicalRecovery = {
      mode: text_(sourceRecovery.mode),
      recoveredFromExecutionId: text_(sourceRecovery.recoveredFromExecutionId),
      recoveredFromRelease: text_(sourceRecovery.recoveredFromRelease),
      recoveredAt: text_(sourceRecovery.recoveredAt),
      supersededReplayId: text_(sourceRecovery.supersededReplay && sourceRecovery.supersededReplay.id)
    };
    var recovery = {
      mode: 'DURABLE_AGGREGATE_BATCH_RESUME',
      canonicalReplayRecovery: priorCanonicalRecovery,
      durableAggregateBatchResume: {
        resumedFromExecutionId: text_(sourceState && sourceState.executionId),
        resumedFromRelease: text_(sourceState && sourceState.release),
        resumedFromStateSchemaVersion: text_(sourceState && sourceState.stateSchemaVersion),
        resumedAt: resumedAt,
        preservedSequentialReplay: true,
        preservedGroupIndex: Number(sourceState && sourceState.replayGroupIndex || 0),
        preservedStage: text_(sourceState && sourceState.replayStage),
        preservedItemCursor: Number(sourceState && sourceState.replayItemCursor || 0),
        preservedAggregateSeriesCursor: Number(sourceState && sourceState.aggregateSeriesCursor || 0)
      }
    };
    state.stateSchemaVersion = STATE_SCHEMA_VERSION;
    state.release = RELEASE;
    state.executionId = executionId;
    state.status = 'RUNNING';
    state.phase = 'SEQUENTIAL_REPLAY';
    state.startedAt = resumedAt;
    state.updatedAt = resumedAt;
    state.finishedAt = '';
    state.nextRetryAt = '';
    state.consecutiveErrors = 0;
    state.lastError = null;
    state.lastStep = null;
    state.failureCode = '';
    state.failureDetails = null;
    state.evidence = null;
    state.aggregateBatchWork = null;
    state.aggregateSeriesCursor = 0;
    state.replayLatestWork = null;
    state.recovery = recovery;
    metrics_(state);
    return state;
  }

  function assertDurableResumeSource_(state, resources) {
    assert_(state, 'ALPHA74_GATE5_DURABLE_RESUME_STATE_MISSING', 'Gate 5 durable replay resume requires the preserved stopped checkpoint.');
    assert_(state.status === 'STOPPED' && state.phase === 'STOPPED', 'ALPHA74_GATE5_DURABLE_RESUME_STATE_NOT_STOPPED', 'Gate 5 durable replay resume requires a manually stopped checkpoint.', {
      status: state.status || '',
      phase: state.phase || ''
    });
    assert_(state.failureCode === 'STOPPED_MANUALLY', 'ALPHA74_GATE5_DURABLE_RESUME_STOP_REASON_INVALID', 'Gate 5 durable replay resume is restricted to a manually stopped checkpoint.', {
      failureCode: state.failureCode || ''
    });
    assert_(
      ['4.0-alpha74-gate5-state-4', STATE_SCHEMA_VERSION].indexOf(text_(state.stateSchemaVersion)) >= 0,
      'ALPHA74_GATE5_DURABLE_RESUME_STATE_SCHEMA_INVALID',
      'Gate 5 durable replay resume cannot reuse this checkpoint schema.',
      { stateSchemaVersion: state.stateSchemaVersion || '' }
    );
    assert_(
      ['4.0.0-alpha.7.4.6', RELEASE].indexOf(text_(state.release)) >= 0,
      'ALPHA74_GATE5_DURABLE_RESUME_RELEASE_INVALID',
      'Gate 5 durable replay resume cannot reuse this release.',
      { release: state.release || '' }
    );
    assert_(
      state.replayStage === 'AGGREGATES' &&
        Number(state.replayGroupCount || 0) > 0 &&
        Number(state.replayGroupIndex || 0) < Number(state.replayGroupCount || 0) &&
        Number(state.replayItemCursor || 0) >= 0 &&
        Number(state.aggregateSeriesCursor || 0) === 0 &&
        !state.aggregateBatchWork,
      'ALPHA74_GATE5_DURABLE_RESUME_BOUNDARY_INVALID',
      'Gate 5 durable replay resume requires a checkpoint between aggregate logical-series batches.',
      {
        groupCount: Number(state.replayGroupCount || 0),
        groupIndex: Number(state.replayGroupIndex || 0),
        replayStage: state.replayStage || '',
        replayItemCursor: Number(state.replayItemCursor || 0),
        aggregateSeriesCursor: Number(state.aggregateSeriesCursor || 0),
        aggregateBatchWork: !!state.aggregateBatchWork
      }
    );
    var sourceMetrics = metrics_(state);
    assert_(
      Number(state.fullStageIndex || 0) >= FULL_STAGES.length &&
        !state.fullBuildWork &&
        Number(sourceMetrics.fullBuildStagesPrepared || 0) >= FULL_STAGES.length &&
        Number(sourceMetrics.fullBuildRowsMaterialized || 0) > 0,
      'ALPHA74_GATE5_DURABLE_RESUME_FULL_BUILD_INCOMPLETE',
      'Gate 5 durable replay resume requires the completed preserved full build.'
    );
    var inventories = {
      baselineCanonical: assertArtifactInTestFiles_(state.artifacts && state.artifacts.baselineCanonical, resources.testFilesFolderId, 'baselineCanonical'),
      liveSnapshot: assertArtifactInTestFiles_(state.artifacts && state.artifacts.liveSnapshot, resources.testFilesFolderId, 'liveSnapshot'),
      fullBuild: assertArtifactInTestFiles_(state.artifacts && state.artifacts.fullBuild, resources.testFilesFolderId, 'fullBuild'),
      sequentialReplay: assertArtifactInTestFiles_(state.artifacts && state.artifacts.sequentialReplay, resources.testFilesFolderId, 'sequentialReplay')
    };
    assert_(inventories.fullBuild.aggregateRows > 0, 'ALPHA74_GATE5_DURABLE_RESUME_FULL_BUILD_EMPTY', 'The preserved full build contains no aggregate rows.', inventories.fullBuild);
    var live = AKORT.AggregateContract.inventory();
    assert_(
      Number(live.rows) === Number(state.liveBefore && state.liveBefore.rows || 0) &&
        text_(live.data_hash) === text_(state.liveBefore && state.liveBefore.dataHash),
      'ALPHA74_GATE5_DURABLE_RESUME_LIVE_CHANGED',
      'DEV Publish changed after the preserved Gate 5 snapshot, so durable replay resume cannot reuse it.',
      {
        expectedRows: Number(state.liveBefore && state.liveBefore.rows || 0),
        actualRows: Number(live.rows || 0),
        expectedDataHash: text_(state.liveBefore && state.liveBefore.dataHash),
        actualDataHash: text_(live.data_hash)
      }
    );
    var groups = readGroupRows_(state);
    assert_(groups.length === Number(state.replayGroupCount || 0), 'ALPHA74_GATE5_DURABLE_RESUME_GROUP_COUNT_MISMATCH', 'The preserved replay group inventory changed.', {
      expected: Number(state.replayGroupCount || 0),
      actual: groups.length
    });
    var group = groups[Number(state.replayGroupIndex || 0)];
    assert_(group && text_(group.loadId), 'ALPHA74_GATE5_DURABLE_RESUME_GROUP_MISSING', 'The preserved replay group checkpoint is missing.');
    var context = replayContext_(groups, Number(state.replayGroupIndex || 0));
    var items = AKORT.IncrementalPublish.Gate5.replayItems(
      state.artifacts.sequentialReplay.id,
      context.allowedLoadIds,
      context.reversedLoadIds,
      group,
      'AGGREGATES',
      readFrontier_(state)
    );
    assert_(Number(state.replayItemCursor || 0) <= items.length, 'ALPHA74_GATE5_DURABLE_RESUME_CURSOR_INVALID', 'The preserved aggregate replay cursor exceeds the current deterministic item inventory.', {
      cursor: Number(state.replayItemCursor || 0),
      total: items.length
    });
    return {
      groupIndex: Number(state.replayGroupIndex || 0),
      loadId: group.loadId,
      itemCursor: Number(state.replayItemCursor || 0),
      itemTotal: items.length,
      inventories: inventories
    };
  }

  function fullBuildStep_(state) {
    var stage = FULL_STAGES[Number(state.fullStageIndex || 0)];
    if (!stage) {
      state.phase = 'PREPARE_REPLAY';
      return { phase: 'FULL_BUILD', complete: true };
    }
    var result = AKORT.IncrementalPublish.Gate5.fullBuildChunk(
      state.artifacts.fullBuild.id,
      stage,
      state.fullBuildWork || null
    );
    state.fullBuildWork = result.work || null;
    var metrics = metrics_(state);
    metrics.fullBuildRowsProcessed += Number(result.rowsProcessed || 0);
    metrics.fullBuildRowsScanned += Number(result.rowsScanned || 0);
    metrics.fullBuildRowsMaterialized += Number(result.rowsMaterialized || 0);
    if (result.phase === 'PREPARE') metrics.fullBuildStagesPrepared += 1;
    else metrics.fullBuildChunks += 1;
    if (result.complete) {
      state.fullStageIndex = Number(state.fullStageIndex || 0) + 1;
      state.fullBuildWork = null;
      if (state.fullStageIndex >= FULL_STAGES.length) state.phase = 'PREPARE_REPLAY';
    }
    return result;
  }

  function prepareReplayStep_(state) {
    var groups = AKORT.IncrementalPublish.Gate5.replayGroups();
    var rawValidation = AKORT.IncrementalPublish.Gate5.validateReplayRaw(groups);
    assert_(rawValidation.every(function (result) { return result.status === 'PASS'; }), 'ALPHA74_GATE5_RAW_REPLAY_INVALID', 'Accepted load/reversal order does not reproduce current RAW latest state.', {
      validation: rawValidation
    });
    state.replayGroupCount = writeReplayGroups_(state, groups);
    state.rawReplayValidation = rawValidation;
    var frontier = writeFrontier_(state, AKORT.IncrementalPublish.Gate5.frontierKeys(state.artifacts.fullBuild.id));
    state.frontierCount = frontier.count;
    state.frontierHash = frontier.hash;
    state.replayGroupIndex = 0;
    state.replayStage = REPLAY_STAGES[0];
    state.replayItemCursor = 0;
    state.aggregateSeriesCursor = 0;
    state.aggregateBatchWork = null;
    state.replayLatestWork = null;
    state.phase = groups.length ? 'SEQUENTIAL_REPLAY' : 'FINALIZE_REPLAY';
    return {
      replayGroups: groups.length,
      rawReplayValidation: rawValidation,
      frontier: frontier
    };
  }

  function nextReplayStage_(state, group) {
    var index = REPLAY_STAGES.indexOf(state.replayStage);
    if (index < REPLAY_STAGES.length - 1) {
      state.replayStage = REPLAY_STAGES[index + 1];
      state.replayItemCursor = 0;
      state.aggregateSeriesCursor = 0;
      state.aggregateBatchWork = null;
      return { groupComplete: false, nextStage: state.replayStage };
    }
    assertAggregateReplayProgress_(state);
    updateGroupStatus_(state, group, 'SUCCESS');
    state.replayGroupIndex = Number(state.replayGroupIndex || 0) + 1;
    state.replayStage = REPLAY_STAGES[0];
    state.replayItemCursor = 0;
    state.aggregateSeriesCursor = 0;
    state.aggregateBatchWork = null;
    if (state.replayGroupIndex >= Number(state.replayGroupCount || 0)) state.phase = 'FINALIZE_REPLAY';
    return { groupComplete: true, nextGroupIndex: state.replayGroupIndex, nextPhase: state.phase };
  }

  function replayStep_(state) {
    var groups = readGroupRows_(state);
    assert_(groups.length === Number(state.replayGroupCount || 0), 'ALPHA74_GATE5_GROUP_COUNT_MISMATCH', 'Gate 5 replay group inventory changed.', {
      expected: state.replayGroupCount,
      actual: groups.length
    });
    var group = groups[Number(state.replayGroupIndex || 0)];
    if (!group) {
      state.phase = 'FINALIZE_REPLAY';
      return { complete: true, nextPhase: state.phase };
    }
    if (group.status === 'PENDING') updateGroupStatus_(state, group, 'RUNNING');
    var context = replayContext_(groups, Number(state.replayGroupIndex || 0));
    var frontier = state.replayStage === 'AGGREGATES' ? readFrontier_(state) : [];
    var items = AKORT.IncrementalPublish.Gate5.replayItems(
      state.artifacts.sequentialReplay.id,
      context.allowedLoadIds,
      context.reversedLoadIds,
      group,
      state.replayStage,
      frontier
    );
    var cursor = Math.max(0, Number(state.replayItemCursor || 0));
    if (cursor >= items.length) return nextReplayStage_(state, group);

    if (state.replayStage !== 'AGGREGATES') {
      var chunk = items.slice(cursor, cursor + PRICE_REPLAY_CHUNK_ITEMS);
      var result = AKORT.IncrementalPublish.Gate5.applyReplayChunk(
        state.artifacts.sequentialReplay.id,
        context.allowedLoadIds,
        context.reversedLoadIds,
        group,
        state.replayStage,
        chunk
      );
      state.replayItemCursor = cursor + chunk.length;
      metrics_(state).replayPriceRowsWritten += Number(result.rows || 0);
      return {
        groupIndex: state.replayGroupIndex,
        loadId: group.loadId,
        stage: state.replayStage,
        cursor: state.replayItemCursor,
        total: items.length,
        rows: Number(result.rows || 0)
      };
    }

    var aggregateMetrics = metrics_(state);
    var work = state.aggregateBatchWork || null;
    if (!work) {
      var combos = items.slice(cursor, cursor + AGGREGATE_COMBO_BATCH);
      var rows = AKORT.IncrementalPublish.Gate5.buildAggregateRows(
        state.artifacts.sequentialReplay.id,
        context.allowedLoadIds,
        context.reversedLoadIds,
        combos
      );
      var identity = identityFor_(state, group, cursor);
      var records = stageRecords_(rows, identity);
      aggregateMetrics.replayAggregateCombosProcessed += combos.length;
      aggregateMetrics.replayAggregateRowsCalculated += rows.length;
      aggregateMetrics.replayAggregateBatchesMaterialized += 1;
      if (!records.length) {
        state.replayItemCursor = cursor + combos.length;
        state.aggregateSeriesCursor = 0;
        return {
          groupIndex: state.replayGroupIndex,
          loadId: group.loadId,
          stage: state.replayStage,
          phase: 'MATERIALIZE_AGGREGATE_BATCH',
          comboCursor: state.replayItemCursor,
          comboTotal: items.length,
          calculatedRows: 0,
          complete: true
        };
      }
      var cached = writeAggregateBatchCache_(state, records, identity);
      aggregateMetrics.replayAggregateCacheRowsWritten += cached.recordCount;
      work = {
        workSchemaVersion: AGGREGATE_WORK_SCHEMA_VERSION,
        groupIndex: Number(state.replayGroupIndex || 0),
        loadId: group.loadId,
        comboCursor: cursor,
        comboCount: combos.length,
        comboTotal: items.length,
        recordCount: cached.recordCount,
        seriesCount: cached.seriesCount,
        stageFingerprint: cached.stageFingerprint,
        seriesCursor: 0,
        identity: identity
      };
      state.aggregateBatchWork = work;
      state.aggregateSeriesCursor = 0;
      return {
        groupIndex: state.replayGroupIndex,
        loadId: group.loadId,
        stage: state.replayStage,
        phase: 'MATERIALIZE_AGGREGATE_BATCH',
        comboCursor: cursor,
        comboCount: combos.length,
        comboTotal: items.length,
        calculatedRows: rows.length,
        cachedRows: cached.recordCount,
        cachedSeries: cached.seriesCount,
        complete: false
      };
    }

    assert_(
      work.workSchemaVersion === AGGREGATE_WORK_SCHEMA_VERSION &&
        Number(work.groupIndex) === Number(state.replayGroupIndex || 0) &&
        text_(work.loadId) === text_(group.loadId) &&
        Number(work.comboCursor) === cursor &&
        Number(work.comboTotal) === items.length,
      'ALPHA74_GATE5_AGGREGATE_WORK_MISMATCH',
      'The durable aggregate replay batch checkpoint does not match the current replay frontier.',
      {
        work: clone_(work),
        groupIndex: Number(state.replayGroupIndex || 0),
        loadId: group.loadId,
        comboCursor: cursor,
        comboTotal: items.length
      }
    );
    var cachedRecords = readAggregateBatchCache_(state, work);
    var targetRows = readAggregateRows_(state.artifacts.sequentialReplay.id);
    var batch = fitSeriesBatch_(targetRows, cachedRecords, work.seriesCursor, limits_());
    var replacement = batch.replacement;
    var write = { apiCalls: 0, requests: 0, noOp: true };
    if (replacement.beforeFingerprint !== replacement.afterFingerprint) {
      write = AKORT.AggregateIntegration.Gate4.atomicReplaceIsolated(
        SpreadsheetApp.openById(state.artifacts.sequentialReplay.id),
        replacement
      );
    }
    work.seriesCursor = batch.nextCursor;
    state.aggregateBatchWork = work;
    state.aggregateSeriesCursor = batch.nextCursor;
    if (batch.nextCursor >= batch.totalSeries) {
      state.replayItemCursor = Number(work.comboCursor || 0) + Number(work.comboCount || 0);
      state.aggregateSeriesCursor = 0;
      state.aggregateBatchWork = null;
    }
    aggregateMetrics.replayAggregatePublicationSteps += 1;
    aggregateMetrics.replayAggregateSeriesPublished += batch.seriesCount;
    aggregateMetrics.atomicApiCalls += Number(write.apiCalls || 0);
    aggregateMetrics.atomicRequests += Number(write.requests || 0);
    aggregateMetrics.maximumReplacementRows = Math.max(aggregateMetrics.maximumReplacementRows, Number(replacement.replacementRowCount || 0));
    aggregateMetrics.maximumReplacementCells = Math.max(aggregateMetrics.maximumReplacementCells, Number(replacement.cellCount || 0));
    aggregateMetrics.maximumReplacementRequests = Math.max(aggregateMetrics.maximumReplacementRequests, Number(replacement.requestCount || 0));
    return {
      groupIndex: state.replayGroupIndex,
      loadId: group.loadId,
      stage: state.replayStage,
      phase: 'PUBLISH_AGGREGATE_BATCH',
      comboCursor: state.replayItemCursor,
      comboTotal: items.length,
      seriesCursor: state.aggregateSeriesCursor,
      seriesTotal: batch.totalSeries,
      seriesPublished: batch.seriesCount,
      replacementRows: replacement.replacementRowCount,
      atomicApiCalls: Number(write.apiCalls || 0),
      lostResponseNoOp: replacement.beforeFingerprint === replacement.afterFingerprint
    };
  }

  function finalizeReplayStep_(state) {
    var result = AKORT.IncrementalPublish.Gate5.fullBuildChunk(
      state.artifacts.sequentialReplay.id,
      'AGGREGATES_LATEST',
      state.replayLatestWork || null
    );
    state.replayLatestWork = result.work || null;
    var metrics = metrics_(state);
    metrics.replayLatestRowsScanned += Number(result.rowsScanned || 0);
    metrics.replayLatestRowsUpdated += Number(result.rowsProcessed || 0);
    metrics.replayLatestChunks += result.phase === 'PREPARE' ? 0 : 1;
    if (result.complete) {
      state.replayLatestWork = null;
      state.phase = 'NORMALIZE';
      state.normalizeIndex = 0;
    }
    return {
      phase: 'FINALIZE_REPLAY_LATEST',
      latestPhase: result.phase || '',
      cursor: result.work ? Number(result.work.cursor || 0) : Number(result.total || 0),
      total: Number(result.total || 0),
      rowsScanned: Number(result.rowsScanned || 0),
      rowsUpdated: Number(result.rowsProcessed || 0),
      complete: result.complete === true,
      nextPhase: state.phase
    };
  }

  function normalizeStep_(state) {
    var target = NORMALIZE_TARGETS[Number(state.normalizeIndex || 0)];
    if (!target) {
      state.phase = 'DIGEST';
      state.digestIndex = 0;
      state.digestWork = null;
      return { complete: true, nextPhase: state.phase };
    }
    var rows = AKORT.IncrementalPublish.Gate5.canonicalSort(state.artifacts[target].id);
    state.normalizeIndex = Number(state.normalizeIndex || 0) + 1;
    return { target: target, rows: rows, nextIndex: state.normalizeIndex };
  }

  function canonicalCell_(value, header, row) {
    if (value === null || value === undefined || value === '') return 'N:';
    if (header === 'period_start') return 'D:' + periodKey_(row.frequency, value);
    if (header === 'period_label' &&
        (Object.prototype.toString.call(value) === '[object Date]' || (typeof value === 'number' && isFinite(value)))) {
      return 'S:' + periodKey_(row.frequency, value);
    }
    if (Object.prototype.toString.call(value) === '[object Date]') return 'D:' + value.toISOString();
    if (typeof value === 'number' && isFinite(value)) return 'F:' + String(value);
    if (typeof value === 'boolean') return 'B:' + (value ? '1' : '0');
    return 'S:' + JSON.stringify(String(value));
  }

  function persistDigestPart_(state, target, chunkNo, sha256) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var sheet = ensureAuxiliarySheet_(spreadsheet, DIGEST_SHEET, ['target', 'chunk_no', 'sha256']);
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
    for (var index = 0; index < rows.length; index += 1) {
      if (text_(rows[index][0]) === target && Number(rows[index][1]) === Number(chunkNo)) {
        assert_(text_(rows[index][2]) === sha256, 'ALPHA74_GATE5_DIGEST_PART_CHANGED', 'Gate 5 digest chunk changed after durable checkpoint.', {
          target: target,
          chunkNo: chunkNo,
          expected: text_(rows[index][2]),
          actual: sha256
        });
        return { recovered: true, row: index + 2 };
      }
    }
    sheet.appendRow([target, chunkNo, sha256]);
    return { recovered: false, row: sheet.getLastRow() };
  }

  function readDigestParts_(state, target) {
    var sheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id).getSheetByName(DIGEST_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().filter(function (row) {
      return text_(row[0]) === target;
    }).sort(function (left, right) {
      return Number(left[1]) - Number(right[1]);
    }).map(function (row, index) {
      assert_(Number(row[1]) === index, 'ALPHA74_GATE5_DIGEST_SEQUENCE_INVALID', 'Gate 5 digest chunks are not contiguous.', {
        target: target,
        expectedChunk: index,
        actualChunk: Number(row[1])
      });
      return text_(row[2]);
    });
  }

  function digestChunk_(state, target, spreadsheetId, work) {
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(TARGET_SHEET);
    var headers = AKORT.AggregateContract.Headers.slice();
    var rows = Math.max(0, sheet.getLastRow() - 1);
    var cursor = Math.max(0, Number(work.cursor || 0));
    if (cursor < rows) {
      var count = Math.min(DIGEST_CHUNK_ROWS, rows - cursor);
      var values = sheet.getRange(cursor + 2, 1, count, headers.length).getValues();
      var serialized = values.map(function (valuesRow) {
        var object = {};
        headers.forEach(function (header, index) { object[header] = valuesRow[index]; });
        return valuesRow.map(function (value, index) {
          return canonicalCell_(value, headers[index], object);
        }).join('\u001f');
      }).join('\u001e');
      var chunkNo = Math.floor(cursor / DIGEST_CHUNK_ROWS);
      var persisted = persistDigestPart_(state, target, chunkNo, hash_(serialized));
      return {
        complete: false,
        work: { cursor: cursor + count },
        progress: { rows: rows, cursor: cursor + count, chunks: chunkNo + 1, recovered: persisted.recovered }
      };
    }
    var parts = readDigestParts_(state, target);
    return {
      complete: true,
      digest: {
        rows: rows,
        columns: headers.length,
        hash: hash_(parts.join('|')),
        chunks: parts.length
      }
    };
  }

  function digestStep_(state) {
    var target = DIGEST_TARGETS[Number(state.digestIndex || 0)];
    if (!target) {
      state.phase = 'FINAL_RECONCILIATION';
      state.digestWork = null;
      return { complete: true, nextPhase: state.phase };
    }
    var result = digestChunk_(state, target, state.artifacts[target].id, state.digestWork || { cursor: 0 });
    if (!result.complete) {
      state.digestWork = result.work;
      return { target: target, progress: result.progress };
    }
    state.digests = state.digests || {};
    state.digests[target] = result.digest;
    state.digestIndex = Number(state.digestIndex || 0) + 1;
    state.digestWork = null;
    return { target: target, digest: result.digest, nextIndex: state.digestIndex };
  }

  function persistEvidenceIntent_(state, evidence) {
    var spreadsheet = SpreadsheetApp.openById(state.artifacts.sequentialReplay.id);
    var sheet = ensureAuxiliarySheet_(spreadsheet, EVIDENCE_INTENT_SHEET, ['sha256', 'payload_json']);
    if (sheet.getLastRow() > 1) {
      var existing = sheet.getRange(2, 1, 1, 2).getValues()[0];
      var payload = text_(existing[1]);
      assert_(text_(existing[0]) === hash_(payload), 'ALPHA74_GATE5_EVIDENCE_INTENT_CHANGED', 'Gate 5 evidence intent fingerprint mismatch.');
      return JSON.parse(payload);
    }
    var serialized = JSON.stringify(evidence);
    sheet.getRange(2, 1, 1, 2).setValues([[hash_(serialized), serialized]]);
    return evidence;
  }

  function saveEvidence_(resources, evidence, executionId) {
    var serialized = JSON.stringify(evidence, null, 2);
    var name = 'ALPHA74_GATE5_ACCEPTANCE_' + text_(executionId) + '.json';
    var folder = DriveApp.getFolderById(resources.testResultsFolderId);
    var matches = folder.getFilesByName(name), files = [];
    while (matches.hasNext()) files.push(matches.next());
    assert_(files.length <= 1, 'ALPHA74_GATE5_EVIDENCE_DUPLICATE', 'More than one Gate 5 evidence file has the deterministic execution name.', {
      name: name,
      count: files.length
    });
    var file;
    if (files.length) {
      file = files[0];
      var existing = file.getBlob().getDataAsString('UTF-8');
      assert_(hash_(existing) === hash_(serialized), 'ALPHA74_GATE5_EVIDENCE_CHANGED', 'Existing Gate 5 evidence differs from the persisted intent.', {
        name: name,
        existingHash: hash_(existing),
        expectedHash: hash_(serialized)
      });
    } else {
      file = folder.createFile(name, serialized, MimeType.PLAIN_TEXT);
    }
    return {
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      sha256: hash_(serialized),
      bytes: Utilities.newBlob(serialized).getBytes().length
    };
  }

  function finalReconciliationStep_(state) {
    var baseline = state.digests.baselineCanonical;
    var liveSnapshot = state.digests.liveSnapshot;
    var full = state.digests.fullBuild;
    var replay = state.digests.sequentialReplay;
    var exact = [liveSnapshot, full, replay].every(function (digest) {
      return digest && baseline && digest.rows === baseline.rows && digest.columns === baseline.columns && digest.hash === baseline.hash;
    });
    var liveAfter = AKORT.AggregateContract.inventory();
    var liveUnchanged = Number(liveAfter.rows) === Number(state.liveBefore.rows) &&
      text_(liveAfter.data_hash) === text_(state.liveBefore.dataHash);
    var limits = limits_();
    var metrics = metrics_(state);
    var quotaAccepted = metrics.maximumReplacementRows <= limits.maxRows &&
      metrics.maximumReplacementCells <= limits.maxCells &&
      metrics.maximumReplacementRequests <= limits.maxRequests &&
      metrics.workerExecutions > 0 &&
      metrics.manualContinuationCalls === 0;
    var aggregateAccepted = metrics.replayAggregateCombosProcessed > 0 &&
      metrics.replayAggregateRowsCalculated > 0 &&
      metrics.replayAggregateSeriesPublished > 0 &&
      metrics.atomicApiCalls > 0;
    var rawAccepted = (state.rawReplayValidation || []).length > 0 &&
      (state.rawReplayValidation || []).every(function (result) { return result.status === 'PASS'; });
    var success = exact && liveUnchanged && quotaAccepted && aggregateAccepted && rawAccepted;
    state.evidenceCompletedAt = state.evidenceCompletedAt || now_();
    var evidence = {
      evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
      release: RELEASE,
      executionId: state.executionId,
      status: success ? 'SUCCESS' : 'FAILED',
      completedAt: state.evidenceCompletedAt,
      mode: 'ISOLATED_FULL_BUILD_AND_SEQUENTIAL_REPLAY',
      featureFlags: flagState_(),
      artifacts: clone_(state.artifacts),
      recovery: clone_(state.recovery || null),
      replayGroups: Number(state.replayGroupCount || 0),
      rawReplayValidation: clone_(state.rawReplayValidation || []),
      frontier: { count: Number(state.frontierCount || 0), hash: text_(state.frontierHash) },
      digests: clone_(state.digests || {}),
      exactBaselineFullReplayLiveSnapshot: exact,
      livePublishUnchanged: liveUnchanged,
      livePublishBefore: clone_(state.liveBefore),
      livePublishAfter: {
        rows: liveAfter.rows,
        dataHash: liveAfter.data_hash,
        fingerprint: liveAfter.fingerprint
      },
      quotaAcceptance: {
        accepted: quotaAccepted,
        limits: limits,
        metrics: clone_(metrics)
      },
      aggregateReplayAcceptance: {
        accepted: aggregateAccepted,
        combosProcessed: Number(metrics.replayAggregateCombosProcessed || 0),
        rowsCalculated: Number(metrics.replayAggregateRowsCalculated || 0),
        seriesPublished: Number(metrics.replayAggregateSeriesPublished || 0),
        atomicApiCalls: Number(metrics.atomicApiCalls || 0)
      },
      noManualContinuation: metrics.manualContinuationCalls === 0,
      regularPipelineEnabled: flagState_().regularPipelineEnabled,
      livePublishPhysicalWrites: 0
    };
    evidence = persistEvidenceIntent_(state, evidence);
    var saved = saveEvidence_(resources_(), evidence, state.executionId);
    state.evidence = saved;
    state.status = success ? 'SUCCESS' : 'FAILED';
    state.phase = state.status;
    state.finishedAt = now_();
    state.failureCode = success ? '' : 'ALPHA74_GATE5_RECONCILIATION_FAILED';
    state.failureDetails = success ? null : {
      exact: exact,
      liveUnchanged: liveUnchanged,
      quotaAccepted: quotaAccepted,
      aggregateAccepted: aggregateAccepted,
      rawAccepted: rawAccepted
    };
    state.triggerCountRemoved = deleteTriggers_();
    return {
      status: state.status,
      exact: exact,
      livePublishUnchanged: liveUnchanged,
      quotaAccepted: quotaAccepted,
      aggregateAccepted: aggregateAccepted,
      rawAccepted: rawAccepted,
      evidence: saved
    };
  }

  function step_(state) {
    if (state.phase === 'FULL_BUILD') return fullBuildStep_(state);
    if (state.phase === 'PREPARE_REPLAY') return prepareReplayStep_(state);
    if (state.phase === 'SEQUENTIAL_REPLAY') return replayStep_(state);
    if (state.phase === 'FINALIZE_REPLAY') return finalizeReplayStep_(state);
    if (state.phase === 'NORMALIZE') return normalizeStep_(state);
    if (state.phase === 'DIGEST') return digestStep_(state);
    if (state.phase === 'FINAL_RECONCILIATION') return finalReconciliationStep_(state);
    if (state.status === 'SUCCESS' || state.status === 'FAILED' || state.status === 'STOPPED') return { terminal: true, status: state.status };
    throw error_('ALPHA74_GATE5_PHASE_INVALID', 'Gate 5 checkpoint has an unsupported phase.', { phase: state.phase });
  }

  function classifyError_(caught) {
    var message = text_(caught && caught.message || caught);
    var code = text_(caught && caught.code || 'ALPHA74_GATE5_WORKER_FAILED');
    var lower = message.toLowerCase();
    if (/quota|too many times|service using too much computer time|limit exceeded/.test(lower)) return { kind: 'QUOTA', code: code, message: message, retryable: true, delayMs: 1800000 };
    if (/service error|internal error|backend error|temporar|try again|exceeded maximum execution time/.test(lower)) return { kind: 'TRANSIENT', code: code, message: message, retryable: true, delayMs: 300000 };
    return { kind: 'FATAL', code: code, message: message, retryable: false, delayMs: 0 };
  }

  function publicState_(state) {
    if (!state) return null;
    return {
      stateSchemaVersion: state.stateSchemaVersion,
      release: state.release,
      executionId: state.executionId,
      status: state.status,
      phase: state.phase,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      finishedAt: state.finishedAt || '',
      nextRetryAt: state.nextRetryAt || '',
      fullStage: FULL_STAGES[Number(state.fullStageIndex || 0)] || '',
      fullBuild: state.fullBuildWork ? {
        workSchemaVersion: state.fullBuildWork.workSchemaVersion || '',
        stage: state.fullBuildWork.stage || '',
        phase: state.fullBuildWork.phase || '',
        cursor: Number(state.fullBuildWork.cursor || 0),
        total: Number(state.fullBuildWork.total || 0),
        chunkRows: Number(state.fullBuildWork.chunkRows || 0),
        startRow: Number(state.fullBuildWork.startRow || 0),
        materializedSheetName: state.fullBuildWork.materializedSheetName || '',
        materializedRows: Number(state.fullBuildWork.materializedRows || 0)
      } : null,
      replay: {
        groupCount: Number(state.replayGroupCount || 0),
        groupIndex: Number(state.replayGroupIndex || 0),
        stage: state.replayStage || '',
        itemCursor: Number(state.replayItemCursor || 0),
        aggregateSeriesCursor: Number(state.aggregateSeriesCursor || 0)
      },
      aggregateBatch: state.aggregateBatchWork ? {
        workSchemaVersion: state.aggregateBatchWork.workSchemaVersion || '',
        groupIndex: Number(state.aggregateBatchWork.groupIndex || 0),
        loadId: state.aggregateBatchWork.loadId || '',
        comboCursor: Number(state.aggregateBatchWork.comboCursor || 0),
        comboCount: Number(state.aggregateBatchWork.comboCount || 0),
        comboTotal: Number(state.aggregateBatchWork.comboTotal || 0),
        recordCount: Number(state.aggregateBatchWork.recordCount || 0),
        seriesCursor: Number(state.aggregateBatchWork.seriesCursor || 0),
        seriesCount: Number(state.aggregateBatchWork.seriesCount || 0)
      } : null,
      replayLatest: state.replayLatestWork ? {
        workSchemaVersion: state.replayLatestWork.workSchemaVersion || '',
        phase: state.replayLatestWork.phase || '',
        cursor: Number(state.replayLatestWork.cursor || 0),
        total: Number(state.replayLatestWork.total || 0),
        chunkRows: Number(state.replayLatestWork.chunkRows || 0)
      } : null,
      metrics: clone_(metrics_(state)),
      artifacts: clone_(state.artifacts || {}),
      digests: clone_(state.digests || {}),
      evidence: clone_(state.evidence || null),
      recovery: clone_(state.recovery || null),
      failureCode: state.failureCode || '',
      failureDetails: clone_(state.failureDetails || null),
      lastError: clone_(state.lastError || null),
      lastStep: clone_(state.lastStep || null),
      stopRequested: stopRequested_(),
      triggerCount: triggers_().length
    };
  }

  function status() {
    return AKORT.Core.safeRun('ALPHA74_GATE5_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var resources = resources_(), flags = flagState_(), state = loadState_();
      return AKORT.Result.success('Alpha.7.4 Gate 5 status loaded.', {
        release: RELEASE,
        version: VERSION,
        evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
        ready: flags.executionEnabled && !flags.regularPipelineEnabled,
        executionEnabled: flags.executionEnabled,
        regularPipelineEnabled: flags.regularPipelineEnabled,
        livePublishTargetProtected: true,
        baselineConfigured: !!resources.baselineSpreadsheetId,
        testFilesConfigured: !!resources.testFilesFolderId,
        testResultsConfigured: !!resources.testResultsFolderId,
        triggerHandler: TRIGGER_HANDLER,
        triggerMode: 'PERSISTENT_EVERY_MINUTE',
        noManualContinuation: true,
        stopRequested: stopRequested_(),
        state: publicState_(state),
        physicalWrites: false
      });
    }, { lock: false, persistLogs: false });
  }

  function start() {
    return AKORT.Core.safeRun('ALPHA74_GATE5_START', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertFlags_();
      clearStopRequest_();
      var existing = loadState_();
      if (existing && existing.status === 'RUNNING' &&
          (existing.stateSchemaVersion !== STATE_SCHEMA_VERSION || existing.release !== RELEASE)) {
        var removedLegacyTriggers = deleteTriggers_();
        existing.status = 'STOPPED';
        existing.phase = 'STOPPED';
        existing.finishedAt = now_();
        existing.failureCode = 'ALPHA74_GATE5_STATE_VERSION_MISMATCH';
        existing.failureDetails = {
          expectedStateSchemaVersion: STATE_SCHEMA_VERSION,
          actualStateSchemaVersion: existing.stateSchemaVersion || '',
          expectedRelease: RELEASE,
          actualRelease: existing.release || '',
          triggersRemoved: removedLegacyTriggers,
          artifactsPreserved: true
        };
        saveState_(existing);
        return AKORT.Result.failure(
          'ALPHA74_GATE5_STATE_VERSION_MISMATCH',
          'An incompatible Gate 5 checkpoint was stopped fail-closed. Run Gate 5 Start again to create a fresh execution.',
          publicState_(existing)
        );
      }
      if (existing && existing.status === 'RUNNING') {
        ensureTrigger_();
        return AKORT.Result.success('Alpha.7.4 Gate 5 is already running; the persistent worker remains enabled.', publicState_(existing));
      }
      deleteTriggers_();
      var resources = resources_(), stamp = timestamp_(), executionId = 'A74_GATE5_' + hash_([stamp, Utilities.getUuid()]).slice(0, 20).toUpperCase();
      var baselineInventory = AKORT.AggregateContract.baselineInventory();
      var liveInventory = AKORT.AggregateContract.inventory();
      var artifacts = {
        baselineCanonical: copyBook_(resources.baselineSpreadsheetId, 'AKORT_ALPHA74_GATE5_BASELINE_' + stamp, resources.testFilesFolderId),
        liveSnapshot: copyBook_(resources.publishSpreadsheetId, 'AKORT_ALPHA74_GATE5_LIVE_SNAPSHOT_' + stamp, resources.testFilesFolderId),
        fullBuild: createBook_('AKORT_ALPHA74_GATE5_FULL_' + stamp, resources.testFilesFolderId),
        sequentialReplay: createBook_('AKORT_ALPHA74_GATE5_REPLAY_' + stamp, resources.testFilesFolderId)
      };
      var state = {
        stateSchemaVersion: STATE_SCHEMA_VERSION,
        release: RELEASE,
        executionId: executionId,
        status: 'RUNNING',
        phase: 'FULL_BUILD',
        startedAt: now_(),
        updatedAt: now_(),
        fullStageIndex: 0,
        fullBuildWork: null,
        replayGroupCount: 0,
        replayGroupIndex: 0,
        replayStage: REPLAY_STAGES[0],
        replayItemCursor: 0,
        aggregateSeriesCursor: 0,
        aggregateBatchWork: null,
        replayLatestWork: null,
        normalizeIndex: 0,
        digestIndex: 0,
        digestWork: null,
        digests: {},
        artifacts: artifacts,
        baselineExpected: {
          rows: baselineInventory.rows,
          dataHash: baselineInventory.data_hash,
          fingerprint: baselineInventory.fingerprint
        },
        liveBefore: {
          rows: liveInventory.rows,
          dataHash: liveInventory.data_hash,
          fingerprint: liveInventory.fingerprint
        },
        consecutiveErrors: 0,
        nextRetryAt: '',
        lastError: null,
        lastStep: null,
        metrics: null
      };
      metrics_(state);
      saveState_(state);
      state.triggerCount = ensureTrigger_();
      saveState_(state);
      return AKORT.Result.success('Alpha.7.4 Gate 5 started. Persistent worker will continue without manual continuation.', publicState_(state));
    }, { lock: true, persistLogs: true });
  }

  function restartReplay() {
    return AKORT.Core.safeRun('ALPHA74_GATE5_RESTART_REPLAY', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertFlags_();
      var sourceState = loadState_();
      var resources = resources_();
      assertReplayOnlyRecoverySource_(sourceState, resources);
      deleteTriggers_();
      clearStopRequest_();
      var stamp = timestamp_();
      var executionId = 'A74_GATE5_' + hash_(['REPLAY_RECOVERY', stamp, Utilities.getUuid()]).slice(0, 20).toUpperCase();
      var replayArtifact = createBook_(
        'AKORT_ALPHA74_GATE5_REPLAY_RECOVERY_' + stamp,
        resources.testFilesFolderId
      );
      var state = buildReplayOnlyState_(sourceState, replayArtifact, executionId);
      saveState_(state);
      state.triggerCount = ensureTrigger_();
      saveState_(state);
      return AKORT.Result.success(
        'Alpha.7.4 Gate 5 replay-only recovery started. Preserved baseline, live snapshot and full build were reused.',
        publicState_(state)
      );
    }, { lock: true, persistLogs: true });
  }

  function resumeReplay() {
    return AKORT.Core.safeRun('ALPHA74_GATE5_RESUME_REPLAY', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertFlags_();
      var sourceState = loadState_();
      var resources = resources_();
      var resumeBoundary = assertDurableResumeSource_(sourceState, resources);
      deleteTriggers_();
      clearStopRequest_();
      var stamp = timestamp_();
      var executionId = 'A74_GATE5_' + hash_(['DURABLE_AGGREGATE_RESUME', stamp, Utilities.getUuid()]).slice(0, 20).toUpperCase();
      var state = buildDurableResumeState_(sourceState, executionId);
      saveState_(state);
      state.triggerCount = ensureTrigger_();
      saveState_(state);
      return AKORT.Result.success(
        'Alpha.7.4 Gate 5 durable aggregate replay resumed from the preserved logical-series boundary.',
        {
          resumeBoundary: resumeBoundary,
          state: publicState_(state)
        }
      );
    }, { lock: true, persistLogs: true });
  }

  function worker() {
    var lock = LockService.getUserLock();
    if (!lock.tryLock(1000)) {
      return AKORT.Result.success('Another Gate 5 worker is active; this trigger tick was skipped.', {
        skipped: true,
        reason: 'WORKER_OVERLAP',
        checkpointWrite: false
      });
    }
    var startedMs = Date.now(), state = null;
    try {
      state = loadState_();
      if (stopRequested_()) {
        var removedForStop = deleteTriggers_();
        if (state && state.status === 'RUNNING') {
          markStopped_(state);
          state.failureDetails.triggersRemoved = removedForStop;
          saveState_(state);
        }
        return AKORT.Result.success('Gate 5 worker acknowledged the durable manual stop request.', publicState_(state));
      }
      if (!state || state.status !== 'RUNNING') {
        deleteTriggers_();
        return AKORT.Result.success('Gate 5 worker found no active run.', publicState_(state));
      }
      if (state.stateSchemaVersion !== STATE_SCHEMA_VERSION || state.release !== RELEASE) {
        deleteTriggers_();
        state.status = 'STOPPED';
        state.phase = 'STOPPED';
        state.finishedAt = now_();
        state.failureCode = 'ALPHA74_GATE5_STATE_VERSION_MISMATCH';
        state.failureDetails = {
          expectedStateSchemaVersion: STATE_SCHEMA_VERSION,
          actualStateSchemaVersion: state.stateSchemaVersion || '',
          expectedRelease: RELEASE,
          actualRelease: state.release || '',
          artifactsPreserved: true
        };
        saveState_(state);
        return AKORT.Result.failure(
          'ALPHA74_GATE5_STATE_VERSION_MISMATCH',
          'Gate 5 worker stopped an incompatible checkpoint fail-closed.',
          publicState_(state)
        );
      }
      if (state.nextRetryAt && Date.parse(state.nextRetryAt) > Date.now()) {
        return AKORT.Result.success('Gate 5 worker is waiting for the automatic retry window.', publicState_(state));
      }
      AKORT.EnvironmentGuard.assertDev();
      assertFlags_();
      ensureTrigger_();
      var metrics = metrics_(state);
      metrics.workerExecutions += 1;
      state.lastWorkerStartedAt = now_();
      state.nextRetryAt = '';
      saveState_(state);
      var steps = 0;
      while (state.status === 'RUNNING' &&
             Date.now() - startedMs < WORKER_BUDGET_MS &&
             steps < WORKER_MAX_STEPS) {
        state.lastStep = step_(state);
        metrics.steps += 1;
        steps += 1;
        state.consecutiveErrors = 0;
        state.lastError = null;
        if (stopRequested_()) {
          markStopped_(state);
          deleteTriggers_();
        }
        saveState_(state);
      }
      var duration = Date.now() - startedMs;
      metrics.totalWorkerDurationMs += duration;
      metrics.maximumWorkerDurationMs = Math.max(metrics.maximumWorkerDurationMs, duration);
      state.lastWorkerFinishedAt = now_();
      saveState_(state);
      if (state.status === 'FAILED') {
        return AKORT.Result.failure(
          state.failureCode || 'ALPHA74_GATE5_RECONCILIATION_FAILED',
          'Alpha.7.4 Gate 5 reconciliation failed; isolated evidence and artifacts were preserved.',
          publicState_(state)
        );
      }
      return AKORT.Result.success(
        state.status === 'SUCCESS'
          ? 'Alpha.7.4 Gate 5 acceptance passed.'
          : state.status === 'STOPPED'
            ? 'Alpha.7.4 Gate 5 worker stopped at a durable checkpoint.'
            : 'Alpha.7.4 Gate 5 worker committed bounded progress.',
        publicState_(state)
      );
    } catch (caught) {
      if (!state) state = loadState_();
      if (!state) throw caught;
      if (stopRequested_()) {
        markStopped_(state);
        deleteTriggers_();
        saveState_(state);
        return AKORT.Result.success('Gate 5 worker stopped after acknowledging the durable manual stop request.', publicState_(state));
      }
      var info = classifyError_(caught);
      state.consecutiveErrors = Number(state.consecutiveErrors || 0) + 1;
      state.lastError = {
        code: info.code,
        message: info.message,
        kind: info.kind,
        at: now_()
      };
      var metricsOnError = metrics_(state);
      if (info.kind === 'QUOTA') metricsOnError.quotaBackoffs += 1;
      if (info.kind === 'TRANSIENT') metricsOnError.transientRetries += 1;
      if (info.retryable && state.consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
        state.nextRetryAt = new Date(Date.now() + info.delayMs).toISOString();
        saveState_(state);
        return AKORT.Result.failure(info.code, 'Gate 5 worker scheduled an automatic retry.', publicState_(state));
      }
      state.status = 'FAILED';
      state.phase = 'FAILED';
      state.finishedAt = now_();
      state.failureCode = info.code;
      state.failureDetails = { message: info.message, kind: info.kind };
      deleteTriggers_();
      saveState_(state);
      return AKORT.Result.failure(info.code, 'Gate 5 stopped after a non-retryable or repeated failure.', publicState_(state));
    } finally {
      try { lock.releaseLock(); } catch (ignored) {}
    }
  }

  function stop() {
    requestStop_();
    return AKORT.Core.safeRun('ALPHA74_GATE5_STOP', function () {
      AKORT.EnvironmentGuard.assertDev();
      var state = loadState_(), removed = deleteTriggers_();
      if (state && state.status === 'RUNNING') saveState_(markStopped_(state));
      return AKORT.Result.success('Alpha.7.4 Gate 5 stopped. Isolated artifacts were preserved.', {
        triggersRemoved: removed,
        stopRequested: true,
        state: publicState_(state)
      });
    }, { lock: true, persistLogs: true });
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    EvidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    StateSchemaVersion: STATE_SCHEMA_VERSION,
    FullStages: FULL_STAGES.slice(),
    ReplayStages: REPLAY_STAGES.slice(),
    status: status,
    start: start,
    restartReplay: restartReplay,
    resumeReplay: resumeReplay,
    worker: worker,
    stop: stop,
    Test: Object.freeze({
      clone: clone_,
      stable: stable_,
      hash: hash_,
      stageRecords: stageRecords_,
      stageSeries: stageSeries_,
      fitSeriesBatch: fitSeriesBatch_,
      replayContext: replayContext_,
      canonicalCell: canonicalCell_,
      classifyError: classifyError_,
      fullBuildStep: fullBuildStep_,
      finalizeReplayStep: finalizeReplayStep_,
      metrics: metrics_,
      assertAggregateReplayProgress: assertAggregateReplayProgress_,
      buildReplayOnlyState: buildReplayOnlyState_,
      buildDurableResumeState: buildDurableResumeState_
    })
  });
})();
