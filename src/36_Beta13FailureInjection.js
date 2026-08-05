var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.3 r1: controlled DEV-only failure probes over the accepted
 * Alpha.3 test handler and Operation Engine.
 */
AKORT.Beta13FailureInjection = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.3.1';
  var CONTRACT_VERSION = '4.0-beta13-failure-injection-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '9620d87939fae952606c96357dd3368c66265ca4';
  var OPERATION_PREFIX = 'ALPHA3_TEST_BETA13_';
  var PROPERTY_PREFIX = 'AKORT_BETA13_OPERATION_';

  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  var DATA_SHEETS = {
    DWH: [
      'RAW_PRICES_WEEKLY',
      'RAW_PRICES_MONTHLY',
      'RAW_INDUSTRY',
      'RAW_LOAD_REGISTRY',
      'RAW_REVERSAL_LOG',
      'AGGREGATE_STAGE'
    ],
    PUBLISH: [
      'PUBLISH_PRICES_WEEKLY',
      'PUBLISH_PRICES_MONTHLY',
      'PUBLISH_INDUSTRY',
      'PUBLISH_PRICE_AGGREGATES'
    ]
  };

  var SCENARIOS = {
    RETRYABLE_ONCE: {
      scenario: 'RETRYABLE_ONCE',
      operationType: OPERATION_PREFIX + 'RETRYABLE_ONCE',
      test: {
        failPhase: 'VALIDATE',
        failMode: 'RETRYABLE',
        failTimes: 1
      },
      maxAttempts: 3,
      preRunStop: false,
      firstStatus: 'RETRY_PENDING',
      terminalStatus: 'SUCCESS',
      continuation: 'RESUME'
    },
    FATAL_RECOVERY: {
      scenario: 'FATAL_RECOVERY',
      operationType: OPERATION_PREFIX + 'FATAL_RECOVERY',
      test: {
        failPhase: 'PARSE',
        failMode: 'FATAL',
        failTimes: 1
      },
      maxAttempts: 3,
      preRunStop: false,
      firstStatus: 'FAILED',
      terminalStatus: 'SUCCESS',
      continuation: 'EXACT_FAILED_PHASE_RECOVERY'
    },
    HANDLER_PAUSE: {
      scenario: 'HANDLER_PAUSE',
      operationType: OPERATION_PREFIX + 'HANDLER_PAUSE',
      test: {
        pauseAfterPhase: 'STAGE'
      },
      maxAttempts: 3,
      preRunStop: false,
      firstStatus: 'PAUSED',
      terminalStatus: 'SUCCESS',
      continuation: 'RESUME'
    },
    SAFE_STOP: {
      scenario: 'SAFE_STOP',
      operationType: OPERATION_PREFIX + 'SAFE_STOP',
      test: {},
      maxAttempts: 3,
      preRunStop: true,
      firstStatus: 'PAUSED',
      terminalStatus: 'SUCCESS',
      continuation: 'RESUME'
    },
    DEAD_LETTER: {
      scenario: 'DEAD_LETTER',
      operationType: OPERATION_PREFIX + 'DEAD_LETTER',
      test: {
        failPhase: 'DISCOVER',
        failMode: 'RETRYABLE',
        failTimes: 3
      },
      maxAttempts: 2,
      preRunStop: false,
      firstStatus: 'RETRY_PENDING',
      terminalStatus: 'DEAD_LETTER',
      continuation: 'RESUME_TO_DEAD_LETTER'
    }
  };

  function clone_(value) {
    return JSON.parse(JSON.stringify(
      value === undefined ? null : value
    ));
  }

  function normalizeScenario_(scenario) {
    var normalized = String(scenario || '')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
    if (!SCENARIOS[normalized]) {
      throw AKORT.Core.error(
        'BETA13_SCENARIO_UNSUPPORTED',
        'Unsupported Beta.1.3 failure-injection scenario.',
        {
          retryable: false,
          scenario: normalized,
          supportedScenarios: Object.keys(SCENARIOS)
        }
      );
    }
    return normalized;
  }

  function scenario_(scenario) {
    return clone_(SCENARIOS[normalizeScenario_(scenario)]);
  }

  function normalizeCell_(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return value.toISOString();
    }
    if (typeof value === 'number') {
      if (isNaN(value)) return 'NaN';
      if (!isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
      return value;
    }
    if (typeof value === 'boolean') return value;
    return String(value);
  }

  function normalizeValues_(values) {
    return (values || []).map(function (row) {
      return row.map(normalizeCell_);
    });
  }

  function requiredSheet_(spreadsheet, sheetName, resourceCode) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA13_SENTINEL_SHEET_MISSING',
        'A required data-plane sheet is missing.',
        {
          retryable: false,
          resourceCode: resourceCode,
          sheetName: sheetName
        }
      );
    }
    return sheet;
  }

  function edgeSheetSnapshot_(sheet, resourceCode) {
    var lastRow = Number(sheet.getLastRow() || 0);
    var lastColumn = Number(sheet.getLastColumn() || 0);
    var headers = [];
    var edges = [];

    if (lastRow > 0 && lastColumn > 0) {
      headers = normalizeValues_(
        sheet.getRange(1, 1, 1, lastColumn).getValues()
      )[0];

      var dataRows = Math.max(0, lastRow - 1);
      if (dataRows > 0) {
        if (dataRows <= 6) {
          edges = normalizeValues_(
            sheet.getRange(2, 1, dataRows, lastColumn).getValues()
          );
        } else {
          var head = normalizeValues_(
            sheet.getRange(2, 1, 3, lastColumn).getValues()
          );
          var tail = normalizeValues_(
            sheet.getRange(lastRow - 2, 1, 3, lastColumn).getValues()
          );
          edges = head.concat(tail);
        }
      }
    }

    var payload = {
      resourceCode: resourceCode,
      sheetName: sheet.getName(),
      sheetId: String(sheet.getSheetId()),
      lastRow: lastRow,
      lastColumn: lastColumn,
      headerFingerprint: AKORT.Core.sha256(
        AKORT.Core.canonicalJson(headers)
      ),
      edgeFingerprint: AKORT.Core.sha256(
        AKORT.Core.canonicalJson(edges)
      )
    };
    payload.fingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(payload)
    );
    return payload;
  }

  function resourceSnapshot_(resourceCode, spreadsheet, sheetNames) {
    var sheets = sheetNames.map(function (sheetName) {
      return edgeSheetSnapshot_(
        requiredSheet_(spreadsheet, sheetName, resourceCode),
        resourceCode
      );
    });
    sheets.sort(function (left, right) {
      return left.sheetName < right.sheetName ? -1 :
        left.sheetName > right.sheetName ? 1 : 0;
    });
    return {
      resourceCode: resourceCode,
      spreadsheetName: spreadsheet.getName(),
      sheets: sheets,
      fingerprint: AKORT.Core.sha256(
        AKORT.Core.canonicalJson(sheets)
      )
    };
  }

  function dataSentinel_() {
    AKORT.EnvironmentGuard.assertDev();
    var config = AKORT.Config.load({
      includeSystemSettings: false
    });
    var dwh = SpreadsheetApp.openById(
      config.resources.dwhSpreadsheetId
    );
    var publish = SpreadsheetApp.openById(
      config.resources.publishSpreadsheetId
    );
    var resources = [
      resourceSnapshot_('DWH', dwh, DATA_SHEETS.DWH),
      resourceSnapshot_('PUBLISH', publish, DATA_SHEETS.PUBLISH)
    ];
    return {
      schemaVersion: '4.0-beta13-data-sentinel-1',
      resources: resources,
      fingerprint: AKORT.Core.sha256(
        AKORT.Core.canonicalJson(resources)
      )
    };
  }

  function sheetMap_(sentinel) {
    var result = {};
    (sentinel && sentinel.resources || []).forEach(function (resource) {
      (resource.sheets || []).forEach(function (sheet) {
        result[
          String(resource.resourceCode) + '|' +
          String(sheet.sheetName)
        ] = sheet;
      });
    });
    return result;
  }

  function compareSentinels_(before, after) {
    var beforeMap = sheetMap_(before);
    var afterMap = sheetMap_(after);
    var keys = {};
    Object.keys(beforeMap).forEach(function (key) { keys[key] = true; });
    Object.keys(afterMap).forEach(function (key) { keys[key] = true; });
    var changes = [];

    Object.keys(keys).sort().forEach(function (key) {
      var left = beforeMap[key];
      var right = afterMap[key];
      if (!left || !right) {
        changes.push({
          key: key,
          change: !left ? 'ADDED' : 'MISSING'
        });
        return;
      }
      if (String(left.fingerprint) !== String(right.fingerprint)) {
        changes.push({
          key: key,
          change: 'CHANGED',
          beforeFingerprint: left.fingerprint,
          afterFingerprint: right.fingerprint,
          beforeRows: left.lastRow,
          afterRows: right.lastRow
        });
      }
    });

    return {
      unchanged:
        changes.length === 0 &&
        String(before && before.fingerprint || '') ===
          String(after && after.fingerprint || ''),
      beforeFingerprint:
        String(before && before.fingerprint || ''),
      afterFingerprint:
        String(after && after.fingerprint || ''),
      changes: changes
    };
  }

  function getDwh_() {
    var config = AKORT.Config.load({
      includeSystemSettings: false
    });
    return SpreadsheetApp.openById(
      config.resources.dwhSpreadsheetId
    );
  }

  function readObjects_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA13_REQUIRED_TABLE_MISSING',
        'Required Operation Engine table is missing.',
        {
          retryable: false,
          table: sheetName
        }
      );
    }
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function parseCheckpoint_(operation) {
    var value = operation && operation.checkpoint_json;
    if (value && typeof value === 'object') return clone_(value);
    if (value === '' || value === null || value === undefined) {
      throw AKORT.Core.error(
        'BETA13_OPERATION_CHECKPOINT_MISSING',
        'A Beta.1.3 operation has no checkpoint.',
        {
          retryable: false,
          operationId:
            String(operation && operation.operation_id || '')
        }
      );
    }
    try {
      return JSON.parse(String(value));
    } catch (caught) {
      throw AKORT.Core.error(
        'BETA13_OPERATION_CHECKPOINT_INVALID',
        'A Beta.1.3 operation checkpoint is invalid JSON.',
        {
          retryable: false,
          operationId:
            String(operation && operation.operation_id || ''),
          cause: String(caught)
        }
      );
    }
  }

  function activeOperations_(ignoreOperationId) {
    return readObjects_(getDwh_(), 'OPERATION_QUEUE')
      .filter(function (operation) {
        return !TERMINAL[String(operation.status || '')] &&
          String(operation.operation_id || '') !==
            String(ignoreOperationId || '');
      })
      .map(function (operation) {
        return {
          operationId: String(operation.operation_id || ''),
          operationType: String(operation.operation_type || ''),
          status: String(operation.status || ''),
          phase: String(operation.current_phase || '')
        };
      });
  }

  function safetyBlockers_(ignoreOperationId) {
    AKORT.EnvironmentGuard.assertDev();
    var settings = AKORT.Config.readSystemSettings();
    var blockers = [];
    var active = activeOperations_(ignoreOperationId);

    if (settings.OPERATION_TEST_MODE !== true) {
      blockers.push({
        code: 'BETA13_TEST_MODE_REQUIRED',
        actual: settings.OPERATION_TEST_MODE
      });
    }
    if (settings.PUBLISH_USER_PIPELINE_ENABLED === true) {
      blockers.push({
        code: 'BETA13_USER_PIPELINE_MUST_REMAIN_DISABLED'
      });
    }
    if (active.length) {
      blockers.push({
        code: 'BETA13_OTHER_ACTIVE_OPERATION',
        operations: active
      });
    }
    return blockers;
  }

  function binding_(definition, sentinel) {
    return {
      schemaVersion: '4.0-beta13-confirmation-1',
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      scenario: definition.scenario,
      operationType: definition.operationType,
      test: definition.test,
      maxAttempts: definition.maxAttempts,
      preRunStop: definition.preRunStop,
      sentinelFingerprint: sentinel.fingerprint
    };
  }

  function token_(binding) {
    return AKORT.Core.sha256(
      AKORT.Core.canonicalJson(binding)
    );
  }

  function findExisting_(definition, confirmationToken) {
    var rows = readObjects_(getDwh_(), 'OPERATION_QUEUE')
      .filter(function (operation) {
        return String(operation.operation_type || '') ===
          String(definition.operationType);
      });
    var matches = [];

    rows.forEach(function (operation) {
      var checkpoint = parseCheckpoint_(operation);
      var beta13 = checkpoint.input &&
        checkpoint.input.beta13 || {};
      if (
        String(beta13.confirmationToken || '') ===
        String(confirmationToken || '')
      ) {
        matches.push(operation);
      }
    });

    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA13_IDEMPOTENCY_CONFLICT',
        'More than one Beta.1.3 operation has the same confirmation token.',
        {
          retryable: false,
          scenario: definition.scenario,
          confirmationToken: confirmationToken,
          operationIds: matches.map(function (operation) {
            return String(operation.operation_id || '');
          })
        }
      );
    }
    return matches.length ? matches[0] : null;
  }

  function plan_(scenario, ignoreOperationId) {
    var definition = scenario_(scenario);
    var sentinel = dataSentinel_();
    var binding = binding_(definition, sentinel);
    var blockers = safetyBlockers_(ignoreOperationId);
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      scenario: definition.scenario,
      definition: definition,
      eligible: blockers.length === 0,
      blockers: blockers,
      sentinel: sentinel,
      binding: binding,
      confirmationToken: token_(binding)
    };
  }

  function engineResultSummary_(result) {
    return {
      ok: result && result.ok === true,
      status: String(result && result.status || ''),
      code: String(result && result.code || ''),
      message: String(result && result.message || '')
    };
  }

  function validateOperation_(operation, checkpoint) {
    var type = String(operation && operation.operation_type || '');
    if (type.indexOf(OPERATION_PREFIX) !== 0) {
      throw AKORT.Core.error(
        'BETA13_OPERATION_TYPE_INVALID',
        'The operation is not a Beta.1.3 failure probe.',
        {
          retryable: false,
          operationType: type
        }
      );
    }
    var beta13 = checkpoint && checkpoint.input &&
      checkpoint.input.beta13 || {};
    var definition = scenario_(beta13.scenario);
    if (
      String(definition.operationType) !== type ||
      String(beta13.contractVersion || '') !== CONTRACT_VERSION ||
      String(beta13.packageVersion || '') !== PACKAGE_VERSION
    ) {
      throw AKORT.Core.error(
        'BETA13_OPERATION_IDENTITY_MISMATCH',
        'The Beta.1.3 operation identity does not match the installed contract.',
        {
          retryable: false,
          operationType: type,
          scenario: beta13.scenario,
          packageVersion: beta13.packageVersion,
          contractVersion: beta13.contractVersion
        }
      );
    }
    return {
      beta13: beta13,
      definition: definition
    };
  }

  function nextAction_(definition, status) {
    if (status === definition.terminalStatus) return 'NONE';
    if (
      definition.scenario === 'FATAL_RECOVERY' &&
      status === 'FAILED'
    ) {
      return 'EXACT_FAILED_PHASE_RECOVERY';
    }
    if (
      status === 'PAUSED' ||
      status === 'RETRY_PENDING' ||
      status === 'QUEUED' ||
      status === 'RUNNING'
    ) {
      return 'CONTINUE';
    }
    return 'REVIEW';
  }

  function compactStatus_(operationId) {
    var result = AKORT.OperationEngine.status(operationId);
    if (!result || result.ok !== true) {
      throw AKORT.Core.error(
        result && result.code || 'BETA13_STATUS_FAILED',
        result && result.message ||
          'Could not load the Beta.1.3 operation status.',
        {
          retryable: false,
          engineResult: engineResultSummary_(result)
        }
      );
    }

    var operation = result.data.operation;
    var checkpoint = operation.checkpoint || {};
    var identity = validateOperation_(operation, checkpoint);
    var baseline = identity.beta13.sentinel;
    var current = dataSentinel_();
    var comparison = compareSentinels_(baseline, current);
    var calls = checkpoint.handlerState &&
      checkpoint.handlerState.calls || {};
    var steps = (result.data.steps || []).map(function (step) {
      return {
        phase: String(step.phase || ''),
        status: String(step.status || ''),
        attemptNo: Number(step.attempt_no || 0),
        errorCode: String(step.error_code || '')
      };
    });

    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      operationId: String(operation.operation_id || ''),
      operationType: String(operation.operation_type || ''),
      scenario: identity.definition.scenario,
      status: String(operation.status || ''),
      currentPhase: String(operation.current_phase || ''),
      attemptNo: Number(operation.attempt_no || 0),
      maxAttempts: Number(operation.max_attempts || 0),
      errorCode: String(operation.error_code || ''),
      errorMessage: String(operation.error_message || ''),
      expectedFirstStatus: identity.definition.firstStatus,
      expectedTerminalStatus: identity.definition.terminalStatus,
      completedPhases:
        (checkpoint.completedPhases || []).slice(),
      calls: clone_(calls),
      steps: steps,
      sentinel: comparison,
      noDataMutation: comparison.unchanged,
      nextAction: nextAction_(
        identity.definition,
        String(operation.status || '')
      )
    };
  }

  function resultForStatus_(message, compact) {
    if (!compact.noDataMutation) {
      return AKORT.Result.failure(
        'BETA13_DATA_SENTINEL_CHANGED',
        'A Beta.1.3 probe detected a data-plane sentinel change.',
        compact
      );
    }
    return AKORT.Result.success(message, compact);
  }

  function preview(scenario) {
    return AKORT.Core.safeRun(
      'BETA13_PREVIEW',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        return AKORT.Result.success(
          'Beta.1.3 failure-injection preview prepared.',
          plan_(scenario, '')
        );
      },
      {
        lock: false,
        persistLogs: false
      }
    );
  }

  function start(scenario, confirmationToken) {
    return AKORT.Core.safeRun(
      'BETA13_START',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var definition = scenario_(scenario);
        var preliminary = plan_(definition.scenario, '');
        var expectedToken = preliminary.confirmationToken;

        if (
          String(confirmationToken || '') !==
          String(expectedToken)
        ) {
          throw AKORT.Core.error(
            'BETA13_CONFIRMATION_TOKEN_INVALID',
            'The Beta.1.3 confirmation token does not match the current DEV state.',
            {
              retryable: false,
              scenario: definition.scenario,
              expectedToken: expectedToken,
              actualToken: String(confirmationToken || '')
            }
          );
        }

        var existing = findExisting_(
          definition,
          expectedToken
        );
        var operationId = existing ?
          String(existing.operation_id || '') : '';
        var finalPlan = plan_(
          definition.scenario,
          operationId
        );

        if (!finalPlan.eligible) {
          throw AKORT.Core.error(
            'BETA13_START_BLOCKED',
            'Beta.1.3 failure probe is blocked by DEV safety guards.',
            {
              retryable: false,
              scenario: definition.scenario,
              blockers: finalPlan.blockers
            }
          );
        }

        if (existing) {
          var existingStatus = compactStatus_(operationId);
          return resultForStatus_(
            'Existing idempotent Beta.1.3 operation returned.',
            existingStatus
          );
        }

        var queued = AKORT.OperationEngine.enqueue(
          definition.operationType,
          {
            test: clone_(definition.test),
            description:
              'Beta.1.3 controlled no-data failure probe',
            beta13: {
              schemaVersion: '4.0-beta13-operation-1',
              packageVersion: PACKAGE_VERSION,
              contractVersion: CONTRACT_VERSION,
              baseRelease: BASE_RELEASE,
              baseCommit: BASE_COMMIT,
              scenario: definition.scenario,
              confirmationToken: expectedToken,
              sentinel: finalPlan.sentinel,
              sentinelFingerprint:
                finalPlan.sentinel.fingerprint,
              expectedFirstStatus:
                definition.firstStatus,
              expectedTerminalStatus:
                definition.terminalStatus,
              createdAt: AKORT.Core.now()
            }
          },
          {
            idempotencyKey:
              'BETA13_' + definition.scenario + '_' +
              expectedToken,
            maxAttempts: definition.maxAttempts,
            priority: 80
          }
        );

        if (!queued || queued.ok !== true) {
          throw AKORT.Core.error(
            queued && queued.code ||
              'BETA13_ENQUEUE_FAILED',
            queued && queued.message ||
              'Could not enqueue the Beta.1.3 probe.',
            {
              retryable: false,
              engineResult: engineResultSummary_(queued)
            }
          );
        }

        operationId = String(queued.data.operationId || '');
        PropertiesService.getScriptProperties().setProperty(
          PROPERTY_PREFIX + definition.scenario,
          operationId
        );

        var stopResult = null;
        if (definition.preRunStop) {
          stopResult =
            AKORT.OperationEngine.requestStop(operationId);
          if (!stopResult || stopResult.ok !== true) {
            throw AKORT.Core.error(
              stopResult && stopResult.code ||
                'BETA13_SAFE_STOP_FAILED',
              stopResult && stopResult.message ||
                'Could not request the Beta.1.3 safe stop.',
              {
                retryable: false,
                engineResult:
                  engineResultSummary_(stopResult)
              }
            );
          }
        }

        var runResult = AKORT.OperationEngine.run(
          operationId,
          {
            maxSteps: 50,
            executionBudgetMs: 180000,
            minRemainingMs: 10000
          }
        );
        var compact = compactStatus_(operationId);
        compact.engineResult =
          engineResultSummary_(runResult);
        compact.stopResult =
          engineResultSummary_(stopResult);

        if (
          String(compact.status) !==
          String(definition.firstStatus)
        ) {
          return AKORT.Result.failure(
            'BETA13_FIRST_BOUNDARY_MISMATCH',
            'The Beta.1.3 probe did not reach its expected first boundary.',
            compact
          );
        }
        return resultForStatus_(
          'Beta.1.3 probe reached its expected first boundary.',
          compact
        );
      },
      {
        lock: false,
        persistLogs: true
      }
    );
  }

  function continueOperation(operationId) {
    return AKORT.Core.safeRun(
      'BETA13_CONTINUE',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var before = compactStatus_(operationId);
        if (!before.noDataMutation) {
          return AKORT.Result.failure(
            'BETA13_DATA_SENTINEL_CHANGED',
            'Continuation is blocked because the data-plane sentinel changed.',
            before
          );
        }

        var status = String(before.status || '');
        var actionResult = null;

        if (
          before.scenario === 'FATAL_RECOVERY' &&
          status === 'FAILED'
        ) {
          var recovered =
            AKORT.OperationEngine.recoverFailedPhase(
              operationId,
              {
                operationType: before.operationType,
                phase: 'PARSE',
                errorCode: 'TEST_FATAL_ERROR',
                status: 'FAILED',
                reason:
                  'Beta.1.3 exact fatal-phase recovery'
              }
            );
          if (!recovered || recovered.ok !== true) {
            throw AKORT.Core.error(
              recovered && recovered.code ||
                'BETA13_RECOVERY_FAILED',
              recovered && recovered.message ||
                'Could not prepare exact failed-phase recovery.',
              {
                retryable: false,
                engineResult:
                  engineResultSummary_(recovered)
              }
            );
          }
          actionResult = AKORT.OperationEngine.resume(
            operationId,
            {
              maxSteps: 50,
              executionBudgetMs: 180000,
              minRemainingMs: 10000
            }
          );
        } else if (
          status === 'PAUSED' ||
          status === 'RETRY_PENDING' ||
          status === 'QUEUED' ||
          status === 'RUNNING'
        ) {
          actionResult = AKORT.OperationEngine.resume(
            operationId,
            {
              maxSteps: 50,
              executionBudgetMs: 180000,
              minRemainingMs: 10000
            }
          );
        } else if (
          status === before.expectedTerminalStatus
        ) {
          actionResult = AKORT.OperationEngine.status(
            operationId
          );
        } else {
          return AKORT.Result.failure(
            'BETA13_CONTINUATION_SOURCE_INVALID',
            'The Beta.1.3 operation is not at an authorized continuation boundary.',
            before
          );
        }

        var after = compactStatus_(operationId);
        after.engineResult =
          engineResultSummary_(actionResult);

        if (
          String(after.status) ===
          String(after.expectedTerminalStatus)
        ) {
          return resultForStatus_(
            'Beta.1.3 probe reached its expected terminal state.',
            after
          );
        }
        if (
          after.status === 'PAUSED' ||
          after.status === 'RETRY_PENDING'
        ) {
          if (!after.noDataMutation) {
            return AKORT.Result.failure(
              'BETA13_DATA_SENTINEL_CHANGED',
              'The data-plane sentinel changed during the Beta.1.3 probe.',
              after
            );
          }
          return AKORT.Result.paused(
            'Beta.1.3 probe remains at a safe continuation boundary.',
            after
          );
        }
        return AKORT.Result.failure(
          'BETA13_TERMINAL_BOUNDARY_MISMATCH',
          'The Beta.1.3 probe reached an unexpected state.',
          after
        );
      },
      {
        lock: false,
        persistLogs: true,
        operationId: operationId
      }
    );
  }

  function status(operationId) {
    return AKORT.Core.safeRun(
      'BETA13_STATUS',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        return resultForStatus_(
          'Beta.1.3 failure-probe status loaded.',
          compactStatus_(operationId)
        );
      },
      {
        lock: false,
        persistLogs: false,
        operationId: operationId
      }
    );
  }

  function lastOperationId_(scenario) {
    var normalized = normalizeScenario_(scenario);
    var operationId = PropertiesService
      .getScriptProperties()
      .getProperty(PROPERTY_PREFIX + normalized);
    if (!operationId) {
      throw AKORT.Core.error(
        'BETA13_OPERATION_NOT_REGISTERED',
        'No Beta.1.3 operation is registered for this scenario.',
        {
          retryable: false,
          scenario: normalized
        }
      );
    }
    return operationId;
  }

  function startScenario_(scenario) {
    var prepared = plan_(scenario, '');
    return start(
      prepared.scenario,
      prepared.confirmationToken
    );
  }

  function continueScenario_(scenario) {
    return continueOperation(
      lastOperationId_(scenario)
    );
  }

  function statusScenario_(scenario) {
    return status(
      lastOperationId_(scenario)
    );
  }

  function contract() {
    return AKORT.Core.safeRun(
      'BETA13_CONTRACT',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        return AKORT.Result.success(
          'Beta.1.3 failure-injection contract loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            operationPrefix: OPERATION_PREFIX,
            scenarios: clone_(SCENARIOS),
            previewWrites: false,
            dataPlaneMutation: false,
            serviceTableWrites:
              ['OPERATION_QUEUE', 'OPERATION_STEPS', 'SYSTEM_LOG'],
            scriptPropertyWrites:
              ['last operation_id per scenario'],
            sentinelMode:
              'BOUNDED_HEADERS_EDGES_COUNTS',
            newQueue: false,
            newExecutor: false,
            createsTrigger: false,
            productionWrite: false,
            enablesUserPipeline: false
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
    OperationPrefix: OPERATION_PREFIX,
    Scenarios: clone_(SCENARIOS),
    contract: contract,
    preview: preview,
    start: start,
    continueOperation: continueOperation,
    status: status,
    startScenario: startScenario_,
    continueScenario: continueScenario_,
    statusScenario: statusScenario_,
    Test: {
      normalizeScenario: normalizeScenario_,
      scenario: scenario_,
      binding: binding_,
      token: token_,
      compareSentinels: compareSentinels_,
      nextAction: nextAction_
    }
  };
})();

function AKORT_beta13Contract() {
  return AKORT.Beta13FailureInjection.contract();
}

function AKORT_beta13PreviewRetryableOnce() {
  return AKORT.Beta13FailureInjection.preview(
    'RETRYABLE_ONCE'
  );
}

function AKORT_beta13StartRetryableOnce() {
  return AKORT.Beta13FailureInjection.startScenario(
    'RETRYABLE_ONCE'
  );
}

function AKORT_beta13ContinueRetryableOnce() {
  return AKORT.Beta13FailureInjection.continueScenario(
    'RETRYABLE_ONCE'
  );
}

function AKORT_beta13StatusRetryableOnce() {
  return AKORT.Beta13FailureInjection.statusScenario(
    'RETRYABLE_ONCE'
  );
}

function AKORT_beta13PreviewFatalRecovery() {
  return AKORT.Beta13FailureInjection.preview(
    'FATAL_RECOVERY'
  );
}

function AKORT_beta13StartFatalRecovery() {
  return AKORT.Beta13FailureInjection.startScenario(
    'FATAL_RECOVERY'
  );
}

function AKORT_beta13ContinueFatalRecovery() {
  return AKORT.Beta13FailureInjection.continueScenario(
    'FATAL_RECOVERY'
  );
}

function AKORT_beta13StatusFatalRecovery() {
  return AKORT.Beta13FailureInjection.statusScenario(
    'FATAL_RECOVERY'
  );
}

function AKORT_beta13PreviewHandlerPause() {
  return AKORT.Beta13FailureInjection.preview(
    'HANDLER_PAUSE'
  );
}

function AKORT_beta13StartHandlerPause() {
  return AKORT.Beta13FailureInjection.startScenario(
    'HANDLER_PAUSE'
  );
}

function AKORT_beta13ContinueHandlerPause() {
  return AKORT.Beta13FailureInjection.continueScenario(
    'HANDLER_PAUSE'
  );
}

function AKORT_beta13StatusHandlerPause() {
  return AKORT.Beta13FailureInjection.statusScenario(
    'HANDLER_PAUSE'
  );
}

function AKORT_beta13PreviewSafeStop() {
  return AKORT.Beta13FailureInjection.preview(
    'SAFE_STOP'
  );
}

function AKORT_beta13StartSafeStop() {
  return AKORT.Beta13FailureInjection.startScenario(
    'SAFE_STOP'
  );
}

function AKORT_beta13ContinueSafeStop() {
  return AKORT.Beta13FailureInjection.continueScenario(
    'SAFE_STOP'
  );
}

function AKORT_beta13StatusSafeStop() {
  return AKORT.Beta13FailureInjection.statusScenario(
    'SAFE_STOP'
  );
}

function AKORT_beta13PreviewDeadLetter() {
  return AKORT.Beta13FailureInjection.preview(
    'DEAD_LETTER'
  );
}

function AKORT_beta13StartDeadLetter() {
  return AKORT.Beta13FailureInjection.startScenario(
    'DEAD_LETTER'
  );
}

function AKORT_beta13ContinueDeadLetter() {
  return AKORT.Beta13FailureInjection.continueScenario(
    'DEAD_LETTER'
  );
}

function AKORT_beta13StatusDeadLetter() {
  return AKORT.Beta13FailureInjection.statusScenario(
    'DEAD_LETTER'
  );
}
