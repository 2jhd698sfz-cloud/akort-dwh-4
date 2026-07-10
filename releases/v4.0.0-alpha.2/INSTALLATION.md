# Installation

1. Keep the repository on the current development branch.
2. Extract this package outside the repository.
3. Open Terminal and run:

```bash
bash /path/to/akort-v4.0.0-alpha.2/scripts/apply-alpha2.sh /path/to/akort-dwh-4
```

4. Add the successful alpha.1 baseline report ID to private `src/99_LocalConfig.js`:

```javascript
baselineReportId: '1WB9nnyl0vWALt8aNXJcGajsMftCoHxOl4_GATi9jRUI',
```

This field is optional because the code also reads `AKORT_ALPHA1_LAST_REPORT_ID` from Script Properties, but explicit local configuration is preferable.

5. Review changes in GitHub Desktop. `src/99_LocalConfig.js` must not be listed.
6. Run `clasp push`.
7. In DEV Apps Script run `AKORT_alpha2Install`.
8. Run `AKORT_alpha2SmokeTest`.
9. Run `AKORT_alpha2Status`.
