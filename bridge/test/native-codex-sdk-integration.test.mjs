import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const {
  FAKE_DESCRIPTOR,
  patchModule,
} = require('../native-shim/shim/patch.cjs');

const APP_ASAR = '/Applications/ChatGPT.app/Contents/Resources/app.asar';
const SDK_BUNDLE =
  'node_modules/@worklouder/device-kit-oai/node_modules/' +
  '@worklouder/wl-device-kit/dist/index.js';

function findFile(root, suffix) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (candidate.endsWith(suffix)) return candidate;
    }
  }
  return null;
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function sendControl(socketPath, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let text = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('control response timed out'));
    }, 2000);
    socket.on('connect', () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      resolve(JSON.parse(text.slice(0, newline)));
      socket.end();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test('the exact Codex Work Louder SDK receives synthetic hardware actions', async () => {
  assert.equal(
    fs.existsSync(APP_ASAR),
    true,
    'the installed Codex app bundle is required for this integration test',
  );

  const asarModulePath = findFile(
    path.join(os.homedir(), '.npm', '_npx'),
    path.join('@electron', 'asar', 'lib', 'asar.js'),
  );
  assert.ok(asarModulePath, 'could not locate the local @electron/asar reader');

  const asar = require(asarModulePath);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'microdex-real-sdk-'),
  );
  const extractedSdkPath = path.join(temporaryDirectory, 'wl-device-kit.cjs');
  fs.writeFileSync(
    extractedSdkPath,
    asar.extractFile(APP_ASAR, SDK_BUNDLE),
  );

  const socketPath = path.join(
    os.tmpdir(),
    `microdex-real-sdk-device-${process.pid}.sock`,
  );
  const controlSocketPath = path.join(
    os.tmpdir(),
    `microdex-real-sdk-control-${process.pid}.sock`,
  );
  const bridgePath = fileURLToPath(
    new URL('../native-shim/bridge.mjs', import.meta.url),
  );
  const bridge = spawn(process.execPath, [bridgePath], {
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      CODEX_MICRO_SOCKET: socketPath,
      CODEX_MICRO_CONTROL_SOCKET: controlSocketPath,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const realNodeHid = {
    devices: () => [],
    devicesAsync: async () => [],
    HIDAsync: {
      async open() {
        throw new Error('the real HID device must not be opened by this test');
      },
    },
  };
  const patchedNodeHid = patchModule(realNodeHid, { socketPath });
  const originalLoad = Module._load;
  Module._load = function loadRealSdkWithTestTransports(
    request,
    parent,
    isMain,
  ) {
    if (request === 'node-hid') return patchedNodeHid;
    if (request === 'serialport') {
      return {
        SerialPort: class SerialPort {},
        DelimiterParser: class DelimiterParser {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let communication;
  try {
    await waitFor(
      () => fs.existsSync(socketPath) && fs.existsSync(controlSocketPath),
      'native bridge sockets were not created',
    );

    const { WLDeviceCommImpl } = require(extractedSdkPath);
    communication = new WLDeviceCommImpl();
    assert.equal(
      await communication.connect({
        connectionType: 1,
        portPath: FAKE_DESCRIPTOR.path,
      }),
      true,
    );

    await waitFor(
      async () => {
        try {
          return (await sendControl(controlSocketPath, { type: 'status' }))
            .connected;
        } catch {
          return false;
        }
      },
      'the official SDK did not open the synthetic Codex Micro',
    );

    const received = [];
    communication.addNotifyHandler('v.oai.hid', (payload) => {
      received.push(payload);
    });

    const response = await sendControl(controlSocketPath, {
      type: 'action.tap',
      action: 'fast',
    });
    assert.equal(response.ok, true);
    await waitFor(
      () => received.length === 2,
      'the official SDK did not parse the synthetic key action',
    );
    assert.deepEqual(received, [
      { k: 'ACT06', act: 1 },
      { k: 'ACT06', act: 0 },
    ]);
  } finally {
    Module._load = originalLoad;
    await communication?.disconnect?.();
    bridge.kill('SIGTERM');
    for (const candidate of [socketPath, controlSocketPath]) {
      try {
        fs.unlinkSync(candidate);
      } catch {
        // Already cleaned up.
      }
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
