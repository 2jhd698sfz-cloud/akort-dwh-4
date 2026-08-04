# Beta.1.1 r2 — Paired Backup Contract

Package: `4.0.0-beta.1.1.2`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `59372f73eb12f600b1ed8f6960ed18861cda613b`

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
