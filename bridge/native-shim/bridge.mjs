#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const REPORT_ID = 0x06;
const REPORT_SIZE = 64;
const RPC_CHANNEL = 2;
const MAX_PAYLOAD = 61;
const configuredBattery = Number(process.env.CODEX_MICRO_BATTERY ?? "100");
const BATTERY_PERCENT = Number.isFinite(configuredBattery)
  ? Math.max(0, Math.min(100, Math.round(configuredBattery)))
  : 100;

const socketPath =
  process.env.CODEX_MICRO_SOCKET ||
  path.join(os.tmpdir(), `codex-micro-phone-${process.getuid()}`, "device.sock");
const controlSocketPath =
  process.env.CODEX_MICRO_CONTROL_SOCKET ||
  path.join(path.dirname(socketPath), "control.sock");

let client = null;
let rx = Buffer.alloc(0);
let rpcBuffer = "";
let lastLighting = { rgb: null, threads: null };
const lightingSubscribers = new Set();

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  process.stdout.write(`${line}\n`);
}

function extractJsonObjects(input) {
  const objects = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let lastEnd = 0;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(input.slice(start, index + 1));
        lastEnd = index + 1;
        start = -1;
      }
    }
  }

  return {
    objects,
    rest: depth > 0 && start >= 0 ? input.slice(start) : input.slice(lastEnd),
  };
}

function encode(message) {
  const bytes = Buffer.from(message, "utf8");
  const reports = [];
  let offset = 0;

  do {
    const length = Math.min(MAX_PAYLOAD, bytes.length - offset);
    const report = Buffer.alloc(REPORT_SIZE);
    report[0] = REPORT_ID;
    report[1] = RPC_CHANNEL;
    report[2] = length;
    bytes.copy(report, 3, offset, offset + length);
    reports.push(report);
    offset += length;
  } while (offset < bytes.length);

  return reports;
}

function send(id, result) {
  if (!client || client.destroyed) return;
  const response = `${JSON.stringify({ id: Number(id), result })}\n`;
  for (const report of encode(response)) client.write(report);
}

function sendNotification(method, params) {
  if (!client || client.destroyed) {
    throw new Error("Codex has not opened the synthetic device");
  }
  const notification = `${JSON.stringify({ m: method, p: params })}\n`;
  for (const report of encode(notification)) client.write(report);
}

function tapKey(key, agent = null) {
  const press = { k: key, act: 1 };
  const release = { k: key, act: 0 };
  if (agent !== null) {
    press.ag = agent;
    release.ag = agent;
  }
  sendNotification("v.oai.hid", press);
  sendNotification("v.oai.hid", release);
}

function lightingSummary(method, params) {
  if (method === "v.oai.rgbcfg") {
    return {
      keys: params?.keys ?? null,
      ambient: params?.ambient ?? null,
    };
  }
  if (method === "v.oai.thstatus") {
    const entries = Array.isArray(params) ? params : [];
    return entries.map((entry) => ({
      id: entry?.id ?? null,
      color: entry?.c ?? null,
      enabled: entry?.e ?? null,
      effect: entry?.m ?? null,
    }));
  }
  return null;
}

function hardwareState() {
  return {
    connected: Boolean(client && !client.destroyed),
    battery: BATTERY_PERCENT,
    lighting: lastLighting,
  };
}

function broadcastHardwareState() {
  const event = `${JSON.stringify({ ok: true, type: "hardware.state", ...hardwareState() })}\n`;
  for (const socket of lightingSubscribers) {
    if (socket.destroyed) {
      lightingSubscribers.delete(socket);
      continue;
    }
    socket.write(event, (error) => {
      if (error) lightingSubscribers.delete(socket);
    });
  }
}

function handleRequest(raw) {
  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    log(`IGNORED invalid JSON: ${error.message}`);
    return;
  }

  const id = request.id ?? request.i;
  const method = request.method ?? request.m ?? "unknown";
  log(`REQUEST ${method}${id === undefined ? " (notification)" : ` id=${id}`}`);
  if (id === undefined) return;

  if (method === "v.oai.rgbcfg") {
    lastLighting.rgb = lightingSummary(method, request.params ?? request.p);
    log(`LIGHTING rgb ${JSON.stringify(lastLighting.rgb)}`);
    broadcastHardwareState();
  } else if (method === "v.oai.thstatus") {
    lastLighting.threads = lightingSummary(method, request.params ?? request.p);
    log(`LIGHTING threads ${JSON.stringify(lastLighting.threads)}`);
    broadcastHardwareState();
  }

  if (method === "device.status") {
    send(id, {
      version: "1.0.0-phone",
      profile_index: 0,
      layer_index: 0,
      battery: BATTERY_PERCENT,
      is_charging: false,
    });
    return;
  }

  if (method === "sys.version") {
    send(id, "1.0.0-phone");
    return;
  }

  // Acknowledge lighting and any future request so Codex's serialized RPC
  // queue never gets stuck waiting for this disposable probe.
  send(id, true);
}

function consumeFrame(frame) {
  const hasReportID = frame[0] === REPORT_ID;
  const channelIndex = hasReportID ? 1 : 0;
  const lengthIndex = hasReportID ? 2 : 1;
  const payloadIndex = hasReportID ? 3 : 2;
  const channel = frame[channelIndex];
  const length = frame[lengthIndex];
  if (channel !== RPC_CHANNEL || length > MAX_PAYLOAD) return;

  rpcBuffer += frame.subarray(payloadIndex, payloadIndex + length).toString("utf8");
  const extracted = extractJsonObjects(rpcBuffer);
  rpcBuffer = extracted.rest;
  for (const object of extracted.objects) handleRequest(object);
}

try {
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
} catch {
  // The listen call below will report a useful error if cleanup failed.
}

const deviceServer = net.createServer((socket) => {
  if (client && !client.destroyed) client.destroy();
  client = socket;
  rx = Buffer.alloc(0);
  rpcBuffer = "";
  log("SHIM CONNECTED — Codex opened the synthetic device");
  broadcastHardwareState();

  socket.on("data", (chunk) => {
    rx = Buffer.concat([rx, chunk]);
    while (rx.length >= REPORT_SIZE) {
      const frame = Buffer.from(rx.subarray(0, REPORT_SIZE));
      rx = rx.subarray(REPORT_SIZE);
      consumeFrame(frame);
    }
  });
  socket.on("error", (error) => log(`SHIM SOCKET ERROR ${error.message}`));
  socket.on("close", () => {
    if (client === socket) client = null;
    log("SHIM DISCONNECTED");
    broadcastHardwareState();
  });
});

deviceServer.on("error", (error) => {
  log(`BRIDGE ERROR ${error.stack || error.message}`);
  process.exitCode = 1;
});

const ACTION_KEYS = Object.freeze({
  fast: "ACT06",
  approve: "ACT07",
  reject: "ACT08",
  split: "ACT09",
  mic: "ACT10",
  send: "ACT12",
});

const JOYSTICK_ANGLES = Object.freeze({
  // Codex's radial protocol is rotated 90 degrees clockwise relative to the
  // phone control's visual axes. Compensate here so the UI remains literal.
  up: 0.75,
  right: 0,
  down: 0.25,
  left: 0.5,
});

function performControl(command) {
  switch (command.type) {
    case "status":
      return hardwareState();
    case "agent.tap": {
      const slot = Number(command.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("agent slot must be 0 through 5");
      }
      tapKey(`AG0${slot}`, slot);
      return { sent: `agent ${slot + 1}` };
    }
    case "action.tap": {
      const key = ACTION_KEYS[command.action];
      if (!key) throw new Error("unknown action key");
      tapKey(key);
      return { sent: command.action };
    }
    case "microphone.down":
      sendNotification("v.oai.hid", { k: "ACT10", act: 1 });
      return { sent: "microphone down" };
    case "microphone.up":
      sendNotification("v.oai.hid", { k: "ACT10", act: 0 });
      return { sent: "microphone up" };
    case "encoder.step": {
      const delta = Number(command.delta);
      if (delta !== -1 && delta !== 1) throw new Error("encoder delta must be -1 or 1");
      // Codex names the encoder directions from the device's underside. Swap
      // them so a clockwise phone gesture moves the active control right.
      sendNotification("v.oai.hid", { k: delta > 0 ? "ENC_CC" : "ENC_CW", act: 2 });
      return { sent: delta > 0 ? "encoder clockwise" : "encoder counter-clockwise" };
    }
    case "encoder.click":
      tapKey("ENC_CLK");
      return { sent: "encoder click" };
    case "joystick": {
      const angle = JOYSTICK_ANGLES[command.direction];
      if (angle === undefined) throw new Error("joystick direction is invalid");
      sendNotification("v.oai.rad", { a: angle, d: 1 });
      setTimeout(() => {
        try {
          sendNotification("v.oai.rad", { a: angle, d: 0 });
        } catch {
          // The probe may have stopped during the spring-back delay.
        }
      }, 80);
      return { sent: `joystick ${command.direction}` };
    }
    case "joystick.radial": {
      const angle = Number(command.angle);
      const distance = Number(command.distance);
      if (!Number.isFinite(angle) || angle < 0 || angle >= 1) {
        throw new Error("joystick angle must be from 0 up to 1");
      }
      if (!Number.isFinite(distance) || distance < 0 || distance > 1) {
        throw new Error("joystick distance must be from 0 through 1");
      }
      sendNotification("v.oai.rad", { a: angle, d: distance });
      return { sent: "joystick radial" };
    }
    default:
      throw new Error("unknown shim command");
  }
}

const controlServer = net.createServer((socket) => {
  let input = "";
  socket.on("data", (chunk) => {
    input += chunk.toString("utf8");
    let newline;
    while ((newline = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, newline).trim();
      input = input.slice(newline + 1);
      if (!line) continue;
      try {
        const command = JSON.parse(line);
        if (command.type === "lighting.subscribe") {
          lightingSubscribers.add(socket);
          socket.write(`${JSON.stringify({ ok: true, type: "hardware.state", ...hardwareState() })}\n`);
          log("CONTROL lighting subscriber connected");
          continue;
        }
        const result = performControl(command);
        log(`CONTROL ${command.type} ${JSON.stringify(result)}`);
        socket.write(`${JSON.stringify({ ok: true, ...result })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "shim command failed";
        log(`CONTROL ERROR ${message}`);
        socket.write(`${JSON.stringify({ ok: false, message })}\n`);
      }
    }
  });
  socket.on("close", () => lightingSubscribers.delete(socket));
  socket.on("error", () => lightingSubscribers.delete(socket));
});

controlServer.on("error", (error) => {
  log(`CONTROL ERROR ${error.stack || error.message}`);
  process.exitCode = 1;
});

try {
  if (fs.existsSync(controlSocketPath)) fs.unlinkSync(controlSocketPath);
} catch {
  // The listen call below will report a useful error if cleanup failed.
}

controlServer.listen(controlSocketPath, () => {
  deviceServer.listen(socketPath, () => {
    log(`READY ${socketPath}`);
    log(`CONTROL READY ${controlSocketPath}`);
    log(`DEVICE BATTERY ${BATTERY_PERCENT}%`);
  });
});

function shutdown() {
  try {
    client?.destroy();
    deviceServer.close();
    controlServer.close();
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    if (fs.existsSync(controlSocketPath)) fs.unlinkSync(controlSocketPath);
  } finally {
    process.exit();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

