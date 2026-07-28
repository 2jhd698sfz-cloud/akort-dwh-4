# Alpha.7.4.4 — Gate 5 Durable Materialization Hotfix

## Причина

Первый запуск `4.0.0-alpha.7.4.3` правильно создал `state-2`, новый execution
и изолированные книги, но проверка runtime-кода обнаружила дефект до
нормативной приёмки: durable cursor ограничивал только запись в целевую
витрину. `gate5FullRows_()` повторно строил весь payload перед каждым
500-строчным chunk.

При 20–60 тыс. строк это создавало многократный полный пересчёт и не
соответствовало цели hotfix.

## Исправленный контракт

```text
release = 4.0.0-alpha.7.4.4
harness = 4.0-alpha74-gate5-acceptance-3
state = 4.0-alpha74-gate5-state-3
full work = 4.0-alpha74-gate5-full-work-2
evidence = 4.0-alpha74-gate5-evidence-3
```

Каждая non-latest full-build стадия теперь имеет две фазы:

1. `MATERIALIZE_ROWS` — payload рассчитывается ровно один раз и сохраняется
   в служебный `GATE5_MATERIALIZED_<STAGE>` лист той же isolated full-build
   книги.
2. `COPY_MATERIALIZED_ROWS` — target получает только готовые строки
   детерминированными chunks из durable materialization.

`state.fullBuildWork` дополнительно фиксирует:

```text
materializedSheetName
materializedRows
```

Перед каждым copy-chunk проверяются существование materialization и точное
число строк. Изменение или удаление служебного листа вызывает fail-closed
ошибку. После lost response тот же диапазон перезаписывается из того же
immutable materialized payload.

`AGGREGATES_LATEST` остаётся отдельным двухпроходным cursor-процессом
`INDEX_SCAN → APPLY_FLAGS` и не требует materialized payload.

## Защита checkpoint

`Start()` и worker теперь сравнивают одновременно `stateSchemaVersion` и
`release`. Checkpoint другого релиза больше не может быть автоматически
возобновлён:

```text
ALPHA74_GATE5_STATE_VERSION_MISMATCH
```

Несовместимый run переводится в `STOPPED`, его trigger удаляется, а
изолированные артефакты сохраняются.

Trigger tick, который не получил user lock, теперь завершается без записи
checkpoint. Это исключает откат cursor устаревшей копией state; overlap-path
является строго read-only.

## Метрики

Новый нормативный статус должен показывать:

```text
stateSchemaVersion = 4.0-alpha74-gate5-state-3
release = 4.0.0-alpha.7.4.4
metrics.fullBuildRowsMaterialized > 0
metrics.fullBuildStagesPrepared > 0
metrics.fullBuildChunks > 0
fullBuild.phase = COPY_MATERIALIZED_ROWS
fullBuild.materializedRows = fullBuild.total
```

После `PREPARE` значение `fullBuildRowsMaterialized` увеличивается один раз
для стадии. Последующие chunks увеличивают только
`fullBuildRowsProcessed`.

## Safety boundary

Hotfix не расширяет права:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Служебные materialization-листы и все target-записи находятся только в
новых isolated workbooks папки DEV Test Files. DataLens-connected Publish
остаётся read-only.

## Нормативный перезапуск

Запуск `7.4.3` не используется для Gate 5 acceptance. После остановки
worker, установки `7.4.4` и повторного smoke/contract scan создаётся новый
execution через `AKORT_alpha74Gate5Start()`.
