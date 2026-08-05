var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.1 r6 acceptance harness: isolated restore rehearsal for one accepted
 * paired backup. The harness creates copies only from backup members and
 * never changes the active DEV DWH/Publish configuration.
 */
AKORT.Beta11RestoreRehearsal = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.1.7';
  var CONTRACT_VERSION = '4.0-beta11-isolated-restore-rehearsal-2';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = 'cc5451f3bfaad4a294f07c31a7c0b76b71f14299';
  var OPERATION_TYPE = 'BETA11_RESTORE_REHEARSAL';
  var DEFAULT_BACKUP_ID = 'BKP_DAILY_20260805';
  var ACTIVE_PROPERTY = 'AKORT_BETA11_RESTORE_REHEARSAL_ACTIVE_OPERATION_ID';
  var EVIDENCE_PROPERTY = 'AKORT_BETA11_RESTORE_REHEARSAL_LATEST_EVIDENCE';
  var ROOT_FOLDER_NAME = '09_Проверка восстановления';
  var CHUNK_CELL_LIMIT = 20000;
  var MAX_CELLS_PER_INVOCATION = 640000;
  var MAX_CHUNKS_PER_INVOCATION = 40;
  var MAX_HANDLER_MS = 210000;
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

  function text_(value) {
    return value === null || value === undefined ? '' : String(value).trim();
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
        'BETA11_RESTORE_BASE_RELEASE_MISMATCH',
        'Restore rehearsal requires the accepted Alpha.7.4 runtime.',
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
        'BETA11_RESTORE_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Restore rehearsal cannot run after the general user pipeline is enabled.',
        { retryable: false }
      );
    }
  }

  function config_() {
    return AKORT.Config.load({ includeSystemSettings: false });
  }

  function dwh_() {
    return SpreadsheetApp.openById(config_().resources.dwhSpreadsheetId);
  }

  function readObjects_(spreadsheet, name, expectedHeaders) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_REQUIRED_TABLE_MISSING',
        'Required service table is missing.',
        { table: name, retryable: false }
      );
    }
    var actual = sheet.getRange(
      1, 1, 1, Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expectedHeaders)) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_SERVICE_SCHEMA_MISMATCH',
        'Service-table schema differs from the accepted contract.',
        {
          table: name,
          expected: expectedHeaders,
          actual: actual,
          retryable: false
        }
      );
    }
    return AKORT.Core.Sheets.readObjects(sheet);
  }

  function backupRow_(backupId) {
    var rows = readObjects_(
      dwh_(),
      'BACKUP_REGISTRY',
      AKORT.Core.Tables.BACKUP_REGISTRY
    );
    var matches = rows.filter(function (row) {
      return text_(row.backup_id) === text_(backupId);
    });
    if (matches.length !== 1) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_BACKUP_REGISTRY_IDENTITY_INVALID',
        'Exactly one BACKUP_REGISTRY row is required for the rehearsal.',
        {
          backupId: backupId,
          matches: matches.length,
          retryable: false,
          requiresReview: matches.length > 1
        }
      );
    }
    var copy = clone_(matches[0]);
    delete copy.__row;
    return copy;
  }

  function fileSummary_(file) {
    return {
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: Number(file.getSize() || 0),
      updatedAt: file.getLastUpdated().toISOString(),
      trashed: file.isTrashed()
    };
  }

  function assertSheetFile_(fileId, label) {
    var file = DriveApp.getFileById(fileId);
    if (file.isTrashed()) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_BACKUP_MEMBER_TRASHED',
        'Backup member is trashed.',
        { member: label, fileId: fileId, retryable: false, requiresReview: true }
      );
    }
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_BACKUP_MEMBER_NOT_SHEET',
        'Backup member is not a Google Sheets file.',
        {
          member: label,
          fileId: fileId,
          mimeType: file.getMimeType(),
          retryable: false,
          requiresReview: true
        }
      );
    }
    return file;
  }

  function manifestValidation_(row) {
    var file = DriveApp.getFileById(text_(row.manifest_file_id));
    if (file.isTrashed()) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_MANIFEST_TRASHED',
        'Backup manifest is trashed.',
        { fileId: file.getId(), retryable: false, requiresReview: true }
      );
    }
    var parsed;
    try {
      parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (caught) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_MANIFEST_INVALID_JSON',
        'Backup manifest is not valid JSON.',
        { cause: String(caught), retryable: false, requiresReview: true }
      );
    }
    var hash = AKORT.Core.sha256(AKORT.Core.canonicalJson(parsed));
    if (hash !== text_(row.manifest_hash)) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_MANIFEST_HASH_MISMATCH',
        'Backup manifest hash differs from BACKUP_REGISTRY.',
        {
          expected: text_(row.manifest_hash),
          actual: hash,
          retryable: false,
          requiresReview: true
        }
      );
    }
    var validBinding =
      text_(parsed.backupId) === text_(row.backup_id) &&
      text_(parsed.members && parsed.members.dwh &&
        parsed.members.dwh.backupId) === text_(row.dwh_backup_id) &&
      text_(parsed.members && parsed.members.publish &&
        parsed.members.publish.backupId) === text_(row.publish_backup_id);
    if (!validBinding) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_MANIFEST_BINDING_MISMATCH',
        'Backup manifest member binding differs from BACKUP_REGISTRY.',
        { backupId: row.backup_id, retryable: false, requiresReview: true }
      );
    }
    return {
      file: fileSummary_(file),
      payload: parsed,
      hash: hash
    };
  }

  function activeOtherOperations_(currentOperationId) {
    var rows = readObjects_(
      dwh_(),
      'OPERATION_QUEUE',
      AKORT.Core.Tables.OPERATION_QUEUE
    );
    var active = { QUEUED: true, RUNNING: true, PAUSED: true, RETRY_PENDING: true };
    return rows.filter(function (row) {
      return text_(row.operation_id) !== text_(currentOperationId) &&
        active[text_(row.status)] === true;
    }).map(function (row) {
      return {
        operationId: text_(row.operation_id),
        operationType: text_(row.operation_type),
        status: text_(row.status),
        phase: text_(row.current_phase)
      };
    });
  }

  function backupValidation_(backupId, currentOperationId) {
    assertBase_();
    var row = backupRow_(backupId);
    var blockers = [];
    if (text_(row.status) !== 'SUCCESS') blockers.push('BACKUP_NOT_SUCCESS');
    [
      'dwh_backup_id',
      'publish_backup_id',
      'manifest_file_id',
      'manifest_hash'
    ].forEach(function (field) {
      if (!text_(row[field])) blockers.push('BACKUP_FIELD_MISSING_' + field.toUpperCase());
    });
    var others = activeOtherOperations_(currentOperationId);
    if (others.length) blockers.push('COMPETING_OPERATION_ACTIVE');
    if (blockers.length) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_PREFLIGHT_BLOCKED',
        'Restore rehearsal preflight found blockers.',
        {
          backupId: backupId,
          blockers: blockers,
          competingOperations: others,
          retryable: false
        }
      );
    }

    var dwhFile = assertSheetFile_(text_(row.dwh_backup_id), 'DWH');
    var publishFile = assertSheetFile_(text_(row.publish_backup_id), 'PUBLISH');
    var manifest = manifestValidation_(row);

    return {
      backup: row,
      dwh: fileSummary_(dwhFile),
      publish: fileSummary_(publishFile),
      manifest: {
        file: manifest.file,
        hash: manifest.hash,
        operationBoundary: clone_(manifest.payload.operationBoundary || {})
      },
      competingOperations: others
    };
  }

  function exactFolders_(parent, name) {
    var iterator = parent.getFoldersByName(name);
    var matches = [];
    while (iterator.hasNext()) {
      var folder = iterator.next();
      if (!folder.isTrashed()) matches.push(folder);
    }
    return matches;
  }

  function ensureExactFolder_(parent, name) {
    var matches = exactFolders_(parent, name);
    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_FOLDER_AMBIGUOUS',
        'More than one exact non-trashed rehearsal folder exists.',
        { name: name, count: matches.length, retryable: false, requiresReview: true }
      );
    }
    return matches.length === 1 ? matches[0] : parent.createFolder(name);
  }

  function exactFiles_(folder, name) {
    var iterator = folder.getFilesByName(name);
    var matches = [];
    while (iterator.hasNext()) {
      var file = iterator.next();
      if (!file.isTrashed()) matches.push(file);
    }
    return matches;
  }

  function copyOrAdopt_(sourceId, folder, name) {
    var matches = exactFiles_(folder, name);
    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_MEMBER_AMBIGUOUS',
        'More than one exact restored member exists.',
        { name: name, count: matches.length, retryable: false, requiresReview: true }
      );
    }
    if (matches.length === 1) {
      return {
        id: matches[0].getId(),
        name: matches[0].getName(),
        url: matches[0].getUrl(),
        adopted: true
      };
    }
    var copy = DriveApp.getFileById(sourceId).makeCopy(name, folder);
    return {
      id: copy.getId(),
      name: copy.getName(),
      url: copy.getUrl(),
      adopted: false
    };
  }

  function normalizeValue_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return { __type: 'DATE', value: value.toISOString() };
    }
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      if (isNaN(value)) return { __type: 'NUMBER', value: 'NaN' };
      if (!isFinite(value)) {
        return { __type: 'NUMBER', value: value > 0 ? 'Infinity' : '-Infinity' };
      }
      return value;
    }
    if (typeof value === 'boolean') return value;
    return String(value);
  }

  function normalizeMatrix_(values) {
    return (values || []).map(function (row) {
      return (row || []).map(normalizeValue_);
    });
  }

  function namedRanges_(spreadsheet) {
    return spreadsheet.getNamedRanges().map(function (namedRange) {
      var range = namedRange.getRange();
      return {
        name: namedRange.getName(),
        sheet: range.getSheet().getName(),
        a1: range.getA1Notation()
      };
    }).sort(function (left, right) {
      return (left.name + '|' + left.sheet + '|' + left.a1)
        .localeCompare(right.name + '|' + right.sheet + '|' + right.a1);
    });
  }

  function sheetDescriptor_(sheet, index) {
    return {
      index: index,
      name: sheet.getName(),
      hidden: sheet.isSheetHidden(),
      frozenRows: sheet.getFrozenRows(),
      frozenColumns: sheet.getFrozenColumns(),
      maxRows: sheet.getMaxRows(),
      maxColumns: sheet.getMaxColumns(),
      lastRow: sheet.getLastRow(),
      lastColumn: sheet.getLastColumn()
    };
  }

  function workbookMetadata_(spreadsheet) {
    var sheets = spreadsheet.getSheets().map(sheetDescriptor_);
    return {
      locale: spreadsheet.getSpreadsheetLocale(),
      timezone: spreadsheet.getSpreadsheetTimeZone(),
      namedRanges: namedRanges_(spreadsheet),
      sheets: sheets
    };
  }

  function prepareScan_(sourceId, restoredId, label) {
    var source = SpreadsheetApp.openById(sourceId);
    var restored = SpreadsheetApp.openById(restoredId);
    var sourceMetadata = workbookMetadata_(source);
    var restoredMetadata = workbookMetadata_(restored);
    var sourceFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(sourceMetadata)
    );
    var restoredFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(restoredMetadata)
    );
    if (sourceFingerprint !== restoredFingerprint) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_WORKBOOK_METADATA_MISMATCH',
        'Restored workbook metadata differs from the backup member.',
        {
          member: label,
          sourceFingerprint: sourceFingerprint,
          restoredFingerprint: restoredFingerprint,
          retryable: false,
          requiresReview: true
        }
      );
    }
    return {
      label: label,
      sourceId: sourceId,
      restoredId: restoredId,
      metadataFingerprint: sourceFingerprint,
      sheets: sourceMetadata.sheets,
      sheetIndex: 0,
      rowCursor: 1,
      currentSheetHash: '',
      chainHash: AKORT.Core.sha256(
        'RESTORE_REHEARSAL|' + label + '|' + sourceFingerprint
      ),
      chunks: 0,
      cells: 0,
      sheetResults: [],
      complete: false,
      workbookFingerprint: ''
    };
  }

  function nextChainHash_(previous, value) {
    return AKORT.Core.sha256(text_(previous) + '|' + text_(value));
  }

  function chunkPayload_(range) {
    return {
      values: normalizeMatrix_(range.getValues()),
      formulasR1C1: range.getFormulasR1C1(),
      numberFormats: range.getNumberFormats()
    };
  }

  function finishSheet_(scan, descriptor) {
    scan.sheetResults.push({
      name: descriptor.name,
      lastRow: descriptor.lastRow,
      lastColumn: descriptor.lastColumn,
      fingerprint: scan.currentSheetHash ||
        AKORT.Core.sha256(
          'EMPTY|' + descriptor.name + '|' +
          descriptor.lastRow + '|' + descriptor.lastColumn
        )
    });
    scan.chainHash = nextChainHash_(
      scan.chainHash,
      scan.sheetResults[scan.sheetResults.length - 1].fingerprint
    );
    scan.sheetIndex += 1;
    scan.rowCursor = 1;
    scan.currentSheetHash = '';
  }

  function completeScan_(scan) {
    scan.complete = true;
    scan.workbookFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson({
        label: scan.label,
        metadataFingerprint: scan.metadataFingerprint,
        chainHash: scan.chainHash,
        chunks: scan.chunks,
        cells: scan.cells,
        sheetResults: scan.sheetResults
      })
    );
    return scan;
  }

  function scanMember_(scan) {
    if (scan.complete) {
      return {
        complete: true,
        member: scan.label,
        workbookFingerprint: scan.workbookFingerprint
      };
    }
    var source = SpreadsheetApp.openById(scan.sourceId);
    var restored = SpreadsheetApp.openById(scan.restoredId);
    var startedMs = Date.now();
    var invocationCells = 0;
    var invocationChunks = 0;

    while (scan.sheetIndex < scan.sheets.length) {
      var descriptor = scan.sheets[scan.sheetIndex];
      var sourceSheet = source.getSheetByName(descriptor.name);
      var restoredSheet = restored.getSheetByName(descriptor.name);
      if (!sourceSheet || !restoredSheet) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_SHEET_MISSING',
          'A required sheet is absent from the backup member or restored copy.',
          {
            member: scan.label,
            sheet: descriptor.name,
            retryable: false,
            requiresReview: true
          }
        );
      }

      if (!scan.currentSheetHash) {
        scan.currentSheetHash = AKORT.Core.sha256(
          AKORT.Core.canonicalJson({
            member: scan.label,
            descriptor: descriptor
          })
        );
      }

      if (descriptor.lastRow < 1 || descriptor.lastColumn < 1) {
        finishSheet_(scan, descriptor);
        continue;
      }

      if (scan.rowCursor > descriptor.lastRow) {
        finishSheet_(scan, descriptor);
        continue;
      }

      var rowsPerChunk = Math.max(
        1,
        Math.floor(CHUNK_CELL_LIMIT / Math.max(1, descriptor.lastColumn))
      );
      var rowCount = Math.min(
        rowsPerChunk,
        descriptor.lastRow - scan.rowCursor + 1
      );
      var sourceRange = sourceSheet.getRange(
        scan.rowCursor, 1, rowCount, descriptor.lastColumn
      );
      var restoredRange = restoredSheet.getRange(
        scan.rowCursor, 1, rowCount, descriptor.lastColumn
      );
      var sourceHash = AKORT.Core.sha256(
        AKORT.Core.canonicalJson(chunkPayload_(sourceRange))
      );
      var restoredHash = AKORT.Core.sha256(
        AKORT.Core.canonicalJson(chunkPayload_(restoredRange))
      );

      if (sourceHash !== restoredHash) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_CHUNK_MISMATCH',
          'Restored workbook content differs from the backup member.',
          {
            member: scan.label,
            sheet: descriptor.name,
            startRow: scan.rowCursor,
            rowCount: rowCount,
            sourceHash: sourceHash,
            restoredHash: restoredHash,
            retryable: false,
            requiresReview: true
          }
        );
      }

      scan.currentSheetHash = nextChainHash_(
        scan.currentSheetHash,
        sourceHash
      );
      scan.rowCursor += rowCount;
      scan.chunks += 1;
      scan.cells += rowCount * descriptor.lastColumn;
      invocationChunks += 1;
      invocationCells += rowCount * descriptor.lastColumn;

      if (scan.rowCursor > descriptor.lastRow) {
        finishSheet_(scan, descriptor);
      }

      if (invocationChunks >= MAX_CHUNKS_PER_INVOCATION ||
          invocationCells >= MAX_CELLS_PER_INVOCATION ||
          Date.now() - startedMs >= MAX_HANDLER_MS) {
        return {
          complete: false,
          repeatPhase: true,
          member: scan.label,
          sheetIndex: scan.sheetIndex,
          rowCursor: scan.rowCursor,
          invocationChunks: invocationChunks,
          invocationCells: invocationCells,
          totalChunks: scan.chunks,
          totalCells: scan.cells
        };
      }
    }

    completeScan_(scan);
    return {
      complete: true,
      member: scan.label,
      workbookFingerprint: scan.workbookFingerprint,
      chunks: scan.chunks,
      cells: scan.cells,
      sheets: scan.sheetResults.length
    };
  }

  function state_(checkpoint) {
    checkpoint.handlerState = checkpoint.handlerState || {};
    checkpoint.handlerState.beta11RestoreRehearsal =
      checkpoint.handlerState.beta11RestoreRehearsal || {};
    var state = checkpoint.handlerState.beta11RestoreRehearsal;
    var input = checkpoint.input || {};
    state.backupId = state.backupId || text_(input.backupId || DEFAULT_BACKUP_ID);
    state.reason = state.reason ||
      text_(input.reason || 'Beta.1 isolated restore rehearsal');
    state.startedAt = state.startedAt || AKORT.Core.now();
    return state;
  }

  function evidenceBase_(state, operationId) {
    return {
      schemaVersion: CONTRACT_VERSION,
      packageVersion: PACKAGE_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      rehearsalId: state.rehearsalId,
      backupId: state.backupId,
      operationId: operationId,
      status: 'PASS',
      scope: 'ISOLATED_BACKUP_COPY_ONLY',
      reason: state.reason,
      startedAt: state.startedAt,
      finishedAt: AKORT.Core.now(),
      acceptedRuntime: AKORT.Release.version,
      backupManifestHash: state.backup.manifestHash,
      backupOperationId: state.backup.operationId,
      isolatedFolder: clone_(state.isolatedFolder),
      members: {
        dwh: {
          backupFileId: state.backup.dwhBackupId,
          restoredFileId: state.restoredDwh.id,
          restoredFileUrl: state.restoredDwh.url,
          metadataFingerprint: state.dwhScan.metadataFingerprint,
          workbookFingerprint: state.dwhScan.workbookFingerprint,
          sheets: state.dwhScan.sheetResults.length,
          chunks: state.dwhScan.chunks,
          cells: state.dwhScan.cells,
          sheetResults: clone_(state.dwhScan.sheetResults)
        },
        publish: {
          backupFileId: state.backup.publishBackupId,
          restoredFileId: state.restoredPublish.id,
          restoredFileUrl: state.restoredPublish.url,
          metadataFingerprint: state.publishScan.metadataFingerprint,
          workbookFingerprint: state.publishScan.workbookFingerprint,
          sheets: state.publishScan.sheetResults.length,
          chunks: state.publishScan.chunks,
          cells: state.publishScan.cells,
          sheetResults: clone_(state.publishScan.sheetResults)
        }
      },
      checks: clone_(state.checks || []),
      safety: {
        productionTouched: false,
        activeDevConfigurationChanged: false,
        dataPlaneWrite: false,
        rawWrite: false,
        publishWrite: false,
        physicalDeletion: false,
        triggerCreated: false,
        triggerDeleted: false,
        userPipelineEnabled: false
      },
      createdBy: currentUser_()
    };
  }

  function createOrAdoptEvidence_(folder, name, base) {
    var evidenceHash = AKORT.Core.sha256(AKORT.Core.canonicalJson(base));
    var evidenceId = 'RRE_' + evidenceHash.slice(0, 24).toUpperCase();
    var payload = clone_(base);
    payload.evidenceId = evidenceId;
    payload.evidenceHash = evidenceHash;
    var expectedJson = JSON.stringify(payload, null, 2);
    var expectedFileHash = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(payload)
    );
    var matches = exactFiles_(folder, name);
    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_EVIDENCE_AMBIGUOUS',
        'More than one exact evidence file exists.',
        { name: name, count: matches.length, retryable: false, requiresReview: true }
      );
    }
    var file;
    var adopted = false;
    if (matches.length === 1) {
      file = matches[0];
      var parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      var actualFileHash = AKORT.Core.sha256(
        AKORT.Core.canonicalJson(parsed)
      );
      if (actualFileHash !== expectedFileHash) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_EVIDENCE_CONFLICT',
          'Existing deterministic evidence differs from expected payload.',
          {
            expectedFileHash: expectedFileHash,
            actualFileHash: actualFileHash,
            retryable: false,
            requiresReview: true
          }
        );
      }
      adopted = true;
    } else {
      file = folder.createFile(name, expectedJson, MimeType.PLAIN_TEXT);
    }
    return {
      evidenceId: evidenceId,
      evidenceHash: evidenceHash,
      fileHash: expectedFileHash,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      adopted: adopted
    };
  }

  function execute_(phase, context) {
    assertBase_();
    var state = state_(context.checkpoint);

    if (phase === 'DISCOVER') {
      var validation = backupValidation_(
        state.backupId,
        context.operation.operation_id
      );
      state.backup = {
        status: validation.backup.status,
        operationId: text_(validation.backup.operation_id),
        dwhBackupId: text_(validation.backup.dwh_backup_id),
        publishBackupId: text_(validation.backup.publish_backup_id),
        manifestFileId: text_(validation.backup.manifest_file_id),
        manifestHash: text_(validation.backup.manifest_hash)
      };
      state.rehearsalId = 'RR_' +
        AKORT.Core.sha256(
          state.backupId + '|' + state.backup.manifestHash + '|' +
          PACKAGE_VERSION
        ).slice(0, 20).toUpperCase();
      return {
        backupId: state.backupId,
        rehearsalId: state.rehearsalId,
        backupStatus: state.backup.status,
        manifestHash: state.backup.manifestHash
      };
    }

    if (phase === 'VALIDATE') {
      var competitors = activeOtherOperations_(
        context.operation.operation_id
      );
      if (competitors.length) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_COMPETING_OPERATION_ACTIVE',
          'Restore rehearsal requires an otherwise quiescent DEV operation queue.',
          {
            competingOperations: competitors,
            retryable: true
          }
        );
      }
      manifestValidation_(backupRow_(state.backupId));
      return {
        operationQuiescent: true,
        competingOperations: []
      };
    }

    if (phase === 'PARSE') {
      state.folderName = 'RESTORE_REHEARSAL__' +
        state.backupId + '__' + state.rehearsalId;
      state.dwhRestoreName = 'RESTORED_DWH__' +
        state.backupId + '__' + state.rehearsalId;
      state.publishRestoreName = 'RESTORED_PUBLISH__' +
        state.backupId + '__' + state.rehearsalId;
      state.evidenceName = 'AKORT_RESTORE_REHEARSAL_EVIDENCE__' +
        state.rehearsalId + '.json';
      return {
        folderName: state.folderName,
        dwhRestoreName: state.dwhRestoreName,
        publishRestoreName: state.publishRestoreName,
        evidenceName: state.evidenceName
      };
    }

    if (phase === 'STAGE') {
      var cfg = config_();
      var root = ensureExactFolder_(
        DriveApp.getFolderById(cfg.resources.devRootFolderId),
        ROOT_FOLDER_NAME
      );
      var isolated = ensureExactFolder_(root, state.folderName);
      state.isolatedFolder = {
        id: isolated.getId(),
        name: isolated.getName(),
        url: isolated.getUrl(),
        parentId: root.getId(),
        parentName: root.getName()
      };
      state.restoredDwh = copyOrAdopt_(
        state.backup.dwhBackupId,
        isolated,
        state.dwhRestoreName
      );
      return {
        member: 'DWH',
        isolatedFolderId: isolated.getId(),
        restoredFileId: state.restoredDwh.id,
        adopted: state.restoredDwh.adopted
      };
    }

    if (phase === 'COMMIT_RAW') {
      var rehearsalFolder = DriveApp.getFolderById(
        state.isolatedFolder.id
      );
      state.restoredPublish = copyOrAdopt_(
        state.backup.publishBackupId,
        rehearsalFolder,
        state.publishRestoreName
      );
      return {
        member: 'PUBLISH',
        restoredFileId: state.restoredPublish.id,
        adopted: state.restoredPublish.adopted
      };
    }

    if (phase === 'UPDATE_PUBLISH') {
      state.dwhScan = state.dwhScan || prepareScan_(
        state.backup.dwhBackupId,
        state.restoredDwh.id,
        'DWH'
      );
      state.publishScan = state.publishScan || prepareScan_(
        state.backup.publishBackupId,
        state.restoredPublish.id,
        'PUBLISH'
      );
      return {
        dwhMetadataFingerprint: state.dwhScan.metadataFingerprint,
        publishMetadataFingerprint: state.publishScan.metadataFingerprint,
        dwhSheets: state.dwhScan.sheets.length,
        publishSheets: state.publishScan.sheets.length
      };
    }

    if (phase === 'PREPARING_AGGREGATE_IMPACT') {
      var dwhOutcome = scanMember_(state.dwhScan);
      if (!dwhOutcome.complete) dwhOutcome.repeatPhase = true;
      return dwhOutcome;
    }

    if (phase === 'MATERIALIZING_AGGREGATE_INPUTS') {
      var publishOutcome = scanMember_(state.publishScan);
      if (!publishOutcome.complete) publishOutcome.repeatPhase = true;
      return publishOutcome;
    }

    if (phase === 'CALCULATING_AGGREGATE_SLICES') {
      if (!state.dwhScan.complete || !state.publishScan.complete) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_SCAN_INCOMPLETE',
          'Both restored workbooks must complete exact comparison.',
          { retryable: false }
        );
      }
      return {
        dwhWorkbookFingerprint: state.dwhScan.workbookFingerprint,
        publishWorkbookFingerprint: state.publishScan.workbookFingerprint
      };
    }

    if (phase === 'STAGING_AGGREGATE_ROWS' ||
        phase === 'UPDATING_AGGREGATES' ||
        phase === 'UPDATING_AGGREGATE_LATEST' ||
        phase === 'RECONCILING_AGGREGATES' ||
        phase === 'UPDATE_STATUS') {
      return {
        phase: phase,
        activeDevConfigurationChanged: false,
        dataPlaneWrite: false
      };
    }

    if (phase === 'QUICK_AUDIT') {
      var active = activeOtherOperations_(context.operation.operation_id);
      if (active.length) {
        throw AKORT.Core.error(
          'BETA11_RESTORE_AUDIT_OPERATION_CONFLICT',
          'A competing operation appeared before final evidence.',
          { competingOperations: active, retryable: false, requiresReview: true }
        );
      }
      state.checks = [
        { id: 'BACKUP_REGISTRY_SUCCESS', status: 'PASS' },
        { id: 'MANIFEST_HASH_AND_BINDING', status: 'PASS' },
        { id: 'ISOLATED_FOLDER_CREATED', status: 'PASS' },
        { id: 'DWH_RESTORED_COPY_CREATED', status: 'PASS' },
        { id: 'PUBLISH_RESTORED_COPY_CREATED', status: 'PASS' },
        {
          id: 'DWH_EXACT_WORKBOOK_COMPARISON',
          status: 'PASS',
          fingerprint: state.dwhScan.workbookFingerprint
        },
        {
          id: 'PUBLISH_EXACT_WORKBOOK_COMPARISON',
          status: 'PASS',
          fingerprint: state.publishScan.workbookFingerprint
        },
        { id: 'OPERATION_QUIESCENCE', status: 'PASS' },
        {
          id: 'NO_ACTIVE_CONFIGURATION_OR_DATA_PLANE_WRITE',
          status: 'PASS'
        }
      ];
      return {
        status: 'PASS',
        checksTotal: state.checks.length,
        checksPassed: state.checks.length,
        dwhFingerprint: state.dwhScan.workbookFingerprint,
        publishFingerprint: state.publishScan.workbookFingerprint
      };
    }

    if (phase === 'FINALIZING') {
      var folder = DriveApp.getFolderById(state.isolatedFolder.id);
      var evidence = createOrAdoptEvidence_(
        folder,
        state.evidenceName,
        evidenceBase_(state, context.operation.operation_id)
      );
      state.evidence = evidence;
      var compact = {
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        baseRelease: BASE_RELEASE,
        baseCommit: BASE_COMMIT,
        backupId: state.backupId,
        rehearsalId: state.rehearsalId,
        operationId: context.operation.operation_id,
        status: 'PASS',
        evidenceId: evidence.evidenceId,
        evidenceHash: evidence.evidenceHash,
        evidenceFileHash: evidence.fileHash,
        evidenceFileId: evidence.fileId,
        evidenceFileUrl: evidence.fileUrl,
        isolatedFolderId: state.isolatedFolder.id,
        isolatedFolderUrl: state.isolatedFolder.url,
        dwhRestoredFileId: state.restoredDwh.id,
        dwhRestoredFileUrl: state.restoredDwh.url,
        dwhWorkbookFingerprint: state.dwhScan.workbookFingerprint,
        publishRestoredFileId: state.restoredPublish.id,
        publishRestoredFileUrl: state.restoredPublish.url,
        publishWorkbookFingerprint: state.publishScan.workbookFingerprint,
        checksTotal: state.checks.length,
        checksPassed: state.checks.length,
        productionTouched: false,
        activeDevConfigurationChanged: false,
        dataPlaneWrite: false,
        physicalDeletion: false,
        userPipelineEnabled: false
      };
      PropertiesService.getScriptProperties().setProperty(
        EVIDENCE_PROPERTY,
        AKORT.Core.safeJson(compact)
      );
      PropertiesService.getScriptProperties().deleteProperty(
        ACTIVE_PROPERTY
      );
      return compact;
    }

    return {
      phase: phase,
      noOp: true,
      activeDevConfigurationChanged: false,
      dataPlaneWrite: false
    };
  }

  function operationStatus_(result) {
    var data = result && result.data || null;
    var details = result && result.details || null;
    var operation = null;
    if (data && data.operation) operation = data.operation;
    else if (details && details.operation) operation = details.operation;
    else if (data && data.data && data.data.operation) {
      operation = data.data.operation;
    } else if (data && data.operation_id && data.operation_type) {
      operation = data;
    } else if (details && details.operation_id &&
               details.operation_type) {
      operation = details;
    }
    return text_(operation && operation.status);
  }

  function continueOrClear_(operationId, result) {
    if (TERMINAL[operationStatus_(result)]) {
      PropertiesService.getScriptProperties().deleteProperty(
        ACTIVE_PROPERTY
      );
    } else {
      PropertiesService.getScriptProperties().setProperty(
        ACTIVE_PROPERTY,
        operationId
      );
    }
    return result;
  }

  function latestActiveOperationId_() {
    var properties = PropertiesService.getScriptProperties();
    var stored = text_(properties.getProperty(ACTIVE_PROPERTY));
    if (stored) return stored;
    var status = AKORT.Beta14OperationalHardening.status();
    var operations = status && status.ok &&
      status.data && status.data.operationInventory &&
      status.data.operationInventory.nonTerminal || [];
    var matches = operations.filter(function (operation) {
      return text_(operation.operationType) === OPERATION_TYPE;
    });
    if (matches.length > 1) {
      throw AKORT.Core.error(
        'BETA11_RESTORE_ACTIVE_OPERATION_AMBIGUOUS',
        'More than one active restore rehearsal exists.',
        {
          operationIds: matches.map(function (operation) {
            return operation.operationId;
          }),
          retryable: false,
          requiresReview: true
        }
      );
    }
    return matches.length === 1 ? text_(matches[0].operationId) : '';
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA11_RESTORE_REHEARSAL_PREFLIGHT',
      function () {
        var validation = backupValidation_(DEFAULT_BACKUP_ID, '');
        var handlerReady = Boolean(
          AKORT.Beta11RestoreRehearsalHandlers &&
          typeof AKORT.Beta11RestoreRehearsalHandlers.supports === 'function' &&
          AKORT.Beta11RestoreRehearsalHandlers.supports(OPERATION_TYPE)
        );
        if (!handlerReady) {
          throw AKORT.Core.error(
            'BETA11_RESTORE_HANDLER_NOT_READY',
            'Restore rehearsal handler is not registered.',
            { retryable: false }
          );
        }
        return AKORT.Result.success(
          'Beta.1.1 isolated restore rehearsal preflight passed.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            backupId: DEFAULT_BACKUP_ID,
            backupStatus: validation.backup.status,
            dwhBackup: validation.dwh,
            publishBackup: validation.publish,
            manifest: validation.manifest,
            operationQueueQuiescent: true,
            handlerReady: true,
            mode: 'READ_ONLY_PREFLIGHT',
            productionTouched: false,
            activeDevConfigurationChanged: false,
            dataPlaneWrite: false,
            userPipelineEnabled: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function submit() {
    var check = preflight();
    if (!check.ok) return check;
    var idempotencyKey = [
      'BETA11_RESTORE_REHEARSAL',
      DEFAULT_BACKUP_ID,
      check.data.manifest.hash,
      PACKAGE_VERSION
    ].join('|');
    var queued = AKORT.Beta14OperationalHardening.enqueueGuarded(
      OPERATION_TYPE,
      {
        backupId: DEFAULT_BACKUP_ID,
        reason: 'Beta.1 acceptance: isolated restore rehearsal'
      },
      {
        idempotencyKey: idempotencyKey,
        maxAttempts: 5,
        priority: 70
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
    return continueOrClear_(operationId, result);
  }

  function continueLatest() {
    assertBase_();
    var operationId = latestActiveOperationId_();
    if (!operationId) {
      return AKORT.Result.success(
        'No active Beta.1.1 restore rehearsal exists.',
        latestEvidence_()
      );
    }
    var result = AKORT.OperationEngine.resume(operationId, {
      maxSteps: 50,
      executionBudgetMs: 240000,
      minRemainingMs: 15000
    });
    return continueOrClear_(operationId, result);
  }

  function latestEvidence_() {
    var raw = PropertiesService.getScriptProperties()
      .getProperty(EVIDENCE_PROPERTY);
    if (!raw) {
      return {
        available: false,
        packageVersion: PACKAGE_VERSION,
        contractVersion: CONTRACT_VERSION,
        backupId: DEFAULT_BACKUP_ID
      };
    }
    try {
      var parsed = JSON.parse(raw);
      parsed.available = true;
      return parsed;
    } catch (caught) {
      return {
        available: false,
        invalid: true,
        error: String(caught && caught.message || caught)
      };
    }
  }

  function progressLatest() {
    return AKORT.Core.safeRun(
      'BETA11_RESTORE_REHEARSAL_PROGRESS',
      function () {
        assertBase_();
        var operationId = latestActiveOperationId_();
        if (!operationId) {
          return AKORT.Result.success(
            'No active restore rehearsal exists; latest evidence returned.',
            {
              packageVersion: PACKAGE_VERSION,
              contractVersion: CONTRACT_VERSION,
              backupId: DEFAULT_BACKUP_ID,
              activeOperationId: '',
              evidence: latestEvidence_()
            }
          );
        }

        var rows = readObjects_(
          dwh_(),
          'OPERATION_QUEUE',
          AKORT.Core.Tables.OPERATION_QUEUE
        );
        var matches = rows.filter(function (row) {
          return text_(row.operation_id) === text_(operationId);
        });
        if (matches.length !== 1) {
          throw AKORT.Core.error(
            'BETA11_RESTORE_PROGRESS_OPERATION_IDENTITY_INVALID',
            'Exactly one restore rehearsal operation row is required.',
            {
              operationId: operationId,
              matches: matches.length,
              retryable: false,
              requiresReview: matches.length > 1
            }
          );
        }

        var row = matches[0];
        var checkpoint;
        try {
          checkpoint = JSON.parse(text_(row.checkpoint_json) || '{}');
        } catch (caught) {
          throw AKORT.Core.error(
            'BETA11_RESTORE_PROGRESS_CHECKPOINT_INVALID',
            'Restore rehearsal checkpoint is not valid JSON.',
            {
              operationId: operationId,
              cause: String(caught && caught.message || caught),
              retryable: false,
              requiresReview: true
            }
          );
        }

        var state = checkpoint &&
          checkpoint.handlerState &&
          checkpoint.handlerState.beta11RestoreRehearsal || {};

        function scanProgress_(scan) {
          scan = scan || {};
          var totalCells = (scan.sheets || []).reduce(
            function (total, sheet) {
              return total +
                Number(sheet.lastRow || 0) *
                Number(sheet.lastColumn || 0);
            },
            0
          );
          var completedCells = Number(scan.cells || 0);
          var sheetIndex = Number(scan.sheetIndex || 0);
          return {
            label: text_(scan.label),
            complete: scan.complete === true,
            sheetIndex: sheetIndex,
            sheetCount: (scan.sheets || []).length,
            currentSheet: scan.complete === true
              ? ''
              : text_(
                  scan.sheets &&
                  scan.sheets[sheetIndex] &&
                  scan.sheets[sheetIndex].name
                ),
            rowCursor: Number(scan.rowCursor || 1),
            chunks: Number(scan.chunks || 0),
            completedCells: completedCells,
            totalCells: totalCells,
            percent: totalCells
              ? Math.min(
                  100,
                  Math.round(completedCells * 10000 / totalCells) / 100
                )
              : scan.complete === true ? 100 : 0
          };
        }

        var dwhProgress = scanProgress_(state.dwhScan);
        var publishProgress = scanProgress_(state.publishScan);
        var totalCells =
          Number(dwhProgress.totalCells || 0) +
          Number(publishProgress.totalCells || 0);
        var completedCells =
          Number(dwhProgress.completedCells || 0) +
          Number(publishProgress.completedCells || 0);

        return AKORT.Result.success(
          'Beta.1.1 restore rehearsal compact progress loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            backupId: DEFAULT_BACKUP_ID,
            activeOperationId: operationId,
            operationStatus: text_(row.status),
            currentPhase: text_(row.current_phase),
            attemptNo: Number(row.attempt_no || 0),
            errorCode: text_(row.error_code),
            errorMessage: text_(row.error_message),
            progress: {
              completedCells: completedCells,
              totalCells: totalCells,
              percent: totalCells
                ? Math.min(
                    100,
                    Math.round(completedCells * 10000 / totalCells) / 100
                  )
                : 0,
              dwh: dwhProgress,
              publish: publishProgress
            },
            limits: {
              chunkCellLimit: CHUNK_CELL_LIMIT,
              maxCellsPerInvocation: MAX_CELLS_PER_INVOCATION,
              maxChunksPerInvocation: MAX_CHUNKS_PER_INVOCATION,
              maxHandlerMs: MAX_HANDLER_MS
            },
            productionTouched: false,
            activeDevConfigurationChanged: false,
            dataPlaneWrite: false,
            userPipelineEnabled: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  function statusLatest() {
    return AKORT.Core.safeRun(
      'BETA11_RESTORE_REHEARSAL_STATUS',
      function () {
        assertBase_();
        var operationId = latestActiveOperationId_();
        return AKORT.Result.success(
          'Beta.1.1 restore rehearsal status loaded.',
          {
            packageVersion: PACKAGE_VERSION,
            contractVersion: CONTRACT_VERSION,
            baseRelease: BASE_RELEASE,
            baseCommit: BASE_COMMIT,
            backupId: DEFAULT_BACKUP_ID,
            activeOperationId: operationId,
            activeOperation: operationId ?
              AKORT.OperationEngine.status(operationId) : null,
            evidence: latestEvidence_(),
            productionTouched: false,
            activeDevConfigurationChanged: false,
            dataPlaneWrite: false,
            physicalDeletion: false,
            userPipelineEnabled: false
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
      operationType: OPERATION_TYPE,
      defaultBackupId: DEFAULT_BACKUP_ID,
      acceptedExecutor: 'AKORT.OperationEngine',
      guardedEnqueue: 'AKORT.Beta14OperationalHardening.enqueueGuarded',
      restoreMode: 'ISOLATED_BACKUP_COPY_ONLY',
      comparisonScope: [
        'WORKBOOK_LOCALE',
        'WORKBOOK_TIMEZONE',
        'NAMED_RANGES',
        'SHEET_ORDER_AND_NAMES',
        'SHEET_VISIBILITY',
        'FROZEN_ROWS_AND_COLUMNS',
        'SHEET_DIMENSIONS',
        'CELL_VALUES',
        'FORMULAS_R1C1',
        'NUMBER_FORMATS'
      ],
      publicApi: [
        'AKORT_beta11RestoreRehearsalContract',
        'AKORT_beta11RestoreRehearsalPreflight',
        'AKORT_beta11RestoreRehearsalSubmit',
        'AKORT_beta11RestoreRehearsalContinueLatest',
        'AKORT_beta11RestoreRehearsalProgressLatest',
        'AKORT_beta11RestoreRehearsalStatusLatest'
      ],
      createsTrigger: false,
      deletesTrigger: false,
      physicalDeletion: false,
      changesActiveDevConfiguration: false,
      writesRaw: false,
      writesPublish: false,
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
    DefaultBackupId: DEFAULT_BACKUP_ID,
    execute: execute_,
    preflight: preflight,
    submit: submit,
    continueLatest: continueLatest,
    progressLatest: progressLatest,
    statusLatest: statusLatest,
    contract: contract,
    Test: Object.freeze({
      normalizeValue: normalizeValue_,
      normalizeMatrix: normalizeMatrix_,
      nextChainHash: nextChainHash_
    })
  });
})();

AKORT.Beta11RestoreRehearsalHandlers = {
  supports: function (operationType) {
    return String(operationType || '') ===
      AKORT.Beta11RestoreRehearsal.OperationType;
  },
  execute: function (phase, context) {
    return AKORT.Beta11RestoreRehearsal.execute(phase, context);
  }
};

function AKORT_beta11RestoreRehearsalContract() {
  var result = AKORT.Beta11RestoreRehearsal.contract();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11RestoreRehearsalPreflight() {
  var result = AKORT.Beta11RestoreRehearsal.preflight();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11RestoreRehearsalSubmit() {
  var result = AKORT.Beta11RestoreRehearsal.submit();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11RestoreRehearsalContinueLatest() {
  var result = AKORT.Beta11RestoreRehearsal.continueLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11RestoreRehearsalProgressLatest() {
  var result = AKORT.Beta11RestoreRehearsal.progressLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function AKORT_beta11RestoreRehearsalStatusLatest() {
  var result = AKORT.Beta11RestoreRehearsal.statusLatest();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
