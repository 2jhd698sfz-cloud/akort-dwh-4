# Alpha.7.4 — Gate 6 Authoritative DEV Canary

## Назначение

Gate 6 впервые проверяет Alpha.7.4 на рабочей DEV-инфраструктуре, к которой
подключён DataLens. Это не изолированный тест: новый реальный weekly/monthly
файл проходит через штатные `SOURCE_FILE_LOAD_V4`, `PUBLISH_IMPACT`, все семь
aggregate phases и физическую публикацию в рабочую DEV Publish.

`RAW_INDUSTRY` не используется как canary: по замороженному контракту
Alpha.7.4 эти строки не являются входом расчёта ценовых агрегатов. Поэтому
форма `INDUSTRY_INPUT` не могла бы доказать обновление
`PUBLISH_PRICE_AGGREGATES`.

Gate 6 не открывает пользовательскую Beta 2. До Gate 7 обычные пользовательские
загрузки остаются fail-closed заблокированными настройкой
`PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

## Предусловия

- Gate 5 имеет terminal `SUCCESS / SUCCESS` и evidence
  `4.0-alpha74-gate5-evidence-15`;
- `PUBLISH_ENGINE_ENABLED=TRUE`;
- `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`;
- выбран один доступный в Google Drive новый weekly/monthly исходный файл;
- содержимое файла ещё не имеет активной записи с тем же `source_hash` в
  `RAW_LOAD_REGISTRY`;
- файл даёт хотя бы одну нормализованную строку и не имеет blocking parser или
  mapping issues;
- во время Gate 6 никто не запускает другие загрузки и не редактирует DWH или
  Publish.

Canary может быть новым периодом или уточнением существующего периода. Важно,
чтобы это был реальный файл, который должен остаться в DEV после успешного
завершения Gate 6.

Текущий release `.29` сохраняет канонизацию завершающей пунктуации единиц
из `.19`.
Например, `10 шт` в источнике и `10 шт.` в `DIM_PRODUCTS` считаются одной
единицей. Это parser normalization: справочник и исходный файл вручную менять
не требуется.

## Контрольный лист

`AKORT_alpha74Gate6Install()` создаёт в технической DWH лист
`GATE6_CANARY_INPUT`. Пользователь заполняет только жёлтые ячейки:

- `B4` — обязательный ID или ссылка на Google Drive файл;
- `B5` — необязательный `profile_id`;
- `B6` — необязательный год;
- `B7` — необязательный месяц;
- `B8` — необязательный номер недели;
- `B9` — необязательная дата публикации `YYYY-MM-DD`.

`AKORT_alpha74Gate6Validate()` выполняет read-only preview, распознаёт профиль,
проверяет целевую RAW-таблицу, mappings, количество строк и duplicate-load
защиту. `Start` повторяет эту проверку и не доверяет устаревшему статусу формы.

## Что делает harness

1. Создаёт в canonical Releases folder две recovery-копии до любой live-записи:
   DWH и DataLens-connected DEV Publish.
2. Durable-чанками по 1 000 строк снимает order-independent
   `ROW_MULTISET_V1` digest четырёх Publish-листов:
   `PUBLISH_PRICES_WEEKLY`, `PUBLISH_PRICES_MONTHLY`, `PUBLISH_INDUSTRY` и
   `PUBLISH_PRICE_AGGREGATES`.
3. Включает regular aggregate pipeline. Общий пользовательский pipeline
   остаётся выключенным.
4. Выполняет canary через полный `SOURCE_FILE_LOAD_V4` и дополнительно сверяет,
   что фактический `source_hash` не изменился после preview.
5. Снимает read-back digest и требует фактического изменения
   `PUBLISH_PRICE_AGGREGATES`.
6. Выполняет штатный `RAW_REVERSAL_V4` для canary `load_id` и требует точного
   возврата всех четырёх Publish-листов к исходным digest.
7. Повторно применяет тот же файл новым `SOURCE_FILE_LOAD_V4` и требует точного
   совпадения с принятым post-canary состоянием.
8. Повторяет aggregate contract scan: 29 колонок, без logical duplicates,
   latest failures и future rows.
9. Сохраняет JSON evidence в canonical Test Results folder.

Таким образом один запуск подтверждает три regular DEV cycles без ручного
`Continue`: source-file canary, rollback и source-file restore. Новые данные
остаются загруженными после SUCCESS.

## Fail-closed

При non-retryable ошибке либо трёх подряд retryable ошибках harness:

- удаляет Gate 6 trigger;
- выключает `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED`;
- оставляет `PUBLISH_USER_PIPELINE_ENABLED=FALSE`;
- сохраняет checkpoint, operation IDs и recovery-копии;
- возвращает terminal `FAILED`.

`AKORT_alpha74Gate6Stop()` также запрашивает safe stop активной operation,
выключает regular и user flags и сохраняет артефакты. Автоматическое
восстановление из физической копии не выполняется: штатный rollback —
`RAW_REVERSAL_V4`, а recovery-копии являются последним контролируемым якорем.

Для точного terminal `.19` incident
`A74_GATE6_7F437567A3ABBFBE94F1 / FAILED / BASELINE_SCAN /
AKORT_V300 is not defined` release `.20` разрешает отдельное fail-closed
продолжение через обычный `AKORT_alpha74Gate6Resume()`. Оно допускается только
если digest chunks и scanned rows равны нулю, operation/load IDs пусты,
source hash не изменился и обе recovery-копии доступны. Resume сохраняет
execution ID и копии, переводит checkpoint обратно в `BASELINE_SCAN` и не
включает regular pipeline до завершения baseline.

Для следующего точного `.20` incident того же execution, когда baseline уже
завершён, canary operation успела выполнить RAW commit, ordinary price Publish
и aggregate impact, но остановилась на `MATERIALIZING_AGGREGATE_INPUTS` с
`AGGREGATE_RUNTIME_CONTEXT_MISSING`, обычный Resume запрещён. Release `.21`
использует отдельную функцию `AKORT_alpha74Gate6RecoverRuntimeContext()`:
устанавливает принятый Alpha.6 parity adapter за Alpha.7.4 atomic boundary и
продолжает существующую operation с сохранённой фазы. Подробный exact
allowlist и runbook находятся в
`GATE6_RUNTIME_CONTEXT_RECOVERY_HOTFIX.md`.

## Установка и запуск

После публикации commit и `clasp push`:

1. Выполнить `AKORT_alpha74Install()`.
2. В `SYSTEM_SETTINGS` установить
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`. Убедиться, что
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE` и
   `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.
3. Выполнить последовательно:
   `AKORT_alpha74SmokeTest()`,
   `AKORT_alpha74ReadOnlyContractScan()` и
   `AKORT_alpha74Gate5Status()`.
4. Выполнить `AKORT_alpha74Gate6Install()`.
5. Открыть `АКОРТ - DWH 4.0 DEV`, лист `GATE6_CANARY_INPUT`, и заполнить `B4`.
   Параметры `B5:B9` заполнять только если автоматическое распознавание требует
   подсказки.
6. Выполнить `AKORT_alpha74Gate6Validate()`. Требуемый результат:
   `status=SUCCESS`, target `RAW_PRICES_WEEKLY` или `RAW_PRICES_MONTHLY`,
   `normalizedRowCount > 0`.
7. Выполнить `AKORT_alpha74Gate6Status()` и проверить `readyToStart=true`.
8. Один раз выполнить `AKORT_alpha74Gate6Start()`.
9. Далее запускать только `AKORT_alpha74Gate6Status()`. Worker продолжает
   процесс автоматически; другие функции загрузки и продолжения не запускать.

Если `.18` остановился на read-only Validate с
`ALPHA74_GATE6_SOURCE_BLOCKING_ISSUES / UNIT_NOT_RECOGNIZED` для `10 шт` и
`10 шт.`, после установки `.19` повторить `Install`, smoke test, contract scan
и `Gate6Validate`. Новый canary-файл, recovery или Resume не нужны: операция
Gate 6 ещё не была запущена и live-данные не изменялись.

Если `.19` завершился точным baseline-header incident после Start, после
установки `.20` не выполнять `Install`, `Validate` или `Start` повторно.
Запустить smoke test, contract scan, проверить terminal status и один раз
выполнить `AKORT_alpha74Gate6Resume()`. Затем использовать только Status.

Если `.20` завершился точным runtime-context incident после RAW/price Publish,
после установки текущего `.22` выполнить `AKORT_alpha74Install()`, smoke test, contract
scan и Status. Не выполнять Gate6 Install, Validate, Start или обычный Resume.
Один раз выполнить `AKORT_alpha74Gate6RecoverRuntimeContext()`, затем
использовать только `AKORT_alpha74Gate6Status()`.

Если первый вызов этой функции на `.21` вернул
`ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID / [object Object]`, никаких
operation/data-plane изменений не произошло. Установить `.22` и повторить
только exact recovery-функцию по указанной последовательности.

Если `.22` был вручную остановлен на `RUN_CANARY`, а canary operation уже
завершила все aggregate calculations и находится на
`STAGING_AGGREGATE_ROWS`, установить `.23`, выполнить Install, вернуть только
`PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE` при выключенных regular/user flags,
затем выполнить smoke test, contract scan и Status и один раз вызвать обычный
`AKORT_alpha74Gate6Resume()`. `.23` проверяет exact pre-staging boundary и
продолжает сохранённую operation bounded-порциями; `Gate6Start`, повторная
Validate и `Gate6RecoverRuntimeContext` запрещены. Подробности:
`GATE6_BOUNDED_AGGREGATE_PHASES_HOTFIX.md`.

Если первый Resume на `.23` вернул
`ALPHA74_GATE6_MONOLITHIC_STAGE_RECOVERY_BOUNDARY_INVALID` и показал
`actualCalculatedRows=392`, `publishIntents=0`, `statuses=[STAGED]`, это
точный lost-response after-state старого `.22`, а не начало физической
aggregate publication. Установить `.24`, выполнить общий Install, включить
только aggregate execution flag, выполнить smoke test, contract scan и Status,
затем один раз обычный `AKORT_alpha74Gate6Resume()`. Не выполнять Gate6 Start,
Install, Validate или runtime-context recovery. Ожидаемый mode:
`BOUNDED_STAGE_AFTER_STATE_RECOVERY`. Подробности:
`GATE6_STAGED_AFTER_STATE_RECOVERY_HOTFIX.md`.

Если `.24` после этого завершилась `FAILED / RUN_CANARY`, а canary operation
имеет `FAILED_REQUIRES_REVIEW / UPDATING_AGGREGATES /
AGGREGATE_PUBLISH_READBACK_MISMATCH`, не выполнять обычный Resume. Это
проверенный first-batch incident: atomic write состоялся, но monthly
`period_label` 1 июля был записан как 1 июня из-за UTC-сериализации. Установить
`.26`, выполнить общий Install, оставить только aggregate execution flag,
выполнить smoke test, contract scan и Status, затем один раз вызвать
`AKORT_alpha74Gate6RecoverMonthlyPeriodLabel()`. Ожидаемый mode:
`MONTHLY_PERIOD_LABEL_READBACK_RECOVERY`. После этого использовать только
Status. Подробности: `GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md`.
`.25` завершилась до мутаций на неверной private-ссылке;
`.26` использует реальный DefaultAdapter и тот же exact `.24` checkpoint.

Если после завершения canary и `postCanary` scan `.26` остаётся в
`RUN_REVERSAL`, а reversal operation — в `COMMIT_RAW`, сначала выполнить
`AKORT_alpha74Gate6Stop()` и дождаться `STOPPED / RUN_REVERSAL / triggerCount=0`.
Не редактировать частичные записи `RAW_REVERSAL_LOG`. Затем установить `.29`,
выполнить общий Install, оставить только aggregate execution flag, выполнить
smoke test, contract scan и Status и один раз вызвать обычный
`AKORT_alpha74Gate6Resume()`. Exact recovery принимает уже записанные
observations и продолжает rollback bounded-пачками по 10 строк по durable
cursor из `RAW_REVERSAL_LOG`; aggregate pipeline до этого incident не
начинался. Ожидаемый mode: `DURABLE_RAW_REVERSAL_CHUNK_RECOVERY`.
После RAW recovery `.29` выполняет Weekly/Monthly/Industry Publish durable
порциями полных серий и aggregate materialization двумя крупными bounded
steps вместо примерно 96 малых проходов с повторным target scan. Подробности:
`GATE6_DURABLE_RAW_REVERSAL_HOTFIX.md` и
`GATE6_FAST_INCREMENTAL_UPDATE_HOTFIX.md`.
Для текущего уже остановленного state после `clasp push` нужно ещё раз
выполнить `.29` `AKORT_alpha74Gate6Stop()` и убедиться, что ответ
содержит `operationStopRequested=true`. Полная последовательность:
`ALPHA74_29_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`.

Экстренная остановка: `AKORT_alpha74Gate6Stop()`. Она сохраняет исходную фазу,
operation IDs, digest cursors и recovery-копии. После проверки причины тот же
execution можно продолжить функцией `AKORT_alpha74Gate6Resume()`; новые копии и
повторный Start при этом не создаются. `Resume` разрешён только для явно
остановленного, совместимого checkpoint и повторно проверяет source hash.

## Acceptance contract

Gate 6 закрывается только при:

- `status=SUCCESS`, `phase=SUCCESS`;
- трёх operations со статусом `SUCCESS` и полным набором семи aggregate phases;
- `PUBLISH_PRICE_AGGREGATES` изменился после canary;
- `rollbackExact=true`;
- `restoreExact=true`;
- успешном итоговом aggregate contract scan;
- наличии обеих recovery-копий и JSON evidence;
- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=TRUE`;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

После PASS начинается Gate 7: independent final review, проверка evidence,
release package/commit/tag и только затем отдельное разрешение пользовательской
Beta 2.
