// Field maps for the three app-owned Notion databases. Pure, no network.
// The app sends flat rows keyed by the left-hand names; the Worker writes typed Notion properties.
import { plain, richText } from './notion.js';

export const COLLECTIONS = {
  businesses: {
    env: 'BIZ_DS',
    fields: {
      name: ['Name', 'title'], cat: ['Trade', 'text'], town: ['Town', 'select'], type: ['What they do', 'text'],
      addr: ['Address', 'text'], web: ['Website', 'url'], phone: ['Phone', 'phone'],
      askWho: ['Who to ask for', 'text'], askNote: ['Ask note', 'text'], need: ['Their need', 'text'], offers: ['They could offer', 'text'],
      why: ['Why they matter', 'text'], opener: ['Opener', 'text'], openerNote: ['Opener note', 'text'], theme: ['Theme', 'text'],
      persona: ['Approach', 'select'], potential: ['Potential', 'number'], founder: ['Retiring founder', 'checkbox'],
      watchCompany: ['Watchlist company', 'text'], watchFounded: ['Watchlist founded', 'text'], watchDirectors: ['Watchlist directors', 'text'], watchAngle: ['Watchlist angle', 'text'],
      la: ['Latitude', 'number'], lo: ['Longitude', 'number'], approx: ['Approximate pin', 'checkbox'], custom: ['Walk-in', 'checkbox'],
      archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'],
    },
  },
  introductions: {
    env: 'INTRO_DS',
    fields: {
      title: ['Introduction', 'title'], a: ['From', 'relation'], b: ['To', 'relation'], why: ['Why', 'text'],
      state: ['Status', 'select'], at: ['Status date', 'date'], kind: ['Kind', 'select'], strength: ['Strength', 'select'],
      outcome: ['Outcome', 'select'], outcomeNote: ['Outcome note', 'text'],
      km: ['Distance km', 'number'], mine: ['Yours', 'checkbox'], archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'],
    },
  },
  lists: {
    env: 'NOTE_DS',
    fields: { name: ['Name', 'title'], kind: ['Kind', 'select'], details: ['Details', 'text'], order: ['Order', 'number'], archived: ['Archived', 'checkbox'], appId: ['App ID', 'text'] },
  },
};

const MAXT = 20000;
const str = v => String(v ?? '').replace(/\r\n/g, '\n');

export function toProps(coll, row) {
  const F = COLLECTIONS[coll].fields; const out = {};
  for (const [k, v] of Object.entries(row)) {
    const f = F[k]; if (!f) continue; const [name, type] = f;
    if (type === 'title') out[name] = { title: richText(str(v).slice(0, 2000)) };
    else if (type === 'text') out[name] = { rich_text: richText(str(v).slice(0, MAXT)) };
    else if (type === 'select') { const s = str(v).replace(/,/g, ' ·').trim().slice(0, 100); out[name] = { select: s ? { name: s } : null }; }
    else if (type === 'url') out[name] = { url: str(v).trim() || null };
    else if (type === 'phone') out[name] = { phone_number: str(v).trim() || null };
    else if (type === 'number') { const n = v === '' || v == null ? null : Number(v); out[name] = { number: Number.isFinite(n) ? n : null }; }
    else if (type === 'checkbox') out[name] = { checkbox: !!v && v !== 'false' };
    else if (type === 'date') out[name] = { date: /^\d{4}-\d{2}-\d{2}/.test(str(v)) ? { start: str(v).slice(0, 10) } : null };
    else if (type === 'relation') out[name] = { relation: str(v) ? [{ id: str(v) }] : [] };
  }
  return out;
}

export function fromPage(coll, page) {
  const F = COLLECTIONS[coll].fields; const p = page.properties || {}; const row = {};
  for (const [k, [name, type]] of Object.entries(F)) {
    const x = p[name]; if (!x) continue;
    if (type === 'title' || type === 'text') row[k] = plain(x);
    else if (type === 'select') row[k] = x.select ? x.select.name : '';
    else if (type === 'url') row[k] = x.url || '';
    else if (type === 'phone') row[k] = x.phone_number || '';
    else if (type === 'number') row[k] = x.number ?? null;
    else if (type === 'checkbox') row[k] = !!x.checkbox;
    else if (type === 'date') row[k] = x.date ? String(x.date.start).slice(0, 10) : '';
    else if (type === 'relation') row[k] = (x.relation && x.relation[0] && x.relation[0].id) || '';
  }
  return { id: page.id, ...row, lastEdited: page.last_edited_time, url: page.url };
}

export function validate(coll, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object';
  const F = COLLECTIONS[coll].fields; const keys = Object.keys(body).filter(k => F[k]);
  if (!keys.length) return 'Nothing to write';
  for (const k of keys) { const v = body[k], t = F[k][1];
    if (v == null) continue;
    if (t === 'number' && v !== '' && !Number.isFinite(Number(v))) return `${k} must be a number`;
    if (t === 'checkbox' && typeof v !== 'boolean') return `${k} must be true or false`;
    if (!['number', 'checkbox'].includes(t) && typeof v !== 'string') return `${k} must be a string`;
    if (t === 'relation' && v && !/^[0-9a-f]{32}$/.test(String(v).replace(/-/g, '').toLowerCase())) return `${k} must be a Notion page id`;
  }
  return null;
}
