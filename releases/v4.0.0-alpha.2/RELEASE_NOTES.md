# v4.0.0-alpha.2 — Core Foundation

## Goal
Create the stable system foundation for AKORT 4.0 without changing RAW or Publish data.

## New core modules
- `src/00_Release.js`
- `src/01_Config.js`
- `src/02_Core.js`

## Service tables
- `SYSTEM_SETTINGS`
- `RELEASE_REGISTRY`
- `OPERATION_QUEUE`
- `OPERATION_STEPS`
- `SYSTEM_LOG`

## Capabilities
- unified `AKORT` namespace;
- release manifest and deterministic SHA-256 manifest hash;
- local, Script Properties and `SYSTEM_SETTINGS` configuration layers;
- standard result and exception contracts;
- operation, step, execution and log identifiers;
- script locking;
- structured logging to `SYSTEM_LOG`;
- idempotent schema installation;
- release registration and manifest conflict protection;
- baseline physical-row regression checks.

## Safety boundary
The release only creates and writes the five service tables in the DEV DWH. It does not alter RAW or Publish sheets. Production 3.1.7 is not accessed.

## Known limitations
- `OPERATION_QUEUE` and `OPERATION_STEPS` are schema foundations only; the state machine is implemented in alpha.3.
- No parser, RAW writer, Publish recalculation or aggregate recalculation is introduced in this release.
- Production cutover remains prohibited.
