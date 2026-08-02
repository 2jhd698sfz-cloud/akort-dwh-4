# Alpha.7.4 — Runtime Context Contract

## Назначение

`PUBLISH_AGGREGATE_RUNTIME_CONTEXT_JSON` задаёт authoritative inputs, которых нет в 29 колонках Publish и в compact `PUBLISH_IMPACT`:

- Alpha.7.3 definitions;
- versioned weight snapshot;
- versioned membership snapshot;
- coverage rules;
- optional base inputs и publish metadata.

Контекст не содержит ссылки DataLens и не изменяет frozen Alpha.7.1–Alpha.7.3 contracts.

## Режимы хранения

### Inline

Допустим для небольшого контекста:

```json
{
  "definition_context": {},
  "definitions": [],
  "weight_snapshot": {
    "snapshot_id": "VERSIONED_WEIGHT_SNAPSHOT",
    "hash": "SHA256_OF_CANONICAL_RULE_ROWS",
    "rule_rows": []
  },
  "membership_snapshot": {
    "snapshot_id": "VERSIONED_MEMBERSHIP_SNAPSHOT",
    "hash": "SHA256_OF_CANONICAL_RULE_ROWS",
    "rule_rows": []
  },
  "coverage_rules": [],
  "base_inputs": [],
  "publish_metadata": {
    "bySeries": {},
    "bySubject": {}
  }
}
```

### Immutable external artifact

Для контекста, превышающего безопасный размер одной ячейки:

```json
{
  "artifact_file_id": "CONFIGURED_AT_RUNTIME",
  "artifact_sha256": "LOWERCASE_SHA256_OF_EXACT_UTF8_FILE_CONTENT"
}
```

ID и hash хранятся только во внутреннем `SYSTEM_SETTINGS`. В публичный Git они не добавляются.

Перед использованием модуль:

1. читает точное UTF-8 содержимое artifact;
2. проверяет SHA-256;
3. разбирает JSON;
4. повторно проверяет hashes weight и membership snapshots;
5. фиксирует полный input artifact по частям в `AGGREGATE_STAGE`.

## Обязательные правила

- Snapshot IDs непустые и versioned.
- Declared snapshot hash обязан совпадать с canonical rule rows.
- Definitions проходят Alpha.7.3 validation.
- Price inputs читаются из текущих weekly/monthly Publish одним materialization step.
- Existing-period frontier строится из фактически существующих Publish periods.
- Runtime context не может включить физическую запись: её разрешают только два отдельных feature flags.
- Изменение runtime artifact после checkpoint приводит к fail-closed, а не к продолжению с новым input.

## Активация

1. Загрузить и проверить runtime context в isolated read-only gate.
2. Оставить оба feature flags `FALSE`.
3. Выполнить plan/calculation/stage проверки без Publish mutation.
4. Только после отдельного live-write gate включить `PUBLISH_AGGREGATE_EXECUTION_ENABLED`.
5. Gate 6 harness сам включает
   `PUBLISH_AGGREGATE_REGULAR_PIPELINE_ENABLED` только после recovery-копий и
   baseline scan; при ошибке выключает его fail-closed. После PASS флаг
   остаётся `TRUE`, а `PUBLISH_USER_PIPELINE_ENABLED` — `FALSE` до Gate 7.
