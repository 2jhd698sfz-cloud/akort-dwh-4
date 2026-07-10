# Test report template

## Required executions
- `AKORT_alpha2Install`
- `AKORT_alpha2SmokeTest`
- `AKORT_alpha2Status`

## Acceptance criteria
- install result: `ok=true`, `status=SUCCESS`;
- smoke result: `ok=true`, `status=SUCCESS`;
- all smoke tests: `PASS`;
- five service tables exist with exact schemas;
- release `4.0.0-alpha.2` is registered with status `INSTALLED`;
- baseline physical row counts are unchanged;
- `SYSTEM_LOG` receives a smoke event;
- a second `AKORT_alpha2Install` returns success and does not duplicate tables or the release record.

## Actual result
To be completed after execution in DEV.

## Pre-delivery validation
- JavaScript syntax: PASS
- release manifest JSON: PASS
- shell scripts syntax: PASS
- mocked first installation: PASS
- mocked repeated installation/idempotence: PASS
- mocked Core Foundation smoke test: 9/9 PASS
