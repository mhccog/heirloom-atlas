import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../docs/assets/notion-map.js');
const D = require('../docs/assets/data.json');
const towns = D.towns;
const biz = D.biz.find(b => b.id === 'hungerford-arcade');

test('header: status and next visit', () => {
  assert.equal(M.formatHeader({ stage: 2, next: '2026-12-01' }), 'Status: Got contact · Next visit: 2026-12-01');
  assert.equal(M.formatHeader({ stage: 3, last: '2026-11-03', next: '2026-12-01' }), 'Status: Returning · Last visit: 2026-11-03 · Next visit: 2026-12-01');
  assert.equal(M.formatHeader({ stage: 0 }), 'Status: Not visited');
  assert.equal(M.formatHeader({ stage: 1, next: 'soon' }), 'Status: Said hi', 'bad dates are left out');
});

test('notes round-trip', () => {
  const p = { stage: 2, last: '2026-11-03', next: '2026-12-01', notes: 'Loves clocks.\nAsk about the 1920s cabinet.' };
  const text = M.buildNotes(p);
  assert.equal(text, 'Status: Got contact · Last visit: 2026-11-03 · Next visit: 2026-12-01\nLoves clocks.\nAsk about the 1920s cabinet.');
  const back = M.parseNotes(text);
  assert.deepEqual(back, { hadHeader: true, stage: 2, last: '2026-11-03', next: '2026-12-01', notes: p.notes });
  assert.equal(M.buildNotes({ stage: 1, notes: '' }), 'Status: Said hi');
  assert.equal(M.buildNotes({ stage: 1, notes: '\n\nhello  \n' }), 'Status: Said hi\nhello');
});

test('parse is forgiving with hand edits in Notion', () => {
  assert.equal(M.parseNotes('status: connected').stage, 4);
  assert.equal(M.parseNotes('Status:Returning · Next visit:2027-01-05').next, '2027-01-05');
  assert.equal(M.parseNotes('Status: Got contact | Next visit: 2026-12-01').next, '2026-12-01');
  assert.equal(M.parseNotes('Status: Got contact; Next visit: 2026-12-01').stage, 2);
  const unk = M.parseNotes('Status: Best friends · Next visit: next Tuesday');
  assert.equal(unk.stage, null, 'unknown status keeps the app value'); assert.equal(unk.next, null, 'unparseable date keeps the app value');
  assert.equal(M.parseNotes('Status: Said hi · Next visit: none').next, '', 'explicit none clears the date');
  const plain = M.parseNotes('Met Sarah, she restores clocks');
  assert.equal(plain.hadHeader, false); assert.equal(plain.notes, 'Met Sarah, she restores clocks'); assert.equal(plain.stage, null);
  assert.equal(M.parseNotes('').hadHeader, false); assert.equal(M.parseNotes(null).notes, '');
  assert.equal(M.parseNotes('Status: Said hi\r\nline two\r\n').notes, 'line two');
  assert.equal(M.parseNotes('Status: Said hi\nStatus: Connected').notes, 'Status: Connected', 'only the first line is the header');
});

test('toRow: name, met at, contact, notes', () => {
  assert.deepEqual(M.toRow(biz, { stage: 2, met: 'Sarah', contact: '07700 900123', notes: 'Clocks', next: '2026-12-01' }, 'Hungerford'),
    { name: 'Sarah', metAt: 'Hungerford Arcade, Hungerford', contact: '07700 900123', notes: 'Status: Got contact · Next visit: 2026-12-01\nClocks' });
  const r = M.toRow(biz, { stage: 1, met: '  ', notes: '' }, 'Hungerford');
  assert.equal(r.name, 'Hungerford Arcade', 'no recorded name falls back to the business'); assert.equal(r.contact, '');
});

test('fromRow parses back and treats the business name as "no name recorded"', () => {
  const row = { name: 'Hungerford Arcade', metAt: 'Hungerford Arcade, Hungerford', contact: 'x@y.z', notes: 'Status: Returning · Next visit: 2026-12-10\nSecond visit went well' };
  assert.deepEqual(M.fromRow(row, biz, { stage: 1 }), { met: '', contact: 'x@y.z', notes: 'Second visit went well', stage: 3, next: '2026-12-10' });
  const p = M.fromRow({ name: 'Tom', metAt: '', contact: '', notes: 'just notes' }, biz, undefined);
  assert.equal(p.met, 'Tom'); assert.equal(p.stage, 1, 'a person with a Notion row has at least said hi'); assert.equal(p.notes, 'just notes');
  assert.equal('stage' in M.fromRow({ name: 'Tom', notes: 'x' }, biz, { stage: 3 }), false, 'header-less notes keep the local stage');
});

test('round trip app -> Notion -> app keeps every synced field', () => {
  const p = { stage: 4, met: 'Rupert', contact: 'rupert@example.com', last: '2026-11-03', next: '2026-12-15', notes: 'Intro to the clockmaker made.\nFollow up in Dec.' };
  const back = M.fromRow(M.toRow(biz, p, 'Hungerford'), biz, p);
  for (const k of ['stage', 'met', 'contact', 'last', 'next', 'notes']) assert.equal(back[k], p[k], k);
});

test('rowHash changes with content only', () => {
  const a = { name: 'A', metAt: 'B', contact: '', notes: 'n' };
  assert.equal(M.rowHash(a), M.rowHash({ ...a, id: 'x', lastEdited: 'y' }));
  assert.equal(M.rowHash(a), M.rowHash({ ...a, notes: 'n\r\n' }));
  assert.notEqual(M.rowHash(a), M.rowHash({ ...a, contact: '1' }));
  assert.notEqual(M.rowHash({ name: 'ab', metAt: '' }), M.rowHash({ name: 'a', metAt: 'b' }), 'field boundaries matter');
});

test('blank rows and hasData', () => {
  assert.ok(M.isBlankRow({ name: '', metAt: null, contact: ' ', notes: '' }));
  assert.ok(!M.isBlankRow({ name: 'x' }));
  assert.ok(!M.hasData({ stage: 0, notes: '', met: '' })); assert.ok(M.hasData({ stage: 1 })); assert.ok(M.hasData({ stage: 0, contact: 'a' })); assert.ok(!M.hasData(undefined));
});

test('decide: newest edit wins', () => {
  assert.equal(M.decide({ localDirty: false, remoteChanged: false }), 'none');
  assert.equal(M.decide({ localDirty: true, remoteChanged: false }), 'push');
  assert.equal(M.decide({ localDirty: false, remoteChanged: true }), 'pull');
  const t = Date.parse('2026-11-03T12:00:00.000Z');
  assert.equal(M.decide({ localDirty: true, remoteChanged: true, localUpdated: t + 60e3, remoteEdited: '2026-11-03T12:00:00.000Z' }), 'push');
  assert.equal(M.decide({ localDirty: true, remoteChanged: true, localUpdated: t - 60e3, remoteEdited: '2026-11-03T12:00:00.000Z' }), 'pull');
  assert.equal(M.decide({ localDirty: true, remoteChanged: true, localUpdated: undefined, remoteEdited: '2026-11-03T12:00:00.000Z' }), 'pull');
});

test('matchBiz finds the business from "Met at"', () => {
  const B = D.biz;
  assert.equal(M.matchBiz({ metAt: 'Hungerford Arcade, Hungerford' }, B, towns).id, 'hungerford-arcade');
  assert.equal(M.matchBiz({ metAt: 'hungerford arcade' }, B, towns).id, 'hungerford-arcade');
  assert.equal(M.matchBiz({ metAt: 'Below Stairs of Hungerford, Hungerford' }, B, towns).id, 'below-stairs-of-hungerford', 'longest name wins');
  assert.equal(M.matchBiz({ metAt: 'A pub in Lewes' }, B, towns), null);
  assert.equal(M.matchBiz({ metAt: '' }, B, towns), null);
  for (const b of B) { const t = towns.find(x => x.id === b.town).name; assert.equal(M.matchBiz({ metAt: M.metAt(b, t) }, B, towns).id, b.id, b.name); }
});

test('walkinFromRow: name and town from "Met at"', () => {
  assert.deepEqual(M.walkinFromRow({ metAt: 'The Clock Shop, Lewes' }, towns), { name: 'The Clock Shop', town: 'lewes', townGuessed: false });
  assert.deepEqual(M.walkinFromRow({ metAt: 'Brown & Co, Henley' }, towns), { name: 'Brown & Co', town: 'henley', townGuessed: false });
  assert.deepEqual(M.walkinFromRow({ metAt: 'Gallery in Cobham' }, towns), { name: 'Gallery in Cobham', town: 'cobham', townGuessed: false });
  const g = M.walkinFromRow({ name: 'Jo', metAt: 'Bath Antiques Fair' }, towns, 'petworth');
  assert.equal(g.town, 'petworth'); assert.ok(g.townGuessed); assert.equal(g.name, 'Bath Antiques Fair');
  assert.equal(M.walkinFromRow({ name: 'Jo', metAt: '' }, towns).name, 'Jo');
  assert.equal(M.walkinFromRow({ metAt: 'Bicester Heritage' }, towns).town, 'bicester');
});

test('chunkText respects the 2,000-character limit', () => {
  assert.deepEqual(M.chunkText(''), []);
  const c = M.chunkText('x'.repeat(4500)); assert.deepEqual(c.map(s => s.length), [2000, 2000, 500]);
});
