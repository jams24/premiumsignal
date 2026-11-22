'use strict';
/* Actual figures for the economic calendar. The calendar itself (events, impact, forecast, previous) is Forex Factory's
   weekly feed, which has no "actual" column, so released figures come from Nasdaq's public economic calendar
   (api.nasdaq.com/api/calendar/economicevents?date=YYYY-MM-DD: one New York day per call, times in New York time,
   actual / consensus / previous). Only the released number is taken, matched to the Forex Factory event by currency,
   the same minute and the name (or the same previous figure). Cached: a past day 6 h, today 5 min, future days never
   fetched. A failed call leaves the actuals blank; the calendar still shows. */

const NQ_URL = 'https://api.nasdaq.com/api/calendar/economicevents?date=';
const CUR = {
  'United States': 'USD', 'Euro Zone': 'EUR', Germany: 'EUR', France: 'EUR', Italy: 'EUR', Spain: 'EUR', 'United Kingdom': 'GBP',
  Japan: 'JPY', Canada: 'CAD', Australia: 'AUD', 'New Zealand': 'NZD', Switzerland: 'CHF', China: 'CNY',
};
const DAYS = new Map();   // 'YYYY-MM-DD' (New York) → { at, rows: [{ t, cur, name, actual, previous, consensus }], err }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const txt = s => String(s == null ? '' : s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] || m)
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// a New York wall-clock time → UTC ms (EST or EDT, whichever applies that day)
function nyToUtc(y, m, d, h, min) {
  const guess = Date.UTC(y, m, d, h + 5, min);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(guess));
  const nyH = +p.find(x => x.type === 'hour').value, nyM = +p.find(x => x.type === 'minute').value;
  return guess + ((h - nyH) * 60 + (min - nyM)) * 60e3;
}
const nyDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

// one call's rows. The "gmt" column is really New York time, and on 22 Nov 2026 date=D answered with the events of the day
// BEFORE D (Thursday's jobless claims under a Friday date). So each row is read for both days; only the reading whose
// minute lines up with a Forex Factory event can match, and nothing breaks if Nasdaq fixes the date.
function parseDay(json, ymd) {
  const rows = (json && json.data && json.data.rows) || [], [y, m, d] = ymd.split('-').map(Number), out = [];
  for (const r of rows) {
    const cur = CUR[txt(r.country)], hm = /^(\d{1,2}):(\d{2})$/.exec(txt(r.gmt));
    if (!cur || !hm) continue;
    const base = { cur, name: txt(r.eventName), actual: txt(r.actual), previous: txt(r.previous), consensus: txt(r.consensus) };
    base.id = ymd + '|' + base.cur + '|' + txt(r.gmt) + '|' + base.name;
    for (const back of [0, 1]) out.push({ ...base, t: nyToUtc(y, m - 1, d - back, +hm[1], +hm[2]) });
  }
  return out;
}

// "0.80%" "1,763K" "-30.9" "4.050%" → a number in one unit (K / M / B / T scaled), or null
function num(s) {
  const m = /^([-+−]?)\s*([\d,]*\.?\d+)\s*([KMBT%]?)/i.exec(String(s || '').trim().replace(/^[<>]/, ''));
  if (!m) return null;
  const v = parseFloat(m[2].replace(/,/g, '')) * (m[1] === '-' || m[1] === '−' ? -1 : 1);
  return v * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[3].toUpperCase()] || 1);
}
const same = (a, b) => { const x = num(a), y = num(b); return x != null && y != null && (x === y || Math.abs(x - y) <= 0.02 * Math.max(Math.abs(x), Math.abs(y))); };

// names differ between the two calendars ("CPI m/m" vs "CPI (MoM)", "Unemployment Claims" vs "Initial Jobless Claims")
const SYN = [
  [/\bm\/m\b|\(mom\)|\bmom\b/g, ' mom '], [/\by\/y\b|\(yoy\)|\byoy\b/g, ' yoy '], [/\bq\/q\b|\(qoq\)|\bqoq\b/g, ' qoq '],
  [/unemployment claims/g, 'initial jobless claims'], [/non-?farm employment change/g, 'nonfarm payrolls'], [/federal funds rate/g, 'fed interest rate decision'],
  [/\bprelim\b/g, 'preliminary'], [/\bflash\b/g, 'preliminary'], [/\bconsumer price index\b/g, 'cpi'], [/\bproducer price index\b/g, 'ppi'],
  [/\bgross domestic product\b/g, 'gdp'], [/\bpurchasing managers'? index\b/g, 'pmi'], [/\bpce price index\b/g, 'pce'], [/\bhouse price index\b/g, 'hpi'],
];
const STOP = new Set(['the', 'of', 'and', 's', 'p', 'global', 'us', 'u', 'german', 'french', 'italian', 'spanish', 'uk', 'japanese', 'chinese', 'canadian', 'australian', 'swiss', 'nz', 'eurozone', 'euro', 'zone', 'index', 'rate', 'final', 'adv', 'sa', 'nsa']);
function toks(s) {
  let x = ' ' + String(s).toLowerCase() + ' ';
  for (const [re, to] of SYN) x = x.replace(re, to);
  return new Set(x.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)));
}
function sim(a, b) {
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return 2 * n / (A.size + B.size);
}

// a pair is ruled out when the figures can't be the same series: different units (0.8% vs an index of 103.64), previous
// figures far apart (0.3% m/m vs 3.7% y/y), or one name says monthly and the other yearly / quarterly. A missing actual
// is better than a wrong one.
const unit = s => { const m = /([KMBT%])\s*$/i.exec(String(s || '').trim()); return m ? m[1].toUpperCase() : ''; };
const PER = ['mom', 'qoq', 'yoy'];
function compatible(e, r) {
  for (const [a, b] of [[e.previous, r.previous], [e.forecast, r.consensus]]) {
    if (!String(a || '').trim() || !String(b || '').trim()) continue;
    if (unit(a) !== unit(b)) return false;
    const x = num(a), y = num(b);
    if (x != null && y != null && Math.abs(x - y) > 0.3 * Math.max(Math.abs(x), Math.abs(y)) + 0.15) return false;
  }
  const A = toks(e.title), B = toks(r.name), pa = PER.filter(p => A.has(p)), pb = PER.filter(p => B.has(p));
  return !(pa.length && pb.length && !pa.some(p => pb.includes(p)));
}
// events: Forex Factory list ({ t, cur, title, forecast, previous }); rows: Nasdaq rows of the same days.
// Returns a Map event → { actual, name } for the matched ones that have a released figure.
function match(events, rows) {
  const pairs = [];
  for (const e of events) for (const r of rows) {
    if (r.cur !== e.cur || Math.abs(r.t - e.t) > 2 * 60e3 || !compatible(e, r)) continue;
    const s = sim(e.title, r.name), prev = same(e.previous, r.previous), fc = same(e.forecast, r.consensus);
    if (s >= 0.5 || (prev && s >= 0.2) || (prev && fc)) pairs.push({ e, r, score: s + (prev ? 0.5 : 0) + (fc ? 0.25 : 0) });
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedE = new Set(), usedR = new Set(), out = new Map();
  for (const p of pairs) {
    if (usedE.has(p.e) || usedR.has(p.r.id)) continue;
    usedE.add(p.e); usedR.add(p.r.id);
    if (p.r.actual) out.set(p.e, { actual: p.r.actual, name: p.r.name });
  }
  return { actuals: out, matched: usedE.size };
}

async function day(ymd, today) {   // today: also refresh tomorrow's call often (it may hold today's events)
  const c = DAYS.get(ymd);
  if (c && Date.now() - c.at < (c.err ? 10 * 60e3 : ymd >= today ? 5 * 60e3 : 6 * 3600e3)) return c;
  const v = { at: Date.now(), rows: c ? c.rows : [], err: null };
  try {
    const r = await fetch(NQ_URL + ymd, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    v.rows = parseDay(await r.json(), ymd);
  } catch (e) { v.err = `actual figures (Nasdaq calendar): ${e.message}`; }
  DAYS.set(ymd, v);
  if (DAYS.size > 40) DAYS.delete(DAYS.keys().next().value);
  return v;
}

// adds `actual` to every Forex Factory event that has been released and could be matched; returns the error, if any
async function addActuals(events) {
  const now = Date.now(), today = nyDate(now);
  const next = ymd => nyDate(Date.parse(ymd + 'T12:00:00Z') + 864e5);
  const days = [...new Set(events.filter(e => e.t <= now + 60e3 && e.t > now - 9 * 864e5).flatMap(e => [nyDate(e.t), next(nyDate(e.t))]))];   // the day and the day after (see parseDay)
  // wait at most 6 s: a slow answer fills the cache for the next call instead of holding up the calendar
  const all = Promise.all(days.map(d => day(d, today).catch(e => ({ rows: [], err: e.message }))));
  const got = (await Promise.race([all, new Promise(r => setTimeout(() => r(null), 6000).unref())])) || days.map(d => DAYS.get(d) || { rows: [], err: null });
  const rows = got.flatMap(g => g.rows);
  const { actuals } = match(events, rows);
  for (const e of events) { const a = actuals.get(e); if (a) e.actual = a.actual; }
  return got.map(g => g.err).find(Boolean) || null;
}

module.exports = { addActuals, match, parseDay, num, sim, compatible, nyToUtc, nyDate };
