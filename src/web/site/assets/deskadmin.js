/* ReplayDesk admin layer (/app, admins only; loads after desk.js and uses its window.__rd handles).
   Real trades go through the bot with the same endpoints and bot functions as the classic Simulator's Real ticket
   (src/web/tradeApi.js → telegramBot webTrade: the /long · /short panel builder, executeManual, the /mpositions buttons):
   - Real tab: the order ticket; the bot previews its exact order as you type (places nothing), you review it in a dialog
     and confirm; or send it to the Telegram panel and tap ✅ there
   - Real bottom tab + chart: the bot's live positions and limit orders; stop / TP / limit lines can be dragged, every
     change is confirmed in a dialog first; close, breakeven, take 25/50/75 %, cancel
   - Signals tab: recent pump signals and the bot's trades — open the chart, or replay from the signal / entry
   - Positioning card: funding, whales vs retail, open interest for the coin on the chart
   Every write carries a one-time request id (a double click is refused by the server) and the bot reports it in Telegram. */
(() => {
  'use strict';
  const RD = window.__rd, rx = document.querySelector('[data-rx]');
  if (!RD || !rx) return;
  const { fp, money, pct, esc, coin, tshort, num, ic, phone } = RD.util;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const MIN = 60e3, DAY = 864e5;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const base = s => String(s || '').toUpperCase().replace(/USDT$/, '');
  const pair = s => base(s) + 'USDT';
  const exOf = e => (/bybit/i.test(e || '') ? 'bybit' : 'binance');
  const onChart = s => pair(s) === RD.U.sym;
  const sgn = v => money(v, true);
  const ago = t => { const m = Math.round((Date.now() - t) / MIN); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago' : Math.floor(m / 1440) + 'd ago'; };
  const age = t => { const m = Math.max(0, Math.round((Date.now() - t) / MIN)); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : Math.floor(m / 1440) + 'd ' + (Math.floor(m / 60) % 24) + 'h'; };
  // prices from the bot: the chart's precision for the coin on the chart, otherwise by size
  const fmtP = v => { if (v == null || !isFinite(v)) return '—'; const d = Math.max(2, Math.min(8, 4 - Math.floor(Math.log10(Math.abs(+v) || 1)))); return (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d }); };
  const px = (v, sym) => (sym && onChart(sym) ? fp(v) : fmtP(v));
  const mv = (dir, entry, v) => (dir === 'long' ? v - entry : entry - v) / entry;   // move in our favour, as a fraction
  const fromE = (v, e) => pct((v / e - 1) * 100);
  const nonce = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  const firstLines = t => String(t || '').split('\n').filter(Boolean).slice(0, 2).join(' · ').slice(0, 220);

  // ------------------------------------------------------------------ the bot's API (same origin, admin session)
  async function call(path, body, ms = 20000) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: ac.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
      if (!r.ok) {
        const er = new Error((j && (j.error || (j.errors && j.errors[0]))) || (r.status === 401 ? 'Your admin session ended — sign in again.' : 'HTTP ' + r.status));
        er.status = r.status; er.data = j; throw er;
      }
      return j || {};
    } catch (e) {
      if (e.name === 'AbortError') { const er = new Error('The bot did not answer in time. Check Telegram before you try again — it may have gone through.'); er.timeout = true; throw er; }
      throw e;
    } finally { clearTimeout(to); }
  }

  // a write with a fresh request id. The server spaces writes 2 s apart (Telegram panels 3 s) and refuses a too-early one
  // before it does anything, so that refusal is retried once, with a new id, after the gap.
  async function write(path, b, ms) {
    try { return await call(path, Object.assign({}, b, { nonce: nonce() }), ms); } catch (e) {
      if (e.status !== 429) throw e;
      await new Promise(r => setTimeout(r, 3100));
      return call(path, Object.assign({}, b, { nonce: nonce() }), ms);
    }
  }

  // ------------------------------------------------------------------ confirm dialog (every real-money write goes through it)
  const xm = $('[data-xmodal]'), xb = $('[data-xbox]');
  let XC = null;
  // o: { title, tone: up|down|warn, html, ok (button label; none = information only), run: async () => message, after(), cancel() }
  function ask(o) {
    XC = o; o.busy = false; o.done = false;
    xb.innerHTML = `<div class="xh ${o.tone || ''}"><h2>${o.title}</h2><button type="button" class="dk-ib" data-act="close-modal" aria-label="Close">${ic('x')}</button></div>
      <div class="xbody">${o.html}</div><p class="xerr" data-xerr role="alert" hidden></p>
      <div class="xbtns"><button type="button" class="btn btn-ghost" data-xno>${o.ok ? 'Cancel' : 'Close'}</button>${o.ok ? `<button type="button" class="xgo ${o.tone || ''}" data-xok>${o.ok}</button>` : ''}</div>`;
    RD.openModal(xm);
    const no = xb.querySelector('[data-xno]'); if (no) no.focus();   // never the confirm button: Enter must not place an order
  }
  new MutationObserver(() => {   // closed with Cancel, Esc or the backdrop: undo what the dialog was about (a dragged line)
    if (xm.hidden && XC && !XC.done && !XC.busy) { const c = XC; XC = null; if (c.cancel) c.cancel(); }
  }).observe(xm, { attributes: true, attributeFilter: ['hidden'] });
  xb.addEventListener('click', async e => {
    if (e.target.closest('[data-xno]')) { RD.closeModals(); return; }
    const pick = e.target.closest('[data-xpct]');
    if (pick && XC && XC.onPick) { $$('[data-xpct]', xb).forEach(b => b.classList.toggle('on', b === pick)); XC.onPick(+pick.dataset.xpct); return; }
    const okb = e.target.closest('[data-xok]'); if (!okb || !XC || XC.busy) return;
    const c = XC; c.busy = true; okb.disabled = true; okb.innerHTML = '<span class="spin-s"></span> Sending to the bot…';
    const err = xb.querySelector('[data-xerr]'); err.hidden = true;
    try {
      const msg = await c.run();
      c.done = true; c.busy = false;
      if (XC === c) { XC = null; RD.closeModals(); }
      if (msg) RD.toast(msg, 'up');
      if (c.after) c.after(true);
    } catch (er) {
      c.busy = false;
      if (XC !== c || xm.hidden) { RD.toast('Not done: ' + er.message, 'down'); if (c.cancel) c.cancel(); return; }
      err.textContent = er.message; err.hidden = false;
      if (er.timeout) { okb.innerHTML = 'Check Telegram'; return; }   // may have gone through: no blind retry
      okb.disabled = false; okb.innerHTML = c.ok;
    }
  });
  const kv = rows => `<dl class="xkv">${rows.filter(Boolean).map(([k, v, c]) => `<dt>${k}</dt><dd${c ? ` class="${c}"` : ''}>${v}</dd>`).join('')}</dl>`;

  // ------------------------------------------------------------------ the bot's live positions and limit orders
  const L = { d: null, at: 0, err: null, web: null, busy: false, pend: {} };   // pend: line key → price while its move is confirmed
  async function poll(fresh) {
    if (L.busy || (document.hidden && !fresh)) return;
    L.busy = true;
    try { const d = await call('/api/trade/positions' + (fresh ? '?fresh=1' : '')); L.d = d; L.web = !!d.webTrading; L.err = null; L.at = Date.now(); } catch (e) { L.err = e.message; }
    finally { L.busy = false; paint(); }
  }
  const markOf = p => (!RD.R.on && onChart(p.symbol) && exOf(p.exchange) === RD.U.ex && RD.S.lastPx ? RD.S.lastPx : p.price);
  function live(p) {   // P&L at the freshest price we have (the chart's stream for the coin on the chart)
    const m = markOf(p);
    if (!m || !p.entry) return { m: m || null, pnl: p.pnl, mvPct: p.pct };
    const f = mv(p.direction, p.entry, m);
    return { m, pnl: (+p.size || 0) * f + (+p.realized || 0), mvPct: f * 100 };
  }
  // the bot's TP ladder: each TP closes a share of what is still open (TP1, TP2 from the executor, TP3 half, TP4 the rest)
  function ladder(dir, entry, size, realized, tps, fr) {
    fr = Array.isArray(fr) && fr.length ? fr : [0.33, 0.5, 0.5, 1];
    let left = size, bank = realized || 0; const out = [];
    for (const tp of tps || []) {
      if (tp.hit || !(tp.price > 0) || left <= 1e-9) continue;
      const f = Math.min(1, fr[tp.n - 1] != null ? fr[tp.n - 1] : 1), q = tp.n >= 4 ? left : left * f, book = q * mv(dir, entry, tp.price);
      bank += book; left -= q;
      out.push({ n: tp.n, price: tp.price, q, share: size > 0 ? q / size : 0, book, bank, left, total: bank + left * mv(dir, entry, tp.price) });
    }
    return out;
  }
  const kindTag = k => { const s = String(k || 'bot'); return `<span class="rx-tag">${esc(s === 'auto pump' ? 'Auto pump' : s.charAt(0).toUpperCase() + s.slice(1))}</span>`; };
  const sideTag = dir => `<span class="sd ${dir === 'long' ? 'up' : 'down'}">${dir === 'long' ? 'LONG' : 'SHORT'}</span>`;
  const offTitle = 'Web trading is off — send /webtrade on in Telegram to manage from here';

  RD.ext.bottom.real = () => {
    const d = L.d;
    if (!d) return `<div class="pt-empty">${L.err ? `Could not reach the bot: ${esc(L.err)}` : "Loading the bot's live positions…"}</div>`;
    const P = d.positions || [], O = d.orders || [], web = L.web;
    const rows = P.map(p => Object.assign({ p }, live(p)));
    const tot = rows.reduce((s, r) => s + (r.pnl || 0), 0), bank = P.reduce((s, p) => s + (+p.realized || 0), 0);
    const dis = web ? '' : ` disabled title="${offTitle}"`;
    let h = `<div class="rxb-bar"><span class="rxb-k"><em>Open P&amp;L</em><b class="${tot >= 0 ? 'up' : 'down'}">${sgn(tot)}</b></span>
      <span class="rxb-k"><em>Banked on open trades</em><b>${sgn(bank)}</b></span><span class="rxb-k"><em>Positions</em><b>${P.length}</b></span><span class="rxb-k"><em>Limit orders</em><b>${O.length}</b></span>
      <span class="rxb-wt ${web ? 'on' : ''}"><i></i><span>${web ? 'Web trading on' : 'View only — send <code>/webtrade on</code> in Telegram to manage from here'}</span></span>
      <span class="rxb-r"><span class="muted" title="${L.at ? new Date(L.at).toUTCString() : ''}">${L.err ? `<span class="down">${esc(L.err)}</span>` : L.at ? 'Updated ' + ago(L.at) : ''}</span>
      <button type="button" class="rxb-btn" data-act="rx-fresh" title="Reload, and ask the exchange about orders on its book">${ic('refresh-cw')} Check exchange</button></span></div>`;
    if (!P.length && !O.length) return h + '<div class="pt-empty">No live positions or limit orders. Place one from the Real tab, or let the bot trade.</div>';
    if (P.length) {
      h += `<table class="pt rxt"><thead><tr><th>Position</th><th>Size</th><th>Entry</th><th>Mark</th><th>P&amp;L</th><th>Stop</th><th>Take profits</th><th></th></tr></thead><tbody>${rows.map(({ p, m, pnl, mvPct }) => {
        const S = p.symbol, stopPnl = p.stop ? (+p.size || 0) * mv(p.direction, p.entry, p.stop) + (+p.realized || 0) : null;
        const tps = (p.tps || []).map(t => t.hit ? `<span class="tpc hit" title="TP${t.n} hit">TP${t.n} ✓</span>`
          : `<button type="button" class="tpc" data-rxe="tp${t.n}" data-id="${p.id}"${dis} title="${web ? 'Move TP' + t.n : offTitle}">TP${t.n} ${px(t.price, S)}</button>`).join('');
        return `<tr data-rxgo="${esc(pair(S))}|${exOf(p.exchange)}"><td>${sideTag(p.direction)}<b>${esc(base(S))}</b> <span class="muted">${p.leverage}×</span> ${kindTag(p.kind)}<div class="sub">${esc(p.exchange || '')} · open ${age(p.opened)}${p.atBreakeven ? ' · stop at entry' : ''}</div></td>
          <td>${money(+p.size)}<div class="sub">margin ${money(+p.margin)}</div></td><td>${px(p.entry, S)}</td><td>${px(m, S)}</td>
          <td class="${(pnl || 0) >= 0 ? 'up' : 'down'}">${pnl == null ? '—' : sgn(pnl)}<div class="sub">${pct(mvPct)}${p.realized ? ' · banked ' + sgn(+p.realized) : ''}</div></td>
          <td><button type="button" class="rx-ed down" data-rxe="stop" data-id="${p.id}"${dis} title="${web ? 'Move the stop' : offTitle}">${p.stop ? px(p.stop, S) : 'add'}</button><div class="sub">${stopPnl != null ? 'if hit ' + sgn(stopPnl) : ''}</div></td>
          <td><div class="tps">${tps || '<span class="muted">—</span>'}</div></td>
          <td><span class="acts"><button type="button" data-rxa="be" data-id="${p.id}"${dis}>Breakeven</button><button type="button" data-rxa="take" data-id="${p.id}"${dis}>Take…</button><button type="button" class="x" data-rxa="close" data-id="${p.id}"${dis}>Close</button></span></td></tr>`;
      }).join('')}</tbody></table>`;
    }
    if (O.length) {
      h += `<div class="rxt-h">Limit orders</div><table class="pt rxt"><thead><tr><th>Order</th><th>Limit</th><th>Price now</th><th>Size</th><th>Stop</th><th>TP1</th><th>Where</th><th></th></tr></thead><tbody>${O.map(o => {
        const S = o.symbol, away = o.price ? Math.abs(o.limitPrice / o.price - 1) * 100 : null, ex = o.onExchange;
        return `<tr data-rxgo="${esc(pair(S))}|${exOf(o.exchange)}"><td>${sideTag(o.direction)}<b>${esc(base(S))}</b> <span class="muted">${o.leverage}×</span><div class="sub">${esc(o.exchange || '')}${o.expiresAt ? ' · expires ' + tshort(o.expiresAt) : ''}</div></td>
          <td><button type="button" class="rx-ed" data-rxe="limit" data-id="${o.id}"${dis}>${px(o.limitPrice, S)}</button></td><td>${px(o.price, S)}<div class="sub">${away != null ? away.toFixed(2) + '% away' : ''}</div></td>
          <td>${money((+o.margin || 0) * (+o.leverage || 0))}<div class="sub">margin ${money(+o.margin)}</div></td>
          <td><button type="button" class="rx-ed down" data-rxe="ostop" data-id="${o.id}"${dis}>${o.stop ? px(o.stop, S) : 'add'}</button></td>
          <td><button type="button" class="rx-ed up" data-rxe="otp" data-id="${o.id}"${dis}>${o.tp1 ? px(o.tp1, S) : 'add'}</button></td>
          <td>${o.onBook ? 'On the order book' : 'Bot watches the price'}${ex ? `<div class="sub">${ex.error ? 'exchange: ' + esc(ex.error) : 'exchange: ' + esc(ex.status || '?') + (ex.filled ? ` · filled ${ex.filled}/${ex.amount}` : '')}</div>` : ''}</td>
          <td><span class="acts"><button type="button" class="x" data-rxa="cancel" data-id="${o.id}"${dis}>Cancel</button></span></td></tr>`;
      }).join('')}</tbody></table>`;
    }
    h += `<div class="p-cards">${rows.map(({ p, m, pnl, mvPct }) => `<div class="pc rxc"><div class="pc-h" data-rxgo="${esc(pair(p.symbol))}|${exOf(p.exchange)}"><span>${sideTag(p.direction)}<b>${esc(base(p.symbol))}</b> <span class="muted">${p.leverage}×</span> ${kindTag(p.kind)}</span><span class="pc-pnl ${(pnl || 0) >= 0 ? 'up' : 'down'}">${pnl == null ? '—' : sgn(pnl)}</span></div>
        <dl><div><dt>Entry</dt><dd>${px(p.entry, p.symbol)}</dd></div><div><dt>Mark</dt><dd>${px(m, p.symbol)}</dd></div><div><dt>Move</dt><dd class="${(mvPct || 0) >= 0 ? 'up' : 'down'}">${pct(mvPct)}</dd></div>
        <div><dt>Stop</dt><dd><button type="button" class="rx-ed down" data-rxe="stop" data-id="${p.id}"${dis}>${p.stop ? px(p.stop, p.symbol) : 'add'}</button></dd></div><div><dt>Size</dt><dd>${money(+p.size)}</dd></div><div><dt>Open</dt><dd>${age(p.opened)}</dd></div></dl>
        <div class="tps">${(p.tps || []).map(t => t.hit ? `<span class="tpc hit">TP${t.n} ✓</span>` : `<button type="button" class="tpc" data-rxe="tp${t.n}" data-id="${p.id}"${dis}>TP${t.n} ${px(t.price, p.symbol)}</button>`).join('')}</div>
        <div class="acts"><button type="button" data-rxa="be" data-id="${p.id}"${dis}>Breakeven</button><button type="button" data-rxa="take" data-id="${p.id}"${dis}>Take…</button><button type="button" class="x" data-rxa="close" data-id="${p.id}"${dis}>Close</button></div></div>`).join('')}
      ${O.length ? '<div class="rxt-h">Limit orders</div>' : ''}${O.map(o => `<div class="pc rxc"><div class="pc-h" data-rxgo="${esc(pair(o.symbol))}|${exOf(o.exchange)}"><span>${sideTag(o.direction)}<b>${esc(base(o.symbol))}</b> limit</span><b class="mono">${px(o.limitPrice, o.symbol)}</b></div>
        <dl><div><dt>Now</dt><dd>${px(o.price, o.symbol)}</dd></div><div><dt>Stop</dt><dd><button type="button" class="rx-ed down" data-rxe="ostop" data-id="${o.id}"${dis}>${o.stop ? px(o.stop, o.symbol) : 'add'}</button></dd></div><div><dt>TP1</dt><dd><button type="button" class="rx-ed up" data-rxe="otp" data-id="${o.id}"${dis}>${o.tp1 ? px(o.tp1, o.symbol) : 'add'}</button></dd></div></dl>
        <div class="acts"><button type="button" data-rxe="limit" data-id="${o.id}"${dis}>Move limit</button><button type="button" class="x" data-rxa="cancel" data-id="${o.id}"${dis}>Cancel</button></div></div>`).join('')}</div>`;
    return h;
  };

  // ------------------------------------------------------------------ managing a position / order (always confirmed)
  const posById = id => ((L.d && L.d.positions) || []).find(p => p.id === id);
  const ordById = id => ((L.d && L.d.orders) || []).find(o => o.id === id);
  const manage = a => write('/api/trade/manage', a, 60000).then(r => firstLines(r.text) || 'Done — Telegram has the details.');
  // after a confirmed change: reload once the poll in flight is done; a dragged line keeps its new price until then
  const settle = key => () => { const go = () => (L.busy ? setTimeout(go, 250) : poll(true).then(() => { if (key) { delete L.pend[key]; RD.syncLines(); } })); go(); };
  const unpend = key => () => { delete L.pend[key]; RD.syncLines(); };
  const head = p => `${sideTag(p.direction)}<b>${esc(base(p.symbol))}</b> · ${esc(p.exchange || '')} · ${p.leverage}×`;

  function askStop(p, v, key) {
    const L2 = p.direction === 'long', m = live(p).m;
    if (m && (L2 ? v >= m : v <= m)) { RD.toast(`A ${p.direction}'s stop has to be ${L2 ? 'below' : 'above'} the price now (${px(m, p.symbol)}).`, 'down'); if (key) unpend(key)(); return; }
    const at = (+p.size || 0) * mv(p.direction, p.entry, v) + (+p.realized || 0);
    ask({ title: 'Move the stop', tone: 'warn', ok: 'Move stop', html: `<p class="xlead">${head(p)}</p>${kv([['Stop now', px(p.stop, p.symbol)], ['New stop', `<b>${px(v, p.symbol)}</b> · ${fromE(v, p.entry)} from entry`],
      ['If it fills', sgn(at), at >= 0 ? 'up' : 'down'], ['Price now', px(m, p.symbol)]])}<p class="xnote">Placed on the exchange first; if the exchange refuses it, the old stop stays.</p>`,
      run: () => manage({ action: 'stop', id: p.id, price: v }), after: settle(key), cancel: key && unpend(key) });
  }
  function askTp(p, n, v, key) {
    const L2 = p.direction === 'long', m = live(p).m;
    if (m && (L2 ? v <= m : v >= m)) { RD.toast(`TP${n} has to be ${L2 ? 'above' : 'below'} the price now (${px(m, p.symbol)}).`, 'down'); if (key) unpend(key)(); return; }
    const old = (p.tps || []).find(t => t.n === n);
    ask({ title: `Move TP${n}`, tone: 'up', ok: `Move TP${n}`, html: `<p class="xlead">${head(p)}</p>${kv([[`TP${n} now`, old ? px(old.price, p.symbol) : '—'], [`New TP${n}`, `<b>${px(v, p.symbol)}</b> · ${fromE(v, p.entry)} from entry`], ['Price now', px(m, p.symbol)]])}
      <p class="xnote">The TP orders on the exchange are re-placed; the stop stays where it is.</p>`, run: () => manage({ action: 'tp', id: p.id, level: n, price: v }), after: settle(key), cancel: key && unpend(key) });
  }
  function askOrder(o, kind, v, key) {
    const what = { limit: 'Move the limit', ostop: 'Change the stop', otp: 'Change TP1' }[kind];
    const action = { limit: 'move_limit', ostop: 'order_stop', otp: 'order_tp' }[kind];
    const note = { limit: 'The bot checks the new order, cancels the old one and places the new one. Stops and TPs you typed stay put; the others keep their distance.',
      ostop: 'Nothing changes on the exchange now: the bot places this stop when the order fills.', otp: 'TP2–TP4 follow as for a typed TP1. Placed when the order fills.' }[kind];
    const now = { limit: o.limitPrice, ostop: o.stop, otp: o.tp1 }[kind];
    ask({ title: what, tone: 'warn', ok: what.replace(/^Change/, 'Set'), html: `<p class="xlead">${sideTag(o.direction)}<b>${esc(base(o.symbol))}</b> limit · ${esc(o.exchange || '')}</p>
      ${kv([['Now', px(now, o.symbol)], ['New', `<b>${px(v, o.symbol)}</b>`], ['Price now', px(o.price, o.symbol)]])}<p class="xnote">${note}</p>`,
      run: () => manage({ action, id: o.id, price: v }), after: settle(key), cancel: key && unpend(key) });
  }
  function action(kind, id) {
    if (!L.web) { RD.toast(offTitle, 'down'); return; }
    if (kind === 'cancel') {
      const o = ordById(id); if (!o) return;
      ask({ title: 'Cancel the limit order', tone: 'down', ok: 'Cancel order', html: `<p class="xlead">${sideTag(o.direction)}<b>${esc(base(o.symbol))}</b> limit at ${px(o.limitPrice, o.symbol)}</p>${kv([['Size', money((+o.margin || 0) * (+o.leverage || 0))], ['Where', o.onBook ? 'On the exchange order book' : 'The bot watches the price']])}`,
        run: () => manage({ action: 'cancel', id }), after: settle() });
      return;
    }
    const p = posById(id); if (!p) return;
    const { m, pnl } = live(p);
    if (kind === 'close') {
      ask({ title: `Close ${esc(base(p.symbol))} at market`, tone: 'down', ok: 'Close position', html: `<p class="xlead">${head(p)}</p>${kv([['Entry', px(p.entry, p.symbol)], ['Price now', px(m, p.symbol)],
        ['P&amp;L now', `<b>${pnl == null ? '—' : sgn(pnl)}</b>`, (pnl || 0) >= 0 ? 'up' : 'down'], ['Open size', money(+p.size)]])}<p class="xnote">Closes everything still open with a market order, through the bot.</p>`,
        run: () => manage({ action: 'close', id }), after: settle() });
    } else if (kind === 'be') {
      if (m && mv(p.direction, p.entry, m) <= 0) { RD.toast('The trade has to be in profit before the stop can go to the entry.', 'down'); return; }
      ask({ title: 'Stop to breakeven', tone: 'warn', ok: 'Move stop to entry', html: `<p class="xlead">${head(p)}</p>${kv([['Stop now', px(p.stop, p.symbol)], ['New stop', `<b>${px(p.entry, p.symbol)}</b> (entry)`], ['Price now', px(m, p.symbol)]])}`,
        run: () => manage({ action: 'breakeven', id }), after: settle() });
    } else if (kind === 'take') {
      const est = f => (m ? (+p.size || 0) * f * mv(p.direction, p.entry, m) : null);
      const o = { title: `Take profit on ${esc(base(p.symbol))}`, tone: 'up', pctV: 50, html: `<p class="xlead">${head(p)}</p><div class="xpick">${[25, 50, 75].map(v => `<button type="button" data-xpct="${v}"${v === 50 ? ' class="on"' : ''}>${v}%</button>`).join('')}</div>
        <div data-xest>${kv([['Closes', money((+p.size || 0) * 0.5)], ['Banks now ≈', sgn(est(0.5)), (est(0.5) || 0) >= 0 ? 'up' : 'down']])}</div><p class="xnote">At market. TPs are re-placed for the rest; the stop stays.</p>`,
        ok: 'Take 50%', run: () => manage({ action: 'take', id, pct: o.pctV }), after: settle() };
      o.onPick = v => { o.pctV = v; o.ok = `Take ${v}%`; const b = xb.querySelector('[data-xok]'); if (b && !o.busy) b.textContent = o.ok;
        xb.querySelector('[data-xest]').innerHTML = kv([['Closes', money((+p.size || 0) * v / 100)], ['Banks now ≈', sgn(est(v / 100)), (est(v / 100) || 0) >= 0 ? 'up' : 'down']]); };
      ask(o);
    }
  }
  // click a stop / TP / limit in the table: type the new price, Enter asks to confirm (Esc or leaving the box drops it)
  function editCell(btn) {
    if (!L.web) { RD.toast(offTitle, 'down'); return; }
    const kind = btn.dataset.rxe, id = +btn.dataset.id, isOrd = ['limit', 'ostop', 'otp'].includes(kind);
    const it = isOrd ? ordById(id) : posById(id); if (!it) return;
    const cur = isOrd ? { limit: it.limitPrice, ostop: it.stop, otp: it.tp1 }[kind] : kind === 'stop' ? it.stop : ((it.tps || []).find(t => 'tp' + t.n === kind) || {}).price;
    const inp = document.createElement('input');
    inp.className = 'rx-in mono'; inp.inputMode = 'decimal'; inp.value = cur != null ? String(cur) : ''; inp.setAttribute('aria-label', 'New price');
    btn.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const end = go => {
      if (done) return; done = true;
      const v = num(inp.value);
      inp.blur(); RD.renderBottom();
      if (!go) return;
      if (!(v > 0)) { RD.toast('Type a price.', 'down'); return; }
      if (cur != null && Math.abs(v - cur) < 1e-12) return;
      if (isOrd) askOrder(it, kind, v); else if (kind === 'stop') askStop(it, v); else askTp(it, +kind.slice(2), v);
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
    inp.addEventListener('blur', () => end(false));
  }

  // ------------------------------------------------------------------ real levels on the chart (live chart only)
  RD.ext.lines.push(() => {
    const W = [], d = L.d, C = RD.COL, LS = RD.LS;
    if (RD.R.on) return W;
    const at = (key, price) => (L.pend[key] != null ? L.pend[key] : price);
    const dragHint = L.web ? '<br><small>Drag the line to move it — you confirm first.</small>' : '<br><small>Web trading is off: view only.</small>';
    if (d) {
      for (const p of d.positions || []) {
        if (!onChart(p.symbol)) continue;
        const S = p.symbol, size = +p.size || 0, bank = +p.realized || 0, { pnl } = live(p);
        const hd = `<b>REAL ${esc(p.direction)} ${esc(base(S))}</b> · ${esc(p.exchange || '')} · ${p.leverage}×`;
        W.push({ key: 'rxe' + p.id, price: p.entry, color: C.warn, style: LS.Solid, w: 2, title: `REAL ${p.direction.toUpperCase()} ${pnl == null ? '' : sgn(pnl)}`,
          tip: () => { const l = live(p); return `${hd}<br>Entry ${px(p.entry, S)} · now ${px(l.m, S)}<br>P&amp;L <b>${l.pnl == null ? '—' : sgn(l.pnl)}</b> (${pct(l.mvPct)})${bank ? ` · banked ${sgn(bank)}` : ''}<br>${money(size)} open · margin ${money(+p.margin)}`; } });
        if (p.stop) {
          const key = 'rxs' + p.id, lose = v => size * mv(p.direction, p.entry, v) + bank;
          W.push({ key, price: at(key, p.stop), color: C.down, style: LS.Solid, w: 2, title: `REAL SL ${sgn(lose(at(key, p.stop)))}`, dragTitle: v => `REAL SL ${fp(v)} ${sgn(lose(v))}`,
            tip: () => `${hd}<br><b>Stop ${px(p.stop, S)}</b> · ${fromE(p.stop, p.entry)} from entry${p.atBreakeven ? ' (at entry)' : ''}<br>If it fills: ${sgn(lose(p.stop))}${bank ? ' incl. the banked ' + sgn(bank) : ''} · before fees${dragHint}`,
            drag: L.web ? { commit: v => { L.pend[key] = v; RD.syncLines(); askStop(p, v, key); } } : undefined });
        }
        const lad = ladder(p.direction, p.entry, size, bank, p.tps || [], p.closeFr);
        lad.forEach((x, i) => {
          const key = 'rxt' + p.id + '_' + x.n;
          W.push({ key, price: at(key, x.price), color: C.up, style: i ? LS.Dashed : LS.Solid, w: i ? 1 : 2, title: `REAL TP${x.n} ${sgn(x.total)}`, dragTitle: v => `REAL TP${x.n} ${fp(v)}`,
            tip: () => `${hd}<br><b>TP${x.n} ${px(x.price, S)}</b> · ${fromE(x.price, p.entry)} from entry<br>Closes ${(x.share * 100).toFixed(0)}% (${money(x.q)}) → books ${sgn(x.book)}<br>P&amp;L if price gets here ≈ <b>${sgn(x.total)}</b>${x.n === 1 ? '<br><small>Then the stop moves to the entry.</small>' : ''}${i === lad.length - 1 && lad.length > 1 ? `<br>All TPs hit: banked ≈ ${sgn(x.bank)}` : ''}${dragHint}`,
            drag: L.web ? { commit: v => { L.pend[key] = v; RD.syncLines(); askTp(p, x.n, v, key); } } : undefined });
        });
      }
      for (const o of d.orders || []) {
        if (!onChart(o.symbol)) continue;
        const S = o.symbol, size = (+o.margin || 0) * (+o.leverage || 0), E = +o.limitPrice;
        const hd = `<b>REAL ${esc(o.direction)} limit ${esc(base(S))}</b> · ${money(size)} when it fills`;
        const kL = 'rxo' + o.id, kS = 'rxos' + o.id, kT = 'rxot' + o.id;
        W.push({ key: kL, price: at(kL, E), color: C.warn, style: LS.Dashed, w: 2, title: `REAL ${o.direction === 'long' ? 'BUY' : 'SELL'} LIMIT`, dragTitle: v => `REAL LIMIT ${fp(v)}`,
          tip: () => `${hd}<br>Limit ${px(E, S)} · ${o.onBook ? 'on the exchange order book' : 'the bot enters when price touches it'}${dragHint}`,
          drag: L.web ? { commit: v => { L.pend[kL] = v; RD.syncLines(); askOrder(o, 'limit', v, kL); } } : undefined });
        if (o.stop) W.push({ key: kS, price: at(kS, o.stop), color: C.down, style: LS.Dashed, w: 1, title: `LIMIT SL ${sgn(size * mv(o.direction, E, o.stop))}`, dragTitle: v => `LIMIT SL ${fp(v)}`,
          tip: () => `${hd}<br><b>Stop ${px(o.stop, S)}</b> · ${fromE(o.stop, E)} from the limit<br>If it fills at the limit and stops: ${sgn(size * mv(o.direction, E, o.stop))}${dragHint}`,
          drag: L.web ? { commit: v => { L.pend[kS] = v; RD.syncLines(); askOrder(o, 'ostop', v, kS); } } : undefined });
        if (o.tp1) W.push({ key: kT, price: at(kT, o.tp1), color: C.up, style: LS.Dashed, w: 1, title: 'LIMIT TP1', dragTitle: v => `LIMIT TP1 ${fp(v)}`,
          tip: () => `${hd}<br><b>TP1 ${px(o.tp1, S)}</b> · ${fromE(o.tp1, E)} from the limit${dragHint}`,
          drag: L.web ? { commit: v => { L.pend[kT] = v; RD.syncLines(); askOrder(o, 'otp', v, kT); } } : undefined });
      }
    }
    // the ticket being filled in (dashed, draggable like the paper ticket) and the bot's preview levels
    const pv = T.pv && T.pvKey === JSON.stringify(body()) ? T.pv : null, show = paneOpen() || hasInput();
    if (show) {
      const tl = (f, v, color, title) => { if (v > 0) W.push({ key: 'rxk' + f, price: v, color, style: LS.LargeDashed, w: 1, title, drag: { ticket: true, set: x => setF(f, x) } }); };
      if (T.entry === 'limit') tl('limit', val('limit'), C.warn, 'Real limit');
      tl('stop', val('stop') || (pv && pv.stopLoss), C.down, val('stop') ? 'Real stop' : 'Saved stop');
      tl('tp', (T.tp === 'price' && val('tp')) || (pv && pv.tps && pv.tps[0]), C.up, T.tp === 'price' ? 'Real TP1' : 'Plan TP1');
      if (pv && pv.tps) pv.tps.slice(1).forEach((v, i) => { if (v > 0) W.push({ key: 'rxkp' + i, price: v, color: RD.util.hexA(C.up, 0.55), style: LS.Dotted, w: 1, title: 'Plan TP' + (i + 2) }); });
    }
    return W;
  });

  // ------------------------------------------------------------------ the real ticket
  const T = { side: 'long', entry: 'market', tp: 'plan', mode: 'live', ex: '', pv: null, pvKey: '', pvAt: 0, pvErr: null, pvOpen: null, pvBusy: false, pvT: null, pvGen: 0, busy: false };
  const F = n => rx.querySelector(`[data-rf="${n}"]`);
  const val = n => num(F(n).value);
  const setF = (n, v) => { F(n).value = v == null ? '' : String(v); if (n === 'tp' && T.tp !== 'price') T.tp = 'price'; schedule(); renderT(); };
  const hasInput = () => ['limit', 'stop', 'tp'].some(n => F(n).value.trim() !== '');
  const paneOpen = () => !$('[data-pane="real"]').hidden && (!phone() || $('.dk-side').classList.contains('open'));
  const refPx = () => (T.entry === 'limit' ? val('limit') : RD.S.lastPx);
  function check() {
    const e = refPx(), errs = [], short = T.side === 'short', where = T.entry === 'limit' ? 'limit' : 'price now';
    const lim = val('limit'), stop = val('stop'), tp = val('tp'), m = val('margin'), lev = val('lev');
    if (T.entry === 'limit' && !(lim > 0)) errs.push('Set the limit price — type it or pick it on the chart.');
    if (Number.isNaN(stop)) errs.push('The stop is not a price.');
    else if (e && stop && (short ? stop <= e : stop >= e)) errs.push(`A ${T.side}'s stop has to be ${short ? 'above' : 'below'} the ${where}.`);
    if (T.tp === 'price') { if (!(tp > 0)) errs.push("Set the TP1 price, or use the bot's TP plan."); else if (e && (short ? tp >= e : tp <= e)) errs.push(`TP1 has to be ${short ? 'below' : 'above'} the ${where}.`); }
    if (Number.isNaN(m) || (m && m > 100000)) errs.push('Margin must be a positive number.');
    if (Number.isNaN(lev) || (lev && (lev < 1 || lev > 125))) errs.push('Leverage must be 1–125.');
    return errs;
  }
  function body() {
    const b = { symbol: base(RD.U.sym), direction: T.side, mode: T.mode, chartExchange: RD.U.ex };
    if (T.ex) b.exchange = T.ex;
    if (T.entry === 'limit' && val('limit') > 0) b.limitPrice = val('limit');
    if (val('stop') > 0) b.slPrice = val('stop');
    if (T.tp === 'price' && val('tp') > 0) b.tp1Price = val('tp');
    if (val('margin') > 0) b.margin = val('margin');
    if (val('lev') > 0) b.leverage = Math.round(val('lev'));
    return b;
  }
  function schedule(now) { clearTimeout(T.pvT); T.pvT = setTimeout(preview, now ? 0 : 450); }
  async function preview() {
    if (!paneOpen() || RD.R.on || !RD.S.lastPx) return;
    if (check().length) { T.pv = null; T.pvErr = null; T.pvOpen = null; renderT(); return; }
    const b = body(), key = JSON.stringify(b), g = ++T.pvGen;
    T.pvBusy = true; renderPv();
    try {
      const r = await call('/api/trade/preview', b);
      if (g !== T.pvGen) return;
      Object.assign(T, { pv: r.setup || null, pvKey: key, pvAt: Date.now(), pvErr: null, pvOpen: null });
      if (r.webTrading != null) L.web = !!r.webTrading;
    } catch (e) {
      if (g !== T.pvGen) return;
      Object.assign(T, { pv: null, pvKey: '', pvErr: e.message, pvOpen: (e.data && e.data.open) || null, pvAt: Date.now() });
    } finally { if (g === T.pvGen) { T.pvBusy = false; renderT(); RD.syncLines(); } }
  }
  function orderRows(s, full) {
    const P = v => fmtP(v), long = s.direction === 'long', tps = (s.tps || []).filter(v => v > 0);
    const sh = s.closeShares || [], size = +s.posSize || 0, E = +s.entry || +s.market;
    const tpTxt = tps.map((v, i) => `<span class="tpl">TP${i + 1} ${P(v)}${sh[i] ? ` <em>${Math.round(sh[i] * 100)}%</em>` : ''}${full && E ? ` <em class="up">${sgn(size * (sh[i] || 0) * mv(s.direction, E, v))}</em>` : ''}</span>`).join('');
    return kv([
      ['Entry', s.entryType === 'limit' ? `limit <b>${P(s.entry)}</b> <em>${s.onBook ? 'on the order book' : 'bot enters at the touch'}</em>` : `market ≈ <b>${P(s.market)}</b>`],
      ['Stop', `${P(s.stopLoss)} <em>${s.slPct != null ? (long ? '−' : '+') + (+s.slPct).toFixed(2) + '%' : ''}</em>`, 'down'],
      ['Take profits', `<span class="tpls">${tpTxt || '—'}</span>`],
      ['Position', `${money(size)} <em>= ${money(+s.margin)} × ${s.leverage}×${s.exLeverage > s.leverage ? ` · margin saver runs ${s.exLeverage}×` : ''}</em>`],
      ['Max loss', `<b>${money(+s.maxLoss)}</b> <em>at the stop, fees in</em>`, 'down'],
      full && ['Fees', money(+s.fees)], ['Liquidation', P(s.liqPrice), 'warn'],
      s.freeBalance != null && ['Free balance', money(+s.freeBalance)],
    ]);
  }
  const notes = s => (s.warnings || []).map(w => `<p class="xwarn">${ic('triangle-alert')} ${esc(w)}</p>`).join('') + (s.errors || []).map(w => `<p class="xbad">${ic('circle-x')} ${esc(w)}</p>`).join('');
  function renderPv() {
    const el = $('[data-rx-pv]'), errs = check();
    let h = '';
    if (RD.R.on) h = '';
    else if (errs.length) h = `<p class="xbad">${ic('circle-x')} ${esc(errs[0])}</p>`;
    else if (T.pvOpen) h = `<div class="rx-open">${ic('info')} <span>You already have an open <b>${esc(String(T.pvOpen.direction || '').toUpperCase())}</b> on ${esc(base(RD.U.sym))} (${esc(T.pvOpen.mode || '')}).</span><button type="button" class="btn btn-secondary btn-sm" data-act="rx-show">Show it</button></div>`;
    else if (T.pvErr) h = `<p class="xbad">${ic('circle-x')} ${esc(T.pvErr)}</p>`;
    else if (T.pv && T.pvKey === JSON.stringify(body())) {
      const s = T.pv;
      h = `<div class="rx-pvh"><span>${ic('bot')} The bot's order</span><span class="muted">${esc(String(s.exchange || '').toUpperCase())} · ${s.mode === 'live' ? 'live money' : "bot's paper"}${T.pvBusy ? ' · updating…' : ''}</span></div>${orderRows(s, false)}${notes(s)}`;
    } else h = `<div class="rx-pvh"><span>${ic('bot')} The bot's order</span><span class="muted">${T.pvBusy ? 'asking the bot…' : ''}</span></div><p class="muted rx-wait">${T.pvBusy ? '<span class="spin-s"></span> ' : ''}The bot works out the exact order — entry, stop, TPs, size and max loss — as you fill this in.</p>`;
    if (el._h !== h) { el.innerHTML = h; el._h = h; }
  }
  function renderT() {
    const short = T.side === 'short', web = L.web, rp = RD.R.on, c = coin(RD.U.sym);
    $$('[data-rside]', rx).forEach(b => b.classList.toggle('on', b.dataset.rside === T.side));
    $$('[data-rentry]', rx).forEach(b => b.classList.toggle('on', b.dataset.rentry === T.entry));
    for (const [a, v] of [['rtp', T.tp], ['rmode', T.mode], ['rex', T.ex]]) $$(`[data-${a}]`, rx).forEach(b => { const on = b.dataset[a] === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    $('[data-rx-limrow]', rx).hidden = T.entry !== 'limit';
    $('[data-rx-tprow]', rx).hidden = T.tp !== 'price';
    $('[data-rx-replay]', rx).hidden = !rp;
    $('[data-rx-form]', rx).disabled = rp;
    const e = refPx(), note = (n, v) => { const el = rx.querySelector(`[data-rn="${n}"]`); el.textContent = v; };
    const st = val('stop'), tp = val('tp'), lim = val('limit');
    note('stop', e && st > 0 ? fromE(st, e) + (T.entry === 'limit' ? ' from limit' : ' from price') : '');
    note('tp', e && tp > 0 ? fromE(tp, e) : '');
    note('limit', RD.S.lastPx && lim > 0 ? fromE(lim, RD.S.lastPx) + ' from price' : '');
    for (const n of ['limit', 'stop', 'tp', 'margin', 'lev']) { const v = val(n); F(n).classList.toggle('bad', Number.isNaN(v)); }
    const go = $('[data-act="rx-review"]', rx), errs = check();
    go.className = 'tk2-go ' + (short ? 'down' : 'up');
    go.disabled = rp || !RD.S.lastPx || !!errs.length || T.busy || !!T.pvOpen;
    go.innerHTML = T.busy ? '<span class="spin-s"></span> Asking the bot…' : `Review ${T.mode === 'live' ? 'LIVE' : 'bot-paper'} ${short ? 'short' : 'long'} ${esc(c)}`;
    $('[data-act="rx-tg"]', rx).disabled = rp || !!errs.length;
    const wt = $('[data-rx-wt]', rx);
    wt.className = 'rx-wt' + (web ? ' on' : web === false ? ' off' : '');
    wt.textContent = web == null ? 'Checking the bot…' : web ? 'Web trading on' : 'Web trading off — Telegram ✅ only';
    renderPv();
  }
  async function review() {
    const errs = check(); if (errs.length || T.busy || RD.R.on) return;
    const b = body();
    T.busy = true; renderT();
    let r;
    try { r = await call('/api/trade/preview', b); } catch (e) { T.busy = false; T.pvErr = e.message; T.pvOpen = (e.data && e.data.open) || null; renderT(); return; }
    T.busy = false;
    if (r.webTrading != null) L.web = !!r.webTrading;
    const s = r.setup; Object.assign(T, { pv: s, pvKey: JSON.stringify(b), pvAt: Date.now(), pvErr: null, pvOpen: null }); renderT(); RD.syncLines();
    const long = s.direction === 'long', liveM = s.mode === 'live', bad = (s.errors || []).length;
    const title = `${liveM ? 'Live' : "Bot's paper"} ${long ? 'long' : 'short'} ${esc(s.symbol)} <span class="xex">${esc(String(s.exchange || '').toUpperCase())}</span>`;
    const lead = `<p class="xlead">${liveM ? '<span class="rx-badge sm"><i></i>Real money</span> ' : ''}The bot will place exactly this order${liveM ? ' with your exchange account' : ''}:</p>`;
    if (bad) { ask({ title, tone: 'down', html: lead + orderRows(s, true) + notes(s) + '<p class="xnote">Fix the problems above in the ticket, then review again.</p>' }); return; }
    if (!L.web) {
      ask({ title, tone: long ? 'up' : 'down', html: lead + orderRows(s, true) + notes(s) + `<p class="xnote">Web trading is off, so this desk can't place it. Send it to your Telegram /${s.direction} panel and tap ✅ there — or send <code>/webtrade on</code> first.</p>`,
        ok: `${ic('send')} Send to Telegram`, run: () => sendPanel(b) });
      return;
    }
    ask({ title, tone: long ? 'up' : 'down', html: lead + orderRows(s, true) + notes(s), ok: `Place ${liveM ? 'LIVE' : 'paper'} ${long ? 'long' : 'short'} · max loss ${money(+s.maxLoss)}`,
      run: async () => {
        const res = await write('/api/trade/open', b, 60000);
        return res.kind === 'limit' ? `Limit order #${res.id} placed${res.onBook ? ' on the exchange order book' : ''}. The bot sets the stop and TPs when it fills.`
          : `${long ? 'Long' : 'Short'} ${s.symbol} opened at ${fmtP(res.entry)} with its stop and TPs.`;
      },
      after: () => { for (const n of ['limit', 'stop', 'tp']) F(n).value = ''; T.entry = 'market'; T.tp = 'plan'; T.pv = null; renderT(); RD.syncLines(); poll(true); RD.setBTab('real'); } });
  }
  async function sendPanel(b) {
    const r = await write('/api/trade/panel', b);
    const p = r.panel;
    return p && p.entry ? `Sent to Telegram: ${b.direction} ${b.symbol} — tap ✅ in the panel to place it.` : 'Sent to Telegram — tap ✅ in the /' + b.direction + ' panel to place it.';
  }
  function fitMargin() {
    const risk = val('risk'), e = refPx(), stop = val('stop') || (T.pv && T.pv.stopLoss), lev = val('lev') || (T.pv && T.pv.leverage);
    if (!(risk > 0)) return RD.toast('Type how many dollars you accept to lose at the stop.', 'down');
    if (!e) return RD.toast(T.entry === 'limit' ? 'Set the limit price first.' : 'Wait for the price.', 'down');
    if (!(stop > 0)) return RD.toast('Set a stop first (or let the bot preview its saved stop).', 'down');
    if (!(lev > 0)) return RD.toast('Set the leverage first.', 'down');
    const dist = Math.abs(e - stop) / e; if (!(dist > 0)) return RD.toast('The stop is at the entry.', 'down');
    const pos = risk / (dist + 0.001), margin = Math.floor(pos / lev * 100) / 100;   // 0.1 %: taker fee in and out
    F('margin').value = margin; schedule(); renderT();
    RD.toast(`Margin ${money(margin)} × ${lev}× = ${money(margin * lev)}: the stop ${(dist * 100).toFixed(2)}% away loses ≈ ${money(risk)} with fees.`);
  }

  // ------------------------------------------------------------------ signals: recent pump signals and the bot's trades
  const G = { tab: store.get('rd-adm-sigtab', 'sig'), days: store.get('rd-adm-sigdays', 14), q: '', sigs: [], trades: [], at: 0, err: null, busy: false, show: store.get('rd-adm-sigmarks', true) };
  const sigBox = $('[data-sigs]');
  async function loadSigs(force) {
    if (G.busy || (!force && Date.now() - G.at < 120000)) return;
    G.busy = true; if (!G.at) renderSigs();
    try {
      const [s, t] = await Promise.all([call(`/api/sim/signals?days=${G.days}`), call(`/api/sim/trades?days=${G.days}`)]);
      G.sigs = s.signals || []; G.trades = t.trades || []; G.err = null; G.at = Date.now();
    } catch (e) { G.err = e.message; } finally { G.busy = false; renderSigs(); markKey = ''; marksTick(); }
  }
  const sigVisible = () => !$('[data-pane="sig"]').hidden;
  function renderSigs() {
    const q = G.q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const top = `<div class="sg-top"><div class="rx-seg" role="tablist"><button type="button" data-sgtab="sig" class="${G.tab === 'sig' ? 'on' : ''}">Pump signals <b>${G.sigs.length}</b></button><button type="button" data-sgtab="tr" class="${G.tab === 'tr' ? 'on' : ''}">Bot trades <b>${G.trades.length}</b></button></div>
      <div class="sg-tools"><span class="fld-in"><input data-sgq placeholder="Filter coin" value="${esc(G.q)}" autocomplete="off" spellcheck="false" aria-label="Filter by coin"></span>
      <select data-sgdays aria-label="Period">${[3, 7, 14, 30, 60].map(d => `<option value="${d}"${d === G.days ? ' selected' : ''}>${d} days</option>`).join('')}</select>
      <button type="button" class="dk-ib" data-act="sg-reload" aria-label="Reload" title="Reload">${ic('refresh-cw')}</button></div>
      <label class="sg-show"><input type="checkbox" data-sgshow${G.show ? ' checked' : ''}> Show them on the chart (never past the replay clock)</label></div>`;
    let list = '';
    if (G.err) list = `<p class="xbad">${ic('circle-x')} ${esc(G.err)}</p>`;
    else if (!G.at) list = '<div class="pt-empty"><div><span class="spin-s"></span> Loading signals…</div></div>';
    else if (G.tab === 'sig') {
      const rows = G.sigs.filter(s => !q || base(s.symbol).includes(q));
      list = rows.length ? rows.map(s => {
        const t = Date.parse(s.t), weak = s.pumpPct != null && s.pumpPct < 40, here = onChart(s.symbol);
        return `<div class="sg${here ? ' here' : ''}" data-sgo="${esc(s.symbol)}|${t}"><div class="sg-h"><b>${esc(base(s.symbol))}</b>${s.direction ? `<span class="sd ${s.direction === 'long' ? 'up' : 'down'}">${esc(String(s.direction).toUpperCase())}</span>` : ''}${weak ? '<span class="sg-weak">WEAK</span>' : ''}<time title="${esc(new Date(t).toUTCString())}">${ago(t)}</time></div>
          <div class="sg-m"><span>Pump <b>${s.pumpPct != null ? '+' + Math.round(s.pumpPct) + '%' : '—'}</b></span>${s.score != null ? `<span>Score <b>${esc(s.score)}</b></span>` : ''}${s.funding != null ? `<span>Funding <b>${(+s.funding).toFixed(4)}%</b></span>` : ''}${s.price ? `<span>@ <b>${fmtP(+s.price)}</b></span>` : ''}</div>
          <div class="sg-a"><button type="button" data-sgact="chart">${ic('chart-candlestick')} Chart</button><button type="button" data-sgact="replay">${ic('rewind')} Replay from the signal</button></div></div>`;
      }).join('') : `<div class="pt-empty">No pump signals${q ? ' for ' + esc(q) : ''} in the last ${G.days} days.</div>`;
    } else {
      const rows = G.trades.filter(t => !q || base(t.symbol).includes(q));
      list = rows.length ? rows.map(t => {
        const t0 = Date.parse(t.t), open = !t.t1, pnl = t.pnl != null ? +t.pnl : null;
        return `<div class="sg${onChart(t.symbol) ? ' here' : ''}" data-sgo="${esc(t.symbol)}|${t0 - 15 * MIN}|${exOf(t.exchange)}"><div class="sg-h"><b>${esc(base(t.symbol))}</b>${sideTag(t.direction)}<span class="muted">#${t.id}</span><time title="${esc(new Date(t0).toUTCString())}">${ago(t0)}</time></div>
          <div class="sg-m"><span>${open ? '<b class="warn">Open</b>' : `P&amp;L <b class="${(pnl || 0) >= 0 ? 'up' : 'down'}">${pnl == null ? '—' : sgn(pnl)}</b>`}</span>${t.reason ? `<span>${esc(String(t.reason).replace(/_/g, ' '))}</span>` : ''}<span>${esc(t.exchange || '')}</span><span>entry <b>${fmtP(+t.entry)}</b></span></div>
          <div class="sg-a"><button type="button" data-sgact="chart">${ic('chart-candlestick')} Chart</button><button type="button" data-sgact="replay">${ic('rewind')} Replay 15 min before entry</button></div></div>`;
      }).join('') : `<div class="pt-empty">No bot trades${q ? ' for ' + esc(q) : ''} in the last ${G.days} days.</div>`;
    }
    const focusQ = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-sgq]');
    sigBox.innerHTML = top + `<div class="sg-list">${list}</div>`;
    if (focusQ) { const i = sigBox.querySelector('[data-sgq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  RD.ext.marks.push(() => {
    if (!G.show) return [];
    const C = RD.COL, M = [];
    for (const s of G.sigs) if (onChart(s.symbol)) M.push({ t: Date.parse(s.t), position: 'aboveBar', color: C.warn, shape: 'arrowDown', text: 'Signal' + (s.pumpPct != null ? ' +' + Math.round(s.pumpPct) + '%' : '') });
    for (const t of G.trades) if (onChart(t.symbol)) {
      const sh = t.direction === 'short';
      M.push({ t: Date.parse(t.t), position: sh ? 'aboveBar' : 'belowBar', color: C.pri, shape: sh ? 'arrowDown' : 'arrowUp', text: `Bot ${t.direction}` });
      if (t.t1) M.push({ t: Date.parse(t.t1), position: sh ? 'belowBar' : 'aboveBar', color: (+t.pnl || 0) >= 0 ? C.up : C.down, shape: 'circle', text: 'Exit ' + (t.pnl != null ? sgn(+t.pnl) : '') });
    }
    return M;
  });
  let markKey = '';
  function marksTick() {   // markers follow new candles and the replay clock (they never show what is still in the future)
    const b = RD.S.bars, k = `${RD.U.sym}|${RD.U.tf}|${b.length}|${b.length ? b[0][0] : 0}|${Math.floor(RD.util.nowT() / MIN)}|${G.at}|${G.show}`;
    if (k !== markKey) { markKey = k; RD.setMarkers(); }
  }

  // ------------------------------------------------------------------ positioning for the coin on the chart
  const FL = { sym: '', d: null, err: null, at: 0, busy: false };
  async function loadFlow(force) {
    const sym = base(RD.U.sym);
    if (RD.R.on || !paneOpen() || FL.busy || (!force && FL.sym === sym && Date.now() - FL.at < 60000)) { renderFlow(); return; }
    FL.busy = true; if (FL.sym !== sym) { FL.d = null; FL.err = null; } FL.sym = sym; renderFlow();
    try { FL.d = await call(`/api/sim/flow?symbol=${encodeURIComponent(sym)}&exchange=${RD.U.ex}`); FL.err = null; } catch (e) { FL.d = null; FL.err = e.message; }
    finally { FL.busy = false; FL.at = Date.now(); if (FL.sym === sym) renderFlow(); }
  }
  const ratio = s => (s && s.ratio != null ? (+s.ratio).toFixed(2) : '—');
  const longPct = s => (s && s.now != null ? Math.round(+s.now <= 1 ? s.now * 100 : +s.now) + '% long' : '');
  const chg = v => (v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${pct(v)}</span>`);
  const usdS = v => (v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(0) + 'K' : money(v));
  function renderFlow() {
    const el = $('[data-rx-flow]'); if (!el) return;
    const d = FL.d, sym = base(RD.U.sym);
    let h = `<div class="rf-h"><span>${ic('users')} Positioning · ${esc(sym)}</span><button type="button" class="dk-ib" data-act="rf-reload" aria-label="Reload positioning" title="Reload">${ic('refresh-cw')}</button></div>`;
    if (RD.R.on) h += '<p class="muted rf-p">Live data — shown on the live chart.</p>';
    else if (FL.busy && !d) h += '<p class="muted rf-p"><span class="spin-s"></span> Loading funding, whales and retail…</p>';
    else if (FL.err) h += `<p class="muted rf-p">No positioning data for ${esc(sym)}: ${esc(FL.err)}</p>`;
    else if (d) {
      const f = d.funding != null ? +d.funding : null;
      h += kv([
        ['Funding', f == null ? '—' : `<b class="${f >= 0 ? 'up' : 'down'}">${f >= 0 ? '+' : ''}${f.toFixed(4)}%</b> <em>${f >= 0.05 ? 'longs pay a lot' : f <= -0.05 ? 'shorts pay a lot' : f >= 0 ? 'longs pay' : 'shorts pay'}</em>`],
        ['Whales <em>top traders</em>', `L/S <b>${ratio(d.whales)}</b> <em>${longPct(d.whales)}</em>`],
        ['Retail <em>all accounts</em>', `L/S <b>${ratio(d.retail || d.retailBybit)}</b> <em>${longPct(d.retail || d.retailBybit)}</em>`],
        ['Open interest', `1h ${chg(d.oi1)} · 4h ${chg(d.oi4)}${d.oiUsd ? ` <em>${usdS(+d.oiUsd)}</em>` : ''}`],
        d.taker != null && ['Taker buy/sell 1h', `<b>${(+d.taker).toFixed(2)}</b> <em>${d.taker >= 1.1 ? 'buyers hit harder' : d.taker <= 0.9 ? 'sellers hit harder' : 'even'}</em>`],
      ]);
      if (d.reading) h += `<p class="rf-read">${esc(d.reading)}</p>`;
      if (d.oiReading) h += `<p class="rf-read">${esc(d.oiReading)}</p>`;
      h += `<p class="muted rf-foot">Binance top traders and all accounts${d.retailBybit ? ' · Bybit retail' : ''} · ${ago(d.at || FL.at)}</p>`;
    } else h += '<p class="muted rf-p">Open the Real tab on a live chart to load it.</p>';
    el.innerHTML = h;
  }

  // ------------------------------------------------------------------ header chip, counts, repaint
  const wtEl = $('[data-wt]');
  function paint() {
    const d = L.d, n = d ? (d.positions || []).length + (d.orders || []).length : 0;
    $$('[data-cnt="real"]').forEach(e => { e.textContent = n; e.classList.toggle('live', n > 0); });
    if (wtEl && L.web != null) {
      wtEl.hidden = false; wtEl.classList.toggle('on', L.web);
      wtEl.querySelector('span').textContent = L.web ? 'Web trading on' : 'Web trading off';
      wtEl.title = L.web ? 'This desk can place and manage real trades. Turn it off with /webtrade off in Telegram.' : 'View only. Send /webtrade on in Telegram to trade from this desk.';
    }
    renderT(); RD.syncLines();
    if (RD.BTAB === 'real') RD.renderBottom();
  }

  // ------------------------------------------------------------------ events
  rx.addEventListener('input', e => {
    if (!e.target.matches('[data-rf]')) return;
    if (e.target.dataset.rf === 'risk') return;
    schedule(); renderT(); RD.syncLines();
  });
  document.addEventListener('click', e => {
    const t = e.target;
    const a = t.closest('[data-act]');
    if (a) {
      const k = a.dataset.act;
      if (k === 'rx-review') review();
      else if (k === 'rx-tg') {
        if (check().length) return;
        const b = body(); a.disabled = true;
        sendPanel(b).then(m => RD.toast(m, 'up'), er => RD.toast('Not sent: ' + er.message, 'down')).finally(() => { a.disabled = false; });
      } else if (k === 'rx-clear') { for (const n of ['limit', 'stop', 'tp', 'margin', 'lev', 'risk']) F(n).value = ''; Object.assign(T, { entry: 'market', tp: 'plan', pv: null, pvErr: null, pvOpen: null }); schedule(); renderT(); RD.syncLines(); }
      else if (k === 'rx-fit') fitMargin();
      else if (k === 'rx-fresh') { a.disabled = true; poll(true).finally(() => { a.disabled = false; }); }
      else if (k === 'rx-show') { RD.setBTab('real'); if (phone()) RD.openSheet('pos'); }
      else if (k === 'rf-reload') loadFlow(true);
      else if (k === 'sg-reload') loadSigs(true);
      return;
    }
    if (!t.closest) return;
    const sd = t.closest('[data-rside]'); if (sd) { T.side = sd.dataset.rside; for (const n of ['stop', 'tp']) F(n).value = ''; schedule(); renderT(); RD.syncLines(); return; }
    const en = t.closest('[data-rentry]'); if (en) { T.entry = en.dataset.rentry; if (T.entry === 'limit' && !F('limit').value && RD.S.lastPx) F('limit').value = RD.util.rt(RD.S.lastPx); schedule(); renderT(); RD.syncLines(); return; }
    for (const [attr, key] of [['rtp', 'tp'], ['rmode', 'mode'], ['rex', 'ex']]) { const b = t.closest(`[data-${attr}]`); if (b && rx.contains(b)) { T[key] = b.dataset[attr]; schedule(); renderT(); RD.syncLines(); return; } }
    const lv = t.closest('[data-rlev]'); if (lv) { F('lev').value = lv.dataset.rlev; schedule(); renderT(); return; }
    const sp = t.closest('[data-rstop]'); if (sp) { const e0 = refPx(); if (!e0) return RD.toast('Set the entry first.', 'down'); const f = +sp.dataset.rstop / 100; setF('stop', RD.util.rt(T.side === 'long' ? e0 * (1 - f) : e0 * (1 + f))); RD.syncLines(); return; }
    const tpp = t.closest('[data-rtpp]'); if (tpp) { const e0 = refPx(); if (!e0) return RD.toast('Set the entry first.', 'down'); const f = +tpp.dataset.rtpp / 100; setF('tp', RD.util.rt(T.side === 'long' ? e0 * (1 + f) : e0 * (1 - f))); RD.syncLines(); return; }
    const pk = t.closest('[data-pick-x]');
    if (pk) {
      e.preventDefault(); const f = pk.dataset.pickX;
      if (pk.classList.contains('on')) { RD.clearPick(); return; }
      RD.startPick('field', f, v => { setF(f, v); RD.syncLines(); if (phone()) RD.openSheet('real'); }, { limit: 'real limit price', stop: 'real stop', tp: 'real TP1' }[f]);
      return;
    }
    const ra = t.closest('[data-rxa]'); if (ra) { action(ra.dataset.rxa, +ra.dataset.id); return; }
    const re = t.closest('[data-rxe]'); if (re && re.tagName === 'BUTTON') { editCell(re); return; }
    const sgt = t.closest('[data-sgtab]'); if (sgt) { G.tab = sgt.dataset.sgtab; store.set('rd-adm-sigtab', G.tab); renderSigs(); return; }
    const sga = t.closest('[data-sgo]');
    if (sga) {
      const [sym, ts, ex] = sga.dataset.sgo.split('|'), when = +ts, act = t.closest('[data-sgact]');
      if (act && act.dataset.sgact === 'replay') { RD.openAt(pair(sym), ex || RD.U.ex, when); if (phone()) RD.closeSheets(); }
      else { if (RD.R.on) RD.exitReplay(); RD.setSymbol(pair(sym), ex || undefined); if (phone()) RD.closeSheets(); }
      setTimeout(renderSigs, 50);
      return;
    }
    const go = t.closest('[data-rxgo]');
    if (go && !t.closest('button, input')) { const [sym, ex] = go.dataset.rxgo.split('|'); if (RD.R.on) RD.exitReplay(); RD.setSymbol(sym, ex); if (phone()) RD.closeSheets(); return; }
    if (t.closest('[data-wt]')) RD.toast(L.web ? 'Web trading is on: this desk can place and manage real trades. /webtrade off in Telegram turns it off.' : 'Web trading is off: real trades are view-only here. Send /webtrade on in Telegram, or use Send to Telegram and tap ✅ there.');
  });
  sigBox.addEventListener('input', e => { if (e.target.matches('[data-sgq]')) { G.q = e.target.value; renderSigs(); } });
  sigBox.addEventListener('change', e => {
    if (e.target.matches('[data-sgdays]')) { G.days = +e.target.value; store.set('rd-adm-sigdays', G.days); loadSigs(true); }
    else if (e.target.matches('[data-sgshow]')) { G.show = e.target.checked; store.set('rd-adm-sigmarks', G.show); markKey = ''; marksTick(); }
  });
  RD.on('sym', () => { for (const n of ['limit', 'stop', 'tp']) F(n).value = ''; Object.assign(T, { pv: null, pvErr: null, pvOpen: null }); renderT(); schedule(); if (sigVisible()) renderSigs(); });
  RD.on('mode', () => { renderT(); RD.syncLines(); renderFlow(); if (!RD.R.on) schedule(); });
  RD.on('pane', p => { if (p === 'real') { schedule(true); loadFlow(); } if (p === 'sig') { renderSigs(); loadSigs(); } });
  let tickN = 0;
  RD.on('tick', () => {
    marksTick();
    if (++tickN % 4 === 0) renderT();   // notes (% from the price) follow the market without redrawing every frame
    if (paneOpen() && !RD.R.on && FL.sym !== base(RD.U.sym) && RD.S.lastPx) loadFlow();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ------------------------------------------------------------------ start
  window.__rdAdmin = { L, T, G, FL, poll, ladder };   // for tests
  renderT(); renderFlow(); renderSigs();
  poll(); setInterval(poll, 5000);
  setInterval(() => { if (paneOpen() && !RD.R.on && !T.busy && Date.now() - T.pvAt > 30000 && !check().length) schedule(true); }, 5000);
  loadSigs(); setInterval(() => loadSigs(), 5 * 60000);
  if (location.hash === '#real') { if (phone()) RD.openSheet('real'); else RD.sideTab('real'); RD.setBTab('real'); }
})();
