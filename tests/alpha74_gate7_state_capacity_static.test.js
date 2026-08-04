const assert = require('assert');
const crypto = require('crypto');
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

const source = read('src/29_Alpha74Gate7Acceptance.js');
const packageJson = JSON.parse(read('package.json'));

const sandbox = {
  AKORT: {},
  console
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, {
  filename: '29_Alpha74Gate7Acceptance.js'
});

const api = sandbox.AKORT.Alpha74Gate7Acceptance.Test;
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

const profileIds = [
  'AKORT_WEEKLY_W00',
  'ROSSTAT_WEEKLY_RETAIL_PRICES',
  'ROSSTAT_WEEKLY_RETAIL_CPI',
  'AKORT_MONTHLY_M00',
  'ROSSTAT_MONTHLY_RETAIL_PRICES_M00',
  'ROSSTAT_MONTHLY_RETAIL_CPI_M00',
  'ROSSTAT_MONTHLY_PURCHASE_INDEX_M00',
  'ROSSTAT_MONTHLY_PURCHASE_PRICES_M00',
  'ROSSTAT_MONTHLY_PPI_INDUSTRY_M00',
  'ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00',
  'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00',
  'ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00'
];

function profile(profileId, index) {
  return {
    profileId,
    familyCode: index < 3 ? 'WEEKLY' : 'MONTHLY',
    frequency: index < 3 ? 'weekly' : 'monthly',
    targetTable:
      index < 3
        ? 'RAW_PRICES_WEEKLY'
        : 'RAW_PRICES_MONTHLY',
    datasetCode:
      profileId.indexOf('AKORT_') === 0
        ? profileId.indexOf('WEEKLY') >= 0
          ? 'AKORT_WEEKLY'
          : 'AKORT_MONTHLY'
        : 'ROSSTAT_MONTHLY',
    sourceFileType:
      'SOURCE_FILE_TYPE_' + index,
    valueType:
      'VALUE_TYPE_' + index,
    parserKind:
      index < 3
        ? 'WIDE_WEEKLY'
        : 'MONTHLY_MATRIX'
  };
}

const profiles = profileIds.map(profile);
const byProfile = Object.fromEntries(
  profiles.map(item => [item.profileId, item])
);

function fullItem(itemProfile, index) {
  const compatibility =
    itemProfile.profileId ===
      'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00'
      ? ['LEGACY_PPI_INDUSTRIAL_TONNE_DIV_1000']
      : [];

  return {
    ...itemProfile,
    fileId:
      '1' + String(index).padStart(2, '0') +
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk',
    fileName:
      'ROSSTAT_CONTROL_FILE_' +
      String(index).padStart(2, '0') +
      '_FULL_SOURCE_EXPORT.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 123456 + index,
    fileUpdatedAt: '2026-08-04T09:43:24.042Z',
    sourceHash:
      crypto.createHash('sha256')
        .update('source-' + index)
        .digest('hex'),
    structuralFingerprint:
      crypto.createHash('sha256')
        .update('structure-' + index)
        .digest('hex'),
    confidenceScore: 100,
    confidenceMargin: 25,
    resolvedOptions: {
      year: 2026,
      month: index < 3 ? '' : 6,
      week: index < 3 ? 27 : '',
      sourcePublishedAt: ''
    },
    sourceObservationCount: 1000 + index,
    normalizedRowCount: 50 + index,
    configuredCategoryCount: 25,
    matchedCategoryCount: 20,
    ignoredObservationCount: 900,
    ignoredSourceLabelCount: 200,
    unitCompatibilityConversionCount:
      compatibility.length ? 3 : 0,
    unitCompatibilityTransformIds: compatibility,
    issueCount: compatibility.length ? 2 : 1,
    warningCount: 0,
    infoCount: compatibility.length ? 2 : 1,
    previewFingerprint:
      crypto.createHash('sha256')
        .update('preview-' + index)
        .digest('hex')
  };
}

test('candidate and compact state contracts are exact', () => {
  assert.equal(
    packageJson.version,
    '4.0.0-alpha.7.4.39'
  );
  assert(source.includes(
    "var VERSION = '4.0-alpha74-gate7-acceptance-2';"
  ));
  assert(source.includes(
    "var STATE_SCHEMA = '4.0-alpha74-gate7-state-2';"
  ));
  assert(source.includes(
    "var PREVIEW_ITEM_ENCODING = 'ARRAY_V1';"
  ));
  assert(source.includes(
    'var MAX_STATE_BYTES = 8500;'
  ));
});

test('compact preview item round-trips stable evidence exactly', () => {
  const original = fullItem(profiles[10], 10);
  const compact = api.compactPreviewItem(original);
  const expanded = api.expandPreviewItem(
    compact,
    byProfile
  );

  assert(Array.isArray(compact));
  assert.equal(compact.length, 23);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(
      api.stablePreviewItem(expanded)
    )),
    JSON.parse(JSON.stringify(
      api.stablePreviewItem(original)
    ))
  );
  assert.equal(
    expanded.previewFingerprint,
    original.previewFingerprint
  );
  assert.equal(
    expanded.fileName,
    original.fileName
  );
  assert.equal(
    expanded.mimeType,
    original.mimeType
  );
});

test('twelve-profile durable state stays below frozen capacity', () => {
  const fullItems = profiles.map(fullItem);
  const compactItems = fullItems.map(
    api.compactPreviewItem
  );

  const common = {
    schemaVersion: '4.0-alpha74-gate7-state-2',
    release: '4.0.0-alpha.7.4.39',
    version: '4.0-alpha74-gate7-acceptance-2',
    itemEncoding: 'ARRAY_V1',
    status: 'PREVIEW_ACCEPTED',
    controlFingerprint: 'c'.repeat(64),
    cursor: 12,
    startedAt: '2026-08-04T09:43:24.042Z',
    updatedAt: '2026-08-04T09:43:24.042Z',
    acceptedAt: '2026-08-04T09:50:24.042Z',
    matrixFingerprint: 'm'.repeat(64)
  };

  const expandedBytes = JSON.stringify({
    ...common,
    items: fullItems
  }).length;

  const compactBytes = JSON.stringify({
    ...common,
    items: compactItems
  }).length;

  assert(
    expandedBytes > 8500,
    'Representative full state no longer proves the incident.'
  );
  assert(
    compactBytes < 8000,
    'Compact state lacks at least 500 characters of guard headroom.'
  );

  console.log(JSON.stringify({
    expandedBytes,
    compactBytes,
    maximum: 8500,
    headroom: 8500 - compactBytes
  }));
});

test('durable state stores compact records and expands only for evidence', () => {
  [
    'state.items.push(compactPreviewItem_(item));',
    'var expandedItems =',
    'expandPreviewItems_(state.items);',
    'expandedItems.map(stablePreviewItem_)',
    'matrix: clone_(expandedItems)',
    'var items = expandPreviewItems_(state.items || []);'
  ].forEach(marker => assert(
    source.includes(marker),
    marker
  ));
});

test('capacity test is wired into the full regression', () => {
  assert.equal(
    packageJson.scripts[
      'test:alpha74-gate7-state-capacity'
    ],
    'node tests/alpha74_gate7_state_capacity_static.test.js'
  );
  assert(
    packageJson.scripts.test.includes(
      'npm run test:alpha74-gate7-state-capacity'
    )
  );
});

const failed = tests.filter(
  item => item.status !== 'PASS'
);

console.log(JSON.stringify({
  suite: 'alpha74_gate7_state_capacity_static',
  total: tests.length,
  failed: failed.length
}, null, 2));

if (failed.length) process.exit(1);
