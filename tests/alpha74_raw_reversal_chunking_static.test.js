const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console, Date, JSON, Math, Object, Array, String, Number, Boolean, Error, RegExp, isFinite
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
    }
  }
};

vm.runInContext(
  fs.readFileSync(path.join(root, 'src/05_RawStore.js'), 'utf8'),
  context,
  { filename: 'src/05_RawStore.js' }
);

const R = context.AKORT.RawStore;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function rawRow(index, loadId = 'LOAD_CANARY') {
  return {
    __row: index + 1,
    observation_id: `OBS_${String(index).padStart(3, '0')}`,
    dataset_code: 'AKORT_WEEKLY',
    category_id: `CATEGORY_${String(Math.ceil(index / 2)).padStart(3, '0')}`,
    value_type: index % 2 ? 'закупка' : 'розница',
    index_type: '',
    observation_date: '2026-07-05',
    value: index,
    version_no: 1,
    revision_type: 'INITIAL',
    is_latest: 1,
    load_id: loadId
  };
}

function reversalRecord(index, reversalLoadId = 'LOAD_REV_EXISTING') {
  return {
    operation_id: 'OP_REVERSAL',
    reversal_load_id: reversalLoadId,
    target_load_id: 'LOAD_CANARY',
    target_table: 'RAW_PRICES_WEEKLY',
    business_key: '',
    reversed_observation_id: `OBS_${String(index).padStart(3, '0')}`,
    restored_observation_id: '',
    status: 'SUCCESS'
  };
}

test('partial .26 reversal resumes at the first observation absent from the durable log', () => {
  const target = Array.from({ length: 50 }, (_, index) => rawRow(index + 1));
  const durable = Array.from({ length: 8 }, (_, index) => reversalRecord(index + 1));
  const plan = R.Test.planReversalChunk('RAW_PRICES_WEEKLY', target, target, durable, 10, 'LOAD_CANARY');
  assert.equal(plan.total, 50);
  assert.equal(plan.completed, 8);
  assert.equal(plan.pending, 42);
  assert.equal(plan.items.length, 10);
  assert.equal(plan.items[0].target.observation_id, 'OBS_009');
  assert.equal(plan.items[9].target.observation_id, 'OBS_018');
});

test('lost response adopts the whole durable chunk and never restarts it', () => {
  const target = Array.from({ length: 50 }, (_, index) => rawRow(index + 1));
  const durable = Array.from({ length: 18 }, (_, index) => reversalRecord(index + 1));
  const plan = R.Test.planReversalChunk('RAW_PRICES_WEEKLY', target, target, durable, 10, 'LOAD_CANARY');
  assert.equal(plan.completed, 18);
  assert.equal(plan.pending, 32);
  assert.equal(plan.items[0].target.observation_id, 'OBS_019');
});

test('duplicate durable observation records fail closed', () => {
  const target = [rawRow(1), rawRow(2)];
  assert.throws(
    () => R.Test.planReversalChunk(
      'RAW_PRICES_WEEKLY', target, target,
      [reversalRecord(1), reversalRecord(1)], 10, 'LOAD_CANARY'
    ),
    error => error.code === 'RAW_REVERSAL_LOG_DUPLICATE'
  );
});

test('multiple reversal load IDs for one operation fail closed', () => {
  assert.throws(
    () => R.Test.reversalLoadId(
      [reversalRecord(1, 'LOAD_REV_A'), reversalRecord(2, 'LOAD_REV_B')],
      'OP_REVERSAL', 'LOAD_CANARY'
    ),
    error => error.code === 'RAW_REVERSAL_LOAD_ID_CONFLICT'
  );
});

test('revision reversal selects the immediately preceding version for latest restoration', () => {
  const previous = { ...rawRow(1, 'LOAD_PREVIOUS'), observation_id: 'OBS_PREVIOUS', version_no: 1, is_latest: 0, __row: 2 };
  const current = { ...rawRow(1, 'LOAD_CANARY'), observation_id: 'OBS_CURRENT', version_no: 2, is_latest: 1, __row: 3 };
  const plan = R.Test.planReversalChunk(
    'RAW_PRICES_WEEKLY', [previous, current], [current], [], 10, 'LOAD_CANARY'
  );
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].target.observation_id, 'OBS_CURRENT');
  assert.equal(plan.items[0].restored.observation_id, 'OBS_PREVIOUS');
});

test('operation handler persists one bounded reversal chunk through repeatPhase', () => {
  const source = fs.readFileSync(path.join(root, 'src/05_RawStore.js'), 'utf8');
  assert(source.includes("RAW_REVERSAL_CHUNK_ROWS"));
  assert(source.includes("schemaVersion: '4.0-raw-reversal-work-1'"));
  assert(source.includes('RAW_REVERSAL_LOG is the exact-once cursor'));
  assert(source.includes('AKORT.RawStore.reverseLoadStep('));
  assert(source.includes('repeatPhase: true'));
  assert(source.includes('getRangeList(targets).setValue(0)'));
  assert(source.includes('function reversalSnapshot(targetLoadId, operationId)'));
  assert(source.includes('state.reversal = compactReversal_(reversalStep.reversal)'));
  assert(source.includes("durableRecordSource: 'RAW_REVERSAL_LOG'"));
  assert(source.includes('AKORT.RawStore.reversalSnapshot('));
  assert(!source.includes('state.reversal = reversalStep.reversal'));
  assert(!source.includes('targetRows.forEach(function (targetRow)'));
});

test('physical mock adopts 8 live rows, finishes in bounded chunks and finalizes exactly once', () => {
  class FakeRange {
    constructor(sheet, row, column, numRows = 1, numColumns = 1) {
      this.sheet = sheet;
      this.row = row;
      this.column = column;
      this.numRows = numRows;
      this.numColumns = numColumns;
    }
    getValues() {
      const out = [];
      for (let r = 0; r < this.numRows; r += 1) {
        const values = [];
        for (let c = 0; c < this.numColumns; c += 1) {
          values.push((this.sheet.rows[this.row + r - 1] || [])[this.column + c - 1] ?? '');
        }
        out.push(values);
      }
      return out;
    }
    setValues(values) {
      for (let r = 0; r < values.length; r += 1) {
        while (this.sheet.rows.length < this.row + r) this.sheet.rows.push([]);
        const target = this.sheet.rows[this.row + r - 1];
        for (let c = 0; c < values[r].length; c += 1) target[this.column + c - 1] = values[r][c];
      }
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
  }
  class FakeSheet {
    constructor(name, headers, records = []) {
      this.name = name;
      this.maxRows = 1000;
      this.rows = [headers.slice()].concat(records.map(record => headers.map(header => record[header] ?? '')));
    }
    getRange(row, column, numRows, numColumns) { return new FakeRange(this, row, column, numRows, numColumns); }
    getLastColumn() { return this.rows[0].length; }
    getLastRow() {
      for (let row = this.rows.length; row >= 1; row -= 1) {
        if ((this.rows[row - 1] || []).some(value => value !== '')) return row;
      }
      return 0;
    }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(_after, count) { this.maxRows += count; }
    getRangeList(ranges) {
      const parsed = ranges.map(a1 => {
        const match = /^([A-Z]+)(\d+)$/.exec(a1);
        let column = 0;
        for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
        return new FakeRange(this, Number(match[2]), column, 1, 1);
      });
      return { setValue(value) { parsed.forEach(range => range.setValue(value)); } };
    }
  }
  class FakeSpreadsheet {
    constructor(sheets) { this.sheets = sheets; }
    getSheetByName(name) { return this.sheets[name] || null; }
  }

  const specs = R.Specs;
  const tables = R.Tables;
  const targetRows = Array.from({ length: 50 }, (_, index) => rawRow(index + 1));
  targetRows.slice(0, 8).forEach(row => { row.is_latest = 0; });
  const targetLoad = {
    load_id: 'LOAD_CANARY', operation_id: 'OP_CANARY', source_id: 'FILE', source_name: 'Weekly', source_hash: 'HASH',
    target_table: 'RAW_PRICES_WEEKLY', status: 'COMMITTED', rows_received: 50, rows_staged: 50,
    rows_inserted: 50, rows_revised: 0, rows_unchanged: 0, rows_reversed: 0,
    started_at: 'START', finished_at: 'FINISH', error_code: '', error_message: '', release_version: '4.0.0-alpha.7.4.26'
  };
  const durable = Array.from({ length: 8 }, (_, index) => ({
    reversal_id: `REV_OLD_${index + 1}`,
    ...reversalRecord(index + 1),
    reversed_at: 'OLD', reason: 'Gate 6', release_version: '4.0.0-alpha.7.4.26'
  }));
  const sheets = {
    RAW_LOAD_REGISTRY: new FakeSheet('RAW_LOAD_REGISTRY', Array.from(tables.RAW_LOAD_REGISTRY), [targetLoad]),
    RAW_REVERSAL_LOG: new FakeSheet('RAW_REVERSAL_LOG', Array.from(tables.RAW_REVERSAL_LOG), durable),
    RAW_STAGE: new FakeSheet('RAW_STAGE', Array.from(tables.RAW_STAGE), []),
    RAW_PRICES_WEEKLY: new FakeSheet('RAW_PRICES_WEEKLY', Array.from(specs.RAW_PRICES_WEEKLY.headers), targetRows)
  };
  const spreadsheet = new FakeSpreadsheet(sheets);
  let uuid = 0;
  context.AKORT.Config = {
    load() { return { resources: { dwhSpreadsheetId: 'DWH' } }; },
    readSystemSettings() { return { RAW_REVERSAL_CHUNK_ROWS: 10 }; }
  };
  context.AKORT.Release = { version: '4.0.0-alpha.7.4.33', rawSchemaVersion: '4.0-raw-1' };
  context.AKORT.Core.now = () => '2026-08-03T00:00:00.000Z';
  context.AKORT.Core.safeJson = JSON.stringify;
  context.AKORT.Core.Sheets = {
    readObjects(sheet) {
      const headers = sheet.rows[0];
      return sheet.rows.slice(1, sheet.getLastRow()).map((values, index) => {
        const object = { __row: index + 2 };
        headers.forEach((header, column) => { object[header] = values[column] ?? ''; });
        return object;
      });
    },
    appendObject(sheet, headers, object) {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
        .setValues([headers.map(header => object[header] ?? '')]);
    }
  };
  context.SpreadsheetApp = { openById() { return spreadsheet; } };
  context.Utilities = {
    getUuid() { uuid += 1; return `00000000-0000-0000-0000-${String(uuid).padStart(12, '0')}`; },
    formatDate() { return '20260803T000000000Z'; }
  };

  assert.deepEqual(
    sheets.RAW_LOAD_REGISTRY.getRange(1, 1, 1, sheets.RAW_LOAD_REGISTRY.getLastColumn()).getValues()[0],
    Array.from(tables.RAW_LOAD_REGISTRY)
  );

  let result = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(result.complete, false);
  assert.equal(result.work.completedRows, 18);
  assert.equal(result.work.lastChunkRows, 10);
  assert.equal(sheets.RAW_REVERSAL_LOG.getLastRow() - 1, 18);

  // The caller intentionally discards result.work, simulating a lost response.
  result = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(result.work.completedRows, 28);
  assert.equal(sheets.RAW_REVERSAL_LOG.getLastRow() - 1, 28);

  result = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(result.work.completedRows, 38);
  result = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(result.work.completedRows, 48);
  result = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(result.complete, true);
  assert.equal(result.work.completedRows, 50);
  assert.equal(result.reversal.reversedRows, 50);
  assert.equal(sheets.RAW_REVERSAL_LOG.getLastRow() - 1, 50);

  const loadRows = context.AKORT.Core.Sheets.readObjects(sheets.RAW_LOAD_REGISTRY);
  assert.equal(loadRows.filter(row => row.load_id === 'LOAD_CANARY')[0].status, 'REVERSED');
  assert.equal(loadRows.filter(row => row.load_id === 'LOAD_REV_EXISTING').length, 1);
  const rawRows = context.AKORT.Core.Sheets.readObjects(sheets.RAW_PRICES_WEEKLY);
  assert.equal(rawRows.filter(row => Number(row.is_latest) === 1).length, 0);

  const replay = R.reverseLoadStep('LOAD_CANARY', 'OP_REVERSAL', 'Gate 6');
  assert.equal(replay.complete, true);
  assert.equal(replay.reversal.reused, true);
  assert.equal(sheets.RAW_REVERSAL_LOG.getLastRow() - 1, 50);
  assert.equal(context.AKORT.Core.Sheets.readObjects(sheets.RAW_LOAD_REGISTRY)
    .filter(row => row.load_id === 'LOAD_REV_EXISTING').length, 1);
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
  console.error(`${failed} Alpha.7.4 RAW reversal chunking test(s) failed.`);
  process.exit(1);
}
console.log(`PASS ${tests.length} Alpha.7.4 RAW reversal chunking tests.`);
