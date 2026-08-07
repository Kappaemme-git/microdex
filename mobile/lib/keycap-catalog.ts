import type { MicrodexIconName } from '@/components/microdex-icon';
import type { MicroKeycapId, ProgrammableCommandId } from '@/lib/programmed-keys';

export type KeycapIcon = MicrodexIconName;

export type KeycapDescriptor = {
  id: MicroKeycapId;
  /** Human-readable name of the printed symbol, used by screen readers. */
  name: string;
  /** Microdex-owned semantic icon alias rendered through Tabler. */
  icon: KeycapIcon;
  /**
   * Commands historically associated with this identifier. Choosing one in the
   * editor selects the same identifier so older saved layouts remain valid.
   */
  commands?: readonly ProgrammableCommandId[];
};

/**
 * Stable key identifiers retained in their historical order. These are storage
 * and bridge compatibility IDs, not claims about third-party artwork.
 */
export const KEYCAP_CATALOG: readonly KeycapDescriptor[] = [
  { id: 'CODEX', name: 'Codex', icon: 'robot-outline', commands: ['composer.submit'] },
  { id: 'OAI', name: 'OpenAI', icon: 'blur', commands: ['app.openDocumentation'] },
  {
    id: 'MIND+',
    name: 'Mind up',
    icon: 'brain',
    commands: ['composer.increaseReasoningEffort'],
  },
  {
    id: 'MIND-',
    name: 'Mind down',
    icon: 'head-cog-outline',
    commands: ['composer.decreaseReasoningEffort'],
  },
  { id: 'FAST', name: 'Fast', icon: 'lightning-bolt-outline', commands: ['composer.toggleFastMode'] },
  { id: 'APPR', name: 'Approve', icon: 'check-circle-outline', commands: ['approval.approve'] },
  { id: 'REJ', name: 'Reject', icon: 'close-circle-outline', commands: ['approval.decline'] },
  {
    id: 'SPLIT',
    name: 'Split',
    icon: 'call-split',
    commands: ['forkThread', 'thread.continueInWorktree'],
  },
  { id: 'MIC', name: 'Microphone', icon: 'microphone-outline', commands: ['composer.startDictation'] },
  {
    id: 'PLAY',
    name: 'Play',
    icon: 'play-circle-outline',
    commands: ['workspace.runEnvironment', 'composer.togglePlanMode'],
  },
  { id: 'TERM', name: 'Terminal', icon: 'console', commands: ['workspace.toggleTerminal'] },
  {
    id: 'DIFF',
    name: 'Diff',
    icon: 'plus-minus-variant',
    commands: ['workspace.toggleReviewPanel', 'workspace.toggleBottomPanel'],
  },
  { id: 'GIT', name: 'Git', icon: 'source-branch', commands: ['git.commit'] },
  {
    id: 'BRCH',
    name: 'Draft pull request',
    icon: 'source-branch-plus',
    commands: ['git.createDraftPullRequest'],
  },
  {
    id: 'BRANCH',
    name: 'Branch',
    icon: 'arrow-decision-outline',
    commands: ['git.createBranch', 'chat.next'],
  },
  {
    id: 'MRG',
    name: 'Merge',
    icon: 'source-merge',
    commands: ['git.mergePullRequest', 'chat.previous'],
  },
  { id: 'PR', name: 'Pull request', icon: 'source-pull', commands: ['git.createPullRequest'] },
  {
    id: 'NAV',
    name: 'Navigate',
    icon: 'cursor-default-click-outline',
    commands: ['workspace.openBrowser', 'navigateForward', 'navigateBack'],
  },
  {
    id: 'MAGIC',
    name: 'Magic',
    icon: 'star-four-points-outline',
    commands: ['workspace.togglePinnedSummary', 'composer.openCommandMenu'],
  },
  {
    id: 'PAINT',
    name: 'Paint',
    icon: 'format-paint',
    commands: ['composer.attachFiles', 'workspace.toggleFileTree'],
  },
  { id: 'LAB', name: 'Lab', icon: 'flask-outline', commands: ['app.openSettings'] },
  { id: 'BUG', name: 'Bug', icon: 'bug-outline', commands: ['app.sendFeedback', 'workspace.find'] },
  { id: 'PARTY', name: 'Party', icon: 'party-popper', commands: ['workspace.openSideChat', 'chat.new'] },
  { id: 'TIME', name: 'Time', icon: 'clock-outline', commands: ['workspace.scheduled'] },
  { id: 'DWN', name: 'Download', icon: 'tray-arrow-down', commands: ['thread.copyMarkdown'] },
  { id: 'UPL', name: 'Upload', icon: 'cloud-upload-outline', commands: ['composer.attachFiles'] },
  { id: 'DEL', name: 'Delete', icon: 'trash-can-outline', commands: ['chat.archive', 'composer.clear'] },
  { id: 'NEW', name: 'New', icon: 'plus-box-outline', commands: ['chat.new'] },
  { id: 'FOLD', name: 'Folder', icon: 'folder-plus-outline', commands: ['app.openFolder'] },
  {
    id: 'SETUP',
    name: 'Setup',
    icon: 'cog-outline',
    commands: ['app.openSettings', 'workspace.keyboardShortcuts'],
  },
  {
    id: 'APPS',
    name: 'Apps',
    icon: 'dots-grid',
    commands: ['workspace.openSkills', 'composer.openModelPicker', 'toggleSidebar'],
  },
  { id: 'YOLO', name: 'Yolo', icon: 'rocket-launch-outline' },
  { id: 'YEET', name: 'Yeet', icon: 'arrow-top-right-thick' },
  { id: 'EMPT1', name: 'Blank 1', icon: 'checkbox-blank-outline' },
  { id: 'EMPT2', name: 'Blank 2', icon: 'checkbox-blank-outline' },
  { id: 'EMPT3', name: 'Blank 3', icon: 'checkbox-blank-outline' },
  { id: 'EMPT4', name: 'Blank 4', icon: 'checkbox-blank-outline' },
  { id: 'EMPT5', name: 'Blank 5', icon: 'checkbox-blank-outline' },
];

const byId = new Map(KEYCAP_CATALOG.map((keycap) => [keycap.id, keycap]));

export function keycapDescriptor(id: MicroKeycapId | null | undefined) {
  return id ? byId.get(id) ?? null : null;
}

/**
 * The key identifier suggested for a command. The first
 * catalog entry wins when several caps carry the same command, which is why the
 * catalog is ordered by how obvious the pairing is.
 */
const capForCommand = new Map<ProgrammableCommandId, MicroKeycapId>();
for (const keycap of KEYCAP_CATALOG) {
  for (const command of keycap.commands ?? []) {
    if (!capForCommand.has(command)) capForCommand.set(command, keycap.id);
  }
}

export function suggestedKeycapForCommand(
  commandId: ProgrammableCommandId | null | undefined,
): MicroKeycapId | null {
  return commandId ? capForCommand.get(commandId) ?? null : null;
}
