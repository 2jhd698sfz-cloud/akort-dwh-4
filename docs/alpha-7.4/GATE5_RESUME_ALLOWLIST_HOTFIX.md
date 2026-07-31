# Alpha.7.4 Gate 5 durable resume allowlist hotfix

## 1. Incident

Release `4.0.0-alpha.7.4.12` корректно классифицировал вручную остановленный
`.11 / state-9` checkpoint как допустимую adaptive-window recovery boundary,
но финальный schema/release allowlist в `assertDurableResumeSource_` не
содержал `state-9` и release `.11`.

DEV результат:

```text
code               = ALPHA74_GATE5_DURABLE_RESUME_STATE_SCHEMA_INVALID
source release     = 4.0.0-alpha.7.4.11
source state       = 4.0-alpha74-gate5-state-9
status             = STOPPED
phase              = STOPPED
triggerCount       = 0
replay group       = 1
combination cursor = 300 / 369
series cursor      = 256 / 291
```

Ошибка возникла до создания нового execution, очистки stop request, установки
trigger или изменения replay workbook. Все артефакты и checkpoint сохранены.

## 2. Исправление

Release `4.0.0-alpha.7.4.13`:

- добавляет `state-9` и release `.11` в финальные durable resume allowlists;
- сохраняет поддержку `.12 / state-10` и текущего `.13 / state-11`;
- использует один и тот же allowlist helper в runtime и regression tests;
- не меняет adaptive publication algorithm и frozen atomic limits;
- продолжает тот же cached aggregate batch с series cursor 256.

Version:

```text
release          = 4.0.0-alpha.7.4.13
Gate 5 version   = 4.0-alpha74-gate5-acceptance-11
state schema     = 4.0-alpha74-gate5-state-11
evidence schema  = 4.0-alpha74-gate5-evidence-11
```

Recovery mode остаётся:

```text
DURABLE_ADAPTIVE_WINDOW_RESUME
```

## 3. Deployment

Повторный `Stop` не нужен: сохранённый checkpoint уже имеет
`STOPPED / STOPPED / STOPPED_MANUALLY`, а trigger отсутствует.

После commit, публикации и `clasp push`:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
```

После `Install` повторно установить:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Затем:

```javascript
AKORT_alpha74Gate5Status()
AKORT_alpha74Gate5ResumeReplay()
```

Ожидаемый resume:

```text
release            = 4.0.0-alpha.7.4.13
stateSchemaVersion = 4.0-alpha74-gate5-state-11
status             = RUNNING
recovery.mode      = DURABLE_ADAPTIVE_WINDOW_RESUME
triggerCount       = 1
```

`Start` и ручной `Worker` не запускать.
