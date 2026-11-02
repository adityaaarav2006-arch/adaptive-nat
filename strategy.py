"""
strategy.py - Phase B: choose a traversal method from BOTH peers' profiles.

Each side is reduced to how predictable its public port toward the peer is:
  fixed : endpoint-independent mapping -> the server-reflexive port is valid for everyone
  pred  : AD/APD mapping with a sequential or fixed-delta allocator -> next ports predictable
  rand  : AD/APD mapping with a random allocator
and whether its filter is lenient (EI or AD filtering: it accepts packets from
an unknown port on an IP it has already sent to).

Ladder (cheapest first), mirrored deterministically on both peers:
  1. DIRECT  - both fixed: simultaneous open to each other's srflx.
  2. PREDICT - both in {fixed, pred}: each sends to the other's predicted
               window (srflx for fixed, last+k*j for pred); the j-th new
               mapping on one side meets the j-th on the other, so this works
               even with address-and-port-dependent filtering.
             - or a lenient side L whose port is fixed/pred: the other side
               aims at L's (predicted) ports; L accepts the unknown source.
  3. SPRAY   - a random side is involved: an "opener" opens N mappings, a
               "prober" sends M probes to random opener ports; success
               probability ~ 1 - exp(-N*M/R). The opener must either be
               lenient or face a fixed peer (then its mappings all permit the
               peer's single srflx). If the profiler found that the opener's
               ports stay inside one port block (carrier-grade port-block
               allocation), R is the block size instead of the whole port
               range and N = M is chosen for 99% success: ~150 packets
               instead of ~1,600 for a 512-port block.
  4. RELAY   - nothing above applies, or the packet budget K is too small.
"""
import math
from dataclasses import dataclass
from typing import Optional

from nat_sim import MappingType, FilteringType, PORT_MIN, PORT_MAX

R_SPACE = PORT_MAX - PORT_MIN + 1


def kind(p):
    if p.mapping == MappingType.ENDPOINT_INDEPENDENT:
        return "fixed"
    return "pred" if p.allocation in ("sequential", "fixed-delta") else "rand"


def lenient(p):
    return p.filtering in (FilteringType.ENDPOINT_INDEPENDENT, FilteringType.ADDRESS_DEPENDENT)


@dataclass
class Plan:
    method: str                    # DIRECT | PREDICT | SPRAY | RELAY
    reason: str
    opener: Optional[str] = None   # SPRAY: "A" or "B"
    n_open: int = 0
    m_probe: int = 0
    p_success: Optional[float] = None
    range_lo: int = PORT_MIN       # SPRAY: ports the prober aims at
    range_size: int = R_SPACE


SPRAY_TARGET = 0.99            # block-aware spraying is sized for this success probability


def block_spray_size(r, target=SPRAY_TARGET):
    """Smallest N = M with 1 - exp(-N*M/r) >= target (birthday bound), capped at r/2."""
    n = math.ceil(math.sqrt(r * math.log(1 / (1 - target))))
    return min(n, r // 2)


def choose(pa, pb, packet_budget=1600, n_open=256, window=16, block_aware=True):
    ka, kb = kind(pa), kind(pb)
    if ka == kb == "fixed":
        return Plan("DIRECT", "both endpoint-independent mapping")
    if ka in ("fixed", "pred") and kb in ("fixed", "pred"):
        return Plan("PREDICT", f"both ports predictable ({ka}/{kb})")
    # lenient side with a predictable port: the other side aims at it
    # The lenient side answers each probe toward the other side's (unknown) port; under APD
    # mapping that answer leaves from a NEW port, which a strict peer filter drops. So this
    # rung needs a reused mapping on our side (fixed or AD), a lenient peer, or a peer with
    # AD mapping (its single mapping toward our IP has already sent to our whole window).
    for me, other, km, label in ((pa, pb, ka, "A"), (pb, pa, kb, "B")):
        reply_ok = (km == "fixed" or me.mapping == MappingType.ADDRESS_DEPENDENT or lenient(other)
                    or other.mapping == MappingType.ADDRESS_DEPENDENT)
        if km in ("fixed", "pred") and lenient(me) and reply_ok:
            return Plan("PREDICT", f"{label} is lenient and its port is {km}")
    # spray: pick an opener (random side that is lenient, or random side facing a fixed peer)
    # The opener answers a hit from the socket that was hit. Under AD mapping (or toward a
    # fixed peer) that reuses the same mapping, so the prober's filter accepts the reply;
    # under APD mapping toward a non-fixed prober the reply leaves from a NEW port, so the
    # prober must then be lenient itself.
    cands = [(pa, pb, ka, kb, "A"), (pb, pa, kb, ka, "B")]
    if block_aware:   # prefer a side whose ports sit in a small block as the opener (smaller search space)
        cands.sort(key=lambda c: 0 if c[0].block else 1)
    for me, other, km, ko, label in cands:
        reply_ok = ko == "fixed" or me.mapping == MappingType.ADDRESS_DEPENDENT or lenient(other)
        if km == "rand" and (lenient(me) or ko == "fixed") and reply_ok:
            if block_aware and me.block:
                # Port-block-aware spraying: the opener's new ports all fall inside its
                # detected block, so the search space is the block, not the whole port range.
                lo, size = me.block
                n = block_spray_size(size)
                p = 1 - math.exp(-n * n / size)
                return Plan("SPRAY", f"{label} random in a {size}-port block, opener={label}", opener=label,
                            n_open=n, m_probe=n, p_success=p, range_lo=lo, range_size=size)
            m = max(0, packet_budget - 2 * n_open)
            if block_aware and other.block and ko != "fixed":
                # every probe from a non-fixed prober opens a new mapping; a port block caps how
                # many it can hold, and probes beyond that would just be dropped by its NAT
                m = min(m, int(0.75 * other.block[1]))
            if m <= 0:
                return Plan("RELAY", "packet budget too small to spray")
            p = 1 - math.exp(-n_open * m / R_SPACE)
            return Plan("SPRAY", f"{label} random, opener={label}", opener=label, n_open=n_open, m_probe=m, p_success=p)
    return Plan("RELAY", f"no viable direct method ({ka}/{kb}, filters too strict)")
