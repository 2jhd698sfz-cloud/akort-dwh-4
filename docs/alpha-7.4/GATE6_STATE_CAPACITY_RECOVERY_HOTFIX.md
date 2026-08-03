# Alpha.7.4.30 — Gate 6 rollback-scan state capacity recovery

## Подтверждённый incident

После успешного `.29` `RAW_REVERSAL_V4` Gate 6 перешёл в `ROLLBACK_SCAN`.
Контрольные digest `PUBLISH_PRICES_WEEKLY` и `PUBLISH_PRICES_MONTHLY` точно
совпали с baseline. Перед первым checkpoint `PUBLISH_INDUSTRY` состояние
осталось:

- `status=RUNNING`;
- `phase=ROLLBACK_SCAN`;
- `scan.targetIndex=2`;
- `operations.restore` пуст;
- reversal operation имеет terminal `SUCCESS`;
- regular pipeline был выключен fail-closed;
- worker trigger отсутствовал.

`PUBLISH_INDUSTRY` и его схема не повреждены. Его 23 заголовка совпадают с
экспортированным контрактом `AKORT.IncrementalPublish.PublishHeaders`.

## Причина

Каждая точечная recovery добавляла полный предыдущий объект в
`recovery.previousRecovery`. К `.29` вложенная audit-история вместе с
`ROLLBACK_SCAN` accumulator превысила безопасный лимит 8 500 байт одного
значения Script Properties.

Первый `saveState_` завершился `ALPHA74_GATE6_STATE_TOO_LARGE`. Fail-closed
успел выключить regular pipeline, но попытался сохранить тот же слишком
большой state и не зафиксировал terminal `FAILED`. Поэтому внешний state
остался `RUNNING`, хотя trigger уже отсутствовал.

## Исправление `.30`

- полный `previousRecovery` преобразуется в bounded
  `previousRecoveryLineage` из компактных audit-записей;
- текущий recovery сохраняет все поля, необходимые для exact continuation;
- `saveState_` выполняет compaction перед каждым checkpoint;
- terminal fail-closed state сохраняется до удаления trigger;
- ошибка cleanup trigger больше не может оставить state в `RUNNING`;
- при аварийном переполнении незавершённый read-only scan target может быть
  начат заново без data-plane повторов;
- добавлен exact allowlist текущего `.29 / STOPPED / ROLLBACK_SCAN` incident.

Recovery не повторяет canary, RAW reversal, Weekly rollback или Monthly
rollback. После Resume заново начинается только незавершённый read-only scan
`PUBLISH_INDUSTRY`, затем проверяется `PUBLISH_PRICE_AGGREGATES`.

## Обязательная последовательность

1. На `.29` один раз выполнить `AKORT_alpha74Gate6Stop()`.
2. Подтвердить `STOPPED / stoppedFromPhase=ROLLBACK_SCAN`,
   `operationStopRequested=true` и отсутствие Restore operation.
3. Опубликовать `.30` и выполнить `clasp push`.
4. Выполнить общий `AKORT_alpha74Install()`.
5. Выполнить smoke test, read-only contract scan и Gate 6 Status.
6. Один раз выполнить `AKORT_alpha74Gate6Resume()`.
7. Далее использовать только `AKORT_alpha74Gate6Status()`.

Ожидаемый recovery mode:
`ROLLBACK_SCAN_STATE_CAPACITY_RECOVERY`.

Новый `Gate6Start`, повторная Validate, ручной worker, Industry Submit и
другие загрузки запрещены до terminal Gate 6 `SUCCESS`.
