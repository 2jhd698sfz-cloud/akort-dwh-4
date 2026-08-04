# Beta.1.0 — read-only bootstrap contract

Package: `4.0.0-beta.1.0.1`  
Accepted runtime base: `4.0.0-alpha.7.4.42`  
Accepted commit: `28d9827a8b80f1bdda615e00bab22d35cd8130cc`  
Gate 7 evidence: `G7E_5F028CEB97F66118A57E5B6C`

## Purpose

Beta.1.0 does not implement backup, rollback UI, observability or Full Audit. It establishes the machine-readable contract and exact gap matrix that all following Beta.1 packages must obey.

The accepted Alpha.7.4 runtime release remains unchanged. This avoids changing Gate 7 evidence, historical allowlists and data-plane semantics before a Beta package actually installs a new operational component.

## Changes

- Adds the read-only `AKORT.Beta10Bootstrap` namespace.
- Adds `AKORT_beta10Status`, `AKORT_beta10Contract` and `AKORT_beta10GapMatrix`.
- Adds the normative gap matrix in JSON.
- Adds static architecture guards and wires them into the full `npm test`.
- Removes the forbidden legacy smoke-fixture artifact from `src`.
- Does not change `src/00_Release.js`, Gate 6, Gate 7, schemas or accepted runtime handlers.

## Write boundary

Beta.1.0:

- does not call `SpreadsheetApp`, `DriveApp`, `PropertiesService` or `ScriptApp`;
- does not create tables or triggers;
- does not enqueue operations;
- does not run `clasp push`;
- does not touch production;
- does not enable `PUBLISH_USER_PIPELINE_ENABLED`.

## Gap classification

- `ALREADY_IMPLEMENTED`: 1 baseline guard requirement.
- `PARTIAL`: 5 requirements that must extend accepted modules.
- `MISSING`: 1 paired-backup operation/registry contract.

The detailed matrix is stored in `docs/beta-1/BETA10_GAP_MATRIX.json`.

## Acceptance

1. The branch starts exactly from the accepted Alpha.7.4 commit.
2. The complete existing Alpha regression passes unchanged.
3. The Beta.1.0 static suite passes.
4. No second executor, Raw Store or Incremental Publish implementation exists.
5. The user pipeline remains disabled.
6. The forbidden backup fixture is absent.
7. No deployment or Apps Script execution is required for Beta.1.0 acceptance.

## Next package

Beta.1.1 starts with an inventory of reusable Drive-copy and backup primitives. Only after that inventory may it add the minimum paired-backup operation and registry.
