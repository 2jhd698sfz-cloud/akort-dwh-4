# Alpha.7.4.31 — commit, clasp push и восстановление Gate 6

> Этот runbook заменён документом
> `ALPHA74_32_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`: live state остался
> `RUNNING / VERIFY_ROLLBACK`, потому что terminal mismatch diagnostic не
> поместился в Script Properties. Последовательность `.31` больше не выполнять.

## Подтверждённое исходное состояние

Gate 6 `.30` штатно завершился fail-closed в `VERIFY_ROLLBACK`:

- `PUBLISH_PRICES_WEEKLY`, `PUBLISH_PRICES_MONTHLY` и `PUBLISH_INDUSTRY`
  точно совпали с baseline;
- baseline `PUBLISH_PRICE_AGGREGATES` содержит `61 636` строк;
- post-canary содержит `62 028` строк;
- rollback содержит `61 832` строки, то есть ровно `+196` к baseline;
- regular и user pipelines выключены;
- restore operation не создана;
- recovery-копии сохранены.

Причина: canary записал 196 weekly aggregates с `period_label=2026-W27`, но
с физическим `period_start=2026-07-04`. Штатный reversal искал воскресенье
`2026-07-05`, поэтому удалил 196 monthly-derived rows и не распознал 196
weekly rows.

До deploy ничего в Apps Script не запускать. Не изменять Publish вручную.

## Commit

Рекомендуемый заголовок:

```text
fix(alpha74): recover canonical weekly Gate 6 rollback
```

Рекомендуемое описание:

```text
Canonicalize weekly aggregate periods from ISO week labels, remove the exact
196 legacy Saturday rows in bounded atomic series batches, and restart Gate 6
from a clean baseline so rollback and restore are verified against canonical
Sunday identities across all Publish targets including Industry.
```

Перед commit:

```bash
npm test
git diff --check
git status --short
```

## clasp push

После собственного commit:

```bash
clasp status
clasp push
```

## Apps Script после push

Выполнять строго последовательно.

### 1. Install

```javascript
AKORT_alpha74Install()
```

Install сам выполняет Operation Schema preflight и должен вернуть release
`4.0.0-alpha.7.4.31`. Оба флага должны
оставаться выключенными:

- `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED=FALSE`;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

### 2. Проверки без live writes

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- smoke test `SUCCESS`, `physicalWrites=false`;
- contract scan `SUCCESS`;
- сохранённый Gate state `.30` имеет `FAILED / VERIFY_ROLLBACK`;
- ошибка `ALPHA74_GATE6_ROLLBACK_MISMATCH`;
- restore operation отсутствует;
- regular и user pipelines `FALSE`.

### 3. Exact recovery — один раз

```javascript
AKORT_alpha74Gate6RecoverWeeklyRollbackPeriod()
```

Функция должна вернуть `ok=true`, `status=RUNNING`,
`phase=RECOVER_WEEKLY_ROLLBACK_PERIOD` и recovery mode
`WEEKLY_ROLLBACK_PERIOD_CANONICAL_REPAIR`.

Далее worker автоматически:

1. удалит ровно 196 legacy weekly rows детерминированными пакетами максимум по
   16 полных logical series;
2. проверит read-back и latest-флаги после каждого атомарного пакета;
3. вернёт aggregate target к baseline `61 636`;
4. создаст новый execution ID без новых ручных действий;
5. начнёт чистый трёхцикловый Gate 6 с каноническим воскресеньем;
6. проверит Weekly, Monthly, Industry и Aggregates.

### 4. Мониторинг

Далее запускать только:

```javascript
AKORT_alpha74Gate6Status()
```

Проверять раз в 2–3 минуты. Не запускать `Start`, старый `Resume`, `Stop` или
`Worker` вручную. После repair нормальная последовательность начинается заново:

```text
BASELINE_SCAN
→ ARM_CANARY
→ SUBMIT_CANARY
→ RUN_CANARY
→ POST_CANARY_SCAN
→ VERIFY_CANARY
→ ENQUEUE_REVERSAL
→ RUN_REVERSAL
→ ROLLBACK_SCAN
→ VERIFY_ROLLBACK
→ ENQUEUE_RESTORE
→ RUN_RESTORE
→ FINAL_SCAN
→ FINAL_VALIDATION
→ SAVE_EVIDENCE
→ SUCCESS
```

При `SUCCESS` должны быть одновременно подтверждены:

- `rollbackExact=true`;
- `restoreExact=true`;
- aggregate contract scan `ok=true`;
- `PUBLISH_INDUSTRY` точен во всех digest-сравнениях;
- regular pipeline `TRUE`;
- user pipeline `FALSE`.
