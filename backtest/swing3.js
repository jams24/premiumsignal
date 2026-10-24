// Swing replay, step 3: trade the replayed signals with different plans, one portfolio per plan.
// Shared rules (live swing executor): longs only, no BTC/ETH/SOL, one position per coin, max 5 open, 2h cooldown and 5% re-entry
// drift until 01:00 UTC after a close, $10 daily loss stop, 120-min pause after 3 losses in a row.
// Exits: on 5m candles for 72h, then 1h candles up to the plan's max hold; a candle that hits stop and target counts the stop.
// Costs: 0.05% taker fee per side plus 0.05% slippage on stop exits ("net"). The paper trades in the DB are fee-free ("gross").
// usage: NODE_PATH=node_modules node --max-old-space-size=8000 backtest/swing3.js
const fs = require('fs'), path = require('path');
const H = 3600000, D = 24 * H, M5 = 300000, DIR = path.join(__dirname, 'data_swing');
const sig = JSON.parse(fs.readFileSync(path.join(DIR, 'signals.json'))).filter(s => s.entry && !['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].includes(s.sym)).sort((a, b) => a.T - b.T);
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'm5.json')));
const H1 = {};
for (const d of ['data_early', 'data']) { const j = JSON.parse(fs.readFileSync(path.join(__dirname, d, 'h1L.json'))); for (const [s, rows] of Object.entries(j)) { if (!M[s]) continue; const m = H1[s] || (H1[s] = new Map()); for (const r of rows) m.set(r[0], r); } }
for (const s of Object.keys(H1)) H1[s] = [...H1[s].values()].sort((a, b) => a[0] - b[0]);
const first = (k, t) => { let lo = 0, hi = k.length; while (lo < hi) { const m = (lo + hi) >> 1; if (k[m][0] < t) lo = m + 1; else hi = m; } return lo; };
const FEE = 0.0005, SLIP = 0.0005;

// --- entry ---
// live pullback queue: zone = highest 5m swing low (last 29 closed candles) below price and above the stop, else 40% of the way to the stop;
// every 5 min for 30 min: cancel on ±5% or price through stop; enter on a green zone-reclaim candle (stop → sweep low −0.2%);
// at 30 min enter only if the last candle is green (keeps the wide setup stop)
function pullbackEntry(s) {
  const k = M[s.sym]; if (!k) return null; const i0 = first(k, s.T);
  if (i0 < 30 || k[i0]?.[0] !== s.T) return null;
  const p = s.price, sl0 = s.sl, pre = k.slice(i0 - 29, i0);
  const lows = []; for (let i = 1; i < pre.length - 1; i++) { const l = pre[i][3]; if (l < pre[i - 1][3] && l < pre[i + 1][3] && l < p && l > sl0) lows.push(l); }
  const dz = lows.length ? Math.max(...lows) : p - (p - sl0) * 0.4;
  for (let n = 1; n <= 6; n++) {
    const i = i0 + n - 1; if (!k[i]) return null; const close = k[i][4];
    if (close > p * 1.05 || close < p * 0.95 || close <= sl0) return null;
    const done = k.slice(Math.max(0, i - 7), i);
    for (let q = done.length - 1; q >= Math.max(0, done.length - 4); q--) {
      const [, o, h, l, c] = done[q]; if (l > dz * 1.003) continue;
      const body = Math.abs(c - o), rng = h - l; if (rng <= 0) continue;
      if (c > o && c > dz && (body / rng >= 0.3 || (Math.min(o, c) - l >= body * 1.5 && body > 0)))
        return { t: k[i][0] + M5, price: close, sl: Math.max(sl0, l * 0.998), how: 'sweep' };
    }
    if (n === 6) { const [, o, , , c] = done.at(-1); if (c > o) return { t: k[i][0] + M5, price: close, sl: sl0, how: 'timeout' }; return null; }
  }
  return null;
}
const marketEntry = (s) => ({ t: s.T, price: s.price, sl: s.sl, how: 'market' });

// candle stream from t: 5m while stored, then 1h
function* candles(sym, t, until) {
  const k = M[sym]; let i = first(k, t), last = t;
  while (k[i] && k[i][0] === last && last < until) { yield k[i]; last += M5; i++; }
  const h = H1[sym]; if (!h) return; let j = first(h, Math.ceil(last / H) * H);
  while (h[j] && h[j][0] < until) { yield h[j]; j++; }
}

// --- exits ---
// plan.tp: 'live' = min(daily ATR × 1.2/2.5/4, 3/6/10%) with TP4 = 8 ATR; 'setup' = the scanner's swing targets; [a,b,c] = fixed %
function runTrade(s, e, plan) {
  const p = e.price; let sl = e.sl;
  if (plan.slCapPct) sl = Math.max(sl, p * (1 - plan.slCapPct / 100));
  if (plan.slMinPct) sl = Math.min(sl, p * (1 - plan.slMinPct / 100));
  let tps;
  if (plan.tp === 'live') { const a = s.atr; tps = [Math.min(p + a * 1.2, p * 1.03), Math.min(p + a * 2.5, p * 1.06), Math.min(p + a * 4, p * 1.10), p + a * 8]; }
  else if (plan.tp === 'setup') tps = [s.tp1, s.tp2, s.tp3, Infinity];
  else tps = [...plan.tp.map(x => p * (1 + x / 100)), Infinity];
  const riskPct = (p - sl) / p;
  const notional = plan.riskUsd ? Math.min(plan.riskUsd / riskPct, plan.maxNotional) : plan.notional;
  let left = 1, pnl = 0, hit = 0, peak = p, end = e.t + plan.maxHoldH * H, last = null, why = 'time';
  const close = (frac, px, slip) => { pnl += frac * notional * ((px * (1 - (slip ? SLIP : 0))) / p - 1) - frac * notional * FEE * (1 + px / p) * (plan.gross ? 0 : 1); left -= frac; };
  if (plan.gross) { /* fee-free like the paper trades in the DB */ }
  for (const c of candles(s.sym, e.t, end)) {
    last = c; const [, , hi, lo] = c;
    if (lo <= sl) { close(left, sl, !plan.gross); why = hit ? `sl after TP${hit}` : 'sl'; break; }
    // targets (one level per candle, like the live one-action-per-tick loop)
    if (hit < 4 && hi >= tps[hit]) {
      const lvl = hit; hit++;
      if (lvl === 3) { close(left, tps[3], false); why = 'tp4'; break; }
      const frac = lvl === 0 ? plan.part[0] : lvl === 1 ? left * plan.part[1] : left * plan.part[2];
      close(frac, tps[lvl], false);
      if (left <= 1e-9) { why = `tp${lvl + 1}`; break; }
      sl = Math.max(sl, lvl === 0 ? p : tps[lvl - 1]);
      peak = Math.max(peak, hi);
      continue;
    }
    peak = Math.max(peak, hi);
    if (plan.trail && hit >= 1) { const d = Math.min(s.atr * (hit >= 3 ? 5 : 3), (peak - p) * (hit >= 3 ? 0.25 : hit >= 2 ? 0.3 : 0.4)); const t = peak - d; if (t > p && t > sl) sl = t; }
    if (plan.beAtPct && hit === 0 && hi >= p * (1 + plan.beAtPct / 100) && sl < p) sl = p;
  }
  if (left > 1e-9 && last) close(left, last[4], false);
  return { pnl, notional, why, hit, exitT: last ? last[0] : e.t, riskPct };
}

function sim(plan, from = 0, to = Infinity) {
  const open = new Map(), lastClose = new Map(); const trades = []; let day = '', dayPnl = 0, streak = 0, pauseUntil = 0;
  const book = (r) => { trades.push(r); lastClose.set(r.sym, { t: r.exitT, entry: r.entry }); };
  for (const s of sig) {
    if (s.T < from || s.T >= to) continue;
    for (const [sym, r] of open) if (r.exitT <= s.T) { open.delete(sym); book(r); }
    const d = new Date(s.T).toISOString().slice(0, 10); if (d !== day) { day = d; dayPnl = trades.filter(r => new Date(r.exitT).toISOString().slice(0, 10) === d).reduce((a, r) => a + r.pnl, 0); }
    if (open.has(s.sym) || open.size >= plan.maxOpen) continue;
    if (plan.dailyStop && dayPnl <= -plan.dailyStop) continue;
    if (s.T < pauseUntil) continue;
    const lc = lastClose.get(s.sym);
    if (lc) { const n1 = new Date(lc.t); n1.setUTCHours(1, 0, 0, 0); if (n1.getTime() <= lc.t) n1.setUTCDate(n1.getUTCDate() + 1);
      if (s.T < n1.getTime()) { if (s.T - lc.t < 2 * H) continue; if ((s.price - lc.entry) / lc.entry * 100 > 5) continue; }
      if (plan.coinGapH && s.T - lc.t < plan.coinGapH * H) continue; }
    if (plan.filter && !plan.filter(s)) continue;
    const e = plan.entry === 'market' ? marketEntry(s) : pullbackEntry(s); if (!e) continue;
    if (plan.sweepOnly && e.how !== 'sweep') continue;
    const r = runTrade(s, e, plan); Object.assign(r, { sym: s.sym, T: s.T, entryT: e.t, entry: e.price, how: e.how, setupType: s.setupType, score: s.score });
    open.set(s.sym, r);
    // daily stop / losing streak are known only when the trade closes; approximate with close-time bookkeeping
    if (r.pnl < 0) { streak++; if (streak >= 3 && plan.cbPauseMin) { pauseUntil = r.exitT + plan.cbPauseMin * 60000; streak = 0; } } else streak = 0;
    if (new Date(r.exitT).toISOString().slice(0, 10) === day) dayPnl += r.pnl;
  }
  for (const r of open.values()) book(r);
  return trades;
}

const LIVE = { entry: 'pullback', tp: 'live', part: [0.33, 0.5, 0.5], trail: true, notional: 50, maxHoldH: 14 * 24, maxOpen: 5, dailyStop: 10, cbPauseMin: 120 };
const SWING = { entry: 'market', tp: 'setup', part: [0.33, 0.5, 0.5], trail: false, riskUsd: 10, maxNotional: 250, maxHoldH: 14 * 24, maxOpen: 5, dailyStop: 0, cbPauseMin: 0, coinGapH: 24 };
const btcUp = (() => { const k = H1.BTCUSDT || null; return null; })();
const PLANS = [
  ['A0 live replica, fee-free (like DB paper)', { ...LIVE, gross: true }],
  ['A1 live replica, with fees + slippage', { ...LIVE }],
  ['A2 live, sweep entries only', { ...LIVE, sweepOnly: true }],
  ['A3 live, stop at least 1.5% away', { ...LIVE, slMinPct: 1.5 }],
  ['A4 live, stop at least 3% away', { ...LIVE, slMinPct: 3 }],
  ['B0 true swing: market entry, setup stop + swing TPs, risk $10', { ...SWING }],
  ['B1 true swing, stop capped at 8%', { ...SWING, slCapPct: 8 }],
  ['B2 true swing, TPs 5/12/25%, trail after TP1', { ...SWING, tp: [5, 12, 25], trail: true }],
  ['B3 swing, stop 8% cap, TPs 5/12/25%, trail, BE at +4%', { ...SWING, slCapPct: 8, tp: [5, 12, 25], trail: true, beAtPct: 4 }],
  ['B4 swing, 72h max hold, stop 8% cap, TPs 5/12/25% trail', { ...SWING, slCapPct: 8, tp: [5, 12, 25], trail: true, maxHoldH: 72 }],
];
const P1 = [Date.parse('2026-02-04'), Date.parse('2026-06-01')], P2 = [Date.parse('2026-06-01'), Date.parse('2026-10-18')], CAL = [Date.parse('2026-09-15'), Date.parse('2026-10-18')];
const fmt = (tr) => { const n = tr.length, w = tr.filter(r => r.pnl > 0).length, s = tr.reduce((a, r) => a + r.pnl, 0);
  let eq = 0, pk = 0, dd = 0; for (const r of [...tr].sort((a, b) => a.exitT - b.exitT)) { eq += r.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return `${String(n).padStart(5)} tr ${String((w / Math.max(n, 1) * 100).toFixed(0)).padStart(3)}% win ${(s >= 0 ? '+' : '') + s.toFixed(0).padStart(5)} (${(s / Math.max(n, 1)).toFixed(2)}/tr) dd ${dd.toFixed(0)}`; };
const months = (tr) => { const m = {}; for (const r of tr) { const k = new Date(r.T).toISOString().slice(0, 7); m[k] = (m[k] || 0) + r.pnl; } return Object.entries(m).sort().map(([k, v]) => `${k.slice(5)}:${v >= 0 ? '+' : ''}${v.toFixed(0)}`).join(' '); };
const out = {};
for (const [name, plan] of PLANS) {
  const all = sim(plan, P1[0], P2[1]);
  const a = all.filter(r => r.T < P1[1]), b = all.filter(r => r.T >= P2[0]), c = all.filter(r => r.T >= CAL[0]);
  console.log(`\n${name}\n  Feb–May ${fmt(a)}\n  Jun–Oct ${fmt(b)}\n  15Sep–17Oct ${fmt(c)}\n  months ${months(all)}`);
  const hw = {}; for (const r of all) { hw[r.how] = hw[r.how] || [0, 0]; hw[r.how][0]++; hw[r.how][1] += r.pnl; }
  const why = {}; for (const r of all) { why[r.why] = why[r.why] || [0, 0]; why[r.why][0]++; why[r.why][1] += r.pnl; }
  console.log('  entry', Object.entries(hw).map(([k, v]) => `${k} ${v[0]} ${v[1].toFixed(0)}`).join(' | '), '|| exit', Object.entries(why).sort((x, y) => y[1][0] - x[1][0]).slice(0, 6).map(([k, v]) => `${k} ${v[0]} ${v[1].toFixed(0)}`).join(' | '));
  out[name] = all;
}
fs.writeFileSync(path.join(DIR, 'trades.json'), JSON.stringify(out));
