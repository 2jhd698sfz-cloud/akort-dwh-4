var AKORT = typeof AKORT !== 'undefined' ? AKORT : {};

/**
 * Beta.2.3 candidate-r5: Russian Control Center presentation, materialized
 * user-data freshness read model, and allowlisted operator actions.
 *
 * REUSE-FIRST / GAP-ONLY:
 * - system overview reuses Beta.2.1;
 * - backup reuses Beta.1.1;
 * - logical rollback reuses Beta.1.2;
 * - operational guards and execution reuse Beta.1.4 and Operation Engine;
 * - Full Audit reuses Beta.1.6;
 * - no queue, executor, dispatcher, parser, RAW store, Publish path,
 *   aggregate methodology, backup engine, audit engine or rollback engine is
 *   created here.
 */
AKORT.Beta23ControlCenterOperatorActions = (function () {
  var PACKAGE_VERSION = '4.0.0-beta.2.3.5';
  var CONTRACT_VERSION = '4.0-beta23-control-center-operator-actions-2';
  var BASE_RELEASE = '4.0.0-alpha.7.4.42';
  var BASE_COMMIT = '10430fe3a51b7b4b007f9442684fc0aed85f49e5';

  var ACTIONS_PROPERTY = 'AKORT_BETA23_OPERATOR_ACTIONS_ENABLED';
  var ROLES_PROPERTY = 'AKORT_BETA23_ROLE_ASSIGNMENTS';
  var BETA22_GATE_PROPERTY = 'AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED';
  var CONFIRMATION_SECRET_PROPERTY = 'AKORT_BETA22_CONFIRMATION_SECRET';
  var FRESHNESS_TABLE = 'USER_DATA_FRESHNESS';
  var FRESHNESS_STAGE_TABLE = 'USER_DATA_FRESHNESS_STAGE';
  var FRESHNESS_LOCK_TIMEOUT_MS = 30000;
  var FRESHNESS_CONFIRMATION_SCHEMA = '4.0-beta23-rollback-binding-1';
  var CONFIRMATION_TTL_MS = 10 * 60 * 1000;
  var MAX_LOAD_SEARCH_ROWS = 100;
  var DEFAULT_LOAD_SEARCH_ROWS = 50;
  var MAX_LOAD_SOURCE_ROWS = 2000;
  var MAX_PUBLISH_ROWS = 50000;
  var MAX_FRESHNESS_MEMBERS = 1000;
  var MAX_MAPPING_ROWS = 10000;
  var BETA22_OPERATION_BINDING_SCHEMA = '4.0-beta22-operation-binding-1';

  var FRESHNESS_HEADERS = Object.freeze([
    'freshness_member_id', 'display_family_id', 'dataset_code', 'profile_id',
    'series_id', 'indicator_code', 'indicator_name_ru', 'source_name_ru',
    'frequency', 'canonical_period_key', 'period_start', 'period_end',
    'period_label_ru', 'latest_load_id', 'latest_operation_id',
    'latest_loaded_at', 'quality_status', 'freshness_status', 'issue_count',
    'observed_at', 'snapshot_fingerprint', 'release_version'
  ]);

  var ROLE_RANK = Object.freeze({ VIEWER: 1, OPERATOR: 2, ADMIN: 3 });
  var TERMINAL = Object.freeze({
    SUCCESS: true, FAILED: true, FAILED_REQUIRES_REVIEW: true,
    DEAD_LETTER: true, CANCELLED: true
  });
  var CONTINUABLE = Object.freeze({
    QUEUED: true, PAUSED: true, RETRY_PENDING: true
  });
  var ALLOWED_OPERATION_TYPES = Object.freeze({
    BETA11_PAIRED_BACKUP: 'OPERATOR',
    FULL_AUDIT_V4: 'OPERATOR',
    SOURCE_FILE_LOAD_V4: 'OPERATOR',
    RAW_LOAD_V4: 'OPERATOR',
    RAW_REVERSAL_V4: 'ADMIN'
  });

  var REQUIRED_DEPENDENCIES = Object.freeze([
    'AKORT.Config.readSystemSettings',
    'AKORT.Beta21ReadOnlyControlCenter.status',
    'AKORT.Beta21ReadOnlyControlCenter.Test.accessStatus',
    'AKORT.Beta11PairedBackup.backupNow',
    'AKORT.Beta11PairedBackup.status',
    'AKORT.Beta12RollbackFacade.preview',
    'AKORT.Beta12RollbackFacade.submit',
    'AKORT.Beta12RollbackFacade.status',
    'AKORT.Beta14OperationalHardening.status',
    'AKORT.Beta15CompactObservability.status',
    'AKORT.Beta16FullAuditRetention.submit',
    'AKORT.Beta16OperatorFacade.statusLatest',
    'AKORT.Beta16OperatorFacade.continueLatest',
    'AKORT.OperationEngine.status',
    'AKORT.OperationEngine.resume',
    'AKORT.OperationEngine.requestStop',
    'AKORT.RawStore.auditLoad',
    'Utilities.computeHmacSha256Signature',
    'LockService.getScriptLock'
  ]);

  var RU = Object.freeze({
    statuses: Object.freeze({
      HEALTHY: 'Система работает', CURRENT: 'Актуально', SUCCESS: 'Завершено',
      PASS: 'Проверка пройдена', READY: 'Готово', OK: 'В норме',
      WARNING: 'Требует внимания', ATTENTION_REQUIRED: 'Требует внимания',
      STALE: 'Данные устарели', ERROR: 'Ошибка', CRITICAL: 'Критическая ошибка',
      FAILED: 'Завершено с ошибкой', FAILED_REQUIRES_REVIEW: 'Требуется ручная проверка',
      DEAD_LETTER: 'Остановлено после повторных ошибок', CANCELLED: 'Отменено',
      QUEUED: 'Ожидает выполнения', RUNNING: 'Выполняется', PAUSED: 'Операция приостановлена',
      RETRY_PENDING: 'Ожидает повторной попытки', NOT_APPLICABLE: 'Не применяется',
      NOT_INITIALIZED: 'Ещё не сформировано', NO_CHANGE: 'Изменений нет',
      UNKNOWN: 'Требуется техническая проверка', GOOD: 'В норме',
      PERIOD_UNKNOWN: 'Период не определён'
    }),
    phases: Object.freeze({
      DISCOVER: 'Проверяется источник', VALIDATE: 'Проверяется структура и период',
      PARSE: 'Данные преобразуются в утверждённый формат', STAGE: 'Данные подготавливаются к записи',
      COMMIT_RAW: 'Фиксируется версионное состояние исходных данных',
      UPDATE_PUBLISH: 'Обновляются опубликованные данные',
      PREPARING_AGGREGATE_IMPACT: 'Определяется влияние на расчётные показатели',
      MATERIALIZING_AGGREGATE_INPUTS: 'Подготавливаются входные данные расчёта',
      CALCULATING_AGGREGATE_SLICES: 'Пересчитываются затронутые показатели',
      STAGING_AGGREGATE_ROWS: 'Результаты расчёта подготавливаются к публикации',
      UPDATING_AGGREGATES: 'Обновляются расчётные показатели',
      UPDATING_AGGREGATE_LATEST: 'Обновляется признак последнего периода',
      RECONCILING_AGGREGATES: 'Проверяется согласованность расчётных данных',
      UPDATE_STATUS: 'Обновляется служебный статус', QUICK_AUDIT: 'Выполняется быстрая проверка',
      FINALIZING: 'Завершается операция', SUCCESS: 'Операция завершена'
    }),
    operationTypes: Object.freeze({
      BETA11_PAIRED_BACKUP: 'Резервное копирование',
      FULL_AUDIT_V4: 'Полная проверка системы',
      SOURCE_FILE_LOAD_V4: 'Загрузка файла', RAW_LOAD_V4: 'Загрузка отраслевых данных',
      RAW_REVERSAL_V4: 'Откат загрузки'
    }),
    severities: Object.freeze({
      INFO: 'Информация', WARNING: 'Предупреждение', ERROR: 'Ошибка', CRITICAL: 'Критическая ошибка'
    }),
    nextActions: Object.freeze({
      NONE: 'Действий не требуется', WAIT: 'Дождитесь завершения операции',
      CHECK_STATUS: 'Обновите статус', CONTINUE: 'Продолжите операцию',
      REVIEW_OPERATION: 'Откройте технические сведения и проверьте операцию',
      MANUAL_REVIEW: 'Передайте операцию на ручную проверку',
      RECOVERY_REVIEW: 'Проверьте возможность безопасного восстановления',
      DEAD_LETTER_REVIEW: 'Требуется техническая проверка остановленной операции',
      RUN_OR_RESUBMIT: 'Повторите подтверждённое действие',
      RESUBMIT_SAME_CONFIRMED_REQUEST: 'Повторите то же подтверждённое действие',
      WAIT_ACTIVE_LEASE: 'Дождитесь завершения текущего шага',
      REVIEW_WEB_APP_ACCESS: 'Проверьте доступ к Центру управления',
      DISABLE_USER_PIPELINE: 'Отключите пользовательский pipeline',
      WAIT_FOR_AUTHORIZED_WRITE_GATE: 'Дождитесь разрешения контролируемых действий'
    }),
    errors: Object.freeze({
      BETA23_ACCESS_DENIED: 'Доступ запрещён.',
      BETA23_ROLE_REQUIRED: 'Для этого действия недостаточно прав.',
      BETA23_ACTIONS_DISABLED: 'Операторские действия сейчас заблокированы.',
      BETA23_BETA22_GATE_MUST_BE_FALSE: 'Сначала закройте контролируемый контур загрузки Beta.2.2.',
      BETA23_USER_PIPELINE_MUST_BE_FALSE: 'Пользовательский pipeline должен оставаться выключенным.',
      BETA23_ACTIVE_OPERATION_BLOCKS_ACTION: 'Сначала завершите текущую операцию.',
      BETA23_FRESHNESS_NOT_INITIALIZED: 'Сведения об актуальности ещё не сформированы.',
      BETA23_FRESHNESS_SCHEMA_MISMATCH: 'Структура сведений об актуальности изменена. Требуется техническая проверка.',
      BETA23_ROLLBACK_CONFIRMATION_INVALID: 'Подтверждение отката устарело или не соответствует текущему состоянию.',
      BETA23_OPERATION_NOT_ALLOWED: 'Эта операция недоступна через пользовательский интерфейс.',
      BETA23_OPERATION_CONTINUE_NOT_ALLOWED: 'Операцию нельзя продолжить в текущем состоянии.',
      BETA23_OPERATION_RETRY_NOT_ALLOWED: 'Автоматический повтор для этого состояния запрещён.',
      BETA23_LOAD_SEARCH_INVALID: 'Проверьте параметры поиска загрузок.'
    })
  });

  var DISPLAY_FAMILIES = Object.freeze({
    AKORT_WEEKLY_PRICES: Object.freeze({ titleRu: 'Цены АКОРТ, недельные', order: 10 }),
    ROSSTAT_WEEKLY_INDICATORS: Object.freeze({ titleRu: 'Показатели Росстата, недельные', order: 20 }),
    AKORT_MONTHLY_PRICES: Object.freeze({ titleRu: 'Цены АКОРТ, месячные', order: 30 }),
    ROSSTAT_MONTHLY_RETAIL: Object.freeze({ titleRu: 'Розничные показатели Росстата, месячные', order: 40 }),
    ROSSTAT_MONTHLY_PURCHASE: Object.freeze({ titleRu: 'Цены приобретения Росстата, месячные', order: 50 }),
    ROSSTAT_MONTHLY_PRODUCER: Object.freeze({ titleRu: 'Цены производителей Росстата, месячные', order: 60 }),
    INDUSTRY: Object.freeze({ titleRu: 'Отраслевые показатели', order: 70 })
  });

  /*
   * One profile may expose more than one user-visible indicator (AKORT purchase
   * and retail prices). All twelve accepted parser profiles are represented.
   */
  var PROFILE_MEMBERS = Object.freeze([
    member_('AKORT_WEEKLY_PURCHASE', 'AKORT_WEEKLY_PRICES', 'AKORT_WEEKLY_W00', 'AKORT_WEEKLY', 'AKORT_PRICE', 'AKORT_WEEKLY_PURCHASE', 'Закупочные цены', 'АКОРТ', 'WEEKLY', 'закупка', ''),
    member_('AKORT_WEEKLY_RETAIL', 'AKORT_WEEKLY_PRICES', 'AKORT_WEEKLY_W00', 'AKORT_WEEKLY', 'AKORT_PRICE', 'AKORT_WEEKLY_RETAIL', 'Розничные цены', 'АКОРТ', 'WEEKLY', 'розница', ''),
    member_('ROSSTAT_WEEKLY_RETAIL', 'ROSSTAT_WEEKLY_INDICATORS', 'ROSSTAT_WEEKLY_RETAIL_PRICES', 'ROSSTAT_WEEKLY', 'AVG_PRICE', 'ROSSTAT_WEEKLY_RETAIL', 'Розничные цены', 'Росстат', 'WEEKLY', 'розница', ''),
    member_('ROSSTAT_WEEKLY_CPI', 'ROSSTAT_WEEKLY_INDICATORS', 'ROSSTAT_WEEKLY_RETAIL_CPI', 'ROSSTAT_WEEKLY', 'CPI_WEEKLY', 'ROSSTAT_WEEKLY_CPI', 'Индекс потребительских цен', 'Росстат', 'WEEKLY', 'ИПЦ', 'wow'),
    member_('AKORT_MONTHLY_PURCHASE', 'AKORT_MONTHLY_PRICES', 'AKORT_MONTHLY_M00', 'AKORT_MONTHLY', 'AKORT_PRICE', 'AKORT_MONTHLY_PURCHASE', 'Закупочные цены', 'АКОРТ', 'MONTHLY', 'закупка', ''),
    member_('AKORT_MONTHLY_RETAIL', 'AKORT_MONTHLY_PRICES', 'AKORT_MONTHLY_M00', 'AKORT_MONTHLY', 'AKORT_PRICE', 'AKORT_MONTHLY_RETAIL', 'Розничные цены', 'АКОРТ', 'MONTHLY', 'розница', ''),
    member_('ROSSTAT_MONTHLY_RETAIL', 'ROSSTAT_MONTHLY_RETAIL', 'ROSSTAT_MONTHLY_RETAIL_PRICES_M00', 'ROSSTAT_MONTHLY', 'AVG_PRICE', 'ROSSTAT_MONTHLY_RETAIL', 'Розничные цены', 'Росстат', 'MONTHLY', 'розница', ''),
    member_('ROSSTAT_CPI_MONTHLY', 'ROSSTAT_MONTHLY_RETAIL', 'ROSSTAT_MONTHLY_RETAIL_CPI_M00', 'ROSSTAT_MONTHLY', 'CPI_MONTHLY', 'ROSSTAT_CPI_MONTHLY', 'Индекс потребительских цен', 'Росстат', 'MONTHLY', 'ИПЦ', ''),
    member_('ROSSTAT_PURCHASE_INDEX_MONTHLY', 'ROSSTAT_MONTHLY_PURCHASE', 'ROSSTAT_MONTHLY_PURCHASE_INDEX_M00', 'ROSSTAT_MONTHLY', 'PURCHASE_INDEX', 'ROSSTAT_PURCHASE_PRICE_INDEX_MONTHLY', 'Индекс цен приобретения', 'Росстат', 'MONTHLY', 'Индекс цен приобретения', ''),
    member_('ROSSTAT_PURCHASE_PRICE_MONTHLY', 'ROSSTAT_MONTHLY_PURCHASE', 'ROSSTAT_MONTHLY_PURCHASE_PRICES_M00', 'ROSSTAT_MONTHLY', 'PURCHASE_INDEX', 'ROSSTAT_MONTHLY_PURCHASE', 'Цены приобретения', 'Росстат', 'MONTHLY', 'закупка', ''),
    member_('ROSSTAT_PPI_INDUSTRY_MONTHLY', 'ROSSTAT_MONTHLY_PRODUCER', 'ROSSTAT_MONTHLY_PPI_INDUSTRY_M00', 'ROSSTAT_MONTHLY', 'PPI_INDUSTRIAL', 'ROSSTAT_PPI_MONTHLY', 'Индекс цен производителей промышленности', 'Росстат', 'MONTHLY', 'Индекс цен производителей', ''),
    member_('ROSSTAT_PPI_AGRICULTURE_MONTHLY', 'ROSSTAT_MONTHLY_PRODUCER', 'ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00', 'ROSSTAT_MONTHLY', 'PPI_AGRI', 'ROSSTAT_PPI_MONTHLY', 'Индекс цен производителей сельского хозяйства', 'Росстат', 'MONTHLY', 'Индекс цен производителей', ''),
    member_('ROSSTAT_PRODUCER_PRICE_INDUSTRY_MONTHLY', 'ROSSTAT_MONTHLY_PRODUCER', 'ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00', 'ROSSTAT_MONTHLY', 'PPI_INDUSTRIAL', 'ROSSTAT_MONTHLY_PRODUCER', 'Цены производителей промышленности', 'Росстат', 'MONTHLY', 'производитель', ''),
    member_('ROSSTAT_PRODUCER_PRICE_AGRICULTURE_MONTHLY', 'ROSSTAT_MONTHLY_PRODUCER', 'ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00', 'ROSSTAT_MONTHLY', 'PPI_AGRI', 'ROSSTAT_MONTHLY_PRODUCER', 'Цены производителей сельского хозяйства', 'Росстат', 'MONTHLY', 'производитель', '')
  ]);

  var PROFILE_LABELS_RU = Object.freeze({
    AKORT_WEEKLY_W00: 'Недельные закупочные и розничные цены АКОРТ',
    ROSSTAT_WEEKLY_RETAIL_PRICES: 'Недельные розничные цены Росстата',
    ROSSTAT_WEEKLY_RETAIL_CPI: 'Недельный индекс потребительских цен Росстата',
    AKORT_MONTHLY_M00: 'Месячные закупочные и розничные цены АКОРТ',
    ROSSTAT_MONTHLY_RETAIL_PRICES_M00: 'Месячные розничные цены Росстата',
    ROSSTAT_MONTHLY_RETAIL_CPI_M00: 'Месячный индекс потребительских цен Росстата',
    ROSSTAT_MONTHLY_PURCHASE_INDEX_M00: 'Месячный индекс цен приобретения Росстата',
    ROSSTAT_MONTHLY_PURCHASE_PRICES_M00: 'Месячные цены приобретения Росстата',
    ROSSTAT_MONTHLY_PPI_INDUSTRY_M00: 'Индекс цен производителей промышленности Росстата',
    ROSSTAT_MONTHLY_PPI_AGRICULTURE_M00: 'Индекс цен производителей сельского хозяйства Росстата',
    ROSSTAT_MONTHLY_PRODUCER_PRICES_INDUSTRY_M00: 'Цены производителей промышленности Росстата',
    ROSSTAT_MONTHLY_PRODUCER_PRICES_AGRICULTURE_M00: 'Цены производителей сельского хозяйства Росстата'
  });

  function member_(memberId, familyId, profileId, datasetCode, sourceFileType,
      indicatorCode, indicatorNameRu, sourceNameRu, frequency, valueType, indexType) {
    return Object.freeze({
      memberId: memberId, displayFamilyId: familyId, profileId: profileId,
      datasetCode: datasetCode, sourceFileType: sourceFileType,
      indicatorCode: indicatorCode, indicatorNameRu: indicatorNameRu,
      sourceNameRu: sourceNameRu, frequency: frequency,
      valueType: valueType, indexType: indexType
    });
  }

  function profileLabelRu_(profileId) {
    return PROFILE_LABELS_RU[text_(profileId)] || 'Тип исходных данных не определён';
  }

  function profileFrequency_(profileId) {
    for (var i = 0; i < PROFILE_MEMBERS.length; i += 1) {
      if (PROFILE_MEMBERS[i].profileId === text_(profileId)) return PROFILE_MEMBERS[i].frequency;
    }
    return '';
  }

  function periodLabelFromCanonical_(canonical, profileId) {
    var frequency = profileFrequency_(profileId);
    if (!frequency && /^\d{4}-W\d{2}$/.test(text_(canonical))) frequency = 'WEEKLY';
    if (!frequency && /^\d{4}-\d{2}$/.test(text_(canonical))) frequency = 'MONTHLY';
    return periodLabelRu_(frequency, canonical);
  }

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

  function norm_(value) {
    return text_(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function dateIso_(value) {
    if (!value) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? '' : value.toISOString();
    }
    var parsed = Date.parse(text_(value));
    return isNaN(parsed) ? text_(value) : new Date(parsed).toISOString();
  }

  function dateKey_(value) {
    var iso = dateIso_(value);
    return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
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
    }).map(function (item) { return item.path; });
    if (missing.length) {
      throw AKORT.Core.error('BETA23_ACCEPTED_DEPENDENCY_MISSING',
        'Required accepted dependencies are unavailable.',
        { missing: missing, retryable: false });
    }
  }

  function assertBase_() {
    AKORT.EnvironmentGuard.assertDev();
    if (AKORT.Release.version !== BASE_RELEASE) {
      throw AKORT.Core.error('BETA23_BASE_RELEASE_MISMATCH',
        'Beta.2.3 requires the accepted Alpha.7.4 runtime.',
        { expected: BASE_RELEASE, actual: AKORT.Release.version, retryable: false });
    }
    assertDependencies_();
  }

  function properties_() {
    return PropertiesService.getScriptProperties();
  }

  function accessStatus_() {
    return clone_(AKORT.Beta21ReadOnlyControlCenter.Test.accessStatus());
  }

  function assertAccess_() {
    var access = accessStatus_();
    if (!access || access.authorized !== true || !text_(access.email)) {
      throw AKORT.Core.error('BETA23_ACCESS_DENIED', 'Access denied.',
        { retryable: false, nextAction: 'REVIEW_WEB_APP_ACCESS' });
    }
    return access;
  }

  function normalizedRole_(value) {
    var role = text_(value).toUpperCase();
    return ROLE_RANK[role] ? role : '';
  }

  function parseRoleAssignments_(raw) {
    raw = text_(raw);
    var result = {};
    if (!raw) return result;
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (caught) {
      throw AKORT.Core.error('BETA23_ROLE_ASSIGNMENTS_INVALID',
        'Role assignments are not valid JSON.', { retryable: false });
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.keys(parsed).forEach(function (key) {
        var role = normalizedRole_(parsed[key]);
        if (role) result[text_(key).toLowerCase()] = role;
      });
      ['viewers', 'operators', 'admins'].forEach(function (bucket) {
        var rows = parsed[bucket];
        if (!Array.isArray(rows)) return;
        var role = bucket === 'admins' ? 'ADMIN' :
          bucket === 'operators' ? 'OPERATOR' : 'VIEWER';
        rows.forEach(function (email) {
          email = text_(email).toLowerCase();
          if (email) result[email] = role;
        });
      });
    }
    return result;
  }

  function roleStatus_() {
    var access = assertAccess_();
    var assignments = parseRoleAssignments_(
      properties_().getProperty(ROLES_PROPERTY)
    );
    var email = text_(access.email).toLowerCase();
    return {
      email: email,
      role: assignments[email] || 'VIEWER',
      assignmentsConfigured: Object.keys(assignments).length > 0,
      accessMode: text_(access.mode)
    };
  }

  function assertRole_(minimum) {
    minimum = normalizedRole_(minimum) || 'VIEWER';
    var state = roleStatus_();
    if (ROLE_RANK[state.role] < ROLE_RANK[minimum]) {
      throw AKORT.Core.error('BETA23_ROLE_REQUIRED',
        'The current role does not permit this action.', {
          requiredRole: minimum, actualRole: state.role, retryable: false
        });
    }
    return state;
  }

  function settingsState_() {
    var settings = AKORT.Config.readSystemSettings();
    return {
      environment: text_(settings.SYSTEM_ENVIRONMENT || 'DEV'),
      userPipelineEnabled: truthy_(settings.PUBLISH_USER_PIPELINE_ENABLED),
      beta22ControlledSubmitEnabled: truthy_(properties_().getProperty(BETA22_GATE_PROPERTY)),
      beta23OperatorActionsEnabled: truthy_(properties_().getProperty(ACTIONS_PROPERTY))
    };
  }

  function requireSuccess_(name, result) {
    if (!result || result.ok !== true) {
      throw AKORT.Core.error('BETA23_ACCEPTED_API_FAILED',
        'An accepted API failed.', {
          dependency: name,
          code: text_(result && result.code),
          status: text_(result && result.status),
          message: text_(result && result.message),
          details: clone_(result && (result.details || result.data)),
          retryable: false
        });
    }
    return result.data || {};
  }

  function hardeningState_() {
    return requireSuccess_('AKORT.Beta14OperationalHardening.status',
      AKORT.Beta14OperationalHardening.status());
  }

  function assertWriteContext_(minimumRole, requireQuiescent) {
    assertBase_();
    var role = assertRole_(minimumRole);
    var flags = settingsState_();
    if (!flags.beta23OperatorActionsEnabled) {
      throw AKORT.Core.error('BETA23_ACTIONS_DISABLED',
        'Beta.2.3 operator actions are disabled.', { retryable: false });
    }
    if (flags.beta22ControlledSubmitEnabled) {
      throw AKORT.Core.error('BETA23_BETA22_GATE_MUST_BE_FALSE',
        'Beta.2.2 controlled submit must be disabled.', { retryable: false });
    }
    if (flags.userPipelineEnabled) {
      throw AKORT.Core.error('BETA23_USER_PIPELINE_MUST_BE_FALSE',
        'The general user pipeline must remain disabled.', { retryable: false });
    }
    var hardening = hardeningState_();
    if (hardening.healthy !== true) {
      throw AKORT.Core.error('BETA23_OPERATIONAL_GUARD_NOT_HEALTHY',
        'Operational hardening is not healthy.', {
          blockers: clone_(hardening.blockers || []), retryable: false
        });
    }
    var inventory = hardening.operationInventory || {};
    if (requireQuiescent && Number(inventory.nonTerminalCount || 0) > 0) {
      throw AKORT.Core.error('BETA23_ACTIVE_OPERATION_BLOCKS_ACTION',
        'An active operation blocks this action.', {
          nonTerminal: clone_(inventory.nonTerminal || []), retryable: true
        });
    }
    return { role: role, flags: flags, hardening: hardening };
  }

  function ruStatus_(value) {
    var key = text_(value).toUpperCase();
    return RU.statuses[key] || (key ? 'Требуется техническая проверка' : 'Не определено');
  }

  function ruPhase_(value) {
    var key = text_(value).toUpperCase();
    return RU.phases[key] || (key ? 'Выполняется служебный этап' : 'Не определено');
  }

  function ruOperationType_(value) {
    var key = text_(value).toUpperCase();
    return RU.operationTypes[key] || 'Служебная операция';
  }

  function ruSeverity_(value) {
    return RU.severities[text_(value).toUpperCase()] || 'Требует внимания';
  }

  function ruNextAction_(value) {
    var key = text_(value).toUpperCase();
    return RU.nextActions[key] || (key ? 'Требуется техническая проверка' : 'Действий не требуется');
  }

  function ruError_(code) {
    return RU.errors[text_(code).toUpperCase()] || 'Требуется техническая проверка.';
  }

  function auditActor_() {
    var role = roleStatus_();
    return {
      actorHash: AKORT.Core.sha256(role.email).slice(0, 24),
      role: role.role
    };
  }

  function assertAuditWritten_(written) {
    if (Number(written) !== 1) {
      throw AKORT.Core.error(
        'BETA23_ACTION_AUDIT_NOT_PERSISTED',
        'Operator action audit record was not persisted.',
        { writtenRows: Number(written || 0), retryable: false }
      );
    }
    return true;
  }

  function actionAudit_(phase, actionType, targetId, reason, outcome) {
    var actor = auditActor_();
    var logger = AKORT.Core.Logger.create('BETA23_OPERATOR_ACTION', {
      silent: true, operationId: text_(outcome && outcome.operationId)
    });
    logger.info('Beta.2.3 operator action audit.', {
      schemaVersion: CONTRACT_VERSION,
      auditPhase: text_(phase),
      actorHash: actor.actorHash,
      role: actor.role,
      actionType: text_(actionType),
      targetIdHash: targetId ? AKORT.Core.sha256(text_(targetId)).slice(0, 24) : '',
      reasonHash: reason ? AKORT.Core.sha256(text_(reason)) : '',
      confirmationFingerprint: text_(outcome && outcome.confirmationFingerprint),
      accepted: outcome && outcome.accepted === true,
      operationId: text_(outcome && outcome.operationId),
      resultStatus: text_(outcome && outcome.status),
      errorCode: text_(outcome && outcome.errorCode),
      releaseVersion: AKORT.Release.version
    }, {
      eventCode: phase === 'STARTED'
        ? 'BETA23_OPERATOR_ACTION_STARTED'
        : 'BETA23_OPERATOR_ACTION_COMPLETED'
    });
    var written = logger.flush();
    assertAuditWritten_(written);
    return true;
  }

  function runAuditedAction_(audit, callback) {
    var outcome = { accepted: false, status: 'STARTED', errorCode: '' };
    audit('STARTED', outcome); // fail closed before any delegated side effect
    try {
      var result = callback();
      outcome.accepted = result && result.ok === true;
      outcome.status = text_(result && result.status);
      outcome.operationId = text_(result && result.data && result.data.operationId);
      outcome.confirmationFingerprint = text_(
        result && result.data && result.data.confirmationFingerprint
      );
      if (result && result.ok === false) outcome.errorCode = text_(result.code);
      audit('COMPLETED', outcome);
      return result;
    } catch (caught) {
      outcome.status = 'FAILED';
      outcome.errorCode = text_(caught && caught.code) || 'UNEXPECTED_ERROR';
      try {
        audit('COMPLETED', outcome);
      } catch (auditFailure) {
        auditFailure.details = auditFailure.details || {};
        auditFailure.details.originalErrorCode = outcome.errorCode;
        throw auditFailure;
      }
      throw caught;
    }
  }

  function auditedWrite_(component, actionType, targetId, reason, callback) {
    return AKORT.Core.safeRun(component, function () {
      return runAuditedAction_(function (phase, outcome) {
        return actionAudit_(phase, actionType, targetId, reason, outcome);
      }, callback);
    }, { lock: false, persistLogs: true });
  }

  function dwh_() {
    return SpreadsheetApp.openById(
      AKORT.Config.load({ includeSystemSettings: false }).resources.dwhSpreadsheetId
    );
  }

  function publish_() {
    return SpreadsheetApp.openById(
      AKORT.Config.load({ includeSystemSettings: false }).resources.publishSpreadsheetId
    );
  }

  function headerIndex_(headers) {
    var result = {};
    (headers || []).forEach(function (header, index) {
      result[text_(header)] = index;
    });
    return result;
  }

  function assertHeaders_(sheet, expected, code) {
    if (!sheet) {
      throw AKORT.Core.error(code || 'BETA23_TABLE_MISSING',
        'Required table is missing.', { retryable: false });
    }
    var actual = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(String);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw AKORT.Core.error('BETA23_FRESHNESS_SCHEMA_MISMATCH',
        'Freshness table schema differs from the contract.', {
          expected: expected, actual: actual, retryable: false
        });
    }
    return sheet;
  }

  function ensureFreshnessSheet_(name) {
    var spreadsheet = dwh_();
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      if (sheet.getMaxColumns() < FRESHNESS_HEADERS.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(),
          FRESHNESS_HEADERS.length - sheet.getMaxColumns());
      }
      sheet.getRange(1, 1, 1, FRESHNESS_HEADERS.length)
        .setValues([FRESHNESS_HEADERS.slice()]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, FRESHNESS_HEADERS.length)
        .setFontWeight('bold');
    }
    return assertHeaders_(sheet, FRESHNESS_HEADERS);
  }

  function ensureFreshnessTable_() {
    return ensureFreshnessSheet_(FRESHNESS_TABLE);
  }

  function ensureFreshnessStageTable_() {
    return ensureFreshnessSheet_(FRESHNESS_STAGE_TABLE);
  }

  function withFreshnessLock_(callback) {
    var lock = LockService.getScriptLock();
    lock.waitLock(FRESHNESS_LOCK_TIMEOUT_MS);
    try { return callback(); }
    finally { lock.releaseLock(); }
  }

  function freshnessInspection_() {
    var sheet = dwh_().getSheetByName(FRESHNESS_TABLE);
    if (!sheet) return { status: 'ABSENT', rows: 0, schemaMatches: true };
    var actual = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(String);
    return {
      status: 'PRESENT', rows: Math.max(0, sheet.getLastRow() - 1),
      schemaMatches: JSON.stringify(actual) === JSON.stringify(FRESHNESS_HEADERS),
      actualHeaders: actual
    };
  }

  function readTableObjects_(spreadsheet, sheetName, expected, maximumRows) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw AKORT.Core.error('BETA23_REQUIRED_TABLE_MISSING',
      'Required service table is missing.', { table: sheetName, retryable: false });
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(String);
    if (expected && JSON.stringify(headers) !== JSON.stringify(expected)) {
      throw AKORT.Core.error('BETA23_SERVICE_SCHEMA_MISMATCH',
        'Service-table schema differs from the accepted contract.', {
          table: sheetName, expected: expected, actual: headers, retryable: false
        });
    }
    var total = Math.max(0, sheet.getLastRow() - 1);
    var count = Math.min(total, Number(maximumRows || total));
    if (!count) return [];
    var start = total > count ? sheet.getLastRow() - count + 1 : 2;
    var values = sheet.getRange(start, 1, count, headers.length).getValues();
    return values.map(function (row, offset) {
      var object = { __row: start + offset };
      headers.forEach(function (header, column) { object[header] = row[column]; });
      return object;
    });
  }

  function readBoundedAllObjects_(spreadsheet, sheetName, maximumRows) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw AKORT.Core.error('BETA23_REQUIRED_TABLE_MISSING',
      'Required service table is missing.', { table: sheetName, retryable: false });
    var total = Math.max(0, sheet.getLastRow() - 1);
    if (total > Number(maximumRows || 0)) {
      throw AKORT.Core.error('BETA23_READ_MODEL_BOUND_EXCEEDED',
        'A controlled read model exceeded its frozen row bound.', {
          table: sheetName, rows: total, maximum: Number(maximumRows || 0),
          retryable: false
        });
    }
    return readTableObjects_(spreadsheet, sheetName, null, total || 1);
  }

  function readFreshnessRowsUnlocked_() {
    var inspection = freshnessInspection_();
    if (inspection.status === 'ABSENT') return [];
    if (!inspection.schemaMatches) {
      throw AKORT.Core.error('BETA23_FRESHNESS_SCHEMA_MISMATCH',
        'Freshness table schema differs from the contract.', {
          actualHeaders: inspection.actualHeaders, retryable: false
        });
    }
    if (inspection.rows > MAX_FRESHNESS_MEMBERS) {
      throw AKORT.Core.error('BETA23_FRESHNESS_BOUND_EXCEEDED',
        'Freshness projection exceeded its bounded contract.', {
          rows: inspection.rows, maximum: MAX_FRESHNESS_MEMBERS, retryable: false
        });
    }
    return readTableObjects_(dwh_(), FRESHNESS_TABLE,
      FRESHNESS_HEADERS, MAX_FRESHNESS_MEMBERS).map(function (row) {
        delete row.__row;
        return row;
      });
  }

  function readFreshnessRows_() {
    return withFreshnessLock_(readFreshnessRowsUnlocked_);
  }

  function selectedColumns_(sheet, required, maximumRows) {
    if (!sheet) throw AKORT.Core.error('BETA23_PUBLISH_SHEET_MISSING',
      'Required Publish sheet is missing.', { retryable: false });
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0].map(String);
    var index = headerIndex_(headers);
    required.forEach(function (header) {
      if (index[header] === undefined) {
        throw AKORT.Core.error('BETA23_PUBLISH_SCHEMA_MISMATCH',
          'Required Publish column is missing.', {
            sheet: sheet.getName(), column: header, retryable: false
          });
      }
    });
    var total = Math.max(0, sheet.getLastRow() - 1);
    if (total > Number(maximumRows || MAX_PUBLISH_ROWS)) {
      throw AKORT.Core.error('BETA23_PUBLISH_BOUND_EXCEEDED',
        'Publish source exceeded the controlled refresh bound.', {
          sheet: sheet.getName(), rows: total,
          maximum: Number(maximumRows || MAX_PUBLISH_ROWS), retryable: false
        });
    }
    var columns = {};
    required.forEach(function (header) {
      columns[header] = total ? sheet.getRange(2, index[header] + 1, total, 1)
        .getValues().map(function (row) { return row[0]; }) : [];
    });
    var rows = [];
    for (var rowIndex = 0; rowIndex < total; rowIndex += 1) {
      var object = {};
      required.forEach(function (header) { object[header] = columns[header][rowIndex]; });
      rows.push(object);
    }
    return rows;
  }

  function parseCheckpoint_(value) {
    if (value && typeof value === 'object') return clone_(value);
    if (!text_(value)) return {};
    try { return JSON.parse(String(value)); }
    catch (ignored) { return {}; }
  }

  function normalizedSourceOptions_(input) {
    input = input || {};
    var options = {
      profileId: text_(input.profileId), year: text_(input.year),
      month: text_(input.month), week: text_(input.week),
      sourcePublishedAt: text_(input.sourcePublishedAt)
    };
    Object.keys(options).forEach(function (key) {
      if (options[key] === '') delete options[key];
    });
    return options;
  }

  function operationCheckpoint_(operation) {
    return operation && operation.checkpoint && typeof operation.checkpoint === 'object'
      ? clone_(operation.checkpoint)
      : parseCheckpoint_(operation && operation.checkpoint_json);
  }

  function operationOriginResult_(operation, email) {
    var type = text_(operation && (operation.operation_type || operation.operationType));
    var checkpoint = operationCheckpoint_(operation);
    var input = checkpoint.input || {};
    var meta = checkpoint.meta || {};
    var createdBy = text_(operation && operation.created_by).toLowerCase();
    var user = text_(email).toLowerCase();
    var owned = Boolean(user) && createdBy === user;
    var exact = false;
    var origin = '';

    if (type === 'SOURCE_FILE_LOAD_V4') {
      var workflow = input.beta22Binding || {};
      var expectedKey = 'BETA22|' + AKORT.Core.sha256(AKORT.Core.canonicalJson({
        operationType: type,
        fileId: text_(workflow.fileId),
        sourceHash: text_(workflow.sourceHash),
        profileId: text_(workflow.profileId),
        options: clone_(workflow.options || {})
      }));
      var normalized = normalizedSourceOptions_(input);
      exact = text_(workflow.schemaVersion) === BETA22_OPERATION_BINDING_SCHEMA &&
        text_(workflow.userEmail).toLowerCase() === user &&
        Boolean(text_(workflow.fileId)) && Boolean(text_(workflow.sourceHash)) &&
        Boolean(text_(workflow.profileId)) && Boolean(text_(workflow.targetTable)) &&
        Number(workflow.normalizedRowCount || 0) > 0 &&
        Boolean(text_(workflow.confirmationFingerprint)) &&
        text_(input.fileId) === text_(workflow.fileId) &&
        text_(input.sourceId) === text_(workflow.fileId) &&
        text_(input.profileId) === text_(workflow.profileId) &&
        AKORT.Core.canonicalJson(normalized) ===
          AKORT.Core.canonicalJson(workflow.options || {}) &&
        text_(meta.idempotencyKey) === expectedKey;
      origin = 'BETA22_USER_LOAD_WORKFLOW';
    } else if (type === 'RAW_LOAD_V4') {
      var rows = Array.isArray(input.rows) ? input.rows : [];
      var sourceHash = AKORT.Core.sha256(JSON.stringify(rows));
      exact = input.targetTable === 'RAW_INDUSTRY' &&
        input.sourceId === 'INDUSTRY_INPUT_FORM' &&
        input.sourceName === 'AKORT Industry Operator Form' &&
        rows.length > 0 && rows.length <= 100 &&
        text_(input.sourceHash) === sourceHash &&
        text_(meta.idempotencyKey) === 'INDUSTRY_INPUT_' + sourceHash;
      origin = 'ACCEPTED_INDUSTRY_INPUT_WORKFLOW';
    } else if (type === 'BETA11_PAIRED_BACKUP') {
      exact = text_(input.requestType) === 'MANUAL' &&
        /^BKP_MANUAL_/.test(text_(input.backupId)) &&
        text_(meta.idempotencyKey) === text_(input.backupId);
      origin = 'ACCEPTED_MANUAL_BACKUP_WORKFLOW';
    } else if (type === 'FULL_AUDIT_V4') {
      var reason = text_(input.reason);
      exact = /^AUD_/.test(text_(input.auditId)) &&
        reason === 'Beta.2.3 пользовательская полная проверка' &&
        input.retentionDryRun === true &&
        text_(meta.idempotencyKey).indexOf('FULL_AUDIT_V4|') === 0 &&
        text_(meta.idempotencyKey).slice(-12) ===
          AKORT.Core.sha256(reason).slice(0, 12);
      origin = 'BETA23_FULL_AUDIT_WORKFLOW';
    } else if (type === 'RAW_REVERSAL_V4') {
      var beta12 = input.beta12 || {};
      var token = text_(beta12.confirmationToken);
      exact = Boolean(text_(input.targetLoadId)) && Boolean(text_(input.reason)) &&
        text_(beta12.packageVersion).indexOf('4.0.0-beta.1.2.') === 0 &&
        text_(beta12.contractVersion).indexOf('4.0-beta12-rollback-facade-') === 0 &&
        Boolean(token) && Boolean(text_(beta12.lineageFingerprint)) &&
        Boolean(text_(beta12.impactFingerprint)) &&
        text_(beta12.reasonHash) === AKORT.Core.sha256(text_(input.reason)) &&
        text_(meta.idempotencyKey) === 'BETA12_ROLLBACK_' + token;
      origin = 'ACCEPTED_BETA12_ROLLBACK_WORKFLOW';
    }

    return {
      allowed: owned && exact,
      ownedByCurrentUser: owned,
      exactWorkflowOrigin: exact,
      operationType: type,
      origin: origin,
      createdByHash: createdBy ? AKORT.Core.sha256(createdBy).slice(0, 24) : ''
    };
  }

  function assertOperationOrigin_(operation, role) {
    var result = operationOriginResult_(operation, role && role.email);
    if (!result.allowed) {
      throw AKORT.Core.error('BETA23_OPERATION_ORIGIN_NOT_ALLOWED',
        'The operation is not an exact permitted user-workflow operation for the current user.', {
          operationType: result.operationType,
          origin: result.origin,
          ownedByCurrentUser: result.ownedByCurrentUser,
          exactWorkflowOrigin: result.exactWorkflowOrigin,
          retryable: false
        });
    }
    return result;
  }

  function operationProfile_(operation) {
    var checkpoint = parseCheckpoint_(operation && operation.checkpoint_json);
    var input = checkpoint.input || {};
    var handler = checkpoint.handlerState || {};
    var parse = handler.parse || {};
    var profile = handler.profile || parse.profile || {};
    var resolved = handler.resolvedOptions || parse.resolvedOptions || {};
    return {
      profileId: text_(input.profileId || profile.profileId || profile.profile_id),
      year: Number(resolved.year || input.year || 0),
      week: Number(resolved.week || input.week || 0),
      month: Number(resolved.month || input.month || 0),
      loadId: text_(handler.loadId || handler.rawStage && handler.rawStage.loadId),
      fileName: text_(input.fileName || handler.file && handler.file.fileName),
      sourceHash: text_(handler.sourceHash)
    };
  }

  function canonicalFromParts_(frequency, year, month, week) {
    frequency = text_(frequency).toUpperCase();
    if (frequency === 'WEEKLY' && year && week) {
      return String(year) + '-W' + ('0' + Number(week)).slice(-2);
    }
    if (frequency === 'MONTHLY' && year && month) {
      return String(year) + '-' + ('0' + Number(month)).slice(-2);
    }
    return '';
  }

  function periodLabelRu_(frequency, canonical, start, end) {
    frequency = text_(frequency).toUpperCase();
    if (frequency === 'WEEKLY') {
      var weekly = text_(canonical).match(/^(\d{4})-W(\d{2})$/);
      return weekly ? Number(weekly[2]) + '-я неделя ' + weekly[1] + ' года' : 'Период не определён';
    }
    if (frequency === 'MONTHLY') {
      var monthly = text_(canonical).match(/^(\d{4})-(\d{2})$/);
      if (monthly) {
        var months = ['январь','февраль','март','апрель','май','июнь',
          'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
        return months[Number(monthly[2]) - 1] + ' ' + monthly[1] + ' года';
      }
    }
    if (frequency === 'QUARTERLY') {
      var quarter = text_(canonical).match(/^(\d{4})-Q([1-4])$/);
      return quarter ? quarter[2] + '-й квартал ' + quarter[1] + ' года' : 'Период не определён';
    }
    if (frequency === 'ANNUAL') {
      return canonical ? canonical + ' год' : 'Период не определён';
    }
    return canonical || dateKey_(end) || dateKey_(start) || 'Период не определён';
  }

  function frequencyRu_(frequency) {
    return {
      WEEKLY: 'недельные', MONTHLY: 'месячные',
      QUARTERLY: 'квартальные', ANNUAL: 'годовые'
    }[text_(frequency).toUpperCase()] || 'иная периодичность';
  }

  function latestSuccessfulProfileOperations_(operations, publishRuns) {
    var successfulLoads = {};
    (publishRuns || []).forEach(function (run) {
      if (text_(run.status).toUpperCase() === 'SUCCESS' && text_(run.load_id)) {
        successfulLoads[text_(run.load_id)] = true;
      }
    });
    var result = {};
    (operations || []).forEach(function (operation) {
      if (text_(operation.operation_type) !== 'SOURCE_FILE_LOAD_V4' ||
          text_(operation.status).toUpperCase() !== 'SUCCESS') return;
      var profile = operationProfile_(operation);
      if (!profile.profileId || !profile.loadId || !successfulLoads[profile.loadId]) return;
      var current = result[profile.profileId];
      var finished = dateIso_(operation.finished_at || operation.started_at || operation.requested_at);
      if (!current || finished > current.finishedAt) {
        result[profile.profileId] = {
          operationId: text_(operation.operation_id), loadId: profile.loadId,
          profileId: profile.profileId, year: profile.year, week: profile.week,
          month: profile.month, fileName: profile.fileName,
          finishedAt: finished
        };
      }
    });
    return result;
  }

  function rowMatchesMember_(row, member, categoryScope) {
    if (text_(row.dataset_code) !== member.datasetCode) return false;
    if (member.indicatorCode && text_(row.indicator_key) !== member.indicatorCode) return false;
    if (member.valueType && norm_(row.value_type) !== norm_(member.valueType)) return false;
    if (member.indexType && norm_(row.index_type) !== norm_(member.indexType)) return false;
    if (member.datasetCode.indexOf('AKORT_') !== 0) {
      if (!categoryScope || !Object.keys(categoryScope).length) return false;
      if (categoryScope[text_(row.category_id)] !== true) return false;
    }
    return true;
  }

  function profileCategoryScopes_(mappings) {
    var scopes = {};
    PROFILE_MEMBERS.forEach(function (member) { scopes[member.profileId] = {}; });
    (mappings || []).forEach(function (mapping) {
      if (!truthy_(mapping.is_active)) return;
      PROFILE_MEMBERS.forEach(function (member) {
        if (member.datasetCode.indexOf('AKORT_') === 0) return;
        if (text_(mapping.dataset_code) !== member.datasetCode) return;
        if (text_(mapping.source_file_type) !== member.sourceFileType) return;
        var categoryId = text_(mapping.category_id);
        if (categoryId) scopes[member.profileId][categoryId] = true;
      });
    });
    return scopes;
  }

  function canonicalForPublishRow_(row, frequency) {
    frequency = text_(frequency).toUpperCase();
    if (frequency === 'WEEKLY') {
      return canonicalFromParts_('WEEKLY', Number(row.iso_year), 0, Number(row.iso_week));
    }
    if (frequency === 'MONTHLY') {
      var monthStart = dateKey_(row.month_start);
      if (monthStart) return monthStart.slice(0, 7);
      return canonicalFromParts_('MONTHLY', Number(row.year), Number(row.month), 0);
    }
    return '';
  }

  function latestMatchingPublish_(rows, member, preferredCanonical, categoryScope) {
    var matches = (rows || []).filter(function (row) {
      return truthy_(row.is_latest_period) &&
        rowMatchesMember_(row, member, categoryScope);
    });
    if (preferredCanonical) {
      matches = matches.filter(function (row) {
        return canonicalForPublishRow_(row, member.frequency) === preferredCanonical;
      });
      if (!matches.length) return null; // never borrow another profile period
    }
    matches.sort(function (left, right) {
      return canonicalForPublishRow_(right, member.frequency)
        .localeCompare(canonicalForPublishRow_(left, member.frequency));
    });
    return matches.length ? matches[0] : null;
  }

  function qualityForMember_(publishRow, operation, reconciled) {
    if (!reconciled) return { quality: 'ERROR', freshness: 'WARNING', issueCount: 1 };
    if (!publishRow) return { quality: 'WARNING', freshness: 'NOT_INITIALIZED', issueCount: 1 };
    if (!operation) return { quality: 'WARNING', freshness: 'CURRENT', issueCount: 1 };
    return { quality: 'GOOD', freshness: 'CURRENT', issueCount: 0 };
  }

  function fingerprintRow_(row) {
    var copy = clone_(row);
    delete copy.snapshot_fingerprint;
    return AKORT.Core.sha256(AKORT.Core.canonicalJson(copy));
  }

  function profileFreshnessRows_(weeklyRows, monthlyRows, operationsByProfile,
      latestReconciliation, observedAt, categoryScopes) {
    var reconciled = latestReconciliation &&
      ['SUCCESS', 'PASS'].indexOf(text_(latestReconciliation.status).toUpperCase()) >= 0;
    return PROFILE_MEMBERS.map(function (member) {
      var operation = operationsByProfile[member.profileId] || null;
      var preferred = operation ? canonicalFromParts_(member.frequency,
        operation.year, operation.month, operation.week) : '';
      var publishRow = latestMatchingPublish_(
        member.frequency === 'WEEKLY' ? weeklyRows : monthlyRows,
        member, preferred, categoryScopes && categoryScopes[member.profileId]
      );
      var canonical = publishRow ? canonicalForPublishRow_(publishRow, member.frequency) : preferred;
      var quality = qualityForMember_(publishRow, operation, reconciled);
      var periodStart = member.frequency === 'WEEKLY'
        ? dateKey_(publishRow && publishRow.observation_date)
        : dateKey_(publishRow && publishRow.month_start);
      var periodEnd = periodStart;
      var row = {
        freshness_member_id: member.memberId,
        display_family_id: member.displayFamilyId,
        dataset_code: member.datasetCode,
        profile_id: member.profileId,
        series_id: '',
        indicator_code: member.indicatorCode,
        indicator_name_ru: member.indicatorNameRu,
        source_name_ru: member.sourceNameRu,
        frequency: member.frequency,
        canonical_period_key: canonical,
        period_start: periodStart,
        period_end: periodEnd,
        period_label_ru: periodLabelRu_(member.frequency, canonical, periodStart, periodEnd),
        latest_load_id: operation ? operation.loadId : '',
        latest_operation_id: operation ? operation.operationId : '',
        latest_loaded_at: operation ? operation.finishedAt : '',
        quality_status: quality.quality,
        freshness_status: quality.freshness,
        issue_count: quality.issueCount,
        observed_at: observedAt,
        snapshot_fingerprint: '',
        release_version: AKORT.Release.version
      };
      row.snapshot_fingerprint = fingerprintRow_(row);
      return row;
    });
  }

  function industryCanonical_(dimension, row) {
    var frequency = text_(dimension.frequency).toUpperCase();
    var start = dateKey_(row && row.period_start);
    var end = dateKey_(row && row.period_end);
    if (frequency === 'MONTHLY') return start ? start.slice(0, 7) : '';
    if (frequency === 'QUARTERLY' && end) {
      return end.slice(0, 4) + '-Q' + Math.ceil(Number(end.slice(5, 7)) / 3);
    }
    if (frequency === 'ANNUAL') return start ? start.slice(0, 4) : '';
    return text_(row && row.period_label);
  }

  function industryFreshnessRows_(dimensions, publishRows, latestLoadBySeries,
      latestReconciliation, observedAt) {
    var rowsBySeries = {};
    (publishRows || []).forEach(function (row) {
      if (!truthy_(row.is_latest_period) || !text_(row.series_id)) return;
      rowsBySeries[text_(row.series_id)] = row;
    });
    var reconciled = latestReconciliation &&
      ['SUCCESS', 'PASS'].indexOf(text_(latestReconciliation.status).toUpperCase()) >= 0;
    return (dimensions || []).filter(function (dimension) {
      return truthy_(dimension.is_active) && text_(dimension.series_id);
    }).map(function (dimension) {
      var seriesId = text_(dimension.series_id);
      var publishRow = rowsBySeries[seriesId] || null;
      var load = latestLoadBySeries[seriesId] || null;
      var frequency = text_(dimension.frequency).toUpperCase();
      var canonical = industryCanonical_(dimension, publishRow);
      var quality = !reconciled ? { quality: 'ERROR', freshness: 'WARNING', issueCount: 1 } :
        !publishRow ? { quality: 'WARNING', freshness: 'NOT_INITIALIZED', issueCount: 1 } :
          { quality: 'GOOD', freshness: 'CURRENT', issueCount: 0 };
      var row = {
        freshness_member_id: 'INDUSTRY|' + seriesId,
        display_family_id: 'INDUSTRY', dataset_code: 'INDUSTRY', profile_id: '',
        series_id: seriesId, indicator_code: text_(dimension.indicator_id),
        indicator_name_ru: text_(dimension.indicator_name),
        source_name_ru: text_(dimension.source_name) || 'Отраслевой источник',
        frequency: frequency, canonical_period_key: canonical,
        period_start: dateKey_(publishRow && publishRow.period_start),
        period_end: dateKey_(publishRow && publishRow.period_end),
        period_label_ru: periodLabelRu_(frequency, canonical,
          publishRow && publishRow.period_start, publishRow && publishRow.period_end),
        latest_load_id: load ? text_(load.load_id) : '',
        latest_operation_id: load ? text_(load.operation_id) : '',
        latest_loaded_at: load ? dateIso_(load.finished_at || load.started_at) : '',
        quality_status: quality.quality, freshness_status: quality.freshness,
        issue_count: quality.issueCount, observed_at: observedAt,
        snapshot_fingerprint: '', release_version: AKORT.Release.version
      };
      row.snapshot_fingerprint = fingerprintRow_(row);
      return row;
    });
  }

  function latestBy_(rows, timestampFields, filter) {
    var candidates = (rows || []).filter(filter || function () { return true; });
    candidates.sort(function (left, right) {
      function stamp(row) {
        for (var i = 0; i < timestampFields.length; i += 1) {
          var value = dateIso_(row[timestampFields[i]]);
          if (value) return value;
        }
        return '';
      }
      return stamp(right).localeCompare(stamp(left));
    });
    return candidates.length ? candidates[0] : null;
  }

  function latestIndustryLoads_(operations, publishRuns) {
    var successfulLoads = {};
    (publishRuns || []).forEach(function (run) {
      if (text_(run.status).toUpperCase() === 'SUCCESS' && text_(run.load_id)) {
        successfulLoads[text_(run.load_id)] = true;
      }
    });
    var result = {};
    (operations || []).forEach(function (operation) {
      if (text_(operation.operation_type) !== 'RAW_LOAD_V4' ||
          text_(operation.status).toUpperCase() !== 'SUCCESS') return;
      var checkpoint = parseCheckpoint_(operation.checkpoint_json);
      var input = checkpoint.input || {};
      if (text_(input.targetTable) !== 'RAW_INDUSTRY' || !Array.isArray(input.rows)) return;
      var rawStore = checkpoint.rawStore || {};
      var handler = checkpoint.handlerState || {};
      var loadId = text_(rawStore.loadId || handler.loadId);
      if (!loadId || !successfulLoads[loadId]) return;
      var finishedAt = dateIso_(operation.finished_at || operation.started_at);
      input.rows.forEach(function (row) {
        var seriesId = text_(row && row.series_id);
        if (!seriesId) return;
        var current = result[seriesId];
        if (!current || finishedAt > current.finished_at) {
          result[seriesId] = {
            load_id: loadId,
            operation_id: text_(operation.operation_id),
            finished_at: finishedAt
          };
        }
      });
    });
    return result;
  }

  function projectionSources_() {
    var publish = publish_();
    var dwh = dwh_();
    var weekly = selectedColumns_(publish.getSheetByName('PUBLISH_PRICES_WEEKLY'), [
      'dataset_code','category_id','indicator_key','value_type','index_type','observation_date',
      'iso_year','iso_week','is_latest_period'
    ], MAX_PUBLISH_ROWS);
    var monthly = selectedColumns_(publish.getSheetByName('PUBLISH_PRICES_MONTHLY'), [
      'dataset_code','category_id','indicator_key','value_type','index_type','month_start',
      'year','month','is_latest_period'
    ], MAX_PUBLISH_ROWS);
    var industry = selectedColumns_(publish.getSheetByName('PUBLISH_INDUSTRY'), [
      'series_id','period_start','period_end','period_label','is_latest_period'
    ], MAX_PUBLISH_ROWS);
    var operations = readTableObjects_(dwh, 'OPERATION_QUEUE',
      AKORT.Core.Tables.OPERATION_QUEUE, MAX_LOAD_SOURCE_ROWS);
    var loads = readTableObjects_(dwh, 'RAW_LOAD_REGISTRY', null, MAX_LOAD_SOURCE_ROWS);
    var publishRuns = readTableObjects_(dwh, 'PUBLISH_RUNS', null, MAX_LOAD_SOURCE_ROWS);
    var reconciliations = readTableObjects_(dwh, 'PUBLISH_RECONCILIATION', null, MAX_LOAD_SOURCE_ROWS);
    var dimensions = readTableObjects_(dwh, 'DIM_INDUSTRY_SERIES', null, MAX_FRESHNESS_MEMBERS);
    var mappings = readBoundedAllObjects_(dwh, 'DIM_PRODUCT_MAPPING', MAX_MAPPING_ROWS);
    return {
      weekly: weekly, monthly: monthly, industry: industry,
      operations: operations, loads: loads, publishRuns: publishRuns,
      reconciliations: reconciliations, dimensions: dimensions,
      mappings: mappings
    };
  }

  function uniqueMemberIds_(rows) {
    var seen = {};
    var duplicates = [];
    (rows || []).forEach(function (row) {
      var id = text_(row.freshness_member_id);
      if (seen[id]) duplicates.push(id);
      seen[id] = true;
    });
    return { uniqueCount: Object.keys(seen).length, duplicates: duplicates };
  }

  function freshnessValues_(rows) {
    return (rows || []).map(function (row) {
      return FRESHNESS_HEADERS.map(function (header) {
        var value = row[header];
        return value === null || value === undefined ? '' : value;
      });
    });
  }

  function freshnessObjectsFromSheet_(sheet) {
    var count = Math.max(0, sheet.getLastRow() - 1);
    if (count > MAX_FRESHNESS_MEMBERS) {
      throw AKORT.Core.error('BETA23_FRESHNESS_BOUND_EXCEEDED',
        'Freshness projection exceeded its bounded contract.', {
          rows: count, maximum: MAX_FRESHNESS_MEMBERS, retryable: false
        });
    }
    if (!count) return [];
    return sheet.getRange(2, 1, count, FRESHNESS_HEADERS.length)
      .getValues().map(function (values) {
        var row = {};
        FRESHNESS_HEADERS.forEach(function (header, index) {
          row[header] = values[index];
        });
        return row;
      });
  }

  function canonicalFreshnessRows_(rows) {
    return (rows || []).map(function (row) {
      var normalized = {};
      FRESHNESS_HEADERS.forEach(function (header) {
        var value = row[header];
        normalized[header] = Object.prototype.toString.call(value) === '[object Date]'
          ? value.toISOString() : value === null || value === undefined ? '' : value;
      });
      return normalized;
    }).sort(function (left, right) {
      return text_(left.freshness_member_id).localeCompare(
        text_(right.freshness_member_id)
      );
    });
  }

  function freshnessRowsMatch_(left, right) {
    return AKORT.Core.canonicalJson(canonicalFreshnessRows_(left)) ===
      AKORT.Core.canonicalJson(canonicalFreshnessRows_(right));
  }

  function writeFreshnessSheet_(sheet, rows) {
    var existing = Math.max(0, sheet.getLastRow() - 1);
    if (existing) {
      sheet.getRange(2, 1, existing, FRESHNESS_HEADERS.length).clearContent();
    }
    if (!rows.length) return;
    if (sheet.getMaxRows() < rows.length + 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
    }
    sheet.getRange(2, 1, rows.length, FRESHNESS_HEADERS.length)
      .setValues(freshnessValues_(rows));
  }

  function runFreshnessTransaction_(adapter, rows) {
    var before = adapter.readTarget();
    var expectedFingerprint = AKORT.Core.sha256(
      AKORT.Core.canonicalJson(canonicalFreshnessRows_(rows))
    );

    adapter.writeStage(rows);
    var staged = adapter.readStage();
    if (!freshnessRowsMatch_(rows, staged)) {
      throw AKORT.Core.error('BETA23_FRESHNESS_STAGE_READBACK_MISMATCH',
        'Freshness staging read-back differs from the candidate snapshot.', {
          expectedFingerprint: expectedFingerprint, retryable: false
        });
    }

    try {
      adapter.writeTarget(staged);
      var committed = adapter.readTarget();
      if (!freshnessRowsMatch_(rows, committed)) {
        throw AKORT.Core.error('BETA23_FRESHNESS_TARGET_READBACK_MISMATCH',
          'Freshness target read-back differs from the staged snapshot.', {
            expectedFingerprint: expectedFingerprint, retryable: false
          });
      }
    } catch (caught) {
      try {
        adapter.writeTarget(before);
        if (!freshnessRowsMatch_(before, adapter.readTarget())) {
          throw AKORT.Core.error('BETA23_FRESHNESS_ROLLBACK_READBACK_MISMATCH',
            'Freshness target could not be restored after a failed refresh.', {
              retryable: false, requiresReview: true
            });
        }
      } catch (restoreFailure) {
        restoreFailure.details = restoreFailure.details || {};
        restoreFailure.details.originalErrorCode = text_(caught && caught.code);
        throw restoreFailure;
      }
      throw caught;
    }

    return {
      rowsWritten: rows.length,
      readbackVerified: true,
      applicationAtomic: true,
      snapshotFingerprint: expectedFingerprint
    };
  }

  function replaceFreshness_(rows) {
    var uniqueness = uniqueMemberIds_(rows);
    if (uniqueness.duplicates.length) {
      throw AKORT.Core.error('BETA23_FRESHNESS_DUPLICATE_MEMBER',
        'Freshness projection contains duplicate members.', {
          duplicates: uniqueness.duplicates, retryable: false
        });
    }
    if (rows.length > MAX_FRESHNESS_MEMBERS) {
      throw AKORT.Core.error('BETA23_FRESHNESS_BOUND_EXCEEDED',
        'Freshness projection exceeded its bounded contract.', {
          rows: rows.length, maximum: MAX_FRESHNESS_MEMBERS, retryable: false
        });
    }

    return withFreshnessLock_(function () {
      var target = ensureFreshnessTable_();
      var stage = ensureFreshnessStageTable_();
      var result = runFreshnessTransaction_({
        readTarget: function () { return freshnessObjectsFromSheet_(target); },
        writeTarget: function (values) { writeFreshnessSheet_(target, values); },
        readStage: function () { return freshnessObjectsFromSheet_(stage); },
        writeStage: function (values) { writeFreshnessSheet_(stage, values); }
      }, rows);
      result.uniqueMembers = uniqueness.uniqueCount;
      result.stageTable = FRESHNESS_STAGE_TABLE;
      result.targetTable = FRESHNESS_TABLE;
      return result;
    });
  }

  function refreshFreshness() {
    return auditedWrite_('BETA23_REFRESH_FRESHNESS', 'REFRESH_FRESHNESS', '', '', function () {
      assertWriteContext_('ADMIN', true);
      var started = Date.now();
      var sources = projectionSources_();
      var latestReconciliation = latestBy_(sources.reconciliations,
        ['checked_at'], function (row) {
          return ['SUCCESS','PASS'].indexOf(text_(row.status).toUpperCase()) >= 0;
        });
      if (!latestReconciliation) {
        throw AKORT.Core.error('BETA23_RECONCILIATION_NOT_SUCCESSFUL',
          'A successful Publish reconciliation is required.', { retryable: false });
      }
      var operationsByProfile = latestSuccessfulProfileOperations_(
        sources.operations, sources.publishRuns
      );
      var observedAt = new Date().toISOString();
      var categoryScopes = profileCategoryScopes_(sources.mappings);
      var rows = profileFreshnessRows_(sources.weekly, sources.monthly,
        operationsByProfile, latestReconciliation, observedAt, categoryScopes);
      rows = rows.concat(industryFreshnessRows_(sources.dimensions,
        sources.industry, latestIndustryLoads_(sources.operations, sources.publishRuns),
        latestReconciliation, observedAt));
      var write = replaceFreshness_(rows);
      var profileCoverage = {};
      PROFILE_MEMBERS.forEach(function (member) { profileCoverage[member.profileId] = true; });
      var sourceFingerprint = AKORT.Core.sha256(AKORT.Core.canonicalJson({
        weeklyLatest: sources.weekly.filter(function (row) { return truthy_(row.is_latest_period); }),
        monthlyLatest: sources.monthly.filter(function (row) { return truthy_(row.is_latest_period); }),
        industryLatest: sources.industry.filter(function (row) { return truthy_(row.is_latest_period); }),
        reconciliation: latestReconciliation
      }));
      return AKORT.Result.success('Сведения об актуальности обновлены.', {
        packageVersion: PACKAGE_VERSION, contractVersion: CONTRACT_VERSION,
        observedAt: observedAt, durationMs: Date.now() - started,
        memberCount: rows.length, profileCount: Object.keys(profileCoverage).length,
        activeIndustrySeries: rows.filter(function (row) {
          return row.display_family_id === 'INDUSTRY';
        }).length,
        duplicateCount: 0, sourceFingerprint: sourceFingerprint,
        reconciliationStatus: text_(latestReconciliation.status),
        write: write, productionTouched: false, userPipelineEnabled: false
      });
    });
  }

  function qualityRank_(value) {
    return { GOOD: 1, CURRENT: 1, WARNING: 2, NOT_INITIALIZED: 2,
      STALE: 3, ERROR: 4, CRITICAL: 5 }[text_(value).toUpperCase()] || 2;
  }

  function groupFreshness_(rows, includeTechnical) {
    var groups = {};
    (rows || []).forEach(function (row) {
      var period = text_(row.canonical_period_key) || 'PERIOD_UNKNOWN';
      var key = [text_(row.display_family_id), text_(row.frequency), period].join('|');
      var group = groups[key];
      if (!group) {
        var family = DISPLAY_FAMILIES[text_(row.display_family_id)] ||
          { titleRu: 'Прочие показатели', order: 999 };
        group = groups[key] = {
          groupId: key, displayFamilyId: text_(row.display_family_id),
          titleRu: family.titleRu, familyOrder: family.order,
          frequency: text_(row.frequency), frequencyRu: frequencyRu_(row.frequency),
          canonicalPeriodKey: period === 'PERIOD_UNKNOWN' ? '' : period,
          periodLabelRu: text_(row.period_label_ru) || 'Период не определён',
          memberCount: 0, memberNames: [], latestLoadedAt: '',
          freshnessStatus: 'CURRENT', qualityStatus: 'GOOD', issueCount: 0,
          members: []
        };
      }
      group.memberCount += 1;
      group.memberNames.push(text_(row.indicator_name_ru));
      group.issueCount += Number(row.issue_count || 0);
      if (dateIso_(row.latest_loaded_at) > group.latestLoadedAt) {
        group.latestLoadedAt = dateIso_(row.latest_loaded_at);
      }
      if (qualityRank_(row.quality_status) > qualityRank_(group.qualityStatus)) {
        group.qualityStatus = text_(row.quality_status);
      }
      if (qualityRank_(row.freshness_status) > qualityRank_(group.freshnessStatus)) {
        group.freshnessStatus = text_(row.freshness_status);
      }
      var member = {
        memberId: text_(row.freshness_member_id),
        indicatorNameRu: text_(row.indicator_name_ru),
        sourceNameRu: text_(row.source_name_ru),
        frequency: text_(row.frequency),
        canonicalPeriodKey: text_(row.canonical_period_key),
        periodLabelRu: text_(row.period_label_ru),
        latestLoadedAt: dateIso_(row.latest_loaded_at),
        freshnessStatusRu: ruStatus_(row.freshness_status),
        qualityStatusRu: ruStatus_(row.quality_status),
        issueCount: Number(row.issue_count || 0)
      };
      if (includeTechnical) {
        member.latestLoadId = text_(row.latest_load_id);
        member.latestOperationId = text_(row.latest_operation_id);
        member.technicalDetails = {
          datasetCode: text_(row.dataset_code), profileId: text_(row.profile_id),
          seriesId: text_(row.series_id), indicatorCode: text_(row.indicator_code),
          snapshotFingerprint: text_(row.snapshot_fingerprint)
        };
      }
      group.members.push(member);
    });
    var frequencyOrder = { WEEKLY: 10, MONTHLY: 20, QUARTERLY: 30, ANNUAL: 40 };
    return Object.keys(groups).map(function (key) {
      var group = groups[key];
      group.memberNames.sort();
      group.members.sort(function (a, b) {
        return a.indicatorNameRu.localeCompare(b.indicatorNameRu);
      });
      group.memberSummaryRu = group.memberNames.join(', ');
      group.freshnessStatusRu = ruStatus_(group.freshnessStatus);
      group.qualityStatusRu = ruStatus_(group.qualityStatus);
      if (!includeTechnical) delete group.familyOrder;
      return group;
    }).sort(function (left, right) {
      return (frequencyOrder[left.frequency] || 99) - (frequencyOrder[right.frequency] || 99) ||
        text_(right.canonicalPeriodKey).localeCompare(text_(left.canonicalPeriodKey)) ||
        Number(left.familyOrder || 999) - Number(right.familyOrder || 999) ||
        left.titleRu.localeCompare(right.titleRu);
    }).map(function (group) {
      delete group.familyOrder;
      return group;
    });
  }

  function dataFreshness() {
    return AKORT.Core.safeRun('BETA23_DATA_FRESHNESS', function () {
      assertBase_();
      var role = assertRole_('VIEWER');
      var rows = readFreshnessRows_();
      var observedAt = rows.reduce(function (latest, row) {
        var value = dateIso_(row.observed_at);
        return value > latest ? value : latest;
      }, '');
      return AKORT.Result.success(rows.length ?
        'Сведения об актуальности загружены.' :
        'Сведения об актуальности ещё не сформированы.', {
        packageVersion: PACKAGE_VERSION, contractVersion: CONTRACT_VERSION,
        initialized: rows.length > 0, observedAt: observedAt,
        memberCount: rows.length,
        groups: groupFreshness_(rows, role.role === 'ADMIN'),
        readBoundary: 'USER_DATA_FRESHNESS_ONLY',
        rawTargetReads: 0, publishTargetReads: 0,
        productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function localizeOverview_(source, role) {
    var data = clone_(source || {});
    if (data.system) {
      data.system.statusLabel = ruStatus_(data.system.overallStatus);
      data.system.nextActionsRu = (data.system.nextActions || []).map(ruNextAction_);
    }
    (data.datasets || []).forEach(function (row) {
      row.healthStatusRu = ruStatus_(row.healthStatus);
      row.freshnessStatusRu = ruStatus_(row.freshnessStatus);
      row.nextActionRu = ruNextAction_(row.nextAction);
    });
    (data.issues || []).forEach(function (row) {
      row.severityRu = ruSeverity_(row.severity);
      row.nextActionRu = ruNextAction_(row.nextAction);
      if (!row.resolution) row.resolution = 'Проверьте сведения и выполните указанное действие.';
    });
    if (data.activeOperation) {
      data.activeOperation.statusRu = ruStatus_(data.activeOperation.status);
      data.activeOperation.phaseRu = ruPhase_(data.activeOperation.phase);
      data.activeOperation.nextActionRu = ruNextAction_(data.activeOperation.nextAction);
    }
    if (data.backup) {
      data.backup.statusRu = ruStatus_(data.backup.status);
      data.backup.freshnessStatusRu = ruStatus_(data.backup.freshnessStatus);
    }
    if (data.trigger) {
      data.trigger.statusRu = ruStatus_(data.trigger.status);
      data.trigger.nextActionRu = ruNextAction_(data.trigger.nextAction);
    }
    if (data.fullAudit && data.fullAudit.evidence) {
      data.fullAudit.evidence.statusRu = ruStatus_(data.fullAudit.evidence.status);
    }
    data.user = data.user || {};
    data.user.role = role.role;
    data.user.roleRu = { VIEWER: 'Наблюдатель', OPERATOR: 'Оператор', ADMIN: 'Администратор' }[role.role];
    return data;
  }

  function overview() {
    return AKORT.Core.safeRun('BETA23_OVERVIEW', function () {
      assertBase_();
      var role = assertRole_('VIEWER');
      var base = requireSuccess_('AKORT.Beta21ReadOnlyControlCenter.status',
        AKORT.Beta21ReadOnlyControlCenter.status());
      var freshness = dataFreshness();
      var flags = settingsState_();
      return AKORT.Result.success('Центр управления загружен.', {
        packageVersion: PACKAGE_VERSION, contractVersion: CONTRACT_VERSION,
        generatedAt: new Date().toISOString(), role: role,
        overview: localizeOverview_(base, role),
        freshness: freshness.ok ? freshness.data : {
          initialized: false, memberCount: 0, groups: [], observedAt: ''
        },
        operatorActions: {
          enabled: flags.beta23OperatorActionsEnabled,
          beta22ControlledSubmitEnabled: flags.beta22ControlledSubmitEnabled,
          userPipelineEnabled: flags.userPipelineEnabled,
          canOperate: ROLE_RANK[role.role] >= ROLE_RANK.OPERATOR,
          canAdminister: role.role === 'ADMIN'
        },
        safety: {
          newOperationType: false, newQueue: false, newExecutor: false,
          newDispatcher: false, createsTrigger: false,
          productionTouched: false, userPipelineEnabled: false
        }
      });
    }, { lock: false, persistLogs: false });
  }

  function compactOperation_(engineData) {
    var operation = engineData && (engineData.operation || engineData) || {};
    var checkpoint = operation.checkpoint || parseCheckpoint_(operation.checkpoint_json);
    var completed = checkpoint.completedPhases || [];
    var total = 16;
    var progress = TERMINAL[text_(operation.status).toUpperCase()] ? 100 :
      Math.min(99, Math.round(completed.length / total * 100));
    return {
      operationId: text_(operation.operation_id || operation.operationId),
      operationType: text_(operation.operation_type || operation.operationType),
      operationTypeRu: ruOperationType_(operation.operation_type || operation.operationType),
      status: text_(operation.status), statusRu: ruStatus_(operation.status),
      phase: text_(operation.current_phase || operation.currentPhase),
      phaseRu: ruPhase_(operation.current_phase || operation.currentPhase),
      progressPercent: progress,
      requestedAt: dateIso_(operation.requested_at || operation.requestedAt),
      startedAt: dateIso_(operation.started_at || operation.startedAt),
      finishedAt: dateIso_(operation.finished_at || operation.finishedAt),
      errorCode: text_(operation.error_code || operation.errorCode),
      errorMessageRu: operation.error_code ? ruError_(operation.error_code) : '',
      terminal: Boolean(TERMINAL[text_(operation.status).toUpperCase()]),
      nextActionRu: TERMINAL[text_(operation.status).toUpperCase()] ?
        'Действий не требуется' :
        CONTINUABLE[text_(operation.status).toUpperCase()] ?
          'Операцию можно продолжить' : 'Обновите статус'
    };
  }

  function backupStatus() {
    return AKORT.Core.safeRun('BETA23_BACKUP_STATUS', function () {
      assertBase_();
      assertRole_('VIEWER');
      var data = requireSuccess_('AKORT.Beta11PairedBackup.status',
        AKORT.Beta11PairedBackup.status());
      var active = data.activeOperation && data.activeOperation.ok === true ?
        compactOperation_(data.activeOperation.data) : null;
      return AKORT.Result.success('Статус резервного копирования загружен.', {
        latestBackup: clone_(data.latestBackup || null),
        activeOperation: active,
        triggerCounts: clone_(data.triggerCounts || {}),
        scheduleRu: 'Ежедневно около 04:00 по московскому времени',
        productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function startBackup() {
    return auditedWrite_('BETA23_START_BACKUP', 'BACKUP_NOW', '', '', function () {
      assertWriteContext_('OPERATOR', true);
      var result = AKORT.Beta11PairedBackup.backupNow();
      if (!result || typeof result.ok !== 'boolean') {
        throw AKORT.Core.error('BETA23_BACKUP_RESULT_INVALID',
          'Backup facade returned an invalid result.', { retryable: false });
      }
      var data = result.data || {};
      var operationId = text_(data.operationId || data.operation &&
        (data.operation.operationId || data.operation.operation_id));
      return result.ok ? AKORT.Result.success('Резервное копирование принято.', {
        accepted: true, actionTypeRu: 'Создание резервной копии',
        operationId: operationId, reused: Boolean(data.reused),
        statusRu: ruStatus_(result.status), progressPercent: null,
        nextActionRu: 'Следите за статусом операции.',
        warningRu: 'Копируются DWH TECH и Publish DEV.',
        productionTouched: false
      }) : result;
    });
  }

  function latestSuccessfulLoad_() {
    var rows = readTableObjects_(dwh_(), 'RAW_LOAD_REGISTRY', null,
      MAX_LOAD_SOURCE_ROWS).filter(function (row) {
      return text_(row.status).toUpperCase() === 'COMMITTED';
    });
    return latestBy_(rows, ['finished_at','started_at']);
  }

  function quickAudit() {
    return auditedWrite_('BETA23_QUICK_AUDIT', 'QUICK_AUDIT', '', '', function () {
      assertWriteContext_('OPERATOR', true);
      var checks = [];
      function check(id, ok, message, details) {
        checks.push({ id: id, status: ok ? 'PASS' : 'FAIL',
          statusRu: ok ? 'Проверка пройдена' : 'Проверка не пройдена',
          messageRu: message, details: details || null });
      }
      var observability = AKORT.Beta15CompactObservability.status();
      check('OBSERVABILITY', observability && observability.ok === true &&
        observability.data && observability.data.overallStatus === 'HEALTHY',
        'Операционная наблюдаемость должна быть в норме.',
        observability && observability.data || null);
      var hardening = AKORT.Beta14OperationalHardening.status();
      check('OPERATIONAL_HARDENING', hardening && hardening.ok === true &&
        hardening.data && hardening.data.healthy === true,
        'Защита от конфликтующих операций должна быть активна.',
        hardening && hardening.data || null);
      var latestLoad = latestSuccessfulLoad_();
      var rawAudit = latestLoad ? AKORT.RawStore.auditLoad(text_(latestLoad.load_id)) : null;
      check('LATEST_RAW_LOAD', Boolean(latestLoad) && rawAudit && rawAudit.ok !== false,
        latestLoad ? 'Последняя зафиксированная загрузка RAW проверена.' :
          'Успешная загрузка RAW не найдена.', rawAudit || latestLoad);
      var publishRuns = readTableObjects_(dwh_(), 'PUBLISH_RUNS', null,
        MAX_LOAD_SOURCE_ROWS);
      var latestPublish = latestBy_(publishRuns, ['finished_at','started_at'], function (row) {
        return text_(row.status).toUpperCase() === 'SUCCESS';
      });
      check('LATEST_PUBLISH_RUN', Boolean(latestPublish),
        latestPublish ? 'Последнее обновление Publish завершено.' :
          'Успешное обновление Publish не найдено.', latestPublish);
      var reconciliations = readTableObjects_(dwh_(), 'PUBLISH_RECONCILIATION', null,
        MAX_LOAD_SOURCE_ROWS);
      var reconciliation = latestBy_(reconciliations, ['checked_at'], function (row) {
        return ['SUCCESS','PASS'].indexOf(text_(row.status).toUpperCase()) >= 0;
      });
      check('LATEST_RECONCILIATION', Boolean(reconciliation),
        reconciliation ? 'Последняя сверка опубликованных данных успешна.' :
          'Успешная сверка Publish не найдена.', reconciliation);
      var passed = checks.filter(function (row) { return row.status === 'PASS'; }).length;
      var failed = checks.length - passed;
      var evidenceRef = 'QA_' + AKORT.Core.sha256(
        AKORT.Core.canonicalJson(checks)
      ).slice(0, 20).toUpperCase();
      return failed ? AKORT.Result.failure('BETA23_QUICK_AUDIT_FAILED',
        'Быстрая проверка выявила проблемы.', {
          accepted: true, actionTypeRu: 'Быстрая проверка', operationId: '',
          statusRu: 'Требует внимания', passed: passed, failed: failed,
          evidenceRef: evidenceRef, checks: checks, productionTouched: false
        }) : AKORT.Result.success('Быстрая проверка завершена.', {
          accepted: true, actionTypeRu: 'Быстрая проверка', operationId: '',
          reused: false, statusRu: 'Проверка пройдена', progressPercent: 100,
          nextActionRu: 'Действий не требуется', warningRu: '',
          passed: passed, failed: failed, evidenceRef: evidenceRef,
          checks: checks, productionTouched: false
        });
    });
  }

  function auditStatus() {
    return AKORT.Core.safeRun('BETA23_AUDIT_STATUS', function () {
      assertBase_();
      assertRole_('VIEWER');
      var data = requireSuccess_('AKORT.Beta16OperatorFacade.statusLatest',
        AKORT.Beta16OperatorFacade.statusLatest());
      var operation = data.operation && (data.operation.operation || data.operation);
      return AKORT.Result.success('Статус полной проверки загружен.', {
        operation: operation ? compactOperation_(operation) : null,
        evidence: data.evidence ? {
          auditId: text_(data.evidence.audit_id),
          statusRu: ruStatus_(data.evidence.audit_status || data.evidence.status),
          checksTotal: Number(data.evidence.checks_total || 0),
          checksPassed: Number(data.evidence.checks_passed || 0),
          checksWarned: Number(data.evidence.checks_warned || 0),
          checksFailed: Number(data.evidence.checks_failed || 0),
          finishedAt: dateIso_(data.evidence.finished_at),
          evidenceFingerprint: text_(data.evidence.evidence_hash)
        } : null,
        retention: clone_(data.retention || null), productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function startFullAudit() {
    return auditedWrite_('BETA23_START_FULL_AUDIT', 'FULL_AUDIT', '', '', function () {
      assertWriteContext_('OPERATOR', true);
      var result = AKORT.Beta16FullAuditRetention.submit(
        'Beta.2.3 пользовательская полная проверка'
      );
      if (!result || typeof result.ok !== 'boolean') {
        throw AKORT.Core.error('BETA23_FULL_AUDIT_RESULT_INVALID',
          'Full Audit facade returned an invalid result.', { retryable: false });
      }
      if (!result.ok) return result;
      var data = result.data || {};
      return AKORT.Result.success('Полная проверка принята.', {
        accepted: true, actionTypeRu: 'Полная проверка системы',
        operationId: text_(data.operationId), reused: data.reused === true,
        statusRu: 'Ожидает выполнения', progressPercent: 0,
        nextActionRu: 'Следите за статусом и продолжайте операцию только при необходимости.',
        warningRu: 'Полная проверка выполняется по безопасным контрольным точкам.',
        productionTouched: false
      });
    });
  }

  function loadPeriod_(operation) {
    var profile = operationProfile_(operation);
    if (profile.week && profile.year) return canonicalFromParts_('WEEKLY', profile.year, 0, profile.week);
    if (profile.month && profile.year) return canonicalFromParts_('MONTHLY', profile.year, profile.month, 0);
    return '';
  }

  function searchLoads(query) {
    return AKORT.Core.safeRun('BETA23_SEARCH_LOADS', function () {
      assertBase_();
      assertRole_('VIEWER');
      query = query || {};
      var limit = Number(query.limit || DEFAULT_LOAD_SEARCH_ROWS);
      if (!isFinite(limit) || limit < 1 || limit > MAX_LOAD_SEARCH_ROWS) {
        throw AKORT.Core.error('BETA23_LOAD_SEARCH_INVALID',
          'Search result limit is invalid.', { retryable: false });
      }
      var dwh = dwh_();
      var loads = readTableObjects_(dwh, 'RAW_LOAD_REGISTRY', null, MAX_LOAD_SOURCE_ROWS);
      var operations = readTableObjects_(dwh, 'OPERATION_QUEUE',
        AKORT.Core.Tables.OPERATION_QUEUE, MAX_LOAD_SOURCE_ROWS);
      var operationsById = {};
      operations.forEach(function (operation) {
        operationsById[text_(operation.operation_id)] = operation;
      });
      var from = query.dateFrom ? Date.parse(text_(query.dateFrom)) : 0;
      var to = query.dateTo ? Date.parse(text_(query.dateTo) + 'T23:59:59Z') : 0;
      if ((query.dateFrom && isNaN(from)) || (query.dateTo && isNaN(to))) {
        throw AKORT.Core.error('BETA23_LOAD_SEARCH_INVALID',
          'Search date range is invalid.', { retryable: false });
      }
      var matched = loads.filter(function (load) {
        var operation = operationsById[text_(load.operation_id)] || {};
        var profile = operationProfile_(operation);
        var period = loadPeriod_(operation);
        var timestamp = Date.parse(dateIso_(load.finished_at || load.started_at)) || 0;
        if (query.loadId && text_(load.load_id) !== text_(query.loadId)) return false;
        if (query.operationId && text_(load.operation_id) !== text_(query.operationId)) return false;
        if (query.fileName && norm_(load.source_name).indexOf(norm_(query.fileName)) < 0) return false;
        if (query.source && [
          load.source_name, load.source_id, profile.profileId,
          profileLabelRu_(profile.profileId)
        ].map(norm_).join('|').indexOf(norm_(query.source)) < 0) return false;
        if (query.profileId && profile.profileId !== text_(query.profileId)) return false;
        if (query.period && period !== text_(query.period)) return false;
        if (query.status && text_(load.status).toUpperCase() !== text_(query.status).toUpperCase()) return false;
        if (from && timestamp < from) return false;
        if (to && timestamp > to) return false;
        return true;
      }).sort(function (left, right) {
        return dateIso_(right.finished_at || right.started_at)
          .localeCompare(dateIso_(left.finished_at || left.started_at));
      });
      var rows = matched.slice(0, limit).map(function (load) {
        var operation = operationsById[text_(load.operation_id)] || {};
        var profile = operationProfile_(operation);
        return {
          loadId: text_(load.load_id), operationId: text_(load.operation_id),
          sourceNameRu: text_(load.source_name) || 'Источник не указан',
          fileName: profile.fileName || text_(load.source_name),
          profileId: profile.profileId,
          profileNameRu: profileLabelRu_(profile.profileId),
          period: loadPeriod_(operation),
          periodRu: periodLabelFromCanonical_(loadPeriod_(operation), profile.profileId),
          status: text_(load.status), statusRu: ruStatus_(load.status),
          targetTable: text_(load.target_table),
          rowsReceived: Number(load.rows_received || 0),
          rowsInserted: Number(load.rows_inserted || 0),
          rowsRevised: Number(load.rows_revised || 0),
          rowsUnchanged: Number(load.rows_unchanged || 0),
          rowsReversed: Number(load.rows_reversed || 0),
          finishedAt: dateIso_(load.finished_at || load.started_at),
          rollbackAvailable: text_(load.status).toUpperCase() === 'COMMITTED'
        };
      });
      return AKORT.Result.success('Загрузки найдены.', {
        totalMatched: matched.length, returnedCount: rows.length,
        truncated: matched.length > rows.length, rows: rows,
        maximumReturned: MAX_LOAD_SEARCH_ROWS, physicalRawRowsRead: 0,
        productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function confirmationSecret_() {
    var secret = text_(properties_().getProperty(CONFIRMATION_SECRET_PROPERTY));
    if (!secret) {
      throw AKORT.Core.error('BETA23_CONFIRMATION_SECRET_MISSING',
        'Confirmation secret is not configured.', { retryable: false });
    }
    return secret;
  }

  function base64UrlEncode_(value) {
    return Utilities.base64EncodeWebSafe(String(value), Utilities.Charset.UTF_8)
      .replace(/=+$/g, '');
  }

  function base64UrlDecode_(value) {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(String(value))).getDataAsString();
  }

  function bytesHex_(bytes) {
    return (bytes || []).map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function sign_(payloadText) {
    return bytesHex_(Utilities.computeHmacSha256Signature(
      String(payloadText), confirmationSecret_(), Utilities.Charset.UTF_8
    ));
  }

  function createRollbackBinding_(preview, loadId, reason, email) {
    var now = Date.now();
    var payload = {
      schemaVersion: FRESHNESS_CONFIRMATION_SCHEMA,
      loadId: text_(loadId), reasonHash: AKORT.Core.sha256(text_(reason)),
      token: text_(preview.confirmationToken),
      lineageFingerprint: text_(preview.fingerprints && preview.fingerprints.lineage),
      impactFingerprint: text_(preview.fingerprints && preview.fingerprints.impact),
      sourceOperationFingerprint: text_(preview.fingerprints && preview.fingerprints.sourceOperation),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CONFIRMATION_TTL_MS).toISOString(),
      userHash: AKORT.Core.sha256(text_(email).toLowerCase())
    };
    var encoded = base64UrlEncode_(AKORT.Core.canonicalJson(payload));
    return {
      opaque: encoded + '.' + sign_(encoded),
      expiresAt: payload.expiresAt,
      fingerprint: AKORT.Core.sha256(encoded)
    };
  }

  function parseRollbackBinding_(opaque, loadId, reason, email) {
    var parts = text_(opaque).split('.');
    if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) {
      throw AKORT.Core.error('BETA23_ROLLBACK_CONFIRMATION_INVALID',
        'Rollback confirmation is invalid.', { retryable: false });
    }
    var payload;
    try { payload = JSON.parse(base64UrlDecode_(parts[0])); }
    catch (caught) {
      throw AKORT.Core.error('BETA23_ROLLBACK_CONFIRMATION_INVALID',
        'Rollback confirmation cannot be read.', { retryable: false });
    }
    var valid = payload.schemaVersion === FRESHNESS_CONFIRMATION_SCHEMA &&
      text_(payload.loadId) === text_(loadId) &&
      text_(payload.reasonHash) === AKORT.Core.sha256(text_(reason)) &&
      text_(payload.userHash) === AKORT.Core.sha256(text_(email).toLowerCase()) &&
      Date.parse(text_(payload.expiresAt)) > Date.now();
    if (!valid) {
      throw AKORT.Core.error('BETA23_ROLLBACK_CONFIRMATION_INVALID',
        'Rollback confirmation is stale or mismatched.', { retryable: false });
    }
    return { payload: payload, fingerprint: AKORT.Core.sha256(parts[0]) };
  }

  function rollbackPreview(loadId, reason) {
    return auditedWrite_('BETA23_ROLLBACK_PREVIEW', 'ROLLBACK_PREVIEW',
      loadId, reason, function () {
      assertBase_();
      var role = assertRole_('ADMIN');
      reason = text_(reason).replace(/\s+/g, ' ');
      var preview = requireSuccess_('AKORT.Beta12RollbackFacade.preview',
        AKORT.Beta12RollbackFacade.preview(text_(loadId), reason));
      var binding = createRollbackBinding_(preview, loadId, reason, role.email);
      return AKORT.Result.success(preview.eligibility && preview.eligibility.eligible ?
        'Откат можно подтвердить.' : 'Откат заблокирован.', {
        eligible: Boolean(preview.eligibility && preview.eligibility.eligible),
        targetLoad: clone_(preview.targetLoad), reasonNormalized: reason,
        impactSummaryRu: preview.eligibility && preview.eligibility.eligible ?
          'Будет выполнен логический откат выбранной загрузки и восстановлено предыдущее состояние.' :
          'Откат нельзя выполнить из-за защитных ограничений.',
        targetRowCount: Number(preview.eligibility && preview.eligibility.targetRowCount || 0),
        restoredRowCount: Number(preview.restoration && preview.restoration.restoredRowCount || 0),
        unrestoredRowCount: Number(preview.restoration && preview.restoration.unrestoredRowCount || 0),
        affectedSeriesCount: Number(preview.impact &&
          (preview.impact.affectedSeriesCount || preview.impact.seriesCount) || 0),
        blockersRu: (preview.eligibility && preview.eligibility.blockers || []).map(function () {
          return 'Защитное условие не выполнено. Требуется техническая проверка.';
        }),
        confirmationBinding: binding.opaque,
        confirmationFingerprint: binding.fingerprint,
        expiresAt: binding.expiresAt,
        technicalDetails: {
          impact: clone_(preview.impact || null),
          lineageFingerprint: text_(preview.fingerprints && preview.fingerprints.lineage),
          impactFingerprint: text_(preview.fingerprints && preview.fingerprints.impact)
        },
        productionTouched: false
      });
    });
  }

  function rollbackSubmit(loadId, reason, confirmationBinding) {
    return auditedWrite_('BETA23_ROLLBACK_SUBMIT', 'ROLLBACK', loadId, reason, function () {
      assertBase_();
      var role = assertRole_('ADMIN');
      var context = assertWriteContext_('ADMIN', false);
      var parsed = parseRollbackBinding_(confirmationBinding, loadId, reason, role.email);
      var refreshed = requireSuccess_('AKORT.Beta12RollbackFacade.preview',
        AKORT.Beta12RollbackFacade.preview(text_(loadId), text_(reason)));
      var payload = parsed.payload;
      var exact = text_(refreshed.confirmationToken) === text_(payload.token) &&
        text_(refreshed.fingerprints && refreshed.fingerprints.lineage) === text_(payload.lineageFingerprint) &&
        text_(refreshed.fingerprints && refreshed.fingerprints.impact) === text_(payload.impactFingerprint) &&
        text_(refreshed.fingerprints && refreshed.fingerprints.sourceOperation) === text_(payload.sourceOperationFingerprint);
      if (!exact || !refreshed.eligibility || refreshed.eligibility.eligible !== true) {
        throw AKORT.Core.error('BETA23_ROLLBACK_CONFIRMATION_INVALID',
          'Rollback preview changed and must be repeated.', { retryable: false });
      }
      var result = AKORT.Beta12RollbackFacade.submit(
        text_(loadId), text_(reason), text_(payload.token)
      );
      if (!result || typeof result.ok !== 'boolean') {
        throw AKORT.Core.error('BETA23_ROLLBACK_RESULT_INVALID',
          'Rollback facade returned an invalid result.', { retryable: false });
      }
      if (!result.ok) return result;
      var data = result.data || {};
      var operation = data.operation || {};
      return AKORT.Result.success('Откат принят.', {
        accepted: true, actionTypeRu: 'Откат загрузки',
        operationId: text_(operation.operationId || operation.operation_id),
        reused: Boolean(data.submission && data.submission.reused),
        statusRu: ruStatus_(operation.status),
        progressPercent: operation.status === 'SUCCESS' ? 100 : null,
        nextActionRu: text_(data.nextAction) ? ruNextAction_(data.nextAction) : 'Следите за статусом операции.',
        warningRu: 'Откат является логическим и не восстанавливает резервную копию.',
        confirmationFingerprint: parsed.fingerprint,
        productionTouched: false,
        writeGate: context.flags
      });
    });
  }

  function rollbackStatus(operationId) {
    return AKORT.Core.safeRun('BETA23_ROLLBACK_STATUS', function () {
      assertBase_();
      assertRole_('ADMIN');
      var data = requireSuccess_('AKORT.Beta12RollbackFacade.status',
        AKORT.Beta12RollbackFacade.status(text_(operationId)));
      return AKORT.Result.success('Статус отката загружен.', {
        operation: compactOperation_(data.operation),
        target: clone_(data.target || null), reversal: clone_(data.reversal || null),
        dependencies: clone_(data.dependencies || null),
        nextActionRu: ruNextAction_(data.nextAction), productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function assertAllowedOperation_(operationId, role, enforceActionRole) {
    var data = requireSuccess_('AKORT.OperationEngine.status',
      AKORT.OperationEngine.status(text_(operationId)));
    var operation = data.operation || {};
    var type = text_(operation.operation_type || operation.operationType);
    var minimum = ALLOWED_OPERATION_TYPES[type];
    if (!minimum || (enforceActionRole === true && ROLE_RANK[role.role] < ROLE_RANK[minimum])) {
      throw AKORT.Core.error('BETA23_OPERATION_NOT_ALLOWED',
        'The selected operation is not available through Beta.2.3.', {
          operationType: type, retryable: false
        });
    }
    var origin = assertOperationOrigin_(operation, role);
    return { data: data, operation: operation, minimumRole: minimum, origin: origin };
  }

  function operationStatus(operationId) {
    return AKORT.Core.safeRun('BETA23_OPERATION_STATUS', function () {
      assertBase_();
      var role = assertRole_('VIEWER');
      var selected = assertAllowedOperation_(operationId, role, false);
      return AKORT.Result.success('Статус операции загружен.', {
        operation: compactOperation_(selected.operation), productionTouched: false
      });
    }, { lock: false, persistLogs: false });
  }

  function continueOperation(operationId) {
    return auditedWrite_('BETA23_CONTINUE_OPERATION', 'CONTINUE_OPERATION',
      operationId, '', function () {
        assertBase_();
        var role = assertRole_('OPERATOR');
        assertWriteContext_('OPERATOR', false);
        var selected = assertAllowedOperation_(operationId, role, true);
        var status = text_(selected.operation.status).toUpperCase();
        if (!CONTINUABLE[status]) {
          throw AKORT.Core.error('BETA23_OPERATION_CONTINUE_NOT_ALLOWED',
            'Operation is not continuable.', { status: status, retryable: false });
        }
        var resumed = requireSuccess_('AKORT.OperationEngine.resume',
          AKORT.OperationEngine.resume(text_(operationId), { maxSteps: 1 }));
        assertAllowedOperation_(operationId, role, true);
        return AKORT.Result.success('Операция продолжена на один безопасный шаг.', {
          accepted: true, actionTypeRu: 'Продолжение операции',
          operationId: text_(operationId), reused: true,
          operation: compactOperation_(resumed),
          statusRu: ruStatus_(resumed.operation && resumed.operation.status),
          nextActionRu: 'Обновите статус операции.', productionTouched: false
        });
      });
  }

  function stopOperation(operationId, reason) {
    return auditedWrite_('BETA23_STOP_OPERATION', 'STOP_OPERATION',
      operationId, reason, function () {
        assertBase_();
        var role = assertRole_('ADMIN');
        assertWriteContext_('ADMIN', false);
        assertAllowedOperation_(operationId, role, true);
        var stopped = requireSuccess_('AKORT.OperationEngine.requestStop',
          AKORT.OperationEngine.requestStop(text_(operationId)));
        assertAllowedOperation_(operationId, role, true);
        return AKORT.Result.success('Запрошена безопасная остановка операции.', {
          accepted: true, actionTypeRu: 'Безопасная остановка',
          operationId: text_(operationId), reused: true,
          operation: compactOperation_(stopped.operation || stopped),
          statusRu: 'Операция приостановлена',
          nextActionRu: 'Дождитесь сохранения контрольной точки и обновите статус.',
          productionTouched: false
        });
      });
  }

  function retryOperation(operationId, reason) {
    return auditedWrite_('BETA23_RETRY_OPERATION', 'RETRY_OPERATION',
      operationId, reason, function () {
        assertBase_();
        var role = assertRole_('ADMIN');
        assertWriteContext_('ADMIN', false);
        var selected = assertAllowedOperation_(operationId, role, true);
        var status = text_(selected.operation.status).toUpperCase();
        if (['PAUSED','RETRY_PENDING'].indexOf(status) < 0) {
          throw AKORT.Core.error('BETA23_OPERATION_RETRY_NOT_ALLOWED',
            'Automatic retry is not allowed for this operation state.', {
              status: status, retryable: false
            });
        }
        var resumed = requireSuccess_('AKORT.OperationEngine.resume',
          AKORT.OperationEngine.resume(text_(operationId), { maxSteps: 1 }));
        assertAllowedOperation_(operationId, role, true);
        return AKORT.Result.success('Повторная попытка выполнена на один безопасный шаг.', {
          accepted: true, actionTypeRu: 'Повторная попытка',
          operationId: text_(operationId), reused: true,
          operation: compactOperation_(resumed),
          statusRu: ruStatus_(resumed.operation && resumed.operation.status),
          nextActionRu: 'Обновите статус операции.', productionTouched: false
        });
      });
  }

  function preflight() {
    return AKORT.Core.safeRun('BETA23_PREFLIGHT', function () {
      var blockers = [];
      try { assertBase_(); } catch (caught) { blockers.push(caught.code || 'BASE_INVALID'); }
      var access = accessStatus_();
      if (!access.authorized) blockers.push('ACCESS_NOT_AUTHORIZED');
      var role;
      try { role = roleStatus_(); } catch (caughtRole) {
        blockers.push(caughtRole.code || 'ROLE_ASSIGNMENTS_INVALID');
      }
      var flags = settingsState_();
      if (flags.userPipelineEnabled) blockers.push('USER_PIPELINE_MUST_BE_FALSE');
      if (flags.beta22ControlledSubmitEnabled) blockers.push('BETA22_CONTROLLED_SUBMIT_MUST_BE_FALSE');
      if (flags.beta23OperatorActionsEnabled) blockers.push('BETA23_ACTIONS_MUST_DEFAULT_FALSE');
      var hardening;
      try { hardening = hardeningState_(); }
      catch (hardeningError) { blockers.push(hardeningError.code || 'HARDENING_UNAVAILABLE'); }
      if (hardening && hardening.healthy !== true) blockers.push('OPERATIONAL_HARDENING_NOT_HEALTHY');
      if (hardening && Number(hardening.operationInventory &&
          hardening.operationInventory.nonTerminalCount || 0) > 0) {
        blockers.push('NON_TERMINAL_OPERATION_EXISTS');
      }
      var freshness = freshnessInspection_();
      if (!freshness.schemaMatches) blockers.push('FRESHNESS_SCHEMA_MISMATCH');
      var profileIds = {};
      PROFILE_MEMBERS.forEach(function (member) { profileIds[member.profileId] = true; });
      var data = {
        packageVersion: PACKAGE_VERSION, contractVersion: CONTRACT_VERSION,
        baseRelease: BASE_RELEASE, baseCommit: BASE_COMMIT,
        readyToInstall: blockers.length === 0, blockers: blockers,
        access: access, role: role || null, flags: flags,
        dependencies: dependencyStatus_(), hardening: hardening || null,
        freshnessInspection: freshness,
        acceptedProfileCount: Object.keys(profileIds).length,
        displayMemberCount: PROFILE_MEMBERS.length,
        fullAuditStartBinding: 'AKORT.Beta16FullAuditRetention.submit',
        quickAuditBinding: 'THIN_ORCHESTRATION_OVER_ACCEPTED_STATUS_AND_AUDIT_APIS',
        actionAudit: 'AKORT.Core.Logger_TO_SYSTEM_LOG',
        newOperationType: false, newQueue: false, newExecutor: false,
        newDispatcher: false, createsTrigger: false, deletesTrigger: false,
        rawWrite: false, publishWrite: false,
        userPipelineEnabled: false, productionTouched: false
      };
      return blockers.length ?
        AKORT.Result.failure('BETA23_PREFLIGHT_BLOCKED',
          'Beta.2.3 preflight found blockers.', data) :
        AKORT.Result.success('Beta.2.3 preflight passed.', data);
    }, { lock: false, persistLogs: false });
  }

  function contract() {
    return {
      packageVersion: PACKAGE_VERSION, contractVersion: CONTRACT_VERSION,
      baseRelease: BASE_RELEASE, baseCommit: BASE_COMMIT,
      stage: 'BETA2.3_CONTROL_CENTER_OPERATOR_ACTIONS',
      reusePolicy: 'REUSE_FIRST_GAP_ONLY',
      featureFlags: {
        operatorActions: ACTIONS_PROPERTY,
        beta22ControlledSubmit: BETA22_GATE_PROPERTY,
        userPipeline: 'PUBLISH_USER_PIPELINE_ENABLED'
      },
      rolesProperty: ROLES_PROPERTY,
      roles: clone_(ROLE_RANK),
      freshnessTable: FRESHNESS_TABLE,
      freshnessStageTable: FRESHNESS_STAGE_TABLE,
      freshnessTransaction: 'SCRIPT_LOCK_STAGE_READBACK_TARGET_READBACK_ROLLBACK',
      freshnessHeaders: FRESHNESS_HEADERS.slice(),
      freshnessUniqueKey: 'freshness_member_id',
      profileMembers: clone_(PROFILE_MEMBERS),
      displayFamilies: clone_(DISPLAY_FAMILIES),
      freshnessGroupingKey: 'display_family_id|frequency|canonical_period_key',
      mainStatusReadBoundary: 'USER_DATA_FRESHNESS_ONLY',
      mainUiLanguage: 'RU_PLAIN_TEXT',
      technicalCodesSurface: 'ADMIN_TECHNICAL_DETAILS_ONLY',
      actionAuditPersistence: 'EXACTLY_ONE_DURABLE_SYSTEM_LOG_ROW_REQUIRED',
      acceptedDelegates: {
        backup: ['AKORT.Beta11PairedBackup.backupNow','AKORT.Beta11PairedBackup.status'],
        rollback: ['AKORT.Beta12RollbackFacade.preview','AKORT.Beta12RollbackFacade.submit','AKORT.Beta12RollbackFacade.status'],
        operational: ['AKORT.Beta14OperationalHardening.status','AKORT.OperationEngine.status','AKORT.OperationEngine.resume','AKORT.OperationEngine.requestStop'],
        fullAudit: ['AKORT.Beta16FullAuditRetention.submit','AKORT.Beta16OperatorFacade.statusLatest','AKORT.Beta16OperatorFacade.continueLatest'],
        quickAudit: ['AKORT.Beta15CompactObservability.status','AKORT.Beta14OperationalHardening.status','AKORT.RawStore.auditLoad']
      },
      publicApi: [
        'AKORT_beta23Contract','AKORT_beta23Preflight','AKORT_beta23Overview',
        'AKORT_beta23DataFreshness','AKORT_beta23RefreshDataFreshness',
        'AKORT_beta23BackupStatus','AKORT_beta23StartBackup',
        'AKORT_beta23AuditStatus','AKORT_beta23StartQuickAudit','AKORT_beta23StartFullAudit',
        'AKORT_beta23SearchLoads','AKORT_beta23RollbackPreview','AKORT_beta23RollbackSubmit',
        'AKORT_beta23RollbackStatus','AKORT_beta23OperationStatus',
        'AKORT_beta23ContinueOperation','AKORT_beta23StopOperation','AKORT_beta23RetryOperation'
      ],
      arbitraryServerDispatch: false, restoreBackup: false,
      physicalDelete: false, retentionDelete: false,
      newOperationType: false, newQueue: false, newExecutor: false,
      newDispatcher: false, newWorker: false, createsTrigger: false,
      deletesTrigger: false, rawWrite: false, publishWrite: false,
      aggregateMethodologyChange: false, DataLensMutation: false,
      productionWrite: false, enablesUserPipeline: false
    };
  }

  return Object.freeze({
    PackageVersion: PACKAGE_VERSION, ContractVersion: CONTRACT_VERSION,
    BaseRelease: BASE_RELEASE, BaseCommit: BASE_COMMIT,
    FreshnessTable: FRESHNESS_TABLE,
    FreshnessStageTable: FRESHNESS_STAGE_TABLE,
    contract: contract, preflight: preflight, overview: overview,
    dataFreshness: dataFreshness, refreshFreshness: refreshFreshness,
    backupStatus: backupStatus, startBackup: startBackup,
    quickAudit: quickAudit, auditStatus: auditStatus,
    startFullAudit: startFullAudit, searchLoads: searchLoads,
    rollbackPreview: rollbackPreview, rollbackSubmit: rollbackSubmit,
    rollbackStatus: rollbackStatus, operationStatus: operationStatus,
    continueOperation: continueOperation, stopOperation: stopOperation,
    retryOperation: retryOperation,
    Test: Object.freeze({
      parseRoleAssignments: parseRoleAssignments_, normalizedRole: normalizedRole_,
      profileMembers: function () { return clone_(PROFILE_MEMBERS); },
      displayFamilies: function () { return clone_(DISPLAY_FAMILIES); },
      canonicalFromParts: canonicalFromParts_, periodLabelRu: periodLabelRu_,
      profileLabelRu: profileLabelRu_, periodLabelFromCanonical: periodLabelFromCanonical_,
      rowMatchesMember: rowMatchesMember_, latestMatchingPublish: latestMatchingPublish_,
      profileCategoryScopes: profileCategoryScopes_,
      fingerprintRow: fingerprintRow_, groupFreshness: groupFreshness_,
      uniqueMemberIds: uniqueMemberIds_, freshnessRowsMatch: freshnessRowsMatch_,
      runFreshnessTransaction: runFreshnessTransaction_,
      assertAuditWritten: assertAuditWritten_,
      runAuditedAction: runAuditedAction_, operationOriginResult: operationOriginResult_,
      compactOperation: compactOperation_, ruStatus: ruStatus_,
      ruPhase: ruPhase_, ruNextAction: ruNextAction_
    })
  });
})();

function AKORT_beta23Contract() {
  return AKORT_printResult_(AKORT.Result.success(
    'Beta.2.3 contract loaded.',
    AKORT.Beta23ControlCenterOperatorActions.contract()
  ));
}
function AKORT_beta23Preflight() { return AKORT_printResult_(AKORT.Beta23ControlCenterOperatorActions.preflight()); }
function AKORT_beta23Overview() { return AKORT.Beta23ControlCenterOperatorActions.overview(); }
function AKORT_beta23DataFreshness() { return AKORT.Beta23ControlCenterOperatorActions.dataFreshness(); }
function AKORT_beta23RefreshDataFreshness() { return AKORT.Beta23ControlCenterOperatorActions.refreshFreshness(); }
function AKORT_beta23BackupStatus() { return AKORT.Beta23ControlCenterOperatorActions.backupStatus(); }
function AKORT_beta23StartBackup() { return AKORT.Beta23ControlCenterOperatorActions.startBackup(); }
function AKORT_beta23AuditStatus() { return AKORT.Beta23ControlCenterOperatorActions.auditStatus(); }
function AKORT_beta23StartQuickAudit() { return AKORT.Beta23ControlCenterOperatorActions.quickAudit(); }
function AKORT_beta23StartFullAudit() { return AKORT.Beta23ControlCenterOperatorActions.startFullAudit(); }
function AKORT_beta23SearchLoads(queryDto) { return AKORT.Beta23ControlCenterOperatorActions.searchLoads(queryDto); }
function AKORT_beta23RollbackPreview(loadId, reason) { return AKORT.Beta23ControlCenterOperatorActions.rollbackPreview(loadId, reason); }
function AKORT_beta23RollbackSubmit(loadId, reason, confirmationBinding) { return AKORT.Beta23ControlCenterOperatorActions.rollbackSubmit(loadId, reason, confirmationBinding); }
function AKORT_beta23RollbackStatus(operationId) { return AKORT.Beta23ControlCenterOperatorActions.rollbackStatus(operationId); }
function AKORT_beta23OperationStatus(operationId) { return AKORT.Beta23ControlCenterOperatorActions.operationStatus(operationId); }
function AKORT_beta23ContinueOperation(operationId) { return AKORT.Beta23ControlCenterOperatorActions.continueOperation(operationId); }
function AKORT_beta23StopOperation(operationId, reason) { return AKORT.Beta23ControlCenterOperatorActions.stopOperation(operationId, reason); }
function AKORT_beta23RetryOperation(operationId, reason) { return AKORT.Beta23ControlCenterOperatorActions.retryOperation(operationId, reason); }
