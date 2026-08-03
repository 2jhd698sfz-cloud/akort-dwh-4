#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .clasp.json ]]; then
  echo "ERROR: .clasp.json was not found in $ROOT_DIR" >&2
  exit 1
fi
if [[ ! -f src/99_LocalConfig.js ]]; then
  echo "ERROR: src/99_LocalConfig.js was not found. Do not deploy without the local DEV configuration." >&2
  exit 1
fi

CLASP_ID="$(node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('.clasp.json','utf8')); process.stdout.write(x.scriptId||'')")"
CONFIG_ID="$(node -e "const fs=require('fs'); const s=fs.readFileSync('src/99_LocalConfig.js','utf8'); const m=s.match(/expectedScriptId:\s*['\"]([^'\"]+)['\"]/); process.stdout.write(m?m[1]:'')")"

if [[ -z "$CLASP_ID" || -z "$CONFIG_ID" || "$CLASP_ID" != "$CONFIG_ID" ]]; then
  echo "ERROR: DEV Script ID mismatch. Deployment stopped." >&2
  echo "  .clasp.json: $CLASP_ID" >&2
  echo "  local config: $CONFIG_ID" >&2
  exit 1
fi

if git status --porcelain | grep -E '^.. \.clasp\.json$' >/dev/null 2>&1; then
  echo "ERROR: .clasp.json must never be committed." >&2
  exit 1
fi

echo "Target verified: DEV Apps Script $CLASP_ID"
npm test

CLASP_STATUS_JSON="$(clasp status --json)"
node -e '
const status = JSON.parse(process.argv[1]);
const files = status.filesToPush || [];
const unsafe = files.filter(file => /(?:backup-|\.bak$|\.tmp$|~$)/i.test(file));
const required = ["src/00_Release.js", "src/28_Alpha74Gate6Acceptance.js", "src/appsscript.json"];
const missing = required.filter(file => !files.includes(file));
if (unsafe.length || missing.length) {
  console.error(JSON.stringify({ unsafeFilesToPush: unsafe, missingRequiredFiles: missing }, null, 2));
  process.exit(1);
}
console.log(`Upload set verified: ${files.length} tracked Apps Script files; local backup artifacts excluded.`);
' "$CLASP_STATUS_JSON"
clasp status
clasp push

echo "DEV deployment completed. For the current stopped Gate 6 incident, follow docs/alpha-7.4/ALPHA74_29_COMMIT_CLASP_APPS_SCRIPT_RUNBOOK.md: Gate6Stop first, then Install and read-only checks."
