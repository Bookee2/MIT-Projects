// Small SVG chart kit: line (with crosshair + forecast band), columns
// (grouped or stacked, negative-aware) and sparklines. No dependencies.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const tooltip = () => document.getElementById("tooltip");

  function el(name, attrs = {}, style = {}) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    Object.assign(node.style, style);
    return node;
  }

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function niceScale(min, max, count = 5, { zero = false } = {}) {
    if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
    if (min === max) { min -= 1; max += 1; }
    const step = niceStep(max - min, count);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
    return { lo, hi, ticks };
  }

  function showTooltip(evt, title, rows) {
    const tt = tooltip();
    tt.replaceChildren();
    const t = document.createElement("div");
    t.className = "tt-title";
    t.textContent = title;
    tt.appendChild(t);
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "tt-row";
      const key = document.createElement("span");
      key.className = "tt-key";
      const i = document.createElement("i");
      i.style.borderColor = r.color;
      if (r.dashed) i.className = "dashed";
      key.append(i, document.createTextNode(r.name));
      const val = document.createElement("span");
      val.className = "tt-val";
      val.textContent = r.value;
      row.append(val, key);
      row.style.flexDirection = "row-reverse";
      tt.appendChild(row);
    }
    tt.hidden = false;
    const pad = 14;
    const box = tt.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY - box.height - pad;
    if (x + box.width > window.innerWidth - 8) x = evt.clientX - box.width - pad;
    if (y < 8) y = evt.clientY + pad;
    tt.style.left = Math.max(8, x) + "px";
    tt.style.top = y + "px";
  }
  function hideTooltip() { tooltip().hidden = true; }

  function resolve(color) {
    // Accept "--series-1" style tokens or literal colors.
    if (color && color.startsWith("--")) {
      return getComputedStyle(document.documentElement).getPropertyValue(color).trim() || "#888";
    }
    return color;
  }

  function observe(container, render) {
    container.__render = render;
    render();
    if (!container.__ro) {
      let w = container.clientWidth;
      container.__ro = new ResizeObserver(() => {
        if (Math.abs(container.clientWidth - w) > 2) { w = container.clientWidth; container.__render(); }
      });
      container.__ro.observe(container);
    }
  }

  function xTickIndices(labels, width) {
    // Prefer Q1 positions labeled with the year when labels look like 2024Q1.
    const quarterly = labels.every((l) => /^\d{4}Q[1-4]$/.test(l));
    if (quarterly) {
      const q1 = labels.map((l, i) => (l.endsWith("Q1") ? i : -1)).filter((i) => i >= 0);
      const maxTicks = Math.max(2, Math.floor(width / 56));
      const every = Math.ceil(q1.length / maxTicks);
      return { idx: q1.filter((_, k) => k % every === 0), fmt: (l) => l.slice(0, 4) };
    }
    const maxTicks = Math.max(2, Math.floor(width / 64));
    const every = Math.ceil(labels.length / maxTicks);
    return { idx: labels.map((_, i) => i).filter((i) => i % every === 0), fmt: (l) => l };
  }

  // ---------------------------------------------------------------- line
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function line(container, opts) {
    container.__animate = !!opts.animate && !reducedMotion();
    observe(container, () => renderLine(container, opts));
  }

  function renderLine(container, o) {
    const W = container.clientWidth;
    if (W < 120) return; // not laid out yet; the ResizeObserver renders once it has a width
    const H = container.clientHeight || 280;
    const labels = o.labels;
    const n = labels.length;
    const yFmt = o.yFormat || ((v) => String(v));
    const endLabeled = o.series.filter((s) => s.endLabel);
    const m = { t: 12, r: endLabeled.length ? 64 : 12, b: 26, l: 44 };

    const vals = [];
    for (const s of o.series) for (const v of s.values) if (v != null) vals.push(v);
    if (o.band) for (const v of [...o.band.lower, ...o.band.upper]) if (v != null) vals.push(v);
    const sc = niceScale(Math.min(...vals), Math.max(...vals), 5, { zero: !!o.zero });
    const x = (i) => m.l + (n === 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
    const y = (v) => m.t + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - m.t - m.b);

    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.ariaLabel || "" });

    if (o.shadeFrom != null) {
      svg.appendChild(el("rect", { x: x(o.shadeFrom), y: m.t, width: x(n - 1) - x(o.shadeFrom), height: H - m.t - m.b }, { fill: "var(--surface-2)" }));
      const t = el("text", { x: x(o.shadeFrom) + 6, y: m.t + 12, class: "axis-text" });
      t.textContent = o.shadeLabel || "Forecast";
      svg.appendChild(t);
    }

    for (const tv of sc.ticks) {
      svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: Math.round(y(tv)) + 0.5, y2: Math.round(y(tv)) + 0.5, class: tv === 0 && sc.lo < 0 ? "baseline" : "gridline" }));
      const t = el("text", { x: m.l - 8, y: y(tv) + 4, "text-anchor": "end", class: "axis-text" });
      t.textContent = yFmt(tv, true);
      svg.appendChild(t);
    }
    const xt = xTickIndices(labels, W - m.l - m.r);
    for (const i of xt.idx) {
      const t = el("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "axis-text" });
      t.textContent = xt.fmt(labels[i]);
      svg.appendChild(t);
    }

    if (o.band) {
      let d = "";
      const pts = [];
      for (let i = 0; i < n; i++) if (o.band.upper[i] != null) pts.push(i);
      if (pts.length) {
        d = pts.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(o.band.upper[i])}`).join("");
        d += pts.slice().reverse().map((i) => `L${x(i)},${y(o.band.lower[i])}`).join("") + "Z";
        svg.appendChild(el("path", { d, class: "anim-fade" }, { fill: resolve(o.band.color), opacity: 0.14 }));
      }
    }

    for (const s of o.series) {
      const c = resolve(s.color);
      let d = "";
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(i)},${y(v)}`;
        pen = true;
      });
      svg.appendChild(el("path", { d, fill: "none", "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dashed ? "5 4" : "", class: s.dashed ? "anim-fade" : "anim-draw" }, { stroke: c }));
    }

    // Callouts: a ring on the point and a short label above it.
    for (const a of o.annotations || []) {
      const v = o.series[0].values[a.index];
      if (v == null) continue;
      const cx = x(a.index), cy = y(v);
      const g = el("g", { class: "anim-fade annotation" });
      g.appendChild(el("circle", { cx, cy, r: 7, fill: "none", "stroke-width": 1.5 }, { stroke: "var(--text-primary)" }));
      const above = cy - 34 > m.t;
      const ty = above ? cy - 22 : cy + 30;
      g.appendChild(el("line", { x1: cx, x2: cx, y1: above ? cy - 8 : cy + 8, y2: above ? ty + 4 : ty - 12, "stroke-width": 1 }, { stroke: "var(--text-primary)" }));
      const w = a.text.length * 6.4 + 14;
      const lx = Math.max(m.l, Math.min(W - m.r - w, cx - w / 2));
      g.appendChild(el("rect", { x: lx, y: ty - 13, width: w, height: 19, rx: 3 }, { fill: "var(--text-primary)" }));
      const t = el("text", { x: lx + w / 2, y: ty + 1, "text-anchor": "middle", class: "annotation-text" });
      t.textContent = a.text;
      g.appendChild(t);
      svg.appendChild(g);
    }

    // End markers and selective end labels.
    const placed = [];
    for (const s of o.series) {
      if (!s.endLabel) continue;
      let li = -1;
      for (let i = n - 1; i >= 0; i--) if (s.values[i] != null) { li = i; break; }
      if (li < 0) continue;
      const c = resolve(s.color);
      svg.appendChild(el("circle", { cx: x(li), cy: y(s.values[li]), r: 4, "stroke-width": 2 }, { fill: c, stroke: "var(--surface-1)" }));
      let ly = y(s.values[li]) + 4;
      if (placed.some((p) => Math.abs(p - ly) < 14)) continue; // converging: legend + tooltip carry it
      placed.push(ly);
      const t = el("text", { x: x(li) + 9, y: ly, class: "end-label" });
      t.textContent = yFmt(s.values[li]);
      svg.appendChild(t);
    }

    // Crosshair layer.
    const cross = el("line", { y1: m.t, y2: H - m.b, class: "crosshair", visibility: "hidden" });
    svg.appendChild(cross);
    const dots = o.series.map((s) => {
      const d = el("circle", { r: 4, "stroke-width": 2, visibility: "hidden" }, { fill: resolve(s.color), stroke: "var(--surface-1)" });
      svg.appendChild(d);
      return d;
    });
    const hit = el("rect", { x: m.l - 6, y: 0, width: W - m.l - m.r + 12, height: H, fill: "transparent", tabindex: 0, "aria-label": "Chart values. Use arrow keys to step through quarters." });
    svg.appendChild(hit);
    let cur = n - 1;
    const show = (i, evt) => {
      cur = i;
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      const rows = [];
      o.series.forEach((s, k) => {
        const v = s.values[i];
        if (v == null) { dots[k].setAttribute("visibility", "hidden"); return; }
        dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(v));
        dots[k].setAttribute("visibility", "visible");
        rows.push({ name: s.name, value: yFmt(v), color: resolve(s.color), dashed: s.dashed });
      });
      if (o.band && o.band.upper[i] != null) {
        rows.push({ name: o.band.name || "Range", value: `${yFmt(o.band.lower[i])} – ${yFmt(o.band.upper[i])}`, color: resolve(o.band.color) });
      }
      const box = svg.getBoundingClientRect();
      const e = evt || { clientX: box.left + x(i), clientY: box.top + y(o.series[0].values[i] ?? sc.lo) };
      showTooltip(e, o.tooltipTitle ? o.tooltipTitle(labels[i]) : labels[i], rows);
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      dots.forEach((d) => d.setAttribute("visibility", "hidden"));
      hideTooltip();
    };
    hit.addEventListener("pointermove", (evt) => {
      const box = svg.getBoundingClientRect();
      const px = evt.clientX - box.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
      show(i, evt);
    });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    hit.addEventListener("focus", () => show(cur));
    hit.addEventListener("keydown", (evt) => {
      if (evt.key === "ArrowLeft") { show(Math.max(0, cur - 1)); evt.preventDefault(); }
      if (evt.key === "ArrowRight") { show(Math.min(n - 1, cur + 1)); evt.preventDefault(); }
      if (evt.key === "Escape") hide();
    });

    container.replaceChildren(svg);
    if (container.__animate) {
      container.__animate = false;
      svg.querySelectorAll(".anim-draw").forEach((p) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len} ${len}`;
        p.style.strokeDashoffset = len;
        p.getBoundingClientRect();
        p.style.transition = "stroke-dashoffset 900ms cubic-bezier(.3,.7,.2,1)";
        p.style.strokeDashoffset = 0;
        p.addEventListener("transitionend", () => { p.style.strokeDasharray = ""; }, { once: true });
      });
      svg.classList.add("fade-late");
    }
  }

  // ------------------------------------------------------------- columns
  function columns(container, opts) {
    container.__animate = !!opts.animate && !reducedMotion();
    observe(container, () => renderColumns(container, opts));
  }

  function roundedBar(x, y0, y1, w, r, roundEnd) {
    // y0 = baseline side, y1 = data end. Rounds only the data end.
    const top = Math.min(y0, y1);
    const h = Math.abs(y1 - y0);
    if (!roundEnd || h < 1) return `M${x},${top}h${w}v${Math.max(h, 0.5)}h${-w}Z`;
    r = Math.min(r, h, w / 2);
    if (y1 < y0) { // grows upward
      return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    }
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  function renderColumns(container, o) {
    const W = container.clientWidth;
    if (W < 120) return; // not laid out yet; the ResizeObserver renders once it has a width
    const H = container.clientHeight || 260;
    const labels = o.labels;
    const n = labels.length;
    const yFmt = o.yFormat || ((v) => String(v));
    const m = { t: 14, r: 8, b: 26, l: 48 };
    const S = o.series.length;

    let lo = 0, hi = 0;
    for (let i = 0; i < n; i++) {
      if (o.stacked) {
        let pos = 0, neg = 0;
        for (const s of o.series) { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; }
        hi = Math.max(hi, pos); lo = Math.min(lo, neg);
      } else {
        for (const s of o.series) { const v = s.values[i] || 0; hi = Math.max(hi, v); lo = Math.min(lo, v); }
      }
    }
    const sc = niceScale(lo, hi, 5, { zero: true });
    const y = (v) => m.t + (1 - (v - sc.lo) / (sc.hi - sc.lo)) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / n;
    const groupW = o.stacked ? Math.min(24, band * 0.6) : Math.min(24 * S + 2 * (S - 1), band * 0.72);
    const barW = o.stacked ? groupW : Math.max(2, (groupW - 2 * (S - 1)) / S);
    const bx = (i) => m.l + band * i + (band - groupW) / 2;

    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": o.ariaLabel || "" });
    for (const tv of sc.ticks) {
      svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: Math.round(y(tv)) + 0.5, y2: Math.round(y(tv)) + 0.5, class: tv === 0 ? "baseline" : "gridline" }));
      const t = el("text", { x: m.l - 8, y: y(tv) + 4, "text-anchor": "end", class: "axis-text" });
      t.textContent = yFmt(tv, true);
      svg.appendChild(t);
    }
    const quarterly = labels.every((l) => /^\d{4}Q[1-4]$/.test(l));
    const every = Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / (quarterly ? 52 : 44))));
    labels.forEach((l, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      if (i === n - 1 && i % every !== 0 && (n - 1) % every < every / 2) return;
      const t = el("text", { x: m.l + band * i + band / 2, y: H - 8, "text-anchor": "middle", class: "axis-text" });
      t.textContent = quarterly ? `${l.slice(5)} '${l.slice(2, 4)}` : l;
      svg.appendChild(t);
    });

    const groups = [];
    for (let i = 0; i < n; i++) {
      const g = el("g");
      if (o.stacked) {
        let pos = 0, neg = 0;
        const segs = o.series.map((s) => s.values[i] || 0);
        const lastPos = segs.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0).pop();
        const lastNeg = segs.map((v, k) => (v < 0 ? k : -1)).filter((k) => k >= 0).pop();
        o.series.forEach((s, k) => {
          const v = segs[k];
          if (!v) return;
          const base = v >= 0 ? pos : neg;
          const end = base + v;
          if (v >= 0) pos = end; else neg = end;
          const gapTop = v >= 0 ? (base === 0 ? 0 : 1) : 0;
          let y0 = y(base) - (v >= 0 ? gapTop : -gapTop);
          let y1 = y(end) + (v >= 0 && k !== lastPos ? 1 : 0);
          if (Math.abs(y1 - y0) < 0.5) y1 = y0 - 0.5;
          g.appendChild(el("path", { d: roundedBar(bx(i), y0, y1, barW, 4, k === (v >= 0 ? lastPos : lastNeg)), class: "bar" }, { fill: resolve(s.color), transformOrigin: v >= 0 ? "50% 100%" : "50% 0%", animationDelay: `${i * 18}ms` }));
        });
      } else {
        o.series.forEach((s, k) => {
          const v = s.values[i];
          if (v == null) return;
          g.appendChild(el("path", { d: roundedBar(bx(i) + k * (barW + 2), y(0), y(v), barW, 4, true), class: "bar" }, { fill: resolve(s.color), transformOrigin: v >= 0 ? "50% 100%" : "50% 0%", animationDelay: `${i * 18}ms` }));
        });
      }
      svg.appendChild(g);
      groups.push(g);
    }

    // One hit band per category, wider than the marks.
    labels.forEach((l, i) => {
      const hit = el("rect", { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: "transparent", tabindex: i === n - 1 ? 0 : -1 });
      const rows = () => {
        const r = o.series.map((s) => ({ name: s.name, value: s.values[i] == null ? "–" : yFmt(s.values[i]), color: resolve(s.color) }));
        if (o.stacked && o.totalLabel) {
          const tot = o.series.reduce((a, s) => a + (s.values[i] || 0), 0);
          r.push({ name: o.totalLabel, value: yFmt(tot), color: "transparent" });
        }
        return r;
      };
      const on = (evt) => {
        groups.forEach((g, k) => g.querySelectorAll(".bar").forEach((b) => b.classList.toggle("hover", k === i)));
        const box = svg.getBoundingClientRect();
        const e = evt && evt.clientX != null ? evt : { clientX: box.left + m.l + band * i + band / 2, clientY: box.top + m.t + 20 };
        showTooltip(e, o.tooltipTitle ? o.tooltipTitle(l) : l, rows());
      };
      const off = () => { groups[i].querySelectorAll(".bar").forEach((b) => b.classList.remove("hover")); hideTooltip(); };
      hit.addEventListener("pointermove", on);
      hit.addEventListener("pointerleave", off);
      hit.addEventListener("focus", () => on());
      hit.addEventListener("blur", off);
      hit.addEventListener("keydown", (evt) => {
        const sib = evt.key === "ArrowLeft" ? hit.previousSibling : evt.key === "ArrowRight" ? hit.nextSibling : null;
        if (sib && sib.tagName === "rect") { evt.preventDefault(); sib.setAttribute("tabindex", 0); hit.setAttribute("tabindex", -1); sib.focus(); }
      });
      svg.appendChild(hit);
    });

    container.replaceChildren(svg);
    if (container.__animate) {
      container.__animate = false;
      svg.classList.add("grow-bars");
      setTimeout(() => svg.classList.remove("grow-bars"), 1400);
    }
  }

  // ----------------------------------------------------------- sparkline
  function spark(values, { color = "--series-1", w = 160, h = 28 } = {}) {
    const svg = el("svg", { class: "spark", viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const v = values.filter((x) => x != null);
    if (v.length < 2) return svg;
    const lo = Math.min(...v), hi = Math.max(...v);
    const x = (i) => 3 + (i / (values.length - 1)) * (w - 6);
    const y = (val) => 3 + (1 - (val - lo) / (hi - lo || 1)) * (h - 6);
    const d = values.map((val, i) => `${i ? "L" : "M"}${x(i)},${y(val)}`).join("");
    svg.appendChild(el("path", { d, fill: "none", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }, { stroke: "var(--text-muted)" }));
    const last = values.length - 1;
    svg.appendChild(el("path", { d: `M${x(last - 1)},${y(values[last - 1])}L${x(last)},${y(values[last])}`, fill: "none", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, { stroke: resolve(color) }));
    return svg;
  }

  function legend(container, items) {
    container.replaceChildren();
    for (const it of items) {
      const s = document.createElement("span");
      let k;
      if (it.kind === "rect" || it.kind === "band") {
        k = document.createElement("i");
        k.className = it.kind === "rect" ? "key-rect" : "key-band";
        k.style.background = resolve(it.color);
        if (it.kind === "band") k.style.opacity = 0.25;
      } else {
        // Line keys mirror the mark: a short stroke, dashed when the series is.
        k = el("svg", { width: 18, height: 4, viewBox: "0 0 18 4", "aria-hidden": "true" });
        k.appendChild(el("line", { x1: 1, x2: 17, y1: 2, y2: 2, "stroke-width": 2, "stroke-linecap": "round", "stroke-dasharray": it.dashed ? "4 3" : "" }, { stroke: resolve(it.color) }));
      }
      s.append(k, document.createTextNode(it.name));
      container.appendChild(s);
    }
  }

  function rerenderAll() {
    document.querySelectorAll(".chart").forEach((c) => c.__render && c.__render());
  }

  window.Charts = { line, columns, spark, legend, rerenderAll, hideTooltip, showTooltip, el, niceScale, resolve, reducedMotion };
})();
