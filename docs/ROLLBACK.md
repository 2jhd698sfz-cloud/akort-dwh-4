# AKORT DWH 4.0 — rollback и recovery

## 1. Разные уровни rollback

Не смешивать:

- rollback кода — возврат Git/Apps Script release;
- rollback данных — логический `RAW_REVERSAL_V4` конкретного `load_id`;
- restore recovery copy — аварийное восстановление целой DWH/Publish копии.

## 2. Rollback кода

1. Выключить `PUBLISH_USER_PIPELINE_ENABLED`.
2. Убедиться, что нет активной operation; при необходимости выполнить safe
   stop и дождаться terminal checkpoint.
3. Создать согласованный backup DWH + Publish.
4. В GitHub Desktop выполнить revert конкретного release commit.
5. Выполнить `npm test`, затем `npm run deploy:dev`.
6. Выполнить install/status/smoke/contract scan.
7. Не включать user pipeline до проверки совместимости data/schema.

## 3. Rollback данных

Штатный путь — новая логическая reversal operation, а не удаление строк:

1. найти committed/non-reversed `load_id`;
2. выполнить read-only impact preview;
3. зафиксировать причину и подтверждение;
4. создать `RAW_REVERSAL_V4`;
5. дождаться bounded RAW reversal и обновления affected Publish/aggregates;
6. проверить latest, quick audit и reconciliation;
7. повторный запрос должен быть idempotent/NO_CURRENT_EFFECT.

Gate 6 доказал этот контракт для canary load. Универсальный операторский
Rollback Any load_id является обязательным Beta.1.2 и должен быть принят до
Beta.2.

## 4. Recovery copies

Gate 6 recovery copies являются последним аварийным якорем, но не штатным
способом отката отдельной загрузки. Восстановление целой копии допускается
только при подтверждённом incident plan, остановленных triggers и отдельной
последующей сверке DWH/Publish/DataLens.

## 5. Запреты

- не редактировать RAW/Publish вручную;
- не удалять audit/reversal history;
- не выполнять `clasp push` поверх RUNNING data operation;
- не запускать старые Gate 6 recovery entrypoints после Gate 6 SUCCESS;
- не включать user pipeline как способ «проверить, что всё работает».
