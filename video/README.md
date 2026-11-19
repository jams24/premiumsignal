# Walk me through — the video

A ~9-minute Remotion video that teaches the desk's 🎓 **Walk me through** steps (swings → break → premium/discount →
zone → sweep → 1m trigger → plan) for a beginner, on real charts read by the same SMC engine as the desk
(`../src/web/smcEngine.js`):

- **Short:** Binance ETHUSDT 5m/1m candles from 17 Nov 2026, all 7 steps one by one (`src/scenes.jsx`).
- **Long:** the same steps flipped on Binance BTCUSDT from the night of 10–11 Nov 2026: stairs down, close above the
  ceiling, discount, demand zone, wick under the old valley, 1m close above the last little peak, target = top of the
  move (`src/scenes_long.jsx`).

Candles print as the clock moves, like a replay, and every label appears when the engine would have confirmed it.
Narration is the Mac's built-in voice (no network).

Separate from the bot: own `package.json`, nothing here is deployed.

```bash
cd video
npm install
npm run voice     # narration WAVs → public/voice/, lengths → src/data/voice.json (macOS `say`)
npm run studio    # preview and scrub in the browser
npm run render    # → out/walk-me-through.mp4
```

- **Change the words:** `src/script.js` (caption `text`, spoken `say`, `cue` = when a scene animates), then `npm run voice`.
- **Another example:** `npm run pick` scans recent coins for a complete A+ setup that hit its target and saves it to
  `src/data/example.json` (`PICK=ETHUSDT@<ms>`, or `node scripts/pick.cjs SOLUSDT 3`). For the long:
  `SIDE=long OUT=example_long.json node scripts/pick.cjs all 10`. The scenes use each example's times (`T('06:15')`
  in `src/scenes.jsx`, `P('01:25')` in `src/scenes_long.jsx`), so a new example needs those times updated too.
- **Check frames:** `node scripts/frames.js` lists each scene's cue frames; `node scripts/stills.js 1700 6300` renders
  stills to `out/`.
- Voice: `VOICE=Samantha RATE=158` by default.

The last scene says we picked two winners to show the steps, and states the tested result: on the bot's 207 coins
(14 Oct – 13 Nov 2026) these exact rules lost a little after fees, about the same as a random entry. Keep that in any edit.
