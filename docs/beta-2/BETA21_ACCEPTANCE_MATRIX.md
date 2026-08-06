# Beta.2.1 — Acceptance Matrix

## Static/local PASS

1. Source and HTML syntax valid.
2. Full existing `npm test` passes.
3. Candidate adds no operation type, queue, executor, dispatcher or trigger.
4. Source contains no data-plane write API.
5. Source calls only accepted read APIs.
6. `Beta15CompactObservability.refresh()` is absent.
7. HTML uses `textContent`, no external CDN and no arbitrary function dispatch.
8. `appsscript.json` adds only `userinfo.email` scope.
9. User pipeline cannot be enabled by candidate.
10. Installer changes exactly the approved files.

## DEV read-only PASS

1. Preflight returns SUCCESS.
2. Active user is resolved and authorized.
3. Status returns accepted runtime and `userPipelineEnabled=false`.
4. Dataset count and issue count match Beta.1.5 status.
5. Backup and trigger cards match materialized dataset rows.
6. Full Audit card matches Beta.1.6 status.
7. `sourceRegistryReads=0`, `rawTargetReads=0`, `publishTargetReads=0`.
8. Pre/post DWH and Publish fingerprints are unchanged.
9. No operation, trigger or service-table row is created/changed.
10. Web App opens for the owner and denies an unauthorized account.
11. Main status loads within the accepted performance bound.
12. Independent review has no blocker/critical/major finding.

## Automatic NO-GO

- missing accepted dependency;
- user pipeline TRUE;
- unknown/blank active user;
- second Apps Script backend or bound script;
- any write path;
- any direct RAW/Publish read;
- any recreated backend logic;
- mismatch between UI and accepted read models.
