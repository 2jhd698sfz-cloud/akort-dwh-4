# Beta.2.1 — Read-only Control Center Contract

## Решение

Beta.2.1 добавляет только пользовательский read-only слой. Control Center
реализуется как Apps Script Web App / HTMLService в существующем standalone
Apps Script project `AKORT_DWH_4_DEV`.

Google Sheets sidebar не используется: принятый Apps Script project не является
container-bound script, а создание второго bound-script нарушило бы single
backend и REUSE-FIRST.

## Принятые зависимости

- `AKORT.Beta15CompactObservability.status()`;
- `AKORT.Beta16OperatorFacade.statusLatest()`;
- `AKORT.Config.load()`;
- `AKORT.Config.readSystemSettings()`.

## Разрешённая дельта

- `doGet`;
- серверный read-only adapter;
- HTML/CSS/JavaScript без внешних библиотек;
- access guard;
- нормализация DTO и русские пользовательские подписи;
- безопасные ссылки на принятые ресурсы.

## Запреты

- никаких новых operation types;
- никаких enqueue/run/resume;
- никаких triggers;
- никаких записей в service tables, RAW или Publish;
- никаких вызовов observability refresh;
- никаких полных сканирований RAW/Publish;
- pipeline остаётся FALSE;
- production не затрагивается.

## Deployment contract

На Beta.2.1 Web App разворачивается с исполнением от имени пользователя,
открывающего приложение. Приёмочный доступ — только владелец. Для расширения
доступа используется опциональное Script Property
`AKORT_BETA21_ALLOWED_EMAILS`; неизвестный пользователь блокируется сервером.
