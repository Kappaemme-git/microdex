import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDemoRemoteState,
  createDemoStatus,
  respondToDemoRequest,
} from '../lib/demo.ts';

test('the native demo contains fictional tasks and a review-safe status', () => {
  const remote = createDemoRemoteState(1_000);
  const status = createDemoStatus(remote);

  assert.equal(status.platform, 'demo');
  assert.equal(status.bridge?.name, 'Microdex Demo');
  assert.equal(remote.threads.length, 3);
  assert.ok(remote.threads.every((thread) => /Demo|Release/.test(thread.project)));
  assert.equal(status.capabilities?.endToEndEncryption, true);
});

test('the native demo simulates settings, voice and messages without a bridge', () => {
  let remote = createDemoRemoteState(1_000);

  ({ remote } = respondToDemoRequest(
    remote,
    '/api/remote/settings',
    { fastMode: false, reasoningEffort: 'xhigh' },
    2_000,
  ));
  assert.equal(remote.selected?.fastMode, false);
  assert.equal(remote.selected?.reasoningEffort, 'xhigh');
  assert.equal(remote.commandResult?.verified, true);

  ({ remote } = respondToDemoRequest(
    remote,
    '/api/desktop/action',
    { action: 'voice-start' },
    3_000,
  ));
  assert.equal(remote.voice?.state, 'active');

  const sent = respondToDemoRequest(
    remote,
    '/api/remote/send',
    { threadId: remote.selectedThreadId, text: 'Review this demo' },
    4_000,
  );
  assert.equal(sent.remote.messageQueue.length, 1);
  assert.equal(sent.remote.messageQueue[0].text, 'Review this demo');
  assert.deepEqual(sent.response, { messageQueue: sent.remote.messageQueue });
});

test('the native demo can switch, fork and archive fictional tasks', () => {
  let remote = createDemoRemoteState(1_000);
  const second = remote.threads[1];

  ({ remote } = respondToDemoRequest(
    remote,
    '/api/remote/select',
    { threadId: second.id },
    2_000,
  ));
  assert.equal(remote.selectedThreadId, second.id);

  ({ remote } = respondToDemoRequest(
    remote,
    '/api/remote/fork',
    { threadId: second.id },
    3_000,
  ));
  assert.match(remote.selected?.id ?? '', /^demo-fork-/);

  const forkId = remote.selectedThreadId;
  ({ remote } = respondToDemoRequest(
    remote,
    '/api/remote/archive',
    { threadId: forkId },
    4_000,
  ));
  assert.ok(!remote.threads.some((thread) => thread.id === forkId));
});
