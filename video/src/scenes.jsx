// One component per scene. Every chart is the real ETHUSDT data, printed up to `upto` like a live chart / replay.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { EX, MIN, TF5, T, fit, fp, hm, S, candlesAt, checklist } from './data.js';
import { at, nextOf } from './timing.js';
import { C, SANS, MONO, Chart, Tag, HLine, Box, Glow, Ring, Arrow, SwingLabels, DeskStrip, Card, pop, fade, track } from './kit.jsx';

const line = (scene, i) => scene.lines[i].from;
// frame at which a piecewise-linear `upto` track reaches time v (for labels that appear when confirmed)
const when = (pts, v) => {
  if (v <= pts[0][1]) return -999;
  for (let i = 1; i < pts.length; i++) {
    const [f0, v0] = pts[i - 1], [f1, v1] = pts[i];
    if (v1 > v0 && v >= v0 && v <= v1) return f0 + ((v - v0) / (v1 - v0)) * (f1 - f0);
  }
  return Infinity;
};
const appearMap = (pts) => Object.fromEntries(S.swings.map((s) => [s.t, when(pts, s.conf)]));
const view = (a, b, pad = 0.14, until) => ({ t0: T(a), t1: T(b), ...fit(T(a), until ? T(until) : T(b), pad) });

const VA = view('03:30', '07:15');
const VB = view('04:40', '08:25');
const VC = view('05:10', '08:40');
const V1 = view('07:22', '08:42', 0.12);
const VP = view('06:30', '10:40', 0.1, '10:08');

const Source = () => (
  <div style={{ position: 'absolute', right: 40, top: 30, fontFamily: SANS, fontSize: 19, color: C.mute, textAlign: 'right' }}>
    Real Binance {EX.pair} candles · {new Date(EX.setup.t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })} · UTC
  </div>
);

// ================================================================== intro
export const Intro = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const all = { t0: T('03:30'), t1: T('10:55'), ...fit(T('03:30'), T('10:55'), 0.08) };
  const upto = track(f, [[0, T('03:35')], [scene.frames, T('10:50')]]);
  const k0 = pop(f, fps, 4), kc = pop(f, fps, at(scene, 'coin')), ks = at(scene, 'steps');
  const steps = ['Read the swings', 'Spot the break', 'Premium or discount?', 'Mark the zone', 'Liquidity + sweep', 'The 1m trigger', 'Plan the trade'];
  return (
    <AbsoluteFill>
      <Chart id="intro" x={30} y={60} w={1860} h={820} tf={TF5} upto={upto} view={all} opacity={0.2} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontFamily: SANS, opacity: k0, transform: `translateY(${(1 - k0) * 30}px)` }}>
        <div style={{ display: 'inline-block', fontSize: 34, padding: '10px 26px', borderRadius: 999, background: C.blueSoft, color: C.blue, fontWeight: 700 }}>🎓 Walk me through</div>
        <div style={{ fontSize: 104, fontWeight: 900, color: C.ink, marginTop: 26, letterSpacing: -2 }}>How to find an A+ trade</div>
        <div style={{ fontSize: 44, color: C.soft, marginTop: 8 }}>one small step at a time, on a real chart</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 500, textAlign: 'center', opacity: kc, transform: `scale(${0.8 + 0.2 * kc})` }}>
        <span style={{ fontFamily: MONO, fontSize: 36, padding: '12px 28px', borderRadius: 16, border: `3px solid ${C.ink}`, background: '#fff', fontWeight: 700 }}>
          Ethereum · {EX.pair} · {new Date(EX.setup.t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 610, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 18 }}>
        {steps.map((s, i) => {
          const k = pop(f, fps, ks + i * 7);
          return (
            <div key={i} style={{ fontFamily: SANS, fontSize: 32, fontWeight: 700, padding: '14px 24px', borderRadius: 18, background: '#fff', border: `3px solid ${C.blue}`,
              color: C.ink, opacity: Math.min(1, k), transform: `translateY(${(1 - k) * 40}px)` }}>
              <span style={{ color: C.blue, marginRight: 10 }}>{i + 1}</span>{s}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ================================================================== what is a candle
const BigCandle = ({ x, up, k, hl }) => {
  const top = 70, bot = 520, oY = up ? 400 : 180, cY = up ? 180 : 400, w = 120;
  const lab = (y, t, key) => (
    <g key={t}>
      <line x1={x + w / 2 + 12} x2={x + w / 2 + 50} y1={y} y2={y} stroke={hl[key] ? C.amber : C.mute} strokeWidth={3} />
      <text x={x + w / 2 + 60} y={y + 11} fontFamily={SANS} fontSize={hl[key] ? 32 : 28} fontWeight={hl[key] ? 900 : 600} fill={hl[key] ? '#b45309' : C.soft}>{t}</text>
    </g>
  );
  return (
    <g opacity={Math.min(1, k)} transform={`translate(0 ${(1 - k) * 40})`}>
      <line x1={x} x2={x} y1={top} y2={bot} stroke={hl.wick ? C.amber : C.ink} strokeWidth={hl.wick ? 9 : 6} />
      <rect x={x - w / 2} y={Math.min(oY, cY)} width={w} height={Math.abs(oY - cY)} fill={up ? '#fff' : C.ink} stroke={hl.close ? C.amber : C.ink} strokeWidth={hl.close ? 9 : 6} rx={4} />
      {hl.close && <line x1={x - w / 2 - 14} x2={x + w / 2 + 14} y1={cY} y2={cY} stroke={C.amber} strokeWidth={10} strokeLinecap="round" />}
      {lab(top, 'high', 'wick')}{lab(cY, 'close', 'close')}{lab(oY, 'open', 'open')}{lab(bot, 'low', 'wick')}
      <text x={x} y={bot + 60} textAnchor="middle" fontFamily={SANS} fontSize={34} fontWeight={900} fill={up ? C.up : C.down}>{up ? 'UP ⬆' : 'DOWN ⬇'}</text>
    </g>
  );
};
export const Candles = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const upto = track(f, [[0, T('04:30')], [scene.frames, T('05:25')]]);
  const ku = pop(f, fps, at(scene, 'up')), kd = pop(f, fps, at(scene, 'down')), kw = pop(f, fps, at(scene, 'wick')), kc = pop(f, fps, at(scene, 'close'));
  const ks = candlesAt(TF5, upto).filter((k) => k.t >= VA.t0);
  const big = (pred) => ks.filter(pred).sort((a, b) => Math.abs(b.c - b.o) - Math.abs(a.c - a.o))[0];
  const bu = big((k) => k.c > k.o), bd = big((k) => k.c < k.o);
  const bw = ks.slice().sort((a, b) => (b.h - Math.max(b.o, b.c) + Math.min(b.o, b.c) - b.l) - (a.h - Math.max(a.o, a.c) + Math.min(a.o, a.c) - a.l))[0];
  const step = f >= at(scene, 'close') ? 'close' : f >= at(scene, 'wick') ? 'wick' : '';
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} showIdea={false} />
      <Source />
      <Chart id="cd" tf={TF5} upto={upto} view={VA} w={1180} overlay={(g) => (<>
        {bu && <Ring x={g.cx(bu.t)} y={g.Y((bu.o + bu.c) / 2)} r={34} color={C.up} k={ku * (1 - kd)} />}
        {bd && <Ring x={g.cx(bd.t)} y={g.Y((bd.o + bd.c) / 2)} r={34} color={C.down} k={kd * (1 - kw)} />}
        {bw && <Ring x={g.cx(bw.t)} y={g.Y(bw.h)} r={26} color={C.amber} k={kw} />}
      </>)} />
      <div style={{ position: 'absolute', left: 1240, top: 122, width: 650, height: 762, borderRadius: 22, border: `2.5px solid ${C.line}`, background: '#fafafa' }}>
        <div style={{ fontFamily: SANS, fontSize: 36, fontWeight: 900, color: C.ink, padding: '24px 30px 0' }}>What is a candle? 🕯️</div>
        <div style={{ fontFamily: SANS, fontSize: 26, color: C.soft, padding: '6px 30px 0' }}>one bar = 5 minutes of price</div>
        <svg width={650} height={640} style={{ position: 'absolute', top: 120, left: 0 }}>
          <BigCandle x={120} up k={ku} hl={{ wick: step === 'wick', close: step === 'close' }} />
          <BigCandle x={445} up={false} k={kd} hl={{ wick: step === 'wick', close: step === 'close' }} />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

// ================================================================== step 1: swings
export const Swings = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('03:50')], [at(scene, 'hike'), T('03:50')], [at(scene, 'names'), T('05:16')], [at(scene, 'confirm') + 30, T('05:46')]];
  const upto = track(f, pts), ap = appearMap(pts);
  const kHike = pop(f, fps, at(scene, 'hike')), kNames = pop(f, fps, at(scene, 'names')), kConf = pop(f, fps, at(scene, 'confirm'));
  const kLab = pop(f, fps, at(scene, 'labels')), kStairs = pop(f, fps, at(scene, 'stairs'), 18), kDown = pop(f, fps, line(scene, 6));
  const vis = S.swings.filter((s) => upto >= s.conf && s.t >= VA.t0);
  const pk = S.swings.find((s) => s.t === T('04:55')), vl = S.swings.find((s) => s.t === T('04:30')), top = S.swings.find((s) => s.t === T('05:20'));
  const stair = [T('04:30'), T('04:55'), T('05:10'), T('05:20')].map((t) => S.swings.find((s) => s.t === t));
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} />
      <Source />
      <Chart id="sw" tf={TF5} upto={upto} view={VA} overlay={(g) => (<>
        {kConf > 0 && top && [-3, -2, -1, 1, 2, 3].map((d) => <rect key={d} x={g.X(top.t + d * TF5)} y={0} width={g.slot} height={g.H} fill={C.blue} opacity={0.08 * Math.min(1, kConf) * (1 - kStairs)} />)}
        {kHike > 0 && vis.length > 1 && <polyline points={vis.map((s) => `${g.cx(s.t)},${g.Y(s.p)}`).join(' ')} fill="none" stroke={C.amber} strokeWidth={4} strokeDasharray="10 8" opacity={0.85 * Math.min(1, kHike) * (1 - 0.7 * kStairs)} />}
        <SwingLabels g={g} frame={f} fps={fps} appearAt={ap} />
        {pk && upto >= pk.conf && <Tag x={g.cx(pk.t)} y={g.Y(pk.p) - 70} text="⛰️ swing HIGH = peak" color={C.up} k={kNames * (1 - kConf)} size={22} />}
        {vl && upto >= vl.conf && <Tag x={g.cx(vl.t)} y={g.Y(vl.p) + 82} text="🏞️ swing LOW = valley" color={C.down} k={kNames * (1 - kConf)} size={22} />}
        {top && <Tag x={g.cx(top.t)} y={g.Y(top.p) - 66} text="3 lower candles each side" color={C.blue} k={kConf * (1 - kStairs)} size={22} />}
        {top && upto >= top.conf && <Tag x={g.X(top.conf) + 30} y={g.Y(top.p) + 10} anchor="start" text={`⏱️ known at ${hm(top.conf)} (15 min later)`} color={C.blue} k={pop(f, fps, when(pts, top.conf)) * (1 - kStairs)} size={22} />}
        {kStairs > 0 && stair.every(Boolean) && <polyline points={stair.map((s) => `${g.cx(s.t)},${g.Y(s.p)}`).join(' ')} fill="none" stroke={C.up} strokeWidth={7} strokeLinejoin="round" opacity={Math.min(1, kStairs)} />}
        {kStairs > 0 && <Arrow x1={g.cx(stair[2].t)} y1={g.Y(stair[2].p)} x2={g.cx(stair[3].t) + 30} y2={g.Y(stair[3].p) - 40} color={C.up} k={kStairs} width={7} />}
        <Tag x={20} y={g.H - 60} anchor="start" text="📈 HH + HL = stairs UP = uptrend" color={C.up} k={kStairs} size={26} />
        <Tag x={g.W - 20} y={g.H - 60} anchor="end" text="📉 LH + LL = stairs DOWN = downtrend" color={C.down} k={kDown} size={24} />
        <Tag x={g.cx(T('05:55'))} y={70} text="HH higher high · HL higher low" color={C.ink} k={kLab * (1 - kStairs)} size={22} mono />
      </>)} />
      <Card step={0} items={[
        { at: at(scene, 'hike'), icon: '⛰️', text: 'Price moves like a hiker: peaks and valleys' },
        { at: at(scene, 'names'), icon: '🔺', text: 'Peak = swing HIGH · valley = swing LOW' },
        { at: at(scene, 'confirm'), icon: '⏱️', text: '3 lower candles on each side → known 15 min later' },
        { at: at(scene, 'labels'), icon: '🟢', text: 'HH = higher high · HL = higher low' },
        { at: at(scene, 'stairs'), icon: '📈', text: 'HH + HL = stairs up = UPTREND' },
        { at: line(scene, 6), icon: '📉', text: 'LH + LL = stairs down = downtrend' },
      ]} />
    </AbsoluteFill>
  );
};

// ================================================================== step 2: the break
const WickVsClose = ({ k }) => (
  <svg width={480} height={150} style={{ opacity: Math.min(1, k), marginTop: 2 }}>
    <line x1={10} x2={470} y1={70} y2={70} stroke={C.down} strokeWidth={3} strokeDasharray="8 6" />
    {/* close below = break */}
    <line x1={70} x2={70} y1={22} y2={118} stroke={C.ink} strokeWidth={4} /><rect x={50} y={36} width={40} height={66} fill={C.ink} rx={3} />
    <text x={115} y={60} fontFamily={SANS} fontSize={24} fontWeight={800} fill={C.up}>✅ BREAK</text>
    <text x={115} y={90} fontFamily={SANS} fontSize={20} fill={C.soft}>closed below</text>
    {/* wick below, close back above = sweep */}
    <line x1={300} x2={300} y1={20} y2={122} stroke={C.ink} strokeWidth={4} /><rect x={280} y={30} width={40} height={28} fill="#fff" stroke={C.ink} strokeWidth={4} rx={3} />
    <text x={340} y={60} fontFamily={SANS} fontSize={24} fontWeight={800} fill={C.down}>❌ SWEEP</text>
    <text x={340} y={90} fontFamily={SANS} fontSize={20} fill={C.soft}>wick only,</text>
    <text x={340} y={114} fontFamily={SANS} fontSize={20} fill={C.soft}>closed back</text>
  </svg>
);
export const Break = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('05:46')], [at(scene, 'go'), T('05:46')], [nextOf(scene, 'go') - 12, T('06:20')]];
  const upto = track(f, pts);
  const kF = pop(f, fps, at(scene, 'floor'), 20), kC = pop(f, fps, at(scene, 'choch')), kB = pop(f, fps, at(scene, 'bias')), kW = pop(f, fps, at(scene, 'wickclose'));
  const broke = upto >= S.brk.conf;
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} pulse={kC * (1 - fade(f, at(scene, 'choch') + 20, at(scene, 'choch') + 40))} />
      <Source />
      <Chart id="br" tf={TF5} upto={upto} view={VA} overlay={(g) => (<>
        <Glow g={g} t={S.brk.t} k={kC} color={C.down} />
        <HLine g={g} p={S.brk.p} from={S.brk.fromT} k={kF} color={broke ? C.down : C.ink} dash={broke && kC > 0.5 ? undefined : '10 8'} width={broke && kC > 0.5 ? 4 : 3}
          label={`🧱 floor = last swing low ${fp(S.brk.p)}`} labelAt="right" />
        <SwingLabels g={g} frame={f} fps={fps} dim={0.55} />
        <Tag x={g.cx(S.brk.t)} y={g.Y(S.brk.close) + 92} text={`CHoCH ↓  close ${fp(S.brk.close)}`} color={C.down} k={kC} size={24} />
        <Tag x={170} y={60} text="Bias: SHORTS 🔻" color="#fff" bg={C.down} border={C.down} k={kB} size={30} anchor="start" />
      </>)} />
      <Card step={1} items={[
        { at: at(scene, 'floor'), icon: '🧱', text: 'Last valley = the floor' },
        { at: at(scene, 'go'), icon: '👀', text: 'Watch for a candle CLOSE below it' },
        { at: at(scene, 'choch'), icon: '🔨', text: 'Close below = CHoCH: the trend changed its mind' },
        { at: at(scene, 'bias'), icon: '🔻', text: 'Now look for SHORTS only' },
        { at: at(scene, 'wickclose'), icon: '⚠️', text: 'Only a CLOSE counts' },
      ]} footer={kW > 0 ? <WickVsClose k={kW} /> : null} />
    </AbsoluteFill>
  );
};

// ================================================================== step 3: premium / discount
const Meter = ({ at: pos, k }) => (
  <div style={{ opacity: Math.min(1, k), marginTop: 6 }}>
    <div style={{ position: 'relative', height: 30, borderRadius: 15, overflow: 'hidden', display: 'flex' }}>
      <div style={{ flex: 1, background: '#dcfce7' }} /><div style={{ flex: 1, background: '#fee2e2' }} />
      <div style={{ position: 'absolute', left: `calc(${Math.round(pos * 100)}% - 7px)`, top: 0, width: 14, height: 30, background: C.ink, borderRadius: 7 }} />
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: SANS, fontSize: 22, marginTop: 6 }}>
      <b style={{ color: C.up }}>discount 🏷️</b><span style={{ color: C.soft }}>{Math.round(pos * 100)}% up the move</span><b style={{ color: C.down }}>💎 premium</b>
    </div>
  </div>
);
export const Premium = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('06:21')], [at(scene, 'leg'), T('06:21')], [nextOf(scene, 'leg') - 6, T('06:41')], [at(scene, 'wait'), T('06:41')], [at(scene, 'tick') - 4, T('07:02')], [at(scene, 'tick') + 40, T('07:06')]];
  const upto = track(f, pts), L = S.leg;
  const kL = pop(f, fps, at(scene, 'leg')), kBot = pop(f, fps, when(pts, L.loT + 5 * MIN)), kH = pop(f, fps, at(scene, 'halves'), 20), kW = pop(f, fps, at(scene, 'wait')), kT = pop(f, fps, at(scene, 'tick'));
  const ks = candlesAt(TF5, upto), last = ks[ks.length - 1];
  const pos = last ? Math.max(0, Math.min(1, (last.c - L.lo) / (L.hi - L.lo))) : 0;
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} />
      <Source />
      <Chart id="pd" tf={TF5} upto={upto} view={VB}
        under={(g) => (<>
          <Box g={g} t1={L.hiT} pa={L.hi} pb={L.eq} fill="rgba(220,38,38,0.10)" k={kH} />
          <Box g={g} t1={L.hiT} pa={L.eq} pb={L.lo} fill="rgba(22,163,74,0.10)" k={kH} />
        </>)}
        overlay={(g) => (<>
          <SwingLabels g={g} frame={f} fps={fps} dim={0.45} />
          <Ring x={g.cx(L.hiT)} y={g.Y(L.hi)} color={C.blue} k={kL} />
          <Tag x={g.cx(L.hiT) + 40} y={g.Y(L.hi) - 6} anchor="start" text={`top ${fp(L.hi)}`} color={C.blue} k={kL} size={22} mono />
          <Ring x={g.cx(L.loT)} y={g.Y(L.lo)} color={C.blue} k={kBot} />
          <Tag x={g.cx(L.loT) + 40} y={g.Y(L.lo) + 6} anchor="start" text={`bottom ${fp(L.lo)}`} color={C.blue} k={kBot} size={22} mono />
          {kBot > 0 && kW < 1 && <g opacity={1 - kW}><Arrow x1={g.X(T('06:58'))} y1={g.Y(L.lo)} x2={g.X(T('06:58'))} y2={g.Y(L.hi)} color={C.blue} k={kBot} width={4} /></g>}
          <HLine g={g} p={L.eq} from={L.hiT} k={kH} color={C.ink} dash="12 8" label={`✂️ 50% · ${fp(L.eq)}`} labelAt="right" />
          <Tag x={g.X(T('07:50'))} y={g.Y((L.hi + L.eq) / 2)} text="💎 PREMIUM · expensive" color={C.down} k={kH} size={24} />
          <Tag x={g.X(T('07:50'))} y={g.Y((L.lo + L.eq) / 2)} text="🏷️ DISCOUNT · on sale" color={C.up} k={kH} size={24} />
          {kW > 0 && last && <Arrow x1={g.cx(last.t) + 30} y1={g.Y(L.lo + (L.eq - L.lo) * 0.3)} x2={g.cx(last.t) + 30} y2={g.Y(L.eq + (L.hi - L.eq) * 0.25)} color={C.down} k={kW * (1 - kT)} width={5} />}
          {S.premT && <Ring x={g.cx(Math.floor(S.premT / TF5) * TF5)} y={g.Y(L.prem.p)} color={C.up} k={kT} r={30} />}
          {S.premT && <Tag x={g.cx(Math.floor(S.premT / TF5) * TF5)} y={g.Y(L.prem.p) - 60} text={`Premium ✓ ${hm(S.premT)}`} color="#fff" bg={C.up} border={C.up} k={kT} size={24} />}
        </>)} />
      <Card step={2} items={[
        { at: at(scene, 'leg'), icon: '📏', text: 'Measure the move: top → bottom' },
        { at: at(scene, 'halves'), icon: '✂️', text: 'Cut in half: top = premium 💎, bottom = discount 🏷️' },
        { at: at(scene, 'wait'), icon: '🔻', text: 'A short waits for PREMIUM (sell when expensive)' },
        { at: at(scene, 'tick'), icon: '✅', text: `${hm(S.premT)}: price is back in premium` },
      ]} footer={<Meter at={pos} k={kH} />} />
    </AbsoluteFill>
  );
};

// ================================================================== step 4: the supply zone
export const Zone = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('07:06')], [at(scene, 'back'), T('07:06')], [nextOf(scene, 'back'), T('07:36')]];
  const upto = track(f, pts), L = S.leg, z = S.zone;
  const kO = pop(f, fps, at(scene, 'ob')), kB = pop(f, fps, at(scene, 'box'), 20), kK = pop(f, fps, at(scene, 'back')), kX = pop(f, fps, line(scene, 4));
  const ks = candlesAt(TF5, upto), last = ks[ks.length - 1];
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} />
      <Source />
      <Chart id="zn" tf={TF5} upto={upto} view={VB}
        under={(g) => (<>
          <Box g={g} t1={L.hiT} pa={L.hi} pb={L.eq} fill="rgba(220,38,38,0.05)" />
          <Box g={g} t1={L.hiT} pa={L.eq} pb={L.lo} fill="rgba(22,163,74,0.05)" />
          <Box g={g} t1={z.t} pa={z.top} pb={z.bot} fill="rgba(220,38,38,0.16)" stroke={C.down} dash="10 6" k={kB} />
        </>)}
        overlay={(g) => (<>
          <HLine g={g} p={L.eq} from={L.hiT} color={C.mute} dash="12 8" width={2} />
          <Glow g={g} t={z.t} k={kO} color={C.amber} />
          <SwingLabels g={g} frame={f} fps={fps} dim={0.4} />
          <Tag x={g.cx(z.t) + 40} y={g.Y(z.top) - 40} anchor="start" text="🕯️ last UP candle before the drop" color="#b45309" k={kO * (1 - 0.5 * kB)} size={22} />
          <Tag x={g.X(T('07:40'))} y={g.Y((z.top + z.bot) / 2)} text={`📦 SUPPLY ZONE ${fp(z.bot)} – ${fp(z.top)}`} color={C.down} k={kB} size={24} />
          {kK > 0 && last && <Arrow x1={g.cx(last.t)} y1={g.Y(last.c) + 30} x2={g.cx(last.t) + 20} y2={g.Y(z.bot) + 12} color={C.down} k={kK} width={5} />}
          <Tag x={g.X(T('07:40'))} y={g.Y(z.top) - 40} text="❌ a CLOSE above the box = broken" color={C.ink} k={kX} size={22} />
        </>)} />
      <Card step={3} items={[
        { at: at(scene, 'ob'), icon: '🕯️', text: 'Last UP candle before the big drop' },
        { at: at(scene, 'box'), icon: '📦', text: 'From it to the top = the SUPPLY ZONE' },
        { at: at(scene, 'back'), icon: '🔁', text: 'Sellers often push price down here again' },
        { at: line(scene, 4), icon: '❌', text: 'A close above the box = zone broken' },
      ]} />
    </AbsoluteFill>
  );
};

// ================================================================== step 5: liquidity + sweep
export const Sweep = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('07:36')], [at(scene, 'go'), T('07:36')], [nextOf(scene, 'go') - 8, T('08:00')]];
  const upto = track(f, pts), sw = S.sweep, z = S.zone, L = S.leg;
  const kP = pop(f, fps, at(scene, 'pile'), 20), kG = pop(f, fps, line(scene, 2)), kS = pop(f, fps, at(scene, 'sweep')), kT = pop(f, fps, at(scene, 'ticks'));
  const swept = upto >= sw.conf;
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} pulse={kT * (1 - fade(f, at(scene, 'ticks') + 25, at(scene, 'ticks') + 45))} />
      <Source />
      <Chart id="sp" tf={TF5} upto={upto} view={VC}
        under={(g) => (<>
          <Box g={g} t1={L.hiT} pa={L.hi} pb={L.eq} fill="rgba(220,38,38,0.05)" />
          <Box g={g} t1={z.t} pa={z.top} pb={z.bot} fill="rgba(220,38,38,0.08)" stroke="rgba(220,38,38,0.35)" dash="10 6" />
        </>)}
        overlay={(g) => (<>
          <HLine g={g} p={L.eq} from={L.hiT} color={C.mute} dash="12 8" width={2} />
          <SwingLabels g={g} frame={f} fps={fps} keep={[]} />
          <HLine g={g} p={sw.p} from={sw.levelT} k={kP} color={C.violet} dash={swept ? '4 6' : '10 7'} width={3.5} label={`old peak ${fp(sw.p)}`} labelAt="left" />
          {kP > 0 && <text x={g.X(sw.levelT) + 16} y={g.Y(sw.p) - 52} fontSize={30} opacity={Math.min(1, kP) * (1 - kS)}>🛑🛑🛑🛑</text>}
          <Tag x={g.X(sw.levelT) + 10} y={g.Y(sw.p) - 104} anchor="start" text="LIQUIDITY = stop-losses waiting" color={C.violet} k={kP * (1 - kS)} size={22} />
          {kG > 0 && <Arrow x1={g.X(T('08:15'))} y1={g.Y(sw.p) + 70} x2={g.X(T('08:15'))} y2={g.Y(sw.p) - 6} color={C.violet} k={kG * (1 - kS)} width={5} />}
          <Ring x={g.cx(sw.t)} y={g.Y(sw.wick)} color={C.amber} r={30} k={kS} />
          <Tag x={g.W - 10} y={g.Y(sw.wick) - 70} anchor="end" text="SWEEP ✓ wick above, closed back below" color="#fff" bg={C.amber} border={C.amber} k={kS} size={24} />
        </>)} />
      <Card step={4} items={[
        { at: at(scene, 'pile'), icon: '🛑', text: 'Stop-losses hide above old peaks = LIQUIDITY' },
        { at: line(scene, 2), icon: '🧲', text: 'Big traders push up to grab them' },
        { at: at(scene, 'go'), icon: '🪝', text: 'Wick above… then CLOSE back below' },
        { at: at(scene, 'sweep'), icon: '⚽', text: 'That’s the SWEEP: a fake-out!' },
        { at: at(scene, 'ticks'), icon: '✅', text: 'break ✓ premium ✓ sweep ✓' },
      ]} />
    </AbsoluteFill>
  );
};

// ================================================================== step 6: the 1m trigger
export const Trigger = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const z0 = at(scene, 'zoom');
  const pts = [[0, T('08:00')], [at(scene, 'wait'), T('08:00')], [nextOf(scene, 'wait') - 10, T('08:31')]];
  const upto = track(f, pts), sw = S.sweep, tg = S.trig, st = S.setup;
  const k5 = 1 - fade(f, z0 + 2, z0 + 12), kz = fade(f, z0 + 12, z0 + 24);
  const kBl = pop(f, fps, at(scene, 'blue'), 20), kW = pop(f, fps, at(scene, 'wait')), kE = pop(f, fps, at(scene, 'entry'));
  return (
    <AbsoluteFill>
      <DeskStrip tf={f >= z0 + 12 ? MIN : TF5} upto={upto} pulse={kE * (1 - fade(f, at(scene, 'entry') + 25, at(scene, 'entry') + 45))} />
      <Source />
      {k5 > 0 && <Chart id="t5" tf={TF5} upto={T('08:00')} view={VC} opacity={k5} scale={1 + 0.06 * (1 - k5)} overlay={(g) => (<>
        <Ring x={g.cx(sw.t)} y={g.Y(sw.wick)} color={C.amber} r={30} />
        <Tag x={170} y={60} text="5-minute chart" color={C.ink} size={26} anchor="start" />
      </>)} />}
      {kz > 0 && <Chart id="t1" tf={MIN} upto={upto} view={V1} opacity={kz} scale={0.94 + 0.06 * kz} overlay={(g) => (<>
        <Tag x={170} y={60} text="🔍 1-minute chart" color="#fff" bg={C.blue} border={C.blue} size={28} anchor="start" />
        <HLine g={g} p={sw.p} from={sw.levelT} color={C.violet} dash="4 6" width={2.5} />
        <Ring x={g.cx(sw.wickT)} y={g.Y(sw.wick)} color={C.amber} r={24} />
        <Tag x={g.cx(sw.wickT) + 34} y={g.Y(sw.wick) - 30} anchor="start" text={`sweep top ${hm(sw.wickT)}`} color="#b45309" size={20} />
        <Ring x={g.cx(tg.t)} y={g.Y(tg.p)} color={C.blue} r={22} k={kBl} />
        <HLine g={g} p={tg.p} from={tg.t} k={kBl} color={C.blue} width={4.5} label={`🔵 last little valley ${fp(tg.p)}`} labelAt="left" />
        <Tag x={g.W - 20} y={g.H - 50} anchor="end" text="⏳ waiting for a 1m CLOSE below the blue line" color={C.blue} k={kW * (1 - kE)} size={22} />
        <Glow g={g} t={st.t} k={kE} color={C.down} />
        {kE > 0 && <Arrow x1={g.cx(st.t) - 40} y1={g.Y(st.entry) + 92} x2={g.cx(st.t) - 4} y2={g.Y(st.entry) + 14} color={C.down} k={kE} width={6} />}
        <Tag x={g.cx(st.t) - 10} y={g.Y(st.entry) + 120} anchor="end" text={`ENTRY · SHORT ${fp(st.entry)} 🚦`} color="#fff" bg={C.down} border={C.down} k={kE} size={26} />
      </>)} />}
      <Card step={5} items={[
        { at: at(scene, 'zoom'), icon: '🔍', text: 'Zoom in to the 1-minute chart' },
        { at: at(scene, 'blue'), icon: '🔵', text: 'Last little valley before the sweep top' },
        { at: at(scene, 'wait'), icon: '⏳', text: 'Wait for a 1m CLOSE below it' },
        { at: at(scene, 'entry'), icon: '🚦', text: `${hm(st.t)}: close below = GO! Enter the short` },
      ]} />
    </AbsoluteFill>
  );
};

// ================================================================== step 7: the plan
const PlanGrid = ({ k }) => {
  const st = S.setup, cell = (lab, v, col) => (
    <div style={{ flex: 1, background: '#f9fafb', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ fontFamily: SANS, fontSize: 18, color: C.soft }}>{lab}</div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color: col }}>{v}</div>
    </div>
  );
  return (
    <div style={{ opacity: Math.min(1, k) }}>
      <div style={{ display: 'flex', gap: 8 }}>{cell('Entry', fp(st.entry), C.ink)}{cell('Stop', fp(st.stop), C.down)}{cell('Target', fp(st.target), C.up)}{cell('R', st.R.toFixed(1) + 'R', C.ink)}</div>
      <div style={{ fontFamily: SANS, fontSize: 21, color: C.soft, marginTop: 8 }}>risk {S.risk.toFixed(2)}% · reward {S.reward.toFixed(2)}% → reward = 2 × risk</div>
    </div>
  );
};
export const Plan = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, T('08:31')], [at(scene, 'play'), T('08:31')], [nextOf(scene, 'play') - 4, S.out.t + MIN]];
  const upto = track(f, pts), st = S.setup;
  const kE = pop(f, fps, at(scene, 'entry'), 20), kS = pop(f, fps, at(scene, 'stop'), 20), kT = pop(f, fps, at(scene, 'target'), 20), kH = pop(f, fps, at(scene, 'hit'), 10);
  const ks = candlesAt(TF5, upto), last = ks[ks.length - 1];
  const r = last ? (st.entry - last.c) / (st.stop - st.entry) * (EX.dir === -1 ? 1 : -1) : 0;
  const playing = f >= at(scene, 'play');
  return (
    <AbsoluteFill>
      <DeskStrip tf={TF5} upto={upto} />
      <Source />
      <Chart id="pl" tf={TF5} upto={upto} view={VP}
        under={(g) => (<>
          <Box g={g} t1={st.t} pa={st.entry} pb={st.stop} fill="rgba(220,38,38,0.14)" k={kS} />
          <Box g={g} t1={st.t} pa={st.entry} pb={st.target} fill="rgba(22,163,74,0.13)" k={kT} />
        </>)}
        overlay={(g) => (<>
          <SwingLabels g={g} frame={f} fps={fps} dim={0.3} />
          <HLine g={g} p={st.entry} from={st.t} k={kE} color={C.ink} width={3.5} label={`▶️ ENTRY ${fp(st.entry)}`} labelAt="right" />
          <HLine g={g} p={st.stop} from={st.t} k={kS} color={C.down} width={3.5} label={`🛑 STOP ${fp(st.stop)} · safety net`} labelAt="right" />
          <HLine g={g} p={st.target} from={st.t} k={kT} color={C.up} width={3.5} label={`🎯 TARGET ${fp(st.target)} · 2R`} labelAt="left" />
          {kS > 0 && <Tag x={g.X(st.t) + 14} y={g.Y((st.entry + st.stop) / 2)} anchor="start" text="risk = 1 step" color={C.down} k={kS} size={20} />}
          {kT > 0 && <Tag x={g.X(st.t) + 14} y={g.Y((st.entry + st.target) / 2)} anchor="start" text="reward = 2 steps" color={C.up} k={kT} size={20} />}
          {playing && last && kH < 0.5 && <Tag x={g.W - 16} y={g.Y(last.c) + 40} anchor="end" text={`${r >= 0 ? '+' : ''}${r.toFixed(1)}R`} color="#fff" bg={r >= 0 ? C.up : C.down} border={r >= 0 ? C.up : C.down} size={24} mono />}
          <Ring x={g.cx(Math.floor(S.out.t / TF5) * TF5)} y={g.Y(st.target)} color={C.up} r={34} k={kH} />
          <Tag x={g.cx(Math.floor(S.out.t / TF5) * TF5) - 20} y={g.Y(st.target) + 80} anchor="end" text={`🎯 TARGET HIT ${hm(S.out.t)} · +2R`} color="#fff" bg={C.up} border={C.up} k={kH} size={30} />
        </>)} />
      <Card step={6} items={[
        { at: at(scene, 'entry'), icon: '▶️', text: 'Entry = where the trigger candle closed' },
        { at: at(scene, 'stop'), icon: '🛑', text: 'Stop = just above the sweep wick (safety net)' },
        { at: at(scene, 'target'), icon: '🎯', text: 'Target = 2 × risk = 2R' },
        { at: at(scene, 'play'), icon: '🙌', text: 'Then let it play. Don’t touch!' },
        { at: at(scene, 'hit'), icon: '✅', text: 'Target hit: +2R' },
      ]} footer={<PlanGrid k={kE} />} />
    </AbsoluteFill>
  );
};

// ================================================================== the desk keeps the checklist
export const Desk = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const kL = pop(f, fps, at(scene, 'line')), t0 = at(scene, 'ticks'), kR = pop(f, fps, at(scene, 'ready'));
  const names = checklist(S.setup.conf).map((x) => x.k);
  return (
    <AbsoluteFill>
      <Chart id="dk" tf={TF5} upto={S.setup.conf} view={VP} opacity={0.08} />
      <div style={{ position: 'absolute', left: 60, right: 60, top: 70, background: '#fff', borderRadius: 24, padding: '30px 40px', border: `3px solid ${kL > 0.5 ? C.amber : C.line}`,
        boxShadow: '0 20px 60px rgba(17,24,39,0.12)', fontFamily: MONO, fontSize: 36, lineHeight: 1.7, color: C.ink }}>
        <div><b>{EX.pair} · 1m · Binance</b><span style={{ color: C.soft }}>  the top line of the desk chart</span></div>
        <div>
          <span style={{ color: C.down, fontWeight: 700 }}>A+ {EX.side} idea</span><span style={{ color: C.soft }}> since the CHoCH {hm(S.brk.t)} · </span>
          {names.map((n, i) => {
            const k = pop(f, fps, t0 + 12 + i * 16);
            const done = k > 0.5;
            return <span key={n} style={{ display: 'inline-block', marginRight: 22, color: done ? C.up : C.mute, fontWeight: done ? 800 : 400, transform: `scale(${1 + 0.25 * Math.sin(Math.min(1, k) * Math.PI)})` }}>{done ? '✓' : '○'} {n}</span>;
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 60, top: 330, display: 'flex', gap: 30, opacity: Math.min(1, pop(f, fps, t0)) }}>
        <div style={{ fontFamily: SANS, fontSize: 40, background: '#fff', borderRadius: 18, padding: '16px 28px', border: `3px solid ${C.mute}` }}><b style={{ color: C.mute }}>○</b> = still waiting</div>
        <div style={{ fontFamily: SANS, fontSize: 40, background: '#fff', borderRadius: 18, padding: '16px 28px', border: `3px solid ${C.up}` }}><b style={{ color: C.up }}>✓</b> = done</div>
      </div>
      <div style={{ position: 'absolute', left: 60, top: 470, width: 1100, opacity: Math.min(1, kR), transform: `translateY(${(1 - kR) * 30}px)` }}>
        <div style={{ fontFamily: SANS, fontSize: 46, fontWeight: 900, color: C.ink }}>All 4 ticked → the setup is ready 🎯</div>
        <div style={{ fontFamily: MONO, fontSize: 32, marginTop: 18, color: C.ink }}>entry <b>{fp(S.setup.entry)}</b> · stop <b style={{ color: C.down }}>{fp(S.setup.stop)}</b> · target <b style={{ color: C.up }}>{fp(S.setup.target)}</b> · <b>{S.setup.R.toFixed(1)}R</b></div>
        <div style={{ fontFamily: SANS, fontSize: 34, marginTop: 22, color: C.soft }}>🎓 Walk me through → step 7 shows the plan</div>
      </div>
    </AbsoluteFill>
  );
};

// ================================================================== long = mirror
export const Long = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const rows = [
    ['Break', 'closes BELOW the last valley', 'closes ABOVE the last peak', 'a'],
    ['Wait for', 'PREMIUM (expensive) 💎', 'DISCOUNT (cheap) 🏷️', 'a'],
    ['Sweep', 'wick ABOVE an old peak, closes back', 'wick UNDER an old valley, closes back', 'b'],
    ['1m trigger', '1m close BELOW the last little valley', '1m close ABOVE the last little peak', 'b'],
    ['Stop', 'just above the wick', 'just under the wick', 'c'],
    ['Target', 'below ⬇', 'above ⬆', 'c'],
  ];
  const cnt = {};
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 80, top: 60, fontSize: 64, fontWeight: 900, color: C.ink, opacity: Math.min(1, pop(f, fps, 2)) }}>A LONG is the same steps, flipped 🔄</div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 190 }}>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 900, marginBottom: 14 }}>
          <div style={{ width: 300 }} /><div style={{ flex: 1, color: C.down }}>SHORT 🔻</div><div style={{ flex: 1, color: C.up }}>LONG 🔺</div>
        </div>
        {rows.map(([a, s, l, cue]) => {
          cnt[cue] = (cnt[cue] || 0) + 1;
          const k = pop(f, fps, at(scene, cue) + (cnt[cue] - 1) * 10);
          return (
            <div key={a} style={{ display: 'flex', alignItems: 'center', fontSize: 33, padding: '16px 0', borderTop: `2px solid ${C.line}`, opacity: Math.min(1, k), transform: `translateX(${(1 - k) * 50}px)` }}>
              <div style={{ width: 300, fontWeight: 800, color: C.ink }}>{a}</div>
              <div style={{ flex: 1, color: C.ink, paddingRight: 30 }}>{s}</div>
              <div style={{ flex: 1, color: C.ink, background: '#f0fdf4', borderRadius: 12, padding: '6px 14px' }}>{l}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ================================================================== golden rules + the honest result
export const Rules = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const rules = [['r1', '1', 'Only a candle CLOSE counts', '🕯️'], ['r2', '2', 'Set your stop BEFORE you enter. Every time.', '🛑'], ['r3', '3', 'Keep your size small', '🤏']];
  const kT = pop(f, fps, at(scene, 'truth')), kB = pop(f, fps, at(scene, 'bye'));
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 80, top: 60, fontSize: 64, fontWeight: 900, color: C.ink, opacity: Math.min(1, pop(f, fps, 2)) }}>⭐ 3 golden rules</div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 180, display: 'flex', gap: 30 }}>
        {rules.map(([cue, n, t, ic]) => {
          const k = pop(f, fps, at(scene, cue));
          return (
            <div key={n} style={{ flex: 1, background: '#fff', border: `3px solid ${C.blue}`, borderRadius: 24, padding: '26px 28px', opacity: Math.min(1, k), transform: `scale(${0.8 + 0.2 * k})` }}>
              <div style={{ fontSize: 60 }}>{ic}</div>
              <div style={{ fontSize: 38, fontWeight: 900, color: C.ink, marginTop: 8 }}><span style={{ color: C.blue }}>{n}.</span> {t}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 80, right: 80, top: 480, background: '#fffbeb', border: `3px solid ${C.amber}`, borderRadius: 24, padding: '26px 34px',
        opacity: Math.min(1, kT), transform: `translateY(${(1 - kT) * 30}px)` }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: '#92400e' }}>🧪 The truth</div>
        <div style={{ fontSize: 32, color: C.ink, marginTop: 10, lineHeight: 1.35 }}>Not every setup wins like this one. On the 207 coins our bot traded (14 Oct – 13 Nov 2026), these exact rules lost a little after fees, about the same as entering at a random time.</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: C.ink, marginTop: 10 }}>Use them to practise reading charts, not as a money machine.</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 790, textAlign: 'center', opacity: Math.min(1, kB), transform: `scale(${0.85 + 0.15 * kB})` }}>
        <span style={{ fontSize: 48, fontWeight: 900, color: '#fff', background: C.blue, borderRadius: 20, padding: '18px 40px' }}>Open the desk → 🎓 Walk me through → try it!</span>
      </div>
    </AbsoluteFill>
  );
};

export const SCENE_COMPONENTS = { intro: Intro, candles: Candles, swings: Swings, break: Break, premium: Premium, zone: Zone, sweep: Sweep, trigger: Trigger, plan: Plan, desk: Desk, long: Long, rules: Rules };
