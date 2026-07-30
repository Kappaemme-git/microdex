import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps } from 'react';

import type { MicroKeycapId, ProgrammableCommandId } from '@/lib/programmed-keys';

export type KeycapIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type KeycapDescriptor = {
  id: MicroKeycapId;
  /** Human-readable name of the printed symbol, used by screen readers. */
  name: string;
  /** Closest match to the silkscreen on the physical cap. */
  icon: KeycapIcon;
  /**
   * Commands this cap is printed for. Choosing one of them in the editor selects
   * this cap, so the deck never shows a label that contradicts what the key
   * does. A cap can cover a family, e.g. NAV for both navigation directions.
   * Caps without any are blanks or decoration.
   */
  commands?: readonly ProgrammableCommandId[];
};

/**
 * The printed caps shipped with the Codex Micro, in tray order.
 *
 * Caps and commands stay independent on the hardware: a cap is a piece of
 * plastic and can sit on any switch. The `command` field is only the suggestion
 * the editor pre-selects, never a constraint.
 */
export const KEYCAP_CATALOG: readonly KeycapDescriptor[] = [
  { id: 'CODEX', name: 'Codex', icon: 'robot-outline', commands: ['composer.submit'] },
  { id: 'OAI', name: 'OpenAI', icon: 'blur' },
  { id: 'MIND+', name: 'Mind up', icon: 'brain', commands: ['composer.increaseReasoningEffort'] },
  { id: 'MIND-', name: 'Mind down', icon: 'head-cog-outline', commands: ['composer.decreaseReasoningEffort'] },
  { id: 'FAST', name: 'Fast', icon: 'lightning-bolt-outline', commands: ['composer.toggleFastMode'] },
  { id: 'APPR', name: 'Approve', icon: 'check-circle-outline', commands: ['approval.approve'] },
  { id: 'REJ', name: 'Reject', icon: 'close-circle-outline', commands: ['approval.decline'] },
  { id: 'SPLIT', name: 'Split', icon: 'call-split', commands: ['forkThread'] },
  { id: 'MIC', name: 'Microphone', icon: 'microphone-outline', commands: ['composer.startDictation'] },
  { id: 'PLAY', name: 'Play', icon: 'play-circle-outline', commands: ['composer.togglePlanMode'] },
  { id: 'TERM', name: 'Terminal', icon: 'console', commands: ['workspace.toggleTerminal'] },
  {
    id: 'DIFF',
    name: 'Diff',
    icon: 'dots-vertical',
    commands: ['workspace.toggleReviewPanel', 'workspace.toggleBottomPanel'],
  },
  { id: 'GIT', name: 'Git', icon: 'source-branch', commands: ['thread.continueInWorktree'] },
  { id: 'BRCH', name: 'Branch', icon: 'source-branch-plus', commands: ['forkThread'] },
  { id: 'BRANCH', name: 'Branch out', icon: 'arrow-decision-outline', commands: ['chat.next'] },
  { id: 'MRG', name: 'Merge', icon: 'source-merge', commands: ['chat.previous'] },
  { id: 'PR', name: 'Pull request', icon: 'source-pull', commands: ['thread.copyMarkdown'] },
  {
    id: 'NAV',
    name: 'Navigate',
    icon: 'send-outline',
    commands: ['navigateForward', 'navigateBack'],
  },
  { id: 'MAGIC', name: 'Magic', icon: 'star-four-points-outline', commands: ['composer.openCommandMenu'] },
  { id: 'PAINT', name: 'Paint', icon: 'format-paint', commands: ['workspace.toggleFileTree'] },
  { id: 'LAB', name: 'Lab', icon: 'flask-outline', commands: ['workspace.togglePinnedSummary'] },
  { id: 'BUG', name: 'Bug', icon: 'bug-outline', commands: ['workspace.find'] },
  { id: 'PARTY', name: 'Party', icon: 'party-popper', commands: ['chat.new'] },
  { id: 'TIME', name: 'Time', icon: 'clock-outline', commands: ['workspace.scheduled'] },
  { id: 'DWN', name: 'Download', icon: 'tray-arrow-down', commands: ['composer.attachFiles'] },
  { id: 'UPL', name: 'Upload', icon: 'cloud-upload-outline', commands: ['composer.attachFiles'] },
  { id: 'DEL', name: 'Delete', icon: 'trash-can-outline', commands: ['composer.clear'] },
  { id: 'NEW', name: 'New', icon: 'plus-box-outline', commands: ['chat.new'] },
  { id: 'FOLD', name: 'Folder', icon: 'folder-plus-outline', commands: ['chat.archive'] },
  { id: 'SETUP', name: 'Setup', icon: 'cog-outline', commands: ['workspace.keyboardShortcuts'] },
  {
    id: 'APPS',
    name: 'Apps',
    icon: 'dots-grid',
    commands: ['composer.openModelPicker', 'toggleSidebar'],
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
 * The cap printed for a command, used to pre-select one in the editor. The first
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
