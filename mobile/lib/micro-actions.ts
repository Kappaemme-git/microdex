import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps } from 'react';

import {
  DEFAULT_KEYCAP_COMMANDS,
  DEFAULT_MICRO_LAYOUT,
  EMPTY_PROGRAMMED_KEYS,
  MICRO_KEYCAP_IDS,
  PROGRAMMABLE_COMMAND_IDS,
  defaultActionForKeycap,
  defaultProgrammedKeys,
  legacyActionIdForProgrammedKey,
  parseProgrammedKeys,
  programmedActionId,
} from '@/lib/programmed-keys';
import type {
  MicroKeycapId,
  ProgrammedKey,
  ProgrammedKeyAction,
  ProgrammableCommandId,
} from '@/lib/programmed-keys';

export type MicroActionIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type MicroActionId = ProgrammableCommandId | 'microdex.insertPrompt';

export type MicroAction = {
  id: MicroActionId;
  label: string;
  description: string;
  category: 'Core' | 'Task' | 'Input' | 'Workspace' | 'Custom';
  icon: MicroActionIcon;
  custom?: boolean;
  availability: 'runtime' | 'contextual';
};

/**
 * Printed caps and executable actions are intentionally separate.
 *
 * Codex Micro lets a user put any cap on a command slot and then assign a
 * command (or skill) to that slot. A cap such as GIT or YOLO has no built-in
 * behavior by itself.
 */
export const MICRO_KEYCAPS = MICRO_KEYCAP_IDS.map((id) => ({ id }));

export const MICRO_ACTIONS: readonly MicroAction[] = [
  {
    id: 'composer.toggleFastMode',
    label: 'Fast Mode',
    description: 'Toggle Fast Mode for the active Codex task.',
    category: 'Core',
    icon: 'lightning-bolt-outline',
    availability: 'runtime',
  },
  {
    id: 'approval.approve',
    label: 'Approve',
    description: 'Approve the request currently shown by Codex.',
    category: 'Core',
    icon: 'check-circle-outline',
    availability: 'contextual',
  },
  {
    id: 'approval.decline',
    label: 'Reject',
    description: 'Reject the request currently shown by Codex.',
    category: 'Core',
    icon: 'close-circle-outline',
    availability: 'contextual',
  },
  {
    id: 'forkThread',
    label: 'Fork task',
    description: 'Continue the current task in a separate chat.',
    category: 'Task',
    icon: 'call-split',
    availability: 'runtime',
  },
  {
    id: 'composer.submit',
    label: 'Send',
    description: 'Submit the text in the visible Codex composer.',
    category: 'Input',
    icon: 'robot-outline',
    availability: 'runtime',
  },
  {
    id: 'composer.startDictation',
    label: 'Push to talk',
    description: 'Hold to dictate, release to stop, or double-press to latch.',
    category: 'Input',
    icon: 'microphone-outline',
    availability: 'runtime',
  },
  {
    id: 'composer.togglePlanMode',
    label: 'Plan Mode',
    description: 'Toggle Plan Mode for the active Codex composer.',
    category: 'Workspace',
    icon: 'clipboard-text-outline',
    availability: 'runtime',
  },
  {
    id: 'navigateForward',
    label: 'Forward',
    description: 'Move forward in Codex navigation history.',
    category: 'Workspace',
    icon: 'arrow-right',
    availability: 'runtime',
  },
  {
    id: 'toggleSidebar',
    label: 'Sidebar',
    description: 'Show or hide the Codex sidebar.',
    category: 'Workspace',
    icon: 'page-layout-sidebar-left',
    availability: 'runtime',
  },
  {
    id: 'navigateBack',
    label: 'Back',
    description: 'Move back in Codex navigation history.',
    category: 'Workspace',
    icon: 'arrow-left',
    availability: 'runtime',
  },
  {
    id: 'composer.increaseReasoningEffort',
    label: 'Effort up',
    description: 'Increase reasoning effort by one supported level.',
    category: 'Core',
    icon: 'brain',
    availability: 'runtime',
  },
  {
    id: 'composer.decreaseReasoningEffort',
    label: 'Effort down',
    description: 'Decrease reasoning effort by one supported level.',
    category: 'Core',
    icon: 'head-cog-outline',
    availability: 'runtime',
  },
  {
    id: 'chat.previous',
    label: 'Previous chat',
    description: 'Move to the previous Codex chat.',
    category: 'Task',
    icon: 'chevron-up',
    availability: 'runtime',
  },
  {
    id: 'chat.next',
    label: 'Next chat',
    description: 'Move to the next Codex chat.',
    category: 'Task',
    icon: 'chevron-down',
    availability: 'runtime',
  },
  {
    id: 'chat.new',
    label: 'New chat',
    description: 'Start a new Codex chat.',
    category: 'Task',
    icon: 'plus-box-outline',
    availability: 'runtime',
  },
  {
    id: 'chat.archive',
    label: 'Archive chat',
    description: 'Archive the chat currently open in Codex.',
    category: 'Task',
    icon: 'archive-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.toggleTerminal',
    label: 'Terminal',
    description: 'Show or hide the Codex terminal panel.',
    category: 'Workspace',
    icon: 'console',
    availability: 'runtime',
  },
  {
    id: 'workspace.toggleFileTree',
    label: 'File tree',
    description: 'Show or hide the Codex file tree.',
    category: 'Workspace',
    icon: 'file-tree',
    availability: 'runtime',
  },
  {
    id: 'workspace.toggleReviewPanel',
    label: 'Review panel',
    description: 'Show or hide the Codex review panel.',
    category: 'Workspace',
    icon: 'clipboard-check-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.toggleBottomPanel',
    label: 'Bottom panel',
    description: 'Show or hide the Codex bottom panel.',
    category: 'Workspace',
    icon: 'dock-bottom',
    availability: 'runtime',
  },
  {
    id: 'workspace.togglePinnedSummary',
    label: 'Pinned summary',
    description: 'Show or hide the pinned summary.',
    category: 'Workspace',
    icon: 'pin-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.find',
    label: 'Find',
    description: 'Open search inside the Codex window.',
    category: 'Workspace',
    icon: 'magnify',
    availability: 'runtime',
  },
  {
    id: 'workspace.scheduled',
    label: 'Scheduled tasks',
    description: 'Open the Codex scheduled tasks view.',
    category: 'Workspace',
    icon: 'clock-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.keyboardShortcuts',
    label: 'Keyboard shortcuts',
    description: 'Open the Codex keyboard shortcuts reference.',
    category: 'Workspace',
    icon: 'keyboard-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.openBrowser',
    label: 'Browser',
    description: 'Open the Codex browser panel.',
    category: 'Workspace',
    icon: 'web',
    availability: 'runtime',
  },
  {
    id: 'workspace.openSkills',
    label: 'Skills',
    description: 'Open the Codex skills picker.',
    category: 'Workspace',
    icon: 'puzzle-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.openSideChat',
    label: 'Side chat',
    description: 'Open a side chat alongside the current task.',
    category: 'Task',
    icon: 'message-plus-outline',
    availability: 'runtime',
  },
  {
    id: 'workspace.runEnvironment',
    label: 'Run environment',
    description: 'Run the primary environment action for the current task.',
    category: 'Workspace',
    icon: 'play-circle-outline',
    availability: 'runtime',
  },
  {
    id: 'composer.attachFiles',
    label: 'Attach files',
    description: 'Open the file picker for the Codex composer.',
    category: 'Input',
    icon: 'paperclip',
    availability: 'runtime',
  },
  {
    id: 'composer.clear',
    label: 'Clear composer',
    description: 'Empty the visible Codex composer.',
    category: 'Input',
    icon: 'backspace-outline',
    availability: 'runtime',
  },
  {
    id: 'composer.openCommandMenu',
    label: 'Command menu',
    description: 'Open the Codex command menu.',
    category: 'Input',
    icon: 'menu',
    availability: 'runtime',
  },
  {
    id: 'composer.openModelPicker',
    label: 'Model picker',
    description: 'Open the Codex model and effort picker.',
    category: 'Core',
    icon: 'tune-variant',
    availability: 'runtime',
  },
  {
    id: 'thread.copyMarkdown',
    label: 'Copy as Markdown',
    description: 'Copy the open Codex chat as Markdown.',
    category: 'Task',
    icon: 'content-copy',
    availability: 'runtime',
  },
  {
    id: 'thread.continueInWorktree',
    label: 'Continue in worktree',
    description: 'Continue the current task in a new git worktree.',
    category: 'Task',
    icon: 'folder-swap-outline',
    availability: 'runtime',
  },
  {
    id: 'app.openSettings',
    label: 'Settings',
    description: 'Open Codex settings.',
    category: 'Workspace',
    icon: 'cog-outline',
    availability: 'runtime',
  },
  {
    id: 'app.openDocumentation',
    label: 'Documentation',
    description: 'Open the OpenAI / Codex documentation.',
    category: 'Workspace',
    icon: 'book-open-page-variant-outline',
    availability: 'runtime',
  },
  {
    id: 'app.sendFeedback',
    label: 'Send feedback',
    description: 'Open the Codex feedback form.',
    category: 'Workspace',
    icon: 'bug-outline',
    availability: 'runtime',
  },
  {
    id: 'app.openFolder',
    label: 'Open folder',
    description: 'Choose a folder for Codex to work in.',
    category: 'Workspace',
    icon: 'folder-plus-outline',
    availability: 'runtime',
  },
  {
    id: 'git.commit',
    label: 'Git commit',
    description: 'Open the Codex git commit flow.',
    category: 'Task',
    icon: 'source-commit',
    availability: 'runtime',
  },
  {
    id: 'git.createBranch',
    label: 'Create branch',
    description: 'Create a git branch from Codex.',
    category: 'Task',
    icon: 'source-branch',
    availability: 'runtime',
  },
  {
    id: 'git.createDraftPullRequest',
    label: 'Draft pull request',
    description: 'Create a draft pull request from Codex.',
    category: 'Task',
    icon: 'source-branch-plus',
    availability: 'runtime',
  },
  {
    id: 'git.createPullRequest',
    label: 'Create pull request',
    description: 'Create a pull request from Codex.',
    category: 'Task',
    icon: 'source-pull',
    availability: 'runtime',
  },
  {
    id: 'git.mergePullRequest',
    label: 'Merge pull request',
    description: 'Merge the current pull request from Codex.',
    category: 'Task',
    icon: 'source-merge',
    availability: 'runtime',
  },
  {
    id: 'microdex.insertPrompt',
    label: 'Custom prompt',
    description: 'Insert your own reusable prompt in the visible composer.',
    category: 'Custom',
    icon: 'plus-circle-outline',
    custom: true,
    availability: 'contextual',
  },
];

export function findMicroAction(actionId?: string | null) {
  return MICRO_ACTIONS.find((action) => action.id === actionId) ?? null;
}

export {
  DEFAULT_KEYCAP_COMMANDS,
  DEFAULT_MICRO_LAYOUT,
  EMPTY_PROGRAMMED_KEYS,
  MICRO_KEYCAP_IDS,
  PROGRAMMABLE_COMMAND_IDS,
  defaultActionForKeycap,
  defaultProgrammedKeys,
  legacyActionIdForProgrammedKey,
  parseProgrammedKeys,
  programmedActionId,
};
export type {
  MicroKeycapId,
  ProgrammedKey,
  ProgrammedKeyAction,
  ProgrammableCommandId,
};
