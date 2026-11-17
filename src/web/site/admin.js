// ReplayDesk admin console (/admin): Overview, Bot trades & P&L (the old dashboard's Trades tab, rebuilt), Users.
// Server-rendered shell; the bot numbers come from the bot's own read-only /api/trades and /api/trade-stats (the admin
// session cookie authorises them) and are drawn by /assets/admin.js. Nothing here places, closes or changes a trade.
const { esc, page, asset, icon, LOGO_SVG, themeBtn } = require('./html');

const VIEWS = [
  ['overview', 'Overview', 'layout-dashboard'],
  ['trades', 'Bot trades & P&L', 'chart-column'],
  ['users', 'Users', 'users'],
];
const TOOLS = [
  ['/app#real', 'Live trading', 'Desk: Real ticket, bot positions, signals', 'zap'],
  ['/app', 'Desk', 'Paper and replay desk', 'chart-candlestick'],
  ['/learn', 'Academy', 'Lessons, incl. the admin Desk notes', 'graduation-cap'],
];
const fmtTime = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';
const n0 = v => Number(v || 0).toLocaleString('en-US');

function shell(who, nonce, view, main) {
  const u = who.user;
  const name = u ? (u.name || u.email) : 'Dashboard key';
  const nav = `<nav class="adm-nav" aria-label="Admin">
  <p class="adm-eyebrow">Console</p>
  ${VIEWS.map(([k, t, ic]) => `<a href="/admin${k === 'overview' ? '' : '?view=' + k}"${k === view ? ' aria-current="page"' : ''}>${icon(ic, 'i-4')}<span>${t}</span></a>`).join('')}
  <p class="adm-eyebrow">Tools</p>
  ${TOOLS.map(([h, t, s, ic]) => `<a href="${h}" class="adm-tool">${icon(ic, 'i-4')}<span>${t}<small>${s}</small></span></a>`).join('')}
</nav>`;
  const body = `<div class="app adm">
<header class="appbar"><a href="/" aria-label="ReplayDesk home" class="adm-brand">${LOGO_SVG(28, 'ab')}<b>Replay<span>Desk</span></b><span class="adm-badge">Admin</span></a>
  <div class="appbar-right"><span class="adm-who">${icon(u ? 'user' : 'key-round', 'i-35')} ${esc(name)}</span>${themeBtn()}
  <button type="button" class="btn btn-secondary btn-sm" data-signout>${icon('log-out', 'i-35')}<span class="adm-hide-s">Sign out</span></button></div></header>
<div class="adm-layout">${nav}<main class="adm-main" id="main">${main}</main></div></div>`;
  return page({ title: 'Admin', nonce, noindex: true, body, bodyClass: 'adm-body', head: `<link rel="stylesheet" href="${asset('admin.css')}">`, scripts: [`<script src="${asset('admin.js')}" defer></script>`], bodyData: { view } });
}

const head = (title, sub, extra = '') => `<div class="adm-head"><div><h1>${title}</h1><p class="adm-sub">${sub}</p></div>${extra}</div>`;
const statusCell = u => u.banned ? '<span class="pill down">Banned</span>' : u.email_verified ? '<span class="pill up">Confirmed</span>' : '<span class="pill warn">Unconfirmed</span>';
const userRow = u => `<tr><td><span class="adm-av">${esc((u.name || u.email || '?').trim().slice(0, 1).toUpperCase())}</span>${esc(u.name || '—')}</td><td class="mono">${esc(u.email)}</td><td>${statusCell(u)}</td>
<td>${[u.google && 'Google', u.has_pw && 'Password'].filter(Boolean).join(' · ') || '—'}</td><td class="cap">${esc(u.plan)}</td><td class="mono muted">${fmtTime(u.created_at)}</td><td class="mono muted">${fmtTime(u.last_login_at)}</td></tr>`;
const userTable = (rows, empty) => `<div class="adm-table"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Sign-in</th><th>Plan</th><th>Joined (UTC)</th><th>Last sign-in</th></tr></thead>
<tbody>${rows.length ? rows.map(userRow).join('') : `<tr><td colspan="7" class="adm-empty">${empty}</td></tr>`}</tbody></table></div>`;

function overview(d) {
  const c = d.counts;
  return `${head('Overview', 'The bot and the site at a glance. Read-only — trading stays on the Live trading page until the desk takes it over.')}
<section class="adm-card" data-bot-overview>
  <div class="adm-card-h"><h2>${icon('bot', 'i-4')} Bot</h2><span class="adm-live" data-bot-status><i></i>Connecting…</span><a class="adm-more" href="/admin?view=trades">Trades & P&L ${icon('arrow-right', 'i-35')}</a></div>
  <div class="adm-tiles" data-bot-tiles>${['Open trades', 'Today', '7 days', '30 days', 'All time'].map(t => `<div class="adm-tile"><span>${t}</span><b class="sk">—</b><em>&nbsp;</em></div>`).join('')}</div>
  <div data-open-mini></div>
</section>
<section class="adm-card">
  <div class="adm-card-h"><h2>${icon('users', 'i-4')} Accounts</h2>${d.accountsOpen ? '<span class="pill up">Sign-ups open</span>' : '<span class="pill warn">Sign-ups closed — set RESEND_API_KEY, EMAIL_FROM and PUBLIC_URL</span>'}<a class="adm-more" href="/admin?view=users">All users ${icon('arrow-right', 'i-35')}</a></div>
  <div class="adm-tiles">${[['Users', c.users], ['Confirmed email', c.verified], ['New in 7 days', c.week], ['Google sign-ins', c.google]].map(([k, v]) => `<div class="adm-tile"><span>${k}</span><b>${n0(v)}</b></div>`).join('')}</div>
  <h3 class="adm-h3">Newest sign-ups</h3>${userTable(d.latest, 'No users yet.')}
</section>
<section class="adm-tools">${TOOLS.map(([h, t, s, ic]) => `<a href="${h}" class="adm-toolcard">${icon(ic, 'i-5')}<b>${t}</b><span>${s}</span></a>`).join('')}</section>`;
}

function trades() {
  const chips = (key, list) => `<div class="adm-seg" role="group" data-${key}>${list.map(([v, t], i) => `<button type="button" data-v="${v}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>`;
  return `${head('Bot trades & P&L', 'Closed and open trades of the live bot, from its database. Read-only.', `<button type="button" class="btn btn-secondary btn-sm" data-refresh>${icon('refresh-cw', 'i-35')} Refresh</button>`)}
<div class="adm-filters">${chips('period', [['all', 'All time'], ['month', '30 days'], ['week', '7 days'], ['today', 'Today']])}${chips('source', [['all', 'All sources'], ['onchain', 'Onchain'], ['demandzone', 'Demand zone'], ['main', 'Main'], ['swing', 'Swing']])}</div>
<div class="adm-msg" data-msg hidden></div>
<div class="adm-tiles adm-tiles-8" data-stats></div>
<div class="adm-grid2">
  <section class="adm-card"><div class="adm-card-h"><h2>Daily P&L</h2><span class="muted">last 30 days, UTC · selected source</span></div><div class="adm-chart" data-daily></div>
    <details class="adm-details"><summary>Show as a table</summary><div data-daily-table></div></details></section>
  <section class="adm-card"><div class="adm-card-h"><h2>Breakdown</h2><span class="muted">all time · selected source</span></div><div data-breakdown></div></section>
</div>
<section class="adm-card"><div class="adm-card-h"><h2>Open positions</h2><span class="muted" data-open-n></span></div><div data-open></div></section>
<section class="adm-card"><div class="adm-card-h"><h2>Closed trades</h2><span class="muted" data-closed-n></span><div class="adm-pager" data-pager></div></div><div data-closed></div></section>`;
}

function users(d) {
  const pages = Math.max(1, Math.ceil(d.total / d.per)), q = d.q ? `&q=${encodeURIComponent(d.q)}` : '';
  const link = (p, t, dis) => dis ? `<span class="btn btn-secondary btn-sm" aria-disabled="true">${t}</span>` : `<a class="btn btn-secondary btn-sm" href="/admin?view=users&page=${p}${q}">${t}</a>`;
  return `${head('Users', `${n0(d.total)} ${d.q ? 'matching' : 'accounts'}. Newest first.`)}
<form class="adm-search" method="get" action="/admin" role="search"><input type="hidden" name="view" value="users">
  <label class="adm-input">${icon('search', 'i-4')}<input type="search" name="q" value="${esc(d.q)}" placeholder="Search name or email" aria-label="Search name or email" maxlength="100"></label>
  <button class="btn btn-primary btn-sm" type="submit">Search</button>${d.q ? '<a class="btn btn-secondary btn-sm" href="/admin?view=users">Clear</a>' : ''}</form>
${userTable(d.rows, d.q ? 'No user matches that search.' : 'No users yet.')}
<div class="adm-pager adm-pager-b"><span class="muted mono">Page ${d.page} of ${pages}</span>${link(d.page - 1, `${icon('chevron-left', 'i-35')} Newer`, d.page <= 1)}${link(d.page + 1, `Older ${icon('chevron-right', 'i-35')}`, d.page >= pages)}</div>`;
}

function adminConsole(who, nonce, d) {
  const main = d.view === 'trades' ? trades() : d.view === 'users' ? users(d) : overview(d);
  return shell(who, nonce, d.view, main);
}

/** Reads what a view needs from the accounts DB. q: the db module. */
async function adminData(db, url, accountsOpen) {
  const v = url.searchParams.get('view');
  const view = VIEWS.some(([k]) => k === v) ? v : 'overview';
  const d = { view, accountsOpen };
  if (view === 'overview') {
    const [c, latest] = await Promise.all([
      db.q(`SELECT count(*)::int AS users, count(*) FILTER (WHERE email_verified)::int AS verified,
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week, count(google_sub)::int AS google FROM web_users`),
      db.q(`SELECT name, email, email_verified, plan, banned, created_at, last_login_at, password_hash IS NOT NULL AS has_pw, google_sub IS NOT NULL AS google
        FROM web_users ORDER BY created_at DESC LIMIT 8`),
    ]);
    d.counts = c.rows[0]; d.latest = latest.rows;
  } else if (view === 'users') {
    d.per = 50;
    d.q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    d.page = Math.max(1, Math.min(10000, parseInt(url.searchParams.get('page'), 10) || 1));
    const where = d.q ? `WHERE email ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\'` : '';
    const args = d.q ? ['%' + d.q.replace(/[\\%_]/g, m => '\\' + m) + '%'] : [];
    const [t, rows] = await Promise.all([
      db.q(`SELECT count(*)::int AS n FROM web_users ${where}`, args),
      db.q(`SELECT name, email, email_verified, plan, banned, created_at, last_login_at, password_hash IS NOT NULL AS has_pw, google_sub IS NOT NULL AS google
        FROM web_users ${where} ORDER BY created_at DESC LIMIT ${d.per} OFFSET ${(d.page - 1) * d.per}`, args),
    ]);
    d.total = t.rows[0].n; d.rows = rows.rows;
  }
  return d;
}

module.exports = { adminConsole, adminData };
