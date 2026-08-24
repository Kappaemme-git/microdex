import { randomBytes, timingSafeEqual } from 'node:crypto';

import { createE2EEKeyMaterial, normalizeE2EEKeyMaterial } from './e2ee.mjs';

export const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
export const REVIEW_PAIRING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secretMatches(expected, provided = '') {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(String(provided));
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export class PairingSession {
  #accessToken;
  #code;
  #expiresAt;
  #claimed = false;
  #encryption;

  constructor({
    accessToken,
    code = randomBytes(24).toString('base64url'),
    encryption = createE2EEKeyMaterial(),
    now = Date.now(),
    ttlMs = DEFAULT_PAIRING_TTL_MS,
  }) {
    if (!accessToken) throw new Error('Pairing requires a bridge access token.');
    this.#accessToken = accessToken;
    this.#code = code;
    this.#encryption = normalizeE2EEKeyMaterial(encryption);
    this.#expiresAt = now + ttlMs;
  }

  get code() {
    return this.#code;
  }

  get expiresAt() {
    return this.#expiresAt;
  }

  get encryption() {
    return { ...this.#encryption };
  }

  validate(code, now = Date.now()) {
    if (this.#claimed) return { ok: false, reason: 'claimed' };
    if (now >= this.#expiresAt) return { ok: false, reason: 'expired' };
    if (!secretMatches(this.#code, code)) return { ok: false, reason: 'invalid' };
    return { ok: true };
  }

  claim(code, now = Date.now()) {
    const validation = this.validate(code, now);
    if (!validation.ok) return validation;
    this.#claimed = true;
    return { ok: true, token: this.#accessToken };
  }
}
