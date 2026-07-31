var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4.5 operator form for controlled RAW_INDUSTRY updates.
 *
 * The form is intentionally narrow:
 * - one durable row per active DIM_INDUSTRY_SERIES entry;
 * - the operator edits only period and value;
 * - blank rows are ignored, so indicators may arrive at different times;
 * - normalized rows enter RAW only through RAW_LOAD_V4;
 * - direct edits of RAW_INDUSTRY and PUBLISH_INDUSTRY are never used.
 */
AKORT.IndustryInput = (function () {
  var VERSION = '4.0-alpha74-industry-input-1';
  var RELEASE = '4.0.0-alpha.7.4.14';
  var INPUT_SHEET = 'INDUSTRY_INPUT';
  var LOG_SHEET = 'INDUSTRY_INPUT_LOG';
  var HEADER_ROW = 5;
  var DATA_START_ROW = 6;
  var LAST_OPERATION_PROPERTY = 'AKORT_ALPHA74_INDUSTRY_INPUT_LAST_OPERATION';
  var MAX_ROWS_PER_OPERATION = 100;

  var HEADERS = Object.freeze([
    'Показатель',
    'Разрез',
    'Единица',
    'Частота',
    'Формат периода',
    'Период',
    'Значение',
    'Статус',
    'Сообщение',
    'Последний период',
    'Последнее значение',
    'Источник',
    'series_id',
    'period_basis',
    'metric_type',
    'operation_id',
    'load_id',
    'row_fingerprint',
    'updated_at'
  ]);

  var LOG_HEADERS = Object.freeze([
    'log_id',
    'operation_id',
    'load_id',
    'submitted_at',
    'submitted_by',
    'series_id',
    'indicator_name',
    'period_label',
    'period_start',
    'period_end',
    'value',
    'commit_action',
    'status',
    'message',
    'release_version'
  ]);

  var DIM_HEADERS = Object.freeze([
    'series_id',
    'indicator_id',
    'indicator_name',
    'classification_1',
    'classification_2',
    'frequency',
    'period_basis',
    'metric_type',
    'unit',
    'source_name',
    'source_url',
    'sort_order',
    'is_active'
  ]);

  var RAW_HEADERS = Object.freeze([
    'observation_id',
    'series_id',
    'period_start',
    'period_end',
    'value',
    'version_no',
    'revision_type',
    'is_latest',
    'source_published_at',
    'loaded_at',
    'load_id'
  ]);

  var STATUS = Object.freeze({
    READY_INSERT: 'ГОТОВО: НОВЫЙ ПЕРИОД',
    READY_REVISION: 'ГОТОВО: ИСПРАВЛЕНИЕ',
    NO_CHANGES: 'БЕЗ ИЗМЕНЕНИЙ',
    PROCESSING: 'В ОБРАБОТКЕ',
    SUCCESS: 'ЗАГРУЖЕНО',
    ERROR: 'ОШИБКА',
    REVIEW: 'ТРЕБУЕТ ПРОВЕРКИ'
  });

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      String(value || '').toUpperCase() === 'TRUE';
  }

  function number_(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var normalized = String(value)
      .replace(/\u00a0/g, '')
      .replace(/\s/g, '')
      .replace(',', '.');
    if (!normalized || !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    var parsed = Number(normalized);
    return isFinite(parsed) ? parsed : null;
  }

  function dateOnly_(year, monthIndex, day) {
    return new Date(Number(year), Number(monthIndex), Number(day), 12, 0, 0, 0);
  }

  function validDate_(date) {
    return date && Object.prototype.toString.call(date) === '[object Date]' &&
      !isNaN(date.getTime());
  }

  function pad2_(value) {
    return ('0' + Number(value)).slice(-2);
  }

  function dateKey_(value) {
    if (!validDate_(value)) return '';
    return [value.getFullYear(), pad2_(value.getMonth() + 1), pad2_(value.getDate())].join('-');
  }

  function normalizedPeriodText_(value) {
    return text_(value)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/квартал/g, 'q')
      .replace(/кв\.?/g, 'q')
      .replace(/\s+/g, '');
  }

  function monthParts_(value) {
    if (validDate_(value)) {
      return { year: value.getFullYear(), month: value.getMonth() + 1 };
    }
    var normalized = normalizedPeriodText_(value);
    var match = normalized.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
    match = normalized.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (match) return { year: Number(match[2]), month: Number(match[1]) };
    return null;
  }

  function quarterParts_(value) {
    if (validDate_(value)) {
      return {
        year: value.getFullYear(),
        quarter: Math.floor(value.getMonth() / 3) + 1
      };
    }
    var normalized = normalizedPeriodText_(value);
    var match = normalized.match(/^(\d{4})[-/.]?q([1-4])$/);
    if (match) return { year: Number(match[1]), quarter: Number(match[2]) };
    match = normalized.match(/^q([1-4])[-/.]?(\d{4})$/);
    if (match) return { year: Number(match[2]), quarter: Number(match[1]) };
    match = normalized.match(/^([1-4])q[-/.]?(\d{4})$/);
    if (match) return { year: Number(match[2]), quarter: Number(match[1]) };
    return null;
  }

  function yearPart_(value) {
    if (validDate_(value)) return value.getFullYear();
    var normalized = normalizedPeriodText_(value);
    return /^\d{4}$/.test(normalized) ? Number(normalized) : null;
  }

  function assertYear_(year) {
    if (!year || year < 1900 || year > 2200) {
      throw error_('INDUSTRY_INPUT_PERIOD_INVALID', 'Год должен быть в диапазоне 1900–2200.', {
        year: year
      });
    }
  }

  function parsePeriod_(value, dimension) {
    dimension = dimension || {};
    var frequency = text_(dimension.frequency).toLowerCase();
    var basis = text_(dimension.period_basis).toLowerCase();
    var start;
    var end;
    var label;

    if (frequency === 'monthly') {
      var month = monthParts_(value);
      if (!month || month.month < 1 || month.month > 12) {
        throw error_('INDUSTRY_INPUT_PERIOD_INVALID', 'Для месячного показателя используйте формат ГГГГ-ММ, например 2026-06.', {
          value: text_(value),
          frequency: frequency
        });
      }
      assertYear_(month.year);
      start = basis === 'cumulative_ytd'
        ? dateOnly_(month.year, 0, 1)
        : dateOnly_(month.year, month.month - 1, 1);
      end = dateOnly_(month.year, month.month, 0);
      label = month.year + '-' + pad2_(month.month);
    } else if (frequency === 'quarterly') {
      var quarter = quarterParts_(value);
      if (!quarter) {
        throw error_('INDUSTRY_INPUT_PERIOD_INVALID', 'Для квартального показателя используйте формат ГГГГ-QN, например 2026-Q2.', {
          value: text_(value),
          frequency: frequency
        });
      }
      assertYear_(quarter.year);
      start = basis === 'cumulative_ytd'
        ? dateOnly_(quarter.year, 0, 1)
        : dateOnly_(quarter.year, (quarter.quarter - 1) * 3, 1);
      end = dateOnly_(quarter.year, quarter.quarter * 3, 0);
      label = quarter.year + '-Q' + quarter.quarter;
    } else if (frequency === 'annual') {
      var year = yearPart_(value);
      assertYear_(year);
      start = dateOnly_(year, 0, 1);
      end = dateOnly_(year, 11, 31);
      label = String(year);
    } else {
      throw error_('INDUSTRY_INPUT_FREQUENCY_UNSUPPORTED', 'Поддерживаются только monthly, quarterly и annual.', {
        frequency: frequency,
        seriesId: text_(dimension.series_id)
      });
    }

    return {
      frequency: frequency,
      periodBasis: basis,
      label: label,
      start: start,
      end: end,
      periodStart: dateKey_(start),
      periodEnd: dateKey_(end)
    };
  }

  function validateMetricValue_(value, dimension) {
    var parsed = number_(value);
    if (parsed === null) {
      throw error_('INDUSTRY_INPUT_VALUE_INVALID', 'Значение должно быть числом.', {
        value: text_(value),
        seriesId: text_(dimension && dimension.series_id)
      });
    }
    var metric = text_(dimension && dimension.metric_type).toLowerCase();
    if (metric === 'share_percent' && (parsed < 0 || parsed > 100)) {
      throw error_('INDUSTRY_INPUT_SHARE_OUT_OF_RANGE', 'Доля должна находиться в диапазоне от 0 до 100%.', {
        value: parsed,
        seriesId: text_(dimension && dimension.series_id)
      });
    }
    if ((/^level_/.test(metric) || /^index_.*_percent$/.test(metric)) && parsed < 0) {
      throw error_('INDUSTRY_INPUT_NEGATIVE_VALUE_FORBIDDEN', 'Для этого показателя отрицательное значение недопустимо.', {
        metricType: metric,
        value: parsed,
        seriesId: text_(dimension && dimension.series_id)
      });
    }
    return parsed;
  }

  function error_(code, message, details) {
    if (AKORT.Core && typeof AKORT.Core.error === 'function') {
      return AKORT.Core.error(code, message, details || {});
    }
    var error = new Error(message);
    error.code = code;
    error.details = details || {};
    return error;
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (ignored) { return 'unknown'; }
  }

  function now_() {
    return AKORT.Core && typeof AKORT.Core.now === 'function'
      ? AKORT.Core.now()
      : new Date().toISOString();
  }

  function hash_(value) {
    var serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return AKORT.Core.sha256(serialized);
  }

  function rowFingerprint_(row) {
    return hash_([
      text_(row.series_id),
      text_(row.period_start),
      text_(row.period_end),
      Number(row.value)
    ].join('|'));
  }

  function rawBusinessKey_(row) {
    return [
      text_(row.series_id),
      dateValueKey_(row.period_start),
      dateValueKey_(row.period_end)
    ].join('|');
  }

  function dateValueKey_(value) {
    if (validDate_(value)) return dateKey_(value);
    var text = text_(value);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
  }

  function classifyAction_(existing, value) {
    if (!existing) return 'INSERT';
    var previous = number_(existing.value);
    if (previous !== null && Math.abs(previous - Number(value)) <= 1e-9) return 'NOOP';
    return 'REVISION';
  }

  function periodHint_(dimension) {
    var frequency = text_(dimension.frequency).toLowerCase();
    if (frequency === 'monthly') return '2026-06';
    if (frequency === 'quarterly') return '2026-Q2';
    if (frequency === 'annual') return '2025';
    return '';
  }

  function frequencyLabel_(frequency) {
    var normalized = text_(frequency).toLowerCase();
    return {
      monthly: 'месяц',
      quarterly: 'квартал',
      annual: 'год'
    }[normalized] || normalized;
  }

  function dimensionLabel_(dimension) {
    return [text_(dimension.classification_1), text_(dimension.classification_2)]
      .filter(function (part) { return Boolean(part); })
      .join(' / ');
  }

  function inputIndex_() {
    var index = {};
    HEADERS.forEach(function (header, column) { index[header] = column; });
    return index;
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function assertHeaders_(sheet, rowNumber, expected, sheetName) {
    if (!sheet) {
      throw error_('INDUSTRY_INPUT_SHEET_MISSING', 'Отсутствует лист ' + sheetName + '.', {
        sheet: sheetName
      });
    }
    var actual = sheet.getRange(rowNumber, 1, 1, expected.length).getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw error_('INDUSTRY_INPUT_SCHEMA_MISMATCH', 'Изменена структура листа ' + sheetName + '.', {
        sheet: sheetName,
        expected: expected,
        actual: actual
      });
    }
    return sheet;
  }

  function readObjects_(sheet, headerRow, expected) {
    assertHeaders_(sheet, headerRow, expected, sheet.getName());
    var start = headerRow + 1;
    if (sheet.getLastRow() < start) return [];
    var values = sheet.getRange(start, 1, sheet.getLastRow() - headerRow, expected.length).getValues();
    return values.map(function (valuesRow, offset) {
      var object = { __row: start + offset };
      expected.forEach(function (header, column) { object[header] = valuesRow[column]; });
      return object;
    });
  }

  function readDimensions_() {
    var sheet = getDwh_().getSheetByName('DIM_INDUSTRY_SERIES');
    return readObjects_(sheet, 1, DIM_HEADERS).filter(function (row) {
      return text_(row.series_id) && truthy_(row.is_active);
    }).sort(function (a, b) {
      return Number(a.sort_order || 999) - Number(b.sort_order || 999) ||
        text_(a.series_id).localeCompare(text_(b.series_id));
    });
  }

  function dimensionMap_(dimensions) {
    var result = {};
    (dimensions || []).forEach(function (dimension) {
      result[text_(dimension.series_id)] = dimension;
    });
    return result;
  }

  function readLatestRaw_() {
    var sheet = getDwh_().getSheetByName('RAW_INDUSTRY');
    var byBusinessKey = {};
    var latestBySeries = {};
    readObjects_(sheet, 1, RAW_HEADERS).forEach(function (row) {
      if (!truthy_(row.is_latest)) return;
      var seriesId = text_(row.series_id);
      if (!seriesId) return;
      byBusinessKey[rawBusinessKey_(row)] = row;
      var previous = latestBySeries[seriesId];
      if (!previous || dateValueKey_(row.period_end) > dateValueKey_(previous.period_end)) {
        latestBySeries[seriesId] = row;
      }
    });
    return { byBusinessKey: byBusinessKey, latestBySeries: latestBySeries };
  }

  function ensureInputSheet_(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(INPUT_SHEET);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(INPUT_SHEET);
      if (sheet.getMaxColumns() < HEADERS.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
      }
      sheet.getRange(HEADER_ROW, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
    } else {
      assertHeaders_(sheet, HEADER_ROW, HEADERS, INPUT_SHEET);
    }
    return sheet;
  }

  function ensureLogSheet_(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(LOG_SHEET);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(LOG_SHEET);
      if (sheet.getMaxColumns() < LOG_HEADERS.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), LOG_HEADERS.length - sheet.getMaxColumns());
      }
      sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS.slice()]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, LOG_HEADERS.length)
        .setBackground('#0E766E')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold');
    } else {
      assertHeaders_(sheet, 1, LOG_HEADERS, LOG_SHEET);
    }
    return sheet;
  }

  function styleInputSheet_(sheet, rowCount) {
    sheet.getRange('A1').setValue('Форма загрузки отраслевых показателей');
    sheet.getRange('A2').setValue(
      'Заполняйте только жёлтые столбцы «Период» и «Значение». ' +
      'Пустые показатели пропускаются и могут быть загружены позже.'
    );
    sheet.getRange('A3').setValue('Последняя операция');
    sheet.getRange('B3').setValue(
      PropertiesService.getScriptProperties().getProperty(LAST_OPERATION_PROPERTY) || 'нет'
    );
    sheet.getRange(1, 1, 1, 12)
      .setBackground('#D9EDE9')
      .setFontColor('#0B4F48')
      .setFontWeight('bold')
      .setFontSize(14);
    sheet.getRange(2, 1, 1, 12)
      .setBackground('#F2F7F6')
      .setFontColor('#37474F')
      .setWrap(true);
    sheet.getRange(3, 1, 1, 12)
      .setBackground('#F2F7F6')
      .setFontColor('#37474F');
    sheet.getRange(HEADER_ROW, 1, 1, HEADERS.length)
      .setBackground('#0E766E')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setFrozenRows(HEADER_ROW);
    sheet.setFrozenColumns(2);
    sheet.setTabColor('#0E766E');

    if (rowCount > 0) {
      sheet.getRange(DATA_START_ROW, 1, rowCount, HEADERS.length)
        .setVerticalAlignment('middle')
        .setWrap(true);
      sheet.getRange(DATA_START_ROW, 6, rowCount, 2)
        .setBackground('#FFF2CC');
      sheet.getRange(DATA_START_ROW, 6, rowCount, 1)
        .setNumberFormat('@')
        .setNote('Месяц: 2026-06; квартал: 2026-Q2; год: 2025.');
      sheet.getRange(DATA_START_ROW, 7, rowCount, 1)
        .setNumberFormat('0.000000')
        .setNote('Вставьте только число. Допустимы точка или запятая.');
      sheet.getRange(DATA_START_ROW, 8, rowCount, 2)
        .setBackground('#F3F5F7');
      sheet.getRange(DATA_START_ROW, 10, rowCount, 2)
        .setBackground('#EAF4FB');
    }

    var widths = [240, 360, 120, 90, 110, 110, 120, 170, 340, 120, 140, 100];
    widths.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(13, HEADERS.length - 12);
    var filter = sheet.getFilter();
    if (filter) filter.remove();
    if (rowCount > 0) {
      sheet.getRange(HEADER_ROW, 1, rowCount + 1, 12).createFilter();
    }
  }

  function existingInputRows_(sheet) {
    if (!sheet || sheet.getLastRow() < DATA_START_ROW) return {};
    var result = {};
    readObjects_(sheet, HEADER_ROW, HEADERS).forEach(function (row) {
      var seriesId = text_(row.series_id);
      if (seriesId) result[seriesId] = row;
    });
    return result;
  }

  function periodLabelForRaw_(raw, dimension) {
    if (!raw) return '';
    var frequency = text_(dimension.frequency).toLowerCase();
    var end = dateValueKey_(raw.period_end);
    var start = dateValueKey_(raw.period_start);
    if (frequency === 'monthly') return start.slice(0, 7);
    if (frequency === 'quarterly') {
      var month = Number(end.slice(5, 7));
      return end.slice(0, 4) + '-Q' + Math.ceil(month / 3);
    }
    return start.slice(0, 4);
  }

  function syncRows_(sheet, dimensions, rawState) {
    var existing = existingInputRows_(sheet);
    var index = inputIndex_();
    var rows = dimensions.map(function (dimension) {
      var seriesId = text_(dimension.series_id);
      var previous = existing[seriesId] || {};
      var latest = rawState.latestBySeries[seriesId] || null;
      var row = new Array(HEADERS.length).fill('');
      row[index['Показатель']] = text_(dimension.indicator_name);
      row[index['Разрез']] = dimensionLabel_(dimension);
      row[index['Единица']] = text_(dimension.unit);
      row[index['Частота']] = frequencyLabel_(dimension.frequency);
      row[index['Формат периода']] = periodHint_(dimension);
      row[index['Период']] = previous['Период'] || '';
      row[index['Значение']] = previous['Значение'] === 0 ? 0 : previous['Значение'] || '';
      row[index['Статус']] = previous['Статус'] || '';
      row[index['Сообщение']] = previous['Сообщение'] || '';
      row[index['Последний период']] = periodLabelForRaw_(latest, dimension);
      row[index['Последнее значение']] = latest && latest.value !== undefined ? latest.value : '';
      row[index['Источник']] = text_(dimension.source_name);
      row[index['series_id']] = seriesId;
      row[index['period_basis']] = text_(dimension.period_basis);
      row[index['metric_type']] = text_(dimension.metric_type);
      row[index['operation_id']] = previous['operation_id'] || '';
      row[index['load_id']] = previous['load_id'] || '';
      row[index['row_fingerprint']] = previous['row_fingerprint'] || '';
      row[index['updated_at']] = previous['updated_at'] || '';
      return row;
    });

    var rowsToClear = Math.max(0, sheet.getLastRow() - HEADER_ROW);
    if (rowsToClear > 0) {
      sheet.getRange(DATA_START_ROW, 1, rowsToClear, HEADERS.length)
        .clearContent()
        .clearFormat()
        .clearNote();
    }
    if (rows.length) {
      if (sheet.getMaxRows() < DATA_START_ROW + rows.length - 1) {
        sheet.insertRowsAfter(sheet.getMaxRows(), DATA_START_ROW + rows.length - 1 - sheet.getMaxRows());
      }
      sheet.getRange(DATA_START_ROW, 1, rows.length, HEADERS.length).setValues(rows);
    }
    styleInputSheet_(sheet, rows.length);
    return rows.length;
  }

  function gate5State_() {
    if (!AKORT.Alpha74Gate5Acceptance ||
        typeof AKORT.Alpha74Gate5Acceptance.status !== 'function') return null;
    var result = AKORT.Alpha74Gate5Acceptance.status();
    return result && result.ok && result.data ? result.data.state || null : null;
  }

  function assertGate5NotRunning_() {
    var state = gate5State_();
    if (state && String(state.status) === 'RUNNING') {
      throw error_('INDUSTRY_INPUT_GATE5_RUNNING', 'Gate 5 ещё выполняется. Установка или изменение формы сейчас запрещены.', {
        executionId: state.executionId || '',
        phase: state.phase || '',
        fullStage: state.fullStage || ''
      });
    }
    return state;
  }

  function assertLiveSubmissionReady_() {
    var state = gate5State_();
    if (!state || String(state.status) !== 'SUCCESS') {
      throw error_('INDUSTRY_INPUT_GATE5_NOT_ACCEPTED', 'Загрузка RAW_INDUSTRY разрешается только после терминального SUCCESS Gate 5.', {
        gate5Status: state ? state.status : 'NOT_FOUND'
      });
    }
    var settings = AKORT.Config.readSystemSettings();
    if (!truthy_(settings.PUBLISH_ENGINE_ENABLED) ||
        !truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED) ||
        !truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)) {
      throw error_('INDUSTRY_INPUT_REGULAR_PIPELINE_DISABLED', 'Регулярный pipeline ещё не разрешён. Завершите Gate 6 и Gate 7 и включите оба aggregate feature flags.', {
        publishEngineEnabled: truthy_(settings.PUBLISH_ENGINE_ENABLED),
        aggregateExecutionEnabled: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
        regularPipelineEnabled: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)
      });
    }
  }

  function install() {
    return AKORT.Core.safeRun('INDUSTRY_INPUT_INSTALL', function () {
      AKORT.EnvironmentGuard.assertDev();
      var gate5 = assertGate5NotRunning_();
      var spreadsheet = getDwh_();
      var input = ensureInputSheet_(spreadsheet);
      ensureLogSheet_(spreadsheet);
      var dimensions = readDimensions_();
      var rows = syncRows_(input, dimensions, readLatestRaw_());
      return AKORT.Result.success('Форма RAW_INDUSTRY установлена и синхронизирована.', {
        release: RELEASE,
        version: VERSION,
        sheet: INPUT_SHEET,
        logSheet: LOG_SHEET,
        activeSeries: rows,
        gate5Status: gate5 ? gate5.status : 'NOT_FOUND',
        physicalWrites: false
      });
    }, { lock: true, persistLogs: true });
  }

  function normalizedCandidate_(inputRow, dimension, rawState, today) {
    var periodInput = inputRow['Период'];
    var valueInput = inputRow['Значение'];
    var hasPeriod = text_(periodInput) !== '';
    var hasValue = valueInput === 0 || text_(valueInput) !== '';
    if (!hasPeriod && !hasValue) return { empty: true };
    if (!hasPeriod || !hasValue) {
      throw error_('INDUSTRY_INPUT_ROW_INCOMPLETE', 'Заполните одновременно период и значение.', {
        row: inputRow.__row,
        seriesId: text_(inputRow.series_id)
      });
    }
    if (!dimension || !truthy_(dimension.is_active)) {
      throw error_('INDUSTRY_INPUT_SERIES_INACTIVE', 'Показатель отсутствует среди активных DIM_INDUSTRY_SERIES.', {
        row: inputRow.__row,
        seriesId: text_(inputRow.series_id)
      });
    }
    var period = parsePeriod_(periodInput, dimension);
    var value = validateMetricValue_(valueInput, dimension);
    var todayDate = validDate_(today) ? today : new Date();
    var todayOnly = dateOnly_(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    if (period.end.getTime() > todayOnly.getTime()) {
      throw error_('INDUSTRY_INPUT_FUTURE_PERIOD', 'Период ещё не завершён.', {
        row: inputRow.__row,
        period: period.label,
        periodEnd: period.periodEnd
      });
    }
    var normalized = {
      series_id: text_(dimension.series_id),
      period_start: period.periodStart,
      period_end: period.periodEnd,
      value: value,
      source_published_at: ''
    };
    var existing = rawState.byBusinessKey[rawBusinessKey_(normalized)] || null;
    var action = classifyAction_(existing, value);
    return {
      empty: false,
      rowNumber: inputRow.__row,
      dimension: dimension,
      period: period,
      value: value,
      normalized: normalized,
      fingerprint: rowFingerprint_(normalized),
      action: action,
      existing: existing
    };
  }

  function validationMessage_(candidate) {
    if (candidate.action === 'INSERT') {
      return 'Будет добавлен новый период ' + candidate.period.label + '.';
    }
    if (candidate.action === 'REVISION') {
      return 'Будет создана новая версия периода ' + candidate.period.label +
        '; предыдущее значение: ' + text_(candidate.existing && candidate.existing.value) + '.';
    }
    return 'В RAW уже записано такое же значение за ' + candidate.period.label + '.';
  }

  function validateInternal_(options) {
    options = options || {};
    var spreadsheet = getDwh_();
    var sheet = assertHeaders_(spreadsheet.getSheetByName(INPUT_SHEET), HEADER_ROW, HEADERS, INPUT_SHEET);
    var dimensions = readDimensions_();
    var dimensionsById = dimensionMap_(dimensions);
    var rawState = readLatestRaw_();
    var inputRows = readObjects_(sheet, HEADER_ROW, HEADERS);
    var index = inputIndex_();
    var statusValues = [];
    var messageValues = [];
    var fingerprintValues = [];
    var updatedValues = [];
    var entries = [];
    var errors = [];
    var counts = { empty: 0, insert: 0, revision: 0, noChanges: 0, processing: 0, error: 0 };

    inputRows.forEach(function (inputRow) {
      var existingStatus = text_(inputRow['Статус']);
      var operationId = text_(inputRow.operation_id);
      if (existingStatus === STATUS.PROCESSING && operationId) {
        counts.processing += 1;
        statusValues.push([existingStatus]);
        messageValues.push([inputRow['Сообщение'] || 'Операция ещё выполняется.']);
        fingerprintValues.push([inputRow.row_fingerprint || '']);
        updatedValues.push([inputRow.updated_at || '']);
        return;
      }
      try {
        var candidate = normalizedCandidate_(
          inputRow,
          dimensionsById[text_(inputRow.series_id)],
          rawState,
          options.today
        );
        if (candidate.empty) {
          counts.empty += 1;
          var preserveSuccess = existingStatus === STATUS.SUCCESS ||
            existingStatus === STATUS.NO_CHANGES;
          statusValues.push([preserveSuccess ? existingStatus : '']);
          messageValues.push([preserveSuccess ? inputRow['Сообщение'] || '' : '']);
          fingerprintValues.push(['']);
          updatedValues.push([inputRow.updated_at || '']);
          return;
        }
        entries.push(candidate);
        if (candidate.action === 'INSERT') counts.insert += 1;
        if (candidate.action === 'REVISION') counts.revision += 1;
        if (candidate.action === 'NOOP') counts.noChanges += 1;
        statusValues.push([
          candidate.action === 'INSERT' ? STATUS.READY_INSERT :
            candidate.action === 'REVISION' ? STATUS.READY_REVISION :
              STATUS.NO_CHANGES
        ]);
        messageValues.push([validationMessage_(candidate)]);
        fingerprintValues.push([candidate.fingerprint]);
        updatedValues.push([now_()]);
      } catch (caught) {
        counts.error += 1;
        errors.push({
          row: inputRow.__row,
          seriesId: text_(inputRow.series_id),
          code: caught.code || 'INDUSTRY_INPUT_VALIDATION_FAILED',
          message: caught.message || String(caught)
        });
        statusValues.push([STATUS.ERROR]);
        messageValues.push([caught.message || String(caught)]);
        fingerprintValues.push(['']);
        updatedValues.push([now_()]);
      }
    });

    if (inputRows.length) {
      sheet.getRange(DATA_START_ROW, index['Статус'] + 1, inputRows.length, 1).setValues(statusValues);
      sheet.getRange(DATA_START_ROW, index['Сообщение'] + 1, inputRows.length, 1).setValues(messageValues);
      sheet.getRange(DATA_START_ROW, index['row_fingerprint'] + 1, inputRows.length, 1).setValues(fingerprintValues);
      sheet.getRange(DATA_START_ROW, index['updated_at'] + 1, inputRows.length, 1).setValues(updatedValues);
    }
    return {
      sheet: sheet,
      entries: entries,
      errors: errors,
      counts: counts,
      physicalWrites: false
    };
  }

  function validate() {
    return AKORT.Core.safeRun('INDUSTRY_INPUT_VALIDATE', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertGate5NotRunning_();
      var validation = validateInternal_();
      if (validation.counts.processing) {
        return AKORT.Result.failure('INDUSTRY_INPUT_OPERATION_IN_PROGRESS', 'Сначала завершите предыдущую операцию через AKORT_alpha74IndustryInputContinue().', {
          counts: validation.counts,
          rawWrites: 0,
          publishWrites: 0
        });
      }
      if (validation.errors.length) {
        return AKORT.Result.failure('INDUSTRY_INPUT_VALIDATION_FAILED', 'В форме есть ошибки. RAW и Publish не изменены.', {
          counts: validation.counts,
          errors: validation.errors,
          physicalWrites: false
        });
      }
      return AKORT.Result.success('Форма RAW_INDUSTRY проверена. RAW и Publish не изменены.', {
        counts: validation.counts,
        readyRows: validation.entries.filter(function (entry) { return entry.action !== 'NOOP'; }).length,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: true });
  }

  function updateInputRows_(sheet, rowNumbers, valuesByHeader) {
    var index = inputIndex_();
    rowNumbers.forEach(function (rowNumber, itemIndex) {
      Object.keys(valuesByHeader).forEach(function (header) {
        var value = typeof valuesByHeader[header] === 'function'
          ? valuesByHeader[header](itemIndex, rowNumber)
          : valuesByHeader[header];
        sheet.getRange(rowNumber, index[header] + 1).setValue(value);
      });
    });
  }

  function appendLogRows_(rows) {
    if (!rows.length) return 0;
    var sheet = ensureLogSheet_(getDwh_());
    var existingIds = {};
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (row) {
        if (text_(row[0])) existingIds[text_(row[0])] = true;
      });
    }
    var unique = rows.filter(function (row) {
      return !existingIds[text_(row.log_id)];
    });
    if (!unique.length) return 0;
    var values = unique.map(function (row) {
      return LOG_HEADERS.map(function (header) {
        return row[header] === undefined || row[header] === null ? '' : row[header];
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, LOG_HEADERS.length).setValues(values);
    return values.length;
  }

  function commitActionsForLoad_(loadId) {
    var sheet = getDwh_().getSheetByName('RAW_STAGE');
    var result = {};
    if (!sheet || sheet.getLastRow() < 2) return result;
    AKORT.Core.Sheets.readObjects(sheet).forEach(function (row) {
      if (text_(row.load_id) !== text_(loadId) || text_(row.target_table) !== 'RAW_INDUSTRY') return;
      var payload = {};
      try { payload = JSON.parse(String(row.row_payload_json || '{}')); }
      catch (ignored) {}
      result[rawBusinessKey_(payload)] = text_(row.commit_action) || 'COMMITTED';
    });
    return result;
  }

  function clearNoOpRows_(sheet, entries) {
    if (!entries.length) return;
    var index = inputIndex_();
    entries.forEach(function (entry) {
      sheet.getRange(entry.rowNumber, index['Период'] + 1).clearContent();
      sheet.getRange(entry.rowNumber, index['Значение'] + 1).clearContent();
      sheet.getRange(entry.rowNumber, index['Статус'] + 1).setValue(STATUS.NO_CHANGES);
      sheet.getRange(entry.rowNumber, index['Сообщение'] + 1).setValue(validationMessage_(entry));
      sheet.getRange(entry.rowNumber, index['row_fingerprint'] + 1).clearContent();
      sheet.getRange(entry.rowNumber, index['updated_at'] + 1).setValue(now_());
    });
  }

  function operationPublic_(operationId) {
    var status = AKORT.OperationEngine.status(operationId);
    if (!status.ok) {
      throw error_(status.code || 'INDUSTRY_INPUT_OPERATION_STATUS_FAILED', status.message, status.details || {});
    }
    return status.data.operation;
  }

  function operationLoadId_(operation) {
    var checkpoint = operation && operation.checkpoint || {};
    return text_(
      checkpoint.rawStore && checkpoint.rawStore.loadId ||
      checkpoint.handlerState && checkpoint.handlerState.loadId ||
      ''
    );
  }

  function submittedRows_(operation) {
    var checkpoint = operation && operation.checkpoint || {};
    var rows = checkpoint.input && checkpoint.input.rows;
    return Array.isArray(rows) ? rows : [];
  }

  function finalizeSuccess_(operationId, operation) {
    var spreadsheet = getDwh_();
    var sheet = assertHeaders_(spreadsheet.getSheetByName(INPUT_SHEET), HEADER_ROW, HEADERS, INPUT_SHEET);
    var dimensions = dimensionMap_(readDimensions_());
    var inputRows = readObjects_(sheet, HEADER_ROW, HEADERS);
    var formBySeries = {};
    inputRows.forEach(function (row) {
      if (text_(row.operation_id) === operationId) formBySeries[text_(row.series_id)] = row;
    });
    var loadId = operationLoadId_(operation);
    var submittedAt = text_(operation.finished_at) || now_();
    var submittedBy = currentUser_();
    var rawState = readLatestRaw_();
    var commitActions = commitActionsForLoad_(loadId);
    var logRows = [];
    var cleared = 0;
    var preserved = 0;
    var index = inputIndex_();

    submittedRows_(operation).forEach(function (normalized) {
      var seriesId = text_(normalized.series_id);
      var form = formBySeries[seriesId];
      var dimension = dimensions[seriesId] || {};
      var fingerprint = rowFingerprint_(normalized);
      var period = parsePeriod_(
        text_(dimension.frequency).toLowerCase() === 'monthly'
          ? text_(normalized.period_start).slice(0, 7)
          : text_(dimension.frequency).toLowerCase() === 'quarterly'
            ? text_(normalized.period_end).slice(0, 4) + '-Q' +
              Math.ceil(Number(text_(normalized.period_end).slice(5, 7)) / 3)
            : text_(normalized.period_start).slice(0, 4),
        dimension
      );
      logRows.push({
        log_id: 'IILOG_' + hash_([operationId, seriesId, normalized.period_start, normalized.period_end].join('|')).slice(0, 24).toUpperCase(),
        operation_id: operationId,
        load_id: loadId,
        submitted_at: submittedAt,
        submitted_by: submittedBy,
        series_id: seriesId,
        indicator_name: text_(dimension.indicator_name),
        period_label: period.label,
        period_start: normalized.period_start,
        period_end: normalized.period_end,
        value: normalized.value,
        commit_action: commitActions[rawBusinessKey_(normalized)] || 'COMMITTED',
        status: 'SUCCESS',
        message: 'RAW_INDUSTRY и PUBLISH_INDUSTRY обновлены через RAW_LOAD_V4.',
        release_version: RELEASE
      });
      if (!form) return;
      var currentFingerprint = '';
      try {
        currentFingerprint = normalizedCandidate_(
          form,
          dimension,
          rawState,
          dateOnly_(2200, 0, 1)
        ).fingerprint;
      } catch (ignored) {}
      sheet.getRange(form.__row, index['Последний период'] + 1).setValue(period.label);
      sheet.getRange(form.__row, index['Последнее значение'] + 1).setValue(normalized.value);
      sheet.getRange(form.__row, index['load_id'] + 1).setValue(loadId);
      sheet.getRange(form.__row, index['updated_at'] + 1).setValue(submittedAt);
      if (text_(form.row_fingerprint) === fingerprint && currentFingerprint === fingerprint) {
        sheet.getRange(form.__row, index['Период'] + 1).clearContent();
        sheet.getRange(form.__row, index['Значение'] + 1).clearContent();
        sheet.getRange(form.__row, index['Статус'] + 1).setValue(STATUS.SUCCESS);
        sheet.getRange(form.__row, index['Сообщение'] + 1).setValue(
          'Период ' + period.label + ' загружен. Можно вводить следующий доступный период.'
        );
        sheet.getRange(form.__row, index['row_fingerprint'] + 1).clearContent();
        cleared += 1;
      } else {
        sheet.getRange(form.__row, index['Статус'] + 1).setValue(STATUS.REVIEW);
        sheet.getRange(form.__row, index['Сообщение'] + 1).setValue(
          'Операция завершена, но поля ввода менялись во время обработки. Новые значения сохранены и требуют повторной проверки.'
        );
        sheet.getRange(form.__row, index['operation_id'] + 1).clearContent();
        preserved += 1;
      }
    });
    var logged = appendLogRows_(logRows);
    return {
      operationId: operationId,
      loadId: loadId,
      loggedRows: logged,
      clearedRows: cleared,
      preservedChangedRows: preserved
    };
  }

  function finalizeOperation_(operationId) {
    var operation = operationPublic_(operationId);
    var state = text_(operation.status);
    var spreadsheet = getDwh_();
    var sheet = assertHeaders_(spreadsheet.getSheetByName(INPUT_SHEET), HEADER_ROW, HEADERS, INPUT_SHEET);
    var rows = readObjects_(sheet, HEADER_ROW, HEADERS).filter(function (row) {
      return text_(row.operation_id) === operationId;
    });
    var index = inputIndex_();

    if (state === 'SUCCESS') {
      return {
        terminal: true,
        status: state,
        result: finalizeSuccess_(operationId, operation),
        operation: operation
      };
    }
    if (['FAILED', 'FAILED_REQUIRES_REVIEW', 'DEAD_LETTER', 'CANCELLED'].indexOf(state) >= 0) {
      rows.forEach(function (row) {
        sheet.getRange(row.__row, index['Статус'] + 1).setValue(STATUS.ERROR);
        sheet.getRange(row.__row, index['Сообщение'] + 1).setValue(
          text_(operation.error_code) + ': ' + text_(operation.error_message)
        );
        sheet.getRange(row.__row, index['updated_at'] + 1).setValue(now_());
      });
      return { terminal: true, status: state, operation: operation };
    }
    rows.forEach(function (row) {
      sheet.getRange(row.__row, index['Статус'] + 1).setValue(STATUS.PROCESSING);
      sheet.getRange(row.__row, index['Сообщение'] + 1).setValue(
        'Операция ' + operationId + ': ' + state + ', фаза ' + text_(operation.current_phase) + '.'
      );
      sheet.getRange(row.__row, index['updated_at'] + 1).setValue(now_());
    });
    return { terminal: false, status: state, operation: operation };
  }

  function submit() {
    return AKORT.Core.safeRun('INDUSTRY_INPUT_SUBMIT', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertLiveSubmissionReady_();
      var validation = validateInternal_();
      if (validation.counts.processing) {
        return AKORT.Result.failure('INDUSTRY_INPUT_OPERATION_IN_PROGRESS', 'Сначала завершите предыдущую операцию через AKORT_alpha74IndustryInputContinue().', {
          counts: validation.counts,
          rawWrites: 0,
          publishWrites: 0
        });
      }
      if (validation.errors.length) {
        return AKORT.Result.failure('INDUSTRY_INPUT_VALIDATION_FAILED', 'Загрузка отменена: исправьте ошибки в форме.', {
          counts: validation.counts,
          errors: validation.errors,
          rawWrites: 0,
          publishWrites: 0
        });
      }

      var noOps = validation.entries.filter(function (entry) { return entry.action === 'NOOP'; });
      var ready = validation.entries.filter(function (entry) { return entry.action !== 'NOOP'; });
      clearNoOpRows_(validation.sheet, noOps);
      if (!ready.length) {
        return AKORT.Result.success('Новых значений для загрузки нет.', {
          noChangeRows: noOps.length,
          rawWrites: 0,
          publishWrites: 0
        });
      }
      if (ready.length > MAX_ROWS_PER_OPERATION) {
        throw error_('INDUSTRY_INPUT_BATCH_TOO_LARGE', 'Одна операция не может содержать больше ' + MAX_ROWS_PER_OPERATION + ' строк.', {
          readyRows: ready.length,
          maximum: MAX_ROWS_PER_OPERATION
        });
      }

      var rows = ready.map(function (entry) { return entry.normalized; });
      var contentHash = hash_(rows);
      var queued = AKORT.OperationEngine.enqueue('RAW_LOAD_V4', {
        targetTable: 'RAW_INDUSTRY',
        sourceId: 'INDUSTRY_INPUT_FORM',
        sourceName: 'AKORT Industry Operator Form',
        sourceHash: contentHash,
        rows: rows
      }, {
        idempotencyKey: 'INDUSTRY_INPUT_' + contentHash,
        priority: 60,
        maxAttempts: 3
      });
      if (!queued.ok) return queued;
      var operationId = queued.data.operationId;
      PropertiesService.getScriptProperties().setProperty(LAST_OPERATION_PROPERTY, operationId);
      validation.sheet.getRange('B3').setValue(operationId);
      updateInputRows_(validation.sheet, ready.map(function (entry) { return entry.rowNumber; }), {
        'Статус': STATUS.PROCESSING,
        'Сообщение': 'Операция ' + operationId + ' поставлена в очередь.',
        'operation_id': operationId,
        'load_id': '',
        'row_fingerprint': function (index) { return ready[index].fingerprint; },
        'updated_at': now_()
      });

      var run = AKORT.OperationEngine.run(operationId, {
        maxSteps: 50,
        executionBudgetMs: 260000,
        minRemainingMs: 15000
      });
      var finalization = finalizeOperation_(operationId);
      if (finalization.terminal && finalization.status === 'SUCCESS') {
        return AKORT.Result.success('Отраслевые показатели успешно загружены.', {
          operationId: operationId,
          loadId: finalization.result.loadId,
          submittedRows: ready.length,
          noChangeRows: noOps.length,
          operationStatus: finalization.status,
          finalization: finalization.result
        });
      }
      if (finalization.terminal) {
        return AKORT.Result.failure(
          text_(finalization.operation.error_code) || 'INDUSTRY_INPUT_OPERATION_FAILED',
          text_(finalization.operation.error_message) || 'Операция RAW_INDUSTRY завершилась ошибкой.',
          {
            operationId: operationId,
            operationStatus: finalization.status,
            submittedRows: ready.length,
            noChangeRows: noOps.length
          }
        );
      }
      return AKORT.Result.paused('Операция сохранена и может быть продолжена безопасно.', {
          operationId: operationId,
          submittedRows: ready.length,
          noChangeRows: noOps.length,
          operationStatus: finalization.status,
          runResult: run
      });
    }, { lock: false, persistLogs: true });
  }

  function continueLatest() {
    return AKORT.Core.safeRun('INDUSTRY_INPUT_CONTINUE', function () {
      AKORT.EnvironmentGuard.assertDev();
      assertLiveSubmissionReady_();
      var operationId = PropertiesService.getScriptProperties().getProperty(LAST_OPERATION_PROPERTY);
      if (!operationId) {
        throw error_('INDUSTRY_INPUT_OPERATION_NOT_FOUND', 'Нет сохранённой операции INDUSTRY_INPUT.', {});
      }
      var before = operationPublic_(operationId);
      if (text_(before.status) !== 'SUCCESS') {
        AKORT.OperationEngine.resume(operationId, {
          maxSteps: 50,
          executionBudgetMs: 260000,
          minRemainingMs: 15000
        });
      }
      var finalization = finalizeOperation_(operationId);
      if (finalization.terminal && finalization.status === 'SUCCESS') {
        return AKORT.Result.success('Операция RAW_INDUSTRY завершена.', finalization.result);
      }
      if (finalization.terminal) {
        return AKORT.Result.failure(
          text_(finalization.operation.error_code) || 'INDUSTRY_INPUT_OPERATION_FAILED',
          text_(finalization.operation.error_message) || 'Операция RAW_INDUSTRY завершилась ошибкой.',
          {
            operationId: operationId,
            operationStatus: finalization.status
          }
        );
      }
      return AKORT.Result.paused('Операция RAW_INDUSTRY ещё не завершена.', {
          operationId: operationId,
          operationStatus: finalization.status,
          phase: finalization.operation.current_phase
      });
    }, { lock: false, persistLogs: true });
  }

  function status() {
    return AKORT.Core.safeRun('INDUSTRY_INPUT_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var spreadsheet = getDwh_();
      var sheet = spreadsheet.getSheetByName(INPUT_SHEET);
      var installed = Boolean(sheet);
      var counts = {};
      var pendingRows = 0;
      if (installed) {
        readObjects_(sheet, HEADER_ROW, HEADERS).forEach(function (row) {
          var statusValue = text_(row['Статус']) || 'EMPTY';
          counts[statusValue] = Number(counts[statusValue] || 0) + 1;
          if (text_(row['Период']) || row['Значение'] === 0 || text_(row['Значение'])) pendingRows += 1;
        });
      }
      var operationId = PropertiesService.getScriptProperties().getProperty(LAST_OPERATION_PROPERTY) || '';
      var operation = null;
      if (operationId) {
        try { operation = operationPublic_(operationId); }
        catch (caught) {
          operation = { operation_id: operationId, status: 'STATUS_UNAVAILABLE', error: caught.message || String(caught) };
        }
      }
      var gate5 = gate5State_();
      return AKORT.Result.success('Статус формы RAW_INDUSTRY загружен.', {
        release: RELEASE,
        version: VERSION,
        installed: installed,
        sheet: INPUT_SHEET,
        logSheet: LOG_SHEET,
        pendingRows: pendingRows,
        statusCounts: counts,
        lastOperation: operation,
        gate5Status: gate5 ? gate5.status : 'NOT_FOUND',
        physicalWrites: false
      });
    }, { lock: false, persistLogs: false });
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    SheetName: INPUT_SHEET,
    LogSheetName: LOG_SHEET,
    Headers: HEADERS.slice(),
    LogHeaders: LOG_HEADERS.slice(),
    Statuses: STATUS,
    install: install,
    validate: validate,
    submit: submit,
    continueLatest: continueLatest,
    status: status,
    Test: Object.freeze({
      parsePeriod: parsePeriod_,
      parseNumber: number_,
      validateMetricValue: validateMetricValue_,
      classifyAction: classifyAction_,
      rowFingerprint: rowFingerprint_,
      rawBusinessKey: rawBusinessKey_,
      periodHint: periodHint_,
      normalizedCandidate: normalizedCandidate_
    })
  });
})();
