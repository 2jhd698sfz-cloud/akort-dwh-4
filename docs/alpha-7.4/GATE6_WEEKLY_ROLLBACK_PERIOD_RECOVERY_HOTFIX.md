# Gate 6 weekly rollback period recovery

## Инцидент

Alpha.7.4.30 дошёл до полной проверки rollback и корректно остановился
fail-closed. Три Publish targets совпали с baseline, а
`PUBLISH_PRICE_AGGREGATES` содержал ровно 196 лишних строк.

Canary source описывает ISO-неделю `2026-W27`, воскресенье которой —
`2026-07-05`. В accepted parity adapter Apps Script Date был сначала
сериализован как `2026-07-04T21:00:00.000Z`, а затем логический ключ был
получен простым срезом UTC-строки. Поэтому canary weekly stage и Publish
получили субботу `2026-07-04`. Reversal строился из RAW business key с
воскресеньем `2026-07-05` и не мог сопоставить эти строки.

## Исправление

Release `.31`:

- выводит Sunday date непосредственно из `YYYY-Www`;
- применяет её до создания durable row identity;
- сохраняет прежнюю monthly-нормализацию;
- допускает recovery только для точного `.30` execution, canary/reversal,
  digest boundary и immutable 392-row stage;
- выбирает только 196 `AKORT_WEEKLY / 2026-W27 / 2026-07-04` stage rows;
- ремонтирует максимум 16 полных logical series в одном atomic request;
- принимает только целый before-state или уже записанный after-state;
- проверяет отсутствие и legacy Saturday, и преждевременного canonical Sunday,
  affected fingerprint и latest flags;
- держит regular/user pipelines выключенными на всём repair boundary.

Read-only live sizing подтвердил 196 incident series и максимум 130 строк на
одну серию. Для фиксированных 16-series boundaries максимальный batch содержит
1 570 исходных строк, 1 554 replacement rows, 45 066 ячеек и 2 subrequests.
Это ниже frozen limits `5 000 rows / 100 000 cells / 500 requests` с большим
запасом. Фиксированная граница сохраняется при lost response: повторный вызов
проверяет тот же целый набор серий как after-state и не делает вторую запись.

## Почему цикл перезапускается

Старый post-canary digest законно содержит ошибочную Saturday identity. После
исправления restore должен создать Sunday identity, поэтому сравнивать его со
старым post-canary нельзя. После точного возврата к baseline Gate сохраняет
recovery-копии, создаёт новый execution ID и повторяет полный canary → reversal
→ restore. Новый post-canary и final digest формируются одной канонической
версией кода и снова обязаны совпасть точно.

Операторский порядок приведён в
`ALPHA74_31_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`.
