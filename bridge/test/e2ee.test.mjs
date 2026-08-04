import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  E2EEEnvelopeError,
  createE2EEKeyMaterial,
  openE2EE,
  sealE2EE,
} from '../lib/e2ee.mjs';
import {
  E2EEAuthenticationError,
  E2EEClientRegistry,
} from '../lib/e2ee-client-registry.mjs';

test('authenticated encryption hides payloads and binds them to one protocol purpose', () => {
  const material = createE2EEKeyMaterial();
  const envelope = sealE2EE(material, 'request:test', {
    token: 'never-visible-at-the-relay',
    command: 'git.commit',
  });

  assert.doesNotMatch(JSON.stringify(envelope), /never-visible|git\.commit/);
  assert.deepEqual(openE2EE(material, 'request:test', envelope), {
    token: 'never-visible-at-the-relay',
    command: 'git.commit',
  });
  assert.throws(
    () => openE2EE(material, 'event:test', envelope),
    E2EEEnvelopeError,
  );

  const tampered = {
    ...envelope,
    ciphertext: `${envelope.ciphertext.startsWith('A') ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`,
  };
  assert.throws(() => openE2EE(material, 'request:test', tampered), E2EEEnvelopeError);
});

test('encrypted clients persist locally and reject replayed session messages', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-e2ee-test-'));
  const now = 1_800_000_000_000;
  const registry = new E2EEClientRegistry({ stateDir, now: () => now });
  const material = createE2EEKeyMaterial();

  try {
    await registry.addClient(material);
    const registryPath = path.join(stateDir, 'e2ee-clients.json');
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(registryPath, 'utf8'), /bridge-access-token/);

    const sessionRequestId = 'session_request_1234567890';
    const session = await registry.createSession(
      sealE2EE(material, 'session', {
        requestId: sessionRequestId,
        issuedAt: now,
        token: 'bridge-access-token',
      }),
      (token) => token === 'bridge-access-token',
    );
    const sessionPayload = openE2EE(
      material,
      `session-response:${sessionRequestId}`,
      session.envelope,
    );
    assert.equal(sessionPayload.sessionId, session.sessionId);

    const requestEnvelope = {
      ...sealE2EE(material, `request:${session.sessionId}`, {
        requestId: 'command_request_1234567890',
        issuedAt: now,
        method: 'POST',
        path: '/api/actions/fast',
        body: { enabled: true },
      }),
      sessionId: session.sessionId,
    };
    const context = await registry.openSessionMessage(requestEnvelope, 'request');
    assert.equal(context.payload.path, '/api/actions/fast');
    await assert.rejects(
      registry.openSessionMessage(requestEnvelope, 'request'),
      E2EEAuthenticationError,
    );

    const response = registry.sealResponse(context, { status: 200, body: '{"ok":true}' });
    assert.deepEqual(
      openE2EE(
        material,
        `response:${session.sessionId}:${context.requestId}`,
        response,
      ),
      { status: 200, body: '{"ok":true}' },
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
