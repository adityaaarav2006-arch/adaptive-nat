/*
 * charts.js - the measured results (section 7, panels A-F) and the findings (section 8).
 * Hand-drawn SVG; every value comes from DEMO_DATA. Our agent is always blue, ICE always orange,
 * and every mark is labelled directly or has a table next to it.
 */
(function () {
  "use strict";
  var Demo = window.Demo, el = Demo.el, svg = Demo.svg;

  // ───────────────────────────────────────────────────────── chart helpers
  function barH(x0, y, len, h) {   // horizontal bar: square at the baseline, 4px rounded data end
    var r = Math.min(4, len, h / 2);
    if (len <= 0) return "";
    return "M" + x0 + " " + y + "H" + (x0 + len - r) + "Q" + (x0 + len) + " " + y + " " + (x0 + len) + " " + (y + r) +
      "V" + (y + h - r) + "Q" + (x0 + len) + " " + (y + h) + " " + (x0 + len - r) + " " + (y + h) + "H" + x0 + "Z";
  }
  function tip(node, html) { node.setAttribute("data-tip", html); return node; }
  function chartSvg(w, h, label) {
    return svg("svg", {class: "chart", viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": label});
  }
  var SER = {ours: {cls: "m-ours", name: "Our agent", sw: "sw-ours"}, ice: {cls: "m-ice", name: "ICE baseline", sw: "sw-ice"},
             unaware: {cls: "m-unaware", name: "Ours, block-unaware", sw: "sw-unaware"}, aioice: {cls: "m-ice", name: "aioice", sw: "sw-ice"}};
  function legend(keys) {
    return el("div", {class: "legend-inline"}, keys.map(function (k) { return [el("span", {class: "sw " + SER[k].sw}), SER[k].name]; }));
  }
  function measuredTitle(text, extra) {
    return el("div", {class: "card-title-row"}, el("h3", null, text), extra || null);
  }

  /* Grouped horizontal bar chart. rows: [{label, sub?, values: {key: v}, tips: {key: html}}]
     keys: series order (top to bottom inside a group). fmt: value -> label text. */
  function hbarChart(o) {
    var W = o.width || 520, labelW = o.labelW || 118, padR = 58, top = 22;
    var bh = o.barH || 13, gap = o.gap || 2, groupGap = o.groupGap || 12;
    var gh = o.keys.length * bh + (o.keys.length - 1) * gap;
    var H = top + o.rows.length * (gh + groupGap) + 6;
    var s = chartSvg(W, H, o.label);
    var x0 = labelW, plotW = W - labelW - padR;
    var xs = o.log
      ? function (v) { return (Math.log10(Math.max(v, o.min)) - Math.log10(o.min)) / (Math.log10(o.max) - Math.log10(o.min)) * plotW; }
      : function (v) { return v / o.max * plotW; };
    (o.ticks || []).forEach(function (t) {
      var x = x0 + xs(t);
      s.appendChild(svg("line", {class: "gridline", x1: x, x2: x, y1: top - 4, y2: H - 6}));
      s.appendChild(svg("text", {class: "tick", x: x, y: top - 9, "text-anchor": "middle"}, o.tickFmt ? o.tickFmt(t) : t));
    });
    o.rows.forEach(function (row, i) {
      var gy = top + i * (gh + groupGap);
      var ty = gy + gh / 2 + (row.sub ? -2 : 4);
      s.appendChild(svg("text", {class: "cat", x: labelW - 10, y: ty, "text-anchor": "end"}, row.label));
      if (row.sub) s.appendChild(svg("text", {class: "tick", x: labelW - 10, y: ty + 14, "text-anchor": "end"}, row.sub));
      o.keys.forEach(function (k, j) {
        var v = row.values[k];
        if (v == null) return;
        var ser = SER[(row.series && row.series[k]) || k];   // a row may say which series its bar belongs to
        var y = gy + j * (bh + gap);
        var len = Math.max(1.5, xs(v));
        var g = svg("g", {tabindex: 0});
        g.appendChild(svg("path", {class: ser.cls, d: barH(x0, y, len, bh)}));
        g.appendChild(svg("rect", {class: "hit", x: x0, y: y - 1, width: Math.max(len, 30) + 40, height: bh + 2}));
        g.appendChild(svg("text", {class: "val", x: x0 + len + 5, y: y + bh - 2}, o.fmt(v, k)));
        tip(g, (row.tips && row.tips[k]) || ("<b>" + ser.name + "</b> · " + (row.sub ? row.label + " " + row.sub : row.label) + ": " + o.fmt(v, k)));
        s.appendChild(g);
      });
    });
    s.appendChild(svg("line", {class: "baseline", x1: x0, x2: x0, y1: top - 4, y2: H - 6}));
    return s;
  }

  function table(head, rows, opts) {
    opts = opts || {};
    return el("table", {class: "data"},
      el("thead", null, el("tr", null, head.map(function (h) { return el("th", {class: h.n ? "n" : ""}, h.t); }))),
      el("tbody", null, rows.map(function (r) {
        return el("tr", {class: r.cls || ""}, r.cells.map(function (c, i) { return el("td", {class: head[i].n ? "n" : ""}, c); }));
      })));
  }
  function swHead(k, text) { return el("span", {class: "th-sw"}, el("span", {class: "sw " + SER[k].sw}), text); }
  function viewToggle(chartNode, tableNode) {
    var seg = el("div", {class: "seg", role: "group", "aria-label": "View"});
    var bc = el("button", {type: "button", "aria-pressed": "true"}, "Chart");
    var bt = el("button", {type: "button", "aria-pressed": "false"}, "Table");
    seg.appendChild(bc); seg.appendChild(bt);
    tableNode.hidden = true;
    bc.addEventListener("click", function () { chartNode.hidden = false; tableNode.hidden = true; bc.setAttribute("aria-pressed", "true"); bt.setAttribute("aria-pressed", "false"); });
    bt.addEventListener("click", function () { chartNode.hidden = true; tableNode.hidden = false; bt.setAttribute("aria-pressed", "true"); bc.setAttribute("aria-pressed", "false"); });
    return seg;
  }

  // ───────────────────────────────────────────────────────── A · profiler accuracy
  function panelA(D) {
    var box = document.getElementById("res-a");
    var acc = D.accuracy, accb = D.accuracyBlocks;
    var groups = [["EI", "EI mapping"], ["AD", "AD mapping"], ["APD", "APD mapping"]].map(function (g) {
      return {name: g[1], cfgs: acc.configs.filter(function (c) { return c.mapping === g[0]; })};
    });
    groups.push({name: "Port blocks", cfgs: accb.configs});
    var cell = 22, gapG = 16, top = 30, left = 50;
    var cols = groups.reduce(function (a, g) { return a + g.cfgs.length; }, 0);
    var W = left + cols * cell + (groups.length - 1) * gapG + 4, H = top + acc.reps * cell + 46;
    var s = chartSvg(W, H, "Profiler results: one dot per router type and run; all " + acc.n + " plus " + accb.n + " correct");
    s.classList.add("chart-lg");
    for (var r = 0; r < acc.reps; r++) {
      s.appendChild(svg("text", {class: "tick", x: left - 8, y: top + r * cell + cell / 2 + 4, "text-anchor": "end"}, "run " + (r + 1)));
    }
    var x = left;
    groups.forEach(function (g) {
      var gx = x;
      g.cfgs.forEach(function (c) {
        c.runs.forEach(function (run, ri) {
          var cx = x + cell / 2, cy = top + ri * cell + cell / 2;
          var dot = svg("g", {tabindex: 0});
          dot.appendChild(svg("circle", {cx: cx, cy: cy, r: 9, class: run.ok ? "m-good" : "m-empty"}));
          if (run.ok) dot.appendChild(svg("path", {d: "M" + (cx - 4.5) + " " + cy + "l3 3l5.5-6", fill: "none", stroke: "#fff", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round"}));
          tip(dot, "<b>" + c.label + "</b>, run " + (ri + 1) + "<br>detected " + run.detected + (run.detectedBlock ? " " + run.detectedBlock : "") +
            " · " + Demo.fmtTime(run.s) + " · " + run.probes + " probes · " + (run.ok ? "correct" : "wrong"));
          s.appendChild(dot);
        });
        x += cell;
      });
      var ok = g.cfgs.reduce(function (a, c) { return a + c.ok; }, 0), n = g.cfgs.reduce(function (a, c) { return a + c.n; }, 0);
      s.appendChild(svg("text", {class: "cat", x: (gx + x) / 2, y: top - 10, "text-anchor": "middle"}, g.name));
      s.appendChild(svg("text", {class: "val", x: (gx + x) / 2, y: top + acc.reps * cell + 18, "text-anchor": "middle"}, ok + "/" + n));
      s.appendChild(svg("text", {class: "tick", x: (gx + x) / 2, y: top + acc.reps * cell + 38, "text-anchor": "middle"}, g.cfgs.length + " types"));
      x += gapG;
    });
    var fb = acc.byFiltering;
    var left_ = el("div", {class: "card"}, measuredTitle("Every router type, every run"),
      el("p", {class: "footnote", style: "margin-bottom:.4rem"}, "One dot per type and run: " + acc.configs.length + " types × " + acc.reps +
        " runs, plus " + accb.configs.length + " port-block types × " + accb.reps + ". Hover a dot for details."), s);
    var rows = [["EI mapping", acc.byMapping.EI], ["AD mapping", acc.byMapping.AD], ["APD mapping", acc.byMapping.APD],
                ["Port blocks", {ok: accb.ok, n: accb.n}]];
    var right = el("div", {class: "card"},
      el("div", {class: "big-stat"}, el("span", {class: "bs-v"}, acc.ok + "/" + acc.n), el("span", {class: "bs-l"}, "behaviours identified correctly")),
      el("div", {class: "stat-rows"}, rows.map(function (r) {
        return el("div", {class: "stat-row"}, el("span", null, r[0]), el("div", {class: "meter", "aria-hidden": "true"}, el("span", {style: "width:" + (r[1].ok / r[1].n * 100) + "%"})),
          el("b", {class: "num-tab"}, r[1].ok + "/" + r[1].n));
      })),
      el("p", {class: "footnote", style: "margin-top:.6rem"}, "Port blocks: exact first port and size of the 512-port block, " + accb.ok + "/" + accb.n + "."),
      el("p", {class: "footnote", style: "margin-top:.3rem"}, "Median profiling time: " + Demo.fmtTime(fb.EI.secondsMedian) + " with an open (EI) filter, " +
        Demo.fmtTime(fb.AD.secondsMedian) + " (AD) and " + Demo.fmtTime(fb.APD.secondsMedian) + " (APD), because one probe waits out 3 × 0.5 s. " +
        "On the real Linux NATs: " + Demo.fmtTime(D.testbed.profileSecondsMedian["full-cone"]) + " (full cone) and " +
        Demo.fmtTime(D.testbed.profileSecondsMedian["port-restricted"]) + " (port-restricted). " +
        acc.probesEI + " probes with EI mapping, " + acc.probesOther + " otherwise."));
    box.appendChild(el("div", {class: "res-grid"}, left_, right));
  }

  // ───────────────────────────────────────────────────────── B · simulation by pairing class
  function panelB(D) {
    var sim = D.sim;
    document.getElementById("res-b-lede").textContent = "Both agents connected every pairing of our " + sim.natTypes + " router types (" + sim.pairings +
      " pairings), " + sim.trials + " times each: " + sim.sessionsPerAgent + " calls per agent.";
    var box = document.getElementById("res-b");
    box.appendChild(el("div", {class: "callouts"},
      el("div", {class: "callout-chip"}, Demo.icon.tick(), el("span", null, "ICE never got more direct paths than us in ", el("b", null, "any of the " + sim.pairings + " pairings"),
        " (ours better in " + sim.pairsAdpBetter + ", equal in " + sim.pairsEqual + ").")),
      el("div", {class: "callout-chip"}, Demo.icon.tick(), el("span", null, "Every call of both agents still delivered its data: ",
        el("b", null, sim.adaptive.ok + "/" + sim.sessionsPerAgent + " each"), "."))));
    var rows = sim.classes.map(function (c) {
      var parts = c.short.split("/");
      return {c: c, label: c.short === "All" ? "All" : parts[0] + " /", sub: c.short === "All" ? sim.sessionsPerAgent + " calls" : parts[1]};
    });
    function rowsFor(kv) {
      return rows.map(function (r) {
        var v = kv(r.c);
        return {label: r.label, sub: r.sub, values: {ice: v[0], ours: v[1]},
                tips: {ice: "<b>ICE</b> · " + r.c.short + " (" + r.c.n + " calls): " + v[2],
                       ours: "<b>Our agent</b> · " + r.c.short + " (" + r.c.n + " calls): " + v[3]}};
      });
    }
    var common = {keys: ["ice", "ours"], width: 500, labelW: 80, barH: 12, gap: 3, groupGap: 8};
    var c1 = hbarChart(Object.assign({label: "Direct connections by pairing class, ICE versus our agent", max: 100, ticks: [0, 25, 50, 75, 100],
      tickFmt: function (t) { return t + "%"; }, fmt: function (v) { return Math.round(v) + "%"; },
      rows: rowsFor(function (c) { return [c.iceDirect, c.adpDirect, Demo.fmtPct(c.iceDirect) + " direct", Demo.fmtPct(c.adpDirect) + " direct"]; })}, common));
    var c2 = hbarChart(Object.assign({label: "Median time to a working path by pairing class", max: 3, ticks: [0, 1, 2, 3],
      tickFmt: function (t) { return t + " s"; }, fmt: function (v) { return Demo.fmtTime(v); },
      rows: rowsFor(function (c) { return [c.iceT, c.adpT, Demo.fmtTime(c.iceT) + " median", Demo.fmtTime(c.adpT) + " median"]; })}, common));
    var charts = el("div", {class: "res-grid even"},
      el("div", null, el("div", {class: "ps-title"}, "Calls with a direct path"), c1),
      el("div", null, el("div", {class: "ps-title"}, "Median time to a working path"), c2));
    var tbl = el("div", null, table(
      [{t: "Pairing class"}, {t: "Calls", n: 1}, {t: swHead("ice", "ICE direct"), n: 1}, {t: swHead("ours", "Ours direct"), n: 1},
       {t: swHead("ice", "ICE time"), n: 1}, {t: swHead("ours", "Ours time"), n: 1}, {t: swHead("ice", "ICE pkts"), n: 1}, {t: swHead("ours", "Ours pkts"), n: 1}],
      sim.classes.map(function (c) {
        return {cls: c.short === "All" ? "total" : "", cells: [c.short, c.n, Demo.fmtPct(c.iceDirect), Demo.fmtPct(c.adpDirect),
          Demo.fmtTime(c.iceT), Demo.fmtTime(c.adpT), Demo.fmtInt(c.iceP), Demo.fmtInt(c.adpP)]};
      })),
      el("p", {class: "footnote", style: "margin-top:.4rem"}, "Cone = EI mapping; S-Pred = symmetric with sequential or fixed-step ports; S-Rand = symmetric with random ports. Packets = median datagrams through both NATs while connecting."));
    var card = el("div", {class: "card"},
      measuredTitle("By pairing class", el("div", {style: "display:flex;gap:14px;align-items:center;flex-wrap:wrap"}, legend(["ours", "ice"]), viewToggle(charts, tbl))),
      charts, tbl);
    box.appendChild(card);
  }

  // ───────────────────────────────────────────────────────── C & D · methods and packet overhead
  function panelCD(D) {
    var box = document.getElementById("res-cd");
    var sim = D.sim, ms = sim.methods;
    var spray = ms.filter(function (m) { return m.method === "SPRAY"; })[0];
    var maxN = Math.max.apply(null, ms.map(function (m) { return m.n; }));
    var tC = table([{t: "Method"}, {t: "Calls", n: 1}, {t: ""}, {t: "Direct", n: 1}, {t: "Median packets", n: 1}, {t: "Median time", n: 1}],
      ms.map(function (m) {
        return {cells: [Demo.methodChip(m.method), m.n,
          el("div", {class: "meter", style: "width:6rem", "aria-hidden": "true"}, el("span", {style: "width:" + (m.n / maxN * 100) + "%;background:var(--ours)"})),
          Demo.fmtPct(m.direct), Demo.fmtInt(m.pktsMed), Demo.fmtTime(m.tMed)]};
      }));
    // spray: measured success vs the birthday formula (dot plot on a 90-100% axis, so no truncated bar)
    var W = 480, H = 76, x0 = 20, x1 = W - 60;   // room on the right for the "formula" label
    var sx = function (v) { return x0 + (v - 90) / 10 * (x1 - x0); };
    var s = chartSvg(W, H, "Spray success: measured " + Demo.fmtPct(spray.direct) + " versus formula " + (100 * spray.pModel).toFixed(1) + "%");
    s.appendChild(svg("line", {class: "baseline", x1: x0, x2: x1, y1: 40, y2: 40}));
    [90, 92, 94, 96, 98, 100].forEach(function (t) {
      s.appendChild(svg("line", {class: "gridline", x1: sx(t), x2: sx(t), y1: 34, y2: 46}));
      s.appendChild(svg("text", {class: "tick", x: sx(t), y: 64, "text-anchor": "middle"}, t + "%"));
    });
    var mp = 100 * spray.pModel;
    s.appendChild(tip(svg("g", {tabindex: 0}, svg("line", {class: "model-line", x1: sx(mp), x2: sx(mp), y1: 18, y2: 50}),
      svg("text", {class: "val", x: sx(mp) + 6, y: 20}, "formula " + mp.toFixed(1) + "%")), "Birthday formula 1 − e^(−N·M/R), mean over the spray plans: " + mp.toFixed(1) + "%"));
    var hits = Math.round(spray.direct * spray.n / 100);
    s.appendChild(tip(svg("g", {tabindex: 0}, svg("circle", {class: "m-ours ring", cx: sx(spray.direct), cy: 40, r: 7}),
      svg("text", {class: "val", x: sx(spray.direct) - 10, y: 24, "text-anchor": "end"}, "measured " + Demo.fmtPct(spray.direct))),
      "Measured: " + hits + " of " + spray.n + " spray calls went direct (" + Demo.fmtPct(spray.direct) + ")"));
    var left = el("div", {class: "card"}, measuredTitle("C · Our agent, by chosen method"), tC,
      el("div", {class: "ps-title", style: "margin-top:.8rem"}, "Spraying: measured vs the formula"),
      el("p", {class: "footnote"}, hits + " of " + spray.n + " spray calls found a direct path; the birthday formula predicted " + mp.toFixed(1) + "%."), s);
    // D: log-scale overhead
    var rowsD = ms.map(function (m) { return {label: m.method, values: {v: m.pktsMed}, series: {v: "ours"}}; });
    rowsD.push({label: "ICE", sub: "every call", values: {v: sim.ice.pktsMed}, series: {v: "ice"}});
    var cD = hbarChart({label: "Median packets per call, by method, log scale", keys: ["v"], log: true, min: 1, max: 1000,
      ticks: [1, 10, 100, 1000], tickFmt: Demo.fmtInt, fmt: function (v) { return Demo.fmtInt(v); }, width: 460, labelW: 86, barH: 24, groupGap: 16,
      rows: rowsD});
    var iceOnSpray = 0, iceOnSprayN = 0;
    Object.keys(D.pairings).forEach(function (k) {
      var p = D.pairings[k];
      if (p.plan === "SPRAY") { iceOnSpray += p.ice.direct; iceOnSprayN += p.ice.n; }
    });
    var right = el("div", {class: "card"}, measuredTitle("D · Packets per call vs ICE", legend(["ours", "ice"])),
      el("p", {class: "footnote", style: "margin-bottom:.4rem"}, "Median datagrams through both NATs while connecting. Log scale: each grid line is 10× more."), cD,
      el("p", {class: "footnote", style: "margin-top:.4rem"}, "DIRECT and PREDICT undercut ICE's " + Demo.fmtInt(sim.ice.pktsMed) +
        ". SPRAY costs more, but went direct in " + hits + " of " + spray.n + " calls on pairings where ICE managed " + iceOnSpray + " of " + iceOnSprayN +
        ". RELAY sends only its 3 test messages each way."));
    box.appendChild(el("div", {class: "res-grid"}, left, right));
  }

  // ───────────────────────────────────────────────────────── E · real Linux NAT testbed
  function panelE(D) {
    var tb = D.testbed;
    document.getElementById("res-e-lede").textContent = "We built three real Linux NATs (kernel nftables and conntrack, in network namespaces) and ran each pairing " +
      tb.trials + " times with our agent and with aioice, a standard ICE library.";
    var box = document.getElementById("res-e");
    var names = {"full-cone": "full cone", "port-restricted": "port-restricted", "symmetric": "symmetric (random)"};
    var rows = tb.rows.map(function (r) {
      var ad = r.adaptive, ai = r.aioice;
      var to = ai.errors.filter(function (e) { return e; }).length;
      return {cells: [
        tip(el("span", {tabindex: 0}, el("b", null, r.label)), names[r.a] + " ↔ " + names[r.b] + "<br>profiles " + ad.profileA + " ↔ " + ad.profileB),
        el("span", null, Demo.dots(ad.direct, ad.n), ad.direct + "/" + ad.n), Demo.methodChip(ad.plan), Demo.fmtTimePaper(ad.tMed),
        el("span", null, Demo.dots(ai.direct, ai.n), ai.direct + "/" + ai.n),
        el("span", null, Demo.fmtTimePaper(ai.tMed), to ? el("span", {class: "muted"}, to === ai.n ? " timeout" : " (" + to + " timeout)") : null)]};
    });
    rows.push({cls: "total", cells: ["All", tb.adaptive.direct + "/" + tb.adaptive.n, "", "", tb.aioice.direct + "/" + tb.aioice.n, ""]});
    var t = table([{t: "Pairing"}, {t: swHead("ours", "Ours")}, {t: "Method"}, {t: "Median", n: 1}, {t: swHead("aioice", "aioice")}, {t: "Median", n: 1}], rows);
    var fcfc = tb.rows.filter(function (r) { return r.label === "FC/FC"; })[0];
    var fcTo = fcfc.aioice.errors.filter(function (e) { return e; }).length;
    var n = Demo.DATA.notes.aioiceFcFcTimeout;
    var left = el("div", {class: "card"}, measuredTitle("Direct paths, 6 pairings × " + tb.trials + " runs"), t,
      el("p", {class: "footnote", style: "margin-top:.45rem"}, "FC = full cone (EI/EI), PR = port-restricted (EI/APD), Sym = symmetric, random ports (APD/APD/Rand). aioice gives up after 15 s. " +
        (fcTo === 1 ? "One" : fcTo) + " aioice FC/FC session timed out, which did not reproduce in " + n.reruns + " reruns."));
    // dumbbell: median time per pairing, log scale
    var W = 470, top = 30, rowH = 40, labelW = 70, padR = 24;
    var H = top + tb.rows.length * rowH + 6;
    var s = chartSvg(W, H, "Median time to a working path on the real NATs, ours versus aioice, log scale");
    var lo = 0.001, hi = 20, plotW = W - labelW - padR;
    var xs = function (v) { return labelW + (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * plotW; };
    [[0.001, "1 ms"], [0.01, "10 ms"], [0.1, "100 ms"], [1, "1 s"], [10, "10 s"]].forEach(function (tk) {
      s.appendChild(svg("line", {class: "gridline", x1: xs(tk[0]), x2: xs(tk[0]), y1: top - 6, y2: H - 6}));
      s.appendChild(svg("text", {class: "tick", x: xs(tk[0]), y: top - 12, "text-anchor": "middle"}, tk[1]));
    });
    tb.rows.forEach(function (r, i) {
      var y = top + i * rowH + rowH / 2;
      s.appendChild(svg("text", {class: "cat", x: labelW - 10, y: y + 4, "text-anchor": "end"}, r.label));
      var xa = xs(r.adaptive.tMed), xi = xs(r.aioice.tMed);
      s.appendChild(svg("line", {x1: xa, x2: xi, y1: y, y2: y, stroke: "var(--axis)", "stroke-width": 2}));
      [["ours", r.adaptive, xa, "m-ours"], ["aioice", r.aioice, xi, "m-ice"]].forEach(function (d) {
        var g = svg("g", {tabindex: 0}, svg("circle", {class: d[3] + " ring", cx: d[2], cy: y, r: 7}));
        var right = d[0] === "ours" ? xa > xi : xi >= xa;
        g.appendChild(svg("text", {class: "val", x: d[2] + (right ? 11 : -11), y: y + 4, "text-anchor": right ? "start" : "end"}, Demo.fmtTimePaper(d[1].tMed)));
        tip(g, "<b>" + (d[0] === "ours" ? "Our agent" : "aioice") + "</b> · " + r.label + ": median " + Demo.fmtTimePaper(d[1].tMed) + ", " + d[1].direct + "/" + d[1].n + " direct" +
          (d[0] === "ours" ? " (" + d[1].plan + ")" : ""));
        s.appendChild(g);
      });
    });
    var right = el("div", {class: "card"}, measuredTitle("Median time to a working path", legend(["ours", "aioice"])), s,
      el("p", {class: "footnote", style: "margin-top:.3rem"}, "Log scale. At 15 s aioice never found a path and timed out; ours relays the hopeless Sym/Sym pairing in " +
        Demo.fmtTimePaper(tb.rows[tb.rows.length - 1].adaptive.tMed) + "."));
    box.appendChild(el("div", {class: "res-grid even"}, left, right));
  }

  // ───────────────────────────────────────────────────────── F · port-block-aware spraying
  function panelF(D) {
    var box = document.getElementById("res-f");
    var b = D.blocks, sm = b.sim, bt = b.testbed;
    // simulation: one row per agent, one column per metric, each with a bar scaled within its column
    var cols = [["Direct", "direct", function (v) { return Demo.fmtPct(v); }, 100],
                ["Median packets", "pktsMed", Demo.fmtInt, Math.max(sm.aware.pktsMed, sm.unaware.pktsMed, sm.ice.pktsMed)],
                ["Median time", "tMed", Demo.fmtTime, Math.max(sm.aware.tMed, sm.unaware.tMed, sm.ice.tMed)]];
    var agents = [["Ours, block-aware", "ours", sm.aware], ["Ours, unaware", "unaware", sm.unaware], ["ICE baseline", "ice", sm.ice]];
    var t1 = table([{t: ""}].concat(cols.map(function (c) { return {t: c[0]}; })), agents.map(function (a) {
      return {cells: [el("span", {class: "th-sw", style: "font-weight:650"}, el("span", {class: "sw " + SER[a[1]].sw}), a[0])].concat(cols.map(function (c) {
        var v = a[2][c[1]];
        return el("div", {style: "display:flex;flex-direction:column;gap:3px"}, el("b", {class: "num-tab"}, c[2](v)),
          el("div", {class: "meter", style: "width:100%", "aria-hidden": "true"}, el("span", {style: "width:" + Math.max(2, v / c[3] * 100) + "%;background:var(--" + (a[1] === "ours" ? "ours" : a[1]) + ")"})));
      }))};
    }));
    var left = el("div", {class: "card"}, measuredTitle("Simulation: " + b.blockSessions + " calls that sprayed into a block"), t1,
      el("p", {class: "footnote", style: "margin-top:.5rem"}, "Same success, " + sm.packetReduction.toFixed(1) + "× fewer packets at the median, and less than half the time. " +
        "Formula: " + (100 * sm.modelPAware).toFixed(1) + "% for N = M = " + bt.aware.nOpen + " in a " + bt.aware.sprayRange + "-port block, against " +
        Demo.fmtInt(bt.unaware.nOpen) + " + " + Demo.fmtInt(bt.unaware.mProbe) + " without block awareness."));
    // real NAT: one dot per run
    var W = 470, H = 136, x0 = 128, x1 = W - 16;
    var maxP = 1500;
    var sx = function (v) { return x0 + v / maxP * (x1 - x0); };
    var s = chartSvg(W, H, "Packets per run on the real block NAT, block-aware versus block-unaware");
    [0, 500, 1000, 1500].forEach(function (t) {
      s.appendChild(svg("line", {class: "gridline", x1: sx(t), x2: sx(t), y1: 14, y2: H - 22}));
      s.appendChild(svg("text", {class: "tick", x: sx(t), y: H - 6, "text-anchor": "middle"}, Demo.fmtInt(t)));
    });
    [["Ours, block-aware", bt.aware, "m-ours", 40], ["Ours, unaware", bt.unaware, "m-unaware", 86]].forEach(function (r) {
      var y = r[3];
      s.appendChild(svg("text", {class: "cat", x: x0 - 12, y: y + 4, "text-anchor": "end"}, r[0]));
      s.appendChild(svg("line", {x1: sx(r[1].pktsMin), x2: sx(r[1].pktsMax), y1: y, y2: y, stroke: "var(--axis)", "stroke-width": 2}));
      r[1].pkts.forEach(function (p, i) {
        s.appendChild(tip(svg("circle", {class: r[2] + " ring", cx: sx(p), cy: y + ((i % 3) - 1) * 4, r: 5.5, tabindex: 0}), "<b>" + r[0] + "</b>, run " + (i + 1) + ": " + p + " packets"));
      });
      var lx = Math.min(sx(r[1].pktsMed), x1 - 150);
      s.appendChild(svg("text", {class: "val", x: lx, y: y - 13}, "median " + Math.round(r[1].pktsMed) + ", range " + r[1].pktsMin + "–" + Demo.fmtInt(r[1].pktsMax)));
    });
    var reduction = bt.unaware.pktsMed / bt.aware.pktsMed;
    var tR = table([{t: ""}, {t: swHead("ours", "Block-aware"), n: 1}, {t: swHead("unaware", "Unaware"), n: 1}, {t: swHead("aioice", "aioice"), n: 1}], [
      {cells: ["Direct", bt.aware.direct + "/" + bt.aware.n, bt.unaware.direct + "/" + bt.unaware.n, bt.aioice.direct + "/" + bt.aioice.n]},
      {cells: ["Median packets", Math.round(bt.aware.pktsMed) + " (" + bt.aware.pktsMin + "–" + bt.aware.pktsMax + ")",
               Math.round(bt.unaware.pktsMed) + " (" + bt.unaware.pktsMin + "–" + Demo.fmtInt(bt.unaware.pktsMax) + ")", "–"]},
      {cells: ["Median time", Demo.fmtTimePaper(bt.aware.tMed), Demo.fmtTimePaper(bt.unaware.tMed), Demo.fmtTimePaper(bt.aioice.tMed) + " timeout"]}
    ]);
    var right = el("div", {class: "card"}, measuredTitle("Real Linux block NAT, " + bt.aware.n + " runs"),
      el("p", {class: "footnote"}, "nftables “masquerade to :40960–41471 random”, profiled as " + bt.aware.profiles[0][1] + ". One dot per run; " +
        reduction.toFixed(1) + "× fewer packets at the median."), s, tR);
    box.appendChild(el("div", {class: "res-grid even"}, left, right));
  }

  // ───────────────────────────────────────────────────────── 8 · findings
  function findings(D) {
    var n = D.notes, tb = D.testbed;
    var prRows = tb.rows.filter(function (r) { return r.label === "PR/PR" || r.label === "PR/Sym"; });
    var aiPR = prRows.reduce(function (a, r) { return a + r.aioice.direct; }, 0), nPR = prRows.reduce(function (a, r) { return a + r.aioice.n; }, 0);
    var adPR = prRows.reduce(function (a, r) { return a + r.adaptive.direct; }, 0);
    var relay = D.sim.methods.filter(function (m) { return m.method === "RELAY"; })[0];
    var iceDirectOnRelayPairs = 0;
    Object.keys(D.pairings).forEach(function (k) { if (D.pairings[k].plan === "RELAY") iceDirectOnRelayPairs += D.pairings[k].ice.direct; });
    var bt = D.blocks.testbed;

    function card(i, title, text, fix, chips, diagram) {
      return el("div", {class: "card finding"},
        el("h3", null, el("span", {class: "fn"}, i), title),
        el("div", {class: "f-dia"}, diagram),
        el("p", null, text),
        el("p", {class: "fix"}, el("b", null, "Fix: "), fix),
        el("div", {class: "f-chips"}, chips.map(function (c) { return el("span", {class: "f-chip"}, c); })));
    }
    function dg(w, h, label) { return svg("svg", {viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": label}); }
    function rtr(g, x, y, label) {
      g.appendChild(svg("rect", {x: x - 24, y: y - 16, width: 48, height: 32, rx: 6, fill: "var(--router)"}));
      g.appendChild(svg("text", {x: x, y: y + 5, "text-anchor": "middle", style: "fill:var(--page);font-weight:700;font-size:13px"}, label));
    }
    function cross(g, x, y) { g.appendChild(svg("path", {d: "M" + (x - 8) + " " + (y - 8) + "l16 16M" + (x + 8) + " " + (y - 8) + "l-16 16", stroke: "var(--bad)", "stroke-width": 3.5, "stroke-linecap": "round"})); }
    function ok(g, x, y) { g.appendChild(svg("path", {d: "M" + (x - 9) + " " + y + "l6 6l12-12", stroke: "var(--good)", "stroke-width": 3.5, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round"})); }

    // 1 · contamination: shared socket vs separate socket
    var d1 = dg(520, 170, "With one shared socket the two tests disturb each other; with a separate socket each test gets its own mapping");
    [[0, "One shared socket", false], [270, "Filter test on its own socket", true]].forEach(function (p) {
      var x = p[0];
      d1.appendChild(svg("text", {class: "strong", x: x + 120, y: 18, "text-anchor": "middle"}, p[1]));
      d1.appendChild(svg("rect", {x: x + 8, y: 34, width: 70, height: 104, rx: 9, fill: "var(--house)", stroke: "var(--border-strong)"}));
      d1.appendChild(svg("text", {x: x + 43, y: 154, "text-anchor": "middle"}, "host"));
      var socks = p[2] ? [62, 112] : [87];
      socks.forEach(function (y) { d1.appendChild(svg("circle", {cx: x + 78, cy: y, r: 7, fill: "var(--surface)", stroke: "var(--ink-2)", "stroke-width": 2.2})); });
      [[62, "mapping test", "var(--ink-2)"], [112, "filtering test", "var(--ours)"]].forEach(function (t) {
        var sy = p[2] ? t[0] : 87;
        d1.appendChild(svg("path", {d: "M" + (x + 85) + " " + sy + "L" + (x + 130) + " " + t[0] + "H" + (x + 140), stroke: t[2], "stroke-width": 2.5, fill: "none"}));
        d1.appendChild(svg("text", {x: x + 145, y: t[0] + 5}, t[1]));
      });
      if (p[2]) ok(d1, x + 120, 150); else cross(d1, x + 120, 150);
    });

    // 2 · conntrack: early packet remaps the far port; TTL 2 packet dies first
    var d2 = dg(520, 170, "An early packet leaves an UNREPLIED conntrack entry and NAT B remaps its port; a TTL 2 packet expires before reaching NAT B");
    [[44, "Naive: first packet reaches NAT B", false], [124, "Ours: first packets sent with TTL 2", true]].forEach(function (row) {
      var y = row[0];
      d2.appendChild(svg("text", {class: "strong", x: 4, y: y - 22}, row[1]));
      d2.appendChild(svg("text", {class: "strong", x: 4, y: y + 5}, "A"));
      d2.appendChild(svg("path", {d: "M22 " + y + "H420", stroke: "var(--axis)", "stroke-width": 2}));
      rtr(d2, 62, y, "NAT A"); rtr(d2, 420, y, "NAT B");
      d2.appendChild(svg("text", {class: "strong", x: 508, y: y + 5, "text-anchor": "end"}, "B"));
      if (!row[2]) {
        d2.appendChild(svg("circle", {cx: 378, cy: y, r: 7, fill: "var(--ice)"}));
        d2.appendChild(svg("text", {class: "mono", x: 300, y: y + 26, "text-anchor": "middle", style: "font-size:13px"}, "UNREPLIED entry"));
        d2.appendChild(svg("text", {class: "mono", x: 516, y: y + 26, "text-anchor": "end", style: "font-size:13px;fill:var(--bad)"}, ":" + n.conntrackRemap.before + " → :" + n.conntrackRemap.after));
      } else {
        d2.appendChild(svg("path", {d: "M90 " + y + "H200", stroke: "var(--ours)", "stroke-width": 2.5, "stroke-dasharray": "5 4"}));
        d2.appendChild(svg("circle", {cx: 214, cy: y, r: 7, fill: "none", stroke: "var(--ours)", "stroke-width": 2.2, "stroke-dasharray": "3 2", opacity: 0.6}));
        d2.appendChild(svg("text", {x: 214, y: y + 28, "text-anchor": "middle"}, "expires on the way: NAT B untouched"));
        ok(d2, 470, y - 2);
      }
    });

    // 3 · APD replies leave from a new port
    var d3 = dg(520, 170, "Under APD mapping the reply leaves from a new port, which the other side's strict filter drops");
    rtr(d3, 60, 70, "L"); rtr(d3, 460, 70, "S");
    d3.appendChild(svg("text", {x: 36, y: 30}, "L: lenient filter, APD mapping"));
    d3.appendChild(svg("text", {x: 484, y: 30, "text-anchor": "end"}, "S: strict filter"));
    d3.appendChild(svg("path", {d: "M434 62H92", stroke: "var(--ours)", "stroke-width": 2.5}));
    d3.appendChild(svg("path", {d: "M98 56l-8 6l8 6", stroke: "var(--ours)", "stroke-width": 2.5, fill: "none"}));
    d3.appendChild(svg("text", {class: "mono", x: 260, y: 54, "text-anchor": "middle", style: "font-size:13px"}, "probe from S:5000 → L"));
    d3.appendChild(svg("path", {d: "M88 80H420", stroke: "var(--ice)", "stroke-width": 2.5, "stroke-dasharray": "6 4"}));
    d3.appendChild(svg("text", {class: "mono", x: 260, y: 102, "text-anchor": "middle", style: "font-size:13px"}, "reply leaves L from a NEW port :6113"));
    cross(d3, 426, 80);
    d3.appendChild(svg("text", {class: "strong", x: 260, y: 148, "text-anchor": "middle"}, "S only accepts the port it sent to → dropped"));

    // 4 · port blocks
    var d4 = dg(520, 170, "A 512-port block is a tiny slice of the 64,512-port range");
    d4.appendChild(svg("text", {x: 10, y: 22}, "all " + Demo.fmtInt(Demo.S.R_SPACE) + " ports"));
    d4.appendChild(svg("rect", {x: 10, y: 32, width: 500, height: 20, rx: 4, fill: "var(--surface)", stroke: "var(--axis)"}));
    var bx = 10 + (40960 - 1024) / 64512 * 500;
    d4.appendChild(svg("rect", {x: bx, y: 28, width: 4, height: 28, fill: "var(--ours)"}));
    d4.appendChild(svg("path", {d: "M" + bx + " 58L110 92M" + (bx + 4) + " 58L410 92", stroke: "var(--axis)", fill: "none"}));
    d4.appendChild(svg("rect", {x: 110, y: 92, width: 300, height: 26, rx: 4, fill: "var(--ours-wash)", stroke: "var(--ours)"}));
    d4.appendChild(svg("text", {class: "strong", x: 260, y: 110, "text-anchor": "middle"}, "one " + D.notes.blockSize + "-port block (40960–41471)"));
    d4.appendChild(svg("text", {x: 260, y: 150, "text-anchor": "middle"}, "spray N = M = " + bt.aware.nOpen + " here, instead of " + bt.unaware.nOpen + " + " + Demo.fmtInt(bt.unaware.mProbe) + " over everything"));

    var ga = document.getElementById("findings-a"), gb = document.getElementById("findings-b");
    ga.appendChild(card(1, "Discovery tests contaminate each other",
      "On a shared socket, running the mapping test first made strict filters look lenient. Running the filtering test first made Linux EI NATs look symmetric: its unanswered replies leave conntrack entries.",
      "run the filtering test on its own socket.",
      ["Simulator, mapping first: " + n.sharedSocketWeek3.before + " → " + n.sharedSocketWeek3.after + " after reordering", "Final profiler: " + D.accuracy.ok + "/" + D.accuracy.n], d1));
    ga.appendChild(card(2, "Linux conntrack breaks naive simultaneous open",
      "A punch that reaches the far NAT before that peer has sent anything leaves an UNREPLIED conntrack entry, and the NAT then re-maps the peer's own port (seen in /proc/net/nf_conntrack).",
      "send the first packets with TTL " + n.openTtl + ": they open our own mapping but expire before the far NAT.",
      ["Port " + n.conntrackRemap.before + " became " + n.conntrackRemap.after, "PR/PR and PR/Sym: aioice " + aiPR + "/" + nPR + ", ours " + adPR + "/" + nPR], d2));
    gb.appendChild(card(3, "Replies under APD mapping leave from a new port",
      "A lenient side with APD mapping answers from a brand-new port, which a strict filter on the other side drops. Some pairings that look feasible therefore cannot work.",
      "the strategy engine sends those pairings straight to the relay.",
      ["Relay in " + Demo.fmtTime(relay.tMed) + " median, not " + Demo.fmtTime(D.sim.ice.relayTMed),
       "ICE went direct in " + iceDirectOnRelayPairs + " of those " + relay.n + " calls too"], d3));
    gb.appendChild(card(4, "Port blocks make spraying cheap and predictable",
      "Carrier-grade NATs often give each customer one block of ports. Detecting it shrinks the search space about " + Math.round(Demo.S.R_SPACE / D.notes.blockSize) +
      "-fold with the same success rate.",
      "detect the block from the profiler's 12 ports and size the spray for it.",
      [Math.round(bt.aware.pktsMed) + " vs " + Demo.fmtInt(bt.unaware.pktsMed) + " packets on the real NAT (" + (bt.unaware.pktsMed / bt.aware.pktsMed).toFixed(1) + "× fewer)",
       bt.aware.pktsMin + "–" + bt.aware.pktsMax + " every time vs " + bt.unaware.pktsMin + "–" + Demo.fmtInt(bt.unaware.pktsMax),
       D.blocks.sim.packetReduction.toFixed(1) + "× fewer in simulation"], d4));
  }

  Demo.inits.push(function () {
    var D = Demo.DATA;
    panelA(D); panelB(D); panelCD(D); panelE(D); panelF(D); findings(D);
  });
})();
