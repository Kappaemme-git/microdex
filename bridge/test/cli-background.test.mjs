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
const packageJson = JSON.parse(await readFile(
  new URL('../../package.json', import.meta.url),
  'utf8',
));

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

test('App Review pairing is explicit, long enough for review, and still single-use', () => {
  assert.match(cliSource, /case 'review-pair'/);
  assert.match(cliSource, /showPairingQr\(\{ review: true \}\)/);
  assert.match(cliSource, /payload\.mode !== 'review'/);
  assert.match(serverSource, /body\.mode === 'review'/);
  assert.match(serverSource, /REVIEW_PAIRING_TTL_MS/);
  assert.match(serverSource, /singleUse: true/);
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

test('the CLI exposes lifecycle and emergency revocation commands', () => {
  for (const command of ['status', 'restart', 'revoke-all', 'uninstall']) {
    assert.match(cliSource, new RegExp(`case '${command}'`));
  }
  assert.match(cliSource, /launchctl/);
  assert.match(cliSource, /bootout/);
  assert.match(cliSource, /kickstart/);
  assert.match(cliSource, /rm\(e2eeClientsPath/);
  assert.match(cliSource, /rm\(tokenPath/);
});

test('the public CLI contains no native hardware impersonation mode', () => {
  assert.doesNotMatch(cliSource, /case 'native'|microdex native|NODE_OPTIONS: `--require=/);
  assert.doesNotMatch(serverSource, /nativeShim|applyNative/);
  assert.equal(packageJson.version, '0.1.19');
  assert.equal(
    packageJson.files.some((entry) => /native-shim|experiments/.test(entry)),
    false,
  );
});
