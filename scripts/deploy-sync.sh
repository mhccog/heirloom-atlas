#!/usr/bin/env bash
# Deploy the Notion sync Worker (heirloom-atlas-sync) to Cloudflare.
#   - reads the Notion integration token from $TOKEN_FILE (never printed, never in the repo)
#   - creates a random APP_KEY passphrase in $KEY_FILE the first time (kept on the box, mode 600)
#   - deploys the Worker, then pipes both secrets into `wrangler secret put` via stdin
#   - smoke-tests the live Worker and writes its URL into docs/assets/sync-config.js
# Needs: `npx wrangler login` done once (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment).
# Flags: --no-config  don't touch docs/assets/sync-config.js     --rotate-key  make a new passphrase
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="${NOTION_TOKEN_FILE:-/home/box/.secrets/notion_heirloom_token}"
KEY_FILE="${APP_KEY_FILE:-/home/box/.secrets/heirloom_app_key}"
WRITE_CONFIG=1; ROTATE=0
for a in "$@"; do case "$a" in --no-config) WRITE_CONFIG=0 ;; --rotate-key) ROTATE=1 ;; *) echo "Unknown flag: $a" >&2; exit 2 ;; esac; done

# Wrangler 4 needs Node 22+; use the box copy if the system node is older.
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
  [ -x /home/box/.local/node22/bin/node ] || { echo "Node 22+ is required for wrangler (none found)." >&2; exit 1; }
  export PATH="/home/box/.local/node22/bin:$PATH"
fi
cd "$ROOT/worker"
[ -x node_modules/.bin/wrangler ] || npm ci --no-audit --no-fund
WR=(node_modules/.bin/wrangler)

# 1. secrets on the box
[ -s "$TOKEN_FILE" ] || { echo "Missing Notion token file: $TOKEN_FILE (create the integration, paste its secret there, chmod 600)." >&2; exit 1; }
chmod 600 "$TOKEN_FILE"
if ! tr -d '\r\n' < "$TOKEN_FILE" | grep -Eq '^(ntn_|secret_)[A-Za-z0-9]+$'; then
  echo "Warning: $TOKEN_FILE doesn't look like a Notion internal integration secret (ntn_… or secret_…)." >&2
fi
umask 077; mkdir -p "$(dirname "$KEY_FILE")"; chmod 700 "$(dirname "$KEY_FILE")"
if [ ! -s "$KEY_FILE" ] || [ "$ROTATE" = 1 ]; then
  # 6 groups of 4 from an unambiguous alphabet (~124 bits): easy to type on a phone once.
  node -e 'const c="abcdefghjkmnpqrstuvwxyz23456789";const b=require("crypto").randomBytes(24);let s="";for(let i=0;i<24;i++){s+=c[b[i]%c.length];if(i%4==3&&i<23)s+="-"}process.stdout.write(s)' > "$KEY_FILE"
  chmod 600 "$KEY_FILE"; echo "New APP_KEY passphrase saved to $KEY_FILE"
fi

# 2. Cloudflare login: an API token file wins over a stored `wrangler login`.
CF_TOKEN_FILE="${CLOUDFLARE_API_TOKEN_FILE:-/home/box/.secrets/cf_api_token}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -s "$CF_TOKEN_FILE" ]; then
  CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < "$CF_TOKEN_FILE")"; export CLOUDFLARE_API_TOKEN
fi
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID
if ! "${WR[@]}" whoami 2>/dev/null | grep -qiE 'associated with the email|account id|logged in'; then
  echo "Not logged in to Cloudflare. Run:  cd $ROOT/worker && npx wrangler login   (or set CLOUDFLARE_API_TOKEN)" >&2; exit 1
fi

# 3. deploy code (vars come from wrangler.toml), then secrets from stdin
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
"${WR[@]}" deploy 2>&1 | tee "$LOG"
URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$LOG" | head -n1 || true)"
tr -d '\r\n' < "$TOKEN_FILE" | "${WR[@]}" secret put NOTION_TOKEN
tr -d '\r\n' < "$KEY_FILE"   | "${WR[@]}" secret put APP_KEY

# 4. smoke test (reads the key from the file itself; prints counts only)
if [ -n "$URL" ]; then
  echo "Worker URL: $URL"; sleep 3
  node "$ROOT/scripts/check-sync.mjs" "$URL" "$KEY_FILE" || echo "Smoke test failed: is the Notion integration connected to 'People I've Met'? (Notion: ••• → Connections)" >&2
  if [ "$WRITE_CONFIG" = 1 ]; then
    sed -i -E "s#url: '[^']*'#url: '$URL'#" "$ROOT/docs/assets/sync-config.js"
    echo "Wrote $URL into docs/assets/sync-config.js (commit it on the notion-sync branch)."
  fi
else
  echo "Couldn't read the workers.dev URL from the deploy output; set it in docs/assets/sync-config.js by hand." >&2
fi
echo "Passphrase for the app's Notion sync panel is in $KEY_FILE (not printed here)."
