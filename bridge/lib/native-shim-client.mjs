import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 1_500;

export function nativeShimPaths(stateDir = process.env.MICRODEX_HOME || path.join(os.homedir(), '.microdex')) {
  const directory = path.join(stateDir, 'native');
  return {
    directory,
    deviceSocket:
      process.env.MICRODEX_NATIVE_DEVICE_SOCKET || path.join(directory, 'device.sock'),
    controlSocket:
      process.env.MICRODEX_NATIVE_CONTROL_SOCKET || path.join(directory, 'control.sock'),
    bridgePid: path.join(directory, 'bridge.pid'),
    codexPid: path.join(directory, 'codex.pid'),
  };
}

export function requestNativeShim(
  command,
  {
    socketPath = nativeShimPaths().controlSocket,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let input = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(() => {
      const error = new Error('Codex Micro native channel did not respond.');
      error.statusCode = 503;
      finish(error);
    }, timeoutMs);

    socket.on('connect', () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8');
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(input.slice(0, newline));
        if (!response.ok) {
          const error = new Error(response.message || 'Native Micro command failed.');
          error.statusCode = 503;
          finish(error);
          return;
        }
        finish(null, response);
      } catch {
        const error = new Error('Native Micro returned an invalid response.');
        error.statusCode = 503;
        finish(error);
      }
    });
    socket.on('error', () => {
      const error = new Error(
        'Native Micro is not active. Run “microdex native” on the paired Mac.',
      );
      error.statusCode = 503;
      finish(error);
    });
  });
}

/**
 * Keeps one local subscription open so Codex's native lighting messages can be
 * projected to the phone immediately. The HTTP bridge remains usable when the
 * optional shim is absent.
 */
export class NativeShimClient {
  #socketPath;
  #socket = null;
  #reconnectTimer = null;
  #stopped = true;
  #input = '';
  #listeners = new Set();
  #state = {
    available: false,
    connected: false,
    battery: null,
    lighting: { rgb: null, threads: null },
  };

  constructor({ socketPath = nativeShimPaths().controlSocket } = {}) {
    this.#socketPath = socketPath;
  }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop() {
    this.#stopped = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.destroy();
    this.#socket = null;
  }

  state() {
    return structuredClone(this.#state);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async command(command) {
    if (!this.#state.connected) {
      const error = new Error(
        'Codex has not connected to Native Micro. Run “microdex native” and wait for Linked.',
      );
      error.statusCode = 503;
      throw error;
    }
    return requestNativeShim(command, { socketPath: this.#socketPath });
  }

  #emit() {
    for (const listener of this.#listeners) listener(this.state());
  }

  #setOffline() {
    const changed = this.#state.available || this.#state.connected;
    this.#state = {
      ...this.#state,
      available: false,
      connected: false,
    };
    if (changed) this.#emit();
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, 1_000);
  }

  #connect() {
    if (this.#stopped) return;
    const socket = net.createConnection(this.#socketPath);
    this.#socket = socket;
    this.#input = '';

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ type: 'lighting.subscribe' })}\n`);
    });
    socket.on('data', (chunk) => {
      this.#input += chunk.toString('utf8');
      let newline;
      while ((newline = this.#input.indexOf('\n')) >= 0) {
        const line = this.#input.slice(0, newline).trim();
        this.#input = this.#input.slice(newline + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (!event.ok || event.type !== 'hardware.state') continue;
          this.#state = {
            available: true,
            connected: Boolean(event.connected),
            battery: Number.isFinite(event.battery) ? event.battery : null,
            lighting: event.lighting && typeof event.lighting === 'object'
              ? event.lighting
              : { rgb: null, threads: null },
          };
          this.#emit();
        } catch {
          // Ignore one malformed line without dropping the local subscription.
        }
      }
    });
    socket.on('error', () => this.#setOffline());
    socket.on('close', () => {
      if (this.#socket === socket) this.#socket = null;
      this.#setOffline();
      this.#scheduleReconnect();
    });
  }
}
