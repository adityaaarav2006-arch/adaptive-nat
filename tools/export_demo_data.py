"""
export_demo_data.py - build demo/data.js (window.DEMO_DATA) from the result files.

Every number the demo page shows comes from here. The script recomputes each
metric from the raw CSVs, cross-checks it against the summary files written by
analyze.py / analyze_blocks.py / paper_numbers.py, and compares it with the
values quoted in the paper. It prints one PASS/FAIL line per check and exits
with status 1 if any check fails (data.js is still written, so the failure can
be inspected, but it must not be presented until the cause is understood).

Run from the repository root:  python tools/export_demo_data.py
"""
import csv
import datetime
import json
import os
import statistics as st
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "demo", "data.js")


def path(*p):
    return os.path.join(ROOT, *p)


def rows(*p):
    with open(path(*p), newline="") as fh:
        return list(csv.DictReader(fh))


def load_json(*p):
    with open(path(*p)) as fh:
        return json.load(fh)


def pct(L, key="d"):
    return 100 * sum(x[key] for x in L) / len(L)


def med(L, key):
    return st.median(x[key] for x in L)


def r3(x):
    return None if x is None else round(x, 6)


SOURCES = ["evaluation_results.csv", "accuracy_results.csv", "accuracy_blocks.csv", "evaluation_blocks.csv",
           "blocks_summary.json", "testbed/testbed_results.csv", "testbed/testbed_blocks.csv",
           "summary_by_class.csv", "summary_by_method.csv", "paper_numbers.json"]
M_ABBR = {"endpoint-independent": "EI", "address-dependent": "AD", "address-and-port-dependent": "APD"}
A_ABBR = {"sequential": "Seq", "fixed-delta": "Fixed", "random": "Rand", "block-random": "Blk512", "n/a": "-"}
D = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "sources": SOURCES}

# ------------------------------------------------------------------ meta
D["meta"] = {
    "title": "Adaptive NAT Traversal",
    "subtitle": "Behaviour-Aware Hole Punching",
    "course": "BCSE308P Computer Networks",
    "guide": "Jaya Subalakshmi R",
    "authors": [{"name": "Aditya Jaiswal", "reg": "24BCE2365"}, {"name": "Chiranjib Dash", "reg": "24BCE2411"}],
}

# ------------------------------------------------------------------ profiler accuracy
def acc_section(rs):
    out = {"configs": [], "byMapping": {}, "byFiltering": {}}
    for r in rs:
        r["ok"] = r["mapping_ok"] == r["filtering_ok"] == r["allocation_ok"] == "True"
        r["s"] = float(r["seconds"])
        r["label"] = f"{M_ABBR[r['mapping']]}/{M_ABBR[r['filtering']]}/{A_ABBR[r['allocation']]}"
    labels = []
    for r in rs:
        if r["label"] not in labels:
            labels.append(r["label"])
    for lab in labels:
        L = [r for r in rs if r["label"] == lab]
        out["configs"].append({
            "label": lab, "mapping": M_ABBR[L[0]["mapping"]], "filtering": M_ABBR[L[0]["filtering"]],
            "allocation": L[0]["allocation"], "ok": sum(r["ok"] for r in L), "n": len(L),
            "runs": [{"ok": r["ok"], "detected": r["detected"], "s": r["s"], "probes": int(r["probes"]),
                      "delta": r["delta"] or None, "trueBlock": r["true_block"] or None,
                      "detectedBlock": r["detected_block"] or None} for r in L],
            "secondsMedian": st.median(r["s"] for r in L), "probes": int(st.median(int(r["probes"]) for r in L)),
        })
    for key, field, target in (("byMapping", "mapping", out["byMapping"]), ("byFiltering", "filtering", out["byFiltering"])):
        for full, ab in M_ABBR.items():
            L = [r for r in rs if r[field] == full]
            if L:
                target[ab] = {"ok": sum(r["ok"] for r in L), "n": len(L),
                              "secondsMedian": st.median(r["s"] for r in L), "secondsMin": min(r["s"] for r in L),
                              "secondsMax": max(r["s"] for r in L)}
    out["ok"] = sum(r["ok"] for r in rs)
    out["n"] = len(rs)
    out["reps"] = len({r["rep"] for r in rs})
    return out


acc = rows("accuracy_results.csv")
accb = rows("accuracy_blocks.csv")
D["accuracy"] = acc_section(acc)
D["accuracy"]["probesEI"] = int(st.median(int(r["probes"]) for r in acc if r["mapping"] == "endpoint-independent"))
D["accuracy"]["probesOther"] = int(st.median(int(r["probes"]) for r in acc if r["mapping"] != "endpoint-independent"))
D["accuracyBlocks"] = acc_section(accb)

# ------------------------------------------------------------------ simulation
ev = rows("evaluation_results.csv")
for r in ev:
    r["t"] = float(r["t_connect"]); r["p"] = int(r["packets"]); r["d"] = r["path"] == "direct"


def cls(n):
    m, f, a = n.split("/")
    return "Cone" if m == "EI" else ("Sym-Pred" if a in ("Seq", "Fixed") else "Sym-Rand")


ORDER = {"Cone": 0, "Sym-Pred": 1, "Sym-Rand": 2}
CLASSES = ["Cone / Cone", "Cone / Sym-Pred", "Cone / Sym-Rand", "Sym-Pred / Sym-Pred", "Sym-Pred / Sym-Rand",
           "Sym-Rand / Sym-Rand"]
by = defaultdict(list)
for r in ev:
    a, b = sorted([cls(r["nat_a"]), cls(r["nat_b"])], key=ORDER.get)
    by[(r["agent"], f"{a} / {b}")].append(r)
    by[(r["agent"], "All")].append(r)
ice, adp = by[("ice", "All")], by[("adaptive", "All")]
sim = {
    "sessionsPerAgent": len(adp),
    "pairings": len({(r["nat_a"], r["nat_b"]) for r in adp}),
    "trials": len({r["trial"] for r in adp}),
    "natTypes": len({r["nat_a"] for r in ev} | {r["nat_b"] for r in ev}),
    "adaptive": {"direct": pct(adp), "tMed": med(adp, "t"), "pktsMed": med(adp, "p"),
                 "okAll": all(r["ok"] == "True" for r in adp), "ok": sum(r["ok"] == "True" for r in adp)},
    "ice": {"direct": pct(ice), "tMed": med(ice, "t"), "pktsMed": med(ice, "p"),
            "okAll": all(r["ok"] == "True" for r in ice), "ok": sum(r["ok"] == "True" for r in ice),
            "relayTMed": st.median(r["t"] for r in ice if not r["d"]),
            "directTMed": st.median(r["t"] for r in ice if r["d"])},
    "classes": [],
    "methods": [],
}
sim["adaptive"]["directTMed"] = st.median(r["t"] for r in adp if r["d"])
for c in CLASSES + ["All"]:
    I, A_ = by[("ice", c)], by[("adaptive", c)]
    sim["classes"].append({"cls": c, "short": c.replace("Sym-", "S-").replace(" / ", "/"), "n": len(A_),
                           "iceDirect": pct(I), "adpDirect": pct(A_), "iceT": med(I, "t"), "adpT": med(A_, "t"),
                           "iceP": med(I, "p"), "adpP": med(A_, "p")})
for m in ("DIRECT", "PREDICT", "SPRAY", "RELAY"):
    L = [r for r in adp if r["plan"] == m]
    ps = [float(r["p_spray"]) for r in L if r["p_spray"] not in ("", "None")]
    sim["methods"].append({"method": m, "n": len(L), "direct": pct(L), "tMed": med(L, "t"), "tMax": max(r["t"] for r in L),
                           "pktsMed": med(L, "p"), "pModel": st.mean(ps) if ps else None})
wins = defaultdict(lambda: [0, 0])
for r in ev:
    wins[(r["nat_a"], r["nat_b"])][0 if r["agent"] == "ice" else 1] += r["d"]
sim["pairsIceBetter"] = sum(v[0] > v[1] for v in wins.values())
sim["pairsAdpBetter"] = sum(v[1] > v[0] for v in wins.values())
sim["pairsEqual"] = sum(v[0] == v[1] for v in wins.values())
D["sim"] = sim


def agent_summary(L):
    return {"direct": sum(x["d"] for x in L), "n": len(L), "tMed": med(L, "t"), "pktsMed": med(L, "p"),
            "t": [r3(x["t"]) for x in L], "pkts": [x["p"] for x in L], "paths": [x["path"] for x in L],
            "ok": all(x["ok"] == "True" for x in L)}


def plan_fields(L):
    """Plan, reason and spray parameters; these are deterministic per pairing, so all trials must agree."""
    keys = [k for k in ("plan", "reason", "n_open", "m_probe", "spray_range", "p_spray") if k in L[0]]
    for k in keys:
        if len({x[k] for x in L}) != 1:
            raise SystemExit(f"plan field {k} differs between trials of {L[0]['nat_a']} | {L[0]['nat_b']}")
    out = {"plan": L[0]["plan"], "reason": L[0]["reason"],
           "pSpray": float(L[0]["p_spray"]) if L[0].get("p_spray") not in ("", None, "None") else None}
    if "n_open" in L[0]:
        out.update(nOpen=int(L[0]["n_open"]), mProbe=int(L[0]["m_probe"]), sprayRange=int(L[0]["spray_range"]))
    return out


pairings = {}
pg = defaultdict(lambda: defaultdict(list))
for r in ev:
    pg[(r["nat_a"], r["nat_b"])][r["agent"]].append(r)
for (a, b), ags in pg.items():
    pairings[f"{a}|{b}"] = dict(a=a, b=b, **plan_fields(ags["adaptive"]),
                                adaptive=agent_summary(ags["adaptive"]), ice=agent_summary(ags["ice"]))
D["pairings"] = pairings

# ------------------------------------------------------------------ port blocks (simulation)
eb = rows("evaluation_blocks.csv")
for r in eb:
    r["t"] = float(r["t_connect"]); r["p"] = int(r["packets"]); r["d"] = r["path"] == "direct"
key = lambda r: (r["nat_a"], r["nat_b"], r["trial"])
byag = defaultdict(dict)
for r in eb:
    byag[r["agent"]][key(r)] = r
aw, un, ic = byag["block-aware"], byag["block-unaware"], byag["ice"]
spray_keys = [k for k in aw if aw[k]["plan"] == "SPRAY" or un[k]["plan"] == "SPRAY"]
blk_keys = [k for k in spray_keys if aw[k]["spray_range"] not in ("", "64512")]
blocks = {"sessions": len(aw), "sprayKeys": len(spray_keys), "blockSessions": len(blk_keys), "sim": {}}
for name, Dd in (("aware", aw), ("unaware", un), ("ice", ic)):
    L = [Dd[k] for k in blk_keys]
    blocks["sim"][name] = {"direct": pct(L), "pktsMed": med(L, "p"), "pktsMean": st.mean(x["p"] for x in L),
                           "tMed": med(L, "t"), "ok": all(x["ok"] == "True" for x in L)}
blocks["sim"]["modelPAware"] = st.mean(float(aw[k]["p_spray"]) for k in blk_keys)
blocks["sim"]["packetReduction"] = blocks["sim"]["unaware"]["pktsMed"] / blocks["sim"]["aware"]["pktsMed"]
bpairs = {}
bg = defaultdict(lambda: defaultdict(list))
for r in eb:
    bg[(r["nat_a"], r["nat_b"])][r["agent"]].append(r)
for (a, b), ags in bg.items():
    bpairs[f"{a}|{b}"] = dict(a=a, b=b, aware=dict(**plan_fields(ags["block-aware"]), **agent_summary(ags["block-aware"])),
                              unaware=dict(**plan_fields(ags["block-unaware"]), **agent_summary(ags["block-unaware"])),
                              ice=agent_summary(ags["ice"]))
blocks["pairings"] = bpairs

# ------------------------------------------------------------------ port blocks (real Linux NAT)
tbb = rows("testbed", "testbed_blocks.csv")
blocks["testbed"] = {"natA": tbb[0]["nat_a"], "natB": tbb[0]["nat_b"]}
for ag, name in (("block-aware", "aware"), ("block-unaware", "unaware"), ("aioice", "aioice")):
    L = [r for r in tbb if r["agent"] == ag]
    pk = [int(r["packets"]) for r in L if r["packets"]]
    tt = [float(r["t_connect"]) for r in L]
    blocks["testbed"][name] = {
        "direct": sum(r["path"] == "direct" for r in L), "n": len(L), "tMed": st.median(tt), "t": [r3(x) for x in tt],
        "pkts": pk, "pktsMed": st.median(pk) if pk else None, "pktsMin": min(pk) if pk else None,
        "pktsMax": max(pk) if pk else None, "errors": sorted({r["err"] for r in L if r["err"]}),
        "profiles": sorted({(r["profile_a"], r["profile_b"]) for r in L if r["profile_a"]}),
        "nOpen": int(L[0]["n_open"]) if L[0]["n_open"] else None, "mProbe": int(L[0]["m_probe"]) if L[0]["m_probe"] else None,
        "sprayRange": int(L[0]["spray_range"]) if L[0]["spray_range"] else None,
    }
D["blocks"] = blocks

# ------------------------------------------------------------------ real Linux NAT testbed
tb = rows("testbed", "testbed_results.csv")
for r in tb:
    r["t"] = float(r["t_connect"]); r["d"] = r["path"] == "direct"
SHORT = {"full-cone": "FC", "port-restricted": "PR", "symmetric": "Sym"}
order = []
for r in tb:
    k = (r["nat_a"], r["nat_b"])
    if k not in order:
        order.append(k)
trow = []
for k in order:
    row = {"a": k[0], "b": k[1], "label": f"{SHORT[k[0]]}/{SHORT[k[1]]}"}
    for ag in ("adaptive", "aioice"):
        L = [r for r in tb if (r["nat_a"], r["nat_b"]) == k and r["agent"] == ag]
        pk = [int(r["packets"]) for r in L if r["packets"]]
        row[ag] = {"direct": sum(x["d"] for x in L), "n": len(L), "tMed": med(L, "t"), "t": [r3(x["t"]) for x in L],
                   "paths": [x["path"] for x in L], "errors": [x["err"] for x in L],
                   "pktsMed": st.median(pk) if pk else None, "plan": L[0]["plan"],
                   "profileA": L[0]["profile_a"] or None, "profileB": L[0]["profile_b"] or None,
                   "tProfileMed": st.median(float(x["t_profile"]) for x in L)}
    trow.append(row)
profiles = {}
for r in tb:
    if r["agent"] == "adaptive":
        profiles[r["nat_a"]] = r["profile_a"]; profiles[r["nat_b"]] = r["profile_b"]
profiles["symmetric-block"] = blocks["testbed"]["aware"]["profiles"][0][1]
tprof = defaultdict(list)
for r in tb:
    if r["agent"] == "adaptive" and r["nat_a"] == r["nat_b"]:
        tprof[r["nat_a"]].append(float(r["t_profile"]))
D["testbed"] = {
    "rows": trow, "trials": len({r["trial"] for r in tb}), "profiles": profiles,
    "adaptive": {"direct": sum(r["d"] for r in tb if r["agent"] == "adaptive"), "n": sum(r["agent"] == "adaptive" for r in tb)},
    "aioice": {"direct": sum(r["d"] for r in tb if r["agent"] == "aioice"), "n": sum(r["agent"] == "aioice" for r in tb)},
    # profiling time on a real NAT where both sides have the same type (one profile measured per session)
    "profileSecondsMedian": {k: st.median(v) for k, v in tprof.items() if v},
}

# ------------------------------------------------------------------ qualitative observations (not in a result file)
D["notes"] = {
    "sharedSocketWeek3": {"before": "12/15", "after": "15/15", "source": "profiler.py docstring (Week 3 simulator run)"},
    "conntrackRemap": {"before": 58330, "after": 52320,
                       "source": "observed in /proc/net/nf_conntrack on the testbed (team lab notes, not a result file)"},
    "aioiceFcFcTimeout": {"reruns": 6, "reproduced": False,
                          "source": "team reruns of the FC/FC aioice session (lab notes, not a result file)"},
    "openTtl": 2, "tBudget": 2.5, "iceTa": 0.05, "probeTimeout": 0.5, "probeRetries": 3, "allocProbes": 12,
    "packetBudget": 1600, "nOpenDefault": 256, "window": 16, "sprayTarget": 0.99, "portRange": 64512,
    "blockSize": 512, "constantsSource": "agents.py, strategy.py, profiler.py, stun_server.py, nat_sim.py",
}

# ================================================================== checks
checks = []


def check(name, expected, actual, ok=None):
    ok = (str(expected) == str(actual)) if ok is None else ok
    checks.append({"name": name, "expected": str(expected), "actual": str(actual), "pass": bool(ok)})


def ms(x):
    return f"{x * 1000:.0f} ms"


f1 = lambda x: f"{x:.1f}"
A = D["accuracy"]
check("Profiler accuracy", "105/105", f"{A['ok']}/{A['n']}")
for k, e in (("EI", "15/15"), ("AD", "45/45"), ("APD", "45/45")):
    check(f"Profiler accuracy, {k} mapping", e, f"{A['byMapping'][k]['ok']}/{A['byMapping'][k]['n']}")
check("Block detection", "30/30", f"{D['accuracyBlocks']['ok']}/{D['accuracyBlocks']['n']}")
check("Simulation sessions per agent", 693, sim["sessionsPerAgent"])
check("Simulation pairings x trials", "231 x 3", f"{sim['pairings']} x {sim['trials']}")
check("Direct %, adaptive", "88.0", f1(sim["adaptive"]["direct"]))
check("Direct %, ICE", "36.4", f1(sim["ice"]["direct"]))
check("Median time to working path, adaptive (s)", "0.057", f"{sim['adaptive']['tMed']:.3f}")
check("Median time to working path, ICE (s)", "2.543", f"{sim['ice']['tMed']:.3f}")
EXP_CLS = {"Cone / Cone": (100, 100), "Cone / Sym-Pred": (66.7, 100), "Cone / Sym-Rand": (66.7, 100),
           "Sym-Pred / Sym-Pred": (24.4, 100), "Sym-Pred / Sym-Rand": (25.0, 71.3), "Sym-Rand / Sym-Rand": (23.8, 66.7)}
for c in sim["classes"]:
    if c["cls"] in EXP_CLS:
        e = EXP_CLS[c["cls"]]
        check(f"Class {c['short']}: ICE / adaptive direct %", f"{e[0]:.1f} / {e[1]:.1f}",
              f"{c['iceDirect']:.1f} / {c['adpDirect']:.1f}")
EXP_M = {"DIRECT": (18, "100.0", 12), "PREDICT": (510, "100.0", 74), "SPRAY": (84, "97.6", 440), "RELAY": (81, "0.0", 6)}
for m in sim["methods"]:
    e = EXP_M[m["method"]]
    check(f"Method {m['method']}: n, direct %, median packets", f"{e[0]}, {e[1]}, {e[2]}",
          f"{m['n']}, {m['direct']:.1f}, {m['pktsMed']:.0f}")
spray = next(m for m in sim["methods"] if m["method"] == "SPRAY")
relay = next(m for m in sim["methods"] if m["method"] == "RELAY")
check("SPRAY model success %", "98.7", f1(100 * spray["pModel"]))
check("RELAY median time (ms)", "5.4", f1(1000 * relay["tMed"]))
check("ICE median packets", 106, f"{sim['ice']['pktsMed']:.0f}")
check("Pairings ICE better / adaptive better / equal", "0 / 120 / 111",
      f"{sim['pairsIceBetter']} / {sim['pairsAdpBetter']} / {sim['pairsEqual']}")
check("Every simulated session delivered data (both agents)", "693 / 693", f"{sim['adaptive']['ok']} / {sim['ice']['ok']}")
T = D["testbed"]
check("Testbed direct, ours vs aioice", "25/30 vs 14/30",
      f"{T['adaptive']['direct']}/{T['adaptive']['n']} vs {T['aioice']['direct']}/{T['aioice']['n']}")
EXP_T = {"FC/FC": "5/5 DIRECT | 4/5", "FC/PR": "5/5 DIRECT | 5/5", "FC/Sym": "5/5 PREDICT | 5/5",
         "PR/PR": "5/5 DIRECT | 0/5", "PR/Sym": "5/5 SPRAY 319 ms | 0/5", "Sym/Sym": "0/5 RELAY 6 ms | 0/5 15.0 s TimeoutError"}
for r in T["rows"]:
    ad, ai = r["adaptive"], r["aioice"]
    act = f"{ad['direct']}/{ad['n']} {ad['plan']}"
    if r["label"] in ("PR/Sym", "Sym/Sym"):
        act += f" {ms(ad['tMed'])}"
    act += f" | {ai['direct']}/{ai['n']}"
    if r["label"] == "Sym/Sym":
        act += f" {ai['tMed']:.1f} s {'/'.join(sorted(set(e for e in ai['errors'] if e)))}"
    check(f"Testbed {r['label']}: ours | aioice", EXP_T[r["label"]], act)
fcfc = next(r for r in T["rows"] if r["label"] == "FC/FC")["aioice"]
check("Testbed FC/FC aioice: one timeout", "1 TimeoutError", f"{sum(1 for e in fcfc['errors'] if e)} {'/'.join(e for e in fcfc['errors'] if e)}")
B = blocks["sim"]
check("Block sim sessions", 102, blocks["blockSessions"])
check("Block sim direct %, aware vs unaware", "98.0 vs 98.0", f"{B['aware']['direct']:.1f} vs {B['unaware']['direct']:.1f}")
check("Block sim median packets, aware vs unaware", "92 vs 424", f"{B['aware']['pktsMed']:.0f} vs {B['unaware']['pktsMed']:.0f}")
check("Block sim median time, aware vs unaware", "83 ms vs 196 ms", f"{ms(B['aware']['tMed'])} vs {ms(B['unaware']['tMed'])}")
check("Block sim ICE direct %", "26.5", f1(B["ice"]["direct"]))
BT = blocks["testbed"]
check("Block testbed direct, aware / unaware / aioice", "10/10, 10/10, 0/5",
      f"{BT['aware']['direct']}/{BT['aware']['n']}, {BT['unaware']['direct']}/{BT['unaware']['n']}, {BT['aioice']['direct']}/{BT['aioice']['n']}")
check("Block testbed packets, aware", "92 (90-95)", f"{round(BT['aware']['pktsMed'])} ({BT['aware']['pktsMin']}-{BT['aware']['pktsMax']})")
check("Block testbed packets, unaware", "472 (296-1448)", f"{round(BT['unaware']['pktsMed'])} ({BT['unaware']['pktsMin']}-{BT['unaware']['pktsMax']})")
check("Block testbed median time, aware vs unaware", "86 ms vs 228 ms", f"{ms(BT['aware']['tMed'])} vs {ms(BT['unaware']['tMed'])}")

# ---------------- cross-check against the summary files written by the analysis scripts
xchecks = []


def xcheck(name, theirs, ours, tol=1e-6):
    try:
        ok = abs(float(theirs) - float(ours)) <= tol
    except (TypeError, ValueError):
        ok = str(theirs) == str(ours)
    xchecks.append({"name": name, "expected": str(theirs), "actual": str(ours), "pass": ok})


for s in rows("summary_by_class.csv"):
    c = next(x for x in sim["classes"] if x["cls"] == s["cls"])
    for k, ours in (("ice_direct", c["iceDirect"]), ("adp_direct", c["adpDirect"]), ("ice_t", c["iceT"]),
                    ("adp_t", c["adpT"]), ("ice_p", c["iceP"]), ("adp_p", c["adpP"]), ("n", c["n"])):
        xcheck(f"summary_by_class {s['cls']} {k}", s[k], ours)
for s in rows("summary_by_method.csv"):
    m = next(x for x in sim["methods"] if x["method"] == s["method"])
    for k, ours in (("n", m["n"]), ("direct", m["direct"]), ("t_med", m["tMed"]), ("pkts_med", m["pktsMed"])):
        xcheck(f"summary_by_method {s['method']} {k}", s[k], ours)
    if s["p_model"]:
        xcheck(f"summary_by_method {s['method']} p_model", s["p_model"], m["pModel"])
PN = load_json("paper_numbers.json")
for k, ours in (("acc_all", f"{A['ok']}/{A['n']}"), ("acc_EI", f"{A['byMapping']['EI']['ok']}/{A['byMapping']['EI']['n']}"),
                ("acc_AD", f"{A['byMapping']['AD']['ok']}/{A['byMapping']['AD']['n']}"),
                ("acc_APD", f"{A['byMapping']['APD']['ok']}/{A['byMapping']['APD']['n']}"),
                ("sim_sessions_per_agent", sim["sessionsPerAgent"]), ("sim_pairings", sim["pairings"]),
                ("sim_adp_direct", round(sim["adaptive"]["direct"], 1)), ("sim_ice_direct", round(sim["ice"]["direct"], 1)),
                ("sim_adp_tmed_all", round(sim["adaptive"]["tMed"], 3)), ("sim_ice_tmed_all", round(sim["ice"]["tMed"], 3)),
                ("spray_model_p", round(100 * spray["pModel"], 1)), ("ice_pkts", sim["ice"]["pktsMed"]),
                ("pairs_ice_better", sim["pairsIceBetter"]), ("pairs_adp_better", sim["pairsAdpBetter"]),
                ("pairs_equal", sim["pairsEqual"]), ("adp_relayplan_tmed_ms", round(1000 * relay["tMed"], 1)),
                ("ice_relay_tmed", round(sim["ice"]["relayTMed"], 2)),
                ("tb_adp", f"{T['adaptive']['direct']}/{T['adaptive']['n']}"), ("tb_ice", f"{T['aioice']['direct']}/{T['aioice']['n']}"),
                ("probes_EI", A["probesEI"]), ("probes_other", A["probesOther"])):
    xcheck(f"paper_numbers {k}", PN[k], ours)
BS = load_json("blocks_summary.json")
for name, k in (("aware", "block-aware_blk"), ("unaware", "block-unaware_blk"), ("ice", "ice_blk")):
    xcheck(f"blocks_summary {k} direct", BS[k]["direct"], round(B[name]["direct"], 1))
    xcheck(f"blocks_summary {k} pkts_med", BS[k]["pkts_med"], B[name]["pktsMed"])
    xcheck(f"blocks_summary {k} t_med", BS[k]["t_med"], round(B[name]["tMed"], 3))
xcheck("blocks_summary n_block_sessions", BS["n_block_sessions"], blocks["blockSessions"])
xcheck("blocks_summary model_p_aware", BS["model_p_aware"], round(100 * B["modelPAware"], 1))
xcheck("blocks_summary packet_reduction", BS["packet_reduction"], round(B["packetReduction"], 1))
for name in ("block-aware", "block-unaware"):
    n2 = name.split("-")[1]
    xcheck(f"blocks_summary testbed {name} pkts_med", BS["testbed"][name]["pkts_med"], BT[n2]["pktsMed"])
    xcheck(f"blocks_summary testbed {name} t_med_ms", BS["testbed"][name]["t_med_ms"], round(1000 * BT[n2]["tMed"]))

# Profiling-time keys in paper_numbers.json are informational only (not shown from that file): report if stale.
warnings = []
for k, f in (("prof_t_EI", "endpoint-independent"), ("prof_t_AD", "address-dependent"), ("prof_t_APD", "address-and-port-dependent")):
    now = round(st.mean(float(r["seconds"]) for r in acc if r["filtering"] == f), 2)
    if PN[k] != now:
        warnings.append(f"paper_numbers.json {k} = {PN[k]}, but accuracy_results.csv now gives {now} "
                        f"(paper_numbers.json predates the current accuracy run; the demo uses the CSV)")

D["checks"] = checks
D["crossChecks"] = xchecks
D["warnings"] = warnings

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("// Generated by tools/export_demo_data.py - do not edit by hand.\n")
    fh.write(f"// Sources: {', '.join(SOURCES)}\n")
    fh.write("window.DEMO_DATA = ")
    json.dump(D, fh, separators=(",", ":"), default=list)
    fh.write(";\n")

w = max(len(c["name"]) for c in checks + xchecks)
print("Expected values")
for c in checks:
    print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['name']:{w}s}  expected {c['expected']:28s} got {c['actual']}")
print("Cross-check against summary files")
for c in xchecks:
    print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['name']:{w}s}  file {c['expected']:28s} raw {c['actual']}")
for x in warnings:
    print(f"  WARN  {x}")
nf = sum(not c["pass"] for c in checks + xchecks)
print(f"\n{len(checks) + len(xchecks) - nf}/{len(checks) + len(xchecks)} checks passed; wrote {os.path.relpath(OUT, ROOT)} "
      f"({os.path.getsize(OUT) // 1024} KB)")
sys.exit(1 if nf else 0)
