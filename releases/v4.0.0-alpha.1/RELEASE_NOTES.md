# v4.0.0-alpha.1

## Objective

Create a safe and testable DEV foundation before migration of parsers, RAW storage, Publish calculations or aggregates.

## Included

- isolated DEV resource configuration;
- production-resource block list;
- immutable release metadata;
- uniform result and logging contracts;
- read-only environment checks;
- resumable spreadsheet inventory;
- deterministic header, chunk and sheet hashes;
- baseline row/latest/schema controls;
- deployment guard for `clasp push`;
- installation, test and rollback documentation.

## Explicitly excluded

- production deployment;
- ETL file parsing;
- RAW writes;
- Publish recalculation;
- aggregate recalculation;
- automated triggers;
- user interface.

## Baseline

`VERIFIED_BASELINE_2026-07-10`, production compatibility `3.1.7`.
