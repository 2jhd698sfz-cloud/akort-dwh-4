var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.2 fail-closed controlled rollback E2E acceptance harness.
 *
 * The harness owns only one RAW_INDUSTRY canary revision and its logical
 * rollback. It delegates all data-plane execution to accepted public APIs:
 * RAW_LOAD_V4, Beta.1.4 enqueueGuarded, Beta.1.2 rollback facade and the
 * accepted Operation Engine. It creates no queue, handler, executor, trigger
 * or service table.
 */
AKORT.Beta12RollbackE2E = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.2.9';
  var CONTRACT_VERSION = '4.0-beta12-rollback-e2e-2';
  var IMPLEMENTATION_BASE_BRANCH = 'codex/beta-1-operational-gap-closure';
  var IMPLEMENTATION_BASE_HEAD = '546eeb5d8662f793691d4862870273362644e355';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';

  var FACADE_PACKAGE = '4.0.0-beta.1.2.5';
  var FACADE_CONTRACT = '4.0-beta12-rollback-facade-4';
  var HARDENING_PACKAGE = '4.0.0-beta.1.4.2';
  var HARDENING_CONTRACT = '4.0-beta14-operational-hardening-1';
  var RESTORE_PACKAGE = '4.0.0-beta.1.1.7';
  var RESTORE_CONTRACT = '4.0-beta11-isolated-restore-rehearsal-2';
  var RESTORE_BASE_COMMIT = 'cc5451f3bfaad4a294f07c31a7c0b76b71f14299';

  var EXPECTED_SCRIPT_ID = '1M3u30v6Wrv7X_qqGMDe_ITtdZSsfd1SNPr7MlEaqYFPbfJC0GSEeluL9';
  var EXPECTED_DWH_ID = '1d89EJVHtrZ4a8emcb-13OMjHMyh3mvW36LcxQf9Gk5s';
  var EXPECTED_PUBLISH_ID = '1tO_GmM02JSjOx05LYncsoqcqH4om9cVtr4pECxVCFBw';
  var EXPECTED_DEV_ROOT_ID = '1EvZx01xSMR6smJ2PNakKzlrEwT0OjV4J';

  var RESTORE_EVIDENCE_FILE_ID = '151LMCH-yam2Guba_2TzCUwzhc3javtct';
  var RESTORE_EVIDENCE_FILE_SHA256 = '3fff487ea06cc32bb86cd516434e9cd6c5bf62b618499b4c726126d305a972a3';
  var RESTORE_EVIDENCE_ID = 'RRE_0F19BA90233D4B0C053C5659';
  var RESTORE_EVIDENCE_HASH = '0f19ba90233d4b0c053c565957a6183d14c48a4405020964d38a270adf9e9d15';
  var RESTORE_BACKUP_ID = 'BKP_DAILY_20260805';

  var STATE_PROPERTY = 'AKORT_BETA12_ROLLBACK_E2E_STATE_R1';
  var EVIDENCE_FOLDER_NAME = '10_Beta12_Rollback_E2E';
  var SOURCE_ID = 'B12E2E_R1';
  var SOURCE_NAME = 'B12 E2E controlled revision r1';
  var ROLLBACK_REASON = 'B12 E2E controlled rollback for owned revision r1';
  var RAW_TARGET = 'RAW_INDUSTRY';
  var RAW_LOAD_TYPE = 'RAW_LOAD_V4';
  var RAW_REVERSAL_TYPE = 'RAW_REVERSAL_V4';
  var REGISTERED_LINEAGE_MODE = 'REGISTERED_OPERATION';
  var LEGACY_LINEAGE_MODE = 'LEGACY_ROW_BOUND';
  var TIMEZONE = 'Europe/Moscow';
  var BACKUP_WINDOW_START_MINUTE = 3 * 60 + 35;
  var BACKUP_WINDOW_END_MINUTE = 4 * 60 + 25;

  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  var FULL_PHASES = [
    'DISCOVER', 'VALIDATE', 'PARSE', 'STAGE', 'COMMIT_RAW',
    'UPDATE_PUBLISH', 'PREPARING_AGGREGATE_IMPACT',
    'MATERIALIZING_AGGREGATE_INPUTS', 'CALCULATING_AGGREGATE_SLICES',
    'STAGING_AGGREGATE_ROWS', 'UPDATING_AGGREGATES',
    'UPDATING_AGGREGATE_LATEST', 'RECONCILING_AGGREGATES',
    'UPDATE_STATUS', 'QUICK_AUDIT', 'FINALIZING', 'SUCCESS'
  ];

  var PROTECTED_MARKERS = [
    'ALPHA3_TEST_', 'ALPHA3_DEMO_', 'ALPHA4_TEST_', 'ALPHA5_TEST_',
    'ALPHA74_GATE6', 'ALPHA74_GATE7', 'GATE6_', 'GATE7_'
  ];

  function clone_(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      String(value || '').toUpperCase() === 'TRUE';
  }

  function number_(value) {
    var result = Number(value);
    return isFinite(result) ? result : NaN;
  }

  function fail_(code, message, details) {
    throw AKORT.Core.error(code, message, clone_(details || { retryable: false }));
  }

  function assert_(condition, code, message, details) {
    if (!condition) fail_(code, message, details);
    return true;
  }

  function parseJson_(value, code, label) {
    if (value && typeof value === 'object') return clone_(value);
    if (value === '' || value === null || value === undefined) {
      fail_(code, label + ' is missing.', { retryable: false });
    }
    try {
      return JSON.parse(String(value));
    } catch (caught) {
      fail_(code, label + ' is invalid JSON.', {
        retryable: false,
        cause: String(caught && caught.message || caught)
      });
    }
    return null;
  }

  function canonicalHash_(value) {
    return AKORT.Core.sha256(AKORT.Core.canonicalJson(value));
  }

  function config_() {
    return AKORT.Config.load({ includeSystemSettings: false });
  }

  function dwh_() {
    return SpreadsheetApp.openById(config_().resources.dwhSpreadsheetId);
  }

  function readObjects_(spreadsheet, sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      fail_('BETA12_E2E_REQUIRED_TABLE_MISSING', 'Required DEV table is missing.', {
        retryable: false,
        table: sheetName
      });
    }
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function unique_(rows, predicate, code, label) {
    var matches = (rows || []).filter(predicate);
    if (matches.length !== 1) {
      fail_(code, label + ' must resolve to exactly one row.', {
        retryable: false,
        matchCount: matches.length
      });
    }
    return matches[0];
  }

  function findOne_(rows, field, value) {
    var matches = (rows || []).filter(function (row) {
      return text_(row[field]) === text_(value);
    });
    if (matches.length > 1) {
      fail_('BETA12_E2E_ROW_CONFLICT', 'More than one row matches a unique identifier.', {
        retryable: false,
        field: field,
        value: text_(value),
        matchCount: matches.length
      });
    }
    return matches[0] || null;
  }

  function checkpoint_(operation) {
    return parseJson_(
      operation && operation.checkpoint_json,
      'BETA12_E2E_OPERATION_CHECKPOINT_INVALID',
      'Operation checkpoint'
    );
  }

  function operationById_(operations, operationId) {
    return unique_(operations, function (row) {
      return text_(row.operation_id) === text_(operationId);
    }, 'BETA12_E2E_OPERATION_NOT_UNIQUE', 'Operation');
  }

  function sourceIdentityProtected_(value) {
    var identity = text_(value).toUpperCase();
    return PROTECTED_MARKERS.some(function (marker) {
      return identity.indexOf(marker) >= 0;
    });
  }

  function assertSafeSourceIdentity_() {
    var identity = [SOURCE_ID, SOURCE_NAME, ROLLBACK_REASON].join('|');
    assert_(!sourceIdentityProtected_(identity),
      'BETA12_E2E_SOURCE_IDENTITY_PROTECTED',
      'E2E source identity collides with a protected facade marker.', {
        retryable: false,
        sourceId: SOURCE_ID,
        sourceName: SOURCE_NAME
      });
  }

  function minuteOfDayMoscow_() {
    var parts = Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm').split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function backupWindow_() {
    var minute = minuteOfDayMoscow_();
    return {
      blocked: minute >= BACKUP_WINDOW_START_MINUTE &&
        minute <= BACKUP_WINDOW_END_MINUTE,
      timezone: TIMEZONE,
      currentMinute: minute,
      startMinute: BACKUP_WINDOW_START_MINUTE,
      endMinute: BACKUP_WINDOW_END_MINUTE
    };
  }

  function assertStartWindow_() {
    var windowState = backupWindow_();
    assert_(!windowState.blocked,
      'BETA12_E2E_BACKUP_WINDOW_BLOCKED',
      'A data-plane E2E operation cannot start during the protected backup window.', {
        retryable: true,
        window: windowState
      });
    return windowState;
  }

  function assertAcceptedRuntime_() {
    AKORT.EnvironmentGuard.assertDev();
    var cfg = config_();
    var settings = AKORT.Config.readSystemSettings();
    var actualScriptId = text_(cfg.expectedScriptId);

    assert_(text_(AKORT.Release.version) === BASE_RELEASE,
      'BETA12_E2E_BASE_RELEASE_MISMATCH',
      'The accepted Alpha.7.4 runtime is not installed.', {
        retryable: false,
        expected: BASE_RELEASE,
        actual: text_(AKORT.Release.version)
      });
    assert_(text_(cfg.environment).toUpperCase() === 'DEV',
      'BETA12_E2E_ENVIRONMENT_INVALID',
      'The E2E harness may run only in DEV.', {
        retryable: false,
        actual: text_(cfg.environment)
      });
    assert_(text_(cfg.resources.dwhSpreadsheetId) === EXPECTED_DWH_ID,
      'BETA12_E2E_DWH_ID_MISMATCH', 'DEV DWH ID does not match.', {
        retryable: false,
        expected: EXPECTED_DWH_ID,
        actual: text_(cfg.resources.dwhSpreadsheetId)
      });
    assert_(text_(cfg.resources.publishSpreadsheetId) === EXPECTED_PUBLISH_ID,
      'BETA12_E2E_PUBLISH_ID_MISMATCH', 'DEV Publish ID does not match.', {
        retryable: false,
        expected: EXPECTED_PUBLISH_ID,
        actual: text_(cfg.resources.publishSpreadsheetId)
      });
    assert_(text_(cfg.resources.devRootFolderId) === EXPECTED_DEV_ROOT_ID,
      'BETA12_E2E_DEV_ROOT_ID_MISMATCH', 'DEV root folder ID does not match.', {
        retryable: false,
        expected: EXPECTED_DEV_ROOT_ID,
        actual: text_(cfg.resources.devRootFolderId)
      });
    assert_(text_(actualScriptId) === EXPECTED_SCRIPT_ID,
      'BETA12_E2E_SCRIPT_ID_MISMATCH', 'Apps Script project ID does not match.', {
        retryable: false,
        expected: EXPECTED_SCRIPT_ID,
        actual: text_(actualScriptId)
      });
    assert_(settings.PUBLISH_USER_PIPELINE_ENABLED === false ||
        text_(settings.PUBLISH_USER_PIPELINE_ENABLED).toUpperCase() === 'FALSE',
      'BETA12_E2E_USER_PIPELINE_MUST_REMAIN_DISABLED',
      'The general user publication pipeline must remain disabled.', {
        retryable: false,
        actual: settings.PUBLISH_USER_PIPELINE_ENABLED
      });

    assert_(AKORT.Beta12RollbackFacade &&
        AKORT.Beta12RollbackFacade.PackageVersion === FACADE_PACKAGE &&
        AKORT.Beta12RollbackFacade.ContractVersion === FACADE_CONTRACT,
      'BETA12_E2E_FACADE_BINDING_MISMATCH',
      'Accepted Beta.1.2 rollback facade binding does not match.', {
        retryable: false,
        expectedPackage: FACADE_PACKAGE,
        expectedContract: FACADE_CONTRACT
      });
    assert_(AKORT.Beta14OperationalHardening &&
        AKORT.Beta14OperationalHardening.PackageVersion === HARDENING_PACKAGE &&
        AKORT.Beta14OperationalHardening.ContractVersion === HARDENING_CONTRACT,
      'BETA12_E2E_HARDENING_BINDING_MISMATCH',
      'Accepted Beta.1.4 hardening binding does not match.', {
        retryable: false,
        expectedPackage: HARDENING_PACKAGE,
        expectedContract: HARDENING_CONTRACT
      });
    assert_(AKORT.Beta11RestoreRehearsal &&
        AKORT.Beta11RestoreRehearsal.PackageVersion === RESTORE_PACKAGE &&
        AKORT.Beta11RestoreRehearsal.ContractVersion === RESTORE_CONTRACT,
      'BETA12_E2E_RESTORE_MODULE_BINDING_MISMATCH',
      'Accepted restore rehearsal module binding does not match.', {
        retryable: false,
        expectedPackage: RESTORE_PACKAGE,
        expectedContract: RESTORE_CONTRACT
      });
    assert_(AKORT.RawStoreHandlers &&
        AKORT.RawStoreHandlers.LoadOperationType === RAW_LOAD_TYPE &&
        AKORT.RawStoreHandlers.ReversalOperationType === RAW_REVERSAL_TYPE,
      'BETA12_E2E_RAW_HANDLER_BINDING_MISMATCH',
      'Accepted RAW operation handlers are unavailable.', {
        retryable: false
      });
    assert_(AKORT.IncrementalPublish &&
        typeof AKORT.IncrementalPublish.planLoad === 'function' &&
        typeof AKORT.IncrementalPublish.planReversal === 'function' &&
        AKORT.AggregateIntegration &&
        typeof AKORT.AggregateIntegration.execute === 'function',
      'BETA12_E2E_PUBLISH_AGGREGATE_UNAVAILABLE',
      'Accepted Publish or aggregate pipeline is unavailable.', {
        retryable: false
      });

    assertSafeSourceIdentity_();
    return {
      environment: 'DEV',
      release: BASE_RELEASE,
      scriptId: actualScriptId,
      dwhSpreadsheetId: cfg.resources.dwhSpreadsheetId,
      publishSpreadsheetId: cfg.resources.publishSpreadsheetId,
      devRootFolderId: cfg.resources.devRootFolderId,
      userPipelineEnabled: false
    };
  }

  function restoreEvidence_() {
    var file = DriveApp.getFileById(RESTORE_EVIDENCE_FILE_ID);
    var content = file.getBlob().getDataAsString('UTF-8');
    var evidence = parseJson_(
      content,
      'BETA12_E2E_RESTORE_EVIDENCE_INVALID',
      'Accepted restore evidence file'
    );
    var fileHash = canonicalHash_(evidence);
    var passChecks = (evidence.checks || []).filter(function (check) {
      return text_(check.status) === 'PASS';
    });

    assert_(fileHash === RESTORE_EVIDENCE_FILE_SHA256,
      'BETA12_E2E_RESTORE_FILE_HASH_MISMATCH',
      'Accepted restore evidence file SHA-256 does not match.', {
        retryable: false,
        expected: RESTORE_EVIDENCE_FILE_SHA256,
        actual: fileHash
      });
    assert_(text_(evidence.schemaVersion) === RESTORE_CONTRACT &&
        text_(evidence.packageVersion) === RESTORE_PACKAGE &&
        text_(evidence.baseRelease) === BASE_RELEASE &&
        text_(evidence.baseCommit) === RESTORE_BASE_COMMIT &&
        text_(evidence.backupId) === RESTORE_BACKUP_ID &&
        text_(evidence.evidenceId) === RESTORE_EVIDENCE_ID &&
        text_(evidence.evidenceHash) === RESTORE_EVIDENCE_HASH &&
        text_(evidence.status) === 'PASS' &&
        passChecks.length === 9,
      'BETA12_E2E_RESTORE_EVIDENCE_BINDING_MISMATCH',
      'Accepted restore evidence binding does not match.', {
        retryable: false,
        evidenceId: text_(evidence.evidenceId),
        checksPassed: passChecks.length
      });
    assert_(evidence.safety &&
        evidence.safety.productionTouched === false &&
        evidence.safety.activeDevConfigurationChanged === false &&
        evidence.safety.dataPlaneWrite === false &&
        evidence.safety.rawWrite === false &&
        evidence.safety.publishWrite === false &&
        evidence.safety.physicalDeletion === false &&
        evidence.safety.triggerCreated === false &&
        evidence.safety.triggerDeleted === false &&
        evidence.safety.userPipelineEnabled === false,
      'BETA12_E2E_RESTORE_SAFETY_MISMATCH',
      'Accepted restore evidence safety boundary does not match.', {
        retryable: false
      });

    return {
      fileId: RESTORE_EVIDENCE_FILE_ID,
      fileUrl: file.getUrl(),
      fileSha256: fileHash,
      evidenceId: evidence.evidenceId,
      evidenceHash: evidence.evidenceHash,
      backupId: evidence.backupId,
      operationId: evidence.operationId,
      checksPassed: passChecks.length,
      checksTotal: (evidence.checks || []).length,
      finishedAt: evidence.finishedAt
    };
  }

  function activeOperations_(operations, ignoredIds) {
    var ignored = {};
    (ignoredIds || []).forEach(function (id) { ignored[text_(id)] = true; });
    return (operations || []).filter(function (operation) {
      var status = text_(operation.status);
      return !TERMINAL[status] && !ignored[text_(operation.operation_id)];
    });
  }

  function operationFingerprint_(operation) {
    var checkpoint = checkpoint_(operation);
    return canonicalHash_({
      operationId: text_(operation.operation_id),
      operationType: text_(operation.operation_type),
      status: text_(operation.status),
      releaseVersion: text_(operation.release_version),
      createdBy: text_(operation.created_by),
      input: checkpoint.input || {},
      idempotencyKey: checkpoint.meta && checkpoint.meta.idempotencyKey || '',
      handlerState: checkpoint.handlerState || {}
    });
  }

  function rowFingerprint_(row, businessKey) {
    return canonicalHash_({
      observationId: text_(row.observation_id),
      businessKey: businessKey === undefined ?
        AKORT.RawStore.businessKey(RAW_TARGET, row) : businessKey,
      seriesId: text_(row.series_id),
      periodStart: row.period_start,
      periodEnd: row.period_end,
      value: number_(row.value),
      versionNo: number_(row.version_no),
      isLatest: truthy_(row.is_latest),
      loadId: text_(row.load_id)
    });
  }

  function legacyLineageFingerprint_(row, predecessorRowFingerprint) {
    return canonicalHash_({
      lineageMode: LEGACY_LINEAGE_MODE,
      targetTable: RAW_TARGET,
      predecessorObservationId: text_(row.observation_id),
      predecessorLoadId: text_(row.load_id),
      predecessorRowFingerprint: predecessorRowFingerprint ||
        rowFingerprint_(row),
      revisionType: text_(row.revision_type),
      versionNo: number_(row.version_no)
    });
  }


  function candidateFingerprint_(candidate) {
    return canonicalHash_({
      targetTable: RAW_TARGET,
      predecessorObservationId: candidate.predecessorObservationId,
      businessKey: candidate.businessKey,
      seriesId: candidate.seriesId,
      periodStart: candidate.periodStart,
      periodEnd: candidate.periodEnd,
      predecessorValue: candidate.predecessorValue,
      predecessorVersionNo: candidate.predecessorVersionNo,
      predecessorLoadId: candidate.predecessorLoadId,
      lineageMode: candidate.lineageMode,
      sourceOperationId: candidate.sourceOperationId,
      predecessorRowFingerprint: candidate.predecessorRowFingerprint,
      sourceOperationFingerprint: candidate.sourceOperationFingerprint
    });
  }

  function candidateFromSnapshot_(snapshot) {
    var loadsById = {};
    var operationsById = {};
    var reversedTargets = {};
    var activeRollbackTargets = {};
    var latestByKey = {};
    var rowFacts = new Array(snapshot.rows.length);
    var selected = null;

    snapshot.loads.forEach(function (row) {
      var id = text_(row.load_id);
      if (loadsById[id]) {
        fail_('BETA12_E2E_LOAD_REGISTRY_CONFLICT',
          'RAW_LOAD_REGISTRY contains duplicate load_id values.', {
            retryable: false,
            loadId: id
          });
      }
      loadsById[id] = row;
    });
    snapshot.operations.forEach(function (row) {
      var id = text_(row.operation_id);
      if (operationsById[id]) {
        fail_('BETA12_E2E_OPERATION_QUEUE_CONFLICT',
          'OPERATION_QUEUE contains duplicate operation_id values.', {
            retryable: false,
            operationId: id
          });
      }
      operationsById[id] = row;
      if (text_(row.operation_type) === RAW_REVERSAL_TYPE &&
          !TERMINAL[text_(row.status)]) {
        var cp = checkpoint_(row);
        activeRollbackTargets[text_(cp.input && cp.input.targetLoadId)] = true;
      }
    });
    snapshot.reversals.forEach(function (row) {
      if (text_(row.status) === 'SUCCESS') {
        reversedTargets[text_(row.target_load_id)] = true;
      }
    });

    snapshot.rows.forEach(function (row, index) {
      var key = AKORT.RawStore.businessKey(RAW_TARGET, row);
      var fact = {
        row: row,
        key: key,
        latest: truthy_(row.is_latest),
        value: number_(row.value),
        versionNo: number_(row.version_no)
      };
      rowFacts[index] = fact;
      if (!fact.latest) return;
      if (latestByKey[key]) {
        fail_('BETA12_E2E_MULTIPLE_LATEST_ROWS',
          'RAW_INDUSTRY has more than one latest row for a business key.', {
            retryable: false,
            businessKey: key
          });
      }
      latestByKey[key] = fact;
    });

    rowFacts.forEach(function (fact) {
      var row = fact.row;
      if (!fact.latest || !isFinite(fact.value)) return;
      var loadId = text_(row.load_id);
      if (!loadId || reversedTargets[loadId] || activeRollbackTargets[loadId]) return;
      var load = loadsById[loadId] || null;
      var operation = load ? operationsById[text_(load.operation_id)] : null;
      var lineageMode = '';
      var sourceOperationId = '';
      var sourceOperationFingerprint = '';
      var predecessorRowFingerprint = rowFingerprint_(row, fact.key);
      var identity = '';

      if (load) {
        if (text_(load.status) !== 'COMMITTED' ||
            text_(load.target_table) !== RAW_TARGET) return;
        if (!operation || text_(operation.status) !== 'SUCCESS' ||
            text_(operation.operation_type) === RAW_REVERSAL_TYPE) return;
        identity = [
          load.load_id, load.source_id, load.source_name, load.operation_id,
          operation.operation_id, operation.operation_type,
          operation.checkpoint_json
        ].join('|');
        lineageMode = REGISTERED_LINEAGE_MODE;
        sourceOperationId = text_(operation.operation_id);
        sourceOperationFingerprint = operationFingerprint_(operation);
      } else {
        identity = [
          row.observation_id, row.series_id, row.period_start, row.period_end,
          row.load_id, row.revision_type, row.version_no
        ].join('|');
        if (fact.versionNo !== 1 ||
            text_(row.revision_type).toUpperCase() !== 'INITIAL') return;
        lineageMode = LEGACY_LINEAGE_MODE;
        sourceOperationFingerprint = legacyLineageFingerprint_(
          row, predecessorRowFingerprint
        );
      }

      var ownedIdentity = text_(load && load.source_id) === SOURCE_ID ||
        text_(load && load.source_name) === SOURCE_NAME ||
        identity.indexOf(CONTRACT_VERSION) >= 0 ||
        identity.indexOf(PACKAGE_VERSION) >= 0 ||
        identity.toUpperCase().indexOf('B12E2E_') >= 0;
      if (ownedIdentity || sourceIdentityProtected_(identity)) return;

      var candidate = {
        targetTable: RAW_TARGET,
        predecessorObservationId: text_(row.observation_id),
        businessKey: fact.key,
        seriesId: text_(row.series_id),
        periodStart: row.period_start,
        periodEnd: row.period_end,
        sourcePublishedAt: row.source_published_at || '',
        predecessorValue: fact.value,
        predecessorVersionNo: fact.versionNo,
        predecessorLoadId: loadId,
        lineageMode: lineageMode,
        sourceOperationId: sourceOperationId,
        predecessorRowFingerprint: predecessorRowFingerprint,
        sourceOperationFingerprint: sourceOperationFingerprint
      };
      candidate.candidateFingerprint = candidateFingerprint_(candidate);

      if (!selected ||
          candidate.seriesId < selected.seriesId ||
          (candidate.seriesId === selected.seriesId &&
            String(candidate.periodStart) < String(selected.periodStart)) ||
          (candidate.seriesId === selected.seriesId &&
            String(candidate.periodStart) === String(selected.periodStart) &&
            candidate.predecessorObservationId <
              selected.predecessorObservationId)) {
        selected = candidate;
      }
    });

    assert_(selected,
      'BETA12_E2E_SAFE_CANDIDATE_NOT_FOUND',
      'No current RAW_INDUSTRY row satisfies the fail-closed E2E eligibility policy.', {
        retryable: false,
        registeredPolicy: 'COMMITTED_LOAD_AND_SUCCESSFUL_NON_REVERSAL_OPERATION',
        legacyPolicy: 'UNREGISTERED_VERSION_1_INITIAL_ROW_BOUND_LINEAGE',
        selectionAlgorithm: 'LINEAR_INDEXED_SINGLE_BEST',
        protectedMarkers: PROTECTED_MARKERS.slice()
      });
    selected.selectionAlgorithm = 'LINEAR_INDEXED_SINGLE_BEST';
    selected.rowsScanned = rowFacts.length;
    return selected;
  }

  function snapshot_() {
    var spreadsheet = dwh_();
    return {
      rows: readObjects_(spreadsheet, RAW_TARGET),
      loads: readObjects_(spreadsheet, 'RAW_LOAD_REGISTRY'),
      reversals: readObjects_(spreadsheet, 'RAW_REVERSAL_LOG'),
      operations: readObjects_(spreadsheet, 'OPERATION_QUEUE')
    };
  }

  function state_() {
    var raw = PropertiesService.getScriptProperties().getProperty(STATE_PROPERTY);
    if (!raw) return null;
    var state = parseJson_(
      raw,
      'BETA12_E2E_STATE_INVALID',
      'E2E controller state'
    );
    assert_(text_(state.schemaVersion) === CONTRACT_VERSION &&
        text_(state.packageVersion) === PACKAGE_VERSION &&
        text_(state.implementationBaseHead) === IMPLEMENTATION_BASE_HEAD,
      'BETA12_E2E_STATE_BINDING_MISMATCH',
      'E2E controller state belongs to a different package or implementation base.', {
        retryable: false
      });
    return state;
  }

  function saveState_(state) {
    state.schemaVersion = CONTRACT_VERSION;
    state.packageVersion = PACKAGE_VERSION;
    state.implementationBaseHead = IMPLEMENTATION_BASE_HEAD;
    state.updatedAt = AKORT.Core.now();
    PropertiesService.getScriptProperties().setProperty(
      STATE_PROPERTY,
      AKORT.Core.safeJson(state)
    );
    return state;
  }

  function noExistingState_() {
    var existing = state_();
    assert_(!existing,
      'BETA12_E2E_STATE_ALREADY_EXISTS',
      'An E2E run already exists. Continue or inspect that exact run instead of creating another.', {
        retryable: false,
        stage: existing && existing.stage,
        canaryOperationId: existing && existing.canaryOperationId,
        rollbackOperationId: existing && existing.rollbackOperationId,
        evidenceId: existing && existing.evidenceId
      });
  }

  function preflightData_() {
    var runtime = assertAcceptedRuntime_();
    var restore = restoreEvidence_();
    var windowState = backupWindow_();
    var existingState = state_();
    assert_(!existingState,
      'BETA12_E2E_STATE_ALREADY_EXISTS',
      'An E2E run already exists. Use status or the exact next decision-boundary function.', {
        retryable: false,
        stage: existingState && existingState.stage
      });
    var snap = snapshot_();
    var ownedLoads = snap.loads.filter(function (row) {
      return text_(row.source_id) === SOURCE_ID ||
        text_(row.source_name) === SOURCE_NAME;
    });
    var ownedOperations = snap.operations.filter(function (row) {
      return String(row.checkpoint_json || '').indexOf(CONTRACT_VERSION) >= 0 ||
        String(row.checkpoint_json || '').indexOf(PACKAGE_VERSION) >= 0 ||
        String(row.checkpoint_json || '').toUpperCase().indexOf('B12E2E_') >= 0;
    });
    assert_(ownedLoads.length === 0 && ownedOperations.length === 0,
      'BETA12_E2E_ORPHANED_ARTIFACTS_PRESENT',
      'Owned E2E artifacts exist without controller state; manual review is required.', {
        retryable: false,
        ownedLoadIds: ownedLoads.map(function (row) { return text_(row.load_id); }),
        ownedOperationIds: ownedOperations.map(function (row) {
          return text_(row.operation_id);
        })
      });
    var active = activeOperations_(snap.operations, []);
    assert_(active.length === 0,
      'BETA12_E2E_OPERATION_QUIESCENCE_REQUIRED',
      'A non-terminal operation exists; E2E start is blocked.', {
        retryable: true,
        activeOperations: active.map(function (row) {
          return {
            operationId: text_(row.operation_id),
            operationType: text_(row.operation_type),
            status: text_(row.status),
            phase: text_(row.current_phase)
          };
        })
      });
    var candidate = candidateFromSnapshot_(snap);
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      implementationBaseBranch: IMPLEMENTATION_BASE_BRANCH,
      implementationBaseHead: IMPLEMENTATION_BASE_HEAD,
      runtime: runtime,
      restoreEvidence: restore,
      backupWindow: windowState,
      candidate: clone_(candidate),
      sourceIdentity: {
        sourceId: SOURCE_ID,
        sourceName: SOURCE_NAME,
        protected: false
      },
      activeOperationCount: 0,
      writeBoundary: 'READ_ONLY',
      productionTouched: false,
      activeDevConfigurationChanged: false,
      userPipelineEnabled: false
    };
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_PREFLIGHT',
      function () {
        var data = preflightData_();
        return AKORT.Result.success(
          data.backupWindow.blocked ?
            'E2E preflight passed, but a data-plane start is currently blocked by the backup window.' :
            'E2E preflight passed; one deterministic safe predecessor was selected.',
          data
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function canaryValue_(value) {
    var original = number_(value);
    if (!isFinite(original)) {
      fail_('BETA12_E2E_CANARY_VALUE_INVALID', 'Predecessor value must be finite.', {
        retryable: false,
        value: value
      });
    }
    var scale = Math.max(Math.abs(original) * 0.000001, 0.000001);
    var candidate = Number((original + scale).toPrecision(15));
    if (candidate === original) candidate = original + 0.000001;
    assert_(isFinite(candidate) && candidate !== original,
      'BETA12_E2E_CANARY_VALUE_UNCHANGED',
      'Unable to derive a finite minimally changed canary value.', {
        retryable: false,
        original: original,
        candidate: candidate
      });
    return candidate;
  }

  function revalidateCandidate_(candidate) {
    var snap = snapshot_();
    var row = unique_(snap.rows, function (item) {
      return text_(item.observation_id) === text_(candidate.predecessorObservationId);
    }, 'BETA12_E2E_PREDECESSOR_NOT_UNIQUE', 'Predecessor observation');
    var lineageValid = false;

    if (candidate.lineageMode === REGISTERED_LINEAGE_MODE) {
      var load = findOne_(snap.loads, 'load_id', candidate.predecessorLoadId);
      var operation = load ? findOne_(snap.operations, 'operation_id', load.operation_id) : null;
      lineageValid = !!(load && operation &&
        text_(load.status) === 'COMMITTED' &&
        text_(load.target_table) === RAW_TARGET &&
        text_(operation.status) === 'SUCCESS' &&
        text_(operation.operation_type) !== RAW_REVERSAL_TYPE &&
        operationFingerprint_(operation) === candidate.sourceOperationFingerprint);
    } else if (candidate.lineageMode === LEGACY_LINEAGE_MODE) {
      var registered = findOne_(snap.loads, 'load_id', candidate.predecessorLoadId);
      lineageValid = !registered &&
        text_(row.load_id) === text_(candidate.predecessorLoadId) &&
        number_(row.version_no) === 1 &&
        text_(row.revision_type).toUpperCase() === 'INITIAL' &&
        legacyLineageFingerprint_(row) === candidate.sourceOperationFingerprint;
    }

    assert_(lineageValid && truthy_(row.is_latest) &&
        rowFingerprint_(row) === candidate.predecessorRowFingerprint &&
        candidateFingerprint_(candidate) === candidate.candidateFingerprint,
      'BETA12_E2E_PREDECESSOR_DRIFT',
      'The selected predecessor or its source lineage changed after preflight.', {
        retryable: false,
        predecessorObservationId: candidate.predecessorObservationId,
        lineageMode: candidate.lineageMode
      });
    assert_(activeOperations_(snap.operations, []).length === 0,
      'BETA12_E2E_OPERATION_QUIESCENCE_REQUIRED',
      'A non-terminal operation exists; canary submission is blocked.', {
        retryable: true
      });
    return row;
  }

  function operationIdFromResult_(result) {
    return text_(result && result.data && (
      result.data.operationId ||
      result.data.operation && (
        result.data.operation.operationId || result.data.operation.operation_id
      )
    ));
  }

  function canarySubmit() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_CANARY_SUBMIT',
      function () {
        assertAcceptedRuntime_();
        restoreEvidence_();
        assertStartWindow_();
        noExistingState_();
        var preflightData = preflightData_();
        var candidate = preflightData.candidate;
        var predecessor = revalidateCandidate_(candidate);
        var value = canaryValue_(candidate.predecessorValue);
        var idempotencyKey = 'B12E2E_LOAD_' +
          candidate.candidateFingerprint.slice(0, 40).toUpperCase();
        var input = {
          targetTable: RAW_TARGET,
          sourceId: SOURCE_ID,
          sourceName: SOURCE_NAME,
          sourceHash: canonicalHash_({
            packageVersion: PACKAGE_VERSION,
            candidateFingerprint: candidate.candidateFingerprint,
            canaryValue: value
          }),
          rows: [{
            series_id: predecessor.series_id,
            period_start: predecessor.period_start,
            period_end: predecessor.period_end,
            value: value,
            source_published_at: predecessor.source_published_at || ''
          }],
          beta12RollbackE2E: {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            implementationBaseHead: IMPLEMENTATION_BASE_HEAD,
            predecessorObservationId: candidate.predecessorObservationId,
            predecessorFingerprint: candidate.predecessorRowFingerprint,
            candidateFingerprint: candidate.candidateFingerprint
          }
        };
        var queued = AKORT.Beta14OperationalHardening.enqueueGuarded(
          RAW_LOAD_TYPE,
          input,
          {
            idempotencyKey: idempotencyKey,
            priority: 45,
            maxAttempts: 24,
            requester: 'B12E2E_R1'
          }
        );
        if (!queued || queued.ok === false) return queued;
        var operationId = operationIdFromResult_(queued);
        assert_(operationId,
          'BETA12_E2E_CANARY_OPERATION_ID_MISSING',
          'Guarded RAW_LOAD_V4 enqueue did not return an operation_id.', {
            retryable: false
          });
        var controller = saveState_({
          stage: 'CANARY_SUBMITTED',
          createdAt: AKORT.Core.now(),
          candidate: clone_(candidate),
          canaryValue: value,
          canaryIdempotencyKey: idempotencyKey,
          canaryOperationId: operationId,
          canaryLoadId: '',
          canaryObservationId: '',
          rollbackOperationId: '',
          reversalLoadId: '',
          previewBinding: null,
          restoreEvidence: preflightData.restoreEvidence,
          safety: {
            productionTouched: false,
            activeDevConfigurationChanged: false,
            physicalDeletion: false,
            userPipelineEnabled: false
          }
        });
        var runResult = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        controller.lastRunStatus = text_(runResult && runResult.status);
        controller.lastRunAt = AKORT.Core.now();
        saveState_(controller);
        var operation = refreshStageFromOperation_(controller, 'CANARY');
        var response = {
          operationId: operationId,
          operationStatus: text_(operation.status),
          stage: state_().stage,
          runResult: runResult,
          nextAction: text_(operation.status) === 'SUCCESS' ?
            'ROLLBACK_PREVIEW' : 'CONTINUE_LATEST',
          rollbackSubmitted: false,
          productionTouched: false,
          userPipelineEnabled: false
        };
        if (text_(operation.status) === 'SUCCESS') {
          return AKORT.Result.success(
            'One owned RAW_INDUSTRY canary completed successfully. No rollback was submitted.',
            response
          );
        }
        if (TERMINAL[text_(operation.status)] || runResult && runResult.ok === false) {
          return AKORT.Result.failure(
            text_(operation.error_code) || runResult && runResult.code ||
              'BETA12_E2E_CANARY_TERMINAL_FAILURE',
            text_(operation.error_message) || runResult && runResult.message ||
              'Owned canary operation ended in a non-success state.',
            response
          );
        }
        return AKORT.Result.paused(
          'One owned RAW_INDUSTRY canary was submitted and remains resumable. No rollback was submitted.',
          response
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function completedPhases_(operation) {
    var cp = checkpoint_(operation);
    return (cp.completedPhases || []).map(String);
  }

  function missingPhases_(operation) {
    var completed = completedPhases_(operation);
    return FULL_PHASES.filter(function (phase) {
      return completed.indexOf(phase) < 0;
    });
  }

  function validateCanary_(controller, afterRollback) {
    var snap = snapshot_();
    var operation = operationById_(snap.operations, controller.canaryOperationId);
    assert_(text_(operation.operation_type) === RAW_LOAD_TYPE &&
        text_(operation.status) === 'SUCCESS',
      'BETA12_E2E_CANARY_OPERATION_NOT_SUCCESS',
      'Owned canary operation is not a successful RAW_LOAD_V4.', {
        retryable: !TERMINAL[text_(operation.status)],
        operationId: controller.canaryOperationId,
        status: text_(operation.status)
      });
    var cp = checkpoint_(operation);
    var rawState = cp.rawStore || {};
    var loadId = text_(rawState.loadId);
    assert_(loadId,
      'BETA12_E2E_CANARY_LOAD_ID_MISSING',
      'Successful canary operation has no durable load_id.', {
        retryable: false,
        operationId: controller.canaryOperationId
      });
    var load = unique_(snap.loads, function (row) {
      return text_(row.load_id) === loadId &&
        text_(row.operation_id) === controller.canaryOperationId;
    }, 'BETA12_E2E_CANARY_LOAD_NOT_UNIQUE', 'Owned canary load');
    var expectedLoadStatus = afterRollback === true ? 'REVERSED' : 'COMMITTED';
    assert_(text_(load.status) === expectedLoadStatus &&
        text_(load.target_table) === RAW_TARGET &&
        Number(load.rows_received) === 1 &&
        Number(load.rows_staged) === 1 &&
        Number(load.rows_revised) === 1 &&
        Number(load.rows_inserted) === 0 &&
        Number(load.rows_unchanged) === 0,
      'BETA12_E2E_CANARY_LOAD_METRICS_INVALID',
      'Canary load is not exactly one revision.', {
        retryable: false,
        loadId: loadId,
        status: load.status,
        rowsReceived: load.rows_received,
        rowsStaged: load.rows_staged,
        rowsRevised: load.rows_revised,
        rowsInserted: load.rows_inserted,
        rowsUnchanged: load.rows_unchanged
      });
    assert_(text_(load.source_id) === SOURCE_ID &&
        text_(load.source_name) === SOURCE_NAME,
      'BETA12_E2E_CANARY_SOURCE_IDENTITY_DRIFT',
      'Canary load source identity does not match the owned E2E identity.', {
        retryable: false,
        loadId: loadId
      });
    var canary = unique_(snap.rows, function (row) {
      return text_(row.load_id) === loadId;
    }, 'BETA12_E2E_CANARY_ROW_NOT_UNIQUE', 'Owned canary observation');
    var predecessor = unique_(snap.rows, function (row) {
      return text_(row.observation_id) ===
        controller.candidate.predecessorObservationId;
    }, 'BETA12_E2E_PREDECESSOR_NOT_UNIQUE', 'Predecessor observation');
    var latestStateValid = afterRollback === true ?
      (!truthy_(canary.is_latest) && truthy_(predecessor.is_latest)) :
      (truthy_(canary.is_latest) && !truthy_(predecessor.is_latest));
    var predecessorFingerprintStateValid = afterRollback === true ?
      rowFingerprint_(predecessor) === controller.candidate.predecessorRowFingerprint :
      rowFingerprint_(predecessor) !== controller.candidate.predecessorRowFingerprint;
    assert_(latestStateValid && predecessorFingerprintStateValid &&
        AKORT.RawStore.businessKey(RAW_TARGET, canary) === controller.candidate.businessKey &&
        AKORT.RawStore.businessKey(RAW_TARGET, predecessor) === controller.candidate.businessKey &&
        Number(canary.version_no) === controller.candidate.predecessorVersionNo + 1 &&
        Number(canary.value) === Number(controller.canaryValue) &&
        Number(predecessor.value) === Number(controller.candidate.predecessorValue) &&
        Number(predecessor.version_no) === Number(controller.candidate.predecessorVersionNo),
      'BETA12_E2E_CANARY_LINEAGE_INVALID',
      'Canary/predecessor latest-state transition is invalid for the current E2E stage.', {
        retryable: false,
        canaryObservationId: text_(canary.observation_id),
        predecessorObservationId: text_(predecessor.observation_id)
      });
    var stablePredecessorFingerprint = canonicalHash_({
      observationId: text_(predecessor.observation_id),
      businessKey: AKORT.RawStore.businessKey(RAW_TARGET, predecessor),
      value: Number(predecessor.value),
      versionNo: Number(predecessor.version_no),
      loadId: text_(predecessor.load_id)
    });
    var expectedStableFingerprint = canonicalHash_({
      observationId: controller.candidate.predecessorObservationId,
      businessKey: controller.candidate.businessKey,
      value: Number(controller.candidate.predecessorValue),
      versionNo: Number(controller.candidate.predecessorVersionNo),
      loadId: controller.candidate.predecessorLoadId
    });
    assert_(stablePredecessorFingerprint === expectedStableFingerprint,
      'BETA12_E2E_PREDECESSOR_CONTENT_CHANGED',
      'Predecessor immutable content changed during canary load.', {
        retryable: false
      });
    var missing = missingPhases_(operation);
    assert_(missing.length === 0,
      'BETA12_E2E_CANARY_PHASES_INCOMPLETE',
      'Successful canary operation is missing required phases.', {
        retryable: false,
        missingPhases: missing
      });
    return {
      operation: operation,
      checkpoint: cp,
      load: load,
      canary: canary,
      predecessor: predecessor,
      loadId: loadId,
      canaryObservationId: text_(canary.observation_id),
      missingPhases: missing
    };
  }

  function refreshStageFromOperation_(controller, role) {
    var snap = snapshot_();
    var operationId = role === 'CANARY' ?
      controller.canaryOperationId : controller.rollbackOperationId;
    var operation = operationById_(snap.operations, operationId);
    var status = text_(operation.status);
    controller.lastObservedOperationId = operationId;
    controller.lastObservedOperationStatus = status;
    controller.lastObservedAt = AKORT.Core.now();
    if (role === 'CANARY' && status === 'SUCCESS') {
      var canary = validateCanary_(controller);
      controller.canaryLoadId = canary.loadId;
      controller.canaryObservationId = canary.canaryObservationId;
      controller.stage = 'CANARY_SUCCESS';
    } else if (role === 'ROLLBACK' && status === 'SUCCESS') {
      controller.stage = 'ROLLBACK_SUCCESS';
    }
    saveState_(controller);
    return operation;
  }

  function continueLatest() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_CONTINUE_LATEST',
      function () {
        assertAcceptedRuntime_();
        var controller = state_();
        assert_(controller,
          'BETA12_E2E_STATE_MISSING',
          'No owned E2E operation exists to continue.', { retryable: false });
        var role = '';
        var operationId = '';
        if (controller.stage === 'CANARY_SUBMITTED') {
          role = 'CANARY';
          operationId = controller.canaryOperationId;
        } else if (controller.stage === 'ROLLBACK_SUBMITTED') {
          role = 'ROLLBACK';
          operationId = controller.rollbackOperationId;
        } else {
          return AKORT.Result.success(
            'No operation is eligible for continuation at the current decision boundary.',
            {
              stage: controller.stage,
              canaryOperationId: controller.canaryOperationId || '',
              rollbackOperationId: controller.rollbackOperationId || '',
              operationCreated: false,
              rollbackSubmitted: false,
              nextAction: controller.stage === 'CANARY_SUCCESS' ?
                'ROLLBACK_PREVIEW' :
                controller.stage === 'PREVIEW_STORED' ?
                  'ROLLBACK_SUBMIT' :
                  controller.stage === 'ROLLBACK_SUCCESS' ?
                    'FINALIZE' : 'STATUS'
            }
          );
        }
        var before = refreshStageFromOperation_(controller, role);
        if (text_(before.status) === 'SUCCESS') {
          return AKORT.Result.success(
            'Stored operation is already successful; no new operation was created.',
            {
              operationId: operationId,
              role: role,
              stage: state_().stage,
              operationCreated: false
            }
          );
        }
        assert_(!TERMINAL[text_(before.status)],
          'BETA12_E2E_STORED_OPERATION_TERMINAL_FAILURE',
          'Stored operation is terminal and cannot be continued.', {
            retryable: false,
            operationId: operationId,
            status: text_(before.status),
            errorCode: text_(before.error_code),
            errorMessage: text_(before.error_message)
          });
        var runResult = AKORT.OperationEngine.run(operationId, { maxSteps: 50 });
        var updated = state_();
        var after = refreshStageFromOperation_(updated, role);
        var response = {
          operationId: operationId,
          role: role,
          operationStatus: text_(after.status),
          stage: state_().stage,
          runResult: runResult,
          operationCreated: false,
          arbitraryTransition: false
        };
        if (text_(after.status) === 'SUCCESS') {
          return AKORT.Result.success(
            'Only the exact stored operation was continued and completed successfully.',
            response
          );
        }
        if (TERMINAL[text_(after.status)] || runResult && runResult.ok === false) {
          return AKORT.Result.failure(
            text_(after.error_code) || runResult && runResult.code ||
              'BETA12_E2E_CONTINUATION_TERMINAL_FAILURE',
            text_(after.error_message) || runResult && runResult.message ||
              'Stored operation ended in a terminal non-success state.',
            response
          );
        }
        return AKORT.Result.paused(
          'Only the exact stored operation was continued and remains resumable.',
          response
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function previewBinding_(previewData) {
    return {
      targetLoadId: text_(previewData.targetLoad && previewData.targetLoad.loadId),
      targetRowCount: Number(previewData.eligibility && previewData.eligibility.targetRowCount || 0),
      restoredRowCount: Number(previewData.restoration && previewData.restoration.restoredRowCount || 0),
      unrestoredRowCount: Number(previewData.restoration && previewData.restoration.unrestoredRowCount || 0),
      confirmationToken: text_(previewData.confirmationToken),
      lineageFingerprint: text_(previewData.fingerprints && previewData.fingerprints.lineage),
      impactFingerprint: text_(previewData.fingerprints && previewData.fingerprints.impact),
      sourceOperationFingerprint: text_(previewData.fingerprints && previewData.fingerprints.sourceOperation),
      reasonHash: text_(previewData.fingerprints && previewData.fingerprints.reason),
      reason: text_(previewData.reason)
    };
  }

  function assertPreviewBinding_(binding) {
    assert_(binding.targetLoadId && binding.targetRowCount === 1 &&
        binding.restoredRowCount === 1 && binding.unrestoredRowCount === 0 &&
        binding.confirmationToken && binding.lineageFingerprint &&
        binding.impactFingerprint && binding.sourceOperationFingerprint &&
        binding.reasonHash && binding.reason === ROLLBACK_REASON,
      'BETA12_E2E_PREVIEW_BINDING_INVALID',
      'Rollback preview does not satisfy the exact one-row restoration contract.', {
        retryable: false,
        binding: binding
      });
    return binding;
  }

  function bindingsEqual_(left, right) {
    return AKORT.Core.canonicalJson(left) === AKORT.Core.canonicalJson(right);
  }

  function rollbackPreview() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_ROLLBACK_PREVIEW',
      function () {
        assertAcceptedRuntime_();
        restoreEvidence_();
        var controller = state_();
        assert_(controller &&
            (controller.stage === 'CANARY_SUCCESS' ||
             controller.stage === 'PREVIEW_STORED'),
          'BETA12_E2E_PREVIEW_STAGE_INVALID',
          'Rollback preview requires a validated successful canary and no submitted rollback.', {
            retryable: false,
            stage: controller && controller.stage
          });
        var canary = validateCanary_(controller);
        controller.canaryLoadId = canary.loadId;
        controller.canaryObservationId = canary.canaryObservationId;
        var result = AKORT.Beta12RollbackFacade.preview(
          controller.canaryLoadId,
          ROLLBACK_REASON
        );
        if (!result || result.ok === false) return result;
        var data = result.data || {};
        assert_(data.eligibility && data.eligibility.eligible === true,
          'BETA12_E2E_ROLLBACK_PREVIEW_INELIGIBLE',
          'Owned canary load is not eligible for rollback.', {
            retryable: false,
            blockers: data.eligibility && data.eligibility.blockers || []
          });
        var binding = assertPreviewBinding_(previewBinding_(data));
        assert_(binding.targetLoadId === controller.canaryLoadId,
          'BETA12_E2E_PREVIEW_TARGET_MISMATCH',
          'Rollback preview target differs from the owned canary load.', {
            retryable: false,
            expected: controller.canaryLoadId,
            actual: binding.targetLoadId
          });
        if (controller.previewBinding) {
          assert_(bindingsEqual_(controller.previewBinding, binding),
            'BETA12_E2E_PREVIEW_BINDING_DRIFT',
            'A repeated read-only preview produced a different confirmation binding.', {
              retryable: false
            });
        }
        controller.previewBinding = binding;
        controller.previewStoredAt = AKORT.Core.now();
        controller.stage = 'PREVIEW_STORED';
        saveState_(controller);
        return AKORT.Result.success(
          'Eligible read-only rollback preview completed and its exact control-plane binding was stored.',
          {
            stage: controller.stage,
            binding: clone_(binding),
            dataPlaneWrite: false,
            rollbackQueued: false,
            controlStateWrite: true,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: false }
    );
  }

  function rollbackSubmit() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_ROLLBACK_SUBMIT',
      function () {
        assertAcceptedRuntime_();
        restoreEvidence_();
        assertStartWindow_();
        var controller = state_();
        assert_(controller && controller.stage === 'PREVIEW_STORED' &&
            controller.previewBinding,
          'BETA12_E2E_ROLLBACK_SUBMIT_STAGE_INVALID',
          'Rollback submit requires the exact stored preview binding.', {
            retryable: false,
            stage: controller && controller.stage
          });
        var canary = validateCanary_(controller);
        assert_(canary.loadId === controller.previewBinding.targetLoadId,
          'BETA12_E2E_STORED_TARGET_DRIFT',
          'Stored preview target is no longer the exact owned canary load.', {
            retryable: false
          });
        var fresh = AKORT.Beta12RollbackFacade.preview(
          controller.previewBinding.targetLoadId,
          ROLLBACK_REASON
        );
        if (!fresh || fresh.ok === false) return fresh;
        var freshBinding = assertPreviewBinding_(previewBinding_(fresh.data || {}));
        assert_(bindingsEqual_(controller.previewBinding, freshBinding),
          'BETA12_E2E_CONFIRMATION_BINDING_STALE',
          'Fresh preview token or fingerprint differs from the stored binding.', {
            retryable: false,
            stored: controller.previewBinding,
            fresh: freshBinding
          });
        var submitted = AKORT.Beta12RollbackFacade.submit(
          controller.previewBinding.targetLoadId,
          ROLLBACK_REASON,
          controller.previewBinding.confirmationToken
        );
        var operationId = operationIdFromResult_(submitted);
        if (!operationId && submitted && submitted.ok === false) return submitted;
        assert_(operationId,
          'BETA12_E2E_ROLLBACK_OPERATION_ID_MISSING',
          'Beta.1.2 rollback facade did not return an operation_id.', {
            retryable: false,
            resultStatus: submitted && submitted.status,
            resultCode: submitted && submitted.code
          });
        controller.rollbackOperationId = operationId;
        controller.rollbackSubmittedAt = AKORT.Core.now();
        controller.stage = 'ROLLBACK_SUBMITTED';
        saveState_(controller);
        var rollbackOperation = refreshStageFromOperation_(controller, 'ROLLBACK');
        var response = {
          operationId: operationId,
          operationStatus: text_(rollbackOperation.status),
          stage: state_().stage,
          facadeResult: submitted,
          targetLoadId: controller.previewBinding.targetLoadId,
          confirmationToken: controller.previewBinding.confirmationToken,
          selectedNewTarget: false,
          replacedBinding: false
        };
        if (text_(rollbackOperation.status) === 'SUCCESS') {
          return AKORT.Result.success(
            'Rollback completed only for the exact stored canary and confirmation binding.',
            response
          );
        }
        if (submitted && submitted.ok === false ||
            TERMINAL[text_(rollbackOperation.status)]) {
          return AKORT.Result.failure(
            submitted && submitted.code || text_(rollbackOperation.error_code) ||
              'BETA12_E2E_ROLLBACK_TERMINAL_FAILURE',
            submitted && submitted.message || text_(rollbackOperation.error_message) ||
              'Owned rollback operation ended in a non-success state.',
            response
          );
        }
        return AKORT.Result.paused(
          'Rollback was submitted only for the exact stored canary and remains resumable.',
          response
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function validateRollback_(controller) {
    var snap = snapshot_();
    var operation = operationById_(snap.operations, controller.rollbackOperationId);
    assert_(text_(operation.operation_type) === RAW_REVERSAL_TYPE &&
        text_(operation.status) === 'SUCCESS',
      'BETA12_E2E_ROLLBACK_OPERATION_NOT_SUCCESS',
      'Owned rollback operation is not a successful RAW_REVERSAL_V4.', {
        retryable: !TERMINAL[text_(operation.status)],
        operationId: controller.rollbackOperationId,
        status: text_(operation.status)
      });
    var targetLoad = unique_(snap.loads, function (row) {
      return text_(row.load_id) === controller.canaryLoadId;
    }, 'BETA12_E2E_TARGET_LOAD_NOT_UNIQUE', 'Canary target load');
    assert_(text_(targetLoad.status) === 'REVERSED' &&
        Number(targetLoad.rows_reversed) === 1,
      'BETA12_E2E_TARGET_LOAD_NOT_REVERSED',
      'Canary target load is not exactly one-row REVERSED.', {
        retryable: false,
        loadId: controller.canaryLoadId,
        status: targetLoad.status,
        rowsReversed: targetLoad.rows_reversed
      });
    var records = snap.reversals.filter(function (row) {
      return text_(row.operation_id) === controller.rollbackOperationId &&
        text_(row.target_load_id) === controller.canaryLoadId &&
        text_(row.status) === 'SUCCESS';
    });
    assert_(records.length === 1,
      'BETA12_E2E_REVERSAL_LOG_CARDINALITY_INVALID',
      'RAW_REVERSAL_LOG must contain exactly one successful owned record.', {
        retryable: false,
        recordCount: records.length
      });
    var record = records[0];
    assert_(text_(record.reversed_observation_id) === controller.canaryObservationId &&
        text_(record.restored_observation_id) ===
          controller.candidate.predecessorObservationId,
      'BETA12_E2E_REVERSAL_PAIR_MISMATCH',
      'RAW_REVERSAL_LOG does not contain the exact canary-to-predecessor pair.', {
        retryable: false,
        record: record
      });
    var canary = unique_(snap.rows, function (row) {
      return text_(row.observation_id) === controller.canaryObservationId;
    }, 'BETA12_E2E_CANARY_ROW_NOT_UNIQUE', 'Owned canary observation');
    var predecessor = unique_(snap.rows, function (row) {
      return text_(row.observation_id) ===
        controller.candidate.predecessorObservationId;
    }, 'BETA12_E2E_PREDECESSOR_NOT_UNIQUE', 'Predecessor observation');
    assert_(!truthy_(canary.is_latest) && truthy_(predecessor.is_latest) &&
        Number(predecessor.value) === Number(controller.candidate.predecessorValue) &&
        Number(predecessor.version_no) === Number(controller.candidate.predecessorVersionNo),
      'BETA12_E2E_RESTORED_LATEST_STATE_INVALID',
      'Rollback did not restore the exact predecessor latest state.', {
        retryable: false,
        canaryLatest: canary.is_latest,
        predecessorLatest: predecessor.is_latest
      });
    var missing = missingPhases_(operation);
    assert_(missing.length === 0,
      'BETA12_E2E_ROLLBACK_PHASES_INCOMPLETE',
      'Successful rollback operation is missing required Publish, aggregate, reconciliation or audit phases.', {
        retryable: false,
        missingPhases: missing
      });
    var reversalLoadId = text_(record.reversal_load_id);
    var reversalLoad = unique_(snap.loads, function (row) {
      return text_(row.load_id) === reversalLoadId &&
        text_(row.operation_id) === controller.rollbackOperationId;
    }, 'BETA12_E2E_REVERSAL_LOAD_NOT_UNIQUE', 'Reversal load');
    assert_(text_(reversalLoad.status) === 'COMMITTED' &&
        Number(reversalLoad.rows_reversed) === 1,
      'BETA12_E2E_REVERSAL_LOAD_INVALID',
      'Durable reversal load is not a one-row committed reversal.', {
        retryable: false,
        reversalLoadId: reversalLoadId
      });
    return {
      operation: operation,
      targetLoad: targetLoad,
      reversalRecord: record,
      reversalLoad: reversalLoad,
      reversalLoadId: reversalLoadId,
      canary: canary,
      predecessor: predecessor,
      missingPhases: missing,
      snapshot: snap
    };
  }

  function statusLatest() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_STATUS_LATEST',
      function () {
        assertAcceptedRuntime_();
        var controller = state_();
        if (!controller) {
          return AKORT.Result.success('No E2E controller state exists.', {
            stage: 'NOT_STARTED',
            nextAction: 'PREFLIGHT'
          });
        }
        var snap = snapshot_();
        var result = {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          implementationBaseHead: IMPLEMENTATION_BASE_HEAD,
          stage: controller.stage,
          canaryOperationId: controller.canaryOperationId || '',
          canaryLoadId: controller.canaryLoadId || '',
          canaryObservationId: controller.canaryObservationId || '',
          rollbackOperationId: controller.rollbackOperationId || '',
          reversalLoadId: controller.reversalLoadId || '',
          previewBinding: clone_(controller.previewBinding),
          evidenceId: controller.evidenceId || '',
          evidenceFileId: controller.evidenceFileId || '',
          safety: clone_(controller.safety || {}),
          writeBoundary: 'READ_ONLY'
        };
        if (controller.canaryOperationId) {
          var canaryOp = operationById_(snap.operations, controller.canaryOperationId);
          result.canaryOperationStatus = text_(canaryOp.status);
          result.canaryCurrentPhase = text_(canaryOp.current_phase);
        }
        if (controller.rollbackOperationId) {
          var rollbackOp = operationById_(snap.operations, controller.rollbackOperationId);
          result.rollbackOperationStatus = text_(rollbackOp.status);
          result.rollbackCurrentPhase = text_(rollbackOp.current_phase);
        }
        return AKORT.Result.success('Latest owned E2E status loaded without data writes.', result);
      },
      { lock: false, persistLogs: false }
    );
  }

  function check_(id, condition, details) {
    return {
      id: id,
      status: condition ? 'PASS' : 'FAIL',
      details: clone_(details || {})
    };
  }

  function evidenceChecks_(runtime, restore, controller, canary, rollback, unrelated) {
    return [
      check_('EXACT_ACCEPTED_RESTORE_EVIDENCE_BINDING',
        restore.evidenceId === RESTORE_EVIDENCE_ID &&
        restore.evidenceHash === RESTORE_EVIDENCE_HASH &&
        restore.fileSha256 === RESTORE_EVIDENCE_FILE_SHA256,
        restore),
      check_('EXACT_DEV_DWH_AND_PUBLISH_IDS',
        runtime.dwhSpreadsheetId === EXPECTED_DWH_ID &&
        runtime.publishSpreadsheetId === EXPECTED_PUBLISH_ID,
        {
          dwhSpreadsheetId: runtime.dwhSpreadsheetId,
          publishSpreadsheetId: runtime.publishSpreadsheetId
        }),
      check_('CANARY_OPERATION_RAW_LOAD_SUCCESS',
        text_(canary.operation.operation_type) === RAW_LOAD_TYPE &&
        text_(canary.operation.status) === 'SUCCESS',
        { operationId: controller.canaryOperationId }),
      check_('CANARY_EXACTLY_ONE_REVISION',
        Number(canary.load.rows_revised) === 1 &&
        Number(canary.load.rows_inserted) === 0 &&
        Number(canary.load.rows_unchanged) === 0,
        {
          loadId: canary.loadId,
          rowsRevised: canary.load.rows_revised,
          rowsInserted: canary.load.rows_inserted,
          rowsUnchanged: canary.load.rows_unchanged
        }),
      check_('STORED_PREVIEW_BOUND_TO_EXACT_CANARY',
        controller.previewBinding &&
        controller.previewBinding.targetLoadId === canary.loadId &&
        controller.previewBinding.confirmationToken &&
        controller.previewBinding.lineageFingerprint &&
        controller.previewBinding.impactFingerprint &&
        controller.previewBinding.sourceOperationFingerprint &&
        controller.previewBinding.reasonHash,
        clone_(controller.previewBinding)),
      check_('ROLLBACK_OPERATION_RAW_REVERSAL_SUCCESS',
        text_(rollback.operation.operation_type) === RAW_REVERSAL_TYPE &&
        text_(rollback.operation.status) === 'SUCCESS',
        { operationId: controller.rollbackOperationId }),
      check_('TARGET_LOAD_REVERSED_ONE_ROW',
        text_(rollback.targetLoad.status) === 'REVERSED' &&
        Number(rollback.targetLoad.rows_reversed) === 1,
        {
          loadId: controller.canaryLoadId,
          status: rollback.targetLoad.status,
          rowsReversed: rollback.targetLoad.rows_reversed
        }),
      check_('REVERSAL_LOG_EXACT_CANARY_TO_PREDECESSOR',
        text_(rollback.reversalRecord.reversed_observation_id) ===
          controller.canaryObservationId &&
        text_(rollback.reversalRecord.restored_observation_id) ===
          controller.candidate.predecessorObservationId,
        clone_(rollback.reversalRecord)),
      check_('PREDECESSOR_RESTORED_LATEST',
        truthy_(rollback.predecessor.is_latest),
        { observationId: controller.candidate.predecessorObservationId }),
      check_('CANARY_NOT_LATEST',
        !truthy_(rollback.canary.is_latest),
        { observationId: controller.canaryObservationId }),
      check_('PREDECESSOR_VALUE_AND_VERSION_UNCHANGED',
        Number(rollback.predecessor.value) ===
          Number(controller.candidate.predecessorValue) &&
        Number(rollback.predecessor.version_no) ===
          Number(controller.candidate.predecessorVersionNo),
        {
          value: rollback.predecessor.value,
          versionNo: rollback.predecessor.version_no
        }),
      check_('CANARY_FULL_PIPELINE_COMPLETE',
        canary.missingPhases.length === 0,
        { missingPhases: canary.missingPhases }),
      check_('ROLLBACK_FULL_PIPELINE_COMPLETE',
        rollback.missingPhases.length === 0,
        { missingPhases: rollback.missingPhases }),
      check_('NO_UNRELATED_ACTIVE_OPERATIONS',
        unrelated.length === 0,
        { activeOperationIds: unrelated.map(function (row) {
          return text_(row.operation_id);
        }) }),
      check_('SAFETY_BOUNDARY',
        controller.safety &&
        controller.safety.productionTouched === false &&
        controller.safety.activeDevConfigurationChanged === false &&
        controller.safety.physicalDeletion === false &&
        controller.safety.userPipelineEnabled === false,
        clone_(controller.safety))
    ];
  }

  function evidenceFolder_() {
    var root = DriveApp.getFolderById(EXPECTED_DEV_ROOT_ID);
    var iterator = root.getFoldersByName(EVIDENCE_FOLDER_NAME);
    var folders = [];
    while (iterator.hasNext()) folders.push(iterator.next());
    assert_(folders.length <= 1,
      'BETA12_E2E_EVIDENCE_FOLDER_CONFLICT',
      'More than one E2E evidence folder exists.', {
        retryable: false,
        folderName: EVIDENCE_FOLDER_NAME,
        count: folders.length
      });
    return folders[0] || root.createFolder(EVIDENCE_FOLDER_NAME);
  }

  function evidenceHashPayload_(evidence) {
    var payload = {};
    Object.keys(evidence || {}).forEach(function (key) {
      if ([
        'evidenceId', 'evidenceHash',
        'evidenceFileId', 'evidenceFileUrl'
      ].indexOf(key) < 0) {
        payload[key] = clone_(evidence[key]);
      }
    });
    return payload;
  }

  function existingEvidenceFile_(folder, fileName) {
    var iterator = folder.getFilesByName(fileName);
    var files = [];
    while (iterator.hasNext()) files.push(iterator.next());
    assert_(files.length <= 1,
      'BETA12_E2E_EVIDENCE_FILE_CONFLICT',
      'More than one immutable E2E evidence file has the expected name.', {
        retryable: false,
        fileName: fileName,
        count: files.length
      });
    return files[0] || null;
  }

  function finalizeLatest() {
    return AKORT.Core.safeRun(
      'BETA12_ROLLBACK_E2E_FINALIZE_LATEST',
      function () {
        var runtime = assertAcceptedRuntime_();
        var restore = restoreEvidence_();
        var controller = state_();
        assert_(controller &&
            (controller.stage === 'ROLLBACK_SUCCESS' ||
             controller.stage === 'FINALIZED'),
          'BETA12_E2E_FINALIZE_STAGE_INVALID',
          'Finalize requires a successful owned rollback.', {
            retryable: false,
            stage: controller && controller.stage
          });
        if (controller.stage === 'FINALIZED') {
          var existingFile = DriveApp.getFileById(controller.evidenceFileId);
          var existingContent = existingFile.getBlob().getDataAsString('UTF-8');
          assert_(AKORT.Core.sha256(existingContent) === controller.evidenceFileSha256,
            'BETA12_E2E_FINAL_EVIDENCE_DRIFT',
            'Final immutable evidence file content changed.', {
              retryable: false,
              evidenceFileId: controller.evidenceFileId
            });
          return AKORT.Result.success(
            'E2E evidence is already finalized and unchanged. Do not rerun E2E functions.',
            {
              stage: 'FINALIZED',
              evidenceId: controller.evidenceId,
              evidenceHash: controller.evidenceHash,
              evidenceFileId: controller.evidenceFileId,
              evidenceFileUrl: existingFile.getUrl(),
              evidenceFileSha256: controller.evidenceFileSha256,
              reused: true
            }
          );
        }
        var canary = validateCanary_(controller, true);
        var rollback = validateRollback_(controller);
        controller.reversalLoadId = rollback.reversalLoadId;
        var unrelated = activeOperations_(rollback.snapshot.operations, [
          controller.canaryOperationId,
          controller.rollbackOperationId
        ]);
        var checks = evidenceChecks_(
          runtime, restore, controller, canary, rollback, unrelated
        );
        var passed = checks.filter(function (check) {
          return check.status === 'PASS';
        }).length;
        assert_(passed === checks.length && checks.length >= 12,
          'BETA12_E2E_ACCEPTANCE_CHECKS_FAILED',
          'One or more final E2E acceptance checks failed.', {
            retryable: false,
            checksTotal: checks.length,
            checksPassed: passed,
            failedChecks: checks.filter(function (check) {
              return check.status !== 'PASS';
            })
          });
        var evidence = {
          schemaVersion: CONTRACT_VERSION,
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          implementationBaseBranch: IMPLEMENTATION_BASE_BRANCH,
          currentCommit: IMPLEMENTATION_BASE_HEAD,
          baseRelease: BASE_RELEASE,
          acceptedRestoreEvidenceId: RESTORE_EVIDENCE_ID,
          acceptedRestoreEvidenceHash: RESTORE_EVIDENCE_HASH,
          acceptedRestoreEvidenceFileId: RESTORE_EVIDENCE_FILE_ID,
          acceptedRestoreEvidenceFileSha256: RESTORE_EVIDENCE_FILE_SHA256,
          canaryOperationId: controller.canaryOperationId,
          canaryLoadId: canary.loadId,
          canaryObservationId: canary.canaryObservationId,
          predecessorObservationId: controller.candidate.predecessorObservationId,
          predecessorLoadId: controller.candidate.predecessorLoadId,
          rollbackOperationId: controller.rollbackOperationId,
          reversalLoadId: rollback.reversalLoadId,
          confirmationToken: controller.previewBinding.confirmationToken,
          lineageFingerprint: controller.previewBinding.lineageFingerprint,
          impactFingerprint: controller.previewBinding.impactFingerprint,
          sourceOperationFingerprint:
            controller.previewBinding.sourceOperationFingerprint,
          reasonHash: controller.previewBinding.reasonHash,
          reason: ROLLBACK_REASON,
          checks: checks,
          checksTotal: checks.length,
          checksPassed: passed,
          safety: {
            productionTouched: false,
            activeDevConfigurationChanged: false,
            physicalDeletion: false,
            userPipelineEnabled: false,
            unrelatedActiveOperations: 0,
            newQueue: false,
            newExecutor: false,
            newHandler: false,
            triggerCreated: false,
            triggerDeleted: false,
            evidenceCleanupPerformed: false
          },
          completedAt: AKORT.Core.now(),
          createdBy: (function () {
            try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
            catch (ignored) { return 'unknown'; }
          })()
        };
        var evidenceHash = canonicalHash_(evidenceHashPayload_(evidence));
        var evidenceId = 'B12E2E_' + evidenceHash.slice(0, 24).toUpperCase();
        evidence.evidenceId = evidenceId;
        evidence.evidenceHash = evidenceHash;
        var folder = evidenceFolder_();
        var fileName = 'AKORT_BETA12_ROLLBACK_E2E_EVIDENCE__' + evidenceId + '.json';
        var file = existingEvidenceFile_(folder, fileName);
        if (!file) {
          file = folder.createFile(fileName, '{}', MimeType.PLAIN_TEXT);
          evidence.evidenceFileId = file.getId();
          evidence.evidenceFileUrl = file.getUrl();
          file.setContent(JSON.stringify(evidence, null, 2));
        } else {
          var existing = parseJson_(
            file.getBlob().getDataAsString('UTF-8'),
            'BETA12_E2E_EXISTING_EVIDENCE_INVALID',
            'Existing E2E evidence file'
          );
          assert_(text_(existing.evidenceId) === evidenceId &&
              text_(existing.evidenceHash) === evidenceHash,
            'BETA12_E2E_EXISTING_EVIDENCE_MISMATCH',
            'Existing E2E evidence file does not match the finalized evidence.', {
              retryable: false,
              fileId: file.getId()
            });
          evidence = existing;
        }
        var finalContent = file.getBlob().getDataAsString('UTF-8');
        var fileSha256 = AKORT.Core.sha256(finalContent);
        controller.stage = 'FINALIZED';
        controller.evidenceId = evidenceId;
        controller.evidenceHash = evidenceHash;
        controller.evidenceFileId = file.getId();
        controller.evidenceFileUrl = file.getUrl();
        controller.evidenceFileSha256 = fileSha256;
        controller.finalizedAt = evidence.completedAt;
        saveState_(controller);
        return AKORT.Result.success(
          'Beta.1.2 controlled rollback E2E passed and immutable evidence was saved.',
          {
            stage: controller.stage,
            checksTotal: checks.length,
            checksPassed: passed,
            evidenceId: evidenceId,
            evidenceHash: evidenceHash,
            evidenceFileId: file.getId(),
            evidenceFileUrl: file.getUrl(),
            evidenceFileSha256: fileSha256,
            safety: clone_(evidence.safety),
            nextAction: 'DO_NOT_RERUN_E2E_FUNCTIONS'
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      implementationBaseBranch: IMPLEMENTATION_BASE_BRANCH,
      implementationBaseHead: IMPLEMENTATION_BASE_HEAD,
      baseRelease: BASE_RELEASE,
      acceptedBindings: {
        rollbackFacadePackage: FACADE_PACKAGE,
        rollbackFacadeContract: FACADE_CONTRACT,
        operationalHardeningPackage: HARDENING_PACKAGE,
        operationalHardeningContract: HARDENING_CONTRACT,
        restorePackage: RESTORE_PACKAGE,
        restoreContract: RESTORE_CONTRACT,
        restoreEvidenceId: RESTORE_EVIDENCE_ID,
        restoreEvidenceHash: RESTORE_EVIDENCE_HASH,
        restoreEvidenceFileSha256: RESTORE_EVIDENCE_FILE_SHA256
      },
      operations: {
        canary: RAW_LOAD_TYPE,
        rollback: RAW_REVERSAL_TYPE,
        canaryRows: 1,
        targetTable: RAW_TARGET
      },
      candidatePolicy: {
        registeredLineageMode: REGISTERED_LINEAGE_MODE,
        legacyLineageMode: LEGACY_LINEAGE_MODE,
        legacyRequiresNoRegistryRow: true,
        legacyRequiresVersionOneInitial: true,
        rowAndLineageFingerprintsRequired: true
      },
      publicFunctions: [
        'AKORT_beta12RollbackE2EPreflight',
        'AKORT_beta12RollbackE2ECanarySubmit',
        'AKORT_beta12RollbackE2EContinueLatest',
        'AKORT_beta12RollbackE2ERollbackPreview',
        'AKORT_beta12RollbackE2ERollbackSubmit',
        'AKORT_beta12RollbackE2EStatusLatest',
        'AKORT_beta12RollbackE2EFinalizeLatest',
        'AKORT_beta12RollbackE2EContract'
      ],
      decisionBoundaries: {
        preflight: 'READ_ONLY',
        canarySubmit: 'ONE_OWNED_RAW_LOAD_ONLY',
        continueLatest: 'EXACT_STORED_OPERATION_ONLY',
        rollbackPreview: 'READ_ONLY_DATA_PLANE_CONTROL_BINDING_ONLY',
        rollbackSubmit: 'EXACT_STORED_TARGET_AND_BINDING_ONLY',
        statusLatest: 'READ_ONLY',
        finalizeLatest: 'VERIFY_AND_WRITE_EVIDENCE_ONLY'
      },
      safety: {
        failClosed: true,
        newQueue: false,
        newExecutor: false,
        newHandler: false,
        newTable: false,
        createsTrigger: false,
        deletesData: false,
        physicalCleanup: false,
        productionWrite: false,
        changesActiveDevConfiguration: false,
        enablesUserPipeline: false
      }
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    ImplementationBaseBranch: IMPLEMENTATION_BASE_BRANCH,
    ImplementationBaseHead: IMPLEMENTATION_BASE_HEAD,
    BaseRelease: BASE_RELEASE,
    preflight: preflight,
    canarySubmit: canarySubmit,
    continueLatest: continueLatest,
    rollbackPreview: rollbackPreview,
    rollbackSubmit: rollbackSubmit,
    statusLatest: statusLatest,
    finalizeLatest: finalizeLatest,
    contract: contract,
    Test: Object.freeze({
      canaryValue: canaryValue_,
      sourceIdentityProtected: sourceIdentityProtected_,
      bindingsEqual: bindingsEqual_,
      candidateFingerprint: candidateFingerprint_,
      candidateFromSnapshot: candidateFromSnapshot_,
      previewBinding: previewBinding_,
      assertPreviewBinding: assertPreviewBinding_,
      evidenceHashPayload: evidenceHashPayload_,
      fullPhases: FULL_PHASES.slice(),
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      rollbackReason: ROLLBACK_REASON
    })
  });
})();

function AKORT_beta12RollbackE2EPreflight() {
  var result = AKORT.Beta12RollbackE2E.preflight();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2ECanarySubmit() {
  var result = AKORT.Beta12RollbackE2E.canarySubmit();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2EContinueLatest() {
  var result = AKORT.Beta12RollbackE2E.continueLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2ERollbackPreview() {
  var result = AKORT.Beta12RollbackE2E.rollbackPreview();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2ERollbackSubmit() {
  var result = AKORT.Beta12RollbackE2E.rollbackSubmit();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2EStatusLatest() {
  var result = AKORT.Beta12RollbackE2E.statusLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2EFinalizeLatest() {
  var result = AKORT.Beta12RollbackE2E.finalizeLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta12RollbackE2EContract() {
  var result = AKORT.Result.success(
    'Beta.1.2 fail-closed rollback E2E contract loaded.',
    AKORT.Beta12RollbackE2E.contract()
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}
