# Beta.2.3 candidate-r5 — Installation and rollback

## Corrective installation

Инсталлятор является replacement `candidate-r4 → candidate-r5`. Он запускается только из корня репозитория и проверяет:

- exact branch and immutable HEAD;
- exact ten-path uncommitted candidate-r4 working tree;
- SHA-256 каждого candidate-r4 файла;
- embedded candidate-r5 archive and every payload hash.

До изменения файлов создаётся temporary backup candidate-r4 outside repository. При любой ошибке installer восстанавливает exact candidate-r4 state.

После установки выполняются focused suite, full `npm test`, `git diff --check` и exact changed-path check. Installer не выполняет commit, push, `clasp push`, deployment, Apps Script execution, trigger action, Script Property mutation или Google data write.

## Next boundary

После PASS изменения остаются uncommitted. Разрешено только независимое ревью exact candidate-r5 diff. Commit через GitHub Desktop разрешается отдельным решением после GO.

## Runtime activation

Runtime activation выполняется только после принятого commit и отдельного разрешения. Исходный режим остаётся:

- `AKORT_BETA23_OPERATOR_ACTIONS_ENABLED=FALSE`;
- `AKORT_BETA22_CONTROLLED_SUBMIT_ENABLED=FALSE`;
- `PUBLISH_USER_PIPELINE_ENABLED=FALSE`.

## Rollback before commit

Использовать installer automatic rollback при ошибке. После successful installation и до commit вернуть candidate-r4 можно только из retained external backup либо discard/restore exact reviewed files; не смешивать r4 и r5.

## Rollback after accepted commit

Создать отдельный revert commit через GitHub Desktop. Не переписывать историю.

## Runtime rollback

Сначала вернуть `AKORT_BETA23_OPERATOR_ACTIONS_ENABLED=FALSE`. Derived tables `USER_DATA_FRESHNESS` и `USER_DATA_FRESHNESS_STAGE` не управляют RAW/Publish и не удаляются автоматически.
