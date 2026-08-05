# Beta.1.3 r1 — Controlled failure injection

Package: `4.0.0-beta.1.3.1`
Contract: `4.0-beta13-failure-injection-1`
Base runtime: `4.0.0-alpha.7.4.42`
Base commit: `9620d87939fae952606c96357dd3368c66265ca4`

## Boundary

Beta.1.3 is implemented as a thin DEV-only facade over the accepted
`AKORT.OperationEngine` and `AKORT.TestOperationHandlers`.

It does not modify the Operation Engine or the Alpha.3 test handler. It does
not create a queue, executor, dispatcher, trigger, RAW path, Publish path or
aggregate path. Probe operation types use the existing accepted prefix:

`ALPHA3_TEST_BETA13_...`

The test handler only mutates the in-memory operation checkpoint supplied by
the Operation Engine. It does not write RAW, Publish, Drive files or
aggregates.

## Controlled scenarios

Five bounded scenarios are available:

1. `RETRYABLE_ONCE` fails at `VALIDATE` once with a retryable error. The first
   boundary is `RETRY_PENDING`; continuation must finish at `SUCCESS`.
2. `FATAL_RECOVERY` fails at `PARSE` once with `TEST_FATAL_ERROR`. Continuation
   uses `recoverFailedPhase` with the exact operation type, phase, error code
   and status, then resumes to `SUCCESS`.
3. `HANDLER_PAUSE` requests a safe pause after `STAGE`, then resumes from
   `COMMIT_RAW` to `SUCCESS`.
4. `SAFE_STOP` requests the accepted Operation Engine safe-stop before
   `DISCOVER`, then resumes to `SUCCESS`.
5. `DEAD_LETTER` fails retryably at `DISCOVER` until the configured limit of
   two attempts is exhausted. The terminal state must be `DEAD_LETTER`.

All phases after the injected boundary are still no-data test phases. Names
such as `COMMIT_RAW` and `UPDATE_PUBLISH` refer to the shared state machine;
the selected handler remains `TEST_ONLY`.

## Confirmation and idempotency

Preview is read-only. Its confirmation token binds:

- package and contract versions;
- accepted base release and commit;
- scenario and exact operation type;
- failure configuration and attempt limit;
- safe-stop flag;
- current data-plane sentinel fingerprint.

Start recomputes the plan immediately before enqueue. A token mismatch or
data-plane drift fails closed. The idempotency key is deterministic:

`BETA13_<SCENARIO>_<CONFIRMATION_TOKEN>`

A repeated start returns the exact existing operation and does not enqueue a
duplicate.

## Data-plane sentinel

The facade records a bounded sentinel for six DWH data sheets and four Publish
sheets. For each sheet it binds row and column counts, the header fingerprint,
and fingerprints of the first and last data rows.

The sentinel is checked after every start, continuation and status action.
This is intentionally a bounded operational sentinel, not a full-table digest.
The stronger guarantee comes from the reused test handler's no-data contract
and static prohibitions against RAW, Publish, aggregate, Drive and trigger
write APIs in the Beta.1.3 facade.

## Writes

Allowed writes are limited to the existing control plane:

- `OPERATION_QUEUE`;
- `OPERATION_STEPS`;
- `SYSTEM_LOG`;
- one script property storing the last `operation_id` per scenario.

Beta.1.3 does not write RAW, `RAW_LOAD_REGISTRY`, `RAW_REVERSAL_LOG`,
`AGGREGATE_STAGE`, Publish tables, Drive files, triggers or production
resources.

## Manual entry points

Each scenario has parameterless `Preview`, `Start`, `Continue` and `Status`
entry points so it can be executed safely from the Apps Script editor.
Only `Start` enqueues a probe. `Preview` and `Status` are read-only with respect
to the DWH and Publish data plane.

No entry point is executed by the installation package.
