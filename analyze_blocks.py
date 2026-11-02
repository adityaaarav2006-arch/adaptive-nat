"""analyze_blocks.py - summarise evaluation_blocks.csv (port-block-aware spraying)."""
import csv, json, statistics as st
from collections import defaultdict

rows = list(csv.DictReader(open("evaluation_blocks.csv")))
for r in rows:
    r["t"] = float(r["t_connect"]); r["p"] = int(r["packets"]); r["d"] = r["path"] == "direct"
by = defaultdict(list)
for r in rows:
    by[r["agent"]].append(r)
S = {}
print(f"{'agent':14s} {'sessions':>8s} {'direct':>7s} {'ok':>4s} {'t_med':>7s}")
for ag in ("block-aware", "block-unaware", "ice"):
    L = by[ag]
    S[ag] = dict(n=len(L), direct=round(100 * sum(x["d"] for x in L) / len(L), 1), ok=all(x["ok"] == "True" for x in L),
                 t_med=round(st.median(x["t"] for x in L), 3))
    print(f"{ag:14s} {len(L):8d} {S[ag]['direct']:6.1f}% {str(S[ag]['ok']):>5s} {S[ag]['t_med']:7.3f}")

# sessions where at least one adaptive variant sprayed: compare like-for-like by (pairing, trial)
key = lambda r: (r["nat_a"], r["nat_b"], r["trial"])
aw = {key(r): r for r in by["block-aware"]}
un = {key(r): r for r in by["block-unaware"]}
ic = {key(r): r for r in by["ice"]}
spray_keys = [k for k in aw if aw[k]["plan"] == "SPRAY" or un[k]["plan"] == "SPRAY"]
blk_keys = [k for k in spray_keys if aw[k]["spray_range"] not in ("", "64512")]
print(f"\nSessions where spraying was chosen: {len(spray_keys)}; of these the block-aware plan used a port block: {len(blk_keys)}")
for name, D in (("block-aware", aw), ("block-unaware", un), ("ice", ic)):
    L = [D[k] for k in blk_keys]
    S[name + "_blk"] = dict(direct=round(100 * sum(x["d"] for x in L) / len(L), 1), pkts_med=st.median(x["p"] for x in L),
                            pkts_mean=round(st.mean(x["p"] for x in L)), t_med=round(st.median(x["t"] for x in L), 3))
    print(f"  {name:14s} direct {S[name + '_blk']['direct']:5.1f}%  packets median {S[name + '_blk']['pkts_med']:6.0f} "
          f"mean {S[name + '_blk']['pkts_mean']:5d}  time median {S[name + '_blk']['t_med']:.3f}s")
S["n_spray_sessions"] = len(spray_keys); S["n_block_sessions"] = len(blk_keys)
S["packet_reduction"] = round(S["block-unaware_blk"]["pkts_med"] / S["block-aware_blk"]["pkts_med"], 1)
ps = [float(aw[k]["p_spray"]) for k in blk_keys]
S["model_p_aware"] = round(100 * st.mean(ps), 1)
print(f"  packet reduction (median, unaware/aware): {S['packet_reduction']}x; model success for aware plans {S['model_p_aware']}%")
# opener choice: how often the block side became the opener
S["aware_better_pairs"] = sum(1 for k in aw if aw[k]["d"] and not un[k]["d"])
S["unaware_better_pairs"] = sum(1 for k in aw if un[k]["d"] and not aw[k]["d"])
print(f"  sessions direct only with block awareness: {S['aware_better_pairs']}; only without: {S['unaware_better_pairs']}")
json.dump(S, open("blocks_summary.json", "w"), indent=1)

import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
fig, ax = plt.subplots(1, 2, figsize=(7.2, 2.8), dpi=200)
names = ["Block-unaware\nspraying", "Block-aware\nspraying"]
cols = ["#d9822b", "#3b6ea5"]
vals = [S["block-unaware_blk"]["pkts_med"], S["block-aware_blk"]["pkts_med"]]
b = ax[0].bar(names, vals, color=cols, width=0.5)
for bb, v in zip(b, vals):
    ax[0].text(bb.get_x() + bb.get_width() / 2, v * 1.02, f"{v:.0f}", ha="center", fontsize=8)
ax[0].set_title("(a) Median packets per session", fontsize=9); ax[0].set_ylim(0, max(vals) * 1.2)
vals = [S["block-unaware_blk"]["direct"], S["block-aware_blk"]["direct"]]
b = ax[1].bar(names, vals, color=cols, width=0.5)
for bb, v in zip(b, vals):
    ax[1].text(bb.get_x() + bb.get_width() / 2, v + 1.5, f"{v:.1f}%", ha="center", fontsize=8)
ax[1].set_title("(b) Sessions with a direct path", fontsize=9); ax[1].set_ylim(0, 115)
for a in ax:
    a.tick_params(labelsize=7.5, colors="#666666"); a.yaxis.grid(True, color="#e5e5e5"); a.set_axisbelow(True)
    for s_ in ("top", "right"): a.spines[s_].set_visible(False)
plt.tight_layout(); plt.savefig("fig_blocks.png", bbox_inches="tight", facecolor="white")
