# Alpha.7.4.19 — Gate 6 unit normalization hotfix

## Инцидент

Первичный `AKORT_alpha74Gate6Validate()` в release `.18` завершился fail-closed
до создания Gate 6 operation и до любых live writes:

- код: `ALPHA74_GATE6_SOURCE_BLOCKING_ISSUES`;
- parser issue: `UNIT_NOT_RECOGNIZED`;
- категория: `Яйца куриные, 10 шт.`;
- единица источника: `10 шт`;
- единица `DIM_PRODUCTS`: `10 шт.`;
- две ошибки соответствуют двум ценовым колонкам одной строки.

## Причина

`unitKey_()` распознавал `10 шт`, но не удалял завершающую точку из
справочной единицы. Поэтому source unit успешно канонизировалась, а target unit
возвращала пустой ключ. Это дефект нормализации представления, а не ошибка
данных, mapping или размерности.

## Исправление

Release `4.0.0-alpha.7.4.19` перед сопоставлением удаляет только завершающие
символы `.`, `,`, `;`, `:` и повторно нормализует пробелы. В результате:

- `10 шт` и `10 шт.` дают ключ `ten_pieces`;
- `шт` и `шт.` дают ключ `piece`;
- числовое значение не пересчитывается, когда канонические единицы совпадают;
- существующие конверсии `т → кг`, `тыс. шт → 10 шт` и
  `тыс. м3 → м3` не меняются;
- `DIM_PRODUCTS`, `DIM_PRODUCT_MAPPING` и canary-файл не редактируются.

## Проверка

В Gate 6 regression suite добавлен executable test для:

1. распознавания `10 шт`;
2. распознавания `10 шт.`;
3. распознавания `шт.`;
4. identity conversion `10 шт → 10 шт.` без изменения значения.

Полный локальный suite должен завершиться `PASS` до публикации commit.

## Установка после неуспешного Validate `.18`

Не создавать новый source file и не менять текущий `GATE6_CANARY_INPUT!B4`.
Предыдущая ошибка возникла на read-only Validate, поэтому recovery, Stop и
Resume не требуются.

После публикации commit:

1. выполнить `clasp push` в DEV Apps Script;
2. запустить `AKORT_alpha74Install()`;
3. запустить `AKORT_alpha74SmokeTest()`;
4. запустить `AKORT_alpha74ReadOnlyContractScan()`;
5. запустить `AKORT_alpha74Gate6Install()` — существующая ссылка в `B4`
   сохраняется;
6. повторить `AKORT_alpha74Gate6Validate()`;
7. при `SUCCESS` проверить `AKORT_alpha74Gate6Status()` и только затем один раз
   запустить `AKORT_alpha74Gate6Start()`.

До `Gate6Start` флаги regular и user pipeline остаются `FALSE`.

После успешного Validate `.19` Start дошёл до отдельного baseline-header
инцидента, описанного в `GATE6_BASELINE_HEADER_RECOVERY_HOTFIX.md`. Это не
отменяет unit normalization и не требует изменения source file.
