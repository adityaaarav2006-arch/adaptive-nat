'use strict';
/**
 * Peer client. Usage: node peer.js <A|B> <nat-type>
 *
 * Flow:
 *   1. Bring up a simulated NatDevice of the requested type.
 *   2. Run a two-probe STUN-style test against the server to independently
 *      discover our own NAT class (cone vs symmetric) — the peer does NOT
 *      trust the CLI flag, it works this out from observed behaviour.
 *   3. Report our observed public endpoint + NAT class to the server over
 *      the TCP control channel; receive the other peer's endpoint + class.
 *   4. Adaptive strategy:
 *        - Attempt direct UDP hole punching first, always (it's cheap).
 *        - If no packet arrives from the peer within PUNCH_TIMEOUT_MS,
 *          fall back to relaying through the server over TCP.
 *   5. Exchange a handful of demo messages over whichever path won, then
 *      report the outcome and exit.
 */

const net = require('net');
const { NatDevice } = require('./nat-sim');

const SERVER_IP = '127.0.0.1';
const CONTROL_PORT = 6000;
const PROBE_PORT_1 = 7001;
const PROBE_PORT_2 = 7002;
const PUNCH_TIMEOUT_MS = 2500;
const PUNCH_INTERVAL_MS = 250;

const peerId = process.argv[2];
const natType = process.argv[3];
const otherPeerId = peerId === 'A' ? 'B' : 'A';

if (!peerId || !natType) {
  console.error('Usage: node peer.js <A|B> <nat-type>');
  process.exit(1);
}

const tag = `[peer ${peerId}]`;
const log = (...args) => console.log(tag, ...args);

const nat = new NatDevice(natType);
log(`starting. configured NAT type = ${natType}`);

nat.on('dropped', ({ reason, from, natType: t }) => {
  log(`(nat) dropped inbound packet from ${from.address}:${from.port} — ${reason} (${t})`);
});

let tcp;
let buffer = '';
let resolveEndpointResponse = null;
let resolvePeerInfo = null;

function sendTcp(obj) {
  tcp.write(JSON.stringify(obj) + '\n');
}

function connectControlChannel() {
  return new Promise((resolve) => {
    tcp = net.connect(CONTROL_PORT, SERVER_IP, () => {
      sendTcp({ type: 'register', peerId });
    });
    tcp.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'registered') resolve();
        else if (msg.type === 'peer-info' && resolvePeerInfo) resolvePeerInfo(msg);
        else if (msg.type === 'relay-data') onRelayData(msg);
      }
    });
  });
}

let relayHandler = null;
function onRelayData(msg) {
  if (relayHandler) relayHandler(msg.payload);
}

// ---- Step 1: NAT class self-detection via dual STUN probes -------------
async function detectNatClass() {
  const responses = {};
  const waiters = {};

  const onMessage = (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'probe-response') {
      responses[msg.probePort] = msg;
      if (waiters[msg.probePort]) waiters[msg.probePort]();
    }
  };
  nat.on('message', onMessage);

  const probe = (port) => new Promise(async (resolve) => {
    waiters[port] = resolve;
    const payload = Buffer.from(JSON.stringify({ type: 'probe', peerId }));
    for (let i = 0; i < 3 && !responses[port]; i++) {
      await nat.send(SERVER_IP, port, payload);
      await sleep(200);
    }
  });

  await Promise.all([probe(PROBE_PORT_1), probe(PROBE_PORT_2)]);
  nat.off('message', onMessage);

  const r1 = responses[PROBE_PORT_1];
  const r2 = responses[PROBE_PORT_2];
  if (!r1 || !r2) throw new Error('STUN probing failed — no response from server');

  const natClass = r1.observedPort === r2.observedPort ? 'cone' : 'symmetric';
  log(`STUN probe results: via :${PROBE_PORT_1} -> ${r1.observedIp}:${r1.observedPort}, ` +
      `via :${PROBE_PORT_2} -> ${r2.observedIp}:${r2.observedPort}`);
  log(`self-detected NAT class = ${natClass} (independent of configured type)`);

  return { natClass, endpoint: { ip: r1.observedIp, port: r1.observedPort } };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Step 2: exchange endpoints via signaling ---------------------------
function exchangeEndpoints(endpoint, natClass) {
  return new Promise((resolve) => {
    resolvePeerInfo = resolve;
    sendTcp({ type: 'endpoint', endpoint, natClass });
  });
}

// ---- Step 3: adaptive hole punch, with relay fallback -------------------
async function connectToPeer(peerInfo) {
  const { endpoint, natClass: theirClass } = peerInfo;
  log(`peer ${otherPeerId} reports endpoint ${endpoint.ip}:${endpoint.port}, class=${theirClass}`);

  const bothCone = theirClass === 'cone'; // our own class is logged separately
  log(`attempting direct UDP hole punch to ${endpoint.ip}:${endpoint.port} ` +
      `(strategy: ${bothCone ? 'simultaneous-open, both cone-friendly' : 'best-effort, symmetric NAT involved'})`);

  let punchSucceeded = false;
  let punchAckSeen = false;

  const onMessage = (data, rinfo) => {
    if (rinfo.address !== endpoint.ip || rinfo.port !== endpoint.port) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'punch' || msg.type === 'punch-ack') {
      if (!punchSucceeded) log(`received ${msg.type} from peer directly — hole punch succeeded!`);
      punchSucceeded = true;
      if (msg.type === 'punch') {
        // reply so the other side also sees an ack
        nat.send(endpoint.ip, endpoint.port, JSON.stringify({ type: 'punch-ack' })).catch(() => {});
      } else {
        punchAckSeen = true;
      }
    }
  };
  nat.on('message', onMessage);

  const punchPayload = Buffer.from(JSON.stringify({ type: 'punch' }));
  const deadline = Date.now() + PUNCH_TIMEOUT_MS;
  while (Date.now() < deadline && !punchSucceeded) {
    await nat.send(endpoint.ip, endpoint.port, punchPayload);
    await sleep(PUNCH_INTERVAL_MS);
  }
  // give one extra beat for a final ack to arrive
  await sleep(PUNCH_INTERVAL_MS);
  nat.off('message', onMessage);

  if (punchSucceeded) {
    return { mode: 'direct', endpoint };
  }
  log(`no direct packet from peer within ${PUNCH_TIMEOUT_MS}ms — falling back to relay via server`);
  return { mode: 'relay', endpoint };
}

// ---- Step 4: demo message exchange over whichever path won --------------
async function runDemoExchange(path) {
  const messages = [1, 2, 3].map((n) => `hello-${n}-from-${peerId}-@${Date.now()}`);

  if (path.mode === 'direct') {
    const received = [];
    const onMessage = (data, rinfo) => {
      if (rinfo.address !== path.endpoint.ip || rinfo.port !== path.endpoint.port) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'demo') {
        received.push(msg.text);
        log(`DIRECT recv <- ${msg.text}`);
      }
    };
    nat.on('message', onMessage);
    for (const text of messages) {
      log(`DIRECT send -> ${text}`);
      await nat.send(path.endpoint.ip, path.endpoint.port, JSON.stringify({ type: 'demo', text }));
      await sleep(150);
    }
    await sleep(500);
    nat.off('message', onMessage);
    log(`demo complete over DIRECT path. received ${received.length}/3 echoes from peer.`);
  } else {
    relayHandler = (payload) => log(`RELAY recv <- ${payload}`);
    for (const text of messages) {
      log(`RELAY send -> ${text}`);
      sendTcp({ type: 'relay', to: otherPeerId, payload: text });
      await sleep(150);
    }
    await sleep(500);
    log('demo complete over RELAY path.');
  }
}

// ---- main -----------------------------------------------------------
(async () => {
  await connectControlChannel();
  log('registered with signaling server');

  const { natClass, endpoint } = await detectNatClass();
  const peerInfo = await exchangeEndpoints(endpoint, natClass);
  const path = await connectToPeer(peerInfo);

  log(`=== FINAL PATH: ${path.mode.toUpperCase()} ===`);
  await runDemoExchange(path);

  nat.close();
  tcp.end();
  setTimeout(() => process.exit(0), 200);
})().catch((err) => {
  console.error(tag, 'fatal error:', err);
  process.exit(1);
});
