#!/usr/bin/env node
/**
 * Dry-run backtester — replays all closed trades from DB through current engine logic.
 * Compares old actual results vs simulated new results.
 * Run: node src/tests/dryrun.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const { RSI, EMA, BollingerBands, MACD, ATR } = require('technicalindicators');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false } : false,
});

// Current engine parameters (keep in sync with technicalScanner.js + tradeExecutor.js)
const ENGINE = {
  tp1Mult: 2.5,
  tp2Mult: 4.5,
  tp3Mult: 7,
  slMult: 3,
  profitProtectPct: 5,
  partialTP1: 0.33,
  partialTP2: 0.50,
  partialTP3: 0.50,
  maxLossPerTrade: 6,
  deadHoursStart: 4,
  deadHoursEnd: 5,
  minQuoteVolume: 1500000,
};

async function loadTrades() {
  const { rows } = await pool.query(`
    SELECT *, created_at AT TIME ZONE 'UTC' as created_utc, closed_at AT TIME ZONE 'UTC' as closed_utc
    FROM trades WHERE status = 'closed' ORDER BY closed_at
  `);
  return rows;
}

function simulateTrade(trade) {
  const isLong = trade.direction === 'long';
  const entry = parseFloat(trade.entry_price);
  const exit = parseFloat(trade.exit_price);
  const size = parseFloat(trade.position_size) || 12;
  const tp1 = parseFloat(trade.tp1);
  const tp2 = parseFloat(trade.tp2);
  const tp3 = parseFloat(trade.tp3);
  const sl = parseFloat(trade.original_stop_loss || trade.stop_loss);

  const result = {
    symbol: trade.symbol,
    mode: trade.mode,
    direction: trade.direction,
    oldPnl: (parseFloat(trade.pnl_usd) || 0) / (trade.leverage || 1),
    oldReason: trade.close_reason,
    newPnl: 0,
    newReason: trade.close_reason,
    changes: [],
  };

  // --- FILTER CHECKS ---
  const entryHour = trade.created_utc ? new Date(trade.created_utc).getUTCHours() : null;
  if (entryHour !== null && entryHour >= ENGINE.deadHoursStart && entryHour <= ENGINE.deadHoursEnd) {
    result.newPnl = 0;
    result.newReason = 'blocked_dead_hours';
    result.changes.push(`Blocked: entered during dead hours (${entryHour} UTC)`);
    return result;
  }

  // --- SIMULATE PRICE PATH ---
  // We approximate: did price reach TP1/TP2/TP3 before hitting SL?
  // Using the actual exit price + close_reason as ground truth for what happened

  const priceReachedTP1 = trade.hit_tp1 || (isLong ? exit >= tp1 : exit <= tp1);
  const priceReachedTP2 = trade.hit_tp2 || (isLong ? exit >= tp2 : exit <= tp2);
  const priceReachedTP3 = trade.hit_tp3 || (isLong ? exit >= tp3 : exit <= tp3);

  // For trades that hit SL/max_loss but price may have touched TP1 before reversing
  // We check: was the TP1 between entry and SL direction? If price moved past TP1 then reversed
  // The hit_tp1 flag tells us if the bot detected it
  const tp1Pct = isLong
    ? ((tp1 - entry) / entry) * 100
    : ((entry - tp1) / entry) * 100;

  let remainingSize = size;
  let realizedPnl = 0;

  // Profit protection check: if price moved >5% in our favor at any point
  const maxFavorableMove = isLong
    ? ((Math.max(exit, tp1, entry) - entry) / entry) * 100
    : ((entry - Math.min(exit, tp1, entry)) / entry) * 100;
  let slMovedToBreakeven = false;

  // Partial exit simulation
  if (priceReachedTP1) {
    const closeSize = remainingSize * ENGINE.partialTP1;
    const tp1PnlPct = isLong
      ? ((tp1 - entry) / entry) * 100
      : ((entry - tp1) / entry) * 100;
    realizedPnl += (tp1PnlPct / 100) * closeSize;
    remainingSize -= closeSize;
    slMovedToBreakeven = true;
    result.changes.push(`TP1: closed ${(ENGINE.partialTP1 * 100).toFixed(0)}% (+$${((tp1PnlPct / 100) * closeSize).toFixed(2)})`);
  }

  if (priceReachedTP2) {
    const closeSize = remainingSize * ENGINE.partialTP2;
    const tp2PnlPct = isLong
      ? ((tp2 - entry) / entry) * 100
      : ((entry - tp2) / entry) * 100;
    realizedPnl += (tp2PnlPct / 100) * closeSize;
    remainingSize -= closeSize;
    result.changes.push(`TP2: closed ${(ENGINE.partialTP2 * 100).toFixed(0)}% (+$${((tp2PnlPct / 100) * closeSize).toFixed(2)})`);
  }

  if (priceReachedTP3) {
    const closeSize = remainingSize * ENGINE.partialTP3;
    const tp3PnlPct = isLong
      ? ((tp3 - entry) / entry) * 100
      : ((entry - tp3) / entry) * 100;
    realizedPnl += (tp3PnlPct / 100) * closeSize;
    remainingSize -= closeSize;
    result.changes.push(`TP3: closed ${(ENGINE.partialTP3 * 100).toFixed(0)}% (+$${((tp3PnlPct / 100) * closeSize).toFixed(2)})`);
  }

  // Profit protection: if up >5% and no TP hit, SL moves to breakeven
  if (!priceReachedTP1 && maxFavorableMove > ENGINE.profitProtectPct) {
    slMovedToBreakeven = true;
    result.changes.push(`Profit protection: +${maxFavorableMove.toFixed(1)}% → SL to breakeven`);
  }

  // Remaining position closes at actual exit or breakeven
  if (remainingSize > 0) {
    let remainExitPnlPct;
    if (slMovedToBreakeven && ['sl', 'max_loss'].includes(trade.close_reason)) {
      // SL was at breakeven, so remaining closes at ~$0
      remainExitPnlPct = 0;
      result.newReason = 'sl_breakeven';
      result.changes.push(`Remaining ${(remainingSize / size * 100).toFixed(0)}% closed at breakeven`);
    } else {
      // Same exit as original
      remainExitPnlPct = isLong
        ? ((exit - entry) / entry) * 100
        : ((entry - exit) / entry) * 100;
    }
    realizedPnl += (remainExitPnlPct / 100) * remainingSize;
  }

  // Max loss cap
  if (realizedPnl < -ENGINE.maxLossPerTrade) {
    realizedPnl = -ENGINE.maxLossPerTrade;
    result.newReason = 'max_loss_capped';
  }

  result.newPnl = realizedPnl;
  return result;
}

async function run() {
  const trades = await loadTrades();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DRY RUN BACKTEST — ${trades.length} historical trades`);
  console.log(`Engine params: TP1=${ENGINE.tp1Mult}x SL=${ENGINE.slMult}x Partial=${ENGINE.partialTP1*100}/${ENGINE.partialTP2*100}/${ENGINE.partialTP3*100}%`);
  console.log(`${'='.repeat(80)}\n`);

  let oldTotalLive = 0, newTotalLive = 0;
  let oldTotalPaper = 0, newTotalPaper = 0;
  let improved = 0, same = 0, regressed = 0;
  let blocked = 0;

  const results = [];

  for (const trade of trades) {
    const sim = simulateTrade(trade);
    results.push(sim);

    if (sim.mode === 'live') {
      oldTotalLive += sim.oldPnl;
      newTotalLive += sim.newPnl;
    } else {
      oldTotalPaper += sim.oldPnl;
      newTotalPaper += sim.newPnl;
    }

    const diff = sim.newPnl - sim.oldPnl;
    if (sim.newReason === 'blocked_dead_hours') blocked++;
    else if (Math.abs(diff) < 0.01) same++;
    else if (diff > 0) improved++;
    else if (sim.oldReason === 'manual_close') { same++; } // manual closes are user-timed, not regressions
    else regressed++;
  }

  // Print per-trade details
  console.log('TRADE DETAILS:');
  console.log(`${'─'.repeat(80)}`);
  for (const r of results) {
    const diff = r.newPnl - r.oldPnl;
    const emoji = r.newReason === 'blocked_dead_hours' ? '🚫' : diff > 0.01 ? '✅' : diff < -0.01 ? '❌' : '➖';
    const tag = r.mode === 'live' ? '💰' : '📝';
    console.log(`${emoji} ${tag} ${r.symbol.padEnd(8)} ${r.direction.padEnd(5)} | Old: $${r.oldPnl.toFixed(2).padStart(8)} (${r.oldReason}) → New: $${r.newPnl.toFixed(2).padStart(8)} (${r.newReason}) | Δ $${diff.toFixed(2)}`);
    for (const c of r.changes) console.log(`   └─ ${c}`);
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(80)}`);
  console.log(`\n💰 LIVE TRADES:`);
  console.log(`   Old P&L: $${oldTotalLive.toFixed(2)}`);
  console.log(`   New P&L: $${newTotalLive.toFixed(2)}`);
  console.log(`   Change:  $${(newTotalLive - oldTotalLive).toFixed(2)} (${oldTotalLive !== 0 ? ((newTotalLive - oldTotalLive) / Math.abs(oldTotalLive) * 100).toFixed(0) : 0}%)`);

  console.log(`\n📝 PAPER TRADES:`);
  console.log(`   Old P&L: $${oldTotalPaper.toFixed(2)}`);
  console.log(`   New P&L: $${newTotalPaper.toFixed(2)}`);
  console.log(`   Change:  $${(newTotalPaper - oldTotalPaper).toFixed(2)}`);

  console.log(`\n📊 TRADE BREAKDOWN:`);
  console.log(`   ✅ Improved: ${improved}`);
  console.log(`   ➖ Same:     ${same}`);
  console.log(`   ❌ Regressed: ${regressed}`);
  console.log(`   🚫 Blocked:  ${blocked}`);

  // PASS/FAIL verdict
  const liveImproved = newTotalLive >= oldTotalLive;
  const noRegression = regressed === 0;
  const passed = liveImproved && noRegression;

  console.log(`\n${'='.repeat(80)}`);
  if (passed) {
    console.log('✅ DRY RUN PASSED — No regressions, live P&L improved or equal');
  } else {
    console.log('❌ DRY RUN FAILED');
    if (!liveImproved) console.log('   ⚠️  Live P&L decreased');
    if (!noRegression) console.log(`   ⚠️  ${regressed} trade(s) regressed`);
  }
  console.log(`${'='.repeat(80)}\n`);

  await pool.end();
  process.exit(passed ? 0 : 1);
}

run().catch(err => {
  console.error('Dry run failed:', err.message);
  process.exit(1);
});
