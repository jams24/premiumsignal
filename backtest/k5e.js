// 5m candles (with taker-buy volume) for the 48h before every live-rule ENTER, cached in data/k5_entry.json
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'); const { getJ, pool } = require('./lib');
const rows = JSON.parse(fs.readFileSync('replay_L.json')), OUT = 'k5_entry.json', M = 60000;
const pass = s => (s.oi ?? 0) <= 30 && (s.age ?? -1) >= 15 && s.c >= 1;
const first = (all, from = 0) => { for (let i = from; i < all.length; i++) { if (all[i].k === 'missed') return -1; if (pass(all[i])) return i; } return -1; };
const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const todo = rows.map(r => { let i = first(r.all); if (i === 0) i = first(r.all, 1); return i < 0 ? null : { s: r.s, key: r.s + r.t, now: r.all[i].now }; }).filter(x => x && !have[x.key]);
console.log('to fetch', todo.length, 'cached', Object.keys(have).length); let n = 0;
(async () => {
  await pool(todo, 5, async (x) => { const k = await getJ(`https://fapi.binance.com/fapi/v1/klines?symbol=${x.s}&interval=5m&endTime=${x.now - 1}&limit=600`);
    if (Array.isArray(k) && k.length) have[x.key] = k.map(c => [+c[0], +c[1], +c[2], +c[3], +c[4], +c[7], +c[10]]).filter(c => c[0] + 5 * M <= x.now);
    if (++n % 200 === 0) { console.log(n); fs.writeFileSync(OUT, JSON.stringify(have)); } });
  fs.writeFileSync(OUT, JSON.stringify(have)); console.log('saved', Object.keys(have).length);
})();
