# АКОРТ DWH 4.0

Apps Script data pipeline for the AKORT analytical system.

## Current status

Active milestone: **Alpha.7.4 — Aggregate Integration into Existing Operation Engine**.

Status: `GATE 5 ACCEPTED / GATE 6 BOUNDED-PHASE CHECKPOINT RECOVERY READY / USER PIPELINE PROHIBITED`.

Accepted base:

- commit `52590c8e036d49b9f76f87341b69881a916c851d`;
- tag `v4.0.0-alpha.7.3-accepted`.

Active branch: `codex/alpha-7.4-integration-reset`.

The previous `feature/alpha-7.4-incremental-aggregate-publish` candidate is withdrawn and was not used as the implementation base.

## Architecture boundary

Apps Script owns:

- ingestion of approved source files;
- Operation Engine and checkpoints;
- versioned RAW;
- calculation and incremental Publish;
- integrity, reconciliation, backup and recovery.

Yandex DataLens is an external consumer of the Publish spreadsheet and manages its own refresh.

## Alpha.7.4 documentation

See [`docs/alpha-7.4/README.md`](docs/alpha-7.4/README.md).

The local Alpha.7.4 implementation includes durable staging, bounded calculation checkpoints, logical-series replacement, atomic Sheets API publication, lost-response recovery and reconciliation. Gate 5 is accepted with exact 61,636-row parity across baseline, live snapshot, full build and sequential replay. Gate 6 adds recovery copies and a fail-closed three-cycle authoritative DEV canary using one new weekly/monthly source file: source-file load, standard logical reversal and source-file restore. Acceptance requires a real change in `PUBLISH_PRICE_AGGREGATES`.

Gate 6 may enable the regular aggregate pipeline only inside its controlled harness. General operator submission remains prohibited until Gate 7 through `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

Release `4.0.0-alpha.7.4.23` makes bounded work an invariant of every heavy
aggregate phase: materialization, stage validation, publication, latest,
reconciliation and finalization all use durable cursors and fixed per-step
limits. It resumes the exact stopped `.22` Gate 6 checkpoint from
`STAGING_AGGREGATE_ROWS`, preserving RAW, ordinary price Publish,
materialization and all 392 completed aggregate calculations. Runbook:
[`GATE6_BOUNDED_AGGREGATE_PHASES_HOTFIX.md`](docs/alpha-7.4/GATE6_BOUNDED_AGGREGATE_PHASES_HOTFIX.md).
