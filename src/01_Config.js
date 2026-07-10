var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Config = (function () {
  var PROPERTY_PREFIX = 'AKORT_';
  var SETTINGS_SHEET = 'SYSTEM_SETTINGS';

  function getLocalConfig_() {
    if (typeof AKORT_LOCAL_CONFIG !== 'undefined' && AKORT_LOCAL_CONFIG) {
      return AKORT_LOCAL_CONFIG;
    }
    return null;
  }

  function getPropertyConfig_() {
    var p = PropertiesService.getScriptProperties().getProperties();
    return {
      environment: p[PROPERTY_PREFIX + 'ENVIRONMENT'],
      expectedScriptId: p[PROPERTY_PREFIX + 'EXPECTED_SCRIPT_ID'],
      baselineLabel: p[PROPERTY_PREFIX + 'BASELINE_LABEL'],
      baselineReportId: p[PROPERTY_PREFIX + 'BASELINE_REPORT_ID'] || p.AKORT_ALPHA1_LAST_REPORT_ID || '',
      resources: {
        dwhSpreadsheetId: p[PROPERTY_PREFIX + 'DWH_SPREADSHEET_ID'],
        publishSpreadsheetId: p[PROPERTY_PREFIX + 'PUBLISH_SPREADSHEET_ID'],
        devRootFolderId: p[PROPERTY_PREFIX + 'DEV_ROOT_FOLDER_ID'],
        devTablesFolderId: p[PROPERTY_PREFIX + 'DEV_TABLES_FOLDER_ID'],
        testFilesFolderId: p[PROPERTY_PREFIX + 'TEST_FILES_FOLDER_ID'],
        testResultsFolderId: p[PROPERTY_PREFIX + 'TEST_RESULTS_FOLDER_ID'],
        releasesFolderId: p[PROPERTY_PREFIX + 'RELEASES_FOLDER_ID'],
        docsFolderId: p[PROPERTY_PREFIX + 'DOCS_FOLDER_ID']
      },
      expectedNames: {
        dwh: p[PROPERTY_PREFIX + 'EXPECTED_DWH_NAME'] || 'АКОРТ — DWH TECH 4.0 DEV',
        publish: p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_NAME'] || 'АКОРТ — Publish 4.0 DEV',
        devRoot: p[PROPERTY_PREFIX + 'EXPECTED_DEV_ROOT_NAME'] || '07_Разработка системы 4.0'
      },
      blockedResourceIds: (p[PROPERTY_PREFIX + 'BLOCKED_RESOURCE_IDS'] || '')
        .split(',')
        .map(function (value) { return value.trim(); })
        .filter(String),
      baselineExpected: {
        rawObservationRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_RAW_ROWS'] || 27899),
        publishMainRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_MAIN_ROWS'] || 35434),
        aggregateRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_AGGREGATE_ROWS'] || 61636),
        weeklyLatestRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_WEEKLY_LATEST'] || 157),
        monthlyLatestRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_MONTHLY_LATEST'] || 378),
        aggregateLatestRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_AGGREGATE_LATEST'] || 1364)
      },
      baselinePhysicalExpected: {
        rawWeeklyRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_RAW_WEEKLY_PHYSICAL'] || 13711),
        rawMonthlyRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_RAW_MONTHLY_PHYSICAL'] || 11970),
        rawIndustryRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_RAW_INDUSTRY_PHYSICAL'] || 2266),
        publishWeeklyRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_WEEKLY_PHYSICAL'] || 20211),
        publishMonthlyRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_MONTHLY_PHYSICAL'] || 12957),
        publishIndustryRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_INDUSTRY_PHYSICAL'] || 2266),
        publishAggregateRows: Number(p[PROPERTY_PREFIX + 'EXPECTED_PUBLISH_AGGREGATE_PHYSICAL'] || 61636)
      },
      baseline: {
        chunkRows: Number(p[PROPERTY_PREFIX + 'BASELINE_CHUNK_ROWS'] || 500),
        executionBudgetMs: Number(p[PROPERTY_PREFIX + 'EXECUTION_BUDGET_MS'] || 220000)
      },
      system: {
        logLevel: p[PROPERTY_PREFIX + 'LOG_LEVEL'] || 'INFO',
        lockTimeoutMs: Number(p[PROPERTY_PREFIX + 'LOCK_TIMEOUT_MS'] || 30000),
        maxOperationAttempts: Number(p[PROPERTY_PREFIX + 'MAX_OPERATION_ATTEMPTS'] || 3),
        timezone: p[PROPERTY_PREFIX + 'TIMEZONE'] || 'Europe/Moscow'
      }
    };
  }

  function merge_(primary, fallback) {
    if (!primary) return fallback;
    var result = JSON.parse(JSON.stringify(fallback || {}));
    Object.keys(primary).forEach(function (key) {
      if (primary[key] && typeof primary[key] === 'object' && !Array.isArray(primary[key])) {
        result[key] = merge_(primary[key], result[key] || {});
      } else if (primary[key] !== undefined && primary[key] !== null && primary[key] !== '') {
        result[key] = primary[key];
      }
    });
    return result;
  }

  function parseTyped_(value, type) {
    var normalizedType = String(type || 'STRING').toUpperCase();
    if (normalizedType === 'NUMBER' || normalizedType === 'INTEGER') return Number(value);
    if (normalizedType === 'BOOLEAN') {
      return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
    }
    if (normalizedType === 'JSON') {
      if (value === '' || value === null || value === undefined) return null;
      return JSON.parse(String(value));
    }
    return value === null || value === undefined ? '' : String(value);
  }

  function readSystemSettings_(dwhSpreadsheetId) {
    if (!dwhSpreadsheetId) return {};
    try {
      var spreadsheet = SpreadsheetApp.openById(dwhSpreadsheetId);
      var sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
      if (!sheet || sheet.getLastRow() < 2) return {};
      var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
      var headers = values[0].map(String);
      var index = {};
      headers.forEach(function (name, i) { index[name] = i; });
      var result = {};
      values.slice(1).forEach(function (row) {
        var active = row[index.is_active];
        var isActive = active === true || active === 1 || active === '1' || String(active).toUpperCase() === 'TRUE';
        if (!isActive) return;
        var environment = String(row[index.environment] || 'ALL').toUpperCase();
        if (environment !== 'ALL' && environment !== 'DEV') return;
        var key = String(row[index.setting_key] || '').trim();
        if (!key) return;
        result[key] = parseTyped_(row[index.setting_value], row[index.value_type]);
      });
      return result;
    } catch (error) {
      return {};
    }
  }

  function applySystemSettings_(config, settings) {
    config.system = config.system || {};
    if (settings.SYSTEM_ENVIRONMENT) config.system.environment = settings.SYSTEM_ENVIRONMENT;
    if (settings.CORE_SCHEMA_VERSION) config.system.schemaVersion = settings.CORE_SCHEMA_VERSION;
    if (settings.LOG_LEVEL) config.system.logLevel = settings.LOG_LEVEL;
    if (settings.LOCK_TIMEOUT_MS !== undefined) config.system.lockTimeoutMs = Number(settings.LOCK_TIMEOUT_MS);
    if (settings.MAX_OPERATION_ATTEMPTS !== undefined) config.system.maxOperationAttempts = Number(settings.MAX_OPERATION_ATTEMPTS);
    if (settings.TIMEZONE) config.system.timezone = settings.TIMEZONE;
    if (settings.BASELINE_REPORT_ID) config.baselineReportId = String(settings.BASELINE_REPORT_ID);
    if (settings.BASELINE_LABEL) config.baselineLabel = String(settings.BASELINE_LABEL);
    return config;
  }

  function load(options) {
    options = options || {};
    var propertyConfig = getPropertyConfig_();
    var localConfig = getLocalConfig_();
    var config = merge_(localConfig, propertyConfig);
    validateShape_(config);
    if (options.includeSystemSettings !== false) {
      config = applySystemSettings_(config, readSystemSettings_(config.resources.dwhSpreadsheetId));
    }
    validateConsistency_(config);
    return config;
  }

  function validateShape_(config) {
    var missing = [];
    if (!config.environment) missing.push('environment');
    if (!config.expectedScriptId) missing.push('expectedScriptId');
    if (!config.baselineLabel) missing.push('baselineLabel');
    var requiredResources = [
      'dwhSpreadsheetId', 'publishSpreadsheetId', 'devRootFolderId',
      'devTablesFolderId', 'testFilesFolderId', 'testResultsFolderId',
      'releasesFolderId', 'docsFolderId'
    ];
    requiredResources.forEach(function (key) {
      if (!config.resources || !config.resources[key]) missing.push('resources.' + key);
    });
    if (missing.length) throw new Error('AKORT configuration is incomplete: ' + missing.join(', '));
  }

  function validateConsistency_(config) {
    if (String(config.environment).toUpperCase() !== 'DEV') {
      throw new Error('Core Foundation may only run in DEV. Actual environment: ' + config.environment);
    }
    if (config.system && config.system.environment && String(config.system.environment).toUpperCase() !== 'DEV') {
      throw new Error('SYSTEM_SETTINGS environment conflicts with local DEV configuration.');
    }
    return true;
  }

  function maskId_(value) {
    if (!value) return '';
    var text = String(value);
    if (text.length <= 10) return '***';
    return text.slice(0, 5) + '…' + text.slice(-5);
  }

  function describe() {
    var config = load();
    var resources = {};
    Object.keys(config.resources).forEach(function (key) {
      resources[key] = maskId_(config.resources[key]);
    });
    return {
      release: AKORT.Release.version,
      environment: config.environment,
      expectedScriptId: maskId_(config.expectedScriptId),
      baselineLabel: config.baselineLabel,
      baselineReportId: maskId_(config.baselineReportId),
      resources: resources,
      expectedNames: config.expectedNames,
      baselineExpected: config.baselineExpected,
      baselinePhysicalExpected: config.baselinePhysicalExpected,
      baseline: config.baseline,
      system: config.system
    };
  }

  return {
    load: load,
    describe: describe,
    readSystemSettings: function () {
      var config = load({ includeSystemSettings: false });
      return readSystemSettings_(config.resources.dwhSpreadsheetId);
    }
  };
})();
