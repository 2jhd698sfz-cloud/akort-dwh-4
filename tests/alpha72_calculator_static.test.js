'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const contractSource=read('src/13_Alpha71AggregateContract.js');
const acceptedSuiteSource=read('src/14_Alpha71ContractTests.js');
const calculatorSource=read('src/15_Alpha72AggregateCalculator.js');
const calculatorSuiteSource=read('src/16_Alpha72CalculatorTests.js');
const packageJson=JSON.parse(read('package.json'));
const context={console,Date,JSON,Math,Number,String,Object,Array,RegExp,Error,isFinite};
vm.createContext(context);
vm.runInContext(contractSource,context,{filename:'13_Alpha71AggregateContract.js'});
vm.runInContext(calculatorSource,context,{filename:'15_Alpha72AggregateCalculator.js'});
vm.runInContext(calculatorSuiteSource,context,{filename:'16_Alpha72CalculatorTests.js'});
const A=context.AKORT.AggregateCalculator,T=context.AKORT.Alpha72CalculatorTests;
function assert(value,message){if(!value)throw new Error(message||'Assertion failed.');}
function equal(a,b,message){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((message||'Values differ')+`: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
function gitBlobSha(content){const body=Buffer.from(content,'utf8');return crypto.createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');}
const staticTests=[];
function test(id,name,fn){staticTests.push({id,name,fn});}

test('S72-001','Public API is complete',()=>{['calculateBatch','calculateStandardAggregate','calculateNormalizedWeightedAverage','calculateAggregateMarkup','calculatePercentChange','buildCalculationFingerprint','statusSummary'].forEach(name=>assert(typeof A[name]==='function',`Missing export ${name}`));});
test('S72-002','Calculator contract metadata is exact',()=>{assert(A.Version==='4.0-aggregate-calculator-1');assert(A.InputContractVersion==='4.0-aggregate-contract-2');assert(A.Release==='4.0.0-alpha.7.2');});
test('S72-003','Accepted Alpha.7.1 contract source is unchanged',()=>assert(gitBlobSha(contractSource)==='f12f30edd9e6b79aa6e7441cffdf5b284c59ad4e'));
test('S72-004','Accepted Alpha.7.1 suite source is unchanged',()=>assert(gitBlobSha(acceptedSuiteSource)==='d4b10c5dbd38f22151667dd4e56742ad4489e25a'));
test('S72-005','Calculator source is service-I/O free',()=>['SpreadsheetApp','DriveApp','UrlFetchApp','LockService','PropertiesService','ScriptApp'].forEach(token=>assert(!calculatorSource.includes(token),`Forbidden token ${token}`)));
test('S72-006','Calculator source has no random identity',()=>assert(!calculatorSource.includes('Math.random')));
test('S72-007','Pure SHA-256 implementation is stable',()=>assert(A.Test.sha256('abc')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('S72-008','Candidate status does not claim acceptance',()=>assert(A.statusSummary().acceptance_status.includes('DRAFT_FOR_CODE_REVIEW')));
test('S72-009','Node test command preserves Alpha.7.1 regression',()=>{assert(packageJson.scripts.test.includes('test:alpha71-contract'));assert(packageJson.scripts.test.includes('test:alpha72-calculator'));});
test('S72-010','Apps Script entry points are present',()=>['AKORT_alpha72RunCalculatorTests','AKORT_alpha72CalculatorStatus','AKORT_alpha72PureCalculatorProbe'].forEach(name=>assert(calculatorSuiteSource.includes(`function ${name}`),`Missing ${name}`)));
test('S72-011','Compatibility gates remain explicit pending work',()=>['T72-052','T72-053','T72-054','T72-055','T72-056'].forEach(id=>assert(calculatorSuiteSource.includes(id),`Missing pending gate ${id}`)));
test('S72-012','Live suite pins accepted aggregate inventory',()=>{assert(calculatorSuiteSource.includes('61636'));assert(calculatorSuiteSource.includes('1a6db3d0e56560cc908493fc3ced738d609cdb278bab5390764f090a52efd3f5'));assert(calculatorSuiteSource.includes('459441b75a8020c361d8c2d5a16cb61293322b49e3c1483929cdf3ee3083624a'));});
test('S72-013','Definition conflicts are explicit',()=>assert(calculatorSource.includes('AGG_CALC_DEFINITION_CONFLICT')));
test('S72-014','Unit contracts are enforced',()=>{assert(calculatorSource.includes('AGG_CALC_UNIT_MISMATCH'));assert(calculatorSource.includes('unitsCompatible_'));});
test('S72-015','Live suite disables logs and locks',()=>{assert(calculatorSuiteSource.includes('{lock:false,persistLogs:false}'));assert(!calculatorSuiteSource.includes('{lock:true,persistLogs:true}'));});
test('S72-016','Membership candidate resolution has no full-group filter',()=>{const start=calculatorSource.indexOf('function memberCandidates_'),end=calculatorSource.indexOf('function resolveWeight_',start),body=calculatorSource.slice(start,end);assert(start>=0&&end>start);assert(!body.includes('.filter('),'memberCandidates_ must use the category index, not filter the full membership group');});
test('S72-017','NOT_APPLICABLE is resolved before unit validation',()=>{assert(calculatorSource.includes('var unitRelevant = change.state !== VALUE_STATES.NOT_APPLICABLE'));assert(calculatorSource.includes('var purchaseNumeric = purchaseState.state === VALUE_STATES.VALID'));assert(calculatorSource.includes('not_applicable:purchaseState.state === VALUE_STATES.NOT_APPLICABLE && retailState.state === VALUE_STATES.NOT_APPLICABLE'));});
test('S72-018','Lineage keeps paired impact and combo identities',()=>{assert(calculatorSource.includes('source_impacts'));assert(calculatorSource.includes('function lineagePairKey_'));assert(calculatorSource.includes('function applyLineagePairs_'));assert(!calculatorSource.includes('function attachImpactLineage_'));});
test('S72-019','Repeated impacts do not rescan output rows',()=>{const marker='if (processedCalculations[calculationKey])',start=calculatorSource.indexOf(marker),end=calculatorSource.indexOf('return;',start)+7,body=calculatorSource.slice(start,end);assert(start>=0);assert(body.includes('collectCalculationLineage_'));assert(!body.includes('rowMap'));assert(!body.includes('uniqueSorted_'));});
test('S72-020','Membership duplicate identity excludes effective dates',()=>{assert(calculatorSource.includes("var duplicateKey = [text_(row.membership_version || row.version),category].join('|')"));assert(!calculatorSource.includes("var duplicateKey = [text_(row.membership_version || row.version),category,text_(row.effective_from),text_(row.effective_to)].join('|')"));});

let staticFailed=0;
for(const t of staticTests){try{t.fn();console.log(`PASS ${t.id} ${t.name}`);}catch(error){staticFailed++;console.error(`FAIL ${t.id} ${t.name}: ${error.stack||error}`);}}
const pure=T.runPure({calculator_source:calculatorSource,suite_source:calculatorSuiteSource});
for(const t of pure.tests){if(t.status==='PASS')console.log(`PASS ${t.id} ${t.name}`);else if(t.status==='SKIP')console.log(`SKIP ${t.id} ${t.name}`);else console.error(`FAIL ${t.id} ${t.name}: ${t.error&&t.error.stack||t.error&&t.error.message||'unknown'}`);}
const report={suite:'alpha72_calculator_static',static_total:staticTests.length,static_failed:staticFailed,pure_total:pure.total,pure_passed:pure.passed,pure_failed:pure.failed,pure_skipped:pure.skipped,total:staticTests.length+pure.total,failed:staticFailed+pure.failed};
console.log(JSON.stringify(report,null,2));
process.exitCode=report.failed?1:0;
