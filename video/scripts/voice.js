// Turns every narration line in src/script.js into a WAV with the Mac's built-in voice (say + afconvert, no network)
// and writes the lengths to src/data/voice.json. Re-run after changing the script: npm run voice
// VOICE=Samantha RATE=158 by default.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES } from '../src/script.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/voice');
const VOICE = process.env.VOICE || 'Samantha', RATE = String(process.env.RATE || 158);
fs.mkdirSync(OUT, { recursive: true });
const lens = {};
for (const s of SCENES) {
  s.lines.forEach((l, i) => {
    const key = `${s.id}_${i}`, aiff = path.join(OUT, key + '.aiff'), wav = path.join(OUT, key + '.wav');
    execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', aiff, l.say || l.text]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', aiff, wav]);
    fs.unlinkSync(aiff);
    const info = execFileSync('afinfo', [wav]).toString();
    const sec = Number((info.match(/estimated duration: ([\d.]+)/) || [])[1]);
    if (!(sec > 0)) throw new Error('no duration for ' + key);
    lens[key] = +sec.toFixed(3);
  });
}
fs.writeFileSync(path.join(ROOT, 'src/data/voice.json'), JSON.stringify(lens, null, 1));
const total = Object.values(lens).reduce((a, b) => a + b, 0);
console.log(`${Object.keys(lens).length} lines · ${total.toFixed(1)} s of speech · voice ${VOICE} at ${RATE} wpm`);
