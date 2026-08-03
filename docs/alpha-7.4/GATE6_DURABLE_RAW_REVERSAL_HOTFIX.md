# Alpha.7.4.27 — Gate 6 durable RAW reversal recovery

## Подтверждённый инцидент

Gate 6 execution `A74_GATE6_7F437567A3ABBFBE94F1` успешно завершила canary
и exact `postCanary` scan, после чего штатная операция
`OP_RAW_REVERSAL_V4_20260802T191111384Z_3683C13EE282` зависла в
`COMMIT_RAW`.

Read-only проверка canonical DWH 3 августа 2026 года установила:

- operation status: `RUNNING`;
- operation/checkpoint phase: `COMMIT_RAW`;
- completed phases: `DISCOVER`, `VALIDATE`, `PARSE`, `STAGE`;
- aggregate status: `NOT_STARTED`;
- canary target load: `LOAD_20260802T123559854Z_EFB27B040FBC`;
- target RAW table: `RAW_PRICES_WEEKLY`;
- target observations: 50;
- durable successful reversal records: 8;
- один reversal load ID:
  `LOAD_REV_20260802T193440542Z_9D4AB8FFFF24`;
- reversal load registry ещё не создан, target load остаётся `COMMITTED`;
- rollback Publish и aggregate pipeline ещё не начинались.

Следовательно, текущая задержка не вызвана пересчётом 61 636 aggregate rows.
Операция не дошла до aggregate phases.

## Причина

Старая `RawStore.reverseLoad()` выполняла весь rollback одним вызовом:

1. для каждой из 50 target rows заново фильтровала всю RAW history;
2. отдельно меняла `is_latest` для каждой строки;
3. отдельно добавляла каждую строку в `RAW_REVERSAL_LOG`;
4. только после всех строк меняла load registry и возвращала управление
   Operation Engine.

Apps Script прервал этот монолитный вызов после восьми записей. Физические
RAW-изменения сохранились, но operation checkpoint остался перед
`COMMIT_RAW`. Поэтому прежний worker не имел durable cursor и не мог корректно
продолжить с девятой строки.

## Исправление `.27`

`RAW_REVERSAL_V4 / COMMIT_RAW` теперь является bounded repeatable phase:

- не более `RAW_REVERSAL_CHUNK_ROWS=10` observations за один step;
- история RAW индексируется по business key за один линейный проход вместо
  повторного полного фильтра для каждой target row;
- `is_latest=0` и восстановленные `is_latest=1` записываются двумя bounded
  batch calls;
- все reversal log rows одной пачки записываются одним range write;
- `RAW_REVERSAL_LOG` является authoritative exact-once cursor;
- после каждой незавершённой пачки handler возвращает `repeatPhase=true`, а
  Operation Engine сохраняет `4.0-raw-reversal-work-1` checkpoint;
- после lost response уже записанные observation IDs перечитываются из
  журнала и не выполняются повторно;
- reversal load registry создаётся до финального перевода target load в
  `REVERSED`, поэтому финализация также восстанавливается после lost response;
- конфликтующие reversal load IDs, duplicate observation logs, чужая target
  observation или later RAW version блокируют процесс fail-closed до записи.

## Exact recovery текущего Gate 6

Обычный `AKORT_alpha74Gate6Resume()` на `.27` дополнительно разрешает только
один проверенный `.26` incident. До включения worker он требует одновременно:

- execution, operation и target load IDs из раздела выше;
- Gate 6 `STOPPED`, `stoppedFromPhase=RUN_REVERSAL`;
- reversal operation `PAUSED/RUNNING / COMMIT_RAW` со
  `stopRequested=true`;
- `COMMIT_RAW` и все последующие phases не завершены;
- aggregate status `NOT_STARTED`;
- ровно 50 target observations;
- не менее одной и менее 50 уникальных durable reversal records;
- один reversal load ID;
- `completedRows + pendingRows = 50`;
- обе исходные Gate 6 recovery-копии доступны;
- `engine=TRUE`, `execution=TRUE`, `regular=FALSE`, `user=FALSE`.

Recovery принимает уже завершённые восемь observations и начинает с первой
observation, отсутствующей в `RAW_REVERSAL_LOG`. Новый canary, новый full
rollback и повтор canary operation не создаются.

## Установка и продолжение

Пока `.26` worker ещё активен:

1. Один раз выполнить `AKORT_alpha74Gate6Stop()`.
2. Дождаться `AKORT_alpha74Gate6Status()` с `status=STOPPED`,
   `stoppedFromPhase=RUN_REVERSAL`, `triggerCount=0`.
3. Не удалять и не редактировать восемь строк `RAW_REVERSAL_LOG`, target RAW
   rows, operation queue или recovery-копии.

Для текущего incident используется superseding release `.29`, который
сохраняет `.27` exact RAW recovery и дополнительно ускоряет весь последующий
incremental Publish/aggregate path. После публикации commit и `clasp push`:

1. Выполнить `AKORT_alpha74Install()`.
2. Проверить flags:
   - `PUBLISH_ENGINE_ENABLED=TRUE`;
   - `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`;
   - `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
   - `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.
3. Выполнить `AKORT_alpha74SmokeTest()`.
4. Выполнить `AKORT_alpha74ReadOnlyContractScan()`.
5. Выполнить `AKORT_alpha74Gate6Status()` и убедиться, что сохранённый state
   всё ещё `.26 / STOPPED / RUN_REVERSAL`, trigger отсутствует.
6. Один раз выполнить `AKORT_alpha74Gate6Resume()`.
7. Далее выполнять только `AKORT_alpha74Gate6Status()`.

Ожидаемый первый ответ Resume:

- `release=4.0.0-alpha.7.4.29`;
- `status=RUNNING`, `phase=RUN_REVERSAL`;
- `recovery.mode=DURABLE_RAW_REVERSAL_CHUNK_RECOVERY`;
- `recovery.preservedPartialReversalRows=8` (либо фактическое уникальное
  количество на момент безопасной остановки);
- `recovery.remainingReversalRows=42` при сохранённых восьми строках;
- `recovery.aggregatePipelineStarted=false`;
- `triggerCount=1`.

В `lastStep.reversalWork` после bounded steps видны `completedRows`,
`totalRows=50` и `chunkRows=10`. После завершения RAW reversal Gate 6 сама
продолжит incremental Publish rollback, aggregate rollback, exact baseline
scan, restore и финальную проверку.

Не выполнять новый `Gate6Start`, не запускать canary/rollback вручную и не
включать user pipeline. При любом несовпадении exact boundary Resume
блокируется до физических записей.
