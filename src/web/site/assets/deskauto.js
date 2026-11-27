/* ReplayDesk admin · Real → Auto trade. The server does the trading (src/engine/deskAuto.js, every minute, also with this page
   closed): this page switches it on for the chart you are looking at, with the setup (A+ on a timeframe, or RD ▲ / ▼), side,
   account (the bot's paper account, or live money after a confirm here), margin, leverage, days, hours and trades a day; lists the
   charts it trades, the limits for all of them, and what it did with every setup (placed, skipped and why, the result).
   Live money also needs /webtrade on in Telegram, the same switch as the Order ticket. */
(() => {
  'use strict';
  const RD = window.__rd, box = document.querySelector('[data-au]');
  if (!RD || !box) return;
  const { U } = RD, X = RD.ext, { esc, money, coin, phone } = RD.util;
  const API = '/api/autotrade', MAXC = 6;
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], WEEK = [1, 2, 3, 4, 5, 6, 0];
  const STF = { '1m': '5m', '5m': '5m', '15m': '15m', '30m': '30m', '1H': '1H', '4H': '4H' };
  const TFS = ['5m', '15m', '30m', '1H', '4H'];
  const HOURS0 = { any: 'Any time', ny: 'New York session 08:00–17:00', nyoc: 'New York open + close 08–10, 15–17', opens: 'London + New York opens 07–11, 13–17 UTC' };
  const SET = { aplus: 'A+', rd: 'RD ▲ / ▼' };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };
  const A = { d: null, err: '', busy: false, form: null, fkey: '', want: '', confirm: null, msg: '', lastId: -1, skips: store.get('rd-au-skips', false), sub: store.get('rd-au-sub', 'order'), at: 0 };

  const $ = s => box.querySelector(s);
  const exNow = () => (U.ex === 'bybit' ? 'bybit' : 'binance');
  const chartOk = () => U.ex !== 'fx' && /USDT$/.test(U.sym || '');
  const idOf = f => [U.sym, exNow(), f.setup, f.setup === 'aplus' ? f.tf : ''].join('|');
  const cfg = () => (A.d ? A.d.cfg : null);
  const charts = () => (cfg() ? cfg().charts : []);
  const hoursName = k => ((A.d && A.d.hours) || HOURS0)[k] || k;
  const daysWord = d => (d.length === 7 ? 'every day' : WEEK.filter(x => d.includes(x)).map(x => WD[x]).join(' '));
  const setupWord = c => (c.setup === 'aplus' ? 'A+ ' + c.tf : 'RD ▲ / ▼');
  const hm = t => new Date(t).toISOString().slice(11, 16);
  const when = t => { const s = new Date(t).toISOString(); return (s.slice(0, 10) === new Date().toISOString().slice(0, 10) ? '' : new Date(t).toUTCString().slice(5, 11) + ' ') + s.slice(11, 16); };
  const n2 = v => { const x = Number(String(v).replace(/[, ]/g, '')); return Number.isFinite(x) ? x : NaN; };

  // ------------------------------------------------------------------ the server
  async function call(body) {
    const r = await fetch(API, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (r.status === 409 && j && j.needConfirm) return { needConfirm: true, error: j.error };
    if (!r.ok || !j) throw new Error((j && j.error) || 'The server did not answer');
    return j;
  }
  async function load() {
    try { const d = await call(); took(d); A.err = ''; } catch (e) { A.err = e.message; }
    A.at = Date.now(); render(); RD.legend();
  }
  function took(d) {
    const first = A.lastId < 0;
    A.d = d;
    const placed = d.status.plans.filter(p => p.oid || p.tid || p.st === 'fail'), fresh = p => p.st === 'wait' || p.st === 'open' || p.st === 'fail';
    const top = placed.reduce((a, p) => Math.max(a, p.id), 0);
    if (!first) for (const p of placed.filter(p => p.id > A.lastId && fresh(p)).reverse()) {
      const w = `${setupWord(p)} ${p.dir === 1 ? 'long' : 'short'} ${coin(p.sym)} (${p.mode === 'live' ? 'LIVE money' : 'paper'})`;
      RD.toast(p.st === 'fail' ? `🤖 Auto-trade: ${w} was not placed: ${p.why}` : `🤖 Auto-trade: ${w} ${p.kind === 'limit' ? 'limit placed' : 'opened'}`, p.st === 'fail' ? 'down' : p.dir === 1 ? 'up' : 'down');
    }
    A.lastId = Math.max(A.lastId, top);
    if (!A.form || A.fkey !== U.sym + '|' + exNow()) resetForm();
  }
  async function send(body) {
    if (A.busy) return;
    A.busy = true; A.msg = ''; render();
    try {
      const r = await call(body);
      if (r.needConfirm) { A.confirm = body; A.msg = ''; }
      else { A.confirm = null; took(r); A.err = ''; return r; }
    } catch (e) { A.msg = e.message; }
    finally {
      A.busy = false; render(); RD.legend();
      const cf = A.confirm && box.querySelector('.au-cf');   // the live-money question may open below the fold
      if (cf && cf.scrollIntoView) cf.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return null;
  }

  // ------------------------------------------------------------------ the form for the chart on screen
  function resetForm() {
    A.fkey = U.sym + '|' + exNow();
    const mine = charts().filter(c => c.sym === U.sym && c.ex === exNow());
    const c = mine.find(x => x.id === A.want) || mine[0];
    A.want = '';
    A.form = c ? { setup: c.setup, tf: c.tf || STF[U.tf] || '5m', side: c.side, mode: c.mode, margin: c.margin, lev: c.lev, days: c.days.slice(), hours: c.hours, maxDay: c.maxDay }
      : { setup: 'aplus', tf: TFS.includes(STF[U.tf]) ? STF[U.tf] : '5m', side: 'both', mode: 'paper', margin: 100, lev: 10, days: [3, 4, 5], hours: 'ny', maxDay: 3 };
    A.confirm = null; A.msg = '';
  }
  const seg = (f, opts) => `<div class="rx-seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${A.form[f] === v}" data-au-f="${f}" data-v="${v}"${A.form[f] === v ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`;
  function formHtml() {
    if (!chartOk()) return `<p class="au-empty">Auto trade works on Binance and Bybit USDT coins. Open a coin (not an FX pair) to set it up.</p>`;
    const f = A.form, id = idOf(f), have = charts().find(c => c.id === id), pos = n2(f.margin) * n2(f.lev), live = f.mode === 'live';
    const plan = f.setup === 'aplus'
      ? `Each new A+ ${esc(f.tf)} setup: a market order at once, with the setup's stop and target. It closes at the target or the stop.`
      : 'Each new RD ▲ / ▼: a limit in the middle of the 1-minute gap (cancelled if not filled in 30 minutes), stop past the move, target 3R, closed after 6 hours.';
    const full = !have && charts().length >= MAXC;
    return `<div class="au-form">
      <div class="fld"><span>Setup</span>${seg('setup', [['aplus', 'A+ setup'], ['rd', 'RD ▲ / ▼']])}</div>
      ${f.setup === 'aplus' ? `<div class="fld"><span>A+ timeframe <em>the structure the setup is read on</em></span><div class="au-chips au-c5">${TFS.map(t => `<button type="button" data-au-f="tf" data-v="${t}"${f.tf === t ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${t}</button>`).join('')}</div></div>` : ''}
      <div class="fld"><span>Side</span>${seg('side', [['both', 'Long + short'], ['long', 'Long only'], ['short', 'Short only']])}</div>
      <div class="fld"><span>Account</span>${seg('mode', [['paper', "Bot's paper"], ['live', 'Live money']])}</div>
      <div class="rx-two">
        <label class="fld"><span>Margin <em>USDT</em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-au-in="margin" value="${esc(f.margin)}"></span></label>
        <label class="fld"><span>Leverage <em>×</em></span><span class="fld-in"><input inputmode="numeric" autocomplete="off" data-au-in="lev" value="${esc(f.lev)}"></span></label>
      </div>
      <p class="au-pos" data-au-pos>${pos > 0 ? `Position ${money(pos)} a trade` : 'Margin and leverage must be numbers'}</p>
      <div class="fld"><span>Days <em>New York date</em></span><div class="au-chips au-c7">${WEEK.map(d => `<button type="button" data-au-day="${d}"${f.days.includes(d) ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${WD[d].slice(0, 2)}</button>`).join('')}</div></div>
      <label class="fld"><span>Hours <em>New York time</em></span><select class="au-sel" data-au-in="hours">${Object.keys(HOURS0).map(k => `<option value="${k}"${f.hours === k ? ' selected' : ''}>${esc(hoursName(k))}</option>`).join('')}</select></label>
      <label class="fld"><span>Trades a day on this chart <em>at most</em></span><span class="fld-in"><input inputmode="numeric" autocomplete="off" data-au-in="maxDay" value="${esc(f.maxDay)}"></span></label>
      <p class="au-plan">${plan} One trade at a time on this chart.</p>
      ${A.confirm && A.confirm.action === 'save' ? confirmHtml(A.confirm) : `<button type="button" class="tk2-go ${live ? 'down' : 'up'}" data-au-act="save"${A.busy || full ? ' disabled' : ''}>${full ? `${MAXC} charts already: remove one first` : have ? 'Save changes' : live ? `Auto trade ${esc(coin(U.sym))} with live money` : `Auto trade ${esc(coin(U.sym))} (paper)`}</button>`}
      ${A.msg ? `<p class="au-msg down">${esc(A.msg)}</p>` : ''}
    </div>`;
  }
  function confirmHtml(b) {
    let what;
    if (b.action === 'master') {
      const L = charts().filter(c => c.on && c.mode === 'live');
      what = `Auto trading will place <b>real-money</b> orders without asking you on: ${L.map(c => `${esc(coin(c.sym))} ${esc(setupWord(c))} (${money(c.margin * c.lev)} a trade)`).join(', ')}.`;
    } else {
      const c = b.action === 'save' ? b.chart : charts().find(x => x.id === b.id) || {};
      what = `Every ${esc(c.setup === 'rd' ? 'RD ▲ / ▼' : 'A+ ' + (c.tf || ''))} ${c.side === 'both' ? 'long and short' : esc(c.side)} on ${esc(coin(c.sym || U.sym))} will be placed on ${esc(c.ex === 'bybit' ? 'Bybit' : 'Binance')} with <b>real money</b>, ${money(n2(c.margin) * n2(c.lev))} a trade (${esc(c.margin)} USDT × ${esc(c.lev)}), without asking you.`;
    }
    const wt = A.d && A.d.webTrading === false ? '<br>Web trading is off: nothing live is placed until you send <code>/webtrade on</code> in Telegram.' : '';
    return `<div class="au-cf" role="alert"><b>Real money</b><p>${what} In our 3½-year test (Jan 2023 – Aug 2026) both setups lost after fees.${wt}</p>
      <div class="au-cfb"><button type="button" class="btn btn-danger btn-sm" data-au-act="yes"${A.busy ? ' disabled' : ''}>Yes, trade real money</button><button type="button" class="btn btn-secondary btn-sm" data-au-act="no">Cancel</button></div></div>`;
  }

  // ------------------------------------------------------------------ the lists
  function chartRow(c) {
    const s = A.d.status.charts.find(x => x.id === c.id) || {}, mine = c.sym === U.sym && c.ex === exNow();
    const state = !c.on ? 'Paused' : !cfg().on ? 'Auto trading is off' : s.busy ? 'In a trade (see Activity)' : s.err ? s.err : !s.inHours ? 'Outside its days / hours now' : s.note ? s.note[0].toUpperCase() + s.note.slice(1) : 'Starting…';
    const tone = !c.on || !cfg().on ? 'muted' : s.busy ? 'up' : s.err ? 'down' : '';
    return `<div class="au-row${mine ? ' mine' : ''}">
      <div class="au-r1"><b>${esc(coin(c.sym))}</b><span>${esc(setupWord(c))}</span><i class="au-tag ${c.mode}">${c.mode === 'live' ? 'Live' : 'Paper'}</i><span class="au-sz">${esc(c.margin)} × ${esc(c.lev)}</span></div>
      <div class="au-r2">${c.ex === 'bybit' ? 'Bybit' : 'Binance'} · ${c.side === 'both' ? 'long + short' : esc(c.side) + ' only'} · ${esc(daysWord(c.days))} · ${esc(hoursName(c.hours))} · ${s.today || 0} / ${c.maxDay} today</div>
      <div class="au-r3 ${tone}">${esc(state)}</div>
      <div class="au-btns"><button type="button" data-au-act="open" data-id="${esc(c.id)}">Open chart</button><button type="button" data-au-act="pause" data-id="${esc(c.id)}">${c.on ? 'Pause' : 'Resume'}</button><button type="button" data-au-act="remove" data-id="${esc(c.id)}">Remove</button></div>
      ${A.confirm && A.confirm.action === 'pause' && A.confirm.id === c.id ? confirmHtml(A.confirm) : ''}
    </div>`;
  }
  function planRow(p) {
    const res = { target: '✓ Target', stop: '✗ Stop', time: '6 h out', manual: 'Closed by hand', nofill: 'Not filled', gone: 'Gone', closed: 'Closed' };
    let r, tone = 'muted', sub = '';
    if (p.st === 'skip') { r = 'Skipped'; sub = p.why; }
    else if (p.st === 'fail') { r = 'Not placed'; tone = 'down'; sub = p.why; }
    else if (p.st === 'placing') r = 'Placing…';
    else if (p.st === 'wait') { r = 'Limit waiting'; tone = ''; }
    else if (p.st === 'open') { r = `Open${p.nowR != null ? ` ${p.nowR >= 0 ? '+' : ''}${p.nowR.toFixed(1)}R` : ''}${p.closing ? ' · closing' : ''}`; tone = p.nowR > 0 ? 'up' : p.nowR < 0 ? 'down' : ''; }
    else { r = (res[p.res] || p.res || 'Done') + (p.pnl != null ? ' ' + money(p.pnl, true) : ''); tone = p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : 'muted'; }
    if (p.st !== 'skip' && p.st !== 'fail') sub = `${p.kind === 'limit' ? 'limit' : 'entry'} ${fmt(p.fill || p.entry)} · stop ${fmt(p.stop)} · target ${fmt(p.target)}${p.note ? ' · ' + p.note : ''}`;
    return `<div class="au-ev"><span class="au-t">${when(p.conf - 60e3)}</span><span class="au-w"><b class="${p.dir === 1 ? 'up' : 'down'}">${p.dir === 1 ? '▲' : '▼'} ${esc(coin(p.sym))}</b> ${esc(setupWord(p))} · ${p.mode === 'live' ? 'live' : 'paper'}</span><span class="au-res ${tone}">${esc(r)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  }
  const fmt = v => { if (v == null || !isFinite(v)) return '—'; const d = Math.max(2, Math.min(8, 4 - Math.floor(Math.log10(Math.abs(+v) || 1)))); return (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d }); };

  // ------------------------------------------------------------------ the whole view
  function render() {
    const n = document.querySelector('[data-au-n]');
    const on = charts().filter(c => c.on).length;
    if (n) { n.hidden = !(cfg() && cfg().on && on); n.textContent = on; }
    if (A.sub !== 'auto') return;
    if (!A.d) { box.innerHTML = `<p class="au-empty">${A.err ? esc(A.err) : 'Loading auto trade…'}</p>`; return; }
    if (!A.form || A.fkey !== U.sym + '|' + exNow()) resetForm();
    const c = cfg(), st = A.d.status, liveOn = charts().some(x => x.on && x.mode === 'live');
    const plans = st.plans.filter(p => A.skips || p.st !== 'skip'), nskip = st.plans.filter(p => p.st === 'skip').length;
    const pnl = st.today.pnl || {}, pnlW = ['paper', 'live'].filter(k => pnl[k]).map(k => `${k} ${money(pnl[k], true)}`).join(' · ');
    box.innerHTML = `
      <div class="au-head"><span class="au-badge${c.on ? ' on' : ''}"><i></i>Auto trade</span>
        <button type="button" class="au-sw${c.on ? ' on' : ''}" role="switch" aria-checked="${c.on}" data-au-act="master"${A.busy ? ' disabled' : ''}><span></span>${c.on ? 'On' : 'Off'}</button></div>
      <p class="au-st">${c.on ? `On: the server checks ${on} chart${on === 1 ? '' : 's'} every minute, also with this page closed.` : 'Off: no new trades. Trades already placed keep their stop, target and plan.'}
        ${st.today.placed || pnlW ? `<br>Today (New York day): ${st.today.placed} placed${pnlW ? ' · closed ' + pnlW : ''}.` : ''}</p>
      ${A.confirm && A.confirm.action === 'master' ? confirmHtml(A.confirm) : ''}
      ${liveOn && A.d.webTrading === false ? `<div class="rx-block">${RD.util.ic('triangle-alert')}<div><b>Live charts are waiting</b><span>Web trading is off, so live setups are skipped. Send <code>/webtrade on</code> in Telegram to let them trade.</span></div></div>` : ''}
      ${A.err ? `<p class="au-msg down">${esc(A.err)}</p>` : ''}${st.paused ? '<p class="au-msg down">The exchange rate-limited the server: checks resume in a few minutes.</p>' : ''}
      <section class="au-card"><h4>This chart <span>${chartOk() ? `${esc(coin(U.sym))} · ${exNow() === 'bybit' ? 'Bybit' : 'Binance'}` : ''}</span></h4>${formHtml()}</section>
      <section class="au-card"><h4>Charts it trades <span>${charts().length} / ${MAXC}</span></h4>${charts().length ? charts().map(chartRow).join('') : '<p class="au-empty">None yet. Set one up above.</p>'}</section>
      <section class="au-card"><h4>Limits <span>all charts</span></h4>
        <div class="rx-two">
          <label class="fld"><span>Daily loss stop <em>USDT</em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-au-lim="dayLoss" value="${esc(c.dayLoss)}"></span></label>
          <label class="fld"><span>Max open <em>trades</em></span><span class="fld-in"><input inputmode="numeric" autocomplete="off" data-au-lim="maxOpen" value="${esc(c.maxOpen)}"></span></label>
        </div>
        <p class="au-plan">The day stop counts paper and live trades separately (0 = off). New trades stop until the New York day ends.</p></section>
      <section class="au-card"><h4>Activity <label class="au-sk"><input type="checkbox" data-au-skips${A.skips ? ' checked' : ''}> Skipped setups (${nskip})</label></h4>
        ${plans.length ? plans.map(planRow).join('') : `<p class="au-empty">${st.plans.length ? 'No trades yet: tick Skipped setups to see what it passed on and why.' : 'Nothing yet. Each setup it sees shows here: placed, skipped and why, and how it ended.'}</p>`}</section>
      <p class="rx-note">${esc(A.d.tested || '')} You decide what to run; the bot reports every order in Telegram. Not financial advice.</p>`;
  }

  // ------------------------------------------------------------------ clicks and typing
  function sub(v) {
    if (v) { A.sub = v === 'auto' ? 'auto' : 'order'; store.set('rd-au-sub', A.sub); }
    document.querySelectorAll('[data-rsub]').forEach(b => { const on = b.dataset.rsub === A.sub; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('[data-rsubpane]').forEach(p => { p.hidden = p.dataset.rsubpane !== A.sub; });
    if (v && A.sub === 'auto') { render(); load(); }
    return A.sub;
  }
  RD.realSub = sub;
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-rsub]'); if (b) sub(b.dataset.rsub); });

  box.addEventListener('click', e => {
    const t = e.target.closest('button, [data-au-skips]');
    if (!t || t.disabled) return;
    if (t.matches('[data-au-skips]')) { A.skips = t.checked; store.set('rd-au-skips', A.skips); render(); return; }
    if (t.dataset.auF) { A.form[t.dataset.auF] = t.dataset.v; A.confirm = null; A.msg = ''; render(); return; }
    if (t.dataset.auDay) { const d = +t.dataset.auDay, L = A.form.days; A.form.days = L.includes(d) ? L.filter(x => x !== d) : L.concat(d); render(); return; }
    const act = t.dataset.auAct, id = t.dataset.id;
    if (act === 'master') return send({ action: 'master', on: !cfg().on });
    if (act === 'save') {
      const f = A.form;
      if (!f.days.length) { A.msg = 'Pick at least one day.'; return render(); }
      return send({ action: 'save', chart: { sym: U.sym, ex: exNow(), setup: f.setup, tf: f.setup === 'aplus' ? f.tf : '', side: f.side, mode: f.mode, margin: n2(f.margin), lev: n2(f.lev), days: f.days, hours: f.hours, maxDay: n2(f.maxDay), on: true } });
    }
    if (act === 'yes' && A.confirm) return send({ ...A.confirm, confirm: true });
    if (act === 'no') { A.confirm = null; return render(); }
    const c = charts().find(x => x.id === id);
    if (!c) return;
    if (act === 'pause') return send({ action: 'pause', id, on: !c.on });
    if (act === 'remove') return send({ action: 'remove', id });
    if (act === 'open') {
      A.want = c.id;
      if (RD.R.on && RD.exitReplay) RD.exitReplay();
      if (c.sym !== U.sym || c.ex !== exNow()) RD.setSymbol(c.sym, c.ex);
      if (c.setup === 'aplus' && STF[U.tf] !== c.tf) RD.setTF(c.tf);
      const ind = document.querySelector(`[data-ind="${c.setup === 'aplus' ? 'aplus' : 'poi'}"]`);
      if (ind && !ind.checked) ind.click();
      A.fkey = ''; resetForm(); render();
      if (phone()) RD.closeSheets();
    }
  });
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.auIn) {
      A.form[t.dataset.auIn] = t.value;
      if (t.dataset.auIn === 'hours') return;
      const p = $('[data-au-pos]'), pos = n2(A.form.margin) * n2(A.form.lev);
      if (p) p.textContent = pos > 0 ? `Position ${money(pos)} a trade` : 'Margin and leverage must be numbers';
    }
  });
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.auIn === 'hours') { A.form.hours = t.value; return; }
    if (t.dataset.auLim) {
      const v = n2(t.value);
      if (!Number.isFinite(v)) { A.msg = 'Limits must be numbers.'; return render(); }
      send({ action: 'limits', [t.dataset.auLim]: v });
    }
  });

  // ------------------------------------------------------------------ the chart legend: this coin is auto-traded
  X.legend.push(() => {
    if (!A.d) return '';
    const L = charts().filter(c => c.sym === U.sym && c.ex === exNow());
    if (!L.length) return '';
    return L.map(c => {
      const s = A.d.status.charts.find(x => x.id === c.id) || {};
      const how = !c.on ? 'paused' : !cfg().on ? 'auto trading off' : s.busy ? 'in a trade' : !s.inHours ? 'outside its hours' : 'watching';
      return `<span title="Auto trade (Real → Auto trade): ${esc(setupWord(c))}, ${c.mode === 'live' ? 'LIVE money' : "the bot's paper account"}, ${esc(c.margin)} USDT × ${esc(c.lev)}"><b>🤖 Auto</b> ${esc(setupWord(c))} · ${c.mode === 'live' ? '<b class="down">live</b>' : 'paper'} · ${how}</span>`;
    }).join('');
  });

  // ------------------------------------------------------------------ when to read
  const visible = () => A.sub === 'auto' && !document.querySelector('[data-pane="real"]').hidden && (!phone() || document.querySelector('.dk-side').classList.contains('open'));
  RD.on('sym', () => { A.fkey = ''; if (A.d) { resetForm(); render(); } });
  RD.on('pane', p => { if (p === 'real' && A.sub === 'auto') load(); });
  setInterval(() => { if (document.hidden) return; const age = Date.now() - A.at; if ((visible() && age > 14000) || age > 60000) load(); }, 5000);
  sub(); load();
})();
