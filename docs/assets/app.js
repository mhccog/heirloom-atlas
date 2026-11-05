/* The Heirloom Atlas: people-first networking atlas. All personal data stays in this browser (localStorage). */
(() => {
'use strict';
const KEY = 'heirloom-atlas/v1';
const STAGES = ['Not visited', 'Said hi', 'Got contact', 'Returning', 'Connected'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const km = (a, b) => { const R = 6371, d = Math.PI / 180; const x = Math.sin((b.la - a.la) * d / 2) ** 2 + Math.cos(a.la * d) * Math.cos(b.la * d) * Math.sin((b.lo - a.lo) * d / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

let D0;             // research data (data.json), never changed
let D;              // what the app shows: research + your edits (Content.view)
let SEED;           // research as flat records, per collection
let S;              // saved state
let BIZ = [], BY = {}, INTROS = [];
let editing = false, CV = 0, graphCV = -1;
const C = window.Content;
const ic = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="assets/icons.svg#i-${n}"/></svg>`;
const F = { q: '', town: 'all', stage: 'all', cats: new Set() };
let layout = 'graph', tab = 'people', focusId = null, visitTown = null, graph = null, map = null, mapReady = false, globeOn = false;

/* ---------------- state ---------------- */
function blank() { return { v: 1, people: {}, ed: { biz: {}, intro: {}, list: {} }, undo: [], checks: {}, prefs: {} }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return migrate(Object.assign(blank(), s)); } catch (e) { /* ignore */ }
  return blank();
}
// Older saves kept walk-ins, your introductions and intro statuses in separate lists. Fold them into the edit layer once.
function migrate(st) {
  st.ed = Object.assign({ biz: {}, intro: {}, list: {} }, st.ed || {}); st.undo = st.undo || [];
  for (const b of st.myBiz || []) if (!st.ed.biz[b.id]) st.ed.biz[b.id] = { isNew: true, f: Object.assign({ custom: true, potential: 1, persona: 'dealer', askWho: b.askWho || '', opener: '' }, b), updated: Date.parse(b.added || '') || Date.now() };
  for (const i of st.myIntros || []) if (!st.ed.intro[i.id]) st.ed.intro[i.id] = { isNew: true, f: Object.assign({ strength: 2, kind: 'Yours', km: null, outcome: '', outcomeNote: '' }, i, { mine: true, state: i.state || 'open' }), updated: Date.now() };
  for (const [id, v] of Object.entries(st.intros || {})) if (!st.ed.intro[id]) st.ed.intro[id] = { f: { state: v.state, at: v.at || '' }, updated: Date.parse(v.at || '') || Date.now() };
  delete st.myBiz; delete st.myIntros; delete st.intros;
  return st;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this device (storage full or private mode).'); } }
const P = id => S.people[id] || { stage: 0, notes: '', met: '', contact: '', last: '', next: '', log: [] };
const SYNCED = ['stage', 'notes', 'met', 'contact', 'last', 'next'];
// Every change to a field that syncs with Notion gets a local timestamp (for "newest edit wins") and schedules a sync.
function setP(id, patch) {
  const before = P(id); const touched = SYNCED.some(k => k in patch && String(patch[k] ?? '') !== String(before[k] ?? ''));
  S.people[id] = Object.assign({}, before, patch, touched ? { updated: Date.now() } : {}); save();
  if (touched) Sync.schedule();
}

function rebuild() {
  D = C.view(D0, S); CV++;
  BIZ = D.biz; BY = Object.fromEntries(BIZ.map(b => [b.id, b]));
  INTROS = D.intros.filter(i => BY[i.a] && BY[i.b] && i.a !== i.b);
}
const introState = i => i.state || 'open';
const town = id => D.towns.find(t => t.id === id) || { id, name: id || '—', la: 51.5, lo: -1 };
const cat = c => D.cats.find(x => x.id === +c) || { id: c, name: 'Other', ink: '#8a7a61' };

/* ---------------- edits: one record at a time, with undo ---------------- */
const eff = (coll, id) => { const e = S.ed[coll][id]; const sd = SEED[coll][id]; if (!sd && !(e && e.f)) return null; return Object.assign({}, sd || {}, (e && e.f) || {}, { id }); };
const snap = e => e ? JSON.parse(JSON.stringify({ f: e.f, isNew: e.isNew, del: e.del })) : null;
function remember(coll, id, label) { S.undo = (S.undo || []).concat([{ coll, id, prev: snap(S.ed[coll][id]), label }]).slice(-30); }
function commit(msg) { save(); rebuild(); afterChange(); renderEditBar(); Sync.schedule(); if (msg) toast(msg); }
function editRec(coll, id, patch, label) {
  const cur = eff(coll, id); if (!cur) return; remember(coll, id, label || 'edit');
  const next = Object.assign(cur, patch); const e = S.ed[coll][id] = Object.assign({}, S.ed[coll][id]);
  e.f = SEED[coll][id] ? C.diff(SEED[coll][id], next) : Object.assign({}, next); e.del = false; e.delSynced = false; e.updated = Date.now();
}
function addRec(coll, rec, label) {
  remember(coll, rec.id, label || 'add'); S.ed[coll][rec.id] = { isNew: true, f: Object.assign({}, rec), updated: Date.now() };
}
function delRec(coll, id, label) {
  if (!eff(coll, id)) return; remember(coll, id, label || 'delete');
  const e = S.ed[coll][id] = Object.assign({}, S.ed[coll][id]); e.del = true; e.delSynced = false; e.updated = Date.now();
}
function resetRec(coll, id) {
  if (!SEED[coll][id]) return; remember(coll, id, 'reset');
  const e = S.ed[coll][id] = Object.assign({}, S.ed[coll][id]); e.f = {}; e.del = false; e.delSynced = false; e.updated = Date.now();
}
function undo() {
  const u = (S.undo || []).pop(); if (!u) { toast('Nothing to undo'); return; }
  const e = S.ed[u.coll][u.id] = Object.assign({}, S.ed[u.coll][u.id]);
  if (u.prev) { e.f = u.prev.f; e.isNew = u.prev.isNew; e.del = !!u.prev.del; }
  else if (SEED[u.coll][u.id]) { e.f = {}; e.del = false; } else { e.del = true; }
  e.delSynced = false; e.updated = Date.now();
  commit('Undone: ' + u.label);
  if (focusId && $('#sheet').classList.contains('open')) { if (BY[focusId]) openCard(focusId); else closeCard(); }
}
const newId = (prefix, name) => prefix + '-' + (C.slug(name).slice(0, 24) || 'item') + '-' + Date.now().toString(36);
const partners = id => INTROS.filter(i => (i.a === id || i.b === id) && introState(i) !== 'declined').map(i => ({ intro: i, other: BY[i.a === id ? i.b : i.a] }));

/* ---------------- toast ---------------- */
// Every delete asks first. A small modal: names the item, Cancel (focused) and Delete. Esc or Cancel keeps it; Enter presses the focused button.
function askDelete({ title, body = '', ok = 'Delete' }) {
  return new Promise(resolve => {
    let d = $('#confirm-dlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'confirm-dlg'; d.className = 'confirm'; d.setAttribute('aria-labelledby', 'cf-title'); d.setAttribute('aria-describedby', 'cf-body'); document.body.appendChild(d); }
    d.innerHTML = `<div class="dlg"><p class="cf-k">Confirm</p><h3 id="cf-title">${esc(title)}</h3>${body ? `<p id="cf-body" class="muted">${esc(body)}</p>` : '<p id="cf-body" hidden></p>'}
      <div class="acts"><button class="btn" type="button" data-cf="no">Cancel</button><button class="btn primary warn" type="button" data-cf="yes">${esc(ok)}</button></div></div>`;
    let done = false; const finish = v => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    d.onclick = e => { const b = e.target.closest('[data-cf]'); if (b) finish(b.dataset.cf === 'yes'); else if (e.target === d) finish(false); };
    d.oncancel = e => { e.preventDefault(); finish(false); };
    d.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } else if (e.key === 'Enter') { const b = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-cf]'); e.preventDefault(); finish(!!b && b.dataset.cf === 'yes'); } };
    d.showModal(); $('[data-cf="no"]', d).focus();
  });
}
let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------------- filters ---------------- */
function matches(b) {
  if (F.town !== 'all' && b.town !== F.town) return false;
  if (F.cats.size && !F.cats.has(b.cat)) return false;
  const p = P(b.id);
  if (F.stage === 'due') { if (!(p.next && p.next <= addDays(todayISO(), 7))) return false; }
  else if (F.stage !== 'all' && String(p.stage) !== F.stage) return false;
  if (F.q) {
    const hay = [b.name, b.type, town(b.town).name, b.need, b.offers, b.why, cat(b.cat).name, p.notes, p.met, p.contact, b.addr].join(' ').toLowerCase();
    if (!F.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function filtersActive() { return F.q || F.town !== 'all' || F.stage !== 'all' || F.cats.size; }

function filterOptions() {
  $('#f-town').innerHTML = `<option value="all">All ${D.towns.length} towns</option>` + D.towns.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  $('#f-town').value = D.towns.some(t => t.id === F.town) ? F.town : 'all';
  $('#f-stage').innerHTML = `<option value="all">Any status</option>` + STAGES.map((s, i) => `<option value="${i}">${s}</option>`).join('') + `<option value="due">Visit due this week</option>`;
  $('#f-stage').value = F.stage;
  $('#f-cats').innerHTML = D.cats.map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${!F.cats.size || F.cats.has(c.id)}"><i style="background:${c.ink}"></i>${esc(c.name)}</button>`).join('');
  $('#graph-legend').innerHTML = `<span><i class="ln"></i>Suggested introduction</span><span><i class="ln g"></i>Made</span>`;
  const tl = $('.line'); if (tl) tl.textContent = D.tagline;
}
function buildFilters() {
  filterOptions();
  $('#q').addEventListener('input', e => { F.q = e.target.value.trim(); refreshPeople(); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { const m = BIZ.filter(matches); if (m.length) openCard(m[0].id); } });
  $('#f-town').addEventListener('change', e => { F.town = e.target.value; refreshPeople(); if (graph && F.town !== 'all') setTimeout(() => graph.zoomToFit(600, 60, n => n.town === F.town), 50); });
  $('#f-stage').addEventListener('change', e => { F.stage = e.target.value; refreshPeople(); renderDash(); });
  $('#f-cats').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return; const c = +b.dataset.cat;
    if (!F.cats.size) { F.cats = new Set([c]); } else if (F.cats.has(c)) { F.cats.delete(c); } else F.cats.add(c);
    if (F.cats.size === D.cats.length) F.cats.clear();
    $$('.chip', $('#f-cats')).forEach(x => x.setAttribute('aria-pressed', !F.cats.size || F.cats.has(+x.dataset.cat)));
    refreshPeople();
  });
  $$('.seg [data-layout]').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.layout)));
}
function setLayout(l) {
  layout = l; S.prefs.layout = l; save();
  $$('.seg [data-layout]').forEach(b => b.setAttribute('aria-pressed', b.dataset.layout === l));
  $('#graph').hidden = l !== 'graph'; $('#graph-hint').hidden = l !== 'graph'; $('#graph-legend').hidden = l !== 'graph'; $('#list').hidden = l !== 'list';
  if (l === 'graph') initGraph(); else renderList();
}
function refreshPeople() { if (layout === 'list') renderList(); if (graph) graph.nodeColor(graph.nodeColor()); /* trigger redraw */ if (graph) kick(); }
function kick() { if (graph) { const z = graph.zoom(); graph.zoom(z * 1.0001); } }

/* ---------------- home: one next step, and the week so far ---------------- */
// Weekly, not daily: a quiet count of introductions made and visits this week. No streaks to break.
function weekCounts(wk) {
  const intros = INTROS.filter(i => introState(i) === 'made' && i.at && C.weekKey(i.at) === wk).length;
  let visits = 0; for (const b of BIZ) visits += ((P(b.id).log || []).filter(l => l.visit && C.weekKey(l.date) === wk)).length;
  return { intros, visits };
}
function nextStep() {
  const t = todayISO(); const day = Math.floor(Date.parse(t) / 864e5);
  const nm = id => esc(BY[id].name);
  // 1. close the loop on an introduction you made
  const waiting = INTROS.filter(i => introState(i) === 'made' && !i.outcome && i.at && i.at <= addDays(t, -2)).sort((a, b) => a.at.localeCompare(b.at));
  if (waiting.length) { const i = waiting[0]; return { k: 'Follow up', q: `Did ${nm(i.a)} and ${nm(i.b)} get anywhere?`, btn: 'Log what happened', act: `outcome:${i.id}` }; }
  // 2. two people you already know who should meet
  const known = INTROS.filter(i => introState(i) === 'open' && P(i.a).stage >= 2 && P(i.b).stage >= 2).sort((a, b) => b.strength - a.strength);
  if (known.length) { const i = known[day % known.length]; return { k: 'Introduce', q: `You know ${nm(i.a)} and ${nm(i.b)}. They'd get on.`, btn: 'Mark it made', act: `made:${i.id}` }; }
  // 3. one honest question for the next town you're in
  const ev = D.events.find(e => (e.end || e.date) >= t);
  const tid = (ev && ev.town) || S.prefs.visitTown || (D.towns[0] || {}).id;
  const open = INTROS.filter(i => introState(i) === 'open' && (BY[i.a].town === tid || BY[i.b].town === tid)).sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
  if (open.length) { const i = open[day % Math.min(open.length, 6)]; return { k: town(tid).name, q: `Who in ${esc(town(tid).name)} should meet ${nm(i.a)}? Maybe ${nm(i.b)}.`, btn: 'See why', act: `open:${i.a}` }; }
  return { k: 'Today', q: 'Who did you meet today?', btn: 'Add them', act: 'walkin' };
}
function renderDash() {
  const n = nextStep(); const wk = C.weekKey(todayISO()); const w = weekCounts(wk); const lw = weekCounts(C.weekKey(addDays(wk, -7)));
  const week = w.intros || w.visits
    ? `This week: ${w.intros} introduction${w.intros === 1 ? '' : 's'} made, ${w.visits} visit${w.visits === 1 ? '' : 's'}.`
    : `Nothing logged this week yet.${lw.intros || lw.visits ? ` Last week: ${lw.intros} made, ${lw.visits} visits.` : ''}`;
  $('#dash').innerHTML = `<div class="next"><span class="label">${esc(n.k)}</span><p class="next-q">${n.q}</p><button class="btn primary small" type="button" data-next="${esc(n.act)}">${esc(n.btn)}${ic('arrow-right')}</button></div><p class="week">${esc(week)}</p>`;
}
function dashClick(e) {
  const b = e.target.closest('[data-next]'); if (!b) return;
  const [a, id] = b.dataset.next.split(/:(.*)/);
  if (a === 'walkin') return walkinDialog();
  if (a === 'open') return openCard(id);
  if (a === 'made') return markIntro(id, 'made');
  if (a === 'outcome') { introFilter = 'made'; go('intros'); setTimeout(() => { const el = document.querySelector(`[data-outcome="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 50); }
}

/* ---------------- tabs ---------------- */
function go(t) {
  tab = t; $$('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + t);
  if (history.replaceState) history.replaceState(null, '', '#' + t + (focusId ? '/' + focusId : ''));
  if (t === 'people') { if (layout === 'graph') initGraph(); else renderList(); }
  if (t === 'intros') renderIntros();
  if (t === 'visits') renderVisits();
  if (t === 'where') initMap();
  window.scrollTo({ top: 0 });
}

/* ---------------- graph (force-graph) ---------------- */
// A schematic of southern England: each town sits roughly where it is, spaced so names never collide.
const ANCHOR = { bicester: [10, -175], tetbury: [-215, -95], henley: [35, -55], hungerford: [-125, 25], cobham: [150, 40], petworth: [-15, 175], lewes: [170, 185] };
function anchors() {
  const A = {}; for (const t of D.towns) { const a = ANCHOR[t.id] || [(t.lo + 0.95) * 160, -(t.la - 51.4) * 260]; A[t.id] = { x: a[0], y: a[1] }; }
  return A;
}
function initGraph() {
  const el = $('#graph');
  if (graph) { sizeGraph(); syncGraphData(); return; }
  if (!window.ForceGraph) { el.innerHTML = `<div class="empty" style="margin:40px"><h4>The web view didn't load</h4>Use the List layout instead.</div>`; return; }
  const A = anchors();
  graph = new ForceGraph(el)
    .backgroundColor('rgba(0,0,0,0)')
    .nodeId('id').nodeLabel(() => '')
    .nodeRelSize(1)
    .nodeVal(n => radius(n) ** 2)
    .linkSource('a').linkTarget('b')
    .linkColor(l => linkColor(l)).linkWidth(l => linkWidth(l))
    .linkLineDash(l => l.mine && introState(l) === 'open' ? [3, 3] : null)
    .nodeCanvasObject(drawNode).nodeCanvasObjectMode(() => 'replace')
    .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(radius(n) + 4, 9), 0, 2 * Math.PI); ctx.fill(); })
    .onRenderFramePre(drawTowns)
    .onNodeClick(n => { openCard(n.id); })
    .onNodeHover(n => { el.style.cursor = n ? 'pointer' : 'grab'; hoverId = n ? n.id : null; })
    .onBackgroundClick(() => { closeCard(); })
    .cooldownTicks(160).d3VelocityDecay(0.35).warmupTicks(60)
    .minZoom(0.4).maxZoom(9);
  graph.d3Force('charge').strength(-75).distanceMax(200);
  graph.d3Force('link').distance(l => (BY[l.a?.id || l.a]?.town === BY[l.b?.id || l.b]?.town) ? 50 : 130).strength(l => (BY[l.a?.id || l.a]?.town === BY[l.b?.id || l.b]?.town) ? 0.25 : 0.015);
  graph.d3Force('center', null);
  let nodes = [];
  const pull = alpha => { for (const n of nodes) { const a = A[n.town]; if (!a) continue; n.vx += (a.x - n.x) * 0.06 * alpha; n.vy += (a.y - n.y) * 0.06 * alpha; } };
  pull.initialize = ns => { nodes = ns; };
  graph.d3Force('town', pull);
  const coll = alpha => { for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; const m = radius(a) + radius(b) + 14; if (d < m) { const f = (m - d) / d * 0.5; a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f; } } };
  coll.initialize = ns => { nodes = ns; };
  graph.d3Force('collide', coll);
  syncGraphData(true);
  sizeGraph();
  new ResizeObserver(sizeGraph).observe(el);
  let fitted = false; graph.onEngineStop(() => { if (!fitted) { fitted = true; graph.zoomToFit(600, innerWidth < 720 ? 44 : 70); } });
  setTimeout(() => { if (!fitted) graph.zoomToFit(600, 40); }, 2500);
  const z = document.createElement('div'); z.className = 'zoomctl';
  z.innerHTML = `<button type="button" aria-label="Zoom in">${ic('plus')}</button><button type="button" aria-label="Zoom out">${ic('minus')}</button><button type="button" aria-label="Fit all">${ic('maximize')}</button>`;
  el.appendChild(z);
  const [zi, zo, zf] = $$('button', z);
  zi.onclick = () => graph.zoom(graph.zoom() * 1.4, 300); zo.onclick = () => graph.zoom(graph.zoom() / 1.4, 300); zf.onclick = () => graph.zoomToFit(500, 40);
}
let hoverId = null;
function syncGraphData(first) {
  const A = anchors();
  const old = graph.graphData(); const pos = Object.fromEntries((old.nodes || []).map(n => [n.id, n]));
  const nodes = BIZ.map(b => { const o = pos[b.id]; const a = A[b.town] || { x: 0, y: 0 }; return Object.assign(b, o ? { x: o.x, y: o.y } : { x: a.x + (Math.random() - .5) * 40, y: a.y + (Math.random() - .5) * 40 }); });
  const links = INTROS.filter(i => introState(i) !== 'declined').map(i => ({ ...i, a: i.a, b: i.b }));
  if (first || graphCV !== CV) { graphCV = CV; graph.graphData({ nodes, links }); }
}
function sizeGraph() { if (!graph) return; const el = $('#graph'); graph.width(el.clientWidth).height(el.clientHeight); }
const radius = n => 4.5 + Math.sqrt(n.potential || 1) * 1.9;
function isLit(n) {
  if (focusId) { if (n.id === focusId) return true; return INTROS.some(i => introState(i) !== 'declined' && ((i.a === focusId && i.b === n.id) || (i.b === focusId && i.a === n.id))); }
  return matches(n);
}
function linkEnds(l) { return [l.a?.id || l.a, l.b?.id || l.b]; }
function linkColor(l) {
  const [a, b] = linkEnds(l); const st = introState(l);
  if (focusId) { if (a === focusId || b === focusId) return st === 'made' ? '#94733a' : 'rgba(148,115,58,.85)'; return 'rgba(31,27,22,.05)'; }
  if (filtersActive() && !(matches(BY[a]) && matches(BY[b]))) return 'rgba(31,27,22,.04)';
  return st === 'made' ? '#94733a' : `rgba(31,27,22,${0.1 + 0.06 * (l.strength || 1)})`;
}
function linkWidth(l) { const [a, b] = linkEnds(l); const st = introState(l); return (st === 'made' ? 2.6 : 0.6 + 0.35 * (l.strength || 1)) + (focusId && (a === focusId || b === focusId) ? 1.2 : 0); }
function drawNode(n, ctx, k) {
  const lit = isLit(n); const r = radius(n); const st = P(n.id).stage;
  ctx.globalAlpha = lit ? 1 : 0.14;
  if (st > 0) { ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.2 + st * 0.6, 0, 2 * Math.PI); ctx.strokeStyle = st === 4 ? '#94733a' : 'rgba(148,115,58,.75)'; ctx.lineWidth = st === 4 ? 2.4 : 1.2; ctx.stroke(); if (st === 4) { ctx.fillStyle = 'rgba(241,229,196,.7)'; ctx.fill(); } }
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fillStyle = cat(n.cat).ink; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#faf7f0'; ctx.stroke();
  if (n.founder) { ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.32, 0, 2 * Math.PI); ctx.fillStyle = '#faf7f0'; ctx.fill(); }
  if (n.custom) { ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI); ctx.strokeStyle = '#1f1b16'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
  const show = n.id === focusId || n.id === hoverId || (focusId && lit) || k > 2.1 || (!focusId && filtersActive() && lit && BIZ.filter(matches).length <= 12) || (k > 1.25 && (n.potential || 0) >= 9);
  if (show) {
    const fs = (n.id === focusId ? 13 : 11.5) / k; ctx.font = `${n.id === focusId ? 600 : 500} ${fs}px 'Source Sans 3', system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const label = n.name.length > 30 ? n.name.slice(0, 28) + '…' : n.name;
    ctx.lineWidth = 3.2 / k; ctx.strokeStyle = 'rgba(244,239,228,.95)'; ctx.strokeText(label, n.x, n.y + r + 3 / k);
    ctx.fillStyle = '#1f1b16'; ctx.fillText(label, n.x, n.y + r + 3 / k);
  }
  ctx.globalAlpha = 1;
}
function drawTowns(ctx, k) {
  const g = {}; for (const n of BIZ) { if (n.x == null) continue; (g[n.town] = g[n.town] || []).push(n); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  for (const [t, ns] of Object.entries(g)) {
    const xs = ns.map(n => n.x), ys = ns.map(n => n.y); const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const top = Math.min(...ys) - 16 / k;
    const dim = (F.town !== 'all' && F.town !== t) || (focusId && BY[focusId] && BY[focusId].town !== t && !ns.some(isLit));
    ctx.globalAlpha = dim ? 0.25 : 0.9;
    ctx.font = `italic 400 ${16 / k}px Newsreader, Georgia, serif`; ctx.fillStyle = '#8a7a61';
    ctx.fillText(town(t).name, cx, top);
    ctx.beginPath(); ctx.moveTo(cx - 18 / k, top + 3 / k); ctx.lineTo(cx + 18 / k, top + 3 / k); ctx.strokeStyle = 'rgba(148,115,58,.5)'; ctx.lineWidth = 1 / k; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function focusGraph(id) {
  if (!graph) return; const n = BIZ.find(b => b.id === id); if (!n || n.x == null) return;
  const z = Math.max(graph.zoom(), 2.2); const mob = innerWidth < 720;
  // keep the focused person visible beside the card (desktop) or above the sheet (phone)
  graph.centerAt(n.x + (mob ? 0 : 200 / z), n.y + (mob ? 150 / z : 0), 600); if (graph.zoom() < 2.2) graph.zoom(2.2, 600);
}

/* ---------------- list ---------------- */
function personCard(b, dimmed) {
  const p = P(b.id); const n = partners(b.id).length; const c = cat(b.cat);
  const nxt = p.next ? `<span>Next visit ${fmtDate(p.next)}${p.next <= todayISO() ? ' · due' : ''}</span>` : '';
  return `<button type="button" class="pcard ${dimmed ? 'dim' : ''}" data-open="${b.id}">
    <i class="dot" style="background:${c.ink}"></i>
    <div><h4>${esc(b.name)}</h4><div class="meta">${esc(b.type)}${b.custom ? ' · your walk-in' : ''}</div></div>
    <span class="stagepill"><i class="pip s${p.stage}"></i>${STAGES[p.stage]}</span>
    <div class="need">${b.need ? `<span class="muted">Need:</span> ${esc(b.need)}` : '<span class="muted">No need noted yet</span>'}</div>
    <div class="foot"><span>${n} possible intro${n === 1 ? '' : 's'}</span>${b.founder ? '<span>Watchlist</span>' : ''}${p.met ? `<span>Met: ${esc(p.met)}</span>` : ''}${nxt}</div>
  </button>`;
}
function renderList() {
  const el = $('#list'); const shown = BIZ.filter(matches);
  if (!shown.length) { el.innerHTML = `<div class="empty"><h4>Nobody matches</h4>Try another town, status or search. <div style="margin-top:12px"><button class="btn small" type="button" data-clear>Clear filters</button></div></div>`; return; }
  const tids = D.towns.map(t => t.id); const orphan = shown.filter(b => !tids.includes(b.town));
  const groups = D.towns.map(t => ({ t, items: shown.filter(b => b.town === t.id).sort((a, b) => (b.potential || 0) - (a.potential || 0)) })).concat(orphan.length ? [{ t: { name: 'No town', day: '' }, items: orphan }] : []).filter(g => g.items.length);
  el.innerHTML = groups.map(g => `<section class="town-group"><h3>${esc(g.t.name)} <small>${g.items.length} ${g.items.length === 1 ? 'business' : 'businesses'}${g.t.day ? ' · ' + esc(g.t.day) : ''}</small></h3><div class="cards">${g.items.map(b => personCard(b)).join('')}</div></section>`).join('');
}
function clearFilters() { F.q = ''; F.town = 'all'; F.stage = 'all'; F.cats.clear(); $('#q').value = ''; $('#f-town').value = 'all'; $('#f-stage').value = 'all'; $$('.chip', $('#f-cats')).forEach(x => x.setAttribute('aria-pressed', 'true')); refreshPeople(); renderDash(); }

/* ---------------- person card ---------------- */
function openCard(id) {
  const b = BY[id]; if (!b) return; focusId = id; const p = P(id); const c = cat(b.cat); const T = town(b.town);
  const per = D.personas[b.persona] || D.personas.dealer || { label: '', read: '', listen: '' };
  const ps = partners(id).sort((x, y) => (y.intro.strength || 0) - (x.intro.strength || 0));
  const evs = D.events.filter(e => e.at === id && (e.end || e.date) >= todayISO());
  const seeded = !!SEED.biz[id]; const edited = seeded && S.ed.biz[id] && S.ed.biz[id].f && Object.keys(S.ed.biz[id].f).length;
  const about = editing ? `<div class="sec"><h3>Business details</h3><div id="biz-form"></div></div>` : `
    <div class="sec"><h3>Ask for</h3><p><b>${esc(b.ask.who || '—')}</b></p>${b.ask.note ? `<p class="small muted">${esc(b.ask.note)}</p>` : b.custom ? '' : `<p class="small muted">A role, not a name: the source doesn't name a person here.</p>`}</div>
    <div class="sec"><h3>Their need <span class="guess">a guess</span></h3><p>${esc(b.need || '—')}</p>${b.offers ? `<p class="small"><span class="muted">They could offer:</span> ${esc(b.offers)}</p>` : ''}</div>
    <div class="sec"><h3>Could meet</h3>
      ${ps.length ? `<div class="meet">${ps.slice(0, 4).map(x => `<button type="button" data-open="${x.other.id}"><i style="background:${cat(x.other.cat).ink}"></i><b>${esc(x.other.name)}${introState(x.intro) === 'made' ? ' · introduced' : ''}</b><span>${esc(x.intro.why)}${x.intro.km > 3 ? ` (${x.intro.km} km apart)` : ''}</span></button>`).join('')}</div>${ps.length > 4 ? `<p class="small muted" style="margin-top:6px">${ps.length - 4} more on the Introductions tab.</p>` : ''}` : `<p class="muted small">No one suggested yet. Add one on the Introductions tab.</p>`}
    </div>
    ${b.opener || b.why || b.watch || (!b.custom && per.read) ? `<details class="acc quiet"><summary>Approach notes</summary>
      ${b.opener ? `<p class="quote">“Hi, I'm Cyrus. Not buying or selling today, just getting to know the people in town.”</p><p class="quote">“${esc(b.opener)}”</p>${b.openerNote ? `<p class="opnote">${esc(b.openerNote)}</p>` : ''}` : ''}
      ${!b.custom && per.read ? `<p><b>${esc(per.label)}.</b> ${esc(per.read)}</p><p class="small"><span class="muted">Listen for:</span> ${esc(per.listen)}</p>` : ''}
      ${b.why ? `<p class="small"><span class="muted">Why they matter:</span> ${esc(b.why)}</p>` : ''}
      ${b.watch ? `<p class="small"><span class="muted">Watchlist:</span> ${esc(b.watch.company)}, ${esc(b.watch.founded)}. ${esc(b.watch.directors)}. ${esc(b.watch.angle)}. A reason to ask their story, never an opener.</p>` : ''}
    </details>` : ''}`;
  $('#sheet-body').dataset.mode = 'card';
  $('#sheet-body').innerHTML = `
    <div class="card-head"><span class="ink-dot" style="background:${c.ink}"></span>
      <div><div class="label">${esc(c.name)} · ${esc(T.name)}</div><h2>${esc(b.name)}</h2><p>${esc(b.type)}${b.theme && !editing ? ` · ${esc(b.theme)}` : ''}</p></div></div>
    <div class="pipeline" role="group" aria-label="Status">${STAGES.map((s, i) => `<button type="button" data-stage="${i}" class="${i < p.stage ? 'done' : ''} ${i === p.stage ? 'cur' : ''}" aria-pressed="${i === p.stage}"><span class="pip"></span>${s}</button>`).join('')}</div>
    ${p.last ? `<p class="small muted" style="margin:6px 0 0">Last visit ${fmtDate(p.last)}${p.next ? ` · next ${fmtDate(p.next)}` : ''}</p>` : ''}
    ${about}
    ${evs.length ? `<div class="sec"><h3>Coming up here</h3>${evs.map(e => `<p class="small"><b>${esc(e.label)}</b> · ${esc(e.what)}</p>`).join('')}</div>` : ''}
    <div class="sec"><h3>Your notes</h3>
      <div class="note-box">
        <label class="field">Who you met (their real name, once they've told you)<input class="inp" id="n-met" value="${esc(p.met)}" placeholder="e.g. the owner" autocomplete="off"></label>
        <label class="field">Contact they gave you<input class="inp" id="n-contact" value="${esc(p.contact || '')}" placeholder="phone, email or handle" autocomplete="off"></label>
        <label class="field">Notes<textarea class="inp" id="n-notes" placeholder="What they need, one personal detail, what to try next">${esc(p.notes)}</textarea></label>
        <div class="row2"><label class="field">Last visit<input class="inp" type="date" id="n-last" value="${esc(p.last)}"></label><label class="field">Next visit<input class="inp" type="date" id="n-next" value="${esc(p.next)}"></label></div>
        <div class="row"><button class="btn small" type="button" id="n-today">${ic('check')}Visited today</button><button class="btn small ghost" type="button" data-plus="28">Back in 4 weeks</button>${p.next ? `<button class="btn small ghost" type="button" id="n-ics">${ic('calendar-plus')}Calendar</button>` : ''}</div>
      </div>
    </div>
    <div class="sec"><h3>Details</h3><dl class="kv">
      <dt>Address</dt><dd>${esc(b.addr || '—')} ${b.la ? `· <a href="https://www.openstreetmap.org/?mlat=${b.la}&mlon=${b.lo}#map=18/${b.la}/${b.lo}" target="_blank" rel="noopener">map</a>` : ''}${b.approx ? `<br><span class="small muted">Approximate pin.</span>` : ''}</dd>
      ${b.web ? `<dt>Website</dt><dd><a href="${esc(b.web)}" target="_blank" rel="noopener">${esc(b.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}
      ${b.phone ? `<dt>Shop phone</dt><dd>${esc(b.phone)}</dd>` : ''}
      <dt>Source</dt><dd class="small">${b.fromNotion ? `From your Notion “People I've Met”` : b.custom ? 'Added by you' : `Network towns research, 2 Nov 2026${edited ? ', edited by you' : ''}`}</dd>
      ${p.nid ? `<dt>Notion</dt><dd class="small"><a href="https://www.notion.so/${esc(String(p.nid).replace(/-/g, ''))}" target="_blank" rel="noopener">Open in People I've Met</a></dd>` : ''}
    </dl>
    ${editing ? `<div class="danger">
      ${seeded && edited ? `<button class="btn small ghost" type="button" id="n-reset">${ic('rotate-ccw')}Back to the research version</button>` : ''}
      ${NMhas(p) ? `<button class="btn small ghost" type="button" id="n-clear">${ic('trash-2')}Delete your notes on this person</button>` : ''}
      <button class="btn small ghost warn" type="button" id="n-del">${ic('trash-2')}Delete this business</button></div>` : ''}</div>`;
  const sh = $('#sheet'); sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = innerWidth >= 720;
  $('#sheet-body').scrollTop = 0;
  if (history.replaceState) history.replaceState(null, '', '#' + tab + '/' + id);
  wireCard(id);
  if (editing) mountForm($('#biz-form'), 'biz', id, { onDone: () => openCard(id) });
  if (tab === 'people' && layout === 'graph') { focusGraph(id); kick(); }
  if (tab === 'where' && mapReady) flyToBiz(b);
}
const NMhas = p => !!p && (p.stage > 0 || !!String(p.notes || '').trim() || !!String(p.met || '').trim() || !!String(p.contact || '').trim() || !!p.nid);
function wireCard(id) {
  const body = $('#sheet-body');
  $$('.pipeline button', body).forEach(btn => btn.onclick = () => setStage(id, +btn.dataset.stage));
  $('#n-met', body).onchange = e => { setP(id, { met: e.target.value.trim() }); toast('Saved'); };
  $('#n-contact', body).onchange = e => { setP(id, { contact: e.target.value.trim() }); toast('Saved'); };
  $('#n-notes', body).onchange = e => { setP(id, { notes: e.target.value }); toast('Saved'); };
  $('#n-last', body).onchange = e => { setP(id, { last: e.target.value }); renderDash(); };
  $('#n-next', body).onchange = e => { setP(id, { next: e.target.value }); renderDash(); openCard(id); };
  $('#n-today', body).onclick = () => { logVisit(id); openCard(id); toast('Visit logged for today'); };
  $$('[data-plus]', body).forEach(b => b.onclick = () => { setP(id, { next: addDays(P(id).last || todayISO(), +b.dataset.plus) }); renderDash(); openCard(id); toast('Next visit set'); });
  const ics = $('#n-ics', body); if (ics) ics.onclick = () => downloadICS(id);
  const rs = $('#n-reset', body); if (rs) rs.onclick = async () => { if (!await askDelete({ title: `Discard your edits to ${BY[id].name}?`, body: 'It goes back to the research version. You can undo this.', ok: 'Discard' })) return; resetRec('biz', id); commit('Back to the research version'); openCard(id); };
  const cl = $('#n-clear', body); if (cl) cl.onclick = () => deletePerson(id);
  const del = $('#n-del', body); if (del) del.onclick = async () => {
    const n = INTROS.filter(i => i.a === id || i.b === id).length;
    if (!await askDelete({ title: `Delete ${BY[id].name}?`, body: `${n ? `Its ${n} introduction${n === 1 ? '' : 's'} will be hidden too. ` : ''}In Notion the row is ticked Archived, not removed. You can undo this.` })) return;
    delRec('biz', id, 'delete ' + BY[id].name); closeCard(); commit('Deleted. Undo is in the edit bar.');
  };
}
// Clears what you've recorded about a person here, and moves their row in People I've Met to Notion's Trash (restorable there).
async function deletePerson(id) {
  const p = P(id); const b = BY[id];
  if (!await askDelete({ title: `Delete your notes on ${b.name}?`, body: `Your notes, status and contact go.${p.nid ? ' Their row in Notion “People I\'ve Met” goes to Notion\'s Trash, where you can restore it.' : ''}` })) return;
  if (p.nid) { S.peopleTrash = (S.peopleTrash || []).concat(p.nid); S.syncIgnore = (S.syncIgnore || []).concat(p.nid); }
  S.people[id] = { stage: 0, notes: '', met: '', contact: '', last: '', next: '', log: [], nGoneAt: Date.now() };
  save(); afterChange(); openCard(id); Sync.schedule(500); toast('Notes deleted');
}
function logVisit(id) { const p = P(id); const t = todayISO(); const log = (p.log || []).slice(); if (!log.some(l => l.date === t && l.visit)) log.push({ date: t, visit: true, stage: p.stage }); setP(id, { last: t, log, stage: Math.max(p.stage, 1), next: p.next && p.next > t ? p.next : '' }); renderDash(); kick(); }
function setStage(id, st) {
  const p = P(id); const log = (p.log || []).concat([{ date: todayISO(), stage: st }]);
  const patch = { stage: st, log }; if (st > 0 && !p.last) patch.last = todayISO();
  setP(id, patch); renderDash(); kick(); if (layout === 'list' && tab === 'people') renderList();
  if ($('#sheet').classList.contains('open') && focusId === id) openCard(id);
  if (tab === 'visits') renderVisits();
  toast(`${BY[id].name}: ${STAGES[st]}`);
}
function closeCard() {
  focusId = null; const sh = $('#sheet'); sh.classList.remove('open'); sh.setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; kick();
  if (history.replaceState) history.replaceState(null, '', '#' + tab);
  if (tab === 'people' && layout === 'list') renderList();
}
function downloadICS(id) {
  const b = BY[id]; const p = P(id); if (!p.next) return; const d = p.next.replace(/-/g, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Heirloom Atlas//EN', 'BEGIN:VEVENT', `UID:${id}-${d}@heirloom-atlas`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(p.next, 1).replace(/-/g, '')}`, `SUMMARY:Pop back in: ${b.name}`, `LOCATION:${(b.addr || '').replace(/,/g, '\\,')}`, `DESCRIPTION:${(b.opener || '').replace(/,/g, '\\,')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  dl(new Blob([ics], { type: 'text/calendar' }), `visit-${id}.ics`);
}
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

/* ---------------- introductions ---------------- */
let introFilter = 'open', introKind = 'all', introTown = 'all', introAll = false;
const OUT_SHORT = { 'No reply yet': 'no reply yet', 'Replied': 'replied', 'They met': 'they met', 'Did business': 'did business' };
function thread() {
  const made = INTROS.filter(i => introState(i) === 'made').sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  if (!made.length) return `<section class="thread"><h3 class="label">Your thread</h3><p class="muted small">Nothing introduced yet. The first one you make starts the thread here.</p></section>`;
  const n = k => made.filter(i => i.outcome === k).length;
  const sum = [['Replied', n('Replied')], ['They met', n('They met')], ['Did business', n('Did business')]].filter(x => x[1]).map(x => `${x[1]} ${OUT_SHORT[x[0]]}`).join(' · ');
  return `<section class="thread"><h3 class="label">Your thread <span>${made.length} made${sum ? ' · ' + sum : ''}</span></h3><ol>${made.map(i => `<li>
    <span class="t-date">${i.at ? esc(fmtDate(i.at)) : '—'}</span>
    <span class="t-pair"><button class="who" type="button" data-open="${i.a}">${esc(BY[i.a].name)}</button> <span class="arrow">${ic('arrow-left-right')}</span> <button class="who" type="button" data-open="${i.b}">${esc(BY[i.b].name)}</button></span>
    <label class="t-out"><span class="sr">What happened</span><select data-outcome="${esc(i.id)}"><option value="">What happened?</option>${C.OUTCOMES.map(o => `<option ${i.outcome === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    ${i.outcomeNote ? `<span class="t-note">${esc(i.outcomeNote)}</span>` : ''}</li>`).join('')}</ol></section>`;
}
function introCard(i) {
  const A = BY[i.a], B = BY[i.b], st = introState(i); const L = { 3: 'Strong', 2: 'Good', 1: 'Possible' };
  return `<article class="intro ${st}" data-iid="${esc(i.id)}">
    <div class="pair"><button class="who" type="button" data-open="${A.id}"><i style="background:${cat(A.cat).ink}"></i>${esc(A.name)}</button><span class="arrow" aria-label="could meet">${ic('arrow-left-right')}</span><button class="who" type="button" data-open="${B.id}"><i style="background:${cat(B.cat).ink}"></i>${esc(B.name)}</button></div>
    <p class="why">${esc(i.why)}</p>
    <div class="tags"><span>${L[i.strength]}</span><span>${esc(i.kind)}</span><span>${esc(town(A.town).name)}${A.town !== B.town ? ` · ${esc(town(B.town).name)}` : ''}${i.km > 3 ? ` · ${i.km} km` : ''}</span>${st !== 'open' ? `<span class="badge ${st}">${st === 'made' ? 'Made' : 'Not now'}${i.at ? ' · ' + esc(fmtDate(i.at)) : ''}</span>` : ''}${i.mine ? '<span>Yours</span>' : ''}</div>
    <div class="acts">${st === 'open' ? `<button class="btn small" type="button" data-mark="made" data-id="${esc(i.id)}">Mark made</button><button class="btn small ghost" type="button" data-mark="declined" data-id="${esc(i.id)}">Not now</button>` : `<button class="btn small ghost" type="button" data-mark="open" data-id="${esc(i.id)}">${ic('undo-2')}Back to consider</button>`}
      ${editing ? `<button class="btn small ghost edit-only" type="button" data-edit-intro="${esc(i.id)}">${ic('pencil')}Edit</button>` : ''}</div>
  </article>`;
}
function renderIntros() {
  const el = $('#view-intros');
  const counts = { open: 0, made: 0, declined: 0, all: INTROS.length };
  for (const i of INTROS) counts[introState(i)]++;
  const kinds = [...new Set(INTROS.map(i => i.kind).filter(Boolean))];
  let list = INTROS.filter(i => introFilter === 'all' || introState(i) === introFilter);
  if (introKind !== 'all') list = list.filter(i => i.kind === introKind);
  if (introTown !== 'all') list = list.filter(i => BY[i.a].town === introTown || BY[i.b].town === introTown);
  list.sort((x, y) => (y.mine - x.mine) || (y.strength - x.strength) || (x.km - y.km));
  const LIM = 8; const shown = introAll ? list : list.slice(0, LIM);
  el.innerHTML = `
    <div class="page-head"><div><h2>Introductions</h2>
      <p>Two people who'd get on. Ask each side privately first, and only introduce them if it helps both.</p></div>
      <button class="btn" type="button" id="add-intro">${ic('plus')}Add one</button></div>
    ${thread()}
    <div class="toolbar" style="margin:22px 0 12px">
      <div class="seg" role="group" aria-label="Show">${[['open', 'To consider'], ['made', 'Made'], ['declined', 'Not now'], ['all', 'All']].map(([k, l]) => `<button type="button" data-if="${k}" aria-pressed="${introFilter === k}">${l} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
      <label class="sel"><span class="sr">Kind</span><select id="if-kind"><option value="all">Every kind</option>${kinds.map(k => `<option ${introKind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">Town</span><select id="if-town"><option value="all">Any town</option>${D.towns.map(t => `<option value="${t.id}" ${introTown === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    </div>
    <div id="intro-list">${shown.length ? shown.map(introCard).join('') : `<div class="empty"><h4>Nothing here</h4>${introFilter === 'made' ? 'When you introduce two people, mark it made and it joins your thread.' : 'Add one when you spot two people who should know each other.'}</div>`}
    ${list.length > shown.length ? `<button class="btn ghost more" type="button" id="intro-more">Show all ${list.length}</button>` : ''}</div>`;
  $$('[data-if]', el).forEach(b => b.onclick = () => { introFilter = b.dataset.if; introAll = false; renderIntros(); });
  $('#if-kind').onchange = e => { introKind = e.target.value; renderIntros(); };
  $('#if-town').onchange = e => { introTown = e.target.value; renderIntros(); };
  $('#add-intro').onclick = () => introDialog();
  const more = $('#intro-more'); if (more) more.onclick = () => { introAll = true; renderIntros(); };
  $$('[data-outcome]', el).forEach(x => x.onchange = async () => {
    const id = x.dataset.outcome; const v = x.value; const was = (INTROS.find(i => i.id === id) || {}).outcome || '';
    if (!v && was) { const i = INTROS.find(y => y.id === id); if (!await askDelete({ title: `Clear the outcome “${was}”?`, body: i ? `${(BY[i.a] || {}).name || ''} and ${(BY[i.b] || {}).name || ''}` : '', ok: 'Clear' })) { x.value = was; return; } } editRec('intro', id, { outcome: v }, 'outcome');
    commit(v ? `Logged: ${OUT_SHORT[v]}` : 'Cleared');
    if (v && v !== 'No reply yet') setTimeout(() => { const note = prompt('A line on what happened? (optional)', (INTROS.find(i => i.id === id) || {}).outcomeNote || ''); if (note != null) { editRec('intro', id, { outcomeNote: note.trim() }, 'outcome note'); commit(); } }, 30);
  });
  $$('[data-edit-intro]', el).forEach(x => x.onclick = () => { const art = x.closest('.intro'); art.classList.add('editing-item'); art.innerHTML = '<div class="inline-form"></div>'; mountForm($('.inline-form', art), 'intro', x.dataset.editIntro, { onDone: renderIntros }); });
}
function markIntro(id, st) {
  if (!INTROS.find(x => x.id === id)) return;
  editRec('intro', id, { state: st, at: st === 'open' ? '' : todayISO() }, st === 'made' ? 'mark made' : st === 'declined' ? 'not now' : 'back to consider');
  commit(st === 'made' ? 'Introduction made. It\u2019s in your thread.' : st === 'declined' ? 'Set aside' : 'Back to consider');
}
function introDialog(preA) {
  const opts = BIZ.slice().sort((a, b) => a.name.localeCompare(b.name)).map(b => `<option value="${b.id}" ${b.id === preA ? 'selected' : ''}>${esc(b.name)} (${esc(town(b.town).name)})</option>`).join('');
  openDialog(`<h2>Add an introduction</h2><p>Two people who should know each other. Nothing is sent to anyone.</p>
    <label class="field">First<select class="inp" name="a" required>${opts}</select></label>
    <label class="field">Second<select class="inp" name="b" required>${opts}</select></label>
    <label class="field">Why they should meet<textarea class="inp" name="why" required placeholder="What one needs and the other has"></textarea></label>
    <label class="field">Status<select class="inp" name="state"><option value="open">To consider</option><option value="made">Already made</option></select></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>`, fd => {
    if (fd.get('a') === fd.get('b')) { toast('Pick two different people'); return false; }
    const A = BY[fd.get('a')], B = BY[fd.get('b')];
    addRec('intro', { id: newId('my', A.name), a: A.id, b: B.id, why: fd.get('why').trim(), state: fd.get('state'), at: fd.get('state') === 'made' ? todayISO() : '', kind: 'Yours', strength: 2, km: Math.round(km(A, B)), mine: true, outcome: '', outcomeNote: '' }, 'add introduction');
    introFilter = fd.get('state'); commit('Introduction added');
  });
}
function walkinDialog() {
  openDialog(`<h2>Add a business</h2><p>Somewhere new you've walked into. It joins the atlas${Sync.on() ? ' and your Notion' : ''}.</p>
    <label class="field">Business name<input class="inp" name="name" required autocomplete="off"></label>
    <div class="row2"><label class="field">Town<select class="inp" name="town">${D.towns.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="field">Trade<select class="inp" name="cat">${D.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <label class="field">What they do<input class="inp" name="type" placeholder="e.g. Silver dealer" autocomplete="off"></label>
    <label class="field">Who you met (their real name, if they gave it)<input class="inp" name="met" autocomplete="off"></label>
    <label class="field">Contact (phone, email or handle)<input class="inp" name="contact" autocomplete="off"></label>
    <label class="field">Address<input class="inp" name="addr" autocomplete="off"></label>
    <label class="field">Website<input class="inp" name="web" type="url" placeholder="https://" autocomplete="off"></label>
    <label class="field">Their need (your guess)<input class="inp" name="need" autocomplete="off"></label>
    <label class="field">What they could offer<input class="inp" name="offers" autocomplete="off"></label>
    <label class="field">Notes<textarea class="inp" name="notes"></textarea></label>
    <label class="row small"><input type="checkbox" name="geo"> Pin at my current location (otherwise the town centre, marked approximate)</label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>`, async fd => {
    const t = town(fd.get('town')); let la = t.la, lo = t.lo, approx = true;
    if (fd.get('geo') && navigator.geolocation) { try { const pos = await new Promise((r, j) => navigator.geolocation.getCurrentPosition(r, j, { timeout: 8000 })); la = pos.coords.latitude; lo = pos.coords.longitude; approx = false; } catch (e) { toast('Location unavailable, using the town centre'); } }
    const id = 'walkin-' + Date.now().toString(36);
    let web = fd.get('web').trim(); if (web && !/^https?:\/\//.test(web)) web = 'https://' + web;
    addRec('biz', { id, name: fd.get('name').trim(), town: t.id, cat: +fd.get('cat'), type: fd.get('type').trim() || 'Walk-in', addr: fd.get('addr').trim(), web, phone: '', need: fd.get('need').trim(), offers: fd.get('offers').trim(), why: '', la, lo, approx, custom: true, potential: 1, persona: 'dealer', askWho: '', askNote: '', opener: '', openerNote: '', theme: '', founder: false, watchCompany: '', watchFounded: '', watchDirectors: '', watchAngle: '', added: todayISO() }, 'add ' + fd.get('name').trim());
    S.people[id] = { stage: 1, notes: fd.get('notes'), met: fd.get('met').trim(), contact: fd.get('contact').trim(), last: todayISO(), next: '', log: [{ date: todayISO(), visit: true, stage: 1 }], updated: Date.now() };
    commit('Added'); openCard(id);
  });
}
function openDialog(html, onOk) {
  const dlg = $('#dlg'); const f = $('#dlg-body'); f.innerHTML = html;
  f.onsubmit = async e => { const sub = e.submitter; if (sub && sub.value === 'cancel') return; e.preventDefault(); const r = await onOk(new FormData(f)); if (r !== false) dlg.close(); };
  dlg.showModal();
}
function afterChange() { filterOptions(); renderDash(); if (graph) syncGraphData(); kick(); if (tab === 'intros') renderIntros(); if (tab === 'people' && layout === 'list') renderList(); if (tab === 'visits') renderVisits(); if (mapReady) updateMapData(); }

/* ---------------- visits ---------------- */
function routeFor(tid) {
  const t = town(tid); const left = BIZ.filter(b => b.town === tid); const out = []; let cur = { la: t.la, lo: t.lo };
  while (left.length) { left.sort((a, b) => km(cur, a) - km(cur, b)); const n = left.shift(); out.push({ b: n, leg: km(cur, n) }); cur = n; }
  // keep the far-off ones (drives) at the end, so the walk stays a walk
  const walk = out.filter(x => km(t, x.b) <= 2.5), drive = out.filter(x => km(t, x.b) > 2.5);
  const res = []; cur = { la: t.la, lo: t.lo };
  for (const x of walk.concat(drive)) { res.push({ b: x.b, leg: km(cur, x.b), drive: km(t, x.b) > 2.5 }); cur = x.b; }
  return res;
}
const legText = r => r.drive ? `${r.leg.toFixed(r.leg < 10 ? 1 : 0)} km · drive or taxi` : (r.leg < 0.03 ? 'next door' : `~${Math.max(1, Math.round(r.leg * 1.3 / 5 * 60))} min walk`);
const pen = (rid, what) => editing ? `<button class="pen" type="button" data-edit-list="${esc(rid)}" aria-label="Edit ${esc(what || '')}">${ic('pencil')}</button>` : '';
const addBtn = (kind, label) => editing ? `<button class="btn small ghost add" type="button" data-add-list="${kind}">${ic('plus')}${esc(label)}</button>` : '';
function renderVisits() {
  const el = $('#view-visits'); if (!visitTown || !D.towns.some(t => t.id === visitTown)) visitTown = D.towns.some(t => t.id === S.prefs.visitTown) ? S.prefs.visitTown : (D.towns[0] || {}).id;
  S.prefs.visitTown = visitTown; save();
  if (!visitTown) { el.innerHTML = `<div class="empty"><h4>No towns yet</h4>${editing ? addBtn('town', 'Add a town') : 'Turn on Edit to add one.'}</div>`; return; }
  const t = town(visitTown); const route = routeFor(visitTown); const tdy = todayISO();
  const evs = D.events.filter(e => e.town === visitTown);
  const wl = D.watch.filter(w => w.town === visitTown); const sg = D.signals.filter(s => s.town === visitTown);
  const ck = S.checks[tdy] || {};
  const done = route.filter(r => P(r.b.id).stage > 0).length;
  el.innerHTML = `
    <div class="towns-row" role="group" aria-label="Town">${D.towns.map(x => `<button type="button" data-vt="${x.id}" aria-pressed="${x.id === visitTown}">${esc(x.name)}<small>${BIZ.filter(b => b.town === x.id).length}</small></button>`).join('')}${addBtn('town', 'Town')}</div>
    <div class="vgrid">
      <div>
        <div class="panel town-hero" data-item="${esc(t.rid || '')}">
          <div class="label">Visit planner ${pen(t.rid, t.name)}</div><h2>${esc(t.name)}</h2><p class="lead">${esc(t.why)}</p>
          <dl class="kv"><dt>Best day</dt><dd>${esc(t.bestDay || t.day || '—')}</dd><dt>Getting there</dt><dd>${esc(t.travel || t.go || '—')}</dd>${t.dates ? `<dt>Dates</dt><dd>${esc(t.dates)}</dd>` : ''}</dl>
          <div class="row" style="margin-top:14px"><button class="btn primary" type="button" id="start-today">${ic('route')}Start the walk</button><span class="small muted">${done} of ${route.length} visited</span></div>
        </div>
        <div class="panel"><h3>Walking order <small>nearest first</small></h3>
          ${route.length ? `<ol class="route">${route.map((r, i) => `<li><span class="num">${i + 1}</span><button class="nm" type="button" data-open="${r.b.id}">${esc(r.b.name)}</button><span class="leg">${legText(r)}</span><span class="sub">${esc(r.b.addr)}${r.b.approx ? ' · approximate pin' : ''} · ${STAGES[P(r.b.id).stage]}${P(r.b.id).next ? ` · next ${fmtDate(P(r.b.id).next)}` : ''}</span></li>`).join('')}</ol>` : `<p class="muted small">No businesses here yet.</p>`}
          <p class="tiny muted" style="margin:10px 0 0">Straight-line estimates. Stops over 2.5 km out go last, as a drive.</p>
        </div>
      </div>
      <div>
        <div class="panel"><h3>Coming up <small>${evs.length ? evs.length + ' dates' : ''}</small>${addBtn('event', 'Event')}</h3>
          ${evs.length ? evs.map(e => `<div class="ev" data-item="${esc(e.rid)}"><div class="d ${(e.end || e.date) < tdy ? 'past' : ''}">${esc(e.label)}</div><div class="w">${esc(e.what)} ${pen(e.rid, e.what)}</div><div class="y">${esc(e.why)}${(e.end || e.date) < tdy ? ' · passed' : ''}</div></div>`).join('') : `<p class="muted small">No dates listed. ${esc(t.dates)}</p>`}
        </div>
        ${wl.length || sg.length || editing ? `<details class="panel fold"${editing ? ' open' : ''}><summary><h3>Worth asking about <small>${wl.length + sg.length} from the register</small></h3></summary>
          ${wl.map(w => `<div class="wl"><b>${esc(w.company)}</b> · ${esc(w.founded)}<br><span class="muted">${esc(w.directors)}</span><br>${esc(w.angle)} ${editing ? `<button class="pen" type="button" data-open="${w.biz}" aria-label="Edit on the business card">${ic('pencil')}</button>` : ''}</div>`).join('')}
          ${sg.map(x => `<div class="wl" data-item="${esc(x.rid)}"><b>${esc(x.company)}</b> · ${esc(x.where)} ${pen(x.rid, x.company)}<br><span class="muted">${esc(x.shows)}</span><br>${esc(x.todo)}</div>`).join('')}
          ${editing ? `<div class="row" style="margin-top:8px">${addBtn('signal', 'Signal')}<span class="tiny muted">Watchlist lines live on each business card.</span></div>` : `<p class="tiny muted" style="margin:8px 0 0">Public-register facts as of 2 Nov 2026. A reason to ask their story, never an opener.</p>`}
        </details>` : ''}
        <details class="panel fold"${editing ? ' open' : ''}><summary><h3>Before you go in</h3></summary>
          <h4 class="label" style="margin-top:6px">In the car ${addBtn('before', 'Item')}</h4><ul class="checks">${D.before.map((x, i) => `<li data-item="${esc(x.rid)}"><label><input type="checkbox" data-ck="${i}" ${ck[i] ? 'checked' : ''}>${esc(x.text)}</label>${pen(x.rid, 'item')}</li>`).join('')}</ul>
          <h4 class="label" style="margin-top:16px">What to say ${addBtn('flow', 'Step')}</h4>
          ${D.flow.map((f, i) => `<details class="acc" data-item="${esc(f.rid)}"><summary>${i + 1}. ${esc(f.stage)}</summary><p>${esc(f.do)}</p><p class="quote">“${esc(f.say)}”</p><p class="tiny muted">${esc(f.from)} ${pen(f.rid, f.stage)}</p></details>`).join('')}
          <details class="acc"><summary>Your 10-second story</summary>${D.story.map(x => `<p data-item="${esc(x.rid)}"><b>${esc(x[0])}.</b> ${esc(x[1])} ${pen(x.rid, x[0])}</p>`).join('')}${addBtn('story', 'Part')}</details>
          <details class="acc"><summary>After each visit</summary><ul class="checks" style="margin-top:8px">${D.after.map(x => `<li data-item="${esc(x.rid)}">${esc(x.text)} ${pen(x.rid, 'item')}</li>`).join('')}</ul>${addBtn('after', 'Item')}</details>
          <p class="tiny muted" style="margin:10px 0 0">VVE = Vanessa Van Edwards, CH = Chase Hughes, VG = Vinh Giang, as summarised in your Who I'm Becoming guide.</p>
        </details>
      </div>
    </div>`;
  $$('[data-vt]', el).forEach(b => b.onclick = () => { visitTown = b.dataset.vt; renderVisits(); });
  $('#start-today').onclick = () => { if (route.length) openToday(visitTown); else toast('No businesses in this town yet'); };
  $$('[data-ck]', el).forEach(c => c.onchange = () => { S.checks = { [tdy]: Object.assign({}, S.checks[tdy], { [c.dataset.ck]: c.checked }) }; save(); });
}

/* ---------------- today mode ---------------- */
let todayIdx = 0, todayTown = null;
function openToday(tid) { todayTown = tid; const r = routeFor(tid); todayIdx = Math.max(0, r.findIndex(x => P(x.b.id).stage === 0 || P(x.b.id).last !== todayISO())); renderToday(); $('#today').hidden = false; document.body.style.overflow = 'hidden'; }
function closeToday() { $('#today').hidden = true; document.body.style.overflow = ''; if (tab === 'visits') renderVisits(); }
function renderToday() {
  const r = routeFor(todayTown); const cur = r[todayIdx]; const b = cur.b; const p = P(b.id); const per = D.personas[b.persona] || D.personas.dealer;
  const ps = partners(b.id).slice(0, 3);
  $('#today').innerHTML = `<div class="today-in">
    <div class="today-top"><div><div class="eyebrow">Today · ${esc(town(todayTown).name)}</div><div class="small muted">Stop ${todayIdx + 1} of ${r.length} · ${legText(cur)}</div></div><button class="btn small" type="button" id="t-close">Done</button></div>
    <div class="progress">${r.map((x, i) => `<i class="${i === todayIdx ? 'cur' : P(x.b.id).last === todayISO() ? 'on' : ''}"></i>`).join('')}</div>
    <div class="eyebrow" style="color:${cat(b.cat).ink}">${esc(cat(b.cat).name)}</div>
    <h2>${esc(b.name)}</h2>
    <p class="muted" style="margin:4px 0 0">${esc(b.type)} · ${esc(b.addr)}${b.approx ? ' (approximate pin)' : ''}</p>
    <div class="row" style="margin-top:10px"><a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${b.la},${b.lo}&travelmode=${cur.drive ? 'driving' : 'walking'}">Directions</a>${b.web ? `<a class="btn small" target="_blank" rel="noopener" href="${esc(b.web)}">Website</a>` : ''}<button class="btn small" type="button" data-open-card="${b.id}">Full card</button></div>
    <p style="margin:16px 0 0"><span class="eyebrow">Ask for</span><br><b>${esc(b.ask.who)}</b>${p.met ? ` · last time you met <b>${esc(p.met)}</b>` : ''}</p>
    <p class="big">“${esc(b.opener || "I'm getting to know the people in town. Who should I meet first?")}”</p>${b.openerNote ? `<p class="opnote">${esc(b.openerNote)}</p>` : ''}
    <p class="small"><span class="muted">Listen for:</span> ${esc(per.listen)}</p>
    <p class="small"><span class="muted">Their need (guess):</span> ${esc(b.need)}</p>
    ${ps.length ? `<p class="small"><span class="muted">Could meet:</span> ${ps.map(x => esc(x.other.name)).join(' · ')}</p>` : ''}
    ${b.watch ? `<div class="alert small">Watchlist: ${esc(b.watch.angle)}.</div>` : ''}
    <div class="stagebtns" role="group" aria-label="Status">${STAGES.map((s, i) => `<button type="button" data-tstage="${i}" aria-pressed="${p.stage === i}">${s}</button>`).join('')}</div>
    <label class="field">Quick note<textarea class="inp" id="t-note" placeholder="Name, one personal detail, their need">${esc(p.notes)}</textarea></label>
    <div class="nav"><button class="btn" type="button" id="t-prev" ${todayIdx === 0 ? 'disabled' : ''}>← Previous</button><button class="btn primary" type="button" id="t-next">${todayIdx === r.length - 1 ? 'Finish' : 'Visited · next →'}</button></div>
    <p class="tiny muted" style="text-align:center;margin-top:14px">“I connect people who don't know they need each other.” Slow down, pause, finish low.</p>
  </div>`;
  const T = $('#today');
  $('#t-close', T).onclick = closeToday;
  $('#t-note', T).onchange = e => setP(b.id, { notes: e.target.value });
  $$('[data-tstage]', T).forEach(x => x.onclick = () => { const st = +x.dataset.tstage; setStage(b.id, st); renderToday(); });
  $('#t-prev', T).onclick = () => { todayIdx = Math.max(0, todayIdx - 1); renderToday(); T.scrollTop = 0; };
  $('#t-next', T).onclick = () => { setP(b.id, { notes: $('#t-note', T).value }); logVisit(b.id); if (todayIdx === r.length - 1) { closeToday(); toast('Good day. Notes saved.'); return; } todayIdx++; renderToday(); T.scrollTop = 0; };
  $('[data-open-card]', T).onclick = () => { closeToday(); openCard(b.id); };
}

/* ---------------- map (MapLibre) ---------------- */
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
function geo() { return { type: 'FeatureCollection', features: BIZ.filter(b => b.la).map(b => ({ type: 'Feature', id: undefined, properties: { id: b.id, name: b.name, cat: b.cat, ink: cat(b.cat).ink, approx: b.approx ? 1 : 0, stage: P(b.id).stage, show: matches(b) ? 1 : 0 }, geometry: { type: 'Point', coordinates: [b.lo, b.la] } })) }; }
function updateMapData() { if (mapReady && map.getSource('biz')) map.getSource('biz').setData(geo()); }
async function initMap() {
  $('#map-towns').innerHTML = `<button type="button" data-mt="all" aria-pressed="true">All</button>` + D.towns.map(t => `<button type="button" data-mt="${t.id}" aria-pressed="false">${esc(t.name.replace(' & Weybridge', '').replace('-on-Thames', ''))}</button>`).join('');
  $('#map-legend').innerHTML = D.cats.map(c => `<span><i style="background:${c.ink}"></i>${esc(c.name)}</span>`).join('') + `<span><i class="ap"></i>Approximate (${BIZ.filter(b => b.approx).length})</span><span><i style="background:#fff;box-shadow:0 0 0 2px #94733a"></i>Visited</span>`;
  if (map) { map.resize(); updateMapData(); return; }
  try {
    loadCss('vendor/maplibre-gl.css'); await loadScript('vendor/maplibre-gl.js');
    map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[-2.4, 50.75], [0.25, 52.0]], fitBoundsOptions: { padding: 40 }, attributionControl: { compact: true }, maxPitch: 0, dragRotate: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    map.on('style.load', () => { tintMap(); addLayers(); });
    map.on('error', e => { if (!mapReady && /style|Failed to fetch/i.test(String(e?.error?.message || ''))) mapFail(); });
  } catch (e) { mapFail(); }
  $('#map-towns').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b || !map) return; $$('[data-mt]').forEach(x => x.setAttribute('aria-pressed', x === b)); fitTown(b.dataset.mt); };
  $('#btn-globe').onclick = toggleGlobe;
}
function mapFail() { const f = $('#map-fallback'); f.hidden = false; f.innerHTML = `<div><h3>The map needs a connection</h3><p class="muted">Map tiles come from OpenFreeMap. Everything else works offline: try the Visits tab for walking order.</p></div>`; }
function tintMap() {
  const st = map.getStyle(); for (const l of st.layers) {
    try {
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#efe9db');
      else if (/water/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#d7dfd2');
      else if (/waterway/.test(l.id) && l.type === 'line') map.setPaintProperty(l.id, 'line-color', '#c9d4c6');
      else if (/park|wood|landcover/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#e7e2c6');
      else if (/residential|landuse/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#eee5cf');
      else if (/building/.test(l.id) && l.type === 'fill') { map.setPaintProperty(l.id, 'fill-color', '#e6dbc1'); map.setPaintProperty(l.id, 'fill-outline-color', '#d9cba9'); }
      else if (/casing/.test(l.id) && l.type === 'line') map.setPaintProperty(l.id, 'line-color', '#ddcfae');
      else if (/highway|road|railway/.test(l.id) && l.type === 'line') map.setPaintProperty(l.id, 'line-color', /rail/.test(l.id) ? '#cdbf9f' : '#fffaf0');
      else if (/boundary/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#c7b68f');
      else if (l.type === 'symbol') { map.setPaintProperty(l.id, 'text-color', '#5c4f3d'); map.setPaintProperty(l.id, 'text-halo-color', '#f6f0e1'); }
      else if (l.type === 'raster') map.setPaintProperty(l.id, 'raster-opacity', 0.25);
    } catch (e) { /* layer without that paint */ }
  }
}
function addLayers() {
  const font = (map.getStyle().layers.find(l => l.layout && l.layout['text-font']) || {}).layout?.['text-font'] || ['Noto Sans Regular'];
  if (!map.getSource('biz')) map.addSource('biz', { type: 'geojson', data: geo() });
  map.addLayer({ id: 'biz-approx', type: 'circle', source: 'biz', filter: ['==', ['get', 'approx'], 1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 7, 15, 22], 'circle-color': 'rgba(255,252,244,.35)', 'circle-stroke-color': '#5c4f3d', 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.8, 'circle-opacity': ['case', ['==', ['get', 'show'], 1], 1, 0.2] } });
  map.addLayer({ id: 'biz-visited', type: 'circle', source: 'biz', filter: ['>', ['get', 'stage'], 0], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 6.5, 15, 12], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#94733a', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'biz', type: 'circle', source: 'biz', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4.2, 15, 8.5], 'circle-color': ['get', 'ink'], 'circle-stroke-color': '#fffcf4', 'circle-stroke-width': 1.6, 'circle-opacity': ['case', ['==', ['get', 'show'], 1], 1, 0.18], 'circle-stroke-opacity': ['case', ['==', ['get', 'show'], 1], 1, 0.18] } });
  map.addLayer({ id: 'biz-label', type: 'symbol', source: 'biz', minzoom: 13.5, filter: ['==', ['get', 'show'], 1], layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true }, paint: { 'text-color': '#1f1b16', 'text-halo-color': '#fffcf4', 'text-halo-width': 1.6 } });
  map.on('click', 'biz', e => { const f = e.features[0]; const b = BY[f.properties.id]; popup(b); });
  map.on('mouseenter', 'biz', () => map.getCanvas().style.cursor = 'pointer'); map.on('mouseleave', 'biz', () => map.getCanvas().style.cursor = '');
  mapReady = true; window.__mapReady = true;
}
let pop;
function popup(b) {
  if (pop) pop.remove();
  const html = `<div class="eyebrow" style="color:${cat(b.cat).ink}">${esc(cat(b.cat).name)}</div><h4>${esc(b.name)}</h4><div class="small muted">${esc(b.type)}</div><div class="small">${esc(b.addr)}</div>${b.approx ? '<div class="tiny muted">Approximate pin: on the site or town centre, not the exact door.</div>' : ''}<div class="small" style="margin-top:4px"><i class="pip s${P(b.id).stage}"></i> ${STAGES[P(b.id).stage]}</div><button class="btn small" style="margin-top:8px" type="button" data-open="${b.id}">Open card</button>`;
  pop = new maplibregl.Popup({ offset: 12, maxWidth: '260px' }).setLngLat([b.lo, b.la]).setHTML(html).addTo(map);
}
function flyToBiz(b) { if (!map || !b.la) return; map.flyTo({ center: [b.lo, b.la], zoom: Math.max(map.getZoom(), 15), duration: 900 }); }
function fitTown(tid) {
  if (globeOn) toggleGlobe(false);
  const pts = tid === 'all' ? BIZ : BIZ.filter(b => b.town === tid && km(town(tid), b) < 2.5);
  const use = pts.length ? pts : BIZ.filter(b => b.town === tid);
  const bb = use.reduce((a, b) => [[Math.min(a[0][0], b.lo), Math.min(a[0][1], b.la)], [Math.max(a[1][0], b.lo), Math.max(a[1][1], b.la)]], [[180, 90], [-180, -90]]);
  map.fitBounds(bb, { padding: { top: 70, bottom: 60, left: 40, right: 40 }, maxZoom: 16.5, duration: 1000 });
}
function toggleGlobe(force) {
  if (!map) return; globeOn = typeof force === 'boolean' ? force : !globeOn;
  $('#btn-globe').setAttribute('aria-pressed', globeOn);
  if (globeOn) { map.setProjection({ type: 'globe' }); try { map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0] }); } catch (e) { } map.flyTo({ center: [-1, 46], zoom: 1.6, duration: 1600 }); }
  else { map.setProjection({ type: 'mercator' }); map.fitBounds([[-2.4, 50.75], [0.25, 52.0]], { padding: 40, duration: 900 }); }
}

/* ---------------- data dialogs ---------------- */
function csvCell(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCSV() {
  const rows = [['Business', 'Town', 'Trade', 'Type', 'Status', 'Who you met', 'Contact', 'Last visit', 'Next visit', 'Their need (guess)', 'Could connect with', 'Notes', 'Address', 'Website', 'Phone', 'Added by you']];
  for (const b of BIZ) { const p = P(b.id); rows.push([b.name, town(b.town).name, cat(b.cat).name, b.type, STAGES[p.stage], p.met, p.contact || '', p.last, p.next, b.need, partners(b.id).map(x => x.other.name).join('; '), p.notes, b.addr, b.web, b.phone || '', b.custom ? 'yes' : '']); }
  const intros = [['A', 'B', 'Why', 'Kind', 'Strength', 'Status', 'Yours']]; for (const i of INTROS) intros.push([BY[i.a].name, BY[i.b].name, i.why, i.kind, i.strength, introState(i), i.mine ? 'yes' : '']);
  const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n\r\nIntroductions\r\n' + intros.map(r => r.map(csvCell).join(',')).join('\r\n');
  dl(new Blob([csv], { type: 'text/csv' }), `heirloom-atlas-${todayISO()}.csv`);
}
function exportJSON() { dl(new Blob([JSON.stringify({ app: 'heirloom-atlas', exported: new Date().toISOString(), state: S }, null, 1)], { type: 'application/json' }), `heirloom-atlas-backup-${todayISO()}.json`); S.prefs.lastBackup = todayISO(); save(); }
function dataDialog() {
  const n = Object.values(S.people).filter(p => p.stage > 0 || p.notes || p.met).length;
  const nEd = C.COLLS.reduce((a, c) => a + Object.keys(S.ed[c]).length, 0);
  openDialog(`<h2>Your data</h2><p>Kept in this browser: ${n} people with notes or a status, and ${nEd} edited or added item${nEd === 1 ? '' : 's'}. ${Sync.on() ? 'All of it also syncs with your Notion: People I\'ve Met, plus the Businesses, Introductions and Towns &amp; lists databases.' : 'Nothing is sent anywhere unless you turn on Notion sync.'}</p>
    <p>${S.prefs.lastBackup ? `Last backup: ${fmtDate(S.prefs.lastBackup)}.` : 'No backup yet.'} Save a backup now and then so you never lose it, and to move to another phone.</p>
    <div class="row"><button class="btn primary" type="button" id="d-json">Save backup (.json)</button><button class="btn" type="button" id="d-csv">Export spreadsheet (.csv)</button></div>
    <label class="field">Restore from a backup<input class="inp" type="file" id="d-file" accept="application/json,.json"></label>
    <div class="acts"><button class="btn ghost" type="button" id="d-reset">Erase this device</button><button class="btn" value="cancel" formnovalidate>Close</button></div>`, () => true);
  $('#d-json').onclick = exportJSON; $('#d-csv').onclick = exportCSV;
  $('#d-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); const st = j.state || j; if (st.v !== 1 || typeof st.people !== 'object') throw 0;
      if (!await askDelete({ title: 'Replace everything on this device with this backup?', body: 'What is here now is overwritten.', ok: 'Replace' })) { e.target.value = ''; return; }
      S = migrate(Object.assign(blank(), st)); save(); rebuild(); if (graph) syncGraphData(true); afterChange(); $('#dlg').close(); toast('Backup restored');
    } catch (err) { toast("That file isn't a Heirloom Atlas backup"); }
  };
  $('#d-reset').onclick = async () => { if (!await askDelete({ title: 'Erase this device?', body: `All your statuses, notes, walk-ins and introductions here go. Save a backup first if unsure.${Sync.on() ? ' Your Notion rows are not deleted, and will sync back in next time.' : ''}`, ok: 'Erase' })) return; S = blank(); save(); rebuild(); if (graph) syncGraphData(true); afterChange(); $('#dlg').close(); toast('Erased'); };
}
function aboutDialog() {
  openDialog(`<h2>About this atlas</h2>
    <p><b>${esc(D.definition)}</b> This is your walk-in guide to ${BIZ.length} of them across ${D.towns.length} towns within a day trip of London.</p>
    <ul><li>Businesses, addresses, websites, events and the watchlist come from your Network towns research (2 Nov 2026), checked against Companies House and local directories.</li>
    <li>“Their need”, “How to approach” and every introduction are suggestions derived from each business's type and role. Test them in person.</li>
    <li>No people are named unless the source names them. Record the real names you're given in your notes.</li>
    <li>${BIZ.filter(b => b.approx).length} pins are approximate; the rest sit on the postcode point.</li>
    <li>Nothing here contacts anyone. Your notes stay on this device${Sync.on() ? ', and sync privately to your own Notion database' : ''}.</li></ul>
    <p class="small">Sources: ${D.sources.map(s => /^https?:/.test(s[1]) ? `<a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])}</a>` : esc(s[0])).join(' · ')}</p>
    <p class="tiny muted">Built with force-graph (MIT), MapLibre GL JS (BSD), Lucide icons (ISC), OpenFreeMap tiles © OpenMapTiles © OpenStreetMap contributors, Newsreader, Source Sans 3 and IBM Plex Mono (OFL).</p>
    <div class="acts"><button class="btn primary" value="cancel" formnovalidate>Close</button></div>`, () => true);
}

/* ---------------- edit mode: inline forms for everything ---------------- */
const LONG = new Set(['why', 'read', 'listen', 'do', 'say', 'text', 'todo', 'shows', 'need', 'offers', 'outcomeNote']);
function bizFields() {
  const towns = D.towns.map(t => [t.id, t.name]), cats = D.cats.map(c => [c.id, c.name]), pers = [['', '—']].concat(Object.entries(D.personas).map(([k, v]) => [k, v.label]));
  return [
    ['Basics'], ['name', 'Business name', 'text', { req: 1 }], ['town', 'Town', 'select', { opts: towns }], ['cat', 'Trade', 'select', { opts: cats, num: 1 }], ['type', 'What they do'],
    ['addr', 'Address'], ['web', 'Website', 'url'], ['phone', 'Shop phone', 'tel'],
    ['Who and why'], ['askWho', 'Who to ask for'], ['askNote', 'Note on who to ask'], ['need', 'Their need (a guess)'], ['offers', 'What they could offer'], ['why', 'Why they matter'],
    ['Approach'], ['opener', 'Opener'], ['openerNote', 'Note under the opener'], ['persona', 'Approach type', 'select', { opts: pers }], ['theme', 'Theme'], ['potential', 'Connection potential (1 to 10)', 'number', { min: 1, max: 10 }],
    ['Watchlist'], ['founder', 'On the retiring-founder watchlist', 'checkbox'], ['watchCompany', 'Company'], ['watchFounded', 'Founded'], ['watchDirectors', 'Directors'], ['watchAngle', 'Angle'],
    ['Map pin'], ['la', 'Latitude', 'number', { step: 'any' }], ['lo', 'Longitude', 'number', { step: 'any' }], ['approx', 'Pin is approximate', 'checkbox'],
  ];
}
function introFields() {
  const opts = BIZ.slice().sort((a, b) => a.name.localeCompare(b.name)).map(b => [b.id, `${b.name} (${town(b.town).name})`]);
  return [['a', 'First', 'select', { opts }], ['b', 'Second', 'select', { opts }], ['why', 'Why they should meet', 'textarea', { req: 1 }],
    ['state', 'Status', 'select', { opts: [['open', 'To consider'], ['made', 'Made'], ['declined', 'Not now']] }], ['at', 'Date', 'date'],
    ['outcome', 'What happened', 'select', { opts: [['', '—']].concat(C.OUTCOMES.map(o => [o, o])) }], ['outcomeNote', 'A line on what happened'],
    ['kind', 'Kind'], ['strength', 'Strength', 'select', { opts: [[3, 'Strong'], [2, 'Good'], [1, 'Possible']], num: 1 }]];
}
function listFields(kind) {
  const K = C.KINDS[kind]; const out = [['name', K.name, LONG.has('name') ? 'textarea' : 'text', { req: 1 }]];
  for (const [k, label] of K.fields) {
    if (k === 'key') continue;
    if (k === 'la' || k === 'lo') out.push([k, label, 'number', { step: 'any', req: 1 }]);
    else if (k === 'date' || k === 'end') out.push([k, label, 'date', k === 'date' ? { req: 1 } : {}]);
    else if (k === 'town') out.push([k, label, 'select', { opts: D.towns.map(t => [t.id, t.name]) }]);
    else if (k === 'at') out.push([k, label, 'select', { opts: [['', '—']].concat(BIZ.filter(b => true).sort((a, b) => a.name.localeCompare(b.name)).map(b => [b.id, b.name])) }]);
    else if (k === 'ink') out.push([k, label, 'color']);
    else if (k === 'url') out.push([k, label, 'url']);
    else out.push([k, label, LONG.has(k) ? 'textarea' : 'text']);
  }
  if (kind === 'before' || kind === 'after') out[0][2] = 'textarea';
  return out;
}
function fieldHTML([k, label, type = 'text', o = {}], v) {
  if (!label) return `<h4 class="label form-group">${esc(k)}</h4>`;
  const req = o.req ? ' required' : '';
  if (type === 'checkbox') return `<label class="check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
  if (type === 'select') return `<label class="field">${esc(label)}<select class="inp" name="${k}"${req}>${o.opts.map(([val, t]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  if (type === 'textarea' || (type === 'text' && LONG.has(k))) return `<label class="field">${esc(label)}<textarea class="inp" name="${k}" rows="3"${req}>${esc(v ?? '')}</textarea></label>`;
  const extra = [o.step && `step="${o.step}"`, o.min != null && `min="${o.min}"`, o.max != null && `max="${o.max}"`].filter(Boolean).join(' ');
  return `<label class="field">${esc(label)}<input class="inp" type="${type}" name="${k}" value="${esc(v ?? (type === 'color' ? '#8a7a61' : ''))}" ${extra}${req} autocomplete="off"></label>`;
}
// Renders an inline form for one record. id = null adds a new one (opts.kind for list items).
function mountForm(host, coll, id, opts = {}) {
  if (!host) return;
  const kind = coll === 'list' ? (id ? eff('list', id).kind : opts.kind) : null;
  const rec = id ? eff(coll, id) : Object.assign({}, opts.preset || {});
  const fields = coll === 'biz' ? bizFields() : coll === 'intro' ? introFields() : listFields(kind);
  const seeded = id && SEED[coll][id]; const edited = seeded && S.ed[coll][id] && S.ed[coll][id].f && Object.keys(S.ed[coll][id].f).length;
  host.innerHTML = `<form class="edit-form" novalidate>${fields.map(f => fieldHTML(f, rec[f[0]])).join('')}
    <div class="form-acts"><button class="btn primary small" type="submit">${ic('check')}${id ? 'Save' : 'Add'}</button><button class="btn small ghost" type="button" data-fa="cancel">Cancel</button>
    ${seeded && edited ? `<button class="btn small ghost" type="button" data-fa="reset">${ic('rotate-ccw')}Research version</button>` : ''}
    ${id && coll !== 'biz' ? `<button class="btn small ghost warn" type="button" data-fa="del">${ic('trash-2')}Delete</button>` : ''}</div></form>`;
  const f = $('form', host); const first = $('input,textarea,select', f); if (first && !opts.noFocus) setTimeout(() => first.focus({ preventScroll: false }), 30);
  const done = () => (opts.onDone || (() => {}))();
  f.onsubmit = e => {
    e.preventDefault();
    for (const el of $$('[required]', f)) if (!String(el.value).trim()) { el.focus(); toast('Fill in ' + el.closest('label').firstChild.textContent.trim()); return; }
    const v = {};
    for (const [k, label, type = 'text', o = {}] of fields) { if (!label) continue; const el = f.elements[k]; if (!el) continue;
      if (type === 'checkbox') v[k] = el.checked; else if (type === 'number') v[k] = el.value === '' ? null : +el.value; else if (o.num) v[k] = +el.value; else v[k] = el.value.trim(); }
    if (v.web && !/^https?:\/\//.test(v.web)) v.web = 'https://' + v.web;
    if (coll === 'intro' && v.a === v.b) { toast('Pick two different people'); return; }
    if (coll === 'intro' && v.state !== 'open' && !v.at) v.at = todayISO();
    if (coll === 'biz' && v.founder === false) Object.assign(v, {});
    const label = (v.name || (coll === 'intro' ? 'introduction' : 'item'));
    if (id) editRec(coll, id, v, 'edit ' + label);
    else {
      const max = k => Math.max(0, ...C.effective(SEED.list, S.ed.list).filter(x => x.kind === k).map(x => +x.order || 0));
      const all = C.effective(SEED.list, S.ed.list);
      let rec2;
      if (coll === 'list') {
        rec2 = Object.assign({ id: newId(kind, v.name), kind, order: max(kind) + 1 }, v);
        if (kind === 'town') { let k = C.slug(v.name) || 'town'; while (D.towns.some(t => t.id === k)) k += '-2'; rec2.key = k; }
        if (kind === 'cat') rec2.key = String(Math.max(-1, ...D.cats.map(c => c.id)) + 1);
        if (kind === 'persona') { let k = C.slug(v.name) || 'approach'; while (D.personas[k]) k += '-2'; rec2.key = k; }
        if (kind === 'text') rec2.key = C.slug(v.name);
        void all;
      } else rec2 = Object.assign({ id: newId(coll === 'intro' ? 'my' : 'walkin', v.name || (BY[v.a] || {}).name), mine: coll === 'intro', custom: coll === 'biz' }, opts.preset || {}, v);
      if (coll === 'intro' && rec2.km == null && BY[rec2.a] && BY[rec2.b]) rec2.km = Math.round(km(BY[rec2.a], BY[rec2.b]));
      addRec(coll, rec2, 'add ' + label);
    }
    commit(id ? 'Saved' : 'Added'); done();
  };
  const label = () => coll === 'intro' ? `the introduction ${(BY[rec.a] || {}).name || ''} and ${(BY[rec.b] || {}).name || ''}` : `“${rec.name || rec.what || rec.label || rec.text || 'this item'}”`;
  host.addEventListener('click', async e => {
    const b = e.target.closest('[data-fa]'); if (!b) return; const a = b.dataset.fa;
    if (a === 'cancel') return done();
    if (a === 'reset') { if (!await askDelete({ title: `Discard your edits to ${label()}?`, body: 'It goes back to the research version. You can undo this.', ok: 'Discard' })) return; resetRec(coll, id); commit('Back to the research version'); return done(); }
    if (a === 'del') { if (!await askDelete({ title: `Delete ${label()}?`, body: 'In Notion it is ticked Archived, not removed. You can undo this.' })) return; delRec(coll, id, 'delete ' + (rec.name || 'introduction')); commit('Deleted. Undo is in the edit bar.'); return done(); }
  });
}
function rerender() { if ($('#sheet').classList.contains('open') && $('#sheet-body').dataset.mode === 'lists') openLists(); if (tab === 'visits') renderVisits(); if (tab === 'intros') renderIntros(); }
function editListInline(rid, btn) {
  if (!eff('list', rid)) return;
  const host = btn.closest('[data-item]') || btn.parentElement; const box = document.createElement('div'); box.className = 'inline-form';
  if (host.tagName === 'DETAILS') host.open = true;
  host.replaceWith(box); mountForm(box, 'list', rid, { onDone: rerender });
}
function addListInline(kind, btn) {
  const box = document.createElement('div'); box.className = 'inline-form';
  const anchor = btn.closest('h3,h4,.row,.towns-row,.list-kind-head') || btn;
  anchor.after(box); mountForm(box, 'list', null, { kind, onDone: rerender });
}
const LIST_ORDER = [['town', 'Towns'], ['event', 'Events'], ['cat', 'Trades'], ['persona', 'Approach types'], ['signal', 'Register signals'], ['flow', 'What to say'], ['before', 'In the car'], ['after', 'After each visit'], ['story', 'Your 10-second story'], ['source', 'Sources'], ['text', 'App text']];
function openLists() {
  focusId = null; const all = C.effective(SEED.list, S.ed.list);
  const body = $('#sheet-body'); body.dataset.mode = 'lists';
  body.innerHTML = `<div class="card-head"><div><div class="label">Edit mode</div><h2>Lists &amp; settings</h2><p>Everything else the app shows. Businesses and introductions are edited where they appear.</p></div></div>
    ${LIST_ORDER.map(([k, label]) => { const items = all.filter(x => x.kind === k).sort((a, b) => (a.order || 0) - (b.order || 0)); return `<details class="acc list-kind"${k === 'town' ? ' open' : ''}><summary>${esc(label)} <span class="muted">${items.length}</span></summary>
      <div class="list-kind-head row">${addBtn(k, 'Add')}</div>
      <ul class="plain">${items.map(x => `<li data-item="${esc(x.id)}"><span>${esc(String(x.name).slice(0, 90))}${S.ed.list[x.id] && SEED.list[x.id] ? ' <span class="tiny muted">edited</span>' : !SEED.list[x.id] ? ' <span class="tiny muted">added</span>' : ''}</span>${pen(x.id, x.name)}</li>`).join('')}</ul></details>`; }).join('')}
    <p class="tiny muted" style="margin-top:14px">Deleted items can come back with Undo, or by unticking Archived in Notion.</p>`;
  const sh = $('#sheet'); sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = innerWidth >= 720; body.scrollTop = 0;
}
function renderEditBar() {
  const bar = $('#editbar'); if (!bar) return; bar.hidden = !editing; if (!editing) return;
  const u = (S.undo || []).slice(-1)[0];
  bar.innerHTML = `<span class="label">Editing</span><span class="eb-hint small">${Sync.on() ? 'Changes sync to Notion.' : 'Changes stay on this device.'}</span>
    <button class="btn small ghost" type="button" data-eb="undo" ${u ? '' : 'disabled'} title="${u ? esc('Undo ' + u.label) : 'Nothing to undo'}">${ic('undo-2')}<span>Undo${u ? ' ' + esc(u.label.split(' ')[0]) : ''}</span></button>
    <button class="btn small ghost" type="button" data-eb="lists">${ic('list')}<span>Lists</span></button>
    <button class="btn small primary" type="button" data-eb="done">Done</button>`;
}
function setEditing(on) {
  editing = on; document.body.classList.toggle('editing', on); $('#btn-edit').setAttribute('aria-pressed', on);
  renderEditBar();
  if (tab === 'intros') renderIntros(); if (tab === 'visits') renderVisits();
  if ($('#sheet').classList.contains('open')) { if ($('#sheet-body').dataset.mode === 'lists') { if (on) openLists(); else closeCard(); } else if (focusId) openCard(focusId); }
  toast(on ? 'Edit mode: tap the pencils, or open Lists' : 'Edit mode off');
}

/* ---------------- boot ---------------- */
async function boot() {
  try { D0 = await (await fetch('assets/data.json', { cache: 'no-cache' })).json(); SEED = C.seeds(D0); }
  catch (e) { document.querySelector('main').innerHTML = `<div class="empty"><h4>Couldn't load the atlas</h4>Check your connection and reload.</div>`; return; }
  S = load(); rebuild(); buildFilters(); renderDash();
  $('#dash').addEventListener('click', dashClick);
  $$('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openCard(o.dataset.open); return; }
    const m = e.target.closest('[data-mark]'); if (m) { markIntro(m.dataset.id, m.dataset.mark); return; }
    const el = e.target.closest('[data-edit-list]'); if (el) { editListInline(el.dataset.editList, el); return; }
    const al = e.target.closest('[data-add-list]'); if (al) { addListInline(al.dataset.addList, al); return; }
    if (e.target.closest('[data-clear]')) clearFilters();
  });
  $('#sheet-close').onclick = closeCard; $('#scrim').onclick = closeCard;
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && editing && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); return; } if (e.key === 'Escape') { if (!$('#today').hidden) closeToday(); else if ($('#sheet').classList.contains('open')) closeCard(); } });
  $('#btn-data').onclick = dataDialog; $('#btn-about').onclick = aboutDialog; $('#btn-add').onclick = walkinDialog; $('#btn-sync').onclick = Sync.dialog;
  $('#btn-edit').onclick = () => setEditing(!editing);
  $('#editbar').addEventListener('click', e => { const b = e.target.closest('[data-eb]'); if (!b) return; const a = b.dataset.eb; if (a === 'undo') undo(); else if (a === 'lists') openLists(); else if (a === 'done') setEditing(false); });
  // swipe down to close the sheet on phones
  let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { if ($('#sheet-body').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) closeCard(); y0 = null; }, { passive: true });
  layout = S.prefs.layout || 'graph';
  const [h, id] = location.hash.slice(1).split('/');
  setLayout(layout);
  go(['people', 'intros', 'visits', 'where'].includes(h) ? h : 'people');
  if (id && BY[id]) setTimeout(() => openCard(id), 300);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  Sync.init();
  window.__ready = true;
}
/* ---------------- Notion sync ----------------
   Talks only to the heirloom-atlas-sync Worker, which holds the Notion key. The passphrase lives in its own
   localStorage entry, so backups and exports never contain it. Pending changes are simply records whose
   content differs from what Notion last confirmed, so they survive reloads and retry when you're back online. */
const Sync = (() => {
  const NM = window.NotionMap;
  const CK = 'heirloom-atlas/sync';
  const DEF = (window.HEIRLOOM_SYNC && window.HEIRLOOM_SYNC.url) || '';
  let cfg = {}; try { cfg = JSON.parse(localStorage.getItem(CK)) || {}; } catch (e) { cfg = {}; }
  const saveCfg = () => { try { localStorage.setItem(CK, JSON.stringify(cfg)); } catch (e) { } };
  const url = () => String(cfg.url || DEF || '').replace(/\/+$/, '');
  const on = () => !!(NM && url() && cfg.key && !cfg.off);
  let state = 'off', detail = '', busy = false, again = false, timer = null, retryMs = 0;
  const sid = id => String(id || '').replace(/-/g, '').toLowerCase();

  function rowFor(b) { const p = P(b.id); const r = NM.toRow(b, p, town(b.town).name); if (b.metAt) r.metAt = b.metAt; return r; }
  function pending() {
    if (!on()) return 0; let n = 0;
    for (const b of BIZ) { const p = S.people[b.id]; if (!p) continue;
      if (p.nid) { if (NM.rowHash(rowFor(b)) !== p.nHash) n++; }
      else if (NM.hasData(p) && !(p.nGoneAt && (p.updated || 0) <= p.nGoneAt)) n++; }
    n += (S.peopleTrash || []).length;
    const ctx = ctxNow();
    for (const coll of C.COLLS) for (const [id, e] of Object.entries(S.ed[coll])) {
      if (e.del) { if (!e.delSynced && (e.nid || SEED[coll][id])) n++; continue; }
      if (!e.updated) continue; const r = eff(coll, id); if (!r) continue;
      if (!e.nid || C.rowHash(coll, C.toRow(coll, r, ctx)) !== e.nHash) n++;
    }
    return n;
  }
  let colls = {}; const collErr = {};
  function setState(s, d) {
    state = s; detail = d || ''; const b = $('#btn-sync'); if (!b) return;
    const n = pending();
    const label = { off: 'Notion sync is off', ok: 'Synced with Notion', partial: 'Partly synced with Notion', syncing: 'Syncing with Notion…', waiting: `Offline: ${n} change${n === 1 ? '' : 's'} waiting`, error: 'Notion sync problem' }[s] || s;
    b.dataset.state = s; b.title = label + (detail ? ' · ' + detail : ''); b.setAttribute('aria-label', b.title);
    const t = $('#sync-status'); if (t) t.innerHTML = statusLine();
  }
  function statusLine() {
    const n = pending(); const when = cfg.last ? new Date(cfg.last).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const txt = { off: 'Off on this device.', ok: `Synced${when ? ' ' + when : ''}.${n ? ` ${n} change${n === 1 ? '' : 's'} to send.` : ''}`, partial: `Partly synced${when ? ' ' + when : ''}.${n ? ` ${n} change${n === 1 ? '' : 's'} waiting.` : ''}`, syncing: 'Syncing now…', waiting: `You're offline. ${n} change${n === 1 ? '' : 's'} will send when you're back.`, error: 'Last sync failed.' }[state];
    return `<i class="sync-dot" data-state="${state}"></i> ${esc(txt)}${detail ? ` <span class="muted">${esc(detail)}</span>` : ''}`;
  }

  async function api(method, path, body) {
    let res;
    try { res = await fetch(url() + path, { method, headers: { 'X-App-Key': cfg.key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch (e) { const er = new Error('offline'); er.offline = true; throw er; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const er = new Error(data.detail || data.error || ('HTTP ' + res.status)); er.status = res.status; er.retryAfter = +res.headers.get('Retry-After') || 0; throw er; }
    return data;
  }
  async function pullAll() {
    const out = []; let cursor = null;
    for (let i = 0; i < 50; i++) { const r = await api('GET', '/people?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')); out.push(...r.results); if (!r.has_more || !r.next_cursor) break; cursor = r.next_cursor; }
    return out;
  }
  const gap = () => new Promise(r => setTimeout(r, 350)); // stay well under Notion's ~3 requests a second

  function link(id, row) { const p = Object.assign({}, P(id)); p.nid = row.id; p.nHash = NM.rowHash(row); p.nEdited = row.lastEdited; delete p.nGoneAt; S.people[id] = p; }
  function applyRemote(b, row) {
    const cur = P(b.id); const patch = NM.fromRow(row, b, S.people[b.id]);
    const log = (cur.log || []).slice(); if (patch.stage != null && patch.stage !== cur.stage) log.push({ date: todayISO(), stage: patch.stage, from: 'notion' });
    S.people[b.id] = Object.assign({}, cur, patch, { log, updated: Date.parse(row.lastEdited) || Date.now() });
    link(b.id, row);
  }
  function walkinFrom(row) {
    const w = NM.walkinFromRow(row, D.towns, S.prefs.visitTown); const t = town(w.town);
    const id = 'walkin-n' + sid(row.id).slice(0, 10);
    const b = { id, name: w.name, town: t.id, cat: (D.cats[0] || {}).id ?? 0, type: 'From Notion', addr: '', web: '', phone: '', need: '', offers: '', why: '', la: t.la, lo: t.lo, approx: true, custom: true, potential: 1, persona: 'dealer', added: todayISO(), fromNotion: true, townGuessed: w.townGuessed, metAt: row.metAt };
    S.ed.biz[id] = { isNew: true, f: b, updated: Date.now() }; rebuild(); return BY[id];
  }

  function ctxNow() {
    return { towns: D.towns, cats: D.cats, personas: D.personas, biz: BIZ,
      nidOf: (c, id) => (S.ed[c][id] || {}).nid || '',
      idOfNid: (c, nid) => { if (!nid) return ''; const k = sid(nid); for (const [id, e] of Object.entries(S.ed[c])) if (e.nid && sid(e.nid) === k) return id; return ''; } };
  }
  async function pullColl(ep) {
    const out = []; let cursor = null; let db = '';
    for (let i = 0; i < 50; i++) { const r = await api('GET', `/c/${ep}?limit=100` + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')); out.push(...r.results); db = r.db || db; if (!r.has_more || !r.next_cursor) break; cursor = r.next_cursor; }
    out.db = db; return out;
  }
  // One collection, record by record. Newest edit wins; deletes are Archived ticks in Notion; offline changes just stay "dirty" until next time.
  async function syncColl(coll, cs) {
    const ep = C.ENDPOINT[coll]; const ED = S.ed[coll];
    const remote = await pullColl(ep);
    // the rows moved to a different Notion database: forget the old row links and match again by App ID
    S.collDb = S.collDb || {};
    if (remote.db && S.collDb[coll] !== remote.db) {
      if (S.collDb[coll]) for (const id of Object.keys(ED)) { const e = ED[id] = Object.assign({}, ED[id]); delete e.nid; delete e.nHash; delete e.syncedAt; if (e.del) e.delSynced = false; }
      else for (const id of Object.keys(ED)) if (ED[id].nid && !remote.some(r => sid(r.id) === sid(ED[id].nid))) { const e = ED[id] = Object.assign({}, ED[id]); delete e.nid; delete e.nHash; delete e.syncedAt; if (e.del) e.delSynced = false; }
      S.collDb[coll] = remote.db; save();
    }
    const byNid = new Map(remote.map(r => [sid(r.id), r])); const byApp = new Map();
    for (const r of remote) if (r.appId && !byApp.has(r.appId)) byApp.set(r.appId, r);
    const empty = remote.length === 0; const used = new Set(); const ops = []; let changed = false;
    const ctx = ctxNow(); const now = Date.now();
    const gone = id => { const e = ED[id] = Object.assign({}, ED[id]); e.del = true; e.delSynced = true; e.gone = now; changed = true; };
    const applyRow = (id, r) => {
      const cur = eff(coll, id) || { id }; const next = Object.assign({}, cur, C.fromRow(coll, r, ctx, cur));
      const e = ED[id] = Object.assign({}, ED[id]); e.f = SEED[coll][id] ? C.diff(SEED[coll][id], next) : Object.assign({}, next); e.isNew = !SEED[coll][id];
      e.del = false; e.delSynced = false; e.nid = r.id; e.nHash = C.rowHash(coll, r); e.updated = Date.parse(r.lastEdited) || now; changed = true; cs.pulled++;
    };
    const ids = new Set([...Object.keys(SEED[coll]), ...Object.keys(ED)]);
    for (const id of ids) {
      let e = ED[id]; if (!SEED[coll][id] && !(e && e.f)) continue;
      let r = e && e.nid ? byNid.get(sid(e.nid)) : null; if (!r && !(e && e.nid)) r = byApp.get(id) || null;
      if (r) used.add(sid(r.id));
      const lu = (e && e.updated) || 0, re = r ? Date.parse(r.lastEdited) || 0 : 0;
      if (e && e.del) { if (r && !r.archived && !e.delSynced) ops.push(['del', id, r.id]); else if (!e.delSynced) { e.delSynced = true; changed = true; } continue; }
      if (!r || r.archived) {
        if (r && r.archived) { if (lu > re && e && e.nHash) ops.push(['patch', id, r.id]); else gone(id); }
        else if (e && e.nid) { if (lu > (e.syncedAt || 0)) ops.push(['post', id]); else gone(id); }
        else if (empty || !SEED[coll][id] || lu) ops.push(['post', id]);
        else gone(id);
        continue;
      }
      if (!e || !e.nid) { e = ED[id] = Object.assign({}, e, { nid: r.id }); changed = true; }
      const lh = C.rowHash(coll, C.toRow(coll, eff(coll, id), ctx)), rh = C.rowHash(coll, r);
      if (lh === rh) { if (e.nHash !== rh) { e.nHash = rh; e.syncedAt = now; changed = true; } continue; }
      const act = NM.decide({ localDirty: e.nHash ? lh !== e.nHash : !!lu, remoteChanged: e.nHash ? rh !== e.nHash : true, localUpdated: lu, remoteEdited: r.lastEdited });
      if (act === 'pull') { applyRow(id, r); if (C.rowHash(coll, C.toRow(coll, eff(coll, id), ctxNow())) !== rh) ops.push(['patch', id, r.id]); }
      else if (act === 'push') ops.push(['patch', id, r.id]);
    }
    // rows added in Notion
    for (const r of remote) {
      if (used.has(sid(r.id)) || r.archived || !String(r.name || r.title || '').trim()) continue;
      if (r.appId && ids.has(r.appId)) continue; // a second row for the same item: leave it alone
      const id = r.appId || (coll === 'biz' ? 'walkin' : coll === 'intro' ? 'my' : (C.fromRow(coll, r, ctx, {}).kind || 'item')) + '-n' + sid(r.id).slice(-12);
      const base = coll === 'list' ? { id } : coll === 'biz' ? { id, custom: true } : { id, mine: true };
      const rec = Object.assign(base, C.fromRow(coll, r, ctx, base));
      if (coll === 'list') { const k = rec.kind; if (k === 'town' && !rec.key) rec.key = C.slug(rec.name); if (k === 'cat' && !rec.key) rec.key = String(Math.max(-1, ...D.cats.map(c => c.id)) + 1); if (k === 'persona' && !rec.key) rec.key = C.slug(rec.name); if (k === 'text' && !rec.key) rec.key = C.slug(rec.name); }
      if (coll === 'intro' && (!rec.a || !rec.b)) continue; // needs both businesses picked
      ED[id] = { isNew: true, f: rec, nid: r.id, nHash: C.rowHash(coll, r), updated: Date.parse(r.lastEdited) || now, syncedAt: now };
      changed = true; cs.added++;
      if (!r.appId || C.rowHash(coll, C.toRow(coll, rec, ctxNow())) !== C.rowHash(coll, r)) ops.push(['patch', id, r.id]);
    }
    if (changed) { save(); rebuild(); }
    for (const [op, id, nid] of ops) {
      const e = ED[id] = Object.assign({}, ED[id]);
      if (op === 'del') { try { await api('DELETE', `/c/${ep}/${encodeURIComponent(nid)}`); } catch (x) { if (x.status !== 404 && x.status !== 410) throw x; } e.delSynced = true; save(); cs.sent++; await gap(); continue; }
      const rec = eff(coll, id); if (!rec) continue; const row = C.toRow(coll, rec, ctxNow());
      let res;
      try { res = op === 'post' ? await api('POST', `/c/${ep}`, row) : await api('PATCH', `/c/${ep}/${encodeURIComponent(nid)}`, row); }
      catch (x) { if ((x.status === 404 || x.status === 410) && op === 'patch') res = await api('POST', `/c/${ep}`, row); else throw x; }
      e.nid = res.id; e.nHash = C.rowHash(coll, res); e.syncedAt = Date.now(); delete e.gone; save(); cs.sent++; await gap();
    }
  }

  async function run() {
    if (!on()) { setState('off'); return; }
    if (busy) { again = true; return; }
    if (navigator.onLine === false) { setState('waiting'); return; }
    busy = true; setState('syncing'); let changed = false, made = 0, pulled = 0, added = 0;
    try {
      const remote = await pullAll();
      const byId = new Map(remote.map(r => [sid(r.id), r])); const seen = new Set((S.syncIgnore || []).map(sid));
      // rows linked to anything here (even a deleted business) are never re-imported as new walk-ins
      for (const p of Object.values(S.people)) if (p && p.nid) seen.add(sid(p.nid));
      for (const [id, e] of Object.entries(S.ed.biz)) if (e.del && S.people[id] && S.people[id].nid) seen.add(sid(S.people[id].nid));
      const ops = [];
      // 1. records already linked to a Notion row
      for (const b of BIZ) {
        const p = S.people[b.id]; if (!p || !p.nid) continue;
        const r = byId.get(sid(p.nid));
        if (!r) { // deleted or archived in Notion: keep the local notes, stop syncing until edited again
          const q = Object.assign({}, p); delete q.nid; delete q.nHash; q.nGoneAt = Date.now(); S.people[b.id] = q; changed = true; continue; }
        seen.add(sid(r.id));
        const lh = NM.rowHash(rowFor(b)), rh = NM.rowHash(r);
        if (lh === rh) { if (p.nHash !== rh) { link(b.id, r); changed = true; } continue; }
        const act = NM.decide({ localDirty: lh !== p.nHash, remoteChanged: rh !== p.nHash, localUpdated: p.updated, remoteEdited: r.lastEdited });
        if (act === 'pull') { applyRemote(b, r); pulled++; changed = true; if (NM.rowHash(rowFor(b)) !== rh) ops.push(b.id); }
        else if (act === 'push') ops.push(b.id);
      }
      // 2. Notion rows the app hasn't linked yet: match to a business by "Met at", else a new walk-in
      for (const r of remote) {
        if (seen.has(sid(r.id)) || NM.isBlankRow(r)) continue;
        const free = BIZ.filter(x => !(S.people[x.id] || {}).nid);
        const b = NM.matchBiz(r, free, D.towns);
        if (b) {
          const p = S.people[b.id];
          if (NM.hasData(p) && (p.updated || 0) > (Date.parse(r.lastEdited) || 0)) { link(b.id, r); ops.push(b.id); }
          else { applyRemote(b, r); pulled++; if (NM.rowHash(rowFor(b)) !== NM.rowHash(r)) ops.push(b.id); }
        } else { const w = walkinFrom(r); applyRemote(w, r); added++; if (NM.rowHash(rowFor(w)) !== NM.rowHash(r)) ops.push(w.id); }
        seen.add(sid(r.id)); changed = true;
      }
      // 3. people with something recorded here but no Notion row yet
      for (const b of BIZ) { const p = S.people[b.id]; if (p && !p.nid && NM.hasData(p) && !(p.nGoneAt && (p.updated || 0) <= p.nGoneAt) && !ops.includes(b.id)) ops.push(b.id); }
      if (changed) { save(); rebuild(); afterChange(); }
      // push, one at a time
      for (const id of ops) {
        const b = BY[id]; if (!b) continue; const p = P(id); const row = rowFor(b);
        const res = p.nid ? await api('PATCH', '/people/' + encodeURIComponent(p.nid), row) : await api('POST', '/people', row);
        link(id, res); save(); made++; await gap();
      }
      // people you deleted here: their Notion rows go to Trash
      for (const nid of (S.peopleTrash || []).slice()) { try { await api('DELETE', '/people/' + encodeURIComponent(nid)); } catch (e) { if (e.offline) throw e; if (e.status !== 404 && e.status !== 410) throw e; } S.peopleTrash = S.peopleTrash.filter(x => x !== nid); save(); made++; await gap(); }
      // businesses, introductions, and towns & lists
      const cs = { sent: 0, pulled: 0, added: 0 }; colls = { people: 'ok' };
      for (const coll of C.COLLS) {
        try { await syncColl(coll, cs); colls[coll] = 'ok'; }
        catch (e) {
          if (e.offline) throw e;
          colls[coll] = ((e.status === 404 && /not_found|Could not find/i.test(e.message || '')) || (e.status === 500 && /not_configured/.test(e.message || ''))) ? 'unshared' : 'error';
          collErr[coll] = e.message || String(e.status || '');
        }
      }
      made += cs.sent; pulled += cs.pulled; added += cs.added;
      cfg.last = Date.now(); saveCfg(); retryMs = 0;
      const nameOf = { biz: 'Businesses', intro: 'Introductions', list: 'Towns & lists' };
      const bad = C.COLLS.filter(c => colls[c] !== 'ok');
      const unshared = bad.filter(c => colls[c] === 'unshared').map(c => nameOf[c]), failed = bad.filter(c => colls[c] === 'error').map(c => nameOf[c]);
      const done = [made && `${made} sent`, pulled && `${pulled} updated from Notion`, added && `${added} new from Notion`];
      if (!bad.length) setState('ok', done.filter(Boolean).join(' · '));
      else {
        setState('partial', [`People${C.COLLS.filter(c => colls[c] === 'ok').map(c => ', ' + nameOf[c]).join('')} synced`, ...done,
          unshared.length && `${unshared.join(', ')} not shared with the sync integration yet; those changes wait here`,
          failed.length && `${failed.join(', ')} failed to sync, will retry`].filter(Boolean).join(' · '));
        if (failed.length) retryLater();
      }
      if (cs.pulled || cs.added) { rebuild(); afterChange(); if (tab === 'intros') renderIntros(); }
      if (focusId && (pulled || added) && $('#sheet').classList.contains('open') && !document.activeElement?.closest?.('#sheet')) openCard(focusId);
      if (pulled || added) toast(`Notion: ${[pulled && `${pulled} updated`, added && `${added} new walk-in${added === 1 ? '' : 's'}`].filter(Boolean).join(', ')}`);
    } catch (e) {
      if (e.offline) { setState('waiting'); retryLater(); }
      else if (e.status === 401) setState('error', 'Wrong passphrase. Open Notion sync to fix it.');
      else if (e.status === 403) setState('error', 'This site address is not allowed by the sync service.');
      else if (e.status === 410 || e.status === 404) setState('error', 'A Notion row was deleted; trying again.'), retryLater(15000);
      else { setState('error', e.message); retryLater(e.retryAfter ? e.retryAfter * 1000 : 0); }
    } finally {
      busy = false; if (again) { again = false; schedule(1500); }
    }
  }
  function retryLater(ms) { retryMs = ms || Math.min(5 * 60e3, retryMs ? retryMs * 2 : 30e3); clearTimeout(timer); timer = setTimeout(run, retryMs); }
  function schedule(ms = 4000) { if (!on()) return; setState(state === 'off' ? 'ok' : state); clearTimeout(timer); timer = setTimeout(run, ms); }

  function dialog() {
    openDialog(`<h2>Notion sync</h2>
      <p>Keeps the atlas in step with your Notion: people in <b>People I've Met</b> (status and visit dates ride on the first line of Notes), and every business, introduction, town and list in the three <b>Heirloom Atlas</b> databases.</p>
      <p class="small muted">Edit in either place; the newer edit wins. Deleting here ticks Archived in Notion. The visit log and walking routes stay on this device.</p>
      <label class="field">Passphrase (once per device)<input class="inp" name="key" type="password" autocomplete="current-password" value="${esc(cfg.key || '')}" placeholder="the sync passphrase"></label>
      <details class="acc"><summary>Advanced</summary><label class="field" style="margin-top:8px">Sync service address<input class="inp" name="url" type="url" value="${esc(cfg.url || DEF)}" placeholder="https://heirloom-atlas-sync.….workers.dev" autocomplete="off"></label></details>
      <p class="small" id="sync-status">${statusLine()}</p>
      <div class="acts">${on() ? `<button class="btn ghost" type="button" id="s-off">Turn off on this device</button><button class="btn" type="button" id="s-now">Sync now</button>` : ''}<button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="ok">${on() ? 'Save' : 'Turn on'}</button></div>`, fd => {
      const key = String(fd.get('key') || '').trim(), u = String(fd.get('url') || '').trim();
      if (!key) { toast('Enter the passphrase'); return false; }
      if (!u) { toast('The sync service address is missing (Advanced)'); return false; }
      if (!/^https:\/\//.test(u)) { toast('The address must start with https://'); return false; }
      cfg.key = key; cfg.url = u === DEF ? '' : u; cfg.off = false; saveCfg(); toast('Notion sync on'); run();
    });
    const off = $('#s-off'); if (off) off.onclick = () => { cfg = { url: cfg.url }; saveCfg(); clearTimeout(timer); setState('off'); $('#dlg').close(); toast('Notion sync off on this device. Your Notion rows are untouched.'); };
    const now = $('#s-now'); if (now) now.onclick = () => run();
  }

  function init() {
    if (!NM) return;
    window.addEventListener('online', () => schedule(500));
    window.addEventListener('offline', () => on() && setState('waiting'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && on() && Date.now() - (cfg.last || 0) > 120e3) schedule(300); });
    setInterval(() => { if (on() && document.visibilityState === 'visible' && !busy) run(); }, 10 * 60e3);
    if (on()) { setState('ok'); run(); } else setState('off');
  }
  return { init, run, schedule, dialog, on, pending, _state: () => state, _colls: () => Object.assign({}, colls) };
})();
window.__sync = Sync;
// hooks for the local end-to-end checks (scripts/*-e2e.mjs); harmless in normal use
window.__test = { editRec, addRec, delRec, undo, commit: () => commit(), firstIntro: () => INTROS[0].id, D: () => D, BY: () => BY };
boot();
})();
