<script>
  import { onMount } from 'svelte';
  import presets from '$lib/presets.js';
  import examples from '$lib/examples.js';
  import VisChart from '$lib/VisChart.svelte';
  import SqlEditor from '$lib/SqlEditor.svelte';
  import {
    Zap, Database, ChevronRight, ChevronDown,
    BookOpen, Sparkles, Play, Loader2,
    Table2, BarChart2, AlertTriangle,
    ChevronLeft, MessageSquare, Users, Heart,
    Paperclip, Link2, CalendarRange, ArrowRight,
    Clock,
  } from 'lucide-svelte';

  let sql = $state(presets[0].sql);
  let results = $state(/** @type {Record<string, unknown>[] | null} */ (null));
  let columns = $state(/** @type {string[]} */ ([]));
  let error = $state('');
  let loading = $state(false);
  let queryTime = $state(0);
  /** @type {Record<string, { name: string; type: string }[]>} */
  let schema = $state({});
  let openTables = $state(/** @type {Set<string>} */ (new Set()));
  let showPresets   = $state(false);
  let showExamples  = $state(false);
  let page          = $state(0);
  let view          = $state(/** @type {'table' | 'chart'} */ ('table'));
  let chartKey      = $state(0);
  let initChart     = $state({ type: 'bar', xCol: '', yCols: /** @type {string[]} */ ([]) });

  /** @type {{ messages: string; authors: string; channels: string; reactions: string; attachments: string; embeds: string; oldest: string; newest: string } | null} */
  let stats = $state(null);

  const PAGE_SIZE = 200;

  let pagedResults = $derived(
    results ? results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : []
  );
  let totalPages = $derived(results ? Math.ceil(results.length / PAGE_SIZE) : 0);

  onMount(async () => {
    const [schemaRes, statsRes] = await Promise.all([
      fetch('/api/schema'),
      fetch('/api/stats'),
    ]);
    if (schemaRes.ok) schema = await schemaRes.json();
    if (statsRes.ok)  stats  = await statsRes.json();
  });

  /** @param {{ showChart?: boolean }} [opts] */
  async function runQuery(opts = {}) {
    if (loading) return;
    loading = true;
    error = '';
    results = null;
    columns = [];
    page = 0;
    view = opts.showChart ? 'chart' : 'table';
    const start = performance.now();

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });

      const data = await res.json();

      if (!res.ok) {
        error = data.error || 'Query failed';
      } else {
        results = data.rows;
        columns = data.columns;
        queryTime = Math.round(performance.now() - start);
      }
    } catch (e) {
      error = /** @type {Error} */ (e).message;
    } finally {
      loading = false;
    }
  }

  /** @param {{ name: string; sql: string }} preset */
  function applyPreset(preset) {
    sql = preset.sql;
    showPresets = false;
  }

  /** @param {typeof examples[number]} ex */
  function applyExample(ex) {
    sql = ex.sql;
    initChart = { type: ex.chart.type, xCol: ex.chart.xCol, yCols: [...ex.chart.yCols] };
    chartKey++;
    showExamples = false;
    runQuery({ showChart: true });
  }

  /** @param {string} name */
  function toggleTable(name) {
    const next = new Set(openTables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    openTables = next;
  }

  /** @param {string} name */
  function quickSelect(name) {
    sql = `SELECT * FROM ${name} LIMIT 100`;
  }

  /** @param {string | number} n */
  function fmt(n) {
    return Number(n).toLocaleString();
  }

  /** @param {string} iso */
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /** @param {unknown} v */
  function display(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…';
    return String(v);
  }

  /** @param {unknown} v */
  function isNull(v) {
    return v === null || v === undefined;
  }
</script>

<div class="app">
  <header>
    <span class="logo"><Zap size={18} /></span>
    <h1>meta.pmh.codes</h1>
    <span class="subtitle">discord.duckdb explorer</span>
  </header>

  <!-- ── Stats Bar ──────────────────────────────────────────── -->
  <section class="stats-bar">
    {#if stats}
      {@const days = Math.round((new Date(stats.newest).getTime() - new Date(stats.oldest).getTime()) / 86400000)}
      <div class="stat">
        <span class="stat-value">{fmt(stats.messages)}</span>
        <span class="stat-label"><MessageSquare size={10} />messages</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <span class="stat-value">{fmt(stats.authors)}</span>
        <span class="stat-label"><Users size={10} />authors</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <span class="stat-value">{fmt(stats.reactions)}</span>
        <span class="stat-label"><Heart size={10} />reactions</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <span class="stat-value">{fmt(stats.attachments)}</span>
        <span class="stat-label"><Paperclip size={10} />attachments</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <span class="stat-value">{fmt(stats.embeds)}</span>
        <span class="stat-label"><Link2 size={10} />embeds</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat stat-wide">
        <span class="stat-value stat-range">
          {fmtDate(stats.oldest)}
          <ArrowRight size={13} class="stat-arrow-icon" />
          {fmtDate(stats.newest)}
        </span>
        <span class="stat-label"><Clock size={10} />{days.toLocaleString()} days of history</span>
      </div>
    {:else}
      <div class="stats-loading">Loading stats…</div>
    {/if}
  </section>

  <div class="layout">
    <!-- ── Schema Sidebar ─────────────────────────────────── -->
    <aside class="sidebar">
      <div class="sidebar-title"><Database size={11} />Tables</div>

      {#if Object.keys(schema).length === 0}
        <div class="sidebar-loading">Loading schema…</div>
      {/if}

      {#each Object.entries(schema) as [tableName, cols]}
        <div class="table-group">
          <button
            class="table-header"
            onclick={() => toggleTable(tableName)}
            ondblclick={() => quickSelect(tableName)}
            title="Double-click to SELECT * FROM {tableName}"
          >
            <span class="chevron">
              {#if openTables.has(tableName)}
                <ChevronDown size={12} />
              {:else}
                <ChevronRight size={12} />
              {/if}
            </span>
            <span class="table-name">{tableName}</span>
          </button>

          {#if openTables.has(tableName)}
            <div class="col-list">
              {#each cols as col}
                <div class="col-row">
                  <span class="col-name">{col.name}</span>
                  <span class="col-type">{col.type}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </aside>

    <!-- ── Main Panel ──────────────────────────────────────── -->
    <main class="main">
      <!-- SQL Editor -->
      <div class="editor-section">
        <div class="cm-wrap">
          <SqlEditor bind:value={sql} {schema} onRun={runQuery} />
        </div>

        <div class="toolbar">
          <!-- Presets dropdown -->
          <div class="presets-wrap">
            <button
              class="btn btn-ghost"
              onclick={() => { showPresets = !showPresets; showExamples = false; }}
            >
              <BookOpen size={13} />Presets<ChevronDown size={12} />
            </button>

            {#if showPresets}
              <div class="presets-menu">
                {#each presets as preset}
                  <button class="preset-row" onclick={() => applyPreset(preset)}>
                    <span class="preset-name">{preset.name}</span>
                    <span class="preset-desc">{preset.description}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Examples dropdown -->
          <div class="presets-wrap">
            <button
              class="btn btn-ghost"
              onclick={() => { showExamples = !showExamples; showPresets = false; }}
            >
              <Sparkles size={13} />Examples<ChevronDown size={12} />
            </button>

            {#if showExamples}
              <div class="presets-menu examples-menu">
                {#each examples as ex}
                  <button class="example-row" onclick={() => applyExample(ex)}>
                    <span class="example-icon">{ex.icon}</span>
                    <span class="example-body">
                      <span class="preset-name">{ex.name}</span>
                      <span class="preset-desc">{ex.description}</span>
                    </span>
                    <span class="example-badge">{ex.chart.type}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <button
            class="btn btn-run"
            onclick={runQuery}
            disabled={loading}
          >
            {#if loading}
              <Loader2 size={13} class="spin" />Running…
            {:else}
              <Play size={13} />Run
            {/if}
            <kbd>Ctrl ↵</kbd>
          </button>
        </div>
      </div>

      <!-- Results -->
      <div class="results-section">
        {#if loading}
          <div class="state-msg">Executing query…</div>
        {:else if error}
          <div class="error-box">
            <AlertTriangle size={15} class="error-icon" />
            <pre>{error}</pre>
          </div>
        {:else if results !== null}
          <div class="results-meta">
            <span>
              {results.length.toLocaleString()} row{results.length !== 1 ? 's' : ''}
              {#if view === 'table' && totalPages > 1}
                &nbsp;·&nbsp; page {page + 1} / {totalPages}
              {/if}
            </span>
            <div class="view-tabs">
              <button
                class="view-tab"
                class:active={view === 'table'}
                onclick={() => (view = 'table')}
              ><Table2 size={12} />Table</button>
              <button
                class="view-tab"
                class:active={view === 'chart'}
                onclick={() => (view = 'chart')}
              ><BarChart2 size={12} />Chart</button>
            </div>
            <span class="query-time">{queryTime} ms</span>
          </div>

          {#if results.length === 0}
            <div class="state-msg">Query returned no rows.</div>
          {:else if view === 'table'}
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    {#each columns as col}
                      <th>{col}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each pagedResults as row}
                    <tr>
                      {#each columns as col}
                        <td class:null-cell={isNull(row[col])}>
                          {display(row[col])}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            {#if totalPages > 1}
              <div class="pagination">
                <button
                  class="btn btn-ghost"
                  disabled={page === 0}
                  onclick={() => page--}
                ><ChevronLeft size={13} />Prev</button>
                <span>{page + 1} / {totalPages}</span>
                <button
                  class="btn btn-ghost"
                  disabled={page >= totalPages - 1}
                  onclick={() => page++}
                >Next<ChevronRight size={13} /></button>
              </div>
            {/if}
          {:else}
            {#key chartKey}
              <VisChart
                rows={results}
                {columns}
                initType={initChart.type}
                initX={initChart.xCol}
                initYCols={initChart.yCols}
              />
            {/key}
          {/if}
        {:else}
          <div class="state-msg">Run a query to see results.</div>
        {/if}
      </div>
    </main>
  </div>
</div>

<!-- Close presets on outside click -->
<svelte:window onclick={(e) => {
  if (!/** @type {Element} */ (e.target).closest('.presets-wrap')) {
    showPresets = false;
    showExamples = false;
  }
}} />

<style>
  /* ── Reset / Base ──────────────────────────────────────────── */
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    background: #0e0e12;
    color: #d4d4d8;
    height: 100vh;
    overflow: hidden;
  }

  /* ── App shell ─────────────────────────────────────────────── */
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: #18181f;
    border-bottom: 1px solid #2a2a35;
    flex-shrink: 0;
  }

  /* ── Stats Bar ──────────────────────────────────────────────── */
  .stats-bar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 20px;
    background: #111118;
    border-bottom: 1px solid #2a2a35;
    flex-shrink: 0;
    overflow-x: auto;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 20px;
    flex-shrink: 0;
  }

  .stat-wide {
    align-items: flex-start;
    padding-left: 20px;
  }

  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #e4e4e7;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .stat-label {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #52525b;
  }

  .stat-range {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #a1a1aa;
  }

  :global(.stat-arrow-icon) { color: #3f3f52; }

  .stat-sep {
    width: 1px;
    height: 28px;
    background: #2a2a35;
    flex-shrink: 0;
  }

  .stats-loading {
    font-size: 12px;
    color: #52525b;
    padding: 12px 0;
  }

  .logo { display: flex; align-items: center; color: #5865f2; }

  h1 {
    font-size: 15px;
    font-weight: 600;
    color: #e4e4e7;
    letter-spacing: 0.01em;
  }

  .subtitle {
    font-size: 12px;
    color: #52525b;
    margin-left: 4px;
  }

  /* ── Layout ────────────────────────────────────────────────── */
  .layout {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Sidebar ────────────────────────────────────────────────── */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #13131a;
    border-right: 1px solid #2a2a35;
    overflow-y: auto;
    padding: 8px 0;
  }

  .sidebar-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #52525b;
    padding: 4px 12px 8px;
  }

  .sidebar-loading {
    font-size: 12px;
    color: #52525b;
    padding: 8px 12px;
  }

  .table-group { border-bottom: 1px solid #1f1f2a; }

  .table-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: #a1a1aa;
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    font-family: inherit;
    transition: background 0.1s, color 0.1s;
  }
  .table-header:hover {
    background: #1e1e2a;
    color: #e4e4e7;
  }

  .chevron { display: flex; align-items: center; color: #52525b; width: 14px; flex-shrink: 0; }
  .table-name { font-weight: 500; }

  .col-list {
    padding: 2px 0 6px 28px;
  }

  .col-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 12px 2px 0;
    gap: 8px;
  }

  .col-name {
    font-size: 12px;
    color: #71717a;
    font-family: 'Menlo', 'Consolas', monospace;
  }

  .col-type {
    font-size: 10px;
    color: #3f3f52;
    font-family: monospace;
    flex-shrink: 0;
  }

  /* ── Main ───────────────────────────────────────────────────── */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Editor Section ─────────────────────────────────────────── */
  .editor-section {
    border-bottom: 1px solid #2a2a35;
    padding: 12px;
    flex-shrink: 0;
    background: #18181f;
  }

  .cm-wrap {
    height: 190px;
    border: 1px solid #2a2a35;
    border-radius: 6px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .cm-wrap:focus-within { border-color: #5865f2; }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    gap: 8px;
  }

  /* ── Buttons ────────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 5px;
    border: 1px solid transparent;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .btn-ghost {
    background: transparent;
    border-color: #2a2a35;
    color: #a1a1aa;
  }
  .btn-ghost:hover:not(:disabled) {
    background: #1e1e2a;
    color: #e4e4e7;
  }

  .btn-run {
    background: #5865f2;
    color: #fff;
    border-color: #5865f2;
    font-weight: 600;
    padding: 6px 18px;
  }
  .btn-run:hover:not(:disabled) { background: #4752c4; border-color: #4752c4; }

  kbd {
    font-family: monospace;
    font-size: 11px;
    background: rgba(255,255,255,0.12);
    border-radius: 3px;
    padding: 1px 4px;
  }

  /* ── Presets Dropdown ───────────────────────────────────────── */
  .presets-wrap { position: relative; }

  .presets-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: #1e1e2a;
    border: 1px solid #2a2a35;
    border-radius: 8px;
    min-width: 300px;
    max-height: 380px;
    overflow-y: auto;
    z-index: 100;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }

  .preset-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    border-bottom: 1px solid #2a2a35;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 0.1s;
  }
  .preset-row:last-child { border-bottom: none; }
  .preset-row:hover { background: #252535; }

  .preset-name { font-weight: 600; font-size: 13px; color: #e4e4e7; }
  .preset-desc { font-size: 11px; color: #71717a; }

  .examples-menu { min-width: 340px; }

  .example-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    border-bottom: 1px solid #2a2a35;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 0.1s;
  }
  .example-row:last-child { border-bottom: none; }
  .example-row:hover { background: #252535; }

  .example-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }

  .example-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .example-badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #5865f2;
    background: rgba(88,101,242,0.15);
    border: 1px solid rgba(88,101,242,0.3);
    border-radius: 3px;
    padding: 2px 6px;
    flex-shrink: 0;
  }

  /* ── Results Section ────────────────────────────────────────── */
  .results-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px;
    gap: 8px;
  }

  .results-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #71717a;
    flex-shrink: 0;
  }
  .query-time { color: #52525b; }

  .view-tabs {
    display: flex;
    gap: 2px;
    background: #0e0e12;
    border: 1px solid #2a2a35;
    border-radius: 5px;
    padding: 2px;
  }
  .view-tab {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 12px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: #71717a;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.1s;
  }
  .view-tab:hover { color: #e4e4e7; }
  .view-tab.active { background: #5865f2; color: #fff; }

  .table-scroll {
    flex: 1;
    overflow: auto;
    border: 1px solid #2a2a35;
    border-radius: 6px;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }

  thead {
    position: sticky;
    top: 0;
    background: #18181f;
    z-index: 1;
  }

  th {
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    color: #a1a1aa;
    border-bottom: 1px solid #2a2a35;
    white-space: nowrap;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  td {
    padding: 6px 12px;
    border-bottom: 1px solid #1a1a24;
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 12px;
    color: #d4d4d8;
    white-space: nowrap;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1a1a26; }

  .null-cell { color: #3f3f52; font-style: italic; }

  /* ── State Messages ─────────────────────────────────────────── */
  .state-msg {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #52525b;
    font-size: 13px;
  }

  .error-box {
    display: flex;
    gap: 10px;
    background: #1e0f0f;
    border: 1px solid #4a1515;
    border-radius: 6px;
    padding: 12px 16px;
    color: #f87171;
  }
  :global(.error-icon) { flex-shrink: 0; margin-top: 1px; }
  .error-box pre {
    font-family: 'Menlo', monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ── Spin animation for loading icon ───────────────────────── */
  :global(.spin) { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Pagination ─────────────────────────────────────────────── */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 0;
    flex-shrink: 0;
    font-size: 12px;
    color: #71717a;
  }
</style>
