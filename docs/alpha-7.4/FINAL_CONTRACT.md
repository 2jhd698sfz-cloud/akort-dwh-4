# Alpha.7.4 — Final Implementation Contract

## 1. Цель

Обеспечить resumable incremental update таблицы `PUBLISH_PRICE_AGGREGATES` при:

- новом периоде;
- revision существующего периода;
- reversal по `load_id`;
- изменении versioned weights или memberships;
- полном историческом build/replay для приёмки.

Результат должен быть численно эквивалентен verified baseline и не менять frozen методологию Alpha.7.1–Alpha.7.3.

## 2. Границы

В scope:

- dependency expansion;
- deterministic calculation;
- durable staging;
- incremental logical-series replacement;
- latest recalculation;
- timeout/resume;
- idempotency;
- logical reversal;
- read-back;
- full and incremental reconciliation;
- performance/quota acceptance;
- regular DEV enablement.

Вне scope:

- DataLens API и управление его refresh;
- новые экономические показатели;
- изменение 29-колоночного Publish schema;
- автоматические коннекторы Росстата, ЕМИСС или ФНС;
- пользовательский Control Center.

## 3. Frozen authority

| Область | Authority |
|---|---|
| Accepted base | commit `52590c8e036d49b9f76f87341b69881a916c851d` |
| Output schema и keys | Alpha.7.1 |
| Расчёт и округление | Alpha.7.2 |
| Definitions, revision и reversal planning | Alpha.7.3 |
| Первичный source impact | Alpha.6 `PUBLISH_IMPACT` |
| Operation state | Alpha.3 `OPERATION_QUEUE` |
| RAW lineage | Alpha.4 `load_id` и reversal log |

## 4. Identity invariants

1. Business identity строки: `aggregate_row_key`.
2. Business identity серии: `aggregate_series_key`.
3. Физический номер строки не является identity и не сохраняется в checkpoint/stage.
4. В target не может быть двух одинаковых `aggregate_row_key`.
5. Staged affected-set должен содержать полный ожидаемый набор строк для каждой заменяемой серии.
6. `is_latest_period=1` допускается ровно для последнего существующего publishable периода каждой серии.
7. Future periods не создаются.
8. Неполная coverage не публикуется, если frozen contract возвращает `publication_allowed=false`.
9. Все версии definitions, weights и memberships фиксируются snapshot id + hash.
10. Один и тот же authoritative input fingerprint обязан давать тот же plan, rows и publish fingerprint.

## 5. Operation phases

### PREPARING_AGGREGATE_IMPACT

Вход:

- successful `UPDATE_PUBLISH`;
- `operation_id`;
- `load_id`;
- persisted `PUBLISH_IMPACT`.

Действия:

- проверить соответствие operation/load;
- дедуплицировать impact;
- расширить dependent periods;
- выбрать active definitions и memberships;
- зафиксировать affected-series hash.

Выход: immutable planner request и его fingerprint.

### MATERIALIZING_AGGREGATE_INPUTS

- Однократно прочитать необходимые weekly/monthly Publish rows, weights и membership rules.
- Запретить per-row Sheets reads.
- Сохранить immutable input artifact или эквивалентный durable snapshot.
- На resume проверять artifact hash и frozen versions.

### CALCULATING_AGGREGATE_SLICES

- Вызвать только `Alpha72AggregateCalculator.calculateBatch`.
- Обрабатывать bounded slices.
- Сохранять calculation id/fingerprint и cursor.
- Любой blocked/invalid результат проходит frozen publication rules.

### STAGING_AGGREGATE_ROWS

- Сохранить строки в `AGGREGATE_STAGE`.
- Проверить contract headers, logical keys, duplicates, expected row count и stage hash.
- До полного подтверждения expected affected-set публикация запрещена.

### UPDATING_AGGREGATES

Единица обновления: полная логическая серия `aggregate_series_key`.

Алгоритм:

1. одним bounded read построить current logical-key index affected-set;
2. проверить target-before fingerprint;
3. объединить неизменившиеся периоды серии со staged affected periods;
4. получить полный replacement set каждой affected series;
5. проверить keys, coverage, versions и expected hash;
6. выполнить один atomic Google Sheets `batchUpdate` для всего regular affected-set;
7. выполнить read-back;
8. только после совпадения target-after hash завершить phase.

Если весь affected-set не помещается в утверждённый atomic request limit:

- Publish не изменяется;
- операция получает `AGGREGATE_PUBLISH_ATOMIC_LIMIT_EXCEEDED`;
- данные остаются в stage;
- используется isolated rebuild/reconciliation path;
- разбиение на видимые DataLens частичные commits запрещено.

### UPDATING_AGGREGATE_LATEST

- Latest intents строит Alpha.7.3.
- Latest применяется в том же atomic publish request либо phase подтверждает уже опубликованный latest state.
- Read-back проверяет один latest на series и отсутствие future latest.

### RECONCILING_AGGREGATES

Обязательные проверки:

- staged rows = expected rows;
- published affected rows = staged replacement rows;
- unrelated fingerprint unchanged;
- no duplicate row/series-period keys;
- latest correct;
- versions/fingerprints match;
- full-vs-incremental reconciliation при соответствующем run mode.

### UPDATE_STATUS / QUICK_AUDIT / FINALIZING

- `PUBLISH_RUNS` получает окончательный status и метрики.
- `PUBLISH_RECONCILIATION` получает hashes/counts.
- Stage получает terminal status.
- `SUCCESS` разрешён только после всех проверок.

## 6. Publication consistency for DataLens

Apps Script не управляет DataLens.

Поэтому Publish обязан оставаться корректным при чтении в любой момент:

- regular affected-set публикуется одним atomic request;
- до commit DataLens видит предыдущее полное состояние;
- после commit DataLens видит новое полное состояние;
- промежуточный affected-set недопустим;
- full historical build выполняется в isolated artifact и не заменяет рабочий Publish до отдельного cutover gate.

Контракт опирается на гарантию Google Sheets API: все subrequests одного
`spreadsheets.batchUpdate` применяются атомарно либо весь request завершается без
записи:
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate

29-колоночный schema `PUBLISH_PRICE_AGGREGATES` не изменяется.

## 7. Idempotency and recovery

- Idempotency root: `operation_id + load_id + plan_fingerprint`.
- Повтор после lost response сначала делает read-back.
- State `before` → write разрешён.
- State `after` → операция отмечает batch как recovered without rewrite.
- Любой third/mixed state → `FAILED_REQUIRES_REVIEW`, без автоматического overwrite.
- Checkpoint после write сохраняется только после read-back.
- Timeout до write безопасно продолжает calculation/staging.
- Timeout после write восстанавливается через target fingerprint.

## 8. Reversal

- Reversal создаёт обычную `RAW_REVERSAL_V4`.
- Alpha.6 строит reversal impact.
- Alpha.7.3 `planReversal` использует positive current-effect evidence и previous inputs.
- Результат проходит те же stages и publication adapter.
- Отдельный physical reverse executor запрещён.

## 9. Full build and reconciliation

- Full build создаёт isolated artifact.
- Sequential replay воспроизводит accepted load/reversal order.
- Сравнение выполняется по row keys, values, latest flags, counts и deterministic hashes.
- Baseline из 61 636 строк должен быть воспроизведён точно с учётом frozen legacy rounding.
- Maximum-volume run обязан завершаться через штатные checkpoints без ручного restart.
- Alpha.7.4 не принимается без full build, replay, reconciliation и performance evidence.

## 10. Feature flags

```text
PUBLISH_ENGINE_ENABLED = TRUE
PUBLISH_AGGREGATE_EXECUTION_ENABLED = FALSE   # до live-write gate
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE   # до authoritative DEV canary
PUBLISH_USER_PIPELINE_ENABLED = FALSE   # до Gate 7 и разрешения Beta 2
```

Flags включаются последовательно и фиксируются в release evidence.

Gate 6 самостоятельно запускает только заранее проверенный weekly/monthly
source-file canary и не открывает обычный `IndustryInputSubmit` или другие
пользовательские загрузки. После Gate 6 regular aggregate pipeline может
остаться включённым, но user pipeline остаётся `FALSE` до Gate 7.

## 11. Terminal acceptance

`ACCEPTED_AND_CLOSED` разрешён только если:

- все architecture gates A74 пройдены;
- все IU74-001–080 пройдены;
- нет blocker/critical/major findings;
- full build и sequential replay совпадают;
- timeout/resume доказан на каждой длинной phase;
- authoritative DEV canary успешен;
- выполнены регулярные DEV cycles;
- подготовлен immutable package, commit и tag;
- independent final review дал GO.
