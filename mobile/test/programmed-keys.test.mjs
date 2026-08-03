import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MICRO_KEYCAP_IDS,
  PROGRAMMABLE_COMMAND_IDS,
  defaultProgrammedKeys,
  legacyActionIdForProgrammedKey,
  parseProgrammedKeys,
  programmedActionId,
} from '../lib/programmed-keys.ts';
import {
  OFFICIAL_CODEX_MICRO_GLYPHS,
  OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS,
} from '../lib/official-codex-micro-glyphs.ts';

test('the official Codex Micro artwork covers every physical keycap', () => {
  assert.deepEqual(
    Object.keys(OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS).sort(),
    [...MICRO_KEYCAP_IDS].sort(),
  );

  for (const [keycapId, legend] of Object.entries(
    OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS,
  )) {
    if (['empty', 'yolo', 'yeet'].includes(legend)) continue;
    assert.ok(
      OFFICIAL_CODEX_MICRO_GLYPHS[legend],
      `${keycapId} points at missing official artwork ${legend}`,
    );
  }
});

test('the six default controls use their official legends', () => {
  assert.deepEqual(
    Object.fromEntries(
      ['FAST', 'APPR', 'REJ', 'SPLIT', 'MIC', 'CODEX'].map((keycapId) => [
        keycapId,
        OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS[keycapId],
      ]),
    ),
    {
      FAST: 'lightning-outline',
      APPR: 'check-circle',
      REJ: 'x-circle',
      SPLIT: 'worktree',
      MIC: 'mic',
      CODEX: 'codex',
    },
  );
});

test('printed Codex Micro keycaps stay separate from command ids', () => {
  assert.equal(MICRO_KEYCAP_IDS.length, 38);
  assert.equal(new Set(MICRO_KEYCAP_IDS).size, MICRO_KEYCAP_IDS.length);
  for (const keycapId of [
    'BUG', 'GIT', 'PR', 'YOLO', 'YEET', 'BRANCH', 'EMPT5',
  ]) {
    assert.ok(MICRO_KEYCAP_IDS.includes(keycapId));
    assert.equal(PROGRAMMABLE_COMMAND_IDS.includes(keycapId), false);
  }
});

test('every official non-blank keycap has a default action', async () => {
  const { defaultActionForKeycap, DEFAULT_KEYCAP_PROMPTS } = await import(
    '../lib/programmed-keys.ts'
  );
  for (const keycapId of MICRO_KEYCAP_IDS) {
    if (keycapId.startsWith('EMPT')) {
      assert.equal(defaultActionForKeycap(keycapId), null);
      continue;
    }
    const action = defaultActionForKeycap(keycapId);
    assert.ok(action, `${keycapId} needs an official default`);
    if (keycapId === 'YOLO' || keycapId === 'YEET') {
      assert.equal(action.type, 'prompt');
      assert.equal(action.text, DEFAULT_KEYCAP_PROMPTS[keycapId]);
    } else {
      assert.equal(action.type, 'command');
      assert.ok(PROGRAMMABLE_COMMAND_IDS.includes(action.commandId));
    }
  }
});

test('a keycap and its assigned Codex command round-trip independently', () => {
  const keys = parseProgrammedKeys(JSON.stringify([
    {
      keycapId: 'GIT',
      action: {
        type: 'command',
        commandId: 'composer.toggleFastMode',
      },
    },
    null,
    null,
    null,
    null,
    null,
  ]));
  assert.deepEqual(keys[0], {
    keycapId: 'GIT',
    action: {
      type: 'command',
      commandId: 'composer.toggleFastMode',
    },
  });
  assert.equal(programmedActionId(keys[0]), 'composer.toggleFastMode');
  assert.equal(legacyActionIdForProgrammedKey(keys[0]), 'FAST');
});

test('verified legacy assignments migrate to real command ids', () => {
  const keys = parseProgrammedKeys(JSON.stringify([
    { actionId: 'FAST' },
    { actionId: 'PLAN' },
    { actionId: 'MIND+' },
    { actionId: 'EMPT4', customText: 'Run all tests' },
    null,
    null,
  ]));
  assert.equal(programmedActionId(keys[0]), 'composer.toggleFastMode');
  assert.equal(programmedActionId(keys[1]), 'composer.togglePlanMode');
  assert.equal(
    programmedActionId(keys[2]),
    'composer.increaseReasoningEffort',
  );
  assert.deepEqual(keys[3], {
    keycapId: 'EMPT4',
    action: {
      type: 'prompt',
      text: 'Run all tests',
    },
  });
  assert.equal(legacyActionIdForProgrammedKey(keys[3]), 'EMPT1');
});

test('fake legacy keycap behavior is removed without discarding the cap', () => {
  const keys = parseProgrammedKeys(JSON.stringify([
    { actionId: 'GIT' },
    { actionId: 'PR' },
    { actionId: 'YOLO' },
    null,
    null,
    null,
  ]));
  assert.deepEqual(keys.slice(0, 3), [
    { keycapId: 'GIT', action: null },
    { keycapId: 'PR', action: null },
    { keycapId: 'YOLO', action: null },
  ]);
});

test('malformed storage falls back to the official default layout', () => {
  assert.deepEqual(parseProgrammedKeys('not json'), defaultProgrammedKeys());
  assert.deepEqual(
    parseProgrammedKeys(JSON.stringify([null])),
    defaultProgrammedKeys(),
  );
});
