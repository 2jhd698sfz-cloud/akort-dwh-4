# Alpha.7.4 — Gate 5 Acceptance Harness

## 1. Назначение

Gate 5 подтверждает на полном историческом объёме:

- независимый full build из текущего authoritative RAW;
- последовательный replay accepted load/reversal lineage;
- exact equality full build, sequential replay, immutable Alpha.7.1 baseline и
  зафиксированного live Publish snapshot;
- корректность latest;
- соблюдение atomic row/cell/request limits;
- автоматическое продолжение после штатного окончания Apps Script execution;
- автоматический backoff при временных Google service/quota errors;
- отсутствие физических записей в DataLens-connected DEV Publish.

Gate 5 не включает regular aggregate pipeline и не является DEV canary.

## 2. Safety boundary

Нормативное состояние feature flags:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Любая Gate 5 запись:

1. требует DEV Environment Guard;
2. запрещает ID рабочей Publish;
3. требует, чтобы целевая таблица находилась непосредственно в canonical
   `Test Files` folder;
4. выполняется только в автоматически созданных isolated workbooks;
5. для агрегатных строк проходит через Alpha.7.4 logical-series replacement и
   Gate 4 atomic Sheets API boundary.

Live Publish читается до и после прогона только для доказательства неизменности.

## 3. Артефакты одного запуска

`AKORT_alpha74Gate5Start()` создаёт в `Test Files`:

- `AKORT_ALPHA74_GATE5_BASELINE_*` — копия immutable Alpha.7.1 baseline для
  canonical normalization;
- `AKORT_ALPHA74_GATE5_LIVE_SNAPSHOT_*` — immutable snapshot текущей DEV
  Publish на момент старта;
- `AKORT_ALPHA74_GATE5_FULL_*` — full historical build из RAW;
- `AKORT_ALPHA74_GATE5_REPLAY_*` — sequential load/reversal replay.

Replay workbook также содержит:

- `GATE5_REPLAY_GROUPS` — durable accepted load/reversal order и статус каждой
  группы;
- `GATE5_FRONTIER` — immutable existing-period frontier.

Итоговый JSON evidence сохраняется в canonical `Test Results` folder.

Исходные baseline, DEV Publish, RAW и control tables не очищаются и не
перезаписываются.

## 4. Full build

Full build выполняется отдельными idempotent stages:

1. `WEEKLY`;
2. `MONTHLY`;
3. `INDUSTRY`;
4. `AGGREGATES_WEEKLY`;
5. `AGGREGATES_MONTHLY`;
6. `AGGREGATES_SPECIAL`;
7. `AGGREGATES_LATEST`.

Weekly/monthly/industry витрины строятся из authoritative RAW. Aggregate
compatibility oracle воспроизводит frozen legacy methodology, относительно
которой принимались Alpha.7.1–Alpha.7.3.

Этот oracle используется только в isolated acceptance harness. Рабочий
Alpha.7.4 Operation Engine продолжает использовать frozen Alpha.7.2 calculator
и Alpha.7.3 planner.

## 5. Sequential replay

Порядок событий строится из:

- `RAW_PRICES_WEEKLY`;
- `RAW_PRICES_MONTHLY`;
- `RAW_INDUSTRY`;
- successful rows `RAW_REVERSAL_LOG`.

Перед replay выполняется независимая проверка, что accepted load/reversal order
воспроизводит текущий RAW latest state.

Для каждой replay group последовательно пересчитываются:

```text
WEEKLY → MONTHLY → INDUSTRY → AGGREGATES
```

Aggregate rows рассчитываются compatibility oracle, но публикуются в replay
workbook только через:

- exact 29-column stage payload;
- deterministic logical series/row identity;
- bounded logical-series batches;
- Alpha.7.4 before/after fingerprints;
- atomic isolated `spreadsheets.batchUpdate`;
- read-back-compatible canonical row representation.

При превышении atomic limit даже для одной логической серии harness завершается
fail-closed с `ALPHA74_GATE5_ATOMIC_LIMIT_EXCEEDED`.

## 6. Автоматическое выполнение

Entry points:

| Функция | Назначение |
|---|---|
| `AKORT_alpha74Gate5Status()` | Read-only preflight и текущий checkpoint |
| `AKORT_alpha74Gate5Start()` | Создание артефактов, checkpoint и trigger |
| `AKORT_alpha74Gate5Worker()` | Trigger handler; вручную не запускать |
| `AKORT_alpha74Gate5Stop()` | Остановить trigger, сохранив state и артефакты |

`Start` создаёт один persistent time-driven trigger с интервалом одна минута.
Worker использует lock, execution budget, bounded step count и сохраняет
checkpoint после каждого durable шага. Начиная с `4.0.0-alpha.7.4.3`,
full build также cursor-checkpointed:

- weekly/monthly и standard aggregate rows записываются блоками по 500 строк;
- industry и special aggregate rows — блоками по 250 строк;
- latest выполняется двумя проходами `INDEX_SCAN` и `APPLY_FLAGS` по
  1 000 строк;
- prepare, каждый chunk и переключение стадии фиксируются отдельно;
- повтор после lost response перезаписывает тот же детерминированный диапазон.

Подробный контракт hotfix зафиксирован в
`GATE5_FULL_BUILD_CHUNKING_HOTFIX.md`.

Ручные вызовы `Worker` или отдельной `Continue` функции не требуются и не входят
в нормативный acceptance flow.

При Google service/quota error:

- transient error получает автоматический retry не ранее чем через 5 минут;
- quota error получает автоматический retry не ранее чем через 30 минут;
- после шести последовательных ошибок harness останавливается fail-closed;
- созданные артефакты сохраняются для диагностики.

## 7. Canonical reconciliation

После replay четыре isolated targets сортируются одним canonical sort.

Digest:

- охватывает все 29 колонок;
- нормализует `period_start` независимо от Date/ISO/Sheets serial;
- различает blank, number, boolean и string;
- рассчитывается bounded chunks по 1 000 строк;
- сравнивает rows, columns и SHA-256.

Нормативное равенство:

```text
immutable baseline copy
= live Publish snapshot
= full build
= sequential replay
```

После сравнения повторно читается фактическая live Publish. Её row count и
contract data hash обязаны совпадать со значениями до запуска.

## 8. Performance/quota evidence

Evidence фиксирует:

- количество worker executions и durable steps;
- full-build rows processed;
- full-build rows scanned, chunks и prepared stages;
- replay price rows written;
- aggregate rows calculated;
- logical series published;
- atomic API calls и subrequests;
- maximum replacement rows/cells/requests;
- quota backoffs и transient retries;
- worker duration;
- `manualContinuationCalls=0`;
- `livePublishPhysicalWrites=0`.

Maximum replacement metrics не могут превышать активные значения:

- `PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS`;
- `PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS`;
- `PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS`.

## 9. PASS criteria

Gate 5 может быть закрыт только если итоговый state содержит:

```text
status = SUCCESS
phase = SUCCESS
exactBaselineFullReplayLiveSnapshot = true
livePublishUnchanged = true
quotaAcceptance.accepted = true
noManualContinuation = true
regularPipelineEnabled = false
livePublishPhysicalWrites = 0
```

Дополнительно:

- все RAW replay validation rows имеют `PASS`;
- evidence JSON имеет schema
  `4.0-alpha74-gate5-evidence-2`;
- evidence SHA-256 и ссылки на четыре isolated artifacts сохранены;
- trigger автоматически удалён после terminal state.

До получения этого результата Gate 5 остаётся открытым.

## 10. Нормативная последовательность DEV

После `clasp push`:

1. убедиться, что предыдущий Gate 5 worker остановлен;
2. запустить `AKORT_alpha74Install()`;
3. повторно установить только
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
4. проверить, что
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
5. запустить `AKORT_alpha74SmokeTest()`;
6. запустить `AKORT_alpha74ReadOnlyContractScan()`;
7. запустить `AKORT_alpha74Gate5Status()` и проверить `ready=true`;
8. один раз запустить `AKORT_alpha74Gate5Start()`; это создаёт новый
   execution и новые isolated artifacts, а не продолжает остановленный
   `4.0.0-alpha.7.4.2`;
9. не запускать `AKORT_alpha74Gate5Worker()` вручную;
10. периодически запускать только `AKORT_alpha74Gate5Status()`;
11. после `SUCCESS` сохранить полный результат status и ссылку на evidence.

Gate 6 начинается только после отдельного review Gate 5 evidence.
