# Alpha.7.4.24 — Gate 6 staged after-state recovery

## Инцидент

Первый `AKORT_alpha74Gate6Resume()` на release `.23` завершился fail-closed:

- Gate 6 execution: `A74_GATE6_7F437567A3ABBFBE94F1`;
- canary operation: `OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9`;
- operation checkpoint: `STAGING_AGGREGATE_ROWS`, `stagingCursor=0`;
- рассчитано: `392 / 392` строк;
- фактические статусы всех 392 строк: `STAGED`;
- publish intents: `0`.

Причина — потерянный ответ старого монолитного `.22`: запись статуса
`CALCULATED → STAGED` успела завершиться физически, но Apps Script не сохранил
следующий operation checkpoint. Поэтому checkpoint описывал состояние до
записи, а `AGGREGATE_STAGE` — безопасное состояние сразу после неё.

Это не частичная публикация в `PUBLISH_PRICE_AGGREGATES`. Статус `STAGED`
только подтверждает готовность рассчитанных строк; publish intent,
`expected_target_fingerprint` и `verified_at` ещё отсутствуют.

## Exact allowlist `.24`

Обычный `AKORT_alpha74Gate6Resume()` принимает текущий incident только если:

- сохранён точный `.22 / STOPPED / RUN_CANARY` checkpoint;
- operation находится на `STAGING_AGGREGATE_ROWS`, расчёт равен `392 / 392`;
- все business stage rows принадлежат тем же `operation_id`, `load_id`,
  `plan_id` и `plan_fingerprint`;
- все строки имеют один статус: либо `CALCULATED`, либо `STAGED`;
- для after-state все строки имеют статус `STAGED`;
- `publishIntents=0`, `expected_target_fingerprint` и `verified_at` пусты;
- payload каждой строки соответствует frozen 29-column schema;
- `row_fingerprint` каждой строки пересчитывается точно;
- нет повторяющихся `aggregate_row_key`;
- recovery-копии DWH и Publish доступны;
- regular и user pipelines выключены.

Recovery-проверка ограничена максимум 500 строками. Обычная обработка после
Resume остаётся разбитой на durable chunks `.23`: 100 строк stage validation,
250 строк stage status, до 32 целых logical series на publication/latest и
один durable publication batch на reconciliation.

При смешанных статусах, наличии publish intent/target fingerprint/verified-at,
изменении source/plan/payload либо несовпадении fingerprint продолжение
запрещается. Recovery-копии и выключенные pipeline flags сохраняются.

## Что сохраняется

`.24` не повторяет:

- RAW commit;
- ordinary weekly Publish;
- aggregate impact и materialization;
- 392 aggregate calculations.

После точной проверки operation продолжает ту же фазу. Bounded runtime ещё
раз проверит staging частями и идемпотентно подтвердит `STAGED`, затем перейдёт
к atomic logical-series publication. Ожидаемый recovery mode:
`BOUNDED_STAGE_AFTER_STATE_RECOVERY`.

## Установка и продолжение

После публикации commit и `clasp push` в DEV Apps Script:

1. Выполнить `AKORT_alpha74Install()`.
2. В `SYSTEM_SETTINGS` установить только
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`.
3. Проверить:
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE` и
   `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.
4. Выполнить `AKORT_alpha74SmokeTest()`.
5. Выполнить `AKORT_alpha74ReadOnlyContractScan()`.
6. Выполнить `AKORT_alpha74Gate6Status()` и убедиться, что сохранён старый
   `STOPPED` execution и `triggerCount=0`.
7. Один раз выполнить `AKORT_alpha74Gate6Resume()`.
8. Далее использовать только `AKORT_alpha74Gate6Status()`.

Не выполнять `AKORT_alpha74Gate6Start()`, `Gate6Install`, `Gate6Validate` или
`Gate6RecoverRuntimeContext`. Не включать regular/user flags вручную. Resume
сам установит controlled regular pipeline и создаст один persistent worker.

В успешном ответе Resume должны присутствовать:

- `release=4.0.0-alpha.7.4.24`;
- `status=RUNNING`, `phase=RUN_CANARY`;
- `recovery.mode=BOUNDED_STAGE_AFTER_STATE_RECOVERY`;
- `recovery.stageRecoveryBoundary=AFTER_STAGE_STATUS_WRITE_LOST_RESPONSE`;
- `recovery.validatedStageRows=392`;
- `recovery.adoptedStageStatusAfterLostResponse=true`;
- `recovery.physicalAggregatePublishStarted=false`;
- `triggerCount=1`.

