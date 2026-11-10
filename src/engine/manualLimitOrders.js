// Real exchange limit entries for the /trade manual panel (live mode, Binance and Bybit).
//
// Before: a manual limit lived only in the bot. Once a 1m wick touched the price, the next minute check sent a
// MARKET order, so the fill could be well past the limit (AIOT 8 Nov: limit 0.15888, sold at 0.15626), and the
// TPs/SL stayed where they were computed from the limit price.
//
// Now a "resting" limit (long below market, short above market) is placed on the exchange order book at the user's
// price, so it fills there. The bot checks it every ~15 s; on a fill it places the stop first, then saves the trade
// and places the TP limits, all moved with the real fill price. Breakout entries (long above / short below market)
// can't rest as a plain limit and keep the old trigger → market path in telegramBot.
//
// Only the manual panel calls this module. It doesn't change tradeExecutor or any auto-trade path; it only uses the
// executor's existing helpers (leverage, liquidation guard, stop order, TP limits).
const db = require('../db/database');
const logger = require('../utils/logger');
const { escapeHtml } = require('../utils/formatting');
const { marginSaverLeverage, safeLeverage } = require('../utils/marginSaver');

const REAL_LIMIT_EXCHANGES = ['binance', 'bybit'];
const pairOf = (symbol) => `${symbol}/USDT:USDT`;
const fmtP = (v) => (v == null || !isFinite(v) ? '—' : Number(v).toPrecision(6));

// A plain limit rests on the book until price comes to it: buy below market, sell above market
function restsOnBook(direction, limitPrice, market) {
  return direction === 'long' ? limitPrice < market : limitPrice > market;
}

function wantsRealLimit(cfg, market) {
  return cfg.mode === 'live' && REAL_LIMIT_EXCHANGES.includes(cfg.exchangeId)
    && cfg.limitPrice > 0 && market > 0 && restsOnBook(cfg.direction, cfg.limitPrice, market);
}

async function openLiveTradesOn(symbol, exchangeId) {
  return (await db.getOpenTrades()).filter(t => t.symbol === symbol && t.exchange === exchangeId && t.mode === 'live');
}

// Set leverage (margin saver + liquidation guard, as for a manual market order) and place the limit on the exchange.
// Throws with a readable reason when the order can't be placed. Returns the fields to keep with the order.
async function placeEntryLimit(te, cfg) {
  const ex = te.exchanges[cfg.exchangeId];
  const pair = pairOf(cfg.symbol);
  if (!ex?.apiKey || !ex?.secret) throw new Error(`No API keys for ${cfg.exchangeId}`);
  if (!ex.markets?.[pair]) throw new Error(`${pair} not found on ${cfg.exchangeId}`);

  const busy = await openLiveTradesOn(cfg.symbol, cfg.exchangeId);
  if (busy.length) throw new Error(`There is already an open ${cfg.symbol} trade on ${cfg.exchangeId} (#${busy[0].id}) — one coin holds one position`);
  let positions;
  try { positions = await te._fetchPositions(ex, cfg.exchangeId, [pair]); } catch (e) {
    throw new Error(`Couldn't check your ${cfg.symbol} position on ${cfg.exchangeId}: ${e.message}`);
  }
  if (positions.some(p => Math.abs(parseFloat(p.contracts || 0)) > 0)) {
    throw new Error(`${cfg.exchangeId} already has a ${cfg.symbol} position — close it first`);
  }

  const slPct = (Math.abs(cfg.stopLoss - cfg.limitPrice) / cfg.limitPrice) * 100;
  const maxLev = ex.markets[pair]?.limits?.leverage?.max;
  const desired = cfg.marginSaver ? marginSaverLeverage(slPct, { chosen: cfg.leverage, maxLev }) : cfg.leverage;
  let leverage = await te.setLeverageWithFallback(ex, pair, desired);
  let positionSize = cfg.margin * cfg.leverage;

  // Liquidation guard: small caps carry 4–5% maintenance margin, so a high leverage can liquidate before the stop
  let liqGuard = null;
  let mmrPct = null;
  try { mmrPct = await te.maintMarginPct(ex, cfg.exchangeId, pair, positionSize); } catch (e) {
    logger.warn(`${pair}: maintenance margin lookup failed: ${e.message.slice(0, 100)}`);
  }
  const mmrUsed = mmrPct != null ? mmrPct : 5;
  const safe = safeLeverage(slPct, mmrUsed);
  if (safe && leverage > safe) {
    const from = leverage;
    leverage = await te.setLeverageWithFallback(ex, pair, safe);
    liqGuard = { mmrPct: mmrUsed, mmrKnown: mmrPct != null, from, to: leverage, slPct: +slPct.toFixed(2) };
  }

  // Scale down to the free balance (same rule as a market order); the exchange rejects it anyway if still too big
  try {
    const bal = (await te.getAllBalances())?.[cfg.exchangeId];
    const free = bal && !bal.error ? (bal.free || 0) : null;
    if (free != null && positionSize / leverage > free * 0.9) {
      const maxSize = free * 0.9 * leverage;
      if (maxSize < 5) throw new Error(`Not enough free margin on ${cfg.exchangeId}: $${free.toFixed(2)}`);
      positionSize = maxSize;
    }
  } catch (e) {
    if (/Not enough free margin/.test(e.message)) throw e;
    logger.warn(`${pair}: balance check failed: ${e.message}`);
  }

  const qty = positionSize / cfg.limitPrice;
  const check = te.calcMinNotional(ex, pair, qty, cfg.limitPrice);
  if (!check.ok) throw new Error(`$${check.currentNotional.toFixed(2)} is below the ${cfg.exchangeId} minimum order ($${check.minNotional})`);
  const amount = ex.amountToPrecision(pair, qty);
  const price = ex.priceToPrecision(pair, cfg.limitPrice);
  const side = cfg.direction === 'long' ? 'buy' : 'sell';
  const order = await ex.createOrder(pair, 'limit', side, amount, price);
  if (!order?.id) throw new Error('The exchange returned no order id');
  logger.info(`Manual limit on ${cfg.exchangeId}: ${side} ${amount} ${pair} @ ${price} (order ${order.id}, ${leverage}x)`);
  return {
    orderId: String(order.id), orderAmount: parseFloat(amount), exLeverage: leverage, liqGuard,
    positionSize: parseFloat(amount) * parseFloat(price),
  };
}

// { status: open | closed | canceled | expired | rejected, filled, average, amount } or null when unknown
async function entryOrderStatus(te, o) {
  const ex = te.exchanges[o.exchangeId];
  const pair = pairOf(o.symbol);
  if (o.exchangeId === 'bybit') {
    // ccxt's bybit.fetchOrder refuses unified accounts — use the v5 endpoints (realtime, then history)
    const req = { category: 'linear', symbol: ex.market(pair).id, orderId: o.orderId };
    let row = (await ex.privateGetV5OrderRealtime(req))?.result?.list?.[0];
    if (!row) row = (await ex.privateGetV5OrderHistory(req))?.result?.list?.[0];
    if (!row) return null;
    const s = row.orderStatus;
    const status = s === 'Filled' ? 'closed'
      : ['Cancelled', 'PartiallyFilledCanceled', 'Deactivated'].includes(s) ? 'canceled'
      : s === 'Rejected' ? 'rejected' : 'open';
    return { status, filled: parseFloat(row.cumExecQty || 0), average: parseFloat(row.avgPrice || 0) || null, amount: parseFloat(row.qty || 0) };
  }
  const ord = await ex.fetchOrder(o.orderId, pair);
  const filled = Number(ord.filled || 0);
  const average = ord.average > 0 ? ord.average : (ord.cost > 0 && filled > 0 ? ord.cost / filled : null);
  return { status: ord.status, filled, average, amount: Number(ord.amount || 0) };
}

// Cancel on the exchange (errors such as "already filled" are fine) and return the order's status afterwards
async function cancelEntryOrder(te, o) {
  const ex = te.exchanges[o.exchangeId];
  const pair = pairOf(o.symbol);
  try {
    if (o.exchangeId === 'bybit') await ex.privatePostV5OrderCancel({ category: 'linear', symbol: ex.market(pair).id, orderId: o.orderId });
    else await ex.cancelOrder(o.orderId, pair);
  } catch (e) {
    logger.info(`${pair}: cancel of entry limit ${o.orderId}: ${e.message.slice(0, 150)}`);
  }
  return entryOrderStatus(te, o).catch(e => { logger.warn(`${pair}: status after cancel failed: ${e.message}`); return null; });
}

// Turn a filled entry (st.filled > 0, order no longer open) into a protected trade.
async function adoptFill(te, o, st) {
  const ex = te.exchanges[o.exchangeId];
  const pair = pairOf(o.symbol);
  const isLong = o.direction === 'long';
  const closeSide = isLong ? 'sell' : 'buy';
  const fill = st.average > 0 ? st.average : o.limitPrice;
  const qtyStr = ex.amountToPrecision(pair, st.filled);
  const qty = parseFloat(qtyStr);
  const res = { fill, qty, partial: st.amount > 0 && st.filled < st.amount * 0.999 };

  const closeOurs = async (params) => {
    try { await ex.createOrder(pair, 'market', closeSide, qtyStr, undefined, params); return true; } catch (e) {
      logger.error(`${pair}: closing manual limit fill failed: ${e.message}`);
      res.closeError = e.message;
      return false;
    }
  };

  // Another live trade on this coin opened meanwhile: the exchange merged the positions. Trade our fill straight
  // back so that trade's position (and its stop/TP sizes) is exactly as it was.
  const others = await openLiveTradesOn(o.symbol, o.exchangeId);
  if (others.length) {
    res.other = others[0];
    res.undone = await closeOurs(others[0].direction === o.direction ? { reduceOnly: true } : {});
    return res;
  }
  if (!te.calcMinNotional(ex, pair, qty, fill).ok) {
    res.tooSmall = true;
    res.closed = await closeOurs({ reduceOnly: true });
    return res;
  }

  // Levels move with the fill (a sell limit can fill above its price when price was already there); a price the
  // user typed (SL / TP1) stays where they put it
  const k = fill / o.limitPrice;
  const lv = (v, fixed) => (v > 0 && !fixed ? v * k : v);
  const levels = { tp1: lv(o.tp1, o.tpFixed), tp2: lv(o.tp2, o.tpFixed), tp3: lv(o.tp3, o.tpFixed), tp4: lv(o.tp4, o.tpFixed), stopLoss: lv(o.stopLoss, o.slFixed) };
  res.levels = levels;
  if (isLong ? levels.stopLoss >= fill : levels.stopLoss <= fill) {
    res.pastStop = true;
    res.closed = await closeOurs({ reduceOnly: true });
    return res;
  }

  // Stop first — if it can't be placed, close at once (same rule as a market entry)
  try {
    await te.placeStopOrder(ex, o.exchangeId, pair, closeSide, qtyStr, ex.priceToPrecision(pair, levels.stopLoss));
  } catch (e) {
    res.stopFailed = e.message;
    res.closed = await closeOurs({ reduceOnly: true });
    return res;
  }

  const trade = {
    signalId: null, symbol: o.symbol, exchange: o.exchangeId, direction: o.direction, mode: 'live',
    entryPrice: fill, quantity: qty, positionSize: qty * fill, leverage: o.exLeverage || o.leverage,
    tp1: levels.tp1, tp2: levels.tp2, tp3: levels.tp3, tp4: levels.tp4,
    stopLoss: levels.stopLoss, originalStopLoss: levels.stopLoss, invalidation: levels.stopLoss, atr: o.atr || null,
    dcaQty2: 0, dcaQty3: 0, dcaPrice2: null, dcaPrice3: null, dcaStage: 3,
    orderId: o.orderId, status: 'open', source: te.settingsKey,
    onchainContext: {
      margin: o.margin, limitOrderId: o.id, limitPrice: o.limitPrice, exitStyle: o.exitStyle || 'tight',
      manual: true, chosenLeverage: o.leverage, marginSaver: o.marginSaver !== false,
      realLimit: true, entryOrderId: o.orderId, ...(o.liqGuard ? { liqGuard: o.liqGuard } : {}),
    },
  };
  try {
    const saved = await db.saveTrade(trade);
    trade.id = saved?.id;
  } catch (e) {
    res.saveFailed = e.message;
    return res;
  }
  await te.placeTPOrders(trade);
  res.trade = trade;
  logger.info(`Manual limit #${o.id} filled: ${o.direction} ${qty} ${pair} @ ${fill} → trade #${trade.id}`);
  return res;
}

function fillMessage(o, r, label) {
  const ex = o.exchangeId.toUpperCase();
  if (r.trade) {
    const t = r.trade;
    return `📍✅ <b>LIMIT ORDER FILLED</b> — ${escapeHtml(o.symbol)} (#${o.id})\n\n` +
      `${o.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} · 💰 LIVE · ${ex}\n` +
      `💰 Entry: <b>$${fmtP(t.entryPrice)}</b> (limit $${fmtP(o.limitPrice)})\n` +
      (r.partial ? `✂️ Partly filled — the rest was cancelled so the filled part got its stop at once\n` : '') +
      `💵 $${t.positionSize.toFixed(2)} at ${t.leverage}x\n` +
      `🎯 TP1 $${fmtP(t.tp1)} · TP2 $${fmtP(t.tp2)} · TP3 $${fmtP(t.tp3)} · TP4 $${fmtP(t.tp4)}\n` +
      `🛑 SL $${fmtP(t.stopLoss)}\n\n<i>Stop and TPs are set from the real fill price. Manage it in /mpositions.</i>`;
  }
  if (r.other) {
    return r.undone
      ? `⚠️ Limit order ${label} filled while trade #${r.other.id} was open on ${escapeHtml(o.symbol)} — the exchange merged them.\nThe bot traded your filled part straight back, so trade #${r.other.id} is as it was.`
      : `🚨 <b>CHECK ${escapeHtml(o.symbol)} ON ${ex} NOW</b>\n\nLimit order ${label} filled while trade #${r.other.id} was open — the exchange merged them and the bot could NOT trade your part back (${escapeHtml(r.closeError || '')}).`;
  }
  const why = r.tooSmall ? `only $${(r.qty * r.fill).toFixed(2)} filled — below the exchange minimum, so it can't carry a stop`
    : r.pastStop ? `it filled at $${fmtP(r.fill)}, already past your stop $${fmtP(r.levels?.stopLoss)}`
    : r.stopFailed ? `the stop order failed (${escapeHtml(r.stopFailed)})`
    : r.saveFailed ? null : `setup failed (${escapeHtml(r.error || 'unknown')})`;
  if (r.saveFailed) {
    return `🚨 <b>${escapeHtml(o.symbol)} filled on ${ex}</b> (limit ${label}) and the stop is placed, but the bot couldn't save the trade (${escapeHtml(r.saveFailed)}). It won't manage TPs — handle it on the exchange.`;
  }
  if (r.closed) return `⚠️ Limit order ${label} filled, but ${why} — the bot closed that part at market.`;
  return `🚨 <b>CHECK ${escapeHtml(o.symbol)} ON ${ex} NOW</b>\n\nLimit order ${label} filled, but ${why}, and the bot could not close it${r.closeError ? ` (${escapeHtml(r.closeError)})` : ''}. The position may have NO stop.`;
}

// One check of a resting exchange limit. finish(o, status) claims the order in the DB (false = someone else did);
// notify(html) messages the owner. Returns what happened (for logs/tests).
async function checkRealOrder(te, o, { finish, notify }) {
  if (o._busy) return 'busy';
  o._busy = true;
  try {
    const ex = o.exchangeId.toUpperCase();
    const label = `${o.direction.toUpperCase()} ${escapeHtml(o.symbol)} @ $${fmtP(o.limitPrice)} (#${o.id})`;
    let st = await entryOrderStatus(te, o).catch(e => { logger.warn(`Limit #${o.id} ${o.symbol} status: ${e.message}`); return null; });
    if (!st) {
      // Can't read it: past expiry, still try to take it off the book (the status check decides on the next pass)
      if (Date.now() > o.expiresAt) await cancelEntryOrder(te, o);
      return 'unknown';
    }

    if (!(st.filled > 0)) {
      if (['canceled', 'expired', 'rejected'].includes(st.status)) {
        if (await finish(o, 'cancelled')) await notify(`⚠️ Limit order ${label} was ${st.status} on ${ex} — nothing filled.`);
        return 'gone';
      }
      if (st.status !== 'open') return 'unknown';
      const conflict = (await openLiveTradesOn(o.symbol, o.exchangeId))[0];
      const expired = Date.now() > o.expiresAt;
      if (!conflict && !expired) return 'resting';
      st = await cancelEntryOrder(te, o);
      if (!st || st.status === 'open') return 'cancel-pending'; // try again on the next check
      if (!(st.filled > 0)) {
        if (await finish(o, expired && !conflict ? 'expired' : 'cancelled')) {
          await notify(expired && !conflict
            ? `⏰ Limit order expired and was removed from ${ex}: ${label}`
            : `⚠️ Limit order cancelled on ${ex}: ${label}\nTrade #${conflict.id} opened on ${escapeHtml(o.symbol)}, and one coin holds one position.`);
        }
        return expired && !conflict ? 'expired' : 'conflict';
      }
      // It filled while being cancelled — protect what filled
    } else if (st.status === 'open') {
      // Partly filled: cancel the rest so the filled part gets its stop now
      st = await cancelEntryOrder(te, o);
      if (!st || st.status === 'open') return 'cancel-pending';
    }

    if (!(await finish(o, 'filled'))) return 'claimed';
    let r;
    try { r = await adoptFill(te, o, st); } catch (e) { r = { error: e.message }; logger.error(`Limit #${o.id} ${o.symbol} adopt failed: ${e.message}`); }
    if (!r.trade) await db.query("UPDATE manual_orders SET status = 'failed' WHERE id = $1", [o.id]).catch(() => {});
    await notify(fillMessage(o, r, label));
    return r.trade ? 'filled' : 'fill-problem';
  } finally {
    o._busy = false;
  }
}

// Cancel asked by the user: 'cancelled' | 'filled' (it had filled — the next check sets it up) | 'failed' |
// 'busy' | 'gone' (another check already finished it)
async function cancelByUser(te, o, { finish }) {
  if (o._busy) return 'busy';
  o._busy = true;
  try {
    const st = await cancelEntryOrder(te, o);
    if (!st || st.status === 'open') return 'failed';
    if (st.filled > 0) return 'filled';
    return (await finish(o, 'cancelled')) ? 'cancelled' : 'gone';
  } finally {
    o._busy = false;
  }
}

module.exports = {
  REAL_LIMIT_EXCHANGES, restsOnBook, wantsRealLimit, placeEntryLimit, entryOrderStatus, cancelEntryOrder,
  adoptFill, checkRealOrder, cancelByUser, fillMessage,
};
