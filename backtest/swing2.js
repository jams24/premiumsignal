// Swing replay, step 2: 5m Binance futures candles from 3h before to 72h after every replayed signal (merged per coin).
// Already-downloaded ranges are kept, so re-running only fetches what's missing.
// usage: node backtest/swing2.js → backtest/data_swing/m5.json  { SYM: [[t,o,h,l,c], ...] }
const fs = require('fs'), path = require('path');
const { getJ, pool } = require('./lib');
const H = 3600000, M5 = 300000, OUT = path.join(__dirname, 'data_swing');
const sig = JSON.parse(fs.readFileSync(path.join(OUT, 'signals.json')));
const file = path.join(OUT, 'm5.json');
const have = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
const by = {}; for (const s of sig) (by[s.sym] = by[s.sym] || []).push(s.T);
const jobs = [];
for (const [sym, ts] of Object.entries(by)) {
  ts.sort((a, b) => a - b); const r = []; let a = null, b = null;
  for (const t of ts) { if (a !== null && t - 3 * H <= b) b = Math.max(b, t + 72 * H); else { if (a !== null) r.push([a, b]); a = t - 3 * H; b = t + 72 * H; } }
  r.push([a, b]);
  const got = new Set((have[sym] || []).map(x => x[0]));
  for (const [x, y] of r) for (let t = x; t < y; t += 1500 * M5) if (!got.has(t) || !got.has(Math.min(y, t + 1499 * M5) - M5)) jobs.push([sym, t, Math.min(y, t + 1500 * M5)]);
}
console.log('requests', jobs.length);
let done = 0;
(async () => {
  await pool(jobs, 6, async ([sym, a, b]) => {
    const j = await getJ(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=5m&startTime=${a}&endTime=${b - 1}&limit=1500`);
    if (Array.isArray(j)) { const arr = have[sym] || (have[sym] = []); for (const k of j) arr.push([k[0], +k[1], +k[2], +k[3], +k[4]]); }
    if (++done % 100 === 0) console.log(done, '/', jobs.length);
  });
  for (const s of Object.keys(have)) { const m = new Map(have[s].map(x => [x[0], x])); have[s] = [...m.values()].sort((a, b) => a[0] - b[0]); }
  fs.writeFileSync(file, JSON.stringify(have));
  console.log('saved', Object.keys(have).length, 'coins', Object.values(have).reduce((a, x) => a + x.length, 0), 'candles');
})();
