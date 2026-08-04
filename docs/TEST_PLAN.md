# AKORT DWH 4.0 — актуальный test plan

## 1. Локальная регрессия

Обязательный запуск:

```bash
npm test
```

Suite проверяет private Apps Script references, frozen Alpha.7.1–7.3
contracts, Alpha.7.4 integration, Gates 3–6, Industry form, bounded RAW
reversal и fast incremental update.

## 2. Принятые gates

- Gates 0–4: architecture/read-only/isolated physical acceptance — PASS.
- Gate 5: full build = sequential replay = accepted baseline — PASS.
- Gate 6: authoritative DEV canary, exact rollback/restore и aggregate scan —
  PASS на `.35`.

Принятые gates не повторяются без изменения их frozen contract или
подтверждённого regression risk.

## 3. Gate 7

Используется `docs/alpha-7.4/GATE7_SIMPLIFIED_ACCEPTANCE.md`:

- read-only preview всех утверждённых profiles;
- один representative E2E weekly;
- один representative E2E monthly;
- один representative Industry Submit;
- duplicate/no-change check;
- final quick audit и contract scan;
- independent review и accepted package.

Полный rollback/restore не выполняется на каждом шаблоне: общий механизм уже
доказан Gate 6.

## 4. Beta.1

Каждый обязательный subrelease имеет отдельный PASS:

1. Daily Backup: pair, registry, hashes, PARTIAL retry, restore rehearsal.
2. Rollback Any load_id: preview, reason, checkpoints, recalculation, audit.
3. Failure Injection: timeout/lost response/service error/trigger/conflict/
   partial backup/rollback fault без ложного SUCCESS.
4. Operational Hardening: retry/backoff/watchdog/stale/maintenance/runbook.
5. Quality/Observability: status/freshness/issues/triggers/quota/backup/health.
6. Full Audit/Retention: resume, reports, failed-check retry, dry-run purge.

## 5. Beta.2

- Control Center открывается без full RAW/Publish scan;
- approved-template user workflow проходит E2E;
- operations Backup/Audit/Rollback доступны с безопасными подтверждениями;
- одна intake folder обрабатывается только одним Beta trigger;
- DataLens подключён к Beta Publish и сверяет контрольные значения;
- go-live preflight и hypercare не имеют P0/P1.

## 6. Общие критерии качества данных

- exact headers/schema;
- no duplicate business/logical keys;
- exactly one latest per publishable series;
- no future periods;
- RAW/Publish affected scope reconciled;
- aggregate contract: 29 columns;
- repeat input is idempotent;
- status cannot be `SUCCESS` before read-back and audit.
