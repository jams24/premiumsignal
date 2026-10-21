// Demand-zone study, step 2: real results, direction edge, strict filter test, and alternative exits on the same entries
process.chdir(require('path').join(__dirname, 'data_dz'));
const fs = require('fs'), K = require('./evalkit');
const T = JSON.parse(fs.readFileSync('dz_trades.json')), P = JSON.parse(fs.readFileSync('dz_paths.json')), H1 = JSON.parse(fs.readFileSync('dz_h1.json'));
const M = 60000, H = 60 * M, SIZE = 500;
const $ = K.$;
const btc = H1.BTC; const bIdx = t => K.idx(btc, t);
const rows = [];
// paper trades only ($500 each; the 78 live trades were a different size)
for (const t of T) { if (t.status !== 'closed' || t.mode !== 'paper') continue; const hl = P[t.id]; if (!hl || hl.length < 3 * 120) continue;
  const t0 = new Date(t.created_at).getTime(), E = +t.entry_price, L = t.direction === 'long', ps = +t.position_size || SIZE;
  const real = (+t.pnl_usd || 0) + (+t.realized_pnl || 0); /* position_size shrinks after partial TPs, so no rescaling */
  const c = t.onchain_context || {}, z = c.zone || {}, sig = (c.signals || []).join(' | ');
  const F = { score: c.score, 'zone.range%': z.range, 'zone.candles': z.clusterLen, 'zone.retestHeld': z.retestBounced ? 1 : 0,
    'entry in zone (0=low,1=high)': z.high > z.low ? (E - z.low) / (z.high - z.low) : null, 'stop dist%': Math.abs(E - +t.original_stop_loss) / E * 100,
    'sig.inZone': /IN demand zone/.test(sig) ? 1 : 0, 'sig.higherLows': /Higher lows/.test(sig) ? 1 : 0, 'sig.atEMA20': /EMA20/.test(sig) ? 1 : 0, 'sig.volCompressed': /compress|narrowing|tightening/i.test(sig) ? 1 : 0,
    'sig.bounce': /Bounce candle/.test(sig) ? 1 : 0, 'sig.stillFalling': /Still falling/.test(sig) ? 1 : 0, 'sig.OI': /OI /.test(sig) ? 1 : 0, 'sig.smartMoney': /Smart money|Top traders/.test(sig) ? 1 : 0, 'sig.outflows': /outflow/i.test(sig) ? 1 : 0,
    'hourUTC': new Date(t0).getUTCHours(), 'weekday': new Date(t0).getUTCDay(), 'short?': L ? 0 : 1 };
  const j = bIdx(t0); if (j > 170) { F['btc.1h'] = K.chg(btc, j, 1); F['btc.4h'] = K.chg(btc, j, 4); F['btc.24h'] = K.chg(btc, j, 24); F['btc.7d'] = K.chg(btc, j, 168);
    const cl = btc.slice(j - 80, j + 1).map(x => x[4]); F['btc vs 1h EMA50 %'] = (cl.at(-1) / K.ema(cl, 50) - 1) * 100; }
  const hk = H1[`${t.exchange}:${t.symbol}:${Math.floor(Math.floor(t0 / M) * M / (6 * H))}`];
  if (hk && hk.length > 100) { const k = hk.filter(x => x[0] + H <= t0); const n = k.length - 1, cl = k.map(x => x[4]);
    if (n > 170) { F['coin.4h%'] = K.chg(k, n, 4); F['coin.24h%'] = K.chg(k, n, 24); F['coin.3d%'] = K.chg(k, n, 72); F['coin.7d%'] = K.chg(k, n, 168);
      F['coin.rsi1h'] = K.rsi(cl.slice(-100)); F['coin vs 1h EMA50 %'] = (cl.at(-1) / K.ema(cl.slice(-150), 50) - 1) * 100;
      const h4 = K.agg(k.map(x => [x[0], x[1], x[2], x[3], x[4], x[5], 0]), 4, H), c4 = h4.map(x => x[4]); if (c4.length > 30) { F['coin vs 4h EMA20 %'] = (c4.at(-1) / K.ema(c4, 20) - 1) * 100; F['coin.rsi4h'] = K.rsi(c4); }
      const hi = Math.max(...k.slice(-240).map(x => x[2])), lo = Math.min(...k.slice(-240).map(x => x[3])); F['coin pos in 10d range'] = (cl.at(-1) - lo) / (hi - lo || 1);
      const v24 = k.slice(-24).reduce((a, x) => a + x[5], 0), v10 = k.slice(-240).reduce((a, x) => a + x[5], 0) / 10; F['coin vol24/avg10d'] = v10 ? v24 / v10 : null;
      let tr = 0; for (let i = n - 23; i <= n; i++) tr += (k[i][2] - k[i][3]) / k[i][4]; F['coin 1h range% avg24'] = tr / 24 * 100; } }
  // direction edge: signed move after entry
  const mv = m => { const i = Math.min(hl.length / 3 - 1, m); return (hl[3 * i + 2] / E - 1) * 100 * (L ? 1 : -1); };
  rows.push({ id: t.id, sym: t.symbol, t: t0, L, E, hl, real, reason: t.close_reason, mode: t.mode, stop0: +t.original_stop_loss, tp1: +t.tp1, tp2: +t.tp2, F,
    mv: { '1h': mv(60), '4h': mv(240), '12h': mv(720), '24h': mv(1440), '48h': mv(2879) }, n: hl.length / 3 }); }
rows.sort((a, b) => a.t - b.t);
console.log(`DZ closed trades with price path: ${rows.length} (${new Date(rows[0].t).toISOString().slice(0, 10)} → ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}), longs ${rows.filter(r => r.L).length}, shorts ${rows.filter(r => !r.L).length}`);
const sum = a => a.reduce((s, x) => s + x, 0);
console.log(`REAL result (scaled to $500 each): ${$(sum(rows.map(r => r.real)))}, ${(rows.filter(r => r.real > 0).length / rows.length * 100).toFixed(0)}% win, $${(sum(rows.map(r => r.real)) / rows.length).toFixed(2)}/trade`);

// 1) does the signal predict direction? average signed move after entry (positive = in the trade's favour)
console.log('\n1) Average move in the trade direction after entry (%):');
for (const w of ['1h', '4h', '12h', '24h', '48h']) { const v = rows.filter(r => r.n * M >= { '1h': H, '4h': 4 * H, '12h': 12 * H, '24h': 24 * H, '48h': 47 * H }[w]).map(r => r.mv[w]); const m = sum(v) / v.length, sd = Math.sqrt(sum(v.map(x => (x - m) ** 2)) / v.length);
  const ls = d => { const q = rows.filter(r => r.L === d).map(r => r.mv[w]); return (sum(q) / q.length).toFixed(2); };
  console.log(`   ${w.padEnd(4)} avg ${m >= 0 ? '+' : ''}${m.toFixed(2)}%  (±${(sd / Math.sqrt(v.length) * 1.96).toFixed(2)} 95% band, n=${v.length}) | longs ${ls(true)} shorts ${ls(false)} | ${(v.filter(x => x > 0).length / v.length * 100).toFixed(0)}% in favour`); }
// same for the BTC-relative move: is it just the market?
// 2) exit plans on the same entries
function run(r, { stop, tps = [], fr = [], beAt = null, maxMin = 2880, trail = null, fee = 0.1 }) { // stop/tps in % of entry; trail: { after: pct, give: pct }
  const hl = r.hl, E = r.E, L = r.L, n = Math.min(hl.length / 3, maxMin); let rem = 1, p = 0, hit = 0, st = -stop, peak = 0;
  for (let i = 0; i < n; i++) { const fav = L ? (hl[3 * i] / E - 1) * 100 : (1 - hl[3 * i + 1] / E) * 100, adv = L ? (hl[3 * i + 1] / E - 1) * 100 : (1 - hl[3 * i] / E) * 100;
    if (adv <= st) { p += rem * st; rem = 0; break; }
    while (hit < tps.length && fav >= tps[hit]) { const q = hit === tps.length - 1 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (beAt === 'tp1' && hit === 1) st = Math.max(st, 0); }
    if (beAt != null && beAt !== 'tp1' && fav >= beAt) st = Math.max(st, 0);
    peak = Math.max(peak, fav); if (trail && peak >= trail.after) st = Math.max(st, peak - trail.give);
    if (rem < 1e-9) break; }
  if (rem > 1e-9) { const i = n - 1; p += rem * (L ? (hl[3 * i + 2] / E - 1) : (1 - hl[3 * i + 2] / E)) * 100; }
  return p / 100 * SIZE - SIZE * fee / 100; }
const plans = {
  'REPLICA-ish: 0.8% stop, 90 min, TP 1.2R-capped (≈1.5/3%) ': r => run(r, { stop: 0.8, tps: [1.5, 3], fr: [0.33, 1], beAt: 'tp1', maxMin: 90 }),
  '0.8% stop, no time limit (48h), TP 1.5/3%': r => run(r, { stop: 0.8, tps: [1.5, 3], fr: [0.33, 1], beAt: 'tp1' }),
  'zone stop, TP 1.5R / 3R (as designed), 48h': r => { const s = Math.abs(r.E - r.stop0) / r.E * 100; return run(r, { stop: s, tps: [1.5 * s, 3 * s], fr: [0.5, 1], beAt: 'tp1' }); },
  'zone stop, TP 1.5R / 3R, 24h': r => { const s = Math.abs(r.E - r.stop0) / r.E * 100; return run(r, { stop: s, tps: [1.5 * s, 3 * s], fr: [0.5, 1], beAt: 'tp1', maxMin: 1440 }); },
  'zone stop, hold 24h (no TP)': r => { const s = Math.abs(r.E - r.stop0) / r.E * 100; return run(r, { stop: s, maxMin: 1440 }); },
  '2% stop, TP 2/4%, 24h': r => run(r, { stop: 2, tps: [2, 4], fr: [0.5, 1], beAt: 'tp1', maxMin: 1440 }),
  '3% stop, TP 3/6%, 48h': r => run(r, { stop: 3, tps: [3, 6], fr: [0.5, 1], beAt: 'tp1' }),
  '5% stop, TP 5/10%, 48h': r => run(r, { stop: 5, tps: [5, 10], fr: [0.5, 1], beAt: 'tp1' }),
  '1.5% stop, trail 1% after +1.5%, 24h': r => run(r, { stop: 1.5, trail: { after: 1.5, give: 1 }, maxMin: 1440 }),
  'no stop, exit after 4h': r => run(r, { stop: 99, maxMin: 240 }),
  'no stop, exit after 24h': r => run(r, { stop: 99, maxMin: 1440 }),
};
const mid = rows[rows.length >> 1].t, weeks = [...new Set(rows.map(r => new Date(r.t - ((new Date(r.t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(5, 10)))].sort();
const wk = r => new Date(r.t - ((new Date(r.t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(5, 10);
console.log(`\n2) Exit plans on the same ${rows.length} entries ($500, fees in). Halves split ${new Date(mid).toISOString().slice(0, 10)}. Weeks: ${weeks.join(' ')}`);
const show = (name, f) => { const v = rows.map(r => ({ r, p: f(r) })); const s = sum(v.map(x => x.p)), h1 = sum(v.filter(x => x.r.t < mid).map(x => x.p));
  console.log(name.padEnd(58), $(s).padStart(7), ('$' + (s / v.length).toFixed(2)).padStart(7), (v.filter(x => x.p > 0).length / v.length * 100).toFixed(0).padStart(3) + '% win', '| halves', $(h1).padStart(6), $(s - h1).padStart(6), '| weeks', weeks.map(w => $(sum(v.filter(x => wk(x.r) === w).map(x => x.p))).padStart(5)).join(' ')); };
show('REAL (what the paper bot actually did)', r => r.real);
for (const [k, f] of Object.entries(plans)) show(k, f);
// 3) buckets and strict filter test on the real results
console.log('\n3) Real result by setup/market (n, $/trade, halves):');
const bucket = (name, pred) => { const q = rows.filter(pred); if (q.length < 15) return; const s = sum(q.map(r => r.real)), h1 = sum(q.filter(r => r.t < mid).map(r => r.real));
  console.log('   ' + name.padEnd(44), String(q.length).padStart(4), ('$' + (s / q.length).toFixed(2)).padStart(7), '| halves', $(h1).padStart(6), $(s - h1).padStart(6)); };
bucket('longs', r => r.L); bucket('shorts', r => !r.L);
for (const [a, b] of [[0, 35], [35, 45], [45, 55], [55, 999]]) bucket(`score ${a}-${b}`, r => r.F.score >= a && r.F.score < b);
bucket('BTC 24h up', r => r.F['btc.24h'] > 0); bucket('BTC 24h down', r => r.F['btc.24h'] <= 0);
bucket('BTC 7d up', r => r.F['btc.7d'] > 0); bucket('BTC 7d down', r => r.F['btc.7d'] <= 0);
bucket('BTC above 1h EMA50', r => r.F['btc vs 1h EMA50 %'] > 0); bucket('BTC below 1h EMA50', r => r.F['btc vs 1h EMA50 %'] <= 0);
bucket('coin above 4h EMA20', r => r.F['coin vs 4h EMA20 %'] > 0); bucket('coin below 4h EMA20', r => r.F['coin vs 4h EMA20 %'] <= 0);
bucket('price IN zone', r => r.F['sig.inZone']); bucket('price near but outside zone', r => !r.F['sig.inZone']);
bucket('bounce candle confirmed', r => r.F['sig.bounce']); bucket('still falling', r => r.F['sig.stillFalling']);
const names = Object.keys(rows[0].F);
K.strict(rows.map(r => ({ t: r.t, F: r.F, pnl: r.real, sl: r.reason === 'max_loss' })), names, { label: 'DZ REAL results — filters (train = earlier half)', top: 15 });
K.strict(rows.map(r => ({ t: r.t, F: r.F, pnl: plans['zone stop, TP 1.5R / 3R (as designed), 48h'](r), sl: false })), names, { label: 'DZ with zone-stop plan — filters', top: 10 });
