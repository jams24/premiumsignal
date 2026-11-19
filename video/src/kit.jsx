// Building blocks: the desk-style chart, chart overlays, the 🎓 coach card, the desk's top line and the captions.
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { EX, MIN, candlesAt, checklist, fp, hm, S } from './data.js';
import { STEP_TITLES } from './script.js';

export const C = {
  bg: '#ffffff', ink: '#111827', soft: '#4b5563', mute: '#9ca3af', grid: '#eef0f3', line: '#e5e7eb',
  up: '#16a34a', down: '#dc2626', blue: '#2563eb', blueSoft: '#dbeafe', amber: '#f59e0b', violet: '#7c3aed',
};
export const SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Apple Color Emoji", sans-serif';
export const MONO = '"SF Mono", "JetBrains Mono", Menlo, Monaco, monospace';

// 0 → 1 springy pop starting at frame `from`
export const usePop = (from, damping = 13) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return f < from ? 0 : spring({ frame: f - from, fps, config: { damping, mass: 0.7 } });
};
export const pop = (f, fps, from, damping = 13) => (f < from ? 0 : spring({ frame: f - from, fps, config: { damping, mass: 0.7 } }));
export const fade = (f, a, b) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
// piecewise: [[frame, value], ...] → value at frame f (clamped)
export const track = (f, pts) => interpolate(f, pts.map((p) => p[0]), pts.map((p) => p[1]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
export const lerpView = (a, b, k) => ({ t0: a.t0 + (b.t0 - a.t0) * k, t1: a.t1 + (b.t1 - a.t1) * k, p0: a.p0 + (b.p0 - a.p0) * k, p1: a.p1 + (b.p1 - a.p1) * k });

const textW = (s, size, mono) => String(s).length * size * (mono ? 0.61 : 0.56);

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

// ------------------------------------------------------------------ the chart
// view {t0, t1, p0, p1}; tf ms; upto ms (what has printed); overlay(g) / under(g) draw on top / below the candles
export const Chart = ({ id = 'c', x = 30, y = 122, w = 1292, h = 762, tf, upto, view, overlay, under, opacity = 1, scale = 1, candleOpacity = 1 }) => {
  const AX = 98, TX = 36, W = w - AX, H = h - TX;
  const { t0, t1, p0, p1 } = view;
  const X = (t) => ((t - t0) / (t1 - t0)) * W;
  const Y = (p) => ((p1 - p) / (p1 - p0)) * H;
  const slot = (tf / (t1 - t0)) * W, cw = Math.max(3, slot * 0.64);
  const cx = (t) => X(t + tf / 2);
  const ks = candlesAt(tf, upto).filter((k) => k.t + tf > t0 && k.t < t1);
  const step = niceStep((p1 - p0) / 7);
  const pt = []; for (let p = Math.ceil(p0 / step) * step; p <= p1; p += step) pt.push(p);
  const tStep = tf >= 5 * MIN ? 30 * MIN : 10 * MIN;
  const tt = []; for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) tt.push(t);
  const last = ks[ks.length - 1];
  const g = { X, Y, cx, slot, cw, W, H, tf, upto, view };
  return (
    <svg width={w} height={h} style={{ position: 'absolute', left: x, top: y, opacity, transform: `scale(${scale})`, transformOrigin: '60% 50%', overflow: 'visible' }}>
      <defs><clipPath id={`clip-${id}`}><rect x={0} y={-4} width={W} height={H + 8} /></clipPath></defs>
      {pt.map((p) => <line key={'h' + p} x1={0} x2={W} y1={Y(p)} y2={Y(p)} stroke={C.grid} strokeWidth={1.5} />)}
      {tt.map((t) => <line key={'v' + t} x1={X(t)} x2={X(t)} y1={0} y2={H} stroke={C.grid} strokeWidth={1.5} />)}
      <line x1={W} x2={W} y1={0} y2={H} stroke={C.line} strokeWidth={2} />
      <line x1={0} x2={W} y1={H} y2={H} stroke={C.line} strokeWidth={2} />
      <g clipPath={`url(#clip-${id})`}>
        {under && under(g)}
        <g opacity={candleOpacity}>
          {ks.map((k) => {
            const upC = k.c >= k.o, xx = cx(k.t), top = Y(Math.max(k.o, k.c)), bot = Y(Math.min(k.o, k.c));
            return (
              <g key={k.t}>
                <line x1={xx} x2={xx} y1={Y(k.h)} y2={Y(k.l)} stroke={C.ink} strokeWidth={Math.max(1.6, cw * 0.09)} />
                <rect x={xx - cw / 2} y={top} width={cw} height={Math.max(1.6, bot - top)} fill={upC ? '#ffffff' : C.ink} stroke={C.ink} strokeWidth={Math.max(1.6, cw * 0.08)} rx={1} />
              </g>
            );
          })}
        </g>
        {last && <line x1={0} x2={W} y1={Y(last.c)} y2={Y(last.c)} stroke={C.ink} strokeWidth={1.4} strokeDasharray="3 5" opacity={0.65} />}
        {overlay && overlay(g)}
      </g>
      {pt.map((p) => <text key={'pl' + p} x={W + 12} y={Y(p) + 7} fontFamily={MONO} fontSize={20} fill={C.soft}>{fp(p)}</text>)}
      {tt.filter((t) => X(t) > 34 && X(t) < W - 30).map((t) => <text key={'tl' + t} x={X(t)} y={H + 28} textAnchor="middle" fontFamily={MONO} fontSize={20} fontWeight={hm(t).endsWith(':00') ? 700 : 400} fill={C.soft}>{hm(t)}</text>)}
      {last && (
        <g>
          <rect x={W + 2} y={Y(last.c) - 17} width={AX - 4} height={34} rx={4} fill={C.ink} />
          <text x={W + 10} y={Y(last.c) + 7} fontFamily={MONO} fontSize={20} fontWeight={700} fill="#fff">{fp(last.c)}</text>
        </g>
      )}
    </svg>
  );
};

// ------------------------------------------------------------------ overlays (inside the chart's svg)
export const Tag = ({ x, y, text, color = C.ink, bg = '#fff', size = 22, k = 1, anchor = 'middle', mono = false, bold = true, border }) => {
  if (k <= 0.001) return null;
  const tw = textW(text, size, mono) + 22, th = size + 16;
  y = Math.max(th / 2 + 6, y);
  const left = anchor === 'middle' ? x - tw / 2 : anchor === 'end' ? x - tw : x;
  return (
    <g opacity={Math.min(1, k)} transform={`translate(${x} ${y}) scale(${0.6 + 0.4 * k}) translate(${-x} ${-y})`}>
      <rect x={left} y={y - th / 2} width={tw} height={th} rx={th / 2.4} fill={bg} stroke={border || color} strokeWidth={2.4} />
      <text x={left + tw / 2} y={y + size * 0.36} textAnchor="middle" fontFamily={mono ? MONO : SANS} fontSize={size} fontWeight={bold ? 800 : 500} fill={color}>{text}</text>
    </g>
  );
};

export const HLine = ({ g, p, from, to, color, dash, width = 3, k = 1, label, labelAt = 'right', labelColor, labelBg = '#fff', size = 20 }) => {
  if (k <= 0.001) return null;
  const x1 = from != null ? g.X(from) : 0, x2full = to != null ? g.X(to) : g.W, x2 = x1 + (x2full - x1) * Math.min(1, k);
  return (
    <g>
      <line x1={x1} x2={x2} y1={g.Y(p)} y2={g.Y(p)} stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
      {label && <Tag x={labelAt === 'right' ? x2 - 8 : x1 + 8} y={g.Y(p) - 22} anchor={labelAt === 'right' ? 'end' : 'start'} text={label} color={labelColor || color} bg={labelBg} size={size} k={k} />}
    </g>
  );
};

export const Box = ({ g, t1, t2, pa, pb, fill, stroke, k = 1, dash }) => {
  if (k <= 0.001) return null;
  const x1 = g.X(t1), x2 = t2 != null ? g.X(t2) : g.W, y1 = g.Y(Math.max(pa, pb)), y2 = g.Y(Math.min(pa, pb));
  return <rect x={x1} y={y1} width={Math.max(0, (x2 - x1) * Math.min(1, k))} height={y2 - y1} fill={fill} stroke={stroke} strokeWidth={stroke ? 2.5 : 0} strokeDasharray={dash} opacity={Math.min(1, k)} />;
};

// soft highlight behind one candle
export const Glow = ({ g, t, k = 1, color = C.amber, tf }) => {
  if (k <= 0.001) return null;
  const w = (tf || g.tf) / (g.view.t1 - g.view.t0) * g.W;
  return <rect x={g.X(t) - w * 0.15} y={0} width={w * 1.3} height={g.H} fill={color} opacity={0.18 * Math.min(1, k)} rx={6} />;
};

export const Ring = ({ x, y, r = 26, color = C.amber, k = 1 }) => (k <= 0.001 ? null : (
  <circle cx={x} cy={y} r={r * (0.5 + 0.5 * k)} fill="none" stroke={color} strokeWidth={4.5} opacity={Math.min(1, k)} />
));

export const Arrow = ({ x1, y1, x2, y2, color = C.ink, k = 1, width = 4 }) => {
  if (k <= 0.001) return null;
  const xe = x1 + (x2 - x1) * Math.min(1, k), ye = y1 + (y2 - y1) * Math.min(1, k), a = Math.atan2(ye - y1, xe - x1), L = 16;
  return (
    <g stroke={color} strokeWidth={width} strokeLinecap="round" fill="none">
      <line x1={x1} y1={y1} x2={xe} y2={ye} />
      <path d={`M ${xe - L * Math.cos(a - 0.45)} ${ye - L * Math.sin(a - 0.45)} L ${xe} ${ye} L ${xe - L * Math.cos(a + 0.45)} ${ye - L * Math.sin(a + 0.45)}`} />
    </g>
  );
};

// HH / HL / LH / LL labels, each appearing once its swing is confirmed (as on the desk)
export const SwingLabels = ({ g, frame, fps, keep, dim = 1, appearAt = {} }) => (
  <g>
    {S.swings.filter((s) => g.upto >= s.conf && s.t >= g.view.t0 && s.t < g.view.t1).map((s) => {
      const up = /HH|HL/.test(s.label), y = s.side === 'H' ? g.Y(s.p) - 22 : g.Y(s.p) + 38;
      const k = appearAt[s.t] != null ? pop(frame, fps, appearAt[s.t]) : 1;
      const o = keep && !keep.includes(s.t) ? 0.28 : dim;
      return <text key={s.t + s.side} x={g.cx(s.t)} y={y} textAnchor="middle" fontFamily={MONO} fontSize={24} fontWeight={800} fill={up ? C.up : C.down} opacity={o * Math.min(1, k)}>{s.label}</text>;
    })}
  </g>
);

// ------------------------------------------------------------------ the desk's top line (symbol, OHLC, A+ checklist)
export const DeskStrip = ({ tf, upto, showIdea = true, pulse = 0 }) => {
  const ks = candlesAt(tf, upto), k = ks[ks.length - 1] || { o: 0, h: 0, l: 0, c: 0 };
  const list = checklist(upto), idea = showIdea && upto >= S.brk.conf;
  return (
    <div style={{ position: 'absolute', left: 36, top: 22, fontFamily: MONO, fontSize: 23, color: C.ink, lineHeight: 1.55 }}>
      <div><b>{EX.pair} · {tf >= 5 * MIN ? '5m' : '1m'} · Binance</b>
        <span style={{ color: C.soft }}>  O </span>{fp(k.o)}<span style={{ color: C.soft }}> H </span>{fp(k.h)}<span style={{ color: C.soft }}> L </span>{fp(k.l)}<span style={{ color: C.soft }}> C </span>{fp(k.c)}
        <span style={{ color: C.mute }}>   {hm(upto - 1)} UTC</span></div>
      <div style={{ transform: `scale(${1 + 0.06 * pulse})`, transformOrigin: 'left center', minHeight: 36 }}>
        {idea ? (<>
          <span style={{ color: C.down, fontWeight: 700 }}>A+ {EX.side} idea</span><span style={{ color: C.soft }}> since the CHoCH {hm(S.brk.t)} · </span>
          {list.map((x) => <span key={x.k} style={{ color: x.done ? C.up : C.mute, fontWeight: x.done ? 700 : 400, marginRight: 14 }}>{x.done ? '✓' : '○'} {x.k}</span>)}
        </>) : <span style={{ color: C.soft }}>SMC trend <b style={{ color: C.up }}>up</b></span>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ the 🎓 coach card (as on the desk) with kid-size bullets
export const Card = ({ step, items = [], footer, top = 122 }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const shown = items.filter((it) => f >= it.at);
  const cur = shown.length ? shown[shown.length - 1] : null;
  return (
    <div style={{ position: 'absolute', left: 1352, top, width: 538, background: '#fff', border: `2.5px solid #c7d7fe`, borderRadius: 22,
      boxShadow: '0 18px 50px rgba(17,24,39,0.12)', fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px 12px' }}>
        <span style={{ fontSize: 30 }}>🎓</span><b style={{ fontSize: 27, color: C.ink }}>Walk me through</b>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 22, padding: '6px 14px', borderRadius: 10, background: '#f3f4f6', color: C.ink }}>5m</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px 16px' }}>
        {STEP_TITLES.map((t, i) => <i key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < step ? '#93c5fd' : i === step ? C.blue : '#e5e7eb' }} />)}
        <span style={{ fontFamily: MONO, fontSize: 21, color: C.soft, marginLeft: 8 }}>{step + 1}/7</span>
      </div>
      <div style={{ borderTop: `1.5px solid ${C.line}`, padding: '22px 26px 24px' }}>
        <div style={{ fontSize: 33, fontWeight: 800, color: C.ink, marginBottom: 18, lineHeight: 1.2 }}>{step + 1} · {STEP_TITLES[step]}</div>
        {items.map((it, i) => {
          const k = pop(f, fps, it.at, 15);
          if (k <= 0.001) return null;
          const on = it === cur;
          return (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', fontSize: 27, lineHeight: 1.3, color: C.ink, margin: '0 0 14px',
              opacity: Math.min(1, k) * (on ? 1 : 0.62), transform: `translateX(${(1 - k) * 40}px)`, fontWeight: on ? 700 : 500 }}>
              <span style={{ width: 40, flex: 'none', textAlign: 'center' }}>{it.icon}</span><span>{it.text}</span>
            </div>
          );
        })}
        {footer}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ captions: the line being spoken
export const Captions = ({ scene }) => {
  const f = useCurrentFrame();
  const l = scene.lines.filter((x) => f >= x.from - 4).pop();
  if (!l || f > l.next + 2) return null;
  const k = fade(f, l.from - 4, l.from + 5) * (1 - fade(f, l.next - 6, l.next));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', opacity: k }}>
      <div style={{ maxWidth: 1640, background: 'rgba(17,24,39,0.9)', color: '#fff', fontFamily: SANS, fontSize: 40, fontWeight: 600,
        lineHeight: 1.3, padding: '18px 34px', borderRadius: 20, textAlign: 'center', transform: `translateY(${(1 - k) * 12}px)` }}>{l.text}</div>
    </div>
  );
};
