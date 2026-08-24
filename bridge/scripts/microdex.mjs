#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
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
import { deletePersistentRelayRoom } from '../lib/remote-relay.mjs';
import { REVIEW_PAIRING_TTL_MS } from '../lib/pairing-session.mjs';

const VERSION = BRIDGE_VERSION;
const DEFAULT_PORT = 3210;
const stateDir = process.env.MICRODEX_HOME || path.join(os.homedir(), '.microdex');
const tokenPath = path.join(stateDir, 'access-token');
const e2eeClientsPath = path.join(stateDir, 'e2ee-clients.json');
const relayIdentityPath = path.join(stateDir, 'relay-device.json');
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

function printHelp() {
  printHeader(VERSION);
  console.log(`
  ${ui.bold('Usage')}
    microdex setup      Install the background bridge and pair
    microdex pair       Show a fresh pairing QR
    microdex review-pair Show a single-use App Review QR (30 days)
    microdex status     Check the background bridge
    microdex restart    Restart the background bridge
    microdex revoke-all Revoke every paired phone and rotate the access key
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

async function requestPairingDetails({ review = false } = {}) {
  const port = Number(process.env.MICRODEX_PORT || DEFAULT_PORT);
  const token = await persistentToken();
  const response = await fetch(`http://127.0.0.1:${port}/api/pair/new`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Microdex-Token': token,
    },
    body: JSON.stringify({ mode: review ? 'review' : 'standard' }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.pairingUrl) {
    throw new Error(
      payload.error ||
      'The running bridge is outdated. Stop it with Control-C, then run setup again.',
    );
  }
  if (review && payload.mode !== 'review') {
    throw new Error(
      'The running bridge does not support App Review pairing yet. Run microdex setup with this CLI version first.',
    );
  }
  return payload;
}

async function waitForRemotePairingDetails(
  timeoutMs = 90_000,
  { review = false } = {},
) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await requestPairingDetails({ review });
    // Older bridge builds do not report tunnel state. Preserve their local QR
    // behavior instead of making the updated CLI wait forever.
    if (!latest.remoteAccess || latest.remoteAccess.ready) return latest;
    if (latest.remoteAccess.status === 'disabled') return latest;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return latest;
}

async function showPairingQr({ header = true, review = false } = {}) {
  if (!await bridgeHealth()) {
    throw new Error('The Microdex background bridge is offline. Run microdex setup first.');
  }
  if (header) printHeader(VERSION);
  printCheck('Background bridge', 'Running automatically');
  console.log('');
  printStep(1, 'Preparing secure connection', 'No shared Wi-Fi required');
  const details = await waitForRemotePairingDetails(90_000, { review });
  if (details.remoteAccess?.ready) {
    printCheck(
      'Remote access',
      details.remoteAccess.transport === 'relay'
        ? 'Stable address · ready on Wi-Fi or mobile data'
        : 'Ready on Wi-Fi or mobile data',
    );
  } else {
    printWarning(
      'Remote access unavailable',
      details.remoteAccess?.error || 'The fallback QR requires the same Wi-Fi',
    );
  }
  printStep(
    2,
    review
      ? 'Attach this QR privately to the App Review notes'
      : 'Open Microdex and tap Scan pairing QR',
  );
  printQr(details.pairingUrl, qrcode);
  console.log(`  ${ui.dim(`Can't scan? ${details.pairingUrl}`)}`);
  console.log(`  ${ui.dim(
    review
      ? `Single-use reviewer QR · expires in ${Math.round(REVIEW_PAIRING_TTL_MS / 86_400_000)} days · revoke after review`
      : details.remoteAccess?.ready
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
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const supportedNode = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 19);
  checks.push({
    ok: process.platform === 'darwin',
    label: 'macOS',
    detail: process.platform === 'darwin' ? os.release() : `${process.platform} is not supported yet`,
  });
  checks.push({
    ok: supportedNode,
    label: 'Node.js 20.19+',
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
      printCheck(
        'Remote access',
        health.remoteAccess.transport === 'relay'
          ? 'Stable address · ready on Wi-Fi or mobile data'
          : 'Ready on Wi-Fi or mobile data',
      );
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

async function confirmRevokeAll() {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Run microdex revoke-all --yes in a non-interactive Terminal.');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(
    '  Revoke every paired phone? Each phone must scan a new QR. [y/N] ',
  )).trim().toLowerCase();
  prompt.close();
  return answer === 'y' || answer === 'yes';
}

async function revokeAll() {
  if (!await exists(launchAgentPath)) {
    throw new Error('The background service is not installed. Run microdex setup first.');
  }
  printHeader(VERSION);
  if (!await confirmRevokeAll()) {
    printWarning('No devices were revoked');
    return;
  }

  const target = `${launchDomain}/${launchAgentLabel}`;
  await run('launchctl', ['bootout', target], { allowFailure: true });
  await waitForLaunchAgentToUnload();
  await Promise.all([
    rm(tokenPath, { force: true }),
    rm(e2eeClientsPath, { force: true }),
  ]);
  await persistentToken();
  await enableAutomaticStartup();
  if (!await waitForBridge()) throw new Error('The bridge did not restart after revoking devices.');
  printCheck('All phones revoked', 'The bridge access key was rotated');
  printWarning('Pair again', 'Run microdex pair and scan the new encrypted QR');
}

async function uninstall() {
  printHeader(VERSION);
  await run('launchctl', ['bootout', `${launchDomain}/${launchAgentLabel}`], {
    allowFailure: true,
  });
  await rm(launchAgentPath, { force: true });
  await rm(runtimeDir, { recursive: true, force: true });
  await rm(logsDir, { recursive: true, force: true });
  if (process.argv.includes('--purge')) {
    await deletePersistentRelayRoom({ stateDir }).catch(() => false);
    await Promise.all([
      rm(tokenPath, { force: true }),
      rm(e2eeClientsPath, { force: true }),
      rm(relayIdentityPath, { force: true }),
    ]);
  }
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
    case 'review-pair':
      await showPairingQr({ review: true });
      break;
    case 'status':
      await status();
      break;
    case 'restart':
      await restart();
      break;
    case 'revoke-all':
      await revokeAll();
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
