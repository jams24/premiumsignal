// Margin saver (isolated margin): keep the position size the user chose, but set the exchange leverage as high
// as is safe for this trade's SL, so only about the margin the trade can actually lose is locked.
// Liquidation is kept ~20% beyond the SL distance, so the SL always fires first.

const LIQ_BUFFER = 1.2;  // liquidation distance ≥ 1.2 × SL distance
const MAINT_PCT = 0.6;   // maintenance margin + fees shave ~0.6% off the liquidation distance (large caps)
const FEE_PCT = 0.2;     // close fee + slippage, added on top of a coin's real maintenance margin
const MAX_LEV = 25;

// Approximate liquidation distance (%) for an isolated position at this leverage.
// `mmrPct` = the coin's real maintenance margin rate (%); without it the large-cap estimate is used.
function liquidationPct(leverage, mmrPct = null) {
  return 100 / leverage - (mmrPct != null ? mmrPct + FEE_PCT : MAINT_PCT);
}

// Exchange leverage for an SL `slPct`% away. Never below the chosen leverage (the position is chosen × margin).
function marginSaverLeverage(slPct, { chosen = 1, maxLev = MAX_LEV } = {}) {
  if (!(slPct > 0)) return chosen;
  const safe = Math.floor(100 / (slPct * LIQ_BUFFER + MAINT_PCT));
  return Math.max(chosen, Math.min(safe, maxLev || MAX_LEV, MAX_LEV));
}

// Highest leverage whose liquidation stays ≥ LIQ_BUFFER × SL away, using the coin's real maintenance margin.
// Small caps run 4–5% maintenance on Binance, so 10x there liquidates at ~−5%, inside a −8% stop (AIN, 26 Oct).
function safeLeverage(slPct, mmrPct) {
  if (!(slPct > 0) || !(mmrPct >= 0)) return null;
  return Math.max(1, Math.floor(100 / (slPct * LIQ_BUFFER + mmrPct + FEE_PCT)));
}

module.exports = { marginSaverLeverage, safeLeverage, liquidationPct, LIQ_BUFFER, MAINT_PCT, FEE_PCT };
