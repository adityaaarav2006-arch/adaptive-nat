"""
nat_sim.py - NAT device simulator on real asyncio UDP sockets (RFC 4787 model).

Every mapping is a real UDP socket bound on the NAT's own public IP; every
inbound datagram is checked against the configured filtering rule before it
is delivered to the internal host, so a "blocked" packet is a real drop.

Changes for the final system (vs. the Week-3 profiler version):
  * each NAT has its own public IP on loopback (127.x.y.z) so that peers,
    STUN servers and the relay are genuinely different remote addresses;
  * the internal host may own several sockets (`src` ids). Real NATs key
    mappings on the internal ip:port, and birthday spraying needs many of
    them, so the mapping key is now (src, destination-part);
  * the random allocator draws from the realistic 1024-65535 range and the
    sequential / fixed-delta allocators start at a random base port;
  * BLOCK_RANDOM models carrier-grade NATs with port-block allocation: each
    subscriber owns one aligned block (512 ports here) and new mappings get
    random ports inside it.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional


class MappingType(Enum):
    ENDPOINT_INDEPENDENT = "endpoint-independent"
    ADDRESS_DEPENDENT = "address-dependent"
    ADDRESS_AND_PORT_DEPENDENT = "address-and-port-dependent"


class FilteringType(Enum):
    ENDPOINT_INDEPENDENT = "endpoint-independent"
    ADDRESS_DEPENDENT = "address-dependent"
    ADDRESS_AND_PORT_DEPENDENT = "address-and-port-dependent"


class AllocationPolicy(Enum):
    SEQUENTIAL = "sequential"
    FIXED_DELTA = "fixed-delta"
    RANDOM = "random"
    BLOCK_RANDOM = "block-random"   # carrier-grade style: random ports inside one aligned port block


PORT_MIN, PORT_MAX = 1024, 65535
BLOCK_SIZE = 512   # port-block allocation (PBA) block per subscriber, aligned to its size


class PortAllocator:
    """Ground-truth port allocation policy for new mappings."""

    def __init__(self, policy: AllocationPolicy, base_port: Optional[int] = None,
                 delta: Optional[int] = None, rng: Optional[random.Random] = None,
                 block_size: int = BLOCK_SIZE):
        self.rng = rng or random.Random()
        self.policy = policy
        self.base = base_port if base_port is not None else self.rng.randint(20000, 40000)
        self.delta = delta if delta is not None else self.rng.choice([2, 3, 4, 5, 7])
        if policy == AllocationPolicy.FIXED_DELTA and self.delta == 1:
            raise ValueError("fixed-delta needs delta != 1")
        self._n = 0
        self.block_size = block_size
        if policy == AllocationPolicy.BLOCK_RANDOM:   # drawn last: other policies keep their rng sequence
            self.block_lo = self.rng.randrange(PORT_MIN // block_size + 1, (PORT_MAX + 1) // block_size) * block_size

    def allocate(self) -> int:
        if self.policy == AllocationPolicy.SEQUENTIAL:
            port = self.base + self._n
        elif self.policy == AllocationPolicy.FIXED_DELTA:
            port = self.base + self._n * self.delta
        elif self.policy == AllocationPolicy.BLOCK_RANDOM:
            return self.block_lo + self.rng.randrange(self.block_size)
        else:
            return self.rng.randint(PORT_MIN, PORT_MAX)
        self._n += 1
        return port


@dataclass
class MappingEntry:
    src: int = 0
    port: Optional[int] = None
    transport: Optional[asyncio.DatagramTransport] = None
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    sent_to: set = field(default_factory=set)
    sent_to_ips: set = field(default_factory=set)
    closed: bool = False


class _MappingProtocol(asyncio.DatagramProtocol):
    def __init__(self, entry: MappingEntry, owner: "NatDevice"):
        self.entry, self.owner = entry, owner

    def datagram_received(self, data, addr):
        self.owner._handle_inbound(self.entry, data, addr)

    def error_received(self, exc):  # ICMP port-unreachable etc. on loopback
        pass


class NatDevice:
    def __init__(self, mapping_type: MappingType, filtering_type: FilteringType,
                 allocation_policy: AllocationPolicy = AllocationPolicy.RANDOM,
                 public_ip: str = "127.0.0.1", mapping_ttl: Optional[float] = None,
                 on_message: Optional[Callable] = None, on_drop: Optional[Callable] = None,
                 seed: Optional[int] = None, base_port: Optional[int] = None,
                 delta: Optional[int] = None):
        self.mapping_type = mapping_type
        self.filtering_type = filtering_type
        self.allocation_policy = allocation_policy
        self.allocator = PortAllocator(allocation_policy, base_port, delta, random.Random(seed))
        self.ip = public_ip
        self.mapping_ttl = mapping_ttl
        self.on_message = on_message      # (data, addr, public_port, src)
        self.on_drop = on_drop            # (addr, public_port)
        self.mappings: dict = {}
        self.sent = 0                     # outbound datagrams (overhead metric)
        self.dropped = 0                  # inbound datagrams rejected by filtering
        self.exhausted = 0                # outbound datagrams dropped for lack of a free port

    # ------------------------------------------------------------ mapping
    def _key(self, src, dest_ip, dest_port):
        if self.mapping_type == MappingType.ENDPOINT_INDEPENDENT:
            return (src, "*")
        if self.mapping_type == MappingType.ADDRESS_DEPENDENT:
            return (src, dest_ip)
        return (src, dest_ip, dest_port)

    def _expired(self, e: MappingEntry) -> bool:
        return self.mapping_ttl is not None and (time.time() - e.last_active) > self.mapping_ttl

    async def _get_or_create(self, src, dest_ip, dest_port) -> Optional[MappingEntry]:
        key = self._key(src, dest_ip, dest_port)
        e = self.mappings.get(key)
        if e and not e.closed and not self._expired(e):
            return e
        if e:
            e.closed = True
            if e.transport:
                e.transport.close()
        loop = asyncio.get_running_loop()
        new = MappingEntry(src=src)
        for _ in range(200):
            port = self.allocator.allocate()
            if not (PORT_MIN <= port <= PORT_MAX):
                continue
            try:
                transport, _ = await loop.create_datagram_endpoint(
                    lambda: _MappingProtocol(new, self), local_addr=(self.ip, port))
            except OSError:
                continue  # port busy: a real NAT would also skip it
            new.port, new.transport = port, transport
            self.mappings[key] = new
            return new
        return None   # no free port (e.g. a port block is exhausted): a real NAT drops the packet

    async def send(self, dest_ip: str, dest_port: int, data: bytes, src: int = 0, ttl=None) -> int:
        e = await self._get_or_create(src, dest_ip, dest_port)
        if e is None:
            self.sent += 1
            self.exhausted += 1
            return None
        e.sent_to.add((dest_ip, dest_port))
        e.sent_to_ips.add(dest_ip)
        e.last_active = time.time()
        e.transport.sendto(data, (dest_ip, dest_port))
        self.sent += 1
        return e.port

    # ------------------------------------------------------------ filtering
    def _passes(self, e: MappingEntry, addr) -> bool:
        if self.filtering_type == FilteringType.ENDPOINT_INDEPENDENT:
            return True
        if self.filtering_type == FilteringType.ADDRESS_DEPENDENT:
            return addr[0] in e.sent_to_ips
        return tuple(addr) in e.sent_to

    def _handle_inbound(self, e: MappingEntry, data: bytes, addr):
        if e.closed:
            return
        if not self._passes(e, addr):
            self.dropped += 1
            if self.on_drop:
                self.on_drop(addr, e.port)
            return
        e.last_active = time.time()
        if self.on_message:
            self.on_message(data, addr, e.port, e.src)

    def close(self):
        for e in self.mappings.values():
            e.closed = True
            if e.transport:
                e.transport.close()
