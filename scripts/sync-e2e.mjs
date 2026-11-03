// End-to-end check of Notion sync, fully local: the real Worker code runs in Node against a fake Notion,
// the app is served from docs/, and a headless browser drives it. Nothing touches the real Notion or Cloudflare.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { handle, _t } from '../worker/src/index.js';

const DS = 'ds-test', APP = 8099, WK = 8787, KEY = 'test-pass';
const env = { NOTION_TOKEN: 'ntn_fake', APP_KEY: KEY, DATA_SOURCE_ID: DS, ALLOWED_ORIGINS: `http://localhost:${APP}`, NOTION_VERSION: '2026-03-11' };
_t.gap = 0;

// ---- fake Notion ----
const pages = new Map(); let n = 0, clock = Date.parse('2026-11-03T10:00:00Z');
const T = s => s ? [{ type: 'text', plain_text: s, text: { content: s } }] : [];
const tick = () => new Date(clock += 60e3).toISOString().replace(/\d\d\.\d{3}Z$/, '00.000Z'); // minute precision like Notion
function put(id, f, edited) { const p = { object: 'page', id, url: 'https://www.notion.so/' + id.replace(/-/g, ''), created_time: tick(), last_edited_time: edited || tick(), in_trash: false, parent: { type: 'data_source_id', data_source_id: DS },
  properties: { Name: { type: 'title', title: T(f.name) }, 'Met at': { type: 'rich_text', rich_text: T(f.metAt) }, Contact: { type: 'rich_text', rich_text: T(f.contact) }, Notes: { type: 'rich_text', rich_text: T(f.notes) } } }; pages.set(id, p); return p; }
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const get = id => { const p = pages.get(id); const t = k => (p.properties[k].title || p.properties[k].rich_text).map(x => x.plain_text).join(''); return { name: t('Name'), metAt: t('Met at'), contact: t('Contact'), notes: t('Notes'), edited: p.last_edited_time }; };
const edit = (id, f) => { const p = pages.get(id); for (const [k, v] of Object.entries(f)) p.properties[{ name: 'Name', metAt: 'Met at', contact: 'Contact', notes: 'Notes' }[k]] = k === 'name' ? { type: 'title', title: T(v) } : { type: 'rich_text', rich_text: T(v) }; p.last_edited_time = tick(); };
const blankId = uuid(); put(blankId, {});
const sarah = uuid(); put(sarah, { name: 'Sarah', metAt: 'Hungerford Arcade, Hungerford', contact: 'sarah@example.com', notes: 'Status: Got contact · Next visit: 2026-12-01\nLikes clocks' });
const jo = uuid(); put(jo, { name: 'Jo', metAt: 'The Clock Shop, Lewes', notes: 'Restores longcase clocks' });
const realFetch = globalThis.fetch; let notionCalls = 0;
globalThis.fetch = async (u, init = {}) => {
  if (!String(u).startsWith('https://api.notion.com/')) return realFetch(u, init);
  notionCalls++; const path = String(u).slice('https://api.notion.com/v1'.length); const body = init.body ? JSON.parse(init.body) : null;
  const toProps = props => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.title ? { type: 'title', title: v.title.map(x => ({ ...x, plain_text: x.text.content })) } : { type: 'rich_text', rich_text: v.rich_text.map(x => ({ ...x, plain_text: x.text.content })) }]));
  if (path === `/data_sources/${DS}/query`) { const all = [...pages.values()].filter(p => !p.in_trash).sort((a, b) => b.last_edited_time.localeCompare(a.last_edited_time)); return Response.json({ results: all, has_more: false, next_cursor: null }); }
  if (path === '/pages' && init.method === 'POST') { const p = put(uuid(), {}); Object.assign(p.properties, toProps(body.properties)); return Response.json(p); }
  const m = path.match(/^\/pages\/(.+)$/); const p = m && [...pages.values()].find(x => x.id.replace(/-/g, '') === m[1].replace(/-/g, ''));
  if (!p) return Response.json({ code: 'object_not_found', message: 'not found' }, { status: 404 });
  if (init.method === 'GET') return Response.json(p);
  Object.assign(p.properties, toProps(body.properties)); p.last_edited_time = tick(); return Response.json(p);
};

// ---- servers ----
const worker = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await handle(new Request(`http://localhost:${WK}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(WK);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const site = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const f = join(process.cwd(), 'docs', p.endsWith('/') ? p + 'index.html' : p);
  try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(APP);

// ---- browser ----
const results = {}; const errs = [];
const ok = (k, v) => { results[k] = v; if (v !== true) errs.push(k + ': ' + JSON.stringify(v)); };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await b.newPage(); page.on('pageerror', e => errs.push('pageerror ' + e.message));
const w = ms => new Promise(r => setTimeout(r, ms));
const st = () => page.evaluate(() => JSON.parse(localStorage.getItem('heirloom-atlas/v1')));
const syncState = () => page.evaluate(() => window.__sync._state());
const waitIdle = async () => { await w(150); for (let i = 0; i < 60 && (await syncState()) === 'syncing'; i++) await w(100); };
try {
  await page.setViewport({ width: 1280, height: 860 });
  await page.goto(`http://localhost:${APP}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready');
  ok('off by default', await page.$eval('#btn-sync', e => e.dataset.state) === 'off');

  // turn on through the panel
  await page.click('#btn-sync'); await w(200);
  await page.evaluate(() => { document.querySelector('dialog details').open = true; });
  await page.type('dialog [name=key]', KEY); await page.type('dialog [name=url]', `http://localhost:${WK}`);
  await page.click('dialog button[value=ok]'); await w(300);
  ok('rejects a non-https address (dialog stays open)', await page.$eval('#dlg', d => d.open) === true);
  // the test Worker is plain http on localhost, so set it directly the way the panel stores it
  await page.evaluate((u, k) => { localStorage.setItem('heirloom-atlas/sync', JSON.stringify({ url: u, key: k })); }, `http://localhost:${WK}`, KEY);
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction('window.__ready'); await waitIdle();
  ok('sync on load ok', await syncState() === 'ok');
  let s = await st();
  const ha = s.people['hungerford-arcade'] || {};
  ok('pulled Sarah into Hungerford Arcade', ha.met === 'Sarah' && ha.stage === 2 && ha.next === '2026-12-01' && ha.contact === 'sarah@example.com' && ha.notes === 'Likes clocks' && ha.nid === sarah);
  const wi = Object.values(s.ed.biz).map(e => e.f).find(x => x && x.fromNotion);
  ok('Jo became a walk-in in Lewes', !!wi && wi.name === 'The Clock Shop' && wi.town === 'lewes' && s.people[wi.id].met === 'Jo');
  ok('blank row ignored', Object.values(s.ed.biz).filter(e => e.isNew).length === 1);
  ok('header-less Notion notes got the status line added', get(jo).notes === 'Status: Said hi\nRestores longcase clocks');
  ok('Sarah row not rewritten needlessly', get(sarah).notes === 'Status: Got contact · Next visit: 2026-12-01\nLikes clocks');

  // local change -> debounced POST
  await page.evaluate(() => { location.hash = '#people/roger-king-antiques'; }); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction('window.__ready'); await w(800); await waitIdle();
  await page.click('.pipeline button[data-stage="1"]');
  await page.$eval('#n-met', e => { e.value = 'Roger'; e.dispatchEvent(new Event('change')); });
  await page.$eval('#n-contact', e => { e.value = '01488 000000'; e.dispatchEvent(new Event('change')); });
  ok('pending shows before debounce', await page.evaluate(() => window.__sync.pending()) >= 1);
  await w(4600); await waitIdle();
  const rk = [...pages.values()].map(p => get(p.id)).find(r => r.metAt === 'Roger King Antiques, Hungerford');
  ok('created row in Notion', !!rk && rk.name === 'Roger' && rk.contact === '01488 000000' && /^Status: Said hi · Last visit: \d{4}-\d\d-\d\d$/.test(rk.notes));
  ok('only one row created', [...pages.values()].filter(p => get(p.id).metAt === 'Roger King Antiques, Hungerford').length === 1);

  // remote edit wins when newer
  clock = Date.now() + 120e3; edit(sarah, { notes: 'Status: Connected · Next visit: 2027-01-10\nIntro to the clockmaker made' });
  await page.evaluate(() => window.__sync.run()); await waitIdle(); s = await st();
  ok('newer Notion edit pulled', s.people['hungerford-arcade'].stage === 4 && s.people['hungerford-arcade'].next === '2027-01-10' && s.people['hungerford-arcade'].notes === 'Intro to the clockmaker made');

  // conflict: older remote edit loses to a newer local edit
  clock = Date.now() - 3600e3; edit(sarah, { contact: 'old@example.com' });
  await page.evaluate(() => { location.hash = '#people/hungerford-arcade'; }); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction('window.__ready'); await w(800); await waitIdle();
  // (that reload synced: remote changed, local not dirty -> pulled old@)
  ok('remote-only change pulled even if old', (await st()).people['hungerford-arcade'].contact === 'old@example.com');
  clock = Date.now() - 600e3; edit(sarah, { contact: 'remote@example.com' });
  await page.$eval('#n-contact', e => { e.value = 'local@example.com'; e.dispatchEvent(new Event('change')); });
  await page.evaluate(() => window.__sync.run()); await waitIdle();
  ok('newer local edit wins the conflict', get(sarah).contact === 'local@example.com' && (await st()).people['hungerford-arcade'].contact === 'local@example.com');

  // offline queue
  await page.setOfflineMode(true);
  await page.$eval('#n-notes', e => { e.value = 'Written in a basement'; e.dispatchEvent(new Event('change')); });
  await page.evaluate(() => window.__sync.run()); await w(300);
  ok('offline -> waiting', await syncState() === 'waiting' && await page.evaluate(() => window.__sync.pending()) >= 1);
  await page.setOfflineMode(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await w(1500); await waitIdle();
  ok('queued change sent when back online', get(sarah).notes.endsWith('\nWritten in a basement') && await syncState() === 'ok');

  // deleted in Notion: keep local data, don't resurrect
  pages.get(jo).in_trash = true;
  await page.evaluate(() => window.__sync.run()); await waitIdle(); s = await st();
  ok('trashed row unlinked, local kept, not recreated', !s.people[wi.id].nid && s.people[wi.id].met === 'Jo' && [...pages.values()].filter(p => !p.in_trash && get(p.id).name === 'Jo').length === 0);

  // wrong passphrase
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('heirloom-atlas/sync')); c.key = 'nope'; localStorage.setItem('heirloom-atlas/sync', JSON.stringify(c)); });
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction('window.__ready'); await waitIdle();
  ok('wrong passphrase -> error', await syncState() === 'error' && /passphrase/i.test(await page.$eval('#btn-sync', e => e.title)));

  // the passphrase is not in the backup
  const backup = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('heirloom-atlas/v1'))));
  ok('passphrase not in app state/backup', !backup.includes(KEY) && !backup.includes('nope'));
  await page.screenshot({ path: 'shots/sync-panel.png' });
  await page.click('#btn-sync'); await w(300); await page.screenshot({ path: 'shots/sync-dialog.png' });
  const mob = await b.newPage(); await mob.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await mob.goto(`http://localhost:${APP}/#people/hungerford-arcade`, { waitUntil: 'networkidle0' }); await mob.waitForFunction('window.__ready'); await w(1500); await mob.screenshot({ path: 'shots/sync-mobile.png' });
} catch (e) { errs.push('crash ' + (e.stack || e)); }
console.log(JSON.stringify({ results, notionCalls, errs }, null, 1));
await b.close(); worker.close(); site.close();
process.exit(errs.length ? 1 : 0);
