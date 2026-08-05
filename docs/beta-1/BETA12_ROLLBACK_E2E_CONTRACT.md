# Beta.1.2 fail-closed rollback E2E contract

## Purpose

This package adds a controlled end-to-end acceptance harness over the already accepted `RAW_LOAD_V4`, Beta.1.4 operational hardening, Beta.1.2 rollback facade, `RAW_REVERSAL_V4`, Publish, aggregate integration, reconciliation, and quick audit. It does not add a queue, executor, handler, trigger, table, or alternative rollback implementation.

The implementation base is branch `codex/beta-1-operational-gap-closure` at commit `8d5f9a93210aa4ab7c02c9a9219b085e4d2947ac`. The runtime remains `4.0.0-alpha.7.4.42`.

Corrective package `4.0.0-beta.1.2.7` preserves contract `4.0-beta12-rollback-e2e-1` and verifies the restore evidence file by SHA-256 of canonical JSON, not by whitespace-sensitive raw file bytes.

## Accepted bindings

The harness fails closed unless all accepted bindings match exactly:

- rollback facade package `4.0.0-beta.1.2.5`, contract `4.0-beta12-rollback-facade-4`;
- operational hardening package `4.0.0-beta.1.4.2`, contract `4.0-beta14-operational-hardening-1`;
- restore rehearsal package `4.0.0-beta.1.1.7`, contract `4.0-beta11-isolated-restore-rehearsal-2`;
- restore evidence `RRE_0F19BA90233D4B0C053C5659` with evidence hash `0f19ba90233d4b0c053c565957a6183d14c48a4405020964d38a270adf9e9d15` and file SHA-256 `3fff487ea06cc32bb86cd516434e9cd6c5bf62b618499b4c726126d305a972a3`.

The restore rehearsal internal base commit remains `cc5451f3bfaad4a294f07c31a7c0b76b71f14299`; it is not the implementation HEAD of this package.

## Decision boundaries

`AKORT_beta12RollbackE2EPreflight` is read-only. It verifies the exact DEV binding, accepted restore evidence, operation quiescence, protected backup window, source identity, and a deterministic safe current `RAW_INDUSTRY` predecessor. It does not persist controller state.

`AKORT_beta12RollbackE2ECanarySubmit` creates at most one owned `RAW_LOAD_V4` operation through `AKORT.Beta14OperationalHardening.enqueueGuarded`. It submits one revision only and never submits a rollback.

`AKORT_beta12RollbackE2EContinueLatest` runs only the exact operation ID already stored for the current canary or rollback stage. It never creates an operation and never advances automatically from a completed canary to rollback preview or submission.

`AKORT_beta12RollbackE2ERollbackPreview` calls the accepted facade preview for the exact canary load. It performs no RAW, Publish, aggregate, operation-queue, or Drive write. Because the next public function has no arguments, it stores only the exact control-plane confirmation binding in Script Properties.

`AKORT_beta12RollbackE2ERollbackSubmit` re-runs a fresh preview and compares every bound field. It refuses submission if the target, token, lineage, impact, source-operation, reason fingerprint, or one-row restoration metrics drift. It then delegates to the accepted Beta.1.2 facade.

`AKORT_beta12RollbackE2EStatusLatest` is read-only.

`AKORT_beta12RollbackE2EFinalizeLatest` performs verification only. It does not run or repair data-plane operations. After all acceptance checks pass, it writes one immutable JSON evidence file and never cleans up the canary, reversal log, operation history, or evidence.

## Candidate policy

The predecessor must be a deterministic current `RAW_INDUSTRY` row with a finite numeric value. Two lineage modes are accepted. Registered lineage requires a `COMMITTED` source load and a successful non-reversal source operation. Legacy row-bound lineage is allowed only when no `RAW_LOAD_REGISTRY` row exists for the predecessor load ID, the predecessor is version 1 with revision type `INITIAL`, and both the row and legacy-lineage fingerprints remain exact through canary submission. Any partially registered lineage fails closed. Both modes reject accepted facade protected markers (`ALPHA3_TEST_`, `ALPHA3_DEMO_`, `ALPHA4_TEST_`, `ALPHA5_TEST_`, `ALPHA74_GATE6`, `ALPHA74_GATE7`, `GATE6_`, or `GATE7_`). Existing reversal evidence, an active rollback, a later active revision, duplicate identifiers, invalid checkpoints, or lineage drift block the run.

The owned source identity is `B12E2E_R1` / `B12 E2E controlled revision r1`. Static tests verify that this identity does not collide with the accepted protected markers.

## Acceptance evidence

Final evidence contains the package and contract versions, implementation commit, exact restore binding, canary and rollback operation IDs, canary and reversal load IDs, canary and predecessor observation IDs, confirmation token, lineage fingerprint, impact fingerprint, source-operation fingerprint, reason hash, all checks, totals, evidence ID and hash, evidence file pointer, completion time, and safety flags.

At least twelve checks must pass. The implemented set also verifies predecessor value and version immutability, both full operation phase chains, absence of unrelated active operations, exact DEV IDs, and the complete safety boundary.

After evidence reaches `FINALIZED`, E2E functions must not be run again. A repeated finalization only verifies and returns the existing evidence file without changing it.

## Regression wiring

The targeted command is `npm run test:beta12-rollback-e2e`. In the full `npm test` chain it is inserted immediately before `npm run test:beta11-restore-rehearsal`; the accepted restore rehearsal remains the unique final command.

## Safety boundary

Production is never selected. Active DEV configuration is not changed. The user pipeline remains disabled. No trigger is created or deleted. No physical deletion or evidence cleanup is implemented. Accepted core modules are consumed through their public interfaces and are not modified by this package.

## Release-closure corrections

Package `4.0.0-beta.1.2.8` closes the two live preflight defects without changing the accepted data plane. Restore evidence is verified by SHA-256 of canonical JSON rather than whitespace-sensitive raw bytes. Candidate selection supports either fully registered source-operation lineage or a narrowly defined legacy `RAW_INDUSTRY` predecessor: no load-registry row, version 1, revision type `INITIAL`, exact row fingerprint, and exact legacy-lineage fingerprint. Any partially registered, revised, protected, or drifting lineage remains fail-closed.
