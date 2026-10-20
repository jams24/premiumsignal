process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E, how = 'time'; const fav = v => (v / E - 1) * 100;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const a = fav(hl[3 * i]), b = fav(hl[3 * i + 1]); last = hl[3 * i + 2];
    if (Math.min(a, b) <= stop) { p += rem * stop / 100; rem = 0; how = stop < 0 ? 'stop' : 'entry'; break; }
    while (hit < 4 && Math.max(a, b) >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) { how = 'tp4'; break; } }
  if (rem > 1e-9) p += rem * fav(last) / 100; return { v: p * POS - POS * 0.001, hit, how }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const G = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp == null && r.hasSpot === false)) continue; const rr = run7(r.s, r.t); if (rr == null || rr < 20) continue; G.push({ t: s.now, ...sim(hl, Math.round((s.now - r.t) / M), s.p) }); }
const rep = (n, a) => { const W = a.filter(x => x.v > 0), L = a.filter(x => x.v <= 0), st = a.filter(x => x.how === 'stop');
  const c = k => a.filter(x => x.hit === k && x.how !== 'stop').length;
  const avgW = W.reduce((p, x) => p + x.v, 0) / W.length, avgL = L.reduce((p, x) => p + x.v, 0) / L.length;
  console.log(`${n}: ${a.length} trades | win ${(W.length / a.length * 100).toFixed(0)}% / lose ${(L.length / a.length * 100).toFixed(0)}% | full stop ${(st.length / a.length * 100).toFixed(0)}% | reached TP1 ${(a.filter(x => x.hit >= 1).length / a.length * 100).toFixed(0)}% TP2 ${(a.filter(x => x.hit >= 2).length / a.length * 100).toFixed(0)}% TP3 ${(a.filter(x => x.hit >= 3).length / a.length * 100).toFixed(0)}% TP4 ${(a.filter(x => x.hit >= 4).length / a.length * 100).toFixed(0)}% | avg win $${avgW.toFixed(2)} avg loss $${avgL.toFixed(2)}`); };
rep('All Jun–Oct', G); rep('Jun', G.filter(x => new Date(x.t).getUTCMonth() === 5)); rep('Jul', G.filter(x => new Date(x.t).getUTCMonth() === 6)); rep('Aug–Oct', G.filter(x => new Date(x.t).getUTCMonth() >= 7));
const tt = (n, a) => { const m = a.reduce((p, x) => p + x.v, 0) / a.length, sd = Math.sqrt(a.reduce((p, x) => p + (x.v - m) ** 2, 0) / (a.length - 1)); console.log(`${n}: mean $${m.toFixed(2)}/trade sd $${sd.toFixed(2)} t=${(m / (sd / Math.sqrt(a.length))).toFixed(2)}`); };
tt('All', G); tt('Aug–Oct', G.filter(x => new Date(x.t).getUTCMonth() >= 7)); tt('Jul–Oct', G.filter(x => new Date(x.t).getUTCMonth() >= 6));
