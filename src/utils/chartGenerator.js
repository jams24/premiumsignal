const { createCanvas } = require('canvas');
const logger = require('./logger');

const COLORS = {
  bg: '#1a1a2e',
  grid: '#2a2a4a',
  text: '#c0c0d0',
  textDim: '#707090',
  bullish: '#26a69a',
  bearish: '#ef5350',
  wickBull: '#26a69a',
  wickBear: '#ef5350',
  tp: '#4caf50',
  sl: '#f44336',
  entry: '#ffeb3b',
  zone: 'rgba(33, 150, 243, 0.15)',
  zoneBorder: 'rgba(33, 150, 243, 0.5)',
  volume: 'rgba(100, 120, 200, 0.4)',
};

const W = 800;
const H = 500;
const PAD = { top: 40, right: 80, bottom: 60, left: 10 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom - 60; // reserve 60px for volume
const VOL_H = 50;
const VOL_TOP = H - PAD.bottom - VOL_H;

function generateSignalChart(ohlcv, signal) {
  try {
    const candles = ohlcv.slice(-60);
    if (candles.length < 10) return null;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // Price range
    const allPrices = [];
    for (const c of candles) { allPrices.push(c[2], c[3]); }
    if (signal.tp1) allPrices.push(signal.tp1, signal.tp2, signal.tp3, signal.stopLoss);
    if (signal.zonePrice) allPrices.push(signal.zonePrice);

    let priceMin = Math.min(...allPrices);
    let priceMax = Math.max(...allPrices);
    const pricePad = (priceMax - priceMin) * 0.08;
    priceMin -= pricePad;
    priceMax += pricePad;

    const volMax = Math.max(...candles.map(c => c[5])) * 1.2;
    const candleW = CHART_W / candles.length;
    const bodyW = candleW * 0.6;

    const priceToY = (p) => PAD.top + CHART_H - ((p - priceMin) / (priceMax - priceMin)) * CHART_H;
    const idxToX = (i) => PAD.left + i * candleW + candleW / 2;

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    const gridLines = 6;
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (CHART_H / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();

      const price = priceMax - ((priceMax - priceMin) / gridLines) * i;
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), W - PAD.right + 5, y + 3);
    }

    // Zone highlight
    if (signal.zonePrice) {
      const zoneH = signal.smc?.orderBlocks?.[0];
      const zTop = zoneH ? priceToY(Math.max(zoneH.high, zoneH.low)) : priceToY(signal.zonePrice * 1.005);
      const zBot = zoneH ? priceToY(Math.min(zoneH.high, zoneH.low)) : priceToY(signal.zonePrice * 0.995);
      ctx.fillStyle = COLORS.zone;
      ctx.fillRect(PAD.left, Math.min(zTop, zBot), CHART_W, Math.abs(zBot - zTop));
      ctx.strokeStyle = COLORS.zoneBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD.left, Math.min(zTop, zBot), CHART_W, Math.abs(zBot - zTop));
    }

    // Volume bars
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = idxToX(i);
      const vH = (c[5] / volMax) * VOL_H;
      const bull = c[4] >= c[1];
      ctx.fillStyle = bull ? 'rgba(38,166,154,0.3)' : 'rgba(239,83,80,0.3)';
      ctx.fillRect(x - bodyW / 2, VOL_TOP + VOL_H - vH, bodyW, vH);
    }

    // Candlesticks
    for (let i = 0; i < candles.length; i++) {
      const [ts, open, high, low, close] = candles[i];
      const x = idxToX(i);
      const bull = close >= open;

      // Wick
      ctx.strokeStyle = bull ? COLORS.wickBull : COLORS.wickBear;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(high));
      ctx.lineTo(x, priceToY(low));
      ctx.stroke();

      // Body
      const bodyTop = priceToY(Math.max(open, close));
      const bodyBot = priceToY(Math.min(open, close));
      const bodyH = Math.max(bodyBot - bodyTop, 1);
      ctx.fillStyle = bull ? COLORS.bullish : COLORS.bearish;
      ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
    }

    // TP/SL lines
    const drawLevel = (price, label, color, dashed) => {
      if (!price || price <= 0) return;
      const y = priceToY(price);
      if (y < PAD.top - 10 || y > H - PAD.bottom + 10) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${label} ${formatPrice(price)}`, W - PAD.right - 5, y - 4);
    };

    drawLevel(signal.currentPrice, 'ENTRY', COLORS.entry, false);
    drawLevel(signal.tp1, 'TP1', COLORS.tp, true);
    drawLevel(signal.tp2, 'TP2', COLORS.tp, true);
    drawLevel(signal.tp3, 'TP3', COLORS.tp, true);
    drawLevel(signal.stopLoss, 'SL', COLORS.sl, true);

    // Title bar
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    const arrow = signal.direction === 'long' ? '▲' : '▼';
    const dirColor = signal.direction === 'long' ? COLORS.bullish : COLORS.bearish;
    ctx.fillText(`${signal.symbol}/USDT`, PAD.left + 5, 25);

    ctx.fillStyle = dirColor;
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`${arrow} ${signal.direction.toUpperCase()}`, PAD.left + 180, 25);

    ctx.fillStyle = COLORS.text;
    ctx.font = '11px monospace';
    ctx.fillText(`Score: ${signal.score} | ${signal.exchange} | 1H`, PAD.left + 260, 25);

    // Timestamp
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toUTCString().slice(0, -4), W - PAD.right, H - 5);

    // X-axis time labels (every ~10 candles)
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < candles.length; i += Math.max(1, Math.floor(candles.length / 6))) {
      const d = new Date(candles[i][0]);
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
      ctx.fillText(label, idxToX(i), H - PAD.bottom + 15);
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    logger.error(`Chart generation failed: ${err.message}`);
    return null;
  }
}

function formatPrice(p) {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}

module.exports = { generateSignalChart };
