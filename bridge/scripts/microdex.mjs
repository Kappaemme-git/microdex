#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import {
  printCheck,
  printFailure,
  printHeader,
  printQr,
  printStep,
  printWarning,
  ui,
} from '../lib/terminal-ui.mjs';
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_VERSION,
} from '../lib/package-info.mjs';
import { retryOperation } from '../lib/retry-operation.mjs';
import {
  nativeShimPaths,
  requestNativeShim,
} from '../lib/native-shim-client.mjs';

const VERSION = BRIDGE_VERSION;
const DEFAULT_PORT = 3210;
const stateDir = process.env.MICRODEX_HOME || path.join(os.homedir(), '.microdex');
const tokenPath = path.join(stateDir, 'access-token');
const runtimeDir = path.join(stateDir, 'runtime');
const runtimeCliPath = path.join(
  runtimeDir,
  'node_modules',
  'microdex-cli',
  'bridge',
  'scripts',
  'microdex.mjs',
);
const logsDir = path.join(stateDir, 'logs');
const launchAgentLabel = process.env.MICRODEX_LAUNCH_AGENT_LABEL || 'cc.microdex.bridge';
const launchAgentsDir =
  process.env.MICRODEX_LAUNCH_AGENTS_DIR ||
  path.join(os.homedir(), 'Library', 'LaunchAgents');
const launchAgentPath = path.join(launchAgentsDir, `${launchAgentLabel}.plist`);
const launchDomain = `gui/${process.getuid?.() ?? 0}`;
const codexBinary =
  process.env.MICRODEX_CODEX_BIN ||
  '/Applications/ChatGPT.app/Contents/Resources/codex';
const codexDesktopApp = process.env.MICRODEX_CODEX_APP || '/Applications/ChatGPT.app';
const nativePaths = nativeShimPaths(stateDir);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const nativeBridgePath = path.resolve(
  scriptDir,
  '../native-shim/bridge.mjs',
);
const nativePreloadPath = path.resolve(
  scriptDir,
  '../native-shim/shim/preload.cjs',
);
const nativeSelfTestPath = path.resolve(
  scriptDir,
  '../native-shim/self-test.mjs',
);

function printHelp() {
  printHeader(VERSION);
  console.log(`
  ${ui.bold('Usage')}
    microdex setup      Install the background bridge and pair
    microdex pair       Show a fresh pairing QR
    microdex status     Check the background bridge
    microdex restart    Restart the background bridge
    microdex native     Relaunch Codex with real Micro input + lighting
    microdex native status|stop|test
    microdex uninstall  Remove the background service
    microdex up         Run the bridge in this Terminal
    microdex doctor     Check this Mac before pairing
    microdex help       Show this help

  ${ui.bold('Quick start')}
    npx microdex-cli@latest setup
`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function persistentToken() {
  if (process.env.MICRODEX_TOKEN?.trim()) return process.env.MICRODEX_TOKEN.trim();

  try {
    const saved = (await readFile(tokenPath, 'utf8')).trim();
    if (saved.length >= 24) return saved;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const token = randomBytes(32).toString('base64url');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function run(command, args, { allowFailure = false, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (!inherit) {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(result.stderr || result.stdout || `${command} exited with code ${code}`));
    });
  });
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function launchAgentPlist() {
  const port = String(process.env.MICRODEX_PORT || DEFAULT_PORT);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(launchAgentLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(runtimeCliPath)}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MICRODEX_BACKGROUND</key>
    <string>1</string>
    <key>MICRODEX_HOME</key>
    <string>${xml(stateDir)}</string>
    <key>MICRODEX_PORT</key>
    <string>${xml(port)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(os.homedir())}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xml(path.join(logsDir, 'bridge.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(logsDir, 'bridge-error.log'))}</string>
</dict>
</plist>
`;
}

async function bridgeHealth(timeoutMs = 1_500) {
  return Boolean(await bridgeHealthDetails(timeoutMs));
}

async function bridgeHealthDetails(timeoutMs = 1_500) {
  const port = Number(process.env.MICRODEX_PORT || DEFAULT_PORT);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function bridgeMatchesCurrentRuntime(health) {
  return Boolean(
    health &&
    health.version === VERSION &&
    health.protocolVersion === BRIDGE_PROTOCOL_VERSION,
  );
}

async function waitForBridge(maxWaitMs = 15_000) {
  const startedAt = Date.now();
  let mismatchStartedAt = null;
  while (Date.now() - startedAt < maxWaitMs) {
    const health = await bridgeHealthDetails(750);
    if (bridgeMatchesCurrentRuntime(health)) return true;
    if (health) {
      mismatchStartedAt ??= Date.now();
      // Give a registered old service a moment to leave the port during an
      // update, but never mistake a persistent stale process for the runtime
      // that setup just installed.
      if (Date.now() - mismatchStartedAt >= 1_500) return false;
    } else {
      mismatchStartedAt = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(filePath) {
  try {
    const pid = Number((await readFile(filePath, 'utf8')).trim());
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await exists(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

async function stopNativeSidecar() {
  const bridgePid = await readPid(nativePaths.bridgePid);
  if (processIsRunning(bridgePid)) {
    process.kill(bridgePid, 'SIGTERM');
    for (let attempt = 0; attempt < 50 && processIsRunning(bridgePid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  await Promise.all([
    rm(nativePaths.deviceSocket, { force: true }),
    rm(nativePaths.controlSocket, { force: true }),
    rm(nativePaths.bridgePid, { force: true }),
    rm(nativePaths.codexPid, { force: true }),
  ]);
}

function codexDesktopExecutable() {
  const result = spawnSync(
    'defaults',
    ['read', path.join(codexDesktopApp, 'Contents', 'Info'), 'CFBundleExecutable'],
    { encoding: 'utf8', timeout: 5_000 },
  );
  const executableName = result.status === 0 ? result.stdout.trim() : '';
  if (!executableName) return null;
  return {
    executableName,
    path: path.join(codexDesktopApp, 'Contents', 'MacOS', executableName),
  };
}

async function waitForNativeConnection(timeoutMs = 18_000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      latest = await requestNativeShim(
        { type: 'status' },
        { socketPath: nativePaths.controlSocket, timeoutMs: 750 },
      );
      if (latest.connected) return latest;
    } catch {
      // The native bridge or Codex may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  return latest;
}

async function relaunchCodexNormally() {
  await run('osascript', ['-e', 'tell application id "com.openai.codex" to quit'], {
    allowFailure: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await run('open', [codexDesktopApp], { allowFailure: true });
}

async function nativeMode() {
  const operation = (process.argv[3] || 'start').toLowerCase();
  if (operation === 'test') {
    printHeader(VERSION);
    const result = await run(process.execPath, [nativeSelfTestPath], {
      inherit: true,
      allowFailure: true,
    });
    if (result.code) process.exitCode = result.code;
    return;
  }
  if (operation === 'status') {
    printHeader(VERSION);
    try {
      const state = await requestNativeShim(
        { type: 'status' },
        { socketPath: nativePaths.controlSocket },
      );
      if (state.connected) printCheck('Native Micro', 'Connected inside Codex');
      else printWarning('Native bridge online', 'Codex has not opened the synthetic Micro');
    } catch {
      printFailure('Native Micro is not running');
      process.exitCode = 1;
    }
    return;
  }
  if (operation === 'stop') {
    printHeader(VERSION);
    await stopNativeSidecar();
    await relaunchCodexNormally();
    printCheck('Native Micro stopped', 'Codex reopened normally');
    return;
  }
  if (!['start', 'up'].includes(operation)) {
    throw new Error('Use microdex native, native status, native stop, or native test.');
  }
  if (process.platform !== 'darwin') {
    throw new Error('Native Micro currently requires macOS.');
  }
  if (!await exists(codexDesktopApp)) {
    throw new Error(`Codex desktop was not found at ${codexDesktopApp}.`);
  }
  if (!await bridgeHealth()) {
    throw new Error('Run “microdex setup” first so the paired phone bridge stays online.');
  }
  const desktop = codexDesktopExecutable();
  if (!desktop || !await exists(desktop.path)) {
    throw new Error('Could not find the Codex desktop executable.');
  }

  printHeader(VERSION);
  console.log(`  ${ui.bold('Native Micro mode')}\n`);
  console.log(`  ${ui.dim('Codex will close and reopen once. App files are not modified.')}`);
  console.log(`  ${ui.dim('The phone will then use Codex’s own hardware input and lighting channel.')}\n`);
  if (process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question('  Continue? [Y/n] ')).trim().toLowerCase();
    prompt.close();
    if (answer && answer !== 'y' && answer !== 'yes') {
      printWarning('Native mode cancelled');
      return;
    }
  } else if (!process.argv.includes('--yes')) {
    throw new Error('Native mode relaunches Codex. Run it in Terminal to confirm.');
  }

  printStep(1, 'Starting the private hardware channel');
  await mkdir(nativePaths.directory, { recursive: true, mode: 0o700 });
  await stopNativeSidecar();
  const bridge = spawn(process.execPath, [nativeBridgePath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      CODEX_MICRO_SOCKET: nativePaths.deviceSocket,
      CODEX_MICRO_CONTROL_SOCKET: nativePaths.controlSocket,
      CODEX_MICRO_BATTERY: '100',
    },
  });
  bridge.unref();
  await writeFile(nativePaths.bridgePid, `${bridge.pid}\n`, { mode: 0o600 });
  if (
    !await waitForFile(nativePaths.deviceSocket) ||
    !await waitForFile(nativePaths.controlSocket)
  ) {
    await stopNativeSidecar();
    throw new Error('The private hardware channel did not start.');
  }
  printCheck('Hardware channel', 'Ready');

  printStep(2, 'Relaunching Codex with the Micro attached');
  await run('osascript', ['-e', 'tell application id "com.openai.codex" to quit'], {
    allowFailure: true,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const running = spawnSync('pgrep', ['-x', desktop.executableName], {
      encoding: 'utf8',
      timeout: 1_000,
    }).status === 0;
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  const codex = spawn(desktop.path, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CODEX_MICRO_SOCKET: nativePaths.deviceSocket,
      CODEX_MICRO_SHIM_LOG: path.join(nativePaths.directory, 'shim.log'),
      CODEX_MICRO_PREVIOUS_NODE_OPTIONS: process.env.NODE_OPTIONS || '',
      NODE_OPTIONS: `--require="${nativePreloadPath}"`,
    },
  });
  codex.unref();
  await writeFile(nativePaths.codexPid, `${codex.pid}\n`, { mode: 0o600 });

  const native = await waitForNativeConnection();
  if (!native?.connected) {
    printWarning(
      'Codex did not detect Native Micro',
      'Run microdex native test; this Codex version may need a compatibility update',
    );
    process.exitCode = 1;
    return;
  }
  printCheck('Native Micro', 'Connected inside Codex');
  printCheck('Phone bridge', 'Buttons and native lighting are live');
  console.log(`\n  ${ui.dim('Use “microdex native stop” to return to normal Codex mode.')}\n`);
}

async function requestPairingDetails() {
  const port = Number(process.env.MICRODEX_PORT || DEFAULT_PORT);
  const token = await persistentToken();
  const response = await fetch(`http://127.0.0.1:${port}/api/pair/new`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Microdex-Token': token,
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.pairingUrl) {
    throw new Error(
      payload.error ||
      'The running bridge is outdated. Stop it with Control-C, then run setup again.',
    );
  }
  return payload;
}

async function waitForRemotePairingDetails(timeoutMs = 90_000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await requestPairingDetails();
    // Older bridge builds do not report tunnel state. Preserve their local QR
    // behavior instead of making the updated CLI wait forever.
    if (!latest.remoteAccess || latest.remoteAccess.ready) return latest;
    if (latest.remoteAccess.status === 'disabled') return latest;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return latest;
}

async function showPairingQr({ header = true } = {}) {
  if (!await bridgeHealth()) {
    throw new Error('The Microdex background bridge is offline. Run microdex setup first.');
  }
  if (header) printHeader(VERSION);
  printCheck('Background bridge', 'Running automatically');
  console.log('');
  printStep(1, 'Preparing secure connection', 'No shared Wi-Fi required');
  const details = await waitForRemotePairingDetails();
  if (details.remoteAccess?.ready) {
    printCheck('Remote access', 'Ready on Wi-Fi or mobile data');
  } else {
    printWarning(
      'Remote access unavailable',
      details.remoteAccess?.error || 'The fallback QR requires the same Wi-Fi',
    );
  }
  printStep(2, 'Open Microdex and tap Scan pairing QR');
  printQr(details.pairingUrl, qrcode);
  console.log(`  ${ui.dim(`Can't scan? ${details.pairingUrl}`)}`);
  console.log(`  ${ui.dim(
    details.remoteAccess?.ready
      ? 'One-time QR · expires in 10 minutes · encrypted connection'
      : 'One-time QR · expires in 10 minutes · local network fallback',
  )}\n`);
}

function cleanLaunchctlError(error) {
  const message = String(error?.message || 'The macOS background service could not be started.');
  const safeMessage = message
    .split('\n')
    .filter((line) => !/\bsudo\b|as root|command as root/i.test(line))
    .join('\n')
    .trim();
  return new Error(
    `${safeMessage || 'The macOS background service could not be started.'}\n` +
    'Run npx microdex-cli@latest doctor, then run setup again from your normal macOS account.',
  );
}

async function launchAgentIsLoaded() {
  const result = await run(
    'launchctl',
    ['print', `${launchDomain}/${launchAgentLabel}`],
    { allowFailure: true },
  );
  return result.code === 0;
}

async function waitForLaunchAgentToUnload(timeoutMs = 2_500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await launchAgentIsLoaded()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function enableAutomaticStartup() {
  const target = `${launchDomain}/${launchAgentLabel}`;
  const health = await bridgeHealthDetails();
  const currentBridgeIsReady = Boolean(
    health &&
    health.version === VERSION &&
    health.protocolVersion === BRIDGE_PROTOCOL_VERSION,
  );

  // Re-running setup is the normal update/pairing path. A current, registered
  // service does not need another bootstrap; trying one produces launchctl
  // error 5 on some Macs.
  if (currentBridgeIsReady && await launchAgentIsLoaded()) {
    await run('launchctl', ['enable', target], { allowFailure: true });
    return;
  }

  const bootout = await run('launchctl', ['bootout', target], {
    allowFailure: true,
  });
  if (bootout.code === 0) await waitForLaunchAgentToUnload();

  let loaded = await launchAgentIsLoaded();
  if (!loaded) {
    try {
      await retryOperation(
        () => run('launchctl', ['bootstrap', launchDomain, launchAgentPath]),
      );
    } catch (error) {
      // launchctl may report an error even though another registration attempt
      // completed. Trust its registered state, not only the command exit code.
      loaded = await launchAgentIsLoaded();
      if (!loaded) throw cleanLaunchctlError(error);
    }
  }

  await run('launchctl', ['enable', target], { allowFailure: true });
  await run('launchctl', ['kickstart', '-k', target], { allowFailure: true });
}

async function setup() {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic background startup currently requires macOS.');
  }

  printHeader(VERSION);
  printStep(1, 'Installing the private Mac bridge', 'Stored only in ~/.microdex');
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  await mkdir(launchAgentsDir, { recursive: true });
  await persistentToken();

  const packageSpec =
    process.env.MICRODEX_PACKAGE_SPEC ||
    `microdex-cli@${VERSION}`;
  await run('npm', [
    'install',
    '--prefix',
    runtimeDir,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    packageSpec,
  ]);
  if (!await exists(runtimeCliPath)) {
    throw new Error('The Microdex background runtime was not installed correctly.');
  }
  printCheck('Runtime installed', `v${VERSION}`);

  printStep(2, 'Enabling automatic startup', 'Microdex will start when you log in');
  await writeFile(launchAgentPath, launchAgentPlist(), { mode: 0o600 });
  await enableAutomaticStartup();

  if (!await waitForBridge()) {
    const health = await bridgeHealthDetails();
    if (health && !bridgeMatchesCurrentRuntime(health)) {
      throw new Error(
        `Microdex v${health.version ?? 'legacy'} is still using port ` +
        `${process.env.MICRODEX_PORT || DEFAULT_PORT}. Stop the old ` +
        '"microdex up" Terminal with Control-C, then run setup again.',
      );
    }
    const errorLog = await readFile(path.join(logsDir, 'bridge-error.log'), 'utf8').catch(() => '');
    throw new Error(
      errorLog.trim() ||
      'The background bridge did not start. Run microdex doctor and try again.',
    );
  }
  printCheck('Starts automatically', 'Background service online');
  console.log('');
  printStep(3, 'Pair your iPhone');
  await showPairingQr({ header: false });
}

async function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    ok: process.platform === 'darwin',
    label: 'macOS',
    detail: process.platform === 'darwin' ? os.release() : `${process.platform} is not supported yet`,
  });
  checks.push({
    ok: nodeMajor >= 20,
    label: 'Node.js 20+',
    detail: process.version,
  });

  const hasBundledCodex = await exists(codexBinary);
  const pathCodex = hasBundledCodex ? null : spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  checks.push({
    ok: hasBundledCodex || pathCodex?.status === 0,
    label: 'Codex runtime',
    detail: hasBundledCodex
      ? codexBinary
      : pathCodex?.status === 0
        ? pathCodex.stdout.trim()
        : 'Install and open Codex on this Mac',
  });

  const swift = spawnSync('xcrun', ['--find', 'swiftc'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  checks.push({
    ok: swift.status === 0,
    label: 'Desktop controls',
    detail: swift.status === 0
      ? 'Swift compiler available'
      : 'Run: xcode-select --install',
  });

  printHeader(VERSION);
  console.log(`  ${ui.bold('System check')}\n`);
  for (const check of checks) {
    if (check.ok) printCheck(check.label, check.detail);
    else printFailure(check.label, check.detail);
  }
  const healthy = checks.every((check) => check.ok);
  console.log('');
  if (healthy) printCheck('Ready to pair', 'Run microdex setup');
  else printWarning('Fix the failed checks, then run doctor again.');
  console.log('');
  if (!healthy) process.exitCode = 1;
}

async function status() {
  const port = Number(process.env.MICRODEX_PORT || DEFAULT_PORT);
  printHeader(VERSION);
  const health = await bridgeHealthDetails();
  if (health) {
    printCheck('Bridge online', `Port ${port}`);
    if (health.version) {
      printCheck(
        'Bridge runtime',
        `v${health.version} · protocol ${health.protocolVersion ?? 'legacy'}`,
      );
      if (
        health.version !== VERSION ||
        health.protocolVersion !== BRIDGE_PROTOCOL_VERSION
      ) {
        printWarning('Version mismatch', 'Run: npx microdex-cli@latest setup');
      }
    } else {
      printWarning('Outdated bridge', 'Run: npx microdex-cli@latest setup');
    }
    if (await exists(launchAgentPath)) printCheck('Automatic startup', 'Enabled');
    else printWarning('Automatic startup', 'Not installed');
    if (health.remoteAccess?.ready) {
      printCheck('Remote access', 'Ready on Wi-Fi or mobile data');
    } else if (health.remoteAccess?.status === 'disabled') {
      printWarning('Remote access', 'Disabled; same Wi-Fi required');
    } else if (health.remoteAccess?.status === 'cooldown') {
      printWarning('Remote access', 'Cloudflare cooldown; retrying automatically');
    } else if (health.remoteAccess?.status) {
      printWarning('Remote access', 'Connecting in the background');
    } else {
      printWarning('Remote access', 'Update the bridge runtime to enable it');
    }
  } else {
    printFailure('Bridge offline', `Nothing is listening on port ${port}`);
    process.exitCode = 1;
  }
}

async function restart() {
  if (!await exists(launchAgentPath)) {
    throw new Error('The background service is not installed. Run microdex setup first.');
  }
  printHeader(VERSION);
  await run('launchctl', ['kickstart', '-k', `${launchDomain}/${launchAgentLabel}`]);
  if (!await waitForBridge()) throw new Error('The bridge did not come back online.');
  printCheck('Bridge restarted', 'Your iPhone will reconnect automatically');
}

async function uninstall() {
  printHeader(VERSION);
  await run('launchctl', ['bootout', `${launchDomain}/${launchAgentLabel}`], {
    allowFailure: true,
  });
  await rm(launchAgentPath, { force: true });
  await rm(runtimeDir, { recursive: true, force: true });
  await rm(logsDir, { recursive: true, force: true });
  if (process.argv.includes('--purge')) await rm(tokenPath, { force: true });
  printCheck('Background service removed');
  if (!process.argv.includes('--purge')) {
    printWarning('Pairing key preserved', 'Use uninstall --purge to remove it too');
  }
}

async function up() {
  if (process.platform !== 'darwin') {
    console.error('Microdex currently requires macOS because it controls the Codex desktop app.');
    process.exitCode = 1;
    return;
  }

  process.env.MICRODEX_TOKEN = await persistentToken();
  printHeader(VERSION);
  console.log(`  ${ui.dim('Starting secure bridge…')}`);
  await import('../server.mjs');
}

async function daemon() {
  process.env.MICRODEX_TOKEN = await persistentToken();
  process.env.MICRODEX_BACKGROUND = '1';
  await import('../server.mjs');
}

const command = (process.argv[2] || 'up').toLowerCase();

try {
  switch (command) {
    case 'setup':
      await setup();
      break;
    case 'up':
    case 'start':
      await up();
      break;
    case 'daemon':
      await daemon();
      break;
    case 'pair':
      await showPairingQr();
      break;
    case 'status':
      await status();
      break;
    case 'restart':
      await restart();
      break;
    case 'native':
      await nativeMode();
      break;
    case 'uninstall':
      await uninstall();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
} catch (error) {
  printFailure(error?.message || 'Microdex command failed.');
  process.exitCode = 1;
}
