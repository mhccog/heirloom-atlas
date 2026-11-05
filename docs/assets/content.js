/* The Heirloom Atlas content layer: research seeds + your edits, and their Notion rows.
   Pure functions, no DOM, no network. Shared by the app (window.Content) and the tests (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Content = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COLLS = ['biz', 'list', 'intro'];
  const ENDPOINT = { biz: 'businesses', intro: 'introductions', list: 'lists' };
  const STATE = { open: 'To consider', made: 'Made', declined: 'Declined' };
  const STRENGTH = { 3: 'Strong', 2: 'Good', 1: 'Possible' };
  const OUTCOMES = ['No reply yet', 'Replied', 'They met', 'Did business'];

  // What each kind of list item holds. `name` is the Notion title; the rest go in Details as "Label: value" lines.
  const KINDS = {
    town: { label: 'Town', name: 'Name', fields: [['day', 'Market day'], ['bestDay', 'Best day'], ['travel', 'Getting there'], ['go', 'Short travel'], ['dates', 'Dates'], ['why', 'Why go'], ['la', 'Latitude'], ['lo', 'Longitude'], ['key', 'Key']] },
    event: { label: 'Event', name: 'What', fields: [['date', 'Date'], ['end', 'Ends'], ['label', 'Shown as'], ['town', 'Town'], ['at', 'Business'], ['why', 'Why go']] },
    cat: { label: 'Trade', name: 'Trade', fields: [['ink', 'Colour'], ['key', 'Key']] },
    persona: { label: 'Approach', name: 'Label', fields: [['read', 'How they tend to be'], ['listen', 'Listen for'], ['key', 'Key']] },
    signal: { label: 'Signal', name: 'Company', fields: [['town', 'Town'], ['where', 'Where'], ['shows', 'Register shows'], ['todo', 'What to do']] },
    flow: { label: 'Script step', name: 'Step', fields: [['do', 'Do'], ['say', 'Say'], ['from', 'From']] },
    before: { label: 'Car checklist', name: 'Item', fields: [] },
    after: { label: 'After visit', name: 'Item', fields: [] },
    story: { label: 'Story', name: 'Part', fields: [['text', 'Text']] },
    source: { label: 'Source', name: 'Name', fields: [['url', 'Link']] },
    text: { label: 'App text', name: 'Text', fields: [['key', 'Key']] },
  };
  const KIND_BY_LABEL = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.label.toLowerCase(), k]));
  const NUMERIC = new Set(['la', 'lo', 'potential', 'km', 'strength', 'cat', 'order']);

  const slug = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

  /* ---------- seeds: data.json -> flat records ---------- */
  function seeds(D) {
    const biz = {}, intro = {}, list = {};
    for (const b of D.biz) {
      const w = b.watch || {};
      biz[b.id] = { id: b.id, name: b.name, town: b.town, cat: b.cat, type: b.type || '', addr: b.addr || '', web: b.web || '', phone: b.phone || '', why: b.why || '',
        la: b.la, lo: b.lo, approx: !!b.approx, founder: !!b.founder, theme: b.theme || '', askWho: (b.ask || {}).who || '', askNote: (b.ask || {}).note || '', persona: b.persona || '',
        opener: b.opener || '', openerNote: b.openerNote || '', need: b.need || '', offers: b.offers || '', potential: b.potential ?? 1,
        watchCompany: w.company || '', watchFounded: w.founded || '', watchDirectors: w.directors || '', watchAngle: w.angle || '', custom: false };
    }
    for (const i of D.intros) intro[i.id] = { id: i.id, a: i.a, b: i.b, why: i.why || '', kind: i.kind || '', strength: i.strength || 1, km: i.km ?? null, state: 'open', at: '', outcome: '', outcomeNote: '', mine: false };
    let o = 0; const add = (kind, key, name, f) => { const id = kind + ':' + key; list[id] = Object.assign({ id, kind, order: ++o, name: String(name ?? '') }, f); };
    D.towns.forEach(t => add('town', t.id, t.name, { key: t.id, la: t.la, lo: t.lo, day: t.day || '', go: t.go || '', why: t.why || '', travel: t.travel || '', bestDay: t.bestDay || '', dates: t.dates || '' }));
    D.cats.forEach(c => add('cat', c.id, c.name, { key: String(c.id), ink: c.ink }));
    Object.entries(D.personas || {}).forEach(([k, p]) => add('persona', k, p.label, { key: k, read: p.read || '', listen: p.listen || '' }));
    D.events.forEach(e => add('event', e.date + '-' + slug(e.what), e.what, { date: e.date, end: e.end || '', label: e.label || '', town: e.town || '', at: e.at || '', why: e.why || '' }));
    D.signals.forEach(s => add('signal', slug(s.company), s.company, { town: s.town, where: s.where || '', shows: s.shows || '', todo: s.todo || '' }));
    D.flow.forEach((f, i) => add('flow', i, f.stage, { do: f.do || '', say: f.say || '', from: f.from || '' }));
    D.before.forEach((x, i) => add('before', i, x, {}));
    D.after.forEach((x, i) => add('after', i, x, {}));
    D.story.forEach((s, i) => add('story', i, s[0], { text: s[1] || '' }));
    D.sources.forEach((s, i) => add('source', i, s[0], { url: s[1] || '' }));
    add('text', 'tagline', D.tagline, { key: 'tagline' }); add('text', 'definition', D.definition, { key: 'definition' });
    return { biz, intro, list };
  }

  /* ---------- overlay ---------- */
  // ed[coll][id] = { f: fields you changed (or the whole record when new), isNew, del, updated (ms), nid, nHash, delSynced }
  function effective(seed, ed) {
    const out = [];
    for (const id of Object.keys(seed)) { const e = ed[id]; if (e && e.del) continue; out.push(e && e.f ? Object.assign({}, seed[id], e.f, { id }) : Object.assign({}, seed[id])); }
    for (const [id, e] of Object.entries(ed)) if (!seed[id] && !e.del && e.f) out.push(Object.assign({}, e.f, { id }));
    return out;
  }
  // Fields of `rec` that differ from the seed (what an edit stores).
  function diff(seedRec, rec) {
    if (!seedRec) return Object.assign({}, rec);
    const f = {}; for (const [k, v] of Object.entries(rec)) if (k !== 'id' && String(v ?? '') !== String(seedRec[k] ?? '')) f[k] = v; return f;
  }

  // Build the shapes the app draws from (same shape as data.json) out of the effective records.
  function view(D0, S) {
    const sd = seeds(D0); const E = {}; for (const c of COLLS) E[c] = effective(sd[c], (S.ed || {})[c] || {});
    const L = k => E.list.filter(x => x.kind === k).sort((a, b) => (a.order || 0) - (b.order || 0));
    const towns = L('town').map(t => ({ id: t.key || t.id.replace(/^town:/, ''), rid: t.id, name: t.name, la: +t.la, lo: +t.lo, day: t.day || '', go: t.go || '', why: t.why || '', travel: t.travel || '', bestDay: t.bestDay || '', dates: t.dates || '' }));
    const cats = L('cat').map(c => ({ id: +(c.key ?? c.id.replace(/^cat:/, '')), rid: c.id, name: c.name, ink: /^#[0-9a-f]{3,8}$/i.test(c.ink || '') ? c.ink : '#8a7a61' }));
    const personas = {}; L('persona').forEach(p => { personas[p.key || p.id.replace(/^persona:/, '')] = { rid: p.id, label: p.name, read: p.read || '', listen: p.listen || '' }; });
    const events = L('event').map(e => ({ rid: e.id, date: e.date || '', end: e.end || undefined, label: e.label || e.date || '', town: e.town || '', what: e.name, why: e.why || '', at: e.at || '' })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const signals = L('signal').map(s => ({ rid: s.id, company: s.name, town: s.town, where: s.where || '', shows: s.shows || '', todo: s.todo || '' }));
    const flow = L('flow').map(f => ({ rid: f.id, stage: f.name, do: f.do || '', say: f.say || '', from: f.from || '' }));
    const simple = k => L(k).map(x => ({ rid: x.id, text: x.name }));
    const story = L('story').map(s => ({ rid: s.id, 0: s.name, 1: s.text || '' }));
    const sources = L('source').map(s => ({ rid: s.id, 0: s.name, 1: s.url || '' }));
    const text = k => { const t = L('text').find(x => (x.key || '') === k); return t ? t.name : D0[k]; };
    const biz = E.biz.map(b => Object.assign({}, b, {
      cat: +b.cat, la: b.la === '' || b.la == null ? null : +b.la, lo: b.lo === '' || b.lo == null ? null : +b.lo, potential: +b.potential || 1,
      ask: { who: b.askWho || (b.custom ? 'Your notes' : ''), note: b.askNote || '' },
      watch: b.watchCompany ? { company: b.watchCompany, founded: b.watchFounded, directors: b.watchDirectors, angle: b.watchAngle } : null,
    }));
    const intros = E.intro.map(i => Object.assign({}, i, { strength: Math.min(3, Math.max(1, +i.strength || 1)), km: i.km == null || i.km === '' ? 0 : +i.km }));
    const watch = biz.filter(b => b.watch).map(b => Object.assign({ biz: b.id, town: b.town }, b.watch));
    return Object.assign({}, D0, { towns, cats, personas, events, signals, flow, before: simple('before'), after: simple('after'), story, sources, tagline: text('tagline'), definition: text('definition'), biz, intros, watch, seedIds: { biz: new Set(Object.keys(sd.biz)), intro: new Set(Object.keys(sd.intro)), list: new Set(Object.keys(sd.list)) } });
  }

  /* ---------- details text for list items ---------- */
  function encodeDetails(rec) {
    const K = KINDS[rec.kind]; if (!K) return '';
    return K.fields.map(([k, label]) => rec[k] == null || rec[k] === '' ? null : `${label}: ${String(rec[k]).replace(/\r?\n/g, ' ')}`).filter(Boolean).join('\n');
  }
  function decodeDetails(kind, text) {
    const K = KINDS[kind]; const out = {}; if (!K) return out;
    const by = Object.fromEntries(K.fields.map(([k, l]) => [norm(l), k]));
    for (const line of String(text ?? '').split(/\r?\n/)) {
      const m = line.match(/^\s*([^:]{1,40}):\s?(.*)$/); if (!m) continue; const k = by[norm(m[1])]; if (!k) continue;
      out[k] = NUMERIC.has(k) || k === 'la' || k === 'lo' ? (m[2].trim() === '' ? '' : Number(m[2])) : m[2].trim();
    }
    for (const [k] of K.fields) if (!(k in out)) out[k] = '';
    return out;
  }

  /* ---------- records <-> Worker rows ---------- */
  // ctx: { towns, cats, personas, biz (effective list), nidOf(coll,id), idOfNid(coll,nid) }
  function toRow(coll, rec, ctx) {
    if (coll === 'biz') {
      const t = ctx.towns.find(x => x.id === rec.town); const c = ctx.cats.find(x => x.id === +rec.cat); const p = ctx.personas[rec.persona];
      return { name: rec.name || '', cat: c ? c.name : '', town: t ? t.name : String(rec.town || ''), type: rec.type || '', addr: rec.addr || '', web: rec.web || '', phone: rec.phone || '',
        askWho: rec.askWho || '', askNote: rec.askNote || '', need: rec.need || '', offers: rec.offers || '', why: rec.why || '', opener: rec.opener || '', openerNote: rec.openerNote || '', theme: rec.theme || '',
        persona: p ? p.label : String(rec.persona || ''), potential: rec.potential === '' || rec.potential == null ? null : +rec.potential, founder: !!rec.founder,
        watchCompany: rec.watchCompany || '', watchFounded: rec.watchFounded || '', watchDirectors: rec.watchDirectors || '', watchAngle: rec.watchAngle || '',
        la: rec.la === '' || rec.la == null ? null : +rec.la, lo: rec.lo === '' || rec.lo == null ? null : +rec.lo, approx: !!rec.approx, custom: !!rec.custom, archived: false, appId: rec.id };
    }
    if (coll === 'intro') {
      const A = ctx.biz.find(b => b.id === rec.a), B = ctx.biz.find(b => b.id === rec.b);
      return { title: `${A ? A.name : rec.a} ⟷ ${B ? B.name : rec.b}`, a: ctx.nidOf('biz', rec.a) || '', b: ctx.nidOf('biz', rec.b) || '', why: rec.why || '', state: STATE[rec.state] || STATE.open, at: rec.at || '',
        kind: rec.kind || '', strength: STRENGTH[rec.strength] || STRENGTH[1], outcome: rec.outcome || '', outcomeNote: rec.outcomeNote || '', km: rec.km === '' || rec.km == null ? null : +rec.km, mine: !!rec.mine, archived: false, appId: rec.id };
    }
    return { name: rec.name || '', kind: (KINDS[rec.kind] || {}).label || rec.kind, details: encodeDetails(rec), order: rec.order ?? null, archived: false, appId: rec.id };
  }

  // Worker row -> record fields (ids resolved). Unknown names keep the current value.
  function fromRow(coll, row, ctx, cur) {
    cur = cur || {};
    if (coll === 'biz') {
      const t = ctx.towns.find(x => norm(x.name) === norm(row.town) || x.id === row.town);
      const c = ctx.cats.find(x => norm(x.name) === norm(row.cat));
      const pk = Object.keys(ctx.personas).find(k => norm(ctx.personas[k].label) === norm(row.persona) || k === row.persona);
      const r = {};
      for (const k of ['name', 'type', 'addr', 'web', 'phone', 'askWho', 'askNote', 'need', 'offers', 'why', 'opener', 'openerNote', 'theme', 'watchCompany', 'watchFounded', 'watchDirectors', 'watchAngle']) r[k] = row[k] ?? '';
      r.town = t ? t.id : (cur.town ?? (ctx.towns[0] || {}).id); r.cat = c ? c.id : (cur.cat ?? 0); r.persona = pk || (row.persona ? cur.persona ?? '' : '');
      r.potential = row.potential ?? 1; r.founder = !!row.founder; r.approx = !!row.approx; r.custom = !!row.custom;
      r.la = row.la ?? (t ? t.la : null); r.lo = row.lo ?? (t ? t.lo : null);
      return r;
    }
    if (coll === 'intro') {
      const st = Object.keys(STATE).find(k => STATE[k] === row.state) || 'open';
      const sg = +(Object.keys(STRENGTH).find(k => STRENGTH[k] === row.strength) || cur.strength || 1);
      return { a: ctx.idOfNid('biz', row.a) || (row.a ? cur.a : cur.a) || '', b: ctx.idOfNid('biz', row.b) || cur.b || '', why: row.why || '', state: st, at: row.at || '', kind: row.kind || '', strength: sg,
        outcome: OUTCOMES.includes(row.outcome) ? row.outcome : '', outcomeNote: row.outcomeNote || '', km: row.km ?? null, mine: !!row.mine };
    }
    const kind = KIND_BY_LABEL[String(row.kind || '').toLowerCase()] || cur.kind || 'text';
    return Object.assign({ kind, name: row.name || '', order: row.order ?? cur.order ?? 999 }, decodeDetails(kind, row.details));
  }

  // Fingerprint of what a row says (for telling real edits from echoes of our own writes).
  const KEYS = { biz: ['name', 'cat', 'town', 'type', 'addr', 'web', 'phone', 'askWho', 'askNote', 'need', 'offers', 'why', 'opener', 'openerNote', 'theme', 'persona', 'potential', 'founder', 'watchCompany', 'watchFounded', 'watchDirectors', 'watchAngle', 'la', 'lo', 'approx', 'custom', 'archived', 'appId'],
    intro: ['title', 'a', 'b', 'why', 'state', 'at', 'kind', 'strength', 'outcome', 'outcomeNote', 'km', 'mine', 'archived', 'appId'],
    list: ['name', 'kind', 'details', 'order', 'archived', 'appId'] };
  const val = v => v == null ? '' : typeof v === 'number' ? String(+v.toFixed(7)) : typeof v === 'boolean' ? (v ? '1' : '') : String(v).replace(/\r\n/g, '\n').trim().replace(/-/g, k => k);
  function rowHash(coll, row) {
    const s = KEYS[coll].map(k => k === 'a' || k === 'b' ? val(row[k]).replace(/-/g, '').toLowerCase() : val(row[k])).join('\u241e');
    let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36) + ':' + s.length;
  }

  // ISO week key (Monday start) for the weekly count.
  function weekKey(iso) { const d = new Date(iso + 'T12:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }

  return { COLLS, ENDPOINT, KINDS, STATE, STRENGTH, OUTCOMES, seeds, effective, diff, view, encodeDetails, decodeDetails, toRow, fromRow, rowHash, weekKey, slug, norm };
});
