# Alpha.7.4.30 — commit, clasp push и продолжение Gate 6

## До commit и deploy

Текущий `.29` state необходимо нормализовать до безопасной границы:

```javascript
AKORT_alpha74Gate6Stop()
```

Обязательный результат:

- `ok=true`;
- `status=STOPPED`, `phase=STOPPED`;
- `stoppedFromPhase=ROLLBACK_SCAN`;
- `operationStopRequested=true`;
- reversal operation остаётся `SUCCESS`;
- `operations.restore` пуст;
- recovery-копии сохранены.

## Commit

Рекомендуемый заголовок:

```text
fix(alpha74): compact Gate 6 rollback scan state
```

Рекомендуемое описание:

```text
Compact nested recovery lineage below the Script Properties limit, persist
terminal fail-closed state before trigger cleanup, and exactly resume the
stopped Alpha.7.4.29 rollback scan without repeating canary or reversal.
```

Перед commit:

```bash
npm test
git status --short
git diff --check
```

## clasp push

```bash
clasp status
clasp push
```

Не выполнять `clasp push` до подтверждённого Stop текущего Gate 6.

## Apps Script после push

Выполнять строго последовательно.

### 1. Install

```javascript
AKORT_alpha74Install()
```

Install должен вернуть release `4.0.0-alpha.7.4.30`. На этой границе regular
и user pipelines остаются `FALSE`.

### 2. Проверки без live writes

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- smoke test `SUCCESS`, physical writes `false`;
- aggregate contract scan `SUCCESS`;
- Gate 6 state всё ещё `STOPPED / stoppedFromPhase=ROLLBACK_SCAN`;
- сохранены baseline, post-canary и rollback Weekly/Monthly digest;
- `operations.restore` пуст;
- `publishEngineEnabled=true`;
- `executionEnabled=true`;
- `regularPipelineEnabled=false`;
- `userPipelineEnabled=false`.

### 3. Exact Resume

Один раз:

```javascript
AKORT_alpha74Gate6Resume()
```

Ожидается:

- release `4.0.0-alpha.7.4.30`;
- `status=RUNNING`;
- `phase=ROLLBACK_SCAN`;
- `stoppedFromPhase` пуст;
- recovery mode `ROLLBACK_SCAN_STATE_CAPACITY_RECOVERY`;
- regular pipeline включён;
- canary и reversal не повторяются.

### 4. Мониторинг

Далее запускать только:

```javascript
AKORT_alpha74Gate6Status()
```

Проверять статус достаточно раз в 2–3 минуты. Один worker может законно
работать несколько минут без нового внешнего checkpoint. Если `updatedAt` не
меняется более 10 минут, state переходит в `FAILED` или regular pipeline снова
становится `FALSE` до `SUCCESS`, ничего дополнительно не запускать: сохранить
полный Status output для разбора.

Нормальная последовательность:

```text
ROLLBACK_SCAN
→ VERIFY_ROLLBACK
→ ENQUEUE_RESTORE
→ RUN_RESTORE
→ FINAL_SCAN
→ FINAL_VALIDATION
→ SAVE_EVIDENCE
→ SUCCESS
```

До `SUCCESS` не выполнять Install повторно, Gate6Start, Validate, Resume,
ручной worker, Industry Submit или другие загрузки.
