var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * v4.0.0-alpha.6 Incremental Publish.
 * The calculation kernel is a DEV-only namespaced adaptation of the verified 3.1.7 methodology.
 * Production spreadsheet and folder identifiers are intentionally absent.
 */
AKORT.IncrementalPublish = (function () {

  var ALPHA6_PUBLISH_OVERRIDE_ID = '';
  var ALPHA6_REPLAY_ALLOWED_LOADS = null;
  var ALPHA6_REPLAY_REVERSED_LOADS = null;
  var ALPHA6_SCOPE = Object.freeze({
    aggregateExecutionEnabled: false,
    aggregateExecutionStatus: 'DEFERRED_TO_ALPHA7',
    acceptanceSheets: Object.freeze(['PUBLISH_PRICES_WEEKLY','PUBLISH_PRICES_MONTHLY','PUBLISH_INDUSTRY']),
    plannedSheets: Object.freeze(['PUBLISH_PRICE_AGGREGATES']),
    replayFrontierMode: 'EXISTING_PERIODS_ONLY'
  });
  var ALPHA6_IMPACT_JSON_MAX_CHARS = 30000;
  var AKORT_V300 = Object.freeze({
    VERSION: '4.0.0-alpha.6',
    TIMEZONE: 'Europe/Moscow',
    DATASETS: Object.freeze({
      ROSSTAT_WEEKLY: 'ROSSTAT_WEEKLY',
      AKORT_WEEKLY: 'AKORT_WEEKLY',
      ROSSTAT_MONTHLY: 'ROSSTAT_MONTHLY',
      AKORT_MONTHLY: 'AKORT_MONTHLY',
      AKORT_MONTHLY_DERIVED: 'AKORT_MONTHLY_DERIVED',
      INDUSTRY: 'INDUSTRY'
    }),
    SHEETS: Object.freeze({
      STATUS: 'STATUS', CONFIG: 'CONFIG', DIM_PRODUCTS: 'DIM_PRODUCTS',
      DIM_PRODUCT_MAPPING: 'DIM_PRODUCT_MAPPING', DIM_INDUSTRY_SERIES: 'DIM_INDUSTRY_SERIES',
      RAW_PRICES_WEEKLY: 'RAW_PRICES_WEEKLY', RAW_PRICES_MONTHLY: 'RAW_PRICES_MONTHLY',
      RAW_CATEGORY_WEIGHTS: 'RAW_CATEGORY_WEIGHTS', RAW_INDUSTRY: 'RAW_INDUSTRY',
      PUBLISH_PRICES_WEEKLY: 'PUBLISH_PRICES_WEEKLY', PUBLISH_PRICES_MONTHLY: 'PUBLISH_PRICES_MONTHLY',
      PUBLISH_INDUSTRY: 'PUBLISH_INDUSTRY', PUBLISH_PRICE_AGGREGATES: 'PUBLISH_PRICE_AGGREGATES'
    }),
    HEADERS: Object.freeze({
      DIM_PRODUCTS: ['category_id','product_group','product_name','unit','sort_order','is_active'],
      DIM_PRODUCT_MAPPING: ['mapping_id','dataset_code','source_category_id','category_id','source_product_name','comparison_level','is_comparable','valid_from','valid_to','value_type','source_file_type','index_source','aggregation_method','aggregation_group','mapping_priority','mapping_comment','is_active'],
      DIM_INDUSTRY_SERIES: ['series_id','indicator_id','indicator_name','classification_1','classification_2','frequency','period_basis','metric_type','unit','source_name','source_url','sort_order','is_active'],
      RAW_PRICES_WEEKLY: ['observation_id','dataset_code','category_id','value_type','index_type','observation_date','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
      RAW_PRICES_MONTHLY: ['observation_id','dataset_code','category_id','value_type','index_type','observation_month','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
      RAW_CATEGORY_WEIGHTS: ['weight_id','source_code','category_id','product_group','product_name','weight_year','weight_scope','weight_value','raw_weight_value','sales_value','allocation_factor','loaded_at','load_id'],
      RAW_INDUSTRY: ['observation_id','series_id','period_start','period_end','value','version_no','revision_type','is_latest','source_published_at','loaded_at','load_id'],
      PUBLISH_PRICES_WEEKLY: ['dataset_code','source_name','series_id','indicator_key','indicator_name','product_group','category_id','product_name','value_type','index_type','series_type','unit','sort_order','observation_date','year','quarter','month','iso_year','iso_week','period_label','current_value','previous_week_value','wow_abs','wow_pct','previous_year_value','yoy_abs','yoy_pct','december_base_value','december_abs','december_pct','moving_average_4w','ma4_deviation_pct','markup_wow_pp','markup_yoy_pp','markup_december_pp','is_latest_period'],
      PUBLISH_PRICES_MONTHLY: ['dataset_code','source_name','series_id','indicator_key','indicator_name','product_group','category_id','product_name','value_type','index_type','series_type','unit','sort_order','month_start','year','quarter','month','period_label','current_value','previous_month_value','mom_abs','mom_pct','previous_year_value','yoy_abs','yoy_pct','december_base_value','december_abs','december_pct','markup_mom_pp','markup_yoy_pp','markup_december_pp','period_completeness','is_latest_period'],
      PUBLISH_INDUSTRY: ['dataset_code','source_name','series_id','indicator_name','classification_1','classification_2','frequency','unit','sort_order','period_start','period_end','year','quarter','month','period_label','current_value','previous_period_value','period_change_abs','period_change_pct','previous_year_value','yoy_abs','yoy_pct','is_latest_period'],
      PUBLISH_PRICE_AGGREGATES: ['dataset_code','source_name','frequency','aggregate_level','aggregate_id','aggregate_name','category_id','product_group','product_name','value_type','index_type','period_start','year','quarter','month','period_label','category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count','coverage_weight_sum','is_latest_period','aggregate_value','aggregate_base_value']
    })
  });

  function v300Tech_() { return SpreadsheetApp.openById(AKORT.Config.load({includeSystemSettings:false}).resources.dwhSpreadsheetId); }
  function v300Publish_() {
    var id = ALPHA6_PUBLISH_OVERRIDE_ID || AKORT.Config.load({includeSystemSettings:false}).resources.publishSpreadsheetId;
    return SpreadsheetApp.openById(id);
  }
  function v300Legacy_() { throw new Error('Legacy spreadsheet access is disabled in alpha.6.'); }

function v300Text_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
function v300Norm_(value) {
  return v300Text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}
function v300Number_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return isFinite(number) ? number : null;
}
function v300Int_(value) {
  const number = v300Number_(value);
  return number === null ? null : Math.round(number);
}
function v300Bool01_(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === null || value === undefined || value === '') return 0;
  // Google Sheets may return Date objects when a numeric 1 was accidentally stored
  // in a date-formatted column. In that case the visible value is 1899-12-31 or
  // 1899-12-30 depending on timezone; treat only these serial-date artifacts as 1.
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = value.getMonth();
    const d = value.getDate();
    if (y === 1899 && m === 11 && (d === 30 || d === 31)) return 1;
    return 0;
  }
  if (typeof value === 'number' && isFinite(value)) return Math.round(value) === 1 ? 1 : 0;
  const n = v300Norm_(value);
  if (['1', 'true', 'yes', 'y', 'да', 'истина', 'активно', 'active'].indexOf(n) >= 0) return 1;
  return 0;
}
function v300Date_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'number' && isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(date.getTime()) ? null : date;
  }
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}
function v300Noon_(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}
function v300DateOnly_(value) {
  const d = v300Date_(value);
  return d ? v300Noon_(d.getFullYear(), d.getMonth(), d.getDate()) : null;
}
function v300MonthStart_(value) {
  const d = v300Date_(value);
  return d ? v300Noon_(d.getFullYear(), d.getMonth(), 1) : null;
}
function v300MonthEnd_(value) {
  const d = v300Date_(value);
  return d ? v300Noon_(d.getFullYear(), d.getMonth() + 1, 0) : null;
}
function v300DateKey_(value) {
  const d = v300Date_(value);
  return d ? Utilities.formatDate(d, AKORT_V300.TIMEZONE, 'yyyy-MM-dd') : '';
}
function v300MonthKey_(value) {
  const d = v300Date_(value);
  return d ? Utilities.formatDate(d, AKORT_V300.TIMEZONE, 'yyyy-MM') : '';
}
function v300Pad2_(value) {
  return ('0' + Number(value)).slice(-2);
}
function v300Quarter_(month) {
  return Math.floor((Number(month) - 1) / 3) + 1;
}
function v300Iso_(value) {
  const d = v300DateOnly_(value);
  if (!d) return {year: '', week: ''};
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return {year: utc.getUTCFullYear(), week: Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)};
}
function v300Hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join('');
}
function v300Id_(prefix, value) {
  return prefix + '_' + v300Hash_(value).slice(0, 20).toUpperCase();
}
function v300OperationId_(prefix) {
  return prefix + '_' + Utilities.formatDate(new Date(), AKORT_V300.TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000);
}
function v300HeaderIndex_(headers) {
  const result = {};
  headers.forEach(function (header, index) { result[v300Text_(header)] = index; });
  return result;
}
function v300ReadObjects_(sheet, expectedHeaders) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, expectedHeaders ? expectedHeaders.length : sheet.getLastColumn()).getValues()[0].map(v300Text_);
  const index = v300HeaderIndex_(headers);
  if (expectedHeaders) expectedHeaders.forEach(function (header) {
    if (index[header] === undefined) throw new Error(sheet.getName() + ': отсутствует столбец ' + header + '.');
  });
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (row, offset) {
    const object = {_rowNumber: offset + 2};
    headers.forEach(function (header, column) { object[header] = row[column]; });
    return object;
  });
}
function v300ObjectsToRows_(objects, headers) {
  return objects.map(function (object) { return headers.map(function (header) { return object[header] === undefined ? '' : object[header]; }); });
}
function v300EnsureSheet_(ss, name, headers, rows, columns) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const requiredColumns = Math.max(headers ? headers.length : 1, columns || 1);
  if (sheet.getMaxColumns() < requiredColumns) sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  const requiredRows = Math.max(rows || 2, 2);
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  if (headers) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    v300StyleHeader_(sheet, headers.length);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function v300StyleHeader_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#0E766E').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
}
function v300WriteTable_(ss, sheetName, headers, rows, formats) {
  const sheet = v300EnsureSheet_(ss, sheetName, headers, rows.length + 1, headers.length);
  if (sheet.getLastRow() > 1) {
    // В 3.0.3 очищаем не только значения, но и старые форматы строк данных.
    // Это предотвращает перенос date-формата на sort_order после изменения схемы Publish.
    sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), headers.length))
      .clearContent()
      .clearFormat();
  }
  const chunk = 1000;
  for (let start = 0; start < rows.length; start += chunk) {
    const part = rows.slice(start, start + chunk);
    sheet.getRange(start + 2, 1, part.length, headers.length).setValues(part);
  }
  if (formats) v300ApplyFormats_(sheet, formats);
  return rows.length;
}
function v300AppendRows_(sheet, headers, rows) {
  if (!rows.length) return 0;
  v300EnsureSheet_(sheet.getParent(), sheet.getName(), headers, sheet.getLastRow() + rows.length + 1, headers.length);
  const start = Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}
function v300ApplyFormats_(sheet, formats) {
  Object.keys(formats).forEach(function (column) {
    const count = Math.max(1, sheet.getMaxRows() - 1);
    sheet.getRange(2, Number(column), count, 1).setNumberFormat(formats[column]);
  });
}
function v300DeleteRows_(ss, sheet, rowNumbers) {
  if (!rowNumbers.length) return;
  const sorted = rowNumbers.slice().sort(function (a, b) { return a - b; });
  const groups = [];
  let start = sorted[0], previous = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === previous + 1) { previous = sorted[i]; continue; }
    groups.push([start, previous]); start = previous = sorted[i];
  }
  groups.push([start, previous]);
  const requests = groups.sort(function (a, b) { return b[0] - a[0]; }).map(function (group) {
    return {deleteDimension: {range: {sheetId: sheet.getSheetId(), dimension: 'ROWS', startIndex: group[0] - 1, endIndex: group[1]}}};
  });
  Sheets.Spreadsheets.batchUpdate({requests: requests}, ss.getId());
}
function v300UpsertByKey_(ss, sheetName, headers, objects, keyHeader, formats) {
  const sheet = v300EnsureSheet_(ss, sheetName, headers, 2, headers.length);
  const existing = v300ReadObjects_(sheet, headers);
  const map = {};
  existing.forEach(function (row) { map[v300Text_(row[keyHeader])] = row; });
  objects.forEach(function (row) { map[v300Text_(row[keyHeader])] = row; });
  const merged = Object.keys(map).filter(Boolean).map(function (key) { return map[key]; });
  return v300WriteTable_(ss, sheetName, headers, v300ObjectsToRows_(merged, headers), formats);
}
function v300ReadConfig_() {
  const ss = v300Tech_();
  const sheet = ss.getSheetByName(AKORT_V300.SHEETS.CONFIG);
  const result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function (row) {
    const key = v300Text_(row[0]); if (key) result[key] = row[1];
  });
  return result;
}
function v300Log_(operationId, operationType, startedAt, finishedAt, status, datasetCode, fileName, rowsAffected, message) {
  const ss = v300Tech_();
  const headers = AKORT_V300.HEADERS.ETL_LOG;
  const sheet = v300EnsureSheet_(ss, AKORT_V300.SHEETS.ETL_LOG, headers, 2, headers.length);
  v300AppendRows_(sheet, headers, [[operationId, operationType, startedAt || new Date(), finishedAt || '', status,
    datasetCode || '', fileName || '', rowsAffected || 0, message || '', AKORT_V300.VERSION]]);
}
function v300GetOperation_() {
  const text = PropertiesService.getDocumentProperties().getProperty(AKORT_V300.OPERATION_PROPERTY);
  return text ? JSON.parse(text) : null;
}
function v300SetOperation_(operation) {
  operation.heartbeatAt = new Date().toISOString();
  PropertiesService.getDocumentProperties().setProperty(AKORT_V300.OPERATION_PROPERTY, JSON.stringify(operation));
}
function v300ClearOperation_() {
  PropertiesService.getDocumentProperties().deleteProperty(AKORT_V300.OPERATION_PROPERTY);
  v300DeleteTriggers_(AKORT_V300.WORKER_FUNCTION);
}
function v300DeleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (!handler || trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
}
function v300ScheduleWorker_(delayMs) {
  v300DeleteTriggers_(AKORT_V300.WORKER_FUNCTION);
  ScriptApp.newTrigger(AKORT_V300.WORKER_FUNCTION).timeBased().after(Math.max(1000, delayMs || 1000)).create();
}
function v300SourceName_(datasetCode) {
  return String(datasetCode).indexOf('AKORT') === 0 ? 'АКОРТ' :
    String(datasetCode).indexOf('ROSSTAT') === 0 ? 'Росстат' : 'Росстат / ЕМИСС / ФНС';
}
function v300ValueType_(value) {
  const n = v300Norm_(value);
  if (['retail', 'розница', 'розничная', 'потребительская цена'].indexOf(n) >= 0) return 'розница';
  if (['purchase', 'закупка', 'закупочная', 'приобретение', 'цена приобретения'].indexOf(n) >= 0) return 'закупка';
  if (['producer', 'производитель', 'производственная', 'цена производителя'].indexOf(n) >= 0) return 'производитель';
  if (['markup_abs', 'наценка руб', 'наценка, руб.', 'наценка руб.'].indexOf(n) >= 0) return 'наценка, руб.';
  if (['markup_pct', 'markup_percent', 'наценка %', 'наценка, %'].indexOf(n) >= 0) return 'наценка, %';
  if (['cpi', 'ипц', 'индекс потребительских цен'].indexOf(n) >= 0) return 'ИПЦ';
  if (['ppi', 'индекс цен производителей', 'индекс производителя'].indexOf(n) >= 0) return 'Индекс цен производителей';
  if (['purchase_price_index', 'индекс цен приобретения', 'индекс цен приобретения организаций розничной торговли'].indexOf(n) >= 0) return 'Индекс цен приобретения';
  return v300Text_(value);
}

function v300PriceType_(value) {
  // Backward-compatible alias. Since v3.0.2 the canonical column name is value_type.
  return v300ValueType_(value);
}
function v300IndicatorName_(valueType) {
  switch (v300ValueType_(valueType)) {
    case 'розница': return 'Розничная цена';
    case 'закупка': return 'Закупочная цена';
    case 'производитель': return 'Цена производителя';
    case 'наценка, руб.': return 'Наценка, руб.';
    case 'наценка, %': return 'Наценка, %';
    case 'ИПЦ': return 'Индекс потребительских цен';
    case 'Индекс цен производителей': return 'Индекс цен производителей';
    case 'Индекс цен приобретения': return 'Индекс цен приобретения';
    default: return v300Text_(valueType);
  }
}
function v300ValueUnit_(baseUnit, valueType) {
  const type = v300ValueType_(valueType);
  if (type === 'наценка, %') return '%';
  if (type === 'ИПЦ' || type === 'Индекс цен производителей' || type === 'Индекс цен приобретения') return '%';
  const unit = v300Text_(baseUnit);
  if (!unit) return 'руб.';
  if (/руб/i.test(unit)) return unit;
  return unit === 'ед.' ? 'руб./ед.' : 'руб./' + unit.replace(/^за\s+/i, '');
}

function v300PriceUnit_(baseUnit, valueType) {
  // Backward-compatible alias. Since v3.0.2 the canonical column name is value_type.
  return v300ValueUnit_(baseUnit, valueType);
}
function v300Round_(value, digits) {
  if (value === null || value === undefined || value === '' || !isFinite(Number(value))) return '';
  const p = Math.pow(10, digits === undefined ? 6 : digits);
  return Math.round(Number(value) * p) / p;
}
function v300Pct_(current, previous) {
  if (current === '' || previous === '' || current === null || previous === null || Number(previous) === 0) return '';
  return v300Round_((Number(current) / Number(previous) - 1) * 100, 6);
}
function v300SeriesId_(datasetCode, categoryId, valueType, seriesType, indexType) {
  return v300Id_('SER', [datasetCode, categoryId, v300ValueType_(valueType), seriesType, v300IndexType_(indexType || '')].join('|'));
}

function v300IndicatorKey_(datasetCode, valueType, seriesType) {
  const dataset = v300Text_(datasetCode);
  const type = v300ValueType_(valueType);
  const series = v300Text_(seriesType);
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_WEEKLY && series === 'OFFICIAL_WEEKLY' && type === 'розница') return 'ROSSTAT_WEEKLY_RETAIL';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_WEEKLY && series === 'OFFICIAL_WEEKLY_INDEX' && type === 'ИПЦ') return 'ROSSTAT_WEEKLY_CPI';
  if (dataset === AKORT_V300.DATASETS.AKORT_WEEKLY && series === 'OFFICIAL_WEEKLY' && type === 'розница') return 'AKORT_WEEKLY_RETAIL';
  if (dataset === AKORT_V300.DATASETS.AKORT_WEEKLY && series === 'OFFICIAL_WEEKLY' && type === 'закупка') return 'AKORT_WEEKLY_PURCHASE';
  if (dataset === AKORT_V300.DATASETS.AKORT_WEEKLY && series === 'CALCULATED_MARKUP' && type === 'наценка, руб.') return 'AKORT_WEEKLY_MARKUP_ABS';
  if (dataset === AKORT_V300.DATASETS.AKORT_WEEKLY && series === 'CALCULATED_MARKUP' && type === 'наценка, %') return 'AKORT_WEEKLY_MARKUP_PCT';

  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && series === 'OFFICIAL_MONTHLY' && type === 'розница') return 'ROSSTAT_MONTHLY_RETAIL';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && series === 'OFFICIAL_MONTHLY' && type === 'закупка') return 'ROSSTAT_MONTHLY_PURCHASE';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && series === 'OFFICIAL_MONTHLY' && type === 'производитель') return 'ROSSTAT_MONTHLY_PRODUCER';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && (series === 'OFFICIAL_MONTHLY' || series === 'OFFICIAL_MONTHLY_INDEX') && type === 'ИПЦ') return 'ROSSTAT_CPI_MONTHLY';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && (series === 'OFFICIAL_MONTHLY' || series === 'OFFICIAL_MONTHLY_INDEX') && type === 'Индекс цен производителей') return 'ROSSTAT_PPI_MONTHLY';
  if (dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && (series === 'OFFICIAL_MONTHLY' || series === 'OFFICIAL_MONTHLY_INDEX') && type === 'Индекс цен приобретения') return 'ROSSTAT_PURCHASE_PRICE_INDEX_MONTHLY';

  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY && series === 'OFFICIAL_MONTHLY' && type === 'розница') return 'AKORT_MONTHLY_RETAIL';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY && series === 'OFFICIAL_MONTHLY' && type === 'закупка') return 'AKORT_MONTHLY_PURCHASE';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY && series === 'CALCULATED_MARKUP' && type === 'наценка, руб.') return 'AKORT_MONTHLY_MARKUP_ABS';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY && series === 'CALCULATED_MARKUP' && type === 'наценка, %') return 'AKORT_MONTHLY_MARKUP_PCT';

  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED && series === 'DERIVED_FROM_WEEKLY' && type === 'розница') return 'AKORT_DERIVED_MONTHLY_RETAIL';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED && series === 'DERIVED_FROM_WEEKLY' && type === 'закупка') return 'AKORT_DERIVED_MONTHLY_PURCHASE';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED && series === 'CALCULATED_MARKUP' && type === 'наценка, руб.') return 'AKORT_DERIVED_MONTHLY_MARKUP_ABS';
  if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED && series === 'CALCULATED_MARKUP' && type === 'наценка, %') return 'AKORT_DERIVED_MONTHLY_MARKUP_PCT';

  return v300Text_(dataset + '_' + series + '_' + type).replace(/[^A-Za-zА-Яа-я0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function v300IsMarkupValueType_(valueType) {
  const type = v300ValueType_(valueType);
  return type === 'наценка, руб.' || type === 'наценка, %';
}

function v300IsMarkupPctValueType_(valueType) {
  return v300ValueType_(valueType) === 'наценка, %';
}

function v300IsMarkupAbsValueType_(valueType) {
  return v300ValueType_(valueType) === 'наценка, руб.';
}

function v300IsPriceLevelValueType_(valueType) {
  const type = v300ValueType_(valueType);
  return type === 'розница' || type === 'закупка' || type === 'производитель';
}

function v300IsIndexValueType_(valueType) {
  const type = v300ValueType_(valueType);
  return type === 'ИПЦ' || type === 'Индекс цен производителей' || type === 'Индекс цен приобретения';
}
function v300IndexType_(value) {
  const n = v300Norm_(value);
  if (!n) return '';
  if (['wow', 'к предыдущей дате регистрации', 'к предыдущей неделе', 'к предыдущему периоду'].indexOf(n) >= 0) return 'wow';
  if (['mom', 'к предыдущему месяцу', 'месяц к месяцу'].indexOf(n) >= 0) return 'mom';
  if (['december', 'dec', 'к декабрю предыдущего года', 'к декабрю'].indexOf(n) >= 0) return 'december';
  if (['yoy', 'к соответствующему месяцу предыдущего года', 'к соответствующему периоду предыдущего года', 'год к году'].indexOf(n) >= 0) return 'yoy';
  if (['ytd', 'за период с начала года к соответствующему периоду предыдущего года'].indexOf(n) >= 0) return 'ytd';
  return v300Text_(value);
}
function v300IsAllowedIndexType_(value, weekly) {
  const type = v300IndexType_(value);
  return weekly ? type === 'wow' : ['mom', 'december', 'yoy'].indexOf(type) >= 0;
}
function v300NormalizeProductName_(value) {
  return v300Norm_(value)
    .replace(/\(уп\.\)/g, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+%/g, '%')
    .replace(/2,\s*5/g, '2,5')
    .replace(/3,\s*2/g, '3,2')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/\.$/, '')
    .trim();
}
function v304FileChecksum_(file) {
  return v300Hash_([file.getId(), file.getName(), file.getSize(), file.getLastUpdated().toISOString()].join('|'));
}
function v300FormatByHeaders_(headers, fieldFormats) {
  const result = {};
  const idx = v300HeaderIndex_(headers);
  Object.keys(fieldFormats).forEach(function(field) {
    if (idx[field] !== undefined) result[idx[field] + 1] = fieldFormats[field];
  });
  return result;
}

function v300FormatRows_() {
  return {
    rawWeekly: v300FormatByHeaders_(AKORT_V300.HEADERS.RAW_PRICES_WEEKLY, {
      observation_date:'yyyy-mm-dd', value:'0.000000', version_no:'0', is_latest:'0',
      source_published_at:'yyyy-mm-dd hh:mm:ss', loaded_at:'yyyy-mm-dd hh:mm:ss'
    }),
    rawMonthly: v300FormatByHeaders_(AKORT_V300.HEADERS.RAW_PRICES_MONTHLY, {
      observation_month:'yyyy-mm-dd', value:'0.000000', version_no:'0', is_latest:'0',
      source_published_at:'yyyy-mm-dd hh:mm:ss', loaded_at:'yyyy-mm-dd hh:mm:ss'
    }),
    rawIndustry: {3:'yyyy-mm-dd',4:'yyyy-mm-dd',5:'0.000000',6:'0',8:'0',9:'yyyy-mm-dd hh:mm:ss',10:'yyyy-mm-dd hh:mm:ss'},
    rawCategoryWeights: v300FormatByHeaders_(AKORT_V300.HEADERS.RAW_CATEGORY_WEIGHTS, {
      weight_year:'0', weight_value:'0.0000000000', raw_weight_value:'0.000000',
      sales_value:'0.00', allocation_factor:'0.0000000000', loaded_at:'yyyy-mm-dd hh:mm:ss'
    }),
    weeklyPublish: v300FormatByHeaders_(AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, {
      sort_order:'0', observation_date:'yyyy-mm-dd', year:'0', quarter:'0', month:'0',
      iso_year:'0', iso_week:'0', current_value:'0.000000', previous_week_value:'0.000000',
      wow_abs:'0.000000', wow_pct:'0.000000', previous_year_value:'0.000000',
      yoy_abs:'0.000000', yoy_pct:'0.000000', december_base_value:'0.000000',
      december_abs:'0.000000', december_pct:'0.000000', moving_average_4w:'0.000000',
      ma4_deviation_pct:'0.000000', markup_wow_pp:'0.000000', markup_yoy_pp:'0.000000',
      markup_december_pp:'0.000000', is_latest_period:'0'
    }),
    monthlyPublish: v300FormatByHeaders_(AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, {
      sort_order:'0', month_start:'yyyy-mm-dd', year:'0', quarter:'0', month:'0',
      current_value:'0.000000', previous_month_value:'0.000000', mom_abs:'0.000000',
      mom_pct:'0.000000', previous_year_value:'0.000000', yoy_abs:'0.000000',
      yoy_pct:'0.000000', december_base_value:'0.000000', december_abs:'0.000000',
      december_pct:'0.000000', markup_mom_pp:'0.000000', markup_yoy_pp:'0.000000',
      markup_december_pp:'0.000000', is_latest_period:'0'
    }),
    industryPublish: {9:'0',10:'yyyy-mm-dd',11:'yyyy-mm-dd',12:'0',13:'0',14:'0',16:'0.000000',17:'0.000000',18:'0.000000',19:'0.000000',20:'0.000000',21:'0.000000',22:'0.000000',23:'0'},
    priceAggregatesPublish: v300FormatByHeaders_(AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES, {
      period_start:'yyyy-mm-dd', category_value:'0.000000', category_change_pp:'0.000000',
      category_weight:'0.0000000000', aggregate_change_pp:'0.000000',
      contribution_to_group_change_pp:'0.000000', contribution_to_basket_change_pp:'0.000000',
      contribution_to_total_cpi_pp:'0.000000', coverage_categories_count:'0', coverage_weight_sum:'0.0000000000',
      is_latest_period:'0'
    })
  };
}

/** Построение публикационных витрин из RAW, версия 3.0.4. */
function v300ProductMap_() {
  const sheet = v300Tech_().getSheetByName(AKORT_V300.SHEETS.DIM_PRODUCTS);
  const result = {};
  v300ReadObjects_(sheet, AKORT_V300.HEADERS.DIM_PRODUCTS).forEach(function(row) {
    result[v300Text_(row.category_id)] = row;
  });
  return result;
}

function v300IndustryMap_() {
  const sheet = v300Tech_().getSheetByName(AKORT_V300.SHEETS.DIM_INDUSTRY_SERIES);
  const result = {};
  v300ReadObjects_(sheet, AKORT_V300.HEADERS.DIM_INDUSTRY_SERIES).forEach(function(row) {
    result[v300Text_(row.series_id)] = row;
  });
  return result;
}

function v300RawBusinessKey_(sheetName, row) {
  if (sheetName === AKORT_V300.SHEETS.RAW_PRICES_WEEKLY) return [v300Text_(row.dataset_code),v300Text_(row.category_id),v300ValueType_(row.value_type),v300IndexType_(row.index_type || ''),v300DateKey_(row.observation_date)].join('|');
  if (sheetName === AKORT_V300.SHEETS.RAW_PRICES_MONTHLY) return [v300Text_(row.dataset_code),v300Text_(row.category_id),v300ValueType_(row.value_type),v300IndexType_(row.index_type || ''),v300MonthKey_(row.observation_month)].join('|');
  if (sheetName === AKORT_V300.SHEETS.RAW_INDUSTRY) return [v300Text_(row.series_id),v300DateKey_(row.period_start),v300DateKey_(row.period_end)].join('|');
  return '';
}
function v300SelectReplayLatest_(sheetName, rows, allowedLoads, reversedLoads) {
  const best = {};
  (rows || []).forEach(function(row) {
    const loadId = v300Text_(row.load_id || 'UNREGISTERED');
    if (!allowedLoads[loadId] || (reversedLoads && reversedLoads[loadId])) return;
    const key = v300RawBusinessKey_(sheetName, row);
    if (!key) return;
    const version = Number(row.version_no || 0);
    const loaded = v300Date_(row.loaded_at);
    const score = version * 10000000000000 + (loaded ? loaded.getTime() : 0);
    if (!best[key] || score > best[key].score) best[key] = {score:score,row:row};
  });
  return Object.keys(best).sort().map(function(key) {
    const copy = {}; Object.keys(best[key].row).forEach(function(k){if(k !== '_rowNumber' && k !== '__row')copy[k]=best[key].row[k];}); copy.is_latest=1; return copy;
  });
}
function v300LatestRawObjects_(sheetName, headers) {
  const sheet = v300Tech_().getSheetByName(sheetName);
  const rows = v300ReadObjects_(sheet, headers);
  if (!ALPHA6_REPLAY_ALLOWED_LOADS) return rows.filter(function(row) { return v300Bool01_(row.is_latest) === 1; });
  return v300SelectReplayLatest_(sheetName, rows, ALPHA6_REPLAY_ALLOWED_LOADS, ALPHA6_REPLAY_REVERSED_LOADS || {});
}

function v300BuildWeeklyPublish_() {
  const products = v300ProductMap_();
  const raw = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY, AKORT_V300.HEADERS.RAW_PRICES_WEEKLY);
  const base = [];
  raw.forEach(function(row) {
    const date = v300DateOnly_(row.observation_date);
    const value = v300Number_(row.value);
    const categoryId = v300Text_(row.category_id);
    if (!date || value === null || !categoryId) return;
    const product = products[categoryId] || {};
    const dataset = v300Text_(row.dataset_code);
    let valueType = v300ValueType_(row.value_type);
    if (!valueType && dataset === AKORT_V300.DATASETS.ROSSTAT_WEEKLY) valueType = 'розница';
    const indexType = v300IndexType_(row.index_type || '');
    const seriesType = v300IsIndexValueType_(valueType) ? 'OFFICIAL_WEEKLY_INDEX' : 'OFFICIAL_WEEKLY';
    const iso = v300Iso_(date);
    base.push(v300WeeklyBaseRow_({
      datasetCode: dataset,
      sourceName: v300SourceName_(dataset),
      categoryId: categoryId,
      productGroup: v300Text_(product.product_group),
      productName: v300Text_(product.product_name) || categoryId,
      baseUnit: v300Text_(product.unit),
      sortOrder: v300Int_(product.sort_order) || 999,
      valueType: valueType,
      indexType: indexType,
      seriesType: seriesType,
      date: date,
      iso: iso,
      value: value
    }));
  });
  v300AddWeeklyMarkupRows_(base);
  v300CalculateWeeklyDynamics_(base);
  v300SetLatestPeriod_(base, 'observation_date');
  base.sort(v300PublishSort_('observation_date'));
  return v300ObjectsToRows_(base, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY);
}

function v300WeeklyBaseRow_(p) {
  const d = v300DateOnly_(p.date);
  if (!d) throw new Error('v300WeeklyBaseRow_: пустая или некорректная observation_date для ' + [p.datasetCode, p.categoryId, p.valueType, p.seriesType].join('|'));
  const iso = p.iso && p.iso.year && p.iso.week ? p.iso : v300Iso_(d);
  return {
    dataset_code: p.datasetCode,
    source_name: p.sourceName,
    series_id: v300SeriesId_(p.datasetCode, p.categoryId, p.valueType, p.seriesType, p.indexType || ''),
    indicator_key: v300IndicatorKey_(p.datasetCode, p.valueType, p.seriesType),
    indicator_name: v300IndicatorName_(p.valueType),
    product_group: p.productGroup,
    category_id: p.categoryId,
    product_name: p.productName,
    value_type: v300ValueType_(p.valueType),
    index_type: v300IndexType_(p.indexType || ''),
    series_type: p.seriesType,
    unit: v300ValueUnit_(p.baseUnit, p.valueType),
    sort_order: p.sortOrder,
    observation_date: v300DateKey_(d),
    year: d.getFullYear(),
    quarter: v300Quarter_(d.getMonth() + 1),
    month: d.getMonth() + 1,
    iso_year: iso.year,
    iso_week: iso.week,
    period_label: iso.year + '-W' + v300Pad2_(iso.week),
    current_value: v300Round_(p.value, 6),
    previous_week_value: '', wow_abs: '', wow_pct: '',
    previous_year_value: '', yoy_abs: '', yoy_pct: '',
    december_base_value: '', december_abs: '', december_pct: '',
    moving_average_4w: '', ma4_deviation_pct: '',
    markup_wow_pp: '', markup_yoy_pp: '', markup_december_pp: '',
    is_latest_period: 0
  };
}

function v300AddWeeklyMarkupRows_(rows) {
  const groups = {};
  rows.forEach(function(row) {
    if (row.dataset_code !== AKORT_V300.DATASETS.AKORT_WEEKLY || row.series_type !== 'OFFICIAL_WEEKLY') return;
    const key = [row.dataset_code, row.category_id, v300DateKey_(row.observation_date)].join('|');
    if (!groups[key]) groups[key] = {};
    groups[key][row.value_type] = row;
  });
  Object.keys(groups).forEach(function(key) {
    const retail = groups[key]['розница'], purchase = groups[key]['закупка'];
    if (!retail || !purchase || Number(purchase.current_value) === 0) return;
    const common = {
      datasetCode: retail.dataset_code, sourceName: retail.source_name,
      categoryId: retail.category_id, productGroup: retail.product_group,
      productName: retail.product_name, baseUnit: retail.unit.replace(/^руб\.\//, ''),
      sortOrder: retail.sort_order, date: retail.observation_date,
      iso: {year:retail.iso_year, week:retail.iso_week}, indexType: ''
    };
    const abs = Number(retail.current_value) - Number(purchase.current_value);
    rows.push(v300WeeklyBaseRow_(Object.assign({}, common, {valueType:'наценка, руб.', seriesType:'CALCULATED_MARKUP', value:abs})));
    rows.push(v300WeeklyBaseRow_(Object.assign({}, common, {valueType:'наценка, %', seriesType:'CALCULATED_MARKUP', value:abs / Number(purchase.current_value) * 100})));
  });
}

function v300CalculateWeeklyDynamics_(rows) {
  const groups = v300GroupBy_(rows, 'series_id');
  Object.keys(groups).forEach(function(seriesId) {
    const series = groups[seriesId].sort(function(a,b){return v300Date_(a.observation_date)-v300Date_(b.observation_date);});
    const isoMap = {}, december = {};
    series.forEach(function(row) {
      isoMap[row.iso_year + '-W' + v300Pad2_(row.iso_week)] = row;
      if (row.month === 12) december[row.year] = row;
    });
    series.forEach(function(row, i) {
      const previous = i ? series[i - 1] : null;
      const priorYear = isoMap[(Number(row.iso_year) - 1) + '-W' + v300Pad2_(row.iso_week)];
      const base = december[row.year - 1];
      const isMarkupPct = row.series_type === 'CALCULATED_MARKUP' && v300IsMarkupPctValueType_(row.value_type);
      const isMarkupAbs = row.series_type === 'CALCULATED_MARKUP' && v300IsMarkupAbsValueType_(row.value_type);
      const isPriceLevel = v300IsPriceLevelValueType_(row.value_type) && row.series_type !== 'CALCULATED_MARKUP';
      const isWeeklyIndex = row.series_type === 'OFFICIAL_WEEKLY_INDEX' && v300IsIndexValueType_(row.value_type);

      if (isWeeklyIndex) {
        if (v300IndexType_(row.index_type) === 'wow') row.wow_pct = v300Round_(Number(row.current_value) - 100, 6);
      } else if (isPriceLevel) {
        if (previous) {
          row.previous_week_value = previous.current_value;
          row.wow_abs = v300Round_(Number(row.current_value) - Number(previous.current_value), 6);
          row.wow_pct = v300Pct_(row.current_value, previous.current_value);
        }
        if (priorYear) {
          row.previous_year_value = priorYear.current_value;
          row.yoy_abs = v300Round_(Number(row.current_value) - Number(priorYear.current_value), 6);
          row.yoy_pct = v300Pct_(row.current_value, priorYear.current_value);
        }
        if (base) {
          row.december_base_value = base.current_value;
          row.december_abs = v300Round_(Number(row.current_value) - Number(base.current_value), 6);
          row.december_pct = v300Pct_(row.current_value, base.current_value);
        }
        const start = Math.max(0, i - 3), window = series.slice(start, i + 1);
        if (window.length === 4) {
          const mean = window.reduce(function(sum, r){return sum + Number(r.current_value);},0) / 4;
          row.moving_average_4w = v300Round_(mean, 6);
          row.ma4_deviation_pct = v300Pct_(row.current_value, mean);
        }
      } else if (isMarkupPct) {
        if (previous) row.markup_wow_pp = v300Round_(Number(row.current_value) - Number(previous.current_value), 6);
        if (priorYear) row.markup_yoy_pp = v300Round_(Number(row.current_value) - Number(priorYear.current_value), 6);
        if (base) row.markup_december_pp = v300Round_(Number(row.current_value) - Number(base.current_value), 6);
      } else if (isMarkupAbs) {
        // Рублевая наценка публикуется только уровнем current_value.
      }
    });
  });
}

function v300BuildMonthlyPublish_() {
  const products = v300ProductMap_();
  const base = [];
  const indexBuckets = {};
  const monthlyRaw = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_MONTHLY, AKORT_V300.HEADERS.RAW_PRICES_MONTHLY);
  monthlyRaw.forEach(function(row) {
    const month = v300MonthStart_(row.observation_month), value = v300Number_(row.value), categoryId = v300Text_(row.category_id);
    if (!month || value === null || !categoryId) return;
    const product = products[categoryId] || {};
    const dataset = v300Text_(row.dataset_code), valueType = v300ValueType_(row.value_type), indexType = v300IndexType_(row.index_type || '');
    if (v300IsIndexValueType_(valueType)) {
      if (!v300IsAllowedIndexType_(indexType, false)) return;
      const key = [dataset, categoryId, valueType, v300MonthKey_(month)].join('|');
      if (!indexBuckets[key]) indexBuckets[key] = {dataset: dataset, categoryId: categoryId, valueType: valueType, month: month, product: product, values: {}};
      indexBuckets[key].values[indexType] = value;
      return;
    }
    base.push(v300MonthlyBaseRow_({datasetCode:dataset, sourceName:v300SourceName_(dataset), categoryId:categoryId,
      productGroup:v300Text_(product.product_group), productName:v300Text_(product.product_name)||categoryId,
      baseUnit:v300Text_(product.unit), sortOrder:v300Int_(product.sort_order)||999,
      valueType:valueType, indexType:'', seriesType:'OFFICIAL_MONTHLY', month:month, value:value, completeness:'COMPLETE'}));
  });
  Object.keys(indexBuckets).forEach(function(key) {
    const g = indexBuckets[key], product = g.product || {};
    const row = v300MonthlyBaseRow_({datasetCode:g.dataset, sourceName:v300SourceName_(g.dataset), categoryId:g.categoryId,
      productGroup:v300Text_(product.product_group), productName:v300Text_(product.product_name)||g.categoryId,
      baseUnit:v300Text_(product.unit), sortOrder:v300Int_(product.sort_order)||999,
      valueType:g.valueType, indexType:'', seriesType:'OFFICIAL_MONTHLY_INDEX', month:g.month, value:'', completeness:'COMPLETE'});
    if (g.values.mom !== undefined) row.mom_pct = v300Round_(Number(g.values.mom) - 100, 6);
    if (g.values.yoy !== undefined) row.yoy_pct = v300Round_(Number(g.values.yoy) - 100, 6);
    if (g.values.december !== undefined) row.december_pct = v300Round_(Number(g.values.december) - 100, 6);
    base.push(row);
  });
  v300AddDerivedMonthlyRows_(base, products);
  v300AddMonthlyMarkupRows_(base);
  v300CalculateMonthlyDynamics_(base);
  v300SetLatestPeriod_(base, 'month_start');
  base.sort(v300PublishSort_('month_start'));
  return v300ObjectsToRows_(base, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY);
}

function v300MonthlyBaseRow_(p) {
  const month = v300MonthStart_(p.month);
  return {
    dataset_code:p.datasetCode, source_name:p.sourceName,
    series_id:v300SeriesId_(p.datasetCode,p.categoryId,p.valueType,p.seriesType,p.indexType||''),
    indicator_key:v300IndicatorKey_(p.datasetCode,p.valueType,p.seriesType),
    indicator_name:v300IndicatorName_(p.valueType), product_group:p.productGroup,
    category_id:p.categoryId, product_name:p.productName, value_type:v300ValueType_(p.valueType), index_type:v300IndexType_(p.indexType||''),
    series_type:p.seriesType, unit:v300ValueUnit_(p.baseUnit,p.valueType), sort_order:p.sortOrder,
    month_start:month, year:month.getFullYear(), quarter:v300Quarter_(month.getMonth()+1),
    month:month.getMonth()+1, period_label:v300MonthKey_(month), current_value:v300Round_(p.value,6),
    previous_month_value:'', mom_abs:'', mom_pct:'', previous_year_value:'', yoy_abs:'', yoy_pct:'',
    december_base_value:'', december_abs:'', december_pct:'',
    markup_mom_pp:'', markup_yoy_pp:'', markup_december_pp:'',
    period_completeness:p.completeness||'COMPLETE', is_latest_period:0
  };
}

function v300AddDerivedMonthlyRows_(base, products) {
  const weekly = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY, AKORT_V300.HEADERS.RAW_PRICES_WEEKLY)
    .filter(function(row){return v300Text_(row.dataset_code)===AKORT_V300.DATASETS.AKORT_WEEKLY && !v300IsIndexValueType_(row.value_type);});
  const groups = {};
  weekly.forEach(function(row) {
    const date=v300DateOnly_(row.observation_date), value=v300Number_(row.value), category=v300Text_(row.category_id);
    if(!date||value===null||!category)return;
    const valueType = v300ValueType_(row.value_type);
    const month=v300MonthStart_(date), key=[category,valueType,v300MonthKey_(month)].join('|');
    if(!groups[key])groups[key]={categoryId:category,valueType:valueType,month:month,values:[]};
    groups[key].values.push(value);
  });
  Object.keys(groups).forEach(function(key){
    const g=groups[key], product=products[g.categoryId]||{}, expected=v300SundaysInMonth_(g.month);
    const mean=g.values.reduce(function(a,b){return a+b;},0)/g.values.length;
    base.push(v300MonthlyBaseRow_({datasetCode:AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED,sourceName:'АКОРТ',
      categoryId:g.categoryId,productGroup:v300Text_(product.product_group),productName:v300Text_(product.product_name)||g.categoryId,
      baseUnit:v300Text_(product.unit),sortOrder:v300Int_(product.sort_order)||999,valueType:g.valueType,
      indexType:'',seriesType:'DERIVED_FROM_WEEKLY',month:g.month,value:mean,
      completeness:g.values.length>=expected?'COMPLETE':'PARTIAL'}));
  });
}

function v300SundaysInMonth_(month) {
  const start=v300MonthStart_(month), end=v300MonthEnd_(month); let count=0;
  for(let d=new Date(start.getTime());d<=end;d.setDate(d.getDate()+1))if(d.getDay()===0)count++;
  return count;
}

function v300AddMonthlyMarkupRows_(rows) {
  const groups={};
  rows.forEach(function(row){
    if (row.dataset_code !== AKORT_V300.DATASETS.AKORT_MONTHLY && row.dataset_code !== AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED) return;
    if(row.value_type!=='розница'&&row.value_type!=='закупка')return;
    const key=[row.dataset_code,row.category_id,row.series_type,v300DateKey_(row.month_start)].join('|');
    if(!groups[key])groups[key]={};groups[key][row.value_type]=row;
  });
  Object.keys(groups).forEach(function(key){
    const retail=groups[key]['розница'],purchase=groups[key]['закупка'];
    if(!retail||!purchase||Number(purchase.current_value)===0)return;
    const common={datasetCode:retail.dataset_code,sourceName:retail.source_name,categoryId:retail.category_id,
      productGroup:retail.product_group,productName:retail.product_name,baseUnit:retail.unit.replace(/^руб\.\//,''),
      sortOrder:retail.sort_order,seriesType:'CALCULATED_MARKUP',month:retail.month_start,
      completeness:retail.period_completeness==='PARTIAL'||purchase.period_completeness==='PARTIAL'?'PARTIAL':'COMPLETE'};
    const abs=Number(retail.current_value)-Number(purchase.current_value);
    rows.push(v300MonthlyBaseRow_(Object.assign({},common,{valueType:'наценка, руб.',indexType:'',value:abs})));
    rows.push(v300MonthlyBaseRow_(Object.assign({},common,{valueType:'наценка, %',indexType:'',value:abs/Number(purchase.current_value)*100})));
  });
}

function v300CalculateMonthlyDynamics_(rows) {
  const groups=v300GroupBy_(rows,'series_id');
  Object.keys(groups).forEach(function(id){
    const series=groups[id].sort(function(a,b){return v300Date_(a.month_start)-v300Date_(b.month_start);}), monthMap={}, december={};
    series.forEach(function(row){monthMap[row.year+'-'+v300Pad2_(row.month)]=row;if(row.month===12)december[row.year]=row;});
    series.forEach(function(row,i){
      if (row.series_type === 'OFFICIAL_MONTHLY_INDEX') return;
      const previous=i?series[i-1]:null,prior=monthMap[(row.year-1)+'-'+v300Pad2_(row.month)],base=december[row.year-1];
      const isMarkupPct=row.series_type==='CALCULATED_MARKUP'&&v300IsMarkupPctValueType_(row.value_type);
      const isMarkupAbs=row.series_type==='CALCULATED_MARKUP'&&v300IsMarkupAbsValueType_(row.value_type);
      const isPriceLevel=v300IsPriceLevelValueType_(row.value_type)&&row.series_type!=='CALCULATED_MARKUP';
      if(isPriceLevel){
        if(previous){row.previous_month_value=previous.current_value;row.mom_abs=v300Round_(Number(row.current_value)-Number(previous.current_value),6);row.mom_pct=v300Pct_(row.current_value,previous.current_value);}
        if(prior){row.previous_year_value=prior.current_value;row.yoy_abs=v300Round_(Number(row.current_value)-Number(prior.current_value),6);row.yoy_pct=v300Pct_(row.current_value,prior.current_value);}
        if(base){row.december_base_value=base.current_value;row.december_abs=v300Round_(Number(row.current_value)-Number(base.current_value),6);row.december_pct=v300Pct_(row.current_value,base.current_value);}
      }else if(isMarkupPct){
        if(previous)row.markup_mom_pp=v300Round_(Number(row.current_value)-Number(previous.current_value),6);
        if(prior)row.markup_yoy_pp=v300Round_(Number(row.current_value)-Number(prior.current_value),6);
        if(base)row.markup_december_pp=v300Round_(Number(row.current_value)-Number(base.current_value),6);
      }else if(isMarkupAbs){
        // Рублевая наценка публикуется только уровнем current_value.
      }
    });
  });
}

function v300BuildIndustryPublish_() {
  const dims=v300IndustryMap_();
  const raw=v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_INDUSTRY,AKORT_V300.HEADERS.RAW_INDUSTRY),rows=[];
  raw.forEach(function(row){
    const dim=dims[v300Text_(row.series_id)]||{},start=v300DateOnly_(row.period_start),end=v300DateOnly_(row.period_end),value=v300Number_(row.value);
    if(!start||value===null)return;
    const frequency=v300Text_(dim.frequency)||'monthly',periodEnd=end||start;
    const comparisonDate=frequency==='quarterly'?periodEnd:start;
    rows.push({dataset_code:AKORT_V300.DATASETS.INDUSTRY,source_name:v300Text_(dim.source_name)||'Официальный источник',
      series_id:v300Text_(row.series_id),indicator_name:v300Text_(dim.indicator_name)||v300Text_(row.series_id),
      classification_1:v300Text_(dim.classification_1),classification_2:v300Text_(dim.classification_2),
      frequency:frequency,unit:v300Text_(dim.unit),sort_order:v300Int_(dim.sort_order)||999,
      period_start:start,period_end:periodEnd,year:comparisonDate.getFullYear(),quarter:frequency==='quarterly'?v300Quarter_(comparisonDate.getMonth()+1):'',
      month:frequency==='monthly'?comparisonDate.getMonth()+1:'',period_label:v300IndustryPeriodLabel_(comparisonDate,frequency),
      current_value:v300Round_(value,6),previous_period_value:'',period_change_abs:'',period_change_pct:'',
      previous_year_value:'',yoy_abs:'',yoy_pct:'',is_latest_period:0,
      _periodBasis:v300Text_(dim.period_basis),_metricType:v300Text_(dim.metric_type),_comparisonDate:comparisonDate});
  });
  v300CalculateIndustryDynamics_(rows);
  v300SetLatestSeriesPeriod_(rows,'period_end');
  rows.sort(v300PublishSort_('period_end'));
  return v300ObjectsToRows_(rows,AKORT_V300.HEADERS.PUBLISH_INDUSTRY);
}

function v300IndustryPeriodLabel_(date,frequency){
  if(frequency==='annual')return String(date.getFullYear());
  if(frequency==='quarterly')return date.getFullYear()+'-Q'+v300Quarter_(date.getMonth()+1);
  return v300MonthKey_(date);
}
function v300CalculateIndustryDynamics_(rows){
  const groups=v300GroupBy_(rows,'series_id');
  Object.keys(groups).forEach(function(id){
    const series=groups[id].sort(function(a,b){return a._comparisonDate-b._comparisonDate;}),periodMap={};
    series.forEach(function(row){periodMap[v300IndustryComparisonKey_(row,row.year)]=row;});
    series.forEach(function(row,i){
      const previous=i?series[i-1]:null;
      if(previous&&row._periodBasis!=='cumulative_ytd'){
        row.previous_period_value=previous.current_value;row.period_change_abs=v300Round_(Number(row.current_value)-Number(previous.current_value),6);
        if(v300IndustryAllowsPct_(row,previous.current_value))row.period_change_pct=v300Pct_(row.current_value,previous.current_value);
      }
      const prior=periodMap[v300IndustryComparisonKey_(row,row.year-1)];
      if(prior){row.previous_year_value=prior.current_value;row.yoy_abs=v300Round_(Number(row.current_value)-Number(prior.current_value),6);if(v300IndustryAllowsPct_(row,prior.current_value))row.yoy_pct=v300Pct_(row.current_value,prior.current_value);}
    });
  });
}
function v300IndustryComparisonKey_(row,year){
  if(row.frequency==='annual')return String(year);
  if(row.frequency==='quarterly')return year+'-Q'+v300Pad2_(row.quarter);
  return year+'-'+v300Pad2_(row.month);
}
function v300IndustryAllowsPct_(row,previous){return Number(previous)>0&&Number(row.current_value)>=0&&v300Text_(row._metricType)!=='index_points';}

function v300GroupBy_(rows,field){const result={};rows.forEach(function(row){const key=v300Text_(row[field]);if(!result[key])result[key]=[];result[key].push(row);});return result;}
function v300SetLatestPeriod_(rows,dateField){
  const max={};rows.forEach(function(row){const d=v300Date_(row[dateField]),dataset=v300Text_(row.dataset_code);if(d&&(!max[dataset]||d>max[dataset]))max[dataset]=d;});
  rows.forEach(function(row){const d=v300Date_(row[dateField]);row.is_latest_period=d&&max[row.dataset_code]&&v300DateKey_(d)===v300DateKey_(max[row.dataset_code])?1:0;});
}
function v300SetLatestSeriesPeriod_(rows,dateField){
  const max={};rows.forEach(function(row){const d=v300Date_(row[dateField]),series=v300Text_(row.series_id);if(d&&(!max[series]||d>max[series]))max[series]=d;});
  rows.forEach(function(row){const d=v300Date_(row[dateField]);row.is_latest_period=d&&max[row.series_id]&&v300DateKey_(d)===v300DateKey_(max[row.series_id])?1:0;});
}
function v300PublishSort_(dateField){
  return function(a,b){const da=v300Date_(a[dateField]),db=v300Date_(b[dateField]);return String(a.dataset_code).localeCompare(String(b.dataset_code),'ru')||(Number(a.sort_order)-Number(b.sort_order))||String(a.series_id).localeCompare(String(b.series_id))||((da?da.getTime():0)-(db?db.getTime():0));};
}

function v300WriteFullPublishes_(){
  const publish=v300Publish_(),formats=v300FormatRows_();
  const weekly=v300BuildWeeklyPublish_(),monthly=v300BuildMonthlyPublish_(),industry=v300BuildIndustryPublish_(),aggregates=v304BuildPriceAggregatesPublish_();
  v300WriteTable_(publish,AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,weekly,formats.weeklyPublish);
  v300WriteTable_(publish,AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,monthly,formats.monthlyPublish);
  v300WriteTable_(publish,AKORT_V300.SHEETS.PUBLISH_INDUSTRY,AKORT_V300.HEADERS.PUBLISH_INDUSTRY,industry,formats.industryPublish);
  v300WriteTable_(publish,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,aggregates,formats.priceAggregatesPublish);
  return {weekly:weekly.length,monthly:monthly.length,industry:industry.length,aggregates:aggregates.length};
}

function v300PatchPricePublishes_(affectedWeekly,affectedMonthly,revisionMode){
  // В версии 3.0.4 после загрузки смешанных файлов Росстат/АКОРТ безопаснее пересобирать все ценовые витрины.
  v300WriteFullPublishes_();
}
function v300A1_(row,column){let n=column,s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s+row;}

/** Aggregated price/index indicators and contributions, v3.0.4. */
function v304BuildPriceAggregatesPublish_() {
  const weights = v304WeightIndex_();
  const rows = [];
  rows.push.apply(rows, v304AggregateFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, 'weekly', weights));
  rows.push.apply(rows, v304AggregateFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, 'monthly', weights));
  v304SetLatestAggregateFlags_(rows);
  return v300ObjectsToRows_(rows, AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES);
}

function v304WeightIndex_() {
  const result = {};
  const sheet = v300Tech_().getSheetByName(AKORT_V300.SHEETS.RAW_CATEGORY_WEIGHTS);
  if (!sheet || sheet.getLastRow() < 2) return result;
  v300ReadObjects_(sheet, AKORT_V300.HEADERS.RAW_CATEGORY_WEIGHTS).forEach(function(row) {
    const key = [v300Text_(row.source_code), v300Text_(row.weight_scope), v300Text_(row.category_id)].join('|');
    result[key] = v300Number_(row.weight_value) || 0;
  });
  return result;
}

function v304AggregateFromPublish_(sheetName, headers, frequency, weights) {
  const sheet = v300Publish_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = v300ReadObjects_(sheet, headers);
  const out = [];
  rows.forEach(function(row) {
    const categoryId = v300Text_(row.category_id), dataset = v300Text_(row.dataset_code), valueType = v300ValueType_(row.value_type);
    if (!categoryId || !dataset || !valueType) return;
    const period = frequency === 'weekly' ? v300Date_(row.observation_date) : v300Date_(row.month_start);
    if (!period) return;
    const changes = v304ChangesFromPublishRow_(row, frequency);
    Object.keys(changes).forEach(function(indexType) {
      const change = changes[indexType];
      if (change === '' || change === null || change === undefined) return;
      const weightSource = dataset.indexOf('AKORT') === 0 ? 'AKORT_SALES_WEIGHTS' : 'ROSSTAT_CPI_WEIGHTS';
      const basketScope = dataset.indexOf('AKORT') === 0 ? 'akort_basket' : 'dashboard_basket';
      const groupWeight = weights[[weightSource, 'group', categoryId].join('|')];
      const basketWeight = weights[[weightSource, basketScope, categoryId].join('|')];
      const totalCpiWeight = weights[['ROSSTAT_CPI_WEIGHTS', 'total_cpi', categoryId].join('|')];
      const base = {
        dataset_code: dataset,
        source_name: row.source_name,
        frequency: frequency,
        aggregate_level: 'category',
        aggregate_id: v300Id_('AGG_CAT', [dataset, frequency, valueType, indexType, categoryId].join('|')),
        aggregate_name: 'Вклад категории',
        category_id: categoryId,
        product_group: row.product_group,
        product_name: row.product_name,
        value_type: valueType,
        index_type: indexType,
        period_start: period,
        period_label: row.period_label,
        category_value: row.current_value,
        category_change_pp: change,
        category_weight: basketWeight === undefined ? '' : basketWeight,
        aggregate_change_pp: '',
        contribution_to_group_change_pp: groupWeight === undefined ? '' : v300Round_(groupWeight * Number(change), 6),
        contribution_to_basket_change_pp: basketWeight === undefined ? '' : v300Round_(basketWeight * Number(change), 6),
        contribution_to_total_cpi_pp: (frequency === 'monthly' && dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && valueType === 'ИПЦ' && totalCpiWeight !== undefined) ? v300Round_(totalCpiWeight * Number(change), 6) : '',
        weight_source: weightSource,
        coverage_categories_count: '',
        coverage_weight_sum: '',
        is_latest_period: 0
      };
      out.push(base);
    });
  });
  out.push.apply(out, v304BuildAggregateTotalRows_(out, 'group'));
  out.push.apply(out, v304BuildAggregateTotalRows_(out, 'basket'));
  out.push.apply(out, v304BuildAggregateTotalRows_(out, 'total_cpi'));
  return out;
}

function v304ChangesFromPublishRow_(row, frequency) {
  const result = {};
  if (frequency === 'weekly') {
    if (row.wow_pct !== '' && row.wow_pct !== null && row.wow_pct !== undefined) result.wow = v300Number_(row.wow_pct);
    if (row.yoy_pct !== '' && row.yoy_pct !== null && row.yoy_pct !== undefined) result.yoy = v300Number_(row.yoy_pct);
    if (row.december_pct !== '' && row.december_pct !== null && row.december_pct !== undefined) result.december = v300Number_(row.december_pct);
  } else {
    if (row.mom_pct !== '' && row.mom_pct !== null && row.mom_pct !== undefined) result.mom = v300Number_(row.mom_pct);
    if (row.yoy_pct !== '' && row.yoy_pct !== null && row.yoy_pct !== undefined) result.yoy = v300Number_(row.yoy_pct);
    if (row.december_pct !== '' && row.december_pct !== null && row.december_pct !== undefined) result.december = v300Number_(row.december_pct);
  }
  Object.keys(result).forEach(function(k){ if (result[k] === null) delete result[k]; });
  return result;
}

function v304BuildAggregateTotalRows_(categoryRows, level) {
  const groups = {};
  categoryRows.filter(function(r){return r.aggregate_level === 'category';}).forEach(function(row) {
    let contribution = '';
    let name = '';
    if (level === 'group') { contribution = row.contribution_to_group_change_pp; name = row.product_group; }
    else if (level === 'basket') { contribution = row.contribution_to_basket_change_pp; name = 'Корзина дашборда'; }
    else if (level === 'total_cpi') { contribution = row.contribution_to_total_cpi_pp; name = 'Вклад в общую инфляцию'; }
    if (contribution === '' || contribution === null || contribution === undefined) return;
    const key = [row.dataset_code, row.frequency, row.value_type, row.index_type, v300DateKey_(row.period_start), level, name].join('|');
    if (!groups[key]) groups[key] = {rows:[], sample:row, sum:0, weightSum:0, name:name};
    groups[key].rows.push(row);
    groups[key].sum += Number(contribution);
    if (row.category_weight !== '' && row.category_weight !== null && row.category_weight !== undefined) groups[key].weightSum += Number(row.category_weight);
  });
  return Object.keys(groups).map(function(key) {
    const g = groups[key], s = g.sample;
    return {
      dataset_code: s.dataset_code,
      source_name: s.source_name,
      frequency: s.frequency,
      aggregate_level: level,
      aggregate_id: v300Id_('AGG', key),
      aggregate_name: g.name,
      category_id: '',
      product_group: level === 'group' ? g.name : '',
      product_name: '',
      value_type: s.value_type,
      index_type: s.index_type,
      period_start: s.period_start,
      period_label: s.period_label,
      category_value: '',
      category_change_pp: '',
      category_weight: '',
      aggregate_change_pp: v300Round_(g.sum, 6),
      contribution_to_group_change_pp: '',
      contribution_to_basket_change_pp: '',
      contribution_to_total_cpi_pp: '',
      weight_source: s.weight_source,
      coverage_categories_count: g.rows.length,
      coverage_weight_sum: v300Round_(g.weightSum, 10),
      is_latest_period: 0
    };
  });
}

function v304SetLatestAggregateFlags_(rows) {
  const max = {};
  rows.forEach(function(row){const key=[row.dataset_code,row.frequency,row.aggregate_level,row.value_type,row.index_type,row.aggregate_name].join('|');const d=v300Date_(row.period_start);if(d&&(!max[key]||d>max[key]))max[key]=d;});
  rows.forEach(function(row){const key=[row.dataset_code,row.frequency,row.aggregate_level,row.value_type,row.index_type,row.aggregate_name].join('|');const d=v300Date_(row.period_start);row.is_latest_period=d&&max[key]&&v300DateKey_(d)===v300DateKey_(max[key])?1:0;});
}

var AKORT_V315_SPECIAL = {
  STATE_PROPERTY: 'AKORT_V315_SPECIAL_AGG_STATE',
  OLD_STATE_PROPERTY: 'AKORT_V314_SPECIAL_AGG_STATE',
  VERSION: '3.1.5-borshch-streaming-append-fix',
  ROWS_PER_STEP: 450,
  BUDGET_MS: 22000,
  BORSCH_NAME: 'Борщевой набор'
};


function v315BuildAllSpecialRows_() {
  const weights = v304WeightIndex_();
  let out = [];
  out = out.concat(v315BuildBorshchRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, 'weekly', weights));
  out = out.concat(v315BuildBorshchRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, 'monthly', weights));
  out = out.concat(v315BuildAkortMarkupRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, 'weekly', weights));
  out = out.concat(v315BuildAkortMarkupRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, 'monthly', weights));
  return out.sort(function(a,b) {
    return [a.dataset_code,a.frequency,a.aggregate_level,a.aggregate_name,a.value_type,a.index_type,v300DateKey_(a.period_start)].join('|') > [b.dataset_code,b.frequency,b.aggregate_level,b.aggregate_name,b.value_type,b.index_type,v300DateKey_(b.period_start)].join('|') ? 1 : -1;
  });
}

function v315BuildBorshchRowsFromPublish_(sheetName, headers, frequency, weights) {
  const sheet = v300Publish_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = v300ReadObjects_(sheet, headers);
  const borshch = v315BorshchCategorySet_();
  const groups = {};

  rows.forEach(function(row) {
    const categoryId = v300Text_(row.category_id);
    if (!borshch[categoryId]) return;
    const valueType = v300ValueType_(row.value_type);
    if (valueType === 'наценка, %' || valueType === 'наценка, руб.') return;
    const period = frequency === 'weekly' ? v300Date_(row.observation_date) : v300Date_(row.month_start);
    if (!period) return;
    const dataset = v300Text_(row.dataset_code);
    const changes = v310ChangesFromPublishRow_(row, frequency);
    const weightSource = dataset.indexOf('AKORT') === 0 ? 'AKORT_SALES_WEIGHTS' : 'ROSSTAT_CPI_WEIGHTS';
    const basketScope = dataset.indexOf('AKORT') === 0 ? 'akort_basket' : 'dashboard_basket';
    const weight = v300Number_(weights[[weightSource, basketScope, categoryId].join('|')]);
    if (weight === null || weight <= 0) return;

    Object.keys(changes).forEach(function(indexType) {
      const change = v300Number_(changes[indexType]);
      if (change === null) return;
      const key = [dataset, frequency, valueType, indexType, v300DateKey_(period)].join('|');
      if (!groups[key]) groups[key] = {sample:row, period:period, valueType:valueType, indexType:indexType, weightSource:weightSource, weightSum:0, weightedChange:0, count:0, latest:0};
      groups[key].weightSum += weight;
      groups[key].weightedChange += weight * change;
      groups[key].count++;
      if (v300Bool01_(row.is_latest_period) === 1) groups[key].latest = 1;
    });
  });

  const out = [];
  Object.keys(groups).forEach(function(key) {
    const g = groups[key], s = g.sample, period = g.period;
    if (!g.weightSum) return;
    out.push({
      dataset_code:v300Text_(s.dataset_code),
      source_name:s.source_name,
      frequency:frequency,
      aggregate_level:'custom_group',
      aggregate_id:v300Id_('AGG_BORSHCH', key),
      aggregate_name:AKORT_V315_SPECIAL.BORSCH_NAME,
      category_id:'',
      product_group:'Овощи и фрукты',
      product_name:'',
      value_type:g.valueType,
      index_type:g.indexType,
      period_start:period,
      year:period.getFullYear(),
      quarter:v300Quarter_(period.getMonth()+1),
      month:period.getMonth()+1,
      period_label:s.period_label,
      category_value:'',
      category_change_pp:'',
      category_weight:'',
      aggregate_change_pp:v300Round_(g.weightedChange / g.weightSum, 6),
      contribution_to_group_change_pp:'',
      contribution_to_basket_change_pp:'',
      contribution_to_total_cpi_pp:'',
      weight_source:g.weightSource,
      coverage_categories_count:g.count,
      coverage_weight_sum:v300Round_(g.weightSum, 10),
      is_latest_period:g.latest,
      aggregate_value:'',
      aggregate_base_value:''
    });
  });
  return out;
}

function v315BuildAkortMarkupRowsFromPublish_(sheetName, headers, frequency, weights) {
  const sheet = v300Publish_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = v300ReadObjects_(sheet, headers);
  const borshch = v315BorshchCategorySet_();
  const byDatasetPeriodCat = {};

  rows.forEach(function(r) {
    const dataset = v300Text_(r.dataset_code);
    if (!v315IsAkortDataset_(dataset)) return;
    const vt = v300ValueType_(r.value_type);
    if (vt !== 'закупка' && vt !== 'розница') return;
    const period = frequency === 'weekly' ? v300Date_(r.observation_date) : v300Date_(r.month_start);
    const value = v300Number_(r.current_value);
    if (!period || value === null) return;
    const categoryId = v300Text_(r.category_id);
    const key = [dataset, v300DateKey_(period), categoryId].join('|');
    if (!byDatasetPeriodCat[key]) byDatasetPeriodCat[key] = {dataset:dataset, period:period, periodLabel:r.period_label, sourceName:r.source_name, categoryId:categoryId, latest:0};
    byDatasetPeriodCat[key][vt] = value;
    if (v300Bool01_(r.is_latest_period) === 1) byDatasetPeriodCat[key].latest = 1;
  });

  const series = {};
  Object.keys(byDatasetPeriodCat).forEach(function(key) {
    const c = byDatasetPeriodCat[key];
    if (c['закупка'] === undefined || c['розница'] === undefined || Number(c['закупка']) === 0) return;
    ['basket','custom_group'].forEach(function(level) {
      if (level === 'custom_group' && !borshch[c.categoryId]) return;
      const weight = v300Number_(weights[['AKORT_SALES_WEIGHTS', 'akort_basket', c.categoryId].join('|')]);
      if (weight === null || weight <= 0) return;
      const sKey = [frequency, c.dataset, level].join('|');
      const pKey = v300DateKey_(c.period);
      if (!series[sKey]) series[sKey] = {};
      if (!series[sKey][pKey]) series[sKey][pKey] = {dataset:c.dataset, frequency:frequency, level:level, period:c.period, periodLabel:c.periodLabel, sourceName:c.sourceName, purchase:0, retail:0, weightSum:0, count:0, latest:0};
      series[sKey][pKey].purchase += weight * Number(c['закупка']);
      series[sKey][pKey].retail += weight * Number(c['розница']);
      series[sKey][pKey].weightSum += weight;
      series[sKey][pKey].count++;
      if (c.latest) series[sKey][pKey].latest = 1;
    });
  });

  const out = [];
  Object.keys(series).forEach(function(sKey) {
    const points = Object.keys(series[sKey]).map(function(p){ return series[sKey][p]; }).filter(function(p) {
      return p.weightSum > 0 && p.purchase > 0;
    }).sort(function(a,b){ return a.period - b.period; });
    const byPeriod = {};
    points.forEach(function(p) {
      p.aggregatePurchase = p.purchase / p.weightSum;
      p.aggregateRetail = p.retail / p.weightSum;
      p.markupPct = (p.aggregateRetail / p.aggregatePurchase - 1) * 100;
      if (frequency === 'weekly') {
        const iso = v300Iso_(p.period);
        p.isoYear = iso.year;
        p.isoWeek = iso.week;
        byPeriod[p.isoYear + '-W' + v300Pad2_(p.isoWeek)] = p;
      } else {
        byPeriod[v300MonthKey_(p.period)] = p;
      }
    });
    points.forEach(function(p, i) {
      if (frequency === 'weekly') {
        v315MaybePushMarkupRow_(out, p, 'wow', i ? points[i-1] : null);
        v315MaybePushMarkupRow_(out, p, 'yoy', byPeriod[(Number(p.isoYear)-1) + '-W' + v300Pad2_(p.isoWeek)] || null);
      } else {
        v315MaybePushMarkupRow_(out, p, 'mom', i ? points[i-1] : null);
        v315MaybePushMarkupRow_(out, p, 'yoy', byPeriod[(p.period.getFullYear()-1) + '-' + v300Pad2_(p.period.getMonth()+1)] || null);
      }
    });
  });
  return out;
}

function v315MaybePushMarkupRow_(out, p, indexType, base) {
  if (!base || base.markupPct === undefined || base.markupPct === null || isNaN(Number(base.markupPct))) return;
  const changePp = Number(p.markupPct) - Number(base.markupPct);
  out.push({
    dataset_code:p.dataset,
    source_name:p.sourceName || v300SourceName_(p.dataset),
    frequency:p.frequency,
    aggregate_level:p.level,
    aggregate_id:v300Id_('AGG_MARKUP_PCT', [p.dataset, p.frequency, p.level, indexType, v300DateKey_(p.period)].join('|')),
    aggregate_name:p.level === 'custom_group' ? AKORT_V315_SPECIAL.BORSCH_NAME : 'Корзина дашборда',
    category_id:'',
    product_group:p.level === 'custom_group' ? 'Овощи и фрукты' : '',
    product_name:'',
    value_type:'наценка, %',
    index_type:indexType,
    period_start:p.period,
    year:p.period.getFullYear(),
    quarter:v300Quarter_(p.period.getMonth()+1),
    month:p.period.getMonth()+1,
    period_label:p.periodLabel,
    category_value:'',
    category_change_pp:'',
    category_weight:'',
    aggregate_change_pp:v300Round_(changePp, 6),
    contribution_to_group_change_pp:'',
    contribution_to_basket_change_pp:'',
    contribution_to_total_cpi_pp:'',
    weight_source:'AKORT_SALES_WEIGHTS',
    coverage_categories_count:p.count,
    coverage_weight_sum:v300Round_(p.weightSum, 10),
    is_latest_period:p.latest,
    aggregate_value:v300Round_(p.markupPct, 6),
    aggregate_base_value:v300Round_(base.markupPct, 6)
  });
}

function v315IsAkortDataset_(datasetCode) {
  const d = v300Text_(datasetCode);
  return d === AKORT_V300.DATASETS.AKORT_WEEKLY || d === AKORT_V300.DATASETS.AKORT_MONTHLY || d === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED;
}

function v315BorshchCategorySet_() {
  const products = v300ProductMap_();
  const out = {};
  Object.keys(products).forEach(function(id) {
    const name = v300Norm_(products[id].product_name || '');
    const group = v300Norm_(products[id].product_group || '');
    if (group && group.indexOf('овощ') < 0 && group.indexOf('фрукт') < 0) return;
    if (/капуста\s+белокочанная/.test(name)) out[id] = true;
    if (/картофель/.test(name)) out[id] = true;
    if (/лук\s+репчат/.test(name)) out[id] = true;
    if (/морковь/.test(name)) out[id] = true;
    if (/свекла/.test(name) || /свёкла/.test(name)) out[id] = true;
  });
  ['ROS_W_94DC6BD306A9','ROS_W_8A1C321AA202','ROS_W_48D2171BD2C6','ROS_W_FC1E32762BF9','ROS_W_F5C3FEDD4772'].forEach(function(id){ out[id] = true; });
  return out;
}

function v315LoadState_() {
  const text = PropertiesService.getScriptProperties().getProperty(AKORT_V315_SPECIAL.STATE_PROPERTY);
  return text ? JSON.parse(text) : null;
}

function v315SaveState_(state) {
  PropertiesService.getScriptProperties().setProperty(AKORT_V315_SPECIAL.STATE_PROPERTY, JSON.stringify(state));
}

function v315EnsureAggregateSchema_() {
  const ss = v300Publish_();
  const required = AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES;
  const sheet = v300EnsureSheet_(
    ss,
    AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,
    required,
    2,
    required.length
  );
  const lastCol = Math.max(sheet.getLastColumn(), required.length);
  const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v300Text_);
  const have = {};
  current.forEach(function(header) { if (header) have[header] = true; });
  const missing = required.filter(function(header) { return !have[header]; });
  if (!missing.length) return 0;
  const start = sheet.getLastColumn() + 1;
  const requiredMaxColumn = start + missing.length - 1;
  if (sheet.getMaxColumns() < requiredMaxColumn) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredMaxColumn - sheet.getMaxColumns());
  }
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  v300StyleHeader_(sheet, requiredMaxColumn);
  return missing.length;
}

// Backward-compatible internal names used by 93_IncrementalUpdateV310.js.
function v314EnsureAggregateSchema_() { return v315EnsureAggregateSchema_(); }
function v314IsAkortDataset_(datasetCode) { return v315IsAkortDataset_(datasetCode); }
function v314BorshchCategorySet_() { return v315BorshchCategorySet_(); }
function v314BuildBorshchCustomGroupRows_(categoryRows) {
  const borshch = v315BorshchCategorySet_();
  const groups = {};
  (categoryRows || []).forEach(function(r) {
    if (!borshch[v300Text_(r.category_id)]) return;
    if (v300ValueType_(r.value_type) === 'наценка, %' || v300ValueType_(r.value_type) === 'наценка, руб.') return;
    const change = v300Number_(r.category_change_pp);
    const weight = v300Number_(r.category_weight);
    if (change === null || weight === null || weight <= 0) return;
    const period = v300DateKey_(r.period_start);
    const key = ['custom_group', r.dataset_code, r.frequency, r.value_type, r.index_type || '', period].join('|');
    if (!groups[key]) groups[key] = {rows:[], sample:r, weightSum:0, weightedChange:0, latest:0};
    groups[key].rows.push(r);
    groups[key].weightSum += weight;
    groups[key].weightedChange += weight * change;
    if (v300Bool01_(r.is_latest_period) === 1) groups[key].latest = 1;
  });
  const out = [];
  Object.keys(groups).forEach(function(k) {
    const g = groups[k], s = g.sample;
    if (!g.weightSum) return;
    const period = v300Date_(s.period_start);
    out.push({
      dataset_code:s.dataset_code, source_name:s.source_name, frequency:s.frequency,
      aggregate_level:'custom_group', aggregate_id:v300Id_('AGG_BORSHCH', k), aggregate_name:AKORT_V315_SPECIAL.BORSCH_NAME,
      category_id:'', product_group:'Овощи и фрукты', product_name:'', value_type:s.value_type, index_type:s.index_type,
      period_start:period, year:period.getFullYear(), quarter:v300Quarter_(period.getMonth()+1), month:period.getMonth()+1, period_label:s.period_label,
      category_value:'', category_change_pp:'', category_weight:'', aggregate_change_pp:v300Round_(g.weightedChange / g.weightSum, 6),
      contribution_to_group_change_pp:'', contribution_to_basket_change_pp:'', contribution_to_total_cpi_pp:'', weight_source:s.weight_source,
      coverage_categories_count:g.rows.length, coverage_weight_sum:v300Round_(g.weightSum, 10), is_latest_period:g.latest,
      aggregate_value:'', aggregate_base_value:''
    });
  });
  return out;
}
function v314BuildAkortAggregateMarkupPctRows_(comboIndex) {
  // The ordinary incremental updater may call this for a small set of changed periods.
  // Reuse the all-period builder, then filter by comboIndex to keep the result bounded.
  const all = []
    .concat(v315BuildAkortMarkupRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, 'weekly', v304WeightIndex_()))
    .concat(v315BuildAkortMarkupRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, 'monthly', v304WeightIndex_()));
  if (!comboIndex || !Object.keys(comboIndex).length) return all;
  return all.filter(function(r) {
    return comboIndex[v310ComboKey_({frequency:r.frequency, datasetCode:r.dataset_code, period:v300DateKey_(r.period_start), valueType:r.value_type, indexType:r.index_type})];
  });
}

function v310pSundayOfIsoWeek_(isoYear, isoWeek) {
  var simple=new Date(Date.UTC(Number(isoYear),0,4)),day=simple.getUTCDay()||7,monday=new Date(simple),sunday;
  monday.setUTCDate(simple.getUTCDate()-day+1+(Number(isoWeek)-1)*7);sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);return v300Noon_(sunday.getUTCFullYear(),sunday.getUTCMonth(),sunday.getUTCDate());
}
function v310ApplyIncrementalPublish_(affected) {
  const targets = v310ExpandAffectedTargets_(affected || []);
  let weeklyRows = 0, monthlyRows = 0;
  if (targets.weekly.length) weeklyRows = v310UpdateWeeklyPublish_(targets.weekly);
  if (targets.monthly.length) monthlyRows = v310UpdateMonthlyPublish_(targets.monthly);
  return {publishRows: weeklyRows + monthlyRows, aggregateRows: 0, aggregateImpactCount: targets.aggregates.length, aggregateExecutionStatus: ALPHA6_SCOPE.aggregateExecutionStatus};
}

function v310AggregateIndexTypes_(frequency, indexType) {
  const normalized = v300IndexType_(indexType || '');
  const allowed = frequency === 'weekly' ? ['wow','yoy','december'] : ['mom','yoy','december'];
  return normalized && allowed.indexOf(normalized) >= 0 ? [normalized] : allowed.slice();
}
function v310AggregateFrontierKey_(frequency, datasetCode, period) {
  const normalized = frequency === 'weekly' ? v300DateKey_(period) : v300MonthKey_(period);
  return [frequency, v300Text_(datasetCode), normalized].join('|');
}
function v310FrontierAllows_(frontier, frequency, datasetCode, sourcePeriod, candidatePeriod) {
  if (!frontier) return true;
  const source = frequency === 'weekly' ? v300DateKey_(sourcePeriod) : v300MonthKey_(sourcePeriod);
  const candidate = frequency === 'weekly' ? v300DateKey_(candidatePeriod) : v300MonthKey_(candidatePeriod);
  if (!candidate) return false;
  if (candidate === source) return true;
  return frontier[v310AggregateFrontierKey_(frequency, datasetCode, candidate)] === true;
}
function v310AddAggregateCombos_(out, target, options) {
  const frequency = target.frequency, periods = frequency === 'weekly' ? v310WeeklyDependentPeriods_(target.period) : v310MonthlyDependentPeriods_(target.period);
  const indexTypes = v310AggregateIndexTypes_(frequency, target.indexType || ''), frontier = options && options.aggregateFrontier;
  periods.forEach(function(period) {
    if (!v310FrontierAllows_(frontier, frequency, target.datasetCode, target.period, period)) return;
    indexTypes.forEach(function(indexType) {
      out.push({frequency:frequency, datasetCode:target.datasetCode, period:period, valueType:target.valueType, indexType:indexType});
    });
  });
}
function v310ExpandAffectedTargets_(affected, options) {
  const weekly = [], monthly = [], aggregateCombos = [];
  const addWeekly = function(t){ weekly.push(t); v310AddAggregateCombos_(aggregateCombos, t, options || {}); };
  const addMonthly = function(t){ monthly.push(t); v310AddAggregateCombos_(aggregateCombos, t, options || {}); };

  (affected || []).forEach(function(a) {
    if (!a || !a.period) return;
    const base = {frequency:a.frequency, datasetCode:a.datasetCode, categoryId:a.categoryId, valueType:v300ValueType_(a.valueType), indexType:v300IndexType_(a.indexType || ''), period:a.period};
    if (base.frequency === 'weekly') {
      addWeekly(base);
      if (base.datasetCode === AKORT_V300.DATASETS.AKORT_WEEKLY && (base.valueType === 'закупка' || base.valueType === 'розница')) {
        addWeekly(Object.assign({}, base, {valueType:'наценка, %', indexType:''}));
        const d = v300Date_(base.period);
        if (d) {
          const m = v300MonthKey_(v300MonthStart_(d));
          addMonthly({frequency:'monthly', datasetCode:AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED, categoryId:base.categoryId, valueType:base.valueType, indexType:'', period:m});
          addMonthly({frequency:'monthly', datasetCode:AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED, categoryId:base.categoryId, valueType:'наценка, %', indexType:'', period:m});
        }
      }
    } else {
      addMonthly(base);
      if ((base.datasetCode === AKORT_V300.DATASETS.AKORT_MONTHLY || base.datasetCode === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED) && (base.valueType === 'закупка' || base.valueType === 'розница')) {
        addMonthly(Object.assign({}, base, {valueType:'наценка, %', indexType:''}));
      }
    }
  });
  return {weekly:v310MergeAffected_([], weekly), monthly:v310MergeAffected_([], monthly), aggregates:v310MergeCombos_(aggregateCombos)};
}

function v310UpdateWeeklyPublish_(targets) {
  const rows = v310BuildWeeklyRowsForTargets_(targets);
  const seriesIds = v310Unique_(rows.map(function(r){return r.series_id;}));
  if (!seriesIds.length) return 0;
  v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, seriesIds, v300ObjectsToRows_(rows, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY), v300FormatRows_().weeklyPublish);
  return rows.length;
}

function v310BuildWeeklyRowsForTargets_(targets) {
  const products = v300ProductMap_();
  const raw = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY, AKORT_V300.HEADERS.RAW_PRICES_WEEKLY);
  const descriptors = v310WeeklyDescriptors_(targets);
  let out = [];
  descriptors.forEach(function(d) {
    if (d.seriesType === 'CALCULATED_MARKUP') out = out.concat(v310BuildWeeklyMarkupSeries_(raw, products, d));
    else out = out.concat(v310BuildWeeklyOfficialSeries_(raw, products, d));
  });
  v310CalculateWeeklyDynamics_(out);
  v310SetLatestBySeries_(out, 'observation_date');
  out.sort(v300PublishSort_('observation_date'));
  return out;
}

function v310WeeklyDescriptors_(targets) {
  const out = [];
  (targets || []).forEach(function(t) {
    const vt = v300ValueType_(t.valueType);
    const dataset = v300Text_(t.datasetCode);
    let seriesType = 'OFFICIAL_WEEKLY';
    if (v300IsIndexValueType_(vt)) seriesType = 'OFFICIAL_WEEKLY_INDEX';
    if (v300IsMarkupValueType_(vt)) seriesType = 'CALCULATED_MARKUP';
    out.push({datasetCode:dataset, categoryId:v300Text_(t.categoryId), valueType:vt, indexType:v300IndexType_(t.indexType || ''), seriesType:seriesType});
  });
  return v310UniqueDescriptors_(out);
}

function v310BuildWeeklyOfficialSeries_(raw, products, d) {
  const rows = [];
  raw.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== d.datasetCode) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    if (v300ValueType_(r.value_type) !== d.valueType) return;
    if (v300IndexType_(r.index_type || '') !== d.indexType) return;
    const date = v300DateOnly_(r.observation_date), value = v300Number_(r.value);
    if (!date || value === null) return;
    rows.push(v310WeeklyRow_(products, d.datasetCode, d.categoryId, d.valueType, d.indexType, d.seriesType, date, value));
  });
  return rows;
}

function v310BuildWeeklyMarkupSeries_(raw, products, d) {
  const byDate = {};
  raw.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== AKORT_V300.DATASETS.AKORT_WEEKLY) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    const vt = v300ValueType_(r.value_type);
    if (vt !== 'закупка' && vt !== 'розница') return;
    const date = v300DateOnly_(r.observation_date), value = v300Number_(r.value);
    if (!date || value === null) return;
    const k = v300DateKey_(date);
    if (!byDate[k]) byDate[k] = {date:date};
    byDate[k][vt] = value;
  });
  const rows = [];
  Object.keys(byDate).forEach(function(k) {
    const g = byDate[k];
    if (g['закупка'] === undefined || g['розница'] === undefined || Number(g['закупка']) === 0) return;
    const abs = Number(g['розница']) - Number(g['закупка']);
    const val = d.valueType === 'наценка, %' ? abs / Number(g['закупка']) * 100 : abs;
    rows.push(v310WeeklyRow_(products, AKORT_V300.DATASETS.AKORT_WEEKLY, d.categoryId, d.valueType, '', 'CALCULATED_MARKUP', g.date, val));
  });
  return rows;
}

function v310WeeklyRow_(products, datasetCode, categoryId, valueType, indexType, seriesType, date, value) {
  const product = products[categoryId] || {};
  const iso = v300Iso_(date);
  const vt = v300ValueType_(valueType);
  return {
    dataset_code:datasetCode,
    source_name:v300SourceName_(datasetCode),
    series_id:v300SeriesId_(datasetCode, categoryId, vt, seriesType, indexType || ''),
    indicator_key:v300IndicatorKey_(datasetCode, vt, seriesType),
    indicator_name:v300IndicatorName_(vt),
    product_group:v300Text_(product.product_group),
    category_id:categoryId,
    product_name:v300Text_(product.product_name) || categoryId,
    value_type:vt,
    index_type:v300IndexType_(indexType || ''),
    series_type:seriesType,
    unit:v300PriceUnit_(product.unit, vt),
    sort_order:v300Int_(product.sort_order) || 999,
    observation_date:date,
    year:date.getFullYear(),
    quarter:v300Quarter_(date.getMonth()+1),
    month:date.getMonth()+1,
    iso_year:iso.year,
    iso_week:iso.week,
    period_label:iso.year + '-W' + v300Pad2_(iso.week),
    current_value:v300Round_(value, 6),
    previous_week_value:'', wow_abs:'', wow_pct:'', previous_year_value:'', yoy_abs:'', yoy_pct:'', december_base_value:'', december_abs:'', december_pct:'', moving_average_4w:'', ma4_deviation_pct:'', markup_wow_pp:'', markup_yoy_pp:'', markup_december_pp:'', is_latest_period:0
  };
}

function v310CalculateWeeklyDynamics_(rows) {
  const groups = v300GroupBy_(rows, 'series_id');
  Object.keys(groups).forEach(function(seriesId) {
    const series = groups[seriesId].sort(function(a,b){return a.observation_date - b.observation_date;});
    const isoMap = {}, december = {};
    series.forEach(function(row) {
      isoMap[row.iso_year + '-W' + v300Pad2_(row.iso_week)] = row;
      if (row.month === 12) december[row.year] = row;
    });
    series.forEach(function(row, i) {
      if (v300IsIndexValueType_(row.value_type)) {
        row.wow_pct = v300Round_(Number(row.current_value) - 100, 6);
        return;
      }
      const previous = i ? series[i - 1] : null;
      if (previous) {
        row.previous_week_value = previous.current_value;
        row.wow_abs = v300Round_(Number(row.current_value) - Number(previous.current_value), 6);
        row.wow_pct = v300Pct_(row.current_value, previous.current_value);
      }
      const priorYear = isoMap[(Number(row.iso_year) - 1) + '-W' + v300Pad2_(row.iso_week)];
      if (priorYear) {
        row.previous_year_value = priorYear.current_value;
        row.yoy_abs = v300Round_(Number(row.current_value) - Number(priorYear.current_value), 6);
        row.yoy_pct = v300Pct_(row.current_value, priorYear.current_value);
      }
      const base = december[row.year - 1];
      if (base) {
        row.december_base_value = base.current_value;
        row.december_abs = v300Round_(Number(row.current_value) - Number(base.current_value), 6);
        row.december_pct = v300Pct_(row.current_value, base.current_value);
      }
      const start = Math.max(0, i - 3), window = series.slice(start, i + 1);
      if (window.length === 4) {
        const mean = window.reduce(function(sum, r){return sum + Number(r.current_value);},0) / 4;
        row.moving_average_4w = v300Round_(mean, 6);
        row.ma4_deviation_pct = v300Pct_(row.current_value, mean);
      }
    });
  });
}

function v310UpdateMonthlyPublish_(targets) {
  const rows = v310BuildMonthlyRowsForTargets_(targets);
  const seriesIds = v310Unique_(rows.map(function(r){return r.series_id;}));
  if (!seriesIds.length) return 0;
  v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, seriesIds, v300ObjectsToRows_(rows, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY), v300FormatRows_().monthlyPublish);
  return rows.length;
}

function v310BuildMonthlyRowsForTargets_(targets) {
  const products = v300ProductMap_();
  const rawM = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_MONTHLY, AKORT_V300.HEADERS.RAW_PRICES_MONTHLY);
  const rawW = v300LatestRawObjects_(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY, AKORT_V300.HEADERS.RAW_PRICES_WEEKLY);
  const desc = v310MonthlyDescriptors_(targets);
  let out = [];
  desc.forEach(function(d) {
    if (d.datasetCode === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED) out = out.concat(v310BuildDerivedMonthlySeries_(rawW, products, d));
    else if (d.seriesType === 'CALCULATED_MARKUP') out = out.concat(v310BuildMonthlyMarkupSeries_(rawM, products, d));
    else if (d.seriesType === 'OFFICIAL_MONTHLY_INDEX') out = out.concat(v310BuildMonthlyIndexSeries_(rawM, products, d));
    else out = out.concat(v310BuildMonthlyOfficialSeries_(rawM, products, d));
  });
  v310CalculateMonthlyDynamics_(out);
  v310SetLatestBySeries_(out, 'month_start');
  out.sort(v300PublishSort_('month_start'));
  return out;
}

function v310MonthlyDescriptors_(targets) {
  const out = [];
  (targets || []).forEach(function(t) {
    const vt = v300ValueType_(t.valueType), dataset = v300Text_(t.datasetCode);
    let seriesType = 'OFFICIAL_MONTHLY';
    if (v300IsIndexValueType_(vt)) seriesType = 'OFFICIAL_MONTHLY_INDEX';
    if (v300IsMarkupValueType_(vt)) seriesType = 'CALCULATED_MARKUP';
    if (dataset === AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED && !v300IsMarkupValueType_(vt)) seriesType = 'DERIVED_FROM_WEEKLY';
    out.push({datasetCode:dataset, categoryId:v300Text_(t.categoryId), valueType:vt, indexType:v300IndexType_(t.indexType || ''), seriesType:seriesType});
  });
  return v310UniqueDescriptors_(out);
}

function v310BuildMonthlyOfficialSeries_(raw, products, d) {
  const rows = [];
  raw.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== d.datasetCode) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    if (v300ValueType_(r.value_type) !== d.valueType) return;
    if (v300IndexType_(r.index_type || '') !== '') return;
    const month = v300MonthStart_(r.observation_month), value = v300Number_(r.value);
    if (!month || value === null) return;
    rows.push(v310MonthlyRow_(products, d.datasetCode, d.categoryId, d.valueType, '', 'OFFICIAL_MONTHLY', month, value, 'COMPLETE'));
  });
  return rows;
}

function v310BuildMonthlyIndexSeries_(raw, products, d) {
  const byMonth = {};
  raw.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== d.datasetCode) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    if (v300ValueType_(r.value_type) !== d.valueType) return;
    const idx = v300IndexType_(r.index_type || '');
    if (['mom','yoy','december'].indexOf(idx) < 0) return;
    const month = v300MonthStart_(r.observation_month), value = v300Number_(r.value);
    if (!month || value === null) return;
    const k = v300MonthKey_(month);
    if (!byMonth[k]) byMonth[k] = {month:month, values:{}};
    byMonth[k].values[idx] = value;
  });
  const rows = [];
  Object.keys(byMonth).forEach(function(k) {
    const item = byMonth[k], row = v310MonthlyRow_(products, d.datasetCode, d.categoryId, d.valueType, '', 'OFFICIAL_MONTHLY_INDEX', item.month, '', 'COMPLETE');
    if (item.values.mom !== undefined) row.mom_pct = v300Round_(Number(item.values.mom) - 100, 6);
    if (item.values.yoy !== undefined) row.yoy_pct = v300Round_(Number(item.values.yoy) - 100, 6);
    if (item.values.december !== undefined) row.december_pct = v300Round_(Number(item.values.december) - 100, 6);
    rows.push(row);
  });
  return rows;
}

function v310BuildMonthlyMarkupSeries_(raw, products, d) {
  const byMonth = {};
  raw.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== d.datasetCode) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    const vt = v300ValueType_(r.value_type);
    if (vt !== 'закупка' && vt !== 'розница') return;
    const month = v300MonthStart_(r.observation_month), value = v300Number_(r.value);
    if (!month || value === null) return;
    const k = v300MonthKey_(month);
    if (!byMonth[k]) byMonth[k] = {month:month};
    byMonth[k][vt] = value;
  });
  const rows = [];
  Object.keys(byMonth).forEach(function(k) {
    const g = byMonth[k];
    if (g['закупка'] === undefined || g['розница'] === undefined || Number(g['закупка']) === 0) return;
    const abs = Number(g['розница']) - Number(g['закупка']);
    const val = d.valueType === 'наценка, %' ? abs / Number(g['закупка']) * 100 : abs;
    rows.push(v310MonthlyRow_(products, d.datasetCode, d.categoryId, d.valueType, '', 'CALCULATED_MARKUP', g.month, val, 'COMPLETE'));
  });
  return rows;
}

function v310BuildDerivedMonthlySeries_(rawW, products, d) {
  const byMonth = {};
  rawW.forEach(function(r) {
    if (v300Text_(r.dataset_code) !== AKORT_V300.DATASETS.AKORT_WEEKLY) return;
    if (v300Text_(r.category_id) !== d.categoryId) return;
    if (v300ValueType_(r.value_type) !== d.valueType) return;
    const date = v300DateOnly_(r.observation_date), value = v300Number_(r.value);
    if (!date || value === null) return;
    const month = v300MonthStart_(date), key = v300MonthKey_(month);
    if (!byMonth[key]) byMonth[key] = {month:month, values:[]};
    byMonth[key].values.push(value);
  });
  const rows = [];
  Object.keys(byMonth).forEach(function(k) {
    const g = byMonth[k], expected = v300SundaysInMonth_(g.month);
    const mean = g.values.reduce(function(a,b){return a + b;},0) / g.values.length;
    rows.push(v310MonthlyRow_(products, AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED, d.categoryId, d.valueType, '', 'DERIVED_FROM_WEEKLY', g.month, mean, g.values.length === expected ? 'COMPLETE' : 'PARTIAL'));
  });
  return rows;
}

function v310MonthlyRow_(products, datasetCode, categoryId, valueType, indexType, seriesType, month, value, completeness) {
  const product = products[categoryId] || {}, vt = v300ValueType_(valueType);
  return {
    dataset_code:datasetCode,
    source_name:v300SourceName_(datasetCode),
    series_id:v300SeriesId_(datasetCode, categoryId, vt, seriesType, indexType || ''),
    indicator_key:v300IndicatorKey_(datasetCode, vt, seriesType),
    indicator_name:v300IndicatorName_(vt),
    product_group:v300Text_(product.product_group),
    category_id:categoryId,
    product_name:v300Text_(product.product_name) || categoryId,
    value_type:vt,
    index_type:v300IndexType_(indexType || ''),
    series_type:seriesType,
    unit:v300PriceUnit_(product.unit, vt),
    sort_order:v300Int_(product.sort_order) || 999,
    month_start:month,
    year:month.getFullYear(),
    quarter:v300Quarter_(month.getMonth()+1),
    month:month.getMonth()+1,
    period_label:v300MonthKey_(month),
    current_value:value === '' ? '' : v300Round_(value, 6),
    previous_month_value:'', mom_abs:'', mom_pct:'', previous_year_value:'', yoy_abs:'', yoy_pct:'', december_base_value:'', december_abs:'', december_pct:'', markup_mom_pp:'', markup_yoy_pp:'', markup_december_pp:'', period_completeness:completeness || 'COMPLETE', is_latest_period:0
  };
}

function v310CalculateMonthlyDynamics_(rows) {
  const groups = v300GroupBy_(rows, 'series_id');
  Object.keys(groups).forEach(function(seriesId) {
    const series = groups[seriesId].sort(function(a,b){return a.month_start - b.month_start;});
    const monthMap = {}, december = {};
    series.forEach(function(row) {
      monthMap[v300MonthKey_(row.month_start)] = row;
      if (row.month === 12) december[row.year] = row;
    });
    series.forEach(function(row, i) {
      if (v300IsIndexValueType_(row.value_type)) return;
      const previous = i ? series[i - 1] : null;
      if (previous) {
        row.previous_month_value = previous.current_value;
        row.mom_abs = v300Round_(Number(row.current_value) - Number(previous.current_value), 6);
        row.mom_pct = v300Pct_(row.current_value, previous.current_value);
      }
      const py = monthMap[(Number(row.year) - 1) + '-' + v300Pad2_(row.month)];
      if (py) {
        row.previous_year_value = py.current_value;
        row.yoy_abs = v300Round_(Number(row.current_value) - Number(py.current_value), 6);
        row.yoy_pct = v300Pct_(row.current_value, py.current_value);
      }
      const base = december[row.year - 1];
      if (base) {
        row.december_base_value = base.current_value;
        row.december_abs = v300Round_(Number(row.current_value) - Number(base.current_value), 6);
        row.december_pct = v300Pct_(row.current_value, base.current_value);
      }
    });
  });
}

function v310UpdateAggregates_(combos) {
  if (typeof v314EnsureAggregateSchema_ === 'function') v314EnsureAggregateSchema_();
  const comboIndex = {};
  (combos || []).forEach(function(c){ comboIndex[v310ComboKey_(c)] = true; });
  const comboKeys = Object.keys(comboIndex);
  if (!comboKeys.length) return 0;
  const sheet = v300Publish_().getSheetByName(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES);
  const headers = AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES;
  if (!sheet) throw new Error('Не найден лист PUBLISH_PRICE_AGGREGATES.');
  const existing = v300ReadObjects_(sheet, headers);
  const toDelete = [];
  existing.forEach(function(r) {
    if (comboIndex[v310ComboKey_({frequency:r.frequency, datasetCode:r.dataset_code, period:v300DateKey_(r.period_start), valueType:r.value_type, indexType:r.index_type || ''})]) toDelete.push(r._rowNumber);
  });
  if (toDelete.length) v300DeleteRows_(v300Publish_(), sheet, toDelete);
  const newObjects = v310BuildAggregateRowsForCombos_(comboIndex);
  const rows = v300ObjectsToRows_(newObjects, headers);
  for (let i = 0; i < rows.length; i += 1000) v300AppendRows_(sheet, headers, rows.slice(i, i + 1000));
  if (rows.length) v300ApplyFormats_(sheet, v300FormatRows_().priceAggregatesPublish);
  return rows.length;
}

function v310BuildAggregateRowsForCombos_(comboIndex) {
  const weights = v304WeightIndex_();
  let categoryRows = [];
  categoryRows = categoryRows.concat(v310AggregateCategoryRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY, AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY, 'weekly', comboIndex, weights));
  categoryRows = categoryRows.concat(v310AggregateCategoryRowsFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY, AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY, 'monthly', comboIndex, weights));
  // Для агрегированной наценки АКОРТ в процентах не считаем вклад категорий и не усредняем проценты.
  // Она рассчитывается отдельной функцией через агрегированные закупку и розницу.
  categoryRows = categoryRows.filter(function(r) {
    return !(v314IsAkortDataset_(r.dataset_code) && v300ValueType_(r.value_type) === 'наценка, %');
  });
  const totals = [];
  totals.push.apply(totals, v310AggregateTotals_(categoryRows, 'group'));
  totals.push.apply(totals, v310AggregateTotals_(categoryRows, 'basket'));
  totals.push.apply(totals, v310AggregateTotals_(categoryRows, 'total_cpi'));
  if (typeof v314BuildBorshchCustomGroupRows_ === 'function') totals.push.apply(totals, v314BuildBorshchCustomGroupRows_(categoryRows));
  if (typeof v314BuildAkortAggregateMarkupPctRows_ === 'function') totals.push.apply(totals, v314BuildAkortAggregateMarkupPctRows_(comboIndex));
  return categoryRows.concat(totals);
}

function v310AggregateCategoryRowsFromPublish_(sheetName, headers, frequency, comboIndex, weights) {
  const sheet = v300Publish_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = v300ReadObjects_(sheet, headers), out = [];
  rows.forEach(function(row) {
    const period = frequency === 'weekly' ? v300Date_(row.observation_date) : v300Date_(row.month_start);
    if (!period) return;
    const changes = v310ChangesFromPublishRow_(row, frequency);
    Object.keys(changes).forEach(function(indexType) {
      const combo = {frequency:frequency, datasetCode:row.dataset_code, period:v300DateKey_(period), valueType:row.value_type, indexType:indexType};
      if (!comboIndex[v310ComboKey_(combo)]) return;
      const categoryId = v300Text_(row.category_id), dataset = v300Text_(row.dataset_code), valueType = v300ValueType_(row.value_type);
      const change = changes[indexType];
      const weightSource = dataset.indexOf('AKORT') === 0 ? 'AKORT_SALES_WEIGHTS' : 'ROSSTAT_CPI_WEIGHTS';
      const basketScope = dataset.indexOf('AKORT') === 0 ? 'akort_basket' : 'dashboard_basket';
      const groupWeight = weights[[weightSource, 'group', categoryId].join('|')];
      const basketWeight = weights[[weightSource, basketScope, categoryId].join('|')];
      const totalCpiWeight = weights[['ROSSTAT_CPI_WEIGHTS', 'total_cpi', categoryId].join('|')];
      out.push({
        dataset_code: dataset,
        source_name: row.source_name,
        frequency: frequency,
        aggregate_level: 'category',
        aggregate_id: v300Id_('AGG_CAT', [dataset, frequency, valueType, indexType, categoryId].join('|')),
        aggregate_name: 'Вклад категории',
        category_id: categoryId,
        product_group: row.product_group,
        product_name: row.product_name,
        value_type: valueType,
        index_type: indexType,
        period_start: period,
        year: period.getFullYear(),
        quarter: v300Quarter_(period.getMonth()+1),
        month: period.getMonth()+1,
        period_label: row.period_label,
        category_value: row.current_value,
        category_change_pp: change,
        category_weight: basketWeight === undefined ? '' : basketWeight,
        aggregate_change_pp: '',
        contribution_to_group_change_pp: groupWeight === undefined ? '' : v300Round_(Number(groupWeight) * Number(change), 6),
        contribution_to_basket_change_pp: basketWeight === undefined ? '' : v300Round_(Number(basketWeight) * Number(change), 6),
        contribution_to_total_cpi_pp: (frequency === 'monthly' && dataset === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && valueType === 'ИПЦ' && totalCpiWeight !== undefined) ? v300Round_(Number(totalCpiWeight) * Number(change), 6) : '',
        weight_source: weightSource,
        coverage_categories_count: '',
        coverage_weight_sum: '',
        is_latest_period: v300Bool01_(row.is_latest_period)
      });
    });
  });
  return out;
}

function v310AggregateTotals_(cats, level) {
  const groups = {};
  cats.forEach(function(r) {
    if (level === 'total_cpi' && !(r.frequency === 'monthly' && r.dataset_code === AKORT_V300.DATASETS.ROSSTAT_MONTHLY && r.value_type === 'ИПЦ')) return;
    const period = v300DateKey_(r.period_start);
    const keyParts = [level, r.dataset_code, r.frequency, r.value_type, r.index_type, period];
    if (level === 'group') keyParts.push(r.product_group || '');
    const key = keyParts.join('|');
    if (!groups[key]) groups[key] = {rows:[], sample:r};
    groups[key].rows.push(r);
  });
  const out = [];
  Object.keys(groups).forEach(function(k) {
    const g = groups[k], rows = g.rows, s = g.sample;
    const period = v300Date_(s.period_start);
    let sum = 0, cov = 0, count = 0, latest = 0;
    rows.forEach(function(r) {
      let v = '';
      if (level === 'group') v = r.contribution_to_group_change_pp;
      if (level === 'basket') v = r.contribution_to_basket_change_pp;
      if (level === 'total_cpi') v = r.contribution_to_total_cpi_pp;
      if (v !== '' && v !== null && v !== undefined && !isNaN(Number(v))) { sum += Number(v); count++; }
      if (r.category_weight !== '' && r.category_weight !== null && r.category_weight !== undefined && !isNaN(Number(r.category_weight))) cov += Number(r.category_weight);
      if (v300Bool01_(r.is_latest_period) === 1) latest = 1;
    });
    if (!count) return;
    out.push({
      dataset_code:s.dataset_code,
      source_name:s.source_name,
      frequency:s.frequency,
      aggregate_level:level,
      aggregate_id:v300Id_('AGG', k),
      aggregate_name:level === 'group' ? s.product_group : (level === 'basket' ? 'Корзина дашборда' : 'Вклад в общую инфляцию'),
      category_id:'', product_group:level === 'group' ? s.product_group : '', product_name:'',
      value_type:s.value_type,
      index_type:s.index_type,
      period_start:period,
      year:period.getFullYear(),
      quarter:v300Quarter_(period.getMonth()+1),
      month:period.getMonth()+1,
      period_label:s.period_label,
      category_value:'', category_change_pp:'', category_weight:'',
      aggregate_change_pp:v300Round_(sum, 6), contribution_to_group_change_pp:'', contribution_to_basket_change_pp:'', contribution_to_total_cpi_pp:'',
      weight_source:s.weight_source,
      coverage_categories_count:count,
      coverage_weight_sum:v300Round_(cov, 10),
      is_latest_period:latest
    });
  });
  return out;
}

function v310ChangesFromPublishRow_(row, frequency) {
  const result = {};
  if (frequency === 'weekly') {
    if (v310HasValue_(row.wow_pct)) result.wow = v300Number_(row.wow_pct);
    if (v310HasValue_(row.yoy_pct)) result.yoy = v300Number_(row.yoy_pct);
    if (v310HasValue_(row.december_pct)) result.december = v300Number_(row.december_pct);
  } else {
    if (v310HasValue_(row.mom_pct)) result.mom = v300Number_(row.mom_pct);
    if (v310HasValue_(row.yoy_pct)) result.yoy = v300Number_(row.yoy_pct);
    if (v310HasValue_(row.december_pct)) result.december = v300Number_(row.december_pct);
  }
  Object.keys(result).forEach(function(k){ if (result[k] === null || result[k] === undefined || isNaN(Number(result[k]))) delete result[k]; });
  return result;
}

function v310ReplacePublishRowsBySeries_(sheetName, headers, seriesIds, newRows, formats) {
  const ss = v300Publish_();
  const sheet = v300EnsureSheet_(ss, sheetName, headers, 2, headers.length);
  const set = {};
  seriesIds.forEach(function(id){ if (id) set[id] = true; });
  const rows = v300ReadObjects_(sheet, headers), toDelete = [];
  rows.forEach(function(r){ if (set[v300Text_(r.series_id)]) toDelete.push(r._rowNumber); });
  if (toDelete.length) v300DeleteRows_(ss, sheet, toDelete);
  for (let i = 0; i < newRows.length; i += 1000) v300AppendRows_(sheet, headers, newRows.slice(i, i + 1000));
  if (formats) v300ApplyFormats_(sheet, formats);
}

function v310SetLatestBySeries_(rows, field) {
  const latest = {};
  rows.forEach(function(r) {
    const d = v300Date_(r[field]);
    if (!d) return;
    const sid = v300Text_(r.series_id);
    if (!latest[sid] || d > latest[sid]) latest[sid] = d;
  });
  rows.forEach(function(r) {
    const d = v300Date_(r[field]), sid = v300Text_(r.series_id);
    r.is_latest_period = d && latest[sid] && v300DateKey_(d) === v300DateKey_(latest[sid]) ? 1 : 0;
  });
}

function v310WeeklyDependentPeriods_(periodKey) {
  const d = v300Date_(periodKey), out = [];
  if (!d) return out;
  out.push(v300DateKey_(d));
  const next = new Date(d.getTime()); next.setDate(next.getDate() + 7); out.push(v300DateKey_(next));
  const iso = v300Iso_(d);
  try { out.push(v300DateKey_(v310pSundayOfIsoWeek_(Number(iso.year) + 1, Number(iso.week)))); } catch (e) {}
  if (d.getMonth() === 11) {
    for (let i = 1; i <= 53; i++) {
      try { out.push(v300DateKey_(v310pSundayOfIsoWeek_(d.getFullYear()+1, i))); } catch (ignore) {}
    }
  }
  return v310Unique_(out.filter(Boolean));
}

function v310MonthlyDependentPeriods_(periodKey) {
  const d = v300MonthStart_(periodKey), out = [];
  if (!d) return out;
  out.push(v300MonthKey_(d));
  out.push(v300MonthKey_(v300Noon_(d.getFullYear(), d.getMonth()+1, 1)));
  out.push(v300MonthKey_(v300Noon_(d.getFullYear()+1, d.getMonth(), 1)));
  if (d.getMonth() === 11) for (let m = 0; m < 12; m++) out.push(v300MonthKey_(v300Noon_(d.getFullYear()+1, m, 1)));
  return v310Unique_(out.filter(Boolean));
}

function v310ComboKey_(c) {
  const d = v300Date_(c.period || c.period_start);
  return [v300Text_(c.frequency), v300Text_(c.datasetCode || c.dataset_code), d ? v300DateKey_(d) : v300Text_(c.period), v300ValueType_(c.valueType || c.value_type), v300IndexType_(c.indexType || c.index_type || '')].join('|');
}
function v310MergeAffected_(base, add) {
  const map = {};
  (base || []).concat(add || []).forEach(function(a) {
    if (!a) return;
    const key = [a.frequency, a.datasetCode, a.categoryId, v300ValueType_(a.valueType), v300IndexType_(a.indexType || ''), a.period].join('|');
    if (!map[key]) map[key] = {frequency:a.frequency, datasetCode:a.datasetCode, categoryId:a.categoryId, valueType:v300ValueType_(a.valueType), indexType:v300IndexType_(a.indexType || ''), period:a.period};
  });
  return Object.keys(map).map(function(k){return map[k];});
}
function v310MergeCombos_(combos) {
  const map = {};
  (combos || []).forEach(function(c){ map[v310ComboKey_(c)] = c; });
  return Object.keys(map).map(function(k){return map[k];});
}
function v310UniqueDescriptors_(arr) {
  const map = {};
  arr.forEach(function(d){ const k = [d.datasetCode,d.categoryId,d.valueType,d.indexType || '',d.seriesType].join('|'); if (!map[k]) map[k] = d; });
  return Object.keys(map).map(function(k){return map[k];});
}
function v310Unique_(arr) { const m = {}; (arr || []).forEach(function(x){ if (x !== '' && x !== null && x !== undefined) m[String(x)] = x; }); return Object.keys(m).map(function(k){return m[k];}); }
function v310HasValue_(v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); }


  function v317PriceSeriesKey_(row) {
    var seriesId = v300Text_(row.series_id);
    return seriesId || [v300Text_(row.dataset_code),v300Text_(row.category_id),v300ValueType_(row.value_type),v300IndexType_(row.index_type || ''),v300Text_(row.series_type)].join('|');
  }
  function v317IndustrySeriesKey_(row) {
    var seriesId = v300Text_(row.series_id);
    return seriesId || [v300Text_(row.dataset_code),v300Text_(row.indicator_name),v300Text_(row.classification_1),v300Text_(row.classification_2),v300Text_(row.frequency)].join('|');
  }
  function v317AggregateSeriesKey_(row) {
    var level = v300Text_(row.aggregate_level), identity = '';
    if (level === 'category') identity = v300Text_(row.category_id);
    else if (level === 'group') identity = v300Text_(row.product_group) || v300Text_(row.aggregate_name);
    else identity = v300Text_(row.aggregate_name) || v300Text_(row.aggregate_id);
    return [v300Text_(row.dataset_code),v300Text_(row.frequency),level,identity,v300ValueType_(row.value_type),v300IndexType_(row.index_type || ''),v300Text_(row.weight_source)].join('|');
  }
  function v317SetLatestBySeriesRows_(rows, dateField) {
    var max = {};
    (rows || []).forEach(function(row){ var d=v300Date_(row[dateField]), k=v317PriceSeriesKey_(row); if(d&&k&&(!max[k]||d>max[k]))max[k]=d; });
    (rows || []).forEach(function(row){ var d=v300Date_(row[dateField]), k=v317PriceSeriesKey_(row); row.is_latest_period=d&&k&&max[k]&&v300DateKey_(d)===v300DateKey_(max[k])?1:0; });
    return rows;
  }
  function v317SetLatestAggregateRows_(rows) {
    var max = {};
    (rows || []).forEach(function(row){ var d=v300Date_(row.period_start), k=v317AggregateSeriesKey_(row); if(d&&k&&(!max[k]||d>max[k]))max[k]=d; });
    (rows || []).forEach(function(row){ var d=v300Date_(row.period_start), k=v317AggregateSeriesKey_(row); row.is_latest_period=d&&k&&max[k]&&v300DateKey_(d)===v300DateKey_(max[k])?1:0; });
    return rows;
  }
  function v300SetLatestPeriod_(rows, dateField) { return v317SetLatestBySeriesRows_(rows, dateField); }
  function v304SetLatestAggregateFlags_(rows) { return v317SetLatestAggregateRows_(rows); }

  function alpha6NormalizeLatestSheet_(sheetName, headers, dateField, keyFn) {
    var sheet=v300Publish_().getSheetByName(sheetName); if(!sheet||sheet.getLastRow()<2)return 0;
    var rows=v300ReadObjects_(sheet,headers), max={}, changed=0;
    rows.forEach(function(r){var d=v300Date_(r[dateField]),k=keyFn(r);if(d&&k&&(!max[k]||d>max[k]))max[k]=d;});
    var idx=v300HeaderIndex_(headers).is_latest_period, values=[];
    rows.forEach(function(r){var d=v300Date_(r[dateField]),k=keyFn(r),desired=d&&k&&max[k]&&v300DateKey_(d)===v300DateKey_(max[k])?1:0;if(v300Bool01_(r.is_latest_period)!==desired)changed++;values.push([desired]);});
    if(values.length)sheet.getRange(2,idx+1,values.length,1).setValues(values).setNumberFormat('0');
    return changed;
  }



  /** Alpha.6 fixes: monthly index rows share one economic series, MA4 invalidates three forward weeks. */
  function v310MonthlyDescriptors_(targets) {
    var out=[];
    (targets||[]).forEach(function(t){
      var vt=v300ValueType_(t.valueType),dataset=v300Text_(t.datasetCode),seriesType='OFFICIAL_MONTHLY',idx=v300IndexType_(t.indexType||'');
      if(v300IsIndexValueType_(vt)){seriesType='OFFICIAL_MONTHLY_INDEX';idx='';}
      if(v300IsMarkupValueType_(vt))seriesType='CALCULATED_MARKUP';
      if(dataset===AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED&&!v300IsMarkupValueType_(vt))seriesType='DERIVED_FROM_WEEKLY';
      out.push({datasetCode:dataset,categoryId:v300Text_(t.categoryId),valueType:vt,indexType:idx,seriesType:seriesType});
    });
    return v310UniqueDescriptors_(out);
  }
  function v310WeeklyDependentPeriods_(periodKey) {
    var d=v300Date_(periodKey),out=[];if(!d)return out;
    out.push(v300DateKey_(d));
    for(var step=1;step<=3;step++){var f=new Date(d.getTime());f.setDate(f.getDate()+7*step);out.push(v300DateKey_(f));}
    var iso=v300Iso_(d);try{out.push(v300DateKey_(v310pSundayOfIsoWeek_(Number(iso.year)+1,Number(iso.week))));}catch(e){}
    if(d.getMonth()===11){for(var i=1;i<=53;i++){try{out.push(v300DateKey_(v310pSundayOfIsoWeek_(d.getFullYear()+1,i)));}catch(ignore){}}}
    return v310Unique_(out.filter(Boolean));
  }
  function v310ReplacePublishRowsBySeries_(sheetName,headers,seriesIds,newRows,formats){
    var ss=v300Publish_(),sheet=v300EnsureSheet_(ss,sheetName,headers,2,headers.length),set={},existing=v300ReadObjects_(sheet,headers),toDelete=[],backup=[];
    (seriesIds||[]).forEach(function(id){if(id)set[String(id)]=true;});
    existing.forEach(function(r){if(set[v300Text_(r.series_id)]){toDelete.push(r._rowNumber);backup.push(rowValues_(headers,r));}});
    try{
      if(toDelete.length)v300DeleteRows_(ss,sheet,toDelete);
      for(var i=0;i<(newRows||[]).length;i+=1000)v300AppendRows_(sheet,headers,newRows.slice(i,i+1000));
      if(formats)v300ApplyFormats_(sheet,formats);
    }catch(e){
      try{var fresh=v300ReadObjects_(sheet,headers),del=[];fresh.forEach(function(r){if(set[v300Text_(r.series_id)])del.push(r._rowNumber);});if(del.length)v300DeleteRows_(ss,sheet,del);if(backup.length)v300AppendRows_(sheet,headers,backup);}catch(ignore){}
      throw e;
    }
  }
  function v310UpdateAggregates_(combos){
    var comboIndex={};(combos||[]).forEach(function(c){comboIndex[v310ComboKey_(c)]=true;});if(!Object.keys(comboIndex).length)return 0;
    var ss=v300Publish_(),headers=AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,sheet=ss.getSheetByName(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES);
    if(!sheet)throw new Error('Не найден лист PUBLISH_PRICE_AGGREGATES.');
    var existing=v300ReadObjects_(sheet,headers),toDelete=[],backup=[];
    existing.forEach(function(r){var k=v310ComboKey_({frequency:r.frequency,datasetCode:r.dataset_code,period:v300DateKey_(r.period_start),valueType:r.value_type,indexType:r.index_type||''});if(comboIndex[k]){toDelete.push(r._rowNumber);backup.push(rowValues_(headers,r));}});
    var objects=v310BuildAggregateRowsForCombos_(comboIndex);v317SetLatestAggregateRows_(objects);var rows=v300ObjectsToRows_(objects,headers);
    try{
      if(toDelete.length)v300DeleteRows_(ss,sheet,toDelete);
      for(var i=0;i<rows.length;i+=1000)v300AppendRows_(sheet,headers,rows.slice(i,i+1000));
      if(rows.length)v300ApplyFormats_(sheet,v300FormatRows_().priceAggregatesPublish);
      alpha6NormalizeLatestSheet_(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,headers,'period_start',v317AggregateSeriesKey_);
      return rows.length;
    }catch(e){
      try{var fresh=v300ReadObjects_(sheet,headers),del=[];fresh.forEach(function(r){var k=v310ComboKey_({frequency:r.frequency,datasetCode:r.dataset_code,period:v300DateKey_(r.period_start),valueType:r.value_type,indexType:r.index_type||''});if(comboIndex[k])del.push(r._rowNumber);});if(del.length)v300DeleteRows_(ss,sheet,del);if(backup.length)v300AppendRows_(sheet,headers,backup);}catch(ignore){}
      throw e;
    }
  }

  var TABLES = {
    PUBLISH_IMPACT: ['impact_id','operation_id','load_id','raw_target','frequency','dataset_code','category_id','value_type','index_type','source_period','affected_periods_json','series_ids_json','aggregate_combos_json','status','created_at','release_version'],
    PUBLISH_RUNS: ['publish_run_id','operation_id','load_id','mode','status','weekly_series_count','monthly_series_count','industry_series_count','aggregate_combo_count','publish_rows_written','aggregate_rows_written','started_at','finished_at','error_code','error_message','release_version'],
    PUBLISH_RECONCILIATION: ['reconciliation_id','checked_at','full_build_id','incremental_build_id','sheet_name','baseline_rows','full_rows','incremental_rows','baseline_hash','full_hash','incremental_hash','full_equals_baseline','incremental_equals_full','status','details_json','release_version']
  };
  var SETTINGS = {
    PUBLISH_SCHEMA_VERSION:{value:'4.0-publish-1',type:'STRING',description:'Incremental Publish contract version'},
    PUBLISH_DEPENDENCY_VERSION:{value:'4.0-dependency-3',type:'STRING',description:'Affected-series, compact impact and dependent-period rule version'},
    PUBLISH_ENGINE_ENABLED:{value:true,type:'BOOLEAN',description:'Enable real incremental writes to DEV Publish'},
    PUBLISH_AGGREGATE_EXECUTION_ENABLED:{value:false,type:'BOOLEAN',description:'Alpha.6 plans aggregate impact but defers physical aggregate writes to alpha.7'},
    PUBLISH_WRITE_BATCH_SIZE:{value:1000,type:'NUMBER',description:'Maximum Publish rows written per batch'},
    PUBLISH_RECONCILIATION_CHUNK_ROWS:{value:500,type:'NUMBER',description:'Rows per canonical reconciliation hash chunk'},
    PUBLISH_RECONCILIATION_TOLERANCE:{value:0,type:'NUMBER',description:'Allowed business-value mismatches during acceptance'}
  };
  var RECON_STATE_KEY='AKORT_ALPHA6_RECONCILIATION_STATE';
  var RECON_DISPATCHER_STATE_KEY='AKORT_ALPHA6_RECONCILIATION_DISPATCHER_STATE_V3';
  var RECON_DISPATCHER_CONTROL_KEY='AKORT_ALPHA6_RECONCILIATION_DISPATCHER_CONTROL_V1';
  var RECON_DISPATCHER_HANDLER='AKORT_alpha6ReconciliationDispatcherWorker';
  var RECON_DISPATCHER_INTERVAL_MINUTES=1;
  var RECON_DISPATCHER_STALL_MS=420000;
  var RECON_DISPATCHER_MAX_CONSECUTIVE_ERRORS=3;
  var RECON_PHASES=['BUILD_FULL_WEEKLY','BUILD_FULL_MONTHLY','BUILD_FULL_INDUSTRY','BUILD_REPLAY_PLAN','REPLAY_INCREMENTAL','NORMALIZE_WEEKLY','NORMALIZE_MONTHLY','NORMALIZE_INDUSTRY','COMPARE_WEEKLY','COMPARE_MONTHLY','COMPARE_INDUSTRY','FINALIZE','SUCCESS'];

  function clone_(v){return JSON.parse(JSON.stringify(v===undefined?null:v));}
  function getDwh_(){return v300Tech_();}
  function getPublish_(){return SpreadsheetApp.openById(AKORT.Config.load({includeSystemSettings:false}).resources.publishSpreadsheetId);}
  function currentUser_(){try{return Session.getEffectiveUser().getEmail()||'unknown';}catch(e){return'unknown';}}
  function id_(prefix){return prefix+'_'+Utilities.formatDate(new Date(),'GMT',"yyyyMMdd'T'HHmmssSSS'Z'")+'_'+Utilities.getUuid().replace(/-/g,'').slice(-12).toUpperCase();}
  function truthy_(v){return v===true||v===1||v==='1'||String(v).toUpperCase()==='TRUE';}
  function table_(ss,name,headers){var sh=ss.getSheetByName(name);if(!sh)throw AKORT.Core.error('PUBLISH_TABLE_MISSING','Missing table '+name+'. Run AKORT_alpha6Install first.');var actual=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);if(JSON.stringify(actual)!==JSON.stringify(headers))throw AKORT.Core.error('PUBLISH_SCHEMA_MISMATCH','Unexpected schema for '+name,{expected:headers,actual:actual});return{sheet:sh,headers:actual};}
  function ensureTable_(ss,name,headers){var sh=ss.getSheetByName(name),created=false;if(!sh){sh=ss.insertSheet(name);created=true;}var last=sh.getLastColumn(),actual=last?sh.getRange(1,1,1,last).getValues()[0]:[],blank=!actual.length||actual.every(function(x){return x==='';});if(sh.getLastRow()===0||blank)sh.getRange(1,1,1,headers.length).setValues([headers]);else if(JSON.stringify(actual.map(String))!==JSON.stringify(headers))throw AKORT.Core.error('PUBLISH_SCHEMA_MISMATCH','Unexpected schema for '+name,{expected:headers,actual:actual});sh.setFrozenRows(1);sh.getRange(1,1,1,headers.length).setFontWeight('bold');return{name:name,created:created,columns:headers.length};}
  function readObjects_(sh){return AKORT.Core.Sheets.readObjects(sh);}
  function appendObject_(t,o){AKORT.Core.Sheets.appendObject(t.sheet,t.headers,o);return o;}
  function rowValues_(headers,o){return headers.map(function(h){return o[h]===undefined||o[h]===null?'':o[h];});}
  function upsertSettings_(){var ss=getDwh_(),t=table_(ss,'SYSTEM_SETTINGS',AKORT.Core.Tables.SYSTEM_SETTINGS),rows=readObjects_(t.sheet),by={};rows.forEach(function(r){by[String(r.setting_key)]=r;});var actions=[];Object.keys(SETTINGS).forEach(function(k){var d=SETTINGS[k],r=by[k];if(!r){appendObject_(t,{setting_key:k,setting_value:d.value,value_type:d.type,environment:'DEV',is_secret:0,is_active:1,description:d.description,updated_at:AKORT.Core.now(),updated_by:currentUser_()});actions.push({setting:k,action:'INSERTED'});return;}var update=String(r.setting_value)!==String(d.value)||String(r.value_type)!==d.type||!truthy_(r.is_active);if(update){r.setting_value=d.value;r.value_type=d.type;r.environment='DEV';r.is_secret=0;r.is_active=1;r.description=d.description;r.updated_at=AKORT.Core.now();r.updated_by=currentUser_();t.sheet.getRange(r.__row,1,1,t.headers.length).setValues([rowValues_(t.headers,r)]);actions.push({setting:k,action:'UPDATED'});}else actions.push({setting:k,action:'UNCHANGED'});});return actions;}
  function runtimeSettings_(){var s=AKORT.Config.readSystemSettings();return{schemaVersion:String(s.PUBLISH_SCHEMA_VERSION||'4.0-publish-1'),dependencyVersion:String(s.PUBLISH_DEPENDENCY_VERSION||'4.0-dependency-3'),enabled:s.PUBLISH_ENGINE_ENABLED===undefined?true:truthy_(s.PUBLISH_ENGINE_ENABLED),aggregateExecutionEnabled:false,aggregateExecutionStatus:ALPHA6_SCOPE.aggregateExecutionStatus,acceptanceSheets:ALPHA6_SCOPE.acceptanceSheets.slice(),plannedSheets:ALPHA6_SCOPE.plannedSheets.slice(),replayFrontierMode:ALPHA6_SCOPE.replayFrontierMode,impactJsonMaxChars:ALPHA6_IMPACT_JSON_MAX_CHARS,writeBatchSize:Number(s.PUBLISH_WRITE_BATCH_SIZE||1000),chunkRows:Number(s.PUBLISH_RECONCILIATION_CHUNK_ROWS||500),tolerance:Number(s.PUBLISH_RECONCILIATION_TOLERANCE||0)};}

  function install(){var parser=AKORT.ExistingSourceParsers.install();if(!parser.ok)return parser;return AKORT.Core.safeRun('INCREMENTAL_PUBLISH_INSTALL',function(context){AKORT.EnvironmentGuard.assertDev();var ss=getDwh_(),created=Object.keys(TABLES).map(function(n){return ensureTable_(ss,n,TABLES[n]);}),actions=upsertSettings_();context.logger.info('Incremental Publish installed',{tables:created,settings:actions},{eventCode:'INCREMENTAL_PUBLISH_INSTALLED'});return AKORT.Result.success('Incremental Publish installed successfully.',{release:AKORT.Release.manifest(),manifestHash:AKORT.Core.manifestHash(),coreRegistration:parser.data&&parser.data.coreRegistration?parser.data.coreRegistration:null,publishSchemaVersion:AKORT.Release.publishSchemaVersion,dependencySchemaVersion:AKORT.Release.dependencySchemaVersion,serviceTables:created,settingActions:actions,runtimeSettings:runtimeSettings_()});},{lock:true,persistLogs:true});}

  function createPublishBackup(){return AKORT.Core.safeRun('INCREMENTAL_PUBLISH_BACKUP',function(){AKORT.EnvironmentGuard.assertDev();var config=AKORT.Config.load({includeSystemSettings:false}),source=DriveApp.getFileById(config.resources.publishSpreadsheetId),folder=DriveApp.getFolderById(config.resources.testResultsFolderId),stamp=Utilities.formatDate(new Date(),'Europe/Moscow','yyyyMMdd_HHmmss'),copy=source.makeCopy('AKORT_PUBLISH_ALPHA6_BACKUP_'+stamp,folder);return AKORT.Result.success('DEV Publish backup created.',{backupId:copy.getId(),backupName:copy.getName(),backupUrl:copy.getUrl(),sourcePublishId:config.resources.publishSpreadsheetId,createdAt:AKORT.Core.now()});},{lock:true,persistLogs:true});}

  function payload_(value){if(value&&typeof value==='object')return clone_(value);try{return JSON.parse(String(value||'{}'));}catch(e){return{};}}
  function stageRowsForLoad_(loadId){var sh=getDwh_().getSheetByName('RAW_STAGE');if(!sh||sh.getLastRow()<2)return[];return readObjects_(sh).filter(function(r){return String(r.load_id)===String(loadId)&&String(r.commit_action||'')!=='UNCHANGED';});}
  function loadRecord_(loadId){var sh=getDwh_().getSheetByName('RAW_LOAD_REGISTRY');if(!sh||sh.getLastRow()<2)return null;var rows=readObjects_(sh);for(var i=0;i<rows.length;i+=1){if(String(rows[i].load_id)===String(loadId))return rows[i];}return null;}
  function compatibilityTestMarker_(rows,load){var text=[];(rows||[]).forEach(function(r){text.push(r.business_key||'',r.row_payload_json||'',r.operation_id||'');});if(load)text.push(load.source_id||'',load.source_name||'',load.operation_id||'',load.load_id||'');var joined=text.join('|');var match=joined.match(/ALPHA(?:4|5)_TEST[^|]*/i);return match?match[0]:'';}
  function affectedFromStageRows_(rows){var affected=[],industry={};(rows||[]).forEach(function(r){var p=payload_(r.row_payload_json),target=String(r.target_table||'');if(target==='RAW_PRICES_WEEKLY')affected.push({frequency:'weekly',datasetCode:p.dataset_code,categoryId:p.category_id,valueType:p.value_type,indexType:p.index_type||'',period:v300DateKey_(p.observation_date)});else if(target==='RAW_PRICES_MONTHLY')affected.push({frequency:'monthly',datasetCode:p.dataset_code,categoryId:p.category_id,valueType:p.value_type,indexType:p.index_type||'',period:v300MonthKey_(p.observation_month)});else if(target==='RAW_INDUSTRY'&&p.series_id)industry[String(p.series_id)]=true;});return{price:v310MergeAffected_([],affected),industrySeries:Object.keys(industry)};}
  function parseBusinessKey_(businessKey){var values={};String(businessKey||'').split('|').slice(1).forEach(function(part){var pos=part.indexOf('=');if(pos>=0)values[part.slice(0,pos)]=part.slice(pos+1);});return values;}
  function affectedFromReversal_(reversal){var records=(reversal&&reversal.records)||(reversal&&reversal.reversalLog)||[],affected=[],industry={};records.forEach(function(record){var target=String(record.target_table||''),p=parseBusinessKey_(record.business_key);if(target==='RAW_PRICES_WEEKLY')affected.push({frequency:'weekly',datasetCode:p.dataset_code,categoryId:p.category_id,valueType:p.value_type,indexType:p.index_type||'',period:v300DateKey_(p.observation_date)});else if(target==='RAW_PRICES_MONTHLY')affected.push({frequency:'monthly',datasetCode:p.dataset_code,categoryId:p.category_id,valueType:p.value_type,indexType:p.index_type||'',period:v300MonthKey_(p.observation_month)});else if(target==='RAW_INDUSTRY'&&p.series_id)industry[String(p.series_id)]=true;});return{price:v310MergeAffected_([],affected),industrySeries:Object.keys(industry)};}
  function seriesIdsForTargets_(targets,frequency){var desc=frequency==='weekly'?v310WeeklyDescriptors_(targets):v310MonthlyDescriptors_(targets);return v310Unique_(desc.map(function(d){return v300SeriesId_(d.datasetCode,d.categoryId,d.valueType,d.seriesType,d.indexType||'');}));}
  function planFromAffected_(base,options){var expanded=v310ExpandAffectedTargets_(base.price||[],options||{});return{weekly:expanded.weekly,monthly:expanded.monthly,aggregates:expanded.aggregates,industrySeries:base.industrySeries||[],weeklySeriesIds:seriesIdsForTargets_(expanded.weekly,'weekly'),monthlySeriesIds:seriesIdsForTargets_(expanded.monthly,'monthly'),aggregateExecutionStatus:ALPHA6_SCOPE.aggregateExecutionStatus};}
  function emptyPlan_(loadId,marker){return{weekly:[],monthly:[],aggregates:[],industrySeries:[],weeklySeriesIds:[],monthlySeriesIds:[],loadId:loadId||'',stageRows:0,testOnly:true,testMarker:marker||'COMPATIBILITY_TEST',aggregateExecutionStatus:ALPHA6_SCOPE.aggregateExecutionStatus};}
  function planLoad(loadId){var rows=stageRowsForLoad_(loadId),load=loadRecord_(loadId),marker=compatibilityTestMarker_(rows,load);if(marker){var isolated=emptyPlan_(loadId,marker);isolated.stageRows=rows.length;return isolated;}var base=affectedFromStageRows_(rows),plan=planFromAffected_(base);plan.loadId=loadId;plan.stageRows=rows.length;plan.testOnly=false;plan.testMarker='';return plan;}
  function planReversal(reversal){var loadId=reversal&&reversal.reversalLoadId?reversal.reversalLoadId:'',load=loadRecord_(loadId),records=(reversal&&reversal.records)||(reversal&&reversal.reversalLog)||[],marker=compatibilityTestMarker_(records,load);if(!marker&&reversal&&reversal.targetLoadId)marker=compatibilityTestMarker_([],loadRecord_(reversal.targetLoadId));if(marker){var isolated=emptyPlan_(loadId,marker);isolated.reversal=true;return isolated;}var base=affectedFromReversal_(reversal),plan=planFromAffected_(base);plan.loadId=loadId;plan.stageRows=0;plan.reversal=true;plan.testOnly=false;plan.testMarker='';return plan;}
  function summarizePlan_(plan){
    plan=plan||{};
    var aggregateKeys=(plan.aggregates||[]).map(v310ComboKey_).sort();
    return{
      contractVersion:AKORT.Release.dependencySchemaVersion||'4.0-dependency-3',
      loadId:plan.loadId||'',stageRows:Number(plan.stageRows||0),testOnly:plan.testOnly===true,testMarker:plan.testMarker||'',reversal:plan.reversal===true,
      weeklyTargetCount:(plan.weekly||[]).length,monthlyTargetCount:(plan.monthly||[]).length,industrySeriesCount:(plan.industrySeries||[]).length,
      weeklySeriesCount:(plan.weeklySeriesIds||[]).length,monthlySeriesCount:(plan.monthlySeriesIds||[]).length,aggregateComboCount:(plan.aggregates||[]).length,
      aggregatePlanHash:AKORT.Core.sha256(aggregateKeys.join('\n')),aggregateExecutionStatus:plan.aggregateExecutionStatus||ALPHA6_SCOPE.aggregateExecutionStatus,
      impactJsonMaxChars:ALPHA6_IMPACT_JSON_MAX_CHARS
    };
  }
  function jsonArrayChunks_(items,maxChars){
    var limit=Math.max(1000,Number(maxChars||ALPHA6_IMPACT_JSON_MAX_CHARS)),chunks=[],current=[];
    (items||[]).forEach(function(item){
      var candidate=current.concat([item]),json=AKORT.Core.safeJson(candidate);
      if(json.length<=limit){current=candidate;return;}
      if(!current.length)throw AKORT.Core.error('PUBLISH_IMPACT_ITEM_TOO_LARGE','One aggregate impact item exceeds the configured JSON cell limit.',{maxChars:limit,item:item});
      chunks.push(AKORT.Core.safeJson(current));current=[item];
      if(AKORT.Core.safeJson(current).length>limit)throw AKORT.Core.error('PUBLISH_IMPACT_ITEM_TOO_LARGE','One aggregate impact item exceeds the configured JSON cell limit.',{maxChars:limit,item:item});
    });
    if(current.length)chunks.push(AKORT.Core.safeJson(current));
    return chunks.length?chunks:['[]'];
  }
  function aggregateImpactIndex_(plan){var out={};(plan&&plan.aggregates||[]).forEach(function(combo){out[v310ComboKey_(combo)]=combo;});return out;}
  function aggregateCombosForImpact_(target,frequency,index){
    var periods=frequency==='weekly'?v310WeeklyDependentPeriods_(target.period):v310MonthlyDependentPeriods_(target.period),types=v310AggregateIndexTypes_(frequency,target.indexType||''),out=[];
    periods.forEach(function(period){types.forEach(function(indexType){var key=v310ComboKey_({frequency:frequency,datasetCode:target.datasetCode,period:period,valueType:target.valueType,indexType:indexType});if(index[key])out.push(index[key]);});});
    return out.sort(function(a,b){return v310ComboKey_(a).localeCompare(v310ComboKey_(b));});
  }
  function assertImpactRecordSize_(record){
    ['affected_periods_json','series_ids_json','aggregate_combos_json'].forEach(function(field){var length=String(record[field]||'').length;if(length>ALPHA6_IMPACT_JSON_MAX_CHARS)throw AKORT.Core.error('PUBLISH_IMPACT_CELL_LIMIT_EXCEEDED','Compact impact record still exceeds the configured cell limit.',{field:field,length:length,maxChars:ALPHA6_IMPACT_JSON_MAX_CHARS,impactId:record.impact_id});});
    return record;
  }
  function buildImpactRecords_(operationId,loadId,plan,createdAt){
    var now=createdAt||AKORT.Core.now(),records=[],aggregateIndex=aggregateImpactIndex_(plan),summary=summarizePlan_(plan),contract=summary.contractVersion;
    function add(rawTarget,frequency,items){
      (items||[]).forEach(function(target){
        var affected=frequency==='weekly'?v310WeeklyDependentPeriods_(target.period):v310MonthlyDependentPeriods_(target.period),seriesIds=seriesIdsForTargets_([target],frequency),combos=aggregateCombosForImpact_(target,frequency,aggregateIndex),chunks=jsonArrayChunks_(combos,ALPHA6_IMPACT_JSON_MAX_CHARS),targetKey=[operationId||'',loadId||'',rawTarget,frequency,target.datasetCode||'',target.categoryId||'',v300ValueType_(target.valueType),v300IndexType_(target.indexType||''),target.period||'',contract,summary.aggregatePlanHash].join('|');
        chunks.forEach(function(chunk,chunkIndex){
          records.push(assertImpactRecordSize_({impact_id:v300Id_('IMPACT',targetKey+'|'+(chunkIndex+1)+'|'+chunks.length),operation_id:operationId||'',load_id:loadId||'',raw_target:rawTarget,frequency:frequency,dataset_code:target.datasetCode||'',category_id:target.categoryId||'',value_type:target.valueType||'',index_type:target.indexType||'',source_period:target.period||'',affected_periods_json:AKORT.Core.safeJson(affected),series_ids_json:AKORT.Core.safeJson(seriesIds),aggregate_combos_json:chunk,status:'PLANNED',created_at:now,release_version:AKORT.Release.version}));
        });
      });
    }
    add('RAW_PRICES_WEEKLY','weekly',plan&&plan.weekly);
    add('RAW_PRICES_MONTHLY','monthly',plan&&plan.monthly);
    (plan&&plan.industrySeries||[]).forEach(function(seriesId){var key=[operationId||'',loadId||'','RAW_INDUSTRY',seriesId,contract,summary.aggregatePlanHash].join('|');records.push(assertImpactRecordSize_({impact_id:v300Id_('IMPACT',key),operation_id:operationId||'',load_id:loadId||'',raw_target:'RAW_INDUSTRY',frequency:'industry',dataset_code:'INDUSTRY',category_id:seriesId,value_type:'',index_type:'',source_period:'',affected_periods_json:'[]',series_ids_json:AKORT.Core.safeJson([seriesId]),aggregate_combos_json:'[]',status:'PLANNED',created_at:now,release_version:AKORT.Release.version}));});
    return records;
  }
  function existingImpactIds_(sheet){var out={},last=sheet.getLastRow();if(last<2)return out;sheet.getRange(2,1,last-1,1).getValues().forEach(function(row){if(row[0])out[String(row[0])]=true;});return out;}
  function appendImpact_(operationId,loadId,plan){
    var t=table_(getDwh_(),'PUBLISH_IMPACT',TABLES.PUBLISH_IMPACT),records=buildImpactRecords_(operationId,loadId,plan),existing=existingImpactIds_(t.sheet),pending=records.filter(function(record){return !existing[String(record.impact_id)];}),rows=v300ObjectsToRows_(pending,t.headers),batch=Math.max(100,Math.min(1000,Number(runtimeSettings_().writeBatchSize||1000)));
    for(var i=0;i<rows.length;i+=batch)v300AppendRows_(t.sheet,t.headers,rows.slice(i,i+batch));
    return records.map(function(record){return record.impact_id;});
  }
  function planCount_(plan,arrayField,countField){return plan&&Array.isArray(plan[arrayField])?plan[arrayField].length:Number(plan&&plan[countField]||0);}

  function replaceIndustrySeries_(seriesIds){if(!seriesIds||!seriesIds.length)return 0;var allRows=v300BuildIndustryPublish_(),headers=AKORT_V300.HEADERS.PUBLISH_INDUSTRY,objects=rowsToObjects_(allRows,headers),set={};seriesIds.forEach(function(x){set[String(x)]=true;});var selected=objects.filter(function(r){return set[String(r.series_id)];}),ss=v300Publish_(),sh=ss.getSheetByName(AKORT_V300.SHEETS.PUBLISH_INDUSTRY),existing=v300ReadObjects_(sh,headers),toDelete=[];existing.forEach(function(r){if(set[String(r.series_id)])toDelete.push(r._rowNumber);});var backup=existing.filter(function(r){return set[String(r.series_id)];}).map(function(r){return rowValues_(headers,r);});try{if(toDelete.length)v300DeleteRows_(ss,sh,toDelete);var rows=v300ObjectsToRows_(selected,headers);for(var i=0;i<rows.length;i+=1000)v300AppendRows_(sh,headers,rows.slice(i,i+1000));v300ApplyFormats_(sh,v300FormatRows_().industryPublish);return rows.length;}catch(e){try{var fresh=v300ReadObjects_(sh,headers),del=[];fresh.forEach(function(r){if(set[String(r.series_id)])del.push(r._rowNumber);});if(del.length)v300DeleteRows_(ss,sh,del);if(backup.length)v300AppendRows_(sh,headers,backup);}catch(ignore){}throw e;}}
  function applyPublish(plan,operationId){var rt=runtimeSettings_();if(!rt.enabled)throw AKORT.Core.error('PUBLISH_ENGINE_DISABLED','Incremental Publish is disabled.');var started=AKORT.Core.now(),runId=id_('PUBRUN'),t=table_(getDwh_(),'PUBLISH_RUNS',TABLES.PUBLISH_RUNS),w=0,m=0,i=0;try{if(plan.weeklySeriesIds.length){var wr=v310BuildWeeklyRowsForTargets_(plan.weekly);v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,plan.weeklySeriesIds,v300ObjectsToRows_(wr,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY),v300FormatRows_().weeklyPublish);w=wr.length;}if(plan.monthlySeriesIds.length){var mr=v310BuildMonthlyRowsForTargets_(plan.monthly);v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,plan.monthlySeriesIds,v300ObjectsToRows_(mr,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY),v300FormatRows_().monthlyPublish);m=mr.length;}if(plan.industrySeries.length)i=replaceIndustrySeries_(plan.industrySeries);appendObject_(t,{publish_run_id:runId,operation_id:operationId||'',load_id:plan.loadId||'',mode:'INCREMENTAL_PUBLISH',status:'SUCCESS',weekly_series_count:plan.weeklySeriesIds.length,monthly_series_count:plan.monthlySeriesIds.length,industry_series_count:plan.industrySeries.length,aggregate_combo_count:plan.aggregates.length,publish_rows_written:w+m+i,aggregate_rows_written:0,started_at:started,finished_at:AKORT.Core.now(),error_code:'',error_message:'',release_version:AKORT.Release.version});return{runId:runId,weeklyRows:w,monthlyRows:m,industryRows:i,publishRows:w+m+i};}catch(e){appendObject_(t,{publish_run_id:runId,operation_id:operationId||'',load_id:plan.loadId||'',mode:'INCREMENTAL_PUBLISH',status:'FAILED',weekly_series_count:plan.weeklySeriesIds.length,monthly_series_count:plan.monthlySeriesIds.length,industry_series_count:plan.industrySeries.length,aggregate_combo_count:plan.aggregates.length,publish_rows_written:0,aggregate_rows_written:0,started_at:started,finished_at:AKORT.Core.now(),error_code:e.code||'PUBLISH_UPDATE_FAILED',error_message:e.message||String(e),release_version:AKORT.Release.version});throw e;}}
  function applyAggregates(plan,operationId){
    var started=AKORT.Core.now(),runId=id_('PUBRUN'),t=table_(getDwh_(),'PUBLISH_RUNS',TABLES.PUBLISH_RUNS),count=planCount_(plan,'aggregates','aggregateComboCount'),weeklyCount=planCount_(plan,'weeklySeriesIds','weeklySeriesCount'),monthlyCount=planCount_(plan,'monthlySeriesIds','monthlySeriesCount'),industryCount=planCount_(plan,'industrySeries','industrySeriesCount');
    appendObject_(t,{publish_run_id:runId,operation_id:operationId||'',load_id:plan&&plan.loadId||'',mode:'AGGREGATE_IMPACT_ONLY',status:'DEFERRED_TO_ALPHA7',weekly_series_count:weeklyCount,monthly_series_count:monthlyCount,industry_series_count:industryCount,aggregate_combo_count:count,publish_rows_written:0,aggregate_rows_written:0,started_at:started,finished_at:AKORT.Core.now(),error_code:'',error_message:'Physical aggregate execution is outside alpha.6 scope.',release_version:AKORT.Release.version});
    return{runId:runId,aggregateRows:0,aggregateImpactCount:count,deferred:true,status:ALPHA6_SCOPE.aggregateExecutionStatus};
  }

  function rowsToObjects_(rows,headers){return(rows||[]).map(function(row){var o={};headers.forEach(function(h,i){o[h]=row[i]===undefined?'':row[i];});return o;});}
  function buildAggregateRows_(){var standard=rowsToObjects_(v304BuildPriceAggregatesPublish_(),AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES),special=v315BuildAllSpecialRows_(),all=standard.concat(special);v317SetLatestAggregateRows_(all);return v300ObjectsToRows_(all,AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES);}
  function writeBuildSheet_(spreadsheetId,sheetName,headers,rows,formats){ALPHA6_PUBLISH_OVERRIDE_ID=spreadsheetId;try{return v300WriteTable_(v300Publish_(),sheetName,headers,rows,formats);}finally{ALPHA6_PUBLISH_OVERRIDE_ID='';}}
  function createTempBook_(name){var ss=SpreadsheetApp.create(name);try{DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(AKORT.Config.load({includeSystemSettings:false}).resources.testResultsFolderId));}catch(e){}return ss;}
  function initBuildBook_(ss){var first=ss.getSheets()[0];first.setName(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY);[[AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY],[AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY],[AKORT_V300.SHEETS.PUBLISH_INDUSTRY,AKORT_V300.HEADERS.PUBLISH_INDUSTRY]].forEach(function(x){var sh=ss.getSheetByName(x[0])||ss.insertSheet(x[0]);sh.getRange(1,1,1,x[1].length).setValues([x[1]]);sh.setFrozenRows(1);});return ss;}
  function initControlBook_(ss){var first=ss.getSheets()[0];first.setName('STATE');first.getRange(1,1,1,2).setValues([['key','value']]);var sh=ss.insertSheet('REPLAY_GROUPS');sh.getRange(1,1,1,6).setValues([['sequence_no','load_id','loaded_at','reverse_targets_json','status','aggregate_impact_preview_json']]);var results=ss.insertSheet('RESULTS');results.getRange(1,1,1,2).setValues([['key','details_json']]);}
  function saveRecon_(s){PropertiesService.getScriptProperties().setProperty(RECON_STATE_KEY,JSON.stringify(s));}
  function loadRecon_(){var raw=PropertiesService.getScriptProperties().getProperty(RECON_STATE_KEY);return raw?JSON.parse(raw):null;}
  function collectReplayGroups_(){var dwh=getDwh_(),groups={};function touch(loadId,stamp){loadId=String(loadId||'UNREGISTERED');var ms=stamp&&stamp.getTime?stamp.getTime():0,g=groups[loadId]||(groups[loadId]={loadId:loadId,time:ms||0,reverseTargets:[]});if(ms&&(!g.time||ms<g.time))g.time=ms;return g;}function scan(name,headers){var sh=dwh.getSheetByName(name);if(!sh)return;v300ReadObjects_(sh,headers).forEach(function(r){touch(r.load_id||'UNREGISTERED',v300Date_(r.loaded_at));});}scan(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY,AKORT_V300.HEADERS.RAW_PRICES_WEEKLY);scan(AKORT_V300.SHEETS.RAW_PRICES_MONTHLY,AKORT_V300.HEADERS.RAW_PRICES_MONTHLY);scan(AKORT_V300.SHEETS.RAW_INDUSTRY,AKORT_V300.HEADERS.RAW_INDUSTRY);var rev=dwh.getSheetByName('RAW_REVERSAL_LOG');if(rev&&rev.getLastRow()>1)readObjects_(rev).forEach(function(r){if(String(r.status||'')!=='SUCCESS')return;var g=touch(r.reversal_load_id||('REVERSAL_'+r.reversal_id),v300Date_(r.reversed_at));var target=String(r.target_load_id||'');if(target&&g.reverseTargets.indexOf(target)<0)g.reverseTargets.push(target);g.isReversal=true;});return Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return Number(a.time||0)-Number(b.time||0)||String(a.loadId).localeCompare(String(b.loadId));});}
  function writeReplayGroups_(state){var ss=SpreadsheetApp.openById(state.controlId),sh=ss.getSheetByName('REPLAY_GROUPS');if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,6).clearContent();var rows=(state.replayGroups||[]).map(function(g,i){return[i+1,g.loadId,g.time?new Date(g.time):'',AKORT.Core.safeJson(g.reverseTargets||[]),'PENDING',''];});if(rows.length)sh.getRange(2,1,rows.length,6).setValues(rows);}
  function validateFinalReplayRaw_(groups){var allowed={},reversed={};(groups||[]).forEach(function(g){if((g.reverseTargets||[]).length)(g.reverseTargets||[]).forEach(function(x){reversed[String(x)]=true;});else allowed[String(g.loadId)]=true;});var dwh=getDwh_(),specs=[[AKORT_V300.SHEETS.RAW_PRICES_WEEKLY,AKORT_V300.HEADERS.RAW_PRICES_WEEKLY],[AKORT_V300.SHEETS.RAW_PRICES_MONTHLY,AKORT_V300.HEADERS.RAW_PRICES_MONTHLY],[AKORT_V300.SHEETS.RAW_INDUSTRY,AKORT_V300.HEADERS.RAW_INDUSTRY]],results=[];specs.forEach(function(spec){var rows=v300ReadObjects_(dwh.getSheetByName(spec[0]),spec[1]),current=rows.filter(function(r){return v300Bool01_(r.is_latest)===1;}).map(function(r){return String(r.observation_id);}).sort(),replay=v300SelectReplayLatest_(spec[0],rows,allowed,reversed).map(function(r){return String(r.observation_id);}).sort(),same=current.length===replay.length&&current.every(function(x,i){return x===replay[i];});results.push({sheet:spec[0],currentLatest:current.length,replayLatest:replay.length,status:same?'PASS':'FAIL'});if(!same)throw AKORT.Core.error('REPLAY_RAW_FINAL_MISMATCH','Sequential load replay does not reproduce current RAW latest state.',{sheet:spec[0],currentLatest:current.length,replayLatest:replay.length});});return results;}
  function markReplayGroup_(state,index,status){var sh=SpreadsheetApp.openById(state.controlId).getSheetByName('REPLAY_GROUPS');if(sh&&index>=0)sh.getRange(index+2,5).setValue(status);}
  function replayCacheSheet_(state){
    var ss=SpreadsheetApp.openById(state.controlId),name='REPLAY_STAGE_ITEMS',headers=['item_no','item_json'],sh=ss.getSheetByName(name);
    if(!sh){sh=ss.insertSheet(name);sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);}return sh;
  }
  function replayClearCache_(state){var sh=replayCacheSheet_(state);if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,2).clearContent();}
  function replayWriteCache_(state,items){
    var sh=replayCacheSheet_(state),rows=(items||[]).map(function(item,i){return[i+1,AKORT.Core.safeJson(item)];});
    replayClearCache_(state);for(var i=0;i<rows.length;i+=500)sh.getRange(i+2,1,Math.min(500,rows.length-i),2).setValues(rows.slice(i,i+500));return rows.length;
  }
  function replayReadCacheChunk_(state,start,size){
    var sh=replayCacheSheet_(state),total=Math.max(0,sh.getLastRow()-1);if(start>=total)return[];var n=Math.min(size,total-start),vals=sh.getRange(start+2,2,n,1).getValues();
    return vals.map(function(r){try{return JSON.parse(String(r[0]||'{}'));}catch(e){throw AKORT.Core.error('REPLAY_CACHE_PARSE_FAILED','Cannot parse cached replay item.',{row:start+2});}});
  }
  function replayRowsForLoad_(sheetName,headers,loadId){
    var sh=getDwh_().getSheetByName(sheetName);if(!sh||sh.getLastRow()<2)return[];
    return v300ReadObjects_(sh,headers).filter(function(r){return String(r.load_id||'UNREGISTERED')===String(loadId);});
  }
  function replayReversalBase_(group){
    if(!(group.isReversal||((group.reverseTargets||[]).length)))return{price:[],industrySeries:[]};
    var sh=getDwh_().getSheetByName('RAW_REVERSAL_LOG'),records=sh&&sh.getLastRow()>1?readObjects_(sh).filter(function(r){return String(r.reversal_load_id||'')===String(group.loadId)&&String(r.status||'')==='SUCCESS';}):[];
    return affectedFromReversal_({records:records});
  }
  function replayStageItemsForGroup_(group,stage){
    var weeklyRows=[],monthlyRows=[],industryRows=[],rev=replayReversalBase_(group),weeklyTargets=[],monthlyTargets=[],industryMap={};
    if(stage==='WEEKLY'||stage==='MONTHLY'||stage==='AGGREGATES')weeklyRows=replayRowsForLoad_(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY,AKORT_V300.HEADERS.RAW_PRICES_WEEKLY,group.loadId);
    if(stage==='MONTHLY'||stage==='AGGREGATES')monthlyRows=replayRowsForLoad_(AKORT_V300.SHEETS.RAW_PRICES_MONTHLY,AKORT_V300.HEADERS.RAW_PRICES_MONTHLY,group.loadId);
    if(stage==='INDUSTRY')industryRows=replayRowsForLoad_(AKORT_V300.SHEETS.RAW_INDUSTRY,AKORT_V300.HEADERS.RAW_INDUSTRY,group.loadId);
    weeklyRows.forEach(function(r){weeklyTargets.push({frequency:'weekly',datasetCode:r.dataset_code,categoryId:r.category_id,valueType:r.value_type,indexType:r.index_type||'',period:v300DateKey_(r.observation_date)});});
    monthlyRows.forEach(function(r){monthlyTargets.push({frequency:'monthly',datasetCode:r.dataset_code,categoryId:r.category_id,valueType:r.value_type,indexType:r.index_type||'',period:v300MonthKey_(r.observation_month)});});
    (rev.price||[]).forEach(function(t){if(t.frequency==='weekly')weeklyTargets.push(t);else if(t.frequency==='monthly')monthlyTargets.push(t);});
    if(stage==='WEEKLY'){
      var wt=[];v310MergeAffected_([],weeklyTargets).forEach(function(t){wt.push(t);if(t.datasetCode===AKORT_V300.DATASETS.AKORT_WEEKLY&&(v300ValueType_(t.valueType)==='закупка'||v300ValueType_(t.valueType)==='розница'))wt.push(Object.assign({},t,{valueType:'наценка, %',indexType:''}));});
      return v310WeeklyDescriptors_(wt).sort(function(a,b){return replayDescriptorKey_(a).localeCompare(replayDescriptorKey_(b));});
    }
    if(stage==='MONTHLY'){
      var mt=v310MergeAffected_([],monthlyTargets).slice();
      v310MergeAffected_([],weeklyTargets).forEach(function(t){var vt=v300ValueType_(t.valueType);if(t.datasetCode===AKORT_V300.DATASETS.AKORT_WEEKLY&&(vt==='закупка'||vt==='розница')){mt.push({frequency:'monthly',datasetCode:AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED,categoryId:t.categoryId,valueType:vt,indexType:'',period:t.period});mt.push({frequency:'monthly',datasetCode:AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED,categoryId:t.categoryId,valueType:'наценка, %',indexType:'',period:t.period});}});
      mt.slice().forEach(function(t){var vt=v300ValueType_(t.valueType);if((t.datasetCode===AKORT_V300.DATASETS.AKORT_MONTHLY||t.datasetCode===AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED)&&(vt==='закупка'||vt==='розница'))mt.push(Object.assign({},t,{valueType:'наценка, %',indexType:''}));});
      return v310MonthlyDescriptors_(v310MergeAffected_([],mt)).sort(function(a,b){return replayDescriptorKey_(a).localeCompare(replayDescriptorKey_(b));});
    }
    if(stage==='INDUSTRY'){
      industryRows.forEach(function(r){if(r.series_id)industryMap[String(r.series_id)]=true;});(rev.industrySeries||[]).forEach(function(x){industryMap[String(x)]=true;});
      return Object.keys(industryMap).sort();
    }
    if(stage==='AGGREGATES'){
      var seedMap={},seeds=[];function addSeed(freq,dataset,period,valueType,indexType){var d=freq==='weekly'?v300DateKey_(period):v300MonthKey_(period);if(!d)return;var s={frequency:freq,datasetCode:v300Text_(dataset),period:d,valueType:v300ValueType_(valueType),indexType:v300IndexType_(indexType||'')},k=[s.frequency,s.datasetCode,s.period,s.valueType,s.indexType].join('|');if(!seedMap[k]){seedMap[k]=true;seeds.push(s);}}
      v310MergeAffected_([],weeklyTargets).forEach(function(t){var vt=v300ValueType_(t.valueType);addSeed('weekly',t.datasetCode,t.period,vt,t.indexType||'');if(t.datasetCode===AKORT_V300.DATASETS.AKORT_WEEKLY&&(vt==='закупка'||vt==='розница')){addSeed('weekly',t.datasetCode,t.period,'наценка, %','');var m=v300MonthKey_(v300MonthStart_(t.period));addSeed('monthly',AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED,m,vt,'');addSeed('monthly',AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED,m,'наценка, %','');}});
      v310MergeAffected_([],monthlyTargets).forEach(function(t){var vt=v300ValueType_(t.valueType);addSeed('monthly',t.datasetCode,t.period,vt,t.indexType||'');if((t.datasetCode===AKORT_V300.DATASETS.AKORT_MONTHLY||t.datasetCode===AKORT_V300.DATASETS.AKORT_MONTHLY_DERIVED)&&(vt==='закупка'||vt==='розница'))addSeed('monthly',t.datasetCode,t.period,'наценка, %','');});
      var combos=[];seeds.forEach(function(s){(s.frequency==='weekly'?v310WeeklyDependentPeriods_(s.period):v310MonthlyDependentPeriods_(s.period)).forEach(function(p){combos.push({frequency:s.frequency,datasetCode:s.datasetCode,period:p,valueType:s.valueType,indexType:s.indexType||''});});});
      return v310MergeCombos_(combos).sort(function(a,b){return v310ComboKey_(a).localeCompare(v310ComboKey_(b));});
    }
    return[];
  }
  function initializeReplayWork_(state,group,stage){
    var items=replayStageItemsForGroup_(group,stage),total=replayWriteCache_(state,items),work={loadId:String(group.loadId),stage:stage,cursor:0,total:total,chunkSize:replayChunkSize_(stage),cacheReady:true};state.replayWork=work;
    return{loadId:group.loadId,stage:stage,planCached:true,totalItems:total,chunkSize:work.chunkSize};
  }
  function affectedForReplayGroup_(group){var dwh=getDwh_(),price=[],industry={};function scan(name,headers,frequency,dateField){var sh=dwh.getSheetByName(name);if(!sh)return;v300ReadObjects_(sh,headers).forEach(function(r){if(String(r.load_id||'UNREGISTERED')!==String(group.loadId))return;if(frequency==='industry'){if(r.series_id)industry[String(r.series_id)]=true;}else price.push({frequency:frequency,datasetCode:r.dataset_code,categoryId:r.category_id,valueType:r.value_type,indexType:r.index_type||'',period:frequency==='weekly'?v300DateKey_(r[dateField]):v300MonthKey_(r[dateField])});});}scan(AKORT_V300.SHEETS.RAW_PRICES_WEEKLY,AKORT_V300.HEADERS.RAW_PRICES_WEEKLY,'weekly','observation_date');scan(AKORT_V300.SHEETS.RAW_PRICES_MONTHLY,AKORT_V300.HEADERS.RAW_PRICES_MONTHLY,'monthly','observation_month');scan(AKORT_V300.SHEETS.RAW_INDUSTRY,AKORT_V300.HEADERS.RAW_INDUSTRY,'industry','period_start');if(group.isReversal||((group.reverseTargets||[]).length)){var rev=dwh.getSheetByName('RAW_REVERSAL_LOG'),records=rev&&rev.getLastRow()>1?readObjects_(rev).filter(function(r){return String(r.reversal_load_id||'')===String(group.loadId)&&String(r.status||'')==='SUCCESS';}):[],base=affectedFromReversal_({records:records});price=v310MergeAffected_(price,base.price);(base.industrySeries||[]).forEach(function(x){industry[String(x)]=true;});}return{price:v310MergeAffected_([],price),industrySeries:Object.keys(industry)};}
  function mapFromArray_(arr){var out={};(arr||[]).forEach(function(x){out[String(x)]=true;});return out;}
  function aggregateFrontierFromPublish_(){var frontier={};function scan(sheetName,headers,frequency,dateField){var sh=v300Publish_().getSheetByName(sheetName);if(!sh||sh.getLastRow()<2)return;v300ReadObjects_(sh,headers).forEach(function(r){var p=frequency==='weekly'?v300DateKey_(r[dateField]):v300MonthKey_(r[dateField]);if(p)frontier[v310AggregateFrontierKey_(frequency,r.dataset_code,p)]=true;});}scan(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,'weekly','observation_date');scan(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,'monthly','month_start');return frontier;}
  function replayPlan_(state,group){return withReplayContext_(state,function(){return planFromAffected_(affectedForReplayGroup_(group),{aggregateFrontier:aggregateFrontierFromPublish_()});});}
  function replayImpactPreview_(state,group){var plan=replayPlan_(state,group),counts={},invalid=0;(plan.aggregates||[]).forEach(function(c){counts[c.indexType]=(counts[c.indexType]||0)+1;if(!c.indexType)invalid++;});var preview={loadId:group.loadId,aggregateCombos:(plan.aggregates||[]).length,indexTypes:counts,invalidIndexTypes:invalid,frontierMode:ALPHA6_SCOPE.replayFrontierMode,executionStatus:ALPHA6_SCOPE.aggregateExecutionStatus};if(invalid)throw AKORT.Core.error('AGGREGATE_IMPACT_INDEX_TYPE_INVALID','Aggregate impact preview contains an empty index type.',preview);state.aggregateImpactPreview=state.aggregateImpactPreview||[];state.aggregateImpactPreview.push(preview);var sh=SpreadsheetApp.openById(state.controlId).getSheetByName('REPLAY_GROUPS');if(sh)sh.getRange(state.replayIndex+2,6).setValue(AKORT.Core.safeJson(preview));return preview;}
  function withReplayContext_(state,fn){ALPHA6_REPLAY_ALLOWED_LOADS=mapFromArray_(state.allowedLoadIds);ALPHA6_REPLAY_REVERSED_LOADS=mapFromArray_(state.reversedLoadIds);ALPHA6_PUBLISH_OVERRIDE_ID=state.incrementalId;try{return fn();}finally{ALPHA6_PUBLISH_OVERRIDE_ID='';ALPHA6_REPLAY_ALLOWED_LOADS=null;ALPHA6_REPLAY_REVERSED_LOADS=null;}}
  function replayDescriptorKey_(d){return[v300Text_(d.datasetCode),v300Text_(d.categoryId),v300ValueType_(d.valueType),v300IndexType_(d.indexType||''),v300Text_(d.seriesType)].join('|');}
  function replayStageItems_(plan,stage){
    var items=[];
    if(stage==='WEEKLY')items=v310WeeklyDescriptors_(plan.weekly||[]);
    else if(stage==='MONTHLY')items=v310MonthlyDescriptors_(plan.monthly||[]);
    else if(stage==='INDUSTRY')items=(plan.industrySeries||[]).slice();
    else if(stage==='AGGREGATES')items=(plan.aggregates||[]).slice();
    if(stage==='WEEKLY'||stage==='MONTHLY')items.sort(function(a,b){return replayDescriptorKey_(a).localeCompare(replayDescriptorKey_(b));});
    else if(stage==='AGGREGATES')items.sort(function(a,b){return v310ComboKey_(a).localeCompare(v310ComboKey_(b));});
    else items.sort(function(a,b){return String(a).localeCompare(String(b));});
    return items;
  }
  function replayChunkSize_(stage){if(stage==='WEEKLY'||stage==='MONTHLY')return 1;if(stage==='INDUSTRY')return 2;if(stage==='AGGREGATES')return 1;return 1;}
  function replaySeriesId_(d){return v300SeriesId_(d.datasetCode,d.categoryId,d.valueType,d.seriesType,d.indexType||'');}
  function v310UpdateAggregatesReplayChunk_(combos){
    var comboIndex={};(combos||[]).forEach(function(c){comboIndex[v310ComboKey_(c)]=true;});if(!Object.keys(comboIndex).length)return 0;
    var ss=v300Publish_(),headers=AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,sheet=ss.getSheetByName(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES);
    if(!sheet)throw new Error('Не найден лист PUBLISH_PRICE_AGGREGATES.');
    var existing=v300ReadObjects_(sheet,headers),toDelete=[],backup=[];
    existing.forEach(function(r){var k=v310ComboKey_({frequency:r.frequency,datasetCode:r.dataset_code,period:v300DateKey_(r.period_start),valueType:r.value_type,indexType:r.index_type||''});if(comboIndex[k]){toDelete.push(r._rowNumber);backup.push(rowValues_(headers,r));}});
    var objects=v310BuildAggregateRowsForCombos_(comboIndex);v317SetLatestAggregateRows_(objects);var rows=v300ObjectsToRows_(objects,headers);
    try{
      if(toDelete.length)v300DeleteRows_(ss,sheet,toDelete);
      for(var i=0;i<rows.length;i+=1000)v300AppendRows_(sheet,headers,rows.slice(i,i+1000));
      return rows.length;
    }catch(e){
      try{var fresh=v300ReadObjects_(sheet,headers),del=[];fresh.forEach(function(r){var k=v310ComboKey_({frequency:r.frequency,datasetCode:r.dataset_code,period:v300DateKey_(r.period_start),valueType:r.value_type,indexType:r.index_type||''});if(comboIndex[k])del.push(r._rowNumber);});if(del.length)v300DeleteRows_(ss,sheet,del);if(backup.length)v300AppendRows_(sheet,headers,backup);}catch(ignore){}
      throw e;
    }
  }
  function applyReplayChunk_(state,group,stage,items,start,size){return withReplayContext_(state,function(){
    var chunk=items.slice(start,start+size),result={stage:stage,loadId:group.loadId,chunkStart:start,chunkEnd:start+chunk.length,chunkSize:chunk.length,totalItems:items.length,rows:0};
    if(stage==='WEEKLY'){
      var wr=v310BuildWeeklyRowsForTargets_(chunk),wids=v310Unique_(chunk.map(replaySeriesId_));
      v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,wids,v300ObjectsToRows_(wr,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY),null);result.rows=wr.length;result.series=wids.length;
    }else if(stage==='MONTHLY'){
      var mr=v310BuildMonthlyRowsForTargets_(chunk),mids=v310Unique_(chunk.map(replaySeriesId_));
      v310ReplacePublishRowsBySeries_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,mids,v300ObjectsToRows_(mr,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY),null);result.rows=mr.length;result.series=mids.length;
    }else if(stage==='INDUSTRY'){result.rows=replaceIndustrySeries_(chunk);result.series=chunk.length;}
    else if(stage==='AGGREGATES')throw AKORT.Core.error('LEGACY_AGGREGATE_REPLAY_BLOCKED','Physical aggregate replay is disabled in corrected alpha.6. Reset the legacy reconciliation checkpoint and start a clean three-table run.',{loadId:group.loadId});
    return result;
  });}
  function advanceReplayStage_(state,groups,group,stage){
    state.replayWork=null;
    if(stage==='WEEKLY')state.replayStage='MONTHLY';
    else if(stage==='MONTHLY')state.replayStage='INDUSTRY';
    else if(stage==='INDUSTRY'){
      replayImpactPreview_(state,group);
      markReplayGroup_(state,state.replayIndex,'SUCCESS');state.replayIndex+=1;state.replayStage='PREPARE';
      if(state.replayIndex>=groups.length)state.replayStage='COMPLETE';
    }else throw AKORT.Core.error('REPLAY_STAGE_INVALID','Alpha.6 accepts only weekly, monthly and industry replay stages.',{stage:stage});
  }
  function replayFinalizeAggregateLatest_(state){return withReplayContext_(state,function(){
    var headers=AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,sh=v300Publish_().getSheetByName(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES),count=sh?Math.max(0,sh.getLastRow()-1):0;
    if(!sh||!count)return 0;
    var idx=v300HeaderIndex_(headers),left=sh.getRange(2,1,count,12).getValues(),weight=sh.getRange(2,idx.weight_source+1,count,1).getValues(),max={},flags=new Array(count);
    for(var i=0;i<count;i+=1){var vals=left[i],row={dataset_code:vals[idx.dataset_code],frequency:vals[idx.frequency],aggregate_level:vals[idx.aggregate_level],aggregate_id:vals[idx.aggregate_id],aggregate_name:vals[idx.aggregate_name],category_id:vals[idx.category_id],product_group:vals[idx.product_group],value_type:vals[idx.value_type],index_type:vals[idx.index_type],period_start:vals[idx.period_start],weight_source:weight[i][0]},d=v300Date_(row.period_start),k=v317AggregateSeriesKey_(row);if(d&&k&&(!max[k]||d>max[k]))max[k]=d;}
    for(var j=0;j<count;j+=1){var v=left[j],r={dataset_code:v[idx.dataset_code],frequency:v[idx.frequency],aggregate_level:v[idx.aggregate_level],aggregate_id:v[idx.aggregate_id],aggregate_name:v[idx.aggregate_name],category_id:v[idx.category_id],product_group:v[idx.product_group],value_type:v[idx.value_type],index_type:v[idx.index_type],period_start:v[idx.period_start],weight_source:weight[j][0]},date=v300Date_(r.period_start),key=v317AggregateSeriesKey_(r);flags[j]=[date&&key&&max[key]&&v300DateKey_(date)===v300DateKey_(max[key])?1:0];}
    var flagCol=idx.is_latest_period+1,batch=5000;for(var p=0;p<count;p+=batch)sh.getRange(p+2,flagCol,Math.min(batch,count-p),1).setValues(flags.slice(p,p+batch));return count;
  });}
  function replayStep_(state){
    var groups=state.replayGroups||[],stage=state.replayStage||'PREPARE';
    if(state.replayIndex>=groups.length){
      state.replayStage='COMPLETE';state.replayWork=null;state.phase='NORMALIZE_WEEKLY';return{completed:true,stage:'COMPLETE',groups:groups.length,aggregateExecutionStatus:ALPHA6_SCOPE.aggregateExecutionStatus};
    }
    var group=groups[state.replayIndex];
    if(stage==='PREPARE'){
      if((group.reverseTargets||[]).length){(group.reverseTargets||[]).forEach(function(x){if(state.reversedLoadIds.indexOf(String(x))<0)state.reversedLoadIds.push(String(x));});}
      else if(state.allowedLoadIds.indexOf(String(group.loadId))<0)state.allowedLoadIds.push(String(group.loadId));
      state.replayStage='WEEKLY';state.replayWork=null;replayClearCache_(state);markReplayGroup_(state,state.replayIndex,'RUNNING');
      return{loadId:group.loadId,stage:'PREPARE',allowedLoads:state.allowedLoadIds.length,reversedLoads:state.reversedLoadIds.length};
    }
    var work=state.replayWork;
    if(!work||String(work.loadId)!==String(group.loadId)||work.stage!==stage||work.cacheReady!==true)return initializeReplayWork_(state,group,stage);
    work.chunkSize=replayChunkSize_(stage);
    if(Number(work.cursor||0)>=Number(work.total||0)){advanceReplayStage_(state,groups,group,stage);replayClearCache_(state);return{loadId:group.loadId,stage:stage,chunkComplete:true,totalItems:Number(work.total||0),nextStage:state.replayStage};}
    var start=Number(work.cursor||0),items=replayReadCacheChunk_(state,start,Number(work.chunkSize||1)),result=applyReplayChunk_(state,group,stage,items,0,items.length);
    result.chunkStart=start;result.chunkEnd=start+items.length;result.totalItems=Number(work.total||0);work.cursor=result.chunkEnd;state.replayWork=work;
    if(work.cursor>=work.total){result.stageComplete=true;advanceReplayStage_(state,groups,group,stage);replayClearCache_(state);result.nextStage=state.replayStage;}else{result.stageComplete=false;result.nextCursor=work.cursor;}
    return result;
  }
  function rowIdentity_(sheetName,row){if(sheetName===AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY)return[v317PriceSeriesKey_(row),v300DateKey_(row.observation_date)].join('|');if(sheetName===AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY)return[v317PriceSeriesKey_(row),v300DateKey_(row.month_start)].join('|');if(sheetName===AKORT_V300.SHEETS.PUBLISH_INDUSTRY)return[v317IndustrySeriesKey_(row),v300DateKey_(row.period_start),v300DateKey_(row.period_end)].join('|');return[v317AggregateSeriesKey_(row),v300DateKey_(row.period_start),v300Text_(row.aggregate_id),v300Text_(row.aggregate_name),v300Text_(row.category_id),v300Text_(row.product_group),v300Text_(row.product_name)].join('|');}
  function normalizeIncrementalSheet_(state,sheetName,headers,dateField,formats){var full=SpreadsheetApp.openById(state.fullId).getSheetByName(sheetName),inc=SpreadsheetApp.openById(state.incrementalId).getSheetByName(sheetName),fullRows=v300ReadObjects_(full,headers),incRows=v300ReadObjects_(inc,headers);if(sheetName===AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES)v317SetLatestAggregateRows_(incRows);else v317SetLatestBySeriesRows_(incRows,dateField);var buckets={};incRows.forEach(function(r){var k=rowIdentity_(sheetName,r);(buckets[k]||(buckets[k]=[])).push(r);});var ordered=[],missing=0;fullRows.forEach(function(r){var k=rowIdentity_(sheetName,r),bucket=buckets[k];if(bucket&&bucket.length)ordered.push(rowValues_(headers,bucket.shift()));else missing++;});var extra=[];Object.keys(buckets).sort().forEach(function(k){(buckets[k]||[]).forEach(function(r){extra.push(rowValues_(headers,r));});});ordered=ordered.concat(extra);writeBuildSheet_(state.incrementalId,sheetName,headers,ordered,formats);return{sheet:sheetName,rows:ordered.length,missingAgainstFull:missing,extraAgainstFull:extra.length};}
  function serializeCell_(v,header){if(v===null||v===undefined||v==='')return'N:';if(Object.prototype.toString.call(v)==='[object Date]'||/(date|month_start|period_start|period_end)$/.test(header)) {var d=v300Date_(v);return d?'D:'+v300DateKey_(d):'S:'+String(v);}if(typeof v==='number')return'F:'+String(v);if(typeof v==='boolean')return'B:'+(v?'1':'0');return'S:'+JSON.stringify(String(v));}
  function sheetDigest_(ssId,sheetName,headers,chunkRows){var sh=SpreadsheetApp.openById(ssId).getSheetByName(sheetName),count=Math.max(0,sh.getLastRow()-1),parts=[];for(var start=2;start<=sh.getLastRow();start+=chunkRows){var n=Math.min(chunkRows,sh.getLastRow()-start+1),vals=sh.getRange(start,1,n,headers.length).getValues(),text=vals.map(function(row){return row.map(function(v,i){return serializeCell_(v,headers[i]);}).join('\u001f');}).join('\u001e');parts.push(AKORT.Core.sha256(text));}return{rows:count,hash:AKORT.Core.sha256(parts.join('|')),chunks:parts.length};}
  function appendReconRow_(state,sheetName,b,f,i,status,details){var t=table_(getDwh_(),'PUBLISH_RECONCILIATION',TABLES.PUBLISH_RECONCILIATION);appendObject_(t,{reconciliation_id:state.reconciliationId,checked_at:AKORT.Core.now(),full_build_id:state.fullId,incremental_build_id:state.incrementalId,sheet_name:sheetName,baseline_rows:b.rows,full_rows:f.rows,incremental_rows:i.rows,baseline_hash:b.hash,full_hash:f.hash,incremental_hash:i.hash,full_equals_baseline:b.rows===f.rows&&b.hash===f.hash,incremental_equals_full:f.rows===i.rows&&f.hash===i.hash,status:status,details_json:AKORT.Core.safeJson(details||{}),release_version:AKORT.Release.version});}
  function startReconciliation(){return AKORT.Core.safeRun('PUBLISH_RECONCILIATION_START',function(){AKORT.EnvironmentGuard.assertDev();var existing=loadRecon_();if(existing&&existing.status==='RUNNING')return AKORT.Result.failure('RECONCILIATION_ACTIVE','A reconciliation checkpoint already exists. Preserve its report links, then run AKORT_alpha6ResetReconciliation before starting the corrected three-table acceptance run.',publicRecon_(existing));var stamp=Utilities.formatDate(new Date(),'Europe/Moscow','yyyyMMdd_HHmmss'),full=initBuildBook_(createTempBook_('AKORT_ALPHA6_FULL_'+stamp)),inc=initBuildBook_(createTempBook_('AKORT_ALPHA6_INCREMENTAL_'+stamp)),ctrl=createTempBook_('AKORT_ALPHA6_RECON_'+stamp);initControlBook_(ctrl);var state={reconciliationId:id_('RECON'),status:'RUNNING',phase:RECON_PHASES[0],scope:'ALPHA6_NON_AGGREGATE',acceptanceSheets:ALPHA6_SCOPE.acceptanceSheets.slice(),aggregateExecutionStatus:ALPHA6_SCOPE.aggregateExecutionStatus,fullId:full.getId(),incrementalId:inc.getId(),controlId:ctrl.getId(),startedAt:AKORT.Core.now(),updatedAt:AKORT.Core.now(),results:[],replayGroups:[],replayIndex:0,replayStage:'PREPARE',allowedLoadIds:[],reversedLoadIds:[],normalization:[],aggregateImpactPreview:[]};saveRecon_(state);return AKORT.Result.success('Alpha.6 corrected three-table reconciliation initialized.',publicRecon_(state));},{lock:true,persistLogs:true});}
  function publicRecon_(s){if(!s)return null;var w=s.replayWork||{};return{reconciliationId:s.reconciliationId,status:s.status,phase:s.phase,scope:s.scope||'LEGACY_FOUR_TABLE',acceptanceSheets:s.acceptanceSheets||ALPHA6_SCOPE.acceptanceSheets.slice(),aggregateExecutionStatus:s.aggregateExecutionStatus||ALPHA6_SCOPE.aggregateExecutionStatus,fullBuildUrl:'https://docs.google.com/spreadsheets/d/'+s.fullId+'/edit',incrementalBuildUrl:'https://docs.google.com/spreadsheets/d/'+s.incrementalId+'/edit',controlUrl:'https://docs.google.com/spreadsheets/d/'+s.controlId+'/edit',startedAt:s.startedAt,updatedAt:s.updatedAt,replay:{groupCount:(s.replayGroups||[]).length,currentIndex:s.replayIndex||0,currentStage:s.replayStage||'',currentLoadId:w.loadId||((s.replayGroups||[])[s.replayIndex]||{}).loadId||'',chunkCursor:Number(w.cursor||0),chunkTotal:Number(w.total||0),chunkSize:Number(w.chunkSize||0),allowedLoads:(s.allowedLoadIds||[]).length,reversedLoads:(s.reversedLoadIds||[]).length},aggregateImpactPreview:s.aggregateImpactPreview||[],rawReplayValidation:s.rawReplayValidation||[],normalization:s.normalization||[],results:s.results||[]};}
  function reconRowCount_(spreadsheetId,sheetName){
    var sh=SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    return sh?Math.max(0,sh.getLastRow()-1):0;
  }
  function reconClearData_(spreadsheetId,sheetName,headers){
    var ss=SpreadsheetApp.openById(spreadsheetId),sh=v300EnsureSheet_(ss,sheetName,headers,2,headers.length);
    if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,Math.max(headers.length,sh.getLastColumn())).clearContent().clearFormat();
    return 0;
  }
  function reconAppendObjects_(spreadsheetId,sheetName,headers,objects){
    var ss=SpreadsheetApp.openById(spreadsheetId),sh=v300EnsureSheet_(ss,sheetName,headers,2,headers.length),rows=v300ObjectsToRows_(objects||[],headers),batch=Math.max(250,Number(runtimeSettings_().writeBatchSize||1000));
    for(var i=0;i<rows.length;i+=batch)v300AppendRows_(sh,headers,rows.slice(i,i+batch));
    return rows.length;
  }
  function reconNormalizeAggregateDates_(rows){
    (rows||[]).forEach(function(r){
      var d=v300Date_(r.period_start);if(!d)return;
      if(r.year===''||r.year===null||r.year===undefined)r.year=d.getFullYear();
      if(r.quarter===''||r.quarter===null||r.quarter===undefined)r.quarter=v300Quarter_(d.getMonth()+1);
      if(r.month===''||r.month===null||r.month===undefined)r.month=d.getMonth()+1;
      if(r.period_label===''||r.period_label===null||r.period_label===undefined)r.period_label=r.frequency==='weekly'?(v300Iso_(d).year+'-W'+v300Pad2_(v300Iso_(d).week)):v300MonthKey_(d);
      if(r.aggregate_value===undefined)r.aggregate_value='';
      if(r.aggregate_base_value===undefined)r.aggregate_base_value='';
    });
    return rows||[];
  }
  function reconFinalizeAggregateLatest_(state){
    var headers=AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,ss=SpreadsheetApp.openById(state.fullId),sh=ss.getSheetByName(AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES),rows=v300ReadObjects_(sh,headers);
    v317SetLatestAggregateRows_(rows);
    var idx=v300HeaderIndex_(headers).is_latest_period+1,values=rows.map(function(r){return[v300Bool01_(r.is_latest_period)];}),batch=5000;
    for(var i=0;i<values.length;i+=batch)sh.getRange(i+2,idx,Math.min(batch,values.length-i),1).setValues(values.slice(i,i+batch));
    return rows.length;
  }
  function reconAggregateBuildStep_(state){
    var stage=state.aggregateBuildStage||'WEEKLY',headers=AKORT_V300.HEADERS.PUBLISH_PRICE_AGGREGATES,rows,count=0;
    ALPHA6_PUBLISH_OVERRIDE_ID=state.fullId;
    try{
      if(stage==='WEEKLY'){
        reconClearData_(state.fullId,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,headers);
        rows=reconNormalizeAggregateDates_(v304AggregateFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,'weekly',v304WeightIndex_()));
        count=reconAppendObjects_(state.fullId,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,headers,rows);state.aggregateBuildStage='MONTHLY';
      }else if(stage==='MONTHLY'){
        rows=reconNormalizeAggregateDates_(v304AggregateFromPublish_(AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,'monthly',v304WeightIndex_()));
        count=reconAppendObjects_(state.fullId,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,headers,rows);state.aggregateBuildStage='SPECIAL';
      }else if(stage==='SPECIAL'){
        rows=reconNormalizeAggregateDates_(v315BuildAllSpecialRows_());
        count=reconAppendObjects_(state.fullId,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES,headers,rows);state.aggregateBuildStage='LATEST';
      }else if(stage==='LATEST'){
        count=reconFinalizeAggregateLatest_(state);state.aggregateBuildStage='DONE';state.phase='BUILD_REPLAY_PLAN';
      }else if(stage==='DONE')state.phase='BUILD_REPLAY_PLAN';
      else throw AKORT.Core.error('RECON_AGGREGATE_STAGE_INVALID','Unsupported aggregate build stage.',{stage:stage});
    }finally{ALPHA6_PUBLISH_OVERRIDE_ID='';}
    return{stage:stage,rowsProcessed:count,totalRows:reconRowCount_(state.fullId,AKORT_V300.SHEETS.PUBLISH_PRICE_AGGREGATES),nextStage:state.aggregateBuildStage||'',nextPhase:state.phase};
  }
  function reconEnsureCanonicalBaseline_(state){
    if(state.baselineCanonicalId)return state.baselineCanonicalId;
    var cfg=AKORT.Config.load({includeSystemSettings:false}),source=DriveApp.getFileById(cfg.resources.publishSpreadsheetId),folder=DriveApp.getFolderById(cfg.resources.testResultsFolderId),stamp=Utilities.formatDate(new Date(),'Europe/Moscow','yyyyMMdd_HHmmss'),copy=source.makeCopy('AKORT_ALPHA6_BASELINE_CANONICAL_'+stamp,folder);
    state.baselineCanonicalId=copy.getId();return state.baselineCanonicalId;
  }
  function reconSortSpec_(sheetName){
    if(sheetName===AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY)return[{column:1,ascending:true},{column:13,ascending:true},{column:3,ascending:true},{column:14,ascending:true}];
    if(sheetName===AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY)return[{column:1,ascending:true},{column:13,ascending:true},{column:3,ascending:true},{column:14,ascending:true}];
    if(sheetName===AKORT_V300.SHEETS.PUBLISH_INDUSTRY)return[{column:3,ascending:true},{column:10,ascending:true},{column:11,ascending:true}];
    return[{column:1,ascending:true},{column:3,ascending:true},{column:4,ascending:true},{column:5,ascending:true},{column:6,ascending:true},{column:7,ascending:true},{column:8,ascending:true},{column:9,ascending:true},{column:10,ascending:true},{column:11,ascending:true},{column:24,ascending:true},{column:12,ascending:true}];
  }
  function reconCanonicalSort_(spreadsheetId,sheetName,headers){
    var sh=SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName),rows=Math.max(0,sh.getLastRow()-1);
    if(rows>1)sh.getRange(2,1,rows,headers.length).sort(reconSortSpec_(sheetName));
    return rows;
  }
  function reconNormalizeStep_(state,sheetName,headers,nextPhase){
    var baselineId=reconEnsureCanonicalBaseline_(state),stage=state.normalizeStage||'BASELINE',id=stage==='BASELINE'?baselineId:(stage==='FULL'?state.fullId:state.incrementalId),rows=reconCanonicalSort_(id,sheetName,headers);
    if(stage==='BASELINE')state.normalizeStage='FULL';else if(stage==='FULL')state.normalizeStage='INCREMENTAL';else{state.normalizeStage='BASELINE';state.normalization=state.normalization||[];state.normalization.push({sheet:sheetName,mode:'CANONICAL_SORT',rows:rows});state.phase=nextPhase;}
    return{sheet:sheetName,stage:stage,rows:rows,nextStage:state.normalizeStage,nextPhase:state.phase,baselineCanonicalUrl:'https://docs.google.com/spreadsheets/d/'+baselineId+'/edit'};
  }
  function reconCompareSpec_(phase){
    return{COMPARE_WEEKLY:[AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,'COMPARE_MONTHLY'],COMPARE_MONTHLY:[AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,'COMPARE_INDUSTRY'],COMPARE_INDUSTRY:[AKORT_V300.SHEETS.PUBLISH_INDUSTRY,AKORT_V300.HEADERS.PUBLISH_INDUSTRY,'FINALIZE']}[phase];
  }
  function sheetDigestChunkStep_(id,sheetName,headers,digestWork){
    var sh=SpreadsheetApp.openById(id).getSheetByName(sheetName),rows=Math.max(0,sh.getLastRow()-1),chunk=Math.max(1000,Number(runtimeSettings_().chunkRows||500)*10),cursor=Number(digestWork.cursor||0),parts=digestWork.parts||[];
    if(cursor<rows){var n=Math.min(chunk,rows-cursor),vals=sh.getRange(cursor+2,1,n,headers.length).getValues(),text=vals.map(function(row){return row.map(function(v,i){return serializeCell_(v,headers[i]);}).join('\u001f');}).join('\u001e');parts.push(AKORT.Core.sha256(text));cursor+=n;digestWork.cursor=cursor;digestWork.parts=parts;return{complete:false,rows:rows,cursor:cursor,chunks:parts.length};}
    return{complete:true,digest:{rows:rows,hash:AKORT.Core.sha256(parts.join('|')),chunks:parts.length}};
  }
  function reconCompareStep_(state){
    var x=reconCompareSpec_(state.phase),work=state.compareWork;
    if(!x)throw AKORT.Core.error('RECON_COMPARE_PHASE_INVALID','Unsupported compare phase.',{phase:state.phase});
    if(!work||work.phase!==state.phase)work=state.compareWork={phase:state.phase,stage:'BASELINE',digests:{},digestWork:{cursor:0,parts:[]}};
    var stage=work.stage,id=stage==='BASELINE'?reconEnsureCanonicalBaseline_(state):(stage==='FULL'?state.fullId:state.incrementalId);
    if(stage!=='FINALIZE'){
      work.digestWork=work.digestWork||{cursor:0,parts:[]};var step=sheetDigestChunkStep_(id,x[0],x[1],work.digestWork);
      if(!step.complete)return{sheet:x[0],stage:stage,digestProgress:step,nextStage:stage};
      if(stage==='BASELINE'){work.digests.baseline=step.digest;work.stage='FULL';}
      else if(stage==='FULL'){work.digests.full=step.digest;work.stage='INCREMENTAL';}
      else{work.digests.incremental=step.digest;work.stage='FINALIZE';}
      work.digestWork={cursor:0,parts:[]};return{sheet:x[0],stage:stage,digest:step.digest,nextStage:work.stage};
    }
    var b=work.digests.baseline,f=work.digests.full,i=work.digests.incremental,pass=b.rows===f.rows&&b.hash===f.hash&&f.rows===i.rows&&f.hash===i.hash,r={sheet:x[0],status:pass?'PASS':'FAIL',baseline:b,full:f,incremental:i};
    state.results=state.results||[];state.results=state.results.filter(function(old){return old.sheet!==x[0];});state.results.push(r);appendReconRow_(state,x[0],b,f,i,pass?'PASS':'FAIL',{replayLoadGroups:(state.replayGroups||[]).length,normalization:state.normalization||[]});state.phase=x[2];state.compareWork=null;
    return{sheet:x[0],stage:'FINALIZE',status:r.status,nextPhase:state.phase};
  }
  function continueReconciliation(){return AKORT.Core.safeRun('PUBLISH_RECONCILIATION_CONTINUE',function(){
    AKORT.EnvironmentGuard.assertDev();var s=loadRecon_();if(!s)return AKORT.Result.failure('RECONCILIATION_NOT_STARTED','Run AKORT_alpha6StartReconciliation first.');if(s.scope!=='ALPHA6_NON_AGGREGATE')return AKORT.Result.failure('LEGACY_RECONCILIATION_REQUIRES_RESET','This checkpoint belongs to the abandoned four-table aggregate run. Preserve its workbook links, run AKORT_alpha6ResetReconciliation, then start a clean corrected reconciliation.',publicRecon_(s));if(s.status==='SUCCESS')return AKORT.Result.success('Reconciliation already completed.',publicRecon_(s));if(s.status==='FAILED')return AKORT.Result.failure('PUBLISH_RECONCILIATION_FAILED','Reconciliation is in failed status.',publicRecon_(s));var f=v300FormatRows_(),stepResult=null;
    if(s.phase==='BUILD_FULL_WEEKLY'){
      var weeklyExpected=reconRowCount_(AKORT.Config.load({includeSystemSettings:false}).resources.publishSpreadsheetId,AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY),weeklyActual=reconRowCount_(s.fullId,AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY);
      if(weeklyActual===weeklyExpected&&weeklyActual>0){s.phase='BUILD_FULL_MONTHLY';stepResult={recovered:true,sheet:AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,rows:weeklyActual};}else{writeBuildSheet_(s.fullId,AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,v300BuildWeeklyPublish_(),null);s.phase='BUILD_FULL_MONTHLY';}
    }else if(s.phase==='BUILD_FULL_MONTHLY'){
      var monthlyExpected=reconRowCount_(AKORT.Config.load({includeSystemSettings:false}).resources.publishSpreadsheetId,AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY),monthlyActual=reconRowCount_(s.fullId,AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY);
      if(monthlyActual===monthlyExpected&&monthlyActual>0){s.phase='BUILD_FULL_INDUSTRY';stepResult={recovered:true,sheet:AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,rows:monthlyActual};}else{writeBuildSheet_(s.fullId,AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,v300BuildMonthlyPublish_(),null);s.phase='BUILD_FULL_INDUSTRY';}
    }else if(s.phase==='BUILD_FULL_INDUSTRY'){
      var industryExpected=reconRowCount_(AKORT.Config.load({includeSystemSettings:false}).resources.publishSpreadsheetId,AKORT_V300.SHEETS.PUBLISH_INDUSTRY),industryActual=reconRowCount_(s.fullId,AKORT_V300.SHEETS.PUBLISH_INDUSTRY);
      if(industryActual===industryExpected&&industryActual>0){s.phase='BUILD_REPLAY_PLAN';stepResult={recovered:true,sheet:AKORT_V300.SHEETS.PUBLISH_INDUSTRY,rows:industryActual};}else{writeBuildSheet_(s.fullId,AKORT_V300.SHEETS.PUBLISH_INDUSTRY,AKORT_V300.HEADERS.PUBLISH_INDUSTRY,v300BuildIndustryPublish_(),null);s.phase='BUILD_REPLAY_PLAN';}
    }else if(s.phase==='BUILD_REPLAY_PLAN'){s.replayGroups=collectReplayGroups_();s.rawReplayValidation=validateFinalReplayRaw_(s.replayGroups);s.replayIndex=0;s.replayStage='PREPARE';s.allowedLoadIds=[];s.reversedLoadIds=[];writeReplayGroups_(s);s.phase=s.replayGroups.length?'REPLAY_INCREMENTAL':'NORMALIZE_WEEKLY';stepResult={replayGroups:s.replayGroups.length,rawReplayValidation:s.rawReplayValidation};}
    else if(s.phase==='REPLAY_INCREMENTAL')stepResult=replayStep_(s);
    else if(s.phase==='NORMALIZE_WEEKLY')stepResult=reconNormalizeStep_(s,AKORT_V300.SHEETS.PUBLISH_PRICES_WEEKLY,AKORT_V300.HEADERS.PUBLISH_PRICES_WEEKLY,'NORMALIZE_MONTHLY');
    else if(s.phase==='NORMALIZE_MONTHLY')stepResult=reconNormalizeStep_(s,AKORT_V300.SHEETS.PUBLISH_PRICES_MONTHLY,AKORT_V300.HEADERS.PUBLISH_PRICES_MONTHLY,'NORMALIZE_INDUSTRY');
    else if(s.phase==='NORMALIZE_INDUSTRY')stepResult=reconNormalizeStep_(s,AKORT_V300.SHEETS.PUBLISH_INDUSTRY,AKORT_V300.HEADERS.PUBLISH_INDUSTRY,'COMPARE_WEEKLY');
    else if(s.phase.indexOf('COMPARE_')===0)stepResult=reconCompareStep_(s);
    else if(s.phase==='FINALIZE'){var ok=(s.results||[]).length===3&&(s.results||[]).every(function(r){return r.status==='PASS';});s.status=ok?'SUCCESS':'FAILED';s.phase=ok?'SUCCESS':'COMPARE_FAILED';s.finishedAt=AKORT.Core.now();}
    else throw AKORT.Core.error('RECONCILIATION_PHASE_INVALID','Unsupported reconciliation phase.',{phase:s.phase});
    s.updatedAt=AKORT.Core.now();saveRecon_(s);var data=publicRecon_(s);data.aggregateBuildStage=s.aggregateBuildStage||'';data.normalizeStage=s.normalizeStage||'';data.compareWork=s.compareWork||null;if(s.baselineCanonicalId)data.baselineCanonicalUrl='https://docs.google.com/spreadsheets/d/'+s.baselineCanonicalId+'/edit';if(stepResult)data.lastStep=stepResult;
    return s.status==='FAILED'?AKORT.Result.failure('PUBLISH_RECONCILIATION_FAILED','Full, sequential incremental and baseline results do not match.',data):AKORT.Result.success(s.status==='SUCCESS'?'Alpha.6 three-table triple reconciliation passed.':'Alpha.6 reconciliation step completed.',data);
  },{lock:true,persistLogs:true});}
  function reconciliationStatus(){var s=loadRecon_();return s?AKORT.Result.success('Alpha.6 reconciliation status loaded.',publicRecon_(s)):AKORT.Result.failure('RECONCILIATION_NOT_STARTED','No alpha.6 reconciliation state exists.');}

  function dispatcherStateKey_(runId){return RECON_DISPATCHER_STATE_KEY+(runId?'_'+String(runId):'');}
  function dispatcherLoad_(runId){if(!runId){var control=dispatcherControlLoad_();runId=control&&control.runId||'';}var raw=PropertiesService.getScriptProperties().getProperty(dispatcherStateKey_(runId));return raw?JSON.parse(raw):null;}
  function dispatcherSave_(state){state.updatedAt=AKORT.Core.now();PropertiesService.getScriptProperties().setProperty(dispatcherStateKey_(state&&state.runId||''),JSON.stringify(state));return state;}
  function dispatcherCleanupStateKeys_(keepRunId){var props=PropertiesService.getScriptProperties(),all=props.getProperties(),keep=dispatcherStateKey_(keepRunId),prefix=RECON_DISPATCHER_STATE_KEY+'_',removed=0;Object.keys(all).forEach(function(key){if(key.indexOf(prefix)===0&&key!==keep){props.deleteProperty(key);removed+=1;}});props.deleteProperty(RECON_DISPATCHER_STATE_KEY);return removed;}
  function dispatcherControlLoad_(){var raw=PropertiesService.getScriptProperties().getProperty(RECON_DISPATCHER_CONTROL_KEY);return raw?JSON.parse(raw):null;}
  function dispatcherControlSave_(control){control.updatedAt=AKORT.Core.now();PropertiesService.getScriptProperties().setProperty(RECON_DISPATCHER_CONTROL_KEY,JSON.stringify(control));return control;}
  function dispatcherControlMatches_(control,state){return!!(control&&state&&control.enabled===true&&control.runId&&String(control.runId)===String(state.runId));}
  function dispatcherRunActive_(state){return dispatcherControlMatches_(dispatcherControlLoad_(),state);}
  function dispatcherRequestStop_(reason){var control=dispatcherControlLoad_()||{runId:'',reconciliationId:''};control.enabled=false;control.status=reason||'STOPPED';control.stopReason=reason||'STOPPED';control.stopRequestedAt=AKORT.Core.now();control.requestId=id_('CONTROL');return dispatcherControlSave_(control);}
  function dispatcherTriggers_(){return ScriptApp.getProjectTriggers().filter(function(trigger){return trigger.getHandlerFunction()===RECON_DISPATCHER_HANDLER;});}
  function dispatcherDeleteTriggers_(){var triggers=dispatcherTriggers_();triggers.forEach(function(trigger){ScriptApp.deleteTrigger(trigger);});return triggers.length;}
  function dispatcherEnsureTrigger_(){var triggers=dispatcherTriggers_();if(!triggers.length){ScriptApp.newTrigger(RECON_DISPATCHER_HANDLER).timeBased().everyMinutes(RECON_DISPATCHER_INTERVAL_MINUTES).create();triggers=dispatcherTriggers_();}if(triggers.length>1){triggers.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});triggers=dispatcherTriggers_();}return triggers.length;}
  function dispatcherResultSummary_(result){var data=result&&(result.data||result.details)?(result.data||result.details):{},replay=data.replay||{};return{ok:result?result.ok:false,status:result?result.status:'',message:result?result.message:'',reconciliationStatus:data.status||'',phase:data.phase||'',currentIndex:Number(replay.currentIndex||0),currentStage:replay.currentStage||'',currentLoadId:replay.currentLoadId||'',chunkCursor:Number(replay.chunkCursor||0),chunkTotal:Number(replay.chunkTotal||0),timestamp:result&&result.timestamp?result.timestamp:AKORT.Core.now()};}
  function dispatcherPublic_(state){var s=state||dispatcherLoad_()||{},control=dispatcherControlLoad_()||{},active=dispatcherControlMatches_(control,s),recon=loadRecon_();return{enabled:active,status:active?(s.status||'SCHEDULED'):(control.status||s.status||'STOPPED'),runId:control.runId||s.runId||'',stateKey:dispatcherStateKey_(control.runId||s.runId||''),controlUpdatedAt:control.updatedAt||'',controlStopReason:control.stopReason||'',handler:RECON_DISPATCHER_HANDLER,triggerMode:'PERSISTENT_EVERY_MINUTE',triggerCount:dispatcherTriggers_().length,startedAt:s.startedAt||'',updatedAt:s.updatedAt||'',lastStartedAt:s.lastStartedAt||'',lastFinishedAt:s.lastFinishedAt||'',nextRunAt:active?(s.nextRunAt||''):'',attempts:Number(s.attempts||0),successfulSteps:Number(s.successfulSteps||0),skippedLockedRuns:Number(s.skippedLockedRuns||0),consecutiveErrors:Number(s.consecutiveErrors||0),interruptedRuns:Number(s.interruptedRuns||0),lastDurationMs:Number(s.lastDurationMs||0),lastCheckpointCommitted:s.lastCheckpointCommitted||'',nextAction:active?(s.nextAction||'CONTINUE_RECONCILIATION'):'NONE',lastError:s.lastError||null,lastResult:s.lastResult||null,reconciliation:publicRecon_(recon)};}
  function dispatcherStoppedDuringStep_(state){var control=dispatcherControlLoad_()||{};if(control.enabled===true&&String(control.runId)!==String(state.runId))return AKORT.Result.success('Dispatcher run was superseded; stale worker state was discarded.',{staleRunId:state.runId,currentRunId:control.runId});dispatcherDeleteTriggers_();state.enabled=false;state.status=control.status||'STOPPED_DURING_STEP';state.nextRunAt='';state.nextAction='NONE';state.lastFinishedAt=AKORT.Core.now();dispatcherSave_(state);return AKORT.Result.success('Dispatcher stop request was honored after the in-flight reconciliation step.',dispatcherPublic_(state));}
  function dispatcherTerminalState_(state,recon,reason){var control=dispatcherControlLoad_();if(!dispatcherControlMatches_(control,state))return dispatcherPublic_(state);control.enabled=false;control.status=recon&&(recon.status==='SUCCESS'||recon.status==='FAILED')?recon.status:(reason||'STOPPED');control.stopReason=reason||control.status;dispatcherControlSave_(control);dispatcherDeleteTriggers_();state.enabled=false;state.status=control.status;state.nextRunAt='';state.lastFinishedAt=AKORT.Core.now();state.stopReason=control.stopReason;state.nextAction='NONE';dispatcherSave_(state);return dispatcherPublic_(state);}
  function startReconciliationDispatcher(){return AKORT.Core.safeRun('PUBLISH_RECONCILIATION_DISPATCHER_START',function(){AKORT.EnvironmentGuard.assertDev();var lifecycleLock=LockService.getUserLock();if(!lifecycleLock.tryLock(1000))return AKORT.Result.failure('RECONCILIATION_DISPATCHER_WORKER_ACTIVE','A dispatcher worker is still active. Wait for the in-flight step to finish before starting a new dispatcher run.',dispatcherPublic_(dispatcherLoad_()));try{var recon=loadRecon_();if(!recon)return AKORT.Result.failure('RECONCILIATION_NOT_STARTED','Run AKORT_alpha6StartReconciliation first.');if(recon.scope!=='ALPHA6_NON_AGGREGATE')return AKORT.Result.failure('LEGACY_RECONCILIATION_REQUIRES_RESET','Reset the archived four-table checkpoint and start the corrected three-table reconciliation before enabling the dispatcher.',publicRecon_(recon));if(recon.status==='SUCCESS')return AKORT.Result.success('Reconciliation is already complete.',{dispatcher:dispatcherPublic_(dispatcherLoad_()),reconciliation:publicRecon_(recon)});if(recon.status==='FAILED')return AKORT.Result.failure('PUBLISH_RECONCILIATION_FAILED','Reconciliation is in failed status.',publicRecon_(recon));var currentState=dispatcherLoad_(),currentControl=dispatcherControlLoad_();if(dispatcherControlMatches_(currentControl,currentState)){dispatcherEnsureTrigger_();return AKORT.Result.success('Alpha.6 persistent reconciliation dispatcher is already active.',dispatcherPublic_(currentState));}var removed=dispatcherDeleteTriggers_(),now=AKORT.Core.now(),runId=id_('DISPATCHER'),control={runId:runId,reconciliationId:recon.reconciliationId||'',enabled:true,status:'SCHEDULED',startedAt:now,stopReason:'',requestId:id_('CONTROL')},state={runId:runId,reconciliationId:recon.reconciliationId||'',enabled:true,status:'SCHEDULED',startedAt:now,updatedAt:now,lastStartedAt:'',lastFinishedAt:'',nextRunAt:new Date(Date.now()+60000).toISOString(),attempts:0,successfulSteps:0,skippedLockedRuns:0,consecutiveErrors:0,interruptedRuns:0,lastDurationMs:0,lastCheckpointCommitted:recon.updatedAt||'',nextAction:'CONTINUE_RECONCILIATION',lastError:null,lastResult:null,removedTriggersOnStart:removed,triggerCountOnStart:0};dispatcherControlSave_(control);dispatcherCleanupStateKeys_(runId);dispatcherSave_(state);try{state.triggerCountOnStart=dispatcherEnsureTrigger_();dispatcherSave_(state);}catch(triggerError){dispatcherRequestStop_('TRIGGER_CREATION_FAILED');dispatcherDeleteTriggers_();throw triggerError;}return AKORT.Result.success('Alpha.6 persistent reconciliation dispatcher started.',dispatcherPublic_(state));}finally{try{lifecycleLock.releaseLock();}catch(ignore){}}},{lock:false,persistLogs:true});}
  function stopReconciliationDispatcher(){return AKORT.Core.safeRun('PUBLISH_RECONCILIATION_DISPATCHER_STOP',function(){AKORT.EnvironmentGuard.assertDev();var control=dispatcherRequestStop_('STOPPED_MANUALLY'),state=dispatcherLoad_()||{runId:control.runId||'',startedAt:'',attempts:0,successfulSteps:0,skippedLockedRuns:0,consecutiveErrors:0,interruptedRuns:0},removed=dispatcherDeleteTriggers_();state.enabled=false;state.status='STOPPED_MANUALLY';state.nextRunAt='';state.lastFinishedAt=AKORT.Core.now();state.nextAction='NONE';state.removedTriggersOnStop=removed;dispatcherSave_(state);return AKORT.Result.success('Alpha.6 reconciliation dispatcher stop requested. Any in-flight step may finish, but cannot re-enable the dispatcher.',dispatcherPublic_(state));},{lock:false,persistLogs:true});}
  function reconciliationDispatcherStatus(){return AKORT.Result.success('Alpha.6 reconciliation dispatcher status loaded.',dispatcherPublic_(dispatcherLoad_()));}
  function reconciliationDispatcherWorker(){
    var workerLock=LockService.getUserLock();
    if(!workerLock.tryLock(1000))return AKORT.Result.success('Another dispatcher worker is still active; this tick was skipped without changing durable dispatcher state.',{skipped:true,reason:'WORKER_OVERLAP'});
    try{
      var state=dispatcherLoad_(),control=dispatcherControlLoad_();
      if(!dispatcherControlMatches_(control,state)){if(!control||control.enabled!==true)dispatcherDeleteTriggers_();return AKORT.Result.success('Reconciliation dispatcher is disabled or this worker belongs to a superseded run.',dispatcherPublic_(state));}
      try{AKORT.EnvironmentGuard.assertDev();}catch(environmentError){state.lastError={code:'ENVIRONMENT_GUARD_FAILED',message:String(environmentError&&environmentError.message||environmentError),at:AKORT.Core.now()};return AKORT.Result.failure('ENVIRONMENT_GUARD_FAILED','Dispatcher stopped because DEV environment validation failed.',dispatcherTerminalState_(state,loadRecon_(),'ENVIRONMENT_GUARD_FAILED'));}
      dispatcherEnsureTrigger_();if(!dispatcherRunActive_(state))return dispatcherStoppedDuringStep_(state);var recon=loadRecon_();
      if(!recon){state.lastError={code:'RECONCILIATION_NOT_STARTED',message:'No reconciliation checkpoint exists.',at:AKORT.Core.now()};return AKORT.Result.failure('RECONCILIATION_NOT_STARTED','Dispatcher stopped because reconciliation state is missing.',dispatcherTerminalState_(state,null,'RECONCILIATION_NOT_STARTED'));}
      if(recon.status==='SUCCESS'||recon.status==='FAILED')return AKORT.Result.success('Dispatcher found a terminal reconciliation state.',dispatcherTerminalState_(state,recon,recon.status));
      var now=Date.now(),previousStart=state.lastStartedAt?Date.parse(state.lastStartedAt):0;if(state.status==='RUNNING'&&previousStart&&now-previousStart>RECON_DISPATCHER_STALL_MS&&(!state.lastFinishedAt||Date.parse(state.lastFinishedAt)<previousStart))state.interruptedRuns=Number(state.interruptedRuns||0)+1;
      var startedMs=Date.now();state.status='RUNNING';state.lastStartedAt=new Date(startedMs).toISOString();state.lastFinishedAt='';state.nextRunAt=new Date(startedMs+60000).toISOString();state.nextAction='CONTINUE_RECONCILIATION';state.attempts=Number(state.attempts||0)+1;dispatcherSave_(state);
      try{
        var result=continueReconciliation(),fresh=loadRecon_();state.lastFinishedAt=AKORT.Core.now();state.lastDurationMs=Date.now()-startedMs;state.lastResult=dispatcherResultSummary_(result);state.lastCheckpointCommitted=fresh&&fresh.updatedAt||state.lastCheckpointCommitted||'';if(!dispatcherRunActive_(state))return dispatcherStoppedDuringStep_(state);
        if(fresh&&(fresh.status==='SUCCESS'||fresh.status==='FAILED'))return fresh.status==='SUCCESS'?AKORT.Result.success('Alpha.6 reconciliation completed; dispatcher stopped.',dispatcherTerminalState_(state,fresh,'RECONCILIATION_'+fresh.status)):AKORT.Result.failure('PUBLISH_RECONCILIATION_FAILED','Alpha.6 reconciliation failed; dispatcher stopped.',dispatcherTerminalState_(state,fresh,'RECONCILIATION_'+fresh.status));
        if(!result||result.ok===false){var msg=(result&&result.message)||'Reconciliation step failed.';if(/Could not acquire script lock/i.test(msg)){state.skippedLockedRuns=Number(state.skippedLockedRuns||0)+1;state.status='SKIPPED_LOCKED';state.nextAction='RETRY_NEXT_TICK';state.lastError=null;dispatcherSave_(state);return AKORT.Result.success('Another reconciliation execution owns the script lock; this tick was skipped.',dispatcherPublic_(state));}state.consecutiveErrors=Number(state.consecutiveErrors||0)+1;state.lastError={code:(result&&result.code)||'STEP_FAILED',message:msg,at:AKORT.Core.now()};if(state.consecutiveErrors>=RECON_DISPATCHER_MAX_CONSECUTIVE_ERRORS)return AKORT.Result.failure('RECONCILIATION_DISPATCHER_STOPPED','Dispatcher stopped after repeated step failures.',dispatcherTerminalState_(state,fresh,'MAX_CONSECUTIVE_ERRORS'));state.status='RETRY_SCHEDULED';state.nextAction='RETRY_NEXT_TICK';dispatcherSave_(state);return AKORT.Result.failure('RECONCILIATION_STEP_FAILED','Step failed; persistent dispatcher will retry on the next tick.',dispatcherPublic_(state));}
        state.successfulSteps=Number(state.successfulSteps||0)+1;state.consecutiveErrors=0;state.lastError=null;state.status='SCHEDULED';state.nextAction='CONTINUE_RECONCILIATION';dispatcherSave_(state);return AKORT.Result.success('Reconciliation step completed; persistent dispatcher remains active.',dispatcherPublic_(state));
      }catch(error){state.lastFinishedAt=AKORT.Core.now();state.lastDurationMs=Date.now()-startedMs;if(!dispatcherRunActive_(state))return dispatcherStoppedDuringStep_(state);var message=String(error&&error.message||error);if(/Could not acquire script lock/i.test(message)){state.skippedLockedRuns=Number(state.skippedLockedRuns||0)+1;state.status='SKIPPED_LOCKED';state.nextAction='RETRY_NEXT_TICK';state.lastError=null;dispatcherSave_(state);return AKORT.Result.success('Another reconciliation execution owns the script lock; this tick was skipped.',dispatcherPublic_(state));}state.consecutiveErrors=Number(state.consecutiveErrors||0)+1;state.lastError={code:error&&error.code?String(error.code):'DISPATCHER_WORKER_ERROR',message:message,stack:error&&error.stack?String(error.stack).slice(0,2000):'',at:AKORT.Core.now()};if(state.consecutiveErrors>=RECON_DISPATCHER_MAX_CONSECUTIVE_ERRORS)return AKORT.Result.failure('RECONCILIATION_DISPATCHER_STOPPED','Dispatcher stopped after repeated worker errors.',dispatcherTerminalState_(state,loadRecon_(),'MAX_CONSECUTIVE_ERRORS'));state.status='RETRY_SCHEDULED';state.nextAction='RETRY_NEXT_TICK';dispatcherSave_(state);return AKORT.Result.failure('RECONCILIATION_DISPATCHER_WORKER_ERROR','Dispatcher worker failed; persistent dispatcher will retry on the next tick.',dispatcherPublic_(state));}
    }finally{try{workerLock.releaseLock();}catch(ignore){}}
  }
  function resetReconciliation(){return AKORT.Core.safeRun('PUBLISH_RECONCILIATION_RESET',function(){AKORT.EnvironmentGuard.assertDev();var control=dispatcherRequestStop_('RESET_REQUESTED'),removed=dispatcherDeleteTriggers_(),state=dispatcherLoad_()||{runId:control.runId||'',startedAt:'',attempts:0,successfulSteps:0,skippedLockedRuns:0,consecutiveErrors:0,interruptedRuns:0},scriptLock=LockService.getScriptLock();state.enabled=false;state.status='RESET_REQUESTED';state.nextRunAt='';state.nextAction='NONE';state.removedTriggersOnReset=removed;dispatcherSave_(state);if(!scriptLock.tryLock(1000))return AKORT.Result.failure('RECONCILIATION_RESET_BUSY','Dispatcher stop was recorded, but a reconciliation step is still in flight. Run reset again after the worker finishes.',{dispatcher:dispatcherPublic_(state),reconciliation:publicRecon_(loadRecon_())});try{var props=PropertiesService.getScriptProperties();props.deleteProperty(RECON_STATE_KEY);props.deleteProperty('AKORT_ALPHA6_RECONCILIATION_DISPATCHER_STATE_V1');props.deleteProperty('AKORT_ALPHA6_RECONCILIATION_DISPATCHER_STATE_V2');state.status='STOPPED_BY_RECONCILIATION_RESET';state.lastFinishedAt=AKORT.Core.now();dispatcherSave_(state);control=dispatcherControlLoad_()||control;control.enabled=false;control.status='STOPPED_BY_RECONCILIATION_RESET';control.stopReason='STOPPED_BY_RECONCILIATION_RESET';dispatcherControlSave_(control);return AKORT.Result.success('Alpha.6 reconciliation checkpoint cleared safely. Dispatcher stopped. Temporary reports were not deleted.',dispatcherPublic_(state));}finally{try{scriptLock.releaseLock();}catch(ignore){}}},{lock:false,persistLogs:true});}

  function statusSummary(){var ss=getDwh_(),tables={};Object.keys(TABLES).forEach(function(n){var sh=ss.getSheetByName(n);tables[n]=sh?{rows:Math.max(0,sh.getLastRow()-1),columns:sh.getLastColumn()}:null;});return{release:AKORT.Release.manifest(),manifestHash:AKORT.Core.manifestHash(),publishSchemaVersion:AKORT.Release.publishSchemaVersion,dependencySchemaVersion:AKORT.Release.dependencySchemaVersion,scopeCorrection:clone_(ALPHA6_SCOPE),runtimeSettings:runtimeSettings_(),serviceTables:tables,reconciliation:publicRecon_(loadRecon_()),dispatcher:dispatcherPublic_(dispatcherLoad_())};}

  return {Tables:clone_(TABLES),install:install,createPublishBackup:createPublishBackup,runtimeSettings:runtimeSettings_,planLoad:planLoad,planReversal:planReversal,planFromAffected:planFromAffected_,summarizePlan:summarizePlan_,appendImpact:appendImpact_,applyPublish:applyPublish,applyAggregates:applyAggregates,statusSummary:statusSummary,startReconciliation:startReconciliation,continueReconciliation:continueReconciliation,reconciliationStatus:reconciliationStatus,resetReconciliation:resetReconciliation,startReconciliationDispatcher:startReconciliationDispatcher,stopReconciliationDispatcher:stopReconciliationDispatcher,reconciliationDispatcherStatus:reconciliationDispatcherStatus,reconciliationDispatcherWorker:reconciliationDispatcherWorker,Test:{weeklyDependentPeriods:v310WeeklyDependentPeriods_,monthlyDependentPeriods:v310MonthlyDependentPeriods_,weeklyDynamics:v310CalculateWeeklyDynamics_,monthlyDynamics:v310CalculateMonthlyDynamics_,industryDynamics:v300CalculateIndustryDynamics_,setLatestPrices:v317SetLatestBySeriesRows_,setLatestAggregates:v317SetLatestAggregateRows_,expandAffected:v310ExpandAffectedTargets_,aggregateIndexTypes:v310AggregateIndexTypes_,frontierKey:v310AggregateFrontierKey_,seriesId:v300SeriesId_,aggregateSeriesKey:v317AggregateSeriesKey_,selectReplayLatest:v300SelectReplayLatest_,buildWeeklyRows:v310BuildWeeklyRowsForTargets_,buildMonthlyRows:v310BuildMonthlyRowsForTargets_,buildImpactRecords:buildImpactRecords_,jsonArrayChunks:jsonArrayChunks_,dispatcherControlMatches:dispatcherControlMatches_,dispatcherStateKey:dispatcherStateKey_}};
})();
