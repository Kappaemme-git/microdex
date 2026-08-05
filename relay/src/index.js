const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const RESPONSE_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 400_000;
const MAX_PENDING_REQUESTS = 32;
const MAX_PHONE_CONNECTIONS = 16;
const MAX_WEBSOCKET_MESSAGE_BYTES = 1_000_000;
const ROOM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Microdex-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
});

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS },
  });
}

async function readLimitedBody(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('REQUEST_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('REQUEST_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function secretDigest(value) {
  const bytes = new TextEncoder().encode(String(value));
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function constantTimeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

export function parseDeviceRoute(value) {
  const url = value instanceof URL ? value : new URL(value);
  const match = url.pathname.match(/^\/v1\/devices\/([^/]+)(\/.*)?$/);
  if (!match || !DEVICE_ID_PATTERN.test(match[1])) return null;
  return {
    deviceId: match[1],
    basePath: `/v1/devices/${match[1]}`,
    roomPath: match[2] || '/',
  };
}

export function safeForwardHeaders(headers) {
  const forwarded = {};
  const token = headers.get('x-microdex-token');
  const contentType = headers.get('content-type');
  if (token) forwarded['x-microdex-token'] = token.slice(0, 512);
  if (contentType) forwarded['content-type'] = contentType.slice(0, 128);
  return forwarded;
}

function pairingPage(publicBase, code, nonce) {
  const deepLink = new URL('microdex:///pair');
  deepLink.searchParams.set('url', publicBase);
  deepLink.searchParams.set('code', code);
  const escapedLink = deepLink.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Microdex pairing</title><style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1418;color:#e8eef2;font-family:system-ui,sans-serif;padding:24px;text-align:center}a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#2f6fed;color:#fff;text-decoration:none;font-weight:600}p{opacity:.75;line-height:1.45;max-width:28rem}</style></head>
<body><div><h1>Microdex</h1><p>Open Microdex and scan the QR shown on your Mac, or continue below.</p><p>This pairing code can be used once and expires shortly.</p><a id="open-microdex" href="${escapedLink}">Open in Microdex</a></div><script nonce="${nonce}">
const link=document.getElementById('open-microdex');const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.get('e2ee')==='1'&&fragment.get('keyId')&&fragment.get('key')){const target=new URL(link.href);target.searchParams.set('e2ee','1');target.searchParams.set('keyId',fragment.get('keyId'));target.searchParams.set('key',fragment.get('key'));link.href=target.toString();}
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json(200, {
        ok: true,
        name: 'Microdex Relay',
        protocolVersion: 2,
        endToEndEncryption: true,
      });
    }
    if (request.method === 'OPTIONS') return json(204, {});

    const route = parseDeviceRoute(url);
    if (!route) return json(404, { error: 'Relay endpoint not found.' });

    if (env.DEVICE_RATE_LIMITER && env.ABUSE_RATE_LIMITER) {
      const actor = request.headers.get('cf-connecting-ip') || 'unknown';
      const routeClass = route.roomPath.startsWith('/api/') ? 'api' : route.roomPath;
      const [deviceLimit, abuseLimit] = await Promise.all([
        env.DEVICE_RATE_LIMITER.limit({ key: `${route.deviceId}:${routeClass}` }),
        env.ABUSE_RATE_LIMITER.limit({ key: actor }),
      ]);
      if (!deviceLimit.success || !abuseLimit.success) {
        return new Response(JSON.stringify({ error: 'Too many relay requests. Try again shortly.' }), {
          status: 429,
          headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, 'Retry-After': '60' },
        });
      }
    }

    const roomId = env.DEVICE_ROOMS.idFromName(route.deviceId);
    const room = env.DEVICE_ROOMS.get(roomId);
    const headers = new Headers(request.headers);
    headers.set('x-microdex-public-base', `${url.origin}${route.basePath}`);
    const roomUrl = new URL(route.roomPath, 'https://device-room.invalid');
    roomUrl.search = url.search;
    return room.fetch(new Request(roomUrl, { method: request.method, headers, body: request.body }));
  },
};

export class DeviceRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.pendingResponses = new Map();
  }

  macSocket() {
    return this.ctx.getWebSockets('mac').find((socket) => socket.readyState === WebSocket.OPEN) ?? null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connectMac(request);
    if (url.pathname === '/reset' && request.method === 'DELETE') {
      return this.resetRoom(request);
    }
    if (url.pathname === '/events' || url.pathname === '/api/remote/events') {
      return this.connectPhone(request);
    }
    if (url.pathname === '/pair' && request.method === 'GET') {
      const code = url.searchParams.get('code')?.trim() ?? '';
      const publicBase = request.headers.get('x-microdex-public-base') ?? '';
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(code) || !publicBase) {
        return json(400, { error: 'Invalid pairing link.' });
      }
      const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)));
      return new Response(pairingPage(publicBase, code, nonce), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...SECURITY_HEADERS,
          'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        },
      });
    }
    if (request.method === 'OPTIONS') return json(204, {});
    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Relay endpoint not found.' });
    return this.forwardToMac(request, url);
  }

  async resetRoom(request) {
    const suppliedSecret = request.headers.get('x-microdex-device-secret')?.trim() ?? '';
    const savedDigest = await this.ctx.storage.get('deviceSecretDigest');
    if (!savedDigest || suppliedSecret.length < 32 || suppliedSecret.length > 256) {
      return json(401, { error: 'Invalid Mac connector credential.' });
    }
    const suppliedDigest = await secretDigest(suppliedSecret);
    if (!constantTimeTextEqual(savedDigest, suppliedDigest)) {
      return json(401, { error: 'Invalid Mac connector credential.' });
    }
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('The relay room was removed.'));
    }
    this.pendingResponses.clear();
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, 'Relay room removed');
    await this.ctx.storage.deleteAll();
    return json(200, { ok: true });
  }

  async connectMac(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json(426, { error: 'WebSocket upgrade required.' });
    }
    const suppliedSecret = request.headers.get('x-microdex-device-secret')?.trim() ?? '';
    if (suppliedSecret.length < 32 || suppliedSecret.length > 256) {
      return json(401, { error: 'Invalid Mac connector credential.' });
    }
    const suppliedDigest = await secretDigest(suppliedSecret);
    const savedDigest = await this.ctx.storage.get('deviceSecretDigest');
    if (savedDigest && !constantTimeTextEqual(savedDigest, suppliedDigest)) {
      return json(401, { error: 'This relay room belongs to another Mac.' });
    }
    if (!savedDigest) await this.ctx.storage.put('deviceSecretDigest', suppliedDigest);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_RETENTION_MS);

    for (const existing of this.ctx.getWebSockets('mac')) {
      existing.close(1012, 'Mac reconnected');
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['mac']);
    server.serializeAttachment({ role: 'mac' });
    server.send(JSON.stringify({ type: 'connected' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  connectPhone(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json(426, { error: 'WebSocket upgrade required.' });
    }
    if (this.ctx.getWebSockets('phone').length >= MAX_PHONE_CONNECTIONS) {
      return json(429, { error: 'Too many phones are connected to this Mac.' });
    }
    const phoneId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['phone', `phone:${phoneId}`]);
    server.serializeAttachment({ role: 'phone', phoneId, authenticated: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async forwardToMac(request, url) {
    const mac = this.macSocket();
    if (!mac) return json(503, { error: 'Mac is offline.', code: 'MAC_OFFLINE' });
    if (this.pendingResponses.size >= MAX_PENDING_REQUESTS) {
      return json(429, { error: 'This Mac is handling too many requests.' });
    }
    const requestId = crypto.randomUUID();
    let body = '';
    try {
      body = ['GET', 'HEAD'].includes(request.method) ? '' : await readLimitedBody(request);
    } catch (error) {
      if (error?.message === 'REQUEST_TOO_LARGE') {
        return json(413, { error: 'Relay request is too large.' });
      }
      throw error;
    }
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error('The Mac did not answer in time.'));
      }, RESPONSE_TIMEOUT_MS);
      this.pendingResponses.set(requestId, { resolve, reject, timeout });
    });
    mac.send(JSON.stringify({
      type: 'request',
      requestId,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: safeForwardHeaders(request.headers),
      body,
    }));
    try {
      const response = await responsePromise;
      return new Response(response.body ?? '', {
        status: response.status,
        headers: {
          ...JSON_HEADERS,
          ...SECURITY_HEADERS,
          'Content-Type': response.contentType || 'application/json; charset=utf-8',
        },
      });
    } catch (error) {
      return json(504, { error: error?.message || 'The Mac did not answer.' });
    }
  }

  webSocketMessage(socket, rawMessage) {
    let message;
    try {
      const raw = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
      if (raw.length > MAX_WEBSOCKET_MESSAGE_BYTES) {
        socket.close(1009, 'Message too large');
        return;
      }
      message = JSON.parse(raw);
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid relay message.' }));
      return;
    }
    const attachment = socket.deserializeAttachment() ?? {};
    if (attachment.role === 'mac') this.handleMacMessage(message);
    else if (attachment.role === 'phone') this.handlePhoneMessage(socket, attachment, message);
  }

  handleMacMessage(message) {
    if (message.type === 'response' && typeof message.requestId === 'string') {
      const pending = this.pendingResponses.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(message.requestId);
      pending.resolve(message);
      return;
    }
    if (message.type === 'phone-auth-result' && typeof message.phoneId === 'string') {
      const phone = this.ctx.getWebSockets(`phone:${message.phoneId}`)[0];
      if (!phone) return;
      const attachment = phone.deserializeAttachment() ?? {};
      if (!message.ok) {
        phone.send(JSON.stringify({
          type: 'error',
          message: message.error || 'Invalid bridge access code.',
          ...(message.code ? { code: message.code } : {}),
        }));
        phone.close(1008, 'Authentication failed');
        return;
      }
      phone.serializeAttachment({ ...attachment, authenticated: true, e2ee: message.e2ee === true });
      phone.send(JSON.stringify({ type: 'ready', e2ee: message.e2ee === true }));
      if (message.e2ee && message.stateEnvelope) {
        phone.send(JSON.stringify({ type: 'e2ee', envelope: message.stateEnvelope }));
      } else if (message.state) {
        phone.send(JSON.stringify({ type: 'state', state: message.state }));
      }
      return;
    }
    if (message.type === 'phone-event' && typeof message.phoneId === 'string') {
      const phone = this.ctx.getWebSockets(`phone:${message.phoneId}`)[0];
      if (phone?.deserializeAttachment()?.authenticated) {
        phone.send(JSON.stringify(message.payload));
      }
      return;
    }
    if (message.type === 'event' && message.payload !== undefined) {
      const payload = typeof message.payload === 'string'
        ? message.payload
        : JSON.stringify(message.payload);
      for (const phone of this.ctx.getWebSockets('phone')) {
        const attachment = phone.deserializeAttachment() ?? {};
        if (attachment.authenticated && !attachment.e2ee) phone.send(payload);
      }
    }
  }

  handlePhoneMessage(phone, attachment, message) {
    if (attachment.authenticated) return;
    const token = message?.type === 'auth' ? String(message.token ?? '').trim() : '';
    const envelope = message?.type === 'e2ee-auth' ? message.envelope : null;
    if (!token && !envelope) {
      phone.send(JSON.stringify({ type: 'error', message: 'Authenticate before receiving Mac events.' }));
      return;
    }
    const mac = this.macSocket();
    if (!mac) {
      phone.send(JSON.stringify({ type: 'error', message: 'Mac is offline.' }));
      phone.close(1013, 'Mac offline');
      return;
    }
    mac.send(JSON.stringify({
      type: 'phone-auth',
      phoneId: attachment.phoneId,
      ...(envelope ? { envelope } : { token }),
    }));
  }

  webSocketClose(socket) {
    const attachment = socket.deserializeAttachment() ?? {};
    if (attachment.role === 'phone') {
      const mac = this.macSocket();
      if (mac) mac.send(JSON.stringify({
        type: 'phone-disconnected',
        phoneId: attachment.phoneId,
      }));
      return;
    }
    if (attachment.role !== 'mac') return;
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('The Mac disconnected.'));
    }
    this.pendingResponses.clear();
    for (const phone of this.ctx.getWebSockets('phone')) {
      phone.send(JSON.stringify({ type: 'error', message: 'Mac disconnected. Reconnecting…' }));
      phone.close(1012, 'Mac disconnected');
    }
  }

  webSocketError(socket) {
    this.webSocketClose(socket);
  }

  async alarm() {
    if (this.macSocket()) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_RETENTION_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}
