# Beta.1.1 r5 — Paired Backup Contract

Package: `4.0.0-beta.1.1.5`
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `7c90ef1b2fb9abe860394c17ec24fe459b505b0e`

## Terminal cleanup result contract

The accepted Operation Engine may return the final operation row directly in
`result.data`, rather than under `result.data.operation`. Beta.1.1 must
recognize all three supported shapes:

- `data.operation.status`;
- `details.operation.status`;
- `data.status` only when `data` is itself an operation row identified by
  `operation_id` and `operation_type`.

The wrapper-level `result.status` is not an operation status and must not be
used for cleanup decisions. Result shapes are parsed through explicit ordered
branches; mixed logical and ternary operators are forbidden here because their
precedence can silently select the container instead of the operation row.

For terminal operation states, Beta.1.1 deletes
`AKORT_BETA11_ACTIVE_OPERATION_ID` and every
`AKORT_beta11BackupWorker` trigger. The daily backup trigger is preserved.

The first controlled live backup completed successfully, but r3 did not
recognize the direct operation-row result shape. This left only stale
orchestration state; the DWH copy, Publish copy, manifest and registry result
were not invalidated.

## Deployment preflight and lock boundary

`AKORT_beta11DeploymentPreflight` is read-only. It checks the accepted base
release, disabled user pipeline, access to DEV DWH and Publish, registry schema,
backup-folder uniqueness and location, trigger ownership, active backup
operations, and handler registration.

Installation is two-stage:

1. the read-only preflight completes;
2. `AKORT.Core.install()` completes under its own Script Lock;
3. only after that does the Beta.1.1 installer acquire its installation lock,
   create or reuse the dedicated folder, and install exactly one daily trigger.

The installer must not hold a Script Lock while calling `AKORT.Core.install()`,
because Apps Script Script Locks are not re-entrant.

## Schedule

One paired backup is scheduled every calendar day, including weekends.

- Nominal time: `04:00`
- Timezone: `Europe/Moscow`
- Apps Script trigger window: approximately `03:45–04:15`
- If another operation is RUNNING, QUEUED, or RETRY_PENDING, the backup waits at a safe checkpoint and retries every 10 minutes.
- The deterministic daily `backup_id` prevents duplicate pairs for one Moscow calendar date.
- `AKORT_beta11BackupNow` creates an additional manual pair.

## Storage

A dedicated folder is created or reused under the configured DEV root:

`07_Разработка системы 4.0 / 08_Резервные копии`

Each successful backup contains:

1. `AKORT_DWH_TECH_4_BACKUP__<backup_id>`
2. `AKORT_PUBLISH_4_BACKUP__<backup_id>`
3. `AKORT_BACKUP_MANIFEST__<backup_id>.json`

`BACKUP_REGISTRY` stores the common `backup_id`, operation ID, file IDs and URLs, operation boundary, manifest hash, status, errors, and timestamps.

## Reuse and recovery

The operation type is `BETA11_PAIRED_BACKUP` and is executed only by the accepted `AKORT.OperationEngine`.

The Publish member uses the extracted compatibility primitive from `AKORT.IncrementalPublish.createPublishBackup`; a second Publish copy subsystem is not created.

Deterministic file names support lost-response adoption. If DWH exists and Publish is missing, resume adopts DWH and creates only Publish. The registry remains `PARTIAL` until both members and the manifest pass audit.

If another operation crosses the boundary after DWH was copied but before Publish is copied, the candidate fails closed and does not mark the pair successful.

## Retention

Beta.1.1 does not automatically delete backups. Retention belongs to Beta.1.6.

## Safety

DEV only. Production 3.1.7 is not accessed. The general user pipeline remains disabled.
