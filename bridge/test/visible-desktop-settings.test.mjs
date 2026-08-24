import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyFastSetting,
  applyReasoningSetting,
} from '../lib/remote-settings.mjs';
import { mergeVisibleDesktopState } from '../lib/visible-desktop-state.mjs';

const swiftSource = await readFile(
  new URL('../native/MicrodexDesktop.swift', import.meta.url),
  'utf8',
);
const controllerSource = [
  await readFile(
    new URL('../../mobile/features/controller/controller-screen.tsx', import.meta.url),
    'utf8',
  ),
  await readFile(
    new URL('../../mobile/features/controller/styles.ts', import.meta.url),
    'utf8',
  ),
].join('\n');
const modelPickerSource = swiftSource.slice(
  swiftSource.indexOf('func findModelPicker()'),
  swiftSource.indexOf('func clickElement(', swiftSource.indexOf('func findModelPicker()')),
);

function confirmedCodex(selected) {
  return {
    async updateSettings() {
      return { selected };
    },
  };
}

test('Fast Mode success requires the visible Codex desktop to apply it', async () => {
  const desktopCalls = [];
  await applyFastSetting({
    body: { threadId: 'thread-1', fastMode: true },
    codex: confirmedCodex({ fastMode: true }),
    executeDesktopAction: async (...args) => {
      desktopCalls.push(args);
      return { ok: true };
    },
  });

  assert.deepEqual(
    desktopCalls,
    [['fast', 'true']],
    'App-server confirmation alone must not be reported as visible desktop success.',
  );
});

test('reasoning success requires the visible Codex desktop to apply the exact effort', async () => {
  const desktopCalls = [];
  await applyReasoningSetting({
    body: { threadId: 'thread-1', reasoningEffort: 'xhigh' },
    codex: confirmedCodex({ reasoningEffort: 'xhigh' }),
    executeDesktopAction: async (...args) => {
      desktopCalls.push(args);
      return { ok: true };
    },
  });

  assert.deepEqual(
    desktopCalls,
    [['reasoning-up', 'xhigh']],
    'The exact effort must reach the visible Codex composer.',
  );
});

test('Fast Mode never deep-links away from the visible Codex task', async () => {
  const calls = [];
  await applyFastSetting({
    body: { threadId: 'thread-target', fastMode: true },
    codex: {
      async selectThread(threadId) {
        calls.push(['select', threadId]);
      },
      async updateSettings(settings) {
        calls.push(['update', settings.threadId]);
        return { selected: { fastMode: settings.fastMode } };
      },
    },
    executeDesktopAction: async (...args) => {
      calls.push(['desktop', ...args]);
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [
    ['desktop', 'fast', 'true'],
    ['update', 'thread-target'],
  ]);
});

test('reasoning never deep-links away from the visible Codex task', async () => {
  const calls = [];
  await applyReasoningSetting({
    body: { threadId: 'thread-target', reasoningEffort: 'xhigh' },
    codex: {
      async selectThread(threadId) {
        calls.push(['select', threadId]);
      },
      async updateSettings(settings) {
        calls.push(['update', settings.threadId]);
        return { selected: { reasoningEffort: settings.reasoningEffort } };
      },
    },
    executeDesktopAction: async (...args) => {
      calls.push(['desktop', ...args]);
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [
    ['desktop', 'reasoning-up', 'xhigh'],
    ['update', 'thread-target'],
  ]);
});

// Recognizing the picker is not the same as offering a level. Codex names the
// popup after the current model, e.g. "5.6 Sol Ultra", so these titles must keep
// matching even for levels Microdex refuses to select.
test('the desktop model picker recognizes every supported reasoning title', () => {
  const supportedTitles = [
    ' minimal',
    ' light',
    ' low',
    ' medium',
    ' high',
    ' xhigh',
    ' extended',
    ' max',
    ' ultra',
  ];
  const missingTitles = supportedTitles.filter(
    (title) => !modelPickerSource.includes(`"${title}"`),
  );
  assert.deepEqual(missingTitles, [], 'model picker must recognize every supported title');
});

test('desktop controls use Codex Speed and Effort menus instead of stale coordinates', () => {
  // The picker toggle is labelled by destination, not by current state: Codex
  // shows "Show compact options" once the advanced view is already open. The
  // companion has to read that as "nothing to do", because clicking it would
  // collapse the view and hide Speed and Effort again.
  const prepare = swiftSource.slice(
    swiftSource.indexOf('func prepareAdvancedModelPicker()'),
    swiftSource.indexOf('func compactMenuSummary'),
  );
  const compactIndex = prepare.indexOf('"Show compact options"');
  const advancedIndex = prepare.indexOf('"Show advanced options"');
  assert.ok(compactIndex > -1, 'the already-advanced label must be recognized');
  assert.ok(advancedIndex > -1, 'the compact-to-advanced label must be recognized');
  assert.ok(advancedIndex > compactIndex, 'compact must be checked first');
  // Seeing the compact label means the work is done: return without clicking.
  assert.match(
    prepare.slice(compactIndex, advancedIndex),
    /!= nil \{\s*return\s*\}/,
  );
  assert.match(prepare, /clickElement\(advancedToggle\)/);
  assert.match(swiftSource, /compactMenuItem\(named: "Speed"\)/);
  assert.match(swiftSource, /compactMenuItem\(named: "Effort"\)/);
  // Each level accepts several spellings, because Codex names the lowest
  // effort "Light" or "Low" and the highest "Extra High", "XHigh" or
  // "Extended" depending on the model. Max and Ultra have no alias by design.
  assert.match(swiftSource, /"xhigh": \["Extra High", "XHigh", "Extended"\]/);
  assert.match(swiftSource, /"low": \["Light", "Low"\]/);
  // A level the active model does not offer must be reported, not waited out.
  assert.match(swiftSource, /firstAvailableMenuItem\(startingWithAnyOf: candidates\)/);
  assert.match(swiftSource, /Codex does not offer \\\(targetLabel\) for this model/);
  assert.match(swiftSource, /waitForMenuItem\(startingWith: targetLabel\)/);
  assert.ok(swiftSource.includes('$0.hasPrefix("\\(needle) ")'));
  assert.match(swiftSource, /for _ in 0\.\.<12/);
  assert.doesNotMatch(swiftSource, /targetIndex \+ 1/);
  assert.doesNotMatch(swiftSource, /reasoning slider is not available/);
});

test('the visible Codex Stop control drives the selected task into thinking', () => {
  const state = {
    selectedThreadId: 'thread-1',
    selected: { id: 'thread-1', status: 'complete' },
    threads: [
      { id: 'thread-1', status: 'complete' },
      { id: 'thread-2', status: 'complete' },
    ],
  };
  const merged = mergeVisibleDesktopState(state, {
    available: true,
    trusted: true,
    running: true,
    working: true,
  });
  assert.equal(merged.selected.status, 'thinking');
  assert.equal(merged.threads[0].status, 'thinking');
  assert.equal(merged.threads[1].status, 'complete');
  assert.match(swiftSource, /exactly: "Stop"/);
  assert.match(swiftSource, /"working": working/);
  assert.match(controllerSource, /activeAgent\.status === 'thinking'/);
  assert.match(controllerSource, /LED\.thinking/);
});

test('resting or unavailable desktop state does not invent activity', () => {
  const state = {
    selected: { id: 'thread-1', status: 'complete' },
    threads: [{ id: 'thread-1', status: 'complete' }],
  };
  assert.equal(
    mergeVisibleDesktopState(state, {
      available: true,
      trusted: true,
      running: true,
      working: false,
    }),
    state,
  );
});

test('the Micro keyboard and composer are moved lower without absolute positioning', () => {
  assert.match(controllerSource, /deviceGlow:\s*\{[\s\S]*?marginTop: 10,/);
  assert.match(controllerSource, /composerPanel:\s*\{[\s\S]*?marginTop: 18,/);
  assert.doesNotMatch(controllerSource, /deviceGlow:\s*\{[^}]*position: 'absolute'/);
});
