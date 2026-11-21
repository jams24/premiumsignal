// "Continue with Google" (OpenID Connect, authorization code + PKCE). On only when GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET and PUBLIC_URL are set. Redirect URI to register at Google: <PUBLIC_URL>/auth/google/callback
const crypto = require('crypto');
const logger = require('../../utils/logger');
const A = require('./auth');
const { q } = require('./db');
const { safeNext } = require('./html');

const enabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.PUBLIC_URL);
const redirectUri = () => `${process.env.PUBLIC_URL.replace(/\/+$/, '')}/auth/google/callback`;
const pending = new Map();   // state → { verifier, nonce, next, until }; one process, 10 minutes
const STATE_COOKIE = 'rd_oauth';

function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

function start(req, res, url) {
  if (!enabled()) return redirect(res, '/signin');
  if (!A.limit(`g:${A.clientIp(req)}`, 20, 600e3)) return redirect(res, '/signin?error=google');
  const state = A.newToken(), verifier = A.newToken(), nonce = A.newToken();
  const now = Date.now();
  for (const [k, v] of pending) if (v.until < now) pending.delete(k);
  if (pending.size > 2000) pending.clear();
  pending.set(state, { verifier, nonce, next: safeNext(url.searchParams.get('next')), until: now + 600e3 });
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  A.addCookie(res, A.cookie(req, STATE_COOKIE, state, 600));
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

async function callback(req, res, url, opts = {}) {
  const fail = why => { logger.warn(`[web] google sign-in failed: ${why}`); A.addCookie(res, A.cookie(req, STATE_COOKIE, '', 0)); redirect(res, '/signin?error=google'); };
  if (!enabled()) return redirect(res, '/signin');
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const p = pending.get(state);
  pending.delete(state);
  if (!state || !p || p.until < Date.now() || A.parseCookies(req)[STATE_COOKIE] !== state) return fail('state');
  if (!code) return fail('no code');
  let claims;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: p.verifier }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) return fail(`token ${r.status}`);
    // the ID token came straight from Google's token endpoint over TLS, so its claims are checked, not its signature (OIDC 3.1.3.7)
    claims = JSON.parse(Buffer.from(String(tok.id_token).split('.')[1], 'base64url').toString('utf8'));
  } catch (e) { return fail(e.message); }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) return fail('iss');
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return fail('aud');
  if (!(claims.exp * 1000 > Date.now())) return fail('exp');
  if (claims.nonce !== p.nonce) return fail('nonce');
  if (!claims.sub || !claims.email || claims.email_verified !== true) return fail('email not verified at Google');

  const email = A.cleanEmail(claims.email), name = A.cleanName(claims.name || ''), image = /^https:\/\//.test(claims.picture || '') ? claims.picture : null;
  let user = (await q(`SELECT id, banned FROM web_users WHERE google_sub = $1`, [claims.sub])).rows[0];
  if (!user) {
    const ex = await A.userByEmail(email);
    if (ex) {
      // link Google to the existing account. If its email was never confirmed, drop that password: someone else may
      // have signed up with this address before its owner (account pre-hijacking).
      await q(`UPDATE web_users SET google_sub = $1, email_verified = true, password_hash = CASE WHEN email_verified THEN password_hash ELSE NULL END,
        image = COALESCE(image, $2), name = CASE WHEN name = '' THEN $3 ELSE name END WHERE id = $4`, [claims.sub, image, name, ex.id]);
      if (!ex.email_verified) await A.endAllSessions(ex.id);
      user = { id: ex.id, banned: ex.banned };
    } else {
      if (opts.canCreate === false) { A.addCookie(res, A.cookie(req, STATE_COOKIE, '', 0)); return redirect(res, '/signin?error=closed'); }
      const u = await A.createUser({ email, name: name || email.split('@')[0], passwordHash: null, verified: true, googleSub: claims.sub, image });
      if (!u) return fail('create');
      user = u;
    }
  }
  if (user.banned) { A.addCookie(res, A.cookie(req, STATE_COOKIE, '', 0)); return redirect(res, '/signin?error=banned'); }
  A.addCookie(res, A.cookie(req, STATE_COOKIE, '', 0));
  await A.startSession(req, res, { userId: user.id });
  redirect(res, p.next);
}

module.exports = { enabled, start, callback };
