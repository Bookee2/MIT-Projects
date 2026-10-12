// "Ask the data": a small intent parser that answers from computed KPIs
// (always available, deterministic), plus optional Gemini answers grounded
// in the same KPI context.
(function () {
  const { fmt } = window.CRE;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const MARKET_ALIASES = [
    ["NYC", ["new york", "nyc", "manhattan", "ny"]],
    ["LAX", ["los angeles", "l.a.", "la", "socal"]],
    ["CHI", ["chicago", "chi"]],
    ["DFW", ["dallas", "fort worth", "dfw", "dallas-fort worth"]],
    ["ATL", ["atlanta", "atl"]],
    ["PHX", ["phoenix", "phx"]],
    ["SEA", ["seattle", "sea"]],
    ["BOS", ["boston", "bos"]],
    ["MIA", ["miami", "south florida", "mia"]],
    ["DEN", ["denver", "den"]],
    ["ALL", ["all markets", "national", "nationally", "overall", "u.s.", "us market", "across markets", "all 10"]],
  ];
  const TYPE_ALIASES = [
    ["Office", ["office", "offices"]],
    ["Industrial", ["industrial", "warehouse", "logistics", "distribution"]],
    ["Retail", ["retail", "shopping", "store"]],
  ];
  const METRICS = {
    vacancy: { words: ["vacan", "empty", "availability"], label: "vacancy", field: "vacancy", fmt: (v) => fmt.pct(v), asc: true },
    rent: { words: ["rent", "asking", "pricing", "price per"], label: "asking rent", field: "rent", fmt: (v) => `${fmt.rent(v)}/sf`, asc: false },
    rentGrowth: { words: ["rent growth", "rents grow", "rent increase", "rents rising"], label: "rent growth YoY", field: "rentYoY", fmt: (v) => fmt.signedPct(v), asc: false },
    cap: { words: ["cap rate", "cap", "yield", "valuation"], label: "cap rate", field: "cap", fmt: (v) => fmt.pct(v, 2), asc: false },
    absorption: { words: ["absorption", "demand", "leasing", "absorb"], label: "net absorption (T4Q)", field: "absorptionT4", fmt: (v) => fmt.signedSf(v), asc: false },
    supply: { words: ["construction", "pipeline", "supply", "deliver", "development", "new build"], label: "under construction (% of inventory)", field: "ucPctInventory", fmt: (v) => fmt.pct(v), asc: false },
    sales: { words: ["sales", "volume", "transaction", "investment", "deal"], label: "sales volume (T4Q)", field: "salesT4", fmt: (v) => fmt.usd(v), asc: false },
  };

  function findAll(q, aliases) {
    const hits = [];
    for (const [id, words] of aliases) {
      for (const w of words) {
        const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
        const m = q.match(re);
        if (m) { hits.push({ id, pos: m.index }); break; }
      }
    }
    return hits.sort((a, b) => a.pos - b.pos).map((h) => h.id);
  }

  function findMetric(q) {
    // Longest phrase first so "rent growth" beats "rent".
    const order = ["rentGrowth", "cap", "absorption", "supply", "sales", "vacancy", "rent"];
    return order.find((k) => METRICS[k].words.some((w) => q.includes(w))) || null;
  }

  const has = (q, ...words) => words.some((w) => q.includes(w));
  const where = (m, t) => (m === "ALL" ? `${t} (all 10 markets)` : `${CRE.marketName(m)} ${t.toLowerCase()}`);
  const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  const b = (s) => `<strong>${esc(s)}</strong>`;

  // ------------------------------------------------------------ local engine
  function answerLocal(question, state) {
    const q = question.toLowerCase().trim();
    const markets = findAll(q, MARKET_ALIASES);
    const types = findAll(q, TYPE_ALIASES);
    const type = types[0] || state.type;
    const market = markets[0] || null;
    const metricKey = findMetric(q);
    const apply = {};
    if (types[0]) apply.type = types[0];

    // Portfolio and leases
    if (/\bleases?\b/.test(q) || has(q, "portfolio", "expir", "renewal", "walt", "prioritize", "rollover")) {
      const p = CRE.portfolio();
      const top = p.priorities.slice(0, 3).map((l) =>
        `${b(`${l.lease_id} · ${l.marketName} ${l.property_type.toLowerCase()}`)}, ${fmt.sf(l.rentable_sf, 0)}, expires in ${Math.round(l.months)} months. ${esc(CRE.leaseAdvice(l))}`);
      return {
        html: `The sample portfolio has a WALT of ${b(p.walt.toFixed(1) + " years")}. ${b(fmt.pct(p.pctExpiring24, 0))} of its square footage expires within 24 months (${p.count24} leases). Renewing those leases at today's asking rents would add ${b(fmt.usd(p.renewalExposure24))} a year. Top priorities:${ul(top)}`,
        jump: "portfolio",
      };
    }

    // Anomalies
    if (has(q, "unusual", "anomal", "outlier", "surpris", "stand out", "stands out", "weird", "red flag")) {
      const list = CRE.anomalies();
      if (!list.length) return { html: "No market moved more than 2.5 standard deviations from its own history in the last two quarters." };
      const items = list.map((a) => `${b(where(a.market, a.type))}: vacancy moved ${esc(fmt.pp(a.delta))} in ${esc(a.quarter.replace("Q", " Q"))}, which is ${Math.abs(a.z).toFixed(1)}σ from its usual quarterly change.`);
      const first = list[0];
      return {
        html: `${list.length} unusual move${list.length > 1 ? "s" : ""} in the last two quarters (|z| ≥ 2.5 vs. each market's own history):${ul(items)}I've switched the dashboard to the largest one.`,
        apply: { market: first.market, type: first.type },
      };
    }

    // Forecast
    if (has(q, "forecast", "predict", "outlook", "next year", "expect", "projection", "going to")) {
      const m = market || state.market;
      const fc = CRE.vacancyForecast(m, type);
      const k = CRE.kpis(m, type);
      const rows = fc.points.map((p, i) => `${esc(fc.quarters[i].replace("Q", " Q"))}: ${b(fmt.pct(p.value))} <span class="muted">(${fmt.pct(p.lower)}–${fmt.pct(p.upper)})</span>`);
      const end = fc.points[3].value;
      return {
        html: `Vacancy forecast for ${b(where(m, type))}, currently ${fmt.pct(k.vacancy)}:${ul(rows)}The baseline is ${end < k.vacancy - 0.2 ? "trending down" : end > k.vacancy + 0.2 ? "trending up" : "roughly flat"}. Ranges are 80% intervals from a damped Holt trend model, a transparent statistical baseline rather than a market call.`,
        apply: { ...apply, market: m },
      };
    }

    // Compare two or more markets
    if (markets.length >= 2 || has(q, "compare", " vs", "versus")) {
      const ms = markets.length >= 2 ? markets : [state.market === "ALL" ? "NYC" : state.market, "ALL"];
      const metricKeys = metricKey ? [metricKey] : ["vacancy", "rent", "rentGrowth", "cap", "absorption"];
      const ks = ms.map((m) => CRE.kpis(m, type));
      const head = `<tr><th></th>${ms.map((m) => `<th>${esc(m === "ALL" ? "All markets" : CRE.marketName(m))}</th>`).join("")}</tr>`;
      const body = metricKeys.map((mk) => `<tr><td>${esc(METRICS[mk].label)}</td>${ks.map((k) => `<td>${esc(METRICS[mk].fmt(k[METRICS[mk].field]))}</td>`).join("")}</tr>`).join("");
      const vk = ks.slice().sort((a, b) => a.vacancy - b.vacancy);
      return {
        apply: { ...apply, market: ms[0] },
        html: `${esc(type)} comparison, ${esc(ks[0].quarter.replace("Q", " Q"))}:<table class="data-table" style="margin-top:6px">${head}${body}</table><p style="margin-top:6px">${b(vk[0].market === "ALL" ? "All markets" : CRE.marketName(vk[0].market))} has the lower vacancy, at ${fmt.pct(vk[0].vacancy)}.</p>`,
      };
    }

    // Rankings
    if (has(q, "highest", "lowest", "most", "least", "best", "worst", "top", "bottom", "rank", "which market", "where")) {
      const mk = metricKey || "vacancy";
      const M = METRICS[mk];
      const wantLow = has(q, "lowest", "least", "bottom", "weakest") || (has(q, "best", "tightest", "strongest") && mk === "vacancy");
      const rows = CRE.scorecard(type).slice().sort((a, b) => (wantLow ? a[M.field] - b[M.field] : b[M.field] - a[M.field]));
      const top = rows.slice(0, 3).map((r, i) => `${i + 1}. ${b(r.name)}: ${esc(M.fmt(r[M.field]))}`);
      return {
        html: `${wantLow ? "Lowest" : "Highest"} ${esc(type.toLowerCase())} ${esc(M.label)}, ${esc(rows[0].quarter.replace("Q", " Q"))}:${ul(top)}At the other end: ${b(rows[rows.length - 1].name)} (${esc(M.fmt(rows[rows.length - 1][M.field]))}). I've focused the dashboard on ${esc(rows[0].name)}.`,
        apply: { ...apply, market: rows[0].market },
      };
    }

    // Show / focus
    if (has(q, "show", "focus", "switch", "go to", "filter", "open", "view") && (market || types[0])) {
      const m = market || state.market;
      const s = CRE.summary(m, type);
      return { html: `Showing ${b(where(m, type))}. ${esc(s.headline)}`, apply: { ...apply, market: m } };
    }

    // Single metric, single market
    if (metricKey && (market || types[0])) {
      const m = market || state.market;
      const k = CRE.kpis(m, type);
      const M = METRICS[metricKey];
      const extra = {
        vacancy: `${fmt.pp(k.vacancyYoY)} YoY and ${fmt.pp(k.vacancyQoQ)} QoQ`,
        rent: `${fmt.signedPct(k.rentYoY)} YoY`,
        rentGrowth: `asking rent now ${fmt.rent(k.rent)}/sf`,
        cap: `${fmt.bps(k.capYoYbps)} YoY, ${Math.round(k.spreadBps)} bps over the 10-year Treasury`,
        absorption: `vs. ${fmt.sf(k.deliveriesT4)} delivered over the same period`,
        supply: `${fmt.sf(k.underConstruction)} under construction`,
        sales: `${fmt.signedPct(k.salesYoY)} vs. the prior four quarters`,
      }[metricKey];
      return { html: `${b(where(m, type))} ${esc(M.label)} is ${b(M.fmt(k[M.field]))} (${esc(extra)}) as of ${esc(k.quarter.replace("Q", " Q"))}.`, apply: { ...apply, market: m } };
    }

    // Summary of a place
    if (market || types[0] || has(q, "summar", "overview", "brief", "how is", "how's", "how are", "tell me")) {
      const m = market || state.market;
      const s = CRE.summary(m, type);
      return { html: `${b(s.headline)}${ul(s.bullets.map(esc))}${esc(s.reco[0])}`, apply: { ...apply, market: m } };
    }

    return {
      html: `I answer from the dashboard's dataset. Try asking about:${ul([
        "rankings: <em>Which market has the highest industrial vacancy?</em>",
        "comparisons: <em>Compare Dallas and Atlanta office</em>",
        "forecasts: <em>Forecast vacancy for Phoenix industrial</em>",
        "anomalies: <em>What's unusual this quarter?</em>",
        "the portfolio: <em>Which leases should we prioritize?</em>",
      ])}`,
    };
  }

  // ------------------------------------------------------------------ Gemini
  const KEY = "cre-pulse-gemini";
  function settings() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function saveSettings(s) {
    try {
      if (s && s.key) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch { /* storage unavailable: settings last for this page view only */ }
    memory = s && s.key ? s : null;
  }
  let memory = null;
  // When the page is served by the Cloud Run server, Gemini runs there on Vertex AI
  // and no browser key is needed. A key the viewer saved still takes priority.
  let server = null;
  async function detectServer() {
    try {
      const res = await fetch("api/status", { cache: "no-store" });
      const s = res.ok ? await res.json() : null;
      server = s && s.gemini ? s : null;
    } catch { server = null; }
    return server;
  }
  const active = () => memory || (settings().key ? settings() : null) || (server ? { server: true, model: server.model } : null);

  function context(state) {
    const k = CRE.kpis(state.market, state.type);
    const r = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
    const sc = CRE.scorecard(state.type).map((x) => ({
      market: x.name, vacancy_pct: r(x.vacancy), vacancy_yoy_pp: r(x.vacancyYoY), net_absorption_t4q_sf: Math.round(x.absorptionT4),
      asking_rent_psf: r(x.rent), rent_yoy_pct: r(x.rentYoY), cap_rate_pct: r(x.cap), under_construction_pct_inventory: r(x.ucPctInventory), signal: x.signal.label,
    }));
    const nat = Object.fromEntries(CRE.data().property_types.map((t) => {
      const n = CRE.kpis("ALL", t);
      return [t, { vacancy_pct: r(n.vacancy), vacancy_yoy_pp: r(n.vacancyYoY), rent_yoy_pct: r(n.rentYoY), cap_rate_pct: r(n.cap), spread_bps: Math.round(n.spreadBps) }];
    }));
    const s = CRE.series(state.market, state.type);
    const qs = CRE.quarters();
    const last8 = qs.slice(-8).map((q, i) => {
      const t = qs.length - 8 + i;
      return { quarter: q, vacancy_pct: r(s.vacancy_pct[t]), net_absorption_sf: Math.round(s.net_absorption_sf[t]), asking_rent_psf: r(s.asking_rent_psf[t]) };
    });
    const fc = CRE.vacancyForecast(state.market, state.type);
    const p = CRE.portfolio();
    return {
      note: "Synthetic sample data for a demo. Not real market statistics.",
      as_of_quarter: k.quarter,
      treasury_10y_pct: r(k.treasury),
      selection: { market: CRE.marketName(state.market), property_type: state.type },
      selection_kpis: { vacancy_pct: r(k.vacancy), vacancy_yoy_pp: r(k.vacancyYoY), net_absorption_t4q_sf: Math.round(k.absorptionT4), deliveries_t4q_sf: Math.round(k.deliveriesT4), asking_rent_psf: r(k.rent), rent_yoy_pct: r(k.rentYoY), cap_rate_pct: r(k.cap), spread_to_10y_bps: Math.round(k.spreadBps), under_construction_sf: Math.round(k.underConstruction), sales_volume_t4q_usd: Math.round(k.salesT4) },
      selection_last_8_quarters: last8,
      selection_vacancy_forecast: fc.quarters.map((q, i) => ({ quarter: q, vacancy_pct: r(fc.points[i].value), low_80: r(fc.points[i].lower), high_80: r(fc.points[i].upper) })),
      market_scorecard_for_type: sc,
      all_markets_by_type: nat,
      recent_anomalies: CRE.anomalies().map((a) => ({ market: CRE.marketName(a.market), type: a.type, quarter: a.quarter, vacancy_change_pp: r(a.delta), z: r(a.z, 1) })),
      portfolio: {
        walt_years: r(p.walt, 1), pct_sf_expiring_24m: r(p.pctExpiring24, 1), renewal_cost_increase_24m_usd: Math.round(p.renewalExposure24),
        top_priorities: p.priorities.map((l) => ({ lease: l.lease_id, market: l.marketName, type: l.property_type, sf: l.rentable_sf, months_left: Math.round(l.months), mark_to_market_pct: r(l.mtmPct, 1) })),
      },
    };
  }

  const SYSTEM = [
    "You are a commercial real estate research analyst assistant inside a market dashboard.",
    "Answer ONLY from the JSON context provided. Never invent numbers. If the context cannot answer the question, say so in one sentence and name the data that would be needed.",
    "The data is synthetic sample data; do not present it as real market data.",
    "Be concise: at most 120 words. Lead with the answer, cite the numbers with units, and use short bullet points for lists.",
    "Define CRE terms briefly when helpful (absorption, cap rate, WALT).",
  ].join(" ");

  async function callServer(prompt, state) {
    let pass = "";
    try { pass = sessionStorage.getItem("cre-pulse-passcode") || ""; } catch { /* storage blocked */ }
    const res = await fetch("api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Passcode": pass },
      body: JSON.stringify({ prompt, context: context(state) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return { html: mdLite(body.text), model: `${body.model} on Vertex AI` };
  }

  async function callGemini(prompt, state) {
    const cfg = active();
    if (cfg.server) return callServer(prompt, state);
    const model = (cfg.model || window.CRE_CONFIG.geminiModel || "").trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `Context JSON:\n${JSON.stringify(context(state))}\n\nRequest: ${prompt}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    const text = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) throw new Error("Empty response");
    return { html: mdLite(text), model };
  }

  // Minimal, safe Markdown: escape first, then bold and bullet lists.
  function mdLite(text) {
    const lines = esc(text).split(/\n+/);
    let html = "", inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; }
      else { if (inList) { html += "</ul>"; inList = false; } html += `<p>${line}</p>`; }
    }
    return html + (inList ? "</ul>" : "");
  }

  async function ask(question, state) {
    const local = answerLocal(question, state);
    const cfg = active();
    if (!cfg) return { ...local, source: "Insight engine · computed from the dataset" };
    // Apply the local engine's filter changes first, so Gemini sees the same selection.
    const next = { ...state, ...(local.apply || {}) };
    try {
      const g = await callGemini(question, next);
      return { html: g.html, apply: local.apply, jump: local.jump, source: `Gemini (${g.model}) · grounded in the dashboard's KPI context` };
    } catch (err) {
      return { ...local, source: `Insight engine · Gemini unavailable (${esc(err.message).slice(0, 120)})` };
    }
  }

  async function geminiSummary(state) {
    return callGemini("Write an executive summary of the current selection for a client meeting: one bold headline sentence, 3-4 bullets (demand, rents, capital markets, outlook) and one recommendation line for occupiers and one for investors.", state);
  }

  window.Assistant = { ask, geminiSummary, settings: () => active() || {}, saveSettings, isGemini: () => !!active(), isServer: () => !!(active() || {}).server, detectServer, esc };
})();
