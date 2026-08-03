var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.5 parser layer for the twelve existing controlled source templates.
 * It converts a source workbook into normalized RAW rows, but never updates Publish.
 */
AKORT.ExistingSourceParsers = (function () {
  var TABLES = {
    SOURCE_PROFILE_REGISTRY: [
      'profile_id', 'profile_version', 'family_code', 'frequency', 'target_table',
      'dataset_code', 'source_file_type', 'value_type', 'parser_kind',
      'name_patterns_json', 'title_tokens_json', 'status', 'structural_signature',
      'description', 'updated_at', 'release_version'
    ],
    PARSER_STAGE: [
      'parse_row_id', 'operation_id', 'source_file_id', 'profile_id', 'target_table',
      'business_key', 'content_hash', 'row_payload_json', 'source_label',
      'source_row', 'source_column', 'parse_status', 'created_at', 'release_version'
    ],
    PARSER_ISSUES: [
      'issue_id', 'operation_id', 'source_file_id', 'profile_id', 'severity',
      'issue_code', 'source_label', 'source_row', 'source_column', 'details_json',
      'status', 'created_at', 'release_version'
    ]
  };

  var SETTINGS = {
    PARSER_SCHEMA_VERSION: {
      value: '4.0-parser-1', type: 'STRING',
      description: 'Existing Source Parsers contract version'
    },
    PARSER_PROFILE_MIN_SCORE: {
      value: 60, type: 'NUMBER',
      description: 'Minimum profile selection score'
    },
    PARSER_PROFILE_MIN_MARGIN: {
      value: 15, type: 'NUMBER',
      description: 'Minimum score margin between the best and second profile'
    },
    PARSER_FAIL_ON_UNMAPPED: {
      value: true, type: 'BOOLEAN',
      description: 'Block source loads when exact active mapping is absent'
    },
    PARSER_TEMP_CONVERSION_ENABLED: {
      value: true, type: 'BOOLEAN',
      description: 'Allow temporary XLSX to Google Sheets conversion in DEV'
    },
    PARSER_STAGE_BATCH_SIZE: {
      value: 500, type: 'NUMBER',
      description: 'Maximum parser-stage rows written per batch'
    }
  };

  var PROFILES = [
    profile_('AKORT_WEEKLY_W00', 'AKORT_WEEKLY_PRICE', 'weekly', 'RAW_PRICES_WEEKLY', 'AKORT_WEEKLY', 'AKORT_PRICE', '', 'AKORT_PRICE_LONG',
      ['^akort[_ -]?weekly', 'акорт.*недель'], ['еженедельн', 'акорт'], 'Weekly AKORT purchase and retail prices'),
    profile_('ROSSTAT_WEEKLY_RETAIL_PRICES', 'ROSSTAT_WEEKLY_RETAIL_PRICE', 'weekly', 'RAW_PRICES_WEEKLY', 'ROSSTAT_WEEKLY', 'AVG_PRICE', 'розница', 'WEEKLY_WIDE',
      ['rosstat[_ -]?weekly[_ -]?retail[_ -]?prices', 'росстат.*недель.*цен'], ['еженедельн', 'потребительск', 'цен'], 'Weekly Rosstat retail price levels'),
    profile_('ROSSTAT_WEEKLY_RETAIL_CPI', 'ROSSTAT_WEEKLY_CPI', 'weekly', 'RAW_PRICES_WEEKLY', 'ROSSTAT_WEEKLY', 'CPI_WEEKLY', 'ИПЦ', 'WEEKLY_WIDE',
      ['rosstat[_ -]?weekly[_ -]?retail[_ -]?cpi', 'ипц.*недель'], ['еженедельн', 'индекс', 'потребительск'], 'Weekly Rosstat CPI indices'),
    profile_('AKORT_MONTHLY_M00', 'AKORT_MONTHLY_PRICE', 'monthly', 'RAW_PRICES_MONTHLY', 'AKORT_MONTHLY', 'AKORT_PRICE', '', 'AKORT_PRICE_LONG',
      ['^akort[_ -]?monthly', 'акорт.*месяч'], ['ежемесячн', 'акорт'], 'Monthly AKORT purchase and retail prices'),
    profile_('ROSSTAT_MONTHLY_RETAIL_PRICES_M00', 'ROSSTAT_MONTHLY_RETAIL_PRICE', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'AVG_PRICE', 'розница', 'MONTHLY_RETAIL_WIDE',
      ['rosstat[_ -]?monthly[_ -]?retail[_ -]?prices', 'потребительск.*цен.*росстат'], ['ежемесячн', 'потребительск', 'цен'], 'Monthly Rosstat retail price levels'),
    profile_('ROSSTAT_MONTHLY_RETAIL_CPI_M00', 'ROSSTAT_CPI_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'CPI_MONTHLY', 'ИПЦ', 'MONTHLY_INDEX_LONG',
      ['rosstat[_ -]?monthly[_ -]?retail[_ -]?cpi', 'ипц.*месяч'], ['индекс', 'потребительск', 'цен'], 'Monthly Rosstat CPI indices'),
    profile_('ROSSTAT_MONTHLY_PURCHASE_INDEX_M00', 'ROSSTAT_PURCHASE_INDEX_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PURCHASE_INDEX', 'Индекс цен приобретения', 'MONTHLY_INDEX_LONG',
      ['rosstat[_ -]?monthly[_ -]?purchase[_ -]?index', 'индекс.*приобрет'], ['индекс', 'цен', 'приобрет'], 'Monthly retail purchase price indices'),
    profile_('ROSSTAT_MONTHLY_PURCHASE_PRICES_M00', 'ROSSTAT_PURCHASE_PRICE_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PURCHASE_INDEX', 'закупка', 'MONTHLY_PRICE_LONG',
      ['rosstat[_ -]?monthly[_ -]?purchase[_ -]?prices', 'средн.*цен.*приобрет'], ['средн', 'цен', 'приобрет'], 'Monthly retail purchase price levels'),
    profile_('ROSSTAT_MONTHLY_PPI_INDUSTRY_M00', 'ROSSTAT_PPI_INDUSTRIAL_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PPI_INDUSTRIAL', 'Индекс цен производителей', 'MONTHLY_INDEX_LONG',
      ['rosstat[_ -]?monthly[_ -]?ppi[_ -]?industry', 'индекс.*производител.*промышлен'], ['индекс', 'цен', 'производител', 'промышлен'], 'Monthly industrial producer price indices'),
    profile_('ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00', 'ROSSTAT_PPI_AGRI_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PPI_AGRI', 'Индекс цен производителей', 'MONTHLY_INDEX_LONG',
      ['rosstat[_ -]?monthly[_ -]?ppi[_ -]?agriculture', 'индекс.*производител.*сельск'], ['индекс', 'цен', 'производител', 'сельск'], 'Monthly agricultural producer price indices'),
    profile_('ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00', 'ROSSTAT_PRODUCER_PRICE_INDUSTRIAL_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PPI_INDUSTRIAL', 'производитель', 'MONTHLY_PRICE_LONG',
      ['rosstat[_ -]?monthly[_ -]?producer[_ -]?prices[_ -]?industry', 'цен.*производител.*промышлен'], ['средн', 'цен', 'производител', 'промышлен'], 'Monthly industrial producer price levels'),
    profile_('ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00', 'ROSSTAT_PRODUCER_PRICE_AGRI_MONTHLY', 'monthly', 'RAW_PRICES_MONTHLY', 'ROSSTAT_MONTHLY', 'PPI_AGRI', 'производитель', 'MONTHLY_PRICE_LONG',
      ['rosstat[_ -]?monthly[_ -]?producer[_ -]?prices[_ -]?agriculture', 'цен.*производител.*сельск'], ['средн', 'цен', 'производител', 'сельск'], 'Monthly agricultural producer price levels')
  ];

  var AKORT_PRODUCT_ALIASES = {
    'масло подсолнечное рафинированное дезодорированное без примесей и добавок': 'масло подсолнечное и его фракции рафинированные но не подвергнутые химической модификации',
    'молоко питьевое': 'молоко питьевое цельное пастеризованное 2 5 3 2%',
    'морковь': 'морковь столовая',
    'сахар песок категория тс 2': 'сахар песок',
    'свекла': 'свекла столовая',
    'тушка цыпленка бройлера': 'куры охлажденные и мороженые',
    'хлеб и булочные изделия из пшеничной муки': 'хлеб и булочные изделия из пшеничной муки различных сортов',
    'хлеб ржаной ржано пшеничный': 'хлеб из ржаной муки и из смеси муки ржаной и пшеничной',
    'яблоки сезонные': 'яблоки'
  };

  var OPERATION_TYPE = 'SOURCE_FILE_LOAD_V4';

  function profile_(id, family, frequency, target, dataset, sourceFileType, valueType, parserKind, names, tokens, description) {
    return {
      profileId: id,
      profileVersion: '1.0.0',
      familyCode: family,
      frequency: frequency,
      targetTable: target,
      datasetCode: dataset,
      sourceFileType: sourceFileType,
      valueType: valueType,
      parserKind: parserKind,
      namePatterns: names,
      titleTokens: tokens,
      status: 'ACTIVE',
      description: description
    };
  }

  function clone_(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }
  function text_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function truthy_(value) { return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE'; }
  function currentUser_() { try { return Session.getEffectiveUser().getEmail() || 'unknown'; } catch (e) { return 'unknown'; } }
  function id_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g, '').toUpperCase(); }

  function norm_(value) {
    return text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\u00a0/g, ' ')
      .replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  }

  function canonicalName_(value) {
    var stripped = stripUnit_(value).name;
    return norm_(stripped)
      .replace(/[«»"']/g, '')
      .replace(/\s*;\^\s*/g, ' ')
      .replace(/[^а-яa-z0-9%]+/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function stripUnit_(value) {
    var source = text_(value).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    var match = source.match(/^(.*?)[,\s]+(тыс\.?\s*шт|тысяча\s+штук|тыс\.?\s*м3|10\s*шт|т|кг|л|шт\.?)\.?$/i);
    return match ? { name: text_(match[1]), unit: text_(match[2]) } : { name: source, unit: '' };
  }

  function nameKeys_(value) {
    var full = norm_(value).replace(/[«»"']/g, '').replace(/[^а-яa-z0-9%]+/gi, ' ').replace(/\s+/g, ' ').trim();
    var stripped = canonicalName_(value);
    var result = [];
    [full, stripped].forEach(function (key) { if (key && result.indexOf(key) < 0) result.push(key); });
    return result;
  }

  function number_(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value === null || value === undefined || value === '') return null;
    var normalized = String(value).replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.').replace(/[−–—]/g, '-');
    if (!normalized || normalized === '-' || normalized === '…' || normalized === '...') return null;
    var parsed = Number(normalized);
    return isFinite(parsed) ? parsed : null;
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function table_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw AKORT.Core.error('PARSER_TABLE_MISSING', 'Missing parser table ' + name + '. Run AKORT_alpha5Install first.');
    var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(headers)) {
      throw AKORT.Core.error('PARSER_SCHEMA_MISMATCH', 'Unexpected schema for ' + name + '.', { expected: headers, actual: actual });
    }
    return { sheet: sheet, headers: actual };
  }

  function ensureTable_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    var created = false;
    if (!sheet) { sheet = spreadsheet.insertSheet(name); created = true; }
    var lastColumn = sheet.getLastColumn();
    var actual = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
    var blank = actual.length === 0 || actual.every(function (value) { return value === ''; });
    if (sheet.getLastRow() === 0 || blank) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    else if (JSON.stringify(actual.map(String)) !== JSON.stringify(headers)) {
      throw AKORT.Core.error('PARSER_SCHEMA_MISMATCH', 'Unexpected schema for ' + name + '.', { expected: headers, actual: actual });
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return { name: name, created: created, columns: headers.length };
  }

  function readObjects_(table) { return AKORT.Core.Sheets.readObjects(table.sheet); }
  function rowValues_(headers, object) { return headers.map(function (header) { var value = object[header]; return value === undefined || value === null ? '' : value; }); }
  function appendObject_(table, object) { AKORT.Core.Sheets.appendObject(table.sheet, table.headers, object); object.__row = table.sheet.getLastRow(); return object; }
  function saveObject_(table, object) { table.sheet.getRange(object.__row, 1, 1, table.headers.length).setValues([rowValues_(table.headers, object)]); return object; }
  function deleteRows_(sheet, rows) { rows.sort(function (a, b) { return b - a; }); rows.forEach(function (row) { sheet.deleteRow(row); }); return rows.length; }

  function runtimeSettings_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      schemaVersion: String(settings.PARSER_SCHEMA_VERSION || AKORT.Release.parserSchemaVersion),
      minScore: Number(settings.PARSER_PROFILE_MIN_SCORE || 60),
      minMargin: Number(settings.PARSER_PROFILE_MIN_MARGIN || 15),
      failOnUnmapped: settings.PARSER_FAIL_ON_UNMAPPED === undefined ? true : Boolean(settings.PARSER_FAIL_ON_UNMAPPED),
      tempConversionEnabled: settings.PARSER_TEMP_CONVERSION_ENABLED === undefined ? true : Boolean(settings.PARSER_TEMP_CONVERSION_ENABLED),
      stageBatchSize: Number(settings.PARSER_STAGE_BATCH_SIZE || 500)
    };
  }

  function upsertSettings_() {
    var spreadsheet = getDwh_();
    var settings = table_(spreadsheet, 'SYSTEM_SETTINGS', AKORT.Core.Tables.SYSTEM_SETTINGS);
    var rows = readObjects_(settings);
    var byKey = {};
    rows.forEach(function (row) { byKey[String(row.setting_key)] = row; });
    var actions = [];
    Object.keys(SETTINGS).forEach(function (key) {
      var definition = SETTINGS[key];
      var existing = byKey[key];
      if (!existing) {
        appendObject_(settings, {
          setting_key: key, setting_value: definition.value, value_type: definition.type,
          environment: 'DEV', is_secret: 0, is_active: 1, description: definition.description,
          updated_at: AKORT.Core.now(), updated_by: currentUser_()
        });
        actions.push({ setting: key, action: 'INSERTED' });
        return;
      }
      var update = String(existing.setting_value) !== String(definition.value) ||
        String(existing.value_type) !== String(definition.type) || !truthy_(existing.is_active);
      if (update) {
        existing.setting_value = definition.value;
        existing.value_type = definition.type;
        existing.environment = 'DEV';
        existing.is_secret = 0;
        existing.is_active = 1;
        existing.description = definition.description;
        existing.updated_at = AKORT.Core.now();
        existing.updated_by = currentUser_();
        saveObject_(settings, existing);
        actions.push({ setting: key, action: 'UPDATED' });
      } else actions.push({ setting: key, action: 'UNCHANGED' });
    });
    return actions;
  }

  function structuralSignature_(profile) {
    return AKORT.Core.sha256(AKORT.Core.canonicalJson({
      parserKind: profile.parserKind,
      targetTable: profile.targetTable,
      datasetCode: profile.datasetCode,
      sourceFileType: profile.sourceFileType,
      valueType: profile.valueType
    }));
  }

  function seedProfiles_() {
    var spreadsheet = getDwh_();
    var registry = table_(spreadsheet, 'SOURCE_PROFILE_REGISTRY', TABLES.SOURCE_PROFILE_REGISTRY);
    var existing = readObjects_(registry);
    var byId = {};
    existing.forEach(function (row) { byId[String(row.profile_id)] = row; });
    var actions = [];
    PROFILES.forEach(function (profile) {
      var row = {
        profile_id: profile.profileId,
        profile_version: profile.profileVersion,
        family_code: profile.familyCode,
        frequency: profile.frequency,
        target_table: profile.targetTable,
        dataset_code: profile.datasetCode,
        source_file_type: profile.sourceFileType,
        value_type: profile.valueType,
        parser_kind: profile.parserKind,
        name_patterns_json: AKORT.Core.safeJson(profile.namePatterns),
        title_tokens_json: AKORT.Core.safeJson(profile.titleTokens),
        status: profile.status,
        structural_signature: structuralSignature_(profile),
        description: profile.description,
        updated_at: AKORT.Core.now(),
        release_version: AKORT.Release.version
      };
      if (!byId[profile.profileId]) { appendObject_(registry, row); actions.push({ profileId: profile.profileId, action: 'INSERTED' }); }
      else {
        var current = byId[profile.profileId];
        var changed = TABLES.SOURCE_PROFILE_REGISTRY.some(function (header) {
          return header !== 'updated_at' && String(current[header] || '') !== String(row[header] || '');
        });
        if (changed) { row.__row = current.__row; saveObject_(registry, row); actions.push({ profileId: profile.profileId, action: 'UPDATED' }); }
        else actions.push({ profileId: profile.profileId, action: 'UNCHANGED' });
      }
    });
    return actions;
  }

  function install() {
    var rawResult = AKORT.RawStore.install();
    if (!rawResult.ok) return rawResult;
    return AKORT.Core.safeRun('SOURCE_PARSERS_INSTALL', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var spreadsheet = getDwh_();
      var tables = [];
      Object.keys(TABLES).forEach(function (name) { tables.push(ensureTable_(spreadsheet, name, TABLES[name])); });
      var settingActions = upsertSettings_();
      var profileActions = seedProfiles_();
      context.logger.info('Existing Source Parsers installed', {
        parserSchemaVersion: AKORT.Release.parserSchemaVersion,
        profiles: PROFILES.length,
        tables: tables
      }, { eventCode: 'SOURCE_PARSERS_INSTALLED' });
      return AKORT.Result.success('Existing Source Parsers installed successfully.', {
        release: AKORT.Release.manifest(),
        manifestHash: AKORT.Core.manifestHash(),
        coreRegistration: rawResult.data ? rawResult.data.coreRegistration : null,
        parserSchemaVersion: AKORT.Release.parserSchemaVersion,
        profiles: publicProfiles_(),
        serviceTables: tables,
        settingActions: settingActions,
        profileActions: profileActions,
        runtimeSettings: runtimeSettings_()
      });
    }, { lock: true, persistLogs: true });
  }

  function publicProfiles_() {
    return PROFILES.map(function (profile) {
      return {
        profileId: profile.profileId, familyCode: profile.familyCode, frequency: profile.frequency,
        targetTable: profile.targetTable, datasetCode: profile.datasetCode,
        sourceFileType: profile.sourceFileType, valueType: profile.valueType,
        parserKind: profile.parserKind, status: profile.status
      };
    });
  }

  function profileById_(profileId) {
    var profile = PROFILES.filter(function (item) { return item.profileId === String(profileId || ''); })[0];
    if (!profile) throw AKORT.Core.error('PARSER_PROFILE_NOT_FOUND', 'Parser profile was not found.', { profileId: profileId });
    return profile;
  }

  function dataSheet_(workbook) {
    var named = workbook.sheets.filter(function (sheet) { var name = norm_(sheet.name); return name === 'data' || name === 'данные'; })[0];
    return named || workbook.sheets[0];
  }

  function topText_(workbook) {
    var sheet = dataSheet_(workbook);
    var parts = [];
    for (var r = 0; r < Math.min(12, sheet.values.length); r += 1) {
      for (var c = 0; c < Math.min(30, sheet.values[r].length); c += 1) parts.push(norm_(sheet.values[r][c]));
    }
    return parts.join(' ');
  }

  function scoreProfile_(profile, fileName, workbook) {
    var name = norm_(fileName);
    var body = topText_(workbook);
    var score = 0;
    var evidence = [];
    profile.namePatterns.forEach(function (pattern) {
      if (new RegExp(pattern, 'i').test(name)) { score += 45; evidence.push('NAME:' + pattern); }
    });
    var tokensMatched = 0;
    profile.titleTokens.forEach(function (token) {
      if (body.indexOf(norm_(token)) >= 0) { score += 12; tokensMatched += 1; evidence.push('TITLE:' + token); }
    });
    if (tokensMatched === profile.titleTokens.length) score += 10;
    try { validateStructure_(profile, dataSheet_(workbook).values, { allowEmptyValues: true }); score += 25; evidence.push('STRUCTURE'); }
    catch (ignored) {}
    return { profileId: profile.profileId, score: score, evidence: evidence };
  }

  function detectProfile_(fileName, workbook, options) {
    options = options || {};
    if (options.profileId) {
      var explicit = profileById_(options.profileId);
      var explicitOptions = clone_(options) || {};
      explicitOptions.allowEmptyValues = true;
      validateStructure_(explicit, dataSheet_(workbook).values, explicitOptions);
      return { profile: explicit, score: 100, margin: 100, candidates: [{ profileId: explicit.profileId, score: 100, evidence: ['EXPLICIT'] }] };
    }
    var ranked = PROFILES.map(function (profile) { return scoreProfile_(profile, fileName, workbook); })
      .sort(function (a, b) { return b.score - a.score; });
    var runtime = runtimeSettings_();
    var best = ranked[0];
    var second = ranked[1] || { score: 0 };
    var margin = best.score - second.score;
    if (!best || best.score < runtime.minScore || margin < runtime.minMargin) {
      throw AKORT.Core.error('PROFILE_SELECTION_REQUIRED', 'Parser profile is ambiguous or below the confidence threshold.', {
        fileName: fileName, minScore: runtime.minScore, minMargin: runtime.minMargin,
        candidates: ranked.slice(0, 5)
      });
    }
    return { profile: profileById_(best.profileId), score: best.score, margin: margin, candidates: ranked.slice(0, 5) };
  }

  function metaInt_(values, key) {
    var target = norm_(key);
    for (var r = 0; r < Math.min(values.length, 10); r += 1) {
      for (var c = 0; c < Math.min((values[r] || []).length, 5); c += 1) {
        if (norm_(values[r][c]) === target) {
          var parsed = parseInt(String(values[r][c + 1]).replace(/\D/g, ''), 10);
          return isFinite(parsed) ? parsed : null;
        }
      }
    }
    return null;
  }

  function findHeader_(values, headerName) {
    var target = norm_(headerName);
    for (var r = 0; r < values.length; r += 1) {
      for (var c = 0; c < (values[r] || []).length; c += 1) if (norm_(values[r][c]) === target) return r;
    }
    return -1;
  }

  function headerIndex_(row) {
    var result = {};
    (row || []).forEach(function (header, index) {
      var key = norm_(header).replace(/[^a-zа-я0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (key) result[key] = index;
    });
    return result;
  }

  function validateStructure_(profile, values, options) {
    options = options || {};
    if (!values || !values.length) throw AKORT.Core.error('SOURCE_WORKBOOK_EMPTY', 'Source workbook is empty.');
    var year = metaInt_(values, 'YEAR');
    if (!year && !options.year) throw AKORT.Core.error('PERIOD_YEAR_REQUIRED', 'YEAR is required and cannot be inferred safely.', { profileId: profile.profileId });
    if (profile.frequency === 'monthly') {
      var month = metaInt_(values, 'MONTH');
      if (!month && !options.month) throw AKORT.Core.error('PERIOD_MONTH_REQUIRED', 'MONTH is required.', { profileId: profile.profileId });
    }
    var header = findHeader_(values, profile.parserKind === 'WEEKLY_WIDE' ? 'product_name / observation_date' : 'product_name');
    if (header < 0) throw AKORT.Core.error('SOURCE_HEADER_NOT_FOUND', 'Expected source header was not found.', { profileId: profile.profileId });
    var index = headerIndex_(values[header]);
    if (profile.parserKind === 'AKORT_PRICE_LONG' && (index.purchase_price === undefined || index.retail_price === undefined)) {
      throw AKORT.Core.error('SOURCE_SCHEMA_INVALID', 'AKORT template requires purchase_price and retail_price.', { profileId: profile.profileId });
    }
    if (profile.parserKind === 'MONTHLY_INDEX_LONG' && index.mom === undefined && index.december === undefined && index.yoy === undefined) {
      throw AKORT.Core.error('SOURCE_SCHEMA_INVALID', 'Monthly index template requires mom, december or yoy.', { profileId: profile.profileId });
    }
    if (profile.parserKind === 'MONTHLY_PRICE_LONG' && index.current_value === undefined) {
      throw AKORT.Core.error('SOURCE_SCHEMA_INVALID', 'Monthly price template requires current_value.', { profileId: profile.profileId });
    }
    if (profile.parserKind === 'MONTHLY_RETAIL_WIDE') {
      var currentRow = -1;
      for (var rr = header + 1; rr < values.length; rr += 1) if (norm_((values[rr] || [])[0]) === 'current_value') currentRow = rr;
      if (currentRow < 0) throw AKORT.Core.error('SOURCE_SCHEMA_INVALID', 'Monthly wide template requires current_value row.', { profileId: profile.profileId });
    }
    return { year: year || options.year, month: metaInt_(values, 'MONTH') || options.month, headerRow: header };
  }

  function isoWeekSunday_(year, week) {
    var fourth = new Date(Date.UTC(Number(year), 0, 4, 12));
    var day = fourth.getUTCDay() || 7;
    var monday = new Date(fourth.getTime());
    monday.setUTCDate(fourth.getUTCDate() - day + 1 + (Number(week) - 1) * 7);
    var sunday = new Date(monday.getTime());
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return sunday;
  }

  function monthDate_(year, month) { return new Date(Date.UTC(Number(year), Number(month) - 1, 1, 12)); }

  function russianDate_(value, year) {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return new Date(Date.UTC(year || value.getFullYear(), value.getMonth(), value.getDate(), 12));
    }
    var input = norm_(value).replace(/\*/g, '');
    var numeric = input.match(/(?:на\s+)?(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
    if (numeric) {
      var y = numeric[3] ? Number(numeric[3]) : Number(year);
      if (y < 100) y += 2000;
      return new Date(Date.UTC(y, Number(numeric[2]) - 1, Number(numeric[1]), 12));
    }
    var match = input.match(/(?:на\s+)?(\d{1,2})\s+([а-я]+)/i);
    if (!match || !year) return null;
    var months = { январь:1, января:1, февраль:2, февраля:2, март:3, марта:3, апрель:4, апреля:4, май:5, мая:5, июнь:6, июня:6, июль:7, июля:7, август:8, августа:8, сентябрь:9, сентября:9, октябрь:10, октября:10, ноябрь:11, ноября:11, декабрь:12, декабря:12 };
    var month = months[norm_(match[2])];
    return month ? new Date(Date.UTC(Number(year), month - 1, Number(match[1]), 12)) : null;
  }

  function parseSourceRows_(profile, values, options) {
    options = options || {};
    var structure = validateStructure_(profile, values, options);
    var header = structure.headerRow;
    var idx = headerIndex_(values[header]);
    var observations = [];
    var period;
    if (profile.frequency === 'monthly') period = monthDate_(structure.year, structure.month);

    if (profile.parserKind === 'AKORT_PRICE_LONG') {
      var akortPeriod = profile.frequency === 'weekly' ? isoWeekSunday_(structure.year, metaInt_(values, 'WEEK') || options.week) : period;
      if (profile.frequency === 'weekly' && !metaInt_(values, 'WEEK') && !options.week) throw AKORT.Core.error('PERIOD_WEEK_REQUIRED', 'WEEK is required.', { profileId: profile.profileId });
      for (var r = header + 1; r < values.length; r += 1) {
        var sourceName = text_((values[r] || [])[idx.product_name]);
        if (!sourceName) continue;
        var purchase = number_((values[r] || [])[idx.purchase_price]);
        var retail = number_((values[r] || [])[idx.retail_price]);
        if (purchase !== null) observations.push(sourceObs_(sourceName, '', 'закупка', '', akortPeriod, purchase, r + 1, idx.purchase_price + 1));
        if (retail !== null) observations.push(sourceObs_(sourceName, '', 'розница', '', akortPeriod, retail, r + 1, idx.retail_price + 1));
      }
    } else if (profile.parserKind === 'WEEKLY_WIDE') {
      var dates = [];
      for (var c = 1; c < values[header].length; c += 1) {
        var date = russianDate_(values[header][c], structure.year);
        if (date) dates.push({ column: c, date: date });
      }
      if (!dates.length) throw AKORT.Core.error('SOURCE_PERIOD_AXIS_NOT_FOUND', 'No weekly dates were found in the header.', { profileId: profile.profileId });
      for (var wr = header + 1; wr < values.length; wr += 1) {
        var weeklyName = text_((values[wr] || [])[0]);
        if (!weeklyName) continue;
        dates.forEach(function (item) {
          var weeklyValue = number_((values[wr] || [])[item.column]);
          if (weeklyValue !== null) observations.push(sourceObs_(weeklyName, '', profile.valueType, profile.familyCode === 'ROSSTAT_WEEKLY_CPI' ? 'wow' : '', item.date, weeklyValue, wr + 1, item.column + 1));
        });
      }
    } else if (profile.parserKind === 'MONTHLY_RETAIL_WIDE') {
      var valueRow = -1;
      for (var mr = header + 1; mr < values.length; mr += 1) if (norm_((values[mr] || [])[0]) === 'current_value') valueRow = mr;
      for (var mc = 1; mc < values[header].length; mc += 1) {
        var monthlyName = text_(values[header][mc]);
        var monthlyValue = number_((values[valueRow] || [])[mc]);
        if (monthlyName && monthlyValue !== null) observations.push(sourceObs_(monthlyName, '', profile.valueType, '', period, monthlyValue, valueRow + 1, mc + 1));
      }
    } else if (profile.parserKind === 'MONTHLY_INDEX_LONG') {
      var indexColumns = [{ type: 'mom', column: idx.mom }, { type: 'december', column: idx.december }, { type: 'yoy', column: idx.yoy }]
        .filter(function (item) { return item.column !== undefined; });
      for (var ir = header + 1; ir < values.length; ir += 1) {
        var indexName = text_((values[ir] || [])[idx.product_name]);
        if (!indexName) continue;
        indexColumns.forEach(function (item) {
          var indexValue = number_((values[ir] || [])[item.column]);
          if (indexValue !== null) observations.push(sourceObs_(indexName, stripUnit_(indexName).unit, profile.valueType, item.type, period, indexValue, ir + 1, item.column + 1));
        });
      }
    } else if (profile.parserKind === 'MONTHLY_PRICE_LONG') {
      for (var pr = header + 1; pr < values.length; pr += 1) {
        var priceName = text_((values[pr] || [])[idx.product_name]);
        if (!priceName) continue;
        var priceValue = number_((values[pr] || [])[idx.current_value]);
        if (priceValue === null) continue;
        var sourceUnit = idx.unit === undefined ? stripUnit_(priceName).unit : text_((values[pr] || [])[idx.unit]);
        observations.push(sourceObs_(priceName, sourceUnit, profile.valueType, '', period, priceValue, pr + 1, idx.current_value + 1));
      }
    }
    if (!observations.length && !options.allowEmptyValues) throw AKORT.Core.error('PARSER_ZERO_ROWS', 'Parser found no numeric observations.', { profileId: profile.profileId });
    return { observations: observations, structure: structure };
  }

  function sourceObs_(name, unit, valueType, indexType, period, value, row, column) {
    return { sourceName: name, sourceUnit: unit, valueType: valueType, indexType: indexType || '', period: period, value: Number(value), sourceRow: row, sourceColumn: column };
  }

  function readReferenceData_() {
    var dwh = getDwh_();
    var productsSheet = dwh.getSheetByName('DIM_PRODUCTS');
    var mappingsSheet = dwh.getSheetByName('DIM_PRODUCT_MAPPING');
    if (!productsSheet || !mappingsSheet) throw AKORT.Core.error('PARSER_REFERENCE_MISSING', 'DIM_PRODUCTS or DIM_PRODUCT_MAPPING is missing.');
    return { products: AKORT.Core.Sheets.readObjects(productsSheet), mappings: AKORT.Core.Sheets.readObjects(mappingsSheet) };
  }

  function productIndex_(products) {
    var byId = {}, byName = {};
    products.forEach(function (product) {
      if (!truthy_(product.is_active)) return;
      byId[String(product.category_id)] = product;
      nameKeys_(product.product_name).forEach(function (key) { if (key) byName[key] = product; });
    });
    return { byId: byId, byName: byName };
  }

  function mappingIndex_(profile, mappings, period) {
    var result = {};
    mappings.forEach(function (mapping) {
      if (!truthy_(mapping.is_active)) return;
      if (String(mapping.dataset_code || '') !== profile.datasetCode) return;
      if (String(mapping.source_file_type || '') !== profile.sourceFileType) return;
      if (isIndexValueType_(profile.valueType) && norm_(mapping.value_type) !== norm_(profile.valueType)) return;
      if (mapping.valid_from && new Date(mapping.valid_from).getTime() > period.getTime()) return;
      if (mapping.valid_to && new Date(mapping.valid_to).getTime() < period.getTime()) return;
      nameKeys_(mapping.source_product_name).forEach(function (key) {
        if (!result[key]) result[key] = [];
        result[key].push(mapping);
      });
    });
    return result;
  }

  function isIndexValueType_(valueType) {
    var value = norm_(valueType);
    return value.indexOf('индекс') >= 0 || value === 'ипц';
  }

  function exactMappings_(index, sourceName) {
    var found = [];
    nameKeys_(sourceName).some(function (key) {
      if (index[key]) { found = index[key].slice(); return true; }
      return false;
    });
    var unique = {}, result = [];
    found.forEach(function (mapping) {
      var id = String(mapping.category_id);
      if (!unique[id]) { unique[id] = true; result.push(mapping); }
    });
    return result;
  }

  function unitKey_(unit) {
    var value = norm_(unit).replace(/\s+/g, ' ').replace(/[.,;:]+$/g, '').trim();
    if (!value) return '';
    if (value === 'кг' || value === 'килограмм') return 'kg';
    if (value === 'л' || value === 'литр') return 'liter';
    if (value === 'т' || value === 'тонна' || value.indexOf('метрическая тонна') >= 0 || value.indexOf('1000 кг') >= 0) return 'tonne';
    if (value === 'тыс шт' || value === 'тыс. шт' || value === 'тысяча штук' || value === 'тыс штук') return 'thousand_pieces';
    if (value === '10 шт' || value === '10 штук') return 'ten_pieces';
    if (value === 'шт' || value === 'штук' || value === 'ед') return 'piece';
    if (value === 'тыс м3' || value === 'тыс. м3' || value.indexOf('тысяча кубических метров') >= 0) return 'thousand_m3';
    if (value === 'м3' || value.indexOf('кубический метр') >= 0) return 'm3';
    if (value.indexOf('плотный кубический метр') >= 0) return 'm3';
    return '';
  }

  function convertUnit_(value, sourceUnit, targetUnit) {
    var source = unitKey_(sourceUnit), target = unitKey_(targetUnit);
    if (!source || !target) return { error: 'UNIT_NOT_RECOGNIZED', sourceUnit: sourceUnit, targetUnit: targetUnit };
    if (source === target) return { value: Number(value) };
    if (source === 'tonne' && target === 'kg') return { value: Number(value) / 1000 };
    if (source === 'thousand_pieces' && target === 'ten_pieces') return { value: Number(value) / 100 };
    if (source === 'thousand_m3' && target === 'm3') return { value: Number(value) / 1000 };
    return { error: 'UNIT_CONVERSION_NOT_SUPPORTED', sourceUnit: sourceUnit, targetUnit: targetUnit };
  }

  function issue_(severity, code, observation, details) {
    return {
      severity: severity, issueCode: code, sourceLabel: observation ? observation.sourceName : '',
      sourceRow: observation ? observation.sourceRow : '', sourceColumn: observation ? observation.sourceColumn : '',
      details: details || {}
    };
  }

  function mapObservations_(profile, parsed, reference, options) {
    options = options || {};
    var products = productIndex_(reference.products || []);
    var mappings = mappingIndex_(profile, reference.mappings || [], parsed.observations.length ? parsed.observations[0].period : new Date());
    var buckets = {}, issues = [];
    parsed.observations.forEach(function (observation) {
      var targets = [];
      if (profile.datasetCode.indexOf('AKORT_') === 0) {
        nameKeys_(observation.sourceName).some(function (key) {
          if (products.byName[key]) { targets = [{ category_id: products.byName[key].category_id }]; return true; }
          return false;
        });
        if (!targets.length) {
          var alias = AKORT_PRODUCT_ALIASES[canonicalName_(observation.sourceName)];
          if (alias) {
            nameKeys_(alias).some(function (key) {
              if (products.byName[key]) { targets = [{ category_id: products.byName[key].category_id }]; return true; }
              return false;
            });
          }
        }
      } else targets = exactMappings_(mappings, observation.sourceName);
      if (!targets.length) {
        issues.push(issue_('ERROR', 'MAPPING_REQUIRED', observation, {
          datasetCode: profile.datasetCode, sourceFileType: profile.sourceFileType, valueType: observation.valueType
        }));
        return;
      }
      targets.forEach(function (mapping) {
        var product = products.byId[String(mapping.category_id)];
        if (!product) { issues.push(issue_('ERROR', 'TARGET_CATEGORY_MISSING', observation, { categoryId: mapping.category_id })); return; }
        var converted = { value: observation.value };
        if (!isIndexValueType_(observation.valueType)) {
          var sourceUnit = observation.sourceUnit || stripUnit_(observation.sourceName).unit || product.unit;
          converted = convertUnit_(observation.value, sourceUnit, product.unit);
          if (converted.error) { issues.push(issue_('ERROR', converted.error, observation, { sourceUnit: sourceUnit, targetUnit: product.unit, categoryId: product.category_id })); return; }
        }
        var row = profile.frequency === 'weekly' ? {
          dataset_code: profile.datasetCode, category_id: product.category_id,
          value_type: observation.valueType, index_type: observation.indexType || '',
          observation_date: observation.period, value: converted.value,
          source_published_at: options.sourcePublishedAt || ''
        } : {
          dataset_code: profile.datasetCode, category_id: product.category_id,
          value_type: observation.valueType, index_type: observation.indexType || '',
          observation_month: observation.period, value: converted.value,
          source_published_at: options.sourcePublishedAt || ''
        };
        row = AKORT.RawStore.normalizeRow(profile.targetTable, row);
        var key = AKORT.RawStore.businessKey(profile.targetTable, row);
        if (!buckets[key]) buckets[key] = { row: row, values: [], labels: [], sourceRow: observation.sourceRow, sourceColumn: observation.sourceColumn };
        buckets[key].values.push(Number(converted.value));
        buckets[key].labels.push(observation.sourceName);
      });
    });
    var rows = [];
    Object.keys(buckets).forEach(function (key) {
      var bucket = buckets[key];
      bucket.row.value = bucket.values.reduce(function (sum, value) { return sum + value; }, 0) / bucket.values.length;
      rows.push({ row: bucket.row, sourceLabel: bucket.labels.join(' | '), sourceRow: bucket.sourceRow, sourceColumn: bucket.sourceColumn });
      if (bucket.values.length > 1) issues.push(issue_('WARNING', 'MULTIPLE_SOURCE_VALUES_AGGREGATED', {
        sourceName: bucket.labels.join(' | '), sourceRow: bucket.sourceRow, sourceColumn: bucket.sourceColumn
      }, { businessKey: key, count: bucket.values.length, aggregation: 'AVERAGE' }));
    });
    return { rows: rows, issues: issues };
  }

  function parseMatrix(profileId, values, options) {
    options = options || {};
    var profile = profileById_(profileId);
    var parsed = parseSourceRows_(profile, values, options);
    var reference = options.referenceData || readReferenceData_();
    var mapped = mapObservations_(profile, parsed, reference, options);
    return {
      profile: clone_(profile),
      targetTable: profile.targetTable,
      rows: mapped.rows,
      issues: mapped.issues,
      sourceObservationCount: parsed.observations.length,
      normalizedRowCount: mapped.rows.length,
      structure: parsed.structure
    };
  }

  function bytesHash_(bytes) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
    return digest.map(function (value) { var normalized = value < 0 ? value + 256 : value; return ('0' + normalized.toString(16)).slice(-2); }).join('');
  }

  function openWorkbook_(fileId) {
    var file = DriveApp.getFileById(fileId);
    var mime = file.getMimeType();
    var temporaryId = '';
    var spreadsheet;
    if (mime === MimeType.GOOGLE_SHEETS || mime === 'application/vnd.google-apps.spreadsheet') spreadsheet = SpreadsheetApp.openById(fileId);
    else {
      var runtime = runtimeSettings_();
      if (!runtime.tempConversionEnabled) throw AKORT.Core.error('TEMP_CONVERSION_DISABLED', 'Temporary Excel conversion is disabled.', { fileId: fileId, mimeType: mime });
      var config = AKORT.Config.load({ includeSystemSettings: false });
      if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.copy) {
        throw AKORT.Core.error('DRIVE_ADVANCED_SERVICE_REQUIRED', 'Drive advanced service is required to parse Excel files.');
      }
      var resource = {
        title: 'TMP_ALPHA5_' + file.getName(),
        mimeType: MimeType.GOOGLE_SHEETS,
        parents: [{ id: config.resources.testFilesFolderId }]
      };
      var converted = Drive.Files.copy(resource, fileId, { convert: true });
      temporaryId = converted.id;
      spreadsheet = SpreadsheetApp.openById(temporaryId);
    }
    return { file: file, spreadsheet: spreadsheet, temporaryId: temporaryId };
  }

  function readWorkbook_(fileId) {
    var opened = openWorkbook_(fileId);
    try {
      var sheets = opened.spreadsheet.getSheets().map(function (sheet) {
        return { name: sheet.getName(), values: sheet.getDataRange().getValues() };
      });
      var workbook = { fileId: fileId, fileName: opened.file.getName(), mimeType: opened.file.getMimeType(), sheets: sheets };
      workbook.sourceHash = opened.temporaryId ? bytesHash_(opened.file.getBlob().getBytes()) : AKORT.Core.sha256(AKORT.Core.canonicalJson({ sheets: sheets }));
      workbook.structuralFingerprint = AKORT.Core.sha256(AKORT.Core.canonicalJson(sheets.map(function (sheet) {
        return { name: sheet.name, rows: sheet.values.length, columns: sheet.values.reduce(function (max, row) { return Math.max(max, row.length); }, 0), top: sheet.values.slice(0, 10).map(function (row) { return row.slice(0, 20); }) };
      })));
      return workbook;
    } finally {
      if (opened.temporaryId) {
        try { DriveApp.getFileById(opened.temporaryId).setTrashed(true); } catch (ignored) {}
      }
    }
  }

  function inferYear_(fileName, values) {
    var meta = metaInt_(values, 'YEAR');
    if (meta && meta >= 1900 && meta <= 2200) return meta;
    var nameMatch = String(fileName || '').match(/(?:19|20)\d{2}/);
    if (nameMatch) return Number(nameMatch[0]);
    for (var r = 0; r < Math.min(values.length, 20); r += 1) {
      for (var c = 0; c < Math.min((values[r] || []).length, 30); c += 1) {
        var value = values[r][c];
        if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.getFullYear();
        var match = String(value || '').match(/(?:19|20)\d{2}/);
        if (match) return Number(match[0]);
      }
    }
    return null;
  }

  function resolveOptions_(workbook, options) {
    var resolved = clone_(options || {}) || {};
    var values = dataSheet_(workbook).values;
    if (!resolved.year) resolved.year = inferYear_(workbook.fileName, values) || '';
    if (!resolved.week) {
      var weekMatch = String(workbook.fileName || '').match(/(?:^|[-_\s])W(?:EEK)?[-_\s]*0?(\d{1,2})(?:\D|$)/i);
      if (weekMatch) resolved.week = Number(weekMatch[1]);
    }
    if (!resolved.month) {
      var monthMatch = String(workbook.fileName || '').match(/(?:^|[-_\s])M[-_\s]*0?(\d{1,2})(?:\D|$)/i);
      if (monthMatch && Number(monthMatch[1]) >= 1 && Number(monthMatch[1]) <= 12) resolved.month = Number(monthMatch[1]);
    }
    return resolved;
  }

  function inspectFile(fileId, options) {
    var workbook = readWorkbook_(fileId);
    var resolved = resolveOptions_(workbook, options || {});
    var detected = detectProfile_(workbook.fileName, workbook, resolved);
    var structure = validateStructure_(detected.profile, dataSheet_(workbook).values, resolved);
    return {
      fileId: fileId,
      fileName: workbook.fileName,
      mimeType: workbook.mimeType,
      sourceHash: workbook.sourceHash,
      structuralFingerprint: workbook.structuralFingerprint,
      profile: publicProfile_(detected.profile),
      confidence: { score: detected.score, margin: detected.margin, candidates: detected.candidates },
      resolvedOptions: resolved,
      structure: structure
    };
  }

  function previewFile(fileId, options) {
    options = options || {};
    var workbook = readWorkbook_(fileId);
    var resolved = resolveOptions_(workbook, options);
    var detected = detectProfile_(workbook.fileName, workbook, resolved);
    var parsed = parseMatrix(detected.profile.profileId, dataSheet_(workbook).values, resolved);
    return AKORT.Result.success('Source file preview completed.', {
      fileId: fileId, fileName: workbook.fileName, sourceHash: workbook.sourceHash,
      structuralFingerprint: workbook.structuralFingerprint,
      profile: publicProfile_(detected.profile), confidence: { score: detected.score, margin: detected.margin, candidates: detected.candidates },
      resolvedOptions: resolved,
      sourceObservationCount: parsed.sourceObservationCount, normalizedRowCount: parsed.normalizedRowCount,
      issues: parsed.issues, sampleRows: parsed.rows.slice(0, 10).map(function (item) { return item.row; })
    });
  }

  function publicProfile_(profile) {
    return { profileId: profile.profileId, familyCode: profile.familyCode, frequency: profile.frequency, targetTable: profile.targetTable, datasetCode: profile.datasetCode, sourceFileType: profile.sourceFileType, valueType: profile.valueType, parserKind: profile.parserKind };
  }

  function clearOperationStage_(operationId) {
    var dwh = getDwh_();
    var stage = table_(dwh, 'PARSER_STAGE', TABLES.PARSER_STAGE);
    var issues = table_(dwh, 'PARSER_ISSUES', TABLES.PARSER_ISSUES);
    var stageRows = readObjects_(stage).filter(function (row) { return String(row.operation_id) === String(operationId); }).map(function (row) { return row.__row; });
    var issueRows = readObjects_(issues).filter(function (row) { return String(row.operation_id) === String(operationId); }).map(function (row) { return row.__row; });
    return { stageRows: deleteRows_(stage.sheet, stageRows), issueRows: deleteRows_(issues.sheet, issueRows) };
  }

  function writeIssues_(operationId, sourceFileId, profileId, issues) {
    if (!issues.length) return 0;
    var dwh = getDwh_();
    var table = table_(dwh, 'PARSER_ISSUES', TABLES.PARSER_ISSUES);
    var rows = issues.map(function (issue) {
      return [id_('PIS'), operationId, sourceFileId, profileId, issue.severity, issue.issueCode,
        issue.sourceLabel || '', issue.sourceRow || '', issue.sourceColumn || '', AKORT.Core.safeJson(issue.details || {}),
        'OPEN', AKORT.Core.now(), AKORT.Release.version];
    });
    table.sheet.getRange(table.sheet.getLastRow() + 1, 1, rows.length, TABLES.PARSER_ISSUES.length).setValues(rows);
    return rows.length;
  }

  function writeStage_(operationId, sourceFileId, profile, parsed) {
    var dwh = getDwh_();
    var stage = table_(dwh, 'PARSER_STAGE', TABLES.PARSER_STAGE);
    var batchSize = runtimeSettings_().stageBatchSize;
    var rows = parsed.rows.map(function (item) {
      var businessKey = AKORT.RawStore.businessKey(profile.targetTable, item.row);
      var contentHash = AKORT.RawStore.contentHash(profile.targetTable, item.row);
      return [id_('PRS'), operationId, sourceFileId, profile.profileId, profile.targetTable,
        businessKey, contentHash, AKORT.Core.safeJson(item.row), item.sourceLabel || '',
        item.sourceRow || '', item.sourceColumn || '', 'PARSED', AKORT.Core.now(), AKORT.Release.version];
    });
    for (var offset = 0; offset < rows.length; offset += batchSize) {
      var batch = rows.slice(offset, offset + batchSize);
      stage.sheet.getRange(stage.sheet.getLastRow() + 1, 1, batch.length, TABLES.PARSER_STAGE.length).setValues(batch);
    }
    return rows.length;
  }

  function parseFileToStage(operationId, fileId, options) {
    options = options || {};
    clearOperationStage_(operationId);
    var workbook = readWorkbook_(fileId);
    var resolved = resolveOptions_(workbook, options);
    var detected = detectProfile_(workbook.fileName, workbook, resolved);
    var parsed = parseMatrix(detected.profile.profileId, dataSheet_(workbook).values, resolved);
    var issueCount = writeIssues_(operationId, fileId, detected.profile.profileId, parsed.issues);
    var blocking = parsed.issues.filter(function (issue) { return issue.severity === 'ERROR'; });
    if (blocking.length && runtimeSettings_().failOnUnmapped) {
      throw AKORT.Core.error('PARSER_VALIDATION_FAILED', 'Source parsing produced blocking issues.', {
        profileId: detected.profile.profileId, issueCount: issueCount,
        blockingIssues: blocking.slice(0, 20)
      });
    }
    var staged = writeStage_(operationId, fileId, detected.profile, parsed);
    return {
      fileId: fileId, fileName: workbook.fileName, sourceHash: workbook.sourceHash,
      structuralFingerprint: workbook.structuralFingerprint,
      profile: publicProfile_(detected.profile), confidence: { score: detected.score, margin: detected.margin },
      resolvedOptions: resolved,
      targetTable: detected.profile.targetTable, sourceObservationCount: parsed.sourceObservationCount,
      normalizedRowCount: parsed.normalizedRowCount, parserStageRows: staged,
      issueCount: issueCount, blockingIssueCount: blocking.length
    };
  }

  function parserStageRows_(operationId) {
    var dwh = getDwh_();
    var stage = table_(dwh, 'PARSER_STAGE', TABLES.PARSER_STAGE);
    return readObjects_(stage).filter(function (row) { return String(row.operation_id) === String(operationId); });
  }

  function stageToRaw(operationId, source, parseSummary) {
    var rows = parserStageRows_(operationId);
    if (!rows.length) throw AKORT.Core.error('PARSER_STAGE_EMPTY', 'No parser-stage rows exist for the operation.', { operationId: operationId });
    var normalized = rows.map(function (row) { return JSON.parse(String(row.row_payload_json)); });
    var begin = AKORT.RawStore.beginLoad({
      sourceId: source.sourceId || source.fileId,
      sourceName: source.sourceName || parseSummary.fileName,
      sourceHash: parseSummary.sourceHash,
      targetTable: parseSummary.targetTable
    }, { operationId: operationId, rowsReceived: normalized.length });
    var stage = begin.reused && String(begin.status) === 'COMMITTED' ? null : AKORT.RawStore.stageRows(begin.loadId, normalized);
    return { begin: begin, stage: stage, loadId: begin.loadId, rowCount: normalized.length };
  }

  function markParserStage_(operationId, status) {
    var dwh = getDwh_();
    var stage = table_(dwh, 'PARSER_STAGE', TABLES.PARSER_STAGE);
    var rows = readObjects_(stage).filter(function (row) { return String(row.operation_id) === String(operationId); });
    rows.forEach(function (row) { row.parse_status = status; saveObject_(stage, row); });
    return rows.length;
  }

  function enqueueFile(fileId, options) {
    options = options || {};
    var file = DriveApp.getFileById(fileId);
    return AKORT.OperationEngine.enqueue(OPERATION_TYPE, {
      fileId: fileId,
      fileName: file.getName(),
      profileId: options.profileId || '',
      year: options.year || '', month: options.month || '', week: options.week || '',
      sourcePublishedAt: options.sourcePublishedAt || '',
      sourceId: options.sourceId || fileId,
      sourceName: options.sourceName || file.getName()
    }, { idempotencyKey: options.idempotencyKey || '', maxAttempts: options.maxAttempts || 3 });
  }

  function statusSummary() {
    var dwh = getDwh_();
    var tables = {};
    Object.keys(TABLES).forEach(function (name) {
      var sheet = dwh.getSheetByName(name);
      tables[name] = sheet ? { rows: Math.max(0, sheet.getLastRow() - 1), columns: sheet.getLastColumn() } : null;
    });
    return {
      release: AKORT.Release.manifest(), manifestHash: AKORT.Core.manifestHash(),
      parserSchemaVersion: AKORT.Release.parserSchemaVersion,
      runtimeSettings: runtimeSettings_(), profileCount: PROFILES.length,
      profiles: publicProfiles_(), serviceTables: tables
    };
  }

  function cleanupTestArtifacts(prefix) {
    prefix = String(prefix || 'ALPHA5_TEST_');
    var dwh = getDwh_();
    var stage = table_(dwh, 'PARSER_STAGE', TABLES.PARSER_STAGE);
    var issues = table_(dwh, 'PARSER_ISSUES', TABLES.PARSER_ISSUES);
    var operationIds = {};
    var queue = dwh.getSheetByName('OPERATION_QUEUE');
    if (queue) AKORT.Core.Sheets.readObjects(queue).forEach(function (row) {
      if (String(row.operation_type || '').indexOf(prefix) === 0 || String(row.operation_type || '') === OPERATION_TYPE && String(row.checkpoint_json || '').indexOf(prefix) >= 0) operationIds[String(row.operation_id)] = true;
    });
    var stageRows = readObjects_(stage).filter(function (row) { return operationIds[String(row.operation_id)] || String(row.source_file_id || '').indexOf(prefix) === 0; }).map(function (row) { return row.__row; });
    var issueRows = readObjects_(issues).filter(function (row) { return operationIds[String(row.operation_id)] || String(row.source_file_id || '').indexOf(prefix) === 0; }).map(function (row) { return row.__row; });
    return { parserStageRows: deleteRows_(stage.sheet, stageRows), parserIssueRows: deleteRows_(issues.sheet, issueRows) };
  }

  return {
    Tables: clone_(TABLES),
    OperationType: OPERATION_TYPE,
    install: install,
    runtimeSettings: runtimeSettings_,
    profiles: publicProfiles_,
    detectProfileForTest: function (fileName, values, options) {
      var detected = detectProfile_(fileName, { sheets: [{ name: 'DATA', values: values }] }, options || {});
      return { profile: publicProfile_(detected.profile), score: detected.score, margin: detected.margin, candidates: detected.candidates };
    },
    parseMatrix: parseMatrix,
    previewFile: previewFile,
    inspectFile: inspectFile,
    readWorkbook: readWorkbook_,
    parseFileToStage: parseFileToStage,
    stageToRaw: stageToRaw,
    markParserStage: markParserStage_,
    enqueueFile: enqueueFile,
    statusSummary: statusSummary,
    Test: {
      cleanup: cleanupTestArtifacts,
      clearOperationStage: clearOperationStage_,
      unitKey: unitKey_,
      convertUnit: convertUnit_,
      canonicalName: canonicalName_
    }
  };
})();

/** Operation Engine adapter for real existing source files. */
AKORT.SourceParserHandlers = (function () {
  function supports(operationType) { return String(operationType || '') === AKORT.ExistingSourceParsers.OperationType; }

  function options_(input) {
    return {
      profileId: input.profileId || '', year: input.year || '', month: input.month || '', week: input.week || '',
      sourcePublishedAt: input.sourcePublishedAt || ''
    };
  }

  function storePublishPlanSummary_(state, plan) {
    state.publishPlanSummary = AKORT.IncrementalPublish.summarizePlan(plan);
    if (Object.prototype.hasOwnProperty.call(state, 'publishPlan')) delete state.publishPlan;
    return state.publishPlanSummary;
  }

  function storedPublishPlanSummary_(state, planFactory) {
    if (state.publishPlanSummary) {
      if (Object.prototype.hasOwnProperty.call(state, 'publishPlan')) delete state.publishPlan;
      return state.publishPlanSummary;
    }
    if (state.publishPlan) return storePublishPlanSummary_(state, state.publishPlan);
    return storePublishPlanSummary_(state, planFactory());
  }

  function execute(phase, context) {
    var operation = context.operation || {};
    var checkpoint = context.checkpoint || {};
    var input = checkpoint.input || {};
    var state = checkpoint.handlerState = checkpoint.handlerState || {};
    if (!input.fileId) throw AKORT.Core.error('SOURCE_FILE_ID_REQUIRED', 'SOURCE_FILE_LOAD_V4 requires fileId.', { retryable: false });

    if (phase === 'DISCOVER') {
      var file = DriveApp.getFileById(input.fileId);
      state.file = { fileId: input.fileId, fileName: file.getName(), mimeType: file.getMimeType(), size: file.getSize(), lastUpdated: file.getLastUpdated().toISOString() };
      return { discovered: true, file: state.file };
    }
    if (phase === 'VALIDATE') {
      var inspected = AKORT.ExistingSourceParsers.inspectFile(input.fileId, options_(input));
      state.profile = inspected.profile;
      state.sourceHash = inspected.sourceHash;
      state.structuralFingerprint = inspected.structuralFingerprint;
      state.resolvedOptions = inspected.resolvedOptions;
      return { validated: true, profile: inspected.profile, confidence: inspected.confidence, sourceHash: inspected.sourceHash, resolvedOptions: inspected.resolvedOptions };
    }
    if (phase === 'PARSE') {
      var parseOptions = options_(input);
      if (state.resolvedOptions) Object.keys(state.resolvedOptions).forEach(function (key) { if (!parseOptions[key]) parseOptions[key] = state.resolvedOptions[key]; });
      state.parse = AKORT.ExistingSourceParsers.parseFileToStage(operation.operation_id, input.fileId, parseOptions);
      return state.parse;
    }
    if (phase === 'STAGE') {
      state.rawStage = AKORT.ExistingSourceParsers.stageToRaw(operation.operation_id, {
        fileId: input.fileId, sourceId: input.sourceId || input.fileId,
        sourceName: input.sourceName || input.fileName || state.parse.fileName
      }, state.parse);
      state.loadId = state.rawStage.loadId;
      return state.rawStage;
    }
    if (phase === 'COMMIT_RAW') {
      state.commit = AKORT.RawStore.commitLoad(state.loadId);
      AKORT.ExistingSourceParsers.markParserStage(operation.operation_id, 'COMMITTED');
      return state.commit;
    }
    if (phase === 'UPDATE_PUBLISH') {
      var publishPlan = AKORT.IncrementalPublish.planLoad(state.loadId);
      storePublishPlanSummary_(state, publishPlan);
      if (publishPlan.testOnly) {
        state.publishUpdate = { skipped: true, reason: 'Compatibility smoke-test isolation', marker: publishPlan.testMarker };
        return state.publishUpdate;
      }
      AKORT.IncrementalPublish.appendImpact(operation.operation_id, state.loadId, publishPlan);
      var publishStep = AKORT.IncrementalPublish.applyPublishStep(publishPlan, operation.operation_id, state.publishWork);
      state.publishWork = publishStep.work;
      if (publishStep.repeatPhase === true) return publishStep;
      state.publishUpdate = publishStep;
      delete state.publishWork;
      return state.publishUpdate;
    }
    if (AKORT.AggregateIntegration.Phases.indexOf(phase) >= 0 || phase === 'FINALIZING') {
      var publishPlanSummary = storedPublishPlanSummary_(state, function () { return AKORT.IncrementalPublish.planLoad(state.loadId); });
      state.aggregateUpdate = AKORT.AggregateIntegration.execute(phase, context, {
        loadId: state.loadId,
        mode: 'REVISION',
        testOnly: publishPlanSummary.testOnly === true
      });
      return state.aggregateUpdate;
    }
    if (phase === 'UPDATE_STATUS') return { loadId: state.loadId, loadStatus: AKORT.RawStore.status(state.loadId).load.status };
    if (phase === 'QUICK_AUDIT') return { loadAudit: AKORT.RawStore.auditLoad(state.loadId), parserRows: state.parse.normalizedRowCount, parserIssues: state.parse.issueCount };
    throw AKORT.Core.error('SOURCE_PARSER_PHASE_UNSUPPORTED', 'Unsupported source parser phase.', { phase: phase, retryable: false });
  }

  return { supports: supports, execute: execute };
})();
