var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.1.6 r2: resumable Full Audit and retention dry-run.
 * Reuses the accepted Operation Engine and Beta.1.4 guarded enqueue.
 * Reads accepted service registries only; never reads physical RAW/Publish.
 */
AKORT.Beta16FullAuditRetention = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.1.6.2';
  var CONTRACT_VERSION = '4.0-beta16-full-audit-retention-1';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '55fd0f2379ed19ad7461dc00d3711ab80c4ff4d1';
  var OPERATION_TYPE = 'FULL_AUDIT_V4';
  var EVIDENCE_TABLE = 'FULL_AUDIT_EVIDENCE';
  var RETENTION_TABLE = 'RETENTION_REGISTRY';
  var MAX_TAIL_ROWS = 25;
  var BACKUP_RETENTION_DAYS = 30;
  var BACKUP_PROTECTED_LATEST = 2;

  var SOURCE_TABLES = [
    'RELEASE_REGISTRY',
    'OPERATION_QUEUE',
    'OPERATION_STEPS',
    'SYSTEM_LOG',
    'RAW_LOAD_REGISTRY',
    'PUBLISH_RECONCILIATION',
    'BACKUP_REGISTRY',
    'DATASET_STATUS',
    'ISSUE_REGISTRY'
  ];

  var EVIDENCE_HEADERS = [
    'audit_id', 'operation_id', 'audit_status', 'audit_scope',
    'started_at', 'finished_at', 'checks_total', 'checks_passed',
    'checks_warned', 'checks_failed', 'retention_rows',
    'protected_artifacts', 'review_candidates', 'release_version',
    'base_commit', 'gate7_evidence_id', 'gate7_evidence_hash',
    'dataset_snapshot_fingerprint', 'source_snapshot_fingerprint',
    'retention_snapshot_fingerprint', 'evidence_hash', 'checks_json',
    'next_action', 'created_by'
  ];

  var RETENTION_HEADERS = [
    'retention_id', 'audit_id', 'operation_id', 'artifact_class',
    'artifact_id', 'artifact_name', 'artifact_source',
    'artifact_timestamp', 'age_days', 'retention_days',
    'protected_flag', 'protection_reason', 'candidate_action',
    'dry_run', 'physical_deletion', 'plan_status', 'next_action',
    'planned_at', 'snapshot_fingerprint', 'release_version'
  ];

  var TERMINAL = {
    SUCCESS: true,
    FAILED: true,
    FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true,
    CANCELLED: true
  };

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

  function currentUser_() {
    try { return Session.getEffectiveUser().getEmail() || 'unknown'; }
    catch (ignored) { return 'unknown'; }
  }

  function dateMs_(value) {
    var parsed = Date.parse(text_(value));
    return isNaN(parsed) ? 0 : parsed;
  }

  function ageDays_(value, nowMs) {
    var parsed = dateMs_(value);
    return parsed ? Math.max(0, Math.floor((nowMs - parsed) / 86400000)) : '';
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error(
        'BETA16_BASE_RELEASE_MISMATCH',
        'Beta.1.6 requires the accepted Alpha.7.4 runtime.',
        { expected: BASE_RELEASE, actual: AKORT.Release.version, retryable: false }
      );
    }
    var settings = AKORT.Config.readSystemSettings();
    if (truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED)) {
      throw AKORT.Core.error(
        'BETA16_USER_PIPELINE_MUST_REMAIN_DISABLED',
        'Beta.1.6 cannot run after general user-pipeline enablement.',
        { retryable: false }
      );
    }
  }

  function dwh_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    return SpreadsheetApp.openById(config.resources.dwhSpreadsheetId);
  }

  function table_(spreadsheet, name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      throw AKORT.Core.error(
        'BETA16_REQUIRED_TABLE_MISSING',
        'Required service table is missing.',
        { table: name, retryable: false }
      );
    }
    var expected = AKORT.Core.Tables[name] || [];
    var actual = sheet.getRange(
      1, 1, 1, Math.max(1, sheet.getLastColumn())
    ).getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error(
        'BETA16_SERVICE_SCHEMA_MISMATCH',
        'Service-table schema differs from the Beta.1.6 contract.',
        { table: name, expected: expected, actual: actual, retryable: false }
      );
    }
    return { sheet: sheet, headers: expected.slice() };
  }

  function rowObject_(headers, row) {
    var object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  }

  function tailRows_(spreadsheet, name, maximum) {
    var table = table_(spreadsheet, name);
    var total = Math.max(0, table.sheet.getLastRow() - 1);
    var count = Math.min(Number(maximum || MAX_TAIL_ROWS), total);
    if (!count) return [];
    return table.sheet.getRange(
      table.sheet.getLastRow() - count + 1,
      1,
      count,
      table.headers.length
    ).getValues().map(function (row) {
      return rowObject_(table.headers, row);
    });
  }

  function allRows_(spreadsheet, name, maximum) {
    var table = table_(spreadsheet, name);
    var total = Math.max(0, table.sheet.getLastRow() - 1);
    if (total > Number(maximum || 250)) {
      throw AKORT.Core.error(
        'BETA16_READ_MODEL_BOUND_EXCEEDED',
        'A Beta.1.6 read model exceeded its bounded row contract.',
        { table: name, rows: total, maximum: Number(maximum || 250), retryable: false }
      );
    }
    return AKORT.Core.Sheets.readObjects(table.sheet).map(function (row) {
      var copy = clone_(row);
      delete copy.__row;
      return copy;
    });
  }

  function statusCount_(rows, field) {
    return (rows || []).reduce(function (counts, row) {
      var value = text_(row[field]);
      if (value) counts[value] = Number(counts[value] || 0) + 1;
      return counts;
    }, {});
  }

  function sourceSummary_(spreadsheet, name) {
    var rows = tailRows_(spreadsheet, name, MAX_TAIL_ROWS);
    var statusField = name === 'SYSTEM_LOG' ? 'level' :
      name === 'DATASET_STATUS' ? 'health_status' :
      name === 'ISSUE_REGISTRY' ? 'lifecycle_status' : 'status';
    var timestampFields = {
      RELEASE_REGISTRY: ['installed_at'],
      OPERATION_QUEUE: ['finished_at', 'started_at', 'requested_at'],
      OPERATION_STEPS: ['finished_at', 'started_at'],
      SYSTEM_LOG: ['logged_at'],
      RAW_LOAD_REGISTRY: ['finished_at', 'started_at'],
      PUBLISH_RECONCILIATION: ['checked_at'],
      BACKUP_REGISTRY: ['finished_at', 'started_at'],
      DATASET_STATUS: ['observed_at'],
      ISSUE_REGISTRY: ['last_seen_at', 'observed_at']
    }[name] || [];
    var latestMs = 0;
    var latest = '';
    rows.forEach(function (row) {
      timestampFields.forEach(function (field) {
        var parsed = dateMs_(row[field]);
        if (parsed > latestMs) {
          latestMs = parsed;
          latest = new Date(parsed).toISOString();
        }
      });
    });
    return {
      name: name,
      rowsRead: rows.length,
      statusCounts: statusCount_(rows, statusField),
      latestTimestamp: latest,
      fingerprint: AKORT.Core.sha256(AKORT.Core.canonicalJson(rows))
    };
  }

  function state_(context) {
    context.checkpoint.handlerState = context.checkpoint.handlerState || {};
    context.checkpoint.handlerState.beta16FullAudit =
      context.checkpoint.handlerState.beta16FullAudit || {};
    var state = context.checkpoint.handlerState.beta16FullAudit;
    var input = context.checkpoint.input || {};
    state.auditId = state.auditId || text_(input.auditId) ||
      ('AUD_' + AKORT.Core.sha256(context.operation.operation_id).slice(0, 24).toUpperCase());
    state.reason = state.reason || text_(input.reason) || 'Manual Full Audit';
    state.startedAt = state.startedAt || AKORT.Core.now();
    state.checks = state.checks || [];
    state.sourceSummaries = state.sourceSummaries || [];
    state.sourceSnapshotFingerprint = state.sourceSnapshotFingerprint || '';
    state.datasetSnapshotFingerprint = state.datasetSnapshotFingerprint || '';
    state.retentionSnapshotFingerprint = state.retentionSnapshotFingerprint || '';
    state.retentionRowCount = Number(state.retentionRowCount || 0);
    state.protectedArtifacts = Number(state.protectedArtifacts || 0);
    state.reviewCandidates = Number(state.reviewCandidates || 0);
    state.gate7EvidenceId = state.gate7EvidenceId || '';
    state.gate7EvidenceHash = state.gate7EvidenceHash || '';
    state.evidenceHash = state.evidenceHash || '';
    return state;
  }

  function addCheck_(state, id, status, summary, details) {
    var normalized = {
      id: text_(id),
      status: text_(status),
      summary: text_(summary),
      details: clone_(details || {})
    };
    var replaced = false;
    state.checks = (state.checks || []).map(function (item) {
      if (text_(item.id) !== normalized.id) return item;
      replaced = true;
      return normalized;
    });
    if (!replaced) state.checks.push(normalized);
    state.checks.sort(function (left, right) {
      return text_(left.id).localeCompare(text_(right.id));
    });
    return normalized;
  }

  function checkSummary_(checks) {
    var counts = { PASS: 0, WARN: 0, FAIL: 0 };
    (checks || []).forEach(function (check) {
      var status = text_(check.status);
      counts[status] = Number(counts[status] || 0) + 1;
    });
    return {
      total: (checks || []).length,
      passed: counts.PASS || 0,
      warned: counts.WARN || 0,
      failed: counts.FAIL || 0,
      status: counts.FAIL ? 'FAIL' : counts.WARN ? 'WARN' : 'PASS',
      nextAction: counts.FAIL ? 'REVIEW_FULL_AUDIT_FAILURES' :
        counts.WARN ? 'REVIEW_FULL_AUDIT_WARNINGS' : 'NONE'
    };
  }

  function latestBy_(rows, fields) {
    var best = null;
    var bestMs = -1;
    (rows || []).forEach(function (row) {
      var valueMs = 0;
      (fields || []).forEach(function (field) {
        valueMs = Math.max(valueMs, dateMs_(row[field]));
      });
      if (valueMs >= bestMs) {
        bestMs = valueMs;
        best = row;
      }
    });
    return best;
  }

  function compactGate7Status_() {
    if (!AKORT.Alpha74Gate7Acceptance ||
        typeof AKORT.Alpha74Gate7Acceptance.status !== 'function') {
      return { available: false, accepted: false, evidenceId: '', evidenceHash: '' };
    }
    var result = AKORT.Alpha74Gate7Acceptance.status();
    var data = result && result.ok && result.data ? result.data : {};
    var industry = data.industryState || {};
    return {
      available: Boolean(result && result.ok),
      accepted: data.gate7Accepted === true,
      implementationStatus: text_(data.implementationStatus),
      evidenceId: text_(industry.evidenceId || industry.evidence_id),
      evidenceHash: text_(industry.evidenceHash || industry.evidence_hash),
      acceptedAt: text_(industry.acceptedAt || industry.accepted_at),
      previewMatrixFingerprint: text_(
        data.previewState && data.previewState.matrixFingerprint
      )
    };
  }

  function compactObservabilityStatus_() {
    if (!AKORT.Beta15CompactObservability ||
        typeof AKORT.Beta15CompactObservability.status !== 'function') {
      return { available: false, healthy: false, issueCount: -1, overallStatus: 'UNAVAILABLE' };
    }
    var result = AKORT.Beta15CompactObservability.status();
    var data = result && result.ok && result.data ? result.data : {};
    return {
      available: Boolean(result && result.ok),
      healthy: data.healthy === true,
      issueCount: Number(data.issueCount || 0),
      datasetCount: Number(data.datasetCount || 0),
      overallStatus: text_(data.overallStatus),
      nextActions: clone_(data.nextActions || [])
    };
  }

  function retentionRow_(audit, artifact, nowMs) {
    var timestamp = text_(artifact.timestamp);
    var age = ageDays_(timestamp, nowMs);
    var protectedFlag = artifact.protected === true;
    var action = protectedFlag ? 'KEEP' : text_(artifact.candidateAction) || 'KEEP';
    var status = action === 'REVIEW_FOR_RETENTION' ? 'REVIEW_CANDIDATE' : 'PROTECTED_OR_CURRENT';
    var identity = [
      audit.auditId,
      artifact.artifactClass,
      artifact.artifactId,
      action
    ].join('|');
    return {
      retention_id: 'RET_' + AKORT.Core.sha256(identity).slice(0, 28).toUpperCase(),
      audit_id: audit.auditId,
      operation_id: audit.operationId,
      artifact_class: text_(artifact.artifactClass),
      artifact_id: text_(artifact.artifactId),
      artifact_name: text_(artifact.artifactName),
      artifact_source: text_(artifact.artifactSource),
      artifact_timestamp: timestamp,
      age_days: age,
      retention_days: Number(artifact.retentionDays || 0),
      protected_flag: protectedFlag ? 1 : 0,
      protection_reason: text_(artifact.protectionReason),
      candidate_action: action,
      dry_run: 1,
      physical_deletion: 0,
      plan_status: status,
      next_action: action === 'REVIEW_FOR_RETENTION' ? 'MANUAL_RETENTION_REVIEW' : 'NONE',
      planned_at: audit.plannedAt,
      snapshot_fingerprint: '',
      release_version: BASE_RELEASE
    };
  }

  function planRetention_(request) {
    request = request || {};
    var nowMs = Number(request.nowMs || Date.now());
    var audit = {
      auditId: text_(request.auditId),
      operationId: text_(request.operationId),
      plannedAt: text_(request.plannedAt) || new Date(nowMs).toISOString()
    };
    var artifacts = [];
    var releases = (request.releases || []).slice();
    var backups = (request.backups || []).slice();
    var operations = (request.operations || []).slice();
    var audits = (request.audits || []).slice();
    var gate7 = request.gate7 || {};

    var latestRelease = latestBy_(releases, ['installed_at']);
    if (latestRelease) {
      artifacts.push({
        artifactClass: 'ACCEPTED_RELEASE',
        artifactId: text_(latestRelease.release_id || latestRelease.version),
        artifactName: text_(latestRelease.version),
        artifactSource: 'RELEASE_REGISTRY',
        timestamp: text_(latestRelease.installed_at),
        protected: true,
        protectionReason: 'CURRENT_ACCEPTED_RUNTIME',
        retentionDays: 0
      });
    }

    var manifest = AKORT.Release && typeof AKORT.Release.manifest === 'function'
      ? AKORT.Release.manifest() : {};
    artifacts.push({
      artifactClass: 'VERIFIED_BASELINE',
      artifactId: text_(manifest.baselineLabel || AKORT.Release.baselineLabel || 'VERIFIED_BASELINE'),
      artifactName: text_(manifest.baselineLabel || 'Verified baseline'),
      artifactSource: 'AKORT.Release',
      timestamp: text_(manifest.baselineDate),
      protected: true,
      protectionReason: 'VERIFIED_BASELINE_IS_IMMUTABLE',
      retentionDays: 0
    });

    if (gate7.accepted) {
      artifacts.push({
        artifactClass: 'GATE_ACCEPTANCE_EVIDENCE',
        artifactId: text_(gate7.evidenceId) || 'GATE7_ACCEPTED',
        artifactName: 'Alpha.7.4 Gate 7 acceptance evidence',
        artifactSource: 'AKORT.Alpha74Gate7Acceptance',
        timestamp: text_(gate7.acceptedAt),
        protected: true,
        protectionReason: 'ACCEPTED_GATE_EVIDENCE',
        retentionDays: 0
      });
    }

    var successful = backups.filter(function (row) {
      return text_(row.status) === 'SUCCESS';
    }).sort(function (left, right) {
      return dateMs_(right.finished_at || right.started_at) -
        dateMs_(left.finished_at || left.started_at);
    });
    var protectedBackupIds = {};
    successful.slice(0, BACKUP_PROTECTED_LATEST).forEach(function (row) {
      protectedBackupIds[text_(row.backup_id)] = true;
    });
    backups.forEach(function (row) {
      var timestamp = text_(row.finished_at || row.started_at);
      var age = ageDays_(timestamp, nowMs);
      var success = text_(row.status) === 'SUCCESS';
      var recent = age === '' || Number(age) <= BACKUP_RETENTION_DAYS;
      var protectedFlag = Boolean(protectedBackupIds[text_(row.backup_id)]) || recent;
      artifacts.push({
        artifactClass: success ? 'REQUIRED_PAIRED_BACKUP' : 'BACKUP_INCIDENT_ARTIFACT',
        artifactId: text_(row.backup_id),
        artifactName: text_(row.dwh_backup_name || row.publish_backup_name || row.backup_id),
        artifactSource: 'BACKUP_REGISTRY',
        timestamp: timestamp,
        protected: protectedFlag,
        protectionReason: protectedFlag
          ? protectedBackupIds[text_(row.backup_id)]
            ? 'LATEST_SUCCESSFUL_PAIRED_BACKUP'
            : 'WITHIN_RETENTION_WINDOW'
          : '',
        candidateAction: protectedFlag ? 'KEEP' : 'REVIEW_FOR_RETENTION',
        retentionDays: BACKUP_RETENTION_DAYS
      });
    });

    operations.filter(function (row) {
      return !TERMINAL[text_(row.status)];
    }).forEach(function (row) {
      artifacts.push({
        artifactClass: 'ACTIVE_OPERATION_CHECKPOINT',
        artifactId: text_(row.operation_id),
        artifactName: text_(row.operation_type),
        artifactSource: 'OPERATION_QUEUE',
        timestamp: text_(row.started_at || row.requested_at),
        protected: true,
        protectionReason: 'NON_TERMINAL_OPERATION_CHECKPOINT',
        retentionDays: 0
      });
    });

    var successfulAudits = audits.filter(function (row) {
      return text_(row.audit_status) === 'PASS' || text_(row.audit_status) === 'WARN';
    });
    var latestAudit = latestBy_(successfulAudits, ['finished_at', 'started_at']);
    if (latestAudit) {
      artifacts.push({
        artifactClass: 'LATEST_SUCCESSFUL_FULL_AUDIT',
        artifactId: text_(latestAudit.audit_id),
        artifactName: 'Latest successful Full Audit evidence',
        artifactSource: EVIDENCE_TABLE,
        timestamp: text_(latestAudit.finished_at || latestAudit.started_at),
        protected: true,
        protectionReason: 'LATEST_SUCCESSFUL_FULL_AUDIT',
        retentionDays: 0
      });
    }

    var rows = artifacts.filter(function (artifact) {
      return text_(artifact.artifactId);
    }).map(function (artifact) {
      return retentionRow_(audit, artifact, nowMs);
    }).sort(function (left, right) {
      return [left.artifact_class, left.artifact_id].join('|')
        .localeCompare([right.artifact_class, right.artifact_id].join('|'));
    });

    var fingerprintInput = rows.map(function (row) {
      var copy = clone_(row);
      copy.snapshot_fingerprint = '';
      return copy;
    });
    var fingerprint = AKORT.Core.sha256(AKORT.Core.canonicalJson(fingerprintInput));
    rows.forEach(function (row) { row.snapshot_fingerprint = fingerprint; });
    return {
      rows: rows,
      fingerprint: fingerprint,
      protectedArtifacts: rows.filter(function (row) {
        return Number(row.protected_flag || 0) === 1;
      }).length,
      reviewCandidates: rows.filter(function (row) {
        return text_(row.candidate_action) === 'REVIEW_FOR_RETENTION';
      }).length,
      dryRun: true,
      physicalDeletion: false
    };
  }

  function replaceRetention_(spreadsheet, rows) {
    var table = table_(spreadsheet, RETENTION_TABLE);
    if (table.sheet.getLastRow() > 1) {
      table.sheet.getRange(
        2, 1, table.sheet.getLastRow() - 1, table.headers.length
      ).clearContent();
    }
    if (rows.length) {
      table.sheet.getRange(2, 1, rows.length, table.headers.length).setValues(
        rows.map(function (row) {
          return table.headers.map(function (header) {
            var value = row[header];
            return value === undefined || value === null ? '' : value;
          });
        })
      );
    }
    return rows.length;
  }

  function upsertEvidence_(spreadsheet, record) {
    var table = table_(spreadsheet, EVIDENCE_TABLE);
    var rows = AKORT.Core.Sheets.readObjects(table.sheet);
    var existing = rows.filter(function (row) {
      return text_(row.audit_id) === text_(record.audit_id);
    })[0];
    var values = table.headers.map(function (header) {
      var value = record[header];
      return value === undefined || value === null ? '' : value;
    });
    if (existing) {
      table.sheet.getRange(existing.__row, 1, 1, table.headers.length).setValues([values]);
      return { row: existing.__row, action: 'UPDATED' };
    }
    table.sheet.getRange(table.sheet.getLastRow() + 1, 1, 1, table.headers.length).setValues([values]);
    return { row: table.sheet.getLastRow(), action: 'INSERTED' };
  }

  function evidenceRecord_(context, state) {
    var summary = checkSummary_(state.checks);
    var canonical = {
      auditId: state.auditId,
      operationId: context.operation.operation_id,
      auditStatus: summary.status,
      reason: state.reason,
      startedAt: state.startedAt,
      checks: state.checks,
      retentionRows: state.retentionRowCount,
      protectedArtifacts: state.protectedArtifacts,
      reviewCandidates: state.reviewCandidates,
      gate7EvidenceId: state.gate7EvidenceId,
      gate7EvidenceHash: state.gate7EvidenceHash,
      datasetSnapshotFingerprint: state.datasetSnapshotFingerprint,
      sourceSnapshotFingerprint: state.sourceSnapshotFingerprint,
      retentionSnapshotFingerprint: state.retentionSnapshotFingerprint,
      releaseVersion: BASE_RELEASE,
      baseCommit: BASE_COMMIT
    };
    var evidenceHash = AKORT.Core.sha256(AKORT.Core.canonicalJson(canonical));
    state.evidenceHash = evidenceHash;
    return {
      audit_id: state.auditId,
      operation_id: context.operation.operation_id,
      audit_status: summary.status,
      audit_scope: 'DEV_SERVICE_REGISTRIES_AND_ACCEPTED_EVIDENCE',
      started_at: state.startedAt,
      finished_at: AKORT.Core.now(),
      checks_total: summary.total,
      checks_passed: summary.passed,
      checks_warned: summary.warned,
      checks_failed: summary.failed,
      retention_rows: state.retentionRowCount,
      protected_artifacts: state.protectedArtifacts,
      review_candidates: state.reviewCandidates,
      release_version: BASE_RELEASE,
      base_commit: BASE_COMMIT,
      gate7_evidence_id: state.gate7EvidenceId,
      gate7_evidence_hash: state.gate7EvidenceHash,
      dataset_snapshot_fingerprint: state.datasetSnapshotFingerprint,
      source_snapshot_fingerprint: state.sourceSnapshotFingerprint,
      retention_snapshot_fingerprint: state.retentionSnapshotFingerprint,
      evidence_hash: evidenceHash,
      checks_json: AKORT.Core.safeJson(state.checks),
      next_action: summary.nextAction,
      created_by: currentUser_()
    };
  }

  function executePhase_(phase, context) {
    assertBase_();
    var state = state_(context);
    var spreadsheet = dwh_();
    var rows;
    var latest;
    var result;

    if (phase === 'DISCOVER') {
      addCheck_(state, 'DRY_RUN_BOUNDARY', 'PASS',
        'Retention is dry-run only.', { dryRun: true, physicalDeletion: false });
      return { auditId: state.auditId, reason: state.reason, dryRun: true };
    }

    if (phase === 'VALIDATE') {
      var inspected = SOURCE_TABLES.concat([EVIDENCE_TABLE, RETENTION_TABLE])
        .map(function (name) {
          var table = table_(spreadsheet, name);
          return { name: name, columns: table.headers.length };
        });
      addCheck_(state, 'SERVICE_SCHEMAS', 'PASS',
        'Required service-table schemas match.', { tables: inspected });
      return { inspectedTables: inspected.length };
    }

    if (phase === 'PARSE') {
      var observability = compactObservabilityStatus_();
      var gate7 = compactGate7Status_();
      state.gate7EvidenceId = gate7.evidenceId;
      state.gate7EvidenceHash = gate7.evidenceHash;
      addCheck_(state, 'OBSERVABILITY_HEALTH', observability.healthy ? 'PASS' : 'FAIL',
        observability.healthy ? 'Compact observability is healthy.' : 'Compact observability is not healthy.',
        observability);
      var gate7Complete = gate7.accepted && Boolean(gate7.evidenceId) && Boolean(gate7.evidenceHash);
      addCheck_(state, 'GATE7_ACCEPTANCE', gate7Complete ? 'PASS' : 'FAIL',
        gate7Complete ? 'Accepted Gate 7 evidence is available.' : 'Gate 7 acceptance evidence is incomplete.',
        gate7);
      return { observability: observability, gate7: gate7 };
    }

    if (phase === 'STAGE') {
      state.sourceSummaries = SOURCE_TABLES.map(function (name) {
        return sourceSummary_(spreadsheet, name);
      });
      state.sourceSnapshotFingerprint = AKORT.Core.sha256(
        AKORT.Core.canonicalJson(state.sourceSummaries)
      );
      rows = tailRows_(spreadsheet, 'DATASET_STATUS', MAX_TAIL_ROWS);
      state.datasetSnapshotFingerprint = rows.length
        ? text_(rows[rows.length - 1].snapshot_fingerprint)
        : '';
      addCheck_(state, 'BOUNDED_SERVICE_SNAPSHOT', 'PASS',
        'Service registries were read through bounded tails.', {
          tailRowsPerSource: MAX_TAIL_ROWS,
          sourceCount: state.sourceSummaries.length,
          sourceSnapshotFingerprint: state.sourceSnapshotFingerprint
        });
      return {
        sourceCount: state.sourceSummaries.length,
        sourceSnapshotFingerprint: state.sourceSnapshotFingerprint
      };
    }

    if (phase === 'COMMIT_RAW') {
      addCheck_(state, 'NO_DATA_PLANE_WRITE', 'PASS',
        'Full Audit performed no RAW or Publish write.', {
          readsPhysicalRawTargets: false,
          readsPhysicalPublishTargets: false,
          dataPlaneWrite: false
        });
      return { dataPlaneWrite: false };
    }

    if (phase === 'UPDATE_PUBLISH') {
      rows = tailRows_(spreadsheet, 'PUBLISH_RECONCILIATION', MAX_TAIL_ROWS);
      latest = latestBy_(rows, ['checked_at']);
      var reconciliationOk = latest &&
        (text_(latest.status) === 'SUCCESS' || text_(latest.status) === 'PASS');
      addCheck_(state, 'LATEST_RECONCILIATION', reconciliationOk ? 'PASS' : 'FAIL',
        reconciliationOk ? 'Latest reconciliation succeeded.' : 'Latest reconciliation is not successful.',
        latest || {});
      return { latestReconciliation: latest || null };
    }

    if (phase === 'PREPARING_AGGREGATE_IMPACT') {
      rows = tailRows_(spreadsheet, 'BACKUP_REGISTRY', MAX_TAIL_ROWS);
      latest = latestBy_(rows.filter(function (row) {
        return text_(row.status) === 'SUCCESS';
      }), ['finished_at', 'started_at']);
      addCheck_(state, 'LATEST_PAIRED_BACKUP', latest ? 'PASS' : 'FAIL',
        latest ? 'A successful paired backup is available.' : 'No successful paired backup is available.',
        latest || {});
      return { latestBackupId: latest ? text_(latest.backup_id) : '' };
    }

    if (phase === 'MATERIALIZING_AGGREGATE_INPUTS') {
      rows = tailRows_(spreadsheet, 'OPERATION_QUEUE', MAX_TAIL_ROWS);
      var active = rows.filter(function (row) {
        return text_(row.operation_id) !== text_(context.operation.operation_id) &&
          !TERMINAL[text_(row.status)];
      });
      addCheck_(state, 'OPERATION_QUIESCENCE', active.length ? 'FAIL' : 'PASS',
        active.length ? 'Another non-terminal operation is present.' : 'No competing operation is active.',
        { activeOperations: active.map(function (row) {
          return {
            operationId: text_(row.operation_id),
            operationType: text_(row.operation_type),
            status: text_(row.status),
            phase: text_(row.current_phase)
          };
        }) });
      return { activeOperationCount: active.length };
    }

    if (phase === 'CALCULATING_AGGREGATE_SLICES') {
      rows = tailRows_(spreadsheet, 'RELEASE_REGISTRY', MAX_TAIL_ROWS);
      latest = latestBy_(rows, ['installed_at']);
      var releaseOk = latest && text_(latest.version) === BASE_RELEASE &&
        text_(latest.status) === 'INSTALLED';
      addCheck_(state, 'ACCEPTED_RUNTIME', releaseOk ? 'PASS' : 'FAIL',
        releaseOk ? 'Accepted runtime is installed.' : 'Accepted runtime registry row is not current.',
        latest || {});
      return { release: latest || null };
    }

    if (phase === 'STAGING_AGGREGATE_ROWS') {
      var gate = compactGate7Status_();
      var plan = planRetention_({
        auditId: state.auditId,
        operationId: context.operation.operation_id,
        plannedAt: AKORT.Core.now(),
        releases: tailRows_(spreadsheet, 'RELEASE_REGISTRY', MAX_TAIL_ROWS),
        backups: tailRows_(spreadsheet, 'BACKUP_REGISTRY', MAX_TAIL_ROWS),
        operations: tailRows_(spreadsheet, 'OPERATION_QUEUE', MAX_TAIL_ROWS),
        audits: tailRows_(spreadsheet, EVIDENCE_TABLE, MAX_TAIL_ROWS),
        gate7: gate,
        nowMs: Date.now()
      });
      replaceRetention_(spreadsheet, plan.rows);
      state.retentionSnapshotFingerprint = plan.fingerprint;
      state.retentionRowCount = plan.rows.length;
      state.protectedArtifacts = plan.protectedArtifacts;
      state.reviewCandidates = plan.reviewCandidates;
      addCheck_(state, 'RETENTION_DRY_RUN_PLAN', 'PASS',
        'Retention plan was materialized without deletion.', {
          rows: plan.rows.length,
          protectedArtifacts: plan.protectedArtifacts,
          reviewCandidates: plan.reviewCandidates,
          dryRun: plan.dryRun,
          physicalDeletion: plan.physicalDeletion,
          fingerprint: plan.fingerprint
        });
      return {
        retentionRows: plan.rows.length,
        protectedArtifacts: plan.protectedArtifacts,
        reviewCandidates: plan.reviewCandidates,
        fingerprint: plan.fingerprint,
        dryRun: true,
        physicalDeletion: false
      };
    }

    if (phase === 'UPDATING_AGGREGATES') {
      rows = allRows_(spreadsheet, RETENTION_TABLE, 250).filter(function (row) {
        return text_(row.audit_id) === state.auditId;
      });
      var safe = rows.length === state.retentionRowCount && rows.every(function (row) {
        return truthy_(row.dry_run) && !truthy_(row.physical_deletion);
      });
      addCheck_(state, 'RETENTION_PLAN_READBACK', safe ? 'PASS' : 'FAIL',
        safe ? 'Retention plan read-back is safe.' : 'Retention plan read-back failed safety checks.',
        { expectedRows: state.retentionRowCount, actualRows: rows.length });
      return { retentionReadbackSafe: safe, rows: rows.length };
    }

    if (phase === 'UPDATING_AGGREGATE_LATEST') {
      result = checkSummary_(state.checks);
      return { auditStatus: result.status, checks: result };
    }

    if (phase === 'RECONCILING_AGGREGATES') {
      var evidence = evidenceRecord_(context, state);
      var stored = upsertEvidence_(spreadsheet, evidence);
      result = checkSummary_(state.checks);
      if (result.failed > 0) {
        throw AKORT.Core.error(
          'BETA16_FULL_AUDIT_FAILED',
          'Full Audit completed with failed checks.',
          {
            retryable: false,
            requiresReview: true,
            auditId: state.auditId,
            evidenceHash: state.evidenceHash,
            checks: result,
            evidenceWrite: stored
          }
        );
      }
      return {
        auditId: state.auditId,
        evidenceHash: state.evidenceHash,
        auditStatus: result.status,
        evidenceWrite: stored
      };
    }

    if (phase === 'UPDATE_STATUS') {
      rows = allRows_(spreadsheet, EVIDENCE_TABLE, 250).filter(function (row) {
        return text_(row.audit_id) === state.auditId;
      });
      if (rows.length !== 1 || text_(rows[0].evidence_hash) !== state.evidenceHash) {
        throw AKORT.Core.error(
          'BETA16_EVIDENCE_READBACK_MISMATCH',
          'Full Audit evidence read-back differs from the durable checkpoint.',
          { auditId: state.auditId, rows: rows.length, retryable: false, requiresReview: true }
        );
      }
      return { evidenceReadback: 'MATCH', auditId: state.auditId };
    }

    if (phase === 'QUICK_AUDIT') {
      rows = allRows_(spreadsheet, RETENTION_TABLE, 250).filter(function (row) {
        return text_(row.audit_id) === state.auditId;
      });
      if (rows.length !== state.retentionRowCount || rows.some(function (row) {
        return text_(row.snapshot_fingerprint) !== state.retentionSnapshotFingerprint;
      })) {
        throw AKORT.Core.error(
          'BETA16_RETENTION_READBACK_MISMATCH',
          'Retention registry read-back differs from the durable checkpoint.',
          { auditId: state.auditId, rows: rows.length, retryable: false, requiresReview: true }
        );
      }
      return { retentionReadback: 'MATCH', rows: rows.length };
    }

    if (phase === 'FINALIZING') {
      state.finishedAt = AKORT.Core.now();
      return {
        auditId: state.auditId,
        evidenceHash: state.evidenceHash,
        retentionRows: state.retentionRowCount,
        physicalDeletion: false,
        completed: true
      };
    }

    throw AKORT.Core.error(
      'BETA16_UNSUPPORTED_PHASE',
      'Beta.1.6 handler received an unsupported phase.',
      { phase: phase, retryable: false }
    );
  }

  function inspectTarget_(spreadsheet, name, expected) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      return { name: name, status: 'ABSENT', schemaMatches: true, rows: 0, actualHeaders: [] };
    }
    var actual = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(String);
    return {
      name: name,
      status: 'PRESENT',
      schemaMatches: JSON.stringify(actual) === JSON.stringify(expected),
      rows: Math.max(0, sheet.getLastRow() - 1),
      actualHeaders: actual
    };
  }

  function preflight() {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_PREFLIGHT',
      function () {
        assertBase_();
        var spreadsheet = dwh_();
        var blockers = [];
        SOURCE_TABLES.forEach(function (name) {
          try { table_(spreadsheet, name); }
          catch (caught) { blockers.push(caught.code + ':' + name); }
        });
        var targets = [
          inspectTarget_(spreadsheet, EVIDENCE_TABLE, EVIDENCE_HEADERS),
          inspectTarget_(spreadsheet, RETENTION_TABLE, RETENTION_HEADERS)
        ];
        targets.forEach(function (target) {
          if (!target.schemaMatches) blockers.push('TARGET_SCHEMA_MISMATCH:' + target.name);
        });
        var requiredModules = {
          operationEngine: Boolean(AKORT.OperationEngine && typeof AKORT.OperationEngine.enqueue === 'function'),
          hardening: Boolean(AKORT.Beta14OperationalHardening &&
            typeof AKORT.Beta14OperationalHardening.enqueueGuarded === 'function'),
          observability: Boolean(AKORT.Beta15CompactObservability &&
            typeof AKORT.Beta15CompactObservability.status === 'function'),
          gate7: Boolean(AKORT.Alpha74Gate7Acceptance &&
            typeof AKORT.Alpha74Gate7Acceptance.status === 'function')
        };
        Object.keys(requiredModules).forEach(function (name) {
          if (!requiredModules[name]) blockers.push('REQUIRED_MODULE_MISSING:' + name);
        });
        if (AKORT.Beta14OperationalHardening &&
            typeof AKORT.Beta14OperationalHardening.status === 'function') {
          var hardening = AKORT.Beta14OperationalHardening.status();
          var inventory = hardening && hardening.ok && hardening.data
            ? hardening.data.operationInventory || {} : {};
          if (Number(inventory.nonTerminalCount || 0) > 0) {
            blockers.push('NON_TERMINAL_OPERATION_EXISTS');
          }
        }
        var data = {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          baseCommit: BASE_COMMIT,
          readyToInstall: blockers.length === 0,
          blockers: blockers,
          targetInspection: targets,
          requiredModules: requiredModules,
          readBoundary: 'SERVICE_TABLE_HEADERS_AND_BOUNDED_STATUS_ONLY',
          physicalDeletion: false,
          userPipelineEnabled: false,
          productionTouched: false
        };
        return blockers.length
          ? AKORT.Result.failure('BETA16_FULL_AUDIT_PREFLIGHT_BLOCKED',
              'Beta.1.6 Full Audit preflight found blockers.', data)
          : AKORT.Result.success('Beta.1.6 Full Audit preflight passed.', data);
      },
      { lock: false, persistLogs: false }
    );
  }

  function install() {
    var checked = preflight();
    if (!checked.ok) return checked;
    var core = AKORT.Core.install();
    if (!core.ok) return core;
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_INSTALL',
      function () {
        assertBase_();
        var spreadsheet = dwh_();
        table_(spreadsheet, EVIDENCE_TABLE);
        table_(spreadsheet, RETENTION_TABLE);
        return AKORT.Result.success('Beta.1.6 Full Audit and retention installed.', {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          baseRelease: BASE_RELEASE,
          baseCommit: BASE_COMMIT,
          preflight: checked.data,
          coreInstallation: core.data,
          readModels: [EVIDENCE_TABLE, RETENTION_TABLE],
          operationType: OPERATION_TYPE,
          createsTrigger: false,
          physicalDeletion: false,
          userPipelineEnabled: false,
          productionTouched: false
        });
      },
      { lock: true, persistLogs: true }
    );
  }

  function auditId_() {
    var stamp = Utilities.formatDate(new Date(), 'GMT', "yyyyMMdd'T'HHmmssSSS'Z'");
    return 'AUD_' + stamp + '_' + Utilities.getUuid().replace(/-/g, '').slice(-10).toUpperCase();
  }

  function submit(reason) {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_SUBMIT',
      function () {
        assertBase_();
        table_(dwh_(), EVIDENCE_TABLE);
        table_(dwh_(), RETENTION_TABLE);
        var auditId = auditId_();
        var dateKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyyMMdd');
        var idempotencyKey = [OPERATION_TYPE, dateKey, AKORT.Core.sha256(text_(reason)).slice(0, 12)].join('|');
        var queued = AKORT.Beta14OperationalHardening.enqueueGuarded(
          OPERATION_TYPE,
          { auditId: auditId, reason: text_(reason) || 'Manual Full Audit', retentionDryRun: true },
          { idempotencyKey: idempotencyKey, maxAttempts: 3, priority: 80, requester: 'BETA16_FULL_AUDIT' }
        );
        if (!queued.ok) return queued;
        var queuedCheckpoint = queued.data && queued.data.operation &&
          queued.data.operation.checkpoint || {};
        var effectiveAuditId = text_(
          queuedCheckpoint.input && queuedCheckpoint.input.auditId
        ) || auditId;
        return AKORT.Result.success('Beta.1.6 Full Audit operation submitted.', {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          auditId: effectiveAuditId,
          operationId: queued.data.operationId,
          reused: queued.data.reused === true,
          idempotencyKey: idempotencyKey,
          nextAction: 'RUN_FULL_AUDIT',
          dryRun: true,
          physicalDeletion: false
        });
      },
      { lock: false, persistLogs: true }
    );
  }

  function assertFullAuditOperation_(operationId) {
    var status = AKORT.OperationEngine.status(operationId);
    if (!status.ok) throw AKORT.Core.error(status.code || 'BETA16_OPERATION_STATUS_FAILED', status.message, status.details);
    var operation = status.data && status.data.operation || {};
    if (text_(operation.operation_type) !== OPERATION_TYPE) {
      throw AKORT.Core.error(
        'BETA16_OPERATION_TYPE_MISMATCH',
        'The supplied operation is not a Full Audit operation.',
        { operationId: operationId, operationType: operation.operation_type, retryable: false }
      );
    }
    return status;
  }

  function continueAudit(operationId) {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_CONTINUE',
      function () {
        assertBase_();
        assertFullAuditOperation_(operationId);
        return AKORT.OperationEngine.resume(operationId, { maxSteps: 50 });
      },
      { lock: false, persistLogs: false, operationId: operationId || '' }
    );
  }

  function evidenceFor_(spreadsheet, auditId, operationId) {
    var rows = allRows_(spreadsheet, EVIDENCE_TABLE, 250);
    var matched = rows.filter(function (row) {
      if (auditId && text_(row.audit_id) !== text_(auditId)) return false;
      if (operationId && text_(row.operation_id) !== text_(operationId)) return false;
      return true;
    });
    return latestBy_(matched, ['finished_at', 'started_at']);
  }

  function status(operationId) {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_STATUS',
      function () {
        assertBase_();
        var engine = operationId ? assertFullAuditOperation_(operationId) : null;
        var spreadsheet = dwh_();
        var evidence = evidenceFor_(spreadsheet, '', operationId || '');
        var retention = allRows_(spreadsheet, RETENTION_TABLE, 250);
        if (evidence) {
          retention = retention.filter(function (row) {
            return text_(row.audit_id) === text_(evidence.audit_id);
          });
        }
        return AKORT.Result.success('Beta.1.6 Full Audit status loaded.', {
          packageVersion: PACKAGE_VERSION,
          contractVersion: CONTRACT_VERSION,
          operationId: operationId || '',
          operation: engine ? engine.data : null,
          evidence: evidence || null,
          retention: {
            rowCount: retention.length,
            protectedArtifacts: retention.filter(function (row) {
              return truthy_(row.protected_flag);
            }).length,
            reviewCandidates: retention.filter(function (row) {
              return text_(row.candidate_action) === 'REVIEW_FOR_RETENTION';
            }).length,
            dryRun: retention.every(function (row) { return truthy_(row.dry_run); }),
            physicalDeletion: false
          },
          readsPhysicalRawTargets: false,
          readsPhysicalPublishTargets: false,
          userPipelineEnabled: false,
          productionTouched: false
        });
      },
      { lock: false, persistLogs: false, operationId: operationId || '' }
    );
  }

  function evidence(auditId) {
    return AKORT.Core.safeRun(
      'BETA16_FULL_AUDIT_EVIDENCE',
      function () {
        assertBase_();
        var record = evidenceFor_(dwh_(), auditId || '', '');
        return record
          ? AKORT.Result.success('Beta.1.6 Full Audit evidence loaded.', record)
          : AKORT.Result.failure('BETA16_EVIDENCE_NOT_FOUND', 'Full Audit evidence was not found.', { auditId: auditId || '' });
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
      inventoryPackage: '4.0.0-beta.1.6.1',
      operationType: OPERATION_TYPE,
      acceptedExecutor: 'AKORT.OperationEngine',
      guardedEnqueue: 'AKORT.Beta14OperationalHardening.enqueueGuarded',
      readModels: {
        FULL_AUDIT_EVIDENCE: EVIDENCE_HEADERS.slice(),
        RETENTION_REGISTRY: RETENTION_HEADERS.slice()
      },
      authoritativeSourceTables: SOURCE_TABLES.slice(),
      tailRowsPerSource: MAX_TAIL_ROWS,
      retentionPolicy: {
        backupRetentionDays: BACKUP_RETENTION_DAYS,
        protectedLatestSuccessfulBackups: BACKUP_PROTECTED_LATEST,
        dryRunOnly: true,
        physicalDeletion: false,
        driveEnumeration: false,
        protectedArtifactClasses: [
          'ACCEPTED_RELEASE',
          'GATE_ACCEPTANCE_EVIDENCE',
          'VERIFIED_BASELINE',
          'REQUIRED_PAIRED_BACKUP',
          'ACTIVE_OPERATION_CHECKPOINT',
          'LATEST_SUCCESSFUL_FULL_AUDIT'
        ]
      },
      publicApi: [
        'AKORT_beta16FullAuditContract',
        'AKORT_beta16FullAuditPreflight',
        'AKORT_beta16FullAuditInstall',
        'AKORT_beta16FullAuditSubmit',
        'AKORT_beta16FullAuditContinue',
        'AKORT_beta16FullAuditStatus',
        'AKORT_beta16FullAuditEvidence'
      ],
      createsTrigger: false,
      deletesTrigger: false,
      newQueue: false,
      newExecutor: false,
      newDispatcher: false,
      readsPhysicalRawTargets: false,
      readsPhysicalPublishTargets: false,
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
    OperationType: OPERATION_TYPE,
    EvidenceTable: EVIDENCE_TABLE,
    RetentionTable: RETENTION_TABLE,
    EvidenceHeaders: EVIDENCE_HEADERS.slice(),
    RetentionHeaders: RETENTION_HEADERS.slice(),
    contract: contract,
    preflight: preflight,
    install: install,
    submit: submit,
    continueAudit: continueAudit,
    status: status,
    evidence: evidence,
    __executePhaseForHandler: executePhase_,
    Test: Object.freeze({
      planRetention: planRetention_,
      checkSummary: checkSummary_,
      retentionRow: retentionRow_
    })
  });
})();

AKORT.Beta16FullAuditHandlers = Object.freeze({
  supports: function (operationType) {
    return String(operationType || '') === 'FULL_AUDIT_V4';
  },
  execute: function (phase, context) {
    return AKORT.Beta16FullAuditRetention &&
      AKORT.Beta16FullAuditRetention.OperationType === 'FULL_AUDIT_V4'
      ? AKORT.Beta16FullAuditRetention.__executePhaseForHandler(phase, context)
      : null;
  }
});


function AKORT_beta16FullAuditContract() {
  return AKORT.Result.success(
    'Beta.1.6 Full Audit and retention contract loaded.',
    AKORT.Beta16FullAuditRetention.contract()
  );
}

function AKORT_beta16FullAuditPreflight() {
  return AKORT.Beta16FullAuditRetention.preflight();
}

function AKORT_beta16FullAuditInstall() {
  return AKORT.Beta16FullAuditRetention.install();
}

function AKORT_beta16FullAuditSubmit(reason) {
  return AKORT.Beta16FullAuditRetention.submit(reason);
}

function AKORT_beta16FullAuditContinue(operationId) {
  return AKORT.Beta16FullAuditRetention.continueAudit(operationId);
}

function AKORT_beta16FullAuditStatus(operationId) {
  return AKORT.Beta16FullAuditRetention.status(operationId);
}

function AKORT_beta16FullAuditEvidence(auditId) {
  return AKORT.Beta16FullAuditRetention.evidence(auditId);
}
