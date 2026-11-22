/* ReplayDesk · Sessions indicator (Indicators → Sessions): the Asia, London and New York opens and closes as lines on the chart.
   Each session runs on its own city's clock, so summer time moves it the way the market does:
     Asia      09:00–18:00 Tokyo     = 00:00–09:00 UTC all year
     London    08:00–17:00 London    = 08:00–17:00 UTC in winter, 07:00–16:00 in summer
     New York  08:00–17:00 New York  = 13:00–22:00 UTC in winter, 12:00–21:00 in summer
   The times can be changed in the menu (e.g. New York 09:30 for the US stock open). Opens are solid lines, closes dashed;
   optional shading and each session's high / low (the newest finished one runs on to the right edge, the level traders
   watch for a sweep). Highs / lows use only candles already on the chart, so in a replay they never see past the clock.
   Weekends too by default (crypto trades every day), drawn fainter since the cities' markets are shut then; "Weekends too"
   off = weekdays only. Shown on 1m–4H. Settings in this browser: rd-sess-v1. */
(function () {
  'use strict';
  const RD = window.__rd;
  const pop = document.querySelector('[data-indpop]');
  if (!RD || !pop) return;
  const { U, S } = RD, u = RD.util, X = RD.ext, store = RD.store;
  const { esc, fp, MIN, HOUR, DAY } = u;

  const SESS = [
    { k: 'asia', name: 'Asia', short: 'ASIA', tz: 'Asia/Tokyo', city: 'Tokyo', open: '09:00', close: '18:00', color: '#a78bfa' },
    { k: 'ldn', name: 'London', short: 'LDN', tz: 'Europe/London', city: 'London', open: '08:00', close: '17:00', color: '#38bdf8' },
    { k: 'ny', name: 'New York', short: 'NY', tz: 'America/New_York', city: 'New York', open: '08:00', close: '17:00', color: '#fb923c' },
  ];
  const P = Object.assign({ on: false, asia: true, ldn: true, ny: true, shade: true, hl: false, wkend: true, times: {} }, store.get('rd-sess-v1', null) || {});
  P.times = Object.assign({}, P.times || {});
  const save = () => store.set('rd-sess-v1', P);
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const tOf = (s, w) => { const v = P.times[s.k] && P.times[s.k][w]; return HHMM.test(v || '') ? v : s[w]; };

  // ---------------------------------------------------------------- a city's wall clock → UTC (summer time included)
  const FMT = {};
  function offMin(tz, t) {   // minutes the city's clock is ahead of UTC at time t
    const f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }));
    const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value;
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - Math.floor(t / MIN) * MIN) / MIN);
  }
  function wall(tz, y, m, d, hm) {   // the UTC time of hh:mm on that local date
    const [h, mi] = hm.split(':').map(Number), naive = Date.UTC(y, m, d, h, mi);
    let t = naive - offMin(tz, naive) * MIN;
    t = naive - offMin(tz, t) * MIN;   // second pass lands on the right side of a clock change
    return t;
  }
  function localDate(tz, t) {
    const f = FMT[tz + '|d'] || (FMT[tz + '|d'] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }));
    const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
    return { y: +p.year, m: +p.month - 1, d: +p.day, wd: p.weekday };
  }
  // every session (open, close) that touches [t0, t1], cached by day range + times
  let cache = { key: '', list: [] };
  function sessions(t0, t1) {
    const d0 = Math.floor(t0 / DAY) - 1, d1 = Math.floor(t1 / DAY) + 1;
    const key = d0 + '|' + d1 + '|' + !!P.wkend + '|' + JSON.stringify(P.times);
    if (cache.key === key) return cache.list;
    const list = [];
    for (const s of SESS) {
      const o = tOf(s, 'open'), c = tOf(s, 'close');
      for (let D = d0; D <= d1; D++) {
        const ld = localDate(s.tz, D * DAY + 12 * HOUR);
        const wk = ld.wd === 'Sat' || ld.wd === 'Sun';
        if (wk && !P.wkend) continue;
        const open = wall(s.tz, ld.y, ld.m, ld.d, o);
        let close = wall(s.tz, ld.y, ld.m, ld.d, c);
        if (close <= open) close = wall(s.tz, ld.y, ld.m, ld.d + 1, c);   // a session set to run past midnight
        list.push({ s, open, close, wk });
      }
    }
    list.sort((a, b) => a.open - b.open);
    cache = { key, list };
    return list;
  }
  const active = () => SESS.filter(s => P[s.k]);
  // which sessions are open at time t, for the Trend table: all three cities at the times set here, weekend ones flagged
  RD.sessionsAt = t => {
    const out = [];
    for (const s of SESS) {
      const o = tOf(s, 'open'), c = tOf(s, 'close');
      for (let D = Math.floor(t / DAY) - 1; D <= Math.floor(t / DAY) + 1; D++) {
        const ld = localDate(s.tz, D * DAY + 12 * HOUR), open = wall(s.tz, ld.y, ld.m, ld.d, o);
        let close = wall(s.tz, ld.y, ld.m, ld.d, c); if (close <= open) close = wall(s.tz, ld.y, ld.m, ld.d + 1, c);
        if (open <= t && t < close) { out.push({ k: s.k, name: s.name, short: s.short, wk: ld.wd === 'Sat' || ld.wd === 'Sun', close }); break; }
      }
    }
    return out;
  };

  // each city at time t: open and when it closes, or shut and when it next opens (times set here, weekend sessions flagged)
  RD.sessionClock = t => SESS.map(s => {
    const o = tOf(s, 'open'), c = tOf(s, 'close');
    for (let D = Math.floor(t / DAY) - 1; D <= Math.floor(t / DAY) + 8; D++) {
      const ld = localDate(s.tz, D * DAY + 12 * HOUR), wk = ld.wd === 'Sat' || ld.wd === 'Sun', open = wall(s.tz, ld.y, ld.m, ld.d, o);
      let close = wall(s.tz, ld.y, ld.m, ld.d, c); if (close <= open) close = wall(s.tz, ld.y, ld.m, ld.d + 1, c);
      if (open <= t && t < close) return { k: s.k, name: s.name, short: s.short, open: true, wk, at: close };
      if (open > t) return { k: s.k, name: s.name, short: s.short, open: false, wk, at: open };   // days run in order: the first later open is the next one
    }
    return { k: s.k, name: s.name, short: s.short, open: false, wk: false, at: null };
  });

  // ---------------------------------------------------------------- what the chart shows
  const tfOK = tf => u.TF[tf] && u.TF[tf].ms <= 4 * HOUR;
  // c = the chart to draw on: its candles, timeframe, time → x, price → y, time scale and pane height (main or Compare)
  const mainC = () => ({ bars: S.bars, tf: U.tf, t2x: RD.t2x, p2y: RD.p2y, ts: RD.chart.timeScale(), H: () => RD.box.clientHeight - RD.chart.timeScale().height() });
  function view(W, c) {
    const B = c.bars, n = B.length; if (!n) return null;
    const ms = u.TF[c.tf].ms, r = c.ts.getVisibleLogicalRange(); if (!r) return null;
    const l2t = l => (l <= n - 1 ? B[Math.max(0, Math.min(n - 1, Math.round(l)))][0] + (l < 0 ? l * ms : 0) : B[n - 1][0] + (l - (n - 1)) * ms);
    const t0 = l2t(r.from), t1 = l2t(r.to);
    const xa = c.t2x(t0), xb = c.t2x(t0 + DAY), pxDay = xa != null && xb != null ? xb - xa : 0;
    return { t0, t1, pxDay, H: c.H(), W };
  }
  // the high / low of a session from the candles on the chart (a replay's chart only holds candles up to its clock)
  function hiLo(open, close, B = S.bars) {
    const n = B.length, now = u.nowT(); if (!n) return null;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] < open) lo = m + 1; else hi = m; }
    let H = -Infinity, L = Infinity, last = null;
    for (let i = lo; i < n && B[i][0] < close && B[i][0] <= now; i++) { if (B[i][2] > H) H = B[i][2]; if (B[i][3] < L) L = B[i][3]; last = B[i][0]; }
    return last == null ? null : { H, L, last };
  }

  const S2 = { dbg: null };   // what the last frame drew (tests)
  X.draw.push((g, W, z) => {
    if (z === 'top') S2.dbg = null;
    if (!P.on) return;
    const d = paint(g, W, z, mainC()); if (z === 'top' && d) S2.dbg = d;
  });
  // the Compare chart draws sessions with the same settings (which sessions, their times, shading, highs / lows)
  RD.sessPaint = (g, W, z, c) => paint(g, W, z, c);
  function paint(g, W, z, c) {
    if (!tfOK(c.tf) || !active().length) return null;
    const v = view(W, c); if (!v || v.pxDay < 26) return null;   // too zoomed out: the lines would be a wall
    const list = sessions(v.t0, v.t1).filter(x => P[x.s.k]), A = u.hexA, clamp = x => Math.max(-2, Math.min(W + 2, x));
    const row = k => SESS.findIndex(s => s.k === k);
    if (z === 'bottom') {
      if (!P.shade) return null;
      for (const x of list) {
        const a = c.t2x(x.open), b = c.t2x(x.close); if (a == null || b == null || b < 0 || a > W) continue;
        g.fillStyle = A(x.s.color, x.wk ? 0.03 : 0.055); g.fillRect(clamp(a), 0, clamp(b) - clamp(a), v.H);
      }
      return null;
    }
    const big = v.pxDay >= 110, mid = v.pxDay >= 50, now = u.nowT(), dbg = { lines: 0, labels: 0, hl: 0, pxDay: Math.round(v.pxDay) };
    // highs / lows first so the open / close lines sit on top
    if (P.hl) {
      const newest = {};
      for (const x of list) if (x.close <= now) newest[x.s.k] = x;
      for (const x of list) {
        if (x.open > now) continue;
        const r = hiLo(x.open, x.close, c.bars); if (!r) continue;
        const a = c.t2x(x.open), b = c.t2x(Math.min(x.close, r.last + u.TF[c.tf].ms)); if (a == null || b == null || b < 0 || a > W) continue;
        const ext = newest[x.s.k] === x;
        for (const [p, nm] of [[r.H, 'H'], [r.L, 'L']]) {
          const y = c.p2y(p); if (y == null) continue;
          g.strokeStyle = A(x.s.color, 0.9); g.lineWidth = 1; g.setLineDash([2, 3]);
          g.beginPath(); g.moveTo(clamp(a), y); g.lineTo(clamp(b), y); g.stroke(); dbg.hl++;
          if (ext && b < W) { g.strokeStyle = A(x.s.color, 0.45); g.beginPath(); g.moveTo(clamp(b), y); g.lineTo(W, y); g.stroke(); }
          g.setLineDash([]);
          if (ext && mid) RD.label(g, `${x.s.short} ${nm} ${fp(p)}`, W - 4, y + (nm === 'H' ? -9 : 9), x.s.color, 'right');
          else if (big && b - a > 60) RD.label(g, `${x.s.short} ${nm}`, clamp(b) - 2, y + (nm === 'H' ? -9 : 9), x.s.color, 'right');
        }
      }
    }
    for (const x of list) {
      const y0 = v.H - 12 - (2 - row(x.s.k)) * 17;   // bottom of the chart (the legend and price tags live at the top)
      for (const [t, isOpen] of [[x.open, true], [x.close, false]]) {
        const px = c.t2x(t); if (px == null || px < -1 || px > W + 1) continue;
        g.strokeStyle = A(x.s.color, (isOpen ? 0.85 : 0.6) * (x.wk ? 0.55 : 1)); g.lineWidth = 1; g.setLineDash(isOpen ? [] : [4, 4]);
        g.beginPath(); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, v.H); g.stroke(); g.setLineDash([]); dbg.lines++;
        const lc = x.wk ? A(x.s.color, 0.6) : x.s.color;
        if (big) { RD.label(g, `${x.s.short} ${isOpen ? 'OPEN' : 'CLOSE'}`, isOpen ? px + 3 : px - 3, y0, lc, isOpen ? 'left' : 'right'); dbg.labels++; }
        else if (mid && isOpen) { RD.label(g, x.s.short, px + 3, y0, lc, 'left'); dbg.labels++; }
        if (x.wk) dbg.wk = (dbg.wk || 0) + 1;
      }
    }
    return dbg;
  }

  // legend: which sessions are open at the chart's time (the replay clock in a replay) and what comes next
  const span = ms => { const m = Math.max(0, Math.round(ms / MIN)), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
  function status(now) {
    const list = sessions(now - DAY, now + 4 * DAY).filter(x => P[x.s.k]);
    const open = list.filter(x => x.open <= now && now < x.close);
    if (open.length) {
      const first = open.reduce((a, b) => (b.close < a.close ? b : a));
      return { open, text: `${open.map(x => x.s.name).join(' + ')} open${open.some(x => x.wk) ? ' (weekend)' : ''} · ${first.s.short} closes in ${span(first.close - now)}` };
    }
    const nx = list.find(x => x.open > now);
    const wkNow = ['Sat', 'Sun'].includes(localDate('UTC', now).wd);
    const lead = !P.wkend && wkNow ? 'Weekend, no sessions (Weekends too is off)' : 'Between sessions';
    return { open, text: nx ? `${lead} · ${nx.s.name} opens in ${span(nx.open - now)}` : lead };
  }
  if (X.legend) X.legend.push(() => {
    if (!P.on || !active().length) return '';
    const st = status(u.nowT());
    const dots = st.open.map(x => `<i class="ss-dot" style="background:${x.s.color}"></i>`).join('');
    return `<span class="ss-leg" title="Sessions (each city's own clock)">${dots}${esc(st.text)}</span>`;
  });

  // ---------------------------------------------------------------- the menu section (inside Indicators)
  const utcNow = s => { const t = Date.now(), ld = localDate(s.tz, t), a = wall(s.tz, ld.y, ld.m, ld.d, tOf(s, 'open')), b = wall(s.tz, ld.y, ld.m, ld.d, tOf(s, 'close')); const h = x => new Date(x).toISOString().slice(11, 16); return `${h(a)}–${h(b)}`; };
  const box = document.createElement('div');
  box.className = 'ss-box';
  const note = pop.querySelector('p');
  pop.insertBefore(document.createElement('hr'), note);
  pop.insertBefore(box, note);
  function render() {
    box.innerHTML = `<label><input type="checkbox" data-sess-on${P.on ? ' checked' : ''}> Trading sessions</label>
      <div class="ss-opts" data-sess-opts${P.on ? '' : ' hidden'}>
        <div class="ss-chips">${SESS.map(s => `<button type="button" class="ss-chip${P[s.k] ? ' on' : ''}" data-sess-k="${s.k}" aria-pressed="${!!P[s.k]}"><i style="background:${s.color}"></i>${s.name}</button>`).join('')}</div>
        <label class="ss-sub"><input type="checkbox" data-sess-shade${P.shade ? ' checked' : ''}> Shade the sessions</label>
        <label class="ss-sub"><input type="checkbox" data-sess-hl${P.hl ? ' checked' : ''}> Session highs / lows</label>
        <label class="ss-sub" title="Crypto trades every day, but the cities' markets are shut at the weekend, so weekend sessions are drawn fainter"><input type="checkbox" data-sess-wk${P.wkend ? ' checked' : ''}> Weekends too (fainter)</label>
        <details class="ss-times" data-sess-times><summary>Times · each city's own clock</summary>
          <div class="ss-grid">${SESS.map(s => `<span><i style="background:${s.color}"></i>${s.name}${s.city !== s.name ? ` <em>${s.city}</em>` : ''}</span>
            <input data-sess-t="${s.k}|open" value="${tOf(s, 'open')}" inputmode="numeric" maxlength="5" aria-label="${s.name} open (${s.city} time)">
            <input data-sess-t="${s.k}|close" value="${tOf(s, 'close')}" inputmode="numeric" maxlength="5" aria-label="${s.name} close (${s.city} time)">`).join('')}</div>
          <p class="ss-utc">Today in UTC: ${SESS.map(s => `${s.short} ${utcNow(s)}`).join(' · ')}</p>
          <button type="button" class="ss-reset" data-sess-reset>Reset to the usual times</button>
        </details>
        <p class="ss-hint">Shown on 1m–4H. Zoom in if the lines disappear.</p>
      </div>`;
  }
  const changed = () => { save(); RD.req(); if (RD.legend) RD.legend(); };
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-sess-on]')) { P.on = t.checked; box.querySelector('[data-sess-opts]').hidden = !P.on; if (P.on && !tfOK()) RD.toast('Sessions show on 1m to 4H charts.'); changed(); }
    else if (t.matches('[data-sess-shade]')) { P.shade = t.checked; changed(); }
    else if (t.matches('[data-sess-hl]')) { P.hl = t.checked; changed(); }
    else if (t.matches('[data-sess-wk]')) { P.wkend = t.checked; changed(); }
    else if (t.matches('[data-sess-t]')) {
      const [k, w] = t.dataset.sessT.split('|'), s = SESS.find(x => x.k === k);
      let v = t.value.trim().replace(/^(\d):/, '0$1:').replace(/^(\d\d)(\d\d)$/, '$1:$2');
      if (!HHMM.test(v)) { RD.toast('Use 24-hour time, like 08:00 or 13:30.', 'down'); t.value = tOf(s, w); return; }
      P.times[k] = Object.assign({}, P.times[k], { [w]: v }); t.value = v;
      const p = box.querySelector('.ss-utc'); if (p) p.textContent = 'Today in UTC: ' + SESS.map(x => `${x.short} ${utcNow(x)}`).join(' · ');
      changed();
    }
  });
  box.addEventListener('click', e => {
    const c = e.target.closest('[data-sess-k]');
    if (c) { const k = c.dataset.sessK; P[k] = !P[k]; c.classList.toggle('on', P[k]); c.setAttribute('aria-pressed', String(P[k])); changed(); return; }
    if (e.target.closest('[data-sess-reset]')) { P.times = {}; const open = box.querySelector('[data-sess-times]').open; render(); box.querySelector('[data-sess-times]').open = open; changed(); }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-sess-t]')) e.target.blur(); });
  render();
  RD.on('load', () => { if (P.on) RD.req(); });
  // the legend's countdown moves on with the clock
  setInterval(() => { if (P.on && !document.hidden && RD.legend) RD.legend(); }, 30000);
  window.__rdSess = { P, SESS, S2, sessions, status, wall, offMin, hiLo };   // for tests
})();
