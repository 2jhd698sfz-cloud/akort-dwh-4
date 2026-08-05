# Beta.1.4 r2 — Operational hardening

Package: `4.0.0-beta.1.4.2`  
Contract: `4.0-beta14-operational-hardening-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `a32bdf1ddbb4975a1f905825c745c9004c6324fe`

## Scope

Beta.1.4 adds one control-plane service table and one thin facade around the
accepted Operation Engine. It does not change the state machine, operation
phases, queue schema, retry behavior, recovery behavior or data methodology.

The implementation closes four gaps confirmed by the accepted r1 inventory:

- trigger ownership is materialized;
- stale-operation classification is shared;
- `next_action` values are normalized;
- incompatible write starts are blocked by one shared guard.

## Trigger ownership

`TRIGGER_OWNERSHIP_REGISTRY` contains one bounded row for each declared process
and one additional row for each unregistered handler, if any.

The registry records:

- the owning module and handler;
- lifecycle expectations;
- minimum and maximum trigger counts;
- observed trigger IDs and trigger types;
- status and normalized action;
- one deterministic snapshot fingerprint.

Beta.1.4 creates no trigger and deletes no trigger. Registry refresh is an
explicit bounded operation.

## Operation watchdog

The watchdog reads `OPERATION_QUEUE` and durable checkpoints. It classifies:

- queued operations;
- active or lease-expired running operations;
- paused checkpoints;
- retry-pending operations;
- failed, review-required and dead-letter states.

The watchdog never resumes, stops or recovers an operation automatically.
Those actions remain owned by the accepted Operation Engine.

## Shared start guard

The guard groups operations into three classes:

- `SNAPSHOT_EXCLUSIVE`;
- `DATA_PLANE_EXCLUSIVE`;
- `CONTROL_PLANE_TEST`.

A snapshot cannot start while another snapshot or data-plane operation has a
non-terminal reservation. A data-plane operation cannot start while another
snapshot or data-plane operation has a non-terminal reservation. Test-only
control-plane operations remain isolated from the data plane.

The guard is connected to the accepted Beta.1.1 paired-backup facade and the
accepted Beta.1.2 rollback facade. It delegates the actual enqueue to
`AKORT.OperationEngine.enqueue`.

A short-lived Script Properties reservation closes the interval between the
read-only conflict check and the accepted enqueue lock. It is not a queue,
executor, dispatcher or scheduler. It is automatically released and expires
fail-safe after three minutes if an invocation terminates unexpectedly.

## Installation sequence

1. Run `AKORT_beta14HardeningContract`.
2. Run `AKORT_beta14HardeningPreflight`.
3. Run `AKORT_beta14HardeningInstall`.
4. Run `AKORT_beta14HardeningStatus`.

`AKORT_beta14HardeningRefresh` is the explicit bounded registry refresh API.

## Safety boundary

- DEV only;
- general user pipeline remains disabled;
- production is untouched;
- no RAW or Publish write;
- no new trigger;
- no trigger deletion;
- no second queue, executor or dispatcher;
- no automatic operation recovery.
