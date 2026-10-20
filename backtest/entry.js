// Runner long entry methods: market at ENTER vs pullback limits vs delays vs breakout confirmation. $150, fees in, stop -8, TP 6/12/20/30, stop->entry at TP1
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const M = 60000, Hr = 3600000, POS = 150;
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]), LO = (hl, i) => Math.min(hl[3 * i], hl[3 * i + 1]), CL = (hl, i) => hl[3 * i + 2];
function sim(hl, off, E, limitFill = false) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E; const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const a = (HI(hl, i) / E - 1) * 100, b = (LO(hl, i) / E - 1) * 100; last = CL(hl, i);
    if (b <= stop) { p += rem * stop; rem = 0; break; } if (limitFill && i === off) continue; // fill candle: only the stop counts (we don't know the order)
    while (hit < 4 && a >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * (last / E - 1) * 100; return (p - 0.1) / 100 * POS; }
const T = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60 + 600) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp == null && r.hasSpot === false)) continue; const rr = run7(r.s, r.t); if (rr == null || rr < 20) continue;
  const off = Math.round((s.now - r.t) / M), E = s.p; const x = { t: s.now, m: new Date(s.now).toISOString().slice(5, 7), v: {} };
  x.v['Market at ENTER (now)'] = sim(hl, off, E);
  for (const d of [15, 30, 60]) x.v[`Market ${d} min later`] = sim(hl, off + d, CL(hl, off + d - 1));
  for (const pb of [1, 2, 3, 5]) for (const w of [1, 4]) { const L = E * (1 - pb / 100); let f = -1; for (let i = off; i < off + w * 60; i++) if (LO(hl, i) <= L) { f = i; break; }
    x.v[`Limit −${pb}% (wait ${w}h, else skip)`] = f < 0 ? null : sim(hl, f, L, true);
    x.v[`Limit −${pb}% (wait ${w}h, else market)`] = f < 0 ? sim(hl, off + w * 60, CL(hl, off + w * 60 - 1)) : sim(hl, f, L, true); }
  for (const br of [2, 4]) { let f = -1; for (let i = off; i < off + 240; i++) if (HI(hl, i) >= E * (1 + br / 100)) { f = i; break; } x.v[`Breakout +${br}% (wait 4h, else skip)`] = f < 0 ? null : sim(hl, f, E * (1 + br / 100), true); }
  // behaviour
  let peak = 0, peakAt = 0, dipBefore6 = 0, t6 = null; for (let i = off; i < off + 2880; i++) { const h = (HI(hl, i) / E - 1) * 100, l = (LO(hl, i) / E - 1) * 100; if (t6 == null) { dipBefore6 = Math.min(dipBefore6, l); if (h >= 6) t6 = i - off; } if (h > peak) { peak = h; peakAt = i - off; } }
  x.b = { peak, peakAt, dipBefore6, t6 }; T.push(x); }
T.sort((a, b) => a.t - b.t); const cut = T[Math.floor(T.length * 2 / 3)].t;
const $ = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
console.log(`${T.length} runner longs, $150 each\n${'Method'.padEnd(40)} trades  win   total | first 2/3 | last 1/3 | Jul–Oct`);
for (const k of Object.keys(T[0].v)) { const a = T.filter(x => x.v[k] != null), s = f => a.filter(f).reduce((p, x) => p + x.v[k], 0);
  console.log(`${k.padEnd(40)} ${String(a.length).padStart(4)}  ${(a.filter(x => x.v[k] > 0).length / a.length * 100).toFixed(0).padStart(3)}% ${$(s(() => true)).padStart(6)} | ${$(s(x => x.t < cut)).padStart(6)} | ${$(s(x => x.t >= cut)).padStart(6)} | ${$(s(x => x.m !== '06')).padStart(6)}`); }
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; }, B = T.map(x => x.b);
const dips = B.map(b => b.dipBefore6), win = B.filter(b => b.t6 != null);
console.log(`\nBehaviour after ENTER (48h):`);
console.log(` reached +6%: ${(win.length / B.length * 100).toFixed(0)}% | time to +6%: median ${q(win.map(b => b.t6), .5)} min, 25% within ${q(win.map(b => b.t6), .25)} min, 75% within ${q(win.map(b => b.t6), .75)} min`);
console.log(` dip before +6% (all): never dipped 1%: ${(dips.filter(d => d > -1).length / B.length * 100).toFixed(0)}%, dipped ≥1%: ${(dips.filter(d => d <= -1).length / B.length * 100).toFixed(0)}%, ≥2%: ${(dips.filter(d => d <= -2).length / B.length * 100).toFixed(0)}%, ≥3%: ${(dips.filter(d => d <= -3).length / B.length * 100).toFixed(0)}%, ≥5%: ${(dips.filter(d => d <= -5).length / B.length * 100).toFixed(0)}%`);
console.log(` winners only (reached +6% before -8%): median dip ${q(win.filter(b => b.dipBefore6 > -8).map(b => b.dipBefore6), .5).toFixed(1)}%, ${(win.filter(b => b.dipBefore6 > -8 && b.dipBefore6 > -1).length / win.filter(b => b.dipBefore6 > -8).length * 100).toFixed(0)}% never dipped 1%`);
console.log(` peak within 48h: median +${q(B.map(b => b.peak), .5).toFixed(0)}%, reached at median ${(q(B.map(b => b.peakAt), .5) / 60).toFixed(1)}h | peaks ≥ 20%: median at ${(q(B.filter(b => b.peak >= 20).map(b => b.peakAt), .5) / 60).toFixed(1)}h`);
