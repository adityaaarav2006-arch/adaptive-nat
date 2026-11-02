"""
analyze.py - summarise evaluation_results.csv and draw the result figures.
"""
import csv
import statistics as st
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rows = list(csv.DictReader(open("evaluation_results.csv")))
for r in rows:
    r["t_connect"] = float(r["t_connect"]); r["packets"] = int(r["packets"]); r["direct"] = r["path"] == "direct"
    r["ok"] = r["ok"] == "True"; r["t_profile"] = float(r["t_profile"] or 0)


def cls(n):  # NAT label "M/F/A" -> class
    m, f, a = n.split("/")
    return "Cone" if m == "EI" else ("Sym-Pred" if a in ("Seq", "Fixed") else "Sym-Rand")


def pair_class(r):
    order = {"Cone": 0, "Sym-Pred": 1, "Sym-Rand": 2}
    a, b = sorted([cls(r["nat_a"]), cls(r["nat_b"])], key=order.get)
    return f"{a} / {b}"


CLASSES = ["Cone / Cone", "Cone / Sym-Pred", "Cone / Sym-Rand", "Sym-Pred / Sym-Pred", "Sym-Pred / Sym-Rand", "Sym-Rand / Sym-Rand"]
by = defaultdict(list)
for r in rows:
    by[(r["agent"], pair_class(r))].append(r)
    by[(r["agent"], "All")].append(r)

out = []
print(f"{'class':22s} {'n':>4s} | {'ICE direct':>10s} {'ADP direct':>10s} | {'ICE t_med':>9s} {'ADP t_med':>9s} | {'ICE pkts':>8s} {'ADP pkts':>8s}")
for c in CLASSES + ["All"]:
    I, D = by[("ice", c)], by[("adaptive", c)]
    rate = lambda L: 100 * sum(x["direct"] for x in L) / len(L)
    med = lambda L, k: st.median(x[k] for x in L)
    row = dict(cls=c, n=len(D), ice_direct=rate(I), adp_direct=rate(D), ice_t=med(I, "t_connect"), adp_t=med(D, "t_connect"),
               ice_p=med(I, "packets"), adp_p=med(D, "packets"), ice_ok=all(x["ok"] for x in I), adp_ok=all(x["ok"] for x in D))
    out.append(row)
    print(f"{c:22s} {len(D):4d} | {row['ice_direct']:9.1f}% {row['adp_direct']:9.1f}% | {row['ice_t']:8.3f}s {row['adp_t']:8.3f}s | {row['ice_p']:8.0f} {row['adp_p']:8.0f}")

with open("summary_by_class.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)

# by method (adaptive)
print("\nAdaptive agent by chosen method:")
meth = defaultdict(list)
for r in by[("adaptive", "All")]:
    meth[r["plan"]].append(r)
mrows = []
for m in ["DIRECT", "PREDICT", "SPRAY", "RELAY"]:
    L = meth.get(m, [])
    if not L:
        continue
    d = 100 * sum(x["direct"] for x in L) / len(L)
    ps = [float(x["p_spray"]) for x in L if x["p_spray"] not in ("", "None")]
    mrows.append(dict(method=m, n=len(L), direct=d, t_med=st.median(x["t_connect"] for x in L),
                      t_max=max(x["t_connect"] for x in L), pkts_med=st.median(x["packets"] for x in L),
                      p_model=st.mean(ps) if ps else ""))
    print(f"  {m:8s} n={len(L):4d} direct={d:5.1f}% t_med={mrows[-1]['t_med']:.3f}s t_max={mrows[-1]['t_max']:.3f}s pkts_med={mrows[-1]['pkts_med']:.0f}" + (f" model P={mrows[-1]['p_model']:.3f}" if ps else ""))
with open("summary_by_method.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(mrows[0])); w.writeheader(); w.writerows(mrows)

# pairings where adaptive is worse than ICE (honesty check)
worse = defaultdict(lambda: [0, 0])
for r in rows:
    worse[(r["nat_a"], r["nat_b"])][0 if r["agent"] == "ice" else 1] += r["direct"]
bad = [(k, v) for k, v in worse.items() if v[0] > v[1]]
print(f"\nPairings where ICE got more direct paths than adaptive: {len(bad)}")
for k, v in bad[:20]:
    print("  ", k, "ice", v[0], "adaptive", v[1])
print("Sessions not ending on a working path: ice", sum(not r["ok"] for r in by[("ice", "All")]),
      "adaptive", sum(not r["ok"] for r in by[("adaptive", "All")]))
prof = [r["t_profile"] for r in by[("adaptive", "All")]]
print(f"Adaptive profiling time: median {st.median(prof):.2f}s max {max(prof):.2f}s")

# ---------------------------------------------------------------- figures
INK, MUTED, GRID = "#222222", "#666666", "#e5e5e5"
ICE_C, ADP_C = "#d9822b", "#3b6ea5"


def style(a):
    a.tick_params(labelsize=7, colors=MUTED); a.yaxis.grid(True, color=GRID, lw=0.8); a.set_axisbelow(True)
    for s in ["top", "right"]: a.spines[s].set_visible(False)
    for s in ["left", "bottom"]: a.spines[s].set_color("#bbbbbb")


labels = [c.replace("Sym-", "S-").replace(" / ", "/\n") for c in CLASSES]
x = range(len(CLASSES))
fig, ax = plt.subplots(2, 1, figsize=(3.6, 4.9), dpi=250)
w = 0.38
ice = [next(o for o in out if o["cls"] == c)["ice_direct"] for c in CLASSES]
adp = [next(o for o in out if o["cls"] == c)["adp_direct"] for c in CLASSES]
b1 = ax[0].bar([i - w / 2 for i in x], ice, w, color=ICE_C, label="ICE baseline")
b2 = ax[0].bar([i + w / 2 for i in x], adp, w, color=ADP_C, label="Adaptive")
for bs in (b1, b2):
    for b in bs:
        ax[0].text(b.get_x() + b.get_width() / 2, b.get_height() + 2, f"{b.get_height():.0f}", ha="center", fontsize=5.8, color=INK)
ax[0].set_xticks(list(x)); ax[0].set_xticklabels(labels, fontsize=6)
ax[0].set_ylim(0, 115); ax[0].set_ylabel("Sessions with a direct path (%)", fontsize=7.5, color=MUTED)
ax[0].set_title("(a) Relay-free connections", fontsize=8.5, color=INK)
ax[0].legend(fontsize=6.5, frameon=False, loc="upper right")
style(ax[0])
ice_t = [next(o for o in out if o["cls"] == c)["ice_t"] for c in CLASSES]
adp_t = [next(o for o in out if o["cls"] == c)["adp_t"] for c in CLASSES]
b1 = ax[1].bar([i - w / 2 for i in x], ice_t, w, color=ICE_C, label="ICE baseline")
b2 = ax[1].bar([i + w / 2 for i in x], adp_t, w, color=ADP_C, label="Adaptive")
for bs in (b1, b2):
    for b in bs:
        v = b.get_height()
        ax[1].text(b.get_x() + b.get_width() / 2, v + 0.05, f"{v:.2f}" if v >= 0.1 else f"{v*1000:.0f}ms", ha="center", fontsize=5.4, color=INK, rotation=90 if v >= 0 else 0, va="bottom")
ax[1].set_xticks(list(x)); ax[1].set_xticklabels(labels, fontsize=6)
ax[1].set_ylim(0, 3.4); ax[1].set_ylabel("Median time to working path (s)", fontsize=7.5, color=MUTED)
ax[1].set_title("(b) Connection setup time", fontsize=8.5, color=INK)
ax[1].legend(fontsize=6.5, frameon=False, loc="upper left")
style(ax[1])
plt.tight_layout(); plt.savefig("fig_eval.png", bbox_inches="tight", facecolor="white")

# packets per method
fig, a = plt.subplots(figsize=(3.6, 2.6), dpi=200)
ms = [m["method"] for m in mrows] + ["ICE"]
pk = [m["pkts_med"] for m in mrows] + [st.median(x["packets"] for x in by[("ice", "All")])]
bars = a.bar(ms, pk, color=[ADP_C] * len(mrows) + [ICE_C], width=0.55)
for b, v in zip(bars, pk):
    a.text(b.get_x() + b.get_width() / 2, v * 1.15, f"{v:.0f}", ha="center", fontsize=6.5, color=INK)
a.set_yscale("log"); a.set_ylim(1, 5000)
a.set_ylabel("Median datagrams per session", fontsize=7.5, color=MUTED)
a.set_title("Probing overhead by method", fontsize=8.5, color=INK)
style(a)
plt.tight_layout(); plt.savefig("fig_overhead.png", bbox_inches="tight", facecolor="white")
print("figures written")
