// Measures from the outside data (ext_spot.json, ext_metrics.json) at each entry → data/ext_feats.json { key: F }
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'); const M = 60000, H = 60 * M;
const B = JSON.parse(fs.readFileSync('base_trades.json')), X = JSON.parse(fs.readFileSync('ext_spot.json')), MT = fs.existsSync('ext_metrics.json') ? JSON.parse(fs.readFileSync('ext_metrics.json')) : {}, K5 = JSON.parse(fs.readFileSync('k5_entry.json'));
const allRates = Object.values(X).flatMap(v => (v.krwusdt || []).map(c => c[1])).sort((a, b) => a - b); const RATE0 = allRates[allRates.length >> 1] || 1380;
const mult = s => { const m = s.match(/^(1000000|10000|1000|1M)(?=[A-Z])/); return m ? (m[1] === '1M' ? 1e6 : +m[1]) : 1; };
const out = {};
for (const x of B) { const v = X[x.key], k5 = K5[x.key]; if (!v || !k5) continue; const F = {}, t = x.t;
  const rate = (ts) => { const r = (v.krwusdt || []).filter(c => c[0] <= ts).at(-1); return r ? r[1] : RATE0; };
  const usd = (venue, c) => (venue === 'upbit' || venue === 'bithumb') ? c[2] / rate(c[0]) : c[2];
  const vol = (venue, mins) => { if (venue === 'bnPerp') return k5.filter(c => c[0] >= t - mins * M && c[0] + 5 * M <= t).reduce((a, c) => a + c[5], 0);
    return (v[venue] || []).filter(c => c[0] >= t - mins * M).reduce((a, c) => a + usd(venue, c), 0); };
  for (const [w, mins] of [['1h', 60], ['3h', 180], ['6h', 360]]) {
    const V = {}; for (const ven of ['bnPerp', 'byPerp', 'okxSwap', 'bnSpot', 'bySpot', 'okxSpot', 'coinbase', 'upbit', 'bithumb']) V[ven] = vol(ven, mins);
    const perpBB = V.bnPerp + V.byPerp, perpAll = perpBB + V.okxSwap, kr = V.upbit + V.bithumb, spotBB = V.bnSpot + V.bySpot, spotAll = spotBB + V.okxSpot + V.coinbase + kr;
    if (!perpBB) continue;
    F[`spot.shareBB.${w}`] = spotBB / perpBB * 100; F[`spot.shareAll.${w}`] = spotAll / perpAll * 100; F[`spot.korea.${w}`] = kr / perpAll * 100;
    F[`spot.koreaOfSpot.${w}`] = spotAll ? kr / spotAll * 100 : null; F[`spot.okxCb.${w}`] = (V.okxSpot + V.coinbase) / perpAll * 100; F[`perp.okxOfPerp.${w}`] = V.okxSwap / perpAll * 100;
    if (w === '1h') F._v1 = V; if (w === '6h') F._v6 = V; }
  if (F._v1 && F._v6) { const s1 = Object.entries(F._v1).filter(([k]) => !/Perp|Swap/.test(k)).reduce((a, [, y]) => a + y, 0), s6 = Object.entries(F._v6).filter(([k]) => !/Perp|Swap/.test(k)).reduce((a, [, y]) => a + y, 0);
    const p1 = F._v1.bnPerp + F._v1.byPerp + F._v1.okxSwap, p6 = F._v6.bnPerp + F._v6.byPerp + F._v6.okxSwap;
    F['spot.surge1h/6h'] = s6 ? s1 / (s6 / 6) : null; F['perp.surge1h/6h'] = p6 ? p1 / (p6 / 6) : null; F['spot.shareTrend(1h-6h)'] = F['spot.shareAll.1h'] - F['spot.shareAll.6h'];
    const k1 = F._v1.upbit + F._v1.bithumb, k6 = F._v6.upbit + F._v6.bithumb; F['spot.koreaSurge1h/6h'] = k6 ? k1 / (k6 / 6) : null; }
  delete F._v1; delete F._v6;
  F['list.korea'] = (v.upbit?.length || v.bithumb?.length) ? 1 : 0; F['list.coinbase'] = v.coinbase?.length ? 1 : 0; F['list.okxSpot'] = v.okxSpot?.length ? 1 : 0; F['list.bnSpot'] = v.bnSpot?.length ? 1 : 0;
  // Korean premium: Upbit KRW price vs Binance perp price in KRW (via Upbit's own USDT/KRW)
  const bnLast = k5.filter(c => c[0] + 5 * M <= t).at(-1), up = v.upbit?.at(-1);
  if (up && bnLast && t - up[0] <= 15 * M) { F['spot.koreaPremium%'] = (up[1] / rate(up[0]) / (bnLast[4] / mult(x.s)) - 1) * 100;
    const up1 = v.upbit.filter(c => c[0] <= t - H).at(-1), bn1 = k5.filter(c => c[0] <= (up1?.[0] ?? 0)).at(-1); if (up1 && bn1) F['spot.koreaPremChg1h'] = F['spot.koreaPremium%'] - (up1[1] / rate(up1[0]) / (bn1[4] / mult(x.s)) - 1) * 100; }
  // who is buying: Binance spot taker-buy share vs perp taker-buy share (last 1h and last 15m)
  const tb = (rows, mins, qi, bi) => { const s = rows.filter(c => c[0] >= t - mins * M && c[0] + 5 * M <= t); const q = s.reduce((a, c) => a + c[qi], 0); return q ? s.reduce((a, c) => a + c[bi], 0) / q : null; };
  if (v.bnSpot?.length) { F['spot.takerBuy1h'] = tb(v.bnSpot, 60, 2, 3); F['spot.takerBuy15m'] = tb(v.bnSpot, 15, 2, 3);
    const pt = tb(k5, 60, 5, 6); F['spot-perp takerBuy1h'] = F['spot.takerBuy1h'] != null && pt != null ? F['spot.takerBuy1h'] - pt : null; }
  F['perp.takerBuy1h'] = tb(k5, 60, 5, 6);
  // Binance metrics: real OI, top-trader / global long-short, taker ratio; premium index
  const mt = MT[x.key];
  if (mt?.m?.length) { const m = mt.m, L = m.at(-1), at = (mins) => m.filter(r => r[0] <= L[0] - mins * M).at(-1);
    for (const mins of [60, 180, 360]) { const p = at(mins); if (!p) continue; const w = mins / 60 + 'h';
      F[`bn.oiChg${w}%`] = p[1] ? (L[1] / p[1] - 1) * 100 : null; F[`bn.topPosChg${w}`] = L[3] - p[3]; F[`bn.globChg${w}`] = L[4] - p[4]; F[`bn.topAccChg${w}`] = L[2] - p[2]; }
    F['bn.topPos'] = L[3]; F['bn.topAcc'] = L[2]; F['bn.glob'] = L[4]; F['bn.taker5m'] = L[5];
    const l1 = m.filter(r => r[0] > L[0] - H); F['bn.taker1h'] = l1.reduce((a, r) => a + r[5], 0) / l1.length;
    F['bn.topPos/glob'] = L[4] ? L[3] / L[4] : null; F['bn.oi$/vol24'] = x.F['sig.vol24M'] ? L[1] / (x.F['sig.vol24M'] * 1e6) : null; F['bn.oi$M'] = L[1] / 1e6; }
  if (mt?.prem?.length) { const p = mt.prem, L = p.at(-1); F['prem.last%'] = L[1] * 100; const l1 = p.filter(c => c[0] > L[0] - H); F['prem.avg1h%'] = l1.reduce((a, c) => a + c[1], 0) / l1.length * 100;
    F['prem.max6h%'] = Math.max(...p.map(c => c[2])) * 100; F['prem.min6h%'] = Math.min(...p.map(c => c[3])) * 100; const p1 = p.filter(c => c[0] <= L[0] - H).at(-1); if (p1) F['prem.chg1h'] = (L[1] - p1[1]) * 100; }
  out[x.key] = F; }
fs.writeFileSync('ext_feats.json', JSON.stringify(out));
// sanity: recomputed Binance+Bybit share vs the replay's share
const pairs = B.filter(x => out[x.key]?.['spot.shareBB.1h'] != null && x.sp != null).map(x => [x.sp, out[x.key]['spot.shareBB.1h']]);
const close = pairs.filter(([a, b]) => Math.abs(a - b) <= Math.max(1, a * 0.15)).length;
console.log('feats for', Object.keys(out).length, 'trades | share check: recomputed within 15% of replay share for', close, 'of', pairs.length);
const cov = {}; for (const F of Object.values(out)) for (const [k, val] of Object.entries(F)) if (val != null && isFinite(val)) cov[k] = (cov[k] || 0) + 1; console.log(JSON.stringify(cov));
