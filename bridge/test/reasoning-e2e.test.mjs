import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CodexAppServer } from '../lib/codex-app-server.mjs';
import { REASONING_EFFORTS as BRIDGE_EFFORTS } from '../lib/codex-config.mjs';

const mobileSource = await readFile(
  new URL('../../mobile/app/index.tsx', import.meta.url),
  'utf8',
);

function assertDynamicMobileEfforts() {
  assert.match(
    mobileSource,
    /activeThread\?\.supportedReasoningEfforts/,
    'The mobile dial must use the active model capability list.',
  );
}

/**
 * Levels Codex may advertise that Microdex deliberately refuses to drive. Max is
 * not applied reliably by any targeted model and Ultra burns usage limits, so the
 * dial stops at Extra High. This test used to demand that Microdex expose
 * everything the model reports, which is the opposite of that decision: on
 * gpt-5.6-sol it failed with `missingFromBridge: ['max', 'ultra']` and would have
 * stayed red forever, hiding a real regression underneath.
 */
const EXCLUDED_BY_DESIGN = ['max', 'ultra'];

test('the bridge exposes its supported effort ladder and nothing above the ceiling', () => {
  assertDynamicMobileEfforts();
  const leaked = BRIDGE_EFFORTS.filter((effort) => EXCLUDED_BY_DESIGN.includes(effort));
  assert.deepEqual(leaked, [], 'the ladder must stop at Extra High');
  assert.ok(BRIDGE_EFFORTS.length, 'Microdex must expose at least one reasoning effort');
});

test('every effort on the mobile dial is shared without taking the task writer', async () => {
  const microdex = new CodexAppServer();
  const desktop = new CodexAppServer();
  let threadId;

  try {
    await Promise.all([microdex.ready(), desktop.ready()]);
    const [thread] = await microdex.listThreads(1);
    assert.ok(thread, 'A recent Codex task is required for the reasoning test.');
    threadId = thread.id;
    await Promise.all([microdex.selectThread(threadId), desktop.selectThread(threadId)]);

    assertDynamicMobileEfforts();
    for (const effort of BRIDGE_EFFORTS) {
      const changed = await microdex.updateSettings({
        threadId,
        reasoningEffort: effort,
      });
      assert.equal(changed.selected.reasoningEffort, effort);

      const observed = await desktop.state();
      assert.equal(
        observed.selected.reasoningEffort,
        effort,
        `The desktop client did not observe reasoning effort ${effort}.`,
      );
    }
  } finally {
    microdex.close();
    desktop.close();
  }
});
