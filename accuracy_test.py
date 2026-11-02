"""
accuracy_test.py - score the profiler against every distinct ground-truth NAT.

Allocation policy is observable whenever the NAT creates a new mapping per
destination IP, i.e. for AD and APD mapping (EI mapping reuses one port), so
the matrix is 3 (EI) + 9 (AD) + 9 (APD) = 21 configurations.
Each NAT gets its own public IP on loopback.
"""
import asyncio, csv, sys
from nat_sim import NatDevice, MappingType as M, FilteringType as F, AllocationPolicy as A
from host import Host
from profiler import Profiler
import stun_server as srv


BASE_ALLOC = [A.SEQUENTIAL, A.FIXED_DELTA, A.RANDOM]


def matrix(blocks=False):
    """The 21 configurations of the main evaluation; blocks=True gives only the 6
    carrier-grade port-block configurations (AD/APD mapping x 3 filters)."""
    out = []
    for m in M:
        for f in F:
            if blocks:
                if m != M.ENDPOINT_INDEPENDENT:
                    out.append((m, f, A.BLOCK_RANDOM))
            elif m == M.ENDPOINT_INDEPENDENT:
                out.append((m, f, None))
            else:
                out += [(m, f, a) for a in BASE_ALLOC]
    return out


async def main(reps=1, out="accuracy_results.csv", blocks=False):
    cl = srv.StunCluster(); await cl.start()
    rows, ok_all = [], 0
    cases = matrix(blocks)
    n = 0
    for rep in range(reps):
        for i, (m, f, a) in enumerate(cases):
            n += 1
            nat = NatDevice(m, f, a or A.RANDOM, public_ip=f"127.20.{rep}.{i + 1}", seed=1000 * rep + i)
            p = await Profiler(Host(nat, "x")).run()
            nat.close()
            ok_m, ok_f = p.mapping == m, p.filtering == f
            if a == A.BLOCK_RANDOM:
                truth_block = (nat.allocator.block_lo, nat.allocator.block_size)
                ok_a = p.allocation == "random" and p.block == truth_block
            else:
                truth_block = None
                ok_a = ((a is None and p.allocation is None) or (a is not None and p.allocation == a.value)) and p.block is None
            ok = ok_m and ok_f and ok_a
            ok_all += ok
            rows.append(dict(rep=rep, mapping=m.value, filtering=f.value, allocation=a.value if a else "n/a",
                             detected=p.short(), delta=p.delta or "", mapping_ok=ok_m, filtering_ok=ok_f,
                             allocation_ok=ok_a, seconds=round(p.seconds, 3), probes=p.probes,
                             true_block=truth_block or "", detected_block=p.block or ""))
            print(f"[{n:3d}] {'OK ' if ok else 'BAD'} truth={m.value[:4]}/{f.value[:4]}/{a.value if a else '-':11s} got={p.short():16s} k={p.delta} {p.seconds:.2f}s {p.probes}p")
    cl.close()
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    print(f"\nFully correct: {ok_all}/{len(rows)}")
    return rows


if __name__ == "__main__":
    reps = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    if "--blocks" in sys.argv:
        asyncio.run(main(reps, "accuracy_blocks.csv", blocks=True))
    else:
        asyncio.run(main(reps))
