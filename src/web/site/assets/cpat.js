/* Candlestick patterns: detection on closed candles, the standard trade, and the luck check. Runs in the browser (Academy
   pattern lessons and simulator) and in node test scripts.

   K = [[openTimeMs, o, h, l, c, v], ...] closed candles, oldest first.
   detect(K)          → [{ key, i0, i, side }]  i0..i = the pattern's candles, side 1 bullish / −1 bearish / 0 neither
   trade(K, hit, o)   → the standard trade: entry at the next candle's open, stop 0.05 ATR past the pattern's extreme,
                        targets at 1R and 2R; res1 / res2 = 1 target first, 0 stop first, null undecided within o.hor
                        candles (default 48). A candle that reaches both counts as the stop.
   stats(K, o)        → per pattern: trades and 1R / 2R wins, next to the same trade (same side, same stop %) from
                        o.draws (20) random candles of the same chart per trade. Seeded: the same chart gives the same numbers.
   A pattern needs the right move before it (a hammer after a drop): "prior" = the close before the pattern vs the close
   6 candles earlier, in ATRs (≤ −1 down, ≥ +1 up). Crypto trades 24/7, so a candle opens where the last one closed:
   patterns that need a gap (piercing line, dark cloud, stars) are defined without one, as most crypto charting does. */
(function (root) {
  'use strict';

  const PATTERNS = [
    // key, name, side, candles, group, what it says
    ['hammer', 'Hammer', 1, 1, 'single', 'After a drop: sellers pushed far down, buyers pushed it all the way back.'],
    ['invhammer', 'Inverted hammer', 1, 1, 'single', 'After a drop: buyers tried higher; the first sign they are coming back.'],
    ['dragonfly', 'Dragonfly doji', 1, 1, 'single', 'After a drop: a deep dip bought back to the open. A doji with a long lower wick.'],
    ['bullmaru', 'Bullish marubozu', 1, 1, 'single', 'A tall green body with almost no wicks: buyers in control from open to close.'],
    ['hangman', 'Hanging man', -1, 1, 'single', 'After a rise: the hammer shape at the top. Sellers got a deep dip in.'],
    ['star', 'Shooting star', -1, 1, 'single', 'After a rise: buyers pushed far up, sellers slammed it back down.'],
    ['gravestone', 'Gravestone doji', -1, 1, 'single', 'After a rise: a spike up sold back to the open. A doji with a long upper wick.'],
    ['bearmaru', 'Bearish marubozu', -1, 1, 'single', 'A tall red body with almost no wicks: sellers in control from open to close.'],
    ['doji', 'Doji', 0, 1, 'single', 'Open and close almost equal: nobody won the candle. Indecision.'],
    ['spin', 'Spinning top', 0, 1, 'single', 'Small body, wicks both ways: both sides tried, neither won.'],
    ['bullengulf', 'Bullish engulfing', 1, 2, 'double', 'After a drop: a green body swallows the red body before it.'],
    ['bearengulf', 'Bearish engulfing', -1, 2, 'double', 'After a rise: a red body swallows the green body before it.'],
    ['piercing', 'Piercing line', 1, 2, 'double', 'After a drop: a green candle closes above the middle of a big red one.'],
    ['darkcloud', 'Dark cloud cover', -1, 2, 'double', 'After a rise: a red candle closes below the middle of a big green one.'],
    ['bullharami', 'Bullish harami', 1, 2, 'double', 'After a drop: a small green body inside the big red body before it. Selling paused.'],
    ['bearharami', 'Bearish harami', -1, 2, 'double', 'After a rise: a small red body inside the big green body before it. Buying paused.'],
    ['tweezbot', 'Tweezer bottom', 1, 2, 'double', 'After a drop: two candles with the same low, red then green. The low held twice.'],
    ['tweeztop', 'Tweezer top', -1, 2, 'double', 'After a rise: two candles with the same high, green then red. The high held twice.'],
    ['inside', 'Inside bar', 0, 2, 'double', 'The whole candle sits inside the one before: a pause; traders wait for the break.'],
    ['morning', 'Morning star', 1, 3, 'triple', 'After a drop: big red, a small candle, then green closing into the red body.'],
    ['evening', 'Evening star', -1, 3, 'triple', 'After a rise: big green, a small candle, then red closing into the green body.'],
    ['soldiers', 'Three white soldiers', 1, 3, 'triple', 'Three strong green candles, each closing higher, small upper wicks.'],
    ['crows', 'Three black crows', -1, 3, 'triple', 'Three strong red candles, each closing lower, small lower wicks.'],
    ['insideup', 'Three inside up', 1, 3, 'triple', 'A bullish harami, then a green candle closing above the big red candle\'s open.'],
    ['insidedown', 'Three inside down', -1, 3, 'triple', 'A bearish harami, then a red candle closing below the big green candle\'s open.'],
  ].map(([key, name, side, n, group, says]) => ({ key, name, side, n, group, says }));
  // how to spot each one, in plain words (the same rules detect() uses)
  const HOW = {
    hammer: 'Comes after a drop. Small body at the top of the candle, a lower wick at least twice the body, little or no upper wick.',
    invhammer: 'Comes after a drop. Small body at the bottom of the candle, an upper wick at least twice the body, little or no lower wick.',
    dragonfly: 'Comes after a drop. Open and close almost equal at the top of the candle; the lower wick is most of the candle.',
    bullmaru: 'A green candle taller than usual whose body is 90% or more of the whole candle.',
    hangman: 'Comes after a rise. The hammer’s shape: small body on top, a lower wick at least twice the body.',
    star: 'Comes after a rise. Small body at the bottom of the candle, an upper wick at least twice the body, little or no lower wick.',
    gravestone: 'Comes after a rise. Open and close almost equal at the bottom of the candle; the upper wick is most of the candle.',
    bearmaru: 'A red candle taller than usual whose body is 90% or more of the whole candle.',
    doji: 'Open and close almost equal (the body is under 8% of the candle), with wicks on both sides.',
    spin: 'A small body (under 30% of the candle) with real wicks above and below it.',
    bullengulf: 'After a drop: a red candle, then a green one that opens at or below the red close and closes above the red open.',
    bearengulf: 'After a rise: a green candle, then a red one that opens at or above the green close and closes below the green open.',
    piercing: 'After a drop: a big red candle, then a green one that closes above the middle of the red body, but not above its open.',
    darkcloud: 'After a rise: a big green candle, then a red one that closes below the middle of the green body, but not below its open.',
    bullharami: 'After a drop: a big red candle, then a small green body (half the size or less) inside the red body.',
    bearharami: 'After a rise: a big green candle, then a small red body (half the size or less) inside the green body.',
    tweezbot: 'After a drop: a red candle, then a green one, both with their low at the same price.',
    tweeztop: 'After a rise: a green candle, then a red one, both with their high at the same price.',
    inside: 'The second candle’s high is below the first candle’s high and its low is above the first candle’s low.',
    morning: 'After a drop: a big red candle, a small candle of either colour, then a green candle closing above the middle of the red body.',
    evening: 'After a rise: a big green candle, a small candle of either colour, then a red candle closing below the middle of the green body.',
    soldiers: 'Three green candles in a row, each closing higher, bodies at least half the candle, short upper wicks.',
    crows: 'Three red candles in a row, each closing lower, bodies at least half the candle, short lower wicks.',
    insideup: 'A bullish harami, then a third candle, green, closing above the big red candle’s open.',
    insidedown: 'A bearish harami, then a third candle, red, closing below the big green candle’s open.',
  };
  PATTERNS.forEach(p => { p.how = HOW[p.key]; });
  const BY = Object.fromEntries(PATTERNS.map(p => [p.key, p]));

  // average true range over the last `len` candles, up to and including candle i
  function atrOf(K, len = 14) {
    const tr = K.map((k, i) => { const pc = i ? K[i - 1][4] : k[1]; return Math.max(k[2] - k[3], Math.abs(k[2] - pc), Math.abs(k[3] - pc)); });
    const a = new Array(K.length).fill(null); let s = 0;
    for (let i = 0; i < K.length; i++) { s += tr[i]; if (i >= len) s -= tr[i - len]; if (i >= len - 1) a[i] = s / len; }
    return a;
  }

  function detect(K, opt) {
    opt = opt || {};
    const n = K.length, A = atrOf(K), out = [];
    const c = i => { const [, o, h, l, cl] = K[i], b = Math.abs(cl - o), r = Math.max(h - l, 1e-12);
      return { o, h, l, c: cl, b, r, up: cl > o, dn: cl < o, uw: h - Math.max(o, cl), lw: Math.min(o, cl) - l, top: Math.max(o, cl), bot: Math.min(o, cl) }; };
    const prior = (i0) => { const a = A[i0 - 1]; if (i0 < 8 || !a) return 0; return (K[i0 - 1][4] - K[i0 - 7][4]) / a; };
    for (let i = 16; i < n; i++) {
      const a = A[i]; if (!a) continue;
      const x = c(i), p = c(i - 1), q = c(i - 2), tol = 0.05 * a;
      const add = (key, k) => out.push({ key, i0: i - k + 1, i, side: BY[key].side });
      const d1 = prior(i), d2 = prior(i - 1), d3 = prior(i - 2);
      // ---- single
      const sized = x.r >= 0.8 * a, doji = x.b <= 0.08 * x.r;
      if (sized && !doji && x.lw >= 2 * x.b && x.uw <= 0.15 * x.r) { if (d1 <= -1) add('hammer', 1); else if (d1 >= 1) add('hangman', 1); }
      if (sized && !doji && x.uw >= 2 * x.b && x.lw <= 0.15 * x.r) { if (d1 <= -1) add('invhammer', 1); else if (d1 >= 1) add('star', 1); }
      if (sized && doji && x.lw >= 0.65 * x.r && d1 <= -1) add('dragonfly', 1);
      if (sized && doji && x.uw >= 0.65 * x.r && d1 >= 1) add('gravestone', 1);
      if (sized && doji && x.lw < 0.65 * x.r && x.uw < 0.65 * x.r) add('doji', 1);
      if (x.r >= 1.2 * a && x.b >= 0.9 * x.r) add(x.up ? 'bullmaru' : 'bearmaru', 1);
      if (sized && !doji && x.b <= 0.3 * x.r && x.uw >= 0.25 * x.r && x.lw >= 0.25 * x.r) add('spin', 1);
      // ---- double
      const pBig = p.b >= 0.6 * p.r && p.b >= 0.8 * a;
      if (d2 <= -1 && p.dn && x.up && p.b >= 0.3 * a && x.o <= p.c + tol && x.c >= p.o && x.b > p.b) add('bullengulf', 2);
      if (d2 >= 1 && p.up && x.dn && p.b >= 0.3 * a && x.o >= p.c - tol && x.c <= p.o && x.b > p.b) add('bearengulf', 2);
      if (d2 <= -1 && p.dn && pBig && x.up && x.o <= p.c + tol && x.c > p.c + 0.5 * p.b && x.c < p.o) add('piercing', 2);
      if (d2 >= 1 && p.up && pBig && x.dn && x.o >= p.c - tol && x.c < p.c - 0.5 * p.b && x.c > p.o) add('darkcloud', 2);
      if (d2 <= -1 && p.dn && pBig && x.up && x.b <= 0.5 * p.b && x.top <= p.o && x.bot >= p.c - tol) add('bullharami', 2);
      if (d2 >= 1 && p.up && pBig && x.dn && x.b <= 0.5 * p.b && x.bot >= p.o && x.top <= p.c + tol) add('bearharami', 2);
      if (d2 <= -1 && p.dn && x.up && Math.abs(x.l - p.l) <= 0.1 * a && p.r >= 0.6 * a) add('tweezbot', 2);
      if (d2 >= 1 && p.up && x.dn && Math.abs(x.h - p.h) <= 0.1 * a && p.r >= 0.6 * a) add('tweeztop', 2);
      if (x.h < p.h && x.l > p.l && p.r >= 0.8 * a) add('inside', 2);
      // ---- triple
      const qBig = q.b >= 0.6 * q.r && q.b >= a;
      if (d3 <= -1 && q.dn && qBig && p.b <= 0.3 * q.b && x.up && x.c > q.c + 0.5 * q.b) add('morning', 3);
      if (d3 >= 1 && q.up && qBig && p.b <= 0.3 * q.b && x.dn && x.c < q.c - 0.5 * q.b) add('evening', 3);
      const strong = (y, up) => (up ? y.up : y.dn) && y.b >= 0.5 * y.r && y.b >= 0.5 * a && (up ? y.uw : y.lw) <= 0.3 * y.b;
      if (strong(q, true) && strong(p, true) && strong(x, true) && p.c > q.c && x.c > p.c && d3 <= 0.5) add('soldiers', 3);
      if (strong(q, false) && strong(p, false) && strong(x, false) && p.c < q.c && x.c < p.c && d3 >= -0.5) add('crows', 3);
      if (d3 <= -1 && q.dn && qBig && p.up && p.b <= 0.5 * q.b && p.top <= q.o && p.bot >= q.c - tol && x.up && x.c > q.o) add('insideup', 3);
      if (d3 >= 1 && q.up && qBig && p.dn && p.b <= 0.5 * q.b && p.bot >= q.o && p.top <= q.c + tol && x.dn && x.c < q.o) add('insidedown', 3);
    }
    return opt.keys ? out.filter(h => opt.keys.includes(h.key)) : out;
  }

  // walk forward from candle j: 1 = target first, 0 = stop first (a candle reaching both counts as the stop), null = neither
  function walk(K, j, side, stop, tgt, hor) {
    for (let k = j; k < Math.min(K.length, j + hor); k++) {
      if (side === 1 ? K[k][3] <= stop : K[k][2] >= stop) return [0, k];
      if (side === 1 ? K[k][2] >= tgt : K[k][3] <= tgt) return [1, k];
    }
    return [null, -1];
  }

  function trade(K, hit, opt) {
    opt = opt || {};
    const hor = opt.hor || 48, side = hit.side, A = opt.atr || atrOf(K);
    if (!side || hit.i + 1 >= K.length) return null;
    const entry = K[hit.i + 1][1], buf = 0.05 * (A[hit.i] || 0);
    let ext = side === 1 ? Infinity : -Infinity;
    for (let k = hit.i0; k <= hit.i; k++) ext = side === 1 ? Math.min(ext, K[k][3]) : Math.max(ext, K[k][2]);
    const stop = side === 1 ? ext - buf : ext + buf, r = (entry - stop) * side;
    if (!(r > 0)) return null;   // the next candle opened past the stop: no trade
    const t1 = entry + side * r, t2 = entry + side * 2 * r;
    const [res1, at1] = walk(K, hit.i + 1, side, stop, t1, hor), [res2, at2] = walk(K, hit.i + 1, side, stop, t2, hor);
    return { side, entry, stop, t1, t2, pct: r / entry, res1, res2, at1: at1 >= 0 ? K[at1][0] : null, at2: at2 >= 0 ? K[at2][0] : null, entryT: K[hit.i + 1][0] };
  }

  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function stats(K, opt) {
    opt = opt || {};
    const hor = opt.hor || 48, draws = opt.draws || 20, A = atrOf(K), hits = detect(K, opt), rand = rng(opt.seed || 7);
    const S = {};
    for (const h of hits) {
      if (!h.side) continue;
      const t = trade(K, h, { hor, atr: A }); if (!t) continue;
      const s = S[h.key] || (S[h.key] = { n: 0, w1: 0, d1: 0, w2: 0, d2: 0, rn1: 0, rw1: 0, rn2: 0, rw2: 0, pct: [] });
      s.n++; s.pct.push(t.pct);
      if (t.res1 != null) { s.d1++; s.w1 += t.res1; }
      if (t.res2 != null) { s.d2++; s.w2 += t.res2; }
      for (let q = 0; q < draws; q++) {
        const j = 20 + Math.floor(rand() * (K.length - 22)), e = K[j][1];
        const st = e * (1 - h.side * t.pct);
        const [a1] = walk(K, j, h.side, st, e * (1 + h.side * t.pct), hor), [a2] = walk(K, j, h.side, st, e * (1 + h.side * 2 * t.pct), hor);
        if (a1 != null) { s.rn1++; s.rw1 += a1; }
        if (a2 != null) { s.rn2++; s.rw2 += a2; }
      }
    }
    return S;
  }

  // textbook examples for the lessons: the move before (18 candles), the pattern, 6 candles after. Bullish templates as
  // [o, h, l, c] offsets from the last close before the pattern (ATR ≈ 2); bearish ones are their mirror images.
  const TPL = {
    hammer: [[0, 0.8, -4.5, 0.6]], invhammer: [[0, 4.5, -0.2, 0.5]], dragonfly: [[0, 0.2, -4, 0.1]], bullmaru: [[0, 3.05, -0.05, 3]],
    bullengulf: [[0, 0.2, -1.5, -1.3], [-1.3, 0.8, -1.5, 0.6]], piercing: [[0, 0.1, -2.6, -2.5], [-2.5, -0.6, -2.8, -0.8]],
    bullharami: [[0, 0.1, -3.1, -3], [-2.6, -1.3, -2.8, -1.6]], tweezbot: [[0, 0.2, -2.2, -1.8], [-1.8, -0.6, -2.15, -0.8]],
    morning: [[0, 0.2, -3.2, -3], [-3, -2.5, -3.8, -3.3], [-3.3, -0.6, -3.5, -0.8]], soldiers: [[0, 1.6, -0.1, 1.5], [1.5, 3.1, 1.4, 3], [3, 4.6, 2.9, 4.5]],
    insideup: [[0, 0.1, -3.1, -3], [-2.6, -1.3, -2.8, -1.6], [-1.6, 0.8, -1.8, 0.6]],
    doji: [[0, 1.5, -1.5, 0.05]], spin: [[0, 1.2, -1.2, 0.5]], inside: [[0, 1.5, -1.5, 0.8], [0.8, 1, -0.6, 0.2]],
  };
  const MIRROR = { star: 'hammer', hangman: 'invhammer', gravestone: 'dragonfly', bearmaru: 'bullmaru', bearengulf: 'bullengulf', darkcloud: 'piercing',
    bearharami: 'bullharami', tweeztop: 'tweezbot', evening: 'morning', crows: 'soldiers', insidedown: 'insideup' };
  function example(key, after) {
    const m = MIRROR[key], t = TPL[m || key]; if (!t) return null;
    const s = m ? -1 : 1, side = BY[key].side, P = 100, out = [], H = 3600e3;
    const step = side === 0 ? 0.4 : -1.4;   // the move before: down into a bullish pattern (mirrored: up into a bearish one)
    let c = P - step * 18;
    for (let k = 0; k < 18; k++) { const o = c; c = o + step; out.push([o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c]); }
    for (const [o, h, l, cl] of t) out.push([P + o, P + h, P + l, P + cl]);
    c = out[out.length - 1][3];
    const go = after || (side === 0 ? [0.6, -0.4, 0.8, -0.3, 0.5, 0.2] : [1.3, 1.1, -0.4, 1.4, 1.2, 0.9]);
    for (const d of go) { const o = c; c = o + d; out.push([o, Math.max(o, c) + 0.35, Math.min(o, c) - 0.35, c]); }
    // mirror bearish ones around P (high and low swap), then add times and volumes
    const K = out.map(([o, h, l, cl], k) => (s === 1 ? [k * H, o, h, l, cl, 1] : [k * H, 2 * P - o, 2 * P - l, 2 * P - h, 2 * P - cl, 1]));
    return { K, i0: 18, i: 18 + t.length - 1, after: go.length };
  }

  // our test, 18 Nov 2026: 40 Binance perps in two sets of 20, 15m 60d / 1H 180d / 4H 2y, the trade above (48 candles).
  // Per pattern: [trades, 1R before stop %, random %, 2R before stop %, random %, median stop %, avg R after fees aiming 2R]
  const TEST = {"tweezbot":[8062,47.5,43.7,31.2,29.9,0.8,-0.19],"bullmaru":[4223,48.1,47,29.4,29,1.68,-0.18],"bearengulf":[5565,52.9,51.2,36,34.5,1.4,0.01],"tweeztop":[7557,49.4,47.5,34.8,33.7,0.82,-0.08],"darkcloud":[1592,52.9,51.9,36.3,34.7,1.51,0.02],"bullharami":[3479,46.3,44.8,30.7,29.9,0.9,-0.19],"bearmaru":[3404,49.7,52.3,33.8,34.4,1.46,-0.06],"invhammer":[2473,32.3,29.4,26.5,23.6,0.21,-0.67],"bullengulf":[5899,48.6,46.5,30.9,29.6,1.37,-0.15],"gravestone":[1827,52.3,50.2,35.8,34.7,1.01,-0.03],"hangman":[2461,32.6,30.8,26.1,25,0.24,-0.63],"star":[3707,51.4,50,34,34.3,1.02,-0.08],"dragonfly":[2072,47,46,28.4,30,1.06,-0.24],"bearharami":[3632,51.2,48.5,35.7,34,0.93,-0.04],"insidedown":[218,48.9,52.9,31.3,32.4,2.63,-0.1],"hammer":[4184,47,46,30.8,30,1.07,-0.17],"soldiers":[441,50.3,46.6,25.6,25.6,2.99,-0.27],"piercing":[1333,50.6,46.6,33.2,29.8,1.19,-0.09],"crows":[313,59.6,53.8,35.4,31.6,2.14,0.02],"morning":[447,52.3,46.9,30.5,30,1.97,-0.14],"insideup":[108,46.2,47.2,29.3,29.5,2.42,-0.16],"evening":[546,52.7,52.8,37.6,33.8,2.11,0.08]};

  const api = { PATTERNS, BY, detect, trade, stats, atrOf, example, TEST };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPat = api;
})(typeof window !== 'undefined' ? window : this);
