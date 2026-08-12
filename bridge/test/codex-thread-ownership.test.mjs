import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';

import WebSocket from 'ws';

import { CodexAppServer } from '../lib/codex-app-server.mjs';

const CODEX_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex';
const REQUEST_TIMEOUT_MS = 10_000;

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert.ok(port, 'Could not reserve a loopback port.');
  return port;
}

async function openSocket(url, attempts = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(new Error('Timed out opening the App Server socket.'));
        }, 300);
        socket.once('open', () => {
          clearTimeout(timeout);
          resolve(socket);
        });
        socket.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  throw lastError ?? new Error('Could not open the App Server socket.');
}

async function startClient(name) {
  const port = await reserveLoopbackPort();
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn(CODEX_BIN, ['app-server', '--listen', url], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const socket = await openSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id === undefined || message.method) return;
    const entry = pending.get(String(message.id));
    if (!entry) return;
    pending.delete(String(message.id));
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(message.error.message || 'Codex request failed.'));
    else entry.resolve(message.result);
  });

  const request = (method, params = {}) => {
    const id = String(nextId++);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  await request('initialize', {
    clientInfo: { name, title: name, version: 'test' },
    capabilities: { experimentalApi: true },
  });
  socket.send(JSON.stringify({ method: 'initialized', params: {} }));

  return {
    request,
    async close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('Test App Server client closed.'));
      }
      pending.clear();
      socket.close();
      child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
          new Promise((resolve) => child.once('exit', resolve)),
          new Promise((resolve) => {
            const timeout = setTimeout(resolve, 750);
            timeout.unref();
          }),
        ]);
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise((resolve) => child.once('exit', resolve));
      }
    },
  };
}

test('reading Microdex state does not take the selected task away from Codex Desktop', async () => {
  const fixture = await startClient('microdex-ownership-fixture');
  const microdex = new CodexAppServer();
  const desktop = await startClient('desktop-ownership-test');
  let threadId;

  try {
    const listed = await fixture.request('thread/list', {
      limit: 1,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      archived: false,
    });
    assert.ok(listed.data[0], 'A recent Codex task is required for this integration test.');
    const forked = await fixture.request('thread/fork', {
      threadId: listed.data[0].id,
      excludeTurns: true,
    });
    threadId = forked.thread.id;
    await fixture.close();

    microdex.markSelectedThread(threadId);
    await microdex.state();
    let resumed;
    await assert.doesNotReject(
      async () => {
        resumed = await desktop.request('thread/resume', { threadId, excludeTurns: true });
      },
      'Codex Desktop could not resume a task after Microdex only read its state.',
    );
    assert.equal(resumed.thread.id, threadId);
  } finally {
    microdex.close();
    if (threadId) {
      await desktop.request('thread/unsubscribe', { threadId }).catch(() => {});
      await desktop.request('thread/delete', { threadId }).catch(() => {});
    }
    await fixture.close().catch(() => {});
    await desktop.close();
  }
});
