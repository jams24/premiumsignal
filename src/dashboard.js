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
</style>
</head>
<body>
<div id="setup-overlay" class="setup-overlay">
  <div class="setup-card">
    <h2>Signal Command</h2>
    <p>Enter your dashboard API key to access live signals.</p>
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
      <button class="btn-sm" onclick="refreshAll()">Refresh</button>
      <button class="btn-sm" onclick="resetConfig()">Logout</button>
    </div>
  </div>

  <div class="tab-nav">
    <button class="tab-btn active" onclick="switchTab('signals',this)">Live Signals</button>
    <button class="tab-btn" onclick="switchTab('trades',this)">Trades & PnL</button>
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
    <div class="hours-bar" id="hours-bar">
      <span class="slab">Hours</span>
      <div class="hours-grid" id="hours-grid"></div>
      <div class="hours-legend">
        <span><span class="dot on"></span>Active</span>
        <span><span class="dot off"></span>Blocked</span>
        <button class="preset-btn" onclick="resetHoursToDefault()" style="padding:2px 8px;font-size:10px;margin-left:6px" title="Reset to Safe preset: block 5AM + 5-8PM WAT">Reset</button>
      </div>
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
      <span class="rule-title">Quality Gate (data-backed)</span>
      <span class="rule-item"><span class="rule-check">+</span> LONG: Momentum &gt;5% + neutral funding = 72% WR</span>
      <span class="rule-item"><span class="rule-check">+</span> LONG: OI &gt;15% + neutral funding = 78% WR</span>
      <span class="rule-item"><span class="rule-check">+</span> SHORT: OI + Momentum = 100% WR (score 70+)</span>
      <span class="rule-item"><span class="rule-x">-</span> Weak signals (no OI, no momentum, no flow) = 27% WR</span>
      <span class="rule-item"><span class="rule-x">-</span> Short score &lt;70 = low WR, filtered out</span>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;font-family:var(--font-mono);padding:0 2px;">Signals = onchain alerts detected by scanner. P&L = simulated profit if you entered at alert price. Not live bot trades.</div>
    <div class="refresh-bar">
      <span class="refresh-left">
        <span id="refresh-timer">Updated just now</span>
        <span style="margin-left:10px;font-size:10px;color:var(--muted)">Window:</span>
        <button class="preset-btn" data-hours="24" onclick="setSignalHours(this)" style="padding:2px 8px;font-size:10px">24h</button>
        <button class="preset-btn active" data-hours="48" onclick="setSignalHours(this)" style="padding:2px 8px;font-size:10px">48h</button>
        <button class="preset-btn" data-hours="168" onclick="setSignalHours(this)" style="padding:2px 8px;font-size:10px">7d</button>
        <button class="preset-btn" data-hours="720" onclick="setSignalHours(this)" style="padding:2px 8px;font-size:10px">30d</button>
      </span>
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
    <div id="signals-pagination" style="display:flex;justify-content:center;align-items:center;gap:10px;margin:12px 0;font-family:var(--font-mono);font-size:12px;color:var(--muted)"></div>
    <div id="flow-section" hidden>
      <div style="margin-top:16px;padding:8px 0;border-top:1px solid var(--border)">
        <div style="font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px">Raw Flow & Supply Alerts</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-family:var(--font-mono)">Early detection signals from exchange flow and supply moves. No score — use as confirmation alongside scored signals.</div>
      </div>
      <div class="signals-grid" id="flow-grid"></div>
    </div>
  </div>

  <!-- TRADES TAB -->
  <div class="tab-panel" id="tab-trades">
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
          <h3>📈 Technical Analysis — SMC Concepts</h3><span class="edu-arrow">▼</span>
        </div>
        <div class="edu-body">

          <div class="edu-term">
            <h4>Candlestick Basics — Reading the Chart</h4>
            <div class="what">Every candle on a chart tells you a mini story: where the price started, where it ended, and how high/low it went in between. A green candle means price went UP during that time, a red candle means it went DOWN.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Anatomy of a Candlestick</div>
              <canvas id="candle-anatomy" width="600" height="280" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#22c55e;display:inline-block"></span> Bullish (price went up)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#ef4444;display:inline-block"></span> Bearish (price went down)</span>
              </div>
            </div>
            <div class="how"><strong>Reading candles:</strong><br>
              <strong>Body</strong> = The thick rectangle. Shows open → close range. A tall body = strong move, a tiny body = indecision.<br>
              <strong>Wick (shadow)</strong> = The thin lines above and below. Shows the highest and lowest price during that period.<br>
              <strong>Long upper wick</strong> = Price tried to go higher but got rejected (sellers pushed it back down).<br>
              <strong>Long lower wick</strong> = Price tried to go lower but got rejected (buyers stepped in).<br>
              <strong>No wick</strong> = Full conviction — price moved in one direction without any pushback.</div>
            <div class="example">A candle with a tiny body and a long lower wick at support? That's a "hammer" — buyers rejected the move down hard. Bullish signal.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Market Structure — Higher Highs & Lower Lows</h4>
            <div class="what">Market structure is the backbone of everything. Price moves in waves — up, pull back, up higher (uptrend) or down, bounce, down lower (downtrend). Each wave creates a swing high and a swing low. By connecting these swings you can see the trend.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Uptrend vs Downtrend Structure</div>
              <canvas id="market-structure" width="600" height="260" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
            </div>
            <div class="how">
              <strong>Uptrend</strong> = Price makes Higher Highs (HH) and Higher Lows (HL). Each push up goes further than the last, each pullback stays above the previous low.<br><br>
              <strong>Downtrend</strong> = Price makes Lower Highs (LH) and Lower Lows (LL). Each push down goes further, each bounce fails to reach the previous high.<br><br>
              <strong>Think of it like stairs:</strong> Uptrend = climbing stairs (each step higher). Downtrend = walking downstairs (each step lower). As long as the staircase pattern holds, the trend is intact.
            </div>
            <div class="example">Our bot checks for HH/HL on the 4H chart to confirm uptrend before entering longs. No higher highs = no long entry.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>BOS — Break of Structure</h4>
            <div class="what">BOS happens when price breaks through a previous swing point IN THE DIRECTION of the current trend. It's the market saying "the trend continues." In an uptrend, BOS = price breaks above a previous high. In a downtrend, BOS = price breaks below a previous low.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Break of Structure (BOS) — Trend Continuation</div>
              <canvas id="bos-chart" width="600" height="280" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:3px;background:#3b82f6;display:inline-block"></span> BOS line (previous high broken)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block"></span> Swing points (HH / HL)</span>
              </div>
            </div>
            <div class="how"><strong>How to use BOS:</strong><br>
              1. Identify the trend direction using HH/HL or LH/LL<br>
              2. Mark the most recent swing high (uptrend) or swing low (downtrend)<br>
              3. When price closes ABOVE that high (uptrend) = BOS confirmed<br>
              4. After BOS, look for a pullback to enter a trade in the trend direction<br><br>
              <strong>Key rule:</strong> BOS must be a candle CLOSE beyond the level, not just a wick. A wick that pokes above then comes back = fake breakout, not BOS.</div>
            <div class="example">In the video screenshot: each green circle marks a BOS where price broke above the previous swing high, confirming the uptrend continues.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>CHoCH — Change of Character</h4>
            <div class="what">CHoCH is the OPPOSITE of BOS — it happens when price breaks structure AGAINST the current trend. It's the first warning sign that the trend is reversing. In an uptrend, CHoCH = price breaks below a previous swing low. This is where smart money starts shifting direction.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Change of Character (CHoCH) — Trend Reversal Signal</div>
              <canvas id="choch-chart" width="600" height="300" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:3px;background:#f59e0b;display:inline-block"></span> CHoCH line (trend break)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:3px;background:#3b82f6;display:inline-block"></span> BOS (trend continuation)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;display:inline-block"></span> Failed high = reversal signal</span>
              </div>
            </div>
            <div class="how"><strong>BOS vs CHoCH — the simple rule:</strong><br>
              <strong>BOS</strong> = Break WITH the trend → "Trend continues, look for entries"<br>
              <strong>CHoCH</strong> = Break AGAINST the trend → "Trend might be reversing, be careful"<br><br>
              <strong>How to trade CHoCH:</strong><br>
              1. Uptrend is making HH/HL → price fails to make a new HH<br>
              2. Price then breaks below the last HL → that's the CHoCH<br>
              3. Wait for a retest of the broken level (now resistance)<br>
              4. Enter SHORT after the retest confirms → new downtrend begins<br><br>
              <strong>Warning:</strong> Not every CHoCH leads to a full reversal. Sometimes it's just a deeper pullback. Confirm with volume, OI, and funding data.</div>
            <div class="example">In the screenshot: "failed to make a new high" at $105 → price breaks below the CHoCH level → downtrend begins. The orange dashed lines mark the CHoCH points.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Order Blocks — Where Smart Money Enters</h4>
            <div class="what">An Order Block (OB) is the last candle before a strong move. It's where institutional traders placed their big orders. When price comes back to that zone, those same institutions defend it because they have money there. Think of it as a "VIP zone" on the chart.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Order Block — Institutional Entry Zone</div>
              <canvas id="ob-chart" width="600" height="260" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:8px;background:rgba(99,102,241,0.25);border:1px solid #6366f1;display:inline-block"></span> Bullish Order Block zone</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#22c55e;display:inline-block"></span> Strong impulse move</span>
              </div>
            </div>
            <div class="how"><strong>Bullish OB:</strong> The last RED candle before a strong green move UP. When price returns to this zone → buy.<br>
              <strong>Bearish OB:</strong> The last GREEN candle before a strong red move DOWN. When price returns → sell.<br><br>
              <strong>Why it works:</strong> Big institutions can't fill all their orders at once (too large). They buy some, push price up, then wait for price to come back to buy more at the same level. The order block IS their unfilled orders waiting.<br><br>
              <strong>How to find them:</strong><br>
              1. Find a strong impulsive move (3+ candles same direction)<br>
              2. Look at the last opposite-color candle BEFORE that move<br>
              3. Mark the body of that candle — that's your Order Block zone<br>
              4. When price pulls back to that zone → enter in the impulse direction</div>
            <div class="example">Our bot's demand zones are essentially order blocks — price zones where accumulation happened before a breakout.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>FVG — Fair Value Gap (Imbalance)</h4>
            <div class="what">A Fair Value Gap is a gap between candle wicks where price moved so fast it left an empty space. Nobody traded in that zone — it's "unfair" pricing. Price tends to come back and fill these gaps before continuing. Think of it like skipping a step on the stairs — you usually go back to step on it.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Fair Value Gap — Price Imbalance Zone</div>
              <canvas id="fvg-chart" width="600" height="260" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:12px;height:8px;background:rgba(245,158,11,0.2);border:1px solid #f59e0b;display:inline-block"></span> Fair Value Gap (unfilled zone)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#3b82f6;display:inline-block"></span> Price returns to fill gap</span>
              </div>
            </div>
            <div class="how"><strong>How FVG forms:</strong><br>
              Three candles: Candle 1's HIGH doesn't overlap Candle 3's LOW. The space between them = FVG.<br><br>
              <strong>Bullish FVG:</strong> Gap created during a strong move UP. Price may pull back into this gap before continuing higher. Enter long when price touches the gap zone.<br>
              <strong>Bearish FVG:</strong> Gap created during a strong move DOWN. Price may bounce into this gap before dropping further. Enter short when price touches the gap zone.<br><br>
              <strong>Pro tip:</strong> FVGs in the direction of the higher timeframe trend are more likely to act as support/resistance. FVGs against the trend often get fully filled and broken.</div>
            <div class="example">When our bot sees a big green candle with a gap between wick 1 high and wick 3 low — that FVG zone becomes a potential re-entry point on the pullback.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>Putting It All Together — The SMC Trade Setup</h4>
            <div class="what">Smart Money Concepts (SMC) combine all these tools into one framework. Here's the step-by-step checklist our bot uses to find high-probability entries.</div>
            <div class="how">
              <strong>Step 1: Identify the trend</strong> — Is the 4H chart making HH/HL (uptrend) or LH/LL (downtrend)?<br><br>
              <strong>Step 2: Wait for BOS</strong> — Has price broken the previous swing high/low? This confirms the trend is still active.<br><br>
              <strong>Step 3: Look for Order Block</strong> — After BOS, mark the last opposite candle. Price should pull back to this zone.<br><br>
              <strong>Step 4: Check for CHoCH</strong> — If price fails to make a new HH and breaks below the last HL → CHoCH. DON'T enter longs. Wait for short setup.<br><br>
              <strong>Step 5: Confirm with data</strong> — Check OI, funding, L/S ratio, exchange flow. Does the data agree with the chart structure?<br><br>
              <strong>Step 6: Enter at discount</strong> — Enter at the Order Block or FVG zone with a tight stop below the structure. Don't chase — let price come to you.
            </div>
            <div class="example">Perfect setup: 4H uptrend (HH/HL) → BOS confirmed → pullback to order block → OI rising + funding neutral + whale outflows = HIGH confidence long entry.</div>
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
            <div class="edu-diagram">
              <div class="edu-diagram-title">Liquidity Sweep Pattern — What to Look For</div>
              <canvas id="sweep-chart" width="600" height="220" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto"></canvas>
              <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text2);margin-top:8px">
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#22c55e;display:inline-block"></span> 1. Consolidation near support</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#ef4444;display:inline-block"></span> 2. Sweep wick below (stops triggered)</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#22c55e;display:inline-block"></span> 3. V-shape bounce reclaims</span>
                <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#6366f1;display:inline-block"></span> 4. Enter on consolidation</span>
              </div>
            </div>
            <div class="how"><strong>How to trade it:</strong><br>1. Wait for the sweep (quick wick below support)<br>2. Watch for immediate recovery above the sweep level<br>3. Enter on the consolidation base that forms after the bounce<br>4. Place stop below the sweep low — tight and structural<br>5. Never chase the initial vertical green candle</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>L/S Ratio Divergence (Retail Trap)</h4>
            <div class="what">The Long/Short ratio shows how many traders are long vs short. The key is comparing RETAIL positions vs TOP TRADER positions.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">How to Read L/S Ratios on CoinGlass</div>
              <div class="edu-scale" style="margin:8px 0 4px">
                <span style="background:rgba(239,68,68,0.3);color:var(--danger)">0.5</span>
                <span style="background:rgba(239,68,68,0.15);color:var(--danger)">0.7</span>
                <span style="background:rgba(239,68,68,0.08);color:var(--text2)">0.85</span>
                <span style="background:rgba(100,100,100,0.1);color:var(--text)">1.0</span>
                <span style="background:rgba(34,197,94,0.08);color:var(--text2)">1.15</span>
                <span style="background:rgba(34,197,94,0.15);color:var(--green)">1.5</span>
                <span style="background:rgba(34,197,94,0.3);color:var(--green)">2.0+</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:10px"><span>← Extremely Bearish</span><span>Neutral</span><span>Extremely Bullish →</span></div>
              <div class="edu-metric-grid">
                <div class="edu-metric-card">
                  <h5>Retail L/S (Accounts)</h5>
                  <p>How many retail ACCOUNTS are long vs short. Below 1.0 = more shorts than longs. <strong>This is the "crowd" — you usually want to be on the opposite side.</strong></p>
                  <div class="example">SYN example: Retail 0.74 = retail heavily short → potential squeeze UP</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Top Trader L/S (Accounts)</h5>
                  <p>How many TOP TRADER (whale) accounts are long vs short. These are the big players with higher win rates. <strong>Follow their direction.</strong></p>
                  <div class="example">SYN example: Whale 0.79 = whales also cautious but LESS bearish than retail</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Top Trader L/S (Positions)</h5>
                  <p>The DOLLAR VALUE of whale positions long vs short. A whale with $1M long vs 10 small shorts matters more. <strong>This is the money-weighted signal.</strong></p>
                  <div class="example">SYN example: Position 0.965 = whale money nearly neutral → watching, not committed</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Smart Money Sentiment</h5>
                  <p>CoinGlass combines all whale signals into one label. When retail is bearish but Smart Money says <strong style="color:var(--green)">Bullish</strong> — that's the divergence signal.</p>
                  <div class="example">SYN: Retail "Extremely Bearish" + Smart Money "Bullish" = classic squeeze setup</div>
                </div>
              </div>
            </div>
            <div class="how"><strong>The classic squeeze setup:</strong><br>• Overall retail L/S ratio drops below 0.85 (retail is crowded short)<br>• Top Trader L/S ratio sits above 1.50 (smart money is stacked long)<br>• Retail keeps trying to short the top while big accounts absorb every sell<br>• Result: A violent squeeze upward as retail shorts get liquidated<br><br><strong>The reverse works too:</strong><br>• Retail L/S above 2.0 (everyone is long) + Top traders below 0.7 = dump incoming</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>OI vs Spot Volume (Real vs Fake Moves)</h4>
            <div class="what">A sustainable breakout needs real spot buying behind it. If Open Interest surges but spot volume is dead, the move is pure leverage and will collapse violently.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Real Breakout vs Leverage Trap — How to Tell</div>
              <div class="edu-vs">
                <div class="edu-vs-col bull">
                  <strong style="color:var(--green)">✅ Real Breakout</strong><br><br>
                  <strong>Volume:</strong> Futures +500% AND Spot high<br>
                  <strong>OI:</strong> Rising (+50-300%)<br>
                  <strong>Spot Vol:</strong> Expanding, above average<br>
                  <strong>Funding:</strong> Mild positive (<0.05%)<br>
                  <strong>Liquidations:</strong> Both sides active<br><br>
                  <em style="color:var(--green)">Money is flowing in from BOTH futures and spot. Real buying supports the move.</em>
                </div>
                <div class="edu-vs-divider">vs</div>
                <div class="edu-vs-col bear">
                  <strong style="color:var(--danger)">❌ Leverage Trap</strong><br><br>
                  <strong>Volume:</strong> Futures +3000% but Spot flat<br>
                  <strong>OI:</strong> Exploding (+300%+)<br>
                  <strong>Spot Vol:</strong> Dead, way below futures<br>
                  <strong>Funding:</strong> Extreme (>0.1%)<br>
                  <strong>Liquidations:</strong> One-sided (shorts only)<br><br>
                  <em style="color:var(--danger)">Pure leverage. One candle the other way wipes everyone out.</em>
                </div>
              </div>
              <div class="example">SYN right now: Futures Vol $640M vs Spot Vol $62M (10:1 ratio!) + OI +330% — heavy leverage, check spot carefully before entry</div>
            </div>
            <div class="how"><strong>Real breakout:</strong> Spot volume expanding + OI rising = Both leverage AND real buying. The move has legs.<br><br><strong>Fake breakout (leverage trap):</strong> OI surging + flat/low spot volume = Only leveraged positions driving the move. One big candle in the other direction wipes everyone out.<br><br><strong>Rule:</strong> Never chase a pump that only shows in futures. Check spot volume first.</div>
          </div>
          <hr class="edu-divider">

          <div class="edu-term">
            <h4>CoinGlass Quick Reference — Reading the Numbers</h4>
            <div class="what">CoinGlass shows derivatives data for every coin. Here's what each metric means and how our bot uses them.</div>
            <div class="edu-diagram">
              <div class="edu-diagram-title">Key Metrics on the CoinGlass Overview Page</div>
              <div class="edu-metric-grid">
                <div class="edu-metric-card">
                  <h5>Futures Vol (24h)</h5>
                  <p>Total futures trading volume across all exchanges. Huge spikes (+1000%+) mean the coin is in play. Compare to Spot Vol — if futures dwarfs spot, the move is leveraged.</p>
                  <div class="example">SYN: $640M futures vs $62M spot = 10:1 leverage ratio — caution</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Open Interest</h5>
                  <p>Total value of all open futures positions. Rising OI = new money entering. Falling OI = positions closing. <strong>OI rising + price rising = strong trend.</strong> OI rising + price flat = building pressure.</p>
                  <div class="example">SYN: $25.7M OI (+330%) — massive new positions opened during pump</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Funding Rate</h5>
                  <p>Fee paid between longs and shorts every 8h. <strong>Positive = longs pay shorts</strong> (crowded long). <strong>Negative = shorts pay longs</strong> (crowded short). Extreme funding means the crowd will get squeezed.</p>
                  <div class="example">Normal: -0.01% to +0.01%. Extreme: >0.05% or <-0.05%</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Liquidations (1h/4h/24h)</h5>
                  <p>Dollar value of positions forcibly closed. Shows which side is getting wrecked. <strong>Heavy short liquidations = price pumping. Heavy long liquidations = price dumping.</strong></p>
                  <div class="example">SYN 4h: $70K long rekt vs $162K short rekt — shorts getting squeezed harder</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Taker Buy/Sell Volume</h5>
                  <p>Aggressive market orders — buys vs sells. 52%/48% split means slight buy pressure. <strong>>55% one side = strong directional pressure.</strong> Near 50/50 = no clear edge.</p>
                  <div class="example">SYN 4h: 52% buy ($65.8M) vs 48% sell ($60.6M) — mild buy pressure, not decisive</div>
                </div>
                <div class="edu-metric-card">
                  <h5>Volume vs OI Ratio</h5>
                  <p>High volume / low OI = traders quickly opening and closing (scalping). <strong>Low volume / high OI = positions being held</strong> — conviction trade. Compare both to daily averages.</p>
                  <div class="example">SYN: $640M vol / $25.7M OI = 25:1 ratio — very active trading, lots of scalps</div>
                </div>
              </div>
            </div>
            <div class="how"><strong>Our bot checks these automatically:</strong><br>• OI change 1h/4h → detects unusual position buildup<br>• Funding rate + bias → identifies crowded trades<br>• L/S ratio (accounts + positions) → spots retail vs whale divergence<br>• Exchange flow data → tracks whale wallet movements<br><br><strong>What to check manually on CoinGlass:</strong><br>• Liquidation heatmap (where are the stop clusters?)<br>• Futures vs Spot volume ratio (is the move real or leveraged?)<br>• Taker buy/sell balance (who's aggressively executing?)</div>
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
  short_low_score: { label: 'Low-score short', accuracy: 29, desc: 'Short with score <70 = low WR', negative: true },
};

var HOUR_WR = [60,46,60,50,19,40,50,62,45,29,50,42,33,39,33,35,18,42,17,45,60,53,33,67];
var DEFAULT_BLOCKED = [4,16,17,18];
var blockedHours = [];

function loadHours() {
  try {
    var s = JSON.parse(localStorage.getItem('sc_hours'));
    if (Array.isArray(s)) { blockedHours = s; return; }
  } catch(e) {}
  blockedHours = DEFAULT_BLOCKED.slice();
}
function saveHours() {
  localStorage.setItem('sc_hours', JSON.stringify(blockedHours));
}
function toggleHour(h) {
  var idx = blockedHours.indexOf(h);
  if (idx >= 0) blockedHours.splice(idx, 1);
  else blockedHours.push(h);
  saveHours();
  markDailyBlocked(signals);
  renderHoursGrid();
}
function resetHoursToDefault() {
  blockedHours = DEFAULT_BLOCKED.slice();
  saveHours();
  markDailyBlocked(signals);
  renderHoursGrid();
  renderSignals();
}
function renderHoursGrid() {
  var grid = document.getElementById('hours-grid');
  if (!grid) return;
  var nowH = new Date().getUTCHours();
  var html = '';
  for (var h = 0; h < 24; h++) {
    var wat = (h + 1) % 24;
    var isBlocked = blockedHours.indexOf(h) >= 0;
    var cls = isBlocked ? 'blocked' : 'active';
    var ampm = wat >= 12 ? 'PM' : 'AM';
    var h12 = wat % 12 || 12;
    var wr = HOUR_WR[h];
    var wrColor = wr >= 55 ? 'var(--accent)' : wr < 35 ? 'var(--danger)' : 'var(--text2)';
    html += '<div class="hour-cell ' + cls + '" onclick="toggleHour(' + h + ')" style="position:relative">';
    if (h === nowH) html += '<div class="hours-now"></div>';
    html += '<span style="font-size:7px">' + wat + '</span>';
    html += '<span class="hour-tip">' + h12 + ampm + ' WAT (' + h + ':00 UTC)<br>WR: <b style="color:' + wrColor + '">' + wr + '%</b>' + (isBlocked ? '<br><b style="color:var(--danger)">BLOCKED</b> — click to enable' : '<br>Active — click to block') + '</span>';
    html += '</div>';
  }
  grid.innerHTML = html;
}

var apiKey = '', signals = [], flowAlerts = [], patterns = {}, trades = {}, currentFilter = 'high', lastUpdate = 0, refreshInterval;
var signalHours = 48, signalPage = 1, signalPageSize = 30;

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

function init() {
  loadSizing();
  loadHours();
  renderHoursGrid();
  var saved = null;
  try { saved = localStorage.getItem('sc_key'); } catch(e) {}
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
  var errEl = document.getElementById('login-error');
  var btn = document.querySelector('.setup-card button');
  btn.textContent = 'Connecting...'; btn.disabled = true;
  errEl.style.display = 'none';
  fetch('/api/signals?key=' + encodeURIComponent(key) + '&hours=1&minScore=0')
    .then(function(r) {
      if (r.status === 401) {
        errEl.textContent = 'Invalid key. Check your DASHBOARD_KEY and try again.';
        errEl.style.display = 'block';
        btn.textContent = 'Connect'; btn.disabled = false;
        return;
      }
      apiKey = key;
      try { localStorage.setItem('sc_key', key); } catch(e) {}
      document.getElementById('setup-overlay').hidden = true;
      document.getElementById('main-app').hidden = false;
      updateSizingUI();
      refreshAll();
      refreshInterval = setInterval(refreshAll, 300000);
      setInterval(updateTimer, 10000);
    })
    .catch(function(e) {
      errEl.textContent = 'Connection failed: ' + e.message;
      errEl.style.display = 'block';
      btn.textContent = 'Connect'; btn.disabled = false;
    });
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
    apiFetch('/api/signals', { hours: signalHours, minScore: 40 }),
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
    markDailyBlocked(signals);
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
  renderHoursGrid();
}

function renderStats() {
  var bar = document.getElementById('stats-bar');
  var shortPat = patterns.find(function(p) { return p.direction === 'short'; }) || {};
  var longPat = patterns.find(function(p) { return p.direction === 'long'; }) || {};
  var shortAcc = shortPat.with_data > 0 ? ((parseInt(shortPat.correct) / parseInt(shortPat.with_data)) * 100).toFixed(0) : '—';
  var longAcc = longPat.with_data > 0 ? ((parseInt(longPat.correct) / parseInt(longPat.with_data)) * 100).toFixed(0) : '—';
  var highConv = signals.filter(function(s) { return getConviction(s) === 'high'; }).length;

  var filtered = SCORE_FILTER > 0 ? signals.filter(function(s) { return (parseInt(s.score) || 0) >= SCORE_FILTER; }) : signals;
  var simTotal = 0, simWins = 0, simLosses = 0, winCount = 0, lossCount = 0, blockedCount = 0;
  filtered.forEach(function(s) {
    if (s._dailyBlocked) { blockedCount++; return; }
    var sigHour = new Date(s.created_at).getUTCHours();
    if (blockedHours.indexOf(sigHour) >= 0) return;
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
    '<div class="stat-card"><div class="stat-label">Sim Total' + scoreLabel + '</div><div class="stat-value ' + (simTotal >= 0 ? 'green' : 'red') + '">' + (simTotal >= 0 ? '+' : '') + '$' + simTotal.toFixed(0) + '</div><div class="stat-sub">$' + MARGIN + '/' + LEVERAGE + 'x · ' + (winCount + lossCount) + ' traded' + (blockedCount ? ' · ' + blockedCount + ' blocked' : '') + '</div></div>';
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
    if (score < 70) return 'low';
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
  if (dir === 'short' && score < 70) matched.push('short_low_score');
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
    var volEst = Math.min(Math.max(absPc * 0.3, 3), 12);
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

  // Breakeven protection: real executor trails SL to breakeven at +5%
  var peakMovePct = dir === 'long' ? ((peak - entry) / entry) * 100 : ((entry - trough) / entry) * 100;
  var beProtected = peakMovePct >= 5;

  // Check if price reverted past trailing SL after TP hit or BE protection (trade is done)
  var reverted = false;
  if (dir === 'long') {
    if (hitTP3 && now < levels.tp2) reverted = true;
    else if (hitTP2 && now < levels.tp1) reverted = true;
    else if ((hitTP1 || beProtected) && now < entry) reverted = true;
  } else {
    if (hitTP3 && now > levels.tp2) reverted = true;
    else if (hitTP2 && now > levels.tp1) reverted = true;
    else if ((hitTP1 || beProtected) && now > entry) reverted = true;
  }

  var status, css, tip;
  if (reverted && hitTP3) { status = 'BANKED'; css = 'played'; tip = 'Trade done — all TPs hit, trail closed remaining at TP2'; }
  else if (reverted && hitTP2) { status = 'BANKED'; css = 'played'; tip = 'Trade done — TP1+TP2 banked, trail closed remaining at TP1'; }
  else if (reverted && hitTP1) { status = 'BANKED'; css = 'played'; tip = 'Trade done — TP1 banked, remaining closed at breakeven'; }
  else if (reverted && beProtected) { status = 'BE CLOSE'; css = 'played'; tip = 'Trade done — hit +' + peakMovePct.toFixed(0) + '% then reversed, SL trailed to breakeven'; }
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

  var peakMovePct = dir === 'long' ? ((peak - entry) / entry) * 100 : ((entry - trough) / entry) * 100;
  var beProtected = peakMovePct >= 5;

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
  if ((hitTP1 || beProtected) && remainPct < 0) remainPct = 0;
  if (hitTP2 && remainPct < pctAt(levels.tp1)) remainPct = pctAt(levels.tp1);
  totalPct += remaining * remainPct;

  var pnl = (totalPct / 100) * NOTIONAL;
  return { pnl: pnl, pct: totalPct };
}

function markDailyBlocked(sigs) {
  var sorted = sigs.slice().sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
  var tradedToday = {};
  sorted.forEach(function(s) {
    s._dailyBlocked = false;
    var dt = new Date(s.created_at);
    var shifted = new Date(dt.getTime() - 3600000);
    var dayKey = shifted.toISOString().slice(0, 10);
    var sym = (s.symbol || '').toUpperCase();
    var key = dayKey + ':' + sym;
    var inDeadHour = blockedHours.indexOf(dt.getUTCHours()) >= 0;
    if (inDeadHour) {
      if (tradedToday[key]) s._dailyBlocked = true;
      return;
    }
    if (tradedToday[key]) {
      var prev = tradedToday[key];
      var isFlip = prev.direction !== s.direction;
      if (isFlip && (parseInt(s.score) || 0) >= 70) {
        tradedToday[key] = { direction: s.direction };
      } else {
        s._dailyBlocked = true;
      }
    } else {
      tradedToday[key] = { direction: s.direction };
    }
  });
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
    document.getElementById('signals-pagination').innerHTML = '';
    return;
  }

  // Paginate
  var totalFiltered = filtered.length;
  var totalPages = Math.max(1, Math.ceil(totalFiltered / signalPageSize));
  if (signalPage > totalPages) signalPage = totalPages;
  var startIdx = (signalPage - 1) * signalPageSize;
  var pageSlice = filtered.slice(startIdx, startIdx + signalPageSize);

  var pgEl = document.getElementById('signals-pagination');
  if (totalPages > 1) {
    pgEl.innerHTML = '<button class="preset-btn" onclick="signalGoPage(-1)"' + (signalPage <= 1 ? ' disabled style="opacity:0.3"' : '') + '>&lt; Prev</button>' +
      '<span>' + (startIdx + 1) + '-' + Math.min(startIdx + signalPageSize, totalFiltered) + ' of ' + totalFiltered + ' signals (Page ' + signalPage + '/' + totalPages + ')</span>' +
      '<button class="preset-btn" onclick="signalGoPage(1)"' + (signalPage >= totalPages ? ' disabled style="opacity:0.3"' : '') + '>Next &gt;</button>';
  } else {
    pgEl.innerHTML = '<span>' + totalFiltered + ' signals</span>';
  }

  grid.innerHTML = pageSlice.map(function(s, i) {
    i = startIdx + i;
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

    var sigHourUTC = new Date(s.created_at).getUTCHours();
    var inDeadHour = blockedHours.indexOf(sigHourUTC) >= 0;
    var isDailyBlocked = !!s._dailyBlocked;
    var cardClass = 'signal-card conviction-' + conv + (inDeadHour ? ' dead-hour' : '') + (isDailyBlocked ? ' daily-limit' : '');
    var html = '<div class="' + cardClass + '" id="' + id + '">';
    html += '<div class="signal-header" onclick="toggleCard(\\'' + id + '\\')">';
    html += '<div class="signal-left">';
    html += '<span class="signal-dir ' + s.direction + '">' + s.direction + '</span>';
    if (inDeadHour) html += '<span class="status-badge stopped" title="Signal during blocked hour (' + sigHourUTC + ':00 UTC)">DEAD HR</span>';
    if (isDailyBlocked) html += '<span class="status-badge daily-limit" title="One trade per coin per day — already traded this session">1/DAY</span>';
    html += '<span class="status-badge ' + ts.css + '">' + ts.status + '</span>';
    html += '<span class="signal-symbol">' + s.symbol + '</span>';
    html += '<span class="signal-price">' + fmtPrice(s.price) + ' → ' + fmtPrice(ts.currentPrice) + ' · ' + agoStr + '</span>';
    html += '</div><div class="signal-right">';
    if (isDailyBlocked) {
      html += '<span class="signal-pnl" style="color:var(--muted);text-decoration:line-through">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span>';
    } else {
      html += '<span class="signal-pnl ' + pnlClass + '">' + pnlSign + '$' + Math.abs(sim.pnl).toFixed(0) + '</span>';
    }
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

function setSignalHours(btn) {
  document.querySelectorAll('[data-hours]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  signalHours = parseInt(btn.dataset.hours) || 48;
  signalPage = 1;
  refreshAll();
}

function signalGoPage(delta) {
  signalPage += delta;
  if (signalPage < 1) signalPage = 1;
  renderSignals();
  document.getElementById('signals-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function drawSweepChart() {
  var c = document.getElementById('sweep-chart');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 220 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 220, pad = 40;
  var green = '#22c55e', red = '#ef4444', accent = '#6366f1', muted = '#666';

  // Candle data: [open, close, high, low] — normalized 0-100 scale
  var candles = [
    [52,58,62,48], [55,60,64,52], [58,62,66,54], [60,57,63,53],  // consolidation
    [57,54,59,50], [54,48,56,46], [48,38,50,18],                  // sweep down
    [36,56,58,20],                                                  // recovery candle
    [56,60,62,54], [60,62,63,58],                                  // entry zone
    [62,66,68,60], [66,72,74,64], [72,78,82,70], [78,85,88,76]    // rally up
  ];
  var cw = 16, gap = (W - pad * 2 - candles.length * cw) / (candles.length - 1);
  function y(v) { return pad + (H - pad * 2) * (1 - v / 100); }

  // Support line at 50
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(pad - 10, y(50)); ctx.lineTo(W - 10, y(50)); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.font = '600 11px system-ui'; ctx.fillStyle = accent;
  ctx.fillText('Support', W - 55, y(50) - 5);

  // Stop loss zone
  ctx.fillStyle = 'rgba(239,68,68,0.06)';
  ctx.fillRect(pad - 10, y(50), W - pad - 20, y(15) - y(50));
  ctx.font = '10px system-ui'; ctx.fillStyle = '#ef444480';
  ctx.fillText('Stop losses below here', W - 155, y(35));

  // Draw candles
  candles.forEach(function(d, i) {
    var x = pad + i * (cw + gap);
    var o = d[0], cl = d[1], hi = d[2], lo = d[3];
    var isGreen = cl >= o;
    var color = isGreen ? green : red;
    var top = Math.max(o, cl), bot = Math.min(o, cl);
    // Wick
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + cw / 2, y(hi)); ctx.lineTo(x + cw / 2, y(lo)); ctx.stroke();
    // Body
    ctx.fillStyle = color;
    var bodyH = Math.max(y(bot) - y(top), 2);
    ctx.fillRect(x + 2, y(top), cw - 4, bodyH);
  });

  // Label: SWEEP arrow
  var sweepX = pad + 6 * (cw + gap) + cw / 2;
  ctx.strokeStyle = red; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(sweepX, y(10)); ctx.lineTo(sweepX, y(2)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sweepX - 4, y(6)); ctx.lineTo(sweepX, y(2)); ctx.lineTo(sweepX + 4, y(6)); ctx.stroke();
  ctx.font = 'bold 11px system-ui'; ctx.fillStyle = red; ctx.textAlign = 'center';
  ctx.fillText('SWEEP', sweepX, H - 5);

  // Label: ENTRY
  var entryX = pad + 9 * (cw + gap) + cw / 2;
  ctx.fillStyle = accent; ctx.textAlign = 'center';
  ctx.fillText('ENTRY', entryX, y(66));
  ctx.strokeStyle = accent; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(entryX - 16, y(62)); ctx.lineTo(entryX + 16, y(62)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(entryX + 12, y(63)); ctx.lineTo(entryX + 16, y(62)); ctx.lineTo(entryX + 12, y(61)); ctx.stroke();

  // Label: Higher Low
  var hlX = pad + 8 * (cw + gap) + cw / 2;
  ctx.font = '10px system-ui'; ctx.fillStyle = green; ctx.textAlign = 'center';
  ctx.fillText('Higher Low', hlX, y(48));

  // Price labels
  ctx.font = '9px system-ui'; ctx.fillStyle = muted; ctx.textAlign = 'right';
  ctx.fillText('High', pad - 14, y(85)); ctx.fillText('Support', pad - 14, y(50)); ctx.fillText('Low', pad - 14, y(18));

  ctx.textAlign = 'left';
}

// --- Shared helpers for edu charts ---
function drawPill(ctx, x, y, text, color, bg) {
  ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
  var w = ctx.measureText(text).width + 14, h = 18, r = 9;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(x - w/2 + r, y - h/2);
  ctx.arcTo(x + w/2, y - h/2, x + w/2, y + h/2, r);
  ctx.arcTo(x + w/2, y + h/2, x - w/2, y + h/2, r);
  ctx.arcTo(x - w/2, y + h/2, x - w/2, y - h/2, r);
  ctx.arcTo(x - w/2, y - h/2, x + w/2, y - h/2, r);
  ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, x, y + 4);
}
function drawGlowDot(ctx, x, y, r, color) {
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fill();
}
function drawCandle(ctx, x, cw, o, cl, hi, lo, yFn, color) {
  var top = Math.max(o, cl), bot = Math.min(o, cl);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + cw/2, yFn(hi)); ctx.lineTo(x + cw/2, yFn(lo)); ctx.stroke();
  ctx.fillStyle = color;
  var bodyH = Math.max(yFn(bot) - yFn(top), 2);
  ctx.fillRect(x + 2, yFn(top), cw - 4, bodyH);
}
function drawSmoothLine(ctx, pts, color, width) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) {
    var prev = pts[i - 1], cur = pts[i];
    var cpx = (prev.x + cur.x) / 2, cpy = (prev.y + cur.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}
function drawGradientUnder(ctx, pts, color, H) {
  if (pts.length < 2) return;
  ctx.save();
  var grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color.replace(')', ',0.15)').replace('rgb', 'rgba'));
  grad.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
  ctx.fillStyle = grad; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(pts[0].x, H);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length - 1].x, H);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// --- Candlestick Anatomy Diagram ---
function drawCandleAnatomy() {
  var c = document.getElementById('candle-anatomy');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 280 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 280;
  var green = '#22c55e', red = '#ef4444', muted = '#555', text = '#c8cdd5';

  // Subtle grid
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gy = 40; gy < H - 20; gy += 30) {
    ctx.beginPath(); ctx.moveTo(20, gy); ctx.lineTo(W - 20, gy); ctx.stroke();
  }

  // === BULLISH CANDLE ===
  var bx = 115, bw = 60;
  var bOpen = 185, bClose = 85, bHigh = 45, bLow = 230;

  // Glow behind candle
  ctx.save(); ctx.shadowColor = green; ctx.shadowBlur = 20; ctx.globalAlpha = 0.3;
  ctx.fillStyle = green; ctx.fillRect(bx, bClose, bw, bOpen - bClose);
  ctx.restore();

  // Wick
  ctx.strokeStyle = green; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(bx + bw/2, bHigh); ctx.lineTo(bx + bw/2, bLow); ctx.stroke();
  // Body with slight gradient
  var bGrad = ctx.createLinearGradient(bx, bClose, bx, bOpen);
  bGrad.addColorStop(0, '#34d399'); bGrad.addColorStop(1, '#059669');
  ctx.fillStyle = bGrad;
  ctx.fillRect(bx, bClose, bw, bOpen - bClose);
  // Body border
  ctx.strokeStyle = '#6ee7b7'; ctx.lineWidth = 1;
  ctx.strokeRect(bx, bClose, bw, bOpen - bClose);

  // Label lines + text (right side)
  var labelData = [
    {py: bHigh, txt: 'High', sub: 'Highest price reached', col: '#4ade80'},
    {py: bClose, txt: 'Close', sub: 'Where price ended', col: '#34d399'},
    {py: bOpen, txt: 'Open', sub: 'Where price started', col: '#059669'},
    {py: bLow, txt: 'Low', sub: 'Lowest price reached', col: '#4ade80'}
  ];
  labelData.forEach(function(l) {
    // Connector line
    ctx.strokeStyle = l.col; ctx.lineWidth = 1; ctx.globalAlpha = 0.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(bx + bw + 4, l.py); ctx.lineTo(bx + bw + 18, l.py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // Dot
    ctx.fillStyle = l.col;
    ctx.beginPath(); ctx.arc(bx + bw + 18, l.py, 3, 0, Math.PI * 2); ctx.fill();
    // Text
    ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#e5e7eb'; ctx.textAlign = 'left';
    ctx.fillText(l.txt, bx + bw + 26, l.py + 1);
    ctx.font = '10px system-ui'; ctx.fillStyle = muted;
    ctx.fillText(l.sub, bx + bw + 26, l.py + 14);
  });

  // Body & Wick labels on the candle
  ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#000'; ctx.textAlign = 'center';
  ctx.fillText('BODY', bx + bw/2, (bOpen + bClose) / 2 + 4);
  // Wick bracket labels
  ctx.font = '600 9px system-ui'; ctx.fillStyle = '#4ade8088'; ctx.textAlign = 'right';
  ctx.save(); ctx.translate(bx - 8, (bHigh + bClose) / 2); ctx.rotate(-Math.PI/2);
  ctx.fillText('UPPER WICK', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(bx - 8, (bOpen + bLow) / 2); ctx.rotate(-Math.PI/2);
  ctx.fillText('LOWER WICK', 0, 0); ctx.restore();

  // Title under
  ctx.font = 'bold 14px system-ui'; ctx.fillStyle = green; ctx.textAlign = 'center';
  ctx.fillText('BULLISH', bx + bw/2, H - 18);
  ctx.font = '11px system-ui'; ctx.fillStyle = muted;
  ctx.fillText('Price went UP', bx + bw/2, H - 4);

  // === BEARISH CANDLE ===
  var rx = 410, rw = 60;
  var rOpen = 85, rClose = 185, rHigh = 45, rLow = 230;

  // Glow
  ctx.save(); ctx.shadowColor = red; ctx.shadowBlur = 20; ctx.globalAlpha = 0.3;
  ctx.fillStyle = red; ctx.fillRect(rx, rOpen, rw, rClose - rOpen);
  ctx.restore();

  // Wick
  ctx.strokeStyle = red; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(rx + rw/2, rHigh); ctx.lineTo(rx + rw/2, rLow); ctx.stroke();
  // Body
  var rGrad = ctx.createLinearGradient(rx, rOpen, rx, rClose);
  rGrad.addColorStop(0, '#f87171'); rGrad.addColorStop(1, '#dc2626');
  ctx.fillStyle = rGrad;
  ctx.fillRect(rx, rOpen, rw, rClose - rOpen);
  ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 1;
  ctx.strokeRect(rx, rOpen, rw, rClose - rOpen);

  // Labels (left side)
  var rLabelData = [
    {py: rHigh, txt: 'High'},
    {py: rOpen, txt: 'Open'},
    {py: rClose, txt: 'Close'},
    {py: rLow, txt: 'Low'}
  ];
  rLabelData.forEach(function(l) {
    ctx.strokeStyle = '#f8717166'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(rx - 4, l.py); ctx.lineTo(rx - 18, l.py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath(); ctx.arc(rx - 18, l.py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#e5e7eb'; ctx.textAlign = 'right';
    ctx.fillText(l.txt, rx - 26, l.py + 4);
  });

  ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.fillText('BODY', rx + rw/2, (rOpen + rClose) / 2 + 4);

  ctx.font = 'bold 14px system-ui'; ctx.fillStyle = red; ctx.textAlign = 'center';
  ctx.fillText('BEARISH', rx + rw/2, H - 18);
  ctx.font = '11px system-ui'; ctx.fillStyle = muted;
  ctx.fillText('Price went DOWN', rx + rw/2, H - 4);

  // Center divider
  ctx.setLineDash([4, 6]); ctx.strokeStyle = '#252d3d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W/2, 25); ctx.lineTo(W/2, H - 30); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('VS', W/2, H/2);
}

// --- Market Structure Diagram ---
function drawMarketStructure() {
  var c = document.getElementById('market-structure');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 260 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 260;
  var green = '#22c55e', red = '#ef4444', muted = '#444', text = '#e5e7eb';

  // Grid
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gy = 50; gy < H - 10; gy += 25) {
    ctx.beginPath(); ctx.moveTo(15, gy); ctx.lineTo(W - 15, gy); ctx.stroke();
  }

  // Uptrend points (left half)
  var upPts = [
    {x: 25, y: 200}, {x: 65, y: 130}, {x: 105, y: 165}, {x: 155, y: 95},
    {x: 195, y: 130}, {x: 250, y: 62}
  ];
  // Downtrend points (right half)
  var dnPts = [
    {x: 330, y: 62}, {x: 370, y: 115}, {x: 408, y: 82}, {x: 445, y: 148},
    {x: 478, y: 115}, {x: 515, y: 178}, {x: 548, y: 148}, {x: 580, y: 210}
  ];

  // Gradient fill under lines
  drawGradientUnder(ctx, upPts, 'rgb(34,197,94)', H);
  drawGradientUnder(ctx, dnPts, 'rgb(239,68,68)', H);

  // Draw lines (smooth curves)
  drawSmoothLine(ctx, upPts, green, 3);
  drawSmoothLine(ctx, dnPts, red, 3);

  // Connecting arrows between highs (show the staircase)
  ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  ctx.strokeStyle = '#22c55e44';
  ctx.beginPath(); ctx.moveTo(65, 130); ctx.lineTo(155, 130); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(155, 95); ctx.lineTo(250, 95); ctx.stroke();
  ctx.setLineDash([]);

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ef444444';
  ctx.beginPath(); ctx.moveTo(370, 115); ctx.lineTo(478, 115); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(445, 148); ctx.lineTo(580, 148); ctx.stroke();
  ctx.setLineDash([]);

  // Swing points with glow
  var upLabels = ['', 'HH', 'HL', 'HH', 'HL', 'HH'];
  upPts.forEach(function(p, i) {
    if (!upLabels[i]) return;
    var isHigh = upLabels[i] === 'HH';
    drawGlowDot(ctx, p.x, p.y, 5, green);
    drawPill(ctx, p.x, isHigh ? p.y - 16 : p.y + 18, upLabels[i], green, 'rgba(34,197,94,0.15)');
  });

  var dnLabels = ['', 'LH', 'LH', 'LL', 'LH', 'LL', 'LH', 'LL'];
  dnPts.forEach(function(p, i) {
    if (!dnLabels[i]) return;
    var isHigh = dnLabels[i] === 'LH';
    drawGlowDot(ctx, p.x, p.y, 5, red);
    drawPill(ctx, p.x, isHigh ? p.y - 16 : p.y + 18, dnLabels[i], red, 'rgba(239,68,68,0.15)');
  });

  // Header pills
  drawPill(ctx, 145, 22, 'UPTREND', green, 'rgba(34,197,94,0.12)');
  ctx.font = '10px system-ui'; ctx.fillStyle = muted; ctx.textAlign = 'center';
  ctx.fillText('Higher Highs + Higher Lows', 145, 40);

  drawPill(ctx, 460, 22, 'DOWNTREND', red, 'rgba(239,68,68,0.12)');
  ctx.font = '10px system-ui'; ctx.fillStyle = muted; ctx.textAlign = 'center';
  ctx.fillText('Lower Highs + Lower Lows', 460, 40);

  // Divider
  ctx.setLineDash([4, 6]); ctx.strokeStyle = '#252d3d'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(290, 10); ctx.lineTo(290, H - 10); ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('Think of it like climbing stairs vs walking downstairs', W/2, H - 6);
}

// --- BOS Diagram (with candlesticks) ---
function drawBOSChart() {
  var c = document.getElementById('bos-chart');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 280 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 280, pad = 35;
  var green = '#22c55e', red = '#ef4444', blue = '#3b82f6', muted = '#444', text = '#e5e7eb';

  function y(v) { return pad + (H - pad * 2) * (1 - v / 100); }
  var cw = 18, gap = 5;
  function cx(i) { return 25 + i * (cw + gap); }

  // Candles forming an uptrend with BOS
  var candles = [
    [20,25,27,18],[25,28,30,23],[28,32,34,26],[32,30,34,28],  // base
    [30,34,36,28],[34,38,40,32],[38,35,40,33],[35,40,42,33],  // push up, BOS 1
    [40,37,42,35],[37,42,44,35],[42,45,48,40],[45,43,48,41],  // pullback + push, BOS 2
    [43,48,50,41],[48,52,55,46],[52,50,55,48],[50,55,58,48],  // push higher, BOS 3
    [55,53,58,51],[53,58,60,51],[58,62,65,56],[62,65,68,60],  // rally, BOS 4
    [65,63,68,61],[63,68,72,61],[68,72,75,66],[72,78,80,70]   // strong breakout
  ];

  // Grid lines
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gv = 20; gv <= 80; gv += 10) {
    ctx.beginPath(); ctx.moveTo(20, y(gv)); ctx.lineTo(W - 10, y(gv)); ctx.stroke();
  }

  // BOS level zones (horizontal band at each swing high before break)
  var bosZones = [
    {y1: 34, y2: 36, fromI: 2, toI: 7, breakI: 7},
    {y1: 42, y2: 44, fromI: 7, toI: 11, breakI: 11},
    {y1: 50, y2: 55, fromI: 11, toI: 15, breakI: 15},
    {y1: 60, y2: 65, fromI: 16, toI: 21, breakI: 21}
  ];
  bosZones.forEach(function(z) {
    // Zone fill
    ctx.fillStyle = 'rgba(59,130,246,0.06)';
    ctx.fillRect(cx(z.fromI), y(z.y2), cx(z.toI) + cw - cx(z.fromI), y(z.y1) - y(z.y2));
    // Dashed level line
    ctx.setLineDash([6, 4]); ctx.strokeStyle = blue; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4;
    var midY = y((z.y1 + z.y2) / 2);
    ctx.beginPath(); ctx.moveTo(cx(z.fromI), midY); ctx.lineTo(cx(z.toI) + cw, midY); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // BOS pill at break point
    drawPill(ctx, cx(z.breakI) + cw/2, midY, 'BOS', blue, 'rgba(59,130,246,0.18)');
  });

  // Draw candles
  candles.forEach(function(d, i) {
    var color = d[1] >= d[0] ? green : red;
    drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
  });

  // Price trajectory line (connecting closes)
  ctx.save();
  ctx.globalAlpha = 0.25; ctx.strokeStyle = green; ctx.lineWidth = 1.5;
  ctx.beginPath();
  candles.forEach(function(d, i) { var px = cx(i) + cw/2; i === 0 ? ctx.moveTo(px, y(d[1])) : ctx.lineTo(px, y(d[1])); });
  ctx.stroke();
  ctx.restore();

  // Header
  ctx.font = 'bold 12px system-ui'; ctx.fillStyle = green; ctx.textAlign = 'left';
  ctx.fillText('Each BOS confirms the trend is alive', 25, 18);
  ctx.font = '10px system-ui'; ctx.fillStyle = muted;
  ctx.fillText('Price breaks above the previous swing high → structure intact → look for pullback entries', 25, 32);

  // Bottom note
  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('BOS must be a candle CLOSE above the level — a wick poke is not enough', W/2, H - 6);
}

// --- CHoCH Diagram (with candlesticks) ---
function drawCHoCHChart() {
  var c = document.getElementById('choch-chart');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 300 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 300, pad = 35;
  var green = '#22c55e', red = '#ef4444', gold = '#f59e0b', blue = '#3b82f6', muted = '#444', text = '#e5e7eb';

  function y(v) { return pad + (H - pad * 2) * (1 - v / 100); }
  var cw = 16, gap = 4;
  function cx(i) { return 20 + i * (cw + gap); }

  // Candles: uptrend → failed HH → CHoCH → downtrend
  var candles = [
    [20,24,26,18],[24,28,30,22],[28,26,30,24],                // base
    [26,30,32,24],[30,34,36,28],[34,32,36,30],[32,36,38,30],  // push up
    [36,33,38,31],[33,38,40,31],[38,42,44,36],                // BOS 1, HH at ~44
    [42,39,44,37],[39,42,44,37],[42,46,48,40],                // pullback, BOS 2, HH at ~48
    [46,50,52,44],[50,48,52,46],[48,52,55,46],[52,56,58,50],  // strong push, HH at ~58
    [56,53,58,51],[53,50,55,48],[50,48,52,46],                // pullback to HL ~46
    [48,52,54,46],[52,54,56,50],[54,52,56,50],                // push up but...
    [52,50,54,48],[50,48,52,46],[48,44,50,42],                // FAILS to beat 58
    [44,40,46,38],[40,36,42,34],[36,34,38,32],[34,30,36,28],  // CHoCH breaks below 46
    [30,33,34,28],[33,28,34,26],[28,24,30,22]                 // downtrend continues
  ];

  // Grid
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gv = 20; gv <= 60; gv += 10) {
    ctx.beginPath(); ctx.moveTo(15, y(gv)); ctx.lineTo(W - 10, y(gv)); ctx.stroke();
  }

  // Previous HH level at 58
  ctx.setLineDash([3, 4]); ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx(14), y(58)); ctx.lineTo(cx(25), y(58)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#666'; ctx.textAlign = 'left';
  ctx.fillText('Previous HH', cx(14) + 2, y(58) - 5);

  // BOS zones in uptrend
  [[44, cx(8), cx(12)], [48, cx(11), cx(15)]].forEach(function(b) {
    ctx.setLineDash([5, 4]); ctx.strokeStyle = blue; ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(b[1], y(b[0])); ctx.lineTo(b[2], y(b[0])); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawPill(ctx, (b[1] + b[2]) / 2, y(b[0]) - 1, 'BOS', blue, 'rgba(59,130,246,0.15)');
  });

  // CHoCH zone — HL was at ~46, break below it
  var chochY = 46;
  ctx.fillStyle = 'rgba(245,158,11,0.06)';
  ctx.fillRect(cx(19), y(chochY + 2), cx(29) - cx(19), y(chochY - 4) - y(chochY + 2));
  ctx.setLineDash([6, 3]); ctx.strokeStyle = gold; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(cx(19), y(chochY)); ctx.lineTo(cx(29), y(chochY)); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // CHoCH pill (bigger)
  var chochPx = cx(25);
  ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
  var pw = ctx.measureText('CHoCH').width + 20, ph = 22, pr = 11;
  ctx.fillStyle = 'rgba(245,158,11,0.2)';
  ctx.beginPath();
  ctx.moveTo(chochPx - pw/2 + pr, y(chochY) - ph/2);
  ctx.arcTo(chochPx + pw/2, y(chochY) - ph/2, chochPx + pw/2, y(chochY) + ph/2, pr);
  ctx.arcTo(chochPx + pw/2, y(chochY) + ph/2, chochPx - pw/2, y(chochY) + ph/2, pr);
  ctx.arcTo(chochPx - pw/2, y(chochY) + ph/2, chochPx - pw/2, y(chochY) - ph/2, pr);
  ctx.arcTo(chochPx - pw/2, y(chochY) - ph/2, chochPx + pw/2, y(chochY) - ph/2, pr);
  ctx.fill();
  ctx.strokeStyle = gold; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chochPx - pw/2 + pr, y(chochY) - ph/2);
  ctx.arcTo(chochPx + pw/2, y(chochY) - ph/2, chochPx + pw/2, y(chochY) + ph/2, pr);
  ctx.arcTo(chochPx + pw/2, y(chochY) + ph/2, chochPx - pw/2, y(chochY) + ph/2, pr);
  ctx.arcTo(chochPx - pw/2, y(chochY) + ph/2, chochPx - pw/2, y(chochY) - ph/2, pr);
  ctx.arcTo(chochPx - pw/2, y(chochY) - ph/2, chochPx + pw/2, y(chochY) - ph/2, pr);
  ctx.stroke();
  ctx.fillStyle = gold; ctx.fillText('CHoCH', chochPx, y(chochY) + 4);

  // Draw candles with color transition
  candles.forEach(function(d, i) {
    var isGreen = d[1] >= d[0];
    var color;
    if (i <= 19) color = isGreen ? green : '#b91c1c';
    else if (i <= 25) color = isGreen ? '#a3a3a3' : gold;
    else color = isGreen ? '#7f7f7f' : red;
    drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
  });

  // "Failed HH" label with X marker
  ctx.save(); ctx.shadowColor = red; ctx.shadowBlur = 6;
  ctx.fillStyle = red; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('✕', cx(22) + cw/2, y(56) - 2);
  ctx.restore();
  ctx.font = '10px system-ui'; ctx.fillStyle = red; ctx.textAlign = 'center';
  ctx.fillText('Failed to beat HH', cx(22) + cw/2, y(60));

  // Section labels
  drawPill(ctx, 80, 18, 'UPTREND', green, 'rgba(34,197,94,0.12)');
  drawPill(ctx, cx(24), 18, 'REVERSAL', gold, 'rgba(245,158,11,0.12)');
  drawPill(ctx, cx(31), 18, 'DOWNTREND', red, 'rgba(239,68,68,0.12)');

  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('Price fails to make new HH → breaks below last HL → CHoCH confirms reversal', W/2, H - 6);
}

// --- Order Block Diagram ---
function drawOBChart() {
  var c = document.getElementById('ob-chart');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 260 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 260, pad = 30;
  var green = '#22c55e', red = '#ef4444', accent = '#6366f1', muted = '#444', text = '#e5e7eb';

  function y(v) { return pad + (H - pad * 2) * (1 - v / 100); }
  var cw = 20, gap = 5;
  function cx(i) { return 22 + i * (cw + gap); }

  var candles = [
    [42,46,48,40],[46,44,48,42],[44,42,46,40],
    [42,38,44,36],  // OB candle
    [38,52,54,36],[52,60,62,50],[60,68,70,58],[68,72,74,66],
    [72,70,74,68],[70,66,72,64],[66,60,68,58],[60,56,62,54],
    [56,40,58,38],  // retest
    [40,48,50,38],[48,56,58,46],[56,64,66,54],[64,70,72,62],
  ];

  // Grid
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gv = 30; gv <= 80; gv += 10) {
    ctx.beginPath(); ctx.moveTo(18, y(gv)); ctx.lineTo(W - 10, y(gv)); ctx.stroke();
  }

  // OB zone with gradient fill
  var obTop = 44, obBot = 36;
  var obGrad = ctx.createLinearGradient(0, y(obTop), 0, y(obBot));
  obGrad.addColorStop(0, 'rgba(99,102,241,0.15)');
  obGrad.addColorStop(1, 'rgba(99,102,241,0.03)');
  ctx.fillStyle = obGrad;
  ctx.fillRect(cx(3) - 2, y(obTop), cx(16) + cw + 4 - cx(3), y(obBot) - y(obTop));
  ctx.setLineDash([5, 3]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(cx(3) - 2, y(obTop)); ctx.lineTo(cx(16) + cw + 4, y(obTop)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx(3) - 2, y(obBot)); ctx.lineTo(cx(16) + cw + 4, y(obBot)); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // Draw candles
  candles.forEach(function(d, i) {
    var isGreen = d[1] >= d[0];
    var color = isGreen ? green : red;
    if (i === 3) color = accent;
    if (i >= 4 && i <= 7) { // impulse candles glow
      ctx.save(); ctx.shadowColor = green; ctx.shadowBlur = 6;
      drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
      ctx.restore();
    } else {
      drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
    }
  });

  // OB candle highlight border
  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  var obCx = cx(3);
  ctx.strokeRect(obCx + 1, y(44) - 1, cw - 2, y(36) - y(44) + 2);

  // Labels
  drawPill(ctx, cx(3) + cw/2 + 40, y(obTop) - 12, 'ORDER BLOCK', accent, 'rgba(99,102,241,0.18)');
  ctx.font = '9px system-ui'; ctx.fillStyle = muted; ctx.textAlign = 'center';
  ctx.fillText('Last red candle before impulse', cx(3) + cw/2 + 40, y(obTop) + 3);

  // Impulse arrow
  var impX = cx(7) + cw + 10;
  ctx.save(); ctx.shadowColor = green; ctx.shadowBlur = 4;
  ctx.strokeStyle = green; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(impX, y(40)); ctx.lineTo(impX, y(70)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(impX - 5, y(66)); ctx.lineTo(impX, y(70)); ctx.lineTo(impX + 5, y(66)); ctx.stroke();
  ctx.restore();
  drawPill(ctx, impX + 2, y(55), 'IMPULSE', green, 'rgba(34,197,94,0.15)');

  // Retest label
  drawGlowDot(ctx, cx(12) + cw/2, y(39), 5, '#3b82f6');
  ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#60a5fa'; ctx.textAlign = 'center';
  ctx.fillText('Retest', cx(12) + cw/2, y(30));
  ctx.strokeStyle = '#3b82f660'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx(12) + cw/2, y(33)); ctx.lineTo(cx(12) + cw/2, y(37)); ctx.stroke();

  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('Price returns to OB zone → smart money defends → bounce continues', W/2, H - 6);
}

// --- FVG Diagram ---
function drawFVGChart() {
  var c = document.getElementById('fvg-chart');
  if (!c) return;
  var dpr = window.devicePixelRatio || 1;
  c.width = 600 * dpr; c.height = 260 * dpr;
  var ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = 600, H = 260, pad = 30;
  var green = '#22c55e', red = '#ef4444', gold = '#f59e0b', blue = '#3b82f6', muted = '#444', text = '#e5e7eb';

  function y(v) { return pad + (H - pad * 2) * (1 - v / 100); }
  var cw = 22, gap = 6;
  function cx(i) { return 30 + i * (cw + gap); }

  var candles = [
    [35,38,40,33],[38,40,42,36],  // 0-1: setup
    [40,55,56,39],                 // 2: BIG impulse
    [55,65,68,53],                 // 3: continuation (C3 low=53, gap between C1 high=42)
    [65,70,72,63],[70,74,76,68],  // 4-5: higher
    [74,72,76,70],[72,68,74,66],[68,62,70,60],  // 6-8: pullback
    [62,55,64,53],[54,48,56,46],  // 9-10: fills gap
    [48,56,58,46],[56,62,64,54],[62,68,70,60],[68,75,78,66]  // 11-14: rally
  ];

  // Grid
  ctx.strokeStyle = '#1a1f2e'; ctx.lineWidth = 1;
  for (var gv = 30; gv <= 80; gv += 10) {
    ctx.beginPath(); ctx.moveTo(25, y(gv)); ctx.lineTo(W - 15, y(gv)); ctx.stroke();
  }

  // FVG zone with gradient
  var fvgTop = 53, fvgBot = 42;
  var fvgGrad = ctx.createLinearGradient(0, y(fvgTop), 0, y(fvgBot));
  fvgGrad.addColorStop(0, 'rgba(245,158,11,0.12)');
  fvgGrad.addColorStop(0.5, 'rgba(245,158,11,0.08)');
  fvgGrad.addColorStop(1, 'rgba(245,158,11,0.03)');
  ctx.fillStyle = fvgGrad;
  ctx.fillRect(cx(1), y(fvgTop), cx(14) + cw - cx(1), y(fvgBot) - y(fvgTop));

  // Hatching inside FVG zone for "empty" feel
  ctx.save(); ctx.globalAlpha = 0.08; ctx.strokeStyle = gold; ctx.lineWidth = 1;
  for (var hx = cx(1); hx < cx(14) + cw; hx += 12) {
    ctx.beginPath(); ctx.moveTo(hx, y(fvgTop)); ctx.lineTo(hx + 20, y(fvgBot)); ctx.stroke();
  }
  ctx.restore();

  ctx.setLineDash([5, 3]); ctx.strokeStyle = gold; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(cx(1), y(fvgTop)); ctx.lineTo(cx(14) + cw, y(fvgTop)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx(1), y(fvgBot)); ctx.lineTo(cx(14) + cw, y(fvgBot)); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // Draw candles
  candles.forEach(function(d, i) {
    var isGreen = d[1] >= d[0];
    var color = isGreen ? green : red;
    if (i === 2) {
      ctx.save(); ctx.shadowColor = green; ctx.shadowBlur = 6;
      drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
      ctx.restore();
    } else {
      drawCandle(ctx, cx(i), cw, d[0], d[1], d[2], d[3], y, color);
    }
  });

  // FVG label inside zone
  drawPill(ctx, cx(7), y((fvgTop + fvgBot) / 2), 'FVG', gold, 'rgba(245,158,11,0.2)');
  ctx.font = '9px system-ui'; ctx.fillStyle = muted; ctx.textAlign = 'center';
  ctx.fillText('No trades happened here — price skipped this zone', cx(7), y((fvgTop + fvgBot) / 2) + 15);

  // C1 C2 C3 labels with brackets
  [[1,'C1'],[2,'C2'],[3,'C3']].forEach(function(pair) {
    var i = pair[0], lbl = pair[1];
    drawPill(ctx, cx(i) + cw/2, y(32), lbl, '#60a5fa', 'rgba(59,130,246,0.12)');
  });

  // Gap arrow on left
  var arrowX = cx(1) - 12;
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(arrowX, y(fvgBot) - 2); ctx.lineTo(arrowX, y(fvgTop) + 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(arrowX - 4, y(fvgTop) + 7); ctx.lineTo(arrowX, y(fvgTop) + 2); ctx.lineTo(arrowX + 4, y(fvgTop) + 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(arrowX - 4, y(fvgBot) - 7); ctx.lineTo(arrowX, y(fvgBot) - 2); ctx.lineTo(arrowX + 4, y(fvgBot) - 7); ctx.stroke();
  ctx.font = 'bold 9px system-ui'; ctx.fillStyle = gold; ctx.textAlign = 'right';
  ctx.fillText('GAP', arrowX - 5, y((fvgTop + fvgBot) / 2) + 3);

  // "Fills gap" label at retest
  drawGlowDot(ctx, cx(10) + cw/2, y(44), 5, blue);
  ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#60a5fa'; ctx.textAlign = 'center';
  ctx.fillText('Fills gap', cx(10) + cw/2, y(37));

  ctx.font = '10px system-ui'; ctx.fillStyle = '#3d4558'; ctx.textAlign = 'center';
  ctx.fillText('C1 high doesn\'t overlap C3 low → gap between them → price returns to fill it', W/2, H - 6);
}

// Draw all educational charts when sections open
document.addEventListener('click', function(e) {
  var hdr = e.target.closest('.edu-header');
  if (!hdr) return;
  var card = hdr.parentElement;
  if (card.querySelector('#sweep-chart')) setTimeout(drawSweepChart, 50);
  if (card.querySelector('#candle-anatomy')) setTimeout(drawCandleAnatomy, 50);
  if (card.querySelector('#market-structure')) setTimeout(drawMarketStructure, 50);
  if (card.querySelector('#bos-chart')) setTimeout(drawBOSChart, 50);
  if (card.querySelector('#choch-chart')) setTimeout(drawCHoCHChart, 50);
  if (card.querySelector('#ob-chart')) setTimeout(drawOBChart, 50);
  if (card.querySelector('#fvg-chart')) setTimeout(drawFVGChart, 50);
});
// Also draw on load if already open
setTimeout(drawSweepChart, 500);

init();
</script>
</body>
</html>`;
