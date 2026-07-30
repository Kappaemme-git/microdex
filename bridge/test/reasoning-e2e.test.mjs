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

test('bridge and mobile expose every effort supported by the active Codex model', async () => {
  const client = new CodexAppServer();
  try {
    await client.ready();
    const context = await activeModelContext(client);
    const missingFromBridge = context.supported.filter(
      (effort) => !BRIDGE_EFFORTS.includes(effort),
    );
    assertDynamicMobileEfforts();
    const missingFromMobile = [];

    assert.deepEqual(
      {
        missingFromBridge,
        missingFromMobile,
      },
      {
        missingFromBridge: [],
        missingFromMobile: [],
      },
      `${context.modelId} supports efforts that Microdex does not expose`,
    );
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
    for (const effort of context.supported) {
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
