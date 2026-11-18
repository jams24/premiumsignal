// ReplayDesk Academy (/learn and /learn/<slug>): the old dashboard's "Learn Onchain" tab and the SMC Playbook, rebuilt as one
// lesson series. Server-rendered text; the replays, drills, widgets and quizzes come from /assets/learn.js (data-lesson,
// data-widget, data-quiz, data-drills). The "Desk notes" track is the bot's own trades and tests: admins only.
const { esc, page, navbar, footer, btn, asset, icon } = require('./html');

// replays of the bot's own trades (BARD, MUBARAK): sent only inside the admin lessons, never in the public learn.js
const ADMIN_REPLAYS = {"bard":{"aria":"BARD 5 minute candles: 24h top at 0.13231, bot short at 0.12554 stopped at 18:30, sweep at 18:15 and a sweep short at 0.13087 that survives with an 8 percent stop","candles":[[0.11299,0.12184,0.11036,0.12135],[0.12135,0.12971,0.11987,0.12514],[0.12514,0.12891,0.12232,0.12503],[0.12503,0.12837,0.1223,0.12591],[0.12591,0.13062,0.11959,0.1201],[0.1201,0.12347,0.11836,0.12221],[0.12221,0.12496,0.11721,0.12365],[0.12365,0.12721,0.12227,0.1238],[0.1238,0.12804,0.12345,0.12593],[0.12593,0.13231,0.11336,0.12232],[0.12232,0.12413,0.12011,0.1219],[0.1219,0.126,0.12096,0.12395],[0.12395,0.12694,0.12196,0.12616],[0.12616,0.12624,0.12299,0.12379],[0.12379,0.12925,0.12342,0.12908],[0.12908,0.13424,0.12828,0.13087],[0.13087,0.13281,0.13024,0.13187],[0.13187,0.13431,0.1298,0.13101],[0.13101,0.13958,0.13101,0.13955],[0.13955,0.13955,0.13555,0.13652],[0.13652,0.13771,0.13309,0.13523],[0.13523,0.13789,0.13259,0.13448],[0.13448,0.1347,0.13077,0.13281],[0.13281,0.1344,0.13172,0.1323],[0.1323,0.13504,0.13019,0.1343],[0.1343,0.13661,0.13258,0.13517],[0.13517,0.13521,0.13134,0.13297],[0.13297,0.135,0.13177,0.13324],[0.13324,0.13339,0.12547,0.12639],[0.12639,0.12823,0.12628,0.12721],[0.12721,0.12874,0.12558,0.12806]],"digits":5,"xEvery":6,"speed":520,"times":["17:00","17:05","17:10","17:15","17:20","17:25","17:30","17:35","17:40","17:45","17:50","17:55","18:00","18:05","18:10","18:15","18:20","18:25","18:30","18:35","18:40","18:45","18:50","18:55","19:00","19:05","19:10","19:15","19:20","19:25","19:30"],"ann":[{"type":"line","y":0.13231,"i0":9,"i1":30,"cls":"top","label":"24h top 0.13231","lp":"before","at":9},{"type":"mark","i":13,"y":0.12554,"label":"Bot short 0.12554","cls":"bot","pos":"below","at":13},{"type":"line","y":0.13558,"i0":13,"i1":18,"cls":"stop","label":"its 8% stop 0.13558","lp":"before","minW":560,"at":13},{"type":"mark","i":15,"y":0.13424,"label":"Sweep","cls":"sweep","anchor":"start","at":15},{"type":"box","i0":16,"i1":30,"entry":0.13087,"stop":0.14134,"tp":0.12433,"entryLabel":"Sweep short","stopLabel":"8% stop","tpLabel":"TP1 −5%","noR":true,"at":16},{"type":"line","y":0.13464,"i0":16,"i1":18,"cls":"tight","label":"tight stop","lp":"after","minW":560,"at":17},{"type":"mark","i":18,"y":0.13958,"label":"Bot short stopped (−$62)","cls":"stop","anchor":"end","at":18}],"notes":[{"at":0,"t":"BARD has already pumped from 0.0864 to 0.12 in half an hour. The pump signal is WEAK (under 40%)."},{"at":9,"t":"A wick to 0.13231 sets the 24h high. That is the top the 🎯 sweep rule watches, with buy-side liquidity above it."},{"at":13,"t":"The bot shorts at ENTER, 0.12554, below a fresh high with no sweep yet. Late longs still have fuel, and our stop sits above their target."},{"at":15,"t":"Sweep: the candle's high 0.13424 takes the 0.13231 top, and it closes back under at 0.13087."},{"at":16,"t":"The 🎯 rule would short here, around 0.13087. Stop 8% higher at 0.14134. TP1 at −5%, 0.12433."},{"at":18,"t":"Spike to 0.13958. The bot's ENTER short hits its 8% stop: −$62. A tight SMC stop just above the sweep wick (about 0.1346) is gone too. The sweep short's 8% stop survives."},{"at":28,"t":"Dump to 0.12547, just above TP1."},{"at":30,"t":"19:30 close 0.12806: the sweep short would be about +2% and still open. The toggle was off, so this trade was not taken."}]},"mubarak":{"digits":4,"aria":"Pump from 0.044 to 0.057, a winning short at the top, a dump to 0.050, three higher lows, a bullish CHoCH above 0.057, a BOS and a losing short at 0.060 before a peak at 0.0635","ann":[{"type":"line","y":0.057,"i0":12,"i1":27,"cls":"top","label":"Pump high 0.0570","lp":"before","at":12},{"type":"mark","i":12,"y":0.0566,"label":"Short #767","cls":"bot","pos":"below","at":12},{"type":"mark","i":16,"y":0.05,"label":"SL1","cls":"struct","pos":"below","at":17},{"type":"mark","i":20,"y":0.053,"label":"SL2","cls":"struct","pos":"below","at":21},{"type":"mark","i":24,"y":0.054,"label":"SL3","cls":"struct","pos":"below","at":25},{"type":"line","y":0.057,"i0":22,"i1":27,"cls":"choch","label":"CHoCH up","at":27},{"type":"line","y":0.0589,"i0":28,"i1":30,"cls":"bos","label":"BOS","at":30},{"type":"mark","i":31,"y":0.0601,"label":"Short #771","cls":"stop","anchor":"end","at":31},{"type":"mark","i":34,"y":0.0635,"label":"Peak 0.0635","cls":"struct","anchor":"end","at":34}],"notes":[{"at":7,"t":"Consolidation around 0.044. OI flat, funding neutral."},{"at":12,"t":"Pump to 0.057. OI +30%, funding +0.18%, price +63%. Exhaustion scored 7 and the bot shorted the real top: trade #767."},{"at":16,"t":"Dump to 0.050: the first lower low after the high. #767 closed +$5.39."},{"at":24,"t":"Higher lows: 0.050 → 0.053 → 0.054. Buyers are stepping in each time."},{"at":27,"t":"Close above the 0.057 high: a bullish CHoCH. The pump-and-dump picture is over; structure now points up."},{"at":31,"t":"BOS above 0.0589. Exhaustion re-detected the same pump (score 6), but OI had unwound to 15% and funding to 0.05%. The bot shorted against the BOS: #771."},{"at":34,"t":"Peak 0.0635. #771 lost −$16.68. The crowd had already left; priceChange alone carried the score. Fix: OI > 25% hard floor for exhaustion (commit ae9401e)."}],"gen":[[0.0442,0.0439,0.0441,0.0443,0.044,0.0442,0.0444,0.0446,0.0465,0.0498,0.0532,0.0556,0.0566,0.0562,0.0535,0.0512,0.0503,0.0521,0.0544,0.0536,0.0533,0.0546,0.0556,0.0548,0.0543,0.0554,0.0564,0.0576,0.0586,0.058,0.0596,0.0601,0.0613,0.0622,0.0629,0.0625],{"wick":0.004,"H":{"12":0.057,"18":0.0548,"22":0.0559,"28":0.0589,"34":0.0635},"L":{"16":0.05,"20":0.053,"24":0.054,"29":0.0577}}]}};
const adminData = id => ADMIN_REPLAYS[id] ? `<script type="application/json" data-replay="${id}">${JSON.stringify(ADMIN_REPLAYS[id]).replace(/</g, '\\u003c')}</script>` : '';
const replay = (id, cap) => `<figure class="lx-fig">${adminData(id)}<div class="sub" data-lesson="${id}"></div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
const widget = (id, cap) => `<figure class="lx-fig"><div class="wx" data-widget="${id}"></div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
const callout = (tone, title, html) => `<div class="callout ${tone}"><b>${title}</b><div>${html}</div></div>`;
const table = (head, rows, cls = '') => `<div class="tbl"><table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const cards = list => `<div class="cards2">${list.map(([tag, t, b, tone]) => `<div class="card2"><span class="tag2 ${tone || ''}">${tag}</span><h3>${t}</h3>${b}</div>`).join('')}</div>`;
const R = (v, cls) => `<span class="r ${cls}">${v}</span>`;
// candlestick patterns: names and our real-chart test numbers come from the same file the browser runs
const CPat = require('./assets/cpat.js');
const CP_ROWS = Object.entries(CPat.TEST).sort((a, b) => b[1][0] - a[1][0]).map(([k, v]) => [CPat.BY[k].name, v[0].toLocaleString('en-US'), `${v[1]}% (${v[2]}%)`, `${v[3]}% (${v[4]}%)`, R((v[6] > 0 ? '+' : v[6] < 0 ? '−' : '') + Math.abs(v[6]).toFixed(2) + 'R', v[6] > 0 ? 'pos' : 'neg')]);

const TRACKS = [
  { key: 'basics', title: 'Chart basics', icon: 'chart-candlestick', blurb: 'Candles, trends and the one rule that keeps you in the game: size every trade from its stop.' },
  { key: 'candles', title: 'Candlestick patterns', icon: 'layers', blurb: 'Hammers, engulfings, stars and soldiers: what each one says, how to enter, a trainer on real charts — and how 63,000 real trades from them did against random entries.' },
  { key: 'smc', title: 'Smart money concepts', icon: 'crosshair', blurb: 'Liquidity, sweeps, order blocks, premium and discount — watched candle by candle, then drilled. Ends with what our backtests found.' },
  { key: 'derivs', title: 'Derivatives & on-chain', icon: 'activity', blurb: 'Open interest, funding, squeezes, long/short ratios and whale wallet flows: the data behind a move.' },
  { key: 'desk', title: 'Desk notes', icon: 'shield', admin: true, blurb: 'Our bot’s own trades and test results. Visible to admins only.' },
];

/* lesson: slug, track, title, mins, tags, sum, body, keys (key points), quiz [{q, o, a, why}], practice */
const LESSONS = [
  // ---------------------------------------------------------------------------------------------------- chart basics
  { slug: 'candles', track: 'basics', title: 'Reading a candle', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'Open, high, low, close: the four prices every candle shows, and what a long wick is telling you.',
    body: `<p>Every candle tells a small story: where price started, where it finished and how far it travelled in between.
A <b class="up">green</b> candle closed higher than it opened; a <b class="down">red</b> one closed lower.</p>
<ul><li><b>Body</b> — the thick part, from open to close. A tall body is a strong move; a tiny one is indecision.</li>
<li><b>Wicks</b> — the thin lines. They mark the highest and lowest price of the period.</li>
<li><b>Long upper wick</b> — price tried to go higher and was pushed back down. Sellers showed up.</li>
<li><b>Long lower wick</b> — price tried to go lower and was pushed back up. Buyers showed up.</li></ul>
${widget('candle', 'Drag the four prices, or try a preset. The read-out names the candle and says what it means.')}
<p>A single candle is a clue, not a signal. A hammer in the middle of nowhere means little; a hammer exactly at a level where price has
turned before means much more. The rest of this course is about finding those levels.</p>`,
    keys: ['Body = open to close; wicks = the high and the low.', 'Long wicks show rejection: one side pushed, the other pushed back harder.', 'Read candles at levels, not in isolation.'],
    quiz: [
      { q: 'A candle opens at 100, trades down to 94, and closes at 99.5. What is it called?', o: ['Shooting star', 'Hammer', 'Marubozu'], a: 1, why: 'A small body near the top and a long lower wick: sellers pushed down, buyers pushed it all the way back.' },
      { q: 'What does a candle with almost no wicks and a tall green body show?', o: ['Indecision', 'Buyers in full control for the whole period', 'A coming reversal'], a: 1, why: 'No wicks means no pushback: price went one way from open to close.' },
    ],
    practice: 'Open the desk on any coin, switch to 1H, and find three hammers. How many happened at a level price had turned at before?' },

  { slug: 'market-structure', track: 'basics', title: 'Market structure', mins: 6, tags: ['Replay', 'Quiz'],
    sum: 'Higher highs and higher lows, lower highs and lower lows: how to tell who is in control.',
    body: `<p>Price moves in waves. Each wave leaves a <b>swing high</b> and a <b>swing low</b>. Join them and the trend appears:</p>
<ul><li><b>Uptrend</b> — higher highs (HH) and higher lows (HL). Every push goes further, every dip stops above the last one.</li>
<li><b>Downtrend</b> — lower highs (LH) and lower lows (LL). Every drop goes further, every bounce fails below the last high.</li>
<li><b>Range</b> — neither: highs and lows at roughly the same prices.</li></ul>
<p>Think of stairs: an uptrend climbs them, a downtrend walks down. As long as the staircase holds, the trend is intact.
Press <b>Replay</b> and watch the structure flip from up to down.</p>
${replay('structure')}
${callout('info', 'Why it matters', '<p>Structure decides which side you look for. In an uptrend you look for longs on dips; in a downtrend, shorts on bounces. Trading against structure is swimming upstream.</p>')}`,
    keys: ['Uptrend = HH + HL; downtrend = LH + LL.', 'A trend holds until it fails to make its next swing.', 'Structure picks the side; everything else picks the price.'],
    quiz: [
      { q: 'Price makes a new high, dips, and the dip stops above the previous dip. What is that dip?', o: ['A lower low', 'A higher low', 'A lower high'], a: 1, why: 'A dip that holds above the previous dip is a higher low — the uptrend is intact.' },
      { q: 'In a clear downtrend, where do you look for trades?', o: ['Longs on every dip', 'Shorts when price bounces into a lower high', 'Anywhere, structure doesn’t matter'], a: 1, why: 'Trade with structure: in a downtrend, sell the bounces.' },
    ],
    practice: 'Start a replay on BTC 4H a few months back. Before pressing play, label the last three swings HH/HL or LH/LL.' },

  { slug: 'bos-choch', track: 'basics', title: 'BOS and CHoCH', mins: 6, tags: ['Replay', 'Quiz'],
    sum: 'A break with the trend continues it; the first break against it is the warning. And only a body close counts.',
    body: `<p><b>BOS — break of structure:</b> price closes past the last swing <i>in the trend’s direction</i>. In an uptrend that is a close above the last high.
It says “the trend continues”.</p>
<p><b>CHoCH — change of character:</b> the first close past a swing <i>against</i> the trend. In an uptrend, a close below the last higher low.
It is the first warning that control is changing hands.</p>
${table(['', 'BOS', 'CHoCH'], [['Direction', 'With the trend', 'Against the trend'], ['Message', 'Trend continues', 'Trend may be turning'], ['What to do', 'Look for an entry on the next pullback', 'Stop looking for the old side; wait for the new structure']])}
<h2>Only a body close breaks a level</h2>
<p>A wick that pokes through a low and comes back is <b>not</b> a break. Like dipping a toe in a puddle and pulling it back.
A real break is the body closing on the other side — jumping over the puddle. Replay it:</p>
${replay('ind1')}
${callout('warn', 'Not every CHoCH is a reversal', '<p>Sometimes it is just a deeper pullback. Treat it as “stop buying”, not “sell everything”, and wait for the new structure to confirm.</p>')}`,
    keys: ['BOS = close past a swing with the trend; CHoCH = first close past a swing against it.', 'A wick through a level is not a break. Wait for the body close.', 'After a CHoCH, stop trading the old direction.'],
    quiz: [
      { q: 'Uptrend. A candle wicks below the last higher low but closes back above it. What happened?', o: ['A CHoCH: the trend turned', 'Nothing broke: only the wick went through', 'A BOS down'], a: 1, why: 'Only a body close breaks a level. The wick dipped a toe in and pulled back.' },
      { q: 'Downtrend. Price closes below the last lower low. That is…', o: ['A BOS — the downtrend continues', 'A CHoCH — the trend turned up', 'A fake break'], a: 0, why: 'A close past a swing in the trend’s direction is a break of structure.' },
    ],
    practice: 'On the desk, turn on the SMC overlay. Every BOS and CHoCH it draws is a body close past a swing — check a few by hand.' },

  { slug: 'position-size', track: 'basics', title: 'Position size and R', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'Pick the stop first, then the size. Risk the same amount every trade, measured in R.',
    body: `<p>The most important number in a trade is not the entry or the target — it is <b>how much you lose if you are wrong</b>.
Good traders fix that amount first (say 1% of the account) and work the position size backwards from the stop:</p>
<p class="formula">size = money at risk ÷ stop distance</p>
<p>That loss is called <b>1R</b>. A trade that makes twice what it risked is +2R; a stopped trade is −1R. Measuring in R lets you compare
trades of any size and any coin.</p>
${widget('risk', 'Change the stop: the position size changes, the risk does not. Leverage only changes the margin.')}
${callout('warn', 'Leverage is not risk — but liquidation is', '<p>Higher leverage needs less margin for the same position, but brings liquidation closer. If liquidation sits before your stop, you are not trading the stop you planned. Lower the leverage until it doesn’t.</p>')}`,
    keys: ['Choose the stop, then size the trade so the stop costs a fixed amount.', 'Results in R make trades comparable.', 'Liquidation must sit beyond the stop.'],
    quiz: [
      { q: 'You risk $50 with a 2% stop. How big is the position?', o: ['$100', '$2,500', '$1,000'], a: 1, why: '$50 ÷ 2% = $2,500. If price moves 2% against you, you lose $50.' },
      { q: 'You raise the leverage from 5× to 20× and keep the same size and stop. What changes?', o: ['The money at risk', 'Only the margin, and liquidation moves closer', 'Nothing'], a: 1, why: 'Same size and stop = same risk. Leverage only shrinks the margin — and moves liquidation nearer.' },
    ],
    practice: 'On the desk ticket, enter your stop first. The ticket shows the loss in dollars and as a % of your balance before you place it.' },

  // ---------------------------------------------------------------------------------------------------- candlestick patterns
  { slug: 'candle-patterns', track: 'candles', title: 'How candle patterns work', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'A pattern is one to three candles that show who won a fight. Where it appears matters as much as its shape.',
    body: `<p>A candlestick pattern is a short story told in one to three candles: one side was winning, then the other side hit back.
Traders gave the common stories names — hammer, engulfing, morning star — so they can spot them fast.</p>
<p>Three things decide whether a pattern means anything:</p>
<ul><li><b>The move before it.</b> A reversal pattern needs something to reverse. A hammer is only a hammer after a drop; the same candle after a rise is a hanging man.</li>
<li><b>Where it forms.</b> At a level where price turned before — a swing low, a zone, the edge of a range — it says “this level held again”. In the middle of nowhere it says little.</li>
<li><b>What comes next.</b> The candle after the pattern either keeps going its way or cancels it.</li></ul>
${widget('cpctx', 'Pick a shape and the move before it. The same candle gets a different name, or none, depending on what came first.')}
<h2>Bullish, bearish, or no side</h2>
<p><b class="up">Bullish</b> patterns come after a drop and hint at a turn up. <b class="down">Bearish</b> ones come after a rise and hint at a turn down.
A few — the doji, the spinning top, the inside bar — have no side: they only say the market paused.</p>
${callout('warn', 'Before you learn 25 patterns', '<p>We coded every pattern in this track and traded 63,000 of them on 40 real coins. None beat a random entry by enough to pay the fees. Learn them as a way to read who is winning, and test any rule on replay before you put money on it. <a href="/learn/patterns-tested">The last lesson</a> has the numbers.</p>')}`,
    keys: ['A pattern is a short story of who won: one side pushed, the other pushed back harder.', 'The move before decides the name: the same shape is a hammer after a drop and a hanging man after a rise.', 'A pattern at a level means more than one in the middle of nowhere.'],
    quiz: [
      { q: 'A small-bodied candle with a long lower wick appears after a strong rise. What is it called?', o: ['A hammer — bullish', 'A hanging man — a bearish warning', 'A doji'], a: 1, why: 'Same shape as a hammer, but after a rise it is a hanging man: sellers managed a deep dip near the top.' },
      { q: 'Which of these has no side of its own?', o: ['Bullish engulfing', 'Inside bar', 'Shooting star'], a: 1, why: 'An inside bar is a pause inside the candle before it. Traders wait for it to break up or down.' },
      { q: 'Where does a bullish pattern mean the most?', o: ['In the middle of a range', 'After a drop, at a level where price turned up before', 'After a long rise'], a: 1, why: 'A bullish pattern says buyers came back. At a level that held before, it says the level held again.' },
    ],
    practice: 'On the desk, open any coin on 1H and find five hammers. For each one: was there a drop before it, and was it at a level?' },

  { slug: 'single-candle-patterns', track: 'candles', title: 'Hammers, stars and dojis', mins: 6, tags: ['Interactive', 'Quiz'],
    sum: 'The one-candle patterns and the inside bar: what each one says, how to spot it and how it is traded.',
    body: `<p>Single-candle patterns are all about the wicks. A long wick is a push that failed: price went there and was thrown back.</p>
${table(['Pattern', 'Comes after', 'Shape', 'Says'], [
  ['Hammer', 'a drop', 'small body on top, long lower wick', R('bullish', 'pos')],
  ['Inverted hammer', 'a drop', 'small body at the bottom, long upper wick', R('bullish', 'pos')],
  ['Dragonfly doji', 'a drop', 'open = close at the top, long lower wick', R('bullish', 'pos')],
  ['Hanging man', 'a rise', 'the hammer’s shape', R('bearish', 'neg')],
  ['Shooting star', 'a rise', 'small body at the bottom, long upper wick', R('bearish', 'neg')],
  ['Gravestone doji', 'a rise', 'open = close at the bottom, long upper wick', R('bearish', 'neg')],
  ['Marubozu', 'anywhere', 'tall body, almost no wicks', 'its colour is in control'],
  ['Doji, spinning top, inside bar', 'anywhere', 'tiny body, or a candle inside the last one', R('no side', 'mix')]])}
${widget('cpsingle', 'Pick a pattern. The chart is a textbook example with invented candles; the panel gives the rule, the standard trade and what that trade did on real charts.')}
${callout('info', 'Watch the stop size', '<p>A hanging man’s stop goes just above its high, often only a few tenths of a percent away. On real charts its typical stop was 0.24%, so fees alone cost about 0.4R a trade. A tight stop looks cheap and is not.</p>')}`,
    keys: ['A long wick is a push that failed.', 'Hammer, inverted hammer, dragonfly: after a drop. Hanging man, shooting star, gravestone: after a rise.', 'Dojis, spinning tops and inside bars have no side: wait for the break.'],
    quiz: [
      { q: 'After a rise, a candle shoots up and then closes near its low, leaving a long upper wick. What is it?', o: ['Shooting star', 'Hammer', 'Marubozu'], a: 0, why: 'Buyers pushed far up and sellers slammed it back. After a rise that is a shooting star.' },
      { q: 'A doji forms after a drop. What do you do?', o: ['Go long: a doji is bullish', 'Wait: a doji has no side, the next candles decide', 'Go short'], a: 1, why: 'A doji is indecision. A close above its high or below its low tells you which side won.' },
      { q: 'Why did hanging-man trades lose about 0.6R each on real charts?', o: ['The pattern always fails', 'Its stop is tiny, so fees take a big part of every R', 'It was only tested on BTC'], a: 1, why: 'The stop sits just above a candle with almost no upper wick. 0.1% of fees on a 0.24% stop is 0.4R before anything else happens.' },
    ],
    practice: 'On a 15m chart, find three shooting stars after a rise. Mark where the stop would go and how far away it is in %.' },

  { slug: 'bullish-patterns', track: 'candles', title: 'Bullish reversal patterns', mins: 7, tags: ['Replay', 'Interactive', 'Quiz'],
    sum: 'Engulfing, piercing line, harami, tweezer bottom, morning star, three white soldiers: buyers taking over after a drop.',
    body: `<p>The two- and three-candle bullish patterns all tell one story: sellers were in charge, then buyers took over.
The more of the sellers’ candle the buyers take back, the stronger the message.</p>
<ul><li><b>Bullish engulfing</b> — the green body swallows the whole red body. Buyers took back everything and more.</li>
<li><b>Piercing line</b> — the green candle closes past the middle of the red one. More than half taken back.</li>
<li><b>Bullish harami</b> — a small green body sits inside the big red one. The selling stopped; nothing more yet.</li>
<li><b>Tweezer bottom</b> — a red and a green candle with the same low. The level held twice.</li>
<li><b>Morning star</b> — big red, a small pause candle, then big green. The turn, spread over three candles.</li>
<li><b>Three white soldiers</b> — three strong green candles in a row: buyers in control.</li>
<li><b>Three inside up</b> — a bullish harami, then a green candle that closes above the big red candle’s open.</li></ul>
<p>Press <b>Replay</b> to watch a bullish engulfing form and the standard trade play out.</p>
${replay('cp-bullengulf')}
${widget('cpbull', 'Every bullish pattern with its rule, its trade and its real-chart result.')}`,
    keys: ['Bullish patterns need a drop before them.', 'The more of the red candle the green one takes back, the stronger the message: harami, then piercing line, then engulfing.', 'The standard trade: long at the next open, stop just under the pattern’s low.'],
    quiz: [
      { q: 'After a drop, a small green body forms inside a big red body. Which pattern is it?', o: ['Bullish engulfing', 'Bullish harami', 'Piercing line'], a: 1, why: 'Inside = harami. An engulfing body is bigger than the red one, not inside it.' },
      { q: 'Where does the stop go on a bullish engulfing long?', o: ['Just under the lowest low of the two candles', 'Under the green candle’s open', '1% under the entry'], a: 0, why: 'The pattern is wrong if price goes below its low, so the stop goes just under it.' },
      { q: 'A green candle closes above the middle of a big red one, but not above its open. What is it?', o: ['Piercing line', 'Bullish engulfing', 'Morning star'], a: 0, why: 'Past the middle but not the whole body: a piercing line.' },
    ],
    practice: 'Start a replay on any coin on 1H. Each time a bullish engulfing appears after a drop, note whether the next five candles went your way.' },

  { slug: 'bearish-patterns', track: 'candles', title: 'Bearish reversal patterns', mins: 7, tags: ['Replay', 'Interactive', 'Quiz'],
    sum: 'Engulfing, dark cloud cover, harami, tweezer top, evening star, three black crows: sellers taking over after a rise.',
    body: `<p>The bearish patterns are the bullish ones turned upside down: buyers were in charge, then sellers took over.</p>
<ul><li><b>Bearish engulfing</b> — the red body swallows the whole green body.</li>
<li><b>Dark cloud cover</b> — the red candle closes below the middle of the green one.</li>
<li><b>Bearish harami</b> — a small red body inside the big green one. The buying stopped.</li>
<li><b>Tweezer top</b> — a green and a red candle with the same high. The level held twice.</li>
<li><b>Evening star</b> — big green, a small pause candle, then big red.</li>
<li><b>Three black crows</b> — three strong red candles in a row: sellers in control.</li>
<li><b>Three inside down</b> — a bearish harami, then a red candle that closes below the big green candle’s open.</li></ul>
${replay('cp-evening')}
${callout('info', 'Crypto has no gaps', '<p>Stock-market books say a star’s middle candle must gap away, and that a dark cloud opens above the previous high. Crypto trades all day, every day, so each candle opens where the last one closed. Here, as on most crypto charts, the patterns are read without gaps.</p>')}
${widget('cpbear', 'Every bearish pattern with its rule, its trade and its real-chart result.')}`,
    keys: ['Bearish patterns need a rise before them.', 'Evening star: big green, small, then big red closing deep into the green.', 'The standard trade: short at the next open, stop just above the pattern’s high.'],
    quiz: [
      { q: 'After a rise: a big green candle, a tiny candle, then a red candle closing below the middle of the green one. Which pattern?', o: ['Evening star', 'Three black crows', 'Bearish harami'], a: 0, why: 'Big green, a pause, then big red: the evening star.' },
      { q: 'After a rise, a green candle and then a red one have exactly the same high. What is it?', o: ['Tweezer top', 'Dark cloud cover', 'Inside bar'], a: 0, why: 'Two candles, same high, green then red: buyers failed at that price twice.' },
      { q: 'Why are stars and dark clouds read without gaps on crypto charts?', o: ['Crypto trades non-stop, so each candle opens where the last one closed', 'Exchanges forbid gaps', 'They are different patterns on crypto'], a: 0, why: 'Gaps come from markets that close overnight. A 24/7 market rarely has them.' },
    ],
    practice: 'On the desk, find three evening stars on 4H charts. How many formed at a level where price had turned down before?' },

  { slug: 'pattern-entries', track: 'candles', title: 'Entry, stop and target', mins: 6, tags: ['Interactive', 'Quiz'],
    sum: 'Three ways into the same pattern — at the next open, on the break, on a pullback — and where the stop and the target go.',
    body: `<p>Spotting the pattern is half the job. The other half is the trade: where you get in, where you are wrong and where you take profit.</p>
<h2>Three entries</h2>
${table(['Entry', 'How', 'Good', 'Bad'], [
  ['Next open', 'Market order as soon as the pattern closes', 'Always fills', 'No proof the pattern worked'],
  ['Break of the pattern', 'Stop order just past its high (long) or low (short)', 'Price has to move your way first', 'Worse price, bigger stop, smaller position'],
  ['Pullback', 'Limit order at the middle of the pattern', 'Best price, smallest stop', 'Strong moves never come back: you miss them']])}
<h2>The stop</h2>
<p>The pattern is wrong if price goes past its far end, so the stop goes just past it: under the lowest low for a long, above the highest high for a short.
Never move it closer to make the trade “fit”. Size the position from the stop instead (see <a href="/learn/position-size">Position size and R</a>).</p>
<h2>The target</h2>
<p>Measure it in R, the distance from entry to stop. 1R is hit more often; 2R pays twice as much when it is. The next level in the way — a swing high, a zone — is a natural target. If it is closer than 1R, the trade isn’t worth taking.</p>
${widget('cpentry', 'Pick a pattern, an entry and a target. The chart shows the orders; the panel shows the position for your risk and what fees cost in R.')}
${callout('warn', 'Fees are measured against the stop', '<p>Opening and closing a futures position costs about 0.1% of its size in taker fees. With a 1% stop that is 0.1R a trade; with a 0.25% stop it is 0.4R. The tighter the stop, the more of every win the fees take.</p>')}`,
    keys: ['Next open always fills; a break entry waits for proof; a pullback gets the best price but misses strong moves.', 'The stop goes just past the pattern’s far end. Size the position from it.', 'Fees in R = 0.1% ÷ the stop in %. Tight stops pay more fees per R.'],
    quiz: [
      { q: 'You trade a bullish engulfing with a buy-stop above its high. Price never breaks the high. What happens?', o: ['You are filled at the close anyway', 'No trade: the order never fills', 'Your stop is hit'], a: 1, why: 'A stop order only fills when price reaches it. No break, no trade — that is the point of waiting for one.' },
      { q: 'Your stop is 0.5% away and fees are 0.1% in and out. What do fees cost a trade, in R?', o: ['0.05R', '0.2R', '0.5R'], a: 1, why: '0.1% ÷ 0.5% = 0.2R. A 2R winner nets 1.8R and a loser costs 1.2R.' },
      { q: 'The next resistance is only 0.6R above your long entry. What do you do?', o: ['Take it with a 2R target', 'Skip it: there is less than 1R of room', 'Move the stop closer'], a: 1, why: 'The level in the way will likely stop price before your target. Moving the stop closer just makes it easier to hit.' },
    ],
    practice: 'On the desk, place a practice trade on a pattern: stop just past it, target 2R. Note the position size the ticket gives for your risk.' },

  { slug: 'pattern-trainer', track: 'candles', title: 'Pattern trainer', mins: 10, tags: ['Simulator'],
    sum: 'Real Binance charts stop on a pattern. Name it, trade it or skip it, and watch what really happened, scored against random entries.',
    body: `<p>Every round loads a real chart of a random coin and stops on the candle that completed a pattern. Two steps:</p>
<ol class="steps"><li><b>Name it.</b> Pick the pattern in the box.</li>
<li><b>Trade it, or don’t.</b> Choose long or short, the entry and the target; the stop goes just past the pattern. Or skip it — skipping a bad spot is a skill too.</li></ol>
<p>Then the chart plays on, candle by candle, until the target, the stop or 30 candles. Your result is in R after fees, next to the same trade placed at random candles of the same chart.
If you beat random over many trades, your reading adds something. If you don’t, the pattern alone isn’t doing the work.</p>
${widget('cptrain', '')}
<p class="muted">Candles load straight from Binance into your browser. Play 10 rounds and this lesson completes. Your score stays in this browser.</p>`,
    keys: ['Name it, then decide: long, short or skip.', 'Judge yourself against random entries with the same stop and target, not against zero.', 'Under about 100 trades, any gap from random is mostly luck.'],
    quiz: [], practice: 'Pick one pattern in the trainer and play 20 rounds of only that one. Did reading the context — the move before, the level — beat random?' },

  { slug: 'patterns-tested', track: 'candles', title: 'Do candle patterns work?', mins: 6, tags: ['Evidence', 'Interactive'],
    sum: 'We coded 22 directional patterns and traded 63,000 of them on 40 coins. How they did against random entries — and a tool to check any coin yourself.',
    body: `<p>Every lesson in this track shows a textbook picture where the pattern works. The fair question is whether, on real charts, trading a pattern beats entering at a random moment with the same stop and target.</p>
<h2>How we tested</h2>
<ul><li><b>Data:</b> 40 Binance perpetual futures in two separate sets of 20 (BTC, ETH, SOL… and LTC, DOT, AAVE…). 15m candles for 60 days, 1H for 180 days, 4H for two years, up to 18 Nov 2026.</li>
<li><b>Trade:</b> the standard one. Entry at the next open, stop just past the pattern, target 1R or 2R, at most 48 candles.</li>
<li><b>Random:</b> the same side, stop size and target, from 20 random candles of the same chart for every pattern trade.</li>
<li><b>Pass rule, written before the run:</b> a pattern beats random only if its 2R win rate is higher than random’s by more than luck allows, in the full test <i>and</i> in both halves of the data.</li></ul>
${table(['Pattern', 'Trades', '1R first (random)', '2R first (random)', 'After fees, 2R'], CP_ROWS)}
<h2>What it says</h2>
<ul><li><b>No pattern passed.</b> Bearish engulfing passed on the first 20 coins (37.4% against 34.4%) and then failed on the 20 unseen ones (34.7% against 34.5%).</li>
<li><b>A small tilt at 1R, found afterwards.</b> Tweezer bottom, piercing line and bearish harami reached 1R first 3–4 points more often than random on both sets of coins. We noticed it after the run, so it is a lead, not a rule — and it is smaller than the fees: they still lost 0.07–0.18R a trade.</li>
<li><b>Fees decide a lot.</b> With a 1% stop, fees cost 0.1R a trade. The hanging man and the inverted hammer, with stops around 0.2%, lost over 0.6R a trade, mostly to fees.</li></ul>
${callout('info', 'So why learn them?', '<p>Because they describe who is winning, candle by candle, and they turn up inside every other method — a sweep that closes back as a hammer, an engulfing at a zone. What the test says is that the shape alone is not an edge. Context might be, and that is what the trainer lets you test.</p>')}
<h2>Check any coin yourself</h2>
${widget('cpcheck', 'The same test on one coin and timeframe, run in your browser against random entries, with a 1R target.')}
<p class="muted">R is the amount risked. Results include 0.05% taker fees in and out; no slippage or funding.</p>`,
    keys: ['No candle pattern beat random entries after fees across 63,000 real trades.', 'A few tilt slightly at 1R — by less than the fees.', 'Tight stops make fees the biggest cost. Compare with random, not with zero.'],
    quiz: [], practice: 'Run the check on the coin you trade most, on two timeframes. Does any pattern look better than random on both?' },

  // ---------------------------------------------------------------------------------------------------- smart money
  { slug: 'liquidity-sweeps', track: 'smc', title: 'Liquidity and the sweep', mins: 6, tags: ['Replay', 'Quiz'],
    sum: 'Stops pile up above obvious highs and below obvious lows. Price often spikes through them, then turns.',
    body: `<p>Above every obvious high sit the stop-losses of shorts and the buy orders of breakout traders. Below every obvious low sit longs’ stops.
SMC calls these pools <b>liquidity</b>. Large players need them to fill size, so price often spikes through a pool and reverses.
That spike-and-fail is a <b>sweep</b> (a stop hunt, or swing failure).</p>
${replay('liquidity')}
<h2>Sweep and reclaim</h2>
<p>The long version is the mirror image: price flushes below support, triggers the early longs’ stops, and snaps straight back above.
The V-shaped recovery and the higher low after it are the entry; the stop goes under the sweep low.</p>
<ol class="steps"><li>Wait for the sweep: a quick wick through the level.</li><li>Watch for the close back on the other side.</li><li>Enter on the base that forms after the reclaim.</li>
<li>Stop just past the sweep extreme — tight and structural.</li><li>Never chase the first vertical candle.</li></ol>`,
    keys: ['Equal highs and lows are liquidity pools: stops and breakout orders.', 'A sweep = wick through the pool + close back inside.', 'The stop goes past the sweep extreme.'],
    quiz: [
      { q: 'Where does buy-side liquidity sit?', o: ['Below obvious lows', 'Above obvious highs', 'At the 50% level'], a: 1, why: 'Shorts’ stops and breakout buy orders sit above highs — that is buy-side liquidity.' },
      { q: 'Price wicks above equal highs and the candle closes back below them. This is…', o: ['A breakout', 'A sweep', 'A BOS'], a: 1, why: 'Through the level and back inside on the close: the liquidity was taken and price failed.' },
    ],
    practice: 'Replay any meme coin around its daily high. Mark the equal highs before you play, then count how many get swept vs broken.' },

  { slug: 'sweep-or-breakout', track: 'smc', title: 'Sweep or breakout?', mins: 4, tags: ['Replay', 'Quiz'],
    sum: 'The same spike can start a real breakout. The close decides — shorting before it is guessing.',
    body: `<p>A sweep closes back below the level within a candle or two. A breakout closes above it and stays there — and the old highs often turn into support on the retest.</p>
${replay('breakout')}
${callout('info', 'Rule of thumb', '<p>A sweep is a wick through the level and a close back inside within 1–2 candles. Anything else: stand aside.</p>')}`,
    keys: ['Close back inside = sweep. Close and hold outside = breakout.', 'A retest that holds confirms the breakout.', 'No close, no trade.'],
    quiz: [
      { q: 'Price closes above equal highs, then the next candle also closes above. Short it?', o: ['Yes, it is a sweep', 'No — that is a breakout until a close back below', 'Yes, with a tight stop'], a: 1, why: 'Without a close back below there is no sweep. Shorting a holding breakout makes you the liquidity.' },
    ],
    practice: 'In a replay, step candle by candle when price reaches a high. Decide “sweep” or “breakout” only after the close.' },

  { slug: 'order-blocks-fvg', track: 'smc', title: 'Order blocks and fair value gaps', mins: 7, tags: ['Replay', 'Quiz'],
    sum: 'The last candle before a big move, and the gaps a fast move leaves behind. Price often comes back to both.',
    body: `<p><b>Order block (OB):</b> the last opposite-colour candle before a strong move. A bullish OB is the last red candle before a strong rally;
a bearish OB (a supply zone) is the last green candle before a strong drop. The idea: big players could not fill everything at once and
defend that price when it returns.</p>
<ol class="steps"><li>Find a strong move: three or more candles the same way.</li><li>Take the last opposite candle before it.</li><li>Mark its body: that is the zone.</li><li>When price returns there, look for an entry in the move’s direction.</li></ol>
<p><b>Fair value gap (FVG):</b> three candles where the first candle’s high and the third candle’s low don’t overlap. Price moved so fast
nobody traded in between. Price often comes back to fill the gap before carrying on.</p>
${replay('supply')}
${callout('info', 'With the trend', '<p>Zones and gaps in the direction of the higher-timeframe trend hold more often. Against the trend they tend to get filled and broken.</p>')}`,
    keys: ['OB = last opposite candle before a strong move.', 'FVG = gap between candle 1’s wick and candle 3’s wick.', 'Use zones in the trend’s direction.'],
    quiz: [
      { q: 'Which candle is a bearish order block?', o: ['The last green candle before a strong drop', 'The first red candle of the drop', 'The lowest candle of the drop'], a: 0, why: 'The last up candle before the drop is where sellers started — the supply zone.' },
      { q: 'An FVG in a fast move up is…', o: ['A gap between candle 1’s high and candle 3’s low', 'Any big green candle', 'The space between two swing highs'], a: 0, why: 'The gap left between the first and third candles’ wicks is the fair value gap.' },
    ],
    practice: 'Turn on the SMC overlay on the desk: it marks supply and demand zones. Replay forward and note which ones held.' },

  { slug: 'premium-discount', track: 'smc', title: 'Premium and discount', mins: 5, tags: ['Interactive', 'Replay', 'Quiz'],
    sum: 'Split the last leg at 50%. Sell in the top half, buy in the bottom half — don’t chase.',
    body: `<p>Take the last swing from low to high and split it at 50% (the equilibrium). Above the middle is <b>premium</b>, where shorts are taken.
Below is <b>discount</b>, where SMC traders look for longs. ICT’s favourite short entry is the 62–79% retracement, the “optimal trade entry” (OTE).</p>
${widget('zones', 'Move the price inside the leg and read where it sits.')}
${replay('premium')}`,
    keys: ['50% of the leg splits premium from discount.', 'Shorts in premium, longs in discount.', 'The 62–79% zone is the classic OTE.'],
    quiz: [
      { q: 'A leg runs from 90 to 120. Price is at 113. Where is it?', o: ['Discount', 'Premium', 'Exactly at equilibrium'], a: 1, why: '113 is above the 105 midpoint, so it is in premium — 77% of the range.' },
    ],
    practice: 'Use the 📐 fib tool on the desk from a swing low to a swing high. The 0.5 line is the equilibrium.' },

  { slug: 'full-setup', track: 'smc', title: 'The full short setup', mins: 6, tags: ['Replay', 'Quiz'],
    sum: 'Bearish structure, a bounce into premium, a sweep, a lower-timeframe CHoCH, then the entry — in that order.',
    body: `<p>Now the pieces go together in the order a trader checks them:</p>
<ol class="steps"><li><b>Structure</b> is bearish (lower highs, lower lows).</li><li>Price bounces into <b>premium</b> or a <b>supply zone</b>.</li>
<li>It <b>sweeps</b> the liquidity above (equal highs or the last high).</li><li>A lower-timeframe <b>CHoCH</b> confirms sellers are back.</li>
<li><b>Entry</b> on the close; stop above the sweep; target the liquidity below (the leg low), or 2R.</li></ol>
${replay('setup')}
<p>The long setup is the mirror: bullish structure, a dip into discount or a demand zone, a sweep of the lows, a lower-timeframe CHoCH up.</p>`,
    keys: ['Structure → zone → sweep → CHoCH → entry.', 'Stop past the sweep; target the opposite liquidity.', 'Missing a step = no trade.'],
    quiz: [
      { q: 'What comes right before the entry in this setup?', o: ['A lower-timeframe CHoCH', 'A higher high', 'A funding spike'], a: 0, why: 'The lower-timeframe CHoCH after the sweep is the trigger.' },
      { q: 'Where does the stop go?', o: ['Just above the sweep wick', 'At the entry candle’s low', 'At the 50% level'], a: 0, why: 'Past the sweep extreme: if price goes there, the idea was wrong.' },
    ],
    practice: 'Replay a downtrending coin on 15m. Write the five steps down and tick them off as candles print. Only trade when all five tick.' },

  { slug: 'timeframes', track: 'smc', title: 'Timeframes: direction, zone, entry', mins: 7, tags: ['Replay'],
    sum: 'One move on three charts: the slow one picks the side, the middle one the zone, the fast one the moment.',
    body: `<p>SMC traders read one move on three charts, each about four times faster than the one above. This is top-down analysis.</p>
${table(['How long you hold', 'Direction (slow)', 'Zone and sweep (middle)', 'Entry trigger (fast)'], [['Scalp: minutes to an hour', '1H', '15m or 5m', '1m'], ['Day trade: a few hours', '4H', '1H or 15m', '5m or 1m'], ['Swing: days', 'Daily', '4H', '1H or 15m']])}
${cards([['1 · Slow chart', 'Direction: which way', '<p>Read the last BOS or CHoCH and where price sits in the leg. It changes a few times a week, not every hour.</p>'],
  ['2 · Middle chart', 'Zone: where', '<p>Find the supply zone and the liquidity inside the slow chart’s premium. Wait for a sweep that closes back.</p>'],
  ['3 · Fast chart', 'Entry: when', '<p>After the sweep candle closes, enter on the first close past the last swing (the CHoCH). Never take direction from this chart.</p>']])}
<p>The three charts below are the same move: the 4H, then one 4H candle on the 15m, then one 15m candle on the 1m.</p>
${replay('tf4h', '<b>4H</b> · Step 1 — direction')}${replay('tf15', '<b>15m</b> · Step 2 — zone and sweep')}${replay('tf1', '<b>1m</b> · Step 3 — entry')}
${callout('muted', 'What our test says', '<p>On 204 small-cap perps (14 Sep – 13 Nov 2026), the 15m A+ shorts made −0.09R a trade with the 4H trend and −0.03R against it; longs −0.21R with it and −0.33R against it. Agreeing with the slow chart kept you out of the worst longs. It didn’t make the setup profitable.</p>')}`,
    keys: ['Slow chart = direction, middle = zone, fast = entry.', 'Each chart is about 4× faster than the one above.', 'Never take direction from the fastest chart.'],
    quiz: [
      { q: 'You day-trade. Which chart sets the direction?', o: ['1m', '4H', '15m'], a: 1, why: 'For a day trade the 4H decides the side; 15m/1H find the zone; 5m/1m time the entry.' },
    ],
    practice: 'Split the desk into a habit: check 4H first, then switch the replay to 15m for the zone, then 1m for the trigger.' },

  { slug: 'zone-retest', track: 'smc', title: 'Zone retest', mins: 6, tags: ['Replay'],
    sum: 'The simpler version you see in Telegram groups: a limit order waiting at the order block. Cheaper entry, no confirmation.',
    body: `<p>Mark the order block at the top of a move, wait for a break of structure, then put a sell limit at the box’s edge for the first return.
The stop goes above the box and the target is the recent low. There is no sweep and no lower-timeframe CHoCH.</p>
${replay('retest')}
${table(['Step', 'Zone retest', 'Full setup (sweep + CHoCH)'], [['Direction', 'BOS on the same chart', 'The same, plus the slow chart'], ['Where', 'First return to the order block', 'Premium of the leg, or the supply zone'], ['Liquidity sweep', 'Not needed', 'Needed'], ['Entry', 'Sell limit already waiting at the zone', 'Close of the fast-chart CHoCH'], ['Stop', 'Just above the zone', 'Just above the sweep wick'], ['Target', 'The recent low, about 3R', 'The leg’s low, or 2R']])}
<p>Skipping the confirmation gets a better price and a bigger R when the zone holds. When price runs straight through the box, the stop is hit with no warning.</p>
${callout('muted', 'What our test says', '<p>On 18 forex, metal, oil and index markets (Nov 2023 – Oct 2026, spreads in), the 4H zone retest made −0.04R a trade over 5,017 trades — about the same as random entries (−0.05R). Gold was the one exception: +0.26R on the 4H and +0.14R on unseen 2022–24 data, but only with forex-tight spreads; with crypto perp fees it lost (−0.13R). Screenshots in groups show the trades that worked. Nobody posts the stops.</p>')}`,
    keys: ['Limit at the zone edge, stop above, target the recent low.', 'Better price, no confirmation.', 'Tested: about the same as random entries outside gold.'],
    quiz: [], practice: 'Place a paper sell limit at a supply zone in a replay and let it run. Log whether price respected the zone or ran through.' },

  { slug: 'inducement', track: 'smc', title: 'Inducement', mins: 8, tags: ['Replay'],
    sum: 'A wick-only break leaves bait above a small high. Price grabs it, taps the order block, then falls — sometimes.',
    body: `<p>This builds on one rule from <a href="/learn/bos-choch">BOS and CHoCH</a>: a low breaks only when a body closes past it. A fake break — only a wick — is said to tell you where price goes next.</p>
${cards([['Real break', 'Jump over the puddle', '<p>The body closes below the low.</p>', 'go'], ['Fake break', 'Dip a toe in', '<p>Only the wick goes below; the body closes back above.</p>', 'no'],
  ['Inducement', 'The bait', '<p>The small high just before a fake break. Stops sit above it — big players like to grab them first.</p>'], ['Order block', 'The box', '<p>The last up candle before the last real break. Price is said to climb back to it before falling.</p>']])}
<p><b>The story:</b> real break → fake break → price grabs the bait → touches the box → falls through the wick low.</p>
${replay('ind2', '<b>Example</b> · The short, when it works')}${replay('ind3', '<b>Example</b> · The long: the same idea upside down')}${replay('ind4', '<b>Example</b> · When it goes wrong (the usual ending)')}${replay('ind5', '<b>Example</b> · No trade: the wick becomes a real break')}
${callout('muted', 'What our test says', `<p>We coded the rules and replayed them with fees on forex, metals, indices, 10 big coins and 207 small-cap perps across four timeframes, compared with random entries on the same market and side.</p>
${table(['Timeframe', 'Trades', 'Inducement', 'Random entry'], [['15m (crypto)', '3,691', R('−0.12R', 'neg'), R('−0.23R', 'neg')], ['1H', '1,446', R('−0.24R', 'neg'), R('−0.07R', 'neg')], ['4H', '375', R('−0.02R', 'mix'), R('−0.03R', 'mix')], ['Daily', '32', R('−0.57R', 'neg'), R('+0.05R', 'pos')], ['<b>All</b>', '5,544', R('−0.14R', 'neg'), R('−0.17R', 'neg')]])}
<p>About 3 trades in 4 hit the stop before the wick low. The picture does happen — just not more often than chance.</p>`)}`,
    keys: ['Wick-only break = fake; the small high before it = inducement.', 'Sell limit at the order block, stop above it, target the wick low.', 'Tested: no better than random after fees.'],
    quiz: [
      { q: 'Price wicks below a low but closes above. The small high just before is…', o: ['The order block', 'The inducement', 'A BOS'], a: 1, why: 'The high before a fake break is the bait — the inducement.' },
    ],
    practice: 'Find a wick-only break in a replay. Mark the inducement high and the order block before you press play.' },

  { slug: 'practice-drills', track: 'smc', title: 'Practice drills', mins: 10, tags: ['Drills'],
    sum: 'Eight charts that stop at a decision. Pick your answer, then watch what happened.',
    body: `<p>Each chart stops at the moment you would have to decide. Pick an answer and the chart plays on. Drills 1–7 have a right answer;
drill 8 doesn’t — it shows the price of waiting for confirmation. Get all seven right and this lesson completes.</p>
<div class="drill-score" id="smc-score" aria-live="polite">Score: 0 of 7 right</div><div class="drills" id="smc-drill-list" data-drills></div>`,
    keys: ['Decide before you see the next candle.', 'Context first: structure and premium/discount.', 'No close back inside, no sweep.'],
    quiz: [], practice: 'Do the same on real charts: start a random replay and write your decision before each step.' },

  { slug: 'what-tests-say', track: 'smc', title: 'What our tests say', mins: 5, tags: ['Evidence'],
    sum: 'SMC is easy to draw after the fact. We coded its rules and replayed them with fees. Here is what held up.',
    body: `<p>Every lesson above can be drawn perfectly on a chart that already happened. The question is whether the rules make money when you
follow them blind, with fees, against a fair comparison. We turned them into exact code and replayed them.</p>
${table(['Setup', 'Market and period', 'Result'], [
  ['ICT 4H FVG return', 'Gold, BTC, ETH, small-cap perps', R('gold ≈ 0 to +0.3R, big coins lose', 'neg')],
  ['New York first hour / Asia range sweep', 'BTC, ETH, gold, QQQ (1m)', R('≈ 0R before fees, loses after', 'neg')],
  ['Asia range and previous-day high/low sweeps', 'Forex majors', R('loses in both halves', 'neg')],
  ['1H swing-high sweep, 15m close back, tight stop', 'BTC, ETH, BNB, DOGE, ADA, AVAX, 12 months', R('−0.19R a trade (+0.10R before fees)', 'neg')],
  ['The full setup (lesson rules), 15m', '207 small-cap perps, 14 Oct – 13 Nov 2026', R('−0.18R a trade, same as random', 'neg')],
  ['Same, only with the 4H trend', '204 small-cap perps, 14 Sep – 13 Nov 2026', R('shorts −0.09R, longs −0.21R', 'neg')],
  ['Zone retest, limit at the zone edge', '18 forex/metal/oil/index markets, 4H, 3 years', R('−0.04R (random −0.05R)', 'neg')],
  ['Same, gold only', 'Gold 4H 2023–26, PAXG 2022–24 unseen', R('+0.26R, +0.14R with tight spreads; −0.13R with perp fees', 'mix')],
  ['Inducement', 'Forex, metals, indices, 10 big coins, 207 perps; 15m–daily', R('−0.14R over 5,544 trades (random −0.17R)', 'neg')]])}
${callout('info', 'So why learn it?', '<p>Because the language is useful — structure, liquidity and zones describe where traders are trapped and where stops sit. What the tests say is that drawing the shapes is not an edge on its own. Use the replay desk to find out, with your own rules, whether <i>your</i> version beats a coin flip before you risk money on it.</p>')}
<p class="muted">R is the amount risked: −0.14R means losing 14 cents per dollar risked, on average. Tests include exchange fees and spreads.</p>`,
    keys: ['Most coded SMC rules lost after fees.', 'Gold on 4H with tight spreads was the one consistent exception.', 'Test your own rules on replay before trading them.'],
    quiz: [], practice: 'Pick one rule from this course, run it on 30 random replays and compare your average R with a coin flip.' },

  // ---------------------------------------------------------------------------------------------------- derivatives
  { slug: 'open-interest', track: 'derivs', title: 'Open interest', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'How many futures contracts are open — and what it means when it rises or falls with price.',
    body: `<p><b>Open interest (OI)</b> is the number of futures contracts that are open right now. Think of it as how many people are sitting at the
poker table with money on it. OI rises when new positions open and falls when positions close. On its own it has no direction —
read it together with price:</p>
${widget('oi', 'Pick a price direction and an OI direction.')}
<p>A big OI spike during a fast move means a lot of fresh leverage — fuel for the move, and fuel for a squeeze if it turns.</p>`,
    keys: ['OI counts open positions, not direction.', 'Price and OI up together = new money behind the move.', 'Price up with OI down = short covering, often short-lived.'],
    quiz: [
      { q: 'Price falls and OI rises sharply. What is most likely?', o: ['Longs are closing', 'New shorts are opening', 'Shorts are covering'], a: 1, why: 'Falling price with rising OI means fresh positions are opening on the sell side.' },
      { q: 'Price rises while OI falls. What is driving it?', o: ['New buyers with leverage', 'Shorts buying back to close', 'Funding payments'], a: 1, why: 'Positions are closing while price rises: shorts are covering.' },
    ],
    practice: 'Watch the 24h volume read-out on the desk during a fast pump, then compare with OI on your exchange.' },

  { slug: 'funding-rate', track: 'derivs', title: 'Funding rate', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'The fee one side of a perpetual pays the other every 8 hours — and a live gauge of which side is crowded.',
    body: `<p>Perpetual futures never expire, so exchanges keep their price near spot with a <b>funding fee</b>, usually every 8 hours.
When funding is <b>positive</b>, longs pay shorts — more people are long. When it is <b>negative</b>, shorts pay longs.</p>
${widget('funding', 'Slide the funding rate and your position size.')}
${table(['Funding', 'Reading'], [['−0.01% to +0.01%', 'Normal: tells you little'], ['±0.05%', 'Elevated: one side is getting expensive to hold'], ['Beyond ±0.1%', 'Extreme: crowded. A sharp move against them can force a cascade']])}`,
    keys: ['Positive = longs pay shorts; negative = shorts pay longs.', 'Extreme funding = a crowded side.', 'Crowded sides are squeeze fuel.'],
    quiz: [
      { q: 'Funding is −0.12%. Who is crowded?', o: ['Longs', 'Shorts', 'Nobody'], a: 1, why: 'Negative funding means shorts pay longs: the short side is crowded.' },
      { q: 'You hold a $2,000 long with funding +0.05% per 8h. What do you pay a day?', o: ['$1', '$3', '$0.30'], a: 1, why: '0.05% × $2,000 = $1 per 8 hours, three times a day = $3.' },
    ],
    practice: 'Next time a coin pumps hard, check its funding. Note whether the crowded side got squeezed in the following hours.' },

  { slug: 'squeezes', track: 'derivs', title: 'Short and long squeezes', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'Forced exits feed the move that forced them. Push the price and watch the chain reaction.',
    body: `<p>In a <b>short squeeze</b>, price rises into a crowd of shorts. Their stops and liquidations are market <i>buy</i> orders, which push price
higher, which liquidates the next group — a chain reaction. A <b>long squeeze</b> is the mirror: forced selling that feeds a crash.</p>
${widget('squeeze', 'Press “Push price” — a small push reaches the first cluster, and the forced orders do the rest.')}
<h2>How one forms</h2>
${cards([['Short squeeze', 'Signs to watch', '<ol><li>Funding deeply negative (crowded shorts).</li><li>OI high and rising.</li><li>Price starts rising despite the shorts.</li><li>Retail L/S below ~0.85 while top traders are long.</li></ol>', 'go'],
  ['Long squeeze', 'Signs to watch', '<ol><li>Funding strongly positive (crowded longs).</li><li>OI elevated with leverage.</li><li>A whale deposits tokens to an exchange.</li><li>One big sell starts the long liquidations.</li></ol>', 'no']])}`,
    keys: ['Liquidations are market orders in the move’s direction.', 'Crowded side + rising OI + a push = a squeeze.', 'Squeezes overshoot, then often reverse hard.'],
    quiz: [
      { q: 'In a short squeeze, shorts’ liquidations are…', o: ['Sell orders', 'Buy orders', 'Limit orders resting below price'], a: 1, why: 'Closing a short means buying — forced buying pushes price up further.' },
    ],
    practice: 'Find a coin that gained 50%+ in a day. Replay the hour before the top and look at how fast the last legs moved.' },

  { slug: 'long-short-ratio', track: 'derivs', title: 'Long/short ratios', mins: 5, tags: ['Interactive', 'Quiz'],
    sum: 'Retail vs top traders: when the crowd leans one way and the big money the other, someone is trapped.',
    body: `<p>Exchanges publish how many accounts are long versus short. The useful part is the <b>difference</b> between groups:</p>
<ul><li><b>Retail L/S (accounts)</b> — how many small accounts lean each way. Below 1.0 = more shorts than longs.</li>
<li><b>Top trader L/S (accounts)</b> — the biggest accounts, counted as people.</li>
<li><b>Top trader L/S (positions)</b> — the biggest accounts weighted by money. A $1M long counts more than ten small shorts.</li></ul>
${widget('ls', 'Set the two ratios and read the verdict.')}
${callout('muted', 'Honest note', '<p>We tested L/S ratios as entry filters on pump coins (full Bybit history). None gave a robust edge on its own. Use them to understand who is trapped, not as a trigger.</p>')}`,
    keys: ['Compare retail with top traders; the gap is the signal.', 'Retail short + whales long = squeeze-up risk.', 'Not a trigger on its own.'],
    quiz: [
      { q: 'Retail L/S 0.72, top trader positions 1.7. What setup is that?', o: ['Dump setup', 'Squeeze-up setup', 'No divergence'], a: 1, why: 'Retail crowded short while big money is long — the classic squeeze-up divergence.' },
    ],
    practice: 'Check a coin’s L/S ratios on your exchange before and after a big move. Who was on the wrong side?' },

  { slug: 'oi-vs-spot', track: 'derivs', title: 'Real breakout or leverage trap?', mins: 5, tags: ['Interactive'],
    sum: 'A move with real spot buying has legs. A move made only of futures leverage collapses the moment it turns.',
    body: `<p>A sustainable breakout needs real spot buying. If futures volume and OI explode while spot volume stays flat, the move is pure
leverage — one big candle the other way wipes everyone out.</p>
${widget('oispot', 'Adjust the readings, or load one of the two presets.')}
${table(['Reading', 'Real breakout', 'Leverage trap'], [['Futures vs spot volume', 'Both expanding', 'Futures 10× spot or more'], ['Open interest', 'Rising steadily', 'Exploding (+300%)'], ['Funding', 'Mild', 'Extreme (above 0.1%)'], ['Liquidations', 'Both sides', 'One-sided (shorts only)']])}`,
    keys: ['Compare futures volume with spot volume.', 'Exploding OI + flat spot = leverage trap.', 'Never chase a pump that only shows in futures.'],
    quiz: [], practice: 'For the next pump you see, compare its futures and spot volume before deciding it is “real”.' },

  { slug: 'exchange-flow', track: 'derivs', title: 'Exchange flows and whale wallets', mins: 7, tags: ['Interactive', 'Quiz'],
    sum: 'Tokens leaving exchanges, tokens arriving, and the moment they hit the hot wallet. Follow the money step by step.',
    body: `<p><b>Outflow</b> — tokens withdrawn from exchanges to personal wallets — takes supply off the market. <b>Inflow</b> — tokens deposited — usually
means someone is getting ready to sell. The detail that matters is <i>where</i> on the exchange they land:</p>
<ul><li><b>Deposit address</b> — supply is queued, not yet on sale.</li><li><b>Hot wallet</b> — the exchange swept it in: now it can be sold.</li>
<li><b>Cold wallet</b> — long-term storage, not liquid.</li></ul>
${widget('flow', 'Pick a scenario and step through it.')}
<h2>Router wallets</h2>
<p>A big withdrawal that lands in a wallet and leaves again within hours, back to a near-zero balance, is a <b>pass-through</b>. That wallet
isn’t the holder. Follow the trail to the wallet that keeps the balance — and map all the routes to estimate the whale’s real cost basis.</p>
${callout('info', 'Real example', '<p>On one coin, 15.6M tokens sat in exchange deposit addresses during a squeeze. When they were swept into the hot wallet in nine batches, price fell from $0.80 to $0.54 almost at once.</p>')}`,
    keys: ['Outflow = supply leaving (bullish); inflow = supply arriving (bearish).', 'Deposit address = queued; hot wallet = for sale now.', 'Follow router wallets to the real holder.'],
    quiz: [
      { q: 'A whale’s deposit arrives at an exchange deposit address. Is it for sale yet?', o: ['Yes, immediately', 'Not until it is swept into the hot wallet', 'Never'], a: 1, why: 'Deposits wait in deposit addresses; once swept to the hot wallet they can hit the order book.' },
      { q: 'Wallet A receives a big withdrawal and sends it all onward within hours. Wallet A is…', o: ['The accumulating whale', 'A router — follow the next wallet', 'An exchange hot wallet'], a: 1, why: 'A wallet that empties right away is a pass-through. The holder is further down the trail.' },
    ],
    practice: 'Pick a token, open its explorer’s top-holders list, and find one exchange hot wallet and one cold wallet.' },

  { slug: 'confirmation-chain', track: 'derivs', title: 'The 5-step confirmation chain', mins: 5, tags: ['Interactive'],
    sum: 'One big wallet or one signal is not a thesis. Build the whole chain before you trade.',
    body: `<p>This framework (popular with on-chain traders) refuses to trade on a single clue. Every link must agree:</p>
${widget('chain', 'Tick the links your setup has.')}
<p>The order matters: flows and supply first (is there real buying or selling?), then derivatives (is a crowd trapped?), then the chart
(is there a clean entry with a structural stop?). The chart comes last because it only answers <i>when</i>, not <i>whether</i>.</p>`,
    keys: ['Flow → exchange activity → cost basis → derivatives → structure.', 'The chart answers “when”, the data answers “whether”.', 'Partial chain = smaller size or no trade.'],
    quiz: [], practice: 'Before your next paper trade, write the five links down and mark which ones you actually checked.' },

  { slug: 'reading-coinglass', track: 'derivs', title: 'Reading a derivatives dashboard', mins: 6, tags: ['Reference'],
    sum: 'Futures volume, OI, funding, liquidations, taker volume: what each number means at a glance.',
    body: `${cards([['Futures volume', '24h futures volume', '<p>Huge spikes (+1000%) mean the coin is in play. Compare with spot volume: if futures dwarf spot, the move is leveraged.</p>'],
  ['Open interest', 'Positions open now', '<p>Rising = new money in; falling = positions closing. OI up with flat price = pressure building.</p>'],
  ['Funding', 'Who pays whom', '<p>Normal: −0.01% to +0.01%. Extreme: beyond ±0.05–0.1% — a crowd that can be squeezed.</p>'],
  ['Liquidations', 'Who got wrecked', '<p>Heavy short liquidations = price pumping; heavy long liquidations = price dumping. One-sided means a squeeze.</p>'],
  ['Taker buy/sell', 'Aggressive orders', '<p>Market orders: 52/48 is mild pressure; above 55% one way is strong; near 50/50, no edge.</p>'],
  ['Volume / OI', 'Scalping or conviction?', '<p>High volume on low OI = fast in-and-out trading. Low volume on high OI = positions being held.</p>']])}
<h2>What to check by hand</h2><ul><li>The liquidation heatmap: where are the stop clusters?</li><li>Futures vs spot volume: is the move real or leveraged?</li><li>Taker balance: who is executing aggressively right now?</li></ul>`,
    keys: ['Every number answers one question: who is positioned, and how.', 'Futures/spot ratio separates real moves from leverage.', 'Liquidation maps show where price is drawn.'],
    quiz: [], practice: 'Open a derivatives dashboard for BTC and describe the market in three sentences using these numbers.' },

  { slug: 'when-to-exit', track: 'derivs', title: 'When the reason is gone', mins: 4, tags: ['Quiz'],
    sum: 'Exit when the thing that made you enter stops being true — before the stop does it for you.',
    body: `${cards([['Exit', 'The reason is gone', '<ul><li>OI drops more than ~20% after entry: positions are unwinding, the move is done.</li><li>Funding flips against you mid-trade.</li><li>Exchange flow reverses (big inflow while you are long).</li><li>Structure breaks against you on your entry timeframe.</li></ul>', 'no'],
  ['Hold', 'The reason is intact', '<ul><li>Funding stays on your side.</li><li>OI keeps rising with price: more fuel.</li><li>Flows confirm (outflow for longs, inflow for shorts).</li><li>Price keeps making higher lows (long) or lower highs (short).</li></ul>', 'go']])}
${callout('warn', 'The stop still stays', '<p>These are reasons to leave early, not reasons to move the stop further away. The stop is the plan for when you are wrong and the data didn’t warn you.</p>')}`,
    keys: ['Exit when the entry reason stops being true.', 'Early exits complement the stop; they never replace it.'],
    quiz: [
      { q: 'You are long. OI has fallen 25% since entry while price stalls. What does it suggest?', o: ['More fuel is coming', 'Positions are unwinding — the move may be done', 'Nothing'], a: 1, why: 'Falling OI after entry means positions are closing. The fuel that drove the move is leaving.' },
    ],
    practice: 'On your next three paper trades, write the entry reason in the trade notes and check it again halfway.' },

  // ---------------------------------------------------------------------------------------------------- desk notes (admin)
  { slug: 'pump-short-checklist', track: 'desk', title: 'Manual pump-short checklist', mins: 5, tags: ['Bot'],
    sum: 'The WEAK pump short with the 🎯 sweep, step by step — and why big coins with tight stops are off.',
    body: `${cards([['Tested · pump coins', 'WEAK pump short with the 🎯 sweep', `<ol><li>The bot posts ENTER on a WEAK pump (pump under 40%).</li><li>Mark the 24h high: the top, with liquidity above it.</li>
<li>Wait for a 5m candle to wick above the top and close back below. Allow 2 hours.</li><li>If price closes above and holds for 6 candles, the new high becomes the top. Keep waiting.</li>
<li>Short at the close. If that candle closed more than 10 minutes ago, skip it.</li><li>Stop 8% above entry, never just above the wick. TPs at −5%, −12%, −20%, −30%.</li><li>No sweep in 2 hours: no trade. You will miss some winners.</li></ol>`, 'go'],
  ['Tested · loses after fees', 'Big coins with a tight stop', `<p>BTC, ETH, BNB, DOGE, ADA, AVAX, 15m, Nov 2025 – Nov 2026: short a 15m sweep of a 1H swing high, stop above the sweep, 1–3R target, Bybit fees.</p>
<ol><li>Tight stop (median 0.44%) with 4H + premium filters: <b class="down">−0.19R a trade</b> over 1,045 trades; loses in both halves and on all 6 coins.</li>
<li>Before fees +0.10R. The 0.11% round trip is a quarter of a 0.44% stop: fees cost 0.29R a trade.</li><li>Wider stops (0.6–3%) only reach break-even; the 4H/1H version loses (−0.26R).</li></ol>`, 'no']])}
<p class="muted">Pump coins wick through tight stops: in our tests every stop tighter than 8% lost money on them. No big-coin signals until a version passes this test.</p>`,
    keys: ['Sweep of the 24h top + close back below, within 2 hours.', '8% stop, TPs −5/−12/−20/−30%.', 'Big coins + tight stop: fees eat the edge.'],
    quiz: [], practice: 'Use the 🎯 toggle in /autopump; replay recent WEAK signals on the desk and mark where the sweep came.' },

  { slug: 'bard-12-nov', track: 'desk', title: 'BARD, 12 Nov 2026', mins: 4, tags: ['Replay', 'Bot'],
    sum: 'The WEAK pump short that stopped us for −$62 — and where the sweep rule would have entered instead.',
    body: `<p>Bybit perp, 5-minute candles, 17:00–19:30 UTC. The bot shorted this WEAK pump at ENTER and got stopped for −$62.
Replay it to see where the sweep rule would have shorted instead, and why a tight SMC stop would also have been hit.</p>
${replay('bard')}
<p class="muted">Candles: Bybit BARDUSDT perpetual, 5m, 12 Nov 2026 17:00–19:30 UTC.</p>`,
    keys: ['ENTER below a fresh high with no sweep = late longs still have fuel.', 'The sweep short’s 8% stop survived; a tight stop didn’t.'], quiz: [], practice: '' },

  { slug: 'mubarak-sep-21', track: 'desk', title: 'MUBARAK, 21–22 Sep 2026', mins: 5, tags: ['Replay', 'Bot'],
    sum: 'One exhaustion short caught the real top (+$5.39); the re-detected one shorted into a BOS (−$16.68).',
    body: `<p>A real exhaustion short showing how CHoCH and BOS played out after a pump-and-dump. Trade #767 caught the top. Trade #771 shorted the same
pump two hours later, after the crowd had left, into a confirmed BOS. This case led to the OI &gt; 25% hard floor for exhaustion.</p>
${replay('mubarak', 'Invented candles drawn to the levels in the trade notes — the shape, not the exchange data.')}
${cards([['#767 · won', 'Why it worked', '<ul><li>Real pump top: OI +30.3%, funding 0.179%, price +63.7%.</li><li>All five exhaustion axes confirmed: crowd positioned, pump extreme.</li><li>Shorted at the peak, before any higher lows.</li></ul>', 'go'],
  ['#771 · lost', 'Why it failed', '<ul><li>Stale: the same pump re-detected 2h later with positioning unwound.</li><li>OI only 15.4%, funding only 0.051%.</li><li>Structure bullish: higher lows + CHoCH above 0.057. Shorting a confirmed BOS is countertrend.</li></ul>', 'no']])}
${callout('info', 'Rule', '<p>If price makes higher lows and has broken the last swing high, the structure is bullish. Don’t short it unless the crowd is still positioned (OI &gt; 25%).</p>')}`,
    keys: ['Same pump, different crowd: re-detections need fresh positioning.', 'OI > 25% hard floor (ae9401e).'], quiz: [], practice: '' },

  { slug: 'bot-test-results', track: 'desk', title: 'Sweep rule: live and replay results', mins: 3, tags: ['Evidence', 'Bot'],
    sum: 'The 🎯 sweep entry on WEAK pumps: live, November real trades and both replay periods.',
    body: `${table(['Setup', 'Market and period', 'Result'], [
  ['🎯 Sweep-and-reclaim short, 8% stop, WEAK pumps', 'Live auto shorts since 10 Oct', R('−$78 → +$90', 'pos')],
  ['Same', 'November real trades (BARD, INIT, EDGE, CAP, FLUID …)', R('−$173.51 → +$116.70', 'pos')],
  ['Same', 'Replay Jun–Oct / Dec–May (fewer trades, better entries)', R('+$596 → +$453 / +$353 → +$218', 'mix')],
  ['Same, stop just above the sweep wick', 'Pump coin replay', R('+$93 / −$36', 'mix')],
  ['Sweep entry on STRONG / PERFECT or switch shorts', 'Pump coin replay', R('worse in both periods', 'neg')]])}
<p class="muted">The gain comes from a better entry price, not more trades. About 2 of every 3 WEAK winners never sweep the top (148 of 224 in Jun–Oct, 222 of 309 in Dec–May), so the rule skips them; it also skips about 4 in 10 losers. On the trades it takes: −$91 → +$453 (Jun–Oct), −$584 → +$218 (Dec–May).</p>`,
    keys: ['Better entries, fewer trades.', 'Live and November results improved; replay total is lower.'], quiz: [], practice: '' },

  { slug: 'early-signal-notes', track: 'desk', title: 'Early signal notes (Sep 2026)', mins: 3, tags: ['Bot'],
    sum: 'What the first months of on-chain signals seemed to show. Small samples — kept for the record, not as rules.',
    body: `${callout('warn', 'Read with care', '<p>These came from the first few hundred signals in Sep 2026. Several were not confirmed by later out-of-sample tests (see the research notes). They are here as history.</p>')}
<ul><li>Best setup then: score 80+ short alerts during 12–18 UTC with funding aligned (87.5% on a small sample).</li>
<li>Score 70+ shorts: +$23,408 simulated in 1–4h exits (6 trades, $2K × 20×); score 70+ longs: −$4,604 in 1–4h but +$15,890 in 4–12h.</li>
<li>Hold time: 0–15 min holds 29% win rate; 45–90 min 83%; manual closes after ~20 min averaged +$14.</li>
<li>What hurt: 20× leverage (max-loss hits, −$27 average), funding against the direction (~30%), longs at 00–06 UTC (40%).</li></ul>`,
    keys: ['Small samples; superseded by later research.'], quiz: [], practice: '' },
];

const BY = Object.fromEntries(LESSONS.map(l => [l.slug, l]));
const visible = who => LESSONS.filter(l => !TRACKS.find(t => t.key === l.track).admin || (who && who.admin));
const trackOf = k => TRACKS.find(t => t.key === k);
const tagIcon = { Replay: 'rotate-ccw', Interactive: 'mouse-pointer-click', Quiz: 'circle-check', Drills: 'crosshair', Evidence: 'chart-column', Reference: 'book-open', Bot: 'shield', Simulator: 'target' };
const tagHtml = tags => tags.map(t => `<span class="ltag">${icon(tagIcon[t] || 'circle', 'i-3')}${t}</span>`).join('');
const head = `<link rel="stylesheet" href="${asset('learn.css')}">`;
const script = `<script src="${asset('learn.js')}" defer></script>`;
const cpScript = `<script src="${asset('cpat.js')}" defer></script>`;   // the pattern engine, before learn.js, on candle-pattern lessons

function learnIndex(who, nonce) {
  const list = visible(who), tracks = TRACKS.filter(t => !t.admin || (who && who.admin));
  const nInteractive = list.filter(l => l.tags.some(t => t === 'Interactive' || t === 'Replay' || t === 'Drills' || t === 'Simulator')).length;
  const order = list.map(l => l.slug).join(',');
  let n = 0;
  const body = `${navbar(who)}
<main class="lx-main"><div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i></div><div class="dots-bg" aria-hidden="true"></div>
<section class="lx-hero wrap">
  <p class="announce">${icon('graduation-cap', 'i-35')} ReplayDesk Academy · free</p>
  <h1 class="display">Learn to read the chart.<br><span class="text-brand">Then prove it on replay.</span></h1>
  <p class="lx-intro">${list.length} short lessons on candles, candlestick patterns, structure, smart money concepts and the derivatives data behind every move. Watch each setup form candle by candle, play with the numbers, answer a quick check — then practise it on real charts.</p>
  <div class="lx-cta">${btn('/learn/' + list[0].slug, `${icon('play')} <span>Start the course</span>`, 'btn-primary btn-lg btn-pill glow-btn').replace('<a ', `<a data-continue="${order}" `)}${btn(who ? '/app' : '/signup', `${icon('chart-candlestick')} ${who ? 'Open the desk' : 'Practise free'}`, 'btn-glass btn-lg btn-pill')}</div>
  <dl class="lx-stats"><div><dt>Lessons</dt><dd data-all-prog="${order}">${list.length} lessons</dd></div><div><dt>Interactive</dt><dd>${nInteractive} with replays or tools</dd></div><div><dt>Practice</dt><dd>8 drills · pattern trainer</dd></div><div><dt>Price</dt><dd>Free</dd></div></dl>
</section>
${tracks.map((t, ti) => { const ls = list.filter(l => l.track === t.key); return `
<section class="lx-track wrap" id="${t.key}">
  <header class="lx-thead"><span class="lx-ti">${icon(t.icon, 'i-5')}</span><div><p class="eyebrow">Track ${ti + 1}${t.admin ? ' · admin only' : ''}</p><h2>${t.title}</h2><p class="t2">${t.blurb}</p></div>
    <div class="lx-tprog"><div class="lx-bar" data-track-prog="${ls.map(l => l.slug).join(',')}"><i></i></div><span class="muted mono" data-n>${ls.length} lessons</span></div></header>
  <div class="lx-cards">${ls.map(l => `<a class="lcard spot" href="/learn/${l.slug}" data-slug="${l.slug}"><span class="lnum mono">${String(++n).padStart(2, '0')}</span>
    <span class="lcheck" aria-hidden="true">${icon('check', 'i-35')}</span><b>${esc(l.title)}</b><p>${esc(l.sum)}</p><span class="lmeta">${l.mins} min${tagHtml(l.tags)}</span></a>`).join('')}</div>
</section>`; }).join('')}
<section class="wrap lx-foot"><p class="muted">Education only — not financial advice. Lesson charts use invented candles unless they say otherwise. Progress is saved in this browser.</p></section>
</main>${footer()}`;
  return page({ title: 'Academy', description: 'Free interactive lessons: candles, market structure, smart money concepts, open interest, funding and on-chain flows — practised on replay.', body, nonce, head, scripts: [script], bodyClass: 'lx-body' });
}

function learnLesson(who, nonce, slug) {
  const l = BY[slug];
  if (!l) return null;
  const t = trackOf(l.track);
  if (t.admin && !(who && who.admin)) return null;
  const list = visible(who), i = list.indexOf(l), prev = list[i - 1], next = list[i + 1];
  const inTrack = list.filter(x => x.track === l.track), num = i + 1;
  const quiz = l.quiz && l.quiz.length ? `<section class="lx-quiz"><h2>${icon('circle-check', 'i-5')} Quick check</h2><div data-quiz><script type="application/json">${JSON.stringify(l.quiz).replace(/</g, '\\u003c')}</script></div></section>` : '';
  const practice = l.practice ? `<section class="lx-practice spot"><div><p class="eyebrow">Practise it</p><p>${esc(l.practice)}</p></div>${btn(who ? '/app' : '/signup', `${icon('play')} ${who ? 'Open the desk' : 'Try it free'}`, 'btn-primary btn-pill')}</section>` : '';
  const side = `<nav class="lx-side" aria-label="${esc(t.title)} lessons"><a class="lx-back" href="/learn#${t.key}">${icon('arrow-left', 'i-35')} Academy</a>
<p class="eyebrow">${esc(t.title)}</p><ol>${inTrack.map(x => `<li><a href="/learn/${x.slug}" data-slug="${x.slug}"${x === l ? ' aria-current="page"' : ''}><span class="dot">${icon('check', 'i-3')}</span>${esc(x.title)}</a></li>`).join('')}</ol></nav>`;
  const body = `${navbar(who)}
<main class="lx-main lx-page"><div class="bg-grid" aria-hidden="true"></div>
<div class="wrap lx-layout">
  <details class="lx-mnav"><summary>${icon('book-open', 'i-4')} ${esc(t.title)} · lesson ${inTrack.indexOf(l) + 1} of ${inTrack.length}</summary>${side}</details>
  <aside class="lx-aside">${side}</aside>
  <article class="lx-article">
    <p class="eyebrow">${esc(t.title)} · Lesson ${num}${t.admin ? ' · admin only' : ''}</p>
    <h1>${esc(l.title)}</h1>
    <p class="lx-sum">${esc(l.sum)}</p>
    <div class="lx-meta"><span>${icon('clock', 'i-35')} ${l.mins} min</span>${tagHtml(l.tags)}</div>
    <div class="lx-prose">${l.body}</div>
    ${l.keys && l.keys.length ? `<section class="lx-keys"><h2>${icon('sparkles', 'i-5')} Key points</h2><ul>${l.keys.map(k => `<li>${esc(k)}</li>`).join('')}</ul></section>` : ''}
    ${quiz}
    <div class="lx-done"><button type="button" class="btn btn-secondary" data-mark>${icon('check', 'i-4')} <span>Mark as complete</span></button></div>
    ${practice}
    <nav class="lx-pn" aria-label="Lessons">${prev ? `<a href="/learn/${prev.slug}" class="lx-pn-p"><span>${icon('arrow-left', 'i-35')} Previous</span><b>${esc(prev.title)}</b></a>` : '<span></span>'}
      ${next ? `<a href="/learn/${next.slug}" class="lx-pn-n"><span>Next ${icon('arrow-right', 'i-35')}</span><b>${esc(next.title)}</b></a>` : `<a href="/learn" class="lx-pn-n"><span>Done ${icon('arrow-right', 'i-35')}</span><b>Back to the Academy</b></a>`}</nav>
    <p class="lx-legal muted">Education only — not financial advice.</p>
  </article>
</div></main>${footer()}`;
  return page({ title: l.title, description: l.sum, body, nonce, head, scripts: l.track === 'candles' ? [cpScript, script] : [script], bodyClass: 'lx-body', bodyData: { 'lx-slug': l.slug }, noindex: !!t.admin });
}

const canSee = (who, slug) => { const l = BY[slug]; return !!l && (!trackOf(l.track).admin || !!(who && who.admin)); };

module.exports = { learnIndex, learnLesson, canSee, LESSONS, TRACKS };
