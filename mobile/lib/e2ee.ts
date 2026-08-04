import * as Crypto from 'expo-crypto';

import {
  E2EE_NONCE_BYTES,
  type E2EEEnvelope,
  type E2EEKeyMaterial,
  sealE2EE,
  toBase64Url,
} from './e2ee-core.ts';

export async function randomE2EEId(bytes = 18) {
  return toBase64Url(await Crypto.getRandomBytesAsync(bytes));
}

export async function sealMobileE2EE(
  material: E2EEKeyMaterial,
  purpose: string,
  payload: object,
): Promise<E2EEEnvelope> {
  const nonce = await Crypto.getRandomBytesAsync(E2EE_NONCE_BYTES);
  return sealE2EE(material, purpose, payload, nonce);
}

export type { E2EEEnvelope, E2EEKeyMaterial } from './e2ee-core.ts';
export { E2EEEnvelopeError, normalizeE2EEKeyMaterial, openE2EE } from './e2ee-core.ts';
