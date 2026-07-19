var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.2 pure aggregate calculator.
 *
 * The module accepts normalized in-memory inputs and returns deterministic
 * calculation rows plus diagnostics. It has no storage, trigger, lock or
 * orchestration responsibilities.
 */
AKORT.AggregateCalculator = (function () {
  var VERSION = '4.0-aggregate-calculator-1';
  var RELEASE = '4.0.0-alpha.7.2';
  var INPUT_CONTRACT_VERSION = '4.0-aggregate-contract-2';
  var METHODS = Object.freeze({
    CATEGORY_CONTRIBUTION: 'CATEGORY_CONTRIBUTION',
    SUM_CONTRIBUTIONS: 'SUM_CONTRIBUTIONS',
    NORMALIZED_WEIGHTED_AVERAGE: 'NORMALIZED_WEIGHTED_AVERAGE',
    AGGREGATE_MARKUP: 'AGGREGATE_MARKUP'
  });
  var VALUE_STATES = Object.freeze({
    VALID: 'VALID',
    ZERO: 'ZERO',
    MISSING: 'MISSING',
    INVALID: 'INVALID',
    NOT_APPLICABLE: 'NOT_APPLICABLE'
  });
  var ALLOWED_IMPACT_STATUSES = Object.freeze({PLANNED:true, VALIDATED:true});
  var NON_APPLICABLE_IMPACT_STATUSES = Object.freeze({BLOCKED_CONTRACT:true, SKIPPED_NOT_APPLICABLE:true});
  var DEFAULT_COVERAGE_RULE_ID = 'DEFAULT_COMPLETE_ONLY';
  var UNIT_ALIASES = Object.freeze({
    'percentage_point':'percentage_point',
    'percentage_points':'percentage_point',
    'percentage point':'percentage_point',
    'percentage points':'percentage_point',
    'pp':'percentage_point',
    'p.p.':'percentage_point',
    'п.п.':'percentage_point',
    'пп':'percentage_point',
    'percent':'percent',
    'percentage':'percent',
    '%':'percent',
    'rub':'rub',
    'ruble':'rub',
    'rubles':'rub',
    'руб':'rub',
    'руб.':'rub'
  });
  var ROUNDING_DIGITS = 6;
  var COVERAGE_DIGITS = 10;
  var CONTRIBUTION_FIELDS = Object.freeze({
    group: 'contribution_to_group_change_pp',
    basket: 'contribution_to_basket_change_pp',
    total_cpi: 'contribution_to_total_cpi_pp'
  });
  var SORT_FIELDS = Object.freeze([
    'dataset_code','frequency','aggregate_level','aggregate_subject_id','value_type','index_type','period_start','category_id','calculation_method','weight_rule_id','membership_rule_id','aggregate_row_key'
  ]);

  function contract_() {
    if (!AKORT.AggregateContract) {
      throw calculatorError_('AGG_CALC_CONTRACT_UNAVAILABLE', 'Alpha.7.1 aggregate contract is unavailable.');
    }
    return AKORT.AggregateContract;
  }

  function calculatorError_(code, message, details) {
    var error = new Error(message);
    error.name = 'AggregateCalculatorError';
    error.code = code;
    error.details = details || {};
    return error;
  }

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function norm_(value) {
    return text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function upper_(value) {
    return text_(value).toUpperCase();
  }

  function canonicalUnit_(value) {
    var raw = norm_(value).replace(/\s+/g, ' ');
    if (!raw) return '';
    return UNIT_ALIASES[raw] || raw.replace(/\s+/g, '_');
  }

  function unitsCompatible_(actual, expected) {
    var left = canonicalUnit_(actual), right = canonicalUnit_(expected);
    return !!left && !!right && left === right;
  }

  function finiteNumber_(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(parsed) ? parsed : null;
  }

  function requireText_(object, field, code) {
    var value = text_(object && object[field]);
    if (!value) {
      throw calculatorError_(code || 'AGG_CALC_INPUT_MISSING', 'Required calculator field is missing: ' + field + '.', {field:field});
    }
    return value;
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
      if (value instanceof Date) return periodDateKey_(value);
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

  function utf8Bytes_(value) {
    var string = String(value || ''), bytes = [], i, code, next, point;
    for (i = 0; i < string.length; i += 1) {
      code = string.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < string.length) {
        next = string.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          point = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i += 1;
          bytes.push(0xF0 | (point >>> 18));
          bytes.push(0x80 | ((point >>> 12) & 0x3F));
          bytes.push(0x80 | ((point >>> 6) & 0x3F));
          bytes.push(0x80 | (point & 0x3F));
          continue;
        }
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) {
        bytes.push(0xC0 | (code >>> 6));
        bytes.push(0x80 | (code & 0x3F));
      } else {
        bytes.push(0xE0 | (code >>> 12));
        bytes.push(0x80 | ((code >>> 6) & 0x3F));
        bytes.push(0x80 | (code & 0x3F));
      }
    }
    return bytes;
  }

  function rotr_(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256_(value) {
    var constants = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    var hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes = utf8Bytes_(value), bitLength = bytes.length * 8, high = Math.floor(bitLength / 0x100000000), low = bitLength >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
    bytes.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);
    var offset, w, i, s0, s1, a, b, c, d, e, f, g, h, ch, maj, temp1, temp2;
    for (offset = 0; offset < bytes.length; offset += 64) {
      w = new Array(64);
      for (i = 0; i < 16; i += 1) {
        w[i] = ((bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i += 1) {
        s0 = (rotr_(w[i - 15], 7) ^ rotr_(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        s1 = (rotr_(w[i - 2], 17) ^ rotr_(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      a = hash[0]; b = hash[1]; c = hash[2]; d = hash[3]; e = hash[4]; f = hash[5]; g = hash[6]; h = hash[7];
      for (i = 0; i < 64; i += 1) {
        s1 = (rotr_(e, 6) ^ rotr_(e, 11) ^ rotr_(e, 25)) >>> 0;
        ch = ((e & f) ^ ((~e) & g)) >>> 0;
        temp1 = (h + s1 + ch + constants[i] + w[i]) >>> 0;
        s0 = (rotr_(a, 2) ^ rotr_(a, 13) ^ rotr_(a, 22)) >>> 0;
        maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        temp2 = (s0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(function (word) { return ('00000000' + word.toString(16)).slice(-8); }).join('');
  }

  function round_(value, digits) {
    var number = finiteNumber_(value);
    if (number === null) return null;
    var factor = Math.pow(10, Number(digits || 0));
    return Math.round(number * factor) / factor;
  }

  function roundLegacy6_(value) {
    return round_(value, ROUNDING_DIGITS);
  }

  function pad2_(value) {
    return ('0' + Number(value)).slice(-2);
  }

  function dateFrom_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === 'number' && isFinite(value)) {
      var excelDate = new Date(Math.round((value - 25569) * 86400000));
      return isNaN(excelDate.getTime()) ? null : excelDate;
    }
    var raw = text_(value), match;
    if (!raw) return null;
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    match = raw.match(/^(\d{4})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, 1, 12, 0, 0, 0);
    var parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function periodDateKey_(value) {
    var date = dateFrom_(value);
    if (!date) return '';
    return [date.getFullYear(), pad2_(date.getMonth() + 1), pad2_(date.getDate())].join('-');
  }

  function periodMonthKey_(value) {
    var raw = text_(value);
    if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
    var date = dateFrom_(value);
    return date ? [date.getFullYear(), pad2_(date.getMonth() + 1)].join('-') : '';
  }

  function frequency_(value) {
    var frequency = norm_(value);
    if (frequency !== 'weekly' && frequency !== 'monthly') {
      throw calculatorError_('AGG_CALC_FREQUENCY_INVALID', 'Unsupported calculator frequency.', {frequency:value});
    }
    return frequency;
  }

  function periodKey_(frequency, value) {
    var normalizedFrequency = frequency_(frequency);
    var key = normalizedFrequency === 'weekly' ? periodDateKey_(value) : periodMonthKey_(value);
    if (!key) throw calculatorError_('AGG_CALC_PERIOD_INVALID', 'Calculator period is missing or invalid.', {frequency:normalizedFrequency, period:value});
    return key;
  }

  function addDays_(value, days) {
    var date = dateFrom_(value);
    if (!date) throw calculatorError_('AGG_CALC_PERIOD_INVALID', 'Cannot shift invalid weekly period.', {period:value});
    date.setDate(date.getDate() + Number(days || 0));
    return periodDateKey_(date);
  }

  function addMonths_(value, months) {
    var key = periodMonthKey_(value);
    if (!key) throw calculatorError_('AGG_CALC_PERIOD_INVALID', 'Cannot shift invalid monthly period.', {period:value});
    var parts = key.split('-'), date = new Date(Number(parts[0]), Number(parts[1]) - 1 + Number(months || 0), 1, 12, 0, 0, 0);
    return periodMonthKey_(date);
  }

  function basePeriodFor_(frequency, indexType, targetPeriod) {
    var f = frequency_(frequency), index = norm_(indexType), period = periodKey_(f, targetPeriod);
    if (index === 'wow') return addDays_(period, -7);
    if (index === 'mom') return addMonths_(period, -1);
    if (index === 'yoy') return f === 'weekly' ? addDays_(period, -364) : addMonths_(period, -12);
    if (index === 'december') return String(Number(period.slice(0, 4)) - 1) + '-12' + (f === 'weekly' ? '-31' : '');
    throw calculatorError_('AGG_CALC_INDEX_TYPE_INVALID', 'Unsupported index type for base-period resolution.', {frequency:f, indexType:indexType});
  }

  function stateValue_(value, explicitState, options) {
    var opts = options || {}, state = upper_(explicitState), parsed;
    if (!state) {
      if (opts.notApplicable === true) state = VALUE_STATES.NOT_APPLICABLE;
      else if (value === null || value === undefined || value === '') state = VALUE_STATES.MISSING;
      else {
        parsed = finiteNumber_(value);
        if (parsed === null) state = VALUE_STATES.INVALID;
        else if (opts.nonNegative === true && parsed < 0) state = VALUE_STATES.INVALID;
        else state = parsed === 0 ? VALUE_STATES.ZERO : VALUE_STATES.VALID;
      }
    }
    if (!VALUE_STATES[state]) return {state:VALUE_STATES.INVALID,value:null,provided_state:state};
    if (state === VALUE_STATES.MISSING || state === VALUE_STATES.INVALID || state === VALUE_STATES.NOT_APPLICABLE) {
      return {state:state,value:null};
    }
    parsed = finiteNumber_(value);
    if (parsed === null) return {state:VALUE_STATES.INVALID,value:null};
    if (opts.nonNegative === true && parsed < 0) return {state:VALUE_STATES.INVALID,value:parsed};
    if (state === VALUE_STATES.ZERO && parsed !== 0) return {state:VALUE_STATES.INVALID,value:parsed};
    if (state === VALUE_STATES.VALID && parsed === 0) return {state:VALUE_STATES.ZERO,value:0};
    return {state:parsed === 0 ? VALUE_STATES.ZERO : VALUE_STATES.VALID,value:parsed};
  }

  function calculatePercentChange(currentValue, baseValue) {
    var current = stateValue_(currentValue && typeof currentValue === 'object' ? currentValue.value : currentValue, currentValue && typeof currentValue === 'object' ? currentValue.state : '', {});
    var base = stateValue_(baseValue && typeof baseValue === 'object' ? baseValue.value : baseValue, baseValue && typeof baseValue === 'object' ? baseValue.state : '', {});
    if (current.state !== VALUE_STATES.VALID && current.state !== VALUE_STATES.ZERO) return {status:'INVALID_CURRENT',value:null,current_state:current.state,base_state:base.state};
    if (base.state === VALUE_STATES.ZERO) return {status:'INVALID_BASE_ZERO',value:null,current_state:current.state,base_state:base.state};
    if (base.state !== VALUE_STATES.VALID) return {status:'INVALID_BASE',value:null,current_state:current.state,base_state:base.state};
    return {status:'READY',value:roundLegacy6_((current.value / base.value - 1) * 100),current_state:current.state,base_state:base.state};
  }

  function ruleDateKey_(value, endOfPeriod) {
    var raw = text_(value);
    if (!raw) return endOfPeriod ? '9999-12-31' : '1900-01-01';
    if (/^\d{4}-\d{2}$/.test(raw)) {
      if (!endOfPeriod) return raw + '-01';
      var parts = raw.split('-'), last = new Date(Number(parts[0]), Number(parts[1]), 0, 12, 0, 0, 0);
      return periodDateKey_(last);
    }
    var key = periodDateKey_(value);
    if (!key) throw calculatorError_('AGG_CALC_RULE_DATE_INVALID', 'Rule effective date is invalid.', {value:value});
    return key;
  }

  function activeAt_(row, period) {
    var point = ruleDateKey_(period, false), from = ruleDateKey_(row.effective_from, false), to = ruleDateKey_(row.effective_to, true);
    var status = norm_(row.status || 'active');
    var enabled = !status || ['active','accepted','current'].indexOf(status) >= 0;
    return enabled && point >= from && point <= to && Number(row.include_flag === undefined ? 1 : row.include_flag) !== 0;
  }

  function normalizeDefinition_(definition) {
    var source = definition || {}, C = contract_(), level = norm_(requireText_(source, 'aggregate_level', 'AGG_CALC_DEFINITION_MISSING'));
    var subject = text_(source.aggregate_subject_id || source.aggregate_id || source.group_id || source.category_id);
    if (!subject) throw calculatorError_('AGG_CALC_DEFINITION_MISSING', 'Aggregate definition has no aggregate_subject_id.', {definition:source});
    var frequency = frequency_(source.frequency);
    var indexType = C.canonicalIndexTypes(frequency, requireText_(source, 'index_type', 'AGG_CALC_DEFINITION_MISSING'), 'official_index')[0];
    var method = upper_(requireText_(source, 'calculation_method', 'AGG_CALC_DEFINITION_MISSING'));
    if (!METHODS[method]) throw calculatorError_('AGG_CALC_UNSUPPORTED_METHOD', 'Unsupported aggregate calculation method.', {method:method});
    var normalized = {
      definition_id:text_(source.definition_id),
      dataset_code:requireText_(source, 'dataset_code', 'AGG_CALC_DEFINITION_MISSING'),
      frequency:frequency,
      aggregate_level:level,
      aggregate_subject_id:subject,
      aggregate_name:text_(source.aggregate_name || subject),
      category_id:level === 'category' ? text_(source.category_id || subject) : '',
      value_type:requireText_(source, 'value_type', 'AGG_CALC_DEFINITION_MISSING'),
      index_type:indexType,
      calculation_method:method,
      weight_rule_id:requireText_(source, 'weight_rule_id', 'AGG_CALC_DEFINITION_MISSING'),
      membership_rule_id:level === 'category' ? text_(source.membership_rule_id) : requireText_(source, 'membership_rule_id', 'AGG_CALC_DEFINITION_MISSING'),
      coverage_rule_id:text_(source.coverage_rule_id || DEFAULT_COVERAGE_RULE_ID),
      output_unit:canonicalUnit_(source.output_unit || 'percentage_point'),
      weight_scope:text_(source.weight_scope || subject),
      purchase_value_type:text_(source.purchase_value_type || 'purchase_price'),
      retail_value_type:text_(source.retail_value_type || 'retail_price'),
      contribution_scope:norm_(source.contribution_scope || '')
    };
    normalized.series_key = C.aggregateSeriesKey(contractDefinition_(normalized));
    return normalized;
  }

  function contractDefinition_(definition, overrides) {
    var source = clone_(definition || {}), extra = overrides || {};
    Object.keys(extra).forEach(function (key) { source[key] = extra[key]; });
    if (source.aggregate_level === 'group') source.group_id = source.aggregate_subject_id;
    if (source.aggregate_level === 'category') source.category_id = source.category_id || source.aggregate_subject_id;
    return source;
  }

  function normalizeCoverageRule_(rule) {
    var source = rule || {};
    return {
      coverage_rule_id:requireText_(source, 'coverage_rule_id', 'AGG_CALC_INPUT_MISSING'),
      allow_partial:source.allow_partial === true,
      description:text_(source.description)
    };
  }

  function normalizeSnapshot_(snapshot, kind) {
    var source = snapshot || {}, idField = kind + '_snapshot_id';
    var snapshotId = text_(source.snapshot_id || source[idField]);
    if (!snapshotId) throw calculatorError_('AGG_CALC_INPUT_MISSING', kind + ' snapshot_id is missing.');
    var snapshotHash = text_(source.hash);
    if (!snapshotHash) throw calculatorError_('AGG_CALC_INPUT_MISSING', kind + ' snapshot hash is missing.');
    if (!Array.isArray(source.rule_rows)) throw calculatorError_('AGG_CALC_INPUT_MISSING', kind + ' rule_rows must be an array.');
    return {snapshot_id:snapshotId,hash:snapshotHash,rule_rows:clone_(source.rule_rows)};
  }

  function normalizePrice_(price) {
    var source = price || {}, C = contract_(), frequency = frequency_(source.frequency);
    var normalized = {
      dataset_code:requireText_(source, 'dataset_code', 'AGG_CALC_INPUT_MISSING'),
      frequency:frequency,
      series_id:requireText_(source, 'series_id', 'AGG_CALC_INPUT_MISSING'),
      category_id:requireText_(source, 'category_id', 'AGG_CALC_INPUT_MISSING'),
      value_type:requireText_(source, 'value_type', 'AGG_CALC_INPUT_MISSING'),
      index_type:C.canonicalIndexTypes(frequency, requireText_(source, 'index_type', 'AGG_CALC_INPUT_MISSING'), 'official_index')[0],
      period_start:periodKey_(frequency, source.period_start),
      current_value:source.current_value,
      base_value:source.base_value,
      change_pp:source.change_pp,
      unit:canonicalUnit_(source.unit),
      source_unit:text_(source.unit),
      value_state:upper_(source.value_state),
      current_state:upper_(source.current_state || source.value_state),
      base_state:upper_(source.base_state),
      change_state:upper_(source.change_state),
      category_name:text_(source.category_name || source.product_name || source.category_id)
    };
    normalized.price_key = priceKey_(normalized.dataset_code, normalized.frequency, normalized.category_id, normalized.value_type, normalized.index_type, normalized.period_start);
    return normalized;
  }

  function normalizeBaseInput_(baseInput) {
    var source = baseInput || {};
    return {
      aggregate_series_key:requireText_(source, 'aggregate_series_key', 'AGG_CALC_INPUT_MISSING'),
      base_period:text_(source.base_period),
      base_value:source.base_value,
      value_state:upper_(source.value_state)
    };
  }

  function priceKey_(dataset, frequency, category, valueType, indexType, period) {
    return [text_(dataset),frequency_(frequency),text_(category),text_(valueType),norm_(indexType),periodKey_(frequency, period)].join('|');
  }

  function definitionIndexKey_(dataset, frequency, valueType, indexType) {
    return [text_(dataset),frequency_(frequency),text_(valueType),norm_(indexType)].join('|');
  }

  function baseIndexKey_(seriesKey, basePeriod) {
    return text_(seriesKey) + '|' + text_(basePeriod);
  }

  function appendIndex_(index, key, value) {
    index[key] = index[key] || [];
    index[key].push(value);
  }

  function definitionSemanticSignature_(definition) {
    var fields = [
      'dataset_code','frequency','aggregate_level','aggregate_subject_id','aggregate_name','category_id',
      'value_type','index_type','calculation_method','weight_rule_id','membership_rule_id','coverage_rule_id',
      'output_unit','weight_scope','purchase_value_type','retail_value_type','contribution_scope'
    ];
    var out = {};
    fields.forEach(function (field) { out[field] = definition[field]; });
    return stableStringify_(out);
  }

  function buildIndexes_(request) {
    var source = request || {}, metrics = {
      price_index_builds:1,definition_index_builds:1,membership_index_builds:1,membership_category_index_builds:1,weight_index_builds:1,base_index_builds:1,
      price_inputs_inspected:0,definition_rows_inspected:0,definition_duplicates_deduped:0,membership_rows_inspected:0,membership_candidates_inspected:0,membership_duplicate_checks:0,weight_rows_inspected:0,base_inputs_inspected:0,
      price_lookups:0,definition_candidates_inspected:0,member_contexts_built:0,lineage_pairs_collected:0,lineage_row_attachments:0
    };
    var priceIndex = {}, definitionIndex = {}, membershipIndex = {}, weightIndex = {}, baseIndex = {}, baseBySeries = {}, coverageIndex = {};
    (source.price_inputs || []).forEach(function (row) {
      metrics.price_inputs_inspected += 1;
      var normalized = normalizePrice_(row);
      if (priceIndex[normalized.price_key]) throw calculatorError_('AGG_CALC_PRICE_DUPLICATE', 'Duplicate normalized price input.', {priceKey:normalized.price_key});
      priceIndex[normalized.price_key] = normalized;
    });

    var normalizedDefinitions = (source.aggregate_definitions || []).map(function (row) {
      metrics.definition_rows_inspected += 1;
      return normalizeDefinition_(row);
    });
    normalizedDefinitions.sort(function (a, b) {
      var left = a.series_key + '|' + definitionSemanticSignature_(a) + '|' + text_(a.definition_id);
      var right = b.series_key + '|' + definitionSemanticSignature_(b) + '|' + text_(b.definition_id);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    var definitions = [], definitionBySeries = {};
    normalizedDefinitions.forEach(function (normalized) {
      var signature = definitionSemanticSignature_(normalized), existing = definitionBySeries[normalized.series_key];
      if (existing) {
        if (existing.signature !== signature) {
          throw calculatorError_('AGG_CALC_DEFINITION_CONFLICT', 'More than one semantically different aggregate definition resolves to the same aggregate_series_key.', {
            seriesKey:normalized.series_key,
            first:clone_(existing.definition),
            second:clone_(normalized),
            signatures:[existing.signature,signature].sort()
          });
        }
        metrics.definition_duplicates_deduped += 1;
        return;
      }
      definitionBySeries[normalized.series_key] = {signature:signature,definition:normalized};
      appendIndex_(definitionIndex, definitionIndexKey_(normalized.dataset_code, normalized.frequency, normalized.value_type, normalized.index_type), normalized);
      definitions.push(normalized);
    });
    Object.keys(definitionIndex).forEach(function (key) {
      definitionIndex[key].sort(function (a, b) { return a.series_key < b.series_key ? -1 : a.series_key > b.series_key ? 1 : 0; });
    });

    (source.membership_snapshot.rule_rows || []).forEach(function (row) {
      metrics.membership_rows_inspected += 1;
      var ruleId = text_(row.membership_rule_id || row.rule_id), subject = text_(row.aggregate_subject_id || row.scope), category = text_(row.category_id);
      if (!ruleId || !subject || !category) throw calculatorError_('AGG_CALC_MEMBERSHIP_MISSING', 'Membership row is missing rule, subject or category identity.', {row:row});
      var key = ruleId + '|' + subject;
      membershipIndex[key] = membershipIndex[key] || {by_category:{},category_ids:[],rows_count:0};
      if (!membershipIndex[key].by_category[category]) {
        membershipIndex[key].by_category[category] = [];
        membershipIndex[key].category_ids.push(category);
      }
      membershipIndex[key].by_category[category].push(clone_(row));
      membershipIndex[key].rows_count += 1;
    });
    Object.keys(membershipIndex).forEach(function (key) {
      var group = membershipIndex[key];
      group.category_ids.sort();
      group.category_ids.forEach(function (category) {
        var seen = {};
        group.by_category[category].sort(function (a, b) {
          var left = [text_(a.membership_version || a.version),text_(a.effective_from),text_(a.effective_to),text_(a.allocation_factor),text_(a.include_flag),text_(a.reason)].join('|');
          var right = [text_(b.membership_version || b.version),text_(b.effective_from),text_(b.effective_to),text_(b.allocation_factor),text_(b.include_flag),text_(b.reason)].join('|');
          return left < right ? -1 : left > right ? 1 : 0;
        });
        group.by_category[category].forEach(function (row) {
          metrics.membership_duplicate_checks += 1;
          var duplicateKey = [text_(row.membership_version || row.version),category].join('|');
          if (seen[duplicateKey]) throw calculatorError_('AGG_MEMBERSHIP_DUPLICATE', 'Duplicate category within one membership rule version is forbidden, including overlapping or non-overlapping effective ranges.', {duplicateKey:duplicateKey,first:clone_(seen[duplicateKey]),second:clone_(row)});
          seen[duplicateKey] = row;
        });
      });
    });

    (source.weight_snapshot.rule_rows || []).forEach(function (row) {
      metrics.weight_rows_inspected += 1;
      var ruleId = text_(row.weight_rule_id || row.rule_id), scope = text_(row.weight_scope || row.scope || row.aggregate_subject_id), category = text_(row.category_id);
      if (!ruleId || !scope || !category) throw calculatorError_('AGG_CALC_WEIGHT_MISSING', 'Weight row is missing rule, scope or category identity.', {row:row});
      appendIndex_(weightIndex, ruleId + '|' + scope + '|' + category, clone_(row));
    });
    (source.base_inputs || []).forEach(function (row) {
      metrics.base_inputs_inspected += 1;
      var normalized = normalizeBaseInput_(row), key = baseIndexKey_(normalized.aggregate_series_key, normalized.base_period);
      if (baseIndex[key]) throw calculatorError_('AGG_CALC_BASE_DUPLICATE', 'Duplicate aggregate base input.', {baseKey:key});
      baseIndex[key] = normalized;
      appendIndex_(baseBySeries, normalized.aggregate_series_key, normalized);
    });
    (source.coverage_rules || []).map(normalizeCoverageRule_).forEach(function (rule) {
      if (coverageIndex[rule.coverage_rule_id]) throw calculatorError_('AGG_CALC_COVERAGE_RULE_DUPLICATE', 'Duplicate coverage rule.', {coverageRuleId:rule.coverage_rule_id});
      coverageIndex[rule.coverage_rule_id] = rule;
    });
    Object.keys(baseBySeries).forEach(function (key) { baseBySeries[key].sort(function (a,b) { return text_(a.base_period) < text_(b.base_period) ? -1 : text_(a.base_period) > text_(b.base_period) ? 1 : 0; }); });
    if (!coverageIndex[DEFAULT_COVERAGE_RULE_ID]) coverageIndex[DEFAULT_COVERAGE_RULE_ID] = {coverage_rule_id:DEFAULT_COVERAGE_RULE_ID,allow_partial:false,description:'Complete coverage required.'};
    return {price:priceIndex,definitions:definitionIndex,definition_rows:definitions,membership:membershipIndex,weight:weightIndex,base:baseIndex,base_by_series:baseBySeries,coverage:coverageIndex,metrics:metrics};
  }

  function scopeMatches_(scope, definition) {
    var raw = text_(scope || 'ALL_APPLICABLE'), normalized = norm_(raw);
    if (!normalized || ['all','all_applicable','*'].indexOf(normalized) >= 0) return true;
    var tokens = raw.split(',').map(function (token) { return norm_(token); });
    var level = norm_(definition.aggregate_level), subject = norm_(definition.aggregate_subject_id), pair = level + ':' + subject;
    return tokens.indexOf(level) >= 0 || tokens.indexOf(subject) >= 0 || tokens.indexOf(pair) >= 0;
  }

  function memberCandidates_(definition, period, indexes) {
    var C = contract_(), level = definition.aggregate_level;
    if (level === 'category') {
      return [{category_id:definition.category_id || definition.aggregate_subject_id,allocation_factor:1,membership_version:'NONE',membership_rule_id:'NONE'}];
    }
    var group = indexes.membership[definition.membership_rule_id + '|' + definition.aggregate_subject_id];
    if (!group || !group.category_ids.length) throw calculatorError_('AGG_CALC_MEMBERSHIP_MISSING', 'No membership rows exist for aggregate definition.', {membershipRuleId:definition.membership_rule_id,aggregateSubjectId:definition.aggregate_subject_id});
    var out = [];
    group.category_ids.forEach(function (category) {
      var applicable = group.by_category[category] || [];
      indexes.metrics.membership_candidates_inspected += applicable.length;
      var resolved = C.resolveVersionedRule(applicable, {category_id:category,scope:definition.aggregate_subject_id,period:period});
      if (resolved.status !== 'RESOLVED' || !resolved.rule) return;
      var allocation = finiteNumber_(resolved.rule.allocation_factor === undefined || resolved.rule.allocation_factor === '' ? 1 : resolved.rule.allocation_factor);
      if (allocation === null || allocation <= 0) throw calculatorError_('AGG_CALC_INVALID_MEMBER', 'Membership allocation_factor must be positive.', {categoryId:category,allocationFactor:resolved.rule.allocation_factor});
      out.push({
        category_id:category,
        allocation_factor:allocation,
        membership_version:text_(resolved.rule.membership_version || resolved.rule.version),
        membership_rule_id:text_(resolved.rule.membership_rule_id || resolved.rule.rule_id || definition.membership_rule_id),
        reason:text_(resolved.rule.reason)
      });
    });
    if (!out.length) throw calculatorError_('AGG_CALC_MEMBERSHIP_MISSING', 'No active membership rows were resolved for target period.', {aggregateSubjectId:definition.aggregate_subject_id,period:period});
    return out;
  }

  function resolveWeight_(definition, categoryId, period, indexes) {
    var C = contract_(), key = definition.weight_rule_id + '|' + definition.weight_scope + '|' + categoryId, rows = indexes.weight[key] || [];
    if (!rows.length) return {state:VALUE_STATES.MISSING,value:null,version:'',code:'AGG_CALC_WEIGHT_MISSING'};
    var resolved = C.resolveVersionedRule(rows, {category_id:categoryId,scope:definition.weight_scope,period:period});
    if (resolved.status !== 'RESOLVED' || !resolved.rule) return {state:VALUE_STATES.MISSING,value:null,version:'',code:'AGG_CALC_WEIGHT_MISSING'};
    var classified = stateValue_(resolved.rule.weight_value, '', {nonNegative:true});
    if ((classified.state !== VALUE_STATES.VALID && classified.state !== VALUE_STATES.ZERO) || classified.value <= 0) {
      return {state:VALUE_STATES.INVALID,value:classified.value,version:text_(resolved.rule.weight_version || resolved.rule.version),code:'AGG_CALC_INVALID_MEMBER'};
    }
    return {state:VALUE_STATES.VALID,value:classified.value,version:text_(resolved.rule.weight_version || resolved.rule.version),code:''};
  }

  function lookupPrice_(indexes, dataset, frequency, category, valueType, indexType, period) {
    indexes.metrics.price_lookups += 1;
    return indexes.price[priceKey_(dataset, frequency, category, valueType, indexType, period)] || null;
  }

  function categoryChangeFromPrice_(price) {
    if (!price) return {state:VALUE_STATES.MISSING,value:null,category_value:null,code:'AGG_CALC_PRICE_MISSING'};
    var current = stateValue_(price.current_value, price.current_state || price.value_state, {});
    if (current.state === VALUE_STATES.NOT_APPLICABLE) return {state:VALUE_STATES.NOT_APPLICABLE,value:null,category_value:null,code:''};
    if (current.state === VALUE_STATES.INVALID) return {state:VALUE_STATES.INVALID,value:null,category_value:null,code:'AGG_CALC_INVALID_MEMBER'};
    var explicitChange = stateValue_(price.change_pp, price.change_state, {});
    if (explicitChange.state === VALUE_STATES.VALID || explicitChange.state === VALUE_STATES.ZERO) {
      return {state:explicitChange.state,value:roundLegacy6_(explicitChange.value),category_value:current.value,code:''};
    }
    if (price.change_pp !== null && price.change_pp !== undefined && price.change_pp !== '') {
      return {state:VALUE_STATES.INVALID,value:null,category_value:current.value,code:'AGG_CALC_INVALID_MEMBER'};
    }
    var percent = calculatePercentChange({value:price.current_value,state:price.current_state || price.value_state},{value:price.base_value,state:price.base_state});
    if (percent.status === 'READY') return {state:percent.value === 0 ? VALUE_STATES.ZERO : VALUE_STATES.VALID,value:percent.value,category_value:current.value,code:''};
    if (percent.status === 'INVALID_CURRENT') {
      return percent.current_state === VALUE_STATES.MISSING
        ? {state:VALUE_STATES.MISSING,value:null,category_value:null,code:'AGG_CALC_PRICE_MISSING'}
        : {state:VALUE_STATES.INVALID,value:null,category_value:null,code:'AGG_CALC_INVALID_MEMBER'};
    }
    if (percent.status === 'INVALID_BASE') {
      return percent.base_state === VALUE_STATES.MISSING
        ? {state:VALUE_STATES.MISSING,value:null,category_value:current.value,code:'AGG_CALC_BASE_MISSING'}
        : {state:VALUE_STATES.INVALID,value:null,category_value:current.value,code:'AGG_CALC_INVALID_MEMBER'};
    }
    return {state:VALUE_STATES.INVALID,value:null,category_value:current.value,code:'AGG_CALC_INVALID_BASE_ZERO'};
  }

  function coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, allowPartial) {
    var ratio = expectedWeight > 0 ? appliedWeight / expectedWeight : null;
    var status = expectedMembers === 0 && notApplicableMembers > 0 ? 'NOT_APPLICABLE' : (invalidMembers > 0 ? 'INVALID' : (appliedMembers === expectedMembers ? 'COMPLETE' : 'PARTIAL'));
    return {
      expected_members_count:Number(expectedMembers || 0),
      applied_members_count:Number(appliedMembers || 0),
      not_applicable_members_count:Number(notApplicableMembers || 0),
      invalid_members_count:Number(invalidMembers || 0),
      expected_weight_sum:round_(expectedWeight, COVERAGE_DIGITS),
      applied_weight_sum:round_(appliedWeight, COVERAGE_DIGITS),
      coverage_ratio:ratio === null ? null : round_(ratio, COVERAGE_DIGITS),
      coverage_status:status,
      publication_allowed:status === 'COMPLETE' || (status === 'PARTIAL' && allowPartial === true)
    };
  }

  function contributionField_(definition) {
    return CONTRIBUTION_FIELDS[definition.aggregate_level] || CONTRIBUTION_FIELDS[norm_(definition.contribution_scope)] || '';
  }

  function baseRow_(context, rowType, categoryId) {
    var definition = context.definition, period = periodKey_(definition.frequency, context.period_start), C = contract_();
    var identityDefinition;
    if (rowType === 'CATEGORY_CONTRIBUTION') {
      identityDefinition = contractDefinition_({
        dataset_code:definition.dataset_code,frequency:definition.frequency,aggregate_level:'category',aggregate_subject_id:categoryId,category_id:categoryId,
        value_type:definition.value_type,index_type:definition.index_type,calculation_method:METHODS.CATEGORY_CONTRIBUTION,
        weight_rule_id:definition.weight_rule_id,membership_rule_id:''
      }, {period_start:period});
    } else {
      identityDefinition = contractDefinition_(definition, {period_start:period});
    }
    return {
      row_type:rowType,
      calculation_id:text_(context.calculation_id),
      impact_id:text_(context.impact_id),
      combo_key:text_(context.combo_key),
      aggregate_series_key:C.aggregateSeriesKey(identityDefinition),
      aggregate_row_key:C.aggregateRowKey(identityDefinition),
      dataset_code:definition.dataset_code,
      frequency:definition.frequency,
      aggregate_level:rowType === 'CATEGORY_CONTRIBUTION' ? 'category' : definition.aggregate_level,
      aggregate_subject_id:rowType === 'CATEGORY_CONTRIBUTION' ? categoryId : definition.aggregate_subject_id,
      aggregate_name:rowType === 'CATEGORY_CONTRIBUTION' ? categoryId : definition.aggregate_name,
      category_id:rowType === 'CATEGORY_CONTRIBUTION' ? categoryId : null,
      value_type:definition.value_type,
      index_type:definition.index_type,
      period_start:period,
      calculation_method:rowType === 'CATEGORY_CONTRIBUTION' ? METHODS.CATEGORY_CONTRIBUTION : definition.calculation_method,
      weight_rule_id:definition.weight_rule_id,
      membership_rule_id:rowType === 'CATEGORY_CONTRIBUTION' ? 'NONE' : (definition.membership_rule_id || 'NONE'),
      coverage_rule_id:definition.coverage_rule_id,
      calculation_status:'',
      contract_code:'',
      category_value:null,
      category_change_pp:null,
      category_weight:null,
      contribution_to_group_change_pp:null,
      contribution_to_basket_change_pp:null,
      contribution_to_total_cpi_pp:null,
      aggregate_change_pp:null,
      aggregate_value:null,
      aggregate_base_value:null,
      expected_members_count:null,
      applied_members_count:null,
      not_applicable_members_count:null,
      invalid_members_count:null,
      expected_weight_sum:null,
      applied_weight_sum:null,
      coverage_ratio:null,
      coverage_status:null,
      publication_allowed:false,
      parent_aggregate_series_key:rowType === 'CATEGORY_CONTRIBUTION' ? definition.series_key : null,
      source_impacts:text_(context.impact_id) && text_(context.combo_key) ? [{impact_id:text_(context.impact_id),combo_key:text_(context.combo_key)}] : [],
      source_impact_ids:text_(context.impact_id) ? [text_(context.impact_id)] : [],
      source_combo_keys:text_(context.combo_key) ? [text_(context.combo_key)] : []
    };
  }

  function diagnostic_(context, severity, code, message, details) {
    return {
      calculation_id:text_(context && context.calculation_id),
      impact_id:text_(context && context.impact_id),
      combo_key:text_(context && context.combo_key),
      aggregate_subject_id:text_(context && context.definition && context.definition.aggregate_subject_id),
      category_id:text_(context && context.category_id),
      period_start:text_(context && context.period_start),
      severity:upper_(severity || 'ERROR'),
      code:text_(code),
      message:text_(message),
      details:clone_(details || {})
    };
  }

  function calculateStandardAggregate(context) {
    var source = context || {}, definition = source.definition || {}, coverageRule = source.coverage_rule || {allow_partial:false};
    var members = source.members || [], contributionField = contributionField_(definition), rows = [], diagnostics = [];
    var expectedMembers = 0, appliedMembers = 0, notApplicableMembers = 0, invalidMembers = 0, expectedWeight = 0, appliedWeight = 0, sum = 0;
    members.forEach(function (member) {
      var weight = stateValue_(member.weight, member.weight_state, {nonNegative:true});
      var change = stateValue_(member.change_pp, member.change_state, {});
      var allocation = finiteNumber_(member.allocation_factor === undefined ? 1 : member.allocation_factor);
      var row = baseRow_(source, 'CATEGORY_CONTRIBUTION', text_(member.category_id));
      row.category_value = finiteNumber_(member.category_value);
      row.category_change_pp = change.state === VALUE_STATES.VALID || change.state === VALUE_STATES.ZERO ? roundLegacy6_(change.value) : null;
      if (change.state === VALUE_STATES.NOT_APPLICABLE || member.not_applicable === true) {
        notApplicableMembers += 1;
        row.calculation_status = 'NOT_APPLICABLE';
        rows.push(row);
        return;
      }
      expectedMembers += 1;
      if (allocation === null || allocation <= 0 || (weight.state !== VALUE_STATES.VALID && weight.state !== VALUE_STATES.ZERO) || weight.value <= 0) {
        invalidMembers += 1;
        row.calculation_status = 'BLOCKED_INVALID_MEMBER';
        row.contract_code = member.weight_code || 'AGG_CALC_INVALID_MEMBER';
        diagnostics.push(diagnostic_({calculation_id:source.calculation_id,impact_id:source.impact_id,combo_key:source.combo_key,definition:definition,category_id:member.category_id,period_start:source.period_start},'ERROR',row.contract_code,'Category weight is missing or invalid.',{weight:member.weight,allocationFactor:member.allocation_factor}));
        rows.push(row);
        return;
      }
      var effectiveWeight = weight.value * allocation;
      expectedWeight += effectiveWeight;
      row.category_weight = round_(effectiveWeight, COVERAGE_DIGITS);
      if (change.state === VALUE_STATES.INVALID) {
        invalidMembers += 1;
        row.calculation_status = 'BLOCKED_INVALID_MEMBER';
        row.contract_code = member.change_code || 'AGG_CALC_INVALID_MEMBER';
        diagnostics.push(diagnostic_({calculation_id:source.calculation_id,impact_id:source.impact_id,combo_key:source.combo_key,definition:definition,category_id:member.category_id,period_start:source.period_start},'ERROR',row.contract_code,
          row.contract_code === 'AGG_CALC_UNIT_MISMATCH' ? 'Price-input unit is incompatible with aggregate output unit.' : 'Category change is invalid.',
          row.contract_code === 'AGG_CALC_UNIT_MISMATCH' ? {inputUnit:member.input_unit,outputUnit:member.output_unit} : {}));
        rows.push(row);
        return;
      }
      if (change.state === VALUE_STATES.MISSING) {
        row.calculation_status = 'MISSING';
        row.contract_code = member.change_code || 'AGG_CALC_BASE_MISSING';
        rows.push(row);
        return;
      }
      var contribution = roundLegacy6_(effectiveWeight * change.value);
      row.calculation_status = 'READY';
      row.publication_allowed = true;
      if (contributionField) row[contributionField] = contribution;
      row.aggregate_change_pp = definition.aggregate_level === 'category' ? contribution : null;
      sum += contribution;
      appliedWeight += effectiveWeight;
      appliedMembers += 1;
      rows.push(row);
    });
    var coverage = coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, coverageRule.allow_partial === true);
    var status, value;
    if (coverage.coverage_status === 'NOT_APPLICABLE') { status = 'NOT_APPLICABLE'; value = null; }
    else if (coverage.coverage_status === 'INVALID') { status = 'BLOCKED_INVALID_MEMBER'; value = null; }
    else { value = roundLegacy6_(sum); status = coverage.publication_allowed ? 'READY' : 'PARTIAL_NOT_PUBLISHABLE'; }
    if (definition.aggregate_level !== 'category') {
      var aggregateRow = baseRow_(source, 'AGGREGATE_RESULT', null);
      aggregateRow.calculation_status = status;
      aggregateRow.contract_code = status === 'PARTIAL_NOT_PUBLISHABLE' ? 'AGG_CALC_PARTIAL_NOT_PUBLISHABLE' : (status === 'BLOCKED_INVALID_MEMBER' ? 'AGG_CALC_INVALID_MEMBER' : '');
      aggregateRow.aggregate_change_pp = value;
      aggregateRow.expected_members_count = coverage.expected_members_count;
      aggregateRow.applied_members_count = coverage.applied_members_count;
      aggregateRow.not_applicable_members_count = coverage.not_applicable_members_count;
      aggregateRow.invalid_members_count = coverage.invalid_members_count;
      aggregateRow.expected_weight_sum = coverage.expected_weight_sum;
      aggregateRow.applied_weight_sum = coverage.applied_weight_sum;
      aggregateRow.coverage_ratio = coverage.coverage_ratio;
      aggregateRow.coverage_status = coverage.coverage_status;
      aggregateRow.publication_allowed = coverage.publication_allowed;
      rows.push(aggregateRow);
    }
    return {status:status,value:value,rows:rows,diagnostics:diagnostics,coverage:coverage};
  }

  function calculateNormalizedWeightedAverage(context) {
    var source = context || {}, members = source.members || [], coverageRule = source.coverage_rule || {allow_partial:false};
    var expectedMembers = 0, appliedMembers = 0, notApplicableMembers = 0, invalidMembers = 0, expectedWeight = 0, appliedWeight = 0, weighted = 0;
    var memberResults = [];
    members.forEach(function (member) {
      var value = stateValue_(member.value, member.value_state, {}), weight = stateValue_(member.weight, member.weight_state, {nonNegative:true});
      var allocation = finiteNumber_(member.allocation_factor === undefined ? 1 : member.allocation_factor);
      var result = {category_id:text_(member.category_id),value_state:value.state,weight_state:weight.state,applied:false,effective_weight:null};
      if (value.state === VALUE_STATES.NOT_APPLICABLE || member.not_applicable === true) {
        notApplicableMembers += 1; result.status = 'NOT_APPLICABLE'; memberResults.push(result); return;
      }
      expectedMembers += 1;
      if (allocation === null || allocation <= 0 || (weight.state !== VALUE_STATES.VALID && weight.state !== VALUE_STATES.ZERO) || weight.value <= 0) {
        invalidMembers += 1; result.status = 'INVALID_WEIGHT'; memberResults.push(result); return;
      }
      var effectiveWeight = weight.value * allocation;
      result.effective_weight = round_(effectiveWeight, COVERAGE_DIGITS);
      expectedWeight += effectiveWeight;
      if (value.state === VALUE_STATES.INVALID) { invalidMembers += 1; result.status = 'INVALID_VALUE'; memberResults.push(result); return; }
      if (value.state === VALUE_STATES.MISSING) { result.status = 'MISSING'; memberResults.push(result); return; }
      appliedMembers += 1; appliedWeight += effectiveWeight; weighted += effectiveWeight * value.value; result.status = 'READY'; result.applied = true; memberResults.push(result);
    });
    var coverage = coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, coverageRule.allow_partial === true);
    if (coverage.coverage_status === 'NOT_APPLICABLE') return {status:'NOT_APPLICABLE',value:null,coverage:coverage,members:memberResults};
    if (invalidMembers > 0) return {status:'BLOCKED_INVALID_MEMBER',value:null,coverage:coverage,members:memberResults};
    if (appliedWeight <= 0) return {status:'BLOCKED_ZERO_APPLIED_WEIGHT',value:null,coverage:coverage,members:memberResults};
    return {status:coverage.publication_allowed ? 'READY' : 'PARTIAL_NOT_PUBLISHABLE',value:roundLegacy6_(weighted / appliedWeight),coverage:coverage,members:memberResults};
  }

  function calculateAggregateMarkup(context) {
    var source = context || {}, members = source.members || [], coverageRule = source.coverage_rule || {allow_partial:false};
    var expectedMembers = 0, appliedMembers = 0, notApplicableMembers = 0, invalidMembers = 0, expectedWeight = 0, appliedWeight = 0;
    var weightedPurchase = 0, weightedRetail = 0, purchaseZero = false, memberResults = [];
    members.forEach(function (member) {
      var purchase = stateValue_(member.purchase, member.purchase_state, {nonNegative:true});
      var retail = stateValue_(member.retail, member.retail_state, {nonNegative:true});
      var weight = stateValue_(member.weight, member.weight_state, {nonNegative:true});
      var allocation = finiteNumber_(member.allocation_factor === undefined ? 1 : member.allocation_factor);
      var result = {category_id:text_(member.category_id),purchase_state:purchase.state,retail_state:retail.state,weight_state:weight.state,applied:false,effective_weight:null};
      if (purchase.state === VALUE_STATES.NOT_APPLICABLE || retail.state === VALUE_STATES.NOT_APPLICABLE || member.not_applicable === true) {
        if (purchase.state === retail.state || member.not_applicable === true) { notApplicableMembers += 1; result.status = 'NOT_APPLICABLE'; }
        else { invalidMembers += 1; result.status = 'APPLICABILITY_MISMATCH'; }
        memberResults.push(result); return;
      }
      expectedMembers += 1;
      if (allocation === null || allocation <= 0 || (weight.state !== VALUE_STATES.VALID && weight.state !== VALUE_STATES.ZERO) || weight.value <= 0) {
        invalidMembers += 1; result.status = 'INVALID_WEIGHT'; memberResults.push(result); return;
      }
      var effectiveWeight = weight.value * allocation;
      result.effective_weight = round_(effectiveWeight, COVERAGE_DIGITS);
      expectedWeight += effectiveWeight;
      if (purchase.state === VALUE_STATES.INVALID || retail.state === VALUE_STATES.INVALID) { invalidMembers += 1; result.status = 'INVALID_VALUE'; memberResults.push(result); return; }
      if (purchase.state === VALUE_STATES.MISSING || retail.state === VALUE_STATES.MISSING) { result.status = 'MISSING_PAIR'; memberResults.push(result); return; }
      if (purchase.value === 0) { invalidMembers += 1; purchaseZero = true; result.status = 'INVALID_BASE_ZERO'; memberResults.push(result); return; }
      appliedMembers += 1; appliedWeight += effectiveWeight; weightedPurchase += effectiveWeight * purchase.value; weightedRetail += effectiveWeight * retail.value;
      result.status = 'READY'; result.applied = true; memberResults.push(result);
    });
    var coverage = coverageResult_(expectedMembers, appliedMembers, expectedWeight, appliedWeight, invalidMembers, notApplicableMembers, coverageRule.allow_partial === true);
    if (coverage.coverage_status === 'NOT_APPLICABLE') return {status:'NOT_APPLICABLE',aggregate_value:null,aggregate_base_value:null,aggregate_change_pp:null,weighted_purchase:null,weighted_retail:null,coverage:coverage,members:memberResults,base_status:'NOT_APPLICABLE'};
    if (purchaseZero) return {status:'INVALID_BASE_ZERO',aggregate_value:null,aggregate_base_value:null,aggregate_change_pp:null,weighted_purchase:null,weighted_retail:null,coverage:coverage,members:memberResults,base_status:'INVALID_BASE_ZERO'};
    if (invalidMembers > 0) return {status:'BLOCKED_INVALID_MEMBER',aggregate_value:null,aggregate_base_value:null,aggregate_change_pp:null,weighted_purchase:null,weighted_retail:null,coverage:coverage,members:memberResults,base_status:'BLOCKED_INVALID_MEMBER'};
    if (appliedWeight <= 0) return {status:'BLOCKED_ZERO_APPLIED_WEIGHT',aggregate_value:null,aggregate_base_value:null,aggregate_change_pp:null,weighted_purchase:null,weighted_retail:null,coverage:coverage,members:memberResults,base_status:'MISSING'};
    var purchaseLevel = roundLegacy6_(weightedPurchase / appliedWeight), retailLevel = roundLegacy6_(weightedRetail / appliedWeight);
    if (purchaseLevel === 0) return {status:'INVALID_BASE_ZERO',aggregate_value:null,aggregate_base_value:null,aggregate_change_pp:null,weighted_purchase:purchaseLevel,weighted_retail:retailLevel,coverage:coverage,members:memberResults,base_status:'INVALID_BASE_ZERO'};
    var markup = roundLegacy6_((retailLevel / purchaseLevel - 1) * 100);
    var base = stateValue_(source.base_markup, source.base_state, {}), hasBase = base.state === VALUE_STATES.VALID || base.state === VALUE_STATES.ZERO;
    return {
      status:coverage.publication_allowed ? 'READY' : 'PARTIAL_NOT_PUBLISHABLE',
      aggregate_value:markup,
      aggregate_base_value:hasBase ? roundLegacy6_(base.value) : null,
      aggregate_change_pp:hasBase ? roundLegacy6_(markup - roundLegacy6_(base.value)) : null,
      weighted_purchase:purchaseLevel,
      weighted_retail:retailLevel,
      coverage:coverage,
      members:memberResults,
      base_status:hasBase ? 'READY' : (base.state === VALUE_STATES.INVALID ? 'INVALID_BASE' : 'MISSING_BASE')
    };
  }

  function methodMembers_(definition, period, indexes) {
    var memberships = memberCandidates_(definition, period, indexes), members = [];
    memberships.forEach(function (membership) {
      indexes.metrics.member_contexts_built += 1;
      var weight = resolveWeight_(definition, membership.category_id, period, indexes);
      var effectiveWeight = weight.value === null ? null : weight.value * membership.allocation_factor;
      if (definition.calculation_method === METHODS.AGGREGATE_MARKUP) {
        var purchase = lookupPrice_(indexes, definition.dataset_code, definition.frequency, membership.category_id, definition.purchase_value_type, definition.index_type, period);
        var retail = lookupPrice_(indexes, definition.dataset_code, definition.frequency, membership.category_id, definition.retail_value_type, definition.index_type, period);
        var purchaseState = stateValue_(purchase ? purchase.current_value : null, purchase ? purchase.current_state || purchase.value_state : VALUE_STATES.MISSING, {nonNegative:true});
        var retailState = stateValue_(retail ? retail.current_value : null, retail ? retail.current_state || retail.value_state : VALUE_STATES.MISSING, {nonNegative:true});
        var purchaseUnit = purchase ? canonicalUnit_(purchase.unit) : '', retailUnit = retail ? canonicalUnit_(retail.unit) : '';
        var purchaseNumeric = purchaseState.state === VALUE_STATES.VALID || purchaseState.state === VALUE_STATES.ZERO;
        var retailNumeric = retailState.state === VALUE_STATES.VALID || retailState.state === VALUE_STATES.ZERO;
        var unitMismatch = purchaseNumeric && retailNumeric && (!purchaseUnit || !retailUnit || purchaseUnit !== retailUnit);
        members.push({
          category_id:membership.category_id,allocation_factor:membership.allocation_factor,weight:weight.value,weight_state:weight.state,weight_code:weight.code,
          purchase:purchase ? purchase.current_value : null,purchase_state:unitMismatch ? VALUE_STATES.INVALID : purchaseState.state,
          retail:retail ? retail.current_value : null,retail_state:unitMismatch ? VALUE_STATES.INVALID : retailState.state,
          not_applicable:purchaseState.state === VALUE_STATES.NOT_APPLICABLE && retailState.state === VALUE_STATES.NOT_APPLICABLE,
          unit_mismatch:unitMismatch,purchase_unit:purchaseUnit,retail_unit:retailUnit,effective_weight:effectiveWeight
        });
      } else {
        var price = lookupPrice_(indexes, definition.dataset_code, definition.frequency, membership.category_id, definition.value_type, definition.index_type, period);
        var change = categoryChangeFromPrice_(price);
        var unitRelevant = change.state !== VALUE_STATES.NOT_APPLICABLE && change.state !== VALUE_STATES.MISSING;
        var unitMismatchContribution = !!price && unitRelevant && !unitsCompatible_(price.unit, definition.output_unit);
        if (unitMismatchContribution) {
          change = {state:VALUE_STATES.INVALID,value:null,category_value:finiteNumber_(price.current_value),code:'AGG_CALC_UNIT_MISMATCH'};
        }
        members.push({
          category_id:membership.category_id,category_value:change.category_value,change_pp:change.value,change_state:change.state,change_code:change.code,
          value:change.value,value_state:change.state,not_applicable:change.state === VALUE_STATES.NOT_APPLICABLE,
          allocation_factor:membership.allocation_factor,weight:weight.value,weight_state:weight.state,weight_code:weight.code,
          category_name:price && price.category_name || membership.category_id,effective_weight:effectiveWeight,
          unit_mismatch:unitMismatchContribution,input_unit:price && price.unit || '',output_unit:definition.output_unit
        });
      }
    });
    return members;
  }

  function baseForDefinition_(definition, period, indexes) {
    var basePeriod = basePeriodFor_(definition.frequency, definition.index_type, period);
    var exact = indexes.base[baseIndexKey_(definition.series_key, basePeriod)];
    if (exact) return exact;
    var rows = (indexes.base_by_series && indexes.base_by_series[definition.series_key] || []).slice();
    if (definition.index_type === 'december') {
      var expectedYear = Number(periodKey_(definition.frequency, period).slice(0,4)) - 1;
      var decemberRows = rows.filter(function (row) {
        var key = text_(row.base_period);
        return Number(key.slice(0,4)) === expectedYear && Number(key.slice(5,7)) === 12;
      });
      if (decemberRows.length) return decemberRows[decemberRows.length - 1];
    }
    return null;
  }

  function aggregateResultRow_(context, result) {
    var row = baseRow_(context, 'AGGREGATE_RESULT', null), coverage = result.coverage || {};
    row.calculation_status = result.status;
    row.contract_code = result.status === 'PARTIAL_NOT_PUBLISHABLE' ? 'AGG_CALC_PARTIAL_NOT_PUBLISHABLE' : (result.status === 'INVALID_BASE_ZERO' ? 'AGG_CALC_INVALID_BASE_ZERO' : (result.status.indexOf('BLOCKED') === 0 ? 'AGG_CALC_INVALID_MEMBER' : ''));
    row.aggregate_change_pp = result.aggregate_change_pp !== undefined ? result.aggregate_change_pp : result.value;
    row.aggregate_value = result.aggregate_value !== undefined ? result.aggregate_value : null;
    row.aggregate_base_value = result.aggregate_base_value !== undefined ? result.aggregate_base_value : null;
    row.expected_members_count = coverage.expected_members_count === undefined ? null : coverage.expected_members_count;
    row.applied_members_count = coverage.applied_members_count === undefined ? null : coverage.applied_members_count;
    row.not_applicable_members_count = coverage.not_applicable_members_count === undefined ? null : coverage.not_applicable_members_count;
    row.invalid_members_count = coverage.invalid_members_count === undefined ? null : coverage.invalid_members_count;
    row.expected_weight_sum = coverage.expected_weight_sum === undefined ? null : coverage.expected_weight_sum;
    row.applied_weight_sum = coverage.applied_weight_sum === undefined ? null : coverage.applied_weight_sum;
    row.coverage_ratio = coverage.coverage_ratio === undefined ? null : coverage.coverage_ratio;
    row.coverage_status = coverage.coverage_status === undefined ? null : coverage.coverage_status;
    row.publication_allowed = coverage.publication_allowed === true;
    if (result.weighted_purchase !== undefined) row.weighted_purchase = result.weighted_purchase;
    if (result.weighted_retail !== undefined) row.weighted_retail = result.weighted_retail;
    if (result.base_status !== undefined) row.base_status = result.base_status;
    return row;
  }

  function unitDiagnostics_(calculationId, impact, definition, period, members) {
    return (members || []).filter(function (member) { return member.unit_mismatch; }).map(function (member) {
      var markup = definition.calculation_method === METHODS.AGGREGATE_MARKUP;
      return diagnostic_({calculation_id:calculationId,impact_id:impact.impact_id,combo_key:impact.combo_key,definition:definition,category_id:member.category_id,period_start:period},'ERROR','AGG_CALC_UNIT_MISMATCH',
        markup ? 'Purchase and retail price units are missing or incompatible.' : 'Price-input unit is incompatible with aggregate output unit.',
        markup ? {purchaseUnit:member.purchase_unit,retailUnit:member.retail_unit} : {inputUnit:member.input_unit,outputUnit:member.output_unit});
    });
  }

  function calculateDefinition_(calculationId, impact, definition, indexes) {
    var period = periodKey_(definition.frequency, impact.target_period), coverageRule = indexes.coverage[definition.coverage_rule_id];
    var context = {calculation_id:calculationId,impact_id:impact.impact_id,combo_key:impact.combo_key,definition:definition,period_start:period,coverage_rule:coverageRule};
    if (!coverageRule) throw calculatorError_('AGG_CALC_COVERAGE_RULE_MISSING', 'Coverage rule referenced by definition was not provided.', {coverageRuleId:definition.coverage_rule_id});
    if (definition.output_unit !== 'percentage_point') {
      throw calculatorError_('AGG_CALC_UNIT_MISMATCH', 'Alpha.7.2 aggregate definitions must publish percentage-point changes.', {outputUnit:definition.output_unit,seriesKey:definition.series_key});
    }
    var members = methodMembers_(definition, period, indexes), result, diagnostics = unitDiagnostics_(calculationId,impact,definition,period,members);
    context.members = members;
    if (definition.calculation_method === METHODS.SUM_CONTRIBUTIONS || definition.calculation_method === METHODS.CATEGORY_CONTRIBUTION) {
      return calculateStandardAggregate(context);
    }
    if (definition.calculation_method === METHODS.NORMALIZED_WEIGHTED_AVERAGE) {
      result = calculateNormalizedWeightedAverage({members:members,coverage_rule:coverageRule});
      return {status:result.status,value:result.value,rows:[aggregateResultRow_(context,result)],diagnostics:diagnostics,coverage:result.coverage};
    }
    if (definition.calculation_method === METHODS.AGGREGATE_MARKUP) {
      var base = baseForDefinition_(definition, period, indexes);
      result = calculateAggregateMarkup({members:members,coverage_rule:coverageRule,base_markup:base ? base.base_value : null,base_state:base ? base.value_state : VALUE_STATES.MISSING});
      return {status:result.status,value:result.aggregate_value,rows:[aggregateResultRow_(context,result)],diagnostics:diagnostics,coverage:result.coverage};
    }
    throw calculatorError_('AGG_CALC_UNSUPPORTED_METHOD', 'Unsupported method reached calculation dispatcher.', {method:definition.calculation_method});
  }

  function mergeCategoryRow_(existing, incoming) {
    var comparable = ['dataset_code','frequency','aggregate_level','aggregate_subject_id','category_id','value_type','index_type','period_start','calculation_method','weight_rule_id'];
    comparable.forEach(function (field) {
      if (stableStringify_(existing[field]) !== stableStringify_(incoming[field])) {
        throw calculatorError_('AGG_CALC_DUPLICATE_ROW_KEY', 'Category contribution rows with the same key have conflicting identity.', {field:field,rowKey:existing.aggregate_row_key});
      }
    });
    ['category_value','category_change_pp','category_weight'].forEach(function (field) {
      if (existing[field] !== null && incoming[field] !== null && existing[field] !== incoming[field]) {
        throw calculatorError_('AGG_CALC_DUPLICATE_ROW_KEY', 'Category contribution rows with the same key have conflicting numeric values.', {field:field,rowKey:existing.aggregate_row_key,existing:existing[field],incoming:incoming[field]});
      }
      if (existing[field] === null && incoming[field] !== null) existing[field] = incoming[field];
    });
    Object.keys(CONTRIBUTION_FIELDS).forEach(function (scope) {
      var field = CONTRIBUTION_FIELDS[scope];
      if (existing[field] !== null && incoming[field] !== null && existing[field] !== incoming[field]) {
        throw calculatorError_('AGG_CALC_DUPLICATE_ROW_KEY', 'Category contribution rows with the same key have conflicting scope contributions.', {field:field,rowKey:existing.aggregate_row_key});
      }
      if (existing[field] === null && incoming[field] !== null) existing[field] = incoming[field];
    });
    applyLineagePairs_(existing, (existing.source_impacts || []).concat(incoming.source_impacts || []));
    existing.parent_aggregate_series_keys = uniqueSorted_((existing.parent_aggregate_series_keys || [existing.parent_aggregate_series_key]).concat(incoming.parent_aggregate_series_keys || [incoming.parent_aggregate_series_key]).filter(function (x) { return text_(x); }));
    existing.parent_aggregate_series_key = existing.parent_aggregate_series_keys[0] || null;
    if (existing.calculation_status !== incoming.calculation_status) {
      var priority = {'BLOCKED_INVALID_MEMBER':5,'MISSING':4,'PARTIAL_NOT_PUBLISHABLE':3,'READY':2,'NOT_APPLICABLE':1};
      if ((priority[incoming.calculation_status] || 0) > (priority[existing.calculation_status] || 0)) {
        existing.calculation_status = incoming.calculation_status;
        existing.contract_code = incoming.contract_code;
      }
    }
    existing.publication_allowed = existing.publication_allowed && incoming.publication_allowed;
    return existing;
  }

  function uniqueSorted_(values) {
    var seen = {};
    (values || []).forEach(function (value) { var key = text_(value); if (key) seen[key] = true; });
    return Object.keys(seen).sort();
  }

  function lineagePairKey_(pair) {
    return text_(pair && pair.combo_key) + '\u001f' + text_(pair && pair.impact_id);
  }

  function normalizeLineagePairs_(pairs) {
    var seen = {};
    (pairs || []).forEach(function (pair) {
      var impactId = text_(pair && pair.impact_id), comboKey = text_(pair && pair.combo_key);
      if (!impactId || !comboKey) return;
      seen[lineagePairKey_({impact_id:impactId,combo_key:comboKey})] = {impact_id:impactId,combo_key:comboKey};
    });
    return Object.keys(seen).sort().map(function (key) { return seen[key]; });
  }

  function applyLineagePairs_(row, pairs) {
    var normalized = normalizeLineagePairs_(pairs);
    row.source_impacts = normalized;
    row.source_impact_ids = normalized.map(function (pair) { return pair.impact_id; });
    row.source_combo_keys = normalized.map(function (pair) { return pair.combo_key; });
    row.impact_id = normalized.length ? normalized[0].impact_id : '';
    row.combo_key = normalized.length ? normalized[0].combo_key : '';
    return row;
  }

  function collectCalculationLineage_(calculation, impact, metrics) {
    var key = lineagePairKey_(impact);
    calculation.lineage_pairs = calculation.lineage_pairs || {};
    if (!calculation.lineage_pairs[key]) {
      calculation.lineage_pairs[key] = {impact_id:text_(impact.impact_id),combo_key:text_(impact.combo_key)};
      if (metrics) metrics.lineage_pairs_collected += 1;
    }
  }

  function attachCalculationLineage_(rowMap, calculation, metrics) {
    var pairs = Object.keys(calculation.lineage_pairs || {}).sort().map(function (key) { return calculation.lineage_pairs[key]; });
    (calculation.row_keys || []).forEach(function (rowKey) {
      var row = rowMap[rowKey];
      if (!row) return;
      applyLineagePairs_(row, (row.source_impacts || []).concat(pairs));
      if (metrics) metrics.lineage_row_attachments += 1;
    });
  }

  function addRows_(rowMap, rows) {
    (rows || []).forEach(function (row) {
      var key = requireText_(row, 'aggregate_row_key', 'AGG_CALC_DUPLICATE_ROW_KEY'), existing = rowMap[key];
      if (!existing) { rowMap[key] = clone_(row); return; }
      if (existing.row_type === 'CATEGORY_CONTRIBUTION' && row.row_type === 'CATEGORY_CONTRIBUTION') {
        rowMap[key] = mergeCategoryRow_(existing,row);
        return;
      }
      throw calculatorError_('AGG_CALC_DUPLICATE_ROW_KEY', 'Duplicate aggregate output row key.', {rowKey:key});
    });
  }

  function compareRows_(a, b) {
    var i, left, right;
    for (i = 0; i < SORT_FIELDS.length; i += 1) {
      left = text_(a[SORT_FIELDS[i]]); right = text_(b[SORT_FIELDS[i]]);
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  }

  function compareDiagnostics_(a, b) {
    var fields = ['calculation_id','impact_id','combo_key','aggregate_subject_id','category_id','period_start','severity','code','message'], i, left, right;
    for (i = 0; i < fields.length; i += 1) {
      left = text_(a[fields[i]]); right = text_(b[fields[i]]);
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  }

  function stripRuntimeMetadata_(value) {
    if (Array.isArray(value)) return value.map(stripRuntimeMetadata_);
    if (value && typeof value === 'object') {
      var out = {}, ignored = {created_at:true,elapsed_ms:true,logging_metadata:true,fingerprint:true,stack:true,executed_at:true,updated_at:true};
      Object.keys(value).forEach(function (key) { if (!ignored[key]) out[key] = stripRuntimeMetadata_(value[key]); });
      return out;
    }
    return value;
  }

  function buildCalculationFingerprint(result) {
    var source = result || {}, rows = stripRuntimeMetadata_(clone_(source.rows || [])).sort(compareRows_), diagnostics = stripRuntimeMetadata_(clone_(source.diagnostics || [])).sort(compareDiagnostics_);
    return sha256_(stableStringify_({rows:rows,diagnostics:diagnostics}));
  }

  function validateSnapshotReference_(impact, weightSnapshot, membershipSnapshot) {
    if (text_(impact.weight_snapshot_id) !== text_(weightSnapshot.snapshot_id)) {
      throw calculatorError_('AGG_CALC_CONTRACT_CONFLICT', 'Impact weight snapshot does not match calculator request.', {impact:impact.weight_snapshot_id,request:weightSnapshot.snapshot_id});
    }
    if (text_(impact.membership_snapshot_id) !== text_(membershipSnapshot.snapshot_id)) {
      throw calculatorError_('AGG_CALC_CONTRACT_CONFLICT', 'Impact membership snapshot does not match calculator request.', {impact:impact.membership_snapshot_id,request:membershipSnapshot.snapshot_id});
    }
  }

  function calculateBatch(request) {
    var source = clone_(request || {}), calculationId = text_(source.calculation_id), diagnostics = [], rowMap = {}, processedCalculations = {}, indexes, impacts;
    try {
      var C = contract_();
      if (text_(source.contract_version) !== INPUT_CONTRACT_VERSION || text_(source.contract_version) !== text_(C.Version)) {
        throw calculatorError_('AGG_CALC_CONTRACT_VERSION_MISMATCH', 'Calculator request uses an unsupported aggregate contract version.', {provided:source.contract_version,expected:INPUT_CONTRACT_VERSION});
      }
      if (!calculationId) throw calculatorError_('AGG_CALC_INPUT_MISSING', 'calculation_id is required.');
      ['impact_items','price_inputs','aggregate_definitions','coverage_rules','base_inputs'].forEach(function (field) {
        if (!Array.isArray(source[field])) throw calculatorError_('AGG_CALC_INPUT_MISSING', field + ' must be an array.', {field:field});
      });
      source.weight_snapshot = normalizeSnapshot_(source.weight_snapshot, 'weight');
      source.membership_snapshot = normalizeSnapshot_(source.membership_snapshot, 'membership');
      indexes = buildIndexes_(source);
      impacts = C.dedupeImpactItems(source.impact_items).sort(function (a, b) { return a.combo_key < b.combo_key ? -1 : a.combo_key > b.combo_key ? 1 : 0; });
      if (!impacts.length) {
        var empty = {ok:true,status:'NO_APPLICABLE_ITEMS',message:'No aggregate impact items were supplied.',calculation_id:calculationId,contract_version:VERSION,input_contract_version:INPUT_CONTRACT_VERSION,rows:[],diagnostics:[],summary:{impact_items_total:0,calculations_total:0,rows_total:0,diagnostics_total:0,metrics:indexes.metrics}};
        empty.fingerprint = buildCalculationFingerprint(empty);
        return empty;
      }
      impacts.forEach(function (impact) {
        validateSnapshotReference_(impact,source.weight_snapshot,source.membership_snapshot);
        if (!ALLOWED_IMPACT_STATUSES[upper_(impact.status)]) {
          var code = text_(impact.contract_code || (NON_APPLICABLE_IMPACT_STATUSES[upper_(impact.status)] ? 'AGG_CALC_IMPACT_STATUS_INVALID' : 'AGG_CALC_IMPACT_STATUS_INVALID'));
          diagnostics.push(diagnostic_({calculation_id:calculationId,impact_id:impact.impact_id,combo_key:impact.combo_key,period_start:impact.target_period},upper_(impact.status) === 'SKIPPED_NOT_APPLICABLE' ? 'INFO' : 'WARNING',code,'Impact item is not eligible for numeric calculation.',{status:impact.status,blockedReason:impact.blocked_reason}));
          return;
        }
        var key = definitionIndexKey_(impact.source_dataset_code,impact.frequency,impact.target_value_type,impact.target_index_type), candidates = indexes.definitions[key] || [];
        indexes.metrics.definition_candidates_inspected += candidates.length;
        candidates = candidates.filter(function (definition) { return scopeMatches_(impact.target_aggregate_scope, definition); });
        if (!candidates.length) {
          diagnostics.push(diagnostic_({calculation_id:calculationId,impact_id:impact.impact_id,combo_key:impact.combo_key,period_start:impact.target_period},'ERROR','AGG_CALC_DEFINITION_MISSING','No aggregate definition matches the validated impact item.',{definitionIndexKey:key,targetScope:impact.target_aggregate_scope}));
          return;
        }
        candidates.forEach(function (definition) {
          var calculationKey = definition.series_key + '|' + periodKey_(definition.frequency,impact.target_period);
          if (processedCalculations[calculationKey]) {
            collectCalculationLineage_(processedCalculations[calculationKey], impact, indexes.metrics);
            return;
          }
          try {
            var result = calculateDefinition_(calculationId,impact,definition,indexes);
            addRows_(rowMap,result.rows);
            diagnostics = diagnostics.concat(result.diagnostics || []);
            var rowKeys = uniqueSorted_((result.rows || []).map(function (row) { return row.aggregate_row_key; }));
            processedCalculations[calculationKey] = {status:result.status,row_keys:rowKeys,definition_series_key:definition.series_key,period_start:impact.target_period,lineage_pairs:{}};
            collectCalculationLineage_(processedCalculations[calculationKey], impact, indexes.metrics);
          } catch (error) {
            diagnostics.push(diagnostic_({calculation_id:calculationId,impact_id:impact.impact_id,combo_key:impact.combo_key,definition:definition,period_start:impact.target_period},'ERROR',text_(error && error.code || 'AGG_CALC_CONTRACT_CONFLICT'),text_(error && error.message || error),error && error.details || {}));
            processedCalculations[calculationKey] = {status:'FAILED',row_keys:[],definition_series_key:definition.series_key,period_start:impact.target_period,lineage_pairs:{}};
            collectCalculationLineage_(processedCalculations[calculationKey], impact, indexes.metrics);
          }
        });
      });
      Object.keys(processedCalculations).sort().forEach(function (calculationKey) {
        attachCalculationLineage_(rowMap, processedCalculations[calculationKey], indexes.metrics);
      });
      var rows = Object.keys(rowMap).map(function (key) { return rowMap[key]; }).sort(compareRows_);
      diagnostics.sort(compareDiagnostics_);
      var blockedRows = rows.filter(function (row) { return row.publication_allowed !== true && row.calculation_status !== 'NOT_APPLICABLE'; }).length;
      var errorDiagnostics = diagnostics.filter(function (row) { return row.severity === 'ERROR'; }).length;
      var summary = {
        impact_items_total:impacts.length,
        impact_items_calculable:impacts.filter(function (item) { return ALLOWED_IMPACT_STATUSES[upper_(item.status)]; }).length,
        impact_items_non_calculable:impacts.filter(function (item) { return !ALLOWED_IMPACT_STATUSES[upper_(item.status)]; }).length,
        definitions_total:indexes.definition_rows.length,
        calculations_total:Object.keys(processedCalculations).length,
        calculations_ready:Object.keys(processedCalculations).filter(function (key) { return processedCalculations[key].status === 'READY'; }).length,
        calculations_blocked:Object.keys(processedCalculations).filter(function (key) { return processedCalculations[key].status !== 'READY'; }).length,
        rows_total:rows.length,
        category_rows:rows.filter(function (row) { return row.row_type === 'CATEGORY_CONTRIBUTION'; }).length,
        aggregate_rows:rows.filter(function (row) { return row.row_type === 'AGGREGATE_RESULT'; }).length,
        blocked_rows:blockedRows,
        diagnostics_total:diagnostics.length,
        diagnostics_error:errorDiagnostics,
        diagnostics_warning:diagnostics.filter(function (row) { return row.severity === 'WARNING'; }).length,
        diagnostics_info:diagnostics.filter(function (row) { return row.severity === 'INFO'; }).length,
        metrics:indexes.metrics
      };
      var status = errorDiagnostics || blockedRows ? 'SUCCESS_WITH_BLOCKED' : 'SUCCESS';
      var output = {ok:true,status:status,message:status === 'SUCCESS' ? 'Alpha.7.2 aggregate calculation completed.' : 'Alpha.7.2 aggregate calculation completed with blocked or non-publishable results.',calculation_id:calculationId,contract_version:VERSION,input_contract_version:INPUT_CONTRACT_VERSION,rows:rows,diagnostics:diagnostics,summary:summary};
      output.fingerprint = buildCalculationFingerprint(output);
      return output;
    } catch (error) {
      var fatal = diagnostic_({calculation_id:calculationId},'ERROR',text_(error && error.code || 'AGG_CALC_CONTRACT_CONFLICT'),text_(error && error.message || error),error && error.details || {});
      var failed = {ok:false,status:'FAILED_CONTRACT',message:'Alpha.7.2 aggregate calculation request failed contract validation.',calculation_id:calculationId,contract_version:VERSION,input_contract_version:INPUT_CONTRACT_VERSION,rows:[],diagnostics:[fatal],summary:{impact_items_total:Array.isArray(source.impact_items) ? source.impact_items.length : 0,calculations_total:0,rows_total:0,diagnostics_total:1}};
      failed.fingerprint = buildCalculationFingerprint(failed);
      return failed;
    }
  }

  function statusSummary() {
    return {
      release_candidate:RELEASE,
      calculator_contract_version:VERSION,
      input_contract_version:INPUT_CONTRACT_VERSION,
      mode:'PURE_IN_MEMORY',
      physical_writes:false,
      methods:Object.keys(METHODS).sort(),
      value_states:Object.keys(VALUE_STATES).sort(),
      rounding:{method:'Math.round',digits:ROUNDING_DIGITS,coverage_digits:COVERAGE_DIGITS},
      default_coverage_rule_id:DEFAULT_COVERAGE_RULE_ID,
      acceptance_status:'DRAFT_FOR_CODE_REVIEW_AND_LIVE_GATES'
    };
  }

  return Object.freeze({
    Version:VERSION,
    Release:RELEASE,
    InputContractVersion:INPUT_CONTRACT_VERSION,
    Methods:clone_(METHODS),
    ValueStates:clone_(VALUE_STATES),
    calculateBatch:calculateBatch,
    calculateStandardAggregate:calculateStandardAggregate,
    calculateNormalizedWeightedAverage:calculateNormalizedWeightedAverage,
    calculateAggregateMarkup:calculateAggregateMarkup,
    calculatePercentChange:calculatePercentChange,
    buildCalculationFingerprint:buildCalculationFingerprint,
    statusSummary:statusSummary,
    Test:Object.freeze({
      sha256:sha256_,
      roundLegacy6:roundLegacy6_,
      periodKey:periodKey_,
      basePeriodFor:basePeriodFor_,
      stateValue:stateValue_,
      coverageResult:coverageResult_,
      normalizeDefinition:normalizeDefinition_,
      canonicalUnit:canonicalUnit_,
      priceKey:priceKey_,
      buildIndexes:buildIndexes_,
      baseForDefinition:baseForDefinition_,
      scopeMatches:scopeMatches_,
      calculatorError:calculatorError_
    })
  });
})();
