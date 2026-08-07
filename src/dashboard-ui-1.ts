export const dashboardHtmlPart1=String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Codex session usage</title>
    <style>
      :root {
        --bg: #f3f5f9;
        --surface: #ffffff;
        --surface-raised: #ffffff;
        --surface-subtle: #f8fafc;
        --ink: #172033;
        --ink-strong: #0f172a;
        --muted: #64748b;
        --muted-strong: #475569;
        --line: #dbe2ea;
        --line-strong: #cbd5e1;
        --accent: #3157d5;
        --accent-soft: #eef2ff;
        --good: #087f5b;
        --good-soft: #ecfdf5;
        --warn: #9a6700;
        --warn-soft: #fff8e7;
        --error: #b42318;
        --error-soft: #fff1f0;
        --shadow: 0 1px 2px rgba(15,23,42,.04), 0 12px 32px rgba(15,23,42,.05);
        --radius: 14px;
        --a: #3157d5;
        --b: #0f8f7a;
        --c: #d97706;
        --d: #8b5cf6;
        --e: #c2416c;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0b1020;
          --surface: #111827;
          --surface-raised: #151e2e;
          --surface-subtle: #0f172a;
          --ink: #dce5f2;
          --ink-strong: #f8fafc;
          --muted: #94a3b8;
          --muted-strong: #cbd5e1;
          --line: #263244;
          --line-strong: #3a475a;
          --accent: #8aa4ff;
          --accent-soft: #1d2947;
          --good: #5ee0b1;
          --good-soft: #102a24;
          --warn: #f5c451;
          --warn-soft: #2b2412;
          --error: #ff8d86;
          --error-soft: #321918;
          --shadow: 0 1px 2px rgba(0,0,0,.18), 0 16px 40px rgba(0,0,0,.18);
          --a: #8aa4ff;
          --b: #5ee0b1;
          --c: #f5b95f;
          --d: #b69cff;
          --e: #ef8dad;
        }
      }
      * { box-sizing: border-box }
      html { min-width: 320px; background: var(--bg) }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      button, input, select { font: inherit }
      button { color: inherit }
      :focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px }
      .shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto }
      .topbar {
        position: sticky; top: 0; z-index: 10;
        border-bottom: 1px solid color-mix(in srgb, var(--line) 85%, transparent);
        background: color-mix(in srgb, var(--bg) 88%, transparent);
        backdrop-filter: blur(16px);
      }
      header { min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 20px }
      .brand-wrap { display: flex; align-items: center; gap: 12px; min-width: 0 }
      .mark {
        width: 36px; height: 36px; border: 1px solid var(--line); border-radius: 10px;
        background: var(--surface); display: grid; place-items: center; box-shadow: var(--shadow); flex: 0 0 auto;
      }
      .mark svg { width: 20px; height: 20px }
      .brand { color: var(--ink-strong); font-size: 16px; font-weight: 760; letter-spacing: -.015em }
      .eyebrow { margin-top: 1px; color: var(--muted); font-size: 12px }
      .connection {
        display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 11px;
        border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted-strong);
        font-size: 12px; font-weight: 650; white-space: nowrap;
      }
      .connection-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); box-shadow: 0 0 0 3px color-mix(in srgb, var(--muted) 12%, transparent) }
      .connection.live .connection-dot { background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 14%, transparent) }
      .connection.error .connection-dot { background: var(--error); box-shadow: 0 0 0 3px color-mix(in srgb, var(--error) 14%, transparent) }
      main { padding: 34px 0 64px }
      .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px }
      .hero h1 { margin: 0; color: var(--ink-strong); font-size: clamp(25px, 3vw, 34px); line-height: 1.08; letter-spacing: -.035em }
      .hero p { max-width: 650px; margin: 9px 0 0; color: var(--muted); font-size: 14px }
      .refresh { color: var(--muted); font-size: 12px; white-space: nowrap }
      .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px }
      .card, .session, .panel {
        background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow);
      }
      .kpi { padding: 17px 18px }
      .kpi-label { color: var(--muted); font-size: 12px; font-weight: 650 }
      .metric { margin-top: 7px; color: var(--ink-strong); font-size: 24px; font-weight: 760; letter-spacing: -.025em; font-variant-numeric: tabular-nums }
      .kpi-note { min-height: 18px; margin-top: 4px; color: var(--muted); font-size: 11px }
      .notice { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; padding: 11px 13px; border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--line)); border-radius: 11px; background: var(--warn-soft); color: var(--muted-strong); font-size: 12px }
      .notice.error { border-color: color-mix(in srgb, var(--error) 32%, var(--line)); background: var(--error-soft) }
      .notice-icon { flex: 0 0 auto; font-weight: 800; color: var(--warn) }
      .notice.error .notice-icon { color: var(--error) }
      .charts { display: grid; grid-template-columns: .92fr 1.08fr; gap: 12px; margin-top: 12px }
      .panel { padding: 18px; min-width: 0 }
      .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 15px }
      .panel-title { color: var(--ink-strong); font-weight: 730 }
      .panel-subtitle { margin-top: 3px; color: var(--muted); font-size: 12px }
      .chart-list { display: grid; gap: 13px }
      .chart-row { min-width: 0; padding: 3px; margin: -3px; border-radius: 8px; cursor: pointer }
      .chart-row:hover .chart-name { color: var(--accent) }
      .chart-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px }
      .chart-name { overflow: hidden; color: var(--muted-strong); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap }
      .chart-value { color: var(--ink-strong); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap }
      .bar { display: flex; height: 8px; overflow: hidden; border-radius: 999px; background: var(--surface-subtle); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--line) 75%, transparent) }
      .bar span { min-width: 2px }
      .legend { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 8px }
      .legend-item { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--muted); font-size: 10px }
      .legend-dot { width: 7px; height: 7px; border-radius: 2px; flex: 0 0 auto }
      .workspace { margin-top: 28px }
      .workspace-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 11px }
      .workspace-title { color: var(--ink-strong); font-size: 18px; font-weight: 750; letter-spacing: -.015em }
      .workspace-count { margin-top: 2px; color: var(--muted); font-size: 12px }
      .filters { display: flex; align-items: center; gap: 8px }
      .search-wrap { position: relative; min-width: min(320px, 42vw) }
      .search-wrap svg { position: absolute; left: 11px; top: 50%; width: 15px; height: 15px; color: var(--muted); transform: translateY(-50%); pointer-events: none }
      input, select {
        height: 38px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); outline: none;
      }
      input { width: 100%; padding: 0 12px 0 34px }
      input::placeholder { color: color-mix(in srgb, var(--muted) 80%, transparent) }
      select { padding: 0 31px 0 11px; cursor: pointer }
      input:hover, select:hover { border-color: var(--line-strong) }
      input:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent) }
      .session-list { display: grid; gap: 8px }
      .session { overflow: hidden; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease }
      .session:has(.session-toggle:hover), .session:has(.session-toggle:focus-visible) { border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 14px 34px color-mix(in srgb, var(--accent) 7%, transparent) }
      .session-head { display: flex; align-items: stretch }
      .session-toggle { display: block; flex: 1; min-width: 0; border: 0; background: transparent; padding: 15px 10px 15px 17px; text-align: left; cursor: pointer }
      .session-primary { display: flex; align-items: center; justify-content: space-between; gap: 18px }
      .session-title-wrap { display: flex; align-items: center; min-width: 0; gap: 8px }
      .chevron { width: 16px; height: 16px; color: var(--muted); transition: transform .16s ease; flex: 0 0 auto }
      [aria-expanded="true"] .chevron { transform: rotate(90deg) }
      .session-title { overflow: hidden; color: var(--ink-strong); font-weight: 690; text-overflow: ellipsis; white-space: nowrap }
      .session-cost { color: var(--ink-strong); font-size: 13px; font-weight: 750; font-variant-numeric: tabular-nums; white-space: nowrap }
      .session-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 5px 0 0 24px; color: var(--muted); font-size: 11px }
      .session-meta span { position: relative }
      .session-meta span + span:before { content: ""; position: absolute; left: -7px; top: 50%; width: 2px; height: 2px; border-radius: 50%; background: var(--line-strong) }
      .models { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 0 24px }
      .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 23px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface-subtle); color: var(--muted-strong); font-size: 10px; white-space: nowrap }
      .pill-dot { width: 6px; height: 6px; border-radius: 2px; flex: 0 0 auto }
      .copy-zone { display: flex; align-items: center; gap: 5px; padding: 12px 12px 12px 0 }
      .icon-button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--muted-strong); cursor: pointer }
      .icon-button:hover { border-color: var(--line-strong); background: var(--surface-subtle); color: var(--ink-strong) }
      .icon-button svg { width: 14px; height: 14px }
      .copy-feedback { width: 0; overflow: visible; color: var(--good); font-size: 10px; white-space: nowrap }
      .detail { border-top: 1px solid var(--line); background: var(--surface-subtle); padding: 16px 17px 17px }
      .detail-summary { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 11px }
      .detail-title { color: var(--ink-strong); font-size: 12px; font-weight: 720 }
      .detail-id { margin-top: 2px; color: var(--muted); font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere }
      .detail-total { color: var(--muted-strong); font-size: 11px; text-align: right; white-space: nowrap }
      .threads { display: grid; gap: 7px }
`;