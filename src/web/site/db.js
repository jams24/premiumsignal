// ReplayDesk accounts: its own small pg pool, so website traffic can never take connections the bot needs.
// Tables are prefixed web_ and created here (CREATE IF NOT EXISTS), separately from db.init(): a failure leaves the
// bot untouched and only turns the account features off (ready() = false).
const { Pool } = require('pg');
const logger = require('../../utils/logger');

let pool = null;
let isReady = false;

function url() { return process.env.WEB_DATABASE_URL || process.env.DATABASE_URL || ''; }

function getPool() {
  if (!pool && url()) {
    const u = url();
    pool = new Pool({
      connectionString: u,
      ssl: /neon|railway|sslmode=require/.test(u) ? { rejectUnauthorized: false } : false,
      max: 3,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      statement_timeout: 8000,
    });
    pool.on('error', e => logger.warn(`[web] pool error: ${e.message}`));
  }
  return pool;
}

async function q(text, params) {
  const p = getPool();
  if (!p) throw new Error('no database');
  return p.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS web_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  google_sub TEXT UNIQUE,
  image TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  banned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT REFERENCES web_users(id) ON DELETE CASCADE,
  key_hash TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS web_sessions_user ON web_sessions(user_id);
CREATE TABLE IF NOT EXISTS web_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS web_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- the desk's paper journal (paper.js): one row per account (which journal, start balance, replay sessions) and one per
-- closed paper trade. Open paper trades stay in the browser that opened them.
CREATE TABLE IF NOT EXISTS web_paper (
  user_id BIGINT PRIMARY KEY REFERENCES web_users(id) ON DELETE CASCADE,
  epoch TEXT NOT NULL,
  start_bal DOUBLE PRECISION NOT NULL DEFAULT 10000,
  sess JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS web_paper_trades (
  user_id BIGINT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  wt BIGINT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (user_id, uid)
);
CREATE INDEX IF NOT EXISTS web_paper_trades_wt ON web_paper_trades(user_id, wt DESC);`;

/** Create the tables. Never throws; logs and leaves ready() false on failure. */
async function init() {
  if (!getPool()) { logger.warn('[web] no database URL — accounts off'); return false; }
  try {
    await q(SCHEMA);
    isReady = true;
    logger.info('[web] account tables ready');
    // the module's own expired sessions / used tokens; hourly, never blocks the process from exiting
    const sweep = () => q(`DELETE FROM web_sessions WHERE expires_at < now(); DELETE FROM web_tokens WHERE expires_at < now() - interval '1 day'`)
      .catch(e => logger.warn(`[web] sweep: ${e.message}`));
    sweep();
    setInterval(sweep, 3600e3).unref();
  } catch (e) {
    logger.warn(`[web] account tables failed: ${e.message} — accounts off`);
  }
  return isReady;
}

module.exports = { q, init, ready: () => isReady };
