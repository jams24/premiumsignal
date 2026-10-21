// Binance futures order-book depth (data.binance.vision bookDepth, ~30s snapshots at ±0.2/1/2/3/4/5%)
// for 2h before to 1h after every spot-coin ENTER in data/entryfeat_rows.json → data/book_entry.json
// row: [t, notional at -5,-4,-3,-2,-1,-0.2,+0.2,+1,+2,+3,+4,+5 %]  (minus = bids, plus = asks)
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bookdepth-'));
const OUT = 'book_entry.json', H = 3600000, D = 24 * H, LV = ['-5.00', '-4.00', '-3.00', '-2.00', '-1.00', '-0.20', '0.20', '1.00', '2.00', '3.00', '4.00', '5.00'];
const rows = JSON.parse(fs.readFileSync('entryfeat_rows.json'));
const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const day = t => new Date(t).toISOString().slice(0, 10);
async function file(sym, d) { // returns rows of that day or null
  for (let i = 0; i < 4; i++) { try { const r = await fetch(`https://data.binance.vision/data/futures/um/daily/bookDepth/${sym}/${sym}-bookDepth-${d}.zip`, { signal: AbortSignal.timeout(60000) });
    if (r.status === 404) return null; if (!r.ok) throw new Error(r.status);
    const z = path.join(TMP, `${sym}-${d}.zip`); fs.writeFileSync(z, Buffer.from(await r.arrayBuffer()));
    const csv = execFileSync('unzip', ['-p', z], { maxBuffer: 1 << 28 }).toString(); fs.unlinkSync(z); return csv; } catch (e) { await new Promise(s => setTimeout(s, 2000 * (i + 1))); } }
  return null; }
const todo = rows.filter(x => !(x.key in have)); let n = 0, ok = 0;
console.log('to fetch', todo.length, 'cached', Object.keys(have).length);
(async () => {
  let i = 0; await Promise.all(Array.from({ length: 8 }, async () => { while (i < todo.length) { const x = todo[i++];
    const sym = x.key.match(/^(.*?)(\d{13})$/)[1], a = x.t - 2 * H, b = x.t + H, snaps = new Map();
    for (const d of [...new Set([day(a), day(b)])]) { const csv = await file(sym, d); if (!csv) continue;
      for (const line of csv.split('\n')) { const p = line.split(','); if (p.length < 4 || p[0] === 'timestamp') continue; const t = Date.parse(p[0].replace(' ', 'T') + 'Z'); if (t < a || t > b) continue;
        const j = LV.indexOf((+p[1]).toFixed(2)); if (j < 0) continue; const k = Math.floor(t / 1000) * 1000; if (!snaps.has(k)) snaps.set(k, new Array(12).fill(null)); snaps.get(k)[j] = +(+p[3]).toPrecision(5); } }
    have[x.key] = [...snaps].filter(([, v]) => v.every(y => y != null)).sort((p, q) => p[0] - q[0]).map(([t, v]) => [t, ...v]);
    if (have[x.key].length) ok++;
    if (++n % 100 === 0) { console.log(new Date().toISOString().slice(11, 19), n, '/', todo.length, 'with data', ok); fs.writeFileSync(OUT, JSON.stringify(have)); } } }));
  fs.writeFileSync(OUT, JSON.stringify(have)); fs.rmSync(TMP, { recursive: true, force: true }); console.log('DONE', n, 'with data', ok);
})();
