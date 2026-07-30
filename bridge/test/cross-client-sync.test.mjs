import assert from 'node:assert/strict';
import test from 'node:test';

import { CodexAppServer } from '../lib/codex-app-server.mjs';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('a Fast Mode change reaches another client attached to the same Codex task', async () => {
  const microdex = new CodexAppServer();
  const desktop = new CodexAppServer();
  let threadId;
  let initialFastMode;

  try {
    await Promise.all([microdex.ready(), desktop.ready()]);
    const threads = await microdex.listThreads(1);
    assert.ok(threads[0], 'A recent Codex task is required for this integration test.');
    threadId = threads[0].id;

    await Promise.all([microdex.selectThread(threadId), desktop.selectThread(threadId)]);
    initialFastMode = (await microdex.state()).selected.fastMode;
    const nextFastMode = !initialFastMode;

    await microdex.updateSettings({ threadId, fastMode: nextFastMode });
    await delay(750);

    const desktopState = await desktop.state();
    assert.equal(
      desktopState.selected.fastMode,
      nextFastMode,
      'The desktop client did not receive the Fast Mode update made by the Microdex client.',
    );
  } finally {
    if (threadId && typeof initialFastMode === 'boolean') {
      await microdex.updateSettings({ threadId, fastMode: initialFastMode }).catch(() => {});
    }
    microdex.close();
    desktop.close();
  }
});
