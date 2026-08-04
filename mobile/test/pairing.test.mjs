import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPairingHttpUrl,
  buildPairingUrl,
  normalizeBridgeUrl,
  parsePairingUrl,
} from '../lib/pairing.ts';

const controllerSource = await readFile(
  new URL('../app/index.tsx', import.meta.url),
  'utf8',
);
const bridgeSource = await readFile(
  new URL('../../bridge/server.mjs', import.meta.url),
  'utf8',
);
const bridgeClientSource = await readFile(
  new URL('../lib/bridge.ts', import.meta.url),
  'utf8',
);
const layoutSource = await readFile(
  new URL('../app/_layout.tsx', import.meta.url),
  'utf8',
);
const fontsSource = await readFile(
  new URL('../lib/fonts.ts', import.meta.url),
  'utf8',
);

test('pairing URLs round-trip without changing credentials', () => {
  const credentials = {
    bridgeUrl: 'http://192.168.1.17:3210',
    token: 'PRIVATE-CODE',
  };
  assert.deepEqual(parsePairingUrl(buildPairingUrl(credentials)), credentials);
  assert.deepEqual(parsePairingUrl(buildPairingHttpUrl(credentials)), credentials);
});

test('one-time pairing QR codes are parsed without exposing a persistent token', () => {
  assert.deepEqual(
    parsePairingUrl(
      'https://microdex-relay.microdex-cli.workers.dev/v1/devices/abcdefghijklmnopqrstuv/pair?code=STABLE-CODE',
    ),
    {
      bridgeUrl:
        'https://microdex-relay.microdex-cli.workers.dev/v1/devices/abcdefghijklmnopqrstuv',
      code: 'STABLE-CODE',
    },
  );
  assert.deepEqual(
    parsePairingUrl('https://fresh-microdex.trycloudflare.com/pair?code=REMOTE-CODE'),
    {
      bridgeUrl: 'https://fresh-microdex.trycloudflare.com',
      code: 'REMOTE-CODE',
    },
  );
  assert.deepEqual(
    parsePairingUrl('http://192.168.1.17:3210/pair?code=ONE-TIME-CODE'),
    {
      bridgeUrl: 'http://192.168.1.17:3210',
      code: 'ONE-TIME-CODE',
    },
  );
  assert.deepEqual(
    parsePairingUrl(
      'microdex://pair?url=http%3A%2F%2F192.168.1.17%3A3210&code=ONE-TIME-CODE',
    ),
    {
      bridgeUrl: 'http://192.168.1.17:3210',
      code: 'ONE-TIME-CODE',
    },
  );
});

test('bridge addresses are normalized and unsafe URL shapes are rejected', () => {
  assert.equal(normalizeBridgeUrl(' http://192.168.1.17:3210/ '), 'http://192.168.1.17:3210');
  assert.equal(
    normalizeBridgeUrl('https://fresh-microdex.trycloudflare.com/'),
    'https://fresh-microdex.trycloudflare.com',
  );
  assert.equal(
    normalizeBridgeUrl(
      'https://microdex-relay.microdex-cli.workers.dev/v1/devices/abcdefghijklmnopqrstuv/',
    ),
    'https://microdex-relay.microdex-cli.workers.dev/v1/devices/abcdefghijklmnopqrstuv',
  );
  assert.throws(() => normalizeBridgeUrl('ftp://192.168.1.17/file'));
  assert.throws(() => normalizeBridgeUrl('http://user:pass@192.168.1.17:3210'));
  assert.throws(() => normalizeBridgeUrl('http://public-bridge.example.com'));
  assert.throws(() => normalizeBridgeUrl('https://public-bridge.example.com/unexpected'));
  assert.throws(() => normalizeBridgeUrl('https://relay.example/v1/devices/short'));
});

test('foreign and incomplete QR codes are rejected', () => {
  assert.throws(() => parsePairingUrl('https://example.com'));
  assert.throws(() => parsePairingUrl('microdex://pair?url=http://192.168.1.17:3210'));
  assert.throws(() => parsePairingUrl('http://192.168.1.17:3210/pair'));
});

test('the phone supports QR pairing and automatic network reconnection', () => {
  assert.match(controllerSource, /CameraView/);
  assert.match(controllerSource, /parsePairingUrl/);
  assert.match(controllerSource, /claimPairingPayload/);
  assert.match(
    controllerSource,
    /setSettingsVisible\(false\);[\s\S]*setTimeout\(\(\) => setScannerVisible\(true\)/,
  );
  assert.match(controllerSource, /Network\.useNetworkState\(\)/);
  assert.match(controllerSource, /AppState\.addEventListener/);
  assert.match(controllerSource, /reconnectAttempt/);
  assert.match(bridgeClientSource, /\$\{basePath\}\/api\/remote\/events/);
  assert.match(bridgeClientSource, /payload\.code === 'MAC_OFFLINE'/);
});

test('the controller is gated until a Mac is paired and online', () => {
  assert.match(controllerSource, /!status \? \(/);
  assert.match(controllerSource, /from your phone/);
  assert.match(controllerSource, /Control Codex/);
  assert.match(controllerSource, /gateCommandRow/);
  assert.match(controllerSource, /Fonts\.monoMedium/);
  assert.match(layoutSource, /useFonts\(fontAssets\)/);
  assert.match(fontsSource, /IBMPlexMono_500Medium/);
  assert.match(controllerSource, /Mac unavailable/);
  assert.match(controllerSource, /Retry connection/);
  assert.match(controllerSource, /Pair another Mac/);
  assert.ok((controllerSource.match(/Forget this Mac/g)?.length ?? 0) >= 2);
  assert.match(controllerSource, /deleteStoredValue\(STORAGE_TOKEN\)/);
  assert.match(controllerSource, /npx microdex-cli@latest setup/);
  assert.match(controllerSource, /setCommandCopied\(true\)/);
  assert.match(controllerSource, /commandCopied \? 'check' : 'copy'/);
  assert.doesNotMatch(controllerSource, /npx microdex-cli@latest up/);
});

test('the desktop bridge displays a Microdex pairing QR', () => {
  assert.match(bridgeSource, /pathname === '\/pair'/);
  assert.match(bridgeSource, /printQr\(pairingUrl, qrcode\)/);
  assert.match(bridgeSource, /pairingUrl\.searchParams\.set\('code', pairingSession\.code\)/);
  assert.match(bridgeSource, /transport: remoteTunnelState\.transport/);
  assert.doesNotMatch(bridgeSource, /pairingHttpUrl\.searchParams\.set\('token'/);
});

test('the browser pairing deep link resolves to an existing Expo Router screen', async () => {
  const target = bridgeSource.match(/const deepLink = new URL\('([^']+)'\)/)?.[1];
  assert.ok(target, 'the bridge must expose an app deep link');

  const parsed = new URL(target);
  const routeName = (
    parsed.pathname.replace(/^\/+|\/+$/g, '') ||
    parsed.hostname ||
    'index'
  ).toLowerCase();
  const routeUrl = new URL(`../app/${routeName}.tsx`, import.meta.url);

  await assert.doesNotReject(
    access(routeUrl),
    `${target} currently opens Expo Router route /${routeName}, but that screen does not exist`,
  );
});

test('a recognized QR closes the scanner before the network claim can fail', () => {
  const start = controllerSource.indexOf('const acceptPairingCode');
  const end = controllerSource.indexOf('const openPairingScanner', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = controllerSource.slice(start, end);
  const parsed = handler.indexOf('parsePairingUrl(value)');
  const scannerClosed = handler.indexOf('setScannerVisible(false)');
  const networkClaim = handler.indexOf('claimPairingPayload(payload)');

  assert.ok(parsed >= 0 && scannerClosed > parsed);
  assert.ok(
    scannerClosed < networkClaim,
    'the camera remains open after a valid scan and repeatedly scans the same unreachable QR',
  );
});
