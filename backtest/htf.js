// Strict test of every entry-time measure in base_trades.json on: live shorts, runner longs, and the skipped no-spot shorts
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const K = require('./evalkit'); const B = JSON.parse(require('fs').readFileSync('base_trades.json'));
const S = (x, k = 'short') => ({ t: x.t, F: x.F, pnl: x[k].pnl, sl: x[k].sl, key: x.key });
const live = B.filter(x => x.group === 'live').map(x => S(x)), otherShort = B.filter(x => ['highshare', 'nospot_low', 'btcpause'].includes(x.group) && x.short).map(x => S(x));
const runner = B.filter(x => x.group === 'runner').map(x => S(x, 'long')), otherLong = B.filter(x => x.group !== 'runner').map(x => S(x, 'long'));
const nsl = B.filter(x => x.group === 'nospot_low' && x.short && x.b7 >= -2).map(x => S(x));
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const names = [...new Set(B.flatMap(x => Object.keys(x.F)))].filter(f => !only || only.test(f));
console.log('measures:', names.length);
K.strict(live, names, { label: 'LIVE SHORTS', other: otherShort, top: 20 });
K.strict(runner, names, { label: 'RUNNER LONGS', other: otherLong, top: 12 });
K.strict(nsl, names, { label: 'NO-SPOT <20% SHORTS (skipped today)', mode: 'skip', top: 10 });
