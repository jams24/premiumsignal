// The real example (scripts/pick.cjs → data/example.json) and helpers to draw it as the chart was at any moment.
import EX from './data/example.json';

export { EX };
export const MIN = 60000, TF5 = 5 * MIN;
const D0 = new Date(EX.setup.t);
// 'hh:mm' on the example's day (UTC) → ms
export const T = (s) => { const [h, m] = s.split(':').map(Number); return Date.UTC(D0.getUTCFullYear(), D0.getUTCMonth(), D0.getUTCDate(), h, m); };
export const hm = (t) => new Date(t).toISOString().slice(11, 16);
export const fp = (p) => Number(p).toFixed(2);
export const DAY = D0.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

// Candles of `tf` as they looked at time `upto` (ms): closed ones plus the one still forming, built from the 1-minute
// candles. The minute in progress grows from its open toward its close, so the chart prints like a live one.
export function candlesAt(tf, upto) {
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
export function fit(t0, t1, pad = 0.08) {
  let lo = Infinity, hi = -Infinity;
  for (const k of EX.k1) if (k[0] >= t0 && k[0] < t1) { lo = Math.min(lo, k[3]); hi = Math.max(hi, k[2]); }
  const d = (hi - lo) * pad;
  return { p0: lo - d, p1: hi + d };
}

export const S = {
  brk: EX.brk, zone: EX.zone, leg: EX.leg, sweep: EX.sweep, trig: EX.trig, setup: EX.setup, out: EX.outcome,
  swings: EX.swings,
  premT: EX.leg.prem ? EX.leg.prem.t : null,
  risk: Math.abs(EX.setup.stop - EX.setup.entry) / EX.setup.entry * 100,
  reward: Math.abs(EX.setup.target - EX.setup.entry) / EX.setup.entry * 100,
};

// the A+ checklist on the desk's top line, as it stood at `upto`
export function checklist(upto) {
  return [
    { k: 'break', done: upto >= S.brk.conf },
    { k: EX.dir === -1 ? 'premium' : 'discount', done: S.premT != null && upto >= S.premT + MIN },
    { k: 'sweep', done: upto >= S.sweep.conf },
    { k: '1m CHoCH', done: upto >= S.setup.conf },
  ];
}
