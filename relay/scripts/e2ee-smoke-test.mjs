import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocket } from 'ws';

import {
  openE2EE,
  sealE2EE,
  toBase64Url,
} from '../../bridge/lib/e2ee.mjs';
import { deletePersistentRelayRoom } from '../../bridge/lib/remote-relay.mjs';

const port = Number(process.env.MICRODEX_SMOKE_PORT || 3323);
let expectedToken = process.env.MICRODEX_SMOKE_TOKEN;
let temporaryStateDir = null;
let temporaryBridge = null;
let smokeCompleted = false;

async function waitForTemporaryBridge() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (temporaryBridge?.exitCode !== null) {
      throw new Error(`The temporary bridge exited with code ${temporaryBridge.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const health = await response.json();
      if (response.ok && health.remoteAccess?.ready) return;
    } catch {
      // The local listener or outbound relay is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The temporary encrypted bridge did not become ready.');
}

async function startTemporaryBridge() {
  if (expectedToken) return;
  expectedToken = randomBytes(32).toString('base64url');
  temporaryStateDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-e2ee-smoke-'));
  const serverPath = fileURLToPath(new URL('../../bridge/server.mjs', import.meta.url));
  temporaryBridge = spawn(process.execPath, [serverPath], {
    stdio: 'ignore',
    env: {
      ...process.env,
      MICRODEX_TOKEN: expectedToken,
      MICRODEX_PORT: String(port),
      MICRODEX_HOME: temporaryStateDir,
      MICRODEX_QUICK_TUNNEL: '0',
    },
  });
  await waitForTemporaryBridge();
}

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

try {
await startTemporaryBridge();

const details = await post(
  `http://127.0.0.1:${port}/api/pair/new`,
  {},
  { 'X-Microdex-Token': expectedToken },
);
const pairingUrl = new URL(details.pairingUrl);
const fragment = new URLSearchParams(pairingUrl.hash.slice(1));
const material = {
  keyId: fragment.get('keyId'),
  key: fragment.get('key'),
};
assert.equal(fragment.get('e2ee'), '1');
const bridgeUrl = `${pairingUrl.origin}${pairingUrl.pathname.replace(/\/pair$/, '')}`;

const pairRequestId = toBase64Url(randomBytes(18));
const pairEnvelope = sealE2EE(material, 'pair', {
  requestId: pairRequestId,
  issuedAt: Date.now(),
  code: pairingUrl.searchParams.get('code'),
});
assert.doesNotMatch(JSON.stringify(pairEnvelope), new RegExp(expectedToken));
const paired = await post(`${bridgeUrl}/api/e2ee/pair`, { envelope: pairEnvelope });
const credentials = openE2EE(
  material,
  `pair-response:${pairRequestId}`,
  paired.envelope,
);
assert.equal(credentials.token, expectedToken);

const sessionRequestId = toBase64Url(randomBytes(18));
const sessionEnvelope = sealE2EE(material, 'session', {
  requestId: sessionRequestId,
  issuedAt: Date.now(),
  token: credentials.token,
});
assert.doesNotMatch(JSON.stringify(sessionEnvelope), new RegExp(expectedToken));
const opened = await post(`${bridgeUrl}/api/e2ee/session`, { envelope: sessionEnvelope });
const session = openE2EE(
  material,
  `session-response:${sessionRequestId}`,
  opened.envelope,
);

const statusRequestId = toBase64Url(randomBytes(18));
const requestEnvelope = {
  ...sealE2EE(material, `request:${session.sessionId}`, {
    requestId: statusRequestId,
    issuedAt: Date.now(),
    method: 'GET',
    path: '/api/status',
  }),
  sessionId: session.sessionId,
};
assert.doesNotMatch(JSON.stringify(requestEnvelope), /api\/status/);
const encryptedStatus = await post(`${bridgeUrl}/api/e2ee`, { envelope: requestEnvelope });
const statusResponse = openE2EE(
  material,
  `response:${session.sessionId}:${statusRequestId}`,
  encryptedStatus.envelope,
);
const status = JSON.parse(statusResponse.body);
assert.equal(statusResponse.status, 200);
assert.equal(status.connection.transport, 'relay');

const eventsUrl = new URL(`${bridgeUrl}/api/remote/events`);
eventsUrl.protocol = 'wss:';
const socket = new WebSocket(eventsUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Encrypted event smoke test timed out.')), 10_000);
  socket.on('open', () => {
    const requestId = toBase64Url(randomBytes(18));
    const envelope = {
      ...sealE2EE(material, `events-auth:${session.sessionId}`, {
        type: 'events-auth',
        requestId,
        issuedAt: Date.now(),
      }),
      sessionId: session.sessionId,
    };
    socket.send(JSON.stringify({ type: 'e2ee-auth', envelope }));
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'e2ee') return;
    const event = openE2EE(material, `event:${session.sessionId}`, message.envelope);
    if (event.payload?.type !== 'state') return;
    clearTimeout(timer);
    socket.close();
    resolve();
  });
  socket.on('error', reject);
});

smokeCompleted = true;
console.log(`End-to-end encrypted relay smoke test passed for ${bridgeUrl}`);
} finally {
  if (temporaryBridge && temporaryBridge.exitCode === null) {
    temporaryBridge.kill('SIGTERM');
    await new Promise((resolve) => temporaryBridge.once('exit', resolve));
  }
  if (temporaryStateDir) {
    const removed = await deletePersistentRelayRoom({ stateDir: temporaryStateDir })
      .catch((error) => {
        if (smokeCompleted) throw error;
        return false;
      });
    if (smokeCompleted) assert.equal(removed, true, 'Temporary relay room was not deleted.');
    await rm(temporaryStateDir, { recursive: true, force: true });
  }
}
