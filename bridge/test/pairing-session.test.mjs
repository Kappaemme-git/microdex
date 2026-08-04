import assert from 'node:assert/strict';
import test from 'node:test';

import { PairingSession } from '../lib/pairing-session.mjs';

test('a pairing code can be exchanged for the bridge token exactly once', () => {
  const session = new PairingSession({
    accessToken: 'persistent-device-secret',
    code: 'one-time-code',
    now: 1_000,
    ttlMs: 60_000,
  });

  assert.match(session.encryption.keyId, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(Buffer.from(session.encryption.key, 'base64url').length, 32);

  assert.deepEqual(session.validate('one-time-code', 2_000), { ok: true });
  assert.deepEqual(session.claim('one-time-code', 2_000), {
    ok: true,
    token: 'persistent-device-secret',
  });
  assert.deepEqual(session.claim('one-time-code', 2_001), {
    ok: false,
    reason: 'claimed',
  });
});

test('invalid and expired pairing codes never reveal the bridge token', () => {
  const session = new PairingSession({
    accessToken: 'persistent-device-secret',
    code: 'one-time-code',
    now: 1_000,
    ttlMs: 1_000,
  });

  assert.deepEqual(session.claim('wrong-code', 1_500), {
    ok: false,
    reason: 'invalid',
  });
  assert.deepEqual(session.claim('one-time-code', 2_000), {
    ok: false,
    reason: 'expired',
  });
});
