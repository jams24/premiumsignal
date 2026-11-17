// ReplayDesk accounts: password hashing, sessions, one-time email tokens, rate limits, the admin check.
// Node's crypto only. Session and email tokens are random 32-byte values; the database keeps only their SHA-256.
const crypto = require('crypto');
const { q } = require('./db');

const COOKIE = 'rd_session';
const SESSION_MS = 30 * 864e5;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// ---- passwords (scrypt, N=2^14 r=8 p=1, 64-byte key; runs on the libuv pool, not the event loop) ----
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');
/** Constant-time check. A missing hash still costs one scrypt, so "no such user" isn't faster than "wrong password". */
async function verifyPassword(pw, stored) {
  const parts = String(stored || DUMMY).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const key = await scrypt(String(pw), Buffer.from(parts[4], 'base64'));
  const want = Buffer.from(parts[5], 'base64');
  return !!stored && want.length === key.length && crypto.timingSafeEqual(want, key);
}

// ---- rate limits (one process → in memory) ----
const buckets = new Map();
/** true = allowed. max hits per window per key. */
function limit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 600e3).unref();

/** The client IP: the proxy appends the real one last to X-Forwarded-For. */
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return xf.length ? xf[xf.length - 1] : (req.socket && req.socket.remoteAddress) || '?';
}

// ---- input checks ----
const cleanEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
const validPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128;

// ---- users ----
const USER_COLS = 'id, email, name, password_hash, email_verified, google_sub, image, plan, banned, created_at, last_login_at';
async function userByEmail(email) { return (await q(`SELECT ${USER_COLS} FROM web_users WHERE email = $1`, [email])).rows[0] || null; }
async function userById(id) { return (await q(`SELECT ${USER_COLS} FROM web_users WHERE id = $1`, [id])).rows[0] || null; }
async function createUser({ email, name, passwordHash, verified = false, googleSub = null, image = null }) {
  const r = await q(`INSERT INTO web_users (email, name, password_hash, email_verified, google_sub, image) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (email) DO NOTHING RETURNING ${USER_COLS}`, [email, name, passwordHash, verified, googleSub, image]);
  return r.rows[0] || null;
}
const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
/** Admin = a confirmed email listed in ADMIN_EMAILS (never a database flag). */
const isAdminUser = u => !!(u && u.email_verified && !u.banned && adminEmails().includes(u.email));

// ---- sessions ----
const cache = new Map();   // token hash → { s, until }; 30 s, so a page view doesn't always hit the database
function clearCache() { cache.clear(); }
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* malformed: skip */ } }
  }
  return out;
}
const secure = req => req.headers['x-forwarded-proto'] === 'https' || /^https:/.test(process.env.PUBLIC_URL || '');
function cookie(req, name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure(req) ? '; Secure' : ''}`;
}
function addCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : [c]);
}

/** Start a session: for a user (userId) or for the dashboard key (keyHash, admin without an account). */
async function startSession(req, res, { userId = null, keyHash = null }) {
  const tok = newToken();
  await q(`INSERT INTO web_sessions (token_hash, user_id, key_hash, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [sha(tok), userId, keyHash, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300), new Date(Date.now() + SESSION_MS)]);
  if (userId) q(`UPDATE web_users SET last_login_at = now() WHERE id = $1`, [userId]).catch(() => {});
  addCookie(res, cookie(req, COOKIE, tok, SESSION_MS / 1000));
}

/**
 * The visitor's session or null: { user, admin, keyOnly }. A dashboard-key session stops working when DASHBOARD_KEY
 * changes; a banned user's session stops at once. Never throws.
 */
async function readSession(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length > 100) return null;
  const h = sha(tok), now = Date.now();
  const c = cache.get(h);
  let row;
  if (c && c.until > now) row = c.row;
  else {
    try {
      row = (await q(`SELECT s.user_id, s.key_hash, s.expires_at, ${USER_COLS.split(', ').map(k => 'u.' + k).join(', ')}
        FROM web_sessions s LEFT JOIN web_users u ON u.id = s.user_id WHERE s.token_hash = $1`, [h])).rows[0] || null;
    } catch (e) { return null; }
    if (cache.size > 5000) cache.clear();
    cache.set(h, { row, until: now + 30e3 });
  }
  if (!row || new Date(row.expires_at).getTime() < now) return null;
  if (row.key_hash) {
    const k = (process.env.DASHBOARD_KEY || '').trim();
    return k && row.key_hash === sha(k) ? { user: null, admin: true, keyOnly: true } : null;
  }
  if (!row.id || row.banned) return null;
  const user = { id: row.id, email: row.email, name: row.name, emailVerified: row.email_verified, image: row.image, plan: row.plan,
    google: !!row.google_sub, hasPassword: !!row.password_hash, createdAt: row.created_at };
  return { user, admin: isAdminUser(row), keyOnly: false };
}

async function endSession(req, res) {
  const tok = parseCookies(req)[COOKIE];
  if (tok) { const h = sha(tok); cache.delete(h); await q(`DELETE FROM web_sessions WHERE token_hash = $1`, [h]).catch(() => {}); }
  addCookie(res, cookie(req, COOKIE, '', 0));
}
async function endAllSessions(userId) { await q(`DELETE FROM web_sessions WHERE user_id = $1`, [userId]); clearCache(); }

// ---- one-time email tokens (verify 24 h, reset 1 h) ----
async function issueToken(userId, kind, ttlMs) {
  const tok = newToken();
  await q(`INSERT INTO web_tokens (token_hash, user_id, kind, expires_at) VALUES ($1,$2,$3,$4)`, [sha(tok), userId, kind, new Date(Date.now() + ttlMs)]);
  return tok;
}
/** Spend a token: the user id, or null if unknown / expired / used / the wrong kind. Atomic, so it works once. */
async function useToken(tok, kind) {
  if (!tok || String(tok).length > 100) return null;
  const r = await q(`UPDATE web_tokens SET used_at = now() WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha(tok), kind]);
  return r.rows[0] ? r.rows[0].user_id : null;
}

/** Cross-site request check for anything that changes state: the Origin must be this site. */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false;
  let host;
  try { host = new URL(o).host; } catch (e) { return false; }
  const ok = [req.headers.host, req.headers['x-forwarded-host']];
  try { if (process.env.PUBLIC_URL) ok.push(new URL(process.env.PUBLIC_URL).host); } catch (e) { /* bad PUBLIC_URL */ }
  return ok.filter(Boolean).includes(host);
}

/** Dashboard key check, constant time. */
function keyMatches(k) {
  const want = (process.env.DASHBOARD_KEY || '').trim();
  const got = String(k || '').trim();
  if (!want || !got) return false;
  const a = Buffer.from(sha(want)), b = Buffer.from(sha(got));
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  sha, newToken, hashPassword, verifyPassword, limit, clientIp, cleanEmail, validEmail, cleanName, validPassword,
  userByEmail, userById, createUser, isAdminUser, adminEmails, startSession, readSession, endSession, endAllSessions, clearCache,
  issueToken, useToken, sameOrigin, keyMatches, parseCookies, cookie, addCookie,
};
