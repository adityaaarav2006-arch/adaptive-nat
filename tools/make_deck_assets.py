"""
make_deck_assets.py - charts and slide content for the review deck, from demo/data.js.

Every number in the deck is read from demo/data.js (written and checked by
tools/export_demo_data.py). Writes deck/assets/*.png and deck/slides.json;
tools/make_deck.ps1 then builds deck/Adaptive_NAT_Review.pptx in PowerPoint.

Run from the repository root:  python tools/make_deck_assets.py
"""
import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, "deck")
ASSETS = os.path.join(DECK, "assets")
os.makedirs(ASSETS, exist_ok=True)

with open(os.path.join(ROOT, "demo", "data.js"), encoding="utf-8") as fh:
    src = fh.read()
D = json.loads(src[src.index("{", src.index("window.DEMO_DATA")):src.rstrip().rindex(";")])
bad = [c["name"] for c in D["checks"] + D["crossChecks"] if not c["pass"]]
if bad:
    raise SystemExit("data.js has failing checks, fix the export first: " + "; ".join(bad))

OURS, ICE, UNAWARE, INK, MUTED, GRID = "#2a78d6", "#eb6834", "#1baf7a", "#0b0b0b", "#6b6963", "#e1e0d9"
plt.rcParams.update({"font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 15, "axes.edgecolor": "#c3c2b7",
                     "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": INK, "axes.spines.top": False,
                     "axes.spines.right": False, "figure.dpi": 100, "savefig.dpi": 220})


def fmt_t(s):
    if s < 0.01:
        return f"{s * 1000:.1f} ms"
    if s < 1:
        return f"{round(s * 1000)} ms"
    return f"{s:.2f} s" if s < 10 else f"{s:.1f} s"


def pct(x):
    return f"{x:.0f}%" if x in (0, 100) else f"{x:.1f}%"


def save(fig, name):
    p = os.path.join(ASSETS, name)
    fig.savefig(p, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return p


sim, tb, acc, accb, blk = D["sim"], D["testbed"], D["accuracy"], D["accuracyBlocks"], D["blocks"]
meth = {m["method"]: m for m in sim["methods"]}

# ------------------------------------------------------------------ chart: by pairing class
cls = sim["classes"]
labels = [c["short"].replace("/", " / ") for c in cls]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.9), gridspec_kw={"wspace": 0.42})
y = range(len(cls))
h = 0.38
for ax, key_i, key_a, xmax, f, title in ((a1, "iceDirect", "adpDirect", 100, pct, "Calls with a direct path"),
                                         (a2, "iceT", "adpT", 3.0, fmt_t, "Median time to a working path")):
    bi = ax.barh([i - h / 2 for i in y], [c[key_i] for c in cls], h, color=ICE, label="ICE baseline")
    ba = ax.barh([i + h / 2 for i in y], [c[key_a] for c in cls], h, color=OURS, label="Our agent")
    for bars, k in ((bi, key_i), (ba, key_a)):
        for b, c in zip(bars, cls):
            ax.text(b.get_width() + xmax * 0.012, b.get_y() + b.get_height() / 2, f(c[k]), va="center", fontsize=12.5,
                    color=INK, fontweight="semibold")
    ax.set_yticks(list(y), labels)
    ax.invert_yaxis()
    ax.set_xlim(0, xmax * 1.16)
    ax.set_title(title, loc="left", fontsize=16, fontweight="semibold", color=INK, pad=10)
    ax.grid(axis="x", color=GRID)
    ax.set_axisbelow(True)
    ax.tick_params(axis="y", length=0)
a1.set_xticks([0, 25, 50, 75, 100], ["0%", "25%", "50%", "75%", "100%"])
a2.set_xticks([0, 1, 2, 3], ["0 s", "1 s", "2 s", "3 s"])
a1.legend(loc="lower right", frameon=False, fontsize=13, reverse=True)
CH_CLASS = save(fig, "chart_classes.png")

# ------------------------------------------------------------------ chart: packets per method (log)
rows = [(m, meth[m]["pktsMed"], OURS) for m in ("DIRECT", "PREDICT", "SPRAY", "RELAY")] + [("ICE (every call)", sim["ice"]["pktsMed"], ICE)]
fig, ax = plt.subplots(figsize=(6.4, 4.2))
bars = ax.barh(range(len(rows)), [r[1] for r in rows], 0.6, color=[r[2] for r in rows])
for b, r in zip(bars, rows):
    ax.text(b.get_width() * 1.12, b.get_y() + b.get_height() / 2, f"{r[1]:.0f}", va="center", fontsize=14, fontweight="semibold")
ax.set_xscale("log")
ax.set_xlim(1, 3000)
ax.set_xticks([1, 10, 100, 1000], ["1", "10", "100", "1,000"])
ax.set_yticks(range(len(rows)), [r[0] for r in rows])
ax.invert_yaxis()
ax.grid(axis="x", color=GRID)
ax.set_axisbelow(True)
ax.tick_params(axis="y", length=0)
ax.set_title("Median packets per call (log scale)", loc="left", fontsize=15, fontweight="semibold", pad=10)
CH_PKTS = save(fig, "chart_packets.png")

# ------------------------------------------------------------------ chart: testbed direct counts
fig, ax = plt.subplots(figsize=(6.4, 4.4))
tr = tb["rows"]
for i, r in enumerate(tr):
    for off, ag, col in ((-0.2, "aioice", ICE), (0.2, "adaptive", OURS)):
        v = r[ag]["direct"]
        ax.barh(i + off, max(v, 0.04), 0.38, color=col)
        ax.text(v + 0.08, i + off, f"{v}/{r[ag]['n']}", va="center", fontsize=12.5, fontweight="semibold")
ax.set_yticks(range(len(tr)), [r["label"] for r in tr])
ax.invert_yaxis()
ax.set_xlim(0, 5.9)
ax.set_xticks(range(6))
ax.grid(axis="x", color=GRID)
ax.set_axisbelow(True)
ax.tick_params(axis="y", length=0)
ax.set_title("Direct paths out of 5 runs", loc="left", fontsize=15, fontweight="semibold", pad=10)
from matplotlib.patches import Patch  # noqa: E402
ax.legend(handles=[Patch(color=OURS, label="Our agent"), Patch(color=ICE, label="aioice")], loc="lower right", frameon=False, fontsize=12.5)
CH_TB = save(fig, "chart_testbed.png")

# ------------------------------------------------------------------ chart: block NAT packets per run
bt = blk["testbed"]
fig, ax = plt.subplots(figsize=(6.4, 3.0))
for yy, k, col, name in ((0, "aware", OURS, "Block-aware"), (1, "unaware", UNAWARE, "Block-unaware")):
    p = bt[k]["pkts"]
    ax.plot([min(p), max(p)], [yy, yy], color="#c3c2b7", lw=2, zorder=1)
    ax.scatter(p, [yy + ((i % 3) - 1) * 0.08 for i in range(len(p))], s=60, color=col, edgecolor="white", zorder=2)
    ax.text(max(p) + 40, yy, f"median {bt[k]['pktsMed']:.0f}  ({min(p)}–{max(p):,})", va="center", fontsize=12.5, fontweight="semibold")
ax.set_yticks([0, 1], ["Block-aware", "Block-unaware"])
ax.set_ylim(1.5, -0.5)
ax.set_xlim(0, 2300)
ax.set_xticks([0, 500, 1000, 1500])
ax.grid(axis="x", color=GRID)
ax.set_axisbelow(True)
ax.tick_params(axis="y", length=0)
ax.set_title(f"Packets per run on the real block NAT ({bt['aware']['n']} runs each)", loc="left", fontsize=14, fontweight="semibold", pad=8)
CH_BLK = save(fig, "chart_blocks.png")

# ------------------------------------------------------------------ slide content
spray, relay = meth["SPRAY"], meth["RELAY"]
bs = blk["sim"]
fb = acc["byFiltering"]
tps = tb["profileSecondsMedian"]
nb = blk["testbed"]["aware"]["nOpen"]
n_full, m_full = D["notes"]["nOpenDefault"], D["notes"]["packetBudget"] - 2 * D["notes"]["nOpenDefault"]
p_full = 1 - math.exp(-n_full * m_full / 64512)
p_blk = 1 - math.exp(-nb * nb / D["notes"]["blockSize"])
fcfc = next(r for r in tr if r["label"] == "FC/FC")
prs = [r for r in tr if r["label"] in ("PR/PR", "PR/Sym")]
ice_pr = sum(r["aioice"]["direct"] for r in prs)
n_pr = sum(r["aioice"]["n"] for r in prs)
spray_hits = round(spray["direct"] * spray["n"] / 100)
meta = D["meta"]
authors = "   ·   ".join(f"{a['name']} ({a['reg']})" for a in meta["authors"])

S = []
S.append({"layout": "title", "title": meta["title"], "subtitle": meta["subtitle"],
          "lines": [authors, f"{meta['course']}   ·   Guide: {meta['guide']}"],
          "notes": "We built an agent that measures each router first, then picks the cheapest way to connect two peers directly."})
S.append({"layout": "stats", "kicker": "Results at a glance (measured)", "title": "More direct calls, set up faster",
          "stats": [
              {"label": f"Direct connections, simulation ({sim['sessionsPerAgent']} calls each)", "ours": pct(sim["adaptive"]["direct"]), "ice": pct(sim["ice"]["direct"]), "iceName": "ICE"},
              {"label": "Median time to a working path", "ours": fmt_t(sim["adaptive"]["tMed"]), "ice": fmt_t(sim["ice"]["tMed"]), "iceName": "ICE"},
              {"label": "Direct connections, real Linux NATs", "ours": f"{tb['adaptive']['direct']}/{tb['adaptive']['n']}", "ice": f"{tb['aioice']['direct']}/{tb['aioice']['n']}", "iceName": "aioice"},
              {"label": "Profiler accuracy", "ours": f"{acc['ok']}/{acc['n']}", "ice": f"{accb['ok']}/{accb['n']}", "iceName": "blocks"}],
          "foot": f"Simulation: {sim['pairings']} router pairings × {sim['trials']} trials. Testbed: {len(tr)} pairings × {tb['trials']} runs on kernel NATs (nftables + conntrack). "
                  f"ICE never got more direct paths than us in any pairing; every call of both agents delivered its data.",
          "notes": "Four numbers: direct connections in simulation, time to a working path, real Linux routers, and profiler accuracy."})
S.append({"layout": "image", "kicker": "The problem (illustration)", "title": "Why video calls end up on a slow relay",
          "image": "shot_problem.png",
          "bullets": ["Cone NAT: one public port for every destination, so a simultaneous hole punch gets through.",
                      "Symmetric NAT: a new port per destination, so the punch aims at a port that does not exist and is dropped.",
                      f"Standard ICE then waits out its timeout and relays: median {fmt_t(sim['ice']['relayTMed'])} in our simulation."],
          "notes": "A symmetric router opens a new door for every destination, so the punch misses and the call falls back to the relay."})
S.append({"layout": "cards", "kicker": "Step 1 · Measure each router", "title": "Profiling a NAT (RFC 4787 behaviour)",
          "cards": [
              {"head": "1 · Filtering test", "body": "Own socket. Two parallel probes with CHANGE-REQUEST: reply from another IP+port, and from another port.\n→ EI / AD / APD filtering"},
              {"head": "2 · Mapping test", "body": "Compare the public port seen by two server addresses, then by the same IP on another port.\n→ EI / AD / APD mapping"},
              {"head": "3 · Allocation test", "body": f"{D['notes']['allocProbes']} probes to {D['notes']['allocProbes']} servers; compare port gaps.\n→ sequential / fixed step / random / random inside one aligned 512-port block"}],
          "bullets": [f"Output: a profile label such as APD/APD/Blk512.   Accuracy {acc['ok']}/{acc['n']} (EI {acc['byMapping']['EI']['ok']}/{acc['byMapping']['EI']['n']}, AD {acc['byMapping']['AD']['ok']}/{acc['byMapping']['AD']['n']}, APD {acc['byMapping']['APD']['ok']}/{acc['byMapping']['APD']['n']}); block detection {accb['ok']}/{accb['n']}.",
                      f"Cost: {fmt_t(tps['full-cone'])} on the real full-cone NAT ({fmt_t(fb['EI']['secondsMedian'])} simulated). With AD/APD filtering a reply never comes, so it waits out 3 × 0.5 s: {fmt_t(tps['port-restricted'])} real, {fmt_t(fb['APD']['secondsMedian'])} simulated."],
          "notes": "Three short tests tell us how the router maps ports, which packets it lets in, and how it picks new ports."})
S.append({"layout": "cards", "kicker": "Step 2 · Decide (rules from strategy.py)", "title": "Cheapest method that can work",
          "cards": [
              {"head": "DIRECT", "body": "Both routers keep one port for everyone (EI mapping).\nSimultaneous open to each other's STUN address.", "color": OURS},
              {"head": "PREDICT", "body": "Both ports fixed or predictable (sequential / fixed step), or a lenient side to aim at.\nEach side aims at a window of the other's next ports.", "color": OURS},
              {"head": "SPRAY", "body": f"A random side that can open ports for the other to hit.\nOpener opens N ports, prober fires M probes. Full range N={n_full}, M={m_full:,}; 512-block N=M={nb}.", "color": OURS},
              {"head": "RELAY", "body": f"Nothing above can work (filters too strict).\nGo to the relay at once: median {fmt_t(relay['tMed'])} instead of waiting {D['notes']['tBudget']} s.", "color": "#6250d6"}],
          "bullets": ["Both peers run the same rules on both profiles, so they agree without extra messages. Port-block sides are tried first as the spray opener.",
                      "The JavaScript port in the demo matches strategy.choose() on all 441 ordered pairs of the 21 NAT types, plus the block types (7,731 cases)."],
          "notes": "The agent walks down the ladder: direct, predict, spray, relay, and stops at the first rung that can work."})
pr_sr = D["pairings"].get("EI/APD/-|APD/APD/Rand") or D["pairings"].get("APD/APD/Rand|EI/APD/-")
S.append({"layout": "image", "kicker": "Step 2 · Example from the live demo", "title": "Port-restricted ↔ symmetric random: SPRAY",
          "image": "shot_strategy.png",
          "bullets": [f"Measured for this pairing: ours {pr_sr['adaptive']['direct']}/{pr_sr['adaptive']['n']} direct, median {fmt_t(pr_sr['adaptive']['tMed'])}; "
                      f"ICE {pr_sr['ice']['direct']}/{pr_sr['ice']['n']}, median {fmt_t(pr_sr['ice']['tMed'])}."],
          "notes": "For a port-restricted router talking to a symmetric random one, the rules pick spraying, and the measured runs agree."})
S.append({"layout": "cards", "kicker": "Why spraying works", "title": "The birthday paradox, for ports",
          "formula": "P(success) = 1 − e^(−N·M / R)",
          "cards": [
              {"head": "Full port range", "body": f"R = 64,512\nN = {n_full}, M = {m_full:,}\nP ≈ {p_full * 100:.1f}%   ({2 * n_full + m_full:,} packets worst case)"},
              {"head": "One 512-port block", "body": f"R = {D['notes']['blockSize']}\nN = M = {nb}\nP ≈ {p_blk * 100:.1f}%   (~{3 * nb} packets)"},
              {"head": "Measured", "body": f"Spray: {spray_hits}/{spray['n']} direct ({pct(spray['direct'])}) vs formula {spray['pModel'] * 100:.1f}%\nBlock-aware: {pct(bs['aware']['direct'])} of {blk['blockSessions']} vs formula {bs['modelPAware'] * 100:.1f}%"}],
          "notes": "If one side opens N random ports and the other probes M, a match is likely long before every port is tried."})
S.append({"layout": "chart", "kicker": "Results · Simulation (measured)", "title": f"Direct paths and setup time by pairing class",
          "image": os.path.basename(CH_CLASS),
          "foot": f"{sim['pairings']} pairings × {sim['trials']} trials = {sim['sessionsPerAgent']} calls per agent. Cone = EI mapping; S-Pred = symmetric, sequential/fixed-step ports; S-Rand = symmetric, random ports. "
                  f"ICE was never better in any pairing (ours better in {sim['pairsAdpBetter']}, equal in {sim['pairsEqual']}); all {sim['adaptive']['ok']} + {sim['ice']['ok']} calls delivered data.",
          "notes": "In simulation ours connects directly 88 percent of the time against 36 for ICE, and does it in tens of milliseconds instead of two and a half seconds."})
S.append({"layout": "chart_table", "kicker": "Results · By method (measured)", "title": "What each method costs",
          "image": os.path.basename(CH_PKTS),
          "table": {"head": ["Method", "Calls", "Direct", "Median packets", "Median time"],
                    "rows": [[m, str(meth[m]["n"]), pct(meth[m]["direct"]), f"{meth[m]['pktsMed']:.0f}", fmt_t(meth[m]["tMed"])] for m in ("DIRECT", "PREDICT", "SPRAY", "RELAY")]
                    + [["ICE", str(sim["sessionsPerAgent"]), pct(sim["ice"]["direct"]), f"{sim['ice']['pktsMed']:.0f}", fmt_t(sim["ice"]["tMed"])]]},
          "foot": f"SPRAY: {spray_hits} of {spray['n']} calls direct, formula predicted {spray['pModel'] * 100:.1f}%. RELAY pairings go to the relay in {fmt_t(relay['tMed'])}.",
          "notes": "Cheap methods handle most pairings; spraying costs more but only where it is needed, and hopeless pairings go to the relay at once."})
S.append({"layout": "chart_table", "kicker": "Results · Real Linux NATs (measured)", "title": f"Testbed: ours {tb['adaptive']['direct']}/{tb['adaptive']['n']} vs aioice {tb['aioice']['direct']}/{tb['aioice']['n']}",
          "image": os.path.basename(CH_TB),
          "table": {"head": ["Pairing", "Ours", "Method", "Median", "aioice", "Median"],
                    "rows": [[r["label"], f"{r['adaptive']['direct']}/{r['adaptive']['n']}", r["adaptive"]["plan"].capitalize(),
                              (f"{round(r['adaptive']['tMed'] * 1000)} ms" if r["adaptive"]["tMed"] < 1 else f"{r['adaptive']['tMed']:.1f} s"),
                              f"{r['aioice']['direct']}/{r['aioice']['n']}",
                              (f"{round(r['aioice']['tMed'] * 1000)} ms" if r["aioice"]["tMed"] < 1 else f"{r['aioice']['tMed']:.1f} s")] for r in tr]},
          "foot": f"FC = full cone, PR = port-restricted, Sym = symmetric (random). Kernel nftables NATs in network namespaces, {tb['trials']} runs each; aioice gives up after 15 s. "
                  f"One aioice FC/FC session timed out, which did not reproduce in {D['notes']['aioiceFcFcTimeout']['reruns']} reruns.",
          "notes": "On real Linux routers we got 25 of 30 direct against 14 for aioice; aioice failed every port-restricted pairing."})
S.append({"layout": "chart_table", "kicker": "Results · Port-block-aware spraying (measured)", "title": f"Same success, about {bt['unaware']['pktsMed'] / bt['aware']['pktsMed']:.0f}× fewer packets",
          "image": os.path.basename(CH_BLK),
          "table": {"head": ["", "Block-aware", "Unaware", "ICE / aioice"],
                    "rows": [["Sim: direct", pct(bs["aware"]["direct"]), pct(bs["unaware"]["direct"]), pct(bs["ice"]["direct"])],
                             ["Sim: median packets", f"{bs['aware']['pktsMed']:.0f}", f"{bs['unaware']['pktsMed']:.0f}", "–"],
                             ["Sim: median time", fmt_t(bs["aware"]["tMed"]), fmt_t(bs["unaware"]["tMed"]), fmt_t(bs["ice"]["tMed"])],
                             ["Real NAT: direct", f"{bt['aware']['direct']}/{bt['aware']['n']}", f"{bt['unaware']['direct']}/{bt['unaware']['n']}", f"{bt['aioice']['direct']}/{bt['aioice']['n']}"],
                             ["Real NAT: packets", f"{bt['aware']['pktsMed']:.0f} ({bt['aware']['pktsMin']}–{bt['aware']['pktsMax']})", f"{bt['unaware']['pktsMed']:.0f} ({bt['unaware']['pktsMin']}–{bt['unaware']['pktsMax']:,})", "–"],
                             ["Real NAT: median time", f"{round(bt['aware']['tMed'] * 1000)} ms", f"{round(bt['unaware']['tMed'] * 1000)} ms", f"{bt['aioice']['tMed']:.0f} s timeout"]]},
          "foot": f"Simulation: {blk['blockSessions']} calls that sprayed into a 512-port block. Real NAT: nftables “masquerade to :40960–41471 random”.",
          "notes": "Spotting the 512-port block cuts spraying cost about five times with the same success, and makes it predictable."})
S.append({"layout": "cards", "kicker": "What we learned", "title": "Four findings", "cols": 2,
          "cards": [
              {"head": "1 · Discovery tests contaminate each other", "body": f"Shared socket, mapping first: strict filters looked lenient (simulator {D['notes']['sharedSocketWeek3']['before']} → {D['notes']['sharedSocketWeek3']['after']} after reordering). Filtering first: Linux EI NATs looked symmetric (conntrack entries). Fix: separate socket for the filtering test."},
              {"head": "2 · Linux conntrack breaks naive simultaneous open", "body": f"An early packet leaves an UNREPLIED entry and the NAT re-maps the port (/proc/net/nf_conntrack: {D['notes']['conntrackRemap']['before']} became {D['notes']['conntrackRemap']['after']}). aioice: {ice_pr}/{n_pr} on port-restricted pairings. Fix: TTL-{D['notes']['openTtl']} opening packets."},
              {"head": "3 · APD replies leave from a new port", "body": f"That rules out some pairings that look feasible. The agent sends them to the relay in {fmt_t(relay['tMed'])} instead of wasting {D['notes']['tBudget']} s."},
              {"head": "4 · Port blocks make spraying cheap and predictable", "body": f"About {bt['unaware']['pktsMed'] / bt['aware']['pktsMed']:.0f}× fewer packets, same success: {bt['aware']['pktsMin']}–{bt['aware']['pktsMax']} packets every time on the real NAT, against {bt['unaware']['pktsMin']}–{bt['unaware']['pktsMax']:,}."}],
          "notes": "Testing on real Linux turned up four problems that the textbook description of NAT traversal leaves out."})
S.append({"layout": "two_col", "kicker": "Honest scope", "title": "Limitations and future work",
          "left": {"head": "Limitations", "items": ["Simulator follows RFC 4787 exactly", "Testbed: one machine, three Linux NAT types, no real delay or loss",
                                                    "TTL = 2 matches the testbed topology", "JSON probes instead of binary STUN (aioice runs use real STUN)",
                                                    "Minimal relay, not coturn", "Adaptive keepalive not implemented", "Block detection assumes aligned blocks"]},
          "right": {"head": "Future work", "items": ["Real routers and mobile / carrier-grade networks", "Automatic TTL: measure hops to our own NAT",
                                                     "WebRTC integration: steer ICE checks with the profile"]},
          "notes": "Our testbed is one machine with three Linux NAT types; next we want real routers, mobile networks and WebRTC integration."})
S.append({"layout": "end", "title": "Thank you", "subtitle": "Questions?",
          "lines": ["Live interactive demo: demo/index.html (works offline)", authors],
          "notes": "Happy to take questions, or show any pairing live in the demo."})

with open(os.path.join(DECK, "slides.json"), "w", encoding="utf-8") as fh:
    json.dump({"assets": ASSETS, "slides": S}, fh, ensure_ascii=False, indent=1)
print(f"wrote {len(S)} slides and {len(os.listdir(ASSETS))} assets to {os.path.relpath(DECK, ROOT)}")
