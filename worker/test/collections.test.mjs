import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, _t } from '../src/index.js';
import { toProps, fromPage, validate, parseDetails } from '../src/collections.js';
_t.sleep = async () => {}; _t.gap = 0;
const BIZ = '8bcbc8b95b904964bb3a937ed1194daf';
const env = { NOTION_TOKEN: 'ntn_test', APP_KEY: 'k', DATA_SOURCE_ID: 'people', ATLAS_DS: BIZ, ALLOWED_ORIGINS: 'https://mhccog.github.io' };

// echo Notion: turns written properties into read-shaped properties
const read = props => Object.fromEntries(Object.entries(props).map(([k, v]) => { const t = Object.keys(v)[0]; const val = v[t]; return [k, { type: t, [t]: Array.isArray(val) && (t === 'title' || t === 'rich_text') ? val.map(x => ({ plain_text: x.text.content })) : val }]; }));

test('typed mapping round-trips every field type', () => {
  const row = { name: 'Hungerford Arcade', cat: 'Antiques', town: 'Hungerford', web: 'https://x.example/', phone: '01488 683701', la: 51.41449, lo: -1.51602, approx: false, founder: true, potential: 5, persona: 'Clocks, jewels', appId: 'hungerford-arcade', archived: false };
  const props = toProps('businesses', row);
  assert.equal(props.Trade.rich_text[0].text.content, 'Antiques'); assert.equal(props.Town.select.name, 'Hungerford'); assert.equal(props.Type.select.name, 'Business'); assert.equal(parseDetails(props.Details.rich_text.map(x => x.text.content).join('')).Approach, 'Clocks, jewels');
  assert.equal(props.Latitude, undefined, 'rare fields live in Details');
  const back = fromPage('businesses', { id: 'p1', last_edited_time: 't', properties: read(props) });
  assert.equal(back.la, 51.41449); assert.equal(back.founder, true); assert.equal(back.approx, false); assert.equal(back.web, 'https://x.example/'); assert.equal(back.appId, 'hungerford-arcade');
  const ip = toProps('introductions', { a: '11111111111111111111111111111111', b: '', at: '2026-11-03', state: 'Made', outcome: 'They met' });
  assert.deepEqual(ip.From.relation, [{ id: '11111111111111111111111111111111' }]); assert.deepEqual(ip.To.relation, []); assert.equal(ip.Type.select.name, 'Introduction'); assert.match(ip.Details.rich_text[0].text.content, /Status date: 2026-11-03/);
  const multi = toProps('businesses', { askNote: 'line one\nline two \\ x', potential: 0 });
  assert.equal(fromPage('businesses', { id: 'p', properties: read(multi) }).askNote, 'line one\nline two \\ x'); assert.equal(fromPage('businesses', { id: 'p', properties: read(multi) }).potential, 0);
  const lp = toProps('lists', { name: 'Lewes', kind: 'Town', details: 'Key: lewes' }); assert.equal(lp.Type.select.name, 'Town');
  assert.equal(toProps('lists', { kind: 'Nonsense' }).Type.select.name, 'App text');
  assert.equal(validate('introductions', { a: 'not-an-id' }), 'a must be a Notion page id');
  assert.equal(validate('businesses', { la: 'abc' }), 'la must be a number');
  assert.equal(validate('businesses', { evil: 1 }), 'Nothing to write');
});

test('collection routes: list, create, patch, delete archives (never trashes), other databases refused', async () => {
  const pages = new Map(); const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const path = String(u).replace('https://api.notion.com/v1', ''); const body = init.body ? JSON.parse(init.body) : null; calls.push([init.method, path, body]);
    if (init.method === 'POST' && path === `/data_sources/${BIZ}/query`) { const want = body.filter.select ? [body.filter.select.equals] : body.filter.or.map(f => f.select.equals); return Response.json({ results: [...pages.values()].filter(p => p.properties.Type && want.includes(p.properties.Type.select.name)), has_more: false }); }
    if (init.method === 'POST' && path === '/pages') { const id = 'aaaaaaaa-aaaa-aaaa-aaaa-00000000000' + pages.size; const p = { object: 'page', id, last_edited_time: 'e', parent: { type: 'data_source_id', data_source_id: body.parent.data_source_id }, properties: read(body.properties) }; pages.set(id, p); return Response.json(p); }
    const m = path.match(/^\/pages\/(.+)$/); const p = m && pages.get(m[1]);
    if (!p) return Response.json({ code: 'object_not_found', message: 'no' }, { status: 404 });
    if (init.method === 'GET') return Response.json(p);
    Object.assign(p.properties, read(body.properties || {})); if (body.in_trash) p.in_trash = true; return Response.json(p);
  };
  const rq = (method, path, body) => handle(new Request('https://w' + path, { method, headers: { 'X-App-Key': 'k', Origin: 'https://mhccog.github.io', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  const c = await rq('POST', '/c/businesses', { name: 'Test shop', town: 'Lewes', la: 50.87, appId: 't1' }); assert.equal(c.status, 201); const row = await c.json();
  assert.equal(row.name, 'Test shop'); assert.equal(row.la, 50.87);
  const l = await (await rq('GET', '/c/businesses')).json(); assert.equal(l.results.length, 1); assert.equal(l.results[0].appId, 't1');
  const pa = await (await rq('PATCH', '/c/businesses/' + row.id, { need: 'Help' })).json(); assert.equal(pa.need, 'Help'); assert.equal(pa.la, 50.87, 'a partial PATCH keeps the other Details lines');
  assert.equal((await (await rq('GET', '/c/introductions')).json()).results.length, 0, 'businesses are not introductions');
  assert.equal((await rq('PATCH', '/c/introductions/' + row.id, { why: 'x' })).status, 404, 'a business row cannot be edited as an introduction');
  const d = await (await rq('DELETE', '/c/businesses/' + row.id)).json(); assert.equal(d.archived, true);
  assert.ok(!calls.some(x => x[2] && x[2].in_trash), 'a business is archived, not trashed');
  // a page from another database can't be touched through /c/businesses
  pages.set('bbbbbbbb-bbbb-bbbb-bbbb-000000000000', { object: 'page', id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000000', parent: { type: 'data_source_id', data_source_id: 'people' }, properties: {} });
  assert.equal((await rq('PATCH', '/c/businesses/bbbbbbbb-bbbb-bbbb-bbbb-000000000000', { name: 'x' })).status, 404);
  assert.equal((await rq('GET', '/c/nope')).status, 404);
  assert.equal((await handle(new Request('https://w/c/businesses', { headers: { 'X-App-Key': 'bad' } }), env)).status, 401);
  // people delete goes to Trash, only for the People data source
  pages.set('cccccccc-cccc-cccc-cccc-000000000000', { object: 'page', id: 'cccccccc-cccc-cccc-cccc-000000000000', parent: { type: 'data_source_id', data_source_id: 'people' }, properties: {} });
  const pd = await rq('DELETE', '/people/cccccccc-cccc-cccc-cccc-000000000000'); assert.equal(pd.status, 200); assert.equal(pages.get('cccccccc-cccc-cccc-cccc-000000000000').in_trash, true);
  assert.equal((await rq('DELETE', '/people/' + row.id)).status, 404, 'a business row cannot be trashed through /people');
});
