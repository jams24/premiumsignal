// Strict test of the outside-data measures (spot venues, Korea, Binance OI/ratios, premium) on live shorts, runner longs, skipped groups
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'), K = require('./evalkit');
const B = JSON.parse(fs.readFileSync('base_trades.json')), E = JSON.parse(fs.readFileSync('ext_feats.json'));
const names = [...new Set(Object.values(E).flatMap(F => Object.keys(F)))];
const S = (x, k = 'short') => ({ t: x.t, F: E[x.key] || {}, pnl: x[k].pnl, sl: x[k].sl });
const ok = B.filter(x => E[x.key]);
const live = ok.filter(x => x.group === 'live').map(x => S(x));
const other = ok.filter(x => ['highshare', 'nospot_low', 'btcpause'].includes(x.group) && x.short).map(x => S(x));
K.strict(live, names, { label: 'LIVE SHORTS × outside data', other, top: 18 });
K.strict(ok.filter(x => x.group === 'runner').map(x => S(x, 'long')), names, { label: 'RUNNER LONGS × outside data', other: ok.filter(x => x.group !== 'runner').map(x => S(x, 'long')), top: 10 });
K.strict(ok.filter(x => x.group === 'highshare' && x.b7 >= -2).map(x => S(x)), names, { label: 'SPOT-HEAVY SHORTS (skipped) × outside data — rules that pick good ones', mode: 'take', top: 10 });
