// Page wiring: passcode gate, filters, KPI tiles, charts, tables, chat.
(function () {
  const { fmt } = window.CRE;
  const esc = window.Assistant.esc;
  const $ = (id) => document.getElementById(id);
  const state = { type: "Office", market: "ALL", range: 20, scenario: 0 };
  const sortState = { key: "vacancy", asc: true };

  // ------------------------------------------------------------------ gate
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function storageGet(store, k) { try { return window[store].getItem(k); } catch { return null; } }
  function storageSet(store, k, v) { try { window[store].setItem(k, v); } catch { /* private mode: fine */ } }

  function byline() {
    const c = window.CRE_CONFIG;
    const demo = c.preparedFor ? `Project Demo for ${c.preparedFor}` : "Project Demo";
    document.querySelectorAll(".js-demo-for").forEach((el) => { el.textContent = demo; });
    document.querySelectorAll(".js-author").forEach((el) => { el.textContent = c.author ? `by ${c.author}` : ""; });
    document.querySelectorAll(".js-byline").forEach((el) => { el.textContent = [demo, c.author && `by ${c.author}`].filter(Boolean).join(" · "); });
    if (c.preparedFor) document.title = `CRE Market Pulse · Project Demo for ${c.preparedFor}`;
    if (c.author) {
      $("footer-author").textContent = `Built by ${c.author}.${c.preparedFor ? ` Independent project demo, not affiliated with or endorsed by ${c.preparedFor}.` : ""}`;
    }
  }

  function gate() {
    const want = (window.CRE_CONFIG.passcodeSha256 || "").toLowerCase();
    if (!want || storageGet("sessionStorage", "cre-pulse-unlocked") === want) return Promise.resolve();
    $("gate").hidden = false;
    $("gate-input").focus();
    return new Promise((resolve) => {
      $("gate-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        let ok = false;
        try { ok = (await sha256($("gate-input").value.trim())) === want; } catch { ok = false; }
        if (ok) {
          storageSet("sessionStorage", "cre-pulse-unlocked", want);
          // The hosted server checks the passcode itself before calling Gemini.
          storageSet("sessionStorage", "cre-pulse-passcode", $("gate-input").value.trim());
          $("gate").hidden = true;
          resolve();
        } else {
          $("gate-error").hidden = false;
          $("gate-input").select();
        }
      });
    });
  }

  // ----------------------------------------------------------------- theme
  function initTheme() {
    const saved = storageGet("localStorage", "cre-pulse-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
    $("theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      storageSet("localStorage", "cre-pulse-theme", next);
      renderMarket();
      renderPortfolio();
      Explorer.refresh();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { renderMarket(); renderPortfolio(); Explorer.refresh(); });
  }

  // --------------------------------------------------------------- filters
  function initFilters() {
    const D = CRE.data();
    const seg = $("f-type");
    for (const t of D.property_types) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.textContent = t;
      btn.addEventListener("click", () => setState({ type: t }));
      btn.addEventListener("keydown", (e) => {
        const i = D.property_types.indexOf(state.type);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const n = D.property_types[(i + (e.key === "ArrowRight" ? 1 : D.property_types.length - 1)) % D.property_types.length];
          setState({ type: n });
          seg.querySelector(`[data-t="${n}"]`).focus();
          e.preventDefault();
        }
      });
      btn.dataset.t = t;
      seg.appendChild(btn);
    }
    const sel = $("f-market");
    sel.add(new Option("All 10 markets", "ALL"));
    for (const m of D.markets) sel.add(new Option(m.name, m.id));
    sel.addEventListener("change", () => setState({ market: sel.value }));
    $("f-range").addEventListener("change", (e) => setState({ range: +e.target.value }));
    $("asof").textContent = `Data through ${D.quarters[D.quarters.length - 1].replace("Q", " Q")} · sample`;
  }

  function syncFilters() {
    $("f-market").value = state.market;
    $("f-range").value = String(state.range);
    for (const b of $("f-type").children) {
      const on = b.dataset.t === state.type;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    }
  }

  function setState(patch) {
    const changed = Object.keys(patch).some((k) => patch[k] !== undefined && patch[k] !== state[k]);
    Object.assign(state, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (changed) renderMarket();
  }

  // ------------------------------------------------------------------ KPIs
  function tile({ label, value, delta, deltaClass, deltaNote, note, spark, hero }) {
    const card = document.createElement("article");
    card.className = "card kpi" + (hero ? " kpi-hero" : "");
    const l = document.createElement("div"); l.className = "kpi-label"; l.textContent = label;
    const v = document.createElement("div"); v.className = "kpi-value"; v.textContent = value;
    card.append(l, v);
    if (delta) {
      const d = document.createElement("div"); d.className = "kpi-delta";
      const s = document.createElement("span"); s.className = deltaClass || "flat"; s.textContent = delta;
      d.append(s, document.createTextNode(" " + (deltaNote || "")));
      card.appendChild(d);
    }
    if (note) { const n = document.createElement("div"); n.className = "kpi-note"; n.textContent = note; card.appendChild(n); }
    if (spark) card.appendChild(Charts.spark(spark));
    return card;
  }

  function rangeSlice(arr) { return arr.slice(-state.range); }

  function renderKpis() {
    const k = CRE.kpis(state.market, state.type);
    const s = CRE.series(state.market, state.type);
    const absT4 = CRE.rollingT4(s.net_absorption_sf);
    const salesT4 = CRE.rollingT4(s.sales_volume_usd);
    const dir = (v, upGood, eps = 0.05) => (Math.abs(v) < eps ? "flat" : (v > 0) === upGood ? "up-good" : "up-bad");
    const tiles = [
      tile({ hero: true, label: "Vacancy rate", value: fmt.pct(k.vacancy), delta: fmt.pp(k.vacancyYoY), deltaClass: dir(k.vacancyYoY, false), deltaNote: "vs. a year ago", spark: rangeSlice(s.vacancy_pct) }),
      tile({ label: "Net absorption, last 4 quarters", value: fmt.signedSf(k.absorptionT4), delta: fmt.signedSf(k.absorptionT4 - k.absorptionPrevT4), deltaClass: dir(k.absorptionT4 - k.absorptionPrevT4, true, 1), deltaNote: "vs. the prior 4 quarters", spark: rangeSlice(absT4) }),
      tile({ label: "Asking rent ($/sf/yr)", value: fmt.rent(k.rent), delta: fmt.signedPct(k.rentYoY), deltaNote: "YoY", spark: rangeSlice(s.asking_rent_psf) }),
      tile({ label: "Cap rate", value: fmt.pct(k.cap, 2), delta: fmt.bps(k.capYoYbps), deltaNote: "YoY", note: `${Math.round(k.spreadBps)} bps over the 10-year Treasury`, spark: rangeSlice(s.cap_rate_pct) }),
      tile({ label: "Under construction", value: fmt.sf(k.underConstruction), note: `${fmt.pct(k.ucPctInventory)} of ${fmt.sf(k.inventory, 0)} inventory`, spark: rangeSlice(s.under_construction_sf) }),
      tile({ label: "Sales volume, last 4 quarters", value: fmt.usd(k.salesT4), delta: fmt.signedPct(k.salesYoY), deltaNote: "vs. the prior 4 quarters", spark: rangeSlice(salesT4) }),
    ];
    $("kpis").replaceChildren(...tiles);
  }

  // --------------------------------------------------------------- summary
  function renderSummary() {
    const s = CRE.summary(state.market, state.type);
    $("summary-source").textContent = "Insight engine (runs in the browser, computed from the data)";
    $("summary-body").innerHTML = `<p class="headline">${esc(s.headline)}</p><ul>${s.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div class="reco">${s.reco.map(esc).join("<br>")}</div>`;
    $("summary-gemini").hidden = !Assistant.isGemini();
  }

  async function geminiSummary() {
    const body = $("summary-body");
    body.classList.add("loading");
    try {
      const g = await Assistant.geminiSummary({ ...state });
      body.innerHTML = g.html;
      $("summary-source").textContent = `Gemini (${g.model}), grounded in the dashboard's KPI context`;
    } catch (err) {
      $("summary-source").textContent = `Gemini unavailable (${String(err.message).slice(0, 100)}). Showing the insight engine.`;
    } finally {
      body.classList.remove("loading");
    }
  }

  // ---------------------------------------------------------------- charts
  const where = () => (state.market === "ALL" ? `${state.type}, all 10 markets` : `${CRE.marketName(state.market)} ${state.type.toLowerCase()}`);
  const qLabel = (q) => q.replace("Q", " Q");

  function renderVacancy(animate) {
    const qs = CRE.quarters();
    const s = CRE.series(state.market, state.type);
    const R = state.range;
    const labels = qs.slice(-R);
    const fc = CRE.vacancyForecast(state.market, state.type);
    const allLabels = [...labels, ...fc.quarters];
    const pad = (arr) => [...arr, ...fc.quarters.map(() => null)];
    const lastIdx = labels.length - 1;
    const actual = pad(s.vacancy_pct.slice(-R));
    const ahead = (f) => allLabels.map((_, i) => (i === lastIdx ? actual[lastIdx] : i > lastIdx ? f(fc.points[i - lastIdx - 1], i - lastIdx) : null));
    const fcLine = ahead((p) => p.value);
    const lower = ahead((p) => p.lower);
    const upper = ahead((p) => p.upper);
    const vSeries = [{ name: where(), values: actual, color: "--series-1", endLabel: false }];
    if (state.market !== "ALL") vSeries.push({ name: `${state.type}, all 10 markets`, values: pad(CRE.series("ALL", state.type).vacancy_pct.slice(-R)), color: "--benchmark", width: 1.5, endLabel: false });
    vSeries.push({ name: "Baseline forecast", values: fcLine, color: "--series-1", dashed: true, endLabel: true });

    // What-if: extra (or lost) annual demand as a share of inventory lowers
    // (or raises) vacancy by that share, spread evenly across the quarters.
    const x = state.scenario;
    const inv = s.inventory_sf[qs.length - 1];
    let scenarioEnd = null;
    if (x !== 0) {
      const sc = ahead((p, h) => p.value - (x / 4) * h);
      scenarioEnd = sc[sc.length - 1];
      vSeries.push({ name: "What-if scenario", values: sc, color: "--series-2", dashed: true, endLabel: true });
    }
    $("scenario-out").textContent = x === 0 ? "Baseline (no change)"
      : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}% of inventory (${fmt.signedSf(inv * x / 100)}/yr)`;

    const annotations = state.market === "ALL" ? [] : CRE.anomalies({ types: [state.type] })
      .filter((a) => a.market === state.market && labels.includes(a.quarter))
      .map((a) => ({ index: labels.indexOf(a.quarter), text: `Unusual move ${fmt.pp(a.delta)}` }));

    Charts.line($("chart-vacancy"), {
      labels: allLabels, series: vSeries, band: { lower, upper, color: "--series-1", name: "80% range" },
      yFormat: (v, axis) => (axis ? `${+v.toFixed(1)}%` : fmt.pct(v)), shadeFrom: lastIdx, shadeLabel: "Forecast",
      tooltipTitle: qLabel, ariaLabel: `Vacancy rate for ${where()} with a four-quarter forecast`,
      annotations, animate, link: "quarters",
    });
    const legendItems = [{ name: where(), color: "--series-1" }];
    if (state.market !== "ALL") legendItems.push({ name: "All 10 markets", color: "--benchmark" });
    legendItems.push({ name: "Baseline forecast", color: "--series-1", dashed: true }, { name: "80% range", color: "--series-1", kind: "band" });
    if (x !== 0) legendItems.push({ name: "What-if scenario", color: "--series-2", dashed: true });
    Charts.legend($("vac-legend"), legendItems);
    const end = fc.points[3];
    $("vac-sub").textContent = `${where()}: ${fmt.pct(s.vacancy_pct[qs.length - 1])} now. Baseline ${fmt.pct(end.value)} by ${qLabel(fc.quarters[3])}`
      + (scenarioEnd != null ? `; ${fmt.pct(scenarioEnd)} in the what-if scenario.` : ".");
  }

  function renderCharts(animate = true) {
    const qs = CRE.quarters();
    const s = CRE.series(state.market, state.type);
    const R = state.range;
    const labels = qs.slice(-R);
    renderVacancy(animate);

    Charts.columns($("chart-supply"), {
      labels,
      series: [
        { name: "Net absorption", values: s.net_absorption_sf.slice(-R), color: "--series-1" },
        { name: "Deliveries", values: s.deliveries_sf.slice(-R), color: "--series-2" },
      ],
      yFormat: (v, axis) => (axis ? fmt.axisCompact(v) : fmt.signedSf(v)), tooltipTitle: qLabel,
      ariaLabel: `Net absorption and deliveries for ${where()}`, animate, link: "quarters",
    });
    Charts.legend($("sd-legend"), [{ name: "Net absorption", color: "--series-1", kind: "rect" }, { name: "Deliveries", color: "--series-2", kind: "rect" }]);

    const k = CRE.kpis(state.market, state.type);
    Charts.line($("chart-cap"), {
      labels,
      series: [
        { name: "Cap rate", values: s.cap_rate_pct.slice(-R), color: "--series-1", endLabel: true },
        { name: "10-year Treasury", values: CRE.data().treasury_10y_pct.slice(-R), color: "--series-2", endLabel: true },
      ],
      yFormat: (v, axis) => (axis ? `${+v.toFixed(1)}%` : fmt.pct(v, 2)), tooltipTitle: qLabel,
      ariaLabel: `Cap rate and 10-year Treasury yield for ${where()}`, animate, link: "quarters",
    });
    Charts.legend($("cap-legend"), [{ name: "Cap rate", color: "--series-1" }, { name: "10-year Treasury", color: "--series-2" }]);
    $("cap-sub").textContent = `Spread is ${Math.round(k.spreadBps)} bps, ${k.spreadYoYbps >= 0 ? "wider" : "narrower"} by ${Math.abs(Math.round(k.spreadYoYbps))} bps YoY`;
  }

  // ------------------------------------------------------------- scorecard
  const SCORE_COLS = [
    { key: "name", label: "Market", left: true, get: (r) => r.name },
    { key: "vacancy", label: "Vacancy", get: (r) => r.vacancy, render: (r, max) => `<span class="minibar"><span>${fmt.pct(r.vacancy)}</span><span class="track"><span class="fill" style="width:${(r.vacancy / max * 100).toFixed(1)}%"></span></span></span>` },
    { key: "vacancyYoY", label: "YoY change", get: (r) => r.vacancyYoY, render: (r) => `<span class="${r.vacancyYoY <= -0.05 ? "delta-good" : r.vacancyYoY >= 0.05 ? "delta-bad" : ""}">${fmt.pp(r.vacancyYoY)}</span>` },
    { key: "absorptionT4", label: "Net absorption (4Q)", get: (r) => r.absorptionT4, render: (r) => fmt.signedSf(r.absorptionT4) },
    { key: "ucPctInventory", label: "Under constr. (% inv.)", get: (r) => r.ucPctInventory, render: (r) => fmt.pct(r.ucPctInventory) },
    { key: "rent", label: "Asking rent", get: (r) => r.rent, render: (r) => fmt.rent(r.rent) },
    { key: "rentYoY", label: "Rent YoY", get: (r) => r.rentYoY, render: (r) => fmt.signedPct(r.rentYoY) },
    { key: "cap", label: "Cap rate", get: (r) => r.cap, render: (r) => fmt.pct(r.cap, 2) },
    { key: "monthsOfSupply", label: "Months of supply", get: (r) => r.monthsOfSupply ?? Infinity, render: (r) => (r.monthsOfSupply == null ? "n/a" : r.monthsOfSupply >= 120 ? "120+" : Math.round(r.monthsOfSupply)) },
    { key: "signal", label: "Signal", left: true, get: (r) => ({ warning: 0, serious: 1, good: 2, neutral: 3 }[r.signal.level]), render: (r) => badge(r.signal) },
  ];

  function badge(sig) {
    return `<span class="badge ${sig.level}">${sig.level !== "neutral" ? '<span class="dot" aria-hidden="true"></span>' : ""}${esc(sig.label)}</span>`;
  }

  function renderScorecard() {
    const rows = CRE.scorecard(state.type);
    const col = SCORE_COLS.find((c) => c.key === sortState.key);
    rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return sortState.asc ? c : -c;
    });
    const max = Math.max(...rows.map((r) => r.vacancy));
    const all = { ...CRE.kpis("ALL", state.type), name: "All 10 markets" };
    all.signal = { level: "neutral", label: "Benchmark" };
    const head = `<thead><tr>${SCORE_COLS.map((c) => `<th class="sortable ${c.left ? "left" : ""}" data-k="${c.key}" scope="col" aria-sort="${sortState.key === c.key ? (sortState.asc ? "ascending" : "descending") : "none"}">${esc(c.label)}${sortState.key === c.key ? `<span class="arrow">${sortState.asc ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>`;
    const tr = (r, id) => `<tr data-m="${id}" tabindex="0" class="${state.market === id ? "selected" : ""}">${SCORE_COLS.map((c) => `<td class="${c.left ? "left" : ""}">${c.render ? c.render(r, max) : esc(c.get(r))}</td>`).join("")}</tr>`;
    const body = `<tbody>${rows.map((r) => tr(r, r.market)).join("")}</tbody>`;
    const foot = `<tfoot>${tr(all, "ALL")}</tfoot>`;
    const t = $("scorecard");
    t.className = "data-table clickable";
    t.innerHTML = head + body + foot;
    t.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      sortState.asc = sortState.key === k ? !sortState.asc : (k === "name" || k === "vacancy" || k === "signal");
      sortState.key = k;
      renderScorecard();
    }));
    t.querySelectorAll("tr[data-m]").forEach((r) => {
      const go = () => setState({ market: r.dataset.m });
      r.addEventListener("click", go);
      r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $("score-sub").textContent = `${state.type}, ${qLabel(rows[0].quarter)}. Click a row to focus the dashboard on that market. Click a column header to sort.`;
  }

  // Navy hero band: vacancy by property type, plus a highlights strip.
  function renderHero() {
    const D = CRE.data();
    $("hero-stats").replaceChildren(...D.property_types.map((t) => {
      const k = CRE.kpis("ALL", t);
      const d = document.createElement("div");
      d.className = "hero-stat";
      const l = document.createElement("div"); l.className = "hs-label"; l.textContent = `${t} vacancy`;
      const v = document.createElement("div"); v.className = "hs-value"; v.textContent = fmt.pct(k.vacancy);
      const n = document.createElement("div");
      const dir = Math.abs(k.vacancyYoY) < 0.05 ? "flat" : k.vacancyYoY < 0 ? "good" : "bad";
      n.className = `hs-delta ${dir}`;
      n.textContent = `${dir === "flat" ? "■" : k.vacancyYoY < 0 ? "▼" : "▲"} ${fmt.pp(k.vacancyYoY).replace(/^[+−±]/, "")} YoY`;
      n.title = dir === "good" ? "Vacancy falling: market tightening" : dir === "bad" ? "Vacancy rising: market softening" : "Little change";
      d.append(l, v, n, Charts.spark(CRE.series("ALL", t).vacancy_pct.slice(-12)));
      return d;
    }));

    $("hs-caption").textContent = `Vacancy snapshot · all 10 markets · ${qLabel(D.quarters[D.quarters.length - 1])}`;
    renderTicker();
  }

  // Scrolling highlights strip. Each item is computed from the data, and
  // clicking one focuses the dashboard on it.
  function tickerItems() {
    const D = CRE.data();
    const items = [{ label: "Sample data", text: "Every figure here is synthetic. None of it is real market data." }];
    for (const a of CRE.anomalies()) {
      items.push({ label: "Anomaly", text: `${CRE.marketName(a.market)} ${a.type.toLowerCase()} vacancy ${fmt.pp(a.delta)} in ${qLabel(a.quarter)}`, apply: { market: a.market, type: a.type } });
    }
    for (const t of D.property_types) {
      const fc = CRE.vacancyForecast("ALL", t);
      items.push({ label: "Forecast", text: `${t} vacancy ${fmt.pct(fc.points[3].value)} by ${qLabel(fc.quarters[3])}`, apply: { market: "ALL", type: t } });
    }
    for (const t of D.property_types) {
      const best = CRE.scorecard(t).sort((a, b) => b.rentYoY - a.rentYoY)[0];
      items.push({ label: "Rent growth", text: `${best.name} leads ${t.toLowerCase()} at ${fmt.signedPct(best.rentYoY)} YoY`, apply: { market: best.market, type: t } });
    }
    const ind = CRE.kpis("ALL", "Industrial");
    items.push({ label: "Capital markets", text: `Industrial cap rates ${Math.round(ind.spreadBps)} bps over Treasuries`, apply: { market: "ALL", type: "Industrial" } });
    const supply = CRE.scorecard("Industrial").sort((a, b) => b.ucPctInventory - a.ucPctInventory)[0];
    items.push({ label: "Pipeline", text: `${supply.name} industrial: ${fmt.pct(supply.ucPctInventory)} of inventory under construction`, apply: { market: supply.market, type: "Industrial" } });
    const p = CRE.portfolio();
    items.push({ label: "Portfolio", text: `${fmt.pct(p.pctExpiring24, 0)} of sample leases expire within 24 months`, jump: "portfolio" });
    return items;
  }

  function renderTicker() {
    const items = tickerItems();
    const makeSet = (hidden) => {
      const set = document.createElement("div");
      set.className = "ticker-set";
      if (hidden) set.setAttribute("aria-hidden", "true");
      for (const it of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ticker-item";
        if (hidden) btn.tabIndex = -1;
        const b = document.createElement("b"); b.textContent = it.label;
        const t = document.createElement("span"); t.className = "t-text"; t.textContent = it.text;
        btn.append(b, t);
        btn.addEventListener("click", () => {
          if (it.apply) { setState(it.apply); $("market").scrollIntoView({ behavior: "smooth" }); }
          if (it.jump) $(it.jump).scrollIntoView({ behavior: "smooth" });
        });
        set.appendChild(btn);
      }
      return set;
    };
    const track = $("ticker");
    track.replaceChildren(makeSet(false), makeSet(true));
    // Constant reading speed (~55 px/s) whatever the content length.
    requestAnimationFrame(() => track.style.setProperty("--ticker-dur", `${Math.round(track.scrollWidth / 2 / 55)}s`));
    const band = $("ticker-band");
    $("ticker-toggle").onclick = () => {
      const paused = band.classList.toggle("paused");
      $("ticker-toggle").setAttribute("aria-pressed", paused);
      $("ticker-toggle").setAttribute("aria-label", paused ? "Play the highlights ticker" : "Pause the highlights ticker");
    };
  }

  function renderMarket() {
    syncFilters();
    $("subtitle").replaceChildren(document.createTextNode("Dashboard is showing: "), Object.assign(document.createElement("b"), { textContent: where() }));
    renderKpis();
    renderSummary();
    renderCharts();
    renderScorecard();
    Explorer.render({ type: state.type, market: state.market });
  }

  // ------------------------------------------------------------- portfolio
  function renderPortfolio() {
    const p = CRE.portfolio();
    $("pf-kpis").replaceChildren(
      tile({ label: "Portfolio size", value: fmt.sf(p.totalSf), note: `${p.leases.length} leases · ${fmt.usd(p.annualRent)}/yr in rent` }),
      tile({ label: "Weighted avg. lease term (WALT)", value: `${p.walt.toFixed(1)} yrs`, note: "Remaining term, weighted by square feet" }),
      tile({ label: "Expiring within 24 months", value: fmt.pct(p.pctExpiring24, 0), note: `${p.count24} leases, by square feet` }),
      tile({ label: "Renewal cost increase, next 24 months", value: `${fmt.usd(p.renewalExposure24)}/yr`, note: "If renewed at today's asking rent" }),
    );

    const years = Object.keys(p.byYear).sort();
    const asOfYear = CRE.data().meta.as_of.slice(0, 4);
    const label = (y) => (y === asOfYear ? `${y} H2` : y);
    Charts.columns($("chart-expiry"), {
      labels: years.map(label),
      series: ["Office", "Industrial", "Retail"].map((t, i) => ({ name: t, values: years.map((y) => p.byYear[y][t]), color: `--series-${i + 1}` })),
      stacked: true, totalLabel: "Total",
      yFormat: (v, axis) => (axis ? fmt.axisCompact(v) : fmt.sf(v)),
      ariaLabel: "Square feet expiring by year, stacked by property type",
    });
    Charts.legend($("pf-legend"), ["Office", "Industrial", "Retail"].map((t, i) => ({ name: t, color: `--series-${i + 1}`, kind: "rect" })));

    $("pf-actions").innerHTML = p.priorities.map((l) =>
      `<li><div><div class="a-title">${esc(l.lease_id)} · ${esc(l.marketName)} ${esc(l.property_type.toLowerCase())}, ${fmt.sf(l.rentable_sf, 0)}, expires ${esc(new Date(l.expiration + "T00:00:00Z").toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }))}</div><div class="a-body">${esc(CRE.leaseAdvice(l))}</div></div></li>`).join("");

    const leases = p.leases.slice().sort((a, b) => a.months - b.months);
    const head = ["Lease", "Market", "Type", "Size", "Expires", "Months left", "In-place rent", "Market rent", "Mark-to-market", "Annual impact", "Market vacancy", "Urgency"];
    $("leases").innerHTML = `<thead><tr>${head.map((h, i) => `<th scope="col" class="${i < 3 || i === 11 ? "left" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${leases.map((l) => `<tr>
      <td>${esc(l.lease_id)}</td><td class="left">${esc(l.marketName)}</td><td class="left">${esc(l.property_type)}</td>
      <td>${fmt.int(l.rentable_sf)}</td><td>${esc(l.expiration.slice(0, 7))}</td><td>${Math.round(l.months)}</td>
      <td>${fmt.rent(l.in_place_rent_psf)}</td><td>${fmt.rent(l.market_rent_psf)}</td>
      <td class="${l.mtmPct > 1 ? "delta-bad" : l.mtmPct < -1 ? "delta-good" : ""}">${fmt.signedPct(l.mtmPct)}</td>
      <td>${l.mtmAnnual >= 0 ? "+" : ""}${fmt.usd(l.mtmAnnual)}</td><td>${fmt.pct(l.marketVacancy)}</td>
      <td class="left">${badge(l.risk)}</td></tr>`).join("")}</tbody>`;
  }

  // ------------------------------------------------------------ methodology
  function renderDefs() {
    const defs = [
      ["Vacancy rate", "<code>vacant sf ÷ inventory sf</code>. Aggregates across markets are inventory-weighted."],
      ["Net absorption", "<code>occupied sf(t) − occupied sf(t−1)</code>. The net change in occupied space, i.e. demand. Shown as a trailing 4-quarter sum (4Q)."],
      ["Deliveries and under construction", "New space completed in the quarter, and space still being built at quarter end."],
      ["Months of supply", "<code>vacant sf ÷ (4Q absorption ÷ 12)</code>. How long current vacancy would take to lease at the recent pace. Not shown (n/a) when demand is negative."],
      ["Asking rent", "Average quoted rent in $/sf/yr. Office is quoted full service; industrial and retail are quoted triple net (NNN)."],
      ["Cap rate and spread", "<code>NOI ÷ price</code>. The spread over the 10-year Treasury shows the risk premium investors are paid."],
      ["Signal", "Unusual move (|z| ≥ 2.5) › Oversupply risk (pipeline > 4% of inventory and vacancy rising) › Softening or Tightening (YoY vacancy change ≥ 0.5 pp) › Stable."],
      ["WALT and mark-to-market", "WALT is remaining lease term weighted by square feet. Mark-to-market is <code>(market rent − in-place rent) × sf</code> per year."],
    ];
    $("defs").innerHTML = defs.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("");
  }

  // ------------------------------------------------------------------ chat
  const SUGGESTIONS = [
    "What's unusual this quarter?",
    "Which market has the highest industrial vacancy?",
    "Compare Dallas and Atlanta office",
    "Forecast vacancy for Miami office",
    "Where is rent growth strongest in retail?",
    "Which leases should we prioritize?",
  ];

  function addMsg(role, html, source) {
    const m = document.createElement("div");
    m.className = `msg ${role}`;
    if (role === "user") m.textContent = html;
    else m.innerHTML = html + (source ? `<span class="src">${esc(source)}</span>` : "");
    $("chat-log").appendChild(m);
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
    return m;
  }

  async function ask(q) {
    if (!q.trim()) return;
    addMsg("user", q);
    const thinking = addMsg("bot thinking", Assistant.isGemini() ? "Asking Gemini…" : "Analyzing…");
    const res = await Assistant.ask(q, { ...state });
    thinking.remove();
    addMsg("bot", res.html, res.source);
    if (res.apply) setState(res.apply);
    if (res.jump) document.getElementById(res.jump).scrollIntoView({ behavior: "smooth" });
  }

  function initChat() {
    $("chips").replaceChildren(...SUGGESTIONS.map((s) => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.textContent = s;
      c.addEventListener("click", () => ask(s));
      return c;
    }));
    $("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("chat-input").value;
      $("chat-input").value = "";
      ask(v);
    });
    addMsg("bot", "Ask about vacancy, rents, cap rates, supply, anomalies or the lease portfolio. I answer from the data and update the dashboard to match.", "");
    refreshAiMode();

    const dlg = $("ai-dialog");
    $("ai-settings").addEventListener("click", () => {
      const s = Assistant.settings();
      $("ai-key").value = s.key || "";
      $("ai-model").value = s.model || window.CRE_CONFIG.geminiModel;
      dlg.showModal();
    });
    $("ai-cancel").addEventListener("click", () => dlg.close());
    $("ai-clear").addEventListener("click", () => { Assistant.saveSettings(null); dlg.close(); refreshAiMode(); });
    $("ai-dialog-form").addEventListener("submit", () => {
      Assistant.saveSettings({ key: $("ai-key").value.trim(), model: $("ai-model").value.trim() || window.CRE_CONFIG.geminiModel });
      refreshAiMode();
    });
    $("summary-gemini").addEventListener("click", geminiSummary);
  }

  function refreshAiMode() {
    const on = Assistant.isGemini();
    $("chat-mode").textContent = on ? `Gemini (${Assistant.settings().model}), grounded in the dashboard's KPIs` : "Insight engine: grounded answers computed from the dataset";
    $("ai-settings").textContent = on ? "Gemini settings" : "Connect Gemini";
    // Hosted on Cloud Run: Gemini runs server-side, so there's no key to manage.
    $("ai-settings").hidden = Assistant.isServer();
    $("summary-gemini").hidden = !on;
  }

  // -------------------------------------------------------------- downloads
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    byline();
    await gate();
    $("app").hidden = false;
    let json;
    try {
      const res = await fetch("data/cre_sample.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      document.querySelector("main").innerHTML = `<div class="card" style="margin-top:24px"><h2>Couldn't load the data</h2><p class="muted">${esc(err.message)}. If you opened this file directly, serve the folder instead: <code>python3 -m http.server -d docs</code>.</p></div>`;
      return;
    }
    CRE.load(json);
    await Assistant.detectServer();
    initTheme();
    initFilters();
    renderDefs();
    initChat();
    Explorer.init({ onSelect: (m) => setState({ market: m }) });
    $("scenario").addEventListener("input", (e) => { state.scenario = +e.target.value; renderVacancy(false); });
    renderHero();
    renderMarket();
    renderPortfolio();
    $("dl-market").addEventListener("click", () => download("cre_market_quarterly_sample.csv", CRE.marketCsv()));
    $("dl-portfolio").addEventListener("click", () => download("portfolio_sample_scored.csv", CRE.portfolioCsv()));
    window.addEventListener("scroll", Charts.hideTooltip, { passive: true });
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-export]");
      if (!btn) return;
      btn.disabled = true;
      const c = window.CRE_CONFIG;
      const footer = `CRE Market Pulse · ${c.preparedFor ? `Project Demo for ${c.preparedFor}` : "Project Demo"}${c.author ? ` · ${c.author}` : ""} · Illustrative sample data`;
      try { await Charts.exportCard(btn.closest(".card"), `${btn.dataset.export}.png`, footer); }
      finally { btn.disabled = false; }
    });
  }

  boot();
})();
