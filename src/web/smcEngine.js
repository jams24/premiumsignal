/* SMC engine for the dashboard's Trade Simulator (src/web/simulator.html). Runs in the browser and in node test scripts.
   Causal: what it reports at 1-minute candle `upto` uses only candles 0..upto. A swing point is confirmed `len`
   structure candles after it (as on a real chart), structure breaks use closed candles, and a setup triggers on a
   closed 1-minute candle. It is a mechanical version of the SMC Playbook steps for teaching, not a trade signal.

   analyze(base, upto, { tf }) with base = [[openTimeMs, o, h, l, c, v], ...] in 1-minute candles. Returns:
     swings  [{side:'H'|'L', t, p, label:'HH'|'LH'|'HL'|'LL', conf}]
     breaks  [{kind:'BOS'|'CHoCH', dir:1|-1, p, fromT, t, conf, close}]       dir -1 = broke down
     zones   [{type:'supply'|'demand', top, bot, t, conf, broken, touched}]   order block of the leg that broke
     eqs     [{side, kind:'EQH'|'EQL', p, t1, t, conf, taken}]                  equal highs / lows (resting stops)
     sweeps  [{dir, p, kind, levelT, t, wickT, wick, close, conf}]            wick through a level, close back
     setups  [{side, dir, t, conf, entry, stop, target, tgtKind, R, brk, zone, hi, lo, eq, sweep, trig}]
     leg     the move that made the last break: {dir, hi, hiT, lo, loT, brk, zone, prem, inZone, sweep, trig, last, dead}
     liq     untaken swing highs / lows,  ltf  1-minute swing points,  trend 1|-1|0,  now, price, atr */
(function (root) {
  'use strict';
  const MIN = 60000;

  function analyze(base, upto, opt) {
    opt = opt || {};
    const tf = opt.tf || 5 * MIN;
    const L = opt.len || (tf >= 15 * MIN ? 2 : 3);   // structure swing: this many candles on each side
    const L1 = opt.ltfLen || 3;                         // 1-minute swing for the trigger
    const BUF = opt.buf == null ? 0.001 : opt.buf;      // stop goes this far past the sweep wick
    const TRIG_WIN = (opt.trigWindow || 90) * MIN;      // the 1m CHoCH must come within this long after the sweep
    const n = Math.min(upto == null ? base.length - 1 : upto, base.length - 1);
    const R = { tf, len: L, ltfLen: L1, swings: [], breaks: [], zones: [], eqs: [], sweeps: [], setups: [], ltf: [], liq: [],
      leg: null, trend: 0, forming: null, atr: null, now: n >= 0 ? base[n][0] + MIN : null, price: n >= 0 ? base[n][4] : null };
    if (n < 0) return R;

    const T = [];      // closed structure-timeframe candles {t, o, h, l, c, i0, i1}
    const liq = [];    // swing / equal highs and lows that price has not traded through yet
    const trs = [];
    let cur = null, top = null, btm = null, prevH = null, prevL = null, leg = null, atr = null;
    const eqOf = g => (g.hi + g.lo) / 2;

    function closeBar() { const j = T.push(cur) - 1; cur = null; tfStep(j); }

    // ---- one closed structure candle ----
    function tfStep(j) {
      const B = T[j], end = B.t + tf;
      const pc = j ? T[j - 1].c : B.o;
      trs.push(Math.max(B.h - B.l, Math.abs(B.h - pc), Math.abs(B.l - pc))); if (trs.length > 14) trs.shift();
      atr = trs.reduce((a, x) => a + x, 0) / trs.length;

      // liquidity: a wick through a level that closes back is a sweep
      for (const lv of liq) {
        if (lv.taken || lv.conf > B.t) continue;
        const hi = lv.side === 'H';
        if (hi ? B.h > lv.p : B.l < lv.p) {
          lv.taken = end;
          if (hi ? B.c < lv.p : B.c > lv.p) {
            let w = B.i0; for (let q = B.i0; q <= B.i1; q++) if (hi ? base[q][2] > base[w][2] : base[q][3] < base[w][3]) w = q;
            const sw = { dir: hi ? -1 : 1, p: lv.p, kind: lv.kind, levelT: lv.t, t: B.t, wickT: base[w][0], wick: hi ? B.h : B.l, close: B.c, conf: end };
            if (!R.sweeps.length || R.sweeps[R.sweeps.length - 1].t !== sw.t || R.sweeps[R.sweeps.length - 1].dir !== sw.dir) R.sweeps.push(sw);
            onSweep(sw);
          }
        }
      }
      if (liq.length > 120) liq.splice(0, liq.length - 120);

      for (const z of R.zones) {
        if (z.broken || z.conf > B.t) continue;
        if (z.type === 'supply' ? B.c > z.top : B.c < z.bot) z.broken = end;
        else if (!z.touched && (z.type === 'supply' ? B.h >= z.bot : B.l <= z.top)) z.touched = end;
      }

      // structure: a close through the last swing high / low
      if (top && !top.crossed && B.c > top.p) { top.crossed = true; brk(1, top, j); }
      if (btm && !btm.crossed && B.c < btm.p) { btm.crossed = true; brk(-1, btm, j); }
      if (leg && !leg.dead && (leg.dir === -1 ? B.c > leg.hi : B.c < leg.lo)) leg.dead = end;

      // the swing point L candles back is now confirmed
      const pi = j - L;
      if (pi < L) return;
      const P = T[pi]; let isH = true, isL = true;
      for (let q = pi - L; q <= pi + L; q++) {
        if (q === pi) continue;
        if (q < pi ? T[q].h >= P.h : T[q].h > P.h) isH = false;
        if (q < pi ? T[q].l <= P.l : T[q].l < P.l) isL = false;
      }
      if (isH) {
        const s = { side: 'H', i: pi, t: P.t, p: P.h, conf: end, label: prevH ? (P.h > prevH.p ? 'HH' : 'LH') : 'H' };
        R.swings.push(s); prevH = s; top = Object.assign({ crossed: false }, s);
        eqCheck(s); liq.push({ side: 'H', kind: 'swing', t: s.t, p: s.p, conf: end, taken: null });
      }
      if (isL) {
        const s = { side: 'L', i: pi, t: P.t, p: P.l, conf: end, label: prevL ? (P.l < prevL.p ? 'LL' : 'HL') : 'L' };
        R.swings.push(s); prevL = s; btm = Object.assign({ crossed: false }, s);
        eqCheck(s); liq.push({ side: 'L', kind: 'swing', t: s.t, p: s.p, conf: end, taken: null });
      }
    }

    function eqCheck(s) {
      const tol = Math.max(s.p * 0.001, (atr || 0) * 0.2);
      let best = null;
      for (const q of liq) {
        if (q.side !== s.side || q.kind !== 'swing' || q.taken || q.t >= s.t || q.t < s.t - 48 * tf) continue;
        const d = Math.abs(q.p - s.p);
        if (d <= tol && (!best || d < Math.abs(best.p - s.p))) best = q;
      }
      if (!best) return;
      const e = { side: s.side, kind: s.side === 'H' ? 'EQH' : 'EQL', p: s.side === 'H' ? Math.max(best.p, s.p) : Math.min(best.p, s.p), t1: best.t, t: s.t, conf: s.conf, taken: null };
      R.eqs.push(e); liq.push(e);
    }

    function brk(dir, sw, j) {
      const B = T[j], end = B.t + tf;
      const ev = { kind: R.trend === -dir ? 'CHoCH' : 'BOS', dir, p: sw.p, fromT: sw.t, t: B.t, conf: end, close: B.c };
      R.trend = dir; R.breaks.push(ev);
      // the leg that made the break starts at the extreme after the broken swing
      let x = sw.i;
      for (let q = sw.i; q <= j; q++) if (dir === -1 ? T[q].h >= T[x].h : T[q].l <= T[x].l) x = q;
      // order block: the last candle against the move, at or just before that extreme
      let ob = x;
      for (let q = x; q >= Math.max(0, x - 6); q--) if (dir === -1 ? T[q].c > T[q].o : T[q].c < T[q].o) { ob = q; break; }
      let zt = -Infinity, zb = Infinity;
      for (let q = ob; q <= x; q++) { zt = Math.max(zt, T[q].h); zb = Math.min(zb, T[q].l); }
      const zone = dir === -1
        ? { type: 'supply', top: zt, bot: Math.min(T[ob].o, T[ob].c), t: T[ob].t, conf: end, broken: null, touched: null }
        : { type: 'demand', top: Math.max(T[ob].o, T[ob].c), bot: zb, t: T[ob].t, conf: end, broken: null, touched: null };
      if (zone.top > zone.bot) R.zones.push(zone);
      let far = dir === -1 ? Infinity : -Infinity, farT = null;
      for (let q = x; q <= j; q++) {
        if (dir === -1 ? T[q].l < far : T[q].h > far) { far = dir === -1 ? T[q].l : T[q].h; farT = T[q].t; }
      }
      leg = dir === -1
        ? { dir, hi: T[x].h, hiT: T[x].t, lo: far, loT: farT }
        : { dir, lo: T[x].l, loT: T[x].t, hi: far, hiT: farT };
      Object.assign(leg, { brk: ev, zone: zone.top > zone.bot ? zone : null, start: end, prem: null, inZone: null, sweep: null, trig: null, last: null, dead: null });
    }

    function onSweep(sw) {
      if (!leg || leg.dead || sw.dir !== leg.dir || sw.t < leg.start) return;
      if (leg.dir === -1 ? sw.wick < eqOf(leg) : sw.wick > eqOf(leg)) return;   // must happen in premium (discount for longs)
      leg.sweep = sw; leg.trig = null;
    }

    // ---- one closed 1-minute candle ----
    function ltfStep(i) {
      const k = base[i], tEnd = k[0] + MIN;
      const pi = i - L1;
      if (pi >= L1) {
        const P = base[pi]; let isH = true, isL = true;
        for (let q = pi - L1; q <= pi + L1; q++) {
          if (q === pi) continue; const Q = base[q];
          if (q < pi ? Q[2] >= P[2] : Q[2] > P[2]) isH = false;
          if (q < pi ? Q[3] <= P[3] : Q[3] < P[3]) isL = false;
        }
        if (isH) R.ltf.push({ side: 'H', t: P[0], p: P[2], conf: tEnd });
        if (isL) R.ltf.push({ side: 'L', t: P[0], p: P[3], conf: tEnd });
        if (R.ltf.length > 600) R.ltf.splice(0, 200);
      }
      if (!leg || leg.dead || k[0] < leg.start) return;
      const d = leg.dir;
      // a new extreme extends the move: the pullback into premium / discount (and any sweep) has to start again
      if (d === -1 ? k[3] < leg.lo : k[2] > leg.hi) {
        if (d === -1) { leg.lo = k[3]; leg.loT = k[0]; } else { leg.hi = k[2]; leg.hiT = k[0]; }
        leg.prem = null; leg.sweep = null; leg.trig = null;
      }
      const eq = eqOf(leg);
      if (!leg.prem && (d === -1 ? k[2] >= eq : k[3] <= eq)) leg.prem = { t: k[0], p: d === -1 ? k[2] : k[3] };
      if (leg.zone && !leg.inZone && (d === -1 ? k[2] >= leg.zone.bot : k[3] <= leg.zone.top)) leg.inZone = { t: k[0] };
      const sw = leg.sweep;
      if (!sw) return;
      if (d === -1 ? k[4] > sw.wick : k[4] < sw.wick) { leg.sweep = null; leg.trig = null; return; }   // closed past the wick: no sweep
      if (k[0] < sw.conf) return;
      if (k[0] >= sw.conf + TRIG_WIN) { leg.sweep = null; leg.trig = null; return; }
      // trigger level: the last 1m swing low (high for longs) before the sweep wick
      let tg = null;
      for (let q = R.ltf.length - 1; q >= 0; q--) {
        const p = R.ltf[q];
        if (p.side === (d === -1 ? 'L' : 'H') && p.t < sw.wickT && p.conf <= tEnd) { tg = p; break; }
      }
      if (!tg || sw.wickT - tg.t > 180 * MIN) return;
      leg.trig = tg;
      if (d === -1 ? k[4] < tg.p : k[4] > tg.p) {
        const entry = k[4], stop = sw.wick * (1 - d * BUF), risk = Math.abs(stop - entry);
        let target = d === -1 ? leg.lo : leg.hi, tgtKind = 'leg';
        if (d === -1 ? target > entry - risk : target < entry + risk) { target = entry + d * 2 * risk; tgtKind = '2R'; }
        const s = { side: d === -1 ? 'short' : 'long', dir: d, t: k[0], conf: tEnd, entry, stop, target, tgtKind, R: Math.abs(target - entry) / risk,
          brk: leg.brk, zone: leg.zone, hi: leg.hi, lo: leg.lo, eq, sweep: sw, trig: tg, inZone: !!leg.inZone };
        R.setups.push(s); leg.last = s; leg.sweep = null; leg.trig = null;
      }
    }

    for (let i = 0; i <= n; i++) {
      const k = base[i], b = Math.floor(k[0] / tf) * tf;
      if (cur && cur.t !== b) closeBar();
      ltfStep(i);
      if (!cur) cur = { t: b, o: k[1], h: k[2], l: k[3], c: k[4], i0: i, i1: i };
      else { if (k[2] > cur.h) cur.h = k[2]; if (k[3] < cur.l) cur.l = k[3]; cur.c = k[4]; cur.i1 = i; }
      if (k[0] + MIN >= b + tf) closeBar();
    }
    R.forming = cur; R.atr = atr; R.leg = leg; R.bars = T.length;
    R.liq = liq.filter(l => !l.taken).slice(-40);
    return R;
  }

  const SMC = { analyze };
  if (typeof module === 'object' && module.exports) module.exports = SMC; else root.SMC = SMC;
})(this);
