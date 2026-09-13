/* Oscillation leaderboard visualizer — Tabulator edition (v3)
 *
 * Ranking: net_legs_per_year ((n_up - n_down) / years — surplus of harvests
 * over dips) among trend-positive tickers. Downtrenders are kept but greyed
 * and ranked last. Each row shows current_price (last close) alongside its
 * best-fit growth trend (trend_growth_pct / trend_price / vs_trend_pct — the
 * same least-squares line the chart explorer draws as its dashed trend
 * line) so you can judge a ticker's drift yourself, rather than a computed
 * "signal" telling you what to do. Stateless — there is no trade tracking.
 */
(function () {
  "use strict";

  const HIGHLIGHT = "ZETA";

  function dataBase() {
    return window.__DATA_BASE__ || "/everest/data";
  }

  function siteBase() {
    return dataBase().replace(/\/data$/, "");
  }

  function fmt(n, d) {
    return (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toFixed(d);
  }

  const signed = (v) => `${v > 0 ? "+" : ""}${fmt(v, 1)}`;

  // ---- Scatter chart ----
  function renderScatter(el, results) {
    // Candidates only: downtrenders can print many up-legs while bleeding out,
    // parabolic runners print legs from a one-way spike, dip-chainers inflate
    // their leg count by riding deep BUY chains, and thin/short histories
    // have no denominator (too few legs, or too little calendar span) —
    // all would look attractive here without being repeatable dip-cyclers.
    const candidates = results.filter((r) =>
      r.trend_positive && !r.parabolic && !r.chained_dips &&
      !r.thin_history && !r.short_history);
    const others = candidates.filter((r) => r.ticker !== HIGHLIGHT);
    const zeta = candidates.find((r) => r.ticker === HIGHLIGHT);

    const hover = (r) => {
      const trendBits = [];
      if (r.trend_growth_pct != null) trendBits.push(`trend ${signed(r.trend_growth_pct)}%/yr`);
      if (r.vs_trend_pct != null) trendBits.push(`vs trend ${signed(r.vs_trend_pct)}%`);
      return `<b>${r.ticker}</b>${r.name && r.name !== r.ticker ? ` — ${r.name}` : ""} &nbsp;#${r.rank}<br>` +
        `net legs/yr: <b>${fmt(r.net_legs_per_year, 1)}</b> (${r.n_up}▲ / ${r.n_down}▼)<br>` +
        (trendBits.length ? `${trendBits.join(" · ")}<br>` : "") +
        `CAGR: ${fmt(r.cagr_pct, 1)}%/yr<br>` +
        `MaxDD: ${fmt(r.max_drawdown_pct, 1)}%<br>` +
        `price: ${fmt(r.current_price, 2)}`;
    };

    const traces = [{
      type: "scattergl", mode: "markers",
      x: others.map((r) => r.cagr_pct),
      y: others.map((r) => r.net_legs_per_year),
      text: others.map(hover),
      hoverinfo: "text",
      marker: {
        size: 9,
        color: others.map((r) => r.max_drawdown_pct),
        colorscale: "Viridis", cmin: -100, cmax: 0,
        colorbar: { title: { text: "MaxDD%" }, thickness: 14 },
        opacity: 0.75, line: { width: 0.5, color: "rgba(0,0,0,0.25)" },
      },
    }];

    const cs = getComputedStyle(document.documentElement);
    const clrAccent = cs.getPropertyValue("--accent").trim() || "#0284c7";
    const clrBg = cs.getPropertyValue("--bg").trim() || "#ffffff";
    const clrFg = cs.getPropertyValue("--fg").trim() || "#1a202c";
    const clrBorder = cs.getPropertyValue("--border").trim() || "#e2e8f0";
    const clrMuted = cs.getPropertyValue("--fg-subtle").trim() || "#718096";

    if (zeta) {
      traces.push({
        type: "scattergl", mode: "markers+text",
        x: [zeta.cagr_pct], y: [zeta.net_legs_per_year],
        text: ["ZETA"], textposition: "top center",
        textfont: { color: clrAccent, size: 13 },
        hoverinfo: "text", hovertext: [hover(zeta)],
        marker: { size: 20, color: clrAccent, line: { width: 1.5, color: clrBg } },
      });
    }

    Plotly.newPlot(el, traces, {
      title: { text: "Net oscillation surplus vs growth (trend-positive tickers)", font: { color: clrFg } },
      xaxis: { title: "CAGR %/yr", zeroline: true, zerolinecolor: clrMuted, zerolinewidth: 1.5, gridcolor: clrBorder, color: clrFg },
      yaxis: { title: "net legs per year (up minus down)", gridcolor: clrBorder, color: clrFg },
      hovermode: "closest",
      margin: { t: 50, r: 20, b: 55, l: 60 },
      paper_bgcolor: clrBg, plot_bgcolor: clrBg, font: { color: clrFg },
      shapes: [{ type: "line", x0: 0, x1: 0, yref: "paper", y0: 0, y1: 1, line: { color: clrMuted, width: 1, dash: "dot" } }],
    }, { responsive: true, displaylogo: false });
  }

  // ---- Tabulator table ----
  let tabulatorInstance = null;

  function buildTable(el, results, opts = {}) {
    if (tabulatorInstance) { tabulatorInstance.destroy(); tabulatorInstance = null; }

    const recentEventsFmt = (cell) => {
      const events = cell.getValue() || [];
      if (!events.length) return `<span style="opacity:0.35;">—</span>`;
      return events.map((ev) => {
        const up = ev.direction === "up";
        const sign = up ? "+1↑" : "-1↓";
        const color = up ? "var(--up,#0369a1)" : "var(--down,#c2410c)";
        const bg = up ? "var(--up-bg,#e0f2fe)" : "var(--down-bg,#fff7ed)";
        return `<span title="${ev.date}" style="font-size:0.75em;font-weight:700;padding:2px 6px;border-radius:20px;background:${bg};color:${color};">${sign}</span>`;
      }).join(" ");
    };

    const tickerFmt = (cell) => {
      const r = cell.getRow().getData();
      const t = cell.getValue();
      let warn = "";
      if (!r.trend_positive) {
        warn = ` <span title="net downtrend over the lookback — not a candidate" style="cursor:help;">📉</span>`;
      } else if (r.parabolic) {
        warn = ` <span title="parabolic run-up (${fmt(r.recent_run_up_pct ?? r.max_run_up_pct, 0)}% from a trailing 12-month low within the last 2 years) — legs came from a one-way spike, not a repeatable dip-cycle; ranked below steady oscillators" style="cursor:help;">🚀</span>`;
      } else if (r.chained_dips) {
        warn = ` <span title="chained dips (worst run: ${r.max_down_streak} consecutive down legs; ${r.deep_down_runs ?? "?"} runs of 4+) — BUY signals routinely ride deep underwater before harvesting; ranked below clean oscillators" style="cursor:help;">⛓️</span>`;
      } else if (r.thin_history) {
        warn = ` <span title="thin history (only ${r.n_events} completed legs) — not enough evidence for the rates to mean anything; ranked below proven oscillators" style="cursor:help;">🌱</span>`;
      } else if (r.short_history) {
        warn = ` <span title="short history (only ${fmt(r.span_years, 1)}y of price data) — the rate is computed over a span this ticker never lived through; ranked below proven oscillators" style="cursor:help;">🐣</span>`;
      }
      const chartUrl = `${siteBase()}/chart/?ticker=${encodeURIComponent(t)}`;
      return `<a href="${chartUrl}" style="font-weight:700;color:var(--accent,#0284c7);">${t}</a>${warn}`;
    };

    const num = (d) => (cell) => fmt(cell.getValue(), d);

    tabulatorInstance = new Tabulator(el, {
      data: results,
      layout: "fitDataFill",
      pagination: true,
      paginationSize: opts.pageSize || 50,
      paginationSizeSelector: [25, 50, 100, 250],
      movableColumns: true,
      initialSort: opts.sort || [{ column: "rank", dir: "asc" }],
      columns: [
        { title: "#", field: "rank", sorter: "number", hozAlign: "right", width: 55 },
        { title: "Ticker", field: "ticker", sorter: "string", width: 105, formatter: tickerFmt },
        { title: "Name", field: "name", sorter: "string", width: 220,
          formatter: (cell) => {
            const v = cell.getValue();
            if (!v) return `<span style="color:var(--fg-muted,#4a5568);">—</span>`;
            const short = v.length > 30 ? `${v.slice(0, 30)}…` : v;
            return `<span title="${v}" style="color:var(--fg-muted,#4a5568);">${short}</span>`;
          } },
        { title: "Price", field: "current_price", sorter: "number", hozAlign: "right", width: 90, formatter: num(2) },
        { title: "Trend growth", field: "trend_growth_pct", sorter: "number",
          sorterParams: { alignEmptyValues: "bottom" }, hozAlign: "right", width: 140,
          formatter: (cell) => {
            const v = cell.getValue();
            if (v == null) return `<span style="opacity:0.35;">—</span>`;
            return `<span title="Steady yearly growth that best fits every daily close over the period (least-squares line on log price)" style="cursor:help;">${signed(v)}%/yr</span>`;
          } },
        { title: "Trend price today", field: "trend_price", sorter: "number",
          sorterParams: { alignEmptyValues: "bottom" }, hozAlign: "right", width: 170,
          formatter: (cell) => {
            const v = cell.getValue();
            if (v == null) return `<span style="opacity:0.35;">—</span>`;
            return `<span title="Where the dashed trend line sits on the latest date" style="cursor:help;">${fmt(v, 2)}</span>`;
          } },
        { title: "vs trend", field: "vs_trend_pct", sorter: "number",
          sorterParams: { alignEmptyValues: "bottom" }, hozAlign: "right", width: 100,
          formatter: (cell) => {
            const v = cell.getValue();
            if (v == null) return `<span style="opacity:0.35;">—</span>`;
            const color = v < 0 ? "var(--down,#c2410c)" : "var(--up,#0369a1)";
            return `<span title="Latest close vs the trend line: negative = below trend, positive = above" style="color:${color};font-weight:700;cursor:help;">${signed(v)}%</span>`;
          } },
        { title: "n▲", field: "n_up", sorter: "number", hozAlign: "right", width: 60 },
        { title: "n▼", field: "n_down", sorter: "number", hozAlign: "right", width: 60 },
        { title: "CAGR%", field: "cagr_pct", sorter: "number", hozAlign: "right", width: 85, formatter: num(1) },
        { title: "MaxDD%", field: "max_drawdown_pct", sorter: "number", hozAlign: "right", width: 90, formatter: num(1) },
        { title: "1y run↑%", field: "max_run_up_pct", sorter: "number", hozAlign: "right", width: 95,
          formatter: (cell) => {
            const r = cell.getRow().getData();
            const v = fmt(cell.getValue(), 0);
            return r.parabolic
              ? `<span style="color:var(--down,#c2410c);font-weight:700;">${v} 🚀</span>`
              : v;
          } },
        { title: "Recent Δ", field: "recent_events", hozAlign: "center", width: 150, formatter: recentEventsFmt },
      ],
      rowFormatter: (row) => {
        const d = row.getData();
        const el = row.getElement();
        if (!d.trend_positive || d.parabolic) {
          el.style.opacity = "0.45";
        } else if (d.chained_dips || d.thin_history || d.short_history) {
          el.style.opacity = "0.65";
        }
        if (d.ticker === HIGHLIGHT) {
          el.style.background = "var(--accent-light,#e0f2fe)";
          el.style.borderLeft = "3px solid var(--accent,#0284c7)";
        }
      },
    });

    // Threshold changes destroy and rebuild the table from scratch, which
    // would otherwise silently drop the sort and the filters (the inputs
    // keep their values, but the new table starts unfiltered); re-apply both
    // once the new table exists, then jump to the saved page — setting
    // filters re-paginates, so the page has to be set after it.
    tabulatorInstance.on("tableBuilt", () => {
      applyFilters();
      const paged = opts.page > 1 ? tabulatorInstance.setPage(opts.page) : null;
      if (restoring) {
        // Scroll once the saved page has rendered. Not requestAnimationFrame:
        // it never fires in a hidden tab, which left the scroll unrestored
        // (and saving disabled) until the tab was shown. scrollTo forces a
        // synchronous layout, so no extra frame is needed. The catch covers a
        // saved page that no longer exists (setPage rejects) — still finish.
        Promise.resolve(paged).catch(() => {}).then(() => {
          // "instant": the site CSS sets scroll-behavior: smooth, which would
          // animate up from the top (and never run at all in a hidden tab),
          // so the saveState() below would record the starting position.
          window.scrollTo({ top: restoreScrollY, left: 0, behavior: "instant" });
          restoring = false;
          saveState();
        });
      }
    });
    ["dataSorted", "pageLoaded", "pageSizeChanged"].forEach((evt) =>
      tabulatorInstance.on(evt, saveState));
  }

  // Hoisted out of wireFilters so buildTable's tableBuilt handler can
  // re-apply the current filter inputs to a freshly (re)built table.
  function applyFilters() {
    if (!tabulatorInstance) return;
    const filters = [];
    const q = document.getElementById("f-ticker")?.value.trim().toLowerCase();
    if (q) {
      // Tabulator's array-form setFilter only recognizes custom predicates
      // wrapped as {field: fn} — a bare function is silently dropped (it
      // looks for a filter.type in its registry and finds none).
      filters.push({
        field: (data) =>
          (data.ticker || "").toLowerCase().includes(q) ||
          (data.name || "").toLowerCase().includes(q),
      });
    }
    const rankMax = document.getElementById("f-rank-max")?.value;
    if (rankMax) filters.push({ field: "rank", type: "<=", value: Number(rankMax) });
    const vstrendMax = document.getElementById("f-vstrend-max")?.value;
    if (vstrendMax) filters.push({ field: (d) => d.vs_trend_pct != null && d.vs_trend_pct <= Number(vstrendMax) });
    const cagrMin = document.getElementById("f-cagr-min")?.value;
    if (cagrMin) filters.push({ field: "cagr_pct", type: ">=", value: Number(cagrMin) });
    const cagrMax = document.getElementById("f-cagr-max")?.value;
    if (cagrMax) filters.push({ field: "cagr_pct", type: "<=", value: Number(cagrMax) });
    tabulatorInstance.setFilter(filters);
  }

  function wireFilters() {
    if (!tabulatorInstance) return;

    document.querySelectorAll("#tb-filters input").forEach(inp => inp.addEventListener("input", () => {
      applyFilters();
      saveState();
    }));
    document.getElementById("f-reset")?.addEventListener("click", () => {
      document.querySelectorAll("#tb-filters input").forEach(inp => inp.value = "");
      tabulatorInstance?.clearFilter();
      saveState();
    });
  }

  // ---- History-state save/restore ----
  // Persisted in history.state (not localStorage/sessionStorage) so a fresh
  // visit — e.g. the nav bar's Leaderboard link from the chart page — starts
  // clean, and only Back/Forward/Reload restore where the user left off.
  let restoring = false; // true while init() is replaying a saved state
  let restoreScrollY = 0;
  const KNOWN_FILTER_IDS = ["f-ticker", "f-rank-max", "f-vstrend-max", "f-cagr-min", "f-cagr-max"];

  function readState() {
    const filters = {};
    document.querySelectorAll("#tb-filters input").forEach((inp) => {
      if (inp.id) filters[inp.id] = inp.value;
    });
    const thresholdInput = document.getElementById("lb-threshold");
    return {
      v: 1,
      threshold: thresholdInput ? parseFloat(thresholdInput.value) : defaultThreshold,
      filters,
      sort: tabulatorInstance ? tabulatorInstance.getSorters().map((s) => ({ column: s.field, dir: s.dir })) : [],
      page: tabulatorInstance ? tabulatorInstance.getPage() : 1,
      pageSize: tabulatorInstance ? tabulatorInstance.getPageSize() : 50,
      scrollY: window.scrollY,
    };
  }

  function saveState() {
    // No-op while restoring: the initial build fires its own sort/page/etc.
    // events, which would otherwise overwrite the saved state (scroll
    // position included) with the not-yet-restored, in-progress values.
    if (restoring) return;
    history.replaceState({ ...(history.state || {}), lb: readState() }, "");
  }

  function validateState(raw, thresholdInput) {
    if (!raw || raw.v !== 1) return null;
    const state = { filters: {}, sort: [], page: 1, pageSize: 50, scrollY: 0, threshold: null };
    if (Number.isFinite(raw.threshold) && thresholdInput) {
      const min = parseFloat(thresholdInput.min);
      const max = parseFloat(thresholdInput.max);
      if (raw.threshold >= min && raw.threshold <= max) state.threshold = raw.threshold;
    }
    if (raw.filters && typeof raw.filters === "object") {
      KNOWN_FILTER_IDS.forEach((id) => {
        if (typeof raw.filters[id] === "string") state.filters[id] = raw.filters[id];
      });
    }
    if (Array.isArray(raw.sort)) {
      state.sort = raw.sort
        .filter((s) => s && typeof s.column === "string" && (s.dir === "asc" || s.dir === "desc"))
        .map((s) => ({ column: s.column, dir: s.dir }));
    }
    if (Number.isFinite(raw.page) && raw.page >= 1) state.page = Math.floor(raw.page);
    if (Number.isFinite(raw.pageSize) && raw.pageSize > 0) state.pageSize = Math.floor(raw.pageSize);
    if (Number.isFinite(raw.scrollY) && raw.scrollY >= 0) state.scrollY = raw.scrollY;
    return state;
  }

  // ---- Bootstrap ----
  let lastResults = [];
  let defaultThreshold = 10;
  const screenCache = new Map(); // thresholdPct -> payload

  async function loadManifest() {
    const url = `${dataBase()}/screen_manifest.json`;
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
    return await resp.json();
  }

  async function loadScreen(thresholdPct) {
    if (screenCache.has(thresholdPct)) return screenCache.get(thresholdPct);
    const url = `${dataBase()}/bullish_screen_${thresholdPct}pct.json`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
    const data = await resp.json();
    screenCache.set(thresholdPct, data);
    return data;
  }

  function renderMeta(metaEl, data) {
    const results = data.results || [];
    const nPos = results.filter((r) => r.trend_positive && !r.parabolic && !r.chained_dips && !r.thin_history && !r.short_history).length;
    const nPara = results.filter((r) => r.trend_positive && r.parabolic).length;
    const nChain = results.filter((r) => r.trend_positive && !r.parabolic && r.chained_dips).length;
    const nThin = results.filter((r) => r.trend_positive && !r.parabolic && !r.chained_dips && r.thin_history).length;
    const nShort = results.filter((r) => r.trend_positive && !r.parabolic && !r.chained_dips && !r.thin_history && r.short_history).length;
    metaEl.innerHTML =
      `Screened <b>${data.universe_size}</b> tickers @ ±${data.threshold_pct}% ` +
      `over ${data.lookback_years}y — <b>${nPos}</b> steady trend-positive candidates, ` +
      `${nThin} thin histories (🌱, ranked down), ` +
      `${nShort} short histories (🐣, ranked down), ` +
      `${nChain} dip-chainers (⛓️, ranked down), ` +
      `${nPara} parabolic runners (🚀, ranked down), ` +
      `${results.filter((r) => !r.trend_positive).length} downtrenders (greyed). ` +
      `<small>Generated ${new Date(data.generated_at).toLocaleString()}.</small>`;
  }

  async function loadAndRender(thresholdPct, isFallback, opts) {
    const scatterEl = document.getElementById("bullish-scatter");
    const tableEl = document.getElementById("bullish-table");
    const metaEl = document.getElementById("bullish-meta");
    if (!scatterEl || typeof Plotly === "undefined" || typeof Tabulator === "undefined") return;

    try {
      const data = await loadScreen(thresholdPct);
      lastResults = data.results || [];
      if (metaEl) renderMeta(metaEl, data);
      renderScatter(scatterEl, lastResults);
      buildTable(tableEl, lastResults, opts);
    } catch (err) {
      if (!isFallback && thresholdPct !== defaultThreshold) {
        const thresholdInput = document.getElementById("lb-threshold");
        const thresholdLabel = document.getElementById("lb-threshold-label");
        if (thresholdInput) thresholdInput.value = defaultThreshold;
        if (thresholdLabel) thresholdLabel.textContent = `${defaultThreshold}%`;
        return loadAndRender(defaultThreshold, true, opts);
      }
      if (metaEl) metaEl.innerHTML =
        `<span style="color:var(--down,#c2410c);">Could not load bullish_screen_${thresholdPct}pct.json (${err.message || err}). ` +
        "Run <code>python3 main.py leaderboard</code> to generate it.</span>";
      // No table gets built on total failure, so tableBuilt never fires to
      // clear this — clear it here instead.
      restoring = false;
    }
  }

  async function init() {
    const scatterEl = document.getElementById("bullish-scatter");
    if (!scatterEl) return;

    // We restore scroll ourselves once the (async-built) table exists; left
    // on "auto" the browser would jump immediately, before it's there.
    history.scrollRestoration = "manual";

    const thresholdInput = document.getElementById("lb-threshold");
    const thresholdLabel = document.getElementById("lb-threshold-label");

    if (thresholdInput) {
      try {
        const manifest = await loadManifest();
        if (typeof manifest.default === "number") defaultThreshold = manifest.default;
        if (Array.isArray(manifest.thresholds) && manifest.thresholds.length) {
          thresholdInput.min = Math.min(...manifest.thresholds);
          thresholdInput.max = Math.max(...manifest.thresholds);
        }
      } catch (e) {
        // Manifest missing: fall back to the slider's markup defaults (5-20, default 10).
      }
    }

    // Validated against the slider's min/max, which the manifest may have
    // just changed above.
    const savedState = validateState(history.state?.lb, thresholdInput);

    if (thresholdInput) {
      const initialThreshold = savedState?.threshold ?? defaultThreshold;
      thresholdInput.value = initialThreshold;
      if (thresholdLabel) thresholdLabel.textContent = `${initialThreshold}%`;

      thresholdInput.addEventListener("input", () => {
        const n = parseFloat(thresholdInput.value);
        if (thresholdLabel) thresholdLabel.textContent = `${n}%`;
        // Rows are changing (page resets to 1), but carry sort/page size over
        // from the table that's about to be destroyed.
        const oldOpts = tabulatorInstance ? {
          sort: tabulatorInstance.getSorters().map((s) => ({ column: s.field, dir: s.dir })),
          pageSize: tabulatorInstance.getPageSize(),
        } : undefined;
        loadAndRender(n, false, oldOpts);
        saveState();
      });
    }

    if (savedState) {
      restoring = true;
      restoreScrollY = savedState.scrollY;
      Object.keys(savedState.filters).forEach((id) => {
        const inp = document.getElementById(id);
        if (inp) inp.value = savedState.filters[id];
      });
      await loadAndRender(savedState.threshold ?? defaultThreshold, false, {
        sort: savedState.sort.length ? savedState.sort : undefined,
        pageSize: savedState.pageSize,
        page: savedState.page,
      });
    } else {
      await loadAndRender(defaultThreshold, false);
    }

    wireFilters();

    const rerenderScatter = () => renderScatter(scatterEl, lastResults);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerenderScatter);
    window.addEventListener("themechange", rerenderScatter);

    // Capture-phase so the scroll position is recorded synchronously, right
    // before a ticker's plain <a href> navigates the page away.
    document.getElementById("bullish-table")?.addEventListener("click", saveState, true);

    let scrollSaveTimer = null;
    window.addEventListener("scroll", () => {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveState, 150);
    }, { passive: true });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
