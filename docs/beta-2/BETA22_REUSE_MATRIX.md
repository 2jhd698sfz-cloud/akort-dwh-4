# Beta.2.2 — REUSE_MATRIX

Review target: `4.0.0-beta.2.2.4 / 4.0-beta22-user-load-workflow-4`

Base commit: `1512fbfd99769d208efc141154fbc0fb42a4f650`

Runtime base: `4.0.0-alpha.7.4.42`

Policy: `REUSE-FIRST / GAP-ONLY`

| User action | Existing entry point / API | Owner module and operation type | Confirmed gap | Minimal allowed delta | Anti-duplication / safety proof |
|---|---|---|---|---|---|
| See files awaiting processing | `DriveApp.getFolderById(...).getFiles()` against one exact configured folder | Beta.2 integration boundary; no operation | Missing bounded user DTO and folder binding | Direct-child listing, supported MIME allowlist, latest 50 returned from maximum 200 inspected | No recursion or Beta.2.2-owned move/copy; unsupported-file stress test stops at 200 |
| Inspect file structure and recognize profile | `AKORT.ExistingSourceParsers.inspectFile(fileId, options)` | Alpha.5 Existing Source Parsers | No UI binding | UI binding and normalized result only | Candidate contains no detection, mapping or parser formulas |
| Preview normalized rows and issues | `AKORT.ExistingSourceParsers.previewFile(fileId, options)` | Alpha.5 Existing Source Parsers | Missing user confirmation binding and stale-response fencing | Display accepted result; HMAC confirmation; exact request-sequence and file/options context fence | No parser-stage/RAW/Publish write; stale/out-of-order response ignored |
| Read XLS/XLSX for inspect/preview | Accepted parser `openWorkbook_` / `readWorkbook_` temporary conversion | Alpha.5 Existing Source Parsers | Documentation and UAT disclosure | Disclose temporary converted Google Sheet and trash cleanup; no new conversion implementation | Source file unchanged; no active untrashed temporary conversion after request |
| Confirm weekly/monthly source-file load | `AKORT.Beta14OperationalHardening.enqueueGuarded(...)` with `AKORT.ExistingSourceParsers.OperationType` | Beta.1.4 guard + Alpha.3 Operation Engine; `SOURCE_FILE_LOAD_V4` | Missing allowlisted Web App facade and server acknowledgment | Verify signed preview and explicit exact-file acknowledgment; call existing guarded enqueue once | No second operation type, queue, executor, dispatcher or direct write |
| Prevent duplicate submit | Existing Operation Engine idempotency + Raw Store source-hash duplicate/no-change | Alpha.3/Alpha.4; `SOURCE_FILE_LOAD_V4` | Missing user-level deterministic idempotency key | Bind key to operation type, source hash, profile and resolved options | Repeat submit reuses existing operation; no custom duplicate table |
| Bind operation ownership | Existing operation checkpoint input/meta | Alpha.3 Operation Engine; `SOURCE_FILE_LOAD_V4` | Accepted API does not distinguish Beta.2.2-owned operations from legacy operations | Add compact `beta22Binding` inside accepted operation input | Foreign/legacy IDs fail closed; no second state store |
| View operation progress | `AKORT.OperationEngine.status(operationId)` | Alpha.3 Operation Engine | Missing safe user DTO | Verify exact binding; return latest 12 compact step summaries | No checkpoint/result JSON in UI response |
| Continue a paused/queued load | Accepted preview followed by `AKORT.OperationEngine.resume(operationId,{maxSteps:1})` | Alpha.5 parser + Alpha.3 Operation Engine | Accepted resume does not bind live source to signed identity | Re-preview before DISCOVER, VALIDATE and PARSE; one accepted step | Changed source blocks; RUNNING/terminal rejected; no custom worker |
| View Industry Input | `AKORT.IndustryInput.status()` | Alpha.7.4 Industry Input | No backend gap | UI binding only | No parallel Industry reader or model |
| Validate Industry Input | `AKORT.IndustryInput.validate()` | Alpha.7.4 Industry Input | Exact result propagation and side-effect disclosure | Return accepted envelope; disclose form-control writes | Zero RAW/Publish writes; failure never masked |
| Submit Industry Input | `AKORT.IndustryInput.submit()` | Alpha.7.4 Industry Input; `RAW_LOAD_V4` | Missing UI binding | Delegate only after general pipeline is enabled at Beta.2.7 | No controlled bypass or alternative RAW path |
| Server-side access control | Beta.2.1 access projection | Accepted Beta.2.1 | Missing Beta.2.2 enforcement wrapper | Require authorized active email on every call | Client hiding is never treated as access control |

## Confirmed gaps

1. Exact DEV incoming-folder binding.
2. Bounded direct-child file list DTO.
3. HMAC-signed fresh confirmation binding source identity, profile, options, row count, user and expiry.
4. Explicit server-side exact-file acknowledgment.
5. In-flight and completed preview invalidation when file/options context changes.
6. Thin facade to existing guarded enqueue/status/resume APIs.
7. Exact operation-origin and user binding inside accepted checkpoint input.
8. Bounded operation display DTO.
9. Early-phase source-identity recheck before accepted resume.
10. Exact Industry result propagation and form-write disclosure.
11. Transparent acceptance of the existing parser-owned temporary XLS/XLSX conversion.

All parsing, mapping, normalization, staging, RAW commit, duplicate/no-change, revision, Publish, aggregate calculation, latest, reconciliation, audit, operation execution and recovery gaps are `NONE`; new implementations are prohibited.
