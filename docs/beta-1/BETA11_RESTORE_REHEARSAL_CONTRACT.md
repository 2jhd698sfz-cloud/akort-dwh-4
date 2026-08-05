# Beta.1.1 r6 — Isolated Restore Rehearsal

Package: `4.0.0-beta.1.1.7`

Target backup: `BKP_DAILY_20260805`

The rehearsal closes the Beta.1.1 acceptance gap required by the active
roadmap: restore must be demonstrated only in an isolated copy and immutable
evidence must be retained.

The operation type is `BETA11_RESTORE_REHEARSAL`. It is executed by the
accepted `AKORT.OperationEngine` and started through the accepted Beta.1.4
guard as a snapshot-exclusive operation.

The rehearsal:

1. validates the exact successful `BACKUP_REGISTRY` row;
2. validates the manifest hash and DWH/Publish member binding;
3. creates or adopts a deterministic isolated folder under
   `09_Проверка восстановления`;
4. copies only the DWH and Publish backup members into that folder;
5. compares each backup member with its restored copy in bounded,
   resumable chunks;
6. compares workbook locale, timezone, named ranges, sheet inventory,
   visibility, frozen rows/columns, dimensions, cell values, R1C1 formulas
   and number formats;
7. saves one deterministic JSON evidence file with source/restored file IDs,
   workbook and sheet fingerprints, checks and safety boundaries.

The operation never points `99_LocalConfig` or system settings to the restored
copies. It does not modify active DEV DWH or Publish, create or delete
triggers, delete files, touch production, or enable the user pipeline.

The restored copies and evidence remain in the isolated folder for review.


## r7 continuation optimization

r7 preserves the active r6 checkpoint and restored files. One continuation
may process up to 640,000 cells, 40 chunks or 210 seconds.
`AKORT_beta11RestoreRehearsalProgressLatest` returns compact DWH and Publish
cursor, processed cells, total cells and percentage without data-plane writes.
