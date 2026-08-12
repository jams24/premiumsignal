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

    CREATE INDEX IF NOT EXISTS idx_snapshots_symbol_time ON market_snapshots(symbol, timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_closed ON signals(closed_at);
  `);
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

module.exports = { init, pool: { end: () => pool?.end() }, isKnownListing, addListing, saveSignal, getActiveSignals, updateSignalHit, closeSignal, getClosedSignals, getAllSignals, saveWhaleTx, saveSnapshot, getRecentSnapshots, getSignalStats };
