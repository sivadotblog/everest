/* Losers page — tickers flagged `loser` in the leaderboard payload
 * (n_up <= loser_max_up_down_ratio * n_down at the selected threshold).
 * Loser rows are trimmed to ticker / name / leg counts by report.py, so this
 * page only lists them: no chart, no ranking math beyond n_up / n_down.
 */
(function () {
  "use strict";

  function dataBase() {
    return window.__DATA_BASE__ || "/everest/data";
  }

  let table = null;
  let defaultThreshold = 10;
  // The slider moves over indexes into this list (unevenly spaced, e.g.
  // 5 / 7.5 / 10 / 15 / 20); the manifest replaces it on load.
  let thresholds = [5, 10, 15, 20];

  async function fetchJson(url, cache) {
    const resp = await fetch(url, { cache });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
    return await resp.json();
  }

  function applyFilter() {
    if (!table) return;
    const q = document.getElementById("f-ticker")?.value.trim().toLowerCase();
    if (!q) { table.clearFilter(); return; }
    table.setFilter([{
      field: (d) => (d.ticker || "").toLowerCase().includes(q) ||
        (d.name || "").toLowerCase().includes(q),
    }]);
  }

  async function render(thresholdPct) {
    const metaEl = document.getElementById("loser-meta");
    const tableEl = document.getElementById("loser-table");
    if (!tableEl || typeof Tabulator === "undefined") return;

    let data;
    try {
      data = await fetchJson(`${dataBase()}/bullish_screen_${thresholdPct}pct.json`, "no-store");
    } catch (err) {
      metaEl.innerHTML = `<span style="color:var(--down,#c2410c);">Could not load ` +
        `bullish_screen_${thresholdPct}pct.json (${err.message || err}).</span>`;
      return;
    }

    const losers = (data.results || [])
      .filter((r) => r.loser)
      .map((r) => ({ ...r, ratio: r.n_down ? r.n_up / r.n_down : null }));
    metaEl.innerHTML =
      `<b>${losers.length}</b> of ${(data.results || []).length} tickers @ ±${data.threshold_pct}% ` +
      `have n▲ ≤ ${data.loser_max_up_down_ratio}× n▼. ` +
      `<small>Generated ${new Date(data.generated_at).toLocaleString()}.</small>`;

    const sort = table
      ? table.getSorters().map((s) => ({ column: s.field, dir: s.dir }))
      : [{ column: "ratio", dir: "asc" }];
    if (table) table.destroy();
    table = new Tabulator(tableEl, {
      data: losers,
      layout: "fitDataFill",
      pagination: true,
      paginationSize: 50,
      paginationSizeSelector: [25, 50, 100, 250],
      initialSort: sort,
      columns: [
        { title: "Ticker", field: "ticker", sorter: "string", width: 105,
          formatter: (cell) => `<b>${cell.getValue()}</b>` },
        { title: "Name", field: "name", sorter: "string", width: 260,
          formatter: (cell) => {
            const v = cell.getValue() || "—";
            const short = v.length > 36 ? `${v.slice(0, 36)}…` : v;
            return `<span title="${v}" style="color:var(--fg-muted,#4a5568);">${short}</span>`;
          } },
        { title: "n▲", field: "n_up", sorter: "number", hozAlign: "right", width: 70 },
        { title: "n▼", field: "n_down", sorter: "number", hozAlign: "right", width: 70 },
        { title: "Ratio", field: "ratio", sorter: "number",
          sorterParams: { alignEmptyValues: "bottom" }, hozAlign: "right", width: 90,
          formatter: (cell) => {
            const v = cell.getValue();
            return v == null ? `<span style="opacity:0.35;">—</span>` : v.toFixed(2);
          } },
      ],
    });
    table.on("tableBuilt", applyFilter);
  }

  async function init() {
    const input = document.getElementById("lb-threshold");
    const label = document.getElementById("lb-threshold-label");
    if (!input) return;

    try {
      const manifest = await fetchJson(`${dataBase()}/screen_manifest.json`, "no-cache");
      if (typeof manifest.default === "number") defaultThreshold = manifest.default;
      if (Array.isArray(manifest.thresholds) && manifest.thresholds.length) {
        thresholds = [...manifest.thresholds].sort((x, y) => x - y);
      }
    } catch (e) {
      // Manifest missing: fall back to the built-in list (5-20, default 10).
    }

    input.min = 0;
    input.max = thresholds.length - 1;
    input.step = 1;
    input.value = Math.max(0, thresholds.indexOf(defaultThreshold));
    if (label) label.textContent = `${thresholds[Number(input.value)]}%`;
    input.addEventListener("input", () => {
      const n = thresholds[Number(input.value)];
      if (label) label.textContent = `${n}%`;
      render(n);
    });
    document.getElementById("f-ticker")?.addEventListener("input", applyFilter);

    await render(defaultThreshold);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
