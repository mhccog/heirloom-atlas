import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle, _t } from '../src/index.js';
import { pageToRow, rowToProperties, richText, validateRow, isPageId } from '../src/notion.js';

const DS = '073f4d29-a404-4ed0-ad5d-70bc7674b385';
const env = { NOTION_TOKEN: 'ntn_test', APP_KEY: 'good-key', DATA_SOURCE_ID: DS, ALLOWED_ORIGINS: 'https://mhccog.github.io', NOTION_VERSION: '2026-03-11' };
const ORIGIN = 'https://mhccog.github.io';
_t.sleep = async () => {}; _t.gap = 0;

// a tiny fake Notion
let pages, calls, failNext;
const T = (s) => [{ type: 'text', plain_text: s, text: { content: s } }];
function mkPage(id, props, parent = { type: 'data_source_id', data_source_id: DS, database_id: 'db' }) {
  return { object: 'page', id, url: 'https://www.notion.so/' + id.replace(/-/g, ''), created_time: '2026-11-03T11:00:00.000Z', last_edited_time: '2026-11-03T11:00:00.000Z', in_trash: false, parent,
    properties: { Name: { type: 'title', title: T(props.name || '') }, 'Met at': { type: 'rich_text', rich_text: T(props.metAt || '') }, Contact: { type: 'rich_text', rich_text: T(props.contact || '') }, Notes: { type: 'rich_text', rich_text: T(props.notes || '') }, Added: { type: 'created_time', created_time: '2026-11-03T11:00:00.000Z' } } };
}
const fromProps = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.title ? { type: 'title', title: v.title.map(t => ({ ...t, plain_text: t.text.content })) } : { type: 'rich_text', rich_text: v.rich_text.map(t => ({ ...t, plain_text: t.text.content })) }]));
beforeEach(() => {
  pages = new Map(); calls = []; failNext = null;
  pages.set('11111111111111111111111111111111', mkPage('11111111-1111-1111-1111-111111111111', { name: 'Sarah', metAt: 'Hungerford Arcade, Hungerford', notes: 'Status: Said hi' }));
  pages.set('22222222222222222222222222222222', mkPage('22222222-2222-2222-2222-222222222222', { name: 'Other' }, { type: 'page_id', page_id: 'zzz' }));
  globalThis.fetch = async (u, init = {}) => {
    calls.push({ u: String(u), init });
    assert.equal(init.headers.Authorization, 'Bearer ntn_test'); assert.equal(init.headers['Notion-Version'], '2026-03-11');
    if (failNext) { const f = failNext; failNext = null; return new Response(JSON.stringify({ code: 'rate_limited', message: 'slow down' }), { status: f, headers: { 'Retry-After': '1' } }); }
    const path = String(u).replace('https://api.notion.com/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    let m;
    if (init.method === 'POST' && path === `/data_sources/${DS}/query`) {
      const all = [...pages.values()].filter(p => p.parent.data_source_id === DS);
      const start = body.start_cursor ? +body.start_cursor : 0; const slice = all.slice(start, start + body.page_size);
      return Response.json({ object: 'list', results: slice, has_more: start + body.page_size < all.length, next_cursor: start + body.page_size < all.length ? String(start + body.page_size) : null });
    }
    if (init.method === 'POST' && path === '/pages') {
      assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: DS });
      const id = 'aaaaaaaa-aaaa-aaaa-aaaa-' + String(pages.size).padStart(12, '0');
      const pg = mkPage(id, {}); pg.properties = { ...pg.properties, ...fromProps(body.properties) }; pages.set(id.replace(/-/g, ''), pg); return Response.json(pg);
    }
    if ((m = path.match(/^\/pages\/([0-9a-f-]+)$/))) {
      const pg = pages.get(m[1].replace(/-/g, '')); if (!pg) return Response.json({ code: 'object_not_found', message: 'nope' }, { status: 404 });
      if (init.method === 'GET') return Response.json(pg);
      if (init.method === 'PATCH') { pg.properties = { ...pg.properties, ...fromProps(body.properties) }; pg.last_edited_time = '2026-11-03T12:00:00.000Z'; return Response.json(pg); }
    }
    return Response.json({ message: 'unexpected ' + path }, { status: 400 });
  };
});
const req = (method, path, { key = 'good-key', origin = ORIGIN, body } = {}) => handle(new Request('https://w.example' + path, { method, headers: { ...(key ? { 'X-App-Key': key } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);

test('health needs no key and reveals nothing', async () => {
  const r = await req('GET', '/health', { key: null }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, service: 'heirloom-atlas-sync' }); assert.equal(calls.length, 0);
});
test('CORS: preflight from the site, refusal from anywhere else', async () => {
  const p = await req('OPTIONS', '/people', { key: null }); assert.equal(p.status, 204);
  assert.equal(p.headers.get('Access-Control-Allow-Origin'), ORIGIN); assert.match(p.headers.get('Access-Control-Allow-Headers'), /X-App-Key/); assert.match(p.headers.get('Access-Control-Allow-Methods'), /PATCH/);
  const bad = await req('GET', '/people', { origin: 'https://evil.example' }); assert.equal(bad.status, 403); assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null); assert.equal(calls.length, 0);
});
test('passphrase required', async () => {
  assert.equal((await req('GET', '/people', { key: null })).status, 401);
  assert.equal((await req('GET', '/people', { key: 'wrong' })).status, 401);
  assert.equal((await req('POST', '/people', { key: 'wrong', body: { name: 'x' } })).status, 401);
  assert.equal(calls.length, 0, 'Notion is never called without the key');
});
test('missing secrets fail closed', async () => {
  const r = await handle(new Request('https://w.example/people', { headers: { 'X-App-Key': 'x' } }), { DATA_SOURCE_ID: DS }); assert.equal(r.status, 500);
});
test('GET /people lists only this data source, flat rows, paginated', async () => {
  for (let i = 0; i < 3; i++) pages.set('b' + i, mkPage('bbbbbbbb-bbbb-bbbb-bbbb-00000000000' + i, { name: 'P' + i }));
  const r = await req('GET', '/people?limit=2'); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.results.length, 2); assert.equal(j.has_more, true); assert.equal(j.next_cursor, '2');
  assert.deepEqual(Object.keys(j.results[0]).sort(), ['contact', 'created', 'id', 'lastEdited', 'metAt', 'name', 'notes', 'url']);
  assert.equal(j.results[0].name, 'Sarah'); assert.equal(j.results[0].metAt, 'Hungerford Arcade, Hungerford');
  const j2 = await (await req('GET', '/people?limit=2&cursor=2')).json(); assert.equal(j2.results.length, 2); assert.equal(j2.has_more, false);
  assert.equal(JSON.parse(calls[1].init.body).start_cursor, '2');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN); assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('POST /people creates a row with only the four text properties', async () => {
  const r = await req('POST', '/people', { body: { name: 'Tom', metAt: 'Toovey’s, Petworth', contact: '0123', notes: 'Status: Said hi\nhi', added: 'nope', evil: 1 } });
  assert.equal(r.status, 201); const row = await r.json(); assert.equal(row.name, 'Tom'); assert.equal(row.notes, 'Status: Said hi\nhi');
  const sent = JSON.parse(calls.at(-1).init.body); assert.deepEqual(Object.keys(sent.properties).sort(), ['Contact', 'Met at', 'Name', 'Notes']);
});
test('POST validation', async () => {
  assert.equal((await req('POST', '/people', { body: { contact: 'x' } })).status, 400);
  assert.equal((await req('POST', '/people', { body: { name: 5 } })).status, 400);
  const r = await handle(new Request('https://w.example/people', { method: 'POST', headers: { 'X-App-Key': 'good-key', Origin: ORIGIN }, body: '{oops' }), env); assert.equal(r.status, 400);
});
test('PATCH updates a row in this database, refuses others', async () => {
  const ok = await req('PATCH', '/people/11111111-1111-1111-1111-111111111111', { body: { notes: 'Status: Got contact' } });
  assert.equal(ok.status, 200); const row = await ok.json(); assert.equal(row.notes, 'Status: Got contact'); assert.equal(row.name, 'Sarah'); assert.equal(row.lastEdited, '2026-11-03T12:00:00.000Z');
  assert.equal((await req('PATCH', '/people/22222222222222222222222222222222', { body: { notes: 'x' } })).status, 404, 'page outside the database');
  assert.equal((await req('PATCH', '/people/../../users', { body: { notes: 'x' } })).status, 404);
  assert.equal((await req('PATCH', '/people/not-an-id', { body: { notes: 'x' } })).status, 400);
  assert.equal((await req('PATCH', '/people/33333333333333333333333333333333', { body: { notes: 'x' } })).status, 404);
});
test('retries politely on Notion 429', async () => {
  failNext = 429; const r = await req('GET', '/people'); assert.equal(r.status, 200); assert.equal(calls.length, 2);
});
test('unknown routes and methods', async () => {
  assert.equal((await req('GET', '/admin')).status, 404); assert.equal((await req('PUT', '/people/11111111111111111111111111111111')).status, 405);
});
test('property helpers', () => {
  assert.equal(richText('x'.repeat(4100)).length, 3); assert.deepEqual(richText(''), []);
  assert.deepEqual(Object.keys(rowToProperties({ notes: 'a' })), ['Notes']);
  assert.equal(validateRow({ name: 'a' }, { partial: false }), null); assert.ok(validateRow([], { partial: true }));
  assert.ok(isPageId('11111111-1111-1111-1111-111111111111')); assert.ok(!isPageId('abc'));
  const row = pageToRow(mkPage('11111111-1111-1111-1111-111111111111', { name: 'A', notes: 'n' })); assert.equal(row.created, '2026-11-03T11:00:00.000Z');
});
