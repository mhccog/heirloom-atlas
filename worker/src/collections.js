// One Notion database ("Heirloom Atlas") holds businesses, introductions, and towns & lists, told apart by its Type column.
// The app still talks to three collections; each maps a few fields to real columns and folds the rarely-used rest
// into the Details column as "Label: value" lines. Pure, no network.
import { plain, richText } from './notion.js';

export const LIST_TYPES = ['Town', 'Event', 'Trade', 'Approach', 'Signal', 'Script step', 'Car checklist', 'After visit', 'Story', 'Source', 'App text'];
export const DB_ENV = 'ATLAS_DS';

export const COLLECTIONS = {
  businesses: {
    type: 'Business',
    fields: {
      name: ['Name', 'title'], cat: ['Trade', 'text'], town: ['Town', 'select'], why: ['Why', 'text'],
      web: ['Website', 'url'], phone: ['Phone', 'phone'], archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'],
      type: ['What they do', 'd'], addr: ['Address', 'd'], askWho: ['Who to ask for', 'd'], askNote: ['Ask note', 'd'],
      need: ['Their need', 'd'], offers: ['They could offer', 'd'], opener: ['Opener', 'd'], openerNote: ['Opener note', 'd'], theme: ['Theme', 'd'],
      persona: ['Approach', 'd'], potential: ['Potential', 'dn'], founder: ['Retiring founder', 'db'],
      watchCompany: ['Watchlist company', 'd'], watchFounded: ['Watchlist founded', 'd'], watchDirectors: ['Watchlist directors', 'd'], watchAngle: ['Watchlist angle', 'd'],
      la: ['Latitude', 'dn'], lo: ['Longitude', 'dn'], approx: ['Approximate pin', 'db'], custom: ['Walk-in', 'db'],
    },
  },
  introductions: {
    type: 'Introduction',
    fields: {
      title: ['Name', 'title'], a: ['From', 'relation'], b: ['To', 'relation'], why: ['Why', 'text'],
      state: ['Status', 'select'], outcome: ['Outcome', 'select'], archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'],
      at: ['Status date', 'd'], kind: ['Kind', 'd'], strength: ['Strength', 'd'], outcomeNote: ['Outcome note', 'd'], km: ['Distance km', 'dn'], mine: ['Yours', 'db'],
    },
  },
  lists: {
    type: null, // the list kind is the Type
    fields: { name: ['Name', 'title'], kind: ['Type', 'select'], details: ['Details', 'text'], order: ['Order', 'number'], archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'] },
  },
};

const MAXT = 20000;
const str = v => String(v ?? '').replace(/\r\n/g, '\n');
const isD = t => t === 'd' || t === 'dn' || t === 'db';
const esc = s => str(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
const unesc = s => s.replace(/\\(\\|n)/g, (_, c) => (c === 'n' ? '\n' : '\\'));

export function parseDetails(text) {
  const out = {};
  for (const line of str(text).split('\n')) { const i = line.indexOf(': '); if (i > 0) out[line.slice(0, i).trim()] = unesc(line.slice(i + 2)); else if (line.endsWith(':')) out[line.slice(0, -1).trim()] = ''; }
  return out;
}
function encodeDetailValue(t, v) {
  if (t === 'db') return v && v !== 'false' ? 'yes' : '';
  if (t === 'dn') { const n = v === '' || v == null ? NaN : Number(v); return Number.isFinite(n) ? String(n) : ''; }
  return esc(v);
}
function decodeDetailValue(t, s) {
  if (t === 'db') return /^(yes|true|y|1|✓)$/i.test(String(s || '').trim());
  if (t === 'dn') { const n = s === undefined || String(s).trim() === '' ? NaN : Number(String(s).trim()); return Number.isFinite(n) ? n : null; }
  return s ?? '';
}

// Which rows belong to a collection: a Notion query filter, and a check on one page.
export function typeFilter(coll) {
  const C = COLLECTIONS[coll];
  if (C.type) return { property: 'Type', select: { equals: C.type } };
  return { or: LIST_TYPES.map(t => ({ property: 'Type', select: { equals: t } })) };
}
export function belongs(coll, page) {
  const t = page && page.properties && page.properties.Type && page.properties.Type.select ? page.properties.Type.select.name : '';
  const C = COLLECTIONS[coll]; return C.type ? t === C.type : LIST_TYPES.includes(t);
}

// row: flat app row (may be partial on PATCH). cur: the current Notion page, so Details keeps fields the row leaves out.
export function toProps(coll, row, cur) {
  const C = COLLECTIONS[coll]; const F = C.fields; const out = {}; let det = null;
  for (const [k, v] of Object.entries(row)) {
    const f = F[k]; if (!f) continue; const [name, type] = f;
    if (isD(type)) { if (!det) det = cur ? detailsOf(coll, cur) : {}; det[k] = v; continue; }
    if (type === 'title') out[name] = { title: richText(str(v).slice(0, 2000)) };
    else if (type === 'text') out[name] = { rich_text: richText(str(v).slice(0, MAXT)) };
    else if (type === 'select') { const s = str(v).replace(/,/g, ' ·').trim().slice(0, 100); out[name] = { select: s ? { name: s } : null }; }
    else if (type === 'url') out[name] = { url: str(v).trim() || null };
    else if (type === 'phone') out[name] = { phone_number: str(v).trim() || null };
    else if (type === 'number') { const n = v === '' || v == null ? null : Number(v); out[name] = { number: Number.isFinite(n) ? n : null }; }
    else if (type === 'checkbox') out[name] = { checkbox: !!v && v !== 'false' };
    else if (type === 'relation') out[name] = { relation: str(v) ? [{ id: str(v) }] : [] };
  }
  if (det) {
    const lines = []; const known = new Set();
    for (const [k, [label, type]] of Object.entries(F)) { if (!isD(type)) continue; known.add(label); const s = encodeDetailValue(type, det[k]); if (s !== '') lines.push(`${label}: ${s}`); }
    for (const [label, s] of Object.entries(det.__extra || {})) if (!known.has(label)) lines.push(`${label}: ${esc(s)}`); // lines someone typed in Notion
    out.Details = { rich_text: richText(lines.join('\n').slice(0, MAXT)) };
  }
  if (C.type) out.Type = { select: { name: C.type } };
  else if (out.Type && !(out.Type.select && LIST_TYPES.includes(out.Type.select.name))) out.Type = { select: { name: 'App text' } };
  return out;
}

function detailsOf(coll, page) {
  const F = COLLECTIONS[coll].fields; const raw = parseDetails(plain((page.properties || {}).Details || {}));
  const row = {}; const byLabel = {};
  for (const [k, [label, type]] of Object.entries(F)) if (isD(type)) { byLabel[label] = 1; row[k] = decodeDetailValue(type, raw[label]); }
  const extra = {}; for (const [l, v] of Object.entries(raw)) if (!byLabel[l]) extra[l] = v;
  Object.defineProperty(row, '__extra', { value: extra, enumerable: false });
  return row;
}

export function fromPage(coll, page) {
  const F = COLLECTIONS[coll].fields; const p = page.properties || {}; const row = {};
  for (const [k, [name, type]] of Object.entries(F)) {
    if (isD(type)) continue;
    const x = p[name]; if (!x) continue;
    if (type === 'title' || type === 'text') row[k] = plain(x);
    else if (type === 'select') row[k] = x.select ? x.select.name : '';
    else if (type === 'url') row[k] = x.url || '';
    else if (type === 'phone') row[k] = x.phone_number || '';
    else if (type === 'number') row[k] = x.number ?? null;
    else if (type === 'checkbox') row[k] = !!x.checkbox;
    else if (type === 'relation') row[k] = (x.relation && x.relation[0] && x.relation[0].id) || '';
  }
  if (Object.values(F).some(([, t]) => isD(t))) Object.assign(row, detailsOf(coll, page));
  return { id: page.id, ...row, lastEdited: page.last_edited_time, url: page.url };
}

export function validate(coll, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object';
  const F = COLLECTIONS[coll].fields; const keys = Object.keys(body).filter(k => F[k]);
  if (!keys.length) return 'Nothing to write';
  for (const k of keys) { const v = body[k], t = F[k][1];
    if (v == null) continue;
    const num = t === 'number' || t === 'dn', bool = t === 'checkbox' || t === 'db';
    if (num && v !== '' && !Number.isFinite(Number(v))) return `${k} must be a number`;
    if (bool && typeof v !== 'boolean') return `${k} must be true or false`;
    if (!num && !bool && typeof v !== 'string') return `${k} must be a string`;
    if (t === 'relation' && v && !/^[0-9a-f]{32}$/.test(String(v).replace(/-/g, '').toLowerCase())) return `${k} must be a Notion page id`;
  }
  return null;
}
