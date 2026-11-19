// Scene and line timing from the voice lengths (src/data/voice.json). Every line starts after the previous one plus a
// short gap (plus its own `hold`, for lines the chart needs time after), so captions, voice and animation stay in sync.
import { SCENES } from './script.js';
import VOICE from './data/voice.json';

export const FPS = 30;
const HEAD = 0.6, GAP = 0.45, TAIL = 1.1;
// seconds the chart keeps moving after a line ends, before the next line starts
const HOLD = { 'break.go': 1.2, 'premium.leg': 0.8, 'premium.wait': 1.6, 'zone.back': 1.0, 'sweep.go': 1.4, 'trigger.wait': 3.0, 'plan.play': 4.0, 'plan.hit': 1.0, 'desk.ticks': 1.2, 'intro.steps': 1.5, 'rules.bye': 2.0,
  'long.next': 0.6, 'l12.stairs': 0.6, 'l12.go': 1.2, 'l34.leg': 0.8, 'l34.tick': 0.4, 'l34.back': 1.0, 'l56.go': 1.4, 'l56.wait': 0.8, 'l56.entry': 1.0, 'l7.play': 5.0, 'l7.hit': 1.0 };

export const TIMELINE = SCENES.map((s) => {
  let t = HEAD;
  const lines = s.lines.map((l, i) => {
    const d = VOICE[`${s.id}_${i}`] ?? 3;
    const L = { ...l, key: `${s.id}_${i}`, from: Math.round(t * FPS), dur: Math.ceil(d * FPS) };
    t += d + GAP + (l.cue ? HOLD[`${s.id}.${l.cue}`] || 0 : 0);
    L.next = Math.round(t * FPS);
    return L;
  });
  return { ...s, lines, frames: Math.round((t - GAP + TAIL) * FPS) };
});
export const TOTAL = TIMELINE.reduce((a, s) => a + s.frames, 0);

// frame (inside the scene) where the line with this cue starts / ends / where the next line starts
export const at = (scene, cue) => { const l = scene.lines.find((x) => x.cue === cue); if (!l) throw new Error(`no cue ${scene.id}.${cue}`); return l.from; };
export const endOf = (scene, cue) => { const l = scene.lines.find((x) => x.cue === cue); return l.from + l.dur; };
export const nextOf = (scene, cue) => scene.lines.find((x) => x.cue === cue).next;
