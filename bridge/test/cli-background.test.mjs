import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cliSource = await readFile(
  new URL('../scripts/microdex.mjs', import.meta.url),
  'utf8',
);
const serverSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);
const tunnelSource = await readFile(
  new URL('../lib/remote-tunnel.mjs', import.meta.url),
  'utf8',
);
const relaySource = await readFile(
  new URL('../lib/remote-relay.mjs', import.meta.url),
  'utf8',
);

test('setup installs an automatic macOS LaunchAgent backed by a stable runtime', () => {
  assert.match(cliSource, /microdex setup/);
  assert.match(cliSource, /Library', 'LaunchAgents/);
  assert.match(cliSource, /<key>RunAtLoad<\/key>/);
  assert.match(cliSource, /<key>KeepAlive<\/key>/);
  assert.match(cliSource, /runtimeCliPath/);
  assert.match(cliSource, /case 'daemon'/);
});

test('a running background bridge can issue a fresh one-time pairing QR', () => {
  assert.match(cliSource, /case 'pair'/);
  assert.match(cliSource, /\/api\/pair\/new/);
  assert.match(serverSource, /url\.pathname === '\/api\/pair\/new'/);
  assert.match(serverSource, /pairingSession = new PairingSession/);
});

test('pairing prefers a persistent relay and keeps Quick Tunnel as a fallback', () => {
  assert.match(serverSource, /createRemoteRelay/);
  assert.match(serverSource, /createRemoteTunnel/);
  assert.match(serverSource, /stableRelayState\.ready/);
  assert.match(serverSource, /remoteTunnelState\.ready \? remoteTunnelState\.url/);
  assert.match(cliSource, /waitForRemotePairingDetails/);
  assert.match(cliSource, /Stable address · ready on Wi-Fi or mobile data/);
  assert.match(relaySource, /relay-device\.json/);
  assert.match(relaySource, /microdex-relay\.microdex-cli\.workers\.dev/);
  assert.match(tunnelSource, /http:\/\/127\.0\.0\.1:\$\{port\}/);
  assert.match(tunnelSource, /trycloudflare\\\.com/);
  assert.doesNotMatch(tunnelSource, /port forwarding|upnp/i);
});

test('the CLI exposes lifecycle commands for the background service', () => {
  for (const command of ['status', 'restart', 'native', 'uninstall']) {
    assert.match(cliSource, new RegExp(`case '${command}'`));
  }
  assert.match(cliSource, /launchctl/);
  assert.match(cliSource, /bootout/);
  assert.match(cliSource, /kickstart/);
});

test('native mode is explicit, reversible, and never modifies the Codex app bundle', () => {
  assert.match(cliSource, /Continue\? \[Y\/n\]/);
  assert.match(cliSource, /NODE_OPTIONS: `--require=/);
  assert.match(cliSource, /case 'native'/);
  assert.match(cliSource, /operation === 'stop'/);
  assert.match(cliSource, /relaunchCodexNormally/);
  assert.doesNotMatch(cliSource, /cp .*ChatGPT\.app|writeFile\(.*ChatGPT\.app/s);
});
