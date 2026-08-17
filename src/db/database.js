const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool = null;
let connected = false;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('neon') || process.env.DATABASE_URL?.includes('railway')
        ? { rejectUnauthorized: false }
        : false,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function query(text, params) {
  if (!connected) return { rows: [] };
  return getPool().query(text, params);
}

async function init(retries = 3) {
  const p = getPool();
  if (!p) {
    logger.warn('No DATABASE_URL set — running without persistence');
    return;
  }

  for (let i = 1; i <= retries; i++) {
    try {
      await p.query('SELECT 1');
      logger.info(`Database connected (attempt ${i})`);
      connected = true;
      break;
    } catch (err) {
      logger.warn(`DB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }

  await p.query(`
    CREATE TABLE IF NOT EXISTS known_listings (
      id SERIAL PRIMARY KEY,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      market_type TEXT DEFAULT 'spot',
      detected_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(exchange, symbol, market_type)
    );

    CREATE TABLE IF NOT EXISTS signals (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      direction TEXT,
      entry_low DOUBLE PRECISION,
      entry_high DOUBLE PRECISION,
      current_price DOUBLE PRECISION,
      tp1 DOUBLE PRECISION, tp2 DOUBLE PRECISION, tp3 DOUBLE PRECISION,
      stop_loss DOUBLE PRECISION,
      confidence INTEGER,
      catalyst TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      hit_tp1 BOOLEAN DEFAULT FALSE,
      hit_tp2 BOOLEAN DEFAULT FALSE,
      hit_tp3 BOOLEAN DEFAULT FALSE,
      hit_sl BOOLEAN DEFAULT FALSE,
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS whale_txs (
      id SERIAL PRIMARY KEY,
      chain TEXT,
      tx_hash TEXT UNIQUE,
      token_symbol TEXT,
      amount DOUBLE PRECISION,
      usd_value DOUBLE PRECISION,
      from_addr TEXT,
      to_addr TEXT,
      detected_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id SERIAL PRIMARY KEY,
      exchange TEXT,
      symbol TEXT,
      price DOUBLE PRECISION,
      volume_24h DOUBLE PRECISION,
      change_24h DOUBLE PRECISION,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oi_snapshots (
      id SERIAL PRIMARY KEY,
      exchange TEXT,
      symbol TEXT,
      open_interest DOUBLE PRECISION,
      oi_change DOUBLE PRECISION,
      price DOUBLE PRECISION,
      price_change DOUBLE PRECISION,
      interpretation TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dex_alerts (
      id SERIAL PRIMARY KEY,
      symbol TEXT,
      chain TEXT,
      dex TEXT,
      price DOUBLE PRECISION,
      volume_24h DOUBLE PRECISION,
      price_change_24h DOUBLE PRECISION,
      price_change_1h DOUBLE PRECISION,
      liquidity DOUBLE PRECISION,
      buy_ratio TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS intel_briefs (
      id SERIAL PRIMARY KEY,
      total_mcap DOUBLE PRECISION,
      total_volume DOUBLE PRECISION,
      btc_dominance DOUBLE PRECISION,
      mcap_change_24h DOUBLE PRECISION,
      stablecoin_data JSONB,
      oi_summary JSONB,
      dex_summary JSONB,
      funding_summary JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alert_log (
      id SERIAL PRIMARY KEY,
      alert_type TEXT NOT NULL,
      symbol TEXT,
      data JSONB,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_symbol_time ON market_snapshots(symbol, timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_closed ON signals(closed_at);
    CREATE INDEX IF NOT EXISTS idx_oi_symbol_time ON oi_snapshots(symbol, created_at);
    CREATE INDEX IF NOT EXISTS idx_dex_time ON dex_alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_alert_log_type ON alert_log(alert_type, created_at);

    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      signal_id INTEGER,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      direction TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      entry_price DOUBLE PRECISION NOT NULL,
      quantity DOUBLE PRECISION,
      position_size DOUBLE PRECISION,
      leverage INTEGER DEFAULT 5,
      tp1 DOUBLE PRECISION, tp2 DOUBLE PRECISION, tp3 DOUBLE PRECISION,
      tp4 DOUBLE PRECISION,
      stop_loss DOUBLE PRECISION,
      original_stop_loss DOUBLE PRECISION,
      invalidation DOUBLE PRECISION,
      hit_tp1 BOOLEAN DEFAULT FALSE,
      hit_tp2 BOOLEAN DEFAULT FALSE,
      hit_tp3 BOOLEAN DEFAULT FALSE,
      dca_stage INTEGER DEFAULT 1,
      dca_qty_2 DOUBLE PRECISION,
      dca_qty_3 DOUBLE PRECISION,
      dca_price_2 DOUBLE PRECISION,
      dca_price_3 DOUBLE PRECISION,
      dca_filled_2 BOOLEAN DEFAULT FALSE,
      dca_filled_3 BOOLEAN DEFAULT FALSE,
      exit_price DOUBLE PRECISION,
      pnl_pct DOUBLE PRECISION,
      pnl_usd DOUBLE PRECISION,
      close_reason TEXT,
      status TEXT DEFAULT 'open',
      order_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);

    CREATE TABLE IF NOT EXISTS bot_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CHECK (id = 1)
    );
  `);

  // Add new columns to existing trades table (safe — IF NOT EXISTS not available for columns, so catch errors)
  const newCols = [
    ['tp4', 'DOUBLE PRECISION'],
    ['original_stop_loss', 'DOUBLE PRECISION'],
    ['invalidation', 'DOUBLE PRECISION'],
    ['hit_tp3', 'BOOLEAN DEFAULT FALSE'],
    ['dca_stage', 'INTEGER DEFAULT 1'],
    ['dca_qty_2', 'DOUBLE PRECISION'],
    ['dca_qty_3', 'DOUBLE PRECISION'],
    ['dca_price_2', 'DOUBLE PRECISION'],
    ['dca_price_3', 'DOUBLE PRECISION'],
    ['dca_filled_2', 'BOOLEAN DEFAULT FALSE'],
    ['dca_filled_3', 'BOOLEAN DEFAULT FALSE'],
    ['realized_pnl', 'DOUBLE PRECISION DEFAULT 0'],
    ['peak_price', 'DOUBLE PRECISION'],
    ['atr', 'DOUBLE PRECISION'],
  ];
  for (const [col, type] of newCols) {
    try { await p.query(`ALTER TABLE trades ADD COLUMN ${col} ${type}`); } catch (e) { /* already exists */ }
  }

  logger.info('Database tables ready');
}

async function isKnownListing(exchange, symbol, marketType) {
  const { rows } = await query('SELECT 1 FROM known_listings WHERE exchange=$1 AND symbol=$2 AND market_type=$3', [exchange, symbol, marketType]);
  return rows.length > 0;
}

async function addListing(exchange, symbol, marketType) {
  await query('INSERT INTO known_listings (exchange, symbol, market_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [exchange, symbol, marketType]);
}

async function saveSignal(signal) {
  const { rows } = await query(
    `INSERT INTO signals (type, symbol, exchange, direction, entry_low, entry_high, current_price, tp1, tp2, tp3, stop_loss, confidence, catalyst)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [signal.type, signal.symbol, signal.exchange, signal.direction, signal.entryLow, signal.entryHigh, signal.currentPrice, signal.tp1, signal.tp2, signal.tp3, signal.stopLoss, signal.confidence, signal.catalyst]
  );
  return rows[0];
}

async function getActiveSignals() {
  const { rows } = await query('SELECT * FROM signals WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 20');
  return rows;
}

async function saveWhaleTx(tx) {
  await query(
    'INSERT INTO whale_txs (chain, tx_hash, token_symbol, amount, usd_value, from_addr, to_addr) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
    [tx.chain, tx.txHash, tx.symbol, tx.amount, tx.usdValue, tx.from, tx.to]
  );
}

async function saveSnapshot(exchange, symbol, price, volume, change) {
  await query('INSERT INTO market_snapshots (exchange, symbol, price, volume_24h, change_24h) VALUES ($1,$2,$3,$4,$5)', [exchange, symbol, price, volume, change]);
}

async function getRecentSnapshots(symbol, hours = 24) {
  const { rows } = await query(`SELECT * FROM market_snapshots WHERE symbol=$1 AND timestamp > NOW() - INTERVAL '${hours} hours' ORDER BY timestamp`, [symbol]);
  return rows;
}

async function updateSignalHit(id, field) {
  await query(`UPDATE signals SET ${field} = TRUE WHERE id = $1`, [id]);
}

async function closeSignal(id) {
  await query('UPDATE signals SET closed_at = NOW() WHERE id = $1', [id]);
}

async function getClosedSignals(limit = 20) {
  const { rows } = await query('SELECT * FROM signals WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getAllSignals(limit = 50) {
  const { rows } = await query('SELECT * FROM signals ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getSignalStats() {
  const { rows } = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE hit_tp1) as tp1_hit,
      COUNT(*) FILTER (WHERE hit_tp2) as tp2_hit,
      COUNT(*) FILTER (WHERE hit_sl) as sl_hit
    FROM signals
  `);
  if (!rows.length) return { total: 0, tp1Hit: 0, tp2Hit: 0, slHit: 0, winRate: '0' };
  const s = rows[0];
  return { total: +s.total, tp1Hit: +s.tp1_hit, tp2Hit: +s.tp2_hit, slHit: +s.sl_hit, winRate: s.total > 0 ? ((s.tp1_hit / s.total) * 100).toFixed(1) : '0' };
}

async function saveOISnapshot(oi) {
  await query(
    'INSERT INTO oi_snapshots (exchange, symbol, open_interest, oi_change, price, price_change, interpretation) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [oi.exchange, oi.symbol, oi.openInterest, parseFloat(oi.oiChange), oi.price, oi.priceChange, oi.interpretation]
  );
}

async function saveDexAlert(token) {
  await query(
    'INSERT INTO dex_alerts (symbol, chain, dex, price, volume_24h, price_change_24h, price_change_1h, liquidity, buy_ratio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [token.symbol, token.chain, token.dex, token.priceUsd, token.volume24h, token.priceChange24h, token.priceChange1h, token.liquidity, token.buyRatio]
  );
}

async function saveIntelBrief(brief) {
  await query(
    'INSERT INTO intel_briefs (total_mcap, total_volume, btc_dominance, mcap_change_24h, stablecoin_data, oi_summary, dex_summary, funding_summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [brief.totalMcap, brief.totalVolume, brief.btcDominance, brief.mcapChange, JSON.stringify(brief.stablecoins), JSON.stringify(brief.oiData), JSON.stringify(brief.dexData), JSON.stringify(brief.fundingData)]
  );
}

async function logAlert(alertType, symbol, data, message) {
  await query(
    'INSERT INTO alert_log (alert_type, symbol, data, message) VALUES ($1,$2,$3,$4)',
    [alertType, symbol, JSON.stringify(data), message]
  );
}

async function getAnalysisData(days = 7) {
  const interval = `${days} days`;

  const [signals, oi, dex, alerts, briefs] = await Promise.all([
    query(`SELECT * FROM signals WHERE created_at > NOW() - INTERVAL '${interval}' ORDER BY created_at`),
    query(`SELECT * FROM oi_snapshots WHERE created_at > NOW() - INTERVAL '${interval}' ORDER BY created_at`),
    query(`SELECT * FROM dex_alerts WHERE created_at > NOW() - INTERVAL '${interval}' ORDER BY created_at`),
    query(`SELECT alert_type, symbol, COUNT(*) as count FROM alert_log WHERE created_at > NOW() - INTERVAL '${interval}' GROUP BY alert_type, symbol ORDER BY count DESC`),
    query(`SELECT * FROM intel_briefs WHERE created_at > NOW() - INTERVAL '${interval}' ORDER BY created_at`),
  ]);

  // Signal performance breakdown by type
  const signalsByType = {};
  for (const s of signals.rows) {
    if (!signalsByType[s.type]) signalsByType[s.type] = { total: 0, tp1: 0, tp2: 0, tp3: 0, sl: 0 };
    signalsByType[s.type].total++;
    if (s.hit_tp1) signalsByType[s.type].tp1++;
    if (s.hit_tp2) signalsByType[s.type].tp2++;
    if (s.hit_tp3) signalsByType[s.type].tp3++;
    if (s.hit_sl) signalsByType[s.type].sl++;
  }

  // OI accuracy: did OI signals correctly predict direction?
  const oiAccuracy = { correct: 0, wrong: 0, total: oi.rows.length };

  // Most alerted tokens
  const topTokens = alerts.rows.slice(0, 10);

  // DEX → CEX conversion: tokens that appeared in DEX alerts AND later in signals
  const dexSymbols = new Set(dex.rows.map(d => d.symbol));
  const signalSymbols = new Set(signals.rows.map(s => s.symbol));
  const dexToCex = [...dexSymbols].filter(s => signalSymbols.has(s));

  // Market condition trends from briefs
  const mcapTrend = briefs.rows.length >= 2
    ? ((briefs.rows[briefs.rows.length - 1].total_mcap - briefs.rows[0].total_mcap) / briefs.rows[0].total_mcap * 100).toFixed(2)
    : null;

  return {
    period: `${days} days`,
    signals: { total: signals.rows.length, byType: signalsByType, raw: signals.rows },
    oi: { total: oi.rows.length, accuracy: oiAccuracy, snapshots: oi.rows },
    dex: { total: dex.rows.length, alerts: dex.rows, convertedToCex: dexToCex },
    alertLog: topTokens,
    briefs: { count: briefs.rows.length, mcapTrend },
  };
}

async function saveTrade(trade) {
  const { rows } = await query(
    `INSERT INTO trades (signal_id, symbol, exchange, direction, mode, entry_price, quantity, position_size, leverage, tp1, tp2, tp3, tp4, stop_loss, original_stop_loss, invalidation, dca_stage, dca_qty_2, dca_qty_3, dca_price_2, dca_price_3, order_id, status, peak_price, atr)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
    [trade.signalId, trade.symbol, trade.exchange, trade.direction, trade.mode, trade.entryPrice, trade.quantity, trade.positionSize, trade.leverage, trade.tp1, trade.tp2, trade.tp3, trade.tp4 || null, trade.stopLoss, trade.originalStopLoss || trade.stopLoss, trade.invalidation || null, trade.dcaStage || 1, trade.dcaQty2 || null, trade.dcaQty3 || null, trade.dcaPrice2 || null, trade.dcaPrice3 || null, trade.orderId || null, 'open', trade.entryPrice, trade.atr || null]
  );
  return rows[0];
}

async function getOpenTrades() {
  const { rows } = await query("SELECT * FROM trades WHERE status = 'open' ORDER BY created_at DESC");
  return rows;
}

async function updateTradeHit(id, field) {
  await query(`UPDATE trades SET ${field} = TRUE WHERE id = $1`, [id]);
}

async function closeTrade(id, exitPrice, pnlPct, pnlUsd, reason) {
  await query(
    'UPDATE trades SET status=$1, exit_price=$2, pnl_pct=$3, pnl_usd=$4, close_reason=$5, closed_at=NOW() WHERE id=$6',
    ['closed', exitPrice, pnlPct, pnlUsd, reason, id]
  );
}

async function updateTradeStopLoss(id, newSL) {
  await query('UPDATE trades SET stop_loss = $1 WHERE id = $2', [newSL, id]);
}

async function updateTradePeakPrice(id, peakPrice) {
  await query('UPDATE trades SET peak_price = $1 WHERE id = $2', [peakPrice, id]);
}

async function updateTradePartialClose(id, newQty, newPositionSize, realizedPnl) {
  await query(
    'UPDATE trades SET quantity = $1, position_size = $2, realized_pnl = COALESCE(realized_pnl, 0) + $3 WHERE id = $4',
    [newQty, newPositionSize, realizedPnl, id]
  );
}

async function updateTradeDCA(id, stage, newEntryPrice, newQty) {
  await query(
    `UPDATE trades SET dca_filled_${stage} = TRUE, entry_price = $1, quantity = $2, dca_stage = $3 WHERE id = $4`,
    [newEntryPrice, newQty, stage, id]
  );
}

async function getTradeStats() {
  const { rows } = await query(`
    SELECT
      mode,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'closed') as closed,
      COUNT(*) FILTER (WHERE status = 'open') as open,
      COUNT(*) FILTER (WHERE close_reason = 'tp4') as full_wins,
      COUNT(*) FILTER (WHERE pnl_usd > 0 AND status = 'closed') as wins,
      COUNT(*) FILTER (WHERE pnl_usd <= 0 AND status = 'closed') as losses,
      COUNT(*) FILTER (WHERE close_reason = 'invalidated') as invalidated,
      COUNT(*) FILTER (WHERE close_reason = 'expired') as expired,
      COALESCE(SUM(pnl_usd) FILTER (WHERE status = 'closed'), 0) as total_pnl,
      COALESCE(AVG(pnl_pct) FILTER (WHERE status = 'closed'), 0) as avg_pnl_pct,
      MAX(pnl_usd) as best_trade,
      MIN(pnl_usd) as worst_trade
    FROM trades GROUP BY mode
  `);
  return rows;
}

async function getTodayPnL(mode) {
  const sql = mode
    ? `SELECT COALESCE(SUM(pnl_usd), 0) as total FROM trades WHERE status = 'closed' AND closed_at >= CURRENT_DATE AND mode = $1`
    : `SELECT COALESCE(SUM(pnl_usd), 0) as total FROM trades WHERE status = 'closed' AND closed_at >= CURRENT_DATE`;
  const { rows } = await query(sql, mode ? [mode] : []);
  return rows.length ? parseFloat(rows[0].total) : 0;
}

async function getAllTimePnL(since, mode) {
  const conditions = [`status = 'closed'`];
  const params = [];
  if (since) { params.push(since); conditions.push(`closed_at >= $${params.length}`); }
  if (mode) { params.push(mode); conditions.push(`mode = $${params.length}`); }
  const sql = `SELECT COALESCE(SUM(pnl_usd), 0) as total FROM trades WHERE ${conditions.join(' AND ')}`;
  const { rows } = await query(sql, params);
  return rows.length ? parseFloat(rows[0].total) : 0;
}

async function saveSettings(config) {
  const json = JSON.stringify(config);
  await query(
    `INSERT INTO bot_settings (id, config, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = NOW()`,
    [json]
  );
}

async function loadSettings() {
  const { rows } = await query('SELECT config FROM bot_settings WHERE id = 1');
  return rows.length ? rows[0].config : null;
}

module.exports = { init, pool: { end: () => pool?.end() }, isKnownListing, addListing, saveSignal, getActiveSignals, updateSignalHit, closeSignal, getClosedSignals, getAllSignals, saveWhaleTx, saveSnapshot, getRecentSnapshots, getSignalStats, saveOISnapshot, saveDexAlert, saveIntelBrief, logAlert, getAnalysisData, saveTrade, getOpenTrades, updateTradeHit, closeTrade, getTradeStats, updateTradeStopLoss, updateTradePeakPrice, updateTradePartialClose, updateTradeDCA, saveSettings, loadSettings, getTodayPnL, getAllTimePnL };
