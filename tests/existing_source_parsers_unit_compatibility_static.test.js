const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    'utf8'
  );
}

const parser = read('src/06_ExistingSourceParsers.js');
const alpha5 = read('src/11_Alpha5Tests.js');
const gate7 = read('src/29_Alpha74Gate7Acceptance.js');
const gate6 = read('src/28_Alpha74Gate6Acceptance.js');
const packageJson = JSON.parse(read('package.json'));

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
    console.error(
      'FAIL ' + name + ': ' + error.message
    );
  }
}

test('candidate is .38 and Gate 6 remains .35', () => {
  assert.equal(
    packageJson.version,
    '4.0.0-alpha.7.4.40'
  );
  assert(gate7.includes(
    "var RELEASE = '4.0.0-alpha.7.4.40';"
  ));
  assert(gate6.includes(
    "var RELEASE = '4.0.0-alpha.7.4.35';"
  ));
});

test('compatibility transform is exact and bounded to three categories', () => {
  [
    'LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000',
    'ROS_M_2917D5652F4E',
    'ROS_W_099A0FC24FAB',
    'ROS_W_B97F94BAEE84',
    "sourceUnit: 'tonne'",
    "targetUnit: 'liter'",
    "operation: 'DIVIDE'",
    'factor: 1000',
    "basis: 'VERIFIED_BASELINE_3_1_7'"
  ].forEach(marker => assert(
    parser.includes(marker),
    marker
  ));
});

test('compatibility transform is configuration-backed', () => {
  assert(parser.includes(
    'PARSER_UNIT_COMPATIBILITY'
  ));
  assert(parser.includes(
    "type: 'JSON'"
  ));
  assert(parser.includes(
    'unitCompatibility: clone_(unitCompatibility)'
  ));
});

test('generic tonne-to-liter conversion remains forbidden', () => {
  assert(!parser.includes(
    "source === 'tonne' && target === 'liter'"
  ));
  assert(parser.includes(
    "'UNIT_CONVERSION_NOT_SUPPORTED'"
  ));
  assert(parser.includes(
    'categoryIds.indexOf('
  ));
});

test('parser emits compact compatibility evidence', () => {
  [
    'LEGACY_UNIT_COMPATIBILITY_APPLIED',
    'unitCompatibilityConversionCount',
    'unitCompatibilityTransformIds',
    "basis:\n            'VERIFIED_BASELINE_3_1_7'"
  ].forEach(marker => assert(
    parser.includes(marker),
    marker
  ));
});

test('Gate 7 fingerprints compatibility evidence', () => {
  [
    'unitCompatibilityConversionCount:',
    'unitCompatibilityTransformIds:'
  ].forEach(marker => {
    assert(gate7.includes(marker), marker);
  });
});

test('Alpha.5 live contract proves exact baseline result', () => {
  [
    'legacy_producer_price_unit_compatibility',
    '101289.08',
    '101.28908',
    'GENERIC_TONNE_TO_LITER_NOT_BLOCKED'
  ].forEach(marker => assert(
    alpha5.includes(marker),
    marker
  ));
});

test('test is wired into full regression', () => {
  assert.equal(
    packageJson.scripts[
      'test:source-parser-unit-compatibility'
    ],
    'node tests/existing_source_parsers_unit_compatibility_static.test.js'
  );
  assert(packageJson.scripts.test.includes(
    'npm run test:source-parser-unit-compatibility'
  ));
});

const failed = tests.filter(
  item => item.status !== 'PASS'
);

console.log(JSON.stringify({
  suite:
    'existing_source_parsers_unit_compatibility_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
