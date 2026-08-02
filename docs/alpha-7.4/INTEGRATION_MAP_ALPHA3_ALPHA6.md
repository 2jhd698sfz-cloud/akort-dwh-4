# Alpha.7.4 — Integration Map Alpha.3–Alpha.6

## 1. Архитектурное решение

Alpha.7.4 расширяет существующую операцию `SOURCE_FILE_LOAD_V4` / `RAW_LOAD_V4` / `RAW_REVERSAL_V4`.

Она не создаёт второй execution engine.

```text
DISCOVER
→ VALIDATE
→ PARSE
→ STAGE
→ COMMIT_RAW
→ UPDATE_PUBLISH
→ PREPARING_AGGREGATE_IMPACT
→ MATERIALIZING_AGGREGATE_INPUTS
→ CALCULATING_AGGREGATE_SLICES
→ STAGING_AGGREGATE_ROWS
→ UPDATING_AGGREGATES
→ UPDATING_AGGREGATE_LATEST
→ RECONCILING_AGGREGATES
→ UPDATE_STATUS
→ QUICK_AUDIT
→ FINALIZING
→ SUCCESS
```

## 2. Source-level reuse inventory

| Слой | Существующий API / состояние | Решение Alpha.7.4 |
|---|---|---|
| `src/01_Config.js` | `AKORT.Config.load()`, `resources.dwhSpreadsheetId`, `resources.publishSpreadsheetId` | Использовать текущие canonical resource keys. Не вводить `dwhTechSpreadsheetId` или `controlSpreadsheetId`. Добавить только отдельный optional artifact folder key, если immutable input artifacts нельзя безопасно хранить в DWH stage. |
| `src/02_Core.js` | `AKORT.Core.safeRun`, `AKORT.Core.error`, `AKORT.Core.sha256`, canonical JSON, locks, sheet helpers, logging, manifest hash | Использовать без отдельного safety/runtime слоя. Все ошибки Alpha.7.4 проходят через существующий error/result/log contract. |
| `src/03_OperationEngine.js` | `OPERATION_QUEUE`, `OPERATION_STEPS`, `enqueue`, `run`, `resume`, `requestStop`, lease, execution budget, retry/dead-letter, checkpoints | Расширить одну state machine. Добавить aggregate phases и checkpoint schema `4.0-operation-2`. Не создавать global `active_run` и второй dispatcher. |
| `src/05_RawStore.js` | `commitLoad`, `reverseLoad`, `auditLoad`; handler state сохраняет `loadId` и reversal evidence | Использовать `load_id` как корень lineage. Reversal запускает обычный `RAW_REVERSAL_V4` и проходит тот же aggregate dependency pipeline. |
| `src/06_ExistingSourceParsers.js` | `SOURCE_FILE_LOAD_V4`; parser → RAW → Publish; `handlerState.publishPlanSummary` | Сохранить текущую загрузку файлов. После `UPDATE_PUBLISH` передавать authoritative operation/load context в aggregate integration phases. |
| `src/07_IncrementalPublish.js` | `planLoad`, `planReversal`, `planFromAffected`, `summarizePlan`, `appendImpact`, `applyPublish`; `PUBLISH_IMPACT`, `PUBLISH_RUNS`, reconciliation infrastructure | Alpha.6 остаётся единственным источником первичного impact. `applyAggregates` перестаёт создавать `DEFERRED_TO_ALPHA7` и становится входом в интегрированные phases. Не копировать Alpha.6 private implementation целиком; вынести минимальные reusable adapters при необходимости. |
| `src/13_Alpha71AggregateContract.js` | 29-колоночный Publish contract, `aggregate_series_key`, `aggregate_row_key`, period/frontier/weight/membership semantics | Frozen identity и output schema. Любая строка staging и Publish обязана проходить этот контракт. |
| `src/15_Alpha72AggregateCalculator.js` | Pure `calculateBatch`, deterministic fingerprints, coverage и publication rules | Единственный calculator. Никакого I/O и скрытых формул вне Alpha.7.2. |
| `src/18_Alpha73SpecialAggregateDefinitions.js` | Versioned definitions и memberships | Единственный источник frozen special aggregate definitions. |
| `src/19_Alpha73RevisionPlanner.js` | `planRevision`, `planReversal`, `buildLatestIntents`, plan fingerprint | Единственный planner для new period, revision и reversal. |
| `src/08_EntryPoints.js` | Технические Alpha entry points | Добавить только status/install/test entry points. Рабочее выполнение идёт через Operation Engine, не через отдельный manual executor. Hardcoded write probe должен быть удалён или закрыт EnvironmentGuard до live gate. |

## 3. Повторно используемые таблицы

| Таблица | Роль |
|---|---|
| `OPERATION_QUEUE` | Единственное текущее состояние операции |
| `OPERATION_STEPS` | История завершённых фаз и ошибок |
| `RAW_*`, `RAW_LOAD_REGISTRY`, `RAW_REVERSAL_LOG` | Authoritative source history и reversal lineage |
| `PUBLISH_IMPACT` | Authoritative первичный impact Alpha.6 |
| `PUBLISH_RUNS` | Единый журнал non-aggregate и aggregate publish |
| `PUBLISH_RECONCILIATION` | Сводные результаты reconciliation |
| `SYSTEM_SETTINGS` | Feature flags, schema version и лимиты |
| `SYSTEM_LOG` | Операционная диагностика |

Alpha.7.4 добавляет только `AGGREGATE_STAGE`.

`AGGREGATE_STAGE` — durable staging результата, но не очередь и не execution engine.

Минимальный контракт:

```text
operation_id
load_id
plan_id
plan_fingerprint
calculation_id
aggregate_series_key
aggregate_row_key
period_start
action
row_payload_json
row_fingerprint
expected_target_fingerprint
stage_status
created_at
verified_at
release_version
```

Запрещено хранить физический номер строки.

## 4. Authoritative data flow

1. `RawStore.commitLoad` или `RawStore.reverseLoad` фиксирует logical source state.
2. `IncrementalPublish.planLoad/planReversal` строит первичный impact.
3. `IncrementalPublish.appendImpact` сохраняет его в `PUBLISH_IMPACT`.
4. Aggregate integration читает impact только для текущих `operation_id + load_id`.
5. Alpha.7.3 расширяет impact до aggregate definitions, memberships, dependent periods и latest intents.
6. Alpha.7.2 рассчитывает bounded deterministic batches.
7. Alpha.7.4.23 применяет тот же обязательный bounded-work принцип ко всем
   следующим тяжёлым фазам: materialization, stage validation/status,
   logical-series publication, latest, reconciliation и finalization.
8. Alpha.7.4.24 распознаёт только точный lost-response boundary между
   завершённой записью `STAGED` и ещё не созданным publish intent, проверяет
   immutable stage snapshot и возвращает operation в bounded execution.
9. Полный ожидаемый affected-set сохраняется в `AGGREGATE_STAGE`.
10. Publish adapter заменяет логические агрегатные серии в `PUBLISH_PRICE_AGGREGATES`.
11. Read-back подтверждает keys, hashes, latest и отсутствие изменений вне affected-set.
12. Reconciliation разрешает переход к `UPDATE_STATUS`, `QUICK_AUDIT`, `FINALIZING`, `SUCCESS`.

## 5. Checkpoint ownership

Вся durable progress-информация хранится в `OPERATION_QUEUE.checkpoint_json`:

```text
aggregate.schema_version
aggregate.phase
aggregate.plan_id
aggregate.plan_fingerprint
aggregate.definition_fingerprint
aggregate.weight_snapshot_id/hash
aggregate.membership_snapshot_id/hash
aggregate.input_artifact_id/hash
aggregate.cursor
aggregate.batch_no
aggregate.rows_read
aggregate.rows_calculated
aggregate.rows_staged
aggregate.rows_written
aggregate.affected_series_hash
aggregate.expected_stage_hash
aggregate.target_before_hash
aggregate.target_after_hash
aggregate.reconciliation_hash
aggregate.completed_at
```

Checkpoint обновляется только после durable write и подтверждённого read-back соответствующего batch.

## 6. Migration

- Новый operation schema: `4.0-operation-2`.
- Перед установкой не должно быть non-terminal операций.
- Зависшая тестовая операция должна быть закрыта отдельным административным действием до schema migration.
- Existing terminal operations остаются историческими и не переписываются.
- Alpha.6 feature flags остаются включёнными.
- Aggregate physical execution остаётся `FALSE` до isolated live-write gate.
