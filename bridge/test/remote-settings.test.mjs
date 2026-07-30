import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFastSetting,
  applyReasoningSetting,
} from '../lib/remote-settings.mjs';

import { REASONING_EFFORTS } from '../lib/codex-config.mjs';

// Derived, so removing a level from the ladder cannot leave a stale case here.
const EFFORTS = REASONING_EFFORTS;

test('Fast Mode updates both the App Server and visible desktop', async () => {
  const calls = [];
  const body = { threadId: 'thread-1', fastMode: true };
  const result = await applyFastSetting({
    body,
    codex: {
      async updateSettings(settings) {
        calls.push(['app-server', settings.fastMode]);
        return { selected: { fastMode: settings.fastMode } };
      },
    },
    executeDesktopAction: async (...args) => calls.push(['desktop', ...args]),
  });

  assert.equal(result.state.selected.fastMode, true);
  assert.equal(result.desktopSyncError, null);
  assert.deepEqual(calls, [
    ['desktop', 'fast', 'true'],
    ['app-server', true],
  ]);
});

for (const reasoningEffort of EFFORTS) {
  test(`${reasoningEffort} updates both the App Server and visible desktop`, async () => {
    const calls = [];
    const body = {
      threadId: 'thread-1',
      reasoningEffort,
      reasoningDirection: 'reasoning-up',
    };
    const codex = {
      async updateSettings(settings) {
        calls.push(['app-server', settings.reasoningEffort]);
        return { selected: { reasoningEffort: settings.reasoningEffort } };
      },
    };
    const result = await applyReasoningSetting({
      body,
      codex,
      executeDesktopAction: async (...args) => calls.push(['desktop', ...args]),
    });

    assert.equal(result.state.selected.reasoningEffort, reasoningEffort);
    assert.equal(result.desktopSyncError, null);
    assert.deepEqual(calls, [
      ['desktop', 'reasoning-up', reasoningEffort],
      ['app-server', reasoningEffort],
    ]);
  });
}

test('a visible desktop failure is returned without mutating App Server state', async () => {
  const expected = new Error('Codex speed did not change to fast');
  let appServerCalled = false;
  await assert.rejects(
    applyFastSetting({
      body: { threadId: 'thread-1', fastMode: true },
      codex: {
        async updateSettings() {
          appServerCalled = true;
          return { selected: { fastMode: true } };
        },
      },
      executeDesktopAction: async () => {
        throw expected;
      },
    }),
    expected,
  );
  assert.equal(appServerCalled, false);
});

test('a locally recorded effort cannot impersonate confirmation from Codex', async () => {
  let desktopCalled = false;
  const expected = new Error('thread/settings/update failed');
  let localEffort = 'medium';

  await assert.rejects(
    applyReasoningSetting({
      body: {
        threadId: 'thread-1',
        reasoningEffort: 'high',
        reasoningDirection: 'reasoning-up',
      },
      codex: {
        recordSettings(settings) {
          // This is only Microdex's optimistic local overlay. The actual
          // Codex task remains at medium because the update below fails.
          localEffort = settings.reasoningEffort;
        },
        async updateSettings() {
          throw expected;
        },
        async state() {
          return { selected: { reasoningEffort: localEffort } };
        },
      },
      executeDesktopAction: async () => {
        desktopCalled = true;
      },
    }),
    /could not be confirmed|not applied|update failed/i,
  );

  assert.equal(desktopCalled, true);
});

test('Fast Mode cannot report success when Codex keeps it disabled', async () => {
  let desktopCalled = false;

  await assert.rejects(
    applyFastSetting({
      body: {
        threadId: 'thread-1',
        fastMode: true,
      },
      codex: {
        async updateSettings() {
          return {
            selected: {
              fastMode: false,
              reasoningEffort: 'medium',
            },
          };
        },
      },
      executeDesktopAction: async () => {
        desktopCalled = true;
      },
    }),
    /Fast Mode was not applied/i,
  );

  assert.equal(desktopCalled, true);
});

test('reasoning cannot report success when Codex keeps a different effort', async () => {
  let desktopCalled = false;

  await assert.rejects(
    applyReasoningSetting({
      body: {
        threadId: 'thread-1',
        reasoningEffort: 'high',
        reasoningDirection: 'reasoning-up',
      },
      codex: {
        async updateSettings() {
          return {
            selected: {
              fastMode: false,
              reasoningEffort: 'medium',
            },
          };
        },
      },
      executeDesktopAction: async () => {
        desktopCalled = true;
      },
    }),
    /reasoning effort was not applied/i,
  );

  assert.equal(desktopCalled, true);
});
