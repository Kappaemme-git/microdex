import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';

import { E2EEClientRegistry } from '../lib/e2ee-client-registry.mjs';
import { createE2EEKeyMaterial, openE2EE, sealE2EE } from '../lib/e2ee.mjs';
import { attachRemoteEvents } from '../lib/remote-events.mjs';

function messageQueue(socket) {
  const buffered = [];
  const waiting = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else buffered.push(message);
  });
  return {
    next() {
      if (buffered.length) return Promise.resolve(buffered.shift());
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for WebSocket message.')),
          2_000,
        );
        waiting.push((message) => {
          clearTimeout(timeout);
          resolve(message);
        });
      });
    },
  };
}

test('authenticated phones receive current and pushed Codex state', async () => {
  const server = http.createServer();
  let listener = null;
  let version = 1;
  const codex = {
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    async state() {
      return { online: true, version };
    },
  };
  const events = attachRemoteEvents({
    server,
    codex,
    authenticate: (token) => token === 'secret',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote/events`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const messages = messageQueue(socket);

  socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
  assert.deepEqual(await messages.next(), { type: 'ready' });
  assert.deepEqual(await messages.next(), {
    type: 'state',
    state: { online: true, version: 1 },
  });

  version = 2;
  listener('turn/started');
  assert.deepEqual(await messages.next(), {
    type: 'state',
    state: { online: true, version: 2 },
  });

  socket.close();
  events.close();
  await new Promise((resolve) => server.close(resolve));
});

test('phones with an invalid token cannot receive state', async () => {
  const server = http.createServer();
  const codex = {
    subscribe() {
      return () => {};
    },
    async state() {
      throw new Error('State must not be read before authentication.');
    },
  };
  const events = attachRemoteEvents({
    server,
    codex,
    authenticate: () => false,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote/events`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
  const closeCode = await new Promise((resolve) => socket.once('close', resolve));
  assert.equal(closeCode, 4401);

  events.close();
  await new Promise((resolve) => server.close(resolve));
});

test('direct phone events stay encrypted between the phone and Mac', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-events-e2ee-'));
  const now = Date.now();
  const material = createE2EEKeyMaterial();
  const clients = new E2EEClientRegistry({ stateDir, now: () => now });
  await clients.addClient(material);
  const sessionRequestId = 'events_session_request_12345';
  const session = await clients.createSession(
    sealE2EE(material, 'session', {
      requestId: sessionRequestId,
      issuedAt: now,
      token: 'secret',
    }),
    (token) => token === 'secret',
  );
  const server = http.createServer();
  const events = attachRemoteEvents({
    server,
    codex: {
      subscribe() { return () => {}; },
      async state() { return { online: true, privateTask: 'never plaintext' }; },
    },
    authenticate: () => false,
    e2eeClients: clients,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote/events`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const messages = messageQueue(socket);

  try {
    const authEnvelope = {
      ...sealE2EE(material, `events-auth:${session.sessionId}`, {
        type: 'events-auth',
        requestId: 'events_auth_request_12345',
        issuedAt: now,
      }),
      sessionId: session.sessionId,
    };
    socket.send(JSON.stringify({ type: 'e2ee-auth', envelope: authEnvelope }));
    assert.deepEqual(await messages.next(), { type: 'ready', e2ee: true });
    const encrypted = await messages.next();
    assert.equal(encrypted.type, 'e2ee');
    assert.doesNotMatch(JSON.stringify(encrypted), /never plaintext/);
    const event = openE2EE(material, `event:${session.sessionId}`, encrypted.envelope);
    assert.deepEqual(event.payload, {
      type: 'state',
      state: { online: true, privateTask: 'never plaintext' },
    });
  } finally {
    socket.close();
    events.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(stateDir, { recursive: true, force: true });
  }
});

test('visible desktop activity is pushed even without an App Server event', async () => {
  const server = http.createServer();
  let working = false;
  const codex = {
    subscribe() {
      return () => {};
    },
    async state() {
      return { online: true, working };
    },
  };
  const events = attachRemoteEvents({
    server,
    codex,
    authenticate: (token) => token === 'secret',
    pollIntervalMs: 20,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/remote/events`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const messages = messageQueue(socket);

  socket.send(JSON.stringify({ type: 'auth', token: 'secret' }));
  assert.deepEqual(await messages.next(), { type: 'ready' });
  assert.deepEqual(await messages.next(), {
    type: 'state',
    state: { online: true, working: false },
  });

  working = true;
  assert.deepEqual(await messages.next(), {
    type: 'state',
    state: { online: true, working: true },
  });

  socket.close();
  events.close();
  await new Promise((resolve) => server.close(resolve));
});
