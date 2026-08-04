var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Alpha.7.4 Gate 7 acceptance harness.
 *
 * G7.1 installs the immutable twelve-profile control-file inventory.
 * G7.2 executes a resumable read-only parser preview matrix.
 *
 * RAW, Publish and Industry data-plane writes remain unavailable here.
 */
AKORT.Alpha74Gate7Acceptance = (function () {
  var VERSION = '4.0-alpha74-gate7-acceptance-5';
  var EVIDENCE_SCHEMA = '4.0-alpha74-gate7-evidence-1';
  var STATE_SCHEMA = '4.0-alpha74-gate7-state-5';
  var RELEASE = '4.0.0-alpha.7.4.42';

  var STATE_PROPERTY = 'AKORT_ALPHA74_GATE7_STATE_V1';
  var PREVIEW_ITEM_ENCODING = 'ARRAY_V1';
  var LEGACY_PREVIEW_CONTRACTS = Object.freeze([
    Object.freeze({
      release: '4.0.0-alpha.7.4.39',
      version: '4.0-alpha74-gate7-acceptance-2',
      schemaVersion: '4.0-alpha74-gate7-state-2'
    }),
    Object.freeze({
      release: '4.0.0-alpha.7.4.40',
      version: '4.0-alpha74-gate7-acceptance-3',
      schemaVersion: '4.0-alpha74-gate7-state-3'
    }),
    Object.freeze({
      release: '4.0.0-alpha.7.4.41',
      version: '4.0-alpha74-gate7-acceptance-4',
      schemaVersion: '4.0-alpha74-gate7-state-4'
    })
  ]);
  var CONTROL_SHEET = 'GATE7_CONTROL_FILES';
  var EXPECTED_PROFILE_COUNT = 12;
  var PREVIEW_BATCH_SIZE = 1;
  var MAX_STATE_BYTES = 8500;
  var INDUSTRY_STATE_SCHEMA =
    '4.0-alpha74-gate7-industry-state-1';
  var INDUSTRY_STATE_PROPERTY =
    'AKORT_ALPHA74_GATE7_INDUSTRY_STATE_V1';
  var INDUSTRY_PERMIT_SCHEMA =
    '4.0-alpha74-gate7-industry-permit-1';
  var INDUSTRY_PERMIT_PROPERTY =
    'AKORT_ALPHA74_GATE7_INDUSTRY_PERMIT_V1';
  var EVIDENCE_SHEET = 'GATE7_EVIDENCE';
  var EVIDENCE_HEADERS = Object.freeze([
    'evidence_id',
    'accepted_at',
    'evidence_hash',
    'evidence_json',
    'release_version'
  ]);
  var TERMINAL_FAILURES = Object.freeze([
    'FAILED',
    'FAILED_REQUIRES_REVIEW',
    'DEAD_LETTER',
    'CANCELLED'
  ]);

  var CONTROL_HEADERS = Object.freeze([
    'profile_id',
    'family_code',
    'frequency',
    'target_table',
    'dataset_code',
    'source_file_type',
    'value_type',
    'parser_kind',
    'file_id_or_url',
    'year',
    'month',
    'week',
    'source_published_at'
  ]);

  var EDITABLE_HEADERS = Object.freeze([
    'file_id_or_url',
    'year',
    'month',
    'week',
    'source_published_at'
  ]);

  function clone_(value) {
    return value === undefined
      ? undefined
      : JSON.parse(JSON.stringify(value));
  }

  function text_(value) {
    if (value === null || value === undefined) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? '' : value.toISOString();
    }
    return String(value).trim();
  }

  function now_() {
    return new Date().toISOString();
  }

  function error_(code, message, details) {
    return AKORT.Core.error(code, message, details || {});
  }

  function assert_(condition, code, message, details) {
    if (!condition) throw error_(code, message, details);
  }

  function integerOrBlank_(value, field, minimum, maximum) {
    var raw = text_(value);
    if (!raw) return '';

    var numeric = Number(raw.replace(',', '.'));
    assert_(
      isFinite(numeric) && Math.floor(numeric) === numeric,
      'ALPHA74_GATE7_CONTROL_INTEGER_INVALID',
      'Gate 7 control value must be an integer.',
      { field: field, value: raw }
    );
    assert_(
      numeric >= minimum && numeric <= maximum,
      'ALPHA74_GATE7_CONTROL_INTEGER_RANGE',
      'Gate 7 control value is outside the accepted range.',
      {
        field: field,
        value: numeric,
        minimum: minimum,
        maximum: maximum
      }
    );
    return numeric;
  }

  function parseFileId_(value) {
    var raw = text_(value);
    if (!raw) return '';

    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;

    var patterns = [
      /\/d\/([A-Za-z0-9_-]{20,})/,
      /[?&]id=([A-Za-z0-9_-]{20,})/,
      /\/file\/d\/([A-Za-z0-9_-]{20,})/
    ];

    for (var i = 0; i < patterns.length; i += 1) {
      var match = raw.match(patterns[i]);
      if (match) return match[1];
    }

    throw error_(
      'ALPHA74_GATE7_CONTROL_FILE_ID_INVALID',
      'Gate 7 requires a Google Drive file ID or supported file URL.',
      { value: raw }
    );
  }

  function profiles_() {
    assert_(
      AKORT.ExistingSourceParsers &&
        typeof AKORT.ExistingSourceParsers.profiles === 'function',
      'ALPHA74_GATE7_PROFILE_API_UNAVAILABLE',
      'Existing source parser profile API is unavailable.'
    );

    var profiles = AKORT.ExistingSourceParsers.profiles()
      .slice()
      .sort(function (left, right) {
        return text_(left.profileId) < text_(right.profileId)
          ? -1
          : text_(left.profileId) > text_(right.profileId)
            ? 1
            : 0;
      });

    assert_(
      profiles.length === EXPECTED_PROFILE_COUNT,
      'ALPHA74_GATE7_PROFILE_COUNT_MISMATCH',
      'Gate 7 requires exactly twelve approved parser profiles.',
      {
        expected: EXPECTED_PROFILE_COUNT,
        actual: profiles.length
      }
    );

    var seen = {};
    profiles.forEach(function (profile) {
      var profileId = text_(profile.profileId);
      assert_(
        profileId,
        'ALPHA74_GATE7_PROFILE_ID_MISSING',
        'Approved parser profile has no profile ID.'
      );
      assert_(
        !seen[profileId],
        'ALPHA74_GATE7_PROFILE_DUPLICATE',
        'Approved parser profile inventory contains a duplicate.',
        { profileId: profileId }
      );
      seen[profileId] = true;

      [
        'familyCode',
        'frequency',
        'targetTable',
        'datasetCode',
        'sourceFileType',
        'parserKind'
      ].forEach(function (field) {
        assert_(
          text_(profile[field]),
          'ALPHA74_GATE7_PROFILE_FIELD_MISSING',
          'Approved parser profile metadata is incomplete.',
          { profileId: profileId, field: field }
        );
      });
    });

    return profiles;
  }

  function profileMap_(profiles) {
    var map = {};
    profiles.forEach(function (profile) {
      map[text_(profile.profileId)] = profile;
    });
    return map;
  }

  function resources_() {
    var config = AKORT.Config.load({ includeSystemSettings: false });
    var resources = config && config.resources || {};

    assert_(
      text_(resources.dwhSpreadsheetId),
      'ALPHA74_GATE7_DWH_RESOURCE_MISSING',
      'Gate 7 DEV DWH spreadsheet resource is missing.'
    );

    return resources;
  }

  function dwh_() {
    return SpreadsheetApp.openById(resources_().dwhSpreadsheetId);
  }

  function rowHasValues_(row) {
    return CONTROL_HEADERS.some(function (header) {
      return text_(row[header]);
    });
  }

  function systemRow_(profile) {
    return {
      profile_id: text_(profile.profileId),
      family_code: text_(profile.familyCode),
      frequency: text_(profile.frequency),
      target_table: text_(profile.targetTable),
      dataset_code: text_(profile.datasetCode),
      source_file_type: text_(profile.sourceFileType),
      value_type: text_(profile.valueType),
      parser_kind: text_(profile.parserKind)
    };
  }

  function editableRow_(row) {
    return {
      file_id_or_url: row ? row.file_id_or_url : '',
      year: row ? row.year : '',
      month: row ? row.month : '',
      week: row ? row.week : '',
      source_published_at: row ? row.source_published_at : ''
    };
  }

  function combinedRow_(profile, editable) {
    var row = systemRow_(profile);
    EDITABLE_HEADERS.forEach(function (header) {
      row[header] = editable[header];
    });
    return row;
  }

  function rowValues_(row) {
    return CONTROL_HEADERS.map(function (header) {
      var value = row[header];
      return value === undefined || value === null ? '' : value;
    });
  }

  function validateSystemFields_(row, profile) {
    var expected = systemRow_(profile);

    Object.keys(expected).forEach(function (field) {
      assert_(
        text_(row[field]) === text_(expected[field]),
        'ALPHA74_GATE7_CONTROL_SYSTEM_FIELD_DRIFT',
        'Gate 7 control system metadata differs from the approved profile catalog.',
        {
          profileId: expected.profile_id,
          field: field,
          expected: expected[field],
          actual: row[field]
        }
      );
    });
  }

  function canonicalControlEntry_(row, profile, requireFile) {
    validateSystemFields_(row, profile);

    var fileId = parseFileId_(row.file_id_or_url);
    if (requireFile) {
      assert_(
        fileId,
        'ALPHA74_GATE7_CONTROL_FILE_MISSING',
        'Every approved parser profile requires one immutable control file.',
        { profileId: profile.profileId }
      );
    }

    return {
      profileId: text_(profile.profileId),
      familyCode: text_(profile.familyCode),
      frequency: text_(profile.frequency),
      targetTable: text_(profile.targetTable),
      datasetCode: text_(profile.datasetCode),
      sourceFileType: text_(profile.sourceFileType),
      valueType: text_(profile.valueType),
      parserKind: text_(profile.parserKind),
      fileId: fileId,
      year: integerOrBlank_(row.year, 'year', 1900, 2100),
      month: integerOrBlank_(row.month, 'month', 1, 12),
      week: integerOrBlank_(row.week, 'week', 1, 53),
      sourcePublishedAt: text_(row.source_published_at)
    };
  }

  function controlFingerprint_(entries) {
    var stable = entries.map(function (entry) {
      return {
        profileId: entry.profileId,
        familyCode: entry.familyCode,
        frequency: entry.frequency,
        targetTable: entry.targetTable,
        datasetCode: entry.datasetCode,
        sourceFileType: entry.sourceFileType,
        valueType: entry.valueType,
        parserKind: entry.parserKind,
        fileId: entry.fileId,
        year: entry.year,
        month: entry.month,
        week: entry.week,
        sourcePublishedAt: entry.sourcePublishedAt
      };
    });

    return AKORT.Core.sha256(AKORT.Core.canonicalJson(stable));
  }

  function readControlInventory_(options) {
    options = options || {};

    var spreadsheet = dwh_();
    var sheet = spreadsheet.getSheetByName(CONTROL_SHEET);

    if (!sheet) {
      if (options.required) {
        throw error_(
          'ALPHA74_GATE7_CONTROL_NOT_INSTALLED',
          'Gate 7 control-file inventory is not installed.'
        );
      }
      return null;
    }

    var profiles = profiles_();
    var byProfile = profileMap_(profiles);
    var rawRows = AKORT.Core.Sheets.readObjects(sheet);
    var rows = rawRows.filter(rowHasValues_);
    var seenProfiles = {};
    var seenFiles = {};
    var rowByProfile = {};

    rows.forEach(function (row) {
      var profileId = text_(row.profile_id);

      assert_(
        profileId,
        'ALPHA74_GATE7_CONTROL_PROFILE_ID_MISSING',
        'Gate 7 control row contains values but has no profile ID.',
        { row: row.__row }
      );
      assert_(
        byProfile[profileId],
        'ALPHA74_GATE7_CONTROL_PROFILE_UNKNOWN',
        'Gate 7 control row references an unknown parser profile.',
        { row: row.__row, profileId: profileId }
      );
      assert_(
        !seenProfiles[profileId],
        'ALPHA74_GATE7_CONTROL_PROFILE_DUPLICATE',
        'Gate 7 control inventory contains a duplicate profile.',
        { profileId: profileId }
      );

      seenProfiles[profileId] = true;
      rowByProfile[profileId] = row;
    });

    assert_(
      rows.length === EXPECTED_PROFILE_COUNT,
      'ALPHA74_GATE7_CONTROL_ROW_COUNT_MISMATCH',
      'Gate 7 control inventory must contain exactly twelve populated rows.',
      {
        expected: EXPECTED_PROFILE_COUNT,
        actual: rows.length
      }
    );

    var entries = profiles.map(function (profile) {
      var profileId = text_(profile.profileId);
      var row = rowByProfile[profileId];

      assert_(
        row,
        'ALPHA74_GATE7_CONTROL_PROFILE_MISSING',
        'Gate 7 control inventory is missing an approved parser profile.',
        { profileId: profileId }
      );

      var entry = canonicalControlEntry_(
        row,
        profile,
        options.requireFiles === true
      );

      if (entry.fileId) {
        assert_(
          !seenFiles[entry.fileId],
          'ALPHA74_GATE7_CONTROL_FILE_DUPLICATE',
          'One control file cannot represent multiple approved parser profiles.',
          {
            fileId: entry.fileId,
            profileId: profileId,
            previousProfileId: seenFiles[entry.fileId] || ''
          }
        );
        seenFiles[entry.fileId] = profileId;
      }

      return entry;
    });

    return {
      spreadsheet: spreadsheet,
      sheet: sheet,
      entries: entries,
      fingerprint: controlFingerprint_(entries)
    };
  }

  function readState_() {
    var raw = PropertiesService
      .getScriptProperties()
      .getProperty(STATE_PROPERTY);

    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (caught) {
      return {
        status: 'INVALID',
        errorCode: 'ALPHA74_GATE7_STATE_INVALID',
        errorMessage: caught.message || String(caught)
      };
    }
  }

  function saveState_(state) {
    state.schemaVersion = STATE_SCHEMA;
    state.release = RELEASE;
    state.version = VERSION;
    state.itemEncoding = PREVIEW_ITEM_ENCODING;
    state.updatedAt = now_();

    var serialized = JSON.stringify(state);

    assert_(
      serialized.length <= MAX_STATE_BYTES,
      'ALPHA74_GATE7_STATE_CAPACITY_EXCEEDED',
      'Gate 7 state exceeds the Script Properties capacity contract.',
      {
        bytes: serialized.length,
        maximum: MAX_STATE_BYTES
      }
    );

    PropertiesService
      .getScriptProperties()
      .setProperty(STATE_PROPERTY, serialized);

    return state;
  }

  function publicState_(state) {
    if (!state) return null;

    var items = expandPreviewItems_(state.items || []);

    return {
      status: state.status || '',
      cursor: Number(state.cursor || 0),
      completedProfiles: items.length,
      expectedProfiles: EXPECTED_PROFILE_COUNT,
      controlFingerprint: state.controlFingerprint || '',
      matrixFingerprint: state.matrixFingerprint || '',
      startedAt: state.startedAt || '',
      updatedAt: state.updatedAt || '',
      acceptedAt: state.acceptedAt || '',
      profiles: items.map(function (item) {
        return {
          profileId: item.profileId,
          fileName: item.fileName,
          sourceHash: item.sourceHash,
          structuralFingerprint: item.structuralFingerprint,
          sourceObservationCount: item.sourceObservationCount,
          normalizedRowCount: item.normalizedRowCount,
          configuredCategoryCount: item.configuredCategoryCount,
          matchedCategoryCount: item.matchedCategoryCount,
          ignoredObservationCount: item.ignoredObservationCount,
          ignoredSourceLabelCount: item.ignoredSourceLabelCount,
          unitCompatibilityConversionCount:
            item.unitCompatibilityConversionCount,
          unitCompatibilityTransformIds:
            clone_(item.unitCompatibilityTransformIds || []),
          issueCount: item.issueCount,
          warningCount: item.warningCount
        };
      })
    };
  }

  function fileMetadata_(fileId) {
    var file = DriveApp.getFileById(fileId);
    var updated = file.getLastUpdated();

    return {
      fileId: fileId,
      fileName: file.getName(),
      mimeType: file.getMimeType(),
      fileSize: Number(file.getSize() || 0),
      fileUpdatedAt: updated && !isNaN(updated.getTime())
        ? updated.toISOString()
        : ''
    };
  }

  function previewOptions_(entry) {
    var options = {};

    if (entry.year !== '') options.year = entry.year;
    if (entry.month !== '') options.month = entry.month;
    if (entry.week !== '') options.week = entry.week;
    if (entry.sourcePublishedAt) {
      options.sourcePublishedAt = entry.sourcePublishedAt;
    }

    return options;
  }

  function resolvedPeriod_(profile, resolved) {
    resolved = resolved || {};

    if (profile.frequency === 'weekly') {
      assert_(
        Number(resolved.year) >= 1900 &&
          Number(resolved.week) >= 1 &&
          Number(resolved.week) <= 53,
        'ALPHA74_GATE7_WEEKLY_PERIOD_UNRESOLVED',
        'Weekly control file did not resolve to an exact ISO year and week.',
        {
          profileId: profile.profileId,
          resolvedOptions: resolved
        }
      );
    }

    if (profile.frequency === 'monthly') {
      assert_(
        Number(resolved.year) >= 1900 &&
          Number(resolved.month) >= 1 &&
          Number(resolved.month) <= 12,
        'ALPHA74_GATE7_MONTHLY_PERIOD_UNRESOLVED',
        'Monthly control file did not resolve to an exact year and month.',
        {
          profileId: profile.profileId,
          resolvedOptions: resolved
        }
      );
    }

    return {
      year: resolved.year || '',
      month: resolved.month || '',
      week: resolved.week || '',
      sourcePublishedAt: text_(resolved.sourcePublishedAt)
    };
  }

  function stablePreviewItem_(item) {
    return {
      profileId: item.profileId,
      familyCode: item.familyCode,
      frequency: item.frequency,
      targetTable: item.targetTable,
      datasetCode: item.datasetCode,
      sourceFileType: item.sourceFileType,
      valueType: item.valueType,
      parserKind: item.parserKind,
      fileId: item.fileId,
      sourceHash: item.sourceHash,
      structuralFingerprint: item.structuralFingerprint,
      confidenceScore: item.confidenceScore,
      confidenceMargin: item.confidenceMargin,
      resolvedOptions: item.resolvedOptions,
      sourceObservationCount: item.sourceObservationCount,
      normalizedRowCount: item.normalizedRowCount,
      configuredCategoryCount: item.configuredCategoryCount,
      matchedCategoryCount: item.matchedCategoryCount,
      ignoredObservationCount: item.ignoredObservationCount,
      ignoredSourceLabelCount: item.ignoredSourceLabelCount,
      unitCompatibilityConversionCount:
        item.unitCompatibilityConversionCount,
      unitCompatibilityTransformIds:
        item.unitCompatibilityTransformIds,
      issueCount: item.issueCount,
      warningCount: item.warningCount,
      infoCount: item.infoCount
    };
  }

  function compactPreviewItem_(item) {
    var resolved = item.resolvedOptions || {};

    return [
      text_(item.profileId),
      text_(item.fileId),
      text_(item.fileName),
      text_(item.mimeType),
      Number(item.fileSize || 0),
      text_(item.fileUpdatedAt),
      text_(item.sourceHash),
      text_(item.structuralFingerprint),
      Number(item.confidenceScore || 0),
      Number(item.confidenceMargin || 0),
      [
        resolved.year === undefined ? '' : resolved.year,
        resolved.month === undefined ? '' : resolved.month,
        resolved.week === undefined ? '' : resolved.week,
        text_(resolved.sourcePublishedAt)
      ],
      Number(item.sourceObservationCount || 0),
      Number(item.normalizedRowCount || 0),
      Number(item.configuredCategoryCount || 0),
      Number(item.matchedCategoryCount || 0),
      Number(item.ignoredObservationCount || 0),
      Number(item.ignoredSourceLabelCount || 0),
      Number(item.unitCompatibilityConversionCount || 0),
      clone_(item.unitCompatibilityTransformIds || []),
      Number(item.issueCount || 0),
      Number(item.warningCount || 0),
      Number(item.infoCount || 0),
      text_(item.previewFingerprint)
    ];
  }

  function expandPreviewItem_(record, byProfile) {
    if (!Array.isArray(record)) return clone_(record);

    assert_(
      record.length === 23,
      'ALPHA74_GATE7_PREVIEW_ITEM_ENCODING_INVALID',
      'Gate 7 compact preview item has an invalid field count.',
      {
        fieldCount: record.length,
        expected: 23
      }
    );

    byProfile = byProfile || profileMap_(profiles_());

    var profileId = text_(record[0]);
    var profile = byProfile[profileId];

    assert_(
      profile,
      'ALPHA74_GATE7_PREVIEW_ITEM_PROFILE_UNKNOWN',
      'Gate 7 compact preview item references an unknown profile.',
      { profileId: profileId }
    );

    var resolved = record[10] || [];

    return {
      profileId: profileId,
      familyCode: text_(profile.familyCode),
      frequency: text_(profile.frequency),
      targetTable: text_(profile.targetTable),
      datasetCode: text_(profile.datasetCode),
      sourceFileType: text_(profile.sourceFileType),
      valueType: text_(profile.valueType),
      parserKind: text_(profile.parserKind),
      fileId: text_(record[1]),
      fileName: text_(record[2]),
      mimeType: text_(record[3]),
      fileSize: Number(record[4] || 0),
      fileUpdatedAt: text_(record[5]),
      sourceHash: text_(record[6]),
      structuralFingerprint: text_(record[7]),
      confidenceScore: Number(record[8] || 0),
      confidenceMargin: Number(record[9] || 0),
      resolvedOptions: {
        year: resolved[0] === undefined ? '' : resolved[0],
        month: resolved[1] === undefined ? '' : resolved[1],
        week: resolved[2] === undefined ? '' : resolved[2],
        sourcePublishedAt: text_(resolved[3])
      },
      sourceObservationCount: Number(record[11] || 0),
      normalizedRowCount: Number(record[12] || 0),
      configuredCategoryCount: Number(record[13] || 0),
      matchedCategoryCount: Number(record[14] || 0),
      ignoredObservationCount: Number(record[15] || 0),
      ignoredSourceLabelCount: Number(record[16] || 0),
      unitCompatibilityConversionCount: Number(record[17] || 0),
      unitCompatibilityTransformIds: clone_(record[18] || []),
      issueCount: Number(record[19] || 0),
      warningCount: Number(record[20] || 0),
      infoCount: Number(record[21] || 0),
      previewFingerprint: text_(record[22])
    };
  }

  function expandPreviewItems_(items) {
    var byProfile = profileMap_(profiles_());

    return (items || []).map(function (record) {
      return expandPreviewItem_(record, byProfile);
    });
  }

  function previewEntry_(entry) {
    var before = fileMetadata_(entry.fileId);
    var options = previewOptions_(entry);

    var preview = AKORT.ExistingSourceParsers.previewFile(
      entry.fileId,
      options
    );

    assert_(
      preview && preview.ok && preview.data,
      'ALPHA74_GATE7_PREVIEW_FAILED',
      'Approved control file preview did not complete successfully.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId,
        result: preview || null
      }
    );

    var data = preview.data;
    var detected = data.profile || {};
    var issues = data.issues || [];
    var errors = issues.filter(function (issue) {
      return text_(issue.severity).toUpperCase() === 'ERROR';
    });
    var warnings = issues.filter(function (issue) {
      return text_(issue.severity).toUpperCase() === 'WARNING';
    });
    var infos = issues.filter(function (issue) {
      return text_(issue.severity).toUpperCase() === 'INFO';
    });

    assert_(
      text_(detected.profileId) === entry.profileId,
      'ALPHA74_GATE7_PROFILE_RECOGNITION_MISMATCH',
      'Control file was recognized as a different parser profile.',
      {
        expectedProfileId: entry.profileId,
        detectedProfileId: detected.profileId || '',
        fileId: entry.fileId,
        confidence: data.confidence || {}
      }
    );

    [
      ['familyCode', entry.familyCode],
      ['frequency', entry.frequency],
      ['targetTable', entry.targetTable],
      ['datasetCode', entry.datasetCode],
      ['sourceFileType', entry.sourceFileType],
      ['valueType', entry.valueType],
      ['parserKind', entry.parserKind]
    ].forEach(function (pair) {
      assert_(
        text_(detected[pair[0]]) === text_(pair[1]),
        'ALPHA74_GATE7_PROFILE_METADATA_MISMATCH',
        'Recognized parser profile metadata differs from the approved catalog.',
        {
          profileId: entry.profileId,
          field: pair[0],
          expected: pair[1],
          actual: detected[pair[0]]
        }
      );
    });

    assert_(
      errors.length === 0,
      'ALPHA74_GATE7_PREVIEW_BLOCKING_ISSUES',
      'Control file preview contains blocking parser issues.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId,
        errors: errors
      }
    );

    assert_(
      Number(data.sourceObservationCount || 0) > 0,
      'ALPHA74_GATE7_SOURCE_OBSERVATIONS_EMPTY',
      'Control file preview produced no source observations.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId
      }
    );

    assert_(
      Number(data.normalizedRowCount || 0) > 0,
      'ALPHA74_GATE7_NORMALIZED_ROWS_EMPTY',
      'Control file preview produced no normalized rows.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId
      }
    );

    var resolved = resolvedPeriod_(
      entry,
      data.resolvedOptions || {}
    );

    var after = fileMetadata_(entry.fileId);

    assert_(
      before.fileUpdatedAt === after.fileUpdatedAt &&
        before.fileSize === after.fileSize,
      'ALPHA74_GATE7_CONTROL_FILE_CHANGED_DURING_PREVIEW',
      'Control file changed while its read-only preview was running.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId,
        before: before,
        after: after
      }
    );

    var monitoringScope = data.monitoringScope || {};

    var item = {
      profileId: entry.profileId,
      familyCode: entry.familyCode,
      frequency: entry.frequency,
      targetTable: entry.targetTable,
      datasetCode: entry.datasetCode,
      sourceFileType: entry.sourceFileType,
      valueType: entry.valueType,
      parserKind: entry.parserKind,
      fileId: entry.fileId,
      fileName: before.fileName,
      mimeType: before.mimeType,
      fileSize: before.fileSize,
      fileUpdatedAt: before.fileUpdatedAt,
      sourceHash: text_(data.sourceHash),
      structuralFingerprint: text_(data.structuralFingerprint),
      confidenceScore: Number(data.confidence && data.confidence.score || 0),
      confidenceMargin: Number(data.confidence && data.confidence.margin || 0),
      resolvedOptions: resolved,
      sourceObservationCount: Number(data.sourceObservationCount || 0),
      normalizedRowCount: Number(data.normalizedRowCount || 0),
      configuredCategoryCount:
        Number(monitoringScope.configuredCategoryCount || 0),
      matchedCategoryCount:
        Number(monitoringScope.matchedCategoryCount || 0),
      ignoredObservationCount:
        Number(monitoringScope.ignoredObservationCount || 0),
      ignoredSourceLabelCount:
        Number(monitoringScope.ignoredSourceLabelCount || 0),
      unitCompatibilityConversionCount:
        Number(
          monitoringScope
            .unitCompatibilityConversionCount || 0
        ),
      unitCompatibilityTransformIds:
        clone_(
          monitoringScope
            .unitCompatibilityTransformIds || []
        ),
      issueCount: issues.length,
      warningCount: warnings.length,
      infoCount: infos.length
    };

    assert_(
      item.sourceHash && item.structuralFingerprint,
      'ALPHA74_GATE7_PREVIEW_FINGERPRINT_MISSING',
      'Control file preview did not return both required fingerprints.',
      {
        profileId: entry.profileId,
        fileId: entry.fileId
      }
    );

    item.previewFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(stablePreviewItem_(item))
    );

    return item;
  }

  function verifyImmutableFiles_(items) {
    expandPreviewItems_(items).forEach(function (item) {
      var current = fileMetadata_(item.fileId);

      assert_(
        current.fileUpdatedAt === item.fileUpdatedAt &&
          current.fileSize === item.fileSize,
        'ALPHA74_GATE7_CONTROL_FILE_MUTATED',
        'An accepted control file changed before preview-matrix finalization.',
        {
          profileId: item.profileId,
          fileId: item.fileId,
          acceptedMetadata: {
            fileUpdatedAt: item.fileUpdatedAt,
            fileSize: item.fileSize
          },
          currentMetadata: current
        }
      );
    });
  }

  function stateContractMatches_(state) {
    return Boolean(
      state &&
      text_(state.schemaVersion) === STATE_SCHEMA &&
      text_(state.release) === RELEASE &&
      text_(state.version) === VERSION &&
      text_(state.itemEncoding) === PREVIEW_ITEM_ENCODING
    );
  }

  function legacyPreviewContract_(state) {
    if (!state ||
        text_(state.itemEncoding) !== PREVIEW_ITEM_ENCODING ||
        (
          text_(state.status) !== 'PREVIEW_RUNNING' &&
          text_(state.status) !== 'PREVIEW_ACCEPTED'
        )) {
      return null;
    }

    for (var index = 0;
         index < LEGACY_PREVIEW_CONTRACTS.length;
         index += 1) {
      var contract = LEGACY_PREVIEW_CONTRACTS[index];
      if (
        text_(state.release) === contract.release &&
        text_(state.version) === contract.version &&
        text_(state.schemaVersion) ===
          contract.schemaVersion
      ) {
        return contract;
      }
    }

    return null;
  }

  function legacyPreviewContractMatches_(state) {
    return Boolean(legacyPreviewContract_(state));
  }

  function adoptLegacyPreviewState_(state, control) {
    var legacy = legacyPreviewContract_(state);
    if (!legacy) return state;

    assert_(
      text_(state.controlFingerprint) ===
        text_(control && control.fingerprint),
      'ALPHA74_GATE7_LEGACY_CONTROL_MISMATCH',
      'The resumable preview state belongs to another control inventory.',
      {
        legacyRelease: legacy.release,
        stateFingerprint: text_(state.controlFingerprint),
        controlFingerprint: text_(control && control.fingerprint)
      }
    );

    assert_(
      Array.isArray(state.items) &&
        Number(state.cursor || 0) === state.items.length &&
        state.items.length <= EXPECTED_PROFILE_COUNT,
      'ALPHA74_GATE7_LEGACY_STATE_INVALID',
      'The resumable preview state has an invalid durable cursor.',
      {
        legacyRelease: legacy.release,
        cursor: Number(state.cursor || 0),
        itemCount: Array.isArray(state.items)
          ? state.items.length
          : -1
      }
    );

    state.migratedFrom = {
      release: legacy.release,
      version: legacy.version,
      schemaVersion: legacy.schemaVersion,
      migratedAt: now_()
    };

    return saveState_(state);
  }

  function newPreviewState_(control) {
    return {
      schemaVersion: STATE_SCHEMA,
      release: RELEASE,
      version: VERSION,
      itemEncoding: PREVIEW_ITEM_ENCODING,
      status: 'PREVIEW_RUNNING',
      controlFingerprint: control.fingerprint,
      cursor: 0,
      items: [],
      startedAt: now_(),
      updatedAt: now_(),
      acceptedAt: '',
      matrixFingerprint: ''
    };
  }

  function install() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_INSTALL',
      function () {
        AKORT.EnvironmentGuard.assertDev();

        var profiles = profiles_();
        var byProfile = profileMap_(profiles);
        var spreadsheet = dwh_();
        var ensured = AKORT.Core.Sheets.ensure(
          spreadsheet,
          CONTROL_SHEET,
          CONTROL_HEADERS.slice()
        );
        var sheet = ensured.sheet;
        var existingRows = AKORT.Core.Sheets
          .readObjects(sheet)
          .filter(rowHasValues_);
        var existingByProfile = {};

        existingRows.forEach(function (row) {
          var profileId = text_(row.profile_id);

          assert_(
            profileId,
            'ALPHA74_GATE7_INSTALL_ROW_PROFILE_MISSING',
            'Existing Gate 7 control row contains values but no profile ID.',
            { row: row.__row }
          );
          assert_(
            byProfile[profileId],
            'ALPHA74_GATE7_INSTALL_UNKNOWN_PROFILE',
            'Existing Gate 7 control row references an unknown profile.',
            { row: row.__row, profileId: profileId }
          );
          assert_(
            !existingByProfile[profileId],
            'ALPHA74_GATE7_INSTALL_DUPLICATE_PROFILE',
            'Existing Gate 7 control sheet contains duplicate profile rows.',
            { profileId: profileId }
          );

          existingByProfile[profileId] = row;
        });

        var rows = profiles.map(function (profile) {
          return combinedRow_(
            profile,
            editableRow_(existingByProfile[profile.profileId])
          );
        });

        var existingState = readState_();
        if (
          existingState &&
          existingState.status === 'PREVIEW_ACCEPTED'
        ) {
          var acceptedEntries = rows.map(function (row, index) {
            return canonicalControlEntry_(row, profiles[index], true);
          });
          var acceptedFingerprint =
            controlFingerprint_(acceptedEntries);

          assert_(
            acceptedFingerprint ===
              existingState.controlFingerprint,
            'ALPHA74_GATE7_CONTROL_CHANGED_AFTER_ACCEPTANCE',
            'Accepted Gate 7 control inventory cannot be changed by reinstall.',
            {
              acceptedFingerprint:
                existingState.controlFingerprint,
              currentFingerprint: acceptedFingerprint
            }
          );
        }

        if (sheet.getLastRow() > 1) {
          sheet.getRange(
            2,
            1,
            sheet.getLastRow() - 1,
            CONTROL_HEADERS.length
          ).clearContent();
        }

        sheet.getRange(
          2,
          1,
          rows.length,
          CONTROL_HEADERS.length
        ).setValues(rows.map(rowValues_));

        sheet.setFrozenRows(1);
        sheet.setFrozenColumns(8);
        sheet.autoResizeColumns(1, CONTROL_HEADERS.length);

        sheet.getRange(
          1,
          1,
          1,
          8
        ).setNote(
          'System fields. They are regenerated from the approved parser catalog.'
        );

        sheet.getRange(
          1,
          9,
          1,
          EDITABLE_HEADERS.length
        ).setNote(
          'Editable Gate 7 control-file fields.'
        );

        return AKORT.Result.success(
          'Alpha.7.4 Gate 7 control-file inventory installed.',
          {
            release: RELEASE,
            version: VERSION,
            controlSheet: CONTROL_SHEET,
            created: ensured.created,
            profileCount: rows.length,
            editableHeaders: EDITABLE_HEADERS.slice(),
            dataPlaneWrites: false,
            controlPlaneWrites: true
          }
        );
      },
      { lock: true, persistLogs: false }
    );
  }

  function previewMatrix() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_PREVIEW_MATRIX',
      function () {
        AKORT.EnvironmentGuard.assertDev();

        var control = readControlInventory_({
          required: true,
          requireFiles: true
        });
        var state = readState_();

        assert_(
          !state || state.status !== 'INVALID',
          'ALPHA74_GATE7_STATE_INVALID',
          'Stored Gate 7 state is not valid JSON.',
          state || {}
        );

        if (!stateContractMatches_(state)) {
          state = adoptLegacyPreviewState_(state, control);
        }

        if (
          stateContractMatches_(state) &&
          state.status === 'PREVIEW_ACCEPTED'
        ) {
          assert_(
            state.controlFingerprint === control.fingerprint,
            'ALPHA74_GATE7_CONTROL_CHANGED_AFTER_ACCEPTANCE',
            'Accepted Gate 7 control inventory has changed.',
            {
              acceptedFingerprint:
                state.controlFingerprint,
              currentFingerprint: control.fingerprint
            }
          );

          verifyImmutableFiles_(state.items || []);

          return AKORT.Result.success(
            'Alpha.7.4 Gate 7 preview matrix is already accepted.',
            {
              release: RELEASE,
              version: VERSION,
              status: state.status,
              matrixFingerprint:
                state.matrixFingerprint,
              profileCount:
                (state.items || []).length,
              state: publicState_(state),
              dataPlaneWrites: false
            }
          );
        }

        if (
          !stateContractMatches_(state) ||
          state.status !== 'PREVIEW_RUNNING' ||
          state.controlFingerprint !== control.fingerprint
        ) {
          state = newPreviewState_(control);
          saveState_(state);
        }

        assert_(
          Number(state.cursor || 0) ===
            (state.items || []).length,
          'ALPHA74_GATE7_PREVIEW_CURSOR_INVALID',
          'Gate 7 preview cursor differs from its durable item inventory.',
          {
            cursor: state.cursor,
            items: (state.items || []).length
          }
        );

        var startCursor = Number(state.cursor || 0);
        var endCursor = Math.min(
          EXPECTED_PROFILE_COUNT,
          startCursor + PREVIEW_BATCH_SIZE
        );
        var processed = [];

        for (
          var cursor = startCursor;
          cursor < endCursor;
          cursor += 1
        ) {
          var entry = control.entries[cursor];
          var item = previewEntry_(entry);

          state.items.push(compactPreviewItem_(item));
          state.cursor = cursor + 1;
          processed.push(item);
          saveState_(state);
        }

        if (
          Number(state.cursor || 0) ===
          EXPECTED_PROFILE_COUNT
        ) {
          var expandedItems =
            expandPreviewItems_(state.items);

          verifyImmutableFiles_(expandedItems);

          state.matrixFingerprint = AKORT.Core.sha256(
            AKORT.Core.canonicalJson(
              expandedItems.map(stablePreviewItem_)
            )
          );
          state.status = 'PREVIEW_ACCEPTED';
          state.acceptedAt = now_();
          saveState_(state);

          return AKORT.Result.success(
            'Alpha.7.4 Gate 7 preview matrix accepted.',
            {
              release: RELEASE,
              version: VERSION,
              status: state.status,
              matrixFingerprint:
                state.matrixFingerprint,
              profileCount: state.items.length,
              processedThisRun: processed.map(function (item) {
                return item.profileId;
              }),
              matrix: clone_(expandedItems),
              dataPlaneWrites: false
            }
          );
        }

        return AKORT.Result.success(
          'Alpha.7.4 Gate 7 preview matrix checkpoint saved.',
          {
            release: RELEASE,
            version: VERSION,
            status: state.status,
            completedProfiles: state.cursor,
            expectedProfiles:
              EXPECTED_PROFILE_COUNT,
            remainingProfiles:
              EXPECTED_PROFILE_COUNT - state.cursor,
            processedThisRun: processed.map(function (item) {
              return {
                profileId: item.profileId,
                fileName: item.fileName,
                sourceHash: item.sourceHash,
                normalizedRowCount:
                  item.normalizedRowCount,
                configuredCategoryCount:
                  item.configuredCategoryCount,
                matchedCategoryCount:
                  item.matchedCategoryCount,
                ignoredObservationCount:
                  item.ignoredObservationCount,
                ignoredSourceLabelCount:
                  item.ignoredSourceLabelCount,
                unitCompatibilityConversionCount:
                  item.unitCompatibilityConversionCount,
                unitCompatibilityTransformIds:
                  clone_(
                    item.unitCompatibilityTransformIds ||
                    []
                  ),
                issueCount: item.issueCount
              };
            }),
            nextProfileId:
              control.entries[state.cursor].profileId,
            dataPlaneWrites: false
          }
        );
      },
      { lock: true, persistLogs: false }
    );
  }

  function readIndustryState_() {
    var raw = PropertiesService
      .getScriptProperties()
      .getProperty(INDUSTRY_STATE_PROPERTY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (caught) {
      return {
        status: 'INVALID',
        errorCode: 'ALPHA74_GATE7_INDUSTRY_STATE_INVALID',
        errorMessage: caught.message || String(caught)
      };
    }
  }

  function saveIndustryState_(state) {
    state.schemaVersion = INDUSTRY_STATE_SCHEMA;
    state.release = RELEASE;
    state.version = VERSION;
    state.updatedAt = now_();

    var serialized = JSON.stringify(state);
    assert_(
      serialized.length <= MAX_STATE_BYTES,
      'ALPHA74_GATE7_INDUSTRY_STATE_CAPACITY_EXCEEDED',
      'Gate 7 Industry state exceeds the Script Properties capacity contract.',
      {
        bytes: serialized.length,
        maximum: MAX_STATE_BYTES
      }
    );

    PropertiesService
      .getScriptProperties()
      .setProperty(INDUSTRY_STATE_PROPERTY, serialized);

    return state;
  }

  function publicIndustryState_(state) {
    if (!state) return null;
    return {
      status: state.status || '',
      phase: state.phase || '',
      executionId: state.executionId || '',
      permitDigest: state.permitDigest || '',
      operationIds: clone_(state.operationIds || {}),
      loadIds: clone_(state.loadIds || {}),
      rowCount: Number(state.rowCount || 0),
      seriesIds: clone_(state.seriesIds || []),
      baselineSnapshot: clone_(state.baselineSnapshot || null),
      afterLoadSnapshot: clone_(state.afterLoadSnapshot || null),
      afterDuplicateSnapshot:
        clone_(state.afterDuplicateSnapshot || null),
      finalSnapshot: clone_(state.finalSnapshot || null),
      startedAt: state.startedAt || '',
      updatedAt: state.updatedAt || '',
      acceptedAt: state.acceptedAt || '',
      evidenceId: state.evidenceId || '',
      evidenceHash: state.evidenceHash || ''
    };
  }

  function acceptanceApi_() {
    var api = AKORT.IndustryInput &&
      AKORT.IndustryInput.Acceptance;
    assert_(
      api &&
        typeof api.inspect === 'function' &&
        typeof api.submit === 'function' &&
        typeof api.continueLatest === 'function' &&
        typeof api.snapshot === 'function' &&
        typeof api.operationSummary === 'function' &&
        typeof api.permitDigest === 'function',
      'ALPHA74_GATE7_INDUSTRY_ACCEPTANCE_API_MISSING',
      'Gate 7 Industry acceptance API is unavailable.',
      {}
    );
    assert_(
      text_(api.PermitSchema) === INDUSTRY_PERMIT_SCHEMA &&
        text_(api.PermitProperty) === INDUSTRY_PERMIT_PROPERTY,
      'ALPHA74_GATE7_INDUSTRY_PERMIT_CONTRACT_MISMATCH',
      'Gate 7 and Industry Input permit contracts differ.',
      {}
    );
    return api;
  }

  function resultData_(result, code, message) {
    assert_(result && result.ok !== false, code, message, result || {});
    return result.data || {};
  }

  function runtimeFlags_() {
    var settings = AKORT.Config.readSystemSettings();
    var flags = {
      publishEngineEnabled:
        String(settings.PUBLISH_ENGINE_ENABLED).toUpperCase() === 'TRUE',
      aggregateExecutionEnabled:
        String(settings.PUBLISH_AGGREGATE_EXECUTION_ENABLED).toUpperCase() === 'TRUE',
      regularPipelineEnabled:
        String(settings.PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED).toUpperCase() === 'TRUE',
      userPipelineEnabled:
        String(settings.PUBLISH_USER_PIPELINE_ENABLED).toUpperCase() === 'TRUE'
    };
    assert_(
      flags.publishEngineEnabled &&
        flags.aggregateExecutionEnabled &&
        flags.regularPipelineEnabled,
      'ALPHA74_GATE7_RUNTIME_FLAGS_NOT_READY',
      'Gate 7 requires the accepted Gate 6 runtime flags.',
      flags
    );
    assert_(
      !flags.userPipelineEnabled,
      'ALPHA74_GATE7_USER_PIPELINE_ALREADY_ENABLED',
      'The general user pipeline must remain disabled throughout Gate 7.',
      flags
    );
    return flags;
  }

  function assertPreviewBoundary_(previewState, control) {
    assert_(
      previewState && previewState.status === 'PREVIEW_ACCEPTED',
      'ALPHA74_GATE7_PREVIEW_NOT_ACCEPTED',
      'Gate 7 Industry acceptance requires the accepted preview matrix.',
      { previewStatus: previewState ? previewState.status : 'NOT_FOUND' }
    );
    assert_(
      previewState.controlFingerprint === control.fingerprint,
      'ALPHA74_GATE7_CONTROL_CHANGED_AFTER_PREVIEW',
      'Gate 7 control inventory changed after preview acceptance.',
      {}
    );
    verifyImmutableFiles_(previewState.items || []);
  }

  function operationSummary_(operationId) {
    return resultData_(
      acceptanceApi_().operationSummary(operationId),
      'ALPHA74_GATE7_OPERATION_SUMMARY_FAILED',
      'Gate 7 could not load the Industry operation summary.'
    );
  }

  function operationLoadRows_(operationId) {
    var summary = operationSummary_(operationId);
    assert_(
      summary.operationType === 'RAW_LOAD_V4' &&
        Array.isArray(summary.rows) &&
        summary.rows.length,
      'ALPHA74_GATE7_LOAD_OPERATION_INVALID',
      'Gate 7 Industry load operation has no exact submitted rows.',
      summary
    );
    return summary;
  }

  function runOperationStep_(operationId, expectedType) {
    var before = operationSummary_(operationId);
    assert_(
      before.operationType === expectedType,
      'ALPHA74_GATE7_OPERATION_TYPE_MISMATCH',
      'Gate 7 operation type differs from the expected phase.',
      { expectedType: expectedType, actualType: before.operationType }
    );
    if (TERMINAL_FAILURES.indexOf(before.status) >= 0) {
      throw error_(
        before.errorCode || 'ALPHA74_GATE7_OPERATION_FAILED',
        before.errorMessage || 'Gate 7 operation failed.',
        before
      );
    }
    if (before.status === 'SUCCESS') return before;

    var resumed = AKORT.OperationEngine.resume(
      operationId,
      {
        maxSteps: 50,
        executionBudgetMs: 260000,
        minRemainingMs: 15000
      }
    );
    assert_(
      resumed && resumed.ok !== false,
      resumed && resumed.code || 'ALPHA74_GATE7_OPERATION_RESUME_FAILED',
      resumed && resumed.message || 'Gate 7 operation could not be resumed.',
      resumed || {}
    );

    var after = operationSummary_(operationId);
    if (TERMINAL_FAILURES.indexOf(after.status) >= 0) {
      throw error_(
        after.errorCode || 'ALPHA74_GATE7_OPERATION_FAILED',
        after.errorMessage || 'Gate 7 operation failed.',
        after
      );
    }
    return after;
  }

  function snapshot_(rows) {
    return resultData_(
      acceptanceApi_().snapshot(rows),
      'ALPHA74_GATE7_INDUSTRY_SNAPSHOT_FAILED',
      'Gate 7 Industry snapshot could not be loaded.'
    );
  }

  function assertSnapshotsEqual_(expected, actual, code, message) {
    assert_(
      expected &&
        actual &&
        text_(expected.rawFingerprint) === text_(actual.rawFingerprint) &&
        text_(expected.publishFingerprint) === text_(actual.publishFingerprint) &&
        Number(expected.publishRows) === Number(actual.publishRows) &&
        Number(expected.publishColumns) === Number(actual.publishColumns),
      code,
      message,
      { expected: expected || null, actual: actual || null }
    );
  }

  function issueIndustryPermit_(previewState, control, inspection) {
    var ready = inspection.readyRows || [];
    var noChanges = inspection.noChangeRows || [];
    assert_(
      ready.length === 1 && noChanges.length === 0,
      'ALPHA74_GATE7_INDUSTRY_ROW_SET_INVALID',
      'Gate 7 requires exactly one changed Industry row and no additional populated rows.',
      {
        readyRows: ready.length,
        noChangeRows: noChanges.length,
        counts: inspection.counts || {}
      }
    );

    var row = ready[0];
    assert_(
      ['INSERT', 'REVISION'].indexOf(text_(row.action)) >= 0 &&
        Number(row.rowNumber || 0) >= 6 &&
        text_(row.seriesId) &&
        text_(row.fingerprint) &&
        row.normalized,
      'ALPHA74_GATE7_INDUSTRY_ROW_INVALID',
      'Gate 7 Industry row is not eligible for controlled acceptance.',
      row
    );

    var executionId =
      'G7I_' +
      AKORT.Core.sha256(
        [now_(), previewState.matrixFingerprint, row.seriesId, row.fingerprint].join('|')
      ).slice(0, 24).toUpperCase();

    var permit = {
      schemaVersion: INDUSTRY_PERMIT_SCHEMA,
      release: RELEASE,
      executionId: executionId,
      controlFingerprint: control.fingerprint,
      matrixFingerprint: previewState.matrixFingerprint,
      issuedAt: now_(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      rows: [{
        rowNumber: Number(row.rowNumber),
        seriesId: text_(row.seriesId),
        fingerprint: text_(row.fingerprint),
        action: text_(row.action)
      }],
      contentHash: AKORT.Core.sha256(
        AKORT.Core.canonicalJson([row.normalized])
      ),
      status: 'OPEN',
      operationId: '',
      loadId: ''
    };

    permit.permitDigest = acceptanceApi_().permitDigest(permit);
    PropertiesService
      .getScriptProperties()
      .setProperty(INDUSTRY_PERMIT_PROPERTY, JSON.stringify(permit));

    return {
      permit: permit,
      rows: [row.normalized],
      seriesIds: [text_(row.seriesId)]
    };
  }

  function enqueueDuplicate_(state, rows) {
    var queued = AKORT.OperationEngine.enqueue(
      'RAW_LOAD_V4',
      {
        targetTable: 'RAW_INDUSTRY',
        sourceId: 'GATE7_INDUSTRY_DUPLICATE_' + state.executionId,
        sourceName: 'AKORT Gate 7 Industry duplicate/no-change proof',
        sourceHash: state.contentHash,
        rows: rows
      },
      {
        idempotencyKey: 'ALPHA74_GATE7_DUPLICATE_' + state.executionId,
        priority: 50,
        maxAttempts: 3
      }
    );
    return resultData_(
      queued,
      'ALPHA74_GATE7_DUPLICATE_ENQUEUE_FAILED',
      'Gate 7 duplicate/no-change operation could not be queued.'
    ).operationId;
  }

  function enqueueReversal_(state) {
    var queued = AKORT.OperationEngine.enqueue(
      'RAW_REVERSAL_V4',
      {
        targetLoadId: state.loadIds.load,
        reason: 'Alpha.7.4 Gate 7 controlled Industry rollback ' + state.executionId
      },
      {
        idempotencyKey: 'ALPHA74_GATE7_REVERSAL_' + state.executionId,
        priority: 20,
        maxAttempts: 3
      }
    );
    return resultData_(
      queued,
      'ALPHA74_GATE7_REVERSAL_ENQUEUE_FAILED',
      'Gate 7 Industry reversal could not be queued.'
    ).operationId;
  }

  function readIndustryPermitOptional_() {
    var raw = PropertiesService
      .getScriptProperties()
      .getProperty(INDUSTRY_PERMIT_PROPERTY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (caught) {
      throw error_(
        'ALPHA74_GATE7_INDUSTRY_PERMIT_INVALID',
        'Stored Gate 7 Industry permit is not valid JSON.',
        { message: caught.message || String(caught) }
      );
    }
  }

  function adoptIndustryLoadBinding_(state) {
    if (!state || text_(state.phase) !== 'RUN_LOAD') return state;
    if (text_(state.operationIds && state.operationIds.load)) {
      return state;
    }

    var permit = readIndustryPermitOptional_();
    if (!permit ||
        text_(permit.executionId) !== text_(state.executionId) ||
        text_(permit.permitDigest) !== text_(state.permitDigest)) {
      return state;
    }

    if (text_(permit.operationId)) {
      state.operationIds = state.operationIds || {};
      state.operationIds.load = text_(permit.operationId);
    }
    if (text_(permit.loadId)) {
      state.loadIds = state.loadIds || {};
      state.loadIds.load = text_(permit.loadId);
    }

    return state;
  }

  function startIndustry() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_START_INDUSTRY',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        runtimeFlags_();

        var existing = readIndustryState_();
        if (existing && existing.status === 'INVALID') {
          throw error_(existing.errorCode, existing.errorMessage, existing);
        }
        if (existing) {
          if (existing.status === 'GATE7_ACCEPTED' ||
              existing.status === 'INDUSTRY_ACCEPTED') {
            return AKORT.Result.success(
              'Gate 7 Industry acceptance is already terminal.',
              publicIndustryState_(existing)
            );
          }
          return AKORT.Result.paused(
            'Gate 7 Industry acceptance is already in progress.',
            publicIndustryState_(existing)
          );
        }

        var previewState = readState_();
        var control = readControlInventory_({
          required: true,
          requireFiles: true
        });
        assertPreviewBoundary_(previewState, control);

        var inspection = resultData_(
          acceptanceApi_().inspect(),
          'ALPHA74_GATE7_INDUSTRY_INSPECTION_FAILED',
          'Gate 7 Industry form inspection failed.'
        );
        var issued = issueIndustryPermit_(previewState, control, inspection);
        var baseline = snapshot_(issued.rows);

        var state = {
          schemaVersion: INDUSTRY_STATE_SCHEMA,
          release: RELEASE,
          version: VERSION,
          status: 'INDUSTRY_RUNNING',
          phase: 'RUN_LOAD',
          executionId: issued.permit.executionId,
          permitDigest: issued.permit.permitDigest,
          controlFingerprint: control.fingerprint,
          matrixFingerprint: previewState.matrixFingerprint,
          contentHash: issued.permit.contentHash,
          rowCount: issued.rows.length,
          seriesIds: issued.seriesIds,
          operationIds: { load: '', duplicate: '', reversal: '' },
          loadIds: { load: '', duplicate: '', reversal: '' },
          baselineSnapshot: baseline,
          afterLoadSnapshot: null,
          afterDuplicateSnapshot: null,
          finalSnapshot: null,
          startedAt: now_(),
          updatedAt: now_(),
          acceptedAt: '',
          evidenceId: '',
          evidenceHash: ''
        };
        saveIndustryState_(state);

        var submittedData = resultData_(
          acceptanceApi_().submit({
            executionId: state.executionId,
            permitDigest: state.permitDigest
          }),
          'ALPHA74_GATE7_INDUSTRY_SUBMIT_FAILED',
          'Gate 7 Industry load could not be submitted.'
        );

        state.operationIds.load = text_(submittedData.operationId);
        assert_(
          state.operationIds.load,
          'ALPHA74_GATE7_INDUSTRY_OPERATION_MISSING',
          'Gate 7 Industry submission returned no operation ID.',
          submittedData
        );

        if (text_(submittedData.loadId)) {
          state.loadIds.load = text_(submittedData.loadId);
          var loadSummary = operationLoadRows_(state.operationIds.load);
          state.afterLoadSnapshot = snapshot_(loadSummary.rows);
          state.phase = 'ENQUEUE_DUPLICATE';
        }

        saveIndustryState_(state);
        return AKORT.Result.paused(
          'Gate 7 Industry acceptance started.',
          publicIndustryState_(state)
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function continueIndustry() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_CONTINUE_INDUSTRY',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        runtimeFlags_();

        var previewState = readState_();
        var control = readControlInventory_({
          required: true,
          requireFiles: true
        });
        assertPreviewBoundary_(previewState, control);

        var state = readIndustryState_();
        assert_(
          state && state.status !== 'INVALID',
          'ALPHA74_GATE7_INDUSTRY_STATE_MISSING',
          'Gate 7 Industry acceptance has not been started.',
          state || {}
        );
        assert_(
          state.controlFingerprint === control.fingerprint &&
            state.matrixFingerprint === previewState.matrixFingerprint,
          'ALPHA74_GATE7_INDUSTRY_BOUNDARY_CHANGED',
          'Gate 7 Industry state no longer matches the accepted preview boundary.',
          {}
        );

        state = adoptIndustryLoadBinding_(state);
        saveIndustryState_(state);

        if (state.status === 'GATE7_ACCEPTED' ||
            state.status === 'INDUSTRY_ACCEPTED') {
          return AKORT.Result.success(
            'Gate 7 Industry acceptance is terminal.',
            publicIndustryState_(state)
          );
        }

        if (state.phase === 'RUN_LOAD') {
          if (!text_(state.operationIds && state.operationIds.load)) {
            var recoveredSubmission = resultData_(
              acceptanceApi_().submit({
                executionId: state.executionId,
                permitDigest: state.permitDigest
              }),
              'ALPHA74_GATE7_INDUSTRY_SUBMIT_RECOVERY_FAILED',
              'Gate 7 Industry submission could not be recovered.'
            );

            state.operationIds.load =
              text_(recoveredSubmission.operationId);
            if (text_(recoveredSubmission.loadId)) {
              state.loadIds.load =
                text_(recoveredSubmission.loadId);
            }
            saveIndustryState_(state);

            return AKORT.Result.paused(
              'Gate 7 Industry submission binding recovered.',
              publicIndustryState_(state)
            );
          }

          var continuedData = resultData_(
            acceptanceApi_().continueLatest({
              executionId: state.executionId,
              permitDigest: state.permitDigest
            }),
            'ALPHA74_GATE7_INDUSTRY_CONTINUE_FAILED',
            'Gate 7 Industry load continuation failed.'
          );

          if (text_(continuedData.loadId)) {
            state.loadIds.load = text_(continuedData.loadId);
            var loadSummary = operationLoadRows_(state.operationIds.load);
            state.afterLoadSnapshot = snapshot_(loadSummary.rows);
            state.phase = 'ENQUEUE_DUPLICATE';
          }
          saveIndustryState_(state);
          return AKORT.Result.paused(
            'Gate 7 Industry load phase checkpoint saved.',
            publicIndustryState_(state)
          );
        }

        if (state.phase === 'ENQUEUE_DUPLICATE') {
          var original = operationLoadRows_(state.operationIds.load);
          assert_(
            AKORT.Core.sha256(
              AKORT.Core.canonicalJson(original.rows)
            ) === state.contentHash,
            'ALPHA74_GATE7_INDUSTRY_ROWS_CHANGED',
            'Gate 7 Industry submitted rows differ from the permit content hash.',
            {}
          );

          var beforeDuplicate = snapshot_(original.rows);
          assertSnapshotsEqual_(
            state.afterLoadSnapshot,
            beforeDuplicate,
            'ALPHA74_GATE7_DUPLICATE_BEFORE_DRIFT',
            'Industry state changed before duplicate/no-change proof.'
          );

          state.operationIds.duplicate =
            enqueueDuplicate_(state, original.rows);
          state.phase = 'RUN_DUPLICATE';
          saveIndustryState_(state);
          return AKORT.Result.paused(
            'Gate 7 duplicate/no-change operation queued.',
            publicIndustryState_(state)
          );
        }

        if (state.phase === 'RUN_DUPLICATE') {
          var duplicate = runOperationStep_(
            state.operationIds.duplicate,
            'RAW_LOAD_V4'
          );
          if (duplicate.status !== 'SUCCESS') {
            saveIndustryState_(state);
            return AKORT.Result.paused(
              'Gate 7 duplicate/no-change operation is not terminal.',
              publicIndustryState_(state)
            );
          }

          state.loadIds.duplicate = text_(duplicate.loadId);
          var originalRows =
            operationLoadRows_(state.operationIds.load).rows;
          state.afterDuplicateSnapshot = snapshot_(originalRows);
          assertSnapshotsEqual_(
            state.afterLoadSnapshot,
            state.afterDuplicateSnapshot,
            'ALPHA74_GATE7_DUPLICATE_CHANGED_STATE',
            'Duplicate Industry submission changed RAW latest or Publish state.'
          );

          state.phase = 'ENQUEUE_REVERSAL';
          saveIndustryState_(state);
          return AKORT.Result.paused(
            'Gate 7 duplicate/no-change proof accepted.',
            publicIndustryState_(state)
          );
        }

        if (state.phase === 'ENQUEUE_REVERSAL') {
          assert_(
            text_(state.loadIds.load),
            'ALPHA74_GATE7_LOAD_ID_MISSING',
            'Gate 7 cannot enqueue reversal without the accepted Industry load ID.',
            {}
          );
          state.operationIds.reversal = enqueueReversal_(state);
          state.phase = 'RUN_REVERSAL';
          saveIndustryState_(state);
          return AKORT.Result.paused(
            'Gate 7 Industry reversal queued.',
            publicIndustryState_(state)
          );
        }

        if (state.phase === 'RUN_REVERSAL') {
          var reversal = runOperationStep_(
            state.operationIds.reversal,
            'RAW_REVERSAL_V4'
          );
          if (reversal.status !== 'SUCCESS') {
            saveIndustryState_(state);
            return AKORT.Result.paused(
              'Gate 7 Industry reversal is not terminal.',
              publicIndustryState_(state)
            );
          }

          state.loadIds.reversal = text_(reversal.loadId);
          var rows = operationLoadRows_(state.operationIds.load).rows;
          state.finalSnapshot = snapshot_(rows);
          assertSnapshotsEqual_(
            state.baselineSnapshot,
            state.finalSnapshot,
            'ALPHA74_GATE7_ROLLBACK_NOT_EXACT',
            'Gate 7 Industry reversal did not restore the exact baseline.'
          );

          var audit = AKORT.RawStore.auditLoad(state.loadIds.load);
          assert_(
            audit &&
              text_(audit.loadStatus) === 'REVERSED' &&
              Number(audit.staged || 0) === Number(audit.committedStages || 0),
            'ALPHA74_GATE7_RAW_REVERSAL_AUDIT_FAILED',
            'Gate 7 Industry load is not in the exact REVERSED lifecycle state.',
            audit || {}
          );

          state.status = 'INDUSTRY_ACCEPTED';
          state.phase = 'READY_TO_FINALIZE';
          state.acceptedAt = now_();
          state.rawAudit = {
            loadId: text_(audit.loadId),
            loadStatus: text_(audit.loadStatus),
            staged: Number(audit.staged || 0),
            committedStages: Number(audit.committedStages || 0),
            expectedCommitted: Number(audit.expectedCommitted || 0),
            latestConflictCount: (audit.latestConflicts || []).length
          };
          saveIndustryState_(state);

          return AKORT.Result.success(
            'Gate 7 Industry load, duplicate/no-change and exact reversal accepted.',
            publicIndustryState_(state)
          );
        }

        throw error_(
          'ALPHA74_GATE7_INDUSTRY_PHASE_INVALID',
          'Gate 7 Industry state contains an unsupported phase.',
          { phase: state.phase || '' }
        );
      },
      { lock: false, persistLogs: true }
    );
  }

  function writeEvidence_(evidence) {
    var acceptedAt = text_(evidence.acceptedAt);
    var core = clone_(evidence);
    delete core.evidenceId;
    delete core.evidenceHash;

    var evidenceHash = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(core)
    );
    var evidenceId =
      'G7E_' + evidenceHash.slice(0, 24).toUpperCase();

    evidence.evidenceId = evidenceId;
    evidence.evidenceHash = evidenceHash;

    var evidenceJson = JSON.stringify(evidence);
    assert_(
      evidenceJson.length < 45000,
      'ALPHA74_GATE7_EVIDENCE_CELL_CAPACITY_EXCEEDED',
      'Gate 7 evidence exceeds the Google Sheets cell capacity guard.',
      { characters: evidenceJson.length }
    );

    var ensured = AKORT.Core.Sheets.ensure(
      dwh_(),
      EVIDENCE_SHEET,
      EVIDENCE_HEADERS.slice()
    );
    var existing = AKORT.Core.Sheets
      .readObjects(ensured.sheet)
      .filter(function (row) {
        return text_(row.evidence_id) === evidenceId;
      });

    if (!existing.length) {
      AKORT.Core.Sheets.appendObject(
        ensured.sheet,
        EVIDENCE_HEADERS.slice(),
        {
          evidence_id: evidenceId,
          accepted_at: acceptedAt,
          evidence_hash: evidenceHash,
          evidence_json: evidenceJson,
          release_version: RELEASE
        }
      );
    }

    return {
      evidenceId: evidenceId,
      evidenceHash: evidenceHash
    };
  }

  function finalize() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_FINALIZE',
      function () {
        AKORT.EnvironmentGuard.assertDev();
        var flags = runtimeFlags_();

        var previewState = readState_();
        var control = readControlInventory_({
          required: true,
          requireFiles: true
        });
        assertPreviewBoundary_(previewState, control);

        var industryState = readIndustryState_();
        assert_(
          industryState && industryState.status !== 'INVALID',
          'ALPHA74_GATE7_INDUSTRY_STATE_MISSING',
          'Gate 7 Industry acceptance state is missing.',
          industryState || {}
        );

        if (industryState.status === 'GATE7_ACCEPTED') {
          return AKORT.Result.success(
            'Alpha.7.4 Gate 7 is already accepted.',
            publicIndustryState_(industryState)
          );
        }

        assert_(
          industryState.status === 'INDUSTRY_ACCEPTED' &&
            industryState.phase === 'READY_TO_FINALIZE',
          'ALPHA74_GATE7_INDUSTRY_NOT_ACCEPTED',
          'Gate 7 cannot finalize before Industry acceptance and exact rollback.',
          publicIndustryState_(industryState)
        );

        var rows = operationLoadRows_(
          industryState.operationIds.load
        ).rows;
        var finalSnapshot = snapshot_(rows);
        assertSnapshotsEqual_(
          industryState.baselineSnapshot,
          finalSnapshot,
          'ALPHA74_GATE7_FINAL_BASELINE_DRIFT',
          'Industry baseline changed before Gate 7 finalization.'
        );

        var scanData = resultData_(
          AKORT.AggregateIntegration.readOnlyContractScan(),
          'ALPHA74_GATE7_FINAL_CONTRACT_SCAN_FAILED',
          'Final read-only aggregate contract scan failed.'
        );

        var acceptedAt = now_();
        var evidence = {
          schemaVersion: EVIDENCE_SCHEMA,
          stateSchemaVersion: STATE_SCHEMA,
          industryStateSchemaVersion: INDUSTRY_STATE_SCHEMA,
          release: RELEASE,
          version: VERSION,
          acceptedAt: acceptedAt,
          control: {
            sheet: CONTROL_SHEET,
            profileCount: EXPECTED_PROFILE_COUNT,
            controlFingerprint: control.fingerprint,
            matrixFingerprint: previewState.matrixFingerprint
          },
          preview: publicState_(previewState),
          industry: publicIndustryState_(industryState),
          runtimeFlags: flags,
          finalContractScan: clone_(scanData),
          generalUserPipelineEnabled: false,
          productionTouched: false
        };

        var written = writeEvidence_(evidence);
        industryState.status = 'GATE7_ACCEPTED';
        industryState.phase = 'SUCCESS';
        industryState.acceptedAt = acceptedAt;
        industryState.finalSnapshot = finalSnapshot;
        industryState.evidenceId = written.evidenceId;
        industryState.evidenceHash = written.evidenceHash;
        saveIndustryState_(industryState);

        PropertiesService
          .getScriptProperties()
          .deleteProperty(INDUSTRY_PERMIT_PROPERTY);

        return AKORT.Result.success(
          'Alpha.7.4 Gate 7 accepted.',
          {
            release: RELEASE,
            version: VERSION,
            evidenceId: written.evidenceId,
            evidenceHash: written.evidenceHash,
            evidenceSheet: EVIDENCE_SHEET,
            previewMatrixFingerprint: previewState.matrixFingerprint,
            industry: publicIndustryState_(industryState),
            finalContractScan: scanData,
            generalUserPipelineEnabled: false,
            productionTouched: false
          }
        );
      },
      { lock: true, persistLogs: true }
    );
  }

  function status() {
    return AKORT.Core.safeRun(
      'ALPHA74_GATE7_STATUS',
      function () {
        AKORT.EnvironmentGuard.assertDev();

        var profileInventory = profiles_();
        var previewState = readState_();
        var industryState = readIndustryState_();
        var controlStatus = {
          installed: false,
          valid: false,
          complete: false,
          fingerprint: '',
          profileCount: 0,
          errorCode: '',
          errorMessage: ''
        };

        try {
          var control = readControlInventory_({
            required: false,
            requireFiles: false
          });
          if (control) {
            controlStatus.installed = true;
            controlStatus.valid = true;
            controlStatus.profileCount = control.entries.length;
            controlStatus.complete = control.entries.every(function (entry) {
              return Boolean(entry.fileId);
            });
            controlStatus.fingerprint = control.fingerprint;
          }
        } catch (caught) {
          controlStatus.installed = true;
          controlStatus.valid = false;
          controlStatus.errorCode =
            caught.code || 'ALPHA74_GATE7_CONTROL_INVALID';
          controlStatus.errorMessage =
            caught.message || String(caught);
        }

        var industry = AKORT.IndustryInput.status();
        var industryData =
          industry && industry.ok && industry.data
            ? industry.data
            : {};

        var previewAccepted =
          previewState && previewState.status === 'PREVIEW_ACCEPTED';
        var controlMatchesAccepted =
          previewAccepted &&
          controlStatus.valid &&
          previewState.controlFingerprint === controlStatus.fingerprint;
        var industryAccepted =
          industryState &&
          (
            industryState.status === 'INDUSTRY_ACCEPTED' ||
            industryState.status === 'GATE7_ACCEPTED'
          );
        var gate7Accepted =
          industryState && industryState.status === 'GATE7_ACCEPTED';

        return AKORT.Result.success(
          'Alpha.7.4 Gate 7 status loaded.',
          {
            release: RELEASE,
            version: VERSION,
            evidenceSchemaVersion: EVIDENCE_SCHEMA,
            stateSchemaVersion: STATE_SCHEMA,
            industryStateSchemaVersion: INDUSTRY_STATE_SCHEMA,
            controlSheet: CONTROL_SHEET,
            evidenceSheet: EVIDENCE_SHEET,
            expectedProfileCount: EXPECTED_PROFILE_COUNT,
            profileCount: profileInventory.length,
            profileInventoryReady:
              profileInventory.length === EXPECTED_PROFILE_COUNT,
            control: controlStatus,
            previewAccepted: Boolean(previewAccepted),
            controlMatchesAccepted: Boolean(controlMatchesAccepted),
            industryInputInstalled: Boolean(industryData.installed),
            previewState: publicState_(previewState),
            industryState: publicIndustryState_(industryState),
            industryAccepted: Boolean(industryAccepted),
            gate7Accepted: Boolean(gate7Accepted),
            implementationStatus:
              gate7Accepted
                ? 'GATE7_ACCEPTED'
                : !previewAccepted
                  ? 'PREVIEW_RUNNING'
                  : !industryData.installed
                    ? 'READY_TO_INSTALL_INDUSTRY'
                    : industryAccepted
                      ? 'READY_TO_FINALIZE'
                      : industryState
                        ? 'INDUSTRY_ACCEPTANCE_RUNNING'
                        : 'READY_FOR_INDUSTRY_ACCEPTANCE',
            readyToStartIndustry:
              Boolean(
                previewAccepted &&
                controlMatchesAccepted &&
                industryData.installed &&
                !industryState
              ),
            readyToFinalize:
              Boolean(
                industryState &&
                industryState.status === 'INDUSTRY_ACCEPTED'
              ),
            readyToStart:
              Boolean(
                previewAccepted &&
                controlMatchesAccepted &&
                industryData.installed &&
                !industryState
              ),
            dataPlaneWrites: false,
            controlPlaneWrites: false,
            physicalWrites: false
          }
        );
      },
      { lock: false, persistLogs: false }
    );
  }

  return Object.freeze({
    Version: VERSION,
    Release: RELEASE,
    EvidenceSchemaVersion: EVIDENCE_SCHEMA,
    StateSchemaVersion: STATE_SCHEMA,
    IndustryStateSchemaVersion: INDUSTRY_STATE_SCHEMA,
    ExpectedProfileCount: EXPECTED_PROFILE_COUNT,
    ControlSheet: CONTROL_SHEET,
    ControlHeaders: CONTROL_HEADERS.slice(),
    EvidenceSheet: EVIDENCE_SHEET,
    install: install,
    status: status,
    previewMatrix: previewMatrix,
    startIndustry: startIndustry,
    continueIndustry: continueIndustry,
    finalize: finalize,
    Test: Object.freeze({
      parseFileId: parseFileId_,
      controlFingerprint: controlFingerprint_,
      stablePreviewItem: stablePreviewItem_,
      compactPreviewItem: compactPreviewItem_,
      expandPreviewItem: expandPreviewItem_,
      legacyPreviewContractMatches:
        legacyPreviewContractMatches_,
      adoptIndustryLoadBinding:
        adoptIndustryLoadBinding_,
      readState: readState_,
      readIndustryState: readIndustryState_,
      publicIndustryState: publicIndustryState_
    })
  });
})();

