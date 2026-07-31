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
  var VERSION = '4.0-alpha74-gate5-acceptance-13';
  var RELEASE = '4.0.0-alpha.7.4.15';
  var EVIDENCE_SCHEMA_VERSION = '4.0-alpha74-gate5-evidence-13';
  var STATE_SCHEMA_VERSION = '4.0-alpha74-gate5-state-13';
  var STATE_KEY = 'AKORT_ALPHA74_GATE5_STATE_V1';
  var STOP_REQUEST_KEY = 'AKORT_ALPHA74_GATE5_STOP_REQUEST_V1';
  var AGGREGATE_WORK_SCHEMA_VERSION = '4.0-alpha74-gate5-aggregate-work-1';
  var AGGREGATE_ITEM_WORK_SCHEMA_VERSION = '4.0-alpha74-gate5-aggregate-items-work-1';
  var TRIGGER_HANDLER = 'AKORT_alpha74Gate5Worker';
  var TRIGGER_MINUTES = 1;
  var PROPERTY_MAX_BYTES = 8500;
  var WORKER_BUDGET_MS = 120000;
  var WORKER_MAX_STEPS = 12;
  var DIGEST_CHUNK_ROWS = 1000;
  var PRICE_REPLAY_CHUNK_ITEMS = 2;
  var AGGREGATE_COMBO_BATCH = 25;
  var LEGACY_AGGREGATE_SERIES_BATCH = 32;
  var AGGREGATE_SERIES_WINDOW = 128;
  var AGGREGATE_IDENTITY_COLUMNS = Object.freeze([
    { header: 'dataset_code', column: 1 },
    { header: 'frequency', column: 3 },
    { header: 'aggregate_level', column: 4 },
    { header: 'aggregate_name', column: 6 },
    { header: 'category_id', column: 7 },
    { header: 'product_group', column: 8 },
    { header: 'value_type', column: 10 },
    { header: 'index_type', column: 11 },
    { header: 'weight_source', column: 24 }
  ]);
  var MAX_CONSECUTIVE_ERRORS = 6;
  var TARGET_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var GROUP_SHEET = 'GATE5_REPLAY_GROUPS';
  var FRONTIER_SHEET = 'GATE5_FRONTIER';
  var AGGREGATE_CACHE_SHEET = 'GATE5_AGGREGATE_BATCH_STAGE';
  var AGGREGATE_ITEM_CACHE_SHEET = 'GATE5_AGGREGATE_ITEMS';
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
  var DURABLE_RESUME_STATE_SCHEMAS = Object.freeze([
    '4.0-alpha74-gate5-state-4',
    '4.0-alpha74-gate5-state-5',
    '4.0-alpha74-gate5-state-6',
    '4.0-alpha74-gate5-state-7',
    '4.0-alpha74-gate5-state-8',
    '4.0-alpha74-gate5-state-9',
    '4.0-alpha74-gate5-state-10',
    '4.0-alpha74-gate5-state-11',
    '4.0-alpha74-gate5-state-12',
    STATE_SCHEMA_VERSION
  ]);
  var DURABLE_RESUME_RELEASES = Object.freeze([
    '4.0.0-alpha.7.4.6',
    '4.0.0-alpha.7.4.7',
    '4.0.0-alpha.7.4.8',
    '4.0.0-alpha.7.4.9',
    '4.0.0-alpha.7.4.10',
    '4.0.0-alpha.7.4.11',
    '4.0.0-alpha.7.4.12',
    '4.0.0-alpha.7.4.13',
    '4.0.0-alpha.7.4.14',
    RELEASE
  ]);

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

  function a1Column_(column) {
    var value = Math.max(1, Number(column || 1)), out = '';
    while (value > 0) {
      var remainder = (value - 1) % 26;
      out = String.fromCharCode(65 + remainder) + out;
      value = Math.floor((value - 1) / 26);
    }
    return out;
  }

  function quotedSheetName_(name) {
    return "'" + String(name || '').replace(/'/g, "''") + "'";
  }

  function rowBlocks_(rowNumbers) {
    var rows = (rowNumbers || []).map(Number).filter(function (row) {
      return isFinite(row) && row > 1;
    }).sort(function (a, b) { return a - b; });
    var unique = [], blocks = [];
    rows.forEach(function (row) {
      if (!unique.length || unique[unique.length - 1] !== row) unique.push(row);
    });
    if (!unique.length) return blocks;
    var start = unique[0], previous = unique[0];
    for (var index = 1; index < unique.length; index += 1) {
      if (unique[index] === previous + 1) {
        previous = unique[index];
        continue;
      }
      blocks.push({ start: start, end: previous, count: previous - start + 1 });
      start = unique[index];
      previous = unique[index];
    }
    blocks.push({ start: start, end: previous, count: previous - start + 1 });
    return blocks;
  }

  function batchGetValues_(spreadsheetId, ranges) {
    assert_(
      typeof Sheets !== 'undefined' &&
        Sheets.Spreadsheets &&
        Sheets.Spreadsheets.Values &&
        typeof Sheets.Spreadsheets.Values.batchGet === 'function',
      'ALPHA74_GATE5_SHEETS_BATCH_GET_UNAVAILABLE',
      'Gate 5 fast replay requires the Advanced Google Sheets batchGet service.'
    );
    if (!(ranges || []).length) return [];
    var response = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
      ranges: ranges,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    }) || {};
    var valueRanges = response.valueRanges || [];
    assert_(
      valueRanges.length === ranges.length,
      'ALPHA74_GATE5_BATCH_GET_RANGE_COUNT_MISMATCH',
      'Gate 5 fast replay did not receive every requested target range.',
      { expectedRanges: ranges.length, actualRanges: valueRanges.length }
    );
    return valueRanges.map(function (range) { return range.values || []; });
  }

  function candidateStageRecords_(records, seriesCursor) {
    var grouped = stageSeries_(records);
    var keys = grouped.keys.slice(
      Math.max(0, Number(seriesCursor || 0)),
      Math.max(0, Number(seriesCursor || 0)) + AGGREGATE_SERIES_WINDOW
    );
    var selected = [];
    keys.forEach(function (key) { selected = selected.concat(grouped.bySeries[key] || []); });
    return selected;
  }

  function stageSignatureMap_(records) {
    var signatures = {};
    (records || []).forEach(function (record) {
      var payload;
      try {
        payload = JSON.parse(String(record.row_payload_json || '{}'));
      } catch (caught) {
        throw error_('ALPHA74_GATE5_STAGE_PAYLOAD_INVALID', 'Gate 5 fast replay cannot parse a staged aggregate payload.', {
          rowKey: record.aggregate_row_key || '',
          cause: String(caught && caught.message || caught)
        });
      }
      signatures[AKORT.AggregateIntegration.Test.publicSignature(payload)] = true;
    });
    return signatures;
  }

  function rowsFromBatchRanges_(spreadsheetId, sheetName, blocks, headers) {
    if (!(blocks || []).length) return [];
    var lastColumn = a1Column_(headers.length);
    var ranges = blocks.map(function (block) {
      return quotedSheetName_(sheetName) + '!A' + block.start + ':' + lastColumn + block.end;
    });
    var valuesByRange = batchGetValues_(spreadsheetId, ranges), rows = [];
    blocks.forEach(function (block, blockIndex) {
      var values = valuesByRange[blockIndex] || [];
      assert_(
        values.length === block.count,
        'ALPHA74_GATE5_TARGET_RANGE_INCOMPLETE',
        'Gate 5 fast replay received an incomplete affected-series range.',
        {
          startRow: block.start,
          endRow: block.end,
          expectedRows: block.count,
          actualRows: values.length
        }
      );
      values.forEach(function (row, offset) {
        var object = { __row: block.start + offset };
        headers.forEach(function (header, column) {
          object[header] = row[column] === undefined || row[column] === null ? '' : row[column];
        });
        rows.push(object);
      });
    });
    return rows;
  }

  function readAggregateRowsForStage_(spreadsheetId, stageRecords) {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(TARGET_SHEET);
    assert_(sheet, 'ALPHA74_GATE5_TARGET_SHEET_MISSING', 'Gate 5 aggregate target sheet is missing.', {
      spreadsheetId: spreadsheetId
    });
    var headers = AKORT.AggregateContract.Headers.slice();
    var actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    assert_(
      JSON.stringify(actualHeaders) === JSON.stringify(headers),
      'ALPHA74_GATE5_TARGET_SCHEMA_MISMATCH',
      'Gate 5 aggregate target schema changed.',
      { spreadsheetId: spreadsheetId, expected: headers, actual: actualHeaders }
    );
    var rowCount = Math.max(0, sheet.getLastRow() - 1);
    if (!rowCount || !(stageRecords || []).length) {
      return {
        spreadsheet: spreadsheet,
        sheet: sheet,
        rows: [],
        scanRows: rowCount,
        scanCells: 0,
        affectedRows: 0,
        affectedRanges: 0
      };
    }
    var sheetRef = quotedSheetName_(sheet.getName());
    var identityRanges = AGGREGATE_IDENTITY_COLUMNS.map(function (spec) {
      var column = a1Column_(spec.column);
      return sheetRef + '!' + column + '2:' + column + (rowCount + 1);
    });
    var identityValues = batchGetValues_(spreadsheetId, identityRanges);
    var affectedSignatures = stageSignatureMap_(stageRecords), physicalRows = [];
    for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      var projection = {};
      AGGREGATE_IDENTITY_COLUMNS.forEach(function (spec, columnIndex) {
        var columnRows = identityValues[columnIndex] || [];
        projection[spec.header] = columnRows[rowIndex] && columnRows[rowIndex][0] !== undefined
          ? columnRows[rowIndex][0]
          : '';
      });
      if (affectedSignatures[AKORT.AggregateIntegration.Test.publicSignature(projection)]) {
        physicalRows.push(rowIndex + 2);
      }
    }
    var blocks = rowBlocks_(physicalRows);
    var rows = rowsFromBatchRanges_(spreadsheetId, sheet.getName(), blocks, headers);
    rows.forEach(function (row) {
      assert_(
        affectedSignatures[AKORT.AggregateIntegration.Test.publicSignature(row)] === true,
        'ALPHA74_GATE5_TARGET_INDEX_DRIFT',
        'Gate 5 aggregate target changed between the bounded identity scan and affected-row read-back.',
        { physicalRow: Number(row.__row || 0) }
      );
    });
    return {
      spreadsheet: spreadsheet,
      sheet: sheet,
      rows: rows,
      scanRows: rowCount,
      scanCells: rowCount * AGGREGATE_IDENTITY_COLUMNS.length,
      affectedRows: rows.length,
      affectedRanges: blocks.length
    };
  }

  function readAggregateTailRows_(spreadsheet, rowCount) {
    var count = Math.max(0, Number(rowCount || 0));
    if (!count) return [];
    var sheet = spreadsheet.getSheetByName(TARGET_SHEET);
    assert_(sheet, 'ALPHA74_GATE5_TARGET_SHEET_MISSING', 'Gate 5 aggregate target sheet is missing.');
    var headers = AKORT.AggregateContract.Headers.slice();
    var lastRow = sheet.getLastRow(), startRow = lastRow - count + 1;
    assert_(
      startRow >= 2,
      'ALPHA74_GATE5_TARGET_TAIL_INCOMPLETE',
      'Gate 5 aggregate target does not contain the expected appended replacement rows.',
      { expectedRows: count, lastRow: lastRow }
    );
    return sheet.getRange(startRow, 1, count, headers.length).getValues().map(function (row, index) {
      var object = { __row: startRow + index };
      headers.forEach(function (header, column) {
        object[header] = row[column] === undefined || row[column] === null ? '' : row[column];
      });
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
      var serializedPayload = JSON.parse(JSON.stringify(payload));
      var period = periodKey_(serializedPayload.frequency, serializedPayload.period_start);
      assert_(period, 'ALPHA74_GATE5_STAGE_PERIOD_INVALID', 'Gate 5 cannot stage an aggregate row without a canonical publication period.', {
        frequency: serializedPayload.frequency || '',
        periodStart: serializedPayload.period_start || ''
      });
      serializedPayload.period_start = String(serializedPayload.frequency).toLowerCase() === 'monthly'
        ? period + '-01'
        : period;
      payload = serializedPayload;
      var signature = AKORT.AggregateIntegration.Test.publicSignature(payload);
      var seriesKey = 'A74_GATE5_SERIES_' + hash_(signature).slice(0, 24).toUpperCase();
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

  function replacementForSeriesCount_(targetRows, grouped, start, count) {
    var keys = grouped.keys.slice(start, start + count);
    var selected = [];
    keys.forEach(function (key) { selected = selected.concat(grouped.bySeries[key] || []); });
    AKORT.AggregateIntegration.Test.validateStageRows(selected, {
      operationId: selected[0].operation_id,
      loadId: selected[0].load_id,
      planId: selected[0].plan_id,
      planFingerprint: selected[0].plan_fingerprint
    });
    return {
      count: count,
      records: selected,
      replacement: AKORT.AggregateIntegration.Test.buildSeriesReplacement(targetRows, selected)
    };
  }

  function replacementFits_(candidate, limits) {
    var replacement = candidate && candidate.replacement || {};
    return Number(replacement.replacementRowCount || 0) <= Number(limits.maxRows || 0) &&
      Number(replacement.cellCount || 0) <= Number(limits.maxCells || 0) &&
      Number(replacement.requestCount || 0) <= Number(limits.maxRequests || 0);
  }

  function fittedBatchResult_(candidate, totalSeries, candidateSeries, evaluations) {
    return {
      complete: false,
      seriesCount: candidate.count,
      nextCursor: candidate.start + candidate.count,
      totalSeries: totalSeries,
      candidateSeries: candidateSeries,
      fitEvaluations: evaluations,
      limitReduced: candidate.count < candidateSeries,
      replacement: candidate.replacement,
      records: candidate.records
    };
  }

  function fitSeriesBatch_(targetRows, records, seriesCursor, limits) {
    var grouped = stageSeries_(records);
    var start = Math.max(0, Number(seriesCursor || 0));
    var remaining = grouped.keys.length - start;
    if (remaining <= 0) return { complete: true, seriesCount: 0, nextCursor: start, replacement: null, records: [] };
    var candidateSeries = Math.min(AGGREGATE_SERIES_WINDOW, remaining);
    var evaluations = 0;
    var maximum = replacementForSeriesCount_(targetRows, grouped, start, candidateSeries);
    maximum.start = start;
    evaluations += 1;
    if (replacementFits_(maximum, limits)) {
      return fittedBatchResult_(maximum, grouped.keys.length, candidateSeries, evaluations);
    }
    var low = 1, high = candidateSeries - 1, best = null;
    while (low <= high) {
      var count = Math.floor((low + high) / 2);
      var current = replacementForSeriesCount_(targetRows, grouped, start, count);
      current.start = start;
      evaluations += 1;
      if (replacementFits_(current, limits)) {
        best = current;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (best) {
      return fittedBatchResult_(best, grouped.keys.length, candidateSeries, evaluations);
    }
    throw error_('ALPHA74_GATE5_ATOMIC_LIMIT_EXCEEDED', 'One logical aggregate series exceeds the Gate 5 atomic publication limit.', {
      seriesCursor: start,
      candidateSeries: candidateSeries,
      evaluations: evaluations,
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

  function aggregateItemInventoryIdentity_(state, group, context) {
    var root = {
      replaySpreadsheetId: text_(state && state.artifacts && state.artifacts.sequentialReplay && state.artifacts.sequentialReplay.id),
      groupIndex: Number(state && state.replayGroupIndex || 0),
      loadId: text_(group && group.loadId),
      allowedLoadIds: (context && context.allowedLoadIds || []).slice().sort(),
      reversedLoadIds: (context && context.reversedLoadIds || []).slice().sort(),
      frontierHash: text_(state && state.frontierHash)
    };
    return {
      inventoryId: 'A74_GATE5_ITEMS_' + hash_(root).slice(0, 24).toUpperCase(),
      loadId: root.loadId,
      groupIndex: root.groupIndex
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
      replayAggregateItemPreparationSteps: 0,
      replayAggregateItemRowsScanned: 0,
      replayAggregateItemAffectedRows: 0,
      replayAggregateDescriptorsExpanded: 0,
      replayAggregateItemsAdded: 0,
      replayAggregateItemInventoriesPrepared: 0,
      replayAggregateItemPreparationRecoveryAdoptions: 0,
      replayAggregateCombosProcessed: 0,
      replayAggregateRowsCalculated: 0,
      replayAggregateBatchesMaterialized: 0,
      replayAggregateCacheRowsWritten: 0,
      replayAggregatePublicationSteps: 0,
      replayAggregateSeriesPublished: 0,
      replayLatestRowsScanned: 0,
      replayLatestRowsUpdated: 0,
      replayLatestChunks: 0,
      legacyPartialBatchAdoptions: 0,
      legacyPartialSeriesCursorReplayed: 0,
      exactDuplicateRecoveryAdoptions: 0,
      periodIdentityRecoveryAdoptions: 0,
      performanceRecoveryAdoptions: 0,
      adaptiveWindowRecoveryAdoptions: 0,
      exactDuplicateRepairSteps: 0,
      exactDuplicateLogicalRowsRepaired: 0,
      exactDuplicateRowsRepaired: 0,
      adaptivePublicationWindows: 0,
      adaptivePublicationSeries: 0,
      adaptivePublicationLimitReductions: 0,
      adaptivePublicationFitEvaluations: 0,
      maximumSeriesPerPublication: 0,
      legacyIdentityScansAvoided: 0,
      targetIdentityScans: 0,
      targetIdentityRowsScanned: 0,
      targetIdentityCellsRead: 0,
      targetAffectedRowsRead: 0,
      targetAffectedRangesRead: 0,
      targetReadbackRowsRead: 0,
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
      aggregateItemsWork: null,
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

  function legacyPartialAdoption_(state, triggerCount) {
    var metrics = state && state.metrics || {};
    var lastStep = state && state.lastStep || {};
    var orphanedRunning = state && state.status === 'RUNNING' && state.phase === 'SEQUENTIAL_REPLAY';
    var manuallyStopped = state && state.status === 'STOPPED' && state.phase === 'STOPPED' &&
      state.failureCode === 'STOPPED_MANUALLY';
    var eligible = !!state &&
      (orphanedRunning || manuallyStopped) &&
      Number(triggerCount || 0) === 0 &&
      text_(state.stateSchemaVersion) === '4.0-alpha74-gate5-state-4' &&
      text_(state.release) === '4.0.0-alpha.7.4.6' &&
      Number(state.replayGroupCount || 0) === 12 &&
      Number(state.replayGroupIndex || 0) === 0 &&
      text_(state.replayStage) === 'AGGREGATES' &&
      Number(state.replayItemCursor || 0) === 150 &&
      Number(state.aggregateSeriesCursor || 0) === 64 &&
      !state.aggregateBatchWork &&
      Number(lastStep.comboCursor || 0) === 150 &&
      Number(lastStep.comboTotal || 0) === 381 &&
      Number(lastStep.seriesCursor || 0) === 64 &&
      Number(lastStep.seriesTotal || 0) === 105 &&
      Number(metrics.replayAggregateCombosProcessed || 0) === 200 &&
      Number(metrics.replayAggregateRowsCalculated || 0) === 3465 &&
      Number(metrics.replayAggregateSeriesPublished || 0) === 204;
    return {
      eligible: eligible,
      mode: orphanedRunning ? 'ORPHANED_RUNNING_PARTIAL_SERIES' : manuallyStopped ? 'STOPPED_PARTIAL_SERIES' : '',
      triggerCount: Number(triggerCount || 0),
      comboCursor: Number(state && state.replayItemCursor || 0),
      sourceSeriesCursor: Number(state && state.aggregateSeriesCursor || 0),
      sourceSeriesTotal: Number(lastStep.seriesTotal || 0),
      replayPolicy: eligible ? 'REPLAY_PARTIAL_BATCH_FROM_COMBO_CURSOR' : ''
    };
  }

  function exactDuplicateIncident_(state, triggerCount) {
    var work = state && state.aggregateBatchWork || null;
    var eligible = !!state &&
      state.status === 'FAILED' &&
      state.phase === 'FAILED' &&
      text_(state.failureCode) === 'AGGREGATE_TARGET_DUPLICATE_ROW_KEY' &&
      Number(triggerCount || 0) === 0 &&
      text_(state.stateSchemaVersion) === '4.0-alpha74-gate5-state-6' &&
      text_(state.release) === '4.0.0-alpha.7.4.8' &&
      text_(state.replayStage) === 'AGGREGATES' &&
      Number(state.replayGroupCount || 0) > 0 &&
      Number(state.replayGroupIndex || 0) < Number(state.replayGroupCount || 0) &&
      Number(state.aggregateSeriesCursor || 0) === 0 &&
      !!work &&
      text_(work.workSchemaVersion) === AGGREGATE_WORK_SCHEMA_VERSION &&
      Number(work.groupIndex || 0) === Number(state.replayGroupIndex || 0) &&
      Number(work.comboCursor || 0) === Number(state.replayItemCursor || 0) &&
      Number(work.seriesCursor || 0) === 0 &&
      Number(work.recordCount || 0) > 0 &&
      Number(work.seriesCount || 0) > 0 &&
      !!text_(work.stageFingerprint);
    return {
      eligible: eligible,
      mode: eligible ? 'FAILED_EXACT_DUPLICATE_WITH_DURABLE_BATCH' : '',
      triggerCount: Number(triggerCount || 0),
      groupIndex: Number(state && state.replayGroupIndex || 0),
      itemCursor: Number(state && state.replayItemCursor || 0),
      recordCount: Number(work && work.recordCount || 0),
      seriesCount: Number(work && work.seriesCount || 0),
      preserveAggregateBatch: eligible
    };
  }

  function periodIdentityIncident_(state, triggerCount) {
    var work = state && state.aggregateBatchWork || null;
    var stopped = state && state.status === 'STOPPED' && state.phase === 'STOPPED' &&
      text_(state.failureCode) === 'STOPPED_MANUALLY';
    var failed = state && state.status === 'FAILED' && state.phase === 'FAILED' &&
      text_(state.failureCode) === 'ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN';
    var lastErrorCode = text_(state && state.lastError && state.lastError.code);
    var eligible = !!state &&
      (stopped || failed) &&
      lastErrorCode === 'ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN' &&
      Number(triggerCount || 0) === 0 &&
      text_(state.stateSchemaVersion) === '4.0-alpha74-gate5-state-7' &&
      text_(state.release) === '4.0.0-alpha.7.4.9' &&
      text_(state.replayStage) === 'AGGREGATES' &&
      Number(state.replayGroupCount || 0) > 0 &&
      Number(state.replayGroupIndex || 0) < Number(state.replayGroupCount || 0) &&
      Number(state.aggregateSeriesCursor || 0) === 0 &&
      !!work &&
      text_(work.workSchemaVersion) === AGGREGATE_WORK_SCHEMA_VERSION &&
      Number(work.groupIndex || 0) === Number(state.replayGroupIndex || 0) &&
      Number(work.comboCursor || 0) === Number(state.replayItemCursor || 0) &&
      Number(work.seriesCursor || 0) === 0 &&
      Number(work.recordCount || 0) > 0 &&
      Number(work.seriesCount || 0) > 0 &&
      !!text_(work.stageFingerprint);
    return {
      eligible: eligible,
      mode: eligible
        ? stopped
          ? 'STOPPED_ATOMIC_UNCERTAIN_PERIOD_IDENTITY_WITH_DURABLE_BATCH'
          : 'FAILED_ATOMIC_UNCERTAIN_PERIOD_IDENTITY_WITH_DURABLE_BATCH'
        : '',
      triggerCount: Number(triggerCount || 0),
      groupIndex: Number(state && state.replayGroupIndex || 0),
      itemCursor: Number(state && state.replayItemCursor || 0),
      recordCount: Number(work && work.recordCount || 0),
      seriesCount: Number(work && work.seriesCount || 0),
      preserveAggregateBatch: eligible
    };
  }

  function performanceResume_(state, triggerCount) {
    var work = state && state.aggregateBatchWork || null;
    var itemWork = state && state.aggregateItemsWork || null;
    var stopped = !!state &&
      state.status === 'STOPPED' &&
      state.phase === 'STOPPED' &&
      text_(state.failureCode) === 'STOPPED_MANUALLY';
    var sourceVersion = text_(state && state.stateSchemaVersion);
    var sourceRelease = text_(state && state.release);
    var compatibleSource = !!state && (
      (sourceVersion === '4.0-alpha74-gate5-state-8' &&
        sourceRelease === '4.0.0-alpha.7.4.10') ||
      (sourceVersion === '4.0-alpha74-gate5-state-9' &&
        sourceRelease === '4.0.0-alpha.7.4.11') ||
      (sourceVersion === '4.0-alpha74-gate5-state-10' &&
        sourceRelease === '4.0.0-alpha.7.4.12') ||
      (sourceVersion === '4.0-alpha74-gate5-state-11' &&
        sourceRelease === '4.0.0-alpha.7.4.13') ||
      (sourceVersion === '4.0-alpha74-gate5-state-12' &&
        sourceRelease === '4.0.0-alpha.7.4.14') ||
      (sourceVersion === STATE_SCHEMA_VERSION && sourceRelease === RELEASE)
    );
    var validItemWork = !!itemWork &&
      text_(itemWork.workSchemaVersion) === AGGREGATE_ITEM_WORK_SCHEMA_VERSION &&
      text_(itemWork.loadId) !== '' &&
      text_(itemWork.inventoryId) !== '' &&
      Number(itemWork.groupIndex || 0) === Number(state && state.replayGroupIndex || 0) &&
      ['SCAN_WEEKLY', 'SCAN_MONTHLY', 'SCAN_REVERSAL', 'FINALIZE', 'READY'].indexOf(text_(itemWork.phase)) >= 0 &&
      Number(itemWork.sourceCursor || 0) >= 0 &&
      Number(itemWork.itemCount || 0) >= 0;
    var atLogicalBoundary = !work && !itemWork && Number(state && state.aggregateSeriesCursor || 0) === 0;
    var atDurableItemBoundary = !work && validItemWork && Number(state && state.aggregateSeriesCursor || 0) === 0;
    var atDurableSeriesBoundary = !!work &&
      text_(work.workSchemaVersion) === AGGREGATE_WORK_SCHEMA_VERSION &&
      Number(work.groupIndex || 0) === Number(state && state.replayGroupIndex || 0) &&
      Number(work.comboCursor || 0) === Number(state && state.replayItemCursor || 0) &&
      Number(work.seriesCursor || 0) === Number(state && state.aggregateSeriesCursor || 0) &&
      Number(work.seriesCursor || 0) >= 0 &&
      Number(work.seriesCursor || 0) < Number(work.seriesCount || 0) &&
      Number(work.recordCount || 0) > 0 &&
      Number(work.seriesCount || 0) > 0 &&
      !!text_(work.stageFingerprint);
    var eligible = stopped &&
      compatibleSource &&
      Number(triggerCount || 0) === 0 &&
      text_(state.replayStage) === 'AGGREGATES' &&
      Number(state.replayGroupCount || 0) > 0 &&
      Number(state.replayGroupIndex || 0) < Number(state.replayGroupCount || 0) &&
      (atLogicalBoundary || atDurableItemBoundary || atDurableSeriesBoundary);
    return {
      eligible: eligible,
      mode: eligible
        ? sourceRelease === '4.0.0-alpha.7.4.10'
          ? 'STOPPED_ALPHA7410_FAST_TARGET_SCAN_ADOPTION'
          : sourceRelease === '4.0.0-alpha.7.4.11'
            ? 'STOPPED_ALPHA7411_ADAPTIVE_WINDOW_ADOPTION'
            : sourceRelease === '4.0.0-alpha.7.4.12'
              ? 'STOPPED_ALPHA7412_RESUME_ALLOWLIST_RECOVERY'
              : sourceRelease === '4.0.0-alpha.7.4.13'
                ? 'STOPPED_ALPHA7413_DURABLE_ITEM_INVENTORY_ADOPTION'
                : sourceRelease === '4.0.0-alpha.7.4.14'
                  ? 'STOPPED_ALPHA7414_AGGREGATE_DESCRIPTOR_DEDUP_ADOPTION'
                  : 'STOPPED_ALPHA7415_DURABLE_ITEM_INVENTORY_RESUME'
        : '',
      triggerCount: Number(triggerCount || 0),
      groupIndex: Number(state && state.replayGroupIndex || 0),
      itemCursor: Number(state && state.replayItemCursor || 0),
      seriesCursor: Number(state && state.aggregateSeriesCursor || 0),
      preserveAggregateBatch: eligible && atDurableSeriesBoundary,
      preserveAggregateItems: eligible && validItemWork &&
        (atDurableItemBoundary || atDurableSeriesBoundary),
      boundary: atDurableSeriesBoundary
        ? 'DURABLE_SERIES'
        : atDurableItemBoundary
          ? 'DURABLE_ITEM_PREPARATION'
          : atLogicalBoundary
            ? 'LOGICAL_BATCH'
            : ''
    };
  }

  function buildDurableResumeState_(sourceState, executionId, resumeBoundary) {
    var state = clone_(sourceState || {});
    var resumedAt = now_();
    var partialAdoption = resumeBoundary && resumeBoundary.legacyPartialAdoption ||
      legacyPartialAdoption_(sourceState, 0);
    var duplicateIncident = resumeBoundary && resumeBoundary.exactDuplicateIncident ||
      exactDuplicateIncident_(sourceState, 0);
    var periodIdentityIncident = resumeBoundary && resumeBoundary.periodIdentityIncident ||
      periodIdentityIncident_(sourceState, 0);
    var performanceResume = resumeBoundary && resumeBoundary.performanceResume ||
      performanceResume_(sourceState, 0);
    var preserveAggregateBatch = duplicateIncident.eligible ||
      periodIdentityIncident.eligible ||
      performanceResume.preserveAggregateBatch === true;
    var preserveAggregateItems = performanceResume.preserveAggregateItems === true;
    var sourceRecovery = clone_(state.recovery || {});
    var priorCanonicalRecovery = {
      mode: text_(sourceRecovery.mode),
      recoveredFromExecutionId: text_(sourceRecovery.recoveredFromExecutionId),
      recoveredFromRelease: text_(sourceRecovery.recoveredFromRelease),
      recoveredAt: text_(sourceRecovery.recoveredAt),
      supersededReplayId: text_(sourceRecovery.supersededReplay && sourceRecovery.supersededReplay.id)
    };
    var recovery = {
      mode: duplicateIncident.eligible
        ? 'DURABLE_EXACT_DUPLICATE_REPAIR_RESUME'
        : periodIdentityIncident.eligible
          ? 'DURABLE_PERIOD_IDENTITY_REPAIR_RESUME'
          : performanceResume.eligible
            ? (text_(sourceState && sourceState.release) === '4.0.0-alpha.7.4.13' || preserveAggregateItems)
              ? 'DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME'
              : 'DURABLE_ADAPTIVE_WINDOW_RESUME'
          : 'DURABLE_AGGREGATE_BATCH_RESUME',
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
        preservedAggregateSeriesCursor: Number(sourceState && sourceState.aggregateSeriesCursor || 0),
        replayPolicy: partialAdoption.eligible ? partialAdoption.replayPolicy : 'CONTINUE_FROM_DURABLE_BOUNDARY',
        legacyPartialAdoptionMode: partialAdoption.eligible ? partialAdoption.mode : '',
        legacyPartialSeriesCursorReplayed: partialAdoption.eligible ? partialAdoption.sourceSeriesCursor : 0,
        exactDuplicateIncidentMode: duplicateIncident.eligible ? duplicateIncident.mode : '',
        exactDuplicateLogicalRows: Number(duplicateIncident.exactDuplicateLogicalRows || 0),
        exactDuplicateRows: Number(duplicateIncident.exactDuplicateRows || 0),
        periodIdentityIncidentMode: periodIdentityIncident.eligible ? periodIdentityIncident.mode : '',
        stagePeriodIdentityMismatches: Number(periodIdentityIncident.stagePeriodIdentityMismatches || 0),
        performanceResumeMode: performanceResume.eligible ? performanceResume.mode : '',
        performanceResumeBoundary: performanceResume.eligible ? performanceResume.boundary : '',
        preservedAggregateItems: preserveAggregateItems,
        preservedAggregateBatch: preserveAggregateBatch
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
    state.aggregateItemsWork = preserveAggregateItems ? clone_(sourceState.aggregateItemsWork) : null;
    state.aggregateBatchWork = preserveAggregateBatch ? clone_(sourceState.aggregateBatchWork) : null;
    state.aggregateSeriesCursor = preserveAggregateBatch
      ? Number(sourceState.aggregateSeriesCursor || 0)
      : 0;
    state.replayLatestWork = null;
    state.recovery = recovery;
    var resumedMetrics = metrics_(state);
    if (partialAdoption.eligible) {
      resumedMetrics.legacyPartialBatchAdoptions += 1;
      resumedMetrics.legacyPartialSeriesCursorReplayed += partialAdoption.sourceSeriesCursor;
    }
    if (duplicateIncident.eligible) resumedMetrics.exactDuplicateRecoveryAdoptions += 1;
    if (periodIdentityIncident.eligible) resumedMetrics.periodIdentityRecoveryAdoptions += 1;
    if (performanceResume.eligible) {
      resumedMetrics.performanceRecoveryAdoptions += 1;
      resumedMetrics.adaptiveWindowRecoveryAdoptions += 1;
      if (text_(sourceState && sourceState.release) === '4.0.0-alpha.7.4.13' || preserveAggregateItems) {
        resumedMetrics.replayAggregateItemPreparationRecoveryAdoptions += 1;
      }
    }
    return state;
  }

  function durableResumeStateSchemaCompatible_(value) {
    return DURABLE_RESUME_STATE_SCHEMAS.indexOf(text_(value)) >= 0;
  }

  function durableResumeReleaseCompatible_(value) {
    return DURABLE_RESUME_RELEASES.indexOf(text_(value)) >= 0;
  }

  function assertDurableResumeSource_(state, resources) {
    assert_(state, 'ALPHA74_GATE5_DURABLE_RESUME_STATE_MISSING', 'Gate 5 durable replay resume requires the preserved stopped checkpoint.');
    var triggerCount = triggers_().length;
    var legacyPartialAdoption = legacyPartialAdoption_(state, triggerCount);
    var exactDuplicateIncident = exactDuplicateIncident_(state, triggerCount);
    var periodIdentityIncident = periodIdentityIncident_(state, triggerCount);
    var performanceResume = performanceResume_(state, triggerCount);
    var stoppedBoundary = state.status === 'STOPPED' && state.phase === 'STOPPED' &&
      state.failureCode === 'STOPPED_MANUALLY' &&
      Number(state.aggregateSeriesCursor || 0) === 0 &&
      triggerCount === 0;
    assert_(
      stoppedBoundary ||
        legacyPartialAdoption.eligible ||
        exactDuplicateIncident.eligible ||
        periodIdentityIncident.eligible ||
        performanceResume.eligible,
      'ALPHA74_GATE5_DURABLE_RESUME_SOURCE_NOT_ADOPTABLE',
      'Gate 5 durable replay resume requires a manually stopped logical-series boundary, a durable Alpha.7.4.10 series boundary, the exact triggerless legacy partial batch, a verified exact-duplicate failure, or the stopped period-identity incident with a durable cached batch.',
      {
        status: state.status || '',
        phase: state.phase || '',
        failureCode: state.failureCode || '',
        triggerCount: triggerCount,
        aggregateSeriesCursor: Number(state.aggregateSeriesCursor || 0),
        legacyPartialAdoption: legacyPartialAdoption,
        exactDuplicateIncident: exactDuplicateIncident,
        periodIdentityIncident: periodIdentityIncident,
        performanceResume: performanceResume
      }
    );
    assert_(
      durableResumeStateSchemaCompatible_(state.stateSchemaVersion),
      'ALPHA74_GATE5_DURABLE_RESUME_STATE_SCHEMA_INVALID',
      'Gate 5 durable replay resume cannot reuse this checkpoint schema.',
      { stateSchemaVersion: state.stateSchemaVersion || '' }
    );
    assert_(
      durableResumeReleaseCompatible_(state.release),
      'ALPHA74_GATE5_DURABLE_RESUME_RELEASE_INVALID',
      'Gate 5 durable replay resume cannot reuse this release.',
      { release: state.release || '' }
    );
    assert_(
      state.replayStage === 'AGGREGATES' &&
        Number(state.replayGroupCount || 0) > 0 &&
        Number(state.replayGroupIndex || 0) < Number(state.replayGroupCount || 0) &&
        Number(state.replayItemCursor || 0) >= 0 &&
        (Number(state.aggregateSeriesCursor || 0) === 0 ||
          legacyPartialAdoption.eligible ||
          performanceResume.eligible) &&
        ((!state.aggregateBatchWork &&
          !exactDuplicateIncident.eligible &&
          !periodIdentityIncident.eligible &&
          !performanceResume.preserveAggregateBatch) ||
          (!!state.aggregateBatchWork &&
            (exactDuplicateIncident.eligible ||
              periodIdentityIncident.eligible ||
              performanceResume.preserveAggregateBatch))) &&
        (!state.aggregateItemsWork || performanceResume.preserveAggregateItems),
      'ALPHA74_GATE5_DURABLE_RESUME_BOUNDARY_INVALID',
      'Gate 5 durable replay resume requires a checkpoint between aggregate logical-series batches.',
      {
        groupCount: Number(state.replayGroupCount || 0),
        groupIndex: Number(state.replayGroupIndex || 0),
        replayStage: state.replayStage || '',
        replayItemCursor: Number(state.replayItemCursor || 0),
        aggregateSeriesCursor: Number(state.aggregateSeriesCursor || 0),
        aggregateItemsWork: !!state.aggregateItemsWork,
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
    var itemInventoryValidation = null;
    var itemInventoryValidationDeferred = false;
    var itemTotal = 0;
    if (state.aggregateItemsWork) {
      var expectedItemInventoryIdentity = aggregateItemInventoryIdentity_(state, group, context);
      assert_(
        text_(state.aggregateItemsWork.inventoryId) === expectedItemInventoryIdentity.inventoryId &&
          text_(state.aggregateItemsWork.loadId) === expectedItemInventoryIdentity.loadId &&
          Number(state.aggregateItemsWork.groupIndex || 0) === expectedItemInventoryIdentity.groupIndex,
        'ALPHA74_GATE5_DURABLE_ITEM_INVENTORY_IDENTITY_MISMATCH',
        'The preserved aggregate item inventory does not belong to the current replay group and frontier.',
        {
          expected: expectedItemInventoryIdentity,
          actual: {
            inventoryId: text_(state.aggregateItemsWork.inventoryId),
            loadId: text_(state.aggregateItemsWork.loadId),
            groupIndex: Number(state.aggregateItemsWork.groupIndex || 0)
          }
        }
      );
      itemInventoryValidation = AKORT.IncrementalPublish.Gate5.inspectAggregateItems(
        state.artifacts.sequentialReplay.id,
        state.aggregateItemsWork
      );
      if (itemInventoryValidation.ready) itemTotal = Number(itemInventoryValidation.itemCount || 0);
      else {
        assert_(Number(state.replayItemCursor || 0) === 0, 'ALPHA74_GATE5_DURABLE_ITEM_PREPARATION_CURSOR_INVALID', 'A partially prepared aggregate item inventory can only be resumed before aggregate publication starts.', {
          cursor: Number(state.replayItemCursor || 0),
          itemInventory: itemInventoryValidation
        });
        itemInventoryValidationDeferred = true;
      }
    } else if (
      Number(state.replayItemCursor || 0) === 0 &&
      [RELEASE, '4.0.0-alpha.7.4.13'].indexOf(text_(state.release)) >= 0
    ) {
      itemInventoryValidationDeferred = true;
    } else {
      var legacyItems = AKORT.IncrementalPublish.Gate5.replayItems(
        state.artifacts.sequentialReplay.id,
        context.allowedLoadIds,
        context.reversedLoadIds,
        group,
        'AGGREGATES',
        readFrontier_(state)
      );
      itemTotal = legacyItems.length;
    }
    if (!itemInventoryValidationDeferred) {
      assert_(Number(state.replayItemCursor || 0) <= itemTotal, 'ALPHA74_GATE5_DURABLE_RESUME_CURSOR_INVALID', 'The preserved aggregate replay cursor exceeds the current deterministic item inventory.', {
        cursor: Number(state.replayItemCursor || 0),
        total: itemTotal
      });
    }
    if (exactDuplicateIncident.eligible || periodIdentityIncident.eligible) {
      var cachedRecords = readAggregateBatchCache_(state, state.aggregateBatchWork);
      var repair = AKORT.AggregateIntegration.Test.buildSeriesReplacement(
        readAggregateRows_(state.artifacts.sequentialReplay.id),
        cachedRecords
      );
      assert_(
        repair.requiresPhysicalRepair === true &&
          Number(repair.exactDuplicateLogicalRows.length || 0) > 0 &&
          Number(repair.exactDuplicateRowCount || 0) > 0,
        'ALPHA74_GATE5_EXACT_DUPLICATE_INCIDENT_NOT_REPRODUCED',
        'The failed Gate 5 checkpoint no longer contains the exact duplicate condition required for this recovery.',
        {
          requiresPhysicalRepair: repair.requiresPhysicalRepair === true,
          exactDuplicateLogicalRows: Number(repair.exactDuplicateLogicalRows.length || 0),
          exactDuplicateRows: Number(repair.exactDuplicateRowCount || 0)
        }
      );
      exactDuplicateIncident.exactDuplicateLogicalRows = repair.exactDuplicateLogicalRows.length;
      exactDuplicateIncident.exactDuplicateRows = repair.exactDuplicateRowCount;
      exactDuplicateIncident.replacementRows = repair.replacementRowCount;
      exactDuplicateIncident.requestCount = repair.requestCount;
      if (periodIdentityIncident.eligible) {
        assert_(
          repair.requiresStagePeriodIdentityRepair === true &&
            Number(repair.stagePeriodIdentityMismatchCount || 0) > 0,
          'ALPHA74_GATE5_PERIOD_IDENTITY_INCIDENT_NOT_REPRODUCED',
          'The stopped Gate 5 checkpoint no longer contains the staged/publication period identity mismatch required for this recovery.',
          {
            requiresStagePeriodIdentityRepair: repair.requiresStagePeriodIdentityRepair === true,
            stagePeriodIdentityMismatches: Number(repair.stagePeriodIdentityMismatchCount || 0)
          }
        );
        periodIdentityIncident.stagePeriodIdentityMismatches = repair.stagePeriodIdentityMismatchCount;
        periodIdentityIncident.exactDuplicateLogicalRows = repair.exactDuplicateLogicalRows.length;
        periodIdentityIncident.exactDuplicateRows = repair.exactDuplicateRowCount;
        periodIdentityIncident.replacementRows = repair.replacementRowCount;
        periodIdentityIncident.requestCount = repair.requestCount;
      }
    } else if (performanceResume.preserveAggregateBatch) {
      readAggregateBatchCache_(state, state.aggregateBatchWork);
    }
    return {
      groupIndex: Number(state.replayGroupIndex || 0),
      loadId: group.loadId,
      itemCursor: Number(state.replayItemCursor || 0),
      itemTotal: itemInventoryValidationDeferred ? null : itemTotal,
      itemInventoryValidationDeferred: itemInventoryValidationDeferred,
      itemInventoryValidation: itemInventoryValidation,
      legacyPartialAdoption: legacyPartialAdoption,
      exactDuplicateIncident: exactDuplicateIncident,
      periodIdentityIncident: periodIdentityIncident,
      performanceResume: performanceResume,
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
    state.aggregateItemsWork = null;
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
      state.aggregateItemsWork = null;
      state.aggregateBatchWork = null;
      return { groupComplete: false, nextStage: state.replayStage };
    }
    assertAggregateReplayProgress_(state);
    updateGroupStatus_(state, group, 'SUCCESS');
    state.replayGroupIndex = Number(state.replayGroupIndex || 0) + 1;
    state.replayStage = REPLAY_STAGES[0];
    state.replayItemCursor = 0;
    state.aggregateSeriesCursor = 0;
    state.aggregateItemsWork = null;
    state.aggregateBatchWork = null;
    if (state.replayGroupIndex >= Number(state.replayGroupCount || 0)) state.phase = 'FINALIZE_REPLAY';
    return { groupComplete: true, nextGroupIndex: state.replayGroupIndex, nextPhase: state.phase };
  }

  function prepareAggregateItemInventoryStep_(state, group, context, frontier) {
    var beforeReady = state.aggregateItemsWork && state.aggregateItemsWork.ready === true;
    var identity = aggregateItemInventoryIdentity_(state, group, context);
    var result = AKORT.IncrementalPublish.Gate5.prepareAggregateItemsChunk(
      state.artifacts.sequentialReplay.id,
      context.allowedLoadIds,
      context.reversedLoadIds,
      group,
      frontier,
      state.aggregateItemsWork || null,
      identity
    );
    state.aggregateItemsWork = result.work || null;
    var aggregateMetrics = metrics_(state);
    aggregateMetrics.replayAggregateItemPreparationSteps += 1;
    aggregateMetrics.replayAggregateItemRowsScanned += Number(result.rowsScanned || 0);
    aggregateMetrics.replayAggregateItemAffectedRows += Number(result.affectedRows || 0);
    aggregateMetrics.replayAggregateDescriptorsExpanded += Number(result.affectedDescriptors || 0);
    aggregateMetrics.replayAggregateItemsAdded += Number(result.combosAdded || 0);
    if (!beforeReady && result.ready === true) aggregateMetrics.replayAggregateItemInventoriesPrepared += 1;
    return {
      groupIndex: Number(state.replayGroupIndex || 0),
      loadId: group.loadId,
      stage: 'AGGREGATES',
      phase: 'PREPARE_AGGREGATE_ITEMS',
      preparationPhase: result.phase || '',
      sourceCursor: Number(result.work && result.work.sourceCursor || 0),
      sourceTotal: Number(result.work && result.work.sourceTotal || 0),
      rowsScanned: Number(result.rowsScanned || 0),
      affectedRows: Number(result.affectedRows || 0),
      affectedDescriptors: Number(result.affectedDescriptors || 0),
      combosAdded: Number(result.combosAdded || 0),
      totalItems: Number(result.totalItems || 0),
      ready: result.ready === true
    };
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
    var cursor = Math.max(0, Number(state.replayItemCursor || 0));

    if (state.replayStage !== 'AGGREGATES') {
      var items = AKORT.IncrementalPublish.Gate5.replayItems(
        state.artifacts.sequentialReplay.id,
        context.allowedLoadIds,
        context.reversedLoadIds,
        group,
        state.replayStage,
        []
      );
      if (cursor >= items.length) return nextReplayStage_(state, group);
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
    if (!state.aggregateItemsWork || state.aggregateItemsWork.ready !== true) {
      return prepareAggregateItemInventoryStep_(state, group, context, readFrontier_(state));
    }
    var itemChunk = AKORT.IncrementalPublish.Gate5.readAggregateItemsChunk(
      state.artifacts.sequentialReplay.id,
      state.aggregateItemsWork,
      cursor,
      AGGREGATE_COMBO_BATCH
    );
    var itemTotal = Number(itemChunk.total || 0);
    if (cursor >= itemTotal) return nextReplayStage_(state, group);
    var work = state.aggregateBatchWork || null;
    if (!work) {
      var combos = itemChunk.items || [];
      assert_(combos.length > 0, 'ALPHA74_GATE5_AGGREGATE_ITEM_CHUNK_EMPTY', 'The durable aggregate item inventory returned an empty chunk before its terminal cursor.', {
        cursor: cursor,
        total: itemTotal
      });
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
          comboTotal: itemTotal,
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
        comboTotal: itemTotal,
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
        comboTotal: itemTotal,
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
        Number(work.comboTotal) === itemTotal,
      'ALPHA74_GATE5_AGGREGATE_WORK_MISMATCH',
      'The durable aggregate replay batch checkpoint does not match the current replay frontier.',
      {
        work: clone_(work),
        groupIndex: Number(state.replayGroupIndex || 0),
        loadId: group.loadId,
        comboCursor: cursor,
        comboTotal: itemTotal
      }
    );
    var cachedRecords = readAggregateBatchCache_(state, work);
    var candidateRecords = candidateStageRecords_(cachedRecords, work.seriesCursor);
    var targetRead = readAggregateRowsForStage_(
      state.artifacts.sequentialReplay.id,
      candidateRecords
    );
    aggregateMetrics.targetIdentityScans += 1;
    aggregateMetrics.targetIdentityRowsScanned += Number(targetRead.scanRows || 0);
    aggregateMetrics.targetIdentityCellsRead += Number(targetRead.scanCells || 0);
    aggregateMetrics.targetAffectedRowsRead += Number(targetRead.affectedRows || 0);
    aggregateMetrics.targetAffectedRangesRead += Number(targetRead.affectedRanges || 0);
    var batch = fitSeriesBatch_(targetRead.rows, cachedRecords, work.seriesCursor, limits_());
    var replacement = batch.replacement;
    var write = { apiCalls: 0, requests: 0, noOp: true };
    var requiresPhysicalRepair = replacement.requiresPhysicalRepair === true;
    if (requiresPhysicalRepair || replacement.beforeFingerprint !== replacement.afterFingerprint) {
      write = AKORT.AggregateIntegration.Gate4.atomicReplaceIsolated(
        targetRead.spreadsheet,
        replacement
      );
      var readBackRows = readAggregateTailRows_(
        SpreadsheetApp.openById(state.artifacts.sequentialReplay.id),
        replacement.replacementRowCount
      );
      aggregateMetrics.targetReadbackRowsRead += readBackRows.length;
      var readBackReplacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(
        readBackRows,
        batch.records
      );
      if (readBackReplacement.requiresPhysicalRepair ||
          readBackReplacement.beforeFingerprint !== replacement.afterFingerprint) {
        throw error_('ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN', 'Gate 5 aggregate atomic read-back is not yet the unique expected after-state; the same cached series batch must be retried.', {
          retryable: true,
          requiresPhysicalRepair: readBackReplacement.requiresPhysicalRepair === true,
          exactDuplicateLogicalRows: readBackReplacement.exactDuplicateLogicalRows.length,
          exactDuplicateRows: readBackReplacement.exactDuplicateRowCount,
          expectedAfterFingerprint: replacement.afterFingerprint,
          actualFingerprint: readBackReplacement.beforeFingerprint
        });
      }
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
    aggregateMetrics.adaptivePublicationWindows += 1;
    aggregateMetrics.adaptivePublicationSeries += batch.seriesCount;
    aggregateMetrics.adaptivePublicationFitEvaluations += Number(batch.fitEvaluations || 0);
    if (batch.limitReduced) aggregateMetrics.adaptivePublicationLimitReductions += 1;
    aggregateMetrics.maximumSeriesPerPublication = Math.max(
      Number(aggregateMetrics.maximumSeriesPerPublication || 0),
      Number(batch.seriesCount || 0)
    );
    aggregateMetrics.legacyIdentityScansAvoided += Math.max(
      0,
      Math.ceil(Number(batch.seriesCount || 0) / LEGACY_AGGREGATE_SERIES_BATCH) - 1
    );
    aggregateMetrics.atomicApiCalls += Number(write.apiCalls || 0);
    aggregateMetrics.atomicRequests += Number(write.requests || 0);
    aggregateMetrics.maximumReplacementRows = Math.max(aggregateMetrics.maximumReplacementRows, Number(replacement.replacementRowCount || 0));
    aggregateMetrics.maximumReplacementCells = Math.max(aggregateMetrics.maximumReplacementCells, Number(replacement.cellCount || 0));
    aggregateMetrics.maximumReplacementRequests = Math.max(aggregateMetrics.maximumReplacementRequests, Number(replacement.requestCount || 0));
    if (requiresPhysicalRepair) {
      aggregateMetrics.exactDuplicateRepairSteps += 1;
      aggregateMetrics.exactDuplicateLogicalRowsRepaired += replacement.exactDuplicateLogicalRows.length;
      aggregateMetrics.exactDuplicateRowsRepaired += replacement.exactDuplicateRowCount;
    }
    return {
      groupIndex: state.replayGroupIndex,
      loadId: group.loadId,
      stage: state.replayStage,
      phase: 'PUBLISH_AGGREGATE_BATCH',
      comboCursor: state.replayItemCursor,
      comboTotal: itemTotal,
      seriesCursor: state.aggregateSeriesCursor,
      seriesTotal: batch.totalSeries,
      seriesPublished: batch.seriesCount,
      candidateSeries: Number(batch.candidateSeries || 0),
      fitEvaluations: Number(batch.fitEvaluations || 0),
      limitReduced: batch.limitReduced === true,
      replacementRows: replacement.replacementRowCount,
      atomicApiCalls: Number(write.apiCalls || 0),
      exactDuplicateRepair: requiresPhysicalRepair,
      exactDuplicateLogicalRowsRepaired: requiresPhysicalRepair ? replacement.exactDuplicateLogicalRows.length : 0,
      exactDuplicateRowsRepaired: requiresPhysicalRepair ? replacement.exactDuplicateRowCount : 0,
      lostResponseNoOp: !requiresPhysicalRepair && replacement.beforeFingerprint === replacement.afterFingerprint
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
    if (caught && caught.details && caught.details.retryable === true) {
      return { kind: 'TRANSIENT', code: code, message: message, retryable: true, delayMs: 300000 };
    }
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
      aggregateItems: state.aggregateItemsWork ? {
        workSchemaVersion: state.aggregateItemsWork.workSchemaVersion || '',
        inventoryId: state.aggregateItemsWork.inventoryId || '',
        loadId: state.aggregateItemsWork.loadId || '',
        groupIndex: Number(state.aggregateItemsWork.groupIndex || 0),
        phase: state.aggregateItemsWork.phase || '',
        sourceCursor: Number(state.aggregateItemsWork.sourceCursor || 0),
        sourceTotal: Number(state.aggregateItemsWork.sourceTotal || 0),
        chunkRows: Number(state.aggregateItemsWork.chunkRows || 0),
        itemCount: Number(state.aggregateItemsWork.itemCount || 0),
        ready: state.aggregateItemsWork.ready === true,
        fingerprint: state.aggregateItemsWork.fingerprint || ''
      } : null,
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
        aggregateItemsWork: null,
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
      var state = buildDurableResumeState_(sourceState, executionId, resumeBoundary);
      saveState_(state);
      state.triggerCount = ensureTrigger_();
      saveState_(state);
      return AKORT.Result.success(
        resumeBoundary.exactDuplicateIncident && resumeBoundary.exactDuplicateIncident.eligible
          ? 'Alpha.7.4 Gate 5 exact-duplicate repair resumed from the preserved durable aggregate batch.'
          : resumeBoundary.periodIdentityIncident && resumeBoundary.periodIdentityIncident.eligible
            ? 'Alpha.7.4 Gate 5 period-identity repair resumed from the preserved durable aggregate batch.'
            : resumeBoundary.performanceResume && resumeBoundary.performanceResume.eligible
              ? state.recovery && state.recovery.mode === 'DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME'
                ? 'Alpha.7.4 Gate 5 durable aggregate-item preparation replay resumed from the preserved checkpoint.'
                : 'Alpha.7.4 Gate 5 adaptive publication-window replay resumed from the preserved durable aggregate boundary.'
          : 'Alpha.7.4 Gate 5 durable aggregate replay resumed from the preserved logical-series boundary.',
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
      candidateStageRecords: candidateStageRecords_,
      rowBlocks: rowBlocks_,
      readAggregateRowsForStage: readAggregateRowsForStage_,
      fitSeriesBatch: fitSeriesBatch_,
      replayContext: replayContext_,
      aggregateItemInventoryIdentity: aggregateItemInventoryIdentity_,
      prepareAggregateItemInventoryStep: prepareAggregateItemInventoryStep_,
      canonicalCell: canonicalCell_,
      classifyError: classifyError_,
      fullBuildStep: fullBuildStep_,
      finalizeReplayStep: finalizeReplayStep_,
      metrics: metrics_,
      assertAggregateReplayProgress: assertAggregateReplayProgress_,
      buildReplayOnlyState: buildReplayOnlyState_,
      buildDurableResumeState: buildDurableResumeState_,
      legacyPartialAdoption: legacyPartialAdoption_,
      exactDuplicateIncident: exactDuplicateIncident_,
      periodIdentityIncident: periodIdentityIncident_,
      performanceResume: performanceResume_,
      durableResumeStateSchemaCompatible: durableResumeStateSchemaCompatible_,
      durableResumeReleaseCompatible: durableResumeReleaseCompatible_
    })
  });
})();
