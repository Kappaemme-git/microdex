import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const CLOUDFLARED_VERSION = '2026.7.3';
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const RATE_LIMIT_RETRY_MS = 5 * 60 * 1_000;
const TUNNEL_VERIFY_TIMEOUT_MS = 5 * 60 * 1_000;
const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

const CLOUDFLARED_RELEASES = Object.freeze({
  arm64: {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: '90c5a4f914d705fd70c135dba6d80b1791d254b08d6d4136301941f88330dd09',
  },
  x64: {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: '70d1c8684fa6d14b5843787ec8d1ea8e18b23650e424f4ea43d849a506487c3b',
  },
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

export function cloudflaredRelease(arch = process.arch) {
  const release = CLOUDFLARED_RELEASES[arch];
  if (!release) {
    throw new Error(`Remote access does not support the ${arch} Mac architecture yet.`);
  }
  return {
    version: CLOUDFLARED_VERSION,
    ...release,
    url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${release.file}`,
  };
}

export function extractQuickTunnelUrl(value) {
  return String(value).match(TUNNEL_URL_PATTERN)?.[0]?.toLowerCase() ?? null;
}

export function extractTunnelDiagnostic(value) {
  const lines = String(value)
    .replaceAll(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bERR\b/.test(line));
  const latest = lines.at(-1);
  if (!latest) return null;
  const diagnostic = latest.replace(/^.*?\bERR\b\s*/, '').slice(0, 320) || null;
  if (/error code:\s*1015\b/i.test(diagnostic)) {
    return 'Cloudflare is temporarily rate limiting new beta tunnels. Microdex will retry automatically.';
  }
  return diagnostic;
}

async function isExecutable(filePath) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadCloudflared({ stateDir, fetchImpl = fetch }) {
  const release = cloudflaredRelease();
  const binDir = path.join(stateDir, 'bin');
  const destination = path.join(
    binDir,
    `cloudflared-${release.version}-${process.arch}`,
  );
  if (await isExecutable(destination)) return destination;

  await mkdir(binDir, { recursive: true, mode: 0o700 });
  const temporaryDir = await mkdtemp(path.join(binDir, '.cloudflared-'));
  const archivePath = path.join(temporaryDir, release.file);

  try {
    const response = await fetchImpl(release.url, {
      headers: { 'User-Agent': 'microdex-cli' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`Remote access download failed with HTTP ${response.status}.`);
    }
    const expectedLength = Number(response.headers.get('content-length') || 0);
    if (expectedLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('Remote access download is unexpectedly large.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new Error('Remote access download has an invalid size.');
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== release.sha256) {
      throw new Error('Remote access download failed its security check.');
    }

    await writeFile(archivePath, bytes, { mode: 0o600 });
    await run('/usr/bin/tar', ['-xzf', archivePath, '-C', temporaryDir]);
    const extracted = path.join(temporaryDir, 'cloudflared');
    await chmod(extracted, 0o700);
    try {
      await rename(extracted, destination);
    } catch (error) {
      if (error?.code !== 'EEXIST' || !await isExecutable(destination)) throw error;
    }
    return destination;
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

export async function resolveCloudflared({ stateDir }) {
  const override = process.env.MICRODEX_CLOUDFLARED_BIN?.trim();
  if (override) {
    if (!await isExecutable(override)) {
      throw new Error('MICRODEX_CLOUDFLARED_BIN does not point to an executable file.');
    }
    return override;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Automatic remote access currently requires macOS.');
  }
  return downloadCloudflared({ stateDir });
}

async function verifyTunnel(
  url,
  fetchImpl = fetch,
  resolveImpl = resolve4,
  initialDelayMs = 5_000,
) {
  const hostname = new URL(url).hostname;
  if (initialDelayMs > 0) await delay(initialDelayMs);
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < TUNNEL_VERIFY_TIMEOUT_MS) {
    attempt += 1;
    try {
      // Avoid giving fetch/getaddrinfo an NXDOMAIN result to cache while the
      // just-created Quick Tunnel hostname is still propagating.
      await resolveImpl(hostname);
    } catch {
      await delay(Math.min(5_000, 1_000 + attempt * 250));
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetchImpl(`${url}/health`, {
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ok === true) return true;
      }
    } catch {
      // The hostname is published before its edge route is fully reachable.
    } finally {
      clearTimeout(timeout);
    }
    await delay(Math.min(5_000, 1_000 + attempt * 250));
  }
  return false;
}

export function createRemoteTunnel({
  port,
  stateDir,
  enabled = true,
  fetchImpl = fetch,
  resolveImpl = resolve4,
  initialVerifyDelayMs = 5_000,
  spawnImpl = spawn,
}) {
  let child = null;
  let closed = false;
  let restartTimer = null;
  let generation = 0;
  let restartAttempt = 0;
  let outputTail = '';
  let lastProcessError = null;
  let verifyingUrl = null;
  let current = {
    status: enabled ? 'idle' : 'disabled',
    ready: false,
    url: null,
    error: null,
  };
  const listeners = new Set();

  const publish = (patch) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener({ ...current });
  };

  const scheduleRestart = () => {
    if (closed || !enabled || restartTimer) return;
    restartAttempt += 1;
    const wait = current.status === 'cooldown'
      ? Math.min(
          60 * 60 * 1_000,
          RATE_LIMIT_RETRY_MS * 2 ** Math.min(restartAttempt - 1, 4),
        )
      : Math.min(30_000, 1_000 * 2 ** Math.min(restartAttempt - 1, 5));
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void startProcess();
    }, wait);
  };

  const verifyRegisteredTunnel = (url, processGeneration) => {
    if (verifyingUrl === url) return;
    verifyingUrl = url;
    void verifyTunnel(url, fetchImpl, resolveImpl, initialVerifyDelayMs).then((verified) => {
      if (closed || processGeneration !== generation || current.url !== url) return;
      if (verified) {
        restartAttempt = 0;
        publish({ status: 'ready', ready: true, error: null });
      } else {
        publish({ status: 'error', ready: false, error: 'The secure tunnel could not be reached.' });
        child?.kill('SIGTERM');
      }
    });
  };

  const acceptOutput = (chunk, processGeneration) => {
    if (closed || processGeneration !== generation) return;
    const text = chunk.toString();
    outputTail = `${outputTail}${text}`.slice(-8_192);
    lastProcessError = extractTunnelDiagnostic(text) ?? lastProcessError;
    const url = extractQuickTunnelUrl(outputTail);
    if (url && current.url !== url) {
      publish({ status: 'verifying', ready: false, url, error: null });
    }
    // cloudflared prints the public hostname before its edge route is
    // registered. Fetching it in that gap can cache an NXDOMAIN result in the
    // Node process, so wait for the connector acknowledgement before probing.
    if (current.url && outputTail.includes('Registered tunnel connection')) {
      verifyRegisteredTunnel(current.url, processGeneration);
    }
  };

  const startProcess = async () => {
    if (closed || !enabled || child) return;
    const processGeneration = ++generation;
    outputTail = '';
    lastProcessError = null;
    verifyingUrl = null;
    publish({ status: 'installing', ready: false, url: null, error: null });
    let binary;
    try {
      binary = await resolveCloudflared({ stateDir });
    } catch (error) {
      if (closed || processGeneration !== generation) return;
      publish({
        status: 'error',
        ready: false,
        url: null,
        error: error?.message || 'Remote access could not be installed.',
      });
      scheduleRestart();
      return;
    }
    if (closed || processGeneration !== generation) return;

    publish({ status: 'connecting', ready: false, url: null, error: null });
    const nextChild = spawnImpl(binary, [
      'tunnel',
      '--no-autoupdate',
      '--loglevel',
      'info',
      '--url',
      `http://127.0.0.1:${port}`,
    ], {
      env: {
        ...process.env,
        HOME: stateDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child = nextChild;
    nextChild.stdout?.on('data', (chunk) => acceptOutput(chunk, processGeneration));
    nextChild.stderr?.on('data', (chunk) => acceptOutput(chunk, processGeneration));
    nextChild.once('error', (error) => {
      if (child === nextChild) child = null;
      if (closed || processGeneration !== generation) return;
      publish({
        status: 'error',
        ready: false,
        url: null,
        error: error?.message || 'Remote access could not start.',
      });
      scheduleRestart();
    });
    nextChild.once('close', () => {
      if (child === nextChild) child = null;
      if (closed || processGeneration !== generation) return;
      const rateLimited = /temporarily rate limiting/i.test(lastProcessError || '');
      publish({
        status: rateLimited ? 'cooldown' : 'offline',
        ready: false,
        url: null,
        error:
          lastProcessError ||
          current.error ||
          'The secure tunnel disconnected and is reconnecting.',
      });
      scheduleRestart();
    });
  };

  return {
    state: () => ({ ...current }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      void startProcess();
    },
    close() {
      closed = true;
      generation += 1;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const activeChild = child;
      child = null;
      if (activeChild && activeChild.exitCode === null) activeChild.kill('SIGTERM');
      publish({ status: 'closed', ready: false, url: null, error: null });
      listeners.clear();
    },
  };
}
