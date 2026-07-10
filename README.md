# AKORT DWH 4.0

Repository for the controlled migration of the AKORT analytical monitoring system from production 3.1.7 to architecture 4.0.

## Current release

`v4.0.0-alpha.1` — DEV foundation, environment protection, smoke tests and resumable baseline snapshot.

## Safety rule

This release is DEV-only. It must never write to production spreadsheets or folders. Resource identifiers are stored in the local-only file `src/99_LocalConfig.js`, which is excluded from Git.

## Main commands

```bash
npm run status:dev
npm run deploy:dev
```

See `docs/INSTALLATION.md` before the first deployment.
