// Exercises edit mode in a headless browser: edit, add, delete, undo across businesses, introductions and lists.
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:8099/';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.setViewport({ width: 1280, height: 860 });
const w = ms => new Promise(r => setTimeout(r, ms));
const out = {};
await p.goto(URL, { waitUntil: 'networkidle0' }); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle0' }); await p.waitForFunction('window.__ready');
out.next = await p.$eval('#dash .next-q', e => e.textContent);
await p.click('#btn-edit'); await w(200);
out.bar = await p.$eval('#editbar', e => !e.hidden);
// edit a business
await p.evaluate(() => location.hash = ''); await p.evaluate(() => document.querySelector('[data-layout=list]').click()); await w(200);
await p.click('[data-open="hungerford-arcade"]'); await w(400);
await p.$eval('#biz-form [name=need]', e => e.value = 'Edited need (test)'); await p.click('#biz-form button[type=submit]'); await w(400);
out.bizEdited = await p.evaluate(() => JSON.parse(localStorage.getItem('heirloom-atlas/v1')).ed.biz['hungerford-arcade'].f.need);
await p.click('#sheet-close'); await w(200);
// edit an intro
await p.click('[data-tab=intros]'); await w(300);
const iid = await p.$eval('[data-edit-intro]', e => e.dataset.editIntro);
await p.click(`[data-edit-intro="${iid}"]`); await w(200);
await p.select('.inline-form [name=state]', 'made'); await p.click('.inline-form button[type=submit]'); await w(400);
out.thread = await p.$$eval('.thread li', a => a.length);
await p.select('.thread select[data-outcome]', 'No reply yet'); await w(300);
out.outcome = await p.evaluate(id => JSON.parse(localStorage.getItem('heirloom-atlas/v1')).ed.intro[id].f.outcome, iid);
// add + delete list items in Visits
await p.click('[data-tab=visits]'); await w(300);
await p.click('[data-add-list=event]'); await w(200);
await p.type('.inline-form [name=name]', 'Test event'); await p.$eval('.inline-form [name=date]', e => e.value = '2026-12-01'); await p.click('.inline-form button[type=submit]'); await w(400);
out.eventAdded = await p.$$eval('.ev .w', a => a.some(x => x.textContent.includes('Test event')));
const pens = await p.$$('.town-hero .pen'); await pens[0].click(); await w(200);
await p.$eval('.inline-form [name=name]', e => e.value = 'Hungerford (edited)'); await p.click('.inline-form button[type=submit]'); await w(400);
out.townRenamed = await p.$eval('.town-hero h2', e => e.textContent);
// undo twice
await p.click('[data-eb=undo]'); await w(300); out.afterUndo = await p.$eval('.town-hero h2', e => e.textContent);
// lists panel
await p.click('[data-eb=lists]'); await w(300); out.listsKinds = await p.$$eval('#sheet-body .list-kind', a => a.length);
await p.click('#sheet-close'); await w(200);
// delete a business with confirm, then undo
p.on('dialog', d => d.accept());
await p.click('[data-tab=people]'); await w(200); await p.click('[data-open="shipton-mill"]'); await w(300); await p.click('#n-del'); await w(300); await p.click('#confirm-dlg [data-cf=yes]'); await w(400);
out.deleted = await p.evaluate(() => !document.querySelector('[data-open="shipton-mill"]'));
await p.click('[data-eb=undo]'); await w(300); out.restored = await p.evaluate(() => !!document.querySelector('[data-open="shipton-mill"]'));
await p.click('[data-eb=done]'); await w(200); out.barGone = await p.$eval('#editbar', e => e.hidden);
out.errs = errs;
console.log(JSON.stringify(out, null, 1));
await p.evaluate(() => localStorage.clear());
await b.close();
