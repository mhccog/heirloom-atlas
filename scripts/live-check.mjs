// Live round trip on the real site, real Worker and real Notion, using a clearly-labelled test row that is removed at the end.
// Reads the passphrase and Notion token from files; prints neither.  node scripts/live-check.mjs
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const SITE = 'https://mhccog.github.io/heirloom-atlas/';
const KEY = readFileSync('/home/box/.secrets/heirloom_app_key', 'utf8').trim();
const TOKEN = readFileSync('/home/box/.secrets/notion_heirloom_token', 'utf8').trim();
const PEOPLE = '073f4d29-a404-4ed0-ad5d-70bc7674b385';
const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8'); const DS = k => (toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
const TEST = 'Heirloom sync test (delete me)';
const n = async (method, path, body) => { const r = await fetch('https://api.notion.com/v1' + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
const plain = p => (p.title || p.rich_text || []).map(x => x.plain_text).join('');
const findIn = async (ds, prop, val) => { const r = await n('POST', `/data_sources/${ds}/query`, { page_size: 100, filter: { property: prop, rich_text: { contains: val } } }); return r.status === 200 ? r.j.results.filter(p => !p.in_trash) : null; };
const results = {}, errs = []; const ok = (k, v) => { results[k] = v; if (v !== true) errs.push(k); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
const sync = async () => { await p.evaluate(() => window.__sync.run()); await w(300); for (let i = 0; i < 1800 && (await p.evaluate(() => window.__sync._state())) === 'syncing'; i++) await w(100); };
const shared = (await n('GET', `/data_sources/${DS('BIZ_DS')}`)).status === 200;
try {
  await p.setViewport({ width: 1280, height: 860 });
  await p.goto(SITE, { waitUntil: 'load' }); await p.waitForFunction('window.__ready');
  await p.evaluate(k => { localStorage.clear(); localStorage.setItem('heirloom-atlas/sync', JSON.stringify({ key: k })); }, KEY);
  await p.reload({ waitUntil: 'load' }); await p.waitForFunction('window.__ready'); await w(800); await sync();
  ok('live sync runs', await p.evaluate(() => window.__sync._state()) === 'ok');
  results.collections = await p.evaluate(() => window.__sync._colls());
  if (shared) ok('all collections sync', Object.values(results.collections).every(v => v === 'ok'));
  results.status = await p.$eval('#btn-sync', e => e.title.replace(/\d{1,2} \w{3}, \d\d:\d\d/, ''));
  // 1. people: app -> Notion
  await p.click('#btn-add'); await w(300);
  await p.type('dialog [name=name]', TEST); await p.select('dialog [name=town]', 'lewes'); await p.type('dialog [name=met]', 'Sync test'); await p.type('dialog [name=notes]', 'Made by the app (test)');
  await p.click('dialog button[value=ok]'); await w(600); await sync();
  let rows = await findIn(PEOPLE, 'Met at', TEST);
  ok('people: app -> Notion', rows.length === 1 && plain(rows[0].properties.Name) === 'Sync test' && /Made by the app \(test\)/.test(plain(rows[0].properties.Notes)));
  // 2. people: Notion -> app
  const pid = rows[0].id; await w(61e3); // Notion edit times are per minute
  await n('PATCH', `/pages/${pid}`, { properties: { Notes: { rich_text: [{ text: { content: 'Status: Got contact\nEdited in Notion (test)' } }] } } });
  await sync();
  const wid = await p.evaluate(t => Object.keys(window.__test.BY()).find(k => window.__test.BY()[k].name === t), TEST);
  const pp = await p.evaluate(id => JSON.parse(localStorage.getItem('heirloom-atlas/v1')).people[id], wid);
  ok('people: Notion -> app', pp.notes === 'Edited in Notion (test)' && pp.stage === 2);
  // 3. collections (only once the three databases are shared with the integration)
  if (shared) {
    let br = await findIn(DS('BIZ_DS'), 'App ID', wid);
    ok('business: app -> Notion', !!br && br.length === 1 && plain(br[0].properties.Name) === TEST);
    await p.evaluate(id => { window.__test.editRec('biz', id, { need: 'Edited in the app (test)' }); window.__test.commit(); }, wid); await sync();
    br = await findIn(DS('BIZ_DS'), 'App ID', wid); ok('business edit: app -> Notion', plain(br[0].properties['Their need']) === 'Edited in the app (test)');
    await w(61e3); await n('PATCH', `/pages/${br[0].id}`, { properties: { 'What they do': { rich_text: [{ text: { content: 'Edited in Notion (test)' } }] } } }); await sync();
    ok('business: Notion -> app', await p.evaluate(id => window.__test.BY()[id].type, wid) === 'Edited in Notion (test)');
    // intro between the test business and a real one
    await p.evaluate(id => { window.__test.addRec('intro', { id: 'my-synctest-' + Date.now().toString(36), a: id, b: 'gorringe-s', why: 'Sync test (delete me)', state: 'open', at: '', kind: 'Yours', strength: 2, km: 0, mine: true, outcome: '', outcomeNote: '' }); window.__test.commit(); }, wid); await sync();
    let ir = await findIn(DS('INTRO_DS'), 'Why', 'Sync test (delete me)'); ok('intro: app -> Notion (with relations)', ir.length === 1 && ir[0].properties.From.relation.length === 1 && ir[0].properties.To.relation.length === 1);
    const iid = plain(ir[0].properties['App ID']);
    await w(61e3); await n('PATCH', `/pages/${ir[0].id}`, { properties: { Status: { select: { name: 'Made' } }, Outcome: { select: { name: 'Replied' } } } }); await sync();
    ok('intro: Notion -> app', await p.evaluate(id => { const i = window.__test.D().intros.find(x => x.id === id); return i && i.state === 'made' && i.outcome === 'Replied'; }, iid));
    // list item
    await p.evaluate(() => { window.__test.addRec('list', { id: 'event:synctest-' + Date.now().toString(36), kind: 'event', order: 999, name: 'Sync test event (delete me)', date: '2026-12-31', end: '', label: 'Thu 31 Dec', town: 'lewes', at: '', why: 'test' }); window.__test.commit(); }); await sync();
    let lr = await findIn(DS('NOTE_DS'), 'Name', 'Sync test event'); ok('list: app -> Notion', lr.length === 1 && /Date: 2026-12-31/.test(plain(lr[0].properties.Details)));
    await w(61e3); await n('PATCH', `/pages/${lr[0].id}`, { properties: { Details: { rich_text: [{ text: { content: plain(lr[0].properties.Details).replace('Why go: test', 'Why go: edited in Notion') } }] } } }); await sync();
    ok('list: Notion -> app', await p.evaluate(() => window.__test.D().events.some(e => e.what.startsWith('Sync test event') && e.why === 'edited in Notion')));
    // clean up: delete in the app (ticks Archived), then trash the test rows
    const eid = plain(lr[0].properties['App ID']);
    await p.evaluate((a, b, c) => { window.__test.delRec('list', c); window.__test.delRec('intro', b); window.__test.delRec('biz', a); window.__test.commit(); }, wid, iid, eid); await sync();
    for (const [ds, prop, v] of [[DS('BIZ_DS'), 'App ID', wid], [DS('INTRO_DS'), 'App ID', iid], [DS('NOTE_DS'), 'App ID', eid]]) {
      const r = await findIn(ds, prop, v); ok('delete in app ticks Archived: ' + prop + ' ' + ds.slice(0, 4), r.length === 1 && r[0].properties.Archived.checkbox === true);
      for (const x of r) await n('PATCH', `/pages/${x.id}`, { in_trash: true });
    }
  }
  // people clean-up through the app's own delete (moves the row to Notion's Trash)
  await p.evaluate(id => { location.hash = '#people/' + id; }, wid); await p.reload({ waitUntil: 'load' }); await p.waitForFunction('window.__ready'); await w(1200);
  await p.evaluate(() => document.querySelector('#btn-edit').click()); await w(300);
  if (!(await p.$('#n-clear'))) await p.evaluate(id => window.__test && document.querySelector(`[data-open="${id}"]`)?.click(), wid);
  await p.click('#n-clear'); await w(500); await sync();
  ok('people: delete in app -> Notion Trash', (await n('GET', `/pages/${pid}`)).j.in_trash === true);
  rows = await findIn(PEOPLE, 'Met at', TEST); ok('no test rows left in People I\'ve Met', rows.length === 0);
} catch (e) { errs.push('crash ' + (e.stack || e)); }
console.log(JSON.stringify({ shared, results, errs }, null, 1));
await p.evaluate(() => localStorage.clear()).catch(() => {});
await b.close(); process.exit(errs.length ? 1 : 0);
