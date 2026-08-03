# Alpha.7.4.34 — исправление RAW lineage и завершение Gate 6

## Подтверждённая причина `.33`

Текущий Gate 6 не столкнулся с новой ошибкой parser или aggregate formulas.
Живые таблицы подтверждают точную RAW-lineage причину:

- старая W27-загрузка `LOAD_20260802T123559854Z_EFB27B040FBC` имеет статус `REVERSED`;
- новая canary-загрузка `LOAD_20260803T123127832Z_3F2F34DAD46B` записала `0 INSERTED + 50 REVISED`;
- её rollback записал 50 durable records, и во всех 50 указан `restored_observation_id` старой уже откатанной загрузки;
- все старые 50 строк снова получили `is_latest=1`;
- поэтому Weekly и Monthly закономерно остались равны post-canary (`20311` и `13057` строк), а не baseline (`20211` и `12957`).

Алгоритм выбирал предыдущую версию по `version_no`, но не исключал версии,
принадлежащие load со статусом `REVERSED`.

Release `.34` исправляет общий контракт: reversal никогда не восстанавливает
строку из уже откатанного load и не считает такую более позднюю версию
конфликтом. Для текущего точного incident добавлена bounded repair-операция:
она исправляет 50 RAW latest-флагов, затем повторно выполняет штатные
Weekly/Monthly и aggregate phases из исправленного RAW. Parser, source stage и
canary RAW commit не повторяются. После exact rollback Gate автоматически
выполнит штатный restore и финальную сверку четырёх Publish-листов.

## 1. До commit и clasp push

Gate уже находится в `FAILED`, regular/user pipelines выключены, trigger
отсутствует. До установки `.34` не запускать никакие функции Apps Script.

В корне репозитория:

```bash
cd '/Users/ivankarabelnikov/Documents/Аналитический центр/akort-dwh-4-alpha74'
npm test
git diff --check
git status --short
```

Рекомендуемый commit:

```text
fix(alpha74): prevent reversed RAW predecessor resurrection
```

Commit body:

```text
Exclude observations owned by REVERSED loads from logical-reversal predecessor
selection and later-version conflicts. Add an exact bounded recovery for the
Alpha.7.4.33 Gate 6 lineage incident, rebuild price and aggregate Publish from
corrected RAW, and compact active Gate 6 digest checkpoints below the Script
Properties limit.
```

Commit и GitHub push пользователь выполняет самостоятельно.

## 2. clasp push

После commit:

```bash
clasp status
clasp push
```

Не использовать `clasp push --force`.

## 3. Apps Script после push

Выполнять строго последовательно и дожидаться результата каждой функции.

### 3.1. Установка и read-only проверки

```javascript
AKORT_alpha74Install()
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Ожидается:

- установлен release `4.0.0-alpha.7.4.34`;
- smoke и contract scan: `SUCCESS`, `physicalWrites=false`;
- верхний release Gate status `.34`, сохранённый incident state `.33 / FAILED / failedFromPhase=ROLLBACK_SCAN`;
- regular pipeline `FALSE`, user pipeline `FALSE`, trigger `0`;
- restore operation отсутствует.

`AKORT_alpha74Gate6Install`, `Start`, `Resume`, `Worker`, старые recovery и
Industry Submit не запускать.

### 3.2. Exact recovery — один раз

```javascript
AKORT_alpha74Gate6RecoverReversedPredecessor()
```

Ожидается `ok=true`. Новый state:

- release `.34`;
- `status=RUNNING`, `phase=RUN_REVERSAL`;
- recovery mode `REVERSED_PREDECESSOR_LINEAGE_REPAIR`;
- `repairRows=50`;
- original reversal operation сохранён в recovery metadata;
- создана одна idempotent repair operation `RAW_REVERSAL_V4`;
- regular pipeline `TRUE`, user pipeline `FALSE`;
- parser/source staging/canary RAW commit не повторяются.

Если функция вернула `SOURCE_INVALID`, другой набор load IDs, не 50 repair
rows или изменённый source hash, ничего не исправлять вручную в Google Sheets.

## 4. Мониторинг

После успешного recovery использовать только:

```javascript
AKORT_alpha74Gate6Status()
```

Проверять раз в 10–15 минут. Нормальный путь:

```text
repair COMMIT_RAW (50 rows)
→ UPDATE_PUBLISH
→ aggregate bounded phases
→ repair operation SUCCESS
→ ROLLBACK_SCAN / VERIFY_ROLLBACK exact
→ source-file RESTORE
→ FINAL_SCAN / FINAL_VALIDATION
→ SAVE_EVIDENCE / Gate 6 SUCCESS
```

Ориентир по времени: 2–5 часов в зависимости от Apps Script/Sheets quotas.
Процесс автоматический; ручные `Worker` и `Resume` не ускоряют его.

## 5. Финальная проверка

После `Gate 6 SUCCESS` выполнить:

```javascript
AKORT_alpha74SmokeTest()
AKORT_alpha74ReadOnlyContractScan()
AKORT_alpha74Gate6Status()
```

Критерии:

- `rollbackExact=true`;
- `restoreExact=true`;
- aggregate contract scan `ok=true`;
- duplicates/latest failures/future rows отсутствуют;
- Weekly, Monthly, Industry и Aggregates прошли exact digest contract;
- regular pipeline `TRUE`;
- user pipeline остаётся `FALSE` до отдельной приёмки Gate 7.

## 6. Остальные шаблоны и Industry

Gate 6 не нужно повторять целиком для каждого шаблона. Он принимает единый
parser → versioned RAW → incremental Publish → aggregate → rollback contract
на authoritative weekly/monthly canary. Для остальных утверждённых шаблонов
используется сокращённая приёмка: preview/parse, одна controlled load,
row-count/quality checks и read-only Publish verification. `Industry` проходит
отдельную сокращённую приёмку формы и `RAW_INDUSTRY → PUBLISH_INDUSTRY`, потому
что в Alpha.7.4 не влияет на ценовые агрегаты.
