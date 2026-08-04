const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const parser = read('src/06_ExistingSourceParsers.js');
const gate6 = read('src/28_Alpha74Gate6Acceptance.js');
const gate7 = read('src/29_Alpha74Gate7Acceptance.js');
const pkg = JSON.parse(read('package.json'));
function err(code, message, details) { const e = new Error(message); e.code = code; e.details = details || {}; return e; }
const sandbox = { console, AKORT: { Core: { error: err, canonicalJson: JSON.stringify, sha256: x => 'SHA_' + String(x).length }, Release: {} } };
vm.createContext(sandbox);
vm.runInContext(parser, sandbox);
const P = sandbox.AKORT.ExistingSourceParsers;
const tests = [];
function test(name, fn) { try { fn(); tests.push({name,status:'PASS'}); console.log('PASS ' + name); } catch (e) { tests.push({name,status:'FAIL',error:e.message}); console.error('FAIL ' + name + ': ' + e.message); } }
function wb(name, year, date) { return { fileName:name, sheets:[{name:'DATA', values:[['YEAR',year],[],['Еженедельные данные'],[],['product_name / observation_date',date],['Товар, кг',100]]}] }; }
test('candidate .42 and Gate 6 .35 are exact', () => { assert.equal(pkg.version,'4.0.0-alpha.7.4.42'); assert(gate7.includes("var RELEASE = '4.0.0-alpha.7.4.42';")); assert(gate6.includes("var RELEASE = '4.0.0-alpha.7.4.35';")); });
test('CPI dated file resolves ISO week 28', () => { const r=P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI_06.07.2026.xlsx',2026,'на 6 июля'),{}); assert.equal(r.year,2026); assert.equal(r.week,28); });
test('price dated file resolves ISO week 28', () => { const r=P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_PRICES_06.07.2026.xlsx',2026,'на 6 июля'),{}); assert.equal(r.week,28); });
test('header-only date resolves without W filename', () => { const r=P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI.xlsx',2026,'на 6 июля'),{}); assert.equal(r.week,28); });
test('ISO year boundary is exact', () => { const r=P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI_29.12.2025.xlsx',2025,'на 29 декабря'),{}); assert.equal(r.year,2026); assert.equal(r.week,1); });
test('W filename remains supported', () => { const r=P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI_W27.xlsx',2026,'на 29 июня'),{}); assert.equal(r.week,27); });
test('filename/header mismatch fails closed', () => { let e; try { P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI_06.07.2026.xlsx',2026,'на 13 июля'),{}); } catch(x) { e=x; } assert(e); assert.equal(e.code,'WEEKLY_PERIOD_SOURCE_MISMATCH'); });
test('wrong explicit week fails closed', () => { let e; try { P.Test.resolveOptions(wb('ROSSTAT_WEEKLY_RETAIL_CPI_06.07.2026.xlsx',2026,'на 6 июля'),{week:27}); } catch(x) { e=x; } assert(e); assert.equal(e.code,'WEEKLY_PERIOD_OVERRIDE_MISMATCH'); });
test('monthly file gets no synthetic week', () => { const r=P.Test.resolveOptions({fileName:'ROSSTAT_MONTHLY_RETAIL_CPI_M05.xlsx',sheets:[{name:'DATA',values:[['YEAR',2026],['MONTH',5],[],['product_name','mom'],['Товар',100]]}]},{}); assert.equal(r.month,5); assert.equal(r.week,undefined); });
test('test is wired', () => { assert.equal(pkg.scripts['test:source-parser-weekly-period'],'node tests/existing_source_parsers_weekly_period_static.test.js'); assert(pkg.scripts.test.includes('npm run test:source-parser-weekly-period')); });
const failed=tests.filter(x=>x.status!=='PASS'); console.log(JSON.stringify({suite:'existing_source_parsers_weekly_period_static',total:tests.length,failed:failed.length},null,2)); if(failed.length) process.exit(1);
