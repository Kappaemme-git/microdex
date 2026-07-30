import assert from 'node:assert/strict';
import test from 'node:test';

import { RemoteMessageQueue } from '../lib/remote-message-queue.mjs';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('messages wait in order while Codex is busy and queued items can be removed', async () => {
  let status = 'thinking';
  let nextId = 0;
  const sent = [];
  const queue = new RemoteMessageQueue({
    getState: async () => ({
      threads: [{ id: 'thread-1', status }],
    }),
    send: async (item) => sent.push(item.text),
    makeId: () => `message-${++nextId}`,
    now: () => 123,
  });

  const first = queue.enqueue({ threadId: 'thread-1', text: 'first' });
  const second = queue.enqueue({ threadId: 'thread-1', text: 'second' });
  await flush();

  assert.deepEqual(sent, []);
  assert.deepEqual(queue.list().map((item) => item.text), ['first', 'second']);
  assert.equal(queue.remove(second.id), true);
  assert.deepEqual(queue.list().map((item) => item.text), ['first']);

  status = 'complete';
  await queue.handleCodexChange();
  assert.deepEqual(sent, ['first']);
  assert.deepEqual(
    queue.list().map(({ text, status: itemStatus }) => ({ text, status: itemStatus })),
    [{ text: 'first', status: 'sending' }],
  );

  status = 'thinking';
  await queue.handleCodexChange();
  status = 'complete';
  await queue.handleCodexChange();
  assert.deepEqual(queue.list(), []);
  queue.close();
});

test('the next queued message sends only after the active Codex turn completes', async () => {
  let status = 'complete';
  let nextId = 0;
  const sent = [];
  const queue = new RemoteMessageQueue({
    getState: async () => ({
      threads: [{ id: 'thread-1', status }],
    }),
    send: async (item) => sent.push(item.text),
    makeId: () => `message-${++nextId}`,
  });

  queue.enqueue({ threadId: 'thread-1', text: 'one' });
  queue.enqueue({ threadId: 'thread-1', text: 'two' });
  await flush();
  assert.deepEqual(sent, ['one']);
  assert.deepEqual(
    queue.list().map(({ text, status: itemStatus }) => ({ text, status: itemStatus })),
    [
      { text: 'one', status: 'sending' },
      { text: 'two', status: 'queued' },
    ],
  );

  status = 'thinking';
  await queue.handleCodexChange();
  assert.deepEqual(sent, ['one']);

  status = 'complete';
  await queue.handleCodexChange();
  assert.deepEqual(sent, ['one', 'two']);
  assert.deepEqual(
    queue.list().map(({ text, status: itemStatus }) => ({ text, status: itemStatus })),
    [{ text: 'two', status: 'sending' }],
  );

  status = 'thinking';
  await queue.handleCodexChange();
  status = 'complete';
  await queue.handleCodexChange();
  assert.deepEqual(queue.list(), []);
  queue.close();
});

test('a dispatched message stays visible as sending until the Codex turn completes', async () => {
  let status = 'complete';
  let nextId = 0;
  const sent = [];
  const queue = new RemoteMessageQueue({
    getState: async () => ({
      threads: [{ id: 'thread-1', status }],
    }),
    send: async (item) => sent.push(item.text),
    makeId: () => `message-${++nextId}`,
  });

  queue.enqueue({ threadId: 'thread-1', text: 'keep me visible' });
  await flush();

  assert.deepEqual(sent, ['keep me visible']);
  assert.deepEqual(
    queue.list().map(({ text, status: itemStatus }) => ({ text, status: itemStatus })),
    [{ text: 'keep me visible', status: 'sending' }],
  );

  status = 'thinking';
  await queue.handleCodexChange();
  assert.deepEqual(queue.list().map((item) => item.status), ['sending']);

  status = 'complete';
  await queue.handleCodexChange();
  assert.deepEqual(queue.list(), []);
  queue.close();
});

test('archiving a chat removes only its waiting messages', async () => {
  const queue = new RemoteMessageQueue({
    getState: async () => ({
      threads: [
        { id: 'thread-1', status: 'thinking' },
        { id: 'thread-2', status: 'thinking' },
      ],
    }),
    send: async () => {},
    makeId: (() => {
      let id = 0;
      return () => `message-${++id}`;
    })(),
  });

  queue.enqueue({ threadId: 'thread-1', text: 'remove me' });
  queue.enqueue({ threadId: 'thread-2', text: 'keep me' });
  await flush();

  assert.equal(queue.removeThread('thread-1'), 1);
  assert.deepEqual(queue.list().map((item) => item.text), ['keep me']);
  queue.close();
});

test('a failed desktop send stays queued instead of crashing the bridge', async () => {
  const queue = new RemoteMessageQueue({
    getState: async () => ({
      threads: [{ id: 'thread-1', status: 'complete' }],
    }),
    send: async () => {
      throw new Error('Desktop composer is unavailable');
    },
    makeId: () => 'message-1',
  });

  queue.enqueue({ threadId: 'thread-1', text: 'try again later' });
  await flush();

  assert.deepEqual(queue.list(), [
    {
      id: 'message-1',
      threadId: 'thread-1',
      text: 'try again later',
      status: 'queued',
      createdAt: queue.list()[0].createdAt,
      error: 'Desktop composer is unavailable',
    },
  ]);
  queue.close();
});
