# Beta.2.3 — Acceptance Matrix candidate-r5

## A. Identity and regression

1. Base branch and commit are exactly `codex/beta-2.3-control-center-operator-actions` / `10430fe3a51b7b4b007f9442684fc0aed85f49e5`.
2. Installer accepts only the exact candidate-r4 uncommitted hashes and ten-path working-tree scope.
3. Candidate-r5 changes exactly the same ten approved paths.
4. Focused Beta.2.3 suite, full `npm test` and `git diff --check` pass.
5. No queue, executor, dispatcher, worker, operation type, trigger, production ID, DataLens mutation, restore or physical-delete endpoint is introduced.

## B. Corrective finding 1 — profile isolation

1. Every parser profile member carries its accepted `source_file_type`.
2. Rosstat members are scoped by active `DIM_PRODUCT_MAPPING.category_id`.
3. Shared PPI/producer `indicator_key` does not merge industry and agriculture.
4. Exact preferred canonical period is mandatory; another profile/period is not used as fallback.
5. Distinct-profile/different-period dynamic tests pass.

## C. Corrective finding 2 — freshness transaction

1. `USER_DATA_FRESHNESS_STAGE` has the exact target schema.
2. Main read and refresh share one Script Lock.
3. Stage read-back must exactly equal candidate snapshot before target replacement.
4. Target read-back must exactly equal stage/candidate snapshot.
5. Simulated target failure restores and verifies the previous snapshot.
6. Duplicate members and bounded-row violations fail before target mutation.

## D. Corrective finding 3 — mandatory audit

1. STARTED audit is flushed before delegated side effects and `flush()` must return exactly `1`.
2. `flush() === 0`, multi-row persistence or an audit exception prevents callback execution.
3. COMPLETED audit is attempted on success and failure.
4. Audit errors are not swallowed.
5. Rollback preview/submit, backup, quick/full audit, freshness refresh and operation controls are audited without recording secrets or raw values.

## E. Corrective finding 4 — operation origin

1. Current-user `created_by` ownership is mandatory.
2. `SOURCE_FILE_LOAD_V4` requires exact Beta.2.2 binding and deterministic idempotency key.
3. `RAW_LOAD_V4` requires exact accepted Industry Input source/target/content hash/idempotency.
4. Backup, Full Audit and reversal require their exact accepted input/meta bindings.
5. Foreign user, legacy, acceptance/Gate and unrelated service operations are rejected.
6. Origin is rechecked after continue, stop and retry.

## F. Existing controlled UAT retained

Roles, Russian UI, bounded search, backup/audit delegation, one-step Continue, HMAC rollback binding and fail-closed feature gates remain as specified. All gates return to FALSE after UAT. The candidate is not accepted until external independent review and the required controlled DEV evidence return GO.

## G. Corrective candidate-r5

1. Видимая разметка не содержит `DEV`, номера Beta, `Industry Input`, `RAW_LOAD_V4`, `load_id`, `operation_id` или canonical week key.
2. Роли, типы данных и периоды имеют русские пользовательские подписи.
3. Поиск возвращает `profileNameRu` и `periodRu`.
4. `flush() === 0` вызывает `BETA23_ACTION_AUDIT_NOT_PERSISTED`, а callback не запускается.
5. Focused suite и полный regression suite должны завершиться PASS.
