// Demand-zone replay: the live scanner's exact zone logic (onchainScanner.analyzeDemandZone + buildDemandZoneSetup) run every hour
// on 4h candles built from stored 1h candles, top 50 Binance perps by 24h volume (no BTC/ETH/SOL), trading hours 08–14 & 20–23 UTC,
// one trade per coin per UTC day. Exits simulated on 1h candles (stop checked first when a candle hits both = pessimistic).
// usage: BT_DATA=data|data_early node dzreplay.js  → <data>/dz_replay.json
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'); const { ATR, EMA } = require('technicalindicators');
const H = 3600000, D = 24 * H, H4 = 4 * H;
const H1 = JSON.parse(fs.readFileSync('h1L.json'));
const syms = Object.keys(H1).filter(s => !['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(s) && H1[s].length > 600);
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + H <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }; // last 1h candle closed by t
const pre = {}; for (const s of syms) { const k = H1[s], c = new Float64Array(k.length + 1); for (let i = 0; i < k.length; i++) c[i + 1] = c[i] + k[i][5]; pre[s] = c; }

function analyze(k, j, T) { // k: 1h rows, j: last closed 1h index at T. Mirrors analyzeDemandZone (ccxt 4h incl. the forming candle).
  const price = k[j][4]; if (j < 24) return null; const priceChange = (price / k[j - 24][4] - 1) * 100; if (Math.abs(priceChange) > 15) return null;
  const cur = Math.floor(T / H4) * H4; const c4 = []; let i = j;
  // forming candle from 1h candles inside the current 4h block (may be empty right at the boundary → flat candle at price)
  const blk = []; while (i >= 0 && k[i][0] >= cur) { blk.unshift(k[i]); i--; }
  const form = blk.length ? [cur, blk[0][1], Math.max(...blk.map(x => x[2])), Math.min(...blk.map(x => x[3])), price] : [cur, price, price, price, price];
  // complete 4h candles before it
  let b = cur - H4; while (c4.length < 99 && i >= 3) { const g = []; while (i >= 0 && k[i][0] >= b) { g.unshift(k[i]); i--; } if (g.length !== 4) break; c4.unshift([b, g[0][1], Math.max(...g.map(x => x[2])), Math.min(...g.map(x => x[3])), g[3][4]]); b -= H4; }
  const o = [...c4, form]; if (o.length < 30) return null;
  const closes = o.map(c => c[4]), highs = o.map(c => c[2]), lows = o.map(c => c[3]);
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }); if (!atrValues.length) return null; const currentATR = atrValues.at(-1);
  const zones = [];
  for (let i = 2; i < o.length - 2; i++) { const refATR = atrValues[Math.min(i, atrValues.length - 1)] || currentATR;
    let ce = i; while (ce < o.length - 1) { const c = o[ce]; if (Math.abs(c[4] - c[1]) > refATR * 0.6) break; ce++; }
    const len = ce - i; if (len < 3) continue; const cc = o.slice(i, ce); const zL = Math.min(...cc.map(c => c[3])), zH = Math.max(...cc.map(c => c[2])), zR = (zH - zL) / zL * 100; if (zR > 8) continue;
    if (ce >= o.length) continue; const bo = o[ce], body = bo[4] - bo[1]; if (Math.abs(body) < refATR * 0.8 && (Math.abs(body) / zL * 100) < 2) continue; const dir = body > 0 ? 'long' : 'short';
    let retested = false, rb = false; for (let q = ce + 1; q < o.length; q++) { if (dir === 'long' && o[q][3] <= zH) { retested = true; rb = o[q][4] > zL; break; } if (dir === 'short' && o[q][2] >= zL) { retested = true; rb = o[q][4] < zH; break; } }
    zones.push({ zL, zH, zR, dir, len, retested, rb, age: o.length - ce }); }
  let z = null, bd = Infinity; for (const q of zones) { if (q.age > 75) continue; const mid = (q.zL + q.zH) / 2, d = Math.abs(price - mid) / mid * 100; if (d > 10) continue; if (d < bd) { bd = d; z = q; } } if (!z) return null;
  let score = 0; score += z.len >= 8 ? 10 : z.len >= 5 ? 7 : 4; if (z.zR < 3) score += 5; else if (z.zR < 5) score += 3; if (z.rb) score += 5;
  const inZone = z.dir === 'long' ? price >= z.zL * 0.97 && price <= z.zH * 1.02 : price <= z.zH * 1.03 && price >= z.zL * 0.98;
  const dist = z.dir === 'long' ? (price - z.zH) / z.zH * 100 : (z.zL - price) / z.zL * 100;
  if (inZone) score += 20; else if (Math.abs(dist) < 3) score += 15; else if (Math.abs(dist) < 5) score += 10; else if (Math.abs(dist) < 10) score += 5; else return null;
  const ra = atrValues.slice(-5), oa = atrValues.slice(-20, -5); if (oa.length >= 5) { const cmp = (ra.reduce((a, x) => a + x, 0) / ra.length) / (oa.reduce((a, x) => a + x, 0) / oa.length); score += cmp < 0.4 ? 10 : cmp < 0.6 ? 7 : cmp < 0.8 ? 4 : 0; }
  const pl = []; for (let q = Math.max(1, o.length - 20); q < o.length - 1; q++) if (o[q][3] <= o[q - 1][3] && o[q][3] <= o[q + 1][3]) pl.push(o[q][3]); if (pl.length >= 2 && pl.at(-1) > pl.at(-2)) score += 5;
  const e20 = EMA.calculate({ values: closes, period: 20 }); if (e20.length && Math.abs((price - e20.at(-1)) / e20.at(-1) * 100) < 2) score += 5;
  if (score < 20) return null;
  const L3 = o.slice(-3), lc = L3[2], pc = L3[1], lg = lc[4] > lc[1], falling = !lg && lc[4] < pc[4]; let bounce = false; if (lg) { bounce = true; score += 5; } else if (falling) score -= 10;
  if (score < 30) return null;   // index.js only trades zones with score ≥ 30 (before on-chain/L-S bonuses, which only add)
  const entry = inZone ? (z.zL + z.zH) / 2 : price, sl = z.dir === 'long' ? z.zL * 0.97 : z.zH * 1.03, slDist = Math.abs((entry - sl) / entry) * 100; if (slDist > 12 || slDist < 2) return null;
  return { dir: z.dir, score, price, entry, sl, slDist, inZone, bounce, zone: z, priceChange }; }

const t0 = Math.min(...syms.map(s => H1[s][0][0])) + 36 * D, t1 = Math.max(...syms.map(s => H1[s].at(-1)[0])) - 2 * D;
const START = Math.max(t0, Date.parse(process.argv[2] || '2000-01-01')), out = [], lastDay = new Map(); let n = 0;
for (let T = Math.ceil(START / H) * H; T <= t1; T += H) { const hr = new Date(T).getUTCHours(); if (!((hr >= 8 && hr < 14) || (hr >= 20 && hr < 23))) continue;
  const vols = []; for (const s of syms) { const k = H1[s], j = idx(k, T); if (j < 24 || T - k[j][0] > 2 * H) continue; vols.push([s, pre[s][j + 1] - pre[s][j - 23], j]); }
  vols.sort((a, b) => b[1] - a[1]);
  for (const [s, v, j] of vols.slice(0, 50)) { if (v < 2e6) continue; const dayKey = Math.floor((T - H) / D); if (lastDay.get(s) === dayKey) continue;
    const r = analyze(H1[s], j, T); if (!r) continue; lastDay.set(s, dayKey);
    // 1h path after entry (entry at the signal hour's close, market)
    const k = H1[s], path = k.slice(j + 1, j + 1 + 72).map(x => [x[2], x[3], x[4]]); if (path.length < 24) continue;
    out.push({ s, T, ...r, E: r.price, path }); }
  if (++n % 500 === 0) console.log(new Date(T).toISOString().slice(0, 13), 'signals', out.length); }
fs.writeFileSync('dz_replay.json', JSON.stringify(out)); console.log('DONE', out.length, 'trades', new Date(out[0]?.T).toISOString().slice(0, 10), '→', new Date(out.at(-1)?.T).toISOString().slice(0, 10), '| longs', out.filter(x => x.dir === 'long').length);
