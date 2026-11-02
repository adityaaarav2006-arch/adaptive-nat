"""
evaluate.py - adaptive agent vs ICE-style baseline over every NAT pairing.

21 ground-truth NAT configurations (see accuracy_test.matrix) -> 231 unordered
pairings (with repetition). Each pairing is run TRIALS times per agent, every
session with fresh NATs on fresh loopback IPs. Results -> evaluation_results.csv
"""
import asyncio
import csv
import sys
import time

from accuracy_test import matrix
from agents import adaptive_session, ice_session
from relay import Relay
import stun_server as srv

ABBR = {"endpoint-independent": "EI", "address-dependent": "AD", "address-and-port-dependent": "APD"}


def label(cfg):
    m, f, a = cfg
    al = "-" if m.value == "endpoint-independent" else {"sequential": "Seq", "fixed-delta": "Fixed", "random": "Rand", "block-random": "Blk512"}[a.value]
    return f"{ABBR[m.value]}/{ABBR[f.value]}/{al}"


async def main(trials=3, conc=6, out="evaluation_results.csv"):
    from nat_sim import AllocationPolicy as A
    cfgs = [(m, f, a or A.RANDOM) for m, f, a in matrix()]
    pairs = [(i, j) for i in range(len(cfgs)) for j in range(i, len(cfgs))]
    jobs = [(i, j, t, ag) for (i, j) in pairs for t in range(trials) for ag in ("adaptive", "ice")]
    cl = srv.StunCluster(); await cl.start()
    rl = Relay(); await rl.start()
    sem = asyncio.Semaphore(conc)
    rows, done, t_start = [], [0], time.time()

    async def one(n, i, j, t, ag):
        async with sem:
            ips = (f"127.{50 + n // 60000}.{(n // 250) % 240}.{n % 250 + 1}",
                   f"127.{100 + n // 60000}.{(n // 250) % 240}.{n % 250 + 1}")
            fn = adaptive_session if ag == "adaptive" else ice_session
            r = await fn(cfgs[i], cfgs[j], ips, f"{n}", seed=n)
            r.update(nat_a=label(cfgs[i]), nat_b=label(cfgs[j]), trial=t)
            rows.append(r)
            done[0] += 1
            if done[0] % 100 == 0:
                print(f"{done[0]}/{len(jobs)} sessions, {time.time() - t_start:.0f}s", flush=True)

    await asyncio.gather(*(one(n, *job) for n, job in enumerate(jobs)))
    cl.close(); rl.close()
    keys = ["agent", "nat_a", "nat_b", "trial", "plan", "path", "ok", "t_connect", "packets", "t_profile",
            "p_spray", "profile_a", "profile_b", "reason"]
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in sorted(rows, key=lambda r: (r["agent"], r["nat_a"], r["nat_b"], r["trial"])):
            w.writerow(r)
    print(f"wrote {out}: {len(rows)} sessions in {time.time() - t_start:.0f}s")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 3))
