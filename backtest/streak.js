// Short (current rules) + runner long together, 1 Jun – 12 Oct, $150 each, fees in
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E, dir, tps) { const fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E, end = Math.min(hl.length / 3, off + 2880) - 1; const fav = v => dir * (v / E - 1) * 100;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const a = fav(hl[3 * i]), b = fav(hl[3 * i + 1]); last = hl[3 * i + 2];
    if (Math.min(a, b) <= stop) { p += rem * stop / 100; rem = 0; end = i; break; }
    while (hit < 4 && Math.max(a, b) >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) { end = i; break; } }
  if (rem > 1e-9) p += rem * fav(last) / 100; return { v: p - 0.001, endOff: end }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const b7 = t => { const k = H1.BTCUSDT; const j = idx(k, t); return (k[j][4] / k[j - 168][4] - 1) * 100; };
const S = [], L = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  const off = Math.round((s.now - r.t) / M), mk = (dir, tps, kind) => { const x = sim(hl, off, s.p, dir, tps); return { kind, s: r.s, t: s.now, end: r.t + x.endOff * M, v: x.v }; };
  const hasSpot = s.sp != null, noSpot = s.sp == null && r.hasSpot === false;
  if (hasSpot && s.sp <= 13 && b7(s.now) >= -2) S.push(mk(-1, [6, 12, 20, 30], 'S'));
  const rr = run7(r.s, r.t); if (noSpot && rr != null && rr >= 20) L.push(mk(1, [6, 12, 20, 30], 'L')); }
// v is now a fraction of position; size each side separately
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
function limited(all, maxOpen) { const out = [], open = []; for (const x of [...all].sort((a, b) => a.t - b.t)) { for (let i = open.length - 1; i >= 0; i--) if (open[i].end <= x.t) open.splice(i, 1); if (open.length >= maxOpen) continue; open.push(x); out.push(x); } return out; }
const stat = (n, a, sS, sL) => { a = [...a].sort((x, y) => x.t - y.t); const val = x => x.v * (x.kind === 'S' ? sS : sL); let eq = 0, pk = 0, dd = 0, lo = 0; for (const x of a) { eq += val(x); pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); lo = Math.min(lo, eq); }
  const mo = ['06', '07', '08', '09', '10'].map(m => $(a.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((p, x) => p + val(x), 0)).padStart(7)).join(' |');
  console.log(`${n.padEnd(36)} ${String(a.length).padStart(4)} tr ${D(eq).padStart(8)} | worst drop $${dd.toFixed(0).padStart(5)} | months:${mo}`); };
// Loss-streak pause: after K stop-outs in a row (by close time), take no new trade for H hours. Max 5 open. v = fraction of position; $150.
function run(all, K, H) { const out = [], open = [], closed = []; let pauseUntil = 0;
  for (const x of [...all].sort((a, b) => a.t - b.t)) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i].end <= x.t) closed.push(open.splice(i, 1)[0]);
    closed.sort((a, b) => a.end - b.end);
    if (K) { const last = closed.slice(-K); if (last.length === K && last.every(y => y.v < -0.07)) pauseUntil = Math.max(pauseUntil, last.at(-1).end + H * 3600000); }
    if (x.t < pauseUntil || open.length >= 5) continue; open.push(x); out.push(x); }
  return out; }
const all = [...S, ...L]; const sorted = [...all].sort((a, b) => a.t - b.t); const cut = sorted[Math.floor(sorted.length / 2)].t;
const D = v => (v >= 0 ? "+" : "-") + "$" + Math.abs(v * 150).toFixed(0);
const st = (n, a) => { a = [...a].sort((x, y) => x.t - y.t); let eq = 0, pk = 0, dd = 0, run = 0, maxRun = 0; for (const x of a) { eq += x.v; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); if (x.v < -0.07) { run++; maxRun = Math.max(maxRun, run); } else if (x.v > 0) run = 0; }
  const s = f => a.filter(f).reduce((p, x) => p + x.v, 0); console.log(`${n.padEnd(34)} ${String(a.length).padStart(4)} tr ${D(eq).padStart(7)} | worst drop ${D(dd).padStart(6)} | 1st half ${D(s(x => x.t < cut)).padStart(6)} | 2nd half ${D(s(x => x.t >= cut)).padStart(6)} | longest stop streak ${maxRun}`); };
console.log('Both sides, $150, max 5 open, stop→entry at TP1');
st('No streak pause (current)', run(all, 0, 0));
for (const K of [2, 3, 4]) for (const H of [6, 12, 24]) st(`Pause ${H}h after ${K} stops in a row`, run(all, K, H));
