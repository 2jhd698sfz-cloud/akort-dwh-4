# Beta.2.2 Candidate R4 Status Policy and Review Target

Date: 6 August 2026.

Base: Beta.2.1 acceptance commit `1512fbfd99769d208efc141154fbc0fb42a4f650`.

Candidate package: `4.0.0-beta.2.2.4`.

Contract: `4.0-beta22-user-load-workflow-4`.

## Status model

This repository document is deliberately state-neutral. It does not claim that the candidate is installed, accepted or rejected.

The operational rule is:

`NO COMMIT / NO CLASP PUSH / NO DEPLOYMENT unless external independent-review evidence records GO for the exact installed 10-path diff and hashes.`

Installation logs and review outcomes are retained as external immutable evidence so that updating a status sentence does not mutate the diff after it has been reviewed.

## Review history

Candidate-r1: `NO-GO`; unbounded Drive scan, arbitrary operation control and unbounded step payload.

Candidate-r2: `NO-GO`; missing early-phase source recheck, stale displayed options, masked Industry failures and undisclosed Industry form-control writes.

Candidate-r3: `NO-GO`; asynchronous preview response race, browser-only acknowledgment, incorrect copy-free/read-only documentation for accepted XLS/XLSX conversion, and transient status assertions embedded in candidate files.

Candidate-r4 remediates those findings by:

- fencing all inspect/preview responses to an exact request sequence and file/options context;
- invalidating in-flight preview work when file or options change;
- requiring explicit exact-file acknowledgment in the server submit contract;
- using HMAC-SHA-256 for the stateless confirmation;
- disclosing the accepted parser-owned temporary XLS/XLSX conversion and trash cleanup;
- separating immutable candidate contents from external installation/review evidence.

## Fixed repository scope

Exactly 10 paths remain changed:

- `package.json`;
- `src/Beta21ControlCenter.html`;
- `src/47_Beta22UserLoadWorkflow.js`;
- `tests/beta22_user_load_workflow_static.test.js`;
- six `docs/beta-2/BETA22_*` contract and acceptance files.

No commit, push, `clasp push`, deployment, Script Property change, trigger action or Google data write is authorized by this document.

`PUBLISH_USER_PIPELINE_ENABLED` must remain `FALSE`.
