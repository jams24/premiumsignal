/* ReplayDesk · 🎓 Walk me through — the SMC coach from the classic Simulator, in the desk (every user).
   It reads the coin on 1-minute candles (one day, with 300 older candles of the structure timeframe in front) through
   the same engine as the SMC overlay (window.SMC) and walks through the chart in 7 steps. Each step adds one layer on
   the chart: swings → the break → premium / discount → the zone → liquidity + sweep → the 1m trigger → the plan.
   "Try it first" hides that step's layer and asks you to click the level; the answer shows after your click.
   In a replay it reads only candles the replay clock has closed, so it never sees the future. Practice, not signals. */
(function () {
  'use strict';
  const RD = window.__rd;
  if (!RD) return;
  const { U, R } = RD, u = RD.util, X = RD.ext;
  const { fp, esc, MIN, HOUR, DAY, TF } = u;
  const $ = (s, el) => (el || document).querySelector(s);
  const STFS = ['5m', '15m', '1H', '4H'];
  const LAYERS = ['swings', 'structure', 'range', 'zones', 'liq', 'setup', 'setup'];
  const TESTED = 'Practice, not signals: on the 207 coins our bot traded (14 Oct – 13 Nov 2026) these exact rules lost after fees (15m: −0.18R a trade over 6,014 setups; 5m: −0.12R over 6,834), no better than entering at a random time with the same stop and target.';
  const saved = RD.store.get('rd-coach-v1', null) || {};
  const C = { open: false, step: 0, quiz: false, fb: null, right: 0, tries: 0, tf: STFS.includes(saved.tf) ? saved.tf : '15m', A: null, base: [], hist: [], key: '', end: 0,
    gen: 0, busy: false, again: false, err: '', seen: Infinity, pick: null, min: !!saved.min, pos: saved.pos || null };
  const save = () => RD.store.set('rd-coach-v1', { tf: C.tf, min: C.min, pos: C.pos });

  // ---------------------------------------------------------------- words
  const tfMin = () => TF[C.tf].ms / MIN;
  const durName = m => m >= 1440 ? `${+(m / 1440).toFixed(1)} days` : m >= 60 ? `${+(m / 60).toFixed(1)} h` : `${m} min`;
  const endNow = () => (R.on ? R.clock : Date.now());
  // a time in words: the clock if it is the same UTC day as the chart's "now", else the date too (all UTC)
  const hm = t => { const d = new Date(t), n = new Date(endNow()), c = d.toISOString().slice(11, 16);
    return d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10) ? c : d.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }) + ' ' + c; };
  const sizeNow = () => { try { const t = RD.readT(); const v = (t.margin || 0) * (t.lev || 0); return v > 0 ? v : 150; } catch (e) { return 150; } };

  function steps(A) {
    const tfN = C.tf, leg = A.leg && !A.leg.dead ? A.leg : null, lb = A.breaks[A.breaks.length - 1];
    const sh = leg ? leg.dir === -1 : lb ? lb.dir === -1 : true;
    const w = sh ? { hl: 'high', pd: 'premium', zn: 'supply', ab: 'above', be: 'below', side: 'short', end: 'low' }
                 : { hl: 'low', pd: 'discount', zn: 'demand', ab: 'below', be: 'above', side: 'long', end: 'high' };
    const tol = Math.max(A.price * 0.003, (A.atr || 0) * 0.5);
    const tfBtn = U.tf === '1m' ? `<button type="button" class="cc-btn" data-cc="tf">Back to the ${tfN} chart</button>` : '<button type="button" class="cc-btn" data-cc="1m">Show the 1m chart</button>';
    const out = [];
    const sw = A.swings.slice(-6), lastS = A.swings.filter(s => s.side === (sh ? 'H' : 'L')).slice(-1)[0];
    out.push({ title: 'Read the swings', html:
      `<p>Every confirmed swing point is labelled on the chart. A swing high is a ${tfN} candle with ${A.len} lower highs on each side, so it is only confirmed ${A.len} candles (${durName(A.len * tfMin())}) later. On a live chart you can't know it sooner either.</p>` +
      `<p><b class="up">HH</b> + <b class="up">HL</b> (higher highs, higher lows) = uptrend. <b class="down">LH</b> + <b class="down">LL</b> = downtrend.</p>` +
      (sw.length ? `<p class="cc-chips">${sw.map(s => `<span class="${/HH|HL/.test(s.label) ? 'up' : /LH|LL/.test(s.label) ? 'down' : ''}"><b>${s.label}</b> ${fp(s.p)} <em>${hm(s.at || s.t)}</em></span>`).join('')}</p>` : '<p>No swing confirmed yet. Step forward a little.</p>') +
      '<p class="m">On each step, <b>Try it first</b> hides the answer so you can find the level yourself.</p>',
      quiz: lastS ? { ask: `Click the most recent swing ${w.hl}.`, ans: lastS.p, tol, why: `A swing ${w.hl} is a candle whose ${w.hl} has ${A.len} candles with ${sh ? 'lower highs' : 'higher lows'} on each side. The newest one is at ${hm(lastS.t)}.` } : null });

    let h2;
    if (!lb) h2 = '<p>No structure break on this chart yet. Keep stepping forward; the coach updates as you go.</p>';
    else {
      h2 = `<p>At <b>${hm(lb.t)}</b> a ${tfN} candle closed at <b>${fp(lb.close)}</b>, ${lb.dir === -1 ? 'below' : 'above'} the last swing ${lb.dir === -1 ? 'low' : 'high'} at <b>${fp(lb.p)}</b> (from ${hm(lb.fromT)}).</p>` +
        (lb.kind === 'CHoCH' ? `<p>That's a <b>CHoCH</b> (change of character): the first close against the ${lb.dir === -1 ? 'uptrend' : 'downtrend'}. The bias flips to <b class="${lb.dir === -1 ? 'down' : 'up'}">${lb.dir === -1 ? 'shorts' : 'longs'}</b>.</p>`
          : `<p>That's a <b>BOS</b> (break of structure): a break in the same direction as the trend, so the ${lb.dir === -1 ? 'downtrend' : 'uptrend'} carries on. The bias stays <b class="${lb.dir === -1 ? 'down' : 'up'}">${lb.dir === -1 ? 'short' : 'long'}</b>.</p>`) +
        '<p>Only a candle <b>close</b> counts. A wick through the level that closes back is a sweep (step 5), not a break.</p>' +
        (!leg ? '<p>Since then price closed back past the start of that move, so this idea is cancelled. Wait for the next break.</p>' : '');
    }
    out.push({ title: 'Spot the break (CHoCH / BOS)', html: h2, quiz: lb ? { ask: 'Click the level that broke.', ans: lb.p, tol, why: `It's the last swing ${lb.dir === -1 ? 'low' : 'high'} before the breaking candle (${hm(lb.fromT)}): the line that a candle body closed through.` } : null });

    if (!leg) {
      const none = '<p>This step needs a live idea: a break that price hasn\'t cancelled. Step forward (or wait on the live chart) until the coach shows one.</p>';
      out.push({ title: 'Premium or discount?', html: none }, { title: 'Mark the zone', html: none }, { title: 'Liquidity and the sweep', html: none }, { title: 'The trigger: 1m CHoCH', html: none + tfBtn }, { title: 'Plan the trade', html: none });
      return out;
    }
    const eq = (leg.hi + leg.lo) / 2, at = (A.price - leg.lo) / ((leg.hi - leg.lo) || 1);
    out.push({ title: 'Premium or discount?', html:
      `<p>The move that broke structure runs from <b>${fp(sh ? leg.hi : leg.lo)}</b> to <b>${fp(sh ? leg.lo : leg.hi)}</b> so far. Halfway is <b>${fp(eq)}</b>.</p>` +
      `<p>Above halfway is <b class="down">premium</b> (expensive), below is <b class="up">discount</b> (cheap). Sell in premium, buy in discount. For this ${w.side}, wait for price to come back ${w.ab} ${fp(eq)}.</p>` +
      `<div class="cc-meter" title="Where price is in the leg"><i style="left:${Math.round(Math.max(0, Math.min(1, at)) * 100)}%"></i><span>discount</span><span>premium</span></div>` +
      `<p>Price now: <b>${fp(A.price)}</b>, ${Math.round(Math.max(0, Math.min(1, at)) * 100)}% of the way up the leg → <b>${at >= 0.5 ? 'premium' : 'discount'}</b>. ` +
      (leg.prem ? `It reached ${w.pd} at ${hm(leg.prem.t)} ✓</p>` : `It hasn't reached ${w.pd} yet.</p>`),
      quiz: { ask: 'Click where the 50% line of the leg is.', ans: eq, tol: Math.max(tol, (leg.hi - leg.lo) * 0.08), why: `Take the ${sh ? 'top' : 'bottom'} of the move (${fp(sh ? leg.hi : leg.lo)}) and its ${sh ? 'lowest low' : 'highest high'} so far (${fp(sh ? leg.lo : leg.hi)}); the middle is the line.` } });

    const z = leg.zone;
    out.push({ title: `Mark the ${w.zn} zone`, html: z
      ? `<p>The last ${sh ? 'up' : 'down'} candle before the move (${hm(z.t)}) marks the <b>${w.zn} zone</b>: <b>${fp(z.bot)} – ${fp(z.top)}</b>. The orders that started the move came from there, so price often reacts when it returns.</p>` +
        `<p>The zone is dead once a ${tfN} candle closes ${sh ? 'above ' + fp(z.top) : 'below ' + fp(z.bot)}. ` + (z.broken ? 'That has happened.' : leg.inZone ? `Price came back into it at ${hm(leg.inZone.t)} ✓` : 'Price hasn\'t come back to it yet.') + '</p>'
      : '<p>No clean zone on this move.</p>',
      quiz: z ? { ask: sh ? 'Click the top of the supply zone.' : 'Click the bottom of the demand zone.', ans: sh ? z.top : z.bot, tol: Math.max(tol, (z.top - z.bot) * 0.5), why: `Find the ${sh ? 'highest point' : 'lowest point'} of the move, then the last ${sh ? 'green' : 'red'} candle at or just before it. The zone spans that candle's body to the ${sh ? 'top' : 'bottom'} of the move.` } : null });

    const lv = A.liq.filter(l => l.side === (sh ? 'H' : 'L') && (sh ? l.p > A.price : l.p < A.price)).sort((a, b) => sh ? a.p - b.p : b.p - a.p);
    const near = lv[0], eqs = A.eqs.filter(e => !e.taken && e.side === (sh ? 'H' : 'L'));
    out.push({ title: 'Liquidity and the sweep', html:
      `<p>Stop-losses pile up just ${sh ? 'above old highs' : 'below old lows'}, most of all at <b>equal ${sh ? 'highs (EQH)' : 'lows (EQL)'}</b>. Price often runs through them to fill big orders, then turns. A wick through the level that <b>closes back</b> is the <b>sweep</b>.</p>` +
      `<p>${near ? `Nearest untaken ${sh ? 'high above' : 'low below'} price: <b>${fp(near.p)}</b> (${near.kind === 'swing' ? 'swing ' + w.hl : near.kind}, ${hm(near.t)}).` : `No untaken ${sh ? 'highs above' : 'lows below'} price on the ${tfN} chart.`}` +
      (eqs.length ? ` Equal ${sh ? 'highs' : 'lows'}: ${eqs.slice(-3).map(e => fp(e.p)).join(', ')}.` : '') + '</p>' +
      (leg.sweep ? `<p>✓ At ${hm(leg.sweep.t)} a ${tfN} candle wicked to <b>${fp(leg.sweep.wick)}</b>, through the ${fp(leg.sweep.p)} level, and closed back at ${fp(leg.sweep.close)}: liquidity swept in ${w.pd}.</p>`
        : leg.last ? `<p>The last sweep on this move (${hm(leg.last.sweep.t)}) already gave a setup. A new one needs a new sweep.</p>`
        : `<p>No sweep in ${w.pd} yet. Wait for a ${tfN} candle to wick ${w.ab} a level like this and close back.</p>`),
      quiz: near ? { ask: `Click the nearest ${sh ? 'high above' : 'low below'} price where stops are resting.`, ans: near.p, tol, why: `Look ${sh ? 'up' : 'down'} from the current price for the first swing ${w.hl} that no candle has traded through since. That's at ${hm(near.t)}.` } : null });

    const tg = leg.trig, ls = leg.last;
    out.push({ title: 'The trigger: 1m CHoCH', html:
      `<p>After the sweep, drop to the <b>1m</b> chart. Find the last 1m ${sh ? 'higher low' : 'lower high'} before the sweep's ${sh ? 'top' : 'bottom'}. A 1m candle that <b>closes ${w.be}</b> it means the small timeframe has turned too. That's the entry trigger.</p>` +
      (leg.sweep && tg ? `<p>Here the level is <b>${fp(tg.p)}</b> (1m swing at ${hm(tg.t)}), the blue line. Waiting for a 1m close ${w.be} it, within 90 minutes of the sweep.</p>` : '') +
      (ls ? `<p>✓ The last trigger on this move: at <b>${hm(ls.t)}</b> a 1m candle closed at ${fp(ls.entry)}, ${w.be} ${fp(ls.trig.p)}.</p>` : '') +
      (!leg.sweep && !ls ? '<p>This step comes after a sweep. Keep stepping forward.</p>' : '') +
      tfBtn,
      quiz: leg.sweep && tg ? { ask: 'Switch to 1m if you like, then click the 1m level that has to break.', ans: tg.p, tol: Math.max(A.price * 0.002, tol * 0.5), why: `It's the last 1m swing ${sh ? 'low' : 'high'} before the sweep ${sh ? 'high' : 'low'} (${hm(tg.t)}).` } : null });

    let h7;
    if (ls) {
      const size = sizeNow(), rk = Math.abs(ls.stop - ls.entry) / ls.entry;
      h7 = `<div class="cc-plan"><span><em>Entry</em><b>${fp(ls.entry)}</b></span><span class="down"><em>Stop</em><b>${fp(ls.stop)}</b></span><span class="up"><em>Target</em><b>${fp(ls.target)}</b></span><span><em>R</em><b>${ls.R.toFixed(1)}R</b></span></div>` +
        `<p><b>Entry</b> is the trigger close · <b>stop</b> just ${w.ab} the sweep wick · <b>target</b> ${ls.tgtKind === 'leg' ? `the ${w.end} of the move, where the next stops sit` : `2R (the ${w.end} of the move was too close)`}.</p>` +
        `<p>Risk ${(rk * 100).toFixed(1)}% · reward ${(Math.abs(ls.target - ls.entry) / ls.entry * 100).toFixed(1)}% → <b>${ls.R.toFixed(1)}R</b>. On $${size.toFixed(0)} the stop costs about $${(size * rk + 2 * size * RD.FEE_T).toFixed(2)} with fees.` +
        (ls.R < 1.5 ? ' Under 1.5R: many traders pass on this one.' : '') + '</p>' +
        (rk > 0.08 ? `<p>⚠ This stop is wider than the bot's 8%. To risk the same dollars as an 8% stop on $${size.toFixed(0)}, trade about <b>$${(size * 0.08 / rk).toFixed(0)}</b> instead.</p>` : '') +
        '<button type="button" class="cc-btn go" data-cc="use">⚡ Load this plan on the chart (paper)</button>';
    } else h7 = `<p>No trigger yet, so no plan. When it triggers: enter on the 1m close, stop just ${w.ab} the sweep wick, target the ${w.end} of the move (or 2R if that's too close). Look for 1.5R or more.</p>`;
    out.push({ title: 'Plan the trade', html: h7 + `<p class="m">${TESTED}</p>` });
    return out;
  }

  // ---------------------------------------------------------------- data: 1m candles closed by the clock (+ older structure candles)
  const keyNow = () => [U.sym, U.ex, C.tf, R.on ? 'r' : 'l'].join('|');
  async function load(full) {
    if (!C.open) return;
    if (C.busy) { C.again = true; return; }
    const g = C.gen, key = keyNow(), end = Math.floor(endNow() / MIN) * MIN, sym = U.sym, ex = U.ex, tf = C.tf;
    if (!full && key === C.key && end === C.end) return;
    C.busy = true;
    try {
      if (full || key !== C.key || end < C.end || end - C.end > DAY || C.base.length > 4000) {
        C.key = key; C.A = null; C.err = ''; C.base = []; render(); RD.req();
        const base = (await u.fetchRange(sym, '1m', end - DAY, end, ex)).filter(k => k[0] + MIN <= end);
        if (g !== C.gen || key !== keyNow()) return;
        if (!base.length) throw new Error(`No 1-minute candles for ${u.coin(sym)} on ${u.api(ex).name} before ${u.tnice(end)}.`);
        let hist = [];
        try { hist = (await u.api(ex).klines(sym, tf, { end: base[0][0] - 1, limit: 300 })).filter(k => k[0] < base[0][0]); } catch (e) { /* the day of minutes alone */ }
        if (g !== C.gen || key !== keyNow()) return;
        C.base = base; C.hist = hist; C.end = end; C.seen = Infinity;
      } else if (end > C.end) {
        const ks = await u.fetchRange(sym, '1m', C.end, end, ex);
        if (g !== C.gen || key !== C.key) return;
        for (const k of ks) if (k[0] >= C.end && k[0] + MIN <= end) C.base.push(k);
        C.end = end;
      }
      analyze();
    } catch (e) { if (g === C.gen) { C.err = e.message || String(e); render(); } }
    finally { C.busy = false; if (C.again && C.open) { C.again = false; setTimeout(() => load(), 30); } }
  }
  function analyze() {
    if (!window.SMC || !C.base.length) { C.A = null; render(); return; }
    const ms = TF[C.tf].ms;
    try { C.A = window.SMC.analyze(C.base, C.base.length - 1, { tf: ms, hist: C.hist.length ? { k: C.hist, step: ms } : null }); C.err = ''; }
    catch (e) { C.A = null; C.err = 'The SMC engine could not read this chart.'; }
    const A = C.A, l = A && A.setups.length ? A.setups[A.setups.length - 1] : null, conf = l ? l.conf : 0;
    if (C.seen === Infinity) C.seen = conf;
    else if (conf > C.seen) {   // a new A+ setup confirmed while you watch: pause the replay there (like the classic coach)
      C.seen = conf;
      if (R.on && R.playing) RD.pause();
      RD.toast(`🎯 A+ ${l.side} on ${u.coin(U.sym)} at ${hm(l.t)} · entry ${fp(l.entry)}, stop ${fp(l.stop)}, ${l.R.toFixed(1)}R — step 7 has the plan.`, l.side === 'long' ? 'up' : 'down');
    }
    render(); RD.req();
  }

  // ---------------------------------------------------------------- the card
  const host = $('.dk-chart');
  const card = document.createElement('section');
  card.className = 'dk-coach'; card.hidden = true; card.setAttribute('aria-label', 'SMC coach');
  card.innerHTML = `<header class="cc-head" data-cc-drag>
      <span class="cc-ic" aria-hidden="true">🎓</span><b>Walk me through</b><span class="cc-sp"></span>
      <select class="cc-tf" data-cc-tf aria-label="Structure timeframe" title="Structure timeframe: the candles the coach reads swings and breaks on">${STFS.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
      <button type="button" class="cc-ib" data-cc="min" aria-label="Minimise" title="Minimise">${u.ic('chevron-down')}</button>
      <button type="button" class="cc-ib" data-cc="x" aria-label="Close the coach" title="Close">${u.ic('x')}</button>
    </header>
    <div class="cc-prog"><div class="cc-bar" data-cc-bar role="tablist" aria-label="Steps"></div><span class="cc-n" data-cc-n></span></div>
    <div class="cc-body" data-cc-body><h4 data-cc-title></h4><div class="cc-text" data-cc-text></div><div class="cc-fb" data-cc-fb hidden></div></div>
    <footer class="cc-foot">
      <button type="button" class="cc-btn" data-cc="back">${u.ic('chevron-left')} Back</button>
      <button type="button" class="cc-btn try" data-cc="try">Try it first</button>
      <button type="button" class="cc-btn go" data-cc="next">Next ${u.ic('chevron-right')}</button>
    </footer>`;
  if (host) host.appendChild(card);
  const el = s => $(s, card);

  function render() {
    card.hidden = !C.open;
    document.querySelectorAll('[data-act="coach"]').forEach(b => { b.setAttribute('aria-pressed', String(C.open)); b.classList.toggle('on', C.open); });
    if (!C.open) return;
    card.classList.toggle('min', C.min);
    el('[data-cc-tf]').value = C.tf;
    el('[data-cc="min"]').innerHTML = u.ic(C.min ? 'chevron-up' : 'chevron-down');
    el('[data-cc="min"]').setAttribute('aria-label', C.min ? 'Expand' : 'Minimise');
    const A = C.A, title = el('[data-cc-title]'), text = el('[data-cc-text]'), fb = el('[data-cc-fb]');
    const foot = el('.cc-foot');
    if (!A) {
      el('[data-cc-n]').textContent = '';
      el('[data-cc-bar]').innerHTML = LAYERS.map(() => '<i></i>').join('');
      title.textContent = C.err ? 'Could not read this chart' : `Reading ${u.coin(U.sym)} on ${C.tf}…`;
      text.innerHTML = C.err ? `<p>${esc(C.err)}</p><button type="button" class="cc-btn" data-cc="retry">Try again</button>` : '<p class="m"><span class="cc-spin"></span> One day of 1-minute candles + the older ' + C.tf + ' candles.</p>';
      fb.hidden = true; foot.hidden = true; return;
    }
    foot.hidden = false;
    const st = steps(A), s = st[C.step], q = s.quiz;
    el('[data-cc-n]').textContent = `${C.step + 1}/${st.length}` + (C.tries ? ` · quiz ${C.right}/${C.tries}` : '');
    el('[data-cc-n]').title = `Step ${C.step + 1} of ${st.length}` + (C.tries ? ` · quiz: ${C.right} right of ${C.tries}` : '');
    el('[data-cc-bar]').innerHTML = st.map((x, i) => `<button type="button" role="tab" class="${i < C.step ? 'done' : i === C.step ? 'on' : ''}" data-cc-go="${i}" aria-label="Step ${i + 1}: ${esc(x.title)}" title="${i + 1} · ${esc(x.title)}"></button>`).join('');
    title.textContent = `${C.step + 1} · ${s.title}`;
    text.innerHTML = C.quiz && q ? `<p class="cc-ask"><b>${q.ask}</b></p><p class="m">Click the chart. The answer stays hidden until you do.</p>` : s.html;
    fb.hidden = !C.fb;
    if (C.fb) { fb.className = 'cc-fb ' + C.fb.cls; fb.innerHTML = C.fb.html; }
    const tr = el('[data-cc="try"]'); tr.hidden = !q || !!C.fb; tr.textContent = C.quiz ? 'Show me' : 'Try it first';
    el('[data-cc="back"]').disabled = C.step === 0; el('[data-cc="next"]').disabled = C.step === st.length - 1;
  }

  function go(i) {
    C.step = Math.max(0, Math.min(LAYERS.length - 1, i)); endQuiz(); C.fb = null; C.pick = null;
    render(); RD.req(); RD.syncLines();
    const b = el('[data-cc-body]'); if (b) b.scrollTop = 0;
  }
  function endQuiz() { if (C.quiz) { C.quiz = false; const P = RD.PICK; if (P && P.field === 'coach') RD.clearPick(); } }
  function tryIt() {
    const A = C.A; if (!A) return;
    const q = steps(A)[C.step].quiz; if (!q) return;
    if (C.quiz) { endQuiz(); C.fb = { cls: 'near', html: 'Here it is on the chart. Compare it with where you would have put it.' }; render(); RD.req(); return; }
    C.quiz = true; C.fb = null; C.pick = null;
    RD.startPick('field', 'coach', answer, 'your answer', true);
    RD.hint(`🎓 ${esc(q.ask)}`, [['Show me', tryIt]]);
    render(); RD.req(); RD.syncLines();
  }
  function answer(p) {
    const A = C.A; if (!A || !C.quiz) return;
    const q = steps(A)[C.step].quiz; C.quiz = false; if (!q) { render(); RD.req(); return; }
    const d = Math.abs(p - q.ans), good = d <= q.tol, near = !good && d <= 3 * q.tol;
    C.tries++; if (good) C.right++;
    C.pick = p;
    C.fb = { cls: good ? 'good' : near ? 'near' : 'bad', html: (good ? '✓ Spot on.' : near ? 'Close.' : 'Not quite.') +
      ` You clicked <b>${fp(p)}</b>; the answer is <b>${fp(q.ans)}</b> (${(d / q.ans * 100).toFixed(1)}% away).` + (good ? '' : ' ' + q.why) };
    render(); RD.req(); RD.syncLines();
  }
  function useSetup() {
    const A = C.A, ls = A && A.leg && !A.leg.dead ? A.leg.last : null; if (!ls) return;
    RD.qPlan({ side: ls.side === 'long' ? 1 : -1, entry: ls.entry, sl: ls.stop, tp: ls.target, mkt: false });
    if (u.phone()) { C.min = true; save(); render(); }   // the plan bar sits where the card is on a phone
    RD.toast('The plan is on the chart as a paper ⚡ plan: drag a line to change it, then Place.', 'up');
  }

  function open(on) {
    if (on === C.open) return;
    C.open = on; C.gen++;
    if (on) {
      if (STFS.includes(U.tf)) C.tf = U.tf;
      C.step = 0; C.fb = null; C.pick = null; C.key = ''; C.seen = Infinity;
      if (u.phone()) RD.closeSheets();
      placeCard(); load(true);
    } else { endQuiz(); C.A = null; C.base = []; C.hist = []; C.key = ''; RD.hint(); }
    X.smcOff = C.open;
    save(); render(); RD.req(); RD.refreshMarkers(); RD.syncLines();
  }

  card.addEventListener('click', e => {
    const gi = e.target.closest('[data-cc-go]'); if (gi) { go(+gi.dataset.ccGo); return; }
    const b = e.target.closest('[data-cc]'); if (!b) return;
    const a = b.dataset.cc;
    if (a === 'x') open(false);
    else if (a === 'min') { C.min = !C.min; save(); render(); placeCard(); }
    else if (a === 'back') go(C.step - 1);
    else if (a === 'next') go(C.step + 1);
    else if (a === 'try') tryIt();
    else if (a === 'retry') load(true);
    else if (a === '1m') RD.setTF('1m');
    else if (a === 'tf') RD.setTF(C.tf);
    else if (a === 'use') useSetup();
  });
  el('[data-cc-tf]').addEventListener('change', e => { C.tf = e.target.value; save(); go(0); load(true); });
  document.addEventListener('click', e => { if (e.target.closest('[data-act="coach"]')) open(!C.open); });
  document.addEventListener('keydown', e => {
    if (!C.open || e.target.closest('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ']' ) { go(C.step + 1); e.preventDefault(); } else if (e.key === '[') { go(C.step - 1); e.preventDefault(); }
  });

  // drag the card by its header (desktop); it stays inside the chart and remembers where you put it
  function placeCard() {
    if (!host || card.hidden && !C.open) return;
    if (u.phone() || !C.pos) { card.style.left = ''; card.style.top = ''; card.style.right = ''; card.style.bottom = ''; return; }
    const hw = host.clientWidth, hh = host.clientHeight, w = card.offsetWidth || 340, h = card.offsetHeight || 60;
    card.style.left = Math.max(6, Math.min(hw - w - 6, C.pos.l * hw)) + 'px';
    card.style.top = Math.max(6, Math.min(hh - h - 6, C.pos.t * hh)) + 'px';
    card.style.right = 'auto'; card.style.bottom = 'auto';
  }
  const drag = el('[data-cc-drag]');
  drag.addEventListener('pointerdown', e => {
    if (u.phone() || e.button !== 0 || e.target.closest('button, select')) return;
    const r = card.getBoundingClientRect(), hr = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    drag.setPointerCapture(e.pointerId); card.classList.add('drag');
    const mv = ev => {
      const l = Math.max(6, Math.min(hr.width - r.width - 6, ev.clientX - hr.left - dx)), t = Math.max(6, Math.min(hr.height - r.height - 6, ev.clientY - hr.top - dy));
      card.style.left = l + 'px'; card.style.top = t + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto';
    };
    const up = () => {
      drag.removeEventListener('pointermove', mv); drag.removeEventListener('pointerup', up); drag.removeEventListener('pointercancel', up); card.classList.remove('drag');
      C.pos = { l: card.offsetLeft / Math.max(1, host.clientWidth), t: card.offsetTop / Math.max(1, host.clientHeight) }; save();
    };
    drag.addEventListener('pointermove', mv); drag.addEventListener('pointerup', up); drag.addEventListener('pointercancel', up);
  });
  drag.addEventListener('dblclick', e => { if (e.target.closest('button, select')) return; C.pos = null; save(); placeCard(); });
  if (window.ResizeObserver && host) new ResizeObserver(() => { if (C.open) placeCard(); }).observe(host);

  // ---------------------------------------------------------------- on the chart: the layers so far (the quiz hides this step's)
  const show = k => LAYERS.slice(0, C.step + 1).includes(k) && !(C.quiz && LAYERS[C.step] === k);
  X.draw.push((g, W, z) => {
    if (!C.open || !C.A) return;
    const A = C.A, COL = RD.COL, leg = A.leg && !A.leg.dead ? A.leg : null;
    const X0 = t => { const x = RD.t2x(t); return x == null ? null : Math.max(-20, Math.min(W + 20, x)); }, Y = p => RD.p2y(p);
    const okN = (...v) => v.every(n => n != null && isFinite(n));
    const line = (x0, x1, y, c, dash, w) => { if (!okN(x0, x1, y)) return; g.strokeStyle = c; g.lineWidth = w || 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); };
    const tag = (t, x, y, c, al) => { if (okN(x, y)) RD.label(g, t, x, y, c, al || 'left'); };
    const red = COL.down, green = COL.up, gold = '#f5b301', blue = '#60a5fa';
    if (z === 'bottom') {
      if (leg && show('range')) {
        const x0 = X0(leg.dir === -1 ? leg.hiT : leg.loT), yh = Y(leg.hi), yl = Y(leg.lo), ye = Y((leg.hi + leg.lo) / 2);
        if (okN(x0, yh, yl, ye)) { g.fillStyle = u.hexA(red, 0.07); g.fillRect(x0, yh, W - x0, ye - yh); g.fillStyle = u.hexA(green, 0.07); g.fillRect(x0, ye, W - x0, yl - ye); }
      }
      if (show('zones')) for (const zn of A.zones.filter(q => !q.broken).slice(-3)) {
        const x0 = X0(zn.t), y0 = Y(zn.top), y1 = Y(zn.bot); if (!okN(x0, y0, y1)) continue;
        const c = zn.type === 'demand' ? green : red, main = leg && leg.zone && leg.zone.t === zn.t;
        g.fillStyle = u.hexA(c, main ? 0.16 : 0.08); g.fillRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
        g.strokeStyle = u.hexA(c, main ? 0.8 : 0.4); g.lineWidth = 1; g.strokeRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      }
      return;
    }
    if (leg && show('range')) {
      const x0 = X0(leg.dir === -1 ? leg.hiT : leg.loT), eq = (leg.hi + leg.lo) / 2;
      line(x0, W, Y(leg.hi), u.hexA(red, 0.55), [2, 3]); line(x0, W, Y(leg.lo), u.hexA(green, 0.55), [2, 3]);
      line(x0, W, Y(eq), u.hexA(COL.text, 0.6), [6, 4], 1.2);
      tag('50% · EQ', W - 6, Y(eq) - 10, COL.text, 'right'); tag('Premium', W - 6, Y(leg.hi) + 10, red, 'right'); tag('Discount', W - 6, Y(leg.lo) - 10, green, 'right');
    }
    if (show('zones')) for (const zn of A.zones.filter(q => !q.broken).slice(-3)) {
      const sup = zn.type === 'supply'; tag(sup ? 'Supply zone' : 'Demand zone', X0(zn.t) + 3, Y(sup ? zn.top : zn.bot) + (sup ? -10 : 10), sup ? red : green);
    }
    if (show('swings')) {
      g.font = '600 10px "Geist Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const s of A.swings.slice(-40)) {
        const x = X0(s.at || s.t), y = Y(s.p); if (!okN(x, y) || x < 0 || x > W) continue;
        g.fillStyle = /HH|HL/.test(s.label) ? green : /LH|LL/.test(s.label) ? red : COL.muted;
        g.fillText(s.label, x, s.side === 'H' ? y - 10 : y + 11);
      }
      g.textAlign = 'left';
    }
    if (show('structure')) for (const b of A.breaks.slice(-10)) {
      const x1 = X0(b.fromT), x2 = X0(b.t), y = Y(b.p), c = b.dir === -1 ? red : green;
      line(x1, x2, y, c, b.kind === 'BOS' ? [4, 3] : [], b.kind === 'CHoCH' ? 1.6 : 1);
      if (okN(x1, x2, y)) tag(b.kind, (x1 + x2) / 2, y + (b.dir === -1 ? 10 : -10), c, 'center');
    }
    if (show('liq')) {
      const side = leg ? (leg.dir === -1 ? 'H' : 'L') : null, eq = leg ? (leg.hi + leg.lo) / 2 : 0;
      if (leg) for (const l of A.liq.filter(q => q.kind === 'swing' && q.side === side && (side === 'H' ? q.p >= eq : q.p <= eq)).slice(-4)) line(X0(l.t), W, Y(l.p), u.hexA(gold, 0.6), [1, 3]);
      for (const e of A.eqs.filter(q => !q.taken).slice(-4)) { line(X0(e.t1), W, Y(e.p), gold, [3, 3], 1.2); tag(e.kind + ' · stops', X0(e.t1), Y(e.p) + (e.side === 'H' ? -10 : 10), gold); }
      for (const s of A.sweeps.slice(-5)) {
        line(X0(s.levelT), X0(s.t), Y(s.p), gold, [1, 2]);
        const x = X0(s.wickT || s.t), y = Y(s.wick); if (okN(x, y)) tag('✕ sweep', x, s.dir === -1 ? y - 11 : y + 11, gold, 'center');
      }
    }
    if (leg && show('setup')) {
      const tg = leg.trig, ls = leg.last;
      if (leg.sweep && tg) { line(X0(tg.t), W, Y(tg.p), blue, [5, 3], 1.4); tag('1m trigger', W - 6, Y(tg.p) + (leg.dir === -1 ? 10 : -10), blue, 'right'); }
      if (ls && C.step === 6) {
        const x0 = X0(ls.t);
        line(x0, W, Y(ls.entry), blue, [], 1.6); tag('Entry ' + fp(ls.entry), x0 + 4, Y(ls.entry) - 10, blue);
        line(x0, W, Y(ls.stop), red, [], 1.4); tag('Stop', x0 + 4, Y(ls.stop) + (ls.side === 'long' ? 10 : -10), red);
        line(x0, W, Y(ls.target), green, [], 1.4); tag(`Target · ${ls.R.toFixed(1)}R`, x0 + 4, Y(ls.target) + (ls.side === 'long' ? -10 : 10), green);
      }
    }
  });
  X.lines.push(() => (C.open && C.pick != null ? [{ key: 'coach-pick', price: C.pick, color: '#a78bfa', style: RD.LS.Solid, w: 1, title: 'your pick' }] : []));

  // ---------------------------------------------------------------- keep up with the chart
  RD.on('load', () => {
    if (!C.open) return;
    if (STFS.includes(U.tf) && U.tf !== C.tf) { C.tf = U.tf; save(); C.step = Math.min(C.step, LAYERS.length - 1); }
    render(); RD.req(); load();   // the step text follows the chart (1m button vs back to the structure chart)
  });
  RD.on('sym', () => { if (C.open) { C.gen++; C.busy = false; C.A = null; C.key = ''; endQuiz(); C.fb = null; C.pick = null; render(); RD.req(); } });
  RD.on('mode', () => { if (C.open) { C.gen++; C.busy = false; C.key = ''; endQuiz(); load(true); } });
  RD.on('tick', () => {
    if (!C.open) return;
    if (C.quiz && (!RD.PICK || RD.PICK.field !== 'coach')) { C.quiz = false; render(); RD.req(); }   // the pick was cancelled (Esc, another tool)
    if (Math.floor(endNow() / MIN) * MIN > C.end && C.key === keyNow()) load();
  });
  setInterval(() => { if (C.open && !R.on && !document.hidden) load(); }, 20000);
  window.__rdCoach = { C, open, go, answer, steps, load };   // for tests
})();
