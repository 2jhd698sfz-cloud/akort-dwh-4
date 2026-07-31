# Alpha.7.4 Gate 5 adaptive publication-window hotfix

## 1. Назначение

Release `4.0.0-alpha.7.4.12` сокращает число full target identity scans в
aggregate sequential replay Gate 5. Hotfix продолжает сохранённый
`.11 / state-9` checkpoint без нового full build, нового replay workbook,
повторного price replay или повторного расчёта уже materialized aggregate
batch.

В `.11` каждый publication step обрабатывал не более 32 logical series.
Даже после перехода на девять identity columns это означало новый scan всей
растущей `PUBLISH_PRICE_AGGREGATES` для каждых 32 серий.

## 2. Adaptive publication window

В `.12` один publication step:

1. выбирает до 128 следующих logical series из immutable
   `GATE5_AGGREGATE_BATCH_STAGE`;
2. выполняет один девятиколоночный target identity scan для всего окна;
3. читает полные 29-column rows только для совпавших logical series;
4. подбирает максимальный непрерывный prefix серий, одновременно
   удовлетворяющий всем активным atomic limits;
5. выполняет один atomic replacement;
6. проверяет deterministic appended tail;
7. только после unique expected read-back передвигает durable series cursor.

Размер подбирается двоичным поиском. Верхняя граница — 128 серий, но
фактический шаг автоматически уменьшается до любого безопасного значения,
если иначе превышаются:

```text
PUBLISH_AGGREGATE_ATOMIC_MAX_ROWS     = 5000
PUBLISH_AGGREGATE_ATOMIC_MAX_CELLS    = 100000
PUBLISH_AGGREGATE_ATOMIC_MAX_REQUESTS = 500
```

Значения этих limits hotfix не повышает. Одна logical series, которая сама
превышает любой limit, по-прежнему останавливает Gate 5 fail-closed.

## 3. Safety invariants

Hotfix не меняет frozen 29-column Publish contract и сохраняет:

- isolated Test Files target;
- запрет записи в DataLens-connected DEV Publish;
- immutable durable aggregate stage cache;
- logical-series complete replacement;
- exact-duplicate physical repair;
- conflicting-duplicate fail-closed;
- period identity normalization;
- lost-response повтор с классификацией достигнутого after-state как `NOOP`;
- third-state fail-closed;
- read-back до движения cursor;
- checkpoint после каждого подтверждённого adaptive publication step.

Если Apps Script execution завершится после физического write, но до
checkpoint, следующий worker повторно сканирует target. Уже достигнутый
unique after-state не переписывается и подтверждается как lost-response
`NOOP`.

## 4. Version и durable compatibility

```text
release          = 4.0.0-alpha.7.4.12
Gate 5 version   = 4.0-alpha74-gate5-acceptance-10
state schema     = 4.0-alpha74-gate5-state-10
evidence schema  = 4.0-alpha74-gate5-evidence-10
aggregate work   = 4.0-alpha74-gate5-aggregate-work-1
```

`AKORT_alpha74Gate5ResumeReplay()` принимает вручную остановленный
`.11 / state-9` checkpoint при выполнении всех условий:

- `status=STOPPED`;
- `phase=STOPPED`;
- `failureCode=STOPPED_MANUALLY`;
- `triggerCount=0`;
- `replay.stage=AGGREGATES`;
- checkpoint находится между materialized batches либо на подтверждённой
  границе внутри текущего batch;
- `state.aggregateSeriesCursor == aggregateBatch.seriesCursor`;
- durable stage fingerprint и cache присутствуют.

Recovery mode:

```text
DURABLE_ADAPTIVE_WINDOW_RESUME
```

## 5. Новые метрики

Status и evidence дополнительно содержат:

- `adaptiveWindowRecoveryAdoptions`;
- `adaptivePublicationWindows`;
- `adaptivePublicationSeries`;
- `adaptivePublicationLimitReductions`;
- `adaptivePublicationFitEvaluations`;
- `maximumSeriesPerPublication`;
- `legacyIdentityScansAvoided`.

Фактическое ускорение подтверждается, когда
`maximumSeriesPerPublication > 32` и `legacyIdentityScansAvoided` растёт.
`adaptivePublicationLimitReductions` показывает, сколько окон было
автоматически уменьшено без нарушения atomic limits.

## 6. DEV deployment runbook

### 6.1 Перед публикацией `.12`

На развёрнутом `.11` один раз запустить:

```javascript
AKORT_alpha74Gate5Stop()
```

Сохранить полный результат и проверить:

```text
status       = STOPPED
phase        = STOPPED
failureCode  = STOPPED_MANUALLY
triggerCount = 0
```

Не запускать `Start`, `Resume` или `Worker`.

### 6.2 После commit, публикации и `clasp push`

Последовательно запустить:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate5Status()
```

`Install` fail-closed возвращает execution flag в `FALSE`. После smoke и
read-only scan установить в `SYSTEM_SETTINGS`:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Снова запустить:

```javascript
AKORT_alpha74Gate5Status()
```

Проверить release harness `.12`, сохранённый stopped `.11` checkpoint и
`ready=true`.

### 6.3 Возобновление

Один раз запустить:

```javascript
AKORT_alpha74Gate5ResumeReplay()
```

Проверить:

```text
release            = 4.0.0-alpha.7.4.12
stateSchemaVersion = 4.0-alpha74-gate5-state-10
status             = RUNNING
recovery.mode      = DURABLE_ADAPTIVE_WINDOW_RESUME
triggerCount       = 1
```

После этого вручную запускать только:

```javascript
AKORT_alpha74Gate5Status()
```

`AKORT_alpha74Gate5Start()` запрещён для этого перехода: он создаст новый
full acceptance execution вместо продолжения сохранённого replay.
