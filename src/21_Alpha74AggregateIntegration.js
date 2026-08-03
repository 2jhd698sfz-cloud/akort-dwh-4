var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 incremental aggregate integration.
 *
 * The pure functions in this module own logical identity, durable-stage
 * validation, replacement planning, recovery classification and
 * reconciliation. The default adapter is the only physical-write boundary.
 */
AKORT.AggregateIntegration = (function () {
  var VERSION = '4.0-aggregate-integration-7';
  var RELEASE = '4.0.0-alpha.7.4.33';
  // Invocation-local cache only. Durable truth remains in AGGREGATE_STAGE and
  // publish intents; this cache merely prevents the same 61k-row projection
  // from being downloaded once per bounded batch in a single worker run.
  var ALPHA74_TARGET_READ_CACHE = null;
  var MONTHLY_PERIOD_LABEL_INCIDENT_RELEASE = '4.0.0-alpha.7.4.24';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_RELEASE = '4.0.0-alpha.7.4.30';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_OPERATION_ID = 'OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_LOAD_ID = 'LOAD_20260802T123559854Z_EFB27B040FBC';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_STAGE_ROWS = 392;
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_ROWS = 196;
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_LABEL = '2026-W27';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD = '2026-07-04';
  var WEEKLY_ROLLBACK_PERIOD_INCIDENT_CANONICAL_PERIOD = '2026-07-05';
  var OPERATION_SCHEMA_VERSION = '4.0-operation-2';
  var STAGE_SCHEMA_VERSION = '4.0-aggregate-stage-1';
  var TARGET_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var ARTIFACT_SERIES_KEY = '__INPUT_ARTIFACT__';
  var INTENT_SERIES_KEY = '__PUBLISH_INTENT__';
  var ACCEPTED_PARITY_ADAPTER_MODE = 'ALPHA6_ACCEPTED_PARITY';
  var BOUNDED_WORK_VERSION = '4.0-aggregate-bounded-work-1';
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
  var AGGREGATE_PHASES = Object.freeze([
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES'
  ]);
  var STAGE_HEADERS = Object.freeze([
    'operation_id', 'load_id', 'plan_id', 'plan_fingerprint', 'calculation_id',
    'aggregate_series_key', 'aggregate_row_key', 'period_start', 'action',
    'row_payload_json', 'row_fingerprint', 'expected_target_fingerprint',
    'stage_status', 'created_at', 'verified_at', 'release_version'
  ]);
  var SETTINGS = Object.freeze({
    PUBLISH_AGGREGATE_EXECUTION_ENABLED: false,
    PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED: false,
    PUBLISH_AGGREGATE_CALCULATION_GROUPS_PER_STEP: 8,
    PUBLISH_AGGREGATE_MATERIALIZATION_COMBOS_PER_STEP: 250,
    PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP: 2000,
    PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP: 500,
    PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP: 500,
    PUBLISH_AGGREGATE_RECONCILIATION_SERIES_PER_STEP: 500,
    PUBLISH_AGGREGATE_STAGE_STATUS_ROWS_PER_STEP: 2000,
    PUBLISH_AGGREGATE_MONOLITHIC_COMBO_LIMIT: 8,
    PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS: 5000,
    PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS: 100000,
    PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS: 500,
    PUBLISH_AGGREGATE_ARTIFACT_CHUNK_CHARS: 30000,
    PUBLISH_AGGREGATE_ARTIFACT_CHUNKS_PER_STEP: 25
  });

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
        if (['__row', '_rowNumber', 'created_at', 'verified_at'].indexOf(key) < 0) out[key] = stable_(value[key]);
      });
      return out;
    }
    if (typeof value === 'number' && !isFinite(value)) return null;
    return value;
  }

  function stableStringify_(value) {
    return JSON.stringify(stable_(value));
  }

  function hash_(value) {
    var serialized = typeof value === 'string' ? value : stableStringify_(value);
    if (AKORT.Core && typeof AKORT.Core.sha256 === 'function') return AKORT.Core.sha256(serialized);
    if (AKORT.AggregateCalculator && AKORT.AggregateCalculator.Test && typeof AKORT.AggregateCalculator.Test.sha256 === 'function') {
      return AKORT.AggregateCalculator.Test.sha256(serialized);
    }
    var h = 2166136261;
    for (var i = 0; i < serialized.length; i += 1) {
      h ^= serialized.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function error_(code, message, details) {
    if (AKORT.Core && typeof AKORT.Core.error === 'function') return AKORT.Core.error(code, message, details || {});
    var error = new Error(message);
    error.code = code;
    error.details = details || {};
    return error;
  }

  function now_() {
    return AKORT.Core && typeof AKORT.Core.now === 'function' ? AKORT.Core.now() : new Date().toISOString();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function parseJson_(value, fallback, code) {
    if (value === '' || value === null || value === undefined) return clone_(fallback);
    if (typeof value === 'object') return clone_(value);
    try { return JSON.parse(String(value)); }
    catch (caught) {
      throw error_(code || 'AGGREGATE_JSON_INVALID', 'Aggregate integration JSON is invalid.', {
        retryable: false,
        cause: String(caught)
      });
    }
  }

  function uniqueSorted_(values) {
    var seen = {};
    (values || []).forEach(function (value) {
      var key = text_(value);
      if (key) seen[key] = true;
    });
    return Object.keys(seen).sort();
  }

  function periodKey_(frequency, value) {
    var raw = text_(value);
    if (/^\d{4}-\d{2}/.test(raw)) return String(frequency).toLowerCase() === 'monthly' ? raw.slice(0, 7) : raw.slice(0, 10);
    if (typeof value === 'number' && isFinite(value)) {
      var serialDate = new Date(Math.round((value - 25569) * 86400000));
      if (isNaN(serialDate.getTime())) return '';
      var serialMonth = ('0' + (serialDate.getUTCMonth() + 1)).slice(-2);
      var serialDay = ('0' + serialDate.getUTCDate()).slice(-2);
      return String(frequency).toLowerCase() === 'monthly'
        ? serialDate.getUTCFullYear() + '-' + serialMonth
        : serialDate.getUTCFullYear() + '-' + serialMonth + '-' + serialDay;
    }
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return String(frequency).toLowerCase() === 'monthly'
      ? date.getFullYear() + '-' + month
      : date.getFullYear() + '-' + month + '-' + day;
  }

  function isoWeekSundayPeriod_(value) {
    var match = /^(\d{4})-W(\d{2})$/.exec(text_(value));
    if (!match) return '';
    var isoYear = Number(match[1]), isoWeek = Number(match[2]);
    if (!isFinite(isoYear) || isoWeek < 1 || isoWeek > 53) return '';
    var januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
    var januaryFourthDay = januaryFourth.getUTCDay() || 7;
    var sunday = new Date(Date.UTC(
      isoYear,
      0,
      4 - januaryFourthDay + 1 + (isoWeek - 1) * 7 + 6
    ));
    var sundayYear = sunday.getUTCFullYear();
    var sundayMonth = ('0' + (sunday.getUTCMonth() + 1)).slice(-2);
    var sundayDay = ('0' + sunday.getUTCDate()).slice(-2);
    return sundayYear + '-' + sundayMonth + '-' + sundayDay;
  }

  function canonicalPublishPayload_(row) {
    var payload = clone_(row || {});
    if (text_(payload.frequency).toLowerCase() !== 'weekly') return payload;
    var canonicalPeriod = isoWeekSundayPeriod_(payload.period_label);
    if (!canonicalPeriod) return payload;
    var parts = canonicalPeriod.split('-');
    payload.period_start = canonicalPeriod;
    payload.year = Number(parts[0]);
    payload.month = Number(parts[1]);
    payload.quarter = 'Q' + Math.ceil(Number(parts[1]) / 3);
    return payload;
  }

  function publicSignature_(row) {
    var source = row || {};
    var level = text_(source.aggregate_level).toLowerCase(), subject;
    if (level === 'category') subject = text_(source.category_id || source.aggregate_subject_id);
    else if (level === 'group') subject = text_(source.product_group || source.aggregate_name || source.aggregate_subject_id);
    else subject = text_(source.aggregate_name || source.aggregate_subject_id);
    return [
      text_(source.dataset_code),
      text_(source.frequency).toLowerCase(),
      level,
      subject,
      text_(source.value_type),
      text_(source.index_type).toLowerCase(),
      text_(source.weight_source)
    ].join('|');
  }

  function rowValues_(row, headers) {
    return headers.map(function (header) {
      var value = row && row[header];
      return value === undefined || value === null ? '' : value;
    });
  }

  function monthlyPeriodLabelKey_(row) {
    var source = row || {};
    if (text_(source.frequency).toLowerCase() !== 'monthly') return '';
    return periodKey_('monthly', source.period_start);
  }

  function monthlyPeriodLabelMismatch_(row) {
    var expected = monthlyPeriodLabelKey_(row);
    if (!expected) return false;
    return periodKey_('monthly', row && row.period_label) !== expected;
  }

  function fingerprintRowValues_(row, headers) {
    return headers.map(function (header) {
      var value = row && row[header];
      if (header === 'period_start') {
        var period = periodKey_(row && row.frequency, value);
        return String(row && row.frequency).toLowerCase() === 'monthly' && period ? period + '-01' : period;
      }
      if (header === 'period_label' && text_(row && row.frequency).toLowerCase() === 'monthly') {
        return monthlyPeriodLabelKey_(row);
      }
      if (header === 'period_label' &&
          (value instanceof Date || (typeof value === 'number' && isFinite(value)))) {
        return periodKey_(row && row.frequency, value);
      }
      return value === undefined || value === null ? '' : value;
    });
  }

  function canonicalRows_(rows, headers, keyFunction) {
    return (rows || []).map(function (row) {
      return { key: keyFunction(row), values: fingerprintRowValues_(row, headers) };
    }).sort(function (a, b) {
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }

  function rowsFingerprint_(rows, headers, keyFunction) {
    return hash_(canonicalRows_(rows, headers, keyFunction));
  }

  function normalizeImpactRecords(records, operationId, loadId) {
    var op = text_(operationId), load = text_(loadId), seenRows = {}, seenCombos = {}, normalized = [];
    (records || []).forEach(function (record) {
      if (text_(record.operation_id) !== op || text_(record.load_id) !== load) {
        throw error_('AGGREGATE_IMPACT_SCOPE_MISMATCH', 'PUBLISH_IMPACT row does not belong to the active operation/load.', {
          retryable: false,
          expectedOperationId: op,
          expectedLoadId: load,
          actualOperationId: text_(record.operation_id),
          actualLoadId: text_(record.load_id)
        });
      }
      var rowIdentity = text_(record.impact_id) || hash_(record);
      if (seenRows[rowIdentity]) return;
      seenRows[rowIdentity] = true;
      var copy = clone_(record);
      copy.aggregate_combos = parseJson_(copy.aggregate_combos_json, [], 'AGGREGATE_IMPACT_COMBOS_INVALID');
      copy.series_ids = parseJson_(copy.series_ids_json, [], 'AGGREGATE_IMPACT_SERIES_INVALID');
      copy.affected_periods = parseJson_(copy.affected_periods_json, [], 'AGGREGATE_IMPACT_PERIODS_INVALID');
      copy.aggregate_combos.forEach(function (combo) {
        var key = [
          text_(combo.frequency),
          text_(combo.datasetCode || combo.dataset_code),
          periodKey_(combo.frequency, combo.period || combo.period_start),
          text_(combo.valueType || combo.value_type),
          text_(combo.indexType || combo.index_type)
        ].join('|');
        if (key.replace(/\|/g, '')) seenCombos[key] = true;
      });
      normalized.push(copy);
    });
    normalized.sort(function (a, b) {
      return text_(a.impact_id) < text_(b.impact_id) ? -1 : text_(a.impact_id) > text_(b.impact_id) ? 1 : 0;
    });
    return {
      records: normalized,
      recordCount: normalized.length,
      aggregateComboCount: Object.keys(seenCombos).length,
      aggregateComboKeys: Object.keys(seenCombos).sort(),
      fingerprint: hash_(normalized.map(function (row) {
        var copy = clone_(row);
        delete copy.__row;
        return copy;
      }))
    };
  }

  function sourceImpactsFromPrepared_(prepared, operationId, loadId, context, reasonCode) {
    var weightId = text_(context.weight_snapshot && context.weight_snapshot.snapshot_id);
    var membershipId = text_(context.membership_snapshot && context.membership_snapshot.snapshot_id);
    if (!weightId || !membershipId) {
      throw error_('AGGREGATE_SNAPSHOT_CONFIG_MISSING', 'Authoritative weight and membership snapshots are required.', { retryable: false });
    }
    var map = {};
    (prepared.records || []).forEach(function (record) {
      if (text_(record.frequency).toLowerCase() === 'industry') return;
      var seriesIds = uniqueSorted_(record.series_ids || []);
      if (!seriesIds.length) seriesIds = [text_(record.category_id) || text_(record.impact_id)];
      seriesIds.forEach(function (seriesId) {
        var impact = {
          operation_id: text_(operationId),
          load_id: text_(loadId),
          reason_code: text_(reasonCode || 'REVISION'),
          source_dataset_code: text_(record.dataset_code),
          source_series_id: seriesId,
          source_category_id: text_(record.category_id),
          source_period: periodKey_(record.frequency, record.source_period),
          frequency: text_(record.frequency).toLowerCase(),
          source_value_type: text_(record.value_type),
          source_series_scope: 'ALL',
          weight_snapshot_id: weightId,
          membership_snapshot_id: membershipId,
          created_at: text_(record.created_at || now_())
        };
        var key = stableStringify_(impact);
        map[key] = impact;
      });
    });
    return Object.keys(map).sort().map(function (key) { return map[key]; });
  }

  function aggregateComboKey_(frequency, datasetCode, period, valueType, indexType) {
    return [
      text_(frequency).toLowerCase(),
      text_(datasetCode),
      periodKey_(frequency, period),
      text_(valueType),
      text_(indexType).toLowerCase()
    ].join('|');
  }

  function preparedCombos_(prepared) {
    var byKey = {};
    (prepared && prepared.records || []).forEach(function (record) {
      (record.aggregate_combos || []).forEach(function (combo) {
        var normalized = {
          frequency: text_(combo.frequency).toLowerCase(),
          datasetCode: text_(combo.datasetCode || combo.dataset_code),
          period: periodKey_(combo.frequency, combo.period || combo.period_start),
          valueType: text_(combo.valueType || combo.value_type),
          indexType: text_(combo.indexType || combo.index_type).toLowerCase()
        };
        var key = aggregateComboKey_(
          normalized.frequency,
          normalized.datasetCode,
          normalized.period,
          normalized.valueType,
          normalized.indexType
        );
        if (key.replace(/\|/g, '')) byKey[key] = normalized;
      });
    });
    return Object.keys(byKey).sort().map(function (key) { return byKey[key]; });
  }

  function publishPayload_(row) {
    var payload = {};
    AKORT.AggregateContract.Headers.forEach(function (header) {
      var value = row && row[header];
      payload[header] = value === undefined || value === null ? '' : value;
    });
    return canonicalPublishPayload_(payload);
  }

  function directStageRecord_(payload, action, identity) {
    var seriesKey = publicSignature_(payload);
    var period = periodKey_(payload.frequency, payload.period_start);
    if (!seriesKey.replace(/\|/g, '') || !period) {
      throw error_('AGGREGATE_ACCEPTED_PARITY_IDENTITY_INVALID', 'Accepted Alpha.6 aggregate row has no stable public identity.', {
        retryable: false,
        action: action,
        payload: payload
      });
    }
    var record = {
      operation_id: text_(identity.operationId),
      load_id: text_(identity.loadId),
      plan_id: text_(identity.planId),
      plan_fingerprint: text_(identity.planFingerprint),
      calculation_id: 'A74_ACCEPTED_PARITY_' + hash_([identity.planId, seriesKey, period]).slice(0, 20).toUpperCase(),
      aggregate_series_key: seriesKey,
      aggregate_row_key: seriesKey + '|' + period,
      period_start: period,
      action: action,
      row_payload_json: JSON.stringify(payload),
      row_fingerprint: '',
      expected_target_fingerprint: '',
      stage_status: 'CALCULATED',
      created_at: text_(identity.createdAt),
      verified_at: '',
      release_version: RELEASE
    };
    record.row_fingerprint = hash_({
      seriesKey: record.aggregate_series_key,
      rowKey: record.aggregate_row_key,
      period: record.period_start,
      action: record.action,
      payload: payload
    });
    return record;
  }

  function acceptedParityArtifact_(prepared, metadata, runtimeContext) {
    var compatibility = AKORT.IncrementalPublish && AKORT.IncrementalPublish.OperationalCompatibility;
    if (!compatibility || typeof compatibility.buildAcceptedAggregateRows !== 'function') {
      throw error_('AGGREGATE_ACCEPTED_PARITY_ADAPTER_UNAVAILABLE', 'The accepted Alpha.6 aggregate compatibility adapter is unavailable.', {
        retryable: false
      });
    }
    var combos = preparedCombos_(prepared);
    var comboSet = {};
    combos.forEach(function (combo) {
      comboSet[aggregateComboKey_(combo.frequency, combo.datasetCode, combo.period, combo.valueType, combo.indexType)] = true;
    });
    var expectedRows = compatibility.buildAcceptedAggregateRows(combos).map(publishPayload_);
    var currentRows = readTargetRows_().filter(function (row) {
      return comboSet[aggregateComboKey_(row.frequency, row.dataset_code, row.period_start, row.value_type, row.index_type)];
    }).map(publishPayload_);
    var planSeed = {
      adapterMode: ACCEPTED_PARITY_ADAPTER_MODE,
      adapterContractVersion: text_(runtimeContext.adapter_contract_version),
      operationId: text_(metadata.operationId),
      loadId: text_(metadata.loadId),
      mode: text_(metadata.mode || 'REVISION'),
      impactFingerprint: text_(prepared.fingerprint),
      combos: combos
    };
    var planId = 'A74_PARITY_PLAN_' + hash_(planSeed).slice(0, 20).toUpperCase();
    var planFingerprint = hash_(planSeed);
    var identity = {
      operationId: metadata.operationId,
      loadId: metadata.loadId,
      planId: planId,
      planFingerprint: planFingerprint,
      createdAt: uniqueSorted_((prepared.records || []).map(function (row) { return text_(row.created_at); }))[0] || ''
    };
    var expectedByKey = {}, currentByKey = {};
    expectedRows.forEach(function (row) {
      expectedByKey[publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start)] = row;
    });
    currentRows.forEach(function (row) {
      currentByKey[publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start)] = row;
    });
    var stageRows = [];
    Object.keys(expectedByKey).sort().forEach(function (key) {
      stageRows.push(directStageRecord_(expectedByKey[key], 'UPSERT', identity));
    });
    Object.keys(currentByKey).sort().forEach(function (key) {
      if (!expectedByKey[key]) stageRows.push(directStageRecord_(currentByKey[key], 'DELETE', identity));
    });
    return {
      plan: {
        ok: true,
        status: 'SUCCESS',
        plan_id: planId,
        fingerprint: planFingerprint,
        calculator_batches: [],
        calculator_shared_input: {
          fingerprint: hash_(planSeed),
          identities: { adapter_mode: ACCEPTED_PARITY_ADAPTER_MODE },
          weight_snapshot: { snapshot_id: 'ALPHA6_ACCEPTED_PARITY', hash: '', rule_rows: [] },
          membership_snapshot: { snapshot_id: 'ALPHA6_ACCEPTED_PARITY', hash: '', rule_rows: [] },
          price_inputs: [], coverage_rules: [], base_inputs: [], options: {}
        },
        summary: {
          adapter_mode: ACCEPTED_PARITY_ADAPTER_MODE,
          aggregate_combos: combos.length,
          expected_rows: expectedRows.length,
          current_rows: currentRows.length,
          staged_rows: stageRows.length
        },
        diagnostics: []
      },
      prebuiltStageRows: stageRows,
      preparedImpactFingerprint: prepared.fingerprint,
      definitionFingerprint: hash_(runtimeContext),
      frontier: { snapshot_id: 'LIVE_EXISTING_PERIOD_FRONTIER', count: combos.length, hash: hash_(combos) },
      sourceNames: {}, periodLabels: {}, categoryMetadata: {}, publishMetadata: { bySeries: {}, bySubject: {} },
      adapterMode: ACCEPTED_PARITY_ADAPTER_MODE
    };
  }

  function acceptedParityChunk_(prepared, metadata, cursor, maxCombos) {
    var runtimeContext = contextSetting_();
    assertOperationalRuntimeContext_();
    if (text_(runtimeContext.adapter_mode).toUpperCase() !== ACCEPTED_PARITY_ADAPTER_MODE) {
      throw error_('AGGREGATE_BOUNDED_ADAPTER_MODE_UNSUPPORTED', 'This bounded materialization adapter is restricted to the Gate 5 accepted Alpha.6 parity context.', {
        retryable: false,
        adapterMode: text_(runtimeContext.adapter_mode)
      });
    }
    var compatibility = AKORT.IncrementalPublish && AKORT.IncrementalPublish.OperationalCompatibility;
    if (!compatibility || typeof compatibility.buildAcceptedAggregateRows !== 'function') {
      throw error_('AGGREGATE_ACCEPTED_PARITY_ADAPTER_UNAVAILABLE', 'The accepted Alpha.6 aggregate compatibility adapter is unavailable.', {
        retryable: false
      });
    }
    var combos = preparedCombos_(prepared);
    var start = Math.max(0, Number(cursor || 0));
    var limit = Math.max(1, Number(maxCombos || 1));
    var end = Math.min(combos.length, start + limit);
    var selected = combos.slice(start, end);
    var planSeed = {
      adapterMode: ACCEPTED_PARITY_ADAPTER_MODE,
      adapterContractVersion: text_(runtimeContext.adapter_contract_version),
      operationId: text_(metadata.operationId),
      loadId: text_(metadata.loadId),
      mode: text_(metadata.mode || 'REVISION'),
      impactFingerprint: text_(prepared.fingerprint),
      combos: combos
    };
    var planId = 'A74_PARITY_PLAN_' + hash_(planSeed).slice(0, 20).toUpperCase();
    var planFingerprint = hash_(planSeed);
    var identity = {
      operationId: metadata.operationId,
      loadId: metadata.loadId,
      planId: planId,
      planFingerprint: planFingerprint,
      createdAt: uniqueSorted_((prepared.records || []).map(function (row) { return text_(row.created_at); }))[0] || ''
    };
    var comboSet = {};
    selected.forEach(function (combo) {
      comboSet[aggregateComboKey_(combo.frequency, combo.datasetCode, combo.period, combo.valueType, combo.indexType)] = true;
    });
    var expectedRows = compatibility.buildAcceptedAggregateRows(selected).map(publishPayload_);
    var currentRows = readTargetRowsForCombos_(selected).filter(function (row) {
      return comboSet[aggregateComboKey_(row.frequency, row.dataset_code, row.period_start, row.value_type, row.index_type)];
    }).map(publishPayload_);
    var expectedByKey = {}, currentByKey = {}, stageRows = [];
    expectedRows.forEach(function (row) {
      expectedByKey[publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start)] = row;
    });
    currentRows.forEach(function (row) {
      currentByKey[publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start)] = row;
    });
    Object.keys(expectedByKey).sort().forEach(function (key) {
      stageRows.push(directStageRecord_(expectedByKey[key], 'UPSERT', identity));
    });
    Object.keys(currentByKey).sort().forEach(function (key) {
      if (!expectedByKey[key]) stageRows.push(directStageRecord_(currentByKey[key], 'DELETE', identity));
    });
    return {
      workSchemaVersion: BOUNDED_WORK_VERSION,
      cursor: end,
      total: combos.length,
      combosProcessed: end - start,
      complete: end >= combos.length,
      stageRows: stageRows,
      artifact: {
        plan: {
          ok: true,
          status: 'SUCCESS',
          plan_id: planId,
          fingerprint: planFingerprint,
          calculator_batches: [],
          calculator_shared_input: {
            fingerprint: hash_(planSeed),
            identities: { adapter_mode: ACCEPTED_PARITY_ADAPTER_MODE },
            weight_snapshot: { snapshot_id: 'ALPHA6_ACCEPTED_PARITY', hash: '', rule_rows: [] },
            membership_snapshot: { snapshot_id: 'ALPHA6_ACCEPTED_PARITY', hash: '', rule_rows: [] },
            price_inputs: [], coverage_rules: [], base_inputs: [], options: {}
          },
          summary: {
            adapter_mode: ACCEPTED_PARITY_ADAPTER_MODE,
            aggregate_combos: combos.length,
            bounded_materialization: true
          },
          diagnostics: []
        },
        precalculatedStageRows: true,
        preparedImpactFingerprint: prepared.fingerprint,
        definitionFingerprint: hash_(runtimeContext),
        frontier: { snapshot_id: 'LIVE_EXISTING_PERIOD_FRONTIER', count: combos.length, hash: hash_(combos) },
        sourceNames: {}, periodLabels: {}, categoryMetadata: {}, publishMetadata: { bySeries: {}, bySubject: {} },
        adapterMode: ACCEPTED_PARITY_ADAPTER_MODE
      }
    };
  }

  function calculationGroups_(batches) {
    var groups = {};
    (batches || []).forEach(function (batch) {
      var impact = batch.impact_items && batch.impact_items[0] || {};
      var definition = batch.aggregate_definitions && batch.aggregate_definitions[0] || {};
      var key = [
        text_(definition.dataset_code),
        text_(definition.frequency),
        text_(definition.value_type),
        text_(definition.index_type),
        text_(impact.target_period)
      ].join('|');
      groups[key] = groups[key] || { groupKey: key, batches: [] };
      groups[key].batches.push(clone_(batch));
    });
    return Object.keys(groups).sort().map(function (key) {
      groups[key].batches.sort(function (a, b) {
        return text_(a.calculation_id) < text_(b.calculation_id) ? -1 : text_(a.calculation_id) > text_(b.calculation_id) ? 1 : 0;
      });
      return groups[key];
    });
  }

  function artifactFingerprint_(artifact) {
    var canonical = clone_(artifact || {});
    delete canonical.fingerprint;
    return hash_(canonical);
  }

  function hydrateGroupRequest_(group, shared, contractVersion, calculationId) {
    var impacts = {}, definitions = {};
    (group.batches || []).forEach(function (batch) {
      (batch.impact_items || []).forEach(function (item) { impacts[text_(item.combo_key)] = clone_(item); });
      (batch.aggregate_definitions || []).forEach(function (definition) {
        definitions[text_(definition.definition_id) || hash_(definition)] = clone_(definition);
      });
    });
    return {
      contract_version: contractVersion,
      calculation_id: calculationId,
      impact_items: Object.keys(impacts).sort().map(function (key) { return impacts[key]; }),
      aggregate_definitions: Object.keys(definitions).sort().map(function (key) { return definitions[key]; }),
      price_inputs: clone_(shared.price_inputs || []),
      weight_snapshot: clone_(shared.weight_snapshot),
      membership_snapshot: clone_(shared.membership_snapshot),
      coverage_rules: clone_(shared.coverage_rules || []),
      base_inputs: clone_(shared.base_inputs || []),
      options: clone_(shared.options || {})
    };
  }

  function dateDimensions_(frequency, period) {
    var key = periodKey_(frequency, period);
    var dateKey = String(frequency).toLowerCase() === 'monthly' ? key + '-01' : key;
    var parts = dateKey.split('-'), year = Number(parts[0]), month = Number(parts[1]);
    if (!key || !year || !month) throw error_('AGGREGATE_PERIOD_INVALID', 'Calculated aggregate period is invalid.', { period: period });
    return {
      periodStart: dateKey,
      year: year,
      quarter: 'Q' + Math.ceil(month / 3),
      month: month,
      label: String(frequency).toLowerCase() === 'monthly' ? key : dateKey
    };
  }

  function legacyAggregateId_(row, dimensions) {
    var level = text_(row.aggregate_level).toLowerCase();
    var method = text_(row.calculation_method).toUpperCase();
    var prefix, identity;
    if (level === 'category') {
      prefix = 'AGG_CAT';
      identity = [row.dataset_code, row.frequency, row.value_type, row.index_type, row.category_id || row.aggregate_subject_id].join('|');
    } else if (method === 'AGGREGATE_MARKUP') {
      prefix = 'AGG_MARKUP_PCT';
      identity = [row.dataset_code, row.frequency, level, row.index_type, dimensions.periodStart].join('|');
    } else if (level === 'custom_group' && method === 'NORMALIZED_WEIGHTED_AVERAGE') {
      prefix = 'AGG_BORSHCH';
      identity = [row.dataset_code, row.frequency, row.value_type, row.index_type, dimensions.periodStart].join('|');
    } else {
      prefix = 'AGG';
      identity = [
        row.dataset_code,
        row.frequency,
        row.value_type,
        row.index_type,
        dimensions.periodStart,
        level,
        row.aggregate_name || row.aggregate_subject_id
      ].join('|');
    }
    return prefix + '_' + hash_(identity).slice(0, 20).toUpperCase();
  }

  function projectPublishRow(calculatedRow, metadata) {
    var row = calculatedRow || {}, meta = metadata || {}, dimensions = dateDimensions_(row.frequency, row.period_start);
    var level = text_(row.aggregate_level).toLowerCase();
    var aggregateId = legacyAggregateId_(row, dimensions);
    var projected = {
      dataset_code: text_(row.dataset_code),
      source_name: text_(meta.sourceName || 'AKORT Alpha.7.4'),
      frequency: text_(row.frequency).toLowerCase(),
      aggregate_level: level,
      aggregate_id: aggregateId,
      aggregate_name: text_(meta.aggregateName || (level === 'category' ? 'Вклад категории' : row.aggregate_name || row.aggregate_subject_id)),
      category_id: text_(row.category_id),
      product_group: text_(meta.productGroup || row.product_group || (level === 'group' ? row.aggregate_name : '')),
      product_name: text_(meta.productName || row.product_name),
      value_type: text_(row.value_type),
      index_type: text_(row.index_type).toLowerCase(),
      period_start: dimensions.periodStart,
      year: dimensions.year,
      quarter: dimensions.quarter,
      month: dimensions.month,
      period_label: text_(meta.periodLabel || dimensions.label),
      category_value: row.category_value,
      category_change_pp: row.category_change_pp,
      category_weight: row.category_weight,
      aggregate_change_pp: row.aggregate_change_pp,
      contribution_to_group_change_pp: row.contribution_to_group_change_pp,
      contribution_to_basket_change_pp: row.contribution_to_basket_change_pp,
      contribution_to_total_cpi_pp: row.contribution_to_total_cpi_pp,
      weight_source: text_(row.weight_rule_id || meta.weightSource || meta.weightSnapshotId),
      coverage_categories_count: row.applied_members_count,
      coverage_weight_sum: row.applied_weight_sum,
      is_latest_period: 0,
      aggregate_value: row.aggregate_value,
      aggregate_base_value: row.aggregate_base_value
    };
    AKORT.AggregateContract.Headers.forEach(function (header) {
      if (projected[header] === undefined || projected[header] === null) projected[header] = '';
    });
    return canonicalPublishPayload_(projected);
  }

  function buildStageRecord(calculatedRow, identity) {
    var meta = identity || {}, publishRow = projectPublishRow(calculatedRow, {
      sourceName: meta.sourceName,
      weightSnapshotId: meta.weightSnapshotId,
      weightSource: meta.weightSource,
      aggregateName: meta.aggregateName,
      productGroup: meta.productGroup,
      productName: meta.productName,
      periodLabel: meta.periodLabel
    });
    var action = calculatedRow.publication_allowed === true ? 'UPSERT' : 'DELETE';
    var publicationPeriod = periodKey_(publishRow.frequency, publishRow.period_start);
    var record = {
      operation_id: text_(meta.operationId),
      load_id: text_(meta.loadId),
      plan_id: text_(meta.planId),
      plan_fingerprint: text_(meta.planFingerprint),
      calculation_id: text_(calculatedRow.calculation_id || meta.calculationId),
      aggregate_series_key: text_(calculatedRow.aggregate_series_key),
      aggregate_row_key: text_(calculatedRow.aggregate_series_key) + '|' + publicationPeriod,
      period_start: publicationPeriod,
      action: action,
      row_payload_json: JSON.stringify(publishRow),
      row_fingerprint: '',
      expected_target_fingerprint: '',
      stage_status: 'CALCULATED',
      created_at: now_(),
      verified_at: '',
      release_version: RELEASE
    };
    record.row_fingerprint = hash_({
      seriesKey: record.aggregate_series_key,
      rowKey: record.aggregate_row_key,
      period: record.period_start,
      action: record.action,
      payload: publishRow
    });
    return record;
  }

  function stageEnvelope_(stageRows, identity) {
    var expected = identity || {}, rowKeys = {}, series = {}, fingerprints = [];
    (stageRows || []).forEach(function (record) {
      if (text_(record.operation_id) !== text_(expected.operationId) ||
          text_(record.load_id) !== text_(expected.loadId) ||
          text_(record.plan_id) !== text_(expected.planId) ||
          text_(record.plan_fingerprint) !== text_(expected.planFingerprint)) {
        throw error_('AGGREGATE_STAGE_SCOPE_MISMATCH', 'AGGREGATE_STAGE row belongs to another immutable plan.', { retryable: false });
      }
      var seriesKey = text_(record.aggregate_series_key), rowKey = text_(record.aggregate_row_key);
      if (!seriesKey || !rowKey || seriesKey.indexOf('__') === 0) {
        throw error_('AGGREGATE_STAGE_KEY_INVALID', 'Calculated stage row has no valid logical identity.', { retryable: false, rowKey: rowKey });
      }
      if (rowKeys[rowKey]) {
        throw error_('AGGREGATE_STAGE_DUPLICATE_ROW_KEY', 'Duplicate aggregate_row_key is forbidden in stage.', {
          retryable: false,
          rowKey: rowKey
        });
      }
      rowKeys[rowKey] = true;
      series[seriesKey] = true;
      fingerprints.push(text_(record.row_fingerprint));
    });
    return {
      rowCount: Object.keys(rowKeys).length,
      seriesCount: Object.keys(series).length,
      seriesKeys: Object.keys(series).sort(),
      stageFingerprint: hash_(fingerprints.sort())
    };
  }

  function validateStageRecord_(record) {
      var seriesKey = text_(record.aggregate_series_key), rowKey = text_(record.aggregate_row_key);
      var payload = parseJson_(record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
      var actualFingerprint = hash_({
        seriesKey: seriesKey,
        rowKey: rowKey,
        period: periodKey_(payload.frequency, record.period_start),
        action: text_(record.action),
        payload: payload
      });
      if (actualFingerprint !== text_(record.row_fingerprint)) {
        throw error_('AGGREGATE_STAGE_FINGERPRINT_MISMATCH', 'Stage row fingerprint does not match its payload.', {
          retryable: false,
          rowKey: rowKey
        });
      }
      if (['UPSERT', 'DELETE'].indexOf(text_(record.action)) < 0) {
        throw error_('AGGREGATE_STAGE_ACTION_INVALID', 'Stage row action is unsupported.', { action: record.action });
      }
      if (record.action === 'UPSERT') {
        var headers = Object.keys(payload).sort();
        var expectedHeaders = AKORT.AggregateContract.Headers.slice().sort();
        if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
          throw error_('AGGREGATE_PUBLISH_SCHEMA_MISMATCH', 'Staged Publish payload must use the exact frozen 29-column schema.', {
            retryable: false,
            rowKey: rowKey,
            expected: expectedHeaders,
            actual: headers
          });
        }
      }
      return true;
  }

  function validateStageRowsChunk_(stageRows, identity, cursor, maxRows) {
    var rows = stageRows || [];
    var envelope = stageEnvelope_(rows, identity);
    var start = Math.max(0, Number(cursor || 0));
    var limit = Math.max(1, Number(maxRows || rows.length || 1));
    var end = Math.min(rows.length, start + limit);
    for (var index = start; index < end; index += 1) validateStageRecord_(rows[index]);
    envelope.workSchemaVersion = BOUNDED_WORK_VERSION;
    envelope.cursor = end;
    envelope.total = rows.length;
    envelope.rowsValidated = end - start;
    envelope.complete = end >= rows.length;
    return envelope;
  }

  function validateStageRows(stageRows, identity) {
    var rows = stageRows || [];
    return validateStageRowsChunk_(rows, identity, 0, Math.max(1, rows.length));
  }

  /**
   * Recovery-only exact validation for the verified Gate 6 lost-response
   * incident. The hard ceiling keeps this synchronous diagnostic bounded;
   * ordinary operation execution always uses validateStageRowsChunk_.
   */
  function validateRecoveryStageSnapshot(stageRows, identity) {
    var rows = stageRows || [];
    if (rows.length > 500) {
      throw error_('AGGREGATE_RECOVERY_STAGE_SNAPSHOT_TOO_LARGE', 'Recovery stage snapshot exceeds the bounded synchronous validation ceiling.', {
        retryable: false,
        rows: rows.length,
        maximumRows: 500
      });
    }
    return validateStageRows(rows, identity);
  }

  function assertValidatedStageSnapshot_(stageRows, identity, state) {
    var envelope = stageEnvelope_(stageRows || [], identity);
    if (envelope.rowCount !== Number(state.expectedStageRows || 0) ||
        envelope.stageFingerprint !== text_(state.stageFingerprint)) {
      throw error_('AGGREGATE_STAGE_CHANGED', 'Validated aggregate stage changed after its bounded validation checkpoint.', {
        retryable: false,
        expectedRows: Number(state.expectedStageRows || 0),
        actualRows: envelope.rowCount,
        expectedFingerprint: text_(state.stageFingerprint),
        actualFingerprint: envelope.stageFingerprint
      });
    }
    return envelope;
  }

  function stageSeriesMap_(stageRows) {
    var signatures = {}, conflicts = {};
    (stageRows || []).forEach(function (record) {
      var payload = parseJson_(record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
      var signature = publicSignature_(payload), series = text_(record.aggregate_series_key);
      if (signatures[signature] && signatures[signature] !== series) conflicts[signature] = true;
      signatures[signature] = series;
    });
    if (Object.keys(conflicts).length) {
      throw error_('AGGREGATE_PUBLIC_IDENTITY_AMBIGUOUS', 'Frozen Publish columns cannot distinguish two staged logical series.', {
        retryable: false,
        signatures: Object.keys(conflicts).sort()
      });
    }
    return signatures;
  }

  function stagePublicationIdentity_(record) {
    var payload = parseJson_(record && record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
    var seriesKey = text_(record && record.aggregate_series_key);
    var period = periodKey_(payload.frequency, payload.period_start || (record && record.period_start));
    return {
      payload: payload,
      seriesKey: seriesKey,
      period: period,
      rowKey: seriesKey + '|' + period,
      stagedRowKey: text_(record && record.aggregate_row_key),
      mismatch: text_(record && record.aggregate_row_key) !== seriesKey + '|' + period
    };
  }

  function logicalIndex_(targetRows, stageRows) {
    var headers = AKORT.AggregateContract.Headers.slice();
    var signatures = stageSeriesMap_(stageRows), affected = {}, unrelated = [], physicalRows = [], byRowKey = {};
    var duplicateLogicalRows = [], duplicatePhysicalRows = [];
    var monthlyPeriodLabelLogicalRows = [], monthlyPeriodLabelPhysicalRows = [];
    (stageRows || []).forEach(function (record) { affected[text_(record.aggregate_series_key)] = true; });
    (targetRows || []).forEach(function (row) {
      var series = signatures[publicSignature_(row)] || '';
      if (!series || !affected[series]) {
        unrelated.push(row);
        return;
      }
      var rowKey = series + '|' + periodKey_(row.frequency, row.period_start);
      if (monthlyPeriodLabelMismatch_(row)) {
        monthlyPeriodLabelLogicalRows.push(rowKey);
        monthlyPeriodLabelPhysicalRows.push(Number(row.__row || row._rowNumber || 0));
      }
      if (byRowKey[rowKey]) {
        var existingCanonical = stableStringify_(fingerprintRowValues_(byRowKey[rowKey], headers));
        var duplicateCanonical = stableStringify_(fingerprintRowValues_(row, headers));
        if (existingCanonical !== duplicateCanonical) {
          throw error_('AGGREGATE_TARGET_DUPLICATE_ROW_KEY_CONFLICT', 'Target contains conflicting rows for one aggregate logical key.', {
            retryable: false,
            requiresReview: true,
            rowKey: rowKey,
            existingRow: Number(byRowKey[rowKey].__row || byRowKey[rowKey]._rowNumber || 0),
            duplicateRow: Number(row.__row || row._rowNumber || 0),
            existingFingerprint: hash_(existingCanonical),
            duplicateFingerprint: hash_(duplicateCanonical)
          });
        }
        duplicateLogicalRows.push(rowKey);
        duplicatePhysicalRows.push(Number(row.__row || row._rowNumber || 0));
      } else {
        byRowKey[rowKey] = clone_(row);
      }
      physicalRows.push(Number(row.__row || row._rowNumber || 0));
    });
    return {
      affectedSeries: affected,
      byRowKey: byRowKey,
      unrelatedRows: unrelated,
      physicalRows: physicalRows.filter(function (rowNumber) { return rowNumber > 1; }),
      duplicateLogicalRows: duplicateLogicalRows.sort(),
      duplicatePhysicalRows: duplicatePhysicalRows.filter(function (rowNumber) { return rowNumber > 1; }).sort(function (a, b) { return b - a; }),
      monthlyPeriodLabelLogicalRows: uniqueSorted_(monthlyPeriodLabelLogicalRows),
      monthlyPeriodLabelPhysicalRows: monthlyPeriodLabelPhysicalRows.filter(function (rowNumber) { return rowNumber > 1; }).sort(function (a, b) { return b - a; })
    };
  }

  function setLatest_(rows, seriesKeys) {
    var max = {};
    (rows || []).forEach(function (row) {
      var series = seriesKeys[publicSignature_(row)] || '', period = periodKey_(row.frequency, row.period_start);
      if (series && (!max[series] || period > max[series])) max[series] = period;
    });
    (rows || []).forEach(function (row) {
      var series = seriesKeys[publicSignature_(row)] || '', period = periodKey_(row.frequency, row.period_start);
      row.is_latest_period = series && max[series] === period ? 1 : 0;
    });
    return rows;
  }

  function buildSeriesReplacement(targetRows, stageRows) {
    var headers = AKORT.AggregateContract.Headers.slice();
    var index = logicalIndex_(targetRows, stageRows), signatures = stageSeriesMap_(stageRows), replacementMap = clone_(index.byRowKey);
    var sampleBySeries = {}, stagePeriodIdentityMismatches = [];
    Object.keys(index.byRowKey).sort().forEach(function (key) {
      var existingRow = index.byRowKey[key], existingSeries = signatures[publicSignature_(existingRow)] || '';
      if (existingSeries && !sampleBySeries[existingSeries]) sampleBySeries[existingSeries] = existingRow;
    });
    (stageRows || []).forEach(function (record) {
      var publicationIdentity = stagePublicationIdentity_(record);
      if (publicationIdentity.mismatch) {
        stagePeriodIdentityMismatches.push({
          aggregateSeriesKey: publicationIdentity.seriesKey,
          stagedRowKey: publicationIdentity.stagedRowKey,
          publicationRowKey: publicationIdentity.rowKey,
          stagedPeriod: periodKey_(publicationIdentity.payload.frequency, record.period_start),
          publicationPeriod: publicationIdentity.period
        });
      }
      delete replacementMap[publicationIdentity.rowKey];
      if (text_(record.action) === 'UPSERT') {
        var payload = publicationIdentity.payload;
        var sample = sampleBySeries[text_(record.aggregate_series_key)];
        if (sample) {
          ['source_name', 'aggregate_name', 'product_group', 'product_name'].forEach(function (field) {
            if (text_(sample[field])) payload[field] = sample[field];
          });
        }
        replacementMap[publicationIdentity.rowKey] = payload;
      }
    });
    var replacement = Object.keys(replacementMap).sort().map(function (key) { return replacementMap[key]; });
    setLatest_(replacement, signatures);
    var keyForTarget = function (row) {
      var series = signatures[publicSignature_(row)] || '';
      return series + '|' + periodKey_(row.frequency, row.period_start);
    };
    var keyForUnrelated = function (row) {
      return publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start) + '|' + stableStringify_(rowValues_(row, headers));
    };
    var deletePhysicalRows = index.physicalRows.slice().sort(function (a, b) { return b - a; });
    return {
      affectedSeriesKeys: Object.keys(index.affectedSeries).sort(),
      beforeRows: Object.keys(index.byRowKey).sort().map(function (key) { return index.byRowKey[key]; }),
      replacementRows: replacement,
      deletePhysicalRows: deletePhysicalRows,
      beforeFingerprint: rowsFingerprint_(Object.keys(index.byRowKey).map(function (key) { return index.byRowKey[key]; }), headers, keyForTarget),
      afterFingerprint: rowsFingerprint_(replacement, headers, keyForTarget),
      unrelatedFingerprint: rowsFingerprint_(index.unrelatedRows, headers, keyForUnrelated),
      replacementRowCount: replacement.length,
      cellCount: replacement.length * headers.length,
      requestCount: deleteBlocks_(deletePhysicalRows).length + (replacement.length ? 1 : 0),
      requiresPhysicalRepair: index.duplicateLogicalRows.length > 0 || index.monthlyPeriodLabelLogicalRows.length > 0,
      requiresMonthlyPeriodLabelRepair: index.monthlyPeriodLabelLogicalRows.length > 0,
      monthlyPeriodLabelLogicalRows: index.monthlyPeriodLabelLogicalRows.slice(),
      monthlyPeriodLabelPhysicalRows: index.monthlyPeriodLabelPhysicalRows.slice(),
      monthlyPeriodLabelMismatchCount: index.monthlyPeriodLabelPhysicalRows.length,
      requiresStagePeriodIdentityRepair: stagePeriodIdentityMismatches.length > 0,
      stagePeriodIdentityMismatches: stagePeriodIdentityMismatches,
      stagePeriodIdentityMismatchCount: stagePeriodIdentityMismatches.length,
      exactDuplicateLogicalRows: index.duplicateLogicalRows.slice(),
      exactDuplicatePhysicalRows: index.duplicatePhysicalRows.slice(),
      exactDuplicateRowCount: index.duplicatePhysicalRows.length
    };
  }

  function atomicSeriesBatches_(targetRows, stageRows, limits) {
    var signatures = stageSeriesMap_(stageRows), finalKeys = {}, series = {};
    (stageRows || []).forEach(function (record) {
      var key = text_(record.aggregate_series_key);
      if (key) series[key] = true;
    });
    Object.keys(series).forEach(function (key) { finalKeys[key] = {}; });
    (targetRows || []).forEach(function (row) {
      var key = signatures[publicSignature_(row)] || '';
      if (!series[key]) return;
      finalKeys[key][key + '|' + periodKey_(row.frequency, row.period_start)] = true;
    });
    (stageRows || []).forEach(function (record) {
      var identity = stagePublicationIdentity_(record), key = identity.seriesKey;
      if (text_(record.action) === 'UPSERT') finalKeys[key][identity.rowKey] = true;
      else delete finalKeys[key][identity.rowKey];
    });
    var maxRows = Math.max(1, Number(limits.atomicMaxRows || 1));
    var maxCellsRows = Math.max(1, Math.floor(Number(limits.atomicMaxCells || 29) / AKORT.AggregateContract.Headers.length));
    var rowCapacity = Math.max(1, Math.min(maxRows, maxCellsRows));
    var requestCapacity = Math.max(1, Number(limits.atomicMaxRequests || 1) - 1);
    var batches = [], current = [], currentRows = 0;
    Object.keys(series).sort().forEach(function (seriesKey) {
      var rows = Object.keys(finalKeys[seriesKey] || {}).length;
      if (rows > rowCapacity) {
        throw error_('AGGREGATE_PUBLISH_SINGLE_SERIES_LIMIT_EXCEEDED', 'One complete aggregate logical series exceeds the atomic publication limit.', {
          retryable: false,
          aggregateSeriesKey: seriesKey,
          replacementRows: rows,
          rowCapacity: rowCapacity
        });
      }
      if (current.length && (currentRows + rows > rowCapacity || current.length + 1 > requestCapacity)) {
        batches.push(current);
        current = [];
        currentRows = 0;
      }
      current.push(seriesKey);
      currentRows += rows;
    });
    if (current.length) batches.push(current);
    return batches;
  }

  function classifyRecovery(beforeFingerprint, afterFingerprint, currentFingerprint) {
    if (text_(currentFingerprint) === text_(afterFingerprint)) return 'AFTER';
    if (text_(currentFingerprint) === text_(beforeFingerprint)) return 'BEFORE';
    return 'THIRD_STATE';
  }

  function currentAffectedFingerprint(targetRows, stageRows) {
    var replacement = buildSeriesReplacement(targetRows, stageRows);
    return replacement.beforeFingerprint;
  }

  function validateLatest(targetRows, stageRows) {
    var signatures = stageSeriesMap_(stageRows), affected = {}, counts = {}, max = {}, latestPeriods = {};
    (stageRows || []).forEach(function (record) { affected[text_(record.aggregate_series_key)] = true; });
    (targetRows || []).forEach(function (row) {
      var series = signatures[publicSignature_(row)] || '';
      if (!affected[series]) return;
      var period = periodKey_(row.frequency, row.period_start);
      if (!max[series] || period > max[series]) max[series] = period;
      if (Number(row.is_latest_period || 0) === 1) {
        counts[series] = Number(counts[series] || 0) + 1;
        latestPeriods[series] = period;
      }
    });
    var failures = [];
    Object.keys(affected).sort().forEach(function (series) {
      if (max[series] && Number(counts[series] || 0) !== 1) failures.push({ seriesKey: series, code: 'LATEST_COUNT', actual: Number(counts[series] || 0) });
      if (max[series] && latestPeriods[series] !== max[series]) failures.push({ seriesKey: series, code: 'LATEST_PERIOD', expected: max[series], actual: latestPeriods[series] || '' });
    });
    return { ok: failures.length === 0, failures: failures, seriesCount: Object.keys(affected).length };
  }

  function reconcileTarget(targetRows, stageRows, intent) {
    var current = currentAffectedFingerprint(targetRows, stageRows);
    var latest = validateLatest(targetRows, stageRows);
    var replacement = buildSeriesReplacement(targetRows, stageRows);
    var failures = [];
    if (current !== text_(intent.afterFingerprint)) failures.push({ code: 'AFFECTED_FINGERPRINT', expected: intent.afterFingerprint, actual: current });
    if (replacement.unrelatedFingerprint !== text_(intent.unrelatedFingerprint)) failures.push({ code: 'UNRELATED_FINGERPRINT', expected: intent.unrelatedFingerprint, actual: replacement.unrelatedFingerprint });
    if (replacement.requiresPhysicalRepair) failures.push({
      code: 'EXACT_DUPLICATE_ROWS',
      logicalRows: replacement.exactDuplicateLogicalRows.length,
      excessPhysicalRows: replacement.exactDuplicateRowCount
    });
    if (!latest.ok) failures.push({ code: 'LATEST_INVALID', details: latest.failures });
    return {
      ok: failures.length === 0,
      failures: failures,
      affectedFingerprint: current,
      unrelatedFingerprint: replacement.unrelatedFingerprint,
      latest: latest
    };
  }

  function runtimeSettings_(adapter) {
    var supplied = adapter && typeof adapter.runtimeSettings === 'function' ? adapter.runtimeSettings() : {};
    return {
      executionEnabled: truthy_(supplied.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
      regularPipelineEnabled: truthy_(supplied.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED),
      calculationGroupsPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_CALCULATION_GROUPS_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_CALCULATION_GROUPS_PER_STEP)),
      atomicMaxRows: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS || SETTINGS.PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS)),
      atomicMaxCells: Math.max(29, Number(supplied.PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS || SETTINGS.PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS)),
      atomicMaxRequests: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS || SETTINGS.PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS)),
      artifactChunkChars: Math.max(1000, Number(supplied.PUBLISH_AGGREGATE_ARTIFACT_CHUNK_CHARS || SETTINGS.PUBLISH_AGGREGATE_ARTIFACT_CHUNK_CHARS)),
      artifactChunksPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_ARTIFACT_CHUNKS_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_ARTIFACT_CHUNKS_PER_STEP)),
      materializationCombosPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_MATERIALIZATION_COMBOS_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_MATERIALIZATION_COMBOS_PER_STEP)),
      stageValidationRowsPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_STAGE_VALIDATION_ROWS_PER_STEP)),
      publicationSeriesPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_PUBLICATION_SERIES_PER_STEP)),
      latestSeriesPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_LATEST_SERIES_PER_STEP)),
      reconciliationSeriesPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_RECONCILIATION_SERIES_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_RECONCILIATION_SERIES_PER_STEP)),
      stageStatusRowsPerStep: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_STAGE_STATUS_ROWS_PER_STEP || SETTINGS.PUBLISH_AGGREGATE_STAGE_STATUS_ROWS_PER_STEP)),
      monolithicComboLimit: Math.max(1, Number(supplied.PUBLISH_AGGREGATE_MONOLITHIC_COMBO_LIMIT || SETTINGS.PUBLISH_AGGREGATE_MONOLITHIC_COMBO_LIMIT))
    };
  }

  function refreshRuntimeSettings_(state, adapter) {
    var current = runtimeSettings_(adapter), existing = state.runtimeSettings || {};
    Object.keys(current).forEach(function (key) {
      if (existing[key] === undefined || key === 'executionEnabled' || key === 'regularPipelineEnabled') {
        existing[key] = current[key];
      }
    });
    state.runtimeSettings = existing;
    return existing;
  }

  function stageRowsForSeries_(stageRows, seriesKeys) {
    var selected = {};
    (seriesKeys || []).forEach(function (key) { selected[text_(key)] = true; });
    return (stageRows || []).filter(function (record) {
      return selected[text_(record.aggregate_series_key)] === true;
    });
  }

  function boundedSeriesSlice_(stageRows, seriesKeys, cursor, maxSeries) {
    var keys = (seriesKeys || []).slice().sort();
    var start = Math.max(0, Number(cursor || 0));
    var end = Math.min(keys.length, start + Math.max(1, Number(maxSeries || 1)));
    var selectedKeys = keys.slice(start, end);
    return {
      start: start,
      end: end,
      total: keys.length,
      seriesKeys: selectedKeys,
      stageRows: stageRowsForSeries_(stageRows, selectedKeys)
    };
  }

  function boundedReplacement_(adapter, staged, state, cursor, maxSeries) {
    var attemptSize = Math.max(1, Number(maxSeries || 1));
    while (attemptSize >= 1) {
      var slice = boundedSeriesSlice_(staged, state.affectedSeriesKeys, cursor, attemptSize);
      var targetRows = adapter.readTargetRowsForStage(slice.stageRows);
      var replacement = buildSeriesReplacement(targetRows, slice.stageRows);
      if (replacement.replacementRowCount <= state.runtimeSettings.atomicMaxRows &&
          replacement.cellCount <= state.runtimeSettings.atomicMaxCells &&
          replacement.requestCount <= state.runtimeSettings.atomicMaxRequests) {
        return { slice: slice, targetRows: targetRows, replacement: replacement };
      }
      if (attemptSize === 1) {
        throw error_('AGGREGATE_PUBLISH_SINGLE_SERIES_LIMIT_EXCEEDED', 'One complete aggregate logical series exceeds the configured atomic boundary.', {
          retryable: false,
          seriesKey: slice.seriesKeys[0] || '',
          replacementRows: replacement.replacementRowCount,
          cells: replacement.cellCount,
          requests: replacement.requestCount,
          maxRows: state.runtimeSettings.atomicMaxRows,
          maxCells: state.runtimeSettings.atomicMaxCells,
          maxRequests: state.runtimeSettings.atomicMaxRequests
        });
      }
      attemptSize = Math.max(1, Math.floor(attemptSize / 2));
    }
    throw error_('AGGREGATE_BOUNDED_REPLACEMENT_UNAVAILABLE', 'No bounded aggregate replacement could be prepared.', { retryable: false });
  }

  function batchIntentKey_(start, end) {
    return 'SERIES_' + ('000000' + String(Number(start || 0) + 1)).slice(-6) + '_' + ('000000' + String(Number(end || 0))).slice(-6);
  }

  function compositeFingerprint_(batches, field) {
    return hash_((batches || []).map(function (batch) {
      return text_(batch.key) + ':' + text_(batch[field]);
    }).sort());
  }

  function identity_(context, options, state) {
    var operation = context.operation || {};
    var loadId = text_(options.loadId || state.loadId);
    return {
      operationId: text_(operation.operation_id),
      loadId: loadId,
      planId: text_(state.planId),
      planFingerprint: text_(state.planFingerprint)
    };
  }

  function noOpState_(state) {
    return state.status === 'SKIPPED_DISABLED' || state.status === 'SKIPPED_TEST' || state.status === 'NO_AGGREGATE_IMPACT';
  }

  function execute(phase, context, options) {
    options = options || {};
    var adapter = options.adapter || DefaultAdapter;
    var checkpoint = context.checkpoint || {};
    checkpoint.aggregate = checkpoint.aggregate || {
      schemaVersion: STAGE_SCHEMA_VERSION,
      status: 'NOT_STARTED',
      calculationCursor: 0,
      stagingCursor: 0,
      batchNo: 0
    };
    var state = checkpoint.aggregate;
    var operationId = text_(context.operation && context.operation.operation_id);
    var loadId = text_(options.loadId || state.loadId);
    if (!operationId || !loadId) {
      throw error_('AGGREGATE_OPERATION_IDENTITY_MISSING', 'Aggregate phase requires operation_id and load_id.', { retryable: false });
    }
    state.loadId = loadId;
    if (phase !== 'PREPARING_AGGREGATE_IMPACT') refreshRuntimeSettings_(state, adapter);

    if (phase === 'PREPARING_AGGREGATE_IMPACT') {
      var settings = runtimeSettings_(adapter);
      state.runtimeSettings = settings;
      if (options.testOnly === true) {
        state.status = 'SKIPPED_TEST';
        return { skipped: true, reason: 'Compatibility smoke-test isolation' };
      }
      if (!settings.executionEnabled || !settings.regularPipelineEnabled) {
        state.status = 'SKIPPED_DISABLED';
        return {
          skipped: true,
          reason: 'Aggregate execution is disabled by the Alpha.7.4 two-flag gate.',
          executionEnabled: settings.executionEnabled,
          regularPipelineEnabled: settings.regularPipelineEnabled
        };
      }
      var prepared = normalizeImpactRecords(adapter.readImpactRecords(operationId, loadId), operationId, loadId);
      state.impactFingerprint = prepared.fingerprint;
      state.impactRecordCount = prepared.recordCount;
      state.aggregateComboCount = prepared.aggregateComboCount;
      if (!prepared.aggregateComboCount) {
        state.status = 'NO_AGGREGATE_IMPACT';
        return { aggregateImpact: false, records: prepared.recordCount, aggregateCombos: 0 };
      }
      state.status = 'IMPACT_PREPARED';
      return {
        aggregateImpact: true,
        records: prepared.recordCount,
        aggregateCombos: prepared.aggregateComboCount,
        impactFingerprint: prepared.fingerprint
      };
    }

    if (noOpState_(state)) {
      if (phase === 'FINALIZING' && state.status !== 'SKIPPED_TEST' && typeof adapter.finalize === 'function') {
        adapter.finalize(identity_(context, options, state), state);
      }
      return { skipped: true, status: state.status };
    }

    if (phase === 'MATERIALIZING_AGGREGATE_INPUTS') {
      var currentPrepared = normalizeImpactRecords(adapter.readImpactRecords(operationId, loadId), operationId, loadId);
      if (currentPrepared.fingerprint !== state.impactFingerprint) {
        throw error_('AGGREGATE_IMPACT_CHANGED', 'PUBLISH_IMPACT changed after the immutable planner checkpoint.', { retryable: false });
      }
      if (typeof adapter.materializeArtifactChunk === 'function') {
        var materialization = adapter.materializeArtifactChunk(currentPrepared, {
          operationId: operationId,
          loadId: loadId,
          mode: options.mode || 'REVISION',
          reversal: clone_(options.reversal || null)
        }, Number(state.materializationCursor || 0), state.runtimeSettings.materializationCombosPerStep);
        var boundedArtifact = materialization && materialization.artifact;
        if (!boundedArtifact || !boundedArtifact.plan || boundedArtifact.plan.ok !== true) {
          throw error_('AGGREGATE_PLAN_FAILED', 'Bounded aggregate materialization did not produce an accepted immutable plan.', {
            retryable: false,
            plan: boundedArtifact && boundedArtifact.plan || null
          });
        }
        var expectedPlanId = text_(boundedArtifact.plan.plan_id);
        var expectedPlanFingerprint = text_(boundedArtifact.plan.fingerprint);
        if (state.planId && (state.planId !== expectedPlanId || state.planFingerprint !== expectedPlanFingerprint)) {
          throw error_('AGGREGATE_INPUT_ARTIFACT_CHANGED', 'Bounded aggregate materialization changed its immutable plan identity.', {
            retryable: false,
            expectedPlanId: state.planId,
            actualPlanId: expectedPlanId,
            expectedPlanFingerprint: state.planFingerprint,
            actualPlanFingerprint: expectedPlanFingerprint
          });
        }
        state.planId = expectedPlanId;
        state.planFingerprint = expectedPlanFingerprint;
        state.weightSnapshotId = text_(boundedArtifact.plan.calculator_shared_input && boundedArtifact.plan.calculator_shared_input.weight_snapshot && boundedArtifact.plan.calculator_shared_input.weight_snapshot.snapshot_id);
        var boundedPersistence = adapter.upsertCalculatedRows(
          identity_(context, options, state),
          materialization.stageRows || []
        );
        state.materializationCursor = Number(materialization.cursor || 0);
        state.materializationTotal = Number(materialization.total || 0);
        state.precalculatedStageRows = true;
        if (materialization.complete !== true) {
          state.status = 'MATERIALIZING_INPUTS';
          return {
            workSchemaVersion: BOUNDED_WORK_VERSION,
            materializationCursor: state.materializationCursor,
            materializationTotal: state.materializationTotal,
            combosProcessed: Number(materialization.combosProcessed || 0),
            stagePersistence: boundedPersistence,
            repeatPhase: true
          };
        }
        boundedArtifact.calculationGroups = [];
        boundedArtifact.fingerprint = artifactFingerprint_(boundedArtifact);
        if (state.inputArtifactFingerprint && state.inputArtifactFingerprint !== boundedArtifact.fingerprint) {
          throw error_('AGGREGATE_INPUT_ARTIFACT_CHANGED', 'Completed bounded input artifact differs from its durable fingerprint.', {
            retryable: false,
            expected: state.inputArtifactFingerprint,
            actual: boundedArtifact.fingerprint
          });
        }
        state.inputArtifactFingerprint = boundedArtifact.fingerprint;
        state.calculationGroupCount = adapter.readCalculatedRows(identity_(context, options, state)).length;
        var boundedArtifactPersistence = adapter.persistInputArtifact(
          identity_(context, options, state),
          boundedArtifact,
          state.runtimeSettings.artifactChunkChars,
          state.runtimeSettings.artifactChunksPerStep
        );
        state.artifactPersistence = clone_(boundedArtifactPersistence);
        state.status = boundedArtifactPersistence.complete ? 'INPUTS_MATERIALIZED' : 'MATERIALIZING_INPUTS';
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          planId: state.planId,
          planFingerprint: state.planFingerprint,
          artifactFingerprint: state.inputArtifactFingerprint,
          calculationGroups: state.calculationGroupCount,
          materializationCursor: state.materializationCursor,
          materializationTotal: state.materializationTotal,
          artifactPersistence: boundedArtifactPersistence,
          repeatPhase: boundedArtifactPersistence.complete !== true
        };
      }
      if (currentPrepared.aggregateComboCount > state.runtimeSettings.monolithicComboLimit) {
        throw error_('AGGREGATE_MONOLITHIC_MATERIALIZATION_FORBIDDEN', 'Large aggregate materialization requires a durable bounded adapter.', {
          retryable: false,
          aggregateCombos: currentPrepared.aggregateComboCount,
          monolithicComboLimit: state.runtimeSettings.monolithicComboLimit
        });
      }
      var artifact = adapter.materializeArtifact(currentPrepared, {
        operationId: operationId,
        loadId: loadId,
        mode: options.mode || 'REVISION',
        reversal: clone_(options.reversal || null)
      });
      if (!artifact || !artifact.plan || artifact.plan.ok !== true) {
        throw error_('AGGREGATE_PLAN_FAILED', 'Alpha.7.3 rejected the aggregate planner request.', {
          retryable: false,
          plan: artifact && artifact.plan || null
        });
      }
      artifact.calculationGroups = calculationGroups_(artifact.plan.calculator_batches || []);
      artifact.fingerprint = artifactFingerprint_(artifact);
      if (state.planId && (state.planId !== text_(artifact.plan.plan_id) ||
          state.planFingerprint !== text_(artifact.plan.fingerprint) ||
          state.inputArtifactFingerprint !== artifact.fingerprint)) {
        throw error_('AGGREGATE_INPUT_ARTIFACT_CHANGED', 'Re-materialized aggregate input differs from the persisted immutable plan.', {
          retryable: false,
          expectedPlanId: state.planId,
          actualPlanId: artifact.plan.plan_id,
          expectedPlanFingerprint: state.planFingerprint,
          actualPlanFingerprint: artifact.plan.fingerprint
        });
      }
      state.planId = text_(artifact.plan.plan_id);
      state.planFingerprint = text_(artifact.plan.fingerprint);
      state.inputArtifactFingerprint = artifact.fingerprint;
      state.calculationGroupCount = artifact.prebuiltStageRows
        ? artifact.prebuiltStageRows.length
        : artifact.calculationGroups.length;
      state.weightSnapshotId = text_(artifact.plan.calculator_shared_input && artifact.plan.calculator_shared_input.weight_snapshot && artifact.plan.calculator_shared_input.weight_snapshot.snapshot_id);
      var artifactPersistence = adapter.persistInputArtifact(
        identity_(context, options, state),
        artifact,
        state.runtimeSettings.artifactChunkChars,
        state.runtimeSettings.artifactChunksPerStep
      );
      state.artifactPersistence = clone_(artifactPersistence);
      state.status = artifactPersistence.complete ? 'INPUTS_MATERIALIZED' : 'MATERIALIZING_INPUTS';
      return {
        planId: state.planId,
        planFingerprint: state.planFingerprint,
        artifactFingerprint: state.inputArtifactFingerprint,
        calculationGroups: state.calculationGroupCount,
        artifactPersistence: artifactPersistence,
        repeatPhase: artifactPersistence.complete !== true
      };
    }

    if (phase === 'CALCULATING_AGGREGATE_SLICES') {
      var storedArtifact = adapter.readInputArtifact(identity_(context, options, state));
      if (!storedArtifact || artifactFingerprint_(storedArtifact) !== state.inputArtifactFingerprint) {
        throw error_('AGGREGATE_INPUT_ARTIFACT_CHANGED', 'Durable aggregate input artifact is missing or changed.', { retryable: false });
      }
      if (storedArtifact.precalculatedStageRows === true || state.precalculatedStageRows === true) {
        state.calculationCursor = Number(state.calculationGroupCount || 0);
        state.status = 'CALCULATED';
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          adapterMode: storedArtifact.adapterMode || ACCEPTED_PARITY_ADAPTER_MODE,
          calculationGroupsProcessed: 0,
          calculationCursor: state.calculationCursor,
          calculationGroupsTotal: state.calculationCursor,
          stageRowsProcessed: 0,
          precalculatedStageRows: true,
          repeatPhase: false
        };
      }
      if (Array.isArray(storedArtifact.prebuiltStageRows)) {
        var directRows = storedArtifact.prebuiltStageRows;
        var directStart = Math.max(0, Number(state.calculationCursor || 0));
        var directChunkSize = Math.max(250, Number(state.runtimeSettings.calculationGroupsPerStep || 1) * 250);
        var directEnd = Math.min(directRows.length, directStart + directChunkSize);
        var directPersisted = adapter.upsertCalculatedRows(
          identity_(context, options, state),
          directRows.slice(directStart, directEnd)
        );
        state.calculationCursor = directEnd;
        state.batchNo = Number(state.batchNo || 0) + 1;
        state.status = directEnd < directRows.length ? 'CALCULATING' : 'CALCULATED';
        return {
          adapterMode: storedArtifact.adapterMode || ACCEPTED_PARITY_ADAPTER_MODE,
          calculationGroupsProcessed: directEnd - directStart,
          calculationCursor: directEnd,
          calculationGroupsTotal: directRows.length,
          stageRowsProcessed: directEnd - directStart,
          stagePersistence: directPersisted,
          repeatPhase: directEnd < directRows.length
        };
      }
      var groups = storedArtifact.calculationGroups || [];
      var start = Math.max(0, Number(state.calculationCursor || 0));
      var end = Math.min(groups.length, start + state.runtimeSettings.calculationGroupsPerStep);
      var records = [];
      for (var groupIndex = start; groupIndex < end; groupIndex += 1) {
        var group = groups[groupIndex];
        var calculationId = 'A74_CALC_' + hash_([state.planId, groupIndex, group.groupKey]).slice(0, 20).toUpperCase();
        var request = hydrateGroupRequest_(
          group,
          storedArtifact.plan.calculator_shared_input,
          AKORT.AggregateContract.Version,
          calculationId
        );
        var calculated = AKORT.AggregateCalculator.calculateBatch(request);
        if (!calculated.ok) {
          throw error_('AGGREGATE_CALCULATION_FAILED', 'Frozen Alpha.7.2 calculator rejected a bounded calculation group.', {
            retryable: false,
            calculationId: calculationId,
            diagnostics: calculated.diagnostics || []
          });
        }
        (calculated.rows || []).forEach(function (row) {
          var publishMetadata = clone_(
            storedArtifact.publishMetadata && (
              storedArtifact.publishMetadata.bySeries && storedArtifact.publishMetadata.bySeries[text_(row.aggregate_series_key)] ||
              storedArtifact.publishMetadata.bySubject && storedArtifact.publishMetadata.bySubject[text_(row.aggregate_subject_id)]
            ) || {}
          );
          var categoryMetadataKey = [
            text_(row.dataset_code),
            text_(row.frequency).toLowerCase(),
            text_(row.category_id)
          ].join('|');
          var categoryMetadata = storedArtifact.categoryMetadata && storedArtifact.categoryMetadata[categoryMetadataKey] || {};
          var periodLabelKey = [
            text_(row.dataset_code),
            text_(row.frequency).toLowerCase(),
            periodKey_(row.frequency, row.period_start)
          ].join('|');
          records.push(buildStageRecord(row, {
            operationId: operationId,
            loadId: loadId,
            planId: state.planId,
            planFingerprint: state.planFingerprint,
            calculationId: calculationId,
            weightSnapshotId: state.weightSnapshotId,
            sourceName: publishMetadata.source_name ||
              storedArtifact.sourceNames && storedArtifact.sourceNames[text_(row.dataset_code)] || '',
            weightSource: publishMetadata.weight_source || '',
            aggregateName: publishMetadata.aggregate_name || '',
            productGroup: publishMetadata.product_group || categoryMetadata.product_group || '',
            productName: publishMetadata.product_name || categoryMetadata.product_name || '',
            periodLabel: publishMetadata.period_label ||
              storedArtifact.periodLabels && storedArtifact.periodLabels[periodLabelKey] || ''
          }));
        });
      }
      var persisted = adapter.upsertCalculatedRows(identity_(context, options, state), records);
      state.calculationCursor = end;
      state.batchNo = Number(state.batchNo || 0) + 1;
      state.status = end < groups.length ? 'CALCULATING' : 'CALCULATED';
      return {
        calculationGroupsProcessed: end - start,
        calculationCursor: end,
        calculationGroupsTotal: groups.length,
        stageRowsProcessed: records.length,
        stagePersistence: persisted,
        repeatPhase: end < groups.length
      };
    }

    if (phase === 'STAGING_AGGREGATE_ROWS') {
      var stageRows = adapter.readCalculatedRows(identity_(context, options, state));
      var validation = validateStageRowsChunk_(
        stageRows,
        identity_(context, options, state),
        Number(state.stagingCursor || 0),
        state.runtimeSettings.stageValidationRowsPerStep
      );
      if (state.stageFingerprint && (state.stageFingerprint !== validation.stageFingerprint ||
          Number(state.expectedStageRows || 0) !== validation.rowCount)) {
        throw error_('AGGREGATE_STAGE_CHANGED', 'Aggregate stage changed during bounded validation.', {
          retryable: false,
          expectedRows: Number(state.expectedStageRows || 0),
          actualRows: validation.rowCount,
          expectedFingerprint: state.stageFingerprint,
          actualFingerprint: validation.stageFingerprint
        });
      }
      state.expectedStageRows = validation.rowCount;
      state.affectedSeriesKeys = validation.seriesKeys;
      state.stageFingerprint = validation.stageFingerprint;
      state.stagingCursor = validation.cursor;
      state.status = validation.complete ? 'STAGE_VALIDATED' : 'VALIDATING_STAGE';
      if (!validation.complete) {
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          validationCursor: validation.cursor,
          validationTotal: validation.total,
          rowsValidated: validation.rowsValidated,
          repeatPhase: true
        };
      }
      if (typeof adapter.updateStageStatusChunk === 'function') {
        var stageStatus = adapter.updateStageStatusChunk(
          identity_(context, options, state),
          'STAGED',
          '',
          Number(state.stageStatusCursor || 0),
          state.runtimeSettings.stageStatusRowsPerStep
        );
        state.stageStatusCursor = Number(stageStatus.cursor || 0);
        state.status = stageStatus.complete ? 'STAGED' : 'MARKING_STAGE';
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          rowCount: validation.rowCount,
          seriesCount: validation.seriesCount,
          stageFingerprint: validation.stageFingerprint,
          validationCursor: validation.cursor,
          validationTotal: validation.total,
          stageStatusCursor: state.stageStatusCursor,
          stageStatusTotal: Number(stageStatus.total || 0),
          repeatPhase: stageStatus.complete !== true
        };
      }
      adapter.updateStageStatus(identity_(context, options, state), 'STAGED', '');
      state.status = 'STAGED';
      return validation;
    }

    if (phase === 'UPDATING_AGGREGATES') {
      var staged = adapter.readCalculatedRows(identity_(context, options, state));
      assertValidatedStageSnapshot_(staged, identity_(context, options, state), state);
      var identity = identity_(context, options, state);
      if (typeof adapter.readTargetRowsForStage === 'function') {
        var seriesCursor = Math.max(0, Number(state.publishSeriesCursor || 0));
        var seriesTotal = (state.affectedSeriesKeys || []).length;
        if (seriesCursor < seriesTotal) {
          var bounded = boundedReplacement_(
            adapter,
            staged,
            state,
            seriesCursor,
            Math.min(
              state.runtimeSettings.publicationSeriesPerStep,
              state.runtimeSettings.reconciliationSeriesPerStep
            )
          );
          var boundedKey = batchIntentKey_(bounded.slice.start, bounded.slice.end);
          var boundedIntent = adapter.readPublishIntent(identity, boundedKey);
          if (!boundedIntent) {
            boundedIntent = {
              workSchemaVersion: BOUNDED_WORK_VERSION,
              beforeFingerprint: bounded.replacement.beforeFingerprint,
              afterFingerprint: bounded.replacement.afterFingerprint,
              unrelatedFingerprint: bounded.replacement.unrelatedFingerprint,
              affectedSeriesKeys: bounded.replacement.affectedSeriesKeys,
              stageFingerprint: state.stageFingerprint,
              seriesStart: bounded.slice.start,
              seriesEnd: bounded.slice.end,
              seriesTotal: bounded.slice.total,
              replacementRowCount: bounded.replacement.replacementRowCount,
              cellCount: bounded.replacement.cellCount,
              requestCount: bounded.replacement.requestCount,
              requiresPhysicalRepair: bounded.replacement.requiresPhysicalRepair,
              exactDuplicateLogicalRows: bounded.replacement.exactDuplicateLogicalRows.length,
              exactDuplicateRowCount: bounded.replacement.exactDuplicateRowCount,
              publicationMode: 'DURABLE_BOUNDED_LOGICAL_SERIES'
            };
            boundedIntent.fingerprint = hash_(boundedIntent);
            adapter.persistPublishIntent(identity, boundedIntent, boundedKey);
          }
          if (text_(boundedIntent.stageFingerprint) !== text_(state.stageFingerprint) ||
              Number(boundedIntent.seriesStart) !== bounded.slice.start ||
              Number(boundedIntent.seriesEnd) !== bounded.slice.end ||
              text_(boundedIntent.afterFingerprint) !== text_(bounded.replacement.afterFingerprint) ||
              JSON.stringify((boundedIntent.affectedSeriesKeys || []).slice().sort()) !== JSON.stringify(bounded.slice.seriesKeys.slice().sort())) {
            throw error_('AGGREGATE_PUBLISH_BATCH_PLAN_CHANGED', 'Durable bounded aggregate publication no longer matches its stage or series boundary.', {
              retryable: false,
              requiresReview: true,
              batchKey: boundedKey
            });
          }
          var boundedRecovery = classifyRecovery(
            boundedIntent.beforeFingerprint,
            boundedIntent.afterFingerprint,
            bounded.replacement.beforeFingerprint
          );
          if (boundedRecovery === 'THIRD_STATE') {
            throw error_('AGGREGATE_PUBLISH_THIRD_STATE', 'Bounded aggregate batch is neither its durable before-state nor expected after-state.', {
              retryable: false,
              requiresReview: true,
              batchKey: boundedKey,
              beforeFingerprint: boundedIntent.beforeFingerprint,
              afterFingerprint: boundedIntent.afterFingerprint,
              currentFingerprint: bounded.replacement.beforeFingerprint
            });
          }
          var boundedRepair = bounded.replacement.requiresPhysicalRepair === true;
          var boundedWrite = { noOp: true, apiCalls: 0, requests: 0 };
          if (boundedRecovery === 'BEFORE' || boundedRepair) {
            boundedWrite = adapter.atomicReplace(bounded.replacement, identity) || boundedWrite;
          }
          var boundedReadbackRows = adapter.readTargetRowsForStage(bounded.slice.stageRows);
          var boundedReadback = buildSeriesReplacement(boundedReadbackRows, bounded.slice.stageRows);
          if (boundedReadback.requiresPhysicalRepair || boundedReadback.beforeFingerprint !== boundedIntent.afterFingerprint) {
            throw error_('AGGREGATE_PUBLISH_READBACK_MISMATCH', 'Bounded aggregate publication did not produce its durable after-state.', {
              retryable: false,
              requiresReview: true,
              batchKey: boundedKey,
              expected: boundedIntent.afterFingerprint,
              actual: boundedReadback.beforeFingerprint,
              exactDuplicateLogicalRows: boundedReadback.exactDuplicateLogicalRows.length,
              exactDuplicateRowCount: boundedReadback.exactDuplicateRowCount
            });
          }
          state.publishBatches = state.publishBatches || [];
          state.publishBatches.push({
            key: boundedKey,
            start: bounded.slice.start,
            end: bounded.slice.end,
            beforeFingerprint: boundedIntent.beforeFingerprint,
            afterFingerprint: boundedIntent.afterFingerprint,
            unrelatedFingerprint: boundedIntent.unrelatedFingerprint,
            seriesCount: bounded.slice.seriesKeys.length,
            replacementRowCount: boundedIntent.replacementRowCount
          });
          state.publishSeriesCursor = bounded.slice.end;
          state.publishBatchesWritten = Number(state.publishBatchesWritten || 0) + (boundedRecovery === 'BEFORE' ? 1 : 0);
          state.publishBatchesRecovered = Number(state.publishBatchesRecovered || 0) + (boundedRecovery === 'AFTER' ? 1 : 0);
          state.atomicApiCalls = Number(state.atomicApiCalls || 0) + Number(boundedWrite.apiCalls || 0);
          state.atomicRequests = Number(state.atomicRequests || 0) + Number(boundedWrite.requests || 0);
          state.exactDuplicateLogicalRowsRepaired = Number(state.exactDuplicateLogicalRowsRepaired || 0) +
            (boundedRepair ? bounded.replacement.exactDuplicateLogicalRows.length : 0);
          state.exactDuplicateRowsRepaired = Number(state.exactDuplicateRowsRepaired || 0) +
            (boundedRepair ? bounded.replacement.exactDuplicateRowCount : 0);
          state.status = 'PUBLISHING';
          return {
            workSchemaVersion: BOUNDED_WORK_VERSION,
            repeatPhase: true,
            batchKey: boundedKey,
            seriesProcessed: bounded.slice.seriesKeys.length,
            seriesCursor: state.publishSeriesCursor,
            seriesTotal: bounded.slice.total,
            recoveryState: boundedRecovery,
            replacementRows: boundedIntent.replacementRowCount,
            targetAfterFingerprint: boundedIntent.afterFingerprint
          };
        }
        state.targetBeforeFingerprint = compositeFingerprint_(state.publishBatches || [], 'beforeFingerprint');
        state.targetAfterFingerprint = compositeFingerprint_(state.publishBatches || [], 'afterFingerprint');
        state.unrelatedFingerprint = compositeFingerprint_(state.publishBatches || [], 'unrelatedFingerprint');
        state.publishBatchCount = (state.publishBatches || []).length;
        state.publishIntentFingerprint = hash_(state.publishBatches || []);
        state.publishRecovery = Number(state.publishBatchesRecovered || 0) > 0
          ? 'BOUNDED_RECOVERY_VERIFIED'
          : Number(state.exactDuplicateRowsRepaired || 0) > 0
            ? 'BOUNDED_EXACT_DUPLICATES_REPAIRED_AND_VERIFIED'
            : 'BOUNDED_WRITE_VERIFIED';
        state.status = 'PUBLISHED';
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          repeatPhase: false,
          publishRecovery: state.publishRecovery,
          batches: state.publishBatchCount,
          batchesWritten: Number(state.publishBatchesWritten || 0),
          batchesRecovered: Number(state.publishBatchesRecovered || 0),
          exactDuplicateLogicalRowsRepaired: Number(state.exactDuplicateLogicalRowsRepaired || 0),
          exactDuplicateRowsRepaired: Number(state.exactDuplicateRowsRepaired || 0),
          targetAfterFingerprint: state.targetAfterFingerprint
        };
      }
      var targetRows = adapter.readTargetRows();
      var batches = atomicSeriesBatches_(targetRows, staged, state.runtimeSettings);
      var batchPlanFingerprint = hash_(batches);
      var overallReplacement = buildSeriesReplacement(targetRows, staged);
      var finalIntent = adapter.readPublishIntent(identity);
      if (!finalIntent) {
        finalIntent = {
          beforeFingerprint: overallReplacement.beforeFingerprint,
          afterFingerprint: overallReplacement.afterFingerprint,
          unrelatedFingerprint: overallReplacement.unrelatedFingerprint,
          affectedSeriesKeys: overallReplacement.affectedSeriesKeys,
          stageFingerprint: state.stageFingerprint,
          replacementRowCount: overallReplacement.replacementRowCount,
          cellCount: overallReplacement.cellCount,
          requestCount: overallReplacement.requestCount,
          requiresPhysicalRepair: overallReplacement.requiresPhysicalRepair,
          exactDuplicateLogicalRows: overallReplacement.exactDuplicateLogicalRows.length,
          exactDuplicateRowCount: overallReplacement.exactDuplicateRowCount,
          batchCount: batches.length,
          batchPlanFingerprint: batchPlanFingerprint,
          publicationMode: 'BOUNDED_ATOMIC_LOGICAL_SERIES_BATCHES'
        };
        finalIntent.fingerprint = hash_(finalIntent);
        adapter.persistPublishIntent(identity, finalIntent);
      }
      if (text_(finalIntent.stageFingerprint) !== text_(state.stageFingerprint) ||
          text_(finalIntent.batchPlanFingerprint) !== batchPlanFingerprint ||
          Number(finalIntent.batchCount || 0) !== batches.length ||
          text_(finalIntent.afterFingerprint) !== text_(overallReplacement.afterFingerprint) ||
          text_(finalIntent.unrelatedFingerprint) !== text_(overallReplacement.unrelatedFingerprint)) {
        throw error_('AGGREGATE_PUBLISH_BATCH_PLAN_CHANGED', 'The durable complete-series batch plan no longer matches the aggregate stage or target.', {
          retryable: false,
          requiresReview: true,
          expectedBatchPlanFingerprint: finalIntent.batchPlanFingerprint,
          actualBatchPlanFingerprint: batchPlanFingerprint,
          expectedAfterFingerprint: finalIntent.afterFingerprint,
          actualAfterFingerprint: overallReplacement.afterFingerprint
        });
      }
      state.publishIntentFingerprint = finalIntent.fingerprint;
      state.targetBeforeFingerprint = finalIntent.beforeFingerprint;
      state.targetAfterFingerprint = finalIntent.afterFingerprint;
      state.unrelatedFingerprint = finalIntent.unrelatedFingerprint;
      state.publishBatchCount = batches.length;
      state.publishBatchPlanFingerprint = batchPlanFingerprint;
      var batchCursor = Math.max(0, Number(state.publishBatchCursor || 0));
      if (batchCursor < batches.length) {
        var batchSeriesKeys = batches[batchCursor];
        var batchSeriesMap = {};
        batchSeriesKeys.forEach(function (key) { batchSeriesMap[key] = true; });
        var batchStage = staged.filter(function (record) {
          return batchSeriesMap[text_(record.aggregate_series_key)] === true;
        });
        var replacement = buildSeriesReplacement(targetRows, batchStage);
        if (replacement.replacementRowCount > state.runtimeSettings.atomicMaxRows ||
            replacement.cellCount > state.runtimeSettings.atomicMaxCells ||
            replacement.requestCount > state.runtimeSettings.atomicMaxRequests) {
          throw error_('AGGREGATE_PUBLISH_ATOMIC_LIMIT_EXCEEDED', 'A complete logical-series batch exceeds the configured atomic request limit.', {
            retryable: false,
            batch: batchCursor + 1,
            batchCount: batches.length,
            seriesCount: batchSeriesKeys.length,
            replacementRows: replacement.replacementRowCount,
            cells: replacement.cellCount,
            maxRows: state.runtimeSettings.atomicMaxRows,
            maxCells: state.runtimeSettings.atomicMaxCells,
            requests: replacement.requestCount,
            maxRequests: state.runtimeSettings.atomicMaxRequests
          });
        }
        var batchKey = 'BATCH_' + ('000000' + String(batchCursor + 1)).slice(-6);
        var batchIntent = adapter.readPublishIntent(identity, batchKey);
        if (!batchIntent) {
          batchIntent = {
            beforeFingerprint: replacement.beforeFingerprint,
            afterFingerprint: replacement.afterFingerprint,
            unrelatedFingerprint: replacement.unrelatedFingerprint,
            affectedSeriesKeys: replacement.affectedSeriesKeys,
            stageFingerprint: state.stageFingerprint,
            batchPlanFingerprint: batchPlanFingerprint,
            batch: batchCursor + 1,
            batchCount: batches.length,
            replacementRowCount: replacement.replacementRowCount,
            cellCount: replacement.cellCount,
            requestCount: replacement.requestCount,
            requiresPhysicalRepair: replacement.requiresPhysicalRepair,
            exactDuplicateLogicalRows: replacement.exactDuplicateLogicalRows.length,
            exactDuplicateRowCount: replacement.exactDuplicateRowCount
          };
          batchIntent.fingerprint = hash_(batchIntent);
          adapter.persistPublishIntent(identity, batchIntent, batchKey);
        }
        var recoveryState = classifyRecovery(batchIntent.beforeFingerprint, batchIntent.afterFingerprint, replacement.beforeFingerprint);
        if (recoveryState === 'THIRD_STATE') {
          throw error_('AGGREGATE_PUBLISH_THIRD_STATE', 'Aggregate batch is neither the persisted before-state nor the expected after-state.', {
            retryable: false,
            requiresReview: true,
            batch: batchCursor + 1,
            beforeFingerprint: batchIntent.beforeFingerprint,
            afterFingerprint: batchIntent.afterFingerprint,
            currentFingerprint: replacement.beforeFingerprint
          });
        }
        var repairedExactDuplicates = replacement.requiresPhysicalRepair === true;
        if (recoveryState === 'BEFORE' || repairedExactDuplicates) adapter.atomicReplace(replacement, identity);
        var batchAfterReplacement = buildSeriesReplacement(adapter.readTargetRows(), batchStage);
        if (batchAfterReplacement.requiresPhysicalRepair) {
          throw error_('AGGREGATE_ATOMIC_WRITE_UNCERTAIN', 'Atomic aggregate batch read-back still contains exact duplicate rows.', {
            retryable: true,
            batch: batchCursor + 1,
            exactDuplicateLogicalRows: batchAfterReplacement.exactDuplicateLogicalRows.length,
            exactDuplicateRowCount: batchAfterReplacement.exactDuplicateRowCount,
            expectedAfterFingerprint: batchIntent.afterFingerprint
          });
        }
        if (batchAfterReplacement.beforeFingerprint !== batchIntent.afterFingerprint) {
          throw error_('AGGREGATE_PUBLISH_READBACK_MISMATCH', 'Atomic aggregate batch write did not produce the expected fingerprint.', {
            retryable: false,
            requiresReview: true,
            batch: batchCursor + 1,
            expected: batchIntent.afterFingerprint,
            actual: batchAfterReplacement.beforeFingerprint
          });
        }
        state.publishBatchCursor = batchCursor + 1;
        state.publishBatchesWritten = Number(state.publishBatchesWritten || 0) + (recoveryState === 'BEFORE' ? 1 : 0);
        state.publishBatchesRecovered = Number(state.publishBatchesRecovered || 0) + (recoveryState === 'AFTER' ? 1 : 0);
        state.exactDuplicateLogicalRowsRepaired = Number(state.exactDuplicateLogicalRowsRepaired || 0) +
          (repairedExactDuplicates ? replacement.exactDuplicateLogicalRows.length : 0);
        state.exactDuplicateRowsRepaired = Number(state.exactDuplicateRowsRepaired || 0) +
          (repairedExactDuplicates ? replacement.exactDuplicateRowCount : 0);
        state.status = 'PUBLISHING';
        return {
          repeatPhase: true,
          batch: batchCursor + 1,
          batchCount: batches.length,
          seriesCount: batchSeriesKeys.length,
          recoveryState: recoveryState,
          replacementRows: batchIntent.replacementRowCount,
          targetAfterFingerprint: batchIntent.afterFingerprint
        };
      }
      var finalReadback = buildSeriesReplacement(targetRows, staged);
      if (finalReadback.requiresPhysicalRepair || finalReadback.beforeFingerprint !== finalIntent.afterFingerprint) {
        throw error_('AGGREGATE_PUBLISH_FINAL_READBACK_MISMATCH', 'Bounded aggregate batches did not produce the durable complete affected-set fingerprint.', {
          retryable: false,
          requiresReview: true,
          expected: finalIntent.afterFingerprint,
          actual: finalReadback.beforeFingerprint,
          exactDuplicateLogicalRows: finalReadback.exactDuplicateLogicalRows.length,
          exactDuplicateRowCount: finalReadback.exactDuplicateRowCount
        });
      }
      adapter.updateStageExpectedFingerprint(identity, finalIntent.afterFingerprint);
      state.publishRecovery = Number(state.publishBatchesRecovered || 0) > 0
        ? 'BATCHED_RECOVERY_VERIFIED'
        : Number(state.exactDuplicateRowsRepaired || 0) > 0
          ? 'BATCHED_EXACT_DUPLICATES_REPAIRED_AND_VERIFIED'
          : 'BATCHED_WRITE_VERIFIED';
      state.status = 'PUBLISHED';
      return {
        repeatPhase: false,
        publishRecovery: state.publishRecovery,
        batches: batches.length,
        batchesWritten: Number(state.publishBatchesWritten || 0),
        batchesRecovered: Number(state.publishBatchesRecovered || 0),
        replacementRows: finalIntent.replacementRowCount,
        exactDuplicateLogicalRowsRepaired: Number(state.exactDuplicateLogicalRowsRepaired || 0),
        exactDuplicateRowsRepaired: Number(state.exactDuplicateRowsRepaired || 0),
        targetAfterFingerprint: finalIntent.afterFingerprint
      };
    }

    if (phase === 'UPDATING_AGGREGATE_LATEST') {
      var latestStage = adapter.readCalculatedRows(identity_(context, options, state));
      assertValidatedStageSnapshot_(latestStage, identity_(context, options, state), state);
      if (typeof adapter.readTargetRowsForStage === 'function') {
        var latestSlice = boundedSeriesSlice_(
          latestStage,
          state.affectedSeriesKeys,
          Number(state.latestSeriesCursor || 0),
          state.runtimeSettings.latestSeriesPerStep
        );
        if (latestSlice.start < latestSlice.total) {
          var boundedLatest = validateLatest(adapter.readTargetRowsForStage(latestSlice.stageRows), latestSlice.stageRows);
          if (!boundedLatest.ok) {
            throw error_('AGGREGATE_LATEST_RECONCILIATION_FAILED', 'A bounded aggregate latest batch violates the frozen contract.', {
              retryable: false,
              requiresReview: true,
              seriesStart: latestSlice.start,
              seriesEnd: latestSlice.end,
              failures: boundedLatest.failures
            });
          }
          state.latestSeriesCursor = latestSlice.end;
          state.latestSeriesVerified = Number(state.latestSeriesVerified || 0) + boundedLatest.seriesCount;
          state.latestVerified = latestSlice.end >= latestSlice.total;
          return {
            workSchemaVersion: BOUNDED_WORK_VERSION,
            ok: true,
            seriesProcessed: boundedLatest.seriesCount,
            seriesCursor: latestSlice.end,
            seriesTotal: latestSlice.total,
            repeatPhase: latestSlice.end < latestSlice.total
          };
        }
        state.latestVerified = true;
        return {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          ok: true,
          seriesProcessed: 0,
          seriesCursor: latestSlice.end,
          seriesTotal: latestSlice.total,
          repeatPhase: false
        };
      }
      var latestCheck = validateLatest(adapter.readTargetRows(), latestStage);
      if (!latestCheck.ok) {
        throw error_('AGGREGATE_LATEST_RECONCILIATION_FAILED', 'Published aggregate latest flags violate the frozen contract.', {
          retryable: false,
          requiresReview: true,
          failures: latestCheck.failures
        });
      }
      state.latestVerified = true;
      return latestCheck;
    }

    if (phase === 'RECONCILING_AGGREGATES') {
      var reconcileStage = adapter.readCalculatedRows(identity_(context, options, state));
      assertValidatedStageSnapshot_(reconcileStage, identity_(context, options, state), state);
      if (typeof adapter.readTargetRowsForStage === 'function') {
        var reconcileBatches = state.publishBatches || [];
        var reconciliationCursor = Math.max(0, Number(state.reconciliationBatchCursor || 0));
        if (reconciliationCursor < reconcileBatches.length) {
          var reconcileBatch = reconcileBatches[reconciliationCursor];
          var reconcileKeys = (state.affectedSeriesKeys || []).slice().sort().slice(reconcileBatch.start, reconcileBatch.end);
          var reconcileBatchStage = stageRowsForSeries_(reconcileStage, reconcileKeys);
          var reconcileBatchIntent = adapter.readPublishIntent(identity_(context, options, state), reconcileBatch.key);
          if (!reconcileBatchIntent) {
            throw error_('AGGREGATE_PUBLISH_INTENT_MISSING', 'Bounded reconciliation cannot find its durable publication intent.', {
              retryable: false,
              batchKey: reconcileBatch.key
            });
          }
          var reconcileTargetRows = adapter.readTargetRowsForStage(reconcileBatchStage);
          var reconcileReplacement = buildSeriesReplacement(reconcileTargetRows, reconcileBatchStage);
          var reconcileLatest = validateLatest(reconcileTargetRows, reconcileBatchStage);
          var reconcileFailures = [];
          if (reconcileReplacement.requiresPhysicalRepair) reconcileFailures.push({
            code: 'EXACT_DUPLICATE_ROWS',
            logicalRows: reconcileReplacement.exactDuplicateLogicalRows.length,
            excessPhysicalRows: reconcileReplacement.exactDuplicateRowCount
          });
          if (reconcileReplacement.beforeFingerprint !== text_(reconcileBatchIntent.afterFingerprint)) {
            reconcileFailures.push({
              code: 'AFFECTED_FINGERPRINT',
              expected: reconcileBatchIntent.afterFingerprint,
              actual: reconcileReplacement.beforeFingerprint
            });
          }
          if (!reconcileLatest.ok) reconcileFailures.push({ code: 'LATEST_INVALID', details: reconcileLatest.failures });
          if (reconcileFailures.length) {
            throw error_('AGGREGATE_RECONCILIATION_FAILED', 'A bounded aggregate batch failed durable read-back reconciliation.', {
              retryable: false,
              requiresReview: true,
              batchKey: reconcileBatch.key,
              failures: reconcileFailures
            });
          }
          state.reconciliationBatchCursor = reconciliationCursor + 1;
          state.reconciliationSeriesVerified = Number(state.reconciliationSeriesVerified || 0) + reconcileKeys.length;
          if (state.reconciliationBatchCursor < reconcileBatches.length) {
            return {
              workSchemaVersion: BOUNDED_WORK_VERSION,
              ok: true,
              batchKey: reconcileBatch.key,
              batchesCursor: state.reconciliationBatchCursor,
              batchesTotal: reconcileBatches.length,
              seriesProcessed: reconcileKeys.length,
              repeatPhase: true
            };
          }
        }
        var boundedReconciliation = {
          workSchemaVersion: BOUNDED_WORK_VERSION,
          ok: true,
          failures: [],
          affectedFingerprint: state.targetAfterFingerprint,
          unrelatedFingerprint: state.unrelatedFingerprint,
          latest: {
            ok: state.latestVerified === true,
            failures: [],
            seriesCount: Number(state.latestSeriesVerified || 0)
          },
          batches: reconcileBatches.length,
          seriesCount: Number(state.reconciliationSeriesVerified || 0)
        };
        state.reconciliation = boundedReconciliation;
        state.status = 'RECONCILED';
        if (typeof adapter.recordReconciliation === 'function') {
          adapter.recordReconciliation(identity_(context, options, state), state, boundedReconciliation);
        }
        return boundedReconciliation;
      }
      var reconcileIntent = adapter.readPublishIntent(identity_(context, options, state));
      var reconciliation = reconcileTarget(adapter.readTargetRows(), reconcileStage, reconcileIntent);
      if (!reconciliation.ok) {
        throw error_('AGGREGATE_RECONCILIATION_FAILED', 'Published aggregate affected-set failed read-back reconciliation.', {
          retryable: false,
          requiresReview: true,
          failures: reconciliation.failures
        });
      }
      state.reconciliation = reconciliation;
      state.status = 'RECONCILED';
      if (typeof adapter.recordReconciliation === 'function') {
        adapter.recordReconciliation(identity_(context, options, state), state, reconciliation);
      }
      return reconciliation;
    }

    if (phase === 'FINALIZING') {
      if (state.status !== 'RECONCILED' && state.status !== 'FINALIZING') {
        throw error_('AGGREGATE_FINALIZATION_PRECONDITION_FAILED', 'Aggregate operation cannot finalize before successful reconciliation.', {
          retryable: false,
          status: state.status
        });
      }
      if (typeof adapter.updateStageStatusChunk === 'function') {
        var finalizedStage = adapter.updateStageStatusChunk(
          identity_(context, options, state),
          'VERIFIED',
          state.targetAfterFingerprint,
          Number(state.finalizationCursor || 0),
          state.runtimeSettings.stageStatusRowsPerStep
        );
        state.finalizationCursor = Number(finalizedStage.cursor || 0);
        if (finalizedStage.complete !== true) {
          state.status = 'FINALIZING';
          return {
            workSchemaVersion: BOUNDED_WORK_VERSION,
            status: state.status,
            finalizationCursor: state.finalizationCursor,
            finalizationTotal: Number(finalizedStage.total || 0),
            repeatPhase: true
          };
        }
      } else {
        adapter.updateStageStatus(identity_(context, options, state), 'VERIFIED', state.targetAfterFingerprint);
      }
      if (typeof adapter.finalize === 'function') adapter.finalize(identity_(context, options, state), state);
      state.status = 'SUCCESS';
      return {
        status: state.status,
        stageRows: state.expectedStageRows,
        affectedSeries: (state.affectedSeriesKeys || []).length,
        targetFingerprint: state.targetAfterFingerprint,
        repeatPhase: false
      };
    }

    throw error_('AGGREGATE_PHASE_UNSUPPORTED', 'Aggregate integration does not support this operation phase.', {
      retryable: false,
      phase: phase
    });
  }

  function readObjects_(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    var headers = values[0].map(String);
    return values.slice(1).map(function (valuesRow, rowIndex) {
      var object = { __row: rowIndex + 2 };
      headers.forEach(function (header, column) { object[header] = valuesRow[column]; });
      return object;
    });
  }

  function assertHeaders_(sheet, expected, name) {
    if (!sheet) throw error_('SERVICE_TABLE_MISSING', 'Missing required table: ' + name + '.', { retryable: false });
    var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw error_('SERVICE_SCHEMA_MISMATCH', 'Unexpected schema for ' + name + '.', {
        retryable: false,
        expected: expected,
        actual: actual
      });
    }
    return sheet;
  }

  function appendRows_(sheet, headers, objects, batchSize) {
    if (!objects.length) return 0;
    var size = Math.max(1, Number(batchSize || 250)), written = 0;
    for (var offset = 0; offset < objects.length; offset += size) {
      var rows = objects.slice(offset, offset + size).map(function (object) { return rowValues_(object, headers); });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
      written += rows.length;
    }
    return written;
  }

  function dwh_() {
    return SpreadsheetApp.openById(AKORT.Config.load({ includeSystemSettings: false }).resources.dwhSpreadsheetId);
  }

  function publish_() {
    return SpreadsheetApp.openById(AKORT.Config.load({ includeSystemSettings: false }).resources.publishSpreadsheetId);
  }

  function stageSheet_() {
    return assertHeaders_(dwh_().getSheetByName('AGGREGATE_STAGE'), STAGE_HEADERS.slice(), 'AGGREGATE_STAGE');
  }

  function systemSettings_() {
    return AKORT.Config.readSystemSettings();
  }

  function contextSetting_() {
    var value = systemSettings_().PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON;
    var context = parseJson_(value, {}, 'AGGREGATE_RUNTIME_CONTEXT_INVALID');
    if (context && text_(context.artifact_file_id)) {
      if (!text_(context.artifact_sha256)) {
        throw error_('AGGREGATE_RUNTIME_CONTEXT_HASH_MISSING', 'External aggregate runtime context requires artifact_sha256.', {
          retryable: false
        });
      }
      var serialized;
      try {
        serialized = DriveApp.getFileById(text_(context.artifact_file_id)).getBlob().getDataAsString('UTF-8');
      } catch (caught) {
        throw error_('AGGREGATE_RUNTIME_CONTEXT_READ_FAILED', 'External aggregate runtime context could not be read.', {
          retryable: true,
          cause: String(caught && caught.message || caught)
        });
      }
      var actualHash = hash_(serialized);
      if (actualHash !== text_(context.artifact_sha256).toLowerCase()) {
        throw error_('AGGREGATE_RUNTIME_CONTEXT_HASH_MISMATCH', 'External aggregate runtime context does not match its configured immutable hash.', {
          retryable: false,
          expected: text_(context.artifact_sha256).toLowerCase(),
          actual: actualHash
        });
      }
      context = parseJson_(serialized, {}, 'AGGREGATE_RUNTIME_CONTEXT_INVALID');
    }
    if (!context || typeof context !== 'object' || !Object.keys(context).length) {
      throw error_('AGGREGATE_RUNTIME_CONTEXT_MISSING', 'PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON must contain the authoritative definitions and snapshots.', {
        retryable: false
      });
    }
    return context;
  }

  function assertOperationalRuntimeContext_() {
    var context = contextSetting_();
    var mode = text_(context.adapter_mode).toUpperCase();
    if (mode === ACCEPTED_PARITY_ADAPTER_MODE) {
      if (text_(context.adapter_contract_version) !== '4.0-alpha74-accepted-parity-1' ||
          text_(context.accepted_by) !== 'ALPHA74_GATE5_FULL_HISTORY_PARITY' ||
          context.gate5_evidence_required !== true ||
          text_(context.mutation_boundary) !== 'ALPHA74_ATOMIC_LOGICAL_SERIES') {
        throw error_('AGGREGATE_ACCEPTED_PARITY_CONTRACT_INVALID', 'Accepted Alpha.6 aggregate compatibility adapter has an unsupported contract version.', {
          retryable: false,
          expected: {
            adapterContractVersion: '4.0-alpha74-accepted-parity-1',
            acceptedBy: 'ALPHA74_GATE5_FULL_HISTORY_PARITY',
            gate5EvidenceRequired: true,
            mutationBoundary: 'ALPHA74_ATOMIC_LOGICAL_SERIES'
          },
          actual: {
            adapterContractVersion: text_(context.adapter_contract_version),
            acceptedBy: text_(context.accepted_by),
            gate5EvidenceRequired: context.gate5_evidence_required === true,
            mutationBoundary: text_(context.mutation_boundary)
          }
        });
      }
      return {
        ready: true,
        adapterMode: mode,
        adapterContractVersion: text_(context.adapter_contract_version),
        gate5EvidenceRequired: context.gate5_evidence_required === true,
        physicalWrites: false
      };
    }
    var definitions = (context.definitions || []).length;
    var special = AKORT.SpecialAggregateDefinitions.buildDefinitions(context.definition_context || {});
    if (!special.ok || definitions + (special.definitions || []).length === 0) {
      throw error_('AGGREGATE_OPERATIONAL_RUNTIME_CONTEXT_INVALID', 'Operational aggregate runtime context has no accepted definitions.', {
        retryable: false,
        adapterMode: mode,
        configuredDefinitions: definitions,
        diagnostics: special.diagnostics || []
      });
    }
    return {
      ready: true,
      adapterMode: mode || 'ALPHA73_DEFINITIONS',
      configuredDefinitions: definitions + (special.definitions || []).length,
      physicalWrites: false
    };
  }

  function priceRows_() {
    var spreadsheet = publish_(), out = [];
    [
      { name: 'PUBLISH_PRICES_WEEKLY', frequency: 'weekly', periodField: 'observation_date' },
      { name: 'PUBLISH_PRICES_MONTHLY', frequency: 'monthly', periodField: 'month_start' }
    ].forEach(function (spec) {
      var sheet = spreadsheet.getSheetByName(spec.name);
      readObjects_(sheet).forEach(function (row) {
        row.__frequency = spec.frequency;
        row.__period = row[spec.periodField];
        out.push(row);
      });
    });
    return out;
  }

  function changeFields_(frequency, indexType) {
    if (frequency === 'weekly') {
      if (indexType === 'wow') return { base: 'previous_week_value', change: 'wow_pct', markup: 'markup_wow_pp' };
      if (indexType === 'yoy') return { base: 'previous_year_value', change: 'yoy_pct', markup: 'markup_yoy_pp' };
      return { base: 'december_base_value', change: 'december_pct', markup: 'markup_december_pp' };
    }
    if (indexType === 'mom') return { base: 'previous_month_value', change: 'mom_pct', markup: 'markup_mom_pp' };
    if (indexType === 'yoy') return { base: 'previous_year_value', change: 'yoy_pct', markup: 'markup_yoy_pp' };
    return { base: 'december_base_value', change: 'december_pct', markup: 'markup_december_pp' };
  }

  function stateFor_(value) {
    if (value === '' || value === null || value === undefined) return 'MISSING';
    var number = Number(value);
    if (!isFinite(number)) return 'INVALID';
    return number === 0 ? 'ZERO' : 'VALID';
  }

  function buildPriceInputs_(rows, definitions) {
    var modes = {};
    (definitions || []).forEach(function (definition) {
      var key = [
        text_(definition.dataset_code),
        text_(definition.frequency).toLowerCase(),
        text_(definition.value_type)
      ].join('|');
      var method = text_(definition.calculation_method).toUpperCase();
      modes[key] = modes[key] || {};
      modes[key][method === 'AGGREGATE_MARKUP' ? 'LEVEL' : 'CHANGE'] = true;
      if (method === 'AGGREGATE_MARKUP') {
        [definition.purchase_value_type, definition.retail_value_type].forEach(function (valueType) {
          var levelKey = [text_(definition.dataset_code), text_(definition.frequency).toLowerCase(), text_(valueType)].join('|');
          modes[levelKey] = modes[levelKey] || {};
          modes[levelKey].LEVEL = true;
        });
      }
    });
    var out = {}, allowed = AKORT.AggregateContract.AllowedIndexTypes;
    (rows || []).forEach(function (row) {
      var frequency = text_(row.__frequency), mode = modes[[text_(row.dataset_code), frequency, text_(row.value_type)].join('|')];
      if (!mode) return;
      var indexTypes = text_(row.index_type) ? [text_(row.index_type).toLowerCase()] : (allowed[frequency] || []);
      indexTypes.forEach(function (indexType) {
        var fields = changeFields_(frequency, indexType);
        var useLevel = mode.LEVEL === true && mode.CHANGE !== true;
        if (mode.LEVEL === true && mode.CHANGE === true) {
          throw error_('AGGREGATE_PRICE_INPUT_MODE_CONFLICT', 'One calculator price identity is required as both level and percentage-point input.', {
            retryable: false,
            datasetCode: row.dataset_code,
            frequency: frequency,
            valueType: row.value_type
          });
        }
        var current = row.current_value, base = row[fields.base];
        var change = text_(row.value_type).toLowerCase().indexOf('нацен') >= 0 ? row[fields.markup] : row[fields.change];
        var input = {
          dataset_code: row.dataset_code,
          frequency: frequency,
          series_id: text_(row.series_id || [row.dataset_code, row.category_id, row.value_type].join('|')),
          category_id: row.category_id,
          value_type: row.value_type,
          index_type: indexType,
          period_start: periodKey_(frequency, row.__period),
          current_value: current,
          base_value: base,
          change_pp: useLevel ? '' : change,
          unit: useLevel ? text_(row.unit || 'rub') : 'percentage_point',
          current_state: stateFor_(current),
          base_state: stateFor_(base),
          change_state: useLevel ? 'MISSING' : stateFor_(change),
          category_name: text_(row.product_name || row.indicator_name || row.category_id)
        };
        out[[
          input.dataset_code, input.frequency, input.category_id, input.value_type, input.index_type, input.period_start
        ].join('|')] = input;
      });
    });
    return Object.keys(out).sort().map(function (key) { return out[key]; });
  }

  function reversalEvidence_(reversal) {
    var targetLoadId = text_(reversal && reversal.targetLoadId);
    if (!targetLoadId) {
      throw error_('AGGREGATE_REVERSAL_TARGET_LOAD_MISSING', 'Aggregate reversal requires targetLoadId.', { retryable: false });
    }
    var rows = readObjects_(stageSheet_()).filter(function (row) {
      return text_(row.load_id) === targetLoadId &&
        text_(row.aggregate_series_key).indexOf('__') < 0 &&
        text_(row.stage_status) === 'VERIFIED';
    });
    if (!rows.length) {
      throw error_('ALPHA73_CURRENT_EFFECT_EVIDENCE_REQUIRED', 'No verified Alpha.7.4 stage exists for the reversed load.', {
        retryable: false,
        targetLoadId: targetLoadId
      });
    }
    var plans = uniqueSorted_(rows.map(function (row) {
      return [text_(row.operation_id), text_(row.plan_id), text_(row.plan_fingerprint)].join('|');
    }));
    if (plans.length !== 1) {
      throw error_('AGGREGATE_REVERSAL_STAGE_AMBIGUOUS', 'The reversed load has more than one verified aggregate plan.', {
        retryable: false,
        targetLoadId: targetLoadId,
        plans: plans
      });
    }
    var expected = uniqueSorted_(rows.map(function (row) { return text_(row.expected_target_fingerprint); }));
    if (expected.length !== 1) {
      throw error_('AGGREGATE_REVERSAL_EVIDENCE_INVALID', 'Verified stage does not contain one expected target fingerprint.', {
        retryable: false,
        targetLoadId: targetLoadId,
        fingerprints: expected
      });
    }
    var current = currentAffectedFingerprint(readTargetRows_(), rows);
    if (current !== expected[0]) {
      throw error_('ALPHA73_CURRENT_EFFECT_EVIDENCE_REQUIRED', 'The reversed load is not the current accepted aggregate effect.', {
        retryable: false,
        targetLoadId: targetLoadId,
        expectedFingerprint: expected[0],
        currentFingerprint: current
      });
    }
    return {
      has_current_effect: true,
      current_effect_evidence: {
        target_load_id: targetLoadId,
        verified_plan: plans[0],
        verified_stage_rows: rows.length,
        expected_target_fingerprint: expected[0],
        current_target_fingerprint: current
      },
      current_effect_row_keys: rows.map(function (row) { return text_(row.aggregate_row_key); }).sort()
    };
  }

  function materializeArtifact_(prepared, metadata) {
    var runtimeContext = contextSetting_();
    if (text_(runtimeContext.adapter_mode).toUpperCase() === ACCEPTED_PARITY_ADAPTER_MODE) {
      assertOperationalRuntimeContext_();
      return acceptedParityArtifact_(prepared, metadata, runtimeContext);
    }
    var definitionsResult = AKORT.SpecialAggregateDefinitions.buildDefinitions(runtimeContext.definition_context || {});
    if (!definitionsResult.ok) {
      throw error_('AGGREGATE_DEFINITION_CONFIG_INVALID', 'Alpha.7.3 rejected the configured aggregate definitions.', {
        retryable: false,
        diagnostics: definitionsResult.diagnostics
      });
    }
    var definitions = (runtimeContext.definitions || []).concat(definitionsResult.definitions || []);
    if (!definitions.length) {
      throw error_('AGGREGATE_DEFINITION_CONFIG_MISSING', 'No authoritative Alpha.7.3 aggregate definitions are configured.', { retryable: false });
    }
    var membershipSnapshot = clone_(runtimeContext.membership_snapshot || {});
    var membershipMap = {};
    (membershipSnapshot.rule_rows || []).concat(definitionsResult.membership_rows || []).forEach(function (row) {
      membershipMap[stableStringify_(row)] = clone_(row);
    });
    membershipSnapshot.rule_rows = Object.keys(membershipMap).sort().map(function (key) { return membershipMap[key]; });
    var membershipIdentity = AKORT.AggregateRevisionPlanner.Test.snapshotIdentity(membershipSnapshot, 'membership');
    if (text_(membershipSnapshot.hash) && text_(membershipSnapshot.hash) !== text_(membershipIdentity.computed_hash)) {
      throw error_('AGGREGATE_MEMBERSHIP_SNAPSHOT_HASH_MISMATCH', 'Configured membership snapshot hash does not match its rows.', {
        retryable: false,
        declared: membershipSnapshot.hash,
        computed: membershipIdentity.computed_hash
      });
    }
    membershipSnapshot.hash = membershipIdentity.computed_hash;
    var weightSnapshot = clone_(runtimeContext.weight_snapshot || {});
    weightSnapshot.rule_rows = clone_(weightSnapshot.rule_rows || []);
    var weightIdentity = AKORT.AggregateRevisionPlanner.Test.snapshotIdentity(weightSnapshot, 'weight');
    if (text_(weightSnapshot.hash) && text_(weightSnapshot.hash) !== text_(weightIdentity.computed_hash)) {
      throw error_('AGGREGATE_WEIGHT_SNAPSHOT_HASH_MISMATCH', 'Configured weight snapshot hash does not match its rows.', {
        retryable: false,
        declared: weightSnapshot.hash,
        computed: weightIdentity.computed_hash
      });
    }
    weightSnapshot.hash = weightIdentity.computed_hash;
    runtimeContext.membership_snapshot = membershipSnapshot;
    runtimeContext.weight_snapshot = weightSnapshot;

    var sourceRows = priceRows_();
    var sourceNames = {}, periodLabels = {}, categoryMetadata = {};
    sourceRows.forEach(function (row) {
      var dataset = text_(row.dataset_code), frequency = text_(row.__frequency), period = periodKey_(frequency, row.__period);
      if (dataset && text_(row.source_name) && !sourceNames[dataset]) sourceNames[dataset] = text_(row.source_name);
      if (dataset && period && text_(row.period_label)) periodLabels[[dataset, frequency, period].join('|')] = text_(row.period_label);
      if (dataset && text_(row.category_id)) {
        categoryMetadata[[dataset, frequency, text_(row.category_id)].join('|')] = {
          product_group: text_(row.product_group),
          product_name: text_(row.product_name || row.indicator_name)
        };
      }
    });
    var frontierRows = sourceRows.map(function (row) {
      return {
        frequency: row.__frequency,
        dataset_code: row.dataset_code,
        source_series_scope: 'ALL',
        period_start: row.__period
      };
    });
    var frontierId = 'A74_FRONTIER_' + hash_(frontierRows).slice(0, 20).toUpperCase();
    var frontier = AKORT.AggregateContract.buildFrontier(frontierId, frontierRows);
    var priceInputs = runtimeContext.price_inputs || buildPriceInputs_(sourceRows, definitions);
    var sourceImpacts = sourceImpactsFromPrepared_(
      prepared,
      metadata.operationId,
      metadata.loadId,
      runtimeContext,
      metadata.mode === 'REVERSAL' ? 'REVERSAL' : 'REVISION'
    );
    var request = {
      plan_id: 'A74_PLAN_' + hash_([metadata.operationId, metadata.loadId, prepared.fingerprint]).slice(0, 20).toUpperCase(),
      source_impacts: sourceImpacts,
      definitions: definitions,
      frontier: frontier,
      frontier_snapshot_id: frontier.snapshot_id,
      frontier_hash: frontier.hash,
      weight_snapshot: weightSnapshot,
      membership_snapshot: membershipSnapshot,
      price_inputs: priceInputs,
      coverage_rules: clone_(runtimeContext.coverage_rules || []),
      base_inputs: clone_(runtimeContext.base_inputs || []),
      calculator_options: clone_(runtimeContext.calculator_options || {}),
      latest_frontier: { rows: [], excluded_row_keys: [] },
      execute_calculator: false
    };
    var plan;
    if (metadata.mode === 'REVERSAL') {
      var reversal = clone_(runtimeContext.reversal || {});
      if (reversal.has_current_effect === undefined) {
        reversal = reversalEvidence_(metadata.reversal || {});
      }
      request.has_current_effect = reversal.has_current_effect;
      request.current_effect_evidence = reversal.current_effect_evidence;
      request.current_effect_row_keys = reversal.current_effect_row_keys || [];
      request.previous_price_inputs = reversal.previous_price_inputs || priceInputs;
      request.previous_base_inputs = reversal.previous_base_inputs || request.base_inputs;
      plan = AKORT.AggregateRevisionPlanner.planReversal(request);
    } else {
      plan = AKORT.AggregateRevisionPlanner.planRevision(request);
    }
    return {
      plan: plan,
      preparedImpactFingerprint: prepared.fingerprint,
      definitionFingerprint: definitionsResult.fingerprint,
      frontier: { snapshot_id: frontier.snapshot_id, count: frontier.count, hash: frontier.hash },
      sourceNames: sourceNames,
      periodLabels: periodLabels,
      categoryMetadata: categoryMetadata,
      publishMetadata: clone_(runtimeContext.publish_metadata || { bySeries: {}, bySubject: {} })
    };
  }

  function stageRowsFor_(identity, includeSpecial) {
    return readObjects_(stageSheet_()).filter(function (row) {
      var matches = text_(row.operation_id) === text_(identity.operationId) &&
        text_(row.load_id) === text_(identity.loadId) &&
        text_(row.plan_id) === text_(identity.planId) &&
        text_(row.plan_fingerprint) === text_(identity.planFingerprint);
      if (!matches) return false;
      var special = text_(row.aggregate_series_key).indexOf('__') === 0;
      return includeSpecial === true ? special : !special;
    });
  }

  function chunks_(text, size) {
    var out = [], value = String(text || ''), chunkSize = Math.max(1000, Number(size || 30000));
    for (var i = 0; i < value.length; i += chunkSize) out.push(value.slice(i, i + chunkSize));
    return out.length ? out : [''];
  }

  function persistInputArtifact_(identity, artifact, chunkSize, maxChunksPerStep) {
    var serialized = JSON.stringify(artifact), fingerprint = hash_(serialized);
    var existing = stageRowsFor_(identity, true).filter(function (row) {
      return text_(row.action) === 'INPUT_ARTIFACT';
    });
    var expectedChunks = chunks_(serialized, chunkSize), existingByKey = {};
    existing.forEach(function (row) {
      var key = text_(row.aggregate_row_key);
      if (existingByKey[key]) {
        throw error_('AGGREGATE_INPUT_ARTIFACT_CHUNK_DUPLICATE', 'Input artifact contains a duplicate chunk identity.', {
          retryable: false,
          rowKey: key
        });
      }
      existingByKey[key] = row;
    });
    var rows = expectedChunks.map(function (chunk, index) {
      return {
        operation_id: identity.operationId,
        load_id: identity.loadId,
        plan_id: identity.planId,
        plan_fingerprint: identity.planFingerprint,
        calculation_id: 'INPUT_ARTIFACT',
        aggregate_series_key: ARTIFACT_SERIES_KEY,
        aggregate_row_key: ARTIFACT_SERIES_KEY + '|' + ('000000' + (index + 1)).slice(-6),
        period_start: '',
        action: 'INPUT_ARTIFACT',
        row_payload_json: chunk,
        row_fingerprint: hash_(chunk),
        expected_target_fingerprint: fingerprint,
        stage_status: 'MATERIALIZED',
        created_at: now_(),
        verified_at: '',
        release_version: RELEASE
      };
    });
    rows.forEach(function (row) {
      var prior = existingByKey[row.aggregate_row_key];
      if (!prior) return;
      if (text_(prior.row_fingerprint) !== text_(row.row_fingerprint) ||
          String(prior.row_payload_json || '') !== String(row.row_payload_json || '') ||
          text_(prior.expected_target_fingerprint) !== fingerprint) {
        throw error_('AGGREGATE_INPUT_ARTIFACT_CONFLICT', 'A persisted input artifact chunk differs from the immutable plan.', {
          retryable: false,
          rowKey: row.aggregate_row_key
        });
      }
    });
    var pending = rows.filter(function (row) { return !existingByKey[row.aggregate_row_key]; });
    var selected = pending.slice(0, Math.max(1, Number(maxChunksPerStep || 25)));
    appendRows_(stageSheet_(), STAGE_HEADERS.slice(), selected, 25);
    var persistedCount = existing.length + selected.length;
    return {
      recoveredChunks: existing.length,
      appendedChunks: selected.length,
      persistedChunks: persistedCount,
      totalChunks: rows.length,
      complete: persistedCount === rows.length,
      fingerprint: fingerprint
    };
  }

  function readInputArtifact_(identity) {
    var rows = stageRowsFor_(identity, true).filter(function (row) {
      return text_(row.action) === 'INPUT_ARTIFACT';
    }).sort(function (a, b) {
      return text_(a.aggregate_row_key) < text_(b.aggregate_row_key) ? -1 : 1;
    });
    if (!rows.length) return null;
    rows.forEach(function (row) {
      if (hash_(String(row.row_payload_json || '')) !== text_(row.row_fingerprint)) {
        throw error_('AGGREGATE_INPUT_ARTIFACT_CHUNK_CHANGED', 'Input artifact chunk fingerprint mismatch.', { retryable: false });
      }
    });
    var serialized = rows.map(function (row) { return String(row.row_payload_json || ''); }).join('');
    if (hash_(serialized) !== text_(rows[0].expected_target_fingerprint)) {
      throw error_('AGGREGATE_INPUT_ARTIFACT_CHANGED', 'Input artifact fingerprint mismatch.', { retryable: false });
    }
    return JSON.parse(serialized);
  }

  function upsertCalculatedRows_(identity, records) {
    var existing = stageRowsFor_(identity, false), byKey = {};
    existing.forEach(function (row) { byKey[text_(row.aggregate_row_key)] = row; });
    var pending = [], recovered = 0;
    (records || []).forEach(function (record) {
      var prior = byKey[text_(record.aggregate_row_key)];
      if (!prior) {
        byKey[text_(record.aggregate_row_key)] = record;
        pending.push(record);
        return;
      }
      if (text_(prior.row_fingerprint) !== text_(record.row_fingerprint)) {
        throw error_('AGGREGATE_STAGE_DUPLICATE_ROW_KEY', 'A calculated logical row conflicts with an existing staged row.', {
          retryable: false,
          rowKey: record.aggregate_row_key
        });
      }
      recovered += 1;
    });
    appendRows_(stageSheet_(), STAGE_HEADERS.slice(), pending);
    return { inserted: pending.length, recovered: recovered, total: Object.keys(byKey).length };
  }

  function updateStage_(identity, mutator) {
    var sheet = stageSheet_(), rows = readObjects_(sheet), updates = [];
    rows.forEach(function (row) {
      if (text_(row.operation_id) !== text_(identity.operationId) ||
          text_(row.load_id) !== text_(identity.loadId) ||
          text_(row.plan_id) !== text_(identity.planId) ||
          text_(row.plan_fingerprint) !== text_(identity.planFingerprint)) return;
      var copy = clone_(row);
      mutator(copy);
      updates.push({ row: row.__row, values: rowValues_(copy, STAGE_HEADERS) });
    });
    updates.sort(function (a, b) { return a.row - b.row; });
    var blocks = [];
    updates.forEach(function (update) {
      var last = blocks.length ? blocks[blocks.length - 1] : null;
      if (!last || update.row !== last.start + last.values.length) {
        blocks.push({ start: update.row, values: [update.values] });
      } else {
        last.values.push(update.values);
      }
    });
    blocks.forEach(function (block) {
      for (var offset = 0; offset < block.values.length; offset += 250) {
        var values = block.values.slice(offset, offset + 250);
        sheet.getRange(block.start + offset, 1, values.length, STAGE_HEADERS.length).setValues(values);
      }
    });
    return updates.length;
  }

  function updateStageStatusChunk_(identity, status, fingerprint, cursor, maxRows) {
    var sheet = stageSheet_();
    var matching = readObjects_(sheet).filter(function (row) {
      return text_(row.operation_id) === text_(identity.operationId) &&
        text_(row.load_id) === text_(identity.loadId) &&
        text_(row.plan_id) === text_(identity.planId) &&
        text_(row.plan_fingerprint) === text_(identity.planFingerprint) &&
        text_(row.aggregate_series_key).indexOf('__') !== 0;
    }).sort(function (a, b) { return Number(a.__row) - Number(b.__row); });
    var start = Math.max(0, Number(cursor || 0));
    var end = Math.min(matching.length, start + Math.max(1, Number(maxRows || 1)));
    var selected = matching.slice(start, end);
    var blocks = [];
    selected.forEach(function (row) {
      var copy = clone_(row);
      copy.stage_status = status;
      copy.verified_at = status === 'VERIFIED' ? now_() : copy.verified_at;
      if (fingerprint) copy.expected_target_fingerprint = fingerprint;
      var update = { row: Number(row.__row), values: rowValues_(copy, STAGE_HEADERS) };
      var last = blocks.length ? blocks[blocks.length - 1] : null;
      if (!last || update.row !== last.start + last.values.length) {
        blocks.push({ start: update.row, values: [update.values] });
      } else {
        last.values.push(update.values);
      }
    });
    blocks.forEach(function (block) {
      sheet.getRange(block.start, 1, block.values.length, STAGE_HEADERS.length).setValues(block.values);
    });
    return {
      workSchemaVersion: BOUNDED_WORK_VERSION,
      cursor: end,
      total: matching.length,
      rowsUpdated: selected.length,
      complete: end >= matching.length
    };
  }

  function publishIntentKey_(batchKey) {
    var key = text_(batchKey || 'FINAL').toUpperCase();
    return INTENT_SERIES_KEY + '|' + key;
  }

  function persistPublishIntent_(identity, intent, batchKey) {
    var intentKey = publishIntentKey_(batchKey);
    var existing = readPublishIntent_(identity, batchKey);
    if (existing) {
      if (text_(existing.fingerprint) !== text_(intent.fingerprint)) {
        throw error_('AGGREGATE_PUBLISH_INTENT_CONFLICT', 'A different durable publish intent already exists.', { retryable: false });
      }
      return existing;
    }
    var record = {
      operation_id: identity.operationId,
      load_id: identity.loadId,
      plan_id: identity.planId,
      plan_fingerprint: identity.planFingerprint,
      calculation_id: 'PUBLISH_INTENT_' + text_(batchKey || 'FINAL').toUpperCase(),
      aggregate_series_key: INTENT_SERIES_KEY,
      aggregate_row_key: intentKey,
      period_start: '',
      action: 'PUBLISH_INTENT',
      row_payload_json: JSON.stringify(intent),
      row_fingerprint: hash_(intent),
      expected_target_fingerprint: intent.afterFingerprint,
      stage_status: 'INTENT_PERSISTED',
      created_at: now_(),
      verified_at: '',
      release_version: RELEASE
    };
    appendRows_(stageSheet_(), STAGE_HEADERS.slice(), [record]);
    return intent;
  }

  function readPublishIntentRecord_(identity, batchKey) {
    var intentKey = publishIntentKey_(batchKey);
    var rows = stageRowsFor_(identity, true).filter(function (row) {
      return text_(row.action) === 'PUBLISH_INTENT' && text_(row.aggregate_row_key) === intentKey;
    });
    if (!rows.length) return null;
    if (rows.length !== 1) throw error_('AGGREGATE_PUBLISH_INTENT_DUPLICATE', 'More than one publish intent exists.', { retryable: false });
    var intent = parseJson_(rows[0].row_payload_json, {}, 'AGGREGATE_PUBLISH_INTENT_INVALID');
    if (hash_(intent) !== text_(rows[0].row_fingerprint)) {
      throw error_('AGGREGATE_PUBLISH_INTENT_CHANGED', 'Publish intent fingerprint mismatch.', { retryable: false });
    }
    return { row: rows[0], intent: intent };
  }

  function readPublishIntent_(identity, batchKey) {
    var record = readPublishIntentRecord_(identity, batchKey);
    return record ? record.intent : null;
  }

  /**
   * One-shot recovery for the exact .24 Gate 6 read-back incident.
   *
   * The first bounded monthly batch was fully written, but its display label
   * used the UTC month from a serialized Date. The routine is deliberately
   * fail-closed: it accepts only the first 32-series intent, validates all 392
   * immutable stage rows, proves that the target differs solely by one bad
   * monthly label per staged series, and then upgrades only that durable
   * intent. The next normal operation step performs the physical repair.
   */
  function recoverMonthlyPeriodLabelIntent(options) {
    options = options || {};
    if (AKORT.EnvironmentGuard && typeof AKORT.EnvironmentGuard.assertDev === 'function') {
      AKORT.EnvironmentGuard.assertDev();
    }
    var identity = {
      operationId: text_(options.operationId),
      loadId: text_(options.loadId),
      planId: text_(options.planId),
      planFingerprint: text_(options.planFingerprint)
    };
    Object.keys(identity).forEach(function (key) {
      if (!identity[key]) {
        throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_IDENTITY_INVALID', 'Monthly period-label recovery requires the exact operation identity.', {
          retryable: false,
          missing: key
        });
      }
    });
    var expectedRows = Number(options.expectedStageRows || 0);
    var expectedStageFingerprint = text_(options.stageFingerprint);
    var batchKey = text_(options.batchKey || 'SERIES_000001_000032');
    if (expectedRows !== 392 || batchKey !== 'SERIES_000001_000032') {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_BOUNDARY_INVALID', 'Monthly period-label recovery is restricted to the verified first Gate 6 batch.', {
        retryable: false,
        expectedStageRows: expectedRows,
        batchKey: batchKey
      });
    }
    var staged = DefaultAdapter.readCalculatedRows(identity);
    var validation = validateRecoveryStageSnapshot(staged, identity);
    if (!validation.complete || validation.rowCount !== expectedRows ||
        validation.stageFingerprint !== expectedStageFingerprint || validation.seriesCount !== 392) {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_STAGE_CHANGED', 'The immutable Gate 6 aggregate stage no longer matches the verified incident.', {
        retryable: false,
        expectedRows: expectedRows,
        actualRows: validation.rowCount,
        expectedFingerprint: expectedStageFingerprint,
        actualFingerprint: validation.stageFingerprint,
        seriesCount: validation.seriesCount
      });
    }
    var state = {
      affectedSeriesKeys: validation.seriesKeys,
      runtimeSettings: runtimeSettings_(DefaultAdapter)
    };
    var bounded = boundedReplacement_(DefaultAdapter, staged, state, 0, 32);
    if (batchIntentKey_(bounded.slice.start, bounded.slice.end) !== batchKey ||
        bounded.slice.start !== 0 || bounded.slice.end !== 32 || bounded.slice.total !== 392 ||
        bounded.slice.stageRows.length !== 32 || bounded.slice.stageRows.some(function (record) {
          var payload = parseJson_(record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
          return text_(payload.frequency).toLowerCase() !== 'monthly' || text_(record.action) !== 'UPSERT';
        })) {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_SLICE_CHANGED', 'The first Gate 6 publication slice no longer matches the monthly 32-series incident.', {
        retryable: false,
        start: bounded.slice.start,
        end: bounded.slice.end,
        total: bounded.slice.total,
        stageRows: bounded.slice.stageRows.length
      });
    }
    var stored = readPublishIntentRecord_(identity, batchKey);
    var legacyIntent = !!stored && text_(stored.row.release_version) === MONTHLY_PERIOD_LABEL_INCIDENT_RELEASE &&
      text_(stored.row.stage_status) === 'INTENT_PERSISTED';
    var alreadyRecovered = !!stored && text_(stored.row.release_version) === RELEASE &&
      text_(stored.row.stage_status) === 'INTENT_RECOVERED' &&
      text_(stored.intent && stored.intent.recoveryMode) === 'MONTHLY_PERIOD_LABEL_CANONICAL_REPAIR';
    if (!legacyIntent && !alreadyRecovered) {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_INTENT_INVALID', 'The durable .24 first-batch publish intent is missing or has already changed.', {
        retryable: false,
        found: !!stored,
        release: stored && stored.row.release_version || '',
        status: stored && stored.row.stage_status || ''
      });
    }
    var intent = stored.intent;
    if (text_(intent.stageFingerprint) !== expectedStageFingerprint ||
        Number(intent.seriesStart) !== 0 || Number(intent.seriesEnd) !== 32 || Number(intent.seriesTotal) !== 392 ||
        text_(intent.publicationMode) !== 'DURABLE_BOUNDED_LOGICAL_SERIES' ||
        text_(stored.row.expected_target_fingerprint) !== text_(intent.afterFingerprint) ||
        legacyIntent && text_(options.failedExpectedFingerprint) && text_(options.failedExpectedFingerprint) !== text_(intent.afterFingerprint)) {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_INTENT_CHANGED', 'The .24 first-batch intent does not match the failed read-back checkpoint.', {
        retryable: false,
        seriesStart: intent.seriesStart,
        seriesEnd: intent.seriesEnd,
        seriesTotal: intent.seriesTotal,
        publicationMode: intent.publicationMode
      });
    }
    var replacement = bounded.replacement;
    if (!replacement.requiresMonthlyPeriodLabelRepair ||
        replacement.monthlyPeriodLabelMismatchCount !== bounded.slice.stageRows.length ||
        replacement.exactDuplicateRowCount !== 0 || replacement.requiresStagePeriodIdentityRepair ||
        replacement.beforeFingerprint !== replacement.afterFingerprint ||
        replacement.unrelatedFingerprint !== text_(intent.unrelatedFingerprint) ||
        legacyIntent && replacement.afterFingerprint === text_(intent.afterFingerprint)) {
      throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_TARGET_INVALID', 'Current Publish is not the exact .24 monthly period-label after-state.', {
        retryable: false,
        monthlyLabelMismatches: replacement.monthlyPeriodLabelMismatchCount,
        expectedMonthlyLabelMismatches: bounded.slice.stageRows.length,
        exactDuplicateRows: replacement.exactDuplicateRowCount,
        stagePeriodIdentityRepair: replacement.requiresStagePeriodIdentityRepair,
        currentFingerprint: replacement.beforeFingerprint,
        correctedFingerprint: replacement.afterFingerprint,
        legacyExpectedFingerprint: intent.afterFingerprint
      });
    }
    if (alreadyRecovered) {
      if (replacement.afterFingerprint !== text_(intent.afterFingerprint) ||
          text_(intent.recoveredFromRelease) !== MONTHLY_PERIOD_LABEL_INCIDENT_RELEASE ||
          Number(intent.monthlyPeriodLabelMismatchCount || 0) !== replacement.monthlyPeriodLabelMismatchCount) {
        throw error_('AGGREGATE_MONTHLY_LABEL_RECOVERY_PREPARED_INTENT_CHANGED', 'The already prepared monthly label recovery intent no longer matches Publish.', {
          retryable: false,
          expected: intent.afterFingerprint,
          actual: replacement.afterFingerprint
        });
      }
      return {
        recoveryMode: intent.recoveryMode,
        batchKey: batchKey,
        seriesCount: bounded.slice.seriesKeys.length,
        stageRows: validation.rowCount,
        monthlyPeriodLabelRowsToRepair: replacement.monthlyPeriodLabelMismatchCount,
        legacyExpectedFingerprint: text_(intent.recoveredFromIntentFingerprint),
        correctedExpectedFingerprint: intent.afterFingerprint,
        intentRow: Number(stored.row.__row),
        alreadyPrepared: true
      };
    }
    var recoveredIntent = clone_(intent);
    delete recoveredIntent.fingerprint;
    recoveredIntent.afterFingerprint = replacement.afterFingerprint;
    recoveredIntent.unrelatedFingerprint = replacement.unrelatedFingerprint;
    recoveredIntent.requiresPhysicalRepair = true;
    recoveredIntent.requiresMonthlyPeriodLabelRepair = true;
    recoveredIntent.monthlyPeriodLabelMismatchCount = replacement.monthlyPeriodLabelMismatchCount;
    recoveredIntent.recoveryMode = 'MONTHLY_PERIOD_LABEL_CANONICAL_REPAIR';
    recoveredIntent.recoveredFromRelease = MONTHLY_PERIOD_LABEL_INCIDENT_RELEASE;
    recoveredIntent.recoveredFromIntentFingerprint = text_(intent.fingerprint);
    recoveredIntent.recoveredAt = now_();
    recoveredIntent.fingerprint = hash_(recoveredIntent);
    var updated = clone_(stored.row);
    updated.row_payload_json = JSON.stringify(recoveredIntent);
    updated.row_fingerprint = hash_(recoveredIntent);
    updated.expected_target_fingerprint = recoveredIntent.afterFingerprint;
    updated.stage_status = 'INTENT_RECOVERED';
    updated.release_version = RELEASE;
    stageSheet_().getRange(Number(stored.row.__row), 1, 1, STAGE_HEADERS.length)
      .setValues([rowValues_(updated, STAGE_HEADERS)]);
    return {
      recoveryMode: recoveredIntent.recoveryMode,
      batchKey: batchKey,
      seriesCount: bounded.slice.seriesKeys.length,
      stageRows: validation.rowCount,
      monthlyPeriodLabelRowsToRepair: replacement.monthlyPeriodLabelMismatchCount,
      legacyExpectedFingerprint: intent.afterFingerprint,
      correctedExpectedFingerprint: recoveredIntent.afterFingerprint,
      intentRow: Number(stored.row.__row)
    };
  }

  function weeklyRollbackIncidentStage_(options) {
    options = options || {};
    var identity = {
      operationId: text_(options.operationId),
      loadId: text_(options.loadId),
      planId: text_(options.planId),
      planFingerprint: text_(options.planFingerprint)
    };
    if (identity.operationId !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_OPERATION_ID ||
        identity.loadId !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_LOAD_ID ||
        !identity.planId || !identity.planFingerprint) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_IDENTITY_INVALID', 'Weekly rollback recovery is restricted to the exact Gate 6 canary operation.', {
        retryable: false,
        operationId: identity.operationId,
        loadId: identity.loadId
      });
    }
    var staged = DefaultAdapter.readCalculatedRows(identity);
    var validation = validateRecoveryStageSnapshot(staged, identity);
    if (!validation.complete || validation.rowCount !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_STAGE_ROWS ||
        validation.seriesCount !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_STAGE_ROWS ||
        text_(options.stageFingerprint) !== validation.stageFingerprint) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_STAGE_CHANGED', 'The immutable Gate 6 canary stage no longer matches the verified weekly rollback incident.', {
        retryable: false,
        expectedRows: WEEKLY_ROLLBACK_PERIOD_INCIDENT_STAGE_ROWS,
        actualRows: validation.rowCount,
        expectedFingerprint: text_(options.stageFingerprint),
        actualFingerprint: validation.stageFingerprint,
        seriesCount: validation.seriesCount
      });
    }
    var weekly = staged.filter(function (record) {
      var payload = parseJson_(record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
      return text_(record.action) === 'UPSERT' &&
        text_(payload.dataset_code) === 'AKORT_WEEKLY' &&
        text_(payload.frequency).toLowerCase() === 'weekly' &&
        text_(payload.period_label) === WEEKLY_ROLLBACK_PERIOD_INCIDENT_LABEL &&
        periodKey_('weekly', payload.period_start) === WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD &&
        isoWeekSundayPeriod_(payload.period_label) === WEEKLY_ROLLBACK_PERIOD_INCIDENT_CANONICAL_PERIOD &&
        text_(record.aggregate_row_key) === text_(record.aggregate_series_key) + '|' + WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD;
    }).sort(function (left, right) {
      return text_(left.aggregate_series_key) < text_(right.aggregate_series_key) ? -1 : 1;
    });
    var weeklySeries = uniqueSorted_(weekly.map(function (record) { return record.aggregate_series_key; }));
    if (weekly.length !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_ROWS ||
        weeklySeries.length !== WEEKLY_ROLLBACK_PERIOD_INCIDENT_ROWS) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_SLICE_CHANGED', 'The canary stage does not contain the exact 196 legacy weekly publication identities.', {
        retryable: false,
        rows: weekly.length,
        series: weeklySeries.length
      });
    }
    return { identity: identity, staged: staged, validation: validation, weekly: weekly };
  }

  function weeklyRollbackDeleteRecord_(record) {
    var copy = clone_(record);
    var payload = parseJson_(copy.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
    payload.period_start = WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD;
    copy.period_start = WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD;
    copy.aggregate_row_key = text_(copy.aggregate_series_key) + '|' + WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD;
    copy.action = 'DELETE';
    copy.row_payload_json = JSON.stringify(payload);
    return copy;
  }

  function weeklyRollbackTargetState_(targetRows, stageRows) {
    var signatures = stageSeriesMap_(stageRows), legacy = {}, canonical = {};
    (stageRows || []).forEach(function (record) {
      legacy[text_(record.aggregate_series_key)] = 0;
      canonical[text_(record.aggregate_series_key)] = 0;
    });
    (targetRows || []).forEach(function (row) {
      var series = signatures[publicSignature_(row)] || '';
      if (!series) return;
      var period = periodKey_('weekly', row.period_start);
      if (period === WEEKLY_ROLLBACK_PERIOD_INCIDENT_LEGACY_PERIOD &&
          text_(row.period_label) === WEEKLY_ROLLBACK_PERIOD_INCIDENT_LABEL) legacy[series] += 1;
      if (period === WEEKLY_ROLLBACK_PERIOD_INCIDENT_CANONICAL_PERIOD &&
          text_(row.period_label) === WEEKLY_ROLLBACK_PERIOD_INCIDENT_LABEL) canonical[series] += 1;
    });
    return {
      legacyRows: Object.keys(legacy).reduce(function (sum, key) { return sum + legacy[key]; }, 0),
      canonicalRows: Object.keys(canonical).reduce(function (sum, key) { return sum + canonical[key]; }, 0),
      invalidLegacySeries: Object.keys(legacy).filter(function (key) { return legacy[key] > 1; }).sort(),
      canonicalSeries: Object.keys(canonical).filter(function (key) { return canonical[key] > 0; }).sort()
    };
  }

  /**
   * Bounded one-shot data repair for the exact .30 Gate 6 rollback incident.
   *
   * The .30 canary serialized a Moscow Sunday as the preceding UTC Saturday.
   * Reversal correctly removed 196 monthly-derived rows but could not address
   * these 196 weekly aggregate identities. Each call replaces at most 16
   * complete logical series and verifies the physical read-back before moving
   * the durable cursor.
   */
  function recoverWeeklyRollbackPeriodBatch(options) {
    options = options || {};
    if (AKORT.EnvironmentGuard && typeof AKORT.EnvironmentGuard.assertDev === 'function') {
      AKORT.EnvironmentGuard.assertDev();
    }
    var settings = systemSettings_();
    if (!truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED) ||
        truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED) ||
        truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_FLAGS_INVALID', 'Weekly rollback recovery requires execution=TRUE, regular=FALSE and user=FALSE.', {
        retryable: false,
        executionEnabled: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
        regularPipelineEnabled: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED),
        userPipelineEnabled: truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)
      });
    }
    var incident = weeklyRollbackIncidentStage_(options);
    var cursor = Math.max(0, Number(options.cursor || 0));
    // Keep a deterministic batch boundary across uncertain Sheets responses.
    // A retry must select the same complete series set even when the prior
    // atomic request was applied but its response was lost.
    var maximum = Math.max(1, Math.min(16, Number(options.maxSeries || 16)));
    if (cursor > incident.weekly.length) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_CURSOR_INVALID', 'Weekly rollback recovery cursor exceeds the immutable incident boundary.', {
        retryable: false,
        cursor: cursor,
        total: incident.weekly.length
      });
    }
    var selected = incident.weekly.slice(cursor, Math.min(incident.weekly.length, cursor + maximum));
    if (!selected.length) {
      return {
        recoveryMode: 'WEEKLY_ROLLBACK_PERIOD_CANONICAL_REPAIR',
        cursor: cursor,
        total: incident.weekly.length,
        complete: true,
        logicalRowsRemoved: 0,
        physicalWrite: false
      };
    }
    var limits = runtimeSettings_(DefaultAdapter);
    var deleteStage = selected.map(weeklyRollbackDeleteRecord_);
    var targetRows = DefaultAdapter.readTargetRowsForStage(deleteStage);
    var replacement = buildSeriesReplacement(targetRows, deleteStage);
    if (replacement.replacementRowCount > limits.atomicMaxRows ||
        replacement.cellCount > limits.atomicMaxCells ||
        replacement.requestCount > limits.atomicMaxRequests) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_LIMIT_EXCEEDED', 'The deterministic 16-series weekly rollback batch exceeds the configured atomic boundary.', {
        retryable: false,
        selectedSeries: selected.length,
        replacementRows: replacement.replacementRowCount,
        cells: replacement.cellCount,
        requests: replacement.requestCount
      });
    }
    var before = weeklyRollbackTargetState_(targetRows, deleteStage);
    if (before.invalidLegacySeries.length || before.canonicalRows ||
        (before.legacyRows !== selected.length && before.legacyRows !== 0)) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_TARGET_INVALID', 'Publish is not an atomic before-state or after-state for the selected weekly recovery batch.', {
        retryable: false,
        requiresReview: true,
        cursor: cursor,
        selectedSeries: selected.length,
        legacyRows: before.legacyRows,
        canonicalRows: before.canonicalRows,
        invalidLegacySeries: before.invalidLegacySeries,
        canonicalSeries: before.canonicalSeries
      });
    }
    var write = { apiCalls: 0, requests: 0, deletedRows: 0, appendedRows: 0, noOp: true };
    if (before.legacyRows === selected.length) {
      write = batchUpdateReplacement_(publish_(), replacement);
      invalidateTargetReadCache_();
    }
    var readbackRows = DefaultAdapter.readTargetRowsForStage(deleteStage);
    var readbackState = weeklyRollbackTargetState_(readbackRows, deleteStage);
    var readbackReplacement = buildSeriesReplacement(readbackRows, deleteStage);
    var latest = validateLatest(readbackRows, deleteStage);
    if (readbackState.legacyRows || readbackState.canonicalRows ||
        readbackReplacement.requiresPhysicalRepair ||
        readbackReplacement.beforeFingerprint !== replacement.afterFingerprint || !latest.ok) {
      throw error_('AGGREGATE_WEEKLY_ROLLBACK_RECOVERY_READBACK_MISMATCH', 'Weekly rollback repair did not produce the exact verified after-state.', {
        retryable: false,
        requiresReview: true,
        cursor: cursor,
        legacyRows: readbackState.legacyRows,
        canonicalRows: readbackState.canonicalRows,
        expectedFingerprint: replacement.afterFingerprint,
        actualFingerprint: readbackReplacement.beforeFingerprint,
        latestFailures: latest.failures
      });
    }
    var nextCursor = cursor + selected.length;
    return {
      recoveryMode: 'WEEKLY_ROLLBACK_PERIOD_CANONICAL_REPAIR',
      cursor: nextCursor,
      total: incident.weekly.length,
      complete: nextCursor >= incident.weekly.length,
      seriesProcessed: selected.length,
      verifiedRowsAbsent: selected.length,
      logicalRowsRemoved: before.legacyRows,
      recoveredAfterLostResponse: before.legacyRows === 0,
      physicalWrite: Number(write.apiCalls || 0) > 0,
      atomicApiCalls: Number(write.apiCalls || 0),
      atomicRequests: Number(write.requests || 0),
      physicalRowsReplaced: Number(write.deletedRows || 0),
      physicalRowsAppended: Number(write.appendedRows || 0)
    };
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

  function batchGetValues_(spreadsheetId, ranges) {
    if (!(ranges || []).length) return [];
    if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || !Sheets.Spreadsheets.Values ||
        typeof Sheets.Spreadsheets.Values.batchGet !== 'function') {
      throw error_('AGGREGATE_SHEETS_BATCH_GET_UNAVAILABLE', 'Bounded aggregate execution requires the Advanced Google Sheets batchGet service.', {
        retryable: false
      });
    }
    var out = [];
    for (var offset = 0; offset < ranges.length; offset += 50) {
      var selected = ranges.slice(offset, offset + 50);
      var response = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
        ranges: selected,
        majorDimension: 'ROWS',
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER'
      }) || {};
      var valueRanges = response.valueRanges || [];
      if (valueRanges.length !== selected.length) {
        throw error_('AGGREGATE_BATCH_GET_RANGE_COUNT_MISMATCH', 'Bounded target read did not return every requested range.', {
          retryable: true,
          expectedRanges: selected.length,
          actualRanges: valueRanges.length
        });
      }
      valueRanges.forEach(function (range) { out.push(range.values || []); });
    }
    return out;
  }

  function rowBlocks_(rowNumbers) {
    var rows = uniqueSorted_((rowNumbers || []).map(String)).map(Number).filter(function (row) {
      return isFinite(row) && row > 1;
    }).sort(function (a, b) { return a - b; });
    if (!rows.length) return [];
    var blocks = [], start = rows[0], previous = rows[0];
    for (var index = 1; index < rows.length; index += 1) {
      if (rows[index] === previous + 1) {
        previous = rows[index];
        continue;
      }
      blocks.push({ start: start, end: previous, count: previous - start + 1 });
      start = rows[index];
      previous = rows[index];
    }
    blocks.push({ start: start, end: previous, count: previous - start + 1 });
    return blocks;
  }

  function rowsFromBlocks_(spreadsheetId, sheetName, blocks, headers) {
    if (!(blocks || []).length) return [];
    var lastColumn = a1Column_(headers.length);
    var ranges = blocks.map(function (block) {
      return quotedSheetName_(sheetName) + '!A' + block.start + ':' + lastColumn + block.end;
    });
    var valuesByRange = batchGetValues_(spreadsheetId, ranges), rows = [];
    blocks.forEach(function (block, blockIndex) {
      var values = valuesByRange[blockIndex] || [];
      if (values.length !== block.count) {
        throw error_('AGGREGATE_TARGET_RANGE_INCOMPLETE', 'Bounded target read returned an incomplete affected-row range.', {
          retryable: true,
          startRow: block.start,
          endRow: block.end,
          expectedRows: block.count,
          actualRows: values.length
        });
      }
      values.forEach(function (row, rowOffset) {
        var object = { __row: block.start + rowOffset };
        headers.forEach(function (header, column) {
          object[header] = row[column] === undefined || row[column] === null ? '' : row[column];
        });
        rows.push(object);
      });
    });
    return rows;
  }

  function stageSignatureMap_(records) {
    var signatures = {};
    (records || []).forEach(function (record) {
      var payload = parseJson_(record.row_payload_json, {}, 'AGGREGATE_STAGE_PAYLOAD_INVALID');
      signatures[publicSignature_(payload)] = true;
    });
    return signatures;
  }

  function targetSheetContext_() {
    var spreadsheet = publish_();
    var sheet = spreadsheet.getSheetByName(TARGET_SHEET);
    var headers = AKORT.AggregateContract.Headers.slice();
    assertHeaders_(sheet, headers, TARGET_SHEET);
    return {
      spreadsheet: spreadsheet,
      spreadsheetId: spreadsheet.getId(),
      sheet: sheet,
      sheetName: sheet.getName(),
      headers: headers,
      rowCount: Math.max(0, sheet.getLastRow() - 1)
    };
  }

  function targetReadCache_(target) {
    var signature = [
      text_(target.spreadsheetId),
      String(target.sheet.getSheetId()),
      String(target.rowCount),
      String(target.headers.length)
    ].join('|');
    if (ALPHA74_TARGET_READ_CACHE && ALPHA74_TARGET_READ_CACHE.signature === signature) {
      return ALPHA74_TARGET_READ_CACHE;
    }
    var specs = AGGREGATE_IDENTITY_COLUMNS.slice();
    if (!specs.some(function (spec) { return spec.header === 'period_start'; })) {
      specs.push({ header: 'period_start', column: 12 });
    }
    var projections = [];
    if (target.rowCount) {
      var sheetRef = quotedSheetName_(target.sheetName);
      var ranges = specs.map(function (spec) {
        var column = a1Column_(spec.column);
        return sheetRef + '!' + column + '2:' + column + (target.rowCount + 1);
      });
      var columns = batchGetValues_(target.spreadsheetId, ranges);
      for (var rowIndex = 0; rowIndex < target.rowCount; rowIndex += 1) {
        var projection = { __row: rowIndex + 2 };
        specs.forEach(function (spec, columnIndex) {
          var values = columns[columnIndex] || [];
          projection[spec.header] = values[rowIndex] && values[rowIndex][0] !== undefined ? values[rowIndex][0] : '';
        });
        projections.push(projection);
      }
    }
    ALPHA74_TARGET_READ_CACHE = {
      schemaVersion: '4.0-alpha74-target-read-cache-1',
      signature: signature,
      projections: projections,
      rowsByPhysical: {}
    };
    return ALPHA74_TARGET_READ_CACHE;
  }

  function cachedTargetRows_(target, physicalRows) {
    var cache = targetReadCache_(target);
    var requested = uniqueSorted_((physicalRows || []).map(String)).map(Number).sort(function (a, b) { return a - b; });
    var missing = requested.filter(function (rowNumber) { return !cache.rowsByPhysical[String(rowNumber)]; });
    if (missing.length) {
      rowsFromBlocks_(target.spreadsheetId, target.sheetName, rowBlocks_(missing), target.headers).forEach(function (row) {
        cache.rowsByPhysical[String(row.__row)] = row;
      });
    }
    return requested.map(function (rowNumber) { return cache.rowsByPhysical[String(rowNumber)]; }).filter(Boolean);
  }

  function invalidateTargetReadCache_() {
    ALPHA74_TARGET_READ_CACHE = null;
  }

  function readTargetRowsForStage_(stageRecords) {
    var target = targetSheetContext_();
    if (!target.rowCount || !(stageRecords || []).length) return [];
    var cache = targetReadCache_(target);
    var signatures = stageSignatureMap_(stageRecords), physicalRows = [];
    cache.projections.forEach(function (projection) {
      if (signatures[publicSignature_(projection)]) physicalRows.push(projection.__row);
    });
    return cachedTargetRows_(target, physicalRows);
  }

  function readTargetRowsForCombos_(combos) {
    var target = targetSheetContext_();
    if (!target.rowCount || !(combos || []).length) return [];
    var cache = targetReadCache_(target);
    var comboSet = {};
    (combos || []).forEach(function (combo) {
      comboSet[aggregateComboKey_(combo.frequency, combo.datasetCode, combo.period, combo.valueType, combo.indexType)] = true;
    });
    var physicalRows = [];
    cache.projections.forEach(function (row) {
      if (comboSet[aggregateComboKey_(row.frequency, row.dataset_code, row.period_start, row.value_type, row.index_type)]) {
        physicalRows.push(row.__row);
      }
    });
    return cachedTargetRows_(target, physicalRows);
  }

  function readTargetTailRows_(rowCount) {
    var target = targetSheetContext_();
    var count = Math.max(0, Number(rowCount || 0));
    if (!count) return [];
    var lastRow = target.sheet.getLastRow(), startRow = lastRow - count + 1;
    if (startRow < 2) {
      throw error_('AGGREGATE_TARGET_TAIL_INCOMPLETE', 'Aggregate target does not contain the expected appended replacement rows.', {
        retryable: true,
        expectedRows: count,
        lastRow: lastRow
      });
    }
    return target.sheet.getRange(startRow, 1, count, target.headers.length).getValues().map(function (row, index) {
      var object = { __row: startRow + index };
      target.headers.forEach(function (header, column) { object[header] = row[column]; });
      return object;
    });
  }

  function readTargetRows_() {
    try {
      var sheet = publish_().getSheetByName(TARGET_SHEET);
      assertHeaders_(sheet, AKORT.AggregateContract.Headers.slice(), TARGET_SHEET);
      return readObjects_(sheet);
    } catch (caught) {
      if (caught && caught.code) throw caught;
      throw error_('AGGREGATE_TARGET_READ_RETRYABLE', 'Aggregate target could not be read for fingerprint verification.', {
        retryable: true,
        cause: String(caught && caught.message || caught)
      });
    }
  }

  function userEnteredValue_(value, header, row) {
    if (value === '' || value === null || value === undefined) return {};
    if (header === 'period_start') {
      var period = periodKey_(row && row.frequency, value);
      var key = String(row && row.frequency).toLowerCase() === 'monthly' ? period + '-01' : period;
      var parts = key.split('-');
      // The established Publish contract stores canonical periods at local
      // noon. The half-day offset prevents a date from crossing a boundary
      // when Apps Script and the spreadsheet use different time zones.
      var serial = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) / 86400000 + 25569 + 0.5;
      return { numberValue: serial };
    }
    if (header === 'period_label') {
      var frequency = String(row && row.frequency || '').toLowerCase();
      if (frequency === 'monthly') {
        // period_start is the canonical calendar identity. A serialized Date
        // can cross the UTC boundary (for example 2026-07-01 Moscow becomes
        // 2026-06-30T21:00:00Z), so period_label must never derive its month
        // from the serialized display value.
        var month = periodKey_(frequency, row && row.period_start);
        var monthParts = month.split('-');
        if (monthParts.length >= 2) {
          return {
            numberValue: Date.UTC(Number(monthParts[0]), Number(monthParts[1]) - 1, 1) / 86400000 + 25569
          };
        }
      }
      if (value instanceof Date || (typeof value === 'number' && isFinite(value))) {
        return { stringValue: periodKey_(frequency, value) };
      }
    }
    if (typeof value === 'number' && isFinite(value)) return { numberValue: value };
    if (typeof value === 'boolean') return { boolValue: value };
    return { stringValue: String(value) };
  }

  function deleteBlocks_(rowNumbers) {
    var sorted = uniqueSorted_((rowNumbers || []).map(String)).map(Number).sort(function (a, b) { return a - b; });
    var blocks = [], start = null, previous = null;
    sorted.forEach(function (rowNumber) {
      if (start === null) {
        start = rowNumber;
        previous = rowNumber;
        return;
      }
      if (rowNumber === previous + 1) {
        previous = rowNumber;
        return;
      }
      blocks.push({ start: start, end: previous });
      start = rowNumber;
      previous = rowNumber;
    });
    if (start !== null) blocks.push({ start: start, end: previous });
    return blocks.sort(function (a, b) { return b.start - a.start; });
  }

  function batchUpdateReplacement_(spreadsheet, replacement) {
    if (!replacement.deletePhysicalRows.length && !replacement.replacementRows.length) {
      return { apiCalls: 0, requests: 0, deletedRows: 0, appendedRows: 0, noOp: true };
    }
    if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || typeof Sheets.Spreadsheets.batchUpdate !== 'function') {
      throw error_('AGGREGATE_SHEETS_API_UNAVAILABLE', 'Advanced Google Sheets service is required for atomic aggregate publication.', {
        retryable: false
      });
    }
    var sheet = spreadsheet.getSheetByName(TARGET_SHEET);
    assertHeaders_(sheet, AKORT.AggregateContract.Headers.slice(), TARGET_SHEET);
    var sheetId = sheet.getSheetId();
    var requests = [];
    deleteBlocks_(replacement.deletePhysicalRows).forEach(function (block) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId: sheetId,
            dimension: 'ROWS',
            startIndex: block.start - 1,
            endIndex: block.end
          }
        }
      });
    });
    if (replacement.replacementRows.length) {
      requests.push({
        appendCells: {
          sheetId: sheetId,
          rows: replacement.replacementRows.map(function (row) {
            return {
              values: AKORT.AggregateContract.Headers.map(function (header) {
                var cell = { userEnteredValue: userEnteredValue_(row[header], header, row) };
                if ((header === 'period_start' ||
                    (header === 'period_label' && String(row.frequency || '').toLowerCase() === 'monthly')) &&
                    Object.keys(cell.userEnteredValue).length) {
                  cell.userEnteredFormat = { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } };
                }
                return cell;
              })
            };
          }),
          fields: 'userEnteredValue,userEnteredFormat.numberFormat'
        }
      });
    }
    try {
      Sheets.Spreadsheets.batchUpdate({ requests: requests, includeSpreadsheetInResponse: false }, spreadsheet.getId());
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush();
    } catch (caught) {
      throw error_('AGGREGATE_ATOMIC_WRITE_UNCERTAIN', 'Atomic aggregate request failed or returned an uncertain response; retry must classify target before any rewrite.', {
        retryable: true,
        cause: String(caught && caught.message || caught),
        requests: requests.length,
        expectedAfterFingerprint: replacement.afterFingerprint
      });
    }
    return {
      apiCalls: 1,
      requests: requests.length,
      deletedRows: replacement.deletePhysicalRows.length,
      appendedRows: replacement.replacementRows.length,
      noOp: false
    };
  }

  function atomicReplace_(replacement) {
    var settings = systemSettings_();
    if (!truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED) ||
        !truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)) {
      throw error_('AGGREGATE_PHYSICAL_WRITE_DISABLED', 'Both Alpha.7.4 feature flags must be true at the regular physical-write boundary.', {
        retryable: false
      });
    }
    var result = batchUpdateReplacement_(publish_(), replacement);
    invalidateTargetReadCache_();
    return result;
  }

  function gate4AtomicReplaceIsolated_(spreadsheet, replacement) {
    if (AKORT.EnvironmentGuard && typeof AKORT.EnvironmentGuard.assertDev === 'function') {
      AKORT.EnvironmentGuard.assertDev();
    }
    var settings = systemSettings_();
    if (!truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED) ||
        truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)) {
      throw error_('AGGREGATE_GATE4_FLAGS_INVALID', 'Gate 4 requires execution enabled and the regular aggregate pipeline disabled.', {
        retryable: false,
        executionEnabled: truthy_(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED),
        regularPipelineEnabled: truthy_(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED)
      });
    }
    if (!spreadsheet || typeof spreadsheet.getId !== 'function') {
      throw error_('AGGREGATE_GATE4_TARGET_INVALID', 'Gate 4 requires an isolated spreadsheet target.', {
        retryable: false
      });
    }
    var config = AKORT.Config.load({ includeSystemSettings: false });
    if (text_(spreadsheet.getId()) === text_(config.resources.publishSpreadsheetId)) {
      throw error_('AGGREGATE_GATE4_LIVE_TARGET_FORBIDDEN', 'Gate 4 cannot write to the DataLens-connected DEV Publish spreadsheet.', {
        retryable: false
      });
    }
    if (!text_(config.resources.testFilesFolderId)) {
      throw error_('AGGREGATE_GATE4_TEST_FOLDER_MISSING', 'Gate 4 canonical test-files folder is not configured.', {
        retryable: false
      });
    }
    var inTestFolder = false;
    try {
      var parents = DriveApp.getFileById(spreadsheet.getId()).getParents();
      while (parents.hasNext()) {
        if (text_(parents.next().getId()) === text_(config.resources.testFilesFolderId)) {
          inTestFolder = true;
          break;
        }
      }
    } catch (caughtParent) {
      throw error_('AGGREGATE_GATE4_TARGET_PARENT_UNREADABLE', 'Gate 4 could not verify the isolated target parent folder.', {
        retryable: false,
        cause: String(caughtParent && caughtParent.message || caughtParent)
      });
    }
    if (!inTestFolder) {
      throw error_('AGGREGATE_GATE4_TARGET_OUTSIDE_TEST_FOLDER', 'Gate 4 writes are restricted to the canonical DEV test-files folder.', {
        retryable: false
      });
    }
    return batchUpdateReplacement_(spreadsheet, replacement);
  }

  function readImpactRecords_(operationId, loadId) {
    var sheet = dwh_().getSheetByName('PUBLISH_IMPACT');
    return readObjects_(sheet).filter(function (row) {
      return text_(row.operation_id) === text_(operationId) && text_(row.load_id) === text_(loadId);
    });
  }

  function finalize_(identity, state) {
    var sheet = dwh_().getSheetByName('PUBLISH_RUNS');
    if (!sheet) return;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var existing = readObjects_(sheet).filter(function (row) {
      return text_(row.operation_id) === text_(identity.operationId) &&
        text_(row.load_id) === text_(identity.loadId) &&
        text_(row.mode) === 'INCREMENTAL_AGGREGATES_ALPHA74';
    });
    if (existing.length) return;
    var object = {
      publish_run_id: 'PUBRUN_A74_' + hash_([identity.operationId, identity.loadId, identity.planFingerprint]).slice(0, 20).toUpperCase(),
      operation_id: identity.operationId,
      load_id: identity.loadId,
      mode: 'INCREMENTAL_AGGREGATES_ALPHA74',
      status: state.status === 'SUCCESS' || state.status === 'RECONCILED' ? 'SUCCESS' : state.status,
      weekly_series_count: 0,
      monthly_series_count: 0,
      industry_series_count: 0,
      aggregate_combo_count: Number(state.aggregateComboCount || 0),
      publish_rows_written: 0,
      aggregate_rows_written: Number(state.expectedStageRows || 0),
      started_at: '',
      finished_at: now_(),
      error_code: '',
      error_message: '',
      release_version: RELEASE
    };
    appendRows_(sheet, headers, [object]);
  }

  function recordReconciliation_(identity, state, reconciliation) {
    var sheet = dwh_().getSheetByName('PUBLISH_RECONCILIATION');
    if (!sheet) return null;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var reconciliationId = 'RECON_A74_' + hash_([
      identity.operationId,
      identity.loadId,
      identity.planFingerprint,
      state.targetAfterFingerprint
    ]).slice(0, 20).toUpperCase();
    var existing = readObjects_(sheet).filter(function (row) {
      return text_(row.reconciliation_id) === reconciliationId;
    });
    if (existing.length) return existing[0];
    var details = {
      operation_id: identity.operationId,
      load_id: identity.loadId,
      plan_id: identity.planId,
      plan_fingerprint: identity.planFingerprint,
      stage_fingerprint: state.stageFingerprint,
      unrelated_fingerprint: reconciliation.unrelatedFingerprint,
      latest: reconciliation.latest,
      failures: reconciliation.failures || []
    };
    var object = {
      reconciliation_id: reconciliationId,
      checked_at: now_(),
      full_build_id: 'ALPHA74_EXPECTED_AFFECTED_SET',
      incremental_build_id: identity.operationId,
      sheet_name: TARGET_SHEET,
      baseline_rows: '',
      full_rows: Number(state.expectedStageRows || 0),
      incremental_rows: Number(state.expectedStageRows || 0),
      baseline_hash: '',
      full_hash: state.targetAfterFingerprint,
      incremental_hash: reconciliation.affectedFingerprint,
      full_equals_baseline: '',
      incremental_equals_full: reconciliation.affectedFingerprint === state.targetAfterFingerprint,
      status: reconciliation.ok ? 'SUCCESS' : 'FAILED',
      details_json: JSON.stringify(details),
      release_version: RELEASE
    };
    appendRows_(sheet, headers, [object]);
    return object;
  }

  var DefaultAdapter = {
    runtimeSettings: systemSettings_,
    readImpactRecords: readImpactRecords_,
    materializeArtifact: materializeArtifact_,
    materializeArtifactChunk: acceptedParityChunk_,
    persistInputArtifact: persistInputArtifact_,
    readInputArtifact: readInputArtifact_,
    upsertCalculatedRows: upsertCalculatedRows_,
    readCalculatedRows: function (identity) { return stageRowsFor_(identity, false); },
    updateStageStatusChunk: updateStageStatusChunk_,
    updateStageStatus: function (identity, status, fingerprint) {
      return updateStage_(identity, function (row) {
        if (text_(row.aggregate_series_key).indexOf('__') === 0) return;
        row.stage_status = status;
        row.verified_at = status === 'VERIFIED' ? now_() : row.verified_at;
        if (fingerprint) row.expected_target_fingerprint = fingerprint;
      });
    },
    updateStageExpectedFingerprint: function (identity, fingerprint) {
      return updateStage_(identity, function (row) {
        if (text_(row.aggregate_series_key).indexOf('__') < 0) row.expected_target_fingerprint = fingerprint;
      });
    },
    persistPublishIntent: persistPublishIntent_,
    readPublishIntent: readPublishIntent_,
    readTargetRows: readTargetRows_,
    readTargetRowsForStage: readTargetRowsForStage_,
    readTargetTailRows: readTargetTailRows_,
    atomicReplace: atomicReplace_,
    recordReconciliation: recordReconciliation_,
    finalize: finalize_
  };

  function readOnlyContractScan() {
    return AKORT.Core.safeRun('ALPHA74_READ_ONLY_CONTRACT_SCAN', function () {
      AKORT.EnvironmentGuard.assertDev();
      var rows = readTargetRows_(), headers = AKORT.AggregateContract.Headers.slice();
      var logical = {}, duplicates = [], latest = {}, maxima = {}, future = [];
      var today = periodKey_('weekly', new Date());
      rows.forEach(function (row) {
        var series = publicSignature_(row), period = periodKey_(row.frequency, row.period_start);
        var rowKey = series + '|' + period;
        if (logical[rowKey]) duplicates.push(rowKey);
        logical[rowKey] = true;
        if (!maxima[series] || period > maxima[series]) maxima[series] = period;
        if (Number(row.is_latest_period || 0) === 1) {
          latest[series] = latest[series] || [];
          latest[series].push(period);
        }
        var comparable = String(row.frequency).toLowerCase() === 'monthly' ? period + '-01' : period;
        if (comparable > today) future.push(rowKey);
      });
      var latestFailures = [];
      Object.keys(maxima).sort().forEach(function (series) {
        var values = (latest[series] || []).sort();
        if (values.length !== 1 || values[0] !== maxima[series]) {
          latestFailures.push({ series: series, expected: maxima[series], actual: values });
        }
      });
      var result = {
        rows: rows.length,
        columns: headers.length,
        headers: headers,
        fingerprint: rowsFingerprint_(rows, headers, function (row) {
          return publicSignature_(row) + '|' + periodKey_(row.frequency, row.period_start) + '|' + text_(row.aggregate_id);
        }),
        logicalRows: Object.keys(logical).length,
        duplicateLogicalRows: uniqueSorted_(duplicates),
        latestFailures: latestFailures,
        futureRows: uniqueSorted_(future),
        physicalWrites: false
      };
      result.ok = result.columns === 29 &&
        result.duplicateLogicalRows.length === 0 &&
        result.latestFailures.length === 0 &&
        result.futureRows.length === 0;
      if (!result.ok) {
        return AKORT.Result.failure('ALPHA74_READ_ONLY_SCAN_FAILED', 'Alpha.7.4 read-only aggregate contract scan found blocking issues.', result);
      }
      return AKORT.Result.success('Alpha.7.4 read-only aggregate contract scan passed.', result);
    }, { lock: false, persistLogs: false });
  }

  function planReadOnly(operationId, loadId, options) {
    options = options || {};
    return AKORT.Core.safeRun('ALPHA74_READ_ONLY_PLAN', function () {
      AKORT.EnvironmentGuard.assertDev();
      var prepared = normalizeImpactRecords(readImpactRecords_(operationId, loadId), operationId, loadId);
      var artifact = materializeArtifact_(prepared, {
        operationId: operationId,
        loadId: loadId,
        mode: options.mode || 'REVISION',
        reversal: clone_(options.reversal || null)
      });
      var plan = artifact.plan || {};
      return AKORT.Result.success('Alpha.7.4 read-only plan completed without staging or Publish mutation.', {
        operationId: text_(operationId),
        loadId: text_(loadId),
        mode: options.mode || 'REVISION',
        impactRecords: prepared.recordCount,
        aggregateCombos: prepared.aggregateComboCount,
        impactFingerprint: prepared.fingerprint,
        planId: text_(plan.plan_id),
        planFingerprint: text_(plan.fingerprint),
        status: text_(plan.status),
        summary: clone_(plan.summary || {}),
        diagnostics: clone_(plan.diagnostics || []),
        definitionFingerprint: artifact.definitionFingerprint,
        frontier: artifact.frontier,
        physicalWrites: false
      });
    }, { lock: false, persistLogs: false });
  }

  function planRequestReadOnly(request, mode) {
    var normalizedMode = text_(mode || 'REVISION').toUpperCase();
    return AKORT.Core.safeRun('ALPHA74_READ_ONLY_PLAN_REQUEST', function () {
      AKORT.EnvironmentGuard.assertDev();
      if (normalizedMode !== 'REVISION' && normalizedMode !== 'REVERSAL') {
        throw error_('ALPHA74_READ_ONLY_PLAN_MODE_INVALID', 'Read-only plan mode must be REVISION or REVERSAL.', {
          mode: normalizedMode,
          retryable: false
        });
      }
      var plan = normalizedMode === 'REVERSAL'
        ? AKORT.AggregateRevisionPlanner.planReversal(clone_(request || {}))
        : AKORT.AggregateRevisionPlanner.planRevision(clone_(request || {}));
      if (!plan || plan.ok !== true) {
        return AKORT.Result.failure(
          'ALPHA74_READ_ONLY_PLAN_FAILED',
          'Alpha.7.4 read-only acceptance request was rejected by the frozen Alpha.7.3 planner.',
          {
            mode: normalizedMode,
            plan: clone_(plan || null),
            physicalWrites: false
          }
        );
      }
      return AKORT.Result.success(
        'Alpha.7.4 read-only acceptance request completed without staging or Publish mutation.',
        {
          mode: normalizedMode,
          plan: clone_(plan),
          physicalWrites: false
        }
      );
    }, { lock: false, persistLogs: false });
  }

  function statusSummary() {
    return {
      release: RELEASE,
      version: VERSION,
      operationSchemaVersion: OPERATION_SCHEMA_VERSION,
      stageSchemaVersion: STAGE_SCHEMA_VERSION,
      boundedWorkSchemaVersion: BOUNDED_WORK_VERSION,
      targetSheet: TARGET_SHEET,
      stageHeaders: STAGE_HEADERS.slice(),
      phases: AGGREGATE_PHASES.slice(),
      publishHeaders: AKORT.AggregateContract.Headers.slice(),
      physicalWritesDefault: false,
      boundedWorkSettings: clone_(SETTINGS),
      requiredFeatureFlags: [
        'PUBLISH_AGGREGATE_EXECUTION_ENABLED',
        'PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED'
      ]
    };
  }

  function operationalRuntimeContextStatus() {
    return AKORT.Core.safeRun('ALPHA74_OPERATIONAL_RUNTIME_CONTEXT_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      return AKORT.Result.success('Alpha.7.4 operational aggregate runtime context is ready.', assertOperationalRuntimeContext_());
    }, { lock: false, persistLogs: false });
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    OperationSchemaVersion: OPERATION_SCHEMA_VERSION,
    StageSchemaVersion: STAGE_SCHEMA_VERSION,
    StageHeaders: STAGE_HEADERS.slice(),
    Phases: AGGREGATE_PHASES.slice(),
    execute: execute,
    readOnlyContractScan: readOnlyContractScan,
    planReadOnly: planReadOnly,
    planRequestReadOnly: planRequestReadOnly,
    operationalRuntimeContextStatus: operationalRuntimeContextStatus,
    assertOperationalRuntimeContext: assertOperationalRuntimeContext_,
    validateRecoveryStageSnapshot: validateRecoveryStageSnapshot,
    recoverMonthlyPeriodLabelIntent: recoverMonthlyPeriodLabelIntent,
    recoverWeeklyRollbackPeriodBatch: recoverWeeklyRollbackPeriodBatch,
    statusSummary: statusSummary,
    Gate4: Object.freeze({
      atomicReplaceIsolated: gate4AtomicReplaceIsolated_
    }),
    Test: Object.freeze({
      clone: clone_,
      stableStringify: stableStringify_,
      hash: hash_,
      normalizeImpactRecords: normalizeImpactRecords,
      sourceImpactsFromPrepared: sourceImpactsFromPrepared_,
      preparedCombos: preparedCombos_,
      directStageRecord: directStageRecord_,
      calculationGroups: calculationGroups_,
      artifactFingerprint: artifactFingerprint_,
      hydrateGroupRequest: hydrateGroupRequest_,
      projectPublishRow: projectPublishRow,
      buildStageRecord: buildStageRecord,
      validateStageRows: validateStageRows,
      validateStageRowsChunk: validateStageRowsChunk_,
      publicSignature: publicSignature_,
      fingerprintRowValues: fingerprintRowValues_,
      monthlyPeriodLabelMismatch: monthlyPeriodLabelMismatch_,
      isoWeekSundayPeriod: isoWeekSundayPeriod_,
      canonicalPublishPayload: canonicalPublishPayload_,
      weeklyRollbackTargetState: weeklyRollbackTargetState_,
      buildSeriesReplacement: buildSeriesReplacement,
      atomicSeriesBatches: atomicSeriesBatches_,
      classifyRecovery: classifyRecovery,
      currentAffectedFingerprint: currentAffectedFingerprint,
      validateLatest: validateLatest,
      reconcileTarget: reconcileTarget,
      deleteBlocks: deleteBlocks_,
      userEnteredValue: userEnteredValue_
    })
  });
})();
