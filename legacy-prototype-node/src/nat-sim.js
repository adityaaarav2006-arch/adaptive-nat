'use strict';
/**
 * NatDevice simulates the address-mapping and packet-filtering behaviour of a
 * real NAT, using genuine UDP sockets bound on 127.0.0.1. Because this all
 * runs on one machine, every socket lives on "localhost" — but the mapping
 * rules (which external port gets used for which destination) and the
 * filtering rules (which inbound packets get let through) are enforced for
 * real, not just logged. That's what makes the NAT-type detection and
 * hole-punching logic in peer.js meaningful rather than scripted.
 *
 * Supported types:
 *   full-cone            - one external port for all destinations; accepts
 *                           inbound from ANY remote endpoint once a mapping
 *                           exists.
 *   restricted-cone      - one external port for all destinations; accepts
 *                           inbound only from an IP we've already sent to.
 *   port-restricted-cone - one external port for all destinations; accepts
 *                           inbound only from an exact ip:port we've sent to.
 *   symmetric            - a NEW external port is allocated per distinct
 *                           destination; accepts inbound only from the exact
 *                           ip:port that mapping was created for.
 */

const dgram = require('dgram');
const EventEmitter = require('events');

const CONE_TYPES = new Set(['full-cone', 'restricted-cone', 'port-restricted-cone']);
const VALID_TYPES = new Set([...CONE_TYPES, 'symmetric']);

class NatDevice extends EventEmitter {
  constructor(type, { host = '127.0.0.1' } = {}) {
    super();
    if (!VALID_TYPES.has(type)) {
      throw new Error(`Unknown NAT type: ${type}. Valid: ${[...VALID_TYPES].join(', ')}`);
    }
    this.type = type;
    this.host = host;
    this.isCone = CONE_TYPES.has(type);

    // For cone types: single shared socket, created lazily.
    this._coneSocket = null;
    this._coneSocketPromise = null; // guards against concurrent creation races
    this._coneSentTo = new Set(); // 'ip:port' strings we've sent to (for restricted filtering)

    // For symmetric: one socket per destination key 'ip:port'.
    this._symSockets = new Map();
    this._symSocketPromises = new Map(); // guards concurrent creation per destination key

    this._closed = false;
  }

  _key(ip, port) {
    return `${ip}:${port}`;
  }

  _attachListener(sock, destKeyForSymmetric) {
    sock.on('message', (data, rinfo) => {
      if (this._closed) return;
      if (!this._passesFilter(destKeyForSymmetric, rinfo)) {
        this.emit('dropped', { reason: 'nat-filter', from: rinfo, natType: this.type });
        return;
      }
      this.emit('message', data, rinfo, sock.address().port);
    });
  }

  _passesFilter(destKeyForSymmetric, rinfo) {
    if (this.type === 'full-cone') return true;
    if (this.type === 'restricted-cone') {
      for (const key of this._coneSentTo) {
        if (key.split(':')[0] === rinfo.address) return true;
      }
      return false;
    }
    if (this.type === 'port-restricted-cone') {
      return this._coneSentTo.has(this._key(rinfo.address, rinfo.port));
    }
    // symmetric: only the exact destination this socket was created for.
    return destKeyForSymmetric === this._key(rinfo.address, rinfo.port);
  }

  async _getConeSocket() {
    if (this._coneSocket) return this._coneSocket;
    if (this._coneSocketPromise) return this._coneSocketPromise; // join in-flight creation
    this._coneSocketPromise = (async () => {
      const sock = dgram.createSocket('udp4');
      await new Promise((resolve) => sock.bind(0, this.host, resolve));
      this._coneSocket = sock;
      this._attachListener(sock, null);
      return sock;
    })();
    return this._coneSocketPromise;
  }

  async _getSymSocket(destIp, destPort) {
    const key = this._key(destIp, destPort);
    if (this._symSockets.has(key)) return this._symSockets.get(key);
    if (this._symSocketPromises.has(key)) return this._symSocketPromises.get(key); // join in-flight creation
    const creation = (async () => {
      const sock = dgram.createSocket('udp4');
      await new Promise((resolve) => sock.bind(0, this.host, resolve));
      this._symSockets.set(key, sock);
      this._attachListener(sock, key);
      return sock;
    })();
    this._symSocketPromises.set(key, creation);
    return creation;
  }

  /** Send data to destIp:destPort, allocating/reusing the right mapping. */
  async send(destIp, destPort, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (this.isCone) {
      const sock = await this._getConeSocket();
      this._coneSentTo.add(this._key(destIp, destPort));
      return new Promise((resolve, reject) => {
        sock.send(buf, destPort, destIp, (err) => (err ? reject(err) : resolve()));
      });
    }
    // symmetric
    const sock = await this._getSymSocket(destIp, destPort);
    return new Promise((resolve, reject) => {
      sock.send(buf, destPort, destIp, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * The external (mapped) port this device would present to `destIp:destPort`.
   * For cone types this is stable across all destinations (created on first
   * send/probe). For symmetric it is specific to that destination and only
   * exists once we've sent to it at least once.
   */
  externalPortFor(destIp, destPort) {
    if (this.isCone) return this._coneSocket ? this._coneSocket.address().port : null;
    const sock = this._symSockets.get(this._key(destIp, destPort));
    return sock ? sock.address().port : null;
  }

  /** Force-create the mapping toward destIp:destPort without sending app data (used for probing). */
  async ensureMapping(destIp, destPort) {
    if (this.isCone) return this._getConeSocket();
    return this._getSymSocket(destIp, destPort);
  }

  close() {
    this._closed = true;
    if (this._coneSocket) this._coneSocket.close();
    for (const sock of this._symSockets.values()) sock.close();
  }
}

module.exports = { NatDevice, VALID_TYPES };
