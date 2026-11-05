// End-to-end check of the businesses / introductions / towns & lists sync, fully local:
// real Worker code + a fake Notion that understands typed properties + the app in a headless browser.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { handle, _t } from '../worker/src/index.js';
const APP = 8098, WK = 8786, KEY = 'test-pass';
const env = { NOTION_TOKEN: 'ntn_fake', APP_KEY: KEY, DATA_SOURCE_ID: 'people', ATLAS_DS: 'ds-atlas', ALLOWED_ORIGINS: `http://localhost:${APP}` };
_t.gap = 0;
const pages = new Map(); let n = 0, clock = Date.now() - 3600e3;
const tick = () => new Date(clock += 60e3).toISOString().replace(/\d\d\.\d{3}Z$/, '00.000Z');
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const read = props => Object.fromEntries(Object.entries(props).map(([k, v]) => { const t = Object.keys(v)[0]; const val = v[t]; return [k, { type: t, [t]: (t === 'title' || t === 'rich_text') ? val.map(x => ({ plain_text: x.text.content, text: x.text })) : val }]; }));
const txt = (p, k) => { if (k === 'Kind' && LT.includes(typeOf(p))) k = 'Type'; const x = p.properties[k]; if (!x) return detLines(p)[k] ?? ''; const t = x.type; return (t === 'title' || t === 'rich_text') ? x[t].map(y => y.plain_text).join('') : t === 'select' ? (x.select ? x.select.name : '') : t === 'checkbox' ? x.checkbox : t === 'relation' ? (x.relation[0] || {}).id : x[t]; };
const LT = ['Town', 'Event', 'Trade', 'Approach', 'Signal', 'Script step', 'Car checklist', 'After visit', 'Story', 'Source', 'App text'];
const typeOf = p => (p.properties.Type && p.properties.Type.select ? p.properties.Type.select.name : '');
const inType = (p, ds) => ds === 'ds-biz' ? typeOf(p) === 'Business' : ds === 'ds-intro' ? typeOf(p) === 'Introduction' : ds === 'ds-list' ? LT.includes(typeOf(p)) : true;
const rawDs = ds => [...pages.values()].filter(p => p.parent.data_source_id === ds && !p.in_trash);
const inDs = ds => rawDs('ds-atlas').filter(p => inType(p, ds));
const matches = (p, f) => !f ? true : f.or ? f.or.some(g => matches(p, g)) : f.property === 'Type' ? typeOf(p) === f.select.equals : true;
const detLines = p => Object.fromEntries(((p.properties.Details || {}).rich_text || []).map(x => x.plain_text).join('').split('\n').map(l => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2).replace(/\\n/g, '\n')]));
const setDet = (p, label, v) => { const d = detLines(p); d[label] = v; return { Details: { rich_text: [{ text: { content: Object.entries(d).filter(([k]) => k).map(([k, x]) => `${k}: ${x}`).join('\n') } }] } }; };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init = {}) => {
  if (!String(u).startsWith('https://api.notion.com/')) return realFetch(u, init);
  const path = String(u).slice('https://api.notion.com/v1'.length); const body = init.body ? JSON.parse(init.body) : null; let m;
  if ((m = path.match(/^\/data_sources\/(.+)\/query$/))) { const all = rawDs(m[1]).filter(p => matches(p, body.filter)); const st = body.start_cursor ? +body.start_cursor : 0; const sl = all.slice(st, st + body.page_size); return Response.json({ results: sl, has_more: st + body.page_size < all.length, next_cursor: st + body.page_size < all.length ? String(st + body.page_size) : null }); }
  if (path === '/pages' && init.method === 'POST') { const id = uuid(); const p = { object: 'page', id, url: 'https://www.notion.so/' + id.replace(/-/g, ''), last_edited_time: tick(), created_time: tick(), in_trash: false, parent: { type: 'data_source_id', data_source_id: body.parent.data_source_id }, properties: read(body.properties) }; pages.set(id, p); return Response.json(p); }
  const p = (m = path.match(/^\/pages\/(.+)$/)) && [...pages.values()].find(x => x.id.replace(/-/g, '') === m[1].replace(/-/g, ''));
  if (!p) return Response.json({ code: 'object_not_found', message: 'Could not find page' }, { status: 404 });
  if (init.method === 'GET') return Response.json(p);
  Object.assign(p.properties, read(body.properties || {})); if (body.in_trash) p.in_trash = true; p.last_edited_time = tick(); return Response.json(p);
};
const nEdit = (p, props) => { Object.assign(p.properties, read(props)); clock = Math.max(clock, Date.now() + 60e3); p.last_edited_time = tick(); };
const T = s => [{ text: { content: s } }];
const worker = http.createServer(async (req, res) => { const ch = []; for await (const c of req) ch.push(c); const r = await handle(new Request(`http://localhost:${WK}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(ch) }), env); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); }).listen(WK);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const site = http.createServer(async (req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const f = join(process.cwd(), 'docs', p.endsWith('/') ? p + 'index.html' : p); try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } }).listen(APP);

const results = {}, errs = []; const ok = (k, v) => { results[k] = v; if (v !== true) errs.push(k + ': ' + JSON.stringify(v)); };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await b.newPage(); page.on('pageerror', e => errs.push('pageerror ' + e.message)); page.on('dialog', d => d.accept());
const w = ms => new Promise(r => setTimeout(r, ms));
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem('heirloom-atlas/v1')));
const sync = async () => { await page.evaluate(() => window.__sync.run()); await w(200); for (let i = 0; i < 900 && (await page.evaluate(() => window.__sync._state())) === 'syncing'; i++) await w(100); };
const byApp = (ds, id) => inDs(ds).find(p => txt(p, 'App ID') === id) || [...pages.values()].find(p => p.parent.data_source_id === ds && txt(p, 'App ID') === id);
try {
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(`http://localhost:${APP}/`, { waitUntil: 'networkidle0' });
  await page.evaluate((u, k) => { localStorage.clear(); localStorage.setItem('heirloom-atlas/sync', JSON.stringify({ url: u, key: k })); }, `http://localhost:${WK}`, KEY);
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.__ready'); await w(500); for (let i = 0; i < 1500 && (await page.evaluate(() => window.__sync._state())) !== 'ok'; i++) await w(100); await sync();
  ok('first sync seeds empty databases', inDs('ds-biz').length === 45 && inDs('ds-intro').length === 70 && inDs('ds-list').length > 40);
  const ha = byApp('ds-biz', 'hungerford-arcade'); const intro0 = inDs('ds-intro')[0];
  ok('intro relations point at business rows', !!txt(intro0, 'From') && pages.has(txt(intro0, 'From')) && typeOf(pages.get(txt(intro0, 'From'))) === 'Business');
  ok('select, number, checkbox, url written', txt(ha, 'Town') === 'Hungerford' && txt(ha, 'Latitude') === '51.41449' && txt(ha, 'Retiring founder') === 'yes' && typeOf(ha) === 'Business' && !ha.properties.Latitude && txt(ha, 'Website') === 'https://www.hungerfordarcade.com/');
  await sync(); ok('second sync is quiet (no echo writes)', await page.evaluate(() => window.__sync.pending()) === 0);

  // app -> Notion, all three types
  await page.evaluate(() => { const sh = window.__test; sh.editRec('biz', 'hungerford-arcade', { need: 'Edited in the app' }); sh.editRec('intro', sh.firstIntro(), { state: 'made', at: '2026-11-03', outcome: 'Replied' }); sh.editRec('list', 'town:lewes', { bestDay: 'Saturday (edited)' }); sh.commit(); });
  await sync();
  const iid = await page.evaluate(() => window.__test.firstIntro());
  ok('app edit -> Notion: business', txt(byApp('ds-biz', 'hungerford-arcade'), 'Their need') === 'Edited in the app');
  ok('app edit -> Notion: introduction', txt(byApp('ds-intro', iid), 'Status') === 'Made' && txt(byApp('ds-intro', iid), 'Outcome') === 'Replied');
  ok('app edit -> Notion: town', /Best day: Saturday \(edited\)/.test(txt(byApp('ds-list', 'town:lewes'), 'Details')));

  // Notion -> app, all three types
  nEdit(byApp('ds-biz', 'dreweatts'), { 'Phone': { phone_number: '01635 000000' } });
  nEdit(byApp('ds-intro', iid), { 'Outcome': { select: { name: 'They met' } }, ...setDet(byApp('ds-intro', iid), 'Outcome note', 'Coffee on Friday') });
  const evRow = inDs('ds-list').find(p => txt(p, 'Kind') === 'Event'); const evId = txt(evRow, 'App ID');
  nEdit(evRow, { Name: { title: T('Renamed in Notion') } });
  await sync(); let s = await st();
  ok('Notion edit -> app: business', s.ed.biz.dreweatts.f.phone === '01635 000000');
  ok('Notion edit -> app: introduction', s.ed.intro[iid].f.outcome === 'They met' && s.ed.intro[iid].f.outcomeNote === 'Coffee on Friday');
  ok('Notion edit -> app: event', s.ed.list[evId].f.name === 'Renamed in Notion' && await page.evaluate(id => window.__test.D().events.some(e => e.what === 'Renamed in Notion'), evId));

  // rows added in Notion
  const nb = uuid(); pages.set(nb, { object: 'page', id: nb, last_edited_time: tick(), parent: { type: 'data_source_id', data_source_id: 'ds-atlas' }, properties: read({ Name: { title: T('Notion Test Bindery') }, Type: { select: { name: 'Business' } }, Town: { select: { name: 'Lewes' } }, Trade: { rich_text: T('Rare books') } }) });
  await sync(); s = await st();
  const nbId = Object.keys(s.ed.biz).find(k => s.ed.biz[k].f && s.ed.biz[k].f.name === 'Notion Test Bindery');
  ok('row added in Notion -> new business in app (town and trade resolved)', !!nbId && s.ed.biz[nbId].f.town === 'lewes' && s.ed.biz[nbId].f.cat === 3 && txt(pages.get(nb), 'App ID') === nbId);
  const ni = uuid(); pages.set(ni, { object: 'page', id: ni, last_edited_time: tick(), parent: { type: 'data_source_id', data_source_id: 'ds-atlas' }, properties: read({ Name: { title: T('x') }, Type: { select: { name: 'Introduction' } }, From: { relation: [{ id: nb }] }, To: { relation: [{ id: byApp('ds-biz', 'gorringe-s').id }] }, Why: { rich_text: T('Both handle old books') } }) });
  await sync(); s = await st();
  const niId = Object.keys(s.ed.intro).find(k => s.ed.intro[k].f && s.ed.intro[k].f.why === 'Both handle old books');
  ok('intro added in Notion -> app, relations resolved', !!niId && s.ed.intro[niId].f.a === nbId && s.ed.intro[niId].f.b === 'gorringe-s');

  // delete in app -> Archived in Notion; undo -> unarchived
  clock = Date.now() - 600e3; // Notion's clock is the real one from here on
  await page.evaluate(id => { window.__test.delRec('biz', id); window.__test.commit(); }, nbId); await sync();
  ok('delete in app ticks Archived (row kept)', txt(pages.get(nb), 'Archived') === true && !pages.get(nb).in_trash);
  await page.evaluate(() => { window.__test.undo(); }); await sync();
  ok('undo un-archives', txt(pages.get(nb), 'Archived') === false && !!(await page.evaluate(id => window.__test.BY()[id], nbId)));
  // archive in Notion -> gone in app
  clock = Date.now() + 86400e3; nEdit(pages.get(ni), { Archived: { checkbox: true } }); await sync(); s = await st();
  ok('archived in Notion -> hidden in app', s.ed.intro[niId].del === true || JSON.stringify(s.ed.intro[niId]));
  // offline edit queues
  await page.setOfflineMode(true);
  await page.evaluate(() => { window.__test.editRec('list', 'town:petworth', { name: 'Petworth (offline edit)' }); window.__test.commit(); });
  await page.evaluate(() => window.__sync.run()); await w(400);
  ok('offline edit waits', await page.evaluate(() => window.__sync._state()) === 'waiting' && await page.evaluate(() => window.__sync.pending()) >= 1);
  await page.setOfflineMode(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await w(1200); await sync();
  ok('offline edit sent when back', txt(byApp('ds-list', 'town:petworth'), 'Name') === 'Petworth (offline edit)');
  // conflict: newer local wins over older Notion edit
  const dr = byApp('ds-biz', 'dreweatts'); Object.assign(dr.properties, read(setDet(dr, 'Their need', 'older notion'))); clock = Date.now() - 7200e3; dr.last_edited_time = tick();
  await page.evaluate(() => { window.__test.editRec('biz', 'dreweatts', { need: 'newer local' }); window.__test.commit(); }); await sync();
  ok('newest edit wins', txt(byApp('ds-biz', 'dreweatts'), 'Their need') === 'newer local');
  // moving to a new database: rows copied with new ids, the app relinks by App ID without losing or duplicating anything
  const before = await page.evaluate(() => ({ biz: window.__test.D().biz.length, intros: window.__test.D().intros.length, towns: window.__test.D().towns.length }));
  const map = {}; const old = rawDs('ds-atlas');
  for (const q of old) map[q.id] = uuid();
  for (const q of old) { const c = JSON.parse(JSON.stringify(q)); c.id = map[q.id]; c.parent.data_source_id = 'ds-atlas2'; for (const k of ['From', 'To']) if (c.properties[k]) c.properties[k].relation = c.properties[k].relation.map(r => ({ id: map[r.id] || r.id })); c.last_edited_time = tick(); pages.set(c.id, c); }
  env.ATLAS_DS = 'ds-atlas2'; const writes0 = [...pages.values()].filter(p => p.parent.data_source_id === 'ds-atlas2').length;
  await sync(); await sync();
  const after = await page.evaluate(() => ({ biz: window.__test.D().biz.length, intros: window.__test.D().intros.length, towns: window.__test.D().towns.length }));
  ok('moved to a new database: nothing lost or duplicated', JSON.stringify(before) === JSON.stringify(after) && [...pages.values()].filter(p => p.parent.data_source_id === 'ds-atlas2').length === writes0);
  const nids = await page.evaluate(() => { const ed = JSON.parse(localStorage.getItem('heirloom-atlas/v1')).ed; return [].concat(...['biz', 'intro', 'list'].map(c => Object.values(ed[c]).map(e => e.nid).filter(Boolean))); });
  ok('moved: app linked to the new rows', nids.length > 150 && nids.every(id => (pages.get(id) || {}).parent?.data_source_id === 'ds-atlas2'));
} catch (e) { errs.push('crash ' + (e.stack || e)); }
console.log(JSON.stringify({ results, errs }, null, 1));
await b.close(); worker.close(); site.close(); process.exit(errs.length ? 1 : 0);
