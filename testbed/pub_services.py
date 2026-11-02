"""
pub_services.py - runs inside the 'pub' namespace: JSON STUN cluster + echo banks,
relay, a binary RFC 8489 STUN server (for aioice), and a tiny signalling server.
"""
import asyncio, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config; config.patch_modules()
import stun_server as srv
from relay import Relay
from aioice import stun


class BinStun(asyncio.DatagramProtocol):
    def connection_made(self, t):
        self.t = t

    def datagram_received(self, data, addr):
        try:
            req = stun.parse_message(data)
        except Exception:
            return
        if req.message_method == stun.Method.BINDING and req.message_class == stun.Class.REQUEST:
            resp = stun.Message(stun.Method.BINDING, stun.Class.RESPONSE, transaction_id=req.transaction_id)
            resp.attributes["XOR-MAPPED-ADDRESS"] = addr
            self.t.sendto(bytes(resp), addr)


class Signalling:
    def __init__(self):
        self.store, self.waiters = {}, {}

    async def handle(self, r, w):
        while line := await r.readline():
            m = json.loads(line)
            if m["op"] == "put":
                self.store[m["k"]] = m["v"]
                for f in self.waiters.pop(m["k"], []):
                    f.set_result(m["v"])
                w.write(b'{"ok":1}\n')
            else:
                if m["k"] not in self.store:
                    f = asyncio.get_running_loop().create_future()
                    self.waiters.setdefault(m["k"], []).append(f)
                    await f
                w.write((json.dumps({"v": self.store[m["k"]]}) + "\n").encode())
            await w.drain()


async def main():
    loop = asyncio.get_running_loop()
    cl = srv.StunCluster(); await cl.start()
    rl = Relay(); await rl.start()
    await loop.create_datagram_endpoint(BinStun, local_addr=config.BIN_STUN)
    sig = Signalling()
    await asyncio.start_server(sig.handle, *config.SIGNAL)
    print("ready", flush=True)
    await asyncio.Event().wait()

asyncio.run(main())
