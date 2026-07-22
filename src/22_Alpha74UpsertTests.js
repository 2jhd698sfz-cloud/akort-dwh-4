var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Pure/model acceptance tests for Alpha.7.4 Incremental Aggregate Upsert. */
AKORT.Alpha74UpsertTests = (function () {
  var SUITE = 'ALPHA74_INCREMENTAL_AGGREGATE_UPSERT_CANDIDATE_R3';

  function clone_(v) { return AKORT.IncrementalAggregateUpsert.Test.clone(v); }
  function assert_(condition, message) { if (!condition) throw new Error(message || 'Assertion failed.'); }
  function equal_(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error((message || 'Values differ.') + ' actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
  }
  function throws_(fn, code) {
    var thrown = null;
    try { fn(); } catch (e) { thrown = e; }
    if (!thrown) throw new Error('Expected error ' + code + '.');
    if (code && String(thrown.code || '') !== code) throw new Error('Expected error ' + code + ', got ' + String(thrown.code || thrown.message || thrown) + '.');
    return thrown;
  }
  function definition_(overrides) {
    var d = {
      definition_id:'DEF_BASKET_WOW', definition_version:'D1', dataset_code:'AKORT', frequency:'weekly', aggregate_level:'basket',
      aggregate_subject_id:'BASKET_MAIN', aggregate_name:'Main basket', value_type:'retail_price', index_type:'wow',
      calculation_method:'NORMALIZED_WEIGHTED_AVERAGE', weight_rule_id:'W1', membership_rule_id:'M1', coverage_rule_id:'C1',
      output_unit:'percentage_point', weight_scope:'basket', effective_from:'2026-01-01', effective_to:'', status:'ACTIVE'
    };
    Object.keys(overrides || {}).forEach(function (k) { d[k] = overrides[k]; });
    return d;
  }
  function row_(period, value, latest, overrides) {
    var r = {
      dataset_code:'AKORT', source_name:'АКОРТ', frequency:'weekly', aggregate_level:'basket', aggregate_id:'', aggregate_name:'Main basket',
      category_id:'', product_group:'Basket', product_name:'Basket', value_type:'розница', index_type:'wow', period_start:period,
      year:Number(String(period).slice(0,4)), quarter:1, month:Number(String(period).slice(5,7)), period_label:period,
      category_value:'', category_change_pp:'', category_weight:'', aggregate_change_pp:value,
      contribution_to_group_change_pp:'', contribution_to_basket_change_pp:'', contribution_to_total_cpi_pp:'',
      weight_source:'W1', coverage_categories_count:3, coverage_weight_sum:1, is_latest_period:latest ? 1 : 0,
      aggregate_value:value, aggregate_base_value:value - 1
    };
    Object.keys(overrides || {}).forEach(function (k) { r[k] = overrides[k]; });
    if (!(overrides && overrides.aggregate_id !== undefined)) r.aggregate_id=AKORT.IncrementalAggregateUpsert.Test.legacyAggregateIdForRow(definition_(),r,period);
    var headers=AKORT.AggregateContract.Headers;r._number_formats=headers.map(function(h){return h==='period_start'?'dd.mm.yyyy':'General';});r._physical_types=headers.map(function(h){var v=r[h];if(h==='period_start')return'DATE';if(v===null||v===undefined||v==='')return'BLANK';if(typeof v==='number')return'NUMBER';if(typeof v==='boolean')return'BOOLEAN';return'STRING';});
    return r;
  }
  function planned_(definition, period, value, overrides) {
    var d = clone_(definition); d.period_start = period;
    var r = {
      dataset_code:d.dataset_code, frequency:d.frequency, aggregate_level:d.aggregate_level, aggregate_subject_id:d.aggregate_subject_id, aggregate_name:d.aggregate_name,
      category_id:d.category_id || '', product_group:d.product_group || '', value_type:d.value_type, index_type:d.index_type, period_start:period, calculation_method:d.calculation_method,
      aggregate_series_key:AKORT.AggregateContract.aggregateSeriesKey(d), aggregate_row_key:AKORT.AggregateContract.aggregateRowKey(d),
      category_value:'', category_change_pp:'', category_weight:'', aggregate_change_pp:value,
      contribution_to_group_change_pp:'', contribution_to_basket_change_pp:'', contribution_to_total_cpi_pp:'',
      weight_source:'W1', coverage_categories_count:3, coverage_weight_sum:1, aggregate_value:value, aggregate_base_value:value - 1,
      calculation_status:'READY', publication_allowed:true
    };
    Object.keys(overrides || {}).forEach(function (k) { r[k] = overrides[k]; });
    return r;
  }
  function request_(definition, kind, overrides) {
    var r = {
      operation_id:'OP-1', load_id:'LOAD-1', operation_kind:kind || 'REVISION', source_operation_status:'SUCCESS', accepted_base_tag:'v4.0.0-alpha.7.3-accepted',
      accepted_base_commit:'52590c8e036d49b9f76f87341b69881a916c851d', source_impacts:[{impact_id:'I1'}], definitions:[clone_(definition)],
      membership_snapshot:{snapshot_id:'M1',hash:'MH',rule_rows:[]}, weight_snapshot:{snapshot_id:'W1',hash:'WH',rule_rows:[]},
      frontier:{snapshot_id:'F1',hash:'FH',count:1,keys:{x:true}}, price_inputs:[], coverage_rules:[], base_inputs:[], calculator_options:{}
    };
    if (kind === 'REVERSAL') {
      r.has_current_effect=true;
      r.current_effect_row_keys=['PLACEHOLDER'];
      r.current_effect_evidence={status:'CURRENT_EFFECT_CONFIRMED',source_operation_id:'SOURCE-OP-1',row_keys:['PLACEHOLDER']};
      r.previous_price_inputs=[];
    }
    Object.keys(overrides || {}).forEach(function (k) { r[k] = overrides[k]; });
    if (kind === 'REVERSAL' && !(overrides && overrides.current_effect_evidence)) {
      r.current_effect_evidence={status:'CURRENT_EFFECT_CONFIRMED',source_operation_id:'SOURCE-OP-1',row_keys:clone_(r.current_effect_row_keys)};
    }
    return r;
  }
  function plan_(rows, intents, overrides) {
    var p = {ok:true,status:'SUCCESS',plan_id:'P1',fingerprint:'PF1',planned_rows:clone_(rows || []),latest_intents:clone_(intents || []),latest_conflicts:[],diagnostics:[]};
    Object.keys(overrides || {}).forEach(function (k) { p[k] = overrides[k]; });
    return p;
  }
  function fakePlanner_(definition, rows, intents, options) {
    var opts = options || {};
    function pre(input) {
      if (opts.failed) return {ok:false,status:'FAILED_CONTRACT',diagnostics:[{code:'X'}],latest_conflicts:[]};
      return {ok:true,status:opts.partial?'SUCCESS_WITH_BLOCKED':'SUCCESS',plan_id:'PRE',fingerprint:'PRE_FP',revision_items:[{status:'PLANNED',definition:clone_(definition)}],reversal_items:[{status:'PLANNED',definition:clone_(definition)}],planned_rows:input.execute_calculator ? clone_(rows || []) : [],latest_intents:input.execute_calculator ? clone_(intents || []) : [],latest_conflicts:opts.latestConflict ? [{series_key:'S'}] : [],summary:{blocked_items:opts.partial?1:0}};
    }
    return {planRevision:pre,planReversal:pre};
  }
  function canonicalKey_(definition, period) { var d=clone_(definition);d.period_start=period;return AKORT.AggregateContract.aggregateRowKey(d); }
  function seriesKey_(definition) { return AKORT.AggregateContract.aggregateSeriesKey(definition); }
  function modelItem_(model, action) { return model.items.filter(function (x) { return x.action === action; })[0]; }

  function physicalTemplate_(seriesKey, overrides) {
    var t={aggregate_series_key:seriesKey,metadata:{source_name:'АКОРТ',aggregate_name:'Main basket',product_group:'Basket',product_name:'Basket'},number_formats:AKORT.AggregateContract.Headers.map(function(h){return h==='period_start'?'dd.mm.yyyy':'General';})};
    Object.keys(overrides||{}).forEach(function(k){t[k]=overrides[k];});return t;
  }

  function runPureTests() {
    var tests = [], results = [];
    function test(id, name, fn) { tests.push({id:id,name:name,fn:fn}); }
    function skip(id, name) { tests.push({id:id,name:name,skip:true}); }
    var T = AKORT.IncrementalAggregateUpsert.Test, d = definition_(), series = seriesKey_(d), k1 = canonicalKey_(d,'2026-01-01'), k2 = canonicalKey_(d,'2026-01-08');

    test('IU74-001','public version/status metadata',function(){var s=AKORT.IncrementalAggregateUpsert.statusSummary();assert_(s.version==='4.0-incremental-aggregate-refresh-3');assert_(s.execution_enabled_default===false);assert_(s.actions.indexOf('INSERT')>=0);});
    test('IU74-002','accepted base is exact',function(){var r=request_(d,'REVISION');assert_(T.validateRequest(r).accepted_base_commit===r.accepted_base_commit);});
    test('IU74-003','wrong accepted base or upstream status rejected',function(){throws_(function(){T.validateRequest(request_(d,'REVISION',{accepted_base_commit:'bad'}));},'ALPHA74_ACCEPTED_BASE_MISMATCH');throws_(function(){T.validateRequest(request_(d,'REVISION',{source_operation_status:'FAILED'}));},'ALPHA74_SOURCE_OPERATION_NOT_SUCCESS');});
    test('IU74-004','external plan rejected',function(){throws_(function(){T.validateRequest(request_(d,'REVISION',{plan:{}}));},'ALPHA74_EXTERNAL_PLAN_REJECTED');});
    test('IU74-005','external mutations rejected',function(){throws_(function(){T.validateRequest(request_(d,'REVISION',{mutations:[]}));},'ALPHA74_EXTERNAL_PLAN_REJECTED');});
    test('IU74-006','operation kind validated',function(){throws_(function(){T.validateRequest(request_(d,'BAD'));},'ALPHA74_OPERATION_KIND_INVALID');});
    test('IU74-007','source impacts required',function(){throws_(function(){T.validateRequest(request_(d,'REVISION',{source_impacts:[]}));},'ALPHA74_SOURCE_IMPACTS_REQUIRED');});
    test('IU74-008','definitions required',function(){throws_(function(){T.validateRequest(request_(d,'REVISION',{definitions:[]}));},'ALPHA74_DEFINITIONS_REQUIRED');});
    test('IU74-009','reversal evidence required and exact-key bound',function(){var r=request_(d,'REVERSAL');delete r.current_effect_evidence;throws_(function(){T.validateRequest(r);},'ALPHA74_REVERSAL_EVIDENCE_REQUIRED');var mismatch=request_(d,'REVERSAL',{current_effect_row_keys:['A'],current_effect_evidence:{status:'CURRENT_EFFECT_CONFIRMED',source_operation_id:'S',row_keys:['B']}});throws_(function(){T.validateRequest(mismatch);},'ALPHA74_REVERSAL_EVIDENCE_BINDING_MISMATCH');});
    test('IU74-010','request fingerprint deterministic',function(){var r=request_(d,'REVISION');equal_(T.requestFingerprint(r),T.requestFingerprint(clone_(r)));});
    test('IU74-011','request artifact round trip',function(){var a=T.requestArtifact(request_(d,'REVISION'));var p=T.validateRequestArtifact(a.json,a.sha256);assert_(p.schema_version==='ALPHA74_AGGREGATE_REFRESH_REQUEST_V1');});
    test('IU74-012','request artifact tamper rejected',function(){var a=T.requestArtifact(request_(d,'REVISION'));throws_(function(){T.validateRequestArtifact(a.json+' ',a.sha256);},'ALPHA74_REQUEST_ARTIFACT_SHA_MISMATCH');});
    test('IU74-013','planner is planning-only and receives no candidate-only templates',function(){var seen=[];var fp={planRevision:function(i){seen.push({execute:i.execute_calculator,templates:i.physical_templates});return{ok:true,status:'SUCCESS',plan_id:'P',fingerprint:'F',calculator_batches:[],calculator_shared_input:{},planned_rows:[],latest_intents:[],latest_conflicts:[]};},planReversal:function(i){return this.planRevision(i);}};T.replayPlanner(request_(d,'REVISION',{physical_templates:[physicalTemplate_(series)]}),[],false,fp);assert_(seen[0].execute===false&&seen[0].templates===undefined);});
    test('IU74-014','planner failure and partial output rejected',function(){throws_(function(){T.replayPlanner(request_(d,'REVISION'),[],true,fakePlanner_(d,[],[],{failed:true}));},'ALPHA74_PLANNER_FAILED');throws_(function(){T.replayPlanner(request_(d,'REVISION'),[],true,fakePlanner_(d,[],[],{partial:true}));},'ALPHA74_PLANNER_PARTIAL_RESULT');});
    test('IU74-015','planner latest conflict rejected',function(){throws_(function(){T.replayPlanner(request_(d,'REVISION'),[],true,fakePlanner_(d,[],[],{latestConflict:true}));},'ALPHA74_LATEST_CONFLICT');});
    test('IU74-016','preplan affected family expands standard membership categories',function(){var gd=definition_({definition_id:'DEF_GROUP_WOW',aggregate_level:'group',aggregate_subject_id:'VEG',aggregate_name:'Vegetables',product_group:'Vegetables',calculation_method:'SUM_CONTRIBUTIONS',membership_rule_id:'MG'}),member={membership_rule_id:'MG',aggregate_subject_id:'VEG',category_id:'C1',effective_from:'2026-01-01',effective_to:'',status:'ACTIVE',include_flag:1},req=request_(gd,'REVISION',{membership_snapshot:{snapshot_id:'M1',hash:'MH',rule_rows:[member]}}),pre={revision_items:[{status:'PLANNED',definition:clone_(gd),target_period:'2026-01-08'}]},synthetic=T.syntheticCategoryDefinition(gd,'C1'),affected=T.preplanAffectedVisibleSeries(pre,req);equal_(affected,[T.definitionVisibleKey(synthetic),T.definitionVisibleKey(gd)].sort());assert_(affected.indexOf(T.definitionVisibleKey(synthetic))>=0);});
    test('IU74-017','physical aggregate and category rows resolve to canonical identities',function(){var physical=row_('2026-01-01',5,true);assert_(physical.aggregate_id!==d.aggregate_subject_id);var scan=T.canonicalTargetRows([physical],[d],[]);assert_(scan.by_key[k1]);assert_(scan.by_key[k1].aggregate_series_key===series);assert_(T.physicalTargetKey(physical).indexOf(physical.aggregate_id)>=0);var gd=definition_({definition_id:'DEF_GROUP_WOW',aggregate_level:'group',aggregate_subject_id:'VEG',aggregate_name:'Vegetables',product_group:'Vegetables',calculation_method:'SUM_CONTRIBUTIONS',membership_rule_id:'MG'}),member={membership_rule_id:'MG',aggregate_subject_id:'VEG',category_id:'C1',effective_from:'2026-01-01',effective_to:'',status:'ACTIVE',include_flag:1},synthetic=T.syntheticCategoryDefinition(gd,'C1'),category=row_('2026-01-01',5,true,{aggregate_level:'category',aggregate_name:'Вклад категории',category_id:'C1',product_group:'Vegetables',product_name:'Category 1',aggregate_id:'TEMP',category_value:100,category_change_pp:5,category_weight:0.2,aggregate_change_pp:'',contribution_to_group_change_pp:1,coverage_categories_count:'',coverage_weight_sum:'',aggregate_value:'',aggregate_base_value:''});category.aggregate_id=T.legacyAggregateIdForRow(synthetic,category,'2026-01-01');var categoryScan=T.canonicalTargetRows([category],[gd],[member]),expected=clone_(synthetic);expected.period_start='2026-01-01';assert_(categoryScan.rows[0].aggregate_row_key===AKORT.AggregateContract.aggregateRowKey(expected));});
    test('IU74-018','duplicate target canonical key rejected',function(){throws_(function(){T.canonicalTargetRows([row_('2026-01-01',5,true),row_('2026-01-01',6,false)],[d]);},'ALPHA74_TARGET_DUPLICATE_CANONICAL_KEY');});
    test('IU74-019','missing active definition rejected',function(){throws_(function(){T.canonicalTargetRows([row_('2025-01-01',5,true)],[d]);},'ALPHA74_CANONICAL_DEFINITION_AMBIGUOUS');});
    test('IU74-020','insert new period and latest update',function(){var pr=planned_(d,'2026-01-08',7),pl=plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:k1,next_latest_row_key:k2}]);var m=T.buildMutationModel(request_(d,'NEW_PERIOD'),pl,[row_('2026-01-01',5,true)]);assert_(m.counts.INSERT===1);assert_(m.counts.LATEST===1);});
    test('IU74-021','update existing period',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]);assert_(m.counts.UPDATE===1);assert_(modelItem_(m,'UPDATE').after.aggregate_value===8);});
    test('IU74-022','identical result becomes NOOP',function(){var pr=planned_(d,'2026-01-01',5),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]);assert_(m.counts.NOOP===1);});
    test('IU74-023','reversal deletes only exact evidence key and blocks absent target',function(){var r=request_(d,'REVERSAL',{current_effect_row_keys:[k2]}),pl=plan_([],[{aggregate_series_key:series,previous_latest_row_key:k2,next_latest_row_key:k1}]),m=T.buildMutationModel(r,pl,[row_('2026-01-01',5,false),row_('2026-01-08',7,true)]);assert_(m.counts.DELETE===1);assert_(modelItem_(m,'DELETE').canonical_row_key===k2);throws_(function(){T.buildMutationModel(r,plan_([],[]),[row_('2026-01-01',5,true)]);},'ALPHA74_REVERSAL_TARGET_ROW_MISSING');});
    test('IU74-024','revision never deletes row keys',function(){var r=request_(d,'REVISION',{current_effect_row_keys:[k2]}),m=T.buildMutationModel(r,plan_([],[]),[row_('2026-01-08',7,true)]);assert_(m.counts.DELETE===0);});
    test('IU74-025','insert requires existing series template',function(){var pr=planned_(d,'2026-01-08',7);throws_(function(){T.buildMutationModel(request_(d,'NEW_PERIOD'),plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:'',next_latest_row_key:k2}]),[]);},'ALPHA74_INSERT_TEMPLATE_MISSING');});
    test('IU74-026','conflicting template metadata rejected',function(){var pr=planned_(d,'2026-01-15',9),rows=[row_('2026-01-01',5,false),row_('2026-01-08',7,true,{product_name:'Other physical label'})];throws_(function(){T.buildMutationModel(request_(d,'NEW_PERIOD'),plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:k2,next_latest_row_key:canonicalKey_(d,'2026-01-15')}]),rows);},'ALPHA74_TEMPLATE_METADATA_CONFLICT');});
    test('IU74-027','planned identity mismatch rejected',function(){var pr=planned_(d,'2026-01-08',7,{dataset_code:'OTHER'});throws_(function(){T.buildAfterRow(pr,row_('2026-01-01',5,true),true);},'ALPHA74_PLANNED_IDENTITY_MISMATCH');});
    test('IU74-028','duplicate planned key rejected',function(){var pr=planned_(d,'2026-01-01',5);throws_(function(){T.buildMutationModel(request_(d,'REVISION'),plan_([pr,clone_(pr)],[]),[row_('2026-01-01',5,true)]);},'ALPHA74_DUPLICATE_PLANNED_ROW_KEY');});
    test('IU74-029','multiple latest before change rejected',function(){var pr=planned_(d,'2026-01-01',5);throws_(function(){T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true),row_('2026-01-08',7,true)]);},'ALPHA74_LATEST_PRECHANGE_CONFLICT');});
    test('IU74-030','latest intent must resolve to row',function(){var pr=planned_(d,'2026-01-01',5);throws_(function(){T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[{aggregate_series_key:series,next_latest_row_key:'missing'}]),[row_('2026-01-01',5,true)]);},'ALPHA74_LATEST_TARGET_MISSING');});
    test('IU74-031','weight_source participates in fingerprint',function(){var a=row_('2026-01-01',5,true),b=clone_(a);b.weight_source='W2';assert_(T.rowFingerprint(a)!==T.rowFingerprint(b));});
    test('IU74-032','numeric and text cell types differ',function(){var a=row_('2026-01-01',5,true),b=clone_(a);b.aggregate_value='5';b._physical_types[AKORT.AggregateContract.Headers.indexOf('aggregate_value')]='STRING';assert_(T.rowFingerprint(a)!==T.rowFingerprint(b));});
    test('IU74-033','physical row order changes inventory fingerprint',function(){var a=row_('2026-01-01',5,false),b=row_('2026-01-08',7,true);assert_(T.inventoryFingerprint([a,b])!==T.inventoryFingerprint([b,a]));});
    test('IU74-034','unrelated fingerprint ignores affected changes',function(){var a=row_('2026-01-01',5,true),u=row_('2026-01-01',3,true,{aggregate_id:'OTHER',aggregate_name:'Other'}),u2=clone_(u);var affected=[T.visibleSeriesKey(a)];var f1=T.unrelatedFingerprintChunked([a,u],affected,10);a.aggregate_value=9;var f2=T.unrelatedFingerprintChunked([a,u2],affected,10);equal_(f1,f2);});
    test('IU74-035','unrelated fingerprint detects unrelated change',function(){var a=row_('2026-01-01',5,true),u=row_('2026-01-01',3,true,{aggregate_id:'OTHER',aggregate_name:'Other'}),affected=[T.visibleSeriesKey(a)],f1=T.unrelatedFingerprintChunked([a,u],affected,10);u.aggregate_value=4;assert_(f1!==T.unrelatedFingerprintChunked([a,u],affected,10));});
    test('IU74-036','batch id deterministic',function(){equal_(T.batchId('R','P','UPDATE',['b','a']),T.batchId('R','P','UPDATE',['a','b']));});
    test('IU74-037','batch id changes with phase',function(){assert_(T.batchId('R','P1','UPDATE',['a'])!==T.batchId('R','P2','UPDATE',['a']));});
    test('IU74-038','write cutoff pauses before new mutation',function(){var r=T.shouldPause(0,100000,{},'WRITE');assert_(r.pause&&r.reason==='WRITE_START_CUTOFF');});
    test('IU74-039','safe time margin continues',function(){var r=T.shouldPause(0,1000,{},true);assert_(!r.pause);});
    test('IU74-040','calculation cutoff pauses before new item',function(){var r=T.shouldPause(0,151000,{},'CALCULATION');assert_(r.pause&&r.reason==='CALCULATION_CUTOFF');});
    test('IU74-041','all after classifies committed',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]),item=modelItem_(m,'UPDATE'),map={};map[k1]=item.after;assert_(T.classifyBatchOutcome([item],map).status==='COMMITTED');});
    test('IU74-042','all before classifies retry safe',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]),item=modelItem_(m,'UPDATE'),map={};map[k1]=item.before;assert_(T.classifyBatchOutcome([item],map).status==='RETRY_SAFE');});
    test('IU74-043','third state requires review',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]),item=modelItem_(m,'UPDATE'),map={};map[k1]=row_('2026-01-01',99,true);assert_(T.classifyBatchOutcome([item],map).status==='FAILED_REQUIRES_REVIEW');});
    test('IU74-044','rollback all before is restored',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]),item=modelItem_(m,'UPDATE'),map={};map[k1]=item.before;assert_(T.classifyRollbackOutcome([item],map).status==='RESTORED');});
    test('IU74-045','model application is idempotent by storage key',function(){var pr=planned_(d,'2026-01-08',7),m=T.buildMutationModel(request_(d,'NEW_PERIOD'),plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:k1,next_latest_row_key:k2}]),[row_('2026-01-01',5,true)]),once=T.applyModelToRows([row_('2026-01-01',5,true)],m),twice=T.applyModelToRows(once,m);assert_(once.length===twice.length);equal_(once.map(T.storageKey),twice.map(T.storageKey));});
    test('IU74-046','period parts weekly',function(){equal_(T.periodParts('weekly','2026-07-15'),{key:'2026-07-15',year:2026,quarter:3,month:7,label:'2026-07-15'});});
    test('IU74-047','monthly date extended value uses first day',function(){var v=T.extendedValue('period_start','2026-07',{frequency:'monthly'});assert_(typeof v.numberValue==='number'&&v.numberValue>40000);});
    test('IU74-048','numeric extended value',function(){equal_(T.extendedValue('aggregate_value','5.5',{frequency:'weekly'}),{numberValue:5.5});});
    test('IU74-049','blank extended value',function(){equal_(T.extendedValue('aggregate_value','',{frequency:'weekly'}),{});});
    test('IU74-050','service table schemas and phase progression',function(){assert_(AKORT.IncrementalAggregateUpsert.RunHeaders.indexOf('heartbeat_at')>=0);assert_(AKORT.IncrementalAggregateUpsert.QueueHeaders.indexOf('result_artifact_id')>=0);assert_(T.nextPhase('VERIFY_MODEL_QUEUE')==='BUILD_WRITE_BATCHES');assert_(T.nextPhase('BACKUP_CAPTURE')==='APPLY_WRITE_BATCHES');});

    test('IU74-051','calculation item identity is deterministic',function(){equal_(T.calculationItemId('R','C1'),T.calculationItemId('R','C1'));assert_(T.calculationItemId('R','C1')!==T.calculationItemId('R','C2'));});
    test('IU74-052','calculation set digest is order independent',function(){var a={item_id:'I1',calculation_id:'C1',input_fingerprint:'A',before_fingerprint:'B'},b={item_id:'I2',calculation_id:'C2',input_fingerprint:'C',before_fingerprint:'D'};equal_(T.calculationSetDigest([a,b]),T.calculationSetDigest([b,a]));});
    test('IU74-053','calculation set digest detects missing item',function(){var a={item_id:'I1',calculation_id:'C1',input_fingerprint:'A',before_fingerprint:'B'},b={item_id:'I2',calculation_id:'C2',input_fingerprint:'C',before_fingerprint:'D'};assert_(T.calculationSetDigest([a,b])!==T.calculationSetDigest([a]));});
    test('IU74-054','mutation model stores exact count and digest',function(){var pr=planned_(d,'2026-01-01',8),m=T.buildMutationModel(request_(d,'REVISION'),plan_([pr],[]),[row_('2026-01-01',5,true)]);assert_(m.item_count===m.items.length);assert_(m.item_digest===T.mutationSetDigest(m.items));});
    test('IU74-055','mutation set digest is order independent',function(){var pr=planned_(d,'2026-01-08',7),m=T.buildMutationModel(request_(d,'NEW_PERIOD'),plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:k1,next_latest_row_key:k2}]),[row_('2026-01-01',5,true)]);equal_(T.mutationSetDigest(m.items),T.mutationSetDigest(m.items.slice().reverse()));});
    test('IU74-056','exact set proof rejects missing work item',function(){var a={item_id:'I1',calculation_id:'C1',input_fingerprint:'A',before_fingerprint:'B'},b={item_id:'I2',calculation_id:'C2',input_fingerprint:'C',before_fingerprint:'D'};throws_(function(){T.proveExactSet([a,b],[a],function(x){return [x.item_id,x.calculation_id,x.input_fingerprint,x.before_fingerprint].join('|');},'ALPHA74_CALCULATION_QUEUE_INCOMPLETE');},'ALPHA74_CALCULATION_QUEUE_INCOMPLETE');});
    test('IU74-057','exact set proof rejects duplicate binding',function(){var a={item_id:'I1',calculation_id:'C1',input_fingerprint:'A',before_fingerprint:'B'};throws_(function(){T.proveExactSet([a],[a,clone_(a)],function(x){return [x.item_id,x.calculation_id,x.input_fingerprint,x.before_fingerprint].join('|');},'ALPHA74_CALCULATION_QUEUE_INCOMPLETE');},'ALPHA74_CALCULATION_QUEUE_INCOMPLETE');});
    test('IU74-058','calculator batch hydration preserves durable calculation id',function(){var b={contract_version:'C',calculation_id:'CALC1',impact_items:[{impact_id:'I'}],aggregate_definitions:[d]},shared={price_inputs:[{x:1}],weight_snapshot:{snapshot_id:'W'},membership_snapshot:{snapshot_id:'M'},coverage_rules:[],base_inputs:[],options:{}};var h=T.hydrateCalculatorBatch(b,shared);assert_(h.calculation_id==='CALC1');assert_(h.price_inputs.length===1);});
    test('IU74-059','publishable rows and cross-batch category contributions merge',function(){var rows=T.publishableRowsFromCalculation({ok:true,status:'SUCCESS',rows:[{row_type:'AGGREGATE_RESULT',aggregate_row_key:'A',publication_allowed:true,calculation_status:'READY'},{row_type:'AGGREGATE_RESULT',aggregate_row_key:'B',publication_allowed:true,calculation_status:'NOT_APPLICABLE'}]});assert_(rows.length===1&&rows[0].aggregate_row_key==='A');var base={row_type:'CATEGORY_CONTRIBUTION',aggregate_row_key:'CAT',dataset_code:'AKORT',frequency:'weekly',aggregate_level:'category',aggregate_subject_id:'C1',category_id:'C1',value_type:'retail_price',index_type:'wow',period_start:'2026-01-01',calculation_method:'CATEGORY_CONTRIBUTION',weight_rule_id:'W1',category_value:10,category_change_pp:1,category_weight:0.2,contribution_to_group_change_pp:0.2,contribution_to_basket_change_pp:null,contribution_to_total_cpi_pp:null,calculation_id:'C1',calculation_status:'READY',publication_allowed:true,source_impacts:[{impact_id:'I1',combo_key:'K1'}]},incoming=clone_(base);incoming.calculation_id='C2';incoming.contribution_to_group_change_pp=null;incoming.contribution_to_basket_change_pp=0.2;incoming.source_impacts=[{impact_id:'I2',combo_key:'K2'}];var merged=T.mergeCalculatedCategoryRow(base,incoming);assert_(merged.contribution_to_group_change_pp===0.2&&merged.contribution_to_basket_change_pp===0.2);assert_(merged.calculation_ids.length===2&&merged.source_impacts.length===2);});
    test('IU74-060','non-publishable aggregate result blocks assembly',function(){throws_(function(){T.publishableRowsFromCalculation({ok:true,status:'SUCCESS',rows:[{row_type:'AGGREGATE_RESULT',aggregate_row_key:'A',publication_allowed:false,calculation_status:'PARTIAL_NOT_PUBLISHABLE'}]});},'ALPHA74_CALCULATION_NOT_PUBLISHABLE');});
    test('IU74-061','calculation failure is fail closed',function(){throws_(function(){T.publishableRowsFromCalculation({ok:false,status:'FAILED_CONTRACT',rows:[]});},'ALPHA74_CALCULATION_FAILED_CONTRACT');});
    test('IU74-062','phase order includes durable calculation graph',function(){assert_(T.nextPhase('BUILD_PLAN')==='MATERIALIZE_CALC_QUEUE');assert_(T.nextPhase('MATERIALIZE_CALC_QUEUE')==='CALCULATE_SLICES');assert_(T.nextPhase('VERIFY_CALC_SET')==='ASSEMBLE_MODEL');});
    test('IU74-063','run schema stores run-scoped queue ranges',function(){var h=AKORT.IncrementalAggregateUpsert.RunHeaders;['scan_queue_start_row','calculation_queue_start_row','mutation_queue_start_row','calculation_item_digest','mutation_item_digest'].forEach(function(x){assert_(h.indexOf(x)>=0);});});
    test('IU74-064','queue schema stores calculation result evidence',function(){var h=AKORT.IncrementalAggregateUpsert.QueueHeaders;['calculation_id','input_fingerprint','result_artifact_id','result_sha256','result_fingerprint'].forEach(function(x){assert_(h.indexOf(x)>=0);});});
    test('IU74-065','versioned cutoffs are ordered and invalid order rejected',function(){var c=T.config({});assert_(c.write_start_cutoff_ms<c.calculation_cutoff_ms&&c.calculation_cutoff_ms<c.finalization_start_ms&&c.finalization_start_ms<c.total_budget_ms);throws_(function(){T.config({write_start_cutoff_ms:200000,calculation_cutoff_ms:100000});},'ALPHA74_TIME_CONFIG_INVALID');});

    test('IU74-081','scan chunk accumulates non-empty unrelated baseline',function(){var a=row_('2026-01-01',5,true,{_physical_row_number:2}),u=row_('2026-01-08',7,false,{aggregate_name:'Unrelated',product_name:'Unrelated',_physical_row_number:3});var part=T.scanChunkPartition([a,u],[T.visibleSeriesKey(a)],'R','B',2);assert_(part.cache.length===1);assert_(part.unrelated_accumulator.count===1);equal_(AKORT.IncrementalAggregateUpsert.Test.hash(part.unrelated_accumulator),T.unrelatedFingerprint([u],[]));});
    test('IU74-082','unchanged unrelated baseline passes forward verification model',function(){var rows=[row_('2026-01-01',5,true),row_('2026-01-08',7,false,{aggregate_name:'U',product_name:'U'})],affected=[T.visibleSeriesKey(rows[0])],before=T.unrelatedFingerprintChunked(rows,affected,1),after=T.unrelatedFingerprintChunked(clone_(rows),affected,2);equal_(before,after);});
    test('IU74-083','same unrelated baseline passes rollback precheck and verification',function(){var rows=[row_('2026-01-01',5,true,{aggregate_name:'A'}),row_('2026-01-08',7,false,{aggregate_name:'U',product_name:'U'})],affected=[T.visibleSeriesKey(rows[0])],baseline=T.unrelatedFingerprintChunked(rows,affected,1);equal_(baseline,T.unrelatedFingerprintChunked(rows.slice().reverse(),affected,2));});
    test('IU74-084','forward retry budget is independent',function(){var q={item_id:'I',attempt_count:0,forward_attempt_count:2,rollback_attempt_count:0},cfg=T.config({});T.advanceAttemptBudget(q,cfg,'FORWARD');assert_(q.forward_attempt_count===3&&q.rollback_attempt_count===0&&q.attempt_count===1);throws_(function(){T.advanceAttemptBudget(q,cfg,'FORWARD');},'ALPHA74_RETRY_EXHAUSTED');});
    test('IU74-085','rollback retry remains available after forward exhaustion',function(){var q={item_id:'I',attempt_count:3,forward_attempt_count:3,rollback_attempt_count:0},cfg=T.config({});T.advanceAttemptBudget(q,cfg,'ROLLBACK');assert_(q.forward_attempt_count===3&&q.rollback_attempt_count===1);});
    test('IU74-086','active delete geometry uses only applied durable deletes',function(){equal_(T.activeDeleteHintsFromRows([{action:'DELETE',status:'PENDING',physical_row_hint:3},{action:'DELETE',status:'APPLIED',physical_row_hint:7},{action:'DELETE',status:'ROLLED_BACK',physical_row_hint:9}]),[7]);});
    test('IU74-087','effective row reflects only physically active deletes',function(){var item={action:'UPDATE',physical_row_hint:10};assert_(T.effectiveRow(item,false,[3,7])===8);assert_(T.effectiveRow({action:'DELETE',physical_row_hint:10},false,[3,7])===8);assert_(T.effectiveRow(item,true,[3,7])===8);});
    test('IU74-088','mutation binding proves physical address and write batch',function(){var a={item_id:'I',action:'UPDATE',canonical_row_key:'K',canonical_series_key:'S',storage_key:'P',physical_row_hint:10,write_batch_id:'B',before_fingerprint:'X',after_fingerprint:'Y'},b=clone_(a);b.physical_row_hint=11;assert_(T.mutationBinding(a)!==T.mutationBinding(b));b=clone_(a);b.write_batch_id='B2';assert_(T.mutationBinding(a)!==T.mutationBinding(b));});
    test('IU74-089','insert physical hints and digest are deterministic',function(){var items=[{action:'INSERT',canonical_row_key:'K2',canonical_series_key:'S2',before_fingerprint:'',after_fingerprint:'A',storage_key:'P2'},{action:'INSERT',canonical_row_key:'K1',canonical_series_key:'S1',before_fingerprint:'',after_fingerprint:'B',storage_key:'P1'}],a=T.finalizePhysicalPlan(items,10,T.config({})),b=T.finalizePhysicalPlan(items.slice().reverse(),10,T.config({}));equal_(a.insert_hint_digest,b.insert_hint_digest);equal_(a.items.map(function(x){return[x.canonical_row_key,x.physical_row_hint];}).sort(),b.items.map(function(x){return[x.canonical_row_key,x.physical_row_hint];}).sort());});
    test('IU74-090','canonical series bundle is indivisible',function(){var items=[];for(var i=0;i<3;i++)items.push({item_id:'I'+i,action:'UPDATE',canonical_row_key:'K'+i,canonical_series_key:'S',storage_key:'P'+i,physical_row_hint:i+2,before_fingerprint:'B'+i,after_fingerprint:'A'+i,write_batch_id:''});var batches=T.buildWriteBatches(items,T.config({mutation_batch_rows:3}));assert_(batches.length===1&&batches[0].item_ids.length===3&&batches[0].series_keys[0]==='S');});
    test('IU74-091','write batches enforce rows payload and series limits',function(){var cfg=T.config({mutation_batch_rows:2,mutation_batch_series:1,mutation_batch_payload_bytes:100000}),items=[{item_id:'A',action:'UPDATE',canonical_row_key:'A',canonical_series_key:'S1',storage_key:'A',physical_row_hint:2,before_fingerprint:'B',after_fingerprint:'C'},{item_id:'B',action:'UPDATE',canonical_row_key:'B',canonical_series_key:'S2',storage_key:'B',physical_row_hint:3,before_fingerprint:'B',after_fingerprint:'C'}];assert_(T.buildWriteBatches(items,cfg).length===2);var too=items.concat([{item_id:'C',action:'UPDATE',canonical_row_key:'C',canonical_series_key:'S1',storage_key:'C',physical_row_hint:4,before_fingerprint:'B',after_fingerprint:'C'},{item_id:'D',action:'UPDATE',canonical_row_key:'D',canonical_series_key:'S1',storage_key:'D',physical_row_hint:5,before_fingerprint:'B',after_fingerprint:'C'}]);throws_(function(){T.buildWriteBatches(too,cfg);},'ALPHA74_SERIES_BUNDLE_TOO_LARGE');throws_(function(){T.buildWriteBatches([items[0]],T.config({mutation_batch_payload_bytes:10}));},'ALPHA74_SERIES_BUNDLE_TOO_LARGE');});
    test('IU74-092','write batch plan and digest are deterministic',function(){var items=[{item_id:'A',action:'UPDATE',canonical_row_key:'A',canonical_series_key:'S1',storage_key:'A',physical_row_hint:2,before_fingerprint:'B',after_fingerprint:'C'},{item_id:'B',action:'INSERT',canonical_row_key:'B',canonical_series_key:'S2',storage_key:'B',physical_row_hint:4,before_fingerprint:'',after_fingerprint:'C'}],a=T.buildWriteBatches(clone_(items),T.config({})),b=T.buildWriteBatches(clone_(items).reverse(),T.config({}));equal_(T.writeBatchDigest(a),T.writeBatchDigest(b));assert_(a.every(function(batch){return batch.series_keys.every(function(series){return !a.some(function(other){return other!==batch&&other.series_keys.indexOf(series)>=0;});});}));});
    test('IU74-093','new physical aggregate series uses immutable contract template',function(){var pr=planned_(d,'2026-01-08',7),req=request_(d,'NEW_PERIOD',{physical_templates:[physicalTemplate_(series)]}),m=T.buildMutationModel(req,plan_([pr],[{aggregate_series_key:series,previous_latest_row_key:'',next_latest_row_key:k2}]),[],{target_last_row:1}),item=modelItem_(m,'INSERT');assert_(item&&item.after._contract_template===true);assert_(item.after.source_name==='АКОРТ'&&item.physical_row_hint===2);});
    test('IU74-094','new physical value type and category series are supported by contract template',function(){var cd=definition_({definition_id:'DC',aggregate_level:'category',aggregate_subject_id:'C1',category_id:'C1',aggregate_name:'C1',value_type:'purchase_price',calculation_method:'CATEGORY_CONTRIBUTION',membership_rule_id:''}),cs=seriesKey_(cd),ck=canonicalKey_(cd,'2026-01-08'),pr=planned_(cd,'2026-01-08',4,{category_id:'C1'}),req=request_(cd,'NEW_PERIOD',{physical_templates:[physicalTemplate_(cs,{metadata:{source_name:'АКОРТ',aggregate_name:'C1',product_group:'Vegetables',product_name:'C1'}})]}),m=T.buildMutationModel(req,plan_([pr],[{aggregate_series_key:cs,previous_latest_row_key:'',next_latest_row_key:ck}]),[],{target_last_row:1}),item=modelItem_(m,'INSERT');assert_(item.after.value_type==='закупка'&&item.after.category_id==='C1');});
    test('IU74-095','missing or duplicate new-series template fails closed',function(){var pr=planned_(d,'2026-01-08',7);throws_(function(){T.buildMutationModel(request_(d,'NEW_PERIOD'),plan_([pr],[{aggregate_series_key:series,next_latest_row_key:k2}]),[],{target_last_row:1});},'ALPHA74_INSERT_TEMPLATE_MISSING');var t=physicalTemplate_(series);throws_(function(){T.validateRequest(request_(d,'NEW_PERIOD',{physical_templates:[t,clone_(t)]}));},'ALPHA74_PHYSICAL_TEMPLATE_DUPLICATE');});
    test('IU74-096','partial category contribution set is rejected',function(){throws_(function(){T.publishableRowsFromCalculation({ok:true,status:'SUCCESS',rows:[{row_type:'AGGREGATE_RESULT',aggregate_row_key:'A',publication_allowed:true,calculation_status:'READY'},{row_type:'CATEGORY_CONTRIBUTION',aggregate_row_key:'C',publication_allowed:false,calculation_status:'MISSING'}]});},'ALPHA74_PARTIAL_CONTRIBUTION_SET_FORBIDDEN');});
    test('IU74-097','complete category contribution set is accepted',function(){var rows=T.publishableRowsFromCalculation({ok:true,status:'SUCCESS',rows:[{row_type:'AGGREGATE_RESULT',aggregate_row_key:'A',publication_allowed:true,calculation_status:'READY'},{row_type:'CATEGORY_CONTRIBUTION',aggregate_row_key:'C',publication_allowed:true,calculation_status:'READY'}]});assert_(rows.length===2);});
    test('IU74-098','target contract requires exactly 29 columns',function(){assert_(T.validateTargetContractMetadata({max_columns:AKORT.AggregateContract.Headers.length,headers:AKORT.AggregateContract.Headers}).contract.indexOf('EXACT_29')===0);throws_(function(){T.validateTargetContractMetadata({max_columns:30,headers:AKORT.AggregateContract.Headers});},'ALPHA74_TARGET_COLUMN_CONTRACT_MISMATCH');});
    test('IU74-099','value-only target rejects formulas notes validations and merges',function(){throws_(function(){T.assertValueOnlyChunk([['=1']],[[null]],[[null]],0);},'ALPHA74_TARGET_NOT_VALUE_ONLY');throws_(function(){T.assertValueOnlyChunk([['']],[['note']],[[null]],0);},'ALPHA74_TARGET_NOT_VALUE_ONLY');throws_(function(){T.assertValueOnlyChunk([['']],[[null]],[[{}]],0);},'ALPHA74_TARGET_NOT_VALUE_ONLY');throws_(function(){T.assertValueOnlyChunk([['']],[[null]],[[null]],1);},'ALPHA74_TARGET_NOT_VALUE_ONLY');assert_(T.assertAdvancedValueOnlyGrid({sheets:[{data:[{rowData:[{values:[{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0.00'}}}]}]}]}]}));throws_(function(){T.assertAdvancedValueOnlyGrid({sheets:[{data:[{rowData:[{values:[{textFormatRuns:[{startIndex:0,format:{bold:true}}]}]}]}]}]});},'ALPHA74_TARGET_NOT_VALUE_ONLY');throws_(function(){T.assertAdvancedValueOnlyGrid({sheets:[{data:[{rowData:[{values:[{userEnteredFormat:{backgroundColor:{red:1}}}]}]}]}]});},'ALPHA74_TARGET_NOT_VALUE_ONLY');throws_(function(){T.assertAdvancedValueOnlyGrid({sheets:[{data:[{rowMetadata:[{pixelSize:30}]}]}]});},'ALPHA74_TARGET_NOT_VALUE_ONLY');});
    test('IU74-100','rollback row payload covers all contract values and number formats',function(){var r=row_('2026-01-01',5,true),payload=T.updateCellsRow(AKORT.AggregateContract.Headers,r,true);assert_(payload.values.length===AKORT.AggregateContract.Headers.length);assert_(payload.values.every(function(x){return x.userEnteredFormat&&x.userEnteredFormat.numberFormat;}));});
    test('IU74-101','schemas bind batch id physical hint and independent retries',function(){var q=AKORT.IncrementalAggregateUpsert.QueueHeaders,r=AKORT.IncrementalAggregateUpsert.RunHeaders;['write_batch_id','forward_attempt_count','rollback_attempt_count'].forEach(function(x){assert_(q.indexOf(x)>=0);});['write_batch_count','write_batch_digest','insert_hint_digest','target_contract_fingerprint'].forEach(function(x){assert_(r.indexOf(x)>=0);});});
    test('IU74-102','phase order materializes bundles and uses bundle rollback',function(){assert_(T.nextPhase('VERIFY_MODEL_QUEUE')==='BUILD_WRITE_BATCHES');assert_(T.nextPhase('BUILD_WRITE_BATCHES')==='BACKUP_CREATE');assert_(T.nextPhase('BACKUP_CAPTURE')==='APPLY_WRITE_BATCHES');assert_(AKORT.IncrementalAggregateUpsert.Phases.indexOf('APPLY_ROLLBACK_BATCHES')>=0);});
    test('IU74-103','candidate-r3 declares closed P0/P1 safety policies',function(){var s=AKORT.IncrementalAggregateUpsert.statusSummary();assert_(s.version==='4.0-incremental-aggregate-refresh-3');assert_(s.queue_binding==='EXACT_MODEL_PHYSICAL_HINT_WRITE_BATCH_BINDING');assert_(s.write_batching==='INDIVISIBLE_CANONICAL_SERIES_BUNDLES');assert_(s.new_series_support==='IMMUTABLE_PHYSICAL_TEMPLATE_REGISTRY');assert_(s.partial_contribution_policy==='FAIL_CLOSED');assert_(s.target_contract.indexOf('EXACT_29')===0);});

    skip('IU74-066','isolated service-table installation and schema migration');
    skip('IU74-067','isolated request/plan/calculation artifact Drive read-back');
    skip('IU74-068','61,636-row scan with durable chunk checkpoints');
    skip('IU74-069','NEW_PERIOD physical INSERT and read-back');
    skip('IU74-070','REVISION physical UPDATE and read-back');
    skip('IU74-071','REVERSAL evidence-backed DELETE and read-back');
    skip('IU74-072','NOOP creates no target mutation');
    skip('IU74-073','timeout during calculation resumes from calculation_id');
    skip('IU74-074','timeout after batchUpdate before checkpoint recovers by read-back');
    skip('IU74-075','lost API response classifies exact after-state as committed');
    skip('IU74-076','mixed/third target state fails closed');
    skip('IU74-077','dispatcher resumes all phases without duplicate rows');
    skip('IU74-078','targeted rollback restores affected before-state');
    skip('IU74-079','chunked final and rollback unrelated verification');
    skip('IU74-080','authoritative DEV canary and previous-suite compatibility');

    tests.forEach(function (t) {
      if (t.skip) { results.push({id:t.id,name:t.name,status:'SKIP',reason:'PHYSICAL_DEV_GATE_NOT_EXECUTED'}); return; }
      try { t.fn(); results.push({id:t.id,name:t.name,status:'PASS'}); }
      catch (e) { results.push({id:t.id,name:t.name,status:'FAIL',error:String(e && e.message || e),code:String(e && e.code || '')}); }
    });
    var passed=results.filter(function(r){return r.status==='PASS';}).length,failed=results.filter(function(r){return r.status==='FAIL';}).length,skipped=results.filter(function(r){return r.status==='SKIP';}).length;
    return {ok:failed===0,status:failed?'FAILED':'PASS',suite:SUITE,total:results.length,passed:passed,failed:failed,skipped:skipped,physical_writes:false,results:results};
  }

  return Object.freeze({Version:'4.0-alpha74-upsert-tests-3',runPureTests:runPureTests});
})();
