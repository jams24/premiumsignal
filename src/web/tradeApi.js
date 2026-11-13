// Dashboard ↔ bot bridge for real trades (Simulator tab, Live → Real). The caller has already checked the dashboard key.
//
// Direct (needs /webtrade on in Telegram; every action is reported in the owner's chat):
//   POST /api/trade/preview  — the /short · /long setup the bot would place (exchange, levels, size, errors); places nothing
//   POST /api/trade/open     — place it now through the bot's own path (executeManual → tradeExecutor.openManualTrade,
//                              or the real limit order), no ✅ in Telegram
//   POST /api/trade/manage   — close · stop · breakeven · take · cancel · move_limit on a live trade / limit order, through
//                              the same functions as the /mpositions and /orders buttons
// Telegram confirm (always available):
//   POST /api/trade/panel    — fill in the /long · /short panel in Telegram; nothing is placed until ✅ there
// Read-only:
//   GET  /api/trade/positions — open live trades + pending live limit orders (+ whether web trading is on)
// Writes carry a client nonce (a double click is refused) and are spaced ≥ 2 s apart.
const logger = require('../utils/logger');

let bot = null;
function attach(b) { bot = b; }

const MAX_BODY = 4096, SEND_GAP_MS = 3000, WRITE_GAP_MS = 2000, NONCE_TTL_MS = 10 * 60000;
let lastSend = 0, lastWrite = 0, posCache = null;
const nonces = new Map();   // nonce → time used

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
  if (['binance', 'bybit'].includes(b.exchange)) out.exchange = b.exchange;   // blank = the saved /short · /long exchange
  return { order: out };
}

const MANAGE = { close: [], stop: ['price'], breakeven: [], take: ['pct'], cancel: [], move_limit: ['price'] };
function cleanManage(b) {
  if (!Object.prototype.hasOwnProperty.call(MANAGE, b.action)) return { error: 'Unknown action' };
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Bad id' };
  const out = { action: b.action, id };
  if (MANAGE[b.action].includes('price')) {
    const p = Number(b.price);
    if (!(p > 0) || !isFinite(p) || p > 1e9) return { error: 'Price must be a positive number' };
    out.price = p;
  }
  if (MANAGE[b.action].includes('pct')) {
    const p = Number(b.pct);
    if (![25, 50, 75].includes(p)) return { error: 'Take 25, 50 or 75%' };
    out.pct = p;
  }
  return { a: out };
}

function useNonce(n) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(n)) return 'Missing request id — reload the page';
  const now = Date.now();
  for (const [k, t] of nonces) if (now - t > NONCE_TTL_MS) nonces.delete(k);
  if (nonces.has(n)) return 'Already sent (double click?) — check Telegram';
  nonces.set(n, now);
  return null;
}

async function handle(req, url, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const firstError = (r) => r.error || (r.errors && r.errors[0]) || 'Not placed';
  try {
    if (!bot || !bot.openPanelFromWeb || !bot.livePositionsForWeb || !bot.webTrade) return send(503, { error: 'The bot is still starting — try again in a minute.' });
    const p = url.pathname;

    if (['/api/trade/panel', '/api/trade/preview', '/api/trade/open', '/api/trade/manage'].includes(p)) {
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(415, { error: 'JSON only' });
      const body = (await readJson(req)) || {};

      if (p === '/api/trade/manage') {
        const { a, error } = cleanManage(body);
        if (error) return send(400, { error });
        if (!(await bot.webTrade.isOn())) return send(403, { error: 'Web trading is off — send /webtrade on in Telegram.', webTrading: false });
        const now = Date.now();
        if (now - lastWrite < WRITE_GAP_MS) return send(429, { error: 'One action every 2 seconds — try again.' });
        const nerr = useNonce(body.nonce); if (nerr) return send(409, { error: nerr });
        lastWrite = now;
        logger.info(`[WEB TRADE] manage ${a.action} #${a.id}${a.price ? ' @ ' + a.price : ''}${a.pct ? ' ' + a.pct + '%' : ''}`);
        const r = await bot.webTrade.manage(a);
        posCache = null;
        return r.ok ? send(200, r) : send(422, { ...r, error: firstError(r) });
      }

      const { order, error } = cleanOrder(body);
      if (error) return send(400, { error });

      if (p === '/api/trade/preview') {
        const r = await bot.webTrade.preview(order);
        if (r.open) return send(409, { error: `You already have an open ${r.open.direction.toUpperCase()} on ${order.symbol} (${r.open.mode}).`, open: r.open });
        if (r.error) return send(422, { error: r.error });
        return send(200, { ...r, webTrading: await bot.webTrade.isOn() });
      }

      if (p === '/api/trade/open') {
        if (!(await bot.webTrade.isOn())) return send(403, { error: 'Web trading is off — send /webtrade on in Telegram.', webTrading: false });
        const now = Date.now();
        if (now - lastWrite < WRITE_GAP_MS) return send(429, { error: 'One action every 2 seconds — try again.' });
        const nerr = useNonce(body.nonce); if (nerr) return send(409, { error: nerr });
        lastWrite = now;
        logger.info(`[WEB TRADE] open ${order.mode} ${order.direction} ${order.symbol}${order.limitPrice ? ' limit ' + order.limitPrice : ' market'}`);
        const r = await bot.webTrade.open(order);
        posCache = null;
        if (r.open) return send(409, { error: `You already have an open ${r.open.direction.toUpperCase()} on ${order.symbol} (${r.open.mode}).`, open: r.open });
        return r.ok ? send(200, r) : send(422, { ...r, error: firstError(r) });
      }

      // /api/trade/panel — Telegram confirm path
      const now = Date.now();
      if (now - lastSend < SEND_GAP_MS) return send(429, { error: 'One panel every 3 seconds — check Telegram.' });
      lastSend = now;
      logger.info(`[WEB TRADE] panel → Telegram: ${order.direction} ${order.symbol} ${order.mode}${order.limitPrice ? ' limit' : ''}`);
      const r = await bot.openPanelFromWeb(order);
      if (r.open) return send(409, { error: `You already have an open ${r.open.direction.toUpperCase()} on ${order.symbol} (${r.open.mode}) — manage it with /mpositions in Telegram.`, open: r.open });
      return send(200, { ok: true, panel: r.panel || null });
    }

    if (p === '/api/trade/positions') {
      if (req.method !== 'GET') return send(405, { error: 'GET only' });
      if (!posCache || Date.now() - posCache.at > 5000) posCache = { at: Date.now(), data: await bot.livePositionsForWeb() };
      return send(200, { ...posCache.data, at: posCache.at, webTrading: await bot.webTrade.isOn() });
    }

    return send(404, { error: 'unknown trade endpoint' });
  } catch (e) {
    logger.warn(`[WEB TRADE] ${url.pathname}: ${e.message}`);
    return send(e.code === 413 || e.code === 400 ? e.code : 500, { error: e.message });
  }
}

module.exports = { attach, handle, cleanOrder, cleanManage };
