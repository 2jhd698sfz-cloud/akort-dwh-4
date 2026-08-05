# Beta.1.5 r1 — Minimum observability inventory

Package: `4.0.0-beta.1.5.1`  
Contract: `4.0-beta15-observability-inventory-1`  
Base runtime: `4.0.0-alpha.7.4.42`  
Base commit: `00d1c5e139f2304cf248e1b6ca0e222459c2ed53`

## Normative requirement

Beta.1.5 must expose a compact bounded read model for release, health,
freshness, active phase, progress, checkpoint, trigger, backup, issue and
`next_action`. User-facing status reads must not scan physical RAW or Publish
tables.

## Accepted reuse

The inventory reuses the accepted registries and contracts:

- `RELEASE_REGISTRY`;
- `OPERATION_QUEUE` and `OPERATION_STEPS`;
- `SYSTEM_LOG`;
- `RAW_LOAD_REGISTRY`;
- `PUBLISH_RUNS` and `PUBLISH_RECONCILIATION`;
- `PARSER_ISSUES`;
- `BACKUP_REGISTRY`;
- `TRIGGER_OWNERSHIP_REGISTRY`;
- `AKORT.Beta14OperationalHardening`.

`BACKUP_REGISTRY` and trigger ownership are already materialized by accepted
Beta.1.1 and Beta.1.4. They must be projected into the compact read model, not
reimplemented.

## Exact remaining gap

Two read models are still absent:

1. `DATASET_STATUS` — one compact row per observable dataset or operational
   domain.
2. `ISSUE_REGISTRY` — one normalized current issue per stable issue identity.

There is also no single bounded refresh that projects the accepted sources into
those tables. Existing registries remain authoritative; Beta.1.5 must not create
another operation queue, executor, dispatcher, RAW store, Publish store, backup
engine or trigger registry.

## Inventory boundary

The r1 inventory is read-only. It reads headers, row counts and at most 25 tail
rows from each source registry. It never reads physical RAW or Publish targets,
never returns source payload rows and never mutates Apps Script, Drive, DWH,
Publish, triggers, operations or settings.

## Next implementation unit

After live inventory acceptance, the implementation package should add only:

- `DATASET_STATUS`;
- `ISSUE_REGISTRY`;
- one bounded incremental refresh facade;
- one compact read-only status API.

Freshness policy and issue lifecycle must be explicit and deterministic before
the tables are installed.
