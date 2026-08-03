# Alpha.7.4.29 — commit, clasp push и продолжение Gate 6

## Цель release

`.29` сохраняет все принятые Gate 5 расчёты и схемы. Release:

- позволяет повторному `Gate6Stop` найти reversal operation через
  `stoppedFromPhase=RUN_REVERSAL` и подтвердить `stopRequested=true`;
- продолжает RAW reversal с первой ещё не записанной observation;
- обрабатывает Weekly, Monthly и Industry Publish полными logical series
  порциями 25/25/10;
- учитывает в watchdog оба operation handler state, RAW reversal,
  input-artifact chunks и все aggregate cursors;
- выполняет до 40 реально продвигающихся checkpoints за один
  bounded worker, но останавливается при реальном отсутствии прогресса;
- сохраняет atomic limits, exact read-back, lost-response recovery и
  third-state fail-closed.

## 1. Локальная проверка

В Terminal из корня `akort-dwh-4-alpha74`:

```bash
npm test
git diff --check
clasp status --json
git status --short
```

Обязательные условия:

- все tests завершились без `FAIL`;
- `git diff --check` не вывел ошибок;
- `filesToPush` содержит ровно Apps Script source и manifest;
- `12_Alpha6Tests.js.backup-*` находится только в `untrackedFiles`.
  `clasp status` называет так игнорируемые файлы; они не загружаются.

## 2. Commit

Рекомендуемый commit title:

```text
fix(alpha74): recover and accelerate Gate 6 durable updates
```

Рекомендуемый commit body:

```text
- re-arm stopped Gate 6 operations through stoppedFromPhase
- track RAW reversal and source/RAW Publish durable progress
- track aggregate artifact persistence and every bounded cursor
- keep all 12 source templates and RAW_INDUSTRY on the shared update path
- exclude local backup fixtures from git and clasp uploads
- make the DEV deploy script run tests and validate its upload set
- add regression coverage for stopped recovery and progress draining
```

Команды:

```bash
git add -A
git diff --cached --check
git diff --cached --stat
git commit -m "fix(alpha74): recover and accelerate Gate 6 durable updates" \
  -m "Re-arm stopped Gate 6 operations, drain RAW/Publish/aggregate durable cursors, preserve all template and Industry update paths, and exclude local backup fixtures."
```

`.clasp.json` и `src/99_LocalConfig.js` игнорируются Git и в commit не попадают.

## 3. Clasp push

После успешного commit:

```bash
npm test
clasp status
clasp push
```

Не использовать `--force`. После push не запускать `Gate6Start` и
не менять RAW, Publish, `RAW_REVERSAL_LOG` и operation tables вручную.

## 4. Apps Script: exact recovery текущего Gate 6

Каждую функцию запускать отдельно и проверять `ok=true`.

### Шаг 1. Повторный safe Stop уже на `.29`

```text
AKORT_alpha74Gate6Stop()
```

Ожидается:

- `ok=true`;
- `operationId=OP_RAW_REVERSAL_V4_20260802T191111384Z_3683C13EE282`;
- `operationStopRequested=true`;
- Gate 6 остался `STOPPED`, trigger удалён;
- regular и user pipelines выключены.

Если вернулся `ALPHA74_GATE6_OPERATION_STOP_NOT_CONFIRMED`, подождать
30–60 секунд и повторить только Stop. Resume не выполнять.

### Шаг 2. Установка runtime settings

```text
AKORT_alpha74Install()
```

Ожидается `ok=true` и release `4.0.0-alpha.7.4.29`. Install обновит
bounded settings; вручную `SYSTEM_SETTINGS` не редактировать.

### Шаг 3. Проверки без возобновления Gate 6

```text
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Должно остаться:

- внешний release/version status — `.29` / acceptance `-11`;
- state до Resume — исходный `.26 / STOPPED / stoppedFromPhase=RUN_REVERSAL`;
- `triggerCount=0`;
- `PUBLISH_ENGINE_ENABLED=TRUE`;
- `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

Если любая проверка вернула `ok=false`, Resume не запускать.

### Шаг 4. Один Resume

```text
AKORT_alpha74Gate6Resume()
```

Ожидается:

- `release=4.0.0-alpha.7.4.29`;
- `status=RUNNING`, `phase=RUN_REVERSAL`;
- `recovery.mode=DURABLE_RAW_REVERSAL_CHUNK_RECOVERY`;
- `preservedPartialReversalRows=8` и `remainingReversalRows=42`, либо их
  фактические exact значения;
- `aggregatePipelineStarted=false`;
- `triggerCount=1`.

Resume не повторять.

### Шаг 5. Мониторинг

Раз в 1–2 минуты запускать только:

```text
AKORT_alpha74Gate6Status()
```

Нормальная цепочка:

```text
RUN_REVERSAL
-> POST_ROLLBACK_SCAN
-> ENQUEUE_RESTORE
-> RUN_RESTORE
-> FINAL_SCAN
-> FINAL_VALIDATION
-> SAVE_EVIDENCE
-> SUCCESS
```

После `SUCCESS` regular aggregate pipeline остаётся `TRUE`, а user pipeline —
`FALSE` до Gate 7.

## 5. Industry и все файловые шаблоны

Все 12 existing source profiles проходят один путь:
`SOURCE_FILE_LOAD_V4 -> RAW -> durable Publish -> aggregates`.

Industry проходит:
`INDUSTRY_INPUT -> RAW_LOAD_V4 / RAW_INDUSTRY -> durable PUBLISH_INDUSTRY`.

До Gate 6 `SUCCESS` не запускать Industry install/submit и другие загрузки.
После `SUCCESS` можно без записи RAW/Publish проверить форму:

```text
AKORT_alpha74IndustryInputInstall()
AKORT_alpha74IndustryInputValidate()
AKORT_alpha74IndustryInputStatus()
```

`AKORT_alpha74IndustryInputSubmit()` остаётся заблокирован до Gate 7,
потому что `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

## Запрещённые действия

- новый `AKORT_alpha74Gate6Start()`;
- повторный Resume;
- ручное включение user pipeline;
- ручное редактирование RAW, Publish, operation queue, stage и logs;
- ручное удаление recovery-копий до terminal `SUCCESS`.
