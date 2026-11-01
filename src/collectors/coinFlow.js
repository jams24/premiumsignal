// Coin flow check (/flow, 🐋 button on a position): whale (top-trader) positions, retail long/short, taker flow, OI,
// funding and where price sits (24h range, 7-day run / switch zone, distance from the 30/45-day high). Read-only public
// market data from Binance futures, Bybit as fallback and second retail source. Info only — it never feeds a trade.

const BN = 'https://fapi.binance.com';
const BY = 'https://api.bybit.com';
const M5 = 5 * 60000, H = 3600000;
const CACHE_MS = 60000;
const cache = new Map();   // key → { at, data }

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.retCode !== undefined && j.retCode !== 0) return null;   // Bybit error envelope
    return j;
  } catch (e) {
    return null;
  }
}
const arr = (x) => (Array.isArray(x) ? x : []);
const pct = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);

// Binance /futures/data series (ascending), 5m: latest, 1h ago, 4h ago, and the point at `since` (open trade's entry)
async function binanceRatio(path, sym, since) {
  const now = await getJson(`${BN}/futures/data/${path}?symbol=${sym}USDT&period=5m&limit=49`);
  const s = arr(now);
  if (!s.length) return null;
  const val = (x) => x && { ratio: +x.longShortRatio, long: +x.longAccount, t: +x.timestamp };
  const out = { now: val(s[s.length - 1]), h1: val(s[s.length - 13]), h4: val(s[0]) };
  if (since && Date.now() - since < 29 * 24 * H) {
    const at = arr(await getJson(`${BN}/futures/data/${path}?symbol=${sym}USDT&period=5m&startTime=${since - 2 * M5}&endTime=${since + M5}&limit=5`));
    const before = at.filter(x => +x.timestamp <= since);
    out.entry = val(before[before.length - 1] || at[0]);
  }
  return out;
}

// Bybit retail account ratio (buyRatio = share of accounts long), list comes newest first
async function bybitRetail(sym, since) {
  const s = arr((await getJson(`${BY}/v5/market/account-ratio?category=linear&symbol=${sym}USDT&period=5min&limit=49`))?.result?.list)
    .map(x => ({ long: +x.buyRatio, t: +x.timestamp })).sort((a, b) => a.t - b.t);
  if (!s.length) return null;
  const val = (x) => x && { ...x, ratio: x.long < 1 ? x.long / (1 - x.long) : null };
  const out = { now: val(s[s.length - 1]), h1: val(s[s.length - 13]), h4: val(s[0]) };
  if (since) {
    const at = arr((await getJson(`${BY}/v5/market/account-ratio?category=linear&symbol=${sym}USDT&period=5min&startTime=${since - 2 * M5}&endTime=${since + M5}&limit=5`))?.result?.list)
      .map(x => ({ long: +x.buyRatio, t: +x.timestamp })).sort((a, b) => a.t - b.t);
    const before = at.filter(x => x.t <= since);
    out.entry = val(before[before.length - 1] || at[0]);
  }
  return out;
}

async function binanceOi(sym, since) {
  const s = arr(await getJson(`${BN}/futures/data/openInterestHist?symbol=${sym}USDT&period=5m&limit=49`));
  if (!s.length) return null;
  const v = (x) => x && +x.sumOpenInterest;
  const out = { now: v(s[s.length - 1]), usd: +s[s.length - 1].sumOpenInterestValue, h1: v(s[s.length - 13]), h4: v(s[0]) };
  if (since && Date.now() - since < 29 * 24 * H) {
    const at = arr(await getJson(`${BN}/futures/data/openInterestHist?symbol=${sym}USDT&period=5m&startTime=${since - 2 * M5}&endTime=${since + M5}&limit=5`));
    const before = at.filter(x => +x.timestamp <= since);
    out.entry = v(before[before.length - 1] || at[0]);
  }
  return out;
}

async function bybitOi(sym, since) {
  const s = arr((await getJson(`${BY}/v5/market/open-interest?category=linear&symbol=${sym}USDT&intervalTime=5min&limit=49`))?.result?.list)
    .map(x => ({ oi: +x.openInterest, t: +x.timestamp })).sort((a, b) => a.t - b.t);
  if (!s.length) return null;
  const out = { now: s[s.length - 1].oi, h1: s[s.length - 13]?.oi, h4: s[0].oi };
  if (since) {
    const at = arr((await getJson(`${BY}/v5/market/open-interest?category=linear&symbol=${sym}USDT&intervalTime=5min&startTime=${since - 2 * M5}&endTime=${since + M5}&limit=5`))?.result?.list)
      .map(x => ({ oi: +x.openInterest, t: +x.timestamp })).sort((a, b) => a.t - b.t);
    const before = at.filter(x => x.t <= since);
    out.entry = (before[before.length - 1] || at[0])?.oi;
  }
  return out;
}

// 1h + 1d candles as [ts, o, h, l, c] ascending, Binance first then Bybit
async function candles(sym, exchange) {
  const bn = async () => {
    const [h, d] = await Promise.all([
      getJson(`${BN}/fapi/v1/klines?symbol=${sym}USDT&interval=1h&limit=200`),
      getJson(`${BN}/fapi/v1/klines?symbol=${sym}USDT&interval=1d&limit=46`),
    ]);
    const f = (x) => arr(x).map(k => [+k[0], +k[1], +k[2], +k[3], +k[4]]);
    return { h1: f(h), d1: f(d), src: 'Binance' };
  };
  const by = async () => {
    const [h, d] = await Promise.all([
      getJson(`${BY}/v5/market/kline?category=linear&symbol=${sym}USDT&interval=60&limit=200`),
      getJson(`${BY}/v5/market/kline?category=linear&symbol=${sym}USDT&interval=D&limit=46`),
    ]);
    const f = (x) => arr(x?.result?.list).map(k => [+k[0], +k[1], +k[2], +k[3], +k[4]]).sort((a, b) => a[0] - b[0]);
    return { h1: f(h), d1: f(d), src: 'Bybit' };
  };
  const first = exchange === 'bybit' ? by : bn, second = exchange === 'bybit' ? bn : by;
  const a = await first();
  return a.h1.length ? a : second();
}

async function funding(sym) {
  const p = await getJson(`${BN}/fapi/v1/premiumIndex?symbol=${sym}USDT`);
  if (p && p.lastFundingRate !== undefined) return +p.lastFundingRate * 100;
  const t = arr((await getJson(`${BY}/v5/market/tickers?category=linear&symbol=${sym}USDT`))?.result?.list)[0];
  return t ? +t.fundingRate * 100 : null;
}

async function taker1h(sym) {
  const s = arr(await getJson(`${BN}/futures/data/takerlongshortRatio?symbol=${sym}USDT&period=5m&limit=12`));
  if (!s.length) return null;
  const buy = s.reduce((a, x) => a + +x.buyVol, 0), sell = s.reduce((a, x) => a + +x.sellVol, 0);
  return sell > 0 ? buy / sell : null;
}

// since = entry time (ms) of an open trade → adds the "since entry" values
async function getFlow(symbol, { exchange, since } = {}) {
  const sym = String(symbol).toUpperCase().replace(/USDT$/, '');
  const key = `${sym}|${since || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const [k, whalesPos, whalesAcc, retailBn, retailBy, oiBn, fund, taker] = await Promise.all([
    candles(sym, exchange),
    binanceRatio('topLongShortPositionRatio', sym, since),
    binanceRatio('topLongShortAccountRatio', sym, since),
    binanceRatio('globalLongShortAccountRatio', sym, since),
    bybitRetail(sym, since),
    binanceOi(sym, since),
    funding(sym),
    taker1h(sym),
  ]);
  if (!k.h1.length) return { symbol: sym, error: `No futures data for ${sym}USDT on Binance or Bybit.` };
  const oi = oiBn || await bybitOi(sym, since);
  const h1 = k.h1, now = Date.now();
  const price = h1[h1.length - 1][4];
  const closed = h1.filter(c => c[0] + H <= now);
  const run7d = closed.length >= 168 && closed[closed.length - 168][1] > 0 ? pct(closed[closed.length - 1][4], closed[closed.length - 168][1]) : null;
  const last24 = h1.slice(-24);
  const hi24 = Math.max(...last24.map(c => c[2])), lo24 = Math.min(...last24.map(c => c[3]));
  const at = (hBack) => h1.length > hBack ? h1[h1.length - 1 - hBack][4] : null;
  const d1 = k.d1;
  const hiN = (n) => d1.length >= 2 ? Math.max(...d1.slice(-n).map(c => c[2])) : null;
  const data = {
    symbol: sym, src: k.src, price, run7d, hi24, lo24,
    ch1h: pct(price, at(1)), ch4h: pct(price, at(4)), ch24h: pct(price, at(24)),
    fromHi24: pct(price, hi24), fromHi30: pct(price, hiN(30)), fromHi45: pct(price, hiN(45)), days: d1.length,
    whalesPos, whalesAcc, retailBn, retailBy, oi, funding: fund, taker,
    entryPrice: null,
  };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return data;
}

const f2 = (x) => (x == null || !isFinite(x) ? '?' : x.toFixed(2));
const sp = (x, d = 1) => (x == null || !isFinite(x) ? '?' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`);
const lean = (r) => (r == null ? '' : r >= 1.2 ? 'long-heavy' : r <= 0.83 ? 'short-heavy' : 'balanced');
const fmtPrice = (p) => (p >= 1 ? p.toFixed(4) : p.toPrecision(5));

function switchZone(run7d) {
  if (run7d == null) return 'unknown';
  if (run7d < 12) return 'below 12% → no switch trade';
  if (run7d < 50) return '12–50% → switch LONG zone';
  if (run7d < 100) return '50–100% → switch SHORT zone';
  return 'over 100% → no switch trade';
}

// The two big ratios side by side → one plain reading (not a signal)
function reading(w, r) {
  if (w == null || r == null) return null;
  if (w >= 1.2 && r <= 0.9) return '🐋 long vs 👥 short — squeeze-up risk for shorts (the Arslan pattern)';
  if (w <= 0.83 && r >= 1.1) return '🐋 short vs 👥 long — flush-down risk for longs';
  if (w >= 1.2 && r >= 1.2) return 'Everyone long — crowded long';
  if (w <= 0.83 && r <= 0.83) return 'Everyone short — crowded short';
  return 'No strong split between whales and retail';
}

function oiReading(oiCh, priceCh) {
  if (oiCh == null || priceCh == null) return null;
  const up = priceCh > 0.5, down = priceCh < -0.5, oiUp = oiCh > 2, oiDown = oiCh < -2;
  if (up && oiUp) return 'price up + OI up → new positions piling in on the move';
  if (up && oiDown) return 'price up + OI down → shorts closing (short squeeze / covering)';
  if (down && oiUp) return 'price down + OI up → new shorts opening';
  if (down && oiDown) return 'price down + OI down → longs closing / liquidations';
  return 'OI and price flat-ish';
}

// trade (optional): { direction, entry_price, created_at } of an open position on this coin
function formatFlow(d, trade) {
  if (d.error) return `⚠️ ${d.error}`;
  const L = [];
  const short = trade && trade.direction === 'short';
  L.push(`🐋 <b>Flow — ${d.symbol}</b>${trade ? ` · your ${short ? '🔴 SHORT' : '🟢 LONG'}` : ''}`);
  L.push('');
  L.push(`<b>Level</b> (${d.src})`);
  L.push(`  Price $${fmtPrice(d.price)} · 1h ${sp(d.ch1h)} · 4h ${sp(d.ch4h)} · 24h ${sp(d.ch24h)}`);
  L.push(`  24h range $${fmtPrice(d.lo24)} – $${fmtPrice(d.hi24)} · ${sp(d.fromHi24)} from the 24h high`);
  if (d.fromHi30 != null) L.push(`  ${sp(d.fromHi30, 0)} from the 30-day high${d.days >= 45 ? ` · ${sp(d.fromHi45, 0)} from the 45-day high` : ''}`);
  L.push(`  7-day run (closed candles): <b>${sp(d.run7d, 0)}</b> — ${switchZone(d.run7d)} <i>(no-spot coins only)</i>`);
  L.push('');
  L.push('<b>Whales</b> (Binance top traders)');
  const wp = d.whalesPos, wa = d.whalesAcc;
  if (wp?.now) L.push(`  By position size: <b>${f2(wp.now.ratio)}</b> (${(wp.now.long * 100).toFixed(0)}% long) ${lean(wp.now.ratio)} · 1h ago ${f2(wp.h1?.ratio)} · 4h ago ${f2(wp.h4?.ratio)}`);
  if (wa?.now) L.push(`  By accounts: ${f2(wa.now.ratio)} (${(wa.now.long * 100).toFixed(0)}% long)`);
  if (!wp?.now && !wa?.now) L.push('  — not on Binance futures (Bybit has no top-trader data)');
  L.push('<b>Retail</b> (all accounts)');
  const rb = d.retailBn, ry = d.retailBy;
  if (rb?.now) L.push(`  Binance: <b>${f2(rb.now.ratio)}</b> (${(rb.now.long * 100).toFixed(0)}% long) ${lean(rb.now.ratio)} · 1h ago ${f2(rb.h1?.ratio)} · 4h ago ${f2(rb.h4?.ratio)}`);
  if (ry?.now) L.push(`  Bybit: <b>${f2(ry.now.ratio)}</b> (${(ry.now.long * 100).toFixed(0)}% long) · 1h ago ${f2(ry.h1?.ratio)} · 4h ago ${f2(ry.h4?.ratio)}`);
  if (!rb?.now && !ry?.now) L.push('  — no data');
  L.push('<b>Flow</b>');
  const oi = d.oi;
  const oi1 = oi ? pct(oi.now, oi.h1) : null, oi4 = oi ? pct(oi.now, oi.h4) : null;
  if (oi) L.push(`  OI 1h ${sp(oi1)} · 4h ${sp(oi4)}${oi.usd ? ` · $${(oi.usd / 1e6).toFixed(1)}M open` : ''}`);
  if (d.taker != null) L.push(`  Taker buy/sell (1h): ${f2(d.taker)} ${d.taker >= 1.1 ? '— buyers hitting harder' : d.taker <= 0.9 ? '— sellers hitting harder' : '— even'}`);
  if (d.funding != null) L.push(`  Funding: ${d.funding >= 0 ? '+' : ''}${d.funding.toFixed(4)}% ${d.funding >= 0.05 ? '— longs paying a lot' : d.funding <= -0.05 ? '— shorts paying a lot' : ''}`);
  const rr = rb?.now?.ratio ?? ry?.now?.ratio;
  const rd = reading(wp?.now?.ratio, rr), od = oiReading(oi1, d.ch1h);
  if (rd || od) {
    L.push('');
    L.push('<b>Reading</b>');
    if (rd) L.push(`  • ${rd}`);
    if (od) L.push(`  • Last hour: ${od}`);
  }
  if (trade) {
    const E = +trade.entry_price, S = short;
    const move = E > 0 ? (S ? -pct(d.price, E) : pct(d.price, E)) : null;
    const rs = ry?.entry ? ry : rb?.entry ? rb : null;      // research used Bybit retail first
    const rNow = rs?.now?.long, rEnt = rs?.entry?.long;
    const oiE = oi?.entry, oiCh = oiE ? pct(oi.now, oiE) : null;
    L.push('');
    L.push('<b>Since your entry</b>');
    L.push(`  Price ${sp(move)} ${move != null && move < 0 ? 'against you' : 'for you'}`);
    if (wp?.entry) L.push(`  Whales ${f2(wp.entry.ratio)} → ${f2(wp.now.ratio)}`);
    if (rEnt != null) L.push(`  Retail long share ${(rEnt * 100).toFixed(1)}% → ${(rNow * 100).toFixed(1)}% (${((rNow - rEnt) * 100) >= 0 ? '+' : ''}${((rNow - rEnt) * 100).toFixed(1)} pts, ${rs === ry ? 'Bybit' : 'Binance'})`);
    if (oiCh != null) L.push(`  OI ${sp(oiCh)}`);
    // Squeeze rule B (backtested on shorts): ≥ 1% against, retail long share −2 pts, OI not falling
    if (S && move != null && move <= -1 && rEnt != null && rEnt - rNow >= 0.02 && oiCh != null && oiCh >= 0) {
      L.push(`  ⚠️ <b>Squeeze building</b>: price against you, retail turning short, OI up <i>(backtest: small edge, about break-even in Oct)</i>`);
    }
  }
  L.push('');
  L.push(`<i>Info only — whale/retail ratios at entry didn't predict pump trades in our backtests; the one steady slice was switch shorts doing best with retail ≥ 1.2. Updated ${new Date().toISOString().slice(11, 16)} UTC.</i>`);
  return L.join('\n');
}

// One line for the position card
function flowLine(d) {
  if (!d || d.error) return null;
  const w = d.whalesPos?.now?.ratio, r = d.retailBn?.now?.ratio ?? d.retailBy?.now?.ratio;
  const oi1 = d.oi ? pct(d.oi.now, d.oi.h1) : null;
  const parts = [];
  if (w != null) parts.push(`🐋 ${f2(w)}`);
  if (r != null) parts.push(`👥 ${f2(r)}`);
  if (oi1 != null) parts.push(`OI 1h ${sp(oi1)}`);
  if (d.funding != null) parts.push(`fund ${d.funding >= 0 ? '+' : ''}${d.funding.toFixed(3)}%`);
  return parts.length ? parts.join(' · ') : null;
}

module.exports = { getFlow, formatFlow, flowLine, switchZone };
