module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal Command</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap">
<style>
:root {
  --bg: #0a0e17; --surface: #111827; --surface2: #1a2235; --border: #1e293b;
  --accent: #10b981; --accent-dim: rgba(16,185,129,0.12);
  --danger: #ef4444; --danger-dim: rgba(239,68,68,0.12);
  --gold: #f59e0b; --gold-dim: rgba(245,158,11,0.1);
  --blue: #3b82f6; --text: #e5e7eb; --text2: #9ca3af; --muted: #6b7280;
  --font-mono: 'JetBrains Mono', monospace; --font-body: 'Inter', system-ui, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }
body { background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 14px; line-height: 1.5; min-height: 100vh; }
.app { max-width: 1200px; margin: 0 auto; padding: 16px; }
.setup-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 100; }
.setup-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; max-width: 400px; width: 100%; }
.setup-card h2 { font-family: var(--font-mono); font-size: 18px; margin-bottom: 4px; }
.setup-card p { color: var(--text2); font-size: 13px; margin-bottom: 20px; }
.setup-card label { display: block; font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
.setup-card input { width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: var(--font-mono); font-size: 13px; margin-bottom: 16px; outline: none; }
.setup-card input:focus { border-color: var(--accent); }
.setup-card button { width: 100%; padding: 10px; background: var(--accent); color: #000; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.logo { font-family: var(--font-mono); font-size: 20px; font-weight: 700; }
.logo span { color: var(--accent); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.status-dot.live { background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: pulse 2s infinite; }
.status-dot.off { background: var(--danger); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.status-label { font-size: 12px; color: var(--text2); font-family: var(--font-mono); }
.btn-sm { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text2); font-size: 12px; font-family: var(--font-mono); cursor: pointer; }
.btn-sm:hover { border-color: var(--accent); color: var(--text); }
.stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 16px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.stat-value { font-family: var(--font-mono); font-size: 22px; font-weight: 700; margin-top: 2px; }
.stat-sub { font-size: 11px; color: var(--text2); margin-top: 2px; font-family: var(--font-mono); }
.stat-value.green { color: var(--accent); } .stat-value.red { color: var(--danger); } .stat-value.gold { color: var(--gold); }

/* Tab nav */
.tab-nav { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab-btn { padding: 10px 20px; border: none; background: none; color: var(--muted); font-family: var(--font-mono); font-size: 13px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-btn:hover { color: var(--text); }
.tab-panel { display: none; } .tab-panel.active { display: block; }

/* Rules banner */
.rules-banner { background: var(--gold-dim); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.rules-banner .rule-title { font-family: var(--font-mono); font-weight: 600; font-size: 13px; color: var(--gold); white-space: nowrap; }
.rules-banner .rule-item { font-size: 12px; color: var(--text2); display: flex; align-items: center; gap: 4px; }
.rules-banner .rule-check { color: var(--accent); font-weight: 700; }
.rules-banner .rule-x { color: var(--danger); font-weight: 700; }

/* Signal cards */
.signals-grid { display: flex; flex-direction: column; gap: 10px; }
.signal-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; transition: border-color 0.2s; }
.signal-card:hover { border-color: var(--accent); }
.signal-card.conviction-high { border-left: 3px solid var(--gold); }
.signal-card.conviction-med { border-left: 3px solid var(--accent); }
.signal-card.conviction-low { border-left: 3px solid var(--muted); }
.signal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; gap: 12px; }
.signal-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.signal-dir { font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
.signal-dir.long { background: var(--accent-dim); color: var(--accent); }
.signal-dir.short { background: var(--danger-dim); color: var(--danger); }
.signal-symbol { font-family: var(--font-mono); font-size: 16px; font-weight: 700; }
.signal-price { font-family: var(--font-mono); font-size: 13px; color: var(--text2); }
.signal-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.conviction-badge { font-family: var(--font-mono); font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px; }
.conviction-badge.high { background: var(--gold-dim); color: var(--gold); border: 1px solid rgba(245,158,11,0.3); }
.conviction-badge.med { background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(16,185,129,0.3); }
.conviction-badge.low { background: rgba(107,114,128,0.1); color: var(--muted); border: 1px solid rgba(107,114,128,0.3); }
.signal-score { font-family: var(--font-mono); font-size: 20px; font-weight: 700; }
.signal-expand { color: var(--muted); font-size: 16px; transition: transform 0.2s; }
.signal-card.expanded .signal-expand { transform: rotate(180deg); }
.signal-body { display: none; padding: 0 16px 16px; }
.signal-card.expanded .signal-body { display: block; }
.signal-pnl { font-family: var(--font-mono); font-size: 13px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.signal-pnl.pos { background: var(--accent-dim); color: var(--accent); }
.signal-pnl.neg { background: var(--danger-dim); color: var(--danger); }

.trade-setup { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
@media (max-width: 600px) { .trade-setup { grid-template-columns: 1fr; } }
.setup-box { background: var(--bg); border-radius: 8px; padding: 12px; }
.setup-box h4 { font-family: var(--font-mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.level-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-family: var(--font-mono); font-size: 13px; }
.level-label { color: var(--text2); } .level-val { font-weight: 600; }
.level-val.tp { color: var(--accent); } .level-val.sl { color: var(--danger); } .level-val.entry { color: var(--gold); }
.rr-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; font-weight: 600; background: var(--accent-dim); color: var(--accent); }
.reasons-grid { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.reason-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: var(--bg); border-radius: 6px; font-size: 13px; }
.reason-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; } .reason-text { flex: 1; }
.reason-text strong { color: var(--text); } .reason-text span { color: var(--text2); }
.indicators-strip { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.ind-chip { font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 4px; background: var(--surface2); color: var(--text2); border: 1px solid var(--border); }
.ind-chip.bull { border-color: rgba(16,185,129,0.3); color: var(--accent); }
.ind-chip.bear { border-color: rgba(239,68,68,0.3); color: var(--danger); }
.ind-chip.warn { border-color: rgba(245,158,11,0.3); color: var(--gold); }
.hist-match { background: var(--gold-dim); border: 1px solid rgba(245,158,11,0.15); border-radius: 8px; padding: 10px 12px; }
.hist-match h4 { font-family: var(--font-mono); font-size: 11px; color: var(--gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.hist-match p { font-size: 12px; color: var(--text2); line-height: 1.6; }
.hist-match .match-stat { font-family: var(--font-mono); font-weight: 600; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
.empty-state .icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }
.empty-state h3 { font-family: var(--font-mono); font-size: 16px; margin-bottom: 6px; color: var(--text2); }
.refresh-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0 2px; }
.refresh-left { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }
.filter-row { display: flex; gap: 6px; }
.filter-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 11px; font-family: var(--font-mono); cursor: pointer; }
.filter-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

/* Sizing config */
.sizing-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; flex-wrap: wrap; }
.sizing-bar .slab { font-family: var(--font-mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-right: 4px; white-space: nowrap; }
.preset-btn { padding: 5px 10px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 12px; font-family: var(--font-mono); cursor: pointer; white-space: nowrap; }
.preset-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.preset-btn:hover { border-color: var(--text2); }
.sizing-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
.sizing-input { width: 80px; padding: 5px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font-family: var(--font-mono); font-size: 12px; text-align: right; outline: none; }
.sizing-input:focus { border-color: var(--accent); }
.sizing-input-label { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.sizing-notional { font-family: var(--font-mono); font-size: 13px; color: var(--accent); font-weight: 600; margin-left: auto; white-space: nowrap; }

/* Trade status badges */
.status-badge { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
.status-badge.active { background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(16,185,129,0.3); }
.status-badge.tp1 { background: var(--gold-dim); color: var(--gold); border: 1px solid rgba(245,158,11,0.3); }
.status-badge.tp2 { background: var(--gold-dim); color: var(--gold); border: 1px solid rgba(245,158,11,0.3); }
.status-badge.played { background: rgba(107,114,128,0.15); color: var(--muted); border: 1px solid rgba(107,114,128,0.3); }
.status-badge.stopped { background: var(--danger-dim); color: var(--danger); border: 1px solid rgba(239,68,68,0.3); }
.status-badge.late { background: rgba(245,158,11,0.08); color: var(--gold); border: 1px solid rgba(245,158,11,0.2); }
.tp-progress { display: flex; gap: 4px; align-items: center; margin-bottom: 12px; }
.tp-step { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 11px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); }
.tp-step.hit { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.tp-step.blown { border-color: var(--danger); color: var(--danger); background: var(--danger-dim); }

/* Education section */
.edu-section { margin-bottom: 20px; }
.edu-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
.edu-header { padding: 14px 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; }
.edu-header h3 { font-family: var(--font-mono); font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.edu-body { display: none; padding: 0 16px 16px; }
.edu-card.open .edu-body { display: block; }
.edu-card.open .edu-arrow { transform: rotate(180deg); }
.edu-arrow { color: var(--muted); transition: transform 0.2s; }
.edu-term { margin-bottom: 16px; }
.edu-term h4 { font-family: var(--font-mono); font-size: 13px; color: var(--accent); margin-bottom: 4px; }
.edu-term .what { font-size: 13px; color: var(--text); margin-bottom: 4px; line-height: 1.6; }
.edu-term .how { font-size: 12px; color: var(--text2); line-height: 1.6; padding: 8px 10px; background: var(--bg); border-radius: 6px; margin-top: 4px; }
.edu-term .example { font-size: 12px; color: var(--gold); font-family: var(--font-mono); margin-top: 6px; padding: 6px 10px; background: var(--gold-dim); border-radius: 6px; border-left: 3px solid var(--gold); }
.edu-divider { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
</style>
</head>
<body>
<div id="setup-overlay" class="setup-overlay">
  <div class="setup-card">
    <h2>Signal Command</h2>
    <p>Enter your dashboard API key to access live signals.</p>
    <label>Dashboard Key</label>
    <input type="password" id="cfg-key" placeholder="Your DASHBOARD_KEY from .env">
    <button onclick="saveConfig()">Connect</button>
  </div>
</div>

<div class="app" id="main-app" hidden>
  <div class="header">
    <div class="header-left">
      <div class="logo">Signal<span>Command</span></div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="status-dot" id="status-dot"></div>
        <span class="status-label" id="status-label">Connecting...</span>
      </div>
    </div>
    <div class="header-right">
      <button class="btn-sm" onclick="refreshAll()">Refresh</button>
      <button class="btn-sm" onclick="resetConfig()">Logout</button>
    </div>
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('signals',this)">Live Signals</button>
    <button class="tab-btn" onclick="switchTab('learn',this)">Learn Onchain</button>
  </div>

  <!-- SIGNALS TAB -->
  <div class="tab-panel active" id="tab-signals">
    <div class="sizing-bar" id="sizing-bar">
      <span class="slab">Sizing</span>
      <button class="preset-btn" data-m="100" data-l="5" onclick="applyPreset(this)">$100 / 5x</button>
      <button class="preset-btn" data-m="500" data-l="10" onclick="applyPreset(this)">$500 / 10x</button>
      <button class="preset-btn" data-m="1000" data-l="10" onclick="applyPreset(this)">$1K / 10x</button>
      <button class="preset-btn" data-m="2000" data-l="20" onclick="applyPreset(this)">$2K / 20x</button>
      <button class="preset-btn" data-m="5000" data-l="20" onclick="applyPreset(this)">$5K / 20x</button>
      <div class="sizing-sep"></div>
      <span class="sizing-input-label">Margin $</span>
      <input class="sizing-input" id="custom-margin" type="number" min="10" step="10" onchange="applyCustom()">
      <span class="sizing-input-label">Lev</span>
      <input class="sizing-input" id="custom-lev" type="number" min="1" max="125" step="1" style="width:50px" onchange="applyCustom()">
      <span class="sizing-input-label">x</span>
      <span class="sizing-notional" id="notional-display"></span>
    </div>
    <div class="stats-bar" id="stats-bar"></div>
    <div class="rules-banner">
      <span class="rule-title">Conviction Rules</span>
      <span class="rule-item"><span class="rule-check">+</span> Score 70+ with funding aligned</span>
      <span class="rule-item"><span class="rule-check">+</span> Short alerts 12-18 UTC = 77% win</span>
      <span class="rule-item"><span class="rule-check">+</span> OI spike 20%+ with direction</span>
      <span class="rule-item"><span class="rule-x">-</span> Funding against direction</span>
      <span class="rule-item"><span class="rule-x">-</span> Hold 45-90 min for best results</span>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;font-family:var(--font-mono);padding:0 2px;">Signals = onchain alerts detected by scanner. P&L = simulated profit if you entered at alert price. Not live bot trades.</div>
    <div class="refresh-bar">
      <span class="refresh-left" id="refresh-timer">Updated just now</span>
      <div class="filter-row">
        <button class="filter-btn active" data-filter="high" onclick="setFilter(this)">High Only</button>
        <button class="filter-btn" data-filter="all" onclick="setFilter(this)">All Signals</button>
        <button class="filter-btn" data-filter="short" onclick="setFilter(this)">Shorts</button>
        <button class="filter-btn" data-filter="long" onclick="setFilter(this)">Longs</button>
      </div>
    </div>
    <div class="signals-grid" id="signals-grid"></div>
  </div>

  <!-- LEARN TAB -->
  <div class="tab-panel" id="tab-learn">
    <div class="edu-section">

      <div class="edu-card open">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>\\ud83d\\udcda Core Concepts</h3><span class="edu-arrow">\\u25bc</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>Open Interest (OI)</h4>
            <div class="what">The total number of open futures/perp contracts that haven't been closed yet. Think of it as how many people are currently sitting at the poker table with money on the line.</div>
            <div class="how"><strong>OI Rising + Price Rising</strong> = New money entering long positions. The move has fuel behind it.<br><strong>OI Rising + Price Falling</strong> = New short positions opening. Bears are piling in.<br><strong>OI Falling + Price Moving</strong> = People are closing positions. The move is running out of steam.</div>
            <div class="example">Our data: OI spike >20% in 4h on short alerts = 72% accuracy. When OI spikes while price dumps, smart money is actively betting against the token.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Funding Rate</h4>
            <div class="what">A fee that longs pay to shorts (positive funding) or shorts pay to longs (negative funding) every 8 hours. It keeps the futures price anchored to spot price. Think of it as which side of the trade is more crowded.</div>
            <div class="how"><strong>Positive funding (0.01%+)</strong> = More people are long. Longs are paying shorts to stay in their position. Market is crowded long.<br><strong>Negative funding (-0.01% or less)</strong> = More people are short. Shorts are paying longs. Market is crowded short.<br><strong>Extreme funding (above 0.1% or below -0.1%)</strong> = Extremely crowded. A squeeze is very likely.</div>
            <div class="example">Our data: When funding bias MATCHES signal direction (e.g. short signal + negative funding), accuracy jumps. When it OPPOSES direction, accuracy drops to ~30%.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Short Squeeze</h4>
            <div class="what">When price suddenly pumps and forces short sellers to buy back their positions to cut losses, which pushes price even higher in a chain reaction. It's like a stampede for the exit.</div>
            <div class="how"><strong>How to spot one forming:</strong><br>1. Funding rate is deeply negative (crowded shorts)<br>2. OI is high and rising (lots of shorts opened)<br>3. Price starts moving up despite heavy shorts<br>4. Liquidations cascade \\u2014 one short getting liquidated pushes price up, liquidating the next<br><br><strong>Arslan's method:</strong> Check if retail is crowded short (L/S ratio below 0.85) while top traders are long (ratio above 1.50). That divergence is the squeeze setup.</div>
            <div class="example">BTW example: Shorts got trapped as price pushed from $0.60 to $0.80. The squeeze continued until whale supply hit the exchange hot wallet, crashing price to $0.54.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Long Squeeze</h4>
            <div class="what">The opposite of a short squeeze. Price dumps suddenly, forcing leveraged long positions to close (get liquidated), which pushes price down even more.</div>
            <div class="how"><strong>How to spot one forming:</strong><br>1. Funding rate is highly positive (crowded longs)<br>2. OI is elevated (lots of leveraged longs)<br>3. A whale deposits tokens to an exchange (incoming sell pressure)<br>4. One big sell triggers a cascade of long liquidations</div>
            <div class="example">LSK example: Price pumped from $0.13 to $1.65, then crashed 53% to $0.38. Score 91 short signals fired as overleveraged longs got wiped out.</div>
          </div>

        </div>
      </div>

      <div class="edu-card">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>\\ud83d\\udd17 Exchange Flow (Whale Tracking)</h3><span class="edu-arrow">\\u25bc</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>Exchange Outflow (Bullish Signal)</h4>
            <div class="what">Tokens are being withdrawn FROM exchanges to personal wallets. This means someone is taking tokens OFF the market \\u2014 they're not planning to sell soon. This reduces the available supply on exchanges.</div>
            <div class="how"><strong>Why it matters:</strong> If a whale withdraws 500K tokens worth $350K from Binance to a cold wallet, that's $350K of sell pressure REMOVED from the market. Less supply available = price goes up easier.<br><br><strong>What Arslan checks:</strong> Follow where the tokens go. If they end up in a self-custody address that keeps the balance, it's real accumulation. If the receiving wallet sends tokens somewhere else shortly after, it might just be a pass-through router.</div>
            <div class="example">Our flow bias "bullish" = net outflow detected. Tokens leaving exchanges faster than entering. Accumulation is happening.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Exchange Inflow (Bearish Signal)</h4>
            <div class="what">Tokens are being deposited INTO exchanges from personal wallets. This means someone is moving tokens TO the market \\u2014 they're likely preparing to sell. This increases available supply.</div>
            <div class="how"><strong>Critical detail from Arslan:</strong> A deposit arriving at an exchange DEPOSIT ADDRESS doesn't mean it's immediately for sale. Watch whether those deposits get swept into the exchange's MAIN HOT WALLET.<br><br>\\u2022 Deposit sitting in deposit address = supply queued but not yet active<br>\\u2022 Deposit swept to hot wallet = supply is NOW on the order book, ready to dump<br><br>This timing difference can be the difference between a squeeze continuing and a sudden crash.</div>
            <div class="example">BTW case: 15.6M tokens ($11.9M) were swept into Gate hot wallet in 9 batches. Price instantly crashed from $0.80 to $0.54. The deposits had been sitting in deposit addresses, and the moment they hit the hot wallet, they were dumped.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Hot Wallet vs Cold Wallet</h4>
            <div class="what"><strong>Hot wallet:</strong> An exchange's active wallet connected to the internet, used for daily trading. Tokens here are liquid and can be sold immediately.<br><strong>Cold wallet:</strong> Offline storage for long-term holding. Tokens here are locked away and not available for quick selling.</div>
            <div class="how"><strong>Whale tracking flow:</strong><br>1. Cold wallet \\u2192 Hot wallet = Preparing to sell (bearish)<br>2. Hot wallet \\u2192 Self-custody = Accumulating (bullish)<br>3. Exchange deposit address \\u2192 Hot wallet = Supply about to hit market (dump incoming)<br>4. Multiple wallets \\u2192 One wallet = Consolidation, whale building a position</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Pass-Through / Router Wallet</h4>
            <div class="what">A wallet that receives tokens from an exchange and then quickly sends them to another address. It goes back to near-zero balance. This is NOT the final destination \\u2014 the whale is routing tokens through intermediate wallets to hide their trail.</div>
            <div class="how"><strong>How to trace:</strong><br>1. See big withdrawal from exchange to Wallet A<br>2. Wallet A sends everything to Wallet B within hours<br>3. Wallet A goes back to ~$0 balance<br>4. Follow Wallet B \\u2014 THAT's the actual holding wallet<br>5. Map all these routes to calculate the whale's real cost basis</div>
          </div>

        </div>
      </div>

      <div class="edu-card">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>\\ud83c\\udfaf Arslan's Execution Framework</h3><span class="edu-arrow">\\u25bc</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>The 5-Step Confirmation Chain</h4>
            <div class="what">Never trade just because you found a big wallet or a single signal. Build the full thesis first:</div>
            <div class="how">
              <strong>Step 1: On-Chain Flow</strong> \\u2014 Are tokens flowing OUT of exchanges (bullish) or INTO exchanges (bearish)?<br><br>
              <strong>Step 2: Exchange Activity</strong> \\u2014 Has the supply actually reached the hot wallet? Or is it still sitting in deposit addresses?<br><br>
              <strong>Step 3: Cost Basis</strong> \\u2014 Where did the whale actually enter? Map withdrawals, OTC moves, and proxy wallets to find their average entry price. If price is far above their cost basis and tokens move to exchange, they're taking profit.<br><br>
              <strong>Step 4: Liquidity Setup</strong> \\u2014 Check the derivatives: Is funding extreme? Is OI elevated? Are retail traders on the wrong side? Is there a liquidation cascade waiting to trigger?<br><br>
              <strong>Step 5: Price Structure</strong> \\u2014 Is there a clean entry? Look for the liquidity sweep (quick flush below support to wipe stops), then a V-shape recovery with a higher low. That's your floor.
            </div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>The Liquidity Sweep & Reclaim</h4>
            <div class="what">Before a real move, market makers often push price down quickly to trigger stop losses of early longs and grab liquidity below support. If price immediately bounces back (V-shape) and forms a higher low, weak hands are cleared out.</div>
            <div class="how"><strong>How to trade it:</strong><br>1. Wait for the sweep (quick wick below support)<br>2. Watch for immediate recovery above the sweep level<br>3. Enter on the consolidation base that forms after the bounce<br>4. Place stop below the sweep low \\u2014 tight and structural<br>5. Never chase the initial vertical green candle</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>L/S Ratio Divergence (Retail Trap)</h4>
            <div class="what">The Long/Short ratio shows how many traders are long vs short. The key is comparing RETAIL positions vs TOP TRADER positions.</div>
            <div class="how"><strong>The classic squeeze setup:</strong><br>\\u2022 Overall retail L/S ratio drops below 0.85 (retail is crowded short)<br>\\u2022 Top Trader L/S ratio sits above 1.50 (smart money is stacked long)<br>\\u2022 Retail keeps trying to short the top while big accounts absorb every sell<br>\\u2022 Result: A violent squeeze upward as retail shorts get liquidated<br><br><strong>The reverse works too:</strong><br>\\u2022 Retail L/S above 2.0 (everyone is long) + Top traders below 0.7 = dump incoming</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>OI vs Spot Volume (Real vs Fake Moves)</h4>
            <div class="what">A sustainable breakout needs real spot buying behind it. If Open Interest surges but spot volume is dead, the move is pure leverage and will collapse violently.</div>
            <div class="how"><strong>Real breakout:</strong> Spot volume expanding + OI rising = Both leverage AND real buying. The move has legs.<br><br><strong>Fake breakout (leverage trap):</strong> OI surging + flat/low spot volume = Only leveraged positions driving the move. One big candle in the other direction wipes everyone out.<br><br><strong>Rule:</strong> Never chase a pump that only shows in futures. Check spot volume first.</div>
          </div>

        </div>
      </div>

      <div class="edu-card">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>\\ud83d\\udcca Our Historical Data Insights</h3><span class="edu-arrow">\\u25bc</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>What Our Data Shows (From Real Signals)</h4>
            <div class="how">
              <strong>Best Setup:</strong> Score 80+ short alert during 12-18 UTC with funding aligned = 87.5% accuracy<br><br>
              <strong>Simulated P&L ($2K margin, 20x):</strong><br>
              \\u2022 Score 70+ SHORTS: +$23,408 total in 1-4h exits (6 trades, avg 9.75% move)<br>
              \\u2022 Score 70+ LONGS: -$4,604 in 1-4h BUT +$15,890 in 4-12h (longs need patience)<br><br>
              <strong>Optimal Hold Time:</strong><br>
              \\u2022 0-15 min holds: 29% win rate, -$111 total (too early to exit)<br>
              \\u2022 45-90 min holds: 83% win rate, +$39 total (sweet spot)<br>
              \\u2022 Manual closes avg 20 min hold = $14 avg profit (best exit type)<br><br>
              <strong>What Kills Trades:</strong><br>
              \\u2022 20x leverage = highest loss rate (max_loss hits at -$27 avg)<br>
              \\u2022 Funding AGAINST direction = ~30% accuracy (don't fight it)<br>
              \\u2022 Long signals at 00-06 UTC = 40% accuracy (dead hours)
            </div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Invalidation Signals (When to Exit)</h4>
            <div class="how">
              <strong>Exit immediately if:</strong><br>
              \\u2022 OI drops >20% after your entry (positions are unwinding, the move is done)<br>
              \\u2022 Funding flips against your direction mid-trade<br>
              \\u2022 Exchange flow reverses (you're long but sudden massive inflow detected)<br>
              \\u2022 Score drops below 40 on follow-up scans<br><br>
              <strong>Hold if:</strong><br>
              \\u2022 Funding stays aligned with your direction<br>
              \\u2022 OI continues rising (the move has more fuel)<br>
              \\u2022 Exchange flow confirms (outflow for longs, inflow for shorts)<br>
              \\u2022 Price forms a higher low (long) or lower high (short) on 15m chart
            </div>
          </div>

        </div>
      </div>

    </div>
  </div>
</div>

<script>
var MARGIN = 2000, LEVERAGE = 20, NOTIONAL = 40000;

function loadSizing() {
  try {
    var s = JSON.parse(localStorage.getItem('sc_sizing'));
    if (s && s.m > 0 && s.l > 0) { MARGIN = s.m; LEVERAGE = s.l; }
  } catch(e) {}
  NOTIONAL = MARGIN * LEVERAGE;
}
function saveSizing() {
  localStorage.setItem('sc_sizing', JSON.stringify({ m: MARGIN, l: LEVERAGE }));
  NOTIONAL = MARGIN * LEVERAGE;
}
function updateSizingUI() {
  document.getElementById('custom-margin').value = MARGIN;
  document.getElementById('custom-lev').value = LEVERAGE;
  document.getElementById('notional-display').textContent = '$' + NOTIONAL.toLocaleString() + ' notional';
  document.querySelectorAll('.preset-btn').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.m) === MARGIN && parseInt(b.dataset.l) === LEVERAGE);
  });
}
function applyPreset(btn) {
  MARGIN = parseInt(btn.dataset.m); LEVERAGE = parseInt(btn.dataset.l);
  saveSizing(); updateSizingUI(); renderStats(); renderSignals();
}
function applyCustom() {
  var m = parseInt(document.getElementById('custom-margin').value) || 100;
  var l = parseInt(document.getElementById('custom-lev').value) || 5;
  if (m < 10) m = 10; if (l < 1) l = 1; if (l > 125) l = 125;
  MARGIN = m; LEVERAGE = l;
  saveSizing(); updateSizingUI(); renderStats(); renderSignals();
}

var PATTERN_RULES = {
  short_high_score: { label: 'High-score shorts', accuracy: 87.5, desc: 'Score 80+ shorts hit 87.5% of the time' },
  short_12_18: { label: 'EU/US session short', accuracy: 76.9, desc: 'Shorts 12-18 UTC have 77% accuracy' },
  long_18_24: { label: 'Late session long', accuracy: 81.8, desc: 'Longs 18-24 UTC have 82% accuracy' },
  funding_aligned: { label: 'Funding aligned', accuracy: 65, desc: 'Funding matching direction improves win rate' },
  oi_spike: { label: 'OI spike', accuracy: 72.2, desc: 'Short + OI 4h >20% = 72% accuracy' },
  funding_against: { label: 'Funding against', accuracy: 30, desc: 'Funding opposing direction = ~30% accuracy', negative: true },
};

var apiKey = '', signals = [], patterns = {}, trades = {}, currentFilter = 'high', lastUpdate = 0, refreshInterval;

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

function init() {
  loadSizing();
  var saved = localStorage.getItem('sc_key');
  if (saved) {
    apiKey = saved;
    document.getElementById('setup-overlay').hidden = true;
    document.getElementById('main-app').hidden = false;
    updateSizingUI();
    refreshAll();
    refreshInterval = setInterval(refreshAll, 300000);
    setInterval(updateTimer, 10000);
  }
}

function saveConfig() {
  var key = document.getElementById('cfg-key').value.trim();
  if (!key) return;
  apiKey = key;
  localStorage.setItem('sc_key', key);
  document.getElementById('setup-overlay').hidden = true;
  document.getElementById('main-app').hidden = false;
  updateSizingUI();
  refreshAll();
  refreshInterval = setInterval(refreshAll, 300000);
  setInterval(updateTimer, 10000);
}

function resetConfig() {
  localStorage.removeItem('sc_key');
  apiKey = '';
  clearInterval(refreshInterval);
  document.getElementById('setup-overlay').hidden = false;
  document.getElementById('main-app').hidden = true;
}

function apiFetch(path, params) {
  params = params || {};
  params.key = apiKey;
  var qs = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return fetch(path + '?' + qs).then(function(r) {
    if (!r.ok) throw new Error('API ' + r.status);
    return r.json();
  });
}

function refreshAll() {
  var dot = document.getElementById('status-dot');
  var label = document.getElementById('status-label');
  Promise.all([
    apiFetch('/api/signals', { hours: 24, minScore: 30 }),
    apiFetch('/api/patterns'),
    apiFetch('/api/trades'),
  ]).then(function(results) {
    signals = results[0].signals || [];
    patterns = results[1].patterns || [];
    trades = results[2];
    dot.className = 'status-dot live';
    label.textContent = 'Live \\u2014 ' + signals.length + ' signals';
    lastUpdate = Date.now();
    renderStats();
    renderSignals();
  }).catch(function(e) {
    dot.className = 'status-dot off';
    label.textContent = 'Error: ' + e.message;
  });
}

function updateTimer() {
  if (!lastUpdate) return;
  var ago = Math.floor((Date.now() - lastUpdate) / 1000);
  var el = document.getElementById('refresh-timer');
  if (ago < 10) el.textContent = 'Updated just now';
  else if (ago < 60) el.textContent = 'Updated ' + ago + 's ago';
  else el.textContent = 'Updated ' + Math.floor(ago / 60) + 'm ago';
}

function renderStats() {
  var bar = document.getElementById('stats-bar');
  var shortPat = patterns.find(function(p) { return p.direction === 'short'; }) || {};
  var longPat = patterns.find(function(p) { return p.direction === 'long'; }) || {};
  var shortAcc = shortPat.with_data > 0 ? ((parseInt(shortPat.correct) / parseInt(shortPat.with_data)) * 100).toFixed(0) : '\\u2014';
  var longAcc = longPat.with_data > 0 ? ((parseInt(longPat.correct) / parseInt(longPat.with_data)) * 100).toFixed(0) : '\\u2014';
  var shortHS = parseInt(shortPat.high_score_total) > 0 ? ((parseInt(shortPat.high_score_correct) / parseInt(shortPat.high_score_total)) * 100).toFixed(0) : '\\u2014';
  var totalPnl = (trades.closed || []).reduce(function(s, t) { return s + (parseFloat(t.pnl_usd) || 0); }, 0);
  var openCount = (trades.open || []).length;
  var highConv = signals.filter(function(s) { return getConviction(s) === 'high'; }).length;

  bar.innerHTML =
    '<div class="stat-card"><div class="stat-label">High Conviction</div><div class="stat-value gold">' + highConv + '</div><div class="stat-sub">' + signals.length + ' total signals</div></div>' +
    '<div class="stat-card"><div class="stat-label">Short Acc (60+)</div><div class="stat-value green">' + shortAcc + '%</div><div class="stat-sub">' + (shortPat.correct || 0) + '/' + (shortPat.with_data || 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Short 80+</div><div class="stat-value green">' + shortHS + '%</div><div class="stat-sub">' + (shortPat.high_score_correct || 0) + '/' + (shortPat.high_score_total || 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Long Acc (60+)</div><div class="stat-value ' + (parseInt(longAcc) >= 50 ? 'green' : 'red') + '">' + longAcc + '%</div><div class="stat-sub">' + (longPat.correct || 0) + '/' + (longPat.with_data || 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Bot P&L</div><div class="stat-value ' + (totalPnl >= 0 ? 'green' : 'red') + '">$' + totalPnl.toFixed(0) + '</div><div class="stat-sub">' + (trades.closed || []).length + ' trades</div></div>';
}

function getConviction(s) {
  var score = parseInt(s.score) || 0;
  var dir = s.direction;
  var fundAligned = s.funding_bias === dir;
  var fundAgainst = s.funding_bias && s.funding_bias !== dir;
  var hour = new Date(s.created_at).getUTCHours();
  var oiSpike = Math.abs(parseFloat(s.oi_4h) || 0) > 20;
  if (fundAgainst && dir === 'long' && s.funding_bias === 'short' && score < 75) return 'low';
  if (score >= 80 && fundAligned) return 'high';
  if (score >= 70 && fundAligned && oiSpike) return 'high';
  if (dir === 'short' && score >= 75 && hour >= 12 && hour < 18) return 'high';
  if (dir === 'long' && score >= 70 && fundAligned && hour >= 18) return 'high';
  if (score >= 60 && fundAligned) return 'med';
  if (score >= 70) return 'med';
  return 'low';
}

function getMatchedPatterns(s) {
  var matched = [];
  var dir = s.direction, score = parseInt(s.score) || 0;
  var hour = new Date(s.created_at).getUTCHours();
  var fundAligned = s.funding_bias === dir;
  var fundAgainst = s.funding_bias && s.funding_bias !== dir;
  var oiSpike = Math.abs(parseFloat(s.oi_4h) || 0) > 20;
  if (dir === 'short' && score >= 80) matched.push('short_high_score');
  if (dir === 'short' && hour >= 12 && hour < 18) matched.push('short_12_18');
  if (dir === 'long' && hour >= 18) matched.push('long_18_24');
  if (fundAligned) matched.push('funding_aligned');
  if (oiSpike && dir === 'short') matched.push('oi_spike');
  if (fundAgainst) matched.push('funding_against');
  return matched;
}

function fmtPrice(p) {
  var n = parseFloat(p);
  if (isNaN(n)) return '$0';
  if (n >= 100) return '$' + n.toFixed(2);
  if (n >= 1) return '$' + n.toFixed(4);
  if (n >= 0.01) return '$' + n.toFixed(5);
  return '$' + n.toPrecision(4);
}

function calcLevels(s) {
  var price = parseFloat(s.price), dir = s.direction, atrEst = price * 0.03;
  var sl, tp1, tp2, tp3;
  if (dir === 'long') { sl = price - atrEst * 2; tp1 = price + atrEst * 1.5; tp2 = price + atrEst * 3; tp3 = price + atrEst * 5; }
  else { sl = price + atrEst * 2; tp1 = price - atrEst * 1.5; tp2 = price - atrEst * 3; tp3 = price - atrEst * 5; }
  var risk = Math.abs(price - sl), reward = Math.abs(tp2 - price);
  return { sl: sl, tp1: tp1, tp2: tp2, tp3: tp3, rr: risk > 0 ? (reward / risk).toFixed(1) : '\\u2014' };
}

function getTradeStatus(s, levels) {
  var entry = parseFloat(s.price), dir = s.direction;
  var pc = parseFloat(s.price_change) || 0;
  var now = entry * (1 + pc / 100);
  var hitTP1 = false, hitTP2 = false, hitTP3 = false, hitSL = false;
  if (dir === 'long') {
    hitTP1 = now >= levels.tp1; hitTP2 = now >= levels.tp2; hitTP3 = now >= levels.tp3;
    hitSL = now <= levels.sl;
  } else {
    hitTP1 = now <= levels.tp1; hitTP2 = now <= levels.tp2; hitTP3 = now <= levels.tp3;
    hitSL = now >= levels.sl;
  }
  var movePct = dir === 'short' ? -pc : pc;
  var status, css, tip;
  if (hitSL) { status = 'STOPPED OUT'; css = 'stopped'; tip = 'Price reversed past SL \\u2014 do NOT enter'; }
  else if (hitTP3) { status = 'PLAYED OUT'; css = 'played'; tip = 'Already hit TP3 \\u2014 move is done'; }
  else if (hitTP2) { status = 'TP2 HIT'; css = 'tp2'; tip = 'Already past TP2 \\u2014 most profit taken, late entry risky'; }
  else if (hitTP1) { status = 'TP1 HIT'; css = 'tp1'; tip = 'Past TP1 \\u2014 can still run but tighten SL to entry'; }
  else if (movePct > 3) { status = 'LATE ENTRY'; css = 'late'; tip = 'Already moved ' + movePct.toFixed(1) + '% \\u2014 smaller R:R if entering now'; }
  else { status = 'ACTIVE'; css = 'active'; tip = 'Setup valid \\u2014 price near entry zone'; }
  return { status: status, css: css, tip: tip, hitTP1: hitTP1, hitTP2: hitTP2, hitTP3: hitTP3, hitSL: hitSL, currentPrice: now };
}

function simPnl(s) {
  var priceChg = parseFloat(s.price_change) || 0;
  var dir = s.direction;
  var movePct = dir === 'short' ? -priceChg : priceChg;
  if (dir === 'short') movePct = Math.abs(priceChg);
  else movePct = priceChg;
  var pnl = (movePct / 100) * NOTIONAL;
  return { pnl: pnl, pct: movePct };
}

function buildReasons(s) {
  var reasons = [];
  var dir = s.direction, score = parseInt(s.score) || 0;
  var oi4h = parseFloat(s.oi_4h) || 0, oi1h = parseFloat(s.oi_1h) || 0;
  var priceChg = parseFloat(s.price_change) || 0, fundRate = parseFloat(s.funding_rate) || 0;
  var fundBias = s.funding_bias, flowBias = s.flow_bias;
  var hour = new Date(s.created_at).getUTCHours();

  if (score >= 80) reasons.push({ icon: '\\ud83d\\udd25', text: '<strong>Very high score (' + score + ')</strong> \\u2014 <span>' + (dir === 'short' ? '87.5% historical accuracy on 80+ shorts' : 'Multiple onchain signals converging') + '</span>' });
  else if (score >= 60) reasons.push({ icon: '\\u26a1', text: '<strong>Strong score (' + score + ')</strong> \\u2014 <span>Multiple signals converging</span>' });

  if (fundBias === dir) reasons.push({ icon: '\\u2705', text: '<strong>Funding aligned ' + dir + '</strong> \\u2014 <span>' + (fundRate * 100).toFixed(3) + '% \\u2014 smart money confirms direction</span>' });
  else if (fundBias && fundBias !== dir) reasons.push({ icon: '\\u26a0\\ufe0f', text: '<strong>Funding OPPOSES direction</strong> \\u2014 <span>Funding is ' + fundBias + ' but signal is ' + dir + ' \\u2014 drops accuracy to ~30%</span>' });

  if (Math.abs(oi4h) > 20) {
    var oiDir = oi4h > 0 ? 'rising' : 'falling';
    reasons.push({ icon: oi4h > 0 ? '\\ud83d\\udcc8' : '\\ud83d\\udcc9', text: '<strong>OI ' + oiDir + ' ' + Math.abs(oi4h).toFixed(1) + '% (4h)</strong> \\u2014 <span>' + (oi4h > 0 ? 'New positions opening aggressively' : 'Positions unwinding \\u2014 squeeze or reversal') + '</span>' });
  }

  if (flowBias === 'bullish') reasons.push({ icon: '\\ud83d\\udfe2', text: '<strong>Exchange outflow (bullish)</strong> \\u2014 <span>Tokens leaving exchanges = accumulation, sell pressure reduced</span>' });
  else if (flowBias === 'bearish') reasons.push({ icon: '\\ud83d\\udd34', text: '<strong>Exchange inflow (bearish)</strong> \\u2014 <span>Tokens entering exchanges = distribution, sell pressure increasing</span>' });

  if (Math.abs(priceChg) > 20) reasons.push({ icon: priceChg > 0 ? '\\ud83d\\ude80' : '\\ud83d\\udc80', text: '<strong>Price ' + (priceChg > 0 ? '+' : '') + priceChg.toFixed(1) + '% move</strong> \\u2014 <span>' + (Math.abs(priceChg) > 40 ? 'Extreme \\u2014 potential exhaustion' : 'Significant momentum') + '</span>' });

  if (dir === 'short' && hour >= 12 && hour < 18) reasons.push({ icon: '\\ud83d\\udd50', text: '<strong>EU/US overlap (12-18 UTC)</strong> \\u2014 <span>77% accuracy for shorts in this window</span>' });
  else if (dir === 'long' && hour >= 18) reasons.push({ icon: '\\ud83d\\udd50', text: '<strong>Late session (18-24 UTC)</strong> \\u2014 <span>82% accuracy for longs</span>' });

  if (Math.abs(oi1h) > 15) reasons.push({ icon: '\\u23f1\\ufe0f', text: '<strong>1h OI spike ' + (oi1h > 0 ? '+' : '') + oi1h.toFixed(1) + '%</strong> \\u2014 <span>Rapid position buildup \\u2014 immediate momentum</span>' });

  reasons.push({ icon: '\\u23f3', text: '<strong>Optimal hold: 45-90 min</strong> \\u2014 <span>83% win rate in this window vs 29% for 0-15 min exits. Don\\'t exit too early.</span>' });

  return reasons;
}

function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderSignals();
}

function toggleCard(id) { document.getElementById(id).classList.toggle('expanded'); }

function renderSignals() {
  var grid = document.getElementById('signals-grid');
  var filtered = signals.map(function(s) { return Object.assign({}, s, { conviction: getConviction(s) }); });

  if (currentFilter === 'high') filtered = filtered.filter(function(s) { return s.conviction === 'high'; });
  else if (currentFilter === 'short') filtered = filtered.filter(function(s) { return s.direction === 'short'; });
  else if (currentFilter === 'long') filtered = filtered.filter(function(s) { return s.direction === 'long'; });

  filtered.sort(function(a, b) {
    var order = { high: 0, med: 1, low: 2 };
    if (order[a.conviction] !== order[b.conviction]) return order[a.conviction] - order[b.conviction];
    return (parseInt(b.score) || 0) - (parseInt(a.score) || 0);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><div class="icon">\\ud83d\\udce1</div><h3>No ' + (currentFilter === 'high' ? 'high conviction ' : '') + 'signals right now</h3><p>Scanner checks every 5 min. ' + (currentFilter === 'high' ? 'Try "All Signals" for lower conviction.' : '') + '</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(function(s, i) {
    var id = 'sig-' + i, conv = s.conviction, levels = calcLevels(s), reasons = buildReasons(s);
    var matched = getMatchedPatterns(s);
    var positiveMatches = matched.filter(function(m) { return !PATTERN_RULES[m].negative; });
    var negativeMatches = matched.filter(function(m) { return PATTERN_RULES[m].negative; });
    var dt = new Date(s.created_at);
    var timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    var agoMin = Math.floor((Date.now() - dt.getTime()) / 60000);
    var agoStr = agoMin < 60 ? agoMin + 'm ago' : Math.floor(agoMin / 60) + 'h ' + (agoMin % 60) + 'm ago';
    var sim = simPnl(s);
    var pnlClass = sim.pnl >= 0 ? 'pos' : 'neg';
    var pnlSign = sim.pnl >= 0 ? '+' : '';
    var ts = getTradeStatus(s, levels);

    var html = '<div class="signal-card conviction-' + conv + '" id="' + id + '">';
    html += '<div class="signal-header" onclick="toggleCard(\\'' + id + '\\')">';
    html += '<div class="signal-left">';
    html += '<span class="signal-dir ' + s.direction + '">' + s.direction + '</span>';
    html += '<span class="status-badge ' + ts.css + '">' + ts.status + '</span>';
    html += '<span class="signal-symbol">' + s.symbol + '</span>';
    html += '<span class="signal-price">' + fmtPrice(s.price) + ' \\u2192 ' + fmtPrice(ts.currentPrice) + ' \\u00b7 ' + agoStr + '</span>';
    html += '</div><div class="signal-right">';
    html += '<span class="signal-pnl ' + pnlClass + '">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span>';
    html += '<span class="conviction-badge ' + conv + '">' + (conv === 'high' ? 'HIGH' : conv === 'med' ? 'MED' : 'LOW') + '</span>';
    html += '<span class="signal-score">' + (parseInt(s.score) || 0) + '</span>';
    html += '<span class="signal-expand">\\u25bc</span>';
    html += '</div></div>';

    html += '<div class="signal-body">';

    html += '<div class="indicators-strip">';
    var _fr = parseFloat(s.funding_rate) || 0;
    var _oi4 = parseFloat(s.oi_4h) || 0;
    var _oi1 = parseFloat(s.oi_1h) || 0;
    var _pc = parseFloat(s.price_change) || 0;
    html += '<span class="ind-chip ' + (s.funding_bias === s.direction ? 'bull' : s.funding_bias ? 'bear' : '') + '">Fund: ' + (s.funding_bias || 'neutral') + ' ' + (_fr ? (_fr * 100).toFixed(3) + '%' : '') + '</span>';
    html += '<span class="ind-chip ' + (_oi4 > 15 ? 'warn' : '') + '">OI 4h: ' + (_oi4 ? (_oi4 > 0 ? '+' : '') + _oi4.toFixed(1) + '%' : '\\u2014') + '</span>';
    html += '<span class="ind-chip ' + (_oi1 > 10 ? 'warn' : '') + '">OI 1h: ' + (_oi1 ? (_oi1 > 0 ? '+' : '') + _oi1.toFixed(1) + '%' : '\\u2014') + '</span>';
    html += '<span class="ind-chip ' + (s.flow_bias === 'bullish' ? 'bull' : s.flow_bias === 'bearish' ? 'bear' : '') + '">Flow: ' + (s.flow_bias || '\\u2014') + '</span>';
    html += '<span class="ind-chip ' + (Math.abs(_pc) > 20 ? 'warn' : '') + '">Price: ' + (_pc ? (_pc > 0 ? '+' : '') + _pc.toFixed(1) + '%' : '\\u2014') + '</span>';
    html += '</div>';

    html += '<div class="tp-progress">';
    html += '<span class="tp-step ' + (ts.css === 'active' ? 'hit' : '') + '">Entry ' + fmtPrice(s.price) + '</span>';
    html += '<span style="color:var(--muted)">\\u2192</span>';
    html += '<span class="tp-step ' + (ts.hitTP1 ? 'hit' : '') + '">TP1 ' + fmtPrice(levels.tp1) + '</span>';
    html += '<span style="color:var(--muted)">\\u2192</span>';
    html += '<span class="tp-step ' + (ts.hitTP2 ? 'hit' : '') + '">TP2 ' + fmtPrice(levels.tp2) + '</span>';
    html += '<span style="color:var(--muted)">\\u2192</span>';
    html += '<span class="tp-step ' + (ts.hitTP3 ? 'hit' : '') + '">TP3 ' + fmtPrice(levels.tp3) + '</span>';
    html += '<span style="color:var(--muted);margin-left:4px">|</span>';
    html += '<span class="tp-step ' + (ts.hitSL ? 'blown' : '') + '">SL ' + fmtPrice(levels.sl) + '</span>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;font-family:var(--font-mono);padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + (ts.css === 'active' ? 'var(--accent)' : ts.css === 'stopped' ? 'var(--danger)' : 'var(--gold)') + '">' + ts.tip + ' \\u2014 Now: ' + fmtPrice(ts.currentPrice) + '</div>';

    html += '<div class="trade-setup"><div class="setup-box"><h4>Trade Levels ($' + MARGIN + ' @ ' + LEVERAGE + 'x)</h4>';
    html += '<div class="level-row"><span class="level-label">Entry</span><span class="level-val entry">' + fmtPrice(s.price) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Stop Loss</span><span class="level-val sl">' + fmtPrice(levels.sl) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP1 (+4.5%)</span><span class="level-val tp">' + fmtPrice(levels.tp1) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP2 (+9%)</span><span class="level-val tp">' + fmtPrice(levels.tp2) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP3 (+15%)</span><span class="level-val tp">' + fmtPrice(levels.tp3) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">R:R</span><span class="rr-badge">' + levels.rr + ':1</span></div>';
    html += '</div><div class="setup-box"><h4>If You Entered ($' + MARGIN + ' @ ' + LEVERAGE + 'x)</h4>';
    var tp1Pnl = NOTIONAL * 0.045, tp2Pnl = NOTIONAL * 0.09, tp3Pnl = NOTIONAL * 0.15;
    var slPnl = NOTIONAL * 0.06;
    html += '<div class="level-row"><span class="level-label">If TP1 hit</span><span class="level-val tp">+$' + tp1Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If TP2 hit</span><span class="level-val tp">+$' + tp2Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If TP3 hit</span><span class="level-val tp">+$' + tp3Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If SL hit</span><span class="level-val sl">-$' + slPnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Current Move P&L</span><span class="level-val ' + (sim.pnl >= 0 ? 'tp' : 'sl') + '">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Hold Target</span><span class="level-val">45-90 min</span></div>';
    html += '</div></div>';

    html += '<div class="reasons-grid">';
    reasons.forEach(function(r) { html += '<div class="reason-row"><span class="reason-icon">' + r.icon + '</span><span class="reason-text">' + r.text + '</span></div>'; });
    html += '</div>';

    if (positiveMatches.length || negativeMatches.length) {
      html += '<div class="hist-match"><h4>Historical Pattern Match</h4><p>';
      positiveMatches.forEach(function(m) { html += '<span class="match-stat" style="color:var(--accent)">\\u2713 ' + PATTERN_RULES[m].label + ' (' + PATTERN_RULES[m].accuracy + '%)</span> \\u2014 ' + PATTERN_RULES[m].desc + '<br>'; });
      negativeMatches.forEach(function(m) { html += '<span class="match-stat" style="color:var(--danger)">\\u2717 ' + PATTERN_RULES[m].label + ' (~' + PATTERN_RULES[m].accuracy + '%)</span> \\u2014 ' + PATTERN_RULES[m].desc + '<br>'; });
      html += '</p></div>';
    }

    html += '</div></div>';
    return html;
  }).join('');
}

init();
</script>
</body>
</html>`;
