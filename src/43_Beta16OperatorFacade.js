var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.6 r4 operator facade.
 * Resolves the one active FULL_AUDIT_V4 operation for no-argument
 * execution from the Apps Script editor. It does not create operations,
 * tables, triggers, Drive files, or any physical deletion path.
 */
AKORT.Beta16OperatorFacade = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.6.4';
  var CONTRACT_VERSION = '4.0-beta16-operator-facade-1';
  var OPERATION_TYPE = 'FULL_AUDIT_V4';

  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function operationId_(row) {
    return text_(row && (row.operation_id || row.operationId));
  }

  function operationType_(row) {
    return text_(row && (row.operation_type || row.operationType));
  }

  function operationStatus_(row) {
    return text_(row && row.status).toUpperCase();
  }

  function requestedAtMs_(row) {
    var parsed = Date.parse(text_(row && (row.requested_at || row.requestedAt)));
    return isNaN(parsed) ? 0 : parsed;
  }

  function latestActiveOperation() {
    var hardening = AKORT.Beta14OperationalHardening.status();
    if (!hardening || !hardening.ok) {
      return hardening || AKORT.Result.failure(
        'BETA16_HARDENING_STATUS_UNAVAILABLE',
        'Beta.1.4 operational status is unavailable.',
        { retryable: false }
      );
    }

    var inventory = hardening.data && hardening.data.operationInventory || {};
    var candidates = (inventory.nonTerminal || []).filter(function (row) {
      return operationType_(row) === OPERATION_TYPE &&
        !TERMINAL[operationStatus_(row)] &&
        operationId_(row);
    }).sort(function (left, right) {
      return requestedAtMs_(right) - requestedAtMs_(left) ||
        operationId_(right).localeCompare(operationId_(left));
    });

    if (!candidates.length) {
      return AKORT.Result.failure(
        'BETA16_ACTIVE_AUDIT_NOT_FOUND',
        'No active FULL_AUDIT_V4 operation was found.',
        {
          operationType: OPERATION_TYPE,
          nonTerminalCount: Number(inventory.nonTerminalCount || 0),
          retryable: false
        }
      );
    }

    if (candidates.length !== 1) {
      return AKORT.Result.failure(
        'BETA16_ACTIVE_AUDIT_AMBIGUOUS',
        'More than one active FULL_AUDIT_V4 operation was found.',
        {
          operationType: OPERATION_TYPE,
          operationIds: candidates.map(operationId_),
          retryable: false,
          requiresReview: true
        }
      );
    }

    return AKORT.Result.success(
      'Active Beta.1.6 Full Audit operation resolved.',
      {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        operationId: operationId_(candidates[0]),
        operationType: OPERATION_TYPE,
        status: operationStatus_(candidates[0]),
        requestedAt: text_(candidates[0].requested_at || candidates[0].requestedAt)
      }
    );
  }

  function continueLatest() {
    var latest = latestActiveOperation();
    if (!latest.ok) return latest;
    return AKORT.Beta16FullAuditRetention.continueAudit(
      latest.data.operationId
    );
  }

  function statusLatest() {
    var latest = latestActiveOperation();
    if (latest.ok) {
      return AKORT.Beta16FullAuditRetention.status(
        latest.data.operationId
      );
    }
    if (latest.code === 'BETA16_ACTIVE_AUDIT_NOT_FOUND') {
      return AKORT.Beta16FullAuditRetention.status();
    }
    return latest;
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      operationType: OPERATION_TYPE,
      acceptedExecutor: 'AKORT.OperationEngine',
      acceptedStatusSource: 'AKORT.Beta14OperationalHardening.status',
      publicApi: [
        'AKORT_beta16FullAuditContinueLatest',
        'AKORT_beta16FullAuditStatusLatest'
      ],
      requiresOperationArgument: false,
      createsOperation: false,
      createsTable: false,
      createsTrigger: false,
      deletesTrigger: false,
      driveEnumeration: false,
      physicalDeletion: false,
      readsPhysicalRawTargets: false,
      readsPhysicalPublishTargets: false,
      productionWrite: false,
      enablesUserPipeline: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    OperationType: OPERATION_TYPE,
    latestActiveOperation: latestActiveOperation,
    continueLatest: continueLatest,
    statusLatest: statusLatest,
    contract: contract
  });
})();

function AKORT_beta16FullAuditContinueLatest() {
  return AKORT_printResult_(
    AKORT.Beta16OperatorFacade.continueLatest()
  );
}

function AKORT_beta16FullAuditStatusLatest() {
  return AKORT_printResult_(
    AKORT.Beta16OperatorFacade.statusLatest()
  );
}
