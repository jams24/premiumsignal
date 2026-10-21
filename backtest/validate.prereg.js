// PRE-REGISTERED candidate rules (written 2026-10-20 23:00 UTC, before the Dec 2025 – May 2026 set existed).
// Found on 1 Jun – 18 Oct; run with BT_DATA=data_early to test them on unseen months. Nothing here may be tuned after seeing data_early.
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'), K = require('./evalkit');
const B = JSON.parse(fs.readFileSync('base_trades.json')), E = fs.existsSync('ext_feats.json') ? JSON.parse(fs.readFileSync('ext_feats.json')) : {};
for (const x of B) x.X = E[x.key] || null;
const all = B.filter(x => x.X).sort((a, b) => a.t - b.t);
const btcOk = x => x.b7 >= -2, noSpotAnywhere = x => x.X['spot.shareAll.1h'] < 0.01, kr = x => x.X['spot.korea.1h'];
const R = (name, set, side = 'short', note = '') => { set = set.filter(x => x[side]); const s = set.reduce((a, x) => a + x[side].pnl, 0), h = set.length >> 1;
  const h1 = set.slice(0, h).reduce((a, x) => a + x[side].pnl, 0);
  const months = [...new Set(set.map(x => new Date(x.t).toISOString().slice(0, 7)))].sort(); const mo = months.map(m => set.filter(x => new Date(x.t).toISOString().slice(0, 7) === m).reduce((a, x) => a + x[side].pnl, 0));
  console.log(name.padEnd(58), String(set.length).padStart(4), set.length ? (set.filter(x => x[side].pnl > 0).length / set.length * 100).toFixed(0).padStart(3) + '%' : '  - ', K.$(s).padStart(6), set.length ? ('$' + (s / set.length).toFixed(2)).padStart(6) : '',
    '| halves', K.$(h1).padStart(5), K.$(s - h1).padStart(5), `| months + ${mo.filter(v => v > 0).length}/${mo.length}`, note); return s; };
const span = `${new Date(all[0].t).toISOString().slice(0, 10)} → ${new Date(all.at(-1).t).toISOString().slice(0, 10)}`;
console.log(`Data: ${process.env.BT_DATA || 'data'} (${span}), ${all.length} entries with outside data. $150, fees in.\n`);
console.log('— BASELINES (what the bot does today) —');
R('B1 live short: BN/BY spot, share ≤13%, BTC 7d ≥ -2%', all.filter(x => x.group === 'live'));
R('B2 runner long: no BN/BY spot, 7d run ≥ 20%', all.filter(x => x.group === 'runner'), 'long');
R('B3 BTC pause check: live-type shorts when BTC 7d < -2%', all.filter(x => x.group === 'btcpause'), 'short', '(should be ≤ 0)');
console.log('\n— CANDIDATES (each must be > 0 and ideally both halves > 0) —');
R('C1 short no-BN/BY-spot coins with 7d run < 20%, BTC ok', all.filter(x => x.group === 'nospot_low' && btcOk(x)));
R('C1b  … and no spot on any venue', all.filter(x => x.group === 'nospot_low' && btcOk(x) && noSpotAnywhere(x)));
R('C2a runner long only when no spot on any venue', all.filter(x => x.group === 'runner' && noSpotAnywhere(x)), 'long');
R('C2b runner long when spot exists elsewhere (expect < 0)', all.filter(x => x.group === 'runner' && !noSpotAnywhere(x)), 'long');
R('C2c SHORT runner coins with spot elsewhere, BTC ok', all.filter(x => x.group === 'runner' && !noSpotAnywhere(x) && btcOk(x)));
R('C3 short spot-heavy (>13%) coins with zero Korean volume, BTC ok', all.filter(x => x.group === 'highshare' && btcOk(x) && kr(x) < 0.0001));
R('C3b spot-heavy coins WITH Korean volume (expect ≤ 0)', all.filter(x => x.group === 'highshare' && btcOk(x) && kr(x) >= 0.0001));
const lk = all.filter(x => x.group === 'live');
const a = R('C4a live shorts with Korean share ≥ 8%', lk.filter(x => kr(x) >= 8)), b = R('C4b live shorts with Korean share < 8%', lk.filter(x => kr(x) < 8));
const ret = x => x.F['w.retrace'];
R('C5 live shorts with 30–45% of the pump already given back', lk.filter(x => ret(x) >= 0.3 && ret(x) < 0.45), 'short', '(was best bucket)');
R('C6 live shorts just under the 30d high (−10..0%)', lk.filter(x => x.F['vs30dHigh%'] >= -10 && x.F['vs30dHigh%'] < 0), 'short', '(was weakest bucket)');
R('C7 live shorts with Binance taker ratio (5m) > 1.09', lk.filter(x => x.X['bn.taker5m'] > 1.09), 'short', '(weak link: expect worse)');
console.log('\n— COMBINED PLAN if candidates hold: B1 + C1b + C2a + C2c + C3 —');
R('PLAN shorts (B1 + C1b + C2c + C3)', [...lk, ...all.filter(x => x.group === 'nospot_low' && btcOk(x) && noSpotAnywhere(x)), ...all.filter(x => x.group === 'runner' && !noSpotAnywhere(x) && btcOk(x)), ...all.filter(x => x.group === 'highshare' && btcOk(x) && kr(x) < 0.0001)].sort((p, q) => p.t - q.t));
R('PLAN longs (C2a)', all.filter(x => x.group === 'runner' && noSpotAnywhere(x)), 'long');
