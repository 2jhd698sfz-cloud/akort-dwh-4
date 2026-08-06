# Beta.2.3 candidate-r5 — Reuse Matrix

| Потребность | Принятый компонент | Реализация Beta.2.3 r5 | Новый механизм |
|---|---|---|---|
| Обзор системы | Beta.2.1 Control Center | Русская presentation model поверх accepted DTO | Нет |
| Загрузка файлов | Beta.2.2 workflow | Existing screen/endpoints и exact operation binding | Нет |
| Backup Now | Beta.1.1 | Direct `backupNow/status`; controls verify accepted manual input/meta | Нет |
| Rollback | Beta.1.2 | Direct preview/submit/status + HMAC binding + exact reversal origin | Нет rollback engine |
| Конфликт операций | Beta.1.4 | Accepted status/guards | Нет |
| Наблюдаемость | Beta.1.5 | Quick Audit и overview читают accepted projection | Нет |
| Full Audit | Beta.1.6 | Accepted submit/status/continue + exact dry-run origin | Нет audit engine |
| Continue/Stop/Retry | Operation Engine | `resume(maxSteps:1)`, `requestStop`, before/after origin check | Нет executor/worker |
| Industry operation | Accepted Industry Input | Exact source/target/rows hash/idempotency validation | Нет loader |
| Freshness profile split | Accepted parser profiles + DIM_PRODUCT_MAPPING | Source-file-type/category scope | Нет parser |
| Freshness atomicity | Apps Script Script Lock + derived projection | One staging table, exact read-back and restoration | No new data plane |
| Action audit | Core Logger / SYSTEM_LOG | Exactly-one durable STARTED and COMPLETED records | Нет новой audit table |

Запрещённые дублирования отсутствуют: parser, loader, RAW store, Publish updater, aggregate calculator, queue, executor, dispatcher, backup engine, rollback engine, Full Audit methodology и observability engine не реализуются повторно.
