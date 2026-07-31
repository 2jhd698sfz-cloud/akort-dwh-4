# АКОРТ 4.0 — Alpha.7.4 Integration Reset

## Статус

`GATE 4 ACCEPTED / GATE 5 RESUME ALLOWLIST HOTFIX READY / DURABLE RESUME PENDING / REGULAR PIPELINE PROHIBITED`

Дата фиксации: 31 июля 2026 года.

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
- `STATUS.json` — машиночитаемый статус ветки.

## Запрещённые решения

- отдельный aggregate dispatcher;
- отдельные `AGGREGATE_REFRESH_RUNS`, `AGGREGATE_REFRESH_QUEUE` и `AGGREGATE_REFRESH_BATCHES`;
- `physical_row_hint` как identity, checkpoint или основа rollback;
- отдельный reverse-mutation executor;
- ручное продолжение после штатного timeout;
- per-row чтение Google Sheets;
- регулярный full-sheet clear/rewrite;
- частичная публикация affected-set;
- `SUCCESS` до read-back и reconciliation;
- перенос full replay, performance или operational enablement в Alpha.7.5.

## Реализованный локальный контур

- Operation Engine `4.0-operation-2` с агрегатными фазами и bounded-phase checkpoint;
- `AGGREGATE_STAGE` с immutable input artifact, calculated rows и durable publish intent;
- authoritative `PUBLISH_IMPACT` → Alpha.7.3 planner → Alpha.7.2 calculator;
- полная замена затронутых логических серий без сохранения физических номеров строк;
- один atomic Sheets API request для regular affected-set;
- read-back, latest validation, lost-response recovery и third-state fail-closed;
- два feature flags `FALSE` по умолчанию;
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

Для Gate 5 подготовлен persistent trigger-driven harness. Он создаёт отдельные
baseline snapshot, live snapshot, full build и sequential replay workbooks,
воспроизводит accepted load/reversal order и сравнивает все четыре aggregate
targets по exact canonical digest. Ручной `Continue` не используется; quota и
transient retry выполняются автоматически. Gate 5 остаётся открытым до
нормативного DEV `SUCCESS`.

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

В `4.0.0-alpha.7.4.5` подготовлен локальный операторский контур
`INDUSTRY_INPUT`: по одной строке на каждую активную серию
`DIM_INDUSTRY_SERIES`, два пользовательских поля (`Период`, `Значение`),
fail-closed валидация, раздельные партии по мере публикации источников,
`RAW_LOAD_V4`, incremental `PUBLISH_INDUSTRY` и append-only журнал. Код нельзя
разворачивать во время текущего Gate 5; физический Submit дополнительно
заблокирован до `SUCCESS` Gate 5 и завершения operational enablement Gate 6–7.

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
