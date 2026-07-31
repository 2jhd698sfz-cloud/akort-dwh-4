# АКОРТ DWH 4.0

Apps Script data pipeline for the AKORT analytical system.

## Current status

Active milestone: **Alpha.7.4 — Aggregate Integration into Existing Operation Engine**.

Status: `GATE 4 ACCEPTED / GATE 5 DURABLE AGGREGATE-ITEM PREPARATION HOTFIX READY / GROUP 2 RESUME PENDING / REGULAR PIPELINE PROHIBITED`.

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

The local Alpha.7.4 implementation includes durable staging, bounded calculation checkpoints, logical-series replacement, atomic Sheets API publication, lost-response recovery and reconciliation. Gate 4 adds an isolated physical/fault harness that forbids the DataLens-connected DEV Publish target. Gate 5 scans RAW inputs in durable 500-row chunks to build a fingerprinted aggregate-item inventory, reuses the production canonical index expansion, materializes each aggregate calculation batch once, scans only bounded target identity columns and adaptively publishes up to 128 logical series under unchanged atomic limits without repeating full build or earlier price replay.

Gate 4 requires `PUBLISH_AGGREGATE_EXECUTION_ENABLED=TRUE` while `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` remains `FALSE`. Regular aggregate operations and trigger changes remain prohibited until the later authoritative DEV gate.
