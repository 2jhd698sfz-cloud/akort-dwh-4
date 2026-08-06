# Beta.2.2 — Acceptance Matrix

Review target: `4.0.0-beta.2.2.4 / 4.0-beta22-user-load-workflow-4`

Commit, `clasp push` and deployment require external independent-review `GO` for the exact installed 10-path diff and hashes.

| ID | Requirement | Test / evidence | PASS condition |
|---|---|---|---|
| B22-01 | Exact Beta.2.1 base | installer and git identity | HEAD/base matches `1512fb...`; unknown changes block |
| B22-02 | REUSE_MATRIX complete | source review | every user action maps to accepted API or proven gap |
| B22-03 | No duplicate backend | static anti-duplication suite | no new parser/queue/executor/dispatcher/calculator/publisher/state store |
| B22-04 | Server access | authorized and unauthorized Web App tests | authorized succeeds; unavailable/unauthorized identity fails closed |
| B22-05 | Exact incoming folder | read-only Drive test | direct children only; outside file rejected; no recursion |
| B22-06 | Bounded file list | static/dynamic/live test | max 50 returned, max 200 inspected, truncation disclosed |
| B22-07 | Accepted parser reuse | spy/static/live evidence | inspect and preview use accepted APIs; no copied parser logic |
| B22-08 | Temporary conversion boundary | XLS/XLSX Drive evidence | accepted parser may create temporary conversion; source unchanged; temporary file trashed in `finally`; no active orphan; zero RAW/Publish writes |
| B22-09 | Blocking issues | negative preview | zero rows or ERROR/BLOCKER/CRITICAL prevents confirmation |
| B22-10 | HMAC confirmation | tamper/expiry/user tests | HMAC, user, TTL and exact binding enforced |
| B22-11 | Explicit server acknowledgment | negative submit tests | missing/false/mismatched file ID or file name returns `BETA22_USER_CONFIRMATION_REQUIRED` |
| B22-12 | Async preview fencing | delayed/out-of-order UI test | response applies only to exact request sequence and current file/options context |
| B22-13 | Mandatory submit re-preview | changed-file test | changed source/profile/options/row count blocks submit |
| B22-14 | Submit disabled by default | negative test | controlled flag FALSE returns `BETA22_SUBMIT_DISABLED`; general pipeline FALSE |
| B22-15 | Guarded enqueue reuse | spy/E2E | exactly one accepted `enqueueGuarded` for `SOURCE_FILE_LOAD_V4` |
| B22-16 | Idempotent repeat | E2E | same confirmation returns same operation; no second queue row |
| B22-17 | No full work in UI call | static/runtime metrics | submit only enqueues |
| B22-18 | Exact operation binding | negative tests | foreign/legacy operation IDs rejected |
| B22-19 | Bounded status DTO | response test | latest 12 compact step summaries; no checkpoint/result JSON |
| B22-20 | Bounded Continue | spy/fault test | exact operation; allowed states only; early-phase re-preview; one accepted step |
| B22-21 | Weekly/monthly E2E | controlled DEV canary | SUCCESS and valid RAW/Publish/aggregate/latest/audit evidence |
| B22-22 | Duplicate/no-change | repeat file E2E | accepted Raw Store result; no duplicate committed data |
| B22-23 | Industry status/validate | UI/live evidence | accepted envelope preserved; disclosed form-control writes; zero RAW/Publish writes |
| B22-24 | Industry submit boundary | negative test | no controlled bypass; general pipeline FALSE blocks |
| B22-25 | Regression | full `npm test` | all accepted tests PASS; restore rehearsal remains final |
| B22-26 | Web App UX | visual/dynamic UAT | selected file, options, preview and confirmation cannot diverge |
| B22-27 | Safety closeout | post-test preflight | both write flags FALSE; no extra trigger; production untouched |
| B22-28 | Beta.2.7 handoff explicit | contract review | final user-pipeline start adapter remains Beta.2.7 gate |
| B22-29 | External independent review | exact installed-diff review | no blocker/critical/major finding before commit |

Automatic `NO-GO` applies to a second data-processing path, direct RAW/Publish write, stale or out-of-order preview acceptance, browser-only submit acknowledgment, unsigned or non-HMAC confirmation, missing re-preview, unbounded Drive scan, arbitrary operation control, masked Industry failure, unbounded operation payload, undocumented temporary Drive conversion, unsafe Continue state, or failure to return both write flags to `FALSE`.
