# Rollback — v4.0.0-alpha.1

Alpha.1 is installed only in the standalone DEV Apps Script project and reads only DEV copies.

To roll back:

1. In GitHub Desktop select the previous commit or revert the alpha.1 commit.
2. Run `clasp push` from the local repository.
3. In Apps Script run `AKORT_alpha1ResetBaselineState` if a baseline checkpoint remains.
4. Optionally delete alpha.1 report spreadsheets from the DEV results folder.

Rollback does not require restoration of production 3.1.7 because production is never modified.
