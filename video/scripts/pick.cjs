// Picks a real, complete A+ setup for the "Walk me through" video and saves everything the video draws to
// src/data/example.json. Same engine as the desk coach (src/web/smcEngine.js), 5m structure, 1-minute candles from
// Binance USDⓈ-M futures (public klines, no keys). Causal: each layer is what the engine knew when it happened.
//   node scripts/pick.cjs                → scan the default coins over the last 3 days, list candidates, save the best
//   node scripts/pick.cjs LTCUSDT 2      → one coin, 2 days ("all" = the default coins) · PICK=ETHUSDT@<ms> picks one
//   SIDE=long lists only longs
const fs = require('fs'), path = require('path');
const SMC = require(path.join(__dirname, '../../src/web/smcEngine.js'));
const MIN = 60000, TF = 5 * MIN;
const COINS = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['LTCUSDT', 'SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'DOTUSDT'];
const DAYS = Number(process.argv[3] || 3);

async function klines(sym, start, end) {
  const out = [];
  for (let t = start; t < end;) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1m&startTime=${t}&limit=1500`;
    let r, tries = 0;
    for (;;) { try { r = await (await fetch(url)).json(); break; } catch (e) { if (++tries > 3) throw e; await new Promise(f => setTimeout(f, 1500)); } }
    if (!Array.isArray(r) || !r.length) break;
    for (const k of r) if (k[0] < end && k[0] + MIN <= Date.now()) out.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
    t = r[r.length - 1][0] + MIN;
    if (r.length < 1500) break;
  }
  return out;
}

// walk forward from the trigger candle: which comes first, the stop or the target (stop wins a tie)
function outcome(base, i0, s) {
  const d = s.dir;
  for (let i = i0 + 1; i < base.length; i++) {
    const k = base[i];
    if (d === 1 ? k[3] <= s.stop : k[2] >= s.stop) return { hit: 'stop', t: k[0], i };
    if (d === 1 ? k[2] >= s.target : k[3] <= s.target) return { hit: 'target', t: k[0], i };
  }
  return { hit: 'open', t: null, i: null };
}

const agg5 = (base, from, to) => {
  const out = []; let cur = null;
  for (const k of base) {
    if (k[0] < from || k[0] >= to) continue;
    const b = Math.floor(k[0] / TF) * TF;
    if (!cur || cur[0] !== b) { if (cur) out.push(cur); cur = [b, k[1], k[2], k[3], k[4], k[5]]; }
    else { cur[2] = Math.max(cur[2], k[2]); cur[3] = Math.min(cur[3], k[3]); cur[4] = k[4]; cur[5] += k[5]; }
  }
  if (cur) out.push(cur);
  return out;
};

(async () => {
  const end = Math.floor(Date.now() / MIN) * MIN, start = end - DAYS * 1440 * MIN;
  const cands = [];
  for (const sym of COINS) {
    let base;
    try { base = await klines(sym, start, end); } catch (e) { console.log(sym, 'fetch failed', e.message); continue; }
    if (base.length < 600) continue;
    const A = SMC.analyze(base, base.length - 1, { tf: TF });
    for (const s of A.setups) {
      const i0 = base.findIndex(k => k[0] === s.t);
      const o = outcome(base, i0, s);
      if (o.hit !== 'target') continue;
      const B = SMC.analyze(base, i0, { tf: TF });        // what the engine knew at the trigger
      const brk = s.brk, prior = B.swings.filter(w => w.t < brk.t).slice(-4);
      const trendOk = brk.kind === 'CHoCH' && prior.filter(w => (s.dir === 1 ? /LH|LL/ : /HH|HL/).test(w.label)).length >= 3;
      const span = (o.t - brk.t) / MIN;
      const score = (trendOk ? 3 : 0) + (s.inZone ? 1 : 0) + (s.R >= 1.5 && s.R <= 4 ? 2 : 0) + (span <= 8 * 60 ? 1 : 0) + (s.tgtKind === 'leg' ? 1 : 0);
      cands.push({ sym, s, o, i0, base, B, score, span, trendOk });
    }
  }
  cands.sort((a, b) => b.score - a.score || b.o.t - a.o.t);
  for (const c of cands.filter(c => !process.env.SIDE || c.s.side === process.env.SIDE).slice(0, 15)) console.log(`${c.sym.padEnd(9)} ${c.s.side.padEnd(5)} ${new Date(c.s.t).toISOString().slice(5, 16)} R ${c.s.R.toFixed(2)} ${c.s.tgtKind} zone ${c.s.inZone} ${c.s.brk.kind} trend ${c.trendOk} span ${c.span}m score ${c.score}`);
  const pick = process.env.PICK ? cands.find(c => `${c.sym}@${c.s.t}` === process.env.PICK) : cands[0];
  if (!pick) { console.log('no candidate'); process.exit(1); }

  const { sym, s, o, base, B } = pick, brk = s.brk;
  const prior = B.swings.filter(w => w.t < brk.t);
  const from = Math.floor(((prior.length >= 5 ? prior[prior.length - 5].t : brk.t - 4 * 3600e3) - 30 * MIN) / TF) * TF;
  const to = Math.ceil((o.t + 45 * MIN) / TF) * TF;
  const k5 = agg5(base, from, to);
  const z1 = Math.min(s.trig.t, s.sweep.wickT) - 25 * MIN, z2 = s.t + 20 * MIN;
  const k1 = base.filter(k => k[0] >= from && k[0] < to);
  const r = v => +v.toPrecision(7);
  // the leg as it stood at the trigger, and when price first reached discount / the zone
  const leg = B.leg && B.leg.last && B.leg.last.t === s.t ? B.leg : null;
  const ex = {
    symbol: sym.replace(/USDT$/, ''), pair: sym, exchange: 'Binance futures', tf: '5m', fetched: new Date().toISOString(),
    side: s.side, dir: s.dir,
    k5: k5.map(k => [k[0], r(k[1]), r(k[2]), r(k[3]), r(k[4])]),
    k1: k1.map(k => [k[0], r(k[1]), r(k[2]), r(k[3]), r(k[4])]), zoom: { from: z1, to: z2 },
    swings: B.swings.filter(w => w.t >= from && w.t < to).map(w => ({ side: w.side, t: w.t, at: w.at, p: w.p, label: w.label, conf: w.conf })),
    brk: { kind: brk.kind, dir: brk.dir, p: brk.p, fromT: brk.fromT, t: brk.t, conf: brk.conf, close: brk.close },
    zone: s.zone ? { type: s.zone.type, top: s.zone.top, bot: s.zone.bot, t: s.zone.t, conf: s.zone.conf } : null,
    leg: { hi: s.hi, lo: s.lo, eq: s.eq, hiT: leg ? leg.hiT : null, loT: leg ? leg.loT : null, prem: leg && leg.prem ? leg.prem : null, inZone: leg && leg.inZone ? leg.inZone : null },
    sweep: s.sweep, trig: s.trig,
    setup: { t: s.t, conf: s.conf, entry: s.entry, stop: s.stop, target: s.target, R: s.R, tgtKind: s.tgtKind },
    outcome: { hit: o.hit, t: o.t },
  };
  fs.writeFileSync(path.join(__dirname, '../src/data/example.json'), JSON.stringify(ex));
  console.log(`\nsaved ${sym} ${s.side} at ${new Date(s.t).toISOString()} · ${k5.length} 5m candles, ${k1.length} 1m candles · entry ${s.entry} stop ${s.stop} target ${s.target} R ${s.R.toFixed(2)} → ${o.hit} ${new Date(o.t).toISOString()}`);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
