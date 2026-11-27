/* ReplayDesk · RD ▲ buy / ▼ sell (Indicators → "RD ▲ / ▼ signal"): our own version of the "proprietary buy" in Craig
   Percoco's live-trading video, built from the rules he shows on screen:
   1. POI: price reaches a 15-minute fair value gap (candle 1's high below candle 3's low, gap ≥ 0.10% of price). A gap is
      usable for 48 h or until a 15m candle closes through it, and only its first touch counts.
   2. Inflection level: the last 1-minute lower high for a ▲ (higher low for a ▼), a swing with 2 candles on each side.
   3. Within 60 minutes of the touch a 1-minute candle closes past that level (the 1m CHoCH), and the move leaves a 1-minute
      fair value gap (its 3rd candle from 4 before the break to 1 after).
   4. ▲ / ▼ at that close. Plan: a limit order in the middle of the 1m gap (30 minutes to fill), stop just past the move's low /
      high (0.05% beyond), target 3R, out after 6 h. Only stops of 0.15–2% of the price. London 07–11 and New York 13–17 UTC
      unless "All hours" is ticked. One plan at a time: a new ▲ / ▼ while one is waiting or running is not taken.
   These are exactly the rules we backtested (22 Nov 2026), so the numbers in TESTED apply to what this draws.
   While price is inside a touched 15m gap, the gap and the inflection level are drawn: a 1-minute close past the line is the ▲ / ▼.
   Data: the last 4 days of 1-minute candles from the exchange, in this browser, whatever the chart's timeframe. Closed candles up
   to the clock only, so in a replay a signal shows once its candle has closed and its result once price got there. */
(function () {
  'use strict';
  const RD = window.__rd, E = window.RDE;
  if (!RD || !E) return;
  const { U, R } = RD, u = RD.util, X = RD.ext, { MIN, HOUR, DAY } = u;
  const DAYS = 4, AHEAD = 6 * HOUR, M15 = 15 * MIN;
  const TF_OK = { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '1H': 1 };
  const TESTED = 'Practice, not a signal. These exact rules on BTC, ETH and SOL (1-minute candles, Dec 2024 – Nov 2026, 3,136 trades in the London and New York opens) made about 0R before fees and −0.18R a trade after fees, the same as entering at a random time with the same stop and target. None of 8 extra filters helped (a sweep first, a big break candle, taker buying, the 15m or 4H trend, strength against BTC, New York only, fresh gaps only).';
  const hm = t => new Date(t).toISOString().slice(11, 16);
  const sessOf = E.sessOf;

  // make(HO): the signal for one chart. HO = { sym(), ex(), tf(), on() (its tick), all() (All hours), loud (toast + replay pause:
  // the main chart only), t2x(t), p2y(p), bars(), box, chart, req(), marks(), legend(), fp(v) }
  function make(HO) {
    const M = { key: '', from: 0, to: 0, all: [], n: -1, end: 0, busy: false, again: false, err: '', gen: 0, out: null, seen: null };
    const endNow = () => Math.floor((R.on ? R.clock : Date.now()) / MIN) * MIN;
    const keyNow = () => [HO.sym(), HO.ex(), R.on ? 'r' : 'l'].join('|');   // the chart's timeframe does not change the signal
    const closedCount = end => { let lo = 0, hi = M.all.length; while (lo < hi) { const m = (lo + hi) >> 1; if (M.all[m][0] + MIN <= end) lo = m + 1; else hi = m; } return lo; };
    const tfOk = () => !!TF_OK[HO.tf()];
    const want = () => (HO.want ? HO.want() : HO.on());   // read for its tick, or for Trade marks (deskwins.js; no drawing or toasts for that)
    function reset() { M.gen++; M.key = ''; M.all = []; M.n = -1; M.err = ''; M.out = null; M.seen = null; M.from = M.to = 0; }

    // ---------------------------------------------------------------- the rules, on 1-minute candles K[0..n-1]
    const scan = (K, n) => E.scan(K, n);
    // the plan's result, walking the closed 1-minute candles after the signal (src/web/rdEngine.js)
    const result = g => E.result(M.all, closedCount(endNow()), g);
    // the signals taken: in the sessions (unless All hours), one plan at a time (as tested)
    function taken() {
      if (!M.out) return [];
      const out = [];
      let busy = -Infinity;
      for (const g of M.out.sigs) {
        if (!HO.all() && !g.sess) continue;
        if (g.t <= busy) continue;
        const r = result(g); g.r = r;
        busy = r.kind === 'wait' || r.kind === 'open' ? Infinity : r.t;
        out.push(g);
      }
      return out;
    }

    // ---------------------------------------------------------------- data
    async function load() {
      if (!want()) { if (M.out || M.key) { reset(); HO.req(); HO.marks(); HO.legend(); } return; }
      if (M.busy) { M.again = true; return; }
      const key = keyNow(), end = endNow(), sym = HO.sym(), ex = HO.ex();
      const fresh = key !== M.key || end < M.from + DAY || end > M.to + DAY || M.all.length > (DAYS + 3) * 1440;
      if (!fresh && end <= M.to) { analyze(); return; }
      M.busy = true; const g = fresh ? ++M.gen : M.gen;
      try {
        if (fresh) {
          M.key = key; M.out = null; M.all = []; M.err = ''; M.seen = null; M.n = -1; HO.req(); HO.legend();
          const from = Math.floor((end - DAYS * DAY) / M15) * M15, to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
          const ks = await u.fetchRange(sym, '1m', from, to, ex);
          if (g !== M.gen || key !== keyNow()) return;
          if (!ks.length) throw new Error('no 1-minute candles');
          M.from = from; M.to = to; M.all = ks.filter(k => k[0] >= from && k[0] < to);
        } else {
          const to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
          if (to > M.to) {
            const ks = await u.fetchRange(sym, '1m', M.to, to, ex);
            if (g !== M.gen || key !== M.key) return;
            const last = M.all.length ? M.all[M.all.length - 1][0] : -1;
            for (const k of ks) if (k[0] > last && k[0] < to) M.all.push(k);
            M.to = to;
          }
        }
        analyze();
      } catch (e) { if (g === M.gen) { M.err = e.message || String(e); HO.legend(); } }
      finally { M.busy = false; if (M.again) { M.again = false; setTimeout(load, 30); } }
    }
    function analyze() {
      if (M.key !== keyNow()) return;
      const end = endNow(), n = closedCount(end);
      if (n === M.n && end === M.end && M.out) return;
      M.n = n; M.end = end;
      if (n < 120) { M.out = null; HO.req(); HO.marks(); HO.legend(); return; }
      M.out = scan(M.all, n);
      const L = taken(), l = L[L.length - 1], conf = l ? l.conf : 0;
      if (M.seen == null) M.seen = conf;   // the first read: no toast for signals already on the chart
      else if (conf > M.seen) {
        M.seen = conf;
        if (HO.loud && HO.on() && R.on && R.playing && U.poiPause !== false) RD.pause();
        if (HO.loud && HO.on()) RD.toast(`${l.dir === 1 ? '▲ RD buy' : '▼ RD sell'} on ${u.coin(HO.sym())} at ${hm(l.t)} UTC · limit ${HO.fp(l.entry)}, stop ${HO.fp(l.stop)}, target ${HO.fp(l.target)} (3R). Practice: tested ≈ random.`, l.dir === 1 ? 'up' : 'down');
      }
      HO.req(); HO.marks(); HO.legend();
    }

    // ---------------------------------------------------------------- on the chart
    const on = () => !!HO.on() && tfOk() && !!M.out && M.key === keyNow();
    const shown = () => (on() ? taken().slice(-8) : []);
    const marks = () => shown().map(g => ({ t: g.t, position: g.dir === 1 ? 'belowBar' : 'aboveBar', color: g.dir === 1 ? RD.COL.up : RD.COL.down, shape: g.dir === 1 ? 'arrowUp' : 'arrowDown', text: g.dir === 1 ? 'RD ▲' : 'RD ▼' }));
    const xL = t => { const x = HO.t2x(t); return x != null ? x : HO.bars().length && t < HO.bars()[0][0] ? 0 : null; };
    const watching = () => (on() ? M.out.live.filter(w => HO.all() || sessOf(endNow() - MIN)) : []);
    function draw(g, W, z) {
      if (!on()) return;
      const COL = RD.COL, red = COL.down, green = COL.up, gold = '#f5b301', blue = '#60a5fa';
      const ok = (...v) => v.every(q => q != null && isFinite(q));
      const xs = t => { const x = HO.t2x(t); return x == null ? null : Math.max(-40, Math.min(W + 40, x)); };
      const list = shown(), live = watching();
      const boxes = list.map(s => {
        const r = s.r, done = r.kind !== 'wait' && r.kind !== 'open', x0 = done ? xs(s.t) : xL(s.t), x1 = done ? xs(r.t) : W;
        return { s, r, done, x0, x1: x0 == null ? null : Math.min(W, Math.max(x0 + 24, x1 == null ? W : x1)), ye: HO.p2y(s.entry), ys: HO.p2y(s.stop), yt: HO.p2y(s.target) };
      });
      if (z === 'bottom') {
        for (const w of live) {   // the 15m gap price is in
          const x0 = xL(w.z.t1), y0 = HO.p2y(w.z.top), y1 = HO.p2y(w.z.bot);
          if (!ok(x0, y0, y1) || x0 > W) continue;
          g.fillStyle = u.hexA(gold, 0.13); g.fillRect(x0, Math.min(y0, y1), W - x0, Math.max(2, Math.abs(y1 - y0)));
        }
        for (const b of boxes) {
          if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W || b.r.kind === 'nofill') continue;
          g.fillStyle = u.hexA(red, b.done ? 0.08 : 0.24); g.fillRect(b.x0, Math.min(b.ye, b.ys), b.x1 - b.x0, Math.abs(b.ys - b.ye));
          g.fillStyle = u.hexA(green, b.done ? 0.07 : 0.22); g.fillRect(b.x0, Math.min(b.ye, b.yt), b.x1 - b.x0, Math.abs(b.yt - b.ye));
        }
        return;
      }
      const line = (x0, x1, y, c, dash, w) => { if (!ok(x0, x1, y)) return; g.strokeStyle = c; g.lineWidth = w || 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); };
      const placed = [];
      g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
      const H = HO.box.clientHeight - HO.chart.timeScale().height(), inY = y => Math.max(11, Math.min(H - 11, y));
      const tag = (t, x, y, c, al) => {
        if (!ok(x, y)) return; const w = g.measureText(t).width + 8, x0 = Math.max(2, Math.min(W - w - 2, al === 'right' ? x - w : x));
        const free = yy => placed.every(p => x0 + w <= p.x || x0 >= p.x + p.w || yy + 8 <= p.y - 8 || yy - 8 >= p.y + 8);
        const yy = [y, y - 17, y + 17].find(free); if (yy == null) return;
        placed.push({ x: x0, y: yy, w }); RD.label(g, t, x0, yy, c, 'left');
      };
      const edge = (t, y, c) => tag(t, W - 6, inY(y), c, 'right');
      for (const w of live) {   // the inflection level: a 1-minute close past it is the ▲ / ▼
        const yz = HO.p2y(w.side === 1 ? w.z.top : w.z.bot);
        edge(`15m gap (POI) · watching ${w.left} min`, yz + (w.side === 1 ? -11 : 11), gold);
        if (!w.lv) { edge(w.side === 1 ? 'Waiting for a 1m lower high' : 'Waiting for a 1m higher low', yz + (w.side === 1 ? 11 : -11), COL.text); continue; }
        const x0 = xL(w.lv.t), y = HO.p2y(w.lv.p);
        line(x0, W, y, blue, [5, 3], 2);
        edge(`Inflection ${HO.fp(w.lv.p)} · a 1m close ${w.side === 1 ? 'above = RD ▲' : 'below = RD ▼'}`, y + (w.side === 1 ? -11 : 11), blue);
      }
      for (const b of boxes.slice().reverse().sort((p, q) => (p.done ? 1 : 0) - (q.done ? 1 : 0))) {
        if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W) continue;
        const s = b.s, r = b.r, away = s.dir === -1 ? 11 : -11;
        if (r.kind === 'nofill') { line(b.x0, b.x1, b.ye, u.hexA(COL.text, 0.35), [3, 3], 1); tag(`RD ${s.dir === 1 ? '▲' : '▼'} · not filled`, Math.max(2, b.x0), b.ye + (s.dir === 1 ? 11 : -11), u.hexA(COL.text, 0.6)); continue; }
        line(b.x0, b.x1, b.ys, b.done ? u.hexA(red, 0.45) : red, [], b.done ? 1 : 2.5);
        line(b.x0, b.x1, b.ye, b.done ? u.hexA(COL.text, 0.4) : COL.text, r.kind === 'wait' ? [5, 3] : [], b.done ? 1 : 1.5);
        line(b.x0, b.x1, b.yt, b.done ? u.hexA(green, 0.45) : green, [], b.done ? 1 : 2.5);
        if (!b.done) {
          edge(`RD stop ${HO.fp(s.stop)}`, b.ys - away, red);
          edge(`${r.kind === 'wait' ? 'RD limit (waiting)' : 'RD entry'} ${HO.fp(s.entry)}`, b.ye + away, COL.text);
          edge(`RD target ${HO.fp(s.target)} · 3R`, b.yt + away, green);
        }
        const how = r.kind === 'wait' ? ' · waiting for the fill' : r.kind === 'open' ? ` · open ${r.R >= 0 ? '+' : ''}${r.R.toFixed(1)}R` : r.kind === 'stop' ? ' · ✗ stopped ' + hm(r.t)
          : r.kind === 'target' ? ' · ✓ target ' + hm(r.t) : ` · 6 h out ${r.R >= 0 ? '+' : ''}${r.R.toFixed(1)}R`;
        tag(`RD ${s.dir === 1 ? '▲ buy' : '▼ sell'}${how}`, Math.max(2, b.x0), s.dir === -1 ? b.ys - 11 : b.ys + 11, !b.done ? gold : r.kind === 'target' || r.R > 0 ? green : red);
      }
    }

    // ---------------------------------------------------------------- legend
    function legend() {
      if (!HO.on()) return '';
      const t = ` title="${u.esc(TESTED)}"`;
      if (!tfOk()) return `<span${t}>RD ▲▼: 1H and lower</span>`;
      if (M.err) return `<span${t}>RD ▲▼: ${u.esc(M.err)}</span>`;
      if (!M.out || M.key !== keyNow()) return `<span${t}>RD ▲▼ loading…</span>`;
      const L = taken(), l = L[L.length - 1], end = endNow();
      let s = '';
      if (l && (l.r.kind === 'wait' || l.r.kind === 'open' || end - l.conf < 45 * MIN)) {
        const r = l.r, how = r.kind === 'wait' ? `<b>limit ${HO.fp(l.entry)}</b> waiting` : r.kind === 'open' ? `<b>open</b> ${r.R >= 0 ? '+' : ''}${r.R.toFixed(1)}R` : r.kind === 'nofill' ? 'not filled' : r.kind === 'stop' ? 'stopped' : r.kind === 'target' ? 'target hit' : `6 h out ${r.R >= 0 ? '+' : ''}${r.R.toFixed(1)}R`;
        s += `<span${t}><b class="${l.dir === 1 ? 'up' : 'down'}">${l.dir === 1 ? 'RD ▲ buy' : 'RD ▼ sell'}</b> ${hm(l.t)} · ${how} · stop ${HO.fp(l.stop)} · target ${HO.fp(l.target)}</span>`;
      }
      const live = watching();
      for (const w of live) s += `<span${t}>RD ${w.side === 1 ? '▲' : '▼'} watch: ${w.lv ? `1m close ${w.side === 1 ? 'above' : 'below'} <b>${HO.fp(w.lv.p)}</b>` : `no 1m ${w.side === 1 ? 'lower high' : 'higher low'} yet`} · ${w.left} min</span>`;
      const done = L.filter(g => g.r.kind !== 'wait' && g.r.kind !== 'open' && g.r.kind !== 'nofill'), sum = done.reduce((a, g) => a + g.r.R, 0);
      const wins = done.filter(g => g.r.R > 0).length;
      s += `<span${t}>RD ▲▼ ${DAYS}d: <b>${L.length}</b>${done.length ? ` · ${wins} won, ${done.length - wins} lost · ${sum >= 0 ? '+' : ''}${sum.toFixed(1)}R before fees` : ''}${!HO.all() && !sessOf(end - MIN) ? ' · sessions only (London 07–11, New York 13–17 UTC)' : ''}</span>`;
      return s;
    }
    return { M, load, reset, analyze, marks, draw, legend, taken, result, scan, want, tfOk, ready: () => !!M.out && M.key === keyNow() };
  }
  RD.rdMake = make;   // the Compare chart makes its own
  const main = make({ sym: () => U.sym, ex: () => U.ex, tf: () => U.tf, on: () => !!U.poi, want: () => !!U.poi || (!!U.wins && U.winsRd !== false), all: () => !!U.poiAll, loud: true, t2x: t => RD.t2x(t), p2y: p => RD.p2y(p),
    bars: () => RD.S.bars, box: RD.box, chart: RD.chart, req: () => RD.req(), marks: () => RD.refreshMarkers(), legend: () => RD.legend(), fp: v => u.fp(v) });
  X.marks.push(main.marks); X.draw.push(main.draw); X.legend.push(main.legend);

  // ---------------------------------------------------------------- when to read again
  const again = () => { if (!main.want()) { main.reset(); RD.req(); RD.refreshMarkers(); RD.legend(); } else if (main.M.out) { main.M.n = -1; main.analyze(); } else main.load(); };
  RD.on('poi', again);
  RD.on('wins', again);
  RD.on('sym', () => { main.reset(); main.load(); });
  RD.on('load', () => main.load());
  RD.on('mode', () => { main.reset(); main.load(); });
  RD.on('bars', () => { if (main.want()) main.load(); });   // a new candle, a replay step, another timeframe
  setInterval(() => { if (main.want() && !R.on && !document.hidden) main.load(); }, 20000);   // live: new 1-minute closes between chart candles
  window.__rdPoi = Object.assign(main.M, { scan: main.scan, taken: main.taken, result: main.result, TESTED, DAYS, ready: main.ready, tfOk: main.tfOk, want: main.want });
  if (main.want()) main.load();
})();
