# Beta.1 — досье формальной приёмки

Идентификатор приёмки: `BETA1_FORMAL_ACCEPTANCE_20260806`  
Решение: **GO**  
Статус Beta.1: **FORMALLY_ACCEPTED**  
Дата подготовки: `2026-08-06T00:17:00+07:00`  
Репозиторий: `2jhd698sfz-cloud/akort-dwh-4`  
Ветка: `codex/beta-1-operational-gap-closure`

## 1. Объём приёмки

Настоящее досье агрегирует уже полученные evidence Alpha.7.4 и Beta.1. В ходе формальной приёмки не повторялись Gate 6, Gate 7, backup, restore, rollback, failure injection и Full Audit. Приёмочное изменение является исключительно документальным и не меняет Apps Script runtime, DWH, Publish, triggers или production-ресурсы.

Неизменяемая реализационная база Beta.1:

- commit `431b6f77bb6c01c0df855aec37e99c1619a93c4f`;
- tree `a804c5e0ca3f35f1801c8134ced4a935893cf5ca`;
- сообщение commit: `Fix Beta12 preflight execution bounds`.

Commit, содержащий это досье, является commit формальных приёмочных артефактов. Он не становится новой реализационной базой.

## 2. Матрица evidence

| Этап | Принятая версия | Результат | Авторитетное evidence |
|---|---|---:|---|
| Alpha.7.4 / Gate 7 | runtime `4.0.0-alpha.7.4.42` | PASS | `G7E_5F028CEB97F66118A57E5B6C`, hash `5f028ceb97f66118a57e5b6cb6a78dc67355bf41fb6ddbb8796894e4401dc3fc` |
| Beta.1.0 bootstrap | package `4.0.0-beta.1.0.1` | PASS | accepted commit `28d9827a8b80f1bdda615e00bab22d35cd8130cc` |
| Beta.1.1 paired backup | package `4.0.0-beta.1.1.5` | PASS | `BKP_DAILY_20260805`, manifest `1V64deDbE1_YzwF7RZdLsFQljhCwf9_rD`, hash `3a2d1218b5734e12520196b349168cd53908c072ce293decea0232fb94ca8681` |
| Beta.1.1 restore rehearsal | package `4.0.0-beta.1.1.7` | 9/9 PASS | `RRE_0F19BA90233D4B0C053C5659`, file `151LMCH-yam2Guba_2TzCUwzhc3javtct` |
| Beta.1.2 rollback facade | package `4.0.0-beta.1.2.5` | PASS | contract `4.0-beta12-rollback-facade-4` |
| Beta.1.2 rollback E2E | package `4.0.0-beta.1.2.9` | 15/15 PASS | `B12E2E_5786A81DB73CAF67AD366DA7`, file `1XvcXiv8TcnHMklxBC1QIwVuVWANNvjVA` |
| Beta.1.3 failure injection | package `4.0.0-beta.1.3.1` | PASS | четыре recovery-сценария завершены `SUCCESS`; exhaustion-сценарий завершён ожидаемым `DEAD_LETTER` |
| Beta.1.4 hardening | package `4.0.0-beta.1.4.2` | PASS | trigger ownership registry имеет статус `OK` |
| Beta.1.5 observability | package `4.0.0-beta.1.5.2` | PASS | `HEALTHY`, 8 datasets, 0 issues |
| Beta.1.6 Full Audit | package `4.0.0-beta.1.6.3` | 12/12 PASS | audit `AUD_20260805T095933652Z_78B683E78B`, evidence hash `b7987f64802936bb122007f81e2c82ea734cf125b7f070ecc50e4cf31784ab38` |

## 3. Финальная read-only сверка

Финальная read-only проверка установила:

- в live-столбце `OPERATION_QUEUE.status` нет строк `RUNNING`, `QUEUED`, `RETRY_PENDING`, `PAUSED` или `FAILED_REQUIRES_REVIEW`;
- Full Audit зафиксировал `activeOperations: []`;
- зарегистрирован ровно один обязательный автоматический CLOCK-trigger: `AKORT_beta11DailyBackupTrigger`;
- условный backup worker и закрытые legacy handlers имеют observed count 0;
- в активных DEV settings установлено `PUBLISH_USER_PIPELINE_ENABLED = FALSE`;
- Full Audit имеет `PASS`, 12 из 12 проверок;
- observability имеет `HEALTHY`, issues отсутствуют;
- retention работает только в dry-run: 6 защищённых артефактов, 0 review candidates, физического удаления нет;
- immutable evidence restore и rollback E2E существуют на Google Drive;
- evidence Beta.1 не фиксирует production write или production touch;
- `.gitignore` исключает local config, clasp credentials и environment files из репозитория.

Полная сверка и ограничения её области приведены в `BETA1_READ_ONLY_RECONCILIATION.md`.

## 4. Целостность evidence

Restore rehearsal:

- evidence ID `RRE_0F19BA90233D4B0C053C5659`;
- evidence hash `0f19ba90233d4b0c053c565957a6183d14c48a4405020964d38a270adf9e9d15`;
- canonical file SHA-256 `3fff487ea06cc32bb86cd516434e9cd6c5bf62b618499b4c726126d305a972a3`.

Rollback E2E:

- evidence ID `B12E2E_5786A81DB73CAF67AD366DA7`;
- evidence hash `5786a81db73caf67ad366da774be2362cbd9d526086a7b95710fe8d4c263a2c5`;
- SHA-256 сырых байтов скачанного файла на момент приёмки `cd236abfa51e8bd34e40812b6da3f6f735f573828dd48ac2e941f2fe38961cc1`.

## 5. Связка source и deployment

GitHub source и runtime E2E evidence одинаково указывают package `4.0.0-beta.1.2.9` и contract `4.0-beta12-rollback-e2e-2`. До финального runtime E2E владелец также успешно выполнил `clasp push`.

В рамках этой документальной приёмки не пересчитывалась repository-wide побайтовая идентичность каждого Apps Script file. Это раскрытие границ проверки, а не blocker: развёрнутый acceptance harness успешно выполнился и сформировал immutable evidence 15/15, привязанное к ожидаемым Script, DWH и Publish IDs.

Локальный worktree рабочей станции не использовался как источник приёмки. Авторитетными являются remote GitHub commit и tree, указанные выше.

## 6. Решение

Все обязательные этапы Beta.1 имеют подтверждённый `PASS`. Не выявлены активные операции, включённый user pipeline, trigger conflict, failed Full Audit, observability issues, физическое retention deletion или production write.

**Beta.1 формально принята.**

Следующий разрешённый этап реализации по проектному плану — **Beta.2.1 — Read-only Control Center**. Operational go-live Beta.2 запрещён до отдельных PASS для Beta.2.1–Beta.2.6 и подписания финального GO/NO-GO.
