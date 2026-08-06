var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.2.2: user load workflow facade for the accepted AKORT 4.0 pipeline.
 *
 * REUSE-FIRST / GAP-ONLY:
 * - file inspection and preview use AKORT.ExistingSourceParsers;
 * - guarded enqueue uses AKORT.Beta14OperationalHardening;
 * - execution, resume and status use the accepted Operation Engine;
 * - Industry uses the accepted AKORT.IndustryInput facade;
 * - no parser, loader, queue, executor, dispatcher, RAW, Publish or calculation
 *   logic is implemented here.
 */
AKORT.Beta22UserLoadWorkflow = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.2.2.4';
  var CONTRACT_VERSION = '4.0-beta22-user-load-workflow-4';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '1512fbfd99769d208efc141154fbc0fb42a4f650';

  var INCOMING_FOLDER_PROPERTY = 'AKORT_BETA22_INCOMING_FOLDER_ID';
  var CONFIRMATION_SECRET_PROPERTY = 'AKORT_BETA22_CONFIRMATION_SECRET';
  var CONTROLLED_SUBMIT_PROPERTY = 'AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED';
  var CONFIRMATION_SCHEMA = '4.0-beta22-load-confirmation-1';
  var OPERATION_BINDING_SCHEMA = '4.0-beta22-operation-binding-1';
  var CONFIRMATION_TTL_MS = 10 * 60 * 1000;
  var MAX_INCOMING_FILES = 50;
  var MAX_INCOMING_SCAN = 200;
  var MAX_PREVIEW_ISSUES = 50;
  var MAX_OPERATION_STEP_SUMMARIES = 12;
  var MAX_OPERATION_MESSAGE_CHARS = 1000;
  var OPERATION_PHASE_COUNT = 16;
  var ACCEPTED_PARSER_TEMPORARY_CONVERSION = true;
  var SOURCE_RECHECK_PHASES = Object.freeze({
    DISCOVER: true,
    VALIDATE: true,
    PARSE: true
  });

  var SUPPORTED_MIME_TYPES = {
    'application/vnd.google-apps.spreadsheet': true,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
    'application/vnd.ms-excel': true
  };

  var REQUIRED_DEPENDENCIES = [
    'AKORT.Config.readSystemSettings',
    'AKORT.ExistingSourceParsers.inspectFile',
    'AKORT.ExistingSourceParsers.previewFile',
    'AKORT.Beta14OperationalHardening.enqueueGuarded',
    'AKORT.OperationEngine.status',
    'AKORT.OperationEngine.resume',
    'AKORT.IndustryInput.status',
    'AKORT.IndustryInput.validate',
    'AKORT.IndustryInput.submit',
    'AKORT.Beta21ReadOnlyControlCenter.Test.accessStatus',
    'Utilities.computeHmacSha256Signature'
  ];

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      text_(value).toUpperCase() === 'TRUE';
  }

  function clone_(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  function clippedText_(value, maximum) {
    var normalized = text_(value);
    maximum = Math.max(0, Number(maximum || 0));
    return maximum && normalized.length > maximum
      ? normalized.slice(0, maximum) + '…'
      : normalized;
  }

  function resolvePath_(path) {
    var current = typeof globalThis !== 'undefined' ? globalThis : this;
    String(path || '').split('.').forEach(function (part) {
      current = current && current[part];
    });
    return current;
  }

  function dependencyStatus_() {
    return REQUIRED_DEPENDENCIES.map(function (path) {
      return { path: path, available: typeof resolvePath_(path) === 'function' };
    });
  }

  function assertDependencies_() {
    var missing = dependencyStatus_().filter(function (item) {
      return !item.available;
    }).map(function (item) {
      return item.path;
    });
    if (missing.length) {
      throw AKORT.Core.error(
        'BETA22_ACCEPTED_DEPENDENCY_MISSING',
        'An accepted Beta.2.2 dependency is unavailable.',
        { missing: missing, retryable: false, nextAction: 'RESTORE_ACCEPTED_BASE' }
      );
    }
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA22_BASE_RELEASE_MISMATCH',
        'Beta.2.2 requires the accepted Alpha.7.4 runtime.',
        { expected: BASE_RELEASE, actual: AKORT.Release.version, retryable: false }
      );
    }
    assertDependencies_();
  }

  function accessStatus_() {
    return clone_(AKORT.Beta21ReadOnlyControlCenter.Test.accessStatus());
  }

  function assertAccess_() {
    var access = accessStatus_();
    if (!access || access.authorized !== true || !text_(access.email)) {
      throw AKORT.Core.error(
        'BETA22_ACCESS_DENIED',
        'The current user is not authorized for the user load workflow.',
        {
          emailAvailable: Boolean(access && access.email),
          accessMode: text_(access && access.mode),
          retryable: false,
          nextAction: 'REVIEW_WEB_APP_ACCESS'
        }
      );
    }
    return access;
  }

  function properties_() {
    return PropertiesService.getScriptProperties();
  }

  function configuration_() {
    var properties = properties_();
    return {
      incomingFolderId: text_(properties.getProperty(INCOMING_FOLDER_PROPERTY)),
      confirmationSecretConfigured: Boolean(text_(properties.getProperty(CONFIRMATION_SECRET_PROPERTY))),
      controlledSubmitEnabled: truthy_(properties.getProperty(CONTROLLED_SUBMIT_PROPERTY))
    };
  }

  function confirmationSecret_() {
    var secret = text_(properties_().getProperty(CONFIRMATION_SECRET_PROPERTY));
    if (!secret) {
      throw AKORT.Core.error(
        'BETA22_CONFIRMATION_SECRET_MISSING',
        'Beta.2.2 confirmation secret is not configured.',
        { retryable: false, nextAction: 'CONFIGURE_BETA22_CONFIRMATION_SECRET' }
      );
    }
    return secret;
  }

  function userPipelineEnabled_() {
    var settings = AKORT.Config.readSystemSettings();
    return truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED);
  }

  function writeGate_() {
    var config = configuration_();
    var userPipelineEnabled = userPipelineEnabled_();
    var controlled = config.controlledSubmitEnabled && !userPipelineEnabled;
    return {
      enabled: controlled,
      mode: controlled
        ? 'BETA22_CONTROLLED_ACCEPTANCE'
        : (userPipelineEnabled ? 'BETA27_USER_GUARD_ADAPTER_REQUIRED' : 'DISABLED'),
      userPipelineEnabled: userPipelineEnabled,
      controlledSubmitEnabled: config.controlledSubmitEnabled,
      beta27CompatibilityRequired: userPipelineEnabled
    };
  }

  function assertWriteGate_() {
    var gate = writeGate_();
    if (!gate.enabled) {
      throw AKORT.Core.error(
        'BETA22_SUBMIT_DISABLED',
        'User submit is disabled until the Beta.2.2 controlled acceptance gate is explicitly opened. Final user-pipeline compatibility is a Beta.2.7 activation gate.',
        { retryable: false, writeGate: gate, nextAction: 'WAIT_FOR_AUTHORIZED_WRITE_GATE' }
      );
    }
    return gate;
  }

  function requireSuccess_(name, result) {
    if (!result || result.ok !== true) {
      throw AKORT.Core.error(
        'BETA22_ACCEPTED_API_FAILED',
        'An accepted API used by Beta.2.2 failed.',
        {
          dependency: name,
          code: text_(result && result.code),
          status: text_(result && result.status),
          message: text_(result && result.message),
          details: clone_(result && (result.details || result.data)),
          retryable: false,
          nextAction: 'REVIEW_ACCEPTED_PIPELINE'
        }
      );
    }
    return result.data || {};
  }

  function delegateAcceptedResult_(name, result) {
    if (!result || typeof result.ok !== 'boolean') {
      throw AKORT.Core.error(
        'BETA22_ACCEPTED_API_RESULT_INVALID',
        'An accepted API returned an invalid result envelope.',
        {
          dependency: name,
          retryable: false,
          nextAction: 'REVIEW_ACCEPTED_PIPELINE'
        }
      );
    }
    return clone_(result);
  }

  function incomingFolder_() {
    var folderId = configuration_().incomingFolderId;
    if (!folderId) {
      throw AKORT.Core.error(
        'BETA22_INCOMING_FOLDER_NOT_CONFIGURED',
        'Beta.2.2 incoming folder is not configured.',
        { retryable: false, nextAction: 'CONFIGURE_BETA22_INCOMING_FOLDER' }
      );
    }
    try {
      return DriveApp.getFolderById(folderId);
    } catch (caught) {
      throw AKORT.Core.error(
        'BETA22_INCOMING_FOLDER_UNAVAILABLE',
        'Beta.2.2 incoming folder is unavailable.',
        { folderId: folderId, cause: String(caught), retryable: false }
      );
    }
  }

  function supportedFile_(file) {
    return Boolean(SUPPORTED_MIME_TYPES[text_(file.getMimeType())]);
  }

  function fileDto_(file) {
    var updated = file.getLastUpdated();
    return {
      fileId: file.getId(),
      fileName: file.getName(),
      mimeType: file.getMimeType(),
      sizeBytes: Number(file.getSize() || 0),
      updatedAt: updated && typeof updated.toISOString === 'function'
        ? updated.toISOString()
        : text_(updated),
      url: 'https://drive.google.com/open?id=' + encodeURIComponent(file.getId()),
      supported: supportedFile_(file)
    };
  }

  function directParentMatches_(file, folderId) {
    var parents = file.getParents();
    while (parents.hasNext()) {
      if (text_(parents.next().getId()) === text_(folderId)) return true;
    }
    return false;
  }

  function assertIncomingFile_(fileId) {
    fileId = text_(fileId);
    if (!fileId) {
      throw AKORT.Core.error('BETA22_FILE_ID_REQUIRED', 'A file ID is required.', { retryable: false });
    }
    var folder = incomingFolder_();
    var file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (caught) {
      throw AKORT.Core.error(
        'BETA22_FILE_UNAVAILABLE',
        'The selected file is unavailable.',
        { fileId: fileId, cause: String(caught), retryable: false }
      );
    }
    if (!directParentMatches_(file, folder.getId())) {
      throw AKORT.Core.error(
        'BETA22_FILE_OUTSIDE_INCOMING_FOLDER',
        'The selected file is not a direct child of the approved incoming folder.',
        { fileId: fileId, incomingFolderId: folder.getId(), retryable: false }
      );
    }
    if (!supportedFile_(file)) {
      throw AKORT.Core.error(
        'BETA22_FILE_TYPE_UNSUPPORTED',
        'The selected file type is not supported by the approved source parsers.',
        { fileId: fileId, mimeType: file.getMimeType(), retryable: false }
      );
    }
    return file;
  }

  function normalizedOptions_(input) {
    input = input || {};
    var options = {
      profileId: text_(input.profileId),
      year: text_(input.year),
      month: text_(input.month),
      week: text_(input.week),
      sourcePublishedAt: text_(input.sourcePublishedAt)
    };
    Object.keys(options).forEach(function (key) {
      if (options[key] === '') delete options[key];
    });
    return options;
  }

  function issueSeverity_(issue) {
    return text_(issue && issue.severity).toUpperCase();
  }

  function blockingIssues_(issues) {
    return (issues || []).filter(function (issue) {
      return ['ERROR', 'BLOCKER', 'CRITICAL'].indexOf(issueSeverity_(issue)) >= 0;
    });
  }

  function acceptedPreview_(fileId, options) {
    assertIncomingFile_(fileId);
    var preview = requireSuccess_(
      'AKORT.ExistingSourceParsers.previewFile',
      AKORT.ExistingSourceParsers.previewFile(fileId, normalizedOptions_(options))
    );
    var resolved = normalizedOptions_(preview.resolvedOptions || options || {});
    if (preview.profile && preview.profile.profileId) {
      resolved.profileId = text_(preview.profile.profileId);
    }
    var issues = (preview.issues || []).slice(0, MAX_PREVIEW_ISSUES);
    var blockers = blockingIssues_(preview.issues || []);
    var rowCount = Number(preview.normalizedRowCount || 0);
    return {
      fileId: text_(preview.fileId || fileId),
      fileName: text_(preview.fileName),
      sourceHash: text_(preview.sourceHash),
      structuralFingerprint: text_(preview.structuralFingerprint),
      profile: clone_(preview.profile || {}),
      confidence: clone_(preview.confidence || {}),
      resolvedOptions: resolved,
      sourceObservationCount: Number(preview.sourceObservationCount || 0),
      normalizedRowCount: rowCount,
      monitoringScope: clone_(preview.monitoringScope || {}),
      issues: clone_(issues),
      issueCount: Number((preview.issues || []).length),
      blockingIssueCount: blockers.length,
      sampleRows: clone_(preview.sampleRows || []),
      ready: rowCount > 0 && blockers.length === 0,
      duplicateResolution: 'DETERMINED_BY_ACCEPTED_RAW_STORE_DURING_COMMIT'
    };
  }

  function bindingFromPreview_(preview, userEmail, issuedAt, expiresAt) {
    return {
      schemaVersion: CONFIRMATION_SCHEMA,
      fileId: preview.fileId,
      fileName: preview.fileName,
      sourceHash: preview.sourceHash,
      structuralFingerprint: preview.structuralFingerprint,
      profileId: text_(preview.profile && preview.profile.profileId),
      targetTable: text_(preview.profile && preview.profile.targetTable),
      normalizedRowCount: Number(preview.normalizedRowCount || 0),
      options: clone_(preview.resolvedOptions || {}),
      userEmail: text_(userEmail).toLowerCase(),
      issuedAt: issuedAt,
      expiresAt: expiresAt
    };
  }

  function hexBytes_(bytes) {
    return (bytes || []).map(function (value) {
      var normalized = Number(value);
      if (normalized < 0) normalized += 256;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function confirmationSignature_(binding) {
    return hexBytes_(Utilities.computeHmacSha256Signature(
      'BETA22_CONFIRMATION|' + AKORT.Core.canonicalJson(binding),
      confirmationSecret_(),
      Utilities.Charset.UTF_8
    ));
  }

  function buildConfirmation_(preview, userEmail) {
    var now = Date.now();
    var binding = bindingFromPreview_(
      preview,
      userEmail,
      new Date(now).toISOString(),
      new Date(now + CONFIRMATION_TTL_MS).toISOString()
    );
    return {
      binding: binding,
      signature: confirmationSignature_(binding)
    };
  }

  function assertConfirmation_(confirmation, access) {
    confirmation = confirmation || {};
    var binding = confirmation.binding || {};
    var signature = text_(confirmation.signature);
    if (text_(binding.schemaVersion) !== CONFIRMATION_SCHEMA || !signature) {
      throw AKORT.Core.error(
        'BETA22_CONFIRMATION_INVALID',
        'The load confirmation is missing or invalid.',
        { retryable: false, nextAction: 'REPEAT_PREVIEW' }
      );
    }
    if (signature !== confirmationSignature_(binding)) {
      throw AKORT.Core.error(
        'BETA22_CONFIRMATION_SIGNATURE_MISMATCH',
        'The load confirmation signature does not match the preview.',
        { retryable: false, nextAction: 'REPEAT_PREVIEW' }
      );
    }
    var expiresMs = Date.parse(text_(binding.expiresAt));
    if (isNaN(expiresMs) || expiresMs < Date.now()) {
      throw AKORT.Core.error(
        'BETA22_CONFIRMATION_EXPIRED',
        'The load confirmation has expired.',
        { expiresAt: binding.expiresAt, retryable: false, nextAction: 'REPEAT_PREVIEW' }
      );
    }
    if (text_(binding.userEmail).toLowerCase() !== text_(access.email).toLowerCase()) {
      throw AKORT.Core.error(
        'BETA22_CONFIRMATION_USER_MISMATCH',
        'The load confirmation belongs to another user.',
        { retryable: false, nextAction: 'REPEAT_PREVIEW' }
      );
    }
    return clone_(binding);
  }

  function assertAcknowledgment_(acknowledgment, binding) {
    acknowledgment = acknowledgment || {};
    var acknowledged = acknowledgment.acknowledged === true;
    var fileIdMatches = text_(acknowledgment.fileId) === text_(binding.fileId);
    var fileNameMatches = text_(acknowledgment.fileName) === text_(binding.fileName);
    if (!acknowledged || !fileIdMatches || !fileNameMatches) {
      throw AKORT.Core.error(
        'BETA22_USER_CONFIRMATION_REQUIRED',
        'Explicit confirmation of the exact signed file is required.',
        {
          acknowledged: acknowledged,
          fileIdMatches: fileIdMatches,
          fileNameMatches: fileNameMatches,
          retryable: false,
          nextAction: 'REVIEW_AND_CONFIRM_EXACT_FILE'
        }
      );
    }
    return {
      acknowledged: true,
      fileId: text_(binding.fileId),
      fileName: text_(binding.fileName)
    };
  }

  function assertPreviewUnchanged_(binding, preview) {
    var actual = {
      fileId: preview.fileId,
      fileName: preview.fileName,
      sourceHash: preview.sourceHash,
      structuralFingerprint: preview.structuralFingerprint,
      profileId: text_(preview.profile && preview.profile.profileId),
      targetTable: text_(preview.profile && preview.profile.targetTable),
      normalizedRowCount: Number(preview.normalizedRowCount || 0),
      options: clone_(preview.resolvedOptions || {})
    };
    var expected = {
      fileId: text_(binding.fileId),
      fileName: text_(binding.fileName),
      sourceHash: text_(binding.sourceHash),
      structuralFingerprint: text_(binding.structuralFingerprint),
      profileId: text_(binding.profileId),
      targetTable: text_(binding.targetTable),
      normalizedRowCount: Number(binding.normalizedRowCount || 0),
      options: clone_(binding.options || {})
    };
    if (AKORT.Core.canonicalJson(expected) !== AKORT.Core.canonicalJson(actual)) {
      throw AKORT.Core.error(
        'BETA22_PREVIEW_CHANGED',
        'The file or its resolved loading contract changed after preview.',
        { expected: expected, actual: actual, retryable: false, nextAction: 'REPEAT_PREVIEW' }
      );
    }
    if (!preview.ready) {
      throw AKORT.Core.error(
        'BETA22_PREVIEW_BLOCKED',
        'The repeated preview contains blockers or zero normalized rows.',
        { preview: preview, retryable: false, nextAction: 'FIX_SOURCE_FILE' }
      );
    }
  }

  function idempotencyKey_(binding) {
    return 'BETA22|' + AKORT.Core.sha256(AKORT.Core.canonicalJson({
      operationType: AKORT.ExistingSourceParsers.OperationType,
      fileId: binding.fileId,
      sourceHash: binding.sourceHash,
      profileId: binding.profileId,
      options: binding.options || {}
    }));
  }

  function operationStepSummaries_(steps) {
    steps = Array.isArray(steps) ? steps : [];
    return steps.slice(Math.max(0, steps.length - MAX_OPERATION_STEP_SUMMARIES)).map(function (step) {
      return {
        stepId: text_(step.step_id),
        phase: text_(step.phase),
        status: text_(step.status),
        attemptNo: Number(step.attempt_no || 0),
        startedAt: text_(step.started_at),
        finishedAt: text_(step.finished_at),
        errorCode: clippedText_(step.error_code, 200),
        errorMessage: clippedText_(step.error_message, 500)
      };
    });
  }

  function operationDto_(data) {
    data = data || {};
    var operation = data.operation || {};
    var checkpoint = operation.checkpoint || {};
    var completed = checkpoint.completedPhases || [];
    var handlerState = checkpoint.handlerState || {};
    var rawState = handlerState.rawStore || checkpoint.rawStore || handlerState || {};
    var steps = Array.isArray(data.steps) ? data.steps : [];
    var summaries = operationStepSummaries_(steps);
    return {
      operationId: text_(data.operationId || operation.operation_id),
      operationType: text_(operation.operation_type),
      status: text_(operation.status),
      phase: text_(operation.current_phase || checkpoint.nextPhase),
      attemptNo: Number(operation.attempt_no || 0),
      maxAttempts: Number(operation.max_attempts || 0),
      progressPercent: Math.min(100, Math.round(completed.length / OPERATION_PHASE_COUNT * 100)),
      loadId: text_(rawState.loadId || rawState.load_id),
      errorCode: clippedText_(operation.error_code, 200),
      errorMessage: clippedText_(operation.error_message, MAX_OPERATION_MESSAGE_CHARS),
      requestedAt: text_(operation.requested_at),
      startedAt: text_(operation.started_at),
      finishedAt: text_(operation.finished_at),
      nextAction: operation.status === 'SUCCESS'
        ? 'NONE'
        : (operation.status === 'PAUSED' || operation.status === 'RETRY_PENDING' || operation.status === 'QUEUED'
          ? 'CONTINUE'
          : (operation.status === 'RUNNING' ? 'WAIT' : 'REVIEW')),
      stepCount: Number(data.stepCount || steps.length || 0),
      displayedStepCount: summaries.length,
      stepsTruncated: Number(data.stepCount || steps.length || 0) > summaries.length,
      steps: summaries
    };
  }

  function workflowOperationBinding_(binding, access) {
    return {
      schemaVersion: OPERATION_BINDING_SCHEMA,
      confirmationSchemaVersion: text_(binding.schemaVersion),
      userEmail: text_(access && access.email).toLowerCase(),
      fileId: text_(binding.fileId),
      sourceHash: text_(binding.sourceHash),
      structuralFingerprint: text_(binding.structuralFingerprint),
      profileId: text_(binding.profileId),
      targetTable: text_(binding.targetTable),
      normalizedRowCount: Number(binding.normalizedRowCount || 0),
      options: clone_(binding.options || {}),
      confirmationFingerprint: AKORT.Core.sha256(AKORT.Core.canonicalJson(binding))
    };
  }

  function assertSourceFileOperation_(operationData, access) {
    var operation = operationData && operationData.operation || {};
    var checkpoint = operation.checkpoint || {};
    var input = checkpoint.input || {};
    var workflow = input.beta22Binding || {};
    var idempotencyKey = text_(checkpoint.meta && checkpoint.meta.idempotencyKey);
    var type = text_(operation.operation_type);
    if (type !== text_(AKORT.ExistingSourceParsers.OperationType)) {
      throw AKORT.Core.error(
        'BETA22_OPERATION_TYPE_NOT_ALLOWED',
        'Only the accepted source-file load operation is allowed in this workflow.',
        { operationType: type, retryable: false }
      );
    }
    var expectedKey = 'BETA22|' + AKORT.Core.sha256(AKORT.Core.canonicalJson({
      operationType: type,
      fileId: text_(workflow.fileId),
      sourceHash: text_(workflow.sourceHash),
      profileId: text_(workflow.profileId),
      options: clone_(workflow.options || {})
    }));
    var inputMatches =
      text_(input.fileId) === text_(workflow.fileId) &&
      text_(input.sourceId) === text_(workflow.fileId) &&
      text_(input.profileId) === text_(workflow.profileId) &&
      normalizedOptions_(input).profileId === text_(workflow.profileId) &&
      AKORT.Core.canonicalJson(normalizedOptions_(input)) ===
        AKORT.Core.canonicalJson(workflow.options || {});
    var userMatches = text_(workflow.userEmail).toLowerCase() ===
      text_(access && access.email).toLowerCase();
    var bindingComplete =
      text_(workflow.schemaVersion) === OPERATION_BINDING_SCHEMA &&
      Boolean(text_(workflow.fileId)) &&
      Boolean(text_(workflow.sourceHash)) &&
      Boolean(text_(workflow.profileId)) &&
      Boolean(text_(workflow.targetTable)) &&
      Number(workflow.normalizedRowCount || 0) > 0 &&
      Boolean(text_(workflow.confirmationFingerprint));
    if (!bindingComplete || !inputMatches || !userMatches ||
        idempotencyKey !== expectedKey) {
      throw AKORT.Core.error(
        'BETA22_OPERATION_BINDING_NOT_ALLOWED',
        'The operation is not an exact Beta.2.2 workflow operation for the current user.',
        {
          operationId: text_(operationData && operationData.operationId || operation.operation_id),
          operationType: type,
          bindingSchemaVersion: text_(workflow.schemaVersion),
          bindingComplete: bindingComplete,
          inputMatches: inputMatches,
          idempotencyKeyMatches: idempotencyKey === expectedKey,
          userMatches: userMatches,
          retryable: false,
          nextAction: 'USE_EXACT_BETA22_OPERATION_ID'
        }
      );
    }
    return workflow;
  }

  function sourceBindingFromWorkflow_(workflow) {
    return {
      fileId: text_(workflow && workflow.fileId),
      sourceHash: text_(workflow && workflow.sourceHash),
      structuralFingerprint: text_(workflow && workflow.structuralFingerprint),
      profileId: text_(workflow && workflow.profileId),
      targetTable: text_(workflow && workflow.targetTable),
      normalizedRowCount: Number(workflow && workflow.normalizedRowCount || 0),
      options: clone_(workflow && workflow.options || {})
    };
  }

  function sourceBindingFromPreview_(preview) {
    return {
      fileId: text_(preview && preview.fileId),
      sourceHash: text_(preview && preview.sourceHash),
      structuralFingerprint: text_(preview && preview.structuralFingerprint),
      profileId: text_(preview && preview.profile && preview.profile.profileId),
      targetTable: text_(preview && preview.profile && preview.profile.targetTable),
      normalizedRowCount: Number(preview && preview.normalizedRowCount || 0),
      options: clone_(preview && preview.resolvedOptions || {})
    };
  }

  function assertOperationSourceCurrent_(workflow, operation) {
    var checkpoint = operation && operation.checkpoint || {};
    var phase = text_(operation && operation.current_phase || checkpoint.nextPhase);
    if (!SOURCE_RECHECK_PHASES[phase]) {
      return {
        checked: false,
        phase: phase,
        reason: 'SOURCE_ALREADY_MATERIALIZED'
      };
    }
    var preview = acceptedPreview_(
      text_(workflow && workflow.fileId),
      clone_(workflow && workflow.options || {})
    );
    var expected = sourceBindingFromWorkflow_(workflow);
    var actual = sourceBindingFromPreview_(preview);
    if (!preview.ready ||
        AKORT.Core.canonicalJson(expected) !==
          AKORT.Core.canonicalJson(actual)) {
      throw AKORT.Core.error(
        'BETA22_OPERATION_SOURCE_CHANGED',
        'The source file changed before its parser materialization phase.',
        {
          operationId: text_(operation && operation.operation_id),
          phase: phase,
          expected: expected,
          actual: actual,
          previewReady: preview.ready === true,
          retryable: false,
          nextAction: 'STOP_AND_REPEAT_PREVIEW'
        }
      );
    }
    return {
      checked: true,
      phase: phase,
      sourceHash: actual.sourceHash,
      structuralFingerprint: actual.structuralFingerprint,
      normalizedRowCount: actual.normalizedRowCount
    };
  }

  function listIncomingFiles() {
    return AKORT.Core.safeRun('BETA22_LIST_INCOMING_FILES', function () {
      assertBase_();
      var access = assertAccess_();
      var folder = incomingFolder_();
      var iterator = folder.getFiles();
      var candidates = [];
      var scanned = 0;
      while (iterator.hasNext() && scanned < MAX_INCOMING_SCAN) {
        var file = iterator.next();
        scanned += 1;
        if (supportedFile_(file)) candidates.push(fileDto_(file));
      }
      var moreEntries = iterator.hasNext();
      candidates.sort(function (left, right) {
        return text_(right.updatedAt).localeCompare(text_(left.updatedAt)) ||
          text_(left.fileName).localeCompare(text_(right.fileName));
      });
      var files = candidates.slice(0, MAX_INCOMING_FILES);
      return AKORT.Result.success('Incoming files loaded.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        user: { email: access.email },
        folder: {
          folderId: folder.getId(),
          folderName: folder.getName(),
          url: 'https://drive.google.com/drive/folders/' + folder.getId()
        },
        files: files,
        fileCount: files.length,
        scannedCount: scanned,
        supportedMatchCount: candidates.length,
        maximumFiles: MAX_INCOMING_FILES,
        maximumScannedFiles: MAX_INCOMING_SCAN,
        truncated: moreEntries || candidates.length > files.length,
        writeGate: writeGate_(),
        userPipelineEnabled: userPipelineEnabled_(),
        createsOperation: false,
        dataPlaneWrite: false
      });
    }, { lock: false, persistLogs: false });
  }

  function inspectFile(fileId, options) {
    return AKORT.Core.safeRun('BETA22_INSPECT_FILE', function () {
      assertBase_();
      assertAccess_();
      assertIncomingFile_(fileId);
      var inspected = AKORT.ExistingSourceParsers.inspectFile(fileId, normalizedOptions_(options));
      return AKORT.Result.success('File inspection completed.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        inspection: clone_(inspected),
        createsOperation: false,
        dataPlaneWrite: false
      });
    }, { lock: false, persistLogs: false });
  }

  function previewFile(fileId, options) {
    return AKORT.Core.safeRun('BETA22_PREVIEW_FILE', function () {
      assertBase_();
      var access = assertAccess_();
      var preview = acceptedPreview_(fileId, options);
      var confirmation = preview.ready ? buildConfirmation_(preview, access.email) : null;
      return AKORT.Result.success('File preview completed.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        preview: preview,
        confirmation: confirmation,
        writeGate: writeGate_(),
        createsOperation: false,
        dataPlaneWrite: false
      });
    }, { lock: false, persistLogs: false });
  }

  function submitFile(confirmation, acknowledgment) {
    return AKORT.Core.safeRun('BETA22_SUBMIT_FILE', function () {
      assertBase_();
      var access = assertAccess_();
      var gate = assertWriteGate_();
      var binding = assertConfirmation_(confirmation, access);
      var userAcknowledgment = assertAcknowledgment_(
        acknowledgment,
        binding
      );
      var file = assertIncomingFile_(binding.fileId);
      var preview = acceptedPreview_(binding.fileId, binding.options || {});
      assertPreviewUnchanged_(binding, preview);

      var operationType = AKORT.ExistingSourceParsers.OperationType;
      var key = idempotencyKey_(binding);
      var input = {
        fileId: binding.fileId,
        fileName: file.getName(),
        profileId: binding.profileId,
        year: text_(binding.options && binding.options.year),
        month: text_(binding.options && binding.options.month),
        week: text_(binding.options && binding.options.week),
        sourcePublishedAt: text_(binding.options && binding.options.sourcePublishedAt),
        sourceId: binding.fileId,
        sourceName: file.getName(),
        beta22Binding: workflowOperationBinding_(binding, access)
      };
      var queued = AKORT.Beta14OperationalHardening.enqueueGuarded(
        operationType,
        input,
        {
          idempotencyKey: key,
          maxAttempts: 3,
          requester: 'BETA22_USER_LOAD_WORKFLOW'
        }
      );
      var queuedData = requireSuccess_('AKORT.Beta14OperationalHardening.enqueueGuarded', queued);
      assertSourceFileOperation_(queuedData, access);
      return AKORT.Result.success('The accepted source-file load operation was queued.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        operationId: text_(queuedData.operationId),
        reused: queuedData.reused === true,
        operation: operationDto_(queuedData),
        file: {
          fileId: binding.fileId,
          fileName: binding.fileName,
          sourceHash: binding.sourceHash,
          profileId: binding.profileId,
          targetTable: binding.targetTable,
          normalizedRowCount: binding.normalizedRowCount
        },
        idempotencyKey: key,
        userAcknowledgment: userAcknowledgment,
        writeGate: gate,
        executionStartedInsideUiCall: false,
        operationTypeReused: operationType,
        newOperationType: false,
        productionTouched: false
      });
    }, { lock: false, persistLogs: true });
  }

  function operationStatus(operationId) {
    return AKORT.Core.safeRun('BETA22_OPERATION_STATUS', function () {
      assertBase_();
      var access = assertAccess_();
      var data = requireSuccess_(
        'AKORT.OperationEngine.status',
        AKORT.OperationEngine.status(text_(operationId))
      );
      assertSourceFileOperation_(data, access);
      return AKORT.Result.success('User load operation status loaded.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        operation: operationDto_(data),
        writeGate: writeGate_(),
        dataPlaneWrite: false
      });
    }, { lock: false, persistLogs: false });
  }

  function continueOperation(operationId) {
    return AKORT.Core.safeRun('BETA22_CONTINUE_OPERATION', function () {
      assertBase_();
      var access = assertAccess_();
      var gate = assertWriteGate_();
      var current = requireSuccess_(
        'AKORT.OperationEngine.status',
        AKORT.OperationEngine.status(text_(operationId))
      );
      var workflow = assertSourceFileOperation_(current, access);
      var currentStatus = text_(current.operation && current.operation.status);
      if (['QUEUED', 'PAUSED', 'RETRY_PENDING'].indexOf(currentStatus) < 0) {
        throw AKORT.Core.error(
          'BETA22_OPERATION_CONTINUE_NOT_ALLOWED',
          'The selected workflow operation is not in a continuable state.',
          {
            operationId: text_(operationId),
            status: currentStatus,
            retryable: false,
            nextAction: currentStatus === 'RUNNING' ? 'WAIT' : 'REVIEW_OPERATION'
          }
        );
      }
      var sourceRecheck = assertOperationSourceCurrent_(
        workflow,
        current.operation || {}
      );
      var resumed = requireSuccess_(
        'AKORT.OperationEngine.resume',
        AKORT.OperationEngine.resume(text_(operationId), { maxSteps: 1 })
      );
      assertSourceFileOperation_(resumed, access);
      return AKORT.Result.success('The accepted operation was continued for one bounded step.', {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        operation: operationDto_(resumed),
        sourceRecheck: sourceRecheck,
        writeGate: gate,
        reusedOperationEngine: true,
        newExecutor: false,
        productionTouched: false
      });
    }, { lock: false, persistLogs: true });
  }

  function industryStatus() {
    return AKORT.Core.safeRun('BETA22_INDUSTRY_STATUS', function () {
      assertBase_();
      assertAccess_();
      return delegateAcceptedResult_(
        'AKORT.IndustryInput.status',
        AKORT.IndustryInput.status()
      );
    }, { lock: false, persistLogs: false });
  }

  function industryValidate() {
    return AKORT.Core.safeRun('BETA22_INDUSTRY_VALIDATE', function () {
      assertBase_();
      assertAccess_();
      return delegateAcceptedResult_(
        'AKORT.IndustryInput.validate',
        AKORT.IndustryInput.validate()
      );
    }, { lock: false, persistLogs: false });
  }

  function industrySubmit() {
    return AKORT.Core.safeRun('BETA22_INDUSTRY_SUBMIT', function () {
      assertBase_();
      assertAccess_();
      var gate = writeGate_();
      if (!gate.userPipelineEnabled) {
        throw AKORT.Core.error(
          'BETA22_INDUSTRY_SUBMIT_REQUIRES_GENERAL_PIPELINE',
          'Industry submit remains disabled until the general user pipeline is enabled at Beta.2.7.',
          { writeGate: gate, retryable: false, nextAction: 'WAIT_FOR_BETA27_GO' }
        );
      }
      return delegateAcceptedResult_(
        'AKORT.IndustryInput.submit',
        AKORT.IndustryInput.submit()
      );
    }, { lock: false, persistLogs: true });
  }

  function preflight() {
    return AKORT.Core.safeRun('BETA22_PREFLIGHT', function () {
      var blockers = [];
      try { assertBase_(); } catch (caught) { blockers.push(caught.code || 'BASE_INVALID'); }
      var access = accessStatus_();
      if (!access.authorized) blockers.push('ACCESS_NOT_AUTHORIZED');
      var config = configuration_();
      if (!config.incomingFolderId) blockers.push('INCOMING_FOLDER_NOT_CONFIGURED');
      if (!config.confirmationSecretConfigured) blockers.push('CONFIRMATION_SECRET_NOT_CONFIGURED');
      if (config.incomingFolderId) {
        try { incomingFolder_(); } catch (ignored) { blockers.push('INCOMING_FOLDER_UNAVAILABLE'); }
      }
      var pipeline = userPipelineEnabled_();
      if (pipeline) blockers.push('GENERAL_USER_PIPELINE_MUST_REMAIN_FALSE_DURING_BETA22_ACCEPTANCE');
      if (config.controlledSubmitEnabled) blockers.push('CONTROLLED_SUBMIT_MUST_REMAIN_FALSE_BEFORE_WRITE_ACCEPTANCE');

      var data = {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        baseRelease: BASE_RELEASE,
        baseCommit: BASE_COMMIT,
        readyToInstall: blockers.length === 0,
        blockers: blockers,
        access: access,
        configuration: config,
        dependencies: dependencyStatus_(),
        writeGate: writeGate_(),
        acceptedOperationType: AKORT.ExistingSourceParsers.OperationType,
        newOperationType: false,
        newQueue: false,
        newExecutor: false,
        newDispatcher: false,
        newParser: false,
        newCalculator: false,
        newPublisher: false,
        createsTrigger: false,
        movesFiles: false,
        generalUserPipelineEnabled: pipeline,
        productionTouched: false
      };
      return blockers.length
        ? AKORT.Result.failure('BETA22_PREFLIGHT_BLOCKED', 'Beta.2.2 preflight found blockers.', data)
        : AKORT.Result.success('Beta.2.2 preflight passed.', data);
    }, { lock: false, persistLogs: false });
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      stage: 'BETA2.2_USER_LOAD_WORKFLOW',
      reusePolicy: 'REUSE_FIRST_GAP_ONLY',
      acceptedEntryPoints: [
        'AKORT.ExistingSourceParsers.inspectFile',
        'AKORT.ExistingSourceParsers.previewFile',
        'AKORT.Beta14OperationalHardening.enqueueGuarded',
        'AKORT.OperationEngine.status',
        'AKORT.OperationEngine.resume',
        'AKORT.IndustryInput.status',
        'AKORT.IndustryInput.validate',
        'AKORT.IndustryInput.submit'
      ],
      acceptedOperationTypes: ['SOURCE_FILE_LOAD_V4', 'RAW_LOAD_V4'],
      incomingFolderProperty: INCOMING_FOLDER_PROPERTY,
      confirmationSecretProperty: CONFIRMATION_SECRET_PROPERTY,
      controlledSubmitProperty: CONTROLLED_SUBMIT_PROPERTY,
      maximumIncomingFiles: MAX_INCOMING_FILES,
      maximumIncomingScan: MAX_INCOMING_SCAN,
      maximumPreviewIssues: MAX_PREVIEW_ISSUES,
      maximumOperationStepSummaries: MAX_OPERATION_STEP_SUMMARIES,
      maximumOperationMessageCharacters: MAX_OPERATION_MESSAGE_CHARS,
      sourceRecheckPhases: Object.keys(SOURCE_RECHECK_PHASES),
      operationBindingSchema: OPERATION_BINDING_SCHEMA,
      confirmationTtlMs: CONFIRMATION_TTL_MS,
      confirmationMode: 'STATELESS_SERVER_HMAC_SIGNED_REPREVIEW_REQUIRED',
      explicitServerAcknowledgmentRequired: true,
      acceptedParserTemporaryConversion:
        ACCEPTED_PARSER_TEMPORARY_CONVERSION,
      acceptedParserTemporaryConversionScope:
        'XLS_XLSX_ONLY; ACCEPTED_PARSER_OWNED; ' +
        'TEMP_COPY_TRASHED_IN_FINALLY; NO_SOURCE_MUTATION; ' +
        'ZERO_RAW_PUBLISH_WRITES',
      generalUserPipelineMustRemainFalseDuringCandidateAcceptance: true,
      finalUserPipelineGuardAdapterDeferredToBeta27: true,
      industryControlledByAcceptedFacade: true,
      industryValidationMayWriteExistingFormStatusCells: true,
      industryResultEnvelopePreserved: true,
      newBusinessLogic: false,
      newOperationType: false,
      newQueue: false,
      newExecutor: false,
      newDispatcher: false,
      newParser: false,
      newCalculator: false,
      newPublisher: false,
      newRawStore: false,
      newStateStorage: false,
      createsTrigger: false,
      movesFiles: false,
      productionWrite: false,
      publicApi: [
        'AKORT_beta22Contract',
        'AKORT_beta22Preflight',
        'AKORT_beta22ListIncomingFiles',
        'AKORT_beta22InspectFile',
        'AKORT_beta22PreviewFile',
        'AKORT_beta22SubmitFile',
        'AKORT_beta22OperationStatus',
        'AKORT_beta22ContinueOperation',
        'AKORT_beta22IndustryStatus',
        'AKORT_beta22IndustryValidate',
        'AKORT_beta22IndustrySubmit'
      ]
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    contract: contract,
    preflight: preflight,
    listIncomingFiles: listIncomingFiles,
    inspectFile: inspectFile,
    previewFile: previewFile,
    submitFile: submitFile,
    operationStatus: operationStatus,
    continueOperation: continueOperation,
    industryStatus: industryStatus,
    industryValidate: industryValidate,
    industrySubmit: industrySubmit,
    Test: Object.freeze({
      normalizedOptions: normalizedOptions_,
      blockingIssues: blockingIssues_,
      writeGate: writeGate_,
      accessStatus: accessStatus_,
      idempotencyKey: idempotencyKey_,
      operationDto: operationDto_,
      assertAcknowledgment: assertAcknowledgment_
    })
  });
})();

function AKORT_beta22Contract() {
  return AKORT_printResult_(AKORT.Result.success(
    'Beta.2.2 user load workflow contract loaded.',
    AKORT.Beta22UserLoadWorkflow.contract()
  ));
}

function AKORT_beta22Preflight() {
  return AKORT_printResult_(AKORT.Beta22UserLoadWorkflow.preflight());
}

function AKORT_beta22ListIncomingFiles() {
  return AKORT.Beta22UserLoadWorkflow.listIncomingFiles();
}

function AKORT_beta22InspectFile(fileId, options) {
  return AKORT.Beta22UserLoadWorkflow.inspectFile(fileId, options);
}

function AKORT_beta22PreviewFile(fileId, options) {
  return AKORT.Beta22UserLoadWorkflow.previewFile(fileId, options);
}

function AKORT_beta22SubmitFile(confirmation, acknowledgment) {
  return AKORT.Beta22UserLoadWorkflow.submitFile(
    confirmation,
    acknowledgment
  );
}

function AKORT_beta22OperationStatus(operationId) {
  return AKORT.Beta22UserLoadWorkflow.operationStatus(operationId);
}

function AKORT_beta22ContinueOperation(operationId) {
  return AKORT.Beta22UserLoadWorkflow.continueOperation(operationId);
}

function AKORT_beta22IndustryStatus() {
  return AKORT.Beta22UserLoadWorkflow.industryStatus();
}

function AKORT_beta22IndustryValidate() {
  return AKORT.Beta22UserLoadWorkflow.industryValidate();
}

function AKORT_beta22IndustrySubmit() {
  return AKORT.Beta22UserLoadWorkflow.industrySubmit();
}
