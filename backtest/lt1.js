// Long-period detector: same rules as stage1, but open interest comes from Bybit (Binance OI history only covers 30 days).
// Bybit OI is in coins → USD with the Binance 5m close at the same time. Coins without a Bybit perp are skipped.
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { getJ, pool } = require('./lib');
const F = 'https://fapi.binance.com', M = 60000, H = 60 * M, D = 24 * H;
const START = Date.parse(process.argv[2] || '2026-06-01'), END = Date.parse(process.argv[3] || '2026-10-12T23:59Z');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function bybitOI(sym, a, b) { const out = []; let end = b;
  for (let i = 0; i < 10; i++) { const j = await getJ(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=5min&startTime=${a}&endTime=${end}&limit=200`, 'bybit');
    const l = j?.result?.list; if (!Array.isArray(l) || !l.length) break; for (const x of l) out.push({ t: +x.timestamp, q: +x.openInterest }); const oldest = Math.min(...l.map(x => +x.timestamp)); if (l.length < 200 || oldest <= a) break; end = oldest - 1; }
  return [...new Map(out.map(x => [x.t, x])).values()].sort((p, q) => p.t - q.t); }
module.exports = { bybitOI };
if (require.main === module) (async () => {
  const info = await getJ(`${F}/fapi/v1/exchangeInfo`);
  const by = await getJ('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000', 'bybit'); const bySet = new Set(by.result.list.map(x => x.symbol));
  const syms = info.symbols.filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING').map(s => s.symbol);
  log('binance perps', syms.length, 'also on bybit', syms.filter(s => bySet.has(s)).length);
  const h1 = fs.existsSync('h1L.json') ? JSON.parse(fs.readFileSync('h1L.json')) : {};
  // top up: new coins from START-35d, known coins from their last stored candle
  await pool(syms.filter(s => !h1[s] || h1[s].at(-1)[0] + H < END - H), 6, async (s) => { const rows = h1[s] || []; let t = rows.length ? rows.at(-1)[0] + H : START - 35 * D;
    while (t < END) { const k = await getJ(`${F}/fapi/v1/klines?symbol=${encodeURIComponent(s)}&interval=1h&startTime=${t}&limit=1500`); if (!Array.isArray(k) || !k.length) break; rows.push(...k.map(x => [+x[0], +x[1], +x[2], +x[3], +x[4], +x[7]])); t = +k.at(-1)[0] + H; if (k.length < 1500) break; }
    h1[s] = rows; });
  fs.writeFileSync('h1L.json', JSON.stringify(h1)); log('1h klines', Object.keys(h1).length);
  const cands = [];
  for (const s of Object.keys(h1)) { if (!bySet.has(s)) continue; const k = h1[s]; const days = new Set();
    for (let i = 24; i < k.length; i++) { if (k[i][0] < START || k[i][0] > END) continue; const chg = k[i][2] / k[i - 24][4] - 1; if (chg < 0.10) continue; let v = 0; for (let j = i - 23; j <= i; j++) v += k[j][5]; if (v < 5e6) continue; days.add(Math.floor(k[i][0] / D) * D); }
    for (const d of days) cands.push({ s, d }); }
  log('candidate symbol-days', cands.length);
  const OUT = 'signals_L.json'; const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : { done: [], signals: [] };
  const doneSet = new Set(prev.done), signals = prev.signals, fund = {}; let n = 0;
  await pool(cands.filter(c => !doneSet.has(c.s + c.d)), 5, async ({ s, d }) => {
    const e = encodeURIComponent(s), a = d - 26 * H, b = Math.min(d + D, Date.now());
    const k5 = []; for (let t = a; t < b;) { const k = await getJ(`${F}/fapi/v1/klines?symbol=${e}&interval=5m&startTime=${t}&endTime=${b}&limit=1000`); if (!Array.isArray(k) || !k.length) break; k5.push(...k); t = +k.at(-1)[0] + 5 * M; if (k.length < 1000) break; }
    const oiQ = await bybitOI(s, d - 5 * H, b);
    if (!fund[s]) fund[s] = (await getJ(`${F}/fapi/v1/fundingRate?symbol=${e}&startTime=${START - 2 * D}&limit=1000`)) || [];
    if (d + D <= Date.now()) doneSet.add(s + d); // today's unfinished day is scanned again next run
    if (++n % 200 === 0) { log('scanned', n, 'signals', signals.length); fs.writeFileSync(OUT, JSON.stringify({ done: [...doneSet], signals })); }
    if (k5.length < 300 || oiQ.length < 50) return;
    const K = k5.map(x => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4], qv: +x[7] })); const close = new Map(K.map(x => [x.t, x.c]));
    const O = oiQ.map(x => ({ t: x.t, v: x.q * (close.get(x.t) ?? close.get(x.t - 5 * M) ?? NaN) })).filter(x => isFinite(x.v)); let oj = 0;
    const F8 = Array.isArray(fund[s]) ? fund[s].map(x => ({ t: +x.fundingTime, r: +x.fundingRate })) : [];
    let g = 0, l = 0; const rsi = new Array(K.length).fill(null);
    for (let i = 1; i < K.length; i++) { const dlt = K[i].c - K[i - 1].c; if (i <= 14) { g += Math.max(dlt, 0) / 14; l += Math.max(-dlt, 0) / 14; } else { g = (g * 13 + Math.max(dlt, 0)) / 14; l = (l * 13 + Math.max(-dlt, 0)) / 14; } if (i >= 14) rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    for (let i = 288; i < K.length; i++) {
      const t = K[i].t + 5 * M; if (t <= d || t > d + D) continue;
      const price = K[i].c, pump = (price / K[i - 288].c - 1) * 100; if (pump <= 5) continue;
      let hi = 0, vol = 0; for (let j = i - 287; j <= i; j++) { if (K[j].h > hi) hi = K[j].h; vol += K[j].qv; } if (vol < 5e6) continue;
      const near = (hi - price) / hi * 100;
      while (oj + 1 < O.length && O[oj + 1].t <= t) oj++; const oNow = O[oj]; if (!oNow || oNow.t > t || t - oNow.t > 15 * M) continue;
      const oPrev = O.filter(x => x.t <= oNow.t - 4 * H).pop(); if (!oPrev || oNow.t - oPrev.t > 4.3 * H) continue;
      const oi4h = (oNow.v / oPrev.v - 1) * 100;
      const fr = (F8.find(x => x.t >= t) || F8.at(-1) || { r: 0 }).r;
      let sc = pump > 15 ? 3 : pump > 10 ? 2 : 1; sc += near < 3 ? 2 : near < 6 ? 1 : 0; sc += oi4h > 50 ? 3 : oi4h > 25 ? 2 : oi4h > 15 ? 1 : 0;
      sc += fr > 0.001 ? 2 : fr > 0.0003 ? 1 : fr < -0.003 ? -2 : fr < -0.001 ? -1 : 0; if (rsi[i] > 80) sc += 2;
      if (sc >= 6 && near < 10 && oi4h >= 25) { if (signals.some(x => x.s === s && x.t === t)) break; signals.push({ s, t, price, pump: +pump.toFixed(1), near: +near.toFixed(2), oi4h: +oi4h.toFixed(1), fr, rsi5: +(rsi[i] || 0).toFixed(0), score: sc, vol24: Math.round(vol) }); break; }
    }
  });
  signals.sort((a, b) => a.t - b.t); fs.writeFileSync(OUT, JSON.stringify({ done: [...doneSet], signals }));
  log('DONE signals', signals.length, new Date(signals[0]?.t).toISOString().slice(0, 10), '→', new Date(signals.at(-1)?.t).toISOString().slice(0, 10));
})().catch(e => { console.log('FATAL', e.stack); process.exit(1); });
