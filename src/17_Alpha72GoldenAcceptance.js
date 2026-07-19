var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.2 final read-only golden compatibility gates.
 *
 * This module reads the accepted aggregate baseline and RAW_CATEGORY_WEIGHTS,
 * reconstructs representative calculator requests, and proves parity without
 * writing to any Google service. Physical aggregate execution remains disabled.
 */
AKORT.Alpha72GoldenAcceptance = (function () {
  var VERSION = '4.0-alpha72-golden-acceptance-3';
  var BASELINE_NAME = 'AKORT_ALPHA6_BASELINE_CANONICAL_20260715_083013';
  var BASELINE_SHEET = 'PUBLISH_PRICE_AGGREGATES';
  var WEIGHTS_SHEET = 'RAW_CATEGORY_WEIGHTS';
  var EXPECTED_BASELINE_ROWS = 61636;
  var EXPECTED_BASELINE_COLUMNS = 29;
  var EXPECTED_BASELINE_HASH = '1a6db3d0e56560cc908493fc3ced738d609cdb278bab5390764f090a52efd3f5';
  var EXPECTED_BASELINE_FINGERPRINT = '459441b75a8020c361d8c2d5a16cb61293322b49e3c1483929cdf3ee3083624a';
  var CHUNK_ROWS = 1500;
  var READ_COLUMNS = 26; // dataset_code through coverage_weight_sum
  var DEFAULT_COVERAGE_RULE_ID = 'DEFAULT_COMPLETE_ONLY';

  var FIXTURE_CONTEXTS = Object.freeze([
    Object.freeze({
      context_id:'AKORT_WEEKLY_WOW_2024_W02',
      dataset_code:'AKORT_WEEKLY',
      frequency:'weekly',
      value_type:'закупка',
      index_type:'wow',
      period_start:'2024-01-14',
      group_subject:'Овощи и фрукты',
      basket_subject:'Корзина дашборда',
      weight_source:'AKORT_SALES_WEIGHTS',
      weight_year:2025,
      group_weight_scope:'group',
      basket_weight_scope:'akort_basket',
      coverage_weight_scope:'akort_basket'
    }),
    Object.freeze({
      context_id:'ROSSTAT_MONTHLY_MOM_2024_01',
      dataset_code:'ROSSTAT_MONTHLY',
      frequency:'monthly',
      value_type:'ИПЦ',
      index_type:'mom',
      period_start:'2024-01',
      group_subject:'Бакалея',
      basket_subject:'Корзина дашборда',
      total_subject:'Вклад в общую инфляцию',
      weight_source:'ROSSTAT_CPI_WEIGHTS',
      weight_year:2026,
      group_weight_scope:'group',
      basket_weight_scope:'dashboard_basket',
      total_weight_scope:'total_cpi',
      coverage_weight_scope:'dashboard_basket'
    })
  ]);

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function number_(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(parsed) ? parsed : null;
  }

  function round6_(value) {
    var parsed = number_(value);
    return parsed === null ? null : Math.round(parsed * 1000000) / 1000000;
  }

  function round10_(value) {
    var parsed = number_(value);
    return parsed === null ? null : Math.round(parsed * 10000000000) / 10000000000;
  }

  function stable_(value) {
    if (Array.isArray(value)) return value.map(stable_);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      var out = {};
      Object.keys(value).sort().forEach(function (key) { out[key] = stable_(value[key]); });
      return out;
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

  function acceptanceError_(code, message, details) {
    var error = new Error(message);
    error.name = 'Alpha72GoldenAcceptanceError';
    error.code = code;
    error.details = details || {};
    return error;
  }

  function assert_(condition, code, message, details) {
    if (!condition) throw acceptanceError_(code, message, details);
  }

  function approx_(actual, expected, tolerance, code, message, details) {
    var left = number_(actual), right = number_(expected), limit = Number(tolerance || 0.000001);
    assert_(left !== null && right !== null && Math.abs(left - right) <= limit, code, message, Object.assign({actual:actual,expected:expected,tolerance:limit},details || {}));
  }

  function test_(id, name, fn) {
    try {
      return {id:id,name:name,status:'PASS',data:fn(),error:null};
    } catch (error) {
      return {id:id,name:name,status:'FAIL',data:null,error:{name:text_(error && error.name),code:text_(error && error.code),message:text_(error && error.message || error),details:error && error.details || null,stack:text_(error && error.stack)}};
    }
  }

  function headerMap_(headers) {
    var map = {};
    (headers || []).forEach(function (header, index) { map[text_(header)] = index; });
    return map;
  }

  function requireHeaders_(headers, required, sheetName) {
    var map = headerMap_(headers), missing = [];
    (required || []).forEach(function (header) { if (map[header] === undefined) missing.push(header); });
    assert_(!missing.length, 'ALPHA72_GOLDEN_SCHEMA_INVALID', 'Golden source is missing required columns.', {sheet:sheetName,missing:missing});
    return map;
  }

  function rowObject_(row, index) {
    var out = {};
    Object.keys(index).forEach(function (header) { out[header] = row[index[header]]; });
    return out;
  }

  function contextKey_(dataset, frequency, valueType, indexType, period) {
    return [text_(dataset),text_(frequency).toLowerCase(),text_(valueType),text_(indexType).toLowerCase(),periodKey_(frequency,period)].join('|');
  }

  function periodKey_(frequency, value) {
    return AKORT.AggregateContract.Test.periodKey(frequency, value);
  }

  function contextMap_() {
    var map = {};
    FIXTURE_CONTEXTS.forEach(function (context) {
      map[contextKey_(context.dataset_code,context.frequency,context.value_type,context.index_type,context.period_start)] = context;
    });
    return map;
  }

  function readGoldenRows_(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(BASELINE_SHEET);
    assert_(sheet, 'ALPHA72_GOLDEN_SHEET_MISSING', 'Accepted aggregate baseline sheet is missing.', {sheet:BASELINE_SHEET});
    var lastRow = sheet.getLastRow(), headers = sheet.getRange(1,1,1,READ_COLUMNS).getValues()[0];
    var required = ['dataset_code','frequency','aggregate_level','aggregate_name','category_id','product_group','product_name','value_type','index_type','period_start','category_value','category_change_pp','category_weight','aggregate_change_pp','contribution_to_group_change_pp','contribution_to_basket_change_pp','contribution_to_total_cpi_pp','weight_source','coverage_categories_count','coverage_weight_sum'];
    var index = requireHeaders_(headers, required, BASELINE_SHEET), contexts = contextMap_(), retained = {};
    Object.keys(contexts).forEach(function (key) { retained[key] = {context:contexts[key],category_rows:[],aggregate_rows:[]}; });
    for (var start = 2; start <= lastRow; start += CHUNK_ROWS) {
      var count = Math.min(CHUNK_ROWS,lastRow-start+1), values = sheet.getRange(start,1,count,READ_COLUMNS).getValues();
      values.forEach(function (row) {
        var key;
        try { key = contextKey_(row[index.dataset_code],row[index.frequency],row[index.value_type],row[index.index_type],row[index.period_start]); }
        catch (ignored) { return; }
        if (!retained[key]) return;
        var object = rowObject_(row,index);
        object.period_key = periodKey_(object.frequency,object.period_start);
        if (text_(object.aggregate_level) === 'category') retained[key].category_rows.push(object);
        else retained[key].aggregate_rows.push(object);
      });
    }
    Object.keys(retained).forEach(function (key) {
      retained[key].category_rows.sort(function (a,b) { return text_(a.category_id) < text_(b.category_id) ? -1 : text_(a.category_id) > text_(b.category_id) ? 1 : 0; });
      retained[key].aggregate_rows.sort(function (a,b) {
        var left=[text_(a.aggregate_level),text_(a.aggregate_name),text_(a.product_group)].join('|'),right=[text_(b.aggregate_level),text_(b.aggregate_name),text_(b.product_group)].join('|');
        return left<right?-1:left>right?1:0;
      });
    });
    return retained;
  }

  function readWeightRows_(dwhSpreadsheet) {
    var sheet = dwhSpreadsheet.getSheetByName(WEIGHTS_SHEET);
    assert_(sheet, 'ALPHA72_GOLDEN_WEIGHT_SHEET_MISSING', 'RAW_CATEGORY_WEIGHTS is missing from the configured DWH.', {sheet:WEIGHTS_SHEET});
    var lastRow = sheet.getLastRow(), lastColumn = Math.min(sheet.getLastColumn(),13), values = sheet.getRange(1,1,lastRow,lastColumn).getValues();
    var headers = values[0], required = ['source_code','category_id','product_group','product_name','weight_year','weight_scope','weight_value','allocation_factor'];
    var index = requireHeaders_(headers,required,WEIGHTS_SHEET), rows=[];
    values.slice(1).forEach(function (row) {
      if (!row.some(function (value) { return text_(value) !== ''; })) return;
      rows.push(rowObject_(row,index));
    });
    return rows;
  }

  function findAggregateRow_(data, level, subject) {
    var matches = data.aggregate_rows.filter(function (row) {
      if (text_(row.aggregate_level) !== level) return false;
      if (level === 'group') return text_(row.aggregate_name) === subject || text_(row.product_group) === subject;
      return text_(row.aggregate_name) === subject;
    });
    assert_(matches.length === 1, 'ALPHA72_GOLDEN_AGGREGATE_CARDINALITY', 'Expected exactly one accepted aggregate row for the golden fixture.', {level:level,subject:subject,matches:matches.length,context:data.context.context_id});
    return matches[0];
  }

  function contributionField_(level) {
    if (level === 'group') return 'contribution_to_group_change_pp';
    if (level === 'basket') return 'contribution_to_basket_change_pp';
    if (level === 'total_cpi') return 'contribution_to_total_cpi_pp';
    throw acceptanceError_('ALPHA72_GOLDEN_LEVEL_INVALID','Unsupported golden aggregate level.',{level:level});
  }

  function categoriesForFixture_(data, level, subject) {
    var field = contributionField_(level), rows = data.category_rows.filter(function (row) {
      if (level === 'group' && text_(row.product_group) !== subject) return false;
      return number_(row[field]) !== null;
    });
    assert_(rows.length > 0, 'ALPHA72_GOLDEN_CATEGORY_ROWS_MISSING', 'No accepted category contribution rows were found for the golden fixture.', {level:level,subject:subject,context:data.context.context_id});
    return rows;
  }

  function weightMap_(weightRows, context, weightScope) {
    var map = {};
    weightRows.forEach(function (row) {
      if (text_(row.source_code) !== context.weight_source) return;
      if (Number(row.weight_year) !== Number(context.weight_year)) return;
      if (text_(row.weight_scope) !== weightScope) return;
      var category = text_(row.category_id);
      assert_(!map[category], 'ALPHA72_GOLDEN_WEIGHT_DUPLICATE', 'Duplicate accepted weight row for category and scope.', {category_id:category,source_code:context.weight_source,weight_year:context.weight_year,weight_scope:weightScope});
      map[category] = row;
    });
    return map;
  }

  function fixtureSpec_(data, level) {
    var context = data.context;
    if (level === 'group') return {level:level,subject:context.group_subject,weight_scope:context.group_weight_scope};
    if (level === 'basket') return {level:level,subject:context.basket_subject,weight_scope:context.basket_weight_scope};
    if (level === 'total_cpi') return {level:level,subject:context.total_subject,weight_scope:context.total_weight_scope};
    throw acceptanceError_('ALPHA72_GOLDEN_LEVEL_INVALID','Unsupported golden fixture level.',{level:level});
  }

  function buildGoldenRequest_(data, weightRows, level) {
    var context = data.context, spec = fixtureSpec_(data,level), aggregateRow = findAggregateRow_(data,level,spec.subject);
    var categoryRows = categoriesForFixture_(data,level,spec.subject), calculationWeights = weightMap_(weightRows,context,spec.weight_scope), coverageScope = context.coverage_weight_scope || context.basket_weight_scope, coverageWeights = weightMap_(weightRows,context,coverageScope), field = contributionField_(level);
    var membershipRule = ['GOLDEN_MEMBERSHIP',context.context_id,level].join('_');
    var subjectId = level === 'group' ? spec.subject : (level === 'basket' ? 'DASHBOARD_BASKET' : 'TOTAL_CPI');
    var definition = {
      definition_id:['GOLDEN_DEF',context.context_id,level].join('_'),
      dataset_code:context.dataset_code,frequency:context.frequency,aggregate_level:level,aggregate_subject_id:subjectId,aggregate_name:spec.subject,
      value_type:context.value_type,index_type:context.index_type,calculation_method:'SUM_CONTRIBUTIONS',weight_rule_id:context.weight_source,
      membership_rule_id:membershipRule,coverage_rule_id:DEFAULT_COVERAGE_RULE_ID,output_unit:'percentage_point',weight_scope:spec.weight_scope
    };
    var normalizedDefinition = AKORT.AggregateCalculator.Test.normalizeDefinition(definition);
    var priceInputs=[],membershipRows=[],weightSnapshotRows=[],expectedContributions={},expectedSum=0,calculationWeightSum=0,coverageWeightSum=0,sourceAllocations={};
    categoryRows.forEach(function (row) {
      var category=text_(row.category_id), weight=calculationWeights[category], coverageWeight=coverageWeights[category], change=number_(row.category_change_pp), acceptedContribution=number_(row[field]);
      assert_(weight, 'ALPHA72_GOLDEN_WEIGHT_MISSING', 'Accepted DWH calculation weight is missing for a golden category.', {category_id:category,scope:spec.weight_scope,context:context.context_id});
      assert_(coverageWeight, 'ALPHA72_GOLDEN_COVERAGE_WEIGHT_MISSING', 'Accepted DWH coverage weight is missing for a golden category.', {category_id:category,scope:coverageScope,context:context.context_id});
      var weightValue=number_(weight.weight_value), sourceAllocation=number_(weight.allocation_factor), coverageWeightValue=number_(coverageWeight.weight_value);
      if (sourceAllocation === null) sourceAllocation=1;
      assert_(change !== null && acceptedContribution !== null && weightValue !== null && weightValue > 0 && sourceAllocation > 0 && coverageWeightValue !== null && coverageWeightValue > 0, 'ALPHA72_GOLDEN_INPUT_INVALID', 'Golden category input is missing or invalid.', {category_id:category,change:row.category_change_pp,contribution:row[field],weight:weight.weight_value,source_allocation_factor:weight.allocation_factor,coverage_weight:coverageWeight.weight_value,coverage_scope:coverageScope});
      var recomputed=round6_(change*weightValue);
      approx_(recomputed,acceptedContribution,0.000001,'ALPHA72_GOLDEN_SOURCE_PARITY','Accepted category contribution does not match the already-allocated RAW_CATEGORY_WEIGHTS.weight_value.',{category_id:category,level:level,context:context.context_id,source_allocation_factor:sourceAllocation});
      expectedContributions[category]=acceptedContribution;
      expectedSum=round6_(expectedSum+acceptedContribution);
      calculationWeightSum+=weightValue;
      coverageWeightSum+=coverageWeightValue;
      sourceAllocations[category]=sourceAllocation;
      var categoryValue=number_(row.category_value), categoryValueState=categoryValue===null?'MISSING':(categoryValue===0?'ZERO':'VALID');
      priceInputs.push({dataset_code:context.dataset_code,frequency:context.frequency,series_id:'GOLDEN_'+category,category_id:category,category_name:text_(row.product_name),value_type:context.value_type,index_type:context.index_type,period_start:context.period_start,current_value:categoryValue,base_value:null,change_pp:change,unit:'percentage_point',current_state:categoryValueState,change_state:change===0?'ZERO':'VALID'});
      membershipRows.push({membership_rule_id:membershipRule,membership_version:'ACCEPTED_BASELINE_V1',aggregate_subject_id:subjectId,category_id:category,allocation_factor:1,include_flag:1,effective_from:'1900-01-01',effective_to:'',status:'ACTIVE'});
      weightSnapshotRows.push({weight_rule_id:context.weight_source,weight_version:String(context.weight_year),weight_scope:spec.weight_scope,category_id:category,weight_value:weightValue,effective_from:'1900-01-01',effective_to:'',status:'ACTIVE'});
    });
    approx_(expectedSum,aggregateRow.aggregate_change_pp,0.000001,'ALPHA72_GOLDEN_ACCEPTED_SUM_MISMATCH','Accepted aggregate row does not equal the sum of its accepted category contributions.',{context:context.context_id,level:level,subject:spec.subject});
    var expectedCount=number_(aggregateRow.coverage_categories_count);
    if (expectedCount !== null) assert_(expectedCount===categoryRows.length,'ALPHA72_GOLDEN_COVERAGE_COUNT_MISMATCH','Accepted coverage count differs from reconstructed membership.',{expected:expectedCount,actual:categoryRows.length,context:context.context_id,level:level});
    if (number_(aggregateRow.coverage_weight_sum)!==null) approx_(round10_(coverageWeightSum),aggregateRow.coverage_weight_sum,0.0000000001,'ALPHA72_GOLDEN_COVERAGE_WEIGHT_MISMATCH','Accepted coverage weight sum differs from the legacy basket-weight coverage scope.',{context:context.context_id,level:level,coverage_scope:coverageScope});
    var impact={load_id:'GOLDEN_'+context.context_id,operation_id:'GOLDEN_ACCEPTANCE',reason_code:'ALPHA72_GOLDEN_PARITY',source_dataset_code:context.dataset_code,source_series_id:'GOLDEN_SOURCE',source_category_id:categoryRows[0].category_id,source_period:context.period_start,frequency:context.frequency,target_value_type:context.value_type,target_index_type:context.index_type,target_aggregate_scope:level+':'+subjectId,target_period:context.period_start,weight_snapshot_id:'GOLDEN_WEIGHT_SNAPSHOT',membership_snapshot_id:'GOLDEN_MEMBERSHIP_SNAPSHOT',frontier_snapshot_id:'ACCEPTED_BASELINE_FRONTIER',status:'PLANNED',created_at:'2026-07-19T00:00:00.000Z'};
    var request={contract_version:AKORT.AggregateContract.Version,calculation_id:['GOLDEN_CALC',context.context_id,level].join('_'),impact_items:[impact],price_inputs:priceInputs,aggregate_definitions:[definition],weight_snapshot:{snapshot_id:'GOLDEN_WEIGHT_SNAPSHOT',hash:AKORT.AggregateCalculator.Test.sha256(JSON.stringify(stable_(weightSnapshotRows))),rule_rows:weightSnapshotRows},membership_snapshot:{snapshot_id:'GOLDEN_MEMBERSHIP_SNAPSHOT',hash:AKORT.AggregateCalculator.Test.sha256(JSON.stringify(stable_(membershipRows))),rule_rows:membershipRows},coverage_rules:[],base_inputs:[],options:{read_only:true}};
    return {request:request,context:context,spec:spec,definition:normalizedDefinition,accepted_aggregate_row:aggregateRow,accepted_category_rows:categoryRows,expected_contributions:expectedContributions,expected_sum:expectedSum,expected_calculation_weight_sum:round10_(calculationWeightSum),expected_coverage_weight_sum:round10_(coverageWeightSum),coverage_weight_scope:coverageScope,source_allocation_factors:sourceAllocations};
  }

  function evaluateFixture_(data, weightRows, level) {
    var built=buildGoldenRequest_(data,weightRows,level), result=AKORT.AggregateCalculator.calculateBatch(built.request);
    assert_(result.ok && result.status === 'SUCCESS', 'ALPHA72_GOLDEN_CALCULATOR_FAILED', 'Calculator did not produce a publishable golden result.', {context:built.context.context_id,level:level,status:result.status,diagnostics:result.diagnostics});
    var aggregateRows=(result.rows||[]).filter(function (row) { return row.row_type==='AGGREGATE_RESULT'; });
    assert_(aggregateRows.length===1,'ALPHA72_GOLDEN_OUTPUT_CARDINALITY','Golden calculator output must contain exactly one aggregate row.',{context:built.context.context_id,level:level,rows:aggregateRows.length});
    var aggregate=aggregateRows[0];
    approx_(aggregate.aggregate_change_pp,built.accepted_aggregate_row.aggregate_change_pp,0.000001,'ALPHA72_GOLDEN_AGGREGATE_PARITY','Calculator aggregate differs from accepted baseline.',{context:built.context.context_id,level:level,subject:built.spec.subject});
    assert_(aggregate.publication_allowed===true&&aggregate.coverage_status==='COMPLETE','ALPHA72_GOLDEN_NOT_PUBLISHABLE','Golden result is not complete and publishable.',{context:built.context.context_id,level:level,status:aggregate.calculation_status,coverage:aggregate.coverage_status});
    approx_(aggregate.applied_weight_sum,built.expected_calculation_weight_sum,0.0000000001,'ALPHA72_GOLDEN_CALCULATION_WEIGHT_MISMATCH','Calculator applied weight sum differs from the calculation-weight scope.',{context:built.context.context_id,level:level,weight_scope:built.spec.weight_scope});
    var categoryRows=(result.rows||[]).filter(function (row) { return row.row_type==='CATEGORY_CONTRIBUTION'; }), field=contributionField_(level);
    assert_(categoryRows.length===built.accepted_category_rows.length,'ALPHA72_GOLDEN_CATEGORY_CARDINALITY','Calculator category-row count differs from accepted membership.',{context:built.context.context_id,level:level,expected:built.accepted_category_rows.length,actual:categoryRows.length});
    categoryRows.forEach(function (row) {
      assert_(built.expected_contributions[text_(row.category_id)]!==undefined,'ALPHA72_GOLDEN_CATEGORY_UNEXPECTED','Calculator returned a category outside accepted membership.',{category_id:row.category_id,context:built.context.context_id,level:level});
      approx_(row[field],built.expected_contributions[text_(row.category_id)],0.000001,'ALPHA72_GOLDEN_CATEGORY_PARITY','Calculator category contribution differs from accepted baseline.',{category_id:row.category_id,context:built.context.context_id,level:level});
    });
    var expectedRowKey=AKORT.AggregateContract.aggregateRowKey(Object.assign({},built.definition,{period_start:built.context.period_start,group_id:level==='group'?built.definition.aggregate_subject_id:undefined}));
    assert_(aggregate.aggregate_series_key===built.definition.series_key&&aggregate.aggregate_row_key===expectedRowKey,'ALPHA72_GOLDEN_KEY_MISMATCH','Calculator output keys are incompatible with Alpha.7.1 contract.',{context:built.context.context_id,level:level,actual_series_key:aggregate.aggregate_series_key,expected_series_key:built.definition.series_key,actual_row_key:aggregate.aggregate_row_key,expected_row_key:expectedRowKey});
    return {context_id:built.context.context_id,level:level,subject:built.spec.subject,categories:categoryRows.length,accepted_value:number_(built.accepted_aggregate_row.aggregate_change_pp),calculated_value:aggregate.aggregate_change_pp,series_key:aggregate.aggregate_series_key,row_key:aggregate.aggregate_row_key,fingerprint:result.fingerprint,calculation_weight_sum:built.expected_calculation_weight_sum,accepted_coverage_weight_sum:built.expected_coverage_weight_sum,coverage_weight_scope:built.coverage_weight_scope};
  }

  function collectEvidence_(baselineSpreadsheet, dwhSpreadsheet) {
    assert_(baselineSpreadsheet.getName()===BASELINE_NAME,'ALPHA72_GOLDEN_BASELINE_NAME_MISMATCH','Configured Alpha.7.1 baseline has an unexpected name.',{actual:baselineSpreadsheet.getName(),expected:BASELINE_NAME});
    var rowsByContext=readGoldenRows_(baselineSpreadsheet),weights=readWeightRows_(dwhSpreadsheet),evidence={fixtures:{}};
    FIXTURE_CONTEXTS.forEach(function (context) {
      var key=contextKey_(context.dataset_code,context.frequency,context.value_type,context.index_type,context.period_start),data=rowsByContext[key];
      assert_(data&&data.category_rows.length,'ALPHA72_GOLDEN_CONTEXT_MISSING','Golden context is absent from accepted baseline.',{context:context.context_id,key:key});
      evidence.fixtures[context.context_id]={};
      evidence.fixtures[context.context_id].group=evaluateFixture_(data,weights,'group');
      evidence.fixtures[context.context_id].basket=evaluateFixture_(data,weights,'basket');
      if (context.total_subject) evidence.fixtures[context.context_id].total_cpi=evaluateFixture_(data,weights,'total_cpi');
    });
    return evidence;
  }

  function runGolden() {
    return AKORT.Core.safeRun('ALPHA72_GOLDEN_COMPATIBILITY',function () {
      AKORT.EnvironmentGuard.assertDev();
      var config=AKORT.Config.load({includeSystemSettings:false}),resources=config&&config.resources||{};
      var baselineId=text_(resources.alpha71BaselinePublishSpreadsheetId),dwhId=text_(resources.dwhSpreadsheetId);
      assert_(baselineId,'ALPHA72_GOLDEN_BASELINE_REFERENCE_MISSING','alpha71BaselinePublishSpreadsheetId is not configured.');
      assert_(dwhId,'ALPHA72_GOLDEN_DWH_REFERENCE_MISSING','dwhSpreadsheetId is not configured.');
      var baselineSpreadsheet=SpreadsheetApp.openById(baselineId),dwhSpreadsheet=SpreadsheetApp.openById(dwhId),tests=[];
      var baselineInventory=AKORT.AggregateContract.baselineInventory();
      assert_(baselineInventory.rows===EXPECTED_BASELINE_ROWS&&baselineInventory.columns===EXPECTED_BASELINE_COLUMNS&&baselineInventory.data_hash===EXPECTED_BASELINE_HASH&&baselineInventory.fingerprint===EXPECTED_BASELINE_FINGERPRINT,'ALPHA72_GOLDEN_BASELINE_IDENTITY_MISMATCH','Accepted aggregate baseline identity changed.',baselineInventory);
      var evidence=collectEvidence_(baselineSpreadsheet,dwhSpreadsheet);
      tests.push(test_('T72-052','Alpha.7.1 contract compatibility and deterministic keys',function(){
        assert_(AKORT.AggregateContract.Version==='4.0-aggregate-contract-2','ALPHA72_GOLDEN_CONTRACT_VERSION','Unexpected Alpha.7.1 contract version.',{actual:AKORT.AggregateContract.Version});
        assert_(AKORT.AggregateCalculator.InputContractVersion===AKORT.AggregateContract.Version,'ALPHA72_GOLDEN_CONTRACT_LINK','Calculator input contract does not match Alpha.7.1.',{calculator:AKORT.AggregateCalculator.InputContractVersion,contract:AKORT.AggregateContract.Version});
        var keys=[];Object.keys(evidence.fixtures).sort().forEach(function(contextId){Object.keys(evidence.fixtures[contextId]).sort().forEach(function(level){var x=evidence.fixtures[contextId][level];assert_(x.series_key&&x.row_key,'ALPHA72_GOLDEN_KEY_MISSING','Golden fixture has missing deterministic keys.',x);keys.push({context_id:contextId,level:level,series_key:x.series_key,row_key:x.row_key});});});return{contract_version:AKORT.AggregateContract.Version,calculator_input_contract:AKORT.AggregateCalculator.InputContractVersion,keys:keys};
      }));
      tests.push(test_('T72-053','Accepted category-contribution parity',function(){
        var summary=[];Object.keys(evidence.fixtures).sort().forEach(function(contextId){Object.keys(evidence.fixtures[contextId]).sort().forEach(function(level){var x=evidence.fixtures[contextId][level];summary.push({context_id:contextId,level:level,categories:x.categories,value:x.calculated_value});});});assert_(summary.reduce(function(sum,x){return sum+x.categories;},0)>0,'ALPHA72_GOLDEN_CATEGORY_EMPTY','No golden category contributions were verified.');return summary;
      }));
      tests.push(test_('T72-054','Accepted group aggregate parity',function(){var out=[];Object.keys(evidence.fixtures).sort().forEach(function(contextId){out.push(evidence.fixtures[contextId].group);});assert_(out.length===2,'ALPHA72_GOLDEN_GROUP_COUNT','Both weekly and monthly group fixtures are required.',{actual:out.length});return out;}));
      tests.push(test_('T72-055','Accepted basket aggregate parity',function(){var out=[];Object.keys(evidence.fixtures).sort().forEach(function(contextId){out.push(evidence.fixtures[contextId].basket);});assert_(out.length===2,'ALPHA72_GOLDEN_BASKET_COUNT','Both weekly and monthly basket fixtures are required.',{actual:out.length});return out;}));
      tests.push(test_('T72-056','Accepted total-CPI aggregate parity',function(){var out=evidence.fixtures.ROSSTAT_MONTHLY_MOM_2024_01.total_cpi;assert_(out&&out.level==='total_cpi','ALPHA72_GOLDEN_TOTAL_MISSING','Monthly total-CPI golden fixture is missing.');return out;}));
      var failed=tests.filter(function(test){return test.status==='FAIL';});
      var report={suite:'ALPHA72_GOLDEN_COMPATIBILITY',version:VERSION,calculator_version:AKORT.AggregateCalculator.Version,contract_version:AKORT.AggregateContract.Version,total:tests.length,passed:tests.length-failed.length,failed:failed.length,skipped:0,status:failed.length?'FAILED':'SUCCESS',tests:tests,baseline:{spreadsheet_id:baselineId,name:baselineSpreadsheet.getName(),rows:baselineInventory.rows,columns:baselineInventory.columns,data_hash:baselineInventory.data_hash,fingerprint:baselineInventory.fingerprint},dwh:{spreadsheet_id:dwhId,name:dwhSpreadsheet.getName(),weight_sheet:WEIGHTS_SHEET},physical_writes:0,system_log_writes:0,lock_acquisitions:0,acceptance_status:failed.length?'NO_GO_GOLDEN_GATES_FAILED':'GOLDEN_COMPATIBILITY_GATES_PASSED'};
      return failed.length?AKORT.Result.failure('ALPHA72_GOLDEN_TESTS_FAILED','Alpha.7.2 golden compatibility gates failed.',report):AKORT.Result.success('Alpha.7.2 golden compatibility gates passed.',report);
    },{lock:false,persistLogs:false});
  }

  function status() {
    return {release_candidate:AKORT.AggregateCalculator&&AKORT.AggregateCalculator.Release||'4.0.0-alpha.7.2',golden_acceptance_version:VERSION,mode:'READ_ONLY_ACCEPTED_BASELINE_RECONSTRUCTION',test_ids:['T72-052','T72-053','T72-054','T72-055','T72-056'],baseline:{name:BASELINE_NAME,sheet:BASELINE_SHEET,rows:EXPECTED_BASELINE_ROWS,columns:EXPECTED_BASELINE_COLUMNS,data_hash:EXPECTED_BASELINE_HASH,fingerprint:EXPECTED_BASELINE_FINGERPRINT},fixture_contexts:clone_(FIXTURE_CONTEXTS),required_prior_gate:'AKORT_alpha72RunCalculatorTests SUCCESS 66/67 with T72-046 expected SKIP',acceptance_status:'READY_FOR_GOLDEN_COMPATIBILITY_EXECUTION'};
  }

  return Object.freeze({Version:VERSION,runGolden:runGolden,status:status,Test:Object.freeze({round6:round6_,periodKey:periodKey_,contextKey:contextKey_,buildGoldenRequest:buildGoldenRequest_,evaluateFixture:evaluateFixture_,fixtureContexts:clone_(FIXTURE_CONTEXTS)})});
})();

function AKORT_alpha72RunGoldenCompatibility(){var r=AKORT.Alpha72GoldenAcceptance.runGolden(),d=r&&(r.data||r.details)||{},failed=(d.tests||[]).filter(function(x){return x.status==='FAIL';}).map(function(x){return{id:x.id,error:x.error};});console.log(JSON.stringify({ok:r.ok,status:r.status,code:r.code||'',message:r.message,total:d.total,passed:d.passed,failed:d.failed,skipped:d.skipped,failed_tests:failed,acceptance_status:d.acceptance_status||'',baseline:d.baseline||null},null,2));return r;}
function AKORT_alpha72GoldenAcceptanceStatus(){var data=AKORT.Alpha72GoldenAcceptance.status(),r=AKORT.Result.success('Alpha.7.2 golden acceptance status loaded.',data);console.log(JSON.stringify(r,null,2));return r;}
