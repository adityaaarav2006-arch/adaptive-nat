"""
paper_numbers.py - every number quoted in the paper, computed from the result CSVs.
Writes paper_numbers.json; the paper template pulls values from it by key.
"""
import csv, json, statistics as st
from collections import defaultdict

N = {}
# ---------------- profiler accuracy (simulator, 21 configs x reps)
acc = list(csv.DictReader(open("accuracy_results.csv")))
reps = len({r["rep"] for r in acc})
N["acc_reps"] = reps
for m, key in (("endpoint-independent", "EI"), ("address-dependent", "AD"), ("address-and-port-dependent", "APD")):
    rows = [r for r in acc if r["mapping"] == m]
    ok = sum(r["mapping_ok"] == r["filtering_ok"] == r["allocation_ok"] == "True" for r in rows)
    N[f"acc_{key}"] = f"{ok}/{len(rows)}"
N["acc_all"] = f"{sum(r['mapping_ok'] == r['filtering_ok'] == r['allocation_ok'] == 'True' for r in acc)}/{len(acc)}"
for f, key in (("endpoint-independent", "EI"), ("address-dependent", "AD"), ("address-and-port-dependent", "APD")):
    N[f"prof_t_{key}"] = round(st.mean(float(r["seconds"]) for r in acc if r["filtering"] == f), 2)
N["prof_t_max"] = round(max(float(r["seconds"]) for r in acc), 2)
N["probes_EI"] = st.median(int(r["probes"]) for r in acc if r["mapping"] == "endpoint-independent")
N["probes_other"] = st.median(int(r["probes"]) for r in acc if r["mapping"] != "endpoint-independent")

# ---------------- simulator evaluation
ev = list(csv.DictReader(open("evaluation_results.csv")))
for r in ev:
    r["t"] = float(r["t_connect"]); r["p"] = int(r["packets"]); r["d"] = r["path"] == "direct"


def cls(n):
    m, f, a = n.split("/")
    return "Cone" if m == "EI" else ("Sym-Pred" if a in ("Seq", "Fixed") else "Sym-Rand")


ORDER = {"Cone": 0, "Sym-Pred": 1, "Sym-Rand": 2}
CLASSES = ["Cone / Cone", "Cone / Sym-Pred", "Cone / Sym-Rand", "Sym-Pred / Sym-Pred", "Sym-Pred / Sym-Rand", "Sym-Rand / Sym-Rand"]
by = defaultdict(list)
for r in ev:
    a, b = sorted([cls(r["nat_a"]), cls(r["nat_b"])], key=ORDER.get)
    by[(r["agent"], f"{a} / {b}")].append(r); by[(r["agent"], "All")].append(r)
ice, adp = by[("ice", "All")], by[("adaptive", "All")]
pct = lambda L: 100 * sum(x["d"] for x in L) / len(L)
N["sim_sessions_per_agent"] = len(adp)
N["sim_pairings"] = len({(r["nat_a"], r["nat_b"]) for r in adp})
N["sim_trials"] = len({r["trial"] for r in adp})
N["sim_ice_direct"] = round(pct(ice), 1)
N["sim_adp_direct"] = round(pct(adp), 1)
N["sim_ok_all"] = all(r["ok"] == "True" for r in ev)
N["sim_failed_sessions"] = sum(r["ok"] != "True" for r in ev)
# relay-bound sessions: time to a working path
adp_relay_plan = [r for r in adp if r["plan"] == "RELAY"]
N["adp_relayplan_n"] = len(adp_relay_plan)
N["adp_relayplan_tmed_ms"] = round(1000 * st.median(r["t"] for r in adp_relay_plan), 1) if adp_relay_plan else None
ice_relay = [r for r in ice if not r["d"]]
N["ice_relay_tmed"] = round(st.median(r["t"] for r in ice_relay), 2)
adp_direct = [r for r in adp if r["d"]]
N["adp_direct_tmed_ms"] = round(1000 * st.median(r["t"] for r in adp_direct), 1)
N["adp_direct_tmax"] = round(max(r["t"] for r in adp_direct), 2)
ice_direct = [r for r in ice if r["d"]]
N["ice_direct_tmed_ms"] = round(1000 * st.median(r["t"] for r in ice_direct), 1)
N["sim_adp_tmed_all"] = round(st.median(r["t"] for r in adp), 3)
N["sim_ice_tmed_all"] = round(st.median(r["t"] for r in ice), 3)
# methods
for m in ("DIRECT", "PREDICT", "SPRAY", "RELAY"):
    L = [r for r in adp if r["plan"] == m]
    N[f"m_{m}_n"] = len(L)
    if L:
        N[f"m_{m}_direct"] = round(pct(L), 1)
        N[f"m_{m}_pkts"] = st.median(r["p"] for r in L)
        N[f"m_{m}_tmed_ms"] = round(1000 * st.median(r["t"] for r in L), 1)
sp = [r for r in adp if r["plan"] == "SPRAY"]
if sp:
    N["spray_model_p"] = round(100 * st.mean(float(r["p_spray"]) for r in sp), 1)
N["ice_pkts"] = st.median(r["p"] for r in ice)
# pairings where ICE beat adaptive / adaptive beat ICE
wins = defaultdict(lambda: [0, 0])
for r in ev:
    wins[(r["nat_a"], r["nat_b"])][0 if r["agent"] == "ice" else 1] += r["d"]
N["pairs_ice_better"] = sum(v[0] > v[1] for v in wins.values())
N["pairs_adp_better"] = sum(v[1] > v[0] for v in wins.values())
N["pairs_equal"] = sum(v[0] == v[1] for v in wins.values())
# relay-only pairings (adaptive planned RELAY) and whether ICE ever went direct there
N["relay_plan_but_ice_direct"] = sum(1 for r in ice if r["d"] and any(
    x["plan"] == "RELAY" for x in adp if (x["nat_a"], x["nat_b"]) == (r["nat_a"], r["nat_b"])))
table4 = []
for c in CLASSES + ["All"]:
    I, D = by[("ice", c)], by[("adaptive", c)]
    fmt = lambda t: f"{t * 1000:.0f} ms" if t < 1 else f"{t:.2f} s"
    table4.append([c.replace("Sym-", "S-"), f"{pct(I):.0f}%", f"{pct(D):.0f}%",
                   fmt(st.median(x['t'] for x in I)), fmt(st.median(x['t'] for x in D))])
N["table4"] = table4
N["prof_sim_tmed"] = round(st.median(float(r["t_profile"]) for r in adp), 2)

# ---------------- real-kernel testbed
tb = list(csv.DictReader(open("testbed/testbed_results.csv")))
for r in tb:
    r["t"] = float(r["t_connect"]); r["d"] = r["path"] == "direct"
pairs = []
for r in tb:
    k = (r["nat_a"], r["nat_b"])
    if k not in pairs:
        pairs.append(k)
short = {"full-cone": "FC", "port-restricted": "PR", "symmetric": "Sym"}
table5, tot = [], {"adaptive": [0, 0], "aioice": [0, 0]}
for k in pairs:
    row = [f"{short[k[0]]} / {short[k[1]]}"]
    for ag in ("adaptive", "aioice"):
        L = [r for r in tb if (r["nat_a"], r["nat_b"]) == k and r["agent"] == ag]
        d = sum(x["d"] for x in L)
        tot[ag][0] += d; tot[ag][1] += len(L)
        tm = st.median(x["t"] for x in L)
        plan = L[0]["plan"] if ag == "adaptive" else ""
        row += [f"{d}/{len(L)}", (f"{tm * 1000:.0f} ms" if tm < 1 else f"{tm:.1f} s")]
        if ag == "adaptive":
            row.append(plan.title())
    table5.append(row)
N["table5"] = table5
N["tb_adp"] = f"{tot['adaptive'][0]}/{tot['adaptive'][1]}"
N["tb_ice"] = f"{tot['aioice'][0]}/{tot['aioice'][1]}"
N["tb_trials"] = len({r["trial"] for r in tb})
N["tb_profiles"] = sorted({(r["nat_a"], r["profile_a"]) for r in tb if r["agent"] == "adaptive"} |
                          {(r["nat_b"], r["profile_b"]) for r in tb if r["agent"] == "adaptive"})
N["tb_ice_errors"] = sorted({r["err"] for r in tb if r["agent"] == "aioice" and r["err"]})

json.dump(N, open("paper_numbers.json", "w"), indent=1, default=str)
for k, v in N.items():
    if not k.startswith("table"):
        print(f"{k:28s} {v}")
print("table4:"); [print("  ", r) for r in table4]
print("table5:"); [print("  ", r) for r in table5]
