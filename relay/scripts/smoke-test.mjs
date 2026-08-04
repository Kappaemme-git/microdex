import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  createRemoteRelay,
  relaySocketUrl,
} from '../../bridge/lib/remote-relay.mjs';

const TEST_TOKEN = 'stable-relay-phone-token';
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-live-relay-'));
const server = http.createServer((request, response) => {
  const authorized = request.headers['x-microdex-token'] === TEST_TOKEN;
  if (!authorized) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Invalid bridge access code.' }));
    return;
  }
  if (request.url === '/api/remote/state') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ online: true, selectedThreadId: 'relay-smoke' }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ ok: true, method: request.method, path: request.url }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const relay = createRemoteRelay({ port, stateDir, accessToken: TEST_TOKEN });

try {
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Stable relay did not connect.')), 15_000);
    relay.subscribe((state) => {
      if (!state.ready) return;
      clearTimeout(timeout);
      resolve(state);
    });
  });
  relay.start();
  const state = await ready;

  const response = await fetch(`${state.url}/api/smoke`, {
    headers: { 'X-Microdex-Token': TEST_TOKEN },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, method: 'GET', path: '/api/smoke' });

  const events = new WebSocket(relaySocketUrl(state.url, 'api/remote/events'));
  const messages = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay event authentication timed out.')), 10_000);
    events.on('open', () => events.send(JSON.stringify({ type: 'auth', token: TEST_TOKEN })));
    events.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
      if (messages.some((message) => message.type === 'state')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    events.on('error', reject);
  });
  assert.ok(messages.some((message) => message.type === 'ready'));
  assert.ok(messages.some(
    (message) => message.type === 'state' && message.state?.selectedThreadId === 'relay-smoke',
  ));
  events.close();
  console.log(`Stable relay smoke test passed at ${state.url}`);
} finally {
  relay.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
