# Alpha.7.4.21/.22 — Gate 6 operational runtime-context recovery hotfix

> Актуальная установка выполняется на `.22`: `.21` содержал безопасную ошибку
> повторного разбора уже типизированной JSON-настройки и не изменил operation.

## Зафиксированный инцидент

Gate 6 execution `A74_GATE6_7F437567A3ABBFBE94F1` на release
`4.0.0-alpha.7.4.20` завершился fail-closed в фазе `RUN_CANARY`.
Canary operation
`OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9` остановилась на
`MATERIALIZING_AGGREGATE_INPUTS` с кодом
`AGGREGATE_RUNTIME_CONTEXT_MISSING`.

К моменту ошибки:

- baseline digest всех четырёх Publish-листов был завершён: 97 070 строк;
- `COMMIT_RAW`, `UPDATE_PUBLISH` и `PREPARING_AGGREGATE_IMPACT` уже были
  завершены;
- RAW и обычный `PUBLISH_PRICES_WEEKLY` уже содержали эффект canary;
- расчёт и публикация `PUBLISH_PRICE_AGGREGATES` ещё не начинались;
- для operation отсутствовали строки `AGGREGATE_STAGE`;
- DWH- и Publish-recovery copies были сохранены;
- Gate 6 trigger был удалён, regular и user pipeline выключены.

Это частично выполненная, но однозначно восстанавливаемая operation. Новый
Start или повторная загрузка файла недопустимы: они повторили бы уже
зафиксированные стадии.

## Причина

Gate 3 подтвердил расчётный контракт с runtime context, переданным только в
памяти acceptance harness. Авторитетный operational context не был сохранён в
`SYSTEM_SETTINGS`. Gate 5 доказал полную историческую эквивалентность принятого
Alpha.6 расчёта, но регулярная Alpha.7.4 operation пыталась открыть отсутствующий
`PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON`.

## Исправление

Release `.21` добавляет узкий operational compatibility contract:

- `adapter_mode = ALPHA6_ACCEPTED_PARITY`;
- расчёт выполняется принятым Alpha.6 алгоритмом, уже прошедшим Gate 5 exact
  full-history parity;
- результат переводится в канонические строки `AGGREGATE_STAGE` Alpha.7.4;
- публикация остаётся внутри Alpha.7.4 logical-series, fingerprint,
  lost-response, third-state и read-back boundary;
- большие affected sets разбиваются на несколько атомарных пакетов, но один
  логический ряд никогда не делится между пакетами;
- durable intent создаётся для общего результата и для каждого пакета;
- после потерянного ответа пакет распознаётся по after-fingerprint и не
  записывается повторно.

Read-only проверка recovery-копии показала 18 654 строк агрегатов
`AKORT_WEEKLY`; поэтому одна canary-неделя потенциально затрагивает больше
одного безопасного atomic request. Пакетирование является обязательной частью
исправления, а не оптимизацией.

## Граница восстановления

`AKORT_alpha74Gate6RecoverRuntimeContext()` допускает только точный инцидент:

- state schema `4.0-alpha74-gate6-state-1` и release `.20`;
- Gate 6 `FAILED` из `RUN_CANARY`;
- exact canary operation `FAILED` на `MATERIALIZING_AGGREGATE_INPUTS` с
  `AGGREGATE_RUNTIME_CONTEXT_MISSING`;
- RAW commit, ordinary price Publish и aggregate impact завершены;
- aggregate materialization не завершена;
- `AGGREGATE_STAGE` для operation пуст;
- исходный canary-файл имеет прежний SHA-256;
- recovery copies доступны;
- Gate 6 trigger отсутствует, regular/user pipeline выключены;
- посторонние data operations отсутствуют.

При любом несовпадении recovery завершается до активации pipeline. Функция
устанавливает только канонический небольшой runtime marker, переводит ту же
operation в `PAUSED` на её сохранённой фазе и заново запускает Gate 6 worker.
RAW commit и ordinary price Publish не повторяются.

## Установка и продолжение

1. Опубликовать commit `.21` и выполнить `clasp push` в тот же DEV Apps Script.
2. Выполнить `AKORT_alpha74Install()`.
3. Выполнить `AKORT_alpha74SmokeTest()` — ожидается release `.21` и `SUCCESS`.
4. Выполнить `AKORT_alpha74ReadOnlyContractScan()` — ожидается `SUCCESS`.
5. Выполнить `AKORT_alpha74Gate6Status()` и убедиться, что сохранён точный
   `.20 / RUN_CANARY / AGGREGATE_RUNTIME_CONTEXT_MISSING` incident, trigger
   отсутствует, regular/user pipeline выключены.
6. Ровно один раз выполнить
   `AKORT_alpha74Gate6RecoverRuntimeContext()`.
7. Далее запускать только `AKORT_alpha74Gate6Status()`. Worker продолжит ту же
   canary operation, затем выполнит штатные rollback и restore cycles.

Не выполнять `Gate6Start`, обычный `Gate6Resume`, повторный Validate, ручной
Worker или повторную загрузку `AKORT_WEEKLY_W27`. Если recovery-функция вернула
`FAILED`, ничего не включать и передать полный результат для анализа.

## Критерий закрытия

Hotfix не закрывает Gate 6 сам по себе. Gate 6 закрывается только после
`state.status = SUCCESS`, exact rollback/restore digest, финального aggregate
contract scan и созданного evidence-файла. До Gate 7
`PUBLISH_USER_PIPELINE_ENABLED` остаётся `FALSE`.
