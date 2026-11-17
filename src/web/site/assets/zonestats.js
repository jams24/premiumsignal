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
   side and the same stop / target distance in %, the same rules. Seeded, so a refresh shows the same numbers. */
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
    const out = { demand: { held: 0, against: 0, open: 0 }, supply: { held: 0, against: 0, open: 0 }, rnd: { demand: { held: 0, n: 0 }, supply: { held: 0, n: 0 } },
      touches: [], zones: 0, from: n ? K[0][0] : null, to: n ? K[n - 1][0] + tfMs : null, candles: n };
    if (n < 60) return out;
    // a flat candle after the last one closes it, so the engine reads every candle given (as the desk's Trend section does)
    const c = K[n - 1][4], base = K.concat([[K[n - 1][0] + tfMs, c, c, c, c, 0]]);
    const A = SMC.analyze(base, base.length - 1, { tf: tfMs });
    out.zones = A.zones.length;

    // 1 = target first, 0 = stop first, null = neither within HOR candles
    function walk(i0, dir, stop, target) {
      for (let i = i0; i < Math.min(n, i0 + HOR); i++) {
        const k = K[i];
        if (dir === 1 ? k[3] <= stop : k[2] >= stop) return 0;
        if (dir === 1 ? k[2] >= target : k[3] <= target) return 1;
      }
      return null;
    }
    const first = t => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (K[m][0] < t) lo = m + 1; else hi = m; } return lo; };
    const decided = [];
    for (const z of A.zones) {
      const dir = z.type === 'demand' ? 1 : -1;
      let j = -1;
      for (let i = first(z.conf); i < n; i++) { const k = K[i]; if (dir === 1 ? k[3] <= z.top : k[2] >= z.bot) { j = i; break; } }
      if (j < 0) continue;   // not touched yet
      const k = K[j];
      const entry = dir === 1 ? Math.min(z.top, k[1]) : Math.max(z.bot, k[1]);
      const stop = dir === 1 ? z.bot * (1 - BUF) : z.top * (1 + BUF);
      const r = (entry - stop) * dir;
      let res;
      if (!(r > 0)) res = 0;                                        // opened beyond the whole zone
      else if (dir === 1 ? k[3] <= stop : k[2] >= stop) res = 0;    // went straight through on the touch candle
      else res = walk(j + 1, dir, stop, entry + dir * r);
      const S = out[z.type];
      if (res === 1) S.held++; else if (res === 0) S.against++; else S.open++;
      out.touches.push({ type: z.type, top: z.top, bot: z.bot, t: k[0], res, entry, stop, target: r > 0 ? entry + dir * r : null });
      if (res != null && r > 0) decided.push({ type: z.type, dir, pct: r / entry });
    }

    // right now: the zones price has not closed through, the structure trend and its last break
    out.price = K[n - 1][4]; out.trend = A.trend; out.lastBreak = A.breaks[A.breaks.length - 1] || null;
    out.active = A.zones.filter(z => !z.broken).map(z => ({ type: z.type, top: z.top, bot: z.bot, t: z.t, conf: z.conf, touched: z.touched }));

    // the luck check: the same trades from random candles of this coin and period
    const rand = rng(seedOf(opt.seed || 'zones') ^ n);
    const warm = Math.min(30, Math.floor(n / 4)), span = n - 1 - warm;
    if (span > 10) for (const d of decided) {
      const R = out.rnd[d.type];
      for (let q = 0; q < DRAWS; q++) {
        const i = warm + Math.floor(rand() * span), e = K[i][4];
        const res = walk(i + 1, d.dir, e * (1 - d.dir * d.pct), e * (1 + d.dir * d.pct));
        if (res != null) { R.n++; R.held += res; }
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

  const api = { zoneStats, verdict };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZoneStats = api;
})(typeof window !== 'undefined' ? window : this);
