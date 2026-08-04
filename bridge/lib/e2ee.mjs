import { randomBytes } from 'node:crypto';

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';

export const E2EE_PROTOCOL_VERSION = 1;
export const E2EE_KEY_BYTES = 32;
export const E2EE_NONCE_BYTES = 24;
export const E2EE_MAX_CIPHERTEXT_BYTES = 256 * 1024;

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class E2EEEnvelopeError extends Error {
  constructor(message = 'Encrypted Microdex message could not be authenticated.') {
    super(message);
    this.name = 'E2EEEnvelopeError';
  }
}

export function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

export function fromBase64Url(value, expectedBytes = null) {
  const encoded = String(value ?? '').trim();
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) throw new E2EEEnvelopeError();
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64url'));
  if (expectedBytes !== null && bytes.length !== expectedBytes) throw new E2EEEnvelopeError();
  return bytes;
}

export function normalizeE2EEKeyMaterial(value) {
  const keyId = String(value?.keyId ?? '').trim();
  const key = String(value?.key ?? '').trim();
  if (!KEY_ID_PATTERN.test(keyId)) throw new E2EEEnvelopeError('Invalid encrypted client id.');
  fromBase64Url(key, E2EE_KEY_BYTES);
  return { keyId, key };
}

export function createE2EEKeyMaterial(randomBytesImpl = randomBytes) {
  return normalizeE2EEKeyMaterial({
    keyId: toBase64Url(randomBytesImpl(16)),
    key: toBase64Url(randomBytesImpl(E2EE_KEY_BYTES)),
  });
}

function associatedData(keyId, purpose) {
  if (!purpose || typeof purpose !== 'string' || purpose.length > 160) {
    throw new E2EEEnvelopeError('Invalid encrypted message purpose.');
  }
  return utf8ToBytes(`microdex-e2ee-v${E2EE_PROTOCOL_VERSION}:${keyId}:${purpose}`);
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new E2EEEnvelopeError();
  if (value.v !== E2EE_PROTOCOL_VERSION) {
    throw new E2EEEnvelopeError('This encrypted Microdex protocol version is not supported.');
  }
  const keyId = String(value.keyId ?? '').trim();
  if (!KEY_ID_PATTERN.test(keyId)) throw new E2EEEnvelopeError();
  const nonce = fromBase64Url(value.nonce, E2EE_NONCE_BYTES);
  const ciphertext = fromBase64Url(value.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > E2EE_MAX_CIPHERTEXT_BYTES) {
    throw new E2EEEnvelopeError();
  }
  return { keyId, nonce, ciphertext };
}

export function sealE2EE(materialValue, purpose, payload, randomBytesImpl = randomBytes) {
  const material = normalizeE2EEKeyMaterial(materialValue);
  const nonce = new Uint8Array(randomBytesImpl(E2EE_NONCE_BYTES));
  if (nonce.length !== E2EE_NONCE_BYTES) throw new E2EEEnvelopeError('Invalid nonce source.');
  const plaintext = utf8ToBytes(JSON.stringify(payload));
  const cipher = xchacha20poly1305(
    fromBase64Url(material.key, E2EE_KEY_BYTES),
    nonce,
    associatedData(material.keyId, purpose),
  );
  return {
    v: E2EE_PROTOCOL_VERSION,
    keyId: material.keyId,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(plaintext)),
  };
}

export function openE2EE(materialValue, purpose, envelopeValue) {
  const material = normalizeE2EEKeyMaterial(materialValue);
  const envelope = normalizeEnvelope(envelopeValue);
  if (envelope.keyId !== material.keyId) throw new E2EEEnvelopeError();
  try {
    const cipher = xchacha20poly1305(
      fromBase64Url(material.key, E2EE_KEY_BYTES),
      envelope.nonce,
      associatedData(material.keyId, purpose),
    );
    const payload = JSON.parse(bytesToUtf8(cipher.decrypt(envelope.ciphertext)));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new E2EEEnvelopeError();
    }
    return payload;
  } catch (error) {
    if (error instanceof E2EEEnvelopeError) throw error;
    throw new E2EEEnvelopeError();
  }
}
