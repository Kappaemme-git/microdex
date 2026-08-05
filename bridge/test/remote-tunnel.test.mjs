import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  cloudflaredRelease,
  createRemoteTunnel,
  extractQuickTunnelUrl,
  extractTunnelDiagnostic,
} from '../lib/remote-tunnel.mjs';

test('the bundled tunnel download is pinned for both supported Mac architectures', () => {
  const arm = cloudflaredRelease('arm64');
  const intel = cloudflaredRelease('x64');

  assert.equal(arm.version, '2026.7.3');
  assert.match(arm.url, /cloudflare\/cloudflared\/releases\/download\/2026\.7\.3/);
  assert.equal(arm.sha256.length, 64);
  assert.equal(intel.sha256.length, 64);
  assert.throws(() => cloudflaredRelease('unsupported'));
});

test('only HTTPS TryCloudflare hostnames are accepted from tunnel output', () => {
  assert.equal(
    extractQuickTunnelUrl('Visit HTTPS://FRESH-MICRODEX.trycloudflare.com now'),
    'https://fresh-microdex.trycloudflare.com',
  );
  assert.equal(extractQuickTunnelUrl('http://fresh-microdex.trycloudflare.com'), null);
  assert.equal(extractQuickTunnelUrl('https://trycloudflare.com.evil.example'), null);
  assert.equal(
    extractTunnelDiagnostic('2026-08-04T10:00:00Z ERR Quick Tunnel request failed status=429'),
    'Quick Tunnel request failed status=429',
  );
  assert.equal(
    extractTunnelDiagnostic('2026-08-04T10:00:00Z ERR Quick Tunnel failed error code: 1015'),
    'Cloudflare is temporarily rate limiting new beta tunnels. Microdex will retry automatically.',
  );
});

test('the tunnel waits for edge registration before its public health check', async () => {
  const previousBinary = process.env.MICRODEX_CLOUDFLARED_BIN;
  process.env.MICRODEX_CLOUDFLARED_BIN = process.execPath;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {
    child.exitCode = 0;
    child.emit('close', 0);
  };
  let spawned = null;
  let dnsChecks = 0;
  let healthChecks = 0;
  const tunnel = createRemoteTunnel({
    port: 3210,
    stateDir: '/tmp/microdex-remote-test',
    fetchImpl: async (url) => {
      healthChecks += 1;
      return {
        ok: url === 'https://fresh-microdex.trycloudflare.com/health',
        async json() { return { ok: true }; },
      };
    },
    resolveImpl: async (hostname) => {
      dnsChecks += 1;
      assert.equal(hostname, 'fresh-microdex.trycloudflare.com');
      return ['203.0.113.1'];
    },
    initialVerifyDelayMs: 0,
    spawnImpl(binary, args, options) {
      spawned = { binary, args, options };
      queueMicrotask(() => {
        child.stderr.write('https://fresh-microdex.trycloudflare.com');
      });
      return child;
    },
  });

  try {
    const hostnameSeen = new Promise((resolve) => {
      tunnel.subscribe((state) => {
        if (state.status === 'verifying') resolve(state);
      });
    });
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel did not become ready')), 2_000);
      tunnel.subscribe((state) => {
        if (!state.ready) return;
        clearTimeout(timeout);
        resolve(state);
      });
    });
    tunnel.start();
    await hostnameSeen;
    assert.equal(dnsChecks, 0, 'DNS is not queried before edge registration');
    assert.equal(healthChecks, 0, 'the hostname is not queried before edge registration');
    child.stderr.write('\nRegistered tunnel connection\n');
    assert.deepEqual(await ready, {
      status: 'ready',
      ready: true,
      url: 'https://fresh-microdex.trycloudflare.com',
      error: null,
    });
    assert.equal(dnsChecks, 1);
    assert.equal(healthChecks, 1);
    assert.equal(spawned.binary, process.execPath);
    assert.deepEqual(spawned.args.slice(-2), ['--url', 'http://127.0.0.1:3210']);
    assert.equal(spawned.options.env.HOME, '/tmp/microdex-remote-test');
  } finally {
    tunnel.close();
    if (previousBinary === undefined) delete process.env.MICRODEX_CLOUDFLARED_BIN;
    else process.env.MICRODEX_CLOUDFLARED_BIN = previousBinary;
  }
});

test('Cloudflare 1015 enters cooldown instead of hammering the tunnel API', async () => {
  const previousBinary = process.env.MICRODEX_CLOUDFLARED_BIN;
  process.env.MICRODEX_CLOUDFLARED_BIN = process.execPath;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {};
  const tunnel = createRemoteTunnel({
    port: 3210,
    stateDir: '/tmp/microdex-rate-limit-test',
    spawnImpl() {
      queueMicrotask(() => {
        child.stderr.write('ERR QuickTunnel failed: error code: 1015\n');
        child.exitCode = 1;
        child.emit('close', 1);
      });
      return child;
    },
  });

  try {
    const cooldown = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel did not enter cooldown')), 2_000);
      tunnel.subscribe((state) => {
        if (state.status !== 'cooldown') return;
        clearTimeout(timeout);
        resolve(state);
      });
    });
    tunnel.start();
    assert.deepEqual(await cooldown, {
      status: 'cooldown',
      ready: false,
      url: null,
      error: 'Cloudflare is temporarily rate limiting new beta tunnels. Microdex will retry automatically.',
    });
  } finally {
    tunnel.close();
    if (previousBinary === undefined) delete process.env.MICRODEX_CLOUDFLARED_BIN;
    else process.env.MICRODEX_CLOUDFLARED_BIN = previousBinary;
  }
});
