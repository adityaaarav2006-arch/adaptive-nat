"""
agents.py - the adaptive traversal agent and the ICE-style baseline.

Both agents run a full session between two hosts behind simulated NATs:
  gather/profile -> exchange via signalling -> try a direct path -> fall back
  to the relay -> verify the chosen path by exchanging data both ways.

Signalling is an in-process mailbox (both peers live in one event loop); in
the Node prototype it is a TCP server. It carries no packets through the NATs.

Metrics per session: final path, method tried, time to a verified path
(measured from the moment both peers have exchanged their information, so
profiling/gathering is reported separately), datagrams sent through each NAT
during the connection phase, profiling time.
"""
import asyncio
import random
import time

from host import Host
from nat_sim import NatDevice
from profiler import Profiler, newest_port
from relay import RELAY_IP, RELAY_PORT
from strategy import choose, kind
import stun_server as srv

T_BUDGET = 2.5          # seconds allowed for a direct path (both agents)
WINDOW = 16             # predicted-port window (each side sends 2*WINDOW)
PACKET_BUDGET = 1600
OPEN_TTL = 2            # opening packets: create our own NAT mapping but expire before the
                        # peer's NAT. On Linux NATs a packet that reaches the peer's NAT
                        # before the peer's own mapping exists leaves a conntrack entry that
                        # forces the peer's NAT to remap the port (the punch then fails).
                        # 2 = host->NAT->internet hops in the testbed; real paths need probing.


class Signal:
    """Mailbox for one session: post(key, value) / await get(key)."""
    def __init__(self):
        self._f = {}

    def _fut(self, k):
        if k not in self._f:
            self._f[k] = asyncio.get_running_loop().create_future()
        return self._f[k]

    def post(self, k, v):
        f = self._fut(k)
        if not f.done():
            f.set_result(v)

    async def get(self, k, timeout=None):
        return await asyncio.wait_for(asyncio.shield(self._fut(k)), timeout)


class Side:
    """Per-peer state shared by both agent types."""
    def __init__(self, host: Host, label: str, sid: str):
        self.h, self.label, self.sid = host, label, sid
        self.peer_label = "B" if label == "A" else "A"
        self.peer_ip = None
        self.ready = asyncio.Event()
        self.pair = None                 # (src, addr) of a verified direct pair
        self.data_rx = 0
        self.relay_rx = 0
        self.alloc_ok = asyncio.Event()
        self.pending_checks = {}         # ICE: txn -> dest addr
        self.remote_cands = []           # ICE: candidate addresses to check
        host.handler = self.on_msg

    def spawn(self, coro):
        asyncio.get_running_loop().create_task(coro)

    # ---------------------------------------------------------------- inbound
    def on_msg(self, msg, addr, public_port, src):
        t = msg.get("type")
        if t == "alloc-ok":
            self.alloc_ok.set()
        elif t == "relayed":
            if msg["body"].get("kind") == "data":
                self.relay_rx += 1
        elif addr[0] != self.peer_ip:
            return
        elif t == "punch":
            self.spawn(self.h.send(addr[0], addr[1], {"type": "punch-ack"}, src))
        elif t == "punch-ack":
            if not self.ready.is_set():
                self.pair = (src, addr)
                self.ready.set()
                self.spawn(self.h.send(addr[0], addr[1], {"type": "confirm"}, src))
        elif t == "confirm":
            if not self.ready.is_set():
                self.pair = (src, addr)
                self.ready.set()
        elif t == "check":                       # ICE connectivity check
            self.spawn(self.h.send(addr[0], addr[1], {"type": "check-resp", "txn": msg["txn"]}, src))
            if addr not in self.remote_cands:    # peer-reflexive candidate -> triggered checks
                self.remote_cands.append(addr)
        elif t == "check-resp":
            dest = self.pending_checks.get(msg["txn"])
            if dest == addr and not self.ready.is_set():   # ICE requires a symmetric response
                self.pair = (src, addr)
                self.ready.set()
        elif t == "data":
            self.data_rx += 1

    # ---------------------------------------------------------------- relay
    async def lease_relay(self):
        for _ in range(10):
            await self.h.send(RELAY_IP, RELAY_PORT, {"type": "alloc", "sid": self.sid, "who": self.label})
            try:
                await asyncio.wait_for(self.alloc_ok.wait(), 0.2)
                return True
            except asyncio.TimeoutError:
                pass
        return False

    async def relay_data(self, n=3):
        for i in range(n):
            await self.h.send(RELAY_IP, RELAY_PORT, {"type": "relay", "sid": self.sid, "who": self.label,
                                                      "body": {"kind": "data", "i": i}})

    async def direct_data(self, n=3):
        src, addr = self.pair
        for i in range(n):
            await self.h.send(addr[0], addr[1], {"type": "data", "i": i}, src)


async def _verify(sides, path, n=3, timeout=0.5):
    """Exchange n data messages each way on the chosen path; True if all arrive."""
    for s in sides:
        await (s.direct_data(n) if path == "direct" else s.relay_data(n))
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        got = [(s.data_rx if path == "direct" else s.relay_rx) >= n for s in sides]
        if all(got):
            return True
        await asyncio.sleep(0.005)
    return False


# ============================================================ adaptive agent
def _clamp(p):
    return 1024 + (p - 1024) % (65535 - 1024 + 1)


def predict_targets(me_prof, me_info, peer_prof, peer_info):
    pk, mk = kind(peer_prof), kind(me_prof)
    if pk == "fixed":
        return [peer_info["srflx"]]
    if pk == "pred":
        return [_clamp(peer_info["last"] + peer_prof.delta * j) for j in range(1, 2 * WINDOW + 1)]
    # peer random: we are the lenient side; just open our (predictable) mappings toward its IP
    if mk == "pred":
        return [_clamp(peer_info["srflx"] + j) for j in range(1, WINDOW + 1)]
    return [peer_info["srflx"]]


async def punch_predict(side, targets, deadline):
    for t in targets:                                   # open our mappings first (low TTL)
        await side.h.send(side.peer_ip, t, {"type": "punch"}, ttl=OPEN_TTL)
    await asyncio.sleep(0.05)
    while time.perf_counter() < deadline and not side.ready.is_set():
        for t in targets:
            await side.h.send(side.peer_ip, t, {"type": "punch"})
        try:
            await asyncio.wait_for(side.ready.wait(), 0.1)
        except asyncio.TimeoutError:
            pass


async def punch_spray(side, plan, peer_prof, peer_info, deadline, rng):
    if plan.opener == side.label:
        targets = [peer_info["srflx"] if kind(peer_prof) == "fixed" else rng.randint(1024, 65535)
                   for _ in range(plan.n_open)]
        for rnd in range(2):
            for i, t in enumerate(targets):
                await side.h.send(side.peer_ip, t, {"type": "punch"}, src=i + 1, ttl=OPEN_TTL)
            try:
                await asyncio.wait_for(side.ready.wait(), 0.3)
                return
            except asyncio.TimeoutError:
                pass
        while time.perf_counter() < deadline and not side.ready.is_set():
            await asyncio.sleep(0.02)
    else:
        await asyncio.sleep(0.05)               # let the opener's mappings exist first
        ports = rng.sample(range(plan.range_lo, plan.range_lo + plan.range_size), plan.m_probe)
        for k in range(0, len(ports), 32):
            if side.ready.is_set() or time.perf_counter() >= deadline:
                return
            for p in ports[k:k + 32]:
                await side.h.send(side.peer_ip, p, {"type": "punch"})
            await asyncio.sleep(0.025)
        while time.perf_counter() < deadline and not side.ready.is_set():
            await asyncio.sleep(0.02)


async def adaptive_session(cfg_a, cfg_b, ips, sid, seed=0, block_aware=True):
    rng = random.Random(seed)
    sig = Signal()
    nats = [NatDevice(*cfg_a, public_ip=ips[0], seed=seed * 2 + 1), NatDevice(*cfg_b, public_ip=ips[1], seed=seed * 2 + 2)]
    sides = [Side(Host(n, l), l, sid) for n, l in zip(nats, "AB")]
    out = {"agent": "adaptive"}
    try:
        async def prep(s):
            prof = await Profiler(s.h).run()
            await s.lease_relay()
            last = await newest_port(s.h)
            sig.post(s.label, {"ip": s.h.nat.ip, "srflx": prof.srflx[1], "last": last, "prof": prof})
            return prof
        profs = await asyncio.gather(*(prep(s) for s in sides))
        info = {l: await sig.get(l) for l in "AB"}
        for s in sides:
            s.peer_ip = info[s.peer_label]["ip"]
        plan = choose(profs[0], profs[1], PACKET_BUDGET, block_aware=block_aware)
        out.update(plan=plan.method, reason=plan.reason, n_open=plan.n_open, m_probe=plan.m_probe, spray_range=plan.range_size, profile_a=profs[0].short(), profile_b=profs[1].short(),
                   t_profile=max(p.seconds for p in profs), p_spray=plan.p_success)
        sent0 = [n.sent for n in nats]
        t0 = time.perf_counter()
        path = "relay"
        if plan.method != "RELAY":
            deadline = t0 + T_BUDGET

            async def run(s, me, peer):
                pi = info[s.peer_label]
                if plan.method == "SPRAY":
                    await punch_spray(s, plan, peer, pi, deadline, rng)
                else:
                    await punch_predict(s, predict_targets(me, info[s.label], peer, pi), deadline)
            await asyncio.gather(run(sides[0], profs[0], profs[1]), run(sides[1], profs[1], profs[0]))
            # both peers must hold a working pair (agreed over signalling) -> direct
            if all(s.ready.is_set() for s in sides) and await _verify(sides, "direct"):
                path = "direct"
        ok = path == "direct" or await _verify(sides, "relay")
        out.update(path=path, ok=ok, t_connect=time.perf_counter() - t0,
                   packets=sum(n.sent - s0 for n, s0 in zip(nats, sent0)))
    finally:
        for n in nats:
            n.close()
    return out


# ============================================================ ICE-style baseline
async def ice_session(cfg_a, cfg_b, ips, sid, seed=0, ta=0.05):
    """ICE-style agent: srflx + relay candidates, paced connectivity checks with
    peer-reflexive learning and triggered checks, success only on a symmetric
    response (RFC 8445 7.2.5.2.1). No NAT behaviour awareness."""
    sig = Signal()
    nats = [NatDevice(*cfg_a, public_ip=ips[0], seed=seed * 2 + 1), NatDevice(*cfg_b, public_ip=ips[1], seed=seed * 2 + 2)]
    sides = [Side(Host(n, l), l, sid) for n, l in zip(nats, "AB")]
    out = {"agent": "ice", "plan": "ICE"}
    try:
        async def gather(s):
            t = time.perf_counter()
            r = await s.h.stun(srv.PRIMARY_IP, srv.PRIMARY_PORT)
            await s.lease_relay()
            sig.post(s.label, {"ip": s.h.nat.ip, "srflx": r["observed_port"]})
            return time.perf_counter() - t
        g = await asyncio.gather(*(gather(s) for s in sides))
        out["t_profile"] = max(g)
        info = {l: await sig.get(l) for l in "AB"}
        for s in sides:
            s.peer_ip = info[s.peer_label]["ip"]
            s.remote_cands = [(s.peer_ip, info[s.peer_label]["srflx"])]
        sent0 = [n.sent for n in nats]
        t0 = time.perf_counter()
        deadline = t0 + T_BUDGET
        txn = [0]

        async def checks(s):
            while time.perf_counter() < deadline and not all(x.ready.is_set() for x in sides):
                for c in list(s.remote_cands):
                    txn[0] += 1
                    s.pending_checks[txn[0]] = c
                    await s.h.send(c[0], c[1], {"type": "check", "txn": txn[0]})
                await asyncio.sleep(ta)
        await asyncio.gather(*(checks(s) for s in sides))
        path = "relay"
        if all(s.ready.is_set() for s in sides) and await _verify(sides, "direct"):
            path = "direct"
        ok = path == "direct" or await _verify(sides, "relay")
        out.update(path=path, ok=ok, t_connect=time.perf_counter() - t0,
                   packets=sum(n.sent - s0 for n, s0 in zip(nats, sent0)))
    finally:
        for n in nats:
            n.close()
    return out
