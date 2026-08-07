import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CODEX_KEYCAP_IDS,
  CODEX_PROGRAMMABLE_ACTIONS,
  DEFAULT_KEYCAP_COMMANDS,
  buildActionAvailability,
  getProgrammedAction,
  normalizeProgrammedAction,
} from '../lib/programmed-actions.mjs';

const DEFAULT_KEYCAP_IDS = [
  'FAST', 'APPR', 'REJ', 'SPLIT', 'MIC', 'CODEX',
];

const OPTIONAL_KEYCAP_IDS = [
  'BUG', 'OAI', 'TERM', 'DWN', 'DEL', 'NEW', 'NAV', 'MAGIC', 'DIFF',
  'PLAY', 'GIT', 'BRCH', 'BRANCH', 'MRG', 'PR', 'PAINT', 'LAB', 'PARTY',
  'TIME', 'MIND+', 'MIND-', 'EMPT1', 'EMPT2', 'EMPT3', 'EMPT4', 'EMPT5',
  'SETUP', 'FOLD', 'UPL', 'APPS', 'YOLO', 'YEET',
];

const desktopControlSource = await readFile(
  new URL('../lib/codex-desktop-control.mjs', import.meta.url),
  'utf8',
);
const mobileKeysSource = await readFile(
  new URL('../../mobile/lib/programmed-keys.ts', import.meta.url),
  'utf8',
);

test('the readable Codex Micro keycap catalog is reproduced exactly', () => {
  assert.equal(new Set(CODEX_KEYCAP_IDS).size, CODEX_KEYCAP_IDS.length);
  assert.deepEqual(CODEX_KEYCAP_IDS, [
    ...DEFAULT_KEYCAP_IDS,
    ...OPTIONAL_KEYCAP_IDS,
  ]);
  for (const keycapId of CODEX_KEYCAP_IDS) {
    assert.match(
      mobileKeysSource,
      new RegExp(`'${keycapId.replace('+', '\\+')}'`),
      `mobile missing ${keycapId}`,
    );
  }
});

test('official Codex Micro keycaps resolve to their documented defaults', () => {
  assert.equal(DEFAULT_KEYCAP_COMMANDS.FAST, 'composer.toggleFastMode');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.APPR, 'approval.approve');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.REJ, 'approval.decline');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.SPLIT, 'forkThread');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.MIC, 'composer.startDictation');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.CODEX, 'composer.submit');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.GIT, 'git.commit');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.PR, 'git.createPullRequest');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.TERM, 'workspace.toggleTerminal');
  assert.equal(DEFAULT_KEYCAP_COMMANDS.BUG, 'app.sendFeedback');
  // Blank caps and text caps stay out of the command map.
  assert.equal(DEFAULT_KEYCAP_COMMANDS.YOLO, undefined);
  assert.equal(DEFAULT_KEYCAP_COMMANDS.EMPT1, undefined);
});

test('printed keycap ids are never executable command ids', () => {
  for (const keycapId of OPTIONAL_KEYCAP_IDS) {
    assert.equal(getProgrammedAction(keycapId), null, keycapId);
  }
  for (const keycapId of ['GIT', 'PR', 'BUG', 'YOLO', 'DEL', 'NEW']) {
    assert.throws(
      () => normalizeProgrammedAction({ actionId: keycapId }),
      /printed keycap, not a Codex action/i,
    );
  }
});

test('programmable actions cover the official Micro command set', () => {
  const ids = CODEX_PROGRAMMABLE_ACTIONS.map((action) => action.id);
  for (const required of [
    'composer.toggleFastMode',
    'composer.submit',
    'composer.startDictation',
    'workspace.toggleTerminal',
    'workspace.openBrowser',
    'workspace.openSkills',
    'app.openSettings',
    'app.openDocumentation',
    'app.sendFeedback',
    'app.openFolder',
    'git.commit',
    'git.createBranch',
    'git.createDraftPullRequest',
    'git.createPullRequest',
    'git.mergePullRequest',
    'microdex.insertPrompt',
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('Browser opens the Codex in-app panel through the command menu', () => {
  const browser = CODEX_PROGRAMMABLE_ACTIONS.find(
    (action) => action.id === 'workspace.openBrowser',
  );
  assert.deepEqual(
    {
      desktopAction: browser?.desktopAction,
      desktopPayload: browser?.desktopPayload,
    },
    {
      desktopAction: 'command-menu-search',
      desktopPayload: 'Browser',
    },
  );
});

test('the mobile picker exposes exactly the commands the bridge can run', async () => {
  const [commandIds, microActions] = await Promise.all([
    readFile(new URL('../../mobile/lib/programmed-keys.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../mobile/lib/micro-actions.ts', import.meta.url), 'utf8'),
  ]);
  for (const action of CODEX_PROGRAMMABLE_ACTIONS) {
    if (action.kind !== 'custom') {
      assert.ok(
        commandIds.includes(`'${action.id}'`),
        `${action.id} is missing from PROGRAMMABLE_COMMAND_IDS`,
      );
    }
    assert.ok(
      microActions.includes(`id: '${action.id}'`),
      `${action.id} is missing from MICRO_ACTIONS`,
    );
  }
});

test('every desktop command maps to an action the companion implements', async () => {
  const [swiftSource, controlSource] = await Promise.all([
    readFile(new URL('../native/MicrodexDesktop.swift', import.meta.url), 'utf8'),
    readFile(new URL('../lib/codex-desktop-control.mjs', import.meta.url), 'utf8'),
  ]);
  const implemented = new Set(
    [...swiftSource.matchAll(/^    case "([a-z-]+)":/gm)].map((match) => match[1]),
  );
  for (const action of CODEX_PROGRAMMABLE_ACTIONS) {
    if (!action.desktopAction) continue;
    assert.ok(
      implemented.has(action.desktopAction),
      `${action.desktopAction} has no case in the companion`,
    );
    assert.ok(
      controlSource.includes(`'${action.desktopAction}'`),
      `${action.desktopAction} is not in ALLOWED_ACTIONS`,
    );
  }
});

test('new assignments preserve keycap and command as independent values', () => {
  assert.deepEqual(
    normalizeProgrammedAction({
      keycapId: 'GIT',
      action: {
        type: 'command',
        commandId: 'composer.togglePlanMode',
      },
    }),
    {
      commandId: 'composer.togglePlanMode',
      customText: undefined,
    },
  );
  assert.deepEqual(
    normalizeProgrammedAction({
      keycapId: 'YOLO',
      action: {
        type: 'prompt',
        text: 'Run the tests',
      },
    }),
    {
      commandId: 'microdex.insertPrompt',
      customText: 'Run the tests',
    },
  );
});

test('verified legacy controls migrate without restoring fake keycap behavior', () => {
  assert.deepEqual(
    normalizeProgrammedAction({ actionId: 'FAST' }),
    {
      commandId: 'composer.toggleFastMode',
      customText: undefined,
    },
  );
  assert.deepEqual(
    normalizeProgrammedAction({
      actionId: 'EMPT3',
      customText: 'Review this diff',
    }),
    {
      commandId: 'microdex.insertPrompt',
      customText: 'Review this diff',
    },
  );
});

test('every desktop action used by a verified command is allow-listed', () => {
  const desktopActions = CODEX_PROGRAMMABLE_ACTIONS
    .filter((action) => action.kind === 'desktop')
    .map((action) => action.desktopAction);
  for (const action of [...desktopActions, 'insert-text', 'fork-chat']) {
    assert.match(desktopControlSource, new RegExp(`'${action}'`));
  }
});

test('Native Micro does not bypass Accessibility for visible Codex controls', () => {
  const availability = buildActionAvailability({
    state: {
      selected: {
        id: 'thread-1',
        reasoningEffort: 'medium',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
      },
      pendingApproval: null,
    },
    desktop: {
      available: true,
      trusted: false,
      running: true,
    },
    native: {
      connected: true,
    },
  });
  for (const commandId of [
    'composer.toggleFastMode',
    'composer.submit',
    'composer.togglePlanMode',
    'navigateBack',
    'composer.increaseReasoningEffort',
  ]) {
    assert.equal(availability[commandId].status, 'unavailable', commandId);
    assert.match(availability[commandId].reason, /Accessibility/, commandId);
  }
  assert.equal(availability['approval.approve'].status, 'contextual');
  assert.equal(availability.forkThread.status, 'available');
});

test('task-scoped commands are unavailable until a Codex task is active', () => {
  const availability = buildActionAvailability({
    state: {
      selected: null,
      pendingApproval: null,
    },
    desktop: {
      available: true,
      trusted: true,
      running: true,
    },
    native: {
      connected: false,
    },
  });
  for (const commandId of [
    'composer.toggleFastMode',
    'forkThread',
    'composer.submit',
    'composer.startDictation',
    'composer.togglePlanMode',
    'composer.increaseReasoningEffort',
    'composer.decreaseReasoningEffort',
    'microdex.insertPrompt',
  ]) {
    assert.equal(availability[commandId].status, 'unavailable', commandId);
  }
  assert.equal(availability['approval.approve'].status, 'contextual');
  assert.equal(availability['approval.decline'].status, 'contextual');
});
