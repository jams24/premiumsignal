// ReplayDesk on the bot's own web server: the public site, accounts, and the admin gate in front of the live dashboard.
//
//   site.init()                         create the web_ tables (own pool; never blocks or breaks the bot)
//   site.handle(req, res, url, opts)    true if it answered. false → the caller's old routes run (also the fallback
//                                       for /dashboard whenever accounts are offline, so the key screen always works)
//   site.isAdminRequest(req)            admin session cookie (admin account or dashboard-key session); for anything
//                                       but GET/HEAD the request must also come from this site (cross-site check)
//
// Public users only ever get paper features. Live trading stays behind the admin check on /api/*.
const crypto = require('crypto');
const logger = require('../../utils/logger');
const db = require('./db');
const A = require('./auth');
const mail = require('./mail');
const G = require('./google');
const P = require('./pages');
const LRN = require('./learn');
const ADM = require('./admin');
const { ASSETS, FAVICON, safeNext } = require('./html');
const NEWS = require('./news');

const publicUrl = () => (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
/** Email links work (confirm address, reset password): the database, an email sender, and the public address for the links.
 *  On → a new account confirms its email before it can sign in. Off → a new account goes straight into the desk
 *  (email not confirmed: it can never be admin, and Google sign-in with that address takes the account over). */
const accountsOpen = () => db.ready() && mail.ready() && !!publicUrl();
// the admin's open / closed switch for new accounts (web_settings 'signups'; open unless closed), read at most every 30 s
let signupCfg = { open: true, at: 0 };
async function signupsOpen() {
  if (!db.ready()) return false;
  if (Date.now() - signupCfg.at > 30e3) {
    try {
      const r = await db.q("SELECT value FROM web_settings WHERE key = 'signups'");
      signupCfg = { open: !(r.rows[0] && r.rows[0].value && r.rows[0].value.open === false), at: Date.now() };
    } catch (e) { signupCfg.at = Date.now(); }
  }
  return signupCfg.open;
}

let started = false;
function init() {
  if (started) return Promise.resolve();
  started = true;
  return db.init().catch(e => logger.warn(`[web] init: ${e.message}`));
}

// ---- responses ----
const csp = nonce => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "connect-src 'self' https://fapi.binance.com wss://fstream.binance.com https://api.bybit.com wss://stream.bybit.com",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self' https://accounts.google.com", "object-src 'none'",
].join('; ');
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
function html(res, render, status = 200) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const body = render(nonce);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp(nonce), ...SECURITY });
  res.end(body);
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(JSON.stringify(obj));
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }
const toSignin = (res, next) => redirect(res, `/signin?next=${encodeURIComponent(next)}`);

function readJson(req, max = 10000) {
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

const TYPES = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
function serveAsset(req, res, url) {
  const name = url.pathname.slice('/assets/'.length);
  const a = Object.prototype.hasOwnProperty.call(ASSETS, name) ? ASSETS[name] : null;
  if (!a) { res.writeHead(404); res.end(); return; }
  const etag = `"${a.hash}"`;
  const headers = { 'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream', ETag: etag, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': url.searchParams.get('v') === a.hash ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, headers); res.end(a.body);
}

const PAGES = new Set(['/', '/learn', '/terms', '/privacy', '/risk', '/signin', '/signup', '/check-email', '/forgot', '/reset', '/app', '/account',
  '/admin', '/dashboard', '/dashboard/classic', '/robots.txt', '/icon.svg', '/favicon.ico', '/api/site/news']);

async function handle(req, res, url, opts = {}) {
  const p = url.pathname;
  if (!(PAGES.has(p) || p.startsWith('/assets/') || p.startsWith('/auth/') || /^\/learn\/[a-z0-9-]{1,60}\/?$/.test(p))) return false;
  try {
    return await route(req, res, url, opts);
  } catch (e) {
    logger.warn(`[web] ${req.method} ${p}: ${e.message}`);
    if (res.headersSent) { try { res.end(); } catch (_) { /* closed */ } return true; }
    if (p === '/dashboard' || p === '/dashboard/classic') return false;   // the old key screen still works
    if (p.startsWith('/auth/')) { json(res, 500, { error: 'server', message: 'Something went wrong. Try again.' }); return true; }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Something went wrong. Please try again.');
    return true;
  }
}

let adminDash = null;   // the dashboard page with the "signed in as admin" flag (built once)

async function route(req, res, url, { dashboardHtml, newsEvents }) {
  const p = url.pathname;
  if (p.startsWith('/assets/')) { serveAsset(req, res, url); return true; }
  if (p === '/icon.svg' || p === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }); res.end(FAVICON); return true; }
  if (p === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /dashboard\nDisallow: /dashboard/classic\nDisallow: /app\nDisallow: /account\nDisallow: /admin\nDisallow: /api/\nDisallow: /auth/\n');
    return true;
  }
  if (p.startsWith('/auth/')) return authRoute(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET' }); res.end(); return true; }

  if ((p === '/dashboard' || p === '/dashboard/classic') && !db.ready()) return false;   // accounts offline → old behaviour (key screen in the page)
  const who = db.ready() ? await A.readSession(req) : null;
  const userWho = who && !who.keyOnly ? who : null;
  const next = safeNext(url.searchParams.get('next'));

  if (p === '/api/site/news') {   // the desk's Market panel: economic calendar + crypto headlines (signed in, rate limited)
    if (!who) { json(res, 401, { error: 'auth' }); return true; }
    if (!A.limit(`nw:${A.clientIp(req)}`, 40, 300e3)) { json(res, 429, { error: 'rate', message: 'Too many requests. Wait a few minutes.' }); return true; }
    json(res, 200, await NEWS.news(newsEvents)); return true;
  }

  if (p.startsWith('/learn/')) {   // one lesson; unknown, or admin-only for a visitor → not found
    const slug = p.slice(7).replace(/\/$/, ''), ok = LRN.canSee(who, slug);
    html(res, n => (ok ? LRN.learnLesson(who, n, slug) : P.notFound(who, n)), ok ? 200 : 404);
    return true;
  }

  switch (p) {
    case '/': html(res, n => P.landing(who, n)); return true;
    case '/learn': html(res, n => LRN.learnIndex(who, n)); return true;
    case '/terms': case '/privacy': case '/risk': html(res, n => P.contentPage(who, n, P.LEGAL[p.slice(1)]())); return true;
    case '/signin':
      if (userWho) { redirect(res, next); return true; }
      html(res, n => P.signin(n, { next, googleOn: G.enabled() && db.ready(), error: url.searchParams.get('error'), reset: url.searchParams.has('reset'), verified: url.searchParams.has('verified') }));
      return true;
    case '/signup':
      if (userWho) { redirect(res, next); return true; }
      { const open = await signupsOpen(); html(res, n => P.signup(n, { next, googleOn: G.enabled() && db.ready(), open, confirm: accountsOpen() })); }
      return true;
    case '/check-email': html(res, n => P.checkEmail(n, { email: String(url.searchParams.get('email') || '').slice(0, 254), next })); return true;
    case '/forgot': html(res, n => P.forgot(n, { open: accountsOpen() })); return true;
    case '/reset': html(res, n => P.reset(n, { token: String(url.searchParams.get('token') || '').slice(0, 100) })); return true;
    case '/app':
      if (!who) { toSignin(res, '/app'); return true; }
      html(res, n => P.desk(who, n)); return true;
    case '/account':
      if (!userWho) { toSignin(res, '/account'); return true; }
      html(res, n => P.account(who, n)); return true;
    case '/admin': {
      if (!who) { toSignin(res, '/admin'); return true; }
      if (!who.admin) { redirect(res, '/app'); return true; }
      const d = await ADM.adminData(db, url, accountsOpen(), await signupsOpen());
      html(res, n => ADM.adminConsole(who, n, d));
      return true;
    }
    case '/dashboard':   // two versions: the modern desk (default) and the classic SignalCommand page
      if (who && who.admin) { redirect(res, '/app#real'); return true; }
      html(res, n => P.dashboardGate(n, { who, googleOn: G.enabled(), next: '/dashboard' }));
      return true;
    case '/dashboard/classic':
      if (who && who.admin && dashboardHtml) {
        if (!adminDash) adminDash = dashboardHtml.replace('</head>', '<script>window.__RD_ADMIN=1</script></head>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
        res.end(adminDash);
        return true;
      }
      html(res, n => P.dashboardGate(n, { who, googleOn: G.enabled(), next: '/dashboard/classic' }));
      return true;
    default: return false;
  }
}

// ---- /auth/* ----
async function authRoute(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET') {
    if (p === '/auth/google') { G.start(req, res, url); return true; }
    if (p === '/auth/google/callback') { if (!db.ready()) { redirect(res, '/signin?error=google'); return true; } await G.callback(req, res, url, { canCreate: await signupsOpen() }); return true; }
    if (p === '/auth/verify') { await verifyEmail(req, res, url); return true; }
    json(res, 405, { error: 'method' }); return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'method' }); return true; }
  // a page on this site, sending JSON: a form on another site can do neither
  if (!A.sameOrigin(req) || !/^application\/json/i.test(String(req.headers['content-type'] || ''))) { json(res, 403, { error: 'origin' }); return true; }
  if (!db.ready()) { json(res, 503, { error: 'offline', message: 'Accounts are offline right now. Try again soon.' }); return true; }
  const b = await readJson(req);
  if (!b || typeof b !== 'object') { json(res, 400, { error: 'body' }); return true; }
  const ip = A.clientIp(req);
  const tooMany = () => json(res, 429, { error: 'rate', message: 'Too many tries. Wait a few minutes.' });

  switch (p) {
    case '/auth/sign-up': {
      if (!(await signupsOpen())) return json(res, 403, { error: 'closed', message: 'New accounts are paused right now. Try again later.' }), true;
      if (!A.limit(`su:${ip}`, 5, 600e3)) return tooMany(), true;
      const email = A.cleanEmail(b.email), name = A.cleanName(b.name) || email.split('@')[0], next = safeNext(b.next);
      if (!A.validEmail(email)) return json(res, 400, { error: 'email', message: 'Enter a valid email address.' }), true;
      if (!A.validPassword(b.password)) return json(res, 400, { error: 'password', message: 'Use 8 to 128 characters for the password.' }), true;
      // an admin address only signs up with a confirmed email (no one can take it first while sign-ups skip the email step)
      if (!accountsOpen() && A.adminEmails().includes(email)) return json(res, 403, { error: 'reserved', message: 'This address can’t sign up here. Use the dashboard key.' }), true;
      if (await A.userByEmail(email)) return json(res, 409, { error: 'exists' }), true;
      const u = await A.createUser({ email, name: name.slice(0, 60), passwordHash: await A.hashPassword(b.password) });
      if (!u) return json(res, 409, { error: 'exists' }), true;
      if (accountsOpen()) {   // email links work: confirm first
        await sendVerifyLink(u, next);
        logger.info(`[web] sign-up user=${u.id} (confirm email)`);
        json(res, 200, { ok: true, redirect: `/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}` });
        return true;
      }
      await A.startSession(req, res, { userId: u.id });   // no email sender: straight into the desk
      logger.info(`[web] sign-up user=${u.id} (instant)`);
      json(res, 200, { ok: true, instant: true, redirect: next });
      return true;
    }
    case '/auth/sign-in': {
      const email = A.cleanEmail(b.email);
      if (!A.limit(`si:${ip}`, 10, 300e3) || !A.limit(`sie:${email}`, 8, 900e3)) return tooMany(), true;
      const u = A.validEmail(email) ? await A.userByEmail(email) : null;
      const ok = await A.verifyPassword(String(b.password || ''), u && u.password_hash);
      if (!u || !ok) return json(res, 401, { error: 'invalid' }), true;
      if (u.banned) return json(res, 403, { error: 'banned', message: 'This account is suspended.' }), true;
      if (!u.email_verified && accountsOpen()) {   // without an email sender there is no link to confirm with: let them in
        if (A.limit(`rs:${email}`, 3, 900e3)) await sendVerifyLink(u, safeNext(b.next));
        return json(res, 403, { error: 'email_not_verified' }), true;
      }
      await A.startSession(req, res, { userId: u.id });
      json(res, 200, { ok: true, redirect: safeNext(b.next) });
      return true;
    }
    case '/auth/sign-out': await A.endSession(req, res); json(res, 200, { ok: true }); return true;
    case '/auth/resend': {
      const email = A.cleanEmail(b.email);
      if (!A.limit(`rsi:${ip}`, 6, 900e3) || !A.limit(`rs:${email}`, 3, 900e3)) return tooMany(), true;
      const u = A.validEmail(email) ? await A.userByEmail(email) : null;
      if (u && !u.email_verified && !u.banned && accountsOpen()) await sendVerifyLink(u, safeNext(b.next));
      json(res, 200, { ok: true });   // the same answer whether or not the account exists
      return true;
    }
    case '/auth/forgot': {
      const email = A.cleanEmail(b.email);
      if (!A.limit(`fg:${ip}`, 5, 900e3) || !A.limit(`fge:${email}`, 3, 900e3)) return tooMany(), true;
      const u = A.validEmail(email) ? await A.userByEmail(email) : null;
      if (u && !u.banned && accountsOpen()) {
        const tok = await A.issueToken(u.id, 'reset', 3600e3);
        await mail.sendReset(u.email, `${publicUrl()}/reset?token=${tok}`).catch(e => logger.warn(`[web] reset mail: ${e.message}`));
      }
      json(res, 200, { ok: true });
      return true;
    }
    case '/auth/reset': {
      if (!A.limit(`rp:${ip}`, 10, 900e3)) return tooMany(), true;
      if (!A.validPassword(b.password)) return json(res, 400, { error: 'password', message: 'Use 8 to 128 characters.' }), true;
      const uid = await A.useToken(b.token, 'reset');
      if (!uid) return json(res, 400, { error: 'token' }), true;
      await db.q(`UPDATE web_users SET password_hash = $1, email_verified = true WHERE id = $2`, [await A.hashPassword(b.password), uid]);
      await A.endAllSessions(uid);   // signed out everywhere, including whoever had the old password
      logger.info(`[web] password reset user=${uid}`);
      json(res, 200, { ok: true });
      return true;
    }
    case '/auth/admin/signups': {   // admin: open or close new accounts
      const who = await A.readSession(req);
      if (!who || !who.admin) return json(res, 403, { error: 'admin' }), true;
      const open = b.open !== false;
      await db.q(`INSERT INTO web_settings (key, value, updated_at) VALUES ('signups', $1, now())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify({ open })]);
      signupCfg = { open, at: Date.now() };
      logger.info(`[web] sign-ups ${open ? 'opened' : 'closed'} by admin`);
      json(res, 200, { ok: true, open });
      return true;
    }
    case '/auth/key': {
      if (!A.limit(`k:${ip}`, 5, 900e3)) return tooMany(), true;
      if (!A.keyMatches(b.key)) { logger.warn('[web] dashboard key sign-in refused'); return json(res, 401, { error: 'invalid' }), true; }
      await A.startSession(req, res, { keyHash: A.sha(String(b.key).trim()) });
      logger.info('[web] dashboard key session started');
      json(res, 200, { ok: true });
      return true;
    }
    default: json(res, 404, { error: 'not_found' }); return true;
  }
}

async function sendVerifyLink(u, next) {
  const tok = await A.issueToken(u.id, 'verify', 24 * 3600e3);
  const link = `${publicUrl()}/auth/verify?token=${tok}&next=${encodeURIComponent(next || '/app')}`;
  await mail.sendVerify(u.email, u.name, link).catch(e => logger.warn(`[web] verify mail: ${e.message}`));
}

async function verifyEmail(req, res, url) {
  if (!db.ready()) return redirect(res, '/signin?error=verify');
  if (!A.limit(`v:${A.clientIp(req)}`, 20, 900e3)) return redirect(res, '/signin?error=verify');
  const uid = await A.useToken(url.searchParams.get('token'), 'verify');
  if (!uid) return redirect(res, '/signin?error=verify');
  await db.q(`UPDATE web_users SET email_verified = true WHERE id = $1`, [uid]);
  const u = await A.userById(uid);
  if (!u || u.banned) return redirect(res, '/signin?error=banned');
  await A.startSession(req, res, { userId: uid });
  redirect(res, safeNext(url.searchParams.get('next')));
}

/** For the bot's /api/* gate. Never throws. */
async function isAdminRequest(req) {
  try {
    if (!db.ready()) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD' && !A.sameOrigin(req)) return false;
    const s = await A.readSession(req);
    return !!(s && s.admin);
  } catch (e) { return false; }
}

module.exports = { init, handle, isAdminRequest, accountsOpen };
