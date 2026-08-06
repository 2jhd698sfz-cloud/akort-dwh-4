# Beta.2.1 — REUSE_MATRIX

Статус: NORMATIVE / PRE-CODING INVENTORY COMPLETE  
Base commit: `32945776e279528008cbd753e1f0321b3c52e91e`

| Пользовательская потребность | Принятая реализация | Evidence/владелец | Gap | Минимальная дельта Beta.2.1 |
|---|---|---|---|---|
| Общий статус системы | `AKORT.Beta15CompactObservability.status()` | Beta.1.5 compact observability | Нет пользовательского представления | Отобразить готовый DTO |
| Состояние datasets | `DATASET_STATUS` через Beta.1.5 status | Beta.1.5, максимум 16 строк | Нет UI | Карточки и таблица |
| Issues | `ISSUE_REGISTRY` через Beta.1.5 status | Beta.1.5, максимум 250 строк | Нет UI и ограничения выдачи | Показать максимум 50, сохранить total |
| Активная операция | Поля active operation в `DATASET_STATUS` | Beta.1.5 + Beta.1.4 classifier | Нет UI | Показать ID, phase, progress, next_action |
| Backup | Dataset `BACKUPS` в `DATASET_STATUS` | Beta.1.1 + Beta.1.5 | Нет UI | Read-only карточка |
| Trigger ownership | Dataset `TRIGGERS` в `DATASET_STATUS` | Beta.1.4 + Beta.1.5 | Нет UI | Read-only карточка |
| Full Audit | `AKORT.Beta16OperatorFacade.statusLatest()` | Beta.1.6 operator facade | Нет UI | Read-only карточка evidence |
| Release/environment | `AKORT.Release`, `AKORT.Config` | Alpha.2 / accepted runtime | Нет UI | Read-only summary |
| User pipeline flag | `SYSTEM_SETTINGS` через `AKORT.Config.readSystemSettings()` | Accepted Config | Нет UI и fail-closed guard | Отображение + блокировка при TRUE |
| Ссылки на DWH/Publish/Docs/Backup | Accepted resource IDs из Config | Alpha.2 Config | Нет безопасного DTO | Сформировать URL на сервере |
| Пользовательский доступ | Google Web App access + `Session.getActiveUser()` | Apps Script platform | Нет UI guard | Single-user acceptance + optional allowlist |
| HTML-интерфейс | Отсутствует | Source inventory: HTML/onOpen/sidebar отсутствуют | Подтверждён | Один HTMLService Web App |

## Запрещённые дублирования

Beta.2.1 не реализует parser, validation, mapping, load, RAW, Publish, aggregate
calculation, latest, reconciliation, backup, rollback, audit, retention,
operation queue, checkpoint, retry или trigger logic.

`AKORT.Beta15CompactObservability.refresh()` намеренно не вызывается: кнопка
«Обновить экран» повторно читает готовые materialized projections и не обновляет
их физически.
