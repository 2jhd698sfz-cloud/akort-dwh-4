var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Beta.1.1 r5: paired DEV backup with explicit result-shape parsing. */
AKORT.Beta11PairedBackup = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.1.5';
  var CONTRACT_VERSION = '4.0-beta11-paired-backup-5';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '7c90ef1b2fb9abe860394c17ec24fe459b505b0e';
  var OPERATION_TYPE = 'BETA11_PAIRED_BACKUP';
  var REGISTRY = 'BACKUP_REGISTRY';
  var FOLDER_NAME = '08_Резервные копии';
  var FOLDER_PROPERTY = 'AKORT_BACKUP_FOLDER_ID';
  var ACTIVE_PROPERTY = 'AKORT_BETA11_ACTIVE_OPERATION_ID';
  var DAILY_HANDLER = 'AKORT_beta11DailyBackupTrigger';
  var WORKER_HANDLER = 'AKORT_beta11BackupWorker';
  var TIMEZONE = 'Europe/Moscow';
  var DAILY_HOUR = 4;
  var RETRY_DELAY_MS = 10 * 60 * 1000;
  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

  function clone_(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (e) { return 'unknown'; }
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error('BETA11_BASE_RELEASE_MISMATCH',
        'Beta.1.1 requires the accepted Alpha.7.4 runtime release.',
        { expected: BASE_RELEASE, actual: AKORT.Release.version, retryable: false });
    }
    var settings = AKORT.Config.readSystemSettings();
    var enabled = settings.PUBLISH_USER_PIPELINE_ENABLED === true ||
      String(settings.PUBLISH_USER_PIPELINE_ENABLED || '').toUpperCase() === 'TRUE';
    if (enabled) {
      throw AKORT.Core.error('BETA11_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Beta.1.1 cannot run after the general user pipeline is enabled.',
        { retryable: false });
    }
  }

  function config_() {
    return AKORT.Config.load({ includeSystemSettings: false });
  }

  function dwh_() {
    return SpreadsheetApp.openById(config_().resources.dwhSpreadsheetId);
  }

  function registrySheet_() {
    var sheet = dwh_().getSheetByName(REGISTRY);
    if (!sheet) {
      throw AKORT.Core.error('BACKUP_REGISTRY_MISSING',
        'BACKUP_REGISTRY is absent. Run AKORT_beta11Install first.',
        { retryable: false });
    }
    var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var expected = AKORT.Core.Tables.BACKUP_REGISTRY;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error('BACKUP_REGISTRY_SCHEMA_MISMATCH',
        'BACKUP_REGISTRY schema differs from the Beta.1.1 contract.',
        { expected: expected, actual: actual, retryable: false });
    }
    return sheet;
  }

  function readRegistry_() {
    return AKORT.Core.Sheets.readObjects(registrySheet_());
  }

  function findRegistry_(backupId) {
    var rows = readRegistry_();
    for (var i = 0; i < rows.length; i += 1) {
      if (String(rows[i].backup_id || '') === String(backupId || '')) return rows[i];
    }
    return null;
  }

  function saveRegistry_(record) {
    var sheet = registrySheet_();
    var headers = AKORT.Core.Tables.BACKUP_REGISTRY;
    if (record.__row) {
      sheet.getRange(record.__row, 1, 1, headers.length).setValues([headers.map(function (header) {
        var value = record[header];
        return value === undefined || value === null ? '' : value;
      })]);
      return record;
    }
    AKORT.Core.Sheets.appendObject(sheet, headers, record);
    record.__row = sheet.getLastRow();
    return record;
  }

  function ensureFolder_() {
    var cfg = config_();
    var properties = PropertiesService.getScriptProperties();
    var folderId = String(cfg.resources.backupFolderId ||
      properties.getProperty(FOLDER_PROPERTY) || '');

    if (folderId) {
      var configured = DriveApp.getFolderById(folderId);
      if (configured.isTrashed()) {
        throw AKORT.Core.error('BACKUP_FOLDER_TRASHED',
          'Configured backup folder is trashed.',
          { folderId: folderId, retryable: false });
      }
      return configured;
    }

    var root = DriveApp.getFolderById(cfg.resources.devRootFolderId);
    var iterator = root.getFoldersByName(FOLDER_NAME);
    var matches = [];
    while (iterator.hasNext()) matches.push(iterator.next());
    if (matches.length > 1) {
      throw AKORT.Core.error('BACKUP_FOLDER_AMBIGUOUS',
        'More than one exact backup folder exists under the DEV root.',
        { folderName: FOLDER_NAME, count: matches.length, retryable: false });
    }
    var folder = matches.length === 1 ? matches[0] : root.createFolder(FOLDER_NAME);
    properties.setProperty(FOLDER_PROPERTY, folder.getId());
    return folder;
  }

  function deleteTriggers_(handler) {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
    });
  }

  function installDailyTrigger_() {
    deleteTriggers_(DAILY_HANDLER);
    return ScriptApp.newTrigger(DAILY_HANDLER)
      .timeBased()
      .atHour(DAILY_HOUR)
      .nearMinute(0)
      .everyDays(1)
      .inTimezone(TIMEZONE)
      .create()
      .getUniqueId();
  }

  function scheduleWorker_() {
    deleteTriggers_(WORKER_HANDLER);
    return ScriptApp.newTrigger(WORKER_HANDLER)
      .timeBased()
      .after(RETRY_DELAY_MS)
      .create()
      .getUniqueId();
  }

  function triggerCounts_() {
    var counts = { daily: 0, worker: 0 };
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === DAILY_HANDLER) counts.daily += 1;
      if (trigger.getHandlerFunction() === WORKER_HANDLER) counts.worker += 1;
    });
    return counts;
  }

  function moscowDateKey_(date) {
    return Utilities.formatDate(date || new Date(), TIMEZONE, 'yyyyMMdd');
  }

  function timestampKey_() {
    return Utilities.formatDate(new Date(), 'GMT', "yyyyMMdd'T'HHmmssSSS'Z'");
  }

  function compactUuid_() {
    return Utilities.getUuid().replace(/-/g, '').slice(-12).toUpperCase();
  }

  function dailyBackupId_(date) {
    return 'BKP_DAILY_' + moscowDateKey_(date);
  }

  function manualBackupId_() {
    return 'BKP_MANUAL_' + timestampKey_() + '_' + compactUuid_();
  }

  function fileSummary_(file) {
    return {
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: Number(file.getSize() || 0),
      lastUpdated: file.getLastUpdated().toISOString(),
      trashed: file.isTrashed()
    };
  }

  function operationBoundary_(currentOperationId) {
    var sheet = dwh_().getSheetByName('OPERATION_QUEUE');
    var rows = sheet ? AKORT.Core.Sheets.readObjects(sheet) : [];
    var active = [];
    var latestFinishedAt = '';
    rows.forEach(function (row) {
      if (String(row.operation_id || '') === String(currentOperationId || '')) return;
      if (String(row.operation_type || '') === OPERATION_TYPE) return;
      var status = String(row.status || '');
      if (status === 'RUNNING' || status === 'QUEUED' || status === 'RETRY_PENDING') {
        active.push({
          operationId: String(row.operation_id || ''),
          operationType: String(row.operation_type || ''),
          status: status,
          phase: String(row.current_phase || '')
        });
      }
      var finished = String(row.finished_at || '');
      if (finished && finished > latestFinishedAt) latestFinishedAt = finished;
    });
    return {
      activeOperations: active,
      latestFinishedAt: latestFinishedAt,
      fingerprint: AKORT.Core.sha256(AKORT.Core.canonicalJson({
        activeOperations: active,
        latestFinishedAt: latestFinishedAt
      }))
    };
  }

  function exactNamedFile_(folder, name) {
    var iterator = folder.getFilesByName(name);
    var files = [];
    while (iterator.hasNext()) {
      var file = iterator.next();
      if (!file.isTrashed()) files.push(file);
    }
    if (files.length > 1) {
      throw AKORT.Core.error('BACKUP_MEMBER_AMBIGUOUS',
        'More than one non-trashed backup member has the deterministic name.',
        { name: name, count: files.length, retryable: false, requiresReview: true });
    }
    return files.length === 1 ? files[0] : null;
  }

  function copyDwh_(folder, name) {
    var existing = exactNamedFile_(folder, name);
    if (existing) {
      return {
        adopted: true,
        backupId: existing.getId(),
        backupName: existing.getName(),
        backupUrl: existing.getUrl()
      };
    }
    var source = DriveApp.getFileById(config_().resources.dwhSpreadsheetId);
    var copy = source.makeCopy(name, folder);
    return {
      adopted: false,
      backupId: copy.getId(),
      backupName: copy.getName(),
      backupUrl: copy.getUrl()
    };
  }

  function copyPublish_(folder, name) {
    var existing = exactNamedFile_(folder, name);
    if (existing) {
      return {
        adopted: true,
        backupId: existing.getId(),
        backupName: existing.getName(),
        backupUrl: existing.getUrl()
      };
    }
    var compatibility = AKORT.IncrementalPublish &&
      AKORT.IncrementalPublish.BackupCompatibility;
    if (!compatibility || typeof compatibility.copyPublishBackup !== 'function') {
      throw AKORT.Core.error('PUBLISH_BACKUP_PRIMITIVE_MISSING',
        'Accepted Incremental Publish backup primitive is unavailable.',
        { retryable: false });
    }
    var copied = compatibility.copyPublishBackup({
      folderId: folder.getId(),
      name: name
    });
    copied.adopted = false;
    return copied;
  }

  function state_(checkpoint) {
    checkpoint.handlerState = checkpoint.handlerState || {};
    checkpoint.handlerState.beta11Backup = checkpoint.handlerState.beta11Backup || {};
    var state = checkpoint.handlerState.beta11Backup;
    var input = checkpoint.input || {};
    state.backupId = state.backupId || String(input.backupId || '');
    state.requestType = state.requestType || String(input.requestType || 'MANUAL');
    state.scheduledDate = state.scheduledDate || String(input.scheduledDate || '');
    state.dwhName = state.dwhName || ('AKORT_DWH_TECH_4_BACKUP__' + state.backupId);
    state.publishName = state.publishName || ('AKORT_PUBLISH_4_BACKUP__' + state.backupId);
    state.manifestName = state.manifestName ||
      ('AKORT_BACKUP_MANIFEST__' + state.backupId + '.json');
    return state;
  }

  function ensureRecord_(context, state, folder) {
    var cfg = config_();
    var row = findRegistry_(state.backupId);
    if (!row) {
      row = saveRegistry_({
        backup_id: state.backupId,
        operation_id: context.operation.operation_id,
        request_type: state.requestType,
        status: 'RUNNING',
        scheduled_date: state.scheduledDate,
        backup_folder_id: folder.getId(),
        dwh_source_id: cfg.resources.dwhSpreadsheetId,
        dwh_backup_id: '',
        dwh_backup_name: state.dwhName,
        dwh_backup_url: '',
        publish_source_id: cfg.resources.publishSpreadsheetId,
        publish_backup_id: '',
        publish_backup_name: state.publishName,
        publish_backup_url: '',
        manifest_file_id: '',
        manifest_url: '',
        manifest_hash: '',
        operation_boundary_json: '',
        started_at: AKORT.Core.now(),
        finished_at: '',
        error_code: '',
        error_message: '',
        release_version: AKORT.Release.version,
        created_by: currentUser_()
      });
    } else if (String(row.operation_id || '') !==
               String(context.operation.operation_id || '')) {
      throw AKORT.Core.error('BACKUP_ID_OPERATION_CONFLICT',
        'The backup_id is already bound to another operation.',
        {
          backupId: state.backupId,
          expectedOperationId: context.operation.operation_id,
          actualOperationId: row.operation_id,
          retryable: false,
          requiresReview: true
        });
    }
    return row;
  }

  function updateFailure_(state, caught) {
    var row = findRegistry_(state.backupId);
    if (!row) return;
    var code = String(caught && caught.code || 'BACKUP_FAILED');
    var anyMember = Boolean(row.dwh_backup_id || row.publish_backup_id);
    row.status = code === 'BACKUP_WAITING_FOR_OPERATION_QUIESCENCE'
      ? 'WAITING'
      : anyMember ? 'PARTIAL' : 'FAILED';
    row.error_code = code;
    row.error_message = String(caught && caught.message || caught || '');
    saveRegistry_(row);
  }

  function manifestPayload_(state, row) {
    var cfg = config_();
    return {
      schemaVersion: CONTRACT_VERSION,
      packageVersion: PACKAGE_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      backupId: state.backupId,
      operationId: row.operation_id,
      requestType: row.request_type,
      scheduledDate: row.scheduled_date,
      timezone: TIMEZONE,
      folderId: row.backup_folder_id,
      operationBoundary: JSON.parse(String(row.operation_boundary_json || '{}')),
      sources: {
        dwh: fileSummary_(DriveApp.getFileById(cfg.resources.dwhSpreadsheetId)),
        publish: fileSummary_(DriveApp.getFileById(cfg.resources.publishSpreadsheetId))
      },
      members: {
        dwh: {
          sourceId: row.dwh_source_id,
          backupId: row.dwh_backup_id,
          name: row.dwh_backup_name,
          url: row.dwh_backup_url
        },
        publish: {
          sourceId: row.publish_source_id,
          backupId: row.publish_backup_id,
          name: row.publish_backup_name,
          url: row.publish_backup_url
        }
      },
      createdAt: row.started_at,
      retention: {
        automaticDeletion: false,
        ownerRelease: 'Beta.1.6'
      }
    };
  }

  function createOrAdoptManifest_(folder, state, payload) {
    var canonical = AKORT.Core.canonicalJson(payload);
    var hash = AKORT.Core.sha256(canonical);
    var existing = exactNamedFile_(folder, state.manifestName);
    if (existing) {
      var parsed = JSON.parse(existing.getBlob().getDataAsString('UTF-8'));
      var existingHash = AKORT.Core.sha256(AKORT.Core.canonicalJson(parsed));
      if (existingHash !== hash) {
        throw AKORT.Core.error('BACKUP_MANIFEST_CONFLICT',
          'Existing deterministic manifest differs from expected payload.',
          {
            backupId: state.backupId,
            expectedHash: hash,
            actualHash: existingHash,
            retryable: false,
            requiresReview: true
          });
      }
      return {
        fileId: existing.getId(),
        fileUrl: existing.getUrl(),
        hash: hash,
        adopted: true
      };
    }
    var file = folder.createFile(
      state.manifestName,
      JSON.stringify(payload, null, 2),
      MimeType.PLAIN_TEXT
    );
    return {
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      hash: hash,
      adopted: false
    };
  }

  function execute_(phase, context) {
    assertBase_();
    var state = state_(context.checkpoint);
    if (!state.backupId) {
      throw AKORT.Core.error('BACKUP_ID_MISSING',
        'Paired backup operation has no backup_id.',
        { retryable: false });
    }

    try {
      if (phase === 'DISCOVER') {
        var folder = ensureFolder_();
        var record = ensureRecord_(context, state, folder);
        state.folderId = folder.getId();
        state.dwhBackupId = state.dwhBackupId || String(record.dwh_backup_id || '');
        state.publishBackupId = state.publishBackupId ||
          String(record.publish_backup_id || '');
        return {
          backupId: state.backupId,
          folderId: state.folderId,
          requestType: state.requestType
        };
      }

      if (phase === 'VALIDATE') {
        var boundary = operationBoundary_(context.operation.operation_id);
        if (boundary.activeOperations.length) {
          var waiting = findRegistry_(state.backupId);
          waiting.status = 'WAITING';
          waiting.error_code = 'BACKUP_WAITING_FOR_OPERATION_QUIESCENCE';
          waiting.error_message =
            'Backup waits until incompatible operations are not active.';
          saveRegistry_(waiting);
          throw AKORT.Core.error('BACKUP_WAITING_FOR_OPERATION_QUIESCENCE',
            'Paired backup will retry after active operations reach a safe state.',
            {
              competingOperations: boundary.activeOperations,
              retryable: true
            });
        }
        state.operationBoundary = boundary;
        var validated = findRegistry_(state.backupId);
        validated.status = 'RUNNING';
        validated.operation_boundary_json = AKORT.Core.safeJson(boundary);
        validated.error_code = '';
        validated.error_message = '';
        saveRegistry_(validated);
        return {
          operationBoundaryFingerprint: boundary.fingerprint,
          activeOperations: 0
        };
      }

      if (phase === 'PARSE') {
        return {
          dwhName: state.dwhName,
          publishName: state.publishName,
          manifestName: state.manifestName
        };
      }

      if (phase === 'STAGE') {
        var dwhCopy = copyDwh_(
          DriveApp.getFolderById(state.folderId),
          state.dwhName
        );
        state.dwhBackupId = dwhCopy.backupId;
        var dwhRow = findRegistry_(state.backupId);
        dwhRow.status = 'PARTIAL';
        dwhRow.dwh_backup_id = dwhCopy.backupId;
        dwhRow.dwh_backup_name = dwhCopy.backupName;
        dwhRow.dwh_backup_url = dwhCopy.backupUrl;
        dwhRow.error_code = '';
        dwhRow.error_message = '';
        saveRegistry_(dwhRow);
        return {
          member: 'DWH',
          adopted: dwhCopy.adopted,
          backupId: dwhCopy.backupId
        };
      }

      if (phase === 'COMMIT_RAW') {
        var currentBoundary = operationBoundary_(context.operation.operation_id);
        if (currentBoundary.activeOperations.length ||
            String(currentBoundary.latestFinishedAt || '') !==
            String(state.operationBoundary.latestFinishedAt || '')) {
          throw AKORT.Core.error('BACKUP_BOUNDARY_CHANGED_AFTER_DWH_COPY',
            'Another operation crossed the backup boundary after the DWH copy.',
            {
              expectedBoundary: state.operationBoundary,
              actualBoundary: currentBoundary,
              retryable: false,
              requiresReview: true
            });
        }

        var publishCopy = copyPublish_(
          DriveApp.getFolderById(state.folderId),
          state.publishName
        );
        state.publishBackupId = publishCopy.backupId;
        var publishRow = findRegistry_(state.backupId);
        publishRow.status = 'PARTIAL';
        publishRow.publish_backup_id = publishCopy.backupId;
        publishRow.publish_backup_name = publishCopy.backupName;
        publishRow.publish_backup_url = publishCopy.backupUrl;
        publishRow.error_code = '';
        publishRow.error_message = '';
        saveRegistry_(publishRow);
        return {
          member: 'PUBLISH',
          adopted: publishCopy.adopted,
          backupId: publishCopy.backupId
        };
      }

      if (phase === 'QUICK_AUDIT') {
        var auditRow = findRegistry_(state.backupId);
        ['dwh_backup_id', 'publish_backup_id'].forEach(function (field) {
          var id = String(auditRow[field] || '');
          if (!id) {
            throw AKORT.Core.error('BACKUP_MEMBER_MISSING',
              'Paired backup member is absent.',
              { field: field, retryable: false, requiresReview: true });
          }
          var file = DriveApp.getFileById(id);
          if (file.isTrashed()) {
            throw AKORT.Core.error('BACKUP_MEMBER_TRASHED',
              'Paired backup member is trashed.',
              {
                field: field,
                fileId: id,
                retryable: false,
                requiresReview: true
              });
          }
        });
        return { audited: true, members: 2 };
      }

      if (phase === 'FINALIZING') {
        var finalRow = findRegistry_(state.backupId);
        var manifest = createOrAdoptManifest_(
          DriveApp.getFolderById(state.folderId),
          state,
          manifestPayload_(state, finalRow)
        );
        finalRow.status = 'SUCCESS';
        finalRow.manifest_file_id = manifest.fileId;
        finalRow.manifest_url = manifest.fileUrl;
        finalRow.manifest_hash = manifest.hash;
        finalRow.finished_at = AKORT.Core.now();
        finalRow.error_code = '';
        finalRow.error_message = '';
        saveRegistry_(finalRow);
        PropertiesService.getScriptProperties().deleteProperty(ACTIVE_PROPERTY);
        return {
          backupId: state.backupId,
          status: 'SUCCESS',
          dwhBackupId: finalRow.dwh_backup_id,
          publishBackupId: finalRow.publish_backup_id,
          manifestFileId: manifest.fileId,
          manifestHash: manifest.hash,
          manifestAdopted: manifest.adopted
        };
      }

      return {
        phase: phase,
        backupId: state.backupId,
        noDataPlaneWork: true
      };
    } catch (caught) {
      updateFailure_(state, caught);
      throw caught;
    }
  }

  function registryInspection_() {
    var sheet = dwh_().getSheetByName(REGISTRY);
    if (!sheet) {
      return {
        status: 'ABSENT',
        schemaMatches: true,
        rows: 0,
        columns: 0,
        actualHeaders: []
      };
    }
    var actual = sheet.getRange(
      1,
      1,
      1,
      Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    var expected = AKORT.Core.Tables.BACKUP_REGISTRY || [];
    return {
      status: 'PRESENT',
      schemaMatches: JSON.stringify(actual) === JSON.stringify(expected),
      rows: Math.max(0, sheet.getLastRow() - 1),
      columns: sheet.getLastColumn(),
      actualHeaders: actual,
      expectedHeaders: expected.slice()
    };
  }

  function folderInspection_() {
    var cfg = config_();
    var root = DriveApp.getFolderById(cfg.resources.devRootFolderId);
    var iterator = root.getFoldersByName(FOLDER_NAME);
    var matches = [];
    while (iterator.hasNext()) {
      var match = iterator.next();
      if (!match.isTrashed()) {
        matches.push({
          id: match.getId(),
          name: match.getName(),
          url: match.getUrl()
        });
      }
    }

    var configuredId = String(
      cfg.resources.backupFolderId ||
      PropertiesService.getScriptProperties().getProperty(FOLDER_PROPERTY) ||
      ''
    );
    var configured = null;
    if (configuredId) {
      try {
        var folder = DriveApp.getFolderById(configuredId);
        var parents = [];
        var parentIterator = folder.getParents();
        while (parentIterator.hasNext()) {
          parents.push(parentIterator.next().getId());
        }
        configured = {
          id: configuredId,
          exists: true,
          trashed: folder.isTrashed(),
          name: folder.getName(),
          url: folder.getUrl(),
          parentIds: parents,
          underDevRoot: parents.indexOf(cfg.resources.devRootFolderId) >= 0
        };
      } catch (caught) {
        configured = {
          id: configuredId,
          exists: false,
          error: String(caught && caught.message || caught)
        };
      }
    }

    return {
      devRootFolderId: cfg.resources.devRootFolderId,
      exactMatchCount: matches.length,
      exactMatches: matches,
      configured: configured
    };
  }

  function nonTerminalBackupOperations_() {
    var sheet = dwh_().getSheetByName('OPERATION_QUEUE');
    if (!sheet) return [];
    var activeStatuses = {
      QUEUED: true,
      RUNNING: true,
      PAUSED: true,
      RETRY_PENDING: true
    };
    return AKORT.Core.Sheets.readObjects(sheet).filter(function (row) {
      return String(row.operation_type || '') === OPERATION_TYPE &&
        activeStatuses[String(row.status || '')] === true;
    }).map(function (row) {
      return {
        operationId: String(row.operation_id || ''),
        status: String(row.status || ''),
        phase: String(row.current_phase || ''),
        requestedAt: String(row.requested_at || '')
      };
    });
  }

  function deploymentPreflight() {
    return AKORT.Core.safeRun(
      'BETA11_DEPLOYMENT_PREFLIGHT',
      function () {
        assertBase_();
        var cfg = config_();
        var dwhFile = DriveApp.getFileById(
          cfg.resources.dwhSpreadsheetId
        );
        var publishFile = DriveApp.getFileById(
          cfg.resources.publishSpreadsheetId
        );
        var registry = registryInspection_();
        var folder = folderInspection_();
        var triggers = triggerCounts_();
        var activeOperations = nonTerminalBackupOperations_();
        var handlerReady = Boolean(
          AKORT.Beta11BackupHandlers &&
          typeof AKORT.Beta11BackupHandlers.supports === 'function' &&
          AKORT.Beta11BackupHandlers.supports(OPERATION_TYPE)
        );
        var blockers = [];

        if (!handlerReady) blockers.push('BACKUP_HANDLER_NOT_READY');
        if (!registry.schemaMatches) {
          blockers.push('BACKUP_REGISTRY_SCHEMA_MISMATCH');
        }
        if (folder.exactMatchCount > 1) {
          blockers.push('BACKUP_FOLDER_AMBIGUOUS');
        }
        if (folder.configured) {
          if (!folder.configured.exists) {
            blockers.push('CONFIGURED_BACKUP_FOLDER_MISSING');
          } else {
            if (folder.configured.trashed) {
              blockers.push('CONFIGURED_BACKUP_FOLDER_TRASHED');
            }
            if (folder.configured.name !== FOLDER_NAME) {
              blockers.push('CONFIGURED_BACKUP_FOLDER_NAME_MISMATCH');
            }
            if (!folder.configured.underDevRoot) {
              blockers.push('CONFIGURED_BACKUP_FOLDER_OUTSIDE_DEV_ROOT');
            }
          }
        }
        if (triggers.daily > 1) {
          blockers.push('MULTIPLE_DAILY_BACKUP_TRIGGERS');
        }
        if (triggers.worker > 1) {
          blockers.push('MULTIPLE_BACKUP_WORKER_TRIGGERS');
        }
        if (activeOperations.length) {
          blockers.push('NON_TERMINAL_BACKUP_OPERATION_EXISTS');
        }

        var data = {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          baseCommit: BASE_COMMIT,
          readyToInstall: blockers.length === 0,
          blockers: blockers,
          sources: {
            dwh: fileSummary_(dwhFile),
            publish: fileSummary_(publishFile)
          },
          registry: registry,
          folder: folder,
          triggerCounts: triggers,
          activeBackupOperations: activeOperations,
          handlerReady: handlerReady,
          writeBoundary: 'READ_ONLY',
          userPipelineEnabled: false,
          productionTouched: false
        };

        return blockers.length
          ? AKORT.Result.failure(
              'BETA11_DEPLOYMENT_PREFLIGHT_BLOCKED',
              'Beta.1.1 deployment preflight found blockers.',
              data
            )
          : AKORT.Result.success(
              'Beta.1.1 deployment preflight passed.',
              data
            );
      },
      { lock: false, persistLogs: false }
    );
  }

  function operationStatus_(result) {
    var data = result && result.data || null;
    var details = result && result.details || null;
    var operation = null;

    if (data && data.operation) {
      operation = data.operation;
    } else if (details && details.operation) {
      operation = details.operation;
    } else if (data && data.data && data.data.operation) {
      operation = data.data.operation;
    } else if (data && data.operation_id && data.operation_type) {
      operation = data;
    } else if (details &&
      details.operation_id &&
      details.operation_type) {
      operation = details;
    }

    return String(operation && operation.status || '');
  }

  function continueOrSchedule_(operationId, result) {
    var status = operationStatus_(result);
    if (TERMINAL[status]) {
      PropertiesService.getScriptProperties().deleteProperty(ACTIVE_PROPERTY);
      deleteTriggers_(WORKER_HANDLER);
      return result;
    }
    PropertiesService.getScriptProperties().setProperty(
      ACTIVE_PROPERTY,
      operationId
    );
    scheduleWorker_();
    return result;
  }

  function start_(requestType, backupId, scheduledDate) {
    assertBase_();
    ensureFolder_();
    var queued = AKORT.Beta14OperationalHardening.enqueueGuarded(
      OPERATION_TYPE,
      {
        backupId: backupId,
        requestType: requestType,
        scheduledDate: scheduledDate || ''
      },
      {
        idempotencyKey: backupId,
        maxAttempts: 24,
        priority: requestType === 'DAILY' ? 80 : 60
      }
    );
    if (!queued.ok) return queued;
    var operationId = queued.data.operationId;
    PropertiesService.getScriptProperties().setProperty(
      ACTIVE_PROPERTY,
      operationId
    );
    var result = AKORT.OperationEngine.run(operationId, {
      maxSteps: 50,
      executionBudgetMs: 240000,
      minRemainingMs: 15000
    });
    return continueOrSchedule_(operationId, result);
  }

  function install() {
    var preflight = deploymentPreflight();
    if (!preflight.ok) return preflight;

    /*
     * Core.install owns its own Script Lock. It must finish before the
     * Beta.1.1 installation lock is acquired; Apps Script locks are not
     * re-entrant.
     */
    var core = AKORT.Core.install();
    if (!core.ok) return core;

    return AKORT.Core.safeRun(
      'BETA11_PAIRED_BACKUP_INSTALL',
      function () {
        assertBase_();
        var folder = ensureFolder_();
        var triggerId = installDailyTrigger_();
        return AKORT.Result.success(
          'Beta.1.1 paired backup installed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            deploymentPreflight: preflight.data,
            coreInstallation: core.data,
            backupFolderId: folder.getId(),
            backupFolderName: folder.getName(),
            schedule: {
              frequency: 'DAILY',
              nominalTime: '04:00',
              triggerWindow: '03:45-04:15',
              timezone: TIMEZONE,
              includesWeekends: true,
              busyRetryMinutes: 10
            },
            dailyTriggerId: triggerId,
            triggerCounts: triggerCounts_(),
            userPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function backupNow() {
    return start_('MANUAL', manualBackupId_(), '');
  }

  function dailyTick() {
    var now = new Date();
    return start_(
      'DAILY',
      dailyBackupId_(now),
      moscowDateKey_(now)
    );
  }

  function worker() {
    assertBase_();
    deleteTriggers_(WORKER_HANDLER);
    var operationId = PropertiesService.getScriptProperties()
      .getProperty(ACTIVE_PROPERTY);
    if (!operationId) {
      return AKORT.Result.success(
        'No active Beta.1.1 backup operation is registered.',
        { triggerCounts: triggerCounts_() }
      );
    }
    var result = AKORT.OperationEngine.resume(operationId, {
      maxSteps: 50,
      executionBudgetMs: 240000,
      minRemainingMs: 15000
    });
    return continueOrSchedule_(operationId, result);
  }

  function latestRegistry_() {
    var rows = readRegistry_();
    if (!rows.length) return null;
    rows.sort(function (a, b) {
      return String(b.started_at || '').localeCompare(
        String(a.started_at || '')
      );
    });
    var row = clone_(rows[0]);
    delete row.__row;
    return row;
  }

  function status(operationId) {
    return AKORT.Core.safeRun('BETA11_PAIRED_BACKUP_STATUS', function () {
      assertBase_();
      var active = String(operationId ||
        PropertiesService.getScriptProperties().getProperty(ACTIVE_PROPERTY) ||
        '');
      return AKORT.Result.success(
        'Beta.1.1 paired backup status loaded.',
        {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          backupFolderId: String(
            PropertiesService.getScriptProperties()
              .getProperty(FOLDER_PROPERTY) || ''
          ),
          schedule: {
            frequency: 'DAILY',
            nominalTime: '04:00',
            triggerWindow: '03:45-04:15',
            timezone: TIMEZONE,
            includesWeekends: true,
            busyRetryMinutes: 10
          },
          triggerCounts: triggerCounts_(),
          activeOperationId: active,
          activeOperation: active ?
            AKORT.OperationEngine.status(active) : null,
          latestBackup: latestRegistry_(),
          retention: {
            automaticDeletion: false,
            ownerRelease: 'Beta.1.6'
          },
          userPipelineEnabled: false,
          productionTouched: false
        }
      );
    }, { lock: false, persistLogs: false });
  }

  return {
    packageVersion: PACKAGE_VERSION,
    contractVersion: CONTRACT_VERSION,
    baseRelease: BASE_RELEASE,
    operationType: OPERATION_TYPE,
    execute: execute_,
    deploymentPreflight: deploymentPreflight,
    install: install,
    backupNow: backupNow,
    dailyTick: dailyTick,
    worker: worker,
    status: status,
    Test: {
      dailyBackupId: dailyBackupId_,
      manualBackupId: manualBackupId_,
      operationBoundary: operationBoundary_,
      operationStatus: operationStatus_
    }
  };
})();

AKORT.Beta11BackupHandlers = {
  supports: function (operationType) {
    return String(operationType || '') ===
      AKORT.Beta11PairedBackup.operationType;
  },
  execute: function (phase, context) {
    return AKORT.Beta11PairedBackup.execute(phase, context);
  }
};

function AKORT_beta11DeploymentPreflight() {
  var result = AKORT.Beta11PairedBackup.deploymentPreflight();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11Install() {
  var result = AKORT.Beta11PairedBackup.install();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11BackupNow() {
  var result = AKORT.Beta11PairedBackup.backupNow();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11DailyBackupTrigger() {
  var result = AKORT.Beta11PairedBackup.dailyTick();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11BackupWorker() {
  var result = AKORT.Beta11PairedBackup.worker();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11BackupStatus(operationId) {
  var result = AKORT.Beta11PairedBackup.status(operationId || '');
  console.log(JSON.stringify(result, null, 2));
  return result;
}
