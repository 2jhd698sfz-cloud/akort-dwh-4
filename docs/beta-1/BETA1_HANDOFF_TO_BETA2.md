# Передача Beta.1 → Beta.2

Статус handoff: **AUTHORIZED WITH BOUNDARIES**  
Формальная приёмка Beta.1: **GO**  
Неизменяемая реализационная база Beta.1: `431b6f77bb6c01c0df855aec37e99c1619a93c4f`

## Разрешённый следующий этап

Следующий этап реализации по `docs/BETA2_LAUNCH_PLAN_2026-08-07.md`:

**Beta.2.1 — Read-only Control Center.**

До реализации допускается компактный gap analysis, но он является planning activity и не должен обозначаться как дополнительный номерной релиз без изменения canonical roadmap.

## Обязательные унаследованные ограничения

1. `PUBLISH_USER_PIPELINE_ENABLED` остаётся `FALSE`.
2. Production write не разрешён.
3. Beta.2 переиспользует принятые Operation Engine, Raw Store, Incremental Publish и aggregate integration; параллельные executors или data planes запрещены.
4. Существующий единственный daily paired-backup trigger остаётся единственным обязательным автоматическим trigger Beta.1 до отдельно принятого изменения в Beta.2.
5. Beta.2.1 должен быть read-only и строиться на registries/status cache.
6. Каждый этап Beta.2.1–Beta.2.6 получает собственный результат PASS.
7. Operational go-live Beta.2 запрещён до выполнения всех обязательных GO criteria.
8. User pipeline включается только последним действием go-live после backup, audit, trigger, DataLens и rollback checks.

## Последовательность Beta.2

1. Beta.2.1 — Read-only Control Center.
2. Beta.2.2 — User Load Workflow.
3. Beta.2.3 — User Audit/Rollback/Backup Operations.
4. Beta.2.4 — Familiar Upload Folder and Template Cutover.
5. Beta.2.5 — DataLens Data Model and Connection.
6. Beta.2.6 — DataLens Dashboard and Visual Acceptance.
7. Beta.2.7 — Operational Go-Live and Hypercare.

## Выполненные входные условия

- Beta.1.1–Beta.1.6 имеют подтверждённое PASS evidence.
- Активные или review-required operations отсутствуют.
- Последний Full Audit имеет 12/12 PASS.
- Observability имеет HEALTHY и 0 issues.
- Paired backup и isolated restore evidence существуют.
- Controlled rollback E2E имеет 15/15 PASS.
- Trigger ownership healthy и singular.
- User pipeline выключен.
- Реализационная база Beta.1 заморожена.

## Что не разрешает этот handoff

Handoff не:

- включает user pipeline;
- разрешает cutover;
- разрешает DataLens reconnection;
- разрешает production writes;
- отменяет stage acceptance Beta.2;
- отменяет финальный GO/NO-GO.
