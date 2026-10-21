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
// For each trade: deepest move against us before TP1 (+6% our way) or the -8% stop; did it win (TP1 first)?
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]), LO = (hl, i) => Math.min(hl[3 * i], hl[3 * i + 1]);
function path(hl, off, E, dir) { let adv = 0; const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const fav = dir > 0 ? (HI(hl, i) / E - 1) * 100 : (1 - LO(hl, i) / E) * 100, against = dir > 0 ? (1 - LO(hl, i) / E) * 100 : (HI(hl, i) / E - 1) * 100;
    if (against >= 8) return { adv: 8, win: false }; adv = Math.max(adv, against); if (fav >= 6) return { adv, win: true }; } return { adv, win: null }; }
const out = { S: [], L: [] };
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  const off = Math.round((s.now - r.t) / M), hasSpot = s.sp != null, noSpot = s.sp == null && r.hasSpot === false;
  if (hasSpot && s.sp <= 13 && b7(s.now) >= -2) out.S.push(path(hl, off, s.p, -1));
  const rr = run7(r.s, r.t); if (noSpot && rr != null && rr >= 20) out.L.push(path(hl, off, s.p, 1)); }
for (const [k, a0] of Object.entries(out)) { const a = a0.filter(x => x.win != null), W = a.filter(x => x.win);
  console.log(`\n${k === 'S' ? 'SHORTS' : 'RUNNER LONGS'}: ${a.length} trades, ${W.length} reached TP1 (+6%) first, ${a.length - W.length} hit the 8% stop first`);
  console.log(' Winners — deepest move against us before TP1:');
  const bk = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]; for (const [lo, hi] of bk) { const n = W.filter(x => x.adv >= lo && x.adv < hi).length; console.log(`   ${lo}–${hi}%: ${String(n).padStart(3)}  (${(n / W.length * 100).toFixed(0).padStart(2)}%) ${'█'.repeat(Math.round(n / W.length * 60))}`); }
  console.log(' If price has already gone X% against us, chance it still reaches TP1 before the 8% stop:');
  for (const x of [2, 3, 4, 5, 6, 7]) { const b = a.filter(y => y.adv >= x); console.log(`   gone ≥${x}% against: ${String(b.length).padStart(3)} trades → ${(b.filter(y => y.win).length / b.length * 100).toFixed(0)}% still win`); } }
