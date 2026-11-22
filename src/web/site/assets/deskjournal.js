/* ReplayDesk · the paper journal: what happened to your paper trades, and whether you are getting better.
   - On the chart: each closed trade on this coin as a box from its entry to its exit (green made money, red lost) with
     entry / exit marks and the result in R. In a replay: this replay's trades, and only what the clock has reached.
   - A result card when a trade closes (why, $, R, how long, the best and worst it got while open); a summary card when
     a replay ends or restarts.
   - The replay bar keeps this replay's score: trades, wins / losses, R added up. A click opens Stats for this replay.
   - Stats tab: the journal's numbers, your R added up trade by trade, your latest trades against the ones before (with
     a luck check), every replay session, splits by side / exit / coin / timeframe, and plain facts from the trades.
   - Saved to your account when signed in: closed trades go to the server (/api/site/paper) and come back in any
     browser; a Reset clears it everywhere. Open trades stay in the browser that opened them. */
(function () {
  'use strict';
  const RD = window.__rd;
  if (!RD || !RD.acct) return;
  const { U, R } = RD, X = RD.ext, u = RD.util, AC = RD.acct;
  const { esc, money, fr, pct, coin, dur, ic, phone, hexA } = u;
  const acct = () => RD.A;
  const $ = (q, el = document) => el.querySelector(q);
  const DAYMS = 864e5;
  const WHY = { Target: 'Target hit', Stop: 'Stopped out', Liquidated: 'Liquidated', Closed: 'Closed by you', 'Replay ended': 'Closed when the replay ended', 'Replay restarted': 'Closed when the replay restarted' };
  const whyTxt = w => WHY[w] || w || 'Closed';
  const sgnR = r => (r == null ? '—' : fr(r));
  const day = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const dayT = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const utcDay = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  // the furthest a trade went for / against it while open, in R (with a stop) or % of the entry
  const moveFor = h => (h.hi == null || h.lo == null ? null : h.side === 1 ? h.hi - h.entry : h.entry - h.lo);
  const moveAgainst = h => (h.hi == null || h.lo == null ? null : h.side === 1 ? h.entry - h.lo : h.hi - h.entry);
  const inR = (h, m) => (m == null ? null : h.risk ? m * h.qty / h.risk : null);
  const showMove = (h, m) => (m == null ? '—' : h.risk ? fr(m * h.qty / h.risk) : pct(m / h.entry * 100));

  // ---------------------------------------------------------------- numbers for a list of closed trades
  function sum(H) {
    const n = H.length, w = H.filter(h => h.pnl > 0), l = H.filter(h => h.pnl <= 0), rs = H.filter(h => h.r != null);
    const net = H.reduce((s, h) => s + h.pnl, 0), sumR = rs.reduce((s, h) => s + h.r, 0);
    const gw = w.reduce((s, h) => s + h.pnl, 0), gl = -l.reduce((s, h) => s + h.pnl, 0);
    const wr = rs.filter(h => h.r > 0), lr = rs.filter(h => h.r <= 0);
    return { n, w: w.length, l: l.length, net, nR: rs.length, sumR, avgR: rs.length ? sumR / rs.length : null, pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
      avgW: wr.length ? wr.reduce((s, h) => s + h.r, 0) / wr.length : null, avgL: lr.length ? lr.reduce((s, h) => s + h.r, 0) / lr.length : null };
  }
  const oldestFirst = H => H.slice().sort((a, b) => (a.wt || 0) - (b.wt || 0) || (a.t1 || 0) - (b.t1 || 0));
  const sessTrades = sid => acct().hist.filter(h => h.sid === sid);

  // ---------------------------------------------------------------- on the chart
  const mine = () => {   // trades to draw: this replay's, or the live ones, on this coin
    const md = R.on ? 'replay' : 'live';
    return acct().hist.filter(h => h.sym === U.sym && h.mode === md && (!R.on || h.sid === R.sid)).slice(0, 80);
  };
  const now = () => (R.on ? R.clock : Date.now());
  X.marks.push(() => {
    const COL = RD.COL, out = [], t = now();
    for (const h of mine()) {
      if (h.t0 > t) continue;
      const L = h.side === 1, good = h.pnl > 0;
      out.push({ t: h.t0, position: L ? 'belowBar' : 'aboveBar', color: COL.pri, shape: L ? 'arrowUp' : 'arrowDown', text: L ? 'Buy' : 'Sell' });
      if (h.t1 <= t) out.push({ t: h.t1, position: L ? 'aboveBar' : 'belowBar', color: good ? COL.up : COL.down, shape: 'circle', text: h.r != null ? sgnR(h.r) : money(h.pnl, true) });
    }
    const md = R.on ? 'replay' : 'live';
    for (const p of acct().pos) if (p.sym === U.sym && p.mode === md && p.t <= t) out.push({ t: p.t, position: p.side === 1 ? 'belowBar' : 'aboveBar', color: COL.pri, shape: p.side === 1 ? 'arrowUp' : 'arrowDown', text: p.side === 1 ? 'Buy' : 'Sell' });
    return out;
  });
  X.draw.push((g, W, z) => {
    const COL = RD.COL, t = now(), ok = (...v) => v.every(q => q != null && isFinite(q));
    for (const h of mine()) {
      if (h.t1 > t || h.t0 > t) continue;
      const x0 = RD.t2x(h.t0), x1 = RD.t2x(h.t1), ye = RD.p2y(h.entry), yx = RD.p2y(h.exit);
      if (!ok(x0, x1, ye, yx) || Math.max(x0, x1) < 0 || Math.min(x0, x1) > W) continue;
      const c = h.pnl > 0 ? COL.up : COL.down, xa = Math.min(x0, x1), w = Math.max(4, Math.abs(x1 - x0));
      if (z === 'bottom') { g.fillStyle = hexA(c, 0.13); g.fillRect(xa, Math.min(ye, yx), w, Math.max(1, Math.abs(yx - ye))); continue; }
      g.strokeStyle = hexA(c, 0.9); g.lineWidth = 1.5; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(x0, ye); g.lineTo(x1, yx); g.stroke(); g.setLineDash([]);
    }
  });
  let markKey = '';
  function redraw(force) {
    const t = now(), k = mine().map(h => h.uid + (h.t0 <= t ? 1 : 0) + (h.t1 <= t ? 1 : 0)).join(',') + '|' + acct().pos.length + '|' + U.sym + R.sid;
    if (!force && k === markKey) return;
    markKey = k; RD.refreshMarkers(); RD.req();
  }

  // ---------------------------------------------------------------- the score in the replay bar
  const tallies = [];
  for (const bar of [$('[data-rp]'), $('[data-rpm]')]) {
    if (!bar) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'rj-tally'; b.dataset.rjTally = ''; b.title = "This replay's closed trades — click for its stats";
    const clk = $('[data-clock]', bar); bar.insertBefore(b, clk ? clk.nextSibling : null);
    b.addEventListener('click', () => openStats('sess'));
    tallies.push(b);
  }
  function tally() {
    if (!R.on || !R.sid) { for (const b of tallies) b.hidden = true; return; }
    const s = sum(sessTrades(R.sid)), open = acct().pos.filter(p => p.mode === 'replay').length;
    const html = !s.n
      ? `<span class="rj-lbl">${open ? `${open} open · ` : ''}No closed trades yet</span><span class="rj-ph">${open ? open + ' open' : '0 trades'}</span>`
      : `<span class="rj-n">${s.n}</span><span class="rj-lbl">${s.n === 1 ? 'trade' : 'trades'} · ${s.w}W ${s.l}L ·</span> <b class="${s.sumR > 0 || (!s.nR && s.net > 0) ? 'up' : 'down'}">${s.nR ? fr(s.sumR) : money(s.net, true)}</b>`;
    for (const b of tallies) { b.hidden = false; if (b.innerHTML !== html) b.innerHTML = html; }
  }

  // ---------------------------------------------------------------- result card (a trade closed) / summary (a replay ended)
  const main = $('.dk-chart');
  const card = document.createElement('div');
  card.className = 'rj-card'; card.hidden = true; card.setAttribute('role', 'status');
  if (main) main.appendChild(card);
  let cardT = null, hover = false;
  card.addEventListener('pointerenter', () => { hover = true; clearTimeout(cardT); });
  card.addEventListener('pointerleave', () => { hover = false; hideSoon(6000); });
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-rj]'); if (!b) return;
    if (b.dataset.rj === 'x') { card.hidden = true; return; }
    if (b.dataset.rj === 'stats') { card.hidden = true; openStats(b.dataset.scope || 'all'); }
  });
  function hideSoon(ms) { clearTimeout(cardT); cardT = setTimeout(() => { if (!hover) card.hidden = true; }, ms); }
  function showCard(html, tone, ms) {
    card.className = 'rj-card ' + tone; card.innerHTML = html; card.hidden = false;
    const tst = $('.dk-toast'); if (tst) tst.hidden = true;
    hideSoon(ms);
  }
  function onClosed(h) {
    const good = h.pnl > 0, label = `${coin(h.sym)} ${h.side === 1 ? 'long' : 'short'}${h.tf ? ' · ' + h.tf : ''}`;
    const best = moveFor(h), worst = moveAgainst(h);
    const s = h.mode === 'replay' && h.sid ? sum(sessTrades(h.sid)) : null;
    const lesson = h.why === 'Stop' && inR(h, best) >= 1 ? `It was ${fr(inR(h, best))} up before the stop.`
      : h.why === 'Target' && inR(h, worst) <= -0.8 ? `It came within ${fr(-inR(h, worst))} of the stop first.`
        : h.why === 'Closed' && h.tp && inR(h, best) != null ? `Best it got: ${fr(inR(h, best))}.` : '';
    showCard(`<div class="rj-h"><span class="rj-why">${ic(good ? 'circle-check' : 'circle-x', 'i-35')}${esc(whyTxt(h.why))}</span><span class="rj-what">${esc(label)}</span><button type="button" data-rj="x" aria-label="Close">${ic('x', 'i-35')}</button></div>
      <div class="rj-big"><b class="${good ? 'up' : 'down'}">${money(h.pnl, true)}</b>${h.r != null ? `<b class="${good ? 'up' : 'down'}">${fr(h.r)}</b>` : '<span class="rj-mut">no stop, so no R</span>'}</div>
      <div class="rj-line">${u.fp(h.entry)} → ${u.fp(h.exit)} · held ${h.t1 > h.t0 ? dur(h.t1 - h.t0) : 'under a minute'}${best != null ? ` · best ${showMove(h, best)} · worst ${showMove(h, worst == null ? null : -worst)}` : ''}</div>
      ${lesson ? `<div class="rj-line rj-mut">${esc(lesson)}</div>` : ''}
      <div class="rj-ft">${s ? `<span>This replay: ${s.n} ${s.n === 1 ? 'trade' : 'trades'} · ${s.w}W ${s.l}L · <b class="${s.sumR > 0 ? 'up' : 'down'}">${s.nR ? fr(s.sumR) : money(s.net, true)}</b></span>` : '<span></span>'}<button type="button" data-rj="stats" data-scope="${s ? 'sess' : 'all'}">Stats ${ic('chevron-right', 'i-3')}</button></div>`,
    good ? 'win' : 'loss', 9000);
    tally(); redraw(true); sync.soon(1500);
  }
  function summary(sid, ended) {
    const H = sessTrades(sid); if (!H.length) return;
    const s = sum(H), se = acct().sess.find(x => x.id === sid) || {};
    showCard(`<div class="rj-h"><span class="rj-why">${ic('target', 'i-35')}${ended ? 'Replay finished' : 'Replay restarted'}</span><span class="rj-what">${esc(se.sym ? coin(se.sym) + ' ' + (se.tf || '') : '')}${se.at ? ' from ' + esc(utcDay(se.at)) : ''}</span><button type="button" data-rj="x" aria-label="Close">${ic('x', 'i-35')}</button></div>
      <div class="rj-big"><b class="${s.net > 0 ? 'up' : 'down'}">${money(s.net, true)}</b>${s.nR ? `<b class="${s.sumR > 0 ? 'up' : 'down'}">${fr(s.sumR)}</b>` : ''}</div>
      <div class="rj-line">${s.n} ${s.n === 1 ? 'trade' : 'trades'} · ${s.w} won, ${s.l} lost (${(s.w / s.n * 100).toFixed(0)}%)${s.avgR != null ? ` · ${fr(s.avgR)} a trade` : ''}</div>
      <div class="rj-ft"><span class="rj-mut">Saved in your journal</span><button type="button" data-rj="stats" data-scope="all">Stats ${ic('chevron-right', 'i-3')}</button></div>`,
    s.net > 0 ? 'win' : 'loss', 15000);
  }

  // ---------------------------------------------------------------- Stats tab
  const F = Object.assign({ scope: 'all', range: 'all', sid: '' }, RD.store.get('rd-jr-v1', {}));
  const saveF = () => RD.store.set('rd-jr-v1', { scope: F.scope === 'pick' ? 'all' : F.scope, range: F.range });
  function openStats(scope) {
    F.scope = scope === 'sess' && R.sid ? 'pick' : scope; F.sid = scope === 'sess' ? R.sid : ''; saveF();
    RD.setBTab('stats');
    if (phone()) RD.openSheet('pos');
  }
  function picked() {
    let H = acct().hist;
    if (F.scope === 'replay') H = H.filter(h => h.mode === 'replay');
    else if (F.scope === 'live') H = H.filter(h => h.mode === 'live');
    else if (F.scope === 'pick') H = H.filter(h => h.sid === F.sid);
    if (F.range !== 'all') { const from = Date.now() - (+F.range) * DAYMS; H = H.filter(h => h.wt >= from); }
    return H;
  }
  // the last k trades (with a stop) against the k before; Welch t as the luck check
  function better(H) {
    const rs = oldestFirst(H).filter(h => h.r != null), n = rs.length;
    if (n < 10) return `<div class="rj-imp"><h4>Getting better?</h4><p class="rj-mut">Take ${10 - n} more ${10 - n === 1 ? 'trade' : 'trades'} with a stop and this compares your latest trades with the ones before.</p></div>`;
    const k = Math.min(20, Math.floor(n / 2)), a = rs.slice(n - 2 * k, n - k), b = rs.slice(n - k);
    const m = x => x.reduce((s, h) => s + h.r, 0) / x.length, v = (x, mu) => x.reduce((s, h) => s + (h.r - mu) ** 2, 0) / Math.max(1, x.length - 1);
    const ma = m(a), mb = m(b), se = Math.sqrt(v(a, ma) / k + v(b, mb) / k), t = se > 0 ? (mb - ma) / se : 0;
    const wa = a.filter(h => h.r > 0).length / k, wb = b.filter(h => h.r > 0).length / k;
    const d = mb - ma, verdict = d > 0.15 ? 'Better' : d < -0.15 ? 'Worse' : 'About the same', cls = d > 0.15 ? 'up' : d < -0.15 ? 'down' : '';
    const luck = verdict === 'About the same' ? '' : Math.abs(t) >= 2 ? ' — more than luck would usually give' : ` — but ${k} trades each is few: this could still be luck`;
    return `<div class="rj-imp"><h4>Getting better? <span class="rj-mut">your last ${k} trades against the ${k} before</span></h4>
      <div class="rj-cmp"><div><span>Average R</span><b>${fr(ma)} → <i class="${mb >= 0 ? 'up' : 'down'}">${fr(mb)}</i></b></div><div><span>Win rate</span><b>${(wa * 100).toFixed(0)}% → <i>${(wb * 100).toFixed(0)}%</i></b></div><div><span>Added up</span><b>${fr(ma * k)} → <i class="${mb >= 0 ? 'up' : 'down'}">${fr(mb * k)}</i></b></div></div>
      <p><b class="${cls}">${verdict}</b><span class="rj-mut">${esc(luck)}</span></p></div>`;
  }
  // R added up, trade by trade (oldest first); one series, hover for each trade
  let CURVE = [];
  function curve(H) {
    const rs = oldestFirst(H).filter(h => h.r != null);
    CURVE = [];
    if (rs.length < 2) return `<div class="rj-curve rj-empty"><h4>Your R, added up</h4><p class="rj-mut">${rs.length ? 'One trade so far.' : 'Trades with a stop show here as a line: up when you win, down when you lose.'}</p></div>`;
    let c = 0; for (const h of rs) { c += h.r; CURVE.push({ h, c }); }
    const ys = CURVE.map(p => p.c).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1, n = CURVE.length;
    const X0 = 0, X1 = 1000, Y0 = 8, Y1 = 152, xOf = i => X0 + (X1 - X0) * i / (n - 1), yOf = v => Y1 - (Y1 - Y0) * (v - lo) / span;
    const d = CURVE.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(p.c).toFixed(1)}`).join(''), z = yOf(0).toFixed(1);
    const last = CURVE[n - 1].c, skip = H.length - rs.length;
    return `<div class="rj-curve"><h4>Your R, added up <span class="rj-mut">${n} trades with a stop · now <b class="${last >= 0 ? 'up' : 'down'}">${fr(last)}</b>${skip ? ` · ${skip} without a stop left out` : ''}</span></h4>
      <div class="rj-plot"><div class="rj-yax"><span>${fr(hi)}</span><span>${fr(lo)}</span></div>
      <div class="rj-svgw" data-rj-plot><svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-label="R added up over ${n} trades, now ${esc(fr(last))}" role="img">
        <line x1="0" x2="1000" y1="${z}" y2="${z}" class="rj-zero"/><path d="${d}" class="rj-line2 ${last >= 0 ? 'up' : 'down'}"/></svg>
        <i class="rj-cross" hidden></i><i class="rj-dot" hidden></i><div class="rj-tip" hidden></div></div></div>
      <div class="rj-xax"><span>trade 1</span><span>${n}</span></div></div>`;
  }
  function split(title, groups) {
    const rows = groups.filter(g => g.H.length).map(g => { const s = sum(g.H); return `<tr><td>${esc(g.k)}</td><td>${s.n}</td><td>${(s.w / s.n * 100).toFixed(0)}%</td><td class="${(s.avgR || 0) >= 0 ? 'up' : 'down'}">${s.avgR == null ? '—' : fr(s.avgR)}</td><td class="${s.net >= 0 ? 'up' : 'down'}">${money(s.net, true)}</td></tr>`; }).join('');
    return rows ? `<div class="rj-split"><h4>${esc(title)}</h4><table><thead><tr><th></th><th>Trades</th><th>Won</th><th>Avg R</th><th>P&amp;L</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
  }
  const groupBy = (H, key, top) => { const m = new Map(); for (const h of H) { const k = key(h); if (!m.has(k)) m.set(k, []); m.get(k).push(h); } return [...m].sort((a, b) => b[1].length - a[1].length).slice(0, top || 99).map(([k, H2]) => ({ k, H: H2 })); };
  function facts(H) {
    const out = [], noStop = H.filter(h => h.r == null).length, losers = H.filter(h => h.pnl <= 0 && h.r != null);
    if (noStop) out.push(`${noStop} of ${H.length} trades had no stop — nothing capped their loss, and they have no R.`);
    const upFirst = losers.filter(h => inR(h, moveFor(h)) >= 1).length;
    if (losers.length >= 3) out.push(`${upFirst} of ${losers.length} losing trades were at least +1R up at some point before they lost.`);
    const tg = H.filter(h => h.why === 'Target' && h.r != null), near = tg.filter(h => inR(h, moveAgainst(h)) <= -0.8).length;
    if (tg.length >= 3) out.push(`${near} of ${tg.length} target hits first came within 0.2R of the stop.`);
    const byHand = H.filter(h => h.why === 'Closed' && h.r != null);
    if (byHand.length >= 3) { const s = sum(byHand); out.push(`Closed by hand: ${byHand.length} trades, ${fr(s.avgR)} a trade on average.`); }
    const W = H.filter(h => h.pnl > 0 && h.t1 > h.t0), L = H.filter(h => h.pnl <= 0 && h.t1 > h.t0);
    if (W.length >= 3 && L.length >= 3) { const av = a => a.reduce((s, h) => s + (h.t1 - h.t0), 0) / a.length; out.push(`Winners were held ${dur(av(W))} on average, losers ${dur(av(L))}.`); }
    return out.length ? `<div class="rj-facts"><h4>From your trades</h4><ul>${out.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  }
  function sessions() {
    const a = acct(), by = new Map();
    for (const h of a.hist) if (h.sid) { if (!by.has(h.sid)) by.set(h.sid, []); by.get(h.sid).push(h); }
    const list = a.sess.filter(s => by.has(s.id) || s.id === R.sid).slice(0, 40);
    if (!list.length) return '';
    return `<div class="rj-sess"><h4>Replay sessions <span class="rj-mut">click one to see only its trades</span></h4><table><thead><tr><th>Played</th><th>Chart</th><th>Replay from</th><th>Trades</th><th>Won</th><th>R</th><th>P&amp;L</th></tr></thead><tbody>${list.map(se => {
      const H = by.get(se.id) || [], s = sum(H), on = F.scope === 'pick' && F.sid === se.id;
      return `<tr data-rj-sid="${esc(se.id)}" class="${on ? 'on' : ''}"><td>${esc(dayT(se.wt))}${se.id === R.sid ? ' <em class="rj-now">now</em>' : ''}</td><td>${esc(se.sym ? coin(se.sym) : '')} ${esc(se.tf || '')}</td><td class="rj-mut">${se.at ? esc(utcDay(se.at)) : '—'}</td><td>${s.n}</td><td>${s.n ? (s.w / s.n * 100).toFixed(0) + '%' : '—'}</td><td class="${s.sumR >= 0 ? 'up' : 'down'}">${s.nR ? fr(s.sumR) : '—'}</td><td class="${s.net >= 0 ? 'up' : 'down'}">${s.n ? money(s.net, true) : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  let lastKey = '';
  X.bottom.stats = soft => {
    const a = acct(), key = JSON.stringify([F, a.hist.length, a.hist[0] && a.hist[0].uid, R.sid, a.sess.length, sync.state()]);
    if (soft && key === lastKey) return null;
    lastKey = key;
    const H = picked(), s = sum(H), chip = (k, v, t) => `<button type="button" data-rjf="${k}" data-v="${v}" class="${F[k] === v || (k === 'scope' && v === 'pick' && F.scope === 'pick') ? 'on' : ''}">${t}</button>`;
    const pickSe = F.scope === 'pick' ? a.sess.find(x => x.id === F.sid) : null;
    const bar = `<div class="rj-bar"><span class="rj-seg">${chip('scope', 'all', 'All')}${chip('scope', 'replay', 'Replay')}${chip('scope', 'live', 'Live')}${R.sid ? `<button type="button" data-rjf="scope" data-v="sess" class="${F.scope === 'pick' && F.sid === R.sid ? 'on' : ''}">This replay</button>` : ''}</span>
      <span class="rj-seg">${chip('range', 'all', 'All time')}${chip('range', '30', '30 days')}${chip('range', '7', '7 days')}</span>
      ${pickSe && F.sid !== R.sid ? `<span class="rj-pick">Session ${esc(dayT(pickSe.wt))} · ${esc(pickSe.sym ? coin(pickSe.sym) : '')} <button type="button" data-rjf="scope" data-v="all" aria-label="Show all">${ic('x', 'i-3')}</button></span>` : ''}
      <span class="rj-sync">${esc(sync.label())}</span></div>`;
    if (!H.length) return bar + `<div class="pt-empty">${a.hist.length ? 'No closed trades in this view.' : 'Closed paper trades land here: your results, your R added up, and whether your latest trades beat your earlier ones.'}</div>`;
    const dd = (() => { let c = 0, top = 0, m = 0; for (const h of oldestFirst(H)) if (h.r != null) { c += h.r; top = Math.max(top, c); m = Math.min(m, c - top); } return m; })();
    const streak = (() => { let c = 0, m = 0; for (const h of oldestFirst(H)) { c = h.pnl <= 0 ? c + 1 : 0; m = Math.max(m, c); } return m; })();
    const tiles = [['Trades', `${s.n}`, '', `${s.w} won · ${s.l} lost`], ['Win rate', `${(s.w / s.n * 100).toFixed(0)}%`, '', ''], ['Net P&L', money(s.net, true), s.net >= 0 ? 'up' : 'down', ''],
      ['R a trade', s.avgR == null ? '—' : fr(s.avgR), (s.avgR || 0) >= 0 ? 'up' : 'down', s.nR < s.n ? `${s.nR} with a stop` : ''], ['Profit factor', s.pf == null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2), '', 'won $ ÷ lost $'],
      ['Average win', s.avgW == null ? '—' : fr(s.avgW), s.avgW != null ? 'up' : '', 'in R'], ['Average loss', s.avgL == null ? '—' : fr(s.avgL), s.avgL != null ? 'down' : '', 'in R'], ['Deepest dip', s.nR ? fr(dd) : '—', dd < 0 ? 'down' : '', 'R from the best point'], ['Losses in a row', String(streak), '', 'longest run']];
    return bar + `<div class="stats2 rj-tiles">${tiles.map(([k, v, c, sub]) => `<div><span>${k}</span><b class="${c}">${v}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('')}</div>` +
      `<div class="rj-grid">${curve(H)}${better(H)}</div>` + sessions() +
      `<div class="rj-splits">${split('Long / short', [{ k: 'Long', H: H.filter(h => h.side === 1) }, { k: 'Short', H: H.filter(h => h.side === -1) }])}${split('How it ended', groupBy(H, h => whyTxt(h.why)))}${split('Coin', groupBy(H, h => coin(h.sym), 8))}${split('Timeframe', groupBy(H, h => h.tf || '?'))}</div>` +
      facts(H) + (s.n < 30 ? '<p class="rj-note">Fewer than 30 trades says little — keep practising before you trust these numbers.</p>' : '');
  };
  const body = $('[data-bbody]');
  if (body) {
    body.addEventListener('click', e => {
      const f = e.target.closest('[data-rjf]');
      if (f) { if (f.dataset.rjf === 'scope' && f.dataset.v === 'sess') { F.scope = 'pick'; F.sid = R.sid; } else { F[f.dataset.rjf] = f.dataset.v; if (f.dataset.rjf === 'scope') F.sid = ''; } saveF(); RD.renderBottom(); return; }
      const r = e.target.closest('[data-rj-sid]');
      if (r) { const id = r.dataset.rjSid; if (F.scope === 'pick' && F.sid === id) { F.scope = 'all'; F.sid = ''; } else { F.scope = 'pick'; F.sid = id; } saveF(); RD.renderBottom(); body.scrollTop = 0; }
    });
    const tipAt = e => {
      const w = e.target.closest && e.target.closest('[data-rj-plot]'); if (!w || CURVE.length < 2) return;
      const rc = w.getBoundingClientRect(), n = CURVE.length, i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - rc.left) / rc.width * (n - 1))));
      const p = CURVE[i], ys = CURVE.map(q => q.c).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
      const xf = i / (n - 1), yf = (8 + (152 - 8) * (1 - (p.c - lo) / span)) / 160;
      const cr = $('.rj-cross', w), dot = $('.rj-dot', w), tip = $('.rj-tip', w);
      cr.hidden = dot.hidden = tip.hidden = false;
      cr.style.left = (xf * 100) + '%'; dot.style.left = (xf * 100) + '%'; dot.style.top = (yf * 100) + '%';
      dot.className = 'rj-dot ' + (p.h.r > 0 ? 'up' : 'down');
      tip.innerHTML = `<b>Trade ${i + 1}</b> · ${esc(coin(p.h.sym))} ${p.h.side === 1 ? 'long' : 'short'}${p.h.tf ? ' ' + esc(p.h.tf) : ''}<br><span class="${p.h.r > 0 ? 'up' : 'down'}">${fr(p.h.r)}</span> · ${esc(whyTxt(p.h.why))}<br>Added up: <b>${fr(p.c)}</b><br><span class="rj-mut">${p.h.mode === 'replay' ? 'replay ' + esc(day(p.h.t1)) + ', ' : ''}played ${esc(dayT(p.h.wt > 1e12 ? p.h.wt : p.h.t1))}</span>`;
      // beside the point, on the side with room, never past the plot's edges
      const x = xf * rc.width, tw = tip.offsetWidth, room = x + 12 + tw <= rc.width;
      tip.style.right = ''; tip.style.left = Math.max(0, Math.min(rc.width - tw, room ? x + 12 : x - 12 - tw)) + 'px';
    };
    body.addEventListener('pointermove', tipAt);
    body.addEventListener('pointerdown', tipAt);
    body.addEventListener('pointerleave', () => { for (const el of body.querySelectorAll('.rj-cross, .rj-dot, .rj-tip')) el.hidden = true; }, true);
  }

  // ---------------------------------------------------------------- saved to the account
  const sync = (() => {
    const SY = { on: null, busy: false, again: false, t: null, err: '', at: 0, sessDirty: false };
    const URL_ = '/api/site/paper';
    const newest = (a, b) => (b.wt || 0) - (a.wt || 0) || (b.t1 || 0) - (a.t1 || 0);
    function merge(a, d) {
      const have = new Set(a.hist.map(h => h.uid)); let added = 0;
      for (const t of d.trades || []) if (t && t.uid && !have.has(t.uid)) { a.hist.push(t); have.add(t.uid); added++; }
      if (added) { a.hist.sort(newest); if (a.hist.length > AC.HIST_MAX) for (const x of a.hist.splice(AC.HIST_MAX)) a.trim += +x.pnl || 0; }
      const ss = new Map(); for (const x of a.sess.concat(d.sess || [])) if (x && x.id && !ss.has(x.id)) ss.set(x.id, x);
      a.sess = [...ss.values()].sort((x, y) => (y.wt || 0) - (x.wt || 0)).slice(0, 300);
      if (+d.start > 0) a.start = +d.start;
      a.bal = AC.bal(a);
      return added;
    }
    function adopt(d) {   // the account was reset in another browser: start over from the server's journal
      const a = AC.fresh(); a.epoch = d.epoch; a.start = +d.start > 0 ? +d.start : a.start; a.bal = a.start;
      merge(a, d); AC.set(a);
      RD.toast('Your paper account was reset in another browser — this one now shows the same journal.');
      after();
    }
    function after() { tally(); redraw(true); RD.renderBottom(); }
    async function start() {
      let r;
      try { r = await fetch(URL_, { cache: 'no-store', credentials: 'same-origin' }); } catch (e) { SY.err = 'offline'; return; }
      if (r.status === 401 || r.status === 403) { SY.on = false; RD.renderBottom(); return; }
      if (!r.ok) { SY.err = 'server'; return; }
      const d = await r.json(), a = acct();
      SY.on = true;
      if (a.resetPending) { /* sent below */ }
      else if (!a.epoch) {   // first time in this browser: join the account's journal (or start it) and send what is here
        const srv = new Set((d.trades || []).map(t => t.uid));
        a.epoch = d.epoch || AC.newId();
        if (d.epoch) merge(a, d);
        a.unsent = a.hist.filter(h => !srv.has(h.uid)).map(h => h.uid);
      } else if (!d.epoch) a.unsent = a.hist.map(h => h.uid);   // nothing on the server yet
      else if (d.epoch !== a.epoch) { adopt(d); return; }
      else merge(a, d);
      SY.sessDirty = true;
      AC.saveNow(); AC.changed(); after();
      push();
    }
    async function push(leaving) {
      if (!SY.on) return;
      if (SY.busy) { SY.again = true; return; }
      const a = acct(); if (!a.epoch) return;
      const byUid = new Map(a.hist.map(h => [h.uid, h]));
      a.unsent = a.unsent.filter(x => byUid.has(x));
      const ids = a.unsent.slice(0, leaving ? 60 : 400);
      if (!ids.length && !a.resetPending && !SY.sessDirty) return;
      const reset = !!a.resetPending, body = { epoch: a.epoch, start: a.start, reset, sess: a.sess.slice(0, 60), trades: ids.map(x => byUid.get(x)) };
      SY.busy = true; let wait = 0;
      try {
        const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), keepalive: !!leaving });
        if (r.status === 409) { adopt(await r.json()); }
        else if (r.ok) {
          if (acct() === a) { const sent = new Set(ids); a.unsent = a.unsent.filter(x => !sent.has(x)); if (reset) a.resetPending = false; AC.saveNow(); }
          SY.err = ''; SY.at = Date.now(); SY.sessDirty = false;
        } else if (r.status === 401) SY.on = false;
        else { SY.err = 'server'; wait = 30000; }
      } catch (e) { SY.err = 'offline'; wait = 30000; } finally { SY.busy = false; }
      if (SY.again || acct().unsent.length || acct().resetPending) { SY.again = false; soon(wait || 3000); }
      RD.renderBottom();
    }
    function soon(ms) { clearTimeout(SY.t); SY.t = setTimeout(() => push(), ms); }
    return {
      start, push, soon,
      state: () => [SY.on, SY.err, acct().unsent.length].join(','),
      label: () => (SY.on === false ? 'Saved in this browser only' : SY.on ? (SY.err ? 'Saving paused — will retry' : acct().unsent.length ? 'Saving…' : 'Saved to your account') : ''),
      on: () => SY.on,
      dirtySess: () => { SY.sessDirty = true; },
    };
  })();
  X.acctNote = () => (sync.on() ? 'Practice money. Closed trades are saved to your account (any browser); open ones stay in this browser.' : 'Practice money only, saved in this browser.');

  // ---------------------------------------------------------------- events
  let curSid = R.sid || null;
  RD.on('closed', onClosed);
  RD.on('session', sid => { if (curSid && curSid !== sid) summary(curSid, false); curSid = sid; sync.dirtySess(); sync.soon(2500); tally(); redraw(true); });
  RD.on('mode', () => { if (!R.on && curSid) { summary(curSid, true); curSid = null; } else if (R.on) curSid = R.sid; tally(); redraw(true); });
  RD.on('reset', () => { lastKey = ''; tally(); redraw(true); sync.soon(100); });
  RD.on('hide', () => { if (acct().unsent.length || acct().resetPending) sync.push(true); });
  RD.on('load', () => redraw(true));
  RD.on('tick', () => { redraw(false); tally(); });
  tally(); redraw(true);
  sync.start();
  RD.journal = { sync, F, openStats, sum };   // tests
})();
