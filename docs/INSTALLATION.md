# AKORT DWH 4.0 — установка DEV release

## Граница инструкции

Инструкция относится к текущему DEV release `4.0.0-alpha.7.4.35`. Она не
разрешает production cutover и не включает user pipeline.

## 1. Локальная проверка

```bash
git status --short --branch
git diff --check
npm test
```

Проверить, что `.clasp.json` и `src/99_LocalConfig.js` не попали в Git.

## 2. Deploy в DEV Apps Script

```bash
npm run status:dev
npm run deploy:dev
```

`deploy:dev` должен остановиться при несовпадении DEV Script ID.

## 3. Read-only проверка после deploy

В Apps Script выполнить последовательно:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- release `.35`;
- smoke и contract scan: `SUCCESS`;
- Gate 6: `SUCCESS / SUCCESS`;
- regular pipeline: `TRUE`;
- user pipeline: `FALSE`.

Повторно запускать Gate 6 не нужно.

## 4. Industry form

```javascript
AKORT_alpha74IndustryInputInstall()
AKORT_alpha74IndustryInputStatus()
AKORT_alpha74IndustryInputValidate()
```

Install/Status/Validate не открывают пользовательскую физическую загрузку.
`Submit` разрешается только в контролируемой Gate 7/Beta acceptance либо после
отдельного включения user pipeline в Beta.2 go-live.

## 5. Feature flags

После принятого Gate 6 и до Beta.2:

```text
PUBLISH_ENGINE_ENABLED = TRUE
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = TRUE
PUBLISH_USER_PIPELINE_ENABLED = FALSE
```

User flag включается последним действием go-live после PASS Gate 7,
Beta.1.1–Beta.1.6 и Beta.2 preflight.

## 6. Перед Beta.2

Следовать `docs/BETA2_LAUNCH_PLAN_2026-08-07.md`. Установка `.35` сама по себе
не является установкой Beta.1/Beta.2: эти packages и их entrypoints должны быть
реализованы, протестированы и приняты отдельно.
