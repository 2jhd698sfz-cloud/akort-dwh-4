# Beta.1.2 r5 — Source-Provenance Safety Patch

Package: `4.0.0-beta.1.2.5`
Contract: `4.0-beta12-rollback-facade-4`
Base runtime: `4.0.0-alpha.7.4.42`
Base commit: `ad27642024690546b16a2b33fa4d3ba8d5dfb8ee`

## Boundary

This package adds one operational facade over the accepted
`RAW_REVERSAL_V4` data plane. It does not create a second queue, executor,
dispatcher, RAW schema, Publish schema, aggregate schema or trigger.

RAW reversal, durable reversal logging, Publish replacement, aggregate
recalculation, latest recalculation and quick audit remain owned by the
existing Operation Engine, Raw Store, Incremental Publish and Aggregate
Integration modules.

## Preview

`AKORT_beta12RollbackPreview(targetLoadId, reason)` is read-only. It:

- requires a normalized reason of 12–500 characters;
- requires a committed load with physical RAW observations;
- applies the accepted `LATEST_LOAD_ONLY` lineage rule;
- blocks any existing reversal record or active reversal operation;
- blocks accepted Gate and compatibility-test evidence loads;
- requires the source operation referenced by `RAW_LOAD_REGISTRY.operation_id`;
- requires that source operation to be unique and `SUCCESS`;
- blocks reversal-generated loads;
- inspects the source operation checkpoint, input and idempotency key for
  Gate/test provenance markers;
- fails closed when a relevant operation checkpoint is invalid;
- calculates restored predecessors and dependency impact;
- returns deterministic lineage, impact and reason fingerprints;
- returns a confirmation token bound to the exact preview.

Preview does not enqueue an operation, write a reversal record, change
Publish, change aggregates or persist logs.

## Submit and idempotency

`AKORT_beta12RollbackSubmit(targetLoadId, reason, confirmationToken)` first
looks for the exact existing idempotent operation. A match requires the same:

- idempotency key;
- confirmation token;
- target `load_id`;
- normalized reason hash;
- source-operation provenance fingerprint.

The confirmation token itself is also bound to the source-operation
fingerprint. Any change to the source operation, its checkpoint, input,
idempotency key or relevant source metadata invalidates the token before
enqueue.

A duplicate idempotency row or any identity mismatch fails closed. An exact
active operation is continued through the existing Operation Engine. An exact
successful operation is returned without replaying completed phases.

For a new operation, submit rebuilds the preview and checks the token before
calling `OperationEngine.enqueue`. A second existing-operation lookup closes
the race in which another identical request is queued while eligibility is
being revalidated.

Terminal failure is returned as failure, never as success. A resumable
operation is returned as `PAUSED`.

## Compact status

`AKORT_beta12RollbackStatus(operationId)` reads `OPERATION_QUEUE`,
`RAW_LOAD_REGISTRY` and `RAW_REVERSAL_LOG`. It does not return or scan
`OPERATION_STEPS`, avoiding oversized routine logs.

## Safety

The facade is DEV-only. It does not enable the general user pipeline, touch
production, select a load automatically, create a trigger or start a rollback
without an explicit confirmation token.
