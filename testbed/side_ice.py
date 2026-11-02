"""
side_ice.py - one peer using the real aioice ICE implementation (the baseline
named in the synopsis). Candidates are exchanged through the same signalling
server; aioice runs its own RFC 8445 connectivity checks. No TURN server is
configured, so a failed ICE session is reported as "relay needed".
"""
import asyncio, json, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import aioice
from config import BIN_STUN
from sigclient import SigClient


async def main(role, sid, limit=15.0):
    peer = "B" if role == "A" else "A"
    sig = await SigClient().connect()
    conn = aioice.Connection(ice_controlling=(role == "A"), stun_server=BIN_STUN, use_ipv6=False)
    tg = time.perf_counter()
    await conn.gather_candidates()
    t_gather = time.perf_counter() - tg
    await sig.put(f"{sid}:{role}", dict(c=[c.to_sdp() for c in conn.local_candidates],
                                         u=conn.local_username, p=conn.local_password))
    pi = await sig.get(f"{sid}:{peer}")
    conn.remote_username, conn.remote_password = pi["u"], pi["p"]
    for c in pi["c"]:
        await conn.add_remote_candidate(aioice.Candidate.from_sdp(c))
    await conn.add_remote_candidate(None)
    t0 = time.perf_counter()
    path, err = "relay", ""
    try:
        await asyncio.wait_for(conn.connect(), limit)
        await conn.send(b"data-from-" + role.encode())
        got = await asyncio.wait_for(conn.recv(), 2.0)
        path = "direct" if got.startswith(b"data-from-") else "relay"
    except Exception as e:  # ConnectionError when every pair fails, or timeout
        err = type(e).__name__
    print(json.dumps(dict(agent="aioice", role=role, path=path, t_connect=time.perf_counter() - t0,
                          t_profile=t_gather, err=err)), flush=True)
    await conn.close()

asyncio.run(main(sys.argv[1], sys.argv[2]))
