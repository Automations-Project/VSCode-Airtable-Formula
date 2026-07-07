// Regression: the daemon must NOT crash when its fixed port cannot be bound. The real-world failure
// was `listen EACCES: permission denied 127.0.0.1:8723` — the default port 8723 landing inside a
// Windows reserved/excluded TCP port range → the daemon exited code 1 before writing a lockfile →
// the extension's ensureDaemon polled forever → "Timed out waiting for daemon startup". The fixed-port
// fallback previously only handled EADDRINUSE (busy), so EACCES was fatal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listenAvoidingBlockedPorts } from '../src/daemon/server.js';

// A fake net.Server: `listen(port)` schedules a 'listening' (ok) or 'error' (with .code) event.
// behavior(port) → 'ok' or an errno string. Ephemeral (port 0) binds to 54321 when ok.
function makeFakeServer(behavior) {
  const s = new EventEmitter();
  s._bound = null;
  s.listen = (port /* , host */) => {
    queueMicrotask(() => {
      const verdict = behavior(port);
      if (verdict === 'ok') { s._bound = port === 0 ? 54321 : port; s.emit('listening'); }
      else { const e = new Error(verdict); e.code = verdict; s.emit('error', e); }
    });
  };
  s.address = () => (s._bound == null ? null : { port: s._bound, address: '127.0.0.1', family: 'IPv4' });
  s.close = (cb) => { s._bound = null; if (cb) queueMicrotask(cb); };
  return s;
}

test('fixed port EACCES (Windows excluded range) falls back to an ephemeral port instead of crashing', async () => {
  const server = makeFakeServer((port) => (port === 8723 ? 'EACCES' : 'ok'));
  await listenAvoidingBlockedPorts(server, 8723, '127.0.0.1'); // must NOT throw
  assert.equal(server.address().port, 54321, 'bound to the ephemeral fallback port');
});

test('fixed port EADDRINUSE still falls back (no regression)', async () => {
  const server = makeFakeServer((port) => (port === 8723 ? 'EADDRINUSE' : 'ok'));
  await listenAvoidingBlockedPorts(server, 8723, '127.0.0.1');
  assert.equal(server.address().port, 54321);
});

test('fixed port EADDRNOTAVAIL falls back', async () => {
  const server = makeFakeServer((port) => (port === 8723 ? 'EADDRNOTAVAIL' : 'ok'));
  await listenAvoidingBlockedPorts(server, 8723, '127.0.0.1');
  assert.equal(server.address().port, 54321);
});

test('a bind failure on the ephemeral port (port 0) is fatal, not swallowed', async () => {
  const server = makeFakeServer(() => 'EACCES'); // even ephemeral fails → genuine error
  await assert.rejects(() => listenAvoidingBlockedPorts(server, 0, '127.0.0.1'), /EACCES/);
});

test('an unrelated fixed-port error is NOT swallowed as a fallback', async () => {
  const server = makeFakeServer((port) => (port === 8723 ? 'EPERM' : 'ok'));
  await assert.rejects(() => listenAvoidingBlockedPorts(server, 8723, '127.0.0.1'), /EPERM/);
});
