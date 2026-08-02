# Alpha.7.4.25 — Gate 6 monthly period-label recovery

## Инцидент

После exact `.24` Resume canary operation дошла до первого bounded batch
`SERIES_000001_000032`, физически заменила 32 полные monthly logical series и
завершилась fail-closed на `AGGREGATE_PUBLISH_READBACK_MISMATCH`.

Сохранённая точка:

- Gate 6 execution: `A74_GATE6_7F437567A3ABBFBE94F1`;
- canary operation: `OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9`;
- operation phase: `UPDATING_AGGREGATES`;
- operation status: `FAILED_REQUIRES_REVIEW`;
- stage rows: `392 / 392`, статус `STAGED`;
- publication cursor: `0 / 392`;
- durable intent: только `SERIES_000001_000032`;
- regular pipeline: `FALSE`;
- user pipeline: `FALSE`;
- worker trigger: отсутствует.

Проверка рабочей `АКОРТ — Publish 4.0 DEV` подтвердила, что atomic request
состоялся. У первой новой monthly-строки `period_start=2026-07-01`, но
`period_label=2026-06-01`.

Причина: stage payload сохранил Google Date как
`2026-06-30T21:00:00.000Z`. Старый writer извлекал месяц непосредственно из
UTC-строки и записывал июнь, хотя в часовом поясе проекта `Europe/Moscow` это
уже 1 июля. Это детерминированная ошибка календарной нормализации, а не
задержка Google Sheets и не частичная запись.

## Исправление `.25`

1. Для monthly `period_label` единственным календарным источником становится
   `period_start`.
2. Fingerprint также канонизирует monthly label по `period_start`, поэтому
   stage payload, Google Date и Sheets serial сравниваются в одной модели.
3. Physical read-back отдельно проверяет реальный `period_label`. Совпадающий
   fingerprint не скрывает смещённую дату: строка помечается как требующая
   physical repair.
4. Recovery обновляет только один уже существующий durable intent и затем
   возвращает operation на обычную bounded phase `UPDATING_AGGREGATES`.
5. Следующий normal worker step повторно заменяет только первые 32 серии,
   записывает правильный июльский label, проверяет after-state и двигает
   durable cursor.

Новые операции, RAW, ordinary weekly/monthly Publish, materialization,
calculation и staging не повторяются.

## Exact allowlist

`AKORT_alpha74Gate6RecoverMonthlyPeriodLabel()` разрешена только если
одновременно подтверждены:

- Gate 6 state `.24 / FAILED / RUN_CANARY` с кодом
  `AGGREGATE_PUBLISH_READBACK_MISMATCH`;
- canary operation `FAILED_REQUIRES_REVIEW / UPDATING_AGGREGATES` с тем же
  кодом;
- completed phases доходят до `STAGING_AGGREGATE_ROWS`, но не включают
  `UPDATING_AGGREGATES`;
- immutable stage содержит ровно 392 валидные строки и 392 серии с прежним
  `stageFingerprint`;
- `publishSeriesCursor=0`, completed `publishBatches` отсутствуют;
- существует ровно один `.24 / INTENT_PERSISTED` intent
  `SERIES_000001_000032`;
- первая slice содержит ровно 32 monthly UPSERT rows;
- в Publish обнаружено ровно 32 смещённых monthly labels, нет logical
  duplicates и нет другого отличия от исправленного after-state;
- доступны обе Gate 6 recovery-копии;
- `engine=TRUE`, `execution=TRUE`, `regular=FALSE`, `user=FALSE`, trigger
  отсутствует.

Любое другое состояние блокируется до записи. Подготовка intent идемпотентна:
если ответ потерян после его обновления, повторный exact recovery распознаёт
уже подготовленный `.25 / INTENT_RECOVERED` и не создаёт второй intent.

## Установка и продолжение

После публикации commit и `clasp push`:

1. Выполнить `AKORT_alpha74Install()`.
2. В `SYSTEM_SETTINGS` оставить:
   - `PUBLISH_ENGINE_ENABLED=TRUE`;
   - `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
   - `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
   - `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.
3. Выполнить `AKORT_alpha74SmokeTest()`.
4. Выполнить `AKORT_alpha74ReadOnlyContractScan()`.
5. Выполнить `AKORT_alpha74Gate6Status()` и проверить `.24 / FAILED`,
   `failedFromPhase=RUN_CANARY`, `triggerCount=0`.
6. Один раз выполнить
   `AKORT_alpha74Gate6RecoverMonthlyPeriodLabel()`.
7. Далее запускать только `AKORT_alpha74Gate6Status()`.

Recovery сама включает controlled regular pipeline и создаёт один persistent
worker. Не выполнять `Gate6Start`, `Gate6Install`, `Gate6Validate`, обычный
`Gate6Resume` или `Gate6RecoverRuntimeContext`. User pipeline вручную не
включать.

Ожидаемый ответ recovery:

- `release=4.0.0-alpha.7.4.25`;
- `status=RUNNING`, `phase=RUN_CANARY`;
- `recovery.mode=MONTHLY_PERIOD_LABEL_READBACK_RECOVERY`;
- `recovery.repairedBatchKey=SERIES_000001_000032`;
- `recovery.repairedSeries=32`;
- `recovery.monthlyPeriodLabelRowsToRepair=32`;
- `triggerCount=1`.

После первого успешного worker batch ожидается `publishSeriesCursor=32`, а
operation продолжает остальные серии теми же пакетами не более 32 logical
series. При любом третьем состоянии regular/user flags снова выключаются
fail-closed, recovery-копии сохраняются.
