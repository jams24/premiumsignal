// Order-book edge test: depth measures at the live ENTER (data/book_entry.json), same train/test/placebo method as entryedge.js,
// plus "wait for the book to turn sell-heavy" triggers after ENTER.
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs');
const R0 = JSON.parse(fs.readFileSync('entryfeat_rows.json')), B = JSON.parse(fs.readFileSync('book_entry.json')), paths = JSON.parse(fs.readFileSync('paths_L.json'));
const M = 60000, POS = 150;
// columns: 1..6 bids at 5,4,3,2,1,0.2%  7..12 asks at 0.2,1,2,3,4,5%
const bid = (s, x) => s[{ 5: 1, 4: 2, 3: 3, 2: 4, 1: 5, 0.2: 6 }[x]], ask = (s, x) => s[{ 0.2: 7, 1: 8, 2: 9, 3: 10, 4: 11, 5: 12 }[x]];
const at = (S, t) => { let r = null; for (const s of S) { if (s[0] <= t) r = s; else break; } return r; };
const lr = (a, b) => a > 0 && b > 0 ? Math.log(a / b) : null;
function feats(S, t) { const s = at(S, t); if (!s || t - s[0] > 3 * M) return null; const F = {};
  for (const x of [0.2, 1, 2, 5]) F[`imb${x}%`] = lr(bid(s, x), ask(s, x));
  F['imb1-5%band'] = lr(bid(s, 5) - bid(s, 1), ask(s, 5) - ask(s, 1));
  F['askNear(1/5)'] = ask(s, 1) / ask(s, 5); F['bidNear(1/5)'] = bid(s, 1) / bid(s, 5);
  for (const m of [15, 30, 60]) { const p = at(S, t - m * M); if (!p || t - m * M - p[0] > 3 * M) continue;
    F[`imb1 chg ${m}m`] = F['imb1%'] - lr(bid(p, 1), ask(p, 1)); F[`imb5 chg ${m}m`] = F['imb5%'] - lr(bid(p, 5), ask(p, 5));
    F[`ask1 chg ${m}m`] = lr(ask(s, 1), ask(p, 1)); F[`bid1 chg ${m}m`] = lr(bid(s, 1), bid(p, 1)); F[`depth2 chg ${m}m`] = lr(bid(s, 2) + ask(s, 2), bid(p, 2) + ask(p, 2)); }
  const w = S.filter(y => y[0] <= t && y[0] > t - 30 * M); if (w.length >= 20) { const im = w.map(y => lr(bid(y, 1), ask(y, 1))).filter(v => v != null);
    F['imb1 avg30m'] = im.reduce((a, v) => a + v, 0) / im.length; F['imb1 min30m'] = Math.min(...im); F['imb1 max30m'] = Math.max(...im); }
  const w2 = S.filter(y => y[0] <= t && y[0] > t - 120 * M); if (w2.length >= 60) F['depth2 vs 2h avg'] = lr(bid(s, 2) + ask(s, 2), w2.reduce((a, y) => a + bid(y, 2) + ask(y, 2), 0) / w2.length);
  F['depth2 $k'] = (bid(s, 2) + ask(s, 2)) / 1e3; return F; }

const T = [];
for (const r of R0) { const S = B[r.key]; if (!S || S.length < 100) continue; const F = feats(S, r.t); if (!F) continue; F['depth2/vol24 (bp)'] = F['depth2 $k'] * 1e3 / (r.F['sig.vol24M'] * 1e6) * 1e4; T.push({ ...r, F }); }
T.sort((a, b) => a.t - b.t);
const L = T.filter(x => x.live), O = T.filter(x => !x.live);
const $ = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0), sum = a => a.reduce((s, x) => s + x.pnl, 0);
console.log(`with order-book data: live-rule trades ${L.length} of 328 (${$(sum(L))}), other spot-coin trades ${O.length} (${$(sum(O))})\n`);
const names = [...new Set(L.flatMap(x => Object.keys(x.F)))];
function bestRule(train, f, pnlOf) { const v = train.map(x => x.F[f]).filter(x => x != null && isFinite(x)).sort((a, b) => a - b); if (v.length < train.length * 0.8) return null;
  let best = null; const qs = [...new Set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q => v[Math.floor(q * (v.length - 1))]))];
  for (const th of qs) for (const dir of ['>', '<']) { const sk = train.filter(x => x.F[f] != null && (dir === '>' ? x.F[f] > th : x.F[f] < th)); if (sk.length < train.length * 0.05 || sk.length > train.length * 0.5) continue;
    const g = -sk.reduce((a, x) => a + pnlOf(x), 0); if (!best || g > best.g) best = { f, th, dir, g, n: sk.length }; } return best; }
const skipGain = (set, b) => { const sk = set.filter(x => x.F[b.f] != null && (b.dir === '>' ? x.F[b.f] > b.th : x.F[b.f] < b.th)); return { g: -sum(sk), n: sk.length, sl: sk.filter(x => x.sl).length, w: sk.filter(x => x.pnl > 0).length }; };
const h = Math.floor(L.length / 2), tr = L.slice(0, h), te = L.slice(h);
const R = names.map(f => bestRule(tr, f, x => x.pnl)).filter(Boolean).map(b => ({ ...b, test: skipGain(te, b), other: skipGain(O, b) })).sort((a, b) => b.g - a.g);
console.log(`Train = first ${tr.length} live trades (to ${new Date(tr.at(-1).t).toISOString().slice(0, 10)}), test = last ${te.length}. Gain = $ saved by skipping.`);
console.log('measure'.padEnd(20), 'rule'.padEnd(18), 'train', '   test (skips: stops/wins)', '  other trades');
for (const b of R) console.log(b.f.padEnd(20), ('skip if ' + b.dir + ' ' + (+b.th.toPrecision(3))).padEnd(18), $(b.g).padStart(5), '  ', $(b.test.g).padStart(5), `(${b.test.n}: ${b.test.sl}/${b.test.w})`.padEnd(13), $(b.other.g).padStart(6));
const held = R.filter(b => b.test.g > 0).length; console.log(`\ntrain pick also saved money on test: ${held} of ${R.length}; top-5 by train on test: ${R.slice(0, 5).map(b => $(b.test.g)).join(' ')}`);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const pl = [];
for (let k = 0; k < 40; k++) { const sh = tr.map(x => x.pnl); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  const m = new Map(tr.map((x, i) => [x, sh[i]])); pl.push(Math.max(...names.map(f => bestRule(tr, f, x => m.get(x))?.g ?? 0))); }
pl.sort((a, b) => a - b); console.log(`placebo best train gain: median ${$(pl[20])}, 90th pct ${$(pl[36])}  vs real best ${$(R[0].g)}`);
const rk = a => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
  for (let j = 0; j < o.length;) { let e = j; while (e + 1 < o.length && o[e + 1][0] === o[j][0]) e++; for (let q = j; q <= e; q++) r[o[q][1]] = (j + e) / 2; j = e + 1; } return r; };
const sp = (set, f) => { const s = set.filter(x => x.F[f] != null && isFinite(x.F[f])); if (s.length < 30) return null; const a = rk(s.map(x => x.F[f])), b = rk(s.map(x => x.pnl)), n = s.length, ma = a.reduce((t, x) => t + x, 0) / n, mb = b.reduce((t, x) => t + x, 0) / n;
  let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? nu / Math.sqrt(da * db) : null; };
console.log('\nrank correlation with P&L (± ~0.15 is noise at this size): train / test / other');
for (const f of names) { const a = sp(tr, f), b = sp(te, f), c = sp(O, f); if (a == null) continue; const same = Math.sign(a) === Math.sign(b) && Math.sign(b) === Math.sign(c) && Math.min(Math.abs(a), Math.abs(b)) >= 0.1;
  console.log(f.padEnd(20), a.toFixed(2).padStart(6), b.toFixed(2).padStart(6), c.toFixed(2).padStart(6), same ? '  ← same direction everywhere' : ''); }

// triggers: after ENTER wait up to W min for the 1% book to turn sell-heavy (imb1 < X), short at that minute's close; else skip / short at end
function sim(hl, off, E) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E;
  const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const up = (hl[3 * i] / E - 1) * 100, dn = (1 - hl[3 * i + 1] / E) * 100; last = hl[3 * i + 2];
    if (-up <= stop) { p += rem * stop; rem = 0; break; }
    while (hit < 4 && dn >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; }
    if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * (1 - last / E) * 100;
  return { pnl: p / 100 * POS - POS * 0.001, sl: hit === 0 && p < 0 && rem === 0 }; }
console.log('\nwait for a sell-heavy 1% book after ENTER (live-rule trades with book data):');
const mid = L[h].t;
for (const X of [0, -0.2, -0.4]) for (const W of [15, 30]) for (const anyway of [false, true]) { let s = 0, n = 0, s1 = 0;
  for (const x of L) { const hl = paths[x.key], sigT = +x.key.match(/(\d{13})$/)[1], S = B[x.key]; let e = null;
    for (const y of S) { if (y[0] < x.t) continue; if (y[0] > x.t + W * M) break; const v = lr(bid(y, 1), ask(y, 1)); if (v != null && v < X) { e = y[0]; break; } }
    if (e == null && anyway) e = x.t + W * M; if (e == null) continue;
    const off = Math.ceil((e - sigT) / M); if (hl.length / 3 < off + 60) continue; const r = sim(hl, off, hl[3 * (off - 1) + 2]); s += r.pnl; n++; if (x.t < mid) s1 += r.pnl; }
  console.log(`  imb1 < ${X}, ${W} min, ${anyway ? 'else short at end' : 'else skip'}`.padEnd(44), n, 'tr', $(s), '| halves', $(s1), $(s - s1)); }
console.log(`  live (same trades)`.padEnd(44), L.length, 'tr', $(sum(L)), '| halves', $(sum(tr)), $(sum(te)));
