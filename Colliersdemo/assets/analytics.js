// Data access, KPI math, forecasting, anomaly detection and portfolio scoring.
// Everything the dashboard and the assistant say is computed here first.
(function () {
  let D = null;
  const FIELDS = ["inventory_sf", "vacancy_pct", "net_absorption_sf", "deliveries_sf",
    "under_construction_sf", "asking_rent_psf", "cap_rate_pct", "sales_volume_usd"];

  // ---------------------------------------------------------------- format
  const fmt = {
    pct: (v, dp = 1) => (v == null || isNaN(v) ? "–" : `${v.toFixed(dp)}%`),
    pp: (v, dp = 1) => (v == null || isNaN(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(dp)} pp`),
    signedPct: (v, dp = 1) => (v == null || isNaN(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(dp)}%`),
    bps: (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v))} bps`,
    num(v, dp = 1) {
      const a = Math.abs(v);
      const sign = v < 0 ? "−" : "";
      if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(a >= 1e10 ? 0 : dp)}B`;
      if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e8 ? 0 : dp)}M`;
      if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e5 ? 0 : dp)}K`;
      return `${sign}${a.toFixed(0)}`;
    },
    sf: (v, dp = 1) => `${fmt.num(v, dp)} sf`,
    signedSf: (v, dp = 1) => `${v > 0 ? "+" : ""}${fmt.num(v, dp)} sf`,
    usd: (v, dp = 1) => (v < 0 ? "−$" : "$") + fmt.num(Math.abs(v), dp),
    rent: (v) => `$${v.toFixed(2)}`,
    int: (v) => Math.round(v).toLocaleString("en-US"),
    axisCompact(v) {
      if (v === 0) return "0";
      return fmt.num(v, Math.abs(v) < 1e6 && Math.abs(v) >= 1e3 ? 0 : (Number.isInteger(v / 1e6) ? 0 : 1));
    },
  };

  // ------------------------------------------------------------- data API
  function load(json) { D = json; }
  const data = () => D;
  const quarters = () => D.quarters;
  const marketName = (id) => (id === "ALL" ? "All 10 markets" : D.markets.find((m) => m.id === id).name);

  function raw(market, type) { return D.series[`${market}|${type}`]; }

  // Aggregate across markets: flows and stocks sum, rates are inventory-weighted.
  const cache = new Map();
  function series(market, type) {
    const key = `${market}|${type}`;
    if (cache.has(key)) return cache.get(key);
    let out;
    if (market !== "ALL") {
      out = raw(market, type);
    } else {
      const n = D.quarters.length;
      out = Object.fromEntries(FIELDS.map((f) => [f, new Array(n).fill(0)]));
      for (const m of D.markets) {
        const s = raw(m.id, type);
        for (let i = 0; i < n; i++) {
          const inv = s.inventory_sf[i];
          out.inventory_sf[i] += inv;
          out.net_absorption_sf[i] += s.net_absorption_sf[i];
          out.deliveries_sf[i] += s.deliveries_sf[i];
          out.under_construction_sf[i] += s.under_construction_sf[i];
          out.sales_volume_usd[i] += s.sales_volume_usd[i];
          out.vacancy_pct[i] += s.vacancy_pct[i] * inv;
          out.asking_rent_psf[i] += s.asking_rent_psf[i] * inv;
          out.cap_rate_pct[i] += s.cap_rate_pct[i] * inv;
        }
      }
      for (let i = 0; i < n; i++) {
        const inv = out.inventory_sf[i];
        out.vacancy_pct[i] /= inv;
        out.asking_rent_psf[i] /= inv;
        out.cap_rate_pct[i] /= inv;
      }
    }
    cache.set(key, out);
    return out;
  }

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => sum(a) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length - 1)); };
  const trailing = (arr, t, k = 4) => sum(arr.slice(Math.max(0, t - k + 1), t + 1));
  const rollingT4 = (arr) => arr.map((_, i) => (i < 3 ? null : trailing(arr, i)));

  // ------------------------------------------------------------------ KPIs
  function kpis(market, type, t = D.quarters.length - 1) {
    const s = series(market, type);
    const tsy = D.treasury_10y_pct;
    const vac = s.vacancy_pct[t];
    const absT4 = trailing(s.net_absorption_sf, t);
    const absPrevT4 = trailing(s.net_absorption_sf, t - 4);
    const delT4 = trailing(s.deliveries_sf, t);
    const salesT4 = trailing(s.sales_volume_usd, t);
    const salesPrevT4 = trailing(s.sales_volume_usd, t - 4);
    const vacantSf = s.inventory_sf[t] * vac / 100;
    return {
      market, type, quarter: D.quarters[t],
      vacancy: vac,
      vacancyYoY: vac - s.vacancy_pct[t - 4],
      vacancyQoQ: vac - s.vacancy_pct[t - 1],
      absorptionT4: absT4,
      absorptionPrevT4: absPrevT4,
      deliveriesT4: delT4,
      rent: s.asking_rent_psf[t],
      rentYoY: (s.asking_rent_psf[t] / s.asking_rent_psf[t - 4] - 1) * 100,
      cap: s.cap_rate_pct[t],
      capYoYbps: (s.cap_rate_pct[t] - s.cap_rate_pct[t - 4]) * 100,
      treasury: tsy[t],
      spreadBps: (s.cap_rate_pct[t] - tsy[t]) * 100,
      spreadYoYbps: ((s.cap_rate_pct[t] - tsy[t]) - (s.cap_rate_pct[t - 4] - tsy[t - 4])) * 100,
      underConstruction: s.under_construction_sf[t],
      ucPctInventory: s.under_construction_sf[t] / s.inventory_sf[t] * 100,
      inventory: s.inventory_sf[t],
      salesT4: salesT4,
      salesYoY: (salesT4 / salesPrevT4 - 1) * 100,
      monthsOfSupply: absT4 > 0 ? vacantSf / (absT4 / 12) : null,
      supplyDemandRatio: absT4 > 0 ? delT4 / absT4 : null,
    };
  }

  // ------------------------------------------------------------- forecast
  // Damped Holt linear trend. Small, transparent and good enough as a
  // baseline; the interval comes from one-step-ahead residuals.
  function forecast(values, h = 4, { alpha = 0.55, beta = 0.25, phi = 0.85 } = {}) {
    let level = values[0];
    let trend = values[1] - values[0];
    const resid = [];
    for (let i = 1; i < values.length; i++) {
      const pred = level + phi * trend;
      resid.push(values[i] - pred);
      const newLevel = alpha * values[i] + (1 - alpha) * pred;
      trend = beta * (newLevel - level) + (1 - beta) * phi * trend;
      level = newLevel;
    }
    const sigma = std(resid.slice(-16));
    const points = [];
    let damp = 0;
    for (let k = 1; k <= h; k++) {
      damp += Math.pow(phi, k);
      const v = level + damp * trend;
      const w = 1.28 * sigma * Math.sqrt(k); // ~80% interval
      points.push({ value: v, lower: v - w, upper: v + w });
    }
    return points;
  }

  function nextQuarters(last, h) {
    let y = +last.slice(0, 4), q = +last.slice(5);
    const out = [];
    for (let k = 0; k < h; k++) { q++; if (q > 4) { q = 1; y++; } out.push(`${y}Q${q}`); }
    return out;
  }

  function vacancyForecast(market, type) {
    const s = series(market, type);
    const pts = forecast(s.vacancy_pct, 4);
    return { quarters: nextQuarters(D.quarters[D.quarters.length - 1], 4), points: pts };
  }

  // ------------------------------------------------------------ anomalies
  // Flags a recent quarter whose vacancy change is > z standard deviations
  // from that market's own history of quarterly changes.
  function anomalies({ types = D.property_types, lookback = 2, z = 2.5 } = {}) {
    const out = [];
    const n = D.quarters.length;
    for (const type of types) {
      for (const m of D.markets) {
        const v = raw(m.id, type).vacancy_pct;
        const d = v.slice(1).map((x, i) => x - v[i]); // d[j] is the change into quarter j+1
        const hist = d.slice(0, n - 1 - lookback);     // history excludes the quarters under test
        const mu = mean(hist), sd = std(hist);
        for (let t = n - lookback; t < n; t++) {
          const delta = v[t] - v[t - 1];
          const score = (delta - mu) / (sd || 1);
          if (Math.abs(score) >= z) {
            out.push({ market: m.id, type, quarter: D.quarters[t], delta, z: score });
          }
        }
      }
    }
    return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }

  // -------------------------------------------------------------- signals
  function signal(k, anomaly) {
    if (anomaly) {
      return { level: "warning", label: `Unusual: ${fmt.pp(anomaly.delta)} QoQ` };
    }
    if (k.ucPctInventory > 4 && k.vacancyYoY > 0) return { level: "serious", label: "Oversupply risk" };
    if (k.vacancyYoY >= 0.5) return { level: "serious", label: "Softening" };
    if (k.vacancyYoY <= -0.5) return { level: "good", label: "Tightening" };
    return { level: "neutral", label: "Stable" };
  }

  function scorecard(type) {
    const anoms = anomalies({ types: [type] });
    return D.markets.map((m) => {
      const k = kpis(m.id, type);
      const a = anoms.find((x) => x.market === m.id);
      return { ...k, name: m.name, signal: signal(k, a), anomaly: a || null };
    });
  }

  function rankOf(type, market, metric = "vacancy", asc = true) {
    const rows = scorecard(type).slice().sort((a, b) => (asc ? a[metric] - b[metric] : b[metric] - a[metric]));
    return rows.findIndex((r) => r.market === market) + 1;
  }

  // ------------------------------------------------------------- portfolio
  function portfolio() {
    const asOf = new Date(D.meta.as_of + "T00:00:00Z");
    const leases = D.portfolio.map((l) => {
      const exp = new Date(l.expiration + "T00:00:00Z");
      const months = (exp - asOf) / (1000 * 60 * 60 * 24 * 30.4375);
      const k = kpis(l.market, l.property_type);
      const mtmPct = (l.market_rent_psf / l.in_place_rent_psf - 1) * 100;
      const mtmAnnual = (l.market_rent_psf - l.in_place_rent_psf) * l.rentable_sf;
      return { ...l, months, years: months / 12, mtmPct, mtmAnnual, marketVacancy: k.vacancy, marketVacancyYoY: k.vacancyYoY, marketName: marketName(l.market) };
    });
    const totalSf = sum(leases.map((l) => l.rentable_sf));
    const maxSf = Math.max(...leases.map((l) => l.rentable_sf));
    for (const l of leases) {
      const urgency = Math.max(0, 1 - l.months / 36);
      const size = Math.sqrt(l.rentable_sf / maxSf);
      const cost = Math.max(0, l.mtmPct) / 20;
      const tight = Math.max(0, (10 - l.marketVacancy) / 10); // tight markets give tenants less room
      l.score = urgency * (0.45 + 0.25 * size + 0.2 * Math.min(1, cost) + 0.1 * tight);
      l.risk = l.months <= 12 ? { level: "critical", label: "≤ 12 months" }
        : l.months <= 24 ? { level: "serious", label: "12–24 months" }
          : l.months <= 36 ? { level: "warning", label: "24–36 months" }
            : { level: "neutral", label: "36+ months" };
    }
    const exp24 = leases.filter((l) => l.months <= 24);
    const walt = sum(leases.map((l) => l.rentable_sf * l.years)) / totalSf;
    const byYear = {};
    for (const l of leases) {
      const y = l.expiration.slice(0, 4);
      byYear[y] = byYear[y] || { Office: 0, Industrial: 0, Retail: 0 };
      byYear[y][l.property_type] += l.rentable_sf;
    }
    return {
      leases,
      totalSf,
      walt,
      pctExpiring24: sum(exp24.map((l) => l.rentable_sf)) / totalSf * 100,
      count24: exp24.length,
      renewalExposure24: sum(exp24.map((l) => Math.max(0, l.mtmAnnual))),
      mtmTotal: sum(leases.map((l) => l.mtmAnnual)),
      annualRent: sum(leases.map((l) => l.in_place_rent_psf * l.rentable_sf)),
      byYear,
      priorities: leases.slice().sort((a, b) => b.score - a.score).slice(0, 5),
    };
  }

  function leaseAdvice(l) {
    const soft = l.marketVacancy >= 12 || l.marketVacancyYoY >= 0.5;
    const when = l.months <= 12 ? "Start now" : `Start by ${monthsFromAsOf(Math.max(0, l.months - 18))}`;
    if (l.mtmPct > 5 && !soft) {
      return `${when}. The market is tight (${fmt.pct(l.marketVacancy)} vacancy) and asking rent is ${fmt.signedPct(l.mtmPct, 0)} above the current rent. Budget about ${fmt.usd(l.mtmAnnual)}/yr more, or lock in early with a blend-and-extend.`;
    }
    if (soft) {
      return `${when}. Vacancy is ${fmt.pct(l.marketVacancy)} (${fmt.pp(l.marketVacancyYoY)} YoY), which gives the tenant leverage. Run a competitive alternatives search and push for free rent and TI.`;
    }
    return `${when}. The market is balanced and asking rent is ${fmt.signedPct(l.mtmPct, 0)} vs. the current rent. A standard renewal is likely; benchmark against 2–3 comparable properties.`;
  }

  function monthsFromAsOf(months) {
    const d = new Date(D.meta.as_of + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + Math.round(months));
    return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }

  // --------------------------------------------------------------- summary
  // Turns computed KPIs into a short narrative. Rules only, no model.
  function summary(market, type) {
    const k = kpis(market, type);
    const nat = kpis("ALL", type);
    const fc = vacancyForecast(market, type);
    const last = fc.points[fc.points.length - 1];
    const where = market === "ALL" ? `${type} across all 10 markets` : `${marketName(market)} ${type.toLowerCase()}`;
    const dir = k.vacancyYoY <= -0.3 ? "tightening" : k.vacancyYoY >= 0.3 ? "softening" : "holding steady";
    const headline = `${cap(where)} is ${dir}: vacancy is ${fmt.pct(k.vacancy)}, ${fmt.pp(k.vacancyYoY)} year over year.`;

    const bullets = [];
    const demandBeat = k.absorptionT4 > k.deliveriesT4;
    bullets.push(`Demand: ${fmt.signedSf(k.absorptionT4)} of net absorption over the last four quarters, against ${fmt.sf(k.deliveriesT4)} of new deliveries. ${demandBeat ? "Demand outpaced new supply." : "New supply outpaced demand."}`);
    bullets.push(`Rents: asking rent is ${fmt.rent(k.rent)}/sf, ${fmt.signedPct(k.rentYoY)} YoY${market !== "ALL" ? ` (the ${type.toLowerCase()} average across all 10 markets is ${fmt.signedPct(nat.rentYoY)})` : ""}.`);
    bullets.push(`Capital markets: the cap rate is ${fmt.pct(k.cap, 2)}, ${Math.round(k.spreadBps)} bps over the 10-year Treasury. The spread is ${k.spreadYoYbps >= 0 ? "wider" : "narrower"} by ${Math.abs(Math.round(k.spreadYoYbps))} bps YoY.`);
    const pipe = k.ucPctInventory > 4 ? "a heavy" : k.ucPctInventory > 1.5 ? "a moderate" : "a light";
    bullets.push(`Pipeline: ${fmt.sf(k.underConstruction)} is under construction (${fmt.pct(k.ucPctInventory)} of inventory), ${pipe} pipeline.`);
    bullets.push(`Outlook: the statistical baseline points to ${fmt.pct(last.value)} vacancy by ${fc.quarters[3].replace("Q", " Q")} (80% range ${fmt.pct(last.lower)}–${fmt.pct(last.upper)}).`);
    if (market !== "ALL") {
      bullets.push(`Rank: #${rankOf(type, market)} of 10 markets on ${type.toLowerCase()} vacancy (1 = lowest vacancy).`);
    }

    const tenantLeverage = k.vacancy > nat.vacancy + 0.5 || k.vacancyYoY > 0.5;
    const reco = [];
    reco.push(tenantLeverage
      ? "For occupiers: tenants have more leverage here. Push for concessions (free rent, TI) and keep flexibility on term."
      : "For occupiers: the market is tight. Start renewals 18–24 months ahead and consider locking in term early.");
    if (k.ucPctInventory > 4) reco.push("For investors: underwrite slower lease-up, because new supply will compete for tenants over the next 6 quarters.");
    else if (k.vacancyYoY < 0 && k.spreadBps > 250) reco.push("For investors: falling vacancy with a wide spread over Treasuries suggests an attractive entry point.");
    else if (k.vacancyYoY > 0.5) reco.push("For investors: price in further softening and focus on assets with strong tenant credit.");
    else reco.push("For investors: fundamentals are steady; returns will depend on asset selection rather than market direction.");

    return { headline, bullets, reco, kpis: k };
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------------------------------------------------------------- export
  function marketCsv() {
    const rows = [["quarter", "market", "property_type", ...FIELDS, "treasury_10y_pct"]];
    for (const [key, s] of Object.entries(D.series)) {
      const [m, t] = key.split("|");
      D.quarters.forEach((q, i) => rows.push([q, m, t, ...FIELDS.map((f) => s[f][i]), D.treasury_10y_pct[i]]));
    }
    return rows.map((r) => r.join(",")).join("\n");
  }
  function portfolioCsv() {
    const p = portfolio();
    const head = ["lease_id", "market", "property_type", "rentable_sf", "expiration", "months_remaining", "in_place_rent_psf", "market_rent_psf", "mark_to_market_pct", "mark_to_market_annual_usd", "priority_score"];
    const rows = p.leases.map((l) => [l.lease_id, l.market, l.property_type, l.rentable_sf, l.expiration, l.months.toFixed(1), l.in_place_rent_psf, l.market_rent_psf, l.mtmPct.toFixed(1), Math.round(l.mtmAnnual), l.score.toFixed(3)]);
    return [head, ...rows].map((r) => r.join(",")).join("\n");
  }

  window.CRE = {
    load, data, quarters, marketName, series, kpis, rollingT4, forecast, vacancyForecast, nextQuarters,
    anomalies, scorecard, rankOf, portfolio, leaseAdvice, summary, marketCsv, portfolioCsv, fmt,
  };
})();
