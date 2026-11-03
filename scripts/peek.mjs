import puppeteer from 'puppeteer-core';
const [,, url, out, wd, ht, act] = process.argv;
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: +wd, height: +ht, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle0' }); await p.waitForFunction('window.__ready'); await new Promise(r => setTimeout(r, 2500));
if (act) { await p.evaluate(act); await new Promise(r => setTimeout(r, 1200)); }
await p.screenshot({ path: out }); await b.close();
