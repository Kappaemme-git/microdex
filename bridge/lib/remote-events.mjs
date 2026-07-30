import { WebSocket, WebSocketServer } from 'ws';

const AUTH_TIMEOUT_MS = 5_000;
const PUSH_DEBOUNCE_MS = 40;

export function attachRemoteEvents({
  server,
  codex,
  authenticate,
  pollIntervalMs = 750,
}) {
  const sockets = new Set();
  const webSockets = new WebSocketServer({ noServer: true });
  let pushTimer = null;
  let pushInFlight = false;
  let pushAgain = false;
  let lastBroadcast = null;

  async function sendCurrentState(socket) {
    if (socket.readyState !== WebSocket.OPEN || !socket.microdexAuthenticated) return;
    try {
      const state = await codex.state();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'state', state }));
      }
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'error',
          message: error?.message || 'Codex state is unavailable.',
        }));
      }
    }
  }

  async function pushCurrentState() {
    if (pushInFlight) {
      pushAgain = true;
      return;
    }
    pushInFlight = true;
    try {
      const state = await codex.state();
      const message = JSON.stringify({ type: 'state', state });
      if (message === lastBroadcast) return;
      lastBroadcast = message;
      for (const socket of sockets) {
        if (socket.microdexAuthenticated && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    } catch (error) {
      const message = JSON.stringify({
        type: 'error',
        message: error?.message || 'Codex state is unavailable.',
      });
      for (const socket of sockets) {
        if (socket.microdexAuthenticated && socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      }
    } finally {
      pushInFlight = false;
      if (pushAgain) {
        pushAgain = false;
        schedulePush();
      }
    }
  }

  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushCurrentState();
    }, PUSH_DEBOUNCE_MS);
  }

  const unsubscribe = codex.subscribe(schedulePush);

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/api/remote/events') {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request);
    });
  });

  webSockets.on('connection', (socket) => {
    sockets.add(socket);
    socket.microdexAuthenticated = false;
    socket.microdexAlive = true;
    const authTimer = setTimeout(() => socket.close(4401, 'Authentication required'), AUTH_TIMEOUT_MS);

    socket.on('pong', () => {
      socket.microdexAlive = true;
    });
    socket.on('message', (raw) => {
      if (socket.microdexAuthenticated) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'auth' || !authenticate(message.token)) {
          socket.close(4401, 'Invalid access code');
          return;
        }
        clearTimeout(authTimer);
        socket.microdexAuthenticated = true;
        socket.send(JSON.stringify({ type: 'ready' }));
        void sendCurrentState(socket);
      } catch {
        socket.close(4400, 'Invalid message');
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      sockets.delete(socket);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.microdexAlive) {
        socket.terminate();
        continue;
      }
      socket.microdexAlive = false;
      socket.ping();
    }
  }, 20_000);
  const visibleStatePoll = setInterval(() => {
    if ([...sockets].some(
      (socket) => socket.microdexAuthenticated && socket.readyState === WebSocket.OPEN
    )) {
      schedulePush();
    }
  }, pollIntervalMs);

  return {
    notify: schedulePush,
    close() {
      unsubscribe();
      clearInterval(heartbeat);
      clearInterval(visibleStatePoll);
      if (pushTimer) clearTimeout(pushTimer);
      for (const socket of sockets) socket.close(1001, 'Bridge shutting down');
      webSockets.close();
    },
  };
}
