module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal Command</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap">
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
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

.trade-setup { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 14px; }
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
.score-filter-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
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
.status-badge.stale { background: rgba(107,114,128,0.15); color: var(--muted); border: 1px solid rgba(107,114,128,0.3); }
.status-badge.late { background: rgba(245,158,11,0.08); color: var(--gold); border: 1px solid rgba(245,158,11,0.2); }
.tp-progress { display: flex; gap: 4px; align-items: center; margin-bottom: 12px; }
.tp-step { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 11px; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg); color: var(--muted); }
.tp-step.hit { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.tp-step.blown { border-color: var(--danger); color: var(--danger); background: var(--danger-dim); }

/* Chart section */
.chart-section { margin-bottom: 14px; }
.chart-tf-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
.chart-tf-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 11px; font-family: var(--font-mono); cursor: pointer; font-weight: 600; }
.chart-tf-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
.chart-container { width: 100%; height: 400px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: #131722; position: relative; transition: height 0.3s; }
.chart-container.expanded { height: 600px; }
.chart-expand-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 11px; font-family: var(--font-mono); cursor: pointer; }
.chart-expand-btn:hover { border-color: var(--text2); color: var(--text2); }
.chart-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); font-family: var(--font-mono); font-size: 12px; z-index: 2; }
.chart-legend { display: flex; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
.chart-legend-item { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10px; color: var(--text2); }
.chart-legend-dot { width: 8px; height: 2px; border-radius: 1px; }
.chart-verdict { margin-top: 8px; padding: 10px 12px; border-radius: 6px; font-size: 12px; line-height: 1.6; border: 1px solid var(--border); background: var(--surface2); }

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

/* Morning Roster */
.roster-panel { display:none; margin-bottom:16px; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:18px 16px; }
.roster-panel.open { display:block; }
.roster-title { font-family:var(--font-mono); font-size:15px; font-weight:700; color:var(--text); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
.roster-section { margin-bottom:16px; }
.roster-section:last-child { margin-bottom:0; }
.roster-section h4 { font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px; }
.roster-item { display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--text2); line-height:1.7; margin-bottom:2px; }
.roster-item .ri-icon { flex-shrink:0; font-size:14px; width:20px; text-align:center; }
.roster-badge { display:inline-block; padding:1px 6px; border-radius:4px; font-family:var(--font-mono); font-size:11px; font-weight:600; }
.rb-green { background:var(--green-dim); color:var(--green); }
.rb-red { background:rgba(239,68,68,0.15); color:#ef4444; }
.rb-gold { background:var(--gold-dim); color:var(--gold); }
.rb-blue { background:rgba(59,130,246,0.15); color:#3b82f6; }
.roster-stat { font-family:var(--font-mono); font-weight:600; }
.roster-divider { border:none; border-top:1px solid var(--border); margin:14px 0; }
.roster-btn { padding:5px 12px; border-radius:5px; border:1px solid var(--gold); background:var(--gold-dim); color:var(--gold); font-size:12px; font-family:var(--font-mono); cursor:pointer; font-weight:600; }
.roster-btn:hover { background:var(--gold); color:var(--bg); }

/* Jotter */
.jotter { margin-top:16px; }
.jotter-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.jotter-header h4 { font-family:var(--font-mono); font-size:12px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.06em; }
.jotter-add-row { display:flex; gap:6px; margin-bottom:10px; }
.jotter-input { flex:1; padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); font-family:var(--font-mono); font-size:12px; outline:none; }
.jotter-input:focus { border-color:var(--accent); }
.jotter-input::placeholder { color:var(--muted); }
.jotter-type-btn { padding:6px 10px; border-radius:5px; border:1px solid var(--border); background:transparent; color:var(--text2); font-size:11px; font-family:var(--font-mono); cursor:pointer; font-weight:600; white-space:nowrap; }
.jotter-type-btn.active { border-color:var(--accent); color:var(--accent); background:var(--accent-dim); }
.jotter-type-btn:hover { border-color:var(--text2); }
.jotter-add-btn { padding:6px 14px; border-radius:5px; border:none; background:var(--accent); color:var(--bg); font-size:12px; font-family:var(--font-mono); cursor:pointer; font-weight:700; }
.jotter-add-btn:hover { opacity:0.85; }
.jotter-list { list-style:none; padding:0; margin:0; }
.jotter-item { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:6px; margin-bottom:6px; font-size:12px; font-family:var(--font-mono); color:var(--text2); line-height:1.5; }
.jotter-item.done { opacity:0.45; }
.jotter-item.done .jotter-text { text-decoration:line-through; }
.jotter-check { flex-shrink:0; width:16px; height:16px; border-radius:4px; border:1.5px solid var(--border); background:transparent; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; margin-top:1px; color:var(--green); font-size:11px; }
.jotter-item.done .jotter-check { border-color:var(--green); background:var(--green-dim); }
.jotter-tag { flex-shrink:0; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600; }
.jotter-tag.watch { background:rgba(59,130,246,0.15); color:#3b82f6; }
.jotter-tag.note { background:var(--gold-dim); color:var(--gold); }
.jotter-tag.todo { background:rgba(168,85,247,0.15); color:#a855f7; }
.jotter-text { flex:1; word-break:break-word; }
.jotter-time { flex-shrink:0; font-size:10px; color:var(--muted); }
.jotter-del { flex-shrink:0; background:none; border:none; color:var(--muted); cursor:pointer; font-size:14px; padding:0 2px; line-height:1; }
.jotter-del:hover { color:var(--danger); }
.jotter-coin-row { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
.jotter-coin-btn { padding:3px 8px; border-radius:4px; border:1px solid var(--border); background:transparent; color:var(--text2); font-size:11px; font-family:var(--font-mono); cursor:pointer; }
.jotter-coin-btn:hover { border-color:var(--accent); color:var(--accent); }
.jotter-empty { font-size:12px; color:var(--muted); text-align:center; padding:16px 0; }
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
      <input class="sizing-input" id="custom-margin" type="number" min="10" step="10" oninput="applyCustom()">
      <span class="sizing-input-label">Lev</span>
      <input class="sizing-input" id="custom-lev" type="number" min="1" max="125" step="1" style="width:50px" oninput="applyCustom()">
      <span class="sizing-input-label">x</span>
      <div class="sizing-sep"></div>
      <span class="sizing-input-label">Risk $</span>
      <input class="sizing-input" id="custom-risk" type="number" min="1" step="5" placeholder="50" style="width:70px" oninput="applyRisk()">
      <span class="sizing-notional" id="notional-display"></span>
    </div>
    <div class="stats-bar" id="stats-bar"></div>
    <div class="score-filter-bar" id="score-filter-bar">
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-right:8px">SCORE</span>
      <button class="preset-btn active" data-score="0" onclick="setScoreFilter(this)">All</button>
      <button class="preset-btn" data-score="35" onclick="setScoreFilter(this)">35+</button>
      <button class="preset-btn" data-score="45" onclick="setScoreFilter(this)">45+</button>
      <button class="preset-btn" data-score="55" onclick="setScoreFilter(this)">55+</button>
      <button class="preset-btn" data-score="65" onclick="setScoreFilter(this)">65+</button>
      <button class="preset-btn" data-score="75" onclick="setScoreFilter(this)">75+</button>
    </div>
    <div class="rules-banner">
      <span class="rule-title">Conviction Rules</span>
      <span class="rule-item"><span class="rule-check">+</span> Score 70+ with funding aligned</span>
      <span class="rule-item"><span class="rule-check">+</span> Short alerts 12-18 UTC (1-7 PM WAT) = 77% win</span>
      <span class="rule-item"><span class="rule-check">+</span> OI spike 20%+ with direction</span>
      <span class="rule-item"><span class="rule-x">-</span> Funding against direction</span>
      <span class="rule-item"><span class="rule-x">-</span> Hold 45-90 min for best results</span>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;font-family:var(--font-mono);padding:0 2px;">Signals = onchain alerts detected by scanner. P&L = simulated profit if you entered at alert price. Not live bot trades.</div>
    <div class="refresh-bar">
      <span class="refresh-left" id="refresh-timer">Updated just now</span>
      <div class="filter-row">
        <button class="roster-btn" onclick="toggleRoster()">Morning Roster</button>
        <button class="filter-btn" data-filter="active" onclick="setFilter(this)">Enterable</button>
        <button class="filter-btn active" data-filter="high" onclick="setFilter(this)">High Only</button>
        <button class="filter-btn" data-filter="all" onclick="setFilter(this)">All</button>
        <button class="filter-btn" data-filter="profit" onclick="setFilter(this)">In Profit</button>
        <button class="filter-btn" data-filter="short" onclick="setFilter(this)">Shorts</button>
        <button class="filter-btn" data-filter="long" onclick="setFilter(this)">Longs</button>
      </div>
    </div>
    <div class="roster-panel" id="roster-panel">
      <div class="roster-title">DAILY TRADING ROSTER</div>

      <div class="roster-section">
        <h4>Pre-Trade Checklist (Do This Every Morning)</h4>
        <div class="roster-item"><span class="ri-icon">1.</span> Open dashboard at <span class="roster-badge rb-gold">7:00 AM WAT</span> &mdash; check overnight signals, note any that hit TP while you slept</div>
        <div class="roster-item"><span class="ri-icon">2.</span> Set score filter to <span class="roster-badge rb-green">55+</span> &mdash; your sweet spot is score 55-64 (65% win rate, +$112 total)</div>
        <div class="roster-item"><span class="ri-icon">3.</span> Check <span class="roster-badge rb-blue">DEMAND ZONE</span> signals first &mdash; they have 62% win rate vs 48% for main scanner</div>
        <div class="roster-item"><span class="ri-icon">4.</span> Confirm funding is <b>not against</b> your direction &mdash; skip INVALID signals</div>
        <div class="roster-item"><span class="ri-icon">5.</span> Check 4H chart trend aligns with signal direction before entering</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Best Trading Windows (WAT) &mdash; Based on 393 Trades</h4>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">1:00 AM WAT</span> &mdash; 69% win rate, +$23.70 &mdash; overnight US session close momentum</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">6:00 AM WAT</span> &mdash; 75% win rate, +$9.40 &mdash; early morning before Asia close</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">9:00 AM WAT</span> &mdash; 62% win rate, +$8.59 &mdash; London open momentum</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">1:00 PM WAT</span> &mdash; 58% win rate, +$51.49 &mdash; US pre-market, highest avg P&L</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">2:00 PM WAT</span> &mdash; 56% win rate, +$30.59 &mdash; US market open</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">3:00 PM WAT</span> &mdash; 67% win rate, +$14.42 &mdash; US session strong start</div>
        <div class="roster-item"><span class="ri-icon">&#9733;</span> <span class="roster-badge rb-green">9:00 PM WAT</span> &mdash; 50% WR but +$93.23 total &mdash; biggest winners come from here</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Danger Zones &mdash; Avoid or Size Down</h4>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> <span class="roster-badge rb-red">4:00 AM WAT</span> &mdash; 46% WR, -$30 total &mdash; low liquidity dead hour</div>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> <span class="roster-badge rb-red">5:00 PM WAT</span> &mdash; 31% WR, -$34 total &mdash; worst win rate of any hour</div>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> <span class="roster-badge rb-red">6:00 PM WAT</span> &mdash; 23% WR, -$63 total &mdash; absolute worst hour, SKIP trades here</div>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> <span class="roster-badge rb-red">7:00 AM WAT</span> &mdash; 48% WR, -$29 total &mdash; choppy open, wait for 8-9 AM</div>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> <span class="roster-badge rb-red">Weekends</span> &mdash; 48% WR, -$97 total vs weekdays +$17 &mdash; reduce size or skip</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Score Rules &mdash; What the Data Says</h4>
        <div class="roster-item"><span class="ri-icon">&#10003;</span> Score <span class="roster-badge rb-green">55-64</span> &mdash; <b>Best band:</b> 65% win rate, +$1.50 avg, +$112 total from 75 trades</div>
        <div class="roster-item"><span class="ri-icon">&#10003;</span> Score <span class="roster-badge rb-green">65-74</span> &mdash; Good: 58% WR, +$1.23 avg, 12 trades</div>
        <div class="roster-item"><span class="ri-icon">&#9888;</span> Score <span class="roster-badge rb-red">75+</span> &mdash; Trap! Only 27% WR, -$2.85 avg &mdash; often late entries after pump</div>
        <div class="roster-item"><span class="ri-icon">&#10005;</span> Score <span class="roster-badge rb-red">Below 45</span> &mdash; Skip: 45% WR, -$0.60 avg, -$137 total</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Trade Management Rules</h4>
        <div class="roster-item"><span class="ri-icon">1.</span> <b>Size:</b> Use the sizing bar above. Never risk more than you can lose today ($10 daily limit)</div>
        <div class="roster-item"><span class="ri-icon">2.</span> <b>Entries:</b> Only enter LONG signals &mdash; 52% WR vs shorts 49% and more volume</div>
        <div class="roster-item"><span class="ri-icon">3.</span> <b>Source priority:</b> Demand Zone &gt; Main scanner &gt; Onchain (DZ: 62% WR, +$222 total)</div>
        <div class="roster-item"><span class="ri-icon">4.</span> <b>Max loss exit:</b> Biggest P&L drain is max_loss exits (-$585 from 54 trades). If a trade is losing, close manually before $6 cap hits</div>
        <div class="roster-item"><span class="ri-icon">5.</span> <b>Take partials:</b> At TP1, take 33%. Don't get greedy waiting for TP3+</div>
        <div class="roster-item"><span class="ri-icon">6.</span> <b>STALE signals:</b> If signal is 6h+ old and hasn't moved, skip it &mdash; momentum is gone</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Your Daily Schedule (WAT)</h4>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>6:00-7:00 AM</b> &mdash; Wake up scan. Check overnight winners. DZ signals here are 86% WR</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>8:00-10:00 AM</b> &mdash; London session. Good for entries (58-62% WR). Set score filter 55+</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>12:00 PM</b> &mdash; <span class="roster-badge rb-red">SKIP</span> Worst lunch hour (28% WR). Do not enter trades</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>1:00-3:00 PM</b> &mdash; <span class="roster-badge rb-green">PRIME TIME</span> US open. Best P&L window. Focus here</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>5:00-6:00 PM</b> &mdash; <span class="roster-badge rb-red">DANGER</span> Worst hours (23-31% WR). Close and walk away</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>9:00 PM</b> &mdash; Final check. DZ signals at this hour are your biggest winners (+$125)</div>
        <div class="roster-item"><span class="ri-icon">&#9203;</span> <b>10:00 PM+</b> &mdash; Set alerts, don't enter new trades. Night hours are inconsistent</div>
      </div>

      <hr class="roster-divider">

      <div class="roster-section">
        <h4>Golden Rule</h4>
        <div class="roster-item" style="font-size:14px;color:var(--gold);font-weight:600"><span class="ri-icon">&#9733;</span> Score 55-64 + Demand Zone + 1-3 PM WAT = your highest edge combo. Prioritize these setups above everything else.</div>
      </div>

      <hr class="roster-divider">

      <div class="jotter" id="jotter">
        <div class="jotter-header">
          <h4>Jotter &mdash; Watchlist &amp; Notes</h4>
          <button class="jotter-del" onclick="clearDoneJotter()" title="Clear completed">&times; Clear done</button>
        </div>
        <div class="jotter-coin-row" id="jotter-coins"></div>
        <div class="jotter-add-row">
          <div style="display:flex;gap:4px">
            <button class="jotter-type-btn active" data-type="watch" onclick="setJotterType(this)">Watch</button>
            <button class="jotter-type-btn" data-type="note" onclick="setJotterType(this)">Note</button>
            <button class="jotter-type-btn" data-type="todo" onclick="setJotterType(this)">To-do</button>
          </div>
          <input class="jotter-input" id="jotter-input" type="text" placeholder="e.g. Watch AIN for retest at $0.15..." onkeydown="if(event.key==='Enter')addJotter()">
          <button class="jotter-add-btn" onclick="addJotter()">Add</button>
        </div>
        <ul class="jotter-list" id="jotter-list"></ul>
      </div>
    </div>
    <div class="signals-grid" id="signals-grid"></div>
    <div id="flow-section" hidden>
      <div style="margin-top:16px;padding:8px 0;border-top:1px solid var(--border)">
        <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px">Raw Flow & Supply Alerts</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-family:var(--font-mono)">Early detection signals from exchange flow and supply moves. No score — use as confirmation alongside scored signals.</div>
      </div>
      <div class="signals-grid" id="flow-grid"></div>
    </div>
  </div>

  <!-- LEARN TAB -->
  <div class="tab-panel" id="tab-learn">
    <div class="edu-section">

      <div class="edu-card open">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>📚 Core Concepts</h3><span class="edu-arrow">▼</span>
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
            <div class="how"><strong>How to spot one forming:</strong><br>1. Funding rate is deeply negative (crowded shorts)<br>2. OI is high and rising (lots of shorts opened)<br>3. Price starts moving up despite heavy shorts<br>4. Liquidations cascade — one short getting liquidated pushes price up, liquidating the next<br><br><strong>Arslan's method:</strong> Check if retail is crowded short (L/S ratio below 0.85) while top traders are long (ratio above 1.50). That divergence is the squeeze setup.</div>
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
          <h3>🔗 Exchange Flow (Whale Tracking)</h3><span class="edu-arrow">▼</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>Exchange Outflow (Bullish Signal)</h4>
            <div class="what">Tokens are being withdrawn FROM exchanges to personal wallets. This means someone is taking tokens OFF the market — they're not planning to sell soon. This reduces the available supply on exchanges.</div>
            <div class="how"><strong>Why it matters:</strong> If a whale withdraws 500K tokens worth $350K from Binance to a cold wallet, that's $350K of sell pressure REMOVED from the market. Less supply available = price goes up easier.<br><br><strong>What Arslan checks:</strong> Follow where the tokens go. If they end up in a self-custody address that keeps the balance, it's real accumulation. If the receiving wallet sends tokens somewhere else shortly after, it might just be a pass-through router.</div>
            <div class="example">Our flow bias "bullish" = net outflow detected. Tokens leaving exchanges faster than entering. Accumulation is happening.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Exchange Inflow (Bearish Signal)</h4>
            <div class="what">Tokens are being deposited INTO exchanges from personal wallets. This means someone is moving tokens TO the market — they're likely preparing to sell. This increases available supply.</div>
            <div class="how"><strong>Critical detail from Arslan:</strong> A deposit arriving at an exchange DEPOSIT ADDRESS doesn't mean it's immediately for sale. Watch whether those deposits get swept into the exchange's MAIN HOT WALLET.<br><br>• Deposit sitting in deposit address = supply queued but not yet active<br>• Deposit swept to hot wallet = supply is NOW on the order book, ready to dump<br><br>This timing difference can be the difference between a squeeze continuing and a sudden crash.</div>
            <div class="example">BTW case: 15.6M tokens ($11.9M) were swept into Gate hot wallet in 9 batches. Price instantly crashed from $0.80 to $0.54. The deposits had been sitting in deposit addresses, and the moment they hit the hot wallet, they were dumped.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Hot Wallet vs Cold Wallet</h4>
            <div class="what"><strong>Hot wallet:</strong> An exchange's active wallet connected to the internet, used for daily trading. Tokens here are liquid and can be sold immediately.<br><strong>Cold wallet:</strong> Offline storage for long-term holding. Tokens here are locked away and not available for quick selling.</div>
            <div class="how"><strong>Whale tracking flow:</strong><br>1. Cold wallet → Hot wallet = Preparing to sell (bearish)<br>2. Hot wallet → Self-custody = Accumulating (bullish)<br>3. Exchange deposit address → Hot wallet = Supply about to hit market (dump incoming)<br>4. Multiple wallets → One wallet = Consolidation, whale building a position</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Pass-Through / Router Wallet</h4>
            <div class="what">A wallet that receives tokens from an exchange and then quickly sends them to another address. It goes back to near-zero balance. This is NOT the final destination — the whale is routing tokens through intermediate wallets to hide their trail.</div>
            <div class="how"><strong>How to trace:</strong><br>1. See big withdrawal from exchange to Wallet A<br>2. Wallet A sends everything to Wallet B within hours<br>3. Wallet A goes back to ~$0 balance<br>4. Follow Wallet B — THAT's the actual holding wallet<br>5. Map all these routes to calculate the whale's real cost basis</div>
          </div>

        </div>
      </div>

      <div class="edu-card">
        <div class="edu-header" onclick="this.parentElement.classList.toggle('open')">
          <h3>🎯 Arslan's Execution Framework</h3><span class="edu-arrow">▼</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>The 5-Step Confirmation Chain</h4>
            <div class="what">Never trade just because you found a big wallet or a single signal. Build the full thesis first:</div>
            <div class="how">
              <strong>Step 1: On-Chain Flow</strong> — Are tokens flowing OUT of exchanges (bullish) or INTO exchanges (bearish)?<br><br>
              <strong>Step 2: Exchange Activity</strong> — Has the supply actually reached the hot wallet? Or is it still sitting in deposit addresses?<br><br>
              <strong>Step 3: Cost Basis</strong> — Where did the whale actually enter? Map withdrawals, OTC moves, and proxy wallets to find their average entry price. If price is far above their cost basis and tokens move to exchange, they're taking profit.<br><br>
              <strong>Step 4: Liquidity Setup</strong> — Check the derivatives: Is funding extreme? Is OI elevated? Are retail traders on the wrong side? Is there a liquidation cascade waiting to trigger?<br><br>
              <strong>Step 5: Price Structure</strong> — Is there a clean entry? Look for the liquidity sweep (quick flush below support to wipe stops), then a V-shape recovery with a higher low. That's your floor.
            </div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>The Liquidity Sweep & Reclaim</h4>
            <div class="what">Before a real move, market makers often push price down quickly to trigger stop losses of early longs and grab liquidity below support. If price immediately bounces back (V-shape) and forms a higher low, weak hands are cleared out.</div>
            <div class="how"><strong>How to trade it:</strong><br>1. Wait for the sweep (quick wick below support)<br>2. Watch for immediate recovery above the sweep level<br>3. Enter on the consolidation base that forms after the bounce<br>4. Place stop below the sweep low — tight and structural<br>5. Never chase the initial vertical green candle</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>L/S Ratio Divergence (Retail Trap)</h4>
            <div class="what">The Long/Short ratio shows how many traders are long vs short. The key is comparing RETAIL positions vs TOP TRADER positions.</div>
            <div class="how"><strong>The classic squeeze setup:</strong><br>• Overall retail L/S ratio drops below 0.85 (retail is crowded short)<br>• Top Trader L/S ratio sits above 1.50 (smart money is stacked long)<br>• Retail keeps trying to short the top while big accounts absorb every sell<br>• Result: A violent squeeze upward as retail shorts get liquidated<br><br><strong>The reverse works too:</strong><br>• Retail L/S above 2.0 (everyone is long) + Top traders below 0.7 = dump incoming</div>
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
          <h3>📊 Our Historical Data Insights</h3><span class="edu-arrow">▼</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>What Our Data Shows (From Real Signals)</h4>
            <div class="how">
              <strong>Best Setup:</strong> Score 80+ short alert during 12-18 UTC (1-7 PM WAT) with funding aligned = 87.5% accuracy<br><br>
              <strong>Simulated P&L ($2K margin, 20x):</strong><br>
              • Score 70+ SHORTS: +$23,408 total in 1-4h exits (6 trades, avg 9.75% move)<br>
              • Score 70+ LONGS: -$4,604 in 1-4h BUT +$15,890 in 4-12h (longs need patience)<br><br>
              <strong>Optimal Hold Time:</strong><br>
              • 0-15 min holds: 29% win rate, -$111 total (too early to exit)<br>
              • 45-90 min holds: 83% win rate, +$39 total (sweet spot)<br>
              • Manual closes avg 20 min hold = $14 avg profit (best exit type)<br><br>
              <strong>What Kills Trades:</strong><br>
              • 20x leverage = highest loss rate (max_loss hits at -$27 avg)<br>
              • Funding AGAINST direction = ~30% accuracy (don't fight it)<br>
              • Long signals at 00-06 UTC (1-7 AM WAT) = 40% accuracy (dead hours)
            </div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Invalidation Signals (When to Exit)</h4>
            <div class="how">
              <strong>Exit immediately if:</strong><br>
              • OI drops >20% after your entry (positions are unwinding, the move is done)<br>
              • Funding flips against your direction mid-trade<br>
              • Exchange flow reverses (you're long but sudden massive inflow detected)<br>
              • Score drops below 40 on follow-up scans<br><br>
              <strong>Hold if:</strong><br>
              • Funding stays aligned with your direction<br>
              • OI continues rising (the move has more fuel)<br>
              • Exchange flow confirms (outflow for longs, inflow for shorts)<br>
              • Price forms a higher low (long) or lower high (short) on 15m chart
            </div>
          </div>

        </div>
      </div>

    </div>
  </div>
</div>

<script>
var MARGIN = 2000, LEVERAGE = 20, NOTIONAL = 40000, SCORE_FILTER = 0, RISK_AMOUNT = 0;

function loadSizing() {
  try {
    var s = JSON.parse(localStorage.getItem('sc_sizing'));
    if (s && s.m > 0 && s.l > 0) { MARGIN = s.m; LEVERAGE = s.l; }
    if (s && s.r > 0) RISK_AMOUNT = s.r;
  } catch(e) {}
  NOTIONAL = MARGIN * LEVERAGE;
}
function saveSizing() {
  localStorage.setItem('sc_sizing', JSON.stringify({ m: MARGIN, l: LEVERAGE, r: RISK_AMOUNT }));
  NOTIONAL = MARGIN * LEVERAGE;
}
function updateSizingUI() {
  document.getElementById('custom-margin').value = MARGIN;
  document.getElementById('custom-lev').value = LEVERAGE;
  var riskInput = document.getElementById('custom-risk');
  if (riskInput) riskInput.value = RISK_AMOUNT || '';
  document.getElementById('notional-display').textContent = '$' + NOTIONAL.toLocaleString() + ' notional';
  document.querySelectorAll('.sizing-bar .preset-btn').forEach(function(b) {
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
function applyRisk() {
  var r = parseInt(document.getElementById('custom-risk').value) || 0;
  if (r < 0) r = 0;
  RISK_AMOUNT = r;
  saveSizing(); renderSignals();
}
function toggleRoster() {
  var panel = document.getElementById('roster-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) renderJotter();
}

var JOTTER_TYPE = 'watch';
function setJotterType(btn) {
  document.querySelectorAll('.jotter-type-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  JOTTER_TYPE = btn.dataset.type;
}
function getJotterItems() {
  try { return JSON.parse(localStorage.getItem('sc_jotter')) || []; } catch(e) { return []; }
}
function saveJotterItems(items) {
  try { localStorage.setItem('sc_jotter', JSON.stringify(items)); } catch(e) {}
}
function addJotter(prefill) {
  var input = document.getElementById('jotter-input');
  var text = prefill || (input ? input.value.trim() : '');
  if (!text) return;
  var items = getJotterItems();
  var now = new Date();
  var timeStr = now.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) + ' ' + now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  items.unshift({ id: Date.now(), type: prefill ? 'watch' : JOTTER_TYPE, text: text, done: false, time: timeStr });
  saveJotterItems(items);
  if (input && !prefill) input.value = '';
  renderJotter();
}
function toggleJotter(id) {
  var items = getJotterItems();
  items.forEach(function(it) { if (it.id === id) it.done = !it.done; });
  saveJotterItems(items);
  renderJotter();
}
function deleteJotter(id) {
  var items = getJotterItems().filter(function(it) { return it.id !== id; });
  saveJotterItems(items);
  renderJotter();
}
function clearDoneJotter() {
  var items = getJotterItems().filter(function(it) { return !it.done; });
  saveJotterItems(items);
  renderJotter();
}
function renderJotter() {
  var list = document.getElementById('jotter-list');
  var coinRow = document.getElementById('jotter-coins');
  if (!list) return;
  var items = getJotterItems();

  if (coinRow && signals && signals.length) {
    var existing = items.map(function(it) { return it.text; }).join(' ');
    var coins = [];
    signals.forEach(function(s) {
      var sym = s.symbol.replace('/USDT','').replace(':USDT','');
      if (coins.indexOf(sym) === -1 && existing.indexOf(sym) === -1) coins.push(sym);
    });
    coinRow.innerHTML = coins.slice(0, 12).map(function(c) {
      return '<button class="jotter-coin-btn" onclick="addJotter(&quot;Watch ' + c + '&quot;)">' + c + '</button>';
    }).join('');
  }

  if (!items.length) {
    list.innerHTML = '<li class="jotter-empty">No notes yet. Add coins to watch or jot down trade ideas.</li>';
    return;
  }
  list.innerHTML = items.map(function(it) {
    var cls = it.done ? 'jotter-item done' : 'jotter-item';
    var check = it.done ? '&#10003;' : '';
    return '<li class="' + cls + '">' +
      '<button class="jotter-check" onclick="toggleJotter(' + it.id + ')">' + check + '</button>' +
      '<span class="jotter-tag ' + it.type + '">' + it.type + '</span>' +
      '<span class="jotter-text">' + it.text + '</span>' +
      '<span class="jotter-time">' + it.time + '</span>' +
      '<button class="jotter-del" onclick="deleteJotter(' + it.id + ')" title="Delete">&times;</button>' +
      '</li>';
  }).join('');
}

function setScoreFilter(btn) {
  document.querySelectorAll('.score-filter-bar .preset-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  SCORE_FILTER = parseInt(btn.dataset.score) || 0;
  renderStats();
  renderSignals();
}

var PATTERN_RULES = {
  long_mom_neutfund: { label: 'Momentum + Neutral funding', accuracy: 71.8, desc: 'Price moving >5% with neutral funding = 72% WR (213 trades)' },
  long_oi_neutfund: { label: 'OI + Neutral funding', accuracy: 77.8, desc: 'OI 4h >15% with neutral funding = 78% WR' },
  short_oi_mom: { label: 'SHORT OI + Momentum', accuracy: 100, desc: 'OI >15% + price dropping >5% = 100% WR (13 trades)' },
  short_high_score: { label: 'High-score short', accuracy: 100, desc: 'Score 75+ shorts = 100% WR (16 trades)' },
  short_negfund_flow: { label: 'SHORT Neg funding + Flow', accuracy: 100, desc: 'Negative funding with flow confirmation = 100% WR' },
  oi_big: { label: 'Big OI', accuracy: 75, desc: 'OI 4h >30% = 75% WR regardless of direction' },
  weak_signal: { label: 'Weak signal', accuracy: 27, desc: 'No OI, no momentum, no flow data = 27% WR', negative: true },
  short_low_score: { label: 'Low-score short', accuracy: 29, desc: 'Short with score <50 = 29% WR', negative: true },
};

var apiKey = '', signals = [], flowAlerts = [], patterns = {}, trades = {}, currentFilter = 'high', lastUpdate = 0, refreshInterval;

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
    if (r.status === 401) { resetConfig(); throw new Error('Invalid key — please re-enter'); }
    if (!r.ok) throw new Error('API ' + r.status);
    return r.json();
  });
}

function refreshAll() {
  var dot = document.getElementById('status-dot');
  var label = document.getElementById('status-label');
  Promise.all([
    apiFetch('/api/signals', { hours: 48, minScore: 40 }),
    apiFetch('/api/patterns'),
    apiFetch('/api/trades'),
  ]).then(function(results) {
    signals = (results[0].signals || []).map(function(s) {
      s.first_score = parseInt(s.score) || 0;
      s.best_score = parseInt(s.best_score) || s.first_score;
      s.current_score = parseInt(s.current_score) || s.first_score;
      s.score = s.best_score;
      return s;
    });
    flowAlerts = results[0].flow_alerts || [];
    patterns = results[1].patterns || [];
    trades = results[2];
    dot.className = 'status-dot live';
    label.textContent = 'Live — ' + signals.length + ' signals, ' + flowAlerts.length + ' flow';
    lastUpdate = Date.now();
    renderStats();
    renderSignals();
    renderJotter();
    renderFlowAlerts();
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
  var shortAcc = shortPat.with_data > 0 ? ((parseInt(shortPat.correct) / parseInt(shortPat.with_data)) * 100).toFixed(0) : '—';
  var longAcc = longPat.with_data > 0 ? ((parseInt(longPat.correct) / parseInt(longPat.with_data)) * 100).toFixed(0) : '—';
  var highConv = signals.filter(function(s) { return getConviction(s) === 'high'; }).length;

  var filtered = SCORE_FILTER > 0 ? signals.filter(function(s) { return (parseInt(s.score) || 0) >= SCORE_FILTER; }) : signals;
  var simTotal = 0, simWins = 0, simLosses = 0, winCount = 0, lossCount = 0;
  filtered.forEach(function(s) {
    var sim = simPnl(s);
    simTotal += sim.pnl;
    if (sim.pnl > 0) { simWins += sim.pnl; winCount++; }
    else if (sim.pnl < 0) { simLosses += sim.pnl; lossCount++; }
  });
  var totalTrades = winCount + lossCount;
  var winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(0) : '—';
  var scoreLabel = SCORE_FILTER > 0 ? ' (Score ' + SCORE_FILTER + '+)' : '';

  bar.innerHTML =
    '<div class="stat-card"><div class="stat-label">High Conviction</div><div class="stat-value gold">' + highConv + '</div><div class="stat-sub">' + signals.length + ' total signals</div></div>' +
    '<div class="stat-card"><div class="stat-label">Win Rate' + scoreLabel + '</div><div class="stat-value ' + (parseInt(winRate) >= 50 ? 'green' : parseInt(winRate) > 0 ? 'red' : '') + '">' + winRate + '%</div><div class="stat-sub">' + winCount + 'W / ' + lossCount + 'L of ' + filtered.length + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Short Acc (60+)</div><div class="stat-value green">' + shortAcc + '%</div><div class="stat-sub">' + (shortPat.correct || 0) + '/' + (shortPat.with_data || 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Long Acc (60+)</div><div class="stat-value ' + (parseInt(longAcc) >= 50 ? 'green' : 'red') + '">' + longAcc + '%</div><div class="stat-sub">' + (longPat.correct || 0) + '/' + (longPat.with_data || 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Sim Wins' + scoreLabel + '</div><div class="stat-value green">+$' + simWins.toFixed(0) + '</div><div class="stat-sub">' + winCount + ' winning</div></div>' +
    '<div class="stat-card"><div class="stat-label">Sim Losses' + scoreLabel + '</div><div class="stat-value red">-$' + Math.abs(simLosses).toFixed(0) + '</div><div class="stat-sub">' + lossCount + ' losing</div></div>' +
    '<div class="stat-card"><div class="stat-label">Sim Total' + scoreLabel + '</div><div class="stat-value ' + (simTotal >= 0 ? 'green' : 'red') + '">' + (simTotal >= 0 ? '+' : '') + '$' + simTotal.toFixed(0) + '</div><div class="stat-sub">$' + MARGIN + '/' + LEVERAGE + 'x · ' + filtered.length + ' signals</div></div>';
}

function getConviction(s) {
  var score = parseInt(s.score) || 0;
  var dir = s.direction;
  var oi = Math.abs(parseFloat(s.oi_4h) || 0);
  var momentum = Math.abs(parseFloat(s.price_change) || 0);
  var funding = parseFloat(s.funding_rate) || 0;
  var fundNeutral = Math.abs(funding) <= 0.03;
  var hasFlow = !!s.flow_bias;
  var isWeak = oi < 5 && momentum < 3 && !hasFlow;

  if (isWeak) return 'low';

  if (dir === 'short') {
    if (score < 50) return 'low';
    if (score >= 75) return 'high';
    if (oi > 15 && momentum > 5) return 'high';
    if (funding < -0.03 && hasFlow) return 'high';
    if (score >= 60 && (oi > 10 || momentum > 5)) return 'med';
    return 'med';
  }

  if (oi > 15 && fundNeutral) return 'high';
  if (momentum > 5 && fundNeutral && score >= 60) return 'high';
  if (oi > 30) return 'high';
  if (hasFlow && score >= 60) return 'high';
  if (score >= 60 && (oi > 10 || momentum > 5)) return 'med';
  if (score >= 50) return 'med';
  return 'low';
}

function getMatchedPatterns(s) {
  var matched = [];
  var dir = s.direction, score = parseInt(s.score) || 0;
  var oi = Math.abs(parseFloat(s.oi_4h) || 0);
  var momentum = Math.abs(parseFloat(s.price_change) || 0);
  var funding = parseFloat(s.funding_rate) || 0;
  var fundNeutral = Math.abs(funding) <= 0.03;
  var hasFlow = !!s.flow_bias;

  if (oi < 5 && momentum < 3 && !hasFlow) matched.push('weak_signal');
  if (dir === 'short' && score < 50) matched.push('short_low_score');
  if (dir === 'short' && score >= 75) matched.push('short_high_score');
  if (dir === 'short' && oi > 15 && momentum > 5) matched.push('short_oi_mom');
  if (dir === 'short' && funding < -0.03 && hasFlow) matched.push('short_negfund_flow');
  if (dir === 'long' && momentum > 5 && fundNeutral) matched.push('long_mom_neutfund');
  if (dir === 'long' && oi > 15 && fundNeutral) matched.push('long_oi_neutfund');
  if (oi > 30) matched.push('oi_big');
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
  var price = parseFloat(s.price), dir = s.direction;
  var tp1 = parseFloat(s.tp1), tp2 = parseFloat(s.tp2), tp3 = parseFloat(s.tp3);
  var sl = parseFloat(s.stop_loss);
  var hasReal = tp1 > 0 && sl > 0;
  if (!hasReal) {
    var absPc = Math.abs(parseFloat(s.price_change) || 0);
    var volEst = Math.max(absPc * 0.3, 3);
    var atrEst = price * (volEst / 100);
    if (dir === 'long') { sl = price - atrEst * 2; tp1 = price + atrEst * 1.5; tp2 = price + atrEst * 3; tp3 = price + atrEst * 5; }
    else { sl = price + atrEst * 2; tp1 = price - atrEst * 1.5; tp2 = price - atrEst * 3; tp3 = price - atrEst * 5; }
  }
  var risk = Math.abs(price - sl), reward = Math.abs(tp2 - price);
  var slPct = ((Math.abs(price - sl) / price) * 100).toFixed(1);
  return { sl: sl, tp1: tp1, tp2: tp2, tp3: tp3, rr: risk > 0 ? (reward / risk).toFixed(1) : '—', slPct: slPct, estimated: !hasReal };
}

function getTradeStatus(s, levels) {
  var entry = parseFloat(s.price), dir = s.direction;
  var now = validateCurrentPrice(entry, parseFloat(s.current_price));
  var peak = parseFloat(s.peak_price) || now;
  var trough = parseFloat(s.trough_price) || now;
  var hitTP1 = false, hitTP2 = false, hitTP3 = false, hitSL = false;
  if (dir === 'long') {
    hitTP1 = peak >= levels.tp1; hitTP2 = peak >= levels.tp2; hitTP3 = peak >= levels.tp3;
    hitSL = now <= levels.sl;
  } else {
    hitTP1 = trough <= levels.tp1; hitTP2 = trough <= levels.tp2; hitTP3 = trough <= levels.tp3;
    hitSL = now >= levels.sl;
  }
  var rawPct = ((now - entry) / entry) * 100;
  var movePct = dir === 'short' ? -rawPct : rawPct;
  var ageMin = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000);
  var fundAgainst = s.funding_bias && s.funding_bias !== dir;
  var breakdowns = [];
  if (fundAgainst) breakdowns.push('Funding flipped against (' + s.funding_bias + ')');
  var isStale = ageMin > 360;
  var isAging = ageMin > 120;

  // Check if price reverted past trailing SL after TP hit (trade is done)
  var reverted = false;
  if (dir === 'long') {
    if (hitTP3 && now < levels.tp2) reverted = true;
    else if (hitTP2 && now < levels.tp1) reverted = true;
    else if (hitTP1 && now < entry) reverted = true;
  } else {
    if (hitTP3 && now > levels.tp2) reverted = true;
    else if (hitTP2 && now > levels.tp1) reverted = true;
    else if (hitTP1 && now > entry) reverted = true;
  }

  var status, css, tip;
  if (reverted && hitTP3) { status = 'BANKED'; css = 'played'; tip = 'Trade done — all TPs hit, trail closed remaining at TP2'; }
  else if (reverted && hitTP2) { status = 'BANKED'; css = 'played'; tip = 'Trade done — TP1+TP2 banked, trail closed remaining at TP1'; }
  else if (reverted && hitTP1) { status = 'BANKED'; css = 'played'; tip = 'Trade done — TP1 banked, remaining closed at breakeven'; }
  else if (hitTP3) { status = 'PLAYED OUT'; css = 'played'; tip = 'Hit TP3 — move is done, profit banked'; }
  else if (hitTP2) { status = 'TP2 HIT'; css = 'tp2'; tip = 'Past TP2 — most profit taken, SL trailing at TP1'; }
  else if (hitTP1) { status = 'TP1 HIT'; css = 'tp1'; tip = 'Past TP1 — 33% profit banked, SL at breakeven'; }
  else if (hitSL) { status = 'STOPPED OUT'; css = 'stopped'; tip = 'Price reversed past SL — do NOT enter'; }
  else if (breakdowns.length) { status = 'INVALID'; css = 'stopped'; tip = breakdowns[0]; }
  else if (isStale) { status = 'STALE'; css = 'stale'; tip = 'Signal is ' + Math.floor(ageMin / 60) + 'h old — conditions likely changed. Wait for fresh alert'; }
  else if (isAging) { status = 'CAUTION'; css = 'late'; tip = 'Signal is ' + Math.floor(ageMin / 60) + 'h old — re-check conditions before entering'; }
  else if (movePct > 3) { status = 'LATE ENTRY'; css = 'late'; tip = 'Already moved ' + movePct.toFixed(1) + '% — smaller R:R if entering now'; }
  else { status = 'ACTIVE'; css = 'active'; tip = 'Setup valid — price near entry zone'; }
  return { status: status, css: css, tip: tip, hitTP1: hitTP1, hitTP2: hitTP2, hitTP3: hitTP3, hitSL: hitSL, currentPrice: now, invalidations: breakdowns.concat(isStale ? ['Signal is ' + Math.floor(ageMin / 60) + 'h old'] : []) };
}

function validateCurrentPrice(entry, current) {
  if (!current || current <= 0) return entry;
  var ratio = current / entry;
  if (ratio > 10 || ratio < 0.1) return entry;
  return current;
}

function simPnl(s) {
  var entry = parseFloat(s.price);
  var now = validateCurrentPrice(entry, parseFloat(s.current_price));
  var dir = s.direction;
  var levels = s._levels || calcLevels(s);
  var peak = parseFloat(s.peak_price) || now;
  var trough = parseFloat(s.trough_price) || now;

  function pctAt(price) {
    var raw = ((price - entry) / entry) * 100;
    return dir === 'short' ? -raw : raw;
  }

  var hitTP1, hitTP2, hitTP3;
  if (dir === 'long') {
    hitTP1 = peak >= levels.tp1; hitTP2 = peak >= levels.tp2; hitTP3 = peak >= levels.tp3;
  } else {
    hitTP1 = trough <= levels.tp1; hitTP2 = trough <= levels.tp2; hitTP3 = trough <= levels.tp3;
  }

  var remaining = 1.0, totalPct = 0;
  if (hitTP1) { totalPct += 0.33 * pctAt(levels.tp1); remaining = 0.67; }
  if (hitTP2) { var tp2x = 0.50 * remaining; totalPct += tp2x * pctAt(levels.tp2); remaining -= tp2x; }
  if (hitTP3) { var tp3x = 0.50 * remaining; totalPct += tp3x * pctAt(levels.tp3); remaining -= tp3x; }

  var remainPct = pctAt(now);
  if (hitTP1 && remainPct < 0) remainPct = 0;
  if (hitTP2 && remainPct < pctAt(levels.tp1)) remainPct = pctAt(levels.tp1);
  totalPct += remaining * remainPct;

  var pnl = (totalPct / 100) * NOTIONAL;
  return { pnl: pnl, pct: totalPct };
}

function buildReasons(s) {
  var reasons = [];
  var dir = s.direction, score = parseInt(s.score) || 0;
  var oi4h = parseFloat(s.oi_4h) || 0, oi1h = parseFloat(s.oi_1h) || 0;
  var priceChg = parseFloat(s.price_change) || 0, fundRate = parseFloat(s.funding_rate) || 0;
  var fundBias = s.funding_bias, flowBias = s.flow_bias;
  var hour = new Date(s.created_at).getUTCHours();

  if (score >= 80) reasons.push({ icon: '🔥', text: '<strong>Very high score (' + score + ')</strong> — <span>' + (dir === 'short' ? '87.5% historical accuracy on 80+ shorts' : 'Multiple onchain signals converging') + '</span>' });
  else if (score >= 60) reasons.push({ icon: '⚡', text: '<strong>Strong score (' + score + ')</strong> — <span>Multiple signals converging</span>' });

  if (fundBias === dir) reasons.push({ icon: '✅', text: '<strong>Funding aligned ' + dir + '</strong> — <span>' + (fundRate * 100).toFixed(3) + '% — smart money confirms direction</span>' });
  else if (fundBias && fundBias !== dir) reasons.push({ icon: '⚠️', text: '<strong>Funding OPPOSES direction</strong> — <span>Funding is ' + fundBias + ' but signal is ' + dir + ' — drops accuracy to ~30%</span>' });

  if (Math.abs(oi4h) > 20) {
    var oiDir = oi4h > 0 ? 'rising' : 'falling';
    reasons.push({ icon: oi4h > 0 ? '📈' : '📉', text: '<strong>OI ' + oiDir + ' ' + Math.abs(oi4h).toFixed(1) + '% (4h)</strong> — <span>' + (oi4h > 0 ? 'New positions opening aggressively' : 'Positions unwinding — squeeze or reversal') + '</span>' });
  }

  if (flowBias === 'bullish') reasons.push({ icon: '🟢', text: '<strong>Exchange outflow (bullish)</strong> — <span>Tokens leaving exchanges = accumulation, sell pressure reduced</span>' });
  else if (flowBias === 'bearish') reasons.push({ icon: '🔴', text: '<strong>Exchange inflow (bearish)</strong> — <span>Tokens entering exchanges = distribution, sell pressure increasing</span>' });

  if (Math.abs(priceChg) > 20) reasons.push({ icon: priceChg > 0 ? '🚀' : '💀', text: '<strong>Price ' + (priceChg > 0 ? '+' : '') + priceChg.toFixed(1) + '% move</strong> — <span>' + (Math.abs(priceChg) > 40 ? 'Extreme — potential exhaustion' : 'Significant momentum') + '</span>' });

  if (dir === 'short' && hour >= 12 && hour < 18) reasons.push({ icon: '🕐', text: '<strong>EU/US overlap (12-18 UTC / 1-7 PM WAT)</strong> — <span>77% accuracy for shorts in this window</span>' });
  else if (dir === 'long' && hour >= 18) reasons.push({ icon: '🕐', text: '<strong>Late session (18-24 UTC / 7 PM-1 AM WAT)</strong> — <span>82% accuracy for longs</span>' });

  if (Math.abs(oi1h) > 15) reasons.push({ icon: '⏱️', text: '<strong>1h OI spike ' + (oi1h > 0 ? '+' : '') + oi1h.toFixed(1) + '%</strong> — <span>Rapid position buildup — immediate momentum</span>' });

  reasons.push({ icon: '⏳', text: '<strong>Optimal hold: 45-90 min</strong> — <span>83% win rate in this window vs 29% for 0-15 min exits. Don\\'t exit too early.</span>' });

  return reasons;
}

function setFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderSignals();
}

function toggleCard(id) {
  var card = document.getElementById(id);
  card.classList.toggle('expanded');
  if (card.classList.contains('expanded')) {
    var idx = parseInt(id.replace('sig-', ''));
    if (!chartInstances[idx]) {
      var activeBtn = document.querySelector('#tf-tabs-' + idx + ' .chart-tf-btn.active');
      if (activeBtn) loadChart(activeBtn);
    }
    startChartAutoRefresh();
  } else {
    if (!document.querySelector('.signal-card.expanded')) stopChartAutoRefresh();
  }
}

function renderSignals() {
  var grid = document.getElementById('signals-grid');
  Object.keys(chartInstances).forEach(function(k) { if (chartInstances[k]) { chartInstances[k].remove(); } });
  chartInstances = {};
  var filtered = signals.map(function(s) {
    var c = Object.assign({}, s, { conviction: getConviction(s) });
    c._levels = calcLevels(c);
    c._status = getTradeStatus(c, c._levels);
    return c;
  });

  if (currentFilter === 'high') filtered = filtered.filter(function(s) { return s.conviction === 'high'; });
  else if (currentFilter === 'short') filtered = filtered.filter(function(s) { return s.direction === 'short'; });
  else if (currentFilter === 'long') filtered = filtered.filter(function(s) { return s.direction === 'long'; });
  else if (currentFilter === 'active') filtered = filtered.filter(function(s) { return s._status.css === 'active'; });
  else if (currentFilter === 'profit') filtered = filtered.filter(function(s) { return s._status.hitTP1 || s._status.hitTP2 || s._status.hitTP3; });

  if (SCORE_FILTER > 0) filtered = filtered.filter(function(s) { return (parseInt(s.score) || 0) >= SCORE_FILTER; });
  filtered.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (!filtered.length) {
    var filterNames = { high: 'high conviction', active: 'enterable', profit: 'in-profit', short: 'short', long: 'long' };
    var label = filterNames[currentFilter] || '';
    if (SCORE_FILTER > 0) label = (label ? label + ' ' : '') + 'score ' + SCORE_FILTER + '+';
    grid.innerHTML = '<div class="empty-state"><div class="icon">📡</div><h3>No ' + label + ' signals right now</h3><p>Scanner checks every 5 min. ' + ((currentFilter !== 'all' || SCORE_FILTER > 0) ? 'Try clearing filters to see everything.' : '') + '</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(function(s, i) {
    var id = 'sig-' + i, conv = s.conviction, levels = s._levels || calcLevels(s), reasons = buildReasons(s);
    var matched = getMatchedPatterns(s);
    var positiveMatches = matched.filter(function(m) { return !PATTERN_RULES[m].negative; });
    var negativeMatches = matched.filter(function(m) { return PATTERN_RULES[m].negative; });
    var dt = new Date(s.created_at);
    var timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    var agoMin = Math.floor((Date.now() - dt.getTime()) / 60000);
    var agoStr = agoMin < 60 ? agoMin + 'm ago' : Math.floor(agoMin / 60) + 'h ' + (agoMin % 60) + 'm ago';
    var sim = simPnl(s);
    var pnlClass = sim.pnl >= 0 ? 'pos' : 'neg';
    var pnlSign = sim.pnl >= 0 ? '+' : '-';
    var ts = s._status || getTradeStatus(s, levels);

    var html = '<div class="signal-card conviction-' + conv + '" id="' + id + '">';
    html += '<div class="signal-header" onclick="toggleCard(\\'' + id + '\\')">';
    html += '<div class="signal-left">';
    html += '<span class="signal-dir ' + s.direction + '">' + s.direction + '</span>';
    html += '<span class="status-badge ' + ts.css + '">' + ts.status + '</span>';
    html += '<span class="signal-symbol">' + s.symbol + '</span>';
    html += '<span class="signal-price">' + fmtPrice(s.price) + ' → ' + fmtPrice(ts.currentPrice) + ' · ' + agoStr + '</span>';
    html += '</div><div class="signal-right">';
    html += '<span class="signal-pnl ' + pnlClass + '">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span>';
    html += '<span class="conviction-badge ' + conv + '">' + (conv === 'high' ? 'HIGH' : conv === 'med' ? 'MED' : 'LOW') + '</span>';
    html += '<span class="signal-score">' + (parseInt(s.score) || 0) + '</span>';
    html += '<span class="signal-expand">▼</span>';
    html += '</div></div>';

    html += '<div class="signal-body">';

    html += '<div class="indicators-strip">';
    var _fr = parseFloat(s.funding_rate) || 0;
    var _oi4 = parseFloat(s.oi_4h) || 0;
    var _oi1 = parseFloat(s.oi_1h) || 0;
    var _pc = parseFloat(s.price_change) || 0;
    html += '<span class="ind-chip ' + (s.funding_bias === s.direction ? 'bull' : s.funding_bias ? 'bear' : '') + '">Fund: ' + (s.funding_bias || 'neutral') + ' ' + (_fr ? (_fr * 100).toFixed(3) + '%' : '') + '</span>';
    html += '<span class="ind-chip ' + (_oi4 > 15 ? 'warn' : '') + '">OI 4h: ' + (_oi4 ? (_oi4 > 0 ? '+' : '') + _oi4.toFixed(1) + '%' : '—') + '</span>';
    html += '<span class="ind-chip ' + (_oi1 > 10 ? 'warn' : '') + '">OI 1h: ' + (_oi1 ? (_oi1 > 0 ? '+' : '') + _oi1.toFixed(1) + '%' : '—') + '</span>';
    html += '<span class="ind-chip ' + (s.flow_bias === 'bullish' ? 'bull' : s.flow_bias === 'bearish' ? 'bear' : '') + '">Flow: ' + (s.flow_bias || '—') + '</span>';
    html += '<span class="ind-chip ' + (Math.abs(_pc) > 20 ? 'warn' : '') + '">Price: ' + (_pc ? (_pc > 0 ? '+' : '') + _pc.toFixed(1) + '%' : '—') + '</span>';
    html += '</div>';

    html += '<div class="tp-progress">';
    html += '<span class="tp-step ' + (ts.css === 'active' ? 'hit' : '') + '">Entry ' + fmtPrice(s.price) + '</span>';
    html += '<span style="color:var(--muted)">→</span>';
    html += '<span class="tp-step ' + (ts.hitTP1 ? 'hit' : '') + '" title="Take Profit 1 — close 33% of position">TP1 ' + fmtPrice(levels.tp1) + '</span>';
    html += '<span style="color:var(--muted)">→</span>';
    html += '<span class="tp-step ' + (ts.hitTP2 ? 'hit' : '') + '" title="Take Profit 2 — close 50% of remaining">TP2 ' + fmtPrice(levels.tp2) + '</span>';
    html += '<span style="color:var(--muted)">→</span>';
    html += '<span class="tp-step ' + (ts.hitTP3 ? 'hit' : '') + '" title="Take Profit 3 — close remaining position">TP3 ' + fmtPrice(levels.tp3) + '</span>';
    html += '<span style="color:var(--muted);margin-left:4px">|</span>';
    html += '<span class="tp-step ' + (ts.hitSL ? 'blown' : '') + '" title="Stop Loss — exit entire position if breached">SL ' + fmtPrice(levels.sl) + '</span>';
    html += '</div>';
    var tipColor = ts.css === 'active' ? 'var(--accent)' : ts.css === 'stopped' ? 'var(--danger)' : ts.css === 'stale' ? 'var(--muted)' : 'var(--gold)';
    var movePctStr = ((Math.abs(ts.currentPrice - parseFloat(s.price)) / parseFloat(s.price)) * 100).toFixed(1);
    var moveDir = ts.currentPrice >= parseFloat(s.price) ? '+' : '-';
    html += '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;font-family:var(--font-mono);padding:6px 10px;background:var(--bg);border-radius:4px;border-left:3px solid ' + tipColor + '">';
    html += ts.tip + ' — Now: ' + fmtPrice(ts.currentPrice) + ' (' + moveDir + movePctStr + '% from entry)';
    if (ts.invalidations.length > 1) {
      ts.invalidations.forEach(function(inv, idx) {
        if (idx > 0) html += '<br><span style="color:var(--danger)">⚠ ' + inv + '</span>';
      });
    }
    html += '</div>';

    var initDt = new Date(s.created_at);
    var initWat = initDt.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    html += '<div style="font-size:11px;font-family:var(--font-mono);color:var(--text2);padding:6px 10px;margin-bottom:10px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent)">';
    html += '<span style="color:var(--muted)">SCORE TRACKER</span><br>';
    html += 'First: <strong>' + s.first_score + '</strong> at ' + fmtPrice(s.price) + ' — ' + initWat + ' WAT';
    if (s.best_at && s.best_score > s.first_score) {
      var bestDt = new Date(s.best_at);
      var bestWat = bestDt.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      html += '<br>Best: <strong style="color:var(--accent)">' + s.best_score + '</strong> at ' + fmtPrice(s.best_price) + ' — ' + bestWat + ' WAT';
    }
    html += '<br>Now: <strong style="color:' + (s.current_score >= 60 ? 'var(--accent)' : 'var(--danger)') + '">' + s.current_score + '</strong>';
    html += s.current_score >= 60 ? ' <span style="color:var(--accent)">TRADEABLE</span>' : ' <span style="color:var(--danger)">BELOW 60</span>';
    html += '</div>';

    html += '<div class="chart-section">';
    html += '<div class="chart-tf-tabs" id="tf-tabs-' + i + '">';
    var chartAttrs = 'data-idx="' + i + '" data-symbol="' + s.symbol + '" data-dir="' + s.direction + '" data-created="' + s.created_at + '"';
    html += '<button class="chart-tf-btn" data-tf="5m" ' + chartAttrs + ' onclick="loadChart(this)">5m</button>';
    html += '<button class="chart-tf-btn active" data-tf="15m" ' + chartAttrs + ' onclick="loadChart(this)">15m</button>';
    html += '<button class="chart-tf-btn" data-tf="1h" ' + chartAttrs + ' onclick="loadChart(this)">1h</button>';
    html += '<button class="chart-tf-btn" data-tf="4h" ' + chartAttrs + ' onclick="loadChart(this)">4h</button>';
    html += '<button class="chart-expand-btn" onclick="toggleChartSize(' + i + ')" style="margin-left:auto" id="expand-btn-' + i + '">Expand</button>';
    html += '<button class="chart-tf-btn" ' + chartAttrs + ' onclick="reloadChart(' + i + ')">Refresh</button>';
    html += '<span style="font-family:var(--font-mono);font-size:10px;color:var(--muted)">Snapshot</span>';
    html += '</div>';
    html += '<div class="chart-container" id="chart-' + i + '"><div class="chart-loading" id="chart-load-' + i + '">Click a timeframe to load chart</div></div>';
    html += '<div class="chart-legend">';
    html += '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:#f59e0b"></span>Entry</span>';
    html += '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:#10b981"></span>TP1/TP2/TP3</span>';
    html += '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:#ef4444"></span>Stop Loss</span>';
    html += '</div>';
    html += '<div class="chart-verdict" id="chart-verdict-' + i + '" hidden></div>';

    var watDate = new Date(new Date(s.created_at).getTime() + 3600000);
    var watDay = watDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    var watTime = watDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' });
    var tvSymbol = s.symbol.replace(/\\/.*/, '') + 'USDT.P';
    html += '<div style="margin-top:8px;padding:10px 12px;background:var(--surface2);border-radius:6px;border:1px solid var(--border);font-size:12px;line-height:1.7">';
    html += '<div style="font-family:var(--font-mono);font-size:11px;color:var(--gold);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em">Find This Candle on TradingView</div>';
    html += '<div style="color:var(--text2)">';
    html += '<strong style="color:var(--text)">1. Search:</strong> <span style="color:var(--accent);font-family:var(--font-mono)">' + tvSymbol + '</span> on Bybit (or just <span style="font-family:var(--font-mono)">' + s.symbol.replace(/\\/.*/, '') + 'USDT</span> perp)<br>';
    html += '<strong style="color:var(--text)">2. Date:</strong> <span style="font-family:var(--font-mono);color:var(--gold)">' + watDay + '</span><br>';
    html += '<strong style="color:var(--text)">3. Time (WAT):</strong> <span style="font-family:var(--font-mono);color:var(--gold)">' + watTime + ' WAT</span> (Nigeria timezone, UTC+1)<br>';
    html += '<strong style="color:var(--text)">4. Timeframe:</strong> Start on <span style="font-family:var(--font-mono)">15m</span>, then check <span style="font-family:var(--font-mono)">1h</span> and <span style="font-family:var(--font-mono)">4h</span> for trend context<br>';
    html += '<strong style="color:var(--text)">5. Look for:</strong> The candle at ' + watTime + ' WAT near <span style="font-family:var(--font-mono);color:var(--gold)">' + fmtPrice(s.price) + '</span>. ';
    if (s.direction === 'short') {
      html += 'This was a <span style="color:var(--danger);font-weight:600">SHORT</span> signal — look for a red candle or rejection wick at this price. Price should have dropped after this candle.';
    } else {
      html += 'This was a <span style="color:var(--accent);font-weight:600">LONG</span> signal — look for a green candle or bounce at this price. Price should have risen after this candle.';
    }
    html += '<br><strong style="color:var(--text)">6. Verify:</strong> Draw a horizontal line at ' + fmtPrice(s.price) + ' (entry), ' + fmtPrice(levels.sl) + ' (SL), and ' + fmtPrice(levels.tp1) + ' (TP1). See if the move played out as signaled.';
    html += '</div></div>';

    html += '</div>';

    var entryP = parseFloat(s.price);
    var tp1Pct = ((Math.abs(levels.tp1 - entryP) / entryP) * 100).toFixed(1);
    var tp2Pct = ((Math.abs(levels.tp2 - entryP) / entryP) * 100).toFixed(1);
    var tp3Pct = ((Math.abs(levels.tp3 - entryP) / entryP) * 100).toFixed(1);
    var srcLabel = levels.estimated ? ' <span style="color:var(--text2);font-weight:400;font-size:10px">(estimated)</span>' : '';
    html += '<div class="trade-setup"><div class="setup-box"><h4>Trade Levels ($' + MARGIN + ' @ ' + LEVERAGE + 'x)' + srcLabel + '</h4>';
    html += '<div class="level-row"><span class="level-label">Entry</span><span class="level-val entry">' + fmtPrice(s.price) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Stop Loss (' + levels.slPct + '%)</span><span class="level-val sl">' + fmtPrice(levels.sl) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP1 (+' + tp1Pct + '%)</span><span class="level-val tp">' + fmtPrice(levels.tp1) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP2 (+' + tp2Pct + '%)</span><span class="level-val tp">' + fmtPrice(levels.tp2) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">TP3 (+' + tp3Pct + '%)</span><span class="level-val tp">' + fmtPrice(levels.tp3) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">R:R</span><span class="rr-badge">' + levels.rr + ':1</span></div>';
    html += '</div><div class="setup-box"><h4>If You Entered ($' + MARGIN + ' @ ' + LEVERAGE + 'x)</h4>';
    var tp1Pnl = NOTIONAL * parseFloat(tp1Pct) / 100;
    var tp2Pnl = NOTIONAL * parseFloat(tp2Pct) / 100;
    var tp3Pnl = NOTIONAL * parseFloat(tp3Pct) / 100;
    var slPnl = NOTIONAL * parseFloat(levels.slPct) / 100;
    html += '<div class="level-row"><span class="level-label">If TP1 hit</span><span class="level-val tp">+$' + tp1Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If TP2 hit</span><span class="level-val tp">+$' + tp2Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If TP3 hit</span><span class="level-val tp">+$' + tp3Pnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">If SL hit</span><span class="level-val sl">-$' + slPnl.toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Current Move P&L</span><span class="level-val ' + (sim.pnl >= 0 ? 'tp' : 'sl') + '">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span></div>';
    html += '<div class="level-row"><span class="level-label">Hold Target</span><span class="level-val">45-90 min</span></div>';
    html += '</div>';

    if (RISK_AMOUNT > 0) {
      var riskEntry = entryP;
      var riskSL = levels.sl;
      var slDistPct = Math.abs(riskEntry - riskSL) / riskEntry;
      var lossAtSL = NOTIONAL * slDistPct;
      var liqDistPct = 1 / LEVERAGE;
      var liqPrice = s.direction === 'long' ? riskEntry * (1 - liqDistPct) : riskEntry * (1 + liqDistPct);
      var marginForSL = Math.ceil(lossAtSL);
      var slSafe = MARGIN >= marginForSL;
      var liqBeforeSL = s.direction === 'long' ? (liqPrice > riskSL) : (liqPrice < riskSL);
      var riskSLPrice, riskSLPct;
      if (s.direction === 'long') {
        riskSLPrice = riskEntry * (1 - (RISK_AMOUNT / NOTIONAL));
        riskSLPct = ((riskEntry - riskSLPrice) / riskEntry * 100).toFixed(1);
      } else {
        riskSLPrice = riskEntry * (1 + (RISK_AMOUNT / NOTIONAL));
        riskSLPct = ((riskSLPrice - riskEntry) / riskEntry * 100).toFixed(1);
      }
      var riskSLCovers = s.direction === 'long' ? (riskSLPrice <= riskSL) : (riskSLPrice >= riskSL);
      var neededRisk = Math.ceil(NOTIONAL * slDistPct);
      html += '<div class="setup-box"><h4>Risk Analysis ($' + RISK_AMOUNT + ' Risk)</h4>';
      html += '<div class="level-row"><span class="level-label">Your Risk</span><span class="level-val" style="color:var(--gold)">$' + RISK_AMOUNT + '</span></div>';
      html += '<div class="level-row"><span class="level-label">Position Size</span><span class="level-val">$' + NOTIONAL.toLocaleString() + '</span></div>';
      html += '<div class="level-row"><span class="level-label">Your SL ($' + RISK_AMOUNT + ' loss)</span><span class="level-val ' + (riskSLCovers ? 'tp' : 'sl') + '">' + fmtPrice(riskSLPrice) + ' (' + riskSLPct + '%)</span></div>';
      html += '<div class="level-row"><span class="level-label">System SL</span><span class="level-val sl">' + fmtPrice(riskSL) + ' (' + levels.slPct + '%)</span></div>';
      html += '<div class="level-row"><span class="level-label">Liq Price (' + LEVERAGE + 'x)</span><span class="level-val ' + (liqBeforeSL ? 'sl' : '') + '">' + fmtPrice(liqPrice) + '</span></div>';
      if (riskSLCovers) {
        html += '<div class="level-row" style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span class="level-label" style="color:var(--green);font-weight:600">SAFE</span><span class="level-val tp">$' + RISK_AMOUNT + ' covers system SL</span></div>';
      } else {
        html += '<div class="level-row" style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px"><span class="level-label" style="color:var(--danger);font-weight:600">WARNING</span><span class="level-val sl">SL loss = $' + lossAtSL.toFixed(0) + ' &gt; $' + RISK_AMOUNT + ' risk</span></div>';
        html += '<div class="level-row"><span class="level-label">Risk needed for SL</span><span class="level-val" style="color:var(--gold)">$' + neededRisk + '</span></div>';
      }
      if (liqBeforeSL) {
        html += '<div class="level-row"><span class="level-label" style="color:var(--danger);font-weight:600">DANGER</span><span class="level-val sl">Liquidated at ' + fmtPrice(liqPrice) + ' before SL hits</span></div>';
        var safeLev = Math.floor(1 / slDistPct);
        if (safeLev >= 1) html += '<div class="level-row"><span class="level-label">Max safe leverage</span><span class="level-val" style="color:var(--gold)">' + safeLev + 'x</span></div>';
      }
      html += '</div>';
    }

    html += '</div>';

    html += '<div class="reasons-grid">';
    reasons.forEach(function(r) { html += '<div class="reason-row"><span class="reason-icon">' + r.icon + '</span><span class="reason-text">' + r.text + '</span></div>'; });
    html += '</div>';

    if (positiveMatches.length || negativeMatches.length) {
      html += '<div class="hist-match"><h4>Historical Pattern Match</h4><p>';
      positiveMatches.forEach(function(m) { html += '<span class="match-stat" style="color:var(--accent)">✓ ' + PATTERN_RULES[m].label + ' (' + PATTERN_RULES[m].accuracy + '%)</span> — ' + PATTERN_RULES[m].desc + '<br>'; });
      negativeMatches.forEach(function(m) { html += '<span class="match-stat" style="color:var(--danger)">✗ ' + PATTERN_RULES[m].label + ' (~' + PATTERN_RULES[m].accuracy + '%)</span> — ' + PATTERN_RULES[m].desc + '<br>'; });
      html += '</p></div>';
    }

    html += '</div></div>';
    return html;
  }).join('');
}

var chartInstances = {};
var chartAutoRefresh = null;

function startChartAutoRefresh() {
  if (chartAutoRefresh) return;
  chartAutoRefresh = setInterval(function() {
    var expanded = document.querySelectorAll('.signal-card.expanded');
    expanded.forEach(function(card) {
      var idx = parseInt(card.id.replace('sig-', ''));
      if (chartInstances[idx]) reloadChart(idx);
    });
  }, 60000);
}

function stopChartAutoRefresh() {
  if (chartAutoRefresh) { clearInterval(chartAutoRefresh); chartAutoRefresh = null; }
}

function toggleChartSize(idx) {
  var container = document.getElementById('chart-' + idx);
  var btn = document.getElementById('expand-btn-' + idx);
  container.classList.toggle('expanded');
  var isExpanded = container.classList.contains('expanded');
  btn.textContent = isExpanded ? 'Collapse' : 'Expand';
  if (chartInstances[idx]) {
    chartInstances[idx].applyOptions({ height: isExpanded ? 600 : 400 });
  }
}

function reloadChart(idx) {
  var activeBtn = document.querySelector('#tf-tabs-' + idx + ' .chart-tf-btn.active');
  if (activeBtn && activeBtn.dataset.tf) loadChart(activeBtn);
}

function loadChart(btn) {
  var tf = btn.dataset.tf, idx = parseInt(btn.dataset.idx);
  var sym = btn.dataset.symbol, dir = btn.dataset.dir;
  var tabs = document.getElementById('tf-tabs-' + idx);
  tabs.querySelectorAll('.chart-tf-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');

  var created = btn.dataset.created;
  var s = null;
  for (var si = 0; si < signals.length; si++) {
    if (signals[si].symbol === sym && signals[si].created_at === created) { s = signals[si]; break; }
  }
  if (!s) return;
  s = Object.assign({}, s, { conviction: getConviction(s) });
  s._levels = calcLevels(s);
  s._status = getTradeStatus(s, s._levels);

  var containerId = 'chart-' + idx;
  var loadEl = document.getElementById('chart-load-' + idx);
  if (loadEl) loadEl.textContent = 'Loading ' + tf + ' candles...';

  var preSignal = tf === '4h' ? 5*24*3600000 : tf === '1h' ? 12*3600000 : tf === '15m' ? 4*3600000 : 2*3600000;
  var sinceMs = new Date(s.created_at).getTime() - preSignal;
  var chartParams = { symbol: s.symbol, tf: tf, since: sinceMs };
  if (s.exchange) chartParams.exchange = s.exchange;
  apiFetch('/api/chart', chartParams).then(function(data) {
    if (!data.candles || !data.candles.length) {
      if (loadEl) loadEl.textContent = 'No chart data available';
      return;
    }
    renderChart(containerId, idx, data.candles, s, tf);
  }).catch(function(e) {
    if (loadEl) {
      if (e.message.indexOf('404') !== -1) loadEl.textContent = s.symbol + ' not listed on exchange — chart unavailable';
      else loadEl.textContent = 'Chart error: ' + e.message;
    }
  });
}

function renderChart(containerId, idx, candles, signal, tf) {
  var container = document.getElementById(containerId);
  if (!container) return;

  if (chartInstances[idx]) {
    chartInstances[idx].remove();
    chartInstances[idx] = null;
  }
  container.innerHTML = '';

  var chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.classList.contains('expanded') ? 600 : 400,
    layout: { background: { type: 'solid', color: '#131722' }, textColor: '#9ca3af', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
    grid: { vertLines: { color: 'rgba(42,46,57,0.5)' }, horzLines: { color: 'rgba(42,46,57,0.5)' } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: '#1e293b' },
    timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
  });
  chartInstances[idx] = chart;

  var candleSeries = chart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444',
    wickUpColor: '#10b981', wickDownColor: '#ef4444',
  });
  candleSeries.setData(candles);

  var volSeries = chart.addHistogramSeries({
    color: 'rgba(59,130,246,0.2)', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  volSeries.setData(candles.map(function(c) {
    return { time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' };
  }));

  var entryPrice = parseFloat(signal.price);
  var levels = calcLevels(signal);

  candleSeries.createPriceLine({ price: entryPrice, color: '#f59e0b', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '' });
  candleSeries.createPriceLine({ price: levels.sl, color: 'rgba(239,68,68,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'SL' });
  candleSeries.createPriceLine({ price: levels.tp1, color: 'rgba(16,185,129,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'TP1' });
  candleSeries.createPriceLine({ price: levels.tp2, color: 'rgba(16,185,129,0.3)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'TP2' });
  candleSeries.createPriceLine({ price: levels.tp3, color: 'rgba(16,185,129,0.25)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'TP3' });

  var sigTimeSec = Math.floor(new Date(signal.created_at).getTime() / 1000);

  candleSeries.setMarkers([{
    time: sigTimeSec,
    position: signal.direction === 'short' ? 'aboveBar' : 'belowBar',
    color: signal.direction === 'short' ? '#ef4444' : '#10b981',
    shape: signal.direction === 'short' ? 'arrowDown' : 'arrowUp',
    text: signal.direction.toUpperCase() + ' @ ' + fmtPrice(signal.price),
    size: 2,
  }]);
  var tfSec = tf === '4h' ? 14400 : tf === '1h' ? 3600 : tf === '15m' ? 900 : 300;
  var paddingBefore = tfSec * 30;
  var paddingAfter = tfSec * 40;
  chart.timeScale().setVisibleRange({
    from: sigTimeSec - paddingBefore,
    to: Math.min(sigTimeSec + paddingAfter, Math.floor(Date.now() / 1000) + tfSec * 5),
  });

  var postSignalCandles = candles.filter(function(c) { return c.time >= sigTimeSec; });
  var levels = calcLevels(signal);
  var slBreached = false, slBreachTime = null, maxAdverse = 0;
  var tpTimeline = { tp1: null, tp2: null, tp3: null };
  postSignalCandles.forEach(function(c) {
    if (signal.direction === 'short') {
      if (c.high > maxAdverse) maxAdverse = c.high;
      if (!slBreached && c.high >= levels.sl) { slBreached = true; slBreachTime = c.time; }
      if (!tpTimeline.tp1 && c.low <= levels.tp1) tpTimeline.tp1 = c.time;
      if (!tpTimeline.tp2 && c.low <= levels.tp2) tpTimeline.tp2 = c.time;
      if (!tpTimeline.tp3 && c.low <= levels.tp3) tpTimeline.tp3 = c.time;
    } else {
      if (c.low < maxAdverse || maxAdverse === 0) maxAdverse = c.low;
      if (!slBreached && c.low <= levels.sl) { slBreached = true; slBreachTime = c.time; }
      if (!tpTimeline.tp1 && c.high >= levels.tp1) tpTimeline.tp1 = c.time;
      if (!tpTimeline.tp2 && c.high >= levels.tp2) tpTimeline.tp2 = c.time;
      if (!tpTimeline.tp3 && c.high >= levels.tp3) tpTimeline.tp3 = c.time;
    }
  });

  var verdictEl = document.getElementById('chart-verdict-' + idx);
  if (verdictEl) {
    var html = '';
    var adversePct = ((Math.abs(maxAdverse - parseFloat(signal.price)) / parseFloat(signal.price)) * 100).toFixed(1);
    if (slBreached && tpTimeline.tp1 && slBreachTime > tpTimeline.tp1) {
      html = '<span style="color:var(--gold)">SL was hit BUT after TP1 was reached. Partial profit possible with partials at TP1.</span>';
    } else if (slBreached) {
      var slTime = new Date((slBreachTime + 3600) * 1000);
      var slStr = slTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
      html = '<span style="color:var(--danger);font-weight:600">SL WAS HIT</span> at ~' + slStr + ' WAT before any TP. ';
      html += 'Max adverse: ' + adversePct + '% against. This trade would have been a loss of -$' + (NOTIONAL * parseFloat(levels.slPct) / 100).toFixed(0) + '.';
      if (tpTimeline.tp1) html += '<br><span style="color:var(--text2)">TP1 was reached later — a wider SL would have survived.</span>';
    } else if (tpTimeline.tp3) {
      html = '<span style="color:var(--accent);font-weight:600">FULL WIN</span> — TP1, TP2, TP3 all hit without SL being touched. Clean trade.';
    } else if (tpTimeline.tp2) {
      html = '<span style="color:var(--accent)">TP1 + TP2 hit</span> without SL being touched. Strong move.';
    } else if (tpTimeline.tp1) {
      html = '<span style="color:var(--accent)">TP1 hit</span> without SL touched. Max drawdown before TP1: ' + adversePct + '%.';
    } else {
      html = '<span style="color:var(--text2)">No TP or SL hit yet on this timeframe. Max drawdown: ' + adversePct + '%.</span>';
    }
    verdictEl.innerHTML = html;
    verdictEl.hidden = false;
  }

  new ResizeObserver(function() {
    if (chartInstances[idx]) chart.applyOptions({ width: container.clientWidth });
  }).observe(container);
}

function renderFlowAlerts() {
  var section = document.getElementById('flow-section');
  var grid = document.getElementById('flow-grid');
  if (!flowAlerts.length) { section.hidden = true; return; }
  section.hidden = false;
  grid.innerHTML = flowAlerts.map(function(f) {
    var dt = new Date(f.created_at);
    var timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    var agoMin = Math.floor((Date.now() - dt.getTime()) / 60000);
    var agoStr = agoMin < 60 ? agoMin + 'm ago' : Math.floor(agoMin / 60) + 'h ' + (agoMin % 60) + 'm ago';
    var typeLabel = f.alert_type === 'SUPPLY_MOVE' ? 'SUPPLY' : 'FLOW';
    var typeCss = f.alert_type === 'SUPPLY_MOVE' ? 'warn' : '';
    var msg = f.message ? f.message.replace(/</g, '&lt;').substring(0, 200) : '';
    return '<div class="signal-card conviction-low" style="opacity:0.85">' +
      '<div class="signal-header" style="cursor:default">' +
      '<div class="signal-left">' +
      '<span class="signal-dir ' + f.direction + '">' + f.direction + '</span>' +
      '<span class="ind-chip ' + typeCss + '" style="font-size:10px">' + typeLabel + '</span>' +
      '<span class="signal-symbol">' + f.symbol + '</span>' +
      '<span class="signal-price">' + fmtPrice(f.price) + ' · ' + agoStr + '</span>' +
      '</div></div>' +
      (msg ? '<div style="padding:0 16px 10px;font-size:12px;color:var(--text2)">' + msg + '</div>' : '') +
      '</div>';
  }).join('');
}

init();
</script>
</body>
</html>`;
