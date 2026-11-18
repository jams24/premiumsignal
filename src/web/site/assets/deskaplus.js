/* ReplayDesk · A+ setups on the chart (Indicators → "A+ setups"), as on the classic simulator.
   The SMC engine (smc.js) finds them on 1-minute candles: a structure break, the pullback into premium / discount, a
   sweep of a swing high / low on the structure timeframe, then a 1-minute close past the last 1-minute swing (the 1m
   CHoCH). Entry = that close, stop just past the sweep wick, target the end of the move (2R when that is too close).
   Structure timeframe = the chart's (5m / 15m / 1H / 4H; a 1m chart reads 5m). Data: the last 3 days of 1-minute
   candles plus 300 older structure candles in front, straight from Binance / Bybit in this browser. Closed candles up
   to the clock only, so in a replay it never sees the future: a setup shows once its trigger candle has closed, and its
   result (target / stop) once price got there. Each box runs from the trigger to the stop or target.
   Practice, not a signal: our test of these exact rules lost after fees (see TESTED). */
(function () {
  'use strict';
  const RD = window.__rd;
  if (!RD || !window.SMC) return;
  const { U, R } = RD, u = RD.util, X = RD.ext, { MIN, HOUR, DAY, TF } = u;
  const DAYS = 3, HIST = 300, FRESH = 45 * MIN, AHEAD = 6 * HOUR;
  const STF = { '1m': '5m', '5m': '5m', '15m': '15m', '1H': '1H', '4H': '4H' };   // chart → structure timeframe (1D / 1W: not offered)
  const TESTED = 'Practice, not signals: on the 207 coins our bot traded (14 Oct – 13 Nov 2026) these exact rules lost after fees (15m: −0.18R a trade over 6,014 setups; 5m: −0.12R over 6,834), no better than entering at a random time with the same stop and target.';
  const hm = t => new Date(t).toISOString().slice(11, 16);
  const when = (t, stf) => (TF[stf].ms >= HOUR ? new Date(t).toISOString().slice(5, 10) + ' ' : '') + hm(t);

  // M.all: fetched 1m candles, oldest first, from M.from (a structure-candle boundary) to M.to (exclusive; in a replay it
  // may run ahead of the clock — only candles closed by the clock are ever read)
  const M = { key: '', from: 0, to: 0, all: [], hist: [], A: null, n: -1, end: 0, busy: false, again: false, err: '', seen: null, gen: 0 };
  const endNow = () => Math.floor((R.on ? R.clock : Date.now()) / MIN) * MIN;
  const stfNow = () => STF[U.tf] || null;
  const keyNow = () => [U.sym, U.ex, stfNow(), R.on ? 'r' : 'l'].join('|');
  const closedCount = end => { let lo = 0, hi = M.all.length; while (lo < hi) { const m = (lo + hi) >> 1; if (M.all[m][0] + MIN <= end) lo = m + 1; else hi = m; } return lo; };

  function reset() { M.gen++; M.key = ''; M.all = []; M.hist = []; M.A = null; M.n = -1; M.err = ''; M.seen = null; M.from = M.to = 0; }

  async function load() {
    if (!U.aplus || !stfNow()) { if (M.A || M.key) { reset(); RD.req(); RD.legend(); } return; }
    if (M.busy) { M.again = true; return; }
    const key = keyNow(), end = endNow(), sym = U.sym, ex = U.ex, stf = stfNow(), sms = TF[stf].ms;
    const fresh = key !== M.key || end < M.from + HOUR || end > M.to + DAY || M.all.length > (DAYS + 4) * 1440;
    if (!fresh && end <= M.to) { analyze(); return; }
    M.busy = true; const g = fresh ? ++M.gen : M.gen;
    try {
      if (fresh) {
        M.key = key; M.A = null; M.all = []; M.hist = []; M.err = ''; M.seen = null; M.n = -1; RD.req(); RD.legend();
        const from = Math.floor((end - DAYS * DAY) / sms) * sms, to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
        const ks = await u.fetchRange(sym, '1m', from, to, ex);
        if (g !== M.gen || key !== keyNow()) return;
        if (!ks.length) throw new Error('no 1-minute candles');
        let hist = [];
        try { hist = (await u.api(ex).klines(sym, stf, { end: from - 1, limit: HIST })).filter(k => k[0] + sms <= from); } catch (e) { /* the minutes alone */ }
        if (g !== M.gen || key !== keyNow()) return;
        M.from = from; M.to = to; M.all = ks.filter(k => k[0] >= from && k[0] < to); M.hist = hist;
      } else {
        const to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
        if (to > M.to) {
          const ks = await u.fetchRange(sym, '1m', M.to, to, ex);
          if (g !== M.gen || key !== M.key) return;
          const last = M.all.length ? M.all[M.all.length - 1][0] : -1;
          for (const k of ks) if (k[0] > last && k[0] < to) M.all.push(k);
          M.to = to;
        }
      }
      analyze();
    } catch (e) { if (g === M.gen) { M.err = e.message || String(e); RD.legend(); } }
    finally { M.busy = false; if (M.again) { M.again = false; setTimeout(load, 30); } }
  }

  function analyze() {
    const end = endNow(), n = closedCount(end), stf = stfNow();
    if (!stf || M.key !== keyNow()) return;
    if (n === M.n && end === M.end && M.A) return;
    M.n = n; M.end = end;
    if (n < 30) { M.A = null; RD.req(); RD.legend(); return; }
    const sms = TF[stf].ms;
    try { M.A = window.SMC.analyze(M.all, n - 1, { tf: sms, hist: M.hist.length ? { k: M.hist, step: sms } : null }); M.err = ''; }
    catch (e) { M.A = null; M.err = 'the SMC engine could not read this chart'; }
    const A = M.A, l = A && A.setups.length ? A.setups[A.setups.length - 1] : null, conf = l ? l.conf : 0;
    if (M.seen == null) M.seen = conf;   // the first read: no toast for setups already on the chart
    else if (conf > M.seen) {
      M.seen = conf;
      if (R.on && R.playing && U.aplusPause !== false) RD.pause();
      RD.toast(`🎯 A+ ${l.side} on ${u.coin(U.sym)} at ${when(l.t, stf)} UTC · entry ${u.fp(l.entry)}, stop ${u.fp(l.stop)}, target ${u.fp(l.target)} (${l.R.toFixed(1)}R)`, l.side === 'long' ? 'up' : 'down');
    }
    RD.req(); RD.legend();
  }

  // stop or target, walking the 1m candles after the trigger up to the clock (a candle that reaches both counts as the stop)
  function result(s) {
    const end = endNow(), B = M.all;
    let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] <= s.t) lo = m + 1; else hi = m; }
    for (let i = lo; i < B.length && B[i][0] + MIN <= end; i++) {
      const k = B[i];
      if (s.dir === -1 ? k[2] >= s.stop : k[3] <= s.stop) return { kind: 'stop', t: k[0] };
      if (s.dir === -1 ? k[3] <= s.target : k[2] >= s.target) return { kind: 'target', t: k[0] };
    }
    return null;
  }
  const shown = () => (M.A && U.aplus && !X.smcOff && M.key === keyNow() ? (U.smcAll ? M.A.setups : M.A.setups.slice(-4)) : []);

  // ---------------------------------------------------------------- on the chart
  X.draw.push((g, W, z) => {
    const list = shown(); if (!M.A || !U.aplus || X.smcOff || M.key !== keyNow()) return;
    const COL = RD.COL, red = COL.down, green = COL.up, gold = '#f5b301', blue = '#60a5fa';
    const ok = (...v) => v.every(q => q != null && isFinite(q));
    const xs = t => { const x = RD.t2x(t); return x == null ? null : Math.max(-40, Math.min(W + 40, x)); };
    const boxes = list.map(s => { const r = result(s), x0 = xs(s.t), x1 = r ? xs(r.t) : W; return { s, r, x0, x1: x0 == null ? null : Math.min(W, Math.max(x0 + 24, x1 == null ? W : x1)), ye: RD.p2y(s.entry), ys: RD.p2y(s.stop), yt: RD.p2y(s.target) }; });
    if (z === 'bottom') {
      for (const b of boxes) {
        if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W) continue;
        g.fillStyle = u.hexA(red, 0.15); g.fillRect(b.x0, Math.min(b.ye, b.ys), b.x1 - b.x0, Math.abs(b.ys - b.ye));
        g.fillStyle = u.hexA(green, 0.13); g.fillRect(b.x0, Math.min(b.ye, b.yt), b.x1 - b.x0, Math.abs(b.yt - b.ye));
      }
      return;
    }
    const line = (x0, x1, y, c, dash, w) => { if (!ok(x0, x1, y)) return; g.strokeStyle = c; g.lineWidth = w || 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); };
    const placed = [];   // labels so far: a new one that would overlap moves a line up or down, or is left out
    g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
    const tag = (t, x, y, c, al) => {
      if (!ok(x, y)) return; const w = g.measureText(t).width + 8, x0 = Math.max(2, Math.min(W - w - 2, al === 'right' ? x - w : x));   // kept inside the chart (phones)
      const free = yy => placed.every(p => x0 + w <= p.x || x0 >= p.x + p.w || yy + 8 <= p.y - 8 || yy - 8 >= p.y + 8);
      const yy = [y, y - 17, y + 17].find(free); if (yy == null) return;
      placed.push({ x: x0, y: yy, w }); RD.label(g, t, x0, yy, c, 'left');
    };
    const stf = stfNow(), leg = M.A.leg && !M.A.leg.dead ? M.A.leg : null;
    if (leg && leg.sweep && leg.trig && endNow() - leg.sweep.conf < 90 * MIN) {   // 3 of 4 steps done: the 1m close that would trigger it
      const x0 = xs(leg.trig.t), y = RD.p2y(leg.trig.p);
      line(x0, W, y, blue, [5, 3], 1.5);
      tag(`A+ ${leg.dir === -1 ? 'short' : 'long'} if a 1m candle closes ${leg.dir === -1 ? 'below' : 'above'}`, W - 6, y + (leg.dir === -1 ? 11 : -11), blue, 'right');
    }
    for (const b of boxes.slice().reverse()) {
      if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W) continue;
      line(b.x0, b.x1, b.ys, red, [], 1.5); line(b.x0, b.x1, b.ye, COL.text, [], 1); line(b.x0, b.x1, b.yt, green, [], 1.5);
      const s = b.s, r = b.r;
      tag(`A+ ${s.side} · ${s.R.toFixed(1)}R${!r ? ' · open' : r.kind === 'stop' ? ' · ✗ stopped ' + when(r.t, stf) : ' · ✓ target ' + when(r.t, stf)}`,
        Math.max(2, b.x0), s.dir === -1 ? b.ys - 11 : b.ys + 11, !r ? gold : r.kind === 'stop' ? red : green);
    }
  });

  // ---------------------------------------------------------------- legend: the newest setup, or what it is waiting for
  X.legend.push(() => {
    if (!U.aplus) return '';
    const t = ` title="${u.esc(TESTED)}"`;
    if (!stfNow()) return `<span${t}>A+ setups: 4H and lower</span>`;
    if (M.err) return `<span${t}>A+: ${u.esc(M.err)}</span>`;
    if (!M.A || M.key !== keyNow()) return `<span${t}>A+ loading…</span>`;
    const A = M.A, l = A.setups[A.setups.length - 1], leg = A.leg && !A.leg.dead ? A.leg : null, end = endNow(), stf = stfNow();
    if (l && end - l.conf < FRESH) { const r = result(l); return `<span${t}>🎯 <b class="${l.side === 'long' ? 'up' : 'down'}">A+ ${l.side}</b> ${when(l.t, stf)} · ${l.R.toFixed(1)}R${r ? (r.kind === 'stop' ? ' · stopped' : ' · target hit') : ''}</span>`; }
    if (leg && leg.sweep && leg.trig && end - leg.sweep.conf < 90 * MIN) return `<span${t}>A+ 3/4: 1m close ${leg.dir === -1 ? 'below' : 'above'} <b>${u.fp(leg.trig.p)}</b></span>`;
    const n = A.setups.length, done = A.setups.map(result), w = done.filter(r => r && r.kind === 'target').length, s = done.filter(r => r && r.kind === 'stop').length;
    return `<span${t}>A+ ${DAYS}d: <b>${n}</b>${n ? ` · ${w} target, ${s} stop${n - w - s ? `, ${n - w - s} open` : ''}` : ''}</span>`;
  });

  // ---------------------------------------------------------------- when to read again
  RD.on('aplus', () => { if (!U.aplus) { reset(); RD.req(); RD.legend(); } else load(); });
  RD.on('sym', () => { reset(); load(); });
  RD.on('load', () => load());
  RD.on('mode', () => { reset(); load(); });
  RD.on('bars', () => { if (U.aplus) load(); });   // a new candle, a replay step, another timeframe
  setInterval(() => { if (U.aplus && !R.on && !document.hidden) load(); }, 20000);   // live: new 1-minute closes between chart candles
  window.__rdAplus = M;   // for tests
  if (U.aplus) load();
})();
