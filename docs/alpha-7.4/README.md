# АКОРТ 4.0 — Alpha.7.4 Integration Reset

## Статус

`DOCUMENTATION COMPLETE / CODE NOT STARTED / PHYSICAL WRITES PROHIBITED`

Дата фиксации: 24 июля 2026 года.

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

## Coding gate

Кодирование разрешается только от этой ветки после проверки:

1. accepted-base commit совпадает с `52590c8...`;
2. в ветке отсутствует runtime-код withdrawn candidates;
3. integration map и final contract не противоречат нормативным документам v4.0;
4. в DEV нет активной или зависшей операции;
5. physical execution остаётся выключенным до отдельного live-write gate.
