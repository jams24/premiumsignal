// Evaluate replayed demand-zone signals: direction edge, exit plans, market-regime split. Both periods side by side.
const fs = require('fs'), path = require('path'), K = require('./evalkit');
const H = 3600000, SIZE = 500;
const load = d => { const f = path.join(__dirname, d, 'dz_replay.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : null; };
const sets = { 'Jun–Oct 2026': load('data'), 'Dec–May (unseen)': (load('data_early') || []).filter(x => x.T < Date.parse('2026-06-01')) }; // data_early 1h candles run past May for a few coins
const btcOf = d => JSON.parse(fs.readFileSync(path.join(__dirname, d, 'h1L.json'))).BTCUSDT;
const BTC = { 'Jun–Oct 2026': btcOf('data'), 'Dec–May (unseen)': fs.existsSync(path.join(__dirname, 'data_early', 'h1L.json')) ? btcOf('data_early') : null };
function run(x, { stop, tps = [], fr = [], be = false, maxH = 48, trail = null, fee = 0.1 }) { const L = x.dir === 'long', E = x.E, p0 = x.path; let rem = 1, p = 0, hit = 0, st = -stop, peak = 0; const n = Math.min(p0.length, maxH);
  for (let i = 0; i < n; i++) { const [h, l, c] = p0[i]; const fav = L ? (h / E - 1) * 100 : (1 - l / E) * 100, adv = L ? (l / E - 1) * 100 : (1 - h / E) * 100;
    if (adv <= st) { p += rem * st; rem = 0; break; }
    while (hit < tps.length && fav >= tps[hit]) { const q = hit === tps.length - 1 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (be && hit === 1) st = Math.max(st, 0); }
    peak = Math.max(peak, fav); if (trail && peak >= trail.after) st = Math.max(st, peak - trail.give); if (rem < 1e-9) break; }
  if (rem > 1e-9) { const c = p0[n - 1][2]; p += rem * (L ? c / E - 1 : 1 - c / E) * 100; } return p / 100 * SIZE - SIZE * fee / 100; }
const plans = {
  'as designed: zone stop, TP 1.5R (50%) → BE → 3R, 48h': x => run(x, { stop: x.slDist, tps: [1.5 * x.slDist, 3 * x.slDist], fr: [0.5, 1], be: true }),
  'current-ish: 0.8% stop, TP 1.5/3%, 2h': x => run(x, { stop: 0.8, tps: [1.5, 3], fr: [0.33, 1], be: true, maxH: 2 }),
  'zone stop, hold 24h': x => run(x, { stop: x.slDist, maxH: 24 }),
  '1.5% stop, trail 1% after +1.5%, 24h': x => run(x, { stop: 1.5, trail: { after: 1.5, give: 1 }, maxH: 24 }),
  '3% stop, TP 3/6%, 48h': x => run(x, { stop: 3, tps: [3, 6], fr: [0.5, 1], be: true }),
  'no stop, exit after 24h': x => run(x, { stop: 99, maxH: 24 }),
};
for (const [name, S] of Object.entries(sets)) { if (!S) { console.log(`\n${name}: not built yet`); continue; }
  const btc = BTC[name]; for (const x of S) { const j = K.idx(btc, x.T); x.b7 = K.chg(btc, j, 168); x.b24 = K.chg(btc, j, 24); const cl = btc.slice(Math.max(0, j - 200), j + 1).map(y => y[4]); x.bEma = (cl.at(-1) / K.ema(cl, 50) - 1) * 100; }
  const months = [...new Set(S.map(x => new Date(x.T).toISOString().slice(0, 7)))].sort();
  console.log(`\n================ ${name}: ${S.length} signals (${S.filter(x => x.dir === 'long').length} long) ================`);
  for (const dir of ['long', 'short']) { const A = S.filter(x => x.dir === dir).sort((a, b) => a.T - b.T); if (!A.length) continue; const mid = A[A.length >> 1].T;
    const fwd = h => { const v = A.filter(x => x.path.length >= h).map(x => (x.path[h - 1][2] / x.E - 1) * 100 * (dir === 'long' ? 1 : -1)); const m = v.reduce((a, b) => a + b, 0) / v.length; return `${m >= 0 ? '+' : ''}${m.toFixed(2)}%`; };
    console.log(`\n${dir.toUpperCase()}S (${A.length}) — avg move in trade direction: 4h ${fwd(4)}, 24h ${fwd(24)}, 48h ${fwd(48)}`);
    const row = (label, f, set = A) => { const v = set.map(x => [x, f(x)]), s = v.reduce((a, [, p]) => a + p, 0), h1 = v.filter(([x]) => x.T < mid).reduce((a, [, p]) => a + p, 0);
      console.log('  ' + label.padEnd(54), String(set.length).padStart(5), K.$(s).padStart(8), ('$' + (s / set.length).toFixed(2)).padStart(7), '| halves', K.$(h1).padStart(7), K.$(s - h1).padStart(7), '| months', months.map(m => K.$(v.filter(([x]) => new Date(x.T).toISOString().slice(0, 7) === m).reduce((a, [, p]) => a + p, 0)).padStart(6)).join(' ')); };
    for (const [k, f] of Object.entries(plans)) row(k, f);
    const f0 = plans['as designed: zone stop, TP 1.5R (50%) → BE → 3R, 48h'];
    console.log('  — market regime (as-designed plan) —');
    row('BTC 7d up', f0, A.filter(x => x.b7 > 0)); row('BTC 7d down', f0, A.filter(x => x.b7 <= 0));
    row('BTC above 1h EMA50', f0, A.filter(x => x.bEma > 0)); row('BTC below 1h EMA50', f0, A.filter(x => x.bEma <= 0));
    row('score ≥ 45', f0, A.filter(x => x.score >= 45)); row('in zone + bounce candle', f0, A.filter(x => x.inZone && x.bounce)); } }
