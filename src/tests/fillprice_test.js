#!/usr/bin/env node
/**
 * Fill price correction test — verifies that live trade closes use actual
 * exchange fill price (not ticker) for P&L, dailyPnL, and notifications.
 * Run: node src/tests/fillprice_test.js
 */

const assert = require('assert');

const closedTrades = [];
const dbUpdates = [];
let mockOpenTrades = [];

const mockDb = {
  getOpenTrades: async () => mockOpenTrades,
  closeTrade: async (id, exitPrice, pnlPct, pnlUsd, reason) => {
    closedTrades.push({ id, exitPrice, pnlPct, pnlUsd, reason });
  },
  updateTradePeakPrice: async () => {},
  updateTradeStopLoss: async () => {},
  updateTradeHit: async () => {},
  updateTradePartialClose: async () => {},
  query: async (sql, params) => {
    dbUpdates.push({ sql, params });
    return { rows: [] };
  },
  getTodayPnL: async () => 0,
  saveSettings: async () => {},
  loadSettings: async () => null,
};

// Inject mock DB before any require that touches it
const dbPath = require.resolve('../db/database');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: mockDb,
};

// Capture logger errors to surface hidden test failures
const loggerPath = require.resolve('../utils/logger');
const errors = [];
const origLogger = require(loggerPath);
require.cache[loggerPath].exports = {
  info: origLogger.info?.bind(origLogger) || console.log,
  warn: origLogger.warn?.bind(origLogger) || console.warn,
  debug: () => {},
  error: (...args) => { errors.push(args.join(' ')); console.log('  [ERROR]', ...args); },
};

const TradeExecutor = require('../engine/tradeExecutor');

function makeMockExchange(opts = {}) {
  const tickerPrice = opts.tickerPrice || 1.00;
  const fillPrice = opts.fillPrice || 0.98;
  const bid = opts.bid || tickerPrice * 0.999;
  const ask = opts.ask || tickerPrice * 1.001;

  const state = { positionClosed: false };

  return {
    id: opts.id || 'bybit',
    apiKey: 'test_key',
    markets: { 'TEST/USDT:USDT': { symbol: 'TEST/USDT:USDT' } },
    fetchTicker: async () => ({ last: tickerPrice, bid, ask }),
    fetchOHLCV: async () => [],
    fetchPositions: async () => {
      if (state.positionClosed) return [];
      const contracts = opts.contracts || 100;
      return [{ symbol: 'TEST/USDT:USDT', contracts, side: contracts > 0 ? 'long' : 'short', notional: Math.abs(contracts) }];
    },
    createOrder: async () => {
      state.positionClosed = true;
      return { average: fillPrice, price: fillPrice };
    },
    cancelAllOrders: async () => {},
    priceToPrecision: (sym, p) => Number(p).toFixed(6),
    loadMarkets: async () => {},
    _state: state,
    _closeCount: 0,
  };
}

function makeTrade(overrides = {}) {
  return {
    id: 1,
    symbol: 'TEST',
    exchange: 'bybit',
    direction: 'long',
    mode: 'live',
    entry_price: 1.00,
    stop_loss: 0.95,
    tp1: 1.05, tp2: 1.10, tp3: 1.15, tp4: 1.20,
    position_size: 1000,
    quantity: 100,
    leverage: 10,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    hit_tp1: false, hit_tp2: false, hit_tp3: false,
    peak_price: 1.00,
    atr: 0.02,
    source: 'onchain',
    invalidation: null,
    original_stop_loss: 0.95,
    dca_price_2: null, dca_price_3: null,
    dca_filled_2: false, dca_filled_3: false,
    ...overrides,
  };
}

function resetState() {
  closedTrades.length = 0;
  dbUpdates.length = 0;
  errors.length = 0;
}

async function testSLWithSlippage() {
  console.log('\n=== Test 1: SL exit with Bybit slippage ===');
  resetState();

  const tickerPrice = 0.94;
  const fillPrice = 0.935;
  const exchange = makeMockExchange({ tickerPrice, fillPrice, bid: 0.939, ask: 0.941 });

  const te = new TradeExecutor({ bybit: exchange }, {
    mode: 'live', settingsKey: 'test', maxLossPerTrade: 100,
    maxDailyLoss: 500, timeExitMinutes: 0, maxTradeAge: 999999999,
  });
  te.saveConfig = () => {};

  const trade = makeTrade({ stop_loss: 0.95, entry_price: 1.00, position_size: 1000 });
  mockOpenTrades = [trade];

  let notifiedMsg = '';
  te.notify = async (msg) => { notifiedMsg = msg; };

  const updates = await te.checkOpenTrades();

  if (errors.length > 0) console.log('  Caught errors:', errors);

  assert(updates.length === 1, `Should have 1 update, got ${updates.length}`);
  assert(updates[0].action === 'sl', `Action should be sl, got ${updates[0].action}`);
  assert(notifiedMsg.includes('Fill:'), 'Notification should show fill price comparison');

  const expectedPnlPct = ((fillPrice - 1.00) / 1.00) * 100;
  const rawPnlUsd = (expectedPnlPct / 100) * 1000;
  const fees = 1000 * 0.0011;
  const expectedPnlUsd = rawPnlUsd - fees;

  console.log(`  Entry: $1.00 | SL: $0.95`);
  console.log(`  Ticker bid: $0.939 | Actual fill: $${fillPrice}`);
  console.log(`  Expected P&L: $${expectedPnlUsd.toFixed(2)} | dailyPnL: $${te.dailyPnL.toFixed(2)}`);

  assert(Math.abs(te.dailyPnL - expectedPnlUsd) < 0.01,
    `dailyPnL should be ~$${expectedPnlUsd.toFixed(2)}, got $${te.dailyPnL.toFixed(2)}`);

  const dbFillUpdate = dbUpdates.find(u => u.sql.includes('close_price'));
  assert(dbFillUpdate, 'DB should be updated with actual fill price');

  console.log('  PASSED');
}

async function testTP4WithSlippage() {
  console.log('\n=== Test 2: TP4 exit with slippage ===');
  resetState();

  const tickerPrice = 1.22;
  const fillPrice = 1.215;
  const exchange = makeMockExchange({ tickerPrice, fillPrice, bid: 1.219, ask: 1.221 });

  const te = new TradeExecutor({ bybit: exchange }, {
    mode: 'live', settingsKey: 'test', maxLossPerTrade: 100,
    maxDailyLoss: 500, timeExitMinutes: 0, maxTradeAge: 999999999,
  });
  te.saveConfig = () => {};

  const trade = makeTrade({
    entry_price: 1.00, tp4: 1.20, position_size: 500,
    hit_tp1: true, hit_tp2: true, hit_tp3: true,
  });
  mockOpenTrades = [trade];

  let notifiedMsg = '';
  te.notify = async (msg) => { notifiedMsg = msg; };

  const updates = await te.checkOpenTrades();
  if (errors.length > 0) console.log('  Caught errors:', errors);

  assert(updates.length === 1, `Should have 1 update, got ${updates.length}`);
  assert(updates[0].action === 'tp4', `Action should be tp4, got ${updates[0].action}`);
  assert(notifiedMsg.includes('Fill:'), 'TP4 notification should show fill comparison');

  const expectedPnlPct = ((fillPrice - 1.00) / 1.00) * 100;
  const rawPnlUsd = (expectedPnlPct / 100) * 500;
  const fees = 500 * 0.0011;
  const expectedPnlUsd = rawPnlUsd - fees;

  console.log(`  Entry: $1.00 | TP4: $1.20 | Fill: $${fillPrice}`);
  console.log(`  Expected P&L: $${expectedPnlUsd.toFixed(2)} | dailyPnL: $${te.dailyPnL.toFixed(2)}`);

  assert(Math.abs(te.dailyPnL - expectedPnlUsd) < 0.01,
    `dailyPnL should be ~$${expectedPnlUsd.toFixed(2)}, got $${te.dailyPnL.toFixed(2)}`);

  console.log('  PASSED');
}

async function testMaxLossNoDoubleClose() {
  console.log('\n=== Test 3: max_loss no double close ===');
  resetState();

  const tickerPrice = 0.90;
  const fillPrice = 0.895;
  let closeCount = 0;

  const exchange = makeMockExchange({ tickerPrice, fillPrice, bid: 0.899, ask: 0.901 });
  const origCreate = exchange.createOrder;
  exchange.createOrder = async (...args) => { closeCount++; return origCreate(...args); };

  const te = new TradeExecutor({ bybit: exchange }, {
    mode: 'live', settingsKey: 'test', maxLossPerTrade: 6, lossBufferPct: 80,
    maxDailyLoss: 500, timeExitMinutes: 0, maxTradeAge: 999999999,
  });
  te.saveConfig = () => {};

  const trade = makeTrade({ entry_price: 1.00, stop_loss: 0.85, position_size: 100 });
  mockOpenTrades = [trade];

  let notifiedMsg = '';
  te.notify = async (msg) => { notifiedMsg = msg; };

  const updates = await te.checkOpenTrades();
  if (errors.length > 0) console.log('  Caught errors:', errors);

  assert(updates.length === 1, `Should have 1 update, got ${updates.length}`);
  assert(updates[0].action === 'max_loss', `Action should be max_loss, got ${updates[0].action}`);
  assert(closeCount === 1, `Exchange should be closed once, got ${closeCount}`);
  assert(notifiedMsg.includes('Fill:'), 'max_loss should show fill comparison');

  console.log(`  Exchange close called: ${closeCount} | dailyPnL: $${te.dailyPnL.toFixed(2)}`);
  console.log('  PASSED');
}

async function testPaperTradeNoCorrection() {
  console.log('\n=== Test 4: Paper trade skips fill correction ===');
  resetState();

  const exchange = makeMockExchange({ tickerPrice: 0.94, bid: 0.939, ask: 0.941 });

  const te = new TradeExecutor({ bybit: exchange }, {
    mode: 'paper', settingsKey: 'test', maxLossPerTrade: 100,
    maxDailyLoss: 500, timeExitMinutes: 0, maxTradeAge: 999999999,
  });
  te.saveConfig = () => {};

  const trade = makeTrade({ mode: 'paper', stop_loss: 0.95, entry_price: 1.00, position_size: 1000 });
  mockOpenTrades = [trade];

  let notifiedMsg = '';
  te.notify = async (msg) => { notifiedMsg = msg; };

  const updates = await te.checkOpenTrades();
  if (errors.length > 0) console.log('  Caught errors:', errors);

  assert(updates.length === 1, `Should have 1 update, got ${updates.length}`);
  assert(!notifiedMsg.includes('Fill:'), 'Paper trade should NOT show fill comparison');

  const expectedPnlPct = ((0.95 - 1.00) / 1.00) * 100;
  const expectedPnlUsd = (expectedPnlPct / 100) * 1000;

  console.log(`  dailyPnL: $${te.dailyPnL.toFixed(2)} (no fill correction, no fees)`);
  assert(Math.abs(te.dailyPnL - expectedPnlUsd) < 0.01,
    `Paper dailyPnL should be $${expectedPnlUsd.toFixed(2)}, got $${te.dailyPnL.toFixed(2)}`);

  console.log('  PASSED');
}

async function testShortSLWithSlippage() {
  console.log('\n=== Test 5: Short SL exit with Bybit slippage ===');
  resetState();

  const tickerPrice = 1.06;
  const fillPrice = 1.065;
  const exchange = makeMockExchange({ tickerPrice, fillPrice, bid: 1.059, ask: 1.061, contracts: -100 });

  const te = new TradeExecutor({ bybit: exchange }, {
    mode: 'live', settingsKey: 'test', maxLossPerTrade: 100,
    maxDailyLoss: 500, timeExitMinutes: 0, maxTradeAge: 999999999,
  });
  te.saveConfig = () => {};

  // Short trade: TPs must be BELOW entry, SL above
  const trade = makeTrade({
    direction: 'short',
    entry_price: 1.00,
    stop_loss: 1.05,
    tp1: 0.95, tp2: 0.90, tp3: 0.85, tp4: 0.80,
    position_size: 1000,
  });
  mockOpenTrades = [trade];

  let notifiedMsg = '';
  te.notify = async (msg) => { notifiedMsg = msg; };

  const updates = await te.checkOpenTrades();
  if (errors.length > 0) console.log('  Caught errors:', errors);

  assert(updates.length === 1, `Should have 1 update, got ${updates.length}`);
  assert(updates[0].action === 'sl', `Action should be sl, got ${updates[0].action}`);

  const expectedPnlPct = ((1.00 - fillPrice) / 1.00) * 100;
  const rawPnlUsd = (expectedPnlPct / 100) * 1000;
  const fees = 1000 * 0.0011;
  const expectedPnlUsd = rawPnlUsd - fees;

  console.log(`  Entry: $1.00 | SL: $1.05 (short) | Fill: $${fillPrice}`);
  console.log(`  Expected P&L: $${expectedPnlUsd.toFixed(2)} | dailyPnL: $${te.dailyPnL.toFixed(2)}`);

  assert(Math.abs(te.dailyPnL - expectedPnlUsd) < 0.01,
    `dailyPnL should be ~$${expectedPnlUsd.toFixed(2)}, got $${te.dailyPnL.toFixed(2)}`);

  console.log('  PASSED');
}

async function main() {
  console.log('Fill Price Correction Test Suite');
  console.log('================================');

  let passed = 0, failed = 0;
  const tests = [
    testSLWithSlippage,
    testTP4WithSlippage,
    testMaxLossNoDoubleClose,
    testPaperTradeNoCorrection,
    testShortSLWithSlippage,
  ];

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  FAILED: ${err.message}`);
    }
  }

  console.log(`\n================================`);
  console.log(`Results: ${passed}/${tests.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Runner error:', err); process.exit(1); });
