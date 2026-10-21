// Every replayed signal with an ENTER → data/base_trades.json: group the bot puts it in, short result (live entry rule),
// runner-long result (opens at the first pass, like runnerLongNow), and entry-time candle/market features.
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'); const K = require('./evalkit');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json')), K5 = JSON.parse(fs.readFileSync('k5_entry.json'));
const out = [];
for (const r of rows) { const hl = paths[r.s + r.t], k5 = K5[r.s + r.t]; if (!hl) continue;
  const a = K.firstPass(r.all); if (a < 0) continue; let b = a === 0 ? K.firstPass(r.all, 1) : a;
  const sA = r.all[a], sB = b >= 0 ? r.all[b] : null;
  const bk = H1.BTCUSDT, hk = H1[r.s]; if (!hk) continue; const t = sB ? sB.now : sA.now, bj = K.idx(bk, t), hj = K.idx(hk, r.t); if (hj < 200) continue;
  const b7 = K.chg(bk, bj, 168), run7d = K.chg(hk, hj, 168), sp = (sB || sA).sp;
  const group = !r.hasSpot ? (run7d >= 20 ? 'runner' : 'nospot_low') : sp == null ? 'nosp_data' : sp > 13 ? 'highshare' : b7 < -2 ? 'btcpause' : 'live';
  const offB = sB ? Math.round((sB.now - r.t) / K.M) : null, offA = Math.round((sA.now - r.t) / K.M);
  if (hl.length / 3 < (offB ?? offA) + 60) continue;
  const sh = sB ? K.sim(hl, offB, sB.p, 'short') : null, lg = K.sim(hl, offA, sA.p, 'long');
  const F = {};
  if (k5 && k5.length >= 300) { K.candleFeats(F, '5m.', k5); K.candleFeats(F, '15m.', K.agg(k5, 3, 5 * K.M)); }
  const h1 = hk.slice(0, K.idx(hk, t) + 1).slice(-400).map(x => [x[0], x[1], x[2], x[3], x[4], x[5], 0]);
  K.candleFeats(F, '1h.', h1.slice(-120), false); K.candleFeats(F, '4h.', K.agg(h1, 4, K.Hr).slice(-60), false);
  const d1 = K.agg(hk.slice(0, K.idx(hk, t) + 1).map(x => [x[0], x[1], x[2], x[3], x[4], x[5], 0]), 24, K.Hr); // daily candles from 1h (UTC days, complete only)
  if (d1.length >= 20) { const L = d1.at(-1), c = d1.map(x => x[4]); F['1d.rsi'] = K.rsi(c); F['1d.distE20'] = (L[4] / K.ema(c, 20) - 1) * 100; F['1d.ret3'] = (L[4] / d1.at(-4)[4] - 1) * 100;
    F['1d.upWickPrev'] = (L[2] - Math.max(L[1], L[4])) / (L[2] - L[3] || 1e-12); F['1d.greens5'] = d1.slice(-5).filter(x => x[4] > x[1]).length; }
  const hiN = (n) => { const w = hk.filter(x => x[0] >= r.t - n * K.D && x[0] < r.t - K.D); return w.length > 24 * n * 0.6 ? Math.max(...w.map(x => x[2])) : null; };
  const p0 = r.sig.price; for (const n of [7, 14, 30]) { const h = hiN(n); F[`vs${n}dHigh%`] = h ? (p0 / h - 1) * 100 : null; }
  const lo30 = hk.filter(x => x[0] >= r.t - 30 * K.D && x[0] < r.t - K.D); F['vs30dLow%'] = lo30.length > 400 ? (p0 / Math.min(...lo30.map(x => x[3])) - 1) * 100 : null;
  const v30 = hk.filter(x => x[0] >= r.t - 30 * K.D && x[0] < r.t - K.D).reduce((s, x) => s + x[5], 0) / 29, v24 = hk.filter(x => x[0] >= r.t - K.D && x[0] < r.t).reduce((s, x) => s + x[5], 0);
  F['vol24/avg30d'] = v30 ? v24 / v30 : null;
  const s = sB || sA;
  Object.assign(F, { 'w.topAge': s.age, 'w.oi1h': s.oi, 'w.cisd': s.c, 'w.cisd15': s.c15, 'w.belowHigh': s.below, 'w.retrace': s.ret, 'w.spotShare': s.sp, 'w.stepsWaited': sB ? b : a,
    'w.minSinceSignal': (s.now - r.t) / K.M, 'w.newHighsSeen': r.all.slice(0, sB ? b : a).filter(x => x.k === 'new_high').length,
    'w.topAboveSignal%': (s.p / (1 - (s.below ?? 0) / 100) / p0 - 1) * 100, 'w.spotShareAtSignal': r.all[0].sp, 'w.oiChgSinceSignal': s.oi != null && r.all[0].oi != null ? s.oi - r.all[0].oi : null,
    'sig.score': r.sig.score, 'sig.pump24h': r.sig.pump, 'sig.oi4h': r.sig.oi4h, 'sig.funding': r.sig.fr * 100, 'sig.rsi5': r.sig.rsi5, 'sig.near': r.sig.near, 'sig.vol24M': r.sig.vol24 / 1e6,
    'mkt.run7d': run7d, 'mkt.run3d': K.chg(hk, hj, 72), 'mkt.btc1h': K.chg(bk, bj, 1), 'mkt.btc4h': K.chg(bk, bj, 4), 'mkt.btc24h': K.chg(bk, bj, 24), 'mkt.btc7d': b7, 'mkt.hourUTC': new Date(t).getUTCHours(), 'mkt.weekday': new Date(t).getUTCDay() });
  out.push({ key: r.s + r.t, s: r.s, sigT: r.t, t, group, hasSpot: r.hasSpot, sp, b7, run7d, entryA: sA.p, entryB: sB?.p ?? null, offA, offB,
    short: sh, long: lg, F }); }
// market breadth at each entry: median 24h change of all coins in h1L
const syms = Object.keys(H1).filter(s => s !== 'BTCUSDT');
for (const x of out) { const ch = []; for (const s of syms) { const k = H1[s], j = K.idx(k, x.t); if (j >= 24) ch.push(K.chg(k, j, 24)); } ch.sort((a, b) => a - b);
  x.F['mkt.altMedian24h'] = ch[ch.length >> 1]; x.F['mkt.altsUp10%'] = ch.filter(v => v > 10).length / ch.length * 100; }
fs.writeFileSync('base_trades.json', JSON.stringify(out));
const g = {}; for (const x of out) { const o = g[x.group] || (g[x.group] = { n: 0, s: 0, l: 0, sn: 0 }); o.n++; if (x.short) { o.s += x.short.pnl; o.sn++; } o.l += x.long.pnl; }
console.log('saved', out.length); for (const [k, o] of Object.entries(g)) console.log(k.padEnd(12), o.n, 'trades | short', K.$(o.s), `(${o.sn})`, '| long', K.$(o.l));
