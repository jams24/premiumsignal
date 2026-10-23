// Stock, ETF, commodity and FX perps that the crypto exchanges list next to the coins, read from the exchange's own
// market labels (the name lists in the scanners miss new listings: UNITREE, a Chinese stock, got a pump signal 23 Oct).
// The pump rules were only backtested on crypto perps, and "no spot market" is always true for a stock.
// Binance: contractType TRADIFI_PERPETUAL (underlyingSubType ['TradFi']). Bybit: symbolType stock / ETF / commodity / forex.
const BYBIT_TRADFI = new Set(['stock', 'etf', 'commodity', 'forex']);

function isTradFiMarket(market) {
  const info = market?.info || {};
  if (info.contractType === 'TRADIFI_PERPETUAL') return true;
  if (Array.isArray(info.underlyingSubType) && info.underlyingSubType.includes('TradFi')) return true;
  return BYBIT_TRADFI.has(String(info.symbolType || '').toLowerCase());
}

module.exports = { isTradFiMarket };
