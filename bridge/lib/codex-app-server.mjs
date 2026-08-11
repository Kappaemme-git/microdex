import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const DEFAULT_CODEX_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex';
const REQUEST_TIMEOUT_MS = 15_000;
const STATE_CHANGE_METHODS = new Set([
  'thread/status/changed',
  'thread/settings/updated',
  'turn/started',
  'turn/completed',
  'serverRequest/resolved',
]);
import { REASONING_EFFORTS } from './codex-config.mjs';

// Single source of truth, so a level removed there disappears everywhere.
const DEFAULT_REASONING_EFFORTS = REASONING_EFFORTS;
let sharedServerPromise;
let sharedServer;
const liveClients = new Set();
const sharedSettings = new Map();

export function isFastServiceTier(serviceTier) {
  return serviceTier === 'priority' || serviceTier === 'fast';
}

export function serviceTierForFastMode(enabled) {
  return enabled ? 'priority' : null;
}

export function canUseThreadSnapshotAfterResumeError(error) {
  return /already has an active writer/i.test(String(error?.message || error || ''));
}

async function resolveCodexBinary() {
  if (process.env.MICRODEX_CODEX_BIN) return process.env.MICRODEX_CODEX_BIN;
  try {
    await access(DEFAULT_CODEX_BIN);
    return DEFAULT_CODEX_BIN;
  } catch {
    return 'codex';
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('Could not reserve a loopback port for Codex.'));
      });
    });
  });
}

function openWebSocket(url, attempts = 50) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const connect = () => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => socket.close(), 300);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve(socket);
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        socket.close();
        attempt += 1;
        if (attempt >= attempts) reject(new Error('Codex shared App Server did not start.'));
        else setTimeout(connect, 60);
      }, { once: true });
    };
    connect();
  });
}

async function acquireSharedServer(codexBin) {
  if (!sharedServerPromise) {
    sharedServerPromise = (async () => {
      const port = await reserveLoopbackPort();
      const url = `ws://127.0.0.1:${port}`;
      const child = spawn(codexBin, ['app-server', '--listen', url], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: process.env,
        windowsHide: true,
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (process.env.MICRODEX_DEBUG !== '1') return;
        const message = chunk.trim();
        if (message) console.error(`[codex app-server] ${message}`);
      });
      child.on('exit', () => {
        if (sharedServer?.child === child) {
          sharedServer = undefined;
          sharedServerPromise = undefined;
        }
      });
      sharedServer = { child, url, clients: 0 };
      return sharedServer;
    })().catch((error) => {
      sharedServer = undefined;
      sharedServerPromise = undefined;
      throw error;
    });
  }
  const server = await sharedServerPromise;
  server.clients += 1;
  return server;
}

function releaseSharedServer(server) {
  if (!server) return;
  server.clients = Math.max(0, server.clients - 1);
  if (server.clients === 0) {
    server.child.kill('SIGTERM');
    server.child.stderr?.destroy();
    server.child.unref();
    const forceStop = setTimeout(() => {
      if (server.child.exitCode === null && server.child.signalCode === null) {
        server.child.kill('SIGKILL');
      }
    }, 500);
    forceStop.unref();
    if (sharedServer === server) {
      sharedServer = undefined;
      sharedServerPromise = undefined;
    }
  }
}

export function projectNameFromCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return 'General';
  const normalized = path.normalize(cwd);
  const segments = normalized.split(path.sep).filter(Boolean);
  const codexIndex = segments.lastIndexOf('Codex');
  if (codexIndex >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(segments[codexIndex + 1] ?? '')) {
    return 'Codex';
  }
  return path.basename(normalized) || 'General';
}

function publicThread(thread, settings, supportedReasoningEfforts = DEFAULT_REASONING_EFFORTS) {
  const rawStatus = thread.status ?? { type: 'notLoaded' };
  const flags = rawStatus.type === 'active' ? rawStatus.activeFlags ?? [] : [];
  let status = rawStatus.type;
  if (flags.includes('waitingOnApproval')) status = 'waiting';
  else if (flags.includes('waitingOnUserInput')) status = 'waiting';
  else if (rawStatus.type === 'active') status = 'thinking';
  else if (rawStatus.type === 'systemError') status = 'error';
  else if (rawStatus.type === 'notLoaded') status = 'idle';
  else if (rawStatus.type === 'idle' || rawStatus.type === 'loaded') status = 'complete';
  else status = 'idle';

  return {
    id: thread.id,
    name: thread.name || thread.preview || 'Untitled task',
    task: thread.preview || thread.cwd || 'Codex task',
    project: projectNameFromCwd(thread.cwd),
    status,
    updatedAt: thread.updatedAt,
    fastMode: isFastServiceTier(settings?.serviceTier),
    reasoningEffort: settings?.reasoningEffort ?? 'medium',
    supportedReasoningEfforts,
  };
}

export class CodexAppServer {
  #socket;
  #sharedServer;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();
  #settings = new Map();
  #settingsRevision = new Map();
  #settingsWaiters = new Map();
  #status = new Map();
  #threadSnapshots = new Map();
  #threadModels = new Map();
  #threadReasoningEfforts = new Map();
  #modelCatalogPromise;
  #approvals = new Map();
  #changeListeners = new Set();
  #selectedThreadId = null;
  #readyPromise;
  #closed = false;

  constructor() {
    liveClients.add(this);
    this.#readyPromise = this.#start();
  }

  receiveSharedSettings(threadId, settings) {
    const current = this.#settings.get(threadId) ?? {};
    const next = { ...current, ...settings };
    this.#settings.set(threadId, next);
    sharedSettings.set(threadId, next);
  }

  recordSettings({ threadId, fastMode, reasoningEffort }) {
    const target = threadId || this.#selectedThreadId;
    if (!target) return;
    const current = sharedSettings.get(target) ?? this.#settings.get(target) ?? {};
    const next = { ...current };
    if (typeof fastMode === 'boolean') {
      next.serviceTier = serviceTierForFastMode(fastMode);
    }
    if (reasoningEffort) next.reasoningEffort = reasoningEffort;
    for (const client of liveClients) client.receiveSharedSettings(target, next);
  }

  markSelectedThread(threadId) {
    this.#selectedThreadId = threadId || null;
  }

  forgetThread(threadId) {
    if (!threadId) return;
    this.#settings.delete(threadId);
    this.#status.delete(threadId);
    this.#threadSnapshots.delete(threadId);
    this.#threadModels.delete(threadId);
    this.#threadReasoningEfforts.delete(threadId);
    sharedSettings.delete(threadId);
    if (this.#selectedThreadId === threadId) this.#selectedThreadId = null;
  }

  clearSelection() {
    this.#selectedThreadId = null;
  }

  async #start() {
    const codexBin = await resolveCodexBinary();
    this.#sharedServer = await acquireSharedServer(codexBin);
    this.#socket = await openWebSocket(this.#sharedServer.url);
    this.#socket.addEventListener('message', (event) => {
      const chunk = typeof event.data === 'string'
        ? event.data
        : Buffer.from(event.data).toString('utf8');
      this.#consume(`${chunk}\n`);
    });
    this.#socket.addEventListener('close', () => {
      this.#closed = true;
      const error = new Error('Codex App Server connection closed.');
      for (const entry of this.#pending.values()) entry.reject(error);
      this.#pending.clear();
    });

    await this.request('initialize', {
      clientInfo: { name: 'microdex', title: 'Microdex', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
  }

  #consume(chunk) {
    this.#buffer += chunk;
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.#handle(JSON.parse(line));
      } catch (error) {
        console.error(`[codex app-server] Invalid message: ${error.message}`);
      }
    }
  }

  #handle(message) {
    if (message.id !== undefined && !message.method) {
      const entry = this.#pending.get(String(message.id));
      if (!entry) return;
      this.#pending.delete(String(message.id));
      clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(message.error.message || 'Codex request failed.'));
      else entry.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      if (message.method === 'item/commandExecution/requestApproval' ||
          message.method === 'item/fileChange/requestApproval') {
        this.#approvals.set(String(message.id), {
          requestId: String(message.id),
          method: message.method,
          threadId: message.params.threadId,
          turnId: message.params.turnId,
          itemId: message.params.itemId,
          reason: message.params.reason || null,
          command: message.params.command || null,
        });
        this.#emitChange(message.method);
      } else {
        this.respond(message.id, { error: { code: -32601, message: 'Unsupported client request.' } });
      }
      return;
    }

    const { method, params = {} } = message;
    if (method === 'thread/status/changed') this.#status.set(params.threadId, params.status);
    if (method === 'thread/settings/updated') {
      const settings = {
        serviceTier: params.threadSettings.serviceTier,
        reasoningEffort: params.threadSettings.effort || 'medium',
      };
      this.#settings.set(params.threadId, settings);
      this.#settingsRevision.set(
        params.threadId,
        (this.#settingsRevision.get(params.threadId) ?? 0) + 1,
      );
      const waiters = this.#settingsWaiters.get(params.threadId);
      if (waiters) {
        this.#settingsWaiters.delete(params.threadId);
        for (const waiter of waiters) waiter(settings);
      }
    }
    if (method === 'serverRequest/resolved') this.#approvals.delete(String(params.requestId));
    if (STATE_CHANGE_METHODS.has(method)) this.#emitChange(method);
  }

  #emitChange(change) {
    for (const listener of this.#changeListeners) {
      queueMicrotask(() => listener(change));
    }
  }

  subscribe(listener) {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  #write(message) {
    if (this.#closed || this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Codex App Server is offline.');
    }
    this.#socket.send(JSON.stringify(message));
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  respond(id, payload) {
    this.#write({ id, ...payload });
  }

  request(method, params = {}) {
    const id = String(this.#nextId++);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timeout });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  async ready() {
    await this.#readyPromise;
  }

  async listThreads(limit = 30) {
    await this.ready();
    const response = await this.request('thread/list', {
      limit,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      archived: false,
    });
    return response.data.map((thread) => {
      this.#threadSnapshots.set(thread.id, thread);
      const liveStatus = this.#status.get(thread.id);
      return publicThread(
        liveStatus ? { ...thread, status: liveStatus } : thread,
        sharedSettings.get(thread.id) ?? this.#settings.get(thread.id),
        this.#threadReasoningEfforts.get(thread.id),
      );
    });
  }

  async #modelCatalog() {
    if (!this.#modelCatalogPromise) {
      this.#modelCatalogPromise = this.request('model/list', { includeHidden: true })
        .then((response) => response.data ?? response.models ?? [])
        .catch((error) => {
          this.#modelCatalogPromise = undefined;
          throw error;
        });
    }
    return this.#modelCatalogPromise;
  }

  async #rememberModelCapabilities(threadId, modelId) {
    if (!threadId || !modelId) return;
    this.#threadModels.set(threadId, modelId);
    const models = await this.#modelCatalog();
    const model = models.find((entry) => entry.id === modelId);
    // Codex may advertise levels Microdex does not drive, so the reported list
    // is narrowed to the supported ladder instead of being trusted as-is.
    const supported = (model?.supportedReasoningEfforts ?? [])
      .map((entry) => entry.reasoningEffort)
      .filter((effort) => effort && REASONING_EFFORTS.includes(effort));
    this.#threadReasoningEfforts.set(
      threadId,
      supported.length ? supported : DEFAULT_REASONING_EFFORTS,
    );
  }

  async #resume(threadId) {
    await this.ready();
    const response = await this.request('thread/resume', { threadId, excludeTurns: true });
    this.#settings.set(threadId, {
      serviceTier: response.serviceTier,
      reasoningEffort: response.reasoningEffort || 'medium',
    });
    this.#threadSnapshots.set(threadId, response.thread);
    this.#status.set(threadId, response.thread.status);
    await this.#rememberModelCapabilities(
      threadId,
      response.model || response.thread?.model,
    );
    return response;
  }

  async #waitForSettingsUpdate(threadId, afterRevision, timeoutMs = 1_500) {
    if ((this.#settingsRevision.get(threadId) ?? 0) > afterRevision) {
      return this.#settings.get(threadId) ?? {};
    }
    return new Promise((resolve) => {
      const waiters = this.#settingsWaiters.get(threadId) ?? new Set();
      let timeout;
      const finish = (settings) => {
        clearTimeout(timeout);
        waiters.delete(finish);
        if (!waiters.size) this.#settingsWaiters.delete(threadId);
        resolve(settings);
      };
      waiters.add(finish);
      this.#settingsWaiters.set(threadId, waiters);
      timeout = setTimeout(
        () => finish(this.#settings.get(threadId) ?? {}),
        timeoutMs,
      );
    });
  }

  async selectThread(threadId) {
    await this.#resume(threadId);
    this.#selectedThreadId = threadId;
    if (process.platform === 'darwin') {
      const opener = spawn('open', [`codex://threads/${encodeURIComponent(threadId)}`], {
        stdio: 'ignore',
        detached: true,
      });
      opener.unref();
    }
    return this.state();
  }

  async updateSettings({ threadId, fastMode, reasoningEffort }) {
    const target = threadId || this.#selectedThreadId;
    if (!target) throw new Error('Select a Codex task first.');
    if (!this.#settings.has(target) || !this.#threadReasoningEfforts.has(target)) {
      await this.#resume(target);
    }
    if (
      reasoningEffort &&
      !this.#threadReasoningEfforts.get(target)?.includes(reasoningEffort)
    ) {
      const error = new Error(
        `${reasoningEffort} reasoning is not supported by the active Codex model.`,
      );
      error.statusCode = 409;
      throw error;
    }
    const params = { threadId: target };
    if (typeof fastMode === 'boolean') {
      params.serviceTier = serviceTierForFastMode(fastMode);
    }
    if (reasoningEffort) params.effort = reasoningEffort;
    const settingsRevision = this.#settingsRevision.get(target) ?? 0;
    await this.request('thread/settings/update', params);

    // The update response is intentionally empty. The authoritative value is
    // delivered by thread/settings/updated, so wait for that notification
    // instead of inventing the requested state or trusting a stale resume.
    const confirmedSettings = await this.#waitForSettingsUpdate(
      target,
      settingsRevision,
    );

    for (const client of liveClients) client.receiveSharedSettings(target, confirmedSettings);
    return this.state();
  }

  async forkThread(threadId) {
    const target = threadId || this.#selectedThreadId;
    if (!target) throw new Error('Select a Codex task first.');
    const response = await this.request('thread/fork', { threadId: target, excludeTurns: true });
    this.#selectedThreadId = response.thread.id;
    this.#threadSnapshots.set(response.thread.id, response.thread);
    this.#settings.set(response.thread.id, {
      serviceTier: response.serviceTier,
      reasoningEffort: response.reasoningEffort || 'medium',
    });
    await this.#rememberModelCapabilities(
      response.thread.id,
      response.model || response.thread?.model,
    );
    if (process.platform === 'darwin') {
      const opener = spawn('open', [`codex://threads/${encodeURIComponent(response.thread.id)}`], {
        stdio: 'ignore',
        detached: true,
      });
      opener.unref();
    }
    return this.state();
  }

  async archiveThread(threadId) {
    const target = threadId || this.#selectedThreadId;
    if (!target) throw new Error('Select a Codex task first.');
    await this.request('thread/archive', { threadId: target });
    this.#settings.delete(target);
    this.#status.delete(target);
    this.#threadSnapshots.delete(target);
    this.#threadModels.delete(target);
    this.#threadReasoningEfforts.delete(target);
    if (this.#selectedThreadId === target) this.#selectedThreadId = null;
    return this.state();
  }

  async openNewThread() {
    await this.ready();
    const selectedSnapshot = this.#selectedThreadId
      ? this.#threadSnapshots.get(this.#selectedThreadId)
      : null;
    const response = await this.request('thread/start', {
      cwd: selectedSnapshot?.cwd || process.cwd(),
    });
    this.#selectedThreadId = response.thread.id;
    this.#threadSnapshots.set(response.thread.id, response.thread);
    this.#settings.set(response.thread.id, {
      serviceTier: response.serviceTier,
      reasoningEffort: response.reasoningEffort || 'medium',
    });
    await this.#rememberModelCapabilities(
      response.thread.id,
      response.model || response.thread?.model,
    );
    if (process.platform === 'darwin') {
      const threadOpener = spawn('open', [
        `codex://threads/${encodeURIComponent(response.thread.id)}`,
      ], {
        stdio: 'ignore',
        detached: true,
      });
      threadOpener.unref();
    }
    return this.state();
  }

  async resolveApproval(decision) {
    const approvals = [...this.#approvals.values()];
    const selected = approvals.find((entry) => entry.threadId === this.#selectedThreadId) || approvals[0];
    if (!selected) throw new Error('There is no pending approval.');
    this.respond(selected.requestId, { result: { decision: decision === 'approve' ? 'accept' : 'decline' } });
    this.#approvals.delete(selected.requestId);
    return this.state();
  }

  async state() {
    let threads = await this.listThreads(30);
    if (!this.#selectedThreadId && threads[0]) this.#selectedThreadId = threads[0].id;
    let selected = threads.find((thread) => thread.id === this.#selectedThreadId) || null;
    if (
      this.#selectedThreadId &&
      (
        (!sharedSettings.has(this.#selectedThreadId) &&
          !this.#settings.has(this.#selectedThreadId)) ||
        !this.#threadReasoningEfforts.has(this.#selectedThreadId)
      )
    ) {
      try {
        await this.#resume(this.#selectedThreadId);
      } catch (error) {
        // A running Codex turn owns the task writer, so thread/resume can be
        // rejected even though thread/list already returned a valid live
        // snapshot. Keep the controller online with that snapshot and retry
        // hydration on the next state read after the turn finishes.
        if (!canUseThreadSnapshotAfterResumeError(error)) throw error;
      }
    }
    if (this.#selectedThreadId) {
      const snapshot = this.#threadSnapshots.get(this.#selectedThreadId);
      if (snapshot) {
        const liveStatus = this.#status.get(this.#selectedThreadId);
        selected = publicThread(
          liveStatus ? { ...snapshot, status: liveStatus } : snapshot,
          sharedSettings.get(this.#selectedThreadId) ?? this.#settings.get(this.#selectedThreadId),
          this.#threadReasoningEfforts.get(this.#selectedThreadId),
        );
        threads = threads.map((thread) =>
          thread.id === selected.id ? selected : thread
        );
      }
    }
    if (!selected) selected = threads[0] || null;
    this.#selectedThreadId = selected?.id || null;
    const visibleThreads = selected && !threads.some((thread) => thread.id === selected.id)
      ? [selected, ...threads].slice(0, 30)
      : threads;
    return {
      online: true,
      selectedThreadId: selected?.id || null,
      selected,
      threads: visibleThreads,
      pendingApproval: [...this.#approvals.values()].find(
        (entry) => !selected || entry.threadId === selected.id,
      ) || null,
    };
  }

  close() {
    this.#changeListeners.clear();
    liveClients.delete(this);
    if (!this.#closed) this.#socket?.close();
    releaseSharedServer(this.#sharedServer);
    this.#sharedServer = undefined;
  }
}
