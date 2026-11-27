// Desk auto-trade (admin; ReplayDesk /app → Real → Auto trade). You switch it on for a chart (coin + exchange) and one setup:
// the A+ setup on a timeframe, or RD ▲ / ▼. While it is on, the server takes that setup whenever it appears, with the desk closed:
// - read a few seconds after every minute with the chart's own rules and data: A+ = src/web/smcEngine.js on 3 days of 1-minute
//   candles + 300 structure candles (as src/collectors/aplusWatch.js), RD = src/web/rdEngine.js on 4 days of 1-minute candles
//   (the code deskpoi.js draws with), closed candles only, from the exchange the trade goes to;
// - placed through the bot's own order path (telegramBot webTrade.open → executeManual: the Real ticket's and /long · /short's
//   code), so the executor runs the stop and target and Telegram reports every step under "🤖 Auto-trade".
// The plan is the chart's: A+ = market order at once, the setup's stop and target. RD = limit in the middle of the 1-minute gap,
// cancelled when not filled in 30 minutes, stop past the move, target 3R, closed after 6 hours. Exit style "Hold to TP1" (no
// breakeven or trailing before it) with TP1 = the target; when the bot's TP1 has closed its share, this closes the rest, so the
// whole trade leaves at the target as tested (a minute or so later on the part that is left).
// Money: the bot's paper account unless a chart is set to Live (confirmed on the page); Live also needs /webtrade on in Telegram.
// Limits: one trade at a time per chart, at most `maxOpen` auto trades open, `maxDay` trades a day per chart, a daily loss
// stop, and the chart's days and hours (New York time). Turning auto trading off stops new trades; trades already placed keep
// their plan (stop, target, the RD 30-minute cancel and 6-hour exit).
// Tested: both setups lost after fees in our backtests (8 coins, Jan 2023 – Aug 2026, also on Wednesday–Friday New York hours).
const SMC = require('../web/smcEngine');
const RDE = require('../web/rdEngine');
const simApi = require('../web/simApi');
const siteDb = require('../web/site/db');
const logger = require('../utils/logger');

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR, M15 = 15 * MIN, H4 = 4 * HOUR;
const AP_DAYS = 3, HIST = 300, RD_DAYS = 4, LOAD_DAYS = 4;
const LATE = 2 * MIN;              // a setup first seen later than this (the server was busy or restarting) is not taken
const RD_FILL = RDE.FILL * MIN, RD_HOLD = RDE.HOLD * MIN;
const TFS = { '5m': { ms: 5 * MIN, iv: '5m' }, '15m': { ms: M15, iv: '15m' }, '30m': { ms: 30 * MIN, iv: '15m', merge: 2 }, '1H': { ms: HOUR, iv: '1h' }, '4H': { ms: H4, iv: '4h' } };
const HOURS = {
  any: { name: 'Any time', ok: () => true },
  ny: { name: 'New York session 08:00–17:00', ok: (t, n) => n.min >= 480 && n.min < 1020 },
  nyoc: { name: 'New York open + close 08–10, 15–17', ok: (t, n) => (n.min >= 480 && n.min < 600) || (n.min >= 900 && n.min < 1020) },
  opens: { name: 'London + New York opens 07–11, 13–17 UTC', ok: t => !!RDE.sessOf(t) },
};
const SETUPS = { aplus: 'A+', rd: 'RD' };
const MAX_CHARTS = 6, MAX_LOG = 150, MAX_BODY = 4096, CHUNK = 1440 * MIN, BACKOFF = 5 * MIN, CLOSE_TRIES = 5;
const CFG_KEY = 'desk_auto', LOG_KEY = 'desk_auto_log';
const DEFAULTS = { on: false, dayLoss: 25, maxOpen: 2, charts: [] };
const CHART_DEFAULTS = { setup: 'aplus', tf: '5m', side: 'both', mode: 'paper', margin: 100, lev: 10, days: [3, 4, 5], hours: 'ny', maxDay: 3, on: true };
const TESTED = 'Tested: A+ and RD ▲ / ▼ lost after fees in our backtests (8 coins, Jan 2023 – Aug 2026), also on Wednesday–Friday in New York hours.';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const coinOf = s => String(s).replace(/USDT$/, '');
const precFor = p => (p > 0 ? Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(p)))) : 4);
const fp = v => (v == null || !isFinite(v) ? '—' : (+v).toFixed(precFor(+v)));
const nextTurn = () => new Promise(r => setImmediate(r));
const msOf = v => { const x = v instanceof Date ? v.getTime() : Date.parse(v); return Number.isFinite(x) ? x : null; };   // pg gives Date objects
const firstAt = (B, t) => { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] < t) lo = m + 1; else hi = m; } return lo; };

// New York weekday (0 = Sunday), date and minute of the day
const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function ny(t) {
  const p = {}; for (const x of NYF.formatToParts(new Date(t))) p[x.type] = x.value;
  return { wd: WD.indexOf(p.weekday), day: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

// A+ stop or target after the trigger, up to the clock (a candle that reaches both counts as the stop), as on the chart
function apOutcome(s, B, end) {
  for (let i = firstAt(B, s.t + 1); i < B.length && B[i][0] + MIN <= end; i++) {
    const k = B[i];
    if (s.dir === -1 ? k[2] >= s.stop : k[3] <= s.stop) return 'stop';
    if (s.dir === -1 ? k[3] <= s.target : k[2] >= s.target) return 'target';
  }
  return null;
}

function mergeTo(ks, ms) {   // 15m candles → 30m (Binance and Bybit both start 30m candles on the half hour)
  const out = [];
  for (const k of ks) {
    const t = Math.floor(k[0] / ms) * ms, b = out[out.length - 1];
    if (b && b[0] === t) { b[2] = Math.max(b[2], k[2]); b[3] = Math.min(b[3], k[3]); b[4] = k[4]; b[5] += k[5]; } else out.push([t, k[1], k[2], k[3], k[4], k[5]]);
  }
  return out;
}

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
function cleanSym(s) { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24); return /^[A-Z0-9]{2,20}USDT$/.test(c) ? c : null; }

// one chart's settings from the page: every field checked, anything else ignored → { chart } or { error }
function cleanChart(p, cur) {
  const c = { ...CHART_DEFAULTS, ...(cur || {}) };
  const sym = cleanSym(p.sym != null ? p.sym : c.sym);
  if (!sym) return { error: 'Auto trade works on Binance / Bybit USDT coins (not FX).' };
  c.sym = sym;
  const ex = p.ex != null ? p.ex : c.ex;
  if (ex !== 'binance' && ex !== 'bybit') return { error: 'Pick Binance or Bybit.' };
  c.ex = ex;
  if (p.setup != null) { if (!SETUPS[p.setup]) return { error: 'Pick A+ or RD.' }; c.setup = p.setup; }
  if (c.setup === 'aplus') {
    if (p.tf != null) { if (!TFS[p.tf]) return { error: 'A+ timeframe: 5m, 15m, 30m, 1H or 4H.' }; c.tf = p.tf; }
    if (!TFS[c.tf]) c.tf = '5m';
  } else c.tf = '';
  if (p.side != null) { if (!['both', 'long', 'short'].includes(p.side)) return { error: 'Side: both, long or short.' }; c.side = p.side; }
  if (p.mode != null) { if (!['paper', 'live'].includes(p.mode)) return { error: 'Account: paper or live.' }; c.mode = p.mode; }
  if (p.margin != null) { const v = num(p.margin, 1, 10000); if (v == null) return { error: 'Margin: 1 – 10,000 USDT.' }; c.margin = Math.round(v * 100) / 100; }
  if (p.lev != null) { const v = num(p.lev, 1, 50); if (v == null) return { error: 'Leverage: 1 – 50×.' }; c.lev = Math.round(v); }
  if (p.days != null) {
    if (!Array.isArray(p.days)) return { error: 'Pick the days.' };
    const d = [...new Set(p.days.map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
    if (!d.length) return { error: 'Pick at least one day.' };
    c.days = d;
  }
  if (p.hours != null) { if (!HOURS[p.hours]) return { error: 'Pick the hours.' }; c.hours = p.hours; }
  if (p.maxDay != null) { const v = num(p.maxDay, 1, 20); if (v == null) return { error: 'Trades a day: 1 – 20.' }; c.maxDay = Math.round(v); }
  if (p.on != null) c.on = p.on === true;
  c.id = [c.sym, c.ex, c.setup, c.tf].join('|');
  return { chart: c };
}

function cleanCfg(v) {
  const c = { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
  c.on = c.on === true;
  c.dayLoss = num(c.dayLoss, 0, 100000) ?? DEFAULTS.dayLoss;
  c.maxOpen = Math.round(num(c.maxOpen, 1, 10) ?? DEFAULTS.maxOpen);
  const seen = new Set();
  c.charts = (Array.isArray(c.charts) ? c.charts : []).map(x => cleanChart(x || {}, x).chart).filter(x => x && !seen.has(x.id) && seen.add(x.id)).slice(0, MAX_CHARTS);
  return c;
}

const label = p => `${SETUPS[p.setup]}${p.setup === 'aplus' ? ' ' + p.tf : ''}`;
const sideWord = d => (d === 1 ? 'long' : 'short');

const dbStore = {
  async load(k) { const r = await siteDb.q('SELECT value FROM web_settings WHERE key = $1', [k]); return r.rows[0] ? r.rows[0].value : null; },
  async save(k, v) { await siteDb.q('INSERT INTO web_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [k, JSON.stringify(v)]); },
};

class DeskAuto {
  // send(html): the owner's Telegram DM. trade(): the bot's webTrade (open / manage / isOn / order / trade / tradeForOrder).
  // klines, store and now can be replaced in tests.
  constructor({ send, trade, klines, store, now } = {}) {
    this.send = send;
    this.T = typeof trade === 'function' ? trade : () => trade;
    this.kl = klines || { binance: simApi.binanceKlines, bybit: simApi.bybitKlines };
    this.store = store || dbStore;
    this.now = now || Date.now;
    this.cfg = cleanCfg(DEFAULTS);
    this.plans = [];           // every setup this acted on (placed, skipped, failed), newest last; active ones are managed
    this.seq = 0;
    this.data = new Map();     // sym|ex → { base, all: closed 1m candles, hist: { tf: older structure candles } }
    this.marks = new Map();    // chart id → { seen: conf of the last setup read, note, at }
    this.pause = 0;
    this.running = false;
    this.timer = null;
    this.err = '';
    this.lossNote = '';        // the New York day the daily loss stop was reported
    this.loaded = false;
  }

  async load() {
    for (let i = 0; i < 12; i++) {
      if (this.store !== dbStore || siteDb.ready()) {
        const [c, l] = await Promise.all([this.store.load(CFG_KEY), this.store.load(LOG_KEY)]);
        this.cfg = cleanCfg(c || DEFAULTS);
        if (l && Array.isArray(l.plans)) { this.plans = l.plans.slice(-MAX_LOG); this.seq = Number(l.seq) || this.plans.reduce((a, p) => Math.max(a, p.id || 0), 0); }
        this.loaded = true;
        return this.cfg;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    logger.warn('[AUTO DESK] settings not loaded: accounts database not ready');
    return this.cfg;
  }

  async saveCfg() { await this.store.save(CFG_KEY, this.cfg); }
  async saveLog() {
    const keep = this.plans.filter(p => p.st === 'wait' || p.st === 'open'), rest = this.plans.filter(p => !(p.st === 'wait' || p.st === 'open'));
    if (this.plans.length > MAX_LOG) this.plans = this.plans.filter(p => keep.includes(p) || rest.indexOf(p) >= rest.length - (MAX_LOG - keep.length));
    try { await this.store.save(LOG_KEY, { seq: this.seq, plans: this.plans }); } catch (e) { logger.warn(`[AUTO DESK] log not saved: ${e.message}`); }
  }

  start() {
    if (this.timer) return;
    const next = () => { this.timer = setTimeout(() => this.tick().catch(e => { this.err = e.message; logger.error(`[AUTO DESK] ${e.message}`); }).finally(next), MIN - (Date.now() % MIN) + 6000); };
    next();   // a few seconds after each minute (the A+ watch runs at +4 s), when the minute's candle has closed
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  async deliver(html) {
    if (!this.send) return;
    try { await this.send(html); } catch (e) { logger.warn(`[AUTO DESK] Telegram send failed: ${e.message}`); }
  }

  via(p) { return `🤖 <b>Auto-trade</b> · ${esc(label(p))} ${sideWord(p.dir)} · ${esc(coinOf(p.sym))}${p.mode === 'live' ? ' · 💰 LIVE' : ' · 📝 paper'}`; }

  // ---------------------------------------------------------------- candles
  async fetch1m(sym, ex, from, to) {
    let ks = [];
    for (let t = from; t < to; t += CHUNK) ks = ks.concat(await this.kl[ex](sym, '1m', t, Math.min(t + CHUNK, to) - 1));
    return ks;
  }

  async candles(sym, ex, end) {
    const key = sym + '|' + ex;
    let c = this.data.get(key);
    if (!c || end - c.base > DAY) {
      const from = Math.floor((end - LOAD_DAYS * DAY) / H4) * H4;
      const ks = (await this.fetch1m(sym, ex, from, end)).filter(k => k[0] + MIN <= end);
      if (ks.length < 120) throw new Error(`no 1-minute candles for ${coinOf(sym)} on ${ex}`);
      c = { base: end, all: ks, hist: {} };
      this.data.set(key, c);
      return c;
    }
    const last = c.all[c.all.length - 1][0];
    if (last + MIN < end) {
      const ks = await this.kl[ex](sym, '1m', last + MIN, end - 1);
      for (const k of ks) if (k[0] > c.all[c.all.length - 1][0] && k[0] + MIN <= end) c.all.push(k);
    }
    return c;
  }

  // the newest setup of this chart, read the chart's way → { sig, note } (sig: { key, dir, t, conf, entry, stop, target, R, ok })
  async read(ch, c, end) {
    if (ch.setup === 'aplus') {
      const T = TFS[ch.tf], from = Math.floor((c.base - AP_DAYS * DAY) / T.ms) * T.ms;
      if (!c.hist[ch.tf]) {
        let h = await this.kl[ch.ex](ch.sym, T.iv, from - HIST * T.ms, from - 1);
        if (T.merge) h = mergeTo(h, T.ms);
        c.hist[ch.tf] = h.filter(k => k[0] + T.ms <= from);
      }
      const B = c.all.slice(firstAt(c.all, from));
      if (B.length < 30) return { sig: null, note: 'loading' };
      const h = c.hist[ch.tf], A = SMC.analyze(B, B.length - 1, { tf: T.ms, hist: h.length ? { k: h, step: T.ms } : null });
      const s = A.setups.length ? A.setups[A.setups.length - 1] : null, g = A.leg;
      const note = g && !g.dead && g.brk && g.sweep && g.trig ? `sweep done: a 1m close ${g.dir === -1 ? 'below' : 'above'} ${fp(g.trig.p)} triggers a ${g.dir === -1 ? 'short' : 'long'}` : 'waiting for a setup';
      if (!s) return { sig: null, note };
      const done = apOutcome(s, B, end), px = B[B.length - 1][4];
      const ok = !done && (s.dir === 1 ? px > s.stop && px < s.target : px < s.stop && px > s.target);
      return { note, sig: { key: 'ap' + s.t, dir: s.dir, t: s.t, conf: s.conf, entry: s.entry, stop: s.stop, target: s.target, R: s.R, ok, why: done ? `price already reached the ${done}` : ok ? '' : 'price already past the stop or target', px } };
    }
    const from = Math.floor((c.base - RD_DAYS * DAY) / M15) * M15, K = c.all.slice(firstAt(c.all, from)), n = K.length;
    if (n < 120) return { sig: null, note: 'loading' };
    const out = RDE.scan(K, n), s = out.sigs.length ? out.sigs[out.sigs.length - 1] : null;
    const w = out.live.find(x => x.lv) || out.live[0];
    const note = w ? (w.lv ? `in a 15m gap: a 1m close ${w.side === 1 ? 'above' : 'below'} ${fp(w.lv.p)} gives RD ${w.side === 1 ? '▲' : '▼'} (${w.left} min left)` : `in a 15m gap, waiting for a 1m ${w.side === 1 ? 'lower high' : 'higher low'}`) : 'waiting for price to reach a 15m gap';
    if (!s) return { sig: null, note };
    // 'open': the rules count a fill on the candle that showed the signal (the 1m gap can come one candle after the break),
    // before anyone could have placed the limit; it is placed now if price is back on the limit's side
    const r = RDE.result(K, n, s), px = K[n - 1][4], alive = r.kind === 'wait' || r.kind === 'open';
    const ok = alive && (s.dir === 1 ? px > s.entry : px < s.entry);
    return { note, sig: { key: 'rd' + s.t, dir: s.dir, t: s.t, conf: s.conf, entry: s.entry, stop: s.stop, target: s.target, R: RDE.TGT, ok, why: !alive ? `price already reached the ${r.kind === 'stop' ? 'stop' : 'target'}` : ok ? '' : 'price already past the limit', px } };
  }

  // ---------------------------------------------------------------- the day so far (New York date): trades placed, and the
  // closed ones' P&L for each account (a paper loss never stops live trades)
  today(t) {
    const d = ny(t).day, mine = this.plans.filter(p => p.placedAt && p.st !== 'fail' && p.st !== 'skip' && ny(p.placedAt).day === d);
    const pnl = { paper: 0, live: 0 };
    for (const p of this.plans) if (p.st === 'done' && p.pnl != null && ny(p.endAt || p.placedAt).day === d) pnl[p.mode === 'live' ? 'live' : 'paper'] += p.pnl;
    for (const k of Object.keys(pnl)) pnl[k] = Math.round(pnl[k] * 100) / 100;
    return { day: d, placed: mine.length, pnl, mine };
  }
  active() { return this.plans.filter(p => p.st === 'wait' || p.st === 'open'); }

  // a new setup on a chart: take it, or write down why not
  async consider(ch, sig, end) {
    const base = { chart: ch.id, sym: ch.sym, ex: ch.ex, setup: ch.setup, tf: ch.tf, mode: ch.mode, margin: ch.margin, lev: ch.lev,
      key: ch.id + '|' + sig.key, dir: sig.dir, t: sig.t, conf: sig.conf, entry: sig.entry, stop: sig.stop, target: sig.target, R: sig.R, seenAt: this.now() };
    if (this.plans.some(p => p.key === base.key)) return null;
    const skip = why => this.log({ ...base, st: 'skip', why });
    if (end - sig.conf > LATE) return skip('found too late (the server was busy or restarting)');
    if (ch.side !== 'both' && sideWord(sig.dir) !== ch.side) return skip(`${sideWord(sig.dir)}: this chart takes ${ch.side}s only`);
    const n = ny(sig.t);
    if (!ch.days.includes(n.wd)) return skip(`${WD[n.wd]} is not one of this chart's days`);
    if (!HOURS[ch.hours].ok(sig.t, n)) return skip(`outside the hours (${HOURS[ch.hours].name})`);
    if (!sig.ok) return skip(sig.why);
    if (this.active().some(p => p.chart === ch.id)) return skip('this chart already has a trade running');
    const day = this.today(this.now());
    if (day.mine.filter(p => p.chart === ch.id).length >= ch.maxDay) return skip(`already ${ch.maxDay} trade${ch.maxDay === 1 ? '' : 's'} today on this chart`);
    if (this.active().length >= this.cfg.maxOpen) return skip(`${this.cfg.maxOpen} auto trade${this.cfg.maxOpen === 1 ? ' is' : 's are'} already open`);
    const lost = day.pnl[ch.mode === 'live' ? 'live' : 'paper'];
    if (this.cfg.dayLoss > 0 && lost <= -this.cfg.dayLoss) {
      const k = day.day + '|' + ch.mode;
      if (this.lossNote !== k) { this.lossNote = k; await this.deliver(`🤖 <b>Auto-trade stopped for today (${ch.mode === 'live' ? 'live money' : 'paper'})</b>\nThose auto trades lost ${Math.abs(lost).toFixed(2)} today (your daily stop: ${this.cfg.dayLoss}). New ${ch.mode === 'live' ? 'live' : 'paper'} setups are skipped until the New York day ends.`); }
      return skip(`daily loss stop: −${Math.abs(lost).toFixed(2)} today (${ch.mode})`);
    }
    const T = this.T();
    if (!T || !T.open) return skip('the bot is still starting');
    if (ch.mode === 'live' && !(await T.isOn())) return skip('web trading is off: send /webtrade on in Telegram');

    const rd = ch.setup === 'rd';
    const order = { symbol: coinOf(ch.sym), direction: sideWord(sig.dir), mode: ch.mode, margin: ch.margin, leverage: ch.lev, exchange: ch.ex, chartExchange: ch.ex,
      slPrice: sig.stop, tp1Price: sig.target, exitStyle: 'hold', ...(rd ? { limitPrice: sig.entry } : {}) };
    const p = this.log({ ...base, st: 'placing', kind: rd ? 'limit' : 'market', placedAt: this.now() });
    logger.info(`[AUTO DESK] ${label(ch)} ${order.direction} ${ch.sym} on ${ch.ex} (${ch.mode}) ${rd ? 'limit ' + sig.entry : 'market'} · stop ${sig.stop} · target ${sig.target}`);
    let r;
    try { r = await T.open(order, this.via(p)); } catch (e) { r = { error: e.message }; }
    if (r && r.ok) {
      if (r.kind === 'limit') { p.st = 'wait'; p.oid = r.id; } else { p.st = 'open'; p.tid = r.id; if (r.entry > 0) p.fill = r.entry; p.fillAt = this.now(); }
    } else if (r && r.open) {   // the bot keeps one trade per coin (yours, another chart's or the bot's own)
      p.st = 'skip'; p.why = `the bot already has a ${r.open.direction} open on ${coinOf(ch.sym)}`;
    } else {
      p.st = 'fail';
      p.why = (r && (r.error || (r.errors && r.errors[0]))) || 'not placed';
      await this.deliver(`${this.via(p)}\n⚠️ <b>Not placed</b>: ${esc(p.why)}`);
    }
    await this.saveLog();
    return p;
  }

  log(p) {
    const e = { id: ++this.seq, ...p };
    this.plans.push(e);
    return e;
  }

  // ---------------------------------------------------------------- the trades already placed
  async manage(p, now) {
    const T = this.T();
    if (!T || !T.order) return;
    if (p.st === 'wait') {
      const o = await T.order(p.oid);
      if (o) {
        if (now >= p.conf + RD_FILL) {
          const r = await T.manage({ action: 'cancel', id: p.oid, auto: true }, this.via(p));
          if (r && r.ok) { p.st = 'done'; p.res = 'nofill'; p.endAt = now; return true; }
          p.note = (r && r.error) || 'cancel failed';   // filled meanwhile: found next minute
        }
        return false;
      }
      const t = await T.tradeForOrder(p.oid);
      if (t) { p.st = 'open'; p.tid = t.id; return true; }
      p.st = 'done'; p.res = 'gone'; p.why = 'the limit order was cancelled or expired outside the auto-trader'; p.endAt = now;
      return true;
    }
    if (p.st !== 'open') return false;
    const t = await T.trade(p.tid);
    if (!t) { p.st = 'done'; p.res = 'gone'; p.endAt = now; return true; }
    if (t.status === 'open') {
      let ch = false;
      if (!p.fill && t.entry_price > 0) { p.fill = +t.entry_price; ch = true; }
      if (!p.fillAt || (p.kind === 'limit' && !p.filledAt)) { p.fillAt = msOf(t.created_at) || now; p.filledAt = true; ch = true; }
      const why = t.hit_tp1 ? 'target' : p.setup === 'rd' && now >= p.fillAt + RD_HOLD ? 'time' : null;
      if (why && (p.tries || 0) < CLOSE_TRIES) {
        p.closing = why;
        const r = await T.manage({ action: 'close', id: p.tid, auto: true }, this.via(p));
        if (!(r && r.ok)) {
          p.tries = (p.tries || 0) + 1;
          p.note = (r && r.error) || 'close failed';
          if (p.tries >= CLOSE_TRIES) await this.deliver(`${this.via(p)}\n⚠️ Could not close the trade at the ${why === 'target' ? 'target' : '6-hour limit'} (${esc(p.note)}). The bot still runs its stop and TPs; close it by hand if you want it out.`);
        }
        return true;
      }
      return ch;
    }
    p.st = 'done';
    p.pnl = Math.round(((Number(t.pnl_usd) || 0) + (Number(t.realized_pnl) || 0)) * 100) / 100;
    p.exit = t.exit_price != null ? +t.exit_price : null;
    p.res = p.closing || (/stop|sl/i.test(t.close_reason || '') ? 'stop' : /tp/i.test(t.close_reason || '') ? 'target' : /manual/i.test(t.close_reason || '') ? 'manual' : (t.close_reason || 'closed'));
    p.endAt = msOf(t.closed_at) || now;
    return true;
  }

  // ---------------------------------------------------------------- every minute
  async tick() {
    if (this.running || !this.loaded) return;
    this.running = true;
    try {
      const now = this.now(), end = Math.floor(now / MIN) * MIN;
      let changed = false;
      for (const p of this.active()) {
        try { if (await this.manage(p, now)) changed = true; } catch (e) { p.note = e.message; logger.warn(`[AUTO DESK] managing #${p.id}: ${e.message}`); }
      }
      if (this.cfg.on && now >= this.pause) {
        const want = new Set(this.cfg.charts.filter(c => c.on).map(c => c.sym + '|' + c.ex));
        for (const k of [...this.data.keys()]) if (!want.has(k)) this.data.delete(k);
        for (const k of [...this.marks.keys()]) if (!this.cfg.charts.some(c => c.id === k && c.on)) this.marks.delete(k);
        for (const ch of this.cfg.charts) {
          if (!ch.on || !this.cfg.on) continue;
          const m = this.marks.get(ch.id) || { seen: null, note: '', at: 0, err: '' };
          this.marks.set(ch.id, m);
          try {
            const c = await this.candles(ch.sym, ch.ex, end);
            const { sig, note } = await this.read(ch, c, end);
            m.note = note; m.at = this.now(); m.err = '';
            const conf = sig ? sig.conf : 0;
            if (m.seen == null) m.seen = conf;   // the first read only remembers: setups already on the chart are not news
            else if (sig && conf > m.seen) { m.seen = conf; if (await this.consider(ch, sig, end)) changed = true; }
          } catch (e) {
            m.err = e.message;
            if (/too many|429|418|banned|rate limit/i.test(e.message)) { this.pause = this.now() + BACKOFF; logger.warn(`[AUTO DESK] rate limited, waiting 5 minutes: ${e.message}`); break; }
          }
          await nextTurn();
        }
      }
      if (changed) await this.saveLog();
      this.err = '';
    } finally { this.running = false; }
  }

  // ---------------------------------------------------------------- the page
  status() {
    const now = this.now(), day = this.today(now);
    const charts = this.cfg.charts.map(ch => {
      const m = this.marks.get(ch.id), run = this.active().find(p => p.chart === ch.id);
      return { id: ch.id, at: m ? m.at : 0, note: m ? m.note : '', err: m ? m.err : '', busy: run ? run.id : 0,
        today: day.mine.filter(p => p.chart === ch.id).length, inHours: HOURS[ch.hours].ok(now, ny(now)) && ch.days.includes(ny(now).wd) };
    });
    const px = p => { const c = this.data.get(p.sym + '|' + p.ex); return c && c.all.length ? c.all[c.all.length - 1][4] : null; };
    const plans = this.plans.slice(-40).reverse().map(p => {
      const q = { ...p };
      if (p.st === 'open') { const x = px(p), e = p.fill || p.entry; if (x && e) q.nowR = Math.round((x - e) * p.dir / Math.abs(e - p.stop) * 100) / 100; }
      return q;
    });
    return { charts, plans, today: { placed: day.placed, pnl: day.pnl, day: day.day }, open: this.active().length, paused: this.pause > now, err: this.err };
  }

  async handle(req, url, res) {
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (url.pathname !== '/api/autotrade') return json(404, { error: 'Not found' });
    try {
      if (req.method === 'POST') {
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(415, { error: 'JSON only' });
        const b = await new Promise((resolve, reject) => {
          let n = 0; const parts = [];
          req.on('data', d => { n += d.length; if (n <= MAX_BODY) parts.push(d); });
          req.on('end', () => { if (n > MAX_BODY) return reject(new Error('Request too large')); try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { reject(new Error('Invalid JSON')); } });
          req.on('error', reject);
        });
        const err = await this.apply(b && typeof b === 'object' ? b : {});
        if (err) return json(err.code || 400, { error: err.error, needConfirm: !!err.needConfirm });
      } else if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const T = this.T();
      let webTrading = null;
      try { webTrading = T && T.isOn ? await T.isOn() : null; } catch (e) { webTrading = null; }
      json(200, { cfg: this.cfg, status: this.status(), webTrading, now: this.now(), tested: TESTED, max: MAX_CHARTS, hours: Object.fromEntries(Object.entries(HOURS).map(([k, v]) => [k, v.name])) });
    } catch (e) { json(/too large|invalid json/i.test(e.message) ? 400 : 500, { error: e.message }); }
  }

  // the page's changes → null, or { error, code?, needConfirm? }
  async apply(b) {
    if (!this.loaded) return { error: 'Starting up, try again in a minute', code: 503 };
    const c = this.cfg;
    if (b.action === 'master') {
      const on = b.on === true;
      if (on && !c.on && c.charts.some(x => x.on && x.mode === 'live') && b.confirm !== true) return { error: 'A chart is set to live money: confirm to start.', needConfirm: true, code: 409 };
      if (on !== c.on) { c.on = on; await this.saveCfg(); await this.deliver(on ? `🤖 <b>Auto-trade ON</b>\n${this.summary()}` : '🤖 <b>Auto-trade OFF</b>\nNo new trades. Trades already placed keep their stop, target and plan.'); }
      return null;
    }
    if (b.action === 'limits') {
      const dl = b.dayLoss != null ? num(b.dayLoss, 0, 100000) : c.dayLoss, mo = b.maxOpen != null ? num(b.maxOpen, 1, 10) : c.maxOpen;
      if (dl == null) return { error: 'Daily loss stop: 0 (off) – 100,000 USDT.' };
      if (mo == null) return { error: 'Open auto trades: 1 – 10.' };
      c.dayLoss = Math.round(dl * 100) / 100; c.maxOpen = Math.round(mo);
      await this.saveCfg();
      return null;
    }
    if (b.action === 'save') {
      const p = b.chart && typeof b.chart === 'object' ? b.chart : {};
      const old = c.charts.find(x => x.id === p.id) || null;
      const r = cleanChart(p, old);
      if (r.error) return { error: r.error };
      const ch = r.chart, same = c.charts.find(x => x.id === ch.id);
      if (!same && !old && c.charts.length >= MAX_CHARTS) return { error: `Up to ${MAX_CHARTS} charts: remove one first.` };
      const wasLive = (same || old) && (same || old).mode === 'live' && (same || old).on;
      if (ch.mode === 'live' && ch.on && !wasLive && b.confirm !== true) return { error: 'Live money: confirm first.', needConfirm: true, code: 409 };
      c.charts = c.charts.filter(x => x.id !== ch.id && (!old || x.id !== old.id));
      c.charts.push(ch);
      if (old && old.id !== ch.id) this.marks.delete(old.id);
      await this.saveCfg();
      if (ch.mode === 'live' && ch.on && !wasLive) await this.deliver(`🤖 <b>Auto-trade: LIVE money on ${esc(coinOf(ch.sym))}</b>\n${esc(this.chartLine(ch))}\n${c.on ? 'Auto trading is on: the next setup is placed with real money.' : 'Auto trading is off until you switch it on.'}`);
      return null;
    }
    if (b.action === 'remove' || b.action === 'pause') {
      const ch = c.charts.find(x => x.id === b.id);
      if (!ch) return { error: 'That chart is not on the list.' };
      if (b.action === 'remove') c.charts = c.charts.filter(x => x !== ch);
      else {
        const on = b.on === true;
        if (on && !ch.on && ch.mode === 'live' && b.confirm !== true) return { error: 'Live money: confirm first.', needConfirm: true, code: 409 };
        ch.on = on;
      }
      this.marks.delete(ch.id);
      await this.saveCfg();
      return null;
    }
    return { error: 'Unknown action' };
  }

  chartLine(ch) {
    const days = ch.days.length === 7 ? 'every day' : ch.days.map(d => WD[d]).join(' ');
    return `${coinOf(ch.sym)} ${ch.ex} · ${label(ch)} · ${ch.side === 'both' ? 'long + short' : ch.side + ' only'} · ${ch.mode === 'live' ? 'LIVE' : 'paper'} $${ch.margin} × ${ch.lev} · ${days} · ${HOURS[ch.hours].name}`;
  }

  summary() {
    const on = this.cfg.charts.filter(c => c.on);
    return (on.length ? on.map(c => '• ' + esc(this.chartLine(c))).join('\n') : 'No chart is switched on yet.') +
      `\nLimits: ${this.cfg.maxOpen} open at a time${this.cfg.dayLoss > 0 ? `, stop for the day at −$${this.cfg.dayLoss}` : ''}.\n<i>${esc(TESTED)}</i>`;
  }
}

module.exports = { DeskAuto, cleanChart, cleanCfg, ny, apOutcome, mergeTo, HOURS, TFS, DEFAULTS, CHART_DEFAULTS, MAX_CHARTS, LATE };
