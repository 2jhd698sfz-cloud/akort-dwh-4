# Alpha.7.4 Gate 5 pre-expansion descriptor dedup hotfix

## 1. DEV evidence

Release `4.0.0-alpha.7.4.14` successfully restored the preserved Gate 5
execution and committed ten durable aggregate-item preparation steps. It then
stopped making durable progress at this boundary:

```text
release / state schema = 4.0.0-alpha.7.4.14 / state-12
group / stage          = 2 / AGGREGATES
item phase             = SCAN_WEEKLY
source cursor / total  = 4500 / 13711
item count             = 960
replay item cursor     = 0
aggregate batch        = null
```

Three later trigger executions increased `workerExecutions` from 426 to 429,
but `steps=322`, `sourceCursor=4500` and `totalWorkerDurationMs=36752546`
did not change. Each invocation therefore exceeded the Apps Script hard
runtime inside the same source chunk before the checkpoint write.

## 2. Root cause

The durable scanner bounded physical input reads to 500 rows, but the work
inside a chunk was still content-dependent. Every category row was passed to
`v310ExpandAffectedTargets_()` before canonical aggregate combinations were
deduplicated. Many rows share the same aggregate impact identity. A December
weekly row also expands into forward and year-dependent periods, so one block
could create tens of thousands of temporary duplicate combinations.

Category identity is required for price-series replay, but it is not part of
an aggregate combination. The aggregate calculation is identified by:

```text
frequency, dataset_code, value_type, index_type, period
```

## 3. Hotfix contract

Release `4.0.0-alpha.7.4.15` adds a semantic compaction before dependency
expansion:

1. normalize the five aggregate descriptor fields;
2. remove duplicate descriptors within the current RAW chunk;
3. pass the compact descriptors to the unchanged production
   `v310ExpandAffectedTargets_()` planner;
4. apply the unchanged frozen full-build frontier;
5. canonicalize and idempotently append the resulting combinations.

Current versions:

```text
release                    = 4.0.0-alpha.7.4.15
Gate 5 version             = 4.0-alpha74-gate5-acceptance-13
state schema               = 4.0-alpha74-gate5-state-13
evidence schema            = 4.0-alpha74-gate5-evidence-13
aggregate item work schema = 4.0-alpha74-gate5-aggregate-items-work-1
```

The item work schema and inventory identity are intentionally unchanged. The
optimization changes temporary computation only; it does not change cache
columns, canonical combo keys, frontier semantics or economic output.

Static acceptance compares a 500-category December fixture against the
uncompacted production planner and requires exactly the same canonical combo
key set. It also proves that the 500 input rows become one aggregate descriptor
before expansion.

## 4. Recovery contract

`AKORT_alpha74Gate5ResumeReplay()` accepts a manually stopped
`.14 / state-12` checkpoint. It preserves:

- baseline canonical, live snapshot and completed full build;
- the existing sequential replay workbook;
- completed replay groups 0 and 1;
- all completed price work in group 2;
- `GATE5_AGGREGATE_ITEMS` with its existing 960 rows;
- `SCAN_WEEKLY` source cursor 4500.

Expected classifier:

```text
STOPPED_ALPHA7414_AGGREGATE_DESCRIPTOR_DEDUP_ADOPTION
```

Expected recovery mode remains:

```text
DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME
```

The first `.15` worker step rereads only the uncommitted source block starting
at cursor 4500. If `.14` appended any combinations before a lost response,
the existing canonical-key check turns them into an idempotent NOOP.

## 5. Safety boundary

- DataLens-connected DEV Publish remains read-only.
- All Gate 5 writes remain inside the preserved Test Files replay workbook.
- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` remains `FALSE`.
- Atomic limits, exact-duplicate repair, lost-response read-back and
  third-state fail-closed behavior are unchanged.
- No new full build or sequential replay workbook is created.

## 6. Deployment and resume

Before deployment, the `.14` worker must be stopped with:

```javascript
AKORT_alpha74Gate5Stop()
```

Confirm `STOPPED`, `triggerCount=0`, `aggregateItems.sourceCursor=4500` and
`aggregateItems.itemCount=960`. Then commit and publish `.15`, run
`clasp push`, and execute:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate5Status()
```

`Install` resets aggregate execution. Restore exactly:

```text
PUBLISH_AGGREGATE_EXECUTION_ENABLED = TRUE
PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED = FALSE
```

Run status again, then resume exactly once:

```javascript
AKORT_alpha74Gate5ResumeReplay()
```

Expected resumed state:

```text
release                         = 4.0.0-alpha.7.4.15
stateSchemaVersion              = 4.0-alpha74-gate5-state-13
status / phase                  = RUNNING / SEQUENTIAL_REPLAY
group / stage                   = 2 / AGGREGATES
aggregateItems.phase            = SCAN_WEEKLY
aggregateItems.sourceCursor     = 4500
aggregateItems.itemCount        = 960
recovery.mode                   = DURABLE_AGGREGATE_ITEM_PREPARATION_RESUME
performanceResumeMode           = STOPPED_ALPHA7414_AGGREGATE_DESCRIPTOR_DEDUP_ADOPTION
triggerCount                    = 1
```

Thereafter run only `AKORT_alpha74Gate5Status()`. Healthy progress is shown by
increasing `sourceCursor`, `steps`, `replayAggregateItemRowsScanned` and the
new `replayAggregateDescriptorsExpanded` metric. Do not invoke Start, Resume
or Worker again while the trigger is active.
