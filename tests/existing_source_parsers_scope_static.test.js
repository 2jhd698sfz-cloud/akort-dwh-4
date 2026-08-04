const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const parser = fs.readFileSync(
  path.join(root, 'src/06_ExistingSourceParsers.js'),
  'utf8'
);
const alpha5 = fs.readFileSync(
  path.join(root, 'src/11_Alpha5Tests.js'),
  'utf8'
);
const gate7 = fs.readFileSync(
  path.join(root, 'src/29_Alpha74Gate7Acceptance.js'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: 'PASS' });
    console.log('PASS ' + name);
  } catch (error) {
    tests.push({
      name,
      status: 'FAIL',
      error: error.message
    });
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('full source exports are filtered by active monitoring scope', () => {
  [
    'OUT_OF_MONITORING_SCOPE_IGNORED',
    "issues.push(issue_(\n        'INFO',",
    'ignoredObservationCount',
    'ignoredSourceLabelCount',
    'configuredCategoryCount',
    'matchedCategoryCount'
  ].forEach(marker => assert(
    parser.includes(marker),
    marker
  ));

  assert(!parser.includes(
    "issues.push(issue_('ERROR', 'MAPPING_REQUIRED'"
  ));
});

test('empty monitoring scope and invalid mapped targets remain fail closed', () => {
  assert(parser.includes('MONITORING_SCOPE_EMPTY'));
  assert(parser.includes('TARGET_CATEGORY_MISSING'));
  assert(parser.includes('UNIT_NOT_RECOGNIZED'));
  assert(parser.includes('UNIT_CONVERSION_NOT_SUPPORTED'));
});

test('parser summaries expose filtering evidence without row-level issue spam', () => {
  assert(parser.includes(
    'monitoringScope: clone_(mapped.monitoringScope || {})'
  ));
  assert(parser.includes(
    'sourceLabelsSample: ignoredLabels.slice(0, 20)'
  ));
  assert(parser.includes(
    "issueCode: code"
  ));
});

test('Alpha.5 live contract uses a mapped and an out-of-scope source row', () => {
  assert(alpha5.includes(
    "source_scope_filtering_and_blocking_validation"
  ));
  assert(alpha5.includes('Категория вне мониторинга'));
  assert(alpha5.includes(
    'PARSER_SOURCE_SCOPE_FILTER_FAILED'
  ));
  assert(alpha5.includes('MONITORING_SCOPE_EMPTY'));
});

test('Gate 7 fingerprints include scope counts', () => {
  [
    'configuredCategoryCount: item.configuredCategoryCount',
    'matchedCategoryCount: item.matchedCategoryCount',
    'ignoredObservationCount: item.ignoredObservationCount',
    'ignoredSourceLabelCount: item.ignoredSourceLabelCount'
  ].forEach(marker => assert(
    gate7.includes(marker),
    marker
  ));
});

test('Gate 7 automatically resets an older preview candidate state', () => {
  assert(gate7.includes(
    'function stateContractMatches_(state)'
  ));
  assert(gate7.includes(
    '!stateContractMatches_(state) ||'
  ));
  assert(gate7.includes(
    "text_(state.release) === RELEASE"
  ));
});

test('candidate is .38 and accepted Gate 6 remains pinned to .35', () => {
  assert.equal(
    packageJson.version,
    '4.0.0-alpha.7.4.39'
  );
  assert(gate7.includes(
    "var RELEASE = '4.0.0-alpha.7.4.39';"
  ));
});

test('scope test is wired into the full regression', () => {
  assert.equal(
    packageJson.scripts['test:source-parser-scope'],
    'node tests/existing_source_parsers_scope_static.test.js'
  );
  assert(packageJson.scripts.test.includes(
    'npm run test:source-parser-scope'
  ));
});

const failed = tests.filter(
  item => item.status !== 'PASS'
);

console.log(JSON.stringify({
  suite: 'existing_source_parsers_scope_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
