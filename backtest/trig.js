// Entry triggers after the live ENTER, on 5m candles built from the 1m path:
// wait up to W min for a 5m sell trigger (or a bounce to sell into), skip if a new high prints first; optionally short anyway at the end.
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json')), K5 = JSON.parse(fs.readFileSync('k5_entry.json'));
const POS = 150, M = 60000, Hr = 3600000;
const pass = s => (s.oi ?? 0) <= 30 && (s.age ?? -1) >= 15 && s.c >= 1;
function sim(hl, off, E) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E;
  const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const up = (hl[3 * i] / E - 1) * 100, dn = (1 - hl[3 * i + 1] / E) * 100; last = hl[3 * i + 2];
    if (-up <= stop) { p += rem * stop; rem = 0; break; }
    while (hit < 4 && dn >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; }
    if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * (1 - last / E) * 100;
  return { pnl: p / 100 * POS - POS * 0.001, sl: hit === 0 && p < 0 && rem === 0 }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const first = (all, from = 0) => { for (let i = from; i < all.length; i++) { if (all[i].k === 'missed') return -1; if (pass(all[i])) return i; } return -1; };

const base = [];
for (const r of rows) { const hl = paths[r.s + r.t], k5 = K5[r.s + r.t]; if (!hl || !r.hasSpot || !k5 || k5.length < 10) continue;
  let i = first(r.all); if (i === 0) i = first(r.all, 1); if (i < 0) continue; const s = r.all[i];
  const bk = H1.BTCUSDT, bj = idx(bk, s.now); if (s.sp == null || s.sp > 13 || (bk[bj][4] / bk[bj - 168][4] - 1) * 100 < -2) continue;
  const off = Math.round((s.now - r.t) / M); if (hl.length / 3 < off + 200) continue;
  base.push({ key: r.s + r.t, t: s.now, hl, off, E: s.p, top: s.p / (1 - (s.below ?? 0) / 100), pre: k5.slice(-6).map(c => ({ o: c[1], h: c[2], l: c[3], c: c[4] })) }); }
base.sort((a, b) => a.t - b.t);

// 5m bars after entry from the 1m path (open = previous close)
const bars = (x, n) => { const out = []; let prev = x.E; for (let j = 0; j < n; j++) { const a = x.off + 5 * j; if ((a + 5) * 3 > x.hl.length) break; let h = 0, l = Infinity;
  for (let m = a; m < a + 5; m++) { h = Math.max(h, x.hl[3 * m]); l = Math.min(l, x.hl[3 * m + 1]); } const c = x.hl[3 * (a + 4) + 2]; out.push({ o: prev, h, l, c, end: a + 5 }); prev = c; } return out; };
const V = {};
V['LIVE: short at ENTER'] = x => ({ off: x.off, E: x.E });
const trig = {
  'next 5m candle closes red': (b, all, j) => b.c < b.o,
  '5m close below previous 5m low': (b, all, j) => b.c < all[j - 1].l,
  '5m close below lowest low of last 3': (b, all, j) => b.c < Math.min(...all.slice(j - 3, j).map(y => y.l)),
  '5m lower high + red close': (b, all, j) => b.h < all[j - 1].h && b.c < b.o,
  '5m close below ENTER candle low': (b, all, j) => b.c < all[5].l };
for (const [name, fn] of Object.entries(trig)) for (const W of [15, 30, 60]) for (const anyway of [false, true]) {
  V[`5m trigger: ${name}, ${W} min${anyway ? ', else short at end' : ', else skip'}`] = x => { const all = [...x.pre, ...bars(x, W / 5)];
    for (let j = 6; j < all.length; j++) { const b = all[j]; if (b.h > x.top * 1.001) return anyway ? null : null; if (fn(b, all, j)) return { off: b.end, E: b.c }; }
    const L = all.at(-1); return anyway && all.length > 6 ? { off: L.end, E: L.c } : null; }; }
// 1m: first 1m close below the low of the last closed 5m candle before ENTER
for (const W of [15, 30, 60]) V[`1m close below the last 5m low before ENTER, ${W} min, else skip`] = x => { const lo = x.pre.at(-1).l;
  for (let m = x.off; m < x.off + W; m++) { if (x.hl[3 * m] > x.top * 1.001) return null; if (x.hl[3 * m + 2] < lo) return { off: m + 1, E: x.hl[3 * m + 2] }; } return null; };
// sell the bounce: limit X% above the ENTER price, W min; skip if a new high first
for (const X of [0.5, 1, 2, 3]) for (const W of [30, 60]) for (const anyway of [false, true]) V[`sell a bounce +${X}% above ENTER, ${W} min${anyway ? ', else market at end' : ', else skip'}`] = x => {
  const lim = x.E * (1 + X / 100); for (let m = x.off; m < x.off + W; m++) { if (x.hl[3 * m] >= lim) return lim > x.top * 1.001 ? null : { off: m, E: lim }; }
  return anyway ? { off: x.off + W, E: x.hl[3 * (x.off + W - 1) + 2] } : null; };

const $ = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const liveMap = new Map(base.map(x => [x.key, sim(x.hl, x.off, x.E)]));
console.log(`Live-rule short set: ${base.length} trades, $150, fees in, stop 8% from the actual entry. Halves split at the same date for all.\n`);
const mid = base[Math.floor(base.length / 2)].t; const out = [];
for (const [name, fn] of Object.entries(V)) { const T = [];
  for (const x of base) { const e = fn(x); if (!e) continue; T.push({ key: x.key, t: x.t, ...sim(x.hl, e.off, e.E) }); }
  const s = T.reduce((a, y) => a + y.pnl, 0), h1 = T.filter(y => y.t < mid).reduce((a, y) => a + y.pnl, 0), h2 = s - h1, ks = new Set(T.map(y => y.key));
  const dr = base.filter(x => !ks.has(x.key)).map(x => liveMap.get(x.key));
  const mo = ['06', '07', '08', '09', '10'].map(m => $(T.filter(y => new Date(y.t).toISOString().slice(5, 7) === m).reduce((a, y) => a + y.pnl, 0)).padStart(5)).join(' ');
  out.push({ name, line: `${name.padEnd(72)} ${String(T.length).padStart(3)} tr ${(T.filter(y => y.pnl > 0).length / T.length * 100).toFixed(0).padStart(3)}% win ${(T.filter(y => y.sl).length / T.length * 100).toFixed(0).padStart(3)}% stop ${$(s).padStart(6)} | halves ${$(h1).padStart(5)} ${$(h2).padStart(5)} | ${mo} | skips ${dr.length} (${dr.filter(y => y.sl).length} stops, ${dr.filter(y => y.pnl > 0).length} wins)`, s }); }
for (const o of out) console.log(o.line);
