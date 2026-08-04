var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/** Beta.1.1 candidate r1: read-only inventory for the paired-backup implementation. */
AKORT.Beta11BackupInventory = (function () {
  var VERSION = '4.0-beta11-backup-inventory-1';
  var PACKAGE_VERSION = '4.0.0-beta.1.1.1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = 'e4dd3806996f832ab466f0a04d79e13e2ebfc1cd';

  function mask_(value) {
    var text = String(value || '');
    if (!text) return '';
    if (text.length <= 10) return '***';
    return text.slice(0, 5) + '…' + text.slice(-5);
  }

  function fileSummary_(id, role) {
    var file = DriveApp.getFileById(String(id || ''));
    return {
      role: role,
      id: mask_(file.getId()),
      name: file.getName(),
      mimeType: file.getMimeType(),
      trashed: file.isTrashed(),
      lastUpdated: file.getLastUpdated().toISOString()
    };
  }

  function folderSummary_(id, role) {
    var folder = DriveApp.getFolderById(String(id || ''));
    return {
      role: role,
      id: mask_(folder.getId()),
      name: folder.getName(),
      trashed: folder.isTrashed()
    };
  }

  function contract() {
    return {
      version: VERSION,
      packageVersion: PACKAGE_VERSION,
      baseRelease: BASE_RELEASE,
      baseCommit: BASE_COMMIT,
      writeBoundary: 'READ_ONLY',
      requiredReuse: [
        'AKORT.Config',
        'AKORT.EnvironmentGuard',
        'AKORT.OperationEngine',
        'AKORT.IncrementalPublish.createPublishBackup',
        'AKORT.Core.safeRun',
        'AKORT.Core.Id'
      ],
      confirmedGaps: [
        'DWH backup member',
        'shared backup_id',
        'BACKUP_REGISTRY',
        'pair manifest',
        'PARTIAL resume',
        'lost-response member adoption'
      ],
      forbidden: [
        'second executor',
        'second queue',
        'production access',
        'RAW schema changes',
        'Publish schema changes',
        'general user pipeline must remain disabled'
      ]
    };
  }

  function status() {
    return AKORT.Core.safeRun('BETA11_BACKUP_INVENTORY_STATUS', function () {
      AKORT.EnvironmentGuard.assertDev();
      var config = AKORT.Config.load({ includeSystemSettings: false });
      if (AKORT.Release.version !== BASE_RELEASE) {
        throw AKORT.Core.error('BETA11_BASE_RELEASE_MISMATCH', 'Beta.1.1 inventory requires the accepted Alpha.7.4 runtime release.', {
          expected: BASE_RELEASE,
          actual: AKORT.Release.version,
          retryable: false
        });
      }
      return AKORT.Result.success('Beta.1.1 paired-backup inventory loaded.', {
        contract: contract(),
        reusablePrimitives: {
          publishBackupPrimitiveAvailable: Boolean(
            AKORT.IncrementalPublish &&
            typeof AKORT.IncrementalPublish.createPublishBackup === 'function'
          ),
          operationEngineAvailable: Boolean(
            AKORT.OperationEngine &&
            typeof AKORT.OperationEngine.enqueue === 'function' &&
            typeof AKORT.OperationEngine.resume === 'function'
          )
        },
        sources: [
          fileSummary_(config.resources.dwhSpreadsheetId, 'DWH_TECH_DEV'),
          fileSummary_(config.resources.publishSpreadsheetId, 'PUBLISH_DEV')
        ],
        folders: [
          folderSummary_(config.resources.devRootFolderId, 'DEV_ROOT'),
          folderSummary_(config.resources.devTablesFolderId, 'DEV_TABLES'),
          folderSummary_(config.resources.testResultsFolderId, 'TEST_RESULTS')
        ],
        physicalWrites: false,
        nextCandidate: '4.0.0-beta.1.1.2'
      });
    }, { lock: false, persistLogs: false });
  }

  return {
    version: VERSION,
    packageVersion: PACKAGE_VERSION,
    baseRelease: BASE_RELEASE,
    contract: contract,
    status: status
  };
})();

function AKORT_beta11BackupInventoryStatus() {
  var result = AKORT.Beta11BackupInventory.status();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
