import puppeteer from 'puppeteer-core'; import fs from 'fs';
const D = JSON.parse(fs.readFileSync('docs/assets/data.json', 'utf8'));
const svg = fs.readFileSync('docs/favicon.svg', 'utf8');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
for (const n of [192, 512]) { await p.setViewport({ width: n, height: n }); await p.setContent(`<body style="margin:0;background:#f6f0e1;display:grid;place-items:center;height:100vh">${svg.replace('<svg ', `<svg width="${n * .86}" height="${n * .86}" `)}</body>`); await p.screenshot({ path: `docs/icon-${n}.png` }); }
// share image: schematic constellation
const A = { bicester: [10, -175], tetbury: [-215, -95], henley: [35, -55], hungerford: [-125, 25], cobham: [165, 40], petworth: [-15, 170], lewes: [195, 175] };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pos = {}; for (const z of D.biz) { const a = A[z.town]; const ang = rnd() * 6.283, r = 14 + rnd() * 34; pos[z.id] = [820 + (a[0] + Math.cos(ang) * r) * 0.95, 320 + (a[1] + Math.sin(ang) * r) * 1.2]; }
const lines = D.intros.map(i => `<line x1="${pos[i.a][0]}" y1="${pos[i.a][1]}" x2="${pos[i.b][0]}" y2="${pos[i.b][1]}" stroke="rgba(43,36,25,${0.1 + i.strength * .05})" stroke-width="${0.6 + i.strength * .4}"/>`).join('');
const dots = D.biz.map(z => `<circle cx="${pos[z.id][0]}" cy="${pos[z.id][1]}" r="${4 + Math.sqrt(z.potential) * 1.6}" fill="${D.cats[z.cat].ink}" stroke="#fbf7ec" stroke-width="1.5"/>`).join('');
const css = `@font-face{font-family:F;src:url(file://${process.cwd()}/docs/fonts/fraunces-latin-wght-normal.woff2)}@font-face{font-family:FI;font-style:italic;src:url(file://${process.cwd()}/docs/fonts/fraunces-latin-wght-italic.woff2)}@font-face{font-family:I;src:url(file://${process.cwd()}/docs/fonts/inter-latin-wght-normal.woff2)}`;
await p.setViewport({ width: 1200, height: 630 });
await p.goto('file://' + process.cwd() + '/docs/index.html'); // gives file origin for fonts
await p.setContent(`<html><head><style>${css}body{margin:0;width:1200px;height:630px;background:radial-gradient(ellipse at 70% 45%,#fdfaf2,#f1e8d2);font-family:I;color:#2b2419;overflow:hidden}
.f{position:absolute;inset:18px;border:1px solid rgba(168,128,47,.35);border-radius:14px}.t{position:absolute;left:70px;top:150px;width:520px}
h1{font:600 72px/1 F;margin:0 0 18px;letter-spacing:-.02em}p{font:italic 400 30px/1.3 FI;margin:0;color:#5c4f3d}.s{font:500 19px I;color:#8a7a61;margin-top:34px;letter-spacing:.02em}</style></head><body><div class="f"></div>
<svg width="1200" height="630" style="position:absolute;inset:0">${lines}${dots}</svg>
<div class="t">${svg.replace('<svg ', '<svg width="74" height="74" style="margin-bottom:22px" ')}<h1>The Heirloom Atlas</h1><p>I connect people who don't know they need each other.</p><div class="s">${D.biz.length} heirloom-trade businesses · ${D.towns.length} towns · ${D.intros.length} introductions worth making</div></div></body></html>`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: 'docs/og.png' });
await b.close(); console.log('art ok');
