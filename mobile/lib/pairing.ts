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
  return parsed.toString().replace(/\/$/, '');
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
      throw new Error(result.error || 'The computer rejected this pairing QR.');
    }
    return { bridgeUrl: normalizeBridgeUrl(payload.bridgeUrl), token: result.token };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The pairing request timed out. Check that both devices use the same Wi-Fi.');
    }
    if (error instanceof TypeError) {
      throw new Error('The Mac could not be reached. Check Wi-Fi and the Microdex background service.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
