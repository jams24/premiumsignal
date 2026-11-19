# Walk me through — the video

A ~6-minute Remotion video that teaches the desk's 🎓 **Walk me through** steps (swings → break → premium/discount →
zone → sweep → 1m trigger → plan) for a beginner, on a real chart: Binance ETHUSDT 5m/1m candles from 17 Nov 2026,
read by the same SMC engine as the desk (`../src/web/smcEngine.js`). Candles print as the clock moves, like a replay,
and every label appears when the engine would have confirmed it. Narration is the Mac's built-in voice (no network).

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
  `src/data/example.json` (`SIDE=long`, `PICK=ETHUSDT@<ms>`, or `node scripts/pick.cjs SOLUSDT 3`). The scenes use
  this example's times (`T('06:15')` etc. in `src/scenes.jsx`), so a new example needs those times updated too.
- **Check frames:** `node scripts/frames.js` lists each scene's cue frames; `node scripts/stills.js 1700 6300` renders
  stills to `out/`.
- Voice: `VOICE=Samantha RATE=158` by default.

The last scene states the tested result: on the bot's 207 coins (14 Oct – 13 Nov 2026) these exact rules lost a
little after fees, about the same as a random entry. Keep that in any edit.
