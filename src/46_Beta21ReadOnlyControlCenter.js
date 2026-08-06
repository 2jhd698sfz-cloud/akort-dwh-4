var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.2.1: read-only Control Center adapter and Apps Script Web App entrypoint.
 *
 * REUSE-FIRST:
 * - system health is read from accepted Beta.1.5 materialized projections;
 * - Full Audit status is read from the accepted Beta.1.6 operator facade;
 * - configuration is read from the accepted AKORT.Config module;
 * - no operation, trigger, RAW, Publish, backup, audit or rollback logic is
 *   recreated here.
 */
AKORT.Beta21ReadOnlyControlCenter = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.2.1.1';
  var CONTRACT_VERSION = '4.0-beta21-read-only-control-center-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '32945776e279528008cbd753e1f0321b3c52e91e';
  var UI_FILE = 'Beta21ControlCenter';
  var ACCESS_PROPERTY = 'AKORT_BETA21_ALLOWED_EMAILS';
  var MAX_UI_ISSUES = 50;
  var REQUIRED_DEPENDENCIES = [
    'AKORT.Config.load',
    'AKORT.Config.readSystemSettings',
    'AKORT.Beta15CompactObservability.status',
    'AKORT.Beta16OperatorFacade.statusLatest'
  ];

  function text_(value) {
    return value === null || value === undefined
      ? ''
      : String(value).trim();
  }

  function truthy_(value) {
    return value === true || value === 1 || value === '1' ||
      text_(value).toUpperCase() === 'TRUE';
  }

  function clone_(value) {
    return JSON.parse(JSON.stringify(
      value === undefined ? null : value
    ));
  }

  function resolvePath_(path) {
    var current = typeof globalThis !== 'undefined'
      ? globalThis
      : this;
    String(path || '').split('.').forEach(function (part) {
      current = current && current[part];
    });
    return current;
  }

  function dependencyStatus_() {
    return REQUIRED_DEPENDENCIES.map(function (path) {
      return {
        path: path,
        available: typeof resolvePath_(path) === 'function'
      };
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
        'BETA21_ACCEPTED_READ_API_MISSING',
        'An accepted read-only dependency is unavailable.',
        {
          missing: missing,
          retryable: false,
          nextAction: 'RESTORE_ACCEPTED_BETA1_BASE'
        }
      );
    }
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA21_BASE_RELEASE_MISMATCH',
        'Beta.2.1 requires the accepted Alpha.7.4 runtime.',
        {
          expected: BASE_RELEASE,
          actual: AKORT.Release.version,
          retryable: false
        }
      );
    }
    assertDependencies_();
    var settings = AKORT.Config.readSystemSettings();
    if (truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
      throw AKORT.Core.error(
        'BETA21_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'The general user pipeline must remain disabled in Beta.2.1.',
        {
          retryable: false,
          nextAction: 'DISABLE_USER_PIPELINE'
        }
      );
    }
    return settings;
  }

  function activeUserEmail_() {
    try {
      return text_(Session.getActiveUser().getEmail()).toLowerCase();
    } catch (ignored) {
      return '';
    }
  }

  function allowedEmails_() {
    var raw = text_(
      PropertiesService.getScriptProperties()
        .getProperty(ACCESS_PROPERTY)
    );
    if (!raw) return [];
    var unique = {};
    raw.split(/[,;\n]/).forEach(function (email) {
      email = text_(email).toLowerCase();
      if (email) unique[email] = true;
    });
    return Object.keys(unique).sort();
  }

  function accessStatus_() {
    var email = activeUserEmail_();
    var allowed = allowedEmails_();
    var mode = allowed.length
      ? 'SCRIPT_PROPERTY_ALLOWLIST'
      : 'GOOGLE_DEPLOYMENT_SINGLE_USER';
    var authorized = Boolean(email) &&
      (!allowed.length || allowed.indexOf(email) >= 0);
    return {
      authorized: authorized,
      email: email,
      mode: mode,
      allowlistConfigured: allowed.length > 0,
      allowlistSize: allowed.length,
      deploymentRequirement:
        'EXECUTE_AS_USER_ACCESSING_WEB_APP; ACCESS_ONLY_MYSELF_FOR_BETA21'
    };
  }

  function assertAccess_() {
    var access = accessStatus_();
    if (!access.authorized) {
      throw AKORT.Core.error(
        'BETA21_ACCESS_DENIED',
        'The current user is not authorized for the Control Center.',
        {
          emailAvailable: Boolean(access.email),
          accessMode: access.mode,
          retryable: false,
          nextAction: 'REVIEW_WEB_APP_ACCESS'
        }
      );
    }
    return access;
  }

  function requireSuccess_(name, result) {
    if (!result || result.ok !== true) {
      throw AKORT.Core.error(
        'BETA21_ACCEPTED_READ_API_FAILED',
        'An accepted read-only API failed.',
        {
          dependency: name,
          code: text_(result && result.code),
          status: text_(result && result.status),
          message: text_(result && result.message),
          retryable: false,
          nextAction: 'REVIEW_ACCEPTED_READ_MODEL'
        }
      );
    }
    return result.data || {};
  }

  function safeUrl_(kind, id) {
    id = text_(id);
    if (!id) return '';
    var prefixes = {
      spreadsheet: 'https://docs.google.com/spreadsheets/d/',
      folder: 'https://drive.google.com/drive/folders/',
      script: 'https://script.google.com/d/'
    };
    return prefixes[kind] ? prefixes[kind] + id : '';
  }

  function resourceLinks_() {
    var config = AKORT.Config.load({
      includeSystemSettings: false
    });
    var resources = config.resources || {};
    var backupFolderId = text_(
      resources.backupFolderId ||
      PropertiesService.getScriptProperties()
        .getProperty('AKORT_BACKUP_FOLDER_ID')
    );
    return [
      {
        key: 'DWH_TECH',
        label: 'DWH TECH',
        url: safeUrl_('spreadsheet', resources.dwhSpreadsheetId)
      },
      {
        key: 'PUBLISH',
        label: 'Publish',
        url: safeUrl_('spreadsheet', resources.publishSpreadsheetId)
      },
      {
        key: 'DEV_ROOT',
        label: 'Папка разработки 4.0',
        url: safeUrl_('folder', resources.devRootFolderId)
      },
      {
        key: 'DOCS',
        label: 'Документация',
        url: safeUrl_('folder', resources.docsFolderId)
      },
      {
        key: 'BACKUPS',
        label: 'Резервные копии',
        url: safeUrl_('folder', backupFolderId)
      }
    ].filter(function (item) {
      return Boolean(item.url);
    });
  }

  function datasetById_(datasets, id) {
    var matched = (datasets || []).filter(function (row) {
      return text_(row.dataset_id) === id;
    });
    return matched.length ? matched[0] : null;
  }

  function severityRank_(value) {
    var ranks = {
      INFO: 1,
      WARNING: 2,
      ERROR: 3,
      CRITICAL: 4
    };
    return ranks[text_(value).toUpperCase()] || 0;
  }

  function issueRows_(issues) {
    return (issues || []).slice().sort(function (left, right) {
      return severityRank_(right.severity) -
          severityRank_(left.severity) ||
        text_(right.last_seen_at).localeCompare(
          text_(left.last_seen_at)
        ) ||
        text_(left.issue_key).localeCompare(
          text_(right.issue_key)
        );
    }).slice(0, MAX_UI_ISSUES).map(function (row) {
      return {
        issueKey: text_(row.issue_key),
        datasetId: text_(row.dataset_id),
        operationId: text_(row.operation_id),
        severity: text_(row.severity),
        lifecycleStatus: text_(row.lifecycle_status),
        issueCode: text_(row.issue_code),
        summary: text_(row.summary),
        resolution: text_(row.resolution),
        nextAction: text_(row.next_action),
        lastSeenAt: text_(row.last_seen_at)
      };
    });
  }

  function datasetRows_(datasets) {
    return (datasets || []).map(function (row) {
      return {
        datasetId: text_(row.dataset_id),
        label: text_(row.dataset_label),
        sourceTable: text_(row.source_table),
        sourceStatus: text_(row.source_status),
        healthStatus: text_(row.health_status),
        freshnessStatus: text_(row.freshness_status),
        latestActivityAt: text_(row.latest_activity_at),
        latestPeriod: text_(row.latest_period),
        latestLoadId: text_(row.latest_load_id),
        activeOperationId: text_(row.active_operation_id),
        activePhase: text_(row.active_phase),
        progressPercent: row.progress_percent === ''
          ? null
          : Number(row.progress_percent),
        checkpointCursor: text_(row.checkpoint_cursor),
        latestBackupId: text_(row.latest_backup_id),
        triggerStatus: text_(row.trigger_status),
        issueCount: Number(row.issue_count || 0),
        nextAction: text_(row.next_action)
      };
    });
  }

  function auditSummary_(audit) {
    var evidence = audit && audit.evidence || null;
    var operationContainer = audit && audit.operation || null;
    var operation = operationContainer &&
      (operationContainer.operation || operationContainer);
    return {
      operationId: text_(audit && audit.operationId),
      operationStatus: text_(operation && operation.status),
      phase: text_(operation && operation.current_phase),
      evidence: evidence ? {
        auditId: text_(evidence.audit_id),
        status: text_(evidence.audit_status || evidence.status),
        checksTotal: Number(evidence.checks_total || 0),
        checksPassed: Number(evidence.checks_passed || 0),
        checksWarned: Number(evidence.checks_warned || 0),
        checksFailed: Number(evidence.checks_failed || 0),
        startedAt: text_(evidence.started_at),
        finishedAt: text_(evidence.finished_at),
        evidenceFingerprint: text_(
          evidence.evidence_hash || evidence.evidence_fingerprint
        )
      } : null,
      retention: clone_(audit && audit.retention || null)
    };
  }

  function overallStatus_(observability, audit) {
    var base = text_(observability.overallStatus).toUpperCase();
    if (base === 'ERROR') return 'ERROR';
    var evidence = audit && audit.evidence;
    if (evidence) {
      var failed = Number(evidence.checks_failed || 0);
      var status = text_(evidence.audit_status || evidence.status).toUpperCase();
      if (failed > 0 || status === 'FAILED') return 'ERROR';
      if (Number(evidence.checks_warned || 0) > 0) return 'WARNING';
    }
    return base === 'HEALTHY' ? 'HEALTHY' : 'WARNING';
  }

  function userStatusLabel_(status) {
    var labels = {
      HEALTHY: 'Система работает',
      WARNING: 'Требует внимания',
      ERROR: 'Остановлена или требует проверки'
    };
    return labels[status] || 'Статус неизвестен';
  }

  function buildStatus_() {
    var settings = assertBase_();
    var access = assertAccess_();
    var observability = requireSuccess_(
      'AKORT.Beta15CompactObservability.status',
      AKORT.Beta15CompactObservability.status()
    );
    var audit = requireSuccess_(
      'AKORT.Beta16OperatorFacade.statusLatest',
      AKORT.Beta16OperatorFacade.statusLatest()
    );
    var datasets = datasetRows_(observability.datasets || []);
    var issues = issueRows_(observability.issues || []);
    var overall = overallStatus_(observability, audit);
    var operations = datasetById_(
      observability.datasets || [],
      'OPERATIONS'
    );
    var backups = datasetById_(
      observability.datasets || [],
      'BACKUPS'
    );
    var triggers = datasetById_(
      observability.datasets || [],
      'TRIGGERS'
    );

    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      generatedAt: new Date().toISOString(),
      user: {
        email: access.email,
        role: 'VIEWER',
        accessMode: access.mode
      },
      system: {
        environment: 'DEV',
        release: AKORT.Release.version,
        userPipelineEnabled: truthy_(
          settings.PUBLISH_USER_PIPELINE_ENABLED
        ),
        overallStatus: overall,
        statusLabel: userStatusLabel_(overall),
        datasetCount: Number(observability.datasetCount || 0),
        issueCount: Number(observability.issueCount || 0),
        nextActions: clone_(observability.nextActions || [])
      },
      activeOperation: operations ? {
        operationId: text_(operations.active_operation_id),
        status: text_(operations.source_status),
        phase: text_(operations.active_phase),
        progressPercent: operations.progress_percent === ''
          ? null
          : Number(operations.progress_percent),
        checkpointCursor: text_(operations.checkpoint_cursor),
        nextAction: text_(operations.next_action)
      } : null,
      backup: backups ? {
        backupId: text_(backups.latest_backup_id),
        status: text_(backups.source_status),
        healthStatus: text_(backups.health_status),
        freshnessStatus: text_(backups.freshness_status),
        latestActivityAt: text_(backups.latest_activity_at),
        nextAction: text_(backups.next_action)
      } : null,
      trigger: triggers ? {
        status: text_(triggers.source_status),
        healthStatus: text_(triggers.health_status),
        latestActivityAt: text_(triggers.latest_activity_at),
        nextAction: text_(triggers.next_action)
      } : null,
      fullAudit: auditSummary_(audit),
      datasets: datasets,
      issues: issues,
      issueDisplay: {
        displayed: issues.length,
        total: Number(observability.issueCount || 0),
        truncated:
          Number(observability.issueCount || 0) > issues.length
      },
      links: resourceLinks_(),
      safety: {
        readOnly: true,
        statusReads: [
          'AKORT.Beta15CompactObservability.status',
          'AKORT.Beta16OperatorFacade.statusLatest'
        ],
        sourceRegistryReads:
          Number(observability.sourceRegistryReads || 0),
        rawTargetReads:
          Number(observability.rawTargetReads || 0),
        publishTargetReads:
          Number(observability.publishTargetReads || 0),
        operationCreated: false,
        operationMutated: false,
        triggerCreated: false,
        triggerDeleted: false,
        dataPlaneWrite: false,
        productionTouched: false,
        userPipelineEnabled: false
      }
    };
  }

  function status() {
    return AKORT.Core.safeRun(
      'BETA21_READ_ONLY_CONTROL_CENTER_STATUS',
      function () {
        return AKORT.Result.success(
          'Beta.2.1 read-only Control Center status loaded.',
          buildStatus_()
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA21_READ_ONLY_CONTROL_CENTER_PREFLIGHT',
      function () {
        var settings = assertBase_();
        var access = accessStatus_();
        var dependencies = dependencyStatus_();
        var blockers = [];
        if (!access.authorized) {
          blockers.push('CURRENT_USER_NOT_AUTHORIZED');
        }
        if (truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
          blockers.push('USER_PIPELINE_ENABLED');
        }
        var observability = AKORT.Beta15CompactObservability.status();
        if (!observability || observability.ok !== true) {
          blockers.push('COMPACT_OBSERVABILITY_STATUS_FAILED');
        }
        var audit = AKORT.Beta16OperatorFacade.statusLatest();
        if (!audit || audit.ok !== true) {
          blockers.push('FULL_AUDIT_STATUS_FAILED');
        }
        var data = {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          baseCommit: BASE_COMMIT,
          readyToDeploy: blockers.length === 0,
          blockers: blockers,
          access: access,
          dependencies: dependencies,
          acceptedReadApis: [
            'AKORT.Beta15CompactObservability.status',
            'AKORT.Beta16OperatorFacade.statusLatest',
            'AKORT.Config.load',
            'AKORT.Config.readSystemSettings'
          ],
          uiFile: UI_FILE,
          deploymentMode:
            'WEB_APP_EXECUTE_AS_USER_ACCESSING_APP',
          beta21Access:
            'ONLY_MYSELF_OR_EXPLICIT_ALLOWLIST',
          writeBoundary: 'READ_ONLY',
          rawTargetReads: 0,
          publishTargetReads: 0,
          operationCreated: false,
          operationMutated: false,
          createsTrigger: false,
          deletesTrigger: false,
          userPipelineEnabled: false,
          productionTouched: false
        };
        return blockers.length
          ? AKORT.Result.failure(
              'BETA21_PREFLIGHT_BLOCKED',
              'Beta.2.1 Control Center preflight found blockers.',
              data
            )
          : AKORT.Result.success(
              'Beta.2.1 Control Center preflight passed.',
              data
            );
      },
      { lock: false, persistLogs: false }
    );
  }

  function escapeHtml_(value) {
    return text_(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function render() {
    assertBase_();
    assertAccess_();
    return HtmlService.createTemplateFromFile(UI_FILE)
      .evaluate()
      .setTitle('АКОРТ — Центр управления')
      .setXFrameOptionsMode(
        HtmlService.XFrameOptionsMode.DEFAULT
      );
  }

  function renderDenied(error) {
    var code = escapeHtml_(error && error.code || 'BETA21_ACCESS_DENIED');
    var message = escapeHtml_(
      error && error.message ||
      'Доступ к Центру управления запрещён.'
    );
    return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="ru"><head>' +
      '<meta charset="utf-8"><title>Доступ запрещён</title>' +
      '<style>body{font-family:Arial,sans-serif;padding:32px;' +
      'background:#f7f7f7;color:#202124}.box{max-width:680px;' +
      'margin:auto;background:white;padding:24px;border-radius:12px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.08)}code{color:#b3261e}' +
      '</style></head><body><div class="box"><h1>Доступ запрещён</h1>' +
      '<p>' + message + '</p><p><code>' + code + '</code></p>' +
      '</div></body></html>'
    ).setTitle('Доступ запрещён');
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION,
      contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      stage: 'BETA2.1_READ_ONLY_CONTROL_CENTER',
      reusePolicy: 'REUSE_FIRST_GAP_ONLY',
      acceptedReadApis: [
        'AKORT.Beta15CompactObservability.status',
        'AKORT.Beta16OperatorFacade.statusLatest',
        'AKORT.Config.load',
        'AKORT.Config.readSystemSettings'
      ],
      newBusinessLogic: false,
      newOperationType: false,
      newQueue: false,
      newExecutor: false,
      newDispatcher: false,
      newTrigger: false,
      dataPlaneWrite: false,
      serviceProjectionWrite: false,
      readsPhysicalRawTargets: false,
      readsPhysicalPublishTargets: false,
      maximumUiIssues: MAX_UI_ISSUES,
      infrastructure:
        'APPS_SCRIPT_WEB_APP_HTMLSERVICE_SAME_PROJECT',
      deployment:
        'EXECUTE_AS_USER_ACCESSING_WEB_APP',
      access:
        'GOOGLE_SINGLE_USER_OR_OPTIONAL_SCRIPT_PROPERTY_ALLOWLIST',
      publicApi: [
        'doGet',
        'AKORT_beta21ControlCenterContract',
        'AKORT_beta21ControlCenterPreflight',
        'AKORT_beta21ControlCenterStatus'
      ],
      enablesUserPipeline: false,
      productionWrite: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION,
    ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE,
    BaseCommit: BASE_COMMIT,
    UiFile: UI_FILE,
    AccessProperty: ACCESS_PROPERTY,
    contract: contract,
    preflight: preflight,
    status: status,
    render: render,
    renderDenied: renderDenied,
    Test: Object.freeze({
      accessStatus: accessStatus_,
      issueRows: issueRows_,
      datasetRows: datasetRows_,
      overallStatus: overallStatus_,
      resourceLinks: resourceLinks_,
      userStatusLabel: userStatusLabel_
    })
  });
})();

function doGet() {
  try {
    return AKORT.Beta21ReadOnlyControlCenter.render();
  } catch (error) {
    return AKORT.Beta21ReadOnlyControlCenter.renderDenied(error);
  }
}

function AKORT_beta21ControlCenterContract() {
  return AKORT_printResult_(
    AKORT.Result.success(
      'Beta.2.1 read-only Control Center contract loaded.',
      AKORT.Beta21ReadOnlyControlCenter.contract()
    )
  );
}

function AKORT_beta21ControlCenterPreflight() {
  return AKORT_printResult_(
    AKORT.Beta21ReadOnlyControlCenter.preflight()
  );
}

function AKORT_beta21ControlCenterStatus() {
  return AKORT.Beta21ReadOnlyControlCenter.status();
}
