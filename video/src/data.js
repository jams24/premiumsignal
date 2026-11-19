// The real examples (scripts/pick.cjs → data/example.json for the short, OUT=example_long.json for the long) and
// helpers to draw each one as the chart was at any moment. SHORT is the default everywhere; the long walk-through
// passes LONG.
import EXS from './data/example.json';
import EXL from './data/example_long.json';

export const MIN = 60000, TF5 = 5 * MIN;
export const hm = (t) => new Date(t).toISOString().slice(11, 16);
// ETH-size prices with 2 decimals, BTC-size prices as whole dollars with a comma
export const fp = (p) => {
  p = Number(p);
  const a = Math.abs(p);
  return a >= 10000 ? Math.round(p).toLocaleString('en-US') : p.toFixed(a >= 100 ? 2 : a >= 1 ? 4 : 5);
};

function build(EX) {
  const D0 = new Date(EX.setup.t);
  // 'hh:mm' on the example's day (UTC) → ms; day -1 = the evening before
  const T = (s, day = 0) => { const [h, m] = s.split(':').map(Number); return Date.UTC(D0.getUTCFullYear(), D0.getUTCMonth(), D0.getUTCDate() + day, h, m); };
  const DAY = D0.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

  // Candles of `tf` as they looked at time `upto` (ms): closed ones plus the one still forming, built from the 1-minute
  // candles. The minute in progress grows from its open toward its close, so the chart prints like a live one.
  function candlesAt(tf, upto) {
    const out = []; let cur = null;
    for (const k of EX.k1) {
      if (k[0] >= upto) break;
      let [t, o, h, l, c] = k;
      const f = Math.min(1, (upto - t) / MIN);
      if (f < 1) {
        const g = Math.min(1, f * 1.5), cc = o + (c - o) * f;
        h = Math.max(o, cc, o + (h - o) * g); l = Math.min(o, cc, o + (l - o) * g); c = cc;
      }
      const b = Math.floor(t / tf) * tf;
      if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o, h, l, c }; }
      else { cur.h = Math.max(cur.h, h); cur.l = Math.min(cur.l, l); cur.c = c; }
    }
    if (cur) out.push(cur);
    return out;
  }

  // a price range that fits every candle between t0 and t1 (1-minute data), padded
  function fit(t0, t1, pad = 0.08) {
    let lo = Infinity, hi = -Infinity;
    for (const k of EX.k1) if (k[0] >= t0 && k[0] < t1) { lo = Math.min(lo, k[3]); hi = Math.max(hi, k[2]); }
    const d = (hi - lo) * pad;
    return { p0: lo - d, p1: hi + d };
  }

  const S = {
    brk: EX.brk, zone: EX.zone, leg: EX.leg, sweep: EX.sweep, trig: EX.trig, setup: EX.setup, out: EX.outcome,
    swings: EX.swings,
    premT: EX.leg.prem ? EX.leg.prem.t : null,   // when price first reached premium (short) / discount (long)
    risk: Math.abs(EX.setup.stop - EX.setup.entry) / EX.setup.entry * 100,
    reward: Math.abs(EX.setup.target - EX.setup.entry) / EX.setup.entry * 100,
  };

  // the A+ checklist on the desk's top line, as it stood at `upto`
  const checklist = (upto) => [
    { k: 'break', done: upto >= S.brk.conf },
    { k: EX.dir === -1 ? 'premium' : 'discount', done: S.premT != null && upto >= S.premT + MIN },
    { k: 'sweep', done: upto >= S.sweep.conf },
    { k: '1m CHoCH', done: upto >= S.setup.conf },
  ];

  return { EX, T, DAY, candlesAt, fit, S, checklist };
}

export const SHORT = build(EXS), LONG = build(EXL);
export const { EX, T, DAY, candlesAt, fit, S, checklist } = SHORT;
