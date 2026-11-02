/*
 * anim.js - the three animated sections: the problem (2), profiling (3) and connecting (5).
 * Animations illustrate the mechanism; the only numbers shown are read from DEMO_DATA.
 */
(function () {
  "use strict";
  var Demo = window.Demo, el = Demo.el, svg = Demo.svg, S = Demo.S;

  // ───────────────────────────────────────────────────────── primitives
  function pathLen(pts) {
    var segs = [], total = 0;
    for (var i = 1; i < pts.length; i++) {
      var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(l); total += l;
    }
    return {segs: segs, total: total};
  }
  function pointAt(pts, pl, k) {
    var d = k * pl.total;
    for (var i = 0; i < pl.segs.length; i++) {
      if (d <= pl.segs[i] || i === pl.segs.length - 1) {
        var f = pl.segs[i] ? Math.min(1, d / pl.segs[i]) : 1;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
      d -= pl.segs[i];
    }
    return pts[pts.length - 1];
  }
  function wait(ms, alive) {
    if (Demo.reduced) ms = Math.min(ms, 30);
    return new Promise(function (res) { setTimeout(function () { res(alive()); }, ms); });
  }
  function xmark(layer, p, size, keep) {
    var s = size || 9;
    var g = svg("path", {class: "xmark", d: "M" + (p[0] - s) + " " + (p[1] - s) + "l" + 2 * s + " " + 2 * s + "M" + (p[0] + s) + " " + (p[1] - s) + "l" + -2 * s + " " + 2 * s});
    layer.appendChild(g);
    if (!keep) setTimeout(function () { g.remove(); }, Demo.reduced ? 1200 : 900);
    return g;
  }
  // Fly one packet along a polyline. fate: "arrive" | "drop" (X at the end) | "die" (fades out: TTL expired)
  function fly(layer, pts, o, alive) {
    o = o || {};
    var dur = Demo.reduced ? 0 : (o.dur != null ? o.dur : 650);
    var c = svg("circle", {r: o.r || 8, class: "pkt " + (o.cls || "pkt-neutral")});
    var lab = o.label ? svg("text", {class: "lbl-mono", "text-anchor": "middle", style: "font-size:12px;font-weight:700"}, o.label) : null;
    layer.appendChild(c);
    if (lab) layer.appendChild(lab);
    var pl = pathLen(pts);
    return new Promise(function (res) {
      var t0 = performance.now();
      function frame(now) {
        if (!alive()) { c.remove(); if (lab) lab.remove(); res(false); return; }
        var k = dur ? Math.min(1, (now - t0) / dur) : 1;
        var p = pointAt(pts, pl, k);
        c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]);
        if (lab) { lab.setAttribute("x", p[0]); lab.setAttribute("y", p[1] - 13); }
        if (o.fate === "die") c.style.opacity = k > 0.55 ? Math.max(0, 1 - (k - 0.55) / 0.45) : 1;
        if (k < 1) { requestAnimationFrame(frame); return; }
        if (!o.keep) { c.remove(); if (lab) lab.remove(); }
        if (o.fate === "drop") xmark(layer, p, 9, o.keepX);
        res(true);
      }
      requestAnimationFrame(frame);
    });
  }
  function house(g, x, y, w, h) {
    g.appendChild(svg("path", {class: "house", d: "M" + x + " " + (y + h * 0.42) + "L" + (x + w / 2) + " " + y + "L" + (x + w) + " " + (y + h * 0.42) +
      "V" + (y + h) + "H" + x + "Z"}));
    // a small laptop inside
    var cx = x + w / 2, cy = y + h * 0.68;
    g.appendChild(svg("rect", {x: cx - 17, y: cy - 13, width: 34, height: 22, rx: 3, fill: "var(--surface)", stroke: "var(--ink-2)", "stroke-width": 1.6}));
    g.appendChild(svg("path", {d: "M" + (cx - 23) + " " + (cy + 13) + "h46", stroke: "var(--ink-2)", "stroke-width": 2.4, "stroke-linecap": "round"}));
  }
  function router(g, x, y, w, h, text) {
    g.appendChild(svg("path", {d: "M" + (x + w * 0.25) + " " + y + "l-6 -14M" + (x + w * 0.75) + " " + y + "l6 -14", stroke: "var(--router)", "stroke-width": 3, "stroke-linecap": "round"}));
    g.appendChild(svg("rect", {class: "router", x: x, y: y, width: w, height: h, rx: 9}));
    g.appendChild(svg("text", {class: "router-text", x: x + w / 2, y: y + h / 2 + 5, "text-anchor": "middle"}, text));
  }
  function server(g, x, y, w, h, title, sub) {
    g.appendChild(svg("rect", {class: "server", x: x, y: y, width: w, height: h, rx: 7}));
    g.appendChild(svg("text", {class: "lbl", x: x + w / 2, y: y + (sub ? h / 2 - 5 : h / 2 + 6), "text-anchor": "middle"}, title));
    if (sub) g.appendChild(svg("text", {class: "lbl-sm", x: x + w / 2, y: y + h / 2 + 19, "text-anchor": "middle"}, sub));
  }
  function bubble(g, x, y, text, cls) {
    var w = text.length * 10.4 + 28;
    x = Math.max(w / 2 + 4, Math.min(1196 - w / 2, x));   // keep inside the 1200-wide problem scene
    var b = svg("g", {class: "fade-in"},
      svg("rect", {class: cls || "callout", x: x - w / 2, y: y - 18, width: w, height: 34, rx: 17}),
      svg("text", {class: "lbl-mono", x: x, y: y + 5, "text-anchor": "middle", style: "fill:var(--ink)"}, text));
    g.appendChild(b);
    return b;
  }
  function door(g, x, y, text, cls, anchor) {
    var d = svg("g", {class: "fade-in"},
      svg("rect", {class: "door " + (cls || ""), x: x - 6, y: y - 9, width: 12, height: 18, rx: 2}),
      svg("text", {class: "lbl-mono", x: anchor === "end" ? x - 12 : x + 12, y: y + 5, "text-anchor": anchor || "start", style: "font-weight:700;fill:var(--ink)"}, text));
    g.appendChild(d);
    return d;
  }
  Demo.anim = {fly: fly, wait: wait, house: house, router: router, server: server, xmark: xmark};

  // ───────────────────────────────────────────────────────── 2 · the problem
  function initProblem() {
    var root = document.getElementById("problem-svg");
    var base = svg("g"), dyn = svg("g"), pk = svg("g");
    append3(root, base, dyn, pk);
    var P = {A: [158, 250], NA: [305, 250], NB: [895, 250], B: [1042, 250], STUN: [600, 82], RELAY: [600, 346]};
    // static scene
    base.appendChild(svg("path", {class: "wire-dash", d: "M305 222 L500 49 M895 222 L700 49 M305 278 L500 379 M895 278 L700 379"}));
    base.appendChild(svg("path", {class: "wire", d: "M165 250H255M355 250H460M740 250H845M945 250H1035"}));
    base.appendChild(svg("path", {class: "cloud", d: "M470 275c-30 0-40-40-10-50c-5-35 45-50 70-30c15-30 75-30 90 0c25-20 75-5 70 30c30 10 20 50-10 50z"}));
    base.appendChild(svg("text", {class: "lbl-sm", x: 600, y: 258, "text-anchor": "middle"}, "Internet"));
    house(base, 40, 168, 125, 132); house(base, 1035, 168, 125, 132);
    router(base, 255, 224, 100, 52, "NAT A"); router(base, 845, 224, 100, 52, "NAT B");
    server(base, 500, 16, 200, 66, "STUN server", "“what is my address?”");
    server(base, 500, 346, 200, 66, "Relay server", "forwards every packet");
    [["Peer A", 102, "private 10.0.0.2"], ["Peer B", 1097, "private 10.0.0.9"]].forEach(function (p) {
      base.appendChild(svg("text", {class: "lbl", x: p[1], y: 326, "text-anchor": "middle"}, p[0]));
      base.appendChild(svg("text", {class: "lbl-sm", x: p[1], y: 350, "text-anchor": "middle"}, p[2]));
    });
    base.appendChild(svg("text", {class: "lbl-sm", x: 305, y: 300, "text-anchor": "middle"}, "public 203.0.113.7"));
    base.appendChild(svg("text", {class: "lbl-sm", x: 895, y: 300, "text-anchor": "middle"}, "public 198.51.100.4"));

    var relayT = Demo.fmtTime(Demo.DATA.sim.ice.relayTMed);
    var steps = [
      {cap: "<b>Peer A</b> and <b>Peer B</b> want a video call. Each sits behind a home router, a <b>NAT</b>, that shares one public address among every device in the house.",
       run: function () { return Promise.resolve(true); }},
      {cap: "Each peer asks a <b>STUN server</b> what address it sees. The router opens a <b>door</b> (a public port) for that conversation, and the peers swap these addresses through the app.",
       run: async function (alive, fast) {
         var o = {dur: fast ? 0 : 750, cls: "pkt-neutral"};
         await Promise.all([fly(pk, [P.A, P.NA, P.STUN], o, alive), fly(pk, [P.B, P.NB, P.STUN], o, alive)]);
         if (!alive()) return;
         doors(false);
         await Promise.all([fly(pk, [P.STUN, P.NA, P.A], o, alive), fly(pk, [P.STUN, P.NB, P.B], o, alive)]);
         if (!alive()) return;
         known();
       }},
      {cap: "Case 1, a <b>cone NAT</b>: the router reuses the same door for every destination. Both peers send at the same moment, each outgoing packet opens the way for the incoming one, and the call goes <b>direct</b>.",
       run: async function (alive, fast) {
         doors(false); known();
         var o = {dur: fast ? 0 : 1000, cls: "pkt-ours"};
         await Promise.all([fly(pk, [P.A, P.NA, P.NB, P.B], o, alive), fly(pk, [P.B, P.NB, P.NA, P.A], o, alive)]);
         if (!alive()) return;
         dyn.appendChild(svg("path", {class: "path-direct fade-in", d: "M158 250H1042"}));
         bubble(dyn, 600, 216, "direct path ✓", "callout-good");
       }},
      {cap: "Case 2, a <b>symmetric NAT</b> at Peer B: it opens a <b>new door for every destination</b>. STUN saw door :50002, but traffic to Peer A leaves from :61437, so each side aims at a door that does not exist and both packets are <b>dropped</b>.",
       run: async function (alive, fast) {
         doors(true); known();
         var o = {dur: fast ? 0 : 900, cls: "pkt-ours", fate: "drop", keepX: true};
         await Promise.all([fly(pk, [P.A, P.NA, [848, 250]], o, alive), fly(pk, [P.B, P.NB, [352, 250]], o, alive)]);
         if (!alive()) return;
         bubble(dyn, 790, 205, "no door :50002 for A", "callout-bad");
         bubble(dyn, 420, 205, "unexpected port :61437", "callout-bad");
       }},
      {cap: "Nothing gets through, so after a timeout both peers send everything through the <b>relay server</b>. It works, but every packet takes a longer trip and the provider pays for the bandwidth. <span class='muted'>(Measured: ICE needed a median " + relayT + " before settling on the relay.)</span>",
       run: async function (alive, fast) {
         doors(true); known();
         dyn.appendChild(svg("path", {class: "path-relay fade-in", d: "M158 250H305L600 348L895 250H1042"}));
         bubble(dyn, 498, 322, "relay: longer, slower", "callout");
         var o = {dur: fast ? 0 : 1300, cls: "pkt-relay"};
         for (var i = 0; i < 2 && alive(); i++) {
           await Promise.all([fly(pk, [P.A, P.NA, P.RELAY, P.NB, P.B], o, alive), fly(pk, [P.B, P.NB, P.RELAY, P.NA, P.A], o, alive)]);
         }
       }}
    ];
    function doors(sym) {
      door(dyn, 362, 212, ":40001");
      door(dyn, 838, 212, ":50002" + (sym ? " (to STUN)" : ""), "", "end");
      if (sym) door(dyn, 838, 320, ":61437 (to A)", "door-new", "end");   // below the "public …" label
    }
    function known() {
      bubble(dyn, 102, 146, "I am 203.0.113.7:40001");
      bubble(dyn, 1097, 146, "I am 198.51.100.4:50002");
    }

    var cur = 0, token = 0;
    var cap = document.getElementById("problem-cap"), dotsBox = document.getElementById("problem-dots");
    var next = document.getElementById("problem-next"), back = document.getElementById("problem-back");
    steps.forEach(function () { dotsBox.appendChild(el("span")); });
    function show(i, fast) {
      cur = i;
      var tok = ++token;
      var alive = function () { return tok === token; };
      Demo.clear(dyn); Demo.clear(pk);
      cap.innerHTML = steps[i].cap;
      [].forEach.call(dotsBox.children, function (d, j) { d.classList.toggle("on", j <= i); });
      back.disabled = i === 0;
      next.textContent = i === steps.length - 1 ? "Start over" : "Next step";
      steps[i].run(alive, fast);
    }
    next.addEventListener("click", function () { show(cur === steps.length - 1 ? 0 : cur + 1); });
    back.addEventListener("click", function () { if (cur > 0) show(cur - 1, true); });
    show(0);
  }
  function append3(root) { for (var i = 1; i < arguments.length; i++) root.appendChild(arguments[i]); }

  // ───────────────────────────────────────────────────────── 3 · profiling
  function inferBlock(ports) {   // port of profiler.infer_block
    var lo = Math.min.apply(null, ports), hi = Math.max.apply(null, ports);
    for (var size = 256; size <= 8192; size *= 2) {
      if (Math.floor(lo / size) === Math.floor(hi / size)) return [Math.floor(lo / size) * size, size];
    }
    return null;
  }
  function makeAllocator(kind, rand) {
    var base = 20000 + Math.floor(rand() * 20001), n = 0;
    var delta = [2, 3, 4, 5, 7][Math.floor(rand() * 5)];
    var blockLo = (Math.floor(1024 / 512) + 1 + Math.floor(rand() * 124)) * 512;
    return {
      delta: delta, blockLo: blockLo,
      next: function () {
        if (kind === "sequential") return base + n++;
        if (kind === "fixed-delta") return base + (n++) * delta;
        if (kind === "block") return blockLo + Math.floor(rand() * 512);
        return 1024 + Math.floor(rand() * 64512);
      }
    };
  }

  function initProfiler() {
    var DATA = Demo.DATA;
    var st = {mapping: "APD", filtering: "APD", alloc: "block", runs: 0};
    var controls = document.getElementById("prof-controls");
    function sel(label, key, opts) {
      var s = el("select", {"aria-label": label}, opts.map(function (o) { return el("option", {value: o[0]}, o[1]); }));
      s.value = st[key];
      s.addEventListener("change", function () { st[key] = s.value; syncSel(); reset(); });
      controls.appendChild(el("label", {class: "field"}, label, s));
      return s;
    }
    var sm = sel("Mapping", "mapping", [["EI", "EI · one port for all"], ["AD", "AD · per address"], ["APD", "APD · per address+port"]]);
    sel("Filtering", "filtering", [["EI", "EI · lets anyone in"], ["AD", "AD · known address"], ["APD", "APD · exact address+port"]]);
    var sa = sel("Allocation", "alloc", [["sequential", "Sequential +1"], ["fixed-delta", "Fixed step +k"], ["random", "Random"], ["block", "Random in 512-block"]]);
    var runBtn = el("button", {class: "btn btn-primary", type: "button", "data-primary": "", onclick: function () { run(); }}, "Run profiler");
    controls.appendChild(runBtn);
    function syncSel() { sa.disabled = st.mapping === "EI"; }
    syncSel();

    // diagram
    var root = document.getElementById("prof-svg");
    var base = svg("g"), dyn = svg("g"), pk = svg("g");
    append3(root, base, dyn, pk);
    var SOCK1 = [150, 140], SOCK9 = [150, 196], NAT_IN1 = [218, 140], NAT_IN9 = [218, 196], NAT_OUT = [302, 168];
    var SRV = {S1: [468, 48], S2: [468, 118], S3: [468, 188], BANK: [468, 268]};
    base.appendChild(svg("rect", {x: 14, y: 96, width: 136, height: 136, rx: 10, fill: "var(--house)", stroke: "var(--border-strong)"}));
    base.appendChild(svg("text", {class: "lbl", x: 82, y: 118, "text-anchor": "middle"}, "Host"));
    [[SOCK1, "socket 1"], [SOCK9, "socket 999"]].forEach(function (s) {
      base.appendChild(svg("circle", {cx: s[0][0], cy: s[0][1], r: 6, fill: "var(--surface)", stroke: "var(--ink-2)", "stroke-width": 2}));
      base.appendChild(svg("text", {class: "lbl-mono", x: 136, y: s[0][1] + 5, "text-anchor": "end"}, s[1]));
    });
    base.appendChild(svg("text", {class: "lbl-sm", x: 82, y: 222, "text-anchor": "middle"}, "(filter test only)"));
    base.appendChild(svg("path", {class: "wire", d: "M156 140H218M156 196H218"}));
    router(base, 218, 112, 84, 112, "NAT");
    base.appendChild(svg("path", {class: "wire-dash", d: "M302 168L468 48M302 168L468 118M302 168L468 188M302 168L468 268"}));
    server(base, 468, 26, 178, 44, "STUN · IP 1 : 7001");
    server(base, 468, 96, 178, 44, "STUN · IP 1 : 7002");
    server(base, 468, 166, 178, 44, "STUN · IP 2 : 7002");
    base.appendChild(svg("rect", {class: "server", x: 476, y: 238, width: 178, height: 50, rx: 7, opacity: 0.55}));
    server(base, 468, 244, 178, 50, "12 echo servers", "12 different IPs");
    var mapTitle = svg("text", {class: "lbl-sm", x: 218, y: 252}, "NAT's public ports:");
    base.appendChild(mapTitle);

    var stepsBox = document.getElementById("prof-steps");
    var rows = [
      {t: "Filtering test", how: "Own socket; two CHANGE-REQUEST probes sent in parallel ask for a reply from another IP+port, and from another port."},
      {t: "Mapping test", how: "Compare the port seen by two server addresses."},
      {t: "Allocation test", how: "12 probes to 12 servers; compare the port gaps."}
    ].map(function (r, i) {
      var v = el("div", {class: "ps-verdict"});
      var li = el("li", {class: "prof-step"}, el("span", {class: "ps-n"}, i + 1),
        el("div", null, el("div", {class: "ps-title"}, r.t), el("div", {class: "ps-how"}, r.how), v));
      stepsBox.appendChild(li);
      return {li: li, v: v};
    });
    var result = el("div", {class: "prof-result", "aria-live": "polite"});
    var allocBox = document.getElementById("prof-alloc");
    stepsBox.appendChild(el("li", {style: "list-style:none"}, result));

    var token = 0;
    function reset() {
      token++;
      Demo.clear(dyn); Demo.clear(pk);
      rows.forEach(function (r) { r.li.className = "prof-step"; Demo.clear(r.v); });
      Demo.clear(result).appendChild(el("span", {class: "muted"}, "Pick a behaviour above and press “Run profiler”."));
      Demo.clear(allocBox);
      allocBox.appendChild(el("span", {class: "pa-title"}, "Allocation test"));
      allocBox.appendChild(el("span", {class: "muted"}, "Ports from the 12 probes appear here."));
    }
    function verdict(row, html) { row.v.innerHTML = html; }
    var mapLines = 0;
    function addMap(text) {
      if (mapLines >= 4) return;
      dyn.appendChild(svg("text", {class: "lbl-mono fade-in", x: 218, y: 270 + mapLines * 16, style: "font-size:12px"}, text));
      mapLines++;
    }

    async function run() {
      reset();
      var tok = ++token, alive = function () { return tok === token; };
      st.runs++;
      mapLines = 0;
      var rand = Demo.rng(st.runs * 1013 + st.mapping.length * 7 + st.alloc.length);
      var alloc = makeAllocator(st.alloc, rand);
      var D = 620;
      // 1 · filtering test on socket 999
      rows[0].li.classList.add("active");
      var p999 = alloc.next();
      addMap("999 → IP1:7001 ⇒ :" + p999);
      await Promise.all([
        fly(pk, [SOCK9, NAT_IN9, NAT_OUT, SRV.S1], {dur: D, cls: "pkt-ours", label: "IP+port?"}, alive),
        fly(pk, [SOCK9, NAT_IN9, NAT_OUT, SRV.S1], {dur: D, cls: "pkt-ours", label: "port?"}, alive)]);
      if (!alive()) return;
      var f = st.filtering;
      var both = f === "EI", portOnly = f !== "APD";
      await Promise.all([
        fly(pk, both ? [SRV.S3, NAT_OUT, NAT_IN9, SOCK9] : [SRV.S3, NAT_OUT], {dur: both ? D : D * 0.55, cls: "pkt-neutral", fate: both ? "arrive" : "drop", keepX: true}, alive),
        fly(pk, portOnly ? [SRV.S2, NAT_OUT, NAT_IN9, SOCK9] : [SRV.S2, NAT_OUT], {dur: portOnly ? D : D * 0.55, cls: "pkt-neutral", fate: portOnly ? "arrive" : "drop", keepX: true}, alive)]);
      if (!alive()) return;
      if (!both) {
        verdict(rows[0], "<span class='muted'>A reply is missing: retrying, 3 tries × 0.5 s…</span>");
        for (var r = 2; r <= 3 && alive(); r++) {
          await fly(pk, [SOCK9, NAT_IN9, NAT_OUT, SRV.S1], {dur: D * 0.7, cls: "pkt-ours", label: "try " + r}, alive);
          await fly(pk, [SRV.S3, NAT_OUT], {dur: D * 0.4, cls: "pkt-neutral", fate: "drop"}, alive);
        }
        if (!alive()) return;
      }
      verdict(rows[0], both ? "Both replies got in → <span class='v'>EI</span> filtering: lets in anyone."
        : portOnly ? "Only the reply from the same IP got in → <span class='v'>AD</span> filtering."
        : "Neither reply got in → <span class='v'>APD</span> filtering: exact address and port only.");
      rows[0].li.className = "prof-step done";
      // 2 · mapping test on socket 1
      rows[1].li.classList.add("active");
      var m = st.mapping;
      var P1 = alloc.next();
      addMap("1 → IP1:7001 ⇒ :" + P1);
      await fly(pk, [SOCK1, NAT_IN1, NAT_OUT, SRV.S1], {dur: D, cls: "pkt-ours"}, alive);
      await fly(pk, [SRV.S1, NAT_OUT, NAT_IN1, SOCK1], {dur: D, cls: "pkt-neutral", label: ":" + P1}, alive);
      if (!alive()) return;
      var P2 = m === "EI" ? P1 : alloc.next();
      if (m !== "EI") addMap("1 → IP2:7002 ⇒ :" + P2);
      await fly(pk, [SOCK1, NAT_IN1, NAT_OUT, SRV.S3], {dur: D, cls: "pkt-ours"}, alive);
      await fly(pk, [SRV.S3, NAT_OUT, NAT_IN1, SOCK1], {dur: D, cls: "pkt-neutral", label: ":" + P2}, alive);
      if (!alive()) return;
      if (m === "EI") {
        verdict(rows[1], "Same port :" + P1 + " for both servers → <span class='v'>EI</span> mapping.");
      } else {
        var P3 = m === "AD" ? P1 : alloc.next();
        if (m === "APD") addMap("1 → IP1:7002 ⇒ :" + P3);
        verdict(rows[1], "<span class='muted'>Port changed (:" + P1 + " → :" + P2 + "). Is it the address or the port? Ask IP 1 on its other port…</span>");
        await fly(pk, [SOCK1, NAT_IN1, NAT_OUT, SRV.S2], {dur: D, cls: "pkt-ours"}, alive);
        await fly(pk, [SRV.S2, NAT_OUT, NAT_IN1, SOCK1], {dur: D, cls: "pkt-neutral", label: ":" + P3}, alive);
        if (!alive()) return;
        verdict(rows[1], m === "AD" ? "Same IP, other port → same :" + P1 + " → <span class='v'>AD</span> mapping."
          : "Same IP, other port → yet another port :" + P3 + " → <span class='v'>APD</span> mapping.");
      }
      rows[1].li.className = "prof-step done";
      // 3 · allocation test
      var label;
      if (m === "EI") {
        rows[2].li.className = "prof-step skipped";
        verdict(rows[2], "Skipped: with EI mapping the port never changes, so there is nothing to predict.");
        Demo.clear(allocBox);
        allocBox.appendChild(el("span", {class: "pa-title"}, "Allocation test"));
        allocBox.appendChild(el("span", {class: "muted"}, "Not needed for EI mapping: one public port serves every destination (4 probes in total)."));
        label = "EI/" + st.filtering + "/-";
      } else {
        rows[2].li.classList.add("active");
        Demo.clear(allocBox);
        var chips = el("div", {class: "port-chips"});
        var nl = el("div");
        allocBox.appendChild(el("span", {class: "pa-title"}, "12 new ports"));
        allocBox.appendChild(chips);
        allocBox.appendChild(el("span", {class: "pa-title"}, "Where they fall"));
        allocBox.appendChild(nl);
        var ports = [];
        for (var i = 0; i < DATA.notes.allocProbes && alive(); i++) {
          var port = alloc.next();
          ports.push(port);
          fly(pk, [SOCK1, NAT_IN1, NAT_OUT, SRV.BANK], {dur: 380, cls: "pkt-ours"}, alive);
          await wait(110, alive);
          var d = i ? port - ports[i - 1] : null;
          chips.appendChild(el("span", {class: "port-chip new"}, ":" + port, d != null ? el("span", {class: "d"}, (d > 0 ? "+" : "") + d) : null));
        }
        if (!alive()) return;
        await wait(300, alive);
        var deltas = {};
        for (var j = 1; j < ports.length; j++) deltas[ports[j] - ports[j - 1]] = true;
        var dk = Object.keys(deltas);
        var blk = null, a;
        if (dk.length === 1) {
          var k = +dk[0];
          a = k === 1 ? "Seq" : "Fixed";
          verdict(rows[2], "Every gap is " + (k > 0 ? "+" : "") + k + " → <span class='v'>" + (k === 1 ? "sequential" : "fixed step " + k) + "</span>: the next ports are predictable.");
        } else {
          blk = inferBlock(ports);
          a = blk ? "Blk" + blk[1] : "Rand";
          verdict(rows[2], blk ? "Gaps are random, but all 12 ports sit in one aligned block → <span class='v'>block " + blk[0] + "–" + (blk[0] + blk[1] - 1) + "</span>."
            : "Gaps are random and spread over the whole range → <span class='v'>random</span>.");
        }
        numberLine(nl, ports, blk, dk.length === 1);
        rows[2].li.className = "prof-step done";
        label = m + "/" + st.filtering + "/" + a;
      }
      // result + measured cost for this configuration
      var cfgLabel = m === "EI" ? label : m + "/" + st.filtering + "/" + {sequential: "Seq", "fixed-delta": "Fixed", random: "Rand", block: "Blk512"}[st.alloc];
      var cfg = DATA.accuracy.configs.concat(DATA.accuracyBlocks.configs).filter(function (c) { return c.label === cfgLabel; })[0];
      Demo.clear(result);
      result.appendChild(el("span", {class: "big-label"}, label));
      if (cfg) {
        var fb = DATA.accuracy.byFiltering;
        result.appendChild(el("span", null, el("span", {class: "tag tag-measured", style: "margin-right:6px"}, Demo.icon.tick(), "Measured"),
          el("b", null, Demo.fmtTime(cfg.secondsMedian)), " median, " + cfg.probes + " probes, " + cfg.ok + "/" + cfg.n + " runs correct"));
        var tps = DATA.testbed.profileSecondsMedian;
        result.appendChild(el("span", {class: "footnote"},
          "With AD or APD filtering at least one filtering reply never arrives, so the profiler waits out 3 × 0.5 s (" +
          Demo.fmtTime(fb.APD.secondsMedian) + " in the simulator, " + Demo.fmtTime(tps["port-restricted"]) + " on the real port-restricted NAT). An EI filter answers at once (" +
          Demo.fmtTime(fb.EI.secondsMedian) + " in the simulator, " + Demo.fmtTime(tps["full-cone"]) + " on the real full-cone NAT)."));
      }
    }

    function numberLine(box, ports, blk, even) {
      var W = 600, H = 48, s = svg("svg", {class: "numline", viewBox: "0 0 " + W + " " + H, role: "img",
        "aria-label": "Port positions on the 1024–65535 range"});
      var x = function (p) { return 10 + (p - 1024) / 64511 * (W / 2 - 30); };
      s.appendChild(svg("line", {x1: 10, x2: W / 2 - 20, y1: 22, y2: 22, stroke: "var(--axis)", "stroke-width": 2}));
      s.appendChild(svg("text", {x: 10, y: 42}, "1024"));
      s.appendChild(svg("text", {x: W / 2 - 20, y: 42, "text-anchor": "end"}, "65535"));
      ports.forEach(function (p) { s.appendChild(svg("line", {x1: x(p), x2: x(p), y1: 12, y2: 32, stroke: "var(--ours)", "stroke-width": 2})); });
      var zLo, zHi;
      if (blk) { zLo = blk[0]; zHi = blk[0] + blk[1] - 1; }
      else if (even) { zLo = Math.min.apply(null, ports) - 2; zHi = Math.max.apply(null, ports) + 2; }
      if (zLo != null) {
        var X0 = W / 2 + 10, X1 = W - 10;
        var zx = function (p) { return X0 + (p - zLo) / (zHi - zLo) * (X1 - X0); };
        s.appendChild(svg("path", {d: "M" + x(zLo) + " 12L" + X0 + " 6M" + x(zHi) + " 12L" + X1 + " 6", stroke: "var(--axis)", "stroke-width": 1, fill: "none"}));
        s.appendChild(svg("rect", {x: X0, y: 6, width: X1 - X0, height: 26, rx: 4, fill: blk ? "var(--ours-wash)" : "var(--surface-2)", stroke: blk ? "var(--ours)" : "var(--axis)"}));
        ports.forEach(function (p) { s.appendChild(svg("line", {x1: zx(p), x2: zx(p), y1: 9, y2: 29, stroke: "var(--ours)", "stroke-width": 2})); });
        s.appendChild(svg("text", {x: X0, y: 44}, String(zLo)));
        s.appendChild(svg("text", {x: X1, y: 44, "text-anchor": "end"}, String(zHi)));
        if (blk) s.appendChild(svg("text", {x: (X0 + X1) / 2, y: 44, "text-anchor": "middle", style: "fill:var(--ink)"}, "detected " + blk[1] + "-port block"));
      } else {
        s.appendChild(svg("text", {x: W * 0.75, y: 26, "text-anchor": "middle", style: "fill:var(--ink);font-family:var(--sans);font-size:12px"}, "no block of ≤ 8192 ports holds them all"));
      }
      box.appendChild(s);
    }
    reset();
  }

  // ───────────────────────────────────────────────────────── 5 · connecting (shared replay of both agents)
  var SLOW = 25;          // slow-motion factor while the interesting part happens
  var TRAVEL = 520;       // screen ms for a packet to cross the lane
  function initConnect() {
    var DATA = Demo.DATA;
    var lanesBox = document.getElementById("lanes");
    var pairBox = document.getElementById("conn-pair");
    var speedEl = document.getElementById("conn-speed");
    var playBtn = document.getElementById("conn-play"), pauseBtn = document.getElementById("conn-pause");
    var X = {A: 92, NA: 205, NB: 795, B: 908, RELAY: [500, 44], DROP_A: 250, DROP_B: 750}, Y = 106;
    var PT = {A: [X.A, Y], NA: [X.NA, Y], NB: [X.NB, Y], B: [X.B, Y]};
    var lanes = [], sched = null, raf = 0, sNow = 0, playing = false, lastTs = 0, finished = false;

    function laneSvg(pa, pb) {
      var s = svg("svg", {class: "lane-svg scene", viewBox: "0 0 1000 166", role: "img"});
      var base = svg("g"), paths = svg("g"), pk = svg("g");
      s.appendChild(base); s.appendChild(paths); s.appendChild(pk);
      base.appendChild(svg("path", {class: "wire", d: "M" + X.A + " " + Y + "H" + X.B}));
      base.appendChild(svg("path", {class: "wire-dash", d: "M" + X.NA + " " + (Y - 22) + "L440 26M" + X.NB + " " + (Y - 22) + "L560 26"}));
      house(base, 16, 52, 76, 86); house(base, 908, 52, 76, 86);
      router(base, 175, 84, 60, 44, "NAT A"); router(base, 765, 84, 60, 44, "NAT B");
      server(base, 440, 4, 120, 40, "Relay");
      base.appendChild(svg("text", {class: "lbl-mono", x: 54, y: 160, "text-anchor": "middle"}, S.label(pa)));
      base.appendChild(svg("text", {class: "lbl-mono", x: 946, y: 160, "text-anchor": "middle"}, S.label(pb)));
      base.appendChild(svg("text", {class: "lbl-sm", x: 500, y: 140, "text-anchor": "middle"}, "Internet"));
      return {svg: s, paths: paths, pk: pk, pool: [], xs: []};
    }
    function travel(from, to) {   // host -> own NAT -> far NAT -> far host
      return [PT[from], PT[from === "A" ? "NA" : "NB"], PT[to === "A" ? "NA" : "NB"], PT[to]];
    }
    function relayPath(from) {
      return from === "A" ? [PT.A, PT.NA, X.RELAY, PT.NB, PT.B] : [PT.B, PT.NB, X.RELAY, PT.NA, PT.A];
    }

    // Build the timeline for one agent. Times t are real seconds; converted to screen time later.
    function oursEvents(plan, m) {
      var ev = [], miles = [];
      var T = m.tMed, direct = m.direct * 2 > m.n;
      var dieA = [PT.A, [X.NA + 70, Y]], dieB = [PT.B, [X.NB - 70, Y]];
      var tb = DATA.notes.tBudget;
      function opening(n, t0, span) {
        for (var i = 0; i < n; i++) {
          var t = t0 + span * i / Math.max(1, n);
          ev.push({t: t, pts: dieA, cls: "pkt-ttl", fate: "die", short: true});
          ev.push({t: t, pts: dieB, cls: "pkt-ttl", fate: "die", short: true});
        }
      }
      if (plan.method === "RELAY") {
        miles.push({t: 0, status: "Straight to the relay"});
        ev.push({t: 0, pts: relayPath("A"), cls: "pkt-relay", relay: true});
        ev.push({t: 0, pts: relayPath("B"), cls: "pkt-relay", relay: true});
        miles.push({t: T, done: "relay"});
        return {ev: ev, miles: miles, end: T};
      }
      var tPunch = 0.05;
      if (plan.method === "DIRECT") {
        miles.push({t: 0, status: "Opening ports (TTL 2)…"});
        opening(1, 0, 0);
        miles.push({t: tPunch, status: "Punching…"});
        ev.push({t: tPunch, pts: travel("A", "B"), cls: "pkt-ours"});
        ev.push({t: tPunch, pts: travel("B", "A"), cls: "pkt-ours"});
      } else if (plan.method === "PREDICT") {
        miles.push({t: 0, status: "Opening a window of ports (TTL 2)…"});
        opening(6, 0, 0.004);
        miles.push({t: tPunch, status: "Aiming at the predicted ports…"});
        for (var i = 0; i < 6; i++) {
          var last = i === 5;
          ev.push({t: tPunch + i * 0.0008, pts: last ? travel("A", "B") : [PT.A, PT.NA, [X.DROP_B, Y + (i - 2.5) * 4]], cls: "pkt-ours", fate: last ? "arrive" : "drop"});
          ev.push({t: tPunch + i * 0.0008, pts: last ? travel("B", "A") : [PT.B, PT.NB, [X.DROP_A, Y + (i - 2.5) * 4]], cls: "pkt-ours", fate: last ? "arrive" : "drop"});
        }
      } else {   // SPRAY
        var op = plan.opener, pr = op === "A" ? "B" : "A";
        var opDie = op === "A" ? dieA : dieB;
        var tEnd = direct ? T : tb;
        miles.push({t: 0, status: "Peer " + op + " opens " + plan.nOpen + " ports (TTL 2)…"});
        var shown = Math.min(24, plan.nOpen);
        for (var j = 0; j < shown; j++) ev.push({t: 0.012 * j / shown, pts: opDie, cls: "pkt-ttl", fate: "die", short: true});
        miles.push({t: tPunch, status: "Peer " + pr + " sprays probes into " + (plan.rangeSize < S.R_SPACE ? "the " + plan.rangeSize + "-port block" : "the port range") + "…"});
        var nb = Math.max(1, Math.floor((tEnd - 0.012 - tPunch) / 0.025) + 1);
        if (!direct) nb = Math.min(nb, Math.ceil(plan.mProbe / 32));   // the prober stops after M probes
        for (var b = 0; b < nb; b++) {
          var tB = tPunch + b * 0.025;
          if (tB > tEnd - 0.006) break;
          for (var q = 0; q < 5; q++) {
            var hit = direct && b === nb - 1 && q === 4;
            var targetX = op === "A" ? X.DROP_A : X.DROP_B;
            var from = PT[pr], via = PT[pr === "A" ? "NA" : "NB"];
            ev.push({t: tB + q * 0.002, pts: hit ? travel(pr, op) : [from, via, [targetX, Y + (q - 2) * 4]], cls: "pkt-ours", fate: hit ? "arrive" : "drop", tiny: !hit});
          }
        }
        if (direct) miles.push({t: T - 0.006, status: "Hit! Answering on the same socket…"});
      }
      if (direct) {
        miles.push({t: T, done: "direct"});
      } else {
        miles.push({t: tb, status: "No luck within " + tb + " s: relay"});
        ev.push({t: tb, pts: relayPath("A"), cls: "pkt-relay", relay: true});
        miles.push({t: T, done: "relay"});
      }
      return {ev: ev, miles: miles, end: T};
    }
    function iceEvents(m) {
      var ev = [], miles = [];
      var T = m.tMed, direct = m.direct * 2 > m.n, ta = DATA.notes.iceTa, tb = DATA.notes.tBudget;
      miles.push({t: 0, status: "Checks every " + Math.round(ta * 1000) + " ms…"});
      var stop = direct ? T : tb;
      var rounds = Math.max(1, Math.floor(stop / ta + 1e-9));
      for (var r = 0; r < rounds; r++) {
        var t = r * ta, ok = direct && r === rounds - 1;
        ev.push({t: t, pts: ok ? travel("A", "B") : [PT.A, PT.NA, [X.DROP_B, Y]], cls: "pkt-ice", fate: ok ? "arrive" : "drop"});
        ev.push({t: t, pts: ok ? travel("B", "A") : [PT.B, PT.NB, [X.DROP_A, Y]], cls: "pkt-ice", fate: ok ? "arrive" : "drop"});
      }
      if (direct) {
        miles.push({t: T, done: "direct"});
      } else {
        miles.push({t: Math.min(0.3, tb / 2), status: "Nothing back; waiting for the " + tb + " s timeout…"});
        miles.push({t: tb, status: "Timeout: falling back to the relay"});
        ev.push({t: tb, pts: relayPath("A"), cls: "pkt-relay", relay: true});
        ev.push({t: tb, pts: relayPath("B"), cls: "pkt-relay", relay: true});
        miles.push({t: T, done: "relay"});
      }
      return {ev: ev, miles: miles, end: T};
    }

    function build() {
      cancelAnimationFrame(raf);
      playing = false; finished = false; sNow = 0;
      Demo.clear(lanesBox); Demo.clear(pairBox);
      var st = Demo.state.pair, pa = Demo.toProfile(st.A), pb = Demo.toProfile(st.B);
      var plan = S.choose(pa, pb);
      var r = Demo.lookupPair(pa, pb);
      pairBox.appendChild(el("span", null, "Peer A ", el("span", {class: "chip"}, S.label(pa))));
      pairBox.appendChild(el("span", {class: "muted"}, "↔"));
      pairBox.appendChild(el("span", null, "Peer B ", el("span", {class: "chip"}, S.label(pb))));
      pairBox.appendChild(el("span", {class: "muted"}, "→ ours picks"));
      pairBox.appendChild(Demo.methodChip(plan.method));
      pairBox.appendChild(el("a", {href: "#strategy", class: "footnote", onclick: function (e) { e.preventDefault(); Demo.go([].indexOf.call(document.querySelectorAll(".slide"), document.getElementById("strategy"))); }}, "change the pairing in Step 2"));
      if (r.kind === "none") {
        sched = null;
        lanesBox.appendChild(el("div", {class: "card conn-empty"}, "This pairing (two port-block routers) was not part of our measurements, so there are no real times to replay. Pick another pairing in Step 2."));
        playBtn.disabled = true; pauseBtn.disabled = true; speedEl.textContent = "";
        return;
      }
      playBtn.disabled = false; pauseBtn.disabled = true;
      var o = oursEvents(plan, r.ours), ic = iceEvents(r.ice);
      var hi = Math.max(o.end, ic.end), lo = Math.min(o.end, ic.end);
      var tSlow = hi <= 0.45 ? hi + 0.004 : Math.max(lo, 0.03) + 0.012;
      var screen = function (t) { return t <= tSlow ? t * 1000 * SLOW : tSlow * 1000 * SLOW + (t - tSlow) * 1000; };
      var real = function (s) { var sl = tSlow * 1000 * SLOW; return s <= sl ? s / 1000 / SLOW : tSlow + (s - sl) / 1000; };
      var agents = [
        {key: "ours", name: "Our agent", sw: "sw-ours", tl: o, m: r.ours, plan: plan.method},
        {key: "ice", name: "Standard ICE", sw: "sw-ice", tl: ic, m: r.ice}
      ];
      lanes = agents.map(function (ag) {
        var L = laneSvg(pa, pb);
        var clock = el("div", {class: "lane-clock"}, "0 ms");
        var pkEl = el("div", {class: "lane-pk"}, "0 packets");
        var status = el("div", {class: "lane-status"}, "Ready");
        var meas = el("div", {class: "lane-meas"}, "Measured for this pairing: ",
          el("b", null, ag.m.direct + "/" + ag.m.n + " direct"), " · median ", el("b", null, Demo.fmtTime(ag.m.tMed)),
          " · median ", el("b", null, Demo.fmtInt(ag.m.pktsMed) + " packets"), " (" + ag.m.n + " simulated trials)" +
          (ag.key === "ours" && r.kind === "blocks" ? ", block-aware" : ""));
        var card = el("div", {class: "card lane " + ag.key},
          L.svg, el("div", {class: "lane-side"}, el("div", {class: "lane-name"}, el("span", {class: "sw " + ag.sw}), ag.name), clock, pkEl, status), meas);
        lanesBox.appendChild(card);
        L.svg.setAttribute("aria-label", ag.name + " connecting " + S.label(pa) + " to " + S.label(pb));
        var evs = ag.tl.ev.map(function (e) {
          var s0 = screen(e.t);
          var dur = e.short ? TRAVEL * 0.45 : e.relay ? TRAVEL * 1.4 : e.fate === "drop" ? TRAVEL * 0.85 : TRAVEL;
          return {s0: s0, dur: dur, pts: e.pts, pl: pathLen(e.pts), cls: e.cls, fate: e.fate || "arrive", tiny: e.tiny};
        });
        // the decisive packet (the last one to arrive) lands exactly when the measured time is reached
        var endS = screen(ag.tl.end);
        evs.forEach(function (e) {
          if (e.fate !== "arrive" || e.s0 + e.dur <= endS) return;
          e.dur = Math.max(220, endS - e.s0);          // travel faster rather than leave early
          if (e.s0 + e.dur > endS) e.s0 = Math.max(0, endS - e.dur);
        });
        evs.sort(function (a, b) { return a.s0 - b.s0; });
        var miles = ag.tl.miles.map(function (mi) { return {s: screen(mi.t), status: mi.status, done: mi.done}; });
        return {ag: ag, L: L, clock: clock, pkEl: pkEl, status: status, evs: evs, miles: miles, endS: endS, endT: ag.tl.end};
      });
      var total = Math.max.apply(null, lanes.map(function (l) { return l.endS; })) + 600;
      sched = {screen: screen, real: real, tSlow: tSlow, slowEnd: screen(tSlow), total: total};
      speedEl.textContent = "Press Play: slow motion first, then real time";
      render(0);
    }

    function render(s) {
      lanes.forEach(function (ln) {
        var L = ln.L, used = 0, xs = 0;
        var emitted = 0;
        for (var i = 0; i < ln.evs.length; i++) {
          var e = ln.evs[i];
          if (e.s0 > s || s === 0) break;   // nothing has been sent before Play
          emitted++;
          var k = (s - e.s0) / e.dur;
          if (k >= 1) {
            if (e.fate === "drop" && k < 1 + 380 / e.dur) {   // keep the X visible briefly
              var px = e.pts[e.pts.length - 1];
              var xm = L.xs[xs] || (L.xs[xs] = L.pk.appendChild(svg("path", {class: "xmark"})));
              var z = e.tiny ? 5 : 8;
              xm.setAttribute("d", "M" + (px[0] - z) + " " + (px[1] - z) + "l" + 2 * z + " " + 2 * z + "M" + (px[0] + z) + " " + (px[1] - z) + "l" + -2 * z + " " + 2 * z);
              xm.style.display = "";
              xs++;
            }
            continue;
          }
          var p = pointAt(e.pts, e.pl, k);
          var c = L.pool[used] || (L.pool[used] = L.pk.appendChild(svg("circle", {class: "pkt"})));
          c.setAttribute("class", "pkt " + e.cls);
          c.setAttribute("r", e.tiny ? 5 : 7);
          c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]);
          c.style.opacity = e.fate === "die" && k > 0.5 ? String(Math.max(0, 1 - (k - 0.5) / 0.5)) : "1";
          c.style.display = "";
          used++;
        }
        for (var u = used; u < L.pool.length; u++) L.pool[u].style.display = "none";
        for (var w = xs; w < L.xs.length; w++) L.xs[w].style.display = "none";
        var done = s >= ln.endS;
        var tReal = done ? ln.endT : sched.real(s);
        ln.clock.textContent = Demo.fmtTime(tReal);
        ln.pkEl.textContent = Demo.fmtInt(done ? ln.ag.m.pktsMed : ln.ag.m.pktsMed * emitted / Math.max(1, ln.evs.length)) + " packets";
        var stTxt = "Ready", doneKind = null;
        if (s > 0) ln.miles.forEach(function (mi) { if (mi.s <= s || (mi.done && done)) { if (mi.status) stTxt = mi.status; if (mi.done) doneKind = mi.done; } });
        if (!done) doneKind = null;
        Demo.clear(ln.status);
        ln.status.className = "lane-status" + (doneKind === "direct" ? " ok" : doneKind === "relay" ? " relay" : "");
        if (doneKind === "direct") { ln.status.appendChild(Demo.icon.check()); ln.status.appendChild(document.createTextNode("Direct path")); }
        else if (doneKind === "relay") ln.status.textContent = "Connected through the relay";
        else ln.status.textContent = stTxt || "";
        if (doneKind && !ln.shown) {
          ln.shown = doneKind;
          ln.L.paths.appendChild(doneKind === "direct"
            ? svg("path", {class: "path-direct fade-in", d: "M" + X.A + " " + Y + "H" + X.B})
            : svg("path", {class: "path-relay fade-in", d: "M" + X.A + " " + Y + "H" + X.NA + "L500 44L" + X.NB + " " + Y + "H" + X.B}));
        } else if (!doneKind && ln.shown) {
          ln.shown = null; Demo.clear(ln.L.paths);
        }
      });
      if (sched) {
        speedEl.textContent = s >= sched.total - 600 ? "Finished: clocks show the measured medians"
          : s < sched.slowEnd ? "Playback: " + SLOW + "× slower than real time" : "Playback: real time";
      }
    }
    function frame(ts) {
      if (!playing) return;
      sNow += Math.min(64, ts - lastTs);
      lastTs = ts;
      if (sNow >= sched.total) { sNow = sched.total; playing = false; finished = true; render(sNow); syncBtns(); return; }
      render(sNow);
      raf = requestAnimationFrame(frame);
    }
    function syncBtns() {
      playBtn.textContent = playing ? "Playing…" : finished ? "Replay" : sNow > 0 ? "Resume" : "Play";
      playBtn.disabled = playing || !sched;
      pauseBtn.disabled = !playing;
    }
    function play() {
      if (!sched) return;
      if (finished || sNow === 0) { sNow = 0; finished = false; lanes.forEach(function (l) { l.shown = null; Demo.clear(l.L.paths); }); }
      if (Demo.reduced) { sNow = sched.total; finished = true; render(sNow); speedEl.textContent = "Reduced motion: showing the result"; syncBtns(); return; }
      playing = true; lastTs = performance.now();
      syncBtns();
      raf = requestAnimationFrame(frame);
    }
    function pause() { playing = false; cancelAnimationFrame(raf); syncBtns(); }
    playBtn.addEventListener("click", play);
    pauseBtn.addEventListener("click", pause);
    Demo.on("pair", function () { build(); syncBtns(); });
    Demo.on("slide", function (id) { if (id !== "connect" && playing) pause(); });
    build(); syncBtns();
  }

  Demo.inits.push(initProblem, initProfiler, initConnect);
})();
