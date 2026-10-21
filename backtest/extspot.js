// Spot (and extra perp) 5m volume for the 6h before every entry in base_trades.json, from venues the live spot share ignores.
// data/ext_spot.json: { key: { venue: [[t, close, quoteVol], ...] } }  (Upbit/Bithumb in KRW, plus KRW-USDT for conversion)
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'); const B = JSON.parse(fs.readFileSync('base_trades.json')); const OUT = 'ext_spot.json', M = 60000, H = 60 * M;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lim = {}; const gate = async (k, perSec) => { const now = Date.now(), at = Math.max(now, lim[k] || 0); lim[k] = at + 1000 / perSec; if (at > now) await sleep(at - now); };
async function J(url, host, perSec) { for (let i = 0; i < 5; i++) { await gate(host, perSec);
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'research' } }); if (r.status === 429 || r.status === 418) { await sleep(5000 * (i + 1)); continue; }
    if (r.status >= 500) { await sleep(2000); continue; } return await r.json(); } catch (e) { await sleep(1500 * (i + 1)); } } return null; }
const base = s => s.replace(/USDT$/, '').replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, '');
const iso = t => new Date(t).toISOString().slice(0, 19);
(async () => {
  const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
  const L = {}; // listings
  const up = await J('https://api.upbit.com/v1/market/all', 'upbit', 5); L.upbit = new Set((up || []).filter(m => m.market.startsWith('KRW-')).map(m => m.market.slice(4)));
  const bt = await J('https://api.bithumb.com/v1/market/all', 'bithumb', 5); L.bithumb = new Set((bt || []).filter(m => m.market.startsWith('KRW-')).map(m => m.market.slice(4)));
  const cb = await J('https://api.exchange.coinbase.com/products', 'coinbase', 5); L.coinbase = new Set((cb || []).filter(p => p.quote_currency === 'USD').map(p => p.base_currency));
  const os = await J('https://www.okx.com/api/v5/public/instruments?instType=SPOT', 'okx', 5); L.okxSpot = new Set((os?.data || []).filter(i => i.quoteCcy === 'USDT').map(i => i.baseCcy));
  const ow = await J('https://www.okx.com/api/v5/public/instruments?instType=SWAP', 'okx', 5); L.okxSwap = new Map((ow?.data || []).filter(i => i.settleCcy === 'USDT').map(i => [i.ctValCcy, +i.ctVal]));
  const bs = await J('https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT', 'bnspot', 5); L.bnSpot = new Set((bs?.symbols || []).filter(s => s.quoteAsset === 'USDT').map(s => s.baseAsset));
  const ys = await J('https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000', 'bybit', 5); L.bySpot = new Set((ys?.result?.list || []).filter(s => s.quoteCoin === 'USDT').map(s => s.baseCoin));
  console.log('listings', Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.size])));
  const todo = B.filter(x => !have[x.key]); let n = 0;
  const one = async (x) => { const b = base(x.s), a = x.t - 6 * H, e = x.t, out = {};
    const tasks = [];
    if (L.upbit.has(b)) tasks.push((async () => { const j = await J(`https://api.upbit.com/v1/candles/minutes/5?market=KRW-${b}&to=${iso(e)}Z&count=72`, 'upbit', 8); if (Array.isArray(j)) out.upbit = j.map(c => [Date.parse(c.candle_date_time_utc + 'Z'), c.trade_price, c.candle_acc_trade_price]).reverse();
      const u = await J(`https://api.upbit.com/v1/candles/minutes/5?market=KRW-USDT&to=${iso(e)}Z&count=72`, 'upbit', 8); if (Array.isArray(u)) out.krwusdt = u.map(c => [Date.parse(c.candle_date_time_utc + 'Z'), c.trade_price, c.candle_acc_trade_price]).reverse(); })());
    if (L.bithumb.has(b)) tasks.push((async () => { const j = await J(`https://api.bithumb.com/v1/candles/minutes/5?market=KRW-${b}&to=${iso(e + 9 * H)}&count=72`, 'bithumb', 8); if (Array.isArray(j)) out.bithumb = j.map(c => [Date.parse(c.candle_date_time_utc + 'Z'), c.trade_price, c.candle_acc_trade_price]).reverse(); })());
    if (L.coinbase.has(b)) tasks.push((async () => { const j = await J(`https://api.exchange.coinbase.com/products/${b}-USD/candles?granularity=300&start=${iso(a)}Z&end=${iso(e - 1000)}Z`, 'coinbase', 6); if (Array.isArray(j)) out.coinbase = j.map(c => [c[0] * 1000, c[4], c[5] * c[4]]).reverse(); })());
    if (L.okxSpot.has(b)) tasks.push((async () => { const j = await J(`https://www.okx.com/api/v5/market/history-candles?instId=${b}-USDT&bar=5m&after=${e}&limit=72`, 'okx', 8); if (Array.isArray(j?.data)) out.okxSpot = j.data.map(c => [+c[0], +c[4], +c[7]]).reverse(); })());
    if (L.okxSwap.has(b)) tasks.push((async () => { const j = await J(`https://www.okx.com/api/v5/market/history-candles?instId=${b}-USDT-SWAP&bar=5m&after=${e}&limit=72`, 'okx', 8); if (Array.isArray(j?.data)) out.okxSwap = j.data.map(c => [+c[0], +c[4], +c[6] * +c[4]]).reverse(); })());
    if (L.bnSpot.has(b)) tasks.push((async () => { const j = await J(`https://api.binance.com/api/v3/klines?symbol=${b}USDT&interval=5m&startTime=${a}&endTime=${e - 1}&limit=72`, 'bnspot', 8); if (Array.isArray(j)) out.bnSpot = j.map(c => [+c[0], +c[4], +c[7], +c[10]]); })());
    if (L.bySpot.has(b)) tasks.push((async () => { const j = await J(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${b}USDT&interval=5&start=${a}&end=${e - 1}&limit=72`, 'bybit', 8); const l = j?.result?.list; if (Array.isArray(l)) out.bySpot = l.map(c => [+c[0], +c[4], +c[6]]).reverse(); })());
    tasks.push((async () => { const j = await J(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${x.s}&interval=5&start=${a}&end=${e - 1}&limit=72`, 'bybit', 8); const l = j?.result?.list; if (Array.isArray(l)) out.byPerp = l.map(c => [+c[0], +c[4], +c[6]]).reverse(); })());
    await Promise.all(tasks);
    for (const k of Object.keys(out)) out[k] = out[k].filter(c => c[0] >= a && c[0] + 5 * M <= e); // closed candles inside the window only
    have[x.key] = out; if (++n % 100 === 0) { console.log(new Date().toISOString().slice(11, 19), n, '/', todo.length); fs.writeFileSync(OUT, JSON.stringify(have)); } };
  let i = 0; await Promise.all(Array.from({ length: 8 }, async () => { while (i < todo.length) await one(todo[i++]).catch(e => console.log('ERR', e.message)); }));
  fs.writeFileSync(OUT, JSON.stringify(have));
  const cnt = {}; for (const v of Object.values(have)) for (const k of Object.keys(v)) if (v[k].length) cnt[k] = (cnt[k] || 0) + 1; console.log('DONE', Object.keys(have).length, 'trades; with data per venue', cnt);
})();
