import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(bridgeDir, 'native', 'MicrodexDesktop.swift');
const installDir = path.join(os.homedir(), '.microdex', 'bin');
const executablePath = path.join(installDir, 'MicrodexDesktop');
const buildStampPath = path.join(installDir, 'MicrodexDesktop.sha256');
const ALLOWED_ACTIONS = new Set([
  'model-picker',
  'clear-composer',
  'command-menu-open',
  'command-menu-search',
  'dismiss',
  'previous-chat',
  'next-chat',
  'file-tree',
  'bottom-panel',
  'pinned-summary',
  'find',
  'fast',
  'reasoning-up',
  'reasoning-down',
  'plan',
  'dictation',
  'dictation-start',
  'dictation-stop',
  'voice-start',
  'voice-toggle-mute',
  'voice-end',
  'approve',
  'decline',
  'send',
  'send-text',
  'insert-text',
  'command-menu',
  'menu-item',
  'chat-action',
  'copy-markdown',
  'worktree',
  'attach-files',
  'scheduled',
  'terminal',
  'open-url',
  'sidebar',
  'back',
  'forward',
  'composer-previous',
  'composer-next',
  'composer-select',
  'conversation-scroll-up',
  'conversation-scroll-down',
  'keyboard-shortcuts',
  'new-chat',
  'archive-chat',
  'fork-chat',
  'review',
  'select-chat',
]);

// Actions that reach Codex as a key stroke or through the application menu bar.
// The menu bar is always exposed to accessibility, so neither kind depends on
// the web view building its tree.
const NO_WINDOW_TREE_ACTIONS = new Set([
  'send',
  'approve',
  'decline',
  'sidebar',
  'back',
  'forward',
  'new-chat',
  'terminal',
  'review',
  'keyboard-shortcuts',
  'conversation-scroll-up',
  'conversation-scroll-down',
  'dismiss',
  'previous-chat',
  'next-chat',
  'file-tree',
  'bottom-panel',
  'pinned-summary',
  'find',
  'menu-item',
  'open-url',
  'command-menu-open',
  'command-menu-search',
]);

let buildPromise;

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(result.stderr || result.stdout || `${command} exited with code ${code}`));
    });
  });
}

async function needsBuild() {
  try {
    const [source, executable, sourceBytes, buildStamp] = await Promise.all([
      stat(sourcePath),
      stat(executablePath),
      readFile(sourcePath),
      readFile(buildStampPath, 'utf8').catch(() => ''),
    ]);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    return source.mtimeMs > executable.mtimeMs || buildStamp.trim() !== sourceHash;
  } catch {
    return true;
  }
}

export async function ensureDesktopCompanion() {
  if (process.platform !== 'darwin') {
    return { available: false, trusted: false, running: false, reason: 'macOS is required.' };
  }
  if (!buildPromise) {
    buildPromise = (async () => {
      if (await needsBuild()) {
        await mkdir(installDir, { recursive: true, mode: 0o700 });
        const sourceBytes = await readFile(sourcePath);
        const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
        await run('xcrun', [
          'swiftc',
          '-O',
          '-framework',
          'AppKit',
          '-framework',
          'ApplicationServices',
          '-framework',
          'Carbon',
          sourcePath,
          '-o',
          executablePath,
        ]);
        await writeFile(buildStampPath, `${sourceHash}\n`, { mode: 0o600 });
      }
      return executablePath;
    })().catch((error) => {
      buildPromise = undefined;
      throw error;
    });
  }
  await buildPromise;
  return desktopControlStatus();
}

function parseOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return { ok: false, error: output || 'Invalid response from the desktop companion.' };
  }
}

// A status read spawns the companion and walks the accessibility tree twice, so
// it is far too expensive to repeat per action. Every state readback used to pay
// for it, which is what made a fast encoder spin lag behind the finger. Stale by
// at most this long is fine: it only feeds the activity LED.
const STATUS_CACHE_MS = 400;
let statusCache = null;

export function invalidateDesktopStatus() {
  statusCache = null;
}

export async function desktopControlStatus({ prompt = false } = {}) {
  if (process.platform !== 'darwin') {
    return { available: false, trusted: false, running: false, reason: 'macOS is required.' };
  }
  // A permission prompt must always reach the companion.
  if (!prompt && statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.value;
  }
  if (!buildPromise && await needsBuild()) await ensureDesktopCompanion();
  const result = await run(executablePath, [prompt ? 'permission' : 'status'], { allowFailure: true });
  const value = { available: true, ...parseOutput(result.stdout) };
  // A prompt can flip `trusted`, so drop the cache rather than seed it.
  statusCache = prompt ? null : { at: Date.now(), value };
  return value;
}

export async function executeCodexDesktopAction(action, payload) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Desktop action is not allowed: ${action}`);
  const status = await ensureDesktopCompanion();
  if (!status.trusted) {
    await desktopControlStatus({ prompt: true });
    const error = new Error(
      'Allow MicrodexDesktop in System Settings → Privacy & Security → Accessibility, then press the key again.',
    );
    error.statusCode = 503;
    throw error;
  }
  if (!status.running) {
    const error = new Error('Open ChatGPT on the Mac, then press the key again.');
    error.statusCode = 503;
    throw error;
  }
  // Actions that only post a key stroke work without the accessibility tree.
  // Everything that has to locate a control needs the window content, which the
  // Codex web view builds only on request. If it is still unreachable, fail
  // loudly instead of running a no-op that reports success.
  if (status.windowTree === false && !NO_WINDOW_TREE_ACTIONS.has(action)) {
    const error = new Error(
      'The Codex window content is not reachable over accessibility. Quit and reopen the Codex app, then press the key again.',
    );
    error.statusCode = 503;
    error.code = 'WINDOW_TREE_UNREACHABLE';
    throw error;
  }

  const execute = async (args, { allowFailure = false } = {}) => {
    const result = await run(executablePath, args, { allowFailure: true });
    const response = parseOutput(result.stdout);
    if (!allowFailure && (result.code !== 0 || !response.ok)) {
      const error = new Error(response.error || result.stderr || `Desktop action failed: ${action}`);
      error.statusCode = 500;
      throw error;
    }
    return { result, response };
  };

  const args = ['action', action];
  if (payload !== undefined) args.push(String(payload));
  const response = (await execute(args)).response;
  // A desktop action may change Voice/working state immediately. Do not let
  // the following remote-state read reuse the pre-action health snapshot.
  statusCache = null;
  return response;
}
