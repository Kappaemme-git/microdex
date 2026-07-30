import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projectNameFromCwd } from '../lib/codex-app-server.mjs';

const appServerSource = await readFile(
  new URL('../lib/codex-app-server.mjs', import.meta.url),
  'utf8',
);
const mobileBridgeSource = await readFile(
  new URL('../../mobile/lib/bridge.ts', import.meta.url),
  'utf8',
);

test('remote tasks include a project name derived from their Codex working directory', () => {
  assert.match(appServerSource, /project: projectNameFromCwd\(thread\.cwd\)/);
  assert.match(mobileBridgeSource, /project: string/);
  assert.equal(projectNameFromCwd('/Users/person/Documents/Microcodex'), 'Microcodex');
  assert.equal(
    projectNameFromCwd('/Users/person/Documents/Codex/2026-07-24/a-generated-worktree'),
    'Codex',
  );
  assert.equal(projectNameFromCwd(''), 'General');
});

test('the remote navigator receives enough recent tasks to represent multiple projects', () => {
  assert.match(appServerSource, /async listThreads\(limit = 30\)/);
  assert.match(appServerSource, /this\.listThreads\(30\)/);
});
