var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Baseline = (function () {
  var STATE_KEY = 'AKORT_ALPHA1_BASELINE_STATE';
  var LAST_REPORT_KEY = 'AKORT_ALPHA1_LAST_REPORT_ID';
  var REPORT_SHEETS = {
    manifest: 'MANIFEST',
    inventory: 'SHEET_INVENTORY',
    chunks: 'CHUNK_HASHES',
    tests: 'TEST_RESULTS',
    log: 'LOG'
  };

  var REQUIRED_SCHEMAS = {
    RAW_PRICES_WEEKLY: ['observation_id','dataset_code','category_id','value_type','index_type','observation_date','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
    RAW_PRICES_MONTHLY: ['observation_id','dataset_code','category_id','value_type','index_type','observation_month','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
    RAW_INDUSTRY: ['observation_id','series_id','period_start','period_end','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
    PUBLISH_PRICES_WEEKLY: ['dataset_code','source_name','series_id','indicator_key','indicator_name','product_group','category_id','product_name','value_type','index_type','series_type','unit','sort_order','observation_date','year','quarter','month','iso_year','iso_week','period_label','current_value','previous_week_value','wow_abs','wow_pct','previous_year_value','yoy_abs','yoy_pct','december_base_value','december_abs','december_pct','moving_average_4w','ma4_deviation_pct','markup_wow_pp','markup_yoy_pp','markup_december_pp','is_latest_period'],
    PUBLISH_PRICES_MONTHLY: ['dataset_code','source_name','series_id','indicator_key','indicator_name','product_group','category_id','product_name','value_type','index_type','series_type','unit','sort_order','month_start','year','quarter','month','period_label','current_value','previous_month_value','mom_abs','mom_pct','previous_year_value','yoy_abs','yoy_pct','december_base_value','december_abs','december_pct','markup_mom_pp','markup_yoy_pp','markup_december_pp','period_completeness','is_latest_period'],
    PUBLISH_INDUSTRY: ['dataset_code','source_name','series_id','indicator_name','classification_1','classification_2','frequency','unit','sort_order','period_start','period_end','year','quarter','month','period_label','current_value','previous_period_value','period_change_abs','period_change_pct','previous_year_value','yoy_abs','yoy_pct','is_latest_period'],
    PUBLISH_PRICE_AGGREGATES: ['dataset_code','source_name','frequency','aggregate_level','aggregate_id','aggregate_name','category_id','product_group','product_name','value_type','index_type','period_start','year','quarter','month','period_label','category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count','coverage_weight_sum','is_latest_period','aggregate_value','aggregate_base_value']
  };

  function now_() { return new Date().toISOString(); }

  function hashText_(text) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(text),
      Utilities.Charset.UTF_8
    );
    return bytes.map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function serializeCell_(value) {
    if (value === null || value === undefined || value === '') return 'N:';
    if (Object.prototype.toString.call(value) === '[object Date]') return 'D:' + value.toISOString();
    if (typeof value === 'number') return 'F:' + String(value);
    if (typeof value === 'boolean') return 'B:' + (value ? '1' : '0');
    return 'S:' + JSON.stringify(String(value));
  }

  function hashValues_(values) {
    var text = values.map(function (row) {
      return row.map(serializeCell_).join('\\u001f');
    }).join('\\u001e');
    return hashText_(text);
  }

  function appendRows_(sheet, rows) {
    if (!rows || !rows.length) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  function writeKeyValue_(sheet, key, value) {
    appendRows_(sheet, [[key, value === undefined ? '' : value]]);
  }

  function createReport_(config) {
    var stamp = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyyMMdd_HHmmss');
    var report = SpreadsheetApp.create('AKORT_BASELINE_' + config.baselineLabel + '_' + stamp);
    var first = report.getSheets()[0];
    first.setName(REPORT_SHEETS.manifest);
    [REPORT_SHEETS.inventory, REPORT_SHEETS.chunks, REPORT_SHEETS.tests, REPORT_SHEETS.log]
      .forEach(function (name) { report.insertSheet(name); });

    report.getSheetByName(REPORT_SHEETS.manifest).getRange('A1:B1').setValues([['key','value']]).setFontWeight('bold');
    report.getSheetByName(REPORT_SHEETS.inventory).getRange('A1:O1').setValues([[
      'resource_code','spreadsheet_name','sheet_name','sheet_id','sheet_index','last_row','last_column',
      'data_rows','header_hash','data_hash','chunk_count','latest_true_count','schema_status','status','finished_at'
    ]]).setFontWeight('bold');
    report.getSheetByName(REPORT_SHEETS.chunks).getRange('A1:G1').setValues([[
      'resource_code','sheet_name','start_row','end_row','row_count','column_count','chunk_hash'
    ]]).setFontWeight('bold');
    report.getSheetByName(REPORT_SHEETS.tests).getRange('A1:H1').setValues([[
      'test_id','severity','status','expected','actual','message','checked_at','release'
    ]]).setFontWeight('bold');
    report.getSheetByName(REPORT_SHEETS.log).getRange('A1:F1').setValues([[
      'timestamp','level','execution_id','context','message','details_json'
    ]]).setFontWeight('bold');

    var file = DriveApp.getFileById(report.getId());
    file.moveTo(DriveApp.getFolderById(config.resources.testResultsFolderId));
    return report;
  }

  function initializeState_(report, config) {
    var state = {
      version: AKORT.Release.version,
      baselineLabel: config.baselineLabel,
      reportId: report.getId(),
      status: 'RUNNING',
      targets: [
        { code: 'DWH', spreadsheetId: config.resources.dwhSpreadsheetId },
        { code: 'PUBLISH', spreadsheetId: config.resources.publishSpreadsheetId }
      ],
      targetIndex: 0,
      sheetIndex: 0,
      nextRow: 2,
      inventoryRow: null,
      chunkStartRow: null,
      chunkCount: 0,
      latestTrueCount: 0,
      startedAt: now_(),
      updatedAt: now_()
    };
    var manifest = report.getSheetByName(REPORT_SHEETS.manifest);
    writeKeyValue_(manifest, 'release', AKORT.Release.version);
    writeKeyValue_(manifest, 'baseline_label', config.baselineLabel);
    writeKeyValue_(manifest, 'environment', config.environment);
    writeKeyValue_(manifest, 'script_id', ScriptApp.getScriptId());
    writeKeyValue_(manifest, 'created_at', state.startedAt);
    writeKeyValue_(manifest, 'status', state.status);
    writeKeyValue_(manifest, 'dwh_name', SpreadsheetApp.openById(config.resources.dwhSpreadsheetId).getName());
    writeKeyValue_(manifest, 'publish_name', SpreadsheetApp.openById(config.resources.publishSpreadsheetId).getName());
    return state;
  }

  function saveState_(state) {
    state.updatedAt = now_();
    PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state));
  }

  function loadState_() {
    var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function schemaStatus_(sheetName, headers) {
    var expected = REQUIRED_SCHEMAS[sheetName];
    if (!expected) return 'NOT_APPLICABLE';
    return JSON.stringify(headers) === JSON.stringify(expected) ? 'PASS' : 'FAIL';
  }

  function countTruthy_(values, columnIndex) {
    if (columnIndex < 0) return 0;
    return values.reduce(function (count, row) {
      var value = row[columnIndex];
      return count + ((value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE') ? 1 : 0);
    }, 0);
  }

  function finishSheet_(report, state, sheet, headers) {
    var chunks = report.getSheetByName(REPORT_SHEETS.chunks);
    var hashes = [];
    if (state.chunkCount > 0) {
      hashes = chunks.getRange(state.chunkStartRow, 7, state.chunkCount, 1).getValues().map(function (row) { return row[0]; });
    }
    var finalHash = hashText_(hashes.join('|'));
    var inventory = report.getSheetByName(REPORT_SHEETS.inventory);
    inventory.getRange(state.inventoryRow, 10, 1, 6).setValues([[
      finalHash,
      state.chunkCount,
      state.latestTrueCount,
      schemaStatus_(sheet.getName(), headers),
      'COMPLETE',
      now_()
    ]]);
    state.sheetIndex += 1;
    state.nextRow = 2;
    state.inventoryRow = null;
    state.chunkStartRow = null;
    state.chunkCount = 0;
    state.latestTrueCount = 0;
    saveState_(state);
  }

  function process_(state, config, logger) {
    var report = SpreadsheetApp.openById(state.reportId);
    var started = Date.now();
    var budget = config.baseline.executionBudgetMs;
    var chunkRows = config.baseline.chunkRows;

    while (state.targetIndex < state.targets.length && Date.now() - started < budget) {
      var target = state.targets[state.targetIndex];
      var source = SpreadsheetApp.openById(target.spreadsheetId);
      var sheets = source.getSheets();

      if (state.sheetIndex >= sheets.length) {
        state.targetIndex += 1;
        state.sheetIndex = 0;
        state.nextRow = 2;
        saveState_(state);
        continue;
      }

      var sheet = sheets[state.sheetIndex];
      var lastRow = sheet.getLastRow();
      var lastColumn = sheet.getLastColumn();
      var headers = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String) : [];
      var latestColumn = headers.indexOf('is_latest_period');
      if (latestColumn < 0) latestColumn = headers.indexOf('is_latest');

      if (!state.inventoryRow) {
        var inventory = report.getSheetByName(REPORT_SHEETS.inventory);
        state.inventoryRow = inventory.getLastRow() + 1;
        state.chunkStartRow = report.getSheetByName(REPORT_SHEETS.chunks).getLastRow() + 1;
        appendRows_(inventory, [[
          target.code, source.getName(), sheet.getName(), sheet.getSheetId(), state.sheetIndex,
          lastRow, lastColumn, Math.max(0, lastRow - 1), hashValues_([headers]), '', 0, 0,
          schemaStatus_(sheet.getName(), headers), 'PROCESSING', ''
        ]]);
        saveState_(state);
      }

      if (lastRow < 2 || lastColumn < 1 || state.nextRow > lastRow) {
        finishSheet_(report, state, sheet, headers);
        continue;
      }

      var endRow = Math.min(lastRow, state.nextRow + chunkRows - 1);
      var values = sheet.getRange(state.nextRow, 1, endRow - state.nextRow + 1, lastColumn).getValues();
      var chunkHash = hashValues_(values);
      appendRows_(report.getSheetByName(REPORT_SHEETS.chunks), [[
        target.code, sheet.getName(), state.nextRow, endRow, values.length, lastColumn, chunkHash
      ]]);
      state.chunkCount += 1;
      state.latestTrueCount += countTruthy_(values, latestColumn);
      state.nextRow = endRow + 1;
      saveState_(state);
    }

    appendRows_(report.getSheetByName(REPORT_SHEETS.log), logger.rows());

    if (state.targetIndex >= state.targets.length) {
      return finalize_(report, state, config);
    }
    state.status = 'PAUSED';
    saveState_(state);
    updateManifestStatus_(report, 'PAUSED');
    return AKORT.Result.paused(
      'Baseline scan paused at a safe checkpoint. Run AKORT_alpha1ContinueBaseline again.',
      status_()
    );
  }

  function updateManifestStatus_(report, value) {
    var sheet = report.getSheetByName(REPORT_SHEETS.manifest);
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i += 1) {
      if (values[i][0] === 'status') {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    writeKeyValue_(sheet, 'status', value);
  }

  function testRow_(id, severity, expected, actual, message) {
    return [
      id, severity, String(expected) === String(actual) ? 'PASS' : 'FAIL',
      expected, actual, message || '', now_(), AKORT.Release.version
    ];
  }

  function finalize_(report, state, config) {
    var inventoryValues = report.getSheetByName(REPORT_SHEETS.inventory).getDataRange().getValues();
    var header = inventoryValues[0];
    var rows = inventoryValues.slice(1);
    var idx = {};
    header.forEach(function (name, i) { idx[name] = i; });

    function dataRowsFor_(names) {
      return rows.filter(function (row) { return names.indexOf(row[idx.sheet_name]) >= 0; })
        .reduce(function (sum, row) { return sum + Number(row[idx.data_rows] || 0); }, 0);
    }
    function latestFor_(name) {
      var row = rows.filter(function (item) { return item[idx.sheet_name] === name; })[0];
      return row ? Number(row[idx.latest_true_count] || 0) : -1;
    }
    function schemaFor_(name) {
      var row = rows.filter(function (item) { return item[idx.sheet_name] === name; })[0];
      return row ? row[idx.schema_status] : 'MISSING';
    }

    var expected = config.baselineExpected;
    var tests = [
      testRow_('BASELINE_RAW_ROWS', 'CRITICAL', expected.rawObservationRows,
        dataRowsFor_(['RAW_PRICES_WEEKLY','RAW_PRICES_MONTHLY','RAW_INDUSTRY']),
        'Total current RAW observation rows'),
      testRow_('BASELINE_PUBLISH_MAIN_ROWS', 'CRITICAL', expected.publishMainRows,
        dataRowsFor_(['PUBLISH_PRICES_WEEKLY','PUBLISH_PRICES_MONTHLY','PUBLISH_INDUSTRY']),
        'Total non-aggregate Publish rows'),
      testRow_('BASELINE_AGGREGATE_ROWS', 'CRITICAL', expected.aggregateRows,
        dataRowsFor_(['PUBLISH_PRICE_AGGREGATES']),
        'Aggregate Publish rows'),
      testRow_('LATEST_WEEKLY_ROWS', 'CRITICAL', expected.weeklyLatestRows,
        latestFor_('PUBLISH_PRICES_WEEKLY'), 'Weekly latest-period flags'),
      testRow_('LATEST_MONTHLY_ROWS', 'CRITICAL', expected.monthlyLatestRows,
        latestFor_('PUBLISH_PRICES_MONTHLY'), 'Monthly latest-period flags'),
      testRow_('LATEST_AGGREGATE_ROWS', 'CRITICAL', expected.aggregateLatestRows,
        latestFor_('PUBLISH_PRICE_AGGREGATES'), 'Aggregate latest-period flags')
    ];

    Object.keys(REQUIRED_SCHEMAS).forEach(function (sheetName) {
      tests.push(testRow_('SCHEMA_' + sheetName, 'CRITICAL', 'PASS', schemaFor_(sheetName), 'Exact header schema'));
    });

    appendRows_(report.getSheetByName(REPORT_SHEETS.tests), tests);
    var overall = tests.every(function (row) { return row[2] === 'PASS'; }) ? 'PASS' : 'FAIL';
    state.status = overall;
    state.completedAt = now_();
    saveState_(state);
    updateManifestStatus_(report, overall);
    writeKeyValue_(report.getSheetByName(REPORT_SHEETS.manifest), 'completed_at', state.completedAt);
    writeKeyValue_(report.getSheetByName(REPORT_SHEETS.manifest), 'report_url', report.getUrl());
    PropertiesService.getScriptProperties().setProperty(LAST_REPORT_KEY, report.getId());
    PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
    return overall === 'PASS'
      ? AKORT.Result.success('Baseline snapshot completed and all alpha.1 controls passed.', { reportId: report.getId(), reportUrl: report.getUrl(), status: overall })
      : AKORT.Result.failure('BASELINE_MISMATCH', 'Baseline snapshot completed with failed controls.', { reportId: report.getId(), reportUrl: report.getUrl(), status: overall });
  }

  function start() {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      AKORT.EnvironmentGuard.assertDev();
      var existing = loadState_();
      if (existing) throw new Error('An alpha.1 baseline operation is already active. Continue or reset it.');
      var config = AKORT.Config.load();
      var report = createReport_(config);
      var state = initializeState_(report, config);
      saveState_(state);
      var logger = AKORT.Logger.create('BASELINE_START');
      logger.info('Baseline snapshot started', { reportId: report.getId() });
      return process_(state, config, logger);
    } finally {
      lock.releaseLock();
    }
  }

  function continueRun() {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      AKORT.EnvironmentGuard.assertDev();
      var state = loadState_();
      if (!state) return AKORT.Result.failure('NO_ACTIVE_BASELINE', 'No active baseline operation was found.');
      state.status = 'RUNNING';
      saveState_(state);
      var logger = AKORT.Logger.create('BASELINE_CONTINUE');
      logger.info('Baseline snapshot resumed', status_());
      return process_(state, AKORT.Config.load(), logger);
    } finally {
      lock.releaseLock();
    }
  }

  function status_() {
    var state = loadState_();
    var lastReportId = PropertiesService.getScriptProperties().getProperty(LAST_REPORT_KEY);
    return {
      active: Boolean(state),
      state: state,
      lastReportId: lastReportId || null,
      lastReportUrl: lastReportId ? 'https://docs.google.com/spreadsheets/d/' + lastReportId + '/edit' : null
    };
  }

  function reset() {
    PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
    return AKORT.Result.success('Active alpha.1 baseline state cleared. Existing report files were not deleted.', status_());
  }

  return {
    start: start,
    continueRun: continueRun,
    status: status_,
    reset: reset,
    hashTextForTest: hashText_,
    hashValuesForTest: hashValues_
  };
})();
