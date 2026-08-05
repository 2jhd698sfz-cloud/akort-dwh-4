var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.4 r1: read-only inventory for trigger ownership, stale operation
 * classification and incompatible-write overlap.
 */
AKORT.Beta14OperationalInventory = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.4.1';
  var CONTRACT_VERSION = '4.0-beta14-operational-inventory-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '1055d39229213e17b93faeced44dce57ea55346c';

  var STALE_MINUTES = {
    QUEUED: 15,
    RUNNING: 5,
    PAUSED: 1440,
    RETRY_PENDING: 30
  };

  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  var NON_TERMINAL = {
    QUEUED: true,
    RUNNING: true,
    PAUSED: true,
    RETRY_PENDING: true
  };

  var NEXT_ACTIONS = [
    'NONE',
    'RUN_FROM_QUEUE',
    'WAIT_ACTIVE_LEASE',
    'RESUME_FROM_CHECKPOINT',
    'RETRY_FROM_CHECKPOINT',
    'REVIEW_STOPPED_CHECKPOINT',
    'REVIEW_FAILED_OPERATION',
    'MANUAL_REVIEW',
    'REVIEW_DEAD_LETTER',
    'REVIEW_UNKNOWN_STATUS'
  ];

  var TRIGGER_PROCESSES = [
    {
      processId: 'BETA11_DAILY_BACKUP',
      ownerModule: 'AKORT.Beta11PairedBackup',
      handler: 'AKORT_beta11DailyBackupTrigger',
      lifecycle: 'REQUIRED',
      minimum: 1,
      maximum: 1
    },
    {
      processId: 'BETA11_BACKUP_WORKER',
      ownerModule: 'AKORT.Beta11PairedBackup',
      handler: 'AKORT_beta11BackupWorker',
      lifecycle: 'CONDITIONAL',
      minimum: 0,
      maximum: 1
    },
    {
      processId: 'ALPHA6_RECONCILIATION_DISPATCHER',
      ownerModule: 'AKORT.IncrementalPublish',
      handler: 'AKORT_alpha6ReconciliationDispatcherWorker',
      lifecycle: 'CLOSED_OR_DORMANT',
      minimum: 0,
      maximum: 0
    },
    {
      processId: 'ALPHA74_GATE6_WORKER',
      ownerModule: 'AKORT.Alpha74Gate6Acceptance',
      handler: 'AKORT_alpha74Gate6Worker',
      lifecycle: 'CLOSED',
      minimum: 0,
      maximum: 0
    },
    {
      processId: 'ALPHA74_GATE7_RUNNER',
      ownerModule: 'AKORT.Alpha74Gate7Runner',
      handler: 'AKORT_alpha74Gate7Worker',
      lifecycle: 'CLOSED',
      minimum: 0,
      maximum: 0
    }
  ];

  function clone_(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text_(value) {
    return value === null || value === undefined
      ? ''
      : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      String(value || '').toUpperCase() === 'TRUE';
  }

  function parseJson_(value) {
    if (value === '' || value === null || value === undefined) return {};
    if (typeof value === 'object') return clone_(value);
    try {
      return JSON.parse(String(value));
    } catch (caught) {
      return {
        __invalid: true,
        __error: String(caught && caught.message || caught)
      };
    }
  }

  function dateMs_(value) {
    var parsed = Date.parse(text_(value));
    return isNaN(parsed) ? 0 : parsed;
  }

  function ageMinutes_(value, nowMs) {
    var timestamp = dateMs_(value);
    return timestamp
      ? Math.max(0, Math.floor((nowMs - timestamp) / 60000))
      : null;
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA14_BASE_RELEASE_MISMATCH',
        'Beta.1.4 inventory requires the accepted Alpha.7.4 runtime.',
        {
          expected: BASE_RELEASE,
          actual: AKORT.Release.version,
          retryable: false
        }
      );
    }
    var settings = AKORT.Config.readSystemSettings();
    if (truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
      throw AKORT.Core.error(
        'BETA14_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Beta.1.4 inventory cannot run after the user pipeline is enabled.',
        { retryable: false }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function operationRows_() {
    var sheet = dwh_().getSheetByName('OPERATION_QUEUE');
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA14_OPERATION_QUEUE_MISSING',
        'OPERATION_QUEUE is missing.',
        { retryable: false }
      );
    }
    var actual = sheet.getRange(
      1,
      1,
      1,
      Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    var expected = AKORT.Core.Tables.OPERATION_QUEUE || [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error(
        'BETA14_OPERATION_QUEUE_SCHEMA_MISMATCH',
        'OPERATION_QUEUE schema differs from the accepted contract.',
        {
          expected: expected,
          actual: actual,
          retryable: false
        }
      );
    }
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function leaseState_(checkpoint, nowMs) {
    var lease = checkpoint && checkpoint.lease || null;
    if (!lease) {
      return {
        status: 'ABSENT',
        executionId: '',
        acquiredAt: '',
        expiresAt: '',
        active: false,
        expired: false
      };
    }
    var expiresMs = dateMs_(lease.expiresAt);
    return {
      status: expiresMs > nowMs ? 'ACTIVE' : 'EXPIRED',
      executionId: text_(lease.executionId),
      acquiredAt: text_(lease.acquiredAt),
      expiresAt: text_(lease.expiresAt),
      active: expiresMs > nowMs,
      expired: expiresMs > 0 && expiresMs <= nowMs
    };
  }

  function operationClass_(operationType) {
    var type = text_(operationType);
    if (type.indexOf('ALPHA3_TEST_') === 0 ||
        type.indexOf('ALPHA3_DEMO_') === 0) {
      return 'CONTROL_PLANE_TEST';
    }
    if (type === 'BETA11_PAIRED_BACKUP') {
      return 'SNAPSHOT_EXCLUSIVE';
    }
    if (type === 'SOURCE_FILE_LOAD_V4' ||
        type === 'RAW_LOAD_V4' ||
        type === 'RAW_REVERSAL_V4') {
      return 'DATA_PLANE_EXCLUSIVE';
    }
    return 'UNKNOWN_OPERATION_CLASS';
  }

  function operationReferenceTime_(row) {
    var status = text_(row.status);
    if (status === 'QUEUED') return row.requested_at;
    if (status === 'RUNNING') return row.started_at || row.requested_at;
    if (status === 'PAUSED' || status === 'RETRY_PENDING') {
      return row.started_at || row.requested_at;
    }
    return row.finished_at || row.started_at || row.requested_at;
  }

  function classifyOperation_(row, nowMs) {
    var checkpoint = parseJson_(row.checkpoint_json);
    var status = text_(row.status);
    var lease = leaseState_(checkpoint, nowMs);
    var age = ageMinutes_(operationReferenceTime_(row), nowMs);
    var stopRequested = Boolean(
      checkpoint &&
      checkpoint.control &&
      checkpoint.control.stopRequested === true
    );
    var staleLimit = STALE_MINUTES[status];
    var stale = staleLimit !== undefined &&
      age !== null &&
      age >= staleLimit;

    var classification = 'UNKNOWN_STATUS';
    var nextAction = 'REVIEW_UNKNOWN_STATUS';

    if (checkpoint.__invalid) {
      classification = 'INVALID_CHECKPOINT';
      nextAction = 'MANUAL_REVIEW';
    } else if (status === 'SUCCESS') {
      classification = 'TERMINAL_SUCCESS';
      nextAction = 'NONE';
    } else if (status === 'CANCELLED') {
      classification = 'TERMINAL_CANCELLED';
      nextAction = 'NONE';
    } else if (status === 'DEAD_LETTER') {
      classification = 'TERMINAL_DEAD_LETTER';
      nextAction = 'REVIEW_DEAD_LETTER';
    } else if (status === 'FAILED_REQUIRES_REVIEW') {
      classification = 'FAILED_REQUIRES_REVIEW';
      nextAction = 'MANUAL_REVIEW';
    } else if (status === 'FAILED') {
      classification = 'FAILED_OPERATION';
      nextAction = 'REVIEW_FAILED_OPERATION';
    } else if (status === 'QUEUED') {
      classification = stale ? 'STALE_QUEUED' : 'QUEUED_READY';
      nextAction = 'RUN_FROM_QUEUE';
    } else if (status === 'RUNNING' && lease.active) {
      classification = 'ACTIVE_RUNNING';
      nextAction = 'WAIT_ACTIVE_LEASE';
      stale = false;
    } else if (status === 'RUNNING') {
      classification = lease.expired
        ? 'STALE_RUNNING_EXPIRED_LEASE'
        : 'STALE_RUNNING_WITHOUT_LEASE';
      nextAction = 'RESUME_FROM_CHECKPOINT';
      stale = true;
    } else if (status === 'RETRY_PENDING') {
      classification = stale
        ? 'STALE_RETRY_PENDING'
        : 'RETRY_PENDING';
      nextAction = 'RETRY_FROM_CHECKPOINT';
    } else if (status === 'PAUSED' && stopRequested) {
      classification = stale
        ? 'STALE_STOPPED_CHECKPOINT'
        : 'STOPPED_AT_CHECKPOINT';
      nextAction = 'REVIEW_STOPPED_CHECKPOINT';
    } else if (status === 'PAUSED') {
      classification = stale ? 'STALE_PAUSED' : 'PAUSED_SAFE';
      nextAction = 'RESUME_FROM_CHECKPOINT';
    }

    return {
      operationId: text_(row.operation_id),
      operationType: text_(row.operation_type),
      operationClass: operationClass_(row.operation_type),
      status: status,
      phase: text_(row.current_phase),
      requestedAt: text_(row.requested_at),
      startedAt: text_(row.started_at),
      finishedAt: text_(row.finished_at),
      attemptNo: Number(row.attempt_no || 0),
      maxAttempts: Number(row.max_attempts || 0),
      errorCode: text_(row.error_code),
      checkpointSchemaVersion: text_(checkpoint.schemaVersion),
      checkpointPhase: text_(checkpoint.nextPhase),
      stopRequested: stopRequested,
      lease: lease,
      ageMinutes: age,
      staleThresholdMinutes:
        staleLimit === undefined ? null : staleLimit,
      stale: stale,
      classification: classification,
      nextAction: nextAction
    };
  }

  function triggerSnapshot_() {
    return ScriptApp.getProjectTriggers().map(function (trigger) {
      var eventType = '';
      var triggerSource = '';
      try { eventType = text_(trigger.getEventType()); } catch (ignored) {}
      try { triggerSource = text_(trigger.getTriggerSource()); } catch (ignored2) {}
      return {
        triggerId: text_(trigger.getUniqueId()),
        handler: text_(trigger.getHandlerFunction()),
        eventType: eventType,
        triggerSource: triggerSource
      };
    }).sort(function (left, right) {
      return (left.handler + '|' + left.triggerId)
        .localeCompare(right.handler + '|' + right.triggerId);
    });
  }

  function processStatus_(definition, triggers) {
    var matched = triggers.filter(function (trigger) {
      return trigger.handler === definition.handler;
    });
    var count = matched.length;
    var status = 'OK';
    var nextAction = 'NONE';

    if (count < definition.minimum) {
      status = 'MISSING_REQUIRED_TRIGGER';
      nextAction = 'RESTORE_REQUIRED_TRIGGER';
    } else if (count > definition.maximum &&
               definition.maximum === 0) {
      status = 'STALE_CLOSED_PROCESS_TRIGGER';
      nextAction = 'REMOVE_STALE_TRIGGER';
    } else if (count > definition.maximum) {
      status = 'DUPLICATE_TRIGGER_OWNER';
      nextAction = 'REMOVE_DUPLICATE_TRIGGERS';
    }

    return {
      processId: definition.processId,
      ownerModule: definition.ownerModule,
      handler: definition.handler,
      lifecycle: definition.lifecycle,
      expectedMinimum: definition.minimum,
      expectedMaximum: definition.maximum,
      observedCount: count,
      status: status,
      nextAction: nextAction,
      triggers: matched
    };
  }

  function triggerInventory_() {
    var triggers = triggerSnapshot_();
    var processes = TRIGGER_PROCESSES.map(function (definition) {
      return processStatus_(definition, triggers);
    });
    var known = {};
    TRIGGER_PROCESSES.forEach(function (definition) {
      known[definition.handler] = true;
    });
    var unknownByHandler = {};
    triggers.forEach(function (trigger) {
      if (known[trigger.handler]) return;
      unknownByHandler[trigger.handler] =
        unknownByHandler[trigger.handler] || [];
      unknownByHandler[trigger.handler].push(trigger);
    });
    var unregistered = Object.keys(unknownByHandler).sort()
      .map(function (handler) {
        return {
          handler: handler,
          observedCount: unknownByHandler[handler].length,
          status: 'UNREGISTERED_TRIGGER_OWNER',
          nextAction: 'REVIEW_TRIGGER_OWNER',
          triggers: unknownByHandler[handler]
        };
      });
    return {
      observedTriggerCount: triggers.length,
      processes: processes,
      unregisteredOwners: unregistered,
      healthy: processes.every(function (process) {
        return process.status === 'OK';
      }) && unregistered.length === 0
    };
  }

  function conflictInventory_(operations) {
    var reservations = operations.filter(function (operation) {
      return NON_TERMINAL[operation.status] === true &&
        operation.operationClass !== 'CONTROL_PLANE_TEST';
    });
    var snapshot = reservations.filter(function (operation) {
      return operation.operationClass === 'SNAPSHOT_EXCLUSIVE';
    });
    var dataPlane = reservations.filter(function (operation) {
      return operation.operationClass === 'DATA_PLANE_EXCLUSIVE';
    });
    var unknown = reservations.filter(function (operation) {
      return operation.operationClass === 'UNKNOWN_OPERATION_CLASS';
    });
    var conflicts = [];

    if (snapshot.length && dataPlane.length) {
      conflicts.push({
        code: 'SNAPSHOT_DATA_PLANE_OVERLAP',
        operationIds: snapshot.concat(dataPlane).map(function (operation) {
          return operation.operationId;
        })
      });
    }
    if (dataPlane.length > 1) {
      conflicts.push({
        code: 'MULTIPLE_DATA_PLANE_OPERATIONS',
        operationIds: dataPlane.map(function (operation) {
          return operation.operationId;
        })
      });
    }
    if (snapshot.length > 1) {
      conflicts.push({
        code: 'MULTIPLE_SNAPSHOT_OPERATIONS',
        operationIds: snapshot.map(function (operation) {
          return operation.operationId;
        })
      });
    }

    return {
      reservations: reservations,
      snapshotReservations: snapshot.length,
      dataPlaneReservations: dataPlane.length,
      unknownReservations: unknown.length,
      conflicts: conflicts,
      compatible: conflicts.length === 0,
      nextAction: conflicts.length
        ? 'REVIEW_OPERATION_CONFLICT'
        : unknown.length
          ? 'REVIEW_UNKNOWN_OPERATION_CLASS'
          : 'NONE'
    };
  }

  function contract() {
    return AKORT.Result.success(
      'Beta.1.4 operational inventory contract loaded.',
      {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        baseRelease: BASE_RELEASE,
        baseCommit: BASE_COMMIT,
        mode: 'READ_ONLY_RUNTIME_INVENTORY',
        triggerProcesses: clone_(TRIGGER_PROCESSES),
        staleThresholdMinutes: clone_(STALE_MINUTES),
        normalizedNextActions: NEXT_ACTIONS.slice(),
        newQueue: false,
        newExecutor: false,
        newDispatcher: false,
        createsTrigger: false,
        deletesTrigger: false,
        mutatesOperation: false,
        dataPlaneWrite: false,
        productionWrite: false,
        enablesUserPipeline: false
      }
    );
  }

  function inspect() {
    return AKORT.Core.safeRun(
      'BETA14_OPERATIONAL_INVENTORY',
      function () {
        assertBase_();
        var nowMs = Date.now();
        var operations = operationRows_().map(function (row) {
          return classifyOperation_(row, nowMs);
        });
        var nonTerminal = operations.filter(function (operation) {
          return NON_TERMINAL[operation.status] === true;
        });
        var stale = operations.filter(function (operation) {
          return operation.stale === true;
        });
        var triggers = triggerInventory_();
        var conflicts = conflictInventory_(operations);
        var blockers = [];

        if (!triggers.healthy) blockers.push('TRIGGER_OWNERSHIP_NOT_HEALTHY');
        if (stale.length) blockers.push('STALE_OPERATIONS_PRESENT');
        if (!conflicts.compatible) blockers.push('INCOMPATIBLE_OPERATION_OVERLAP');
        if (conflicts.unknownReservations) {
          blockers.push('UNKNOWN_OPERATION_CLASS_PRESENT');
        }

        return AKORT.Result.success(
          'Beta.1.4 operational inventory loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            observedAt: new Date(nowMs).toISOString(),
            triggerInventory: triggers,
            operationInventory: {
              total: operations.length,
              nonTerminalCount: nonTerminal.length,
              staleCount: stale.length,
              nonTerminal: nonTerminal,
              stale: stale,
              statusCounts: operations.reduce(function (counts, operation) {
                counts[operation.status] =
                  Number(counts[operation.status] || 0) + 1;
                return counts;
              }, {})
            },
            conflictInventory: conflicts,
            implementationReady: blockers.length === 0,
            blockers: blockers,
            exactRemainingGap: [
              'TRIGGER_OWNERSHIP_REGISTRY is not materialized.',
              'Shared watchdog classification is not materialized.',
              'Shared next_action is not materialized.',
              'Shared assertCanStart is not yet integrated.'
            ],
            writeBoundary: 'READ_ONLY',
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      {
        lock: false,
        persistLogs: false
      }
    );
  }

  return {
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    TriggerProcesses: clone_(TRIGGER_PROCESSES),
    StaleMinutes: clone_(STALE_MINUTES),
    NextActions: NEXT_ACTIONS.slice(),
    contract: contract,
    inspect: inspect,
    Test: {
      classifyOperation: classifyOperation_,
      operationClass: operationClass_,
      conflictInventory: conflictInventory_,
      processStatus: processStatus_
    }
  };
})();

function AKORT_beta14OperationalInventoryContract() {
  var result = AKORT.Beta14OperationalInventory.contract();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta14OperationalInventory() {
  var result = AKORT.Beta14OperationalInventory.inspect();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
