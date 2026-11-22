// ReplayDesk · the paper journal on the server. Every closed paper trade (live and replay) of a signed-in user is kept
// here, so the journal follows the account: another browser, the phone, cleared site data. Open paper trades stay in the
// browser that opened them (they run on that browser's prices / replay clock).
//   web_paper: epoch (which journal: a Reset starts a new one), the start balance, the replay sessions (newest first)
//   web_paper_trades: one row per closed trade (uid made by the browser), newest MAX_KEEP kept
// The browser sends its new closed trades with its epoch. Another epoch than the server's = the account was reset in
// another browser since → 409 with the current journal, and that browser starts over from it.
const { q } = require('./db');

const MAX_KEEP = 5000, MAX_POST = 400, MAX_SESS = 300, SEND = 2000;
const NUM = ['id', 'side', 'lev', 'qty', 'margin', 'entry', 'exit', 'pnl', 'r', 't0', 't1', 'wt0', 'wt', 'sl', 'tp', 'sl0', 'tp0', 'hi', 'lo', 'risk', 'fee', 'oid'];
const STR = { uid: /^[\w-]{1,40}$/, sym: /^[\w.:/-]{1,40}$/, ex: /^\w{1,12}$/, why: /^[\w ]{1,30}$/, mode: /^(live|replay)$/, tf: /^\w{1,4}$/, sid: /^[\w-]{1,40}$/ };
const EPOCH = /^[\w-]{4,40}$/;

// only known fields, numbers finite, strings matching their shape; null when it isn't a closed trade
function cleanTrade(t) {
  if (!t || typeof t !== 'object') return null;
  const o = {};
  for (const k of NUM) if (t[k] != null) { const v = +t[k]; if (Number.isFinite(v)) o[k] = v; }
  for (const k in STR) if (typeof t[k] === 'string' && STR[k].test(t[k])) o[k] = t[k];
  if (!o.uid || !o.sym || !o.mode || !(o.side === 1 || o.side === -1) || !Number.isFinite(o.pnl)) return null;
  if (!Number.isFinite(o.wt)) o.wt = Number.isFinite(o.t1) && o.mode === 'live' ? o.t1 : 0;
  return o;
}
function cleanSess(a) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (const x of a.slice(0, MAX_SESS)) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !STR.sid.test(x.id)) continue;
    const s = { id: x.id, wt: +x.wt || 0, at: +x.at || 0 };
    if (typeof x.sym === 'string' && STR.sym.test(x.sym)) s.sym = x.sym;
    if (typeof x.ex === 'string' && STR.ex.test(x.ex)) s.ex = x.ex;
    if (typeof x.tf === 'string' && STR.tf.test(x.tf)) s.tf = x.tf;
    out.push(s);
  }
  return out;
}
const mergeSess = (a, b) => { const m = new Map(); for (const s of a.concat(b)) if (!m.has(s.id)) m.set(s.id, s); return [...m.values()].sort((x, y) => y.wt - x.wt).slice(0, MAX_SESS); };

async function get(userId) {
  const row = (await q('SELECT epoch, start_bal, sess FROM web_paper WHERE user_id = $1', [userId])).rows[0];
  if (!row) return { epoch: null, start: null, sess: [], trades: [] };
  const tr = (await q('SELECT data FROM web_paper_trades WHERE user_id = $1 ORDER BY wt DESC LIMIT $2', [userId, SEND])).rows.map(r => r.data);
  return { epoch: row.epoch, start: row.start_bal, sess: row.sess || [], trades: tr };
}

async function post(userId, b) {
  const epoch = typeof b.epoch === 'string' && EPOCH.test(b.epoch) ? b.epoch : null;
  if (!epoch) return { status: 400, body: { error: 'epoch' } };
  const start = Number.isFinite(+b.start) && +b.start > 0 && +b.start < 1e9 ? +b.start : 10000;
  const trades = (Array.isArray(b.trades) ? b.trades.slice(0, MAX_POST) : []).map(cleanTrade).filter(Boolean);
  const sess = cleanSess(b.sess);
  const row = (await q('SELECT epoch, sess FROM web_paper WHERE user_id = $1', [userId])).rows[0];
  if (b.reset === true) {   // Reset in this browser: a new, empty journal
    await q('DELETE FROM web_paper_trades WHERE user_id = $1', [userId]);
    await q(`INSERT INTO web_paper (user_id, epoch, start_bal, sess) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET epoch = $2, start_bal = $3, sess = $4, updated_at = now()`, [userId, epoch, start, JSON.stringify(sess)]);
  } else if (!row) {
    await q('INSERT INTO web_paper (user_id, epoch, start_bal, sess) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING', [userId, epoch, start, JSON.stringify(sess)]);
  } else if (row.epoch !== epoch) {
    return { status: 409, body: Object.assign({ error: 'epoch' }, await get(userId)) };
  } else if (sess.length) {
    await q('UPDATE web_paper SET sess = $2, updated_at = now() WHERE user_id = $1', [userId, JSON.stringify(mergeSess(sess, row.sess || []))]);
  }
  if (trades.length) {
    const vals = [], args = [userId];
    trades.forEach((t, i) => { vals.push(`($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`); args.push(t.uid, Math.round(t.wt), JSON.stringify(t)); });
    await q(`INSERT INTO web_paper_trades (user_id, uid, wt, data) VALUES ${vals.join(', ')} ON CONFLICT (user_id, uid) DO NOTHING`, args);
    await q(`DELETE FROM web_paper_trades WHERE user_id = $1 AND uid IN (SELECT uid FROM web_paper_trades WHERE user_id = $1 ORDER BY wt DESC OFFSET ${MAX_KEEP})`, [userId]);
  }
  return { status: 200, body: { ok: true, saved: trades.length, epoch } };
}

module.exports = { get, post, cleanTrade };
