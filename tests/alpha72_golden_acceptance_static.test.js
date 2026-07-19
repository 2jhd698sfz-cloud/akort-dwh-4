'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const contractSource=fs.readFileSync(path.join(root,'src','13_Alpha71AggregateContract.js'),'utf8');
const calculatorSource=fs.readFileSync(path.join(root,'src','15_Alpha72AggregateCalculator.js'),'utf8');
const goldenSource=fs.readFileSync(path.join(root,'src','17_Alpha72GoldenAcceptance.js'),'utf8');
function assert(condition,message){if(!condition)throw new Error(message||'Assertion failed');}
function approx(actual,expected,tolerance=1e-6){assert(Math.abs(Number(actual)-Number(expected))<=tolerance,`expected ${expected}, got ${actual}`);}
const tests=[];function test(name,fn){tests.push({name,fn});}
function runtime(){
  const context={console,Date,JSON,Math,Number,String,Object,Array,RegExp,Error,isFinite,Utilities:undefined,AKORT:{Release:{version:'4.0.0-alpha.6.2.4'}}};
  vm.createContext(context);vm.runInContext(contractSource,context);vm.runInContext(calculatorSource,context);vm.runInContext(goldenSource,context);return context.AKORT.Alpha72GoldenAcceptance;
}
function splitFixture(){
  const context={
    context_id:'SPLIT',dataset_code:'D',frequency:'monthly',value_type:'V',index_type:'mom',period_start:'2026-01',
    group_subject:'G',basket_subject:'B',total_subject:'T',weight_source:'W',weight_year:2026,
    group_weight_scope:'group',basket_weight_scope:'dashboard_basket',total_weight_scope:'total_cpi',coverage_weight_scope:'dashboard_basket'
  };
  const category_rows=[
    {aggregate_level:'category',category_id:'C1',product_group:'G',product_name:'Split',category_value:null,category_change_pp:0.18,contribution_to_group_change_pp:0.018,contribution_to_basket_change_pp:0.0054,contribution_to_total_cpi_pp:0.000281},
    {aggregate_level:'category',category_id:'C2',product_group:'G',product_name:'Full',category_value:108,category_change_pp:2,contribution_to_group_change_pp:0.8,contribution_to_basket_change_pp:0.4,contribution_to_total_cpi_pp:0.02}
  ];
  const aggregate_rows=[
    {aggregate_level:'group',aggregate_name:'G',product_group:'G',aggregate_change_pp:0.818,coverage_categories_count:2,coverage_weight_sum:0.23},
    {aggregate_level:'basket',aggregate_name:'B',aggregate_change_pp:0.4054,coverage_categories_count:2,coverage_weight_sum:0.23},
    {aggregate_level:'total_cpi',aggregate_name:'T',aggregate_change_pp:0.020281,coverage_categories_count:2,coverage_weight_sum:0.23}
  ];
  const weights=[
    {source_code:'W',category_id:'C1',weight_year:2026,weight_scope:'group',weight_value:0.1,allocation_factor:0.0556008853},
    {source_code:'W',category_id:'C2',weight_year:2026,weight_scope:'group',weight_value:0.4,allocation_factor:0.5},
    {source_code:'W',category_id:'C1',weight_year:2026,weight_scope:'dashboard_basket',weight_value:0.03,allocation_factor:0.0556008853},
    {source_code:'W',category_id:'C2',weight_year:2026,weight_scope:'dashboard_basket',weight_value:0.2,allocation_factor:0.5},
    {source_code:'W',category_id:'C1',weight_year:2026,weight_scope:'total_cpi',weight_value:0.0015624824,allocation_factor:0.0556008853},
    {source_code:'W',category_id:'C2',weight_year:2026,weight_scope:'total_cpi',weight_value:0.01,allocation_factor:0.5}
  ];
  return {data:{context,category_rows,aggregate_rows},weights};
}

test('golden source is read-only',()=>{
  ['appendRow','setValue','setValues','clearContent','deleteRow','insertRow','DriveApp','UrlFetchApp','LockService','ScriptApp'].forEach(token=>assert(!goldenSource.includes(token),`forbidden write/orchestration token: ${token}`));
  assert(goldenSource.includes("{lock:false,persistLogs:false}"),'safeRun must disable lock and SYSTEM_LOG persistence');
});
test('all final compatibility ids are implemented',()=>{
  ['T72-052','T72-053','T72-054','T72-055','T72-056'].forEach(id=>assert(goldenSource.includes(id),`missing ${id}`));
});
test('accepted baseline identity is pinned',()=>{
  assert(goldenSource.includes('AKORT_ALPHA6_BASELINE_CANONICAL_20260715_083013'));
  assert(goldenSource.includes('1a6db3d0e56560cc908493fc3ced738d609cdb278bab5390764f090a52efd3f5'));
  assert(goldenSource.includes('459441b75a8020c361d8c2d5a16cb61293322b49e3c1483929cdf3ee3083624a'));
  assert(goldenSource.includes('61636')&&goldenSource.includes('29'));
});
test('weekly and monthly real contexts and coverage scopes are pinned',()=>{
  ['AKORT_WEEKLY_WOW_2024_W02','ROSSTAT_MONTHLY_MOM_2024_01','AKORT_SALES_WEIGHTS','ROSSTAT_CPI_WEIGHTS','akort_basket','dashboard_basket','total_cpi','coverage_weight_scope'].forEach(token=>assert(goldenSource.includes(token),`missing fixture token ${token}`));
});
test('golden adapter reconstructs from already allocated raw weights',()=>{
  assert(goldenSource.includes("getSheetByName(WEIGHTS_SHEET)"));
  assert(goldenSource.includes('weight_value'));
  assert(goldenSource.includes('ALPHA72_GOLDEN_SOURCE_PARITY'));
  assert(goldenSource.includes('AKORT.AggregateCalculator.calculateBatch'));
  assert(goldenSource.includes('change*weightValue'));
  assert(!goldenSource.includes('change*weightValue*allocation'));
  assert(goldenSource.includes('allocation_factor:1'));
});
test('legacy coverage is reconstructed from basket-weight scope',()=>{
  assert(goldenSource.includes('coverageWeights = weightMap_'));
  assert(goldenSource.includes('coverageWeightSum+=coverageWeightValue'));
  assert(goldenSource.includes('ALPHA72_GOLDEN_COVERAGE_WEIGHT_MISMATCH'));
});
test('golden adapter validates deterministic contract keys',()=>{
  assert(goldenSource.includes('AKORT.AggregateContract.aggregateRowKey'));
  assert(goldenSource.includes('aggregate_series_key===built.definition.series_key'));
  assert(goldenSource.includes('ALPHA72_GOLDEN_KEY_MISMATCH'));
});
test('source scans bounded columns and chunks',()=>{
  assert(goldenSource.includes('CHUNK_ROWS = 1500'));
  assert(goldenSource.includes('READ_COLUMNS = 26'));
  assert(!goldenSource.includes('getDataRange'));
});
test('status and runner entrypoints exist',()=>{
  assert(goldenSource.includes('function AKORT_alpha72RunGoldenCompatibility'));
  assert(goldenSource.includes('function AKORT_alpha72GoldenAcceptanceStatus'));
});
test('split allocation is not applied twice for group basket and total CPI',()=>{
  const G=runtime(),fixture=splitFixture();
  const expected={group:0.818,basket:0.4054,total_cpi:0.020281};
  const calculationWeights={group:0.5,basket:0.23,total_cpi:0.0115624824};
  Object.keys(expected).forEach(level=>{
    const result=G.Test.evaluateFixture(fixture.data,fixture.weights,level);
    approx(result.calculated_value,expected[level]);
    approx(result.calculation_weight_sum,calculationWeights[level],1e-10);
    approx(result.accepted_coverage_weight_sum,0.23,1e-10);
    assert(result.coverage_weight_scope==='dashboard_basket');
  });
});

test('missing category value remains MISSING while explicit category change is calculated',()=>{
  const G=runtime(),fixture=splitFixture(),built=G.Test.buildGoldenRequest(fixture.data,fixture.weights,'total_cpi');
  const missing=built.request.price_inputs.find(row=>row.category_id==='C1');
  assert(missing.current_value===null,'empty accepted category_value must stay null');
  assert(missing.current_state==='MISSING','empty accepted category_value must be classified as MISSING');
  assert(missing.change_pp===0.18&&missing.change_state==='VALID','valid explicit category_change_pp must remain calculable');
  const result=G.Test.evaluateFixture(fixture.data,fixture.weights,'total_cpi');
  approx(result.calculated_value,0.020281);
});

test('calculator request neutralizes source allocation after weight allocation',()=>{
  const G=runtime(),fixture=splitFixture(),built=G.Test.buildGoldenRequest(fixture.data,fixture.weights,'total_cpi');
  assert(built.request.membership_snapshot.rule_rows.every(row=>row.allocation_factor===1),'membership allocation must be neutral');
  const c1=built.request.weight_snapshot.rule_rows.find(row=>row.category_id==='C1');
  approx(c1.weight_value,0.0015624824,1e-12);
  approx(built.source_allocation_factors.C1,0.0556008853,1e-12);
  approx(built.expected_calculation_weight_sum,0.0115624824,1e-10);
  approx(built.expected_coverage_weight_sum,0.23,1e-10);
});

let failed=0;for(const item of tests){try{item.fn();console.log(`PASS ${item.name}`);}catch(error){failed++;console.error(`FAIL ${item.name}: ${error.stack||error}`);}}
console.log(JSON.stringify({suite:'alpha72_golden_acceptance_static_r3',total:tests.length,failed},null,2));process.exitCode=failed?1:0;
