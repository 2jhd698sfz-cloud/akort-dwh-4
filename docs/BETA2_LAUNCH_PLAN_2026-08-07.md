# AKORT 4.0 — план запуска Beta.2 7 августа 2026 года

## 1. Цель и действующий статус

Цель — открыть 7 августа 2026 года контролируемую эксплуатацию Beta.2 на
утверждённых weekly/monthly-шаблонах и форме Industry, обеспечив целостность
таблицы Publish, обновление агрегатов и самостоятельное обновление DataLens.

Статус на 4 августа 2026 года:

- Alpha.7.4 release `4.0.0-alpha.7.4.35` развёрнут в DEV;
- Gate 5 принят: full build и sequential replay дали точную эквивалентность;
- Gate 6 принят: `SUCCESS / SUCCESS`, execution
  `A74_GATE6_37FAED6EF952F9BB5FD4`;
- canary, логический rollback и restore завершены успешно;
- rollback вернул все четыре Publish-листа к baseline, restore вернул их к
  post-canary состоянию;
- итоговый aggregate contract scan прошёл без logical duplicates, latest
  failures и future rows;
- regular aggregate pipeline включён;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE` до Gate 7 и установки Beta.1.

## 2. Непереставляемая последовательность релиза

Порядок не сокращается и не меняется:

1. Gate 7 — финальная приёмка Alpha.7.4.
2. Beta.1.1 — Daily Backup.
3. Beta.1.2 — Rollback Any load_id.
4. Beta.1.3 — Failure Injection.
5. Beta.1.4 — Operational Hardening.
6. Beta.1.5 — Minimum Quality and Observability.
7. Beta.1.6 — Full Audit and Retention.
8. Beta.2.1 — Read-only Control Center.
9. Beta.2.2 — User Load Workflow.
10. Beta.2.3 — User Audit/Rollback/Backup Operations.
11. Beta.2.4 — Familiar Upload Folder and Template Cutover.
12. Beta.2.5 — DataLens Data Model and Connection.
13. Beta.2.6 — DataLens Dashboard and Visual Acceptance.
14. Beta.2.7 — Operational Go-Live and Hypercare.

Подрелизы могут быть собраны в одной рабочей ветке и проходить последовательно
в течение одного дня, но каждый получает отдельный результат проверки. Нельзя
открывать Beta.2, если обязательный критерий Beta.1 имеет статус `FAILED` или
`NOT_TESTED`.

## 3. Как ускоряется приёмка шаблонов

Gate 6 уже доказал общий физический механизм: parser → RAW → ordinary Publish
→ aggregates → read-back → rollback → restore. Полный трёхцикловый canary не
повторяется для каждого шаблона.

Для Gate 7 применяется единая сокращённая матрица:

- для каждого утверждённого `profile_id` — read-only распознавание, parsing,
  mapping, period/unit normalization и preview на реальном контрольном файле;
- для каждого файла — ожидаемый target, непустой normalized set, отсутствие
  blocking issues и корректный source hash;
- для weekly и monthly — по одному репрезентативному физическому E2E обновлению
  через общий Operation Engine;
- для Industry — install/status/validate формы и один контролируемый Submit
  одной или нескольких опубликованных серий;
- после физических прогонов — quick audit, contract scan и сверка целевых
  рядов в Publish;
- rollback/restore на каждом шаблоне не выполняется: этот общий контракт уже
  принят Gate 6;
- повторный файл проверяется как `DUPLICATE` или `NO_CHANGE` без новых строк.

Любой неизвестный профиль, blocking parser issue, third state после записи,
logical duplicate, неверный latest или изменение схемы является блокером.

## 4. Критический календарный план

### 4 августа — закрыть Alpha.7.4 и открыть Beta.1

#### До 12:00 — Gate 7

1. Зафиксировать code freeze на `.35`.
2. Выполнить `git diff --check` и полный `npm test`.
3. Проверить Gate 6 status и наличие evidence/recovery copies.
4. Выполнить smoke test и read-only aggregate contract scan.
5. Составить фактический каталог всех утверждённых `profile_id`.
6. Для каждого профиля выполнить read-only preview на контрольном файле.
7. Проверить `INDUSTRY_INPUT` через Install, Status и Validate.
8. Выполнить только репрезентативные физические E2E прогоны: weekly, monthly,
   Industry.
9. Выполнить итоговый quick audit и Publish contract scan.
10. Зафиксировать Gate 7 review: нет blocker/critical/major, Alpha.7.4
    `ACCEPTED_AND_CLOSED`, accepted commit/tag подготовлены.

#### 12:00–20:00 — Beta.1.1 и Beta.1.2

1. Реализовать согласованную пару backup DWH + Publish под одним `backup_id`.
2. Добавить registry, manifest, hashes, PARTIAL/retry и ручной Backup Now.
3. Установить ежедневный trigger и контроль freshness.
4. Выполнить restore rehearsal на копиях, не на рабочем контуре.
5. Обобщить существующий `RAW_REVERSAL_V4` до безопасного rollback любого
   допустимого committed/non-reversed `load_id`.
6. Добавить read-only impact preview, обязательную причину и подтверждение.
7. После rollback пересчитать затронутые Publish/aggregates/latest и выполнить
   quick audit.
8. Проверить idempotent повтор и `NO_CURRENT_EFFECT`.

Результат дня: Gate 7 закрыт; Beta.1.1 и Beta.1.2 имеют PASS; user pipeline
остаётся выключенным.

### 5 августа — завершить Beta.1.3–Beta.1.6

#### 09:00–12:00 — Beta.1.3 Failure Injection

Проверяется компактная репрезентативная матрица, а не все комбинации:

- timeout до write;
- lost response после write до checkpoint;
- transient Drive/Sheets error;
- missing trigger/stale lease;
- конфликт параллельных операций;
- partial backup;
- malformed/zero-row source;
- ошибка во время rollback.

Критерий: нет ложного `SUCCESS`, повтор не создаёт дубли, third state остаётся
`FAILED_REQUIRES_REVIEW`, операция имеет однозначный `next_action`.

#### 12:00–15:00 — Beta.1.4 Operational Hardening

- единая классификация retryable/user-action/fatal;
- bounded retry/backoff;
- watchdog и stale checkpoint detection;
- single-trigger ownership и проверка trigger health;
- безопасные Continue/Stop/Retry;
- MAINTENANCE mode;
- компактный status без полного сканирования RAW/Publish;
- incident correlation по operation_id/load_id;
- runbook штатной операции и инцидента.

#### 15:00–18:00 — Beta.1.5 Minimum Quality and Observability

- `DATASET_STATUS` по weekly/monthly/industry/aggregates;
- latest period и expected next period;
- freshness `CURRENT / EXPECTED / OVERDUE`;
- `ISSUE_REGISTRY`;
- сигналы schema/hash/manual change, stale operation, missing trigger, quota
  pressure и backup freshness;
- межслойная сверка RAW ↔ Publish;
- daily health-check и read API для Control Center.

#### 18:00–22:00 — Beta.1.6 Full Audit and Retention

- resumable Full Audit с parent/child operations, phase, cursor и progress;
- schema, keys, versions, mappings, units, weights, latest, aggregates,
  operations и backups;
- `AUDIT_REPORT` и `ISSUE_REGISTRY`;
- повтор только failed checks;
- retention dry-run и защита release/pre-risk anchors;
- политика: daily 30 дней, weekly 8 недель, monthly 12 месяцев, release
  baselines бессрочно;
- физическое удаление только отдельной retention operation;
- пользовательский rollback никогда не удаляет audit trail.

Результат дня: Beta.1.1–Beta.1.6 имеют PASS; создан release candidate Beta.1.

### 6 августа — собрать и принять Beta.2 release candidate

#### 09:00–12:00 — Beta.2.1–Beta.2.3

- read-only Control Center из registries/status cache;
- health, release, последние загрузки, freshness, active operation, progress,
  backup, audit, trigger/quota и issues;
- пользовательский workflow обнаружения, validation, preview, confirm,
  background execution и понятного terminal status;
- безопасные Backup Now, Quick Audit, Full Audit, поиск load_id и Rollback;
- опасные команды скрыты из обычного пользовательского раздела.

#### 12:00–15:00 — Beta.2.4 cutover папок и шаблонов

- составить окончательный список утверждённых templates/profile IDs;
- разместить актуальные шаблоны в привычной папке;
- проверить права и владельца trigger;
- отключить старые triggers, способные обработать ту же входящую папку;
- включить staging copy и маршруты `Загруженные / Отклонённые`;
- создать cutover backup;
- оставить 3.1.7 в режиме без приёма новых файлов, но доступным для отката.

#### 15:00–18:00 — Beta.2.5–Beta.2.6 DataLens

- подтвердить подключение только к Beta Publish, не к техническим листам DWH;
- проверить схему и типы полей weekly/monthly/industry/aggregates;
- проверить `is_latest_period`, связи, фильтры и вычисляемые поля;
- инициировать штатное обновление через изменение Publish, а не через Apps
  Script API DataLens;
- сверить контрольные периоды и значения на всех страницах дашборда;
- проверить отображение источника, даты обновления и quality status;
- принять читаемость, фильтры, drill-down и время открытия.

#### 18:00–21:00 — генеральная репетиция

1. Daily/Backup Now.
2. Один утверждённый weekly или monthly файл.
3. Одна Industry партия.
4. Дождаться terminal status без ручного restart.
5. Проверить RAW, Publish, aggregates, latest, status cache и DataLens.
6. Выполнить quick audit.
7. На отдельном тестовом load_id выполнить impact preview и rollback.
8. Проверить отсутствие активных/stale operations и единственность triggers.
9. Подготовить go/no-go протокол и точный rollback plan.

Результат дня: Beta.2 release candidate и cutover package готовы; user pipeline
ещё выключен.

### 7 августа — Beta.2 Operational Go-Live

#### До запуска

1. Объявить короткое окно изменений.
2. Проверить отсутствие RUNNING/PAUSED/FAILED_REQUIRES_REVIEW операций.
3. Выполнить health-check, quick audit и backup freshness.
4. Создать согласованный cutover backup DWH + Publish.
5. Зафиксировать текущие row counts, schemas, latest counts и fingerprints.
6. Подтвердить, что старые intake triggers выключены.
7. Подтвердить DataLens connection к Beta Publish.
8. Подписать GO/NO-GO.

#### Запуск

1. Установить принятый Beta.2 package.
2. Повторить install/status/smoke без физических загрузок.
3. Включить `PUBLISH_USER_PIPELINE_ENABLED=TRUE` последним действием.
4. Выполнить один контролируемый пользовательский файл из привычной папки.
5. Дождаться terminal `SUCCESS`, `NO_CHANGE` или `DUPLICATE`.
6. Проверить Publish, aggregates, latest, Control Center и DataLens.
7. Выполнить одну Industry загрузку, если на дату запуска есть опубликованное
   значение; иначе выполнить read-only Validate и зафиксировать отсутствие
   новых данных как ожидаемое состояние.
8. Открыть регулярный пользовательский режим ограниченной группе.

#### Hypercare

- первые 2 часа — проверка каждые 15 минут;
- до конца дня — проверка каждый час;
- контролируются operations, issues, triggers, quota, backup, freshness,
  Publish fingerprints и DataLens freshness;
- при P0/P1 пользовательский pipeline немедленно выключается;
- данные восстанавливаются через rollback load_id; recovery backup применяется
  только по отдельному подтверждённому incident plan.

## 5. Gate 7: точные критерии PASS

- Gate 6 evidence существует и соответствует execution
  `A74_GATE6_37FAED6EF952F9BB5FD4`;
- `.35` smoke и полный локальный test suite проходят;
- все утверждённые profile IDs распознаны на контрольных файлах;
- у каждого preview правильный target и нет blocking issues;
- weekly, monthly и Industry репрезентативные физические циклы успешны;
- повтор источника не создаёт новые RAW/Publish rows;
- aggregate contract: 29 колонок, 0 duplicate logical rows, 0 latest failures,
  0 future rows;
- нет blocker/critical/major;
- regular pipeline включён, user pipeline выключен;
- release manifest/sourceFiles/version синхронизированы;
- accepted commit/tag и evidence package подготовлены.

## 6. Go/No-Go 7 августа

### Обязательный GO

- Gate 7 = PASS;
- Beta.1.1–Beta.1.6 = PASS;
- Beta.2.1–Beta.2.6 = PASS;
- последняя daily/cutover backup pair = SUCCESS и доступна;
- Full/Quick Audit не содержит P0/P1;
- нет активной или orphaned operation;
- один правильный dispatcher/intake trigger, старые triggers отключены;
- все утверждённые templates/profile IDs прошли сокращённую матрицу;
- Industry Validate/Submit contract принят;
- DataLens читает Beta Publish и прошёл контрольные значения;
- rollback plan и ответственный оператор определены.

### Автоматический NO-GO

- logical duplicates, latest failures, future periods или schema drift;
- unknown profile/blocking parser issue на утверждённом шаблоне;
- backup отсутствует, PARTIAL или не прошёл restore rehearsal;
- rollback выбранного load_id не имеет impact preview или не возобновляем;
- ложный `SUCCESS` в failure injection;
- stale/RUNNING operation без однозначного recovery path;
- два triggers обрабатывают одну входящую папку;
- DataLens подключён к неверной таблице или показывает несверенные значения;
- user pipeline включён до завершения обязательных проверок.

## 7. Оценка оставшейся работы

Полный нормативный объём Beta.1 и Beta.2 не представлен в текущем `.35` как
готовый release package. При максимальном переиспользовании Alpha.3–Alpha.7.4
остаётся ориентировочно 30–45 инженерных часов и 6–10 часов DataLens/UAT.

Запуск 7 августа реалистичен только при одновременном выполнении условий:

- scope freeze: без новых показателей, новых схем и конструктора шаблонов;
- только утверждённые Alpha.5 profiles и существующая Industry model;
- сокращённая единая приёмка шаблонов без повторения Gate 6 на каждом;
- повторное использование Operation Engine, RawStore, Incremental Publish и
  Gate 6 backup/recovery patterns;
- отсутствие новых P0/P1;
- перенос необязательных улучшений, но не обязательных защит, за границу
  запуска.

Если к контрольной точке 6 августа 18:00 обязательные Beta.1 критерии не имеют
PASS, безопасный вариант — не включать user pipeline и перенести go-live, а не
объявлять формальный Beta.2 без backup, arbitrary rollback и observability.
