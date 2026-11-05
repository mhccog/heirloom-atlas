// Pure helpers: Notion page objects <-> the flat rows the app uses. No network here.
export const PROPS = { name: 'Name', metAt: 'Met at', contact: 'Contact', notes: 'Notes', added: 'Added' };
const MAX = 2000; // Notion rich_text content limit per item

export function plain(prop) {
  if (!prop) return '';
  const arr = prop.type === 'title' ? prop.title : prop.type === 'rich_text' ? prop.rich_text : (prop.title || prop.rich_text || []);
  return (arr || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
}

export function richText(s) {
  const str = String(s ?? '');
  const out = [];
  for (let i = 0; i < str.length && out.length < 100; i += MAX) out.push({ type: 'text', text: { content: str.slice(i, i + MAX) } });
  return out;
}

export function pageToRow(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: plain(p[PROPS.name]),
    metAt: plain(p[PROPS.metAt]),
    contact: plain(p[PROPS.contact]),
    notes: plain(p[PROPS.notes]),
    lastEdited: page.last_edited_time,
    created: (p[PROPS.added] && p[PROPS.added].created_time) || page.created_time,
    url: page.url,
  };
}

// Only the fields present in `row` are written, so PATCH can be partial. "Added" is automatic and never written.
export function rowToProperties(row) {
  const props = {};
  if ('name' in row) props[PROPS.name] = { title: richText(clean(row.name, 2000)) };
  if ('metAt' in row) props[PROPS.metAt] = { rich_text: richText(clean(row.metAt, 2000)) };
  if ('contact' in row) props[PROPS.contact] = { rich_text: richText(clean(row.contact, 2000)) };
  if ('notes' in row) props[PROPS.notes] = { rich_text: richText(clean(row.notes, 20000)) };
  return props;
}

function clean(v, max) { return String(v ?? '').replace(/\r\n/g, '\n').slice(0, max); }

export function validateRow(body, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object';
  const allowed = ['name', 'metAt', 'contact', 'notes'];
  const keys = Object.keys(body).filter(k => allowed.includes(k));
  if (!keys.length) return 'Nothing to write';
  for (const k of keys) if (typeof body[k] !== 'string') return `${k} must be a string`;
  if (!partial && !String(body.name ?? '').trim() && !String(body.metAt ?? '').trim()) return 'name or metAt is required';
  return null;
}

export function pick(body) {
  const out = {}; for (const k of ['name', 'metAt', 'contact', 'notes']) if (typeof body[k] === 'string') out[k] = body[k]; return out;
}

const hex = s => String(s).replace(/-/g, '').toLowerCase();
export const isPageId = s => /^[0-9a-f]{32}$/.test(hex(s));
export const sameId = (a, b) => hex(a) === hex(b);
