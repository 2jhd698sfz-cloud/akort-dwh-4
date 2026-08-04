# Beta.1.2 r1 — Arbitrary Rollback Inventory

Package: `4.0.0-beta.1.2.1`  
Contract: `4.0-beta12-rollback-inventory-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `05e5b473d3867b6519472f265b20554b9bbe4040`

## Decision

Beta.1.2 does not need a new rollback engine. The accepted
`RAW_REVERSAL_V4` operation already performs bounded RAW reversal, durable
reversal logging, Publish replacement, aggregate recalculation, latest
recalculation and quick audit through the single accepted Operation Engine.

The missing unit is an operational facade for an arbitrary selected
`load_id`.

## Accepted reuse

- `AKORT.RawStore`: `RAW_LOAD_REGISTRY`, `RAW_REVERSAL_LOG`,
  `reverseLoadStep`, `inspectReversal`, `reversalSnapshot`, `auditLoad`.
- `AKORT.RawStoreHandlers`: the only `RAW_REVERSAL_V4` executor.
- `AKORT.OperationEngine`: enqueue, deterministic idempotency, run, resume,
  status, retry, lease, safe checkpoints and failed-phase recovery.
- `AKORT.IncrementalPublish` and `AKORT.AggregateIntegration`: accepted
  reversal dependency processing, physical publication, latest update and
  reconciliation.

No second queue, executor, RAW/Publish path or aggregate dispatcher is
permitted.

## Exact gaps

1. No normalized eligibility result for an arbitrary `load_id`.
2. No pre-submit read-only impact preview.
3. The low-level handler accepts a default reason; the operator facade must
   require a real reason.
4. No confirmation token binds load lineage, preview and reason.
5. No deterministic public submit facade over `RAW_REVERSAL_V4`.
6. No compact terminal rollback evidence; raw Operation Engine status is too
   large for routine use.

## Eligibility boundary

The accepted policy remains `LATEST_LOAD_ONLY`. A new rollback may target only
a committed load with physical RAW rows and no later active revision for any
affected business key. Missing, empty, non-committed, reversing, already
reversed and superseded loads must be classified explicitly and fail closed.

An already reversing load must route to its existing operation. An already
reversed load must never create another reversal; when a deterministic
Beta.1.2 operation exists, the facade may return its terminal evidence.

## Confirmation boundary

Preview performs no writes. It returns a deterministic binding over the target
load identity, lineage, affected rows and dependency impact plus a hash of the
normalized reason. Submit must rebuild that binding and reject any drift before
calling `OperationEngine.enqueue`.

The Operation Engine idempotency key is derived from the confirmed binding, so
repeated submit returns the same operation rather than creating a duplicate.

## Planned API

- `AKORT_beta12RollbackPreview(targetLoadId, reason)`
- `AKORT_beta12RollbackSubmit(targetLoadId, reason, confirmationToken)`
- `AKORT_beta12RollbackStatus(operationId)`

These are DEV operational functions. They do not enable the general user
pipeline and do not deploy to production.

## Acceptance

A controlled eligible DEV load must complete:

`preview → reason/token confirmation → RAW_REVERSAL_V4 → Publish → aggregates
→ latest → quick audit → compact evidence`.

A repeated submit must return the same `operation_id`. Preview and rejected
submission must produce zero writes. Production remains untouched.
