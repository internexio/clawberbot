// api.mjs — out-of-band fetch wrapper. Reads CLAWBER_API_KEY from .env INTERNALLY
// (never on argv — harness secret guard). GET-default; 429/Retry-After backoff.
// Used for ongoing capture (B1.7); NOT exercised by the offline backfill.
import fs from 'fs';

const BASE = 'https://clawber.ai';
function key() {
  const env = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  const m = env.match(/CLAWBER_API_KEY=(\S+)/);
  if (!m) throw new Error('CLAWBER_API_KEY not found in .env');
  return m[1];
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function api(path, opts = {}) {
  const headers = { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(BASE + path, { ...opts, headers });
  if (r.status === 429) { const w = +(r.headers.get('Retry-After') || 2); await sleep(w * 1000); return api(path, opts); }
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
