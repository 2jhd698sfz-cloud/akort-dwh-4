# Alpha.7.4.32 — безопасная остановка и восстановление Gate 6

## Подтверждённое исходное состояние

Gate 6 `.30` завершил rollback scan и находится в `RUNNING / VERIFY_ROLLBACK`.
Weekly, Monthly и Industry точно совпадают с baseline. В
`PUBLISH_PRICE_AGGREGATES` осталось ровно `61 832 - 61 636 = 196` legacy
weekly rows. Restore operation не создана; regular и user pipelines выключены.

Worker повторно получает lease, но terminal `FAILED` checkpoint не
сохраняется: накопленный state вместе с диагностикой mismatch превышает
безопасный размер одного Script Properties value. Publish при этих вызовах не
изменяется.

Release `.32`:

- гарантированно сокращает terminal diagnostic state перед повторной записью;
- сохраняет operation IDs, digests и recovery evidence;
- допускает exact recovery не только из `FAILED / VERIFY_ROLLBACK`, но и из
  безопасно остановленного `STOPPED / stoppedFromPhase=VERIFY_ROLLBACK`;
- по-прежнему отвергает `RUNNING` state и любой другой набор данных.

## До commit и clasp push

Сначала в текущей `.31` один раз выполнить:

```javascript
AKORT_alpha74Gate6Stop()
```

Ожидается `ok=true`, state `STOPPED`, `stoppedFromPhase=VERIFY_ROLLBACK`,
regular/user `FALSE`, trigger удалён. Stop не изменяет RAW или Publish.

После завершения Stop выждать не менее 6 минут, чтобы ранее захватившее lease
выполнение worker гарантированно завершилось. Ничего другого в Apps Script в
это окно не запускать.

## Commit

Перед commit:

```bash
npm test
git diff --check
git status --short
```

Рекомендуемый заголовок:

```text
fix(alpha74): recover stopped Gate 6 rollback checkpoint
```

Рекомендуемое описание:

```text
Compact oversized terminal Gate 6 diagnostics and allow the exact safely
stopped Alpha.7.4.30 VERIFY_ROLLBACK +196-row checkpoint to enter the bounded
canonical weekly repair without repeating canary or reversal.
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

Ожидается release `4.0.0-alpha.7.4.32`; regular/user остаются `FALSE`.

### 2. Проверки без live writes

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Допустимы только два exact source state:

- `STOPPED / stoppedFromPhase=VERIFY_ROLLBACK`; или
- `FAILED / failedFromPhase=VERIFY_ROLLBACK /
  ALPHA74_GATE6_ROLLBACK_MISMATCH`.

Обязательно: release сохранённого state `.30`, restore operation пустая,
Aggregates `61 832`, остальные rollback digests равны baseline, trigger count
`0`, regular/user `FALSE`.

### 3. Exact recovery — один раз

```javascript
AKORT_alpha74Gate6RecoverWeeklyRollbackPeriod()
```

Ожидается `ok=true`, `status=RUNNING`,
`phase=RECOVER_WEEKLY_ROLLBACK_PERIOD`, mode
`WEEKLY_ROLLBACK_PERIOD_CANONICAL_REPAIR`.

Worker удалит только 196 доказанных legacy rows пакетами максимум по 16
полных logical series, проверит read-back, создаст новый execution ID и
перезапустит полный Gate 6 с canonical Sunday identity.

### 4. Мониторинг

Далее запускать только:

```javascript
AKORT_alpha74Gate6Status()
```

Проверять раз в 2–3 минуты. Не запускать вручную `Start`, `Resume`, `Stop`,
`Worker`, повторный recovery или Industry submit.

При `SUCCESS` должны быть одновременно подтверждены:

- `rollbackExact=true`;
- `restoreExact=true`;
- aggregate contract scan `ok=true`;
- Weekly, Monthly, Industry и Aggregates точны во всех digest-сравнениях;
- regular pipeline `TRUE`;
- user pipeline `FALSE`.
