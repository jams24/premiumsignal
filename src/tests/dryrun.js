#!/usr/bin/env node
/**
 * Dry-run backtester — replays the closed technical-signal trades (sources 'main' and 'onchain', not the pump
 * auto/manual trades) through a simple exit model, once with the BASELINE settings and once with the CURRENT ones,
 * and compares the two. A regression = a trade the current settings make worse than the baseline settings.
 *
 *   node src/tests/dryrun.js            compare (exit 0 pass / 1 fail)
 *   node src/tests/dryrun.js --update   save the current settings as the new baseline
 *
 * Current settings come from the code and the DB, not from constants kept by hand:
 *   - TP1/TP2 close %, profit protect %, max loss per trade: TradeExecutor defaults + bot_settings (id 1 main, 2 onchain)
 *   - dead hours: parsed from technicalScanner.js
 * TP/SL prices come from each stored trade. The model is rough (exit price + hit flags, no candles); it shows the
 * direction of a settings change, not exact P&L. Pump trades are checked by src/tests/pumpcheck.js.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const TradeExecutor = require('../engine/tradeExecutor');

const BASELINE = path.join(__dirname, 'dryrun.baseline.json');
const SOURCES = { main: 1, onchain: 2 };
const update = process.argv.includes('--update');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false } : false,
});

// Dead hours as written in technicalScanner.js (`currentHourUTC >= 4 && currentHourUTC <= 5`)
function deadHours() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'collectors', 'technicalScanner.js'), 'utf8');
  const m = src.match(/currentHourUTC >= (\d+) && currentHourUTC <= (\d+)/);
  return m ? { deadHoursStart: +m[1], deadHoursEnd: +m[2] } : { deadHoursStart: null, deadHoursEnd: null };
}

async function currentParams() {
  const out = {};
  for (const [key, id] of Object.entries(SOURCES)) {
    const te = new TradeExecutor({}, { settingsKey: key });
    const { rows } = await pool.query('SELECT config FROM bot_settings WHERE id = $1', [id]);
    if (rows[0]?.config) te.applyConfig(rows[0].config);
    out[key] = {
      partialTP1: te.tp1ClosePct, partialTP2: te.tp2ClosePct, partialTP3: 0.5,
      profitProtectPct: te.profitProtectPct, maxLossPerTrade: te.maxLossPerTrade, ...deadHours(),
    };
  }
  return out;
}

async function loadTrades() {
  const { rows } = await pool.query(`
    SELECT *, created_at AT TIME ZONE 'UTC' as created_utc, closed_at AT TIME ZONE 'UTC' as closed_utc
    FROM trades
    WHERE status = 'closed' AND source = ANY($1)
      AND COALESCE(onchain_context->>'autoPump', 'false') <> 'true'
      AND COALESCE(onchain_context->>'manual', 'false') <> 'true'
    ORDER BY closed_at
  `, [Object.keys(SOURCES)]);
  return rows;
}

// Recorded result: remainder P&L + TP partials
const recordedPnl = (t) => (parseFloat(t.pnl_usd) || 0) + (parseFloat(t.realized_pnl) || 0);

function simulateTrade(trade, P) {
  const isLong = trade.direction === 'long';
  const entry = parseFloat(trade.entry_price);
  const exit = parseFloat(trade.exit_price);
  const size = parseFloat(trade.position_size) || 12;
  const tp1 = parseFloat(trade.tp1);
  const tp2 = parseFloat(trade.tp2);
  const tp3 = parseFloat(trade.tp3);
  const result = { pnl: 0, reason: trade.close_reason, changes: [] };

  const entryHour = trade.created_utc ? new Date(trade.created_utc).getUTCHours() : null;
  if (entryHour !== null && P.deadHoursStart != null && entryHour >= P.deadHoursStart && entryHour <= P.deadHoursEnd) {
    result.reason = 'blocked_dead_hours';
    result.changes.push(`Blocked: entered during dead hours (${entryHour} UTC)`);
    return result;
  }

  // Did price reach TP1/TP2/TP3? Hit flags, or the exit price itself
  const priceReachedTP1 = trade.hit_tp1 || (isLong ? exit >= tp1 : exit <= tp1);
  const priceReachedTP2 = trade.hit_tp2 || (isLong ? exit >= tp2 : exit <= tp2);
  const priceReachedTP3 = trade.hit_tp3 || (isLong ? exit >= tp3 : exit <= tp3);
  const movePct = (px) => (isLong ? (px - entry) / entry : (entry - px) / entry) * 100;

  let remainingSize = size;
  let pnl = 0;
  const maxFavorableMove = isLong
    ? ((Math.max(exit, tp1, entry) - entry) / entry) * 100
    : ((entry - Math.min(exit, tp1, entry)) / entry) * 100;
  let slMovedToBreakeven = false;

  for (const [hit, px, frac, label] of [[priceReachedTP1, tp1, P.partialTP1, 'TP1'], [priceReachedTP2, tp2, P.partialTP2, 'TP2'], [priceReachedTP3, tp3, P.partialTP3, 'TP3']]) {
    if (!hit) continue;
    const closeSize = remainingSize * frac;
    pnl += (movePct(px) / 100) * closeSize;
    remainingSize -= closeSize;
    if (label === 'TP1') slMovedToBreakeven = true;
    result.changes.push(`${label}: closed ${(frac * 100).toFixed(0)}% (+$${((movePct(px) / 100) * closeSize).toFixed(2)})`);
  }

  if (!priceReachedTP1 && maxFavorableMove > P.profitProtectPct) {
    slMovedToBreakeven = true;
    result.changes.push(`Profit protection: +${maxFavorableMove.toFixed(1)}% → SL to breakeven`);
  }

  if (remainingSize > 0) {
    if (slMovedToBreakeven && ['sl', 'max_loss'].includes(trade.close_reason)) {
      result.reason = 'sl_breakeven';
      result.changes.push(`Remaining ${(remainingSize / size * 100).toFixed(0)}% closed at breakeven`);
    } else {
      pnl += (movePct(exit) / 100) * remainingSize;
    }
  }

  if (P.maxLossPerTrade > 0 && pnl < -P.maxLossPerTrade) {
    pnl = -P.maxLossPerTrade;
    result.reason = 'max_loss_capped';
  }
  result.pnl = pnl;
  return result;
}

async function run() {
  const current = await currentParams();
  if (update) {
    fs.writeFileSync(BASELINE, JSON.stringify({ savedAt: new Date().toISOString(), params: current }, null, 2) + '\n');
    console.log('Baseline saved →', path.relative(process.cwd(), BASELINE), JSON.stringify(current));
    await pool.end();
    process.exit(0);
  }
  if (!fs.existsSync(BASELINE)) throw new Error('No baseline yet — run with --update first.');
  const base = JSON.parse(fs.readFileSync(BASELINE)).params;
  const trades = await loadTrades();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`DRY RUN — ${trades.length} closed technical-signal trades (${Object.keys(SOURCES).join(', ')}), baseline vs current settings`);
  for (const k of Object.keys(SOURCES)) {
    const diff = Object.keys(current[k]).filter(p => current[k][p] !== base[k]?.[p]);
    console.log(`  ${k}: ${JSON.stringify(current[k])}${diff.length ? `\n    changed vs baseline: ${diff.map(p => `${p} ${base[k]?.[p]} → ${current[k][p]}`).join(', ')}` : ' (same as baseline)'}`);
  }
  console.log(`${'='.repeat(80)}\n`);

  const tot = { live: { rec: 0, base: 0, now: 0 }, paper: { rec: 0, base: 0, now: 0 } };
  let improved = 0, same = 0, regressed = 0, blocked = 0;
  const lines = [];
  for (const t of trades) {
    const a = simulateTrade(t, base[t.source]), b = simulateTrade(t, current[t.source]);
    const m = tot[t.mode === 'live' ? 'live' : 'paper'];
    m.rec += recordedPnl(t); m.base += a.pnl; m.now += b.pnl;
    const d = b.pnl - a.pnl;
    if (b.reason === 'blocked_dead_hours' && a.reason !== 'blocked_dead_hours') blocked++;
    if (Math.abs(d) < 0.01) { same++; continue; }
    if (d > 0) improved++;
    else if (t.close_reason === 'manual_close') same++; // manual closes are user-timed, not regressions
    else regressed++;
    lines.push(`${d > 0 ? '✅' : '❌'} ${t.mode === 'live' ? '💰' : '📝'} #${t.id} ${t.symbol.padEnd(8)} ${t.direction.padEnd(5)} | baseline $${a.pnl.toFixed(2).padStart(7)} → now $${b.pnl.toFixed(2).padStart(7)} (${b.reason}) | Δ $${d.toFixed(2)}`);
    for (const c of b.changes) lines.push(`   └─ ${c}`);
  }

  if (lines.length) { console.log('CHANGED TRADES:'); console.log(lines.join('\n')); console.log(); }
  console.log(`${'='.repeat(80)}\nSUMMARY\n${'='.repeat(80)}`);
  for (const [k, m] of Object.entries(tot)) {
    console.log(`${k === 'live' ? '💰 LIVE' : '📝 PAPER'}: recorded $${m.rec.toFixed(2)} | model baseline $${m.base.toFixed(2)} → current $${m.now.toFixed(2)} (Δ $${(m.now - m.base).toFixed(2)})`);
  }
  console.log(`📊 ✅ improved ${improved} · ➖ same ${same} · ❌ regressed ${regressed} · 🚫 newly blocked ${blocked}`);

  const liveOk = tot.live.now >= tot.live.base - 0.01;
  const passed = liveOk && regressed === 0;
  console.log(`\n${'='.repeat(80)}`);
  if (passed) console.log('✅ DRY RUN PASSED — No regressions vs baseline, live P&L equal or better');
  else {
    console.log('❌ DRY RUN FAILED');
    if (!liveOk) console.log('   ⚠️  Live P&L lower than the baseline settings');
    if (regressed) console.log(`   ⚠️  ${regressed} trade(s) regressed vs the baseline settings`);
  }
  console.log(`${'='.repeat(80)}\n`);
  await pool.end();
  process.exit(passed ? 0 : 1);
}

run().catch(err => {
  console.error('Dry run failed:', err.message);
  process.exit(1);
});
