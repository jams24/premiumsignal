// Month/half breakdown of each group, and spot-share bands
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const K = require('./evalkit'); const B = JSON.parse(require('fs').readFileSync('base_trades.json'));
const line = (name, set, k = 'short') => { set = set.filter(x => x[k]).sort((a, b) => a.t - b.t); if (!set.length) return; const h = set.length >> 1, s = set.reduce((a, x) => a + x[k].pnl, 0);
  const mo = ['06', '07', '08', '09', '10'].map(m => K.$(set.filter(x => new Date(x.t).toISOString().slice(5, 7) === m).reduce((a, x) => a + x[k].pnl, 0)).padStart(5)).join(' ');
  let eq = 0, pk = 0, dd = 0; for (const x of set) { eq += x[k].pnl; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  console.log(name.padEnd(40), String(set.length).padStart(4), (set.filter(x => x[k].pnl > 0).length / set.length * 100).toFixed(0).padStart(3) + '%', K.$(s).padStart(6), ('$' + (s / set.length).toFixed(2)).padStart(6),
    '| halves', K.$(set.slice(0, h).reduce((a, x) => a + x[k].pnl, 0)).padStart(5), K.$(set.slice(h).reduce((a, x) => a + x[k].pnl, 0)).padStart(5), '| Jun-Oct', mo, '| DD', K.$(-dd)); };
console.log('group (short unless noted)'.padEnd(40), '   n  win  total  $/tr');
line('live', B.filter(x => x.group === 'live'));
line('runner (LONG)', B.filter(x => x.group === 'runner'), 'long');
line('nospot_low short', B.filter(x => x.group === 'nospot_low'));
line('nospot_low short, BTC 7d >= -2', B.filter(x => x.group === 'nospot_low' && x.b7 >= -2));
for (const [a, b] of [[-1e9, 0], [0, 10], [10, 20]]) line(`nospot_low short, 7d run ${a < -1e8 ? '<0' : a + '..' + b}%`, B.filter(x => x.group === 'nospot_low' && x.run7d >= a && x.run7d < b));
for (const [a, b] of [[13, 16], [16, 20], [20, 30], [30, 50], [50, 1e9]]) line(`spot share ${a}-${b > 1e8 ? 'max' : b}% short`, B.filter(x => x.group === 'highshare' && x.sp > a && x.sp <= b));
for (const [a, b] of [[0, 3], [3, 6], [6, 9], [9, 13]]) line(`live, spot share ${a}-${b}%`, B.filter(x => x.group === 'live' && x.sp > a - 1e-9 && x.sp <= b));
line('btcpause short', B.filter(x => x.group === 'btcpause'));
