/* Zone respect: how a coin's SMC supply / demand zones did on their first touch, next to the same trade placed at random
   times (the luck check). Runs in the browser (desk Market tab) and in node test scripts.

   zoneStats(SMC, K, tfMs, opt) with K = closed candles [[openTimeMs, o, h, l, c, v], ...] of one timeframe (5m / 15m / 1H)
   and SMC = the desk's SMC engine (src/web/smcEngine.js). For every zone the engine finds:
     - its first touch after the zone is confirmed (the break candle closed)
     - entry at the zone edge (demand: top, supply: bottom; a candle that opens past the edge fills at its open),
       stop 0.1% past the far edge, target the same distance the other way (1R)
     - held = target before stop, against = stop first. On the touch candle only the stop counts (its high / low may have
       printed before the touch); afterwards a candle that reaches both counts as a stop. Undecided after opt.hor candles = open.
   Random: for every decided zone, opt.draws random candles of the same coin and period, entry at their close, the same
   side and the same stop / target distance in %, the same rules. Seeded, so a refresh shows the same numbers.
   opt.from (ms): count only touches (and random entries) from this time on; the candles before it are warm-up, so the
   engine already knows the zones when the period starts (a 1-day period on 1H has only 24 candles of its own).
   best = the furthest price ran in the trade's favour, in R, from the candle after the touch until the stop or opt.hor
   candles (a candle that hits the stop does not count its other side); r2 = how many decided touches ran 2R or more
   before the stop, next to the same count for the random entries. */
(function (root) {
  'use strict';
  const BUF = 0.001;

  function rng(seed) {   // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function seedOf(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function zoneStats(SMC, K, tfMs, opt) {
    opt = opt || {};
    const HOR = opt.hor || 96, DRAWS = opt.draws || 20, n = K.length;
    const first = t => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (K[m][0] < t) lo = m + 1; else hi = m; } return lo; };
    const i0 = opt.from != null ? first(opt.from) : 0;   // the first candle of the period (before it: warm-up)
    const out = { demand: { held: 0, against: 0, open: 0 }, supply: { held: 0, against: 0, open: 0 }, rnd: { demand: { held: 0, n: 0 }, supply: { held: 0, n: 0 } },
      r2: { demand: { hit: 0, n: 0 }, supply: { hit: 0, n: 0 } }, rnd2: { demand: { hit: 0, n: 0 }, supply: { hit: 0, n: 0 } },
      touches: [], zones: 0, from: n ? K[Math.min(i0, n - 1)][0] : null, to: n ? K[n - 1][0] + tfMs : null, candles: n - i0 };
    if (n < 60 || n - i0 < 2) return out;
    // a flat candle after the last one closes it, so the engine reads every candle given (as the desk's Trend section does)
    const c = K[n - 1][4], base = K.concat([[K[n - 1][0] + tfMs, c, c, c, c, 0]]);
    const A = SMC.analyze(base, base.length - 1, { tf: tfMs });
    out.zones = A.zones.length;

    // [1 = target first | 0 = stop first | null = neither within HOR candles, the candle it happened in]
    function walk(i0, dir, stop, target) {
      for (let i = i0; i < Math.min(n, i0 + HOR); i++) {
        const k = K[i];
        if (dir === 1 ? k[3] <= stop : k[2] >= stop) return [0, i];
        if (dir === 1 ? k[2] >= target : k[3] <= target) return [1, i];
      }
      return [null, -1];
    }
    function bestR(i1, dir, entry, r, stop) {
      let b = 0;
      for (let i = i1; i < Math.min(n, i1 + HOR); i++) { const k = K[i]; if (dir === 1 ? k[3] <= stop : k[2] >= stop) break; b = Math.max(b, ((dir === 1 ? k[2] : k[3]) - entry) * dir / r); }
      return b;
    }
    const decided = [];
    for (const z of A.zones) {
      const dir = z.type === 'demand' ? 1 : -1;
      let j = -1;
      for (let i = first(z.conf); i < n; i++) { const k = K[i]; if (dir === 1 ? k[3] <= z.top : k[2] >= z.bot) { j = i; break; } }
      if (j < 0 || j < i0) continue;   // not touched yet, or first touched before the period
      const k = K[j];
      const entry = dir === 1 ? Math.min(z.top, k[1]) : Math.max(z.bot, k[1]);
      const stop = dir === 1 ? z.bot * (1 - BUF) : z.top * (1 + BUF);
      const r = (entry - stop) * dir;
      let res, at = j;
      if (!(r > 0)) res = 0;                                        // opened beyond the whole zone
      else if (dir === 1 ? k[3] <= stop : k[2] >= stop) res = 0;    // went straight through on the touch candle
      else [res, at] = walk(j + 1, dir, stop, entry + dir * r);
      const S = out[z.type];
      if (res === 1) S.held++; else if (res === 0) S.against++; else S.open++;
      const best = r > 0 && !(dir === 1 ? k[3] <= stop : k[2] >= stop) ? bestR(j + 1, dir, entry, r, stop) : 0;
      out.touches.push({ type: z.type, top: z.top, bot: z.bot, t: k[0], res, entry, stop, target: r > 0 ? entry + dir * r : null, hitT: res == null ? null : K[at][0], best });   // hitT: the candle the stop / target was hit in
      if (res != null) { out.r2[z.type].n++; if (best >= 2) out.r2[z.type].hit++; }
      if (res != null && r > 0) decided.push({ type: z.type, dir, pct: r / entry });
    }

    // right now: the zones price has not closed through, the structure trend and its last break
    out.price = K[n - 1][4]; out.trend = A.trend; out.lastBreak = A.breaks[A.breaks.length - 1] || null;
    out.active = A.zones.filter(z => !z.broken).map(z => ({ type: z.type, top: z.top, bot: z.bot, t: z.t, conf: z.conf, touched: z.touched }));

    // the luck check: the same trades from random candles of this coin and period
    const rand = rng(seedOf(opt.seed || 'zones') ^ n);
    const warm = Math.max(i0, Math.min(30, Math.floor(n / 4))), span = n - 1 - warm;
    if (span > 10) for (const d of decided) {
      const R = out.rnd[d.type], R2 = out.rnd2[d.type];
      for (let q = 0; q < DRAWS; q++) {
        const i = warm + Math.floor(rand() * span), e = K[i][4], st = e * (1 - d.dir * d.pct);
        const [res] = walk(i + 1, d.dir, st, e * (1 + d.dir * d.pct));
        if (res != null) { R.n++; R.held += res; R2.n++; if (bestR(i + 1, d.dir, e, e * d.pct, st) >= 2) R2.hit++; }
      }
    }
    return out;
  }

  // held % with the luck range (95%) around the random rate for that many touches
  function verdict(S, R) {
    const n = S.held + S.against, rn = R.n;
    if (!n || !rn) return { n, pct: null, base: null, luck: null, diff: null, beyond: false };
    const pct = S.held / n * 100, base = R.held / rn * 100, p0 = base / 100;
    const luck = 1.96 * Math.sqrt(Math.max(p0 * (1 - p0), 0.01) / n) * 100;
    const diff = pct - base;
    return { n, pct, base, luck, diff, beyond: Math.abs(diff) > luck };
  }

  /* Equal lows / highs: eqStats(SMC, K, tfMs, opt), same candles and opt.from as zoneStats. The engine's EQL = two swing lows
     within max(0.1%, 0.2 ATR), ≤ 48 candles apart, the older one not traded through yet; the level is the lower one (EQH mirrored).
     Trade on the first touch after the second low is confirmed (within opt.wait candles, default 200): entry AT the level
     (a candle that opens past it fills at its open), stop 1 ATR(14) past the entry, target 1 ATR the other way (1R), 96 candles.
     Random: for every decided touch, opt.draws random candles of the same coin and period, a level the same % from the close as the
     EQL was from price when it was confirmed, its first touch, the same stop / target %. Old = single swing lows / highs (not part
     of an equal pair), same rules, no random. zone = the level sits in an unbroken demand (supply) zone or ≤ 0.5 ATR past it. */
  function eqStats(SMC, K, tfMs, opt) {
    opt = opt || {};
    const HOR = opt.hor || 96, DRAWS = opt.draws || 20, WAIT = opt.wait || 200, n = K.length, FEE = opt.fee == null ? 0.0007 : opt.fee;
    const first = t => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (K[m][0] < t) lo = m + 1; else hi = m; } return lo; };
    const i0 = opt.from != null ? first(opt.from) : 0;
    const side0 = () => ({ held: 0, against: 0, open: 0, untouched: 0, r2: 0, n2: 0, back: 0, feeR: 0, zone: { held: 0, n: 0 }, rnd: { held: 0, n: 0, r2: 0, n2: 0, back: 0, all: 0 }, rndZone: { held: 0, n: 0 }, old: { held: 0, n: 0 } });
    const out = { L: side0(), H: side0(), touches: [], active: [], candles: n - i0, from: n ? K[Math.min(i0, n - 1)][0] : null, to: n ? K[n - 1][0] + tfMs : null, price: n ? K[n - 1][4] : null };
    if (n < 60 || n - i0 < 2) return out;
    const c = K[n - 1][4], base = K.concat([[K[n - 1][0] + tfMs, c, c, c, c, 0]]);
    const A = SMC.analyze(base, base.length - 1, { tf: tfMs });
    const atr = new Array(n).fill(null);
    { let sum = 0; const tr = []; for (let i = 0; i < n; i++) { const k = K[i], pc = i ? K[i - 1][4] : k[1]; const x = Math.max(k[2] - k[3], Math.abs(k[2] - pc), Math.abs(k[3] - pc)); tr.push(x); sum += x; if (tr.length > 14) sum -= tr.shift(); if (tr.length === 14) atr[i] = sum / 14; } }
    const touch = (i, dir, p) => { for (let q = i; q < Math.min(n, i + WAIT); q++) if (dir === 1 ? K[q][3] <= p : K[q][2] >= p) return q; return -1; };
    function walk(j, dir, stop, target) { for (let i = j; i < Math.min(n, j + HOR); i++) { const k = K[i]; if (dir === 1 ? k[3] <= stop : k[2] >= stop) return [0, i]; if (dir === 1 ? k[2] >= target : k[3] <= target) return [1, i]; } return [null, -1]; }
    function bestR(j, dir, e, r, stop) { let b = 0; for (let i = j; i < Math.min(n, j + HOR); i++) { const k = K[i]; if (dir === 1 ? k[3] <= stop : k[2] >= stop) break; b = Math.max(b, ((dir === 1 ? k[2] : k[3]) - e) * dir / r); } return b; }
    function trade(j, dir, p, dPct) {
      const k = K[j], e = dir === 1 ? Math.min(p, k[1]) : Math.max(p, k[1]), d = e * dPct, stop = e - dir * d, target = e + dir * d;
      const back = dir === 1 ? k[4] >= p : k[4] <= p;   // the touch candle closed back on the level's side
      if (dir === 1 ? k[3] <= stop : k[2] >= stop) return { res: 0, at: j, r2: 0, best: 0, back, entry: e, stop, target };
      const [res, at] = walk(j + 1, dir, stop, target), [r2] = walk(j + 1, dir, stop, e + 2 * dir * d);
      return { res, at, r2, best: bestR(j + 1, dir, e, d, stop), back, entry: e, stop, target };
    }
    const rand = rng(seedOf(opt.seed || 'eqs') ^ n), lo = Math.max(i0, 20), span = n - 2 - lo;
    const pairT = new Set(A.eqs.flatMap(e => [e.side + e.t, e.side + e.t1]));
    const inst = A.eqs.map(e => ({ eq: true, side: e.side, p: e.p, conf: e.conf, t1: e.t1, t: e.t }))
      .concat(A.swings.filter(s => !pairT.has(s.side + s.t)).map(s => ({ eq: false, side: s.side, p: s.p, conf: s.conf })));
    const seen = new Set();
    for (const e of inst) {
      const dir = e.side === 'L' ? 1 : -1, S = out[e.side], ic = first(e.conf);
      if (ic < 20 || ic >= n - 1 || !atr[ic - 1]) continue;
      const j = touch(ic, dir, e.p);
      if (j < 0) { if (e.eq && ic >= i0) S.untouched++; continue; }
      if (j < i0) continue;   // touched before the period
      const a = atr[ic - 1], dPct = a / e.p, q = e.p / K[ic - 1][4];
      const key = (e.eq ? 'e' : 'o') + e.side + j + ':' + Math.round(e.p / (a * 0.25)); if (seen.has(key)) continue; seen.add(key);   // two pairs at one level, one touch
      const T = trade(j, dir, e.p, dPct);
      if (!e.eq) { if (T.res != null) { S.old.n++; S.old.held += T.res; } continue; }
      const zt = dir === 1 ? 'demand' : 'supply';
      const zone = A.zones.some(z => z.type === zt && z.conf <= K[j][0] && !(z.broken && z.broken <= K[j][0]) &&
        (dir === 1 ? e.p <= z.top && e.p >= z.bot - 0.5 * a : e.p >= z.bot && e.p <= z.top + 0.5 * a));
      if (T.res === 1) S.held++; else if (T.res === 0) S.against++; else S.open++;
      if (T.res != null) { S.feeR += FEE / dPct; if (T.back) S.back++; if (zone) { S.zone.n++; S.zone.held += T.res; } }
      if (T.r2 != null) { S.n2++; S.r2 += T.r2; }
      out.touches.push({ side: e.side, p: e.p, t: K[j][0], first: e.t1, second: e.t, zone, res: T.res, entry: T.entry, stop: T.stop, target: T.target,
        hitT: T.res == null ? null : K[T.at][0], best: T.best, back: T.back, wait: j - ic });
      if (T.res != null && span > 10) for (let z = 0; z < DRAWS; z++) {
        const j0 = lo + Math.floor(rand() * span), p2 = K[j0][4] * q, jt = touch(j0 + 1, dir, p2); if (jt < 0) continue;
        const X = trade(jt, dir, p2, dPct); S.rnd.all++; if (X.back) S.rnd.back++;
        if (X.res != null) { S.rnd.n++; S.rnd.held += X.res; if (zone) { S.rndZone.n++; S.rndZone.held += X.res; } }
        if (X.r2 != null) { S.rnd.n2++; S.rnd.r2 += X.r2; }
      }
    }
    out.touches.sort((x, y) => x.t - y.t);
    // right now: equal lows / highs price has not traded through yet
    const px = K[n - 1][4], aNow = atr[n - 1] || 0;
    out.active = A.eqs.filter(e => !e.taken && (e.side === 'L' ? e.p < px : e.p > px)).map(e => {
      const zt = e.side === 'L' ? 'demand' : 'supply';
      const zone = A.zones.some(z => z.type === zt && !z.broken && (e.side === 'L' ? e.p <= z.top && e.p >= z.bot - 0.5 * aNow : e.p >= z.bot && e.p <= z.top + 0.5 * aNow));
      return { side: e.side, p: e.p, t: e.t, first: e.t1, zone };
    });
    out.atrPct = aNow && px ? aNow / px * 100 : null;
    return out;
  }

  const api = { zoneStats, eqStats, verdict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZoneStats = api;
})(typeof window !== 'undefined' ? window : this);
