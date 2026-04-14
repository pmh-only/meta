<script>
  import { onDestroy } from 'svelte';
  import Chart from 'chart.js/auto';

  let {
    rows,
    columns,
    initType  = 'bar',
    initX     = '',
    initYCols = /** @type {string[]} */ ([]),
  } = $props();

  const CHART_TYPES = ['bar', 'line', 'pie', 'doughnut', 'scatter'];

  const PALETTE = [
    { bg: 'rgba(88,101,242,0.75)',  border: '#5865f2' },
    { bg: 'rgba(87,242,135,0.75)', border: '#57f287' },
    { bg: 'rgba(254,231,92,0.75)', border: '#fee75c' },
    { bg: 'rgba(235,69,158,0.75)', border: '#eb459e' },
    { bg: 'rgba(237,66,69,0.75)',  border: '#ed4245' },
    { bg: 'rgba(0,176,244,0.75)',  border: '#00b0f4' },
    { bg: 'rgba(250,166,26,0.75)', border: '#faa61a' },
  ];

  /** @param {string} col */
  function isNumericCol(col) {
    const vals = rows.slice(0, 50).filter(r => r[col] != null && r[col] !== '');
    return vals.length > 0 && vals.every(r => !isNaN(Number(r[col])));
  }

  let numericCols = $derived(columns.filter(isNumericCol));

  let chartType = $state(initType);
  let xCol      = $state(initX);
  let yCols     = $state(/** @type {string[]} */([...initYCols]));
  let canvasEl  = $state(/** @type {HTMLCanvasElement | null} */(null));

  // Fill in any gaps once columns are known (init values take priority)
  $effect(() => {
    if (columns.length === 0) return;
    if (!xCol || !columns.includes(xCol))
      xCol = initX && columns.includes(initX) ? initX : columns[0];
    if (yCols.filter(c => columns.includes(c)).length === 0) {
      const valid = initYCols.filter(c => numericCols.includes(c));
      yCols = valid.length > 0 ? valid : numericCols.slice(0, 1);
    }
  });

  /** @param {string} col */
  function toggleYCol(col) {
    yCols = yCols.includes(col) ? yCols.filter(c => c !== col) : [...yCols, col];
  }

  // Rebuild chart whenever any dependency changes
  $effect(() => {
    const type  = chartType;
    const x     = xCol;
    const ys    = [...yCols];
    const el    = canvasEl;

    if (!el || !x || ys.length === 0 || rows.length === 0) return;

    const isPie     = type === 'pie' || type === 'doughnut';
    const isScatter = type === 'scatter';

    // Limit to 500 points to keep charts readable
    const data = rows.slice(0, 500);
    const labels = data.map(r => String(r[x] ?? ''));

    const datasets = ys.map((col, i) => {
      const p = PALETTE[i % PALETTE.length];
      return {
        label: col,
        data: isScatter
          ? data.map(r => ({ x: Number(r[x]), y: Number(r[col]) }))
          : data.map(r => Number(r[col])),
        backgroundColor: isPie
          ? data.map((_, j) => PALETTE[j % PALETTE.length].bg)
          : p.bg,
        borderColor: isPie
          ? data.map((_, j) => PALETTE[j % PALETTE.length].border)
          : p.border,
        borderWidth: 2,
        tension: 0.35,
        pointRadius: isScatter ? 4 : 2,
        fill: false,
      };
    });

    const instance = new Chart(el, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 180 },
        plugins: {
          legend: {
            display: ys.length > 1 || isPie,
            labels: { color: '#a1a1aa', font: { size: 12 }, padding: 16 },
          },
          tooltip: {
            backgroundColor: '#18181f',
            borderColor: '#2a2a35',
            borderWidth: 1,
            titleColor: '#e4e4e7',
            bodyColor: '#a1a1aa',
          },
        },
        scales: isPie ? {} : {
          x: {
            ticks: { color: '#71717a', maxTicksLimit: 20, maxRotation: 45 },
            grid: { color: '#1f1f2a' },
          },
          y: {
            ticks: { color: '#71717a' },
            grid: { color: '#1f1f2a' },
          },
        },
      },
    });

    return () => instance.destroy();
  });
</script>

<div class="vis">
  <!-- Controls -->
  <div class="controls">
    <div class="control-group">
      <span class="control-label">Type</span>
      <div class="type-btns">
        {#each CHART_TYPES as t}
          <button
            class="type-btn"
            class:active={chartType === t}
            onclick={() => (chartType = t)}
          >{t}</button>
        {/each}
      </div>
    </div>

    <div class="control-group">
      <span class="control-label">X axis</span>
      <select bind:value={xCol}>
        {#each columns as col}
          <option value={col}>{col}</option>
        {/each}
      </select>
    </div>

    <div class="control-group">
      <span class="control-label">Y axis</span>
      {#if numericCols.length === 0}
        <span class="muted">No numeric columns</span>
      {:else}
        <div class="y-checks">
          {#each numericCols as col, i}
            <label class="check-label">
              <input
                type="checkbox"
                checked={yCols.includes(col)}
                onchange={() => toggleYCol(col)}
              />
              <span class="swatch" style="background:{PALETTE[i % PALETTE.length].border}"></span>
              {col}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    {#if rows.length > 500}
      <div class="control-group" style="justify-content:flex-end;align-self:flex-end">
        <span class="warn">Showing first 500 of {rows.length.toLocaleString()} rows</span>
      </div>
    {/if}
  </div>

  <!-- Chart canvas -->
  <div class="chart-wrap">
    <canvas bind:this={canvasEl}></canvas>
  </div>
</div>

<style>
  .vis {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
  }

  .controls {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 10px 14px;
    background: #13131a;
    border: 1px solid #2a2a35;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .control-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #52525b;
  }

  .type-btns { display: flex; gap: 4px; }

  .type-btn {
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #2a2a35;
    background: transparent;
    color: #71717a;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-transform: capitalize;
    transition: all 0.1s;
  }
  .type-btn:hover { color: #e4e4e7; border-color: #3f3f52; }
  .type-btn.active { background: #5865f2; border-color: #5865f2; color: #fff; }

  select {
    background: #0e0e12;
    border: 1px solid #2a2a35;
    color: #d4d4d8;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    max-width: 200px;
  }
  select:focus { border-color: #5865f2; }

  .y-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 500px;
  }

  .check-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #a1a1aa;
    cursor: pointer;
    font-family: 'Menlo', monospace;
    white-space: nowrap;
  }
  .check-label input { cursor: pointer; accent-color: #5865f2; }

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .muted { font-size: 12px; color: #52525b; font-style: italic; }

  .warn {
    font-size: 11px;
    color: #faa61a;
    background: rgba(250,166,26,0.1);
    border: 1px solid rgba(250,166,26,0.3);
    border-radius: 4px;
    padding: 3px 8px;
  }

  .chart-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
  }
</style>
