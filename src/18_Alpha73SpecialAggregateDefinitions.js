var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.3 accepted special-aggregate definition registry.
 * Pure and read-only: no Google-service I/O and no physical writes.
 */
AKORT.SpecialAggregateDefinitions = (function () {
  var VERSION = '4.0-special-aggregate-definitions-2';
  var RELEASE = '4.0.0-alpha.7.3';
  var MODE = 'PURE_READ_ONLY';
  var BORSCH_NAME = 'Борщевой набор';
  var BORSCH_PRODUCT_GROUP = 'Овощи и фрукты';
  var DEFAULT_COVERAGE_RULE_ID = 'DEFAULT_COMPLETE_ONLY';
  var ALLOWED_LEVELS = Object.freeze({custom_group:true,basket:true,group:true,total_cpi:true});
  var ALLOWED_METHODS = Object.freeze({NORMALIZED_WEIGHTED_AVERAGE:true,AGGREGATE_MARKUP:true,SUM_CONTRIBUTIONS:true});
  var SORT_FIELDS = Object.freeze(['dataset_code','frequency','aggregate_level','aggregate_subject_id','value_type','index_type','effective_from','definition_version','definition_id']);

  function calculator_() {
    if (!AKORT.AggregateCalculator) throw definitionError_('ALPHA73_CALCULATOR_UNAVAILABLE','Frozen Alpha.7.2 calculator is unavailable.');
    return AKORT.AggregateCalculator;
  }
  function contract_() {
    if (!AKORT.AggregateContract) throw definitionError_('ALPHA73_CONTRACT_UNAVAILABLE','Frozen Alpha.7.1 aggregate contract is unavailable.');
    return AKORT.AggregateContract;
  }
  function definitionError_(code,message,details) {
    var error = new Error(message); error.name = 'Alpha73DefinitionError'; error.code = code; error.details = details || {}; return error;
  }
  function text_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function norm_(value) { return text_(value).toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' '); }
  function upper_(value) { return text_(value).toUpperCase(); }
  function clone_(value) {
    if (Array.isArray(value)) return value.map(clone_);
    if (value && typeof value === 'object') { if (value instanceof Date) return new Date(value.getTime()); var out={}; Object.keys(value).forEach(function(k){out[k]=clone_(value[k]);}); return out; }
    return value;
  }
  function stable_(value) {
    if (Array.isArray(value)) return value.map(stable_);
    if (value && typeof value === 'object') { if (value instanceof Date) return value.toISOString(); var out={}; Object.keys(value).sort().forEach(function(k){out[k]=stable_(value[k]);}); return out; }
    if (typeof value === 'number' && !isFinite(value)) return null;
    return value;
  }
  function stableStringify_(value) { return JSON.stringify(stable_(value)); }
  function hash_(value) { return calculator_().Test.sha256(stableStringify_(value)); }
  function requireText_(object,field,code) {
    var value=text_(object&&object[field]); if(!value) throw definitionError_(code||'ALPHA73_DEFINITION_MISSING','Required Alpha.7.3 field is missing: '+field+'.',{field:field}); return value;
  }
  function number_(value) {
    if(value===null||value===undefined||value==='') return null; var parsed=typeof value==='number'?value:Number(String(value).replace(/\s/g,'').replace(',','.')); return isFinite(parsed)?parsed:null;
  }
  function includeFlag_(value) {
    if(value===undefined||value===null||text_(value)==='') return 1;
    if(value===0||value==='0') return 0;
    if(value===1||value==='1') return 1;
    throw definitionError_('ALPHA73_MEMBERSHIP_INCLUDE_FLAG_INVALID','Membership include_flag must be exactly 0 or 1.',{value:value});
  }
  function dateKey_(value,endOfPeriod) {
    var raw=text_(value); if(!raw) return endOfPeriod?'9999-12-31':'1900-01-01';
    var m=raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/),year,month,day,date;
    if(m){year=Number(m[1]);month=Number(m[2]);day=m[3]?Number(m[3]):(endOfPeriod?new Date(Date.UTC(year,month,0)).getUTCDate():1);date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw definitionError_('ALPHA73_EFFECTIVE_DATE_INVALID','Effective date is invalid.',{value:value});return [year,('0'+month).slice(-2),('0'+day).slice(-2)].join('-');}
    date=value instanceof Date?new Date(value.getTime()):new Date(raw); if(isNaN(date.getTime())) throw definitionError_('ALPHA73_EFFECTIVE_DATE_INVALID','Effective date is invalid.',{value:value});
    return [date.getUTCFullYear(),('0'+(date.getUTCMonth()+1)).slice(-2),('0'+date.getUTCDate()).slice(-2)].join('-');
  }
  function interval_(row) {
    var from=dateKey_(row.effective_from,false),to=dateKey_(row.effective_to,true); if(from>to) throw definitionError_('ALPHA73_EFFECTIVE_INTERVAL_INVALID','effective_from is after effective_to.',{from:from,to:to}); return {from:from,to:to};
  }
  function activeStatus_(status) { var s=norm_(status||'active'); return !s||['active','accepted','current'].indexOf(s)>=0; }
  function activeAt_(row,period) { var point=dateKey_(period,false),range=interval_(row); return point>=range.from&&point<=range.to&&activeStatus_(row.status)&&includeFlag_(row.include_flag)===1; }
  function compareByFields_(fields) { return function(a,b){var l=fields.map(function(f){return text_(a[f]);}).join('|'),r=fields.map(function(f){return text_(b[f]);}).join('|');return l<r?-1:l>r?1:0;}; }
  function uniqueSorted_(values) { var map={};(values||[]).forEach(function(v){var k=text_(v);if(k)map[k]=true;});return Object.keys(map).sort(); }
  function diagnostic_(severity,code,message,details) { return {severity:severity,code:code,message:message,details:clone_(details||{})}; }
  function definitionFamilyKey_(row) { return [text_(row.dataset_code),norm_(row.frequency),norm_(row.aggregate_level),text_(row.aggregate_subject_id),text_(row.value_type),norm_(row.index_type)].join('|'); }

  function normalizeMembershipRow_(row,defaults) {
    var source=row||{},d=defaults||{},factor=number_(source.allocation_factor===undefined?1:source.allocation_factor);
    if(factor===null||factor<=0) throw definitionError_('ALPHA73_MEMBERSHIP_ALLOCATION_INVALID','Membership allocation_factor must be positive.',{row:source});
    var normalized={
      membership_rule_id:text_(source.membership_rule_id||d.membership_rule_id),membership_version:text_(source.membership_version||d.membership_version),aggregate_subject_id:text_(source.aggregate_subject_id||d.aggregate_subject_id),
      category_id:requireText_(source,'category_id','ALPHA73_DEFINITION_MISSING'),category_name:text_(source.category_name||source.product_name),product_group:text_(source.product_group||d.product_group),allocation_factor:factor,
      include_flag:includeFlag_(source.include_flag===undefined?d.include_flag:source.include_flag),effective_from:text_(source.effective_from||d.effective_from||'1900-01-01'),effective_to:text_(source.effective_to||d.effective_to||''),
      status:text_(source.status||d.status||'ACTIVE'),reason:text_(source.reason||d.reason||''),provenance:text_(source.provenance||d.provenance||''),source_map_id:text_(source.source_map_id||d.source_map_id||'')
    };
    requireText_(normalized,'membership_rule_id','ALPHA73_DEFINITION_MISSING');requireText_(normalized,'membership_version','ALPHA73_DEFINITION_MISSING');requireText_(normalized,'aggregate_subject_id','ALPHA73_DEFINITION_MISSING');interval_(normalized);
    return normalized;
  }
  function validateMembershipRows_(rows) {
    var versionIdentity={},intervals={};
    (rows||[]).forEach(function(row){
      includeFlag_(row.include_flag);var range=interval_(row),rule=requireText_(row,'membership_rule_id'),version=requireText_(row,'membership_version'),subject=requireText_(row,'aggregate_subject_id'),category=requireText_(row,'category_id');
      var versionKey=[rule,version,subject,category].join('|');if(versionIdentity[versionKey])throw definitionError_('ALPHA73_MEMBERSHIP_DUPLICATE','Duplicate category inside one membership rule version.',{key:versionKey,first:versionIdentity[versionKey],second:row});versionIdentity[versionKey]=clone_(row);
      var family=[rule,subject,category].join('|');intervals[family]=intervals[family]||[];intervals[family].push({from:range.from,to:range.to,version:version});
    });
    Object.keys(intervals).forEach(function(key){var values=intervals[key].sort(function(a,b){return a.from<b.from?-1:a.from>b.from?1:a.version<b.version?-1:1;});for(var i=1;i<values.length;i+=1){if(values[i].from<=values[i-1].to)throw definitionError_('ALPHA73_RULE_VERSION_CONFLICT','Membership effective versions overlap.',{key:key,first:values[i-1],second:values[i]});}});
    return rows;
  }
  function normalizeDefinition_(row) {
    var source=row||{},C=contract_(),frequency=norm_(requireText_(source,'frequency')),indexType=C.canonicalIndexTypes(frequency,requireText_(source,'index_type'),'official_index')[0],level=norm_(requireText_(source,'aggregate_level')),method=upper_(requireText_(source,'calculation_method'));
    if(!ALLOWED_LEVELS[level])throw definitionError_('ALPHA73_UNSUPPORTED_SPECIAL_AGGREGATE','Unsupported aggregate level.',{level:level});if(!ALLOWED_METHODS[method])throw definitionError_('ALPHA73_UNSUPPORTED_SPECIAL_AGGREGATE','Unsupported calculation method.',{method:method});
    var normalized={definition_id:text_(source.definition_id),definition_version:requireText_(source,'definition_version'),dataset_code:requireText_(source,'dataset_code'),frequency:frequency,aggregate_level:level,aggregate_subject_id:requireText_(source,'aggregate_subject_id'),aggregate_name:text_(source.aggregate_name||source.aggregate_subject_id),value_type:requireText_(source,'value_type'),index_type:indexType,calculation_method:method,weight_rule_id:requireText_(source,'weight_rule_id'),membership_rule_id:requireText_(source,'membership_rule_id'),coverage_rule_id:text_(source.coverage_rule_id||DEFAULT_COVERAGE_RULE_ID),output_unit:text_(source.output_unit||'percentage_point'),weight_scope:text_(source.weight_scope||source.aggregate_subject_id),purchase_value_type:text_(source.purchase_value_type||'purchase_price'),retail_value_type:text_(source.retail_value_type||'retail_price'),effective_from:text_(source.effective_from||'1900-01-01'),effective_to:text_(source.effective_to||''),status:text_(source.status||'ACTIVE'),provenance:text_(source.provenance||''),source_map_id:text_(source.source_map_id||'')};
    interval_(normalized);
    if(!normalized.definition_id)normalized.definition_id='ALPHA73_DEF_'+hash_([definitionFamilyKey_(normalized),normalized.calculation_method,normalized.weight_rule_id,normalized.membership_rule_id,normalized.definition_version,normalized.effective_from,normalized.effective_to]).slice(0,20).toUpperCase();
    var contractDefinition=clone_(normalized);if(level==='group')contractDefinition.group_id=normalized.aggregate_subject_id;normalized.aggregate_series_key=C.aggregateSeriesKey(contractDefinition);return normalized;
  }
  function validateDefinitions_(rows) {
    var versions={},intervals={};
    (rows||[]).forEach(function(row){var range=interval_(row),family=definitionFamilyKey_(row),version=requireText_(row,'definition_version'),versionKey=family+'|'+version;if(versions[versionKey])throw definitionError_('ALPHA73_DEFINITION_DUPLICATE','A definition version may appear only once in one semantic family.',{key:versionKey,first:versions[versionKey],second:row});versions[versionKey]=clone_(row);intervals[family]=intervals[family]||[];intervals[family].push({from:range.from,to:range.to,version:version,definition_id:row.definition_id});});
    Object.keys(intervals).forEach(function(key){var values=intervals[key].sort(function(a,b){return a.from<b.from?-1:a.from>b.from?1:a.version<b.version?-1:1;});for(var i=1;i<values.length;i+=1){if(values[i].from<=values[i-1].to)throw definitionError_('ALPHA73_DEFINITION_CONFLICT','Effective definition versions overlap.',{key:key,first:values[i-1],second:values[i]});}});return rows;
  }
  function definitionMatrix_(scope,method,valueTypes,indexTypes) {
    var rows=[],frequencies=uniqueSorted_(scope.frequencies||[scope.frequency]),datasets=uniqueSorted_(scope.dataset_codes||[scope.dataset_code]);
    datasets.forEach(function(dataset){frequencies.forEach(function(frequency){var allowed=uniqueSorted_(indexTypes&&indexTypes.length?indexTypes:contract_().AllowedIndexTypes[frequency]);uniqueSorted_(valueTypes).forEach(function(valueType){allowed.forEach(function(indexType){rows.push(normalizeDefinition_({definition_version:scope.definition_version,dataset_code:dataset,frequency:frequency,aggregate_level:scope.aggregate_level,aggregate_subject_id:scope.aggregate_subject_id,aggregate_name:scope.aggregate_name,value_type:valueType,index_type:indexType,calculation_method:method,weight_rule_id:scope.weight_rule_id,membership_rule_id:scope.membership_rule_id,coverage_rule_id:scope.coverage_rule_id,output_unit:scope.output_unit,weight_scope:scope.weight_scope,purchase_value_type:scope.purchase_value_type,retail_value_type:scope.retail_value_type,effective_from:scope.effective_from,effective_to:scope.effective_to,status:scope.status,provenance:scope.provenance,source_map_id:scope.source_map_id}));});});});});return rows;
  }
  function buildBorshchDefinitions(context) {
    var source=clone_(context||{}),subject=text_(source.aggregate_subject_id||contract_().BorshchAggregateId),version=requireText_(source,'membership_version'),definitionVersion=requireText_(source,'definition_version'),sourceMapId=requireText_(source,'source_map_id'),provenance=requireText_(source,'provenance'),effectiveFrom=requireText_(source,'effective_from');
    if(!Array.isArray(source.source_map)||!source.source_map.length)throw definitionError_('ALPHA73_DEFINITION_MISSING','Borshch source_map is required.');
    var defaults={membership_rule_id:requireText_(source,'membership_rule_id'),membership_version:version,aggregate_subject_id:subject,product_group:BORSCH_PRODUCT_GROUP,effective_from:effectiveFrom,effective_to:source.effective_to||'',status:source.status||'ACTIVE',reason:source.reason||'Approved Борщевой набор membership.',provenance:provenance,source_map_id:sourceMapId};
    var memberships=source.source_map.map(function(row){return normalizeMembershipRow_(row,defaults);});validateMembershipRows_(memberships);var active=memberships.filter(function(row){return activeAt_(row,source.target_period||effectiveFrom);});if(active.length!==5)throw definitionError_('ALPHA73_DEFINITION_MISSING','Borshch source map must resolve to exactly five active categories.',{active_members:active.length,source_map_id:sourceMapId});
    var scope={definition_version:definitionVersion,dataset_codes:source.dataset_codes||[],frequencies:source.frequencies||['weekly','monthly'],aggregate_level:'custom_group',aggregate_subject_id:subject,aggregate_name:BORSCH_NAME,weight_rule_id:requireText_(source,'weight_rule_id'),membership_rule_id:defaults.membership_rule_id,coverage_rule_id:source.coverage_rule_id||DEFAULT_COVERAGE_RULE_ID,output_unit:'percentage_point',weight_scope:text_(source.weight_scope||'dashboard_basket'),effective_from:effectiveFrom,effective_to:source.effective_to||'',status:source.status||'ACTIVE',provenance:provenance,source_map_id:sourceMapId};
    if(!scope.dataset_codes.length)throw definitionError_('ALPHA73_DEFINITION_MISSING','Borshch dataset_codes are required.');var definitions=definitionMatrix_(scope,'NORMALIZED_WEIGHTED_AVERAGE',source.value_types||['retail_price'],source.index_types||[]);validateDefinitions_(definitions);
    return {definitions:definitions,membership_rows:memberships,source_map_id:sourceMapId,source_map_fingerprint:hash_(memberships),summary:{active_members:active.length,definitions:definitions.length,subject_id:subject,provenance:provenance}};
  }
  function buildAggregateMarkupDefinitions(context) {
    var source=clone_(context||{}),subject=requireText_(source,'aggregate_subject_id'),scope={definition_version:requireText_(source,'definition_version'),dataset_codes:source.dataset_codes||[],frequencies:source.frequencies||['weekly','monthly'],aggregate_level:text_(source.aggregate_level||'basket'),aggregate_subject_id:subject,aggregate_name:text_(source.aggregate_name||subject),weight_rule_id:requireText_(source,'weight_rule_id'),membership_rule_id:requireText_(source,'membership_rule_id'),coverage_rule_id:source.coverage_rule_id||DEFAULT_COVERAGE_RULE_ID,output_unit:'percentage_point',weight_scope:text_(source.weight_scope||subject),purchase_value_type:text_(source.purchase_value_type||'purchase_price'),retail_value_type:text_(source.retail_value_type||'retail_price'),effective_from:requireText_(source,'effective_from'),effective_to:source.effective_to||'',status:source.status||'ACTIVE',provenance:requireText_(source,'provenance'),source_map_id:requireText_(source,'source_map_id')};
    if(!scope.dataset_codes.length)throw definitionError_('ALPHA73_DEFINITION_MISSING','Aggregate markup dataset_codes are required.');if(!scope.purchase_value_type||!scope.retail_value_type||scope.purchase_value_type===scope.retail_value_type)throw definitionError_('ALPHA73_MARKUP_PAIR_INVALID','Aggregate markup requires distinct purchase and retail value types.');var definitions=definitionMatrix_(scope,'AGGREGATE_MARKUP',[source.output_value_type||'markup'],source.index_types||[]);validateDefinitions_(definitions);return {definitions:definitions,summary:{subject_id:subject,source_map_id:scope.source_map_id,provenance:scope.provenance}};
  }
  function buildDefinitions(context) {
    var source=clone_(context||{}),definitions=[],memberships=[],diagnostics=[];try{(source.borshch_scopes||[]).forEach(function(scope){var built=buildBorshchDefinitions(scope);definitions=definitions.concat(built.definitions);memberships=memberships.concat(built.membership_rows);});(source.markup_scopes||[]).forEach(function(scope){definitions=definitions.concat(buildAggregateMarkupDefinitions(scope).definitions);});(source.additional_definitions||[]).forEach(function(row){definitions.push(normalizeDefinition_(row));});(source.additional_memberships||[]).forEach(function(row){memberships.push(normalizeMembershipRow_(row,{}));});definitions.sort(compareByFields_(SORT_FIELDS));memberships.sort(compareByFields_(['membership_rule_id','membership_version','aggregate_subject_id','category_id','effective_from']));validateDefinitions_(definitions);validateMembershipRows_(memberships);return {ok:true,status:'SUCCESS',release:RELEASE,definitions:definitions,membership_rows:memberships,diagnostics:diagnostics,summary:{definitions_total:definitions.length,membership_rows_total:memberships.length},fingerprint:buildDefinitionFingerprint({definitions:definitions,membership_rows:memberships})};}catch(error){diagnostics.push(diagnostic_('ERROR',text_(error&&error.code||'ALPHA73_DEFINITION_CONFLICT'),text_(error&&error.message||error),error&&error.details||{}));return {ok:false,status:'FAILED_CONTRACT',release:RELEASE,definitions:[],membership_rows:[],diagnostics:diagnostics,summary:{definitions_total:0,membership_rows_total:0},fingerprint:buildDefinitionFingerprint({definitions:[],membership_rows:[],diagnostics:diagnostics})};}
  }
  function resolveDefinitionsForPeriod(definitions,period) { var groups={},out=[];(definitions||[]).forEach(function(row){if(!activeAt_(row,period))return;var key=definitionFamilyKey_(row);groups[key]=groups[key]||[];groups[key].push(row);});Object.keys(groups).sort().forEach(function(key){if(groups[key].length!==1)throw definitionError_('ALPHA73_DEFINITION_CONFLICT','More than one effective definition resolves for a target period.',{key:key,count:groups[key].length,period:period});out.push(clone_(groups[key][0]));});return out.sort(compareByFields_(SORT_FIELDS)); }
  function buildDefinitionFingerprint(value) { var source=value||{},canonical={definitions:(source.definitions||source||[]).map(clone_).sort(compareByFields_(SORT_FIELDS)),membership_rows:(source.membership_rows||[]).map(clone_).sort(compareByFields_(['membership_rule_id','membership_version','aggregate_subject_id','category_id','effective_from'])),diagnostics:(source.diagnostics||[]).map(clone_).sort(compareByFields_(['severity','code','message']))};return hash_(canonical); }
  function statusSummary() { return {release_candidate:RELEASE,definition_contract_version:VERSION,mode:MODE,physical_writes:false,frozen_calculator_version:calculator_().Version,frozen_contract_version:contract_().Version,acceptance_status:'ACCEPTED_AND_CLOSED'}; }
  return Object.freeze({Version:VERSION,Release:RELEASE,Mode:MODE,BorshchName:BORSCH_NAME,BorshchProductGroup:BORSCH_PRODUCT_GROUP,buildDefinitions:buildDefinitions,buildBorshchDefinitions:buildBorshchDefinitions,buildAggregateMarkupDefinitions:buildAggregateMarkupDefinitions,resolveDefinitionsForPeriod:resolveDefinitionsForPeriod,buildDefinitionFingerprint:buildDefinitionFingerprint,statusSummary:statusSummary,Test:Object.freeze({clone:clone_,stableStringify:stableStringify_,hash:hash_,activeAt:activeAt_,definitionFamilyKey:definitionFamilyKey_,normalizeDefinition:normalizeDefinition_,normalizeMembershipRow:normalizeMembershipRow_,validateDefinitions:validateDefinitions_,validateMembershipRows:validateMembershipRows_,includeFlag:includeFlag_,definitionError:definitionError_})});
})();
