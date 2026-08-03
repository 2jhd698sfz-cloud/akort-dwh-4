# Alpha.7.4 — Implementation Gates

## Gate 0 — Organizational reset

- [x] Accepted base определена: `52590c8...`.
- [x] Новая ветка не наследует candidate-r3.
- [x] Integration map подготовлена.
- [x] Final contract подготовлен.
- [x] Старый candidate-r3 выведен из активного контура и сохранён во внутреннем архиве.
- [x] Активный комплект Alpha.7.4 создан во внутреннем рабочем пространстве.
- [x] Локальная Git-ветка и документационный commit созданы.
- [x] Публичный комплект очищен от внутренних URL и идентификаторов ресурсов.

## Gate 1 — Pre-code

- [x] Проверено отсутствие runtime-кода withdrawn candidates.
- [x] Устранена или административно закрыта stale `RUNNING` операция.
- [x] Подтверждена canonical Config resource map.
- [x] Зафиксирован operation schema migration `4.0-operation-2`.
- [x] Утверждён `AGGREGATE_STAGE` schema.
- [x] Определены atomic request limits и fail-closed behavior.
- [x] Получен GO на coding.

## Gate 2 — Pure/static implementation

- [x] Operation Engine расширен aggregate phases.
- [x] Alpha.6 impact подключён как authoritative input.
- [x] Alpha.7.3 planner интегрирован.
- [x] Alpha.7.2 calculator интегрирован.
- [x] Durable staging реализован.
- [x] Logical-series publish adapter реализован.
- [x] Physical row identity отсутствует.
- [x] Separate dispatcher/queue отсутствует.
- [x] Unit/static tests проходят.

## Gate 3 — Isolated read-only

- [x] Contract scan 61 636 rows.
- [x] Aggregate logical-key index.
- [x] Snapshot/fingerprint checks.
- [x] Parameterless DEV acceptance harness.
- [x] Machine-readable evidence contract.
- [x] New period plan.
- [x] Revision plan.
- [x] Reversal plan.
- [x] No future periods.
- [x] No physical writes.

Gate закрыт результатом `AKORT_alpha74Gate3Acceptance()` в DEV
27 июля 2026 года. Все три сценария и шесть weekly/monthly fixture runs
завершены успешно; before/after data-plane fingerprint совпал.

## Gate 4 — Isolated physical/fault

- [x] INSERT/UPDATE/DELETE/NOOP.
- [x] Atomic affected-set publication.
- [x] Lost-response recovery.
- [x] Timeout before/after every long phase.
- [x] Third-state fail-closed.
- [x] Unrelated rows unchanged.
- [x] Latest correctness.
- [x] Standard logical reversal.

Gate закрыт результатом `AKORT_alpha74Gate4Acceptance()` в DEV
27 июля 2026 года. Все нормативные scenarios и семь timeout phases получили
PASS; DataLens-connected Publish осталась неизменной.

## Gate 5 — Full reconciliation/performance

- [x] Full historical build.
- [x] Sequential replay.
- [x] Exact full-vs-incremental reconciliation.
- [x] Baseline parity.
- [x] Maximum-volume/quota acceptance.
- [x] No manual continuation.

Локальный Gate 5 trigger-driven harness и regression suite подготовлены.
После DEV timeout-loop `FULL_BUILD / MONTHLY` в `4.0.0-alpha.7.4.2`
релиз `7.4.3` добавил write cursor, но DEV code review обнаружил повторный
полный расчёт payload перед каждым chunk. В `4.0.0-alpha.7.4.4` payload
каждой стадии материализуется один раз в isolated sheet, а target заполняется
bounded cursor-copy. Остановленные execution сохраняются для диагностики;
следующий DEV execution завершил full build, но выявил отсутствие canonical
index expansion в aggregate replay. Release `7.4.6`
переиспользует production expansion и создаёт `state-4` replay-only recovery,
сохраняя completed full build. Этот recovery был остановлен на безопасной
границе aggregate replay из-за повторного расчёта batch при каждом
series-publication retry. Legacy worker затем перезаписал первоначальный
`STOPPED` как triggerless `RUNNING` после частичной публикации 64 из 105
серий. Release `7.4.8` fail-closed распознаёт только этот точный orphaned
checkpoint, переигрывает незавершённый диапазон от combo cursor 150,
материализует каждый новый batch один раз и продолжает тот же replay workbook
через `AKORT_alpha74Gate5ResumeReplay()`. Resume дошёл до cursor 175 и
обнаружил 517 exact physical duplicates в 64 affected series после uncertain
atomic response. Release `7.4.9` сохраняет cached batch 875 rows / 105 series,
атомарно схлопывает только канонически идентичные дубли, проверяет unique
read-back и fail-closed отклоняет conflicting duplicates. Первый repair
выявил расхождение durable Monday row key и фактически публикуемой Sunday
date. Release `7.4.10` использует один publication-period identity,
восстанавливает terminal `.9 / state-7` checkpoint из того же cached
batch и повторно схлопывает exact duplicates без движения replay cursor.
DEV replay после восстановления подтвердил корректность, но два полных
29-column target reads на каждый series sub-batch дали неприемлемую скорость.
Release `7.4.11` переносит Alpha.6 bounded-scan pattern: читает только девять
identity columns, затем только affected physical ranges и appended tail.
Остановленный `.10 / state-8` checkpoint продолжается с точного durable
group/combo/series cursor без нового full build или replay workbook.
Release `7.4.12` добавляет adaptive publication windows до 128 series,
а `7.4.13` исправляет final resume allowlist. После завершения
второй group `.13` выявил hard-timeout до первого checkpoint
aggregate-item plan третьей group: 29 worker executions не изменили
`steps=312` и cursor 0. Release `7.4.14` материализует canonical item
inventory durable-чанками по 500 RAW rows, сохраняя source cursor
после каждого step. Текущий `.13 / state-11` checkpoint продолжает
group 2 / `AGGREGATES` / cursor 0 без повтора full build и groups 0–1.
В DEV `.14` дошёл до `SCAN_WEEKLY / source cursor 4500`, после чего три
worker executions снова завершились hard-timeout без изменения `steps`:
category-level rows декабрьского блока расширялись до canonical dedup.
Release `7.4.15` дедуплицирует aggregate descriptors до production expansion
и продолжает тот же `.14 / state-12` item inventory с cursor 4500.
Execution `.15` после завершения всех 12 groups подтвердил RAW, aggregate,
quota и live-unchanged acceptance, но получил `exact=false` на финальном
digest из-за legacy aggregate IDs, Sheets date cells, latest-index coercion и
физического порядка строк. Release `7.4.16` исправляет эти контракты и
повторно использует готовые full/replay artifacts через
`AKORT_alpha74Gate5RecoverReconciliation()`. Новый full build и replay groups
не запускаются.
Recovery `.16` выровнял baseline/live/full, но replay сохранил 32 886
представлений `period_start` и 693 date-derived `aggregate_id`. Release
`7.4.17` использует full build как authoritative reference через
`AKORT_alpha74Gate5RecoverCanonicalPeriods()`, исправляет только сохранённый
replay с durable cursor и повторяет replay latest/digest/final reconciliation.

Gate 5 закрыт 2 августа 2026 года execution
`A74_GATE5_020B82D95A2DCC39C17D`. Baseline, live snapshot, full build и
sequential replay содержат по 61 636 строк и 29 колонок с одинаковым
`ROW_MULTISET_V1` digest
`0b65a3962571597c17506bdd13796da44a3597a61c2a9bf56085775251202dee`.
Evidence: `ALPHA74_GATE5_ACCEPTANCE_A74_GATE5_020B82D95A2DCC39C17D.json`,
SHA-256 `5a0ad8da2eb690f6289be2219c1f1e4a58d281d13ba866281d64363ec7023f41`.
DEV Publish в Gate 5 не изменялась; regular pipeline остался выключенным.

## Gate 6 — Authoritative DEV

- [x] Fail-closed Gate 6 harness и static regression suite реализованы.
- [ ] Immutable backup.
- [ ] Authoritative DEV canary.
- [ ] Read-back and reconciliation PASS.
- [ ] Regular aggregate pipeline enabled.
- [ ] Несколько регулярных DEV cycles без intervention.
- [ ] Recovery/rollback protocol проверен.

Release `4.0.0-alpha.7.4.29` готов к точному DEV-продолжению Gate 6. Harness
создаёт DWH/Publish recovery copies, выполняет canary из нового weekly/monthly
файла через `SOURCE_FILE_LOAD_V4`, штатный `RAW_REVERSAL_V4` и повторную
source-file загрузку для восстановления. Acceptance требует фактического
изменения `PUBLISH_PRICE_AGGREGATES` и сравнивает все четыре Publish-листа.
`RAW_INDUSTRY` не используется как canary, потому что не входит в расчёт
ценовых агрегатов. Обычные пользовательские загрузки до Gate 7 отдельно
заблокированы. Нормативный runbook: `GATE6_AUTHORITATIVE_DEV_CANARY.md`.
Hotfix `.19` устраняет обнаруженный до Start parser blocker `10 шт` /
`10 шт.` без изменения справочников или canary-файла.
Hotfix `.20` заменяет недоступную межмодульную ссылку `AKORT_V300.HEADERS` на
явный `AKORT.IncrementalPublish.PublishHeaders` и разрешает Resume только для
точного `.19 / BASELINE_SCAN` incident до любых scan chunks, operations и
live writes. Существующие recovery-копии переиспользуются.
После Resume canary operation завершила RAW и ordinary price Publish, но
остановилась до aggregate materialization из-за отсутствующего operational
runtime context. Hotfix `.21` подключает принятый Alpha.6 calculation path за
Alpha.7.4 stage/atomic boundary, публикует большие affected sets durable
пакетами целых logical series и разрешает только exact `.20` checkpoint
recovery через `AKORT_alpha74Gate6RecoverRuntimeContext()`. Повторный Start,
RAW commit и ordinary price Publish запрещены.
Первый вызов recovery на `.21` безопасно остановился до мутаций, поскольку
`AKORT.Config` вернул JSON-настройку уже типизированным объектом, а recovery
попытался разобрать её повторно. `.22` принимает объект или JSON-строку,
сохраняя остальной exact allowlist без изменений.
После recovery `.22` canary завершила 392 из 392 aggregate calculations, но
монолитная `STAGING_AGGREGATE_ROWS` не имела durable cursor и повторяла один
и тот же полный проход. `.23` вводит обязательные bounded cursors для
materialization, stage validation/status, logical-series publication, latest,
reconciliation и finalization. Точный остановленный `.22` checkpoint
продолжается обычным `AKORT_alpha74Gate6Resume()` с сохранением RAW, ordinary
price Publish, materialization и рассчитанных stage rows. Нормативный runbook:
`GATE6_BOUNDED_AGGREGATE_PHASES_HOTFIX.md`.

После подтверждённого `.26` partial RAW rollback `.27` ввела exact-once
reversal chunks. `.28` устраняет системную причину многочасового выполнения:
381 affected aggregate combinations больше не делятся на окна по 4 с новым
61 636-row scan на каждом окне. Source snapshot и target index теперь
переиспользуются внутри worker invocation, materialization идёт bounded
пачками по 250, а один trigger выполняет несколько durable resume steps.
Обычный Weekly/Monthly/Industry `UPDATE_PUBLISH` также переведён на durable
порции полных logical series (25/25/10). Frozen atomic limits, read-back,
lost-response recovery и third-state fail-closed сохранены. Инструкция:
`GATE6_FAST_INCREMENTAL_UPDATE_HOTFIX.md`.

`.29` закрывает два барьера операционной готовности `.28`:
повторный Stop находит active operation через `stoppedFromPhase`, а
progress watchdog учит `reversalWork`, Publish work обоих handler-типов,
artifact persistence и все aggregate cursors. Поэтому bounded steps Weekly,
Monthly, Industry и aggregates выполняются последовательно в одном
worker budget, пока есть реальный durable progress. Операционный runbook:
`ALPHA74_29_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`.
Первый `.23` Resume корректно отказался продолжать, потому что старый `.22`
успел записать `STAGED` для всех 392 строк, но потерял ответ до сохранения
operation checkpoint. `.24` принимает это exact after-state только при нулевых
publish intents, пустых target fingerprints/verified-at и полной проверке
plan scope, 29-column payload, logical keys и row fingerprints. Физическая
aggregate publication ещё не началась; RAW, ordinary price Publish,
materialization и calculation не повторяются. Нормативный runbook:
`GATE6_STAGED_AFTER_STATE_RECOVERY_HOTFIX.md`.
Первый bounded publication batch после `.24` физически записался, но
read-back обнаружил календарное расхождение: при `period_start=2026-07-01`
monthly `period_label` стал `2026-06-01`, потому что старый writer извлёк
месяц из UTC-сериализации московской даты. `.25` канонизирует label и
fingerprint по `period_start`, отдельно детектирует physical mismatch и
разрешает только exact recovery текущего `.24 / FAILED_REQUIRES_REVIEW /
UPDATING_AGGREGATES` checkpoint. Исправляется первая пачка из 32 серий;
RAW, ordinary price Publish, materialization, calculation и staging не
повторяются. Нормативный runbook:
`GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md`.
Recovery `.25` остановилась до любых мутаций на неверной private-ссылке
`readCalculatedRows_`. `.26` вызывает принятый
`DefaultAdapter.readCalculatedRows`, сохраняет exact `.24` source-state и
добавляет в mandatory test chain проверку всех unresolved private
Apps Script calls.

После успешного canary и `postCanary` scan `.26` штатный `RAW_REVERSAL_V4`
остался в монолитном `COMMIT_RAW`. Read-only проверка DWH доказала, что
aggregate pipeline ещё не запускался, а в `RAW_REVERSAL_LOG` физически
сохранены только 8 из 50 observations без operation checkpoint. `.27`
переводит RAW reversal на bounded exact-once пачки по 10 observations,
использует successful reversal log IDs как durable cursor и разрешает обычный
`AKORT_alpha74Gate6Resume()` только для точного остановленного `.26` incident.
Recovery начинает с первой незавершённой observation; canary, принятые восемь
строк и `postCanary` Publish не повторяются. Нормативная инструкция:
`GATE6_DURABLE_RAW_REVERSAL_HOTFIX.md`.

## Gate 7 — Acceptance

- [ ] Independent final review.
- [ ] Нет blocker/critical/major.
- [x] Release manifest и sourceFiles актуальны.
- [x] README/package/runtime version синхронизированы.
- [x] Machine-readable evidence сохранены.
- [ ] Accepted commit/tag созданы.
- [ ] Alpha.7.4 = `ACCEPTED_AND_CLOSED`.
