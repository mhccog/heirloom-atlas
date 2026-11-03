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

## Editing everything

Tap **Edit** in the header. Pencils appear beside things you can change, plus Add buttons, and a small bar at the bottom with **Undo**, **Lists** and **Done**.

- **Businesses**: open any card in edit mode for every field (name, town, trade, address, website, phone, who to ask for, need, offers, why, opener, approach type, potential, watchlist, map pin). "Back to the research version" undoes your edits to a researched business; "Delete this business" hides it (and its introductions).
- **Introductions**: Edit on each one (who, why, status, date, outcome, kind, strength). Made introductions form *Your thread*, where you log what happened (no reply yet, replied, they met, did business).
- **Towns, events, register signals, the in-the-car list, what to say, your story**: pencils in Visits. **Lists** in the edit bar holds all of these plus trades (name and colour), approach types, sources and app text.
- **People**: your notes, status, contact and visit dates are always editable on the card; in edit mode you can delete your record of a person (their People I've Met row goes to Notion's Trash, restorable there).
- Undo walks back the last 30 changes. Deletes in the three Heirloom Atlas databases only tick **Archived**, never remove a row.

Data model: `docs/assets/content.js` turns `data.json` into flat records and lays your edits over them (`S.ed`), so research updates and your changes stay separate.

## Notion sync (optional, two-way)

Tap **Notion** in the header, enter the sync passphrase once per device, and people sync with the Notion database *People I've Met* (Name, Met at, Contact, Notes; the automatic Added date is left alone).

- Name = who you met (else the business) · Met at = "Business, Town" · Contact = what they gave you · Notes = your notes under an app-managed first line: `Status: Got contact · Last visit: 2026-11-03 · Next visit: 2026-12-01` (edit it in Notion and the app reads it back).
- Syncs on load, a few seconds after each change, every 10 minutes while open, and on **Sync now**. Offline changes wait and send when you're back online.
- Newest edit wins (Notion `last_edited_time` vs the app's own edit time). Notion rows that match no business arrive as walk-ins. Rows deleted in Notion are unlinked, never re-created, and the local notes are kept. The visit log stays on the device.
- Businesses, introductions and towns & lists sync with three databases under the hub page: **Heirloom Atlas – Businesses**, **Heirloom Atlas – Introductions** (From/To are relations to Businesses) and **Heirloom Atlas – Towns & lists** (Kind + a Details column of `Label: value` lines). Each row carries an App ID. Tick Archived in Notion to delete; rows you add in Notion appear in the app. The integration must be connected to each of the three databases (••• → Connections → Heirloom Atlas sync); `node scripts/seed-notion.mjs` then fills them (safe to re-run), or the app fills an empty database on its first sync.
- The app only talks to a Cloudflare Worker (`worker/`, `heirloom-atlas-sync`) that holds the Notion key as a secret, accepts only `https://mhccog.github.io`, and needs the passphrase (`X-App-Key`). The passphrase is stored apart from your data, so backups never include it.
- Deploy: `scripts/deploy-sync.sh` (token from `/home/box/.secrets/notion_heirloom_token`, passphrase generated into `/home/box/.secrets/heirloom_app_key`, both sent with `wrangler secret put` over stdin). Tests: `npm test` (unit), `npm run test:sync-e2e` and `node scripts/content-e2e.mjs` (real Worker code + fake Notion + headless browser), `node scripts/edit-check.mjs` (edit mode).

Data: `data/raw.json` (research as of 2 Nov 2026) → `npm run data` → `docs/assets/data.json`.
Libraries: force-graph (MIT), MapLibre GL JS (BSD-3), Lucide icons (ISC, `scripts/icons.mjs`), Newsreader, Source Sans 3 and IBM Plex Mono (OFL). Map © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
