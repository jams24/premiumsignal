// SMC practice alerts in the owner's Telegram DM (/smcalerts): the Simulator's 🧱 zone first touch, ⚠️ 3/4 sweep and
// 🎯 A+ alerts, checked by the bot every minute so they arrive with the dashboard closed. Coins: the 50 biggest USDT
// perps by 24h volume, the bot's pump signals of the last 48 h and the coins the owner adds. Same rules as the page
// (src/web/simulator.html, checkAlerts / makeAlert) on closed 1m candles, src/web/smcEngine.js for the structure.
// Read-only: public candles (Bybit first, so the live bot keeps its Binance request budget); it never trades.
const SMC = require('../web/smcEngine');
const simApi = require('../web/simApi');
const db = require('../db/database');
const logger = require('../utils/logger');

const MIN = 60e3;
const DEFAULTS = { on: false, side: 'both', zone: true, heads: true, aplus: true, tf: 15, top: true, signals: true, coins: [] };
const SIDES = ['both', 'short', 'long', 'a3'];
const SIDE_TXT = { both: 'shorts + longs', short: 'shorts only', long: 'longs only', a3: 'A+++ longs only' };
const MAX_COINS = 30;          // coins the owner can add
const MAX_LINES = 15;          // alerts in one message (Telegram caps a message at 4096 characters)
const KIND_ORDER = { aplus: 0, heads: 1, zone: 2 };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const precFor = p => p > 0 ? Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(p)))) : 4;
const hm = t => new Date(t).toISOString().slice(11, 16);
const base = s => String(s).replace(/USDT$/, '');

function spot(x) {   // where the sweep wick sat in the move (1 = the far end), and whether it reached the order-block zone
  const sh = x.dir === -1, w = x.sweep.wick, rng = x.hi - x.lo;
  return { sh, depth: rng > 0 ? (sh ? w - x.lo : x.hi - w) / rng : 0, zone: !!x.zone && (sh ? w >= x.zone.bot : w <= x.zone.top) };
}
const isA3 = x => { const p = spot(x); return !p.sh && (p.depth >= 0.75 || p.zone); };   // A+++ long: deep discount or demand zone
function whereOf(x) {
  const { sh, depth, zone } = spot(x);
  return (depth >= 0.75 ? (sh ? 'top of premium' : 'bottom of discount') : (sh ? 'mid premium' : 'mid discount')) + (zone ? (sh ? ', in supply zone' : ', in demand zone') : '');
}

// The alert lines, worded as on the page
function makeAlert(kind, sym, x, px, tf) {
  const sh = x.dir === -1, side = sh ? 'short' : 'long', f = v => (+v).toFixed(precFor(px)), b = `<b>${esc(sym)}</b>`;
  const a = { kind, sym, side };
  if (kind === 'zone') return Object.assign(a, { title: `🧱 ${b} at the ${sh ? 'supply' : 'demand'} zone`,
    body: `${f(x.zone.bot)}–${f(x.zone.top)} · ${side} idea (${tf}m), first touch · next: a sweep, then a 1m close ${sh ? 'below' : 'above'} the last 1m swing` });
  const where = whereOf(x), a3 = isA3(x);
  if (kind === 'aplus') return Object.assign(a, { title: `🎯 ${b} ${a3 ? 'A+++' : 'A+'} ${side}`,
    body: `entry ${f(x.entry)} · stop ${f(x.stop)} · target ${f(x.target)} · ${x.R.toFixed(1)}R · wick ${where}` });
  return Object.assign(a, { title: `⚠️ ${b} ${a3 ? 'A+++ ' : ''}${side} 3/4`,
    body: `swept ${f(x.sweep.wick)} (${where}) · A+ if a 1m candle closes ${sh ? 'below' : 'above'} ${f(x.trig.p)}` });
}

// New alerts for one coin from one analysis (the page's checkAlerts). `prev` is that coin's memory of what it already
// reported; it is updated in place. Nothing is returned on a quiet pass (first look at a coin), only remembered.
function checkCoin(prev, sym, A, cfg, quiet) {
  const out = [];
  const want = x => cfg.side === 'both' || cfg.side === (x.dir === -1 ? 'short' : 'long') || (cfg.side === 'a3' && isA3(x));
  const last = A.setups[A.setups.length - 1];
  if (last && last.conf > prev.conf) {
    if (!quiet && cfg.aplus && want(last) && A.now - last.conf <= 10 * MIN) out.push(makeAlert('aplus', sym, last, A.price, cfg.tf));
    prev.conf = last.conf;
  }
  const leg = A.leg && !A.leg.dead ? A.leg : null;
  // price reached the zone of the move that made the last break (demand for a long idea, supply for a short), first time,
  // and hasn't closed through it
  if (leg && leg.zone && leg.inZone) {
    const key = leg.brk.t + '|' + leg.zone.t, z = leg.zone, held = leg.dir === -1 ? A.price <= z.top : A.price >= z.bot;
    const side = cfg.side === 'both' || cfg.side === (leg.dir === -1 ? 'short' : 'long') || (cfg.side === 'a3' && leg.dir === 1);
    if (key !== prev.zone) {
      prev.zone = key;
      if (!quiet && cfg.zone && side && held && A.now - leg.inZone.t <= 15 * MIN) out.push(makeAlert('zone', sym, leg, A.price, cfg.tf));
    }
  }
  if (leg && leg.prem && leg.sweep && leg.trig) {
    const key = leg.brk.t + '|' + leg.sweep.wickT;
    if (key !== prev.heads) { prev.heads = key; if (!quiet && cfg.heads && want(leg)) out.push(makeAlert('heads', sym, leg, A.price, cfg.tf)); }
  }
  return out;
}

class SmcAlerts {
  // send(html) delivers one message to the owner's DM
  constructor({ send }) {
    this.send = send;
    this.cfg = { ...DEFAULTS };
    this.cache = new Map();   // sym → { ex, c: 1m candles, last 24–26 h }
    this.seen = new Map();    // sym → { conf, zone, heads } already reported
    this.skip = new Map();    // sym → time to try again (no candles)
    this.running = false;
    this.timer = null;
    this.last = null;         // the last check, for the panel
    this.today = { day: '', zone: 0, heads: 0, aplus: 0, msgs: 0 };
    this.list = { at: 0, coins: [], why: {} };
  }

  async load() {
    const c = await db.getSmcAlerts().catch(e => { logger.warn(`[SMC ALERTS] settings load failed: ${e.message}`); return {}; });
    this.cfg = { ...DEFAULTS, ...c, coins: Array.isArray(c?.coins) ? c.coins : [] };
  }

  // Saves a change. A new structure, side or turning on starts a fresh quiet look, so setups already in place are not
  // sent as new
  async set(patch) {
    const before = this.cfg;
    this.cfg = { ...this.cfg, ...patch };
    await db.saveSmcAlerts(this.cfg);
    if (!this.cfg.on) { this.cache.clear(); this.seen.clear(); this.skip.clear(); this.last = null; }
    else if (!before.on || before.tf !== this.cfg.tf) this.seen.clear();
    if (this.cfg.on && !before.on) this.list.at = 0;
    return this.cfg;
  }

  start() {
    if (this.timer) return;
    const next = () => { this.timer = setTimeout(() => this.tick().catch(e => logger.error(`[SMC ALERTS] ${e.message}`)).finally(next), MIN - (Date.now() % MIN) + 4000); };
    next();   // a few seconds after each minute, when the minute's candle has closed on the exchanges
  }

  stop() { clearTimeout(this.timer); this.timer = null; }

  // Top 50 by volume + pump signals of the last 48 h + the owner's coins, refreshed every 10 min
  async coinList(force) {
    if (!force && this.list.coins.length && Date.now() - this.list.at < 10 * MIN) return this.list;
    const coins = [], why = {};
    const add = (sym, tag) => { sym = base(sym); if (!sym) return; if (!why[sym]) { coins.push(sym); why[sym] = tag; } };
    for (const s of this.cfg.coins) add(s, 'yours');
    if (this.cfg.signals) {
      try {
        const r = await db.query(`SELECT symbol, MAX(created_at) t FROM pump_signals WHERE created_at > NOW() - INTERVAL '48 hours' GROUP BY symbol ORDER BY t DESC`);
        for (const x of r.rows) add(x.symbol, 'signal');
      } catch (e) { logger.warn(`[SMC ALERTS] signals: ${e.message}`); }
    }
    if (this.cfg.top) {
      try { for (const c of await simApi.topCoins()) add(c.symbol, 'top'); } catch (e) { logger.warn(`[SMC ALERTS] top coins: ${e.message}`); }
    }
    if (coins.length) this.list = { at: Date.now(), coins, why };
    for (const s of [...this.cache.keys()]) if (!why[s]) { this.cache.delete(s); this.seen.delete(s); }
    return this.list;
  }

  // 1m candles: Bybit first (falls back to Binance for coins Bybit lacks); first look loads 24 h, then only new candles
  async candles(sym) {
    const now = Date.now(), pair = sym + 'USDT';
    let e = this.cache.get(sym);
    if (!e || now - e.c[e.c.length - 1][0] > 6 * 3600e3) {
      let c = [], ex = null;
      for (const x of ['bybit', 'binance']) {
        try { c = x === 'bybit' ? await simApi.bybitKlines(pair, '1m', now - 24 * 3600e3, now) : await simApi.binanceKlines(pair, '1m', now - 24 * 3600e3, now); } catch (err) {
          // only a coin Bybit doesn't list goes to Binance: a Bybit rate limit or timeout must not move the whole list onto
          // the live bot's Binance budget — that coin just waits for the next minute
          if (x === 'bybit' && !/symbol/i.test(err.message)) throw err;
          c = [];
        }
        if (c.length >= 300) { ex = x; break; }
      }
      if (!ex) { this.skip.set(sym, now + 30 * MIN); this.cache.delete(sym); return null; }
      e = { ex, c }; this.cache.set(sym, e); this.seen.delete(sym);   // a fresh look is a quiet one
      return e;
    }
    const from = e.c[e.c.length - 1][0];
    const add = e.ex === 'bybit' ? await simApi.bybitKlines(pair, '1m', from, now) : await simApi.binanceKlines(pair, '1m', from, now);
    for (const k of add) { const i = e.c.length - 1; if (k[0] === e.c[i][0]) e.c[i] = k; else if (k[0] > e.c[i][0]) e.c.push(k); }
    let drop = 0; const cut = now - 26 * 3600e3; while (drop < e.c.length && e.c[drop][0] < cut) drop++; if (drop > 60) e.c.splice(0, drop);
    return e;
  }

  async checkSym(sym) {
    if ((this.skip.get(sym) || 0) > Date.now()) return [];
    const e = await this.candles(sym);
    if (!e) return [];
    const last = e.c.length - 1, upto = e.c[last][0] + MIN > Date.now() ? last - 1 : last;   // closed candles only
    const A = SMC.analyze(e.c, upto, { tf: this.cfg.tf * MIN });
    const quiet = !this.seen.has(sym);
    const prev = this.seen.get(sym) || { conf: 0, zone: '', heads: '' };
    const out = checkCoin(prev, sym, A, this.cfg, quiet);
    this.seen.set(sym, prev);
    return out;
  }

  async tick() {
    if (!this.cfg.on || this.running) return;
    this.running = true;
    const t0 = Date.now();
    try {
      const { coins, why } = await this.coinList();
      const alerts = [];
      let next = 0, fails = 0;
      const worker = async () => {
        while (this.cfg.on && next < coins.length) {
          const sym = coins[next++];
          try { alerts.push(...await this.checkSym(sym)); } catch (e) { fails++; }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!this.cfg.on) return;
      const day = new Date().toISOString().slice(0, 10);
      if (this.today.day !== day) this.today = { day, zone: 0, heads: 0, aplus: 0, msgs: 0 };
      for (const a of alerts) this.today[a.kind]++;
      this.last = { at: Date.now(), coins: coins.length, fails, ms: Date.now() - t0, alerts: alerts.length,
        top: coins.filter(s => why[s] === 'top').length, signal: coins.filter(s => why[s] === 'signal').length, yours: coins.filter(s => why[s] === 'yours').length };
      if (alerts.length) {
        this.today.msgs++;
        await this.send(this.message(alerts)).catch(e => logger.warn(`[SMC ALERTS] Telegram send failed: ${e.message}`));
      }
    } finally {
      this.running = false;
    }
  }

  message(alerts) {
    alerts.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const shown = alerts.slice(0, MAX_LINES);
    return `🔔 <b>SMC alerts</b> · ${hm(Date.now())} UTC · ${this.cfg.tf}m structure\n\n` +
      shown.map(a => `${a.title}\n${a.body}`).join('\n\n') +
      (alerts.length > shown.length ? `\n\n+${alerts.length - shown.length} more` : '') +
      '\n\n<i>Practice alerts, tested ≈ random entries · /smcalerts</i>';
  }

  // Coin check for /smcalerts add: does either exchange have 1m candles for it?
  async exists(sym) {
    const now = Date.now(), pair = base(sym) + 'USDT';
    for (const f of [simApi.bybitKlines, simApi.binanceKlines]) {
      try { if ((await f(pair, '1m', now - 10 * MIN, now)).length) return true; } catch (e) { /* try the other */ }
    }
    return false;
  }
}

module.exports = { SmcAlerts, checkCoin, makeAlert, DEFAULTS, SIDES, SIDE_TXT, MAX_COINS };
