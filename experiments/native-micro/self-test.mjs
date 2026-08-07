#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { FAKE_DESCRIPTOR, patchModule, patchTopologyWatcher } = require("./shim/patch.cjs");
const preloadPath = fileURLToPath(new URL("./shim/preload.cjs", import.meta.url));
const preloadCheck = spawnSync(
  process.execPath,
  ["-p", "process.env.NODE_OPTIONS ?? 'cleared'"],
  {
    env: {
      ...process.env,
      CODEX_MICRO_PREVIOUS_NODE_OPTIONS: "",
      NODE_OPTIONS: `--require="${preloadPath}"`,
    },
    encoding: "utf8",
  },
);
assert.equal(preloadCheck.status, 0, preloadCheck.stderr);
assert.equal(preloadCheck.stdout.trim(), "cleared", "preload path with spaces was not parsed safely");
const socketPath = path.join(os.tmpdir(), `cm-probe-test-${process.pid}.sock`);
const controlSocketPath = path.join(os.tmpdir(), `cm-probe-control-test-${process.pid}.sock`);
const bridgePath = fileURLToPath(new URL("./bridge.mjs", import.meta.url));
const bridge = spawn(process.execPath, [bridgePath], {
  env: {
    ...process.env,
    NODE_OPTIONS: "",
    CODEX_MICRO_SOCKET: socketPath,
    CODEX_MICRO_CONTROL_SOCKET: controlSocketPath,
    CODEX_MICRO_BATTERY: "42",
  },
  stdio: ["ignore", "pipe", "inherit"],
});

async function waitUntilReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(socketPath) && fs.existsSync(controlSocketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("bridge socket was not created");
}

function encodeRequest(request) {
  const bytes = Buffer.from(JSON.stringify(request), "utf8");
  const reports = [];
  for (let offset = 0; offset < bytes.length; offset += 61) {
    const length = Math.min(61, bytes.length - offset);
    const report = Buffer.alloc(64);
    report[0] = 0x06;
    report[1] = 2;
    report[2] = length;
    bytes.copy(report, 3, offset, offset + length);
    reports.push(report);
  }
  return reports;
}

function deviceLineReader(device) {
  let text = "";
  const queued = [];
  const waiters = [];
  device.on("data", (frame) => {
    if (frame[0] !== 0x06 || frame[1] !== 2) return;
    text += frame.subarray(3, 3 + frame[2]).toString("utf8");
    let newline;
    while ((newline = text.indexOf("\n")) >= 0) {
      const value = JSON.parse(text.slice(0, newline));
      text = text.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value);
      else queued.push(value);
    }
  });
  return {
    next() {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("device line timed out")), 2000);
        waiters.push({
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    },
  };
}

function sendControl(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(controlSocketPath);
    let text = "";
    const timer = setTimeout(() => reject(new Error("control response timed out")), 2000);
    socket.on("connect", () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      resolve(JSON.parse(text.slice(0, newline)));
      socket.end();
    });
    socket.on("error", reject);
  });
}

function socketLineReader(socket) {
  let text = "";
  const queued = [];
  const waiters = [];
  socket.on("data", (chunk) => {
    text += chunk.toString("utf8");
    let newline;
    while ((newline = text.indexOf("\n")) >= 0) {
      const value = JSON.parse(text.slice(0, newline));
      text = text.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value);
      else queued.push(value);
    }
  });
  return {
    next() {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket line timed out")), 2000);
        waiters.push({
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    },
  };
}

try {
  await waitUntilReady();
  const realTopologyWatcher = {
    findCodexMicroInterfaces: () => [{ path: "physical-device", usagePage: 0xff00 }],
    watch: () => ({ dispose() {} }),
  };
  const patchedTopologyWatcher = patchTopologyWatcher(realTopologyWatcher);
  assert.deepEqual(patchedTopologyWatcher.findCodexMicroInterfaces(), [
    { path: "physical-device", usagePage: 0xff00 },
    { ...FAKE_DESCRIPTOR },
  ]);
  assert.equal(typeof patchedTopologyWatcher.watch, "function");

  const realNodeHid = {
    devices: () => [],
    HIDAsync: { open: async () => ({ real: true }) },
  };
  const patched = patchModule(realNodeHid, { socketPath });
  const descriptor = patched.devices().find((device) => device.product === "Codex Micro");
  assert.ok(descriptor, "synthetic Codex Micro should enumerate");
  assert.equal(descriptor.vendorId, 0x303a);
  assert.equal(descriptor.productId, 0x8360);
  assert.equal(descriptor.usagePage, 0xff00);

  const device = await patched.HIDAsync.open(descriptor.path);
  for (let attempt = 0; attempt < 100 && !device.connected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(device.connected, true, "shim should connect to probe bridge");
  const deviceLines = deviceLineReader(device);

  for (const frame of encodeRequest({ method: "device.status", id: 7 })) {
    await device.write(frame);
  }
  const response = await deviceLines.next();
  assert.equal(response.id, 7);
  assert.equal(response.result.battery, 42);
  assert.equal(response.result.version, "1.0.0-phone");

  const status = await sendControl({ type: "status" });
  assert.equal(status.ok, true);
  assert.equal(status.connected, true);

  const lightingSubscriber = net.createConnection(controlSocketPath);
  const hardwareStates = socketLineReader(lightingSubscriber);
  await new Promise((resolve, reject) => {
    lightingSubscriber.once("connect", resolve);
    lightingSubscriber.once("error", reject);
  });
  lightingSubscriber.write(`${JSON.stringify({ type: "lighting.subscribe" })}\n`);
  const initialHardwareState = await hardwareStates.next();
  assert.equal(initialHardwareState.type, "hardware.state");
  assert.equal(initialHardwareState.connected, true);

  const agentPressPromise = deviceLines.next();
  const controlResponse = await sendControl({ type: "agent.tap", slot: 0 });
  assert.equal(controlResponse.ok, true);
  const agentPress = await agentPressPromise;
  assert.deepEqual(agentPress, { m: "v.oai.hid", p: { k: "AG00", act: 1, ag: 0 } });
  const agentRelease = await deviceLines.next();
  assert.deepEqual(agentRelease, { m: "v.oai.hid", p: { k: "AG00", act: 0, ag: 0 } });

  const fastPressPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "action.tap", action: "fast" })).ok, true);
  assert.deepEqual(await fastPressPromise, { m: "v.oai.hid", p: { k: "ACT06", act: 1 } });
  assert.deepEqual(await deviceLines.next(), { m: "v.oai.hid", p: { k: "ACT06", act: 0 } });

  const dialPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "encoder.step", delta: 1 })).ok, true);
  assert.deepEqual(await dialPromise, { m: "v.oai.hid", p: { k: "ENC_CC", act: 2 } });

  const joystickPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "joystick", direction: "up" })).ok, true);
  assert.deepEqual(await joystickPromise, { m: "v.oai.rad", p: { a: 0.75, d: 1 } });
  assert.deepEqual(await deviceLines.next(), { m: "v.oai.rad", p: { a: 0.75, d: 0 } });

  const radialPromise = deviceLines.next();
  assert.equal((await sendControl({
    type: "joystick.radial",
    angle: 0.125,
    distance: 0.8,
  })).ok, true);
  assert.deepEqual(await radialPromise, { m: "v.oai.rad", p: { a: 0.125, d: 0.8 } });

  const microphoneDownPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "microphone.down" })).ok, true);
  assert.deepEqual(await microphoneDownPromise, { m: "v.oai.hid", p: { k: "ACT10", act: 1 } });
  const microphoneUpPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "microphone.up" })).ok, true);
  assert.deepEqual(await microphoneUpPromise, { m: "v.oai.hid", p: { k: "ACT10", act: 0 } });

  const microphoneTapPromise = deviceLines.next();
  assert.equal((await sendControl({ type: "action.tap", action: "mic" })).ok, true);
  assert.deepEqual(await microphoneTapPromise, { m: "v.oai.hid", p: { k: "ACT10", act: 1 } });
  assert.deepEqual(await deviceLines.next(), { m: "v.oai.hid", p: { k: "ACT10", act: 0 } });

  for (const frame of encodeRequest({
    method: "v.oai.thstatus",
    params: [{ id: 0, c: 0x00ff4c, e: 1, m: 0 }],
    id: 8,
  })) {
    await device.write(frame);
  }
  const pushedLighting = await hardwareStates.next();
  assert.equal(pushedLighting.connected, true);
  assert.deepEqual(pushedLighting.lighting.threads, [
    { id: 0, color: 0x00ff4c, enabled: 1, effect: 0 },
  ]);
  const lightingResponse = await deviceLines.next();
  assert.equal(lightingResponse.id, 8);
  assert.equal(lightingResponse.result, true);
  const lightingStatus = await sendControl({ type: "status" });
  assert.deepEqual(lightingStatus.lighting.threads, [
    { id: 0, color: 0x00ff4c, enabled: 1, effect: 0 },
  ]);

  await device.close();
  lightingSubscriber.end();
  process.stdout.write(
    "PASS: detection, connection, key, dial, mic, and pushed lighting round-tripped.\n",
  );
} finally {
  bridge.kill("SIGTERM");
  for (const candidate of [socketPath, controlSocketPath]) {
    try {
      fs.unlinkSync(candidate);
    } catch {
      // Already removed by the bridge.
    }
  }
}

