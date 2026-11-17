'use strict';
/* News for the desk's Market panel (GET /api/site/news, signed-in users, rate limited):
   - calendar: this week's economic calendar + FOMC dates, the same cache the classic Simulator reads (simApi.newsEvents,
     handed in by src/index.js so this module never loads the bot's database code)
   - headlines: the newest crypto headlines from four public RSS feeds (title, link, time, source only — the desk links
     out to the article; nothing else of the article is copied). Read at most every 10 minutes, one shared copy. */
const logger = require('../../utils/logger');

const FEEDS = [
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'],
  ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['Decrypt', 'https://decrypt.co/feed'],
  ['The Block', 'https://www.theblock.co/rss.xml'],
];
const H = { list: [], at: 0, errs: [], busy: null };

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function clean(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] || m).replace(/\s+/g, ' ').trim();
}
function parse(xml, src) {
  const out = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const it = m[1], tag = n => { const r = it.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`)); return r ? clean(r[1]) : ''; };
    const title = tag('title').slice(0, 220), link = tag('link') || tag('guid'), t = Date.parse(tag('pubDate') || tag('dc:date'));
    if (!title || !/^https:\/\//.test(link) || !isFinite(t)) continue;
    out.push({ t, title, link: link.slice(0, 500), src });
  }
  return out;
}
async function refresh() {
  const errs = [], all = [];
  await Promise.all(FEEDS.map(async ([src, url]) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (ReplayDesk news)', Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const items = parse(await r.text(), src);
      if (!items.length) throw new Error('no items');
      all.push(...items);
    } catch (e) { errs.push(`${src}: ${e.message}`); }
  }));
  if (all.length) {
    const seen = new Set();
    H.list = all.sort((a, b) => b.t - a.t).filter(x => { const k = x.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 80);
  }
  H.errs = errs; H.at = Date.now();
  if (errs.length === FEEDS.length) logger.warn(`[web] news feeds: ${errs.join('; ')}`);
}
async function headlines() {
  if (Date.now() - H.at > (H.list.length ? 10 : 2) * 60e3 && !H.busy) H.busy = refresh().finally(() => { H.busy = null; });
  if (H.busy && !H.list.length) await H.busy;   // first call waits; later ones get the cached copy while it refreshes
  return { list: H.list, at: H.at, errors: H.errs };
}

async function news(calendar) {
  const [cal, hl] = await Promise.all([
    calendar ? calendar().catch(e => ({ events: [], errors: [e.message] })) : Promise.resolve({ events: [], errors: ['calendar unavailable'] }),
    headlines().catch(e => ({ list: [], errors: [e.message] })),
  ]);
  const now = Date.now();
  return {
    now,
    events: (cal.events || []).filter(e => e.t > now - 36 * 3600e3 && e.t < now + 21 * 86400e3)
      .map(e => ({ t: e.t, cur: e.cur, title: e.title, impact: e.impact, forecast: e.forecast || '', previous: e.previous || '', note: e.note || '' })),
    calErrors: cal.errors || [], sources: cal.sources || null,
    headlines: hl.list, hlAt: hl.at, hlErrors: hl.errors || [],
  };
}

module.exports = { news, parse };
