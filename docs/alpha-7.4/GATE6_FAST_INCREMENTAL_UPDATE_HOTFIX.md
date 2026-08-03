# Alpha.7.4.28 — Gate 6 fast durable incremental update

> Операционно `.28` заменён release `.29`, который добавляет повторный
> Stop для уже остановленной operation и полный progress fingerprint. Для
> развёртывания использовать `ALPHA74_29_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md`.

## Решение

Release `4.0.0-alpha.7.4.28` заменяет медленный Gate 6 runtime path, не
отменяя ни одного принятого Gate 5 контракта и не начиная историческую
загрузку повторно.

Gate 5 подтвердил правильность итоговых 61 636 агрегатных строк. Gate 6 обязан
использовать эту базу как текущий Publish и пересчитывать только затронутые
логические серии. Full build и sequential replay в Gate 6 не выполняются.

## Подтверждённая причина низкой скорости

В `.26/.27` инкрементальный план одной weekly canary содержал 381 зависимую
aggregate combination. Runtime setting разрешал только 4 combination за один
bounded step, поэтому materialization требовала примерно 96 продолжений.
Каждое продолжение повторно читало Weekly/Monthly source Publish и заново
строило индекс `PUBLISH_PRICE_AGGREGATES` из 61 636 строк. Publication, latest
и reconciliation также повторяли target scan для небольших окон по 32 серии.

Это не был повторный пересчёт всей истории по бизнес-логике. Это были
повторные технические чтения большой таблицы вокруг корректного affected-set.
Такой runtime path признан неприемлемым.

## Новый bounded runtime contract

### RAW

- reversal остаётся exact-once и выполняется по 10 observations;
- authoritative cursor — успешные строки `RAW_REVERSAL_LOG`;
- уже принятые строки `.26` не повторяются.

### Weekly, Monthly и Industry Publish

- `UPDATE_PUBLISH` имеет durable work schema `4.0-publish-work-1`;
- порядок stages: `WEEKLY -> MONTHLY -> INDUSTRY -> FINALIZE`;
- Weekly/Monthly заменяются полными logical series, максимум по 25 серий за
  checkpoint;
- Industry заменяется максимум по 10 серий за checkpoint;
- после каждого checkpoint в operation сохраняются stage, cursor,
  plan fingerprint, counters и deterministic run ID;
- повтор после lost response идемпотентно заменяет только ту же серию/пачку;
- месячный файл большего размера продолжится со следующей пачки, а не с
  начала загрузки.

### Aggregate calculation и publication

- один worker invocation читает Weekly/Monthly calculation sources один раз;
- materialization обрабатывает максимум 250 combinations за durable step;
- 381 canary combinations проходят двумя steps вместо примерно 96;
- stage validation/status обрабатывает до 2 000 строк за step;
- publication/latest/reconciliation рассматривают до 500 полных logical
  series за step;
- фактическая запись по-прежнему автоматически уменьшается до frozen atomic
  limits: 5 000 rows, 100 000 cells, 500 requests;
- target projection из 61 636 строк индексируется один раз на worker
  invocation и переиспользуется materialization/publication checks;
- после физической записи cache обязательно сбрасывается и выполняется
  контрольное чтение нового состояния;
- before/after/lost-response/third-state fail-closed контракт не ослаблен.

### Worker

- один Gate 6 trigger использует до 190 секунд operation work;
- за этот период он может выполнить до 40 durable resume steps;
- отсутствие изменения progress fingerprint немедленно останавливает цикл,
  поэтому worker не крутится вхолостую;
- внешний trigger остаётся минутным и продолжает только с сохранённого
  checkpoint.

## Что по-прежнему читает все четыре Publish-листа

Сам Gate 6 acceptance harness строит полные digest в контрольных точках:
baseline, post-canary, post-rollback и final restore. Это обязательное
доказательство точного rollback/restore и выполняется только в Gate 6.
Обычное пользовательское обновление после acceptance эти четыре полных scan
не выполняет.

## Продолжение текущего `.26` execution

1. Выполнить `AKORT_alpha74Gate6Stop()` и дождаться
   `STOPPED / stoppedFromPhase=RUN_REVERSAL / triggerCount=0`.
2. Опубликовать `.29` и выполнить `clasp push`.
3. Выполнить `AKORT_alpha74Install()`. Install обновит bounded runtime settings;
   вручную редактировать значения в `SYSTEM_SETTINGS` не нужно.
4. Проверить:
   `AKORT_alpha74SmokeTest()`,
   `AKORT_alpha74ReadOnlyContractScan()`,
   `AKORT_alpha74Gate6Status()`.
5. Убедиться, что regular и user pipeline выключены, recovery-копии и старый
   execution сохранены.
6. Один раз выполнить `AKORT_alpha74Gate6Resume()`.
7. Далее выполнять только `AKORT_alpha74Gate6Status()`.

Ожидаемый recovery mode остаётся
`DURABLE_RAW_REVERSAL_CHUNK_RECOVERY`. Новый Gate6Start, новая canary и новый
historical build запрещены.

Gate 6 считается завершённым только после exact rollback, exact restore,
итогового contract scan и JSON evidence. До PASS
`PUBLISH_USER_PIPELINE_ENABLED` остаётся `FALSE`.
