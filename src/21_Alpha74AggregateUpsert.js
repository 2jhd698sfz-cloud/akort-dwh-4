var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Incremental Aggregate Refresh candidate-r2.
 *
 * Goals:
 * - recompute only aggregate series affected by an accepted upstream impact;
 * - invoke the frozen Alpha.7.3 planner internally (an external plan is rejected);
 * - support INSERT, UPDATE, NOOP and evidence-backed DELETE;
 * - keep durable queue/checkpoint state in DWH TECH service sheets;
 * - stop before the Apps Script deadline and continue through one dispatcher;
 * - classify an uncertain write by immediate target read-back;
 * - remain disabled by default until isolated/live acceptance gates pass.
 *
 * Package installation never calls any physical entry point.
 */
AKORT.IncrementalAggregateUpsert = (function () {
  var VERSION = '4.0-incremental-aggregate-refresh-2';
  var RELEASE = '4.0.0-alpha.7.4-candidate-r2';
  var MODE = 'DURABLE_INCREMENTAL_AGGREGATE_REFRESH_PRE_ACCEPTANCE';
  var ACCEPTANCE_STATUS = 'READY_FOR_INDEPENDENT_REVIEW_CODE_COMPLETE_PHYSICAL_DISABLED';
  var ACCEPTED_BASE_TAG = 'v4.0.0-alpha.7.3-accepted';
  var ACCEPTED_BASE_COMMIT = '52590c8e036d49b9f76f87341b69881a916c851d';
  var TARGET_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var REQUEST_SCHEMA = 'ALPHA74_AGGREGATE_REFRESH_REQUEST_V1';
  var PLAN_SCHEMA = 'ALPHA74_AGGREGATE_PLAN_ARTIFACT_V2';
  var MODEL_SCHEMA = 'ALPHA74_AGGREGATE_MUTATION_MODEL_V2';
  var RUN_SCHEMA = 'ALPHA74_AGGREGATE_REFRESH_RUN_V2';
  var ENABLED_KEY = 'AKORT_ALPHA74_DISPATCHER_ENABLED';
  var ACTIVE_RUN_KEY = 'AKORT_ALPHA74_ACTIVE_RUN_ID';
  var DISPATCHER_FUNCTION = 'AKORT_alpha74UpsertDispatcherWorker';
  var TABLES = Object.freeze({
    RUNS: 'AGGREGATE_REFRESH_RUNS',
    QUEUE: 'AGGREGATE_REFRESH_QUEUE',
    BATCHES: 'AGGREGATE_REFRESH_BATCHES',
    BACKUP: 'AGGREGATE_REFRESH_BACKUP'
  });
  var RUN_HEADERS = Object.freeze([
    'schema_version','run_id','operation_id','load_id','operation_kind','request_artifact_id','request_sha256','request_fingerprint',
    'plan_artifact_id','plan_sha256','plan_id','plan_fingerprint','model_artifact_id','model_sha256','model_item_digest',
    'status','phase','cursor','calculation_cursor','verification_cursor','rollback_cursor',
    'scan_queue_start_row','scan_queue_end_row','calculation_queue_start_row','calculation_queue_end_row','calculation_item_count','calculation_item_digest','calculation_completed_count',
    'mutation_queue_start_row','mutation_queue_end_row','mutation_item_count','mutation_item_digest','mutation_completed_count',
    'affected_series_json','target_grid_rows','target_last_row','target_columns','target_after_grid_rows','target_header_format_fingerprint','target_before_fingerprint',
    'unrelated_before_fingerprint','unrelated_after_fingerprint','verification_accumulator_json','rollback_accumulator_json','backup_file_id','backup_fingerprint',
    'worker_generation','attempt_count','no_progress_count','started_at','updated_at','heartbeat_at','last_error_code','last_error_message'
  ]);
  var QUEUE_HEADERS = Object.freeze([
    'run_id','item_id','record_kind','sequence_no','action','calculation_id','canonical_row_key','canonical_series_key','visible_series_key','storage_key','physical_row_hint',
    'before_fingerprint','after_fingerprint','before_json','after_json','input_fingerprint','result_artifact_id','result_sha256','result_fingerprint','result_rows_count',
    'status','batch_id','attempt_count','last_error_code','updated_at'
  ]);
  var BATCH_HEADERS = Object.freeze([
    'batch_id','run_id','phase','action','start_cursor','end_cursor','item_count','request_fingerprint','before_target_fingerprint',
    'after_target_fingerprint','status','started_at','finished_at','execution_id','error_code','details_json'
  ]);
  var BACKUP_HEADERS = Object.freeze([
    'backup_id','run_id','item_id','action','canonical_row_key','physical_row_hint','before_fingerprint','before_json','status','created_at','restored_at'
  ]);
  var ACTIONS = Object.freeze({INSERT:true,UPDATE:true,NOOP:true,DELETE:true,LATEST:true});
  var OPERATION_KINDS = Object.freeze({NEW_PERIOD:true,REVISION:true,REVERSAL:true});
  var TERMINAL = Object.freeze({SUCCESS:true,FAILED:true,FAILED_REQUIRES_REVIEW:true,ROLLBACK_COMPLETE:true,CANCELLED:true});
  var RUN_PHASES = Object.freeze([
    'PREPLAN','SCAN_TARGET','BUILD_PLAN','MATERIALIZE_CALC_QUEUE','CALCULATE_SLICES','VERIFY_CALC_SET','ASSEMBLE_MODEL',
    'MATERIALIZE_MUTATION_QUEUE','VERIFY_MODEL_QUEUE','BACKUP_CREATE','BACKUP_VERIFY','BACKUP_CAPTURE','APPLY_DELETE','APPLY_UPDATE','APPLY_INSERT','APPLY_LATEST',
    'VERIFY_AFFECTED','VERIFY_UNRELATED','VERIFY_GEOMETRY','SUCCESS',
    'ROLLBACK_PRECHECK_AFFECTED','ROLLBACK_PRECHECK_UNRELATED','ROLLBACK_PRECHECK_GEOMETRY','ROLLBACK_DELETE_INSERTS','ROLLBACK_RESTORE_UPDATES',
    'ROLLBACK_REINSERT_DELETES','ROLLBACK_TRIM_GRID','ROLLBACK_VERIFY_AFFECTED','ROLLBACK_VERIFY_UNRELATED','ROLLBACK_VERIFY_GEOMETRY','ROLLBACK_COMPLETE',
    'FAILED','FAILED_REQUIRES_REVIEW'
  ]);
  var STABLE_METADATA_FIELDS = Object.freeze([
    'dataset_code','source_name','frequency','aggregate_level','aggregate_name','category_id','product_group','product_name','value_type','index_type'
  ]);
  var PERIOD_FIELDS = Object.freeze(['period_start','year','quarter','month','period_label']);
  var CALCULATOR_FIELDS = Object.freeze([
    'category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp',
    'contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count',
    'coverage_weight_sum','aggregate_value','aggregate_base_value'
  ]);
  var NUMERIC_FIELDS = Object.freeze({
    year:true,quarter:true,month:true,is_latest_period:true,category_value:true,category_change_pp:true,category_weight:true,
    aggregate_change_pp:true,contribution_to_group_change_pp:true,contribution_to_basket_change_pp:true,
    contribution_to_total_cpi_pp:true,coverage_categories_count:true,coverage_weight_sum:true,aggregate_value:true,aggregate_base_value:true
  });
  var DEFAULT_CONFIG = Object.freeze({
    scan_chunk_rows: 1000,
    verification_chunk_rows: 750,
    verification_item_rows: 200,
    queue_write_rows: 200,
    calculation_items_per_worker: 20,
    mutation_batch_rows: 50,
    total_budget_ms: 270000,
    calculation_cutoff_ms: 150000,
    write_start_cutoff_ms: 90000,
    finalization_start_ms: 180000,
    checkpoint_reserve_ms: 30000,
    lock_wait_ms: 1000,
    dispatcher_minutes: 1,
    max_no_progress: 5,
    max_batch_attempts: 3
  });

  function contract_() {
    if (!AKORT.AggregateContract) throw error_('ALPHA74_CONTRACT_UNAVAILABLE', 'Frozen Alpha.7.1 aggregate contract is unavailable.');
    return AKORT.AggregateContract;
  }
  function planner_() {
    if (!AKORT.AggregateRevisionPlanner) throw error_('ALPHA74_PLANNER_UNAVAILABLE', 'Frozen Alpha.7.3 planner is unavailable.');
    return AKORT.AggregateRevisionPlanner;
  }
  function calculator_() {
    if (!AKORT.AggregateCalculator || typeof AKORT.AggregateCalculator.calculateBatch !== 'function') throw error_('ALPHA74_CALCULATOR_UNAVAILABLE', 'Frozen Alpha.7.2 calculator is unavailable.');
    return AKORT.AggregateCalculator;
  }
  function error_(code, message, details) {
    var e = new Error(message);
    e.name = 'Alpha74AggregateUpsertError';
    e.code = code;
    e.details = details || {};
    return e;
  }
  function text_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function norm_(value) { return text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
  function bool_(value) { return value === true || value === 1 || value === '1' || String(value || '').toUpperCase() === 'TRUE'; }
  function finite_(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function clone_(value) {
    if (Array.isArray(value)) return value.map(clone_);
    if (value && typeof value === 'object') {
      if (value instanceof Date) return new Date(value.getTime());
      var o = {};
      Object.keys(value).forEach(function (k) { o[k] = clone_(value[k]); });
      return o;
    }
    return value;
  }
  function canonical_(value) {
    if (Array.isArray(value)) return value.map(canonical_);
    if (value && typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      var o = {};
      Object.keys(value).sort().forEach(function (k) { o[k] = canonical_(value[k]); });
      return o;
    }
    if (typeof value === 'number' && !isFinite(value)) throw error_('ALPHA74_NON_FINITE_NUMBER', 'Non-finite values are forbidden in deterministic payloads.');
    if (typeof value === 'number' && Object.is && Object.is(value, -0)) return 0;
    return value;
  }
  function canonicalJson_(value) { return JSON.stringify(canonical_(value)); }
  function hash_(value) {
    var input = typeof value === 'string' ? value : canonicalJson_(value);
    if (AKORT.AggregateCalculator && AKORT.AggregateCalculator.Test && AKORT.AggregateCalculator.Test.sha256) {
      return AKORT.AggregateCalculator.Test.sha256(input);
    }
    if (AKORT.Core && AKORT.Core.sha256) return AKORT.Core.sha256(input);
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
      return bytes.map(function (b) { var n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join('');
    }
    var h = 2166136261;
    for (var i = 0; i < input.length; i += 1) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function requireText_(object, field, code) {
    var value = text_(object && object[field]);
    if (!value) throw error_(code || 'ALPHA74_REQUIRED_FIELD_MISSING', 'Required Alpha.7.4 field is missing: ' + field + '.', {field:field});
    return value;
  }
  function compareBy_(fields) {
    return function (a, b) {
      var l = fields.map(function (f) { return text_(a[f]); }).join('|');
      var r = fields.map(function (f) { return text_(b[f]); }).join('|');
      return l < r ? -1 : l > r ? 1 : 0;
    };
  }
  function uniqueSorted_(values) {
    var m = {};
    (values || []).forEach(function (v) { var k = text_(v); if (k) m[k] = true; });
    return Object.keys(m).sort();
  }
  function valuesFromObject_(headers, object) {
    return headers.map(function (h) { var v = object[h]; return v === undefined || v === null ? '' : v; });
  }
  function objectFromRow_(headers, values) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = values[i]; });
    return o;
  }
  function config_(overrides) {
    var out = clone_(DEFAULT_CONFIG);
    Object.keys(overrides || {}).forEach(function (k) { if (out[k] !== undefined) out[k] = Number(overrides[k]); });
    if (!(out.write_start_cutoff_ms < out.calculation_cutoff_ms && out.calculation_cutoff_ms < out.finalization_start_ms && out.finalization_start_ms < out.total_budget_ms)) {
      throw error_('ALPHA74_TIME_CONFIG_INVALID', 'Required cutoff order is write < calculation < finalization < total budget.');
    }
    if (!(out.checkpoint_reserve_ms > 0 && out.total_budget_ms - out.finalization_start_ms >= out.checkpoint_reserve_ms)) {
      throw error_('ALPHA74_TIME_CONFIG_INVALID', 'Finalization reserve is invalid.');
    }
    return out;
  }

  function periodKey_(frequency, value) { return contract_().Test.periodKey(norm_(frequency), value); }
  function periodParts_(frequency, value) {
    var key = periodKey_(frequency, value);
    var year = Number(key.slice(0, 4));
    var month = Number(key.slice(5, 7));
    return {key:key, year:year, quarter:Math.floor((month - 1) / 3) + 1, month:month, label:norm_(frequency) === 'monthly' ? key.slice(0, 7) : key};
  }
  function typedValueToken_(value) {
    if (value === undefined) return 'U:';
    if (value === null) return 'L:';
    if (value instanceof Date && !isNaN(value.getTime())) return 'D:' + value.toISOString();
    if (typeof value === 'number') {
      if (!isFinite(value)) throw error_('ALPHA74_NON_FINITE_NUMBER', 'Non-finite physical cell value is forbidden.');
      if (Object.is && Object.is(value, -0)) value = 0;
      return 'N:' + String(value);
    }
    if (typeof value === 'boolean') return 'B:' + (value ? '1' : '0');
    return 'S:' + String(value);
  }
  function physicalType_(value){if(value===undefined)return'UNDEFINED';if(value===null||value==='')return'BLANK';if(value instanceof Date&&!isNaN(value.getTime()))return'DATE';if(typeof value==='number')return'NUMBER';if(typeof value==='boolean')return'BOOLEAN';return'STRING';}
  function canonicalCellToken_(field, value, row, declaredType) {
    var type=text_(declaredType)||physicalType_(value);
    if (type === 'UNDEFINED') return 'U:';
    if (type === 'BLANK') return 'L:';
    if (field === 'period_start') return 'P' + type.charAt(0) + ':' + periodKey_(row && row.frequency || 'weekly', value);
    if (type === 'DATE') return 'D:' + (value instanceof Date ? value.toISOString() : String(value));
    if (type === 'NUMBER') {if (!isFinite(Number(value))) throw error_('ALPHA74_NON_FINITE_NUMBER', 'Non-finite numeric Publish value is forbidden.', {field:field});var n=Number(value);if(Object.is&&Object.is(n,-0))n=0;return'N:'+String(n);}
    if (type === 'BOOLEAN') return 'B:' + (bool_(value) ? '1' : '0');
    return 'S:' + String(value);
  }
  function rowFingerprint_(row) {
    var formats=row&&row._number_formats||[],types=row&&row._physical_types||[];
    return hash_(contract_().Headers.map(function (h,i) { return h + '=' + canonicalCellToken_(h, row[h], row, types[i]) + '|F:' + text_(formats[i]); }));
  }
  function physicalValueType_(value) {
    var v = norm_(value);
    if (v === 'purchase_price') return 'закупка';
    if (v === 'retail_price') return 'розница';
    if (v === 'markup') return 'наценка, %';
    return text_(value);
  }
  function physicalSeriesSubject_(row) {
    var source = row || {}, level = norm_(source.aggregate_level);
    if (level === 'category') return text_(source.category_id || source.aggregate_subject_id || source.aggregate_id);
    if (level === 'group') return text_(source.product_group || source.aggregate_name || source.aggregate_subject_id || source.group_id);
    return text_(source.aggregate_name || source.aggregate_subject_id || source.aggregate_id || source.group_id);
  }
  function visibleSeriesKey_(row) {
    return [text_(row.dataset_code), norm_(row.frequency), norm_(row.aggregate_level), physicalSeriesSubject_(row), text_(row.category_id), physicalValueType_(row.value_type), norm_(row.index_type)].join('|');
  }
  function physicalTargetKey_(row) {
    return [text_(row.dataset_code),norm_(row.frequency),norm_(row.aggregate_level),text_(row.aggregate_id),text_(row.category_id),physicalValueType_(row.value_type),norm_(row.index_type),periodKey_(row.frequency,row.period_start)].join('|');
  }
  function storageKey_(row) { return physicalTargetKey_(row); }
  function definitionVisibleKey_(definition) {
    var d = clone_(definition || {});
    d.value_type = physicalValueType_(d.value_type);
    return [text_(d.dataset_code), norm_(d.frequency), norm_(d.aggregate_level), physicalSeriesSubject_(d), text_(d.category_id), text_(d.value_type), norm_(d.index_type)].join('|');
  }
  function legacyHashId_(prefix, value) { return prefix + '_' + hash_(String(value)).slice(0, 20).toUpperCase(); }
  function legacyAggregateIdForRow_(planned, template, period) {
    var p = planned || {}, t = template || {}, level = norm_(p.aggregate_level), dataset = text_(p.dataset_code), frequency = norm_(p.frequency), valueType = physicalValueType_(p.value_type), indexType = norm_(p.index_type), periodKey = periodKey_(frequency, period);
    if (level === 'category') return legacyHashId_('AGG_CAT', [dataset,frequency,valueType,indexType,text_(p.category_id || p.aggregate_subject_id)].join('|'));
    if (text_(p.calculation_method).toUpperCase() === 'AGGREGATE_MARKUP' || norm_(valueType) === 'наценка, %') return legacyHashId_('AGG_MARKUP_PCT', [dataset,frequency,level,indexType,periodKey].join('|'));
    if (level === 'custom_group' && norm_(p.aggregate_name || t.aggregate_name) === 'борщевой набор') return legacyHashId_('AGG_BORSHCH', [dataset,frequency,valueType,indexType,periodKey].join('|'));
    var key = [level,dataset,frequency,valueType,indexType,periodKey];
    if (level === 'group') key.push(text_(t.product_group || p.aggregate_name || p.aggregate_subject_id));
    return legacyHashId_('AGG', key.join('|'));
  }
  function activeAt_(row, period) {
    var p = periodKey_(row.frequency, period);
    var from = text_(row.effective_from) ? periodKey_(row.frequency, row.effective_from) : '0000-01-01';
    var to = text_(row.effective_to) ? periodKey_(row.frequency, row.effective_to) : '9999-12-31';
    var status = norm_(row.status || 'active');
    return p >= from && p <= to && ['active','accepted','current'].indexOf(status) >= 0 && Number(row.include_flag === undefined ? 1 : row.include_flag) !== 0;
  }
  function definitionIndexes_(definitions) {
    var visible = {}, standardParents = {};
    (definitions || []).forEach(function (d) {
      var definition=clone_(d),key=definitionVisibleKey_(definition),parentKey=[text_(definition.dataset_code),norm_(definition.frequency),physicalValueType_(definition.value_type),norm_(definition.index_type)].join('|');
      visible[key] = visible[key] || [];
      visible[key].push(definition);
      if(['SUM_CONTRIBUTIONS','CATEGORY_CONTRIBUTION'].indexOf(text_(definition.calculation_method).toUpperCase())>=0){standardParents[parentKey]=standardParents[parentKey]||[];standardParents[parentKey].push(definition);}
    });
    Object.keys(visible).forEach(function (k) { visible[k].sort(compareBy_(['effective_from','effective_to','definition_id'])); });
    Object.keys(standardParents).forEach(function(k){standardParents[k].sort(compareBy_(['aggregate_level','aggregate_subject_id','effective_from','definition_id']));});
    return {visible:visible,standard_parents:standardParents};
  }
  function ruleActiveAt_(row,frequency,period) {
    var p=periodKey_(frequency,period),from=text_(row.effective_from)?periodKey_(frequency,row.effective_from):(norm_(frequency)==='monthly'?'0000-01':'0000-01-01'),to=text_(row.effective_to)?periodKey_(frequency,row.effective_to):(norm_(frequency)==='monthly'?'9999-12':'9999-12-31'),status=norm_(row.status||'active');
    return p>=from&&p<=to&&['active','accepted','current'].indexOf(status)>=0&&Number(row.include_flag===undefined?1:row.include_flag)!==0;
  }
  function membershipIndexes_(rows) {
    var exact={},bySubject={};(rows||[]).forEach(function(row){var rule=text_(row.membership_rule_id||row.rule_id),subject=text_(row.aggregate_subject_id||row.scope),category=text_(row.category_id);if(!rule||!subject||!category)return;var exactKey=[rule,subject,category].join('|'),subjectKey=[rule,subject].join('|');exact[exactKey]=exact[exactKey]||[];exact[exactKey].push(clone_(row));bySubject[subjectKey]=bySubject[subjectKey]||[];bySubject[subjectKey].push(clone_(row));});return{exact:exact,by_subject:bySubject};
  }
  function syntheticCategoryDefinition_(parent,categoryId) {
    var d=clone_(parent);d.aggregate_level='category';d.aggregate_subject_id=text_(categoryId);d.category_id=text_(categoryId);d.aggregate_name=text_(categoryId);d.calculation_method='CATEGORY_CONTRIBUTION';d.membership_rule_id='';delete d.group_id;return d;
  }
  function categoryDefinitionsForRow_(row,indexes,memberships) {
    var category=text_(row.category_id),key=visibleSeriesKey_(row),explicit=(indexes.visible[key]||[]).filter(function(d){return activeAt_(d,row.period_start);}),parentKey=[text_(row.dataset_code),norm_(row.frequency),physicalValueType_(row.value_type),norm_(row.index_type)].join('|'),parents=indexes.standard_parents[parentKey]||[],candidates=explicit.slice();
    parents.forEach(function(parent){if(!activeAt_(parent,row.period_start))return;if(norm_(parent.aggregate_level)==='category'){candidates.push(parent);return;}var memberRows=memberships.exact[[text_(parent.membership_rule_id),text_(parent.aggregate_subject_id),category].join('|')]||[];if(memberRows.some(function(member){return ruleActiveAt_(member,parent.frequency,row.period_start);}))candidates.push(syntheticCategoryDefinition_(parent,category));});
    var unique={};candidates.forEach(function(d){var x=clone_(d),series=contract_().aggregateSeriesKey(x);unique[series]=x;});return Object.keys(unique).sort().map(function(k){return unique[k];});
  }
  function activeDefinitionForRow_(row, indexes, memberships) {
    var level=norm_(row.aggregate_level),matches=level==='category'?categoryDefinitionsForRow_(row,indexes,memberships):(indexes.visible[visibleSeriesKey_(row)]||[]).filter(function(d){return activeAt_(d,row.period_start);});
    if (matches.length !== 1) throw error_(level==='category'&&matches.length>1?'ALPHA74_PHYSICAL_CATEGORY_IDENTITY_CONFLICT':'ALPHA74_CANONICAL_DEFINITION_AMBIGUOUS', 'Physical row must resolve to exactly one active semantic definition.', {visible_series_key:visibleSeriesKey_(row), period_start:row.period_start, matches:matches.length,definition_ids:matches.map(function(d){return d.definition_id;})});
    return matches[0];
  }
  function canonicalIdentityForRow_(row, indexes, memberships) {
    var definition = clone_(activeDefinitionForRow_(row, indexes, memberships));
    definition.period_start = periodKey_(row.frequency, row.period_start);
    return {definition:definition, aggregate_series_key:contract_().aggregateSeriesKey(definition), aggregate_row_key:contract_().aggregateRowKey(definition)};
  }
  function canonicalTargetRows_(rows, definitions, membershipRows) {
    var indexes = definitionIndexes_(definitions),memberships=membershipIndexes_(membershipRows||[]), byKey = {}, bySeries = {}, output = [];
    (rows || []).forEach(function (raw, i) {
      var row = clone_(raw), identity = canonicalIdentityForRow_(row, indexes, memberships);
      row.aggregate_series_key = identity.aggregate_series_key;
      row.aggregate_row_key = identity.aggregate_row_key;
      row._physical_row_number = Number(raw._physical_row_number || i + 2);
      row._row_fingerprint = rowFingerprint_(row);
      if (byKey[row.aggregate_row_key]) throw error_('ALPHA74_TARGET_DUPLICATE_CANONICAL_KEY', 'Target contains duplicate canonical aggregate row key.', {aggregate_row_key:row.aggregate_row_key});
      byKey[row.aggregate_row_key] = row;
      bySeries[row.aggregate_series_key] = bySeries[row.aggregate_series_key] || [];
      bySeries[row.aggregate_series_key].push(row);
      output.push(row);
    });
    Object.keys(bySeries).forEach(function (k) { bySeries[k].sort(compareBy_(['period_start','aggregate_row_key'])); });
    return {rows:output, by_key:byKey, by_series:bySeries, definition_index:indexes.visible};
  }
  function stableMetadata_(row) {
    var out = {};
    STABLE_METADATA_FIELDS.forEach(function (f) { out[f] = row[f] === undefined || row[f] === null ? '' : row[f]; });
    return out;
  }
  function seriesTemplate_(seriesRows, plannedRow) {
    var rows = seriesRows || [];
    if (!rows.length) throw error_('ALPHA74_INSERT_TEMPLATE_MISSING', 'New aggregate period requires an existing physical template row for the same canonical series.', {aggregate_series_key:plannedRow.aggregate_series_key});
    var signatures = {};
    rows.forEach(function (r) { signatures[canonicalJson_({metadata:stableMetadata_(r),number_formats:r._number_formats||[]})] = true; });
    if (Object.keys(signatures).length !== 1) throw error_('ALPHA74_TEMPLATE_METADATA_CONFLICT', 'Existing series has conflicting stable display metadata.', {aggregate_series_key:plannedRow.aggregate_series_key});
    return clone_(rows[rows.length - 1]);
  }
  function plannerRowIdentityCheck_(planned, template) {
    var fields = ['dataset_code','frequency','aggregate_level','category_id','index_type'];
    fields.forEach(function (f) {
      if (norm_(planned[f]) !== norm_(template[f])) throw error_('ALPHA74_PLANNED_IDENTITY_MISMATCH', 'Planner row identity differs from its physical series template.', {field:f, planned:planned[f], template:template[f], aggregate_row_key:planned.aggregate_row_key});
    });
    if (norm_(physicalValueType_(planned.value_type)) !== norm_(physicalValueType_(template.value_type))) throw error_('ALPHA74_PLANNED_IDENTITY_MISMATCH', 'Planner value_type differs from its physical vocabulary mapping.', {planned:planned.value_type,template:template.value_type});
    if (definitionVisibleKey_(planned) !== visibleSeriesKey_(template)) throw error_('ALPHA74_PLANNED_IDENTITY_MISMATCH', 'Planner semantic subject does not resolve to the physical series subject.', {planned_key:definitionVisibleKey_(planned),template_key:visibleSeriesKey_(template)});
  }
  function buildAfterRow_(planned, template, latest) {
    plannerRowIdentityCheck_(planned, template);
    var after = clone_(template), parts = periodParts_(planned.frequency, planned.period_start),headers=contract_().Headers;
    after._template_physical_row_number = Number(template._physical_row_number || 0);after._number_formats=(template._number_formats||headers.map(function(){return'General';})).slice();after._physical_types=(template._physical_types||headers.map(function(h){return physicalType_(template[h]);})).slice();
    after.period_start = parts.key;after._physical_types[headers.indexOf('period_start')]='DATE';
    after.aggregate_id = legacyAggregateIdForRow_(planned, template, parts.key);after._physical_types[headers.indexOf('aggregate_id')]='STRING';
    after.value_type = physicalValueType_(planned.value_type);after._physical_types[headers.indexOf('value_type')]='STRING';
    after.year = parts.year;after._physical_types[headers.indexOf('year')]='NUMBER';
    after.quarter = parts.quarter;after._physical_types[headers.indexOf('quarter')]='NUMBER';
    after.month = parts.month;after._physical_types[headers.indexOf('month')]='NUMBER';
    after.period_label = parts.label;after._physical_types[headers.indexOf('period_label')]='STRING';
    CALCULATOR_FIELDS.forEach(function (f) {
      var value = planned[f];
      var fi=headers.indexOf(f);if (value === undefined || value === null || value === '') { after[f] = '';after._physical_types[fi]='BLANK'; return; }
      if (NUMERIC_FIELDS[f]) { var n = finite_(value); if (n === null) throw error_('ALPHA74_CALCULATOR_VALUE_INVALID', 'Planner returned a non-numeric calculator field.', {field:f,value:value}); after[f] = n;after._physical_types[fi]='NUMBER'; }
      else {after[f] = value;after._physical_types[fi]=physicalType_(value);}
    });
    after.is_latest_period = latest ? 1 : 0;after._physical_types[headers.indexOf('is_latest_period')]='NUMBER';
    contract_().Headers.forEach(function (h) { if (after[h] === undefined || after[h] === null) after[h] = ''; });
    return after;
  }
  function validateRequest_(request) {
    var r = request || {};
    ['plan','planned_rows','latest_intents','latest_conflicts','mutations','execution_plan'].forEach(function (f) {
      if (r[f] !== undefined) throw error_('ALPHA74_EXTERNAL_PLAN_REJECTED', 'External plan or mutation payload is not an accepted Alpha.7.4 input.', {field:f});
    });
    var kind = requireText_(r, 'operation_kind', 'ALPHA74_OPERATION_KIND_MISSING').toUpperCase();
    if (!OPERATION_KINDS[kind]) throw error_('ALPHA74_OPERATION_KIND_INVALID', 'Unsupported aggregate refresh operation kind.', {operation_kind:r.operation_kind});
    requireText_(r, 'operation_id', 'ALPHA74_OPERATION_ID_MISSING');
    requireText_(r, 'load_id', 'ALPHA74_LOAD_ID_MISSING');
    if (!Array.isArray(r.source_impacts) || !r.source_impacts.length) throw error_('ALPHA74_SOURCE_IMPACTS_REQUIRED', 'At least one authoritative source impact is required.');
    if (!Array.isArray(r.definitions) || !r.definitions.length) throw error_('ALPHA74_DEFINITIONS_REQUIRED', 'Versioned aggregate definitions are required.');
    if (text_(r.accepted_base_tag || ACCEPTED_BASE_TAG) !== ACCEPTED_BASE_TAG || text_(r.accepted_base_commit || ACCEPTED_BASE_COMMIT) !== ACCEPTED_BASE_COMMIT) {
      throw error_('ALPHA74_ACCEPTED_BASE_MISMATCH', 'Request is not bound to the accepted Alpha.7.3 base.');
    }
    if (norm_(r.source_operation_status) !== 'success') throw error_('ALPHA74_SOURCE_OPERATION_NOT_SUCCESS','Aggregate refresh requires explicit SUCCESS evidence for the accepted upstream operation.',{source_operation_status:r.source_operation_status});
    ['price_inputs','coverage_rules','base_inputs'].forEach(function(field){if(!Array.isArray(r[field]))throw error_('ALPHA74_REQUEST_ARRAY_REQUIRED','Required request collection is missing.',{field:field});});
    ['weight_snapshot','membership_snapshot'].forEach(function(field){var snapshot=r[field];if(!snapshot||typeof snapshot!=='object'||!text_(snapshot.snapshot_id)||!text_(snapshot.hash)||!Array.isArray(snapshot.rule_rows))throw error_('ALPHA74_SNAPSHOT_INVALID','Immutable snapshot identity/rule_rows are required.',{field:field});});
    if(!r.frontier||typeof r.frontier!=='object'||!text_(r.frontier.snapshot_id)||!text_(r.frontier.hash)||typeof r.frontier.keys!=='object')throw error_('ALPHA74_FRONTIER_INVALID','Immutable existing-period frontier is required.');
    if (kind === 'REVERSAL') {
      if (r.has_current_effect !== true || !r.current_effect_evidence || typeof r.current_effect_evidence !== 'object') throw error_('ALPHA74_REVERSAL_EVIDENCE_REQUIRED', 'REVERSAL requires positive current-effect evidence.');
      if (!Array.isArray(r.current_effect_row_keys) || !r.current_effect_row_keys.length) throw error_('ALPHA74_REVERSAL_ROW_KEYS_REQUIRED', 'REVERSAL requires at least one current_effect_row_key.');
      var evidenceKeys=uniqueSorted_(r.current_effect_evidence.row_keys||[]),requestedKeys=uniqueSorted_(r.current_effect_row_keys);
      if(norm_(r.current_effect_evidence.status)!=='current_effect_confirmed'||JSON.stringify(evidenceKeys)!==JSON.stringify(requestedKeys))throw error_('ALPHA74_REVERSAL_EVIDENCE_BINDING_MISMATCH','Current-effect evidence must confirm and bind the exact reversal row-key set.',{evidence_status:r.current_effect_evidence.status,evidence_row_keys:evidenceKeys,requested_row_keys:requestedKeys});
      requireText_(r.current_effect_evidence,'source_operation_id','ALPHA74_REVERSAL_SOURCE_OPERATION_MISSING');
    }
    var out=clone_(r);['source_impacts','definitions','price_inputs','coverage_rules','base_inputs'].forEach(function(field){out[field]=(out[field]||[]).slice().sort(function(a,b){var l=canonicalJson_(a),rr=canonicalJson_(b);return l<rr?-1:l>rr?1:0;});});['weight_snapshot','membership_snapshot'].forEach(function(field){out[field].rule_rows=out[field].rule_rows.slice().sort(function(a,b){var l=canonicalJson_(a),rr=canonicalJson_(b);return l<rr?-1:l>rr?1:0;});});if(Array.isArray(out.current_effect_row_keys))out.current_effect_row_keys=uniqueSorted_(out.current_effect_row_keys);return out;
  }
  function plannerInput_(request, existingCanonicalRows, executeCalculator) {
    var r = validateRequest_(request), input = clone_(r);
    input.accepted_base_tag = ACCEPTED_BASE_TAG;
    input.accepted_base_commit = ACCEPTED_BASE_COMMIT;
    input.execute_calculator = executeCalculator === true;
    input.existing_aggregate_rows = (existingCanonicalRows || []).map(function (row) {
      return {
        aggregate_series_key:row.aggregate_series_key,
        aggregate_row_key:row.aggregate_row_key,
        frequency:row.frequency,
        period_start:periodKey_(row.frequency, row.period_start),
        is_latest_period:Number(row.is_latest_period || 0)
      };
    });
    input.latest_frontier = {rows:clone_(input.existing_aggregate_rows), excluded_row_keys:clone_(r.operation_kind === 'REVERSAL' ? r.current_effect_row_keys || [] : [])};
    delete input.operation_kind;
    delete input.accepted_base_tag;
    delete input.accepted_base_commit;
    return input;
  }
  function replayPlanner_(request, existingCanonicalRows, executeCalculator, overridePlanner) {
    var r = validateRequest_(request), input = plannerInput_(r, existingCanonicalRows, executeCalculator), p = overridePlanner || planner_();
    var result = r.operation_kind === 'REVERSAL' ? p.planReversal(input) : p.planRevision(input);
    if (!result || result.ok !== true || ['FAILED_CONTRACT','FAILED'].indexOf(text_(result.status)) >= 0) throw error_('ALPHA74_PLANNER_FAILED', 'Frozen Alpha.7.3 planner rejected the aggregate refresh request.', {status:result && result.status, diagnostics:result && result.diagnostics});
    if (text_(result.status) !== 'SUCCESS' || Number(result.summary && result.summary.blocked_items || 0) > 0) throw error_('ALPHA74_PLANNER_PARTIAL_RESULT', 'Partial or blocked planner output cannot be physically published.', {status:result.status, summary:result.summary, diagnostics:result.diagnostics});
    requireText_(result, 'plan_id', 'ALPHA74_PLAN_ID_MISSING');
    requireText_(result, 'fingerprint', 'ALPHA74_PLAN_FINGERPRINT_MISSING');
    if ((result.latest_conflicts || []).length) throw error_('ALPHA74_LATEST_CONFLICT', 'Frozen planner returned latest-period conflicts.', {conflicts:result.latest_conflicts});
    if (executeCalculator === true && !Array.isArray(result.planned_rows)) throw error_('ALPHA74_PLANNED_ROWS_MISSING', 'Planner did not return calculated aggregate rows.');
    return result;
  }
  function preplanAffectedVisibleSeries_(preplan, request) {
    var items = preplan.revision_items || preplan.reversal_items || [], out = {},memberships=membershipIndexes_(request&&request.membership_snapshot&&request.membership_snapshot.rule_rows||[]);
    items.forEach(function (item) {
      if (text_(item.status) !== 'PLANNED') return;
      var d = item.definition || {},period=item.target_period||item.period_start;
      out[definitionVisibleKey_(d)] = true;
      if(['SUM_CONTRIBUTIONS','CATEGORY_CONTRIBUTION'].indexOf(text_(d.calculation_method).toUpperCase())<0)return;
      if(norm_(d.aggregate_level)==='category'){out[definitionVisibleKey_(syntheticCategoryDefinition_(d,d.category_id||d.aggregate_subject_id))]=true;return;}
      var members=memberships.by_subject[[text_(d.membership_rule_id),text_(d.aggregate_subject_id)].join('|')]||[];
      members.forEach(function(member){if(ruleActiveAt_(member,d.frequency,period))out[definitionVisibleKey_(syntheticCategoryDefinition_(d,member.category_id))]=true;});
    });
    return Object.keys(out).sort();
  }
  function finalLatestBySeries_(plan, scan, plannedKeys, deletionKeys) {
    var next = {}, currentCount = {};
    Object.keys(scan.by_series).forEach(function (series) {
      var latest = scan.by_series[series].filter(function (r) { return Number(r.is_latest_period || 0) === 1; });
      if (latest.length > 1) throw error_('ALPHA74_LATEST_PRECHANGE_CONFLICT', 'Target has more than one latest row in a canonical series.', {aggregate_series_key:series});
      next[series] = latest.length ? latest[0].aggregate_row_key : '';
      currentCount[series] = latest.length;
    });
    (plan.latest_intents || []).forEach(function (intent) { next[text_(intent.aggregate_series_key)] = text_(intent.next_latest_row_key); });
    var affected = {};
    Object.keys(plannedKeys).forEach(function (k) { affected[text_(plannedKeys[k].aggregate_series_key)] = true; });
    Object.keys(deletionKeys).forEach(function (k) { if (scan.by_key[k]) affected[scan.by_key[k].aggregate_series_key] = true; });
    Object.keys(affected).forEach(function (series) {
      var finalKey = text_(next[series]), available = {};
      (scan.by_series[series] || []).forEach(function (r) { if (!deletionKeys[r.aggregate_row_key]) available[r.aggregate_row_key] = true; });
      Object.keys(plannedKeys).forEach(function (k) { if (plannedKeys[k].aggregate_series_key === series) available[k] = true; });
      if (finalKey && !available[finalKey]) throw error_('ALPHA74_LATEST_TARGET_MISSING', 'Latest intent points to a row absent from the post-change series.', {aggregate_series_key:series, row_key:finalKey});
      if (Object.keys(available).length && !finalKey) throw error_('ALPHA74_LATEST_MISSING', 'Resolvable affected series has no final latest row.', {aggregate_series_key:series});
    });
    return {next:next, affected:affected};
  }
  function mutationItem_(action, rowKey, seriesKey, before, after, extra) {
    var item = clone_(extra || {});
    item.action = action;
    item.canonical_row_key = text_(rowKey);
    item.canonical_series_key = text_(seriesKey);
    item.before = before ? clone_(before) : null;
    item.after = after ? clone_(after) : null;
    item.before_fingerprint = before ? rowFingerprint_(before) : '';
    item.after_fingerprint = after ? rowFingerprint_(after) : '';
    item.storage_key = after ? storageKey_(after) : before ? storageKey_(before) : '';
    item.visible_series_key = after ? visibleSeriesKey_(after) : before ? visibleSeriesKey_(before) : '';
    item.physical_row_hint = before ? Number(before._physical_row_number || 0) : 0;
    item.item_id = 'AGITEM_' + hash_([action,item.canonical_row_key,item.before_fingerprint,item.after_fingerprint]).slice(0, 24).toUpperCase();
    return item;
  }
  function buildMutationModel_(request, plan, targetRows) {
    var r = validateRequest_(request), scan = canonicalTargetRows_(targetRows, r.definitions, r.membership_snapshot.rule_rows), planned = {}, deletion = {};
    (plan.planned_rows || []).forEach(function (row) {
      var key = requireText_(row, 'aggregate_row_key', 'ALPHA74_PLANNED_ROW_KEY_MISSING');
      if (planned[key]) throw error_('ALPHA74_DUPLICATE_PLANNED_ROW_KEY', 'Planner returned a duplicate aggregate row key.', {aggregate_row_key:key});
      planned[key] = clone_(row);
    });
    if (r.operation_kind === 'REVERSAL') {
      (r.current_effect_row_keys || []).forEach(function (key) {
        key = text_(key);
        if (key && !planned[key]) deletion[key] = true;
      });
    }
    var latest = finalLatestBySeries_(plan, scan, planned, deletion), items = [], touched = {};
    Object.keys(planned).sort().forEach(function (key) {
      var calc = planned[key], current = scan.by_key[key] || null, template = current || seriesTemplate_(scan.by_series[calc.aggregate_series_key], calc);
      var after = buildAfterRow_(calc, template, latest.next[calc.aggregate_series_key] === key);
      after.aggregate_row_key = key;
      after.aggregate_series_key = calc.aggregate_series_key;
      var action = current ? (rowFingerprint_(current) === rowFingerprint_(after) ? 'NOOP' : 'UPDATE') : 'INSERT';
      items.push(mutationItem_(action, key, calc.aggregate_series_key, current, after, {reason:r.operation_kind}));
      touched[key] = true;
    });
    Object.keys(deletion).sort().forEach(function (key) {
      var current = scan.by_key[key];
      if (!current) throw error_('ALPHA74_REVERSAL_TARGET_ROW_MISSING','Evidence-backed reversal row is absent from the pre-operation target.',{aggregate_row_key:key});
      items.push(mutationItem_('DELETE', key, current.aggregate_series_key, current, null, {reason:'REVERSAL', current_effect_evidence_fingerprint:hash_(r.current_effect_evidence)}));
      touched[key] = true;
    });
    Object.keys(latest.affected).sort().forEach(function (series) {
      (scan.by_series[series] || []).forEach(function (current) {
        if (touched[current.aggregate_row_key] || deletion[current.aggregate_row_key]) return;
        var intended = latest.next[series] === current.aggregate_row_key ? 1 : 0;
        if (Number(current.is_latest_period || 0) === intended) return;
        var after = clone_(current);
        after.is_latest_period = intended;
        items.push(mutationItem_('LATEST', current.aggregate_row_key, series, current, after, {reason:'LATEST_INTENT'}));
        touched[current.aggregate_row_key] = true;
      });
    });
    items.sort(function (a, b) {
      var order = {DELETE:1,UPDATE:2,INSERT:3,LATEST:4,NOOP:5};
      if (order[a.action] !== order[b.action]) return order[a.action] - order[b.action];
      return a.canonical_row_key < b.canonical_row_key ? -1 : a.canonical_row_key > b.canonical_row_key ? 1 : 0;
    });
    var counts = {INSERT:0,UPDATE:0,NOOP:0,DELETE:0,LATEST:0};
    items.forEach(function (x) { counts[x.action] += 1; });
    var model = {
      schema_version:MODEL_SCHEMA,
      operation_id:r.operation_id,
      load_id:r.load_id,
      operation_kind:r.operation_kind,
      plan_id:text_(plan.plan_id),
      plan_fingerprint:text_(plan.fingerprint),
      request_fingerprint:requestFingerprint_(r),
      items:items,
      counts:counts,
      affected_series:Object.keys(latest.affected).sort()
    };
    model.item_count = items.length;
    model.item_digest = mutationSetDigest_(items);
    model.fingerprint = hash_(model);
    return model;
  }
  function applyModelToRows_(rows, model) {
    var output = clone_(rows || []), map = {}, order = [];
    output.forEach(function (r) { var k = storageKey_(r); map[k] = clone_(r); order.push(k); });
    (model.items || []).forEach(function (item) {
      if (item.action === 'NOOP') return;
      var beforeStorage = item.before ? storageKey_(item.before) : '';
      var afterStorage = item.after ? storageKey_(item.after) : '';
      if (item.action === 'DELETE') { delete map[beforeStorage]; order = order.filter(function (k) { return k !== beforeStorage; }); return; }
      if (item.action === 'INSERT') { if (!map[afterStorage]) order.push(afterStorage); map[afterStorage] = clone_(item.after); return; }
      if (beforeStorage && afterStorage !== beforeStorage) { delete map[beforeStorage]; order = order.map(function (k) { return k === beforeStorage ? afterStorage : k; }); }
      map[afterStorage] = clone_(item.after);
    });
    return order.filter(function (k, i) { return map[k] && order.indexOf(k) === i; }).map(function (k) { return map[k]; });
  }
  function requestFingerprint_(request) {
    var r = validateRequest_(request), copy = clone_(r);
    copy.accepted_base_tag = ACCEPTED_BASE_TAG;
    copy.accepted_base_commit = ACCEPTED_BASE_COMMIT;
    return hash_(copy);
  }
  function requestArtifact_(request) {
    var r = validateRequest_(request), payload = {schema_version:REQUEST_SCHEMA, accepted_base_tag:ACCEPTED_BASE_TAG, accepted_base_commit:ACCEPTED_BASE_COMMIT, request:r};
    payload.request_fingerprint = requestFingerprint_(r);
    payload.payload_fingerprint = hash_(payload);
    var json = canonicalJson_(payload);
    return {payload:payload, json:json, sha256:hash_(json)};
  }
  function validateRequestArtifact_(json, expectedSha) {
    if (text_(expectedSha) && hash_(String(json)) !== text_(expectedSha)) throw error_('ALPHA74_REQUEST_ARTIFACT_SHA_MISMATCH', 'Request artifact bytes do not match the stored SHA.');
    var parsed;
    try { parsed = JSON.parse(String(json)); } catch (e) { throw error_('ALPHA74_REQUEST_ARTIFACT_JSON_INVALID', 'Request artifact is not valid JSON.'); }
    if (text_(parsed.schema_version) !== REQUEST_SCHEMA) throw error_('ALPHA74_REQUEST_ARTIFACT_SCHEMA_MISMATCH', 'Request artifact schema is invalid.');
    var expected = requestArtifact_(parsed.request);
    if (text_(parsed.request_fingerprint) !== expected.payload.request_fingerprint || text_(parsed.payload_fingerprint) !== expected.payload.payload_fingerprint) throw error_('ALPHA74_REQUEST_ARTIFACT_FINGERPRINT_MISMATCH', 'Request artifact semantic fingerprint is invalid.');
    return parsed;
  }
  function batchId_(runId, phase, action, itemIds) { return 'AGBATCH_' + hash_([runId,phase,action,(itemIds || []).slice().sort()]).slice(0, 24).toUpperCase(); }
  function classifyItemState_(item, current) {
    if (item.action === 'INSERT') {
      if (!current) return 'BEFORE';
      return rowFingerprint_(current) === item.after_fingerprint ? 'AFTER' : 'THIRD';
    }
    if (item.action === 'DELETE') {
      if (!current) return 'AFTER';
      return rowFingerprint_(current) === item.before_fingerprint ? 'BEFORE' : 'THIRD';
    }
    if (!current) return 'THIRD';
    var fp = rowFingerprint_(current);
    if (fp === item.before_fingerprint) return 'BEFORE';
    if (fp === item.after_fingerprint) return 'AFTER';
    return 'THIRD';
  }
  function classifyBatchOutcome_(items, currentByCanonicalKey) {
    var counts = {BEFORE:0,AFTER:0,THIRD:0};
    (items || []).forEach(function (item) { counts[classifyItemState_(item, currentByCanonicalKey[item.canonical_row_key] || null)] += 1; });
    if (counts.THIRD) return {status:'FAILED_REQUIRES_REVIEW', counts:counts};
    if (counts.AFTER === items.length) return {status:'COMMITTED', counts:counts};
    if (counts.BEFORE === items.length) return {status:'RETRY_SAFE', counts:counts};
    return {status:'FAILED_REQUIRES_REVIEW', counts:counts};
  }
  function classifyRollbackOutcome_(items, currentByCanonicalKey) {
    var counts = {BEFORE:0,AFTER:0,THIRD:0};
    (items || []).forEach(function (item) { counts[classifyItemState_(item, currentByCanonicalKey[item.canonical_row_key] || null)] += 1; });
    if (counts.THIRD) return {status:'FAILED_REQUIRES_REVIEW', counts:counts};
    if (counts.BEFORE === items.length) return {status:'RESTORED', counts:counts};
    if (counts.AFTER === items.length) return {status:'RETRY_SAFE', counts:counts};
    return {status:'FAILED_REQUIRES_REVIEW', counts:counts};
  }
  function shouldPause_(startedMs, nowMs, cfg, mode) {
    var c = config_(cfg), elapsed = Number(nowMs) - Number(startedMs), remaining = c.total_budget_ms - elapsed, m = mode === true ? 'WRITE' : text_(mode || 'GENERAL').toUpperCase();
    if (elapsed >= c.finalization_start_ms || remaining <= c.checkpoint_reserve_ms) return {pause:true,reason:'FINALIZATION_RESERVE',elapsed_ms:elapsed,remaining_ms:remaining};
    if (m === 'CALCULATION' && elapsed >= c.calculation_cutoff_ms) return {pause:true,reason:'CALCULATION_CUTOFF',elapsed_ms:elapsed,remaining_ms:remaining};
    if (m === 'WRITE' && elapsed >= c.write_start_cutoff_ms) return {pause:true,reason:'WRITE_START_CUTOFF',elapsed_ms:elapsed,remaining_ms:remaining};
    return {pause:false,reason:'CONTINUE',elapsed_ms:elapsed,remaining_ms:remaining};
  }

  function nextPhase_(phase) {
    var order = ['PREPLAN','SCAN_TARGET','BUILD_PLAN','MATERIALIZE_CALC_QUEUE','CALCULATE_SLICES','VERIFY_CALC_SET','ASSEMBLE_MODEL','MATERIALIZE_MUTATION_QUEUE','VERIFY_MODEL_QUEUE','BACKUP_CREATE','BACKUP_VERIFY','BACKUP_CAPTURE','APPLY_DELETE','APPLY_UPDATE','APPLY_INSERT','APPLY_LATEST','VERIFY_AFFECTED','VERIFY_UNRELATED','VERIFY_GEOMETRY','SUCCESS'];
    var i = order.indexOf(text_(phase));
    if (i < 0 || i === order.length - 1) return text_(phase);
    return order[i + 1];
  }

  function zeroWords_() { return [0,0,0,0,0,0,0,0]; }
  function emptyAccumulator_() { return {version:'SHA256_LANES_V1',count:0,xor:zeroWords_(),sum:zeroWords_(),sum_sq:zeroWords_()}; }
  function tokenWords_(token) { var h=hash_(token),out=[];for(var i=0;i<8;i+=1){var part=h.slice(i*8,i*8+8),n=parseInt(part,16);if(!isFinite(n)){n=0;for(var j=0;j<part.length;j+=1)n=(Math.imul(n,33)+part.charCodeAt(j))>>>0;}out.push(n>>>0);}return out; }
  function normalizeAccumulator_(value){var source=value||{},out=emptyAccumulator_();out.count=Number(source.count||0);['xor','sum','sum_sq'].forEach(function(k){if(Array.isArray(source[k])&&source[k].length===8)out[k]=source[k].map(function(n){return Number(n||0)>>>0;});});return out;}
  function accumulateToken_(acc, token) { var out=normalizeAccumulator_(acc),words=tokenWords_(token);out.count+=1;for(var i=0;i<8;i+=1){var n=words[i];out.xor[i]=(out.xor[i]^n)>>>0;out.sum[i]=(out.sum[i]+n)>>>0;out.sum_sq[i]=(out.sum_sq[i]+Math.imul(n,n))>>>0;}return out; }
  function combineAccumulators_(left,right){var a=normalizeAccumulator_(left),b=normalizeAccumulator_(right);a.count+=b.count;for(var i=0;i<8;i+=1){a.xor[i]=(a.xor[i]^b.xor[i])>>>0;a.sum[i]=(a.sum[i]+b.sum[i])>>>0;a.sum_sq[i]=(a.sum_sq[i]+b.sum_sq[i])>>>0;}return a;}
  function unrelatedAccumulator_(rows, affectedVisibleSeries) {
    var affected={},acc=emptyAccumulator_();(affectedVisibleSeries||[]).forEach(function(k){affected[text_(k)]=true;});
    (rows||[]).forEach(function(row){if(!affected[visibleSeriesKey_(row)])acc=accumulateToken_(acc,storageKey_(row)+'|'+rowFingerprint_(row));});
    return acc;
  }
  function unrelatedFingerprint_(rows, affectedVisibleSeries) { return hash_(unrelatedAccumulator_(rows,affectedVisibleSeries)); }
  function unrelatedFingerprintChunked_(rows, affectedVisibleSeries, chunkRows) {
    var size=Number(chunkRows||DEFAULT_CONFIG.scan_chunk_rows),acc=emptyAccumulator_();
    for(var start=0;start<(rows||[]).length;start+=size)acc=combineAccumulators_(acc,unrelatedAccumulator_(rows.slice(start,start+size),affectedVisibleSeries));
    return hash_(acc);
  }
  function inventoryFingerprint_(rows) {
    return hash_((rows || []).map(function (row, i) { return String(i + 2) + '|' + storageKey_(row) + '|' + rowFingerprint_(row); }));
  }
  function dateSerial_(value) {
    var key = text_(value).slice(0, 10), ms = new Date(key + 'T00:00:00.000Z').getTime();
    if (!isFinite(ms)) throw error_('ALPHA74_DATE_SERIAL_INVALID', 'Cannot convert period_start to a Google Sheets date serial.', {value:value});
    return ms / 86400000 + 25569;
  }
  function extendedValue_(field, value, row) {
    if (value === null || value === undefined || value === '') return {};
    if (field === 'period_start') {
      var key = periodKey_(row && row.frequency || 'weekly', value);
      if (key.length === 7) key += '-01';
      return {numberValue:dateSerial_(key)};
    }
    if (NUMERIC_FIELDS[field]) {
      var n = finite_(value);
      if (n === null) throw error_('ALPHA74_NUMERIC_CELL_INVALID', 'Numeric Publish field contains a non-numeric value.', {field:field, value:value});
      return {numberValue:n};
    }
    if (typeof value === 'boolean') return {boolValue:value};
    return {stringValue:String(value)};
  }
  function numberFormatType_(field,pattern){var p=text_(pattern);if(field==='period_start')return'DATE';if(p==='@')return'TEXT';if(p.indexOf('%')>=0)return'PERCENT';if(/[€$₽£¥]/.test(p))return'CURRENCY';if(/[Ee][+-]?0/.test(p))return'SCIENTIFIC';return'NUMBER';}
  function updateCellsRow_(headers, row, includeFormat) {
    var formats=row&&row._number_formats||[];
    return {values:headers.map(function (h,i) { var cell={userEnteredValue:extendedValue_(h, row[h], row)};if(includeFormat===true){var pattern=text_(formats[i]||'General');cell.userEnteredFormat={numberFormat:{type:numberFormatType_(h,pattern),pattern:pattern}};}return cell; })};
  }


  function calculationItemId_(runId, calculationId) { return 'AGCALC_' + hash_([text_(runId),text_(calculationId)]).slice(0,24).toUpperCase(); }
  function calculationBinding_(row) { return [text_(row.item_id),text_(row.calculation_id),text_(row.input_fingerprint),text_(row.before_fingerprint)].join('\u001f'); }
  function calculationSetDigest_(rows) { return hash_((rows || []).map(calculationBinding_).sort()); }
  function mutationBinding_(item) { return [text_(item.item_id),text_(item.action),text_(item.canonical_row_key),text_(item.canonical_series_key),text_(item.storage_key),text_(item.before_fingerprint),text_(item.after_fingerprint)].join('\u001f'); }
  function mutationSetDigest_(items) { return hash_((items || []).map(mutationBinding_).sort()); }
  function proveExactSet_(expectedRows, actualRows, bindingFn, code) {
    var expected = (expectedRows || []).map(bindingFn).sort(), actual = (actualRows || []).map(bindingFn).sort(), seen = {};
    actual.forEach(function (x) { if (seen[x]) throw error_(code, 'Durable work set contains a duplicate binding.', {binding:x}); seen[x] = true; });
    if (expected.length !== actual.length || hash_(expected) !== hash_(actual)) throw error_(code, 'Durable work set differs from its immutable source.', {expected_count:expected.length,actual_count:actual.length,expected_digest:hash_(expected),actual_digest:hash_(actual)});
    return {count:actual.length,digest:hash_(actual)};
  }
  function hydrateCalculatorBatch_(batch, shared) {
    return {contract_version:batch.contract_version,calculation_id:batch.calculation_id,impact_items:clone_(batch.impact_items||[]),aggregate_definitions:clone_(batch.aggregate_definitions||[]),price_inputs:clone_(shared.price_inputs||[]),weight_snapshot:clone_(shared.weight_snapshot||{}),membership_snapshot:clone_(shared.membership_snapshot||{}),coverage_rules:clone_(shared.coverage_rules||[]),base_inputs:clone_(shared.base_inputs||[]),options:clone_(shared.options||{})};
  }
  function calculationResultFingerprint_(result) {
    var c = calculator_();
    if (typeof c.buildCalculationFingerprint === 'function') return c.buildCalculationFingerprint(result);
    if (c.Test && typeof c.Test.buildCalculationFingerprint === 'function') return c.Test.buildCalculationFingerprint(result);
    return hash_(result);
  }
  function publishableRowsFromCalculation_(result) {
    if (!result || result.ok !== true || ['FAILED','FAILED_CONTRACT'].indexOf(text_(result.status)) >= 0) throw error_('ALPHA74_CALCULATION_FAILED_CONTRACT', 'Frozen calculator rejected a calculation item.', {status:result&&result.status,diagnostics:result&&result.diagnostics});
    var rows = clone_(result.rows || []), blocked = rows.filter(function (r) { return text_(r.row_type) === 'AGGREGATE_RESULT' && r.publication_allowed !== true; });
    if (blocked.length) throw error_('ALPHA74_CALCULATION_NOT_PUBLISHABLE', 'A required aggregate result is not publishable.', {row_keys:blocked.map(function(r){return r.aggregate_row_key;})});
    return rows.filter(function (r) { return r.publication_allowed === true && text_(r.calculation_status) === 'READY'; });
  }
  function lineagePairs_(row) {
    var seen={};(row&&row.source_impacts||[]).forEach(function(pair){var impact=text_(pair&&pair.impact_id),combo=text_(pair&&pair.combo_key);if(impact&&combo)seen[combo+'\u001f'+impact]={impact_id:impact,combo_key:combo};});return Object.keys(seen).sort().map(function(k){return seen[k];});
  }
  function mergeCalculatedCategoryRow_(existing,incoming) {
    var out=clone_(existing),identity=['dataset_code','frequency','aggregate_level','aggregate_subject_id','category_id','value_type','index_type','period_start','calculation_method','weight_rule_id'];
    identity.forEach(function(field){if(canonicalJson_(out[field])!==canonicalJson_(incoming[field]))throw error_('ALPHA74_MODEL_DUPLICATE_ITEM','Cross-calculation category row has conflicting identity.',{aggregate_row_key:out.aggregate_row_key,field:field});});
    ['category_value','category_change_pp','category_weight'].forEach(function(field){if(out[field]!==null&&out[field]!==undefined&&incoming[field]!==null&&incoming[field]!==undefined&&Number(out[field])!==Number(incoming[field]))throw error_('ALPHA74_MODEL_DUPLICATE_ITEM','Cross-calculation category row has conflicting numeric value.',{aggregate_row_key:out.aggregate_row_key,field:field});if((out[field]===null||out[field]===undefined)&&incoming[field]!==null&&incoming[field]!==undefined)out[field]=incoming[field];});
    ['contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp'].forEach(function(field){if(out[field]!==null&&out[field]!==undefined&&incoming[field]!==null&&incoming[field]!==undefined&&Number(out[field])!==Number(incoming[field]))throw error_('ALPHA74_MODEL_DUPLICATE_ITEM','Cross-calculation category row has conflicting contribution.',{aggregate_row_key:out.aggregate_row_key,field:field});if((out[field]===null||out[field]===undefined)&&incoming[field]!==null&&incoming[field]!==undefined)out[field]=incoming[field];});
    var pairs=lineagePairs_({source_impacts:(out.source_impacts||[]).concat(incoming.source_impacts||[])});out.source_impacts=pairs;out.source_impact_ids=uniqueSorted_(pairs.map(function(p){return p.impact_id;}));out.source_combo_keys=uniqueSorted_(pairs.map(function(p){return p.combo_key;}));out.calculation_ids=uniqueSorted_((out.calculation_ids||[out.calculation_id]).concat(incoming.calculation_ids||[incoming.calculation_id]));out.calculation_id=out.calculation_ids[0]||'';out.parent_aggregate_series_keys=uniqueSorted_((out.parent_aggregate_series_keys||[out.parent_aggregate_series_key]).concat(incoming.parent_aggregate_series_keys||[incoming.parent_aggregate_series_key]));out.parent_aggregate_series_key=out.parent_aggregate_series_keys[0]||null;
    var priority={BLOCKED_INVALID_MEMBER:5,MISSING:4,PARTIAL_NOT_PUBLISHABLE:3,READY:2,NOT_APPLICABLE:1};if((priority[text_(incoming.calculation_status)]||0)>(priority[text_(out.calculation_status)]||0)){out.calculation_status=incoming.calculation_status;out.contract_code=incoming.contract_code;}out.publication_allowed=out.publication_allowed===true&&incoming.publication_allowed===true;return out;
  }
  function assembleCalculatedPlan_(basePlan, calculationResults, existingRows, excludedKeys) {
    var rowMap = {};
    (calculationResults || []).forEach(function (result) { publishableRowsFromCalculation_(result).forEach(function (row) { var key=requireText_(row,'aggregate_row_key','ALPHA74_CALCULATION_ROW_KEY_MISSING'),existing=rowMap[key];if(!existing){rowMap[key]=clone_(row);return;}if(text_(existing.row_type)==='CATEGORY_CONTRIBUTION'&&text_(row.row_type)==='CATEGORY_CONTRIBUTION'){rowMap[key]=mergeCalculatedCategoryRow_(existing,row);return;}throw error_('ALPHA74_MODEL_DUPLICATE_ITEM','Calculated results contain a conflicting duplicate aggregate row key.',{aggregate_row_key:key,row_types:[existing.row_type,row.row_type]}); }); });
    var rows=Object.keys(rowMap).map(function(k){return rowMap[k];});rows.sort(compareBy_(['aggregate_series_key','period_start','aggregate_row_key']));
    var latest = planner_().buildLatestIntents(rows,{rows:clone_(existingRows||[]),excluded_row_keys:clone_(excludedKeys||[])});
    if ((latest.conflicts || []).length) throw error_('ALPHA74_LATEST_CONFLICT','Latest intent assembly produced a conflict.',{conflicts:latest.conflicts});
    var out=clone_(basePlan);out.planned_rows=rows;out.latest_intents=latest.intents||[];out.latest_conflicts=[];out.latest_status='READY';out.calculation_result_digest=hash_(calculationResults.map(calculationResultFingerprint_).sort());out.assembled_fingerprint=hash_({plan_fingerprint:out.fingerprint,rows:rows,latest_intents:out.latest_intents,calculation_result_digest:out.calculation_result_digest});return out;
  }

  /* ------------------------- Apps Script adapter: candidate-r2 ------------------------- */
  function assertDev_() { if (!AKORT.EnvironmentGuard || !AKORT.EnvironmentGuard.assertDev) throw error_('ALPHA74_ENVIRONMENT_GUARD_UNAVAILABLE','DEV EnvironmentGuard is unavailable.'); return AKORT.EnvironmentGuard.assertDev(); }
  function runtimeConfig_() { if (!AKORT.Config || !AKORT.Config.load) throw error_('ALPHA74_CONFIG_UNAVAILABLE','AKORT.Config.load is unavailable.'); return AKORT.Config.load({includeSystemSettings:false}); }
  function resources_() { return runtimeConfig_().resources || {}; }
  function properties_() { if (typeof PropertiesService === 'undefined') throw error_('ALPHA74_PROPERTIES_UNAVAILABLE','PropertiesService is unavailable.'); return PropertiesService.getScriptProperties(); }
  function enabled_() { return bool_(properties_().getProperty(ENABLED_KEY)); }
  function assertEnabled_() { if (!enabled_()) throw error_('ALPHA74_EXECUTION_DISABLED','Incremental Aggregate Refresh is disabled.'); }
  function controlSpreadsheet_() { var r=resources_(),id=text_(r.dwhTechSpreadsheetId||r.controlSpreadsheetId);if(!id)throw error_('ALPHA74_CONTROL_SPREADSHEET_MISSING','DWH TECH/control spreadsheet ID is missing.');return SpreadsheetApp.openById(id); }
  function publishSpreadsheet_() { var id=text_(resources_().publishSpreadsheetId);if(!id)throw error_('ALPHA74_PUBLISH_SPREADSHEET_MISSING','DEV Publish spreadsheet ID is missing.');return SpreadsheetApp.openById(id); }
  function artifactFolder_() { var r=resources_(),id=text_(r.aggregateRefreshArtifactFolderId||r.testResultsFolderId);if(!id)throw error_('ALPHA74_ARTIFACT_FOLDER_MISSING','aggregateRefreshArtifactFolderId or testResultsFolderId must be configured.');return DriveApp.getFolderById(id); }
  function ensureSheet_(ss,name,headers){var sheet=ss.getSheetByName(name);if(!sheet)sheet=ss.insertSheet(name);var existing=sheet.getRange(1,1,1,headers.length).getDisplayValues()[0],blank=existing.every(function(v){return!text_(v);});if(blank)sheet.getRange(1,1,1,headers.length).setValues([headers.slice()]);else if(JSON.stringify(existing)!==JSON.stringify(headers.slice()))throw error_('ALPHA74_SERVICE_SCHEMA_MISMATCH','Service sheet headers differ from Alpha.7.4 candidate-r2.',{sheet:name,expected:headers,actual:existing});sheet.setFrozenRows(1);return sheet;}
  function serviceSheets_(){var ss=controlSpreadsheet_();return{runs:ensureSheet_(ss,TABLES.RUNS,RUN_HEADERS),queue:ensureSheet_(ss,TABLES.QUEUE,QUEUE_HEADERS),batches:ensureSheet_(ss,TABLES.BATCHES,BATCH_HEADERS),backup:ensureSheet_(ss,TABLES.BACKUP,BACKUP_HEADERS)};}
  function readTable_(sheet,headers){var last=sheet.getLastRow();if(last<2)return[];return readTableRange_(sheet,headers,2,last);}
  function readTableRange_(sheet,headers,startRow,endRow){var start=Math.max(2,Number(startRow||2)),end=Math.min(sheet.getLastRow(),Number(endRow||0));if(end<start)return[];return sheet.getRange(start,1,end-start+1,headers.length).getValues().map(function(v,i){var o=objectFromRow_(headers,v);o._sheet_row=start+i;return o;});}
  function readRowsForRun_(sheet,headers,runId){var last=sheet.getLastRow(),column=headers.indexOf('run_id')+1;if(last<2||column<1)return[];var matches=sheet.getRange(2,column,last-1,1).createTextFinder(text_(runId)).matchEntireCell(true).matchCase(true).findAll(),numbers=matches.map(function(r){return r.getRow();}).sort(function(a,b){return a-b;}),groups=[],current=[];numbers.forEach(function(n){if(!current.length||n===current[current.length-1]+1)current.push(n);else{groups.push(current);current=[n];}});if(current.length)groups.push(current);var out=[];groups.forEach(function(g){out=out.concat(readTableRange_(sheet,headers,g[0],g[g.length-1]));});return out.filter(function(r){return text_(r.run_id)===text_(runId);});}
  function appendRows_(sheet,headers,objects){if(!objects.length)return{start_row:0,end_row:0};var start=sheet.getLastRow()+1;sheet.getRange(start,1,objects.length,headers.length).setValues(objects.map(function(o){return valuesFromObject_(headers,o);}));objects.forEach(function(o,i){o._sheet_row=start+i;});return{start_row:start,end_row:start+objects.length-1};}
  function updateRow_(sheet,headers,rowNumber,object){sheet.getRange(rowNumber,1,1,headers.length).setValues([valuesFromObject_(headers,object)]);}
  function updateRowsGrouped_(sheet,headers,objects){var rows=(objects||[]).filter(function(o){return Number(o._sheet_row)>=2;}).sort(function(a,b){return Number(a._sheet_row)-Number(b._sheet_row);}),groups=[],current=[];rows.forEach(function(o){if(!current.length||Number(o._sheet_row)===Number(current[current.length-1]._sheet_row)+1)current.push(o);else{groups.push(current);current=[o];}});if(current.length)groups.push(current);groups.forEach(function(g){sheet.getRange(Number(g[0]._sheet_row),1,g.length,headers.length).setValues(g.map(function(o){return valuesFromObject_(headers,o);}));});}
  function findRun_(runId){var sheets=serviceSheets_(),rows=readRowsForRun_(sheets.runs,RUN_HEADERS,runId),found=null;rows.forEach(function(r){if(text_(r.run_id)===text_(runId))found=r;});return{sheet:sheets.runs,row:found};}
  function saveRun_(run){var found=findRun_(run.run_id),copy=clone_(run);copy.schema_version=RUN_SCHEMA;copy.updated_at=new Date().toISOString();delete copy._sheet_row;if(found.row)updateRow_(found.sheet,RUN_HEADERS,found.row._sheet_row,copy);else appendRows_(found.sheet,RUN_HEADERS,[copy]);return copy;}
  function rangeFields_(kind){if(kind==='SCAN')return['scan_queue_start_row','scan_queue_end_row'];if(kind==='CALCULATION')return['calculation_queue_start_row','calculation_queue_end_row'];if(kind==='MUTATION')return['mutation_queue_start_row','mutation_queue_end_row'];throw error_('ALPHA74_QUEUE_KIND_INVALID','Unsupported queue record kind.',{record_kind:kind});}
  function queueRowsForRun_(run,kind){var fields=rangeFields_(kind),start=Number(run[fields[0]]||0),end=Number(run[fields[1]]||0);if(!start||!end)return[];return readTableRange_(serviceSheets_().queue,QUEUE_HEADERS,start,end).filter(function(r){return text_(r.run_id)===text_(run.run_id)&&text_(r.record_kind)===kind;});}
  function queueRows_(runId,kind){var run=findRun_(runId).row;if(!run)return[];return queueRowsForRun_(run,kind);}
  function upsertQueueRows_(objects){if(!objects.length)return[];var groups={};objects.forEach(function(o){var k=text_(o.run_id)+'|'+text_(o.record_kind);groups[k]=groups[k]||[];groups[k].push(o);});Object.keys(groups).forEach(function(k){var rows=groups[k],runId=text_(rows[0].run_id),kind=text_(rows[0].record_kind),found=findRun_(runId),run=found.row;if(!run)throw error_('ALPHA74_RUN_NOT_FOUND','Queue write references an unknown run.',{run_id:runId});var existing=queueRowsForRun_(run,kind),index={};existing.forEach(function(r){index[text_(r.item_id)]=r;});var updates=[],adds=[];rows.forEach(function(o){o.updated_at=new Date().toISOString();var old=index[text_(o.item_id)];if(old){o._sheet_row=old._sheet_row;updates.push(o);}else adds.push(o);});if(updates.length)updateRowsGrouped_(serviceSheets_().queue,QUEUE_HEADERS,updates);if(adds.length){var appended=appendRows_(serviceSheets_().queue,QUEUE_HEADERS,adds),fields=rangeFields_(kind),oldStart=Number(run[fields[0]]||0),oldEnd=Number(run[fields[1]]||0);if(oldEnd&&appended.start_row!==oldEnd+1)throw error_('ALPHA74_QUEUE_RANGE_NOT_CONTIGUOUS','Run-scoped queue range lost contiguity.',{run_id:runId,record_kind:kind,old_end:oldEnd,new_start:appended.start_row});run[fields[0]]=oldStart||appended.start_row;run[fields[1]]=appended.end_row;saveRun_(run);}});return objects;}
  function createArtifact_(prefix,payload){var json=canonicalJson_(payload),sha=hash_(json),name=prefix+'_'+sha.slice(0,16).toUpperCase()+'.json',folder=artifactFolder_(),files=folder.getFilesByName(name),file=null;while(files.hasNext()){var c=files.next();if(file)throw error_('ALPHA74_ARTIFACT_DUPLICATE','More than one deterministic artifact exists.',{name:name});file=c;}if(!file)file=folder.createFile(name,json,MimeType.PLAIN_TEXT);var rb=file.getBlob().getDataAsString('UTF-8');if(hash_(rb)!==sha)throw error_('ALPHA74_ARTIFACT_READBACK_MISMATCH','Artifact failed exact read-back.',{file_id:file.getId()});return{file_id:file.getId(),sha256:sha,json:json};}
  function readArtifact_(fileId,expectedSha){var file=DriveApp.getFileById(requireText_({file_id:fileId},'file_id','ALPHA74_ARTIFACT_ID_MISSING')),json=file.getBlob().getDataAsString('UTF-8');if(hash_(json)!==text_(expectedSha))throw error_('ALPHA74_ARTIFACT_SHA_MISMATCH','Drive artifact differs from durable reference.',{file_id:fileId});return{file:file,json:json,parsed:JSON.parse(json)};}
  function backupName_(run){return'ALPHA74_BACKUP_'+text_(run.run_id);}
  function createFullBackup_(run){if(text_(run.backup_file_id))return run.backup_file_id;var folder=artifactFolder_(),name=backupName_(run),files=folder.getFilesByName(name),copy=null;while(files.hasNext()){var c=files.next();if(copy)throw error_('ALPHA74_BACKUP_DUPLICATE','More than one deterministic backup exists.',{name:name});copy=c;}if(!copy)copy=DriveApp.getFileById(resources_().publishSpreadsheetId).makeCopy(name,folder);var ss=SpreadsheetApp.openById(copy.getId()),sheet=ss.getSheetByName(TARGET_SHEET);if(!sheet)throw error_('ALPHA74_BACKUP_SHEET_MISSING','Backup does not contain target sheet.');run.backup_file_id=copy.getId();saveRun_(run);return copy.getId();}
  function backupTargetSheet_(run){var sheet=SpreadsheetApp.openById(requireText_(run,'backup_file_id','ALPHA74_BACKUP_ID_MISSING')).getSheetByName(TARGET_SHEET);if(!sheet)throw error_('ALPHA74_BACKUP_SHEET_MISSING','Backup does not contain target sheet.');return sheet;}
  function withLock_(fn){if(typeof LockService==='undefined')return fn();var lock=LockService.getScriptLock();if(!lock.tryLock(config_({}).lock_wait_ms))return{ok:true,status:'SKIPPED_LOCKED'};try{return fn();}finally{try{lock.releaseLock();}catch(ignore){}}}
  function install(){return withLock_(function(){assertDev_();var sheets=serviceSheets_();if(properties_().getProperty(ENABLED_KEY)===null)properties_().setProperty(ENABLED_KEY,'false');if(properties_().getProperty(ACTIVE_RUN_KEY)===null)properties_().setProperty(ACTIVE_RUN_KEY,'');return{ok:true,status:'INSTALLED_DISABLED_CANDIDATE_R2',tables:Object.keys(TABLES).map(function(k){return TABLES[k];}),execution_enabled:enabled_(),physical_publish_writes:false,service_sheets:[sheets.runs.getName(),sheets.queue.getName(),sheets.batches.getName(),sheets.backup.getName()]};});}
  function setExecutionEnabled(value){assertDev_();properties_().setProperty(ENABLED_KEY,value===true?'true':'false');return{ok:true,status:value===true?'ENABLED_DEV_ONLY':'DISABLED',execution_enabled:enabled_()};}
  function enqueue(request){return withLock_(function(){assertDev_();assertEnabled_();serviceSheets_();var r=validateRequest_(request),artifact=requestArtifact_(r),runId='AGRUN_'+hash_([r.operation_id,artifact.payload.request_fingerprint]).slice(0,24).toUpperCase(),existing=findRun_(runId).row;if(existing)return{ok:true,status:TERMINAL[text_(existing.status)]?text_(existing.status):'ALREADY_QUEUED',run_id:runId};var active=text_(properties_().getProperty(ACTIVE_RUN_KEY));if(active){var activeRun=findRun_(active).row;if(activeRun&&!TERMINAL[text_(activeRun.status)])throw error_('ALPHA74_ACTIVE_RUN_EXISTS','Another aggregate refresh run is active.',{active_run_id:active});}var stored=createArtifact_('ALPHA74_REQUEST_'+runId,artifact.payload),now=new Date().toISOString(),run={schema_version:RUN_SCHEMA,run_id:runId,operation_id:r.operation_id,load_id:r.load_id,operation_kind:r.operation_kind,request_artifact_id:stored.file_id,request_sha256:stored.sha256,request_fingerprint:artifact.payload.request_fingerprint,plan_artifact_id:'',plan_sha256:'',plan_id:'',plan_fingerprint:'',model_artifact_id:'',model_sha256:'',model_item_digest:'',status:'QUEUED',phase:'PREPLAN',cursor:0,calculation_cursor:0,verification_cursor:0,rollback_cursor:0,scan_queue_start_row:0,scan_queue_end_row:0,calculation_queue_start_row:0,calculation_queue_end_row:0,calculation_item_count:0,calculation_item_digest:'',calculation_completed_count:0,mutation_queue_start_row:0,mutation_queue_end_row:0,mutation_item_count:0,mutation_item_digest:'',mutation_completed_count:0,affected_series_json:'[]',target_grid_rows:0,target_last_row:0,target_columns:0,target_after_grid_rows:0,target_header_format_fingerprint:'',target_before_fingerprint:'',unrelated_before_fingerprint:'',unrelated_after_fingerprint:'',verification_accumulator_json:'',rollback_accumulator_json:'',backup_file_id:'',backup_fingerprint:'',worker_generation:1,attempt_count:0,no_progress_count:0,started_at:now,updated_at:now,heartbeat_at:now,last_error_code:'',last_error_message:''};saveRun_(run);properties_().setProperty(ACTIVE_RUN_KEY,runId);return{ok:true,status:'QUEUED',run_id:runId,request_artifact_id:stored.file_id,request_sha256:stored.sha256};});}
  function loadRunRequest_(run){var a=readArtifact_(run.request_artifact_id,run.request_sha256),p=validateRequestArtifact_(a.json,run.request_sha256);if(text_(p.request_fingerprint)!==text_(run.request_fingerprint))throw error_('ALPHA74_RUN_REQUEST_BINDING_MISMATCH','Run/request binding mismatch.');return p.request;}
  function targetSheet_(){var sheet=publishSpreadsheet_().getSheetByName(TARGET_SHEET);if(!sheet)throw error_('ALPHA74_TARGET_SHEET_MISSING','Target sheet is missing.');var headers=sheet.getRange(1,1,1,contract_().Headers.length).getDisplayValues()[0];if(JSON.stringify(headers)!==JSON.stringify(contract_().Headers))throw error_('ALPHA74_TARGET_HEADERS_MISMATCH','Target headers differ from accepted contract.',{actual:headers});return sheet;}
  function scanTargetRows_(sheet,startRow,count){if(count<=0)return[];var range=sheet.getRange(startRow,1,count,contract_().Headers.length),values=range.getValues(),formats=range.getNumberFormats();return values.map(function(v,i){var o=objectFromRow_(contract_().Headers,v);o._physical_row_number=startRow+i;o._number_formats=formats[i].slice();o._physical_types=v.map(physicalType_);return o;});}
  function batchRows_(runId,phase){return readRowsForRun_(serviceSheets_().batches,BATCH_HEADERS,runId).filter(function(b){return text_(b.run_id)===text_(runId)&&(!phase||text_(b.phase)===phase);});}
  function appendBatch_(object){appendRows_(serviceSheets_().batches,BATCH_HEADERS,[object]);}
  function preplanPhase_(run){var request=loadRunRequest_(run),preplan=replayPlanner_(request,[],false),affected=uniqueSorted_(preplanAffectedVisibleSeries_(preplan,request).concat(request.current_effect_visible_series_keys||[]));if(!affected.length){run.status='SUCCESS';run.phase='SUCCESS';properties_().setProperty(ACTIVE_RUN_KEY,'');return saveRun_(run);}var target=targetSheet_();run.plan_id=text_(preplan.plan_id);run.plan_fingerprint=text_(preplan.fingerprint);run.affected_series_json=JSON.stringify(affected);run.target_grid_rows=target.getMaxRows();run.target_last_row=target.getLastRow();run.target_columns=target.getMaxColumns();run.target_header_format_fingerprint=hash_(target.getRange(1,1,1,contract_().Headers.length).getNumberFormats()[0]);run.phase='SCAN_TARGET';run.cursor=2;run.status='RUNNING';return saveRun_(run);}
  function scanPhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var affected=JSON.parse(run.affected_series_json||'[]'),affectedMap={},sheet=targetSheet_(),last=sheet.getLastRow();affected.forEach(function(k){affectedMap[k]=true;});var start=Math.max(2,Number(run.cursor||2)),count=Math.min(cfg.scan_chunk_rows,Math.max(0,last-start+1));if(!count){var scans=batchRows_(run.run_id,'SCAN_TARGET').filter(function(b){return text_(b.status)==='COMMITTED';}).sort(compareBy_(['start_cursor'])),acc=emptyAccumulator_();run.target_before_fingerprint=hash_(scans.map(function(b){return text_(b.before_target_fingerprint);}));scans.forEach(function(b){acc=combineAccumulators_(acc,JSON.parse(b.details_json||'{}').unrelated_accumulator||emptyAccumulator_());});run.unrelated_before_fingerprint=hash_(acc);run.phase='BUILD_PLAN';run.cursor=0;return saveRun_(run);}var batchId=batchId_(run.run_id,'SCAN_TARGET','SCAN',[String(start),String(start+count-1)]),existing=batchRows_(run.run_id,'SCAN_TARGET').filter(function(b){return text_(b.batch_id)===batchId&&text_(b.status)==='COMMITTED';})[0];if(existing){run.cursor=start+count;return saveRun_(run);}var rows=scanTargetRows_(sheet,start,count),cache=[],unrelated=emptyAccumulator_();rows.forEach(function(row){if(affectedMap[visibleSeriesKey_(row)]){var itemId='AGSCAN_'+hash_([run.run_id,storageKey_(row),rowFingerprint_(row)]).slice(0,24).toUpperCase();cache.push({run_id:run.run_id,item_id:itemId,record_kind:'SCAN',sequence_no:start,action:'',calculation_id:'',canonical_row_key:'',canonical_series_key:'',visible_series_key:visibleSeriesKey_(row),storage_key:storageKey_(row),physical_row_hint:row._physical_row_number,before_fingerprint:rowFingerprint_(row),after_fingerprint:'',before_json:JSON.stringify(row),after_json:'',input_fingerprint:'',result_artifact_id:'',result_sha256:'',result_fingerprint:'',result_rows_count:0,status:'CACHED',batch_id:batchId,attempt_count:1,last_error_code:'',updated_at:new Date().toISOString()});}else accumulateToken_(unrelated,storageKey_(row)+'|'+rowFingerprint_(row));});upsertQueueRows_(cache);appendBatch_({batch_id:batchId,run_id:run.run_id,phase:'SCAN_TARGET',action:'SCAN',start_cursor:start,end_cursor:start+count-1,item_count:count,request_fingerprint:run.request_fingerprint,before_target_fingerprint:hash_(rows.map(function(r){return String(r._physical_row_number)+'|'+storageKey_(r)+'|'+rowFingerprint_(r);})),after_target_fingerprint:'',status:'COMMITTED',started_at:new Date().toISOString(),finished_at:new Date().toISOString(),execution_id:'',error_code:'',details_json:JSON.stringify({cached_rows:cache.length,unrelated_accumulator:unrelated})});run.cursor=start+count;run.heartbeat_at=new Date().toISOString();return saveRun_(run);}
  function scanCacheRows_(run){return queueRowsForRun_(run,'SCAN').map(function(q){try{return JSON.parse(q.before_json);}catch(e){throw error_('ALPHA74_SCAN_CACHE_INVALID','Cached target row JSON is invalid.',{item_id:q.item_id});}});}
  function buildPlanPhase_(run){var request=loadRunRequest_(run),cache=scanCacheRows_(run),scan=canonicalTargetRows_(cache,request.definitions,request.membership_snapshot.rule_rows),plan=replayPlanner_(request,scan.rows,false),payload={schema_version:PLAN_SCHEMA,request_fingerprint:run.request_fingerprint,plan:plan};payload.fingerprint=hash_(payload);var stored=createArtifact_('ALPHA74_PLAN_'+run.run_id,payload),expected=(plan.calculator_batches||[]).map(function(b,i){return{item_id:calculationItemId_(run.run_id,b.calculation_id),calculation_id:b.calculation_id,input_fingerprint:hash_(hydrateCalculatorBatch_(b,plan.calculator_shared_input||{})),before_fingerprint:hash_(b),sequence_no:i+1};});run.plan_artifact_id=stored.file_id;run.plan_sha256=stored.sha256;run.plan_id=text_(plan.plan_id);run.plan_fingerprint=text_(plan.fingerprint);run.calculation_item_count=expected.length;run.calculation_item_digest=calculationSetDigest_(expected);run.phase='MATERIALIZE_CALC_QUEUE';run.cursor=0;return saveRun_(run);}
  function loadPlan_(run){var a=readArtifact_(run.plan_artifact_id,run.plan_sha256),p=a.parsed;if(text_(p.schema_version)!==PLAN_SCHEMA||text_(p.request_fingerprint)!==text_(run.request_fingerprint)||text_(p.fingerprint)!==hash_((function(){var x=clone_(p);delete x.fingerprint;return x;})()))throw error_('ALPHA74_PLAN_ARTIFACT_INVALID','Plan artifact failed binding/fingerprint validation.');return p.plan;}
  function planBatchIndex_(plan){var index={};(plan.calculator_batches||[]).forEach(function(b){if(index[text_(b.calculation_id)])throw error_('ALPHA74_CALCULATION_DUPLICATE_ITEM','Plan contains duplicate calculation_id.',{calculation_id:b.calculation_id});index[text_(b.calculation_id)]=b;});return index;}
  function materializeCalcQueuePhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var plan=loadPlan_(run),batches=(plan.calculator_batches||[]).slice().sort(compareBy_(['calculation_id'])),start=Number(run.cursor||0),slice=batches.slice(start,start+cfg.queue_write_rows).map(function(b,i){var hydrated=hydrateCalculatorBatch_(b,plan.calculator_shared_input||{});return{run_id:run.run_id,item_id:calculationItemId_(run.run_id,b.calculation_id),record_kind:'CALCULATION',sequence_no:start+i+1,action:'CALCULATE',calculation_id:b.calculation_id,canonical_row_key:'',canonical_series_key:'',visible_series_key:'',storage_key:'',physical_row_hint:0,before_fingerprint:hash_(b),after_fingerprint:'',before_json:'',after_json:'',input_fingerprint:hash_(hydrated),result_artifact_id:'',result_sha256:'',result_fingerprint:'',result_rows_count:0,status:'PENDING',batch_id:'',attempt_count:0,last_error_code:'',updated_at:new Date().toISOString()};});upsertQueueRows_(slice);run.cursor=start+slice.length;if(run.cursor>=batches.length){run.phase='CALCULATE_SLICES';run.cursor=0;}return saveRun_(run);}
  function expectedCalculationRows_(run,plan){return(plan.calculator_batches||[]).map(function(b,i){return{item_id:calculationItemId_(run.run_id,b.calculation_id),calculation_id:b.calculation_id,input_fingerprint:hash_(hydrateCalculatorBatch_(b,plan.calculator_shared_input||{})),before_fingerprint:hash_(b),sequence_no:i+1};});}
  function proveCalculationQueue_(run,requireComplete){var plan=loadPlan_(run),expected=expectedCalculationRows_(run,plan),actual=queueRowsForRun_(run,'CALCULATION');proveExactSet_(expected,actual,calculationBinding_,'ALPHA74_CALCULATION_QUEUE_INCOMPLETE');if(Number(run.calculation_item_count)!==expected.length||text_(run.calculation_item_digest)!==calculationSetDigest_(expected))throw error_('ALPHA74_CALCULATION_QUEUE_INCOMPLETE','Run calculation metadata differs from immutable plan.');if(requireComplete){actual.forEach(function(q){if(text_(q.status)!=='CALCULATED'||!text_(q.result_artifact_id)||!text_(q.result_sha256)||!text_(q.result_fingerprint))throw error_('ALPHA74_CALCULATION_RESULT_INCOMPLETE','Calculation item is not durably complete.',{item_id:q.item_id,status:q.status});var a=readArtifact_(q.result_artifact_id,q.result_sha256),fp=calculationResultFingerprint_(a.parsed.result);if(fp!==text_(q.result_fingerprint))throw error_('ALPHA74_CALCULATION_RESULT_INCOMPLETE','Calculation artifact fingerprint mismatch.',{item_id:q.item_id});});}return actual;}
  function calculateSlicesPhase_(run,startedMs,cfg){var plan=loadPlan_(run),index=planBatchIndex_(plan),queue=proveCalculationQueue_(run,false).sort(function(a,b){return Number(a.sequence_no)-Number(b.sequence_no);}),processed=0;for(var i=0;i<queue.length;i+=1){var q=queue[i];if(text_(q.status)==='CALCULATED')continue;var pause=shouldPause_(startedMs,Date.now(),cfg,'CALCULATION');if(pause.pause||processed>=cfg.calculation_items_per_worker){run.status='PAUSED';run.calculation_completed_count=queue.filter(function(x){return text_(x.status)==='CALCULATED';}).length;return saveRun_(run);}var batch=index[text_(q.calculation_id)];if(!batch)throw error_('ALPHA74_CALCULATION_QUEUE_INCOMPLETE','Queue calculation_id is absent from plan.',{calculation_id:q.calculation_id});var hydrated=hydrateCalculatorBatch_(batch,plan.calculator_shared_input||{});if(hash_(hydrated)!==text_(q.input_fingerprint)||hash_(batch)!==text_(q.before_fingerprint))throw error_('ALPHA74_CALCULATION_INPUT_MISMATCH','Calculation input differs from immutable plan.',{item_id:q.item_id});if(Number(q.attempt_count||0)>=Number(cfg.max_batch_attempts))throw error_('ALPHA74_RETRY_EXHAUSTED','Calculation item exhausted its retry limit.',{item_id:q.item_id,attempt_count:q.attempt_count,max_attempts:cfg.max_batch_attempts});q.status='CALCULATING';q.attempt_count=Number(q.attempt_count||0)+1;upsertQueueRows_([q]);var result=calculator_().calculateBatch(hydrated),rows=publishableRowsFromCalculation_(result),payload={schema_version:'ALPHA74_CALC_RESULT_V1',run_id:run.run_id,calculation_id:q.calculation_id,input_fingerprint:q.input_fingerprint,result:result,publishable_rows:rows};payload.result_fingerprint=calculationResultFingerprint_(result);payload.fingerprint=hash_(payload);var stored=createArtifact_('ALPHA74_CALC_'+run.run_id+'_'+q.calculation_id,payload),readback=readArtifact_(stored.file_id,stored.sha256).parsed;if(text_(readback.fingerprint)!==text_(payload.fingerprint))throw error_('ALPHA74_CALCULATION_RESULT_INCOMPLETE','Calculation artifact read-back mismatch.',{item_id:q.item_id});q.result_artifact_id=stored.file_id;q.result_sha256=stored.sha256;q.result_fingerprint=payload.result_fingerprint;q.result_rows_count=rows.length;q.status='CALCULATED';q.last_error_code='';upsertQueueRows_([q]);processed+=1;run.calculation_completed_count=Number(run.calculation_completed_count||0)+1;run.heartbeat_at=new Date().toISOString();saveRun_(run);}run.phase='VERIFY_CALC_SET';run.cursor=0;return saveRun_(run);}
  function verifyCalcSetPhase_(run){var rows=proveCalculationQueue_(run,true);run.calculation_completed_count=rows.length;run.phase='ASSEMBLE_MODEL';return saveRun_(run);}
  function calculationResults_(run){return proveCalculationQueue_(run,true).sort(function(a,b){return Number(a.sequence_no)-Number(b.sequence_no);}).map(function(q){return readArtifact_(q.result_artifact_id,q.result_sha256).parsed.result;});}
  function assembleModelPhase_(run){var request=loadRunRequest_(run),cache=scanCacheRows_(run),scan=canonicalTargetRows_(cache,request.definitions,request.membership_snapshot.rule_rows),base=loadPlan_(run),assembled=assembleCalculatedPlan_(base,calculationResults_(run),scan.rows,request.operation_kind==='REVERSAL'?request.current_effect_row_keys||[]:[]),model=buildMutationModel_(request,assembled,cache),stored=createArtifact_('ALPHA74_MODEL_'+run.run_id,model);run.model_artifact_id=stored.file_id;run.model_sha256=stored.sha256;run.model_item_digest=model.item_digest;run.mutation_item_count=model.item_count;run.mutation_item_digest=model.item_digest;run.mutation_completed_count=0;run.phase='MATERIALIZE_MUTATION_QUEUE';run.cursor=0;return saveRun_(run);}
  function loadModel_(run){var a=readArtifact_(run.model_artifact_id,run.model_sha256),m=a.parsed;if(text_(m.schema_version)!==MODEL_SCHEMA||text_(m.operation_id)!==text_(run.operation_id)||text_(m.request_fingerprint)!==text_(run.request_fingerprint)||text_(m.item_digest)!==mutationSetDigest_(m.items||[])||text_(m.fingerprint)!==hash_((function(){var c=clone_(m);delete c.fingerprint;return c;})()))throw error_('ALPHA74_MODEL_ARTIFACT_INVALID','Mutation model artifact failed binding/fingerprint validation.');return m;}
  function materializeMutationQueuePhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var model=loadModel_(run),items=model.items||[],start=Number(run.cursor||0),slice=items.slice(start,start+cfg.queue_write_rows).map(function(item,i){return{run_id:run.run_id,item_id:item.item_id,record_kind:'MUTATION',sequence_no:start+i+1,action:item.action,calculation_id:'',canonical_row_key:item.canonical_row_key,canonical_series_key:item.canonical_series_key,visible_series_key:item.visible_series_key,storage_key:item.storage_key,physical_row_hint:item.physical_row_hint,before_fingerprint:item.before_fingerprint,after_fingerprint:item.after_fingerprint,before_json:item.before?JSON.stringify(item.before):'',after_json:item.after?JSON.stringify(item.after):'',input_fingerprint:'',result_artifact_id:'',result_sha256:'',result_fingerprint:'',result_rows_count:0,status:item.action==='NOOP'?'APPLIED':'PENDING',batch_id:'',attempt_count:0,last_error_code:'',updated_at:new Date().toISOString()};});upsertQueueRows_(slice);run.cursor=start+slice.length;if(run.cursor>=items.length){run.phase='VERIFY_MODEL_QUEUE';run.cursor=0;}return saveRun_(run);}
  function modelItemIndex_(run){var model=loadModel_(run),index={};(model.items||[]).forEach(function(item){if(index[item.item_id])throw error_('ALPHA74_MODEL_DUPLICATE_ITEM','Mutation model contains duplicate item_id.',{item_id:item.item_id});index[item.item_id]=item;});return{model:model,index:index};}
  function proveMutationQueue_(run){var bound=modelItemIndex_(run),queue=queueRowsForRun_(run,'MUTATION'),expected=bound.model.items||[];proveExactSet_(expected,queue,mutationBinding_,'ALPHA74_QUEUE_MODEL_BINDING_MISMATCH');if(Number(run.mutation_item_count)!==expected.length||text_(run.mutation_item_digest)!==mutationSetDigest_(expected))throw error_('ALPHA74_QUEUE_MODEL_BINDING_MISMATCH','Run mutation metadata differs from immutable model.');queue.forEach(function(q){var m=bound.index[text_(q.item_id)],before=q.before_json?JSON.parse(q.before_json):null,after=q.after_json?JSON.parse(q.after_json):null;if(text_(q.record_kind)!=='MUTATION'||!ACTIONS[text_(q.action)]||text_(q.action)!==text_(m.action)||text_(q.canonical_row_key)!==text_(m.canonical_row_key)||text_(q.canonical_series_key)!==text_(m.canonical_series_key)||text_(q.storage_key)!==text_(m.storage_key)||text_(q.before_fingerprint)!==text_(m.before_fingerprint)||text_(q.after_fingerprint)!==text_(m.after_fingerprint)||canonicalJson_(before)!==canonicalJson_(m.before)||canonicalJson_(after)!==canonicalJson_(m.after))throw error_('ALPHA74_QUEUE_MODEL_BINDING_MISMATCH','Queue item differs from immutable model.',{item_id:q.item_id});});return queue;}
  function verifyModelQueuePhase_(run){proveMutationQueue_(run);run.phase='BACKUP_CREATE';return saveRun_(run);}
  function backupCreatePhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}proveMutationQueue_(run);createFullBackup_(run);run.phase='BACKUP_VERIFY';run.cursor=2;return saveRun_(run);}
  function backupVerifyPhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var sheet=backupTargetSheet_(run),last=sheet.getLastRow(),start=Math.max(2,Number(run.cursor||2)),count=Math.min(cfg.scan_chunk_rows,Math.max(0,last-start+1));if(!count){var batches=batchRows_(run.run_id,'BACKUP_VERIFY').filter(function(b){return text_(b.status)==='COMMITTED';}).sort(compareBy_(['start_cursor']));run.backup_fingerprint=hash_(batches.map(function(b){return text_(b.before_target_fingerprint);}));if(sheet.getMaxRows()!==Number(run.target_grid_rows)||sheet.getLastRow()!==Number(run.target_last_row)||sheet.getMaxColumns()!==Number(run.target_columns))throw error_('ALPHA74_BACKUP_GEOMETRY_MISMATCH','Backup geometry differs from target before-state.');if(hash_(sheet.getRange(1,1,1,contract_().Headers.length).getNumberFormats()[0])!==text_(run.target_header_format_fingerprint))throw error_('ALPHA74_BACKUP_HEADER_FORMAT_MISMATCH','Backup header format differs.');if(text_(run.backup_fingerprint)!==text_(run.target_before_fingerprint))throw error_('ALPHA74_BACKUP_FINGERPRINT_MISMATCH','Backup differs from target before-state.',{target:run.target_before_fingerprint,backup:run.backup_fingerprint});run.phase='BACKUP_CAPTURE';run.cursor=0;return saveRun_(run);}var batchId=batchId_(run.run_id,'BACKUP_VERIFY','SCAN',[String(start),String(start+count-1)]),existing=batchRows_(run.run_id,'BACKUP_VERIFY').filter(function(b){return text_(b.batch_id)===batchId&&text_(b.status)==='COMMITTED';})[0];if(existing){run.cursor=start+count;return saveRun_(run);}var rows=scanTargetRows_(sheet,start,count),fp=hash_(rows.map(function(r){return String(r._physical_row_number)+'|'+storageKey_(r)+'|'+rowFingerprint_(r);}));appendBatch_({batch_id:batchId,run_id:run.run_id,phase:'BACKUP_VERIFY',action:'SCAN',start_cursor:start,end_cursor:start+count-1,item_count:count,request_fingerprint:run.request_fingerprint,before_target_fingerprint:fp,after_target_fingerprint:'',status:'COMMITTED',started_at:new Date().toISOString(),finished_at:new Date().toISOString(),execution_id:'',error_code:'',details_json:JSON.stringify({backup_file_id:run.backup_file_id})});run.cursor=start+count;return saveRun_(run);}
  function backupCapturePhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}proveMutationQueue_(run);var pending=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)!=='NOOP';}).sort(compareBy_(['item_id'])),start=Number(run.cursor||0);if(text_(run.backup_fingerprint)!==text_(run.target_before_fingerprint))throw error_('ALPHA74_BACKUP_NOT_VERIFIED','Mutation is forbidden until backup is verified.');var slice=pending.slice(start,start+cfg.queue_write_rows),existing=readRowsForRun_(serviceSheets_().backup,BACKUP_HEADERS,run.run_id),idx={};existing.forEach(function(b){idx[text_(b.run_id)+'|'+text_(b.item_id)]=true;});var rows=[];slice.forEach(function(q){var key=run.run_id+'|'+q.item_id;if(!idx[key])rows.push({backup_id:'AGBACK_'+hash_(key).slice(0,24).toUpperCase(),run_id:run.run_id,item_id:q.item_id,action:q.action,canonical_row_key:q.canonical_row_key,physical_row_hint:q.physical_row_hint,before_fingerprint:q.before_fingerprint,before_json:q.before_json,status:'VERIFIED',created_at:new Date().toISOString(),restored_at:''});});appendRows_(serviceSheets_().backup,BACKUP_HEADERS,rows);run.cursor=start+slice.length;if(run.cursor>=pending.length){run.phase='APPLY_DELETE';run.cursor=0;}return saveRun_(run);}
  function sheetsApi_(){if(typeof Sheets==='undefined'||!Sheets.Spreadsheets||!Sheets.Spreadsheets.batchUpdate)throw error_('ALPHA74_ADVANCED_SHEETS_REQUIRED','Advanced Sheets service is required.');return Sheets;}
  function deleteHints_(runId){return queueRows_(runId,'MUTATION').filter(function(q){return text_(q.action)==='DELETE';}).map(function(q){return Number(q.physical_row_hint||0);}).filter(function(n){return n>=2;}).sort(function(a,b){return a-b;});}
  function adjustedAfterDeletes_(rowNumber,deleteHints){var row=Number(rowNumber||0),shift=0;(deleteHints||[]).forEach(function(h){if(h<row)shift+=1;});return row-shift;}
  function effectiveRow_(item,rollback,deleteHints){var action=text_(item.action),hint=Number(item.physical_row_hint||0);if(action==='INSERT'||action==='DELETE')return hint;return adjustedAfterDeletes_(hint,deleteHints);}
  function blankRow_(row){return contract_().Headers.every(function(h){return row[h]===null||row[h]===undefined||row[h]==='';});}
  function readPhysicalRow_(sheet,rowNumber){var n=Number(rowNumber||0);if(n<2||n>sheet.getLastRow())return null;var row=scanTargetRows_(sheet,n,1)[0];return blankRow_(row)?null:row;}
  function directCurrentForItem_(sheet,item,request,rollback,deleteHints){var n=effectiveRow_(item,rollback,deleteHints),row=readPhysicalRow_(sheet,n);if(!row)return null;try{var mapped=canonicalTargetRows_([row],request.definitions,request.membership_snapshot.rule_rows).rows[0];if(text_(mapped.aggregate_row_key)===text_(item.canonical_row_key))return mapped;}catch(ignore){}if(text_(item.action)==='DELETE'||(rollback===true&&text_(item.action)==='INSERT'))return null;return row;}
  function targetedCurrent_(sheet,items,request,rollback,deleteHints){var byKey={},rows=[];(items||[]).forEach(function(item){var current=directCurrentForItem_(sheet,item,request,rollback,deleteHints);if(current){byKey[item.canonical_row_key]=current;rows.push(current);}});return{by_key:byKey,rows:rows};}
  function assignInsertHints_(sheet,items){var next=sheet.getLastRow()+1,changed=[];(items||[]).forEach(function(q){if(text_(q.action)==='INSERT'&&!Number(q.physical_row_hint||0)){q.physical_row_hint=next++;changed.push(q);}});if(changed.length)upsertQueueRows_(changed);return items;}
  function targetedFingerprint_(items,currentByKey){return hash_((items||[]).map(function(i){var r=currentByKey[i.canonical_row_key]||null;return i.item_id+'|'+(r?rowFingerprint_(r):'ABSENT');}).sort());}
  function physicalBatchRequests_(sheet,items,scan,rollback,deleteHints){var headers=contract_().Headers,requests=[],sheetId=sheet.getSheetId(),deletes=[],updates=[],inserts=[],rollbackInserts=[];(items||[]).forEach(function(q){var original=text_(q.action),action=original,before=q.before_json?JSON.parse(q.before_json):null,after=q.after_json?JSON.parse(q.after_json):null,current=scan.by_key[q.canonical_row_key]||null;if(rollback){if(action==='INSERT')action='DELETE';else if(action==='DELETE')action='INSERT';else action='UPDATE';var tmp=before;before=after;after=tmp;}var rowNumber=effectiveRow_(q,rollback,deleteHints);if(action==='DELETE'){if(current)deletes.push({row:rowNumber,q:q});}else if(action==='INSERT'){if(rollback&&original==='DELETE')rollbackInserts.push({row:after,q:q,originalRow:rowNumber});else inserts.push({row:after,q:q,rowNumber:rowNumber});}else{if(!current)throw error_('ALPHA74_TARGET_ROW_MISSING','Update target is missing.',{item_id:q.item_id});updates.push({rowNumber:rowNumber,row:after,q:q});}});deletes.sort(function(a,b){return b.row-a.row;}).forEach(function(x){requests.push({deleteDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:x.row-1,endIndex:x.row}}});});if(deletes.length)requests.push({appendDimension:{sheetId:sheetId,dimension:'ROWS',length:deletes.length}});updates.forEach(function(x){requests.push({updateCells:{start:{sheetId:sheetId,rowIndex:x.rowNumber-1,columnIndex:0},rows:[updateCellsRow_(headers,x.row,true)],fields:'userEnteredValue,userEnteredFormat.numberFormat'}});});rollbackInserts.sort(function(a,b){return a.originalRow-b.originalRow;}).forEach(function(x){requests.push({insertDimension:{range:{sheetId:sheetId,dimension:'ROWS',startIndex:x.originalRow-1,endIndex:x.originalRow},inheritFromBefore:true}});requests.push({updateCells:{start:{sheetId:sheetId,rowIndex:x.originalRow-1,columnIndex:0},rows:[updateCellsRow_(headers,x.row,true)],fields:'userEnteredValue,userEnteredFormat.numberFormat'}});});if(inserts.length){var maxDest=Math.max.apply(null,inserts.map(function(x){return x.rowNumber;})),needed=maxDest-sheet.getMaxRows();if(needed>0)requests.push({appendDimension:{sheetId:sheetId,dimension:'ROWS',length:needed}});inserts.forEach(function(x){var rowIndex=x.rowNumber-1,templateOriginal=Number(x.row&&x.row._template_physical_row_number||0),templateRow=adjustedAfterDeletes_(templateOriginal,deleteHints);if(templateRow>=2)requests.push({copyPaste:{source:{sheetId:sheetId,startRowIndex:templateRow-1,endRowIndex:templateRow,startColumnIndex:0,endColumnIndex:headers.length},destination:{sheetId:sheetId,startRowIndex:rowIndex,endRowIndex:rowIndex+1,startColumnIndex:0,endColumnIndex:headers.length},pasteType:'PASTE_FORMAT',pasteOrientation:'NORMAL'}});requests.push({updateCells:{start:{sheetId:sheetId,rowIndex:rowIndex,columnIndex:0},rows:[updateCellsRow_(headers,x.row)],fields:'userEnteredValue'}});});}return requests;}
  function updateQueueStatuses_(rows,status,batchId,errorCode){(rows||[]).forEach(function(q){q.status=status;q.batch_id=batchId||q.batch_id;q.last_error_code=errorCode||'';});upsertQueueRows_(rows);}
  function markQueueAttempt_(rows,batchId,cfg){(rows||[]).forEach(function(q){if(Number(q.attempt_count||0)>=Number(cfg.max_batch_attempts))throw error_('ALPHA74_RETRY_EXHAUSTED','Durable item exhausted its retry limit.',{item_id:q.item_id,attempt_count:q.attempt_count,max_attempts:cfg.max_batch_attempts});q.attempt_count=Number(q.attempt_count||0)+1;q.batch_id=batchId||q.batch_id;});upsertQueueRows_(rows);}
  function attemptedItemIds_(runId,phase,action){var out={};batchRows_(runId,phase).forEach(function(b){if(text_(b.action)!==text_(action))return;var d=JSON.parse(b.details_json||'{}');(d.item_ids||[]).forEach(function(id){out[text_(id)]=true;});});return out;}
  function refreshAppliedCount_(run){run.mutation_completed_count=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.status)==='APPLIED';}).length;return run;}
  function mutationSort_(action){if(action==='DELETE')return function(a,b){return Number(b.physical_row_hint||0)-Number(a.physical_row_hint||0);};return compareBy_(['item_id']);}
  function processMutationPhase_(run,startedMs,cfg,action,phase,nextPhase){var pause=shouldPause_(startedMs,Date.now(),cfg,'WRITE');if(pause.pause){run.status='PAUSED';return saveRun_(run);}proveMutationQueue_(run);if(text_(run.backup_fingerprint)!==text_(run.target_before_fingerprint))throw error_('ALPHA74_BACKUP_NOT_VERIFIED','Mutation is forbidden until backup is verified.');var request=loadRunRequest_(run),pending=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)===action&&text_(q.status)!=='APPLIED';}).sort(mutationSort_(action));if(!pending.length){run.phase=nextPhase;return saveRun_(refreshAppliedCount_(run));}var items=pending.slice(0,cfg.mutation_batch_rows),sheet=targetSheet_(),deleteHints=deleteHints_(run.run_id);if(action==='INSERT')items=assignInsertHints_(sheet,items);var scan=targetedCurrent_(sheet,items,request,false,deleteHints),attempted=attemptedItemIds_(run.run_id,phase,action),before=[],after=[],third=[];items.forEach(function(item){var state=classifyItemState_(item,scan.by_key[item.canonical_row_key]||null);if(state==='BEFORE')before.push(item);else if(state==='AFTER')after.push(item);else third.push(item);});if(third.length)throw error_('ALPHA74_PREWRITE_DRIFT','Mutation contains third state.',{item_ids:third.map(function(x){return x.item_id;})});var unexplained=after.filter(function(x){return!attempted[x.item_id];});if(unexplained.length)throw error_('ALPHA74_PREAPPLIED_WITHOUT_ATTEMPT','After-state exists without durable prior batch.',{item_ids:unexplained.map(function(x){return x.item_id;})});if(after.length)updateQueueStatuses_(after,'APPLIED','RECOVERED_BY_READBACK','');if(!before.length)return saveRun_(refreshAppliedCount_(run));items=before;var ids=items.map(function(x){return x.item_id;}),batchId=batchId_(run.run_id,phase,action,ids),beforeScan=targetedCurrent_(sheet,items,request,false,deleteHints),pre=classifyBatchOutcome_(items,beforeScan.by_key);if(pre.status!=='RETRY_SAFE')throw error_('ALPHA74_PREWRITE_DRIFT','Batch is not in exact before-state.',{batch_id:batchId,outcome:pre});var requests=physicalBatchRequests_(sheet,items,beforeScan,false,deleteHints),batch={batch_id:batchId,run_id:run.run_id,phase:phase,action:action,start_cursor:0,end_cursor:items.length-1,item_count:items.length,request_fingerprint:run.request_fingerprint,before_target_fingerprint:targetedFingerprint_(items,beforeScan.by_key),after_target_fingerprint:'',status:'PREPARED',started_at:new Date().toISOString(),finished_at:'',execution_id:'',error_code:'',details_json:JSON.stringify({item_ids:ids})};appendBatch_(batch);markQueueAttempt_(items,batchId,cfg);var thrown=null;try{sheetsApi_().Spreadsheets.batchUpdate({requests:requests},publishSpreadsheet_().getId());}catch(e){thrown=e;}SpreadsheetApp.flush();var afterScan=targetedCurrent_(targetSheet_(),items,request,false,deleteHints),outcome=classifyBatchOutcome_(items,afterScan.by_key);batch.after_target_fingerprint=targetedFingerprint_(items,afterScan.by_key);batch.finished_at=new Date().toISOString();batch.status=outcome.status;batch.error_code=thrown?text_(thrown.message||thrown):'';appendBatch_(batch);if(outcome.status==='COMMITTED'){updateQueueStatuses_(items,'APPLIED',batchId,'');return saveRun_(refreshAppliedCount_(run));}if(outcome.status==='RETRY_SAFE')return saveRun_(run);throw error_('ALPHA74_AMBIGUOUS_WRITE','Target read-back is mixed or unknown.',{batch_id:batchId,outcome:outcome});}
  function verifyAffectedPhase_(run,startedMs,cfg){proveMutationQueue_(run);var request=loadRunRequest_(run),items=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)!=='NOOP';}).sort(compareBy_(['sequence_no'])),start=Number(run.verification_cursor||0),slice=items.slice(start,start+cfg.verification_item_rows);if(!slice.length){run.phase='VERIFY_UNRELATED';run.verification_cursor=2;run.verification_accumulator_json=JSON.stringify(emptyAccumulator_());return saveRun_(run);}var scan=targetedCurrent_(targetSheet_(),slice,request,false,deleteHints_(run.run_id)),outcome=classifyBatchOutcome_(slice,scan.by_key);if(outcome.status!=='COMMITTED')throw error_('ALPHA74_AFFECTED_VERIFY_MISMATCH','Affected verification failed.',{outcome:outcome,start:start});run.verification_cursor=start+slice.length;return saveRun_(run);}
  function verifyUnrelatedPhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var affected=JSON.parse(run.affected_series_json||'[]'),sheet=targetSheet_(),last=sheet.getLastRow(),start=Math.max(2,Number(run.verification_cursor||2)),count=Math.min(cfg.verification_chunk_rows,Math.max(0,last-start+1)),acc=run.verification_accumulator_json?JSON.parse(run.verification_accumulator_json):emptyAccumulator_();if(!count){run.unrelated_after_fingerprint=hash_(acc);if(text_(run.unrelated_after_fingerprint)!==text_(run.unrelated_before_fingerprint))throw error_('ALPHA74_UNRELATED_DRIFT','Unrelated aggregate scope changed.',{before:run.unrelated_before_fingerprint,after:run.unrelated_after_fingerprint});run.phase='VERIFY_GEOMETRY';run.verification_cursor=0;return saveRun_(run);}acc=combineAccumulators_(acc,unrelatedAccumulator_(scanTargetRows_(sheet,start,count),affected));run.verification_accumulator_json=JSON.stringify(acc);run.verification_cursor=start+count;return saveRun_(run);}
  function verifyGeometryPhase_(run){proveMutationQueue_(run);var sheet=targetSheet_(),queue=queueRowsForRun_(run,'MUTATION'),inserts=queue.filter(function(q){return text_(q.action)==='INSERT';}).length,deletes=queue.filter(function(q){return text_(q.action)==='DELETE';}).length,expectedLast=Number(run.target_last_row)+inserts-deletes,expectedMax=Math.max(Number(run.target_grid_rows),expectedLast);if(sheet.getLastRow()!==expectedLast||sheet.getMaxRows()!==expectedMax||sheet.getMaxColumns()!==Number(run.target_columns))throw error_('ALPHA74_GEOMETRY_DRIFT','Target geometry differs from deterministic after-state.',{expected:{last_row:expectedLast,max_rows:expectedMax,max_columns:run.target_columns},actual:{last_row:sheet.getLastRow(),max_rows:sheet.getMaxRows(),max_columns:sheet.getMaxColumns()}});if(hash_(sheet.getRange(1,1,1,contract_().Headers.length).getNumberFormats()[0])!==text_(run.target_header_format_fingerprint))throw error_('ALPHA74_GEOMETRY_DRIFT','Header number format changed.');var incomplete=queue.filter(function(q){return text_(q.status)!=='APPLIED';});if(incomplete.length)throw error_('ALPHA74_QUEUE_INCOMPLETE','Mutation queue contains incomplete items.',{item_ids:incomplete.map(function(q){return q.item_id;})});run.target_after_grid_rows=sheet.getMaxRows();run.status='SUCCESS';run.phase='SUCCESS';run.mutation_completed_count=queue.length;properties_().setProperty(ACTIVE_RUN_KEY,'');return saveRun_(run);}
  function rollbackSort_(action){if(action==='INSERT')return function(a,b){return Number(b.physical_row_hint||0)-Number(a.physical_row_hint||0);};if(action==='DELETE')return function(a,b){return Number(a.physical_row_hint||0)-Number(b.physical_row_hint||0);};return compareBy_(['item_id']);}
  function processRollbackPhase_(run,startedMs,cfg,originalAction,phase,nextPhase){var pause=shouldPause_(startedMs,Date.now(),cfg,'WRITE');if(pause.pause){run.status='PAUSED';return saveRun_(run);}proveMutationQueue_(run);var request=loadRunRequest_(run),pending=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)===originalAction&&text_(q.action)!=='NOOP'&&text_(q.status)!=='ROLLED_BACK';}).sort(rollbackSort_(originalAction));if(!pending.length){run.phase=nextPhase;return saveRun_(run);}var items=pending.slice(0,cfg.mutation_batch_rows),sheet=targetSheet_(),deleteHints=deleteHints_(run.run_id),scan=targetedCurrent_(sheet,items,request,true,deleteHints),restored=[],needs=[],third=[];items.forEach(function(item){var state=classifyItemState_(item,scan.by_key[item.canonical_row_key]||null);if(state==='BEFORE')restored.push(item);else if(state==='AFTER')needs.push(item);else third.push(item);});if(third.length)throw error_('ALPHA74_ROLLBACK_CONFLICT','Rollback would overwrite a third state.',{item_ids:third.map(function(x){return x.item_id;})});if(restored.length)updateQueueStatuses_(restored,'ROLLED_BACK','ALREADY_RESTORED','');if(!needs.length)return saveRun_(run);items=needs;var ids=items.map(function(x){return x.item_id;}),batchId=batchId_(run.run_id,phase,'ROLLBACK_'+originalAction,ids),beforeScan=targetedCurrent_(sheet,items,request,true,deleteHints),pre=classifyRollbackOutcome_(items,beforeScan.by_key);if(pre.status!=='RETRY_SAFE')throw error_('ALPHA74_ROLLBACK_CONFLICT','Rollback batch is not in operation after-state.',{batch_id:batchId,outcome:pre});var requests=physicalBatchRequests_(sheet,items,beforeScan,true,deleteHints),batch={batch_id:batchId,run_id:run.run_id,phase:phase,action:'ROLLBACK_'+originalAction,start_cursor:0,end_cursor:items.length-1,item_count:items.length,request_fingerprint:run.request_fingerprint,before_target_fingerprint:targetedFingerprint_(items,beforeScan.by_key),after_target_fingerprint:'',status:'PREPARED',started_at:new Date().toISOString(),finished_at:'',execution_id:'',error_code:'',details_json:JSON.stringify({item_ids:ids})};appendBatch_(batch);markQueueAttempt_(items,batchId,cfg);var thrown=null;try{sheetsApi_().Spreadsheets.batchUpdate({requests:requests},publishSpreadsheet_().getId());}catch(e){thrown=e;}SpreadsheetApp.flush();var afterScan=targetedCurrent_(targetSheet_(),items,request,true,deleteHints),outcome=classifyRollbackOutcome_(items,afterScan.by_key);batch.after_target_fingerprint=targetedFingerprint_(items,afterScan.by_key);batch.finished_at=new Date().toISOString();batch.status=outcome.status;batch.error_code=thrown?text_(thrown.message||thrown):'';appendBatch_(batch);if(outcome.status==='RESTORED'){updateQueueStatuses_(items,'ROLLED_BACK',batchId,'');return saveRun_(run);}if(outcome.status==='RETRY_SAFE')return saveRun_(run);throw error_('ALPHA74_ROLLBACK_CONFLICT','Rollback read-back is ambiguous.',{batch_id:batchId,outcome:outcome});}
  function rollbackPrecheckAffectedPhase_(run,startedMs,cfg){proveMutationQueue_(run);var request=loadRunRequest_(run),items=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)!=='NOOP';}).sort(compareBy_(['sequence_no'])),start=Number(run.rollback_cursor||0),slice=items.slice(start,start+cfg.verification_item_rows);if(!slice.length){run.phase='ROLLBACK_PRECHECK_UNRELATED';run.rollback_cursor=2;run.rollback_accumulator_json=JSON.stringify(emptyAccumulator_());return saveRun_(run);}var scan=targetedCurrent_(targetSheet_(),slice,request,true,deleteHints_(run.run_id)),third=[];slice.forEach(function(item){if(classifyItemState_(item,scan.by_key[item.canonical_row_key]||null)==='THIRD')third.push(item.item_id);});if(third.length)throw error_('ALPHA74_ROLLBACK_CONFLICT','Rollback precheck found third state.',{item_ids:third});run.rollback_cursor=start+slice.length;return saveRun_(run);}
  function rollbackUnrelatedScanPhase_(run,startedMs,cfg,nextPhase,code){var pause=shouldPause_(startedMs,Date.now(),cfg,'GENERAL');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var affected=JSON.parse(run.affected_series_json||'[]'),sheet=targetSheet_(),last=sheet.getLastRow(),start=Math.max(2,Number(run.rollback_cursor||2)),count=Math.min(cfg.verification_chunk_rows,Math.max(0,last-start+1)),acc=run.rollback_accumulator_json?JSON.parse(run.rollback_accumulator_json):emptyAccumulator_();if(!count){var fp=hash_(acc);if(text_(fp)!==text_(run.unrelated_before_fingerprint))throw error_(code,'Rollback unrelated-scope verification failed.',{before:run.unrelated_before_fingerprint,current:fp});run.phase=nextPhase;run.rollback_cursor=0;return saveRun_(run);}acc=combineAccumulators_(acc,unrelatedAccumulator_(scanTargetRows_(sheet,start,count),affected));run.rollback_accumulator_json=JSON.stringify(acc);run.rollback_cursor=start+count;return saveRun_(run);}
  function rollbackPrecheckGeometryPhase_(run){var sheet=targetSheet_();if(sheet.getMaxColumns()!==Number(run.target_columns)||hash_(sheet.getRange(1,1,1,contract_().Headers.length).getNumberFormats()[0])!==text_(run.target_header_format_fingerprint))throw error_('ALPHA74_ROLLBACK_CONFLICT','Rollback geometry/header precheck failed.');run.phase='ROLLBACK_DELETE_INSERTS';run.rollback_cursor=0;return saveRun_(run);}
  function rollbackTrimGridPhase_(run,startedMs,cfg){var pause=shouldPause_(startedMs,Date.now(),cfg,'WRITE');if(pause.pause){run.status='PAUSED';return saveRun_(run);}var sheet=targetSheet_(),expected=Number(run.target_grid_rows),current=sheet.getMaxRows(),last=sheet.getLastRow(),requests=[];if(last>expected)throw error_('ALPHA74_ROLLBACK_CONFLICT','Data exists below original maxRows.',{last_row:last,original_max_rows:expected});if(current>expected)requests.push({deleteDimension:{range:{sheetId:sheet.getSheetId(),dimension:'ROWS',startIndex:expected,endIndex:current}}});else if(current<expected)requests.push({appendDimension:{sheetId:sheet.getSheetId(),dimension:'ROWS',length:expected-current}});if(requests.length){sheetsApi_().Spreadsheets.batchUpdate({requests:requests},publishSpreadsheet_().getId());SpreadsheetApp.flush();}run.phase='ROLLBACK_VERIFY_AFFECTED';run.rollback_cursor=0;return saveRun_(run);}
  function rollbackVerifyAffectedPhase_(run,startedMs,cfg){proveMutationQueue_(run);var request=loadRunRequest_(run),items=queueRowsForRun_(run,'MUTATION').filter(function(q){return text_(q.action)!=='NOOP';}).sort(compareBy_(['sequence_no'])),start=Number(run.rollback_cursor||0),slice=items.slice(start,start+cfg.verification_item_rows);if(!slice.length){run.phase='ROLLBACK_VERIFY_UNRELATED';run.rollback_cursor=2;run.rollback_accumulator_json=JSON.stringify(emptyAccumulator_());return saveRun_(run);}var scan=targetedCurrent_(targetSheet_(),slice,request,true,[]),outcome=classifyRollbackOutcome_(slice,scan.by_key);if(outcome.status!=='RESTORED')throw error_('ALPHA74_ROLLBACK_VERIFY_MISMATCH','Rollback affected verification failed.',{outcome:outcome});run.rollback_cursor=start+slice.length;return saveRun_(run);}
  function rollbackVerifyGeometryPhase_(run){var sheet=targetSheet_();if(sheet.getMaxRows()!==Number(run.target_grid_rows)||sheet.getLastRow()!==Number(run.target_last_row)||sheet.getMaxColumns()!==Number(run.target_columns))throw error_('ALPHA74_ROLLBACK_GEOMETRY_MISMATCH','Rollback did not restore exact geometry.');if(hash_(sheet.getRange(1,1,1,contract_().Headers.length).getNumberFormats()[0])!==text_(run.target_header_format_fingerprint))throw error_('ALPHA74_ROLLBACK_GEOMETRY_MISMATCH','Rollback did not restore header format.');run.status='ROLLBACK_COMPLETE';run.phase='ROLLBACK_COMPLETE';properties_().setProperty(ACTIVE_RUN_KEY,'');return saveRun_(run);}
  function resumeRun(runId){return withLock_(function(){assertDev_();assertEnabled_();var run=findRun_(runId).row;if(!run)throw error_('ALPHA74_RUN_NOT_FOUND','Run not found.',{run_id:runId});if(text_(run.status)!=='FAILED')throw error_('ALPHA74_RESUME_STATE_INVALID','Only non-ambiguous FAILED may resume.',{status:run.status});run.status='PAUSED';run.worker_generation=Number(run.worker_generation||0)+1;run.no_progress_count=0;run.last_error_code='';run.last_error_message='';properties_().setProperty(ACTIVE_RUN_KEY,run.run_id);return saveRun_(run);});}
  function startRollback(runId){return withLock_(function(){assertDev_();assertEnabled_();var run=findRun_(runId).row;if(!run)throw error_('ALPHA74_RUN_NOT_FOUND','Run not found.',{run_id:runId});if(['SUCCESS','FAILED','FAILED_REQUIRES_REVIEW'].indexOf(text_(run.status))<0)throw error_('ALPHA74_ROLLBACK_STATE_INVALID','Rollback may start only from terminal forward state.',{status:run.status});if(!text_(run.backup_file_id)||text_(run.backup_fingerprint)!==text_(run.target_before_fingerprint))throw error_('ALPHA74_ROLLBACK_BACKUP_MISSING','Verified backup is missing.');run.status='RUNNING';run.phase='ROLLBACK_PRECHECK_AFFECTED';run.rollback_cursor=0;run.rollback_accumulator_json='';properties_().setProperty(ACTIVE_RUN_KEY,run.run_id);return saveRun_(run);});}
  function processRun_(run,startedMs,cfg){run.status='RUNNING';run.attempt_count=Number(run.attempt_count||0)+1;run.heartbeat_at=new Date().toISOString();saveRun_(run);if(run.phase==='PREPLAN')return preplanPhase_(run);if(run.phase==='SCAN_TARGET')return scanPhase_(run,startedMs,cfg);if(run.phase==='BUILD_PLAN')return buildPlanPhase_(run);if(run.phase==='MATERIALIZE_CALC_QUEUE')return materializeCalcQueuePhase_(run,startedMs,cfg);if(run.phase==='CALCULATE_SLICES')return calculateSlicesPhase_(run,startedMs,cfg);if(run.phase==='VERIFY_CALC_SET')return verifyCalcSetPhase_(run);if(run.phase==='ASSEMBLE_MODEL')return assembleModelPhase_(run);if(run.phase==='MATERIALIZE_MUTATION_QUEUE')return materializeMutationQueuePhase_(run,startedMs,cfg);if(run.phase==='VERIFY_MODEL_QUEUE')return verifyModelQueuePhase_(run);if(run.phase==='BACKUP_CREATE')return backupCreatePhase_(run,startedMs,cfg);if(run.phase==='BACKUP_VERIFY')return backupVerifyPhase_(run,startedMs,cfg);if(run.phase==='BACKUP_CAPTURE')return backupCapturePhase_(run,startedMs,cfg);if(run.phase==='APPLY_DELETE')return processMutationPhase_(run,startedMs,cfg,'DELETE','APPLY_DELETE','APPLY_UPDATE');if(run.phase==='APPLY_UPDATE')return processMutationPhase_(run,startedMs,cfg,'UPDATE','APPLY_UPDATE','APPLY_INSERT');if(run.phase==='APPLY_INSERT')return processMutationPhase_(run,startedMs,cfg,'INSERT','APPLY_INSERT','APPLY_LATEST');if(run.phase==='APPLY_LATEST')return processMutationPhase_(run,startedMs,cfg,'LATEST','APPLY_LATEST','VERIFY_AFFECTED');if(run.phase==='VERIFY_AFFECTED')return verifyAffectedPhase_(run,startedMs,cfg);if(run.phase==='VERIFY_UNRELATED')return verifyUnrelatedPhase_(run,startedMs,cfg);if(run.phase==='VERIFY_GEOMETRY')return verifyGeometryPhase_(run);if(run.phase==='ROLLBACK_PRECHECK_AFFECTED')return rollbackPrecheckAffectedPhase_(run,startedMs,cfg);if(run.phase==='ROLLBACK_PRECHECK_UNRELATED')return rollbackUnrelatedScanPhase_(run,startedMs,cfg,'ROLLBACK_PRECHECK_GEOMETRY','ALPHA74_ROLLBACK_CONFLICT');if(run.phase==='ROLLBACK_PRECHECK_GEOMETRY')return rollbackPrecheckGeometryPhase_(run);if(run.phase==='ROLLBACK_DELETE_INSERTS')return processRollbackPhase_(run,startedMs,cfg,'INSERT','ROLLBACK_DELETE_INSERTS','ROLLBACK_RESTORE_UPDATES');if(run.phase==='ROLLBACK_RESTORE_UPDATES'){var updates=queueRowsForRun_(run,'MUTATION').some(function(q){return(text_(q.action)==='UPDATE'||text_(q.action)==='LATEST')&&text_(q.status)!=='ROLLED_BACK';});if(updates){var action=queueRowsForRun_(run,'MUTATION').some(function(q){return text_(q.action)==='UPDATE'&&text_(q.status)!=='ROLLED_BACK';})?'UPDATE':'LATEST';return processRollbackPhase_(run,startedMs,cfg,action,'ROLLBACK_RESTORE_UPDATES','ROLLBACK_RESTORE_UPDATES');}run.phase='ROLLBACK_REINSERT_DELETES';return saveRun_(run);}if(run.phase==='ROLLBACK_REINSERT_DELETES')return processRollbackPhase_(run,startedMs,cfg,'DELETE','ROLLBACK_REINSERT_DELETES','ROLLBACK_TRIM_GRID');if(run.phase==='ROLLBACK_TRIM_GRID')return rollbackTrimGridPhase_(run,startedMs,cfg);if(run.phase==='ROLLBACK_VERIFY_AFFECTED')return rollbackVerifyAffectedPhase_(run,startedMs,cfg);if(run.phase==='ROLLBACK_VERIFY_UNRELATED')return rollbackUnrelatedScanPhase_(run,startedMs,cfg,'ROLLBACK_VERIFY_GEOMETRY','ALPHA74_ROLLBACK_VERIFY_MISMATCH');if(run.phase==='ROLLBACK_VERIFY_GEOMETRY')return rollbackVerifyGeometryPhase_(run);return run;}
  function nextRunnableRun_(){var active=text_(properties_().getProperty(ACTIVE_RUN_KEY));if(active){var run=findRun_(active).row;if(run&&!TERMINAL[text_(run.status)])return run;}var rows=readTable_(serviceSheets_().runs,RUN_HEADERS).filter(function(r){return!TERMINAL[text_(r.status)]&&['QUEUED','RUNNING','PAUSED'].indexOf(text_(r.status))>=0;}).sort(compareBy_(['started_at','run_id']));if(rows.length)properties_().setProperty(ACTIVE_RUN_KEY,rows[0].run_id);return rows.length?rows[0]:null;}
  function dispatcherWorker(options){return withLock_(function(){assertDev_();assertEnabled_();var cfg=config_(options||{}),started=Date.now(),run=nextRunnableRun_(),iterations=0;if(!run)return{ok:true,status:'IDLE'};try{var result=run,previous='';while(!TERMINAL[text_(result.status)]&&iterations<100){var pause=shouldPause_(started,Date.now(),cfg,'GENERAL');if(pause.pause){result.status='PAUSED';saveRun_(result);break;}previous=[result.phase,result.cursor,result.calculation_cursor,result.verification_cursor,result.rollback_cursor,result.calculation_completed_count,result.mutation_completed_count].join('|');result=processRun_(result,started,cfg);iterations+=1;if(text_(result.status)==='PAUSED'||TERMINAL[text_(result.status)])break;var current=[result.phase,result.cursor,result.calculation_cursor,result.verification_cursor,result.rollback_cursor,result.calculation_completed_count,result.mutation_completed_count].join('|');if(current===previous){result.no_progress_count=Number(result.no_progress_count||0)+1;saveRun_(result);if(result.no_progress_count>=cfg.max_no_progress)throw error_('ALPHA74_NO_PROGRESS','Dispatcher made no durable progress.',{phase:result.phase});break;}result.no_progress_count=0;saveRun_(result);}return{ok:true,status:text_(result.status),phase:text_(result.phase),run_id:result.run_id,calculations_completed:Number(result.calculation_completed_count||0),mutations_completed:Number(result.mutation_completed_count||0),iterations:iterations};}catch(e){run=findRun_(run.run_id).row||run;run.last_error_code=text_(e.code||'ALPHA74_UNEXPECTED');run.last_error_message=text_(e.message||e);run.status=/AMBIGUOUS|DRIFT|QUEUE_|ROLLBACK_CONFLICT|MODEL_ARTIFACT|CALCULATION_RESULT_INCOMPLETE/.test(run.last_error_code)?'FAILED_REQUIRES_REVIEW':'FAILED';saveRun_(run);return{ok:false,status:run.status,phase:run.phase,run_id:run.run_id,error:{code:run.last_error_code,message:run.last_error_message,details:e.details||{}}};}});}
  function startDispatcher(){return withLock_(function(){assertDev_();assertEnabled_();var triggers=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()===DISPATCHER_FUNCTION;});if(!triggers.length)triggers=[ScriptApp.newTrigger(DISPATCHER_FUNCTION).timeBased().everyMinutes(config_({}).dispatcher_minutes).create()];if(triggers.length>1)triggers.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});return{ok:true,status:'STARTED_OR_ALREADY_RUNNING',trigger_count:1,function_name:DISPATCHER_FUNCTION};});}
  function stopDispatcher(){return withLock_(function(){assertDev_();var deleted=0;ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===DISPATCHER_FUNCTION){ScriptApp.deleteTrigger(t);deleted+=1;}});properties_().setProperty(ENABLED_KEY,'false');return{ok:true,status:'STOPPED',deleted_triggers:deleted};});}
  function status(){assertDev_();var ss=controlSpreadsheet_(),sheet=ss.getSheetByName(TABLES.RUNS);if(!sheet)return{ok:true,status:'NOT_INSTALLED',release:RELEASE,version:VERSION};var active=text_(properties_().getProperty(ACTIVE_RUN_KEY)),run=active?findRun_(active).row:null;return{ok:true,status:'STATUS',release:RELEASE,version:VERSION,acceptance_status:ACCEPTANCE_STATUS,execution_enabled:enabled_(),active_run:run?{run_id:run.run_id,status:run.status,phase:run.phase,calculation_completed_count:Number(run.calculation_completed_count||0),calculation_item_count:Number(run.calculation_item_count||0),mutation_completed_count:Number(run.mutation_completed_count||0),mutation_item_count:Number(run.mutation_item_count||0),heartbeat_at:run.heartbeat_at,last_error_code:run.last_error_code}:null,tables:clone_(TABLES)};}
  function buildPure(request,targetRows,overridePlanner){var pre=replayPlanner_(request,[],false,overridePlanner),affected=uniqueSorted_(preplanAffectedVisibleSeries_(pre,request).concat(request.current_effect_visible_series_keys||[])),subset=(targetRows||[]).filter(function(r){return affected.indexOf(visibleSeriesKey_(r))>=0;}),scan=canonicalTargetRows_(subset,request.definitions,request.membership_snapshot.rule_rows),plan=replayPlanner_(request,scan.rows,false,overridePlanner);return{preplan:pre,affected_visible_series:affected,plan:plan,scan:scan};}
  function statusSummary(){return{release_candidate:RELEASE,version:VERSION,mode:MODE,acceptance_status:ACCEPTANCE_STATUS,accepted_base_tag:ACCEPTED_BASE_TAG,accepted_base_commit:ACCEPTED_BASE_COMMIT,target_sheet:TARGET_SHEET,service_tables:clone_(TABLES),execution_enabled_default:false,operation_kinds:Object.keys(OPERATION_KINDS),actions:Object.keys(ACTIONS),timeout_model:'DURABLE_CALCULATION_QUEUE_CHUNKED_VERIFICATION_READBACK_RECOVERY',calculation_identity:'calculation_id',queue_binding:'EXACT_COUNT_IDS_DIGEST_BINDING',regular_pipeline_enabled:false,physical_writes_during_package_install:false};}

  return Object.freeze({
    Version:VERSION,Release:RELEASE,Mode:MODE,AcceptanceStatus:ACCEPTANCE_STATUS,TargetSheet:TARGET_SHEET,ServiceTables:clone_(TABLES),RunHeaders:RUN_HEADERS.slice(),QueueHeaders:QUEUE_HEADERS.slice(),BatchHeaders:BATCH_HEADERS.slice(),BackupHeaders:BACKUP_HEADERS.slice(),Phases:RUN_PHASES.slice(),
    install:install,setExecutionEnabled:setExecutionEnabled,enqueue:enqueue,dispatcherWorker:dispatcherWorker,startDispatcher:startDispatcher,stopDispatcher:stopDispatcher,resumeRun:resumeRun,startRollback:startRollback,status:status,statusSummary:statusSummary,buildPure:buildPure,
    Test:Object.freeze({clone:clone_,canonicalJson:canonicalJson_,hash:hash_,validateRequest:validateRequest_,requestFingerprint:requestFingerprint_,requestArtifact:requestArtifact_,validateRequestArtifact:validateRequestArtifact_,replayPlanner:replayPlanner_,preplanAffectedVisibleSeries:preplanAffectedVisibleSeries_,syntheticCategoryDefinition:syntheticCategoryDefinition_,categoryDefinitionsForRow:categoryDefinitionsForRow_,canonicalTargetRows:canonicalTargetRows_,buildMutationModel:buildMutationModel_,applyModelToRows:applyModelToRows_,rowFingerprint:rowFingerprint_,canonicalCellToken:canonicalCellToken_,physicalType:physicalType_,visibleSeriesKey:visibleSeriesKey_,physicalSeriesSubject:physicalSeriesSubject_,physicalTargetKey:physicalTargetKey_,physicalValueType:physicalValueType_,legacyAggregateIdForRow:legacyAggregateIdForRow_,storageKey:storageKey_,unrelatedFingerprint:unrelatedFingerprint_,unrelatedFingerprintChunked:unrelatedFingerprintChunked_,unrelatedAccumulator:unrelatedAccumulator_,combineAccumulators:combineAccumulators_,readRowsForRun:readRowsForRun_,markQueueAttempt:markQueueAttempt_,inventoryFingerprint:inventoryFingerprint_,classifyItemState:classifyItemState_,classifyBatchOutcome:classifyBatchOutcome_,classifyRollbackOutcome:classifyRollbackOutcome_,shouldPause:shouldPause_,nextPhase:nextPhase_,batchId:batchId_,extendedValue:extendedValue_,updateCellsRow:updateCellsRow_,numberFormatType:numberFormatType_,periodParts:periodParts_,definitionVisibleKey:definitionVisibleKey_,activeAt:activeAt_,buildAfterRow:buildAfterRow_,seriesTemplate:seriesTemplate_,config:config_,error:error_,calculationItemId:calculationItemId_,calculationSetDigest:calculationSetDigest_,mutationSetDigest:mutationSetDigest_,proveExactSet:proveExactSet_,hydrateCalculatorBatch:hydrateCalculatorBatch_,publishableRowsFromCalculation:publishableRowsFromCalculation_,mergeCalculatedCategoryRow:mergeCalculatedCategoryRow_,assembleCalculatedPlan:assembleCalculatedPlan_})
  });
})();
AKORT.AggregateRefresh = AKORT.IncrementalAggregateUpsert;

/* Entry points remain in src/21 so accepted entry-point files stay byte-identical. */
function AKORT_alpha74UpsertInstall(){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.install());}
function AKORT_alpha74UpsertStatus(){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.status());}
function AKORT_alpha74UpsertSetEnabled(value){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.setExecutionEnabled(value===true));}
function AKORT_alpha74UpsertEnqueue(request){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.enqueue(request));}
function AKORT_alpha74UpsertDispatcherWorker(){return AKORT.IncrementalAggregateUpsert.dispatcherWorker();}
function AKORT_alpha74UpsertStartDispatcher(){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.startDispatcher());}
function AKORT_alpha74UpsertStopDispatcher(){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.stopDispatcher());}
function AKORT_alpha74UpsertResume(runId){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.resumeRun(runId));}
function AKORT_alpha74UpsertStartRollback(runId){return AKORT_printResult_(AKORT.IncrementalAggregateUpsert.startRollback(runId));}
function AKORT_alpha74UpsertRunPureTests(){return AKORT_printResult_(AKORT.Alpha74UpsertTests.runPureTests());}
