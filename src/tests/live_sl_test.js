/**
 * Live SL test — opens a minimum-size DOGE long, verifies SL placement,
 * trails the SL, then closes the position. Uses real margin (~$1).
 *
 * Run: node src/tests/live_sl_test.js
 */
require('dotenv').config();
const ccxt = require('ccxt');
const crypto = require('crypto');
const TradeExecutor = require('../engine/tradeExecutor');

async function listAlgoOrders(exchange, symbol) {
  const qs = new URLSearchParams({ algoType: 'CONDITIONAL', timestamp: Date.now().toString(), recvWindow: '5000' }).toString();
  const sig = crypto.createHmac('sha256', exchange.secret).update(qs).digest('hex');
  const res = await fetch('https://fapi.binance.com/fapi/v1/openAlgoOrders?' + qs + '&signature=' + sig, { headers: { 'X-MBX-APIKEY': exchange.apiKey } });
  const orders = await res.json();
  if (!Array.isArray(orders)) return [];
  return symbol ? orders.filter(o => o.symbol === symbol) : orders;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    options: { defaultType: 'swap' },
    enableRateLimit: true,
  });
  await exchange.loadMarkets();

  const te = new TradeExecutor({ binance: exchange }, { mode: 'live' });
  const pair = 'DOGE/USDT:USDT';
  const market = exchange.market(pair);
  const ticker = await exchange.fetchTicker(pair);
  const price = ticker.last;

  console.log(`\nDOGE price: $${price}`);
  console.log(`Min notional: $5 → qty needed: ${Math.ceil(5 / price)} DOGE`);

  // Use minimum viable size — ~$5-6 notional at 5x leverage = ~$1 margin
  const qty = Math.ceil(6 / price);
  const roundedQty = exchange.amountToPrecision(pair, qty);
  const slPrice = exchange.priceToPrecision(pair, price * 0.92); // 8% below = safe from liq at 5x
  const leverage = 5;

  console.log(`\nTest plan:`);
  console.log(`  Open: LONG ${roundedQty} DOGE at ~$${price}`);
  console.log(`  Leverage: ${leverage}x`);
  console.log(`  Margin: ~$${(qty * price / leverage).toFixed(2)}`);
  console.log(`  Initial SL: $${slPrice} (-8%)`);
  console.log(`  Will trail SL up through 3 levels, then close\n`);

  // --- STEP 1: Set leverage + margin mode ---
  console.log('=== STEP 1: Set leverage & margin mode ===');
  try { await exchange.setMarginMode('isolated', pair); } catch (e) { /* already set */ }
  try { await exchange.setLeverage(leverage, pair); } catch (e) { /* already set */ }
  console.log(`  Leverage: ${leverage}x isolated ✓`);

  // --- STEP 2: Open position ---
  console.log('\n=== STEP 2: Open LONG position ===');
  const order = await exchange.createOrder(pair, 'market', 'buy', roundedQty, undefined, {});
  console.log(`  Order filled: ${order.filled} DOGE`);

  // Get fill price
  let entryFill = order.average || price;
  try {
    const settled = await exchange.fetchOrder(order.id, pair);
    if (settled.average > 0) entryFill = settled.average;
  } catch (e) {}
  console.log(`  Entry fill: $${entryFill}`);

  // Verify position exists (use v2 API — v1 is deprecated)
  const positions = await te._fetchPositions(exchange, 'binance', [pair]);
  const pos = positions.find(p => Math.abs(p.contracts || 0) > 0);
  if (!pos) { console.log('  ❌ No position found!'); process.exit(1); }
  console.log(`  Position: ${pos.side} ${Math.abs(pos.contracts)} DOGE, margin: $${parseFloat(pos.initialMargin || 0).toFixed(2)} ✓`);

  // --- STEP 3: Place SL via Algo API ---
  console.log('\n=== STEP 3: Place SL on Binance ===');
  const actualQty = exchange.amountToPrecision(pair, Math.abs(pos.contracts));
  await te.placeStopOrder(exchange, 'binance', pair, 'sell', actualQty, slPrice);

  await sleep(500);
  let algoOrders = await listAlgoOrders(exchange, market.id);
  if (algoOrders.length === 1) {
    console.log(`  SL on exchange: $${algoOrders[0].triggerPrice} (algoId: ${algoOrders[0].algoId}) ✓`);
  } else {
    console.log(`  ❌ Expected 1 algo order, got ${algoOrders.length}`);
  }

  // --- STEP 4: Trail SL up (simulate profit protection) ---
  const fakeTrade = {
    symbol: 'DOGE',
    exchange: 'binance',
    direction: 'long',
    quantity: parseFloat(actualQty),
    position_size: parseFloat(actualQty) * entryFill,
    entry_price: entryFill,
    mode: 'live',
  };

  const trailLevels = [
    { pct: 0.94, label: '-6% (trail up from -8%)' },
    { pct: 0.96, label: '-4% (trail higher)' },
    { pct: 0.98, label: '-2% (near breakeven)' },
  ];

  for (let i = 0; i < trailLevels.length; i++) {
    const level = trailLevels[i];
    const newSL = price * level.pct;
    console.log(`\n=== STEP ${4 + i}: Trail SL to $${newSL.toFixed(5)} ${level.label} ===`);
    await te.updateExchangeSL(fakeTrade, newSL);

    await sleep(500);
    algoOrders = await listAlgoOrders(exchange, market.id);
    if (algoOrders.length === 1) {
      console.log(`  SL on exchange: $${algoOrders[0].triggerPrice} ✓`);
      console.log(`  Old cancelled, new placed ✓`);
    } else {
      console.log(`  ❌ Expected 1, got ${algoOrders.length}: ${algoOrders.map(o => '$' + o.triggerPrice).join(', ')}`);
    }
  }

  // --- STEP 7: Close position ---
  console.log('\n=== STEP 7: Close position (market sell) ===');
  // Cancel algo orders first
  await te._binanceCancelAlgoOrders(exchange, market.id);

  const closeOrder = await exchange.createOrder(pair, 'market', 'sell', actualQty, undefined, { reduceOnly: true });
  let closePrice = closeOrder.average || closeOrder.price || price;
  try {
    const settled = await exchange.fetchOrder(closeOrder.id, pair);
    if (settled.average > 0) closePrice = settled.average;
  } catch (e) {}

  const pnl = (closePrice - entryFill) * parseFloat(actualQty);
  console.log(`  Closed at: $${closePrice}`);
  console.log(`  PnL: $${pnl.toFixed(4)}`);

  // Verify clean
  await sleep(500);
  const finalPos = await te._fetchPositions(exchange, 'binance', [pair]);
  const remaining = finalPos.find(p => Math.abs(p.contracts || 0) > 0);
  algoOrders = await listAlgoOrders(exchange, market.id);

  console.log('\n=== FINAL CHECK ===');
  console.log(`  Position: ${remaining ? '❌ STILL OPEN' : '✅ Closed'}`);
  console.log(`  Algo orders: ${algoOrders.length === 0 ? '✅ None' : '❌ ' + algoOrders.length + ' remaining'}`);
  console.log(`\n✅ Live SL test complete. Cost: ~$${Math.abs(pnl).toFixed(4)} in slippage/fees.`);

})().catch(e => {
  console.error('\n❌ FATAL:', e.message);
  console.error('If a position was opened, close it manually on Binance!');
  process.exit(1);
});
