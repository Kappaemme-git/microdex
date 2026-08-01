import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CodexAppServer } from '../lib/codex-app-server.mjs';
import { REASONING_EFFORTS as BRIDGE_EFFORTS } from '../lib/codex-config.mjs';

const mobileSource = await readFile(
  new URL('../../mobile/app/index.tsx', import.meta.url),
  'utf8',
);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertDynamicMobileEfforts() {
  assert.match(
    mobileSource,
    /activeThread\?\.supportedReasoningEfforts/,
    'The mobile dial must use the active model capability list.',
  );
}

async function activeModelContext(client) {
  const [thread] = await client.listThreads(1);
  assert.ok(thread, 'A recent Codex task is required for the reasoning test.');
  const resumed = await client.request('thread/resume', {
    threadId: thread.id,
    excludeTurns: true,
  });
  const response = await client.request('model/list', { includeHidden: true });
  const models = response.data ?? response.models ?? [];
  const model = models.find((entry) => entry.id === resumed.model);
  assert.ok(model, `The active Codex model was not returned by model/list: ${resumed.model}`);
  const supported = (model.supportedReasoningEfforts ?? [])
    .map((entry) => entry.reasoningEffort)
    .filter(Boolean);
  assert.ok(supported.length, `No reasoning efforts were reported for ${model.id}.`);
  return {
    threadId: thread.id,
    initialEffort: resumed.reasoningEffort,
    modelId: model.id,
    supported,
  };
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

test('the bridge exposes the model efforts it drives, and nothing above the ceiling', async () => {
  const client = new CodexAppServer();
  try {
    await client.ready();
    const context = await activeModelContext(client);
    assertDynamicMobileEfforts();

    // Everything the model offers, except the levels excluded on purpose, has to
    // be reachable.
    const expected = context.supported.filter(
      (effort) => !EXCLUDED_BY_DESIGN.includes(effort),
    );
    const missingFromBridge = expected.filter(
      (effort) => !BRIDGE_EFFORTS.includes(effort),
    );
    assert.deepEqual(
      missingFromBridge,
      [],
      `${context.modelId} supports efforts that Microdex does not expose`,
    );

    // And the excluded levels must stay out, however Codex advertises them.
    const leaked = BRIDGE_EFFORTS.filter((effort) => EXCLUDED_BY_DESIGN.includes(effort));
    assert.deepEqual(leaked, [], 'the ladder must stop at Extra High');
    assert.ok(expected.length, `${context.modelId} reported no drivable effort`);
  } finally {
    client.close();
  }
});

test('every effort currently shown on the mobile dial reaches another Codex client', async () => {
  const microdex = new CodexAppServer();
  const desktop = new CodexAppServer();
  let context;

  try {
    await Promise.all([microdex.ready(), desktop.ready()]);
    context = await activeModelContext(microdex);
    await Promise.all([
      microdex.selectThread(context.threadId),
      desktop.selectThread(context.threadId),
    ]);

    assertDynamicMobileEfforts();
    // Only the levels the dial can actually reach. Asking for an excluded one
    // used to throw "max reasoning is not supported by the active Codex model",
    // which is the bridge doing its job, not a failure.
    const drivable = context.supported.filter(
      (effort) => BRIDGE_EFFORTS.includes(effort) && !EXCLUDED_BY_DESIGN.includes(effort),
    );
    assert.ok(drivable.length, 'the active model must offer at least one drivable effort');
    for (const effort of drivable) {
      const changed = await microdex.updateSettings({
        threadId: context.threadId,
        reasoningEffort: effort,
      });
      assert.equal(changed.selected.reasoningEffort, effort);

      await delay(120);
      const observed = await desktop.state();
      assert.equal(
        observed.selected.reasoningEffort,
        effort,
        `The desktop client did not observe reasoning effort ${effort}.`,
      );
    }
  } finally {
    if (context?.threadId && context?.initialEffort) {
      await microdex.updateSettings({
        threadId: context.threadId,
        reasoningEffort: context.initialEffort,
      }).catch(() => {});
    }
    microdex.close();
    desktop.close();
  }
});
