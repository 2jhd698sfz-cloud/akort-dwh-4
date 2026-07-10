# Test plan — v4.0.0-alpha.1

## T01 — deployment target

`npm run deploy:dev` must stop when `.clasp.json` and `src/99_LocalConfig.js` contain different Script IDs.

## T02 — environment guard

`AKORT_alpha1EnvironmentCheck` must confirm:

- environment is DEV;
- Script ID is the approved DEV project;
- DWH and Publish names match DEV copies;
- development folders are accessible;
- no active resource equals a blocked production resource.

## T03 — smoke test

`AKORT_alpha1SmokeTest` must return `SUCCESS`.

## T04 — resumability

Start a baseline scan. When it returns `PAUSED`, run `AKORT_alpha1ContinueBaseline`. Previously written chunk rows must not be duplicated.

## T05 — baseline controls

The completed report must match the verified baseline of 10 July 2026:

- RAW rows: 27,899;
- Publish main rows: 35,434;
- aggregate rows: 61,636;
- weekly latest rows: 157;
- monthly latest rows: 378;
- aggregate latest rows: 1,364.

## T06 — schema controls

The exact headers of the seven critical RAW/Publish sheets must pass.

## T07 — production isolation

No production file may have a modified timestamp caused by alpha.1 testing. Alpha.1 contains no production-writing entry point.
