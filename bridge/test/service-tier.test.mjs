import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isFastServiceTier,
  serviceTierForFastMode,
} from '../lib/codex-app-server.mjs';

test('current Codex priority tier is shown as Fast Mode', () => {
  assert.equal(isFastServiceTier('priority'), true);
  assert.equal(serviceTierForFastMode(true), 'priority');
});

test('legacy fast tier remains readable while default stays standard', () => {
  assert.equal(isFastServiceTier('fast'), true);
  assert.equal(isFastServiceTier('default'), false);
  assert.equal(isFastServiceTier(null), false);
  assert.equal(serviceTierForFastMode(false), null);
});
