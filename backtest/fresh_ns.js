// No-spot × fresh breakout (run7d < 60%) vs runaways, 4.5-month replay (current ENTER rules), $150, TP1 6%
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E, run = false, why = 'open'; const fav = v => -(v / E - 1) * 100; let maxUp = 0;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const fh = fav(hl[3 * i]), fl = fav(hl[3 * i + 1]); last = hl[3 * i + 2]; if (hit === 0) maxUp = Math.max(maxUp, -fh);
    if (fh <= stop) { p += rem * stop / 100; rem = 0; why = stop < 0 ? 'stop' : 'be'; break; }
    while (hit < 4 && fl >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) { why = 'tp4'; break; } }
  if (rem > 1e-9) p += rem * fav(last) / 100;
  // runaway: from entry, price rises >= 20% before it ever falls 6%
  let ru = false; for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { if (-(hl[3 * i + 1] / E - 1) * 100 >= 6) break; if ((hl[3 * i] / E - 1) * 100 >= 20) { ru = true; break; } }
  return { v: p * POS - POS * 0.001, stop: why === 'stop', ru, tp1: hit >= 1 }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const b7 = (t) => { const k = H1.BTCUSDT; const j = idx(k, t); return (k[j][4] / k[j - 168][4] - 1) * 100; };
const T = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  const off = Math.round((s.now - r.t) / M); const x = sim(hl, off, s.p); const rr = run7(r.s, r.t);
  const spot = s.sp == null ? (r.hasSpot === false ? 'none' : 'unk') : s.sp <= 13 ? 'low' : 'high';
  T.push({ ...x, spot, fresh: rr == null ? null : rr < 60, rr, t: r.t, s: r.s, b7: b7(s.now) }); }
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const line = (n, a) => { if (!a.length) return console.log(n.padEnd(44), 0); const s = a.reduce((p, x) => p + x.v, 0); const half = a.filter(x => x.t < Date.parse('2026-08-15'));
  console.log(n.padEnd(44), String(a.length).padStart(4), '| runaway', (a.filter(x => x.ru).length / a.length * 100).toFixed(0).padStart(3) + '%', '| full stop', (a.filter(x => x.stop).length / a.length * 100).toFixed(0).padStart(3) + '%', '| TP1', (a.filter(x => x.tp1).length / a.length * 100).toFixed(0).padStart(3) + '%', '| P&L', $(s).padStart(6), ('$' + (s / a.length).toFixed(2)).padStart(7) + '/tr', '| Jun–mid Aug', $(half.reduce((p, x) => p + x.v, 0)), '| mid Aug–Oct', $(a.filter(x => x.t >= Date.parse('2026-08-15')).reduce((p, x) => p + x.v, 0))); };
console.log('ENTER trades', T.length, '(runaway = +20% against us before 6% our way, within 48h)');
line('ALL', T);
for (const sp of ['none', 'low', 'high']) for (const f of [true, false]) line(`${sp === 'none' ? 'NO spot' : sp === 'low' ? 'spot ≤13%' : 'spot >13%'} · ${f ? 'FRESH (7d run <60%)' : 'EXTENDED (≥60%)'}`, T.filter(x => x.spot === sp && x.fresh === f));
console.log('\nNo spot · fresh, by 7d run'); for (const [a, b] of [[-99, 0], [0, 20], [20, 40], [40, 60]]) line(`  run7d ${a}..${b}%`, T.filter(x => x.spot === 'none' && x.rr >= a && x.rr < b));
console.log('\nWith BTC pause (-2%) applied'); const P = T.filter(x => x.b7 >= -2);
for (const sp of ['none', 'low']) for (const f of [true, false]) line(`${sp === 'none' ? 'NO spot' : 'spot ≤13%'} · ${f ? 'fresh' : 'extended'}`, P.filter(x => x.spot === sp && x.fresh === f));
