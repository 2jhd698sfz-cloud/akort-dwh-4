# Alpha.7.4.22 — Gate 6 typed runtime-context setting hotfix

## Инцидент

Первый запуск `AKORT_alpha74Gate6RecoverRuntimeContext()` на `.21` завершился
до любых изменений operation или data plane:

`ALPHA74_GATE6_RUNTIME_CONTEXT_SETTING_INVALID`

Причина в сообщении: `"[object Object]" is not valid JSON`.

## Причина

`AKORT.Config.readSystemSettings()` уже преобразует настройки с
`value_type=JSON` в JavaScript-объекты. Recovery-код `.21` ошибочно считал, что
получил исходную строку, вызвал `String({})`, получил `[object Object]` и
попытался выполнить повторный `JSON.parse`.

Ошибка произошла до записи runtime marker, до перевода canary operation из
`FAILED` и до включения regular pipeline. Поэтому точный `.20` checkpoint,
recovery-копии и частично выполненная canary остаются пригодными для того же
восстановления.

## Исправление

`.22` принимает оба допустимых представления настройки:

- уже типизированный объект, возвращённый `AKORT.Config`;
- JSON-строку, используемую тестовыми или совместимыми адаптерами.

Пустое значение нормализуется в `{}`. Массив, скаляр или некорректная строка
по-прежнему блокируются. Остальной exact recovery allowlist `.21` не изменён.

## Установка

1. Опубликовать `.22` и выполнить `clasp push`.
2. Выполнить `AKORT_alpha74Install()`.
3. Выполнить `AKORT_alpha74SmokeTest()` и проверить release `.22`.
4. Выполнить `AKORT_alpha74ReadOnlyContractScan()`.
5. Выполнить `AKORT_alpha74Gate6Status()` — исходный `.20` failure и выключенные
   regular/user flags должны сохраниться.
6. Ровно один раз выполнить `AKORT_alpha74Gate6RecoverRuntimeContext()`.
7. Далее использовать только `AKORT_alpha74Gate6Status()`.

Не выполнять `Gate6Start`, обычный `Gate6Resume`, Validate, ручной Worker или
повторную загрузку canary-файла.
