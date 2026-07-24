# Alpha.7.4 — Implementation Gates

## Gate 0 — Organizational reset

- [x] Accepted base определена: `52590c8...`.
- [x] Новая ветка не наследует candidate-r3.
- [x] Integration map подготовлена.
- [x] Final contract подготовлен.
- [x] Старый candidate-r3 выведен из активного контура и сохранён во внутреннем архиве.
- [x] Активный комплект Alpha.7.4 создан во внутреннем рабочем пространстве.
- [x] Локальная Git-ветка и документационный commit созданы.
- [x] Публичный комплект очищен от внутренних URL и идентификаторов ресурсов.

## Gate 1 — Pre-code

- [ ] Проверено отсутствие runtime-кода withdrawn candidates.
- [ ] Устранена или административно закрыта stale `RUNNING` операция.
- [ ] Подтверждена canonical Config resource map.
- [ ] Зафиксирован operation schema migration `4.0-operation-2`.
- [ ] Утверждён `AGGREGATE_STAGE` schema.
- [ ] Определены atomic request limits и fail-closed behavior.
- [ ] Получен GO на coding.

## Gate 2 — Pure/static implementation

- [ ] Operation Engine расширен aggregate phases.
- [ ] Alpha.6 impact подключён как authoritative input.
- [ ] Alpha.7.3 planner интегрирован.
- [ ] Alpha.7.2 calculator интегрирован.
- [ ] Durable staging реализован.
- [ ] Logical-series publish adapter реализован.
- [ ] Physical row identity отсутствует.
- [ ] Separate dispatcher/queue отсутствует.
- [ ] Unit/static tests проходят.

## Gate 3 — Isolated read-only

- [ ] Contract scan 61 636 rows.
- [ ] Aggregate logical-key index.
- [ ] Snapshot/fingerprint checks.
- [ ] New period plan.
- [ ] Revision plan.
- [ ] Reversal plan.
- [ ] No future periods.
- [ ] No physical writes.

## Gate 4 — Isolated physical/fault

- [ ] INSERT/UPDATE/DELETE/NOOP.
- [ ] Atomic affected-set publication.
- [ ] Lost-response recovery.
- [ ] Timeout before/after every long phase.
- [ ] Third-state fail-closed.
- [ ] Unrelated rows unchanged.
- [ ] Latest correctness.
- [ ] Standard logical reversal.

## Gate 5 — Full reconciliation/performance

- [ ] Full historical build.
- [ ] Sequential replay.
- [ ] Exact full-vs-incremental reconciliation.
- [ ] Baseline parity.
- [ ] Maximum-volume/quota acceptance.
- [ ] No manual continuation.

## Gate 6 — Authoritative DEV

- [ ] Immutable backup.
- [ ] Authoritative DEV canary.
- [ ] Read-back and reconciliation PASS.
- [ ] Regular aggregate pipeline enabled.
- [ ] Несколько регулярных DEV cycles без intervention.
- [ ] Recovery/rollback protocol проверен.

## Gate 7 — Acceptance

- [ ] Independent final review.
- [ ] Нет blocker/critical/major.
- [ ] Release manifest и sourceFiles актуальны.
- [ ] README/package/runtime version синхронизированы.
- [ ] Machine-readable evidence сохранены.
- [ ] Accepted commit/tag созданы.
- [ ] Alpha.7.4 = `ACCEPTED_AND_CLOSED`.
