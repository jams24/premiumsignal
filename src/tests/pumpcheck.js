#!/usr/bin/env node
/**
 * Pump check — replays the stored pump-signal history through the bot's CURRENT pump code and config,
 * and compares against a saved baseline. Run before committing changes to the pump short / no-spot switch.
 *
 *   node --max-old-space-size=8000 src/tests/pumpcheck.js            compare with the baseline (exit 0 pass / 1 fail)
 *   node --max-old-space-size=8000 src/tests/pumpcheck.js --update   save the current result as the new baseline
 *   add --defaults to use the code defaults instead of the live /autopump + executor config from the DB
 *   add --switch-on to count switch trades even while "switch real trades" is off (to see what turning it on does)
 *
 * What comes from the bot's code: entry rule (entryVerdict), signal-time re-check (PUMP_RULES.recheckMinMin),
 * skip rules (PumpAutoTrader.blockReason: BTC pause, spot share, no-spot), no-spot switch (PumpAutoTrader.switchSide
 * on the closed-candle 7-day run: long / short / skip), TP levels (tpPcts / runnerTpPcts), stop (PUMP_RULES.slPct /
 * RUNNER.slPct), early stop move (beAtPct/beStopPct), TP close sizes (executor tp1ClosePct / tp2ClosePct, TP3 50%, TP4 all).
 * Switch trades enter at the first 5-min watch check ≥ SWITCH_DELAY_MIN after the replay signal: the live scanner
 * fires ~15–20 min after the replay's signal (27 Oct 2026 check), and a long at the replay signal itself is not reachable.
 * Fixed here: $150 per trade, 0.1% fees, 48h max hold, stop checked before targets inside a 1m candle.
 * Not modelled: max open, daily loss stop, live fills/slippage, liquidation.
 *
 * Data: backtest/data (1 Jun – 18 Oct 2026) and backtest/data_early (Dec 2025 – May 2026), git-ignored.
 * Fill them with `sh backtest/update.sh` (see backtest/README.md).
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { PUMP_RULES, entryVerdict } = require('../collectors/pumpSignalCheck');
const { PumpAutoTrader } = require('../engine/pumpAutoTrader');
const { RUNNER } = require('../engine/pumpRunnerPaper');
const TradeExecutor = require('../engine/tradeExecutor');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(__dirname, 'pumpcheck.baseline.json');
const SETS = [['Jun–Oct', 'backtest/data'], ['Dec–May', 'backtest/data_early']];
const POS = 150, FEE_PCT = 0.1, HOLD_MIN = 48 * 60, M = 60000, Hr = 3600000, SWITCH_DELAY_MIN = 15;
const args = new Set(process.argv.slice(2));

// Live config: pump_autotrade (id 1) and the onchain executor's settings (bot_settings id 2). Read directly, so the
// check never runs the bot's DB init (schema setup) against production.
async function loadConfig() {
  const auto = new PumpAutoTrader({ executor: {}, notify: async () => {} });
  const exec = new TradeExecutor({}, { settingsKey: 'onchain' });
  let source = 'code defaults';
  if (!args.has('--defaults') && process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const u = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString: u, ssl: u.includes('neon') || u.includes('railway') ? { rejectUnauthorized: false } : false });
    try {
      const a = (await pool.query('SELECT config FROM pump_autotrade WHERE id = 1')).rows[0]?.config;
      const e = (await pool.query('SELECT config FROM bot_settings WHERE id = 2')).rows[0]?.config;
      if (a) auto.config = { ...auto.config, ...a };
      if (e) exec.applyConfig(e);
      source = 'live DB config';
    } finally { await pool.end(); }
  }
  const c = auto.config;
  return {
    source, auto,
    plan: {
      maxOi1h: PUMP_RULES.maxOi1h, minTopAgeMin: PUMP_RULES.minTopAgeMin, minCisd: PUMP_RULES.minCisd, recheckMinMin: PUMP_RULES.recheckMinMin,
      shortTps: auto.tpPcts(), shortSl: PUMP_RULES.slPct, runnerTps: auto.runnerTpPcts(), runnerSl: RUNNER.slPct,
      closeFracs: [exec.tp1ClosePct, exec.tp2ClosePct, 0.5, 1],
      beAtPct: Number(c.beAtPct) || 0, beStopPct: Math.max(0, Number(c.beStopPct ?? 5)),
      btcPausePct: c.btcPausePct, maxSpotSharePct: c.maxSpotSharePct, skipNoSpot: !!c.skipNoSpot,
      switchLive: c.switchLive === true || args.has('--switch-on'), switchShortTo: auto.switchShortTo(),
    },
  };
}

// 1m path `hl` = [high, low, close, ...] from the signal minute. Mirrors the executor for auto pump trades
// ('tponly': stop → entry at TP1, no trailing) plus the auto-trader's early stop move before TP1.
function simulate(hl, off, E, dir, tps, slPct, plan) {
  const fr = plan.closeFracs, S = dir === 'short';
  let rem = 1, hit = 0, p = 0, stop = -slPct, best = -Infinity, last = E;
  const end = Math.min(hl.length / 3, off + HOLD_MIN);
  for (let i = off; i < end; i++) {
    const hi = hl[3 * i], lo = hl[3 * i + 1];
    const fav = S ? (1 - lo / E) * 100 : (hi / E - 1) * 100, adv = S ? (1 - hi / E) * 100 : (lo / E - 1) * 100;
    last = hl[3 * i + 2];
    if (adv <= stop) { p += rem * stop; rem = 0; break; }
    while (hit < 4 && fav >= tps[hit]) {
      const q = hit === 3 ? rem : rem * fr[hit];
      p += q * tps[hit]; rem -= q; hit++;
      if (hit === 1) stop = Math.max(stop, 0);
    }
    if (rem < 1e-9) break;
    // Early stop move: applies from the next candle, once the best move before TP1 reached beAtPct
    best = Math.max(best, fav);
    if (plan.beAtPct > 0 && !hit && best >= plan.beAtPct) stop = Math.max(stop, -plan.beStopPct);
  }
  if (rem > 1e-9) p += rem * (S ? (1 - last / E) : (last / E - 1)) * 100;
  return +(p / 100 * POS - POS * FEE_PCT / 100).toFixed(4);
}

const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const passes = (s) => entryVerdict({ oi1h: s.oi, topAgeMin: s.age, cisdScore: s.c }) === 'enter';

async function replaySet(dir, cfg) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, dir, f)));
  const rows = read('replay_L.json'), H1 = read('h1L.json');
  const paths = read('paths_L.json');
  const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
  const btc7 = (t) => { const k = H1.BTCUSDT, j = idx(k, t); return j - 168 >= 0 ? (k[j][4] / k[j - 168][4] - 1) * 100 : null; };
  const { auto, plan } = cfg;
  const out = {};
  for (const r of rows) {
    const hl = paths[r.s + r.t];
    if (!hl || hl.length / 3 < 60) continue;
    const sym = r.s.replace(/USDT$/, '');
    const run7d = run7(r.s, r.t);
    const spotAt = (s) => (r.hasSpot === false ? { hasSpot: false } : s?.sp == null ? null : { hasSpot: true, pct: s.sp });
    // Steps until the watch ends ('missed' stops it)
    const steps = [];
    for (const s of r.all) { if (s.k === 'missed') break; steps.push(s); }
    // No-spot coin: the switch decides at the signal (any verdict) from the closed-candle 7-day run; never the short
    if (r.hasSpot === false) {
      const side = plan.switchLive ? auto.switchSide(run7d) : null;
      const s = side && steps.find(z => z.now - r.t >= SWITCH_DELAY_MIN * M);
      if (s) out[`${r.s}|${r.t}|sw-${side}`] = simulate(hl, Math.round((s.now - r.t) / M), s.p, side, side === 'long' ? plan.runnerTps : plan.shortTps, side === 'long' ? plan.runnerSl : plan.shortSl, plan);
      continue;
    }
    const firstPass = (from) => steps.findIndex((s, i) => i >= from && passes(s));
    let i0 = firstPass(0);
    if (i0 < 0) continue;

    // Short: rules met at the signal itself → re-check on a later step at least recheckMinMin later
    if (i0 === 0) { i0 = steps.findIndex((s, i) => i >= 1 && s.now - r.t >= PUMP_RULES.recheckMinMin * M && passes(s)); if (i0 < 0) continue; }
    const s = steps[i0];
    const info = { symbol: sym, spot: spotAt(s) };
    const b = btc7(s.now);
    auto.measureBtc = async () => b;
    auto.commonBlock = async () => null;
    if (await auto.blockReason(info)) continue;
    const off = Math.round((s.now - r.t) / M);
    out[`${r.s}|${r.t}|short`] = simulate(hl, off, s.p, 'short', plan.shortTps, plan.shortSl, plan);
  }
  return out;
}

function summary(trades) {
  const v = Object.entries(trades);
  const sum = (f) => v.filter(([k]) => f(k)).reduce((a, [, x]) => a + x, 0);
  return {
    trades: v.length, wins: v.filter(([, x]) => x > 0).length,
    pnl: +sum(() => true).toFixed(2), short: +sum(k => k.endsWith('|short')).toFixed(2), long: +sum(k => k.endsWith('|long')).toFixed(2),
    switch: +sum(k => k.includes('|sw-')).toFixed(2),
  };
}

(async () => {
  for (const [, dir] of SETS) {
    if (!fs.existsSync(path.join(ROOT, dir, 'replay_L.json'))) {
      console.error(`Missing ${dir}/replay_L.json — fill the backtest data first (sh backtest/update.sh, see backtest/README.md).`);
      process.exit(1);
    }
  }
  const cfg = await loadConfig();
  console.log(`\n${'='.repeat(80)}\nPUMP CHECK — current pump code + ${cfg.source}, $${POS}/trade, fees in\n${'='.repeat(80)}`);
  console.log('Plan:', JSON.stringify(cfg.plan));

  const result = { plan: cfg.plan, source: cfg.source, sets: {} };
  for (const [name, dir] of SETS) {
    const trades = await replaySet(dir, cfg);
    result.sets[name] = { summary: summary(trades), trades };
    if (global.gc) global.gc();
  }

  if (args.has('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ savedAt: new Date().toISOString(), ...result }) + '\n');
    for (const [name, s] of Object.entries(result.sets)) console.log(`${name}: ${JSON.stringify(s.summary)}`);
    console.log(`\nBaseline saved → ${path.relative(ROOT, BASELINE)}`);
    process.exit(0);
  }
  if (!fs.existsSync(BASELINE)) { console.error('No baseline yet — run with --update first.'); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(BASELINE));

  const changed = Object.keys(cfg.plan).filter(k => JSON.stringify(cfg.plan[k]) !== JSON.stringify(base.plan[k]));
  if (changed.length) console.log(`\nPlan differs from the baseline (${base.savedAt.slice(0, 10)}): ${changed.map(k => `${k} ${JSON.stringify(base.plan[k])} → ${JSON.stringify(cfg.plan[k])}`).join(', ')}`);
  if (base.source !== cfg.source) console.log(`Note: baseline used ${base.source}, this run uses ${cfg.source}.`);

  let pass = true;
  for (const [name, now] of Object.entries(result.sets)) {
    const was = base.sets[name];
    const keys = new Set([...Object.keys(was.trades), ...Object.keys(now.trades)]);
    let better = 0, worse = 0, added = 0, dropped = 0, same = 0;
    const worst = [];
    for (const k of keys) {
      const a = was.trades[k], b = now.trades[k];
      if (a == null) { added++; continue; }
      if (b == null) { dropped++; continue; }
      const d = b - a;
      if (Math.abs(d) < 0.01) same++; else if (d > 0) better++; else { worse++; worst.push([k, d]); }
    }
    const diff = now.summary.pnl - was.summary.pnl;
    const ok = diff >= -0.01;
    if (!ok) pass = false;
    console.log(`\n${ok ? '✅' : '❌'} ${name}: ${was.summary.trades} → ${now.summary.trades} trades | P&L $${was.summary.pnl} → $${now.summary.pnl} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})` +
      ` | short $${now.summary.short}, switch $${now.summary.switch ?? 0}, old runner long $${now.summary.long}`);
    console.log(`   per trade: ${same} same, ${better} better, ${worse} worse, ${added} new, ${dropped} no longer taken`);
    worst.sort((x, y) => x[1] - y[1]).slice(0, 5).forEach(([k, d]) => console.log(`   worse: ${k.split('|')[0]} ${new Date(+k.split('|')[1]).toISOString().slice(0, 16)} ${k.split('|')[2]} ${d.toFixed(2)}`));
  }
  console.log(`\n${'='.repeat(80)}\n${pass ? '✅ PUMP CHECK PASSED — P&L equal or better in both periods' : '❌ PUMP CHECK FAILED — P&L lower than the baseline in at least one period'}\n${'='.repeat(80)}\n`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('Pump check failed:', e.message); process.exit(1); });
