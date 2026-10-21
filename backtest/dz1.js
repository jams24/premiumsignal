// Demand-zone study, step 1: export every DZ trade from the DB, then fetch 1m candles for 48h after entry
// (from the trade's own exchange) and 1h candles for 10 days before → data_dz/dz_trades.json, dz_paths.json, dz_h1.json
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });   // DATABASE_URL
process.chdir(require('path').join(__dirname, 'data_dz'));
const fs = require('fs'); const { Client } = require('pg');
const M = 60000, H = 60 * M;
const sleep = ms => new Promise(r => setTimeout(r, ms)); const lim = {}; const gate = async (k, ps) => { const now = Date.now(), at = Math.max(now, lim[k] || 0); lim[k] = at + 1000 / ps; if (at > now) await sleep(at - now); };
async function J(url, host, ps) { for (let i = 0; i < 5; i++) { await gate(host, ps); try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (r.status === 429 || r.status === 418) { await sleep(5000 * (i + 1)); continue; } return await r.json(); } catch (e) { await sleep(1500 * (i + 1)); } } return null; }
// candles [t,o,h,l,c,quoteVol] from Bybit or Binance futures
async function kl(ex, sym, tf, start, end) { const out = []; let t = start;
  while (t < end) { let rows;
    if (ex === 'bybit') { const j = await J(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}USDT&interval=${tf === '1m' ? 1 : 60}&start=${t}&end=${end}&limit=1000`, 'bybit', 8); rows = (j?.result?.list || []).map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[6]]).reverse(); }
    else { const j = await J(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}USDT&interval=${tf}&startTime=${t}&endTime=${end}&limit=1500`, 'fapi', 5); rows = Array.isArray(j) ? j.map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[7]]) : []; }
    if (!rows.length) break; out.push(...rows.filter(r => r[0] >= t)); t = rows.at(-1)[0] + (tf === '1m' ? M : H); if (rows.length < 900) break; }
  return out; }
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const T = (await c.query(`select id,symbol,exchange,direction,mode,status,entry_price,position_size,leverage,tp1,tp2,tp3,tp4,stop_loss,original_stop_loss,invalidation,atr,hit_tp1,hit_tp2,hit_tp3,exit_price,pnl_usd,realized_pnl,close_reason,created_at,closed_at,onchain_context from trades where source='demandzone' order by created_at`)).rows; await c.end();
  fs.writeFileSync('dz_trades.json', JSON.stringify(T)); console.log('trades', T.length, 'exchanges', JSON.stringify(T.reduce((a, t) => (a[t.exchange] = (a[t.exchange] || 0) + 1, a), {})));
  const P = fs.existsSync('dz_paths.json') ? JSON.parse(fs.readFileSync('dz_paths.json')) : {}, H1 = fs.existsSync('dz_h1.json') ? JSON.parse(fs.readFileSync('dz_h1.json')) : {};
  const todo = T.filter(t => !P[t.id]); let n = 0;
  let i = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) { const t = todo[i++]; const t0 = Math.floor(new Date(t.created_at).getTime() / M) * M;
    try { const m1 = await kl(t.exchange, t.symbol, '1m', t0, Math.min(Date.now(), t0 + 48 * H)); P[t.id] = m1.flatMap(r => [r[2], r[3], r[4]]); P[t.id + '_t0'] = m1[0]?.[0] ?? null;
      const hk = `${t.exchange}:${t.symbol}:${Math.floor(t0 / (6 * H))}`; if (!H1[hk]) H1[hk] = await kl(t.exchange, t.symbol, '1h', t0 - 10 * 24 * H, t0);
    } catch (e) { console.log('ERR', t.id, e.message); }
    if (++n % 100 === 0) { console.log(new Date().toISOString().slice(11, 19), n, '/', todo.length); fs.writeFileSync('dz_paths.json', JSON.stringify(P)); fs.writeFileSync('dz_h1.json', JSON.stringify(H1)); } } }));
  // BTC 1h for context
  H1.BTC = await kl('binance', 'BTC', '1h', Date.parse('2026-08-01'), Date.now());
  fs.writeFileSync('dz_paths.json', JSON.stringify(P)); fs.writeFileSync('dz_h1.json', JSON.stringify(H1)); console.log('DONE paths', Object.keys(P).filter(k => !k.endsWith('_t0')).length);
})();
