/* ReplayDesk · Trade marks (Indicators → "Trade marks: A+ and RD ✓ wins"): every A+ setup and RD ▲ / ▼ trade that
   worked, marked where it was taken, so you can scroll back through them and study what a winner looked like.
   - ▲ BUY ✓ / ▼ SELL ✓ on the candle it triggered (A+: the 1-minute close past the trigger; RD: the signal candle, filled
     at its limit just after).
   - A faint box from the entry to the exit: green = entry → target, red = entry → stop; a dashed line from the entry price
     to where it closed, and the result (R before fees) at the exit.
   - Hover a trade (its box or its candle): its story in the top-left line, step by step: the structure break, the
     pullback, the sweep, the trigger, the entry / stop / target, and how it ended.
   - "Losing trades too" adds the ✗ ones, faded, so the winners can be compared with the ones that failed.
   The trades and results are the A+ and RD ▲ / ▼ indicators' own (deskaplus.js / deskpoi.js, the same code and data: A+ the
   last 3 days of 1-minute candles, RD the last 4), whether or not those indicators are ticked. Closed candles up to the clock
   only, so in a replay a mark shows once the trade has finished by the replay clock. */
(function () {
  'use strict';
  const RD = window.__rd;
  if (!RD) return;
  const { U } = RD, u = RD.util, X = RD.ext;
  const TESTED = 'Study marks, not signals: the winners are picked after the fact. Both rule sets lost after fees in our tests (A+ about −0.12 to −0.18R a trade, RD about −0.18R), no better than random entries with the same stop and target, so most winners have losers around them. Tick "Losing trades too" to see those.';
  const AP = () => window.__rdAplus || null, PO = () => window.__rdPoi || null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hm = t => new Date(t).toISOString().slice(11, 16), dm = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + hm(t); };
  const sgn = x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);
  const fp = v => u.fp(v);
  const on = () => !!U.wins, apOn = () => on() && U.winsAp !== false, rdOn = () => on() && U.winsRd !== false;
  const aReady = () => { const a = AP(); return !!(apOn() && a && a.ready && a.ready()); };
  const pReady = () => { const p = PO(); return !!(rdOn() && p && p.ready && p.ready()); };

  // every finished trade of both: { src, s (the setup / signal), dir, t (its candle), inT (filled), outT, entry, stop, target, exit, R, win, kind }
  let memo = { k: null, L: [] };
  function trades() {
    const a = AP(), p = PO(), aOk = aReady(), pOk = pReady();
    const k = [aOk, aOk && a.A, aOk && a.n, aOk && a.end, pOk, pOk && p.out, pOk && p.n, pOk && p.end, !!U.poiAll];
    if (memo.k && k.every((v, i) => v === memo.k[i])) return memo.L;
    const L = [];
    if (aOk) for (const s of a.A.setups) {
      const r = a.result(s); if (!r) continue;   // still open
      const win = r.kind === 'target';
      L.push({ src: 'A+', s, dir: s.dir, t: s.t, inT: s.t, outT: r.t, entry: s.entry, stop: s.stop, target: s.target, exit: win ? s.target : s.stop, R: win ? s.R : -1, win, kind: r.kind });
    }
    if (pOk) for (const g of p.taken()) {
      const r = g.r; if (!r || r.kind === 'wait' || r.kind === 'open' || r.kind === 'nofill') continue;
      const rk = Math.abs(g.entry - g.stop), exit = r.kind === 'target' ? g.target : r.kind === 'stop' ? g.stop : g.entry + g.dir * r.R * rk;
      L.push({ src: 'RD', s: g, dir: g.dir, t: g.t, inT: r.fillT, outT: r.t, entry: g.entry, stop: g.stop, target: g.target, exit, R: r.R, win: r.R > 0, kind: r.kind });
    }
    L.sort((x, y) => x.t - y.t);
    memo = { k, L };
    return L;
  }
  const shown = () => (on() ? trades().filter(x => x.win || U.winsLoss) : []);

  // where each shown trade sits on the chart (x / y in the price pane), and the one under the pointer
  function layout(W) {
    const ok = (...v) => v.every(q => q != null && isFinite(q)), out = [];
    const xs = t => { const x = RD.t2x(t); return x == null ? null : Math.max(-40, Math.min(W + 40, x)); };
    for (const x of shown()) {
      const x0 = xs(x.t), x1 = xs(x.outT);
      if (!ok(x0, x1) || x1 < -20 || x0 > W + 20) continue;
      const b = { x, x0, x1: Math.max(x1, x0 + 6), ye: RD.p2y(x.entry), ys: RD.p2y(x.stop), yt: RD.p2y(x.target), yx: RD.p2y(x.exit) };
      if (ok(b.ye, b.ys, b.yt, b.yx)) out.push(b);
    }
    return out;
  }
  function hovered(items) {
    const p = RD.hoverPt;
    if (p) {   // inside a trade's box (the smallest one when they overlap)
      let best = null, bw = Infinity;
      for (const b of items) {
        const top = Math.min(b.ys, b.yt), bot = Math.max(b.ys, b.yt), w = b.x1 - b.x0;
        if (p.x >= b.x0 - 4 && p.x <= b.x1 + 4 && p.y >= top - 6 && p.y <= bot + 6 && w < bw) { best = b; bw = w; }
      }
      if (best) return best;
    }
    const hb = RD.hoverBar;   // or on the candle its mark sits on
    if (!hb) return null;
    return items.find(b => u.bucket(b.x.t, U.tf) === hb[0]) || null;
  }

  // ---------------------------------------------------------------- marks on the candles
  X.marks.push(() => shown().map(x => {
    const up = x.dir === 1, c = up ? RD.COL.up : RD.COL.down;
    return { t: x.t, position: up ? 'belowBar' : 'aboveBar', color: x.win ? c : u.hexA(c, 0.45), shape: up ? 'arrowUp' : 'arrowDown', text: `${x.src} ${up ? 'BUY' : 'SELL'} ${x.win ? '✓' : '✗'}` };
  }));

  // ---------------------------------------------------------------- boxes, path and result
  X.draw.push((g, W, z) => {
    if (!on()) return;
    const items = layout(W); if (!items.length) return;
    const COL = RD.COL, hov = hovered(items);
    if (z === 'bottom') {
      for (const b of items) {
        const a = b.x.win ? 1 : 0.5, w = b.x1 - b.x0;
        g.fillStyle = u.hexA(COL.up, (b === hov ? 0.2 : 0.11) * a); g.fillRect(b.x0, Math.min(b.ye, b.yt), w, Math.abs(b.yt - b.ye));
        g.fillStyle = u.hexA(COL.down, (b === hov ? 0.16 : 0.08) * a); g.fillRect(b.x0, Math.min(b.ye, b.ys), w, Math.abs(b.ys - b.ye));
      }
      return;
    }
    for (const b of items) {   // dashed entry → exit, a dot where it closed
      const c = b.x.win ? COL.up : COL.down, a = b.x.win ? 0.95 : 0.5, big = b === hov;
      g.strokeStyle = u.hexA(c, a); g.lineWidth = big ? 2 : 1.25; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(b.x0, b.ye); g.lineTo(b.x1, b.yx); g.stroke(); g.setLineDash([]);
      g.fillStyle = u.hexA(c, a); g.beginPath(); g.arc(b.x1, b.yx, big ? 4.5 : 3.5, 0, Math.PI * 2); g.fill();
      if (big) {   // the trade under the pointer: its entry, stop and target lines
        g.lineWidth = 1;
        for (const [y, cc] of [[b.ye, COL.text], [b.ys, COL.down], [b.yt, COL.up]]) { g.strokeStyle = cc; g.beginPath(); g.moveTo(b.x0, Math.round(y) + 0.5); g.lineTo(b.x1, Math.round(y) + 0.5); g.stroke(); }
      }
    }
    const placed = [];   // the result at the exit; one that would overlap another is left out (the hovered one goes first)
    g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
    for (const b of (hov ? [hov] : []).concat(items.filter(q => q !== hov).reverse())) {
      const t = `${b.x.win ? '✓' : '✗'} ${sgn(b.x.R)}R`, w = g.measureText(t).width + 8;
      const x0 = Math.max(2, Math.min(W - w - 2, b.x1 + 6)), y = b.yx + (b.x.dir === 1 ? (b.x.win ? -11 : 11) : (b.x.win ? 11 : -11));
      if (placed.some(p => !(x0 + w <= p.x || x0 >= p.x + p.w || y + 8 <= p.y - 8 || y - 8 >= p.y + 8))) continue;
      placed.push({ x: x0, y, w });
      RD.label(g, t, x0, y, b.x.win ? COL.up : u.hexA(COL.down, 0.8), 'left');
    }
  });

  // ---------------------------------------------------------------- legend: counts, and the story of the trade under the pointer
  const res = x => x.kind === 'target' ? `<b class="up">✓ target ${dm(x.outT)}</b> after ${u.dur(x.outT - x.t)} · ${sgn(x.R)}R`
    : x.kind === 'stop' ? `<b class="down">✗ stopped ${dm(x.outT)}</b> after ${u.dur(x.outT - x.t)} · −1R`
      : `<b class="${x.R > 0 ? 'up' : 'down'}">${x.R > 0 ? '✓' : '✗'} closed after 6 h, ${dm(x.outT)}</b> · ${sgn(x.R)}R`;
  function story(x) {
    const s = x.s;
    if (x.src === 'A+') {
      const sh = s.dir === -1, b = s.brk || {}, sw = s.sweep || {}, stf = AP() && AP().stfNow ? AP().stfNow() : '';
      const lvl = sw.kind === 'swing' ? (sh ? 'swing high' : 'swing low') : sw.kind || 'level';
      return `<b class="${sh ? 'down' : 'up'}">A+ ${sh ? 'SELL' : 'BUY'}</b> ${dm(s.t)}: ① ${stf} ${b.kind || 'break'} ${sh ? 'down through' : 'up through'} ${fp(b.p)} (${hm(b.t)})` +
        ` → ② pullback into ${sh ? 'premium' : 'discount'}${s.inZone ? ' + the order block' : ''}` +
        ` → ③ swept the ${lvl} ${fp(sw.p)} (wick ${fp(sw.wick)}, ${hm(sw.wickT)})` +
        ` → ④ 1m close ${sh ? 'below' : 'above'} ${fp(s.trig.p)}: entry ${fp(s.entry)} · stop ${fp(s.stop)} · target ${fp(s.target)} (${s.R.toFixed(1)}R) → ${res(x)}`;
    }
    const up = s.dir === 1;
    return `<b class="${up ? 'up' : 'down'}">RD ${up ? '▲ BUY' : '▼ SELL'}</b> ${dm(s.t)}: ① price reached the 15m gap ${fp(s.z.bot)}–${fp(s.z.top)}` +
      ` → ② 1m close ${up ? 'above' : 'below'} the inflection ${fp(s.lv)} (the last 1m ${up ? 'lower high' : 'higher low'}), leaving a 1m gap` +
      ` → ③ limit ${fp(s.entry)} filled ${hm(x.inT)} · stop ${fp(s.stop)} · target ${fp(s.target)} (3R) → ${res(x)}`;
  }
  X.legend.push(() => {
    if (!on()) return '';
    const t = ` title="${u.esc(TESTED)}"`, a = AP(), p = PO(), L = trades(), bits = [];
    const cnt = (src, days) => {
      const Q = L.filter(x => x.src === src), w = Q.filter(x => x.win).length, sum = Q.reduce((s, x) => s + x.R, 0);
      return `${src} ${days}d: ${Q.length ? `<b class="up">${w} won</b> of ${Q.length} (${sgn(sum)}R before fees)` : 'none finished'}`;
    };
    if (apOn()) bits.push(!a || !a.stfNow() ? 'A+ needs 4H or lower' : !aReady() ? 'A+ loading…' : cnt('A+', a.DAYS));
    if (rdOn()) bits.push(!p || !p.tfOk() ? 'RD needs 1H or lower' : !pReady() ? 'RD loading…' : cnt('RD', p.DAYS));
    if (!bits.length) bits.push('tick A+ setups or RD ▲ / ▼ under it');
    let s = `<span${t}>✓ Trade marks · ${bits.join(' · ')}${L.length ? (u.phone() ? ' · tap one' : ' · hover one') + ' for its story' : ''}</span>`;
    const W = RD.box.clientWidth, h = RD.hoverPt || RD.hoverBar ? hovered(layout(W)) : null;
    if (h) s += `<span class="dk-wstory">${story(h.x)}</span>`;
    return s;
  });

  RD.on('wins', () => { memo.k = null; RD.req(); RD.refreshMarkers(); RD.legend(); });
  window.__rdWins = { trades, shown, layout, hovered, story, TESTED };
})();
