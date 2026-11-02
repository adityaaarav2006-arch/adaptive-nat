"""
profiler.py - Phase A: NAT behaviour discovery (RFC 4787 axes via RFC 5780 tests).

Isolation matters. Week 3: with one shared socket, running the mapping test
first made restrictive filters look permissive (12/15 -> 15/15 after moving
the filtering test first). On real Linux NATs the opposite order fails too:
the filtering test's unsolicited replies leave conntrack entries that make an
endpoint-independent NAT pick new ports, so it looks symmetric. The final
version runs the filtering test on its own socket, so order no longer matters.

Final-system changes:
  * the two filtering probes are sent in parallel (worst case 1.5 s instead
    of 3 s on address-and-port-dependent filters);
  * allocation policy is measured for AD as well as APD mapping, using a
    bank of distinct server IPs;
  * the profile also carries the server-reflexive port.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Optional

import stun_server as srv
from host import Host
from nat_sim import MappingType, FilteringType

FILTER_SRC = 999   # dedicated internal socket for the filtering test


@dataclass
class Profile:
    mapping: MappingType
    filtering: FilteringType
    allocation: Optional[str]       # "sequential" | "fixed-delta" | "random" | None (EI mapping)
    delta: Optional[int]            # step for sequential (1) / fixed-delta (k)
    srflx: tuple                    # (ip, port) seen by the primary STUN endpoint
    seconds: float = 0.0
    probes: int = 0
    block: Optional[tuple] = None   # (first_port, size) when a random allocator stays inside one aligned port block

    def short(self):
        m = {"endpoint-independent": "EI", "address-dependent": "AD", "address-and-port-dependent": "APD"}
        a = {"sequential": "Seq", "fixed-delta": "Fixed", "random": "Rand", None: "-"}[self.allocation]
        if self.block:
            a = f"Blk{self.block[1]}"
        return f"{m[self.mapping.value]}/{m[self.filtering.value]}/{a}"


class Profiler:
    def __init__(self, host: Host, timeout=0.5, retries=3):
        self.h, self.timeout, self.retries = host, timeout, retries

    async def _q(self, ip, port, **kw):
        return await self.h.stun(ip, port, timeout=self.timeout, retries=self.retries, **kw)

    async def filtering(self):
        # Runs on its OWN socket (FILTER_SRC). Sharing a socket with the mapping test
        # contaminates one test with the other in both orders: in the simulator the
        # mapping test's probes pre-authorise addresses for the filter; on Linux the
        # unsolicited CHANGE-REQUEST replies leave conntrack entries that force the
        # kernel to pick a NEW port when the mapping test later contacts those
        # addresses, so an endpoint-independent NAT looks symmetric.
        r_both, r_port = await asyncio.gather(
            self._q(srv.PRIMARY_IP, srv.PRIMARY_PORT, change_ip=True, change_port=True, src=FILTER_SRC),
            self._q(srv.PRIMARY_IP, srv.PRIMARY_PORT, change_port=True, src=FILTER_SRC))
        if r_both is not None:
            return FilteringType.ENDPOINT_INDEPENDENT
        if r_port is not None:
            return FilteringType.ADDRESS_DEPENDENT
        return FilteringType.ADDRESS_AND_PORT_DEPENDENT

    async def mapping(self):
        x = await self._q(srv.PRIMARY_IP, srv.PRIMARY_PORT)
        if x is None:
            raise RuntimeError("STUN primary unreachable")
        mx = (x["observed_ip"], x["observed_port"])
        y = await self._q(srv.ALT_IP, srv.ALT_PORT)
        if y and (y["observed_ip"], y["observed_port"]) == mx:
            return MappingType.ENDPOINT_INDEPENDENT, mx
        z = await self._q(srv.PRIMARY_IP, srv.ALT_PORT)
        if z and (z["observed_ip"], z["observed_port"]) == mx:
            return MappingType.ADDRESS_DEPENDENT, mx
        return MappingType.ADDRESS_AND_PORT_DEPENDENT, mx

    async def allocation(self, mapping):
        """Returns (policy, step, block). For a random allocator, `block` is the smallest
        aligned power-of-two port block containing every observed port, if one of at most
        MAX_BLOCK ports exists (carrier-grade port-block allocation); otherwise None."""
        if mapping == MappingType.ENDPOINT_INDEPENDENT:
            return None, None, None
        ports = []
        for ip, port in srv.ALLOC_BANK:
            r = await self._q(ip, port)
            if r:
                ports.append(r["observed_port"])
        if len(ports) < 3:
            return "random", None, None
        d = {b - a for a, b in zip(ports, ports[1:])}
        if len(d) == 1:
            k = d.pop()
            return ("sequential" if k == 1 else "fixed-delta"), k, None
        return "random", None, infer_block(ports)

    async def run(self) -> Profile:
        t0, n0 = time.perf_counter(), self.h.stun_requests
        f = await self.filtering()
        m, srflx = await self.mapping()
        a, k, blk = await self.allocation(m)
        return Profile(m, f, a, k, srflx, time.perf_counter() - t0, self.h.stun_requests - n0, blk)


MIN_BLOCK, MAX_BLOCK = 256, 8192


def infer_block(ports):
    """Smallest aligned power-of-two block holding all observed ports. With 12 samples a
    512-port block is mistaken for a 256-port half with probability ~2 * 0.5**12 (0.05%),
    and a full-range random allocator lands in one 8192-port block with probability
    ~(8192/64512)**11 - both negligible."""
    lo, hi = min(ports), max(ports)
    size = MIN_BLOCK
    while size <= MAX_BLOCK:
        if lo // size == hi // size:
            return (lo // size * size, size)
        size *= 2
    return None


async def newest_port(host: Host, idx: int = 0):
    """Ask a never-used echo server which public port the NAT just allocated."""
    ip, port = srv.FRESH_BANK[idx % len(srv.FRESH_BANK)]
    r = await host.stun(ip, port, timeout=0.5, retries=3)
    return r["observed_port"] if r else None
