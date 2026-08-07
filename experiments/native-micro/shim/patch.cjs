// node-hid shim used by the optional Codex Micro hardware-emulation mode.
// Adapted from Marcel Pociot's MIT-licensed codex-micro-stream-deck-emulator.

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const REPORT_SIZE = 64;
const FAKE_PATH = "codex-micro-phone-shim";
const FAKE_DESCRIPTOR = Object.freeze({
  vendorId: 0x303a,
  productId: 0x8360,
  path: FAKE_PATH,
  serialNumber: "codex-micro-phone-shim",
  manufacturer: "Work Louder",
  product: "Codex Micro",
  release: 0x0100,
  interface: 0,
  usagePage: 0xff00,
  usage: 0x01,
});

function defaultSocketPath() {
  return (
    process.env.CODEX_MICRO_SOCKET ||
    path.join(os.tmpdir(), `codex-micro-phone-${process.getuid()}`, "device.sock")
  );
}

function log(message) {
  const logPath = process.env.CODEX_MICRO_SHIM_LOG;
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never interfere with Codex.
  }
}

function toFrame(data) {
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (source.length === REPORT_SIZE) return source;
  const frame = Buffer.alloc(REPORT_SIZE);
  source.copy(frame, 0, 0, Math.min(source.length, REPORT_SIZE));
  return frame;
}

class FakeHIDAsync extends EventEmitter {
  constructor(socketPath) {
    super();
    this.socketPath = socketPath;
    this.socket = null;
    this.connected = false;
    this.receiveBuffer = Buffer.alloc(0);
    this.pendingFrames = [];
    this.connect();
  }

  connect() {
    const socket = net.createConnection(this.socketPath);
    this.socket = socket;

    socket.on("connect", () => {
      this.connected = true;
      log(`connected to probe bridge at ${this.socketPath}`);
      for (const frame of this.pendingFrames) socket.write(frame);
      this.pendingFrames = [];
    });
    socket.on("data", (chunk) => {
      this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
      while (this.receiveBuffer.length >= REPORT_SIZE) {
        const frame = Buffer.from(this.receiveBuffer.subarray(0, REPORT_SIZE));
        this.receiveBuffer = this.receiveBuffer.subarray(REPORT_SIZE);
        this.emit("data", frame);
      }
    });
    socket.on("error", (error) => {
      log(`socket error: ${error.message}`);
      if (this.listenerCount("error") > 0) this.emit("error", error);
    });
    socket.on("close", () => {
      this.connected = false;
      this.emit("close");
    });
  }

  write(data) {
    const frame = toFrame(data);
    if (this.connected && this.socket) this.socket.write(frame);
    else this.pendingFrames.push(frame);
    return Promise.resolve(frame.length);
  }

  read(timeout) {
    return new Promise((resolve) => {
      const onData = (buffer) => {
        if (timer) clearTimeout(timer);
        resolve(buffer);
      };
      const timer = timeout
        ? setTimeout(() => {
            this.off("data", onData);
            resolve(Buffer.alloc(0));
          }, timeout)
        : null;
      this.once("data", onData);
    });
  }

  getDeviceInfo() {
    return { ...FAKE_DESCRIPTOR };
  }

  sendFeatureReport() {
    return Promise.resolve(0);
  }

  getFeatureReport() {
    return Promise.resolve(Buffer.alloc(0));
  }

  setNonBlocking() {}
  pause() {}
  resume() {}

  close() {
    try {
      this.socket?.end();
    } catch {
      // Best-effort shim cleanup.
    }
    return Promise.resolve();
  }
}

function isFakeOpen(openPath, maybeProductID) {
  return (
    openPath === FAKE_PATH ||
    (typeof openPath === "string" && openPath.includes(FAKE_PATH)) ||
    (openPath === FAKE_DESCRIPTOR.vendorId && maybeProductID === FAKE_DESCRIPTOR.productId)
  );
}

function patchModule(real, options = {}) {
  const socketPath = options.socketPath || defaultSocketPath();
  const patched = Object.create(real);

  patched.devices = function patchedDevices(...args) {
    let devices = [];
    try {
      devices = real.devices(...args) || [];
    } catch {
      // A real HID enumeration error must not hide the probe device.
    }
    return devices.concat([{ ...FAKE_DESCRIPTOR }]);
  };

  if (typeof real.devicesAsync === "function") {
    patched.devicesAsync = async function patchedDevicesAsync(...args) {
      let devices = [];
      try {
        devices = (await real.devicesAsync(...args)) || [];
      } catch {
        // A real HID enumeration error must not hide the probe device.
      }
      return devices.concat([{ ...FAKE_DESCRIPTOR }]);
    };
  }

  const RealAsync = real.HIDAsync;
  if (RealAsync) {
    patched.HIDAsync = new Proxy(RealAsync, {
      get(target, property, receiver) {
        if (property === "open") {
          return (...args) =>
            isFakeOpen(args[0], args[1])
              ? Promise.resolve(new FakeHIDAsync(socketPath))
              : Reflect.apply(RealAsync.open, RealAsync, args);
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  log("node-hid patched; synthetic Codex Micro advertised");
  return patched;
}

function mergeSyntheticInterface(interfaces) {
  const discovered = Array.isArray(interfaces) ? interfaces : [];
  if (discovered.some((entry) => entry?.path === FAKE_PATH)) return discovered;
  return discovered.concat([{ ...FAKE_DESCRIPTOR }]);
}

function patchTopologyWatcher(real) {
  const patched = new Proxy(real, {
    get(target, property) {
      if (property === "findCodexMicroInterfaces") {
        return (...args) => {
          let discovered = [];
          try {
            discovered = Reflect.apply(target.findCodexMicroInterfaces, target, args);
          } catch {
            // Native discovery failure must not hide the synthetic device.
          }
          if (discovered && typeof discovered.then === "function") {
            return discovered.then(mergeSyntheticInterface, () => mergeSyntheticInterface([]));
          }
          return mergeSyntheticInterface(discovered);
        };
      }
      return Reflect.get(target, property, target);
    },
  });

  log("HID topology watcher patched; synthetic Codex Micro discoverable");
  return patched;
}

function looksLikeNodeHid(request, moduleValue) {
  if (typeof request === "string" && /(^|[\\/])node-hid($|[\\/.])/.test(request)) return true;
  return Boolean(
    moduleValue && typeof moduleValue.devices === "function" && moduleValue.HIDAsync,
  );
}

function looksLikeTopologyWatcher(request, moduleValue) {
  return Boolean(
    (typeof request === "string" &&
      /hid[-_]topology[-_]watcher(?:-addon)?(?:\.node)?$/i.test(request)) ||
      (moduleValue &&
        typeof moduleValue.findCodexMicroInterfaces === "function" &&
        typeof moduleValue.watch === "function"),
  );
}

function installHook(options = {}) {
  const Module = require("node:module");
  const originalLoad = Module._load;
  const patchedNodeHidCache = new WeakMap();
  const patchedTopologyCache = new WeakMap();

  Module._load = function loadWithProbe(request, parent, isMain) {
    const moduleValue = originalLoad.apply(this, arguments);
    if (looksLikeTopologyWatcher(request, moduleValue)) {
      if (!patchedTopologyCache.has(moduleValue)) {
        patchedTopologyCache.set(moduleValue, patchTopologyWatcher(moduleValue));
      }
      return patchedTopologyCache.get(moduleValue);
    }
    if (!looksLikeNodeHid(request, moduleValue)) return moduleValue;
    if (!patchedNodeHidCache.has(moduleValue)) {
      patchedNodeHidCache.set(moduleValue, patchModule(moduleValue, options));
    }
    return patchedNodeHidCache.get(moduleValue);
  };

  log(`hook installed; socket=${options.socketPath || defaultSocketPath()}`);
}

module.exports = {
  FAKE_DESCRIPTOR,
  FakeHIDAsync,
  patchModule,
  patchTopologyWatcher,
  installHook,
  defaultSocketPath,
};

