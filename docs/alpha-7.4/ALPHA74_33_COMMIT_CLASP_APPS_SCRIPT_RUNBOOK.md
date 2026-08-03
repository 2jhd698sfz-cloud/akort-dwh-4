# Alpha.7.4.33 — восстановление Gate 6 после переполнения checkpoint

## Подтверждённое исходное состояние

Gate 6 `.32` остановлен в `RUN_REVERSAL`. Операция
`OP_RAW_REVERSAL_V4_20260803T133248118Z_82520905BF9A` выполнила:

- RAW rollback: `50/50` строк;
- обычный Publish цен: `13 100` weekly + `3 100` monthly;
- materialization: `72/72` комбинации;
- calculation: `392/392` строки;
- физический stage: ровно `392` строк со статусом `STAGED`;
- aggregate publish: не начинался, publish-intent отсутствует.

Worker повторял `STAGING_AGGREGATE_ROWS`, потому что operation checkpoint
содержал полный массив из 50 записей RAW reversal. Добавление 392 ключей
aggregate series превышало ограничение Google Sheets в 50 000 символов на
ячейку. Ошибка ошибочно отображалась как `LOCK_ACQUISITION_FAILED`.

Release `.33` хранит в checkpoint только компактную ссылку на доказанные
записи `RAW_REVERSAL_LOG`, проверяет размер ячейки до записи, сокращает
`OPERATION_STEPS` audit payload и разрешает exact recovery текущего incident.
Recovery принимает уже записанные 392 строки и продолжает непосредственно с
`UPDATING_AGGREGATES`. RAW rollback, Publish цен, materialization и calculation
не повторяются.

## 1. Обязательная остановка до commit и push

В Apps Script на установленной `.32` выполнить ровно один раз:

```javascript
AKORT_alpha74Gate6Stop()
```

Продолжать только если результат содержит:

- `ok=true`;
- `status=STOPPED`;
- `stoppedFromPhase=RUN_REVERSAL`;
- regular pipeline `FALSE`;
- user pipeline `FALSE`;
- Gate 6 trigger отсутствует.

После Stop не запускать `Start`, `Resume`, `Worker`, другой recovery или
Industry submit. Stop не меняет RAW и Publish.

## 2. Проверки и commit

В корне локального репозитория:

```bash
cd '/Users/ivankarabelnikov/Documents/Аналитический центр/akort-dwh-4-alpha74'
npm test
git diff --check
git status --short
```

Рекомендуемый заголовок commit:

```text
fix(alpha74): compact reversal checkpoints and recover Gate 6
```

Рекомендуемое описание:

```text
Compact durable RAW reversal checkpoints and operation-step audit cells,
preserve callback errors from the script-lock boundary, and recover the exact
stopped Alpha.7.4.32 Gate 6 operation from its validated 392-row STAGED
snapshot without repeating RAW rollback, price Publish, materialization or
aggregate calculation.
```

Commit и push в GitHub пользователь выполняет самостоятельно.

## 3. clasp push

После commit:

```bash
clasp status
clasp push
```

Не использовать `clasp push --force`. В `clasp push` должны попасть только
файлы этого репозитория.

## 4. Apps Script после push

Выполнять строго последовательно, по одной функции. Между функциями дождаться
полного результата в Execution log.

### 4.1. Install

```javascript
AKORT_alpha74Install()
```

Ожидается release `4.0.0-alpha.7.4.33`. Regular и user pipelines должны
остаться `FALSE`.

`AKORT_alpha74Gate6Install()` повторно не запускать: текущий Gate state и
control sheet уже существуют.

### 4.2. Проверки без live writes

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- smoke test: `SUCCESS`, release `.33`, `physicalWrites=false`;
- read-only scan: `SUCCESS`, дубли, future rows и latest failures отсутствуют;
- Gate: `STOPPED / stoppedFromPhase=RUN_REVERSAL`;
- reversal operation: `PAUSED` или drained `RUNNING`, phase
  `STAGING_AGGREGATE_ROWS`, `stopRequested=true`;
- Gate trigger `0`, regular/user `FALSE`;
- restore operation отсутствует.

### 4.3. Exact recovery — один раз

```javascript
AKORT_alpha74Gate6RecoverReversalCheckpointCapacity()
```

Ожидается `ok=true` и сообщение о compact checkpoint. В состоянии Gate:

- release `.33`;
- `status=RUNNING`, `phase=RUN_REVERSAL`;
- recovery mode `REVERSAL_CHECKPOINT_CELL_CAPACITY_RECOVERY`;
- operation продолжает с `UPDATING_AGGREGATES`;
- regular pipeline `TRUE`, user pipeline `FALSE`;
- сохранены `50` RAW rollback rows, `16 200` price Publish rows и `392`
  aggregate stage rows;
- все признаки повторного RAW/Publish/calculation равны `false`.

Если recovery вернул `activeLease=true`, не запускать другие функции. Подождать
2 минуты, проверить `AKORT_alpha74Gate6Status()` и повторить только эту recovery
функцию, только если Gate всё ещё `STOPPED`, trigger `0`, regular/user `FALSE`.

Любой другой `SOURCE_INVALID`, изменившийся hash источника, появившийся
publish-intent или отличное число stage rows — fail-closed остановка. Ничего не
исправлять вручную в таблицах.

## 5. Мониторинг

После успешной recovery запускать только:

```javascript
AKORT_alpha74Gate6Status()
```

Проверять раз в 10–15 минут. Не запускать вручную `Start`, `Resume`, `Worker`,
`Stop`, повторный recovery или Industry submit.

Нормальная последовательность:

```text
RUN_REVERSAL:
UPDATING_AGGREGATES
→ UPDATING_AGGREGATE_LATEST
→ RECONCILING_AGGREGATES
→ operation SUCCESS

Gate 6:
ROLLBACK_SCAN
→ VERIFY_ROLLBACK
→ ENQUEUE_RESTORE
→ RUN_RESTORE
→ FINAL_SCAN
→ FINAL_VALIDATION
→ SAVE_EVIDENCE
→ SUCCESS
```

Restore выполняет полный штатный цикл повторной загрузки источника, поэтому
завершение Gate 6 после recovery может занять несколько часов. Это не означает
повторение уже принятой rollback-работы.

## 6. Критерии завершения Gate 6

При `SUCCESS` должны одновременно выполняться:

- `rollbackExact=true`;
- `restoreExact=true`;
- финальный aggregate contract scan `ok=true`;
- Weekly, Monthly, Industry и Aggregates совпадают с ожидаемыми digest;
- regular pipeline `TRUE`;
- user pipeline `FALSE` до отдельной приёмки Gate 7.
