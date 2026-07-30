import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MICRO_KEYCAP_IDS,
  PROGRAMMABLE_COMMAND_IDS,
  legacyActionIdForProgrammedKey,
  parseProgrammedKeys,
  programmedActionId,
} from '../lib/programmed-keys.ts';

test('all readable Codex Micro keycaps are labels, not actions', () => {
  assert.equal(MICRO_KEYCAP_IDS.length, 38);
  assert.equal(new Set(MICRO_KEYCAP_IDS).size, MICRO_KEYCAP_IDS.length);
  for (const keycapId of [
    'BUG', 'GIT', 'PR', 'YOLO', 'YEET', 'BRANCH', 'EMPT5',
  ]) {
    assert.ok(MICRO_KEYCAP_IDS.includes(keycapId));
    assert.equal(PROGRAMMABLE_COMMAND_IDS.includes(keycapId), false);
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

test('malformed storage falls back to six empty programmable slots', () => {
  assert.deepEqual(parseProgrammedKeys('not json'), [
    null, null, null, null, null, null,
  ]);
  assert.deepEqual(parseProgrammedKeys(JSON.stringify([null])), [
    null, null, null, null, null, null,
  ]);
});
