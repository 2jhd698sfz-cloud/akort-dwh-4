var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Config = (function () {
  var PROPERTY_PREFIX = 'AKORT_';

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
      baseline: {
        chunkRows: Number(p[PROPERTY_PREFIX + 'BASELINE_CHUNK_ROWS'] || 500),
        executionBudgetMs: Number(p[PROPERTY_PREFIX + 'EXECUTION_BUDGET_MS'] || 220000)
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

  function load() {
    var propertyConfig = getPropertyConfig_();
    var localConfig = getLocalConfig_();
    var config = merge_(localConfig, propertyConfig);
    validateShape_(config);
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
    if (missing.length) {
      throw new Error('AKORT configuration is incomplete: ' + missing.join(', '));
    }
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
      resources: resources,
      expectedNames: config.expectedNames,
      baselineExpected: config.baselineExpected,
      baseline: config.baseline
    };
  }

  return {
    load: load,
    describe: describe
  };
})();
