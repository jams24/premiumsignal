'use strict';
/* Big trades of past days for the desk's bubbles (Indicators → Big trades).
   The exchanges' live APIs hand out only the last few thousand trades (minutes on a busy coin), so older candles had no
   bubbles. Both exchanges publish each day's full trade list the next day:
   - Binance: data.binance.vision …/futures/um/daily/aggTrades/SYM/SYM-aggTrades-YYYY-MM-DD.zip (one CSV in a zip; out by
     ~08:00 UTC): agg_trade_id, price, quantity, first_trade_id, last_trade_id, transact_time, is_buyer_maker
   - Bybit: public.bybit.com/trading/SYM/SYMYYYY-MM-DD.csv.gz: timestamp (s), symbol, side (taker), size, price, …
   One day of one coin is streamed through (never held whole: a busy day is 50–100 MB of CSV), fills with the same
   millisecond and taker side are joined into one order (as the desk does live), and only the big ones are kept:
   - auto = the (AUTO_K + 1)th biggest order of the day (about 40 an hour, the desk's Auto size)
   - kept = every order of at least min(auto, $50k), the smallest fixed size the desk offers, capped at MAX_KEEP biggest
   The result is small (a few thousand orders), cached in memory and on disk (past days never change), one day processed at
   a time so the bot's own work isn't starved. A day not cached yet is a 3–25 MB download, so new days are limited per IP
   and for the whole site each hour (cached days are not). Today has no file yet: the desk uses the live trades for today. */
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform, pipeline } = require('stream');

const DAY = 864e5, AUTO_K = 960, FIXED_MIN = 50000, MAX_KEEP = 60000, MAX_BYTES = 600 * 1024 * 1024, JOB_MS = 150e3;
const UA = 'Mozilla/5.0';
const DIR = path.join(os.tmpdir(), 'rd-bigtrades');
const MEM = new Map(), MEM_MAX = 200;   // key → { gz: Buffer, at }
const FLIGHT = new Map();   // key → Promise (one fetch per day even when several viewers ask)
const MISS = new Map();   // key → time a file was not there (retried after 30 min: yesterday's appears in the morning)
let chain = Promise.resolve(), waiting = 0, writes = 0;
const NEW_PER_IP = 40, NEW_ALL = 400, DISK_MAX = 4000;   // new days an hour per IP · for the whole site · files kept on disk
const NEWS = new Map();   // IP → times it started a new day (last hour); '*' = everyone

function newOk(ip) {   // may this IP start one more download now? (counts it when yes)
  const now = Date.now(), recent = k => (NEWS.get(k) || []).filter(t => now - t < 3600e3);
  const mine = recent(ip), all = recent('*');
  if (mine.length >= NEW_PER_IP || all.length >= NEW_ALL) return false;
  mine.push(now); all.push(now); NEWS.set(ip, mine); NEWS.set('*', all);
  if (NEWS.size > 5000) for (const [k, v] of NEWS) if (!v.length || now - v[v.length - 1] > 3600e3) NEWS.delete(k);
  return true;
}
function diskTrim() {   // keep the newest DISK_MAX files (checked every 50 writes)
  if (++writes % 50) return;
  try {
    const f = fs.readdirSync(DIR).map(n => { try { return [n, fs.statSync(path.join(DIR, n)).mtimeMs]; } catch (e) { return null; } }).filter(Boolean);
    if (f.length <= DISK_MAX) return;
    f.sort((a, b) => a[1] - b[1]);
    for (const [n] of f.slice(0, f.length - DISK_MAX + 500)) { try { fs.unlinkSync(path.join(DIR, n)); } catch (e) { /* gone */ } }
  } catch (e) { /* no cache dir yet */ }
}

function srcUrl(ex, sym, day) {
  return ex === 'bybit' ? `https://public.bybit.com/trading/${sym}/${sym}${day}.csv.gz`
    : `https://data.binance.vision/data/futures/um/daily/aggTrades/${sym}/${sym}-aggTrades-${day}.zip`;
}

// a min-heap of the K + 1 biggest sizes: its top is the auto size once full
function topK(k) {
  const h = [];
  return {
    add(v) {
      if (h.length > k) { if (v <= h[0]) return; h[0] = v; down(0); return; }
      h.push(v); let i = h.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (h[p] <= h[i]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
    },
    min() { return h.length > k ? h[0] : 0; },
    auto() { return h.length ? h[0] : 0; },
  };
  function down(i) { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l] < h[m]) m = l; if (r < h.length && h[r] < h[m]) m = r; if (m === i) return; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
}

// fills (time order) → orders; keeps the ones that can still matter (≥ min(running auto, $50k))
function collector() {
  const top = topK(AUTO_K), keep = []; let pend = null, n = 0;
  function flush() {
    if (!pend) return; const o = pend; pend = null; n++;
    top.add(o.v);
    if (o.v >= Math.min(top.min(), FIXED_MIN)) keep.push(o);
  }
  return {
    fill(t, p, q, s) { if (pend && pend.t === t && pend.s === s) { pend.q += q; pend.v += p * q; return; } flush(); pend = { t, s, q, v: p * q }; },
    done() {
      flush();
      const auto = top.auto(), floor = Math.min(auto, FIXED_MIN);
      let out = keep.filter(o => o.v >= floor);
      if (out.length > MAX_KEEP) { out.sort((a, b) => b.v - a.v); out = out.slice(0, MAX_KEEP).sort((a, b) => a.t - b.t); }
      return { auto, floor, orders: n, list: out };
    },
  };
}

// lines of a text stream → fn(line); resolves at the end
function eachLine(stream, fn) {
  return new Promise((resolve, reject) => {
    let rest = '';
    stream.setEncoding('latin1');
    stream.on('data', c => { const s = rest + c, parts = s.split('\n'); rest = parts.pop(); for (const l of parts) fn(l); });
    stream.on('end', () => { if (rest) fn(rest); resolve(); });
    stream.on('error', reject);
  });
}

// the download, streamed through a size cap; resolves to that stream (404 / 403 → null). Nothing may read the response
// before the parser is attached: a 'data' listener here would start the flow and drop the first chunks (the zip header).
// Errors (network drop, too big, abort) reach the returned stream through pipeline, and from there the parser.
function open(url, signal) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 60000, signal }, res => {
      if (res.statusCode === 404 || res.statusCode === 403) { res.resume(); resolve(null); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`source answered ${res.statusCode}`)); return; }
      let got = 0;
      const cap = new Transform({ transform(c, enc, cb) { got += c.length; cb(got > MAX_BYTES ? new Error('file too big') : null, c); } });
      pipeline(res, cap, () => {});
      resolve(cap);
    });
    req.on('timeout', () => req.destroy(new Error('the source did not answer in time')));
    req.on('error', reject);
  });
}

// Binance's zip: one entry, deflated. Read the local header off the front of the stream, then inflate the entry's bytes.
function unzipOne(res) {
  const out = zlib.createInflateRaw();
  let head = Buffer.alloc(0), left = null, started = false;
  res.on('data', c => {
    if (!started) {
      head = Buffer.concat([head, c]);
      if (head.length < 30) return;
      if (head.readUInt32LE(0) !== 0x04034b50) { out.destroy(new Error('not a zip')); res.destroy(); return; }
      const flags = head.readUInt16LE(6), method = head.readUInt16LE(8), size = head.readUInt32LE(18), nl = head.readUInt16LE(26), xl = head.readUInt16LE(28);
      if (method !== 8) { out.destroy(new Error('zip method ' + method)); res.destroy(); return; }
      if (head.length < 30 + nl + xl) return;
      started = true; left = flags & 8 ? Infinity : size;   // bit 3: size comes after the data (inflate stops at its own end)
      c = head.subarray(30 + nl + xl);
    }
    if (left <= 0 || !c.length) return;
    const part = left === Infinity ? c : c.subarray(0, Math.min(c.length, left));
    if (left !== Infinity) left -= part.length;
    if (!out.write(part)) { res.pause(); out.once('drain', () => res.resume()); }
    if (left === 0) out.end();
  });
  res.on('end', () => { if (!out.writableEnded) out.end(); });
  res.on('error', e => out.destroy(e));
  return out;
}

async function build(ex, sym, day, signal) {
  const body = await open(srcUrl(ex, sym, day), signal);
  return body ? parse(ex, sym, day, body) : null;
}
// one day file (a readable stream of the zip / gz) → the big orders
async function parse(ex, sym, day, res) {
  const C = collector(), t0 = Date.parse(day + 'T00:00:00Z');
  if (ex === 'bybit') {
    const gz = zlib.createGunzip(); pipeline(res, gz, () => {});   // a source error destroys gz, which ends eachLine
    await eachLine(gz, l => {
      const f = l.split(','); if (f.length < 5) return;
      const ts = +f[0], q = +f[3], p = +f[4]; if (!(ts > 0) || !(q > 0) || !(p > 0)) return;   // header / odd line
      C.fill(Math.round(ts * 1000), p, q, f[2] === 'Buy' ? 1 : -1);
    });
  } else {
    await eachLine(unzipOne(res), l => {
      const f = l.split(','); if (f.length < 7) return;
      const p = +f[1], q = +f[2], t = +f[5]; if (!(t > 0) || !(q > 0) || !(p > 0)) return;
      C.fill(t, p, q, f[6].charCodeAt(0) === 116 /* 't' = buyer was the maker: a market sell */ ? -1 : 1);
    });
  }
  const r = C.done();
  // compact: [ms into the day, average price, $ size, side] (qty = size / price)
  return { ex, sym, day, t0, auto: Math.round(r.auto), floor: Math.round(r.floor), orders: r.orders,
    list: r.list.map(o => [o.t - t0, +(o.v / o.q).toPrecision(8), Math.round(o.v), o.s]) };
}

const keyOf = (ex, sym, day) => `${ex}-${sym}-${day}`;
function memPut(k, v) { MEM.delete(k); MEM.set(k, v); while (MEM.size > MEM_MAX) MEM.delete(MEM.keys().next().value); }

// gzipped JSON of one coin-day: { gz } or { missing: true }
async function dayGz(ex, sym, day, ip = '?') {
  const k = keyOf(ex, sym, day);
  if (MEM.has(k)) { const v = MEM.get(k); memPut(k, v); return v; }
  const miss = MISS.get(k); if (miss && Date.now() - miss < 30 * 60e3) return { missing: true };
  const file = path.join(DIR, k + '.json.gz');
  try { const gz = fs.readFileSync(file); const v = { gz }; memPut(k, v); return v; } catch (e) { /* not cached yet */ }
  if (FLIGHT.has(k)) return FLIGHT.get(k);
  if (waiting >= 12) { const e = new Error('busy'); e.busy = true; throw e; }
  if (!newOk(ip)) { const e = new Error('limit'); e.limit = true; throw e; }
  waiting++;
  const job = chain.then(async () => {
    const ac = new AbortController(); let kill;
    try {   // a deadline, so one slow download can't hold up every later day (they run one at a time)
      const r = await Promise.race([build(ex, sym, day, ac.signal),
        new Promise((_, no) => { kill = setTimeout(() => { ac.abort(); no(new Error('the trade file took too long')); }, JOB_MS); })]);
      if (!r) { MISS.set(k, Date.now()); return { missing: true }; }
      const gz = zlib.gzipSync(JSON.stringify(r));
      try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, gz); diskTrim(); } catch (e) { /* memory cache still works */ }
      const v = { gz }; memPut(k, v); return v;
    } finally { clearTimeout(kill); waiting--; FLIGHT.delete(k); }
  });
  chain = job.catch(() => {});
  FLIGHT.set(k, job);
  return job;
}

// GET /api/site/bigtrades?ex=binance|bybit&sym=XXXUSDT&day=YYYY-MM-DD
async function route(req, res, url, json, ip) {
  const ex = url.searchParams.get('ex') === 'bybit' ? 'bybit' : 'binance';
  const sym = String(url.searchParams.get('sym') || '').toUpperCase(), day = String(url.searchParams.get('day') || '');
  if (!/^[A-Z0-9]{2,24}USDT$/.test(sym) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { json(res, 400, { error: 'bad', message: 'sym and day (YYYY-MM-DD) needed' }); return; }
  const t = Date.parse(day + 'T00:00:00Z');
  if (!isFinite(t) || t < Date.parse('2019-09-01T00:00:00Z')) { json(res, 400, { error: 'bad', message: 'no trade files that far back' }); return; }
  if (t >= Math.floor(Date.now() / DAY) * DAY) { json(res, 200, { ex, sym, day, missing: true, today: true }); return; }
  let v;
  try { v = await dayGz(ex, sym, day, ip); } catch (e) {
    if (e.busy) { json(res, 503, { error: 'busy', message: 'Busy fetching other days. Try again in a minute.' }); return; }
    if (e.limit) { json(res, 429, { error: 'limit', message: 'Enough new days loaded for this hour. Days already loaded still show.' }); return; }
    json(res, 502, { error: 'source', message: e.message }); return;
  }
  if (v.missing) { json(res, 200, { ex, sym, day, missing: true }); return; }
  const gzOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400', ...(gzOk ? { 'Content-Encoding': 'gzip' } : {}), 'X-Content-Type-Options': 'nosniff' });
  res.end(gzOk ? v.gz : zlib.gunzipSync(v.gz));
}

module.exports = { route, build, parse, dayGz, newOk };
