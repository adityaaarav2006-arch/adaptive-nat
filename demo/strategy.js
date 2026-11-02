/*
 * strategy.js - line-for-line port of strategy.py (kind, lenient, block_spray_size, choose).
 *
 * Keep this file in sync with strategy.py: tools/test_strategy_port.py runs both on every
 * ordered pair of the 21 NAT types plus the port-block types and fails on any difference.
 *
 * A profile is {mapping: "EI"|"AD"|"APD", filtering: "EI"|"AD"|"APD",
 *               allocation: "sequential"|"fixed-delta"|"random"|null, block: [firstPort, size]|null}.
 * choose(pa, pb, opts, trace) returns the same fields as strategy.Plan. If `trace` is an array,
 * every rung that was evaluated is pushed onto it, so the page can explain the decision without
 * a second copy of the rules.
 */
(function (root) {
  "use strict";

  var PORT_MIN = 1024, PORT_MAX = 65535;
  var R_SPACE = PORT_MAX - PORT_MIN + 1;
  var SPRAY_TARGET = 0.99;   // block-aware spraying is sized for this success probability

  function kind(p) {
    if (p.mapping === "EI") return "fixed";
    return (p.allocation === "sequential" || p.allocation === "fixed-delta") ? "pred" : "rand";
  }

  function lenient(p) {
    return p.filtering === "EI" || p.filtering === "AD";
  }

  // Smallest N = M with 1 - exp(-N*M/r) >= target (birthday bound), capped at r/2.
  function blockSpraySize(r, target) {
    if (target === undefined) target = SPRAY_TARGET;
    var n = Math.ceil(Math.sqrt(r * Math.log(1 / (1 - target))));
    return Math.min(n, Math.floor(r / 2));
  }

  function makePlan(method, reason, extra) {
    var p = {method: method, reason: reason, opener: null, nOpen: 0, mProbe: 0, pSuccess: null,
             rangeLo: PORT_MIN, rangeSize: R_SPACE};
    for (var k in extra) p[k] = extra[k];
    return p;
  }

  function choose(pa, pb, opts, trace) {
    opts = opts || {};
    var packetBudget = opts.packetBudget !== undefined ? opts.packetBudget : 1600;
    var nOpen = opts.nOpen !== undefined ? opts.nOpen : 256;
    var blockAware = opts.blockAware !== undefined ? opts.blockAware : true;
    var log = Array.isArray(trace) ? function (e) { trace.push(e); } : function () {};

    var ka = kind(pa), kb = kind(pb);
    log({rung: "DIRECT", ok: ka === "fixed" && kb === "fixed", ka: ka, kb: kb});
    if (ka === "fixed" && kb === "fixed") {
      return makePlan("DIRECT", "both endpoint-independent mapping");
    }
    var bothPred = (ka === "fixed" || ka === "pred") && (kb === "fixed" || kb === "pred");
    log({rung: "PREDICT", test: "both", ok: bothPred, ka: ka, kb: kb});
    if (bothPred) {
      return makePlan("PREDICT", "both ports predictable (" + ka + "/" + kb + ")");
    }
    // lenient side with a predictable port: the other side aims at it. The lenient side answers
    // each probe toward the other side's (unknown) port; under APD mapping that answer leaves from
    // a NEW port, which a strict peer filter drops. So this rung needs a reused mapping on our side
    // (fixed or AD), a lenient peer, or a peer with AD mapping.
    var sides = [[pa, pb, ka, "A"], [pb, pa, kb, "B"]];
    for (var i = 0; i < 2; i++) {
      var me = sides[i][0], other = sides[i][1], km = sides[i][2], label = sides[i][3];
      var why = {meFixed: km === "fixed", meAD: me.mapping === "AD", otherLenient: lenient(other),
                 otherAD: other.mapping === "AD"};
      var replyOk = why.meFixed || why.meAD || why.otherLenient || why.otherAD;
      var predictable = km === "fixed" || km === "pred";
      var ok = predictable && lenient(me) && replyOk;
      log({rung: "PREDICT", test: "lenient", side: label, km: km, predictable: predictable,
           lenient: lenient(me), replyOk: replyOk, why: why, ok: ok});
      if (ok) {
        return makePlan("PREDICT", label + " is lenient and its port is " + km);
      }
    }
    // spray: pick an opener (random side that is lenient, or random side facing a fixed peer).
    // The opener answers a hit from the socket that was hit. Under AD mapping (or toward a fixed
    // peer) that reuses the same mapping; under APD mapping toward a non-fixed prober the reply
    // leaves from a NEW port, so the prober must then be lenient itself.
    var cands = [[pa, pb, ka, kb, "A"], [pb, pa, kb, ka, "B"]];
    if (blockAware) {   // prefer a side whose ports sit in a small block as the opener (stable order)
      cands = cands.filter(function (c) { return c[0].block; })
        .concat(cands.filter(function (c) { return !c[0].block; }));
    }
    for (var j = 0; j < cands.length; j++) {
      var cme = cands[j][0], cother = cands[j][1], ckm = cands[j][2], cko = cands[j][3], clabel = cands[j][4];
      var cwhy = {otherFixed: cko === "fixed", meAD: cme.mapping === "AD", otherLenient: lenient(cother)};
      var creplyOk = cwhy.otherFixed || cwhy.meAD || cwhy.otherLenient;
      var canOpen = ckm === "rand" && (lenient(cme) || cko === "fixed");
      var cok = canOpen && creplyOk;
      var entry = {rung: "SPRAY", side: clabel, km: ckm, ko: cko, random: ckm === "rand", lenient: lenient(cme),
                   canOpen: canOpen, replyOk: creplyOk, why: cwhy, block: cme.block || null, ok: cok};
      log(entry);
      if (cok) {
        if (blockAware && cme.block) {
          // Port-block-aware spraying: the opener's new ports all fall inside its detected block,
          // so the search space is the block, not the whole port range.
          var lo = cme.block[0], size = cme.block[1];
          var n = blockSpraySize(size);
          var p = 1 - Math.exp(-n * n / size);
          return makePlan("SPRAY", clabel + " random in a " + size + "-port block, opener=" + clabel,
                          {opener: clabel, nOpen: n, mProbe: n, pSuccess: p, rangeLo: lo, rangeSize: size});
        }
        var m = Math.max(0, packetBudget - 2 * nOpen);
        var capped = false;
        if (blockAware && cother.block && cko !== "fixed") {
          // every probe from a non-fixed prober opens a new mapping; a port block caps how many it
          // can hold, and probes beyond that would just be dropped by its NAT
          var cap = Math.trunc(0.75 * cother.block[1]);
          capped = cap < m;
          m = Math.min(m, cap);
        }
        if (m <= 0) {
          entry.ok = false;          // the side qualified, but there is no budget left to probe with
          entry.budgetTooSmall = true;
          log({rung: "RELAY", ok: true, budget: true});
          return makePlan("RELAY", "packet budget too small to spray");
        }
        var ps = 1 - Math.exp(-nOpen * m / R_SPACE);
        return makePlan("SPRAY", clabel + " random, opener=" + clabel,
                        {opener: clabel, nOpen: nOpen, mProbe: m, pSuccess: ps, capped: capped});
      }
    }
    log({rung: "RELAY", ok: true, budget: false});
    return makePlan("RELAY", "no viable direct method (" + ka + "/" + kb + ", filters too strict)");
  }

  // Same short label as profiler.Profile.short(), e.g. "APD/APD/Blk512".
  function label(p) {
    var a = p.mapping === "EI" ? "-" :
      p.block ? "Blk" + p.block[1] : {"sequential": "Seq", "fixed-delta": "Fixed", "random": "Rand"}[p.allocation];
    return p.mapping + "/" + p.filtering + "/" + a;
  }

  // Pairing class used by analyze.py.
  function natClass(p) {
    return p.mapping === "EI" ? "Cone" : kind(p) === "pred" ? "Sym-Pred" : "Sym-Rand";
  }

  var api = {PORT_MIN: PORT_MIN, PORT_MAX: PORT_MAX, R_SPACE: R_SPACE, SPRAY_TARGET: SPRAY_TARGET,
             kind: kind, lenient: lenient, blockSpraySize: blockSpraySize, choose: choose, label: label,
             natClass: natClass};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NATStrategy = api;
})(typeof window !== "undefined" ? window : this);
