var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.1 aggregate contract and impact-model primitives.
 *
 * This module is intentionally read-only. It defines canonical identities,
 * impact combinations, versioned rule resolution, coverage semantics and the
 * existing-periods-only frontier. It never writes to RAW or Publish sheets.
 */
AKORT.AggregateContract = (function () {
  var VERSION = '4.0-aggregate-contract-2';
  var RELEASE = '4.0.0-alpha.7.1';
  var AGGREGATE_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var BORSCH_AGGREGATE_ID = 'CUSTOM_BORSCH_BASKET';
  var BORSCH_MEMBERSHIP_VERSION = 'BORSHCH_MEMBERSHIP_V1';
  var EXPECTED_INVENTORY = Object.freeze({
    rows: 61636,
    frequency: Object.freeze({weekly: 32886, monthly: 28750}),
    aggregateLevel: Object.freeze({category: 48204, group: 9117, basket: 2168, total_cpi: 87, custom_group: 2060}),
    indexType: Object.freeze({wow: 17461, mom: 11378, yoy: 16471, december: 16326})
  });
  var HEADERS = Object.freeze([
    'dataset_code','source_name','frequency','aggregate_level','aggregate_id','aggregate_name','category_id','product_group','product_name','value_type','index_type','period_start','year','quarter','month','period_label','category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count','coverage_weight_sum','is_latest_period','aggregate_value','aggregate_base_value'
  ]);
  var ALLOWED_INDEX_TYPES = Object.freeze({
    weekly: Object.freeze(['wow','yoy','december']),
    monthly: Object.freeze(['mom','yoy','december'])
  });
  var REQUIRED_IMPACT_FIELDS = Object.freeze([
    'load_id','operation_id','reason_code','source_dataset_code','source_series_id','source_category_id','source_period','frequency','target_value_type','target_index_type','target_aggregate_scope','target_period','weight_snapshot_id','membership_snapshot_id','frontier_snapshot_id','created_at'
  ]);

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function norm_(value) {
    return text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function number_(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var normalized = String(value).replace(/\s/g, '').replace(',', '.');
    var parsed = Number(normalized);
    return isFinite(parsed) ? parsed : null;
  }

  function pad2_(value) {
    return ('0' + Number(value)).slice(-2);
  }

  function date_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === 'number' && isFinite(value)) {
      var excelDate = new Date(Math.round((value - 25569) * 86400000));
      return isNaN(excelDate.getTime()) ? null : excelDate;
    }
    if (!value) return null;
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateKey_(value) {
    var d = date_(value);
    if (!d) return '';
    return [d.getFullYear(), pad2_(d.getMonth() + 1), pad2_(d.getDate())].join('-');
  }

  function monthKey_(value) {
    var d = date_(value);
    if (d) return [d.getFullYear(), pad2_(d.getMonth() + 1)].join('-');
    var t = text_(value);
    return /^\d{4}-\d{2}/.test(t) ? t.slice(0, 7) : '';
  }

  function frequency_(value) {
    var f = norm_(value);
    if (f !== 'weekly' && f !== 'monthly') throw contractError_('AGG_FREQUENCY_INVALID', 'Unsupported aggregate frequency.', {frequency:value});
    return f;
  }

  function periodKey_(frequency, value) {
    var f = frequency_(frequency);
    var key = f === 'weekly' ? dateKey_(value) : monthKey_(value);
    if (!key) throw contractError_('AGG_PERIOD_INVALID', 'Aggregate period is missing or invalid.', {frequency:f, period:value});
    return key;
  }

  function contractError_(code, message, details) {
    var error = new Error(message);
    error.name = 'AggregateContractError';
    error.code = code;
    error.details = details || {};
    return error;
  }

  function requireText_(object, field, code) {
    var value = text_(object && object[field]);
    if (!value) throw contractError_(code || 'AGG_REQUIRED_FIELD_MISSING', 'Required aggregate contract field is missing: ' + field + '.', {field:field});
    return value;
  }

  function canonicalIndexTypes(frequency, sourceIndexType, sourceKind) {
    var f = frequency_(frequency);
    var allowed = ALLOWED_INDEX_TYPES[f];
    var indexType = norm_(sourceIndexType);
    var kind = norm_(sourceKind || 'price_level');
    if (kind === 'industry') return [];
    if (kind === 'official_index') {
      if (!indexType || allowed.indexOf(indexType) < 0) {
        throw contractError_('AGG_INDEX_TYPE_INVALID', 'Official index source must provide one supported canonical index type.', {frequency:f, indexType:sourceIndexType});
      }
      return [indexType];
    }
    if (!indexType) return allowed.slice();
    if (allowed.indexOf(indexType) < 0) {
      throw contractError_('AGG_INDEX_TYPE_INVALID', 'Unsupported aggregate index type.', {frequency:f, indexType:sourceIndexType});
    }
    return [indexType];
  }

  function aggregateSubjectId(definition) {
    var def = definition || {};
    var level = requireText_(def, 'aggregate_level', 'AGG_LEVEL_MISSING');
    if (level === 'category') return requireText_(def, 'category_id', 'AGG_CATEGORY_ID_MISSING');
    if (level === 'group') return requireText_(def, 'group_id', 'AGG_GROUP_ID_MISSING');
    if (level === 'basket' || level === 'total_cpi' || level === 'custom_group') {
      return requireText_(def, 'aggregate_subject_id', 'AGG_SUBJECT_ID_MISSING');
    }
    throw contractError_('AGG_LEVEL_INVALID', 'Unsupported aggregate level.', {aggregateLevel:level});
  }

  function aggregateSeriesKey(definition) {
    var def = definition || {};
    var level = requireText_(def, 'aggregate_level', 'AGG_LEVEL_MISSING');
    var membershipRuleId = text_(def.membership_rule_id);
    if (!membershipRuleId && level !== 'category') {
      throw contractError_('AGG_MEMBERSHIP_RULE_MISSING', 'membership_rule_id is required outside category level.', {aggregateLevel:level});
    }
    return [
      requireText_(def, 'dataset_code', 'AGG_DATASET_MISSING'),
      frequency_(def.frequency),
      level,
      aggregateSubjectId(def),
      requireText_(def, 'value_type', 'AGG_VALUE_TYPE_MISSING'),
      canonicalIndexTypes(def.frequency, requireText_(def, 'index_type', 'AGG_INDEX_TYPE_MISSING'), 'official_index')[0],
      requireText_(def, 'calculation_method', 'AGG_CALCULATION_METHOD_MISSING'),
      requireText_(def, 'weight_rule_id', 'AGG_WEIGHT_RULE_MISSING'),
      membershipRuleId || 'NONE'
    ].join('|');
  }

  function aggregateRowKey(definition) {
    var def = definition || {};
    return aggregateSeriesKey(def) + '|' + periodKey_(def.frequency, def.period_start);
  }

  function normalizeImpactItem(item) {
    var source = item || {};
    REQUIRED_IMPACT_FIELDS.forEach(function (field) {
      requireText_(source, field, 'AGG_IMPACT_REQUIRED_FIELD_MISSING');
    });
    var f = frequency_(source.frequency);
    var targetIndexType = canonicalIndexTypes(f, source.target_index_type, 'official_index')[0];
    var normalized = {
      impact_id: text_(source.impact_id),
      load_id: text_(source.load_id),
      operation_id: text_(source.operation_id),
      reason_code: text_(source.reason_code),
      source_dataset_code: text_(source.source_dataset_code),
      source_series_id: text_(source.source_series_id),
      source_category_id: text_(source.source_category_id),
      source_period: periodKey_(f, source.source_period),
      frequency: f,
      target_aggregate_scope: text_(source.target_aggregate_scope),
      target_value_type: text_(source.target_value_type),
      target_index_type: targetIndexType,
      target_period: periodKey_(f, source.target_period),
      weight_snapshot_id: text_(source.weight_snapshot_id),
      membership_snapshot_id: text_(source.membership_snapshot_id),
      frontier_snapshot_id: text_(source.frontier_snapshot_id),
      status: text_(source.status || 'PLANNED'),
      contract_code: text_(source.contract_code),
      blocked_reason: text_(source.blocked_reason),
      created_at: text_(source.created_at)
    };
    normalized.combo_key = comboKey(normalized);
    var expectedImpactId = 'AGG_IMPACT_' + hash_(normalized.combo_key).toUpperCase();
    if (text_(source.impact_id) && text_(source.impact_id) !== expectedImpactId) {
      throw contractError_('AGG_IMPACT_ID_MISMATCH', 'Provided impact_id does not match the deterministic combo identity.', {provided:source.impact_id, expected:expectedImpactId});
    }
    normalized.impact_id = expectedImpactId;
    return normalized;
  }

  function comboKey(item) {
    var x = item || {};
    return [
      requireText_(x, 'load_id', 'AGG_COMBO_LOAD_MISSING'),
      requireText_(x, 'reason_code', 'AGG_COMBO_REASON_MISSING'),
      requireText_(x, 'source_series_id', 'AGG_COMBO_SOURCE_SERIES_MISSING'),
      periodKey_(x.frequency, x.source_period),
      frequency_(x.frequency),
      requireText_(x, 'target_value_type', 'AGG_COMBO_VALUE_TYPE_MISSING'),
      canonicalIndexTypes(x.frequency, requireText_(x, 'target_index_type', 'AGG_COMBO_INDEX_TYPE_MISSING'), 'official_index')[0],
      requireText_(x, 'target_aggregate_scope', 'AGG_COMBO_SCOPE_MISSING'),
      periodKey_(x.frequency, x.target_period),
      requireText_(x, 'weight_snapshot_id', 'AGG_COMBO_WEIGHT_SNAPSHOT_MISSING'),
      requireText_(x, 'membership_snapshot_id', 'AGG_COMBO_MEMBERSHIP_SNAPSHOT_MISSING')
    ].join('|');
  }

  function dedupeImpactItems(items) {
    var map = {};
    (items || []).forEach(function (item) {
      var normalized = normalizeImpactItem(item);
      var existing = map[normalized.combo_key];
      if (existing && (existing.status !== normalized.status || existing.contract_code !== normalized.contract_code)) {
        throw contractError_('AGG_COMBO_STATUS_CONFLICT', 'The same combo_key has conflicting contract statuses.', {comboKey:normalized.combo_key, firstStatus:existing.status, secondStatus:normalized.status});
      }
      if (!existing) map[normalized.combo_key] = normalized;
    });
    return Object.keys(map).sort().map(function (key) { return map[key]; });
  }

  function frontierKey(frequency, datasetCode, seriesScope, period) {
    return [frequency_(frequency), text_(datasetCode), text_(seriesScope || 'ALL'), periodKey_(frequency, period)].join('|');
  }

  function buildFrontier(snapshotId, items) {
    var map = {};
    (items || []).forEach(function (item) {
      var key = frontierKey(item.frequency, item.dataset_code, item.source_series_scope || 'ALL', item.period_start);
      map[key] = true;
    });
    return {
      snapshot_id: requireText_({snapshot_id:snapshotId}, 'snapshot_id', 'AGG_FRONTIER_SNAPSHOT_MISSING'),
      count: Object.keys(map).length,
      hash: hash_(Object.keys(map).sort().join('\n')),
      keys: map
    };
  }

  function validateFrontier(frontier, expectedSnapshotId, expectedHash) {
    if (!frontier || !frontier.keys) throw contractError_('AGG_FRONTIER_REQUIRED', 'A materialized existing-periods frontier is required. A snapshot ID alone is insufficient.');
    var snapshotId = requireText_(frontier, 'snapshot_id', 'AGG_FRONTIER_SNAPSHOT_MISSING');
    var expectedSnapshot = requireText_({snapshot_id:expectedSnapshotId}, 'snapshot_id', 'AGG_FRONTIER_EXPECTED_SNAPSHOT_MISSING');
    var expectedDigest = requireText_({hash:expectedHash}, 'hash', 'AGG_FRONTIER_EXPECTED_HASH_MISSING');
    var keys = Object.keys(frontier.keys).filter(function (key) { return frontier.keys[key] === true; }).sort();
    var actualHash = hash_(keys.join('\n'));
    if (snapshotId !== expectedSnapshot) throw contractError_('AGG_FRONTIER_SNAPSHOT_MISMATCH', 'Frontier snapshot_id does not match the expected snapshot.', {actual:snapshotId, expected:expectedSnapshot});
    if (Number(frontier.count) !== keys.length) throw contractError_('AGG_FRONTIER_COUNT_MISMATCH', 'Frontier count does not match its materialized keys.', {actual:frontier.count, expected:keys.length});
    if (text_(frontier.hash) !== actualHash) throw contractError_('AGG_FRONTIER_HASH_INVALID', 'Frontier content does not match its own hash.', {actual:frontier.hash, computed:actualHash});
    if (actualHash !== expectedDigest) throw contractError_('AGG_FRONTIER_HASH_MISMATCH', 'Frontier content does not match the expected operation hash.', {actual:actualHash, expected:expectedDigest});
    return {snapshot_id:snapshotId, count:keys.length, hash:actualHash, keys:frontier.keys};
  }

  function frontierAllows(frontier, frequency, datasetCode, seriesScope, candidatePeriod) {
    if (!frontier || !frontier.keys) return false;
    var exact = frontierKey(frequency, datasetCode, seriesScope || 'ALL', candidatePeriod);
    var broad = frontierKey(frequency, datasetCode, 'ALL', candidatePeriod);
    return frontier.keys[exact] === true || frontier.keys[broad] === true;
  }

  function filterExistingPeriods(frontier, frequency, datasetCode, seriesScope, candidatePeriods) {
    var seen = {};
    (candidatePeriods || []).forEach(function (period) {
      var key = periodKey_(frequency, period);
      if (frontierAllows(frontier, frequency, datasetCode, seriesScope, key)) seen[key] = true;
    });
    return Object.keys(seen).sort();
  }

  function frontierCheckpoint(frontier, cursor) {
    if (!frontier || !frontier.snapshot_id) throw contractError_('AGG_FRONTIER_INVALID', 'Frontier snapshot is required.');
    return {
      frontier_snapshot_id: frontier.snapshot_id,
      cursor: Math.max(0, Number(cursor || 0)),
      total: Number(frontier.count || 0),
      hash: text_(frontier.hash)
    };
  }

  function addDays_(value, days) {
    var d = date_(value);
    if (!d) throw contractError_('AGG_PERIOD_INVALID', 'Cannot add days to an invalid period.', {period:value});
    d.setDate(d.getDate() + Number(days || 0));
    return dateKey_(d);
  }

  function addMonths_(value, months) {
    var key = monthKey_(value);
    if (!key) throw contractError_('AGG_PERIOD_INVALID', 'Cannot add months to an invalid period.', {period:value});
    var parts = key.split('-'), d = new Date(Number(parts[0]), Number(parts[1]) - 1 + Number(months || 0), 1, 12);
    return monthKey_(d);
  }

  function dependencyCandidates(frequency, sourcePeriod, indexType, existingPeriods) {
    var f = frequency_(frequency), source = periodKey_(f, sourcePeriod), idx = canonicalIndexTypes(f, indexType, 'official_index')[0], seen = {};
    seen[source] = true;
    if (idx === 'wow') seen[addDays_(source, 7)] = true;
    else if (idx === 'mom') seen[addMonths_(source, 1)] = true;
    else if (idx === 'yoy') seen[f === 'weekly' ? addDays_(source, 364) : addMonths_(source, 12)] = true;
    else if (idx === 'december') {
      var year = Number(source.slice(0, 4)), month = Number(source.slice(5, 7));
      if (month === 12) (existingPeriods || []).forEach(function (period) {
        var key = periodKey_(f, period);
        if (Number(key.slice(0, 4)) === year + 1) seen[key] = true;
      });
    }
    return Object.keys(seen).sort();
  }

  function ruleDateKey_(value, endOfPeriod) {
    var raw = text_(value);
    if (!raw) return endOfPeriod ? '9999-12-31' : '1900-01-01';
    if (/^\d{4}-\d{2}$/.test(raw)) {
      if (!endOfPeriod) return raw + '-01';
      var parts = raw.split('-');
      var last = new Date(Number(parts[0]), Number(parts[1]), 0, 12);
      return [last.getFullYear(), pad2_(last.getMonth() + 1), pad2_(last.getDate())].join('-');
    }
    var key = dateKey_(value);
    if (!key) throw contractError_('AGG_RULE_EFFECTIVE_DATE_INVALID', 'Versioned rule effective date is invalid.', {value:value});
    return key;
  }

  function activeAt_(row, period) {
    var point = ruleDateKey_(period, false);
    var from = ruleDateKey_(row.effective_from, false);
    var to = ruleDateKey_(row.effective_to, true);
    var status = norm_(row.status || 'active');
    var enabled = !status || ['active','accepted','current'].indexOf(status) >= 0;
    return point >= from && point <= to && enabled && Number(row.include_flag === undefined ? 1 : row.include_flag) !== 0;
  }

  function resolveVersionedRule(rules, criteria) {
    var c = criteria || {};
    var categoryId = requireText_(c, 'category_id', 'AGG_RULE_CATEGORY_MISSING');
    var scope = requireText_(c, 'scope', 'AGG_RULE_SCOPE_MISSING');
    var period = requireText_(c, 'period', 'AGG_RULE_PERIOD_MISSING');
    var matches = (rules || []).filter(function (row) {
      return text_(row.category_id) === categoryId && text_(row.scope || row.weight_scope || row.aggregate_subject_id) === scope && activeAt_(row, period);
    });
    if (!matches.length) return {status:'MISSING', rule:null};
    var signatures = {};
    matches.forEach(function (row) {
      var signature = [text_(row.rule_id || row.weight_rule_id || row.membership_rule_id), text_(row.version || row.weight_version || row.membership_version), text_(row.weight_value), text_(row.allocation_factor), text_(row.include_flag)].join('|');
      signatures[signature] = true;
    });
    if (Object.keys(signatures).length > 1) {
      throw contractError_('CONTRACT_CONFLICT', 'More than one different rule is effective for the same category/scope/period.', {categoryId:categoryId, scope:scope, period:period, matches:matches.length});
    }
    return {status:'RESOLVED', rule:matches[0]};
  }

  function classifyValue(value, options) {
    var opts = options || {};
    if (opts.notApplicable === true) return {state:'NOT_APPLICABLE', value:null};
    if (value === null || value === undefined || value === '') return {state:'MISSING', value:null};
    var parsed = number_(value);
    if (parsed === null) return {state:'INVALID', value:null};
    if (opts.nonNegative === true && parsed < 0) return {state:'INVALID', value:parsed};
    return {state:parsed === 0 ? 'ZERO' : 'VALID', value:parsed};
  }

  function coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, allowPartial) {
    var notApplicable = Number(notApplicableMembers || 0);
    var ratio = expectedWeight > 0 ? appliedWeight / expectedWeight : null;
    var status = expectedMembers === 0 && notApplicable > 0 ? 'NOT_APPLICABLE' : (invalidMembers > 0 ? 'INVALID' : (appliedMembers === expectedMembers ? 'COMPLETE' : 'PARTIAL'));
    return {
      expected_members_count: expectedMembers,
      applied_members_count: appliedMembers,
      not_applicable_members_count:notApplicable,
      expected_weight_sum: round_(expectedWeight, 10),
      applied_weight_sum: round_(appliedWeight, 10),
      coverage_ratio: ratio === null ? null : round_(ratio, 10),
      coverage_status: status,
      publication_allowed: status === 'COMPLETE' || (status === 'PARTIAL' && allowPartial === true)
    };
  }

  function notApplicable_(row, field) {
    var r = row || {};
    return r.notApplicable === true || r.not_applicable === true || (field && (r[field + '_notApplicable'] === true || r[field + '_not_applicable'] === true));
  }

  function weightedAverage(members, coverageRule) {
    var rows = members || [], expectedMembers = 0, expectedWeight = 0, appliedWeight = 0, weighted = 0, appliedMembers = 0, invalidMembers = 0, notApplicableMembers = 0;
    rows.forEach(function (row) {
      var value = classifyValue(row.value, {notApplicable:notApplicable_(row, 'value')});
      if (value.state === 'NOT_APPLICABLE') { notApplicableMembers += 1; return; }
      expectedMembers += 1;
      var weight = classifyValue(row.weight, {nonNegative:true});
      if (weight.state === 'INVALID' || weight.state === 'MISSING' || weight.value <= 0) { invalidMembers += 1; return; }
      expectedWeight += weight.value;
      if (value.state === 'INVALID') { invalidMembers += 1; return; }
      if (value.state === 'MISSING') return;
      appliedWeight += weight.value;
      weighted += weight.value * value.value;
      appliedMembers += 1;
    });
    var coverage = coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, coverageRule && coverageRule.allow_partial === true);
    if (coverage.coverage_status === 'NOT_APPLICABLE') return {status:'NOT_APPLICABLE', value:null, coverage:coverage};
    if (invalidMembers > 0) return {status:'BLOCKED_INVALID_MEMBER', value:null, coverage:coverage};
    if (appliedWeight <= 0) return {status:'BLOCKED_ZERO_APPLIED_WEIGHT', value:null, coverage:coverage};
    return {status:coverage.publication_allowed ? 'READY' : 'PARTIAL_NOT_PUBLISHABLE', value:round_(weighted / appliedWeight, 6), coverage:coverage};
  }

  function percentChange(currentValue, baseValue) {
    var current = classifyValue(currentValue);
    var base = classifyValue(baseValue);
    if (current.state !== 'VALID' && current.state !== 'ZERO') return {status:'INVALID_CURRENT', value:null};
    if (base.state === 'ZERO') return {status:'INVALID_BASE_ZERO', value:null};
    if (base.state !== 'VALID') return {status:'INVALID_BASE', value:null};
    return {status:'READY', value:round_((current.value / base.value - 1) * 100, 6)};
  }

  function aggregateMarkup(members, baseMarkupPct, coverageRule) {
    var rows = members || [], expectedMembers = 0, expectedWeight = 0, appliedWeight = 0, weightedPurchase = 0, weightedRetail = 0, appliedMembers = 0, invalidMembers = 0, notApplicableMembers = 0;
    rows.forEach(function (row) {
      var purchase = classifyValue(row.purchase, {nonNegative:true, notApplicable:notApplicable_(row, 'purchase')});
      var retail = classifyValue(row.retail, {nonNegative:true, notApplicable:notApplicable_(row, 'retail')});
      if (purchase.state === 'NOT_APPLICABLE' || retail.state === 'NOT_APPLICABLE') {
        if (purchase.state !== retail.state) invalidMembers += 1;
        else notApplicableMembers += 1;
        return;
      }
      expectedMembers += 1;
      var weight = classifyValue(row.weight, {nonNegative:true});
      if (weight.state === 'INVALID' || weight.state === 'MISSING' || weight.value <= 0) { invalidMembers += 1; return; }
      expectedWeight += weight.value;
      if (purchase.state === 'INVALID' || retail.state === 'INVALID') { invalidMembers += 1; return; }
      if (purchase.state === 'MISSING' || retail.state === 'MISSING') return;
      if (purchase.value === 0) { invalidMembers += 1; return; }
      appliedWeight += weight.value;
      weightedPurchase += weight.value * purchase.value;
      weightedRetail += weight.value * retail.value;
      appliedMembers += 1;
    });
    var coverage = coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, coverageRule && coverageRule.allow_partial === true);
    if (coverage.coverage_status === 'NOT_APPLICABLE') return {status:'NOT_APPLICABLE', aggregate_value:null, aggregate_base_value:null, aggregate_change_pp:null, coverage:coverage};
    if (invalidMembers > 0) return {status:'BLOCKED_INVALID_MEMBER', aggregate_value:null, aggregate_base_value:null, aggregate_change_pp:null, coverage:coverage};
    if (appliedWeight <= 0 || weightedPurchase <= 0) return {status:'INVALID_BASE_ZERO', aggregate_value:null, aggregate_base_value:null, aggregate_change_pp:null, coverage:coverage};
    var purchaseLevel = weightedPurchase / appliedWeight, retailLevel = weightedRetail / appliedWeight, markupPct = (retailLevel / purchaseLevel - 1) * 100;
    var base = classifyValue(baseMarkupPct), hasBase = base.state === 'VALID' || base.state === 'ZERO';
    return {status:coverage.publication_allowed ? 'READY' : 'PARTIAL_NOT_PUBLISHABLE', aggregate_value:round_(markupPct, 6), aggregate_base_value:hasBase ? round_(base.value, 6) : null, aggregate_change_pp:hasBase ? round_(markupPct - base.value, 6) : null, weighted_purchase:round_(purchaseLevel, 6), weighted_retail:round_(retailLevel, 6), coverage:coverage};
  }

  function validateMembershipSnapshot(rows, options) {
    var opts = options || {};
    var aggregateSubjectId = requireText_(opts, 'aggregate_subject_id', 'AGG_MEMBERSHIP_SUBJECT_MISSING');
    var version = requireText_(opts, 'membership_version', 'AGG_MEMBERSHIP_VERSION_MISSING');
    var expectedCount = Number(opts.expected_count || 0);
    var seen = {};
    var active = (rows || []).filter(function (row) {
      return text_(row.aggregate_subject_id) === aggregateSubjectId && text_(row.membership_version) === version && Number(row.include_flag === undefined ? 1 : row.include_flag) === 1;
    });
    active.forEach(function (row) {
      var categoryId = requireText_(row, 'category_id', 'AGG_MEMBERSHIP_CATEGORY_MISSING');
      if (seen[categoryId]) throw contractError_('AGG_MEMBERSHIP_DUPLICATE', 'Duplicate category within one membership snapshot.', {categoryId:categoryId});
      seen[categoryId] = true;
    });
    if (expectedCount && active.length !== expectedCount) {
      throw contractError_('AGG_MEMBERSHIP_COUNT_MISMATCH', 'Membership snapshot has an unexpected number of active members.', {expected:expectedCount, actual:active.length});
    }
    return {aggregate_subject_id:aggregateSubjectId, membership_version:version, active_members_count:active.length, category_ids:Object.keys(seen).sort()};
  }

  function buildImpactPlan(affected, options) {
    var opts = options || {};
    var frontier = validateFrontier(opts.frontier, opts.frontier_snapshot_id, opts.frontier_hash);
    var weightSnapshotId = requireText_(opts, 'weight_snapshot_id', 'AGG_WEIGHT_SNAPSHOT_MISSING');
    var membershipSnapshotId = requireText_(opts, 'membership_snapshot_id', 'AGG_MEMBERSHIP_SNAPSHOT_MISSING');
    var createdAt = requireText_(opts, 'created_at', 'AGG_CREATED_AT_MISSING');
    var out = [], summary = {sources_total:0, sources_price:0, skipped_not_applicable:0, planned:0, blocked_contract:0};
    (affected || []).forEach(function (source) {
      summary.sources_total += 1;
      var sourceKind = norm_(source.source_kind || 'price_level');
      if (sourceKind === 'industry') {
        if (norm_(source.frequency) !== 'industry') throw contractError_('AGG_INDUSTRY_FREQUENCY_INVALID', 'Industry source must use frequency=industry.', {frequency:source.frequency});
        summary.skipped_not_applicable += 1;
        return;
      }
      var f = frequency_(source.frequency);
      summary.sources_price += 1;
      var periods = source.candidate_periods && source.candidate_periods.length ? source.candidate_periods.slice() : [source.period];
      var indexTypes = canonicalIndexTypes(f, source.index_type, sourceKind);
      periods.forEach(function (targetPeriod) {
        var canonicalPeriod = periodKey_(f, targetPeriod);
        var allowed = frontierAllows(frontier, f, source.dataset_code, source.source_series_scope || 'ALL', canonicalPeriod);
        indexTypes.forEach(function (indexType) {
          out.push(normalizeImpactItem({
            load_id:source.load_id, operation_id:source.operation_id, reason_code:source.reason_code,
            source_dataset_code:source.dataset_code, source_series_id:source.series_id, source_category_id:source.category_id || '', source_period:source.period,
            frequency:f, target_aggregate_scope:source.target_aggregate_scope || 'ALL_APPLICABLE', target_value_type:source.value_type,
            target_index_type:indexType, target_period:canonicalPeriod, weight_snapshot_id:weightSnapshotId, membership_snapshot_id:membershipSnapshotId,
            frontier_snapshot_id:frontier.snapshot_id, status:allowed ? 'PLANNED' : 'BLOCKED_CONTRACT',
            contract_code:allowed ? '' : 'AGG_FRONTIER_PERIOD_NOT_ALLOWED', blocked_reason:allowed ? '' : 'Candidate target period is absent from the validated existing-periods frontier.', created_at:createdAt
          }));
        });
      });
    });
    var items = dedupeImpactItems(out);
    items.forEach(function (item) { if (item.status === 'PLANNED') summary.planned += 1; else if (item.status === 'BLOCKED_CONTRACT') summary.blocked_contract += 1; });
    return {items:items, summary:summary, frontier:{snapshot_id:frontier.snapshot_id,count:frontier.count,hash:frontier.hash}};
  }

  function hash_(text) {
    var value = String(text || '');
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
      return bytes.map(function (b) { var n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join('');
    }
    var h = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function fingerprintRows(rows, headers) {
    var cols = headers || [], text = (rows || []).map(function (row) {
      return cols.map(function (header, index) {
        var value = Array.isArray(row) ? row[index] : row[header];
        if (value instanceof Date && !isNaN(value.getTime())) return 'D:' + dateKey_(value) + 'T' + [pad2_(value.getHours()),pad2_(value.getMinutes()),pad2_(value.getSeconds())].join(':');
        if (value === null || value === undefined) return '';
        return String(value);
      }).join('\u001f');
    }).join('\u001e');
    return hash_(text);
  }

  function round_(value, digits) {
    if (value === null || value === undefined || value === '' || !isFinite(Number(value))) return null;
    var factor = Math.pow(10, Number(digits || 0));
    return Math.round(Number(value) * factor) / factor;
  }

  function increment_(map, key) {
    var normalized = text_(key);
    map[normalized] = Number(map[normalized] || 0) + 1;
  }

  function inventoryBySpreadsheetId_(spreadsheetId) {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId), sheet = spreadsheet.getSheetByName(AGGREGATE_SHEET);
    if (!sheet) throw contractError_('AGG_SHEET_MISSING', 'PUBLISH_PRICE_AGGREGATES sheet was not found.', {spreadsheetId:spreadsheetId});
    var lastRow = sheet.getLastRow(), lastColumn = sheet.getLastColumn(), rowCount = Math.max(0, lastRow - 1);
    var headers = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0], frequencyCounts = {}, levelCounts = {}, indexCounts = {}, invalidIndexTypes = 0, blankIndexTypes = 0;
    var chunkRows = 1000, digestParts = [], chunks = 0;
    for (var cursor = 0; cursor < rowCount; cursor += chunkRows) {
      var count = Math.min(chunkRows, rowCount - cursor), values = sheet.getRange(cursor + 2, 1, count, HEADERS.length).getDisplayValues();
      values.forEach(function (row) {
        increment_(frequencyCounts, row[2]); increment_(levelCounts, row[3]);
        var idx = norm_(row[10]); if (!idx) blankIndexTypes += 1; else { increment_(indexCounts, idx); if (['wow','mom','yoy','december'].indexOf(idx) < 0) invalidIndexTypes += 1; }
      });
      digestParts.push(fingerprintRows(values, HEADERS)); chunks += 1;
    }
    var dataHash = hash_(digestParts.join('|'));
    return {spreadsheet_id:spreadsheetId, spreadsheet_name:spreadsheet.getName(), sheet_name:AGGREGATE_SHEET, rows:rowCount, columns:lastColumn, headers:headers,
      frequency:frequencyCounts, aggregate_level:levelCounts, index_type:indexCounts, blank_index_types:blankIndexTypes, invalid_index_types:invalidIndexTypes,
      data_hash:dataHash, data_hash_chunks:chunks, data_hash_algorithm:'SHA-256-OF-CHUNK-SHA-256', fingerprint:hash_(JSON.stringify({rows:rowCount,columns:lastColumn,headers:headers,dataHash:dataHash}))};
  }

  function inventory() {
    if (!AKORT.Config || !AKORT.Config.load) throw contractError_('AGG_CONFIG_UNAVAILABLE', 'AKORT.Config is not available.');
    var config = AKORT.Config.load({includeSystemSettings:false}), publishId = config && config.resources && config.resources.publishSpreadsheetId;
    if (!publishId) throw contractError_('AGG_PUBLISH_ID_MISSING', 'DEV Publish spreadsheet ID is missing from local configuration.');
    return inventoryBySpreadsheetId_(publishId);
  }

  function baselineInventory() {
    if (!AKORT.Config || !AKORT.Config.load) throw contractError_('AGG_CONFIG_UNAVAILABLE', 'AKORT.Config is not available.');
    var config = AKORT.Config.load({includeSystemSettings:false}), baselineId = config && config.resources && config.resources.alpha71BaselinePublishSpreadsheetId;
    if (!baselineId) throw contractError_('AGG_BASELINE_REFERENCE_MISSING', 'alpha71BaselinePublishSpreadsheetId must be configured locally before live acceptance.');
    return inventoryBySpreadsheetId_(baselineId);
  }

  function compareInventory(current, baseline) {
    var a = current || {}, b = baseline || {}, fields = ['rows','columns','headers','frequency','aggregate_level','index_type','blank_index_types','invalid_index_types','data_hash'], diffs = [];
    fields.forEach(function (field) { if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) diffs.push({field:field,current:a[field],baseline:b[field]}); });
    return {equal:diffs.length === 0, differing_fields:diffs, current_hash:text_(a.data_hash), baseline_hash:text_(b.data_hash)};
  }

  function statusSummary() {
    return {
      release_candidate:RELEASE,
      accepted_runtime_release:AKORT.Release && AKORT.Release.version || '',
      contract_version:VERSION,
      acceptance_status:'PRE_ACCEPTANCE_NO_GO_UNTIL_LIVE_AND_COMPATIBILITY_PASS',
      mode:'READ_ONLY',
      aggregate_sheet:AGGREGATE_SHEET,
      allowed_index_types:{weekly:ALLOWED_INDEX_TYPES.weekly.slice(),monthly:ALLOWED_INDEX_TYPES.monthly.slice()},
      required_impact_fields:REQUIRED_IMPACT_FIELDS.slice(),
      expected_inventory:JSON.parse(JSON.stringify(EXPECTED_INVENTORY)),
      borshch:{aggregate_subject_id:BORSCH_AGGREGATE_ID,membership_version:BORSCH_MEMBERSHIP_VERSION,expected_members_count:5}
    };
  }

  return Object.freeze({
    Version:VERSION,
    Release:RELEASE,
    AggregateSheet:AGGREGATE_SHEET,
    Headers:HEADERS.slice(),
    ExpectedInventory:JSON.parse(JSON.stringify(EXPECTED_INVENTORY)),
    AllowedIndexTypes:{weekly:ALLOWED_INDEX_TYPES.weekly.slice(),monthly:ALLOWED_INDEX_TYPES.monthly.slice()},
    RequiredImpactFields:REQUIRED_IMPACT_FIELDS.slice(),
    BorshchAggregateId:BORSCH_AGGREGATE_ID,
    BorshchMembershipVersion:BORSCH_MEMBERSHIP_VERSION,
    canonicalIndexTypes:canonicalIndexTypes,
    aggregateSubjectId:aggregateSubjectId,
    aggregateSeriesKey:aggregateSeriesKey,
    aggregateRowKey:aggregateRowKey,
    normalizeImpactItem:normalizeImpactItem,
    comboKey:comboKey,
    dedupeImpactItems:dedupeImpactItems,
    frontierKey:frontierKey,
    buildFrontier:buildFrontier,
    validateFrontier:validateFrontier,
    frontierAllows:frontierAllows,
    filterExistingPeriods:filterExistingPeriods,
    frontierCheckpoint:frontierCheckpoint,
    dependencyCandidates:dependencyCandidates,
    resolveVersionedRule:resolveVersionedRule,
    classifyValue:classifyValue,
    weightedAverage:weightedAverage,
    percentChange:percentChange,
    aggregateMarkup:aggregateMarkup,
    validateMembershipSnapshot:validateMembershipSnapshot,
    buildImpactPlan:buildImpactPlan,
    fingerprintRows:fingerprintRows,
    inventory:inventory,
    baselineInventory:baselineInventory,
    compareInventory:compareInventory,
    statusSummary:statusSummary,
    Test:{periodKey:periodKey_,hash:hash_,contractError:contractError_}
  });
})();
