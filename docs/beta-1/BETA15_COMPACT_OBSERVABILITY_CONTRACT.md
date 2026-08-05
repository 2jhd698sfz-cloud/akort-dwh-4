# Beta.1.5 r2 — Compact observability read models

Package: `4.0.0-beta.1.5.2`  
Contract: `4.0-beta15-compact-observability-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `dfe0733432a2cf978ccecaac6b753019a1331a9e`

## Scope

This unit closes the exact gap accepted in Beta.1.5 r1 by adding two compact
materialized read models:

1. `DATASET_STATUS` — one row for each observable operational domain.
2. `ISSUE_REGISTRY` — one normalized current issue for each stable source
   issue identity.

The existing service registries remain authoritative. Beta.1.5 does not create
another operation queue, executor, dispatcher, backup subsystem, trigger
registry, RAW store or Publish store.

## Bounded projection

A refresh reads at most 25 tail rows from each accepted service registry:

- `RELEASE_REGISTRY`;
- `OPERATION_QUEUE`;
- `OPERATION_STEPS`;
- `SYSTEM_LOG`;
- `RAW_LOAD_REGISTRY`;
- `PUBLISH_RUNS`;
- `PUBLISH_RECONCILIATION`;
- `PARSER_ISSUES`;
- `BACKUP_REGISTRY`;
- `TRIGGER_OWNERSHIP_REGISTRY`.

Physical RAW and Publish targets are never read. The refresh replaces only the
current rows of `DATASET_STATUS` and `ISSUE_REGISTRY`. It does not mutate
operations, settings, triggers, Drive files or data-plane tables.

The compact status API reads only `DATASET_STATUS` and `ISSUE_REGISTRY`; it
never rescans the authoritative source registries.

## Dataset domains and freshness

The read model contains eight domains:

- system release;
- operation engine;
- RAW load registry;
- Publish runs;
- Publish reconciliation;
- parser quality;
- paired backups;
- trigger ownership.

Freshness is deterministic:

- RAW loads and Publish runs: 14 days;
- reconciliation: 14 days;
- paired backups: 36 hours;
- trigger ownership snapshot: 7 days;
- release, operation activity and parser issues: not applicable.

Stale freshness produces `WARNING` and `REFRESH_SOURCE_DATA`; a source failure
or current error issue produces `ERROR`.

## Issue lifecycle

Current issues are normalized to `OPEN`, `RETRYING`, `REVIEW` or `OBSERVED`.

The projection deliberately suppresses false current alerts:

- Beta.1.3 control-plane test operations are excluded;
- only the latest operation of each non-test operation type is evaluated;
- only the latest reconciliation row for each sheet is evaluated, so a later
  success supersedes an earlier failure;
- only the latest RAW state for each target is evaluated;
- only the latest Publish run and latest paired backup are evaluated;
- resolved, closed and ignored parser issues are excluded;
- only `ERROR` rows from the bounded system-log tail become issues.

Each issue has a deterministic key, first/last seen timestamps, occurrence
count, compact details, lifecycle, severity and normalized `next_action`.

## Installation and refresh

`AKORT_beta15CompactObservabilityPreflight` is read-only.

`AKORT_beta15CompactObservabilityInstall` calls `Core.install` first so the two
service tables are created. Core.install completes before the Beta.1.5 Script
Lock is acquired because Apps Script locks are not re-entrant. Installation then
materializes the first bounded snapshot.

`AKORT_beta15CompactObservabilityRefresh` performs a manual bounded refresh.
No trigger is created in Beta.1.5.

`AKORT_beta15CompactObservabilityStatus` reads only the two materialized read
models and returns the compact overall status, dataset rows, normalized issues,
severity counts, lifecycle counts and next actions.

## Safety boundary

- runtime release remains `4.0.0-alpha.7.4.42`;
- general user pipeline remains disabled;
- production is not touched;
- no RAW or Publish write occurs;
- no operation is enqueued or mutated;
- no trigger is created or deleted;
- no automatic refresh schedule is installed;
- the forbidden backup fixture remains absent.
