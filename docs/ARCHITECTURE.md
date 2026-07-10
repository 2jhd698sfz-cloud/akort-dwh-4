# Alpha.1 architecture

`v4.0.0-alpha.1` introduces only the safe development foundation. It does not implement production ETL and does not modify the DEV copies of DWH or Publish.

## Modules

- `00_Namespace.js` — shared Apps Script namespace.
- `01_Release.js` — immutable release metadata.
- `02_Config.js` — local/Script Properties configuration with masked diagnostics.
- `03_Result.js` — standard operation result contract.
- `04_Logger.js` — structured execution logging.
- `05_EnvironmentGuard.js` — blocks execution outside the approved DEV resources.
- `06_Baseline.js` — resumable sheet inventory and deterministic chunk hashes.
- `07_Alpha1Tests.js` — smoke tests.
- `08_EntryPoints.js` — global functions visible in Apps Script.

## Safety boundaries

- Production Script ID is not used.
- Production spreadsheet and upload-folder IDs are listed as blocked only in the local, Git-ignored configuration.
- Baseline processing reads DWH/Publish DEV copies and writes only a new report file in the DEV test-results folder.
- Checkpoints are stored in Script Properties under `AKORT_ALPHA1_BASELINE_STATE`.
- The process can be resumed after timeout without rescanning completed chunks.
