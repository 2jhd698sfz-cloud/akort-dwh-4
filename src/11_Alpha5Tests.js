var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.Alpha5Tests = (function () {
  function test_(id, fn) {
    try { return { id: id, status: 'PASS', data: fn(), error: null }; }
    catch (caught) {
      return { id: id, status: 'FAIL', data: null, error: { code: caught.code || 'UNEXPECTED_ERROR', message: caught.message || String(caught), details: caught.details || null, stack: caught.stack || '' } };
    }
  }

  function require_(condition, code, message, details) {
    if (!condition) throw AKORT.Core.error(code, message, details);
  }

  function ref_(sourceFileType, valueType, oneToMany) {
    var products = [
      { category_id: 'TEST_CAT_1', product_name: 'Капуста белокочанная свежая, кг.', unit: 'кг', is_active: 1 },
      { category_id: 'TEST_CAT_2', product_name: 'Капуста тестовая дополнительная, кг.', unit: 'кг', is_active: 1 },
      { category_id: 'TEST_MILK', product_name: 'Молоко сырое крупного рогатого скота, кг.', unit: 'кг', is_active: 1 }
    ];
    var mappings = [{
      dataset_code: 'ROSSTAT_WEEKLY', source_product_name: 'Капуста белокочанная свежая, кг',
      category_id: 'TEST_CAT_1', source_file_type: sourceFileType || 'AVG_PRICE',
      value_type: valueType || 'розница', valid_from: '2024-01-01', valid_to: '', is_active: 1
    }, {
      dataset_code: 'ROSSTAT_MONTHLY', source_product_name: 'Капуста белокочанная свежая, кг',
      category_id: 'TEST_CAT_1', source_file_type: sourceFileType || 'CPI_MONTHLY',
      value_type: valueType || 'ИПЦ', valid_from: '2024-01-01', valid_to: '', is_active: 1
    }, {
      dataset_code: 'ROSSTAT_MONTHLY', source_product_name: 'Молоко сырое крупного рогатого скота',
      category_id: 'TEST_MILK', source_file_type: sourceFileType || 'PPI_AGRI',
      value_type: valueType || 'производитель', valid_from: '2024-01-01', valid_to: '', is_active: 1
    }];
    if (oneToMany) mappings.push({
      dataset_code: 'ROSSTAT_WEEKLY', source_product_name: 'Капуста белокочанная свежая, кг',
      category_id: 'TEST_CAT_2', source_file_type: sourceFileType || 'AVG_PRICE',
      value_type: valueType || 'розница', valid_from: '2024-01-01', valid_to: '', is_active: 1
    });
    return { products: products, mappings: mappings };
  }

  function detectionFixture_(profileId) {
    if (profileId === 'AKORT_WEEKLY_W00') return [['YEAR', 2099], ['WEEK', 1], [], ['Еженедельные средние цены АКОРТ'], [], ['product_name', 'purchase_price', 'retail_price']];
    if (profileId === 'ROSSTAT_WEEKLY_RETAIL_PRICES') return [['YEAR', 2099], [], ['Еженедельные средние потребительские цены Росстат'], [], ['product_name / observation_date', 'на 5 января']];
    if (profileId === 'ROSSTAT_WEEKLY_RETAIL_CPI') return [['YEAR', 2099], [], ['Еженедельные индексы потребительских цен Росстат'], [], ['product_name / observation_date', 'на 5 января']];
    if (profileId === 'AKORT_MONTHLY_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние цены АКОРТ'], [], ['product_name', 'purchase_price', 'retail_price']];
    if (profileId === 'ROSSTAT_MONTHLY_RETAIL_PRICES_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние потребительские цены Росстат'], [], ['product_name', 'Капуста'], ['current_value', 100]];
    if (profileId === 'ROSSTAT_MONTHLY_RETAIL_CPI_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Индексы потребительских цен Росстат'], [], ['product_name', 'mom', 'december', 'yoy']];
    if (profileId === 'ROSSTAT_MONTHLY_PURCHASE_INDEX_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Индексы цен приобретения организациями розничной торговли Росстат'], [], ['product_name', 'december', 'mom', 'yoy']];
    if (profileId === 'ROSSTAT_MONTHLY_PURCHASE_PRICES_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние цены приобретения организациями розничной торговли Росстат'], [], ['product_name', 'unit', 'current_value']];
    if (profileId === 'ROSSTAT_MONTHLY_PPI_INDUSTRY_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Индексы цен производителей промышленных товаров Росстат'], [], ['product_name', 'december', 'mom', 'yoy']];
    if (profileId === 'ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Индексы цен производителей сельскохозяйственной продукции Росстат'], [], ['product_name', 'december', 'mom', 'yoy']];
    if (profileId === 'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00') return [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние цены производителей промышленных товаров Росстат'], [], ['product_name', 'unit', 'current_value']];
    return [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние цены производителей сельскохозяйственной продукции Росстат'], [], ['product_name', 'unit', 'current_value']];
  }

  function fileNameFor_(profileId) {
    return profileId + '_TEST';
  }

  function physicalCounts_(dwh, publish) {
    function count_(book, name) { var sheet = book.getSheetByName(name); return Math.max(0, sheet.getLastRow() - 1); }
    return {
      rawWeeklyRows: count_(dwh, 'RAW_PRICES_WEEKLY'), rawMonthlyRows: count_(dwh, 'RAW_PRICES_MONTHLY'), rawIndustryRows: count_(dwh, 'RAW_INDUSTRY'),
      publishWeeklyRows: count_(publish, 'PUBLISH_PRICES_WEEKLY'), publishMonthlyRows: count_(publish, 'PUBLISH_PRICES_MONTHLY'),
      publishIndustryRows: count_(publish, 'PUBLISH_INDUSTRY'), publishAggregateRows: count_(publish, 'PUBLISH_PRICE_AGGREGATES')
    };
  }

  function createTempWeekly_(suiteId) {
    var spreadsheet = SpreadsheetApp.create('AKORT_WEEKLY_W00_' + suiteId, 30, 5);
    var sheet = spreadsheet.getSheets()[0];
    sheet.setName('DATA');
    sheet.getRange(1, 1, 7, 3).setValues([
      ['YEAR', 2099, ''], ['WEEK', 1, ''], ['', '', ''],
      ['Еженедельные средние цены АКОРТ', '', ''], ['', '', ''],
      ['product_name', 'purchase_price', 'retail_price'],
      ['Капуста белокочанная свежая, кг.', 100, 110]
    ]);
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var file = DriveApp.getFileById(spreadsheet.getId());
    DriveApp.getFolderById(config.resources.testFilesFolderId).addFile(file);
    var parents = file.getParents();
    while (parents.hasNext()) { var parent = parents.next(); if (parent.getId() !== config.resources.testFilesFolderId) parent.removeFile(file); }
    return file;
  }

  function runSmokeTest() {
    return AKORT.Core.safeRun('ALPHA5_SMOKE_TEST', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load();
      var dwh = SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
      var publish = SpreadsheetApp.openById(config.resources.publishSpreadsheetId);
      var before = physicalCounts_(dwh, publish);
      var suiteId = 'ALPHA5_TEST_' + AKORT.Core.Id.execution();
      var tests = [];
      var tempFile = null;
      var operationId = '';

      tests.push(test_('parser_contract', function () {
        var profiles = AKORT.ExistingSourceParsers.profiles();
        require_(profiles.length === 12, 'PARSER_PROFILE_COUNT', 'Expected twelve active parser profiles.', profiles);
        require_(AKORT.Release.parserSchemaVersion === '4.0-parser-1', 'PARSER_SCHEMA_VERSION', 'Unexpected parser schema version.');
        return { parserSchemaVersion: AKORT.Release.parserSchemaVersion, profileIds: profiles.map(function (profile) { return profile.profileId; }) };
      }));

      tests.push(test_('profile_detection', function () {
        return AKORT.ExistingSourceParsers.profiles().map(function (profile) {
          var detected = AKORT.ExistingSourceParsers.detectProfileForTest(fileNameFor_(profile.profileId), detectionFixture_(profile.profileId), {});
          require_(detected.profile.profileId === profile.profileId, 'PROFILE_DETECTION_MISMATCH', 'Detected profile does not match expected profile.', { expected: profile.profileId, actual: detected });
          return { profileId: profile.profileId, score: detected.score, margin: detected.margin };
        });
      }));

      tests.push(test_('akort_weekly_parser', function () {
        var values = [['YEAR', 2099], ['WEEK', 1], [], ['Еженедельные средние цены АКОРТ'], [], ['product_name', 'purchase_price', 'retail_price'], ['Капуста белокочанная свежая, кг.', 100, 110]];
        var result = AKORT.ExistingSourceParsers.parseMatrix('AKORT_WEEKLY_W00', values, { referenceData: ref_(), sourcePublishedAt: '2099-01-05' });
        require_(result.rows.length === 2, 'AKORT_WEEKLY_ROW_COUNT', 'AKORT weekly parser must create purchase and retail rows.', result);
        return result.rows.map(function (item) { return item.row; });
      }));

      tests.push(test_('weekly_rosstat_parsers', function () {
        var values = [['YEAR', 2099], [], ['Еженедельные средние потребительские цены Росстат'], [], ['product_name / observation_date', 'на 5 января'], ['Капуста белокочанная свежая, кг', 100]];
        var prices = AKORT.ExistingSourceParsers.parseMatrix('ROSSTAT_WEEKLY_RETAIL_PRICES', values, { referenceData: ref_('AVG_PRICE', 'розница') });
        var cpiValues = [['YEAR', 2099], [], ['Еженедельные индексы потребительских цен Росстат'], [], ['product_name / observation_date', 'на 5 января'], ['Капуста белокочанная свежая, кг', 101.2]];
        var cpi = AKORT.ExistingSourceParsers.parseMatrix('ROSSTAT_WEEKLY_RETAIL_CPI', cpiValues, { referenceData: ref_('CPI_WEEKLY', 'ИПЦ') });
        require_(prices.rows.length === 1 && cpi.rows.length === 1 && cpi.rows[0].row.index_type === 'wow', 'WEEKLY_PARSE_CONTRACT', 'Weekly source parser contract failed.', { prices: prices, cpi: cpi });
        return { price: prices.rows[0].row, cpi: cpi.rows[0].row };
      }));

      tests.push(test_('monthly_price_parsers', function () {
        var akort = AKORT.ExistingSourceParsers.parseMatrix('AKORT_MONTHLY_M00', [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние цены АКОРТ'], [], ['product_name', 'purchase_price', 'retail_price'], ['Капуста белокочанная свежая, кг.', 100, 110]], { referenceData: ref_() });
        var retail = AKORT.ExistingSourceParsers.parseMatrix('ROSSTAT_MONTHLY_RETAIL_PRICES_M00', [['YEAR', 2099], ['MONTH', 1], [], ['Ежемесячные средние потребительские цены Росстат'], [], ['product_name', 'Капуста белокочанная свежая, кг'], ['current_value', 120]], { referenceData: ref_('AVG_PRICE', 'розница') });
        require_(akort.rows.length === 2 && retail.rows.length === 1, 'MONTHLY_PRICE_PARSE', 'Monthly price parser contract failed.', { akort: akort, retail: retail });
        return { akortRows: akort.rows.length, retailRow: retail.rows[0].row };
      }));

      tests.push(test_('monthly_index_parsers', function () {
        var profiles = ['ROSSTAT_MONTHLY_RETAIL_CPI_M00', 'ROSSTAT_MONTHLY_PURCHASE_INDEX_M00', 'ROSSTAT_MONTHLY_PPI_INDUSTRY_M00', 'ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00'];
        return profiles.map(function (profileId) {
          var profile = AKORT.ExistingSourceParsers.profiles().filter(function (item) { return item.profileId === profileId; })[0];
          var reference = ref_(profile.sourceFileType, profile.valueType);
          var result = AKORT.ExistingSourceParsers.parseMatrix(profileId, [['YEAR', 2099], ['MONTH', 1], [], ['Индексы цен'], [], ['product_name', 'mom', 'december', 'yoy'], ['Капуста белокочанная свежая, кг', 101, 102, 103]], { referenceData: reference });
          require_(result.rows.length === 3, 'MONTHLY_INDEX_ROW_COUNT', 'Monthly index parser must create mom, december and yoy rows.', { profileId: profileId, result: result });
          return { profileId: profileId, indexTypes: result.rows.map(function (item) { return item.row.index_type; }) };
        });
      }));

      tests.push(test_('monthly_level_unit_conversion', function () {
        var profiles = ['ROSSTAT_MONTHLY_PURCHASE_PRICES_M00', 'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00', 'ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00'];
        return profiles.map(function (profileId) {
          var profile = AKORT.ExistingSourceParsers.profiles().filter(function (item) { return item.profileId === profileId; })[0];
          var reference = ref_(profile.sourceFileType, profile.valueType);
          var result = AKORT.ExistingSourceParsers.parseMatrix(profileId, [['YEAR', 2099], ['MONTH', 1], [], ['Средние цены'], [], ['product_name', 'unit', 'current_value'], ['Молоко сырое крупного рогатого скота', 'Тонна; метрическая тонна (1000 кг)', 1000]], { referenceData: reference });
          require_(result.rows.length === 1 && Number(result.rows[0].row.value) === 1, 'UNIT_CONVERSION_FAILED', 'Tonne-to-kilogram price conversion failed.', { profileId: profileId, result: result });
          return { profileId: profileId, value: result.rows[0].row.value };
        });
      }));

      tests.push(test_('one_to_many_mapping', function () {
        var values = [['YEAR', 2099], [], ['Еженедельные средние потребительские цены Росстат'], [], ['product_name / observation_date', 'на 5 января'], ['Капуста белокочанная свежая, кг', 100]];
        var result = AKORT.ExistingSourceParsers.parseMatrix('ROSSTAT_WEEKLY_RETAIL_PRICES', values, { referenceData: ref_('AVG_PRICE', 'розница', true) });
        require_(result.rows.length === 2, 'ONE_TO_MANY_MAPPING_FAILED', 'Intentional one-to-many mapping must create two normalized rows.', result);
        return result.rows.map(function (item) { return item.row.category_id; });
      }));

      tests.push(test_('source_scope_filtering_and_blocking_validation', function () {
        var zeroRows = false;

        try {
          AKORT.ExistingSourceParsers.parseMatrix(
            'AKORT_WEEKLY_W00',
            [
              ['YEAR', 2099],
              ['WEEK', 1],
              [],
              [],
              [],
              ['product_name', 'purchase_price', 'retail_price']
            ],
            { referenceData: ref_() }
          );
        } catch (caught) {
          zeroRows = caught.code === 'PARSER_ZERO_ROWS';
        }

        var values = [
          ['YEAR', 2099],
          [],
          ['Еженедельные цены'],
          [],
          ['product_name / observation_date', 'на 5 января'],
          ['Капуста белокочанная свежая, кг', 100],
          ['Категория вне мониторинга', 200]
        ];

        var filtered =
          AKORT.ExistingSourceParsers.parseMatrix(
            'ROSSTAT_WEEKLY_RETAIL_PRICES',
            values,
            {
              referenceData: ref_('AVG_PRICE', 'розница')
            }
          );

        var blocking = filtered.issues.filter(function (issue) {
          return issue.severity === 'ERROR';
        });
        var scopeInfo = filtered.issues.filter(function (issue) {
          return issue.issueCode ===
            'OUT_OF_MONITORING_SCOPE_IGNORED';
        });

        require_(
          filtered.rows.length === 1 &&
            filtered.monitoringScope.configuredCategoryCount === 1 &&
            filtered.monitoringScope.matchedCategoryCount === 1 &&
            filtered.monitoringScope.ignoredObservationCount === 1 &&
            filtered.monitoringScope.ignoredSourceLabelCount === 1 &&
            blocking.length === 0 &&
            scopeInfo.length === 1,
          'PARSER_SOURCE_SCOPE_FILTER_FAILED',
          'Full source export was not filtered by the active monitoring scope.',
          filtered
        );

        var emptyScope =
          AKORT.ExistingSourceParsers.parseMatrix(
            'ROSSTAT_WEEKLY_RETAIL_PRICES',
            values,
            {
              referenceData: {
                products: ref_().products,
                mappings: []
              }
            }
          );

        var emptyScopeBlocked =
          emptyScope.issues.some(function (issue) {
            return issue.severity === 'ERROR' &&
              issue.issueCode === 'MONITORING_SCOPE_EMPTY';
          });

        require_(
          zeroRows && emptyScopeBlocked,
          'PARSER_VALIDATION_CONTRACT',
          'Zero-row or empty monitoring-scope validation did not fire.',
          {
            zeroRows: zeroRows,
            emptyScope: emptyScope
          }
        );

        return {
          zeroRowsBlocked: zeroRows,
          sourceScopeFiltered: true,
          ignoredObservationCount:
            filtered.monitoringScope.ignoredObservationCount,
          emptyScopeBlocked: emptyScopeBlocked
        };
      }));

      tests.push(test_('operation_engine_integration', function () {
        tempFile = createTempWeekly_(suiteId);
        var queued = AKORT.ExistingSourceParsers.enqueueFile(tempFile.getId(), {
          profileId: 'AKORT_WEEKLY_W00', sourceId: suiteId + '_SOURCE', sourceName: suiteId + '_AKORT_WEEKLY',
          sourcePublishedAt: '2099-01-05', idempotencyKey: suiteId + '_OPERATION'
        });
        require_(queued.ok, 'ALPHA5_ENQUEUE_FAILED', 'Source file operation could not be queued.', queued);
        operationId = queued.data.operationId;
        var completed = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        require_(completed.ok && completed.status === 'SUCCESS', 'ALPHA5_OPERATION_FAILED', 'Source file operation did not reach SUCCESS.', completed);
        var status = AKORT.OperationEngine.status(operationId);
        require_(status.data.steps.map(function (step) { return step.phase; }).join('|') === AKORT.OperationEngine.Phases.join('|'), 'ALPHA5_PHASE_SEQUENCE', 'Source parser operation phase sequence is incomplete.', status.data.steps);
        return { operationId: operationId, phases: status.data.steps.map(function (step) { return step.phase; }), operation: status.data.operation };
      }));

      var parserCleanup = operationId ? AKORT.ExistingSourceParsers.Test.clearOperationStage(operationId) : { stageRows: 0, issueRows: 0 };
      var rawCleanup = AKORT.RawStore.Test.cleanup('ALPHA5_TEST_');
      if (tempFile) { try { tempFile.setTrashed(true); } catch (ignored) {} }

      tests.push(test_('baseline_and_publish_restored', function () {
        var after = physicalCounts_(dwh, publish);
        require_(JSON.stringify(after) === JSON.stringify(before), 'ALPHA5_BASELINE_CHANGED', 'Alpha.5 smoke test did not restore RAW and Publish counts.', { before: before, after: after, parserCleanup: parserCleanup, rawCleanup: rawCleanup });
        Object.keys(config.baselinePhysicalExpected).forEach(function (key) {
          require_(Number(after[key]) === Number(config.baselinePhysicalExpected[key]), 'BASELINE_EXPECTATION_MISMATCH', 'Physical row count differs from verified baseline for ' + key, { expected: config.baselinePhysicalExpected[key], actual: after[key] });
        });
        return { before: before, after: after, parserCleanup: parserCleanup, rawCleanup: rawCleanup };
      }));

      var ok = tests.every(function (test) { return test.status === 'PASS'; });
      context.logger.info('Alpha.5 smoke test completed', { suiteId: suiteId, status: ok ? 'PASS' : 'FAIL', tests: tests.map(function (test) { return { id: test.id, status: test.status }; }) }, { eventCode: ok ? 'ALPHA5_SMOKE_PASS' : 'ALPHA5_SMOKE_FAIL' });
      return ok ? AKORT.Result.success('Alpha.5 Existing Source Parsers smoke test passed.', {
        suiteId: suiteId, tests: tests, parsers: AKORT.ExistingSourceParsers.statusSummary()
      }) : AKORT.Result.failure('ALPHA5_SMOKE_TEST_FAILED', 'One or more Existing Source Parsers checks failed.', { suiteId: suiteId, tests: tests });
    }, { lock: false, persistLogs: true });
  }

  return { runSmokeTest: runSmokeTest };
})();
