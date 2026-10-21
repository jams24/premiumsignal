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
const A = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp != null && s.sp <= 13 && b7(s.now) >= -2)) continue; const off = Math.round((s.now - r.t) / M); const x = sim(hl, off, s.p, -1, [6, 12, 20, 30]); A.push({ t: s.now, imm: off === 0, v: x.v }); }
A.sort((a, b) => a.t - b.t); const cut = A[A.length >> 1].t;
for (const [n, f] of [['ENTER right at the signal (top already old)', x => x.imm], ['ENTER later, after waiting', x => !x.imm]]) { const a = A.filter(f), s = g => a.filter(g).reduce((p, x) => p + x.v, 0);
  console.log(`${n.padEnd(44)} ${a.length} tr | win ${(a.filter(x => x.v > 0).length / a.length * 100).toFixed(0)}% | stopped ${(a.filter(x => x.v < -11).length / a.length * 100).toFixed(0)}% | total ${s(() => true).toFixed(0)} (${(s(() => true) / a.length).toFixed(2)}/tr) | 1st half ${s(x => x.t < cut).toFixed(0)} | 2nd half ${s(x => x.t >= cut).toFixed(0)}`); }
// What to do with signal-time ENTERs: skip, or wait for a later check (≥ N min after the signal) that still passes the rules
const V = {}; const add = (k, t, v) => { (V[k] ||= []).push({ t, v }); };
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp != null && s.sp <= 13 && b7(s.now) >= -2)) continue; const off = Math.round((s.now - r.t) / M); const v0 = sim(hl, off, s.p, -1, [6, 12, 20, 30]).v;
  if (off !== 0) { for (const k of ['current', 'skip', 'wait 5m', 'wait 15m', 'wait 30m']) add(k, s.now, v0); continue; }
  add('current', s.now, v0); add('skip', s.now, 0);
  for (const w of [5, 15, 30]) { let e = null; for (const st of r.all) { if (st.k === 'missed') break; if ((st.now - r.t) / M >= w && R[0][1](st) && (st.sp == null || st.sp <= 13)) { e = st; break; } }
    add(`wait ${w}m`, s.now, e ? sim(hl, Math.round((e.now - r.t) / M), e.p, -1, [6, 12, 20, 30]).v : 0); } }
console.log('\nAll shorts, what to do with signal-time ENTERs:');
for (const [k, a] of Object.entries(V)) { const s = g => a.filter(g).reduce((p, x) => p + x.v, 0); console.log(`${k.padEnd(10)} total ${s(() => true).toFixed(0).padStart(4)} | 1st half ${s(x => x.t < cut).toFixed(0).padStart(4)} | 2nd half ${s(x => x.t >= cut).toFixed(0).padStart(4)}`); }
