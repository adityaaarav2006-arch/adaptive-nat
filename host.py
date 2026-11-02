"""
host.py - an internal host sitting behind one simulated NAT.

Owns the NatDevice and demultiplexes everything that comes back through it:
STUN responses resolve pending transactions; every other message is handed
to whichever agent (profiler / adaptive agent / ICE baseline) is attached.
"""

import asyncio
import itertools
import json

from nat_sim import NatDevice

_txn = itertools.count(1)


class Host:
    def __init__(self, nat: NatDevice, name: str):
        self.nat, self.name = nat, name
        self._pending = {}
        self.handler = None          # fn(msg: dict, addr, public_port, src)
        self.stun_requests = 0
        nat.on_message = self._on_message

    def _on_message(self, data, addr, public_port, src):
        try:
            msg = json.loads(data.decode())
        except (ValueError, UnicodeDecodeError):
            return
        if msg.get("type") == "stun-response":
            fut = self._pending.get(msg.get("txn"))
            if fut and not fut.done():
                fut.set_result(msg)
            return
        if self.handler:
            self.handler(msg, tuple(addr), public_port, src)

    async def send(self, ip, port, msg: dict, src: int = 0, ttl=None):
        return await self.nat.send(ip, port, json.dumps(msg).encode(), src, ttl)

    async def stun(self, ip, port, change_ip=False, change_port=False, timeout=0.5, retries=3, src=0):
        """One STUN-style transaction; returns the response dict or None."""
        txn = next(_txn)
        fut = asyncio.get_running_loop().create_future()
        self._pending[txn] = fut
        self.stun_requests += 1
        try:
            for _ in range(retries):
                await self.send(ip, port, {"type": "stun-request", "txn": txn,
                                           "change_ip": change_ip, "change_port": change_port}, src)
                try:
                    return await asyncio.wait_for(asyncio.shield(fut), timeout)
                except asyncio.TimeoutError:
                    continue
            return None
        finally:
            self._pending.pop(txn, None)
