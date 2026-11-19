import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Video } from './Video.jsx';
import { FPS, TOTAL } from './timing.js';

const Root = () => (
  <Composition id="WalkMeThrough" component={Video} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
);
registerRoot(Root);
