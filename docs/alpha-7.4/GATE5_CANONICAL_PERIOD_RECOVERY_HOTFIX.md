# Gate 5 authoritative canonical-period recovery hotfix

## Решение

Release `4.0.0-alpha.7.4.17` продолжает только terminal Gate 5 `.16` и не
создаёт новый full build или sequential replay. Все четыре isolated-артефакта
сохраняются. DataLens-connected DEV Publish используется только для проверки
неизменности.

Точка входа:

```text
AKORT_alpha74Gate5RecoverCanonicalPeriods()
```

Она принимает только exact incident:

```text
release = 4.0.0-alpha.7.4.16
stateSchemaVersion = 4.0-alpha74-gate5-state-14
status = FAILED
phase = FAILED
failureCode = ALPHA74_GATE5_RECONCILIATION_FAILED
reconciliationRecoveryStage = COMPLETE
recovery.mode = TERMINAL_RECONCILIATION_RECOVERY
failureDetails.exact = false
failureDetails.liveUnchanged = true
failureDetails.quotaAccepted = true
failureDetails.aggregateAccepted = true
failureDetails.rawAccepted = true
triggerCount = 0
```

Дополнительно baseline, live snapshot и full build обязаны иметь одинаковый
`ROW_MULTISET_V1` digest. Replay обязан иметь те же 61 636 строк и 29 колонок,
но отличный hash. Любое другое состояние блокируется fail-closed.

## Диагностика `.16`

Read-only сравнение полного набора подтвердило:

- все 61 636 logical rows сопоставлены без пропусков и дубликатов;
- аналитические значения, веса, вклады и latest-флаги совпадают;
- `period_start` отличается в 32 886 replay rows;
- 29 421 дат имеют сдвиг `+0.5` суток, 3 465 — `-0.5` суток;
- 693 `ROSSTAT_WEEKLY` aggregate IDs отличаются как производное от периода.

Причина — повторное создание Google Sheets date cells через локальный объект
времени в `.16`. Поэтому `.17` больше не вычисляет дату replay самостоятельно.

## Durable recovery flow

1. Full build и replay сортируются по одному уникальному logical key, который
   не содержит `aggregate_id` и `period_start`, но содержит dataset, source,
   frequency, aggregate dimensions, value/index type, year/quarter/month и
   `period_label`.
2. На каждой строке ключ full build обязан точно совпасть с ключом replay;
   дубликат или несовпадение останавливает recovery.
3. `aggregate_id` и `period_start` копируются из full build в replay чанками по
   1 000 строк с обязательным read-back.
4. Replay latest пересчитывается durable scan/apply.
5. Digest всех четырёх артефактов повторяется bounded chunks.
6. Final reconciliation сохраняет evidence schema
   `4.0-alpha74-gate5-evidence-15` и завершает Gate 5 только при exact equality.

Lost response безопасен: повтор одного чанка идемпотентен, а cursor хранится в
Script Properties.

## Установка и запуск в DEV

После публикации коммита и `clasp push` выполнить строго по порядку:

```text
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate5Status()
AKORT_alpha74Gate5RecoverCanonicalPeriods()
```

Recovery запускается один раз. Далее вручную вызывается только:

```text
AKORT_alpha74Gate5Status()
```

Не запускать `Gate5Start`, `Gate5RestartReplay`, `Gate5ResumeReplay`,
`Gate5RecoverReconciliation` или `Gate5Worker`.

`PUBLISH_AGGREGATE_EXECUTION_ENABLED` остаётся включённым, а
`PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` — выключенным до Gate 6.

## PASS

Gate 5 закрывается только при `status=SUCCESS`, `phase=SUCCESS`, одинаковом
row-multiset digest всех четырёх артефактов, новом evidence JSON и неизменной
DEV Publish.
