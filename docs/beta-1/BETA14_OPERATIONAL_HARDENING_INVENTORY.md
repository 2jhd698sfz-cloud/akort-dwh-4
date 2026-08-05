# Beta.1.4 r1 — Operational hardening inventory

Package: `4.0.0-beta.1.4.1`  
Contract: `4.0-beta14-operational-inventory-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `1055d39229213e17b93faeced44dce57ea55346c`

## Purpose

This package is the read-only inventory step for Beta.1.4. It establishes the
exact runtime surface that the operational-hardening implementation must close:

- trigger ownership;
- duplicate or stale triggers;
- stale operation classification;
- normalized `next_action`;
- incompatible write-operation overlap.

It does not install a registry, create or delete a trigger, modify an operation,
resume an operation, stop an operation, or write to RAW, Publish or Drive.

## Accepted components reused

Beta.1.4 must remain a control layer around the accepted components:

- `OPERATION_QUEUE`;
- `OPERATION_STEPS`;
- `AKORT.OperationEngine`;
- operation checkpoint leases;
- `requestStop`;
- `resume`;
- exact failed-phase recovery.

A second queue, executor, dispatcher, scheduler or data pipeline is forbidden.

## Trigger-owner inventory

The inventory recognizes five current process owners:

1. Beta.1.1 daily paired backup — exactly one persistent trigger.
2. Beta.1.1 backup worker — zero or one conditional trigger.
3. Alpha.6 reconciliation dispatcher — zero triggers after its accepted work is closed or dormant.
4. Alpha.7.4 Gate 6 worker — zero triggers because Gate 6 is closed.
5. Alpha.7.4 Gate 7 runner — zero triggers because Gate 7 is accepted and closed.

Any observed handler not mapped to a declared process is classified as
`UNREGISTERED_TRIGGER_OWNER`. Multiple trigger instances for one process are
classified as duplicate ownership.

## Operation classification

The inventory reads `OPERATION_QUEUE` and the durable checkpoint only. It
classifies queued, running, paused, retry-pending and terminal operations using
the accepted lease and checkpoint state.

The normalized actions are deliberately conservative. Read-only inventory may
recommend an action, but it never executes the action.

## Write-conflict inventory

Non-terminal snapshot and data-plane operations are grouped into compatibility
classes. Control-plane test operations are not treated as data-plane writers.

The implementation package must expose one shared `assertCanStart` guard for
future user-facing operation facades. It must not alter accepted methodology or
introduce another executor.

## Next package

After the inventory is accepted, the implementation package will add:

- `TRIGGER_OWNERSHIP_REGISTRY`;
- a thin Beta.1.4 operational-hardening facade;
- bounded registry refresh;
- normalized watchdog status;
- a shared write-conflict guard.

The implementation remains DEV-only. The user pipeline stays disabled and
production remains untouched.
