# Alpha.7.4 Gate 5 — exact-duplicate lost-response recovery

## Назначение

Release `4.0.0-alpha.7.4.9` закрывает обнаруженный Gate 5 incident, при
котором uncertain/lost response Google Sheets API оставил в isolated
sequential replay физические копии уже опубликованных aggregate rows.

Hotfix не меняет frozen 29-column Publish contract, расчётные формулы,
accepted load/reversal lineage и DataLens-connected DEV Publish. Он работает
с тем же isolated replay workbook и тем же durable aggregate stage cache.

## Подтверждённый incident

Read-only диагностика isolated replay зафиксировала:

```text
target physical rows       = 3 640
unique logical rows        = 3 123
duplicate logical keys     = 517
excess physical rows       = 517
affected logical series    = 64
copies per duplicate key   = 2
canonically identical      = 517
conflicting duplicates     = 0
```

Все дубли относятся к affected series сохранённого aggregate batch. Живая
DataLens-connected DEV Publish не изменялась.

Durable checkpoint сохраняет:

```text
groupIndex                 = 0
replayStage                = AGGREGATES
replayItemCursor           = 175
aggregateSeriesCursor      = 0
cached combinations        = 25
cached stage rows          = 875
cached logical series      = 105
```

Повтор full build, price replay и расчёт этого aggregate batch не требуется.

Read-only preflight первого repair sub-batch подтвердил:

```text
logical series             = 32
cached stage rows          = 268
existing physical rows     = 1 378
replacement rows           = 1 122
duplicate rows repaired    = 256
replacement cells          = 32 538
Sheets API requests        = 2
```

Пакет укладывается в действующие atomic limits.

## Новый recovery contract

`buildSeriesReplacement` различает два класса duplicate logical key.

### Exact canonical duplicate

Если все 29 contract values совпадают после нормализации Google Sheets date
types:

- один экземпляр используется как каноническое before-state;
- все физические экземпляры affected series включаются в atomic delete set;
- канонический replacement append выполняется в том же Sheets
  `batchUpdate`;
- после записи выполняется обязательный read-back;
- cursor передвигается только после подтверждения unique after-state.

Даже если before/after logical fingerprint совпадает, наличие лишней
физической строки принудительно требует repair write. Это исключает ложный
`NOOP`.

### Conflicting duplicate

Если хотя бы одно из 29 значений различается, операция завершается fail-closed
с `AGGREGATE_TARGET_DUPLICATE_ROW_KEY_CONFLICT`. Автоматическое удаление или
выбор строки запрещены.

## Повтор uncertain response

Если read-back после atomic request всё ещё содержит exact duplicates или
другой fingerprint:

- durable series cursor не меняется;
- cached stage batch сохраняется;
- ошибка классифицируется как transient;
- worker повторяет тот же bounded repair step;
- после шести последовательных неуспешных попыток harness останавливается
  fail-closed.

## Восстановление текущего checkpoint

`AKORT_alpha74Gate5ResumeReplay()` принимает только проверенный terminal
checkpoint:

- source release `4.0.0-alpha.7.4.8`;
- source state schema `4.0-alpha74-gate5-state-6`;
- `status=FAILED`, `phase=FAILED`;
- failure code `AGGREGATE_TARGET_DUPLICATE_ROW_KEY`;
- trigger отсутствует;
- durable aggregate batch присутствует и проходит identity, row-count,
  series-count и fingerprint validation;
- duplicate rows воспроизводятся как exact, а не conflicting;
- live Publish совпадает с сохранённым before inventory;
- все четыре artifacts находятся в canonical Test Files.

Новый state использует release `4.0.0-alpha.7.4.9`, schema
`4.0-alpha74-gate5-state-7` и recovery mode
`DURABLE_EXACT_DUPLICATE_REPAIR_RESUME`. Sequential replay workbook и cached
batch сохраняются.

## Установка и запуск

После публикации commit и `clasp push`:

1. запустить `AKORT_alpha74Install()`;
2. запустить `AKORT_alpha74SmokeTest()`;
3. запустить `AKORT_alpha74ReadOnlyContractScan()`;
4. установить `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
5. оставить `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
6. запустить `AKORT_alpha74Gate5Status()` и проверить старый
   `FAILED / cursor 175 / aggregateBatch 875 rows`;
7. один раз запустить `AKORT_alpha74Gate5ResumeReplay()`;
8. проверить:
   - release `4.0.0-alpha.7.4.9`;
   - state schema `4.0-alpha74-gate5-state-7`;
   - `status=RUNNING`;
   - `phase=SEQUENTIAL_REPLAY`;
   - `itemCursor=175`;
   - cached aggregate batch сохранён;
   - `triggerCount=1`;
9. дальше вручную запускать только `AKORT_alpha74Gate5Status()`.

`Start`, `RestartReplay` и `Worker` для этого incident вручную не запускаются.
