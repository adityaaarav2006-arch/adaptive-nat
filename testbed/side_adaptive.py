"""
side_adaptive.py - one peer of the adaptive agent, on a real host behind a real
kernel NAT. Same Profiler / strategy / punching code as the simulator; only the
"device" underneath is now a set of ordinary UDP sockets.
"""
import asyncio, json, random, socket, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config; config.patch_modules()
from host import Host
from profiler import Profiler, Profile, newest_port
from strategy import choose
from nat_sim import MappingType, FilteringType
import agents
from agents import Side, punch_predict, punch_spray, predict_targets, T_BUDGET, PACKET_BUDGET
from sigclient import SigClient


class _P(asyncio.DatagramProtocol):
    def __init__(self, dev, src):
        self.dev, self.src = dev, src

    def datagram_received(self, data, addr):
        if self.dev.on_message:
            self.dev.on_message(data, addr, None, self.src)

    def error_received(self, exc):
        pass


class RealDevice:
    """Real UDP sockets; the kernel NAT in front of this namespace does the translation."""
    def __init__(self):
        self.on_message, self.sent, self.ip = None, 0, None
        self._socks = {}

    async def send(self, ip, port, data, src=0, ttl=None):
        if src not in self._socks:                       # one in-flight creation per src
            self._socks[src] = asyncio.ensure_future(asyncio.get_running_loop().create_datagram_endpoint(
                lambda: _P(self, src), local_addr=("0.0.0.0", 0)))
        t, _ = await self._socks[src]
        sock = t.get_extra_info("socket")
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl or 64)
        t.sendto(data, (ip, port))
        self.sent += 1

    def close(self):
        for f in self._socks.values():
            if f.done():
                f.result()[0].close()


def prof_to_json(p):
    return dict(m=p.mapping.value, f=p.filtering.value, a=p.allocation, k=p.delta, srflx=list(p.srflx), s=p.seconds, n=p.probes,
                b=list(p.block) if p.block else None)


def prof_from_json(d):
    return Profile(MappingType(d["m"]), FilteringType(d["f"]), d["a"], d["k"], tuple(d["srflx"]), d["s"], d["n"],
                   tuple(d["b"]) if d.get("b") else None)


async def main(role, sid, block_aware=True):
    peer = "B" if role == "A" else "A"
    sig = await SigClient().connect()
    dev = RealDevice(); h = Host(dev, role); s = Side(h, role, sid)
    prof = await Profiler(h).run()
    await s.lease_relay()
    last = await newest_port(h)
    await sig.put(f"{sid}:{role}", dict(ip=prof.srflx[0], srflx=prof.srflx[1], last=last, prof=prof_to_json(prof)))
    pi = await sig.get(f"{sid}:{peer}")
    s.peer_ip = pi["ip"]
    profs = {role: prof, peer: prof_from_json(pi["prof"])}
    plan = choose(profs["A"], profs["B"], PACKET_BUDGET, block_aware=block_aware)
    sent0, t0 = dev.sent, time.perf_counter()
    path = "relay"
    if plan.method != "RELAY":
        deadline = t0 + T_BUDGET
        rng = random.Random(hash((sid, role)) & 0xffff)
        if plan.method == "SPRAY":
            await punch_spray(s, plan, profs[peer], pi, deadline, rng)
        else:
            me_info = dict(ip=prof.srflx[0], srflx=prof.srflx[1], last=last)
            await punch_predict(s, predict_targets(prof, me_info, profs[peer], pi), deadline)
        await sig.put(f"{sid}:{role}:ready", s.ready.is_set())
        if s.ready.is_set() and await sig.get(f"{sid}:{peer}:ready"):
            await s.direct_data(3)
            t_end = time.perf_counter() + 0.5
            while s.data_rx < 3 and time.perf_counter() < t_end:
                await asyncio.sleep(0.005)
            await sig.put(f"{sid}:{role}:verified", s.data_rx >= 3)
            if s.data_rx >= 3 and await sig.get(f"{sid}:{peer}:verified"):
                path = "direct"
    ok = True
    if path == "relay":
        await s.relay_data(3)
        t_end = time.perf_counter() + 1.0
        while s.relay_rx < 3 and time.perf_counter() < t_end:
            await asyncio.sleep(0.005)
        ok = s.relay_rx >= 3
    print(json.dumps(dict(agent="adaptive", role=role, plan=plan.method, reason=plan.reason, profile=prof.short(),
                          n_open=plan.n_open, m_probe=plan.m_probe, spray_range=plan.range_size,
                          path=path, ok=ok, t_connect=time.perf_counter() - t0, packets=dev.sent - sent0,
                          t_profile=prof.seconds)), flush=True)
    dev.close()

asyncio.run(main(sys.argv[1], sys.argv[2], block_aware="--no-block" not in sys.argv))
