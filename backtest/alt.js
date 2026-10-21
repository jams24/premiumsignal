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
// Alt market heat at entry: median 24h change of all coins in the 1h set (point in time)
const syms = Object.keys(H1).filter(s => s !== 'BTCUSDT' && H1[s].length > 200); const cache = {};
const altMed = t => { const h = Math.floor(t / Hr); if (cache[h] != null) return cache[h]; const ch = []; for (const s of syms) { const k = H1[s], j = idx(k, t); if (j >= 24) ch.push((k[j][4] / k[j - 24][4] - 1) * 100); } ch.sort((a, b) => a - b); return cache[h] = ch.length > 50 ? ch[ch.length >> 1] : null; };
const A = { S: [], L: [] };
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue; const off = Math.round((s.now - r.t) / M), rr = run7(r.s, r.t);
  let side = null; if (s.sp != null && s.sp <= 13 && b7(s.now) >= -2) side = 'S'; else if (s.sp == null && r.hasSpot === false && rr != null && rr >= 20) side = 'L'; if (!side) continue;
  const am = altMed(s.now); if (am == null) continue; A[side].push({ t: s.now, am, v: sim(hl, off, s.p, side === 'S' ? -1 : 1, [6, 12, 20, 30]).v }); }
for (const side of ['S', 'L']) { const a = A[side].sort((x, y) => x.t - y.t), cut = a[a.length >> 1].t; console.log(`\n${side === 'S' ? 'SHORTS' : 'RUNNER LONGS'} by alt market (median coin 24h change) at entry:`);
  for (const [n, f] of [['red  (< -1%)', x => x.am < -1], ['flat (-1% to +1%)', x => x.am >= -1 && x.am <= 1], ['green (+1% to +3%)', x => x.am > 1 && x.am <= 3], ['hot  (> +3%)', x => x.am > 3]]) { const b = a.filter(f), s = g => b.filter(g).reduce((p, x) => p + x.v, 0);
    console.log(`  ${n.padEnd(20)} ${String(b.length).padStart(3)} tr | stopped ${(b.filter(x => x.v < -11).length / (b.length || 1) * 100).toFixed(0).padStart(2)}% | total ${s(() => true).toFixed(0).padStart(5)} (${(s(() => true) / (b.length || 1)).toFixed(2)}/tr) | 1st half ${s(x => x.t < cut).toFixed(0).padStart(4)} | 2nd half ${s(x => x.t >= cut).toFixed(0).padStart(4)}`); } }
