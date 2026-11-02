'use strict';
/**
 * Signaling / rendezvous server.
 *
 * - TCP control channel (CONTROL_PORT): peers register, report their
 *   STUN-observed endpoint + detected NAT class, and (if punching fails)
 *   relay small messages through the server as a fallback path.
 * - Two UDP "STUN" ports (PROBE_PORT_1, PROBE_PORT_2): a peer sends a probe
 *   from its NatDevice to each; the server echoes back the (ip, port) it
 *   observed the packet arrive from. Comparing the two tells the peer
 *   whether it's behind a cone-type NAT (same port both times) or a
 *   symmetric NAT (different port per destination).
 */

const net = require('net');
const dgram = require('dgram');

const CONTROL_PORT = 6000;
const PROBE_PORT_1 = 7001;
const PROBE_PORT_2 = 7002;

const log = (...args) => console.log('[server]', ...args);

// ---- UDP STUN-like probe responders -------------------------------------
function startProbeSocket(port) {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (data, rinfo) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type !== 'probe') return;
    const reply = Buffer.from(JSON.stringify({
      type: 'probe-response',
      probePort: port,
      observedIp: rinfo.address,
      observedPort: rinfo.port,
    }));
    sock.send(reply, rinfo.port, rinfo.address);
    log(`probe on :${port} from ${rinfo.address}:${rinfo.port} (peer=${msg.peerId})`);
  });
  sock.bind(port, '127.0.0.1', () => log(`UDP probe socket listening on ${port}`));
  return sock;
}

startProbeSocket(PROBE_PORT_1);
startProbeSocket(PROBE_PORT_2);

// ---- TCP control channel ---------------------------------------------
const peers = new Map(); // peerId -> { socket, buffer, endpoint, natClass }

const tcpServer = net.createServer((socket) => {
  let peerId = null;
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleMessage(msg);
    }
  });

  function send(obj) {
    socket.write(JSON.stringify(obj) + '\n');
  }

  function handleMessage(msg) {
    if (msg.type === 'register') {
      peerId = msg.peerId;
      peers.set(peerId, { socket, send, endpoint: null, natClass: null });
      log(`peer registered: ${peerId}`);
      send({ type: 'registered', peerId });
      return;
    }

    if (msg.type === 'endpoint') {
      const p = peers.get(peerId);
      if (!p) return;
      p.endpoint = msg.endpoint;
      p.natClass = msg.natClass;
      log(`peer ${peerId} reports endpoint ${msg.endpoint.ip}:${msg.endpoint.port} class=${msg.natClass}`);
      maybePair();
      return;
    }

    if (msg.type === 'relay') {
      const target = peers.get(msg.to);
      if (target) {
        target.send({ type: 'relay-data', from: peerId, payload: msg.payload });
      }
      return;
    }
  }

  socket.on('close', () => {
    if (peerId) {
      peers.delete(peerId);
      log(`peer disconnected: ${peerId}`);
    }
  });

  socket.on('error', () => {});
});

function maybePair() {
  const ready = [...peers.entries()].filter(([, p]) => p.endpoint);
  if (ready.length < 2) return;
  // Broadcast each peer's endpoint/natClass to every other ready peer.
  for (const [id, p] of ready) {
    const others = ready.filter(([oid]) => oid !== id);
    for (const [oid, op] of others) {
      p.send({
        type: 'peer-info',
        peerId: oid,
        endpoint: op.endpoint,
        natClass: op.natClass,
      });
    }
  }
}

tcpServer.listen(CONTROL_PORT, '127.0.0.1', () => {
  log(`TCP control channel listening on ${CONTROL_PORT}`);
  log(`Ready. Probe ports: ${PROBE_PORT_1}, ${PROBE_PORT_2}`);
});

module.exports = { CONTROL_PORT, PROBE_PORT_1, PROBE_PORT_2 };
