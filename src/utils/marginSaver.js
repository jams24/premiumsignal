// Margin saver (isolated margin): keep the position size the user chose, but set the exchange leverage as high
// as is safe for this trade's SL, so only about the margin the trade can actually lose is locked.
// Liquidation is kept ~20% beyond the SL distance, so the SL always fires first.

const LIQ_BUFFER = 1.2;  // liquidation distance ≥ 1.2 × SL distance
const MAINT_PCT = 0.6;   // maintenance margin + fees shave ~0.6% off the liquidation distance
const MAX_LEV = 25;

// Approximate liquidation distance (%) for an isolated position at this leverage
function liquidationPct(leverage) {
  return 100 / leverage - MAINT_PCT;
}

// Exchange leverage for an SL `slPct`% away. Never below the chosen leverage (the position is chosen × margin).
function marginSaverLeverage(slPct, { chosen = 1, maxLev = MAX_LEV } = {}) {
  if (!(slPct > 0)) return chosen;
  const safe = Math.floor(100 / (slPct * LIQ_BUFFER + MAINT_PCT));
  return Math.max(chosen, Math.min(safe, maxLev || MAX_LEV, MAX_LEV));
}

module.exports = { marginSaverLeverage, liquidationPct, LIQ_BUFFER, MAINT_PCT };
