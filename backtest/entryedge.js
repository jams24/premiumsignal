// Entry-check mining: ~80 measures at the live ENTER moment (5m/15m/1h candles, flow, OI, watch steps, market),
// each tested as "skip if above/below X" picked on the first half (time) and checked on the second half, plus a shuffle placebo.
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
const chg = (k, j, n) => j - n >= 0 ? (k[j][4] / k[j - n][4] - 1) * 100 : null;
const first = (all, from = 0) => { for (let i = from; i < all.length; i++) { if (all[i].k === 'missed') return -1; if (pass(all[i])) return i; } return -1; };
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; for (let i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; };
const rsi = (c, p = 14) => { if (c.length <= p + 1) return null; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= p; l /= p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
const agg = (k, n) => { const out = []; for (const c of k) { const b = Math.floor(c[0] / (n * 5 * M)) * n * 5 * M; const o = out.at(-1);
  if (!o || o[0] !== b) out.push([b, c[1], c[2], c[3], c[4], c[5], c[6], 1]); else { o[2] = Math.max(o[2], c[2]); o[3] = Math.min(o[3], c[3]); o[4] = c[4]; o[5] += c[5]; o[6] += c[6]; o[7]++; } }
  return out.filter(c => c[7] === n); };

function candleFeats(F, pre, k) { // k: [t,o,h,l,c,qv,tbq]
  if (k.length < 30) return; const L = k.at(-1), P = k.at(-2), c = k.map(x => x[4]), rg = L[2] - L[3] || 1e-12, n = k.length;
  F[pre + 'red'] = L[4] < L[1] ? 1 : 0; F[pre + 'body%'] = (L[4] / L[1] - 1) * 100;
  F[pre + 'upWick'] = (L[2] - Math.max(L[1], L[4])) / rg; F[pre + 'loWick'] = (Math.min(L[1], L[4]) - L[3]) / rg; F[pre + 'closePos'] = (L[4] - L[3]) / rg;
  for (const b of [1, 3, 6, 12]) F[pre + 'ret' + b] = (L[4] / k[n - 1 - b][4] - 1) * 100;
  F[pre + 'reds6'] = k.slice(-6).filter(x => x[4] < x[1]).length;
  let lh = 0; for (let i = n - 5; i < n; i++) if (k[i][2] < k[i - 1][2]) lh++; F[pre + 'lowerHighs5'] = lh;
  F[pre + 'brkPrevLow'] = L[4] < P[3] ? 1 : 0; F[pre + 'brk3Low'] = L[4] < Math.min(...k.slice(-4, -1).map(x => x[3])) ? 1 : 0;
  F[pre + 'brk6Low'] = L[4] < Math.min(...k.slice(-7, -1).map(x => x[3])) ? 1 : 0;
  const e9 = ema(c, 9), e20 = ema(c, 20), e50 = ema(c, Math.min(50, n));
  F[pre + 'distE9'] = (L[4] / e9 - 1) * 100; F[pre + 'distE20'] = (L[4] / e20 - 1) * 100; F[pre + 'distE50'] = (L[4] / e50 - 1) * 100; F[pre + 'e9<e20'] = e9 < e20 ? 1 : 0;
  F[pre + 'rsi'] = rsi(c.slice(-100)); const r3 = rsi(c.slice(-103, -3)); F[pre + 'rsiChg3'] = F[pre + 'rsi'] != null && r3 != null ? F[pre + 'rsi'] - r3 : null;
  const v24 = k.slice(-25, -1).reduce((a, x) => a + x[5], 0) / 24; F[pre + 'volLast/avg'] = v24 ? L[5] / v24 : null;
  const l6 = k.slice(-6), rv = l6.filter(x => x[4] < x[1]).reduce((a, x) => a + x[5], 0), gv = l6.filter(x => x[4] >= x[1]).reduce((a, x) => a + x[5], 0); F[pre + 'redVolShare6'] = rv + gv ? rv / (rv + gv) : null;
  for (const b of [1, 3, 6]) { const s = k.slice(-b); const q = s.reduce((a, x) => a + x[5], 0); F[pre + 'takerBuy' + b] = q ? s.reduce((a, x) => a + x[6], 0) / q : null; }
  const tbPrev = k.slice(-12, -6), qp = tbPrev.reduce((a, x) => a + x[5], 0); F[pre + 'takerBuyChg'] = qp && F[pre + 'takerBuy6'] != null ? F[pre + 'takerBuy6'] - tbPrev.reduce((a, x) => a + x[6], 0) / qp : null;
  let tr = 0; for (let i = n - 14; i < n; i++) tr += Math.max(k[i][2], k[i - 1][4]) - Math.min(k[i][3], k[i - 1][4]); const atr = tr / 14; F[pre + 'atr%'] = atr / L[4] * 100;
  const hi = Math.max(...k.slice(-24).map(x => x[2])); F[pre + 'dropFromHi/ATR'] = (hi - L[4]) / atr;
  F[pre + 'range12%'] = (Math.max(...k.slice(-12).map(x => x[2])) / Math.min(...k.slice(-12).map(x => x[3])) - 1) * 100;
  F[pre + 'engulf'] = L[4] < L[1] && P[4] > P[1] && L[4] < P[1] && L[1] >= P[4] ? 1 : 0;
  const s = k.slice(-24), pv = s.reduce((a, x) => a + x[5], 0), vw = pv ? s.reduce((a, x) => a + x[5] * (x[2] + x[3] + x[4]) / 3, 0) / pv : null; F[pre + 'distVwap'] = vw ? (L[4] / vw - 1) * 100 : null;
}

const T = [];
for (const r of rows) { const hl = paths[r.s + r.t], k5 = K5[r.s + r.t]; if (!hl || !r.hasSpot || !k5 || k5.length < 300) continue;
  let i = first(r.all); if (i === 0) i = first(r.all, 1); if (i < 0) continue; const s = r.all[i];
  const off = Math.round((s.now - r.t) / M); if (hl.length / 3 < off + 60) continue;
  const bk = H1.BTCUSDT, bj = idx(bk, s.now), hk = H1[r.s], hj = hk ? idx(hk, s.now) : -1; if (hj < 200) continue;
  const b7 = chg(bk, bj, 168), live = s.sp != null && s.sp <= 13 && b7 >= -2;
  const F = {};
  candleFeats(F, '5m.', k5); candleFeats(F, '15m.', agg(k5, 3)); candleFeats(F, '1h.', hk.slice(0, hj + 1).slice(-120).map(x => [x[0], x[1], x[2], x[3], x[4], x[5], x[5] / 2]));
  for (const x of Object.keys(F)) if (x.startsWith('1h.taker')) delete F[x]; // no taker data in stored 1h candles
  Object.assign(F, { 'w.topAge': s.age, 'w.oi1h': s.oi, 'w.cisd': s.c, 'w.cisd15': s.c15, 'w.belowHigh': s.below, 'w.retrace': s.ret, 'w.spotShare': s.sp, 'w.stepsWaited': i,
    'w.minSinceSignal': (s.now - r.t) / M, 'w.oiChgSinceSignal': s.oi != null && r.all[0].oi != null ? s.oi - r.all[0].oi : null, 'w.newHighsSeen': r.all.slice(0, i).filter(x => x.k === 'new_high').length,
    'w.topAboveSignal%': (s.p / (1 - (s.below ?? 0) / 100) / r.sig.price - 1) * 100,
    'sig.score': r.sig.score, 'sig.pump24h': r.sig.pump, 'sig.oi4h': r.sig.oi4h, 'sig.funding': r.sig.fr * 100, 'sig.rsi5': r.sig.rsi5, 'sig.near': r.sig.near, 'sig.vol24M': r.sig.vol24 / 1e6,
    'mkt.run7d': chg(hk, hj, 168), 'mkt.run3d': chg(hk, hj, 72), 'mkt.btc1h': chg(bk, bj, 1), 'mkt.btc4h': chg(bk, bj, 4), 'mkt.btc24h': chg(bk, bj, 24), 'mkt.btc7d': b7,
    'mkt.hourUTC': new Date(s.now).getUTCHours() });
  const res = sim(hl, off, s.p); T.push({ key: r.s + r.t, t: s.now, live, F, ...res }); }
T.sort((a, b) => a.t - b.t);
const L = T.filter(x => x.live);
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const sum = a => a.reduce((s, x) => s + x.pnl, 0);
console.log(`live-rule trades ${L.length} (${$(sum(L))}), all spot-coin ENTER trades ${T.length} (${$(sum(T))})\n`);

// best skip rule per feature on the train half, then its result on the test half
const names = Object.keys(L[0].F);
function bestRule(train, f, pnlOf) { const v = train.map(x => x.F[f]).filter(x => x != null && isFinite(x)).sort((a, b) => a - b); if (v.length < train.length * 0.8) return null;
  let best = null; const qs = [...new Set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q => v[Math.floor(q * (v.length - 1))]))];
  for (const th of qs) for (const dir of ['>', '<']) { const sk = train.filter(x => x.F[f] != null && (dir === '>' ? x.F[f] > th : x.F[f] < th)); if (sk.length < train.length * 0.05 || sk.length > train.length * 0.5) continue;
    const g = -sk.reduce((a, x) => a + pnlOf(x), 0); if (!best || g > best.g) best = { f, th, dir, g, n: sk.length }; } return best; }
const skipGain = (set, b, pnlOf = x => x.pnl) => { const sk = set.filter(x => x.F[b.f] != null && (b.dir === '>' ? x.F[b.f] > b.th : x.F[b.f] < b.th)); return { g: -sk.reduce((a, x) => a + pnlOf(x), 0), n: sk.length, sl: sk.filter(x => x.sl).length, w: sk.filter(x => x.pnl > 0).length }; };
const h = Math.floor(L.length / 2), tr = L.slice(0, h), te = L.slice(h);
const R = names.map(f => bestRule(tr, f, x => x.pnl)).filter(Boolean).map(b => ({ ...b, test: skipGain(te, b), wide: skipGain(T.filter(x => !x.live), b) })).sort((a, b) => b.g - a.g);
console.log(`Train = first ${tr.length} live trades (${new Date(tr[0].t).toISOString().slice(0, 10)} → ${new Date(tr.at(-1).t).toISOString().slice(0, 10)}), test = last ${te.length}. Gain = $ saved by skipping.`);
console.log('feature'.padEnd(22), 'rule'.padEnd(16), 'train gain', ' test gain (skips: stops/winners)', ' other spot trades');
for (const b of R.slice(0, 30)) console.log(b.f.padEnd(22), ('skip if ' + b.dir + ' ' + (+b.th.toFixed(3))).padEnd(16), $(b.g).padStart(8), '  ', $(b.test.g).padStart(6), `(${b.test.n}: ${b.test.sl}/${b.test.w})`.padEnd(14), $(b.wide.g).padStart(6));
const held = R.filter(b => b.test.g > 0).length; console.log(`\nrules whose train pick also saved money on test: ${held} of ${R.length} (${(held / R.length * 100).toFixed(0)}%)`);
console.log('top-10 by train: test gains', R.slice(0, 10).map(b => $(b.test.g)).join(' '), '→ total', $(R.slice(0, 10).reduce((a, b) => a + b.test.g, 0)));

// placebo: shuffle P&L between trades, redo the search; how good is the best train rule by pure chance?
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pl = []; const real = R[0].g;
for (let k = 0; k < 40; k++) { const sh = tr.map(x => x.pnl); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  const m = new Map(tr.map((x, i) => [x, sh[i]])); pl.push(Math.max(...names.map(f => bestRule(tr, f, x => m.get(x))?.g ?? 0))); }
pl.sort((a, b) => a - b); console.log(`placebo best train gain: median ${$(pl[20])}, 90th pct ${$(pl[36])}, max ${$(pl.at(-1))}  vs real best ${$(real)}`);

// same-direction check: correlation of each feature with P&L in each half and on the other spot trades
const rk = a => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
  for (let j = 0; j < o.length;) { let e = j; while (e + 1 < o.length && o[e + 1][0] === o[j][0]) e++; for (let q = j; q <= e; q++) r[o[q][1]] = (j + e) / 2; j = e + 1; } return r; }; // ties share their average rank
const sp = (set, f) => { const s = set.filter(x => x.F[f] != null && isFinite(x.F[f])); if (s.length < 30) return null; const a = rk(s.map(x => x.F[f])), b = rk(s.map(x => x.pnl)), n = s.length, ma = a.reduce((t, x) => t + x, 0) / n, mb = b.reduce((t, x) => t + x, 0) / n;
  let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? nu / Math.sqrt(da * db) : null; };
const C = names.map(f => ({ f, a: sp(tr, f), b: sp(te, f), w: sp(T.filter(x => !x.live), f) })).filter(x => x.a != null && x.b != null);
const cons = C.filter(x => Math.sign(x.a) === Math.sign(x.b) && Math.sign(x.b) === Math.sign(x.w) && Math.min(Math.abs(x.a), Math.abs(x.b)) >= 0.08).sort((p, q) => Math.min(Math.abs(q.a), Math.abs(q.b)) - Math.min(Math.abs(p.a), Math.abs(p.b)));
console.log(`\nfeatures with the same-sign link to P&L in train, test and other trades (|rank corr| ≥ 0.08 both halves; ~0.11 = noise level at n=165):`);
for (const x of cons) console.log(x.f.padEnd(22), 'train', x.a.toFixed(2), 'test', x.b.toFixed(2), 'other', x.w.toFixed(2));
fs.writeFileSync('entryfeat_rows.json', JSON.stringify(T.map(x => ({ key: x.key, t: x.t, live: x.live, pnl: x.pnl, sl: x.sl, F: x.F }))));

// yes/no checks: average P&L when the check is true vs false, per half and on the other spot trades
const bin = names.filter(f => L.every(x => x.F[f] == null || x.F[f] === 0 || x.F[f] === 1));
const avg = (set, f, v) => { const s = set.filter(x => x.F[f] === v); return s.length ? { n: s.length, a: sum(s) / s.length, sl: s.filter(x => x.sl).length / s.length * 100 } : { n: 0, a: 0, sl: 0 }; };
console.log('\nyes/no checks at ENTER: $/trade when YES vs NO (stop-out % in brackets)');
console.log('check'.padEnd(18), 'train yes'.padEnd(22), 'train no'.padEnd(22), 'test yes'.padEnd(22), 'test no'.padEnd(22), 'other yes / no');
const fm = o => `${o.n} ${(o.a >= 0 ? '+' : '') + o.a.toFixed(2)} (${o.sl.toFixed(0)}%)`.padEnd(22);
for (const f of bin) { const O = T.filter(x => !x.live); const oy = avg(O, f, 1), on = avg(O, f, 0);
  console.log(f.padEnd(18), fm(avg(tr, f, 1)), fm(avg(tr, f, 0)), fm(avg(te, f, 1)), fm(avg(te, f, 0)), `${oy.n} ${oy.a.toFixed(2)} / ${on.n} ${on.a.toFixed(2)}`); }
