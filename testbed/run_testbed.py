"""
run_testbed.py - adaptive agent vs real aioice over real Linux kernel NATs.

For every pairing of {full-cone, port-restricted, symmetric} and every trial,
the whole namespace testbed is rebuilt from scratch (fresh conntrack state),
the internet-side services are started, and both peers run as separate
processes inside their host namespaces. Results -> testbed_results.csv
"""
import csv, itertools, json, subprocess, sys, time, os
from netbed import build, teardown

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ["full-cone", "port-restricted", "symmetric"]


def nspy(ns, *args):
    return subprocess.Popen(["nsenter", f"--net=/var/run/netns/{ns}", sys.executable, *args], cwd=HERE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def session(ka, kb, agent, sid, extra=()):
    build(ka, kb)
    pub = nspy("pub", "pub_services.py")
    try:
        assert pub.stdout.readline().strip() == "ready"
        script = "side_adaptive.py" if agent == "adaptive" else "side_ice.py"
        procs = [nspy("hA", script, "A", sid, *extra), nspy("hB", script, "B", sid, *extra)]
        res = []
        for p in procs:
            out, err = p.communicate(timeout=60)
            line = [l for l in out.splitlines() if l.startswith("{")]
            if not line:
                raise RuntimeError(f"{agent} {ka}/{kb} produced no result: {err[-800:]}")
            res.append(json.loads(line[-1]))
        return res
    finally:
        pub.kill(); pub.wait()
        teardown()


def main(trials=5):
    rows = []
    for ka, kb in itertools.combinations_with_replacement(KINDS, 2):
        for t in range(trials):
            for agent in ("adaptive", "aioice"):
                sid = f"{ka}-{kb}-{t}-{agent}"
                a, b = session(ka, kb, agent, sid)
                direct = a["path"] == "direct" and b["path"] == "direct"
                row = dict(agent=agent, nat_a=ka, nat_b=kb, trial=t, path="direct" if direct else "relay",
                           t_connect=max(a["t_connect"], b["t_connect"]), plan=a.get("plan", "ICE"),
                           profile_a=a.get("profile", ""), profile_b=b.get("profile", ""),
                           packets=a.get("packets", "") if agent == "adaptive" else "",
                           t_profile=max(a["t_profile"], b["t_profile"]), err=a.get("err", "") or b.get("err", ""))
                rows.append(row)
                print(f"{agent:8s} {ka:15s} {kb:15s} t{t} plan={row['plan']:7s} path={row['path']:6s} "
                      f"t={row['t_connect']:.3f}s prof={row['profile_a']}|{row['profile_b']} {row['err']}", flush=True)
    with open("testbed_results.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)


def main_blocks(trials=10):
    """Port-block-aware spraying on a real port-block NAT (nftables masquerade to a 512-port range)."""
    rows = []
    for ka, kb in [("port-restricted", "symmetric-block")]:
        for t in range(trials):
            for agent, script_agent, extra in (("block-aware", "adaptive", ()), ("block-unaware", "adaptive", ("--no-block",)),
                                               ("aioice", "aioice", ())):
                if agent == "aioice" and t >= 5:
                    continue
                a, b = session(ka, kb, script_agent, f"blk-{t}-{agent}", extra)
                direct = a["path"] == "direct" and b["path"] == "direct"
                row = dict(agent=agent, nat_a=ka, nat_b=kb, trial=t, path="direct" if direct else "relay",
                           t_connect=max(a["t_connect"], b["t_connect"]), plan=a.get("plan", "ICE"),
                           profile_a=a.get("profile", ""), profile_b=b.get("profile", ""),
                           packets=(a.get("packets", 0) + b.get("packets", 0)) if script_agent == "adaptive" else "",
                           n_open=a.get("n_open", ""), m_probe=a.get("m_probe", ""), spray_range=a.get("spray_range", ""),
                           err=a.get("err", "") or b.get("err", ""))
                rows.append(row)
                print(f"{agent:13s} t{t} plan={row['plan']:6s} path={row['path']:6s} t={row['t_connect']:.3f}s "
                      f"pkts={row['packets']} range={row['spray_range']} prof={row['profile_a']}|{row['profile_b']} {row['err']}", flush=True)
    with open("testbed_blocks.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "blocks":
        main_blocks(int(sys.argv[2]) if len(sys.argv) > 2 else 10)
    elif len(sys.argv) > 2:   # single debug session: run_testbed.py KA KB AGENT
        print(session(sys.argv[1], sys.argv[2], sys.argv[3], "dbg"))
    else:
        main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)
