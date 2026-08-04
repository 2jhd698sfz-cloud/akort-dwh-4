# AKORT DWH 4.0 — DEV resources

Идентификаторы ресурсов не хранятся в Git. Они находятся только в
`src/99_LocalConfig.js`, `.clasp.json` и/или Script Properties.

## Разрешённые типы ресурсов

- standalone DEV Apps Script project;
- DWH TECH 4.0 DEV;
- Publish 4.0 DEV, подключённая к DataLens;
- `07_Разработка системы 4.0`;
- `01_DEV таблицы`;
- `02_Тестовые файлы`;
- `03_Результаты тестов`;
- `04_Релизы`;
- `05_Документация`.

## Обязательные правила

- Environment Guard должен подтверждать DEV и blocked production IDs;
- deploy script должен сверять `.clasp.json` с local config;
- DWH и Publish IDs не выводятся в публичные логи/commit;
- recovery/evidence IDs хранятся в внутренних registries/Google Drive docs;
- DataLens подключается к Publish, а не к техническим DWH sheets;
- production 3.1.7 не меняется до отдельного Beta.2 cutover GO;
- старые triggers отключаются до передачи intake folder Beta.2.

## Feature flags после Gate 6

```text
PUBLISH_ENGINE_ENABLED = TRUE
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = TRUE
PUBLISH_USER_PIPELINE_ENABLED = FALSE
```

User flag остаётся `FALSE` до Gate 7, Beta.1 и go-live preflight.
