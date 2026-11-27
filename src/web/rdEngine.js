/* RD ▲ buy / ▼ sell rules (ReplayDesk Indicators → "RD ▲ / ▼ signal"), shared by the desk (served as /assets/rd.js,
   used by src/web/site/assets/deskpoi.js) and the server (src/engine/deskAuto.js), so both read exactly the same signals.
   scan(K, n): the signals and the gaps being watched, from closed 1-minute candles K[0..n-1] ([openMs, o, h, l, c, v]).
   result(K, n, g): what the plan of signal g did up to candle n: wait (limit not reached yet), nofill (30 minutes passed),
   stop, target (3R), open (still running), time (6 hours out at the close). The rules and the test behind them are described
   at the top of deskpoi.js. */
(function (root) {
  'use strict';
  const MIN = 60000, HOUR = 60 * MIN, M15 = 15 * MIN, WATCH = 60, FILL = 30, HOLD = 360, TGT = 3;
  const sessOf = t => { const h = new Date(t).getUTCHours(); return h >= 7 && h <= 10 ? 'London' : h >= 13 && h <= 16 ? 'New York' : ''; };

  function scan(K, n) {
    const sigs = [], zones = [], watches = [], SH = [], SL = [];
    let b15 = -1, c15 = null;
    const h15 = [];
    for (let i = 0; i < n; i++) {
      const k = K[i], t = k[0], hi = k[2], lo = k[3], cl = k[4];
      // a 15m gap reached for the first time: watch it for 60 minutes
      for (const z of zones) {
        if (z.dead || z.used) continue;
        if (t - z.born > 48 * HOUR) { z.dead = true; continue; }
        if (z.side === 1 ? lo <= z.top : hi >= z.bot) { z.used = true; watches.push({ z, side: z.side, touch: i, touchT: t, end: i + WATCH, ext: z.side === 1 ? lo : hi, extT: t, b: -1 }); }
      }
      for (let w = watches.length - 1; w >= 0; w--) {
        const W = watches[w], d = W.side;
        if (W.b >= 0 && i === W.b + 1) {   // the break was the candle before: look for the 1m gap the move left
          let c3 = -1;
          for (let q = i; q >= W.b - 4; q--) { const c1 = q - 2; if (c1 < 0) break; if (d === 1 ? K[c1][2] < K[q][3] : K[c1][3] > K[q][2]) { c3 = q; break; } }
          if (c3 >= 0) {
            const c1 = c3 - 2, s = Math.max(W.b, c3);
            const gTop = d === 1 ? K[c3][3] : K[c1][3], gBot = d === 1 ? K[c1][2] : K[c3][2], entry = (gTop + gBot) / 2;
            const stop = W.bExt * (1 - d * 0.0005), risk = (entry - stop) * d / entry;
            if (risk >= 0.0015 && risk <= 0.02) {
              const rk = Math.abs(entry - stop);
              sigs.push({ dir: d, side: d === 1 ? 'long' : 'short', s, t: K[s][0], conf: K[s][0] + MIN, entry, stop, target: entry + d * TGT * rk, risk,
                sess: sessOf(K[s][0]), lv: W.lv, lvT: W.lvT, brkT: K[W.b][0], gap: { t: K[c1][0], top: gTop, bot: gBot }, z: W.z, extT: W.bExtT });
            }
          }
          watches.splice(w, 1); continue;
        }
        if (W.b >= 0) continue;
        if (i > W.end) { watches.splice(w, 1); continue; }
        if (d === 1 ? lo < W.ext : hi > W.ext) { W.ext = d === 1 ? lo : hi; W.extT = t; }
        const LV = d === 1 ? SH : SL; if (LV.length < 2) continue;
        const a = LV[LV.length - 1], p = LV[LV.length - 2];
        if ((d === 1 ? a.p < p.p : a.p > p.p) && !a.broken && (d === 1 ? cl > a.p : cl < a.p)) { W.b = i; W.bExt = W.ext; W.bExtT = W.extT; W.lv = a.p; W.lvT = a.t; }
      }
      // 1m swings confirmed by this candle (pivot 2 candles back)
      if (i >= 4) {
        const j = i - 2, H = q => K[q][2], L = q => K[q][3];
        if (H(j) > H(j - 1) && H(j) > H(j - 2) && H(j) >= H(j + 1) && H(j) >= H(j + 2)) SH.push({ p: H(j), t: K[j][0], broken: false });
        if (L(j) < L(j - 1) && L(j) < L(j - 2) && L(j) <= L(j + 1) && L(j) <= L(j + 2)) SL.push({ p: L(j), t: K[j][0], broken: false });
      }
      if (SH.length && cl > SH[SH.length - 1].p) SH[SH.length - 1].broken = true;
      if (SL.length && cl < SL[SL.length - 1].p) SL[SL.length - 1].broken = true;
      // 15m candles from the minutes: a new gap is usable from the next minute; a 15m close through a gap ends it
      const bk = Math.floor(t / M15);
      if (bk !== b15) { b15 = bk; c15 = { h: hi, l: lo, c: cl }; } else { c15.h = Math.max(c15.h, hi); c15.l = Math.min(c15.l, lo); c15.c = cl; }
      if (i === n - 1 ? (t + MIN) % M15 === 0 : Math.floor(K[i + 1][0] / M15) !== b15) {
        for (const z of zones) if (!z.dead && (z.side === 1 ? c15.c < z.bot : c15.c > z.top)) z.dead = true;
        h15.push(c15); if (h15.length > 3) h15.shift();
        if (h15.length === 3) {
          const x1 = h15[0], x3 = h15[2], born = (b15 + 1) * M15;
          if (x1.h < x3.l && (x3.l - x1.h) / x3.c >= 0.001) zones.push({ side: 1, bot: x1.h, top: x3.l, born, t1: born - 3 * M15 });
          if (x1.l > x3.h && (x1.l - x3.h) / x3.c >= 0.001) zones.push({ side: -1, bot: x3.h, top: x1.l, born, t1: born - 3 * M15 });
        }
        for (let q = zones.length - 1; q >= 0; q--) if (zones[q].dead || (zones[q].used && !watches.some(W => W.z === zones[q]))) zones.splice(q, 1);
      }
    }
    // being watched now: the gap price is in and the level a 1-minute close has to cross
    const live = watches.filter(W => W.b < 0 && n - 1 <= W.end).map(W => {
      const LV = W.side === 1 ? SH : SL, a = LV[LV.length - 1], p = LV[LV.length - 2];
      const lv = a && p && (W.side === 1 ? a.p < p.p : a.p > p.p) && !a.broken ? a : null;
      return { side: W.side, z: W.z, touchT: W.touchT, left: W.end - (n - 1), lv, ext: W.ext };
    });
    return { sigs, live };
  }

  function result(K, n, g) {
    const d = g.dir;
    let kf = -1;
    for (let k = g.s + 1; k <= g.s + FILL; k++) {
      if (k >= n) return { kind: 'wait' };
      if (d === 1 ? K[k][3] <= g.entry : K[k][2] >= g.entry) { kf = k; break; }
    }
    if (kf < 0) return { kind: 'nofill', t: K[g.s + FILL][0] };
    if (d === 1 ? K[kf][3] <= g.stop : K[kf][2] >= g.stop) return { kind: 'stop', t: K[kf][0], R: -1, fillT: K[kf][0] };
    for (let k = kf + 1; k <= kf + HOLD; k++) {
      if (k >= n) return { kind: 'open', fillT: K[kf][0], R: (K[n - 1][4] - g.entry) * d / Math.abs(g.entry - g.stop) };
      if (d === 1 ? K[k][3] <= g.stop : K[k][2] >= g.stop) return { kind: 'stop', t: K[k][0], R: -1, fillT: K[kf][0] };
      if (d === 1 ? K[k][2] >= g.target : K[k][3] <= g.target) return { kind: 'target', t: K[k][0], R: TGT, fillT: K[kf][0] };
    }
    const kx = kf + HOLD;
    return { kind: 'time', t: K[kx][0], R: (K[kx][4] - g.entry) * d / Math.abs(g.entry - g.stop), fillT: K[kf][0] };
  }

  const RDE = { scan, result, sessOf, WATCH, FILL, HOLD, TGT };
  if (typeof module === 'object' && module.exports) module.exports = RDE; else root.RDE = RDE;
})(this);
