# Alpha.7.4 — Gate 6 acceptance result

## Итог

Gate 6 завершён `SUCCESS / SUCCESS` на release
`4.0.0-alpha.7.4.35`.

- execution: `A74_GATE6_37FAED6EF952F9BB5FD4`;
- acceptance version: `4.0-alpha74-gate6-acceptance-17`;
- state schema: `4.0-alpha74-gate6-state-1`;
- evidence schema: `4.0-alpha74-gate6-evidence-1`;
- canary source: `AKORT_WEEKLY_W27`, 50 normalized rows;
- canary, reversal и restore operations: `SUCCESS`;
- `rollbackExact=true`;
- `restoreExact=true`;
- final aggregate contract scan: PASS;
- regular pipeline: `TRUE`;
- user pipeline: `FALSE` до Gate 7.

## Проверенные состояния Publish

| Срез | Weekly | Monthly | Industry | Aggregates |
|---|---:|---:|---:|---:|
| Baseline | 20 211 | 12 957 | 2 266 | 61 636 |
| Post-canary | 20 311 | 13 057 | 2 266 | 62 028 |
| Rollback | 20 211 | 12 957 | 2 266 | 61 636 |
| Final restore | 20 311 | 13 057 | 2 266 | 62 028 |

Rollback digests точно равны baseline для всех четырёх листов. Final digests
точно равны post-canary для всех четырёх листов.

## Что доказано

- новый source file проходит общий parser/RAW/Publish/aggregate pipeline;
- обновление выполняется bounded/durable шагами и продолжается после timeout;
- логический reversal возвращает точное состояние до canary;
- повторная source-file загрузка восстанавливает точное post-canary состояние;
- агрегатная витрина сохраняет 29-колоночный контракт;
- DataLens-connected Publish остаётся целостной на проверенных границах;
- общий механизм rollback/restore не нужно повторять на каждом утверждённом
  шаблоне в Gate 7.

## Следующий этап

Gate 7 выполняет независимый review, сокращённую матрицу всех утверждённых
profiles и Industry, итоговый contract scan и выпуск accepted Alpha.7.4
package. До его PASS `PUBLISH_USER_PIPELINE_ENABLED` остаётся `FALSE`.
