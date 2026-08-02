# Alpha.7.4.23 — bounded aggregate phases hotfix

> Актуализация `.24`: первый `.23` Resume обнаружил, что старый `.22` уже
> записал `STAGED` для всех 392 строк, но не сохранил operation checkpoint.
> Это точный lost-response after-state без publish intents и target mutation.
> Его отдельный exact recovery описан в
> `GATE6_STAGED_AFTER_STATE_RECOVERY_HOTFIX.md`; требование `.23` о статусе
> `CALCULATED` относится только к before-state и не должно применяться к
> подтверждённому after-state.

## Инцидент

Gate 6 execution `A74_GATE6_7F437567A3ABBFBE94F1` был безопасно остановлен
на canary operation `OP_SOURCE_FILE_LOAD_V_20260802T123451298Z_64F56FCB57D9`.
RAW commit, ordinary price Publish, aggregate impact, materialization и 392 из
392 aggregate calculations уже завершены. Следующая фаза
`STAGING_AGGREGATE_ROWS` каждый раз пыталась проверить весь staging одним
проходом и не имела durable cursor.

Причина повторения прежнего класса ошибок: bounded execution применялся к
отдельным уже обнаруженным узким местам, но не был обязательным
инвариантом всей aggregate operation. Малые static fixtures также не
доказывали соблюдение бюджета на больших weekly/monthly наборах.

## Обязательный контракт `.23`

Large aggregate operation больше не может использовать один неограниченный
проход. Для каждой тяжёлой фазы задан лимит одной порции и checkpoint cursor:

- materialization: 4 aggregate combinations;
- stage payload validation: 100 rows;
- publication: до 32 полных logical series с дополнительным уменьшением окна
  до atomic row/cell/request limits;
- latest verification: до 32 logical series;
- reconciliation: один сохранённый publication batch;
- stage status/finalization: 250 rows.

Материализация без bounded adapter разрешена только до восьми combinations;
более крупная попытка завершается fail-closed кодом
`AGGREGATE_MONOLITHIC_MATERIALIZATION_FORBIDDEN` до физической публикации.

Каждый publication batch имеет отдельный durable intent с before/after
fingerprints. После потерянного ответа повторный запуск классифицирует
`BEFORE`, `AFTER` или `THIRD_STATE`; запись повторяется только для `BEFORE`,
а `THIRD_STATE` остаётся fail-closed. Физические номера строк не являются
checkpoint identity.

## Exact recovery текущего Gate 6

Обычный `AKORT_alpha74Gate6Resume()` в `.23` имеет узкий allowlist для
остановленного `.22` checkpoint:

- Gate 6: `STOPPED`, исходная фаза `RUN_CANARY`;
- operation: `SOURCE_FILE_LOAD_V4`, `STAGING_AGGREGATE_ROWS`;
- calculation cursor равен calculation total и больше нуля;
- staging cursor равен нулю, stage fingerprint ещё не зафиксирован;
- все рассчитанные stage rows имеют статус `CALCULATED`;
- publish intents отсутствуют;
- обе recovery-копии доступны;
- regular и user pipelines выключены.

При совпадении контракта сохраняются execution ID, operation ID, load ID,
recovery-копии и все 392 рассчитанные строки. Не повторяются RAW commit,
ordinary price Publish, materialization или aggregate calculation. Продолжение
начинается с bounded validation `STAGING_AGGREGATE_ROWS`.

## Установка и продолжение

После публикации commit и `clasp push` выполнить в DEV Apps Script:

1. `AKORT_alpha74Install()`;
2. в `SYSTEM_SETTINGS` установить только
   `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE`; проверить, что
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE` и
   `PUBLISH_USER_PIPELINE_ENABLED=FALSE`;
3. `AKORT_alpha74SmokeTest()`;
4. `AKORT_alpha74ReadOnlyContractScan()`;
5. `AKORT_alpha74Gate6Status()` — должен быть сохранённый `STOPPED` execution;
6. один раз `AKORT_alpha74Gate6Resume()`;
7. далее только `AKORT_alpha74Gate6Status()`.

Не выполнять `Gate6Start`, `Gate6Install`, повторную Validate и
`Gate6RecoverRuntimeContext`; regular и user flags вручную не включать. Resume
сам проверит точный checkpoint, включит только regular aggregate pipeline и
оставит `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

Ожидаемый recovery mode:
`BOUNDED_AGGREGATE_PHASE_CHECKPOINT_RECOVERY`. В operation checkpoint должны
последовательно двигаться `stagingCursor`, `stageStatusCursor`,
`publishSeriesCursor`, `latestSeriesCursor`, `reconciliationBatchCursor` и
`finalizationCursor`.
