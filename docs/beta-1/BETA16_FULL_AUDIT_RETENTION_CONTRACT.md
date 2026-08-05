# Beta.1.6 Full Audit and retention dry-run

Beta.1.6 r2 closes the operational gap recorded by the accepted r1 inventory. It adds one `FULL_AUDIT_V4` handler to the accepted `AKORT.OperationEngine`; there is no second queue, executor, dispatcher or trigger.

## Full Audit

The operation uses the existing durable phase and checkpoint contract. Every invocation may resume from `checkpoint.handlerState.beta16FullAudit`. The handler reads at most 25 tail rows from each accepted service registry and never reads physical RAW or Publish targets.

The audit validates the accepted runtime, service schemas, compact observability, Gate 7 acceptance evidence, latest reconciliation, latest successful paired backup, operation quiescence and the control-plane write boundary. Results are materialized in `FULL_AUDIT_EVIDENCE` with deterministic fingerprints and a compact checks payload.

Failed checks are written to durable evidence before the operation stops with `requiresReview=true`. A healthy audit reaches Operation Engine `SUCCESS`.

## Retention

Retention is permanently constrained to planning in Beta.1.6:

- every row has `dry_run=1`;
- every row has `physical_deletion=0`;
- no Drive file enumeration is performed;
- no delete, trash or purge API exists;
- old unprotected backups are marked only as `REVIEW_FOR_RETENTION`;
- accepted releases, Gate evidence, verified baseline, the latest successful paired backups, active checkpoints and the latest successful Full Audit remain protected.

`RETENTION_REGISTRY` is a bounded current-plan read model. Re-running an audit replaces the prior plan rather than accumulating an unbounded registry.

## Safety boundary

The general user pipeline remains disabled. Production is untouched. Beta.1.6 creates no trigger and performs no data-plane write. `FULL_AUDIT_V4` is classified by Beta.1.4 as snapshot-exclusive so it cannot overlap a paired backup or data-plane operation.


## Schema ownership correction

The Full Audit adapter resolves `RAW_LOAD_REGISTRY` from the accepted RawStore schema and `PUBLISH_RECONCILIATION` from the accepted Incremental Publish schema. These registries are not added to `AKORT.Core.Tables`; preflight and runtime validation preserve their established module ownership.
