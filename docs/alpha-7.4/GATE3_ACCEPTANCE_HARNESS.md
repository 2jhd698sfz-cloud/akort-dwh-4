# Alpha.7.4 — Gate 3 Acceptance Harness

## Назначение

Gate 3 подтверждает read-only интеграцию Alpha.7.4 с принятыми контрактами
Alpha.7.1–Alpha.7.3 до любых физических изменений aggregate Publish.

Harness решает пять задач:

1. собирает authoritative runtime context из immutable Alpha.7.1 baseline и
   принятой `RAW_CATEGORY_WEIGHTS`;
2. строит изолированные планы `NEW_PERIOD`, `REVISION` и `REVERSAL`;
3. предоставляет parameterless entrypoints для DEV Apps Script;
4. сравнивает защищённый data plane до и после выполнения;
5. сохраняет один machine-readable JSON evidence после полного PASS.

В production setting `PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON` ничего не
записывается. Acceptance context существует только в памяти одного запуска.

## Источники

- immutable Alpha.7.1 aggregate baseline из canonical Config;
- принятая `RAW_CATEGORY_WEIGHTS` из DEV DWH;
- frozen Alpha.7.2 golden fixture builder и calculator contract;
- frozen Alpha.7.3 revision/reversal planner;
- текущий `PUBLISH_PRICE_AGGREGATES` для до- и послепроверки;
- `SYSTEM_SETTINGS`, `AGGREGATE_STAGE` и `PUBLISH_IMPACT` для safety checks.

В публичном репозитории не фиксируются внутренние resource IDs и Drive URLs.

## Сценарии

### NEW_PERIOD

Planner получает только текущий accepted period во frontier. Текущий период
должен быть запланирован, а отсутствующий следующий зависимый период —
зафиксирован как audit-blocked. Это подтверждает future-period guard.

### REVISION

Planner получает полный accepted frontier. Текущий период и следующий
существующий зависимый период должны входить в план.

### REVERSAL

Planner получает полный accepted frontier, положительное evidence текущего
эффекта и previous inputs. Текущий период и следующий существующий зависимый
период должны входить в стандартный reversal plan.

Каждый сценарий выполняется для принятого weekly и monthly fixture. Итого
единый acceptance-run содержит шесть fixture runs.

## Safety contract

Перед началом и после планирования harness фиксирует:

- число строк и колонок target;
- logical row count;
- полный target fingerprint;
- число duplicates, latest failures и future rows;
- последние строки `AGGREGATE_STAGE` и `PUBLISH_IMPACT`;
- оба aggregate feature flags.

Запуск блокируется, если хотя бы один feature flag не равен `FALSE`.
Любое отличие before/after блокирует PASS и не позволяет сохранить evidence.

В data plane разрешено `0` записей. Единственная допустимая запись —
один новый JSON-файл в canonical Test Results folder после прохождения всех
проверок. `SYSTEM_LOG` также не изменяется: все entrypoints используют
`persistLogs: false`.

## DEV entrypoints

Рекомендуемый порядок:

1. `AKORT_alpha74Gate3RuntimeContextStatus()` — проверить authoritative context
   и feature flags без записи evidence.
2. При диагностической необходимости отдельно:
   `AKORT_alpha74Gate3NewPeriodPlan()`,
   `AKORT_alpha74Gate3RevisionPlan()` и
   `AKORT_alpha74Gate3ReversalPlan()`.
3. `AKORT_alpha74Gate3Acceptance()` — единый нормативный acceptance-run.

Для штатной приёмки достаточно первого и третьего вызова. Отдельные сценарные
entrypoints предназначены для локализации ошибки и не создают evidence files.

## Evidence contract

Успешный `AKORT_alpha74Gate3Acceptance()` создаёт файл
`ALPHA74_GATE3_ACCEPTANCE_<UTC>.json` со схемой
`4.0-alpha74-gate3-evidence-1`.

Файл содержит:

- release и harness version;
- execution ID и UTC timestamp;
- fingerprint и безопасное описание runtime context;
- результаты трёх сценариев и шести fixture runs;
- before/after data-plane snapshots;
- явные assertions о неизменности target, staging, impact и feature flags;
- `dataPlaneWrites: 0` и `physicalWrites: false`;
- SHA-256 evidence hash.

Возвращаемый Apps Script result содержит file ID, name, URL, hash и byte count.
В Git фиксируются только безопасные итоги выполнения, без внутреннего URL или
resource ID.

## Условия PASS

- все три сценария имеют `SUCCESS`;
- weekly и monthly fixtures выполнены для каждого сценария;
- нет error diagnostics;
- `NEW_PERIOD` планирует source period и блокирует будущую зависимость;
- `REVISION` и `REVERSAL` включают следующий accepted dependent period;
- calculator не исполняется и planned rows не материализуются;
- target fingerprint и service-table row counts не изменились;
- оба feature flags остались `FALSE`;
- создан ровно один JSON evidence file.

PASS Gate 3 не разрешает physical execution. Следующий шаг — отдельный Gate 4
с изолированными physical/fault tests и самостоятельным разрешением.
