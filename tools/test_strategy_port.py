"""
test_strategy_port.py - check that demo/strategy.js makes exactly the decisions of strategy.choose().

Runs both implementations on
  * all 441 ordered pairs of the 21 NAT types of the main evaluation,
  * all ordered pairs once the 6 port-block types (512-port blocks) are added, block-aware and not,
  * port-block types with other block sizes (256 ... 8192),
  * smaller packet budgets and opener counts,
and compares method, reason, opener, N, M, success probability and spray range. It also checks
that the JS rules reproduce the plan recorded for every session in evaluation_results.csv and
evaluation_blocks.csv, and that the chosen method does not depend on which peer is called A.

Needs Node.js on PATH. Run from the repository root:  python tools/test_strategy_port.py
"""
import csv
import json
import os
import subprocess
import sys
import tempfile
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from nat_sim import MappingType as M, FilteringType as F  # noqa: E402
import strategy  # noqa: E402

AB = {M.ENDPOINT_INDEPENDENT: "EI", M.ADDRESS_DEPENDENT: "AD", M.ADDRESS_AND_PORT_DEPENDENT: "APD"}
FB = {F.ENDPOINT_INDEPENDENT: "EI", F.ADDRESS_DEPENDENT: "AD", F.ADDRESS_AND_PORT_DEPENDENT: "APD"}
MR = {v: k for k, v in AB.items()}
FR = {v: k for k, v in FB.items()}


def base_types():
    out = []
    for m in M:
        for f in F:
            if m == M.ENDPOINT_INDEPENDENT:
                out.append((m, f, None, None))
            else:
                out += [(m, f, a, None) for a in ("sequential", "fixed-delta", "random")]
    return out


def block_types(size=512, lo=40960):
    return [(m, f, "random", (lo // size * size, size)) for m in M if m != M.ENDPOINT_INDEPENDENT for f in F]


def py_profile(t):
    m, f, a, blk = t
    return SimpleNamespace(mapping=m, filtering=f, allocation=a, block=blk)


def js_profile(t):
    m, f, a, blk = t
    return {"mapping": AB[m], "filtering": FB[f], "allocation": a, "block": list(blk) if blk else None}


def label(t):
    m, f, a, blk = t
    al = "-" if m == M.ENDPOINT_INDEPENDENT else (f"Blk{blk[1]}" if blk else {"sequential": "Seq", "fixed-delta": "Fixed", "random": "Rand"}[a])
    return f"{AB[m]}/{FB[f]}/{al}"


def from_label(s, lo=40960):
    m, f, a = s.split("/")
    alloc = {"-": None, "Seq": "sequential", "Fixed": "fixed-delta", "Rand": "random"}.get(a, "random")
    blk = (lo // int(a[3:]) * int(a[3:]), int(a[3:])) if a.startswith("Blk") else None
    return (MR[m], FR[f], alloc, blk)


# ------------------------------------------------------------------ build cases
cases = []          # (group, type_a, type_b, opts)
B21 = base_types()
B27 = B21 + block_types()
for a in B21:
    for b in B21:
        cases.append(("21 types, defaults", a, b, {}))
for ba in (True, False):
    for a in B27:
        for b in B27:
            cases.append((f"27 types incl. 512-blocks, block_aware={ba}", a, b, {"block_aware": ba}))
for size in (256, 1024, 4096, 8192):
    T = B21 + block_types(size, 12345 * 3)
    for a in T:
        for b in T:
            cases.append((f"block size {size}", a, b, {}))
for budget, n_open in ((600, 256), (512, 256), (400, 128), (2400, 512)):
    for a in B27:
        for b in B27:
            cases.append((f"packet_budget={budget}, n_open={n_open}", a, b, {"packet_budget": budget, "n_open": n_open}))

FIELDS = ("method", "reason", "opener", "n_open", "m_probe", "range_lo", "range_size")
JS_FIELDS = {"method": "method", "reason": "reason", "opener": "opener", "n_open": "nOpen", "m_probe": "mProbe",
             "range_lo": "rangeLo", "range_size": "rangeSize"}

py_out = []
for g, a, b, o in cases:
    p = strategy.choose(py_profile(a), py_profile(b), **o)
    py_out.append({k: getattr(p, k) for k in FIELDS} | {"p": p.p_success})

js_in = [{"a": js_profile(a), "b": js_profile(b),
          "opts": {"packetBudget": o.get("packet_budget"), "nOpen": o.get("n_open"), "blockAware": o.get("block_aware")}}
         for g, a, b, o in cases]
HARNESS = r"""
const S = require(process.argv[2]);
const cases = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const out = cases.map(c => {
  const opts = {};
  for (const k in c.opts) if (c.opts[k] !== null) opts[k] = c.opts[k];
  const trace = [];
  const p = S.choose(c.a, c.b, opts, trace);
  const chosen = trace.filter(e => e.ok).map(e => e.rung);
  return {plan: p, labelA: S.label(c.a), traceChosen: chosen[chosen.length - 1], traceOk: chosen.length};
});
process.stdout.write(JSON.stringify(out));
"""
with tempfile.TemporaryDirectory() as td:
    cf, hf = os.path.join(td, "cases.json"), os.path.join(td, "harness.js")
    with open(cf, "w") as fh:
        json.dump(js_in, fh)
    with open(hf, "w") as fh:
        fh.write(HARNESS)
    res = subprocess.run(["node", hf, os.path.join(ROOT, "demo", "strategy.js"), cf], capture_output=True, text=True)
if res.returncode:
    sys.exit(f"node failed:\n{res.stderr}")
js_out = json.loads(res.stdout)

# ------------------------------------------------------------------ compare
fails, groups = [], {}
for (g, a, b, o), py, js in zip(cases, py_out, js_out):
    jp = js["plan"]
    bad = [k for k in FIELDS if py[k] != jp[JS_FIELDS[k]]]
    if (py["p"] is None) != (jp["pSuccess"] is None) or (py["p"] is not None and abs(py["p"] - jp["pSuccess"]) > 1e-12):
        bad.append("p_success")
    if js["labelA"] != label(a):
        bad.append("label")
    if js["traceChosen"] != py["method"] or js["traceOk"] != 1:
        bad.append("trace")
    groups.setdefault(g, [0, 0])
    groups[g][0] += not bad
    groups[g][1] += 1
    if bad:
        fails.append((g, label(a), label(b), bad, py, jp))

print("JS port vs strategy.choose()")
for g, (ok, n) in groups.items():
    print(f"  {'PASS' if ok == n else 'FAIL'}  {g:45s} {ok}/{n}")

# ------------------------------------------------------------------ the decisions recorded in the result files
def recorded(fname, agent_opts):
    with open(os.path.join(ROOT, fname), newline="") as fh:
        rs = list(csv.DictReader(fh))
    per = {}
    for agent, opts in agent_opts.items():
        ok = n = 0
        seen = set()
        for r in rs:
            if r["agent"] != agent:
                continue
            ta, tb = from_label(r["profile_a"]), from_label(r["profile_b"])
            p = strategy.choose(py_profile(ta), py_profile(tb), **opts)
            match = p.method == r["plan"] and p.reason == r["reason"]
            if "n_open" in r:
                match &= (p.n_open, p.m_probe, p.range_size) == (int(r["n_open"]), int(r["m_probe"]), int(r["spray_range"]))
            ok += match
            n += 1
            seen.add((label(ta), label(tb), json.dumps(opts)))
            if not match:
                fails.append((f"{fname}:{agent}", r["profile_a"], r["profile_b"], ["recorded plan"], r["plan"], p.method))
        per[agent] = (ok, n)
    return per


print("Rules vs plans recorded in the result files (python rules; JS proven identical above)")
for fname, ao in (("evaluation_results.csv", {"adaptive": {}}),
                  ("evaluation_blocks.csv", {"block-aware": {"block_aware": True}, "block-unaware": {"block_aware": False}})):
    for agent, (ok, n) in recorded(fname, ao).items():
        print(f"  {'PASS' if ok == n else 'FAIL'}  {fname} [{agent}] {ok}/{n} sessions")

# ------------------------------------------------------------------ symmetry (the demo looks pairings up in either order)
asym = [(label(a), label(b)) for a in B27 for b in B27
        if strategy.choose(py_profile(a), py_profile(b)).method != strategy.choose(py_profile(b), py_profile(a)).method]
print(f"  {'PASS' if not asym else 'FAIL'}  method is the same for (A, B) and (B, A): {729 - len(asym)}/729 ordered pairs")
if asym:
    fails.append(("symmetry", *asym[0], ["asymmetric"], None, None))

if fails:
    print(f"\n{len(fails)} mismatches; first 10:")
    for f in fails[:10]:
        print("  ", f)
    sys.exit(1)
print(f"\nAll {len(cases)} decision cases match.")
