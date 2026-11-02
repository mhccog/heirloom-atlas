// Builds data.json from the read-only source /workspace/heirloom-atlas/raw.json
// plus the lists published on the two source Pages ("Network towns: walk-in map", "The Heirloom Atlas").
import fs from 'fs';
const SRC = process.argv[2] || '/workspace/heirloom-atlas/raw.json';
const OUT = process.argv[3] || 'docs/assets/data.json';
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const CATS = ["Antiques", "Auction houses", "Clocks, jewels & watches", "Rare books", "Classic motoring", "Old family makers", "Probate solicitors", "Guilds & hosts"];
const INKS = ["#8b2e2a", "#23476b", "#b07d1a", "#6b3d6e", "#2f5d3a", "#b35a1f", "#4f5b66", "#7a5c3e"];
const OPEN = [
  "What's the piece in here you'd never sell?",
  "What's the best thing that's come through the door this year?",
  "What's the piece in here you'd never sell?",
  "What's the book in here you'd never sell?",
  "What are people asking you for that you can't find?",
  "How did it all start?",
  "I'm getting to know the people executors rely on round here. Who do you trust for valuations?",
  "I'm getting to know the people in town. Who should I meet first?",
];
const FOUNDER_OPEN = "How did it all start?";
const FOUNDER_NOTE = "Then two follow-ups. Never open with 'Are you selling?'";

// "Who you'll meet" (source Page; Chase Hughes social needs used as listening prompts, never labels)
const PERSONAS = {
  dealer: { label: "Antiques dealer", read: "Owner-run, proud of their eye. Often wants to be seen as the expert (intelligence) or recognised for what they've built (significance).", listen: "Where stock comes from (clearances, executors). Who's retiring. Any 'so I can finally…' line." },
  auction: { label: "Auctioneer or valuer", read: "Relationship-driven and always short of good consignments. Likes being first to know.", listen: "Which solicitors refer to them. Coming single-owner sales. Cars or watches in estates they can't handle." },
  solicitor: { label: "Probate solicitor", read: "Careful and reputation-first. Wants reassurance (approval) that anyone they refer is discreet.", listen: "Kinds of estate they struggle to place (cars, wine, watches). Never ask about clients." },
  dealerFast: { label: "Classic car or watch dealer", read: "Fast and stock-hungry. Needs cars (or pieces) to sell and buyers who are serious.", listen: "Wanted lists that match your supercar leads. Collections about to come up." },
  founder: { label: "Family-firm owner", read: "Has built something over decades. Often cares about legacy (significance) and peace more than price.", listen: "'The kids aren't interested', 'one day…', 'so I can finally travel' (freedom). Never open with 'Are you selling?'" },
  host: { label: "Connector or host", read: "Judged on who they bring together, so being useful to members matters more than any deal (acceptance). Suggestion: not on the source Page.", listen: "Who's new, who's struggling, which members need an introduction. Events you could help at." },
};

const WATCH = [
  ["Hungerford Arcade Ltd", "Hungerford Arcade", "hungerford", "Inc. 30 Jul 2002", "Directors b. Apr 1957, Feb 1960; none younger listed", "Ask who runs it day to day and whether there's a plan for the future"],
  ["W F Bruce Antiques Ltd", "W.F. Bruce Antique Clocks", "lewes", "Inc. 2 Dec 2003", "Directors b. Dec 1955, Aug 1960; none younger listed", "Specialist trade (clocks) that's hard to pass on. Gently ask about apprentices"],
  ["Shipton Mill Ltd", "Shipton Mill", "tetbury", "Inc. 31 Oct 1979", "Sole director b. Jan 1954 (appt 1979)", "Heritage food brand. Call first, then visit"],
  ["Harper Ltd", "Harper Ltd", "cobham", "Inc. 4 Sep 1979", "Founders b. 1951, 1953; next generation b. 1986, 1989", "Succession already under way. A case study and connector, not a sale"],
  ["Harvey & Son (Lewes) Ltd", "Harvey's Brewery Shop", "lewes", "Inc. 24 Nov 1928", "Directors b. 1952, 1957, 1959, 1970", "Older board but has a younger director. A connector"],
];
const SIGNALS = [
  ["Top Banana Antiques Mall Ltd", "tetbury", "1 New Church St", "Status shows Liquidation", "Check whether the mall still trades. Displaced dealers and stock could be a lead"],
  ["Jester Antiques Ltd", "tetbury", "10 Church St", "Dissolved 12 May 2026", "Ask nearby dealers where the stock and owner went"],
  ["Oliver Charles Antiques Ltd", "petworth", "Clock House, Lombard St", "Active proposal to strike off; sole director b. Jul 1952", "Website not reachable. Likely winding down, so ask PAADA members"],
  ["David Rodger Sharp Ltd", "henley", "Jeweller, Duke St", "Dissolved 17 Sep 2026", "Possible retirement. Ask Anthony Paul Jewellery"],
];
const EVENTS = [
  { date: "2026-11-03", label: "Tue 3 Nov", town: "lewes", what: "Gorringe's Fine Art & Interiors", why: "Meet dealers and executors in the saleroom", at: "Gorringe's" },
  { date: "2026-11-05", label: "Thu 5 Nov", town: "tetbury", what: "Moore Allen & Innocent live sale, Cirencester", why: "Auctioneer and estate-agent team in one room", at: "Moore Allen & Innocent" },
  { date: "2026-11-07", label: "Sat 7 Nov", town: "bicester", what: "Broad Arrow Zürich sale (abroad)", why: "Ask the Bicester team how it went: estate and collection sales", at: "Broad Arrow Group UK" },
  { date: "2026-11-08", label: "Sun 8 Nov", town: "hungerford", what: "Antiques & Collectors' Fair, Town Hall", why: "Dozens of visiting dealers in one place" },
  { date: "2026-11-09", label: "Mon 9 Nov", town: "lewes", what: "Gorringe's House & Garden sale", why: "House clearers' day", at: "Gorringe's" },
  { date: "2026-11-18", end: "2026-11-19", label: "18–19 Nov", town: "hungerford", what: "Dreweatts Fine Jewellery, then Fine Watches", why: "Estate jewellery and watches; meet specialists at viewing", at: "Dreweatts" },
  { date: "2026-11-26", end: "2026-11-28", label: "26–28 Nov", town: "cobham", what: "Historics Brooklands Velocity (viewing 26–27, sale Sat 28)", why: "Collectors, consignors and supercar buyers", at: "Historics Auctioneers" },
  { date: "2026-12-13", label: "Sun 13 Dec", town: "hungerford", what: "Antiques fair, Town Hall", why: "Second-Sunday fair: visiting dealers" },
  { date: "2027-01-10", label: "Sun 10 Jan 2027", town: "bicester", what: "Scramble", why: "Every workshop opens to the public", at: "Bicester Motion (estate office)" },
  { date: "2027-04-24", end: "2027-04-25", label: "24–25 Apr 2027", town: "bicester", what: "Super Scramble", why: "The biggest open day of the year", at: "Bicester Motion (estate office)" },
  { date: "2027-10-03", label: "Sun 3 Oct 2027", town: "bicester", what: "Scramble", why: "Every workshop opens to the public", at: "Bicester Motion (estate office)" },
];
const FLOW = [
  ["Walking in cold", "Outside: three slow breaths and name the feeling ('nerves, noted'). Walk in at pool speed, hands visible, shoulders down. Aim to be the most comfortable person in the room.", "Hi, I'm Cyrus. Not buying or selling today, just getting to know the people in town. How long have you been here?", "CH · VG · VVE"],
  ["Reading the person", "Notice their normal pace, volume and posture, then look only for changes. Match their energy for the first minute, then lift gently. Listen for 'I built' (significance) or 'we, our team' (acceptance). If something shifts, ask, don't diagnose.", "Is now good, or shall I pop back when it's quieter?", "CH · VG · VVE"],
  ["Making them feel something", "Warmth first, then competence. Ask two follow-ups before you say anything about yourself. Listen with your face: slow nods, a head tilt. FORD (family, occupation, recreation, dreams) gives you topics.", "Working on anything exciting? · What do you do in your free time?", "VVE · VG"],
  ["Saying it with emotion", "When they ask what you do, tell the 10-second story. Slow right down on the line that matters, pause after it, and finish on a lower pitch.", "I connect people who don't know they need each other. (Then pause.)", "VG · CH"],
  ["Getting the contact and coming back", "End on purpose: mention something in the future, then a compliment or an action. Ask for the card once, calmly, then stop talking. Same day, send a short note. Come back in 4–6 weeks. Three visits before you ask for anything.", "It's been lovely talking. Good luck with the sale. Could I take a card? I'll pop back next month.", "VVE · CH"],
  ["Making the introduction", "Ask each side privately first. Reframe it so neither feels sold to (perception, context, permission). Explain it in their terms, 'so you can finally…'. Only introduce if it's in both people's interest.", "No pressure and not a sale. I just think you two should know each other. Happy for me to introduce you?", "CH · VVE"],
];
const BEFORE = [
  "Say your line aloud once: I connect people who don't know they need each other",
  "30 seconds of lip trills and one siren to wake your voice",
  "Three slow breaths out, then name what you feel",
  "Choose today's three stops and one opener each",
  "Check the watchlist so you never ask about anything already public",
  "Cards, a pen, phone charged. Make your first stop the friendliest shop",
];
const AFTER = [
  "What I tried, what happened, what I'll try next",
  "Their name, their role and one personal detail",
  "Their need, as a guess to test next time, and who they could meet",
  "They probably liked you more than you think, so send the 'I enjoyed…' note yourself",
];
const STORY = [
  ["Who you are", "“I connect people who don't know they need each other.” Slow down, pause, finish low."],
  ["One vivid example", "“Last month a [dealer in town] had [one specific thing], and a [collector two towns over] had been hunting for exactly that. One coffee and they'd met.”"],
  ["Hand it back", "“What's the one thing you're always looking for?”"],
  ["Until you have a real one", "“I spend my days meeting people like you in towns like this, because the best deals start when the right two people meet.” Only ever tell true stories."],
];
const SOURCES = [
  ["Companies House search", "https://find-and-update.company-information.service.gov.uk/"],
  ["Hungerford antiques guide", "https://www.visithungerford.com/things-to-do/antiques-shopping/"],
  ["Tetbury Chamber directory", "https://www.tetburychamber.org/directory/"],
  ["Petworth antiques (PAADA)", "https://discoverpetworth.uk/petworth-antiques/"],
  ["Visit Lewes shopping", "https://www.visitlewes.co.uk/things-to-do/shopping?p=2"],
  ["Bicester Motion specialist directory", "https://bicestermotion.com/directory"],
  ["Historics upcoming auctions", "https://www.historics.co.uk/upcoming-auctions/"],
];

const slug = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const towns = raw.atowns.map(t => { const n = raw.ntowns.find(x => x.id === t.id); return { id: t.id, name: t.name, la: t.la, lo: t.lo, day: t.day, go: t.go, why: n.why, travel: n.travel, bestDay: n.bestDay, dates: n.dates }; });

const isSol = b => b.c === 6;
const isAuc = b => /auction/i.test(b.k) || b.c === 1;
const isCarAuc = b => b.c === 4 && /auction/i.test(b.k);
const isCarDealer = b => b.c === 4 && /(sales|dealer|cars)/i.test(b.k) && !/auction/i.test(b.k);
const isHost = b => b.c === 7 || /museum/i.test(b.k);
const isFounder = b => b.r === 1;
const isNewcomer = b => /(new shop|new ownership|younger owner|since 2019|since 2020)/i.test(b.y);

function personaKey(b, theme) {
  if (isFounder(b)) return 'founder';
  if (isHost(b)) return 'host';
  if (isSol(b)) return 'solicitor';
  if (b.c === 1 || /valu/i.test(b.k) || isCarAuc(b)) return 'auction';
  if (b.c === 5) return 'founder';
  if (b.c === 4 || b.c === 2) return 'dealerFast';
  return 'dealer';
}
function askFor(b) {
  if (/Toovey/.test(b.n)) return { who: "Rupert Toovey or a valuer", named: true, note: "The source says Rupert Toovey's family runs it." };
  if (isSol(b)) return { who: "The private-client (wills & probate) team" };
  if (/association/i.test(b.k)) return { who: "The association's chair or secretary (ask any member shop who that is)" };
  if (/museum/i.test(b.k)) return { who: "Membership or volunteer office" };
  if (/estate office/i.test(b.n)) return { who: "The estate or events office" };
  if (/insurance|valuations/i.test(b.k)) return { who: "A valuations specialist" };
  if (b.c === 1 || isCarAuc(b)) return { who: "A valuer or specialist (viewing days are easiest)" };
  if (/centre|market|arcade/i.test(b.k + ' ' + b.n)) return { who: "The centre manager or owner, then the dealers on the stands" };
  if (/management/i.test(b.k)) return { who: "The collections team" };
  if (b.c === 5) return { who: isFounder(b) ? "The owner (call before visiting)" : "Whoever is on the counter, then ask after the family" };
  return { who: "The owner, if in; otherwise whoever's minding the shop" };
}
function needFor(b, theme) {
  if (isSol(b)) return "Discreet, trusted valuers and buyers for executors";
  if (isAuc(b) && b.c !== 4) return "Consignments: estates and collections";
  if (theme === "Retiring founder") return "A future for what they built (ask gently)";
  if (b.c === 4) return isCarAuc(b) ? "Consignments: cars from estates and collections" : "Good cars to sell and serious buyers";
  if (theme === "Connector") return "Being the person who knows everyone";
  return "Fresh stock from house clearances, and buyers";
}
function offersFor(b) {
  if (isSol(b)) return "Executors who need valuations, clearances and buyers";
  if (b.c === 1) return "Probate valuations, sale days where the trade meets";
  if (b.c === 2) return "Valuing and buying estate jewellery and watches";
  if (b.c === 3) return "Buying libraries and books from estates";
  if (/insurance|valuations/i.test(b.k)) return "Knows where the cars are; values collections";
  if (isCarAuc(b)) return "A route to market for whole collections";
  if (b.c === 4 && /museum/i.test(b.k)) return "Surrey's classic-car owners, members and volunteers";
  if (b.c === 4) return "Buyers and stock for classic and prestige cars";
  if (isHost(b)) return "Introductions to every member or tenant";
  if (b.c === 5) return "Decades of local family relationships";
  return "Buying house contents; a grapevine of dealers";
}

const biz = raw.abiz.map((a, i) => {
  const n = raw.nbiz.find(x => x.name === a.n) || {};
  const theme = n.theme || '';
  const pk = personaKey(a, theme);
  const w = WATCH.find(x => x[1] === a.n);
  return {
    id: slug(a.n), name: a.n, town: a.t, cat: a.c, type: a.k, addr: a.a, web: a.w, phone: a.p || null,
    why: a.y, la: a.la, lo: a.lo, approx: a.x === 1, founder: a.r === 1, theme,
    ask: askFor(a), persona: pk, opener: a.r ? FOUNDER_OPEN : OPEN[a.c], openerNote: a.r ? FOUNDER_NOTE : (a.c === 5 ? 'Then ask two follow-ups.' : ''),
    need: needFor(a, theme), offers: offersFor(a),
    watch: w ? { company: w[0], founded: w[3], directors: w[4], angle: w[5] } : null,
    _a: a,
  };
});
const by = name => biz.find(b => b.name === name);

// ---------- Suggested introductions (rule-based, from needs/offers in the data) ----------
const intros = []; const seen = new Set();
const km = (a, b) => { const R = 6371, d = Math.PI / 180; const x = Math.sin((b.la - a.la) * d / 2) ** 2 + Math.cos(a.la * d) * Math.cos(b.la * d) * Math.sin((b.lo - a.lo) * d / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function add(A, B, why, kind, strength) {
  if (!A || !B || A.id === B.id) return;
  const key = [A.id, B.id].sort().join('|'); if (seen.has(key)) return; seen.add(key);
  intros.push({ id: 'i-' + key.replace('|', '--'), a: A.id, b: B.id, why, kind, strength, km: Math.round(km(A, B)) });
}
const same = (b, f) => biz.filter(x => x.town === b.town && x.id !== b.id && f(x._a, x));
const nearest = (b, f, n = 1) => biz.filter(x => x.id !== b.id && f(x._a, x)).sort((p, q) => km(b, p) - km(b, q)).slice(0, n);

for (const s of biz.filter(b => isSol(b._a))) {
  for (const a of same(s, x => x.c === 1)) add(s, a, `Executors ask ${s.name} who to call for valuations. ${a.name} values estates and is always short of good consignments.`, 'Probate', 3);
  if (!same(s, x => x.c === 1).length) for (const a of nearest(s, x => x.c === 1)) add(s, a, `Executors ask ${s.name} who to call for valuations; ${a.name} is the nearest saleroom that values estates.`, 'Probate', 2);
  for (const j of same(s, x => x.c === 2 || x.c === 3).slice(0, 2)) add(s, j, `Estates often hold ${j.cat === 3 ? 'libraries' : 'jewellery and watches'}. ${j.name} buys exactly that, discreetly, which is what executors need.`, 'Probate', 2);
  for (const d of same(s, x => x.c === 0 && /(buy|collection|clearance|contents|centre)/i.test(x.y + x.k)).slice(0, 1)) add(s, d, `House contents need a home. ${d.name} buys from estates, and ${s.name} hears about them first.`, 'Probate', 2);
  add(s, by('Hagerty'), `Estates sometimes include a classic car nobody knows how to value. Hagerty values collections for probate.`, 'Cars in estates', 1);
}
for (const f of biz.filter(b => b.founder)) {
  for (const s of same(f, x => x.c === 6)) add(f, s, `${f.name} may want a future for what they built (ask gently). A private-client solicitor knows the succession advisers locally.`, 'Succession', 2);
}
add(by('Roger King Antiques'), by('Hungerford Arcade'), `Roger King's family has already handed over; Hungerford Arcade lists no younger director. A peer story, told over coffee, not a pitch.`, 'Succession', 2);
add(by('Harper Ltd'), by('W.F. Bruce Antique Clocks'), `Harper's succession is already under way with the next generation. W.F. Bruce lists no younger director in a hard-to-pass-on trade.`, 'Succession', 1);
add(by('Harvey\'s Brewery Shop'), by('W.F. Bruce Antique Clocks'), `Harvey's knows every old family in Lewes; a quiet word could surface an apprentice or successor for a clock specialist.`, 'Succession', 1);
for (const a of biz.filter(b => b.cat === 1)) {
  for (const d of same(a, x => x.c === 0 || x.c === 2).slice(0, 2)) add(a, d, `${d.name} buys from estates; ${a.name}'s sales and viewings are where executors, clearers and dealers meet.`, 'Trade', 1);
  const car = nearest(a, x => isCarAuc(x), 1)[0];
  add(a, car, `General salerooms meet cars in estates they can't handle. ${car.name} handles estate and collection car sales.`, 'Cars in estates', 2);
}
for (const j of biz.filter(b => b.cat === 2)) for (const a of nearest(j, x => x.c === 1, 1)) add(j, a, `${j.name} sees estate jewellery and watches; ${a.name} is the nearest saleroom for specialist pieces and valuations.`, 'Trade', 1);
add(by('Jonkers Rare Books'), by('Historics Auctioneers'), `Jonkers notes that rare-book collectors often collect cars too. Two sides of the same collector.`, 'Collectors', 1);
add(by('Jonkers Rare Books'), by('Hangar 136'), `Rare-book collectors often collect cars too; Hangar 136 needs serious buyers.`, 'Collectors', 1);
for (const ca of biz.filter(b => isCarAuc(b._a))) for (const d of biz.filter(b => isCarDealer(b._a))) add(ca, d, `${ca.name} brings collections to market; ${d.name} needs good cars and serious buyers.`, 'Cars', 1);
add(by('Kingsbury Racing Shop'), by('Curated by Pendine'), `Pre-war Bentleys sit in long-held family collections; Curated by Pendine manages collections when a family needs to sell.`, 'Cars in estates', 2);
add(by('Kingsbury Racing Shop'), by('Hagerty'), `Kingsbury knows where the pre-war Bentleys are; Hagerty values them for insurance and probate.`, 'Cars', 1);
add(by('Curated by Pendine'), by('Scuderia Prestige'), `Pendine sells whole collections; your partner Scuderia Prestige needs good cars and has buyers.`, 'Cars', 2);
add(by('Bicester Motion (estate office)'), by('Brooklands Museum'), `The two hubs of the classic-car community near London. Scramble days and Brooklands events share the same owners.`, 'Hosts', 1);
add(by('Bicester Motion (estate office)'), by('Scuderia Prestige'), `Bicester Motion introduces tenants and collectors; Scuderia Prestige wants to swap introductions.`, 'Hosts', 1);
add(by('Brooklands Museum'), by('Historics Auctioneers'), `Brooklands members are Surrey's classic-car owners; Historics' consignors include collectors downsizing.`, 'Cars', 2);
add(by('Brooklands Museum'), by('Baker Brothers'), `Members who want to buy or sell a prestige car, and a by-appointment dealer who needs both.`, 'Cars', 1);
for (const nw of biz.filter(b => isNewcomer(b._a))) {
  let hosts = same(nw, (x, X) => (x.c === 7 || /centre|market/i.test(x.k)) && !isNewcomer(x) && !X.founder);
  if (!hosts.length) hosts = same(nw, (x, X) => X.theme === 'Connector' && x.c !== 6);
  hosts.sort((p, q) => (q.cat === 7) - (p.cat === 7));
  for (const h of hosts.slice(0, 1)) add(nw, h, `${nw.name} is new or newly owned, so introductions matter most right now. ${h.name} knows the town's trade.`, 'Newcomers', 2);
}
add(by('PAADA (dealers\' association)'), by('Glanvilles Solicitors'), `One introduction to PAADA opens the whole town; Glanvilles' executors need trusted dealers.`, 'Probate', 2);
add(by('PAADA (dealers\' association)'), by('Toovey\'s'), `PAADA members buy and consign; Toovey's values estates for probate nearby.`, 'Trade', 1);
add(by('Hobbs of Henley'), by('Blandy & Blandy'), `A 150-year family firm that knows all of Henley, and the firm where probate referrals start.`, 'Hosts', 1);
add(by('Hobbs of Henley'), by('Way\'s Bookshop'), `Two long-standing Henley names: Way's has bought from local houses for 40+ years.`, 'Hosts', 1);
add(by('Harvey\'s Brewery Shop'), by('Mayo Wynne Baxter'), `Harvey's knows every old family in town; Mayo Wynne Baxter is the large probate practice those families use.`, 'Hosts', 1);

add(by('Great Grooms Antiques Centre'), by('Dreweatts'), `One hello at Great Grooms reaches many dealers who buy from estates; Dreweatts handles single-owner estate collections 15 minutes away.`, 'Trade', 1);
add(by("Youll's Antiques"), by('Dickins Hopgood Chidley'), `Youll's sells to country-house buyers and hears who's clearing a big house; Dickins Hopgood Chidley is the local probate desk.`, 'Probate', 1);
// connection potential
const deg = {}; for (const i of intros) { deg[i.a] = (deg[i.a] || 0) + i.strength; deg[i.b] = (deg[i.b] || 0) + i.strength; }
for (const b of biz) { b.potential = (deg[b.id] || 0) + (b.theme === 'Connector' ? 2 : 0); delete b._a; }

const data = {
  generated: new Date().toISOString(), asOf: "2 Nov 2026",
  tagline: "I connect people who don't know they need each other.",
  definition: "Heirloom trades: businesses whose worth is handed down rather than scaled up.",
  cats: CATS.map((name, i) => ({ id: i, name, ink: INKS[i] })),
  towns, biz, intros, personas: PERSONAS,
  watch: WATCH.map(w => ({ company: w[0], biz: slug(w[1]), town: w[2], founded: w[3], directors: w[4], angle: w[5] })),
  signals: SIGNALS.map(s => ({ company: s[0], town: s[1], where: s[2], shows: s[3], todo: s[4] })),
  events: EVENTS.map(e => ({ ...e, at: e.at ? slug(e.at) : null })),
  flow: FLOW.map(f => ({ stage: f[0], do: f[1], say: f[2], from: f[3] })),
  before: BEFORE, after: AFTER, story: STORY, sources: SOURCES,
};
fs.writeFileSync(OUT, JSON.stringify(data));
console.log('biz', biz.length, 'intros', intros.length, 'kinds', JSON.stringify(intros.reduce((m, i) => (m[i.kind] = (m[i.kind] || 0) + 1, m), {})));
console.log('approx', biz.filter(b => b.approx).map(b => b.name).join(', '));
console.log('no-intro', biz.filter(b => !deg[b.id]).map(b => b.name).join(', '));
console.log('top', biz.sort((a, b) => b.potential - a.potential).slice(0, 8).map(b => b.name + ':' + b.potential).join(', '));
