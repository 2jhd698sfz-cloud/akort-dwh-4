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
- `GATE5_FRONTIER` — immutable existing-period frontier;
- `GATE5_AGGREGATE_ITEMS` — durable canonical combination inventory текущей
  replay group;
- `GATE5_AGGREGATE_BATCH_STAGE` — durable immutable stage records текущего
  aggregate replay batch.

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

Replay использует production `v310ExpandAffectedTargets_()` и canonical
`v310AggregateIndexTypes_()`. Отдельная реализация index expansion запрещена.
После третьей load group нулевой cumulative aggregate result завершается
fail-closed с `ALPHA74_GATE5_AGGREGATE_REPLAY_EMPTY`.

## 6. Автоматическое выполнение

Entry points:

| Функция | Назначение |
|---|---|
| `AKORT_alpha74Gate5Status()` | Read-only preflight и текущий checkpoint |
| `AKORT_alpha74Gate5Start()` | Создание артефактов, checkpoint и trigger |
| `AKORT_alpha74Gate5RestartReplay()` | Recovery с сохранением completed full build и повтором только sequential replay |
| `AKORT_alpha74Gate5ResumeReplay()` | Продолжить stopped boundary или точный triggerless legacy partial-batch incident |
| `AKORT_alpha74Gate5Worker()` | Trigger handler; вручную не запускать |
| `AKORT_alpha74Gate5Stop()` | Остановить trigger, сохранив state и артефакты |

`Start` создаёт один persistent time-driven trigger с интервалом одна минута.
Worker использует lock, execution budget, bounded step count и сохраняет
checkpoint после каждого durable шага. Full build использует single-pass
durable materialization и cursor-copy:

- payload каждой стадии рассчитывается один раз в isolated materialization;
- weekly/monthly и standard aggregate rows копируются блоками по 500 строк;
- industry и special aggregate rows — блоками по 250 строк;
- latest выполняется двумя проходами `INDEX_SCAN` и `APPLY_FLAGS` по
  1 000 строк;
- prepare, каждый chunk и переключение стадии фиксируются отдельно;
- повтор после lost response перезаписывает тот же детерминированный диапазон.

Подробный контракт hotfix зафиксирован в
`GATE5_DURABLE_MATERIALIZATION_HOTFIX.md`.

Начиная с `4.0.0-alpha.7.4.8`, aggregate sequential replay также использует
durable materialization:

- calculation batch ограничен 25 combinations;
- exact stage records один раз сохраняются в
  `GATE5_AGGREGATE_BATCH_STAGE`;
- legacy publication batch `.8–.11` ограничен 32 logical series;
- materialization и каждый publication sub-batch имеют отдельные checkpoints;
- lost response повторяет только публикацию сохранённого batch и распознаёт
  достигнутый after-state как `NOOP`;
- финальный replay latest выполняется durable проходами
  `INDEX_SCAN → APPLY_FLAGS` по 1 000 строк.

Начиная с `4.0.0-alpha.7.4.9`, isolated replay дополнительно восстанавливает
exact physical duplicates после uncertain atomic response:

- одинаковость проверяется по всем 29 canonical contract values;
- все физические копии affected series удаляются одним atomic replacement;
- совпадение logical before/after fingerprint не отменяет обязательный
  physical repair;
- cursor меняется только после unique read-back;
- conflicting duplicate остаётся fail-closed;
- source checkpoint `7.4.8 / state-6 / FAILED` продолжает cached batch через
  `AKORT_alpha74Gate5ResumeReplay()`.

Начиная с `4.0.0-alpha.7.4.10`, durable stage и физическая публикация
используют один period identity:

- Date сначала сериализуется в durable payload;
- row key выводится из сериализованного `period_start`;
- legacy `.9` cached batch с Monday key и Sunday payload мигрируется при
  replacement planning без перезаписи cache;
- exact duplicates текущего affected batch удаляются до unique read-back;
- terminal `.9 / state-7` checkpoint продолжается в режиме
  `DURABLE_PERIOD_IDENTITY_REPAIR_RESUME`.

Начиная с `4.0.0-alpha.7.4.11`, aggregate replay использует bounded target
scan по принятому в Alpha.6 принципу:

- full-table identity scan читает только девять frozen identity columns;
- полные 29-column rows читаются только для affected logical series;
- после atomic append проверяется только deterministic appended tail;
- lost-response classification, exact-duplicate repair, third-state
  fail-closed и atomic limits не ослабляются;
- stopped `.10 / state-8` checkpoint, включая частично опубликованный
  durable batch, продолжается через `AKORT_alpha74Gate5ResumeReplay()` в
  режиме `DURABLE_FAST_TARGET_SCAN_RESUME`.

Начиная с `4.0.0-alpha.7.4.12`, один identity scan обслуживает adaptive
publication window:

- candidate window содержит до 128 следующих logical series;
- максимальный непрерывный prefix выбирается двоичным поиском;
- frozen limits 5 000 rows / 100 000 cells / 500 requests не повышаются;
- лёгкий step может объединить до четырёх прежних 32-series шагов;
- тяжёлый step автоматически уменьшается до безопасного размера;
- atomic write, appended-tail read-back и durable cursor остаются одной
  подтверждённой границей;
- stopped `.11 / state-9` checkpoint продолжается в режиме
  `DURABLE_ADAPTIVE_WINDOW_RESUME`.

Release `4.0.0-alpha.7.4.13` добавляет `.11 / state-9` в финальный
schema/release allowlist `assertDurableResumeSource_`. Fail-closed `.12`
resume не изменил checkpoint или workbook; продолжение выполняется с
group 1, combo cursor 300 и series cursor 256. Regression suite проверяет
как recovery-классификатор, так и финальные allowlist helpers.

Release `4.0.0-alpha.7.4.14` устраняет hard-timeout до создания
первого aggregate batch третьей replay group. Вместо одного
монолитного `replayItems()` weekly RAW, monthly RAW и reversal log
сканируются по 500 rows. Каждый source cursor сохраняется, комбинации
дедуплицируются в `GATE5_AGGREGATE_ITEMS`, а `FINALIZE` фиксирует
canonical order и SHA-256. Публикация читает только finalized inventory.
Остановленный `.13 / state-11` checkpoint продолжает group 2,
`AGGREGATES`, cursor 0 в режиме
`DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME` без нового full build,
replay workbook или повтора groups 0–1.

Release `4.0.0-alpha.7.4.15` устраняет следующий content-dependent timeout
на `.14 / state-12 / SCAN_WEEKLY / source cursor 4500`. До hotfix все
category-level affected rows чанка проходили dependent-period expansion, и
лишь затем одинаковые aggregate combinations схлопывались. `.15` сначала
дедуплицирует aggregate descriptors по экономической идентичности, после чего
вызывает тот же `v310ExpandAffectedTargets_()` с frozen frontier. Сохранённые
960 inventory items и source cursor 4500 переиспользуются; результат expansion
зафиксирован parity-тестом против недедуплицированного production planner.

Release `4.0.0-alpha.7.4.16` восстанавливает terminal `.15 / state-13`
reconciliation failure без повторения full build и 12 replay groups. Все
61 636 logical rows и аналитические значения уже совпали; расходились только
legacy aggregate IDs, типы date cells, latest flags и физический порядок строк.
Recovery чанками нормализует сохранённый replay, пересчитывает latest для full
и replay и использует duplicate-sensitive row-multiset digest, независимый от
порядка строк. Точка входа
`AKORT_alpha74Gate5RecoverReconciliation()` принимает только exact failure
profile с неизменной live Publish и удалённым trigger.

Release `4.0.0-alpha.7.4.17` принимает только terminal `.16 / state-14`, в
котором baseline, live snapshot и full build уже имеют одинаковый
`ROW_MULTISET_V1` digest, а replay имеет те же 61 636 строк и 29 колонок, но
другой hash. Точка входа
`AKORT_alpha74Gate5RecoverCanonicalPeriods()` сопоставляет full/replay без
`aggregate_id` и `period_start`, требует уникальный logical key и копирует эти
два поля только из authoritative full build. Durable cursor равен 1 000
строкам. После ремонта выполняются replay latest, digest и final
reconciliation; full build и 12 replay groups не повторяются.

Контракт и runbook описаны в
`GATE5_DURABLE_AGGREGATE_BATCH_HOTFIX.md` и
`GATE5_FAST_TARGET_SCAN_HOTFIX.md`.

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
- aggregate combinations processed;
- aggregate rows calculated;
- logical series published;
- atomic API calls и subrequests;
- maximum replacement rows/cells/requests;
- quota backoffs и transient retries;
- worker duration;
- identity scan rows/cells, affected ranges/rows и tail read-back rows;
- adaptive publication windows/series, limit reductions, fit evaluations,
  maximum series per publication и avoided legacy identity scans;
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
- `aggregateReplayAcceptance.accepted=true`;
- evidence JSON имеет schema
  `4.0-alpha74-gate5-evidence-14`;
- evidence SHA-256 и ссылки на четыре isolated artifacts сохранены;
- trigger автоматически удалён после terminal state.

До получения этого результата Gate 5 остаётся открытым.

## 10. Нормативная последовательность DEV

После `clasp push`:

1. убедиться, что предыдущий Gate 5 worker остановлен;
2. запустить `AKORT_alpha74Install()`;
3. запустить `AKORT_alpha74SmokeTest()`;
4. запустить `AKORT_alpha74ReadOnlyContractScan()`;
5. повторно установить только
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
6. проверить, что
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
7. запустить `AKORT_alpha74Gate5Status()` и проверить `ready=true`;
8. для terminal `.15 / state-13 / ALPHA74_GATE5_RECONCILIATION_FAILED`
   запустить только `AKORT_alpha74Gate5RecoverReconciliation()`; для нового
   запуска без reusable full build один раз запустить
   `AKORT_alpha74Gate5Start()`; для сохранённой точки release
   `4.0.0-alpha.7.4.6`, exact-duplicate checkpoint
   `4.0.0-alpha.7.4.8 / state-6 / FAILED` или вручную остановленного
   `.10 / state-8`, `.11 / state-9` или текущего
   `.13 / state-11 / group 2 / AGGREGATES / cursor 0` либо частичного
   `.14 / state-12 / SCAN_WEEKLY / source cursor 4500` использовать только
   `AKORT_alpha74Gate5ResumeReplay()`;
9. не запускать `AKORT_alpha74Gate5Worker()` вручную;
10. периодически запускать только `AKORT_alpha74Gate5Status()`;
11. после `SUCCESS` сохранить полный результат status и ссылку на evidence.

Gate 6 начинается только после отдельного review Gate 5 evidence.

Первичный canonical-index incident восстанавливался по
`GATE5_CANONICAL_REPLAY_RECOVERY_HOTFIX.md`. Текущий stopped aggregate replay
продолжается без нового replay workbook по
`GATE5_DURABLE_AGGREGATE_BATCH_HOTFIX.md`.
Текущий exact-duplicate incident продолжается по
`GATE5_EXACT_DUPLICATE_RECOVERY_HOTFIX.md`.
Performance resume `.10 → .11` выполняется по
`GATE5_FAST_TARGET_SCAN_HOTFIX.md`.
Adaptive resume `.11 → .12` выполняется по
`GATE5_ADAPTIVE_PUBLICATION_WINDOW_HOTFIX.md`.
Фактический DEV resume после allowlist incident выполняется release `.13`
по `GATE5_RESUME_ALLOWLIST_HOTFIX.md`.
Таймаут подготовки item inventory устраняется release `.14` по
`GATE5_DURABLE_AGGREGATE_ITEM_PREPARATION_HOTFIX.md`.
Content-dependent timeout внутри отдельного RAW chunk устраняется release
`.15` по `GATE5_PRE_EXPANSION_DESCRIPTOR_DEDUP_HOTFIX.md`.
Terminal reconciliation incident `.15` восстанавливается release `.16` по
`GATE5_TERMINAL_RECONCILIATION_RECOVERY_HOTFIX.md`.
