import Constants from 'expo-constants';

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

export class BridgeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeConnectionError';
  }
}

export function isBridgeConnectionError(error: unknown) {
  return error instanceof BridgeConnectionError;
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
  url.pathname = '/api/remote/events';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function bridgeRequest<T>(
  bridgeUrl: string,
  token: string,
  path: string,
  options: RequestOptions = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
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

    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      const message = payload.error ?? `Bridge error ${response.status}`;
      if (response.status === 401) throw new BridgeConnectionError(message);
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (error instanceof BridgeConnectionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BridgeConnectionError(
        'The bridge is not responding. Check Wi-Fi and the IP address.',
      );
    }
    if (error instanceof TypeError) {
      throw new BridgeConnectionError(
        'The bridge connection was lost. Check Wi-Fi and keep Microdex running on the computer.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
