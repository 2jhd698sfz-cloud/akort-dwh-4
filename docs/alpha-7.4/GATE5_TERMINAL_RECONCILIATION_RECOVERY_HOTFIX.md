# Gate 5 terminal reconciliation recovery hotfix

## Решение

Release `4.0.0-alpha.7.4.16` восстанавливает завершившийся с ошибкой Gate 5
`.15` с финальной сверки. Новый full build, повторный replay цен и повтор всех
12 исторических загрузок не выполняются. Сохраняются и повторно используются
четыре уже созданных isolated-артефакта: baseline, live snapshot, full build и
sequential replay.

Новая точка входа:

```text
AKORT_alpha74Gate5RecoverReconciliation()
```

Она принимает только точный terminal incident:

```text
release = 4.0.0-alpha.7.4.15
stateSchemaVersion = 4.0-alpha74-gate5-state-13
status = FAILED
phase = FAILED
failureCode = ALPHA74_GATE5_RECONCILIATION_FAILED
failureDetails.exact = false
failureDetails.liveUnchanged = true
failureDetails.quotaAccepted = true
failureDetails.aggregateAccepted = true
failureDetails.rawAccepted = true
triggerCount = 0
replayGroupIndex = replayGroupCount = 12
```

Любое отклонение блокирует восстановление fail-closed.

## Что показала диагностика

Все 61 636 logical rows full build и sequential replay присутствуют с
одинаковыми аналитическими значениями. Финальный digest расходился только из-за
технического представления:

- `aggregate_id` — 12 786 строк;
- `period_start` — 32 215 строк;
- monthly `period_label` — 28 750 строк;
- `is_latest_period` — 1 364 строк между live/baseline и full/replay;
- baseline и live содержат один набор строк, но в разном физическом порядке.

Это не расхождение экономических расчётов. Причины устранены в четырёх местах:

1. incremental aggregate rows получают тот же legacy-compatible
   `aggregate_id`, что и full build;
2. Sheets API записывает `period_start` в каноническом date-представлении и
   monthly `period_label` как дату;
3. latest-index нормализует прочитанный Google Sheets `Date`, а не сравнивает
   его через `String(Date)` с ISO period key;
4. reconciliation digest сравнивает мультимножество полных 29-column строк и
   больше не зависит от их физического порядка. Дубликаты по-прежнему меняют
   digest.

## Durable recovery flow

Persistent worker выполняет только остаточные действия:

1. `REPAIR_REPLAY` — по 1 000 строк нормализует ID и даты сохранённого replay;
2. `FULL_LATEST` — durable scan/apply восстанавливает latest во full build;
3. `REPLAY_LATEST` — то же для replay;
4. `NORMALIZE` и `DIGEST` — повторная bounded сверка всех четырёх артефактов;
5. `FINAL_RECONCILIATION` — создаёт новый evidence JSON и завершает Gate 5.

Каждый cursor записывается в Script Properties. При временной ошибке следующий
trigger продолжает с последней сохранённой границы.

## Установка и запуск в DEV

После публикации коммита и `clasp push` выполнить строго по порядку:

```text
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate5Status()
AKORT_alpha74Gate5RecoverReconciliation()
```

Перед recovery status обязан показывать описанный выше `.15 / state-13`
terminal incident, `triggerCount=0`, `ready=true`. Функцию recovery запускают
один раз. После неё вручную вызывают только:

```text
AKORT_alpha74Gate5Status()
```

Не запускать `Gate5Start`, `Gate5RestartReplay`, `Gate5ResumeReplay` или
`Gate5Worker`. `PUBLISH_AGGREGATE_EXECUTION_ENABLED` остаётся включённым,
`PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` — выключенным до Gate 6.

## PASS

Gate 5 закрывается только при `status=SUCCESS`, `phase=SUCCESS`, новом evidence
schema `4.0-alpha74-gate5-evidence-14`, точном row-multiset digest всех четырёх
артефактов и неизменной DataLens-connected DEV Publish.
