/* ReplayDesk · Trend table (Indicators → Trend table): a small table in a corner of the chart with the trend on
   5m, 15m, 1H and 4H, whether all four agree, and which session is open. On a phone it is one line in the legend.
   Trend by:
     EMA 20 / 50   (default) bullish when EMA 20 is above EMA 50 on that timeframe, bearish when below
     EMA 50 / 200  the same with the slower pair
     Structure     the last break of structure on closed candles (the Market tab's Trend read)
   EMAs use that timeframe's candles with the forming candle at the price now, like the chart's own EMA lines.
   In a replay everything reads the replay clock: candles that start after it are never used and the forming candle
   closes at the replay price, so the table never sees ahead. Sessions come from the Sessions indicator's clock times
   (each city's own clock, summer time included). Settings in this browser: rd-trend-v1. */
(function () {
  'use strict';
  const RD = window.__rd;
  const pop = document.querySelector('[data-indpop]');
  const box = document.querySelector('[data-chart]');
  if (!RD || !pop || !box) return;
  const { U, R, S } = RD, u = RD.util, X = RD.ext, store = RD.store;
  const { esc, MIN } = u;

  const TFS = ['5m', '15m', '1H', '4H'];
  const BY = { e20: { name: 'EMA 20 / 50', btn: 'EMA 20/50', a: 20, b: 50 }, e50: { name: 'EMA 50 / 200', btn: 'EMA 50/200', a: 50, b: 200 }, st: { name: 'Structure', btn: 'Structure' } };
  const P = Object.assign({ on: false, by: 'e20', pos: 'tr' }, store.get('rd-trend-v1', null) || {});
  if (!BY[P.by]) P.by = 'e20';
  const save = () => store.set('rd-trend-v1', P);

  // ---------------------------------------------------------------- candles per timeframe (cached; a replay reads up to the clock only)
  const C = {};   // tf → { key, ks, busy, err }
  const NEED = 600, LIMIT = 1000;   // candles before the clock for EMA 200 to settle (seed weight < 1%); one request
  const keyNow = () => `${U.ex}|${U.sym}|${R.on ? 'r' : 'l'}`;
  function upTo(ks, ms, t) {   // the candles that had started by t; with the replay clock past the last one it is not closed yet
    let j = ks.length - 1; while (j >= 0 && ks[j][0] > t) j--;
    return ks.slice(0, j + 1);
  }
  async function load(tf, t) {
    const ms = u.TF[tf].ms, c = C[tf] || (C[tf] = {}), key = keyNow();
    if (c.busy) return;
    const ks = c.key === key ? c.ks : null;
    if (ks && ks.length) {
      const before = upTo(ks, ms, t).length;
      const fresh = R.on ? (t < ks[ks.length - 1][0] + ms || c.atEnd) && (before >= NEED || c.atStart) : Date.now() - c.at < 60e3;
      if (fresh && before) return;
    }
    c.busy = true;
    try {
      const now = Date.now();
      let got;
      if (R.on) {   // reach a while past the clock so playing on doesn't ask again every step; only candles up to the clock are ever read
        const end = Math.min(now, t + Math.max(150 * ms, 40 * u.TF[U.tf].ms));
        got = await u.api(U.ex).klines(U.sym, tf, { end, limit: LIMIT });
        c.atEnd = end >= now - ms; c.atStart = got.length < LIMIT;
      } else { got = await u.api(U.ex).klines(U.sym, tf, { limit: LIMIT }); c.atEnd = true; c.atStart = got.length < LIMIT; }
      if (key !== keyNow()) return;
      Object.assign(c, { key, ks: got, at: now, err: null });
    } catch (e) { c.err = e.message || 'no data'; } finally { c.busy = false; }
    sched();
  }

  // ---------------------------------------------------------------- the reads
  function emaLast(closes, n) {
    if (closes.length < n) return null;
    let e = closes.slice(0, n).reduce((s, v) => s + v, 0) / n;   // starts from the first n-candle average
    const k = 2 / (n + 1);
    for (let i = n; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  }
  function readTf(tf, t, px) {
    const c = C[tf], ms = u.TF[tf].ms;
    if (!c || c.key !== keyNow() || !c.ks) return { tf, v: null, wait: true };
    const ks = upTo(c.ks, ms, t);
    if (!ks.length) return { tf, v: null, note: 'no candles yet' };
    if (P.by === 'st') {
      if (!window.SMC) return { tf, v: null, note: 'SMC did not load' };
      const closed = ks.filter(k => k[0] + ms <= t);
      if (closed.length < 12) return { tf, v: null, note: 'too new' };
      const l = closed[closed.length - 1], base = closed.concat([[l[0] + ms, l[4], l[4], l[4], l[4], 0]]);
      const A = window.SMC.analyze(base, base.length - 1, { tf: ms });
      return { tf, v: A.trend === 1 ? 1 : A.trend === -1 ? -1 : 0, note: A.trend ? '' : 'no break yet' };
    }
    const b = BY[P.by], closes = ks.map(k => k[4]);
    if (px != null && ks[ks.length - 1][0] + ms > t) closes[closes.length - 1] = px;   // the forming candle at the price now
    const ea = emaLast(closes, b.a), eb = emaLast(closes, b.b);
    if (ea == null || eb == null) return { tf, v: null, note: `needs ${b.b} candles` };
    return { tf, v: ea > eb ? 1 : ea < eb ? -1 : 0, ea, eb };
  }
  function read() {
    const t = u.nowT(), px = S.lastPx;
    const rows = TFS.map(tf => readTf(tf, t, px));
    const vs = rows.map(r => r.v);
    const all = vs.every(v => v === 1) ? 1 : vs.every(v => v === -1) ? -1 : vs.some(v => v == null) ? null : 0;
    const sess = RD.sessionsAt ? RD.sessionsAt(t) : null, clock = RD.sessionClock ? RD.sessionClock(t) : [];
    return { rows, all, sess, clock, t };
  }

  // ---------------------------------------------------------------- drawing
  const el = document.createElement('div');
  el.className = 'tt'; el.hidden = true; el.setAttribute('aria-label', 'Trend table');
  box.appendChild(el);
  const word = v => (v === 1 ? 'BULLISH' : v === -1 ? 'BEARISH' : 'MIXED');
  const cls = v => (v === 1 ? 'up' : v === -1 ? 'down' : 'n');
  // sessions: "open · 2h 04m left" / "opens in 5h 10m"; a weekend session (stock markets shut, crypto trades on) reads "wknd"
  const dur = ms => { const m = Math.max(0, Math.ceil(ms / 60e3 - 1e-9)); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h'; };
  const hm = at => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const WK = ' (weekend: stock markets are shut, crypto trades on)';
  function sessCell(c, t) {
    if (c.at == null) return { text: '—', c: 'n', tip: '' };
    if (c.open) return { text: (c.wk ? 'wknd' : 'open') + ' · ' + dur(c.at - t) + ' left', c: c.wk ? 'n' : 'so', tip: `${c.name} is open, closes ${hm(c.at)} your time${c.wk ? WK : ''}` };
    return { text: 'opens in ' + dur(c.at - t), c: 'n', tip: `${c.name} opens ${hm(c.at)} your time${c.wk ? WK : ''}` };
  }
  // phone line: the open ones with time left, or the next to open
  function sessLine(d) {
    const on = d.clock.filter(c => c.open);
    if (on.length) return on.map(c => `${c.short} ${c.wk ? 'wknd ' : ''}${dur(c.at - d.t)} left`).join(', ');
    const nx = d.clock.filter(c => c.at != null).sort((a, b) => a.at - b.at)[0];
    return nx ? `${nx.short} opens in ${dur(nx.at - d.t)}` : '';
  }
  function place() {
    let w = 0, h = 0;
    try { w = RD.chart.priceScale('right').width(); h = RD.chart.timeScale().height(); } catch (e) { /* not drawn yet */ }
    el.style.right = (w + 8) + 'px';
    if (P.pos === 'br') { el.style.top = ''; el.style.bottom = (h + 8) + 'px'; } else { el.style.bottom = ''; el.style.top = '8px'; }
  }
  let last = '';
  function render() {
    const show = P.on && !u.phone() && !!U.sym;
    el.hidden = !show;
    if (!show) { last = ''; return; }
    const d = read(), by = BY[P.by], tfNow = U.tf;
    const lineup = d.all === 1 ? ['ALIGNED ▲', 'up'] : d.all === -1 ? ['ALIGNED ▼', 'down'] : d.all === 0 ? ['NOT ALIGNED', 'n'] : ['…', 'n'];
    const html = `<div class="tt-h" title="${esc(by.name)} on each timeframe${R.on ? ', at the replay clock' : ''}. Practice read, not a signal.">${esc(by.name)}${R.on ? ' · replay' : ''}</div>` +
      `<div class="tt-r"><span>${P.by === 'st' ? 'All agree' : 'EMA lineup'}</span><b class="tt-c ${lineup[1]}">${lineup[0]}</b></div>` +
      d.rows.map(r => `<div class="tt-r${r.tf === tfNow ? ' cur' : ''}"><span>${r.tf === '1H' || r.tf === '4H' ? r.tf : r.tf.replace('m', ' m').toUpperCase()}</span>` +
        `<b class="tt-c ${r.v == null ? 'n' : cls(r.v)}"${r.note ? ` title="${esc(r.note)}"` : ''}>${r.v == null ? (r.wait ? '…' : '—') : word(r.v)}</b></div>`).join('') +
      d.clock.map((c, i) => { const x = sessCell(c, d.t); return `<div class="tt-r tt-s${i ? '' : ' first'}"><span>${c.k === 'ny' ? 'New York' : esc(c.name)}</span><b class="tt-c ${x.c}" title="${esc(x.tip)}">${esc(x.text)}</b></div>`; }).join('');
    if (html !== last) { el.innerHTML = html; last = html; }
    place();
  }
  // phone: one line in the legend instead of a table over the candles
  if (X.legend) X.legend.push(() => {
    if (!P.on || !u.phone()) return '';
    const d = read(), ss = sessLine(d);
    const a = v => (v === 1 ? '<b class="up">▲</b>' : v === -1 ? '<b class="down">▼</b>' : v === 0 ? '<b class="muted">•</b>' : '<b class="muted">…</b>');
    return `<span class="tt-leg" title="${esc(BY[P.by].name)}">${d.rows.map(r => `${r.tf} ${a(r.v)}`).join(' ')}${d.all === 1 || d.all === -1 ? ' <em>aligned</em>' : ''}${ss ? ' · ' + esc(ss) : ''}</span>`;
  });

  // ---------------------------------------------------------------- when to read again
  let q = null, lastLeg = '';
  function sched() {
    if (q) return;
    q = setTimeout(() => {
      q = null;
      if (!P.on) { render(); return; }
      const t = u.nowT();
      for (const tf of TFS) load(tf, t);
      render();
      if (u.phone()) { const d = read(), k = JSON.stringify([d.rows.map(r => r.v), d.all, sessLine(d)]); if (k !== lastLeg) { lastLeg = k; RD.legend(); } }
    }, R.on && R.playing ? 300 : 120);
  }
  const reset = () => { for (const k in C) delete C[k]; last = ''; sched(); };
  RD.on('load', reset);
  RD.on('sym', reset);
  RD.on('mode', reset);
  RD.on('bars', sched);
  RD.on('theme', () => { last = ''; sched(); });
  let tickAt = 0;
  RD.on('tick', () => { if (P.on && Date.now() - tickAt > 2000) { tickAt = Date.now(); sched(); } });
  setInterval(() => { if (P.on && !document.hidden && !R.on) sched(); }, 30e3);   // live: new candles on the other timeframes, the session clock
  window.addEventListener('resize', () => { if (P.on) place(); });
  RD.chart.timeScale().subscribeSizeChange && RD.chart.timeScale().subscribeSizeChange(() => { if (P.on) place(); });

  // ---------------------------------------------------------------- the menu section (inside Indicators)
  const menu = document.createElement('div');
  menu.className = 'tt-box';
  const note = pop.querySelector(':scope > p');   // the menu's own note (the Sessions section has paragraphs of its own)
  pop.insertBefore(document.createElement('hr'), note);
  pop.insertBefore(menu, note);
  function menuHtml() {
    menu.innerHTML = `<label title="The trend on 5m, 15m, 1H and 4H in a corner of the chart, whether they agree, and the Asia, London and New York sessions: open with the time left, or how long until they open. Practice read, not a signal: in our tests A+ setups with the 4H trend did no better than against it."><input type="checkbox" data-tt-on${P.on ? ' checked' : ''}><span>Trend table<small class="tt-lab">5m · 15m · 1H · 4H · sessions</small></span></label>
      <div class="tt-opts" data-tt-opts${P.on ? '' : ' hidden'}>
        <div class="tt-cap">Trend by</div><div class="dk-smcall" role="group" aria-label="Trend by">${Object.keys(BY).map(k => `<button type="button" data-tt-by="${k}" aria-pressed="${P.by === k}"${P.by === k ? ' class="on"' : ''}>${BY[k].btn}</button>`).join('')}</div>
        <div class="tt-cap">Corner</div><div class="dk-smcall" role="group" aria-label="Corner"><button type="button" data-tt-pos="tr" aria-pressed="${P.pos === 'tr'}"${P.pos === 'tr' ? ' class="on"' : ''}>Top right</button><button type="button" data-tt-pos="br" aria-pressed="${P.pos === 'br'}"${P.pos === 'br' ? ' class="on"' : ''}>Bottom right</button></div>
      </div>`;
  }
  menuHtml();
  const changed = () => { save(); last = ''; lastLeg = ''; sched(); RD.legend(); };
  menu.addEventListener('change', e => {
    if (e.target.matches('[data-tt-on]')) { P.on = e.target.checked; menu.querySelector('[data-tt-opts]').hidden = !P.on; changed(); }
  });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-tt-by], [data-tt-pos]'); if (!b) return;
    if (b.dataset.ttBy) P.by = b.dataset.ttBy; else P.pos = b.dataset.ttPos;
    menuHtml(); changed();
  });
  RD.trendTable = { read, P, render };   // for tests and the curious
  if (P.on) sched();
})();
