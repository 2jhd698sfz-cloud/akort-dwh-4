# Alpha.7.4 Gate 5 — durable aggregate batch hotfix

## Назначение

Release `4.0.0-alpha.7.4.8` устраняет повторный тяжёлый расчёт одного и того же
aggregate replay batch после Apps Script timeout или потерянного ответа Google
Sheets API.

Hotfix не меняет frozen 29-column Publish contract, методологию расчёта,
accepted load/reversal lineage или DataLens-connected DEV Publish. Все записи
Gate 5 по-прежнему выполняются только в isolated sequential replay workbook.

## Зафиксированная точка восстановления

После первоначального ответа `STOPPED` legacy worker release
`4.0.0-alpha.7.4.6` завершил ещё один уже начатый шаг. Итоговый orphaned
checkpoint:

```text
groupIndex = 0
replayStage = AGGREGATES
replayItemCursor = 150
aggregateSeriesCursor = 64
lastStep.seriesTotal = 105
status = RUNNING
triggerCount = 0
```

Completed full build, baseline, live snapshot и текущий sequential replay
сохраняются. Предыдущие replay groups и price stages не повторяются.

64 серии незавершённого legacy batch уже физически применены. Hotfix
детерминированно переигрывает только комбинации начиная с cursor 150 новыми
пакетами по 25. Logical-series replacement сохраняет незатронутые периоды и
приводит уже записанные серии к тому же after-state, поэтому частичный legacy
batch не нужно откатывать вручную.

## Причина

До hotfix один aggregate replay step последовательно:

1. заново рассчитывал до 50 combinations;
2. заново создавал весь stage payload;
3. читал aggregate target;
4. публиковал до 64 logical series.

Если execution прекращался во время чтения или atomic publication, durable
cursor не успевал измениться. Следующий trigger корректно повторял операцию, но
одновременно повторял и наиболее дорогой расчёт. Это создавало несколько
timeout executions на одной логической позиции.

## Новый durable contract

Aggregate replay разделён на две независимо фиксируемые фазы.

### `MATERIALIZE_AGGREGATE_BATCH`

- берёт не более 25 deterministic aggregate combinations;
- один раз рассчитывает publish rows;
- преобразует их в exact Alpha.7.4 stage records;
- записывает records в `GATE5_AGGREGATE_BATCH_STAGE`;
- проверяет row count, logical series count и stage fingerprint;
- сохраняет `aggregateBatchWork` в Script Properties;
- завершает текущий durable step без physical publication.

### `PUBLISH_AGGREGATE_BATCH`

- читает только уже materialized immutable stage batch;
- повторно проверяет identity и fingerprint;
- публикует не более 32 logical series за step;
- использует Gate 4 atomic isolated writer;
- отдельно сохраняет `seriesCursor`;
- передвигает `replayItemCursor` только после публикации всех logical series
  materialized batch.

Расчёт batch больше не повторяется для каждого logical-series sub-batch.

## Lost-response recovery

Если atomic write завершился, но ответ или checkpoint не были сохранены,
следующий worker:

1. читает тот же durable stage batch;
2. строит тот же logical-series replacement;
3. распознаёт уже достигнутый after-state как `NOOP`;
4. фиксирует следующий series cursor без повторной физической записи.

Любое изменение cache schema, identity, row count, series count или fingerprint
завершает run fail-closed.

## Durable final latest

После завершения всех replay groups финальная переустановка
`is_latest_period` больше не выполняется одним монолитным вызовом. Harness
переиспользует проверенный full-build latest worker:

```text
INDEX_SCAN → APPLY_FLAGS
```

Оба прохода выполняются по 1 000 строк и сохраняют `replayLatestWork` после
каждого chunk. Timeout на этой стадии продолжает текущий cursor и не запускает
sequential replay повторно.

## Resume без повтора истории

Новый entry point:

```text
AKORT_alpha74Gate5ResumeReplay()
```

Он разрешён для manually stopped checkpoint на границе logical series, а также
для точного triggerless legacy incident `7.4.6` с cursor 150 и series cursor
64. Любой другой `RUNNING`, partial-series или trigger-bearing state
отклоняется fail-closed.
Перед запуском функция проверяет:

- release/state schema источника;
- наличие baseline, live snapshot, completed full build и sequential replay в
  canonical Test Files;
- неизменность DEV Publish относительно сохранённого live-before inventory;
- неизменность replay groups и frontier;
- допустимость сохранённого aggregate item cursor.

После проверки создаётся state schema
`4.0-alpha74-gate5-state-6`, но используется тот же sequential replay workbook
и тот же cursor 150. Внутренний legacy series cursor сбрасывается в 0 с
явным recovery policy `REPLAY_PARTIAL_BATCH_FROM_COMBO_CURSOR`. Новый full
build, новый replay workbook и повтор групп
`WEEKLY → MONTHLY → INDUSTRY` не выполняются.

`AKORT_alpha74Gate5Start()` и `AKORT_alpha74Gate5RestartReplay()` для этой точки
восстановления запускать нельзя.

## Race-safe manual stop

`AKORT_alpha74Gate5Stop()` теперь сначала сохраняет отдельный durable stop
request, затем удаляет trigger и переводит state в `STOPPED`.

Активный worker проверяет stop request:

- до начала очередного шага;
- после каждого шага до сохранения checkpoint;
- в обработчике ошибки.

Поэтому worker, который уже выполнялся в момент остановки, не может вернуть
state в `RUNNING`.

## Установка и продолжение

После публикации commit и `clasp push`:

1. запустить `AKORT_alpha74Install()`;
2. запустить `AKORT_alpha74SmokeTest()`;
3. запустить `AKORT_alpha74ReadOnlyContractScan()`;
4. установить
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
5. оставить
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
6. запустить `AKORT_alpha74Gate5Status()` и проверить старый stopped cursor;
7. один раз запустить `AKORT_alpha74Gate5ResumeReplay()`;
8. проверить state schema `4.0-alpha74-gate5-state-6`, release
   `4.0.0-alpha.7.4.8`, `status=RUNNING`, `phase=SEQUENTIAL_REPLAY`,
   `groupIndex=0`, `stage=AGGREGATES`, `itemCursor=150`, `triggerCount=1`;
9. дальше запускать вручную только `AKORT_alpha74Gate5Status()`.

Worker, Start и RestartReplay вручную не запускаются.
