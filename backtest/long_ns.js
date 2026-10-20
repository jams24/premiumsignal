// LONG the no-spot coins at the ENTER moment (mirror plan: stop -8%, TP +6/12/20/30, stop to entry at TP1), $150, fees in
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E, dir, sl = 8, tps = [6, 12, 20, 30]) { const fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -sl, last = E; const fav = v => dir * (v / E - 1) * 100;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const a = fav(hl[3 * i]), b = fav(hl[3 * i + 1]); last = hl[3 * i + 2]; const adv = Math.min(a, b), fv = Math.max(a, b);
    if (adv <= stop) { p += rem * stop / 100; rem = 0; break; }
    while (hit < 4 && fv >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * fav(last) / 100; return p * POS - POS * 0.001; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const b7 = (t) => { const k = H1.BTCUSDT; const j = idx(k, t); return (k[j][4] / k[j - 168][4] - 1) * 100; };
const T = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp == null && r.hasSpot === false)) continue; const off = Math.round((s.now - r.t) / M), rr = run7(r.s, r.t); if (rr == null) continue;
  T.push({ s: r.s, t: s.now, rr, b7: b7(s.now), L: sim(hl, off, s.p, 1), Lw: sim(hl, off, s.p, 1, 12, [10, 20, 35, 50]), S: sim(hl, off, s.p, -1) }); }
T.sort((a, b) => a.t - b.t);
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const line = (n, a, k = 'L') => { if (!a.length) return; const s = a.reduce((p, x) => p + x[k], 0); let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x[k]; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const q = [0, 1, 2, 3].map(i => a.filter((_, j) => Math.floor(j * 4 / a.length) === i).reduce((p, x) => p + x[k], 0));
  const mo = [...new Set(a.map(x => new Date(x.t).toISOString().slice(5, 7)))].map(m => m + ':' + $(a.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((p, x) => p + x[k], 0))).join(' ');
  console.log(n.padEnd(46), String(a.length).padStart(3), 'trades', (a.filter(x => x[k] > 0).length / a.length * 100).toFixed(0).padStart(3) + '% win', $(s).padStart(6), ('$' + (s / a.length).toFixed(2)).padStart(7) + '/tr', 'maxDD $' + dd.toFixed(0), '| quarters', q.map($).join(' '), '|', mo); };
const G = T.filter(x => x.rr >= 20), Q = T.filter(x => x.rr < 20);
console.log('No-spot coins at the ENTER moment, 1 Jun – 12 Oct');
line('LONG  run7d ≥ 20%  (stop 8%, TP 6/12/20/30)', G); line('LONG  run7d ≥ 20%  wide (stop 12%, TP 10/20/35/50)', G, 'Lw'); line('SHORT run7d ≥ 20%  (what we were doing)', G, 'S');
line('LONG  run7d 20–60%', G.filter(x => x.rr < 60)); line('LONG  run7d ≥ 60%', G.filter(x => x.rr >= 60));
line('LONG  run7d ≥ 20%, BTC 7d ≥ -2%', G.filter(x => x.b7 >= -2)); line('LONG  run7d ≥ 20%, BTC 7d < -2%', G.filter(x => x.b7 < -2));
line('LONG  run7d < 20% (control)', Q);
