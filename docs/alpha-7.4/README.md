# АКОРТ 4.0 — Alpha.7.4 Integration Reset

## Статус

`GATE 5 ACCEPTED / GATE 6 ALPHA74.31 WEEKLY-ROLLBACK RECOVERY READY / USER PIPELINE PROHIBITED`

Дата фиксации: 3 августа 2026 года.

Активная GitHub-ветка: `codex/alpha-7.4-integration-reset`.

Принятая база:

- commit: `52590c8e036d49b9f76f87341b69881a916c851d`;
- tag: `v4.0.0-alpha.7.3-accepted`;
- Alpha.7.1–Alpha.7.3: `ACCEPTED_AND_CLOSED`.

## Назначение ветки

Ветка является единственной активной основой новой Alpha.7.4 после Architecture Reset от 23 июля 2026 года.

Она предназначена для интеграции расчёта и публикации `PUBLISH_PRICE_AGGREGATES` в существующий Operation/RAW/Publish pipeline Alpha.3–Alpha.6.

Ветка не наследует код withdrawn candidates Alpha.7.4.

## Нормативные материалы

- Системная модель 4.0.
- Roadmap и порядок создания релиза 4.0.
- Alpha.7.4 — Aggregate Integration Specification v4.0.
- Alpha.7.4 — Tests and Acceptance Matrix v4.0.
- Alpha.7.4 — Integration Handoff and Preconditions.
- Alpha.7.4 — Integration Runbook and Recovery Protocol.
- Alpha.7.4 — Error Retrospective, Risk Register and ADR.

Внутренние URL и идентификаторы ресурсов намеренно не публикуются. Контролируемые экземпляры нормативных материалов хранятся во внутреннем рабочем пространстве проекта.

При противоречии исторического текста и блока Architecture Reset действует Architecture Reset и документы версии 4.0.

## Документы этой ветки

- `INTEGRATION_MAP_ALPHA3_ALPHA6.md` — source-level карта повторного использования существующего кода.
- `FINAL_CONTRACT.md` — окончательный инженерный контракт реализации.
- `IMPLEMENTATION_GATES.md` — обязательные gates до принятия Alpha.7.4.
- `RUNTIME_CONTEXT_CONTRACT.md` — безопасный контракт authoritative definitions и snapshots без публичных resource IDs.
- `GATE3_ACCEPTANCE_HARNESS.md` — read-only acceptance harness, DEV entrypoints и evidence contract.
- `GATE4_ACCEPTANCE_HARNESS.md` — isolated physical/fault harness, feature-flag order и evidence contract.
- `GATE5_ACCEPTANCE_HARNESS.md` — full build, sequential replay, exact reconciliation, quota и automatic continuation contract.
- `GATE6_AUTHORITATIVE_DEV_CANARY.md` — recovery copies, live canary,
  standard reversal, deterministic restore, read-back и evidence contract.
- `GATE6_BOUNDED_AGGREGATE_PHASES_HOTFIX.md` — обязательный bounded-work
  контракт всех тяжёлых aggregate phases и exact продолжение остановленного
  `.22 / STAGING_AGGREGATE_ROWS` checkpoint без повторного расчёта.
- `GATE6_STAGED_AFTER_STATE_RECOVERY_HOTFIX.md` — exact recovery потерянного
  ответа `.22`, когда все 392 строки уже `STAGED`, но publish intent и
  физическая публикация ещё не начались.
- `GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md` — exact recovery первой
  32-series publication batch `.24`, где UTC-сериализация сместила monthly
  `period_label` на предыдущий месяц; исправление только этой пачки с
  продолжением того же operation checkpoint; `.26` исправляет runtime-ссылку
  `.25`, не дошедшую до мутаций.
- `GATE6_STATE_CAPACITY_RECOVERY_HOTFIX.md` — compaction вложенной recovery
  history, надёжное terminal fail-closed сохранение и exact продолжение
  остановленного `.29 / ROLLBACK_SCAN` без повторения canary и reversal.
- `GATE6_WEEKLY_ROLLBACK_PERIOD_RECOVERY_HOTFIX.md` — exact `.30` recovery
  196 weekly aggregate rows, ошибочно записанных на UTC-субботу вместо
  ISO-воскресенья, с bounded atomic repair и чистым перезапуском Gate 6.
- `ALPHA74_31_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md` — commit, `clasp push` и
  единственная разрешённая Apps Script последовательность для текущего
  `+196` rollback incident.
- `ALPHA74_30_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md` — commit, `clasp push` и
  обязательная последовательность Apps Script для текущего incident.
- `INDUSTRY_INPUT_FORM.md` — операторская форма для раздельного ввода периода
  и значения активных `RAW_INDUSTRY` серий через `RAW_LOAD_V4`.
- `GATE5_FULL_BUILD_CHUNKING_HOTFIX.md` — разбор timeout-loop
  `FULL_BUILD / MONTHLY`, durable cursor, размеры chunks и нормативный
  перезапуск Gate 5.
- `GATE5_CANONICAL_REPLAY_RECOVERY_HOTFIX.md` — root cause нулевых aggregate
  rows в sequential replay и восстановление с сохранением completed full
  build.
- `GATE5_DURABLE_AGGREGATE_BATCH_HOTFIX.md` — одноразовая materialization
  aggregate batch, bounded series publication и продолжение с сохранённого
  replay cursor.
- `GATE5_EXACT_DUPLICATE_RECOVERY_HOTFIX.md` — repair идентичных физических
  дублей после uncertain Sheets response с сохранением durable batch и
  fail-closed защитой от конфликтующих строк.
- `GATE5_PERIOD_IDENTITY_RECOVERY_HOTFIX.md` — единый period identity для
  durable stage и физической публикации, а также продолжение terminal
  `.9 / state-7` checkpoint без повторного расчёта.
- `GATE5_FAST_TARGET_SCAN_HOTFIX.md` — Alpha.6-style identity scan,
  affected-range read, appended-tail verification и продолжение
  `.10 / state-8` checkpoint без потери group/combo/series cursor.
- `GATE5_ADAPTIVE_PUBLICATION_WINDOW_HOTFIX.md` — adaptive окно до 128
  logical series, максимальный безопасный prefix под frozen atomic limits и
  продолжение `.11 / state-9` checkpoint без повторения completed work.
- `GATE5_RESUME_ALLOWLIST_HOTFIX.md` — исправление финального schema/release
  allowlist после fail-closed `.12` resume и продолжение сохранённой точки
  `.11 / state-9 / group 1 / combo 300 / series 256`.
- `GATE5_DURABLE_AGGREGATE_ITEM_PREPARATION_HOTFIX.md` — durable scan
  weekly/monthly RAW и reversal log по 500 rows, fingerprinted combination
  inventory и продолжение `.13 / state-11 / group 2 / AGGREGATES / cursor 0`.
- `GATE5_PRE_EXPANSION_DESCRIPTOR_DEDUP_HOTFIX.md` — дедупликация
  category-level affected rows до production dependency expansion и
  продолжение `.14 / state-12 / SCAN_WEEKLY / source cursor 4500` с тем же
  частично подготовленным item inventory.
- `GATE5_TERMINAL_RECONCILIATION_RECOVERY_HOTFIX.md` — восстановление
  terminal `.15 / state-13` с финальной сверки, канонические aggregate IDs и
  даты, корректный latest и order-independent row-multiset digest без повтора
  full build и 12 replay groups.
- `STATUS.json` — машиночитаемый статус ветки.

## Запрещённые решения

- отдельный aggregate dispatcher;
- отдельные `AGGREGATE_REFRESH_RUNS`, `AGGREGATE_REFRESH_QUEUE` и `AGGREGATE_REFRESH_BATCHES`;
- `physical_row_hint` как identity, checkpoint или основа rollback;
- отдельный reverse-mutation executor;
- ручное продолжение после штатного timeout;
- per-row чтение Google Sheets;
- регулярный full-sheet clear/rewrite;
- разделение одной logical series между физическими commits;
- `SUCCESS` до read-back и reconciliation;
- перенос full replay, performance или operational enablement в Alpha.7.5.

## Реализованный локальный контур

- Operation Engine `4.0-operation-2` с агрегатными фазами и bounded-phase checkpoint;
- `AGGREGATE_STAGE` с immutable input artifact, calculated rows и durable publish intent;
- authoritative `PUBLISH_IMPACT` → Alpha.7.3 planner → Alpha.7.2 calculator;
- полная замена затронутых логических серий без сохранения физических номеров строк;
- durable bounded atomic Sheets API batches, каждый из которых содержит
  только полные logical series;
- read-back, latest validation, lost-response recovery и third-state fail-closed;
- aggregate execution, regular pipeline и user pipeline flags `FALSE` по
  умолчанию;
- unit/static regression suite.

Для Gate 4 реализована отдельная физическая граница, которая работает только
при `execution=TRUE`, `regularPipeline=FALSE`, запрещает ID рабочей
DataLens-подключённой Publish и пишет только в созданный harness sandbox.
Добавлена единая канонизация `period_start` для ISO, Date и Google Sheets
serial read-back.

Gate 1 завершён: точный подтверждённый профиль из четырёх legacy DEV-операций закрыт через fail-closed cleanup, а audit trail сохранён. Независимая проверка подтвердила четыре `CANCELLED` queue rows, четыре новых step rows и отсутствие изменений RAW, Publish и aggregate rows.

Gate 3 закрыт 27 июля 2026 года. Authoritative read-only contract scan
подтвердил 61 636 строк без logical-key duplicates, latest failures и future
rows. DEV acceptance harness успешно выполнил `NEW_PERIOD`, `REVISION` и
`REVERSAL` для weekly и monthly contexts: шесть fixture runs, `0` data-plane
writes, неизменный target fingerprint и один JSON evidence file. На этом этапе
физические записи оставались запрещены до отдельной приёмки Gate 4.

Gate 4 закрыт 27 июля 2026 года на изолированной таблице canonical Test Files:
INSERT/UPDATE/DELETE/NOOP, lost-response recovery, latest, reversal, семь
timeout phases и third-state fail-closed получили PASS. Рабочая Publish не
изменилась, regular pipeline остался выключенным.

Для Gate 5 был подготовлен persistent trigger-driven harness. Он создаёт отдельные
baseline snapshot, live snapshot, full build и sequential replay workbooks,
воспроизводит accepted load/reversal order и сравнивает все четыре aggregate
targets по exact canonical digest. Ручной `Continue` не используется; quota и
transient retry выполняются автоматически.

Первый DEV execution `4.0.0-alpha.7.4.2` был остановлен после подтверждённого
timeout-loop на монолитной стадии `FULL_BUILD / MONTHLY`. DEV-проверка
`4.0.0-alpha.7.4.3` затем выявила повторный расчёт полного payload перед
каждым write-chunk. Нормативный `4.0.0-alpha.7.4.4` рассчитывает каждую
стадию один раз в isolated materialization и выполняет bounded cursor-copy;
`Start` и worker также fail-closed блокируют checkpoint другого релиза.
Execution `A74_GATE5_CDEFB6487105607FB35F` успешно завершил full build, но был
остановлен на третьей replay group: отдельная replay-реализация не
разворачивала пустой RAW `index_type` в canonical `wow/mom`, `yoy`,
`december`, поэтому aggregate calculator возвращал ноль строк. В
`4.0.0-alpha.7.4.6` replay использует production expansion напрямую,
нулевой cumulative aggregate result блокируется fail-closed, а
`AKORT_alpha74Gate5RestartReplay()` сохраняет baseline, live snapshot и
completed full build, создавая только новый replay workbook. Этот recovery
получил первоначальный ответ `STOPPED`, но уже начатый legacy worker затем
сохранил triggerless `RUNNING` на `group 0 / AGGREGATES / cursor 150` после
частичной публикации 64 из 105 серий. В `4.0.0-alpha.7.4.8` этот точный
orphaned checkpoint принимается fail-closed, незавершённый диапазон
детерминированно переигрывается от cursor 150, calculation batch один раз
материализуется в durable stage cache, а
`AKORT_alpha74Gate5ResumeReplay()` сохраняет тот же replay workbook. Gate 5
принимается только после terminal `SUCCESS`.

Resume execution `4.0.0-alpha.7.4.8` продолжил replay до cursor 175, но
остановился fail-closed на duplicate logical key. Read-only диагностика
isolated replay подтвердила 517 парных канонически идентичных дублей в 64
сериях и отсутствие конфликтующих строк. Release `4.0.0-alpha.7.4.9`
принудительно ремонтирует exact duplicates даже при совпадающем logical
fingerprint, проверяет unique read-back до движения cursor и сохраняет
materialized batch из 875 rows / 105 series. Конфликтующие duplicates
по-прежнему требуют ручного review. Текущий checkpoint возобновляется через
`AKORT_alpha74Gate5ResumeReplay()` без нового full build, price replay или
aggregate calculation.

Первый repair request в `4.0.0-alpha.7.4.9` физически выполнился, но
read-back корректно не передвинул cursor: durable stage использовал Monday
key (`2025-03-10`), тогда как сериализованный payload и фактическая запись
использовали Sunday (`2025-03-09`). Physical rows выросли с 3 640 до 3 652,
exact duplicates — с 517 до 529; conflicting duplicates по-прежнему равны
нулю. После шести transient retries worker завершился fail-closed:
`FAILED`, trigger удалён, cursor и cached batch сохранены. Release
`4.0.0-alpha.7.4.10` выводит publication identity из
сериализованного payload, нормализует новые stage records до одного period
key и принимает terminal `.9 / state-7` checkpoint с теми же 875 cached
rows. Recovery mode `DURABLE_PERIOD_IDENTITY_REPAIR_RESUME` продолжает
cursor 175 без повторного full build, price replay или aggregate calculation.

Release `4.0.0-alpha.7.4.11` устраняет следующий performance bottleneck:
каждый aggregate publication sub-batch больше не читает всю
`PUBLISH_PRICE_AGGREGATES` дважды по 29 колонок. По паттерну Alpha.6 сначала
выполняется bounded scan девяти series-identity columns, затем читаются
только affected physical ranges, а после atomic append — deterministic tail.
Lost-response, exact-duplicate и third-state fail-closed гарантии сохранены.
Вручную остановленный `.10 / state-8` replay продолжается через
`AKORT_alpha74Gate5ResumeReplay()` с recovery mode
`DURABLE_FAST_TARGET_SCAN_RESUME`, включая сохранение частичного series
cursor текущего materialized batch.

Release `4.0.0-alpha.7.4.12` устраняет оставшуюся линейную зависимость
identity scans от фиксированных окон по 32 series. Один target scan теперь
покрывает до 128 следующих logical series, после чего двоичный подбор
выбирает максимальный prefix под неизменные limits 5 000 rows / 100 000
cells / 500 requests. Cursor передвигается только после atomic write и
unique appended-tail read-back. Вручную остановленный `.11 / state-9`
checkpoint продолжается без нового full build, replay workbook или
aggregate calculation в режиме `DURABLE_ADAPTIVE_WINDOW_RESUME`.

Release `4.0.0-alpha.7.4.13` исправляет отдельный финальный allowlist,
который в `.12` отклонил уже корректно классифицированный `.11 / state-9`
checkpoint. Ошибка произошла до mutation и trigger creation. `.13`
продолжает тот же workbook с group 1, combo cursor 300 и series cursor 256;
adaptive publication и atomic limits не изменяются.

Release `4.0.0-alpha.7.4.14` устраняет hard-timeout в монолитной
подготовке aggregate replay items для третьей group. Weekly/monthly RAW
и reversal log сканируются по 500 rows с durable phase/cursor,
а canonical combinations сохраняются в `GATE5_AGGREGATE_ITEMS` до
расчёта и публикации. Остановленный `.13 / state-11` checkpoint
продолжается на group 2 / `AGGREGATES` / cursor 0 в режиме
`DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME`, не повторяя full build и
первые две replay groups.

Release `4.0.0-alpha.7.4.15` устраняет второй hard-timeout на WEEKLY chunk
`4500–5000`. В `.14` 500 category-level rows расширялись в зависимые периоды
до дедупликации, поэтому декабрьский блок создавал десятки тысяч временных
дубликатов. `.15` сначала сворачивает их по
`frequency/dataset/value_type/index_type/period`, затем вызывает тот же
production `v310ExpandAffectedTargets_()` и применяет тот же frozen frontier.
Остановленный `.14 / state-12` checkpoint продолжает существующий inventory
с `source cursor=4500`; full build, replay workbook и готовые группы не
повторяются.

Execution `.15` завершил full build, все 12 replay groups, latest и quota
acceptance, но финальная сверка завершилась с
`ALPHA74_GATE5_RECONCILIATION_FAILED`: `exact=false`, тогда как
`liveUnchanged`, `quotaAccepted`, `aggregateAccepted` и `rawAccepted` равны
`true`. Диагностика всех 61 636 logical rows подтвердила полное совпадение
аналитических значений и выявила только legacy aggregate ID, Sheets date,
latest-index и physical-order representation differences. Release
`4.0.0-alpha.7.4.16` исправляет эти четыре контракта и добавляет строго
ограниченный `AKORT_alpha74Gate5RecoverReconciliation()`. Он повторно
использует все четыре готовых артефакта, ремонтирует replay чанками,
пересчитывает latest для full/replay и повторяет только normalization, digest
и final reconciliation. Новый full build и повтор 12 загрузок запрещены.

Финальная сверка `.16` подтвердила одинаковый digest baseline, live snapshot и
full build, но сохранила replay-only расхождение. Read-only сопоставление всех
61 636 logical rows показало 32 886 отличий `period_start` и 693 производных
от даты отличий `aggregate_id`; аналитические поля совпали полностью. Release
`4.0.0-alpha.7.4.17` добавляет
`AKORT_alpha74Gate5RecoverCanonicalPeriods()`: full build становится
authoritative reference, строки full/replay сортируются по уникальному
логическому ключу, а `period_start` и `aggregate_id` копируются в replay
durable-чанками по 1 000 строк. Затем повторяются только replay latest,
row-multiset digest и final reconciliation.

Gate 5 закрыт 2 августа 2026 года. Execution
`A74_GATE5_020B82D95A2DCC39C17D` завершился `SUCCESS`; все четыре
артефакта содержат 61 636 строк по 29 колонок и имеют одинаковый
row-multiset digest. DEV Publish не изменялась.

Release `4.0.0-alpha.7.4.20` подготавливает Gate 6: две recovery-копии,
durable digest четырёх Publish-листов, новый weekly/monthly
`SOURCE_FILE_LOAD_V4`, штатный `RAW_REVERSAL_V4` и повторный
`SOURCE_FILE_LOAD_V4` для восстановления целевого состояния. Gate 6 требует,
чтобы canary изменил `PUBLISH_PRICE_AGGREGATES`. Gate 6 ещё не закрыт: нужен
DEV `SUCCESS` и evidence. Обычный
пользовательский Submit остаётся закрыт до Gate 7.

Первичная DEV-валидация на `.18` выявила только parser blocker для пары единиц
`10 шт` / `10 шт.` у категории «Яйца куриные, 10 шт.». В `.19` завершающая
пунктуация единиц канонизируется до сопоставления; исходный файл и
`DIM_PRODUCTS` не изменяются. Повторный запуск начинается с read-only Validate,
поскольку Gate 6 operation и live writes ещё не создавались.

Первый Start на `.19` создал recovery-копии, но fail-closed завершился в
`BASELINE_SCAN` до первого digest chunk: Gate 6 обращался к внутренней
`AKORT_V300.HEADERS`, недоступной за границей модуля Incremental Publish.
В `.20` Publish headers экспортируются через
`AKORT.IncrementalPublish.PublishHeaders`. Точный incident
`A74_GATE6_7F437567A3ABBFBE94F1` можно продолжить функцией Resume с тем же
execution ID, source hash и recovery-копиями; новый Start запрещён.

После baseline recovery canary operation завершила RAW commit, обычный weekly
Publish и подготовку aggregate impact, но fail-closed остановилась до
aggregate materialization: Gate 3 проверял runtime context только в памяти и
не сохранил operational `PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON`. В `.21`
принятый Alpha.6 calculation path, доказанный Gate 5 exact parity, подключён
через узкий `ALPHA6_ACCEPTED_PARITY` adapter. Результаты проходят канонический
Alpha.7.4 stage и публикуются bounded atomic пакетами целых логических рядов с
durable lost-response recovery. Функция
`AKORT_alpha74Gate6RecoverRuntimeContext()` допускает только точный `.20`
incident, переиспользует существующие recovery-копии и продолжает ту же
operation с `MATERIALIZING_AGGREGATE_INPUTS`, не повторяя RAW и ordinary price
Publish. Нормативная инструкция:
`GATE6_RUNTIME_CONTEXT_RECOVERY_HOTFIX.md`.

Первый вызов exact recovery на `.21` завершился до любых мутаций с
`ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID`: слой `AKORT.Config` уже
преобразовал `{}` из `SYSTEM_SETTINGS` в объект, а recovery повторно вызвал
`JSON.parse(String(value))`. `.22` нормализует как типизированный объект, так и
JSON-строку. Исходный `.20` checkpoint и recovery-копии сохранены; инструкция:
`GATE6_RUNTIME_CONTEXT_TYPED_SETTING_HOTFIX.md`.

После `.22` canary рассчитала все `392 / 392` aggregate rows, но была
остановлена на старой монолитной `STAGING_AGGREGATE_ROWS`. `.23` ввела
durable cursors для каждой тяжёлой aggregate phase. Первый Resume обнаружил
lost-response after-state: все 392 строки уже получили `STAGED`, хотя
operation checkpoint оставался до записи. `.24` точечно приняла этот boundary
после полной проверки immutable stage и вернула ту же operation к bounded
publication без повторения upstream work.

Первый `.24` publication batch из 32 monthly series физически записался, но
read-back обнаружил `period_start=2026-07-01` вместе с
`period_label=2026-06-01`. Причина — извлечение месяца из UTC-сериализации
московской Date. `.26` выводит monthly label и fingerprint из canonical
`period_start`, отдельно обнаруживает physical label mismatch и разрешает
только exact recovery текущего `FAILED_REQUIRES_REVIEW /
UPDATING_AGGREGATES` checkpoint через
`AKORT_alpha74Gate6RecoverMonthlyPeriodLabel()`. Исправляется только первая
32-series пачка; RAW, ordinary price Publish, materialization, calculation и
staging сохраняются. Инструкция:
`GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md`.
`.25` не начала recovery из-за неверной private-ссылки;
`.26` использует `DefaultAdapter.readCalculatedRows` и добавляет общий
статический контроль всех private Apps Script calls.

После успешного завершения canary и `postCanary` digest операция rollback на
`.26` осталась в `RAW_REVERSAL_V4 / COMMIT_RAW`. Проверка canonical DWH
показала 8 из 50 записанных reversal rows, пустой operation cursor и
`aggregate.status=NOT_STARTED`: задержка не была связана с пересчётом 61 636
aggregate rows. Причина — монолитная `RawStore.reverseLoad`, которая отдельно
фильтровала историю и записывала каждую observation, а operation checkpoint
получала только после всех 50 строк. `.27` использует линейный RAW index,
bounded batch по 10 observations и `RAW_REVERSAL_LOG` как exact-once durable
cursor. Точный остановленный `.26` incident продолжается обычным
`AKORT_alpha74Gate6Resume()` с первой observation, которой ещё нет в журнале;
восемь принятых строк, canary и `postCanary` Publish не повторяются.
Инструкция: `GATE6_DURABLE_RAW_REVERSAL_HOTFIX.md`.

`.28` устраняет следующий системный performance defect Gate 6. Принятый
affected-set из 381 aggregate combinations ранее исполнялся окнами по 4,
причём каждое окно повторно читало Weekly/Monthly sources и строило индекс
61 636-row aggregate target. Теперь source snapshot и target index живут один
worker invocation, materialization имеет durable окна по 250, а один trigger
может последовательно выполнить до 40 checkpoints в пределах 190 секунд.
Weekly/Monthly/Industry `UPDATE_PUBLISH` также получил durable cursor и порции
полных серий 25/25/10. Это не повторяет Gate 5 historical replay и не ослабляет
atomic/read-back/lost-response/third-state проверки. Инструкция:
`GATE6_FAST_INCREMENTAL_UPDATE_HOTFIX.md`.

`.29` является операционным release-кандидатом для текущего Gate 6. Он
позволяет повторному Stop установить `stopRequested=true` для уже
остановленного `RUN_REVERSAL` checkpoint и добавляет в progress fingerprint
RAW reversal, Weekly/Monthly/Industry Publish, input-artifact persistence,
calculation, staging, publication, latest, reconciliation и finalization cursors.
Инструкция коммита, `clasp push` и Apps Script:
`ALPHA74_29_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`.

`.30` устраняет следующий подтверждённый operational incident. После terminal
`SUCCESS` reversal и точных rollback digest Weekly/Monthly вложенный
`previousRecovery` вместе с accumulator следующего read-only target превысил
лимит 8 500 байт Script Properties. Fail-closed успел выключить regular
pipeline, но прежний большой state остался `RUNNING`. `.30` хранит прошлые
recovery как bounded audit-lineage, сохраняет terminal state до cleanup
trigger и разрешает Resume только для точного остановленного
`.29 / ROLLBACK_SCAN` checkpoint. Canary, reversal и два завершённых digest не
повторяются. Инструкция: `GATE6_STATE_CAPACITY_RECOVERY_HOTFIX.md`.

В `4.0.0-alpha.7.4.5` подготовлен локальный операторский контур
`INDUSTRY_INPUT`: по одной строке на каждую активную серию
`DIM_INDUSTRY_SERIES`, два пользовательских поля (`Период`, `Значение`),
fail-closed валидация, раздельные партии по мере публикации источников,
`RAW_LOAD_V4`, incremental `PUBLISH_INDUSTRY` и append-only журнал. Код нельзя
разворачивать во время `RUNNING` Gate 5. Gate 6 не использует отраслевую форму;
обычный физический Submit заблокирован до Gate 7 флагом
`PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

## Gate 1 migration cleanup

Перед установкой `4.0-operation-2` используется отдельный fail-closed административный контур:

1. `AKORT_alpha74Gate1LegacyStatus()` выполняет read-only preflight.
2. `AKORT_alpha74Gate1CloseLegacyOperations()` переводит в `CANCELLED` только точный подтверждённый профиль из трёх paused Alpha.3 test operations и одной stale Alpha.4 smoke reversal operation.
3. При активном lease, другой схеме checkpoint, пятом кандидате, неизвестной operation или наличии связанной записи в RAW registry/reversal log операция полностью блокируется.
4. История `OPERATION_QUEUE` сохраняется, в `OPERATION_STEPS` и `SYSTEM_LOG` добавляется audit trail.
5. RAW, Publish и aggregate rows этим действием не изменяются и не удаляются.

Идентификаторы DEV-ресурсов и конкретных операций в публичном репозитории не фиксируются.

## Coding gate

Кодирование разрешается только от этой ветки после проверки:

1. accepted-base commit совпадает с `52590c8...`;
2. в ветке отсутствует runtime-код withdrawn candidates;
3. integration map и final contract не противоречат нормативным документам v4.0;
4. в DEV нет активной или зависшей операции;
5. physical execution остаётся выключенным до отдельного live-write gate.

Gate выполнен 24 июля 2026 года. Это не является приёмкой Alpha.7.4 и не разрешает live-write.
