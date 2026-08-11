function formatSignalMessage(signal) {
  const emoji = {
    LISTING: '🆕',
    BREAKOUT: '🚀',
    VOLUME_SPIKE: '📊',
    WHALE_ALERT: '🐋',
    FUNDING_SHORT: '📉',
    NARRATIVE: '🔥',
  };

  const icon = emoji[signal.type] || '📡';
  const leverage = signal.suggestedLeverage ? `\nLeverage: ${signal.suggestedLeverage}x` : '';
  const confidence = '⭐'.repeat(Math.min(signal.confidence, 5));

  return `${icon} <b>${signal.type} SIGNAL</b> ${icon}

<b>Token:</b> $${signal.symbol}
<b>Exchange:</b> ${signal.exchange}
<b>Direction:</b> ${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}
<b>Confidence:</b> ${confidence} (${signal.confidence}/5)

<b>Entry Zone:</b> $${signal.entryLow} - $${signal.entryHigh}
<b>Current Price:</b> $${signal.currentPrice}
<b>TP1:</b> $${signal.tp1} (${signal.tp1Pct}%)
<b>TP2:</b> $${signal.tp2} (${signal.tp2Pct}%)
<b>TP3:</b> $${signal.tp3} (${signal.tp3Pct}%)
<b>Stop Loss:</b> $${signal.stopLoss} (${signal.slPct}%)${leverage}

<b>Catalyst:</b> ${signal.catalyst}
<b>Volume:</b> ${signal.volumeInfo || 'N/A'}

⚠️ <i>DYOR — Not Financial Advice</i>
🕐 ${new Date().toUTCString()}`;
}

function formatListingAlert(listing) {
  return `🆕 <b>NEW LISTING DETECTED</b> 🆕

<b>Token:</b> $${listing.symbol}
<b>Exchange:</b> ${listing.exchange}
<b>Type:</b> ${listing.type} (${listing.marketType || 'spot'})
<b>Detected:</b> ${new Date().toUTCString()}

${listing.details || ''}

⚡ <i>New listings often see 50-500% moves in the first hours. Watch for volume confirmation before entry.</i>`;
}

function formatWhaleAlert(alert) {
  const action = alert.type === 'transfer_in' ? '📥 DEPOSIT' : alert.type === 'transfer_out' ? '📤 WITHDRAWAL' : '🔄 TRANSFER';
  return `🐋 <b>WHALE ${action}</b>

<b>Token:</b> $${alert.symbol}
<b>Amount:</b> ${alert.amount} (${alert.usdValue})
<b>From:</b> <code>${alert.from}</code>
<b>To:</b> <code>${alert.to}</code>
<b>Chain:</b> ${alert.chain}
<b>Tx:</b> <a href="${alert.txUrl}">View</a>

${alert.interpretation || ''}`;
}

function formatScanResult(results) {
  if (!results.length) return '📡 <b>Market Scan</b>\n\nNo breakout candidates found right now.';

  let msg = '📡 <b>MARKET SCAN RESULTS</b>\n\n';
  for (const r of results.slice(0, 10)) {
    const dir = r.direction === 'long' ? '🟢' : '🔴';
    msg += `${dir} <b>$${r.symbol}</b> — ${r.change24h > 0 ? '+' : ''}${r.change24h.toFixed(1)}% | Vol: ${r.volumeRatio.toFixed(1)}x avg | Score: ${r.score}/100\n`;
  }
  msg += '\n⚠️ <i>DYOR — Not Financial Advice</i>';
  return msg;
}

module.exports = { formatSignalMessage, formatListingAlert, formatWhaleAlert, formatScanResult };
