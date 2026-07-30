import { executeCodexDesktopAction } from './codex-desktop-control.mjs';
import {
  applyFastSetting,
  applyReasoningSetting,
} from './remote-settings.mjs';

import { REASONING_EFFORTS } from './codex-config.mjs';

const DEFAULT_EFFORTS = REASONING_EFFORTS;

export const CODEX_KEYCAP_IDS = Object.freeze([
  'FAST',
  'APPR',
  'REJ',
  'SPLIT',
  'MIC',
  'CODEX',
  'BUG',
  'OAI',
  'TERM',
  'DWN',
  'DEL',
  'NEW',
  'NAV',
  'MAGIC',
  'DIFF',
  'PLAY',
  'GIT',
  'BRCH',
  'BRANCH',
  'MRG',
  'PR',
  'PAINT',
  'LAB',
  'PARTY',
  'TIME',
  'MIND+',
  'MIND-',
  'EMPT1',
  'EMPT2',
  'EMPT3',
  'EMPT4',
  'EMPT5',
  'SETUP',
  'FOLD',
  'UPL',
  'APPS',
  'YOLO',
  'YEET',
]);

export const DEFAULT_KEYCAP_COMMANDS = Object.freeze({
  FAST: 'composer.toggleFastMode',
  APPR: 'approval.approve',
  REJ: 'approval.decline',
  SPLIT: 'forkThread',
  CODEX: 'composer.submit',
});

const BASE_PROGRAMMABLE_ACTIONS = [
  {
    id: 'composer.toggleFastMode',
    label: 'Fast Mode',
    kind: 'fast',
  },
  {
    id: 'approval.approve',
    label: 'Approve',
    kind: 'approve',
  },
  {
    id: 'approval.decline',
    label: 'Reject',
    kind: 'decline',
  },
  {
    id: 'forkThread',
    label: 'Fork task',
    kind: 'fork',
  },
  {
    id: 'composer.submit',
    label: 'Send',
    kind: 'desktop',
    desktopAction: 'send',
  },
  {
    id: 'composer.startDictation',
    label: 'Push to talk',
    kind: 'desktop',
    desktopAction: 'dictation',
  },
  {
    id: 'composer.togglePlanMode',
    label: 'Plan Mode',
    kind: 'desktop',
    desktopAction: 'plan',
  },
  {
    id: 'navigateForward',
    label: 'Forward',
    kind: 'desktop',
    desktopAction: 'forward',
  },
  {
    id: 'toggleSidebar',
    label: 'Sidebar',
    kind: 'desktop',
    desktopAction: 'sidebar',
  },
  {
    id: 'navigateBack',
    label: 'Back',
    kind: 'desktop',
    desktopAction: 'back',
  },
  {
    id: 'composer.increaseReasoningEffort',
    label: 'Effort up',
    kind: 'effort',
    delta: 1,
  },
  {
    id: 'composer.decreaseReasoningEffort',
    label: 'Effort down',
    kind: 'effort',
    delta: -1,
  },
  // Menu-driven Codex commands. Each one maps to a real item in the Codex
  // application menu bar, which is the most reliable channel available.
  {
    id: 'chat.previous',
    label: 'Previous chat',
    kind: 'desktop',
    desktopAction: 'previous-chat',
  },
  {
    id: 'chat.next',
    label: 'Next chat',
    kind: 'desktop',
    desktopAction: 'next-chat',
  },
  {
    id: 'chat.new',
    label: 'New chat',
    kind: 'desktop',
    desktopAction: 'new-chat',
  },
  {
    id: 'chat.archive',
    label: 'Archive chat',
    kind: 'desktop',
    desktopAction: 'archive-chat',
  },
  {
    id: 'workspace.toggleTerminal',
    label: 'Terminal',
    kind: 'desktop',
    desktopAction: 'terminal',
  },
  {
    id: 'workspace.toggleFileTree',
    label: 'File tree',
    kind: 'desktop',
    desktopAction: 'file-tree',
  },
  {
    id: 'workspace.toggleReviewPanel',
    label: 'Review panel',
    kind: 'desktop',
    desktopAction: 'review',
  },
  {
    id: 'workspace.toggleBottomPanel',
    label: 'Bottom panel',
    kind: 'desktop',
    desktopAction: 'bottom-panel',
  },
  {
    id: 'workspace.togglePinnedSummary',
    label: 'Pinned summary',
    kind: 'desktop',
    desktopAction: 'pinned-summary',
  },
  {
    id: 'workspace.find',
    label: 'Find',
    kind: 'desktop',
    desktopAction: 'find',
  },
  {
    id: 'workspace.scheduled',
    label: 'Scheduled tasks',
    kind: 'desktop',
    desktopAction: 'scheduled',
  },
  {
    id: 'workspace.keyboardShortcuts',
    label: 'Keyboard shortcuts',
    kind: 'desktop',
    desktopAction: 'keyboard-shortcuts',
  },
  {
    id: 'composer.attachFiles',
    label: 'Attach files',
    kind: 'desktop',
    desktopAction: 'attach-files',
  },
  {
    id: 'composer.clear',
    label: 'Clear composer',
    kind: 'desktop',
    desktopAction: 'clear-composer',
  },
  {
    id: 'composer.openCommandMenu',
    label: 'Command menu',
    kind: 'desktop',
    desktopAction: 'command-menu-open',
  },
  {
    id: 'composer.openModelPicker',
    label: 'Model picker',
    kind: 'desktop',
    desktopAction: 'model-picker',
  },
  {
    id: 'thread.copyMarkdown',
    label: 'Copy as Markdown',
    kind: 'desktop',
    desktopAction: 'copy-markdown',
  },
  {
    id: 'thread.continueInWorktree',
    label: 'Continue in worktree',
    kind: 'desktop',
    desktopAction: 'worktree',
  },
  {
    id: 'microdex.insertPrompt',
    label: 'Custom prompt',
    kind: 'custom',
  },
];

const CONTEXTUAL_ACTIONS = new Set([
  'approval.approve',
  'approval.decline',
  'microdex.insertPrompt',
]);
const TASK_SCOPED_ACTIONS = new Set([
  'composer.toggleFastMode',
  'forkThread',
  'composer.submit',
  'composer.startDictation',
  'composer.togglePlanMode',
  'composer.increaseReasoningEffort',
  'composer.decreaseReasoningEffort',
  'microdex.insertPrompt',
  // These operate on the open task or its composer.
  'chat.archive',
  'composer.attachFiles',
  'composer.clear',
  'composer.openCommandMenu',
  'composer.openModelPicker',
  'thread.copyMarkdown',
  'thread.continueInWorktree',
]);

export const CODEX_PROGRAMMABLE_ACTIONS = Object.freeze(
  BASE_PROGRAMMABLE_ACTIONS.map((action) => Object.freeze({
    ...action,
    availability: CONTEXTUAL_ACTIONS.has(action.id) ? 'contextual' : 'runtime',
  })),
);

// Kept as a read-only compatibility export for older integrations. It now
// correctly contains executable actions, not printed keycaps.
export const CODEX_KEYCAP_ACTIONS = CODEX_PROGRAMMABLE_ACTIONS;

const LEGACY_ACTION_IDS = Object.freeze({
  FAST: 'composer.toggleFastMode',
  APPR: 'approval.approve',
  REJ: 'approval.decline',
  SPLIT: 'forkThread',
  MIC: 'composer.startDictation',
  CODEX: 'composer.submit',
  PLAN: 'composer.togglePlanMode',
  FORWARD: 'navigateForward',
  SIDEBAR: 'toggleSidebar',
  BACK: 'navigateBack',
  'MIND+': 'composer.increaseReasoningEffort',
  'MIND-': 'composer.decreaseReasoningEffort',
});

export function getProgrammedAction(commandId) {
  return CODEX_PROGRAMMABLE_ACTIONS.find((action) => action.id === commandId) ?? null;
}

export function normalizeProgrammedAction({
  action,
  actionId,
  customText,
} = {}) {
  if (action?.type === 'command') {
    const resolved = getProgrammedAction(action.commandId);
    if (!resolved || resolved.kind === 'custom') {
      const error = new Error(`Unknown Codex command: ${action.commandId || 'missing'}`);
      error.statusCode = 400;
      throw error;
    }
    return { commandId: resolved.id, customText: undefined };
  }
  if (action?.type === 'prompt') {
    return {
      commandId: 'microdex.insertPrompt',
      customText: String(action.text || customText || '').trim(),
    };
  }
  if (typeof actionId === 'string' && getProgrammedAction(actionId)) {
    return { commandId: actionId, customText };
  }
  const legacyCommandId = LEGACY_ACTION_IDS[actionId];
  if (legacyCommandId) return { commandId: legacyCommandId, customText };
  if (typeof actionId === 'string' && actionId.startsWith('EMPT')) {
    return {
      commandId: 'microdex.insertPrompt',
      customText: String(customText || '').trim(),
    };
  }
  if (typeof actionId === 'string' && CODEX_KEYCAP_IDS.includes(actionId)) {
    const error = new Error(
      `${actionId} is a printed keycap, not a Codex action. Choose a command for this key.`,
    );
    error.statusCode = 409;
    throw error;
  }
  const error = new Error('Missing programmable action.');
  error.statusCode = 400;
  throw error;
}

function boundedEffort(current, delta, supportedEfforts = DEFAULT_EFFORTS) {
  const efforts = supportedEfforts.length ? supportedEfforts : DEFAULT_EFFORTS;
  const currentIndex = Math.max(0, efforts.indexOf(current));
  return efforts[Math.min(efforts.length - 1, Math.max(0, currentIndex + delta))];
}

function unavailable(reason) {
  return { status: 'unavailable', reason };
}

function contextual(reason) {
  return { status: 'contextual', reason };
}

const available = Object.freeze({ status: 'available', reason: null });

export function buildActionAvailability({ state, desktop, native }) {
  const desktopReason = !desktop?.available
    ? desktop?.error || desktop?.reason || 'Desktop controls are unavailable on this Mac.'
    : !desktop?.trusted
      ? 'Allow MicrodexDesktop in System Settings → Privacy & Security → Accessibility.'
      : !desktop?.running
        ? 'Open the Codex app on the Mac first.'
        : null;
  const selectedReason = state?.selected ? null : 'Select a Codex task first.';

  const availability = Object.fromEntries(CODEX_PROGRAMMABLE_ACTIONS.map((action) => {
    let result = available;
    if (
      ['approval.approve', 'approval.decline'].includes(action.id) &&
      !state?.pendingApproval
    ) {
      result = contextual('This key becomes available when Codex asks for approval.');
    } else if (selectedReason && TASK_SCOPED_ACTIONS.has(action.id)) {
      result = unavailable(selectedReason);
    } else if (
      desktopReason &&
      ['desktop', 'custom', 'fast', 'effort'].includes(action.kind)
    ) {
      result = unavailable(desktopReason);
    }
    return [action.id, result];
  }));

  // The fixed controls in older app builds still address their printed cap.
  for (const [keycapId, commandId] of Object.entries({
    ...DEFAULT_KEYCAP_COMMANDS,
    MIC: 'composer.startDictation',
    'MIND+': 'composer.increaseReasoningEffort',
    'MIND-': 'composer.decreaseReasoningEffort',
    PLAN: 'composer.togglePlanMode',
    FORWARD: 'navigateForward',
    SIDEBAR: 'toggleSidebar',
    BACK: 'navigateBack',
  })) {
    availability[keycapId] = availability[commandId];
  }
  return availability;
}

export async function executeProgrammedAction({
  commandId,
  customText,
  threadId,
  codex,
  applyFast,
  applyReasoning,
  resolveApproval,
  executeFork,
  executeDesktop = executeCodexDesktopAction,
}) {
  const action = getProgrammedAction(commandId);
  if (!action) {
    const error = new Error(`Unknown programmable action: ${commandId}`);
    error.statusCode = 400;
    throw error;
  }

  const currentState = await codex.state();
  const targetThreadId = threadId || currentState.selectedThreadId;

  switch (action.kind) {
    case 'fast': {
      if (!currentState.selected) throw new Error('Select a Codex task first.');
      const body = {
        threadId: targetThreadId,
        fastMode: !currentState.selected.fastMode,
      };
      if (applyFast) return applyFast(body);
      return (await applyFastSetting({
        body,
        codex,
        executeDesktopAction: executeCodexDesktopAction,
      })).state;
    }
    case 'approve':
    case 'decline': {
      const decision = action.kind;
      if (currentState.pendingApproval) {
        return resolveApproval
          ? resolveApproval(decision)
          : codex.resolveApproval(decision);
      }
      const error = new Error('There is no pending approval.');
      error.statusCode = 409;
      throw error;
    }
    case 'fork':
      if (executeFork) return executeFork(targetThreadId);
      await executeDesktop('fork-chat');
      codex.clearSelection?.();
      return codex.state();
    case 'effort': {
      if (!currentState.selected) throw new Error('Select a Codex task first.');
      const reasoningEffort = boundedEffort(
        currentState.selected.reasoningEffort,
        action.delta,
        currentState.selected.supportedReasoningEfforts,
      );
      const body = {
        threadId: targetThreadId,
        reasoningEffort,
        reasoningDirection: action.delta > 0 ? 'reasoning-up' : 'reasoning-down',
      };
      if (applyReasoning) return applyReasoning(body);
      return (await applyReasoningSetting({
        body,
        codex,
        executeDesktopAction: executeCodexDesktopAction,
      })).state;
    }
    case 'desktop':
      await executeDesktop(action.desktopAction);
      return codex.state();
    case 'custom': {
      const text = String(customText || '').trim();
      if (!text) {
        const error = new Error('Add a custom prompt before using this key.');
        error.statusCode = 400;
        throw error;
      }
      await executeDesktop('insert-text', text);
      return codex.state();
    }
    default:
      throw new Error(`Unsupported programmable action: ${commandId}`);
  }
}
