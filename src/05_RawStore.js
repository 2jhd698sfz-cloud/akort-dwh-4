var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.4 canonical RAW storage layer.
 * Input rows must already be normalized; source-specific parsing starts in alpha.5.
 * Publish and aggregate tables are intentionally never changed by this module.
 */
AKORT.RawStore = (function () {
  var TABLES = {
    RAW_STAGE: [
      'stage_id', 'operation_id', 'load_id', 'target_table', 'business_key',
      'content_hash', 'row_payload_json', 'stage_status', 'commit_action',
      'target_observation_id', 'error_code', 'error_message', 'staged_at',
      'committed_at', 'release_version'
    ],
    RAW_LOAD_REGISTRY: [
      'load_id', 'operation_id', 'source_id', 'source_name', 'source_hash',
      'target_table', 'status', 'rows_received', 'rows_staged', 'rows_inserted',
      'rows_revised', 'rows_unchanged', 'rows_reversed', 'started_at',
      'finished_at', 'error_code', 'error_message', 'release_version'
    ],
    RAW_REVERSAL_LOG: [
      'reversal_id', 'operation_id', 'reversal_load_id', 'target_load_id',
      'target_table', 'business_key', 'reversed_observation_id',
      'restored_observation_id', 'reversed_at', 'reason', 'status',
      'release_version'
    ]
  };

  var SETTINGS = {
    RAW_SCHEMA_VERSION: {
      value: '4.0-raw-1', type: 'STRING',
      description: 'Canonical RAW Store contract version'
    },
    RAW_STAGE_BATCH_SIZE: {
      value: 500, type: 'NUMBER',
      description: 'Maximum normalized rows written to RAW_STAGE per batch'
    },
    RAW_DUPLICATE_POLICY: {
      value: 'REUSE_COMMITTED', type: 'STRING',
      description: 'Duplicate source hashes reuse an existing committed load'
    },
    RAW_REVERSAL_POLICY: {
      value: 'LATEST_LOAD_ONLY', type: 'STRING',
      description: 'Logical reversal is allowed only when no later revision exists'
    },
    RAW_REVERSAL_CHUNK_ROWS: {
      value: 10, type: 'NUMBER',
      description: 'Maximum RAW observations reversed in one durable Operation Engine checkpoint'
    },
    RAW_STORE_ENABLED: {
      value: true, type: 'BOOLEAN',
      description: 'Enable normalized alpha.4 RAW Store operations in DEV'
    }
  };

  var SPECS = {
    RAW_PRICES_WEEKLY: {
      headers: [
        'observation_id', 'dataset_code', 'category_id', 'value_type',
        'index_type', 'observation_date', 'value', 'version_no',
        'revision_type', 'is_latest', 'source_published_at', 'loaded_at', 'load_id'
      ],
      keyFields: ['dataset_code', 'category_id', 'value_type', 'index_type', 'observation_date'],
      requiredFields: ['dataset_code', 'category_id', 'value_type', 'observation_date', 'value'],
      dateFields: ['observation_date', 'source_published_at'],
      contentFields: ['value']
    },
    RAW_PRICES_MONTHLY: {
      headers: [
        'observation_id', 'dataset_code', 'category_id', 'value_type',
        'index_type', 'observation_month', 'value', 'version_no',
        'revision_type', 'is_latest', 'source_published_at', 'loaded_at', 'load_id'
      ],
      keyFields: ['dataset_code', 'category_id', 'value_type', 'index_type', 'observation_month'],
      requiredFields: ['dataset_code', 'category_id', 'value_type', 'observation_month', 'value'],
      dateFields: ['observation_month', 'source_published_at'],
      contentFields: ['value']
    },
    RAW_INDUSTRY: {
      headers: [
        'observation_id', 'series_id', 'period_start', 'period_end', 'value',
        'version_no', 'revision_type', 'is_latest', 'source_published_at',
        'loaded_at', 'load_id'
      ],
      keyFields: ['series_id', 'period_start', 'period_end'],
      requiredFields: ['series_id', 'period_start', 'period_end', 'value'],
      dateFields: ['period_start', 'period_end', 'source_published_at'],
      contentFields: ['value']
    }
  };

  var LOAD_STATUSES = {
    CREATED: 'CREATED',
    STAGED: 'STAGED',
    COMMITTING: 'COMMITTING',
    COMMITTED: 'COMMITTED',
    REVERSING: 'REVERSING',
    FAILED: 'FAILED',
    REVERSED: 'REVERSED'
  };

  function clone_(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (e) { return 'unknown'; }
  }

  function compactUuid_() {
    return Utilities.getUuid().replace(/-/g, '').slice(-12).toUpperCase();
  }

  function timeId_() {
    return Utilities.formatDate(new Date(), 'GMT', "yyyyMMdd'T'HHmmssSSS'Z'");
  }

  function id_(prefix) {
    return String(prefix) + '_' + timeId_() + '_' + compactUuid_();
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function table_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw AKORT.Core.error('RAW_TABLE_MISSING', 'Missing table ' + name + '. Run AKORT_alpha4Install first.');
    var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var expected = headers || TABLES[name] || (SPECS[name] && SPECS[name].headers);
    if (!expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error('RAW_SCHEMA_MISMATCH', 'Unexpected schema for ' + name + '.', {
        expected: expected || null,
        actual: actual
      });
    }
    return { sheet: sheet, headers: actual };
  }

  function ensureTable_(spreadsheet, name, headers) {
    var sheet = spreadsheet.getSheetByName(name);
    var created = false;
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      created = true;
    }
    var lastColumn = sheet.getLastColumn();
    var actual = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
    var blank = actual.length === 0 || actual.every(function (value) { return value === ''; });
    if (sheet.getLastRow() === 0 || blank) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (JSON.stringify(actual.map(String)) !== JSON.stringify(headers)) {
      throw AKORT.Core.error('RAW_SCHEMA_MISMATCH', 'Unexpected schema for ' + name + '.', {
        expected: headers,
        actual: actual
      });
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    return { name: name, created: created, columns: headers.length };
  }

  function readObjects_(table) {
    return AKORT.Core.Sheets.readObjects(table.sheet);
  }

  function rowValues_(headers, object) {
    return headers.map(function (header) {
      var value = object[header];
      return value === undefined || value === null ? '' : value;
    });
  }

  function appendObject_(table, object) {
    AKORT.Core.Sheets.appendObject(table.sheet, table.headers, object);
    object.__row = table.sheet.getLastRow();
    return object;
  }

  function saveObject_(table, object) {
    if (!object.__row) throw AKORT.Core.error('ROW_REFERENCE_MISSING', 'Cannot update a row without __row.');
    table.sheet.getRange(object.__row, 1, 1, table.headers.length).setValues([rowValues_(table.headers, object)]);
    return object;
  }

  function deleteRows_(sheet, rows) {
    rows.sort(function (a, b) { return b - a; });
    rows.forEach(function (row) { sheet.deleteRow(row); });
    return rows.length;
  }

  function spec_(targetTable) {
    var spec = SPECS[String(targetTable || '')];
    if (!spec) throw AKORT.Core.error('UNSUPPORTED_RAW_TARGET', 'Unsupported RAW target table.', { targetTable: targetTable });
    return spec;
  }

  function normalizeDate_(value, field) {
    if (value === '' || value === null || value === undefined) return '';
    var date = Object.prototype.toString.call(value) === '[object Date]' ? new Date(value.getTime()) : new Date(value);
    if (isNaN(date.getTime())) {
      throw AKORT.Core.error('INVALID_RAW_DATE', 'Invalid date in normalized RAW row.', { field: field, value: value });
    }
    return date;
  }

  function keyValue_(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, 'GMT', 'yyyy-MM-dd');
    }
    if (typeof value === 'number') return String(value);
    return String(value === null || value === undefined ? '' : value).trim();
  }

  function normalizedValue_(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    if (typeof value === 'number') {
      if (!isFinite(value)) throw AKORT.Core.error('INVALID_RAW_NUMBER', 'RAW numeric value must be finite.', { value: value });
      return Number(value);
    }
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeRow_(targetTable, input) {
    var spec = spec_(targetTable);
    var row = {};
    Object.keys(input || {}).forEach(function (key) { row[key] = input[key]; });
    spec.dateFields.forEach(function (field) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') row[field] = normalizeDate_(row[field], field);
    });
    if (row.value !== undefined && row.value !== null && row.value !== '') {
      row.value = Number(row.value);
      if (!isFinite(row.value)) throw AKORT.Core.error('INVALID_RAW_NUMBER', 'RAW value must be a finite number.', { value: input.value });
    }
    spec.requiredFields.forEach(function (field) {
      if (row[field] === undefined || row[field] === null || row[field] === '') {
        throw AKORT.Core.error('RAW_REQUIRED_FIELD_MISSING', 'Normalized RAW row is missing a required field.', {
          targetTable: targetTable,
          field: field,
          row: input
        });
      }
    });
    return row;
  }

  function businessKey_(targetTable, row) {
    var spec = spec_(targetTable);
    return targetTable + '|' + spec.keyFields.map(function (field) {
      return field + '=' + keyValue_(row[field]);
    }).join('|');
  }

  function contentHash_(targetTable, row) {
    var spec = spec_(targetTable);
    var payload = { targetTable: targetTable, businessKey: businessKey_(targetTable, row), content: {} };
    spec.contentFields.forEach(function (field) { payload.content[field] = normalizedValue_(row[field]); });
    return AKORT.Core.sha256(AKORT.Core.canonicalJson(payload));
  }

  function rowPayload_(targetTable, row) {
    var spec = spec_(targetTable);
    var payload = {};
    spec.headers.forEach(function (header) {
      if (['observation_id', 'version_no', 'revision_type', 'is_latest', 'loaded_at', 'load_id'].indexOf(header) >= 0) return;
      if (row[header] !== undefined) payload[header] = normalizedValue_(row[header]);
    });
    return payload;
  }

  function parsePayload_(value) {
    if (typeof value === 'object' && value !== null) return clone_(value);
    try { return JSON.parse(String(value || '{}')); }
    catch (caught) {
      throw AKORT.Core.error('INVALID_STAGE_PAYLOAD', 'RAW_STAGE payload is not valid JSON.', { cause: String(caught) });
    }
  }

  function headersIndex_(headers) {
    var index = {};
    headers.forEach(function (header, i) { index[header] = i; });
    return index;
  }

  function upsertSettings_() {
    var spreadsheet = getDwh_();
    var settings = table_(spreadsheet, 'SYSTEM_SETTINGS', AKORT.Core.Tables.SYSTEM_SETTINGS);
    var rows = readObjects_(settings);
    var byKey = {};
    rows.forEach(function (row) { byKey[String(row.setting_key)] = row; });
    var actions = [];
    Object.keys(SETTINGS).forEach(function (key) {
      var definition = SETTINGS[key];
      var existing = byKey[key];
      if (!existing) {
        appendObject_(settings, {
          setting_key: key,
          setting_value: definition.value,
          value_type: definition.type,
          environment: 'DEV',
          is_secret: 0,
          is_active: 1,
          description: definition.description,
          updated_at: AKORT.Core.now(),
          updated_by: currentUser_()
        });
        actions.push({ setting: key, action: 'INSERTED' });
        return;
      }
      var mustUpdate =
        String(existing.setting_value) !== String(definition.value) ||
        String(existing.value_type) !== String(definition.type) ||
        String(existing.environment) !== 'DEV' ||
        !truthy_(existing.is_active);
      if (mustUpdate) {
        existing.setting_value = definition.value;
        existing.value_type = definition.type;
        existing.environment = 'DEV';
        existing.is_secret = 0;
        existing.is_active = 1;
        existing.description = definition.description;
        existing.updated_at = AKORT.Core.now();
        existing.updated_by = currentUser_();
        saveObject_(settings, existing);
        actions.push({ setting: key, action: 'UPDATED' });
      } else {
        actions.push({ setting: key, action: 'UNCHANGED' });
      }
    });
    return actions;
  }

  function runtimeSettings_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      schemaVersion: String(settings.RAW_SCHEMA_VERSION || AKORT.Release.rawSchemaVersion),
      stageBatchSize: Number(settings.RAW_STAGE_BATCH_SIZE || 500),
      duplicatePolicy: String(settings.RAW_DUPLICATE_POLICY || 'REUSE_COMMITTED'),
      reversalPolicy: String(settings.RAW_REVERSAL_POLICY || 'LATEST_LOAD_ONLY'),
      reversalChunkRows: Math.max(1, Number(settings.RAW_REVERSAL_CHUNK_ROWS || 10)),
      enabled: settings.RAW_STORE_ENABLED === undefined ? true : Boolean(settings.RAW_STORE_ENABLED)
    };
  }

  function install() {
    var engineResult = AKORT.OperationEngine.install();
    if (!engineResult.ok) return engineResult;
    return AKORT.Core.safeRun('RAW_STORE_INSTALL', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var spreadsheet = getDwh_();
      var tables = [];
      Object.keys(TABLES).forEach(function (name) {
        tables.push(ensureTable_(spreadsheet, name, TABLES[name]));
      });
      var settingActions = upsertSettings_();
      context.logger.info('Raw Store installed', {
        rawSchemaVersion: AKORT.Release.rawSchemaVersion,
        tables: tables,
        settingActions: settingActions
      }, { eventCode: 'RAW_STORE_INSTALLED' });
      return AKORT.Result.success('Raw Store installed successfully.', {
        release: AKORT.Release.manifest(),
        manifestHash: AKORT.Core.manifestHash(),
        coreRegistration: engineResult.data ? engineResult.data.coreRegistration : null,
        rawSchemaVersion: AKORT.Release.rawSchemaVersion,
        rawTargets: Object.keys(SPECS),
        serviceTables: tables,
        settingActions: settingActions,
        runtimeSettings: runtimeSettings_()
      });
    }, { lock: true, persistLogs: true });
  }

  function loadTable_(spreadsheet) { return table_(spreadsheet, 'RAW_LOAD_REGISTRY', TABLES.RAW_LOAD_REGISTRY); }
  function stageTable_(spreadsheet) { return table_(spreadsheet, 'RAW_STAGE', TABLES.RAW_STAGE); }
  function reversalTable_(spreadsheet) { return table_(spreadsheet, 'RAW_REVERSAL_LOG', TABLES.RAW_REVERSAL_LOG); }

  function findLoad_(spreadsheet, loadId) {
    var loads = loadTable_(spreadsheet);
    var match = readObjects_(loads).filter(function (row) { return String(row.load_id) === String(loadId); })[0];
    if (!match) throw AKORT.Core.error('RAW_LOAD_NOT_FOUND', 'RAW load was not found.', { loadId: loadId });
    return { table: loads, load: match };
  }

  function existingSourceLoad_(spreadsheet, targetTable, sourceHash) {
    var rows = readObjects_(loadTable_(spreadsheet));
    return rows.filter(function (row) {
      return String(row.target_table) === String(targetTable) &&
        String(row.source_hash) === String(sourceHash) &&
        [LOAD_STATUSES.CREATED, LOAD_STATUSES.STAGED, LOAD_STATUSES.COMMITTING, LOAD_STATUSES.COMMITTED, LOAD_STATUSES.REVERSING].indexOf(String(row.status)) >= 0;
    })[0] || null;
  }

  function beginLoad(source, options) {
    source = source || {};
    options = options || {};
    var targetTable = String(source.targetTable || source.target_table || '');
    spec_(targetTable);
    var sourceHash = String(source.sourceHash || source.source_hash || '');
    if (!sourceHash) {
      throw AKORT.Core.error('SOURCE_HASH_REQUIRED', 'A deterministic source hash is required for duplicate-load protection.');
    }
    var spreadsheet = getDwh_();
    var existing = existingSourceLoad_(spreadsheet, targetTable, sourceHash);
    if (existing) {
      if (String(existing.status) === LOAD_STATUSES.REVERSING) {
        throw AKORT.Core.error('RAW_SOURCE_REVERSAL_IN_PROGRESS', 'The matching source load is being reversed and cannot be reused until its durable reversal finishes.', {
          loadId: existing.load_id,
          targetTable: targetTable,
          sourceHash: sourceHash
        });
      }
      return {
        loadId: existing.load_id,
        reused: true,
        status: existing.status,
        load: existing
      };
    }
    var loads = loadTable_(spreadsheet);
    var record = {
      load_id: options.loadId || id_('LOAD'),
      operation_id: String(options.operationId || source.operationId || ''),
      source_id: String(source.sourceId || source.source_id || ''),
      source_name: String(source.sourceName || source.source_name || ''),
      source_hash: sourceHash,
      target_table: targetTable,
      status: LOAD_STATUSES.CREATED,
      rows_received: Number(source.rowCount || source.rows_received || 0),
      rows_staged: 0,
      rows_inserted: 0,
      rows_revised: 0,
      rows_unchanged: 0,
      rows_reversed: 0,
      started_at: AKORT.Core.now(),
      finished_at: '',
      error_code: '',
      error_message: '',
      release_version: AKORT.Release.version
    };
    appendObject_(loads, record);
    return { loadId: record.load_id, reused: false, status: record.status, load: record };
  }

  function prepareRows(targetTable, rows) {
    var prepared = [];
    var keys = {};
    (rows || []).forEach(function (input, index) {
      var row = normalizeRow_(targetTable, input);
      var key = businessKey_(targetTable, row);
      var hash = contentHash_(targetTable, row);
      if (keys[key] && keys[key] !== hash) {
        throw AKORT.Core.error('DUPLICATE_BUSINESS_KEY_IN_BATCH', 'One batch contains conflicting rows for the same business key.', {
          targetTable: targetTable,
          businessKey: key,
          rowIndex: index
        });
      }
      if (keys[key] === hash) return;
      keys[key] = hash;
      prepared.push({
        row: row,
        businessKey: key,
        contentHash: hash,
        payload: rowPayload_(targetTable, row)
      });
    });
    return prepared;
  }

  function stageRows(loadId, rows) {
    var spreadsheet = getDwh_();
    var found = findLoad_(spreadsheet, loadId);
    var load = found.load;
    if (String(load.status) === LOAD_STATUSES.COMMITTED) {
      return { loadId: loadId, reused: true, staged: Number(load.rows_staged || 0), status: load.status };
    }
    if ([LOAD_STATUSES.CREATED, LOAD_STATUSES.STAGED].indexOf(String(load.status)) < 0) {
      throw AKORT.Core.error('RAW_LOAD_NOT_STAGEABLE', 'RAW load cannot accept staging rows in its current status.', {
        loadId: loadId,
        status: load.status
      });
    }
    var prepared = prepareRows(String(load.target_table), rows || []);
    var runtime = runtimeSettings_();
    if (prepared.length > runtime.stageBatchSize) {
      throw AKORT.Core.error('RAW_STAGE_BATCH_TOO_LARGE', 'Normalized staging batch exceeds RAW_STAGE_BATCH_SIZE.', {
        actual: prepared.length,
        maximum: runtime.stageBatchSize
      });
    }
    var stage = stageTable_(spreadsheet);
    var existingRows = readObjects_(stage).filter(function (row) { return String(row.load_id) === String(loadId); });
    var existing = {};
    existingRows.forEach(function (row) { existing[String(row.business_key) + '|' + String(row.content_hash)] = true; });
    var inserted = 0;
    prepared.forEach(function (item) {
      var signature = item.businessKey + '|' + item.contentHash;
      if (existing[signature]) return;
      appendObject_(stage, {
        stage_id: id_('STAGE'),
        operation_id: load.operation_id,
        load_id: loadId,
        target_table: load.target_table,
        business_key: item.businessKey,
        content_hash: item.contentHash,
        row_payload_json: AKORT.Core.safeJson(item.payload),
        stage_status: 'STAGED',
        commit_action: '',
        target_observation_id: '',
        error_code: '',
        error_message: '',
        staged_at: AKORT.Core.now(),
        committed_at: '',
        release_version: AKORT.Release.version
      });
      existing[signature] = true;
      inserted += 1;
    });
    var total = readObjects_(stage).filter(function (row) { return String(row.load_id) === String(loadId); }).length;
    load.rows_received = Number(load.rows_received || prepared.length || 0);
    load.rows_staged = total;
    load.status = LOAD_STATUSES.STAGED;
    load.error_code = '';
    load.error_message = '';
    saveObject_(found.table, load);
    return { loadId: loadId, inserted: inserted, staged: total, status: load.status };
  }

  function rawRowObjects_(rawTable) {
    return readObjects_(rawTable);
  }

  function businessKeyFromRaw_(targetTable, row) {
    return businessKey_(targetTable, row);
  }

  function contentHashFromRaw_(targetTable, row) {
    return contentHash_(targetTable, row);
  }

  function observationId_(targetTable, businessKey, versionNo, loadId) {
    return 'OBS_' + AKORT.Core.sha256(targetTable + '|' + businessKey + '|' + versionNo + '|' + loadId).slice(0, 28).toUpperCase();
  }

  function rawRecord_(targetTable, payload, versionNo, revisionType, loadId, businessKey) {
    var spec = spec_(targetTable);
    var record = {};
    spec.headers.forEach(function (header) { record[header] = ''; });
    Object.keys(payload).forEach(function (key) {
      if (spec.headers.indexOf(key) >= 0) record[key] = payload[key];
    });
    spec.dateFields.forEach(function (field) {
      if (record[field] !== '' && record[field] !== null && record[field] !== undefined) record[field] = normalizeDate_(record[field], field);
    });
    record.observation_id = observationId_(targetTable, businessKey, versionNo, loadId);
    record.version_no = versionNo;
    record.revision_type = revisionType;
    record.is_latest = 1;
    record.loaded_at = new Date();
    record.load_id = loadId;
    return record;
  }

  function updateLatestFlag_(rawTable, row, value) {
    var index = headersIndex_(rawTable.headers);
    rawTable.sheet.getRange(row.__row, index.is_latest + 1).setValue(value ? 1 : 0);
    row.is_latest = value ? 1 : 0;
  }

  function commitLoad(loadId) {
    var spreadsheet = getDwh_();
    var found = findLoad_(spreadsheet, loadId);
    var load = found.load;
    if (String(load.status) === LOAD_STATUSES.COMMITTED) {
      return {
        loadId: loadId,
        reused: true,
        status: load.status,
        inserted: Number(load.rows_inserted || 0),
        revised: Number(load.rows_revised || 0),
        unchanged: Number(load.rows_unchanged || 0)
      };
    }
    if (String(load.status) !== LOAD_STATUSES.STAGED) {
      throw AKORT.Core.error('RAW_LOAD_NOT_COMMITTABLE', 'RAW load must be STAGED before COMMIT_RAW.', {
        loadId: loadId,
        status: load.status
      });
    }
    var stageTable = stageTable_(spreadsheet);
    var stageRowsForLoad = readObjects_(stageTable).filter(function (row) {
      return String(row.load_id) === String(loadId);
    });
    if (!stageRowsForLoad.length) throw AKORT.Core.error('RAW_STAGE_EMPTY', 'RAW load has no staged rows.', { loadId: loadId });
    var targetTable = String(load.target_table);
    var rawTable = table_(spreadsheet, targetTable, spec_(targetTable).headers);
    var allRaw = rawRowObjects_(rawTable);
    var byKey = {};
    allRaw.forEach(function (row) {
      var key = businessKeyFromRaw_(targetTable, row);
      byKey[key] = byKey[key] || [];
      byKey[key].push(row);
    });
    load.status = LOAD_STATUSES.COMMITTING;
    saveObject_(found.table, load);
    var counters = { inserted: 0, revised: 0, unchanged: 0 };
    try {
      stageRowsForLoad.forEach(function (stageRow) {
        if (String(stageRow.stage_status) === 'COMMITTED') {
          counters[String(stageRow.commit_action).toLowerCase()] = Number(counters[String(stageRow.commit_action).toLowerCase()] || 0) + 1;
          return;
        }
        var key = String(stageRow.business_key);
        var history = byKey[key] || [];
        var latest = history.filter(function (row) { return truthy_(row.is_latest); });
        if (latest.length > 1) {
          throw AKORT.Core.error('RAW_LATEST_CONFLICT', 'More than one latest row exists for a business key.', {
            targetTable: targetTable,
            businessKey: key,
            latestCount: latest.length
          });
        }
        var action;
        var observationId = '';
        if (latest.length && contentHashFromRaw_(targetTable, latest[0]) === String(stageRow.content_hash)) {
          action = 'UNCHANGED';
          observationId = latest[0].observation_id;
          counters.unchanged += 1;
        } else {
          var maxVersion = history.reduce(function (max, row) { return Math.max(max, Number(row.version_no || 0)); }, 0);
          if (latest.length) updateLatestFlag_(rawTable, latest[0], false);
          var revisionType = history.length ? (latest.length ? 'REVISION' : 'RESTORE_AFTER_REVERSAL') : 'INITIAL';
          var payload = parsePayload_(stageRow.row_payload_json);
          var record = rawRecord_(targetTable, payload, maxVersion + 1, revisionType, loadId, key);
          appendObject_(rawTable, record);
          observationId = record.observation_id;
          byKey[key] = history.concat([record]);
          action = history.length ? 'REVISED' : 'INSERTED';
          if (action === 'REVISED') counters.revised += 1;
          else counters.inserted += 1;
        }
        stageRow.stage_status = 'COMMITTED';
        stageRow.commit_action = action;
        stageRow.target_observation_id = observationId;
        stageRow.error_code = '';
        stageRow.error_message = '';
        stageRow.committed_at = AKORT.Core.now();
        saveObject_(stageTable, stageRow);
      });
      load.status = LOAD_STATUSES.COMMITTED;
      load.rows_inserted = counters.inserted;
      load.rows_revised = counters.revised;
      load.rows_unchanged = counters.unchanged;
      load.finished_at = AKORT.Core.now();
      load.error_code = '';
      load.error_message = '';
      saveObject_(found.table, load);
      return {
        loadId: loadId,
        reused: false,
        status: load.status,
        inserted: counters.inserted,
        revised: counters.revised,
        unchanged: counters.unchanged,
        staged: stageRowsForLoad.length
      };
    } catch (caught) {
      load.status = LOAD_STATUSES.FAILED;
      load.finished_at = AKORT.Core.now();
      load.error_code = caught && caught.code ? caught.code : 'RAW_COMMIT_FAILED';
      load.error_message = caught && caught.message ? caught.message : String(caught);
      saveObject_(found.table, load);
      throw caught;
    }
  }

  function status(loadId) {
    var spreadsheet = getDwh_();
    var found = findLoad_(spreadsheet, loadId);
    var stages = readObjects_(stageTable_(spreadsheet)).filter(function (row) { return String(row.load_id) === String(loadId); });
    return {
      load: found.load,
      stages: stages,
      stageCount: stages.length
    };
  }

  function auditLoad(loadId) {
    var spreadsheet = getDwh_();
    var found = findLoad_(spreadsheet, loadId);
    var load = found.load;
    var stages = readObjects_(stageTable_(spreadsheet)).filter(function (row) { return String(row.load_id) === String(loadId); });
    var committed = stages.filter(function (row) { return String(row.stage_status) === 'COMMITTED'; });
    var targetTable = String(load.target_table);
    var rawTable = table_(spreadsheet, targetTable, spec_(targetTable).headers);
    var latestCounts = {};
    rawRowObjects_(rawTable).forEach(function (row) {
      if (!truthy_(row.is_latest)) return;
      var key = businessKeyFromRaw_(targetTable, row);
      latestCounts[key] = Number(latestCounts[key] || 0) + 1;
    });
    var conflicts = Object.keys(latestCounts).filter(function (key) { return latestCounts[key] > 1; });
    var expectedCommitted = Number(load.rows_staged || 0);
    var ok = String(load.status) === LOAD_STATUSES.COMMITTED && committed.length === expectedCommitted && conflicts.length === 0;
    return {
      ok: ok,
      loadId: loadId,
      loadStatus: load.status,
      staged: stages.length,
      committedStages: committed.length,
      expectedCommitted: expectedCommitted,
      latestConflicts: conflicts
    };
  }

  function deterministicReversalLoadId_(operationId, targetLoadId) {
    return 'LOAD_REV_' + AKORT.Core.sha256(String(operationId || '') + '|' + String(targetLoadId || '')).slice(0, 28).toUpperCase();
  }

  function reversalRecordsFor_(table, operationId, targetLoadId) {
    return readObjects_(table).filter(function (row) {
      return String(row.operation_id) === String(operationId || '') &&
        String(row.target_load_id) === String(targetLoadId || '') &&
        String(row.status) === 'SUCCESS';
    });
  }

  function reversalLoadIdFor_(records, operationId, targetLoadId) {
    var ids = {};
    (records || []).forEach(function (row) {
      var value = String(row.reversal_load_id || '');
      if (value) ids[value] = true;
    });
    var values = Object.keys(ids);
    if (values.length > 1) {
      throw AKORT.Core.error('RAW_REVERSAL_LOAD_ID_CONFLICT', 'One reversal operation contains more than one reversal load ID.', {
        operationId: operationId,
        targetLoadId: targetLoadId,
        reversalLoadIds: values
      });
    }
    return values[0] || deterministicReversalLoadId_(operationId, targetLoadId);
  }

  function reversalIndex_(targetTable, allRows) {
    var byKey = {};
    (allRows || []).forEach(function (row) {
      var key = businessKeyFromRaw_(targetTable, row);
      byKey[key] = byKey[key] || [];
      byKey[key].push(row);
    });
    Object.keys(byKey).forEach(function (key) {
      byKey[key].sort(function (a, b) {
        return Number(a.version_no || 0) - Number(b.version_no || 0) || Number(a.__row || 0) - Number(b.__row || 0);
      });
    });
    return byKey;
  }

  function planReversalChunk_(targetTable, allRows, targetRows, existingRecords, chunkRows, targetLoadId) {
    var byKey = reversalIndex_(targetTable, allRows);
    var targetByObservation = {};
    (targetRows || []).forEach(function (row) {
      var observationId = String(row.observation_id || '');
      if (!observationId || targetByObservation[observationId]) {
        throw AKORT.Core.error('RAW_REVERSAL_TARGET_ID_INVALID', 'Reversal target observations must have unique IDs.', {
          targetLoadId: targetLoadId,
          observationId: observationId
        });
      }
      targetByObservation[observationId] = row;
      var key = businessKeyFromRaw_(targetTable, row);
      var later = (byKey[key] || []).filter(function (candidate) {
        return Number(candidate.version_no || 0) > Number(row.version_no || 0);
      });
      if (later.length) {
        throw AKORT.Core.error('REVERSAL_CONFLICT_LATER_VERSION', 'Logical reversal is blocked because a later revision exists.', {
          targetLoadId: targetLoadId,
          businessKey: key,
          laterObservationIds: later.map(function (candidate) { return candidate.observation_id; })
        });
      }
    });

    var completed = {};
    (existingRecords || []).forEach(function (record) {
      var observationId = String(record.reversed_observation_id || '');
      if (!targetByObservation[observationId]) {
        throw AKORT.Core.error('RAW_REVERSAL_LOG_TARGET_MISMATCH', 'A durable reversal record does not belong to the target load.', {
          targetLoadId: targetLoadId,
          reversedObservationId: observationId
        });
      }
      if (completed[observationId]) {
        throw AKORT.Core.error('RAW_REVERSAL_LOG_DUPLICATE', 'A target observation has more than one durable reversal record.', {
          targetLoadId: targetLoadId,
          reversedObservationId: observationId
        });
      }
      completed[observationId] = true;
    });

    var pending = (targetRows || []).filter(function (row) {
      return !completed[String(row.observation_id || '')];
    }).sort(function (a, b) { return Number(a.__row || 0) - Number(b.__row || 0); });
    var selected = pending.slice(0, Math.max(1, Number(chunkRows || 1)));
    var items = selected.map(function (targetRow) {
      var key = businessKeyFromRaw_(targetTable, targetRow);
      var history = byKey[key] || [];
      var restored = history.filter(function (row) {
        return Number(row.version_no || 0) < Number(targetRow.version_no || 0);
      }).sort(function (a, b) {
        return Number(b.version_no || 0) - Number(a.version_no || 0) || Number(b.__row || 0) - Number(a.__row || 0);
      })[0] || null;
      return { key: key, target: targetRow, restored: restored };
    });
    return {
      total: (targetRows || []).length,
      completed: Object.keys(completed).length,
      pending: pending.length,
      items: items
    };
  }

  function columnA1_(column) {
    var value = Number(column || 0);
    var text = '';
    while (value > 0) {
      value -= 1;
      text = String.fromCharCode(65 + value % 26) + text;
      value = Math.floor(value / 26);
    }
    return text;
  }

  function writeLatestFlags_(rawTable, items) {
    var index = headersIndex_(rawTable.headers);
    var column = columnA1_(index.is_latest + 1);
    var targetRanges = {};
    var restoredRanges = {};
    (items || []).forEach(function (item) {
      if (!item.target || !item.target.__row) throw AKORT.Core.error('RAW_REVERSAL_ROW_REFERENCE_MISSING', 'Target RAW row has no durable row reference.');
      targetRanges[column + Number(item.target.__row)] = true;
      if (item.restored) {
        if (!item.restored.__row) throw AKORT.Core.error('RAW_REVERSAL_ROW_REFERENCE_MISSING', 'Restored RAW row has no durable row reference.');
        restoredRanges[column + Number(item.restored.__row)] = true;
      }
    });
    var targets = Object.keys(targetRanges);
    var restored = Object.keys(restoredRanges);
    if (targets.length) rawTable.sheet.getRangeList(targets).setValue(0);
    if (restored.length) rawTable.sheet.getRangeList(restored).setValue(1);
    return { reversedFlags: targets.length, restoredFlags: restored.length };
  }

  function appendObjects_(table, objects) {
    if (!(objects || []).length) return [];
    var startRow = Math.max(2, table.sheet.getLastRow() + 1);
    var requiredLastRow = startRow + objects.length - 1;
    if (requiredLastRow > table.sheet.getMaxRows()) {
      table.sheet.insertRowsAfter(table.sheet.getMaxRows(), requiredLastRow - table.sheet.getMaxRows());
    }
    table.sheet.getRange(startRow, 1, objects.length, table.headers.length).setValues(objects.map(function (object) {
      return rowValues_(table.headers, object);
    }));
    objects.forEach(function (object, index) { object.__row = startRow + index; });
    return objects;
  }

  function compactReversalRecords_(records) {
    return (records || []).map(function (row) {
      return {
        operation_id: String(row.operation_id || ''),
        reversal_load_id: String(row.reversal_load_id || ''),
        target_load_id: String(row.target_load_id || ''),
        target_table: String(row.target_table || ''),
        business_key: String(row.business_key || ''),
        reversed_observation_id: String(row.reversed_observation_id || ''),
        restored_observation_id: String(row.restored_observation_id || ''),
        status: String(row.status || '')
      };
    });
  }

  function finalizeReversal_(targetFound, reversalLoadId, operationId, targetLoadId, targetTable, records) {
    var loads = readObjects_(targetFound.table);
    var existing = loads.filter(function (row) { return String(row.load_id) === String(reversalLoadId); })[0] || null;
    if (existing) {
      if (String(existing.operation_id) !== String(operationId || '') || String(existing.source_id) !== String(targetLoadId) ||
          String(existing.target_table) !== String(targetTable) || String(existing.status) !== LOAD_STATUSES.COMMITTED) {
        throw AKORT.Core.error('RAW_REVERSAL_REGISTRY_CONFLICT', 'Existing reversal load registry row does not match the durable reversal.', {
          reversalLoadId: reversalLoadId,
          operationId: operationId,
          targetLoadId: targetLoadId
        });
      }
    } else {
      var finishedAt = AKORT.Core.now();
      appendObject_(targetFound.table, {
        load_id: reversalLoadId,
        operation_id: String(operationId || ''),
        source_id: targetLoadId,
        source_name: 'Logical reversal of ' + targetLoadId,
        source_hash: AKORT.Core.sha256('REVERSAL|' + targetLoadId),
        target_table: targetTable,
        status: LOAD_STATUSES.COMMITTED,
        rows_received: records.length,
        rows_staged: 0,
        rows_inserted: 0,
        rows_revised: 0,
        rows_unchanged: 0,
        rows_reversed: records.length,
        started_at: finishedAt,
        finished_at: finishedAt,
        error_code: '',
        error_message: '',
        release_version: AKORT.Release.version
      });
    }
    var targetLoad = targetFound.load;
    targetLoad.status = LOAD_STATUSES.REVERSED;
    targetLoad.rows_reversed = records.length;
    targetLoad.finished_at = AKORT.Core.now();
    targetLoad.error_code = '';
    targetLoad.error_message = '';
    saveObject_(targetFound.table, targetLoad);
    return {
      targetLoadId: targetLoadId,
      reversalLoadId: reversalLoadId,
      reused: !!existing,
      reversedRows: records.length,
      records: compactReversalRecords_(records)
    };
  }

  /**
   * Execute one bounded, durable RAW reversal chunk.
   * RAW_REVERSAL_LOG is the exact-once cursor: a lost response is recovered by
   * re-reading successful observation IDs, never by restarting from row 1.
   */
  function reverseLoadStep(targetLoadId, operationId, reason, options) {
    options = options || {};
    var spreadsheet = getDwh_();
    var targetFound = findLoad_(spreadsheet, targetLoadId);
    var targetLoad = targetFound.load;
    var reversalLog = reversalTable_(spreadsheet);
    var existingRecords = reversalRecordsFor_(reversalLog, operationId, targetLoadId);
    var reversalLoadId = reversalLoadIdFor_(existingRecords, operationId, targetLoadId);
    var targetTable = String(targetLoad.target_table);

    if (String(targetLoad.status) === LOAD_STATUSES.REVERSED) {
      if (!existingRecords.length) {
        throw AKORT.Core.error('RAW_REVERSAL_DURABLE_LOG_MISSING', 'Reversed RAW load has no durable records for this operation.', {
          operationId: operationId,
          targetLoadId: targetLoadId
        });
      }
      return {
        complete: true,
        work: {
          schemaVersion: '4.0-raw-reversal-work-1',
          targetLoadId: targetLoadId,
          reversalLoadId: reversalLoadId,
          targetTable: targetTable,
          completedRows: existingRecords.length,
          totalRows: Number(targetLoad.rows_reversed || existingRecords.length),
          chunkRows: Math.max(1, Number(options.chunkRows || runtimeSettings_().reversalChunkRows))
        },
        reversal: {
          targetLoadId: targetLoadId,
          reversalLoadId: reversalLoadId,
          reused: true,
          reversedRows: existingRecords.length,
          records: compactReversalRecords_(existingRecords)
        }
      };
    }
    if ([LOAD_STATUSES.COMMITTED, LOAD_STATUSES.REVERSING].indexOf(String(targetLoad.status)) < 0) {
      throw AKORT.Core.error('RAW_LOAD_NOT_REVERSIBLE', 'Only a committed or durably reversing RAW load may be logically reversed.', {
        targetLoadId: targetLoadId,
        status: targetLoad.status
      });
    }

    var rawTable = table_(spreadsheet, targetTable, spec_(targetTable).headers);
    var allRows = rawRowObjects_(rawTable);
    var targetRows = allRows.filter(function (row) { return String(row.load_id) === String(targetLoadId); });
    if (!targetRows.length) throw AKORT.Core.error('REVERSAL_TARGET_EMPTY', 'Committed load has no RAW rows to reverse.', { targetLoadId: targetLoadId });
    var chunkRows = Math.max(1, Number(options.chunkRows || runtimeSettings_().reversalChunkRows));
    var plan = planReversalChunk_(targetTable, allRows, targetRows, existingRecords, chunkRows, targetLoadId);

    if (String(targetLoad.status) !== LOAD_STATUSES.REVERSING) {
      targetLoad.status = LOAD_STATUSES.REVERSING;
      targetLoad.finished_at = '';
      targetLoad.error_code = '';
      targetLoad.error_message = '';
      saveObject_(targetFound.table, targetLoad);
    }

    var newRecords = plan.items.map(function (item) {
      return {
        reversal_id: id_('REV'),
        operation_id: String(operationId || ''),
        reversal_load_id: reversalLoadId,
        target_load_id: targetLoadId,
        target_table: targetTable,
        business_key: item.key,
        reversed_observation_id: item.target.observation_id,
        restored_observation_id: item.restored ? item.restored.observation_id : '',
        reversed_at: AKORT.Core.now(),
        reason: String(reason || 'Logical reversal'),
        status: 'SUCCESS',
        release_version: AKORT.Release.version
      };
    });
    var flagWrites = writeLatestFlags_(rawTable, plan.items);
    appendObjects_(reversalLog, newRecords);
    var records = existingRecords.concat(newRecords);
    var complete = records.length === targetRows.length;
    var reversal = complete ? finalizeReversal_(targetFound, reversalLoadId, operationId, targetLoadId, targetTable, records) : null;
    return {
      complete: complete,
      work: {
        schemaVersion: '4.0-raw-reversal-work-1',
        targetLoadId: targetLoadId,
        reversalLoadId: reversalLoadId,
        targetTable: targetTable,
        completedRows: records.length,
        totalRows: targetRows.length,
        chunkRows: chunkRows,
        lastChunkRows: newRecords.length,
        reversedFlags: flagWrites.reversedFlags,
        restoredFlags: flagWrites.restoredFlags
      },
      reversal: reversal
    };
  }

  function reverseLoad(targetLoadId, operationId, reason, options) {
    return reverseLoadStep(targetLoadId, operationId, reason, options);
  }

  function inspectReversal(targetLoadId, operationId) {
    var spreadsheet = getDwh_();
    var targetFound = findLoad_(spreadsheet, targetLoadId);
    var targetLoad = targetFound.load;
    var targetTable = String(targetLoad.target_table);
    var rawTable = table_(spreadsheet, targetTable, spec_(targetTable).headers);
    var allRows = rawRowObjects_(rawTable);
    var targetRows = allRows.filter(function (row) { return String(row.load_id) === String(targetLoadId); });
    var records = reversalRecordsFor_(reversalTable_(spreadsheet), operationId, targetLoadId);
    var plan = planReversalChunk_(targetTable, allRows, targetRows, records, 1, targetLoadId);
    return {
      operationId: String(operationId || ''),
      targetLoadId: String(targetLoadId || ''),
      targetTable: targetTable,
      targetLoadStatus: String(targetLoad.status || ''),
      reversalLoadId: reversalLoadIdFor_(records, operationId, targetLoadId),
      totalRows: targetRows.length,
      completedRows: records.length,
      pendingRows: plan.pending,
      complete: records.length === targetRows.length
    };
  }

  /**
   * Rehydrate the complete reversal payload from its durable log. Operation
   * checkpoints keep only the compact identity and fingerprint; the 50,000
   * character Google Sheets cell limit must never make RAW_REVERSAL_LOG data
   * part of the resumable checkpoint itself.
   */
  function reversalSnapshot(targetLoadId, operationId) {
    var inspection = inspectReversal(targetLoadId, operationId);
    if (inspection.complete !== true || inspection.completedRows !== inspection.totalRows) {
      throw AKORT.Core.error('RAW_REVERSAL_SNAPSHOT_INCOMPLETE', 'Durable reversal snapshot is incomplete.', {
        retryable: false,
        operationId: String(operationId || ''),
        targetLoadId: String(targetLoadId || ''),
        completedRows: inspection.completedRows,
        totalRows: inspection.totalRows
      });
    }
    var spreadsheet = getDwh_();
    var records = reversalRecordsFor_(reversalTable_(spreadsheet), operationId, targetLoadId);
    return {
      targetLoadId: String(targetLoadId || ''),
      reversalLoadId: inspection.reversalLoadId,
      reused: true,
      reversedRows: records.length,
      records: compactReversalRecords_(records)
    };
  }

  function storeNormalized(source, rows, options) {
    options = options || {};
    var begin = beginLoad({
      targetTable: source.targetTable,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourceHash: source.sourceHash,
      rowCount: (rows || []).length
    }, options);
    if (begin.reused && String(begin.status) === LOAD_STATUSES.COMMITTED) {
      return { begin: begin, stage: null, commit: commitLoad(begin.loadId), audit: auditLoad(begin.loadId) };
    }
    var stage = stageRows(begin.loadId, rows || []);
    var commit = commitLoad(begin.loadId);
    return { begin: begin, stage: stage, commit: commit, audit: auditLoad(begin.loadId) };
  }

  function statusSummary() {
    var spreadsheet = getDwh_();
    var loads = readObjects_(loadTable_(spreadsheet));
    var counts = {};
    Object.keys(LOAD_STATUSES).forEach(function (key) { counts[LOAD_STATUSES[key]] = 0; });
    loads.forEach(function (row) {
      var statusValue = String(row.status || 'UNKNOWN');
      counts[statusValue] = Number(counts[statusValue] || 0) + 1;
    });
    var tables = {};
    Object.keys(TABLES).forEach(function (name) {
      var sheet = spreadsheet.getSheetByName(name);
      tables[name] = sheet ? { rows: Math.max(0, sheet.getLastRow() - 1), columns: sheet.getLastColumn() } : null;
    });
    return {
      release: AKORT.Release.manifest(),
      manifestHash: AKORT.Core.manifestHash(),
      rawSchemaVersion: AKORT.Release.rawSchemaVersion,
      runtimeSettings: runtimeSettings_(),
      rawTargets: Object.keys(SPECS),
      serviceTables: tables,
      loadCount: loads.length,
      loadStatusCounts: counts
    };
  }

  function cleanupTestArtifacts(prefix) {
    prefix = String(prefix || 'ALPHA4_TEST_');
    var spreadsheet = getDwh_();
    var loadsTable = loadTable_(spreadsheet);
    var loads = readObjects_(loadsTable);
    var loadIds = {};
    var operationIds = {};
    var loadRows = [];
    loads.forEach(function (row) {
      if (String(row.source_id || '').indexOf(prefix) === 0 || String(row.source_name || '').indexOf(prefix) === 0) {
        loadIds[String(row.load_id)] = true;
        if (row.operation_id) operationIds[String(row.operation_id)] = true;
        loadRows.push(row.__row);
      }
    });
    var reversal = reversalTable_(spreadsheet);
    var reversalRows = readObjects_(reversal).filter(function (row) {
      return loadIds[String(row.target_load_id)] || loadIds[String(row.reversal_load_id)];
    });
    reversalRows.forEach(function (row) { loadIds[String(row.reversal_load_id)] = true; });
    // Include generated reversal-load registry rows discovered through RAW_REVERSAL_LOG.
    var selectedLoads = loads.filter(function (row) { return loadIds[String(row.load_id)]; });
    selectedLoads.forEach(function (row) {
      if (row.operation_id) operationIds[String(row.operation_id)] = true;
    });
    loadRows = selectedLoads.map(function (row) { return row.__row; });
    var stage = stageTable_(spreadsheet);
    var stageRows = readObjects_(stage).filter(function (row) { return loadIds[String(row.load_id)]; }).map(function (row) { return row.__row; });
    var rawDeleted = {};
    Object.keys(SPECS).forEach(function (target) {
      var raw = table_(spreadsheet, target, SPECS[target].headers);
      var rows = rawRowObjects_(raw).filter(function (row) { return loadIds[String(row.load_id)]; });
      rawDeleted[target] = deleteRows_(raw.sheet, rows.map(function (row) { return row.__row; }));
    });
    var deleted = {
      rawRows: rawDeleted,
      stageRows: deleteRows_(stage.sheet, stageRows),
      reversalRows: deleteRows_(reversal.sheet, reversalRows.map(function (row) { return row.__row; })),
      loadRows: deleteRows_(loadsTable.sheet, loadRows)
    };
    // Operation rows are removed only when they were linked to test loads.
    var queue = spreadsheet.getSheetByName('OPERATION_QUEUE');
    var steps = spreadsheet.getSheetByName('OPERATION_STEPS');
    if (queue && steps && Object.keys(operationIds).length) {
      var queueRows = AKORT.Core.Sheets.readObjects(queue).filter(function (row) { return operationIds[String(row.operation_id)]; });
      var stepRows = AKORT.Core.Sheets.readObjects(steps).filter(function (row) { return operationIds[String(row.operation_id)]; });
      deleted.operationSteps = deleteRows_(steps, stepRows.map(function (row) { return row.__row; }));
      deleted.operations = deleteRows_(queue, queueRows.map(function (row) { return row.__row; }));
    } else {
      deleted.operationSteps = 0;
      deleted.operations = 0;
    }
    return deleted;
  }

  return {
    Tables: clone_(TABLES),
    Specs: clone_(SPECS),
    LoadStatuses: clone_(LOAD_STATUSES),
    install: install,
    runtimeSettings: runtimeSettings_,
    normalizeRow: normalizeRow_,
    businessKey: businessKey_,
    contentHash: contentHash_,
    prepareRows: prepareRows,
    beginLoad: beginLoad,
    stageRows: stageRows,
    commitLoad: commitLoad,
    storeNormalized: storeNormalized,
    reverseLoad: reverseLoad,
    reverseLoadStep: reverseLoadStep,
    inspectReversal: inspectReversal,
    reversalSnapshot: reversalSnapshot,
    auditLoad: auditLoad,
    status: status,
    statusSummary: statusSummary,
    Test: {
      cleanup: cleanupTestArtifacts,
      getDwh: getDwh_,
      findLoad: function (loadId) { return findLoad_(getDwh_(), loadId).load; },
      planReversalChunk: planReversalChunk_,
      reversalLoadId: reversalLoadIdFor_
    }
  };
})();

/** Operation Engine adapter for normalized RAW loads and logical reversals. */
AKORT.RawStoreHandlers = (function () {
  var LOAD_TYPE = 'RAW_LOAD_V4';
  var REVERSAL_TYPE = 'RAW_REVERSAL_V4';

  function supports(operationType) {
    return [LOAD_TYPE, REVERSAL_TYPE].indexOf(String(operationType || '')) >= 0;
  }

  function sourceHash_(input) {
    if (input.sourceHash) return String(input.sourceHash);
    return AKORT.Core.sha256(AKORT.Core.canonicalJson({
      targetTable: input.targetTable,
      sourceId: input.sourceId || '',
      rows: input.rows || []
    }));
  }

  function compactReversal_(reversal) {
    var value = reversal || {};
    var records = value.records || value.reversalLog || [];
    return {
      targetLoadId: String(value.targetLoadId || ''),
      reversalLoadId: String(value.reversalLoadId || ''),
      reused: value.reused === true,
      reversedRows: Number(value.reversedRows || records.length || 0),
      recordCount: records.length,
      recordsFingerprint: AKORT.Core.sha256(AKORT.Core.canonicalJson(records)),
      durableRecordSource: 'RAW_REVERSAL_LOG'
    };
  }

  function durableReversal_(state, operationId, targetLoadId) {
    var compact = state.reversal || {};
    if (Array.isArray(compact.records)) return compact;
    var snapshot = AKORT.RawStore.reversalSnapshot(
      String(compact.targetLoadId || targetLoadId || ''),
      String(operationId || '')
    );
    var fingerprint = AKORT.Core.sha256(AKORT.Core.canonicalJson(snapshot.records || []));
    if ((compact.reversalLoadId && String(compact.reversalLoadId) !== String(snapshot.reversalLoadId)) ||
        Number(compact.recordCount || compact.reversedRows || 0) !== Number((snapshot.records || []).length) ||
        (compact.recordsFingerprint && String(compact.recordsFingerprint) !== fingerprint)) {
      throw AKORT.Core.error('RAW_REVERSAL_CHECKPOINT_DURABLE_MISMATCH', 'Compact reversal checkpoint differs from RAW_REVERSAL_LOG.', {
        retryable: false,
        operationId: String(operationId || ''),
        targetLoadId: String(targetLoadId || ''),
        checkpointReversalLoadId: String(compact.reversalLoadId || ''),
        durableReversalLoadId: String(snapshot.reversalLoadId || ''),
        checkpointRecordCount: Number(compact.recordCount || compact.reversedRows || 0),
        durableRecordCount: Number((snapshot.records || []).length)
      });
    }
    return snapshot;
  }

  function storePublishPlanSummary_(state, plan) {
    state.publishPlanSummary = AKORT.IncrementalPublish.summarizePlan(plan);
    if (Object.prototype.hasOwnProperty.call(state, 'publishPlan')) delete state.publishPlan;
    return state.publishPlanSummary;
  }

  function storedPublishPlanSummary_(state, planFactory) {
    if (state.publishPlanSummary) {
      if (Object.prototype.hasOwnProperty.call(state, 'publishPlan')) delete state.publishPlan;
      return state.publishPlanSummary;
    }
    if (state.publishPlan) return storePublishPlanSummary_(state, state.publishPlan);
    return storePublishPlanSummary_(state, planFactory());
  }

  function executeLoad_(phase, context) {
    var checkpoint = context.checkpoint;
    var input = checkpoint.input || {};
    checkpoint.rawStore = checkpoint.rawStore || {};
    var state = checkpoint.rawStore;
    if (phase === 'DISCOVER') {
      if (!input.targetTable || !Array.isArray(input.rows)) {
        throw AKORT.Core.error('RAW_OPERATION_INPUT_INVALID', 'RAW_LOAD_V4 requires targetTable and normalized rows.', { retryable: false });
      }
      state.sourceHash = sourceHash_(input);
      return { discovered: true, targetTable: input.targetTable, sourceHash: state.sourceHash, rowCount: input.rows.length };
    }
    if (phase === 'VALIDATE') {
      var prepared = AKORT.RawStore.prepareRows(input.targetTable, input.rows);
      state.preparedCount = prepared.length;
      return { validated: true, preparedRows: prepared.length };
    }
    if (phase === 'PARSE') {
      return { parser: 'PRENORMALIZED_ALPHA4', parsedRows: input.rows.length, sourceSpecificParsing: false };
    }
    if (phase === 'STAGE') {
      var begin = AKORT.RawStore.beginLoad({
        targetTable: input.targetTable,
        sourceId: input.sourceId || '',
        sourceName: input.sourceName || '',
        sourceHash: state.sourceHash,
        rowCount: input.rows.length
      }, { operationId: context.operation.operation_id });
      state.loadId = begin.loadId;
      state.loadReused = begin.reused;
      var stage = begin.reused && String(begin.status) === 'COMMITTED' ? null : AKORT.RawStore.stageRows(begin.loadId, input.rows);
      return { begin: begin, stage: stage };
    }
    if (phase === 'COMMIT_RAW') {
      if (!state.loadId) throw AKORT.Core.error('RAW_LOAD_ID_MISSING', 'STAGE did not persist a load_id.');
      state.commit = AKORT.RawStore.commitLoad(state.loadId);
      return state.commit;
    }
    if (phase === 'UPDATE_PUBLISH') {
      var publishPlan = AKORT.IncrementalPublish.planLoad(state.loadId);
      storePublishPlanSummary_(state, publishPlan);
      if (publishPlan.testOnly) {
        state.publishUpdate = { skipped: true, reason: 'Compatibility smoke-test isolation', marker: publishPlan.testMarker };
        return state.publishUpdate;
      }
      AKORT.IncrementalPublish.appendImpact(context.operation.operation_id, state.loadId, publishPlan);
      var publishStep = AKORT.IncrementalPublish.applyPublishStep(publishPlan, context.operation.operation_id, state.publishWork);
      state.publishWork = publishStep.work;
      if (publishStep.repeatPhase === true) return publishStep;
      state.publishUpdate = publishStep;
      delete state.publishWork;
      return state.publishUpdate;
    }
    if (AKORT.AggregateIntegration.Phases.indexOf(phase) >= 0 || phase === 'FINALIZING') {
      var publishPlanSummary = storedPublishPlanSummary_(state, function () { return AKORT.IncrementalPublish.planLoad(state.loadId); });
      state.aggregateUpdate = AKORT.AggregateIntegration.execute(phase, context, {
        loadId: state.loadId,
        mode: 'REVISION',
        testOnly: publishPlanSummary.testOnly === true
      });
      return state.aggregateUpdate;
    }
    if (phase === 'UPDATE_STATUS') return { loadId: state.loadId, loadStatus: AKORT.RawStore.status(state.loadId).load.status };
    if (phase === 'QUICK_AUDIT') {
      state.audit = AKORT.RawStore.auditLoad(state.loadId);
      if (!state.audit.ok) throw AKORT.Core.error('RAW_QUICK_AUDIT_FAILED', 'RAW load quick audit failed.', { retryable: false, audit: state.audit });
      return state.audit;
    }
    throw AKORT.Core.error('RAW_HANDLER_PHASE_UNSUPPORTED', 'RAW_LOAD_V4 does not support this phase.', { phase: phase });
  }

  function executeReversal_(phase, context) {
    var checkpoint = context.checkpoint;
    var input = checkpoint.input || {};
    checkpoint.rawStore = checkpoint.rawStore || {};
    var state = checkpoint.rawStore;
    if (phase === 'DISCOVER') {
      if (!input.targetLoadId) throw AKORT.Core.error('REVERSAL_LOAD_ID_REQUIRED', 'RAW_REVERSAL_V4 requires targetLoadId.');
      return { discovered: true, targetLoadId: input.targetLoadId };
    }
    if (phase === 'VALIDATE') return { validated: true, targetLoadId: input.targetLoadId };
    if (phase === 'PARSE') return { skipped: true, reason: 'Logical reversal does not parse source rows' };
    if (phase === 'STAGE') return { staged: true, logicalOnly: true };
    if (phase === 'COMMIT_RAW') {
      var reversalStep = AKORT.RawStore.reverseLoadStep(
        input.targetLoadId,
        context.operation.operation_id,
        input.reason || 'Operation Engine logical reversal'
      );
      state.reversalWork = reversalStep.work;
      if (!reversalStep.complete) {
        return {
          repeatPhase: true,
          bounded: true,
          work: reversalStep.work
        };
      }
      state.reversal = compactReversal_(reversalStep.reversal);
      state.loadId = state.reversal.reversalLoadId || '';
      delete state.reversalWork;
      return state.reversal;
    }
    if (phase === 'UPDATE_PUBLISH') {
      var durableReversal = durableReversal_(state, context.operation.operation_id, input.targetLoadId);
      var reversalPublishPlan = AKORT.IncrementalPublish.planReversal(durableReversal);
      storePublishPlanSummary_(state, reversalPublishPlan);
      if (reversalPublishPlan.testOnly) {
        state.publishUpdate = { skipped: true, reason: 'Compatibility smoke-test isolation', marker: reversalPublishPlan.testMarker };
        return state.publishUpdate;
      }
      AKORT.IncrementalPublish.appendImpact(context.operation.operation_id, state.loadId, reversalPublishPlan);
      var reversalPublishStep = AKORT.IncrementalPublish.applyPublishStep(reversalPublishPlan, context.operation.operation_id, state.publishWork);
      state.publishWork = reversalPublishStep.work;
      if (reversalPublishStep.repeatPhase === true) return reversalPublishStep;
      state.publishUpdate = reversalPublishStep;
      delete state.publishWork;
      return state.publishUpdate;
    }
    if (AKORT.AggregateIntegration.Phases.indexOf(phase) >= 0 || phase === 'FINALIZING') {
      var reversalPlanSummary = storedPublishPlanSummary_(state, function () {
        return AKORT.IncrementalPublish.planReversal(durableReversal_(state, context.operation.operation_id, input.targetLoadId));
      });
      state.aggregateUpdate = AKORT.AggregateIntegration.execute(phase, context, {
        loadId: state.loadId,
        mode: 'REVERSAL',
        reversal: state.reversal,
        testOnly: reversalPlanSummary.testOnly === true
      });
      return state.aggregateUpdate;
    }
    if (phase === 'UPDATE_STATUS') return { reversed: true, targetLoadId: input.targetLoadId };
    if (phase === 'QUICK_AUDIT') return { ok: true, logicalReversal: true, result: state.reversal };
    throw AKORT.Core.error('RAW_HANDLER_PHASE_UNSUPPORTED', 'RAW_REVERSAL_V4 does not support this phase.', { phase: phase });
  }

  function execute(phase, context) {
    var type = String(context.operation.operation_type || '');
    if (type === LOAD_TYPE) return executeLoad_(phase, context);
    if (type === REVERSAL_TYPE) return executeReversal_(phase, context);
    throw AKORT.Core.error('RAW_HANDLER_TYPE_UNSUPPORTED', 'Unsupported Raw Store operation type.', { operationType: type });
  }

  return {
    LoadOperationType: LOAD_TYPE,
    ReversalOperationType: REVERSAL_TYPE,
    supports: supports,
    execute: execute
  };
})();
