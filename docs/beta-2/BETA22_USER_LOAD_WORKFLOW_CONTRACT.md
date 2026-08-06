# Beta.2.2 — User Load Workflow Contract

Contract version: `4.0-beta22-user-load-workflow-4`

Candidate package: `4.0.0-beta.2.2.4`

Status model: `CANDIDATE REVIEW TARGET`. Commit, `clasp push` and deployment are prohibited unless external independent-review evidence records `GO` for the exact installed 10-path diff and its hashes. This document does not self-assert local installation or acceptance state.

## 1. Purpose

Beta.2.2 connects the accepted Control Center to the accepted weekly, monthly and Industry loading mechanisms. It does not create a new ingestion pipeline.

The regular file workflow is:

`dedicated DEV incoming folder → inspect → preview → explicit exact-file acknowledgment → fresh HMAC-signed confirmation → guarded enqueue SOURCE_FILE_LOAD_V4 → existing Operation Engine → existing parser/staging/RAW/Publish/aggregate/status pipeline`.

The Industry workflow remains:

`existing Industry Input → validate → existing submit facade → RAW_LOAD_V4 → existing Operation Engine and dependency pipeline`.

## 2. Immutable base

- Beta.2.1 acceptance commit: `1512fbfd99769d208efc141154fbc0fb42a4f650`.
- Runtime: `4.0.0-alpha.7.4.42`.
- General user pipeline remains `FALSE` throughout Beta.2.2 candidate preparation and acceptance.
- Production 3.1.7 is not touched.

## 3. Independent review history

Candidate-r1 passed local tests but independent review returned `NO-GO` before commit because Drive scanning was not bounded, arbitrary accepted source-operation IDs could be controlled, and operation status returned an unbounded step payload. Candidate-r2 closed those findings.

Candidate-r2 then received `NO-GO` before commit because source identity was not rechecked before early parser phases, option changes could leave a stale visible confirmation, accepted Industry failures were wrapped as outer successes, and Industry validation form writes were not disclosed. Candidate-r3 closed those findings.

Candidate-r3 then received `NO-GO` before commit because:

1. an out-of-order asynchronous preview response could attach a confirmation to a different currently selected file or displayed option set;
2. the exact-file name and acknowledgment checkbox were enforced only in browser state, not in the server submit contract;
3. the documentation incorrectly described XLS/XLSX inspect and preview as copy-free and fully read-only, although the accepted parser owns a temporary Drive conversion and trashes that temporary file in `finally`;
4. candidate status documents embedded transient `NOT INSTALLED / NO-GO` assertions that would become false after installation and external review.

Candidate-r4 closes those findings without changing the accepted data plane.

## 4. Accepted APIs reused

- `AKORT.ExistingSourceParsers.inspectFile`;
- `AKORT.ExistingSourceParsers.previewFile`;
- `AKORT.ExistingSourceParsers.OperationType` (`SOURCE_FILE_LOAD_V4`);
- `AKORT.Beta14OperationalHardening.enqueueGuarded`;
- `AKORT.OperationEngine.status`;
- `AKORT.OperationEngine.resume`;
- `AKORT.IndustryInput.status`;
- `AKORT.IndustryInput.validate`;
- `AKORT.IndustryInput.submit`;
- Beta.2.1 server-side access projection.

## 5. Configuration

Beta.2.2 adds only three Script Properties. They are never committed to Git:

- `AKORT_BETA22_INCOMING_FOLDER_ID`: exact dedicated DEV incoming-folder ID. No fallback to Drive root, project root or familiar production folder is allowed;
- `AKORT_BETA22_CONFIRMATION_SECRET`: high-entropy server-only HMAC key;
- `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED`: default `FALSE`; may be enabled only for a separately approved DEV acceptance window and must be returned to `FALSE` immediately afterwards.

The final familiar-folder cutover remains Beta.2.4 scope.

## 6. File discovery and parser-side Drive boundary

- Direct children of the exact configured folder only.
- No recursion.
- Google Sheets, XLSX and XLS only.
- Maximum 50 most recently updated supported files returned from the bounded scan window.
- Maximum 200 Drive entries inspected per request, including unsupported files.
- If either ceiling is reached while more entries remain, `truncated=true` is returned.
- Beta.2.2 itself does not move, copy, rename, archive or route source files and creates no trigger.
- Every selected file is rechecked server-side for exact direct parent and MIME type.
- Google Sheets are read directly by the accepted parser.
- For XLS/XLSX, the accepted parser may create a temporary converted Google Sheet in its existing configured test-files folder and move that temporary file to trash in `finally`.
- The source file is never mutated, moved or renamed by inspect or preview.
- Inspect and preview perform zero RAW and Publish writes.
- DEV acceptance must verify that no active untrashed temporary conversion remains after each XLS/XLSX request.

## 7. Preview and explicit confirmation

A file is ready only when normalized row count is positive and no `ERROR`, `BLOCKER` or `CRITICAL` issue exists.

A confirmation is stateless and server HMAC-signed. It binds:

- schema version;
- exact file ID and name;
- source hash and structural fingerprint;
- resolved profile and target table;
- normalized row count;
- resolved year/month/week/source-publication options;
- authorized user email;
- issue and expiry timestamps.

Confirmation TTL is 10 minutes. Submit verifies HMAC, user and expiry, repeats the accepted preview and requires exact equality before enqueue.

The browser fences each inspect/preview request by a monotonically increasing request sequence and an exact file/options context key. A stale or out-of-order response is ignored. Selecting another file or changing year, month or week invalidates both completed and in-flight preview state.

The server additionally requires an explicit acknowledgment object containing `acknowledged=true`, the exact signed `fileId` and the exact signed `fileName`. Missing or mismatched acknowledgment fails with `BETA22_USER_CONFIRMATION_REQUIRED`.

## 8. Submit and idempotency

The submit facade never parses, stages or writes data itself. It invokes the accepted Beta.1.4 guarded enqueue for `SOURCE_FILE_LOAD_V4`.

The deterministic idempotency key is derived from operation type, file ID, source hash, profile and resolved options. Repeated submit must return the existing operation instead of creating a duplicate. Final duplicate/no-change semantics remain owned by the accepted Raw Store.

Each operation created or reused through Beta.2.2 must contain the exact `4.0-beta22-operation-binding-1` binding. Status and Continue revalidate all of the following before returning or executing anything:

- accepted operation type;
- exact `BETA22|<digest>` idempotency key recomputed from the bound operation input;
- exact file ID, source ID, source hash, profile and resolved options;
- positive normalized row count and non-empty target table;
- confirmation fingerprint;
- exact authorized user email.

A legacy or foreign `SOURCE_FILE_LOAD_V4` operation ID therefore fails closed.

## 9. Operation status and Continue

`AKORT.OperationEngine.status` remains the accepted source of operation state. Beta.2.2 creates no second status table.

The Web App DTO returns at most the latest 12 step summaries. It never returns step checkpoint JSON or result JSON. Operation and step error messages are clipped to fixed display bounds. The accepted Operation Engine may internally read its existing operation-step history; this inherited backend behavior is not duplicated by Beta.2.2 and must be monitored during DEV acceptance.

Continue is permitted only for an exact Beta.2.2 operation in `QUEUED`, `PAUSED` or `RETRY_PENDING`. Before DISCOVER, VALIDATE and PARSE it repeats the accepted preview and requires exact equality with the operation-bound file ID, source hash, structural fingerprint, profile, target, row count and resolved options. A change returns `BETA22_OPERATION_SOURCE_CHANGED` without resume. From STAGE onward the parser materialization is already durable, so no source re-read is performed. Continue invokes exactly one accepted `resume(operationId,{maxSteps:1})`. `RUNNING`, terminal and unknown states are not continued from the UI.

## 10. Write gates and Industry

Weekly/monthly submit and Continue are allowed in Beta.2.2 only when `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=TRUE` during a separately approved DEV acceptance window while `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

The accepted Beta.1.4 guarded enqueue is intentionally fail-closed after the general user pipeline becomes TRUE. Therefore the final user-pipeline-compatible start facade is explicitly deferred to the Beta.2.7 activation gate; Beta.2.2 does not weaken or duplicate that guard in advance.

Industry status, validate and submit return the exact accepted result envelope; an accepted failure is never wrapped as success. Industry validation may update the existing form’s status, message, fingerprint and timestamp columns, but performs zero RAW and Publish writes. Industry submit has no Beta.2.2 bypass. It delegates to `AKORT.IndustryInput.submit()` only after the general user pipeline is enabled. This preserves accepted Gate 7 controls and prevents a parallel Industry path.

## 11. Public API

- `AKORT_beta22Contract`
- `AKORT_beta22Preflight`
- `AKORT_beta22ListIncomingFiles`
- `AKORT_beta22InspectFile`
- `AKORT_beta22PreviewFile`
- `AKORT_beta22SubmitFile(confirmation, acknowledgment)`
- `AKORT_beta22OperationStatus`
- `AKORT_beta22ContinueOperation`
- `AKORT_beta22IndustryStatus`
- `AKORT_beta22IndustryValidate`
- `AKORT_beta22IndustrySubmit`

## 12. Explicit exclusions

Beta.2.2 does not introduce:

- a new parser, loader or operation type;
- a new queue, executor, dispatcher, worker or trigger;
- a second RAW, Publish, state or duplicate registry;
- copied mapping, period, unit, calculation, dependency or aggregate logic;
- Beta.2.2-owned source-file copy/move/rename/archive behavior;
- final familiar-folder cutover;
- DataLens changes;
- production writes;
- permanent enabling of the general user pipeline.

The accepted parser’s bounded temporary XLS/XLSX conversion is an inherited implementation detail and is not a Beta.2.2-owned ingestion or lifecycle path.

## 13. Acceptance sequence

1. Install candidate-r4 over the exact uncommitted candidate-r3 working tree with fail-closed hash verification and rollback.
2. Run the focused static/dynamic suite, full repository regression and `git diff --check`.
3. Conduct independent review of the exact installed 10-path diff and hashes.
4. Record external immutable review evidence; commit and publication are allowed only if it states `GO`.
5. Verify the published commit identity.
6. Perform `clasp push` only after commit verification.
7. Configure the three Script Properties under a separate instruction, with both write flags remaining `FALSE`.
8. Perform Web App preflight, bounded listing, inspect/preview, asynchronous-response fencing, explicit acknowledgment and temporary-conversion cleanup UAT.
9. Obtain separate approval for a short controlled-submit window.
10. Run one representative weekly or monthly DEV load, repeat-submit/idempotency proof, status/Continue proof, RAW/Publish/aggregate/latest/quick-audit evidence.
11. Restore `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=FALSE` as the first closeout action.
12. Perform Industry status/validate UI proof and accepted backend evidence; no new physical Industry path.
13. Complete visual/access UAT and formal PASS before opening Beta.2.3.
