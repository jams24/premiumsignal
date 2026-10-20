// More confirmation before the short? Every variant on the same signals the live short takes
// (spot market, share ≤ 13% at entry, BTC 7d ≥ -2%), $150, stop 8%, TP 6/12/20/30 (.25/.5/.5/all), stop→entry at TP1, 48h, fees in.
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
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
const b7 = t => { const k = H1.BTCUSDT, j = idx(k, t); return (k[j][4] / k[j - 168][4] - 1) * 100; };

// Each variant returns { at (ms), price } or null from (row, steps, path)
const firstPass = (all, from = 0) => { for (let i = from; i < all.length; i++) { if (all[i].k === 'missed') return -1; if (pass(all[i])) return i; } return -1; };
const at = (r, hl, t) => { const o = Math.round((t - r.t) / M); return o * 3 + 2 < hl.length ? { off: o, price: hl[o * 3 + 2 - 3] ?? hl[2] } : null; };
const V = {};
V['A. old: first pass, even at the signal'] = (r) => { const i = firstPass(r.all); return i < 0 ? null : { s: r.all[i] }; };
V['B. LIVE NOW: signal-time pass re-checked next step'] = (r) => { let i = firstPass(r.all); if (i === 0) i = firstPass(r.all, 1); return i < 0 ? null : { s: r.all[i] }; };
for (const k of [2, 3, 4]) V[`C. rules pass ${k} checks in a row (${(k - 1) * 5} min)`] = (r) => { let run = 0; for (let i = 0; i < r.all.length; i++) { const s = r.all[i]; if (s.k === 'missed') return null; run = pass(s) ? run + 1 : 0; if (run >= k && !(k === 1 && i === 0)) return { s }; } return null; };
for (const a of [30, 45, 60]) V[`D. top must be ${a}+ min old (not 15)`] = (r) => { let i = -1; for (let j = 0; j < r.all.length; j++) { const s = r.all[j]; if (s.k === 'missed') break; if ((s.oi ?? 0) <= 30 && (s.age ?? -1) >= a && s.c >= 1 && j > 0) { i = j; break; } } return i < 0 ? null : { s: r.all[i] }; };
V['E. reversal score ≥ 2 (not 1)'] = (r) => { for (let j = 1; j < r.all.length; j++) { const s = r.all[j]; if (s.k === 'missed') return null; if ((s.oi ?? 0) <= 30 && (s.age ?? -1) >= 15 && s.c >= 2) return { s }; } return null; };
// After the live ENTER: wait N min; skip if a new high printed meanwhile, else short at that minute's close
for (const w of [10, 15, 30, 60]) V[`F. wait ${w} min after ENTER, skip if new high`] = (r, hl) => { const b = V['B. LIVE NOW: signal-time pass re-checked next step'](r); if (!b) return null;
  const top = b.s.p / (1 - (b.s.below ?? 0) / 100), o0 = Math.round((b.s.now - r.t) / M), o1 = o0 + w; if (o1 * 3 + 2 >= hl.length) return null;
  for (let i = o0; i < o1; i++) if (hl[3 * i] > top * 1.001) return null; return { off: o1, price: hl[3 * (o1 - 1) + 2], sp: b.s.sp, t: r.t + o1 * M }; };
for (const w of [15, 30]) V[`G. wait ${w} min after ENTER, short anyway`] = (r, hl) => { const b = V['B. LIVE NOW: signal-time pass re-checked next step'](r); if (!b) return null;
  const o1 = Math.round((b.s.now - r.t) / M) + w; if (o1 * 3 + 2 >= hl.length) return null; return { off: o1, price: hl[3 * (o1 - 1) + 2], sp: b.s.sp, t: r.t + o1 * M }; };
// Drop confirmation: after ENTER, short only once price falls X% below the ENTER price (within 2h); skip if it hits a new high first
for (const x of [1, 2, 3]) V[`H. short only after a ${x}% drop from ENTER (2h max)`] = (r, hl) => { const b = V['B. LIVE NOW: signal-time pass re-checked next step'](r); if (!b) return null;
  const top = b.s.p / (1 - (b.s.below ?? 0) / 100), o0 = Math.round((b.s.now - r.t) / M), trg = b.s.p * (1 - x / 100);
  for (let i = o0; i < Math.min(hl.length / 3, o0 + 120); i++) { if (hl[3 * i] > top * 1.001) return null; if (hl[3 * i + 1] <= trg) return { off: i + 1, price: trg, sp: b.s.sp, t: r.t + (i + 1) * M }; } return null; };

const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const res = {};
for (const [name, fn] of Object.entries(V)) {
  const T = [];
  for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || !r.hasSpot) continue; const e = fn(r, hl); if (!e) continue;
    const sp = e.s ? e.s.sp : e.sp, t = e.s ? e.s.now : e.t; if (sp == null || sp > 13) continue; if (b7(t) < -2) continue;
    const off = e.s ? Math.round((e.s.now - r.t) / M) : e.off, price = e.s ? e.s.p : e.price; if (hl.length / 3 < off + 60) continue;
    T.push({ key: r.s + r.t, t, ...sim(hl, off, price) }); }
  T.sort((a, b) => a.t - b.t); res[name] = T;
}
const base = new Map(res['B. LIVE NOW: signal-time pass re-checked next step'].map(x => [x.key, x]));
console.log('Short set: spot share ≤13% at entry, BTC 7d ≥ -2%, $150, fees in. 1 Jun – 18 Oct backfill\n');
for (const [name, T] of Object.entries(res)) {
  const s = T.reduce((a, x) => a + x.pnl, 0); let eq = 0, pk = 0, dd = 0; for (const x of T) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const h = Math.floor(T.length / 2), h1 = T.slice(0, h).reduce((a, x) => a + x.pnl, 0), h2 = T.slice(h).reduce((a, x) => a + x.pnl, 0);
  const mo = ['06', '07', '08', '09', '10'].map(m => $(T.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((a, x) => a + x.pnl, 0))).join(' ');
  const keys = new Set(T.map(x => x.key)), dropped = [...base.values()].filter(x => !keys.has(x.key));
  console.log(name.padEnd(52), String(T.length).padStart(4), 'tr', (T.filter(x => x.pnl > 0).length / T.length * 100).toFixed(0).padStart(3) + '% win',
    (T.filter(x => x.sl).length / T.length * 100).toFixed(0).padStart(3) + '% full stop', $(s).padStart(6), ('$' + (s / T.length).toFixed(2)).padStart(6) + '/tr', 'DD $' + dd.toFixed(0),
    '| halves', $(h1), $(h2), '| Jun-Oct', mo,
    name.startsWith('B.') ? '' : `| vs live: skips ${dropped.length} (${dropped.filter(x => x.sl).length} stop-outs, ${dropped.filter(x => x.pnl > 0).length} winners, ${$(dropped.reduce((a, x) => a + x.pnl, 0))})`);
}
