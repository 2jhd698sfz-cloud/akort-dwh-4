# Alpha.7.4 Gate 5 durable aggregate-item preparation hotfix

## 1. Incident

Release `4.0.0-alpha.7.4.13` successfully completed `WEEKLY`, `MONTHLY` and
`INDUSTRY` for replay group 2, but could not create the first aggregate batch.

The stopped DEV checkpoint is:

```text
release                  = 4.0.0-alpha.7.4.13
state schema             = 4.0-alpha74-gate5-state-11
status / phase           = STOPPED / STOPPED
failureCode              = STOPPED_MANUALLY
groupIndex / groupCount  = 2 / 12
stage                    = AGGREGATES
itemCursor               = 0
aggregateSeriesCursor    = 0
aggregateBatch           = null
triggerCount             = 0
```

Before the manual stop, 29 consecutive trigger executions increased
`workerExecutions` from 393 to 422 while `steps=312`, every replay cursor and
`totalWorkerDurationMs=36393512` remained unchanged. Each execution saved its
start marker and then exceeded the Apps Script hard execution limit inside the
monolithic `replayItems()` call. The platform termination occurred before the
worker catch/checkpoint boundary, therefore `lastError` remained `null`.

## 2. Root cause

At the beginning of every aggregate replay step the old implementation:

1. read complete weekly and monthly RAW sheets;
2. selected rows for the current load;
3. expanded all affected targets through `v310ExpandAffectedTargets_()`;
4. filtered all combinations by the frozen frontier;
5. returned one in-memory array;
6. only after that could save the first durable aggregate batch.

The third replay group crossed the execution-time boundary before step 6.
Increasing the worker budget would not solve this because Apps Script enforces
its own hard runtime limit.

## 3. Hotfix contract

Release `4.0.0-alpha.7.4.14` replaces only aggregate item-list preparation.
Price replay, aggregate calculation, adaptive publication and reconciliation
contracts remain unchanged.

New versions:

```text
release                    = 4.0.0-alpha.7.4.14
Gate 5 version             = 4.0-alpha74-gate5-acceptance-12
state schema               = 4.0-alpha74-gate5-state-12
evidence schema            = 4.0-alpha74-gate5-evidence-12
aggregate item work schema = 4.0-alpha74-gate5-aggregate-items-work-1
aggregate batch work       = 4.0-alpha74-gate5-aggregate-work-1
```

The isolated sequential replay workbook receives the auxiliary sheet:

```text
GATE5_AGGREGATE_ITEMS
```

Its exact columns are:

```text
inventory_id, item_no, combo_key, frequency, dataset_code,
value_type, index_type, period
```

Preparation phases:

```text
INITIALIZE
  -> SCAN_WEEKLY
  -> SCAN_MONTHLY
  -> SCAN_REVERSAL
  -> FINALIZE
  -> READY
```

Weekly RAW, monthly RAW and reversal log are scanned in blocks of 500 physical
rows. Phase, source cursor, source row count and accumulated item count are
stored after every completed step. Up to 12 bounded steps may run inside one
worker execution, but every step is independently recoverable.

## 4. Exactness and lost-response behavior

- Combination semantics still come from production
  `v310ExpandAffectedTargets_()`.
- The frozen full-build frontier is applied to every produced combination.
- `combo_key` is canonical and duplicate combinations across RAW chunks are
  ignored.
- A repeated chunk after lost response reads existing keys and becomes an
  idempotent append/NOOP before moving the cursor.
- `FINALIZE` sorts the complete inventory by canonical `combo_key`, rewrites
  contiguous `item_no` values and stores an SHA-256 fingerprint.
- Publication reads only the finalized fingerprinted inventory; it no longer
  invokes the monolithic aggregate `replayItems()` path.
- Cache identity includes replay workbook, group index, load, accepted/reversed
  load context and frontier hash, but excludes execution ID. A recovery
  execution therefore reuses the exact same logical inventory.
- Cache count, sequence, key/payload agreement and fingerprint are checked
  fail-closed.

The existing safety boundary is unchanged:

- all writes target only an isolated workbook in canonical `Test Files`;
- DataLens-connected DEV Publish remains read-only;
- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` remains `FALSE`;
- atomic limits remain 5,000 rows / 100,000 cells / 500 requests;
- lost-response recovery, exact-duplicate repair, unique read-back and
  third-state fail-closed behavior remain active.

## 5. Recovery of the current checkpoint

`AKORT_alpha74Gate5ResumeReplay()` accepts the manually stopped
`.13 / state-11` logical boundary without calling the old monolithic item
builder during preflight. Item-total validation is deliberately deferred to
the new durable scanner because `itemCursor=0`, `aggregateBatch=null` and no
publication has started for group 2.

Expected recovery mode:

```text
DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME
```

The following are preserved:

- baseline canonical copy;
- live Publish snapshot;
- completed full build;
- existing sequential replay workbook;
- 18,482 already replayed price rows;
- completed groups 0 and 1;
- group 2 price stages;
- group 2 aggregate boundary at cursor 0.

No new full build, replay workbook or repetition of groups 0–1 is allowed.

If `.14` is stopped during `SCAN_WEEKLY`, `SCAN_MONTHLY`, `SCAN_REVERSAL` or
`FINALIZE`, the item cache and exact source cursor are preserved. A later
`.14` resume continues from `DURABLE_ITEM_PREPARATION`. If it is stopped while
publishing a prepared aggregate batch, both the finalized item inventory and
the batch series cursor are preserved, so neither input scanning nor completed
atomic publication windows are repeated.

## 6. New status and evidence fields

Status includes `aggregateItems`:

```text
workSchemaVersion
inventoryId
loadId
groupIndex
phase
sourceCursor
sourceTotal
chunkRows
itemCount
ready
fingerprint
```

New metrics:

- `replayAggregateItemPreparationSteps`;
- `replayAggregateItemRowsScanned`;
- `replayAggregateItemAffectedRows`;
- `replayAggregateItemsAdded`;
- `replayAggregateItemInventoriesPrepared`;
- `replayAggregateItemPreparationRecoveryAdoptions`.

Healthy progress during preparation is confirmed by changing
`aggregateItems.phase` or `aggregateItems.sourceCursor`, increasing
`replayAggregateItemRowsScanned`, and increasing the global `steps` counter.

## 7. DEV deployment and resume runbook

The current `.13` worker is already stopped and its trigger is removed. Do not
run another Stop, Start, RestartReplay or Worker before deployment.

After publishing the commit and running `clasp push`, execute:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate5Status()
```

`Install` resets the execution flag. Set exactly:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Run status again and verify:

```text
release                         = 4.0.0-alpha.7.4.14
ready                           = true
saved state.release             = 4.0.0-alpha.7.4.13
saved state.status              = STOPPED
saved state.replay.groupIndex   = 2
saved state.replay.stage        = AGGREGATES
saved state.replay.itemCursor   = 0
saved state.aggregateBatch      = null
saved state.triggerCount        = 0
```

Resume exactly once:

```javascript
AKORT_alpha74Gate5ResumeReplay()
```

Expected result:

```text
release                    = 4.0.0-alpha.7.4.14
stateSchemaVersion         = 4.0-alpha74-gate5-state-12
status                     = RUNNING
phase                      = SEQUENTIAL_REPLAY
groupIndex                 = 2
stage                      = AGGREGATES
itemCursor                 = 0
recovery.mode              = DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME
triggerCount               = 1
```

Thereafter run only:

```javascript
AKORT_alpha74Gate5Status()
```

Do not run `AKORT_alpha74Gate5Start()` because it would create a new full
acceptance execution. Do not run `AKORT_alpha74Gate5Worker()` manually because
the persistent trigger owns continuation.
