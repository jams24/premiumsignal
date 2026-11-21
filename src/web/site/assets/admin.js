// ReplayDesk admin console: draws the bot's trades and P&L from its read-only /api/trades and /api/trade-stats.
// The admin session cookie authorises those calls. Nothing here places, closes or changes a trade.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  const usd = (v, sign = true) => { const n = num(v); return (sign && n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const tone = v => num(v) > 0 ? 'up' : num(v) < 0 ? 'down' : '';
  const price = p => { const n = num(p); if (!n) return '—'; const a = Math.abs(n); return a >= 100 ? n.toFixed(2) : a >= 1 ? n.toFixed(4) : a >= 0.01 ? n.toFixed(5) : n.toPrecision(4); };
  const dur = min => { min = Math.max(0, Math.round(min)); return min < 60 ? min + 'm' : min < 1440 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : Math.floor(min / 1440) + 'd ' + Math.floor(min % 1440 / 60) + 'h'; };
  const when = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
  const REASON = { tp1: 'TP1', tp2: 'TP2', tp3: 'TP3', tp4: 'TP4', sl: 'Stop loss', sl_breakeven: 'Breakeven stop', max_loss: 'Max-loss cap', invalidated: 'Invalidated', time_exit: 'Time exit', manual: 'Manual close' };
  const reason = r => REASON[r] || (r ? String(r).replace(/_/g, ' ') : '—');
  const reasonTone = r => /^tp/i.test(r || '') ? 'up' : r === 'sl' || r === 'max_loss' ? 'down' : '';
  const SRC = { onchain: 'Onchain', demandzone: 'Demand zone', main: 'Main', swing: 'Swing' };
  const side = d => `<span class="side ${d === 'long' ? 'up' : 'down'}">${d === 'long' ? 'Long' : 'Short'}</span>`;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };

  async function api(path, params) {
    const q = new URLSearchParams(Object.assign({}, params, { _t: Date.now() }));
    const r = await fetch(path + '?' + q, { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) throw new Error('Not authorised: your admin session ended. Sign in again.');
    if (!r.ok) throw new Error('The bot answered ' + r.status + '.');
    return r.json();
  }

  // ---------------------------------------------------------------- overview: bot tiles + open positions
  async function overview(root) {
    const st = $('[data-bot-status]', root), tiles = $('[data-bot-tiles]', root), mini = $('[data-open-mini]', root);
    try {
      const [s, t] = await Promise.all([api('/api/trade-stats', {}), api('/api/trades', { period: 'today', limit: 10 })]);
      const m = s.summary || {}, open = t.open || [];
      const tile = (k, v, sub, cls) => `<div class="adm-tile"><span>${k}</span><b class="${cls || ''}">${v}</b><em>${sub}</em></div>`;
      const per = k => tile({ today: 'Today', week: '7 days', month: '30 days', all: 'All time' }[k], usd(m[k + '_pnl']), `${num(m[k + '_count'])} trades · ${num(m[k + '_wins'])}W ${num(m[k + '_losses'])}L`, tone(m[k + '_pnl']));
      tiles.innerHTML = tile('Open trades', open.length, open.length ? open.map(o => esc(o.symbol.replace(/USDT$/, ''))).slice(0, 3).join(' · ') + (open.length > 3 ? ' …' : '') : 'none right now') + per('today') + per('week') + per('month') + per('all');
      st.className = 'adm-live on'; st.innerHTML = '<i></i>Bot API connected';
      mini.innerHTML = open.length ? openTable(open) : '';
    } catch (e) {
      st.className = 'adm-live off'; st.innerHTML = '<i></i>' + esc(e.message);
      tiles.innerHTML = '<p class="adm-empty">Bot numbers are not reachable right now.</p>';
    }
  }

  function openTable(open) {
    return `<div class="adm-table"><table><thead><tr><th>Symbol</th><th>Side</th><th class="r">Entry</th><th class="r">Stop</th><th class="r">TP1</th><th class="r">TP2</th><th class="r">TP3</th><th class="r">Size</th><th class="r">Lev</th><th>Source</th><th class="r">Score</th><th class="r">Open for</th></tr></thead><tbody>
${open.map(t => `<tr><td class="asym">${esc(t.symbol)}</td><td>${side(t.direction)}</td><td class="r mono">${price(t.entry_price)}</td><td class="r mono down">${price(t.stop_loss)}</td>
<td class="r mono">${price(t.tp1)}</td><td class="r mono">${price(t.tp2)}</td><td class="r mono">${price(t.tp3)}</td><td class="r mono">$${num(t.position_size).toFixed(0)}</td>
<td class="r mono">${t.leverage ? esc(t.leverage) + '×' : '—'}</td><td>${esc(SRC[t.source] || t.source || '—')}</td><td class="r mono">${t.score == null ? '—' : esc(t.score)}</td>
<td class="r mono">${dur((Date.now() - Date.parse(t.created_at)) / 60000)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- trades view
  function trades(root) {
    const S = { period: store.get('rd-adm-period', 'all'), source: store.get('rd-adm-source', 'all'), page: 1, limit: 25, total: 0 };
    const seg = name => { const g = $(`[data-${name}]`, root); $$('button', g).forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === S[name])); b.onclick = () => { S[name] = b.dataset.v; store.set('rd-adm-' + name, S[name]); S.page = 1; $$('button', g).forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); }; }); };
    if (!['all', 'month', 'week', 'today'].includes(S.period)) S.period = 'all';
    if (!['all', 'onchain', 'demandzone', 'main', 'swing'].includes(S.source)) S.source = 'all';
    seg('period'); seg('source');
    const msg = $('[data-msg]', root);
    const fail = e => { msg.hidden = false; msg.textContent = e.message; };
    $('[data-refresh]', root).onclick = () => load();

    async function load() {
      msg.hidden = true; root.classList.add('loading');
      const src = S.source === 'all' ? {} : { source: S.source };
      try {
        const [t, s] = await Promise.all([api('/api/trades', Object.assign({ period: S.period, page: S.page, limit: S.limit }, src)), api('/api/trade-stats', src)]);
        S.total = num(t.total);
        S.lastDaily = s.dailyPnl || []; stats(s.summary || {}); daily(S.lastDaily); breakdown(s); openPos(t.open || []); closed(t.closed || []);
      } catch (e) { fail(e); }
      root.classList.remove('loading');
    }
    async function page(p) {
      S.page = p; root.classList.add('loading');
      try { const t = await api('/api/trades', Object.assign({ period: S.period, page: S.page, limit: S.limit }, S.source === 'all' ? {} : { source: S.source })); S.total = num(t.total); closed(t.closed || []); } catch (e) { fail(e); }
      root.classList.remove('loading');
    }

    function stats(m) {
      const k = S.period === 'today' ? 'today' : S.period === 'week' ? 'week' : S.period === 'month' ? 'month' : 'all';
      const label = { today: 'Today', week: '7 days', month: '30 days', all: 'All time' }[k];
      const pnl = num(m[k + '_pnl']), w = num(m[k + '_wins']), l = num(m[k + '_losses']), n = num(m[k + '_count']);
      const aw = num(m.avg_win), al = Math.abs(num(m.avg_loss)), hold = num(m.avg_hold_min);
      const t = (key, v, sub, cls) => `<div class="adm-tile"><span>${key}</span><b class="${cls || ''}">${v}</b><em>${sub}</em></div>`;
      $('[data-stats]', root).innerHTML = [
        t(label + ' P&L', usd(pnl), n + ' closed trades', tone(pnl)),
        t('Win rate', n ? Math.round(w / n * 100) + '%' : '—', `${w} won · ${l} lost`),
        t('Avg win', usd(aw), 'per winning trade · all time', 'up'),
        t('Avg loss', usd(-al), 'per losing trade · all time', 'down'),
        t('Win / loss size', al ? (aw / al).toFixed(2) + '×' : '—', 'avg win ÷ avg loss'),
        t('Best trade', usd(m.best_trade), 'all time', tone(m.best_trade)),
        t('Worst trade', usd(m.worst_trade), 'all time', tone(m.worst_trade)),
        t('Avg hold', hold ? dur(hold) : '—', 'entry to close'),
      ].join('');
    }

    // daily P&L: one bar per UTC day of the last 30, up/down from a zero line; hover or focus a day for its numbers
    function daily(rows) {
      const host = $('[data-daily]', root), days = [], by = {};
      rows.forEach(r => { by[String(r.day).slice(0, 10)] = r; });
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      for (let i = 29; i >= 0; i--) { const d = new Date(today - i * 864e5).toISOString().slice(0, 10), r = by[d]; days.push({ d, pnl: r ? num(r.pnl) : 0, n: r ? num(r.trades) : 0, w: r ? num(r.wins) : 0 }); }
      const total = days.reduce((s, x) => s + x.pnl, 0), active = days.filter(x => x.n).length;
      const tbl = $('[data-daily-table]', root);
      tbl.innerHTML = `<div class="adm-table"><table><thead><tr><th>Day (UTC)</th><th class="r">P&L</th><th class="r">Trades</th><th class="r">Won</th></tr></thead><tbody>${days.filter(x => x.n).reverse().map(x => `<tr><td class="mono">${x.d}</td><td class="r mono ${tone(x.pnl)}">${usd(x.pnl)}</td><td class="r mono">${x.n}</td><td class="r mono">${x.w}</td></tr>`).join('') || '<tr><td colspan="4" class="adm-empty">No closed trades in the last 30 days.</td></tr>'}</tbody></table></div>`;
      const W = Math.max(280, host.clientWidth || 600), H = 220, pl = 52, pr = 8, pt = 14, pb = 26;
      const mx = Math.max(1, ...days.map(x => Math.abs(x.pnl)));
      const step = niceStep(mx / 2), top = Math.ceil(mx / step) * step;
      const y = v => pt + (H - pt - pb) / 2 * (1 - v / top), y0 = y(0), bw = (W - pl - pr) / days.length;
      let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Daily P&L over the last 30 days: ${esc(usd(total))} in total over ${active} trading days">`;
      for (const v of [top, top / 2, 0, -top / 2, -top]) svg += `<line class="g${v === 0 ? ' z' : ''}" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '$0' : usd(v).replace('.00', '')}</text>`;
      days.forEach((x, i) => {
        const x0 = pl + i * bw + 1, w = Math.max(2, bw - 2), h = Math.abs(y(x.pnl) - y0);
        if (x.n && h >= 0.5) {
          const r = Math.min(4, w / 2, h), up = x.pnl >= 0, yt = up ? y0 - h : y0;
          // rounded at the data end only, square on the zero line
          svg += up ? `<path class="bar up" d="M${x0},${y0}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + w - r}Q${x0 + w},${yt} ${x0 + w},${yt + r}V${y0}Z"/>`
            : `<path class="bar down" d="M${x0},${y0}V${y0 + h - r}Q${x0},${y0 + h} ${x0 + r},${y0 + h}H${x0 + w - r}Q${x0 + w},${y0 + h} ${x0 + w},${y0 + h - r}V${y0}Z"/>`;
        } else if (x.n) svg += `<rect class="bar flat" x="${x0}" y="${y0 - 1}" width="${w}" height="2"/>`;
        if (i % 5 === 4 || i === 29) svg += `<text class="ax" x="${i === 29 ? x0 + w : x0 + w / 2}" y="${H - 8}" text-anchor="${i === 29 ? 'end' : 'middle'}">${x.d.slice(8)}/${x.d.slice(5, 7)}</text>`;
        svg += `<rect class="hit" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" data-i="${i}" tabindex="-1"/>`;
      });
      svg += '<line class="xh" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" visibility="hidden"/></svg>';
      host.innerHTML = `<p class="adm-chart-sum">${usd(total)} <span class="muted">over ${active} trading day${active === 1 ? '' : 's'}</span></p><div class="adm-plot">${svg}<div class="adm-tip" hidden></div></div>`;
      const plot = $('.adm-plot', host), tip = $('.adm-tip', host), xh = $('.xh', host);
      const show = i => {
        const x = days[i], cx = pl + i * bw + bw / 2;
        xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
        tip.hidden = false;
        tip.innerHTML = `<b>${new Date(x.d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b><span class="${tone(x.pnl)}">${x.n ? usd(x.pnl) : 'No closed trades'}</span>${x.n ? `<em>${x.n} trade${x.n === 1 ? '' : 's'} · ${x.w} won</em>` : ''}`;
        const pw = plot.clientWidth, tw = tip.offsetWidth, px = cx / W * pw;
        tip.style.left = Math.min(pw - tw - 4, Math.max(4, px - tw / 2)) + 'px';
      };
      const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
      plot.onpointermove = e => { const t = e.target.closest('.hit'); if (t) show(+t.dataset.i); };
      plot.onpointerleave = hide;
      plot.tabIndex = 0; plot.setAttribute('aria-label', 'Daily P&L chart. Use the arrow keys to read each day.');
      let k = 29; plot.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { k = Math.max(0, Math.min(29, k + (e.key === 'ArrowLeft' ? -1 : 1))); show(k); e.preventDefault(); } if (e.key === 'Escape') hide(); };
      plot.onblur = hide;
    }
    function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v || 1))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

    function breakdown(s) {
      const wr = r => num(r.cnt) ? Math.round(num(r.wins) / num(r.cnt) * 100) + '%' : '—';
      const row = (label, v, sub) => `<li><span>${label}</span><b class="mono ${tone(v)}">${usd(v)}</b><em>${sub}</em></li>`;
      const dirs = (s.byDirection || []).map(d => row(side(d.direction), d.pnl, `${num(d.cnt)} trades · ${wr(d)} won`)).join('');
      const reasons = s.byReason || [], maxN = Math.max(1, ...reasons.map(r => num(r.cnt)));
      const rs = reasons.map(r => `<li class="bar-li"><span><i class="meter ${reasonTone(r.close_reason)}" style="width:${Math.max(4, num(r.cnt) / maxN * 100)}%"></i>${esc(reason(r.close_reason))} <em>${num(r.cnt)}</em></span><b class="mono ${tone(r.pnl)}">${usd(r.pnl)}</b></li>`).join('');
      const sy = list => list.map(t => row(`<span class="asym">${esc(t.symbol)}</span>`, t.pnl, `${num(t.cnt)} trades · ${wr(t)} won`)).join('');
      const best = (s.topSymbols || []).filter(t => num(t.pnl) > 0).slice(0, 5), worst = (s.worstSymbols || []).filter(t => num(t.pnl) < 0).slice(0, 5);
      $('[data-breakdown]', root).innerHTML = `<h3 class="adm-h4">By side</h3><ul class="adm-list">${dirs || '<li class="adm-empty">—</li>'}</ul>
<h3 class="adm-h4">Exit reasons</h3><ul class="adm-list">${rs || '<li class="adm-empty">—</li>'}</ul>
<div class="adm-cols"><div><h3 class="adm-h4">Best coins</h3><ul class="adm-list">${sy(best) || '<li class="adm-empty">—</li>'}</ul></div><div><h3 class="adm-h4">Worst coins</h3><ul class="adm-list">${sy(worst) || '<li class="adm-empty">—</li>'}</ul></div></div>`;
    }
    function openPos(open) {
      $('[data-open-n]', root).textContent = open.length ? open.length + ' open' : '';
      $('[data-open]', root).innerHTML = open.length ? openTable(open) : '<p class="adm-empty">No open positions.</p>';
    }
    function closed(list) {
      const pages = Math.max(1, Math.ceil(S.total / S.limit)), from = S.total ? (S.page - 1) * S.limit + 1 : 0, to = Math.min(S.total, S.page * S.limit);
      $('[data-closed-n]', root).textContent = S.total ? `${from}–${to} of ${S.total}` : '';
      const pg = $('[data-pager]', root);
      pg.innerHTML = `<button type="button" class="btn btn-secondary btn-sm" data-p="-1"${S.page <= 1 ? ' disabled' : ''}>Newer</button><button type="button" class="btn btn-secondary btn-sm" data-p="1"${S.page >= pages ? ' disabled' : ''}>Older</button>`;
      $$('[data-p]', pg).forEach(b => b.onclick = () => page(S.page + +b.dataset.p));
      $('[data-closed]', root).innerHTML = list.length ? `<div class="adm-table"><table><thead><tr><th>Closed (UTC)</th><th>Symbol</th><th>Side</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">P&L</th><th class="r">%</th><th>Exit reason</th><th>Source</th><th class="r">Lev</th><th class="r">Score</th><th class="r">Held</th></tr></thead><tbody>
${list.map(t => `<tr><td class="mono muted">${when(t.closed_at)}</td><td class="asym">${esc(t.symbol)}</td><td>${side(t.direction)}</td><td class="r mono">${price(t.entry_price)}</td><td class="r mono">${price(t.exit_price)}</td>
<td class="r mono ${tone(t.pnl_usd)}">${usd(t.pnl_usd)}</td><td class="r mono ${tone(t.pnl_pct)}">${t.pnl_pct == null ? '—' : (num(t.pnl_pct) > 0 ? '+' : '') + num(t.pnl_pct).toFixed(2) + '%'}</td>
<td><span class="pill ${reasonTone(t.close_reason)}">${esc(reason(t.close_reason))}</span></td><td>${esc(SRC[t.source] || t.source || '—')}</td><td class="r mono">${t.leverage ? esc(t.leverage) + '×' : '—'}</td>
<td class="r mono">${t.score == null ? '—' : esc(t.score)}</td><td class="r mono">${t.created_at && t.closed_at ? dur((Date.parse(t.closed_at) - Date.parse(t.created_at)) / 60000) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="adm-empty">No closed trades in this period.</p>';
    }
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.lastDaily) daily(S.lastDaily); }, 200); });
    load();
  }

  const view = document.body.dataset.view;
  const main = $('#main');
  if (view === 'overview' && $('[data-bot-overview]')) overview($('[data-bot-overview]'));
  if (view === 'trades' && main) trades(main);

  // open / close new accounts (Accounts card)
  $$('[data-signups]').forEach(b => b.addEventListener('click', async () => {
    const open = b.dataset.signups === 'open';
    b.disabled = true; b.textContent = open ? 'Opening…' : 'Closing…';
    try {
      const r = await fetch('/auth/admin/signups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ open }) });
      if (!r.ok) throw new Error(String(r.status));
      location.reload();
    } catch (e) { b.disabled = false; b.textContent = 'Couldn’t save — try again'; }
  }));
})();
