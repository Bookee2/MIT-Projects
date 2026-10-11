// Market explorer: a tile map of the 10 markets colored by vacancy and a
// vacancy-vs-rent-growth bubble chart, both driven by one quarter slider
// with a play button. Marks move and recolor in place so the time-lapse
// animates instead of redrawing.
(function () {
  const { fmt } = window.CRE;
  const $ = (id) => document.getElementById(id);
  const { el, showTooltip, hideTooltip, niceScale, resolve } = window.Charts;

  // Rough geographic layout on a 6 x 4 grid (col, row).
  const GRID = { SEA: [0, 0], BOS: [5, 0], DEN: [1, 1], CHI: [3, 1], NYC: [4, 1],
    LAX: [0, 2], PHX: [1, 2], ATL: [3, 2], DFW: [2, 3], MIA: [4, 3] };
  // Sequential blue ramp, light to dark.
  const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];

  let ctx = { type: null, market: "ALL", t: 0, onSelect: () => {} };
  let timer = null;
  const map = { tiles: new Map() };
  const bub = { dots: new Map() };

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function rampColor(f) {
    const x = Math.max(0, Math.min(1, f)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x));
    const a = hex(RAMP[i]), b = hex(RAMP[i + 1]), k = x - i;
    const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
    return { css: `rgb(${c.join(",")})`, light: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55 };
  }

  const first = () => 4; // first quarter with a year-over-year comparison
  const last = () => CRE.quarters().length - 1;
  const qLabel = (i) => CRE.quarters()[i].replace("Q", " Q");

  function point(m, t) {
    const s = CRE.series(m, ctx.type);
    return {
      vacancy: s.vacancy_pct[t],
      vacYoY: s.vacancy_pct[t] - s.vacancy_pct[t - 4],
      rentYoY: (s.asking_rent_psf[t] / s.asking_rent_psf[t - 4] - 1) * 100,
      inventory: s.inventory_sf[t],
    };
  }

  function domains() {
    const vs = [], rs = [], inv = [];
    for (const m of CRE.data().markets) {
      for (let t = first(); t <= last(); t++) {
        const p = point(m.id, t);
        vs.push(p.vacancy); rs.push(p.rentYoY); inv.push(p.inventory);
      }
    }
    return { vMin: Math.min(...vs), vMax: Math.max(...vs), rMin: Math.min(...rs), rMax: Math.max(...rs), invMax: Math.max(...inv) };
  }

  function tooltipFor(evt, m) {
    const p = point(m, ctx.t);
    showTooltip(evt, `${CRE.marketName(m)} · ${qLabel(ctx.t)}`, [
      { name: "Vacancy", value: fmt.pct(p.vacancy), color: "transparent" },
      { name: "Change YoY", value: fmt.pp(p.vacYoY), color: "transparent" },
      { name: "Rent growth YoY", value: fmt.signedPct(p.rentYoY), color: "transparent" },
      { name: "Inventory", value: fmt.sf(p.inventory), color: "transparent" },
    ]);
  }

  function interactive(node, m) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Focus the dashboard on ${CRE.marketName(m)}`);
    node.addEventListener("pointermove", (e) => tooltipFor(e, m));
    node.addEventListener("pointerleave", hideTooltip);
    node.addEventListener("focus", () => { const b = node.getBoundingClientRect(); tooltipFor({ clientX: b.right, clientY: b.top }, m); });
    node.addEventListener("blur", hideTooltip);
    node.addEventListener("click", () => ctx.onSelect(m));
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.onSelect(m); } });
  }

  // ------------------------------------------------------------------ map
  function buildMap() {
    const box = $("ex-map");
    const W = box.clientWidth;
    if (W < 120) return false;
    const gap = 6, pad = 4;
    // Tiles size to the width, capped so the map is ~300px tall on desktop.
    const s = Math.floor(Math.min((W - 2 * pad - gap * 5) / 6, (300 - 2 * pad - gap * 3) / 4));
    const H = s * 4 + gap * 3 + 2 * pad;
    box.style.height = `${H}px`;
    const ox = (W - (s * 6 + gap * 5)) / 2;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Tile map of vacancy by market", class: s < 64 ? "small-tiles" : "" });
    map.tiles.clear();
    for (const m of CRE.data().markets) {
      const [c, r] = GRID[m.id];
      const g = el("g", { class: "tile", transform: `translate(${ox + c * (s + gap)},${pad + r * (s + gap)})` });
      const rect = el("rect", { width: s, height: s, rx: 4, class: "tile-fill" });
      const ring = el("rect", { x: -3, y: -3, width: s + 6, height: s + 6, rx: 6, fill: "none", "stroke-width": 2, class: "tile-ring" });
      const inset = s < 64 ? 5 : 9;
      const code = el("text", { x: inset, y: s < 64 ? 14 : 18, class: "tile-code" });
      code.textContent = m.id;
      const val = el("text", { x: inset, y: s - (s < 64 ? 7 : 11), class: "tile-val" });
      g.append(rect, ring, code, val);
      interactive(g, m.id);
      svg.appendChild(g);
      map.tiles.set(m.id, { rect, ring, code, val });
    }
    box.replaceChildren(svg);
    return true;
  }

  function updateMap() {
    const d = ctx.dom;
    for (const [m, t] of map.tiles) {
      const p = point(m, ctx.t);
      const c = rampColor((p.vacancy - d.vMin) / (d.vMax - d.vMin));
      t.rect.style.fill = c.css;
      const ink = c.light ? "#0f1a3d" : "#ffffff";
      t.code.style.fill = ink;
      t.val.style.fill = ink;
      t.val.textContent = fmt.pct(p.vacancy);
      t.ring.style.stroke = ctx.market === m ? "var(--text-primary)" : "transparent";
    }
  }

  function buildRamp() {
    const d = ctx.dom;
    const stops = RAMP.map((c, i) => `${c} ${(i / (RAMP.length - 1) * 100).toFixed(1)}%`).join(",");
    $("ex-ramp").innerHTML = `<span>${fmt.pct(d.vMin)}</span><i style="background:linear-gradient(90deg,${stops})"></i><span>${fmt.pct(d.vMax)}</span>`;
  }

  // --------------------------------------------------------------- bubble
  function buildBubble() {
    const box = $("ex-bubble");
    const W = box.clientWidth, H = box.clientHeight;
    if (W < 120) return false;
    const m = { t: 10, r: 16, b: 34, l: 46 };
    const d = ctx.dom;
    const xs = niceScale(d.vMin, d.vMax, 5);
    const ys = niceScale(d.rMin, d.rMax, 5);
    const x = (v) => m.l + (v - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - ys.lo) / (ys.hi - ys.lo)) * (H - m.t - m.b);
    Object.assign(bub, { x, y, m, W, H });
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Vacancy versus rent growth by market" });
    for (const tv of ys.ticks) {
      svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: Math.round(y(tv)) + 0.5, y2: Math.round(y(tv)) + 0.5, class: tv === 0 ? "baseline" : "gridline" }));
      const t = el("text", { x: m.l - 8, y: y(tv) + 4, "text-anchor": "end", class: "axis-text" });
      t.textContent = `${+tv.toFixed(1)}%`;
      svg.appendChild(t);
    }
    for (const tv of xs.ticks) {
      const t = el("text", { x: x(tv), y: H - 18, "text-anchor": "middle", class: "axis-text" });
      t.textContent = `${+tv.toFixed(1)}%`;
      svg.appendChild(t);
    }
    const xt = el("text", { x: W - m.r, y: H - 3, "text-anchor": "end", class: "axis-title" });
    xt.textContent = "Vacancy rate →";
    const yt = el("text", { x: m.l + 4, y: m.t + 12, class: "axis-title" });
    yt.textContent = "↑ Rent growth YoY";
    const q1 = el("text", { x: m.l + 4, y: m.t + 28, class: "quadrant" });
    q1.textContent = "Landlord-favorable";
    const q2 = el("text", { x: W - m.r - 4, y: H - m.b - 8, "text-anchor": "end", class: "quadrant" });
    q2.textContent = "Tenant-favorable";
    svg.append(xt, yt, q1, q2);

    bub.vline = el("line", { y1: m.t, y2: H - m.b, class: "avg-line" });
    bub.hline = el("line", { x1: m.l, x2: W - m.r, class: "avg-line" });
    bub.trail = el("path", { fill: "none", "stroke-width": 1.5, "stroke-linejoin": "round", class: "trail" });
    svg.append(bub.vline, bub.hline, bub.trail);

    bub.dots.clear();
    const order = CRE.data().markets.slice().sort((a, b) => point(b.id, last()).inventory - point(a.id, last()).inventory);
    for (const mk of order) { // biggest first so small bubbles sit on top
      const g = el("g", { class: "bub" });
      const c = el("circle", { r: 6, "stroke-width": 2, class: "bub-dot" });
      const label = el("text", { class: "bub-label", y: 4 });
      label.textContent = mk.id;
      g.append(c, label);
      interactive(g, mk.id);
      svg.appendChild(g);
      bub.dots.set(mk.id, { g, c, label });
    }
    $("ex-bubble").replaceChildren(svg);
    return true;
  }

  function updateBubble() {
    const { x, y } = bub;
    const d = ctx.dom;
    const all = point("ALL", ctx.t);
    bub.vline.setAttribute("x1", x(all.vacancy)); bub.vline.setAttribute("x2", x(all.vacancy));
    bub.hline.setAttribute("y1", y(all.rentYoY)); bub.hline.setAttribute("y2", y(all.rentYoY));
    for (const [m, o] of bub.dots) {
      const p = point(m, ctx.t);
      const r = 5 + 13 * Math.sqrt(p.inventory / d.invMax);
      const sel = ctx.market === m;
      o.g.style.transform = `translate(${x(p.vacancy)}px, ${y(p.rentYoY)}px)`;
      o.c.setAttribute("r", r.toFixed(1));
      o.c.style.fill = resolve(sel ? "--series-2" : "--series-1");
      o.c.style.fillOpacity = sel ? 1 : 0.72;
      o.label.setAttribute("x", (r + 4).toFixed(1));
      o.label.classList.toggle("sel", sel);
      if (sel) o.g.parentNode.appendChild(o.g); // draw the selected market on top
    }
    placeLabels();
    if (ctx.market !== "ALL") {
      const pts = [];
      for (let t = first(); t <= ctx.t; t++) { const p = point(ctx.market, t); pts.push(`${x(p.vacancy)},${y(p.rentYoY)}`); }
      bub.trail.setAttribute("d", pts.length > 1 ? "M" + pts.join("L") : "");
      bub.trail.style.stroke = resolve("--series-2");
    } else {
      bub.trail.setAttribute("d", "");
    }
  }

  // Show a market code only where it doesn't collide with one already
  // placed. The selected market is placed first, then larger markets.
  function placeLabels() {
    const boxes = [];
    const order = [...bub.dots.keys()].sort((a, b) => (b === ctx.market) - (a === ctx.market) || point(b, ctx.t).inventory - point(a, ctx.t).inventory);
    for (const m of order) {
      const o = bub.dots.get(m);
      const p = point(m, ctx.t);
      const r = +o.c.getAttribute("r");
      const bx = bub.x(p.vacancy) + r + 4, by = bub.y(p.rentYoY) - 6;
      const box = { x0: bx, x1: bx + m.length * 7.5, y0: by, y1: by + 12 };
      const hit = boxes.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0) || box.x1 > bub.W;
      o.label.style.opacity = hit ? 0 : 1;
      if (!hit) boxes.push(box);
    }
  }

  // ------------------------------------------------------------- controls
  function update() {
    $("ex-slider").value = ctx.t;
    $("ex-quarter").textContent = qLabel(ctx.t);
    updateMap();
    updateBubble();
  }

  function setT(t) { ctx.t = Math.max(first(), Math.min(last(), t)); update(); }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    $("ex-play").classList.remove("playing");
    $("ex-play").setAttribute("aria-label", "Play the time-lapse");
  }
  function play() {
    if (ctx.t >= last()) setT(first());
    $("ex-play").classList.add("playing");
    $("ex-play").setAttribute("aria-label", "Pause the time-lapse");
    timer = setInterval(() => { if (ctx.t >= last()) stop(); else setT(ctx.t + 1); }, 420);
  }

  function rebuild() {
    ctx.dom = domains();
    if (buildMap() && buildBubble()) {
      buildRamp();
      update();
      // Turn on movement only after the first placement, so bubbles don't fly in from the corner.
      const svg = $("ex-bubble").firstChild;
      requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add("ready")));
    }
  }

  function init({ onSelect }) {
    ctx.onSelect = onSelect;
    ctx.t = last();
    const sl = $("ex-slider");
    sl.min = first(); sl.max = last(); sl.value = last();
    sl.addEventListener("input", () => { stop(); setT(+sl.value); });
    $("ex-play").addEventListener("click", () => (timer ? stop() : play()));
    let w = 0;
    new ResizeObserver(() => {
      const nw = $("ex-map").clientWidth + $("ex-bubble").clientWidth;
      if (Math.abs(nw - w) > 2 && ctx.type) { w = nw; rebuild(); }
    }).observe($("explorer"));
  }

  function render({ type, market }) {
    const typeChanged = type !== ctx.type;
    ctx.type = type;
    ctx.market = market;
    $("ex-sub").textContent = `${type}. Press play to watch the markets move from ${qLabel(first())} to ${qLabel(last())}. Click a market to focus the dashboard on it.`;
    if (typeChanged || !map.tiles.size) rebuild(); else update();
  }

  // Re-resolve colors after a theme switch.
  function refresh() { if (ctx.type) rebuild(); }

  window.Explorer = { init, render, refresh, stop };
})();
