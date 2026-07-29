# Alpha.7.4.6 — Gate 5 Canonical Replay Recovery Hotfix

## 1. Инцидент

DEV execution `A74_GATE5_CDEFB6487105607FB35F` на release
`4.0.0-alpha.7.4.4` был вручную остановлен 29 июля 2026 года.

К моменту остановки:

- все семь full-build stages были завершены;
- full build содержал нормативные aggregate rows;
- sequential replay дошёл до третьей load group;
- было записано `18 482` price rows;
- обработано почти `480` aggregate combinations третьей группы;
- `replayAggregateRowsCalculated`, `replayAggregateSeriesPublished` и
  `atomicApiCalls` оставались равны нулю;
- DataLens-connected DEV Publish не изменялась.

## 2. Root cause

Production incremental planner использует `v310ExpandAffectedTargets_()` и
`v310AggregateIndexTypes_()`. Для price-level RAW row с пустым `index_type`
они создают canonical aggregate combinations:

```text
weekly: wow, yoy, december
monthly: mom, yoy, december
```

Gate 5 replay содержал отдельную реализацию expansion. Она переносила пустой
RAW `index_type` в aggregate combination без canonical expansion. Calculated
Publish rows имеют `wow/mom`, `yoy` или `december`, поэтому ни одна комбинация
не совпадала и calculator возвращал пустой набор.

## 3. Исправление

Release `4.0.0-alpha.7.4.6`:

1. удаляет отдельную реализацию aggregate combination expansion из replay;
2. переиспользует production `v310ExpandAffectedTargets_()` напрямую;
3. сохраняет existing-period frontier filtering;
4. обрабатывает до 50 combinations в calculation batch;
5. начинает logical-series batch с 64 серий и автоматически уменьшает его до
   active atomic limits;
6. считает processed combinations и calculated rows только один раз, даже
   если logical-series publication требует несколько batches;
7. завершает run fail-closed с
   `ALPHA74_GATE5_AGGREGATE_REPLAY_EMPTY`, если после третьей replay group
   aggregate combinations обработаны, но не рассчитана ни одна строка;
8. требует положительные aggregate rows, published series и atomic API calls
   в финальном evidence.

## 4. Replay-only recovery

`AKORT_alpha74Gate5RestartReplay()` является единственным нормативным
entrypoint для восстановления данного инцидента.

Функция разрешена только если:

- checkpoint остановлен вручную;
- источник имеет schema `state-3` или текущую `state-4`;
- source release входит в разрешённый recovery set;
- все семь full-build stages завершены;
- preserved full build содержит aggregate rows;
- baseline, live snapshot и full build находятся в canonical Test Files;
- их aggregate schemas совпадают с 29-column contract;
- остановленный run имеет zero-aggregate incident profile;
- фактическая DEV Publish не изменилась относительно preserved live snapshot.

Recovery:

- сохраняет baseline copy;
- сохраняет live snapshot;
- сохраняет completed full build;
- сохраняет ошибочный replay workbook как superseded diagnostic artifact;
- создаёт только новый `AKORT_ALPHA74_GATE5_REPLAY_RECOVERY_*`;
- создаёт новый execution ID и `state-4`;
- начинает с `PREPARE_REPLAY`, затем повторяет все load groups с группы `0`;
- не повторяет full build.

В evidence сохраняется recovery lineage и discarded replay metrics.

## 5. Safety

Feature flags остаются:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Все записи выполняются только в новом isolated replay workbook. Live Publish
проверяется read-only до recovery и после reconciliation.

## 6. Нормативный DEV запуск

После публикации commit и `clasp push`:

1. `AKORT_alpha74Install()`;
2. `AKORT_alpha74SmokeTest()`;
3. `AKORT_alpha74ReadOnlyContractScan()`;
4. `AKORT_alpha74Gate5Status()` — должен показать preserved stopped
   `4.0.0-alpha.7.4.4` checkpoint и `triggerCount=0`;
5. один раз `AKORT_alpha74Gate5RestartReplay()`;
6. убедиться, что:
   - release равен `4.0.0-alpha.7.4.6`;
   - state schema равна `4.0-alpha74-gate5-state-4`;
   - phase равна `PREPARE_REPLAY` или `SEQUENTIAL_REPLAY`;
   - `recovery.mode=REPLAY_ONLY_CANONICAL_INDEX_RECOVERY`;
   - baseline, live snapshot и full build IDs сохранены;
   - создан новый sequential replay ID;
   - `triggerCount=1`;
7. далее запускать только `AKORT_alpha74Gate5Status()`.

`AKORT_alpha74Gate5Start()` для этого инцидента не используется.
