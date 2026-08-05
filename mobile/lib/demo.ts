import type {
  BridgeStatus,
  QueuedMessage,
  ReasoningEffort,
  RemoteState,
  RemoteThread,
} from './bridge.ts';

export type DemoResponse = {
  remote: RemoteState;
  response: RemoteState | { messageQueue: QueuedMessage[] };
};

function demoCommandResult(action: string): NonNullable<RemoteState['commandResult']> {
  return {
    action,
    applied: true,
    verified: true,
    confirmed: true,
    evidence: 'desktop',
    desktopMirrored: false,
    warning: null,
  };
}

export function createDemoRemoteState(now = Date.now()): RemoteState {
  const threads: RemoteThread[] = [
    {
      id: 'demo-controller',
      name: 'Polish the mobile controller',
      task: 'Review the final App Store experience',
      project: 'Microdex Demo',
      status: 'thinking',
      updatedAt: now,
      fastMode: true,
      reasoningEffort: 'high',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    {
      id: 'demo-pairing',
      name: 'Secure pairing flow',
      task: 'Verify encrypted phone pairing',
      project: 'Microdex Demo',
      status: 'complete',
      updatedAt: now - 1_000,
      fastMode: false,
      reasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    {
      id: 'demo-review',
      name: 'App Review sandbox',
      task: 'Prepare fictional reviewer data',
      project: 'Release Demo',
      status: 'waiting',
      updatedAt: now - 2_000,
      fastMode: false,
      reasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
  ];
  return {
    online: true,
    selectedThreadId: threads[0].id,
    selected: threads[0],
    threads,
    messageQueue: [],
    pendingApproval: null,
    actionAvailability: {},
    voice: { state: 'inactive', muted: false },
    commandResult: null,
  };
}

export function createDemoStatus(
  remote: RemoteState,
  programmableActions = 0,
): BridgeStatus {
  return {
    connected: true,
    bridge: { name: 'Microdex Demo', version: '1.0', protocolVersion: 3 },
    capabilities: {
      verifiedSettings: true,
      remoteChat: true,
      taskControl: true,
      programmableActions,
      programmableAssignments: true,
      encoderModes: true,
      desktopAutomation: true,
      actionAvailability: true,
      visibleDesktopRouting: true,
      endToEndEncryption: true,
    },
    fastMode: remote.selected?.fastMode ?? false,
    reasoningEffort: remote.selected?.reasoningEffort ?? 'medium',
    configPath: 'local-demo',
    platform: 'demo',
    remote,
  };
}

function replaceSelected(
  remote: RemoteState,
  update: (thread: RemoteThread) => RemoteThread,
): RemoteState {
  if (!remote.selected) return remote;
  const selected = update(remote.selected);
  return {
    ...remote,
    selected,
    threads: remote.threads.map((thread) =>
      thread.id === selected.id ? selected : thread
    ),
  };
}

export function respondToDemoRequest(
  current: RemoteState,
  path: string,
  body: Record<string, unknown> = {},
  now = Date.now(),
): DemoResponse {
  let remote = current;

  if (path === '/api/remote/settings') {
    remote = replaceSelected(remote, (thread) => ({
      ...thread,
      fastMode:
        typeof body.fastMode === 'boolean' ? body.fastMode : thread.fastMode,
      reasoningEffort:
        typeof body.reasoningEffort === 'string'
          ? body.reasoningEffort as ReasoningEffort
          : thread.reasoningEffort,
      updatedAt: now,
    }));
    remote = { ...remote, commandResult: demoCommandResult('settings') };
  } else if (path === '/api/remote/select') {
    const target = remote.threads.find((thread) => thread.id === body.threadId);
    if (target) {
      remote = {
        ...remote,
        selectedThreadId: target.id,
        selected: target,
        commandResult: demoCommandResult('select'),
      };
    }
  } else if (path === '/api/remote/archive') {
    const threads = remote.threads.filter((thread) => thread.id !== body.threadId);
    const selected = remote.selectedThreadId === body.threadId
      ? threads[0] ?? null
      : remote.selected;
    remote = {
      ...remote,
      threads,
      selected,
      selectedThreadId: selected?.id ?? null,
      messageQueue: remote.messageQueue.filter(
        (message) => message.threadId !== body.threadId,
      ),
      commandResult: demoCommandResult('archive'),
    };
  } else if (path === '/api/remote/fork') {
    const fork: RemoteThread = {
      ...(remote.selected ?? remote.threads[0]),
      id: `demo-fork-${now}`,
      name: 'Forked review task',
      task: 'Explore another direction safely',
      status: 'idle',
      updatedAt: now,
    };
    remote = {
      ...remote,
      selected: fork,
      selectedThreadId: fork.id,
      threads: [fork, ...remote.threads],
      commandResult: demoCommandResult('fork'),
    };
  } else if (path === '/api/remote/approval') {
    remote = {
      ...remote,
      pendingApproval: null,
      commandResult: demoCommandResult(String(body.decision ?? 'approval')),
    };
  } else if (path === '/api/remote/send') {
    const message: QueuedMessage = {
      id: `demo-message-${now}`,
      threadId: String(body.threadId ?? remote.selectedThreadId ?? 'demo-controller'),
      text: String(body.text ?? ''),
      status: 'queued',
      createdAt: now,
    };
    remote = {
      ...remote,
      messageQueue: [...remote.messageQueue, message],
      commandResult: demoCommandResult('send'),
    };
    return { remote, response: { messageQueue: remote.messageQueue } };
  } else if (path === '/api/remote/queue/remove') {
    remote = {
      ...remote,
      messageQueue: remote.messageQueue.filter(
        (message) => message.id !== body.messageId,
      ),
      commandResult: demoCommandResult('queue-remove'),
    };
    return { remote, response: { messageQueue: remote.messageQueue } };
  } else if (path === '/api/desktop/action') {
    const action = String(body.action ?? 'desktop-action');
    if (action === 'voice-start') {
      remote = { ...remote, voice: { state: 'active', muted: false } };
    } else if (action === 'voice-toggle-mute') {
      remote = {
        ...remote,
        voice: { state: 'active', muted: !(remote.voice?.muted ?? false) },
      };
    } else if (action === 'voice-end') {
      remote = { ...remote, voice: { state: 'inactive', muted: false } };
    }
    remote = { ...remote, commandResult: demoCommandResult(action) };
  } else if (
    path === '/api/encoder/action' ||
    path === '/api/programmable/action'
  ) {
    remote = { ...remote, commandResult: demoCommandResult(path) };
  }

  return { remote, response: remote };
}
