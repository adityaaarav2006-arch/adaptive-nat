"""
evaluate_blocks.py - port-block-aware spraying vs. the same agent without block
awareness vs. the ICE-style baseline, on carrier-grade NATs with port-block
allocation (random ports inside one aligned 512-port block).

Pairings: each of the 6 block NAT types (AD/APD mapping x 3 filters) against each
of the 21 NAT types of the main evaluation -> 126 pairings x TRIALS x 3 agents.
Results -> evaluation_blocks.csv
"""
import asyncio, csv, sys, time
from functools import partial

from accuracy_test import matrix
from agents import adaptive_session, ice_session
from evaluate import label as base_label
from nat_sim import AllocationPolicy as A
from relay import Relay
import stun_server as srv


label = base_label


AGENTS = {"block-aware": partial(adaptive_session, block_aware=True),
          "block-unaware": partial(adaptive_session, block_aware=False),
          "ice": ice_session}


async def main(trials=3, conc=6, out="evaluation_blocks.csv"):
    blocks = matrix(blocks=True)
    others = [(m, f, a or A.RANDOM) for m, f, a in matrix()]
    jobs = [(b, o, t, ag) for b in blocks for o in others for t in range(trials) for ag in AGENTS]
    cl = srv.StunCluster(); await cl.start()
    rl = Relay(); await rl.start()
    sem, rows, t0 = asyncio.Semaphore(conc), [], time.time()

    async def one(n, b, o, t, ag):
        async with sem:
            ips = (f"127.{150 + n // 60000}.{(n // 250) % 240}.{n % 250 + 1}",
                   f"127.{200 + n // 60000}.{(n // 250) % 240}.{n % 250 + 1}")
            r = await AGENTS[ag](b, o, ips, f"blk{n}", seed=n)
            r.update(agent=ag, nat_a=label(b), nat_b=label(o), trial=t)
            rows.append(r)
            if len(rows) % 100 == 0:
                print(f"{len(rows)}/{len(jobs)} sessions, {time.time() - t0:.0f}s", flush=True)

    await asyncio.gather(*(one(n, *j) for n, j in enumerate(jobs)))
    cl.close(); rl.close()
    keys = ["agent", "nat_a", "nat_b", "trial", "plan", "path", "ok", "t_connect", "packets", "n_open", "m_probe",
            "spray_range", "p_spray", "profile_a", "profile_b", "reason"]
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore"); w.writeheader()
        for r in sorted(rows, key=lambda r: (r["agent"], r["nat_a"], r["nat_b"], r["trial"])):
            w.writerow(r)
    print(f"wrote {out}: {len(rows)} sessions in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 3))
