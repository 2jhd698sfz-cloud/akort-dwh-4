# АКОРТ 4.0 — Alpha.7.4 Integration Reset

## Статус

`GATE 3 ACCEPTED / GATE 4 HARNESS READY / ISOLATED PHYSICAL ACCEPTANCE PENDING / REGULAR PIPELINE PROHIBITED`

Дата фиксации: 27 июля 2026 года.

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
writes, неизменный target fingerprint и один JSON evidence file. Физические
записи по-прежнему запрещены; следующий этап — отдельный Gate 4.

Gate 4 harness подготовлен локально. Его нормативный DEV-запуск остаётся
pending: рабочая Publish будет прочитана до и после, а физические
INSERT/UPDATE/DELETE/NOOP и fault scenarios будут выполнены только в отдельной
таблице canonical Test Files folder. Regular pipeline останется выключенным.

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
