import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';

export const DEFAULT_RELAY_URL = 'https://microdex-relay.microdex-cli.workers.dev';
const IDENTITY_FILE = 'relay-device.json';
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 20_000;

function delayForAttempt(attempt) {
  return Math.min(RECONNECT_MAX_MS, 500 * 2 ** Math.min(attempt, 6));
}

export function normalizeRelayOrigin(value) {
  const parsed = new URL(String(value).trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('The Microdex relay must use a secure HTTPS origin.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('The Microdex relay address must not contain a path, query, or hash.');
  }
  return parsed.origin;
}

function validIdentity(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    /^[A-Za-z0-9_-]{20,64}$/.test(value.deviceId) &&
    typeof value.deviceSecret === 'string' &&
    value.deviceSecret.length >= 32 &&
    value.deviceSecret.length <= 256,
  );
}

export async function persistentRelayIdentity(stateDir) {
  const identityPath = path.join(stateDir, IDENTITY_FILE);
  try {
    const parsed = JSON.parse(await readFile(identityPath, 'utf8'));
    if (!validIdentity(parsed)) throw new Error('The saved relay identity is invalid.');
    await chmod(identityPath, 0o600);
    return parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const identity = {
    deviceId: randomBytes(18).toString('base64url'),
    deviceSecret: randomBytes(32).toString('base64url'),
  };
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(identityPath, `${JSON.stringify(identity)}\n`, {
    mode: 0o600,
    flag: 'wx',
  }).catch(async (error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
  const saved = JSON.parse(await readFile(identityPath, 'utf8'));
  if (!validIdentity(saved)) throw new Error('The saved relay identity is invalid.');
  return saved;
}

export async function deletePersistentRelayRoom({
  stateDir,
  relayOrigin = process.env.MICRODEX_RELAY_URL || DEFAULT_RELAY_URL,
  fetchImpl = fetch,
}) {
  const identityPath = path.join(stateDir, IDENTITY_FILE);
  let identity;
  try {
    identity = JSON.parse(await readFile(identityPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!validIdentity(identity)) throw new Error('The saved relay identity is invalid.');
  const response = await fetchImpl(
    `${relayDeviceUrl(relayOrigin, identity.deviceId)}/reset`,
    {
      method: 'DELETE',
      headers: { 'X-Microdex-Device-Secret': identity.deviceSecret },
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`The relay room could not be removed (${response.status}).`);
  return true;
}

export function relayDeviceUrl(relayOrigin, deviceId) {
  return `${normalizeRelayOrigin(relayOrigin)}/v1/devices/${encodeURIComponent(deviceId)}`;
}

export function relaySocketUrl(deviceUrl, endpoint = 'connect') {
  const url = new URL(`${deviceUrl.replace(/\/$/, '')}/${endpoint}`);
  url.protocol = 'wss:';
  return url.toString();
}

export function safeLocalApiPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/')) return null;
  const parsed = new URL(value, 'http://127.0.0.1');
  if (parsed.origin !== 'http://127.0.0.1' || !parsed.pathname.startsWith('/api/')) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function createRemoteRelay({
  port,
  stateDir,
  accessToken,
  authenticate = () => false,
  e2eeClients = null,
  claimEncryptedPairing = null,
  allowLegacy = false,
  enabled = true,
  relayOrigin = process.env.MICRODEX_RELAY_URL || DEFAULT_RELAY_URL,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
}) {
  let closed = false;
  let relaySocket = null;
  let localEventsSocket = null;
  let reconnectTimer = null;
  let localReconnectTimer = null;
  let heartbeatTimer = null;
  let reconnectAttempt = 0;
  let identity = null;
  let lastState = null;
  const legacyPhones = new Set();
  const encryptedPhones = new Map();
  let current = {
    status: enabled ? 'idle' : 'disabled',
    ready: false,
    url: null,
    error: null,
    transport: 'relay',
  };
  const listeners = new Set();

  const publish = (patch) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener({ ...current });
  };

  const sendRelay = (message) => {
    if (relaySocket?.readyState !== WebSocketImpl.OPEN) return false;
    relaySocket.send(JSON.stringify(message));
    return true;
  };

  const closeLocalEvents = () => {
    if (localReconnectTimer) clearTimeout(localReconnectTimer);
    localReconnectTimer = null;
    const active = localEventsSocket;
    localEventsSocket = null;
    if (active && active.readyState < WebSocketImpl.CLOSING) active.close(1000, 'Relay disconnected');
  };

  const openLocalEvents = () => {
    if (closed || localEventsSocket || relaySocket?.readyState !== WebSocketImpl.OPEN) return;
    const socket = new WebSocketImpl(`ws://127.0.0.1:${port}/api/remote/events`);
    localEventsSocket = socket;
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token: accessToken }));
    });
    socket.on('message', (raw) => {
      const payload = raw.toString();
      let parsed;
      try {
        parsed = JSON.parse(payload);
        if (parsed.type === 'state' && parsed.state) lastState = parsed.state;
      } catch {
        return;
      }
      if (legacyPhones.size) sendRelay({ type: 'event', payload });
      if (e2eeClients && encryptedPhones.size) {
        void Promise.all([...encryptedPhones].map(async ([phoneId, context]) => {
          const envelope = e2eeClients.sealEvent(context, parsed);
          sendRelay({
            type: 'phone-event',
            phoneId,
            payload: { type: 'e2ee', envelope },
          });
        })).catch(() => {});
      }
    });
    socket.once('close', () => {
      if (localEventsSocket === socket) localEventsSocket = null;
      if (!closed && relaySocket?.readyState === WebSocketImpl.OPEN) {
        localReconnectTimer = setTimeout(openLocalEvents, 1_000);
      }
    });
    socket.once('error', () => socket.close());
  };

  const answerPhoneAuthentication = async (message) => {
    if (message.envelope && e2eeClients) {
      try {
        const context = await e2eeClients.openSessionMessage(message.envelope, 'events-auth');
        if (context.payload.type !== 'events-auth') throw new Error('Invalid encrypted event request.');
        if (!lastState) {
          const response = await fetchImpl(`http://127.0.0.1:${port}/api/remote/state`, {
            headers: { Accept: 'application/json', 'X-Microdex-Token': accessToken },
          });
          if (!response.ok) throw new Error('Codex state is unavailable.');
          lastState = await response.json();
        }
        encryptedPhones.set(message.phoneId, context);
        sendRelay({
          type: 'phone-auth-result',
          phoneId: message.phoneId,
          ok: true,
          e2ee: true,
          stateEnvelope: e2eeClients.sealEvent(context, { type: 'state', state: lastState }),
        });
      } catch (error) {
        sendRelay({
          type: 'phone-auth-result',
          phoneId: message.phoneId,
          ok: false,
          error: error?.message || 'Encrypted event authentication failed.',
        });
      }
      return;
    }
    if (!allowLegacy) {
      sendRelay({
        type: 'phone-auth-result',
        phoneId: message.phoneId,
        ok: false,
        error: 'This saved pairing must be upgraded to end-to-end encryption.',
        code: 'E2EE_REQUIRED',
      });
      return;
    }
    const headers = { Accept: 'application/json', 'X-Microdex-Token': String(message.token || '') };
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/api/remote/state`, { headers });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) legacyPhones.add(message.phoneId);
      sendRelay({
        type: 'phone-auth-result',
        phoneId: message.phoneId,
        ok: response.ok,
        state: response.ok ? payload : undefined,
        error: response.ok ? undefined : payload.error || 'Invalid bridge access code.',
      });
    } catch (error) {
      sendRelay({
        type: 'phone-auth-result',
        phoneId: message.phoneId,
        ok: false,
        error: error?.message || 'The local Microdex bridge is unavailable.',
      });
    }
  };

  const sendRequestResponse = (requestId, status, body, contentType = 'application/json; charset=utf-8') => {
    sendRelay({ type: 'response', requestId, status, contentType, body });
  };

  const encryptedError = (message, error) => {
    const status = Number(error?.statusCode) || 400;
    sendRequestResponse(message.requestId, status, JSON.stringify({
      error: status === 401
        ? 'Encrypted Microdex authentication failed.'
        : error?.message || 'Encrypted Microdex request failed.',
      ...(error?.code ? { code: error.code } : {}),
    }));
  };

  const answerEncryptedRelayRequest = async (message, safePath) => {
    if (!e2eeClients) {
      sendRequestResponse(message.requestId, 426, JSON.stringify({
        error: 'This bridge does not support end-to-end encryption yet.',
      }));
      return;
    }
    let body;
    try {
      if (String(message.body || '').length > 400_000) throw new Error('Encrypted request is too large.');
      body = JSON.parse(String(message.body || '{}'));
    } catch (error) {
      encryptedError(message, error);
      return;
    }
    try {
      if (safePath === '/api/e2ee/pair') {
        if (!claimEncryptedPairing) throw new Error('Encrypted pairing is unavailable.');
        const result = await claimEncryptedPairing(body.envelope);
        sendRequestResponse(message.requestId, 200, JSON.stringify(result));
        return;
      }
      if (safePath === '/api/e2ee/session') {
        const session = await e2eeClients.createSession(body.envelope, authenticate);
        sendRequestResponse(message.requestId, 200, JSON.stringify({ envelope: session.envelope }));
        return;
      }
      if (safePath !== '/api/e2ee') throw new Error('Unknown encrypted Microdex endpoint.');

      const context = await e2eeClients.openSessionMessage(body.envelope, 'request');
      const requestedPath = safeLocalApiPath(context.payload.path);
      if (!requestedPath || requestedPath.startsWith('/api/e2ee')) {
        throw new Error('Invalid encrypted bridge request path.');
      }
      const method = context.payload.method === 'POST' ? 'POST' : 'GET';
      const response = await fetchImpl(`http://127.0.0.1:${port}${requestedPath}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Microdex-Token': accessToken,
        },
        body: method === 'POST' ? JSON.stringify(context.payload.body ?? {}) : undefined,
      });
      const responseBody = await response.text();
      const envelope = e2eeClients.sealResponse(context, {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: responseBody,
      });
      sendRequestResponse(message.requestId, 200, JSON.stringify({ envelope }));
    } catch (error) {
      encryptedError(message, error);
    }
  };

  const answerRelayRequest = async (message) => {
    const safePath = safeLocalApiPath(message.path);
    if (!safePath) {
      sendRelay({
        type: 'response',
        requestId: message.requestId,
        status: 400,
        body: JSON.stringify({ error: 'Invalid relay request path.' }),
      });
      return;
    }
    if (safePath === '/api/e2ee' || safePath === '/api/e2ee/session' || safePath === '/api/e2ee/pair') {
      await answerEncryptedRelayRequest(message, safePath);
      return;
    }
    if (!allowLegacy) {
      sendRequestResponse(message.requestId, 401, JSON.stringify({
        error: 'This saved pairing must be upgraded to end-to-end encryption.',
        code: 'E2EE_REQUIRED',
      }));
      return;
    }
    const method = ['GET', 'POST', 'OPTIONS'].includes(message.method) ? message.method : 'GET';
    const headers = {
      Accept: 'application/json',
      'Content-Type': String(message.headers?.['content-type'] || 'application/json').slice(0, 128),
      'X-Microdex-Token': String(message.headers?.['x-microdex-token'] || '').slice(0, 512),
    };
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}${safePath}`, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : String(message.body || ''),
      });
      sendRelay({
        type: 'response',
        requestId: message.requestId,
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.text(),
      });
    } catch (error) {
      sendRelay({
        type: 'response',
        requestId: message.requestId,
        status: 502,
        body: JSON.stringify({ error: error?.message || 'The local bridge is unavailable.' }),
      });
    }
  };

  const handleRelayMessage = (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === 'request') void answerRelayRequest(message);
    if (message.type === 'phone-auth') void answerPhoneAuthentication(message);
    if (message.type === 'phone-disconnected') {
      legacyPhones.delete(message.phoneId);
      encryptedPhones.delete(message.phoneId);
    }
  };

  const scheduleReconnect = () => {
    if (closed || !enabled || reconnectTimer) return;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayForAttempt(reconnectAttempt));
  };

  const connect = async () => {
    if (closed || !enabled || relaySocket) return;
    publish({ status: 'connecting', ready: false, error: null });
    try {
      identity ??= await persistentRelayIdentity(stateDir);
      const publicUrl = relayDeviceUrl(relayOrigin, identity.deviceId);
      const socket = new WebSocketImpl(relaySocketUrl(publicUrl), {
        headers: { 'X-Microdex-Device-Secret': identity.deviceSecret },
      });
      relaySocket = socket;
      socket.once('open', () => {
        reconnectAttempt = 0;
        publish({ status: 'ready', ready: true, url: publicUrl, error: null });
        openLocalEvents();
        let alive = true;
        socket.on('pong', () => { alive = true; });
        heartbeatTimer = setInterval(() => {
          if (!alive) {
            socket.terminate();
            return;
          }
          alive = false;
          socket.ping();
        }, HEARTBEAT_MS);
      });
      socket.on('message', handleRelayMessage);
      socket.once('error', (error) => {
        publish({
          status: 'error',
          ready: false,
          error: error?.message || 'The stable relay connection failed.',
        });
      });
      socket.once('close', () => {
        if (relaySocket === socket) relaySocket = null;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        closeLocalEvents();
        legacyPhones.clear();
        encryptedPhones.clear();
        if (closed) return;
        publish({
          status: 'offline',
          ready: false,
          url: publicUrl,
          error: 'The stable relay disconnected and is reconnecting.',
        });
        scheduleReconnect();
      });
    } catch (error) {
      relaySocket = null;
      publish({
        status: 'error',
        ready: false,
        error: error?.message || 'The stable relay could not start.',
      });
      scheduleReconnect();
    }
  };

  return {
    state: () => ({ ...current }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      void connect();
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      reconnectTimer = null;
      heartbeatTimer = null;
      closeLocalEvents();
      legacyPhones.clear();
      encryptedPhones.clear();
      const active = relaySocket;
      relaySocket = null;
      if (active && active.readyState < WebSocketImpl.CLOSING) active.close(1000, 'Bridge shutting down');
      publish({ status: 'closed', ready: false, error: null });
      listeners.clear();
    },
  };
}
