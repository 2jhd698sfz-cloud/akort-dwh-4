# Test report — v4.0.0-alpha.1

Validation performed before delivery on 10 July 2026.

## Static validation

- Node.js syntax check passed for every `.js` file in `src`.
- `bash -n` passed for `scripts/deploy-dev.sh`.
- JSON parsing passed for `appsscript.json`, `package.json` and `release-manifest.json`.

## Mock runtime smoke test

A Node.js test harness emulated the required Apps Script services and executed `AKORT_alpha1SmokeTest` against the configured DEV resource names and identifiers.

Result: `SUCCESS`.

Passed checks:

- release version contract;
- result object contract;
- deterministic hashing;
- DEV environment marker;
- Script ID match;
- production-resource conflict check;
- DWH/Publish DEV names;
- all development-folder names.

## Pending Google runtime tests

The following require deployment to the real DEV Apps Script project:

- OAuth authorization;
- actual Drive/Sheets access;
- resumable scan of all DWH and Publish sheets;
- verified baseline row/latest/schema controls;
- creation of the baseline report in the DEV results folder.
