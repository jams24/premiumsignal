import React from 'react';
import { AbsoluteFill, Html5Audio, Sequence, Series, staticFile, useCurrentFrame } from 'remotion';
import { TIMELINE } from './timing.js';
import { SCENE_COMPONENTS } from './scenes.jsx';
import { C, Captions, fade } from './kit.jsx';

const Shell = ({ scene }) => {
  const f = useCurrentFrame(), Comp = SCENE_COMPONENTS[scene.id];
  const k = fade(f, 0, 10) * (1 - fade(f, scene.frames - 10, scene.frames));
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: k }}><Comp scene={scene} /></AbsoluteFill>
      {scene.lines.map((l) => (
        <Sequence key={l.key} from={l.from} durationInFrames={l.dur + 6}>
          <Html5Audio src={staticFile(`voice/${l.key}.wav`)} />
        </Sequence>
      ))}
      <Captions scene={scene} />
    </AbsoluteFill>
  );
};

export const Video = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Series>
      {TIMELINE.map((s) => (
        <Series.Sequence key={s.id} durationInFrames={s.frames}><Shell scene={s} /></Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
