"""
netbed.py - build the namespace testbed with real Linux NATs (nftables + conntrack).

  hA --[10.1.0.0/24]-- natA --[100.64.1.0/30]--+
                                                pub (internet: STUN, relay, signalling)
  hB --[10.2.0.0/24]-- natB --[100.64.2.0/30]--+

NAT behaviours available from the kernel:
  full-cone      : masquerade (port-preserving) + DNAT of every inbound UDP port to the host
                   -> EI mapping / EI filtering
  port-restricted: plain masquerade -> EI mapping (port preserved) / APD filtering (conntrack)
  symmetric      : masquerade random -> APD mapping with random ports / APD filtering
  symmetric-block: masquerade to :40960-41471 random -> like symmetric, but every port comes from
                   one aligned 512-port block (carrier-grade port-block allocation)
"""
import subprocess
from pyroute2 import IPRoute, NetNS, netns

from config import STUN_IPS, RELAY_IP, SIGNAL, BIN_STUN, ALLOC_BANK, FRESH_BANK, SIDES

NS = ["pub", "natA", "natB", "hA", "hB"]


def sh(ns, cmd, inp=None):
    r = subprocess.run(["nsenter", f"--net=/var/run/netns/{ns}", "sh", "-c", cmd], input=inp,
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"[{ns}] {cmd}: {r.stderr}")
    return r.stdout


def teardown():
    for n in NS:
        try:
            netns.remove(n)
        except Exception:
            pass


def _veth(a_ns, a_if, a_ip, b_ns, b_if, b_ip, plen):
    tmp = f"t{a_ns}{a_if}"[:15]          # unique in the root namespace while being created
    ip = IPRoute()
    ip.link("add", ifname=tmp, kind="veth", peer={"ifname": b_if, "net_ns_fd": b_ns})
    ip.link("set", index=ip.link_lookup(ifname=tmp)[0], net_ns_fd=a_ns)
    ip.close()
    with NetNS(a_ns) as n:
        n.link("set", index=n.link_lookup(ifname=tmp)[0], ifname=a_if)
    for ns, ifn, addr in ((a_ns, a_if, a_ip), (b_ns, b_if, b_ip)):
        with NetNS(ns) as n:
            i = n.link_lookup(ifname=ifn)[0]
            n.addr("add", index=i, address=addr, prefixlen=plen)
            n.link("set", index=i, state="up")


def _route(ns, gw):
    with NetNS(ns) as n:
        n.route("add", dst="0.0.0.0/0", gateway=gw)


def nat_rules(kind, side):
    s = SIDES[side]
    post = {"symmetric": "masquerade random",
            # carrier-grade style port-block allocation: random ports inside one aligned 512-port block
            "symmetric-block": "masquerade to :40960-41471 random"}.get(kind, "masquerade")
    if kind == "symmetric-block":   # port ranges need a protocol match; TCP signalling uses plain masquerade
        post = 'meta l4proto udp masquerade to :40960-41471 random; oifname "wan" masquerade'
    rules = f"""table ip nat {{
  chain post {{ type nat hook postrouting priority 100; oifname "wan" {post}; }}
"""
    if kind == "full-cone":
        rules += f'  chain pre {{ type nat hook prerouting priority -100; iifname "wan" meta l4proto udp dnat to {s["host"]}; }}\n'
    rules += "}\n"
    return rules


def build(kind_a, kind_b):
    teardown()
    for n in NS:
        netns.create(n)
        with NetNS(n) as h:
            h.link("set", index=h.link_lookup(ifname="lo")[0], state="up")
    for side, kind in (("A", kind_a), ("B", kind_b)):
        s = SIDES[side]
        _veth(f"nat{side}", "wan", s["wan"], "pub", f"to{side}", s["gw_pub"], 30)
        _veth(f"h{side}", "eth0", s["host"], f"nat{side}", "lan", s["lan_gw"], 24)
        _route(f"h{side}", s["lan_gw"])
        _route(f"nat{side}", s["gw_pub"])
        sh(f"nat{side}", "echo 1 > /proc/sys/net/ipv4/ip_forward")
        sh(f"nat{side}", "nft -f -", nat_rules(kind, side))
    sh("pub", "echo 1 > /proc/sys/net/ipv4/ip_forward")
    with NetNS("pub") as p:
        lo = p.link_lookup(ifname="lo")[0]
        for a in list(STUN_IPS) + [RELAY_IP, SIGNAL[0], BIN_STUN[0]] + [i for i, _ in ALLOC_BANK + FRESH_BANK]:
            p.addr("add", index=lo, address=a, prefixlen=32)


if __name__ == "__main__":
    import sys
    build(sys.argv[1], sys.argv[2])
    print(sh("hA", "python3 -c \"import socket;s=socket.socket(2,2);s.settimeout(1);s.sendto(b'x',('198.18.0.4',9));print('hA can send')\""))
    print(sh("natA", "nft list ruleset"))
    teardown()
