var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};
AKORT.Alpha6Tests = (function(){
  function test_(id,fn){try{return{id:id,status:'PASS',data:fn(),error:null};}catch(e){return{id:id,status:'FAIL',data:null,error:String(e.message||e)};}}
  function approx_(a,b,t){if(Math.abs(Number(a)-Number(b))>Number(t||1e-6))throw new Error('Expected '+b+', got '+a);}
  function set_(values){var out={};(values||[]).forEach(function(v){out[String(v)]=true;});return out;}
  function runSmokeTest(){return AKORT.Core.safeRun('ALPHA6_SMOKE_TEST',function(){AKORT.EnvironmentGuard.assertDev();var T=AKORT.IncrementalPublish.Test,tests=[];
    tests.push(test_('publish_contract_scope_corrected',function(){var s=AKORT.IncrementalPublish.statusSummary();if(s.publishSchemaVersion!=='4.0-publish-1'||s.dependencySchemaVersion!=='4.0-dependency-3'||s.dispatcherSchemaVersion!=='4.0-dispatcher-4')throw new Error('Unexpected schema/dependency/dispatcher version');if(!s.scopeCorrection||s.scopeCorrection.aggregateExecutionEnabled!==false)throw new Error('Aggregate execution must be disabled in alpha.6');if(JSON.stringify(s.scopeCorrection.acceptanceSheets)!==JSON.stringify(['PUBLISH_PRICES_WEEKLY','PUBLISH_PRICES_MONTHLY','PUBLISH_INDUSTRY']))throw new Error('Unexpected acceptance scope');['PUBLISH_IMPACT','PUBLISH_RUNS','PUBLISH_RECONCILIATION'].forEach(function(n){if(!s.serviceTables[n])throw new Error('Missing '+n);});return s;}));
    tests.push(test_('operation_phase_contract_consistent',function(){var phases=AKORT.Release.operationPhases||[];if(phases.indexOf('PREPARING_AGGREGATE_IMPACT')<0||phases.indexOf('RECONCILING_AGGREGATES')<0||phases.indexOf('FINALIZING')<0||phases.indexOf('UPDATE_AGGREGATES')>=0||phases.indexOf('PLAN_AGGREGATE_IMPACT')>=0)throw new Error('Release phases do not match Operation Engine');return phases;}));
    tests.push(test_('weekly_dependency_closure',function(){var p=T.weeklyDependentPeriods(new Date(2025,11,28,12));if(p.indexOf('2025-12-28')<0||p.indexOf('2026-01-04')<0)throw new Error('Weekly direct dependency missing');if(p.length<54)throw new Error('December theoretical closure must include next-year weeks');return{count:p.length,first:p.slice(0,4)};}));
    tests.push(test_('monthly_dependency_closure',function(){var p=T.monthlyDependentPeriods(new Date(2025,11,1,12));if(p.indexOf('2025-12')<0||p.indexOf('2026-01')<0||p.indexOf('2026-12')<0)throw new Error('Monthly December theoretical closure incomplete');return p;}));
    tests.push(test_('aggregate_combo_contract_price_levels',function(){var x=T.expandAffected([{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2026-06-28'}]),types=set_(x.aggregates.map(function(c){if(!c.indexType)throw new Error('Empty aggregate indexType');return c.indexType;}));['wow','yoy','december','mom'].forEach(function(t){if(!types[t])throw new Error('Missing aggregate indexType '+t);});return{aggregateCount:x.aggregates.length,indexTypes:Object.keys(types).sort()};}));
    tests.push(test_('aggregate_replay_frontier',function(){var frontier={};frontier[T.frontierKey('weekly','AKORT_WEEKLY','2025-12-28')]=true;frontier[T.frontierKey('weekly','AKORT_WEEKLY','2026-01-04')]=true;var x=T.expandAffected([{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2025-12-28'}],{aggregateFrontier:frontier}),future=x.aggregates.filter(function(c){return String(c.period).indexOf('2027-')===0;}),weeklyTypes={};x.aggregates.filter(function(c){return c.frequency==='weekly'&&c.valueType==='розница';}).forEach(function(c){weeklyTypes[c.indexType]=true;});if(future.length)throw new Error('Replay frontier leaked future periods');if(!x.aggregates.length)throw new Error('Frontier removed source/direct periods');['wow','yoy','december'].forEach(function(indexType){if(!weeklyTypes[indexType])throw new Error('Blank weekly RAW index_type did not expand to '+indexType);});return{aggregateCount:x.aggregates.length,indexTypes:Object.keys(weeklyTypes).sort(),latest:x.aggregates.map(function(c){return c.period;}).sort().slice(-3)};}));
    tests.push(test_('impact_records_cell_safe_and_deterministic',function(){var base={price:[{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'закупка',indexType:'',period:'2025-12-28'},{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2025-12-28'}],industrySeries:[]},plan=AKORT.IncrementalPublish.planFromAffected(base),fullJson=AKORT.Core.safeJson(plan.aggregates),records=T.buildImpactRecords('OP_CELL_LIMIT_TEST','LOAD_CELL_LIMIT_TEST',plan,'2026-07-11T00:00:00.000Z'),again=T.buildImpactRecords('OP_CELL_LIMIT_TEST','LOAD_CELL_LIMIT_TEST',plan,'2026-07-11T00:00:00.000Z'),ids={},max=0;plan.loadId='LOAD_CELL_LIMIT_TEST';if(fullJson.length<=50000)throw new Error('Stress fixture no longer exceeds the Sheets cell boundary');records.forEach(function(r){['affected_periods_json','series_ids_json','aggregate_combos_json'].forEach(function(f){max=Math.max(max,String(r[f]||'').length);});if(ids[r.impact_id])throw new Error('Duplicate deterministic impact_id');ids[r.impact_id]=true;});if(max>30000)throw new Error('Compact impact cell exceeds 30000 chars');if(JSON.stringify(records.map(function(r){return r.impact_id;}))!==JSON.stringify(again.map(function(r){return r.impact_id;})))throw new Error('Impact IDs are not deterministic');return{fullPlanChars:fullJson.length,records:records.length,maxCellChars:max};}));
    tests.push(test_('publish_plan_checkpoint_compact',function(){var plan=AKORT.IncrementalPublish.planFromAffected({price:[{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'закупка',indexType:'',period:'2025-12-28'},{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2025-12-28'}],industrySeries:[]}),summary=AKORT.IncrementalPublish.summarizePlan(plan),json=AKORT.Core.safeJson(summary);if(summary.aggregateComboCount!==plan.aggregates.length)throw new Error('Compact summary lost aggregate count');if(summary.weekly||summary.monthly||summary.aggregates||summary.weeklySeriesIds||summary.monthlySeriesIds)throw new Error('Checkpoint summary contains full plan arrays');if(json.length>=5000)throw new Error('Checkpoint summary is unexpectedly large');return{summaryChars:json.length,aggregateComboCount:summary.aggregateComboCount,aggregatePlanHash:summary.aggregatePlanHash};}));
    tests.push(test_('dispatcher_control_generation_guard',function(){var state={runId:'RUN_A'};if(!T.dispatcherControlMatches({enabled:true,runId:'RUN_A'},state))throw new Error('Active dispatcher generation was rejected');if(T.dispatcherControlMatches({enabled:false,runId:'RUN_A'},state))throw new Error('Stopped dispatcher generation remained active');if(T.dispatcherControlMatches({enabled:true,runId:'RUN_B'},state))throw new Error('Superseded worker generation remained active');if(T.dispatcherStateKey('RUN_A')===T.dispatcherStateKey('RUN_B'))throw new Error('Dispatcher generations share mutable state');return{active:true,stopped:false,superseded:false,separateStateKeys:true};}));
    tests.push(test_('dispatcher_target_names_unambiguous',function(){if(T.replayTarget('INDUSTRY')!=='PUBLISH_INDUSTRY')throw new Error('Industry target is ambiguous');if(T.replayTarget('IMPACT_PREVIEW')!=='AGGREGATE_IMPACT_PREVIEW')throw new Error('Impact preview target is missing');if(T.nextReplayStage('INDUSTRY')!=='IMPACT_PREVIEW')throw new Error('Empty industry target cannot advance to explicit impact preview');return{industry:T.replayTarget('INDUSTRY'),impact:T.replayTarget('IMPACT_PREVIEW'),next:T.nextReplayStage('INDUSTRY')};}));
    tests.push(test_('dispatcher_semantic_progress_accounting',function(){var a={status:'RUNNING',phase:'REPLAY_INCREMENTAL',replayIndex:2,replayStage:'INDUSTRY',replayWork:{loadId:'AWI',stage:'INDUSTRY',cursor:0,total:0},allowedLoadIds:['A','B','AWI'],reversedLoadIds:[],aggregateImpactPreview:[],results:[]},b=JSON.parse(JSON.stringify(a)),fa=T.reconciliationFingerprint(a),fb=T.reconciliationFingerprint(b),noProgress=T.dispatcherProgressDecision(fa,fb,2);if(noProgress.progressed||!noProgress.warning||noProgress.stop)throw new Error('No-progress warning threshold is incorrect');b.replayStage='IMPACT_PREVIEW';b.replayWork=null;var progressed=T.dispatcherProgressDecision(fa,T.reconciliationFingerprint(b),4);if(!progressed.progressed||progressed.noProgressRuns!==0)throw new Error('Stage transition was not counted as semantic progress');var stop=T.dispatcherProgressDecision(fa,fb,4);if(!stop.stop||stop.noProgressRuns!==5)throw new Error('No-progress stop threshold is incorrect');return{warningRuns:noProgress.noProgressRuns,stopRuns:stop.noProgressRuns};}));
    tests.push(test_('series_replacement_grid_mutation_safe',function(){var r=T.storageMutationProbe();if(r.beforeMaxRows!==r.afterDeleteMaxRows)throw new Error('Delete changed grid capacity');if(r.seriesCounts.S1!==8||r.seriesCounts.S2!==3)throw new Error('Series rows were lost or duplicated');if(r.afterAppendMaxRows<12)throw new Error('Grid did not expand through appendDimension');return r;}));
    tests.push(test_('series_replacement_actual_function_rollback_and_retry',function(){var r=T.seriesReplacementRollbackProbe();if(r.combinedCode!=='PUBLISH_SERIES_REPLACE_ROLLBACK_FAILED')throw new Error('Rollback diagnostic code mismatch');if(r.seriesCounts.S1!==2||r.seriesCounts.S2!==2)throw new Error('Retry did not restore exact series counts');return r;}));
    tests.push(test_('impact_preview_hard_timeout_retry_and_reversal_cursor',function(){
      var ss=SpreadsheetApp.create('AKORT_ALPHA622_IMPACT_FAULT_'+Date.now()),state={controlId:ss.getId(),reconciliationId:'RECON_TEST_622',replayIndex:0,aggregateFrontierKeys:[],aggregateFrontierCount:0,impactWork:{loadId:'LOAD_TEST_622',phase:'SCAN_WEEKLY',sourceCursor:0,sourceTotal:1,countCursor:0,countTotal:0,comboRows:0,matchedRows:0,indexTypes:{},invalidIndexTypes:0}},group={loadId:'LOAD_TEST_622'},fault=true,headers=T.impactPreviewHeaders();
      try{
        ss.insertSheet('IMPACT_PREVIEW_ITEMS');
        T.setImpactTestAdapter({readAffectedChunk:function(g,spec,cursor){return{affected:cursor?[]:[{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2026-06-28'}],read:cursor?0:1,total:1};},onFaultPoint:function(point){if(point==='AFTER_APPEND_BEFORE_CHECKPOINT'&&fault){fault=false;throw new Error('INJECTED_HARD_TIMEOUT_AFTER_APPEND');}}});
        var failed=false;try{T.replayImpactPreviewStep(state,group);}catch(e){failed=String(e.message||e).indexOf('INJECTED_HARD_TIMEOUT_AFTER_APPEND')>=0;}if(!failed)throw new Error('Injected write-before-checkpoint failure was not observed');if(Number(state.impactWork.sourceCursor||0)!==0)throw new Error('Cursor advanced before the failed checkpoint');
        var sh=ss.getSheetByName('IMPACT_PREVIEW_ITEMS'),actualHeaders=sh.getRange(1,1,1,headers.length).getValues()[0];if(JSON.stringify(actualHeaders)!==JSON.stringify(headers))throw new Error('Empty partial sheet schema was not repaired');var rowsAfterFailure=Math.max(0,sh.getLastRow()-1);if(rowsAfterFailure!==3)throw new Error('Expected three durable weekly aggregate combos before retry, got '+rowsAfterFailure);
        var resumed=T.replayImpactPreviewStep(state,group),rowsAfterRetry=Math.max(0,sh.getLastRow()-1);if(rowsAfterRetry!==rowsAfterFailure)throw new Error('Retry duplicated durable aggregate combos');if(resumed.impactPhase!=='SCAN_MONTHLY')throw new Error('Retry did not advance from the checkpointed weekly chunk');
        state.impactWork={loadId:'REV_TEST_622',phase:'SCAN_REVERSAL',sourceCursor:0,sourceTotal:5,countCursor:0,countTotal:0,comboRows:0,matchedRows:0,indexTypes:{},invalidIndexTypes:0};group={loadId:'REV_TEST_622',isReversal:true,reverseTargets:['LOAD_TEST_TARGET_622']};T.setImpactTestAdapter({readReversalChunk:function(g,cursor){return{affected:[{frequency:'monthly',datasetCode:'ROSSTAT_MONTHLY',categoryId:'C',valueType:'производитель',indexType:'',period:'2026-04'}],read:2,total:5};}});var reversal=T.replayImpactPreviewStep(state,group);if(reversal.impactPhase!=='SCAN_REVERSAL'||Number(state.impactWork.sourceCursor)!==2)throw new Error('Reversal scan is not cursor-checkpointed');
        return{writeBeforeCheckpointRecovered:true,rowsAfterFailure:rowsAfterFailure,rowsAfterRetry:rowsAfterRetry,reversalCursor:state.impactWork.sourceCursor,schemaColumns:headers.length};
      }finally{T.setImpactTestAdapter(null);try{DriveApp.getFileById(ss.getId()).setTrashed(true);}catch(ignore){}}
    }));
    tests.push(test_('dispatcher_error_classification_and_backoff',function(){var drive=T.dispatcherClassifyError(new Error('Service error: Drive'));if(drive.kind!=='RETRYABLE')throw new Error('Drive transient error must be retryable');var quota=T.dispatcherClassifyError(new Error('Service invoked too many times for one day'));if(quota.kind!=='QUOTA')throw new Error('Quota error classification failed');var computerTime=T.dispatcherClassifyError(new Error('Service using too much computer time for one day'));if(computerTime.kind!=='QUOTA')throw new Error('Computer-time quota classification failed');var limitExceeded=T.dispatcherClassifyError(new Error('Limit exceeded: Email Attachments Per Message.'));if(limitExceeded.kind!=='QUOTA')throw new Error('Limit exceeded classification failed');var env=Object.assign(new Error('Service error: Drive'),{code:'ENVIRONMENT_MISMATCH'});if(T.dispatcherClassifyError(env).kind!=='FATAL')throw new Error('Environment mismatch code must take precedence');var auth=T.dispatcherClassifyError(new Error('Authorization is required to perform that action'));if(auth.kind!=='USER_ACTION')throw new Error('Authorization classification failed');if(T.dispatcherRetryDelayMs(1,'RETRYABLE')!==60000||T.dispatcherRetryDelayMs(3,'RETRYABLE')!==300000||T.dispatcherRetryDelayMs(1,'QUOTA')!==1800000)throw new Error('Retry backoff is incorrect');return{drive:drive.kind,quota:quota.kind,auth:auth.kind};}));
    tests.push(test_('weekly_wow_yoy_december_ma4',function(){var rows=[],dates=[new Date(2024,11,29,12),new Date(2025,0,5,12),new Date(2025,0,12,12),new Date(2025,0,19,12),new Date(2025,0,26,12),new Date(2026,0,25,12)],vals=[100,101,102,103,104,120];dates.forEach(function(d,i){var iso=(function(){var x=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())),day=x.getUTCDay()||7;x.setUTCDate(x.getUTCDate()+4-day);var y=new Date(Date.UTC(x.getUTCFullYear(),0,1));return{year:x.getUTCFullYear(),week:Math.ceil((((x-y)/86400000)+1)/7)};})();rows.push({series_id:'S',dataset_code:'D',category_id:'C',value_type:'розница',series_type:'OFFICIAL_WEEKLY',observation_date:d,year:d.getFullYear(),month:d.getMonth()+1,iso_year:iso.year,iso_week:iso.week,current_value:vals[i]});});T.weeklyDynamics(rows);var r=rows[4];approx_(r.wow_abs,1);approx_(r.moving_average_4w,102.5);approx_(r.december_pct,4);return r;}));
    tests.push(test_('monthly_mom_yoy_december',function(){var rows=[{series_id:'M',dataset_code:'D',category_id:'C',value_type:'розница',series_type:'OFFICIAL_MONTHLY',month_start:new Date(2024,11,1,12),year:2024,month:12,current_value:100},{series_id:'M',dataset_code:'D',category_id:'C',value_type:'розница',series_type:'OFFICIAL_MONTHLY',month_start:new Date(2025,0,1,12),year:2025,month:1,current_value:110},{series_id:'M',dataset_code:'D',category_id:'C',value_type:'розница',series_type:'OFFICIAL_MONTHLY',month_start:new Date(2026,0,1,12),year:2026,month:1,current_value:121}];T.monthlyDynamics(rows);approx_(rows[1].mom_pct,10);approx_(rows[1].december_pct,10);approx_(rows[2].yoy_pct,10);return rows;}));
    tests.push(test_('industry_ytd_semantics',function(){var rows=[{series_id:'I',frequency:'monthly',year:2025,month:1,current_value:100,_periodBasis:'cumulative_ytd',_metricType:'level',_comparisonDate:new Date(2025,0,1,12)},{series_id:'I',frequency:'monthly',year:2026,month:1,current_value:120,_periodBasis:'cumulative_ytd',_metricType:'level',_comparisonDate:new Date(2026,0,1,12)}];T.industryDynamics(rows);if(rows[1].previous_period_value!==''&&rows[1].previous_period_value!==undefined)throw new Error('YTD must not calculate previous-period change');approx_(rows[1].yoy_pct,20);return rows[1];}));
    tests.push(test_('markup_dependency_closure_abs_pct_and_derived',function(){
      var x=T.expandAffected([{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2026-06-28'}]);
      function has(rows,dataset,valueType){return rows.some(function(r){return r.datasetCode===dataset&&r.categoryId==='C'&&r.valueType===valueType;});}
      if(!has(x.weekly,'AKORT_WEEKLY','наценка, руб.')||!has(x.weekly,'AKORT_WEEKLY','наценка, %'))throw new Error('Weekly markup closure is incomplete');
      if(!has(x.monthly,'AKORT_MONTHLY_DERIVED','розница')||!has(x.monthly,'AKORT_MONTHLY_DERIVED','наценка, руб.')||!has(x.monthly,'AKORT_MONTHLY_DERIVED','наценка, %'))throw new Error('Derived monthly markup closure is incomplete');
      if(x.aggregates.some(function(c){return c.valueType==='наценка, руб.';}))throw new Error('Absolute markup must not create aggregate change combos');
      var m=T.expandAffected([{frequency:'monthly',datasetCode:'AKORT_MONTHLY',categoryId:'C',valueType:'закупка',indexType:'',period:'2026-06'}]);
      if(!has(m.monthly,'AKORT_MONTHLY','наценка, руб.')||!has(m.monthly,'AKORT_MONTHLY','наценка, %'))throw new Error('Official monthly markup closure is incomplete');
      return{weekly:x.weekly.length,monthly:x.monthly.length,aggregates:x.aggregates.length};
    }));
    tests.push(test_('monthly_index_descriptor_consolidation',function(){
      var targets=['mom','yoy','december'].map(function(indexType){return{frequency:'monthly',datasetCode:'ROSSTAT_MONTHLY',categoryId:'C',valueType:'ИПЦ',indexType:indexType,period:'2026-06'};}),descriptors=T.monthlyDescriptors(targets),ids=T.seriesIdsForTargets(targets,'monthly');
      if(descriptors.length!==1||descriptors[0].indexType!==''||descriptors[0].seriesType!=='OFFICIAL_MONTHLY_INDEX')throw new Error('Monthly index targets did not collapse to one economic descriptor');
      if(ids.length!==1)throw new Error('Monthly index deletion plan contains multiple series IDs');
      return{targetCount:targets.length,descriptorCount:descriptors.length,seriesIdCount:ids.length,seriesId:ids[0]};
    }));
    tests.push(test_('recovery_cursor_counts_as_dispatcher_progress',function(){var a={status:'RUNNING',phase:'RECOVERY_MARKUP_WEEKLY',recovery:{stage:'WEEKLY',cursor:0,total:50,chunkSeries:5},results:[]},b=JSON.parse(JSON.stringify(a));b.recovery.cursor=5;var d=T.dispatcherProgressDecision(T.reconciliationFingerprint(a),T.reconciliationFingerprint(b),4);if(!d.progressed||d.noProgressRuns!==0)throw new Error('Recovery cursor is absent from semantic fingerprint');return d;}));
    tests.push(test_('weekly_markup_field_contract',function(){var rows=[
      {series_id:'WP',dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'наценка, %',series_type:'CALCULATED_MARKUP',observation_date:new Date(2026,0,4,12),year:2026,month:1,iso_year:2026,iso_week:1,current_value:10,previous_week_value:'',wow_abs:'',wow_pct:'',markup_wow_pp:''},
      {series_id:'WP',dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'наценка, %',series_type:'CALCULATED_MARKUP',observation_date:new Date(2026,0,11,12),year:2026,month:1,iso_year:2026,iso_week:2,current_value:12,previous_week_value:'',wow_abs:'',wow_pct:'',markup_wow_pp:''},
      {series_id:'WA',dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'наценка, руб.',series_type:'CALCULATED_MARKUP',observation_date:new Date(2026,0,4,12),year:2026,month:1,iso_year:2026,iso_week:1,current_value:5,previous_week_value:'',wow_abs:'',wow_pct:'',markup_wow_pp:''},
      {series_id:'WA',dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'наценка, руб.',series_type:'CALCULATED_MARKUP',observation_date:new Date(2026,0,11,12),year:2026,month:1,iso_year:2026,iso_week:2,current_value:6,previous_week_value:'',wow_abs:'',wow_pct:'',markup_wow_pp:''}
    ];T.weeklyDynamics(rows);approx_(rows[1].markup_wow_pp,2);if(rows[1].wow_abs!==''||rows[1].wow_pct!==''||rows[3].wow_abs!==''||rows[3].markup_wow_pp!=='')throw new Error('Weekly markup populated the wrong dynamics columns');return rows;}));
    tests.push(test_('monthly_markup_field_contract',function(){var rows=[
      {series_id:'MP',dataset_code:'AKORT_MONTHLY',category_id:'C',value_type:'наценка, %',series_type:'CALCULATED_MARKUP',month_start:new Date(2026,0,1,12),year:2026,month:1,current_value:10,previous_month_value:'',mom_abs:'',mom_pct:'',markup_mom_pp:''},
      {series_id:'MP',dataset_code:'AKORT_MONTHLY',category_id:'C',value_type:'наценка, %',series_type:'CALCULATED_MARKUP',month_start:new Date(2026,1,1,12),year:2026,month:2,current_value:13,previous_month_value:'',mom_abs:'',mom_pct:'',markup_mom_pp:''},
      {series_id:'MA',dataset_code:'AKORT_MONTHLY',category_id:'C',value_type:'наценка, руб.',series_type:'CALCULATED_MARKUP',month_start:new Date(2026,0,1,12),year:2026,month:1,current_value:5,previous_month_value:'',mom_abs:'',mom_pct:'',markup_mom_pp:''},
      {series_id:'MA',dataset_code:'AKORT_MONTHLY',category_id:'C',value_type:'наценка, руб.',series_type:'CALCULATED_MARKUP',month_start:new Date(2026,1,1,12),year:2026,month:2,current_value:7,previous_month_value:'',mom_abs:'',mom_pct:'',markup_mom_pp:''}
    ];T.monthlyDynamics(rows);approx_(rows[1].markup_mom_pp,3);if(rows[1].mom_abs!==''||rows[1].mom_pct!==''||rows[3].mom_abs!==''||rows[3].markup_mom_pp!=='')throw new Error('Monthly markup populated the wrong dynamics columns');return rows;}));
    tests.push(test_('derived_monthly_markup_builder',function(){var raw=[],dates=[new Date(2026,0,4,12),new Date(2026,0,11,12),new Date(2026,0,18,12),new Date(2026,0,25,12)];dates.forEach(function(d,i){raw.push({dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'закупка',observation_date:d,value:100+i});raw.push({dataset_code:'AKORT_WEEKLY',category_id:'C',value_type:'розница',observation_date:d,value:120+i});});var products={C:{product_group:'G',product_name:'P',unit:'кг.',sort_order:1}},pct=T.buildDerivedMonthlyMarkupSeries(raw,products,{categoryId:'C',valueType:'наценка, %'}),abs=T.buildDerivedMonthlyMarkupSeries(raw,products,{categoryId:'C',valueType:'наценка, руб.'});if(pct.length!==1||abs.length!==1)throw new Error('Derived markup rows were not materialized');approx_(abs[0].current_value,20);approx_(pct[0].current_value,20/101.5*100);if(pct[0].period_completeness!=='COMPLETE')throw new Error('Derived completeness mismatch');return{pct:pct[0],abs:abs[0]};}));
    tests.push(test_('revision_impact_expansion',function(){var x=T.expandAffected([{frequency:'weekly',datasetCode:'AKORT_WEEKLY',categoryId:'C',valueType:'розница',indexType:'',period:'2026-06-28'}]);if(!x.weekly.length||!x.monthly.length||!x.aggregates.length)throw new Error('AKORT revision did not propagate to markup, derived monthly and aggregate impact');if(x.aggregates.some(function(c){return !c.indexType;}))throw new Error('Aggregate impact contains empty indexType');return{weekly:x.weekly.length,monthly:x.monthly.length,aggregateImpact:x.aggregates.length};}));
    tests.push(test_('latest_points_by_economic_series',function(){var rows=[{series_id:'A',observation_date:new Date(2026,0,1,12)},{series_id:'A',observation_date:new Date(2026,0,8,12)},{series_id:'B',observation_date:new Date(2026,0,1,12)}];T.setLatestPrices(rows,'observation_date');if(rows[0].is_latest_period!==0||rows[1].is_latest_period!==1||rows[2].is_latest_period!==1)throw new Error('Latest flags are not series-specific');return rows;}));
    tests.push(test_('historical_load_replay_revision_and_reversal',function(){var rows=[{dataset_code:'D',category_id:'C',value_type:'розница',index_type:'',observation_date:'2026-01-04',value:100,version_no:1,loaded_at:'2026-01-05T00:00:00Z',load_id:'L1'},{dataset_code:'D',category_id:'C',value_type:'розница',index_type:'',observation_date:'2026-01-04',value:110,version_no:2,loaded_at:'2026-02-01T00:00:00Z',load_id:'L2'}],initial=T.selectReplayLatest('RAW_PRICES_WEEKLY',rows,{L1:true},{}),revised=T.selectReplayLatest('RAW_PRICES_WEEKLY',rows,{L1:true,L2:true},{}),reversed=T.selectReplayLatest('RAW_PRICES_WEEKLY',rows,{L1:true,L2:true},{L2:true});if(initial.length!==1||Number(initial[0].value)!==100)throw new Error('Initial replay state failed');if(revised.length!==1||Number(revised[0].value)!==110)throw new Error('Revision replay state failed');if(reversed.length!==1||Number(reversed[0].value)!==100)throw new Error('Reversal replay state failed');return{initial:initial[0].value,revised:revised[0].value,reversed:reversed[0].value};}));
    tests.push(test_('aggregate_execution_deferred',function(){var s=AKORT.IncrementalPublish.runtimeSettings();if(s.aggregateExecutionEnabled!==false||s.aggregateExecutionStatus!=='DEFERRED_TO_ALPHA7')throw new Error('Physical aggregate execution is not deferred');return s;}));
    tests.push(test_('baseline_unchanged',function(){var c=AKORT.Config.load({includeSystemSettings:false}),d=SpreadsheetApp.openById(c.resources.dwhSpreadsheetId),p=SpreadsheetApp.openById(c.resources.publishSpreadsheetId),a={rawWeeklyRows:d.getSheetByName('RAW_PRICES_WEEKLY').getLastRow()-1,rawMonthlyRows:d.getSheetByName('RAW_PRICES_MONTHLY').getLastRow()-1,rawIndustryRows:d.getSheetByName('RAW_INDUSTRY').getLastRow()-1,publishWeeklyRows:p.getSheetByName('PUBLISH_PRICES_WEEKLY').getLastRow()-1,publishMonthlyRows:p.getSheetByName('PUBLISH_PRICES_MONTHLY').getLastRow()-1,publishIndustryRows:p.getSheetByName('PUBLISH_INDUSTRY').getLastRow()-1,publishAggregateRows:p.getSheetByName('PUBLISH_PRICE_AGGREGATES').getLastRow()-1},e=c.baselinePhysicalExpected;Object.keys(e).forEach(function(k){if(Number(a[k])!==Number(e[k]))throw new Error(k+' changed: '+a[k]+' vs '+e[k]);});return a;}));
    tests.push(test_('reconciliation_scope_ready',function(){var s=AKORT.IncrementalPublish.statusSummary();return{phases:['full build of 3 marts','sequential load replay','aggregate impact preview','verified baseline comparison'],acceptanceSheets:s.scopeCorrection.acceptanceSheets,aggregateExecutionStatus:s.scopeCorrection.aggregateExecutionStatus,status:AKORT.IncrementalPublish.reconciliationStatus().status};}));
    var ok=tests.every(function(x){return x.status==='PASS';});return ok?AKORT.Result.success('Alpha.6 corrected Incremental Publish smoke test passed.',{tests:tests,status:AKORT.IncrementalPublish.statusSummary()}):AKORT.Result.failure('ALPHA6_SMOKE_TEST_FAILED','One or more corrected alpha.6 checks failed.',{tests:tests});},{lock:true,persistLogs:true});}
  return{runSmokeTest:runSmokeTest};
})();
function AKORT_alpha623Diagnostics() {
  function serializeError_(error) {
    return {
      name: String(error && error.name || ''),
      code: String(error && error.code || ''),
      message: String(error && error.message || error || ''),
      stack: String(error && error.stack || ''),
      details: error && error.details ? error.details : null
    };
  }

  function run_(id, fn) {
    try {
      return {
        id: id,
        status: 'PASS',
        data: fn()
      };
    } catch (error) {
      return {
        id: id,
        status: 'FAIL',
        error: serializeError_(error)
      };
    }
  }

  var incrementalPublish =
    typeof AKORT !== 'undefined' &&
    AKORT.IncrementalPublish;

  var testApi =
    incrementalPublish &&
    incrementalPublish.Test;

  if (!testApi) {
    throw new Error(
      'AKORT.IncrementalPublish.Test is not available.'
    );
  }

  if (typeof testApi.storageMutationProbe !== 'function') {
    throw new Error(
      'storageMutationProbe is not exported.'
    );
  }

  if (typeof testApi.seriesReplacementRollbackProbe !== 'function') {
    throw new Error(
      'seriesReplacementRollbackProbe is not exported.'
    );
  }

  var result = {
    release: '4.0.0-alpha.6.2.4',
    tests: [
      run_(
        'series_replacement_grid_mutation_safe',
        function () {
          return testApi.storageMutationProbe();
        }
      ),
      run_(
        'series_replacement_actual_function_rollback_and_retry',
        function () {
          return testApi.seriesReplacementRollbackProbe();
        }
      )
    ]
  };

  result.failed = result.tests.filter(function (test) {
    return test.status !== 'PASS';
  });

  result.failedCount = result.failed.length;

  console.log(JSON.stringify({
    release: result.release,
    failedCount: result.failedCount,
    failed: result.failed,
    tests: result.tests
  }));

  return result;
}
