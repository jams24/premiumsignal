// A+ setups on the ReplayDesk Watchlist (Indicators → "Watch my Watchlist"), checked by the server every minute: an alert
// reaches the owner's Telegram DM with the desk closed, and the open desk on any other chart (GET /api/aplus/watch).
// Same data and rules as the chart's own alert (src/web/site/assets/deskaplus.js): 3 days of 1-minute candles plus 300 older
// structure candles, src/web/smcEngine.js, closed candles only, the exchange the desk reads.
// Read-only: public candles. It never trades. Practice setups: these rules lost after fees in our test.
const SMC = require('../web/smcEngine');
const simApi = require('../web/simApi');
const siteDb = require('../web/site/db');
const logger = require('../utils/logger');

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DAYS = 3, HIST = 300;
const ARMED_WINDOW = 90 * MIN, ARMED_QUIET = 30 * MIN;   // as on the chart: the trigger must come soon after the sweep; a deeper sweep of the same move is the same warning
const LATE = 10 * MIN;                                    // a setup found later than this (scanner was paused) is not news any more
const TFS = { '5m': { ms: 5 * MIN, iv: '5m' }, '15m': { ms: 15 * MIN, iv: '15m' }, '1H': { ms: HOUR, iv: '1h' }, '4H': { ms: 4 * HOUR, iv: '4h' } };
const MAX_COINS = 30;
const CHUNK = 1440 * MIN;   // one request window: simApi's kline helpers stop at 3,000 candles a call
const MAX_LOADS = 5;        // full candle loads a minute: the bot shares this IP's Binance request budget
const MAX_EVENTS = 60, MAX_LINES = 10, MAX_BODY = 4096;
const BACKOFF = 5 * MIN, NO_COIN = 30 * MIN;
const SETTING = 'aplus_watch';
const DEFAULTS = { on: false, coins: [], tfs: ['15m'], ex: 'binance', ready: true };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hm = t => new Date(t).toISOString().slice(11, 16);
const coinName = s => String(s).replace(/USDT$/, '');
const precFor = p => (p > 0 ? Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(p)))) : 4);
const nextTurn = () => new Promise(r => setImmediate(r));   // lets the bot's own work run between coins

function cleanCoin(s) {
  const c = String(s || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 30);
  return c.length > 4 && c.endsWith('USDT') ? c : null;
}

function clean(p, cur) {
  const c = { ...cur };
  if (p.on !== undefined) c.on = p.on === true;
  if (p.ready !== undefined) c.ready = p.ready === true;
  if (p.ex === 'binance' || p.ex === 'bybit') c.ex = p.ex;
  if (Array.isArray(p.coins)) c.coins = [...new Set(p.coins.slice(0, 300).map(cleanCoin).filter(Boolean))].slice(0, MAX_COINS);
  if (Array.isArray(p.tfs)) { const t = Object.keys(TFS).filter(x => p.tfs.includes(x)); if (t.length) c.tfs = t; }
  return c;
}

const firstAt = (B, t) => { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] < t) lo = m + 1; else hi = m; } return lo; };

// stop or target after the trigger, up to the clock (a candle that reaches both counts as the stop), as on the chart
function outcome(s, B, end) {
  for (let i = firstAt(B, s.t + 1); i < B.length && B[i][0] + MIN <= end; i++) {
    const k = B[i];
    if (s.dir === -1 ? k[2] >= s.stop : k[3] <= s.stop) return 'stop';
    if (s.dir === -1 ? k[3] <= s.target : k[2] >= s.target) return 'target';
  }
  return null;
}

// One read of one coin on one timeframe, the chart's alert rules. `m` is what was already reported, updated in place.
// The first read only remembers: setups already on the chart are not news.
function readAlerts(m, A, B, end) {
  const out = [], l = A.setups.length ? A.setups[A.setups.length - 1] : null, conf = l ? l.conf : 0, first = m.seen == null;
  if (first) m.seen = conf;
  else if (conf > m.seen) {
    m.seen = conf;
    if (end - l.conf <= LATE && !outcome(l, B, end)) out.push({ stage: 3, setup: l });
  }
  const g = A.leg;
  if (g && !g.dead && g.brk && g.sweep && g.trig && end - g.sweep.conf < ARMED_WINDOW) {
    const key = g.brk.t + '|' + g.sweep.t;
    if (key !== m.armed) {
      m.armed = key;
      if (!first && !(m.armedLeg === g.brk.t && end - m.armedAt < ARMED_QUIET)) { m.armedLeg = g.brk.t; m.armedAt = end; out.push({ stage: 2, leg: g, key }); }
    }
  }
  return out;
}

function toEvent(hit, sym, tf, ex, id, at) {
  const coin = coinName(sym), f = v => (+v).toFixed(precFor(+v));
  if (hit.stage === 3) {
    const s = hit.setup;
    return { id, at, stage: 3, sym, tf, ex, side: s.side, tone: s.side === 'long' ? 'up' : 'down', conf: s.conf, key: String(s.t),
      title: `🎯 A+ ${s.side} · ${coin} ${tf}`, body: `Entry ${f(s.entry)}, stop ${f(s.stop)}, target ${f(s.target)} (${s.R.toFixed(1)}R)` };
  }
  const g = hit.leg, short = g.dir === -1, side = short ? 'short' : 'long';
  return { id, at, stage: 2, sym, tf, ex, side, tone: short ? 'down' : 'up', conf: 0, key: hit.key, leg: g.brk.t,
    title: `🔔 A+ ${side} almost ready · ${coin} ${tf}`, body: `Sweep done. It triggers on a 1-minute close ${short ? 'below' : 'above'} ${f(g.trig.p)}.` };
}

function chartLink(ev) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  return /^https:/.test(base) ? `${base}/app#chart=${encodeURIComponent(ev.sym)}/${ev.tf}/${ev.ex}` : '';
}

function message(events, now) {
  const list = [...events].sort((a, b) => b.stage - a.stage), shown = list.slice(0, MAX_LINES);
  return `🔔 <b>A+ Watchlist</b> · ${hm(now)} UTC\n\n` + shown.map(e => {
    const u = chartLink(e);
    return `<b>${esc(e.title)}</b>\n${esc(e.body)}${u ? `\n<a href="${esc(u)}">Open chart</a>` : ''}`;
  }).join('\n\n') + (list.length > shown.length ? `\n\n+${list.length - shown.length} more` : '') + '\n\n<i>Practice setups, not signals</i>';
}

const dbStore = {
  async load() { const r = await siteDb.q('SELECT value FROM web_settings WHERE key = $1', [SETTING]); return r.rows[0] ? r.rows[0].value : null; },
  async save(v) { await siteDb.q('INSERT INTO web_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [SETTING, JSON.stringify(v)]); },
};

class AplusWatch {
  // send(html) delivers one message to the owner's DM. klines and store can be replaced in tests.
  constructor({ send, klines, store, now } = {}) {
    this.send = send;
    this.kl = klines || { binance: simApi.binanceKlines, bybit: simApi.bybitKlines };
    this.store = store || dbStore;
    this.now = now || Date.now;
    this.cfg = { ...DEFAULTS };
    this.coins = new Map();    // sym → { ex, base, all: closed 1m candles, hist: { tf: older structure candles } }
    this.marks = new Map();    // sym|tf → what was already reported
    this.skip = new Map();     // sym → when to look for its candles again
    this.events = [];
    this.fresh = [];           // found, not yet sent
    this.seq = this.now();     // ids keep rising across restarts
    this.pause = 0;
    this.running = false;
    this.timer = null;
    this.last = null;
    this.sendErr = '';
  }

  // The site's tables are created just after boot, so the saved settings may take a moment
  async load() {
    for (let i = 0; i < 12; i++) {
      if (this.store !== dbStore || siteDb.ready()) {
        const v = await this.store.load();
        if (v) this.cfg = clean(v, DEFAULTS);
        return this.cfg;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    logger.warn('[A+ WATCH] settings not loaded: accounts database not ready');
    return this.cfg;
  }

  forget() { this.coins.clear(); this.marks.clear(); this.skip.clear(); this.fresh = []; this.last = null; }

  async set(patch) {
    const before = this.cfg, next = clean(patch, before);
    await this.store.save(next);
    this.cfg = next;
    if (!next.on || next.ex !== before.ex) this.forget();
    if (next.on && !before.on) {
      await this.deliver(`🔔 <b>A+ Watchlist alerts on</b>\n${next.coins.length} coin${next.coins.length === 1 ? '' : 's'} · ${next.tfs.join(', ')}\nYou will get a message here ${next.ready ? 'when a setup is almost ready and when it triggers' : 'when a setup triggers'}, also with the desk closed.\n\n<i>Practice setups, not signals</i>`);
    }
    return next;
  }

  start() {
    if (this.timer) return;
    const next = () => { this.timer = setTimeout(() => this.tick().catch(e => logger.error(`[A+ WATCH] ${e.message}`)).finally(next), MIN - (Date.now() % MIN) + 4000); };
    next();   // a few seconds after each minute, when the minute's candle has closed on the exchanges
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async deliver(html) {
    if (!this.send) return false;
    try { await this.send(html); this.sendErr = ''; return true; } catch (e) { this.sendErr = 'Telegram did not take the last alert'; logger.warn(`[A+ WATCH] Telegram send failed: ${e.message}`); return false; }
  }

  async flush() {
    if (!this.fresh.length) return;
    const list = this.fresh; this.fresh = [];
    await this.deliver(message(list, this.now()));
  }

  emit(hit, sym, tf, ex) {
    if (hit.stage === 2 && !this.cfg.ready) return;
    const ev = toEvent(hit, sym, tf, ex, ++this.seq, this.now());
    this.events.push(ev); if (this.events.length > MAX_EVENTS) this.events.shift();
    this.fresh.push(ev);
  }

  async loadCoin(sym, end) {
    const b4 = TFS['4H'].ms, from = Math.floor((end - DAYS * DAY) / b4) * b4, order = this.cfg.ex === 'bybit' ? ['bybit', 'binance'] : ['binance', 'bybit'];
    for (const ex of order) {
      let ks = [];
      // only a coin this exchange does not list moves to the other one: a timeout or rate limit just waits for the next minute
      try { for (let t = from; t < end; t += CHUNK) ks = ks.concat(await this.kl[ex](sym, '1m', t, Math.min(t + CHUNK, end) - 1)); } catch (e) { if (!/symbol/i.test(e.message)) throw e; ks = []; }
      ks = ks.filter(k => k[0] + MIN <= end);
      if (ks.length >= 30) { const c = { ex, base: end, all: ks, hist: {} }; this.coins.set(sym, c); this.skip.delete(sym); return c; }
    }
    this.coins.delete(sym); this.skip.set(sym, this.now() + NO_COIN);
    return null;
  }

  async update(sym, c, end) {
    const last = c.all[c.all.length - 1][0];
    if (last + MIN >= end) return;
    const ks = await this.kl[c.ex](sym, '1m', last + MIN, end - 1);
    for (const k of ks) if (k[0] > c.all[c.all.length - 1][0] && k[0] + MIN <= end) c.all.push(k);
  }

  async readTf(sym, c, tf, end) {
    const T = TFS[tf], from = Math.floor((c.base - DAYS * DAY) / T.ms) * T.ms;
    if (!c.hist[tf]) c.hist[tf] = (await this.kl[c.ex](sym, T.iv, from - HIST * T.ms, from - 1)).filter(k => k[0] + T.ms <= from);
    const B = c.all.slice(firstAt(c.all, from));
    if (B.length < 30) return;
    const h = c.hist[tf], A = SMC.analyze(B, B.length - 1, { tf: T.ms, hist: h.length ? { k: h, step: T.ms } : null });
    const key = sym + '|' + tf, m = this.marks.get(key) || { seen: null, armed: '', armedLeg: 0, armedAt: 0 };
    this.marks.set(key, m);
    for (const hit of readAlerts(m, A, B, end)) this.emit(hit, sym, tf, c.ex);
  }

  async check(sym, end) {
    let c = this.coins.get(sym);
    if (!c || end - c.base > DAY) c = await this.loadCoin(sym, end); else await this.update(sym, c, end);
    if (!c) return;
    for (const tf of this.cfg.tfs) { await this.readTf(sym, c, tf, end); await nextTurn(); }
  }

  async tick() {
    if (!this.cfg.on || this.running || this.now() < this.pause) return;
    this.running = true;
    const t0 = this.now();
    let fails = 0;
    const guard = async (sym, end) => {
      try { await this.check(sym, end); } catch (e) {
        fails++;
        if (/too many|429|418|banned|rate limit/i.test(e.message)) { this.pause = this.now() + BACKOFF; logger.warn(`[A+ WATCH] rate limited, waiting 5 minutes: ${e.message}`); }
      }
    };
    try {
      const end = Math.floor(t0 / MIN) * MIN, want = new Set(this.cfg.coins), tfs = new Set(this.cfg.tfs);
      for (const s of [...this.coins.keys()]) if (!want.has(s)) this.coins.delete(s);
      for (const k of [...this.marks.keys()]) { const [s, tf] = k.split('|'); if (!want.has(s) || !tfs.has(tf)) this.marks.delete(k); }
      const due = this.cfg.coins.filter(s => (this.skip.get(s) || 0) <= t0), stale = s => { const c = this.coins.get(s); return !c || end - c.base > DAY; };
      const ready = due.filter(s => !stale(s)), loads = due.filter(stale).slice(0, MAX_LOADS);
      let i = 0;
      const worker = async () => { while (i < ready.length && this.cfg.on && this.now() >= this.pause) await guard(ready[i++], end); };
      await Promise.all([worker(), worker(), worker()]);
      await this.flush();
      for (const s of loads) { if (!this.cfg.on || this.now() < this.pause) break; await guard(s, end); }
      await this.flush();
      if (this.cfg.on) this.last = { at: this.now(), ms: this.now() - t0, fails };
    } finally { this.running = false; }
  }

  status() {
    const c = this.cfg;
    return { loaded: c.coins.filter(s => this.coins.has(s)).length, coins: c.coins.length, max: MAX_COINS, at: this.last ? this.last.at : 0, fails: this.last ? this.last.fails : 0,
      missing: c.coins.filter(s => (this.skip.get(s) || 0) > this.now()).map(coinName), paused: this.pause > this.now(), sendErr: this.sendErr };
  }

  // GET /api/aplus/watch?since=<id>: settings, status and the alerts after that id · POST: change the settings
  async handle(req, url, res) {
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (url.pathname !== '/api/aplus/watch') return json(404, { error: 'Not found' });
    try {
      if (req.method === 'POST') {
        const body = await new Promise((resolve, reject) => {
          let n = 0; const parts = [];
          req.on('data', d => { n += d.length; if (n <= MAX_BODY) parts.push(d); });
          req.on('end', () => { if (n > MAX_BODY) return reject(new Error('Request too large')); try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(new Error('Invalid JSON')); } });
          req.on('error', reject);
        });
        await this.set(body && typeof body === 'object' ? body : {});
      } else if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const since = Number(url.searchParams.get('since'));
      json(200, { cfg: this.cfg, status: this.status(), last: this.seq, events: Number.isFinite(since) && since > 0 ? this.events.filter(e => e.id > since) : [] });
    } catch (e) { json(/too large|invalid json/i.test(e.message) ? 400 : 500, { error: e.message }); }
  }
}

module.exports = { AplusWatch, readAlerts, outcome, toEvent, message, clean, DEFAULTS, TFS, MAX_COINS };
