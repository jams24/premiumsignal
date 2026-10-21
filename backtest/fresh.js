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
// Shorts (spot share ≤13%, BTC pause): fresh breakout (7d run < 60%, the bot's own cut) vs extended — stop rate, P&L, runaway spikes
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]);
const A = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp != null && s.sp <= 13 && b7(s.now) >= -2)) continue; const off = Math.round((s.now - r.t) / M), rr = run7(r.s, r.t); if (rr == null) continue;
  const x = sim(hl, off, s.p, -1, [6, 12, 20, 30]); let up = 0; for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) up = Math.max(up, (HI(hl, i) / s.p - 1) * 100);
  A.push({ t: s.now, v: x.v, rr, sp: s.sp, up }); }
A.sort((a, b) => a.t - b.t); const cut = A[A.length >> 1].t; const D = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const show = (n, a) => { const s = f => a.filter(f).reduce((p, x) => p + x.v, 0); console.log(`${n.padEnd(36)} ${String(a.length).padStart(3)} tr | stopped ${(a.filter(x => x.v < -11).length / a.length * 100).toFixed(0).padStart(2)}% | ran ≥20% against ${(a.filter(x => x.up >= 20).length / a.length * 100).toFixed(0).padStart(2)}% | total ${D(s(() => true)).padStart(5)} (${(s(() => true) / a.length).toFixed(2)}/tr) | 1st half ${D(s(x => x.t < cut)).padStart(5)} | 2nd half ${D(s(x => x.t >= cut)).padStart(5)}`); };
show('All shorts (spot ≤13%)', A);
show('Fresh (7d run < 60%)', A.filter(x => x.rr < 60)); show('Extended (7d run ≥ 60%)', A.filter(x => x.rr >= 60));
show('Fresh + share ≤12%', A.filter(x => x.rr < 60 && x.sp <= 12)); show('Fresh + share ≤6%', A.filter(x => x.rr < 60 && x.sp <= 6)); show('Fresh + share 6–13%', A.filter(x => x.rr < 60 && x.sp > 6));
show('Very fresh (7d run < 20%)', A.filter(x => x.rr < 20)); show('Very fresh + share ≤12%', A.filter(x => x.rr < 20 && x.sp <= 12));
