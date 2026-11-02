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

let D;              // reference data (data.json)
let S;              // saved state
let BIZ = [], BY = {}, INTROS = [];
const F = { q: '', town: 'all', stage: 'all', cats: new Set() };
let layout = 'graph', tab = 'people', focusId = null, visitTown = null, graph = null, map = null, mapReady = false, globeOn = false;

/* ---------------- state ---------------- */
function blank() { return { v: 1, people: {}, intros: {}, myIntros: [], myBiz: [], checks: {}, prefs: {} }; }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return Object.assign(blank(), s); } catch (e) { /* ignore */ }
  return blank();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save on this device (storage full or private mode).'); } }
const P = id => S.people[id] || { stage: 0, notes: '', met: '', last: '', next: '', log: [] };
function setP(id, patch) { S.people[id] = Object.assign({}, P(id), patch); save(); }

function rebuild() {
  BIZ = D.biz.concat(S.myBiz.map(b => Object.assign({ custom: true, potential: 1, ask: { who: b.askWho || 'Your notes' }, persona: 'dealer', opener: '', need: b.need || '', offers: b.offers || '' }, b)));
  BY = Object.fromEntries(BIZ.map(b => [b.id, b]));
  INTROS = D.intros.map(i => Object.assign({ mine: false }, i)).concat(S.myIntros.map(i => Object.assign({ mine: true, strength: 2, kind: 'Yours' }, i)))
    .filter(i => BY[i.a] && BY[i.b]);
}
const introState = i => i.mine ? (i.state || 'open') : ((S.intros[i.id] || {}).state || 'open');
const town = id => D.towns.find(t => t.id === id) || { id, name: id };
const cat = c => D.cats[c] || { name: 'Other', ink: '#8a7a61' };
const partners = id => INTROS.filter(i => (i.a === id || i.b === id) && introState(i) !== 'declined').map(i => ({ intro: i, other: BY[i.a === id ? i.b : i.a] }));

/* ---------------- toast ---------------- */
let tt; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------------- filters ---------------- */
function matches(b) {
  if (F.town !== 'all' && b.town !== F.town) return false;
  if (F.cats.size && !F.cats.has(b.cat)) return false;
  const p = P(b.id);
  if (F.stage === 'due') { if (!(p.next && p.next <= addDays(todayISO(), 7))) return false; }
  else if (F.stage !== 'all' && String(p.stage) !== F.stage) return false;
  if (F.q) {
    const hay = [b.name, b.type, town(b.town).name, b.need, b.offers, b.why, cat(b.cat).name, p.notes, p.met, b.addr].join(' ').toLowerCase();
    if (!F.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function filtersActive() { return F.q || F.town !== 'all' || F.stage !== 'all' || F.cats.size; }

function buildFilters() {
  $('#f-town').innerHTML = `<option value="all">All 7 towns</option>` + D.towns.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  $('#f-stage').innerHTML = `<option value="all">Any status</option>` + STAGES.map((s, i) => `<option value="${i}">${s}</option>`).join('') + `<option value="due">Visit due this week</option>`;
  $('#f-cats').innerHTML = D.cats.map(c => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="true"><i style="background:${c.ink}"></i>${esc(c.name)}</button>`).join('');
  $('#graph-legend').innerHTML = D.cats.map(c => `<span><i style="background:${c.ink}"></i>${esc(c.name)}</span>`).join('') + `<span><i class="ln"></i>Suggested</span><span><i class="ln g"></i>Made</span>`;
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

/* ---------------- dashboard ---------------- */
function renderDash() {
  const counts = [0, 0, 0, 0, 0]; for (const b of BIZ) counts[P(b.id).stage]++;
  const made = INTROS.filter(i => introState(i) === 'made').length;
  const open = INTROS.filter(i => introState(i) === 'open').length;
  const t = todayISO(); const wk = addDays(t, 7);
  const due = BIZ.filter(b => P(b.id).next && P(b.id).next <= t).length;
  const soon = BIZ.filter(b => P(b.id).next && P(b.id).next <= wk).length;
  const nextEv = D.events.filter(e => (e.end || e.date) >= t)[0];
  $('#dash').innerHTML =
    STAGES.map((s, i) => `<button class="stat ${F.stage === String(i) ? 'on' : ''}" data-stage="${i}" type="button"><b>${counts[i]}</b><span><i class="pip s${i}"></i>${s}</span></button>`).join('') +
    `<button class="stat sep" data-go="intros" type="button"><b>${made}</b><span>Intros made · ${open} to consider</span></button>` +
    `<button class="stat ${F.stage === 'due' ? 'on' : ''}" data-stage="due" type="button"><b>${due}</b><span>Visits due now${soon > due ? ` · ${soon - due} this week` : ''}</span></button>` +
    (nextEv ? `<button class="stat wide" data-ev="${nextEv.town}" type="button"><b>${esc(nextEv.label)} · ${esc(town(nextEv.town).name)}</b><span>Next: ${esc(nextEv.what)}</span></button>` : '');
}
function dashClick(e) {
  const b = e.target.closest('.stat'); if (!b) return;
  if (b.dataset.go) return go(b.dataset.go);
  if (b.dataset.ev) { visitTown = b.dataset.ev; return go('visits'); }
  const st = b.dataset.stage; F.stage = F.stage === st ? 'all' : st; $('#f-stage').value = F.stage;
  go('people'); if (F.stage !== 'all' && layout === 'graph' && innerWidth < 720) setLayout('list');
  refreshPeople(); renderDash();
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
  z.innerHTML = `<button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button><button type="button" aria-label="Fit all" style="font-size:13px">⤢</button>`;
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
  if (first || nodes.length !== (old.nodes || []).length || links.length !== (old.links || []).length) graph.graphData({ nodes, links });
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
  if (focusId) { if (a === focusId || b === focusId) return st === 'made' ? '#a8802f' : 'rgba(168,128,47,.85)'; return 'rgba(43,36,25,.05)'; }
  if (filtersActive() && !(matches(BY[a]) && matches(BY[b]))) return 'rgba(43,36,25,.04)';
  return st === 'made' ? '#a8802f' : `rgba(43,36,25,${0.1 + 0.06 * (l.strength || 1)})`;
}
function linkWidth(l) { const [a, b] = linkEnds(l); const st = introState(l); return (st === 'made' ? 2.6 : 0.6 + 0.35 * (l.strength || 1)) + (focusId && (a === focusId || b === focusId) ? 1.2 : 0); }
function drawNode(n, ctx, k) {
  const lit = isLit(n); const r = radius(n); const st = P(n.id).stage;
  ctx.globalAlpha = lit ? 1 : 0.14;
  if (st > 0) { ctx.beginPath(); ctx.arc(n.x, n.y, r + 2.2 + st * 0.6, 0, 2 * Math.PI); ctx.strokeStyle = st === 4 ? '#a8802f' : 'rgba(168,128,47,.75)'; ctx.lineWidth = st === 4 ? 2.4 : 1.2; ctx.stroke(); if (st === 4) { ctx.fillStyle = 'rgba(241,229,196,.7)'; ctx.fill(); } }
  ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fillStyle = cat(n.cat).ink; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#fbf7ec'; ctx.stroke();
  if (n.founder) { ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.32, 0, 2 * Math.PI); ctx.fillStyle = '#fbf7ec'; ctx.fill(); }
  if (n.custom) { ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI); ctx.strokeStyle = '#2b2419'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
  const show = n.id === focusId || n.id === hoverId || (focusId && lit) || k > 2.1 || (!focusId && filtersActive() && lit && BIZ.filter(matches).length <= 12) || (k > 1.25 && (n.potential || 0) >= 9);
  if (show) {
    const fs = (n.id === focusId ? 13 : 11.5) / k; ctx.font = `${n.id === focusId ? 600 : 500} ${fs}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const label = n.name.length > 30 ? n.name.slice(0, 28) + '…' : n.name;
    ctx.lineWidth = 3.2 / k; ctx.strokeStyle = 'rgba(251,247,236,.95)'; ctx.strokeText(label, n.x, n.y + r + 3 / k);
    ctx.fillStyle = '#2b2419'; ctx.fillText(label, n.x, n.y + r + 3 / k);
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
    ctx.font = `italic 500 ${15 / k}px Fraunces, Georgia, serif`; ctx.fillStyle = '#8a7a61';
    ctx.fillText(town(t).name, cx, top);
    ctx.beginPath(); ctx.moveTo(cx - 18 / k, top + 3 / k); ctx.lineTo(cx + 18 / k, top + 3 / k); ctx.strokeStyle = 'rgba(168,128,47,.5)'; ctx.lineWidth = 1 / k; ctx.stroke();
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
  const groups = D.towns.map(t => ({ t, items: shown.filter(b => b.town === t.id).sort((a, b) => (b.potential || 0) - (a.potential || 0)) })).filter(g => g.items.length);
  el.innerHTML = groups.map(g => `<section class="town-group"><h3>${esc(g.t.name)} <small>${g.items.length} ${g.items.length === 1 ? 'business' : 'businesses'} · ${esc(g.t.day)}</small></h3><div class="cards">${g.items.map(b => personCard(b)).join('')}</div></section>`).join('');
}
function clearFilters() { F.q = ''; F.town = 'all'; F.stage = 'all'; F.cats.clear(); $('#q').value = ''; $('#f-town').value = 'all'; $('#f-stage').value = 'all'; $$('.chip', $('#f-cats')).forEach(x => x.setAttribute('aria-pressed', 'true')); refreshPeople(); renderDash(); }

/* ---------------- person card ---------------- */
function openCard(id) {
  const b = BY[id]; if (!b) return; focusId = id; const p = P(id); const c = cat(b.cat); const T = town(b.town);
  const per = D.personas[b.persona] || D.personas.dealer;
  const ps = partners(id).sort((x, y) => (y.intro.strength || 0) - (x.intro.strength || 0));
  const evs = D.events.filter(e => e.at === id && (e.end || e.date) >= todayISO());
  $('#sheet-body').innerHTML = `
    <div class="card-head"><div class="seal-dot" style="background:${c.ink}">${esc(b.name[0])}</div>
      <div><div class="eyebrow">${esc(c.name)} · ${esc(T.name)}</div><h2>${esc(b.name)}</h2><p>${esc(b.type)}${b.theme ? ` · ${esc(b.theme)}` : ''}</p></div></div>
    <div class="pipeline" role="group" aria-label="Status">${STAGES.map((s, i) => `<button type="button" data-stage="${i}" class="${i < p.stage ? 'done' : ''} ${i === p.stage ? 'cur' : ''}" aria-pressed="${i === p.stage}"><span class="pip">${i < p.stage ? '✓' : i + 1}</span>${s}</button>`).join('')}</div>
    ${p.last ? `<p class="small muted" style="margin:6px 0 0">Last visit ${fmtDate(p.last)}${p.next ? ` · next ${fmtDate(p.next)}` : ''} · ${(p.log || []).filter(l => l.visit).length || 1} visit${((p.log || []).filter(l => l.visit).length || 1) === 1 ? '' : 's'} logged</p>` : ''}

    <div class="sec"><h3>Who to ask for</h3><p><b>${esc(b.ask.who)}</b>${b.ask.named ? '' : ''}</p>${b.ask.note ? `<p class="small muted">${esc(b.ask.note)}</p>` : `<p class="small muted">A role, not a name: the source doesn't name a person here.</p>`}</div>

    ${b.opener ? `<div class="sec"><h3>Opener <span class="guess">suggestion</span></h3><p class="quote">“Hi, I'm Cyrus. Not buying or selling today, just getting to know the people in town.”</p><p class="quote">“${esc(b.opener)}”</p>${b.openerNote ? `<p class="opnote">${esc(b.openerNote)}</p>` : ''}</div>` : ''}

    ${!b.custom ? `<div class="sec"><h3>How to approach <span class="guess">a guess</span></h3>
      <p><b>${esc(per.label)}.</b> ${esc(per.read)}</p><p class="small"><span class="muted">Listen for:</span> ${esc(per.listen)}</p>
      <p class="tiny muted">Based only on their type of business (Chase Hughes's social needs, used as listening prompts, never labels). Test it, then trust what you see.</p></div>` : ''}

    <div class="sec"><h3>Their need <span class="guess">starting guess</span></h3><p>${esc(b.need || '—')}</p>${b.offers ? `<p class="small"><span class="muted">They could offer:</span> ${esc(b.offers)}</p>` : ''}</div>

    ${b.why ? `<div class="sec"><h3>Why they matter</h3><p>${esc(b.why)}</p></div>` : ''}

    ${b.watch ? `<div class="alert"><b>On the retiring-founder watchlist.</b> ${esc(b.watch.company)}, ${esc(b.watch.founded)}. ${esc(b.watch.directors)}.<br><span class="muted">Angle:</span> ${esc(b.watch.angle)}. Public-register facts as of 2 Nov 2026; a reason to ask about their story, never an opener.</div>` : ''}

    <div class="sec"><h3>Who they could meet <span class="guess">suggestions</span></h3>
      ${ps.length ? `<div class="meet">${ps.map(x => `<button type="button" data-open="${x.other.id}"><i style="background:${cat(x.other.cat).ink}"></i><b>${esc(x.other.name)}${introState(x.intro) === 'made' ? ' · made ✓' : ''}</b><span>${esc(x.intro.why)} ${x.intro.km > 3 ? `(${x.intro.km} km apart)` : ''}</span></button>`).join('')}</div>` : `<p class="muted small">No suggestions yet. Add your own on the Introductions tab.</p>`}
    </div>

    ${evs.length ? `<div class="sec"><h3>Coming up here</h3>${evs.map(e => `<p class="small"><b>${esc(e.label)}</b> · ${esc(e.what)}</p>`).join('')}</div>` : ''}

    <div class="sec"><h3>Your notes</h3>
      <div class="note-box">
        <label class="field">Who you met (their real name, once they've told you)<input class="inp" id="n-met" value="${esc(p.met)}" placeholder="e.g. the owner, Sarah" autocomplete="off"></label>
        <label class="field">Notes: what they need, one personal detail, what to try next<textarea class="inp" id="n-notes" placeholder="What I tried, what happened, what I'll try next">${esc(p.notes)}</textarea></label>
        <div class="row2"><label class="field">Last visit<input class="inp" type="date" id="n-last" value="${esc(p.last)}"></label><label class="field">Next visit<input class="inp" type="date" id="n-next" value="${esc(p.next)}"></label></div>
        <div class="row"><button class="btn small gold" type="button" id="n-today">Visited today</button><button class="btn small" type="button" data-plus="28">Back in 4 weeks</button><button class="btn small" type="button" data-plus="42">6 weeks</button>${p.next ? `<button class="btn small" type="button" id="n-ics">Add to calendar (.ics)</button>` : ''}</div>
      </div>
    </div>

    <div class="sec"><h3>Details</h3><dl class="kv">
      <dt>Address</dt><dd>${esc(b.addr || '—')} ${b.la ? `· <a href="https://www.openstreetmap.org/?mlat=${b.la}&mlon=${b.lo}#map=18/${b.la}/${b.lo}" target="_blank" rel="noopener">map</a>` : ''}${b.approx ? `<br><span class="small muted">Pin is approximate: on the site or town centre, not the exact door.</span>` : ''}</dd>
      ${b.web ? `<dt>Website</dt><dd><a href="${esc(b.web)}" target="_blank" rel="noopener">${esc(b.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}
      ${b.phone ? `<dt>Shop phone</dt><dd>${esc(b.phone)}</dd>` : ''}
      <dt>Town</dt><dd>${esc(T.name)}${T.day ? ` · best day: ${esc(T.day)}` : ''}</dd>
      <dt>Source</dt><dd class="small">${b.custom ? 'Added by you' : 'Network towns research, 2 Nov 2026 (Companies House and local directories)'}</dd>
    </dl>
    ${b.custom ? `<div class="row" style="margin-top:10px"><button class="btn small" type="button" id="n-del">Remove this walk-in</button></div>` : ''}</div>`;
  const sh = $('#sheet'); sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = innerWidth >= 720;
  $('#sheet-body').scrollTop = 0;
  if (history.replaceState) history.replaceState(null, '', '#' + tab + '/' + id);
  wireCard(id);
  if (tab === 'people' && layout === 'graph') { focusGraph(id); kick(); }
  if (tab === 'where' && mapReady) flyToBiz(b);
}
function wireCard(id) {
  const body = $('#sheet-body');
  $$('.pipeline button', body).forEach(btn => btn.onclick = () => setStage(id, +btn.dataset.stage));
  $('#n-met', body).onchange = e => { setP(id, { met: e.target.value.trim() }); toast('Saved'); };
  $('#n-notes', body).onchange = e => { setP(id, { notes: e.target.value }); toast('Saved'); };
  $('#n-last', body).onchange = e => { setP(id, { last: e.target.value }); renderDash(); };
  $('#n-next', body).onchange = e => { setP(id, { next: e.target.value }); renderDash(); openCard(id); };
  $('#n-today', body).onclick = () => { logVisit(id); openCard(id); toast('Visit logged for today'); };
  $$('[data-plus]', body).forEach(b => b.onclick = () => { setP(id, { next: addDays(P(id).last || todayISO(), +b.dataset.plus) }); renderDash(); openCard(id); toast('Next visit set'); });
  const ics = $('#n-ics', body); if (ics) ics.onclick = () => downloadICS(id);
  const del = $('#n-del', body); if (del) del.onclick = () => { if (!confirm('Remove this walk-in and its notes from this device?')) return; S.myBiz = S.myBiz.filter(b => b.id !== id); delete S.people[id]; S.myIntros = S.myIntros.filter(i => i.a !== id && i.b !== id); save(); rebuild(); closeCard(); afterChange(); toast('Removed'); };
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
let introFilter = 'open', introKind = 'all', introTown = 'all';
function renderIntros() {
  const el = $('#view-intros');
  const counts = { open: 0, made: 0, declined: 0, mine: 0, all: INTROS.length };
  for (const i of INTROS) { counts[introState(i)]++; if (i.mine) counts.mine++; }
  const kinds = [...new Set(INTROS.map(i => i.kind))];
  let list = INTROS.filter(i => introFilter === 'all' || (introFilter === 'mine' ? i.mine : introState(i) === introFilter));
  if (introKind !== 'all') list = list.filter(i => i.kind === introKind);
  if (introTown !== 'all') list = list.filter(i => BY[i.a].town === introTown || BY[i.b].town === introTown);
  list.sort((x, y) => (y.mine - x.mine) || (y.strength - x.strength) || (x.km - y.km));
  const L = { 3: 'Strong', 2: 'Good', 1: 'Possible' };
  el.innerHTML = `
    <div class="page-head"><div><h2>Introductions worth making</h2>
      <p>${D.intros.length} suggestions matched from what each business needs and offers in your research. They're suggestions, not facts: ask each side privately first, and only introduce if it's in both people's interest.</p></div>
      <button class="btn primary" type="button" id="add-intro">＋ Add your own</button></div>
    <div class="toolbar" style="margin-bottom:12px">
      <div class="seg" role="group" aria-label="Show">${[['open', 'To consider'], ['made', 'Made'], ['declined', 'Declined'], ['mine', 'Yours'], ['all', 'All']].map(([k, l]) => `<button type="button" data-if="${k}" aria-pressed="${introFilter === k}">${l} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
      <label class="sel"><span class="sr">Kind</span><select id="if-kind"><option value="all">Every kind</option>${kinds.map(k => `<option ${introKind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      <label class="sel"><span class="sr">Town</span><select id="if-town"><option value="all">Any town</option>${D.towns.map(t => `<option value="${t.id}" ${introTown === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    </div>
    <div id="intro-list">${list.length ? list.map(i => {
      const A = BY[i.a], B = BY[i.b], st = introState(i);
      return `<article class="intro ${st}">
        <div class="pair"><button class="who" type="button" data-open="${A.id}"><i style="background:${cat(A.cat).ink}"></i>${esc(A.name)}</button><span class="arrow" aria-label="could meet">⟷</span><button class="who" type="button" data-open="${B.id}"><i style="background:${cat(B.cat).ink}"></i>${esc(B.name)}</button></div>
        <p class="why">${esc(i.why)}</p>
        <div class="tags">${i.mine ? '<span class="badge mine">Yours</span>' : '<span class="badge">Suggestion</span>'}${st !== 'open' ? `<span class="badge ${st}">${st === 'made' ? 'Made' : 'Declined'}${i.at || (S.intros[i.id] || {}).at ? ' · ' + fmtDate(i.at || S.intros[i.id].at) : ''}</span>` : ''}<span><span class="strength">${'◆'.repeat(i.strength)}${'◇'.repeat(3 - i.strength)}</span> ${L[i.strength]}</span><span>${esc(i.kind)}</span><span>${esc(town(A.town).name)}${A.town !== B.town ? ` · ${esc(town(B.town).name)}` : ''}${i.km > 3 ? ` · ${i.km} km` : ''}</span><span>${STAGES[P(A.id).stage]} / ${STAGES[P(B.id).stage]}</span></div>
        <div class="acts">${st === 'open' ? `<button class="btn small gold" type="button" data-mark="made" data-id="${i.id}">Mark made</button><button class="btn small" type="button" data-mark="declined" data-id="${i.id}">Not now</button>` : `<button class="btn small" type="button" data-mark="open" data-id="${i.id}">Undo</button>`}${i.mine ? `<button class="btn small ghost" type="button" data-delintro="${i.id}">Delete</button>` : ''}</div>
      </article>`; }).join('') : `<div class="empty"><h4>${introFilter === 'made' ? 'No introductions made yet' : introFilter === 'mine' ? 'You haven\'t added any yet' : 'Nothing here'}</h4>${introFilter === 'made' ? 'When you introduce two people, mark it made and it turns gold on the web.' : 'Add one when you spot two people who should know each other.'}</div>`}</div>`;
  $$('[data-if]', el).forEach(b => b.onclick = () => { introFilter = b.dataset.if; renderIntros(); });
  $('#if-kind').onchange = e => { introKind = e.target.value; renderIntros(); };
  $('#if-town').onchange = e => { introTown = e.target.value; renderIntros(); };
  $('#add-intro').onclick = () => introDialog();
}
function markIntro(id, st) {
  const i = INTROS.find(x => x.id === id); if (!i) return;
  if (i.mine) { const m = S.myIntros.find(x => x.id === id); m.state = st; m.at = todayISO(); }
  else if (st === 'open') delete S.intros[id]; else S.intros[id] = { state: st, at: todayISO() };
  save(); rebuild(); afterChange(); toast(st === 'made' ? 'Introduction made. Lovely.' : st === 'declined' ? 'Set aside' : 'Back to consider');
}
function introDialog(preA) {
  const opts = BIZ.slice().sort((a, b) => a.name.localeCompare(b.name)).map(b => `<option value="${b.id}" ${b.id === preA ? 'selected' : ''}>${esc(b.name)} (${esc(town(b.town).name)})</option>`).join('');
  openDialog(`<h2>Add an introduction</h2><p>Two people who should know each other. It stays on this device; nothing is sent to anyone.</p>
    <label class="field">First person or business<select class="inp" name="a" required>${opts}</select></label>
    <label class="field">Second<select class="inp" name="b" required>${opts}</select></label>
    <label class="field">Why they should meet<textarea class="inp" name="why" required placeholder="What one needs and the other has"></textarea></label>
    <label class="field">Status<select class="inp" name="state"><option value="open">To consider</option><option value="made">Already made</option></select></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>`, fd => {
    if (fd.get('a') === fd.get('b')) { toast('Pick two different people'); return false; }
    S.myIntros.push({ id: 'my-' + Date.now().toString(36), a: fd.get('a'), b: fd.get('b'), why: fd.get('why').trim(), state: fd.get('state'), at: todayISO() });
    save(); rebuild(); afterChange(); introFilter = 'mine'; if (tab === 'intros') renderIntros(); toast('Introduction added');
  });
}
function walkinDialog() {
  openDialog(`<h2>Add a walk-in</h2><p>Someone new you've met. Saved only on this device; export your data to keep a copy.</p>
    <label class="field">Business name<input class="inp" name="name" required autocomplete="off"></label>
    <div class="row2"><label class="field">Town<select class="inp" name="town">${D.towns.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="field">Trade<select class="inp" name="cat">${D.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <label class="field">What they do<input class="inp" name="type" placeholder="e.g. Silver dealer" autocomplete="off"></label>
    <label class="field">Who you met (their real name, if they gave it)<input class="inp" name="met" autocomplete="off"></label>
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
    S.myBiz.push({ id, name: fd.get('name').trim(), town: t.id, cat: +fd.get('cat'), type: fd.get('type').trim() || 'Walk-in', addr: fd.get('addr').trim(), web, need: fd.get('need').trim(), offers: fd.get('offers').trim(), why: '', la, lo, approx, added: todayISO() });
    S.people[id] = { stage: 1, notes: fd.get('notes'), met: fd.get('met').trim(), last: todayISO(), next: '', log: [{ date: todayISO(), visit: true, stage: 1 }] };
    save(); rebuild(); afterChange(); openCard(id); toast('Walk-in added');
  });
}
function openDialog(html, onOk) {
  const dlg = $('#dlg'); const f = $('#dlg-body'); f.innerHTML = html;
  f.onsubmit = async e => { const sub = e.submitter; if (sub && sub.value === 'cancel') return; e.preventDefault(); const r = await onOk(new FormData(f)); if (r !== false) dlg.close(); };
  dlg.showModal();
}
function afterChange() { renderDash(); if (graph) syncGraphData(); kick(); if (tab === 'intros') renderIntros(); if (tab === 'people' && layout === 'list') renderList(); if (tab === 'visits') renderVisits(); if (mapReady) updateMapData(); }

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
function renderVisits() {
  const el = $('#view-visits'); if (!visitTown) visitTown = S.prefs.visitTown || 'hungerford';
  S.prefs.visitTown = visitTown; save();
  const t = town(visitTown); const route = routeFor(visitTown); const tdy = todayISO();
  const evs = D.events.filter(e => e.town === visitTown);
  const wl = D.watch.filter(w => w.town === visitTown); const sg = D.signals.filter(s => s.town === visitTown);
  const ck = S.checks[tdy] || {};
  const done = route.filter(r => P(r.b.id).stage > 0).length;
  el.innerHTML = `
    <div class="towns-row" role="group" aria-label="Town">${D.towns.map(x => `<button type="button" data-vt="${x.id}" aria-pressed="${x.id === visitTown}">${esc(x.name)}<small>${BIZ.filter(b => b.town === x.id).length}</small></button>`).join('')}</div>
    <div class="vgrid">
      <div>
        <div class="panel town-hero">
          <div class="eyebrow">Visit planner</div><h2>${esc(t.name)}</h2><p class="lead">${esc(t.why)}</p>
          <dl class="kv"><dt>Best day</dt><dd>${esc(t.bestDay)}</dd><dt>Getting there</dt><dd>${esc(t.travel)}</dd><dt>Dates</dt><dd>${esc(t.dates)}</dd></dl>
          <div class="row" style="margin-top:14px"><button class="btn primary" type="button" id="start-today">Start today mode</button><span class="small muted">${done} of ${route.length} visited at least once</span></div>
        </div>
        <div class="panel"><h3>Walking order <small>nearest first, from the town centre</small></h3>
          <ol class="route">${route.map((r, i) => `<li><span class="num" style="background:${cat(r.b.cat).ink}">${i + 1}</span><button class="nm" type="button" data-open="${r.b.id}">${esc(r.b.name)}</button><span class="leg">${legText(r)}</span><span class="sub">${esc(r.b.addr)}${r.b.approx ? ' · approximate pin' : ''} · <i class="pip s${P(r.b.id).stage}" style="vertical-align:-1px"></i> ${STAGES[P(r.b.id).stage]}${P(r.b.id).next ? ` · next ${fmtDate(P(r.b.id).next)}` : ''}</span></li>`).join('')}</ol>
          <p class="tiny muted" style="margin:10px 0 0">Times are straight-line estimates (×1.3 for streets at walking pace). Stops over 2.5 km from the centre are put last as a drive.</p>
        </div>
      </div>
      <div>
        <div class="panel"><h3>Coming up <small>${evs.length} in ${esc(t.name)}</small></h3>
          ${evs.length ? evs.map(e => `<div class="ev"><div class="d ${(e.end || e.date) < tdy ? 'past' : ''}">${esc(e.label)}</div><div class="w">${esc(e.what)}</div><div class="y">${esc(e.why)}${(e.end || e.date) < tdy ? ' · passed' : ''}</div></div>`).join('') : `<p class="muted small">No dated events listed for this town. ${esc(t.dates)}</p>`}
        </div>
        ${wl.length ? `<div class="panel"><h3>Retiring-founder watchlist <small>public register only</small></h3>${wl.map(w => `<div class="wl"><b>${esc(w.company)}</b> · ${esc(w.founded)}<br><span class="muted">${esc(w.directors)}</span><br>${esc(w.angle)}</div>`).join('')}<p class="tiny muted" style="margin:8px 0 0">Birth month and year as published on 2 Nov 2026; no ages guessed. Use it as a reason to ask their story, never as an opener.</p></div>` : ''}
        ${sg.length ? `<div class="panel"><h3>Signals from the register <small>check in person</small></h3>${sg.map(s => `<div class="wl"><b>${esc(s.company)}</b> · ${esc(s.where)}<br><span class="muted">${esc(s.shows)}</span><br>${esc(s.todo)}</div>`).join('')}</div>` : ''}
        <div class="panel"><h3>In the car <small>2 minutes · resets daily</small></h3><ul class="checks">${D.before.map((x, i) => `<li><label><input type="checkbox" data-ck="${i}" ${ck[i] ? 'checked' : ''}>${esc(x)}</label></li>`).join('')}</ul></div>
        <div class="panel"><h3>What to say</h3>
          ${D.flow.map((f, i) => `<details class="acc"${i === 0 ? ' open' : ''}><summary>${i + 1}. ${esc(f.stage)}</summary><p>${esc(f.do)}</p><p class="quote" style="font-size:15px">“${esc(f.say)}”</p><p class="tiny muted">${esc(f.from)}</p></details>`).join('')}
          <details class="acc"><summary>Your 10-second story</summary>${D.story.map(s => `<p><b>${esc(s[0])}.</b> ${esc(s[1])}</p>`).join('')}</details>
          <details class="acc"><summary>After each visit (30 seconds)</summary><ul class="checks" style="margin-top:8px">${D.after.map(x => `<li>· ${esc(x)}</li>`).join('')}</ul></details>
          <p class="tiny muted" style="margin:10px 0 0">VVE = Vanessa Van Edwards, CH = Chase Hughes, VG = Vinh Giang, as summarised in your Who I'm Becoming guide. Wording is a suggestion.</p>
        </div>
      </div>
    </div>`;
  $$('[data-vt]', el).forEach(b => b.onclick = () => { visitTown = b.dataset.vt; renderVisits(); });
  $('#start-today').onclick = () => openToday(visitTown);
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
  $('#map-legend').innerHTML = D.cats.map(c => `<span><i style="background:${c.ink}"></i>${esc(c.name)}</span>`).join('') + `<span><i class="ap"></i>Approximate (${BIZ.filter(b => b.approx).length})</span><span><i style="background:#fff;box-shadow:0 0 0 2px #a8802f"></i>Visited</span>`;
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
      if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#f3ecda');
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
  map.addLayer({ id: 'biz-visited', type: 'circle', source: 'biz', filter: ['>', ['get', 'stage'], 0], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 6.5, 15, 12], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#a8802f', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'biz', type: 'circle', source: 'biz', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4.2, 15, 8.5], 'circle-color': ['get', 'ink'], 'circle-stroke-color': '#fffcf4', 'circle-stroke-width': 1.6, 'circle-opacity': ['case', ['==', ['get', 'show'], 1], 1, 0.18], 'circle-stroke-opacity': ['case', ['==', ['get', 'show'], 1], 1, 0.18] } });
  map.addLayer({ id: 'biz-label', type: 'symbol', source: 'biz', minzoom: 13.5, filter: ['==', ['get', 'show'], 1], layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true }, paint: { 'text-color': '#2b2419', 'text-halo-color': '#fffcf4', 'text-halo-width': 1.6 } });
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
  const rows = [['Business', 'Town', 'Trade', 'Type', 'Status', 'Who you met', 'Last visit', 'Next visit', 'Their need (guess)', 'Could connect with', 'Notes', 'Address', 'Website', 'Phone', 'Added by you']];
  for (const b of BIZ) { const p = P(b.id); rows.push([b.name, town(b.town).name, cat(b.cat).name, b.type, STAGES[p.stage], p.met, p.last, p.next, b.need, partners(b.id).map(x => x.other.name).join('; '), p.notes, b.addr, b.web, b.phone || '', b.custom ? 'yes' : '']); }
  const intros = [['A', 'B', 'Why', 'Kind', 'Strength', 'Status', 'Yours']]; for (const i of INTROS) intros.push([BY[i.a].name, BY[i.b].name, i.why, i.kind, i.strength, introState(i), i.mine ? 'yes' : '']);
  const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n\r\nIntroductions\r\n' + intros.map(r => r.map(csvCell).join(',')).join('\r\n');
  dl(new Blob([csv], { type: 'text/csv' }), `heirloom-atlas-${todayISO()}.csv`);
}
function exportJSON() { dl(new Blob([JSON.stringify({ app: 'heirloom-atlas', exported: new Date().toISOString(), state: S }, null, 1)], { type: 'application/json' }), `heirloom-atlas-backup-${todayISO()}.json`); S.prefs.lastBackup = todayISO(); save(); }
function dataDialog() {
  const n = Object.values(S.people).filter(p => p.stage > 0 || p.notes || p.met).length;
  openDialog(`<h2>Your data</h2><p>Everything you record lives only in this browser on this device: ${n} people with notes or a status, ${S.myBiz.length} walk-ins, ${S.myIntros.length} of your own introductions. Nothing is sent anywhere.</p>
    <p>${S.prefs.lastBackup ? `Last backup: ${fmtDate(S.prefs.lastBackup)}.` : 'No backup yet.'} Save a backup now and then so you never lose it, and to move to another phone.</p>
    <div class="row"><button class="btn primary" type="button" id="d-json">Save backup (.json)</button><button class="btn" type="button" id="d-csv">Export spreadsheet (.csv)</button></div>
    <label class="field">Restore from a backup<input class="inp" type="file" id="d-file" accept="application/json,.json"></label>
    <div class="acts"><button class="btn ghost" type="button" id="d-reset">Erase everything on this device</button><button class="btn" value="cancel" formnovalidate>Close</button></div>`, () => true);
  $('#d-json').onclick = exportJSON; $('#d-csv').onclick = exportCSV;
  $('#d-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); const st = j.state || j; if (st.v !== 1 || typeof st.people !== 'object') throw 0;
      if (!confirm('Replace what is on this device with this backup?')) return;
      S = Object.assign(blank(), st); save(); rebuild(); if (graph) syncGraphData(true); afterChange(); $('#dlg').close(); toast('Backup restored');
    } catch (err) { toast("That file isn't a Heirloom Atlas backup"); }
  };
  $('#d-reset').onclick = () => { if (!confirm('Erase all your statuses, notes, walk-ins and introductions on this device? Save a backup first if unsure.')) return; S = blank(); save(); rebuild(); if (graph) syncGraphData(true); afterChange(); $('#dlg').close(); toast('Erased'); };
}
function aboutDialog() {
  openDialog(`<h2>About this atlas</h2>
    <p><b>${esc(D.definition)}</b> This is your walk-in guide to ${D.biz.length} of them across ${D.towns.length} towns within a day trip of London.</p>
    <ul><li>Businesses, addresses, websites, events and the watchlist come from your Network towns research (2 Nov 2026), checked against Companies House and local directories.</li>
    <li>“Their need”, “How to approach” and every introduction are suggestions derived from each business's type and role. Test them in person.</li>
    <li>No people are named unless the source names them. Record the real names you're given in your notes.</li>
    <li>${D.biz.filter(b => b.approx).length} pins are approximate (${D.biz.filter(b => b.approx).map(b => esc(b.name)).join(', ')}); the rest sit on the postcode point.</li>
    <li>Nothing here contacts anyone. Your notes stay on this device.</li></ul>
    <p class="small">Sources: ${D.sources.map(s => `<a href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])}</a>`).join(' · ')}</p>
    <p class="tiny muted">Built with force-graph (MIT), MapLibre GL JS (BSD), OpenFreeMap tiles © OpenMapTiles © OpenStreetMap contributors, Fraunces and Inter (OFL).</p>
    <div class="acts"><button class="btn primary" value="cancel" formnovalidate>Close</button></div>`, () => true);
}

/* ---------------- boot ---------------- */
async function boot() {
  try { D = await (await fetch('assets/data.json', { cache: 'no-cache' })).json(); }
  catch (e) { document.querySelector('main').innerHTML = `<div class="empty"><h4>Couldn't load the atlas</h4>Check your connection and reload.</div>`; return; }
  S = load(); rebuild(); buildFilters(); renderDash();
  $('#dash').addEventListener('click', dashClick);
  $$('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openCard(o.dataset.open); return; }
    const m = e.target.closest('[data-mark]'); if (m) { markIntro(m.dataset.id, m.dataset.mark); return; }
    const d = e.target.closest('[data-delintro]'); if (d) { if (confirm('Delete this introduction?')) { S.myIntros = S.myIntros.filter(i => i.id !== d.dataset.delintro); save(); rebuild(); afterChange(); } return; }
    if (e.target.closest('[data-clear]')) clearFilters();
  });
  $('#sheet-close').onclick = closeCard; $('#scrim').onclick = closeCard;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#today').hidden) closeToday(); else if ($('#sheet').classList.contains('open')) closeCard(); } });
  $('#btn-data').onclick = dataDialog; $('#btn-about').onclick = aboutDialog; $('#btn-add').onclick = walkinDialog;
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
  window.__ready = true;
}
boot();
})();
