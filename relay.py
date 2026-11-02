"""
relay.py - minimal TURN-like UDP relay (stand-in for coturn in the simulator).

A peer "allocates" by sending {"type":"alloc","sid":..,"who":..}; the relay
remembers the source address the packet arrived from (i.e. the peer's NAT
mapping toward the relay). {"type":"relay","sid":..,"who":..,"body":..} is
forwarded to the other party of the same session. Because each peer has
sent to the relay, the relay's packets pass every filtering type.
"""
import asyncio
import json

RELAY_IP, RELAY_PORT = "127.0.0.3", 3478


class _RelayProto(asyncio.DatagramProtocol):
    def __init__(self):
        self.sessions = {}   # sid -> {who: addr}
        self.forwarded = 0

    def connection_made(self, t):
        self.t = t

    def datagram_received(self, data, addr):
        try:
            msg = json.loads(data.decode())
        except (ValueError, UnicodeDecodeError):
            return
        s = self.sessions.setdefault(msg.get("sid"), {})
        if msg.get("type") == "alloc":
            s[msg["who"]] = addr
            self.t.sendto(json.dumps({"type": "alloc-ok", "sid": msg["sid"]}).encode(), addr)
        elif msg.get("type") == "relay":
            s[msg["who"]] = addr
            for who, a in s.items():
                if who != msg["who"]:
                    self.forwarded += 1
                    self.t.sendto(json.dumps({"type": "relayed", "sid": msg["sid"], "from": msg["who"],
                                              "body": msg["body"]}).encode(), a)


class Relay:
    async def start(self):
        self.t, self.p = await asyncio.get_running_loop().create_datagram_endpoint(
            _RelayProto, local_addr=(RELAY_IP, RELAY_PORT))

    def close(self):
        self.t.close()
