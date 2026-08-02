# Alpha.7.4.20 — Gate 6 baseline header recovery hotfix

## Подтверждённый инцидент

Execution `A74_GATE6_7F437567A3ABBFBE94F1` в release `.19` завершился
fail-closed:

- `status=FAILED`, `failedFromPhase=BASELINE_SCAN`;
- ошибка `ALPHA74_GATE6_UNEXPECTED_ERROR`;
- сообщение `AKORT_V300 is not defined`;
- `digestChunks=0`, `rowsScanned=0`;
- canary, reversal и restore operation IDs пусты;
- canary, reversal и restore load IDs пусты;
- regular и user pipeline выключены;
- физические записи отсутствуют;
- DWH и Publish recovery-копии созданы и сохранены.

Следовательно, ни source load, ни Publish mutation, ни aggregate publication
не начинались. Восстанавливать live DWH/Publish из копий не требуется.

## Причина

`AKORT_V300` объявлен внутри IIFE модуля `AKORT.IncrementalPublish` и является
его приватной переменной. Gate 6 напрямую обращался к
`AKORT_V300.HEADERS[target]`, хотя межмодульный контракт для этой переменной не
существовал. Локальный static suite не исполнял runtime-ветку baseline schema
lookup и не обнаружил нарушение границы модуля.

## Исправление `.20`

1. `AKORT.IncrementalPublish` экспортирует immutable `PublishHeaders` для всех
   четырёх Publish-листов.
2. Gate 6 получает price/industry schemas только через
   `AKORT.IncrementalPublish.PublishHeaders`.
3. Aggregate schema по-прежнему сверяется с `AKORT.AggregateContract.Headers`.
4. Regression suite запрещает исполняемую ссылку `AKORT_V300.HEADERS` в Gate 6
   и проверяет все четыре exported contracts.
5. `AKORT_alpha74Gate6Resume()` принимает terminal `.19` checkpoint только при
   точном совпадении инцидента и до любых операций или scanned rows.

## Fail-closed recovery contract

Resume разрешён только если одновременно подтверждены:

- release `.19` и state schema `4.0-alpha74-gate6-state-1`;
- `FAILED / FAILED / failedFromPhase=BASELINE_SCAN`;
- точный код и текст ошибки;
- пустые operation/load IDs и digests;
- baseline scan cursor до первого target work;
- нулевые `digestChunks` и `rowsScanned`;
- обе recovery-копии доступны;
- DWH/Publish resource IDs не изменились;
- canary source hash остался прежним;
- нет чужих активных data operations;
- engine/execution включены, regular/user pipeline выключены.

При любом отличии Resume блокируется. При принятии checkpoint сохраняются
execution ID, canary source и обе recovery-копии; release checkpoint повышается
до `.20`, scan переинициализируется с безопасной границы `BASELINE_SCAN`.

## Установка и продолжение

После публикации commit:

1. выполнить `clasp push`;
2. запустить `AKORT_alpha74Install()`;
3. запустить `AKORT_alpha74SmokeTest()`;
4. запустить `AKORT_alpha74ReadOnlyContractScan()`;
5. запустить `AKORT_alpha74Gate6Status()` и подтвердить старый точный
   `.19 / FAILED / BASELINE_SCAN` checkpoint, нулевые scan metrics и пустые IDs;
6. один раз запустить `AKORT_alpha74Gate6Resume()`;
7. далее запускать только `AKORT_alpha74Gate6Status()`.

Не выполнять повторно `Gate6Install`, `Gate6Validate`, `Gate6Start`, Stop или
ручные operation functions. Файл `AKORT_WEEKLY_W27` не изменять.
