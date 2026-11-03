# The Heirloom Atlas

*I connect people who don't know they need each other.*

A mobile-first web app for walk-in networking in heirloom-trade towns ("businesses whose worth is handed down rather than scaled up").

Live: https://mhccog.github.io/heirloom-atlas/

- **People**: an interactive web of 45 businesses in 7 towns, coloured by trade, sized by connection potential, linked by suggested introductions. List layout for phones.
- **Person card**: who to ask for (a role; a name only where the source gives one), a light "how to approach" guess, an opener, their need (a guess), who they could meet, status pipeline, notes, visit dates, .ics reminder.
- **Introductions**: rule-based suggestions from needs and offers, mark made / not now, add your own.
- **Visits**: per-town walking order, events, retiring-founder watchlist, register signals, prep, and a Today mode for the street.
- **Where**: MapLibre map on OpenFreeMap tiles, with a globe toggle. Approximate pins are marked.

Everything you record stays in your browser (localStorage). Export a JSON backup or a CSV from "Your data".

## Notion sync (optional, two-way)

Tap **Notion** in the header, enter the sync passphrase once per device, and people sync with the Notion database *People I've Met* (Name, Met at, Contact, Notes; the automatic Added date is left alone).

- Name = who you met (else the business) · Met at = "Business, Town" · Contact = what they gave you · Notes = your notes under an app-managed first line: `Status: Got contact · Last visit: 2026-11-03 · Next visit: 2026-12-01` (edit it in Notion and the app reads it back).
- Syncs on load, a few seconds after each change, every 10 minutes while open, and on **Sync now**. Offline changes wait and send when you're back online.
- Newest edit wins (Notion `last_edited_time` vs the app's own edit time). Notion rows that match no business arrive as walk-ins. Rows deleted in Notion are unlinked, never re-created, and the local notes are kept. Introductions and the visit log stay on the device.
- The app only talks to a Cloudflare Worker (`worker/`, `heirloom-atlas-sync`) that holds the Notion key as a secret, accepts only `https://mhccog.github.io`, and needs the passphrase (`X-App-Key`). The passphrase is stored apart from your data, so backups never include it.
- Deploy: `scripts/deploy-sync.sh` (token from `/home/box/.secrets/notion_heirloom_token`, passphrase generated into `/home/box/.secrets/heirloom_app_key`, both sent with `wrangler secret put` over stdin). Tests: `npm test` (unit) and `npm run test:sync-e2e` (real Worker code + fake Notion + headless browser).

Data: `data/raw.json` (research as of 2 Nov 2026) → `npm run data` → `docs/assets/data.json`.
Libraries: force-graph (MIT), MapLibre GL JS (BSD-3), Fraunces and Inter (OFL). Map © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
