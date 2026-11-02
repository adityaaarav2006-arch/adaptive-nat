"""
stun_server.py - STUN-style behaviour-discovery service (RFC 5780 primitives).

Listens on two IPs x two ports and honours CHANGE-REQUEST (reply from the
other IP and/or port), which is what the filtering test needs.

Echo banks (plain "what is my public ip:port" responders):
  * ALLOC_BANK: 12 distinct IPs, same port. Distinct *IPs* force a new
    mapping on both address-dependent and address-and-port-dependent NATs,
    so the allocation policy can be measured for AD as well as APD mapping.
  * FRESH_BANK: a few more IPs an agent uses right before punching to learn
    the newest port its NAT has handed out (the base for delta prediction).

JSON over UDP stands in for the binary STUN wire format (documented
simplification); the discovery logic is what is under test.
"""

import asyncio
import json

PRIMARY_IP, ALT_IP = "127.0.0.1", "127.0.0.2"
PRIMARY_PORT, ALT_PORT = 7001, 7002
ALLOC_BANK = [(f"127.0.8.{i}", 8000) for i in range(1, 13)]
FRESH_BANK = [(f"127.0.9.{i}", 9000) for i in range(1, 9)]


class _StunProtocol(asyncio.DatagramProtocol):
    def __init__(self, my_ip, my_port, responders):
        self.my_ip, self.my_port, self.responders = my_ip, my_port, responders

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        try:
            msg = json.loads(data.decode())
        except (ValueError, UnicodeDecodeError):
            return
        if msg.get("type") != "stun-request":
            return
        rip = ALT_IP if msg.get("change_ip") else self.my_ip
        rport = ALT_PORT if msg.get("change_port") else self.my_port
        resp = json.dumps({"type": "stun-response", "txn": msg.get("txn"),
                           "observed_ip": addr[0], "observed_port": addr[1]}).encode()
        t = self.responders.get((rip, rport))
        if t:
            t.sendto(resp, addr)


class _EchoProtocol(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        try:
            msg = json.loads(data.decode())
        except (ValueError, UnicodeDecodeError):
            return
        if msg.get("type") == "stun-request":
            self.transport.sendto(json.dumps({"type": "stun-response", "txn": msg.get("txn"),
                                              "observed_ip": addr[0], "observed_port": addr[1]}).encode(), addr)


class StunCluster:
    def __init__(self):
        self._t = []

    async def start(self):
        loop = asyncio.get_running_loop()
        responders, protos = {}, []
        for ip, port in [(PRIMARY_IP, PRIMARY_PORT), (PRIMARY_IP, ALT_PORT), (ALT_IP, PRIMARY_PORT), (ALT_IP, ALT_PORT)]:
            p = _StunProtocol(ip, port, responders)
            t, _ = await loop.create_datagram_endpoint(lambda p=p: p, local_addr=(ip, port))
            responders[(ip, port)] = t
            self._t.append(t)
        for ip, port in ALLOC_BANK + FRESH_BANK:
            t, _ = await loop.create_datagram_endpoint(_EchoProtocol, local_addr=(ip, port))
            self._t.append(t)

    def close(self):
        for t in self._t:
            t.close()
