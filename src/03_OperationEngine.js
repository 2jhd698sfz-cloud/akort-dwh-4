var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

AKORT.OperationEngine = (function () {
  var PHASES = [
    'DISCOVER',
    'VALIDATE',
    'PARSE',
    'STAGE',
    'COMMIT_RAW',
    'UPDATE_PUBLISH',
    'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS',
    'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS',
    'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST',
    'RECONCILING_AGGREGATES',
    'UPDATE_STATUS',
    'QUICK_AUDIT',
    'FINALIZING',
    'SUCCESS'
  ];

  var EXECUTABLE_PHASES = PHASES.slice(0, PHASES.length - 1);

  var NEXT_PHASE = {
    DISCOVER: 'VALIDATE',
    VALIDATE: 'PARSE',
    PARSE: 'STAGE',
    STAGE: 'COMMIT_RAW',
    COMMIT_RAW: 'UPDATE_PUBLISH',
    UPDATE_PUBLISH: 'PREPARING_AGGREGATE_IMPACT',
    PREPARING_AGGREGATE_IMPACT: 'MATERIALIZING_AGGREGATE_INPUTS',
    MATERIALIZING_AGGREGATE_INPUTS: 'CALCULATING_AGGREGATE_SLICES',
    CALCULATING_AGGREGATE_SLICES: 'STAGING_AGGREGATE_ROWS',
    STAGING_AGGREGATE_ROWS: 'UPDATING_AGGREGATES',
    UPDATING_AGGREGATES: 'UPDATING_AGGREGATE_LATEST',
    UPDATING_AGGREGATE_LATEST: 'RECONCILING_AGGREGATES',
    RECONCILING_AGGREGATES: 'UPDATE_STATUS',
    UPDATE_STATUS: 'QUICK_AUDIT',
    QUICK_AUDIT: 'FINALIZING',
    FINALIZING: 'SUCCESS'
  };

  var STATUSES = {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    RETRY_PENDING: 'RETRY_PENDING',
    FAILED: 'FAILED',
    FAILED_REQUIRES_REVIEW: 'FAILED_REQUIRES_REVIEW',
    DEAD_LETTER: 'DEAD_LETTER',
    CANCELLED: 'CANCELLED',
    SUCCESS: 'SUCCESS'
  };

  var TERMINAL_STATUSES = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  var SHEETS_CELL_MAX_CHARS = 50000;
  var CHECKPOINT_CELL_SAFE_CHARS = 48000;

  var SETTINGS = {
    OPERATION_SCHEMA_VERSION: {
      value: '4.0-operation-2',
      type: 'STRING',
      description: 'Operation Engine checkpoint and state-machine contract version'
    },
    OPERATION_EXECUTION_BUDGET_MS: {
      value: 180000,
      type: 'NUMBER',
      description: 'Maximum execution budget used by one Operation Engine invocation'
    },
    OPERATION_MAX_STEPS_PER_RUN: {
      value: 3,
      type: 'NUMBER',
      description: 'Default maximum number of completed phases per invocation'
    },
    OPERATION_MIN_REMAINING_MS: {
      value: 15000,
      type: 'NUMBER',
      description: 'Safety reserve before the Apps Script execution limit'
    },
    OPERATION_LEASE_MS: {
      value: 120000,
      type: 'NUMBER',
      description: 'Operation execution lease duration used to prevent double execution'
    },
    OPERATION_TEST_MODE: {
      value: true,
      type: 'BOOLEAN',
      description: 'Only test handlers are enabled in alpha.3'
    }
  };

  var DEMO_PROPERTY = 'AKORT_ALPHA3_DEMO_OPERATION_ID';

  function clone_(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseJson_(value, fallback) {
    if (value === '' || value === null || value === undefined) return clone_(fallback || {});
    if (typeof value === 'object') return clone_(value);
    try { return JSON.parse(String(value)); }
    catch (caught) {
      throw AKORT.Core.error('INVALID_CHECKPOINT_JSON', 'Operation checkpoint is not valid JSON.', {
        value: String(value),
        cause: String(caught)
      });
    }
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (e) { return 'unknown'; }
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function table_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw AKORT.Core.error('SERVICE_TABLE_MISSING', 'Missing service table ' + name + '. Run AKORT_alpha4Install first.');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var expected = AKORT.Core.Tables[name];
    if (!expected || JSON.stringify(headers) !== JSON.stringify(expected)) {
      throw AKORT.Core.error('SERVICE_SCHEMA_MISMATCH', 'Unexpected schema for service table ' + name, {
        expected: expected || null,
        actual: headers
      });
    }
    return { sheet: sheet, headers: headers };
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

  function saveObject_(table, object) {
    if (!object.__row) throw AKORT.Core.error('ROW_REFERENCE_MISSING', 'Cannot update a service-table object without __row.');
    table.sheet.getRange(object.__row, 1, 1, table.headers.length).setValues([rowValues_(table.headers, object)]);
    return object;
  }

  function appendObject_(table, object) {
    AKORT.Core.Sheets.appendObject(table.sheet, table.headers, object);
    object.__row = table.sheet.getLastRow();
    return object;
  }

  function findOperation_(spreadsheet, operationId) {
    var queue = table_(spreadsheet, 'OPERATION_QUEUE');
    var rows = readObjects_(queue);
    var match = rows.filter(function (row) { return String(row.operation_id) === String(operationId); })[0];
    if (!match) throw AKORT.Core.error('OPERATION_NOT_FOUND', 'Operation was not found.', { operationId: operationId });
    return { table: queue, operation: match };
  }

  function readSteps_(spreadsheet, operationId) {
    var steps = table_(spreadsheet, 'OPERATION_STEPS');
    return readObjects_(steps).filter(function (row) {
      return String(row.operation_id) === String(operationId);
    });
  }

  function checkpointFor_(operation) {
    var checkpoint = parseJson_(operation.checkpoint_json, {});
    checkpoint.schemaVersion = checkpoint.schemaVersion || AKORT.Release.operationSchemaVersion;
    checkpoint.nextPhase = checkpoint.nextPhase || operation.current_phase || 'DISCOVER';
    checkpoint.completedPhases = checkpoint.completedPhases || [];
    checkpoint.handlerState = checkpoint.handlerState || { calls: {} };
    checkpoint.handlerState.calls = checkpoint.handlerState.calls || {};
    checkpoint.input = checkpoint.input || {};
    checkpoint.control = checkpoint.control || { stopRequested: false };
    if (checkpoint.control.stopRequested === undefined) checkpoint.control.stopRequested = false;
    checkpoint.meta = checkpoint.meta || {};
    checkpoint.lease = checkpoint.lease || null;
    checkpoint.aggregate = checkpoint.aggregate || {
      schemaVersion: '4.0-aggregate-stage-1',
      status: 'NOT_STARTED',
      calculationCursor: 0,
      stagingCursor: 0,
      batchNo: 0
    };
    return checkpoint;
  }

  function checkpointCellJson_(checkpoint) {
    var serialized = AKORT.Core.safeJson(checkpoint);
    if (serialized.length > CHECKPOINT_CELL_SAFE_CHARS) {
      throw AKORT.Core.error('OPERATION_CHECKPOINT_CELL_LIMIT_EXCEEDED', 'Operation checkpoint exceeds the safe Google Sheets cell boundary.', {
        retryable: false,
        nextPhase: checkpoint && checkpoint.nextPhase || '',
        characters: serialized.length,
        safeMaximum: CHECKPOINT_CELL_SAFE_CHARS,
        physicalMaximum: SHEETS_CELL_MAX_CHARS,
        sha256: AKORT.Core.sha256(serialized)
      });
    }
    return serialized;
  }

  function checkpointAuditSummary_(checkpoint) {
    var value = checkpoint || {};
    var aggregate = value.aggregate || {};
    var raw = value.rawStore || {};
    var handler = value.handlerState || {};
    function durableProgress_(state) {
      state = state || {};
      var reversal = state.reversal || {};
      var reversalWork = state.reversalWork || {};
      var publishWork = state.publishWork || {};
      return {
        loadId: state.loadId || '',
        reversal: {
          targetLoadId: reversal.targetLoadId || '',
          reversalLoadId: reversal.reversalLoadId || '',
          reversedRows: Number(reversal.reversedRows || reversal.recordCount || 0),
          recordsFingerprint: reversal.recordsFingerprint || ''
        },
        reversalWork: {
          completedRows: Number(reversalWork.completedRows || 0),
          totalRows: Number(reversalWork.totalRows || 0)
        },
        publishWork: {
          stage: publishWork.stage || '',
          cursor: Number(publishWork.cursor || 0),
          weeklyRows: Number(publishWork.weeklyRows || 0),
          monthlyRows: Number(publishWork.monthlyRows || 0),
          industryRows: Number(publishWork.industryRows || 0),
          complete: publishWork.complete === true
        }
      };
    }
    return {
      schemaVersion: value.schemaVersion || '',
      nextPhase: value.nextPhase || '',
      completedPhases: (value.completedPhases || []).slice(),
      control: clone_(value.control || {}),
      meta: clone_(value.meta || {}),
      lease: clone_(value.lease || null),
      aggregate: {
        status: aggregate.status || '',
        loadId: aggregate.loadId || '',
        planId: aggregate.planId || '',
        planFingerprint: aggregate.planFingerprint || '',
        calculationCursor: Number(aggregate.calculationCursor || 0),
        calculationGroupCount: Number(aggregate.calculationGroupCount || 0),
        stagingCursor: Number(aggregate.stagingCursor || 0),
        stageStatusCursor: Number(aggregate.stageStatusCursor || 0),
        expectedStageRows: Number(aggregate.expectedStageRows || 0),
        stageFingerprint: aggregate.stageFingerprint || '',
        publishSeriesCursor: Number(aggregate.publishSeriesCursor || 0),
        latestSeriesCursor: Number(aggregate.latestSeriesCursor || 0),
        reconciliationBatchCursor: Number(aggregate.reconciliationBatchCursor || 0),
        affectedSeriesCount: (aggregate.affectedSeriesKeys || []).length
      },
      rawStore: durableProgress_(raw),
      handlerState: durableProgress_(handler)
    };
  }

  function auditCellJson_(value, checkpoint) {
    var serialized = AKORT.Core.safeJson(value);
    if (serialized.length <= CHECKPOINT_CELL_SAFE_CHARS) return serialized;
    var compact = checkpoint ? checkpointAuditSummary_(value) : {
      type: 'OVERSIZED_RESULT',
      preview: serialized.slice(0, 2000)
    };
    return AKORT.Core.safeJson({
      schemaVersion: '4.0-operation-cell-summary-1',
      compacted: true,
      originalCharacters: serialized.length,
      originalSha256: AKORT.Core.sha256(serialized),
      value: compact
    });
  }

  function saveCheckpoint_(operation, checkpoint) {
    operation.checkpoint_json = checkpointCellJson_(checkpoint);
    operation.current_phase = checkpoint.nextPhase || operation.current_phase;
    return operation;
  }

  function runtimeSettings_() {
    var config = AKORT.Config.load();
    var settings = AKORT.Config.readSystemSettings();
    var system = config.system || {};
    return {
      executionBudgetMs: Number(settings.OPERATION_EXECUTION_BUDGET_MS || system.operationExecutionBudgetMs || 180000),
      maxStepsPerRun: Number(settings.OPERATION_MAX_STEPS_PER_RUN || system.operationMaxStepsPerRun || 3),
      minRemainingMs: Number(settings.OPERATION_MIN_REMAINING_MS || system.operationMinRemainingMs || 15000),
      leaseMs: Number(settings.OPERATION_LEASE_MS || system.operationLeaseMs || 120000),
      maxAttempts: Number(settings.MAX_OPERATION_ATTEMPTS || system.maxOperationAttempts || 3),
      lockTimeoutMs: Number(settings.LOCK_TIMEOUT_MS || system.lockTimeoutMs || 30000),
      testMode: settings.OPERATION_TEST_MODE === undefined ? true : Boolean(settings.OPERATION_TEST_MODE)
    };
  }

  function headersIndex_(headers) {
    var index = {};
    headers.forEach(function (header, i) { index[header] = i; });
    return index;
  }

  function assertSchemaMigrationReady_(spreadsheet) {
    var settingsTable = table_(spreadsheet, 'SYSTEM_SETTINGS');
    var settings = readObjects_(settingsTable);
    var installed = settings.filter(function (row) {
      return String(row.setting_key) === 'OPERATION_SCHEMA_VERSION' &&
        (String(row.is_active) === '1' || row.is_active === true);
    })[0];
    if (installed && String(installed.setting_value || '') === String(SETTINGS.OPERATION_SCHEMA_VERSION.value)) {
      return { checked: true, fromVersion: String(installed.setting_value || ''), activeOperations: [] };
    }

    var queue = table_(spreadsheet, 'OPERATION_QUEUE');
    var active = readObjects_(queue).filter(function (row) {
      return !TERMINAL_STATUSES[String(row.status || '')];
    }).map(function (row) {
      return {
        operationId: String(row.operation_id || ''),
        status: String(row.status || ''),
        phase: String(row.current_phase || '')
      };
    });
    if (active.length > 0) {
      throw AKORT.Core.error(
        'OPERATION_SCHEMA_MIGRATION_BLOCKED',
        'Operation schema cannot be upgraded while non-terminal operations exist.',
        {
          retryable: false,
          fromVersion: installed ? String(installed.setting_value || '') : '',
          toVersion: SETTINGS.OPERATION_SCHEMA_VERSION.value,
          activeOperations: active
        }
      );
    }
    return {
      checked: true,
      fromVersion: installed ? String(installed.setting_value || '') : '',
      toVersion: SETTINGS.OPERATION_SCHEMA_VERSION.value,
      activeOperations: []
    };
  }

  function upsertSettings_() {
    var spreadsheet = getDwh_();
    var migration = assertSchemaMigrationReady_(spreadsheet);
    var settingsTable = table_(spreadsheet, 'SYSTEM_SETTINGS');
    var rows = readObjects_(settingsTable);
    var byKey = {};
    rows.forEach(function (row) { byKey[String(row.setting_key)] = row; });
    var actions = [];

    Object.keys(SETTINGS).forEach(function (key) {
      var definition = SETTINGS[key];
      var existing = byKey[key];
      if (!existing) {
        appendObject_(settingsTable, {
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
        String(existing.is_active) !== '1' && existing.is_active !== true;

      if (mustUpdate) {
        existing.setting_value = definition.value;
        existing.value_type = definition.type;
        existing.environment = 'DEV';
        existing.is_secret = 0;
        existing.is_active = 1;
        existing.description = definition.description;
        existing.updated_at = AKORT.Core.now();
        existing.updated_by = currentUser_();
        saveObject_(settingsTable, existing);
        actions.push({ setting: key, action: 'UPDATED' });
      } else {
        actions.push({ setting: key, action: 'UNCHANGED' });
      }
    });

    return { migration: migration, actions: actions };
  }

  function install() {
    var preflight = AKORT.Core.safeRun('OPERATION_SCHEMA_MIGRATION_PREFLIGHT', function () {
      AKORT.EnvironmentGuard.assertDev();
      return AKORT.Result.success(
        'Operation schema migration preflight passed.',
        assertSchemaMigrationReady_(getDwh_())
      );
    }, { lock: true, persistLogs: true });
    if (!preflight.ok) return preflight;

    var coreResult = AKORT.Core.install();
    if (!coreResult.ok) return coreResult;

    return AKORT.Core.safeRun('OPERATION_ENGINE_INSTALL', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var installation = upsertSettings_();
      var settings = runtimeSettings_();
      context.logger.info('Operation Engine installed', {
        operationSchemaVersion: AKORT.Release.operationSchemaVersion,
        settings: settings,
        settingActions: installation.actions,
        migration: installation.migration
      }, { eventCode: 'OPERATION_ENGINE_INSTALLED' });

      return AKORT.Result.success('Operation Engine installed successfully.', {
        release: AKORT.Release.manifest(),
        manifestHash: AKORT.Core.manifestHash(),
        coreRegistration: coreResult.data ? coreResult.data.registration : null,
        operationSchemaVersion: AKORT.Release.operationSchemaVersion,
        phases: PHASES.slice(),
        settingActions: installation.actions,
        migration: installation.migration,
        migrationPreflight: preflight.data,
        runtimeSettings: settings
      });
    }, { lock: true, persistLogs: true });
  }

  function findByIdempotencyKey_(spreadsheet, operationType, idempotencyKey) {
    if (!idempotencyKey) return null;
    var queue = table_(spreadsheet, 'OPERATION_QUEUE');
    var rows = readObjects_(queue);
    for (var i = 0; i < rows.length; i += 1) {
      if (String(rows[i].operation_type) !== String(operationType)) continue;
      var checkpoint = parseJson_(rows[i].checkpoint_json, {});
      if (checkpoint.meta && String(checkpoint.meta.idempotencyKey || '') === String(idempotencyKey)) return rows[i];
    }
    return null;
  }

  function enqueue(operationType, input, options) {
    options = options || {};
    return AKORT.Core.safeRun('OPERATION_ENQUEUE', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var runtime = runtimeSettings_();
      var type = String(operationType || '');
      var isTestType = type.indexOf('ALPHA3_TEST_') === 0 || type.indexOf('ALPHA3_DEMO_') === 0;
      if (isTestType && !runtime.testMode) {
        throw AKORT.Core.error('TEST_MODE_DISABLED', 'Test handlers require OPERATION_TEST_MODE=true.');
      }
      handler_(type); // Validate that the operation type has a registered handler before enqueue.
      var spreadsheet = getDwh_();
      var queue = table_(spreadsheet, 'OPERATION_QUEUE');
      var existing = findByIdempotencyKey_(spreadsheet, operationType, options.idempotencyKey);
      if (existing) {
        context.logger.info('Existing idempotent operation returned', {
          operationId: existing.operation_id,
          idempotencyKey: options.idempotencyKey
        }, { operationId: existing.operation_id, eventCode: 'OPERATION_REUSED' });
        return AKORT.Result.success('Existing operation returned for the idempotency key.', {
          operationId: existing.operation_id,
          reused: true,
          operation: publicOperation_(existing)
        });
      }

      var operationId = AKORT.Core.Id.operation(operationType);
      var checkpoint = {
        schemaVersion: AKORT.Release.operationSchemaVersion,
        nextPhase: 'DISCOVER',
        completedPhases: [],
        handlerState: { calls: {} },
        input: clone_(input || {}),
        control: { stopRequested: false },
        meta: {
          idempotencyKey: options.idempotencyKey || '',
          createdAt: AKORT.Core.now()
        },
        lease: null,
        aggregate: {
          schemaVersion: '4.0-aggregate-stage-1',
          status: 'NOT_STARTED',
          calculationCursor: 0,
          stagingCursor: 0,
          batchNo: 0
        }
      };
      var operation = {
        operation_id: operationId,
        operation_type: String(operationType || 'TEST_OPERATION'),
        status: STATUSES.QUEUED,
        priority: Number(options.priority || 100),
        current_phase: 'DISCOVER',
        requested_at: AKORT.Core.now(),
        started_at: '',
        finished_at: '',
        attempt_no: 0,
        max_attempts: Number(options.maxAttempts || runtime.maxAttempts),
        checkpoint_json: AKORT.Core.safeJson(checkpoint),
        error_code: '',
        error_message: '',
        created_by: currentUser_(),
        release_version: AKORT.Release.version
      };
      appendObject_(queue, operation);
      context.logger.info('Operation queued', { operationType: operation.operation_type }, {
        operationId: operationId,
        eventCode: 'OPERATION_QUEUED'
      });
      return AKORT.Result.success('Operation queued successfully.', {
        operationId: operationId,
        reused: false,
        operation: publicOperation_(operation)
      });
    }, { lock: true, persistLogs: true });
  }

  function assertTransition_(fromPhase, toPhase) {
    var expected = NEXT_PHASE[fromPhase];
    if (expected !== toPhase) {
      throw AKORT.Core.error('INVALID_PHASE_TRANSITION', 'Invalid operation phase transition.', {
        from: fromPhase,
        to: toPhase,
        expected: expected || null
      });
    }
    return true;
  }

  function leaseIsActive_(lease, nowMs) {
    if (!lease || !lease.expiresAt) return false;
    var expires = Date.parse(String(lease.expiresAt));
    return !isNaN(expires) && expires > nowMs;
  }

  function acquireLease_(operationTable, operation, checkpoint, executionId, runtime) {
    var nowMs = Date.now();
    if (leaseIsActive_(checkpoint.lease, nowMs) && checkpoint.lease.executionId !== executionId) {
      throw AKORT.Core.error('OPERATION_ALREADY_RUNNING', 'Operation has an active execution lease.', {
        operationId: operation.operation_id,
        activeExecutionId: checkpoint.lease.executionId,
        leaseExpiresAt: checkpoint.lease.expiresAt
      });
    }
    checkpoint.lease = {
      executionId: executionId,
      acquiredAt: AKORT.Core.now(),
      expiresAt: new Date(nowMs + runtime.leaseMs).toISOString()
    };
    saveCheckpoint_(operation, checkpoint);
    saveObject_(operationTable, operation);
  }

  function clearLease_(operation, checkpoint) {
    checkpoint.lease = null;
    saveCheckpoint_(operation, checkpoint);
  }

  function appendStep_(spreadsheet, operation, phase, status, startedAt, checkpoint, result, caught) {
    var steps = table_(spreadsheet, 'OPERATION_STEPS');
    var normalized = caught ? {
      code: caught.code || 'UNEXPECTED_ERROR',
      message: caught.message || String(caught),
      details: caught.details === undefined ? null : caught.details
    } : null;
    var step = {
      step_id: AKORT.Core.Id.step(phase),
      operation_id: operation.operation_id,
      phase: phase,
      status: status,
      attempt_no: Number(operation.attempt_no || 0),
      started_at: startedAt,
      finished_at: AKORT.Core.now(),
      checkpoint_json: auditCellJson_(checkpoint, true),
      result_json: result === undefined ? '' : auditCellJson_(result, false),
      error_code: normalized ? normalized.code : '',
      error_message: normalized ? normalized.message : '',
      release_version: AKORT.Release.version
    };
    appendObject_(steps, step);
    return step;
  }

  function handler_(operationType) {
    var type = String(operationType || '');
    if (AKORT.SourceParserHandlers &&
        typeof AKORT.SourceParserHandlers.supports === 'function' &&
        AKORT.SourceParserHandlers.supports(type)) {
      return AKORT.SourceParserHandlers;
    }
    if (AKORT.RawStoreHandlers &&
        typeof AKORT.RawStoreHandlers.supports === 'function' &&
        AKORT.RawStoreHandlers.supports(type)) {
      return AKORT.RawStoreHandlers;
    }
    if ((type.indexOf('ALPHA3_TEST_') === 0 || type.indexOf('ALPHA3_DEMO_') === 0) &&
        AKORT.TestOperationHandlers &&
        typeof AKORT.TestOperationHandlers.execute === 'function') {
      return AKORT.TestOperationHandlers;
    }
    throw AKORT.Core.error('OPERATION_HANDLER_NOT_FOUND', 'No operation handler is registered for this operation type.', {
      operationType: type,
      retryable: false
    });
  }

  function completeSuccess_(spreadsheet, operationTable, operation, checkpoint, logger) {
    checkpoint.nextPhase = 'SUCCESS';
    if (checkpoint.completedPhases.indexOf('SUCCESS') < 0) checkpoint.completedPhases.push('SUCCESS');
    clearLease_(operation, checkpoint);
    operation.status = STATUSES.SUCCESS;
    operation.current_phase = 'SUCCESS';
    operation.finished_at = AKORT.Core.now();
    operation.error_code = '';
    operation.error_message = '';
    saveObject_(operationTable, operation);
    appendStep_(spreadsheet, operation, 'SUCCESS', 'SUCCESS', AKORT.Core.now(), checkpoint, {
      terminal: true,
      completedPhases: checkpoint.completedPhases.slice()
    }, null);
    logger.info('Operation completed successfully', null, {
      operationId: operation.operation_id,
      eventCode: 'OPERATION_SUCCESS'
    });
    return operation;
  }

  function publicOperation_(operation) {
    var result = {};
    Object.keys(operation).forEach(function (key) {
      if (key !== '__row' && key !== 'checkpoint_json') result[key] = operation[key];
    });
    result.checkpoint = checkpointFor_(operation);
    return result;
  }

  function publicSteps_(steps) {
    return steps.map(function (step) {
      var result = {};
      Object.keys(step).forEach(function (key) {
        if (key !== '__row') result[key] = step[key];
      });
      return result;
    });
  }

  function resultData_(spreadsheet, operation) {
    var steps = readSteps_(spreadsheet, operation.operation_id);
    return {
      operationId: operation.operation_id,
      operation: publicOperation_(operation),
      stepCount: steps.length,
      steps: publicSteps_(steps)
    };
  }

  function handlePhaseError_(spreadsheet, operationTable, operation, checkpoint, phase, startedAt, caught, logger) {
    var details = caught && caught.details ? caught.details : {};
    var retryable = details && details.retryable === true;
    operation.error_code = caught && caught.code ? caught.code : 'UNEXPECTED_ERROR';
    operation.error_message = caught && caught.message ? caught.message : String(caught);

    if (details && details.requiresReview === true) {
      operation.status = STATUSES.FAILED_REQUIRES_REVIEW;
      operation.finished_at = AKORT.Core.now();
      checkpoint.nextPhase = phase;
      clearLease_(operation, checkpoint);
      appendStep_(
        spreadsheet,
        operation,
        phase,
        STATUSES.FAILED_REQUIRES_REVIEW,
        startedAt,
        checkpoint,
        null,
        caught
      );
      saveObject_(operationTable, operation);
      logger.error('Operation stopped for manual review', {
        phase: phase,
        errorCode: operation.error_code,
        errorMessage: operation.error_message
      }, { operationId: operation.operation_id, eventCode: 'OPERATION_REQUIRES_REVIEW' });
      return AKORT.Result.failure(operation.error_code, operation.error_message, resultData_(spreadsheet, operation));
    }

    if (retryable) {
      operation.attempt_no = Number(operation.attempt_no || 0) + 1;
      var exhausted = operation.attempt_no >= Number(operation.max_attempts || 1);
      operation.status = exhausted ? STATUSES.DEAD_LETTER : STATUSES.RETRY_PENDING;
      checkpoint.nextPhase = phase;
      clearLease_(operation, checkpoint);
      appendStep_(spreadsheet, operation, phase, operation.status, startedAt, checkpoint, null, caught);
      saveObject_(operationTable, operation);
      logger.warn(exhausted ? 'Operation moved to dead letter' : 'Operation scheduled for retry', {
        phase: phase,
        attemptNo: operation.attempt_no,
        maxAttempts: operation.max_attempts,
        errorCode: operation.error_code
      }, { operationId: operation.operation_id, eventCode: exhausted ? 'OPERATION_DEAD_LETTER' : 'OPERATION_RETRY_PENDING' });
      return exhausted
        ? AKORT.Result.failure('OPERATION_DEAD_LETTER', 'Operation exhausted its retry limit and moved to dead letter.', resultData_(spreadsheet, operation))
        : AKORT.Result.paused('Operation scheduled for retry.', resultData_(spreadsheet, operation));
    }

    operation.status = STATUSES.FAILED;
    operation.finished_at = AKORT.Core.now();
    checkpoint.nextPhase = phase;
    clearLease_(operation, checkpoint);
    appendStep_(spreadsheet, operation, phase, STATUSES.FAILED, startedAt, checkpoint, null, caught);
    saveObject_(operationTable, operation);
    logger.error('Operation failed', {
      phase: phase,
      errorCode: operation.error_code,
      errorMessage: operation.error_message
    }, { operationId: operation.operation_id, eventCode: 'OPERATION_FAILED' });
    return AKORT.Result.failure(operation.error_code, operation.error_message, resultData_(spreadsheet, operation));
  }

  function pause_(spreadsheet, operationTable, operation, checkpoint, message, logger, eventCode) {
    operation.status = STATUSES.PAUSED;
    clearLease_(operation, checkpoint);
    saveObject_(operationTable, operation);
    logger.info(message, { nextPhase: operation.current_phase }, {
      operationId: operation.operation_id,
      eventCode: eventCode || 'OPERATION_PAUSED'
    });
    return AKORT.Result.paused(message, resultData_(spreadsheet, operation));
  }

  function runLocked_(operationId, options, context) {
    options = options || {};
    var runtime = runtimeSettings_();
    var spreadsheet = getDwh_();
    var found = findOperation_(spreadsheet, operationId);
    var operationTable = found.table;
    var operation = found.operation;
    var checkpoint = checkpointFor_(operation);

    if (operation.status === STATUSES.SUCCESS) {
      return AKORT.Result.success('Operation already completed; no steps were executed again.', resultData_(spreadsheet, operation));
    }
    if (operation.status === STATUSES.DEAD_LETTER) {
      return AKORT.Result.failure('OPERATION_DEAD_LETTER', 'Operation is in dead-letter status.', resultData_(spreadsheet, operation));
    }
    if (operation.status === STATUSES.FAILED) {
      return AKORT.Result.failure(operation.error_code || 'OPERATION_FAILED', operation.error_message || 'Operation is in failed status.', resultData_(spreadsheet, operation));
    }
    if (operation.status === STATUSES.FAILED_REQUIRES_REVIEW) {
      return AKORT.Result.failure(
        operation.error_code || 'OPERATION_REQUIRES_REVIEW',
        operation.error_message || 'Operation requires manual review.',
        resultData_(spreadsheet, operation)
      );
    }
    if (operation.status === STATUSES.CANCELLED) {
      return AKORT.Result.failure('OPERATION_CANCELLED', 'Operation was cancelled.', resultData_(spreadsheet, operation));
    }

    if (checkpoint.schemaVersion !== AKORT.Release.operationSchemaVersion) {
      throw AKORT.Core.error('CHECKPOINT_SCHEMA_MISMATCH', 'Operation checkpoint schema is incompatible with the installed engine.', {
        expected: AKORT.Release.operationSchemaVersion,
        actual: checkpoint.schemaVersion
      });
    }

    acquireLease_(operationTable, operation, checkpoint, context.executionId, runtime);

    if (checkpoint.control.stopRequested) {
      return pause_(spreadsheet, operationTable, operation, checkpoint, 'Operation stopped safely before the next phase.', context.logger, 'OPERATION_SAFE_STOP');
    }

    operation.status = STATUSES.RUNNING;
    if (!operation.started_at) operation.started_at = AKORT.Core.now();
    operation.finished_at = '';
    operation.error_code = '';
    operation.error_message = '';
    saveObject_(operationTable, operation);

    var startedMs = Date.now();
    var executionBudgetMs = Number(options.executionBudgetMs || runtime.executionBudgetMs);
    var maxSteps = Number(options.maxSteps || runtime.maxStepsPerRun);
    var minRemainingMs = Number(options.minRemainingMs || runtime.minRemainingMs);
    var completedThisRun = 0;

    while (operation.status === STATUSES.RUNNING) {
      if (checkpoint.control.stopRequested) {
        return pause_(spreadsheet, operationTable, operation, checkpoint, 'Operation stopped safely at its checkpoint.', context.logger, 'OPERATION_SAFE_STOP');
      }

      var elapsed = Date.now() - startedMs;
      var budgetExhausted = elapsed >= Math.max(0, executionBudgetMs - minRemainingMs);
      if (completedThisRun >= maxSteps || budgetExhausted) {
        return pause_(spreadsheet, operationTable, operation, checkpoint, 'Operation paused at a safe checkpoint.', context.logger, 'OPERATION_BUDGET_PAUSE');
      }

      var phase = String(operation.current_phase || checkpoint.nextPhase || '');
      if (phase === 'SUCCESS') return completeSuccess_(spreadsheet, operationTable, operation, checkpoint, context.logger);
      if (EXECUTABLE_PHASES.indexOf(phase) < 0) {
        throw AKORT.Core.error('INVALID_OPERATION_PHASE', 'Operation contains an unsupported phase.', { phase: phase });
      }
      if (String(checkpoint.nextPhase) !== phase) {
        throw AKORT.Core.error('CHECKPOINT_PHASE_MISMATCH', 'Operation row and checkpoint disagree about the next phase.', {
          rowPhase: phase,
          checkpointPhase: checkpoint.nextPhase
        });
      }

      var phaseStartedAt = AKORT.Core.now();
      var outcome;
      try {
        outcome = handler_(operation.operation_type).execute(phase, {
          operation: publicOperation_(operation),
          checkpoint: checkpoint,
          logger: context.logger,
          executionId: context.executionId
        });
      } catch (caught) {
        return handlePhaseError_(spreadsheet, operationTable, operation, checkpoint, phase, phaseStartedAt, caught, context.logger);
      }

      if (outcome && outcome.repeatPhase === true) {
        checkpoint.nextPhase = phase;
        operation.current_phase = phase;
        saveCheckpoint_(operation, checkpoint);
        saveObject_(operationTable, operation);
        appendStep_(spreadsheet, operation, phase, 'CHECKPOINT', phaseStartedAt, checkpoint, outcome, null);
        context.logger.info('Operation phase checkpoint saved', {
          phase: phase,
          nextPhase: phase
        }, {
          operationId: operation.operation_id,
          eventCode: 'OPERATION_PHASE_CHECKPOINT'
        });
        return pause_(
          spreadsheet,
          operationTable,
          operation,
          checkpoint,
          'Operation phase saved a bounded-work checkpoint.',
          context.logger,
          'OPERATION_PHASE_CHECKPOINT'
        );
      }

      var next = NEXT_PHASE[phase];
      assertTransition_(phase, next);
      if (checkpoint.completedPhases.indexOf(phase) < 0) checkpoint.completedPhases.push(phase);
      checkpoint.nextPhase = next;
      operation.current_phase = next;
      saveCheckpoint_(operation, checkpoint);
      saveObject_(operationTable, operation);
      appendStep_(spreadsheet, operation, phase, 'SUCCESS', phaseStartedAt, checkpoint, outcome, null);
      completedThisRun += 1;
      context.logger.info('Operation phase completed', { phase: phase, nextPhase: next }, {
        operationId: operation.operation_id,
        eventCode: 'OPERATION_PHASE_COMPLETED'
      });

      if (outcome && outcome.pause === true) {
        return pause_(spreadsheet, operationTable, operation, checkpoint, 'Test handler requested a safe pause after phase ' + phase + '.', context.logger, 'OPERATION_HANDLER_PAUSE');
      }

      if (next === 'SUCCESS') return completeSuccess_(spreadsheet, operationTable, operation, checkpoint, context.logger);
    }

    return pause_(spreadsheet, operationTable, operation, checkpoint, 'Operation paused.', context.logger, 'OPERATION_PAUSED');
  }

  function run(operationId, options) {
    options = options || {};
    return AKORT.Core.safeRun('OPERATION_ENGINE_RUN', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var runtime = runtimeSettings_();
      return AKORT.Core.Locks.withScriptLock('OPERATION_' + operationId, function () {
        return runLocked_(operationId, options, context);
      }, runtime.lockTimeoutMs);
    }, { lock: false, persistLogs: true, operationId: operationId });
  }

  function setStopRequested_(operationId, value) {
    var spreadsheet = getDwh_();
    var found = findOperation_(spreadsheet, operationId);
    var operation = found.operation;
    var checkpoint = checkpointFor_(operation);
    if (TERMINAL_STATUSES[operation.status]) return operation;
    checkpoint.control.stopRequested = Boolean(value);
    saveCheckpoint_(operation, checkpoint);
    if (value && operation.status !== STATUSES.RUNNING) operation.status = STATUSES.PAUSED;
    saveObject_(found.table, operation);
    return operation;
  }

  function requestStop(operationId) {
    return AKORT.Core.safeRun('OPERATION_REQUEST_STOP', function () {
      var runtime = runtimeSettings_();
      return AKORT.Core.Locks.withScriptLock('OPERATION_STOP_' + operationId, function () {
        var operation = setStopRequested_(operationId, true);
        return AKORT.Result.success('Safe stop requested.', { operationId: operationId, operation: publicOperation_(operation) });
      }, runtime.lockTimeoutMs);
    }, { lock: false, persistLogs: true, operationId: operationId });
  }

  function recoverFailedPhase(operationId, expected) {
    expected = expected || {};
    return AKORT.Core.safeRun('OPERATION_RECOVER_FAILED_PHASE', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var runtime = runtimeSettings_();
      return AKORT.Core.Locks.withScriptLock('OPERATION_RECOVER_' + operationId, function () {
        var spreadsheet = getDwh_();
        var found = findOperation_(spreadsheet, operationId);
        var operation = found.operation;
        var checkpoint = checkpointFor_(operation);
        var expectedType = String(expected.operationType || '');
        var expectedPhase = String(expected.phase || '');
        var expectedErrorCode = String(expected.errorCode || '');
        var expectedStatus = String(expected.status || STATUSES.FAILED);
        if (operation.status !== expectedStatus ||
            expectedType && String(operation.operation_type) !== expectedType ||
            expectedPhase && String(operation.current_phase) !== expectedPhase ||
            expectedPhase && String(checkpoint.nextPhase) !== expectedPhase ||
            expectedErrorCode && String(operation.error_code) !== expectedErrorCode) {
          throw AKORT.Core.error('OPERATION_FAILED_RECOVERY_SOURCE_INVALID', 'Failed-operation recovery source does not match the exact authorized checkpoint.', {
            retryable: false,
            operationId: operationId,
            expected: {
              operationType: expectedType,
              phase: expectedPhase,
              errorCode: expectedErrorCode,
              status: expectedStatus
            },
            actual: {
              status: operation.status,
              operationType: operation.operation_type,
              currentPhase: operation.current_phase,
              checkpointPhase: checkpoint.nextPhase,
              errorCode: operation.error_code
            }
          });
        }
        if (checkpoint.schemaVersion !== AKORT.Release.operationSchemaVersion) {
          throw AKORT.Core.error('OPERATION_FAILED_RECOVERY_SCHEMA_MISMATCH', 'Failed-operation checkpoint schema is incompatible with the installed engine.', {
            retryable: false,
            expected: AKORT.Release.operationSchemaVersion,
            actual: checkpoint.schemaVersion
          });
        }
        checkpoint.control.stopRequested = false;
        checkpoint.lease = null;
        operation.status = STATUSES.PAUSED;
        operation.finished_at = '';
        operation.error_code = '';
        operation.error_message = '';
        saveCheckpoint_(operation, checkpoint);
        appendStep_(spreadsheet, operation, checkpoint.nextPhase, 'RECOVERY_PREPARED', AKORT.Core.now(), checkpoint, {
          recoveredFromStatus: expectedStatus,
          expectedOperationType: expectedType,
          expectedPhase: expectedPhase,
          expectedErrorCode: expectedErrorCode,
          reason: String(expected.reason || '')
        }, null);
        saveObject_(found.table, operation);
        context.logger.info('Failed operation prepared for exact checkpoint recovery', {
          phase: checkpoint.nextPhase,
          operationType: operation.operation_type,
          expectedErrorCode: expectedErrorCode
        }, { operationId: operationId, eventCode: 'OPERATION_FAILED_PHASE_RECOVERED' });
        return AKORT.Result.success('Failed operation prepared for continuation from its exact checkpoint.', resultData_(spreadsheet, operation));
      }, runtime.lockTimeoutMs);
    }, { lock: false, persistLogs: true, operationId: operationId });
  }

  /**
   * Exact recovery for a stopped RAW_REVERSAL_V4 checkpoint that reached the
   * Sheets 50,000-character cell limit after durable aggregate staging. The
   * caller must first validate the immutable AGGREGATE_STAGE snapshot. This
   * method only removes the duplicated reversal record array and adopts the
   * supplied validated stage boundary; it cannot repeat RAW or Publish work.
   */
  function recoverReversalCheckpointCapacity(operationId, expected) {
    expected = expected || {};
    return AKORT.Core.safeRun('OPERATION_RECOVER_REVERSAL_CHECKPOINT_CAPACITY', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var runtime = runtimeSettings_();
      return AKORT.Core.Locks.withScriptLock('OPERATION_RECOVER_CAPACITY_' + operationId, function () {
        var spreadsheet = getDwh_();
        var found = findOperation_(spreadsheet, operationId);
        var operation = found.operation;
        var checkpoint = checkpointFor_(operation);
        var raw = checkpoint.rawStore || {};
        var reversal = raw.reversal || {};
        var records = reversal.records || reversal.reversalLog || [];
        var aggregate = checkpoint.aggregate || {};
        var completed = checkpoint.completedPhases || [];
        var expectedRows = Number(expected.expectedStageRows || 0);
        var seriesKeys = (expected.affectedSeriesKeys || []).slice().sort();
        var activeLease = leaseIsActive_(checkpoint.lease, Date.now());
        var allowedStatus = operation.status === STATUSES.PAUSED || operation.status === STATUSES.RUNNING;
        var phasesBeforeStage = [
          'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW', 'UPDATE_PUBLISH',
          'PREPARING_AGGREGATE_IMPACT', 'MATERIALIZING_AGGREGATE_INPUTS',
          'CALCULATING_AGGREGATE_SLICES'
        ];
        var recordsValid = Array.isArray(records) && records.length === Number(expected.reversedRows || 0) && records.every(function (record) {
          return String(record.operation_id || '') === String(operationId) &&
            String(record.target_load_id || '') === String(expected.targetLoadId || '') &&
            String(record.reversal_load_id || '') === String(expected.reversalLoadId || '') &&
            String(record.status || '') === 'SUCCESS';
        });
        var sourceValid = allowedStatus && !activeLease &&
          String(operation.operation_type || '') === String(expected.operationType || 'RAW_REVERSAL_V4') &&
          String(operation.release_version || '') === String(expected.releaseVersion || '') &&
          String(operation.current_phase || '') === 'STAGING_AGGREGATE_ROWS' &&
          String(checkpoint.nextPhase || '') === 'STAGING_AGGREGATE_ROWS' &&
          checkpoint.control && checkpoint.control.stopRequested === true &&
          phasesBeforeStage.every(function (phase) { return completed.indexOf(phase) >= 0; }) &&
          completed.indexOf('STAGING_AGGREGATE_ROWS') < 0 &&
          String(raw.loadId || '') === String(expected.reversalLoadId || '') &&
          String(reversal.targetLoadId || '') === String(expected.targetLoadId || '') &&
          String(reversal.reversalLoadId || '') === String(expected.reversalLoadId || '') &&
          Number(reversal.reversedRows || records.length || 0) === Number(expected.reversedRows || 0) &&
          recordsValid && String(aggregate.status || '') === 'CALCULATED' &&
          Number(aggregate.calculationCursor || 0) === expectedRows &&
          Number(aggregate.calculationGroupCount || 0) === expectedRows &&
          Number(aggregate.stagingCursor || 0) === 0 &&
          !String(aggregate.stageFingerprint || '') && Number(aggregate.expectedStageRows || 0) === 0 &&
          Number(aggregate.publishSeriesCursor || 0) === 0 && !(aggregate.publishBatches || []).length &&
          expectedRows > 0 && seriesKeys.length === expectedRows && !!String(expected.stageFingerprint || '');
        if (!sourceValid) {
          throw AKORT.Core.error('REVERSAL_CHECKPOINT_CAPACITY_RECOVERY_SOURCE_INVALID', 'Reversal checkpoint does not match the exact stopped pre-publication capacity incident.', {
            retryable: false,
            operationId: operationId,
            operationType: operation.operation_type,
            operationStatus: operation.status,
            operationPhase: operation.current_phase,
            operationRelease: operation.release_version,
            checkpointPhase: checkpoint.nextPhase,
            stopRequested: checkpoint.control && checkpoint.control.stopRequested === true,
            activeLease: activeLease,
            reversalRecords: records.length,
            aggregateStatus: aggregate.status,
            calculationCursor: Number(aggregate.calculationCursor || 0),
            calculationGroupCount: Number(aggregate.calculationGroupCount || 0),
            stagingCursor: Number(aggregate.stagingCursor || 0),
            expectedStageRows: expectedRows,
            affectedSeriesCount: seriesKeys.length
          });
        }

        var recordsFingerprint = AKORT.Core.sha256(AKORT.Core.canonicalJson(records));
        raw.reversal = {
          targetLoadId: String(expected.targetLoadId || ''),
          reversalLoadId: String(expected.reversalLoadId || ''),
          reused: reversal.reused === true,
          reversedRows: Number(expected.reversedRows || 0),
          recordCount: records.length,
          recordsFingerprint: recordsFingerprint,
          durableRecordSource: 'RAW_REVERSAL_LOG'
        };
        aggregate.expectedStageRows = expectedRows;
        aggregate.affectedSeriesKeys = seriesKeys;
        aggregate.stageFingerprint = String(expected.stageFingerprint || '');
        aggregate.stagingCursor = expectedRows;
        aggregate.stageStatusCursor = expectedRows;
        aggregate.status = 'STAGED';
        if (completed.indexOf('STAGING_AGGREGATE_ROWS') < 0) completed.push('STAGING_AGGREGATE_ROWS');
        checkpoint.nextPhase = 'UPDATING_AGGREGATES';
        checkpoint.control.stopRequested = false;
        checkpoint.lease = null;
        operation.status = STATUSES.PAUSED;
        operation.current_phase = 'UPDATING_AGGREGATES';
        operation.finished_at = '';
        operation.error_code = '';
        operation.error_message = '';
        saveCheckpoint_(operation, checkpoint);
        saveObject_(found.table, operation);
        appendStep_(spreadsheet, operation, 'STAGING_AGGREGATE_ROWS', 'RECOVERY_PREPARED', AKORT.Core.now(), checkpoint, {
          recovery: 'REVERSAL_CHECKPOINT_CELL_CAPACITY',
          adoptedDurableStage: true,
          expectedStageRows: expectedRows,
          affectedSeriesCount: seriesKeys.length,
          stageFingerprint: aggregate.stageFingerprint,
          reversalRecordCount: records.length,
          reversalRecordsFingerprint: recordsFingerprint,
          resumePhase: 'UPDATING_AGGREGATES',
          reason: String(expected.reason || '')
        }, null);
        context.logger.info('Oversized reversal checkpoint compacted at the exact durable aggregate-stage boundary', {
          resumePhase: operation.current_phase,
          expectedStageRows: expectedRows,
          reversalRecordCount: records.length
        }, { operationId: operationId, eventCode: 'REVERSAL_CHECKPOINT_CAPACITY_RECOVERED' });
        return AKORT.Result.success('Reversal checkpoint compacted and prepared at UPDATING_AGGREGATES.', resultData_(spreadsheet, operation));
      }, runtime.lockTimeoutMs);
    }, { lock: false, persistLogs: true, operationId: operationId });
  }

  function resume(operationId, options) {
    options = options || {};
    var preparation = AKORT.Core.safeRun('OPERATION_RESUME_PREPARE', function () {
      var runtime = runtimeSettings_();
      return AKORT.Core.Locks.withScriptLock('OPERATION_RESUME_' + operationId, function () {
        var operation = setStopRequested_(operationId, false);
        if (operation.status === STATUSES.PAUSED || operation.status === STATUSES.RETRY_PENDING || operation.status === STATUSES.QUEUED || operation.status === STATUSES.RUNNING) {
          operation.status = operation.status === STATUSES.RETRY_PENDING ? STATUSES.RETRY_PENDING : STATUSES.PAUSED;
          var found = findOperation_(getDwh_(), operationId);
          saveObject_(found.table, operation);
        }
        return AKORT.Result.success('Operation prepared for continuation.', { operationId: operationId });
      }, runtime.lockTimeoutMs);
    }, { lock: false, persistLogs: false, operationId: operationId });
    if (!preparation.ok) return preparation;
    return run(operationId, options);
  }

  function status(operationId) {
    return AKORT.Core.safeRun('OPERATION_STATUS', function () {
      var spreadsheet = getDwh_();
      var found = findOperation_(spreadsheet, operationId);
      return AKORT.Result.success('Operation status loaded.', resultData_(spreadsheet, found.operation));
    }, { lock: false, persistLogs: false, operationId: operationId });
  }

  function engineStatus() {
    return AKORT.Core.safeRun('OPERATION_ENGINE_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var spreadsheet = getDwh_();
      var queue = table_(spreadsheet, 'OPERATION_QUEUE');
      var operations = readObjects_(queue);
      var counts = {};
      Object.keys(STATUSES).forEach(function (key) { counts[STATUSES[key]] = 0; });
      operations.forEach(function (operation) {
        var statusValue = String(operation.status || 'UNKNOWN');
        counts[statusValue] = Number(counts[statusValue] || 0) + 1;
      });
      return AKORT.Result.success('Operation Engine status loaded.', {
        release: AKORT.Release.manifest(),
        manifestHash: AKORT.Core.manifestHash(),
        phases: PHASES.slice(),
        statuses: clone_(STATUSES),
        runtimeSettings: runtimeSettings_(),
        operationCount: operations.length,
        statusCounts: counts
      });
    }, { lock: false, persistLogs: false });
  }

  function startDemo() {
    var demoKey = 'ALPHA3_DEMO_' + AKORT.Core.Id.execution();
    var queued = enqueue('ALPHA3_DEMO_OPERATION', {
      test: { pauseAfterPhase: 'PARSE' },
      description: 'Alpha.3 manual acceptance demo; no RAW or Publish writes'
    }, { idempotencyKey: demoKey, maxAttempts: 3 });
    if (!queued.ok) return queued;
    var operationId = queued.data.operationId;
    PropertiesService.getScriptProperties().setProperty(DEMO_PROPERTY, operationId);
    return run(operationId, { maxSteps: 50 });
  }

  function continueDemo() {
    var operationId = PropertiesService.getScriptProperties().getProperty(DEMO_PROPERTY);
    if (!operationId) return AKORT.Result.failure('DEMO_OPERATION_NOT_FOUND', 'No alpha.3 demo operation is registered. Run AKORT_alpha3StartDemo first.');
    return resume(operationId, { maxSteps: 50 });
  }

  function demoStatus() {
    var operationId = PropertiesService.getScriptProperties().getProperty(DEMO_PROPERTY);
    if (!operationId) return AKORT.Result.failure('DEMO_OPERATION_NOT_FOUND', 'No alpha.3 demo operation is registered.');
    return status(operationId);
  }

  function deleteRows_(sheet, rowNumbers) {
    rowNumbers.sort(function (a, b) { return b - a; });
    rowNumbers.forEach(function (row) { sheet.deleteRow(row); });
    return rowNumbers.length;
  }

  function cleanupByPrefix_(prefix) {
    var spreadsheet = getDwh_();
    var queue = table_(spreadsheet, 'OPERATION_QUEUE');
    var operations = readObjects_(queue);
    var ids = {};
    var queueRows = [];
    operations.forEach(function (operation) {
      if (String(operation.operation_type || '').indexOf(prefix) === 0) {
        ids[String(operation.operation_id)] = true;
        queueRows.push(operation.__row);
      }
    });
    var steps = table_(spreadsheet, 'OPERATION_STEPS');
    var stepRows = readObjects_(steps).filter(function (step) { return ids[String(step.operation_id)]; }).map(function (step) { return step.__row; });
    var deletedSteps = deleteRows_(steps.sheet, stepRows);
    var deletedOperations = deleteRows_(queue.sheet, queueRows);
    return { deletedOperations: deletedOperations, deletedSteps: deletedSteps };
  }

  function setTestLease_(operationId, leaseMs) {
    var spreadsheet = getDwh_();
    var found = findOperation_(spreadsheet, operationId);
    var checkpoint = checkpointFor_(found.operation);
    checkpoint.lease = {
      executionId: 'EXE_SIMULATED_ACTIVE_LEASE',
      acquiredAt: AKORT.Core.now(),
      expiresAt: new Date(Date.now() + Number(leaseMs || 60000)).toISOString()
    };
    saveCheckpoint_(found.operation, checkpoint);
    saveObject_(found.table, found.operation);
    return publicOperation_(found.operation);
  }

  function clearTestLease_(operationId) {
    var spreadsheet = getDwh_();
    var found = findOperation_(spreadsheet, operationId);
    var checkpoint = checkpointFor_(found.operation);
    checkpoint.lease = null;
    saveCheckpoint_(found.operation, checkpoint);
    saveObject_(found.table, found.operation);
    return publicOperation_(found.operation);
  }

  return {
    Phases: PHASES.slice(),
    ExecutablePhases: EXECUTABLE_PHASES.slice(),
    Statuses: clone_(STATUSES),
    NextPhase: clone_(NEXT_PHASE),
    install: install,
    enqueue: enqueue,
    run: run,
    resume: resume,
    recoverFailedPhase: recoverFailedPhase,
    recoverReversalCheckpointCapacity: recoverReversalCheckpointCapacity,
    requestStop: requestStop,
    status: status,
    engineStatus: engineStatus,
    startDemo: startDemo,
    continueDemo: continueDemo,
    demoStatus: demoStatus,
    runtimeSettings: runtimeSettings_,
    assertTransition: assertTransition_,
    Test: {
      cleanupByPrefix: cleanupByPrefix_,
      setActiveLease: setTestLease_,
      clearLease: clearTestLease_,
      readSteps: function (operationId) { return readSteps_(getDwh_(), operationId); },
      getOperation: function (operationId) { return findOperation_(getDwh_(), operationId).operation; }
    }
  };
})();
