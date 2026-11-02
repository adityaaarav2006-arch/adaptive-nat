/*
 * app.js - shared helpers, navigation / presenter mode, and the title, strategy and
 * birthday-paradox sections. Every measured number is read from window.DEMO_DATA
 * (demo/data.js, written by tools/export_demo_data.py); decision rules come from strategy.js.
 */
(function () {
  "use strict";

  var DATA = window.DEMO_DATA;
  var S = window.NATStrategy;
  var Demo = window.Demo = {DATA: DATA, S: S, inits: [], state: {}, handlers: {}};
  var SVGNS = "http://www.w3.org/2000/svg";

  // ───────────────────────────────────────────────────────── DOM helpers
  function append(node, kids) {
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(node, k);
      else node.appendChild(typeof k === "object" ? k : document.createTextNode(String(k)));
    }
    return node;
  }
  function setAttrs(node, attrs, isSvg) {
    for (var key in attrs) {
      var v = attrs[key];
      if (v == null || v === false) continue;
      if (key === "text") node.textContent = v;
      else if (key === "html") node.innerHTML = v;
      else if (key.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(key.slice(2), v);
      else if (key === "class" && !isSvg) node.className = v;
      else node.setAttribute(key, v === true ? "" : v);
    }
  }
  Demo.el = function (tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) setAttrs(n, attrs, false);
    return append(n, [].slice.call(arguments, 2));
  };
  Demo.svg = function (tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) setAttrs(n, attrs, true);
    return append(n, [].slice.call(arguments, 2));
  };
  Demo.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  var el = Demo.el, svg = Demo.svg;

  // ───────────────────────────────────────────────────────── formatting
  Demo.fmtTime = function (s) {
    if (s == null || isNaN(s)) return "–";
    if (s === 0) return "0 ms";
    if (s < 0.01) return (s * 1000).toFixed(1) + " ms";
    if (s < 1) return Math.round(s * 1000) + " ms";
    if (s < 10) return s.toFixed(2) + " s";
    return s.toFixed(1) + " s";
  };
  // the format used in the paper's testbed table (whole milliseconds)
  Demo.fmtTimePaper = function (s) {
    return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(1) + " s";
  };
  Demo.fmtPct = function (x, d) {
    if (x == null || isNaN(x)) return "–";
    if (x === 100 || x === 0) return x + "%";
    return x.toFixed(d == null ? 1 : d) + "%";
  };
  Demo.fmtInt = function (n) { return n == null ? "–" : Math.round(n).toLocaleString("en-US"); };
  Demo.frac = function (o) { return o.ok != null ? o.ok + "/" + o.n : o.direct + "/" + o.n; };

  Demo.rng = function (seed) {   // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  Demo.reduced = !!(mq && mq.matches);
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { Demo.reduced = mq.matches; });

  Demo.on = function (ev, fn) { (Demo.handlers[ev] = Demo.handlers[ev] || []).push(fn); };
  Demo.emit = function (ev, arg) { (Demo.handlers[ev] || []).forEach(function (fn) { fn(arg); }); };
  Demo.css = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };

  Demo.icon = {
    check: function (cls) {
      return svg("svg", {viewBox: "0 0 20 20", class: "st " + (cls || ""), "aria-hidden": "true"},
        svg("circle", {cx: 10, cy: 10, r: 9, fill: "var(--good)"}),
        svg("path", {d: "M5.5 10.5l3 3 6-6.5", fill: "none", stroke: "#fff", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round"}));
    },
    cross: function (cls) {
      return svg("svg", {viewBox: "0 0 20 20", class: "st " + (cls || ""), "aria-hidden": "true"},
        svg("circle", {cx: 10, cy: 10, r: 8.5, fill: "none", stroke: "var(--muted)", "stroke-width": 1.5}),
        svg("path", {d: "M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4", stroke: "var(--muted)", "stroke-width": 1.8, "stroke-linecap": "round"}));
    },
    dash: function (cls) {
      return svg("svg", {viewBox: "0 0 20 20", class: "st " + (cls || ""), "aria-hidden": "true"},
        svg("circle", {cx: 10, cy: 10, r: 8.5, fill: "none", stroke: "var(--axis)", "stroke-width": 1.5, "stroke-dasharray": "3 3"}));
    },
    tick: function () {
      return svg("svg", {viewBox: "0 0 20 20", "aria-hidden": "true"}, svg("path", {d: "M4 10.5l4 4 8-9"}));
    }
  };

  // ───────────────────────────────────────────────────────── tooltip
  var tipEl;
  function showTip(target, x, y) {
    var html = target.getAttribute("data-tip");
    if (!html) return;
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    var r = tipEl.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
    var top = y - r.height - 12;
    if (top < 60) top = y + 18;
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }
  function initTooltip() {
    tipEl = document.getElementById("tooltip");
    document.addEventListener("pointermove", function (e) {
      var t = e.target.closest && e.target.closest("[data-tip]");
      if (t) showTip(t, e.clientX, e.clientY); else tipEl.hidden = true;
    });
    document.addEventListener("focusin", function (e) {
      var t = e.target.closest && e.target.closest("[data-tip]");
      if (t) { var r = t.getBoundingClientRect(); showTip(t, r.left + r.width / 2, r.top); }
    });
    document.addEventListener("focusout", function () { tipEl.hidden = true; });
    window.addEventListener("scroll", function () { tipEl.hidden = true; }, {passive: true});
  }

  // ───────────────────────────────────────────────────────── navigation & presenter mode
  var slides, groups = [], current = 0;
  function slideIndexInView() {
    var bar = document.getElementById("topbar").offsetHeight;
    var best = 0;
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].getBoundingClientRect().top <= bar + window.innerHeight * 0.35) best = i;
    }
    return best;
  }
  function updateProgress() {
    current = slideIndexInView();
    var g = slides[current].getAttribute("data-group");
    groups.forEach(function (link) {
      var lg = +link.getAttribute("data-group");
      link.classList.toggle("current", String(lg) === g);
      link.classList.toggle("done", lg < +g);
      if (String(lg) === g) {
        var inGroup = slides.filter(function (s) { return s.getAttribute("data-group") === g; });
        var label = link.getAttribute("data-label");
        if (inGroup.length > 1) label += " " + (inGroup.indexOf(slides[current]) + 1) + "/" + inGroup.length;
        link.querySelector(".pl").textContent = label;
        link.setAttribute("aria-current", "step");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    document.getElementById("progress-fill").style.width = ((current + 1) / slides.length * 100) + "%";
    Demo.emit("slide", slides[current].id);
  }
  Demo.go = function (i, instant) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    var bar = document.getElementById("topbar").offsetHeight;
    var y = slides[i].getBoundingClientRect().top + window.scrollY - bar;
    window.scrollTo({top: Math.max(0, y), behavior: instant || Demo.reduced ? "auto" : "smooth"});
    current = i;
  };
  function setPresenter(on) {
    var keep = current;
    document.documentElement.classList.toggle("presenter", on);
    document.getElementById("btn-present").setAttribute("aria-pressed", on ? "true" : "false");
    Demo.emit("layout");
    requestAnimationFrame(function () { Demo.go(keep, true); });
  }
  function isPresenter() { return document.documentElement.classList.contains("presenter"); }
  var presenterBeforeFull = false;
  function toggleFull() {
    if (!document.fullscreenElement) {
      presenterBeforeFull = isPresenter();
      var p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(function () {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var b = document.getElementById("btn-theme");
    b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    try { localStorage.setItem("nat-demo-theme", t); } catch (e) { /* storage unavailable */ }
    Demo.emit("theme", t);
  }
  function primaryAction() {
    var b = slides[current].querySelector("[data-primary]");
    if (b && !b.disabled) b.click();
  }

  function initNav() {
    slides = [].slice.call(document.querySelectorAll(".slide"));
    var nav = document.getElementById("progress");
    var seen = {};
    slides.forEach(function (s) {
      var g = s.getAttribute("data-group");
      if (seen[g]) return;
      seen[g] = true;
      var label = {1: "Overview", 2: "Problem", 3: "Profiling", 4: "Choosing", 5: "Connecting", 6: "Birthday paradox",
                   7: "Results", 8: "Findings", 9: "Limitations"}[g];
      var a = el("a", {href: "#" + s.id, "data-group": g, "data-label": label, title: label,
                       onclick: function (e) { e.preventDefault(); Demo.go(slides.indexOf(s)); }},
        el("span", {class: "pn"}, g), el("span", {class: "pl"}, label));
      nav.appendChild(a);
      groups.push(a);
    });
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; updateProgress(); });
    }, {passive: true});
    window.addEventListener("resize", updateProgress);
    updateProgress();

    var help = document.getElementById("help");
    document.getElementById("btn-help").addEventListener("click", function () { help.showModal(); });
    document.getElementById("btn-present").addEventListener("click", function () { setPresenter(!isPresenter()); });
    document.getElementById("btn-full").addEventListener("click", toggleFull);
    document.getElementById("btn-theme").addEventListener("click", function () {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
    document.addEventListener("fullscreenchange", function () {
      setPresenter(document.fullscreenElement ? true : presenterBeforeFull);
    });

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || help.open) return;
      var t = e.target, tag = t.tagName;
      var inForm = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || t.isContentEditable;
      var k = e.key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") {
        if (inForm && k !== "PageDown") return;
        e.preventDefault(); Demo.go(current + 1);
      } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
        if (inForm && k !== "PageUp") return;
        e.preventDefault(); Demo.go(current - 1);
      } else if (k === "Home" || k === "End") {
        if (inForm) return;
        e.preventDefault(); Demo.go(k === "Home" ? 0 : slides.length - 1);
      } else if (k === " " || k === "n" || k === "N") {
        if (inForm || tag === "BUTTON" || tag === "A") return;
        e.preventDefault(); primaryAction();
      } else if (k === "f" || k === "F") {
        if (inForm) return;
        toggleFull();
      } else if (k === "p" || k === "P") {
        if (inForm) return;
        setPresenter(!isPresenter());
      } else if (k === "t" || k === "T") {
        if (inForm) return;
        setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
      } else if (k === "?") {
        help.showModal();
      }
    });
  }

  // ───────────────────────────────────────────────────────── 1 · title
  function tileBars(rows, max) {
    return el("div", {class: "tile-bars", "aria-hidden": "true"}, rows.map(function (r) {
      return el("div", {class: "tile-bar"}, el("span", {style: "width:" + Math.max(1.5, r[0] / max * 100) + "%;background:var(" + r[1] + ")"}));
    }));
  }
  function tileRow(who, sw, val, small) {
    return el("div", {class: "tile-row"},
      el("span", {class: "tile-who"}, el("span", {class: "sw " + sw}), who),
      el("span", {class: "tile-val" + (small ? " small" : "")}, val));
  }
  function initTitle() {
    var m = DATA.meta;
    document.getElementById("t-course").textContent = m.course + " · Project review";
    document.getElementById("t-title").textContent = m.title;
    document.getElementById("t-subtitle").textContent = m.subtitle;
    var au = document.getElementById("t-authors");
    m.authors.forEach(function (a, i) {
      if (i) au.appendChild(el("span", {class: "sep"}, "·"));
      append(au, [a.name + " ", el("span", {class: "reg"}, a.reg)]);
    });
    append(au, [el("span", {class: "sep"}, "·"), "Guide: " + m.guide]);

    var sim = DATA.sim, tb = DATA.testbed, acc = DATA.accuracy, accb = DATA.accuracyBlocks;
    var tiles = document.getElementById("tiles");
    append(tiles, [
      el("div", {class: "card tile"},
        el("div", {class: "tile-label"}, "Calls connected directly, in simulation (" + sim.sessionsPerAgent + " calls each)"),
        tileRow("Ours", "sw-ours", Demo.fmtPct(sim.adaptive.direct)),
        tileRow("ICE", "sw-ice", Demo.fmtPct(sim.ice.direct), true),
        tileBars([[sim.adaptive.direct, "--ours"], [sim.ice.direct, "--ice"]], 100),
        el("div", {class: "tile-note"}, sim.pairings + " router pairings × " + sim.trials + " trials")),
      el("div", {class: "card tile"},
        el("div", {class: "tile-label"}, "Median time until the call has a working path"),
        tileRow("Ours", "sw-ours", Demo.fmtTime(sim.adaptive.tMed)),
        tileRow("ICE", "sw-ice", Demo.fmtTime(sim.ice.tMed), true),
        tileBars([[sim.adaptive.tMed, "--ours"], [sim.ice.tMed, "--ice"]], sim.ice.tMed),
        el("div", {class: "tile-note"}, "Simulation; clock starts once both peers have swapped details")),
      el("div", {class: "card tile"},
        el("div", {class: "tile-label"}, "Direct connections through real Linux NATs"),
        tileRow("Ours", "sw-ours", tb.adaptive.direct + "/" + tb.adaptive.n),
        tileRow("aioice", "sw-ice", tb.aioice.direct + "/" + tb.aioice.n, true),
        tileBars([[tb.adaptive.direct, "--ours"], [tb.aioice.direct, "--ice"]], tb.adaptive.n),
        el("div", {class: "tile-note"}, tb.rows.length + " pairings × " + tb.trials + " runs, kernel NAT + conntrack")),
      el("div", {class: "card tile"},
        el("div", {class: "tile-label"}, "Profiler accuracy: router behaviour identified correctly"),
        tileRow("Ours", "sw-ours", acc.ok + "/" + acc.n),
        el("div", {class: "tile-row"}, el("span", {class: "tile-who"}, "Port blocks"), el("span", {class: "tile-val small"}, accb.ok + "/" + accb.n)),
        tileBars([[acc.ok, "--good"], [accb.ok / accb.n * acc.n, "--good"]], acc.n),
        el("div", {class: "tile-note"}, acc.configs.length + " router types × " + acc.reps + " runs, plus " + accb.configs.length + " block types × " + accb.reps))
    ]);
  }

  // ───────────────────────────────────────────────────────── profiles shared by sections 4 and 5
  var BLOCK = [40960, 512];   // illustrative block position: the testbed NAT used ports 40960-41471
  Demo.BLOCK = BLOCK;
  var PRESETS = [
    {id: "fc", name: "Full cone", p: {mapping: "EI", filtering: "EI", alloc: "random"}},
    {id: "rc", name: "Restricted cone", p: {mapping: "EI", filtering: "AD", alloc: "random"}},
    {id: "pr", name: "Port-restricted", p: {mapping: "EI", filtering: "APD", alloc: "random"}},
    {id: "sseq", name: "Symmetric, +1", p: {mapping: "APD", filtering: "APD", alloc: "sequential"}},
    {id: "sfix", name: "Symmetric, step", p: {mapping: "APD", filtering: "APD", alloc: "fixed-delta"}},
    {id: "srand", name: "Symmetric, random", p: {mapping: "APD", filtering: "APD", alloc: "random"}},
    {id: "adrand", name: "Lenient, random", p: {mapping: "AD", filtering: "AD", alloc: "random"}},
    {id: "cgn", name: "Carrier-grade block", p: {mapping: "APD", filtering: "APD", alloc: "block"}}
  ];
  Demo.PRESETS = PRESETS;
  Demo.toProfile = function (p) {
    var ei = p.mapping === "EI";
    return {mapping: p.mapping, filtering: p.filtering,
            allocation: ei ? null : (p.alloc === "block" ? "random" : p.alloc),
            block: !ei && p.alloc === "block" ? BLOCK.slice() : null};
  };
  var MAP_TXT = {EI: "keeps one public port for every destination", AD: "opens a new public port for each destination address",
                 APD: "opens a new public port for each destination address and port"};
  var FIL_TXT = {EI: "lets in packets from anyone", AD: "lets in packets from any port of an address it has contacted",
                 APD: "lets in packets only from the exact address and port it contacted"};
  var ALLOC_TXT = {"sequential": "next port (+1)", "fixed-delta": "ports in fixed steps", "random": "random ports",
                   "block": "random ports inside one 512-port block"};
  Demo.MAP_TXT = MAP_TXT; Demo.FIL_TXT = FIL_TXT; Demo.ALLOC_TXT = ALLOC_TXT;
  var KIND_TXT = {fixed: "fixed", pred: "predictable", rand: "random"};
  Demo.KIND_TXT = KIND_TXT;

  Demo.state.pair = {A: {mapping: "EI", filtering: "APD", alloc: "random"},
                     B: {mapping: "APD", filtering: "APD", alloc: "random"}};

  // Look up the measured sessions for a pairing (either order: the evaluation table is symmetric).
  Demo.lookupPair = function (pa, pb) {
    var la = S.label(pa), lb = S.label(pb);
    var res = {la: la, lb: lb};
    if (pa.block && pb.block) { res.kind = "none"; return res; }
    if (pa.block || pb.block) {
      var bp = DATA.blocks.pairings[la + "|" + lb] || DATA.blocks.pairings[lb + "|" + la];
      if (bp) { res.kind = "blocks"; res.row = bp; res.ours = bp.aware; res.ice = bp.ice; res.unaware = bp.unaware; }
      else res.kind = "none";
    } else {
      var r = DATA.pairings[la + "|" + lb] || DATA.pairings[lb + "|" + la];
      if (r) { res.kind = "sim"; res.row = r; res.ours = r.adaptive; res.ours.plan = r.plan; res.ours.reason = r.reason; res.ice = r.ice; }
      else res.kind = "none";
    }
    // the same pairing on the real Linux testbed, if it was run there
    var names = {};
    for (var k in DATA.testbed.profiles) names[DATA.testbed.profiles[k]] = k;
    var ta = names[la], tbn = names[lb];
    if (ta && tbn) {
      DATA.testbed.rows.forEach(function (row) {
        if ((row.a === ta && row.b === tbn) || (row.a === tbn && row.b === ta)) res.testbed = row;
      });
      var bt = DATA.blocks.testbed;
      if ((bt.natA === ta && bt.natB === tbn) || (bt.natA === tbn && bt.natB === ta)) res.testbedBlocks = bt;
    }
    return res;
  };

  // ───────────────────────────────────────────────────────── 4 · strategy
  function sideName(l) { return "Peer " + l; }
  function explain(pa, pb, plan, trace) {
    var other = {A: "B", B: "A"};
    var kinds = {A: S.kind(pa), B: S.kind(pb)};
    var out = {};
    var order = ["DIRECT", "PREDICT", "SPRAY", "RELAY"];
    var ci = order.indexOf(plan.method);
    function state(r) { var i = order.indexOf(r); return i === ci ? "chosen" : i < ci ? "ruled" : "unreached"; }
    function list(bits) { return bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0]; }

    // DIRECT
    var notFixed = ["A", "B"].filter(function (l) { return kinds[l] !== "fixed"; });
    out.DIRECT = {state: state("DIRECT"), q: "Both ports fixed?",
      why: state("DIRECT") === "chosen"
        ? "Yes: both routers keep one port for everyone, so each side sends straight to the address STUN reported."
        : notFixed.length === 2 ? "No: both routers pick a new port for each destination."
        : "No: " + notFixed[0] + "'s router picks a new port for each destination."};

    // PREDICT
    var pw;
    if (state("PREDICT") === "chosen") {
      var lm = /^([AB]) is lenient/.exec(plan.reason);
      if (!lm) {
        pw = "Yes: both ports are fixed or predictable, so each side aims at a window of the other's next ports, which works even through strict filters.";
      } else {
        var L = lm[1], O = other[L];
        pw = "Yes: " + L + "'s filter is lenient and its port is " + KIND_TXT[kinds[L]] + ", so " + O + " aims at " +
          (kinds[L] === "fixed" ? "that port" : "its next ports") + " and " + L + " accepts packets from " + O + "'s unknown port.";
      }
    } else if (state("PREDICT") === "ruled") {
      var rnd = ["A", "B"].filter(function (l) { return kinds[l] === "rand"; });
      var bits = [rnd.length === 2 ? "both ports are random" : rnd[0] + "'s port is random"];
      trace.forEach(function (e) {
        if (e.rung !== "PREDICT" || e.test !== "lenient" || !e.predictable) return;
        if (!e.lenient) bits.push(e.side + "'s filter is strict");
        else bits.push(e.side + "'s reply would leave from a new (APD) port that " + other[e.side] + "'s strict filter drops");
      });
      pw = "No: " + list(bits) + ".";
    } else pw = "Not needed.";
    out.PREDICT = {state: state("PREDICT"), q: "Predictable ports, or a lenient side to aim at?", why: pw};

    // SPRAY
    var sw, detail = null;
    var sprayEntries = trace.filter(function (e) { return e.rung === "SPRAY"; });
    if (state("SPRAY") === "chosen") {
      var op = plan.opener, pr = other[op];
      var e0 = sprayEntries.filter(function (e) { return e.ok; })[0];
      if (plan.rangeSize < S.R_SPACE) {
        sw = "Yes: " + op + "'s random ports stay inside one " + plan.rangeSize + "-port block, so " + op + " opens " + plan.nOpen +
          " ports and " + pr + " sends " + plan.mProbe + " probes into that block.";
      } else {
        sw = "Yes: " + op + "'s port is random but " + (e0 && e0.lenient ? "its filter is lenient" : pr + "'s port is fixed, so every port " + op + " opens accepts " + pr) +
          ". " + op + " opens N ports, " + pr + " fires M probes at random ports" + (plan.capped ? " (M capped to fit " + pr + "'s port block)" : "") + ".";
      }
      detail = [["opener", op], ["N", plan.nOpen], ["M", Demo.fmtInt(plan.mProbe)],
                ["range", Demo.fmtInt(plan.rangeSize)], ["P", (plan.pSuccess * 100).toFixed(1) + "%"]];
    } else if (state("SPRAY") === "ruled") {
      var sb = [];
      sprayEntries.forEach(function (e) {
        if (!e.random) return;
        if (e.budgetTooSmall) sb.push("the packet budget leaves " + e.side + " no probes");
        else if (!e.canOpen) sb.push(e.side + "'s random port sits behind a strict filter and " + other[e.side] + "'s port is not fixed");
        else if (!e.replyOk) sb.push(e.side + "'s answer to a hit would leave from a new (APD) port that " + other[e.side] + "'s strict filter drops");
      });
      sw = "No: " + list(sb) + ".";
    } else sw = "Not needed.";
    out.SPRAY = {state: state("SPRAY"), q: "A random side that can open ports for the other to hit?", why: sw, detail: detail};

    // RELAY
    var relayM = DATA.sim.methods.filter(function (m) { return m.method === "RELAY"; })[0];
    var budget = /budget/.test(plan.reason);
    out.RELAY = {state: state("RELAY"), q: "Otherwise:",
      why: state("RELAY") === "chosen"
        ? (budget ? "relay, because a spray would need more packets than the budget allows."
          : "nothing above can work, so go straight to the relay instead of trying for " + DATA.notes.tBudget + " s.")
        : "relay (leased in advance as a fallback).",
      detail: state("RELAY") === "chosen" && !budget ? [["measured median time to relay", Demo.fmtTime(relayM.tMed)]] : null};
    return out;
  }

  function peerCard(l) {
    var st = Demo.state.pair[l];
    var preset = el("select", {"aria-label": "Peer " + l + " preset", class: "sel-preset"},
      PRESETS.map(function (p) { return el("option", {value: p.id}, p.name); }), el("option", {value: "custom"}, "Custom"));
    var sm = el("select", {"aria-label": "Peer " + l + " mapping", title: "Mapping: how the router picks its public port"},
      el("option", {value: "EI"}, "EI"), el("option", {value: "AD"}, "AD"), el("option", {value: "APD"}, "APD"));
    var sf = el("select", {"aria-label": "Peer " + l + " filtering", title: "Filtering: which incoming packets the router lets in"},
      el("option", {value: "EI"}, "EI"), el("option", {value: "AD"}, "AD"), el("option", {value: "APD"}, "APD"));
    var sa = el("select", {"aria-label": "Peer " + l + " port allocation", title: "Allocation: how new public ports are chosen"},
      el("option", {value: "sequential"}, "Sequential"), el("option", {value: "fixed-delta"}, "Fixed step"),
      el("option", {value: "random"}, "Random"), el("option", {value: "block"}, "512-block"));
    var desc = el("div", {class: "peer-desc"});
    function sync() {
      sm.value = st.mapping; sf.value = st.filtering; sa.value = st.alloc;
      sa.disabled = st.mapping === "EI";
      var match = PRESETS.filter(function (p) {
        return p.p.mapping === st.mapping && p.p.filtering === st.filtering && (st.mapping === "EI" || p.p.alloc === st.alloc);
      })[0];
      preset.value = match ? match.id : "custom";
      var prof = Demo.toProfile(st);
      var k = S.kind(prof);
      Demo.clear(desc);
      desc.setAttribute("data-tip", "The router " + MAP_TXT[st.mapping] + (st.mapping === "EI" ? "" : " (" + ALLOC_TXT[st.alloc] + ")") +
        " and " + FIL_TXT[st.filtering] + ".");
      append(desc, [el("span", {class: "chip"}, S.label(prof)),
        el("b", null, "port " + KIND_TXT[k]), ", ", el("b", null, "filter " + (S.lenient(prof) ? "lenient" : "strict")),
        el("span", {class: "muted"}, st.mapping === "EI" ? " · one port for everyone" :
          " · per " + (st.mapping === "AD" ? "address" : "address+port") + ", " + {"sequential": "+1", "fixed-delta": "fixed step", "random": "random", "block": "512-block"}[st.alloc])]);
    }
    preset.addEventListener("change", function () {
      var p = PRESETS.filter(function (x) { return x.id === preset.value; })[0];
      if (!p) return;
      st.mapping = p.p.mapping; st.filtering = p.p.filtering; st.alloc = p.p.alloc;
      sync(); Demo.emit("pair");
    });
    [[sm, "mapping"], [sf, "filtering"], [sa, "alloc"]].forEach(function (x) {
      x[0].addEventListener("change", function () { st[x[1]] = x[0].value; sync(); Demo.emit("pair"); });
    });
    sync();
    return el("div", {class: "card peer"},
      el("div", {class: "peer-name"}, el("span", {class: "sw", style: "background:var(--ink-2)"}), "Peer " + l),
      el("div", {class: "peer-sels"}, el("label", {class: "field"}, "Preset", preset), el("label", {class: "field"}, "Mapping", sm),
        el("label", {class: "field"}, "Filter", sf), el("label", {class: "field"}, "Ports", sa)), desc);
  }

  function dots(k, n) {
    var d = el("span", {class: "dots", "aria-hidden": "true"});
    for (var i = 0; i < n; i++) d.appendChild(el("i", {class: i < k ? "on" : ""}));
    return d;
  }
  Demo.dots = dots;
  function methodChip(m) { return el("span", {class: "method-chip" + (m === "RELAY" ? " relay" : "")}, m); }
  Demo.methodChip = methodChip;

  function renderMeasured(pa, pb, plan) {
    var box = Demo.clear(document.getElementById("measured"));
    var r = Demo.lookupPair(pa, pb);
    box.appendChild(el("h3", null, "Measured for this exact pairing ",
      el("span", {class: "tag tag-measured"}, Demo.icon.tick(), "Measured")));
    if (r.kind === "none") {
      box.appendChild(el("p", {class: "mc-note", style: "font-size:.95rem;color:var(--ink-2)"},
        "Two port-block routers were not paired in our runs, so there is no measurement for this pairing. The decision on the left still follows strategy.py."));
      return;
    }
    var cols = [["Our agent", "sw-ours", r.ours]];
    if (r.kind === "blocks") cols.push(["Ours, block-unaware", "sw-unaware", r.unaware]);
    cols.push(["ICE baseline", "sw-ice", r.ice]);
    var grid = el("div", {class: "mc-grid", style: "--cols:" + cols.length});
    function row(label, fn, head) {
      grid.appendChild(el("div", {class: "mc-row" + (head ? " mc-head" : "")}, el("span", null, label),
        cols.map(function (c) { return el("span", {class: head ? "" : "mc-val"}, fn(c)); })));
    }
    row("", function (c) { return [el("span", {class: "sw " + c[1]}), c[0]]; }, true);
    row("Direct path", function (c) { return [dots(c[2].direct, c[2].n), c[2].direct + "/" + c[2].n]; });
    row("Median time", function (c) { return Demo.fmtTime(c[2].tMed); });
    row("Median packets", function (c) { return Demo.fmtInt(c[2].pktsMed); });
    box.appendChild(grid);
    var same = r.ours.plan === plan.method;
    box.appendChild(el("div", {class: "check-line" + (same ? "" : " bad")}, same ? Demo.icon.check() : Demo.icon.cross(),
      same ? "The measured runs chose the same method (" + plan.method + ")." : "Measured runs chose " + r.ours.plan + ": check strategy.js!"));
    box.appendChild(el("p", {class: "mc-note"}, r.ours.n + " simulated trials (" + (r.kind === "blocks" ? "evaluation_blocks.csv" : "evaluation_results.csv") +
      "), run as A = " + r.row.a + ", B = " + r.row.b + ". The table is symmetric, so A/B order does not matter."));
    if (r.testbed) {
      var t = r.testbed;
      box.appendChild(el("p", {class: "mc-note"}, el("b", null, "Also on real Linux NATs (" + t.label + "): "),
        "ours " + t.adaptive.direct + "/" + t.adaptive.n + " direct, median " + Demo.fmtTimePaper(t.adaptive.tMed) +
        "; aioice " + t.aioice.direct + "/" + t.aioice.n + ", median " + Demo.fmtTimePaper(t.aioice.tMed) + "."));
    }
    if (r.testbedBlocks) {
      var b = r.testbedBlocks;
      box.appendChild(el("p", {class: "mc-note"}, el("b", null, "Also on the real block NAT: "),
        "block-aware " + b.aware.direct + "/" + b.aware.n + " (median " + Math.round(b.aware.pktsMed) + " packets), block-unaware " +
        b.unaware.direct + "/" + b.unaware.n + " (" + Math.round(b.unaware.pktsMed) + "), aioice " + b.aioice.direct + "/" + b.aioice.n + "."));
    }
  }

  function renderStrategy() {
    var st = Demo.state.pair;
    var pa = Demo.toProfile(st.A), pb = Demo.toProfile(st.B);
    var trace = [];
    var plan = S.choose(pa, pb, {}, trace);
    Demo.state.plan = plan;
    var ex = explain(pa, pb, plan, trace);
    var lad = Demo.clear(document.getElementById("ladder"));
    var cost = {DIRECT: "cheapest", PREDICT: "a few dozen packets", SPRAY: "hundreds of packets", RELAY: "server bandwidth"};
    ["DIRECT", "PREDICT", "SPRAY", "RELAY"].forEach(function (r) {
      var e = ex[r];
      var icon = e.state === "chosen" ? Demo.icon.check() : e.state === "ruled" ? Demo.icon.cross() : Demo.icon.dash();
      var body = el("div", {class: "rung-body"}, el("span", {class: "rung-q"}, e.q), el("span", {class: "rung-why"}, e.why));
      if (e.detail) {
        body.appendChild(el("div", {class: "rung-detail"}, e.detail.map(function (kv) {
          return el("span", {class: "kv"}, kv[0] + " ", el("b", null, String(kv[1])));
        })));
      }
      lad.appendChild(el("li", {class: "rung " + e.state, "aria-label": r + ": " + e.state},
        el("div", {class: "rung-name"}, icon, r), el("div", {class: "rung-cost"}, cost[r]), body));
    });
    renderMeasured(pa, pb, plan);
  }

  function initStrategy() {
    var peers = document.getElementById("peers");
    peers.appendChild(peerCard("A"));
    peers.appendChild(peerCard("B"));
    Demo.on("pair", renderStrategy);
    renderStrategy();
  }

  // ───────────────────────────────────────────────────────── 6 · birthday paradox
  function initBirthday() {
    var R_FULL = S.R_SPACE, R_BLOCK = DATA.notes.blockSize;
    var st = {N: DATA.notes.nOpenDefault, M: DATA.notes.packetBudget - 2 * DATA.notes.nOpenDefault, R: R_FULL, seed: 7};
    var box = document.getElementById("bday-controls");
    function slider(id, label, max, sub) {
      var inp = el("input", {type: "range", id: id, min: 1, max: max, step: 1});
      var out = el("output", {for: id});
      var wrap = el("div", {class: "slider"}, el("label", {for: id}, label), out, inp, el("div", {class: "sub opt-hide"}, sub));
      return {wrap: wrap, inp: inp, out: out};
    }
    var sN = slider("bd-n", "N: ports opened by the opener", 2048, "Each opening packet creates one new mapping on the opener's NAT.");
    var sM = slider("bd-m", "M: probes sent by the prober", 4096, "Each probe goes to one random port in the search space.");
    var segR = el("div", {class: "seg", role: "group", "aria-label": "Search space R"});
    var bFull = el("button", {type: "button"}, "Full range " + Demo.fmtInt(R_FULL));
    var bBlk = el("button", {type: "button"}, R_BLOCK + "-port block");
    append(segR, [bFull, bBlk]);
    var fEq = el("div", {class: "f-eq"});
    var fP = el("div", {class: "f-p", "aria-live": "polite"});
    var fPk = el("div", {class: "f-pk"});
    var formula = el("div", {class: "formula"}, fEq, fP, fPk);
    var spray = DATA.sim.methods.filter(function (m) { return m.method === "SPRAY"; })[0];
    var bs = DATA.blocks.sim;
    function presetBtn(name, n, m, r, model) {
      return el("button", {class: "btn", type: "button", onclick: function () { st.N = n; st.M = m; st.R = r; st.seed++; update(); }},
        name, el("span", {class: "pv"}, "N=" + n + ", M=" + m + " → ~" + (100 * (1 - Math.exp(-n * m / r))).toFixed(1) + "%"));
    }
    var nb = S.blockSpraySize(R_BLOCK);
    var presets = el("div", {class: "presets"},
      presetBtn("Full range", DATA.notes.nOpenDefault, DATA.notes.packetBudget - 2 * DATA.notes.nOpenDefault, R_FULL),
      presetBtn(R_BLOCK + "-block", nb, nb, R_BLOCK));
    var measured = el("p", {class: "footnote"},
      el("b", null, "Measured: "), "spraying gave a direct path in " + Demo.fmtPct(spray.direct) + " of " + spray.n +
      " simulated sessions (formula " + (100 * spray.pModel).toFixed(1) + "%); block-aware spraying in " + Demo.fmtPct(bs.aware.direct) +
      " of " + DATA.blocks.blockSessions + " (formula " + (100 * bs.modelPAware).toFixed(1) + "%).");
    append(box, [sN.wrap, sM.wrap, el("div", {class: "slider"}, el("label", null, "R: search space"), segR), formula, presets]);

    var roll = el("button", {class: "btn btn-primary btn-sm", type: "button", "data-primary": "",
                             onclick: function () { st.seed++; draw(); }}, "Roll again");
    var trials = el("button", {class: "btn btn-sm", type: "button", onclick: runTrials}, "Run 1,000 trials");
    var hitsTxt = el("span", {class: "num-tab"});
    var trialTxt = el("span", {class: "trial footnote"});
    var lg = document.getElementById("bday-legend");
    append(lg, [el("span", {class: "legend-inline"}, el("span", {class: "sw sw-ours"}), "opened port (N)"),
      el("span", {class: "legend-inline"}, el("span", {class: "sw", style: "background:var(--ink-2);width:6px;height:6px;border-radius:50%"}), "probe (M)"),
      el("span", {class: "legend-inline"}, el("span", {class: "sw", style: "border:2.5px solid var(--good);border-radius:50%;background:transparent"}), "hit = working connection"),
      hitsTxt, roll, trials, trialTxt]);
    lg.parentNode.appendChild(measured);
    var scaleNote = el("span", {class: "footnote"});
    lg.appendChild(scaleNote);

    var canvas = document.getElementById("bday-canvas");
    var ctx = canvas.getContext("2d");
    function sample(rand, k, r) {   // k distinct ports out of r (Floyd's algorithm)
      var set = new Set();
      for (var j = r - k; j < r; j++) {
        var t = Math.floor(rand() * (j + 1));
        set.add(set.has(t) ? j : t);
      }
      return set;
    }
    function draw() {
      var rand = Demo.rng(st.seed * 7919 + st.N * 31 + st.M);
      var N = Math.min(st.N, st.R), M = Math.min(st.M, st.R);
      var opened = sample(rand, N, st.R), probes = sample(rand, M, st.R);
      var hits = [];
      probes.forEach(function (p) { if (opened.has(p)) hits.push(p); });
      var W = canvas.width, H = canvas.height;
      var c = {surface: Demo.css("--surface"), empty: Demo.css("--surface-2"), ours: Demo.css("--ours"),
               probe: Demo.css("--ink-2"), good: Demo.css("--good"), grid: Demo.css("--grid")};
      ctx.fillStyle = c.surface; ctx.fillRect(0, 0, W, H);
      var pos;
      if (st.R <= 4096) {
        var cols = 32, rows = Math.ceil(st.R / cols), cell = Math.min(W / cols, H / rows);
        var ox = (W - cols * cell) / 2, oy = (H - rows * cell) / 2;
        pos = function (p) { return [ox + (p % cols) * cell + cell / 2, oy + Math.floor(p / cols) * cell + cell / 2]; };
        for (var p = 0; p < st.R; p++) {
          var xy = pos(p);
          ctx.fillStyle = opened.has(p) ? c.ours : c.empty;
          ctx.fillRect(xy[0] - cell / 2 + 1, xy[1] - cell / 2 + 1, cell - 2, cell - 2);
          if (probes.has(p)) {
            ctx.fillStyle = opened.has(p) ? "#fff" : c.probe;
            ctx.beginPath(); ctx.arc(xy[0], xy[1], cell * 0.17, 0, 7); ctx.fill();
          }
        }
        hits.forEach(function (h) {
          var xy = pos(h);
          ctx.strokeStyle = c.good; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(xy[0], xy[1], cell * 0.62, 0, 7); ctx.stroke();
        });
      } else {
        var cw = 336, sc = W / cw;   // one port per 2x2 px cell: 336 x 192 = 64,512 ports
        pos = function (q) { return [(q % cw) * sc + sc / 2, Math.floor(q / cw) * sc + sc / 2]; };
        ctx.fillStyle = c.empty; ctx.fillRect(0, 0, W, Math.ceil(st.R / cw) * sc);
        // marks are drawn larger than one port so they stay visible on a projector
        ctx.fillStyle = c.probe; ctx.globalAlpha = 0.55;
        probes.forEach(function (q) { var xy = pos(q); ctx.beginPath(); ctx.arc(xy[0], xy[1], 1.8, 0, 7); ctx.fill(); });
        ctx.globalAlpha = 1; ctx.fillStyle = c.ours;
        opened.forEach(function (q) { var xy = pos(q); ctx.fillRect(xy[0] - 3, xy[1] - 3, 6, 6); });
        hits.forEach(function (h) {
          var xy = pos(h);
          ctx.strokeStyle = c.surface; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(xy[0], xy[1], 9, 0, 7); ctx.stroke();
          ctx.strokeStyle = c.good; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(xy[0], xy[1], 9, 0, 7); ctx.stroke();
        });
      }
      hitsTxt.textContent = "This roll: " + hits.length + (hits.length === 1 ? " hit" : " hits");
      scaleNote.textContent = st.R <= 4096 ? "One square = one port." : "Every port is drawn; marks are enlarged so they show.";
      canvas.setAttribute("aria-label", "Port space of " + st.R + " ports: " + N + " opened, " + M + " probes, " + hits.length + " hits");
    }
    function runTrials() {
      var rand = Demo.rng(st.seed * 104729 + 1);
      var mark = new Uint16Array(st.R), ok = 0, T = 1000;
      var N = Math.min(st.N, st.R), M = Math.min(st.M, st.R);
      for (var t = 1; t <= T; t++) {
        sample(rand, N, st.R).forEach(function (p) { mark[p] = t; });
        var hit = false;
        sample(rand, M, st.R).forEach(function (p) { if (mark[p] === t) hit = true; });
        ok += hit;
      }
      trialTxt.textContent = "1,000 random trials in your browser: " + (ok / 10).toFixed(1) + "% had at least one hit";
    }
    function update() {
      sN.inp.max = Math.min(2048, st.R); sM.inp.max = Math.min(4096, st.R);   // can't open or probe more ports than R
      st.N = Math.min(st.N, st.R); st.M = Math.min(st.M, st.R);
      sN.inp.value = st.N; sM.inp.value = st.M;
      sN.out.textContent = Demo.fmtInt(st.N); sM.out.textContent = Demo.fmtInt(st.M);
      bFull.setAttribute("aria-pressed", st.R === R_FULL ? "true" : "false");
      bBlk.setAttribute("aria-pressed", st.R === R_BLOCK ? "true" : "false");
      var p = 1 - Math.exp(-st.N * st.M / st.R);
      fEq.textContent = "P = 1 − e^(−N·M/R) = 1 − e^(−" + Demo.fmtInt(st.N) + "·" + Demo.fmtInt(st.M) + "/" + Demo.fmtInt(st.R) + ")";
      fP.textContent = (p * 100).toFixed(p > 0.999 ? 2 : 1) + "%";
      fPk.textContent = "Worst-case packets: 2N + M = " + Demo.fmtInt(2 * st.N + st.M) + " (the opener sends its N opening packets up to twice)";
      trialTxt.textContent = "";
      draw();
    }
    sN.inp.addEventListener("input", function () { st.N = +sN.inp.value; update(); });
    sM.inp.addEventListener("input", function () { st.M = +sM.inp.value; update(); });
    bFull.addEventListener("click", function () { st.R = R_FULL; update(); });
    bBlk.addEventListener("click", function () { st.R = R_BLOCK; update(); });
    Demo.on("theme", draw);
    update();
  }

  // ───────────────────────────────────────────────────────── provenance
  function initProvenance() {
    var box = document.getElementById("provenance");
    var all = DATA.checks.concat(DATA.crossChecks);
    var ok = all.filter(function (c) { return c.pass; }).length;
    append(box, [
      el("p", null, "Every number on this page is read from ", el("span", {class: "mono"}, "data.js"), ", generated ",
        DATA.generated.replace("T", " "), " by ", el("span", {class: "mono"}, "tools/export_demo_data.py"), " from ",
        DATA.sources.length + " result files. ",
        el("span", {class: ok === all.length ? "ok" : "warn"}, ok + "/" + all.length + " export checks passed.")),
      el("p", {style: "margin-top:.4rem"}, "Not from a result file: the Week-3 12/15 → 15/15 profiler run (profiler.py docstring), the conntrack port change and the 6 aioice reruns (team lab notes).")
    ]);
  }

  function dataMissing() {
    document.getElementById("main").prepend(el("div", {class: "data-error"},
      el("h2", null, "data.js is missing or empty"),
      el("p", null, "Run ", el("span", {class: "mono"}, "python tools/export_demo_data.py"), " from the repository root, then reload.")));
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTooltip();
    try { var saved = localStorage.getItem("nat-demo-theme"); if (saved === "dark") setTheme("dark"); } catch (e) { /* ignore */ }
    if (!DATA || !S) { dataMissing(); initNav(); return; }
    initTitle();
    initStrategy();
    initBirthday();
    initProvenance();
    Demo.inits.forEach(function (fn) { fn(); });
    initNav();
  });
})();
