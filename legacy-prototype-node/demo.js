'use strict';
/**
 * Orchestrates one demo run: starts the signaling server, then two peers
 * configured with the NAT types given on the command line, and streams
 * their output with colored prefixes to one terminal — convenient for
 * screen-recording.
 *
 * Usage:
 *   node demo.js <natTypeA> <natTypeB>
 *   e.g. node demo.js full-cone full-cone
 *        node demo.js symmetric symmetric
 *        node demo.js full-cone symmetric
 */

const { spawn } = require('child_process');
const path = require('path');

const [, , typeA = 'full-cone', typeB = 'full-cone'] = process.argv;

const COLORS = { server: '\x1b[36m', A: '\x1b[32m', B: '\x1b[35m', reset: '\x1b[0m' };

function runTagged(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  const color = COLORS[name] || '';
  const prefix = (line) => `${color}${line}${COLORS.reset}`;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        console.log(prefix(buf.slice(0, idx)));
        buf = buf.slice(idx + 1);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  return child;
}

console.log(`\n=== Adaptive NAT Traversal Demo ===`);
console.log(`Peer A NAT type: ${typeA}`);
console.log(`Peer B NAT type: ${typeB}\n`);

const server = runTagged('server', 'node', [path.join('src', 'server.js')]);

setTimeout(() => {
  const peerA = runTagged('A', 'node', [path.join('src', 'peer.js'), 'A', typeA]);
  const peerB = runTagged('B', 'node', [path.join('src', 'peer.js'), 'B', typeB]);

  let remaining = 2;
  const done = () => {
    remaining -= 1;
    if (remaining === 0) {
      setTimeout(() => {
        console.log('\n=== Demo finished ===\n');
        server.kill();
        process.exit(0);
      }, 300);
    }
  };
  peerA.on('exit', done);
  peerB.on('exit', done);
}, 500);
