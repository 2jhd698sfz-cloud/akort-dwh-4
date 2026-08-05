var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.4 r2: trigger ownership registry, shared operation watchdog,
 * normalized next_action contract and guarded delegation to the accepted
 * Operation Engine.
 */
AKORT.Beta14OperationalHardening = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.4.2';
  var CONTRACT_VERSION = '4.0-beta14-operational-hardening-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = 'a32bdf1ddbb4975a1f905825c745c9004c6324fe';
  var REGISTRY = 'TRIGGER_OWNERSHIP_REGISTRY';
  var RESERVATION_PROPERTY = 'AKORT_BETA14_START_RESERVATION_V1';
  var RESERVATION_TTL_MS = 180000;

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
    return JSON.parse(JSON.stringify(
      value === undefined ? null : value
    ));
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

  function currentUser_() {
    try {
      return Session.getEffectiveUser().getEmail() || 'unknown';
    } catch (ignored) {
      return 'unknown';
    }
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA14_BASE_RELEASE_MISMATCH',
        'Beta.1.4 requires the accepted Alpha.7.4 runtime.',
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
        'Beta.1.4 cannot run after the general user pipeline is enabled.',
        { retryable: false }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function readTable_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA14_REQUIRED_TABLE_MISSING',
        'Required DEV service table is missing.',
        { table: name, retryable: false }
      );
    }
    var actual = sheet.getRange(
      1,
      1,
      1,
      Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    var expected = AKORT.Core.Tables[name] || [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error(
        'BETA14_SERVICE_SCHEMA_MISMATCH',
        'Service-table schema differs from the accepted contract.',
        {
          table: name,
          expected: expected,
          actual: actual,
          retryable: false
        }
      );
    }
    return {
      sheet: sheet,
      headers: expected.slice(),
      rows: AKORT.Core.Sheets.readObjects(sheet)
    };
  }

  function operationRows_() {
    return readTable_(dwh_(), 'OPERATION_QUEUE').rows;
  }

  function parseCheckpoint_(value) {
    if (value && typeof value === 'object') {
      return clone_(value);
    }
    if (value === '' || value === null || value === undefined) {
      return {
        __invalid: true,
        __error: 'CHECKPOINT_MISSING'
      };
    }
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
    var parsed = dateMs_(value);
    return parsed
      ? Math.max(0, Math.floor((nowMs - parsed) / 60000))
      : null;
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
    if (type === 'FULL_AUDIT_V4') {
      return 'SNAPSHOT_EXCLUSIVE';
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
    if (status === 'RUNNING') {
      return row.started_at || row.requested_at;
    }
    if (status === 'PAUSED' || status === 'RETRY_PENDING') {
      return row.started_at || row.requested_at;
    }
    return row.finished_at || row.started_at || row.requested_at;
  }

  function classifyOperation_(row, nowMs) {
    var checkpoint = parseCheckpoint_(row.checkpoint_json);
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
      stale = NON_TERMINAL[status] === true;
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
      checkpointInvalid: checkpoint.__invalid === true,
      checkpointError: text_(checkpoint.__error),
      checkpointPhase: text_(checkpoint.nextPhase),
      idempotencyKey: text_(
        checkpoint &&
        checkpoint.meta &&
        checkpoint.meta.idempotencyKey
      ),
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

  function operationInventory_() {
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
    return {
      total: operations.length,
      nonTerminalCount: nonTerminal.length,
      staleCount: stale.length,
      nonTerminal: nonTerminal,
      stale: stale,
      statusCounts: operations.reduce(function (counts, operation) {
        counts[operation.status] =
          Number(counts[operation.status] || 0) + 1;
        return counts;
      }, {}),
      operations: operations
    };
  }

  function conflictInventory_(operations) {
    var reservations = (operations || []).filter(function (operation) {
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
    if (unknown.length) {
      conflicts.push({
        code: 'UNKNOWN_OPERATION_CLASS_PRESENT',
        operationIds: unknown.map(function (operation) {
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
        : 'NONE'
    };
  }

  function triggerSnapshot_() {
    return ScriptApp.getProjectTriggers().map(function (trigger) {
      var eventType = '';
      var triggerSource = '';
      try {
        eventType = text_(trigger.getEventType());
      } catch (ignored) {}
      try {
        triggerSource = text_(trigger.getTriggerSource());
      } catch (ignored2) {}
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

  function triggerFingerprint_(processes, unregistered) {
    var identity = {
      processes: (processes || []).map(function (process) {
        return {
          processId: process.processId,
          ownerModule: process.ownerModule,
          handler: process.handler,
          lifecycle: process.lifecycle,
          expectedMinimum: process.expectedMinimum,
          expectedMaximum: process.expectedMaximum,
          observedCount: process.observedCount,
          status: process.status,
          nextAction: process.nextAction,
          triggers: process.triggers
        };
      }),
      unregisteredOwners: (unregistered || []).map(function (owner) {
        return {
          handler: owner.handler,
          observedCount: owner.observedCount,
          status: owner.status,
          nextAction: owner.nextAction,
          triggers: owner.triggers
        };
      })
    };
    return AKORT.Core.sha256(AKORT.Core.canonicalJson(identity));
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
      }) && unregistered.length === 0,
      fingerprint: triggerFingerprint_(processes, unregistered)
    };
  }

  function registryInspection_() {
    var spreadsheet = dwh_();
    var sheet = spreadsheet.getSheetByName(REGISTRY);
    var expected = AKORT.Core.Tables[REGISTRY] || [];
    if (!sheet) {
      return {
        status: 'ABSENT',
        schemaMatches: true,
        rows: 0,
        columns: 0,
        actualHeaders: [],
        expectedHeaders: expected.slice()
      };
    }
    var actual = sheet.getRange(
      1,
      1,
      1,
      Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    return {
      status: 'PRESENT',
      schemaMatches:
        JSON.stringify(actual) === JSON.stringify(expected),
      rows: Math.max(0, sheet.getLastRow() - 1),
      columns: sheet.getLastColumn(),
      actualHeaders: actual,
      expectedHeaders: expected.slice()
    };
  }

  function registryRowsFromInventory_(inventory, observedAt) {
    var rows = [];
    (inventory.processes || []).forEach(function (process) {
      rows.push({
        process_id: process.processId,
        owner_module: process.ownerModule,
        handler: process.handler,
        lifecycle: process.lifecycle,
        expected_minimum: process.expectedMinimum,
        expected_maximum: process.expectedMaximum,
        observed_count: process.observedCount,
        status: process.status,
        next_action: process.nextAction,
        trigger_ids_json: AKORT.Core.safeJson(
          process.triggers.map(function (trigger) {
            return trigger.triggerId;
          })
        ),
        event_types_json: AKORT.Core.safeJson(
          process.triggers.map(function (trigger) {
            return trigger.eventType;
          })
        ),
        trigger_sources_json: AKORT.Core.safeJson(
          process.triggers.map(function (trigger) {
            return trigger.triggerSource;
          })
        ),
        observed_at: observedAt,
        registry_fingerprint: inventory.fingerprint,
        release_version: AKORT.Release.version
      });
    });
    (inventory.unregisteredOwners || []).forEach(function (owner) {
      rows.push({
        process_id: 'UNREGISTERED_' +
          AKORT.Core.sha256(owner.handler).slice(0, 20).toUpperCase(),
        owner_module: '',
        handler: owner.handler,
        lifecycle: 'UNREGISTERED',
        expected_minimum: 0,
        expected_maximum: 0,
        observed_count: owner.observedCount,
        status: owner.status,
        next_action: owner.nextAction,
        trigger_ids_json: AKORT.Core.safeJson(
          owner.triggers.map(function (trigger) {
            return trigger.triggerId;
          })
        ),
        event_types_json: AKORT.Core.safeJson(
          owner.triggers.map(function (trigger) {
            return trigger.eventType;
          })
        ),
        trigger_sources_json: AKORT.Core.safeJson(
          owner.triggers.map(function (trigger) {
            return trigger.triggerSource;
          })
        ),
        observed_at: observedAt,
        registry_fingerprint: inventory.fingerprint,
        release_version: AKORT.Release.version
      });
    });
    return rows.sort(function (left, right) {
      return left.process_id.localeCompare(right.process_id);
    });
  }

  function writeRegistry_(inventory) {
    var table = readTable_(dwh_(), REGISTRY);
    var observedAt = AKORT.Core.now();
    var objects = registryRowsFromInventory_(
      inventory,
      observedAt
    );
    if (table.sheet.getLastRow() > 1) {
      table.sheet.getRange(
        2,
        1,
        table.sheet.getLastRow() - 1,
        table.headers.length
      ).clearContent();
    }
    if (objects.length) {
      var rows = objects.map(function (object) {
        return table.headers.map(function (header) {
          var value = object[header];
          return value === undefined || value === null ? '' : value;
        });
      });
      table.sheet.getRange(
        2,
        1,
        rows.length,
        table.headers.length
      ).setValues(rows);
    }
    return {
      rowCount: objects.length,
      observedAt: observedAt,
      fingerprint: inventory.fingerprint,
      healthy: inventory.healthy
    };
  }

  function registryState_(liveInventory) {
    var inspection = registryInspection_();
    if (inspection.status === 'ABSENT') {
      return {
        status: 'ABSENT',
        current: false,
        nextAction: 'INSTALL_REGISTRY',
        inspection: inspection,
        rows: []
      };
    }
    if (!inspection.schemaMatches) {
      return {
        status: 'SCHEMA_MISMATCH',
        current: false,
        nextAction: 'MANUAL_REVIEW',
        inspection: inspection,
        rows: []
      };
    }
    var table = readTable_(dwh_(), REGISTRY);
    var rows = table.rows.map(function (row) {
      var copy = clone_(row);
      delete copy.__row;
      return copy;
    });
    var fingerprints = {};
    rows.forEach(function (row) {
      fingerprints[text_(row.registry_fingerprint)] = true;
    });
    var values = Object.keys(fingerprints).filter(Boolean);
    if (values.length > 1) {
      return {
        status: 'FINGERPRINT_CONFLICT',
        current: false,
        nextAction: 'MANUAL_REVIEW',
        inspection: inspection,
        rows: rows
      };
    }
    var stored = values[0] || '';
    var current = stored &&
      stored === liveInventory.fingerprint &&
      rows.length ===
        liveInventory.processes.length +
        liveInventory.unregisteredOwners.length;
    return {
      status: current ? 'CURRENT' : 'STALE',
      current: current,
      nextAction: current ? 'NONE' : 'REFRESH_REGISTRY',
      storedFingerprint: stored,
      liveFingerprint: liveInventory.fingerprint,
      inspection: inspection,
      rows: rows
    };
  }

  function reservationState_() {
    var raw = PropertiesService.getScriptProperties()
      .getProperty(RESERVATION_PROPERTY);
    if (!raw) {
      return {
        status: 'ABSENT',
        active: false,
        stale: false,
        invalid: false,
        reservation: null
      };
    }
    var reservation;
    try {
      reservation = JSON.parse(raw);
    } catch (caught) {
      return {
        status: 'INVALID',
        active: true,
        stale: false,
        invalid: true,
        reservation: null,
        error: String(caught && caught.message || caught)
      };
    }
    var expiresMs = dateMs_(reservation.expiresAt);
    var active = expiresMs > Date.now();
    return {
      status: active ? 'ACTIVE' : 'EXPIRED',
      active: active,
      stale: !active,
      invalid: false,
      reservation: reservation
    };
  }

  function classesConflict_(requestedClass, activeClass) {
    if (requestedClass === 'CONTROL_PLANE_TEST' ||
        activeClass === 'CONTROL_PLANE_TEST') {
      return false;
    }
    if (requestedClass === 'UNKNOWN_OPERATION_CLASS' ||
        activeClass === 'UNKNOWN_OPERATION_CLASS') {
      return true;
    }
    if (requestedClass === 'SNAPSHOT_EXCLUSIVE') {
      return activeClass === 'SNAPSHOT_EXCLUSIVE' ||
        activeClass === 'DATA_PLANE_EXCLUSIVE';
    }
    if (requestedClass === 'DATA_PLANE_EXCLUSIVE') {
      return activeClass === 'SNAPSHOT_EXCLUSIVE' ||
        activeClass === 'DATA_PLANE_EXCLUSIVE';
    }
    return true;
  }

  function evaluateCanStart_(operationType, options) {
    assertBase_();
    options = options || {};
    var type = text_(operationType);
    var requestedClass = operationClass_(type);
    var idempotencyKey = text_(options.idempotencyKey);
    var inventory = operationInventory_();
    var blockers = [];
    var ignoredIdempotentOperations = [];

    if (requestedClass === 'UNKNOWN_OPERATION_CLASS') {
      blockers.push({
        code: 'BETA14_REQUESTED_OPERATION_CLASS_UNKNOWN',
        operationType: type,
        nextAction: 'MANUAL_REVIEW'
      });
    }

    inventory.nonTerminal.forEach(function (operation) {
      if (operation.checkpointInvalid) {
        blockers.push({
          code: 'BETA14_ACTIVE_CHECKPOINT_INVALID',
          operationId: operation.operationId,
          operationType: operation.operationType,
          nextAction: 'MANUAL_REVIEW'
        });
        return;
      }
      if (idempotencyKey &&
          operation.operationType === type &&
          operation.idempotencyKey === idempotencyKey) {
        ignoredIdempotentOperations.push(operation.operationId);
        return;
      }
      if (classesConflict_(
          requestedClass,
          operation.operationClass)) {
        blockers.push({
          code: 'BETA14_INCOMPATIBLE_OPERATION_ACTIVE',
          operationId: operation.operationId,
          operationType: operation.operationType,
          operationClass: operation.operationClass,
          status: operation.status,
          phase: operation.phase,
          stale: operation.stale,
          classification: operation.classification,
          nextAction: operation.nextAction
        });
      }
    });

    var reservation = reservationState_();
    if (reservation.invalid) {
      blockers.push({
        code: 'BETA14_START_RESERVATION_INVALID',
        nextAction: 'MANUAL_REVIEW'
      });
    } else if (reservation.active) {
      var active = reservation.reservation || {};
      if (classesConflict_(
          requestedClass,
          text_(active.operationClass))) {
        blockers.push({
          code: 'BETA14_START_RESERVATION_ACTIVE',
          reservationToken: text_(active.token),
          operationType: text_(active.operationType),
          operationClass: text_(active.operationClass),
          requester: text_(active.requester),
          expiresAt: text_(active.expiresAt),
          nextAction: 'WAIT_ACTIVE_LEASE'
        });
      }
    }

    var evidence = {
      allowed: blockers.length === 0,
      operationType: type,
      operationClass: requestedClass,
      idempotencyKey: idempotencyKey,
      requester: text_(options.requester),
      blockers: blockers,
      ignoredIdempotentOperations: ignoredIdempotentOperations,
      nonTerminalOperationCount: inventory.nonTerminalCount,
      reservation: reservation,
      reservationFingerprint: AKORT.Core.sha256(
        AKORT.Core.canonicalJson({
          operationType: type,
          operationClass: requestedClass,
          idempotencyKey: idempotencyKey,
          blockers: blockers,
          ignoredIdempotentOperations:
            ignoredIdempotentOperations
        })
      )
    };
    return evidence;
  }

  function assertCanStart(operationType, options) {
    var evidence = evaluateCanStart_(operationType, options);
    if (!evidence.allowed) {
      throw AKORT.Core.error(
        'BETA14_OPERATION_START_BLOCKED',
        'Operational hardening blocked an incompatible operation start.',
        {
          retryable: evidence.blockers.every(function (blocker) {
            return blocker.nextAction !== 'MANUAL_REVIEW';
          }),
          evidence: evidence
        }
      );
    }
    return evidence;
  }

  function reserveStart_(operationType, options) {
    options = options || {};
    return AKORT.Core.Locks.withScriptLock(
      'BETA14_START_RESERVATION',
      function () {
        var properties = PropertiesService.getScriptProperties();
        var state = reservationState_();
        if (state.invalid) {
          throw AKORT.Core.error(
            'BETA14_START_RESERVATION_INVALID',
            'The operational start reservation is invalid.',
            {
              retryable: false,
              nextAction: 'MANUAL_REVIEW'
            }
          );
        }
        if (state.stale) {
          properties.deleteProperty(RESERVATION_PROPERTY);
        }
        var evidence = assertCanStart(operationType, options);
        var nowMs = Date.now();
        var token = 'RSV_' +
          Utilities.getUuid().replace(/-/g, '').toUpperCase();
        var reservation = {
          schemaVersion: CONTRACT_VERSION,
          token: token,
          operationType: text_(operationType),
          operationClass: evidence.operationClass,
          idempotencyKey: text_(options.idempotencyKey),
          requester: text_(options.requester),
          createdAt: new Date(nowMs).toISOString(),
          expiresAt:
            new Date(nowMs + RESERVATION_TTL_MS).toISOString(),
          createdBy: currentUser_(),
          evidenceFingerprint: evidence.reservationFingerprint
        };
        properties.setProperty(
          RESERVATION_PROPERTY,
          AKORT.Core.safeJson(reservation)
        );
        return reservation;
      },
      30000
    );
  }

  function releaseStart_(token) {
    return AKORT.Core.Locks.withScriptLock(
      'BETA14_START_RESERVATION_RELEASE',
      function () {
        var properties = PropertiesService.getScriptProperties();
        var raw = properties.getProperty(RESERVATION_PROPERTY);
        if (!raw) return false;
        var reservation;
        try {
          reservation = JSON.parse(raw);
        } catch (ignored) {
          return false;
        }
        if (text_(reservation.token) !== text_(token)) {
          return false;
        }
        properties.deleteProperty(RESERVATION_PROPERTY);
        return true;
      },
      30000
    );
  }

  function enqueueGuarded(operationType, input, options) {
    options = options || {};
    if (!AKORT.OperationEngine ||
        typeof AKORT.OperationEngine.enqueue !== 'function') {
      throw AKORT.Core.error(
        'BETA14_OPERATION_ENGINE_UNAVAILABLE',
        'The accepted Operation Engine enqueue API is unavailable.',
        { retryable: false }
      );
    }
    var reservation = reserveStart_(
      operationType,
      {
        idempotencyKey: options.idempotencyKey || '',
        requester: options.requester ||
          ('GUARDED_' + text_(operationType))
      }
    );
    try {
      return AKORT.OperationEngine.enqueue(
        operationType,
        input,
        options
      );
    } finally {
      releaseStart_(reservation.token);
    }
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA14_HARDENING_PREFLIGHT',
      function () {
        assertBase_();
        var triggers = triggerInventory_();
        var operations = operationInventory_();
        var conflicts = conflictInventory_(
          operations.operations
        );
        var registry = registryInspection_();
        var reservation = reservationState_();
        var blockers = [];

        if (!triggers.healthy) {
          blockers.push('TRIGGER_OWNERSHIP_NOT_HEALTHY');
        }
        if (operations.nonTerminalCount) {
          blockers.push('NON_TERMINAL_OPERATION_EXISTS');
        }
        if (!conflicts.compatible) {
          blockers.push('INCOMPATIBLE_OPERATION_OVERLAP');
        }
        if (reservation.active || reservation.invalid) {
          blockers.push('START_RESERVATION_NOT_CLEAR');
        }
        if (registry.status === 'PRESENT' &&
            !registry.schemaMatches) {
          blockers.push('TRIGGER_REGISTRY_SCHEMA_MISMATCH');
        }
        if (!AKORT.Core.Tables[REGISTRY]) {
          blockers.push('TRIGGER_REGISTRY_CORE_CONTRACT_MISSING');
        }

        var data = {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          baseCommit: BASE_COMMIT,
          readyToInstall: blockers.length === 0,
          blockers: blockers,
          triggerInventory: triggers,
          operationInventory: {
            total: operations.total,
            nonTerminalCount: operations.nonTerminalCount,
            staleCount: operations.staleCount,
            nonTerminal: operations.nonTerminal,
            stale: operations.stale,
            statusCounts: operations.statusCounts
          },
          conflictInventory: conflicts,
          registry: registry,
          startReservation: reservation,
          writeBoundary: 'READ_ONLY',
          userPipelineEnabled: false,
          productionTouched: false
        };

        return blockers.length
          ? AKORT.Result.failure(
              'BETA14_HARDENING_PREFLIGHT_BLOCKED',
              'Beta.1.4 hardening preflight found blockers.',
              data
            )
          : AKORT.Result.success(
              'Beta.1.4 hardening preflight passed.',
              data
            );
      },
      { lock: false, persistLogs: false }
    );
  }

  function refreshRegistry_() {
    var inventory = triggerInventory_();
    var written = writeRegistry_(inventory);
    return {
      triggerInventory: inventory,
      registryWrite: written
    };
  }

  function install() {
    var checked = preflight();
    if (!checked.ok) return checked;

    /*
     * Core.install owns its own Script Lock. It must finish before the
     * Beta.1.4 installation lock is acquired; Apps Script locks are not
     * re-entrant.
     */
    var core = AKORT.Core.install();
    if (!core.ok) return core;

    return AKORT.Core.safeRun(
      'BETA14_HARDENING_INSTALL',
      function () {
        assertBase_();
        var refreshed = refreshRegistry_();
        return AKORT.Result.success(
          'Beta.1.4 operational hardening installed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            preflight: checked.data,
            coreInstallation: core.data,
            registry: refreshed,
            guardIntegration: [
              'AKORT.Beta11PairedBackup',
              'AKORT.Beta12RollbackFacade'
            ],
            createsTrigger: false,
            deletesTrigger: false,
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function refresh() {
    return AKORT.Core.safeRun(
      'BETA14_HARDENING_REFRESH',
      function () {
        assertBase_();
        var refreshed = refreshRegistry_();
        return AKORT.Result.success(
          'Beta.1.4 trigger ownership registry refreshed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            registry: refreshed,
            writeBoundary: 'TRIGGER_OWNERSHIP_REGISTRY_ONLY',
            createsTrigger: false,
            deletesTrigger: false,
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function status() {
    return AKORT.Core.safeRun(
      'BETA14_HARDENING_STATUS',
      function () {
        assertBase_();
        var triggers = triggerInventory_();
        var registry = registryState_(triggers);
        var operations = operationInventory_();
        var conflicts = conflictInventory_(
          operations.operations
        );
        var reservation = reservationState_();
        var blockers = [];

        if (!triggers.healthy) {
          blockers.push('TRIGGER_OWNERSHIP_NOT_HEALTHY');
        }
        if (!registry.current) {
          blockers.push('TRIGGER_REGISTRY_NOT_CURRENT');
        }
        if (operations.staleCount) {
          blockers.push('STALE_OPERATIONS_PRESENT');
        }
        if (!conflicts.compatible) {
          blockers.push('INCOMPATIBLE_OPERATION_OVERLAP');
        }
        if (reservation.active || reservation.invalid) {
          blockers.push('START_RESERVATION_NOT_CLEAR');
        }

        return AKORT.Result.success(
          'Beta.1.4 operational hardening status loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            triggerInventory: triggers,
            registry: registry,
            operationInventory: {
              total: operations.total,
              nonTerminalCount: operations.nonTerminalCount,
              staleCount: operations.staleCount,
              nonTerminal: operations.nonTerminal,
              stale: operations.stale,
              statusCounts: operations.statusCounts
            },
            conflictInventory: conflicts,
            startReservation: reservation,
            healthy: blockers.length === 0,
            blockers: blockers,
            normalizedNextActions: NEXT_ACTIONS.slice(),
            guardIntegration: [
              'AKORT.Beta11PairedBackup',
              'AKORT.Beta12RollbackFacade'
            ],
            writeBoundary: 'READ_ONLY',
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      registry: REGISTRY,
      reservationProperty: RESERVATION_PROPERTY,
      reservationTtlMs: RESERVATION_TTL_MS,
      triggerProcesses: clone_(TRIGGER_PROCESSES),
      staleThresholdMinutes: clone_(STALE_MINUTES),
      normalizedNextActions: NEXT_ACTIONS.slice(),
      operationClasses: {
        snapshotExclusive: ['BETA11_PAIRED_BACKUP', 'FULL_AUDIT_V4'],
        dataPlaneExclusive: [
          'SOURCE_FILE_LOAD_V4',
          'RAW_LOAD_V4',
          'RAW_REVERSAL_V4'
        ],
        controlPlaneTest: [
          'ALPHA3_TEST_*',
          'ALPHA3_DEMO_*'
        ]
      },
      guardIntegration: [
        'AKORT.Beta11PairedBackup',
        'AKORT.Beta12RollbackFacade'
      ],
      acceptedExecutor: 'AKORT.OperationEngine',
      newQueue: false,
      newExecutor: false,
      newDispatcher: false,
      operationEngineModified: false,
      createsTrigger: false,
      deletesTrigger: false,
      mutatesExistingOperation: false,
      dataPlaneWrite: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    Registry: REGISTRY,
    TriggerProcesses: clone_(TRIGGER_PROCESSES),
    NextActions: NEXT_ACTIONS.slice(),
    operationClass: operationClass_,
    classifyOperation: classifyOperation_,
    assertCanStart: assertCanStart,
    enqueueGuarded: enqueueGuarded,
    preflight: preflight,
    install: install,
    refresh: refresh,
    status: status,
    contract: contract,
    Test: Object.freeze({
      classesConflict: classesConflict_,
      processStatus: processStatus_,
      triggerFingerprint: triggerFingerprint_,
      evaluateCanStart: evaluateCanStart_,
      registryRowsFromInventory: registryRowsFromInventory_,
      conflictInventory: conflictInventory_
    })
  });
})();

function AKORT_beta14HardeningContract() {
  var result = AKORT.Result.success(
    'Beta.1.4 operational hardening contract loaded.',
    AKORT.Beta14OperationalHardening.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta14HardeningPreflight() {
  var result = AKORT.Beta14OperationalHardening.preflight();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta14HardeningInstall() {
  var result = AKORT.Beta14OperationalHardening.install();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta14HardeningRefresh() {
  var result = AKORT.Beta14OperationalHardening.refresh();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta14HardeningStatus() {
  var result = AKORT.Beta14OperationalHardening.status();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
