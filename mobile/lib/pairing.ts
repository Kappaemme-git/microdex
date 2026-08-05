import {
  type E2EEEnvelope,
  type E2EEKeyMaterial,
  normalizeE2EEKeyMaterial,
  openE2EE,
} from './e2ee-core.ts';

export type PairingCredentials = {
  bridgeUrl: string;
  token: string;
  e2ee?: E2EEKeyMaterial;
};

export type PairingPayload = {
  bridgeUrl: string;
  token?: string;
  code?: string;
  e2ee?: E2EEKeyMaterial;
};

function readE2EEPairing(params: URLSearchParams) {
  if (params.get('e2ee') !== '1') return undefined;
  return normalizeE2EEKeyMaterial({
    keyId: params.get('keyId'),
    key: params.get('key'),
  });
}

export function normalizeBridgeUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('The pairing code does not contain a valid bridge address.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('The pairing code contains an invalid bridge address.');
  }
  const hostname = parsed.hostname.toLowerCase();
  const isPrivateIpv4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const isLocalName = hostname.endsWith('.local');
  if (parsed.protocol === 'http:' && !isPrivateIpv4 && !isLoopback && !isLocalName) {
    throw new Error('Remote Microdex pairing requires a secure HTTPS address.');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const isStableRelayPath =
    parsed.protocol === 'https:' &&
    /^\/v1\/devices\/[A-Za-z0-9_-]{20,64}$/.test(pathname);
  if ((pathname !== '/' && !isStableRelayPath) || parsed.search || parsed.hash) {
    throw new Error('The pairing code contains an invalid bridge address.');
  }
  return pathname === '/' ? parsed.origin : `${parsed.origin}${pathname}`;
}

/**
 * Deep-link form used when Microdex is already installed.
 *
 * Three slashes on purpose: `microdex://pair` parses `pair` as the host and
 * leaves the path empty, which Expo Router cannot match.
 */
export function buildPairingUrl({ bridgeUrl, token, e2ee }: PairingCredentials) {
  const url = new URL('microdex:///pair');
  url.searchParams.set('url', normalizeBridgeUrl(bridgeUrl));
  url.searchParams.set('token', token.trim());
  if (e2ee) {
    const material = normalizeE2EEKeyMaterial(e2ee);
    url.searchParams.set('e2ee', '1');
    url.searchParams.set('keyId', material.keyId);
    url.searchParams.set('key', material.key);
  }
  return url.toString();
}

/**
 * HTTP form shown in terminal/Chrome QRs.
 * Phone cameras treat this as usable data; Microdex parses it the same way.
 */
export function buildPairingHttpUrl({ bridgeUrl, token, e2ee }: PairingCredentials) {
  const base = normalizeBridgeUrl(bridgeUrl);
  const url = new URL(`${base.replace(/\/$/, '')}/pair`);
  url.searchParams.set('token', token.trim());
  if (e2ee) {
    const material = normalizeE2EEKeyMaterial(e2ee);
    url.hash = new URLSearchParams({ e2ee: '1', ...material }).toString();
  }
  return url.toString();
}

function isMicrodexPairHost(parsed: URL) {
  const host = (parsed.hostname || parsed.host || '').toLowerCase();
  const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  return host === 'pair' || path === 'pair';
}

export function parsePairingUrl(value: string): PairingPayload {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('This is not a Microdex pairing QR code.');
  }

  // Preferred QR payload: http(s)://BRIDGE/pair?code=ONE_TIME_CODE
  if (['http:', 'https:'].includes(parsed.protocol)) {
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const relayPair = path.match(
      /^(\/v1\/devices\/[A-Za-z0-9_-]{20,64})\/pair$/,
    );
    if (path !== '/pair' && !relayPair) {
      throw new Error('This is not a Microdex pairing QR code.');
    }
    const code = parsed.searchParams.get('code')?.trim() ?? '';
    const token = parsed.searchParams.get('token')?.trim() ?? '';
    if (!code && !token) {
      throw new Error('The pairing QR code is incomplete.');
    }
    const e2ee = readE2EEPairing(new URLSearchParams(parsed.hash.slice(1)));
    return {
      bridgeUrl: normalizeBridgeUrl(
        relayPair ? `${parsed.origin}${relayPair[1]}` : parsed.origin,
      ),
      ...(code ? { code } : { token }),
      ...(e2ee ? { e2ee } : {}),
    };
  }

  // Deep link: microdex://pair?url=...&code=...
  if (parsed.protocol === 'microdex:' && isMicrodexPairHost(parsed)) {
    const code = parsed.searchParams.get('code')?.trim() ?? '';
    const token = parsed.searchParams.get('token')?.trim() ?? '';
    const rawBridgeUrl = parsed.searchParams.get('url')?.trim() ?? '';
    if ((!code && !token) || !rawBridgeUrl) {
      throw new Error('The pairing QR code is incomplete.');
    }
    const e2ee = readE2EEPairing(parsed.searchParams);
    return {
      bridgeUrl: normalizeBridgeUrl(rawBridgeUrl),
      ...(code ? { code } : { token }),
      ...(e2ee ? { e2ee } : {}),
    };
  }

  throw new Error('This is not a Microdex pairing QR code.');
}

/**
 * The pairing code was valid once but cannot be claimed again. Retrying is
 * pointless: only a fresh QR from the Mac can recover, so callers must stop and
 * say so rather than loop.
 */
export class PairingCodeSpentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingCodeSpentError';
  }
}

export async function claimPairingPayload(payload: PairingPayload): Promise<PairingCredentials> {
  if (payload.token) {
    return {
      bridgeUrl: payload.bridgeUrl,
      token: payload.token,
      ...(payload.e2ee ? { e2ee: payload.e2ee } : {}),
    };
  }
  if (!payload.code) throw new Error('The pairing QR code is incomplete.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const crypto = payload.e2ee ? await import('./e2ee.ts') : null;
    const requestId = crypto ? await crypto.randomE2EEId() : null;
    const encryptedEnvelope = payload.e2ee && requestId
      ? await crypto!.sealMobileE2EE(payload.e2ee, 'pair', {
          requestId,
          issuedAt: Date.now(),
          code: payload.code,
        })
      : null;
    const response = await fetch(
      `${normalizeBridgeUrl(payload.bridgeUrl)}${payload.e2ee ? '/api/e2ee/pair' : '/api/pair/claim'}`,
      {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload.e2ee ? { envelope: encryptedEnvelope } : { code: payload.code }),
      signal: controller.signal,
      },
    );
    const outer = (await response.json()) as {
      token?: string;
      error?: string;
      envelope?: E2EEEnvelope;
      code?: string;
    };
    const result = payload.e2ee && requestId && outer.envelope
      ? openE2EE<{ token?: string; error?: string; code?: string }>(
          payload.e2ee,
          `pair-response:${requestId}`,
          outer.envelope,
        )
      : outer;
    if (!response.ok || !result.token) {
      // The bridge mints one pairing session per process and it is single use, so
      // after the first pairing every QR it still serves is dead. That happens to
      // anyone who reinstalls the app: the phone no longer holds a token, and a
      // fresh code can only be requested with one. The recovery exists but the
      // bridge never names it, which left people retrying a code that could not
      // work.
      if (
        response.status === 401 ||
        response.status === 410 ||
        result.code === 'PAIRING_EXPIRED' ||
        result.code === 'PAIRING_REJECTED'
      ) {
        throw new PairingCodeSpentError(
          'This pairing QR has already been used or has expired. Run "microdex pair" on the Mac and scan the new QR.',
        );
      }
      throw new Error(result.error || 'The computer rejected this pairing QR.');
    }
    return {
      bridgeUrl: normalizeBridgeUrl(payload.bridgeUrl),
      token: result.token,
      ...(payload.e2ee ? { e2ee: payload.e2ee } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The pairing request timed out. Check the phone and Mac internet connections.');
    }
    if (error instanceof TypeError) {
      throw new Error('The Mac could not be reached. Check both internet connections and the Microdex background service.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
