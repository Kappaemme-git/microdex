import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeviceRoute, safeForwardHeaders } from '../src/index.js';

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
