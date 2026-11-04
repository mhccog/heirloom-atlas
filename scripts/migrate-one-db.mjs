// One-off: copies every row from the three old Heirloom Atlas databases (Businesses, Introductions, Towns & lists)
// into the single "Heirloom Atlas" database, with From/To relations re-pointed at the new business rows.
// Safe to re-run: rows already copied (same App ID and Type) are updated, never duplicated. Then it checks the counts.
// Reads the token from a file and never prints it.   node scripts/migrate-one-db.mjs [--dry]
import { readFileSync } from 'node:fs';
import * as V1 from './lib-collections-v1.mjs';
import { toProps, fromPage, typeFilter } from '../worker/src/collections.js';
const TOKEN = readFileSync(process.env.NOTION_TOKEN_FILE || '/home/box/.secrets/notion_heirloom_token', 'utf8').trim();
const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8'); const ATLAS = (toml.match(/^ATLAS_DS\s*=\s*"([^"]+)"/m) || [])[1];
const OLD = { businesses: '6282e694-a13b-4dc4-9b89-225918bb940f', introductions: '61d4563b-b966-4510-88c1-840cf2d87bda', lists: '84c00f67-edd5-44a7-b15e-9192cd89315d' };
const DRY = process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, n = 0) {
  await sleep(350);
  const r = await fetch('https://api.notion.com/v1' + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if ((r.status === 429 || r.status >= 500 || r.status === 409) && n < 5) { await sleep(1000 * 2 ** n); return api(method, path, body, n + 1); }
  const j = await r.json(); if (!r.ok) throw new Error(`${r.status} ${j.code}: ${j.message}`); return j;
}
async function query(ds, filter) { const out = []; let c; do { const r = await api('POST', `/data_sources/${ds}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(c ? { start_cursor: c } : {}) }); out.push(...r.results.filter(p => !p.in_trash)); c = r.has_more ? r.next_cursor : null; } while (c); return out; }
const strip = ({ id, lastEdited, url, ...rest }) => rest;
const report = {}; const newId = {}; // old business page id -> new page id
for (const coll of ['businesses', 'lists', 'introductions']) {
  const old = (await query(OLD[coll])).map(p => V1.fromPage(coll, p));
  const have = (await query(ATLAS, typeFilter(coll))).map(p => fromPage(coll, p)); const byApp = new Map(have.map(r => [r.appId, r]));
  let made = 0, updated = 0, missingRel = 0;
  for (const o of old) {
    const row = strip(o);
    if (coll === 'introductions') { for (const k of ['a', 'b']) { const t = row[k] ? newId[row[k].replace(/-/g, '')] : ''; if (row[k] && !t) missingRel++; row[k] = t || ''; } }
    const cur = byApp.get(o.appId);
    if (DRY) { cur ? updated++ : made++; if (coll === 'businesses') newId[o.id.replace(/-/g, '')] = cur ? cur.id : 'dry'; continue; }
    const page = cur ? await api('PATCH', `/pages/${cur.id}`, { properties: toProps(coll, row, null) }) : await api('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: ATLAS }, properties: toProps(coll, row, null) });
    cur ? updated++ : made++;
    if (coll === 'businesses') newId[o.id.replace(/-/g, '')] = page.id;
  }
  // verify: same App IDs, same values, relations point at the same businesses
  const now = DRY ? [] : (await query(ATLAS, typeFilter(coll))).map(p => fromPage(coll, p)); const nowBy = new Map(now.map(r => [r.appId, r]));
  let mismatched = 0;
  if (!DRY) for (const o of old) { const n = nowBy.get(o.appId); const a = strip(o), b = n ? strip(n) : null; if (!b) { mismatched++; continue; }
    for (const k of Object.keys(a)) { let x = a[k], y = b[k]; if (k === 'a' || k === 'b') { x = x ? newId[x.replace(/-/g, '')] : ''; } if (String(x ?? '').replace(/-/g, '') !== String(y ?? '').replace(/-/g, '')) { mismatched++; if (process.env.DEBUG) console.log(o.appId, k); break; } } }
  report[coll] = { old: old.length, archivedOld: old.filter(r => r.archived).length, created: made, updated, inNew: DRY ? null : now.length, mismatched, missingRelations: missingRel };
}
console.log(JSON.stringify(report, null, 1));
const bad = Object.values(report).some(r => !DRY && (r.inNew !== r.old || r.mismatched || r.missingRelations));
process.exit(bad ? 1 : 0);
