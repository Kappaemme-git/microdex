import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';

export const E2EE_PROTOCOL_VERSION = 1;
export const E2EE_KEY_BYTES = 32;
export const E2EE_NONCE_BYTES = 24;
const E2EE_MAX_CIPHERTEXT_BYTES = 256 * 1024;

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type E2EEKeyMaterial = {
  keyId: string;
  key: string;
};

export type E2EEEnvelope = {
  v: 1;
  keyId: string;
  nonce: string;
  ciphertext: string;
  sessionId?: string;
};

export class E2EEEnvelopeError extends Error {
  constructor(message = 'Encrypted Microdex message could not be authenticated.') {
    super(message);
    this.name = 'E2EEEnvelopeError';
  }
}

export function toBase64Url(value: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string, expectedBytes: number | null = null) {
  const encoded = String(value ?? '').trim();
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) throw new E2EEEnvelopeError();
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new E2EEEnvelopeError();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (expectedBytes !== null && bytes.length !== expectedBytes) throw new E2EEEnvelopeError();
  return bytes;
}

export function normalizeE2EEKeyMaterial(value: unknown): E2EEKeyMaterial {
  const candidate = value as Partial<E2EEKeyMaterial> | null;
  const keyId = String(candidate?.keyId ?? '').trim();
  const key = String(candidate?.key ?? '').trim();
  if (!KEY_ID_PATTERN.test(keyId)) throw new E2EEEnvelopeError('Invalid encrypted client id.');
  fromBase64Url(key, E2EE_KEY_BYTES);
  return { keyId, key };
}

function associatedData(keyId: string, purpose: string) {
  if (!purpose || typeof purpose !== 'string' || purpose.length > 160) {
    throw new E2EEEnvelopeError('Invalid encrypted message purpose.');
  }
  return utf8ToBytes(`microdex-e2ee-v${E2EE_PROTOCOL_VERSION}:${keyId}:${purpose}`);
}

function normalizeEnvelope(value: unknown) {
  const candidate = value as Partial<E2EEEnvelope> | null;
  if (!candidate || candidate.v !== E2EE_PROTOCOL_VERSION) throw new E2EEEnvelopeError();
  const keyId = String(candidate.keyId ?? '').trim();
  if (!KEY_ID_PATTERN.test(keyId)) throw new E2EEEnvelopeError();
  const nonce = fromBase64Url(String(candidate.nonce ?? ''), E2EE_NONCE_BYTES);
  const ciphertext = fromBase64Url(String(candidate.ciphertext ?? ''));
  if (ciphertext.length < 17 || ciphertext.length > E2EE_MAX_CIPHERTEXT_BYTES) {
    throw new E2EEEnvelopeError();
  }
  return { keyId, nonce, ciphertext };
}

export function sealE2EE(
  materialValue: E2EEKeyMaterial,
  purpose: string,
  payload: object,
  nonce: Uint8Array,
): E2EEEnvelope {
  const material = normalizeE2EEKeyMaterial(materialValue);
  if (nonce.length !== E2EE_NONCE_BYTES) throw new E2EEEnvelopeError('Invalid nonce source.');
  const cipher = xchacha20poly1305(
    fromBase64Url(material.key, E2EE_KEY_BYTES),
    nonce,
    associatedData(material.keyId, purpose),
  );
  return {
    v: E2EE_PROTOCOL_VERSION,
    keyId: material.keyId,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(utf8ToBytes(JSON.stringify(payload)))),
  };
}

export function openE2EE<T extends object>(
  materialValue: E2EEKeyMaterial,
  purpose: string,
  envelopeValue: unknown,
): T {
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
    return payload as T;
  } catch (error) {
    if (error instanceof E2EEEnvelopeError) throw error;
    throw new E2EEEnvelopeError();
  }
}
