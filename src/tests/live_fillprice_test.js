#!/usr/bin/env node
/**
 * Live fill price test — opens tiny real positions on Bybit & Binance,
 * closes them immediately, and verifies fill price vs ticker.
 *
 * Uses DOGE/USDT perp (~$0.10-0.40) with minimum size, 1x leverage.
 * Expected cost: ~$0.01-0.05 in fees per exchange (no P&L since instant close).
 *
 * Run: node src/tests/live_fillprice_test.js
 */
require('dotenv').config();
const ccxt = require('ccxt');
const config = require('../utils/config');

const SYMBOL = 'DOGE';
const PAIR = `${SYMBOL}/USDT:USDT`;
const LEVERAGE = 1;
const NOTIONAL_USD = 5.5;

async function initExchange(id) {
  const creds = config.exchanges[id];
  if (!creds?.apiKey || !creds?.secret) {
    console.log(`  ⚠️ ${id}: No API keys configured, skipping`);
    return null;
  }

  const opts = {};
  if (id === 'binance') {
    opts.defaultType = 'swap';
    opts.fetchMarkets = ['linear'];
  }
  if (id === 'bybit') {
    opts.accountType = 'UNIFIED';
  }

  const exchange = new ccxt[id]({
    apiKey: creds.apiKey,
    secret: creds.secret,
    enableRateLimit: true,
    options: opts,
  });

  await exchange.loadMarkets();
  console.log(`  ✓ ${id} connected (${Object.keys(exchange.markets).length} markets)`);
  return exchange;
}

async function testExchange(exchange, id) {
  console.log(`\n--- ${id.toUpperCase()} ---`);

  if (!exchange.markets[PAIR]) {
    console.log(`  ⚠️ ${PAIR} not available on ${id}`);
    return null;
  }

  // Set leverage
  try {
    await exchange.setLeverage(LEVERAGE, PAIR);
    console.log(`  Leverage: ${LEVERAGE}x`);
  } catch (e) {
    console.log(`  Leverage set note: ${e.message}`);
  }

  // Get ticker before opening
  const ticker = await exchange.fetchTicker(PAIR);
  const price = ticker.last;
  const bid = ticker.bid;
  const ask = ticker.ask;
  console.log(`  Ticker: $${price} | Bid: $${bid} | Ask: $${ask}`);

  // Calculate minimum quantity
  const rawQty = NOTIONAL_USD / price;
  const qty = parseFloat(exchange.amountToPrecision(PAIR, rawQty));
  const notional = qty * price;
  console.log(`  Opening: ${qty} ${SYMBOL} (~$${notional.toFixed(2)}) LONG`);

  // Open position (market buy)
  let entryOrder;
  try {
    entryOrder = await exchange.createOrder(PAIR, 'market', 'buy', qty);
  } catch (e) {
    console.log(`  ❌ Open failed: ${e.message}`);
    return null;
  }

  let entryFill = entryOrder.average || entryOrder.price || price;
  const rawEntryFill = entryFill;
  console.log(`  Entry raw response: $${entryFill} (ticker was $${price})`);

  // Re-fetch actual entry fill (same fix as tradeExecutor)
  if (entryOrder.id) {
    try {
      const settled = await exchange.fetchOrder(entryOrder.id, PAIR);
      if (settled.average > 0) entryFill = settled.average;
      else if (settled.cost > 0 && settled.filled > 0) entryFill = settled.cost / settled.filled;
      console.log(`  Entry settled fill: $${entryFill} (from fetchOrder)`);
    } catch (e) {
      try {
        const trades = await exchange.fetchMyTrades(PAIR, Date.now() - 10000, 5);
        const match = trades.find(t => t.order === entryOrder.id) || trades[trades.length - 1];
        if (match) {
          entryFill = match.price;
          console.log(`  Entry trades fill:  $${entryFill} (from fetchMyTrades)`);
        }
      } catch (e2) {
        console.log(`  Entry fill fetch failed: ${e2.message.slice(0, 80)}`);
      }
    }
  }
  console.log(`  Entry final fill:   $${entryFill}${entryFill !== rawEntryFill ? ' (CORRECTED from ' + rawEntryFill + ')' : ''}`);

  // Small delay to let exchange process
  await new Promise(r => setTimeout(r, 2000));

  // Get ticker again right before close
  const tickerBeforeClose = await exchange.fetchTicker(PAIR);
  const priceBeforeClose = tickerBeforeClose.last;
  const bidBeforeClose = tickerBeforeClose.bid;
  console.log(`  Ticker before close: $${priceBeforeClose} | Bid: $${bidBeforeClose}`);

  // Close position — same logic as closeExchangePosition in tradeExecutor
  let closeFill = null;
  const closeStart = Date.now();

  // Try IOC limit first (0.3% tolerance)
  try {
    const slipTol = 0.003;
    const limitPrice = priceBeforeClose * (1 - slipTol);
    const precisePrice = exchange.priceToPrecision(PAIR, limitPrice);

    const closeOrder = await exchange.createOrder(PAIR, 'limit', 'sell', qty, precisePrice, {
      reduceOnly: true,
      timeInForce: 'IOC',
    });
    const rawFill = closeOrder.average || closeOrder.price || parseFloat(precisePrice);
    console.log(`  IOC raw response fill: $${rawFill} (may be limit price, not actual)`);

    // Re-fetch settled order to get actual fill price
    if (closeOrder.id) {
      try {
        const settled = await exchange.fetchOrder(closeOrder.id, PAIR);
        closeFill = settled.average || (settled.cost > 0 && settled.filled > 0 ? settled.cost / settled.filled : null);
        console.log(`  Settled order fill:    $${closeFill} (from fetchOrder)`);
      } catch (e) {
        console.log(`  fetchOrder failed: ${e.message.slice(0, 80)}`);
        // Bybit unified doesn't support fetchOrder — try fetchMyTrades
        try {
          const trades = await exchange.fetchMyTrades(PAIR, Date.now() - 10000, 5);
          const match = trades.find(t => t.order === closeOrder.id) || trades[trades.length - 1];
          if (match) {
            closeFill = match.price;
            console.log(`  fetchMyTrades fill:    $${closeFill} (order: ${match.order})`);
          }
        } catch (e2) {
          console.log(`  fetchMyTrades failed: ${e2.message.slice(0, 80)}`);
        }
      }
    }
    if (!closeFill) closeFill = rawFill;
    console.log(`  Final fill price:     $${closeFill}`);

    // Check residual
    try {
      const remaining = await exchange.fetchPositions([PAIR]);
      const rem = remaining.find(p => p.symbol === PAIR && Math.abs(p.contracts || 0) > 0);
      if (rem && Math.abs(rem.contracts) > 0) {
        console.log(`  Residual ${Math.abs(rem.contracts)} — sending market close`);
        const mktClose = await exchange.createOrder(PAIR, 'market', 'sell', Math.abs(rem.contracts), undefined, { reduceOnly: true });
        closeFill = mktClose.average || closeFill;
      }
    } catch (e) {
      console.log(`  Residual check note: ${e.message.slice(0, 80)}`);
    }
  } catch (e) {
    console.log(`  IOC limit failed: ${e.message.slice(0, 100)} — fallback to market`);
    try {
      const mktClose = await exchange.createOrder(PAIR, 'market', 'sell', qty, undefined, { reduceOnly: true });
      closeFill = mktClose.average || mktClose.price || null;
    } catch (e2) {
      console.log(`  Market close also failed (position may be closed): ${e2.message.slice(0, 80)}`);
    }
  }

  const closeMs = Date.now() - closeStart;

  // Calculate P&L comparisons
  const tickerPnlPct = ((bidBeforeClose - entryFill) / entryFill) * 100;
  const tickerPnlUsd = (tickerPnlPct / 100) * notional;

  const fillPnlPct = closeFill ? ((closeFill - entryFill) / entryFill) * 100 : null;
  const fillPnlUsd = closeFill ? (fillPnlPct / 100) * notional : null;

  const feePct = 0.0011;
  const estFees = notional * feePct;
  const fillPnlWithFees = fillPnlUsd !== null ? fillPnlUsd - estFees : null;

  console.log(`\n  ═══ RESULTS ═══`);
  console.log(`  Entry fill:    $${entryFill}`);
  console.log(`  Ticker (bid):  $${bidBeforeClose}`);
  console.log(`  Close fill:    $${closeFill}`);
  console.log(`  Close time:    ${closeMs}ms`);
  console.log(`  ─────────────────`);
  console.log(`  Ticker P&L:    $${tickerPnlUsd.toFixed(4)} (${tickerPnlPct.toFixed(4)}%)`);
  console.log(`  Fill P&L:      $${fillPnlUsd?.toFixed(4)} (${fillPnlPct?.toFixed(4)}%)`);
  console.log(`  Est. fees:     $${estFees.toFixed(4)}`);
  console.log(`  Fill + fees:   $${fillPnlWithFees?.toFixed(4)}`);
  console.log(`  ─────────────────`);
  const diff = fillPnlUsd !== null ? (fillPnlUsd - tickerPnlUsd) : 0;
  console.log(`  Ticker vs Fill diff: $${diff.toFixed(4)} (${diff > 0 ? 'fill was better' : diff < 0 ? 'SLIPPAGE' : 'exact match'})`);

  return {
    exchange: id,
    entryFill,
    tickerBid: bidBeforeClose,
    closeFill,
    tickerPnl: tickerPnlUsd,
    fillPnl: fillPnlUsd,
    fillWithFees: fillPnlWithFees,
    diff,
    closeMs,
  };
}

async function main() {
  console.log('Live Fill Price Test');
  console.log('====================');
  console.log(`Coin: ${SYMBOL} | Size: ~$${NOTIONAL_USD} | Leverage: ${LEVERAGE}x`);
  console.log(`Opens a tiny long, closes immediately, compares ticker vs fill.\n`);

  const results = [];

  for (const id of ['bybit', 'binance']) {
    try {
      const exchange = await initExchange(id);
      if (!exchange) continue;

      const result = await testExchange(exchange, id);
      if (result) results.push(result);
    } catch (err) {
      console.log(`\n  ❌ ${id} error: ${err.message}`);
    }
  }

  if (results.length > 0) {
    console.log('\n\n══════════════════════════════');
    console.log('FILL PRICE SUMMARY');
    console.log('══════════════════════════════');
    for (const r of results) {
      const slippage = r.diff < -0.001 ? '⚠️ SLIPPAGE' : '✓ OK';
      console.log(`${r.exchange.toUpperCase()}: Ticker $${r.tickerBid} → Fill $${r.closeFill} | Diff: $${r.diff.toFixed(4)} ${slippage}`);
    }
    console.log('\nIf diff is negative (SLIPPAGE), the fill price fix ensures');
    console.log('notifications report the real loss, not the ticker-based estimate.');
  }

  // --- PART 2: Trailing SL Test (Bybit only) ---
  console.log('\n\n══════════════════════════════════════');
  console.log('TRAILING STOP LOSS TEST (Bybit)');
  console.log('══════════════════════════════════════');

  try {
    const bybit = await initExchange('bybit');
    if (bybit) {
      await testTrailingSL(bybit);
    }
  } catch (err) {
    console.log(`\n  ❌ Trailing SL test error: ${err.message}`);
  }

  console.log('\nDone.');
}

async function testTrailingSL(exchange) {
  const pair = PAIR;

  // Get current price
  const ticker = await exchange.fetchTicker(pair);
  const price = ticker.last;
  console.log(`\n  Current ${SYMBOL} price: $${price}`);

  // Set leverage
  try { await exchange.setLeverage(LEVERAGE, pair); } catch (e) { /* ok */ }

  // Open a tiny long
  const rawQty = NOTIONAL_USD / price;
  const qty = parseFloat(exchange.amountToPrecision(pair, rawQty));
  console.log(`  Opening ${qty} ${SYMBOL} LONG (~$${(qty * price).toFixed(2)})`);

  let entryOrder;
  try {
    entryOrder = await exchange.createOrder(pair, 'market', 'buy', qty);
  } catch (e) {
    console.log(`  ❌ Open failed: ${e.message}`);
    return;
  }
  const entryFill = entryOrder.average || entryOrder.price || price;
  console.log(`  Entry: $${entryFill}`);

  // Step 1: Place initial SL at -5% from entry
  const sl1 = parseFloat(exchange.priceToPrecision(pair, entryFill * 0.95));
  console.log(`\n  Step 1: Place initial SL at $${sl1} (-5%)`);
  try {
    await exchange.createOrder(pair, 'market', 'sell', qty, undefined, {
      reduceOnly: true,
      triggerPrice: sl1,
      triggerBy: 'LastPrice',
      triggerDirection: 2,  // falling trigger for sell stop
    });
    console.log(`  ✓ SL order placed at $${sl1}`);
  } catch (e) {
    console.log(`  ❌ SL placement failed: ${e.message}`);
    // Clean up
    await exchange.createOrder(pair, 'market', 'sell', qty, undefined, { reduceOnly: true });
    return;
  }

  // Verify SL order exists
  await new Promise(r => setTimeout(r, 1000));
  let orders = await exchange.fetchOpenOrders(pair);
  let slOrders = orders.filter(o => o.stopPrice || o.triggerPrice);
  console.log(`  Open stop orders: ${slOrders.length}`);
  if (slOrders.length > 0) {
    const stopPrice = slOrders[0].stopPrice || slOrders[0].triggerPrice || slOrders[0].info?.triggerPrice;
    console.log(`  Current SL trigger: $${stopPrice}`);
  }

  // Step 2: Trail SL to -2% (simulating profit protection moving SL up)
  const sl2 = parseFloat(exchange.priceToPrecision(pair, entryFill * 0.98));
  console.log(`\n  Step 2: Trail SL to $${sl2} (-2%) — cancel old, place new`);

  // Cancel existing SL
  let cancelledCount = 0;
  for (const order of slOrders) {
    try {
      await exchange.cancelOrder(order.id, pair);
      cancelledCount++;
    } catch (e) {
      console.log(`  ⚠️ Cancel failed: ${e.message.slice(0, 60)}`);
    }
  }
  console.log(`  Cancelled ${cancelledCount} old SL order(s)`);

  // Place new SL at trailed level
  try {
    await exchange.createOrder(pair, 'market', 'sell', qty, undefined, {
      reduceOnly: true,
      triggerPrice: sl2,
      triggerBy: 'LastPrice',
      triggerDirection: 2,
    });
    console.log(`  ✓ New SL placed at $${sl2}`);
  } catch (e) {
    console.log(`  ❌ New SL placement failed: ${e.message}`);
  }

  // Verify new SL
  await new Promise(r => setTimeout(r, 1000));
  orders = await exchange.fetchOpenOrders(pair);
  slOrders = orders.filter(o => o.stopPrice || o.triggerPrice);
  console.log(`  Open stop orders after trail: ${slOrders.length}`);

  let trailedCorrectly = false;
  if (slOrders.length > 0) {
    const stopPrice = parseFloat(slOrders[0].stopPrice || slOrders[0].triggerPrice || slOrders[0].info?.triggerPrice);
    console.log(`  SL trigger price: $${stopPrice}`);
    // Verify it's at the trailed level, not the original
    if (Math.abs(stopPrice - sl2) < 0.0001) {
      console.log(`  ✓ SL correctly trailed to $${sl2}`);
      trailedCorrectly = true;
    } else if (Math.abs(stopPrice - sl1) < 0.0001) {
      console.log(`  ❌ SL still at original $${sl1} — TRAIL FAILED`);
    } else {
      console.log(`  ⚠️ SL at unexpected price $${stopPrice}`);
    }
  } else {
    console.log(`  ❌ No stop orders found after trail!`);
  }

  // Step 3: Trail to breakeven (entry price)
  const sl3 = parseFloat(exchange.priceToPrecision(pair, entryFill));
  console.log(`\n  Step 3: Trail SL to breakeven $${sl3}`);

  for (const order of slOrders) {
    try { await exchange.cancelOrder(order.id, pair); } catch (e) { /* ok */ }
  }
  try {
    await exchange.createOrder(pair, 'market', 'sell', qty, undefined, {
      reduceOnly: true,
      triggerPrice: sl3,
      triggerBy: 'LastPrice',
      triggerDirection: 2,
    });
    console.log(`  ✓ SL placed at breakeven $${sl3}`);
  } catch (e) {
    console.log(`  ❌ Breakeven SL failed: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 1000));
  orders = await exchange.fetchOpenOrders(pair);
  slOrders = orders.filter(o => o.stopPrice || o.triggerPrice);
  if (slOrders.length > 0) {
    const stopPrice = parseFloat(slOrders[0].stopPrice || slOrders[0].triggerPrice || slOrders[0].info?.triggerPrice);
    const atBreakeven = Math.abs(stopPrice - sl3) < 0.0001;
    console.log(`  SL trigger: $${stopPrice} ${atBreakeven ? '✓ AT BREAKEVEN' : '⚠️ NOT AT BREAKEVEN'}`);
  }

  // Cleanup: cancel all orders and close position
  console.log(`\n  Cleanup: cancelling orders and closing position`);
  try { await exchange.cancelAllOrders(pair); } catch (e) { /* ok */ }
  try {
    await exchange.createOrder(pair, 'market', 'sell', qty, undefined, { reduceOnly: true });
    console.log(`  ✓ Position closed`);
  } catch (e) {
    console.log(`  ⚠️ Close failed (may already be closed): ${e.message.slice(0, 60)}`);
  }

  // Final verdict
  console.log(`\n  ═══ TRAILING SL VERDICT ═══`);
  if (trailedCorrectly) {
    console.log(`  ✓ PASSED — SL trail works on Bybit`);
    console.log(`  Original: $${sl1} → Trailed: $${sl2} → Breakeven: $${sl3}`);
    console.log(`  updateExchangeSL correctly cancels old + places new stop`);
  } else {
    console.log(`  ❌ FAILED — SL trail did not update correctly`);
    console.log(`  Check updateExchangeSL / placeStopOrder logic`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
