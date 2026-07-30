import assert from 'node:assert/strict';
import test from 'node:test';

import { retryOperation } from '../lib/retry-operation.mjs';

test('a transient LaunchAgent bootstrap failure is retried', async () => {
  let attempts = 0;
  const waits = [];

  const result = await retryOperation(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Bootstrap failed: 5');
      return 'started';
    },
    {
      delays: [0, 500],
      wait: async (milliseconds) => waits.push(milliseconds),
    },
  );

  assert.equal(result, 'started');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [500]);
});

test('the final bootstrap error is preserved after all retries', async () => {
  const expected = new Error('LaunchAgent is unavailable');

  await assert.rejects(
    retryOperation(
      async () => {
        throw expected;
      },
      {
        delays: [0, 0, 0],
        wait: async () => {},
      },
    ),
    expected,
  );
});
