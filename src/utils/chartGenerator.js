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

function generateSetupChart(ohlcv, setupInfo) {
  try {
    const candles = ohlcv.slice(-50);
    if (candles.length < 10) return null;

    // High-res canvas (2x for retina clarity)
    const S = 2;
    const CW = 1200;
    const CH = 800;
    const canvas = createCanvas(CW * S, CH * S);
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);

    const pad = { top: 70, right: 100, bottom: 90, left: 20 };
    const chartW = CW - pad.left - pad.right;
    const chartH = CH - pad.top - pad.bottom - 80;
    const volH = 60;
    const volTop = CH - pad.bottom - volH;

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, CH);
    bgGrad.addColorStop(0, '#0d1117');
    bgGrad.addColorStop(1, '#161b22');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Price range
    const allPrices = [];
    for (const c of candles) { allPrices.push(c[2], c[3]); }
    if (setupInfo.bidWalls) for (const w of setupInfo.bidWalls) allPrices.push(w.price);
    if (setupInfo.askWalls) for (const w of setupInfo.askWalls) allPrices.push(w.price);

    let priceMin = Math.min(...allPrices);
    let priceMax = Math.max(...allPrices);
    const pricePad = (priceMax - priceMin) * 0.1;
    priceMin -= pricePad;
    priceMax += pricePad;

    const volMax = Math.max(...candles.map(c => c[5])) * 1.3 || 1;
    const candleWidth = chartW / candles.length;
    const bodyWidth = Math.max(candleWidth * 0.7, 4);

    const priceToY = (p) => pad.top + chartH - ((p - priceMin) / (priceMax - priceMin)) * chartH;
    const idxToX = (i) => pad.left + i * candleWidth + candleWidth / 2;

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(48, 54, 61, 0.6)';
    ctx.lineWidth = 0.5;
    const gridLines = 8;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(CW - pad.right, y);
      ctx.stroke();
      const price = priceMax - ((priceMax - priceMin) / gridLines) * i;
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), CW - pad.right + 8, y + 4);
    }

    // Support zones (draw before candles for layering)
    for (const w of (setupInfo.bidWalls || []).slice(0, 2)) {
      const y = priceToY(w.price);
      if (y < pad.top || y > CH - pad.bottom) continue;
      const zoneH = 12;
      ctx.fillStyle = 'rgba(38, 166, 154, 0.12)';
      ctx.fillRect(pad.left, y - 2, chartW, zoneH);
      ctx.save();
      ctx.strokeStyle = 'rgba(38, 166, 154, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(CW - pad.right, y);
      ctx.stroke();
      ctx.restore();
      // Label with background pill
      const usd = w.usdValue >= 1e6 ? `$${(w.usdValue / 1e6).toFixed(1)}M` : `$${(w.usdValue / 1e3).toFixed(0)}K`;
      const label = `SUPPORT ${formatPrice(w.price)} (${usd})`;
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(38, 166, 154, 0.25)';
      ctx.beginPath();
      ctx.roundRect(pad.left + 8, y - 18, tw + 12, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#26a69a';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad.left + 14, y - 6);
    }

    // Resistance zones
    for (const w of (setupInfo.askWalls || []).slice(0, 2)) {
      const y = priceToY(w.price);
      if (y < pad.top || y > CH - pad.bottom) continue;
      const zoneH = 12;
      ctx.fillStyle = 'rgba(239, 83, 80, 0.12)';
      ctx.fillRect(pad.left, y - zoneH, chartW, zoneH);
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 83, 80, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(CW - pad.right, y);
      ctx.stroke();
      ctx.restore();
      const usd = w.usdValue >= 1e6 ? `$${(w.usdValue / 1e6).toFixed(1)}M` : `$${(w.usdValue / 1e3).toFixed(0)}K`;
      const label = `RESIST ${formatPrice(w.price)} (${usd})`;
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(239, 83, 80, 0.25)';
      ctx.beginPath();
      ctx.roundRect(pad.left + 8, y + 4, tw + 12, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#ef5350';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad.left + 14, y + 16);
    }

    // Volume bars
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = idxToX(i);
      const vH = (c[5] / volMax) * volH;
      const bull = c[4] >= c[1];
      ctx.fillStyle = bull ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)';
      ctx.fillRect(x - bodyWidth / 2, volTop + volH - vH, bodyWidth, vH);
    }

    // Candlesticks
    for (let i = 0; i < candles.length; i++) {
      const [, open, high, low, close] = candles[i];
      const x = idxToX(i);
      const bull = close >= open;

      // Wick
      ctx.strokeStyle = bull ? '#26a69a' : '#ef5350';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(high));
      ctx.lineTo(x, priceToY(low));
      ctx.stroke();

      // Body
      const bodyTop = priceToY(Math.max(open, close));
      const bodyBot = priceToY(Math.min(open, close));
      const bodyH = Math.max(bodyBot - bodyTop, 2);
      ctx.fillStyle = bull ? '#26a69a' : '#ef5350';
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyH);

      // Body border for extra definition
      ctx.strokeStyle = bull ? '#2bbc8a' : '#ff6b6b';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyH);
    }

    // Current price line + label
    const lastClose = candles[candles.length - 1][4];
    const cpY = priceToY(lastClose);
    ctx.save();
    ctx.strokeStyle = '#f0b90b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, cpY);
    ctx.lineTo(CW - pad.right, cpY);
    ctx.stroke();
    ctx.restore();
    // Price tag on right edge
    ctx.fillStyle = '#f0b90b';
    ctx.beginPath();
    ctx.roundRect(CW - pad.right + 2, cpY - 10, pad.right - 6, 20, 3);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(formatPrice(lastClose), CW - pad.right + pad.right / 2, cpY + 4);

    // === TOP BAR ===
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${setupInfo.symbol}/USDT`, pad.left + 5, 30);

    // Subtitle
    ctx.fillStyle = '#8b949e';
    ctx.font = '13px monospace';
    ctx.fillText(`Setup Snapshot  |  ${(setupInfo.exchange || '').toUpperCase()}  |  1H`, pad.left + 5, 50);

    // Direction + Confidence badge (top right)
    const dir = setupInfo.direction || 'neutral';
    const badgeColor = dir === 'long' ? '#26a69a' : dir === 'short' ? '#ef5350' : '#ffa726';
    const badgeBg = dir === 'long' ? 'rgba(38,166,154,0.2)' : dir === 'short' ? 'rgba(239,83,80,0.2)' : 'rgba(255,167,38,0.2)';
    const badgeText = dir === 'long' ? '▲ LONG BIAS' : dir === 'short' ? '▼ SHORT BIAS' : '● NEUTRAL';
    const conf = setupInfo.confidence || 'low';
    const confIcon = conf === 'high' ? '🔥' : conf === 'medium' ? '⚡' : '👀';

    // Direction pill
    const bW = 160;
    const bH = 30;
    const bX = CW - pad.right - bW;
    ctx.fillStyle = badgeBg;
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bX, 10, bW, bH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = badgeColor;
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, bX + bW / 2, 31);

    // Confidence pill
    const confColor = conf === 'high' ? '#26a69a' : conf === 'medium' ? '#ffa726' : '#8b949e';
    const confBg = conf === 'high' ? 'rgba(38,166,154,0.15)' : conf === 'medium' ? 'rgba(255,167,38,0.15)' : 'rgba(139,148,158,0.15)';
    ctx.fillStyle = confBg;
    ctx.strokeStyle = confColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bX, 44, bW, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = confColor;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${confIcon} CONFIDENCE: ${conf.toUpperCase()}`, bX + bW / 2, 60);

    // === BOTTOM BAR ===
    const bottomY = CH - 40;

    // Order book depth bar
    if (setupInfo.bidDepth && setupInfo.askDepth) {
      const total = setupInfo.bidDepth + setupInfo.askDepth;
      const bidPct = setupInfo.bidDepth / total;
      const barW = 300;
      const barX = pad.left;
      const barH = 16;
      const barY = bottomY - 25;

      ctx.fillStyle = '#21262d';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 4);
      ctx.fill();

      // Bid portion
      ctx.fillStyle = '#26a69a';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW * bidPct, barH, 4);
      ctx.fill();
      // Ask portion
      ctx.fillStyle = '#ef5350';
      ctx.beginPath();
      ctx.roundRect(barX + barW * bidPct, barY, barW * (1 - bidPct), barH, 4);
      ctx.fill();

      // Labels
      ctx.fillStyle = '#c9d1d9';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`BID $${(setupInfo.bidDepth / 1e6).toFixed(1)}M`, barX, barY - 5);
      ctx.textAlign = 'right';
      ctx.fillText(`ASK $${(setupInfo.askDepth / 1e6).toFixed(1)}M`, barX + barW, barY - 5);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${(bidPct * 100).toFixed(0)}%`, barX + barW * bidPct / 2, barY + 12);
      ctx.fillText(`${((1 - bidPct) * 100).toFixed(0)}%`, barX + barW * bidPct + barW * (1 - bidPct) / 2, barY + 12);
    }

    // Liquidation info (right side of bottom bar)
    if (setupInfo.liquidations && setupInfo.liquidations.totalLiqs > 0) {
      const liq = setupInfo.liquidations;
      const liqX = CW - pad.right - 280;
      const liqY = bottomY - 25;
      const longPct = ((liq.longLiqs / liq.totalLiqs) * 100).toFixed(0);

      ctx.fillStyle = '#21262d';
      ctx.beginPath();
      ctx.roundRect(liqX, liqY - 2, 280, 20, 4);
      ctx.fill();

      ctx.fillStyle = '#ffa726';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`LIQS 24H: $${(liq.totalLiqs / 1e6).toFixed(1)}M`, liqX + 8, liqY + 13);
      ctx.fillStyle = '#26a69a';
      ctx.fillText(`L:${longPct}%`, liqX + 180, liqY + 13);
      ctx.fillStyle = '#ef5350';
      ctx.fillText(`S:${100 - longPct}%`, liqX + 230, liqY + 13);
    }

    // Timestamp + branding
    ctx.fillStyle = '#484f58';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toUTCString().slice(0, -4), CW - pad.right, CH - 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#484f58';
    ctx.fillText('premiumsignal', pad.left, CH - 8);

    // X-axis time labels
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.floor(candles.length / 7));
    for (let i = 0; i < candles.length; i += step) {
      const d = new Date(candles[i][0]);
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
      ctx.fillText(label, idxToX(i), CH - pad.bottom + 18);
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    logger.error(`Setup chart generation failed: ${err.message}`);
    return null;
  }
}

module.exports = { generateSignalChart, generateSetupChart };
