var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 1 migration cleanup.
 *
 * This narrowly-scoped administrative action terminally closes only the
 * confirmed legacy DEV test operations that block the operation-schema
 * migration. It never deletes queue history and never touches RAW, Publish or
 * aggregate data.
 */
AKORT.Alpha74Gate1Cleanup = (function () {
  var LEGACY_SCHEMA_VERSION = '4.0-operation-1';
  var TARGET_SCHEMA_VERSION = '4.0-operation-2';
  var CLOSURE_CODE = 'ALPHA74_GATE1_LEGACY_CANCELLED';
  var CLOSURE_MESSAGE = 'Cancelled by Alpha.7.4 Gate 1 migration cleanup; RAW, Publish and aggregate rows were not changed.';
  var EXPECTED_PROFILE = {
    total: 4,
    alpha3Test: 3,
    alpha4SmokeReversal: 1
  };
  var TERMINAL_STATUSES = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  function clone_(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (e) { return 'unknown'; }
  }

  function parseCheckpoint_(value) {
    if (value && typeof value === 'object') return clone_(value);
    try { return JSON.parse(String(value || '{}')); }
    catch (caught) { return null; }
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' || String(value).toUpperCase() === 'TRUE';
  }

  function leaseIsActive_(checkpoint, nowMs) {
    var lease = checkpoint && checkpoint.lease;
    if (!lease || !lease.expiresAt) return false;
    var expires = Date.parse(String(lease.expiresAt));
    return !isNaN(expires) && expires > Number(nowMs);
  }

  function publicOperation_(operation, kind) {
    return {
      operationId: String(operation.operation_id || ''),
      operationType: String(operation.operation_type || ''),
      status: String(operation.status || ''),
      phase: String(operation.current_phase || ''),
      releaseVersion: String(operation.release_version || ''),
      kind: String(kind || '')
    };
  }

  function publicClassification_(classification) {
    return {
      operationId: String(classification.operationId || ''),
      operationType: String(classification.operationType || ''),
      status: String(classification.status || ''),
      phase: String(classification.phase || ''),
      releaseVersion: String(classification.releaseVersion || ''),
      kind: String(classification.kind || '')
    };
  }

  function blocked_(operation, reason, details) {
    var result = publicOperation_(operation, '');
    result.classification = 'BLOCKED';
    result.reason = reason;
    result.details = details || null;
    return result;
  }

  function candidate_(operation, kind, details) {
    var result = publicOperation_(operation, kind);
    result.classification = 'CANDIDATE';
    result.reason = 'SAFE_LEGACY_TEST_OPERATION';
    result.details = details || null;
    return result;
  }

  function classifyLegacyOperation_(operation, evidence, nowMs) {
    evidence = evidence || {};
    var status = String(operation.status || '');
    if (TERMINAL_STATUSES[status]) {
      var terminal = publicOperation_(operation, '');
      terminal.classification = 'TERMINAL';
      terminal.reason = 'ALREADY_TERMINAL';
      terminal.details = null;
      return terminal;
    }

    var checkpoint = parseCheckpoint_(operation.checkpoint_json);
    if (!checkpoint) return blocked_(operation, 'INVALID_CHECKPOINT_JSON');
    if (String(checkpoint.schemaVersion || '') !== LEGACY_SCHEMA_VERSION) {
      return blocked_(operation, 'SCHEMA_NOT_LEGACY', {
        expected: LEGACY_SCHEMA_VERSION,
        actual: String(checkpoint.schemaVersion || '')
      });
    }
    if (leaseIsActive_(checkpoint, nowMs)) {
      return blocked_(operation, 'ACTIVE_LEASE', {
        executionId: String(checkpoint.lease.executionId || ''),
        expiresAt: String(checkpoint.lease.expiresAt || '')
      });
    }

    var operationId = String(operation.operation_id || '');
    var operationType = String(operation.operation_type || '');
    if (operationType.indexOf('ALPHA3_TEST_') === 0) {
      if (operationId.indexOf('OP_ALPHA3_TEST_') !== 0) return blocked_(operation, 'ALPHA3_TEST_ID_MISMATCH');
      if (status !== 'PAUSED') return blocked_(operation, 'ALPHA3_TEST_STATUS_MISMATCH', { expected: 'PAUSED', actual: status });
      return candidate_(operation, 'ALPHA3_TEST', {
        checkpointSchemaVersion: LEGACY_SCHEMA_VERSION
      });
    }

    if (operationType === 'RAW_REVERSAL_V4') {
      var input = checkpoint.input || {};
      var targetLoadId = String(input.targetLoadId || '');
      var reason = String(input.reason || '');
      if (operationId.indexOf('OP_RAW_REVERSAL_V4_') !== 0) return blocked_(operation, 'REVERSAL_ID_MISMATCH');
      if (status !== 'RUNNING') return blocked_(operation, 'REVERSAL_STATUS_MISMATCH', { expected: 'RUNNING', actual: status });
      if (String(operation.current_phase || '') !== 'COMMIT_RAW') {
        return blocked_(operation, 'REVERSAL_PHASE_MISMATCH', { expected: 'COMMIT_RAW', actual: String(operation.current_phase || '') });
      }
      if (reason.toLowerCase().indexOf('alpha.4 smoke') !== 0) {
        return blocked_(operation, 'REVERSAL_REASON_MISMATCH', { actual: reason });
      }
      if (!targetLoadId) return blocked_(operation, 'REVERSAL_TARGET_LOAD_MISSING');
      if (evidence.targetLoadExists) {
        return blocked_(operation, 'REVERSAL_TARGET_LOAD_PRESENT', { targetLoadId: targetLoadId });
      }
      if (evidence.reversalRecordExists) {
        return blocked_(operation, 'REVERSAL_LOG_PRESENT', { targetLoadId: targetLoadId });
      }
      return candidate_(operation, 'ALPHA4_SMOKE_REVERSAL', {
        checkpointSchemaVersion: LEGACY_SCHEMA_VERSION,
        targetLoadId: targetLoadId,
        expiredLease: !!checkpoint.lease
      });
    }

    return blocked_(operation, 'UNSAFE_LEGACY_OPERATION');
  }

  function table_(spreadsheet, name, expectedHeaders) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw AKORT.Core.error('SERVICE_TABLE_MISSING', 'Missing service table ' + name + '.');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
      throw AKORT.Core.error('SERVICE_SCHEMA_MISMATCH', 'Unexpected schema for service table ' + name + '.', {
        expected: expectedHeaders,
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
    return object;
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function activeSetting_(spreadsheet, key) {
    var table = table_(spreadsheet, 'SYSTEM_SETTINGS', AKORT.Core.Tables.SYSTEM_SETTINGS);
    var match = readObjects_(table).filter(function (row) {
      return String(row.setting_key || '') === String(key) && truthy_(row.is_active);
    })[0];
    return match ? String(match.setting_value || '') : '';
  }

  function evidence_(spreadsheet) {
    var loads = table_(spreadsheet, 'RAW_LOAD_REGISTRY', AKORT.RawStore.Tables.RAW_LOAD_REGISTRY);
    var reversals = table_(spreadsheet, 'RAW_REVERSAL_LOG', AKORT.RawStore.Tables.RAW_REVERSAL_LOG);
    var loadIds = {};
    var reversalTargetLoadIds = {};
    readObjects_(loads).forEach(function (row) {
      loadIds[String(row.load_id || '')] = true;
    });
    readObjects_(reversals).forEach(function (row) {
      reversalTargetLoadIds[String(row.target_load_id || '')] = true;
    });
    return {
      loadIds: loadIds,
      reversalTargetLoadIds: reversalTargetLoadIds
    };
  }

  function closureRecord_(operation) {
    if (String(operation.status || '') !== 'CANCELLED') return null;
    var checkpoint = parseCheckpoint_(operation.checkpoint_json);
    var closure = checkpoint && checkpoint.meta && checkpoint.meta.alpha74Gate1Closure;
    if (!closure || String(closure.code || '') !== CLOSURE_CODE) return null;
    var kind = String(closure.kind || '');
    if (['ALPHA3_TEST', 'ALPHA4_SMOKE_REVERSAL'].indexOf(kind) < 0) return null;
    return publicOperation_(operation, kind);
  }

  function profile_(operations) {
    var profile = { total: operations.length, alpha3Test: 0, alpha4SmokeReversal: 0 };
    operations.forEach(function (operation) {
      if (operation.kind === 'ALPHA3_TEST') profile.alpha3Test += 1;
      if (operation.kind === 'ALPHA4_SMOKE_REVERSAL') profile.alpha4SmokeReversal += 1;
    });
    return profile;
  }

  function profileMatches_(profile) {
    return profile.total === EXPECTED_PROFILE.total &&
      profile.alpha3Test === EXPECTED_PROFILE.alpha3Test &&
      profile.alpha4SmokeReversal === EXPECTED_PROFILE.alpha4SmokeReversal;
  }

  function scan_(spreadsheet) {
    var queue = table_(spreadsheet, 'OPERATION_QUEUE', AKORT.Core.Tables.OPERATION_QUEUE);
    var queueRows = readObjects_(queue);
    var rawEvidence = evidence_(spreadsheet);
    var candidates = [];
    var blockers = [];
    var alreadyClosed = [];
    var nowMs = Date.now();

    queueRows.forEach(function (operation) {
      var closed = closureRecord_(operation);
      if (closed) {
        alreadyClosed.push(closed);
        return;
      }
      if (TERMINAL_STATUSES[String(operation.status || '')]) return;
      var checkpoint = parseCheckpoint_(operation.checkpoint_json);
      var targetLoadId = checkpoint && checkpoint.input ? String(checkpoint.input.targetLoadId || '') : '';
      var classification = classifyLegacyOperation_(operation, {
        targetLoadExists: !!rawEvidence.loadIds[targetLoadId],
        reversalRecordExists: !!rawEvidence.reversalTargetLoadIds[targetLoadId]
      }, nowMs);
      if (classification.classification === 'CANDIDATE') {
        classification.__row = operation.__row;
        classification.__operation = operation;
        candidates.push(classification);
      } else {
        blockers.push(classification);
      }
    });

    candidates.sort(function (a, b) { return a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0; });
    alreadyClosed.sort(function (a, b) { return a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0; });
    blockers.sort(function (a, b) { return a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0; });
    var combined = candidates.concat(alreadyClosed);
    var profile = profile_(combined);
    var expectedProfileMatched = profileMatches_(profile);
    var installedSchemaVersion = activeSetting_(spreadsheet, 'OPERATION_SCHEMA_VERSION');
    var fingerprintPayload = {
      installedSchemaVersion: installedSchemaVersion,
      candidates: candidates.map(publicClassification_),
      alreadyClosed: alreadyClosed,
      blockers: blockers,
      profile: profile
    };

    return {
      installedSchemaVersion: installedSchemaVersion,
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      expectedProfile: clone_(EXPECTED_PROFILE),
      actualProfile: profile,
      expectedProfileMatched: expectedProfileMatched,
      readyToClose: installedSchemaVersion === LEGACY_SCHEMA_VERSION && expectedProfileMatched && blockers.length === 0 && candidates.length > 0,
      complete: expectedProfileMatched && blockers.length === 0 && candidates.length === 0 && alreadyClosed.length === EXPECTED_PROFILE.total,
      candidates: candidates,
      alreadyClosed: alreadyClosed,
      blockers: blockers,
      fingerprint: AKORT.Core.sha256(AKORT.Core.canonicalJson(fingerprintPayload)),
      physicalWrites: false
    };
  }

  function publicScan_(scan) {
    return {
      installedSchemaVersion: scan.installedSchemaVersion,
      targetSchemaVersion: scan.targetSchemaVersion,
      expectedProfile: clone_(scan.expectedProfile),
      actualProfile: clone_(scan.actualProfile),
      expectedProfileMatched: scan.expectedProfileMatched,
      readyToClose: scan.readyToClose,
      complete: scan.complete,
      candidates: scan.candidates.map(publicClassification_),
      alreadyClosed: clone_(scan.alreadyClosed),
      blockers: clone_(scan.blockers),
      fingerprint: scan.fingerprint,
      physicalWrites: false
    };
  }

  function status() {
    return AKORT.Core.safeRun('ALPHA74_GATE1_LEGACY_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var scan = scan_(getDwh_());
      return AKORT.Result.success(
        scan.complete ? 'Alpha.7.4 Gate 1 legacy cleanup is complete.' : 'Alpha.7.4 Gate 1 legacy cleanup preflight completed.',
        publicScan_(scan)
      );
    }, { lock: false, persistLogs: false });
  }

  function closeCandidate_(queue, steps, candidate, closedAt, closedBy, logger) {
    var operation = candidate.__operation;
    var checkpoint = parseCheckpoint_(operation.checkpoint_json);
    checkpoint.control = checkpoint.control || {};
    checkpoint.control.stopRequested = true;
    checkpoint.lease = null;
    checkpoint.meta = checkpoint.meta || {};
    checkpoint.meta.alpha74Gate1Closure = {
      code: CLOSURE_CODE,
      kind: candidate.kind,
      closedAt: closedAt,
      closedBy: closedBy,
      fromSchemaVersion: LEGACY_SCHEMA_VERSION,
      targetSchemaVersion: TARGET_SCHEMA_VERSION
    };

    operation.status = 'CANCELLED';
    operation.finished_at = closedAt;
    operation.checkpoint_json = AKORT.Core.safeJson(checkpoint);
    operation.error_code = CLOSURE_CODE;
    operation.error_message = CLOSURE_MESSAGE;
    saveObject_(queue, operation);

    appendObject_(steps, {
      step_id: AKORT.Core.Id.step('GATE1_CANCEL'),
      operation_id: operation.operation_id,
      phase: operation.current_phase,
      status: 'CANCELLED',
      attempt_no: Number(operation.attempt_no || 0),
      started_at: closedAt,
      finished_at: closedAt,
      checkpoint_json: operation.checkpoint_json,
      result_json: AKORT.Core.safeJson({
        action: 'LEGACY_MIGRATION_CLOSURE',
        kind: candidate.kind,
        fromSchemaVersion: LEGACY_SCHEMA_VERSION,
        targetSchemaVersion: TARGET_SCHEMA_VERSION,
        physicalWrites: false
      }),
      error_code: CLOSURE_CODE,
      error_message: CLOSURE_MESSAGE,
      release_version: AKORT.Release.version
    });

    logger.warn('Legacy DEV test operation closed for Alpha.7.4 schema migration.', {
      operationId: String(operation.operation_id || ''),
      operationType: String(operation.operation_type || ''),
      phase: String(operation.current_phase || ''),
      kind: candidate.kind,
      physicalWrites: false
    }, {
      operationId: String(operation.operation_id || ''),
      eventCode: CLOSURE_CODE
    });
    return publicOperation_(operation, candidate.kind);
  }

  function closeLegacyOperations() {
    return AKORT.Core.safeRun('ALPHA74_GATE1_LEGACY_CLOSE', function (context) {
      AKORT.EnvironmentGuard.assertDev();
      var spreadsheet = getDwh_();
      var before = scan_(spreadsheet);
      if (before.complete) {
        return AKORT.Result.success('Alpha.7.4 Gate 1 legacy cleanup was already complete.', {
          before: publicScan_(before),
          closed: [],
          physicalWrites: false
        });
      }
      if (!before.readyToClose) {
        throw AKORT.Core.error('ALPHA74_GATE1_CLEANUP_BLOCKED', 'Legacy operation cleanup preflight did not match the exact approved DEV profile.', publicScan_(before));
      }

      var queue = table_(spreadsheet, 'OPERATION_QUEUE', AKORT.Core.Tables.OPERATION_QUEUE);
      var steps = table_(spreadsheet, 'OPERATION_STEPS', AKORT.Core.Tables.OPERATION_STEPS);
      var closedAt = AKORT.Core.now();
      var closedBy = currentUser_();
      var closed = before.candidates.map(function (candidate) {
        return closeCandidate_(queue, steps, candidate, closedAt, closedBy, context.logger);
      });
      var after = scan_(spreadsheet);
      if (!after.complete) {
        throw AKORT.Core.error('ALPHA74_GATE1_CLEANUP_INCOMPLETE', 'Legacy operation cleanup did not reach the exact terminal profile.', {
          before: publicScan_(before),
          after: publicScan_(after),
          closed: closed
        });
      }
      return AKORT.Result.success('Alpha.7.4 Gate 1 legacy DEV operations closed safely.', {
        beforeFingerprint: before.fingerprint,
        closed: closed,
        after: publicScan_(after),
        queueRowsChanged: closed.length,
        stepRowsAppended: closed.length,
        rawRowsChanged: 0,
        publishRowsChanged: 0,
        aggregateRowsChanged: 0,
        physicalWrites: false
      });
    }, { lock: true, persistLogs: true });
  }

  return Object.freeze({
    LegacySchemaVersion: LEGACY_SCHEMA_VERSION,
    TargetSchemaVersion: TARGET_SCHEMA_VERSION,
    ClosureCode: CLOSURE_CODE,
    ExpectedProfile: clone_(EXPECTED_PROFILE),
    status: status,
    closeLegacyOperations: closeLegacyOperations,
    Test: Object.freeze({
      classifyLegacyOperation: classifyLegacyOperation_,
      profile: profile_,
      profileMatches: profileMatches_
    })
  });
})();
