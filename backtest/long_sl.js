// Stop-loss sweep for the no-spot runner LONG (run7d >= 20%), same entries as long_ns.js, $150, fees in
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const POS = 150, M = 60000, Hr = 3600000;
function sim(hl, off, E, sl, tps = [6, 12, 20, 30], beAt = 1) { const fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -sl, last = E, mae = 0; const fav = v => (v / E - 1) * 100;
  for (let i = off; i < Math.min(hl.length / 3, off + 2880); i++) { const a = fav(hl[3 * i]), b = fav(hl[3 * i + 1]); last = hl[3 * i + 2]; const adv = Math.min(a, b), fv = Math.max(a, b);
    if (hit === 0) mae = Math.min(mae, adv);
    if (adv <= stop) { p += rem * stop / 100; rem = 0; break; }
    while (hit < 4 && fv >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit] / 100; rem -= q; hit++; if (hit === beAt) stop = Math.max(stop, 0); } if (rem < 1e-9) break; }
  if (rem > 1e-9) p += rem * fav(last) / 100; return { v: p * POS - POS * 0.001, hit, mae }; }
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
const G = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp == null && r.hasSpot === false)) continue; const rr = run7(r.s, r.t); if (rr == null || rr < 20) continue;
  G.push({ t: s.now, hl, off: Math.round((s.now - r.t) / M), E: s.p }); }
G.sort((a, b) => a.t - b.t);
const $ = x => (x >= 0 ? '+' : '-') + '$' + Math.abs(x).toFixed(0);
const run = (n, f) => { const v = G.map(x => ({ t: x.t, ...f(x) })); const s = v.reduce((p, x) => p + x.v, 0); let eq = 0, pk = 0, dd = 0; for (const x of v) { eq += x.v; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const mo = m => v.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((p, x) => p + x.v, 0);
  const h = Math.floor(v.length / 2), first = v.slice(0, h).reduce((p, x) => p + x.v, 0), last = v.slice(h).reduce((p, x) => p + x.v, 0);
  const stops = v.filter(x => x.v < -1 && x.hit === 0).length;
  console.log(n.padEnd(34), `${$(s).padStart(6)} win ${(v.filter(x => x.v > 0).length / v.length * 100).toFixed(0)}% full stops ${String(stops).padStart(3)} maxDD $${dd.toFixed(0).padStart(3)} | 1st half ${$(first).padStart(5)} 2nd half ${$(last).padStart(5)} | Jun ${$(mo('06')).padStart(5)} Jul ${$(mo('07')).padStart(5)} Aug ${$(mo('08')).padStart(5)} Sep ${$(mo('09')).padStart(5)} Oct ${$(mo('10')).padStart(5)}`); return v; };
console.log(`No-spot runner LONG entries: ${G.length} (1 Jun – 12 Oct), $150 position, fees in, stop checked before targets inside a candle\n`);
for (const sl of [3, 4, 5, 6, 7, 8, 10, 12, 15, 20]) run(`stop ${sl}%`, x => sim(x.hl, x.off, x.E, sl));
run('no stop (48h close)', x => sim(x.hl, x.off, x.E, 100));
// how far do winners dip before TP1?
const base = G.map(x => sim(x.hl, x.off, x.E, 100)); const w = base.filter(x => x.hit >= 1).map(x => -x.mae).sort((a, b) => a - b);
const pc = q => w[Math.floor(q * (w.length - 1))].toFixed(1);
console.log(`\nTrades that reached TP1 (${w.length}): dip before TP1 — median ${pc(0.5)}%, 75% ${pc(0.75)}%, 90% ${pc(0.9)}%, worst ${w.at(-1).toFixed(1)}%`);
const losers = base.filter(x => x.hit === 0).map(x => -x.mae).sort((a, b) => a - b); console.log(`Never reached TP1 (${losers.length}): drop median ${losers[Math.floor(losers.length / 2)].toFixed(1)}%`);
