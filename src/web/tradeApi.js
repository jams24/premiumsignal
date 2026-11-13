// Dashboard → Telegram bridge for real trades (Simulator tab, "Real · via Telegram").
// It never places, changes or cancels an order. POST /api/trade/panel only fills in the same /long · /short panel the
// owner gets in Telegram and sends it to their chat; the order is placed only when they tap ✅ there (and, for Live,
// "YES — place LIVE order"), through the bot's normal path (executeManual → tradeExecutor.openManualTrade).
// GET /api/trade/positions is a read-only copy of /mpositions (open live trades + pending limit orders).
// The caller has already checked the dashboard key.
const logger = require('../utils/logger');

let bot = null;
function attach(b) { bot = b; }

const MAX_BODY = 4096, SEND_GAP_MS = 3000;
let lastSend = 0, posCache = null;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });   // past the limit: drain, keep nothing
    req.on('end', () => {
      if (size > MAX_BODY) return reject(Object.assign(new Error('Request too large'), { code: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

// Only these fields, each checked; anything else in the body is ignored
function cleanOrder(b) {
  const sym = String(b.symbol || '').toUpperCase().replace(/USDT$/, '');
  if (!/^[A-Z0-9]{1,20}$/.test(sym)) return { error: 'Coin must be letters/numbers, e.g. BTC' };
  if (!['long', 'short'].includes(b.direction)) return { error: 'Pick long or short' };
  const out = { symbol: sym, direction: b.direction, mode: b.mode === 'paper' ? 'paper' : 'live' };
  const pos = (k, max) => {
    if (b[k] == null || b[k] === '') return true;
    const v = Number(b[k]);
    if (!(v > 0) || !isFinite(v) || v > max) return false;
    out[k] = v; return true;
  };
  if (!pos('margin', 100000)) return { error: 'Margin must be a positive number' };
  if (!pos('leverage', 125)) return { error: 'Leverage must be 1–125' };
  if (out.leverage != null) { out.leverage = Math.round(out.leverage); if (out.leverage < 1) return { error: 'Leverage must be 1–125' }; }
  for (const k of ['slPrice', 'tp1Price', 'limitPrice']) if (!pos(k, 1e9)) return { error: `${k} must be a positive price` };
  if (['binance', 'bybit'].includes(b.chartExchange)) out.chartExchange = b.chartExchange;
  return { order: out };
}

async function handle(req, url, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (!bot || !bot.openPanelFromWeb || !bot.livePositionsForWeb) return send(503, { error: 'The bot is still starting — try again in a minute.' });

    if (url.pathname === '/api/trade/panel') {
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(415, { error: 'JSON only' });
      const body = await readJson(req);
      const { order, error } = cleanOrder(body || {});
      if (error) return send(400, { error });
      const now = Date.now();
      if (now - lastSend < SEND_GAP_MS) return send(429, { error: 'One panel every 3 seconds — check Telegram.' });
      lastSend = now;
      logger.info(`[WEB TRADE] panel → Telegram: ${order.direction} ${order.symbol} ${order.mode}${order.limitPrice ? ' limit' : ''}`);
      const r = await bot.openPanelFromWeb(order);
      if (r.open) return send(409, { error: `You already have an open ${r.open.direction.toUpperCase()} on ${order.symbol} (${r.open.mode}) — manage it with /mpositions in Telegram.`, open: r.open });
      return send(200, { ok: true, panel: r.panel || null });
    }

    if (url.pathname === '/api/trade/positions') {
      if (req.method !== 'GET') return send(405, { error: 'GET only' });
      if (!posCache || Date.now() - posCache.at > 5000) posCache = { at: Date.now(), data: await bot.livePositionsForWeb() };
      return send(200, { ...posCache.data, at: posCache.at });
    }

    return send(404, { error: 'unknown trade endpoint' });
  } catch (e) {
    logger.warn(`[WEB TRADE] ${url.pathname}: ${e.message}`);
    return send(e.code === 413 || e.code === 400 ? e.code : 500, { error: e.message });
  }
}

module.exports = { attach, handle, cleanOrder };
