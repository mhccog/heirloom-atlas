#!/usr/bin/env bash
# After "Heirloom Atlas sync" is connected to the combined Heirloom Atlas database:
# copy the rows over and check them, deploy the Worker (heirloom-atlas-sync only), then run the live round trip.
# Secrets are read from files and never printed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
DS=$(sed -n 's/^ATLAS_DS *= *"\([^"]*\)".*/\1/p' worker/wrangler.toml)
code=$(curl -s -o /dev/null -w '%{http_code}' "https://api.notion.com/v1/data_sources/$DS" -H "Authorization: Bearer $(tr -d '\r\n' < /home/box/.secrets/notion_heirloom_token)" -H 'Notion-Version: 2026-03-11')
[ "$code" = 200 ] || { echo "The integration can't see the Heirloom Atlas database yet (HTTP $code). Connect it in Notion first." >&2; exit 1; }
node scripts/migrate-one-db.mjs
CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < /home/box/.secrets/cf_api_token)" scripts/deploy-sync.sh --no-config
node scripts/live-check.mjs
