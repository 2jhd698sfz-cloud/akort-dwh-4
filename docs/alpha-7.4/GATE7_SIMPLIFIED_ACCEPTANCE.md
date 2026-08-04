# Alpha.7.4 — Gate 7 simplified acceptance

## Назначение

Gate 7 закрывает Alpha.7.4 после успешного Gate 6 и разрешает переход к
Beta.1. Он не повторяет полный canary/rollback/restore для каждого шаблона.

## Объём

1. Independent code/evidence review release `.35`.
2. Полный локальный regression suite.
3. Read-only parser/preview для каждого утверждённого Alpha.5 profile.
4. Один репрезентативный physical E2E для weekly.
5. Один репрезентативный physical E2E для monthly.
6. Install/Status/Validate и один контролируемый Submit для Industry.
7. Duplicate/no-change повтор одного источника.
8. Финальный aggregate contract scan и quick audit.
9. Release manifest, accepted commit/tag и evidence package.

## Матрица профиля

Для каждого `profile_id` фиксируются:

- контрольный file ID/name и source hash;
- распознанный profile;
- target RAW table;
- normalized rows;
- periods/frequency;
- warnings и blocking issues;
- результат `PASS / FAILED`;
- причина, если профиль не может быть проверен.

PASS требует: profile распознан, target корректен, normalized rows больше нуля,
blocking issues отсутствуют, период и единица нормализованы, preview не пишет
данные.

## Физическая приёмка

Weekly, monthly и Industry используют один Operation Engine. Для каждого
репрезентативного прогона проверяются:

- operation/load ID;
- terminal status;
- RAW audit;
- affected series и periods;
- ordinary Publish;
- aggregates, если источник имеет aggregate impact;
- latest;
- quick audit;
- повтор без дублей.

Полный Gate 6 rollback/restore цикл не повторяется: его evidence является
общим доказательством data-plane контракта.

## PASS

- Gate 6 `SUCCESS / SUCCESS`;
- все обязательные profiles имеют PASS;
- weekly/monthly/Industry representative E2E имеют PASS;
- 0 logical duplicates, 0 latest failures, 0 future rows;
- нет blocker/critical/major;
- regular pipeline `TRUE`, user pipeline `FALSE`;
- manifest/version/sourceFiles синхронизированы;
- accepted commit/tag и evidence подготовлены.

После PASS Alpha.7.4 получает `ACCEPTED_AND_CLOSED`. User pipeline включается
не в Gate 7, а только после обязательных Beta.1.1–Beta.1.6 и Beta.2 go-live
checks.
