# Beta.2.2 — Installation and Rollback Protocol

## Current gate

Candidate-r3 has independent-review status `NO-GO` and must not be committed. Candidate-r4 is a fail-closed corrective replacement over the exact uncommitted candidate-r3 working tree.

Required state before applying candidate-r4:

- branch `codex/beta-2.2-user-load-workflow`;
- HEAD `1512fbfd99769d208efc141154fbc0fb42a4f650`;
- exactly the 10 approved Beta.2.2 paths changed;
- every changed path matches the frozen candidate-r3 hash;
- no additional local changes;
- no commit, `clasp push`, deployment or Script Property change.

The corrective installer must back up all 10 current files, replace only the candidate-r4 remediation files, run the focused suite, full `npm test`, `git diff --check`, verify the exact changed-path set and restore candidate-r3 automatically on any failure.

## Repository paths

- `package.json`;
- `src/Beta21ControlCenter.html`;
- `src/47_Beta22UserLoadWorkflow.js`;
- `tests/beta22_user_load_workflow_static.test.js`;
- `docs/beta-2/BETA22_ACCEPTANCE_MATRIX.md`;
- `docs/beta-2/BETA22_CANDIDATE_STATUS.md`;
- `docs/beta-2/BETA22_INSTALLATION_AND_ROLLBACK.md`;
- `docs/beta-2/BETA22_REUSE_MATRIX.md`;
- `docs/beta-2/BETA22_USER_LOAD_WORKFLOW_CONTRACT.json`;
- `docs/beta-2/BETA22_USER_LOAD_WORKFLOW_CONTRACT.md`.

## Post-installation gate

After candidate-r4 local tests pass:

1. do not commit;
2. conduct independent technical review of the exact 10-path working-tree diff and hashes;
3. retain the review outcome as external immutable evidence;
4. commit and publish through GitHub Desktop only after review `GO`;
5. verify the published commit identity;
6. perform `clasp push` only after that verification;
7. configure Script Properties only under a separate deployment/acceptance instruction.

Script Properties are configured only in Apps Script, never committed:

- `AKORT_BETA22_INCOMING_FOLDER_ID=<dedicated DEV folder ID>`;
- `AKORT_BETA22_CONFIRMATION_SECRET=<high-entropy secret>`;
- `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=FALSE`.

## Controlled physical acceptance

A physical source-file canary requires a separate approval. Immediately before it:

1. verify a fresh paired backup;
2. verify no active or review-required operations;
3. set `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=TRUE`;
4. execute only the approved representative file;
5. complete E2E evidence and duplicate/no-change proof;
6. set `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=FALSE` before any other closeout action;
7. verify `PUBLISH_USER_PIPELINE_ENABLED=FALSE`;
8. verify no extra trigger and production untouched.

For XLS/XLSX read-only UAT, inspect the accepted parser’s test-files folder before and after the request and prove that any temporary converted Google Sheet is trashed and no active temporary conversion remains.

## Rollback

Before commit, rollback restores the exact candidate-r3 backup created by the corrective installer.

After commit but before `clasp push`, rollback is a Git working-tree or branch operation only.

After `clasp push` but before controlled data acceptance, rollback restores the accepted Beta.2.1 source deployment and previous Web App version; Script Properties are removed or returned to their prior values.

After a controlled physical load, code rollback is not a data rollback. Use only the accepted Beta.1 rollback facade under a separately approved recovery plan.
