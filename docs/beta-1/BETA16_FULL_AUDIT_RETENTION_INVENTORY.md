# Beta.1.6 r1 — Full Audit and retention inventory

Package: `4.0.0-beta.1.6.1`  
Contract: `4.0-beta16-full-audit-retention-inventory-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `86f8aa96fd6034bbf657e7159d3985066b67dbc6`

## Normative requirement

Beta.1.6 must provide one resumable Full Audit operation, durable audit
evidence and a retention dry-run. It must protect accepted releases, Gate
evidence, the verified baseline, required paired backups and active durable
checkpoints. Physical deletion is outside Beta.1.6 and remains forbidden.

## Accepted reuse

The implementation must reuse:

- `AKORT.OperationEngine` for queueing, bounded phase execution, checkpoints,
  safe stop, resume and exact failed-phase recovery;
- the existing `QUICK_AUDIT` operation phase;
- `RAW_LOAD_REGISTRY`, `PUBLISH_RECONCILIATION`, `SYSTEM_LOG`,
  `DATASET_STATUS` and `ISSUE_REGISTRY`;
- `BACKUP_REGISTRY` from Beta.1.1;
- operational classification from Beta.1.4;
- compact status from Beta.1.5;
- accepted Gate 7 evidence and baseline identifiers.

No second queue, executor, dispatcher, reconciliation engine or backup engine
may be introduced.

## Exact remaining gap

1. No `FULL_AUDIT_V4` handler is registered.
2. Existing checks are not orchestrated as one resumable operation.
3. No durable `FULL_AUDIT_EVIDENCE` read model exists.
4. No `RETENTION_REGISTRY` or deterministic protection policy exists.
5. No dry-run planner classifies protected, retained and candidate artifacts.
6. No narrow submit, status and evidence facade exists.

## Inventory boundary

This r1 package is read-only. It reads headers, row counts and at most 25 tail
rows from accepted service registries. It does not scan physical RAW or Publish
targets, enumerate Drive folders, create operations, create tables, create
triggers, write evidence or delete artifacts.

## Next implementation unit

After live inventory acceptance, r2 should add only:

- one `FULL_AUDIT_V4` handler delegated to the existing Operation Engine;
- one durable `FULL_AUDIT_EVIDENCE` table;
- one `RETENTION_REGISTRY` containing dry-run classifications only;
- explicit protected-artifact rules;
- narrow contract, preflight, submit, status and evidence APIs.

The retention planner must always emit `dry_run=true`; no delete API or
`DriveApp.*.setTrashed` call is permitted.
