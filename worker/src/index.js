// heirloom-atlas-sync: a tiny bridge between The Heirloom Atlas (static site) and the "People I've Met" Notion database.
// Secrets (wrangler secret put): NOTION_TOKEN, APP_KEY. Vars (wrangler.toml): DATA_SOURCE_ID, ALLOWED_ORIGINS, NOTION_VERSION.
import { pageToRow, rowToProperties, validateRow, pick, isPageId, sameId } from './notion.js';

const NOTION = 'https://api.notion.com/v1';
const MAX_BODY = 64 * 1024;

export default {
  async fetch(req, env, ctx) { return handle(req, env); },
};

export async function handle(req, env) {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || 'https://mhccog.github.io').split(',').map(s => s.trim()).filter(Boolean);
  const cors = origin && allowed.includes(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  } : { 'Vary': 'Origin' };
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors, ...extra } });

  // Browsers from any other site are refused outright. Calls with no Origin (curl, scripts) still need the passphrase.
  if (origin && !allowed.includes(origin)) return json(403, { error: 'origin_not_allowed' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/' || url.pathname === '/health') return json(200, { ok: true, service: 'heirloom-atlas-sync' });

  if (!env.APP_KEY || !env.NOTION_TOKEN || !env.DATA_SOURCE_ID) return json(500, { error: 'not_configured' });
  if (!(await keyOk(req.headers.get('X-App-Key'), env.APP_KEY))) return json(401, { error: 'bad_passphrase' });

  const m = url.pathname.match(/^\/people(?:\/([^/]+))?\/?$/);
  if (!m) return json(404, { error: 'not_found' });
  const id = m[1] ? decodeURIComponent(m[1]) : null;

  try {
    if (req.method === 'GET' && !id) {
      const body = { page_size: clampInt(url.searchParams.get('limit'), 1, 100, 100), sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
      const cursor = url.searchParams.get('cursor'); if (cursor) body.start_cursor = cursor;
      const r = await notion(env, 'POST', `/data_sources/${env.DATA_SOURCE_ID}/query`, body);
      return json(200, { results: r.results.filter(p => p.object === 'page' && !p.in_trash).map(pageToRow), next_cursor: r.next_cursor || null, has_more: !!r.has_more, incomplete: r.request_status?.type === 'incomplete' });
    }
    if (req.method === 'POST' && !id) {
      const b = await readJson(req); if (b.error) return json(400, b);
      const bad = validateRow(b, { partial: false }); if (bad) return json(400, { error: 'invalid', detail: bad });
      const page = await notion(env, 'POST', '/pages', { parent: { type: 'data_source_id', data_source_id: env.DATA_SOURCE_ID }, properties: rowToProperties(pick(b)) });
      return json(201, pageToRow(page));
    }
    if (req.method === 'PATCH' && id) {
      if (!isPageId(id)) return json(400, { error: 'invalid_id' });
      const b = await readJson(req); if (b.error) return json(400, b);
      const bad = validateRow(b, { partial: true }); if (bad) return json(400, { error: 'invalid', detail: bad });
      // Only ever edit rows that live in this one database.
      const cur = await notion(env, 'GET', `/pages/${id}`);
      if (!inDataSource(cur, env.DATA_SOURCE_ID)) return json(404, { error: 'not_found' });
      if (cur.in_trash) return json(410, { error: 'gone' });
      const page = await notion(env, 'PATCH', `/pages/${id}`, { properties: rowToProperties(pick(b)) });
      return json(200, pageToRow(page));
    }
    return json(405, { error: 'method_not_allowed' });
  } catch (e) {
    const status = e.status === 404 ? 404 : e.status === 429 ? 429 : 502;
    return json(status, { error: e.code || 'notion_error', detail: String(e.message || e).slice(0, 300) }, e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {});
  }
}

function inDataSource(page, dsId) {
  const p = page && page.parent; if (!p) return false;
  return (p.data_source_id && sameId(p.data_source_id, dsId)) || false;
}

function clampInt(v, lo, hi, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }

async function readJson(req) {
  const len = +req.headers.get('Content-Length') || 0; if (len > MAX_BODY) return { error: 'too_large' };
  const t = await req.text(); if (t.length > MAX_BODY) return { error: 'too_large' };
  try { return JSON.parse(t); } catch { return { error: 'bad_json' }; }
}

async function keyOk(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a), y = new Uint8Array(b); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}

// Notion allows about 3 requests a second per integration. Space calls out inside this isolate and retry politely.
let last = 0;
export const _t = { sleep: ms => new Promise(r => setTimeout(r, ms)), gap: 340 };
async function notion(env, method, path, body, attempt = 0) {
  const wait = last + _t.gap - Date.now(); last = Math.max(Date.now(), last + _t.gap); if (wait > 0) await _t.sleep(wait);
  const res = await fetch(NOTION + path, {
    method,
    headers: { 'Authorization': `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': env.NOTION_VERSION || '2026-03-11', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status >= 500 || res.status === 409) && attempt < 3) {
    const ra = Math.min(10, parseFloat(res.headers.get('Retry-After')) || 0.5 * 2 ** attempt);
    await _t.sleep(ra * 1000);
    return notion(env, method, path, body, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || `Notion ${res.status}`); e.status = res.status; e.code = data.code; e.retryAfter = res.headers.get('Retry-After'); throw e; }
  return data;
}
