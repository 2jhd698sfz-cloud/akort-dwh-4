const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const sandbox = {
  console,
  AKORT: {
    Core: {
      canonicalJson: value => JSON.stringify(value),
      sha256: value => 'SHA_' + String(value).length
    },
    Release: {}
  }
};
vm.createContext(sandbox);
vm.runInContext(parser, sandbox);
const P = sandbox.AKORT.ExistingSourceParsers;

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

test('candidate is .41 and Gate 6 remains .35', () => {
  assert.equal(
    packageJson.version,
    '4.0.0-alpha.7.4.41'
  );
  assert(gate7.includes(
    "var RELEASE = '4.0.0-alpha.7.4.41';"
  ));
  assert(gate6.includes(
    "var RELEASE = '4.0.0-alpha.7.4.35';"
  ));
});

test('two compatibility transforms are exact and bounded', () => {
  [
    'LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000',
    'LEGACY_PURCHASE_PRICE_TONNE_DIV_1000',
    "sourceFileType: 'PPI_INDUSTRIAL'",
    "valueType: 'производитель'",
    "sourceFileType: 'PURCHASE_INDEX'",
    "valueType: 'закупка'",
    'ROS_M_2917D5652F4E',
    'ROS_W_099A0FC24FAB',
    'ROS_W_B97F94BAEE84',
    "sourceUnit: 'tonne'",
    "targetUnit: 'liter'",
    "operation: 'DIVIDE'",
    'factor: 1000',
    "basis: 'VERIFIED_BASELINE_3_1_7'"
  ].forEach(marker => assert(parser.includes(marker), marker));
});

test('stale .38 setting inherits both mandatory transforms', () => {
  const stale = [{
    transformId: 'LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000',
    datasetCode: 'ROSSTAT_MONTHLY',
    sourceFileType: 'PPI_INDUSTRIAL',
    valueType: 'производитель',
    categoryIds: [
      'ROS_M_2917D5652F4E',
      'ROS_W_099A0FC24FAB',
      'ROS_W_B97F94BAEE84'
    ],
    sourceUnit: 'tonne',
    targetUnit: 'liter',
    operation: 'DIVIDE',
    factor: 1000,
    basis: 'VERIFIED_BASELINE_3_1_7'
  }];

  const merged = P.Test.mergeUnitCompatibility(stale);
  const ids = merged.map(item => item.transformId).sort();

  assert.deepEqual(ids, [
    'LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000',
    'LEGACY_PURCHASE_PRICE_TONNE_DIV_1000'
  ]);
});

test('purchase-price transform reproduces baseline value', () => {
  const merged = P.Test.mergeUnitCompatibility([]);
  const converted = P.Test.convertUnit(
    145364.33,
    'т',
    'л',
    {
      profile: {
        datasetCode: 'ROSSTAT_MONTHLY',
        sourceFileType: 'PURCHASE_INDEX',
        valueType: 'закупка'
      },
      mapping: {
        category_id: 'ROS_M_2917D5652F4E'
      },
      unitCompatibility: merged
    }
  );

  assert.equal(
    converted.transformId,
    'LEGACY_PURCHASE_PRICE_TONNE_DIV_1000'
  );
  assert(Math.abs(converted.value - 145.36433) < 1e-9);
});

test('producer-price transform remains unchanged', () => {
  const merged = P.Test.mergeUnitCompatibility([]);
  const converted = P.Test.convertUnit(
    101289.08,
    'т',
    'л',
    {
      profile: {
        datasetCode: 'ROSSTAT_MONTHLY',
        sourceFileType: 'PPI_INDUSTRIAL',
        valueType: 'производитель'
      },
      mapping: {
        category_id: 'ROS_W_099A0FC24FAB'
      },
      unitCompatibility: merged
    }
  );

  assert.equal(
    converted.transformId,
    'LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000'
  );
  assert(Math.abs(converted.value - 101.28908) < 1e-9);
});

test('generic tonne-to-liter conversion remains forbidden', () => {
  const converted = P.Test.convertUnit(
    1000,
    'т',
    'л',
    {
      profile: {
        datasetCode: 'ROSSTAT_MONTHLY',
        sourceFileType: 'PURCHASE_INDEX',
        valueType: 'закупка'
      },
      mapping: { category_id: 'UNAPPROVED_CATEGORY' },
      unitCompatibility:
        P.Test.mergeUnitCompatibility([])
    }
  );

  assert.equal(
    converted.error,
    'UNIT_CONVERSION_NOT_SUPPORTED'
  );
  assert(!parser.includes(
    "source === 'tonne' && target === 'liter'"
  ));
});

test('parser emits compact compatibility evidence', () => {
  [
    'LEGACY_UNIT_COMPATIBILITY_APPLIED',
    'unitCompatibilityConversionCount',
    'unitCompatibilityTransformIds',
    "basis:\n            'VERIFIED_BASELINE_3_1_7'"
  ].forEach(marker => assert(parser.includes(marker), marker));
});

test('Gate 7 fingerprints compatibility evidence', () => {
  [
    'unitCompatibilityConversionCount:',
    'unitCompatibilityTransformIds:'
  ].forEach(marker => assert(gate7.includes(marker), marker));
});

test('Alpha.5 live contract covers producer and purchase profiles', () => {
  [
    'legacy_producer_price_unit_compatibility',
    '101289.08',
    '101.28908',
    'legacy_purchase_price_unit_compatibility',
    '145364.33',
    '145.36433',
    'STALE_UNIT_COMPATIBILITY_NOT_MIGRATED',
    'GENERIC_TONNE_TO_LITER_NOT_BLOCKED'
  ].forEach(marker => assert(alpha5.includes(marker), marker));
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

const failed = tests.filter(item => item.status !== 'PASS');

console.log(JSON.stringify({
  suite: 'existing_source_parsers_unit_compatibility_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
