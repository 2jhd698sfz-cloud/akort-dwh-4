# АКОРТ DWH 4.0

Apps Script data pipeline for the AKORT analytical system.

## Current status

Active milestone: **Alpha.7.4 — Aggregate Integration into Existing Operation Engine**.

Status: `GATE 5 ACCEPTED / GATE 6 ALPHA74.34 RAW-LINEAGE RECOVERY READY / USER PIPELINE PROHIBITED`.

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

Release `4.0.0-alpha.7.4.34` fixes the confirmed `.33` RAW-lineage incident:
the second W27 canary revised 50 observations from an older load already marked
`REVERSED`, and logical rollback restored those invalid predecessors because it
selected only by version number. Reversal now excludes observations owned by
`REVERSED` loads from predecessor selection and later-version conflicts. The
exact recovery corrects 50 RAW latest flags and reruns the standard price and
aggregate phases from corrected RAW without repeating parser, source staging or
the canary RAW commit. Active digest checkpoints are compacted before reaching
the Script Properties limit. Runbook:
[`ALPHA74_34_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`](docs/alpha-7.4/ALPHA74_34_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md).

Release `4.0.0-alpha.7.4.33` fixes the `.32 / RUN_REVERSAL`
checkpoint-cell incident. RAW rollback, ordinary weekly/monthly Publish,
materialization, calculation and the exact 392-row durable stage have already
completed; aggregate publication has not started. `.33` compacts the duplicated
50-record reversal payload, validates and adopts the existing stage, then
continues from `UPDATING_AGGREGATES` without repeating accepted work. New
checkpoints and audit cells are bounded before Sheets writes, and errors raised
inside a script lock are no longer misclassified as lock-acquisition failures.
Runbook:
[`ALPHA74_33_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`](docs/alpha-7.4/ALPHA74_33_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md).

Release `4.0.0-alpha.7.4.32` guarantees compact terminal-state persistence and
allows the exact safely stopped `.30 / VERIFY_ROLLBACK` checkpoint to enter
the canonical +196-row recovery. This avoids repeated worker leases when the
full mismatch diagnostic cannot fit beside the accumulated durable state.
The recovery remains restricted to matching operation IDs, row counts,
digests, accepted canary/reversal operations, absent restore operation and
preserved recovery copies. Runbook:
[`ALPHA74_32_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`](docs/alpha-7.4/ALPHA74_32_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md).

Release `4.0.0-alpha.7.4.31` fixes the exact `.30` Gate 6 rollback mismatch:
196 weekly aggregate rows were keyed as Saturday `2026-07-04` although
`period_label=2026-W27` identifies Sunday `2026-07-05`. Recovery removes only
those rows in bounded atomic logical-series batches, verifies every read-back,
then restarts a clean three-cycle Gate so post-canary and restore use the same
canonical Sunday identity. Weekly, Monthly, Industry and Aggregates remain in
the exact digest contract. Runbook:
[`ALPHA74_31_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`](docs/alpha-7.4/ALPHA74_31_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md).

Release `4.0.0-alpha.7.4.30` compacts the accumulated Gate 6 recovery history
below the Script Properties value limit, persists terminal fail-closed state
before trigger cleanup and exactly resumes the stopped `.29 / ROLLBACK_SCAN`
checkpoint. Canary, accepted reversal and completed Weekly/Monthly rollback
digests are preserved. Runbook:
[`GATE6_STATE_CAPACITY_RECOVERY_HOTFIX.md`](docs/alpha-7.4/GATE6_STATE_CAPACITY_RECOVERY_HOTFIX.md).

Release `4.0.0-alpha.7.4.26` fixes the verified first-batch monthly calendar
incident: `period_start=2026-07-01` was physically written with
`period_label=2026-06-01` after a Moscow Date crossed the UTC month boundary.
Monthly labels and fingerprints now derive from `period_start`; exact recovery
repairs only the preserved 32-series batch and resumes the same operation
without repeating RAW, ordinary price Publish, materialization, calculation or
staging. `.26` also fixes the `.25` recovery adapter reference that failed
before any intent, operation, flag, trigger or Publish mutation, and adds a
repository-wide unresolved private-call check to the mandatory test chain. Runbook:
[`GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md`](docs/alpha-7.4/GATE6_MONTHLY_PERIOD_LABEL_RECOVERY_HOTFIX.md).
