# Beta.2.3 — Центр управления и операторские действия

Пакет: `4.0.0-beta.2.3.5`  
Контракт: `4.0-beta23-control-center-operator-actions-2`  
База: `10430fe3a51b7b4b007f9442684fc0aed85f49e5`  
Статус: corrective candidate-r5, uncommitted review target; принятие и deployment запрещены до внешнего GO.

## 1. Назначение

Beta.2.3 добавляет к принятому Центру управления русскоязычную пользовательскую модель, материализованное представление актуальности данных и строго разрешённые операторские действия. Пакет не создаёт новый data plane и не заменяет принятые механизмы загрузки, резервного копирования, аудита, выполнения операций или отката.

## 2. Неизменяемые ограничения

- только DEV;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`;
- `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=FALSE`;
- `AKORT_BETA23_OPERATOR_ACTIONS_ENABLED=FALSE` по умолчанию;
- production и DataLens не изменяются;
- новые queue, executor, dispatcher, worker, operation type и trigger не создаются;
- physical delete и restore backup из интерфейса отсутствуют;
- RAW, Publish и aggregate methodology не изменяются.

## 3. Роли

`VIEWER` видит обзор, актуальность, проблемы, статусы backup/audit и ограниченный поиск загрузок.

`OPERATOR` дополнительно может запустить Backup Now, Quick Audit и Full Audit, а также продолжить разрешённую операцию на один безопасный шаг.

`ADMIN` дополнительно видит технические сведения и impact/lineage отката, подтверждает логический rollback, запрашивает безопасную остановку или разрешённую повторную попытку.

Роль проверяется на сервере. `AKORT_BETA23_ROLE_ASSIGNMENTS` принимает JSON-карту `email → role` либо массивы `viewers`, `operators`, `admins`. Авторизованный пользователь без назначения получает `VIEWER`.

## 4. Контур записи

Любое действие с побочным эффектом разрешается только при одновременном выполнении условий: DEV подтверждён; пользователь авторизован и имеет необходимую роль; Beta.2.3 gate включён; Beta.2.2 controlled-submit и general user pipeline выключены; Beta.1.4 healthy; для новых Backup, Full Audit и freshness refresh отсутствует незавершённая операция.

Rollback дополнительно использует принятые Beta.1.2/Beta.1.4 idempotency и conflict guards.

## 5. Актуальность данных и разделение профилей

Основной read model — `USER_DATA_FRESHNESS` с уникальным ключом `freshness_member_id`. Основной экран читает только эту таблицу и не сканирует RAW/Publish.

Для controlled refresh профиль идентифицируется совокупностью `dataset_code`, `source_file_type`, active `DIM_PRODUCT_MAPPING.category_id`, `indicator_key`, `value_type` и `index_type`. Совпадение одного `indicator_key` не является достаточным. Это предотвращает слияние промышленного и сельскохозяйственного PPI/producer-price профилей. Когда последняя успешная операция задаёт canonical period, отсутствие строки именно этого профиля за этот период возвращает `NOT_INITIALIZED/WARNING`; данные другого профиля или периода не подставляются.

UI группирует только по `display_family_id + frequency + canonical_period_key`. Разные периоды и семьи не объединяются. Industry сохраняет grain `series_id`.

## 6. Транзакционное обновление freshness projection

Controlled refresh использует две производные таблицы: целевую `USER_DATA_FRESHNESS` и staging `USER_DATA_FRESHNESS_STAGE` с одинаковой схемой.

Writer и основной reader используют один Script Lock. Writer выполняет следующую последовательность:

1. валидирует bounded row count и уникальность members;
2. полностью материализует candidate snapshot в staging;
3. выполняет exact stage read-back;
4. заменяет target под тем же lock;
5. выполняет exact target read-back;
6. при ошибке восстанавливает предыдущий target snapshot и проверяет восстановление.

Таким образом, application reader не наблюдает промежуточное очищенное или частично записанное состояние. Ошибка восстановления переводится в fail-closed/manual-review состояние.

## 7. Утверждённые делегаты

- Backup: `AKORT.Beta11PairedBackup.backupNow/status`;
- Rollback: `AKORT.Beta12RollbackFacade.preview/submit/status`;
- Hardening: `AKORT.Beta14OperationalHardening.status`;
- Quick Audit: accepted Beta.1.5/Beta.1.4/RawStore checks;
- Full Audit: `AKORT.Beta16FullAuditRetention.submit`, `AKORT.Beta16OperatorFacade.statusLatest/continueLatest`;
- controls: `AKORT.OperationEngine.status/resume/requestStop`, где resume ограничен `maxSteps:1`.

## 8. Exact workflow origin для operation controls

`operationStatus`, `continue`, `stop` и `retry` не принимают operation ID только по типу. Сервер требует одновременно:

- `created_by` равен текущему авторизованному email;
- operation type входит в allowlist;
- checkpoint/input/meta точно соответствует принятому workflow этого типа.

Для `SOURCE_FILE_LOAD_V4` проверяется Beta.2.2 binding и deterministic idempotency key. Для `RAW_LOAD_V4` допускается только accepted Industry Input form. Для backup — только manual accepted backup request. Для Full Audit — только точная Beta.2.3 причина и retention dry-run. Для `RAW_REVERSAL_V4` проверяется Beta.1.2 binding, reason hash и idempotency key. После continue/stop/retry происхождение повторно проверяется через свежий status.

Legacy, Gate/acceptance, service и foreign-user операции fail closed.

## 9. Rollback

Rollback является логическим `RAW_REVERSAL_V4`, а не восстановлением backup. Перед submit сервер выполняет свежий Beta.1.2 preview, формирует HMAC binding с TTL 10 минут и привязывает его к пользователю, load ID, reason hash, lineage, impact и source-operation fingerprints. Submit повторяет preview и отклоняет изменение binding.

## 10. Обязательный action audit

Каждая audited попытка сначала должна записать `BETA23_OPERATOR_ACTION_STARTED`. `logger.flush()` обязан подтвердить запись ровно одной строки в `SYSTEM_LOG`; результат `0`, больше одной строки или исключение считаются `BETA23_ACTION_AUDIT_NOT_PERSISTED`. До подтверждения этой записи делегированное действие не выполняется. После результата или ошибки записывается `BETA23_OPERATOR_ACTION_COMPLETED`. STARTED record гарантирует след попытки даже при последующей ошибке. Ошибки аудита не перехватываются и не маскируются.

В журнал попадают только hashes пользователя, цели и причины, тип действия, статус, error code и operation ID. Tokens, secrets и исходные значения данных не записываются.

## Русский основной интерфейс

Основная пользовательская поверхность использует понятный русский текст. Названия окружения, этапов разработки, внутренних operation types, profile IDs, feature flags и технических таблиц доступны только администратору в разделе «Технические сведения». Периоды отображаются как «27-я неделя 2026 года» или «июль 2026 года», роли — как «Наблюдатель», «Оператор» и «Администратор».
