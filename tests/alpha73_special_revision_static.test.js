'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const text = value => value == null ? '' : String(value).trim();
const norm = value => text(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const periodKey = (_frequency, value) => text(value);

const contract = {
  Version: '4.0-aggregate-contract-2',
  BorshchAggregateId: 'CUSTOM_BORSCH_BASKET',
  BorshchMembershipVersion: 'BORSHCH_MEMBERSHIP_V1',
  AllowedIndexTypes: {weekly:['wow','yoy','december'], monthly:['mom','yoy','december']},
  canonicalIndexTypes: (_frequency, indexType) => [norm(indexType)],
  aggregateSeriesKey: d => ['S',d.dataset_code,norm(d.frequency),norm(d.aggregate_level),d.aggregate_subject_id,d.value_type,norm(d.index_type),d.calculation_method,d.weight_rule_id,d.membership_rule_id].join('|'),
  aggregateRowKey: d => contract.aggregateSeriesKey(d) + '|' + periodKey(d.frequency, d.period_start),
  Test: {periodKey},
  validateFrontier: (frontier, expectedId, expectedHash) => {
    if (!frontier || !frontier.keys) throw Object.assign(new Error('frontier required'), {code:'AGG_FRONTIER_REQUIRED'});
    if (frontier.snapshot_id !== expectedId) throw Object.assign(new Error('snapshot mismatch'), {code:'AGG_FRONTIER_SNAPSHOT_MISMATCH'});
    if (frontier.hash !== expectedHash) throw Object.assign(new Error('hash mismatch'), {code:'AGG_FRONTIER_HASH_MISMATCH'});
    return frontier;
  },
  dependencyCandidates: (frequency, sourcePeriod, indexType, periods) => {
    const f=norm(frequency), idx=norm(indexType), out=[sourcePeriod];
    if (f==='weekly' && idx==='wow') {
      const d=new Date(sourcePeriod+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+7); out.push(d.toISOString().slice(0,10));
    } else if (f==='monthly' && idx==='mom') {
      const parts=sourcePeriod.split('-').map(Number), d=new Date(Date.UTC(parts[0],parts[1],1,12)); out.push(d.toISOString().slice(0,7));
    } else if (idx==='yoy') {
      if (f==='weekly') { const d=new Date(sourcePeriod+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+364); out.push(d.toISOString().slice(0,10)); }
      else { const parts=sourcePeriod.split('-').map(Number), d=new Date(Date.UTC(parts[0]+1,parts[1]-1,1,12)); out.push(d.toISOString().slice(0,7)); }
    } else if (idx==='december' && sourcePeriod.slice(5,7)==='12') {
      const year=Number(sourcePeriod.slice(0,4)); (periods||[]).forEach(p=>{if(Number(String(p).slice(0,4))===year+1)out.push(p);});
    }
    return [...new Set(out)].sort();
  },
  frontierAllows: (frontier, frequency, dataset, scope, period) => !!frontier.keys[[norm(frequency),text(dataset),text(scope||'ALL'),text(period)].join('|')],
  normalizeImpactItem: raw => {
    const x = {...raw};
    x.impact_id = 'I_' + sha([x.load_id,x.reason_code,x.source_series_id,x.source_period,x.target_period,x.target_aggregate_scope,x.target_value_type,x.target_index_type,x.weight_snapshot_id,x.membership_snapshot_id].join('|')).slice(0,16);
    x.combo_key = [x.load_id,x.reason_code,x.source_series_id,x.source_period,norm(x.frequency),x.target_value_type,norm(x.target_index_type),x.target_aggregate_scope,x.target_period,x.weight_snapshot_id,x.membership_snapshot_id].join('|');
    return x;
  }
};

const calculator = {
  Version: '4.0-aggregate-calculator-1',
  Test: {sha256: sha},
  calculateBatch: batch => {
    const definition = batch.aggregate_definitions[0];
    const period = batch.impact_items[0].target_period;
    const series = definition.aggregate_series_key;
    const rowKey = series + '|' + period;
    return {
      ok:true,status:'SUCCESS',diagnostics:[],
      rows:[{
        row_type:'AGGREGATE_RESULT',aggregate_series_key:series,aggregate_row_key:rowKey,
        frequency:definition.frequency,period_start:period,calculation_status:'READY',publication_allowed:true,
        source_impacts:batch.impact_items.map(i=>({impact_id:i.impact_id,combo_key:i.combo_key})),
        source_impact_ids:batch.impact_items.map(i=>i.impact_id),source_combo_keys:batch.impact_items.map(i=>i.combo_key)
      }]
    };
  }
};

const context = {AKORT:{AggregateContract:contract,AggregateCalculator:calculator},console,Date,JSON,Math,Number,String,Object,Array,RegExp,Error,isFinite};
vm.createContext(context);
['18_Alpha73SpecialAggregateDefinitions.js','19_Alpha73RevisionPlanner.js'].forEach(file => {
  vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'), context, {filename:file});
});
const D = context.AKORT.SpecialAggregateDefinitions;
const P = context.AKORT.AggregateRevisionPlanner;

function assert(condition, message) { if (!condition) throw new Error(message || 'Assertion failed'); }
function equal(actual, expected, message) { const a=JSON.stringify(actual), b=JSON.stringify(expected); if(a!==b) throw new Error((message||'Values differ')+`: expected ${b}, got ${a}`); }
function throwsCode(fn, code) { try { fn(); } catch (e) { assert(e.code===code,`expected ${code}, got ${e.code}: ${e.message}`); return; } throw new Error(`expected ${code}`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function reverse(value) { return [...value].reverse(); }

const tests=[];
function test(id,name,fn){tests.push({id,name,fn});}
function membership(from='2020-01-01',to='',overrides={}){return Object.assign({membership_rule_id:'M',membership_version:'MV1',aggregate_subject_id:'G',category_id:'C',allocation_factor:1,include_flag:1,effective_from:from,effective_to:to,status:'ACTIVE'},overrides);}
function definition(version,from,to,id,overrides={}){return D.Test.normalizeDefinition(Object.assign({definition_id:id,definition_version:version,dataset_code:'D',frequency:'weekly',aggregate_level:'custom_group',aggregate_subject_id:'G',aggregate_name:'G',value_type:'retail_price',index_type:'wow',calculation_method:'NORMALIZED_WEIGHTED_AVERAGE',weight_rule_id:'W',membership_rule_id:'M',effective_from:from,effective_to:to,status:'ACTIVE'},overrides));}
function frontier(periods,hash='FH'){return {snapshot_id:'F1',hash,keys:Object.fromEntries(periods.map(p=>['weekly|D|ALL|'+p,true])),count:periods.length};}
function impact(overrides={}){return Object.assign({load_id:'L1',operation_id:'O1',reason_code:'REVISION',source_dataset_code:'D',source_series_id:'SRC',source_category_id:'C',source_period:'2026-01-04',frequency:'weekly',source_value_type:'retail_price',source_series_scope:'ALL',weight_snapshot_id:'W1',membership_snapshot_id:'M1'},overrides);}
function request(defs,members,periods,impacts=[impact()],overrides={}){return Object.assign({plan_id:'P',frontier:frontier(periods),frontier_snapshot_id:'F1',frontier_hash:'FH',source_impacts:impacts,definitions:defs,membership_snapshot:{snapshot_id:'M1',hash:'MH',rule_rows:members},weight_snapshot:{snapshot_id:'W1',hash:'WH',rule_rows:[]},price_inputs:[{category_id:'C',current_value:101}],coverage_rules:[],base_inputs:[],execute_calculator:false},overrides);}

const v1=definition('V1','2020-01-01','2025-12-31','DEF_V1');
const v2=definition('V2','2026-01-01','','DEF_V2');

// Direct remediation tests, each mapped to a review finding.
test('R73-001','Non-overlapping definition versions are valid',()=>equal(D.Test.validateDefinitions([v1,v2]).length,2));
test('R73-002','Overlapping definition versions are rejected',()=>throwsCode(()=>D.Test.validateDefinitions([v1,definition('V2','2025-12-01','','OVERLAP')]),'ALPHA73_DEFINITION_CONFLICT'));
test('R73-003','Effective definition is selected by target period',()=>equal(D.resolveDefinitionsForPeriod([v1,v2],'2026-01-04')[0].definition_id,'DEF_V2'));
test('R73-004','Definition resolution is input-order invariant',()=>equal(D.resolveDefinitionsForPeriod(reverse([v1,v2]),'2026-01-04')[0].definition_id,'DEF_V2'));
test('R73-005','Planner definition selection is order invariant',()=>{const a=P.planRevision(request([v1,v2],[membership()],['2026-01-04']));const b=P.planRevision(request([v2,v1],[membership()],['2026-01-04']));equal(a.revision_items[0].definition_id,'DEF_V2');equal(a.fingerprint,b.fingerprint);});
test('R73-006','Membership is evaluated at dependent target period',()=>{const r=P.planRevision(request([v2],[membership('2026-01-11','')],['2026-01-04','2026-01-11']));equal(r.revision_items.length,1);equal(r.revision_items[0].target_period,'2026-01-11');});
test('R73-007','Invalid include_flag is rejected',()=>throwsCode(()=>D.Test.normalizeMembershipRow({membership_rule_id:'M',membership_version:'V',aggregate_subject_id:'G',category_id:'C',include_flag:'abc'}),'ALPHA73_MEMBERSHIP_INCLUDE_FLAG_INVALID'));
test('R73-008','Non-overlapping membership versions are valid',()=>equal(D.Test.validateMembershipRows([membership('2020-01-01','2025-12-31',{membership_version:'V1'}),membership('2026-01-01','',{membership_version:'V2'})]).length,2));
test('R73-009','Overlapping membership versions are rejected',()=>throwsCode(()=>D.Test.validateMembershipRows([membership('2020-01-01','2026-01-31',{membership_version:'V1'}),membership('2026-01-01','',{membership_version:'V2'})]),'ALPHA73_RULE_VERSION_CONFLICT'));
test('R73-010','Latest ignores unrelated series',()=>equal(P.buildLatestIntents([],{rows:[{aggregate_series_key:'U',aggregate_row_key:'U1',frequency:'weekly',period_start:'2026-01-04',is_latest_period:1}]}).intents,[]));
test('R73-011','Replacing the same row key does not create a false latest conflict',()=>{const x=P.buildLatestIntents([{aggregate_series_key:'S',aggregate_row_key:'R2',frequency:'weekly',period_start:'2026-01-11'}],{rows:[{aggregate_series_key:'S',aggregate_row_key:'R2',frequency:'weekly',period_start:'2026-01-11',is_latest_period:1}]});equal(x.conflicts,[]);equal(x.intents,[]);});
test('R73-012','Excluding current latest restores the prior row',()=>{const x=P.buildLatestIntents([],{rows:[{aggregate_series_key:'S',aggregate_row_key:'R1',frequency:'weekly',period_start:'2026-01-04'},{aggregate_series_key:'S',aggregate_row_key:'R2',frequency:'weekly',period_start:'2026-01-11',is_latest_period:1}],excluded_row_keys:['R2']});equal(x.intents[0].previous_latest_row_key,'R2');equal(x.intents[0].next_latest_row_key,'R1');});
test('R73-013','Post-change latest ties are surfaced as conflicts',()=>{const x=P.buildLatestIntents([{aggregate_series_key:'S',aggregate_row_key:'R2A',frequency:'weekly',period_start:'2026-01-11'},{aggregate_series_key:'S',aggregate_row_key:'R2B',frequency:'weekly',period_start:'2026-01-11'}],{rows:[]});equal(x.conflicts.length,1);equal(x.intents.length,0);});
test('R73-014','Latest conflicts make the executed plan fail closed',()=>{const original=calculator.calculateBatch;calculator.calculateBatch=batch=>({ok:true,status:'SUCCESS',diagnostics:[],rows:[{aggregate_series_key:'S',aggregate_row_key:'A',frequency:'weekly',period_start:'2026-01-11'},{aggregate_series_key:'S',aggregate_row_key:'B',frequency:'weekly',period_start:'2026-01-11'}]});const r=P.planRevision(request([v2],[membership()],['2026-01-04'],[impact()],{execute_calculator:true}));calculator.calculateBatch=original;assert(!r.ok);equal(r.latest_status,'CONFLICT');assert(r.diagnostics.some(d=>d.code==='ALPHA73_LATEST_CONFLICT'));});
test('R73-015','All impacts for one calculation are retained in the batch and output lineage',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04'],[impact({load_id:'L1'}),impact({load_id:'L2'})],{execute_calculator:true}));equal(r.revision_items[0].source_impacts.length,2);equal(r.calculator_batches[0].impact_items.length,2);equal(r.planned_rows[0].source_impacts.length,2);});
test('R73-016','Deferred mode validates weight snapshot identity',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04'],[impact({weight_snapshot_id:'WRONG'})]));assert(!r.ok);assert(r.diagnostics.some(d=>d.code==='ALPHA73_WEIGHT_SNAPSHOT_MISMATCH'));});
test('R73-017','Deferred mode validates membership snapshot identity',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04'],[impact({membership_snapshot_id:'WRONG'})]));assert(!r.ok);assert(r.diagnostics.some(d=>d.code==='ALPHA73_MEMBERSHIP_SNAPSHOT_MISMATCH'));});
test('R73-018','Indexes are built once for multiple impacts',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04'],Array.from({length:30},(_,i)=>impact({load_id:'L'+i,source_series_id:'SRC'+i}))));const m=r.summary.metrics;equal(m.definition_index_builds,1);equal(m.membership_index_builds,1);equal(m.frontier_index_builds,1);equal(m.definition_rows_indexed,1);equal(m.membership_rows_indexed,1);});
test('R73-019','Calculator batches use shared inputs instead of cloning full inputs',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04']));assert(r.calculator_shared_input.price_inputs.length===1);assert(!Object.prototype.hasOwnProperty.call(r.calculator_batches[0],'price_inputs'));equal(r.calculator_batches[0].shared_input_fingerprint,r.calculator_shared_input.fingerprint);});
test('R73-020','Reversal requires explicit current-effect evidence',()=>{const q=request([v2],[membership()],['2026-01-04']);q.previous_price_inputs=[];const r=P.planReversal(q);assert(!r.ok);assert(r.diagnostics.some(d=>d.code==='ALPHA73_CURRENT_EFFECT_EVIDENCE_REQUIRED'));});
test('R73-021','Reversal requires previous price inputs and fails without throwing',()=>{const q=request([v2],[membership()],['2026-01-04']);q.has_current_effect=true;q.current_effect_evidence={load_id:'L1'};const r=P.planReversal(q);assert(!r.ok);assert(r.diagnostics.some(d=>d.code==='ALPHA73_PREVIOUS_INPUTS_REQUIRED'));});
test('R73-022','No-current-effect reversal is an explicit no-op',()=>{const q=request([v2],[membership()],['2026-01-04']);q.has_current_effect=false;const r=P.planReversal(q);assert(r.ok);equal(r.status,'NO_CURRENT_EFFECT');});
test('R73-023','Plan fingerprint includes snapshots and price inputs',()=>{const a=P.planRevision(request([v2],[membership()],['2026-01-04']));const q=request([v2],[membership()],['2026-01-04']);q.price_inputs=[{category_id:'C',current_value:999}];q.weight_snapshot.hash='WH2';const b=P.planRevision(q);assert(a.fingerprint!==b.fingerprint);});
test('R73-024','Plan is input-order invariant',()=>{const impacts=[impact({load_id:'L1'}),impact({load_id:'L2'})];const a=P.planRevision(request([v2],[membership()],['2026-01-04'],impacts));const b=P.planRevision(request([v2],reverse([membership()]),['2026-01-04'],reverse(impacts)));equal(a.fingerprint,b.fingerprint);});
test('R73-025','Planner does not mutate the request',()=>{const q=request([v2],[membership()],['2026-01-04']);const before=JSON.stringify(q);P.planRevision(q);equal(JSON.stringify(q),before);});
test('R73-026','Borshch definitions require exactly five active source-map categories',()=>throwsCode(()=>D.buildBorshchDefinitions({membership_version:'V1',definition_version:'D1',source_map_id:'SM',provenance:'approved',effective_from:'2026-01-01',membership_rule_id:'M',weight_rule_id:'W',dataset_codes:['D'],source_map:[{category_id:'C1'}]}),'ALPHA73_DEFINITION_MISSING'));
test('R73-027','Borshch source-map metadata is explicit and deterministic',()=>{const sourceMap=['C1','C2','C3','C4','C5'].map(category_id=>({category_id}));const q={membership_version:'V1',definition_version:'D1',source_map_id:'SM1',provenance:'approved memo',effective_from:'2026-01-01',membership_rule_id:'M',weight_rule_id:'W',dataset_codes:['D'],frequencies:['weekly'],value_types:['retail_price'],index_types:['wow'],source_map:sourceMap};const a=D.buildBorshchDefinitions(q),b=D.buildBorshchDefinitions(clone(q));equal(a.source_map_fingerprint,b.source_map_fingerprint);equal(a.summary.active_members,5);});
test('R73-028','Markup definitions require explicit provenance and source_map_id',()=>throwsCode(()=>D.buildAggregateMarkupDefinitions({definition_version:'D1',aggregate_subject_id:'B',dataset_codes:['D'],weight_rule_id:'W',membership_rule_id:'M',effective_from:'2026-01-01'}),'ALPHA73_DEFINITION_MISSING'));
test('R73-029','Accepted release remains read-only and closed',()=>{assert(D.statusSummary().physical_writes===false);assert(P.statusSummary().physical_writes===false);equal(D.statusSummary().acceptance_status,'ACCEPTED_AND_CLOSED');equal(P.statusSummary().acceptance_status,'ACCEPTED_AND_CLOSED');});
test('R73-030','Alpha.7.3 source contains no Google service I/O',()=>{for(const file of ['18_Alpha73SpecialAggregateDefinitions.js','19_Alpha73RevisionPlanner.js']){const source=fs.readFileSync(path.join(root,'src',file),'utf8');for(const token of ['SpreadsheetApp','DriveApp','UrlFetchApp','LockService','PropertiesService','ScriptApp','setValue','setValues','appendRow'])assert(!source.includes(token),`${token} found in ${file}`);}});
test('R73-031','Outside-frontier dependency is audit-blocked and never batched',()=>{const r=P.planRevision(request([v2],[membership()],['2026-01-04']));const blocked=r.revision_items.filter(x=>x.target_period==='2026-01-11'&&x.status==='BLOCKED_CONTRACT'&&x.contract_code==='ALPHA73_PERIOD_OUTSIDE_FRONTIER');equal(blocked.length,1);assert(!r.calculator_batches.some(x=>x.target_period==='2026-01-11'));});
test('R73-032','Apps Script T73-027 encodes blocked audit semantics',()=>{const source=fs.readFileSync(path.join(root,'src','20_Alpha73Tests.js'),'utf8');const start=source.indexOf("T73-027"),end=source.indexOf("T73-028");assert(start>=0&&end>start);const body=source.slice(start,end);for(const token of ['BLOCKED_CONTRACT','ALPHA73_PERIOD_OUTSIDE_FRONTIER','calculator_batches'])assert(body.includes(token),token+' missing from T73-027');});

test('R73-033','Monthly Borshch live gate accepts immutable partial coverage',()=>{const source=fs.readFileSync(path.join(root,'src','20_Alpha73Tests.js'),'utf8');const start=source.indexOf('function liveBorshchGate_'),end=source.indexOf('function liveMarkupGate_');assert(start>=0&&end>start);const body=source.slice(start,end);assert(body.includes('coverage>=1&&coverage<=5'));assert(body.includes('Math.floor(coverage)===coverage'));assert(!body.includes('Number(row[idx])===5'));});
test('R73-034','Markup live gate uses stored six-decimal comparison',()=>{const source=fs.readFileSync(path.join(root,'src','20_Alpha73Tests.js'),'utf8');const helperStart=source.indexOf('function stored6Approx_'),helperEnd=source.indexOf('function test_',helperStart);const gateStart=source.indexOf('function liveMarkupGate_'),gateEnd=source.indexOf('function runLive',gateStart);assert(helperStart>=0&&helperEnd>helperStart&&gateStart>=0&&gateEnd>gateStart);const helper=source.slice(helperStart,helperEnd),gate=source.slice(gateStart,gateEnd);for(const token of ['Math.round(Number(actual)*1000000)','Math.round(Number(expected)*1000000)','Math.abs(actualMicros-expectedMicros)>1'])assert(helper.includes(token),token+' missing from stored6Approx_');assert(gate.includes('stored6Approx_'));});
test('R73-035','Six-decimal rounding guard accepts one micro and rejects two',()=>{const compatible=(actual,expected)=>Math.abs(Math.round(Number(actual)*1000000)-Math.round(Number(expected)*1000000))<=1;assert(compatible(-5.204566,-5.204567));assert(compatible(-0.938891,-0.9388920000000027));assert(!compatible(1.000003,1.000001));});

let passed=0;
const results=tests.map(t=>{try{const data=t.fn();passed++;return{id:t.id,name:t.name,status:'PASS',data:data===undefined?true:data,error:null};}catch(error){return{id:t.id,name:t.name,status:'FAIL',data:null,error:{name:error.name,code:error.code||'',message:error.message,stack:error.stack}};}});
const report={candidate:'4.0.0-alpha.7.3-accepted',total:results.length,passed,failed:results.length-passed,tests:results};
console.log(JSON.stringify(report,null,2));
if(report.failed) process.exit(1);
