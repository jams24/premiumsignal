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
// Do stop-outs share a candle pattern / freshness at entry? Both halves of time must agree.
const HI = (hl, i) => Math.max(hl[3 * i], hl[3 * i + 1]), LO = (hl, i) => Math.min(hl[3 * i], hl[3 * i + 1]), CL = (hl, i) => hl[3 * i + 2];
const T = { S: [], L: [] };
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  const off = Math.round((s.now - r.t) / M), hasSpot = s.sp != null, noSpot = s.sp == null && r.hasSpot === false, rr = run7(r.s, r.t);
  let side = null; if (hasSpot && s.sp <= 13 && b7(s.now) >= -2) side = 'S'; else if (noSpot && rr != null && rr >= 20) side = 'L'; if (!side) continue;
  const dir = side === 'S' ? -1 : 1, x = sim(hl, off, s.p, dir, [6, 12, 20, 30]); const k = H1[r.s], j = idx(k, s.now), c = k[j];
  const rng = c[2] - c[3] || 1e-12; let gs = 0; for (let q = j; q > j - 12 && k[q][4] > k[q][1]; q--) gs++;
  const ch15 = off >= 15 ? (s.p / CL(hl, off - 15) - 1) * 100 : null; let red = 0, n = 0; for (let i = 0; i < off; i++) { n++; if (i && CL(hl, i) < CL(hl, i - 1)) red++; }
  const lastHi = Math.max(...Array.from({ length: Math.min(5, off) }, (_, q) => HI(hl, off - 1 - q))), lastLo = Math.min(...Array.from({ length: Math.min(5, off) }, (_, q) => LO(hl, off - 1 - q)));
  T[side].push({ t: s.now, v: x.v, f: {
    '7d run %': rr, '24h pump %': r.sig.pump, 'Price below top %': s.below, 'Share of pump given back': s.ret, 'Top age (min)': s.age, 'OI 1h %': s.oi, 'Reversal (CISD) count': s.c, 'RSI 5m': r.sig.rsi5, 'Signal score': r.sig.score, 'Funding': r.sig.fr * 100,
    '1h candle: green(1)/red(0)': c[4] > c[1] ? 1 : 0, '1h candle upper wick share': (c[2] - Math.max(c[1], c[4])) / rng, '1h candle size %': (c[2] / c[3] - 1) * 100, 'Green 1h candles in a row': gs,
    'Move in last 15 min %': ch15, 'Last 5 min range %': off ? (lastHi / lastLo - 1) * 100 : null, 'Minutes signal→entry': off, 'Hour UTC': new Date(s.now).getUTCHours() } }); }
const D = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
for (const side of ['S', 'L']) { const a = T[side].sort((x, y) => x.t - y.t), cut = a[a.length >> 1].t, avg = b => b.reduce((p, x) => p + x.v, 0) / (b.length || 1);
  const A1 = avg(a.filter(x => x.t < cut)), A2 = avg(a.filter(x => x.t >= cut));
  console.log(`\n===== ${side === 'S' ? 'SHORTS' : 'RUNNER LONGS'} ${a.length} trades · avg/trade: 1st half ${D(A1)} · 2nd half ${D(A2)} · win(=not stopped) ${(a.filter(x => x.v > -11).length / a.length * 100).toFixed(0)}%`);
  for (const f of Object.keys(a[0].f)) { const b = a.filter(x => x.f[f] != null), vals = b.map(x => x.f[f]).sort((p, q) => p - q), t1 = vals[Math.floor(vals.length / 3)], t2 = vals[Math.floor(vals.length * 2 / 3)];
    const groups = t1 === t2 ? [['≤' + (+t1.toFixed(2)), x => x.f[f] <= t1], ['>' + (+t1.toFixed(2)), x => x.f[f] > t1]] : [['low ≤' + (+t1.toFixed(2)), x => x.f[f] <= t1], ['mid', x => x.f[f] > t1 && x.f[f] <= t2], ['high >' + (+t2.toFixed(2)), x => x.f[f] > t2]];
    const line = groups.map(([n, g]) => { const G = b.filter(g), h1 = G.filter(x => x.t < cut), h2 = G.filter(x => x.t >= cut); const sw = G.filter(x => x.v < -11).length / G.length * 100;
      const flag = avg(h1) < A1 - 1 && avg(h2) < A2 - 1 ? ' ⚠BAD BOTH' : avg(h1) > A1 + 1 && avg(h2) > A2 + 1 ? ' ✓GOOD BOTH' : ''; return `${n}: ${G.length}tr stop ${sw.toFixed(0)}% ${D(avg(h1))}/${D(avg(h2))}${flag}`; }).join(' | ');
    console.log(`${f.padEnd(28)} ${line}`); } }
