export type PairingCredentials = {
  bridgeUrl: string;
  token: string;
};

export type PairingPayload = {
  bridgeUrl: string;
  token?: string;
  code?: string;
};

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
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('The pairing code contains an invalid bridge address.');
  }
  return parsed.origin;
}

/**
 * Deep-link form used when Microdex is already installed.
 *
 * Three slashes on purpose: `microdex://pair` parses `pair` as the host and
 * leaves the path empty, which Expo Router cannot match.
 */
export function buildPairingUrl({ bridgeUrl, token }: PairingCredentials) {
  const url = new URL('microdex:///pair');
  url.searchParams.set('url', normalizeBridgeUrl(bridgeUrl));
  url.searchParams.set('token', token.trim());
  return url.toString();
}

/**
 * HTTP form shown in terminal/Chrome QRs.
 * Phone cameras treat this as usable data; Microdex parses it the same way.
 */
export function buildPairingHttpUrl({ bridgeUrl, token }: PairingCredentials) {
  const base = normalizeBridgeUrl(bridgeUrl);
  const url = new URL('/pair', `${base}/`);
  url.searchParams.set('token', token.trim());
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
    if (path !== '/pair') {
      throw new Error('This is not a Microdex pairing QR code.');
    }
    const code = parsed.searchParams.get('code')?.trim() ?? '';
    const token = parsed.searchParams.get('token')?.trim() ?? '';
    if (!code && !token) {
      throw new Error('The pairing QR code is incomplete.');
    }
    return {
      bridgeUrl: normalizeBridgeUrl(parsed.origin),
      ...(code ? { code } : { token }),
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
    return {
      bridgeUrl: normalizeBridgeUrl(rawBridgeUrl),
      ...(code ? { code } : { token }),
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
  if (payload.token) return { bridgeUrl: payload.bridgeUrl, token: payload.token };
  if (!payload.code) throw new Error('The pairing QR code is incomplete.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(`${normalizeBridgeUrl(payload.bridgeUrl)}/api/pair/claim`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: payload.code }),
      signal: controller.signal,
    });
    const result = (await response.json()) as { token?: string; error?: string };
    if (!response.ok || !result.token) {
      // The bridge mints one pairing session per process and it is single use, so
      // after the first pairing every QR it still serves is dead. That happens to
      // anyone who reinstalls the app: the phone no longer holds a token, and a
      // fresh code can only be requested with one. The recovery exists but the
      // bridge never names it, which left people retrying a code that could not
      // work.
      if (response.status === 401 || response.status === 410) {
        throw new PairingCodeSpentError(
          'This pairing QR has already been used or has expired. Run "microdex pair" on the Mac and scan the new QR.',
        );
      }
      throw new Error(result.error || 'The computer rejected this pairing QR.');
    }
    return { bridgeUrl: normalizeBridgeUrl(payload.bridgeUrl), token: result.token };
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
