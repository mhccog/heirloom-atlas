/* Notion sync mapping for The Heirloom Atlas. Pure functions, no DOM, no network.
   Shared by the app (window.NotionMap) and the unit tests (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotionMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STAGES = ['Not visited', 'Said hi', 'Got contact', 'Returning', 'Connected'];
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const SEP = ' · ';
  // The first line of Notes is managed by the app, e.g. "Status: Got contact · Next visit: 2026-12-01".
  const HEADER = /^\s*Status\s*:/i;

  const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  function stageFromLabel(label) {
    const n = norm(label); if (!n) return null;
    const i = STAGES.findIndex(s => norm(s) === n);
    return i >= 0 ? i : null;
  }

  function formatHeader(p) {
    const parts = ['Status: ' + (STAGES[p.stage] || STAGES[0])];
    if (p.last && ISO.test(p.last)) parts.push('Last visit: ' + p.last);
    if (p.next && ISO.test(p.next)) parts.push('Next visit: ' + p.next);
    return parts.join(SEP);
  }

  function buildNotes(p) {
    const body = String(p.notes ?? '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
    return formatHeader(p) + (body ? '\n' + body : '');
  }

  // Returns { hadHeader, stage (index|null), last, next, notes }. Unknown or garbled fields come back null,
  // so the caller keeps its own value instead of wiping it.
  function parseNotes(text) {
    const t = String(text ?? '').replace(/\r\n/g, '\n');
    const nl = t.indexOf('\n');
    const first = nl < 0 ? t : t.slice(0, nl);
    if (!HEADER.test(first)) return { hadHeader: false, stage: null, last: null, next: null, notes: t.replace(/\s+$/, '') };
    const out = { hadHeader: true, stage: null, last: null, next: null, notes: (nl < 0 ? '' : t.slice(nl + 1)).replace(/^\n+/, '').replace(/\s+$/, '') };
    for (const raw of first.split(/\s+[·•|]\s+|\s*;\s*/)) {
      const m = raw.match(/^\s*([A-Za-z ]+?)\s*:\s*(.*?)\s*$/); if (!m) continue;
      const k = norm(m[1]), v = m[2];
      if (k === 'status') out.stage = stageFromLabel(v);
      else if (k === 'next visit' || k === 'next') out.next = ISO.test(v) ? v : (v === '' || /^(none|-|—)$/i.test(v) ? '' : null);
      else if (k === 'last visit' || k === 'last') out.last = ISO.test(v) ? v : (v === '' || /^(none|-|—)$/i.test(v) ? '' : null);
    }
    return out;
  }

  const metAt = (biz, townName) => [biz.name, townName].filter(Boolean).join(', ');

  // App record -> flat row the Worker understands.
  function toRow(biz, p, townName) {
    const met = String(p.met ?? '').trim();
    return {
      name: met || biz.name,
      metAt: metAt(biz, townName),
      contact: String(p.contact ?? '').trim(),
      notes: buildNotes(p),
    };
  }

  // Flat row -> patch for the app's person record (only fields Notion owns).
  function fromRow(row, biz, current) {
    const cur = current || {};
    const parsed = parseNotes(row.notes);
    const name = String(row.name ?? '').trim();
    const patch = {
      met: name && (!biz || norm(name) !== norm(biz.name)) ? name : '',
      contact: String(row.contact ?? '').trim(),
      notes: parsed.notes,
    };
    if (parsed.stage != null) patch.stage = parsed.stage;
    if (parsed.last != null) patch.last = parsed.last;
    if (parsed.next != null) patch.next = parsed.next;
    if (!parsed.hadHeader && cur.stage == null) patch.stage = 1;
    return patch;
  }

  // Stable fingerprint of the synced fields (to tell real edits from echoes of our own writes).
  function rowHash(row) {
    const s = [row.name, row.metAt, row.contact, row.notes].map(x => String(x ?? '').replace(/\r\n/g, '\n').trim()).join('\u241e');
    let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36) + ':' + s.length;
  }

  const isBlankRow = row => ![row.name, row.metAt, row.contact, row.notes].some(x => String(x ?? '').trim());

  // Does the app hold anything worth putting in Notion for this person?
  const hasData = p => !!p && (p.stage > 0 || !!String(p.notes ?? '').trim() || !!String(p.met ?? '').trim() || !!String(p.contact ?? '').trim());

  // What to do with a linked record.
  // localDirty: changed here since the last sync. remoteChanged: Notion content differs from what we last saw.
  // Newest edit wins on a true conflict: Notion last_edited_time (minute precision) vs local updated (ms).
  function decide({ localDirty, remoteChanged, localUpdated, remoteEdited }) {
    if (localDirty && remoteChanged) {
      const r = Date.parse(remoteEdited || '') || 0;
      return (localUpdated || 0) >= r ? 'push' : 'pull';
    }
    if (remoteChanged) return 'pull';
    if (localDirty) return 'push';
    return 'none';
  }

  // Find the app business a Notion row is about, from its "Met at" text ("Business, Town").
  function matchBiz(row, bizList, towns) {
    const m = norm(row.metAt); if (!m) return null;
    const townOf = id => (towns.find(t => t.id === id) || {}).name || '';
    let best = null, bestLen = 0;
    for (const b of bizList) {
      const bn = norm(b.name); if (!bn) continue;
      const full = norm(metAt(b, townOf(b.town)));
      if (m === full || m === bn) return b;
      if ((m.startsWith(bn + ' ') || m === bn) && bn.length > bestLen) { best = b; bestLen = bn.length; }
    }
    return best;
  }

  function townCandidates(t) {
    const full = norm(t.name); const c = new Set([full, full.split(' on ')[0], full.split(' and ')[0]]);
    const first = full.split(' ')[0]; if (first.length >= 5) c.add(first);
    return [...c].filter(Boolean);
  }
  function findTown(text, towns) {
    const n = ' ' + norm(text) + ' ';
    let best = null, len = 0;
    for (const t of towns) for (const c of townCandidates(t)) if (n.includes(' ' + c + ' ') && c.length > len) { best = t; len = c.length; }
    return best;
  }

  // A Notion row that matches no business becomes a walk-in.
  function walkinFromRow(row, towns, fallbackTownId) {
    const raw = String(row.metAt ?? '').trim();
    const found = findTown(raw, towns);
    const t = found || towns.find(x => x.id === fallbackTownId) || towns[0];
    let name = raw;
    const comma = raw.lastIndexOf(',');
    if (comma > 0 && findTown(raw.slice(comma + 1), towns)) name = raw.slice(0, comma).trim();
    if (!name) name = String(row.name ?? '').trim() || 'From Notion';
    return { name, town: t ? t.id : '', townGuessed: !found };
  }

  // Notion rich_text items are capped at 2,000 characters each (100 items per property).
  function chunkText(s, size = 2000) {
    const str = String(s ?? ''); if (!str) return [];
    const out = []; for (let i = 0; i < str.length && out.length < 100; i += size) out.push(str.slice(i, i + size));
    return out;
  }

  return { STAGES, norm, stageFromLabel, formatHeader, buildNotes, parseNotes, toRow, fromRow, rowHash, isBlankRow, hasData, decide, matchBiz, findTown, walkinFromRow, chunkText, metAt };
});
