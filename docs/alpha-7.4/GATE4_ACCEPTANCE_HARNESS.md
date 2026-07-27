# Alpha.7.4 — Gate 4 Isolated Physical/Fault Acceptance

## Назначение

Gate 4 подтверждает физическую атомарную публикацию и восстановление после
ошибок до включения регулярного aggregate pipeline.

DataLens-подключённая таблица `Publish 4.0 DEV` в Gate 4 не изменяется. Harness
создаёт отдельную временную Google-таблицу в canonical DEV Test Files folder,
использует в ней точный 29-колоночный schema
`PUBLISH_PRICE_AGGREGATES` и сохраняет JSON evidence в canonical Test Results
folder.

## Feature flags

Для Gate 4 разрешена только следующая комбинация:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Обычный Operation Engine при такой комбинации продолжает пропускать aggregate
phases. Рабочая граница записи по-прежнему требует оба флага `TRUE`.

Изолированный writer Gate 4 дополнительно:

- требует DEV environment;
- запрещает ID рабочей Publish-таблицы;
- принимает только отдельную Google-таблицу;
- проверяет точный 29-колоночный schema;
- использует тот же единый `spreadsheets.batchUpdate`.

## Проверяемые сценарии

Один acceptance-run выполняет:

1. `INSERT` нового периода;
2. `UPDATE` существующего периода;
3. `NOOP` без физического API-вызова;
4. lost response после завершённого atomic commit и recovery из `AFTER`;
5. стандартный логический `REVERSAL_DELETE` с восстановлением предыдущего
   `latest`;
6. third-state injection и fail-closed без автоматического overwrite;
7. timeout before/after для всех семи длительных aggregate phases.

Для каждого изменяющего сценария допускается ровно один вызов
`spreadsheets.batchUpdate`. `NOOP` обязан иметь ноль вызовов.

Отдельно проверяются:

- неизменность unrelated rows;
- корректность `is_latest_period`;
- read-back и affected-set reconciliation;
- неизменность рабочей Publish до и после всего запуска;
- неизменность обоих feature flags.

## Исправление физического date read-back

Gate 4 канонизирует `period_start` одинаково для трёх представлений Google
Sheets:

- ISO-строка;
- объект Date;
- числовой serial.

Это устраняет ложный read-back mismatch и не меняет 29-колоночный Publish
schema или экономическую методологию.

## DEV entrypoints

После `clasp push`:

1. запустить `AKORT_alpha74Install()`; установка безопасно возвращает оба
   aggregate feature flags в `FALSE`;
2. изменить только
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED` на `TRUE`;
3. убедиться, что
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` остаётся `FALSE`;
4. запустить `AKORT_alpha74Gate4Status()`;
5. только при `ready=true` запустить `AKORT_alpha74Gate4Acceptance()`.

Regular pipeline не включается до Gate 6.

## Evidence

Успешный запуск создаёт
`ALPHA74_GATE4_ACCEPTANCE_<UTC>.json` со схемой
`4.0-alpha74-gate4-evidence-1`.

Evidence содержит:

- feature flags до и после;
- read-only snapshots рабочей Publish до и после;
- результаты шести physical/fault scenarios;
- timeout matrix по семи phases;
- число atomic API calls;
- sandbox spreadsheet metadata;
- assertions по latest, unrelated rows, lost response, reversal и third state;
- SHA-256 evidence hash.

В публичный Git фиксируются только безопасные итоги запуска. Внутренние file
ID, URL и resource ID не публикуются.

## Условия PASS

- `INSERT`, `UPDATE`, `DELETE`, `NOOP` пройдены;
- mutating scenario использует ровно один atomic API call;
- `NOOP` не выполняет physical write;
- lost response восстанавливается без повторной записи;
- third state завершается `AGGREGATE_PUBLISH_THIRD_STATE`;
- automatic overwrite в third state отсутствует;
- timeout before/after пройден для всех семи phases;
- unrelated fingerprint не изменился;
- latest и reconciliation имеют `PASS`;
- рабочая Publish не изменилась;
- regular pipeline остался выключенным;
- создан ровно один JSON evidence file.

PASS Gate 4 не разрешает regular pipeline. Следующий этап — Gate 5:
full historical build, sequential replay, exact reconciliation и performance.
