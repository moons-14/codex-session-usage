export const dashboardHtmlPart2=String.raw`      .thread { padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface) }
      .thread-head { display: flex; justify-content: space-between; gap: 12px }
      .thread-name { color: var(--ink-strong); font-size: 11px; font-weight: 700 }
      .thread-kind { color: var(--muted); font-size: 10px }
      .thread-info { margin-top: 3px; color: var(--muted); font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere }
      .thread .models { margin-left: 0; margin-top: 8px }
      .empty { padding: 36px 18px; border: 1px dashed var(--line-strong); border-radius: var(--radius); color: var(--muted); text-align: center }
      .model-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0 }
      .filter-chip { min-height: 28px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--muted-strong); cursor: pointer; font-size: 11px }
      .filter-chip[aria-pressed="true"] { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); background: var(--accent-soft); color: var(--accent); font-weight: 700 }
      @media (max-width: 850px) { .kpis { grid-template-columns: repeat(2, 1fr) } .charts { grid-template-columns: 1fr } .workspace-head { align-items: stretch; flex-direction: column } .filters { width: 100% } .search-wrap { flex: 1; min-width: 0 } }
      @media (max-width: 560px) { .shell { width: min(100% - 24px, 1180px) } header { min-height: 64px } .eyebrow { display: none } main { padding-top: 24px } .hero { align-items: flex-start; flex-direction: column; gap: 8px } .refresh { white-space: normal } .kpis { grid-template-columns: 1fr 1fr; gap: 8px } .kpi { padding: 14px } .metric { font-size: 20px } .panel { padding: 14px } .filters { flex-direction: column; align-items: stretch } .search-wrap { width: 100% } select { width: 100% } .session-toggle { padding-left: 13px } .session-meta,.models { margin-left: 24px } .copy-zone { padding-right: 8px; flex-direction: column; justify-content: center } .detail-summary { flex-direction: column; gap: 5px } .detail-total { text-align: left } }
      @media (prefers-reduced-motion: reduce) { *, *:before, *:after { scroll-behavior: auto !important; transition: none !important } }
    </style>
  </head>
  <body>
    <div class="topbar"><header class="shell"><div class="brand-wrap"><div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8.5 3.5h7l3.5 6-3.5 6h-7L5 9.5z"/><path d="m8.5 15.5-3.5 6h7l3.5-6"/></svg></div><div><div class="brand">Codex session usage</div><div class="eyebrow">Local usage explorer</div></div></div><div id="status" class="connection"><span class="connection-dot"></span><span id="statusText">Connecting</span></div></header></div>
    <main class="shell">
      <section class="hero"><div><h1>Usage at a glance</h1><p>Explore token volume, API-equivalent cost estimates, and agent activity across local Codex sessions.</p></div><div id="scope" class="refresh">Loading local offline data…</div></section>
      <div class="kpis" id="kpis"></div><div id="warning"></div>
      <div class="charts"><section class="panel"><div class="panel-head"><div><div class="panel-title">Session token ranking</div><div class="panel-subtitle">Largest sessions by total tokens</div></div></div><div class="chart-list" id="ranking"></div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Model composition</div><div class="panel-subtitle">Token share by model for visible sessions</div></div></div><div class="chart-list" id="composition"></div></section></div>
      <section class="workspace"><div class="workspace-head"><div><div class="workspace-title">Sessions</div><div class="workspace-count" id="sessionCount">Loading…</div><div class="model-filter" id="modelFilters"></div></div><div class="filters"><label class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search" aria-label="Search sessions" placeholder="Search title or session ID" /></label><select id="sort" aria-label="Sort sessions"><option value="activity">Last activity</option><option value="tokens">Most tokens</option><option value="cost">Highest cost</option></select></div></div><div class="session-list" id="sessions"><div class="empty">Loading sessions…</div></div></section>
    </main>
    <script>
`;