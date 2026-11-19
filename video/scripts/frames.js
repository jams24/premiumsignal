// Prints each scene's start frame and the frame of every cue (same rules as src/timing.js), for checking stills.
import fs from 'node:fs';
import { SCENES } from '../src/script.js';
const VOICE = JSON.parse(fs.readFileSync(new URL('../src/data/voice.json', import.meta.url)));
const src = fs.readFileSync(new URL('../src/timing.js', import.meta.url), 'utf8');
const HOLD = eval('(' + src.match(/const HOLD = (\{[^}]*\})/)[1] + ')');
const FPS = 30, HEAD = 0.6, GAP = 0.45, TAIL = 1.1;
let base = 0;
for (const s of SCENES) {
  let t = HEAD; const cues = [];
  s.lines.forEach((l, i) => { const d = VOICE[`${s.id}_${i}`]; cues.push(`${l.cue || i}@${base + Math.round(t * FPS)}`); t += d + GAP + (l.cue ? HOLD[`${s.id}.${l.cue}`] || 0 : 0); });
  const frames = Math.round((t - GAP + TAIL) * FPS);
  console.log(`${s.id.padEnd(8)} start ${base} len ${frames} | ${cues.join(' ')}`);
  base += frames;
}
console.log('total', base, 'frames =', (base / FPS).toFixed(1), 's');
