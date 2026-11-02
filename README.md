# Adaptive NAT Traversal: final system

BCSE308P Computer Networks project by Aditya Jaiswal (24BCE2365) and Chiranjib Dash (24BCE2411). Faculty guide: Jaya Subalakshmi R.

The agent profiles both peers' NATs (RFC 4787 mapping, filtering and port allocation) and then picks the cheapest method that can work for that pairing: direct punch, port prediction, birthday-paradox spraying, or a relay leased in parallel.

## Results (all numbers come from the CSV files in this folder)

| | Adaptive | Baseline |
|---|---|---|
| Profiler accuracy (21 configs x 5 runs) | 105/105 | – |
| Simulation, 231 NAT pairings x 3 trials: sessions with a direct path | **88.0%** | 36.4% (ICE-style) |
| Simulation: median time to a working path | 57 ms | 2.54 s |
| Real Linux NATs (namespaces + nftables), 6 pairings x 5 trials: direct | **25/30** | 14/30 (aioice) |

In none of the 231 pairings did ICE get more direct paths than the adaptive agent. Every session of both agents ended with data delivered on some path.

## Port-block-aware spraying (new)

Many carrier-grade NATs give each subscriber one fixed block of ports (port-block allocation) and pick ports randomly inside it. The profiler now detects that block from the ports it already observes. If a random allocator's ports all fit in one aligned power-of-two block of at most 8192 ports, that block is recorded.

The strategy engine then:
- sizes the spray for the block rather than the whole 64,512-port range, choosing N = M for 99% success (49 for a 512-port block);
- prefers the block side as the opener;
- caps probes from a block NAT below its capacity, because a full block silently drops new mappings.

| Block NATs (512-port blocks) | Block-aware | Block-unaware | ICE / aioice |
|---|---|---|---|
| Block detection accuracy (6 configs x 5 runs, exact block start and size) | 30/30 | – | – |
| Simulation, spraying sessions (102): direct | 98.0% | 98.0% | 26.5% |
| Simulation: median packets per session | **92** | 424 | – |
| Simulation: median setup time | **83 ms** | 196 ms | 2.55 s |
| Real Linux NAT (`masquerade to :40960-41471 random`), 10 runs: direct | 10/10 | 10/10 | 0/5 |
| Real Linux NAT: median packets (range) | **92 (90-95)** | 472 (296-1448) | – |
| Real Linux NAT: median setup time | **86 ms** | 228 ms | 15 s timeout |

Block awareness keeps the success rate and cuts packets by about 4.6x at the median in simulation, and by about 5x on the real NAT. The cost also becomes predictable: 90-95 packets every time, against 296-1,448 without it. The worst-case budget falls from about 1,600 packets to about 150. With every other NAT type the decisions are identical to before; this was checked for all 441 ordered pairs of the original 21 types.

> **Patent note.** If you want to explore a patent on this, speak to VIT's IPR cell **before** making this repository public or publishing it. Public disclosure before filing can destroy novelty.

## Layout

| File | Purpose |
|---|---|
| `nat_sim.py` | RFC 4787 NAT simulator on real UDP sockets (3 mapping x 3 filtering x 3 allocation types, several internal sockets per host) |
| `stun_server.py` | Probe service: 2 IPs x 2 ports with CHANGE-REQUEST, plus 20 echo servers |
| `host.py` | Host behind a NAT; routes STUN replies and agent messages |
| `profiler.py` | Behaviour discovery. The filtering test runs on its own socket, with its two probes sent in parallel |
| `strategy.py` | Decision ladder: DIRECT, then PREDICT, then SPRAY, then RELAY |
| `agents.py` | Adaptive agent and ICE-style baseline (symmetric-response rule, peer-reflexive learning, triggered checks) |
| `relay.py` | Minimal TURN-like UDP relay |
| `accuracy_test.py` | Profiler vs. ground truth: `accuracy_results.csv`; with `--blocks`, port-block detection: `accuracy_blocks.csv` |
| `evaluate_blocks.py`, `analyze_blocks.py` | Block-aware vs. block-unaware vs. ICE on block NATs: `evaluation_blocks.csv`, `blocks_summary.json`, `fig_blocks.png` |
| `evaluate.py` | Both agents over every pairing: `evaluation_results.csv` |
| `analyze.py`, `paper_numbers.py` | Summaries, figures, and the numbers quoted in the paper |
| `testbed/` | Real-kernel testbed: `netbed.py` (namespaces + nftables NATs, including a port-block NAT), `pub_services.py`, `side_adaptive.py`, `side_ice.py` (aioice), `run_testbed.py`: `testbed_results.csv`; with `blocks`, `testbed_blocks.csv` |

## Run

```bash
pip install --break-system-packages matplotlib pyroute2 aioice
python3 accuracy_test.py 5          # profiler accuracy
python3 evaluate.py 3               # simulation, about 6 minutes
python3 analyze.py                  # tables + fig_eval.png, fig_overhead.png
sudo python3 testbed/run_testbed.py 5   # real Linux NATs (needs root: network namespaces)
python3 paper_numbers.py            # every figure quoted in the paper
python3 accuracy_test.py 5 --blocks # port-block detection
python3 evaluate_blocks.py 3 && python3 analyze_blocks.py   # block-aware spraying, about 5 minutes
sudo python3 testbed/run_testbed.py blocks 10                # block NAT on real Linux
```

## Findings worth knowing

1. **Discovery tests contaminate each other.** On one shared socket, running the mapping test first made strict filters look lenient in the simulator. Running the filtering test first instead made endpoint-independent Linux NATs look symmetric: the unsolicited CHANGE-REQUEST replies leave conntrack entries, and those force a new port. Running the filtering test on a separate socket fixes both.
2. **Linux conntrack breaks naive simultaneous open.** A punch that reaches the peer's NAT before the peer has sent anything leaves an UNREPLIED entry. That entry forces the peer's NAT to remap its own outgoing port (we observed this directly in `/proc/net/nf_conntrack`). aioice failed every port-restricted pairing because of this. Our agent sends its first packets with TTL 2, so they open the local mapping but die before reaching the far NAT.
3. **Port blocks change what spraying costs.** A carrier-grade NAT that allocates inside a 512-port block shrinks the spray search space roughly 126-fold. Detecting the block lets the agent spray far less for the same success rate. A block NAT also cannot be a heavy prober: once its block is full it drops new mappings.
4. **Replies under APD mapping leave from a new port.** This rules out some pairings that look feasible at first glance. The strategy engine sends those straight to the relay (about 5 ms) instead of punching for 2.5 s.

## Limitations

- The simulator follows the RFC 4787 model exactly.
- The testbed covers three Linux NAT types on one machine, with no real delay or loss.
- TTL = 2 matches the testbed topology.
- The JSON probe format stands in for binary STUN; the aioice runs do use real STUN.
- The relay is minimal, not coturn.
- The adaptive keepalive is not implemented.
- Block detection assumes blocks aligned to their (power-of-two) size, as in the testbed and simulator. Unaligned blocks would need a range-based estimate instead.
