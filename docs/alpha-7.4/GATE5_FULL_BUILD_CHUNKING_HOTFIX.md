# Alpha.7.4.3 — Gate 5 Full-Build Chunking Hotfix

## 1. Причина hotfix

Первый DEV-запуск Gate 5 на `4.0.0-alpha.7.4.2` успешно завершил
`FULL_BUILD / WEEKLY`, но монолитная запись заняла 310 412 мс. Следующие
запуски оставались на `FULL_BUILD / MONTHLY`: семь worker executions дали
только один durable step, а 25 trigger ticks были пропущены из-за overlap.

Причина — checkpoint сохранялся только после полного расчёта, очистки,
записи и форматирования всей витрины. Жёсткое завершение Apps Script до
checkpoint приводило к повторному запуску стадии с начала.

Остановленный запуск `4.0.0-alpha.7.4.2` сохраняется как диагностический
артефакт и не используется для нормативной приёмки hotfix.

## 2. Использованный проверенный шаблон

Hotfix повторно использует принципы Alpha.6:

- commit `b707de7` — `replayWork.cursor`, bounded chunks и переход стадии
  только после фиксации последнего chunk;
- commit `884ba79` — cursor-checkpointed recovery для weekly/monthly
  calculated series;
- persistent dispatcher — lock, пропуск overlap, автоматический retry и
  сохранение компактного state после каждого durable шага.

Gate 5 не копирует старый aggregate executor. Используется только проверенный
шаблон управления resumable work.

## 3. Новый full-build state

Схемы hotfix:

```text
release = 4.0.0-alpha.7.4.3
harness = 4.0-alpha74-gate5-acceptance-2
state = 4.0-alpha74-gate5-state-2
full work = 4.0-alpha74-gate5-full-work-1
evidence = 4.0-alpha74-gate5-evidence-2
```

`state.fullBuildWork` содержит только компактный durable cursor:

```text
stage
phase
cursor
total
chunkRows
startRow
workSchemaVersion
```

Подготовка стадии является отдельным durable step. Стадия переключается
только после `complete=true`.

## 4. Размеры chunks

| Стадия | Размер |
|---|---:|
| `WEEKLY` | 500 строк |
| `MONTHLY` | 500 строк |
| `INDUSTRY` | 250 строк |
| `AGGREGATES_WEEKLY` | 500 строк |
| `AGGREGATES_MONTHLY` | 500 строк |
| `AGGREGATES_SPECIAL` | 250 строк |
| `AGGREGATES_LATEST / INDEX_SCAN` | 1 000 строк |
| `AGGREGATES_LATEST / APPLY_FLAGS` | 1 000 строк |

Worker execution budget уменьшен до 120 секунд между durable steps. Один
worker может выполнить несколько chunks, но не начинает новые шаги после
исчерпания budget.

## 5. Идемпотентность

- `REPLACE`-стадии очищаются отдельным prepare step.
- Каждый chunk записывается в детерминированный диапазон
  `startRow + cursor`.
- Если ответ потерян до сохранения cursor, повторный worker перезаписывает
  тот же диапазон, не добавляя дублей.
- `APPEND`-стадии фиксируют `startRow` в durable work до первой записи.
- Standard aggregate rows, которые заменяются special definitions,
  исключаются до записи; special rows добавляются один раз отдельной стадией.
- Изменение количества исходных строк между prepare и chunk вызывает
  fail-closed `ALPHA74_GATE5_FULL_SOURCE_CHANGED`.
- После последнего chunk проверяется точное количество строк стадии.

## 6. Chunked latest

`AGGREGATES_LATEST` разделён на два resumable прохода:

1. `INDEX_SCAN` строит служебный `GATE5_FULL_LATEST_INDEX` с максимальным
   периодом каждой логической aggregate series.
2. `APPLY_FLAGS` записывает `is_latest_period` блоками по 1 000 строк.

Служебный лист находится только в isolated full-build workbook и не входит в
Publish contract или canonical digest.

## 7. Safety boundary

Hotfix не меняет основной safety contract:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Все записи Gate 5 разрешены только в новых isolated workbooks внутри
canonical Test Files. DataLens-connected DEV Publish остаётся read-only.

## 8. Нормативный перезапуск

После установки `4.0.0-alpha.7.4.3` запускается новый Gate 5 execution через
`AKORT_alpha74Gate5Start()`. Старый остановленный execution не возобновляется:
это гарантирует, что weekly, monthly, industry и aggregate stages целиком
пройдут через новый cursor-checkpointed contract.

Успешный статус должен показывать:

```text
stateSchemaVersion = 4.0-alpha74-gate5-state-2
fullBuild.cursor растёт ограниченными шагами
metrics.fullBuildStagesPrepared > 0
metrics.fullBuildChunks > 0
manualContinuationCalls = 0
```

