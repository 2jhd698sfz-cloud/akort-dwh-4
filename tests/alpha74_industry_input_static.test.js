const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
  Date,
  JSON,
  Math,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  RegExp,
  isFinite
});

context.AKORT = {
  Core: {
    sha256(value) {
      return crypto.createHash('sha256').update(String(value)).digest('hex');
    },
    error(code, message, details) {
      const error = new Error(message);
      error.code = code;
      error.details = details || {};
      return error;
    },
    now() {
      return '2026-07-28T00:00:00.000Z';
    }
  }
};

vm.runInContext(
  fs.readFileSync(path.join(root, 'src/27_Alpha74IndustryInput.js'), 'utf8'),
  context,
  { filename: 'src/27_Alpha74IndustryInput.js' }
);

const I = context.AKORT.IndustryInput;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function dimension(overrides = {}) {
  return {
    series_id: 'IND_TEST',
    frequency: 'monthly',
    period_basis: 'calendar_month',
    metric_type: 'level_currency',
    is_active: 1,
    ...overrides
  };
}

test('operator form contract is explicit and only two columns are user inputs', () => {
  assert.equal(I.Version, '4.0-alpha74-industry-input-1');
  assert.equal(I.Release, '4.0.0-alpha.7.4.37');
  assert.equal(I.SheetName, 'INDUSTRY_INPUT');
  assert.equal(I.LogSheetName, 'INDUSTRY_INPUT_LOG');
  assert.deepEqual(
    Array.from(I.Headers).slice(5, 7),
    ['Период', 'Значение']
  );
});

test('calendar month accepts ISO and Russian month notation', () => {
  const iso = I.Test.parsePeriod('2026-06', dimension());
  const russian = I.Test.parsePeriod('06.2026', dimension());
  assert.equal(iso.label, '2026-06');
  assert.equal(iso.periodStart, '2026-06-01');
  assert.equal(iso.periodEnd, '2026-06-30');
  assert.equal(russian.periodStart, iso.periodStart);
  assert.equal(russian.periodEnd, iso.periodEnd);
});

test('quarter boundaries distinguish ordinary and cumulative periods', () => {
  const ordinary = I.Test.parsePeriod('2026-Q2', dimension({
    frequency: 'quarterly',
    period_basis: 'quarter'
  }));
  const cumulative = I.Test.parsePeriod('2 кв. 2026', dimension({
    frequency: 'quarterly',
    period_basis: 'cumulative_ytd'
  }));
  assert.equal(ordinary.periodStart, '2026-04-01');
  assert.equal(ordinary.periodEnd, '2026-06-30');
  assert.equal(cumulative.periodStart, '2026-01-01');
  assert.equal(cumulative.periodEnd, '2026-06-30');
});

test('annual input expands to a complete calendar year', () => {
  const annual = I.Test.parsePeriod('2025', dimension({
    frequency: 'annual',
    period_basis: 'calendar_year'
  }));
  assert.equal(annual.label, '2025');
  assert.equal(annual.periodStart, '2025-01-01');
  assert.equal(annual.periodEnd, '2025-12-31');
});

test('numbers accept Russian formatting and metric guardrails fail closed', () => {
  assert.equal(I.Test.parseNumber('1 234,56'), 1234.56);
  assert.equal(I.Test.validateMetricValue('9,96', dimension({ metric_type: 'share_percent' })), 9.96);
  assert.throws(
    () => I.Test.validateMetricValue('101', dimension({ metric_type: 'share_percent' })),
    error => error.code === 'INDUSTRY_INPUT_SHARE_OUT_OF_RANGE'
  );
  assert.throws(
    () => I.Test.validateMetricValue('-1', dimension({ metric_type: 'level_count' })),
    error => error.code === 'INDUSTRY_INPUT_NEGATIVE_VALUE_FORBIDDEN'
  );
  assert.equal(
    I.Test.validateMetricValue('-7', dimension({ metric_type: 'index_points' })),
    -7
  );
});

test('blank rows are ignored so indicators may arrive asynchronously', () => {
  const rawState = { byBusinessKey: {}, latestBySeries: {} };
  const candidate = I.Test.normalizedCandidate(
    { __row: 6, series_id: 'IND_TEST', Период: '', Значение: '' },
    dimension(),
    rawState,
    new Date(2026, 6, 28)
  );
  assert.equal(candidate.empty, true);
});

test('new, revised and unchanged values are classified deterministically', () => {
  assert.equal(I.Test.classifyAction(null, 10), 'INSERT');
  assert.equal(I.Test.classifyAction({ value: 10 }, 11), 'REVISION');
  assert.equal(I.Test.classifyAction({ value: '10,000000' }, 10), 'NOOP');
});

test('future periods and incomplete rows are blocked before RAW writes', () => {
  const rawState = { byBusinessKey: {}, latestBySeries: {} };
  assert.throws(
    () => I.Test.normalizedCandidate(
      { __row: 6, series_id: 'IND_TEST', Период: '2026-08', Значение: 10 },
      dimension(),
      rawState,
      new Date(2026, 6, 28)
    ),
    error => error.code === 'INDUSTRY_INPUT_FUTURE_PERIOD'
  );
  assert.throws(
    () => I.Test.normalizedCandidate(
      { __row: 6, series_id: 'IND_TEST', Период: '2026-06', Значение: '' },
      dimension(),
      rawState,
      new Date(2026, 6, 28)
    ),
    error => error.code === 'INDUSTRY_INPUT_ROW_INCOMPLETE'
  );
});


test('Gate 7 acceptance API is narrow and exact', () => {
  assert(I.Acceptance);
  assert.equal(
    I.Acceptance.PermitSchema,
    '4.0-alpha74-gate7-industry-permit-1'
  );
  assert.equal(
    I.Acceptance.PermitProperty,
    'AKORT_ALPHA74_GATE7_INDUSTRY_PERMIT_V1'
  );
  [
    'inspect',
    'submit',
    'continueLatest',
    'snapshot',
    'operationSummary',
    'permitDigest'
  ].forEach(name => {
    assert.equal(typeof I.Acceptance[name], 'function');
  });
});

test('ordinary Industry submit remains gated by the user pipeline', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/27_Alpha74IndustryInput.js'),
    'utf8'
  );
  const start = source.indexOf('function submit()');
  const end = source.indexOf('function continueLatest()', start);
  const ordinarySubmit = source.slice(start, end);
  assert(ordinarySubmit.includes('assertLiveSubmissionReady_();'));
  assert(source.includes(
    'INDUSTRY_INPUT_GATE7_USER_PIPELINE_MUST_REMAIN_DISABLED'
  ));
});

test('Gate 7 permit binds exact rows and a stable content hash', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/27_Alpha74IndustryInput.js'),
    'utf8'
  );
  assert(source.includes('INDUSTRY_INPUT_GATE7_ROW_BINDING_MISMATCH'));
  assert(source.includes('INDUSTRY_INPUT_GATE7_CONTENT_HASH_MISMATCH'));
  assert(source.includes("permit.status = 'CLAIMED';"));
  assert(source.includes("permit.status = 'CONSUMED';"));
  assert(source.includes("permit.status = 'COMPLETE';"));
});

let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(error && error.stack || error);
  }
}

if (failed) {
  console.error(`${failed} Alpha.7.4 Industry Input test(s) failed.`);
  process.exit(1);
}

console.log(`PASS ${tests.length} Alpha.7.4 Industry Input tests.`);
