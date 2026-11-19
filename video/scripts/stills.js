// Renders still frames for checking: node scripts/stills.js 1700 2150 ...  → out/s_<frame>.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src/index.jsx') });
const composition = await selectComposition({ serveUrl, id: 'WalkMeThrough' });
for (const f of process.argv.slice(2).map(Number)) {
  await renderStill({ serveUrl, composition, frame: f, output: path.join(ROOT, `out/s_${f}.png`) });
  console.log('still', f);
}
