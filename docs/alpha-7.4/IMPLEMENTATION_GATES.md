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

- [x] Проверено отсутствие runtime-кода withdrawn candidates.
- [x] Устранена или административно закрыта stale `RUNNING` операция.
- [x] Подтверждена canonical Config resource map.
- [x] Зафиксирован operation schema migration `4.0-operation-2`.
- [x] Утверждён `AGGREGATE_STAGE` schema.
- [x] Определены atomic request limits и fail-closed behavior.
- [x] Получен GO на coding.

## Gate 2 — Pure/static implementation

- [x] Operation Engine расширен aggregate phases.
- [x] Alpha.6 impact подключён как authoritative input.
- [x] Alpha.7.3 planner интегрирован.
- [x] Alpha.7.2 calculator интегрирован.
- [x] Durable staging реализован.
- [x] Logical-series publish adapter реализован.
- [x] Physical row identity отсутствует.
- [x] Separate dispatcher/queue отсутствует.
- [x] Unit/static tests проходят.

## Gate 3 — Isolated read-only

- [x] Contract scan 61 636 rows.
- [x] Aggregate logical-key index.
- [x] Snapshot/fingerprint checks.
- [x] Parameterless DEV acceptance harness.
- [x] Machine-readable evidence contract.
- [x] New period plan.
- [x] Revision plan.
- [x] Reversal plan.
- [x] No future periods.
- [x] No physical writes.

Gate закрыт результатом `AKORT_alpha74Gate3Acceptance()` в DEV
27 июля 2026 года. Все три сценария и шесть weekly/monthly fixture runs
завершены успешно; before/after data-plane fingerprint совпал.

## Gate 4 — Isolated physical/fault

- [ ] INSERT/UPDATE/DELETE/NOOP.
- [ ] Atomic affected-set publication.
- [ ] Lost-response recovery.
- [ ] Timeout before/after every long phase.
- [ ] Third-state fail-closed.
- [ ] Unrelated rows unchanged.
- [ ] Latest correctness.
- [ ] Standard logical reversal.

Локальный Gate 4 harness и regression suite подготовлены. Чек-лист остаётся
открытым до `SUCCESS` нормативного DEV-запуска
`AKORT_alpha74Gate4Acceptance()` и проверки сохранённого evidence.

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
- [x] Release manifest и sourceFiles актуальны.
- [x] README/package/runtime version синхронизированы.
- [x] Machine-readable evidence сохранены.
- [ ] Accepted commit/tag созданы.
- [ ] Alpha.7.4 = `ACCEPTED_AND_CLOSED`.
