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

- [x] INSERT/UPDATE/DELETE/NOOP.
- [x] Atomic affected-set publication.
- [x] Lost-response recovery.
- [x] Timeout before/after every long phase.
- [x] Third-state fail-closed.
- [x] Unrelated rows unchanged.
- [x] Latest correctness.
- [x] Standard logical reversal.

Gate закрыт результатом `AKORT_alpha74Gate4Acceptance()` в DEV
27 июля 2026 года. Все нормативные scenarios и семь timeout phases получили
PASS; DataLens-connected Publish осталась неизменной.

## Gate 5 — Full reconciliation/performance

- [ ] Full historical build.
- [ ] Sequential replay.
- [ ] Exact full-vs-incremental reconciliation.
- [ ] Baseline parity.
- [ ] Maximum-volume/quota acceptance.
- [ ] No manual continuation.

Локальный Gate 5 trigger-driven harness и regression suite подготовлены.
После DEV timeout-loop `FULL_BUILD / MONTHLY` в `4.0.0-alpha.7.4.2`
релиз `7.4.3` добавил write cursor, но DEV code review обнаружил повторный
полный расчёт payload перед каждым chunk. В `4.0.0-alpha.7.4.4` payload
каждой стадии материализуется один раз в isolated sheet, а target заполняется
bounded cursor-copy. Остановленные execution сохраняются для диагностики;
DEV execution `A74_GATE5_CDEFB6487105607FB35F` завершил full build, но выявил
отсутствие canonical index expansion в aggregate replay. Release `7.4.6`
переиспользует production expansion и создаёт `state-4` replay-only recovery,
сохраняя completed full build. Чек-лист остаётся открытым до terminal
`SUCCESS` нормативного DEV-запуска `AKORT_alpha74Gate5RestartReplay()`, exact
reconciliation и проверки JSON evidence.
Regular pipeline остаётся выключенным.

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
