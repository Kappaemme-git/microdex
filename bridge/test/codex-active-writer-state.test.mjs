import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseThreadSnapshotAfterResumeError,
} from '../lib/codex-app-server.mjs';

test('an active Codex writer keeps the existing thread snapshot usable', () => {
  assert.equal(
    canUseThreadSnapshotAfterResumeError(
      new Error('thread abc already has an active writer'),
    ),
    true,
  );
});

test('unrelated App Server failures are not hidden by snapshot fallback', () => {
  assert.equal(
    canUseThreadSnapshotAfterResumeError(
      new Error('Codex App Server connection closed.'),
    ),
    false,
  );
  assert.equal(
    canUseThreadSnapshotAfterResumeError(
      new Error('Codex request timed out: thread/resume'),
    ),
    false,
  );
});
