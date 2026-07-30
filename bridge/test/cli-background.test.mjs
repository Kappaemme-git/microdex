import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cliSource = await readFile(
  new URL('../scripts/microdex.mjs', import.meta.url),
  'utf8',
);
const serverSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);

test('setup installs an automatic macOS LaunchAgent backed by a stable runtime', () => {
  assert.match(cliSource, /microdex setup/);
  assert.match(cliSource, /Library', 'LaunchAgents/);
  assert.match(cliSource, /<key>RunAtLoad<\/key>/);
  assert.match(cliSource, /<key>KeepAlive<\/key>/);
  assert.match(cliSource, /runtimeCliPath/);
  assert.match(cliSource, /case 'daemon'/);
});

test('a running background bridge can issue a fresh one-time pairing QR', () => {
  assert.match(cliSource, /case 'pair'/);
  assert.match(cliSource, /\/api\/pair\/new/);
  assert.match(serverSource, /url\.pathname === '\/api\/pair\/new'/);
  assert.match(serverSource, /pairingSession = new PairingSession/);
});

test('the CLI exposes lifecycle commands for the background service', () => {
  for (const command of ['status', 'restart', 'native', 'uninstall']) {
    assert.match(cliSource, new RegExp(`case '${command}'`));
  }
  assert.match(cliSource, /launchctl/);
  assert.match(cliSource, /bootout/);
  assert.match(cliSource, /kickstart/);
});

test('native mode is explicit, reversible, and never modifies the Codex app bundle', () => {
  assert.match(cliSource, /Continue\? \[Y\/n\]/);
  assert.match(cliSource, /NODE_OPTIONS: `--require=/);
  assert.match(cliSource, /case 'native'/);
  assert.match(cliSource, /operation === 'stop'/);
  assert.match(cliSource, /relaunchCodexNormally/);
  assert.doesNotMatch(cliSource, /cp .*ChatGPT\.app|writeFile\(.*ChatGPT\.app/s);
});
