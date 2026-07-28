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
clasp status
clasp push

echo "DEV deployment completed. Run AKORT_alpha74Install, AKORT_alpha74SmokeTest and AKORT_alpha74ReadOnlyContractScan in Apps Script."
