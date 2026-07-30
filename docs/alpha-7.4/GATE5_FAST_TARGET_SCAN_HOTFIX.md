# Alpha.7.4 Gate 5 fast target-scan hotfix

## 1. Назначение

Release `4.0.0-alpha.7.4.11` ускоряет aggregate sequential replay Gate 5
без изменения frozen 29-column Publish contract и без повторного full build.

Причина hotfix — два полных чтения `PUBLISH_PRICE_AGGREGATES` по 29 колонок
для каждого publication sub-batch из максимум 32 logical series. При
61 636 строках подтверждение небольшого affected set стало основной
стоимостью каждого worker execution.

## 2. Использованный паттерн Alpha.6

Hotfix сохраняет принципы принятого Alpha.6 reconciliation:

- replay inventory и progress отделены от физической таблицы;
- рассчитанный work хранится durable и не пересчитывается при продолжении;
- target сначала сканируется по минимальному набору identity columns;
- физически читается и заменяется только affected set;
- cursor передвигается только после подтверждённого результата.

Для Alpha.7.4 сохранена более строгая logical-series atomic boundary,
которой не было в раннем aggregate replay Alpha.6.

## 3. Новый read path

Перед atomic replacement:

1. Из durable `GATE5_AGGREGATE_BATCH_STAGE` выбирается окно максимум из
   32 logical series.
2. Через один Sheets API `batchGet` сканируются только девять колонок,
   определяющих frozen public series identity:
   `dataset_code`, `frequency`, `aggregate_level`, `aggregate_name`,
   `category_id`, `product_group`, `value_type`, `index_type`,
   `weight_source`.
3. Физические номера совпавших строк объединяются в contiguous ranges.
4. Полные 29-column values читаются только для этих affected ranges.
5. Existing Alpha.7.4 planner строит тот же full-series replacement и
   применяет те же row/cell/request limits.

После atomic replacement:

1. replacement по-прежнему удаляет все физические строки affected series
   и append-ит exact expected after-state;
2. read-back читает только детерминированный appended tail;
3. cursor передвигается только если tail даёт unique expected
   `afterFingerprint`;
4. lost response повторно выполняет identity scan и классифицирует уже
   достигнутый after-state как `NOOP`;
5. exact duplicates ремонтируются, conflicting duplicates остаются
   fail-closed.

Таким образом, на каждый publication step больше нет двух чтений
`61 636 × 29`. Выполняется один scan `61 636 × 9`, affected-range read и
bounded tail read-back.

## 4. Durable compatibility

Release использует:

```text
release          = 4.0.0-alpha.7.4.11
Gate 5 version   = 4.0-alpha74-gate5-acceptance-9
state schema     = 4.0-alpha74-gate5-state-9
evidence schema  = 4.0-alpha74-gate5-evidence-9
```

`AKORT_alpha74Gate5ResumeReplay()` принимает вручную остановленный
checkpoint `.10 / state-8`, а после перехода — также текущий
`.11 / state-9` checkpoint:

```text
source release = 4.0.0-alpha.7.4.10
source state   = 4.0-alpha74-gate5-state-8
stage          = AGGREGATES
triggerCount   = 0
```

Разрешены обе подтверждённые границы:

- между combination batches: `aggregateBatch=null`, `seriesCursor=0`;
- внутри materialized batch: cache присутствует и
  `state.aggregateSeriesCursor == aggregateBatch.seriesCursor`.

Во втором случае сохраняются workbook, group index, combination cursor,
cached stage fingerprint и series cursor. Уже опубликованные серии не
переигрываются.

Recovery mode:

```text
DURABLE_FAST_TARGET_SCAN_RESUME
```

## 5. Новые метрики

Gate 5 status и evidence включают:

- `performanceRecoveryAdoptions`;
- `targetIdentityScans`;
- `targetIdentityRowsScanned`;
- `targetIdentityCellsRead`;
- `targetAffectedRowsRead`;
- `targetAffectedRangesRead`;
- `targetReadbackRowsRead`.

## 6. DEV runbook

На коде `.10`:

1. Запустить `AKORT_alpha74Gate5Stop()`.
2. Проверить `status=STOPPED`, `failureCode=STOPPED_MANUALLY`,
   `triggerCount=0`.
3. Сохранить полный результат status.

После commit, публикации и `clasp push` `.11`:

1. Запустить `AKORT_alpha74Install()`.
2. Запустить `AKORT_alpha74SmokeTest()`.
3. Запустить `AKORT_alpha74ReadOnlyContractScan()`.
4. Проверить:
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`,
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`.
5. Запустить `AKORT_alpha74Gate5Status()` и убедиться, что старый
   checkpoint остаётся `STOPPED`, а release harness равен `.11`.
6. Один раз запустить `AKORT_alpha74Gate5ResumeReplay()`.
7. Проверить:
   `stateSchemaVersion=4.0-alpha74-gate5-state-9`,
   `release=4.0.0-alpha.7.4.11`,
   `status=RUNNING`,
   `recovery.mode=DURABLE_FAST_TARGET_SCAN_RESUME`,
   `triggerCount=1`.
8. Не запускать worker вручную. Для наблюдения использовать только
   `AKORT_alpha74Gate5Status()`.

Новый `AKORT_alpha74Gate5Start()` не используется: он создаст новый полный
acceptance execution вместо продолжения сохранённого replay.
