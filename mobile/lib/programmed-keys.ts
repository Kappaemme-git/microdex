export const PROGRAMMED_KEY_COUNT = 6;

export const MICRO_KEYCAP_IDS = [
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
] as const;

export type MicroKeycapId = (typeof MICRO_KEYCAP_IDS)[number];

export const PROGRAMMABLE_COMMAND_IDS = [
  'composer.toggleFastMode',
  'approval.approve',
  'approval.decline',
  'forkThread',
  'composer.submit',
  'composer.startDictation',
  'composer.togglePlanMode',
  'navigateForward',
  'toggleSidebar',
  'navigateBack',
  'composer.increaseReasoningEffort',
  'composer.decreaseReasoningEffort',
  'chat.previous',
  'chat.next',
  'chat.new',
  'chat.archive',
  'workspace.toggleTerminal',
  'workspace.toggleFileTree',
  'workspace.toggleReviewPanel',
  'workspace.toggleBottomPanel',
  'workspace.togglePinnedSummary',
  'workspace.find',
  'workspace.scheduled',
  'workspace.keyboardShortcuts',
  'workspace.openBrowser',
  'workspace.openSkills',
  'workspace.openSideChat',
  'workspace.runEnvironment',
  'composer.attachFiles',
  'composer.clear',
  'composer.openCommandMenu',
  'composer.openModelPicker',
  'thread.copyMarkdown',
  'thread.continueInWorktree',
  'app.openSettings',
  'app.openDocumentation',
  'app.sendFeedback',
  'app.openFolder',
  'git.commit',
  'git.createBranch',
  'git.createDraftPullRequest',
  'git.createPullRequest',
  'git.mergePullRequest',
] as const;

export type ProgrammableCommandId = (typeof PROGRAMMABLE_COMMAND_IDS)[number];

export type ProgrammedKeyAction =
  | {
      type: 'command';
      commandId: ProgrammableCommandId;
    }
  | {
      type: 'prompt';
      text: string;
    };

export type ProgrammedKey = {
  keycapId: MicroKeycapId;
  action: ProgrammedKeyAction | null;
};

export const EMPTY_PROGRAMMED_KEYS: readonly null[] = Array.from(
  { length: PROGRAMMED_KEY_COUNT },
  () => null,
);

/**
 * Official Codex Micro defaults extracted from the desktop keycap catalog.
 * MIC is push-to-talk on hardware; Microdex uses `composer.startDictation`.
 * YOLO / YEET insert the matching composer slash-text.
 * Blank EMPT caps stay unassigned until the user programs them.
 */
export const DEFAULT_KEYCAP_COMMANDS: Readonly<
  Partial<Record<MicroKeycapId, ProgrammableCommandId>>
> = {
  FAST: 'composer.toggleFastMode',
  APPR: 'approval.approve',
  REJ: 'approval.decline',
  SPLIT: 'forkThread',
  MIC: 'composer.startDictation',
  CODEX: 'composer.submit',
  BUG: 'app.sendFeedback',
  OAI: 'app.openDocumentation',
  TERM: 'workspace.toggleTerminal',
  DWN: 'thread.copyMarkdown',
  DEL: 'chat.archive',
  NEW: 'chat.new',
  NAV: 'workspace.openBrowser',
  MAGIC: 'workspace.togglePinnedSummary',
  DIFF: 'workspace.toggleReviewPanel',
  PLAY: 'workspace.runEnvironment',
  GIT: 'git.commit',
  BRCH: 'git.createDraftPullRequest',
  BRANCH: 'git.createBranch',
  MRG: 'git.mergePullRequest',
  PR: 'git.createPullRequest',
  PAINT: 'composer.attachFiles',
  LAB: 'app.openSettings',
  PARTY: 'workspace.openSideChat',
  TIME: 'workspace.scheduled',
  'MIND+': 'composer.increaseReasoningEffort',
  'MIND-': 'composer.decreaseReasoningEffort',
  SETUP: 'app.openSettings',
  FOLD: 'app.openFolder',
  UPL: 'composer.attachFiles',
  APPS: 'workspace.openSkills',
};

export const DEFAULT_KEYCAP_PROMPTS: Readonly<
  Partial<Record<MicroKeycapId, string>>
> = {
  YOLO: ':yolo:',
  YEET: ':yeet:',
};

/** Slots ACT06, ACT07, ACT08, ACT09, ACT10_ACT11 and ACT12 of the shipped layout. */
export const DEFAULT_MICRO_LAYOUT: readonly MicroKeycapId[] = [
  'FAST',
  'APPR',
  'REJ',
  'SPLIT',
  'MIC',
  'CODEX',
];

const keycapIds = new Set<string>(MICRO_KEYCAP_IDS);
const commandIds = new Set<string>(PROGRAMMABLE_COMMAND_IDS);

export function defaultActionForKeycap(
  keycapId: MicroKeycapId,
): ProgrammedKeyAction | null {
  const commandId = DEFAULT_KEYCAP_COMMANDS[keycapId];
  if (commandId) return { type: 'command', commandId };
  const prompt = DEFAULT_KEYCAP_PROMPTS[keycapId];
  return prompt ? { type: 'prompt', text: prompt } : null;
}

export function defaultProgrammedKeys(): (ProgrammedKey | null)[] {
  return DEFAULT_MICRO_LAYOUT.map((keycapId) => ({
    keycapId,
    action: defaultActionForKeycap(keycapId),
  }));
}

const LEGACY_COMMAND_IDS: Readonly<Record<string, ProgrammableCommandId>> = {
  FAST: 'composer.toggleFastMode',
  APPR: 'approval.approve',
  REJ: 'approval.decline',
  SPLIT: 'forkThread',
  CODEX: 'composer.submit',
  MIC: 'composer.startDictation',
  PLAN: 'composer.togglePlanMode',
  FORWARD: 'navigateForward',
  SIDEBAR: 'toggleSidebar',
  BACK: 'navigateBack',
  'MIND+': 'composer.increaseReasoningEffort',
  'MIND-': 'composer.decreaseReasoningEffort',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isMicroKeycapId(value: unknown): value is MicroKeycapId {
  return typeof value === 'string' && keycapIds.has(value);
}

export function isProgrammableCommandId(
  value: unknown,
): value is ProgrammableCommandId {
  return typeof value === 'string' && commandIds.has(value);
}

export function programmedActionId(programmed: ProgrammedKey | null | undefined) {
  if (!programmed?.action) return null;
  return programmed.action.type === 'command'
    ? programmed.action.commandId
    : 'microdex.insertPrompt';
}

export function legacyActionIdForProgrammedKey(
  programmed: ProgrammedKey | null | undefined,
) {
  if (!programmed?.action) return null;
  if (programmed.action.type === 'prompt') return 'EMPT1';
  const commandId = programmed.action.commandId;
  return Object.entries(LEGACY_COMMAND_IDS).find(
    ([, legacyCommandId]) => legacyCommandId === commandId,
  )?.[0] ?? null;
}

function parseAction(value: unknown): ProgrammedKeyAction | null {
  if (!isRecord(value)) return null;
  if (
    value.type === 'command' &&
    isProgrammableCommandId(value.commandId)
  ) {
    return { type: 'command', commandId: value.commandId };
  }
  if (value.type === 'prompt') {
    const text = String(value.text ?? '').trim();
    return text ? { type: 'prompt', text } : null;
  }
  return null;
}

function migrateLegacyKey(
  value: Record<string, unknown>,
  slotIndex: number,
): ProgrammedKey | null {
  const actionId = typeof value.actionId === 'string' ? value.actionId : '';
  const fallbackKeycap = `EMPT${Math.min(slotIndex + 1, 5)}`;
  const keycapId = isMicroKeycapId(actionId)
    ? actionId
    : isMicroKeycapId(fallbackKeycap)
      ? fallbackKeycap
      : 'EMPT1';
  const commandId = LEGACY_COMMAND_IDS[actionId];
  if (commandId) {
    return {
      keycapId,
      action: { type: 'command', commandId },
    };
  }
  if (actionId.startsWith('EMPT')) {
    const text = String(value.customText ?? '').trim();
    return {
      keycapId,
      action: text ? { type: 'prompt', text } : null,
    };
  }
  // The old app incorrectly treated optional printed caps such as GIT, PR and
  // YOLO as hard-coded commands. Keep the chosen cap, but require the user to
  // assign a real command instead of silently running the invented behavior.
  return isMicroKeycapId(actionId) ? { keycapId, action: null } : null;
}

export function parseProgrammedKeys(raw: string | null | undefined) {
  if (!raw) return defaultProgrammedKeys();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== PROGRAMMED_KEY_COUNT) {
      return defaultProgrammedKeys();
    }
    return parsed.map((entry, slotIndex) => {
      if (!isRecord(entry)) return null;
      if ('actionId' in entry) return migrateLegacyKey(entry, slotIndex);
      if (!isMicroKeycapId(entry.keycapId)) return null;
      return {
        keycapId: entry.keycapId,
        // A stored cap without an explicit assignment keeps the behavior the
        // hardware gives it, instead of becoming a dead key.
        action: parseAction(entry.action) ?? defaultActionForKeycap(entry.keycapId),
      };
    });
  } catch {
    return defaultProgrammedKeys();
  }
}
