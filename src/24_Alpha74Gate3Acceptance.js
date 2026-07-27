var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 3 acceptance harness.
 *
 * The harness reconstructs representative authoritative planner inputs from the
 * immutable Alpha.7.1 baseline plus accepted RAW_CATEGORY_WEIGHTS. All planning
 * stays in memory. DWH staging, PUBLISH_IMPACT and Publish targets are read-only.
 * The combined acceptance entry point writes one JSON evidence file only after
 * every scenario and the before/after data-plane comparison pass.
 */
AKORT.Alpha74Gate3Acceptance = (function () {
  var VERSION = '4.0-alpha74-gate3-acceptance-1';
  var RELEASE = '4.0.0-alpha.7.4.2';
  var BASELINE_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var WEIGHTS_SHEET = 'RAW_CATEGORY_WEIGHTS';
  var STAGE_SHEET = 'AGGREGATE_STAGE';
  var IMPACT_SHEET = 'PUBLISH_IMPACT';
  var SETTINGS_SHEET = 'SYSTEM_SETTINGS';
  var READ_COLUMNS = 26;
  var CHUNK_ROWS = 1500;
  var SCENARIOS = Object.freeze({
    NEW_PERIOD: 'NEW_PERIOD',
    REVISION: 'REVISION',
    REVERSAL: 'REVERSAL'
  });
  var REQUIRED_SETTINGS = Object.freeze([
    'PUBLISH_AGGREGATE_EXECUTION_ENABLED',
    'PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED'
  ]);

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function clone_(value) {
    if (Array.isArray(value)) return value.map(clone_);
    if (value && typeof value === 'object') {
      if (value instanceof Date) return new Date(value.getTime());
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = clone_(value[key]); });
      return out;
    }
    return value;
  }

  function stable_(value) {
    if (Array.isArray(value)) return value.map(stable_);
    if (value && typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      var out = {};
      Object.keys(value).sort().forEach(function (key) { out[key] = stable_(value[key]); });
      return out;
    }
    if (typeof value === 'number' && !isFinite(value)) return null;
    return value;
  }

  function stableStringify_(value) {
    return JSON.stringify(stable_(value));
  }

  function hash_(value) {
    return AKORT.Core.sha256(typeof value === 'string' ? value : stableStringify_(value));
  }

  function error_(code, message, details) {
    return AKORT.Core.error(code, message, details || {});
  }

  function assert_(condition, code, message, details) {
    if (!condition) throw error_(code, message, details);
  }

  function uniqueSorted_(values) {
    var map = {};
    (values || []).forEach(function (value) {
      var key = text_(value);
      if (key) map[key] = true;
    });
    return Object.keys(map).sort();
  }

  function canonicalUnique_(values) {
    var map = {};
    (values || []).forEach(function (value) {
      map[stableStringify_(value)] = clone_(value);
    });
    return Object.keys(map).sort().map(function (key) { return map[key]; });
  }

  function headerMap_(headers) {
    var map = {};
    (headers || []).forEach(function (header, index) {
      map[text_(header)] = index;
    });
    return map;
  }

  function requireHeaders_(headers, required, sheetName) {
    var map = headerMap_(headers);
    var missing = [];
    (required || []).forEach(function (header) {
      if (map[header] === undefined) missing.push(header);
    });
    assert_(!missing.length, 'ALPHA74_GATE3_SCHEMA_INVALID', 'Gate 3 source is missing required columns.', {
      sheet: sheetName,
      missing: missing
    });
    return map;
  }

  function rowObject_(row, index) {
    var out = {};
    Object.keys(index).forEach(function (header) {
      out[header] = row[index[header]];
    });
    return out;
  }

  function periodKey_(frequency, value) {
    return AKORT.AggregateContract.Test.periodKey(frequency, value);
  }

  function contextKey_(dataset, frequency, valueType, indexType, period) {
    return [
      text_(dataset),
      text_(frequency).toLowerCase(),
      text_(valueType),
      text_(indexType).toLowerCase(),
      periodKey_(frequency, period)
    ].join('|');
  }

  function datasetFrequencyKey_(dataset, frequency) {
    return [text_(dataset), text_(frequency).toLowerCase()].join('|');
  }

  function sourceResources_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var resources = config && config.resources || {};
    assert_(text_(resources.alpha71BaselinePublishSpreadsheetId), 'ALPHA74_GATE3_BASELINE_MISSING', 'Immutable Alpha.7.1 baseline is not configured.');
    assert_(text_(resources.dwhSpreadsheetId), 'ALPHA74_GATE3_DWH_MISSING', 'DEV DWH is not configured.');
    assert_(text_(resources.testResultsFolderId), 'ALPHA74_GATE3_RESULTS_FOLDER_MISSING', 'DEV test-results folder is not configured.');
    return {
      baselineSpreadsheetId: text_(resources.alpha71BaselinePublishSpreadsheetId),
      dwhSpreadsheetId: text_(resources.dwhSpreadsheetId),
      testResultsFolderId: text_(resources.testResultsFolderId)
    };
  }

  function readAcceptedRows_(spreadsheet, contexts) {
    var sheet = spreadsheet.getSheetByName(BASELINE_SHEET);
    assert_(sheet, 'ALPHA74_GATE3_BASELINE_SHEET_MISSING', 'Immutable Alpha.7.1 aggregate sheet is missing.', {
      sheet: BASELINE_SHEET
    });
    var headers = sheet.getRange(1, 1, 1, READ_COLUMNS).getValues()[0];
    var required = [
      'dataset_code', 'frequency', 'aggregate_level', 'aggregate_name',
      'category_id', 'product_group', 'product_name', 'value_type',
      'index_type', 'period_start', 'category_value', 'category_change_pp',
      'category_weight', 'aggregate_change_pp',
      'contribution_to_group_change_pp', 'contribution_to_basket_change_pp',
      'contribution_to_total_cpi_pp', 'weight_source',
      'coverage_categories_count', 'coverage_weight_sum'
    ];
    var index = requireHeaders_(headers, required, BASELINE_SHEET);
    var retained = {};
    var contextIndex = {};
    var datasetFrequencies = {};
    var frontierPeriods = {};
    (contexts || []).forEach(function (context) {
      var key = contextKey_(
        context.dataset_code,
        context.frequency,
        context.value_type,
        context.index_type,
        context.period_start
      );
      retained[key] = { context: clone_(context), category_rows: [], aggregate_rows: [] };
      contextIndex[key] = true;
      datasetFrequencies[datasetFrequencyKey_(context.dataset_code, context.frequency)] = true;
    });
    var lastRow = sheet.getLastRow();
    for (var start = 2; start <= lastRow; start += CHUNK_ROWS) {
      var count = Math.min(CHUNK_ROWS, lastRow - start + 1);
      var values = sheet.getRange(start, 1, count, READ_COLUMNS).getValues();
      values.forEach(function (row) {
        var dataset = text_(row[index.dataset_code]);
        var frequency = text_(row[index.frequency]).toLowerCase();
        var datasetFrequency = datasetFrequencyKey_(dataset, frequency);
        if (datasetFrequencies[datasetFrequency]) {
          var frontierPeriod;
          try {
            frontierPeriod = periodKey_(frequency, row[index.period_start]);
            frontierPeriods[datasetFrequency] = frontierPeriods[datasetFrequency] || {};
            frontierPeriods[datasetFrequency][frontierPeriod] = true;
          } catch (ignoredPeriod) {}
        }
        var key;
        try {
          key = contextKey_(
            dataset,
            frequency,
            row[index.value_type],
            row[index.index_type],
            row[index.period_start]
          );
        } catch (ignoredContext) {
          return;
        }
        if (!contextIndex[key]) return;
        var object = rowObject_(row, index);
        object.period_key = periodKey_(object.frequency, object.period_start);
        if (text_(object.aggregate_level) === 'category') {
          retained[key].category_rows.push(object);
        } else {
          retained[key].aggregate_rows.push(object);
        }
      });
    }
    Object.keys(retained).forEach(function (key) {
      retained[key].category_rows.sort(function (left, right) {
        return text_(left.category_id) < text_(right.category_id) ? -1 :
          text_(left.category_id) > text_(right.category_id) ? 1 : 0;
      });
      retained[key].aggregate_rows.sort(function (left, right) {
        var a = [text_(left.aggregate_level), text_(left.aggregate_name), text_(left.product_group)].join('|');
        var b = [text_(right.aggregate_level), text_(right.aggregate_name), text_(right.product_group)].join('|');
        return a < b ? -1 : a > b ? 1 : 0;
      });
    });
    var periods = {};
    Object.keys(frontierPeriods).forEach(function (key) {
      periods[key] = Object.keys(frontierPeriods[key]).sort();
    });
    return { retained: retained, frontierPeriods: periods };
  }

  function readWeightRows_(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(WEIGHTS_SHEET);
    assert_(sheet, 'ALPHA74_GATE3_WEIGHT_SHEET_MISSING', 'Accepted RAW_CATEGORY_WEIGHTS is missing.', {
      sheet: WEIGHTS_SHEET
    });
    var lastRow = sheet.getLastRow();
    var lastColumn = Math.min(sheet.getLastColumn(), 13);
    var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    var required = [
      'source_code', 'category_id', 'product_group', 'product_name',
      'weight_year', 'weight_scope', 'weight_value', 'allocation_factor'
    ];
    var index = requireHeaders_(values[0], required, WEIGHTS_SHEET);
    return values.slice(1).filter(function (row) {
      return row.some(function (value) { return text_(value) !== ''; });
    }).map(function (row) {
      return rowObject_(row, index);
    });
  }

  function levelsFor_(context) {
    var levels = ['group', 'basket'];
    if (text_(context.total_subject)) levels.push('total_cpi');
    return levels;
  }

  function normalizeDefinition_(built, context, level) {
    var source = clone_(built.definition || {});
    source.definition_version = 'ACCEPTED_BASELINE_V1';
    source.effective_from = '1900-01-01';
    source.effective_to = '';
    source.status = 'ACCEPTED';
    source.provenance = 'IMMUTABLE_ALPHA71_BASELINE_PLUS_ACCEPTED_RAW_CATEGORY_WEIGHTS';
    source.source_map_id = ['ALPHA74_GATE3', context.context_id, level].join('_');
    return AKORT.SpecialAggregateDefinitions.Test.normalizeDefinition(source);
  }

  function snapshot_(id, rows, label) {
    var snapshot = {
      snapshot_id: id,
      rule_rows: canonicalUnique_(rows)
    };
    var identity = AKORT.AggregateRevisionPlanner.Test.snapshotIdentity(snapshot, label);
    snapshot.hash = identity.computed_hash;
    return snapshot;
  }

  function fixtureFor_(data, weightRows, frontierPeriods) {
    var context = data.context;
    var definitions = [];
    var memberships = [];
    var weights = [];
    var priceInputs = [];
    var acceptedRowKeys = [];
    var sourceCategoryId = '';
    levelsFor_(context).forEach(function (level) {
      var built = AKORT.Alpha72GoldenAcceptance.Test.buildGoldenRequest(data, weightRows, level);
      var definition = normalizeDefinition_(built, context, level);
      definitions.push(definition);
      memberships = memberships.concat(built.request.membership_snapshot.rule_rows || []);
      weights = weights.concat(built.request.weight_snapshot.rule_rows || []);
      priceInputs = priceInputs.concat(built.request.price_inputs || []);
      sourceCategoryId = sourceCategoryId || text_(built.request.impact_items[0] && built.request.impact_items[0].source_category_id);
      var identity = clone_(definition);
      identity.period_start = context.period_start;
      if (identity.aggregate_level === 'group') identity.group_id = identity.aggregate_subject_id;
      acceptedRowKeys.push(AKORT.AggregateContract.aggregateRowKey(identity));
    });
    var key = datasetFrequencyKey_(context.dataset_code, context.frequency);
    var periods = uniqueSorted_(frontierPeriods[key] || []);
    assert_(periods.indexOf(periodKey_(context.frequency, context.period_start)) >= 0, 'ALPHA74_GATE3_FRONTIER_MISSING', 'Fixture period is absent from the immutable accepted frontier.', {
      contextId: context.context_id,
      period: context.period_start
    });
    var fixture = {
      context: clone_(context),
      definitions: canonicalUnique_(definitions),
      membershipSnapshot: snapshot_(
        'A74_GATE3_MEMBERSHIP_' + text_(context.context_id),
        memberships,
        'membership'
      ),
      weightSnapshot: snapshot_(
        'A74_GATE3_WEIGHT_' + text_(context.context_id),
        weights,
        'weight'
      ),
      priceInputs: canonicalUnique_(priceInputs),
      coverageRules: [{ coverage_rule_id: 'DEFAULT_COMPLETE_ONLY', allow_partial: false }],
      baseInputs: [],
      frontierPeriods: periods,
      sourceCategoryId: sourceCategoryId,
      acceptedRowKeys: uniqueSorted_(acceptedRowKeys)
    };
    fixture.fingerprint = hash_({
      context: fixture.context,
      definitions: fixture.definitions,
      membershipSnapshot: fixture.membershipSnapshot,
      weightSnapshot: fixture.weightSnapshot,
      priceInputs: fixture.priceInputs,
      frontierPeriods: fixture.frontierPeriods,
      acceptedRowKeys: fixture.acceptedRowKeys
    });
    return fixture;
  }

  function buildRuntimeContext_() {
    var resources = sourceResources_();
    var goldenStatus = AKORT.Alpha72GoldenAcceptance.status();
    var contexts = clone_(AKORT.Alpha72GoldenAcceptance.Test.fixtureContexts || []);
    assert_(contexts.length === 2, 'ALPHA74_GATE3_FIXTURE_CONTEXTS_INVALID', 'Gate 3 requires the accepted weekly and monthly golden contexts.', {
      count: contexts.length
    });
    var baseline = SpreadsheetApp.openById(resources.baselineSpreadsheetId);
    assert_(baseline.getName() === goldenStatus.baseline.name, 'ALPHA74_GATE3_BASELINE_IDENTITY_MISMATCH', 'Configured immutable baseline has an unexpected name.', {
      actual: baseline.getName(),
      expected: goldenStatus.baseline.name
    });
    var dwh = SpreadsheetApp.openById(resources.dwhSpreadsheetId);
    var accepted = readAcceptedRows_(baseline, contexts);
    var weightRows = readWeightRows_(dwh);
    var fixtures = contexts.map(function (context) {
      var key = contextKey_(
        context.dataset_code,
        context.frequency,
        context.value_type,
        context.index_type,
        context.period_start
      );
      var data = accepted.retained[key];
      assert_(data && data.category_rows.length && data.aggregate_rows.length, 'ALPHA74_GATE3_ACCEPTED_FIXTURE_MISSING', 'Accepted runtime fixture is incomplete.', {
        contextId: context.context_id
      });
      return fixtureFor_(data, weightRows, accepted.frontierPeriods);
    });
    var runtime = {
      mode: 'IN_MEMORY_ACCEPTANCE_ONLY',
      acceptedSource: {
        baselineName: goldenStatus.baseline.name,
        rows: goldenStatus.baseline.rows,
        columns: goldenStatus.baseline.columns,
        dataHash: goldenStatus.baseline.data_hash,
        fingerprint: goldenStatus.baseline.fingerprint,
        weightSheet: WEIGHTS_SHEET
      },
      fixtures: fixtures,
      productionSettingsChanged: false
    };
    runtime.fingerprint = hash_(runtime);
    return runtime;
  }

  function settingValues_(dwh) {
    var sheet = dwh.getSheetByName(SETTINGS_SHEET);
    assert_(sheet, 'ALPHA74_GATE3_SETTINGS_MISSING', 'SYSTEM_SETTINGS is missing.');
    var values = sheet.getDataRange().getValues();
    var index = requireHeaders_(values[0], ['setting_key', 'setting_value'], SETTINGS_SHEET);
    var out = {};
    values.slice(1).forEach(function (row) {
      var key = text_(row[index.setting_key]);
      if (key) out[key] = text_(row[index.setting_value]).toUpperCase();
    });
    return out;
  }

  function assertFlagsDisabled_(settings) {
    REQUIRED_SETTINGS.forEach(function (key) {
      assert_(settings[key] === 'FALSE', 'ALPHA74_GATE3_FEATURE_FLAG_ENABLED', 'Gate 3 requires both aggregate feature flags to remain FALSE.', {
        setting: key,
        actual: settings[key]
      });
    });
  }

  function dataPlaneSnapshot_() {
    var resources = sourceResources_();
    var dwh = SpreadsheetApp.openById(resources.dwhSpreadsheetId);
    var settings = settingValues_(dwh);
    assertFlagsDisabled_(settings);
    var stage = dwh.getSheetByName(STAGE_SHEET);
    var impact = dwh.getSheetByName(IMPACT_SHEET);
    assert_(stage && impact, 'ALPHA74_GATE3_SERVICE_TABLE_MISSING', 'Gate 3 service tables are missing.');
    var scan = AKORT.AggregateIntegration.readOnlyContractScan();
    assert_(scan && scan.ok === true, 'ALPHA74_GATE3_CONTRACT_SCAN_FAILED', 'Gate 3 contract scan failed.', {
      result: scan
    });
    return {
      targetRows: scan.data.rows,
      targetColumns: scan.data.columns,
      logicalRows: scan.data.logicalRows,
      targetFingerprint: scan.data.fingerprint,
      duplicateLogicalRows: scan.data.duplicateLogicalRows.length,
      latestFailures: scan.data.latestFailures.length,
      futureRows: scan.data.futureRows.length,
      aggregateStageLastRow: stage.getLastRow(),
      publishImpactLastRow: impact.getLastRow(),
      featureFlags: {
        execution: settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED,
        regularPipeline: settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED
      }
    };
  }

  function assertDataPlaneUnchanged_(before, after) {
    var fields = [
      'targetRows', 'targetColumns', 'logicalRows', 'targetFingerprint',
      'duplicateLogicalRows', 'latestFailures', 'futureRows',
      'aggregateStageLastRow', 'publishImpactLastRow'
    ];
    fields.forEach(function (field) {
      assert_(stableStringify_(before[field]) === stableStringify_(after[field]), 'ALPHA74_GATE3_DATA_PLANE_CHANGED', 'Gate 3 changed a protected data-plane invariant.', {
        field: field,
        before: before[field],
        after: after[field]
      });
    });
    assertFlagsDisabled_({
      PUBLISH_AGGREGATE_EXECUTION_ENABLED: after.featureFlags.execution,
      PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: after.featureFlags.regularPipeline
    });
    return true;
  }

  function frontierFor_(fixture, scenario) {
    var sourcePeriod = periodKey_(fixture.context.frequency, fixture.context.period_start);
    var periods = scenario === SCENARIOS.NEW_PERIOD
      ? [sourcePeriod]
      : fixture.frontierPeriods.slice();
    var rows = periods.map(function (period) {
      return {
        frequency: fixture.context.frequency,
        dataset_code: fixture.context.dataset_code,
        source_series_scope: 'ALL',
        period_start: period
      };
    });
    var id = ['A74_GATE3_FRONTIER', scenario, fixture.context.context_id].join('_');
    return AKORT.AggregateContract.buildFrontier(id, rows);
  }

  function buildPlannerRequest_(fixture, scenario) {
    assert_(SCENARIOS[scenario] === scenario, 'ALPHA74_GATE3_SCENARIO_INVALID', 'Unsupported Gate 3 scenario.', {
      scenario: scenario
    });
    var frontier = frontierFor_(fixture, scenario);
    var operationId = ['A74_GATE3', scenario, fixture.context.context_id].join('_');
    var loadId = ['A74_GATE3_LOAD', scenario, fixture.context.context_id].join('_');
    var impact = {
      impact_id: ['A74_GATE3_IMPACT', scenario, fixture.context.context_id].join('_'),
      load_id: loadId,
      operation_id: operationId,
      reason_code: scenario,
      source_dataset_code: fixture.context.dataset_code,
      source_series_id: ['A74_GATE3_SOURCE', fixture.context.context_id].join('_'),
      source_category_id: fixture.sourceCategoryId,
      source_period: fixture.context.period_start,
      frequency: fixture.context.frequency,
      source_value_type: fixture.context.value_type,
      source_series_scope: 'ALL',
      weight_snapshot_id: fixture.weightSnapshot.snapshot_id,
      membership_snapshot_id: fixture.membershipSnapshot.snapshot_id,
      created_at: '2026-07-27T00:00:00.000Z'
    };
    var request = {
      plan_id: ['A74_GATE3_PLAN', scenario, fixture.context.context_id].join('_'),
      source_impacts: [impact],
      definitions: clone_(fixture.definitions),
      frontier: frontier,
      frontier_snapshot_id: frontier.snapshot_id,
      frontier_hash: frontier.hash,
      weight_snapshot: clone_(fixture.weightSnapshot),
      membership_snapshot: clone_(fixture.membershipSnapshot),
      price_inputs: clone_(fixture.priceInputs),
      coverage_rules: clone_(fixture.coverageRules),
      base_inputs: clone_(fixture.baseInputs),
      execute_calculator: false,
      latest_frontier: { rows: [], excluded_row_keys: [] }
    };
    if (scenario === SCENARIOS.REVERSAL) {
      request.has_current_effect = true;
      request.current_effect_evidence = {
        evidence_type: 'IMMUTABLE_ACCEPTED_BASELINE_FIXTURE',
        context_id: fixture.context.context_id,
        accepted_row_keys: fixture.acceptedRowKeys.slice(),
        fixture_fingerprint: fixture.fingerprint
      };
      request.current_effect_row_keys = fixture.acceptedRowKeys.slice();
      request.previous_price_inputs = clone_(fixture.priceInputs);
      request.previous_base_inputs = clone_(fixture.baseInputs);
    }
    return request;
  }

  function validatePlan_(plan, fixture, scenario) {
    assert_(plan && plan.ok === true, 'ALPHA74_GATE3_PLAN_FAILED', 'Frozen planner rejected a Gate 3 fixture.', {
      scenario: scenario,
      contextId: fixture.context.context_id,
      plan: plan
    });
    var items = scenario === SCENARIOS.REVERSAL
      ? (plan.reversal_items || [])
      : (plan.revision_items || []);
    var planned = items.filter(function (item) { return item.status === 'PLANNED'; });
    var blocked = items.filter(function (item) { return item.status !== 'PLANNED'; });
    var errors = (plan.diagnostics || []).filter(function (item) { return item.severity === 'ERROR'; });
    assert_(!errors.length, 'ALPHA74_GATE3_PLAN_DIAGNOSTIC_ERROR', 'Gate 3 plan contains error diagnostics.', {
      scenario: scenario,
      contextId: fixture.context.context_id,
      diagnostics: errors
    });
    assert_(planned.length >= fixture.definitions.length, 'ALPHA74_GATE3_PLAN_INCOMPLETE', 'Gate 3 plan omitted the source period.', {
      scenario: scenario,
      contextId: fixture.context.context_id,
      planned: planned.length,
      definitions: fixture.definitions.length
    });
    if (scenario === SCENARIOS.NEW_PERIOD) {
      assert_(blocked.length >= fixture.definitions.length, 'ALPHA74_GATE3_FUTURE_GUARD_MISSING', 'New-period plan did not audit-block the absent future dependency.', {
        contextId: fixture.context.context_id,
        blocked: blocked.length,
        definitions: fixture.definitions.length
      });
    } else {
      assert_(planned.length >= fixture.definitions.length * 2, 'ALPHA74_GATE3_DEPENDENCY_CLOSURE_INCOMPLETE', 'Revision/reversal plan omitted the next accepted dependent period.', {
        scenario: scenario,
        contextId: fixture.context.context_id,
        planned: planned.length,
        definitions: fixture.definitions.length
      });
    }
    assert_((plan.planned_rows || []).length === 0, 'ALPHA74_GATE3_UNEXPECTED_CALCULATION', 'Read-only plan unexpectedly calculated rows.', {
      scenario: scenario,
      contextId: fixture.context.context_id
    });
    return {
      contextId: fixture.context.context_id,
      datasetCode: fixture.context.dataset_code,
      frequency: fixture.context.frequency,
      sourcePeriod: periodKey_(fixture.context.frequency, fixture.context.period_start),
      definitions: fixture.definitions.length,
      membershipRows: fixture.membershipSnapshot.rule_rows.length,
      weightRows: fixture.weightSnapshot.rule_rows.length,
      frontierPeriods: scenario === SCENARIOS.NEW_PERIOD ? 1 : fixture.frontierPeriods.length,
      status: plan.status,
      plannedItems: planned.length,
      blockedItems: blocked.length,
      calculatorBatches: plan.calculator_batches.length,
      plannedRows: plan.planned_rows.length,
      diagnosticCodes: uniqueSorted_((plan.diagnostics || []).map(function (item) { return item.code; })),
      planId: plan.plan_id,
      planFingerprint: plan.fingerprint,
      inputFingerprint: plan.input_fingerprint || '',
      physicalWrites: false
    };
  }

  function runFixtureScenario_(fixture, scenario) {
    var request = buildPlannerRequest_(fixture, scenario);
    var mode = scenario === SCENARIOS.REVERSAL ? 'REVERSAL' : 'REVISION';
    var result = AKORT.AggregateIntegration.planRequestReadOnly(request, mode);
    assert_(result && result.ok === true, 'ALPHA74_GATE3_INTEGRATION_PLAN_FAILED', 'Alpha.7.4 integration wrapper rejected a Gate 3 fixture.', {
      scenario: scenario,
      contextId: fixture.context.context_id,
      result: result
    });
    return validatePlan_(result.data.plan, fixture, scenario);
  }

  function runScenario_(runtime, scenario) {
    var results = runtime.fixtures.map(function (fixture) {
      return runFixtureScenario_(fixture, scenario);
    });
    return {
      scenario: scenario,
      plannerMode: scenario === SCENARIOS.REVERSAL ? 'REVERSAL' : 'REVISION',
      status: 'SUCCESS',
      fixtures: results,
      fixtureCount: results.length,
      plannedItems: results.reduce(function (sum, item) { return sum + item.plannedItems; }, 0),
      blockedItems: results.reduce(function (sum, item) { return sum + item.blockedItems; }, 0),
      calculatorBatches: results.reduce(function (sum, item) { return sum + item.calculatorBatches; }, 0),
      physicalWrites: false
    };
  }

  function runtimeSummary_(runtime) {
    return {
      mode: runtime.mode,
      fingerprint: runtime.fingerprint,
      acceptedSource: clone_(runtime.acceptedSource),
      fixtureCount: runtime.fixtures.length,
      fixtures: runtime.fixtures.map(function (fixture) {
        return {
          contextId: fixture.context.context_id,
          datasetCode: fixture.context.dataset_code,
          frequency: fixture.context.frequency,
          definitions: fixture.definitions.length,
          membershipRows: fixture.membershipSnapshot.rule_rows.length,
          weightRows: fixture.weightSnapshot.rule_rows.length,
          priceInputs: fixture.priceInputs.length,
          frontierPeriods: fixture.frontierPeriods.length,
          fingerprint: fixture.fingerprint
        };
      }),
      productionSettingsChanged: false,
      physicalWrites: false
    };
  }

  function runOne_(scenario) {
    return AKORT.Core.safeRun('ALPHA74_GATE3_' + scenario, function () {
      AKORT.EnvironmentGuard.assertDev();
      var before = dataPlaneSnapshot_();
      var runtime = buildRuntimeContext_();
      var result = runScenario_(runtime, scenario);
      var after = dataPlaneSnapshot_();
      assertDataPlaneUnchanged_(before, after);
      return AKORT.Result.success('Alpha.7.4 Gate 3 ' + scenario + ' read-only plan passed.', {
        release: RELEASE,
        harnessVersion: VERSION,
        runtimeContext: runtimeSummary_(runtime),
        scenario: result,
        before: before,
        after: after,
        dataPlaneWrites: 0,
        evidenceFileWrites: 0,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: false });
  }

  function saveEvidence_(resources, evidence) {
    var payload = clone_(evidence);
    var canonical = JSON.stringify(stable_(payload), null, 2);
    payload.evidenceHash = hash_(canonical);
    var serialized = JSON.stringify(stable_(payload), null, 2);
    var stamp = text_(evidence.executedAt).replace(/[-:.TZ]/g, '').slice(0, 14);
    var name = 'ALPHA74_GATE3_ACCEPTANCE_' + stamp + '.json';
    var folder = DriveApp.getFolderById(resources.testResultsFolderId);
    var file = folder.createFile(name, serialized, 'application/json');
    return {
      fileId: file.getId(),
      fileName: name,
      fileUrl: file.getUrl(),
      mimeType: 'application/json',
      evidenceHash: payload.evidenceHash,
      bytes: serialized.length
    };
  }

  function runAndSaveEvidence() {
    return AKORT.Core.safeRun('ALPHA74_GATE3_ACCEPTANCE', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var resources = sourceResources_();
      var before = dataPlaneSnapshot_();
      var runtime = buildRuntimeContext_();
      var scenarios = [
        runScenario_(runtime, SCENARIOS.NEW_PERIOD),
        runScenario_(runtime, SCENARIOS.REVISION),
        runScenario_(runtime, SCENARIOS.REVERSAL)
      ];
      var after = dataPlaneSnapshot_();
      assertDataPlaneUnchanged_(before, after);
      var evidence = {
        schemaVersion: '4.0-alpha74-gate3-evidence-1',
        release: RELEASE,
        harnessVersion: VERSION,
        executionId: context.executionId,
        executedAt: AKORT.Core.now(),
        runtimeContext: runtimeSummary_(runtime),
        scenarios: scenarios,
        before: before,
        after: after,
        assertions: {
          scenariosPassed: 3,
          fixtureRunsPassed: scenarios.reduce(function (sum, item) { return sum + item.fixtureCount; }, 0),
          targetFingerprintUnchanged: before.targetFingerprint === after.targetFingerprint,
          aggregateStageUnchanged: before.aggregateStageLastRow === after.aggregateStageLastRow,
          publishImpactUnchanged: before.publishImpactLastRow === after.publishImpactLastRow,
          featureFlagsDisabled: after.featureFlags.execution === 'FALSE' && after.featureFlags.regularPipeline === 'FALSE',
          dataPlaneWrites: 0,
          physicalWrites: false
        }
      };
      var saved = saveEvidence_(resources, evidence);
      return AKORT.Result.success('Alpha.7.4 Gate 3 acceptance passed and machine-readable evidence was saved.', {
        release: RELEASE,
        harnessVersion: VERSION,
        runtimeContextFingerprint: runtime.fingerprint,
        scenarios: scenarios,
        before: before,
        after: after,
        evidence: saved,
        dataPlaneWrites: 0,
        evidenceFileWrites: 1,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: false });
  }

  function runtimeContextStatus() {
    return AKORT.Core.safeRun('ALPHA74_GATE3_RUNTIME_CONTEXT', function () {
      AKORT.EnvironmentGuard.assertDev();
      var resources = sourceResources_();
      var dwh = SpreadsheetApp.openById(resources.dwhSpreadsheetId);
      assertFlagsDisabled_(settingValues_(dwh));
      var runtime = buildRuntimeContext_();
      return AKORT.Result.success('Alpha.7.4 Gate 3 authoritative acceptance runtime context is ready.', {
        release: RELEASE,
        harnessVersion: VERSION,
        runtimeContext: runtimeSummary_(runtime),
        dataPlaneWrites: 0,
        evidenceFileWrites: 0,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: false });
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    Scenarios: SCENARIOS,
    runtimeContextStatus: runtimeContextStatus,
    runNewPeriod: function () { return runOne_(SCENARIOS.NEW_PERIOD); },
    runRevision: function () { return runOne_(SCENARIOS.REVISION); },
    runReversal: function () { return runOne_(SCENARIOS.REVERSAL); },
    runAndSaveEvidence: runAndSaveEvidence,
    Test: Object.freeze({
      clone: clone_,
      stableStringify: stableStringify_,
      hash: hash_,
      canonicalUnique: canonicalUnique_,
      buildPlannerRequest: buildPlannerRequest_,
      validatePlan: validatePlan_,
      runScenario: runScenario_,
      assertDataPlaneUnchanged: assertDataPlaneUnchanged_
    })
  });
})();
