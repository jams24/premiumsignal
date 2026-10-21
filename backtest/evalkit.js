// Shared research kit: trade simulation, entry-candle features, and the strict train/test/placebo check.
const M = 60000, Hr = 3600000, D = 24 * Hr, POS = 150;
const pass = s => (s.oi ?? 0) <= 30 && (s.age ?? -1) >= 15 && s.c >= 1;
const firstPass = (all, from = 0) => { for (let i = from; i < all.length; i++) { if (all[i].k === 'missed') return -1; if (pass(all[i])) return i; } return -1; };

// short plan: stop 8%, TP 6/12/20/30 closing .25/.5/.5/all, stop → entry at TP1, 48h, fees in. long = mirror.
function sim(hl, off, E, dir = 'short') { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E;
  const n = Math.min(hl.length / 3, off + 2880), S = dir === 'short';
  for (let i = off; i < n; i++) { const fav = S ? (1 - hl[3 * i + 1] / E) * 100 : (hl[3 * i] / E - 1) * 100, adv = S ? (hl[3 * i] / E - 1) * 100 : (1 - hl[3 * i + 1] / E) * 100; last = hl[3 * i + 2];
    if (-adv <= stop) { p += rem * stop; rem = 0; break; }
    while (hit < 4 && fav >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; }
    if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * (S ? (1 - last / E) : (last / E - 1)) * 100;
  return { pnl: p / 100 * POS - POS * 0.001, sl: hit === 0 && p < 0 && rem === 0, tp1: hit >= 1 }; }

const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const chg = (k, j, n) => j - n >= 0 ? (k[j][4] / k[j - n][4] - 1) * 100 : null;
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; for (let i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; };
const rsi = (c, p = 14) => { if (c.length <= p + 1) return null; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= p; l /= p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
// k rows [t,o,h,l,c,qv,tbq] → n-bar candles (complete only)
const agg = (k, n, ms) => { const out = []; for (const c of k) { const b = Math.floor(c[0] / (n * ms)) * n * ms; const o = out.at(-1);
  if (!o || o[0] !== b) out.push([b, c[1], c[2], c[3], c[4], c[5], c[6], 1]); else { o[2] = Math.max(o[2], c[2]); o[3] = Math.min(o[3], c[3]); o[4] = c[4]; o[5] += c[5]; o[6] += c[6]; o[7]++; } }
  return out.filter(c => c[7] === n); };

function candleFeats(F, pre, k, taker = true) {
  if (k.length < 30) return; const L = k.at(-1), P = k.at(-2), c = k.map(x => x[4]), rg = L[2] - L[3] || 1e-12, n = k.length;
  F[pre + 'red'] = L[4] < L[1] ? 1 : 0; F[pre + 'body%'] = (L[4] / L[1] - 1) * 100;
  F[pre + 'upWick'] = (L[2] - Math.max(L[1], L[4])) / rg; F[pre + 'loWick'] = (Math.min(L[1], L[4]) - L[3]) / rg; F[pre + 'closePos'] = (L[4] - L[3]) / rg;
  for (const b of [1, 3, 6, 12]) F[pre + 'ret' + b] = (L[4] / k[n - 1 - b][4] - 1) * 100;
  F[pre + 'reds6'] = k.slice(-6).filter(x => x[4] < x[1]).length;
  let lh = 0; for (let i = n - 5; i < n; i++) if (k[i][2] < k[i - 1][2]) lh++; F[pre + 'lowerHighs5'] = lh;
  F[pre + 'brkPrevLow'] = L[4] < P[3] ? 1 : 0; F[pre + 'brk3Low'] = L[4] < Math.min(...k.slice(-4, -1).map(x => x[3])) ? 1 : 0;
  const e9 = ema(c, 9), e20 = ema(c, 20), e50 = ema(c, Math.min(50, n));
  F[pre + 'distE9'] = (L[4] / e9 - 1) * 100; F[pre + 'distE20'] = (L[4] / e20 - 1) * 100; F[pre + 'distE50'] = (L[4] / e50 - 1) * 100;
  F[pre + 'rsi'] = rsi(c.slice(-100)); const r3 = rsi(c.slice(-103, -3)); F[pre + 'rsiChg3'] = F[pre + 'rsi'] != null && r3 != null ? F[pre + 'rsi'] - r3 : null;
  const v24 = k.slice(-25, -1).reduce((a, x) => a + x[5], 0) / 24; F[pre + 'volLast/avg'] = v24 ? L[5] / v24 : null;
  if (taker) { for (const b of [1, 3, 6]) { const s = k.slice(-b); const q = s.reduce((a, x) => a + x[5], 0); F[pre + 'takerBuy' + b] = q ? s.reduce((a, x) => a + x[6], 0) / q : null; } }
  let tr = 0; for (let i = n - 14; i < n; i++) tr += Math.max(k[i][2], k[i - 1][4]) - Math.min(k[i][3], k[i - 1][4]); const atr = tr / 14; F[pre + 'atr%'] = atr / L[4] * 100;
  F[pre + 'dropFromHi/ATR'] = (Math.max(...k.slice(-24).map(x => x[2])) - L[4]) / atr;
  const s = k.slice(-24), pv = s.reduce((a, x) => a + x[5], 0), vw = pv ? s.reduce((a, x) => a + x[5] * (x[2] + x[3] + x[4]) / 3, 0) / pv : null; F[pre + 'distVwap'] = vw ? (L[4] / vw - 1) * 100 : null;
}

// ---- strict check ----
const $ = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const sumP = (a, k = 'pnl') => a.reduce((s, x) => s + x[k], 0);
// mode 'skip': best rule removes 5–50% of trades with the most negative P&L. mode 'take': best rule selects 10–50% with the most positive P&L.
function bestRule(set, f, pnlOf, mode) { const v = set.map(x => x.F[f]).filter(x => x != null && isFinite(x)).sort((a, b) => a - b); if (v.length < set.length * 0.6) return null;
  let best = null; const qs = [...new Set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(q => v[Math.floor(q * (v.length - 1))]))];
  const [lo, hi] = mode === 'skip' ? [0.05, 0.5] : [0.1, 0.5];
  for (const th of qs) for (const dir of ['>', '<']) { const sel = set.filter(x => x.F[f] != null && isFinite(x.F[f]) && (dir === '>' ? x.F[f] > th : x.F[f] < th)); if (sel.length < set.length * lo || sel.length > set.length * hi) continue;
    const g = (mode === 'skip' ? -1 : 1) * sel.reduce((a, x) => a + pnlOf(x), 0); if (!best || g > best.g) best = { f, th, dir, g, n: sel.length }; } return best; }
const applyRule = (set, b, mode, k = 'pnl') => { const sel = set.filter(x => x.F[b.f] != null && isFinite(x.F[b.f]) && (b.dir === '>' ? x.F[b.f] > b.th : x.F[b.f] < b.th));
  return { g: (mode === 'skip' ? -1 : 1) * sumP(sel, k), n: sel.length, sl: sel.filter(x => x.sl).length, w: sel.filter(x => x[k] > 0).length }; };
const rk = a => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
  for (let j = 0; j < o.length;) { let e = j; while (e + 1 < o.length && o[e + 1][0] === o[j][0]) e++; for (let q = j; q <= e; q++) r[o[q][1]] = (j + e) / 2; j = e + 1; } return r; };
const spear = (set, f, k = 'pnl') => { const s = set.filter(x => x.F[f] != null && isFinite(x.F[f])); if (s.length < 25) return null; const a = rk(s.map(x => x.F[f])), b = rk(s.map(x => x[k])), n = s.length;
  const ma = a.reduce((t, x) => t + x, 0) / n, mb = b.reduce((t, x) => t + x, 0) / n; let nu = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? nu / Math.sqrt(da * db) : null; };

function strict(set, names, { mode = 'skip', other = null, label = '', top = 15, placebo = 40, k = 'pnl' } = {}) {
  set = [...set].sort((a, b) => a.t - b.t); const h = Math.floor(set.length / 2), tr = set.slice(0, h), te = set.slice(h);
  const R = names.map(f => bestRule(tr, f, x => x[k], mode)).filter(Boolean).map(b => ({ ...b, test: applyRule(te, b, mode, k), oth: other ? applyRule(other, b, mode, k) : null, ca: spear(tr, b.f, k), cb: spear(te, b.f, k), co: other ? spear(other, b.f, k) : null })).sort((a, b) => b.g - a.g);
  console.log(`\n=== ${label} | ${mode === 'skip' ? 'skip rules' : 'take rules'} | ${set.length} trades (${$(sumP(set, k))}), train ${tr.length} to ${new Date(tr.at(-1).t).toISOString().slice(0, 10)} (${$(sumP(tr, k))}), test ${te.length} (${$(sumP(te, k))})${other ? `, other ${other.length}` : ''}`);
  console.log('measure'.padEnd(26), 'rule'.padEnd(18), 'train'.padStart(6), 'test'.padStart(7), '(n stops/wins)'.padEnd(16), other ? 'other'.padStart(7) : '', ' corr tr/te' + (other ? '/oth' : ''));
  for (const b of R.slice(0, top)) console.log(b.f.padEnd(26), ((mode === 'skip' ? 'skip ' : 'take ') + b.dir + ' ' + (+b.th.toPrecision(3))).padEnd(18), $(b.g).padStart(6), $(b.test.g).padStart(7), `(${b.test.n} ${b.test.sl}/${b.test.w})`.padEnd(16), other ? $(b.oth.g).padStart(7) : '',
    ' ' + [b.ca, b.cb, b.co].filter(x => x != null).map(x => x.toFixed(2)).join('/'));
  const held = R.filter(b => b.test.g > 0).length;
  let pl = []; if (placebo) { let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let q = 0; q < placebo; q++) { const sh = tr.map(x => x[k]); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
      const m = new Map(tr.map((x, i) => [x, sh[i]])); pl.push(Math.max(0, ...names.map(f => bestRule(tr, f, x => m.get(x), mode)?.g ?? 0))); } pl.sort((a, b) => a - b); }
  console.log(`held on test: ${held}/${R.length} · top-5 on test ${R.slice(0, 5).map(b => $(b.test.g)).join(' ')}` + (placebo ? ` · placebo best train median ${$(pl[Math.floor(pl.length / 2)])} p90 ${$(pl[Math.floor(pl.length * 0.9)])} vs real best ${$(R[0]?.g ?? 0)}` : ''));
  const cons = R.filter(b => b.ca != null && b.cb != null && Math.sign(b.ca) === Math.sign(b.cb) && Math.min(Math.abs(b.ca), Math.abs(b.cb)) >= 0.12 && (b.co == null || Math.sign(b.co) === Math.sign(b.cb)));
  if (cons.length) console.log('same-direction link in both halves' + (other ? ' and other trades' : '') + ' (|corr| ≥ 0.12): ' + cons.map(b => `${b.f} ${b.ca.toFixed(2)}/${b.cb.toFixed(2)}${b.co != null ? '/' + b.co.toFixed(2) : ''}`).join(', '));
  else console.log('no measure linked to P&L in the same direction in both halves (|corr| ≥ 0.12)');
  return R; }

module.exports = { M, Hr, D, POS, pass, firstPass, sim, idx, chg, ema, rsi, agg, candleFeats, strict, bestRule, applyRule, spear, $, sumP };
