var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 4 isolated physical/fault acceptance harness.
 *
 * The harness requires only PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE. The
 * regular pipeline must remain FALSE. Every physical write is directed to a
 * newly-created spreadsheet in the canonical DEV test-files folder; the
 * DataLens-connected DEV Publish spreadsheet is read before and after only.
 */
AKORT.Alpha74Gate4Acceptance = (function () {
  var VERSION = '4.0-alpha74-gate4-acceptance-1';
  var EVIDENCE_SCHEMA = '4.0-alpha74-gate4-evidence-1';
  var RELEASE = '4.0.0-alpha.7.4.14';
  var TARGET_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var STAGE_SHEET = 'AGGREGATE_STAGE';
  var PRIMARY_DATASET = 'AKORT_GATE4_ISOLATED';
  var UNRELATED_DATASET = 'AKORT_GATE4_UNRELATED';
  var PRIMARY_SUBJECT = 'GATE4_PRIMARY';
  var UNRELATED_SUBJECT = 'GATE4_UNRELATED';
  var PERIOD_1 = '2026-01-01';
  var PERIOD_2 = '2026-01-08';
  var TIMEOUT_PHASES = Object.freeze([
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES'
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

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function rowValues_(headers, object) {
    return headers.map(function (header) {
      var value = object && object[header];
      return value === undefined || value === null ? '' : value;
    });
  }

  function readObjects_(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = values[0].map(String);
    return values.slice(1).map(function (row, rowIndex) {
      var object = { __row: rowIndex + 2 };
      headers.forEach(function (header, column) { object[header] = row[column]; });
      return object;
    });
  }

  function appendObjects_(sheet, headers, objects) {
    if (!objects || !objects.length) return 0;
    var rows = objects.map(function (object) { return rowValues_(headers, object); });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    return rows.length;
  }

  function updateObjects_(sheet, headers, objects) {
    (objects || []).forEach(function (object) {
      sheet.getRange(object.__row, 1, 1, headers.length).setValues([rowValues_(headers, object)]);
    });
    return (objects || []).length;
  }

  function resources_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var resources = config && config.resources || {};
    [
      'publishSpreadsheetId',
      'testFilesFolderId',
      'testResultsFolderId'
    ].forEach(function (key) {
      assert_(text_(resources[key]), 'ALPHA74_GATE4_RESOURCE_MISSING', 'Gate 4 canonical resource is missing.', {
        resource: key,
        retryable: false
      });
    });
    return resources;
  }

  function flagState_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      execution: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
      regularPipeline: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED),
      rawExecution: settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED,
      rawRegularPipeline: settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED
    };
  }

  function assertGate4Flags_() {
    var flags = flagState_();
    assert_(flags.execution === true && flags.regularPipeline === false,
      'ALPHA74_GATE4_FLAGS_INVALID',
      'Gate 4 requires execution=TRUE and regularPipeline=FALSE.',
      {
        executionEnabled: flags.execution,
        regularPipelineEnabled: flags.regularPipeline,
        retryable: false
      });
    return flags;
  }

  function definition_(dataset, subject) {
    return {
      dataset_code: dataset,
      frequency: 'weekly',
      aggregate_level: 'group',
      group_id: subject,
      aggregate_subject_id: subject,
      aggregate_name: subject,
      value_type: 'price',
      index_type: 'wow',
      calculation_method: 'SUM_CONTRIBUTIONS',
      weight_rule_id: 'GATE4_WEIGHT_V1',
      membership_rule_id: 'GATE4_MEMBERSHIP_V1'
    };
  }

  function calculatedRow_(dataset, subject, period, value, publicationAllowed) {
    var definition = definition_(dataset, subject);
    var seriesKey = AKORT.AggregateContract.aggregateSeriesKey(definition);
    return {
      row_type: 'AGGREGATE_RESULT',
      calculation_id: 'GATE4_CALC',
      aggregate_series_key: seriesKey,
      aggregate_row_key: AKORT.AggregateContract.aggregateRowKey((function () {
        var copy = clone_(definition);
        copy.period_start = period;
        return copy;
      })()),
      dataset_code: dataset,
      frequency: 'weekly',
      aggregate_level: 'group',
      aggregate_subject_id: subject,
      aggregate_name: subject,
      category_id: '',
      value_type: 'price',
      index_type: 'wow',
      period_start: period,
      calculation_method: 'SUM_CONTRIBUTIONS',
      weight_rule_id: 'GATE4_WEIGHT_V1',
      membership_rule_id: 'GATE4_MEMBERSHIP_V1',
      category_value: null,
      category_change_pp: null,
      category_weight: null,
      aggregate_change_pp: value,
      contribution_to_group_change_pp: null,
      contribution_to_basket_change_pp: null,
      contribution_to_total_cpi_pp: null,
      aggregate_value: null,
      aggregate_base_value: null,
      applied_members_count: 2,
      applied_weight_sum: 1,
      publication_allowed: publicationAllowed !== false
    };
  }

  function publishRow_(dataset, subject, period, value) {
    var row = AKORT.AggregateIntegration.Test.projectPublishRow(
      calculatedRow_(dataset, subject, period, value, true),
      {
        sourceName: 'AKORT Gate 4 isolated acceptance',
        aggregateName: subject,
        productGroup: subject,
        weightSource: 'GATE4_WEIGHT_V1',
        periodLabel: period
      }
    );
    row.is_latest_period = 1;
    return row;
  }

  function stageRecord_(identity, period, value, publicationAllowed) {
    return AKORT.AggregateIntegration.Test.buildStageRecord(
      calculatedRow_(PRIMARY_DATASET, PRIMARY_SUBJECT, period, value, publicationAllowed),
      {
        operationId: identity.operationId,
        loadId: identity.loadId,
        planId: identity.planId,
        planFingerprint: identity.planFingerprint,
        calculationId: 'GATE4_CALC',
        sourceName: 'AKORT Gate 4 isolated acceptance',
        aggregateName: PRIMARY_SUBJECT,
        productGroup: PRIMARY_SUBJECT,
        weightSource: 'GATE4_WEIGHT_V1',
        periodLabel: period
      }
    );
  }

  function createSandbox_(executionId, resources) {
    var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd_HHmmss');
    var spreadsheet = SpreadsheetApp.create('AKORT_ALPHA74_GATE4_SANDBOX_' + stamp + '_' + executionId, 50, AKORT.AggregateContract.Headers.length);
    var file = DriveApp.getFileById(spreadsheet.getId());
    file.moveTo(DriveApp.getFolderById(resources.testFilesFolderId));
    var target = spreadsheet.getSheets()[0];
    target.setName(TARGET_SHEET);
    target.getRange(1, 1, 1, AKORT.AggregateContract.Headers.length)
      .setValues([AKORT.AggregateContract.Headers.slice()]);
    target.setFrozenRows(1);
    appendObjects_(target, AKORT.AggregateContract.Headers.slice(), [
      publishRow_(PRIMARY_DATASET, PRIMARY_SUBJECT, PERIOD_1, 1),
      publishRow_(UNRELATED_DATASET, UNRELATED_SUBJECT, PERIOD_1, 100)
    ]);
    var stage = spreadsheet.insertSheet(STAGE_SHEET);
    stage.getRange(1, 1, 1, AKORT.AggregateIntegration.StageHeaders.length)
      .setValues([AKORT.AggregateIntegration.StageHeaders.slice()]);
    stage.setFrozenRows(1);
    SpreadsheetApp.flush();
    return {
      spreadsheet: spreadsheet,
      file: file,
      target: target,
      stage: stage
    };
  }

  function identity_(executionId, label) {
    var normalized = text_(label).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    return {
      operationId: 'GATE4_' + executionId + '_' + normalized,
      loadId: 'GATE4_LOAD_' + normalized,
      planId: 'GATE4_PLAN_' + normalized,
      planFingerprint: hash_([executionId, normalized, 'PLAN'])
    };
  }

  function stageRowsFor_(sheet, identity, includeSpecial) {
    return readObjects_(sheet).filter(function (row) {
      if (text_(row.operation_id) !== text_(identity.operationId) ||
          text_(row.load_id) !== text_(identity.loadId) ||
          text_(row.plan_id) !== text_(identity.planId) ||
          text_(row.plan_fingerprint) !== text_(identity.planFingerprint)) return false;
      return includeSpecial === true || text_(row.aggregate_series_key).indexOf('__') !== 0;
    });
  }

  function persistIntent_(sheet, identity, intent) {
    var existing = readIntent_(sheet, identity);
    if (existing) {
      assert_(text_(existing.fingerprint) === text_(intent.fingerprint),
        'ALPHA74_GATE4_INTENT_CONFLICT',
        'Gate 4 durable intent conflicts with the prior intent.',
        { retryable: false });
      return existing;
    }
    var record = {
      operation_id: identity.operationId,
      load_id: identity.loadId,
      plan_id: identity.planId,
      plan_fingerprint: identity.planFingerprint,
      calculation_id: 'PUBLISH_INTENT',
      aggregate_series_key: '__PUBLISH_INTENT__',
      aggregate_row_key: '__PUBLISH_INTENT__|000001',
      period_start: '',
      action: 'PUBLISH_INTENT',
      row_payload_json: JSON.stringify(intent),
      row_fingerprint: hash_(intent),
      expected_target_fingerprint: intent.afterFingerprint,
      stage_status: 'INTENT_PERSISTED',
      created_at: AKORT.Core.now(),
      verified_at: '',
      release_version: RELEASE
    };
    appendObjects_(sheet, AKORT.AggregateIntegration.StageHeaders.slice(), [record]);
    return intent;
  }

  function readIntent_(sheet, identity) {
    var rows = stageRowsFor_(sheet, identity, true).filter(function (row) {
      return text_(row.action) === 'PUBLISH_INTENT';
    });
    if (!rows.length) return null;
    assert_(rows.length === 1, 'ALPHA74_GATE4_INTENT_DUPLICATE', 'Gate 4 durable intent is duplicated.', {
      retryable: false
    });
    var intent = JSON.parse(String(rows[0].row_payload_json || '{}'));
    assert_(hash_(intent) === text_(rows[0].row_fingerprint),
      'ALPHA74_GATE4_INTENT_CHANGED',
      'Gate 4 durable intent fingerprint changed.',
      { retryable: false });
    return intent;
  }

  function updateStage_(sheet, identity, mutator) {
    var rows = stageRowsFor_(sheet, identity, true);
    rows.forEach(function (row) { mutator(row); });
    return updateObjects_(sheet, AKORT.AggregateIntegration.StageHeaders.slice(), rows);
  }

  function sandboxAdapter_(sandbox, identity, controls) {
    controls = controls || {};
    var metrics = {
      atomicApiCalls: 0,
      atomicResults: [],
      injectedErrors: [],
      reconciliationRecords: 0,
      finalized: 0
    };
    return {
      metrics: metrics,
      readCalculatedRows: function () {
        return stageRowsFor_(sandbox.stage, identity, false);
      },
      updateStageStatus: function (_identity, status, fingerprint) {
        return updateStage_(sandbox.stage, identity, function (row) {
          if (text_(row.aggregate_series_key).indexOf('__') === 0) return;
          row.stage_status = status;
          if (fingerprint) row.expected_target_fingerprint = fingerprint;
          if (status === 'VERIFIED') row.verified_at = AKORT.Core.now();
        });
      },
      updateStageExpectedFingerprint: function (_identity, fingerprint) {
        return updateStage_(sandbox.stage, identity, function (row) {
          if (text_(row.aggregate_series_key).indexOf('__') !== 0) {
            row.expected_target_fingerprint = fingerprint;
          }
        });
      },
      persistPublishIntent: function (_identity, intent) {
        return persistIntent_(sandbox.stage, identity, intent);
      },
      readPublishIntent: function () {
        return readIntent_(sandbox.stage, identity);
      },
      readTargetRows: function () {
        return readObjects_(sandbox.target);
      },
      atomicReplace: function (replacement) {
        var appliedReplacement = replacement;
        if (controls.thirdStateOnce === true) {
          controls.thirdStateOnce = false;
          appliedReplacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(
            readObjects_(sandbox.target),
            [stageRecord_(identity, PERIOD_2, 999, true)]
          );
        }
        var result = AKORT.AggregateIntegration.Gate4.atomicReplaceIsolated(
          sandbox.spreadsheet,
          appliedReplacement
        );
        metrics.atomicApiCalls += Number(result.apiCalls || 0);
        metrics.atomicResults.push(clone_(result));
        if (controls.lostResponseOnce === true || appliedReplacement !== replacement) {
          controls.lostResponseOnce = false;
          var injected = error_(
            'ALPHA74_GATE4_INJECTED_LOST_RESPONSE',
            'Gate 4 injected a lost response after the isolated atomic commit.',
            { retryable: true, physicalCommitCompleted: true }
          );
          metrics.injectedErrors.push(injected.code);
          throw injected;
        }
        return result;
      },
      recordReconciliation: function () {
        metrics.reconciliationRecords += 1;
      },
      finalize: function () {
        metrics.finalized += 1;
      }
    };
  }

  function initialCheckpoint_(identity, validation) {
    return {
      aggregate: {
        schemaVersion: AKORT.AggregateIntegration.StageSchemaVersion,
        status: 'STAGED',
        loadId: identity.loadId,
        planId: identity.planId,
        planFingerprint: identity.planFingerprint,
        runtimeSettings: {
          executionEnabled: true,
          regularPipelineEnabled: false,
          calculationGroupsPerStep: 1,
          atomicMaxRows: 100,
          atomicMaxCells: 2900,
          atomicMaxRequests: 20,
          artifactChunkChars: 30000,
          artifactChunksPerStep: 25
        },
        expectedStageRows: validation.rowCount,
        affectedSeriesKeys: validation.seriesKeys,
        stageFingerprint: validation.stageFingerprint,
        calculationCursor: 0,
        stagingCursor: 0,
        batchNo: 0
      }
    };
  }

  function executeScenario_(sandbox, executionId, specification) {
    var identity = identity_(executionId, specification.id);
    var record = stageRecord_(
      identity,
      specification.period,
      specification.value,
      specification.publicationAllowed
    );
    appendObjects_(sandbox.stage, AKORT.AggregateIntegration.StageHeaders.slice(), [record]);
    var staged = stageRowsFor_(sandbox.stage, identity, false);
    var validation = AKORT.AggregateIntegration.Test.validateStageRows(staged, identity);
    var beforeRows = readObjects_(sandbox.target);
    var beforeReplacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(beforeRows, staged);
    var adapter = sandboxAdapter_(sandbox, identity, {
      lostResponseOnce: specification.lostResponse === true,
      thirdStateOnce: specification.thirdState === true
    });
    var context = {
      operation: { operation_id: identity.operationId },
      checkpoint: initialCheckpoint_(identity, validation)
    };
    var options = {
      adapter: adapter,
      loadId: identity.loadId,
      mode: specification.mode || 'REVISION'
    };
    var firstError = null;
    var updateResult = null;
    try {
      updateResult = AKORT.AggregateIntegration.execute('UPDATING_AGGREGATES', context, options);
    } catch (caught) {
      firstError = {
        code: text_(caught.code || 'UNEXPECTED_ERROR'),
        message: text_(caught.message || caught),
        details: clone_(caught.details || null)
      };
    }

    if (specification.lostResponse === true) {
      assert_(firstError && firstError.code === 'ALPHA74_GATE4_INJECTED_LOST_RESPONSE',
        'ALPHA74_GATE4_LOST_RESPONSE_NOT_INJECTED',
        'Lost-response scenario did not stop after the isolated physical commit.',
        { firstError: firstError });
      updateResult = AKORT.AggregateIntegration.execute('UPDATING_AGGREGATES', context, options);
      assert_(updateResult.recoveryState === 'AFTER' &&
        updateResult.publishRecovery === 'RECOVERED_WITHOUT_REWRITE',
        'ALPHA74_GATE4_LOST_RESPONSE_RECOVERY_FAILED',
        'Lost-response retry did not recover from the expected after-state.',
        { updateResult: updateResult });
    } else if (specification.thirdState === true) {
      assert_(firstError && firstError.code === 'ALPHA74_GATE4_INJECTED_LOST_RESPONSE',
        'ALPHA74_GATE4_THIRD_STATE_NOT_INJECTED',
        'Third-state scenario did not persist its original intent before the injected external state.',
        { firstError: firstError });
      var reviewError = null;
      try {
        AKORT.AggregateIntegration.execute('UPDATING_AGGREGATES', context, options);
      } catch (caughtReview) {
        reviewError = {
          code: text_(caughtReview.code || 'UNEXPECTED_ERROR'),
          message: text_(caughtReview.message || caughtReview),
          details: clone_(caughtReview.details || null)
        };
      }
      assert_(reviewError && reviewError.code === 'AGGREGATE_PUBLISH_THIRD_STATE',
        'ALPHA74_GATE4_THIRD_STATE_NOT_CLOSED',
        'Third-state retry did not fail closed.',
        { reviewError: reviewError });
      assert_(adapter.metrics.atomicApiCalls === 1,
        'ALPHA74_GATE4_THIRD_STATE_OVERWRITTEN',
        'Third-state retry performed an automatic overwrite.',
        { atomicApiCalls: adapter.metrics.atomicApiCalls });
      var thirdRows = readObjects_(sandbox.target);
      var thirdReplacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(thirdRows, staged);
      assert_(thirdReplacement.unrelatedFingerprint === beforeReplacement.unrelatedFingerprint,
        'ALPHA74_GATE4_UNRELATED_CHANGED',
        'Third-state injection changed unrelated rows.',
        {});
      return {
        id: specification.id,
        status: 'PASS_FAIL_CLOSED',
        expectedAction: specification.expectedAction,
        firstError: firstError,
        reviewError: reviewError,
        atomicApiCalls: adapter.metrics.atomicApiCalls,
        automaticOverwriteCalls: 0,
        unrelatedFingerprintUnchanged: true,
        physicalWrites: true
      };
    } else {
      assert_(!firstError, 'ALPHA74_GATE4_SCENARIO_FAILED', 'Gate 4 physical scenario failed.', {
        scenario: specification.id,
        firstError: firstError
      });
    }

    var latest = AKORT.AggregateIntegration.execute('UPDATING_AGGREGATE_LATEST', context, options);
    var reconciliation = AKORT.AggregateIntegration.execute('RECONCILING_AGGREGATES', context, options);
    var finalized = AKORT.AggregateIntegration.execute('FINALIZING', context, options);
    assert_(latest.ok === true && reconciliation.ok === true && finalized.status === 'SUCCESS',
      'ALPHA74_GATE4_POST_WRITE_VERIFICATION_FAILED',
      'Gate 4 scenario did not pass latest, reconciliation and finalization.',
      {
        scenario: specification.id,
        latest: latest,
        reconciliation: reconciliation,
        finalized: finalized
      });
    assert_(reconciliation.unrelatedFingerprint === beforeReplacement.unrelatedFingerprint,
      'ALPHA74_GATE4_UNRELATED_CHANGED',
      'Gate 4 scenario changed unrelated rows.',
      { scenario: specification.id });
    var afterRows = readObjects_(sandbox.target);
    var afterReplacement = AKORT.AggregateIntegration.Test.buildSeriesReplacement(afterRows, staged);
    var beforeCount = beforeReplacement.beforeRows.length;
    var afterCount = afterReplacement.beforeRows.length;
    if (specification.expectedAction === 'INSERT') {
      assert_(afterCount === beforeCount + 1,
        'ALPHA74_GATE4_INSERT_COUNT_INVALID',
        'INSERT scenario did not add exactly one logical period.',
        { beforeCount: beforeCount, afterCount: afterCount });
    } else if (specification.expectedAction === 'DELETE') {
      assert_(afterCount === beforeCount - 1,
        'ALPHA74_GATE4_DELETE_COUNT_INVALID',
        'DELETE scenario did not remove exactly one logical period.',
        { beforeCount: beforeCount, afterCount: afterCount });
    } else if (specification.expectedAction === 'UPDATE') {
      assert_(afterCount === beforeCount &&
        beforeReplacement.beforeFingerprint !== afterReplacement.beforeFingerprint,
        'ALPHA74_GATE4_UPDATE_INVALID',
        'UPDATE scenario did not replace one existing logical period.',
        {
          beforeCount: beforeCount,
          afterCount: afterCount,
          beforeFingerprint: beforeReplacement.beforeFingerprint,
          afterFingerprint: afterReplacement.beforeFingerprint
        });
    }

    if (specification.expectedAction === 'NOOP') {
      assert_(adapter.metrics.atomicApiCalls === 0 &&
        updateResult.publishRecovery === 'RECOVERED_WITHOUT_REWRITE' &&
        beforeReplacement.beforeFingerprint === afterReplacement.beforeFingerprint,
        'ALPHA74_GATE4_NOOP_WROTE',
        'NOOP scenario performed a physical write.',
        { metrics: adapter.metrics, updateResult: updateResult });
    } else {
      assert_(adapter.metrics.atomicApiCalls === 1,
        'ALPHA74_GATE4_ATOMIC_CALL_COUNT',
        'Mutating Gate 4 scenario must use exactly one atomic batchUpdate call.',
        { scenario: specification.id, metrics: adapter.metrics });
    }

    return {
      id: specification.id,
      status: 'PASS',
      expectedAction: specification.expectedAction,
      mode: specification.mode || 'REVISION',
      recoveryState: updateResult.recoveryState,
      publishRecovery: updateResult.publishRecovery,
      replacementRows: updateResult.replacementRows,
      logicalRowsBefore: beforeCount,
      logicalRowsAfter: afterCount,
      atomicApiCalls: adapter.metrics.atomicApiCalls,
      atomicResults: adapter.metrics.atomicResults,
      injectedErrors: adapter.metrics.injectedErrors,
      latest: latest,
      unrelatedFingerprintUnchanged: true,
      targetAfterFingerprint: reconciliation.affectedFingerprint,
      physicalWrites: adapter.metrics.atomicApiCalls > 0
    };
  }

  function memoryFixture_() {
    var impact = {
      impact_id: 'GATE4_TIMEOUT_IMPACT',
      operation_id: 'GATE4_TIMEOUT_OPERATION',
      load_id: 'GATE4_TIMEOUT_LOAD',
      frequency: 'weekly',
      dataset_code: PRIMARY_DATASET,
      category_id: 'GATE4_CATEGORY',
      value_type: 'price',
      source_period: PERIOD_2,
      aggregate_combos_json: JSON.stringify([{
        frequency: 'weekly',
        datasetCode: PRIMARY_DATASET,
        period: PERIOD_2,
        valueType: 'price',
        indexType: 'wow'
      }]),
      series_ids_json: '["GATE4_CATEGORY"]',
      affected_periods_json: '["' + PERIOD_2 + '"]'
    };
    var artifact = null;
    var stageRows = [];
    var intent = null;
    var targetRows = [publishRow_(UNRELATED_DATASET, UNRELATED_SUBJECT, PERIOD_1, 100)];
    var reconciliations = {};
    var atomicCalls = 0;
    var plan = {
      ok: true,
      plan_id: 'GATE4_TIMEOUT_PLAN',
      fingerprint: 'GATE4_TIMEOUT_PLAN_FP',
      calculator_shared_input: {
        price_inputs: [],
        weight_snapshot: { snapshot_id: 'GATE4_WEIGHT_SNAPSHOT', hash: 'GATE4_WEIGHT_HASH', rule_rows: [] },
        membership_snapshot: { snapshot_id: 'GATE4_MEMBERSHIP_SNAPSHOT', hash: 'GATE4_MEMBERSHIP_HASH', rule_rows: [] },
        coverage_rules: [],
        base_inputs: [],
        options: {}
      },
      calculator_batches: [{
        calculation_id: 'GATE4_TIMEOUT_EMPTY_CALC',
        impact_items: [],
        aggregate_definitions: []
      }]
    };
    var adapter = {
      runtimeSettings: function () {
        return {
          PUBLISH_AGGREGATE_EXECUTION_ENABLED: true,
          PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: true,
          PUBLISH_AGGREGATE_CALCULATION_GROUPS_PER_STEP: 1,
          PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS: 100,
          PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS: 2900,
          PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS: 20,
          PUBLISH_AGGREGATE_ARTIFACT_CHUNK_CHARS: 30000,
          PUBLISH_AGGREGATE_ARTIFACT_CHUNKS_PER_STEP: 25
        };
      },
      readImpactRecords: function () { return [clone_(impact)]; },
      materializeArtifact: function () { return { plan: clone_(plan) }; },
      persistInputArtifact: function (_identity, value) {
        if (!artifact) artifact = clone_(value);
        assert_(hash_(artifact) === hash_(value),
          'ALPHA74_GATE4_TIMEOUT_ARTIFACT_CHANGED',
          'Timeout retry changed the immutable input artifact.',
          {});
        return { complete: true, persistedChunks: 1, totalChunks: 1 };
      },
      readInputArtifact: function () { return clone_(artifact); },
      upsertCalculatedRows: function (_identity, records) {
        (records || []).forEach(function (record) {
          var exists = stageRows.some(function (row) {
            return text_(row.aggregate_row_key) === text_(record.aggregate_row_key);
          });
          if (!exists) stageRows.push(clone_(record));
        });
        return { total: stageRows.length };
      },
      readCalculatedRows: function () { return clone_(stageRows); },
      updateStageStatus: function () {},
      updateStageExpectedFingerprint: function () {},
      persistPublishIntent: function (_identity, value) {
        if (!intent) intent = clone_(value);
        assert_(hash_(intent) === hash_(value),
          'ALPHA74_GATE4_TIMEOUT_INTENT_CHANGED',
          'Timeout retry changed the durable publish intent.',
          {});
        return clone_(intent);
      },
      readPublishIntent: function () { return clone_(intent); },
      readTargetRows: function () { return clone_(targetRows); },
      atomicReplace: function (replacement) {
        atomicCalls += 1;
        var affected = {};
        (replacement.affectedSeriesKeys || []).forEach(function (key) { affected[key] = true; });
        var signatures = {};
        (stageRows || []).forEach(function (row) {
          var payload = JSON.parse(String(row.row_payload_json || '{}'));
          signatures[AKORT.AggregateIntegration.Test.publicSignature(payload)] = row.aggregate_series_key;
        });
        targetRows = targetRows.filter(function (row) {
          return !affected[signatures[AKORT.AggregateIntegration.Test.publicSignature(row)] || ''];
        }).concat(clone_(replacement.replacementRows));
      },
      recordReconciliation: function (_identity, state) {
        reconciliations[text_(state.targetAfterFingerprint)] = true;
      },
      finalize: function () {}
    };
    var context = {
      operation: { operation_id: 'GATE4_TIMEOUT_OPERATION' },
      checkpoint: {
        aggregate: {
          schemaVersion: AKORT.AggregateIntegration.StageSchemaVersion,
          status: 'NOT_STARTED',
          calculationCursor: 0,
          stagingCursor: 0,
          batchNo: 0
        }
      }
    };
    return {
      adapter: adapter,
      context: context,
      options: {
        adapter: adapter,
        loadId: 'GATE4_TIMEOUT_LOAD',
        mode: 'REVISION'
      },
      durable: function () {
        return {
          artifact: clone_(artifact),
          stageRows: clone_(stageRows),
          intent: clone_(intent),
          targetRows: clone_(targetRows),
          reconciliations: clone_(reconciliations),
          atomicCalls: atomicCalls
        };
      }
    };
  }

  function prepareMemoryPhase_(phase) {
    var fixture = memoryFixture_();
    var targetIndex = TIMEOUT_PHASES.indexOf(phase);
    assert_(targetIndex >= 0, 'ALPHA74_GATE4_TIMEOUT_PHASE_INVALID', 'Unknown timeout phase.', {
      phase: phase
    });
    for (var index = 0; index < targetIndex; index += 1) {
      AKORT.AggregateIntegration.execute(TIMEOUT_PHASES[index], fixture.context, fixture.options);
    }
    return fixture;
  }

  function runTimeoutMatrix_() {
    return TIMEOUT_PHASES.map(function (phase) {
      var beforeFixture = prepareMemoryPhase_(phase);
      var beforeDurable = hash_(beforeFixture.durable());
      var beforeResult = AKORT.AggregateIntegration.execute(phase, beforeFixture.context, beforeFixture.options);
      assert_(beforeDurable === hash_(prepareMemoryPhase_(phase).durable()),
        'ALPHA74_GATE4_TIMEOUT_BEFORE_MUTATED',
        'Injected timeout before phase changed durable state.',
        { phase: phase });

      var afterFixture = prepareMemoryPhase_(phase);
      var checkpointBefore = clone_(afterFixture.context.checkpoint.aggregate);
      AKORT.AggregateIntegration.execute(phase, afterFixture.context, afterFixture.options);
      var durableAfterFirst = hash_(afterFixture.durable());
      var checkpointAfterFirst = hash_(afterFixture.context.checkpoint.aggregate);
      afterFixture.context.checkpoint.aggregate = checkpointBefore;
      var recoveryResult = AKORT.AggregateIntegration.execute(phase, afterFixture.context, afterFixture.options);
      var durableAfterRecovery = hash_(afterFixture.durable());
      var checkpointAfterRecovery = hash_(afterFixture.context.checkpoint.aggregate);
      assert_(durableAfterFirst === durableAfterRecovery,
        'ALPHA74_GATE4_TIMEOUT_AFTER_DUPLICATED',
        'Retry after a lost checkpoint changed durable state.',
        { phase: phase });
      assert_(checkpointAfterFirst === checkpointAfterRecovery,
        'ALPHA74_GATE4_TIMEOUT_CHECKPOINT_DIVERGED',
        'Retry after a lost checkpoint did not converge to the same checkpoint.',
        { phase: phase });
      return {
        phase: phase,
        timeoutBefore: 'PASS',
        timeoutAfter: 'PASS',
        firstResult: clone_(beforeResult || null),
        recoveryResult: clone_(recoveryResult || null),
        durableFingerprint: durableAfterRecovery
      };
    });
  }

  function livePublishSnapshot_() {
    var scan = AKORT.AggregateIntegration.readOnlyContractScan();
    assert_(scan && scan.ok === true,
      'ALPHA74_GATE4_LIVE_PUBLISH_INVALID',
      'DataLens-connected DEV Publish failed the read-only aggregate contract scan.',
      { scan: scan });
    return {
      rows: scan.data.rows,
      columns: scan.data.columns,
      logicalRows: scan.data.logicalRows,
      fingerprint: scan.data.fingerprint,
      duplicateLogicalRows: scan.data.duplicateLogicalRows.length,
      latestFailures: scan.data.latestFailures.length,
      futureRows: scan.data.futureRows.length
    };
  }

  function saveEvidence_(resources, evidence) {
    var canonical = clone_(evidence);
    delete canonical.evidenceHash;
    evidence.evidenceHash = hash_(canonical);
    var serialized = stableStringify_(evidence);
    var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmss');
    var name = 'ALPHA74_GATE4_ACCEPTANCE_' + stamp + '.json';
    var file = DriveApp.getFolderById(resources.testResultsFolderId)
      .createFile(name, serialized, 'application/json');
    return {
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      sha256: evidence.evidenceHash,
      bytes: Utilities.newBlob(serialized, 'application/json').getBytes().length
    };
  }

  function status() {
    return AKORT.Core.safeRun('ALPHA74_GATE4_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var resources = resources_();
      var flags = flagState_();
      return AKORT.Result.success('Alpha.7.4 Gate 4 readiness loaded.', {
        release: RELEASE,
        version: VERSION,
        ready: flags.execution === true && flags.regularPipeline === false,
        featureFlags: flags,
        livePublishTargetProtected: true,
        isolatedTargetFolderConfigured: Boolean(resources.testFilesFolderId),
        evidenceFolderConfigured: Boolean(resources.testResultsFolderId),
        timeoutPhases: TIMEOUT_PHASES.slice(),
        physicalWrites: false
      });
    }, { lock: false, persistLogs: false });
  }

  function runAndSaveEvidence() {
    return AKORT.Core.safeRun('ALPHA74_GATE4_ACCEPTANCE', function (executionContext) {
      AKORT.EnvironmentGuard.assertDev();
      var executionId = text_(executionContext && executionContext.executionId) ||
        'EXE_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
      var resources = resources_();
      var flags = assertGate4Flags_();
      var liveBefore = livePublishSnapshot_();
      var sandbox = createSandbox_(executionId, resources);
      assert_(text_(sandbox.spreadsheet.getId()) !== text_(resources.publishSpreadsheetId),
        'ALPHA74_GATE4_LIVE_TARGET_FORBIDDEN',
        'Gate 4 sandbox unexpectedly resolved to the live Publish spreadsheet.',
        { retryable: false });

      var specifications = [
        { id: 'INSERT', expectedAction: 'INSERT', period: PERIOD_2, value: 2, publicationAllowed: true },
        { id: 'UPDATE', expectedAction: 'UPDATE', period: PERIOD_2, value: 2.5, publicationAllowed: true },
        { id: 'NOOP', expectedAction: 'NOOP', period: PERIOD_2, value: 2.5, publicationAllowed: true },
        { id: 'LOST_RESPONSE', expectedAction: 'UPDATE', period: PERIOD_2, value: 3, publicationAllowed: true, lostResponse: true },
        { id: 'REVERSAL_DELETE', expectedAction: 'DELETE', period: PERIOD_2, value: 3, publicationAllowed: false, mode: 'REVERSAL' },
        { id: 'THIRD_STATE', expectedAction: 'FAIL_CLOSED', period: PERIOD_2, value: 4, publicationAllowed: true, thirdState: true }
      ];
      var scenarios = specifications.map(function (specification) {
        return executeScenario_(sandbox, executionId, specification);
      });
      var timeoutMatrix = runTimeoutMatrix_();
      var liveAfter = livePublishSnapshot_();
      assert_(stableStringify_(liveBefore) === stableStringify_(liveAfter),
        'ALPHA74_GATE4_LIVE_PUBLISH_CHANGED',
        'Gate 4 changed the DataLens-connected DEV Publish spreadsheet.',
        { before: liveBefore, after: liveAfter });
      var flagsAfter = assertGate4Flags_();
      assert_(stableStringify_(flags) === stableStringify_(flagsAfter),
        'ALPHA74_GATE4_FLAGS_CHANGED',
        'Gate 4 changed aggregate feature flags.',
        { before: flags, after: flagsAfter });

      var evidence = {
        schemaVersion: EVIDENCE_SCHEMA,
        release: RELEASE,
        harnessVersion: VERSION,
        executionId: executionId,
        createdAt: AKORT.Core.now(),
        status: 'PASS',
        featureFlagsBefore: flags,
        featureFlagsAfter: flagsAfter,
        livePublishBefore: liveBefore,
        livePublishAfter: liveAfter,
        livePublishUnchanged: true,
        livePublishPhysicalWrites: 0,
        dataLensConnectedTargetTouched: false,
        sandbox: {
          spreadsheetId: sandbox.spreadsheet.getId(),
          spreadsheetName: sandbox.spreadsheet.getName(),
          spreadsheetUrl: sandbox.spreadsheet.getUrl(),
          folderRole: 'canonical DEV test-files',
          targetSheet: TARGET_SHEET,
          schemaColumns: AKORT.AggregateContract.Headers.length
        },
        scenarios: scenarios,
        timeoutMatrix: timeoutMatrix,
        assertions: {
          insert: 'PASS',
          update: 'PASS',
          delete: 'PASS',
          noop: 'PASS_NO_PHYSICAL_WRITE',
          atomicAffectedSet: 'PASS_ONE_BATCHUPDATE_PER_MUTATION',
          lostResponseRecovery: 'PASS_AFTER_STATE_WITHOUT_REWRITE',
          timeoutBeforeAfterEveryLongPhase: 'PASS_' + timeoutMatrix.length + '_PHASES',
          thirdStateFailClosed: 'PASS_NO_AUTOMATIC_OVERWRITE',
          unrelatedRowsUnchanged: 'PASS',
          latestCorrectness: 'PASS',
          standardLogicalReversal: 'PASS'
        },
        regularPipelineEnabled: false,
        evidenceFileWrites: 1
      };
      var saved = saveEvidence_(resources, evidence);
      return AKORT.Result.success('Alpha.7.4 Gate 4 isolated physical/fault acceptance passed.', {
        release: RELEASE,
        harnessVersion: VERSION,
        scenarios: scenarios.map(function (scenario) {
          return {
            id: scenario.id,
            status: scenario.status,
            expectedAction: scenario.expectedAction,
            atomicApiCalls: scenario.atomicApiCalls
          };
        }),
        timeoutPhases: timeoutMatrix.length,
        livePublishUnchanged: true,
        livePublishPhysicalWrites: 0,
        regularPipelineEnabled: false,
        sandbox: {
          id: sandbox.spreadsheet.getId(),
          name: sandbox.spreadsheet.getName(),
          url: sandbox.spreadsheet.getUrl()
        },
        evidence: saved
      });
    }, { lock: true, persistLogs: true });
  }

  return Object.freeze({
    Version: VERSION,
    EvidenceSchemaVersion: EVIDENCE_SCHEMA,
    Release: RELEASE,
    TimeoutPhases: TIMEOUT_PHASES.slice(),
    status: status,
    runAndSaveEvidence: runAndSaveEvidence,
    Test: Object.freeze({
      calculatedRow: calculatedRow_,
      publishRow: publishRow_,
      stageRecord: stageRecord_,
      runTimeoutMatrix: runTimeoutMatrix_
    })
  });
})();
