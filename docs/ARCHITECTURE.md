# AKORT DWH 4.0 — архитектура

## Текущий контур

Архитектура на 4 августа 2026 года соответствует release
`4.0.0-alpha.7.4.35`. Gate 6 принят, regular aggregate pipeline включён,
пользовательский pipeline закрыт до Gate 7 и Beta.1.

```text
Google Drive source file / INDUSTRY_INPUT
  → Source Profile + Parser + Validator + Preview
  → Operation Engine (operation_id, phase, lease, checkpoint, trigger)
  → immutable stage
  → versioned RAW + load_id + reversal lineage
  → affected-series planning
  → ordinary Publish
  → Aggregate Engine
  → read-back + reconciliation + quick audit
  → DWH technical registries / Publish
  → Yandex DataLens
```

## Владение компонентами

Apps Script отвечает за:

- обнаружение и проверку утверждённых источников;
- Operation Engine, lease, checkpoints, retry и safe stop;
- версионный RAW и логический rollback;
- расчёт и инкрементальное обновление Publish;
- latest, агрегаты, read-back и reconciliation;
- backups, audit, status и recovery contracts.

Yandex DataLens:

- подключается только к Publish;
- самостоятельно обновляет соединение и кеш;
- не управляется Apps Script;
- не должен зависеть от технических листов DWH.

## Основные модули

- `02_Core.js` — конфигурация, result/error contract, lock и logging.
- `03_OperationEngine.js` — queue, phases, lease, checkpoints и trigger.
- `05_RawStore.js` — versioned RAW, load registry, revision и reversal.
- `06_ExistingSourceParsers.js` — каталог утверждённых profiles/parsers.
- `07_IncrementalPublish.js` — ordinary Publish, dependencies и reconciliation.
- `13_Alpha71AggregateContract.js` — frozen aggregate schema/keys.
- `15_Alpha72AggregateCalculator.js` — deterministic calculations.
- `18_Alpha73SpecialAggregateDefinitions.js` и
  `19_Alpha73RevisionPlanner.js` — definitions и impact planning.
- `21_Alpha74AggregateIntegration.js` — aggregate phases, stage, atomic publish.
- `27_Alpha74IndustryInput.js` — операторская форма Industry.
- `28_Alpha74Gate6Acceptance.js` — принятый authoritative DEV canary.

## Инварианты целостности

- identity основана на business keys, не на физических номерах строк;
- RAW append/versioned; исправления создают revision/reversal lineage;
- Publish заменяется полными logical series;
- тяжёлые операции имеют bounded step и durable cursor;
- write подтверждается read-back до продвижения checkpoint;
- before-state разрешает write, after-state разрешает idempotent recovery,
  third/mixed state даёт `FAILED_REQUIRES_REVIEW`;
- `SUCCESS` запрещён до schema/key/latest/reconciliation checks;
- DataLens видит только целое состояние до или после atomic batch.

## Текущее доказательство

Gate 6 execution `A74_GATE6_37FAED6EF952F9BB5FD4` доказал canary,
exact rollback и exact restore для Weekly, Monthly, Industry и Aggregates.
Подробности: `docs/alpha-7.4/GATE6_ACCEPTANCE_RESULT.md`.

## Следующее расширение

Gate 7 закрывает Alpha.7.4. Beta.1 добавляет обязательные Daily Backup,
Rollback Any load_id, Failure Injection, Operational Hardening, Minimum Quality
and Observability, Full Audit and Retention. Beta.2 добавляет пользовательский
workflow, Control Center, cutover папок/шаблонов и DataLens go-live.
