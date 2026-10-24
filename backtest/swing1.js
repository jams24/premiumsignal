// Swing replay, step 1: signals. Runs the live swing scanner (swingScanner.analyzeSwingCandidate + buildSwingSetup) every 2h
// on daily candles built from stored 1h candles (the current UTC day is the forming candle, as ccxt returns it).
// Universe: Binance USDT perps with 24h quote volume > $2M, top 75 by volume (live also scans Bybit).
// Only the chart part of the score can be replayed (axes 1, 2 and 4 without OI). Funding, long/short, taker and flow points
// come from APIs with no history; on the 561 real paper trades they added a median 15 points, so a replayed chart score
// of 20+ stands for the live 35+ candidate cut and 30+ for the live 45+ auto-entry cut.
// usage: NODE_PATH=node_modules node --max-old-space-size=8000 backtest/swing1.js → backtest/data_swing/signals.json
const fs = require('fs'), path = require('path');
const { RSI, EMA, ATR } = require('technicalindicators');
const H = 3600000, D = 24 * H;
const OUT = path.join(__dirname, 'data_swing'); fs.mkdirSync(OUT, { recursive: true });
const OC_POINTS = 15, CAND_MIN = 35 - OC_POINTS, ENTRY_MIN = 45 - OC_POINTS;

// merge the two 1h stores (data_early: Oct 2025 →, data: Apr 2026 →)
const H1 = {};
for (const d of ['data_early', 'data']) {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, d, 'h1L.json')));
  for (const [s, rows] of Object.entries(j)) { const m = H1[s] || (H1[s] = new Map()); for (const r of rows) m.set(r[0], r); }
}
const STOCKISH = /^(1000)?[A-Z]{1,6}(LONG|SHORT|BULL|BEAR|UP|DOWN|3L|3S|2L|2S|5L|5S)$/;
const K = {};
for (const [s, m] of Object.entries(H1)) { if (s.endsWith('STOCK') || STOCKISH.test(s.replace(/USDT$/, ''))) continue; K[s] = [...m.values()].sort((a, b) => a[0] - b[0]); }
const syms = Object.keys(K);
console.log('symbols', syms.length);

const lastClosed = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + H <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const vol24 = (k, j) => { let v = 0; for (let i = Math.max(0, j - 23); i <= j; i++) v += k[i][5]; return v; };

// daily candles (max 180) as ccxt returns them at time T: complete UTC days + the forming day
const dayCache = new Map();
function daily(s, k, j, T) {
  const day = Math.floor(T / D) * D;
  let full = dayCache.get(s + day);
  if (!full) {
    full = []; let i = j; while (i >= 0 && k[i][0] >= day) i--;
    let b = day - D;
    while (full.length < 179 && i >= 0) { const g = []; while (i >= 0 && k[i][0] >= b) { g.unshift(k[i]); i--; } if (!g.length) break;
      full.unshift([b, g[0][1], Math.max(...g.map(x => x[2])), Math.min(...g.map(x => x[3])), g.at(-1)[4], g.reduce((a, x) => a + x[5], 0)]); b -= D; }
    dayCache.set(s + day, full);
  }
  const blk = []; for (let i = j; i >= 0 && k[i][0] >= day; i--) blk.unshift(k[i]);
  const price = k[j][4];
  const form = blk.length ? [day, blk[0][1], Math.max(...blk.map(x => x[2])), Math.min(...blk.map(x => x[3])), price, blk.reduce((a, x) => a + x[5], 0)] : [day, price, price, price, price, 0];
  return [...full, form];
}

// == swingScanner.analyzeSwingCandidate, chart parts only ==
function analyze(o) {
  if (o.length < 60) return null;
  const closes = o.map(c => c[4]), highs = o.map(c => c[2]), lows = o.map(c => c[3]), volumes = o.map(c => c[5]);
  const currentPrice = closes.at(-1);
  const rsi14 = RSI.calculate({ values: closes, period: 14 }), ema20 = EMA.calculate({ values: closes, period: 20 });
  const atr14 = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  if (!rsi14.length || !ema20.length || !atr14.length) return null;
  const currentRSI = rsi14.at(-1), currentEma20 = ema20.at(-1), currentATR = atr14.at(-1);
  const ninetyDayHigh = Math.max(...highs.slice(-90)), ninetyDayLow = Math.min(...lows.slice(-90));
  let score = 0; const signals = [];
  const distFromLow = (currentPrice - ninetyDayLow) / ninetyDayLow * 100, totalDecline = (ninetyDayHigh - ninetyDayLow) / ninetyDayHigh * 100;
  if (totalDecline < 15 || distFromLow > 200) return null;
  let setupType = 'accumulation';
  if (distFromLow <= 15) { score += 10; signals.push('near90dLow'); } else if (distFromLow <= 30) score += 5; else if (distFromLow <= 60) score += 3; else setupType = 'continuation';
  if (totalDecline >= 70) score += 8; else if (totalDecline >= 50) score += 5; else if (totalDecline >= 30) score += 3;
  if (setupType === 'continuation') {
    const recentHigh = Math.max(...highs.slice(-14)), pb = (recentHigh - currentPrice) / recentHigh * 100;
    score += pb >= 25 ? 8 : pb >= 15 ? 6 : pb >= 5 ? 4 : 2;
    const mx = Math.max(...o.slice(-14).map(c => Math.abs((c[4] - c[1]) / c[1]) * 100));
    if (mx > 30) score += 5; else if (mx > 15) score += 3;
  } else {
    const r = atr14.slice(-14), a = atr14.slice(-Math.min(90, atr14.length));
    const ra = r.reduce((x, y) => x + y, 0) / r.length, fa = a.reduce((x, y) => x + y, 0) / a.length;
    if (ra < fa * 0.5) score += 7; else if (ra < fa * 0.7) score += 3;
  }
  const wasOversold = rsi14.slice(-14).some(v => v < 30);
  if (wasOversold && currentRSI > 35 && currentRSI < 55) score += 7; else if (setupType === 'continuation' && currentRSI > 50 && currentRSI < 70) score += 3;
  const prevClose = closes.at(-2), prevEma20 = ema20.at(-2);
  if (prevEma20 && currentPrice > currentEma20 && prevClose <= prevEma20) score += 8; else if (currentPrice > currentEma20) score += 3;
  const l30 = o.slice(-30), rl = [];
  for (let i = 2; i < l30.length - 2; i++) if (l30[i][3] < l30[i - 1][3] && l30[i][3] < l30[i - 2][3] && l30[i][3] < l30[i + 1][3] && l30[i][3] < l30[i + 2][3]) rl.push(l30[i][3]);
  if (rl.length >= 2 && rl.at(-1) > rl.at(-2)) score += 7;
  let up = 0, dn = 0; for (const c of o.slice(-14)) { if (c[4] >= c[1]) up += c[5]; else dn += c[5]; }
  if (dn > 0 && up > dn * 1.5) score += 3;
  const l21 = o.slice(-21);
  for (let i = Math.max(2, l21.length - 10); i < l21.length - 1; i++) {
    const c = l21[i], body = Math.abs(c[4] - c[1]), lw = Math.min(c[1], c[4]) - c[3], tr = c[2] - c[3];
    if (tr <= 0 || body <= 0 || lw / tr < 0.6) continue;
    const priorLow = Math.min(...l21.slice(Math.max(0, i - 5), i).map(x => x[3]));
    if (c[3] >= priorLow || c[4] <= priorLow) continue;
    const post = l21.slice(i + 1);
    if (post.length && Math.min(...post.map(x => x[3])) > c[3]) { score += 7; break; }
  }
  const cv = volumes.at(-1), av20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  if (av20 > 0 && cv > av20 * 3) score += 7; else if (av20 > 0 && cv > av20 * 2) score += 5; else if (av20 > 0 && cv > av20 * 1.5) score += 3;
  if (volumes.length >= 30) { const a7 = volumes.slice(-7).reduce((a, b) => a + b, 0) / 7, a30 = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
    if (a30 > 0 && a7 > a30 * 3) score += 5; else if (a30 > 0 && a7 > a30 * 2) score += 3; }
  if (volumes.length >= 21) { const pk = Math.max(...volumes.slice(-3)), ap = volumes.slice(-21, -3).reduce((a, b) => a + b, 0) / 18; if (ap > 0 && pk > ap * 5) score += 5; }
  if (o.length >= 35) {
    const w = []; for (let i = o.length - 35; i < o.length; i += 7) { const wk = o.slice(i, i + 7); if (wk.length < 5) continue; w.push(wk.at(-1)[4] >= wk[0][1]); }
    if (w.length >= 4 && w.at(-1) && w.slice(-4, -1).every(g => !g)) score += 5;
  }
  if (score < CAND_MIN) return null;
  return { setupType, score, currentPrice, atr: currentATR, ninetyDayHigh, ninetyDayLow, distFromLow, totalDecline, rsi: currentRSI };
}

// == swingScanner.buildSwingSetup ==
function setup(c, o) {
  const p = c.currentPrice; let sl;
  if (c.setupType === 'continuation') { sl = Math.min(...o.slice(-14).map(x => x[3])) * 0.97; if (sl < p * 0.85) sl = p * 0.85; }
  else { sl = c.ninetyDayLow * 0.97; if (sl < p * 0.75) sl = p * 0.75; }
  const sh = []; for (let i = 5; i < o.length - 5; i++) { const h = o[i][2]; if (o.slice(i - 5, i).every(x => x[2] <= h) && o.slice(i + 1, i + 6).every(x => x[2] <= h) && h > p * 1.1) sh.push(h); }
  sh.sort((a, b) => a - b);
  let tp1, tp2, tp3;
  if (c.setupType === 'continuation') { const r = p - sl; tp1 = p + r * 1.618; tp2 = p + r * 2.618; tp3 = p + r * 4.236; if (sh.length) tp1 = Math.max(tp1, sh[0]); }
  else { tp1 = sh[0] || p + (p - c.ninetyDayLow) * 1.5; const m = tp1 - p; tp2 = sh[1] || p + m * 2; tp3 = Math.max(c.ninetyDayHigh, p + m * 3); }
  const rr = ((tp1 - p) / p) / ((p - sl) / p);
  if (rr < (c.setupType === 'continuation' ? 1.5 : 2.0)) return null;
  return { sl, tp1, tp2, tp3, rr };
}

let t0 = Infinity, t1 = 0; for (const s of syms) { t0 = Math.min(t0, K[s][0][0]); t1 = Math.max(t1, K[s].at(-1)[0] + H); }
const start = Math.ceil((t0 + 100 * D) / (2 * H)) * 2 * H;
const out = []; let scans = 0;
for (let T = start; T <= t1; T += 2 * H) {
  const uni = [];
  for (const s of syms) { if (['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(s)) { /* live scans them too; executor excludes them */ }
    const k = K[s], j = lastClosed(k, T); if (j < 0 || k[j][0] + H !== T) continue; const v = vol24(k, j); if (v > 2e6) uni.push([s, j, v]); }
  uni.sort((a, b) => b[2] - a[2]);
  const cands = [];
  for (const [s, j, v] of uni.slice(0, 75)) { const o = daily(s, K[s], j, T); const c = analyze(o); if (c) cands.push({ s, o, c, v }); }
  cands.sort((a, b) => b.c.score - a.c.score);
  for (const { s, o, c, v } of cands.slice(0, 5)) {
    const st = setup(c, o); if (!st) continue;
    out.push({ T, sym: s, price: c.currentPrice, score: c.score, entry: c.score >= ENTRY_MIN, setupType: c.setupType, atr: c.atr, rsi: +c.rsi.toFixed(1), distFromLow: +c.distFromLow.toFixed(1), totalDecline: +c.totalDecline.toFixed(1), vol24: Math.round(v), ...st });
  }
  if (++scans % 300 === 0) { console.log(new Date(T).toISOString().slice(0, 10), 'signals', out.length); dayCache.clear(); }
}
fs.writeFileSync(path.join(OUT, 'signals.json'), JSON.stringify(out));
console.log('scans', scans, 'signals', out.length, 'auto-entry', out.filter(x => x.entry).length, 'from', new Date(start).toISOString(), 'to', new Date(t1).toISOString());
