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
// Do fresh-breakout shorts go sideways? Time to TP1, where price is after N hours, and time-stop variants (fresh only)
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]), LO = (hl, i) => Math.min(hl[3 * i], hl[3 * i + 1]), CL = (hl, i) => hl[3 * i + 2];
function simT(hl, off, E, tStopMin) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E; const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const fav = (1 - LO(hl, i) / E) * 100, adv = -(HI(hl, i) / E - 1) * 100; last = CL(hl, i);
    if (adv <= stop) { p += rem * stop; rem = 0; break; } while (hit < 4 && fav >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) break;
    if (tStopMin && !hit && i - off >= tStopMin) { p += rem * (1 - last / E) * 100; rem = 0; break; } }
  if (rem > 1e-9) p += rem * (1 - last / E) * 100; return (p - 0.1) * 1.5; }
const A = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp != null && s.sp <= 13 && b7(s.now) >= -2)) continue; const off = Math.round((s.now - r.t) / M), rr = run7(r.s, r.t); if (rr == null) continue; const E = s.p;
  let t1 = null, st = null; for (let i = off; i < off + 2880; i++) { if ((HI(hl, i) / E - 1) * 100 >= 8) { st = i - off; break; } if ((1 - LO(hl, i) / E) * 100 >= 6) { t1 = i - off; break; } }
  const at = h => (1 - CL(hl, off + h * 60) / E) * 100; const v = { 0: simT(hl, off, E, 0) }; for (const h of [1, 2, 4, 8, 12]) v[h] = simT(hl, off, E, h * 60);
  A.push({ t: s.now, fresh: rr < 60, low: s.sp <= 6, t1, st, a1: at(1), a4: at(4), v }); }
A.sort((a, b) => a.t - b.t); const cut = A[A.length >> 1].t; const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
for (const [n, f] of [['FRESH (7d < 60%)', x => x.fresh], ['EXTENDED (7d ≥ 60%)', x => !x.fresh], ['FRESH + share ≤6% (like BR)', x => x.fresh && x.low]]) { const a = A.filter(f), w = a.filter(x => x.t1 != null);
  const side4 = a.filter(x => x.t1 == null && x.st == null || (x.t1 ?? 1e9) > 240 && (x.st ?? 1e9) > 240).length;
  console.log(`\n${n}: ${a.length} trades | reached TP1 ${(w.length / a.length * 100).toFixed(0)}% — median ${q(w.map(x => x.t1), .5)} min, within 1h ${(a.filter(x => x.t1 != null && x.t1 <= 60).length / a.length * 100).toFixed(0)}%, within 4h ${(a.filter(x => x.t1 != null && x.t1 <= 240).length / a.length * 100).toFixed(0)}% | still undecided (no TP1, no stop) after 4h: ${(side4 / a.length * 100).toFixed(0)}%`);
  console.log(`  time stop "close if no TP1 after N hours":`); for (const h of [0, 1, 2, 4, 8, 12]) { const s = g => a.filter(g).reduce((p, x) => p + x.v[h], 0); console.log(`   ${h ? h + 'h'.padEnd(4) : 'none (current)'.padEnd(14)} total ${s(() => true).toFixed(0).padStart(5)} | 1st half ${s(x => x.t < cut).toFixed(0).padStart(4)} | 2nd half ${s(x => x.t >= cut).toFixed(0).padStart(4)}`); } }
