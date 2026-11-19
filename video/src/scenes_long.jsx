// The long walk-through: the same 7 steps, flipped, on a real long. Bitcoin on the night of 10–11 Nov 2026
// (data/example_long.json from `SIDE=long OUT=example_long.json node scripts/pick.cjs all 10`), printed live with the
// same desk chart, top line and coach card as the short. Times below are this example's; a new example needs them updated.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { LONG, MIN, TF5, fp, hm } from './data.js';
import { at, nextOf } from './timing.js';
import { C, SANS, MONO, Chart, Tag, HLine, Box, Glow, Ring, Arrow, SwingLabels, DeskStrip, Card, pop, fade, track } from './kit.jsx';
import { when, Meter } from './scenes.jsx';

const D = LONG, { EX, S } = D;
// the chart starts on the evening of 10 Nov: 'hh:mm' from 12:00 on is the evening before the setup day
const P = (s) => D.T(s, Number(s.slice(0, 2)) >= 12 ? -1 : 0);
const view = (a, b, pad = 0.14, until) => ({ t0: P(a), t1: P(b), ...D.fit(P(a), P(until || b), pad) });
const appearMap = (pts) => Object.fromEntries(S.swings.map((s) => [s.t, when(pts, s.conf)]));
const bar = (t) => Math.floor(t / TF5) * TF5;

const LA = view('23:20', '02:05', 0.14, '01:35');
const LB = view('00:20', '03:00', 0.14, '02:10');
const LC = view('00:50', '03:00', 0.12, '02:35');
const L1 = view('01:58', '02:48', 0.12, '02:40');
const LP = view('01:00', '08:30', 0.1, '08:00');

const Source = () => (
  <div style={{ position: 'absolute', right: 40, top: 30, fontFamily: SANS, fontSize: 19, color: C.mute, textAlign: 'right' }}>
    Real Binance {EX.pair} candles · {D.DAY} · UTC
  </div>
);

// ================================================================== steps 1–2: stairs down, then a close above the ceiling
export const LSwingsBreak = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, P('23:35')], [at(scene, 'stairs'), P('23:50')], [at(scene, 'ceiling') - 8, P('01:25')], [at(scene, 'go'), P('01:25')], [nextOf(scene, 'go') - 12, P('01:31')]];
  const upto = track(f, pts), ap = appearMap(pts), b = S.brk;
  const kI = pop(f, fps, 6), kSt = pop(f, fps, at(scene, 'stairs')), kCe = pop(f, fps, at(scene, 'ceiling'), 20), kC = pop(f, fps, at(scene, 'choch'));
  const stair = ['23:40', '00:25', '00:35', '01:05'].map((t) => S.swings.find((s) => s.t === P(t))).filter((s) => s && upto >= s.conf);
  const broke = upto >= b.conf, step = f >= at(scene, 'ceiling') ? 1 : 0;
  return (
    <AbsoluteFill>
      <DeskStrip d={D} tf={TF5} upto={upto} pulse={kC * (1 - fade(f, at(scene, 'choch') + 20, at(scene, 'choch') + 40))} />
      <Source />
      <Chart id="l12" d={D} tf={TF5} upto={upto} view={LA} overlay={(g) => (<>
        <Glow g={g} t={b.t} k={kC} color={C.up} />
        {kSt > 0 && stair.length > 1 && <polyline points={stair.map((s) => `${g.cx(s.t)},${g.Y(s.p)}`).join(' ')} fill="none" stroke={C.down} strokeWidth={6} strokeLinejoin="round" opacity={Math.min(1, kSt) * (1 - 0.65 * kCe)} />}
        <SwingLabels g={g} frame={f} fps={fps} appearAt={ap} dim={step ? 0.55 : 1} />
        <Tag x={g.W / 2} y={150} text={`🪙 Bitcoin · ${EX.pair} · ${D.DAY}`} color={C.ink} k={kI * (1 - kSt)} size={34} mono />
        <Tag x={20} y={g.H - 60} anchor="start" text="📉 LH + LL = stairs DOWN = downtrend" color={C.down} k={kSt * (1 - kC)} size={24} />
        <HLine g={g} p={b.p} from={b.fromT} k={kCe} color={broke ? C.up : C.ink} dash={broke && kC > 0.5 ? undefined : '10 8'} width={broke && kC > 0.5 ? 4 : 3} />
        <Tag x={g.X(b.fromT) + 30} y={g.Y(b.p) + 32} anchor="start" text={`🧱 ceiling ${fp(b.p)}`} color={broke ? C.up : C.ink} k={kCe} size={20} />
        <Tag x={g.cx(b.t)} y={g.Y(b.close) - 120} text={`CHoCH ↑  close ${fp(b.close)}`} color={C.up} k={kC} size={24} />
        <Tag x={170} y={60} text="Bias: LONGS 🔺" color="#fff" bg={C.up} border={C.up} k={pop(f, fps, at(scene, 'choch') + 45)} size={30} anchor="start" />
      </>)} />
      <Card step={step} items={step ? [
        { at: at(scene, 'ceiling'), icon: '🧱', text: 'Last peak = the ceiling' },
        { at: at(scene, 'go'), icon: '👀', text: 'Watch for a candle CLOSE above it' },
        { at: at(scene, 'choch'), icon: '🔨', text: 'Close above = CHoCH UP' },
        { at: at(scene, 'choch') + 45, icon: '🔺', text: 'Now look for LONGS only' },
      ] : [
        { at: 6, icon: '🪙', text: 'A real LONG: Bitcoin, 11 Nov' },
        { at: at(scene, 'stairs'), icon: '📉', text: 'LH + LL = stairs DOWN = downtrend' },
      ]} />
    </AbsoluteFill>
  );
};

// ================================================================== steps 3–4: discount, then the demand zone
export const LDiscZone = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, P('01:31')], [at(scene, 'leg'), P('01:31')], [nextOf(scene, 'leg') - 6, P('01:47')], [at(scene, 'halves'), P('01:47')], [at(scene, 'tick') - 4, P('01:55')],
    [at(scene, 'tick') + 40, P('01:58')], [at(scene, 'zone'), P('01:58')], [at(scene, 'back'), P('02:01')], [nextOf(scene, 'back'), P('02:08')]];
  const upto = track(f, pts), L = S.leg, z = S.zone, step = f >= at(scene, 'zone') ? 3 : 2;
  const kL = pop(f, fps, at(scene, 'leg')), kTop = pop(f, fps, when(pts, L.hiT + MIN)), kH = pop(f, fps, at(scene, 'halves'), 20), kT = pop(f, fps, at(scene, 'tick'));
  const kO = pop(f, fps, at(scene, 'zone')), kB = pop(f, fps, at(scene, 'zone') + 30, 20), kK = pop(f, fps, at(scene, 'back'));
  const ks = D.candlesAt(TF5, upto), last = ks[ks.length - 1];
  const pos = last ? Math.max(0, Math.min(1, (last.c - L.lo) / (L.hi - L.lo))) : 0;
  const dim = 1 - 0.6 * kO;
  return (
    <AbsoluteFill>
      <DeskStrip d={D} tf={TF5} upto={upto} pulse={kT * (1 - fade(f, at(scene, 'tick') + 25, at(scene, 'tick') + 45))} />
      <Source />
      <Chart id="l34" d={D} tf={TF5} upto={upto} view={LB}
        under={(g) => (<>
          <Box g={g} t1={L.loT} pa={L.hi} pb={L.eq} fill={`rgba(220,38,38,${(0.1 * dim).toFixed(3)})`} k={kH} />
          <Box g={g} t1={L.loT} pa={L.eq} pb={L.lo} fill={`rgba(22,163,74,${(0.1 * dim).toFixed(3)})`} k={kH} />
          <Box g={g} t1={z.t} pa={z.top} pb={z.bot} fill="rgba(22,163,74,0.2)" stroke={C.up} dash="10 6" k={kB} />
        </>)}
        overlay={(g) => (<>
          <Glow g={g} t={z.t} k={kO * (1 - kK)} color={C.amber} />
          <SwingLabels g={g} frame={f} fps={fps} dim={0.45} />
          <Ring x={g.cx(bar(L.loT))} y={g.Y(L.lo)} color={C.blue} k={kL * (1 - kO)} />
          <Tag x={g.cx(bar(L.loT)) + 40} y={g.Y(L.lo) + 8} anchor="start" text={`bottom ${fp(L.lo)}`} color={C.blue} k={kL * (1 - kO)} size={22} mono />
          <Ring x={g.cx(bar(L.hiT))} y={g.Y(L.hi)} color={C.blue} k={kTop * (1 - kO)} />
          <Tag x={g.cx(bar(L.hiT)) + 40} y={g.Y(L.hi) - 6} anchor="start" text={`top ${fp(L.hi)}`} color={C.blue} k={kTop * (1 - kO)} size={22} mono />
          {kTop > 0 && <g opacity={1 - kT}><Arrow x1={g.X(P('02:22'))} y1={g.Y(L.lo)} x2={g.X(P('02:22'))} y2={g.Y(L.hi)} color={C.blue} k={kTop} width={4} /></g>}
          <HLine g={g} p={L.eq} from={L.loT} k={kH} color={C.ink} dash="12 8" label={`✂️ 50% · ${fp(L.eq)}`} labelAt="right" />
          <Tag x={g.X(P('02:35'))} y={g.Y((L.hi + L.eq) / 2)} text="💎 PREMIUM · expensive" color={C.down} k={kH * (1 - kO)} size={24} />
          <Tag x={g.X(P('02:35'))} y={g.Y((L.lo + L.eq) / 2)} text="🏷️ DISCOUNT · on sale" color={C.up} k={kH * (1 - kO)} size={24} />
          {S.premT && <Ring x={g.cx(bar(S.premT))} y={g.Y(L.prem.p)} color={C.up} k={kT * (1 - kO)} r={30} />}
          {S.premT && <Tag x={g.cx(bar(S.premT))} y={g.Y(L.prem.p) + 62} text={`Discount ✓ ${hm(S.premT)}`} color="#fff" bg={C.up} border={C.up} k={kT * (1 - kO)} size={24} />}
          <Tag x={g.cx(z.t) - 30} y={g.Y(z.bot) + 63} anchor="start" text="🕯️ last DOWN candle at the valley" color="#b45309" k={kO} size={20} />
          <Tag x={g.W - 10} y={g.Y((z.top + z.bot) / 2)} anchor="end" text="📦 DEMAND ZONE" color={C.up} k={kB} size={24} />
          {kK > 0 && last && <Arrow x1={g.cx(last.t) + 34} y1={g.Y(L.eq)} x2={g.cx(last.t) + 34} y2={g.Y(z.top) + 10} color={C.up} k={kK} width={5} />}
        </>)} />
      {step === 2 ? (
        <Card step={2} items={[
          { at: at(scene, 'leg'), icon: '📏', text: 'Measure the move: bottom → top' },
          { at: at(scene, 'halves'), icon: '✂️', text: 'Cut in half: bottom = discount 🏷️, top = premium 💎' },
          { at: at(scene, 'halves') + 60, icon: '🔺', text: 'A long waits for DISCOUNT (buy cheap)' },
          { at: at(scene, 'tick'), icon: '✅', text: `${hm(S.premT)}: price is in discount` },
        ]} footer={<Meter at={pos} k={kH} />} />
      ) : (
        <Card step={3} title="Mark the demand zone" items={[
          { at: at(scene, 'zone'), icon: '🕯️', text: 'Last DOWN candle at the valley' },
          { at: at(scene, 'zone') + 30, icon: '📦', text: `From it to the bottom = the DEMAND zone ${fp(z.bot)} – ${fp(z.top)}` },
          { at: at(scene, 'back'), icon: '🔁', text: 'Buyers often push price up here again' },
        ]} />
      )}
    </AbsoluteFill>
  );
};

// ================================================================== steps 5–6: the sweep under the valley, then the 1m trigger
export const LSweepTrig = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const z0 = at(scene, 'zoom');
  const pts = [[0, P('02:08')], [at(scene, 'go'), P('02:14')], [nextOf(scene, 'go') - 8, P('02:25')], [at(scene, 'wait'), P('02:25')], [nextOf(scene, 'wait') - 6, P('02:37')], [at(scene, 'entry') + 30, P('02:39')]];
  const upto = track(f, pts), sw = S.sweep, tg = S.trig, st = S.setup, z = S.zone, L = S.leg;
  const k5 = 1 - fade(f, z0 + 2, z0 + 12), kz = fade(f, z0 + 12, z0 + 24);
  const kP = pop(f, fps, at(scene, 'pile'), 20), kG = pop(f, fps, at(scene, 'go')), kS = pop(f, fps, at(scene, 'sweep'));
  const kBl = pop(f, fps, z0 + 30, 20), kW = pop(f, fps, at(scene, 'wait')), kE = pop(f, fps, at(scene, 'entry'));
  const kWick = pop(f, fps, when(pts, P('02:27'))), kDip = pop(f, fps, when(pts, P('02:31'))), kOff = fade(f, at(scene, 'entry') - 10, at(scene, 'entry') + 2);
  const swept = upto >= sw.conf, step = f >= z0 ? 5 : 4;
  return (
    <AbsoluteFill>
      <DeskStrip d={D} tf={f >= z0 + 12 ? MIN : TF5} upto={upto}
        pulse={Math.max(pop(f, fps, at(scene, 'sweep') + 40) * (1 - fade(f, at(scene, 'sweep') + 65, at(scene, 'sweep') + 85)), kE * (1 - fade(f, at(scene, 'entry') + 25, at(scene, 'entry') + 45)))} />
      <Source />
      {k5 > 0 && <Chart id="l56a" d={D} tf={TF5} upto={upto} view={LC} opacity={k5} scale={1 + 0.06 * (1 - k5)}
        under={(g) => (<>
          <Box g={g} t1={L.loT} pa={L.eq} pb={L.lo} fill="rgba(22,163,74,0.05)" />
          <Box g={g} t1={z.t} pa={z.top} pb={z.bot} fill="rgba(22,163,74,0.09)" stroke="rgba(22,163,74,0.4)" dash="10 6" />
        </>)}
        overlay={(g) => (<>
          <HLine g={g} p={L.eq} from={L.loT} color={C.mute} dash="12 8" width={2} />
          <SwingLabels g={g} frame={f} fps={fps} keep={[]} />
          <HLine g={g} p={sw.p} from={sw.levelT} k={kP} color={C.violet} dash={swept ? '4 6' : '10 7'} width={3.5} />
          <Tag x={g.X(sw.levelT) + 10} y={g.Y(sw.p) + 34} anchor="start" text={`old valley ${fp(sw.p)}`} color={C.violet} k={kP} size={20} />
          {kP > 0 && <text x={g.X(sw.levelT) + 16} y={g.Y(sw.p) + 92} fontSize={30} opacity={Math.min(1, kP) * (1 - kS)}>🛑🛑🛑🛑</text>}
          <Tag x={g.X(sw.levelT) + 10} y={g.Y(sw.p) + 132} anchor="start" text="LIQUIDITY = stop-losses waiting" color={C.violet} k={kP * (1 - kS)} size={22} />
          {kG > 0 && <Arrow x1={g.X(P('02:45'))} y1={g.Y(sw.p) - 80} x2={g.X(P('02:45'))} y2={g.Y(sw.p) + 6} color={C.violet} k={kG * (1 - kS)} width={5} />}
          <Ring x={g.cx(sw.t)} y={g.Y(sw.wick)} color={C.amber} r={30} k={kS} />
          <Tag x={g.W - 10} y={g.Y(sw.wick) + 70} anchor="end" text="SWEEP ✓ wick under, closed back above" color="#fff" bg={C.amber} border={C.amber} k={kS} size={24} />
          <Tag x={170} y={60} text="5-minute chart" color={C.ink} size={26} anchor="start" k={f >= z0 ? 1 : 0} />
        </>)} />}
      {kz > 0 && <Chart id="l56b" d={D} tf={MIN} upto={upto} view={L1} opacity={kz} scale={0.94 + 0.06 * kz} overlay={(g) => (<>
        <Tag x={170} y={60} text="🔍 1-minute chart" color="#fff" bg={C.blue} border={C.blue} size={28} anchor="start" />
        <HLine g={g} p={sw.p} from={sw.levelT} color={C.violet} dash="4 6" width={2.5} />
        <Ring x={g.cx(sw.wickT)} y={g.Y(sw.wick)} color={C.amber} r={24} />
        <Tag x={g.cx(sw.wickT) - 34} y={g.Y(sw.wick) + 30} anchor="end" text={`sweep bottom ${hm(sw.wickT)}`} color="#b45309" size={20} />
        <Ring x={g.cx(tg.t)} y={g.Y(tg.p)} color={C.blue} r={22} k={kBl} />
        <HLine g={g} p={tg.p} from={tg.t} k={kBl} color={C.blue} width={4.5} />
        <Tag x={g.W - 8} y={g.Y(tg.p) - 22} anchor="end" text={`🔵 last little peak ${fp(tg.p)}`} color={C.blue} k={kBl * (1 - kOff)} size={20} />
        <Tag x={g.W - 20} y={60} anchor="end" text="⏳ waiting for a 1m CLOSE above the blue line" color={C.blue} k={kW * (1 - kE)} size={22} />
        <Tag x={g.cx(P('02:26'))} y={g.Y(73480.3) - 40} text="✗ wick only, closed below" color={C.down} k={kWick * (1 - kE)} size={20} />
        <Ring x={g.cx(P('02:30'))} y={g.Y(73184.3)} color={C.mute} r={20} k={kDip * (1 - kE)} />
        <Tag x={g.cx(P('02:30'))} y={g.Y(73184.3) + 45} text="dips once more…" color={C.soft} k={kDip * (1 - kE)} size={20} />
        <Glow g={g} t={st.t} k={kE} color={C.up} />
        {kE > 0 && <Arrow x1={g.cx(st.t) - 40} y1={g.Y(st.entry) - 92} x2={g.cx(st.t) - 4} y2={g.Y(st.entry) - 14} color={C.up} k={kE} width={6} />}
        <Tag x={g.cx(st.t) - 10} y={g.Y(st.entry) - 120} anchor="end" text={`ENTRY · LONG ${fp(st.entry)} 🚦`} color="#fff" bg={C.up} border={C.up} k={kE} size={26} />
      </>)} />}
      {step === 4 ? (
        <Card step={4} items={[
          { at: at(scene, 'pile'), icon: '🛑', text: 'Stop-losses hide UNDER old valleys = LIQUIDITY' },
          { at: at(scene, 'go'), icon: '🪝', text: 'Wick under… then CLOSE back above' },
          { at: at(scene, 'sweep'), icon: '⚽', text: 'That’s the SWEEP: the fake-out, upside down' },
          { at: at(scene, 'sweep') + 40, icon: '✅', text: 'break ✓ discount ✓ sweep ✓' },
        ]} />
      ) : (
        <Card step={5} items={[
          { at: z0, icon: '🔍', text: 'Zoom in to the 1-minute chart' },
          { at: z0 + 30, icon: '🔵', text: 'Last little PEAK before the sweep bottom' },
          { at: at(scene, 'wait'), icon: '⏳', text: 'Wait for a 1m CLOSE above it' },
          { at: Math.max(at(scene, 'wait') + 20, when(pts, P('02:27'))), icon: '✗', text: 'A wick above does NOT count' },
          { at: at(scene, 'entry'), icon: '🚦', text: `${hm(st.t)}: close above = GO! Enter the long` },
        ]} />
      )}
    </AbsoluteFill>
  );
};

// ================================================================== step 7: the plan, then let it play
const PlanGrid = ({ k }) => {
  const st = S.setup, cell = (lab, v, col) => (
    <div style={{ flex: 1, background: '#f9fafb', borderRadius: 12, padding: '10px 6px', textAlign: 'center' }}>
      <div style={{ fontFamily: SANS, fontSize: 18, color: C.soft }}>{lab}</div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: col }}>{v}</div>
    </div>
  );
  return (
    <div style={{ opacity: Math.min(1, k) }}>
      <div style={{ display: 'flex', gap: 8 }}>{cell('Entry', fp(st.entry), C.ink)}{cell('Stop', fp(st.stop), C.down)}{cell('Target', fp(st.target), C.up)}{cell('R', st.R.toFixed(1) + 'R', C.ink)}</div>
      <div style={{ fontFamily: SANS, fontSize: 21, color: C.soft, marginTop: 8 }}>risk {S.risk.toFixed(2)}% · reward {S.reward.toFixed(2)}% → reward = {st.R.toFixed(1)} × risk</div>
    </div>
  );
};
export const LPlan = ({ scene }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const pts = [[0, P('02:39')], [at(scene, 'play'), P('02:39')], [nextOf(scene, 'play') - 4, S.out.t + MIN]];
  const upto = track(f, pts), st = S.setup, R = st.R.toFixed(1);
  const kE = pop(f, fps, at(scene, 'entry'), 20), kS = pop(f, fps, at(scene, 'stop'), 20), kT = pop(f, fps, at(scene, 'target'), 20), kH = pop(f, fps, at(scene, 'hit'), 10);
  const ks = D.candlesAt(TF5, upto), last = ks[ks.length - 1];
  const r = last ? (last.c - st.entry) / (st.entry - st.stop) : 0;
  const playing = f >= at(scene, 'play');
  return (
    <AbsoluteFill>
      <DeskStrip d={D} tf={TF5} upto={upto} />
      <Source />
      <Chart id="l7" d={D} tf={TF5} upto={upto} view={LP}
        under={(g) => (<>
          <Box g={g} t1={st.t} pa={st.entry} pb={st.stop} fill="rgba(220,38,38,0.14)" k={kS} />
          <Box g={g} t1={st.t} pa={st.entry} pb={st.target} fill="rgba(22,163,74,0.13)" k={kT} />
        </>)}
        overlay={(g) => (<>
          <SwingLabels g={g} frame={f} fps={fps} dim={0.3} />
          <HLine g={g} p={st.entry} from={st.t} k={kE} color={C.ink} width={3.5} label={`▶️ ENTRY ${fp(st.entry)}`} labelAt="right" />
          <HLine g={g} p={st.stop} from={st.t} k={kS} color={C.down} width={3.5} label={`🛑 STOP ${fp(st.stop)} · safety net`} labelAt="right" />
          <HLine g={g} p={st.target} from={st.t} k={kT} color={C.up} width={3.5} label={`🎯 TARGET ${fp(st.target)} · top of the move`} labelAt="left" />
          {kS > 0 && <Tag x={g.X(st.t) + 14} y={g.Y((st.entry + st.stop) / 2)} anchor="start" text="risk = 1 step" color={C.down} k={kS} size={20} />}
          {kT > 0 && <Tag x={g.X(st.t) + 14} y={g.Y((st.entry + st.target) / 2)} anchor="start" text={`reward = ${R} steps`} color={C.up} k={kT} size={20} />}
          {playing && last && kH < 0.5 && <Tag x={g.W - 16} y={g.Y(last.c) - 40} anchor="end" text={`${r >= 0 ? '+' : ''}${r.toFixed(1)}R`} color="#fff" bg={r >= 0 ? C.up : C.down} border={r >= 0 ? C.up : C.down} size={24} mono />}
          <Ring x={g.cx(bar(S.out.t))} y={g.Y(st.target)} color={C.up} r={34} k={kH} />
          <Tag x={g.cx(bar(S.out.t)) - 50} y={g.Y(st.target) - 72} anchor="end" text={`🎯 TARGET HIT ${hm(S.out.t)} · +${R}R`} color="#fff" bg={C.up} border={C.up} k={kH} size={30} />
        </>)} />
      <Card step={6} items={[
        { at: at(scene, 'entry'), icon: '▶️', text: 'Entry = where the trigger candle closed' },
        { at: at(scene, 'stop'), icon: '🛑', text: 'Stop = just UNDER the sweep wick (safety net)' },
        { at: at(scene, 'target'), icon: '🎯', text: `Target = top of the move (${R}R)` },
        { at: at(scene, 'play'), icon: '🙌', text: 'Then let it play. Don’t touch!' },
        { at: at(scene, 'hit'), icon: '✅', text: `Target hit: +${R}R` },
      ]} footer={<PlanGrid k={kE} />} />
    </AbsoluteFill>
  );
};

export const LONG_SCENES = { l12: LSwingsBreak, l34: LDiscZone, l56: LSweepTrig, l7: LPlan };
