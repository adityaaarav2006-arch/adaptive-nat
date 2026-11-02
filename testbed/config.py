"""Addresses of the network-namespace testbed ("pub" = the internet)."""
STUN_IPS = ("198.18.0.1", "198.18.0.2")
RELAY_IP = "198.18.0.3"
SIGNAL = ("198.18.0.4", 6000)
BIN_STUN = ("198.18.0.5", 3478)          # binary STUN (RFC 8489) for aioice
ALLOC_BANK = [(f"198.18.8.{i}", 8000) for i in range(1, 13)]
FRESH_BANK = [(f"198.18.9.{i}", 9000) for i in range(1, 9)]
SIDES = {"A": dict(wan="100.64.1.2", gw_pub="100.64.1.1", lan_gw="10.1.0.1", host="10.1.0.2"),
         "B": dict(wan="100.64.2.2", gw_pub="100.64.2.1", lan_gw="10.2.0.1", host="10.2.0.2")}


def patch_modules():
    """Point the simulator-era modules at the testbed's addresses."""
    import stun_server as srv, relay, agents
    srv.PRIMARY_IP, srv.ALT_IP = STUN_IPS
    srv.ALLOC_BANK, srv.FRESH_BANK = ALLOC_BANK, FRESH_BANK
    relay.RELAY_IP = agents.RELAY_IP = RELAY_IP
