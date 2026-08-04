# Alpha.7.4.35 — commit, clasp push и завершение Gate 6 evidence

## 1. Что исправлено

Gate 6 выполнил весь authoritative DEV cycle:

- canary operation — `SUCCESS`;
- exact rollback — подтверждён;
- restore operation — `SUCCESS`;
- final Publish равен post-canary для Weekly, Monthly, Industry и Aggregates;
- финальный aggregate contract scan — `ok=true`.

Ошибка возникла только в `SAVE_EVIDENCE`: повторный RAW audit ожидал у canary
статус `COMMITTED`, хотя после доказанного rollback canary load штатно имеет
статус `REVERSED`.

Release `.35`:

- принимает `REVERSED` только для canary после уже подтверждённых exact rollback
  и restore;
- сохраняет evidence без повторения parser, RAW commit, Publish или Aggregates;
- ограничивает recovery точными IDs и состоянием текущего `.34` incident;
- делает повторный `Gate6Start` безопасным `SUCCESS/no-op`, если Gate текущего
  release уже выполняется или завершён.

## 2. Локальная проверка и commit

В каталоге репозитория:

```bash
git status --short --branch
git diff --check
npm test
```

Ожидается: все тесты проходят, посторонних файлов в diff нет.

Рекомендуемый commit summary:

```text
fix(alpha74): finalize Gate 6 evidence after reversed canary
```

Рекомендуемое описание commit:

```text
- accept the canary REVERSED lifecycle only after exact rollback and restore
- recover the exact .34 SAVE_EVIDENCE incident without replaying data operations
- make Start idempotent for an already running or completed Gate
- add regression coverage and the .35 operator runbook
```

## 3. Clasp push

После собственного commit:

```bash
clasp status
clasp push
```

Убедиться, что в Apps Script появился release
`4.0.0-alpha.7.4.35` и функция
`AKORT_alpha74Gate6RecoverEvidenceFinalization`.

## 4. Apps Script — выполнять строго последовательно

Сначала read-only проверки:

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- release `.35`;
- smoke и contract scan — `SUCCESS`, `physicalWrites=false`;
- сохранённый Gate state: `.34 / FAILED / failedFromPhase=SAVE_EVIDENCE`;
- `lastError.code=ALPHA74_GATE6_RAW_AUDIT_FAILED`;
- canary, reversal и restore operations — `SUCCESS`;
- rollback и final digests точные;
- regular pipeline `FALSE`, user pipeline `FALSE`, trigger `0`.

Затем ровно один раз:

```javascript
AKORT_alpha74Gate6RecoverEvidenceFinalization()
```

Ожидается `ok=true`, `status=SUCCESS`. Recovery:

- не создаёт новых data operations;
- не повторяет source parsing/staging;
- не повторяет RAW commit/reversal/restore;
- не пересобирает Weekly, Monthly, Industry или Aggregates;
- создаёт только финальный evidence и переводит Gate 6 в `SUCCESS`;
- включает regular pipeline и оставляет user pipeline выключенным.

Не запускать `Gate6Start`, `Gate6Resume`, `Gate6Worker` и старые recovery.

## 5. Финальная проверка

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Критерии:

- Gate state `SUCCESS / SUCCESS`;
- evidence заполнен;
- `rollbackExact=true` и `restoreExact=true`;
- aggregate contract scan `ok=true`;
- duplicate logical rows, latest failures и future rows отсутствуют;
- regular pipeline `TRUE`;
- user pipeline `FALSE` до Gate 7.

Ориентировочное время recovery и финальной проверки: 2–5 минут.
