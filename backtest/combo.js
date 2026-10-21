// Short (current rules) + runner long together, 1 Jun – 12 Oct, $150 each, fees in
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E, dir, tps) { const fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E, end = Math.min(hl.length / 3, off + 2880) - 1; const fav = v => dir * (v / E - 1) * 100;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const a = fav(hl[3 * i]), b = fav(hl[3 * i + 1]); last = hl[3 * i + 2];
    if (Math.min(a, b) <= stop) { p += rem * stop / 100; rem = 0; end = i; break; }
    while (hit < 4 && Math.max(a, b) >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) { end = i; break; } }
  if (rem > 1e-9) p += rem * fav(last) / 100; return { v: p * POS - POS * 0.001, endOff: end }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const b7 = t => { const k = H1.BTCUSDT; const j = idx(k, t); return (k[j][4] / k[j - 168][4] - 1) * 100; };
const S = [], L = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  const off = Math.round((s.now - r.t) / M), mk = (dir, tps, kind) => { const x = sim(hl, off, s.p, dir, tps); return { kind, s: r.s, t: s.now, end: r.t + x.endOff * M, v: x.v }; };
  const hasSpot = s.sp != null, noSpot = s.sp == null && r.hasSpot === false;
  if (hasSpot && s.sp <= 13 && b7(s.now) >= -2) S.push(mk(-1, [6, 12, 20, 30], 'S'));
  const rr = run7(r.s, r.t); if (noSpot && rr != null && rr >= 20) L.push(mk(1, [6, 12, 20, 30], 'L')); }
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const stat = (n, a) => { a = [...a].sort((x, y) => x.t - y.t); const s = a.reduce((p, x) => p + x.v, 0); let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x.v; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const mo = ['06', '07', '08', '09', '10'].map(m => m + ' ' + $(a.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((p, x) => p + x.v, 0)).padStart(5)).join(' | ');
  const mos = new Set(a.map(x => new Date(x.t).toISOString().slice(0, 7))); const neg = [...mos].filter(m => a.filter(x => new Date(x.t).toISOString().slice(0, 7) === m).reduce((p, x) => p + x.v, 0) < 0).length;
  console.log(`${n.padEnd(34)} ${String(a.length).padStart(4)} tr ${(a.filter(x => x.v > 0).length / a.length * 100).toFixed(0)}% win ${$(s).padStart(6)} maxDD $${dd.toFixed(0).padStart(3)} | ${mo}`); };
// real limits: max 2 open shared, $30 daily realised-loss stop (counted at close), taken in time order
function limited(all, maxOpen = 2, dayStop = 30) { const out = [], open = []; const dayLoss = {};
  for (const x of [...all].sort((a, b) => a.t - b.t)) { for (let i = open.length - 1; i >= 0; i--) if (open[i].end <= x.t) { const o = open.splice(i, 1)[0]; const d = new Date(o.end).toISOString().slice(0, 10); dayLoss[d] = (dayLoss[d] || 0) + o.v; }
    if (open.length >= maxOpen) continue; const d = new Date(x.t).toISOString().slice(0, 10); if ((dayLoss[d] || 0) <= -dayStop) continue; open.push(x); out.push(x); } return out; }
console.log('$150 per trade · months: Jun | Jul | Aug | Sep | Oct(to 12th)\n');
console.log('No limits:'); stat(' Short only (current rules)', S); stat(' Runner long only', L); stat(' Both', [...S, ...L]);
console.log('\nWith max 2 open (shared) + $30 daily stop:'); stat(' Short only', limited(S)); stat(' Both', limited([...S, ...L]));
const both = limited([...S, ...L]); console.log(`   (of which shorts ${both.filter(x => x.kind === 'S').length}, longs ${both.filter(x => x.kind === 'L').length}; shorts lost to full slots vs short-only: ${limited(S).length - both.filter(x => x.kind === 'S').length})`);
console.log('\nWith max 3 open + $30 daily stop:'); stat(' Both', limited([...S, ...L], 3));
