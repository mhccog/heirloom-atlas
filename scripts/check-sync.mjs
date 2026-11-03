// Read-only smoke test of the deployed sync Worker. Usage: node scripts/check-sync.mjs <worker-url> <key-file>
import { readFileSync } from 'node:fs';
const [url, keyFile] = process.argv.slice(2);
if (!url || !keyFile) { console.error('usage: check-sync.mjs <url> <key-file>'); process.exit(2); }
const key = readFileSync(keyFile, 'utf8').trim();
const base = url.replace(/\/+$/, '');
const h = await fetch(base + '/health').then(r => r.json());
const noKey = await fetch(base + '/people?limit=1').then(r => r.status);
const badOrigin = await fetch(base + '/people?limit=1', { headers: { Origin: 'https://evil.example', 'X-App-Key': key } }).then(r => r.status);
const r = await fetch(base + '/people?limit=100', { headers: { 'X-App-Key': key, Origin: 'https://mhccog.github.io' } });
const body = await r.json().catch(() => ({}));
const ok = h.ok && noKey === 401 && badOrigin === 403 && r.ok;
console.log(JSON.stringify({ health: !!h.ok, withoutKey: noKey, otherOrigin: badOrigin, list: r.status, rows: body.results?.length ?? null, error: r.ok ? undefined : body, cors: r.headers.get('access-control-allow-origin') }));
process.exit(ok ? 0 : 1);
