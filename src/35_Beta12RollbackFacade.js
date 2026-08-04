var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.2 r5: source-provenance protected facade over RAW_REVERSAL_V4.
 */
AKORT.Beta12RollbackFacade = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.2.5';
  var CONTRACT_VERSION = '4.0-beta12-rollback-facade-4';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = 'ad27642024690546b16a2b33fa4d3ba8d5dfb8ee';
  var OPERATION_TYPE = 'RAW_REVERSAL_V4';
  var REASON_MIN = 12;
  var REASON_MAX = 500;
  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    DEAD_LETTER: true,
    CANCELLED: true,
    FAILED_REQUIRES_REVIEW: true
  };
  var PROTECTED_MARKERS = [
    'ALPHA3_TEST_', 'ALPHA3_DEMO_', 'ALPHA4_TEST_', 'ALPHA5_TEST_',
    'ALPHA74_GATE6', 'ALPHA74_GATE7', 'GATE6_', 'GATE7_'
  ];

  function clone_(value) {
    return JSON.parse(JSON.stringify(
      value === undefined ? null : value
    ));
  }

  function parseCheckpoint_(value, operationId) {
    if (value && typeof value === 'object') return clone_(value);
    if (value === '' || value === null || value === undefined) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_CHECKPOINT_MISSING',
        'A relevant rollback operation has no checkpoint.',
        {
          retryable: false,
          operationId: String(operationId || '')
        }
      );
    }
    try {
      return JSON.parse(String(value));
    } catch (caught) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_CHECKPOINT_INVALID',
        'A relevant rollback operation checkpoint is invalid JSON.',
        {
          retryable: false,
          operationId: String(operationId || ''),
          cause: String(caught)
        }
      );
    }
  }

  function normalizeReason_(reason) {
    var normalized = String(reason || '').replace(/\s+/g, ' ').trim();
    if (normalized.length < REASON_MIN) {
      throw AKORT.Core.error(
        'BETA12_REASON_TOO_SHORT',
        'Rollback reason must contain at least ' +
          REASON_MIN + ' characters.',
        { retryable: false, minimumCharacters: REASON_MIN }
      );
    }
    if (normalized.length > REASON_MAX) {
      throw AKORT.Core.error(
        'BETA12_REASON_TOO_LONG',
        'Rollback reason exceeds the maximum length.',
        { retryable: false, maximumCharacters: REASON_MAX }
      );
    }
    return normalized;
  }

  function getDwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(
      config.resources.dwhSpreadsheetId
    );
  }

  function readObjects_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA12_REQUIRED_TABLE_MISSING',
        'Required DEV table is missing.',
        { retryable: false, table: sheetName }
      );
    }
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function findOne_(rows, field, value) {
    for (var i = 0; i < rows.length; i += 1) {
      if (String(rows[i][field] || '') === String(value || '')) {
        return rows[i];
      }
    }
    return null;
  }

  function protectedMarkerMatches_(value) {
    var identity = String(value || '').toUpperCase();
    return PROTECTED_MARKERS.filter(function (marker) {
      return identity.indexOf(marker) >= 0;
    });
  }

  function protectedLoad_(load) {
    var identity = [
      load && load.load_id,
      load && load.source_id,
      load && load.source_name,
      load && load.operation_id
    ].join('|');
    return protectedMarkerMatches_(identity).length > 0;
  }

  function checkpointInput_(operation) {
    var checkpoint = parseCheckpoint_(
      operation && operation.checkpoint_json,
      operation && operation.operation_id
    );
    return {
      checkpoint: checkpoint,
      input: checkpoint.input || {},
      meta: checkpoint.meta || {}
    };
  }

  function sourceOperationProvenance_(load, operations) {
    var sourceOperationId = String(
      load && load.operation_id || ''
    );
    var baseEvidence = {
      sourceOperationId: sourceOperationId,
      targetLoadId: String(load && load.load_id || '')
    };

    if (!sourceOperationId) {
      baseEvidence.state = 'SOURCE_OPERATION_ID_MISSING';
      return {
        traceable: false,
        protected: false,
        operationId: '',
        operationType: '',
        operationStatus: '',
        idempotencyKey: '',
        markerMatches: [],
        fingerprint: AKORT.Core.sha256(
          AKORT.Core.canonicalJson(baseEvidence)
        ),
        blockers: [{
          code: 'BETA12_SOURCE_OPERATION_ID_MISSING'
        }]
      };
    }

    var matches = (operations || []).filter(function (operation) {
      return String(operation.operation_id || '') ===
        sourceOperationId;
    });
    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA12_SOURCE_OPERATION_CONFLICT',
        'More than one source operation has the selected operation_id.',
        {
          retryable: false,
          sourceOperationId: sourceOperationId,
          matchCount: matches.length
        }
      );
    }
    if (!matches.length) {
      baseEvidence.state = 'SOURCE_OPERATION_NOT_FOUND';
      return {
        traceable: false,
        protected: false,
        operationId: sourceOperationId,
        operationType: '',
        operationStatus: '',
        idempotencyKey: '',
        markerMatches: [],
        fingerprint: AKORT.Core.sha256(
          AKORT.Core.canonicalJson(baseEvidence)
        ),
        blockers: [{
          code: 'BETA12_SOURCE_OPERATION_NOT_FOUND',
          operationId: sourceOperationId
        }]
      };
    }

    var operation = matches[0];
    var parsed = checkpointInput_(operation);
    var checkpoint = parsed.checkpoint;
    var handlerState = checkpoint.handlerState || {};
    var parseState = handlerState.parse || {};
    var evidence = {
      sourceOperationId: sourceOperationId,
      operationType: String(operation.operation_type || ''),
      operationStatus: String(operation.status || ''),
      createdBy: String(operation.created_by || ''),
      releaseVersion: String(operation.release_version || ''),
      idempotencyKey: String(parsed.meta.idempotencyKey || ''),
      input: parsed.input || {},
      handlerFile: handlerState.file || {},
      handlerProfile: handlerState.profile || {},
      parseProfile: parseState.profile || {},
      resolvedOptions: handlerState.resolvedOptions || {},
      sourceHash: String(handlerState.sourceHash || '')
    };
    var evidenceJson = AKORT.Core.canonicalJson(evidence);
    var markerMatches = protectedMarkerMatches_(evidenceJson);
    var blockers = [];

    if (String(operation.status || '') !== 'SUCCESS') {
      blockers.push({
        code: 'BETA12_SOURCE_OPERATION_NOT_SUCCESS',
        operationId: sourceOperationId,
        operationStatus: String(operation.status || '')
      });
    }
    if (String(operation.operation_type || '') === OPERATION_TYPE) {
      blockers.push({
        code: 'BETA12_REVERSAL_LOAD_INELIGIBLE',
        operationId: sourceOperationId
      });
    }
    if (markerMatches.length) {
      blockers.push({
        code: 'BETA12_ACCEPTANCE_EVIDENCE_PROTECTED',
        provenance: 'SOURCE_OPERATION',
        operationId: sourceOperationId,
        markerMatches: markerMatches
      });
    }

    return {
      traceable: true,
      protected: markerMatches.length > 0,
      operationId: sourceOperationId,
      operationType: String(operation.operation_type || ''),
      operationStatus: String(operation.status || ''),
      idempotencyKey: String(parsed.meta.idempotencyKey || ''),
      markerMatches: markerMatches,
      fingerprint: AKORT.Core.sha256(evidenceJson),
      blockers: blockers
    };
  }

  function activeReversal_(operations, targetLoadId) {
    for (var i = 0; i < operations.length; i += 1) {
      var operation = operations[i];
      if (String(operation.operation_type || '') !== OPERATION_TYPE) {
        continue;
      }
      if (TERMINAL[String(operation.status || '')]) continue;
      var parsed = checkpointInput_(operation);
      if (String(parsed.input.targetLoadId || '') ===
          String(targetLoadId || '')) {
        return operation;
      }
    }
    return null;
  }

  function reversedLoadIds_(loads) {
    var result = {};
    loads.forEach(function (load) {
      if (String(load.status || '') === 'REVERSED') {
        result[String(load.load_id || '')] = true;
      }
    });
    return result;
  }

  function rawHistory_(targetTable, rows) {
    var byKey = {};
    rows.forEach(function (row) {
      var key = AKORT.RawStore.businessKey(targetTable, row);
      byKey[key] = byKey[key] || [];
      byKey[key].push(row);
    });
    Object.keys(byKey).forEach(function (key) {
      byKey[key].sort(function (a, b) {
        return Number(a.version_no || 0) -
            Number(b.version_no || 0) ||
          Number(a.__row || 0) - Number(b.__row || 0);
      });
    });
    return byKey;
  }

  function buildEligibility_(
      load, targetRows, allRows, loads, reversalRows, operations) {
    var blockers = [];
    var targetLoadId = String(load && load.load_id || '');
    var targetTable = String(load && load.target_table || '');
    var active = activeReversal_(operations, targetLoadId);

    if (String(load && load.status || '') !== 'COMMITTED') {
      blockers.push({
        code: 'BETA12_LOAD_STATUS_INELIGIBLE',
        status: String(load && load.status || '')
      });
    }
    if (!targetRows.length) {
      blockers.push({ code: 'BETA12_TARGET_ROWS_EMPTY' });
    }
    if (protectedLoad_(load)) {
      blockers.push({
        code: 'BETA12_ACCEPTANCE_EVIDENCE_PROTECTED'
      });
    }
    if (reversalRows.length) {
      blockers.push({
        code: 'BETA12_EXISTING_REVERSAL_LOG',
        reversalRecordCount: reversalRows.length
      });
    }
    if (active) {
      blockers.push({
        code: 'BETA12_ACTIVE_REVERSAL_EXISTS',
        operationId: String(active.operation_id || ''),
        operationStatus: String(active.status || '')
      });
    }

    var reversed = reversedLoadIds_(loads);
    var history = rawHistory_(targetTable, allRows);
    var seenObservation = {};
    var conflicts = [];
    var predecessors = [];

    targetRows.forEach(function (target) {
      var observationId = String(target.observation_id || '');
      if (!observationId || seenObservation[observationId]) {
        blockers.push({
          code: 'BETA12_TARGET_OBSERVATION_ID_INVALID',
          observationId: observationId
        });
        return;
      }
      seenObservation[observationId] = true;
      var key = AKORT.RawStore.businessKey(targetTable, target);
      var rows = history[key] || [];
      var later = rows.filter(function (candidate) {
        return Number(candidate.version_no || 0) >
            Number(target.version_no || 0) &&
          !reversed[String(candidate.load_id || '')];
      });
      if (later.length) {
        conflicts.push({
          businessKey: key,
          targetObservationId: observationId,
          laterObservationIds: later.map(function (row) {
            return String(row.observation_id || '');
          })
        });
      }
      var predecessor = rows.filter(function (candidate) {
        return Number(candidate.version_no || 0) <
            Number(target.version_no || 0) &&
          !reversed[String(candidate.load_id || '')];
      }).sort(function (a, b) {
        return Number(b.version_no || 0) -
            Number(a.version_no || 0) ||
          Number(b.__row || 0) - Number(a.__row || 0);
      })[0] || null;
      predecessors.push({
        businessKey: key,
        target: target,
        restored: predecessor
      });
    });

    if (conflicts.length) {
      blockers.push({
        code: 'BETA12_LATER_ACTIVE_REVISION_EXISTS',
        conflictCount: conflicts.length,
        conflicts: conflicts.slice(0, 20)
      });
    }

    return {
      eligible: blockers.length === 0,
      blockers: blockers,
      activeOperationId: active ?
        String(active.operation_id || '') : '',
      predecessors: predecessors,
      laterConflictCount: conflicts.length
    };
  }

  function previewData_(targetLoadId, reason) {
    AKORT.EnvironmentGuard.assertDev();
    var normalizedReason = normalizeReason_(reason);
    var id = String(targetLoadId || '').trim();
    if (!id) {
      throw AKORT.Core.error(
        'BETA12_TARGET_LOAD_REQUIRED',
        'A target RAW load_id is required.',
        { retryable: false }
      );
    }

    var spreadsheet = getDwh_();
    var loads = readObjects_(spreadsheet, 'RAW_LOAD_REGISTRY');
    var load = findOne_(loads, 'load_id', id);
    if (!load) {
      throw AKORT.Core.error(
        'BETA12_TARGET_LOAD_NOT_FOUND',
        'The selected RAW load_id was not found.',
        { retryable: false, targetLoadId: id }
      );
    }

    var targetTable = String(load.target_table || '');
    var specs = AKORT.RawStore.Specs || {};
    if (!specs[targetTable]) {
      throw AKORT.Core.error(
        'BETA12_TARGET_TABLE_UNSUPPORTED',
        'The selected load uses an unsupported RAW target.',
        { retryable: false, targetTable: targetTable }
      );
    }

    var allRows = readObjects_(spreadsheet, targetTable);
    var targetRows = allRows.filter(function (row) {
      return String(row.load_id || '') === id;
    });
    var reversalRows = readObjects_(
      spreadsheet, 'RAW_REVERSAL_LOG'
    ).filter(function (row) {
      return String(row.target_load_id || '') === id;
    });
    var operations = readObjects_(spreadsheet, 'OPERATION_QUEUE');
    var sourceProvenance = sourceOperationProvenance_(
      load, operations
    );
    var eligibility = buildEligibility_(
      load,
      targetRows,
      allRows,
      loads,
      reversalRows,
      operations
    );
    if (sourceProvenance.blockers.length) {
      eligibility.blockers = eligibility.blockers.concat(
        sourceProvenance.blockers
      );
      eligibility.eligible = false;
    }

    var reasonHash = AKORT.Core.sha256(normalizedReason);
    var lineageRows = eligibility.predecessors.map(function (item) {
      return {
        businessKey: item.businessKey,
        targetObservationId:
          String(item.target.observation_id || ''),
        targetVersion: Number(item.target.version_no || 0),
        targetLoadId: String(item.target.load_id || ''),
        restoredObservationId: item.restored ?
          String(item.restored.observation_id || '') : '',
        restoredVersion: item.restored ?
          Number(item.restored.version_no || 0) : 0,
        restoredLoadId: item.restored ?
          String(item.restored.load_id || '') : ''
      };
    }).sort(function (a, b) {
      return a.businessKey.localeCompare(b.businessKey);
    });
    var lineageFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(lineageRows)
    );

    var syntheticRecords = eligibility.predecessors.map(
      function (item) {
        return {
          target_load_id: id,
          target_table: targetTable,
          business_key: item.businessKey,
          reversed_observation_id:
            String(item.target.observation_id || ''),
          restored_observation_id: item.restored ?
            String(item.restored.observation_id || '') : '',
          status: 'PREVIEW'
        };
      }
    );
    var previewReversalLoadId = 'LOAD_BETA12_PREVIEW_' +
      AKORT.Core.sha256(id).slice(0, 24).toUpperCase();
    var impactPlan = AKORT.IncrementalPublish.planReversal({
      targetLoadId: id,
      reversalLoadId: previewReversalLoadId,
      records: syntheticRecords
    });
    var impactSummary =
      AKORT.IncrementalPublish.summarizePlan(impactPlan);
    var impactFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson({
        summary: impactSummary,
        weekly: impactPlan.weekly || [],
        monthly: impactPlan.monthly || [],
        industrySeries: impactPlan.industrySeries || [],
        aggregateKeys: (impactPlan.aggregates || []).map(
          function (item) {
            return AKORT.Core.canonicalJson(item);
          }
        ).sort()
      })
    );

    var restoredRowCount = lineageRows.filter(function (row) {
      return !!row.restoredObservationId;
    }).length;
    var binding = {
      targetLoadId: id,
      targetTable: targetTable,
      loadStatus: String(load.status || ''),
      sourceHash: String(load.source_hash || ''),
      targetRowCount: targetRows.length,
      restoredRowCount: restoredRowCount,
      unrestoredRowCount:
        targetRows.length - restoredRowCount,
      impactFingerprint: impactFingerprint,
      lineageFingerprint: lineageFingerprint,
      sourceOperationFingerprint: sourceProvenance.fingerprint,
      reasonHash: reasonHash
    };
    var token = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(binding)
    );

    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      targetLoad: {
        loadId: id,
        operationId: String(load.operation_id || ''),
        sourceId: String(load.source_id || ''),
        sourceName: String(load.source_name || ''),
        sourceHash: String(load.source_hash || ''),
        targetTable: targetTable,
        status: String(load.status || ''),
        rowsInserted: Number(load.rows_inserted || 0),
        rowsRevised: Number(load.rows_revised || 0),
        rowsUnchanged: Number(load.rows_unchanged || 0),
        finishedAt: load.finished_at || ''
      },
      eligibility: {
        eligible: eligibility.eligible,
        policy: 'LATEST_LOAD_ONLY',
        blockers: eligibility.blockers,
        activeOperationId: eligibility.activeOperationId,
        targetRowCount: targetRows.length,
        laterConflictCount:
          eligibility.laterConflictCount,
        sourceOperation: {
          traceable: sourceProvenance.traceable,
          protected: sourceProvenance.protected,
          operationId: sourceProvenance.operationId,
          operationType: sourceProvenance.operationType,
          operationStatus: sourceProvenance.operationStatus,
          idempotencyKey: sourceProvenance.idempotencyKey,
          markerMatches: sourceProvenance.markerMatches,
          fingerprint: sourceProvenance.fingerprint
        }
      },
      restoration: {
        restoredRowCount: restoredRowCount,
        unrestoredRowCount:
          targetRows.length - restoredRowCount
      },
      impact: impactSummary,
      fingerprints: {
        lineage: lineageFingerprint,
        impact: impactFingerprint,
        sourceOperation: sourceProvenance.fingerprint,
        reason: reasonHash
      },
      confirmationToken: token,
      reason: normalizedReason,
      writeBoundary: 'READ_ONLY',
      userPipelineEnabled: false,
      productionTouched: false
    };
  }

  function preview(targetLoadId, reason) {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_PREVIEW',
      function () {
        var data = previewData_(targetLoadId, reason);
        return AKORT.Result.success(
          data.eligibility.eligible ?
            'Rollback preview is eligible for explicit submission.' :
            'Rollback preview is blocked; no operation was enqueued.',
          data
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function statusData_(operationId) {
    AKORT.EnvironmentGuard.assertDev();
    var id = String(operationId || '').trim();
    if (!id) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_ID_REQUIRED',
        'A rollback operation_id is required.',
        { retryable: false }
      );
    }

    var spreadsheet = getDwh_();
    var operations = readObjects_(
      spreadsheet, 'OPERATION_QUEUE'
    );
    var operation = findOne_(
      operations, 'operation_id', id
    );
    if (!operation) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_NOT_FOUND',
        'The rollback operation was not found.',
        { retryable: false, operationId: id }
      );
    }
    if (String(operation.operation_type || '') !==
        OPERATION_TYPE) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_TYPE_INVALID',
        'The selected operation is not RAW_REVERSAL_V4.',
        {
          retryable: false,
          operationId: id,
          operationType:
            String(operation.operation_type || '')
        }
      );
    }

    var parsed = checkpointInput_(operation);
    var checkpoint = parsed.checkpoint;
    var input = parsed.input;
    var beta12 = input.beta12 || {};
    if (String(beta12.packageVersion || '').indexOf(
        '4.0.0-beta.1.2.') !== 0) {
      throw AKORT.Core.error(
        'BETA12_OPERATION_OWNERSHIP_INVALID',
        'The selected reversal was not submitted through Beta.1.2.',
        { retryable: false, operationId: id }
      );
    }

    var targetLoadId = String(input.targetLoadId || '');
    var loads = readObjects_(
      spreadsheet, 'RAW_LOAD_REGISTRY'
    );
    var targetLoad = findOne_(
      loads, 'load_id', targetLoadId
    );
    var reversalLog = readObjects_(
      spreadsheet, 'RAW_REVERSAL_LOG'
    ).filter(function (row) {
      return String(row.operation_id || '') === id &&
        String(row.target_load_id || '') ===
          targetLoadId &&
        String(row.status || '') === 'SUCCESS';
    });
    var rawState = checkpoint.rawStore || {};
    var reversalState = rawState.reversal || {};
    var reversalLoadId = String(
      reversalState.reversalLoadId ||
      rawState.loadId ||
      (reversalLog[0] &&
        reversalLog[0].reversal_load_id) ||
      ''
    );
    var reversalLoad = reversalLoadId ?
      findOne_(loads, 'load_id', reversalLoadId) : null;
    var completed = checkpoint.completedPhases || [];
    var aggregate = checkpoint.aggregate || {};
    var operationStatus = String(operation.status || '');
    var nextAction = 'RUN_OR_RESUBMIT';

    if (operationStatus === 'SUCCESS') {
      nextAction = 'NONE';
    } else if (
      operationStatus === 'PAUSED' ||
      operationStatus === 'RETRY_PENDING' ||
      operationStatus === 'QUEUED'
    ) {
      nextAction = 'RESUBMIT_SAME_CONFIRMED_REQUEST';
    } else if (operationStatus === 'RUNNING') {
      nextAction = 'CHECK_STATUS';
    } else if (
      operationStatus === 'FAILED_REQUIRES_REVIEW'
    ) {
      nextAction = 'MANUAL_REVIEW';
    } else if (operationStatus === 'FAILED') {
      nextAction = 'RECOVERY_REVIEW';
    } else if (operationStatus === 'DEAD_LETTER') {
      nextAction = 'DEAD_LETTER_REVIEW';
    } else if (operationStatus === 'CANCELLED') {
      nextAction = 'NONE';
    }

    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      operation: {
        operationId: id,
        operationType:
          String(operation.operation_type || ''),
        status: operationStatus,
        currentPhase:
          String(operation.current_phase || ''),
        requestedAt: operation.requested_at || '',
        startedAt: operation.started_at || '',
        finishedAt: operation.finished_at || '',
        attemptNo: Number(operation.attempt_no || 0),
        maxAttempts: Number(operation.max_attempts || 0),
        errorCode: String(operation.error_code || ''),
        errorMessage:
          String(operation.error_message || ''),
        terminal: !!TERMINAL[operationStatus]
      },
      target: {
        loadId: targetLoadId,
        status: targetLoad ?
          String(targetLoad.status || '') : '',
        targetTable: targetLoad ?
          String(targetLoad.target_table || '') : ''
      },
      reversal: {
        loadId: reversalLoadId,
        loadStatus: reversalLoad ?
          String(reversalLoad.status || '') : '',
        durableRecordCount: reversalLog.length,
        expectedRows: Number(
          reversalState.recordCount ||
          reversalState.reversedRows ||
          rawState.reversalWork &&
            rawState.reversalWork.totalRows ||
          targetLoad && targetLoad.rows_reversed ||
          0
        )
      },
      dependencies: {
        publishComplete:
          completed.indexOf('UPDATE_PUBLISH') >= 0,
        aggregateStatus:
          String(aggregate.status || 'NOT_STARTED'),
        aggregateUpdateComplete:
          completed.indexOf('UPDATING_AGGREGATES') >= 0,
        aggregateLatestComplete:
          completed.indexOf(
            'UPDATING_AGGREGATE_LATEST'
          ) >= 0,
        aggregateReconciliationComplete:
          completed.indexOf(
            'RECONCILING_AGGREGATES'
          ) >= 0,
        quickAuditComplete:
          completed.indexOf('QUICK_AUDIT') >= 0
      },
      confirmation: {
        token:
          String(beta12.confirmationToken || ''),
        lineageFingerprint:
          String(beta12.lineageFingerprint || ''),
        impactFingerprint:
          String(beta12.impactFingerprint || ''),
        reasonHash:
          String(beta12.reasonHash || ''),
        idempotencyKey:
          String(parsed.meta.idempotencyKey || '')
      },
      nextAction: nextAction,
      userPipelineEnabled: false,
      productionTouched: false
    };
  }

  function status(operationId) {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_STATUS',
      function () {
        return AKORT.Result.success(
          'Beta.1.2 compact rollback status loaded.',
          statusData_(operationId)
        );
      },
      {
        lock: false,
        persistLogs: false,
        operationId: operationId
      }
    );
  }

  function findExistingSubmissionInRows_(
      operations, targetLoadId, normalizedReason,
      confirmationToken) {
    var provided = String(
      confirmationToken || ''
    ).trim();
    if (!provided) return null;

    var expectedKey =
      'BETA12_ROLLBACK_' + provided;
    var expectedTarget =
      String(targetLoadId || '').trim();
    var expectedReasonHash =
      AKORT.Core.sha256(normalizedReason);
    var matches = [];

    (operations || []).forEach(function (operation) {
      if (String(operation.operation_type || '') !==
          OPERATION_TYPE) {
        return;
      }
      var parsed = checkpointInput_(operation);
      var actualKey =
        String(parsed.meta.idempotencyKey || '');
      if (actualKey === expectedKey) {
        matches.push({
          operation: operation,
          parsed: parsed
        });
      }
    });

    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA12_IDEMPOTENCY_CONFLICT',
        'More than one rollback operation uses the confirmation token.',
        {
          retryable: false,
          confirmationToken: provided,
          operationIds: matches.map(function (match) {
            return String(
              match.operation.operation_id || ''
            );
          })
        }
      );
    }
    if (!matches.length) return null;

    var match = matches[0];
    var input = match.parsed.input;
    var beta12 = input.beta12 || {};
    var actualToken =
      String(beta12.confirmationToken || '');
    var actualTarget =
      String(input.targetLoadId || '');
    var actualReasonHash =
      String(beta12.reasonHash || '');

    if (
      actualToken !== provided ||
      actualTarget !== expectedTarget ||
      actualReasonHash !== expectedReasonHash
    ) {
      throw AKORT.Core.error(
        'BETA12_EXISTING_SUBMISSION_MISMATCH',
        'An existing idempotent rollback operation does not match the request.',
        {
          retryable: false,
          operationId: String(
            match.operation.operation_id || ''
          ),
          tokenMatches: actualToken === provided,
          targetMatches: actualTarget === expectedTarget,
          reasonMatches:
            actualReasonHash === expectedReasonHash
        }
      );
    }

    return {
      operationId: String(
        match.operation.operation_id || ''
      ),
      operationStatus:
        String(match.operation.status || ''),
      idempotencyKey: expectedKey
    };
  }

  function findExistingSubmission_(
      targetLoadId, normalizedReason,
      confirmationToken) {
    var spreadsheet = getDwh_();
    var operations = readObjects_(
      spreadsheet, 'OPERATION_QUEUE'
    );
    return findExistingSubmissionInRows_(
      operations,
      targetLoadId,
      normalizedReason,
      confirmationToken
    );
  }

  function submissionResult_(
      compact, runResult, metadata) {
    compact.submission = clone_(metadata || {});
    var operationStatus =
      String(compact.operation.status || '');

    if (operationStatus === 'SUCCESS') {
      return AKORT.Result.success(
        compact.submission.adoptedExisting ?
          'Existing rollback operation is already complete.' :
          'Rollback completed through RAW_REVERSAL_V4.',
        compact
      );
    }

    if (
      operationStatus === 'FAILED' ||
      operationStatus === 'FAILED_REQUIRES_REVIEW' ||
      operationStatus === 'DEAD_LETTER' ||
      operationStatus === 'CANCELLED'
    ) {
      return AKORT.Result.failure(
        compact.operation.errorCode ||
          (runResult && runResult.code) ||
          'BETA12_ROLLBACK_TERMINAL_FAILURE',
        compact.operation.errorMessage ||
          (runResult && runResult.message) ||
          'Rollback operation ended in a terminal non-success status.',
        compact
      );
    }

    if (runResult && runResult.ok === false) {
      return AKORT.Result.failure(
        runResult.code ||
          'BETA12_OPERATION_RUN_FAILED',
        runResult.message ||
          'Operation Engine invocation failed.',
        compact
      );
    }

    return AKORT.Result.paused(
      compact.submission.adoptedExisting ?
        'Existing rollback operation remains resumable.' :
        'Rollback operation was submitted and remains resumable.',
      compact
    );
  }

  function runExistingSubmission_(existing) {
    var runResult = AKORT.OperationEngine.run(
      existing.operationId,
      { maxSteps: 50 }
    );
    var compact =
      statusData_(existing.operationId);
    return submissionResult_(
      compact,
      runResult,
      {
        reused: true,
        adoptedExisting: true,
        runOk: !!(runResult && runResult.ok),
        runStatus:
          String(runResult && runResult.status || ''),
        idempotencyKey:
          existing.idempotencyKey
      }
    );
  }

  function submit(
      targetLoadId, reason, confirmationToken) {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_SUBMIT',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var normalizedReason =
          normalizeReason_(reason);
        var provided =
          String(confirmationToken || '').trim();

        if (!provided) {
          throw AKORT.Core.error(
            'BETA12_CONFIRMATION_TOKEN_INVALID',
            'Rollback confirmation token is required.',
            { retryable: false, providedToken: '' }
          );
        }

        var existing = findExistingSubmission_(
          targetLoadId,
          normalizedReason,
          provided
        );
        if (existing) {
          return runExistingSubmission_(existing);
        }

        var previewData = previewData_(
          targetLoadId,
          normalizedReason
        );
        if (!previewData.eligibility.eligible) {
          existing = findExistingSubmission_(
            targetLoadId,
            normalizedReason,
            provided
          );
          if (existing) {
            return runExistingSubmission_(existing);
          }
          throw AKORT.Core.error(
            'BETA12_ROLLBACK_INELIGIBLE',
            'The selected load is not eligible for rollback.',
            {
              retryable: false,
              blockers:
                previewData.eligibility.blockers
            }
          );
        }

        if (provided !==
            previewData.confirmationToken) {
          throw AKORT.Core.error(
            'BETA12_CONFIRMATION_TOKEN_INVALID',
            'Rollback confirmation token is stale or mismatched.',
            {
              retryable: false,
              expectedPreviewFingerprint:
                previewData.fingerprints.impact,
              providedToken: provided
            }
          );
        }

        var idempotencyKey =
          'BETA12_ROLLBACK_' + provided;
        var queued = AKORT.OperationEngine.enqueue(
          OPERATION_TYPE,
          {
            targetLoadId:
              previewData.targetLoad.loadId,
            reason: previewData.reason,
            beta12: {
              packageVersion: PACKAGE_VERSION,
              contractVersion: CONTRACT_VERSION,
              confirmationToken: provided,
              lineageFingerprint:
                previewData.fingerprints.lineage,
              impactFingerprint:
                previewData.fingerprints.impact,
              sourceOperationFingerprint:
                previewData.fingerprints.sourceOperation,
              reasonHash:
                previewData.fingerprints.reason,
              previewTargetRows:
                previewData.eligibility.targetRowCount,
              previewedAtSubmit:
                AKORT.Core.now()
            }
          },
          {
            idempotencyKey: idempotencyKey,
            priority: 50,
            maxAttempts: 24
          }
        );
        if (!queued || queued.ok === false) {
          return queued;
        }

        var operationId = String(
          queued.data &&
          queued.data.operationId || ''
        );
        if (!operationId) {
          throw AKORT.Core.error(
            'BETA12_ENQUEUE_RESULT_INVALID',
            'Operation Engine did not return an operation_id.',
            { retryable: false }
          );
        }

        var runResult = AKORT.OperationEngine.run(
          operationId,
          { maxSteps: 50 }
        );
        var compact = statusData_(operationId);
        return submissionResult_(
          compact,
          runResult,
          {
            reused: !!(
              queued.data && queued.data.reused
            ),
            adoptedExisting: !!(
              queued.data && queued.data.reused
            ),
            runOk: !!(
              runResult && runResult.ok
            ),
            runStatus: String(
              runResult && runResult.status || ''
            ),
            idempotencyKey: idempotencyKey
          }
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      operationType: OPERATION_TYPE,
      reasonMinimumCharacters: REASON_MIN,
      reasonMaximumCharacters: REASON_MAX,
      previewWrites: false,
      invalidCheckpointBehavior: 'FAIL_CLOSED',
      sourceOperationProvenance: 'REQUIRED_AND_BOUND',
      terminalFailureReportedAsSuccess: false,
      newQueue: false,
      newExecutor: false,
      createsTrigger: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    OperationType: OPERATION_TYPE,
    preview: preview,
    submit: submit,
    status: status,
    contract: contract,
    Test: Object.freeze({
      parseCheckpoint: parseCheckpoint_,
      normalizeReason: normalizeReason_,
      protectedLoad: protectedLoad_,
      sourceOperationProvenance:
        sourceOperationProvenance_,
      buildEligibility: buildEligibility_,
      findExistingSubmissionInRows:
        findExistingSubmissionInRows_,
      submissionResult: submissionResult_,
      confirmationToken: function (binding) {
        return AKORT.Core.sha256(
          AKORT.Core.canonicalJson(binding)
        );
      }
    })
  });
})();

function AKORT_beta12RollbackPreview(
    targetLoadId, reason) {
  var result =
    AKORT.Beta12RollbackFacade.preview(
      targetLoadId, reason
    );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackSubmit(
    targetLoadId, reason, confirmationToken) {
  var result =
    AKORT.Beta12RollbackFacade.submit(
      targetLoadId,
      reason,
      confirmationToken
    );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackStatus(operationId) {
  var result =
    AKORT.Beta12RollbackFacade.status(operationId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackContract() {
  var result = AKORT.Result.success(
    'Beta.1.2 rollback facade contract loaded.',
    AKORT.Beta12RollbackFacade.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}
