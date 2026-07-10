# Rollback

Code rollback:

```bash
bash /path/to/akort-v4.0.0-alpha.2/scripts/rollback-alpha2.sh \
  /path/to/akort-dwh-4/.alpha2-backup-YYYYMMDD_HHMMSS \
  /path/to/akort-dwh-4
clasp push
```

Alternatively revert the alpha.2 Git commit in GitHub Desktop and run `clasp push`.

The five service tables may remain in the DEV DWH after code rollback. Alpha.1 does not read them, and retaining them preserves the audit trail. Do not delete production resources.
