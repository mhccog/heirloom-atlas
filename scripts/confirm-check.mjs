// Every delete asks first: for each delete path, the confirm dialog opens and names the item, Cancel has focus,
// and Esc, Cancel and Enter-on-Cancel all keep the item. Delete then removes it, and Undo brings it back.
//   python3 -m http.server 8099 -d docs & node scripts/confirm-check.mjs [url]
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:8099/';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => { errs.push('native browser dialog: ' + d.message()); d.dismiss(); });
await p.setViewport({ width: 1280, height: 860 });
const w = ms => new Promise(r => setTimeout(r, ms));
const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('heirloom-atlas/v1')) || {});
const res = {};
const clk = sel => p.$eval(sel, e => e.click());
const dlg = () => p.evaluate(() => { const d = document.querySelector('#confirm-dlg'); return d && d.open ? { title: d.querySelector('h3').textContent, focus: document.activeElement && document.activeElement.dataset.cf } : null; });
// open: () => Promise (shows the dialog). present: () => Promise<bool>. name: text the title must contain
async function path(label, open, present, name, { del = true, after } = {}) {
  const r = {};
  await open(); await w(250); const d = await dlg();
  r.opens = !!d; r.names = !!d && d.title.includes(name); r.cancelFocused = !!d && d.focus === 'no';
  await p.keyboard.press('Escape'); await w(200); r.escKeeps = !(await dlg()) && await present();
  await open(); await w(250); await clk('#confirm-dlg [data-cf=no]'); await w(200); r.cancelKeeps = !(await dlg()) && await present();
  await open(); await w(250); await p.keyboard.press('Enter'); await w(200); r.enterOnCancelKeeps = !(await dlg()) && await present();
  if (del) { await open(); await w(250); await clk('#confirm-dlg [data-cf=yes]'); await w(400); r.deleteRemoves = !(await present());
    if (after) await after(); }
  res[label] = r; if (!d) errs.push(label + ': no dialog');
  for (const [k, v] of Object.entries(r)) if (v !== true) errs.push(`${label}: ${k}`);
}
await p.goto(URL, { waitUntil: 'networkidle0' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle0' }); await p.waitForFunction('window.__ready');
await p.evaluate(() => document.querySelector('[data-layout=list]').click()); await w(200);
await clk('#btn-edit'); await w(200);
const undo = async () => { await clk('[data-eb=undo]'); await w(300); };

// business
const openCard = async id => { if (!(await p.$('#sheet.open #n-del'))) { await p.evaluate(() => document.querySelector('[data-tab=people]').click()); await w(150); await clk(`[data-open="${id}"]`); await w(350); } };
await path('business', async () => { await openCard('shipton-mill'); await clk('#n-del'); }, () => p.evaluate(() => !!document.querySelector('[data-open="shipton-mill"]')), 'Shipton', { after: undo });
res.business.undoRestores = await p.evaluate(() => !!document.querySelector('[data-open="shipton-mill"]'));
// reset a business to the research version
await p.evaluate(() => { window.__test.editRec('biz', 'dreweatts', { need: 'Edited (test)' }); window.__test.commit(); });
await p.evaluate(() => document.querySelector('#sheet-close') && document.querySelector('#sheet-close').click()); await w(200);
await clk('[data-open="dreweatts"]'); await w(350);
await path('business reset', async () => { if (!(await p.$('#n-reset'))) { await clk('[data-open="dreweatts"]'); await w(350); } await clk('#n-reset'); }, async () => !!((await st()).ed.biz.dreweatts || {}).f?.need, 'Dreweatts');
// person notes (a walk-in with notes)
await p.evaluate(() => document.querySelector('#sheet-close') && document.querySelector('#sheet-close').click()); await w(200);
await clk('#btn-add'); await w(300);
await p.type('dialog [name=name]', 'Confirm test shop'); await p.type('dialog [name=notes]', 'Some notes'); await clk('dialog button[value=ok]'); await w(600);
const wid = await p.evaluate(() => Object.keys(window.__test.BY()).find(k => window.__test.BY()[k].name === 'Confirm test shop'));
await path('person notes', async () => { await clk('#n-clear'); }, async () => ((await st()).people[wid] || {}).notes === 'Some notes', 'Confirm test shop', { del: true });
await path('walk-in business', async () => { if (!(await p.$('#sheet.open #n-del'))) { await clk(`[data-open="${wid}"]`); await w(350); } await clk('#n-del'); }, () => p.evaluate(id => !!window.__test.BY()[id], wid), 'Confirm test shop');
// introduction
await p.evaluate(() => document.querySelector('#sheet-close') && document.querySelector('#sheet-close').click()); await w(200);
await clk('[data-tab=intros]'); await w(300);
const iid = await p.$eval('[data-edit-intro]', e => e.dataset.editIntro);
const iname = await p.evaluate(id => { const i = window.__test.D().intros.find(x => x.id === id); return window.__test.BY()[i.a].name; }, iid);
await path('introduction', async () => { if (!(await p.$('.inline-form [data-fa=del]'))) { await clk(`[data-edit-intro="${iid}"]`); await w(200); } await clk('.inline-form [data-fa=del]'); }, () => p.evaluate(id => window.__test.D().intros.some(x => x.id === id), iid), iname, { after: undo });
// clearing an outcome
await p.evaluate(id => { window.__test.editRec('intro', id, { state: 'made', at: '2026-11-01', outcome: 'Replied' }); window.__test.commit(); }, iid);
await clk('[data-tab=people]'); await w(150); await clk('[data-tab=intros]'); await w(300);
await path('outcome', async () => { await p.select('.thread select[data-outcome]', ''); }, async () => (await st()).ed.intro[iid].f.outcome === 'Replied' && await p.$eval('.thread select[data-outcome]', e => e.value) === 'Replied', 'Replied');
// every list kind (towns, events, trades, approach types, signals, script, car list, after visit, story, sources, app text)
await clk('[data-tab=people]'); await w(200);
const kinds = await (async () => { await clk('[data-eb=lists]'); await w(300); return p.$$eval('#sheet-body details.list-kind', ds => ds.map((d, i) => ({ i, label: d.querySelector('summary').firstChild.textContent.trim(), n: d.querySelectorAll('li[data-item]').length }))); })();
for (const k of kinds) {
  if (!k.n) { res['list: ' + k.label] = 'empty, skipped'; continue; }
  await clk('[data-eb=lists]'); await w(300);
  const item = await p.evaluate(i => { const d = document.querySelectorAll('#sheet-body details.list-kind')[i]; d.open = true; const li = d.querySelector('li[data-item]'); return { id: li.dataset.item, name: li.querySelector('span').textContent.replace(/ (edited|added)$/, '') }; }, k.i);
  const openIt = async () => { if (!(await p.$('#sheet-body .inline-form [data-fa=del]'))) { await clk('[data-eb=lists]'); await w(300); await p.evaluate(i => { const d = document.querySelectorAll('#sheet-body details.list-kind')[i]; d.open = true; }, k.i); await clk(`#sheet-body li[data-item="${item.id}"] .pen`); await w(250); } await clk('#sheet-body .inline-form [data-fa=del]'); };
  const present = async () => !((await st()).ed.list[item.id] || {}).del;
  await path('list: ' + k.label, openIt, present, item.name.slice(0, 30), { del: k.i === 0, after: undo });
}
// erase device
await p.evaluate(() => document.querySelector('#sheet-close') && document.querySelector('#sheet-close').click()); await w(200);
await p.evaluate(() => document.querySelector('[data-eb=done]').click()); await w(200);
const openData = async () => { if (!(await p.$('#d-reset'))) { await clk('#btn-data'); await w(300); } await clk('#d-reset'); };
await path('erase this device', openData, async () => Object.keys((await st()).ed?.intro || {}).length > 0, 'Erase', { del: false });
console.log(JSON.stringify({ res, errs }, null, 1));
await p.evaluate(() => localStorage.clear()); await b.close(); process.exit(errs.length ? 1 : 0);
