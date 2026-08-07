import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseDeviceRoute, safeForwardHeaders } from '../src/index.js';

const relaySource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const wranglerConfig = JSON.parse(await readFile(
  new URL('../wrangler.jsonc', import.meta.url),
  'utf8',
));

test('production request logging is disabled', () => {
  assert.equal(wranglerConfig.observability.enabled, false);
  assert.equal('head_sampling_rate' in wranglerConfig.observability, false);
});

test('stable relay routes isolate each Mac by a high-entropy device id', () => {
  assert.deepEqual(
    parseDeviceRoute('https://relay.example/v1/devices/abcdefghijklmnopqrstuv/api/status'),
    {
      deviceId: 'abcdefghijklmnopqrstuv',
      basePath: '/v1/devices/abcdefghijklmnopqrstuv',
      roomPath: '/api/status',
    },
  );
  assert.equal(parseDeviceRoute('https://relay.example/v1/devices/short/api/status'), null);
  assert.equal(parseDeviceRoute('https://relay.example/v1/devices/not.valid/api/status'), null);
});

test('encrypted phones receive only targeted ciphertext and QR secrets stay in the fragment', () => {
  assert.match(relaySource, /message\?\.type === 'e2ee-auth'/);
  assert.match(relaySource, /message\.type === 'phone-event'/);
  assert.match(relaySource, /attachment\.authenticated && !attachment\.e2ee/);
  assert.match(relaySource, /location\.hash\.slice\(1\)/);
  assert.doesNotMatch(relaySource, /searchParams\.get\('key'\)/);
});

test('the Mac can authenticate a full relay-room deletion', () => {
  assert.match(relaySource, /url\.pathname === '\/reset'/);
  assert.match(relaySource, /request\.method === 'DELETE'/);
  assert.match(relaySource, /storage\.deleteAll\(\)/);
  assert.match(relaySource, /constantTimeTextEqual\(savedDigest, suppliedDigest\)/);
});

test('inactive relay rooms expire without deleting a connected Mac', () => {
  assert.match(relaySource, /ROOM_RETENTION_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(relaySource, /async alarm\(\)/);
  assert.match(relaySource, /if \(this\.macSocket\(\)\)/);
  assert.match(relaySource, /storage\.setAlarm/);
});

test('the relay forwards only the bridge credential and content type', () => {
  const headers = new Headers({
    Authorization: 'must-not-pass',
    Cookie: 'must-not-pass',
    'Content-Type': 'application/json',
    'X-Microdex-Token': 'phone-secret',
  });
  assert.deepEqual(safeForwardHeaders(headers), {
    'content-type': 'application/json',
    'x-microdex-token': 'phone-secret',
  });
});
