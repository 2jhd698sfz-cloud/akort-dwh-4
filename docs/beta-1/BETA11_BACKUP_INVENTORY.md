# Beta.1.1 — paired backup inventory

Package: `4.0.0-beta.1.1.1`  
Accepted runtime base: `4.0.0-alpha.7.4.42`  
Accepted Beta.1.0 commit: `e4dd3806996f832ab466f0a04d79e13e2ebfc1cd`  
Write boundary: `READ_ONLY`

## Conclusion

The repository already contains the principal execution and configuration primitives required for paired backup. Beta.1.1 must extend them rather than create a new backup subsystem.

## Reusable components

1. `AKORT.Config` already resolves DEV DWH, Publish and folder identifiers. No file or folder ID may be hard-coded in Beta.1.1.
2. Alpha.6 already exposes `AKORT.IncrementalPublish.createPublishBackup` through `AKORT_alpha6CreatePublishBackup`. Its exact implementation is inspected by this package and must be reused or minimally extracted into a shared copy primitive.
3. `AKORT.OperationEngine` already provides queueing, idempotency keys, durable checkpoints, leases, retry, safe pause and resume.
4. `AKORT.Core.safeRun`, `AKORT.Core.Id`, `SYSTEM_LOG`, `OPERATION_QUEUE` and `OPERATION_STEPS` already provide execution identity and audit lineage.
5. `AKORT.EnvironmentGuard` and blocked resource IDs remain the mandatory DEV boundary.

## Confirmed gaps

The accepted source inventory has no general paired-backup operation, no DWH backup member, no shared `backup_id`, no `BACKUP_REGISTRY`, no pair manifest, and no PARTIAL-resume contract that creates only a missing member.

The existing Publish-only command is not by itself sufficient evidence of a consistent DWH + Publish pair.

## Minimum implementation for candidate r2

Candidate `4.0.0-beta.1.1.2` may add only:

- one module-owned `BACKUP_REGISTRY` table;
- one `BETA11_PAIRED_BACKUP` handler routed through the existing Operation Engine;
- one deterministic `backup_id` and pair folder/manifest identity;
- a DWH member and a Publish member;
- exact-member adoption after a lost response;
- PARTIAL continuation that copies only the absent member;
- read-only operation, registry and freshness status.

The implementation must preserve the accepted runtime schemas and Gate 7 evidence. Daily scheduling is added only after the manual paired operation and isolated restore rehearsal pass.

## Explicit exclusions

- no second executor, queue or dispatcher;
- no production file IDs or production writes;
- no RAW, Publish or aggregate schema changes;
- no automatic restore;
- no retention deletion;
- no user-pipeline enablement;
- no UI work belonging to Beta.2.
