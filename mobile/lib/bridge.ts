import Constants from 'expo-constants';

import {
  type E2EEEnvelope,
  type E2EEKeyMaterial,
  openE2EE,
} from './e2ee-core.ts';
import { randomE2EEId, sealMobileE2EE } from './e2ee.ts';

/** Max and Ultra are excluded: see REASONING_EFFORTS in bridge/lib/codex-config.mjs. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type ActionAvailability = {
  status: 'available' | 'contextual' | 'unavailable';
  reason: string | null;
};

export type RemoteThread = {
  id: string;
  name: string;
  task: string;
  project: string;
  status: 'idle' | 'thinking' | 'waiting' | 'error' | 'complete';
  updatedAt: number;
  fastMode: boolean;
  reasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: ReasoningEffort[];
};

export type QueuedMessage = {
  id: string;
  threadId: string;
  text: string;
  status: 'queued' | 'sending';
  createdAt: number;
  error?: string;
};

export type RemoteState = {
  online: boolean;
  selectedThreadId: string | null;
  selected: RemoteThread | null;
  threads: RemoteThread[];
  messageQueue: QueuedMessage[];
  pendingApproval: {
    requestId: string;
    threadId: string;
    reason: string | null;
    command: string | null;
  } | null;
  actionAvailability?: Record<string, ActionAvailability>;
  voice?: {
    state: 'inactive' | 'launching' | 'setup' | 'active';
    muted: boolean;
  };
  commandResult?: {
    action: string;
    applied: boolean;
    verified: boolean;
    /** The App Server read the new state back. Absent on older bridges. */
    confirmed?: boolean;
    evidence: 'codex' | 'desktop';
    desktopMirrored: boolean;
    warning: string | null;
  } | null;
  hardware?: {
    mode: 'native' | 'standard';
    available: boolean;
    connected: boolean;
    battery: number | null;
    lighting: {
      rgb: {
        keys: unknown;
        ambient: number | null;
      } | null;
      threads: Array<{
        id: number | null;
        color: number | null;
        enabled: number | null;
        effect: number | null;
      }> | null;
    };
  };
};

export type BridgeStatus = {
  connected: true;
  bridge?: {
    name: string;
    version: string;
    protocolVersion: number;
  };
  capabilities?: {
    verifiedSettings: boolean;
    remoteChat: boolean;
    taskControl: boolean;
    programmableActions: number;
    programmableAssignments?: boolean;
    encoderModes?: boolean;
    desktopAutomation: boolean;
    actionAvailability: boolean;
    visibleDesktopRouting?: boolean;
    nativeHardware?: boolean;
    endToEndEncryption?: boolean;
  };
  connection?: {
    remoteAccess: string;
    remoteReady: boolean;
    transport: 'relay' | 'https' | 'local';
  };
  fastMode: boolean;
  reasoningEffort: ReasoningEffort;
  configPath: string;
  platform: string;
  desktop?: {
    available?: boolean;
    trusted?: boolean;
    running?: boolean;
    error?: string;
    reason?: string;
  };
  remote: RemoteState | { online: false; error: string } | null;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
};

type E2EESession = {
  sessionId: string;
  expiresAt: number;
};

const e2eeSessions = new Map<string, Promise<E2EESession>>();
const seenEventIds = new Map<string, Set<string>>();
const registeredEncryption = new Map<string, E2EEKeyMaterial>();

function normalizedBridgeKey(bridgeUrl: string) {
  return bridgeUrl.trim().replace(/\/$/, '');
}

export function registerBridgeEncryption(
  bridgeUrl: string,
  material: E2EEKeyMaterial | null,
) {
  const key = normalizedBridgeKey(bridgeUrl);
  const previous = registeredEncryption.get(key);
  if (previous) clearE2EESession(key, previous);
  if (material) registeredEncryption.set(key, material);
  else registeredEncryption.delete(key);
}

function e2eeSessionKey(bridgeUrl: string, material: E2EEKeyMaterial) {
  return `${bridgeUrl.replace(/\/$/, '')}:${material.keyId}`;
}

function clearE2EESession(bridgeUrl: string, material: E2EEKeyMaterial) {
  const key = e2eeSessionKey(bridgeUrl, material);
  e2eeSessions.delete(key);
  seenEventIds.delete(key);
}

async function ensureE2EESession(
  bridgeUrl: string,
  token: string,
  material: E2EEKeyMaterial,
  signal?: AbortSignal,
) {
  const key = e2eeSessionKey(bridgeUrl, material);
  const existing = e2eeSessions.get(key);
  if (existing) {
    const session = await existing;
    if (session.expiresAt > Date.now() + 10_000) return session;
    clearE2EESession(bridgeUrl, material);
  }

  const pending = (async () => {
    const requestId = await randomE2EEId();
    const envelope = await sealMobileE2EE(material, 'session', {
      requestId,
      issuedAt: Date.now(),
      token,
    });
    const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/e2ee/session`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ envelope }),
      signal,
    });
    const result = (await response.json()) as {
      envelope?: E2EEEnvelope;
      error?: string;
      code?: string;
    };
    if (!response.ok || !result.envelope) {
      if (response.status === 401) {
        throw new BridgeAuthError(
          'This Mac no longer accepts the encrypted pairing. Run "microdex pair" and scan the new QR.',
        );
      }
      throw new BridgeConnectionError(result.error || 'The encrypted bridge session could not start.');
    }
    const payload = openE2EE<E2EESession>(
      material,
      `session-response:${requestId}`,
      result.envelope,
    );
    if (
      !/^[A-Za-z0-9_-]{16,64}$/.test(payload.sessionId) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      throw new BridgeAuthError('The Mac returned an invalid encrypted session. Pair it again.');
    }
    return payload;
  })();
  e2eeSessions.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    e2eeSessions.delete(key);
    throw error;
  }
}

function bridgeErrorForStatus(status: number, payload: { error?: string; code?: string }) {
  const message = payload.error ?? `Bridge error ${status}`;
  if (status === 401) {
    return new BridgeAuthError(
      payload.code === 'E2EE_REQUIRED'
        ? 'This saved pairing predates end-to-end encryption. Run "microdex pair" on the Mac and scan the new QR once.'
        : 'This Mac no longer accepts the saved access code. Run "microdex pair" on the Mac and scan the new QR.',
    );
  }
  if (status === 503 && payload.code === 'MAC_OFFLINE') {
    return new BridgeConnectionError(
      'Your Mac is offline or sleeping. Microdex will reconnect automatically when it comes back online.',
    );
  }
  return new Error(message);
}

export class BridgeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeConnectionError';
  }
}

/**
 * The bridge is reachable but rejected the stored credential. Retrying cannot
 * help: only pairing again can.
 *
 * On iOS the Keychain survives an app uninstall, so a reinstalled app comes back
 * holding a token the Mac may no longer accept. Treated as a plain connection
 * error, that looked exactly like a flaky network and the app retried forever
 * without ever saying the credential was the problem.
 *
 * Extends BridgeConnectionError so existing checks keep working.
 */
export class BridgeAuthError extends BridgeConnectionError {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeAuthError';
  }
}

export function isBridgeConnectionError(error: unknown) {
  return error instanceof BridgeConnectionError;
}

export function isBridgeAuthError(error: unknown) {
  return error instanceof BridgeAuthError;
}

export function inferBridgeUrl() {
  const hostUri = Constants.expoConfig?.hostUri;
  const withoutProtocol = hostUri?.replace(/^[a-z]+:\/\//i, '');
  const host = withoutProtocol?.startsWith('[')
    ? withoutProtocol.slice(1, withoutProtocol.indexOf(']'))
    : withoutProtocol?.split(':')[0];
  return host ? `http://${host}:3210` : 'http://192.168.1.10:3210';
}

export function mobileAppInfo() {
  return {
    version: Constants.expoConfig?.version ?? 'unknown',
    buildNumber: Constants.expoConfig?.ios?.buildNumber ?? 'unknown',
  };
}

export function bridgeEventsUrl(bridgeUrl: string) {
  const url = new URL(bridgeUrl.replace(/\/$/, ''));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  url.pathname = `${basePath}/api/remote/events`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function bridgeEventAuthentication(
  bridgeUrl: string,
  token: string,
  material: E2EEKeyMaterial,
) {
  const session = await ensureE2EESession(bridgeUrl, token, material);
  const requestId = await randomE2EEId();
  const envelope = await sealMobileE2EE(
    material,
    `events-auth:${session.sessionId}`,
    { type: 'events-auth', requestId, issuedAt: Date.now() },
  );
  return {
    sessionId: session.sessionId,
    message: {
      type: 'e2ee-auth' as const,
      envelope: { ...envelope, sessionId: session.sessionId },
    },
  };
}

export function openBridgeEvent(
  bridgeUrl: string,
  material: E2EEKeyMaterial,
  sessionId: string,
  envelope: E2EEEnvelope,
) {
  const event = openE2EE<{
    eventId: string;
    issuedAt: number;
    payload: { type: 'state' | 'error'; state?: RemoteState; message?: string };
  }>(material, `event:${sessionId}`, envelope);
  if (
    !/^[A-Za-z0-9_-]{16,64}$/.test(event.eventId) ||
    !Number.isFinite(event.issuedAt) ||
    Math.abs(Date.now() - event.issuedAt) > 5 * 60 * 1000
  ) {
    throw new BridgeAuthError('An invalid encrypted live update was rejected.');
  }
  const key = e2eeSessionKey(bridgeUrl, material);
  const seen = seenEventIds.get(key) ?? new Set<string>();
  if (seen.has(event.eventId)) throw new BridgeAuthError('A replayed live update was rejected.');
  seen.add(event.eventId);
  if (seen.size > 2_048) seen.delete(seen.values().next().value as string);
  seenEventIds.set(key, seen);
  return event.payload;
}

export function resetEncryptedBridgeSession(
  bridgeUrl: string,
  material: E2EEKeyMaterial,
) {
  clearE2EESession(bridgeUrl, material);
}

export async function bridgeRequest<T>(
  bridgeUrl: string,
  token: string,
  path: string,
  options: RequestOptions = {},
  e2ee?: E2EEKeyMaterial | null,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  const encryption = e2ee ?? registeredEncryption.get(normalizedBridgeKey(bridgeUrl));

  try {
    if (encryption) {
      const encryptedRequest = async (retrySession: boolean): Promise<T> => {
        const session = await ensureE2EESession(bridgeUrl, token, encryption, controller.signal);
        const requestId = await randomE2EEId();
        const envelope = await sealMobileE2EE(encryption, `request:${session.sessionId}`, {
          requestId,
          issuedAt: Date.now(),
          method: options.method ?? 'GET',
          path,
          body: options.body,
        });
        const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/api/e2ee`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ envelope: { ...envelope, sessionId: session.sessionId } }),
          signal: controller.signal,
        });
        const outer = (await response.json()) as {
          envelope?: E2EEEnvelope;
          error?: string;
          code?: string;
        };
        if (response.status === 409 && outer.code === 'E2EE_SESSION_EXPIRED' && retrySession) {
          clearE2EESession(bridgeUrl, encryption);
          return encryptedRequest(false);
        }
        if (!response.ok || !outer.envelope) throw bridgeErrorForStatus(response.status, outer);
        const decrypted = openE2EE<{
          status: number;
          contentType?: string;
          body: string;
        }>(encryption, `response:${session.sessionId}:${requestId}`, outer.envelope);
        let payload: T & { error?: string; code?: string };
        try {
          payload = JSON.parse(decrypted.body) as T & { error?: string; code?: string };
        } catch {
          throw new BridgeConnectionError('The Mac returned an invalid encrypted response.');
        }
        if (decrypted.status < 200 || decrypted.status >= 300) {
          throw bridgeErrorForStatus(decrypted.status, payload);
        }
        return payload;
      };
      return await encryptedRequest(true);
    }

    const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Microdex-Token': token.trim(),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const payload = (await response.json()) as T & { error?: string; code?: string };
    if (!response.ok) {
      throw bridgeErrorForStatus(response.status, payload);
    }
    return payload;
  } catch (error) {
    if (error instanceof BridgeConnectionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BridgeConnectionError(
        'The bridge is not responding. Check the internet connection and keep Microdex running on the Mac.',
      );
    }
    if (error instanceof TypeError) {
      throw new BridgeConnectionError(
        'The bridge connection was lost. Check the phone and Mac internet connections.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
