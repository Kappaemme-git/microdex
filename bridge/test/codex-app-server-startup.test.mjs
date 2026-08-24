import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexAppServer } from '../lib/codex-app-server.mjs';

async function waitForFile(filePath, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

test('the bridge waits for a slow Codex App Server to become ready', { timeout: 12_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-app-server-'));
  const fakeCodexPath = path.join(tempDir, 'fake-codex.mjs');
  const listeningMarker = path.join(tempDir, 'listening.txt');
  const wsModuleUrl = import.meta.resolve('ws');
  const previousCodexBin = process.env.MICRODEX_CODEX_BIN;
  const previousMarker = process.env.MICRODEX_TEST_LISTENING_MARKER;

  const fakeCodex = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { WebSocketServer } from ${JSON.stringify(wsModuleUrl)};

const listenUrl = new URL(process.argv.at(-1));
const marker = process.env.MICRODEX_TEST_LISTENING_MARKER;
let server;

const startupTimer = setTimeout(() => {
  server = new WebSocketServer({
    host: listenUrl.hostname,
    port: Number(listenUrl.port),
  });
  server.once('listening', () => appendFileSync(marker, 'listening\\n'));
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.method === 'initialize') {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      }
    });
  });
}, 4_500);

function shutdown() {
  clearTimeout(startupTimer);
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

  await writeFile(fakeCodexPath, fakeCodex);
  await chmod(fakeCodexPath, 0o755);
  process.env.MICRODEX_CODEX_BIN = fakeCodexPath;
  process.env.MICRODEX_TEST_LISTENING_MARKER = listeningMarker;

  const client = new CodexAppServer();
  try {
    await client.ready();
    assert.match(await waitForFile(listeningMarker), /listening/);
  } finally {
    client.close();
    if (previousCodexBin === undefined) delete process.env.MICRODEX_CODEX_BIN;
    else process.env.MICRODEX_CODEX_BIN = previousCodexBin;
    if (previousMarker === undefined) delete process.env.MICRODEX_TEST_LISTENING_MARKER;
    else process.env.MICRODEX_TEST_LISTENING_MARKER = previousMarker;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('the bridge retries after the Codex App Server exits during startup', { timeout: 8_000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'microdex-app-server-retry-'));
  const fakeCodexPath = path.join(tempDir, 'fake-codex.mjs');
  const attemptsPath = path.join(tempDir, 'attempts.txt');
  const wsModuleUrl = import.meta.resolve('ws');
  const previousCodexBin = process.env.MICRODEX_CODEX_BIN;
  const previousAttempts = process.env.MICRODEX_TEST_ATTEMPTS_FILE;

  const fakeCodex = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer } from ${JSON.stringify(wsModuleUrl)};

const attemptsFile = process.env.MICRODEX_TEST_ATTEMPTS_FILE;
let attempts = 0;
try { attempts = Number(readFileSync(attemptsFile, 'utf8')); } catch {}
attempts += 1;
writeFileSync(attemptsFile, String(attempts));

if (attempts === 1) {
  setTimeout(() => process.exit(23), 25);
} else {
  const listenUrl = new URL(process.argv.at(-1));
  const server = new WebSocketServer({
    host: listenUrl.hostname,
    port: Number(listenUrl.port),
  });
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.method === 'initialize') {
        socket.send(JSON.stringify({ id: message.id, result: {} }));
      }
    });
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
`;

  await writeFile(fakeCodexPath, fakeCodex);
  await chmod(fakeCodexPath, 0o755);
  process.env.MICRODEX_CODEX_BIN = fakeCodexPath;
  process.env.MICRODEX_TEST_ATTEMPTS_FILE = attemptsPath;

  const client = new CodexAppServer();
  try {
    await assert.rejects(
      client.ready(),
      /Codex App Server exited before becoming ready \(code 23\)\./,
    );
    await client.ready();
    assert.equal(await readFile(attemptsPath, 'utf8'), '2');
  } finally {
    client.close();
    if (previousCodexBin === undefined) delete process.env.MICRODEX_CODEX_BIN;
    else process.env.MICRODEX_CODEX_BIN = previousCodexBin;
    if (previousAttempts === undefined) delete process.env.MICRODEX_TEST_ATTEMPTS_FILE;
    else process.env.MICRODEX_TEST_ATTEMPTS_FILE = previousAttempts;
    await rm(tempDir, { recursive: true, force: true });
  }
});
