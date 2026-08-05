import assert from 'node:assert/strict';
import test from 'node:test';

import { DeviceRoom } from '../src/index.js';

test('the relay waits long enough for a successful voice-start response from the Mac', { timeout: 9_000 }, async () => {
  let room;
  const mac = {
    readyState: WebSocket.OPEN,
    send(rawMessage) {
      const message = JSON.parse(rawMessage);
      assert.equal(message.type, 'request');
      assert.equal(message.path, '/api/desktop/action');
      assert.deepEqual(JSON.parse(message.body), { action: 'voice-start' });

      setTimeout(() => {
        room.handleMacMessage({
          type: 'response',
          requestId: message.requestId,
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ voice: { state: 'active', muted: false } }),
        });
      }, 7_000);
    },
  };
  const ctx = {
    getWebSockets(tag) {
      return tag === 'mac' ? [mac] : [];
    },
  };
  room = new DeviceRoom(ctx);

  const response = await room.fetch(new Request('https://device-room.invalid/api/desktop/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'voice-start' }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, { voice: { state: 'active', muted: false } });
});
