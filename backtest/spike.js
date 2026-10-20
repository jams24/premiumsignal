// How often do no-spot runner coins really spike after ENTER? 1 Jun – 12 Oct backfill, long plan outcomes + max rise
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { R, firstEntry } = require('./rules');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), paths = JSON.parse(fs.readFileSync('paths_L.json')), H1 = JSON.parse(fs.readFileSync('h1L.json'));
const M = 60000, Hr = 3600000;
const idx = (k, t) => { let lo = 0, hi = k.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m][0] + Hr <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const run7 = (s, t) => { const k = H1[s]; if (!k) return null; const j = idx(k, t); return j - 167 >= 0 ? (k[j][4] / k[j - 167][1] - 1) * 100 : null; };
function sim(hl, off, E) { const tps = [6, 12, 20, 30], fr = [0.25, 0.5, 0.5, 1]; let rem = 1, hit = 0, p = 0, stop = -8, last = E, res = 'open', up = 0, dnFirst = 0;
  const n = Math.min(hl.length / 3, off + 2880);
  for (let i = off; i < n; i++) { const a = (hl[3 * i] / E - 1) * 100, b = (hl[3 * i + 1] / E - 1) * 100; last = hl[3 * i + 2];
    const hi = Math.max(a, b), lo = Math.min(a, b); if (res === 'open' || true) { }
    if (rem > 1e-9) { if (lo <= stop) { p += rem * stop; rem = 0; res = stop < 0 ? 'SL' : (hit ? 'TP' + hit + '→BE' : 'BE'); }
      else { while (hit < 4 && hi >= tps[hit]) { const q = hit === 3 ? rem : rem * fr[hit]; p += q * tps[hit]; rem -= q; hit++; if (hit === 1) stop = 0; } if (rem < 1e-9) res = 'TP4'; } }
    up = Math.max(up, hi); if (up < 6) dnFirst = Math.min(dnFirst, lo); }
  if (rem > 1e-9) { p += rem * (last / E - 1) * 100; res = hit ? 'TP' + hit + '+time' : 'time'; } return { pct: p - 0.1, res, up, dnFirst }; }
const L = [];
for (const r of rows) { const hl = paths[r.s + r.t]; if (!hl || hl.length / 3 < 48 * 60) continue; const s = firstEntry(r.all, R[0][1]); if (!s) continue;
  if (!(s.sp == null && r.hasSpot === false)) continue; const rr = run7(r.s, r.t); if (rr == null || rr < 20) continue;
  const x = sim(hl, Math.round((s.now - r.t) / M), s.p); L.push({ m: new Date(s.now).toISOString().slice(5, 7), ...x }); }
const show = (n, a) => { const c = k => a.filter(x => x.res === k || x.res.startsWith(k)).length; const pc = v => (v / a.length * 100).toFixed(0) + '%';
  const sp = q => pc(a.filter(x => x.up >= q).length);
  console.log(`${n.padEnd(6)} ${String(a.length).padStart(3)} | rose ≥6% ${sp(6)} ≥12% ${sp(12)} ≥20% ${sp(20)} ≥30% ${sp(30)} ≥50% ${sp(50)} | fell 8% before +6%: ${pc(a.filter(x => x.dnFirst <= -8).length)} | outcomes: SL ${pc(c('SL'))}, TP1→BE ${pc(a.filter(x => x.res === 'TP1→BE').length)}, TP2→BE ${pc(a.filter(x => x.res === 'TP2→BE').length)}, TP3+ ${pc(a.filter(x => /TP[34]/.test(x.res)).length)} | avg $${(a.reduce((p, x) => p + x.pct, 0) / a.length * 1.5).toFixed(2)}/trade at $150, total at $2,500 $${(a.reduce((p, x) => p + x.pct, 0) * 25).toFixed(0)}`); };
show('ALL', L); for (const m of ['06', '07', '08', '09', '10']) show(m, L.filter(x => x.m === m));
