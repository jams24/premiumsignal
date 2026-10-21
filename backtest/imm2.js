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
// The 64 signal-time ENTER shorts: what the 5-min re-check does to each, grouped by how fast the coin dumped
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]), LO = (hl, i) => Math.min(hl[3 * i], hl[3 * i + 1]);
const X = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp != null && s.sp <= 13 && b7(s.now) >= -2)) continue; const off = Math.round((s.now - r.t) / M); if (off !== 0) continue;
  const now = sim(hl, 0, s.p, -1, [6, 12, 20, 30]).v; let t1 = null, st = null; for (let i = 0; i < 2880; i++) { if ((HI(hl, i) / s.p - 1) * 100 >= 8) { st = i; break; } if ((1 - LO(hl, i) / s.p) * 100 >= 6) { t1 = i; break; } }
  let e = null; for (const q of r.all) { if (q.k === 'missed') break; if ((q.now - r.t) / M >= 5 && R[0][1](q) && (q.sp == null || q.sp <= 13)) { e = q; break; } }
  const w = e ? sim(hl, Math.round((e.now - r.t) / M), e.p, -1, [6, 12, 20, 30]).v : 0;
  X.push({ s: r.s, t: s.now, now, w, t1, st, delay: e ? Math.round((e.now - r.t) / M) : null, px: e ? (e.p / s.p - 1) * 100 : null }); }
const g = [['Dumped fast: TP1 within 30 min', x => x.t1 != null && x.t1 <= 30], ['TP1 after 30 min', x => x.t1 != null && x.t1 > 30], ['Hit the 8% stop first', x => x.st != null && x.t1 == null], ['Neither in 48h', x => x.t1 == null && x.st == null]];
console.log(`${X.length} signal-time ENTER shorts ($150 each)\n`);
for (const [n, f] of g) { const a = X.filter(f); if (!a.length) continue; const s = k => a.reduce((p, x) => p + x[k], 0);
  console.log(`${n.padEnd(32)} ${String(a.length).padStart(2)} tr | enter now ${s('now').toFixed(0).padStart(4)} | 5-min re-check ${s('w').toFixed(0).padStart(4)} | entered at 5 min ${a.filter(x => x.delay === 5).length}, later ${a.filter(x => x.delay > 5).length} (median ${(() => { const d = a.filter(x => x.delay > 5).map(x => x.delay).sort((p, q) => p - q); return d.length ? d[d.length >> 1] : '-'; })()} min), never ${a.filter(x => x.delay == null).length} | when entered, price vs signal: median ${(() => { const d = a.filter(x => x.px != null).map(x => x.px).sort((p, q) => p - q); return d.length ? (d[d.length >> 1] >= 0 ? '+' : '') + d[d.length >> 1].toFixed(1) + '%' : '-'; })()}`); }
const fast = X.filter(x => x.t1 != null && x.t1 <= 30); console.log('\nFast dumpers one by one (enter now → re-check):'); for (const x of fast) console.log(`  ${x.s.padEnd(12)} TP1 at ${x.t1}m | now ${x.now.toFixed(1).padStart(6)} → re-check ${x.w.toFixed(1).padStart(6)} ${x.delay == null ? '(missed)' : `(entered at ${x.delay}m, ${x.px >= 0 ? '+' : ''}${x.px.toFixed(1)}% vs signal)`}`);
console.log(`\nTOTAL enter now ${X.reduce((p, x) => p + x.now, 0).toFixed(0)} | re-check ${X.reduce((p, x) => p + x.w, 0).toFixed(0)}`);
