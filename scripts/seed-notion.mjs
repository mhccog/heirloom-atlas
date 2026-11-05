// Seeds the Heirloom Atlas database in Notion from docs/assets/data.json. Safe to re-run: rows are matched by App ID
// and only missing ones are created. Needs the "Heirloom Atlas sync" integration connected to the database
// (Notion: open it → ••• → Connections). The token is read from a file and never printed.
//   node scripts/seed-notion.mjs [--dry]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { toProps, fromPage, COLLECTIONS, typeFilter } from '../worker/src/collections.js';
const require = createRequire(import.meta.url);
const C = require('../docs/assets/content.js'); const D = require('../docs/assets/data.json');
const TOKEN = readFileSync(process.env.NOTION_TOKEN_FILE || '/home/box/.secrets/notion_heirloom_token', 'utf8').trim();
const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8'); const v = k => (toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
const ATLAS = v('ATLAS_DS'); const DS = { biz: ATLAS, intro: ATLAS, list: ATLAS }; const EP = C.ENDPOINT; const DRY = process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, n = 0) {
  await sleep(350);
  const r = await fetch('https://api.notion.com/v1' + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if ((r.status === 429 || r.status >= 500) && n < 4) { await sleep(1000 * 2 ** n); return api(method, path, body, n + 1); }
  const j = await r.json(); if (!r.ok) throw new Error(`${r.status} ${j.code}: ${j.message}`); return j;
}
async function all(coll) { const out = []; let c; do { const r = await api('POST', `/data_sources/${DS[coll]}/query`, { page_size: 100, filter: typeFilter(EP[coll]), ...(c ? { start_cursor: c } : {}) }); out.push(...r.results.filter(p => !p.in_trash).map(p => fromPage(EP[coll], p))); c = r.has_more ? r.next_cursor : null; } while (c); return out; }
const V = C.view(D, { ed: {} }); const sd = C.seeds(D); const nid = {};
const ctx = { towns: V.towns, cats: V.cats, personas: V.personas, biz: V.biz, nidOf: (c, id) => nid[id] || '', idOfNid: () => '' };
for (const coll of ['biz', 'list', 'intro']) {
  const have = await all(coll); const byApp = new Map(have.map(r => [r.appId, r])); let made = 0;
  for (const r of have) if (coll === 'biz' && r.appId) nid[r.appId] = r.id;
  for (const rec of Object.values(sd[coll])) {
    if (byApp.has(rec.id)) continue;
    const row = C.toRow(coll, rec, ctx);
    if (DRY) { made++; continue; }
    const page = await api('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: DS[coll] }, properties: toProps(EP[coll], row, null) });
    if (coll === 'biz') nid[rec.id] = page.id; made++;
  }
  console.log(`${COLLECTIONS[EP[coll]] ? EP[coll] : coll}: ${have.length} already there, ${made} ${DRY ? 'would be ' : ''}created`);
}
