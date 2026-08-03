import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';

import {
  REASONING_EFFORTS,
  applyFastMode,
  applyReasoningEffort,
  readCodexStatus,
} from './lib/codex-config.mjs';
import {
  desktopControlStatus,
  ensureDesktopCompanion,
  executeCodexDesktopAction,
} from './lib/codex-desktop-control.mjs';
import {
  closeDesktopQueueMenu,
  launchDesktopQueueMenu,
} from './lib/desktop-queue-menu.mjs';
import { executeDesktopAction } from './lib/desktop-shortcuts.mjs';
import { CodexAppServer } from './lib/codex-app-server.mjs';
import {
  buildActionAvailability,
  CODEX_KEYCAP_IDS,
  CODEX_PROGRAMMABLE_ACTIONS,
  executeProgrammedAction,
  normalizeProgrammedAction,
} from './lib/programmed-actions.mjs';
import { attachRemoteEvents } from './lib/remote-events.mjs';
import { RemoteMessageQueue } from './lib/remote-message-queue.mjs';
import { PairingSession } from './lib/pairing-session.mjs';
import {
  applyFastSetting,
  applyReasoningSetting,
} from './lib/remote-settings.mjs';
import {
  BRIDGE_NAME,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_VERSION,
} from './lib/package-info.mjs';
import { NativeShimClient } from './lib/native-shim-client.mjs';
import { mergeVisibleDesktopState } from './lib/visible-desktop-state.mjs';
import {
  printCheck,
  printQr,
  printStep,
  printWarning,
  ui,
} from './lib/terminal-ui.mjs';

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.MICRODEX_PORT || 3210);
const host = process.env.MICRODEX_HOST || '0.0.0.0';
const accessToken = process.env.MICRODEX_TOKEN || randomBytes(6).toString('hex').toUpperCase();
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const configPath = process.env.MICRODEX_CONFIG_PATH || path.join(codexHome, 'config.toml');
const hooksDir = process.env.MICRODEX_HOOKS_DIR || path.join(bridgeDir, 'hooks');
const backgroundMode = process.env.MICRODEX_BACKGROUND === '1';
let pairingSession = new PairingSession({ accessToken });
const codex = new CodexAppServer();
let remoteEvents = null;
const desktopReady = ensureDesktopCompanion().catch((error) => ({
  available: false,
  trusted: false,
  running: false,
  error: error?.message || 'Desktop companion is unavailable.',
}));
const messageQueue = new RemoteMessageQueue({
  getState: () => codex.state(),
  send: async ({ threadId, text }) => {
    await codex.selectThread(threadId);
    await new Promise((resolve) => setTimeout(resolve, 320));
    await executeCodexDesktopAction('send-text', text);
  },
  onChange: () => remoteEvents?.notify(),
});
const nativeShim = new NativeShimClient();
nativeShim.start();
nativeShim.subscribe(() => remoteEvents?.notify());
const unsubscribeMessageQueue = codex.subscribe(() => {
  void messageQueue.handleCodexChange();
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Microdex-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function tokenMatches(provided = '') {
  const expected = Buffer.from(accessToken);
  const actual = Buffer.from(String(provided));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 32_768) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { statusCode: 400 });
  }
}

async function publicStatus() {
  const current = await readCodexStatus(configPath);
  const desktop = await desktopControlStatus().catch(() => desktopReady);
  let remote = null;
  try {
    remote = await remoteState();
  } catch (error) {
    remote = { online: false, error: error?.message || 'Codex App Server is unavailable.' };
  }
  return {
    connected: true,
    bridge: {
      name: BRIDGE_NAME,
      version: BRIDGE_VERSION,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    },
    capabilities: {
      verifiedSettings: true,
      remoteChat: true,
      taskControl: true,
      programmableActions: CODEX_PROGRAMMABLE_ACTIONS.length,
      programmableAssignments: true,
      encoderModes: true,
      desktopAutomation: Boolean(
        desktop?.available && desktop?.trusted && desktop?.running,
      ),
      actionAvailability: true,
      visibleDesktopRouting: true,
      nativeHardware: nativeShim.state().connected,
    },
    fastMode: current.fastMode,
    reasoningEffort: current.reasoningEffort,
    configPath,
    platform: process.platform,
    desktop,
    remote,
  };
}

async function remoteState() {
  const [appServerState, desktop] = await Promise.all([
    codex.state(),
    desktopControlStatus().catch(() => desktopReady),
  ]);
  const state = mergeVisibleDesktopState(appServerState, desktop);
  return {
    ...state,
    voice: {
      state: desktop?.voiceActive ? 'active' : 'inactive',
      muted: Boolean(desktop?.voiceMuted),
    },
    messageQueue: messageQueue.list(),
    actionAvailability: buildActionAvailability({
      state,
      desktop,
      native: nativeShim.state(),
    }),
    hardware: {
      mode: nativeShim.state().connected ? 'native' : 'standard',
      ...nativeShim.state(),
    },
  };
}

// `applied` and `verified` mean the bridge ran the command without error. That
// is now trustworthy on its own: the companion throws when a control cannot be
// found, so a failing action returns an HTTP error instead of a fake success.
//
// `confirmed` is the stricter claim, and only `codex` evidence earns it: the
// App Server reported the new state back. A key stroke has no return value, so
// a desktop action is delivered but unconfirmed. Both fields are kept because
// older app builds read `verified` and would show an error without it.
function withVerifiedCommand(state, action, evidence = 'codex') {
  const confirmed = evidence === 'codex';
  return {
    ...state,
    commandResult: {
      action,
      applied: true,
      verified: true,
      confirmed,
      evidence,
      desktopMirrored: evidence === 'desktop',
      warning: confirmed
        ? null
        : 'Sent to the Codex window. The bridge cannot read back the result.',
    },
  };
}

function actionNotApplied(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'ACTION_NOT_APPLIED';
  return error;
}

async function applyNativeFastSetting(enabled) {
  const before = await codex.state();
  if (before.selected?.fastMode === enabled) return before;

  // Preserve the native Codex Micro event for parity with the real hardware,
  // then use the idempotent visible control as the authoritative operation.
  // If the HID action already worked, the desktop helper observes the target
  // value and does nothing; if it did not, the helper applies it.
  await nativeShim.command({ type: 'action.tap', action: 'fast' });
  return (await applyFastSetting({
    body: {
      threadId: before.selectedThreadId,
      fastMode: enabled,
    },
    codex,
  })).state;
}

async function applyNativeReasoningSetting(effort) {
  const before = await codex.state();
  const selected = before.selected;
  if (!selected) throw new Error('Select a Codex task first.');
  if (selected.reasoningEffort === effort) return before;
  const efforts = selected.supportedReasoningEfforts?.length
    ? selected.supportedReasoningEfforts
    : REASONING_EFFORTS;
  if (!efforts.includes(effort)) {
    const error = new Error(`${effort} reasoning is not supported by the active Codex model.`);
    error.statusCode = 400;
    throw error;
  }
  const currentIndex = Math.max(0, efforts.indexOf(selected.reasoningEffort));
  const targetIndex = efforts.indexOf(effort);
  return (await applyReasoningSetting({
    body: {
      threadId: before.selectedThreadId,
      reasoningEffort: effort,
      reasoningDirection:
        targetIndex < currentIndex ? 'reasoning-down' : 'reasoning-up',
    },
    codex,
  })).state;
}

/** Enough for a fast flick, low enough that a bad client cannot spin forever. */
const MAX_ENCODER_STEPS = 24;

async function runEncoderAction({ mode, delta, press = false, steps = 1 }) {
  if (!['composer-navigation', 'conversation-scroll'].includes(mode)) {
    const error = new Error('Invalid encoder mode.');
    error.statusCode = 400;
    throw error;
  }
  if (!press && ![-1, 1].includes(delta)) {
    const error = new Error('Encoder delta must be -1 or 1.');
    error.statusCode = 400;
    throw error;
  }
  // Detents arrive batched: one round trip for a whole flick rather than one per
  // notch, each of which used to wait for the previous request to finish.
  const repeat = press
    ? 1
    : Math.min(MAX_ENCODER_STEPS, Math.max(1, Math.trunc(steps) || 1));

  if (mode === 'composer-navigation') {
    const action = press
      ? 'composer-select'
      : delta > 0
        ? 'composer-next'
        : 'composer-previous';
    for (let step = 0; step < repeat; step += 1) {
      await executeCodexDesktopAction(action);
    }
    return;
  }
  if (!press) {
    const action = delta > 0 ? 'conversation-scroll-down' : 'conversation-scroll-up';
    for (let step = 0; step < repeat; step += 1) {
      await executeCodexDesktopAction(action);
    }
  }
}

function queueState() {
  return { messageQueue: messageQueue.list() };
}

function bridgeAddresses() {
  const isPrivateAddress = (address) => {
    const octets = address.split('.').map(Number);
    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  };
  const isCarrierGradeNat = (address) => {
    const octets = address.split('.').map(Number);
    return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  };
  const isTunnelInterface = (name) =>
    /^(?:utun|tun|tap|ppp|ipsec|wg|tailscale)/i.test(name);

  const addresses = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
        .map((entry, index) => {
          let priority = 0;
          if (/^en\d+$/i.test(name)) priority += 200;
          if (isPrivateAddress(entry.address)) priority += 100;
          if (isCarrierGradeNat(entry.address)) priority -= 50;
          if (isTunnelInterface(name)) priority -= 200;
          if (entry.address.startsWith('169.254.')) priority -= 300;
          return {
            address: entry.address,
            order: index,
            priority,
          };
        }),
    )
    .sort((left, right) => right.priority - left.priority || left.order - right.order)
    .map((entry) => `http://${entry.address}:${port}`);
  return addresses.length ? addresses : [`http://127.0.0.1:${port}`];
}

function pairingDetails() {
  const addresses = bridgeAddresses();
  const urls = addresses.map((address) => {
    const pairingUrl = new URL('/pair', `${address}/`);
    pairingUrl.searchParams.set('code', pairingSession.code);
    return pairingUrl.toString();
  });
  return {
    pairingUrl: urls[0],
    pairingUrls: urls,
    expiresAt: pairingSession.expiresAt,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return sendJson(response, 204, {});
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        name: BRIDGE_NAME,
        version: BRIDGE_VERSION,
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });
    }

    // Public pairing landing page. The QR contains a short-lived, one-time code,
    // never the persistent bridge credential.
    if (request.method === 'GET' && url.pathname === '/pair') {
      const code = url.searchParams.get('code')?.trim() ?? '';
      const validation = pairingSession.validate(code);
      if (!validation.ok) {
        const message = validation.reason === 'expired'
          ? 'This pairing QR has expired. Restart Microdex on the Mac.'
          : validation.reason === 'claimed'
            ? 'This pairing QR has already been used.'
            : 'Invalid pairing code.';
        return sendJson(response, validation.reason === 'expired' ? 410 : 401, { error: message });
      }
      const bridgeUrl = `http://${request.headers.host || `127.0.0.1:${port}`}`;
      // Three slashes on purpose. `microdex://pair` parses `pair` as the host and
      // leaves the path empty, so Expo Router receives nothing to match and the
      // app opens on "Unmatched Route". The empty-host form gives a real `/pair`.
      const deepLink = new URL('microdex:///pair');
      deepLink.searchParams.set('url', bridgeUrl);
      deepLink.searchParams.set('code', code);
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Microdex pairing</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1418;color:#e8eef2;font-family:system-ui,sans-serif;padding:24px;text-align:center}
a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#2f6fed;color:#fff;text-decoration:none;font-weight:600}
p{opacity:.75;line-height:1.45;max-width:28rem}</style></head>
<body><div>
<h1>Microdex</h1>
<p>Scan this page’s QR from <strong>Microdex → Scan pairing QR</strong>. Or open the app with the button below.</p>
<p>This pairing code can be used once and expires shortly.</p>
<a href="${deepLink.toString()}">Open in Microdex</a>
</div></body></html>`;
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return response.end(html);
    }

    if (request.method === 'POST' && url.pathname === '/api/pair/claim') {
      const body = await readBody(request);
      const result = pairingSession.claim(String(body.code || ''));
      if (!result.ok) {
        const message = result.reason === 'expired'
          ? 'This pairing QR has expired. Run microdex pair again.'
          : result.reason === 'claimed'
            ? 'This pairing QR has already been used.'
            : 'Invalid pairing code.';
        return sendJson(response, result.reason === 'expired' ? 410 : 401, { error: message });
      }
      console.log('');
      printCheck('iPhone paired', 'Secure session saved');
      console.log(`  ${ui.dim('You can start controlling Codex now.')}\n`);
      return sendJson(response, 200, { token: result.token });
    }

    if (!tokenMatches(request.headers['x-microdex-token'])) {
      return sendJson(response, 401, { error: 'Invalid bridge access code.' });
    }

    if (request.method === 'POST' && url.pathname === '/api/pair/new') {
      pairingSession = new PairingSession({ accessToken });
      return sendJson(response, 200, pairingDetails());
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(response, 200, await publicStatus());
    }

    if (request.method === 'POST' && url.pathname === '/api/actions/fast') {
      const body = await readBody(request);
      if (typeof body.enabled !== 'boolean') {
        return sendJson(response, 400, { error: 'The enabled field must be a boolean.' });
      }
      if (nativeShim.state().connected) await applyNativeFastSetting(body.enabled);
      else await applyFastMode(configPath, body.enabled);
      return sendJson(response, 200, await publicStatus());
    }

    if (request.method === 'POST' && url.pathname === '/api/actions/reasoning') {
      const body = await readBody(request);
      if (!REASONING_EFFORTS.includes(body.effort)) {
        return sendJson(response, 400, { error: 'Invalid reasoning level.' });
      }
      if (nativeShim.state().connected) await applyNativeReasoningSetting(body.effort);
      else await applyReasoningEffort(configPath, body.effort);
      return sendJson(response, 200, await publicStatus());
    }

    if (request.method === 'POST' && url.pathname === '/api/actions/shortcut') {
      const body = await readBody(request);
      if (typeof body.action !== 'string') {
        return sendJson(response, 400, { error: 'Missing action.' });
      }
      const message = await executeDesktopAction(body.action, hooksDir);
      return sendJson(response, 200, { ok: true, message });
    }

    if (request.method === 'GET' && url.pathname === '/api/remote/state') {
      return sendJson(response, 200, await remoteState());
    }

    if (request.method === 'GET' && url.pathname === '/api/remote/queue') {
      return sendJson(response, 200, queueState());
    }

    if (request.method === 'GET' && url.pathname === '/api/programmable/actions') {
      const state = await remoteState();
      return sendJson(response, 200, {
        keycaps: CODEX_KEYCAP_IDS.map((id) => ({ id })),
        actions: CODEX_PROGRAMMABLE_ACTIONS.map(({ id, label, kind, availability }) => ({
          id,
          label,
          kind,
          availability,
          runtime: state.actionAvailability[id],
        })),
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/programmable/action') {
      const body = await readBody(request);
      if (
        body.keycapId !== undefined &&
        !CODEX_KEYCAP_IDS.includes(body.keycapId)
      ) {
        return sendJson(response, 400, { error: 'Invalid keycapId.' });
      }
      const normalized = normalizeProgrammedAction(body);
      const nativeConnected = nativeShim.state().connected;
      await executeProgrammedAction({
        ...normalized,
        threadId: body.threadId,
        codex,
        applyFast: nativeConnected
          ? (settings) => applyNativeFastSetting(settings.fastMode)
          : undefined,
        applyReasoning: nativeConnected
          ? (settings) => applyNativeReasoningSetting(settings.reasoningEffort)
          : undefined,
        // Use operations that can report a real result. Native HID delivery is
        // transport acknowledgment only and must not be treated as completion.
        resolveApproval: (decision) => codex.resolveApproval(decision),
        executeFork: (threadId) => codex.forkThread(threadId),
        executeDesktop: executeCodexDesktopAction,
      });
      return sendJson(
        response,
        200,
        withVerifiedCommand(
          await remoteState(),
          normalized.commandId,
          ['fast', 'effort', 'approve', 'decline', 'fork'].includes(
            CODEX_PROGRAMMABLE_ACTIONS.find(
              (action) => action.id === normalized.commandId,
            )?.kind,
          )
            ? 'codex'
            : 'desktop',
        ),
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/select') {
      const body = await readBody(request);
      if (typeof body.threadId !== 'string' || !body.threadId) {
        return sendJson(response, 400, { error: 'Missing threadId.' });
      }
      const state = await codex.state();
      const target = state.threads.find((thread) => thread.id === body.threadId);
      if (!target) return sendJson(response, 404, { error: 'Codex task not found.' });
      await executeCodexDesktopAction('select-chat', target.name);
      codex.markSelectedThread(body.threadId);
      return sendJson(response, 200, await remoteState());
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/settings') {
      const body = await readBody(request);
      let commandResult = null;
      if (body.fastMode === undefined && body.reasoningEffort === undefined) {
        return sendJson(response, 400, { error: 'Missing setting.' });
      }
      if (body.fastMode !== undefined && typeof body.fastMode !== 'boolean') {
        return sendJson(response, 400, { error: 'fastMode must be boolean.' });
      }
      if (body.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(body.reasoningEffort)) {
        return sendJson(response, 400, { error: 'Invalid reasoning level.' });
      }
      if (
        body.reasoningDirection !== undefined &&
        !['reasoning-up', 'reasoning-down'].includes(body.reasoningDirection)
      ) {
        return sendJson(response, 400, { error: 'Invalid reasoning direction.' });
      }
      if (body.fastMode !== undefined) {
        if (nativeShim.state().connected) await applyNativeFastSetting(body.fastMode);
        else await applyFastSetting({ body, codex });
        commandResult = {
          action: 'fast',
          applied: true,
          verified: true,
          evidence: 'codex',
          desktopMirrored: true,
          warning: null,
        };
      }
      if (body.reasoningEffort !== undefined) {
        // The native HID path returns a state and cannot report clamping; the
        // standard bridge path returns the full outcome.
        const outcome = nativeShim.state().connected
          ? null
          : await applyReasoningSetting({ body, codex });
        if (!outcome) await applyNativeReasoningSetting(body.reasoningEffort);
        commandResult = {
          action: 'reasoning',
          applied: true,
          verified: true,
          evidence: 'codex',
          desktopMirrored: true,
          // The active model may not offer the requested level. Saying so keeps
          // the dial honest instead of leaving it on a value Codex never took.
          warning: outcome?.clamped
            ? `${body.reasoningEffort} is not available for this model. Codex stayed on ${outcome.appliedEffort}.`
            : null,
        };
      }
      return sendJson(response, 200, {
        ...await remoteState(),
        commandResult,
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/send') {
      const body = await readBody(request);
      const text = String(body.text || '').trim();
      if (text) {
        messageQueue.enqueue({ threadId: body.threadId, text });
        return sendJson(response, 200, queueState());
      }
      await executeCodexDesktopAction('send');
      return sendJson(response, 200, await remoteState());
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/queue/remove') {
      const body = await readBody(request);
      if (typeof body.messageId !== 'string' || !body.messageId) {
        return sendJson(response, 400, { error: 'Missing messageId.' });
      }
      if (!messageQueue.remove(body.messageId)) {
        return sendJson(response, 409, { error: 'Message is no longer queued.' });
      }
      return sendJson(response, 200, queueState());
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/fork') {
      const body = await readBody(request);
      const before = await codex.state();
      const sourceThreadId = body.threadId || before.selectedThreadId;
      if (!sourceThreadId) throw actionNotApplied('Select a Codex task first.');
      const forked = await codex.forkThread(sourceThreadId);
      if (
        !forked.selectedThreadId ||
        forked.selectedThreadId === sourceThreadId
      ) {
        throw actionNotApplied('Codex did not create the new task.');
      }
      return sendJson(
        response,
        200,
        withVerifiedCommand(await remoteState(), 'forkThread'),
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/archive') {
      const body = await readBody(request);
      if (!body.threadId) throw actionNotApplied('Select a Codex task first.');
      messageQueue.removeThread(body.threadId);
      const archived = await codex.archiveThread(body.threadId);
      if (archived.threads.some((thread) => thread.id === body.threadId)) {
        throw actionNotApplied('Codex did not archive the task.');
      }
      return sendJson(
        response,
        200,
        withVerifiedCommand(await remoteState(), 'archiveThread'),
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/new') {
      const before = await codex.state();
      const created = await codex.openNewThread();
      if (
        !created.selectedThreadId ||
        created.selectedThreadId === before.selectedThreadId
      ) {
        throw actionNotApplied('Codex did not create the new task.');
      }
      return sendJson(
        response,
        200,
        withVerifiedCommand(await remoteState(), 'newThread'),
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/remote/approval') {
      const body = await readBody(request);
      if (!['approve', 'decline'].includes(body.decision)) {
        return sendJson(response, 400, { error: 'Invalid approval decision.' });
      }
      const currentState = await codex.state();
      if (currentState.pendingApproval) {
        await codex.resolveApproval(body.decision);
        const nextState = await remoteState();
        if (nextState.pendingApproval?.requestId === currentState.pendingApproval.requestId) {
          throw actionNotApplied('Codex did not resolve the approval request.');
        }
        return sendJson(
          response,
          200,
          withVerifiedCommand(
            nextState,
            body.decision === 'approve'
              ? 'approval.approve'
              : 'approval.decline',
          ),
        );
      }
      return sendJson(response, 409, { error: 'There is no pending approval.' });
    }

    if (request.method === 'GET' && url.pathname === '/api/desktop/status') {
      return sendJson(response, 200, await desktopControlStatus());
    }

    if (request.method === 'POST' && url.pathname === '/api/desktop/action') {
      const body = await readBody(request);
      if (![
        'plan',
        'dictation',
        'dictation-start',
        'dictation-stop',
        'voice-start',
        'voice-toggle-mute',
        'voice-end',
        'send',
        'sidebar',
        'back',
        'forward',
      ].includes(body.action)) {
        return sendJson(response, 400, { error: 'Invalid desktop action.' });
      }
      const desktopResult = await executeCodexDesktopAction(body.action);
      const nextState = withVerifiedCommand(await remoteState(), body.action, 'desktop');
      if (desktopResult.voiceState) {
        nextState.voice = {
          state: desktopResult.voiceState,
          muted: Boolean(desktopResult.voiceMuted),
        };
      }
      return sendJson(
        response,
        200,
        nextState,
      );
    }

    if (request.method === 'POST' && url.pathname === '/api/encoder/action') {
      const body = await readBody(request);
      if (!['step', 'press'].includes(body.action)) {
        return sendJson(response, 400, { error: 'Invalid encoder action.' });
      }
      await runEncoderAction({
        mode: body.mode,
        delta: Number(body.delta),
        press: body.action === 'press',
        // Older app builds send no `steps`, which stays one notch per request.
        steps: body.steps === undefined ? 1 : Number(body.steps),
      });
      return sendJson(
        response,
        200,
        withVerifiedCommand(
          await remoteState(),
          `encoder.${body.mode}.${body.action}`,
          'desktop',
        ),
      );
    }

    return sendJson(response, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return sendJson(response, statusCode, { error: error?.message || 'Internal bridge error.' });
  }
});

remoteEvents = attachRemoteEvents({
  server,
  codex: {
    state: remoteState,
    subscribe: (listener) => codex.subscribe(listener),
  },
  authenticate: tokenMatches,
});

server.listen(port, host, () => {
  void launchDesktopQueueMenu({ port, token: accessToken }).catch((error) => {
    console.error(`Microdex queue menu unavailable: ${error?.message || error}`);
  });
  const { pairingUrl } = pairingDetails();
  const preferredAddress = bridgeAddresses()[0];

  if (backgroundMode) {
    console.log(`Microdex background bridge ready at ${preferredAddress}`);
  } else {
    console.log('');
    printCheck('Codex runtime', 'Connected');
    printCheck('Local bridge', `${preferredAddress}`);
    console.log('');
    printStep(1, 'Open Microdex on your iPhone');
    printStep(2, 'Tap Pair Mac → Scan pairing QR');
    printStep(3, 'Scan this one-time code');
    printQr(pairingUrl, qrcode);
    console.log(`  ${ui.dim(`Can't scan? ${pairingUrl}`)}`);
    console.log(`  ${ui.dim('One-time QR · expires in 10 minutes · keep this window open')}`);
    console.log(`  ${ui.dim('Press Control-C to stop Microdex.')}\n`);
  }
  void desktopReady.then(async (desktop) => {
    if (desktop.available && !desktop.trusted) {
      await desktopControlStatus({ prompt: true });
      printWarning(
        'Accessibility permission needed',
        'System Settings → Privacy & Security → Accessibility',
      );
    } else if (desktop.trusted) {
      printCheck('Desktop controls', 'Ready');
    } else if (desktop.error) {
      printWarning('Desktop controls unavailable', desktop.error);
    }
  });
});

function shutdown() {
  console.log('');
  console.log(`  ${ui.dim('Stopping Microdex…')}`);
  closeDesktopQueueMenu();
  remoteEvents.close();
  unsubscribeMessageQueue();
  messageQueue.close();
  codex.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
