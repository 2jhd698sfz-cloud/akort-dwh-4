# Alpha.7.4 Gate 5 — period-identity recovery

## Назначение

Release `4.0.0-alpha.7.4.10` устраняет расхождение между логическим ключом
weekly aggregate row в durable stage и датой, которая фактически записывается
в isolated Publish после JSON round-trip.

Hotfix не меняет frozen 29-column Publish contract, расчётные формулы,
lineage, исходные load/reversal records и DataLens-connected DEV Publish.
Он продолжает существующий isolated sequential replay и использует уже
сохранённый aggregate batch.

## Подтверждённая причина

В cached stage одна строка одновременно содержала:

```text
aggregate_row_key period = 2025-03-10
stage period_start        = 2025-03-10
payload period_start      = 2025-03-09T21:00:00.000Z
physical Publish period   = 2025-03-09
```

Дата `2025-03-10 00:00 Europe/Moscow` сериализуется как
`2025-03-09T21:00:00.000Z`. Старый planner удалял строку по Monday key, но
writer и read-back использовали Sunday. В результате atomic request
выполнялся физически, однако read-back оставался неоднозначным и cursor
правильно не двигался.

Read-only диагностика зафиксировала:

```text
physical rows before attempt    = 3 640
physical rows after attempt     = 3 652
unique logical rows             = 3 123
exact duplicates before attempt = 517
exact duplicates after attempt  = 529
conflicting duplicates          = 0
```

Live DataLens-connected DEV Publish не изменялась.

## Исправленный контракт

Для новых Gate 5 stage records:

1. 29-column payload сериализуется до durable JSON representation.
2. `period_start` нормализуется до published calendar key.
3. `aggregate_row_key` строится из того же published period.
4. Fingerprint рассчитывается по согласованным payload, period и row key.

Для сохранённого `.9` cache replacement planner выводит effective row key из
payload. Исходные cache rows и их fingerprints не переписываются. Это
позволяет безопасно использовать текущие 875 rows / 105 series.

Physical repair:

- индексирует существующие rows по фактически опубликованной дате;
- удаляет все физические rows affected series;
- добавляет один canonical replacement на logical key;
- проверяет unique read-back;
- передвигает series cursor только после подтверждённого after-state;
- оставляет conflicting duplicate в fail-closed состоянии.

## Durable recovery

`AKORT_alpha74Gate5ResumeReplay()` принимает terminal checkpoint только
при одновременном выполнении условий:

- source release `4.0.0-alpha.7.4.9`;
- source schema `4.0-alpha74-gate5-state-7`;
- `status=FAILED`, `phase=FAILED`;
- `failureCode=ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN`;
- `lastError.code=ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN`;
- trigger отсутствует;
- replay находится на `group 0 / AGGREGATES / cursor 175`;
- series cursor равен нулю;
- durable batch присутствует и проходит fingerprint validation;
- period-identity mismatch и exact duplicates воспроизводятся read-only;
- live Publish и четыре canonical artifacts проходят guards.

Новый state:

```text
release       = 4.0.0-alpha.7.4.10
state schema  = 4.0-alpha74-gate5-state-8
recovery mode = DURABLE_PERIOD_IDENTITY_REPAIR_RESUME
```

Full build, price replay, aggregate calculation и новый replay workbook не
создаются.

## Установка и продолжение

1. Убедиться, что source checkpoint имеет `status=FAILED`,
   `failureCode=ALPHA74_GATE5_AGGREGATE_ATOMIC_WRITE_UNCERTAIN` и
   `triggerCount=0`. Если source всё ещё `RUNNING`, сначала выполнить
   `AKORT_alpha74Gate5Stop()`.
2. Опубликовать commit и выполнить `clasp push`.
3. Запустить `AKORT_alpha74Install()`.
4. Запустить `AKORT_alpha74SmokeTest()`.
5. Запустить `AKORT_alpha74ReadOnlyContractScan()`.
6. Убедиться:
   - `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
   - `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`.
7. Запустить `AKORT_alpha74Gate5Status()` и проверить сохранённый
   `.9 / state-7 / FAILED / cursor 175 / aggregateBatch 875`.
8. Один раз запустить `AKORT_alpha74Gate5ResumeReplay()`.
9. Проверить `.10 / state-8 / RUNNING / cursor 175 / triggerCount=1` и mode
   `DURABLE_PERIOD_IDENTITY_REPAIR_RESUME`.
10. Далее вручную запускать только `AKORT_alpha74Gate5Status()`.

`Start`, `RestartReplay` и `Worker` для этого recovery не запускаются.
