import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../docs/assets/content.js');
const D = require('../docs/assets/data.json');

test('seeds rebuild the same view as data.json', () => {
  const V = C.view(D, { ed: {} });
  assert.equal(V.biz.length, D.biz.length); assert.equal(V.intros.length, D.intros.length); assert.equal(V.towns.length, D.towns.length);
  assert.deepEqual(V.towns.map(t => t.id), D.towns.map(t => t.id)); assert.deepEqual(V.cats.map(c => [c.id, c.name, c.ink]), D.cats.map(c => [c.id, c.name, c.ink]));
  assert.deepEqual(Object.keys(V.personas).sort(), Object.keys(D.personas).sort());
  assert.equal(V.events.length, D.events.length); assert.equal(V.flow.length, D.flow.length); assert.equal(V.before[0].text, D.before[0]);
  assert.equal(V.watch.length, D.watch.length); assert.equal(V.tagline, D.tagline);
  const hb = V.biz.find(b => b.id === 'hungerford-arcade'); const ob = D.biz.find(b => b.id === 'hungerford-arcade');
  assert.equal(hb.ask.who, ob.ask.who); assert.equal(hb.watch.angle, ob.watch.angle); assert.equal(hb.la, ob.la);
});

test('edits, new records and deletes overlay the seeds', () => {
  const S = { ed: { biz: { 'hungerford-arcade': { f: { need: 'Changed' } }, 'shipton-mill': { del: true }, 'walkin-x': { isNew: true, f: { name: 'New shop', town: 'lewes', cat: 0, custom: true } } }, list: { 'town:lewes': { f: { name: 'Lewes (East Sussex)' } } } } };
  const V = C.view(D, S);
  assert.equal(V.biz.find(b => b.id === 'hungerford-arcade').need, 'Changed');
  assert.ok(!V.biz.find(b => b.id === 'shipton-mill')); assert.ok(V.biz.find(b => b.id === 'walkin-x'));
  assert.equal(V.towns.find(t => t.id === 'lewes').name, 'Lewes (East Sussex)');
  assert.equal(V.watch.length, D.watch.length - 1);
});

test('rows round-trip for every collection, and hashes match', () => {
  const V = C.view(D, { ed: {} }); const nids = {}; let n = 0;
  for (const b of V.biz) nids[b.id] = String(++n).padStart(32, '0');
  const ctx = { towns: V.towns, cats: V.cats, personas: V.personas, biz: V.biz, nidOf: (c, id) => nids[id], idOfNid: (c, nid) => Object.keys(nids).find(k => nids[k] === String(nid).replace(/-/g, '')) };
  const sd = C.seeds(D);
  for (const coll of C.COLLS) for (const rec of Object.values(sd[coll])) {
    const row = C.toRow(coll, rec, ctx);
    const back = Object.assign({}, rec, C.fromRow(coll, row, ctx, rec));
    const row2 = C.toRow(coll, back, ctx);
    assert.equal(C.rowHash(coll, row2), C.rowHash(coll, row), coll + ' ' + rec.id);
  }
  const ev = Object.values(sd.list).find(x => x.kind === 'event'); const d = C.encodeDetails(ev);
  assert.match(d, /^Date: 2026-/); assert.equal(C.decodeDetails('event', d).date, ev.date);
});

test('weekly key starts on Monday', () => {
  assert.equal(C.weekKey('2026-11-03'), '2026-11-02'); assert.equal(C.weekKey('2026-11-08'), '2026-11-02'); assert.equal(C.weekKey('2026-11-09'), '2026-11-09');
});
