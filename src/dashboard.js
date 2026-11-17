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
.setup-overlay { position: fixed; inset: 0; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.setup-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; max-width: 400px; width: 100%; }
.setup-card h2 { font-family: var(--font-mono); font-size: 18px; margin-bottom: 4px; }
.setup-card p { color: var(--text2); font-size: 13px; margin-bottom: 20px; }
.setup-card label { display: block; font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
.setup-card input { width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: var(--font-mono); font-size: 13px; margin-bottom: 16px; outline: none; }
.setup-card input:focus { border-color: var(--accent); }
.setup-card button { width: 100%; padding: 10px; background: var(--accent); color: #000; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-right { display: flex; align-items: center; gap: 6px; }
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

.signal-card.dead-hour { opacity: 0.5; }
.signal-card.dead-hour:hover { opacity: 0.8; }
.signal-card.daily-limit { opacity: 0.45; }
.signal-card.daily-limit:hover { opacity: 0.75; }
.status-badge.daily-limit { background: #6366f1; color: #fff; }

/* Trading hours widget */
.hours-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; flex-wrap: wrap; }
.hours-bar .slab { font-family: var(--font-mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-right: 4px; white-space: nowrap; }
.hours-grid { display: flex; gap: 2px; flex: 1; min-width: 200px; }
.hour-cell { flex: 1; height: 26px; border-radius: 3px; cursor: pointer; position: relative; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 8px; color: var(--muted); transition: all 0.15s; min-width: 0; border: 1px solid transparent; }
.hour-cell.active { background: rgba(16,185,129,0.15); border-color: rgba(16,185,129,0.3); color: var(--accent); }
.hour-cell.blocked { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); color: var(--danger); }
.hour-cell:hover { transform: scaleY(1.2); z-index: 1; }
.hour-cell .hour-tip { display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 10px; white-space: nowrap; z-index: 10; color: var(--text); pointer-events: none; }
.hour-cell:hover .hour-tip { display: block; }
.hours-now { position: absolute; top: -2px; width: 2px; height: calc(100% + 4px); background: var(--gold); border-radius: 1px; z-index: 2; }
.hours-legend { display: flex; gap: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--muted); margin-left: auto; }
.hours-legend span { display: flex; align-items: center; gap: 4px; }
.hours-legend .dot { width: 8px; height: 8px; border-radius: 2px; }
.hours-legend .dot.on { background: rgba(16,185,129,0.4); }
.hours-legend .dot.off { background: rgba(239,68,68,0.3); }

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
.edu-diagram { margin: 10px 0; padding: 12px; background: var(--bg); border-radius: 8px; border: 1px solid var(--border); overflow-x: auto; }
.edu-diagram-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.edu-metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; }
.edu-metric-card { padding: 8px 10px; border-radius: 6px; background: var(--bg); border: 1px solid var(--border); }
.edu-metric-card h5 { font-size: 11px; color: var(--accent); margin: 0 0 4px; font-family: var(--font-mono); }
.edu-metric-card p { font-size: 11px; color: var(--text2); margin: 0; line-height: 1.5; }
.edu-scale { display: flex; align-items: stretch; height: 24px; border-radius: 4px; overflow: hidden; margin: 6px 0; font-size: 10px; font-weight: 600; }
.edu-scale > span { display: flex; align-items: center; justify-content: center; flex: 1; }
.edu-vs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: start; margin: 8px 0; }
.edu-vs-col { padding: 8px 10px; border-radius: 6px; font-size: 11px; line-height: 1.6; }
.edu-vs-col.bull { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); }
.edu-vs-col.bear { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); }
.edu-vs-divider { color: var(--muted); font-size: 13px; align-self: center; }
@media (max-width: 600px) { .edu-metric-grid { grid-template-columns: 1fr; } .edu-vs { grid-template-columns: 1fr; } .edu-vs-divider { text-align: center; } }

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

/* TRADES TAB */
.trades-period-bar { display:flex; gap:6px; margin-bottom:14px; padding:2px 0; }
.period-btn { padding:6px 16px; border-radius:6px; border:1px solid var(--border); background:transparent; color:var(--text2); font-size:12px; font-family:var(--font-mono); cursor:pointer; font-weight:600; }
.period-btn.active { border-color:var(--accent); color:var(--accent); background:var(--accent-dim); }
.period-btn:hover { border-color:var(--text2); }
.trades-stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-bottom:14px; }
.ts-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:12px 14px; }
.ts-label { font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); font-family:var(--font-mono); margin-bottom:4px; }
.ts-value { font-size:22px; font-weight:700; font-family:var(--font-mono); line-height:1.2; }
.ts-value.green { color:var(--green); } .ts-value.red { color:var(--danger); } .ts-value.gold { color:var(--gold); }
.ts-sub { font-size:11px; color:var(--muted); font-family:var(--font-mono); margin-top:2px; }
.trades-analytics { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
@media (max-width:700px) { .trades-analytics { grid-template-columns:1fr; } }
.ta-section { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:14px; }
.ta-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--accent); font-family:var(--font-mono); margin-bottom:10px; }
.ta-row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid var(--border); font-size:12px; font-family:var(--font-mono); }
.ta-row:last-child { border-bottom:none; }
.ta-row-label { color:var(--text2); }
.ta-row-value { font-weight:600; }
.ta-bar { height:6px; border-radius:3px; background:var(--border); margin-top:4px; overflow:hidden; }
.ta-bar-fill { height:100%; border-radius:3px; }
.trades-subtitle { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-family:var(--font-mono); font-size:12px; color:var(--muted); }
.trades-page-controls { display:flex; gap:6px; align-items:center; }
.trades-page-controls button { padding:4px 10px; border-radius:4px; border:1px solid var(--border); background:transparent; color:var(--text2); font-size:11px; font-family:var(--font-mono); cursor:pointer; }
.trades-page-controls button:hover { border-color:var(--accent); color:var(--accent); }
.trades-page-controls button:disabled { opacity:0.3; cursor:default; }
.trades-page-controls span { font-size:11px; color:var(--muted); }
.trades-open-section { margin-bottom:12px; }
.trades-open-title { font-size:11px; font-weight:700; text-transform:uppercase; color:var(--gold); font-family:var(--font-mono); margin-bottom:6px; letter-spacing:0.05em; }
.trades-table-wrap { overflow-x:auto; }
.trades-table { width:100%; border-collapse:collapse; font-size:12px; font-family:var(--font-mono); }
.trades-table th { text-align:left; padding:8px 6px; border-bottom:2px solid var(--border); color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:0.06em; font-weight:600; white-space:nowrap; }
.trades-table td { padding:7px 6px; border-bottom:1px solid var(--border); color:var(--text2); white-space:nowrap; }
.trades-table tr:hover td { background:var(--accent-dim); }
.td-sym { font-weight:700; color:var(--text); }
.td-dir { font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; text-transform:uppercase; }
.td-dir.long { background:var(--green-dim); color:var(--green); }
.td-dir.short { background:rgba(239,68,68,0.12); color:var(--danger); }
.td-pnl { font-weight:700; }
.td-pnl.pos { color:var(--green); } .td-pnl.neg { color:var(--danger); }
.td-reason { font-size:10px; padding:2px 6px; border-radius:3px; background:var(--bg); }
.td-reason.tp { color:var(--green); } .td-reason.sl, .td-reason.loss { color:var(--danger); }
.daily-chart { display:flex; align-items:flex-end; gap:2px; height:80px; padding:8px 0; }
.daily-bar { flex:1; min-width:6px; max-width:20px; border-radius:2px 2px 0 0; position:relative; cursor:default; }
.daily-bar.pos { background:var(--green); }
.daily-bar.neg { background:var(--danger); }
.daily-bar .daily-tip { display:none; position:absolute; bottom:calc(100% + 4px); left:50%; transform:translateX(-50%); background:var(--surface); border:1px solid var(--border); border-radius:4px; padding:3px 6px; font-size:10px; font-family:var(--font-mono); white-space:nowrap; z-index:10; color:var(--text); }
.daily-bar:hover .daily-tip { display:block; }

/* ═══════ MOBILE RESPONSIVE ═══════ */
@media (max-width: 600px) {
  .app { padding: 10px 8px; }

  /* Header */
  .header { flex-direction: column; align-items: stretch; gap: 8px; }
  .header-left { justify-content: space-between; }
  .header-right .btn-sm { flex: 1; text-align: center; }

  /* Tab nav — scrollable */
  .tab-nav { overflow-x: auto; -webkit-overflow-scrolling: touch; gap: 0; }
  .tab-btn { padding: 10px 14px; white-space: nowrap; font-size: 12px; flex-shrink: 0; }

  /* Sizing bar — wrap into rows */
  .sizing-bar { gap: 6px; padding: 10px 12px; }
  .sizing-bar .slab { width: 100%; text-align: center; margin-right: 0; }
  .sizing-bar .preset-btn { font-size: 11px; padding: 6px 8px; flex: 1 1 auto; min-width: 0; }
  .sizing-sep { display: none; }
  .sizing-bar .sizing-input-label { font-size: 10px; }
  .sizing-bar .sizing-input { width: 55px; font-size: 11px; }
  .sizing-notional { width: 100%; text-align: center; margin-left: 0; }

  /* Hours bar — stack vertically, grid wraps to 2 rows */
  .hours-bar { flex-direction: column; align-items: stretch; gap: 6px; }
  .hours-bar .slab { text-align: center; margin-right: 0; }
  .hours-grid { flex-wrap: wrap; min-width: 0; }
  .hour-cell { min-width: 22px; flex: 0 0 calc(100% / 12 - 2px); height: 28px; font-size: 9px; }
  .hours-legend { margin-left: 0; justify-content: center; }

  /* Stats bar — 2 columns */
  .stats-bar { grid-template-columns: 1fr 1fr; gap: 6px; }
  .stat-card { padding: 10px; }
  .stat-value { font-size: 18px; }
  .stat-label { font-size: 10px; }
  .stat-sub { font-size: 10px; }

  /* Score filter — scroll */
  .score-filter-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; padding-bottom: 4px; }
  .score-filter-bar .preset-btn { flex-shrink: 0; }

  /* Rules banner — vertical stack */
  .rules-banner { flex-direction: column; gap: 6px; padding: 10px 12px; }
  .rules-banner .rule-item { font-size: 11px; }

  /* Refresh bar — stack window + filters */
  .refresh-bar { flex-direction: column; gap: 8px; align-items: stretch; }
  .refresh-left { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .filter-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .filter-btn { font-size: 10px; padding: 4px 8px; }
  .roster-btn { font-size: 11px; padding: 4px 10px; }

  /* Signal cards — mobile-friendly header */
  .signal-header { flex-wrap: wrap; padding: 10px 12px; gap: 8px; }
  .signal-left { flex-basis: 100%; }
  .signal-symbol { font-size: 14px; }
  .signal-price { font-size: 12px; }
  .signal-right { width: 100%; justify-content: space-between; }
  .signal-score { font-size: 18px; }
  .signal-pnl { font-size: 12px; }
  .signal-body { padding: 0 12px 12px; }

  /* TP progress pills */
  .tp-progress { flex-wrap: wrap; gap: 3px; }
  .tp-step { font-size: 10px; padding: 2px 6px; }

  /* Chart section */
  .chart-container { height: 280px; }
  .chart-container.expanded { height: 400px; }
  .chart-tf-tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .chart-legend { font-size: 9px; }

  /* Trades tab */
  .trades-period-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
  .period-btn { flex-shrink: 0; padding: 5px 12px; font-size: 11px; }
  .trades-stats-grid { grid-template-columns: 1fr 1fr; }
  .ts-value { font-size: 18px; }
  .trades-subtitle { flex-direction: column; gap: 6px; align-items: flex-start; }
  .trades-table { font-size: 11px; }
  .trades-table th { font-size: 9px; padding: 6px 4px; }
  .trades-table td { padding: 5px 4px; }

  /* Education — canvas containers */
  .edu-diagram canvas { max-width: 100%; height: auto !important; }
  .edu-header h3 { font-size: 13px; }
  .edu-term h4 { font-size: 12px; }
  .edu-term .what { font-size: 12px; }
  .edu-term .how { font-size: 11px; padding: 6px 8px; }
  .edu-term .example { font-size: 11px; }

  /* Jotter */
  .jotter-add-row { flex-direction: column; }
  .jotter-add-row .jotter-input { width: 100%; }
  .jotter-coin-row { gap: 3px; }
  .jotter-coin-btn { font-size: 10px; padding: 2px 6px; }
  .jotter-item { font-size: 11px; padding: 6px 8px; }

  /* Roster */
  .roster-panel { padding: 14px 12px; }
  .roster-title { font-size: 13px; }
  .roster-item { font-size: 12px; }

  /* Daily PnL chart */
  .daily-chart { height: 60px; }
  .daily-bar { min-width: 4px; }
}

/* Extra small screens */
@media (max-width: 380px) {
  .app { padding: 8px 6px; }
  .logo { font-size: 17px; }
  .stats-bar { grid-template-columns: 1fr; }
  .stat-value { font-size: 16px; }
  .tab-btn { padding: 8px 10px; font-size: 11px; }
  .signal-symbol { font-size: 13px; }
  .signal-score { font-size: 16px; }
  .hour-cell { flex: 0 0 calc(100% / 8 - 2px); height: 26px; }
}
</style>
</head>
<body>
<div id="setup-overlay" class="setup-overlay">
  <div class="setup-card">
    <h2>Signal Command</h2>
    <p>Enter your dashboard API key to open the admin dashboard.</p>
    <form onsubmit="event.preventDefault(); saveConfig(); return false;">
      <label>Dashboard Key</label>
      <input type="text" id="cfg-key" placeholder="Your DASHBOARD_KEY from .env" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="-webkit-text-security:disc">
      <div id="login-error" style="color:var(--danger);font-size:12px;margin-bottom:8px;display:none"></div>
      <button type="submit">Connect</button>
    </form>
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
      <a class="btn-sm" href="/app" style="text-decoration:none;color:var(--accent)">Open ReplayDesk ↗</a>
      <a class="btn-sm" href="/learn" style="text-decoration:none">Academy ↗</a>
      <button class="btn-sm" onclick="refreshAll()">Refresh</button>
      <button class="btn-sm" onclick="resetConfig()">Logout</button>
    </div>
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" data-tab="trades" onclick="switchTab('trades',this)">Trades & PnL</button>
    <button class="tab-btn" data-tab="sim" onclick="switchTab('sim',this)">Simulator</button>
  </div>

  <!-- TRADES TAB -->
  <div class="tab-panel active" id="tab-trades">
    <div class="trades-period-bar">
      <button class="period-btn active" data-period="all" onclick="setPeriod(this)">All Time</button>
      <button class="period-btn" data-period="month" onclick="setPeriod(this)">30 Days</button>
      <button class="period-btn" data-period="week" onclick="setPeriod(this)">7 Days</button>
      <button class="period-btn" data-period="today" onclick="setPeriod(this)">Today</button>
      <span style="width:1px;height:20px;background:var(--border);margin:0 6px"></span>
      <button class="period-btn active" data-source="all" onclick="setSource(this)">All Sources</button>
      <button class="period-btn" data-source="onchain" onclick="setSource(this)">Onchain</button>
      <button class="period-btn" data-source="demandzone" onclick="setSource(this)">Demand Zone</button>
      <button class="period-btn" data-source="main" onclick="setSource(this)">Main</button>
      <button class="period-btn" data-source="swing" onclick="setSource(this)">Swing</button>
    </div>
    <div class="trades-stats-grid" id="trades-stats-grid"></div>
    <div class="trades-analytics" id="trades-analytics"></div>
    <div class="trades-subtitle">
      <span id="trades-showing">Closed Trades</span>
      <div class="trades-page-controls" id="trades-page-controls"></div>
    </div>
    <div class="trades-open-section" id="trades-open-section"></div>
    <div class="trades-table-wrap" id="trades-table-wrap"></div>
  </div>

  <!-- TRADE SIMULATOR TAB (content: src/web/simulator.html, data: src/web/simApi.js) -->
  <div class="tab-panel" id="tab-sim"><!--SIMULATOR--></div>
</div>

<script>
var apiKey = '', lastUpdate = 0, refreshInterval;

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  try { localStorage.setItem('sc_tab', tab); } catch(e) {}   // a reload comes back to this tab
}

// After login / on reload: open the tab you were on (a click, so the Simulator starts and Trades loads as usual)
function restoreTab() {
  var t = null;
  try { t = localStorage.getItem('sc_tab'); } catch(e) {}
  if (!t || !/^[a-z]+$/.test(t) || !document.getElementById('tab-' + t)) t = 'trades';
  var b = document.querySelector('.tab-btn[data-tab="' + t + '"]');
  if (b) b.click();
}

function init() {
  var saved = null;
  try { saved = localStorage.getItem('sc_key'); } catch(e) {}
  // window.__RD_ADMIN: the page was served to a signed-in admin (src/web/site) — the session cookie authorises /api/*,
  // so no key is needed; a saved key is still sent and still works on its own
  if (saved || window.__RD_ADMIN) {
    apiKey = saved || '';
    document.getElementById('setup-overlay').hidden = true;
    document.getElementById('main-app').hidden = false;
    refreshAll();
    refreshInterval = setInterval(refreshAll, 300000);
    restoreTab();
  }
}

function saveConfig() {
  var key = document.getElementById('cfg-key').value.trim();
  var errEl = document.getElementById('login-error');
  var btn = document.querySelector('.setup-card button');
  if (!key) {
    errEl.textContent = 'Please enter a key.';
    errEl.style.display = 'block';
    return;
  }
  errEl.textContent = 'Connecting... key length: ' + key.length;
  errEl.style.display = 'block'; errEl.style.color = 'var(--gold)';
  btn.textContent = 'Connecting...'; btn.disabled = true;
  var fetchUrl = '/api/trades?key=' + encodeURIComponent(key) + '&period=today&limit=10';
  errEl.textContent = 'Fetching: ' + fetchUrl.substring(0, 30) + '...';
  fetch(fetchUrl)
    .then(function(r) {
      errEl.textContent = 'Response: status ' + r.status;
      if (r.status === 401) {
        errEl.textContent = 'AUTH FAILED (401). Key length=' + key.length + '. Server rejected the key.';
        errEl.style.color = 'var(--danger)';
        btn.textContent = 'Connect'; btn.disabled = false;
        return;
      }
      if (!r.ok) {
        errEl.textContent = 'Server error: HTTP ' + r.status;
        errEl.style.color = 'var(--danger)';
        btn.textContent = 'Connect'; btn.disabled = false;
        return;
      }
      errEl.textContent = 'Authenticated! Loading dashboard...';
      errEl.style.color = 'var(--accent)';
      apiKey = key;
      try { localStorage.setItem('sc_key', key); } catch(e) {}
      document.getElementById('setup-overlay').hidden = true;
      document.getElementById('main-app').hidden = false;
      refreshAll();
      refreshInterval = setInterval(refreshAll, 300000);
      restoreTab();
    })
    .catch(function(e) {
      errEl.textContent = 'FETCH FAILED: ' + e.message;
      errEl.style.color = 'var(--danger)';
      btn.textContent = 'Connect'; btn.disabled = false;
    });
}

function resetConfig() {
  localStorage.removeItem('sc_key');
  apiKey = '';
  clearInterval(refreshInterval);
  if (window.__RD_ADMIN) {   // signed in through the site: end that session too, back to the home page
    fetch('/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(function() {}).then(function() { location.href = '/'; });
    return;
  }
  document.getElementById('setup-overlay').hidden = false;
  document.getElementById('main-app').hidden = true;
}

function apiFetch(path, params) {
  params = params || {};
  params.key = apiKey;
  params._t = Date.now();
  var qs = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return fetch(path + '?' + qs, { cache: 'no-store' }).then(function(r) {
    if (r.status === 401) { resetConfig(); throw new Error('Invalid key — please re-enter'); }
    if (!r.ok) throw new Error('API ' + r.status);
    return r.json();
  });
}

function refreshAll() {
  var dot = document.getElementById('status-dot');
  var label = document.getElementById('status-label');
  var again = lastUpdate > 0;   // the first call comes from init, which opens the Trades tab itself
  apiFetch('/api/trades', { period: 'today', limit: 10 }).then(function(r) {
    var open = (r.open || []).length;
    dot.className = 'status-dot live';
    label.textContent = 'Live — ' + open + ' open trade' + (open === 1 ? '' : 's');
    lastUpdate = Date.now();
    var t = document.getElementById('tab-trades');
    if (again && t && t.classList.contains('active')) loadTrades();
  }).catch(function(e) {
    dot.className = 'status-dot off';
    label.textContent = 'Error: ' + e.message;
  });
}

function fmtPrice(p) {
  var n = parseFloat(p);
  if (isNaN(n)) return '$0';
  if (n >= 100) return '$' + n.toFixed(2);
  if (n >= 1) return '$' + n.toFixed(4);
  if (n >= 0.01) return '$' + n.toFixed(5);
  return '$' + n.toPrecision(4);
}

// ── TRADES TAB ──
var tradesPeriod = 'all', tradesSource = 'all', tradesPage = 1, tradesTotal = 0, tradesLimit = 25;
var tradeStats = null, tradesList = [], openTrades = [];

function setPeriod(btn) {
  document.querySelectorAll('.period-btn[data-period]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  tradesPeriod = btn.dataset.period;
  tradesPage = 1;
  loadTrades();
}

function setSource(btn) {
  document.querySelectorAll('.period-btn[data-source]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  tradesSource = btn.dataset.source;
  tradesPage = 1;
  loadTrades();
}

function loadTrades() {
  var params = { period: tradesPeriod, page: tradesPage, limit: tradesLimit };
  var statsParams = {};
  if (tradesSource !== 'all') { params.source = tradesSource; statsParams.source = tradesSource; }
  Promise.all([
    apiFetch('/api/trades', params),
    apiFetch('/api/trade-stats', statsParams),
  ]).then(function(results) {
    tradesList = results[0].closed || [];
    openTrades = results[0].open || [];
    tradesTotal = results[0].total || 0;
    tradeStats = results[1];
    renderTradesStats();
    renderTradesAnalytics();
    renderOpenTrades();
    renderTradesTable();
  }).catch(function(e) {
    document.getElementById('trades-stats-grid').innerHTML = '<div class="ts-card"><div class="ts-label">Error</div><div class="ts-value red">' + e.message + '</div></div>';
  });
}

function renderTradesStats() {
  var s = tradeStats?.summary;
  if (!s) return;
  var periodKey = tradesPeriod === 'today' ? 'today' : tradesPeriod === 'week' ? 'week' : tradesPeriod === 'month' ? 'month' : 'all';
  var pnl = parseFloat(s[periodKey + '_pnl']) || 0;
  var wins = parseInt(s[periodKey + '_wins']) || 0;
  var losses = parseInt(s[periodKey + '_losses']) || 0;
  var total = parseInt(s[periodKey + '_count']) || 0;
  var wr = total > 0 ? ((wins / total) * 100).toFixed(0) : '—';
  var avgW = parseFloat(s.avg_win) || 0;
  var avgL = Math.abs(parseFloat(s.avg_loss) || 0);
  var rr = avgL > 0 ? (avgW / avgL).toFixed(2) : '—';
  var holdMin = parseFloat(s.avg_hold_min) || 0;
  var holdStr = holdMin < 60 ? holdMin.toFixed(0) + 'm' : (holdMin / 60).toFixed(1) + 'h';
  var periodLabel = tradesPeriod === 'today' ? 'Today' : tradesPeriod === 'week' ? '7 Days' : tradesPeriod === 'month' ? '30 Days' : 'All Time';

  var grid = document.getElementById('trades-stats-grid');
  grid.innerHTML =
    '<div class="ts-card"><div class="ts-label">' + periodLabel + ' P&L</div><div class="ts-value ' + (pnl >= 0 ? 'green' : 'red') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + '</div><div class="ts-sub">' + total + ' trades</div></div>' +
    '<div class="ts-card"><div class="ts-label">Win Rate</div><div class="ts-value ' + (parseInt(wr) >= 50 ? 'green' : parseInt(wr) > 0 ? 'red' : '') + '">' + wr + '%</div><div class="ts-sub">' + wins + 'W / ' + losses + 'L</div></div>' +
    '<div class="ts-card"><div class="ts-label">Avg Win</div><div class="ts-value green">+$' + avgW.toFixed(2) + '</div><div class="ts-sub">per winning trade</div></div>' +
    '<div class="ts-card"><div class="ts-label">Avg Loss</div><div class="ts-value red">-$' + avgL.toFixed(2) + '</div><div class="ts-sub">per losing trade</div></div>' +
    '<div class="ts-card"><div class="ts-label">Risk/Reward</div><div class="ts-value gold">' + rr + '</div><div class="ts-sub">avg win / avg loss</div></div>' +
    '<div class="ts-card"><div class="ts-label">Best Trade</div><div class="ts-value green">+$' + (parseFloat(s.best_trade) || 0).toFixed(2) + '</div></div>' +
    '<div class="ts-card"><div class="ts-label">Worst Trade</div><div class="ts-value red">$' + (parseFloat(s.worst_trade) || 0).toFixed(2) + '</div></div>' +
    '<div class="ts-card"><div class="ts-label">Avg Hold</div><div class="ts-value">' + holdStr + '</div><div class="ts-sub">per trade</div></div>';
}

function renderTradesAnalytics() {
  if (!tradeStats) return;
  var el = document.getElementById('trades-analytics');
  var html = '';

  // Daily PnL chart
  var daily = tradeStats.dailyPnl || [];
  if (daily.length) {
    var maxAbs = Math.max.apply(null, daily.map(function(d) { return Math.abs(parseFloat(d.pnl) || 0); })) || 1;
    html += '<div class="ta-section"><div class="ta-title">Daily P&L (30 days)</div><div class="daily-chart">';
    daily.slice().reverse().forEach(function(d) {
      var pnl = parseFloat(d.pnl) || 0;
      var h = Math.max(4, Math.abs(pnl) / maxAbs * 70);
      var cls = pnl >= 0 ? 'pos' : 'neg';
      var dayStr = new Date(d.day).toLocaleDateString([], { month: 'short', day: 'numeric' });
      html += '<div class="daily-bar ' + cls + '" style="height:' + h + 'px"><div class="daily-tip">' + dayStr + ': ' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + ' (' + d.trades + ' trades, ' + d.wins + 'W)</div></div>';
    });
    html += '</div></div>';
  }

  // Close reasons + direction + top/worst symbols
  html += '<div class="ta-section"><div class="ta-title">Performance Breakdown</div>';

  // By direction
  var dirs = tradeStats.byDirection || [];
  dirs.forEach(function(d) {
    var wr = parseInt(d.cnt) > 0 ? ((parseInt(d.wins) / parseInt(d.cnt)) * 100).toFixed(0) : 0;
    var pnl = parseFloat(d.pnl) || 0;
    html += '<div class="ta-row"><span class="ta-row-label">' + d.direction.toUpperCase() + '</span><span class="ta-row-value" style="color:' + (pnl >= 0 ? 'var(--green)' : 'var(--danger)') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + ' (' + wr + '% WR, ' + d.cnt + ' trades)</span></div>';
  });

  // By close reason
  html += '<div style="margin-top:10px;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Exit Reasons</div>';
  var reasons = tradeStats.byReason || [];
  reasons.forEach(function(r) {
    var pnl = parseFloat(r.pnl) || 0;
    var label = r.close_reason || 'unknown';
    if (label === 'tp1') label = 'TP1 Hit';
    else if (label === 'tp2') label = 'TP2 Hit';
    else if (label === 'tp3') label = 'TP3 Hit';
    else if (label === 'sl') label = 'Stop Loss';
    else if (label === 'sl_breakeven') label = 'Breakeven SL';
    else if (label === 'max_loss') label = 'Max Loss Cap';
    else if (label === 'invalidated') label = 'Invalidated';
    else if (label === 'time_exit') label = 'Time Exit';
    else if (label === 'manual') label = 'Manual Close';
    html += '<div class="ta-row"><span class="ta-row-label">' + label + ' (' + r.cnt + ')</span><span class="ta-row-value" style="color:' + (pnl >= 0 ? 'var(--green)' : 'var(--danger)') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + '</span></div>';
  });

  // Top symbols
  html += '<div style="margin-top:10px;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Best Symbols</div>';
  (tradeStats.topSymbols || []).slice(0, 5).forEach(function(t) {
    var wr = parseInt(t.cnt) > 0 ? ((parseInt(t.wins) / parseInt(t.cnt)) * 100).toFixed(0) : 0;
    html += '<div class="ta-row"><span class="ta-row-label">' + t.symbol + '</span><span class="ta-row-value" style="color:var(--green)">+$' + parseFloat(t.pnl).toFixed(2) + ' (' + wr + '% WR, ' + t.cnt + ')</span></div>';
  });

  // Worst symbols
  html += '<div style="margin-top:10px;font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Worst Symbols</div>';
  (tradeStats.worstSymbols || []).filter(function(t) { return parseFloat(t.pnl) < 0; }).slice(0, 5).forEach(function(t) {
    var wr = parseInt(t.cnt) > 0 ? ((parseInt(t.wins) / parseInt(t.cnt)) * 100).toFixed(0) : 0;
    html += '<div class="ta-row"><span class="ta-row-label">' + t.symbol + '</span><span class="ta-row-value" style="color:var(--danger)">$' + parseFloat(t.pnl).toFixed(2) + ' (' + wr + '% WR, ' + t.cnt + ')</span></div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

function renderOpenTrades() {
  var el = document.getElementById('trades-open-section');
  if (!openTrades.length) { el.innerHTML = ''; return; }
  var html = '<div class="trades-open-title">Open Positions (' + openTrades.length + ')</div>';
  html += '<table class="trades-table"><thead><tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>Lev</th><th>Size</th><th>Score</th><th>Age</th></tr></thead><tbody>';
  openTrades.forEach(function(t) {
    var ageMin = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 60000);
    var ageStr = ageMin < 60 ? ageMin + 'm' : Math.floor(ageMin / 60) + 'h ' + (ageMin % 60) + 'm';
    html += '<tr><td class="td-sym">' + t.symbol + '</td>' +
      '<td><span class="td-dir ' + t.direction + '">' + t.direction + '</span></td>' +
      '<td>' + fmtPrice(t.entry_price) + '</td>' +
      '<td>' + (t.leverage || '—') + 'x</td>' +
      '<td>$' + (parseFloat(t.position_size) || 0).toFixed(0) + '</td>' +
      '<td>' + (t.score || '—') + '</td>' +
      '<td>' + ageStr + '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderTradesTable() {
  var el = document.getElementById('trades-table-wrap');
  var totalPages = Math.max(1, Math.ceil(tradesTotal / tradesLimit));
  document.getElementById('trades-showing').textContent = 'Closed Trades (' + tradesTotal + ')';
  var pc = document.getElementById('trades-page-controls');
  pc.innerHTML = '<button onclick="tradesGoPage(-1)"' + (tradesPage <= 1 ? ' disabled' : '') + '>&lt; Prev</button>' +
    '<span>Page ' + tradesPage + ' of ' + totalPages + '</span>' +
    '<button onclick="tradesGoPage(1)"' + (tradesPage >= totalPages ? ' disabled' : '') + '>Next &gt;</button>';

  if (!tradesList.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-family:var(--font-mono);font-size:13px">No closed trades in this period.</div>';
    return;
  }
  var html = '<table class="trades-table"><thead><tr><th>Symbol</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Lev</th><th>Score</th><th>Source</th><th>Exit Reason</th><th>Hold</th><th>Date</th></tr></thead><tbody>';
  tradesList.forEach(function(t) {
    var pnl = parseFloat(t.pnl_usd) || 0;
    var holdMin = t.closed_at && t.created_at ? Math.floor((new Date(t.closed_at) - new Date(t.created_at)) / 60000) : 0;
    var holdStr = holdMin < 60 ? holdMin + 'm' : Math.floor(holdMin / 60) + 'h ' + (holdMin % 60) + 'm';
    var reason = t.close_reason || '—';
    var reasonCls = '';
    if (reason.startsWith('tp')) reasonCls = 'tp';
    else if (reason === 'sl' || reason === 'max_loss') reasonCls = 'loss';
    var dateStr = t.closed_at ? new Date(t.closed_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    var srcLabel = t.source === 'demandzone' ? 'DZ' : t.source === 'onchain' ? 'OC' : t.source === 'swing' ? 'SW' : 'Main';
    html += '<tr>' +
      '<td class="td-sym">' + t.symbol + '</td>' +
      '<td><span class="td-dir ' + t.direction + '">' + t.direction + '</span></td>' +
      '<td>' + fmtPrice(t.entry_price) + '</td>' +
      '<td>' + fmtPrice(t.exit_price) + '</td>' +
      '<td class="td-pnl ' + (pnl >= 0 ? 'pos' : 'neg') + '">' + (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) + '</td>' +
      '<td>' + (t.leverage || '—') + 'x</td>' +
      '<td>' + (t.score || '—') + '</td>' +
      '<td><span class="td-reason">' + srcLabel + '</span></td>' +
      '<td><span class="td-reason ' + reasonCls + '">' + reason + '</span></td>' +
      '<td>' + holdStr + '</td>' +
      '<td>' + dateStr + '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function tradesGoPage(delta) {
  var totalPages = Math.max(1, Math.ceil(tradesTotal / tradesLimit));
  var newPage = tradesPage + delta;
  if (newPage < 1 || newPage > totalPages) return;
  tradesPage = newPage;
  var p = { period: tradesPeriod, page: tradesPage, limit: tradesLimit };
  if (tradesSource !== 'all') p.source = tradesSource;
  apiFetch('/api/trades', p).then(function(r) {
    tradesList = r.closed || [];
    tradesTotal = r.total || 0;
    renderTradesTable();
  });
}

// Override switchTab to load trades data when trades tab is opened
var _origSwitchTab = switchTab;
switchTab = function(tab, btn) {
  _origSwitchTab(tab, btn);
  if (tab === 'trades') loadTrades();
};

init();
</script>
</body>
</html>`
  .replace('<!--SIMULATOR-->', () => require('fs').readFileSync(require('path').join(__dirname, 'web', 'simulator.html'), 'utf8'))
  .replace('<!--SMC_ENGINE-->', () => require('fs').readFileSync(require('path').join(__dirname, 'web', 'smcEngine.js'), 'utf8'));
