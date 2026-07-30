import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyFastMode,
  applyReasoningEffort,
  readCodexStatus,
  setSectionKey,
  setTopLevelKey,
} from '../lib/codex-config.mjs';

test('adds top-level values before TOML sections', () => {
  const next = setTopLevelKey('[features]\nfast_mode = false\n', 'service_tier', '"fast"');
  assert.match(next, /^service_tier = "fast"\n\n\[features]/);
});

test('updates a section without losing unrelated values', () => {
  const next = setSectionKey('[features]\nfoo = true\nfast_mode = false\n\n[mcp]\nenabled = true\n', 'features', 'fast_mode', 'true');
  assert.match(next, /foo = true\nfast_mode = true/);
  assert.match(next, /\[mcp]\nenabled = true/);
});

test('fast mode on and off use an isolated temporary config', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdex-config-'));
  const configPath = path.join(directory, 'config.toml');

  let status = await applyFastMode(configPath, true);
  assert.equal(status.fastMode, true);
  let content = await readFile(configPath, 'utf8');
  assert.match(content, /service_tier = "fast"/);
  assert.match(content, /\[features]\nfast_mode = true/);

  status = await applyFastMode(configPath, false);
  assert.equal(status.fastMode, false);
  content = await readFile(configPath, 'utf8');
  assert.doesNotMatch(content, /service_tier/);
  assert.match(content, /fast_mode = true/);
});

test('reasoning changes are persistent and readable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdex-reasoning-'));
  const configPath = path.join(directory, 'config.toml');
  await applyReasoningEffort(configPath, 'xhigh');
  const status = await readCodexStatus(configPath);
  assert.equal(status.reasoningEffort, 'xhigh');
});
