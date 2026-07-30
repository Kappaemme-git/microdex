import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serverSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);
const desktopSource = await readFile(
  new URL('../native/MicrodexDesktop.swift', import.meta.url),
  'utf8',
);

test('the bridge exposes all three documented dial modes safely', () => {
  assert.match(serverSource, /\/api\/encoder\/action/);
  assert.match(serverSource, /'composer-navigation'/);
  assert.match(serverSource, /'conversation-scroll'/);
  assert.match(serverSource, /Encoder delta must be -1 or 1/);
  assert.match(serverSource, /Invalid encoder action/);
});

test('notches arrive batched, so a spin costs one round trip', () => {
  const encoderBlock = serverSource.slice(
    serverSource.indexOf('async function runEncoderAction'),
    serverSource.indexOf('function queueState'),
  );
  assert.match(encoderBlock, /steps = 1/);
  assert.match(encoderBlock, /MAX_ENCODER_STEPS/);
  // A press is a single event whatever the client claims.
  assert.match(encoderBlock, /const repeat = press\s*\?\s*1/);
  assert.match(encoderBlock, /for \(let step = 0; step < repeat; step \+= 1\)/);
  // Absent `steps` has to keep meaning one notch, for older app builds.
  assert.match(serverSource, /body\.steps === undefined \? 1 : Number\(body\.steps\)/);
});

test('a status read is cached, since every action used to respawn the companion', () => {
  const control = readFileSync(
    new URL('../lib/codex-desktop-control.mjs', import.meta.url),
    'utf8',
  );
  assert.match(control, /STATUS_CACHE_MS/);
  assert.match(control, /statusCache && Date\.now\(\) - statusCache\.at < STATUS_CACHE_MS/);
  // A permission prompt must never be served from cache.
  assert.match(control, /if \(!prompt && statusCache/);
  assert.match(control, /statusCache = prompt \? null :/);
});

test('composer navigation uses the desktop action that can report failure', () => {
  const encoderBlock = serverSource.slice(
    serverSource.indexOf('async function runEncoderAction'),
    serverSource.indexOf('function queueState'),
  );
  assert.match(encoderBlock, /executeCodexDesktopAction/);
  assert.doesNotMatch(encoderBlock, /nativeShim\.command/);
});

test('standard mode has deterministic composer navigation and conversation scroll', () => {
  for (const action of [
    'composer-previous',
    'composer-next',
    'composer-select',
    'conversation-scroll-up',
    'conversation-scroll-down',
  ]) {
    assert.match(serverSource, new RegExp(`'${action}'`), action);
    assert.match(desktopSource, new RegExp(`case "${action}"`), action);
  }
  assert.match(desktopSource, /kVK_UpArrow/);
  assert.match(desktopSource, /kVK_DownArrow/);
  assert.match(desktopSource, /kVK_PageUp/);
  assert.match(desktopSource, /kVK_PageDown/);
});

test('reasoning changes no longer assume that the native encoder controls effort', () => {
  const reasoningBlock = serverSource.slice(
    serverSource.indexOf('async function applyNativeReasoningSetting'),
    serverSource.indexOf('async function runEncoderAction'),
  );
  assert.match(reasoningBlock, /applyReasoningSetting/);
  assert.doesNotMatch(reasoningBlock, /recordSettings/);
  assert.doesNotMatch(reasoningBlock, /encoder\.step/);
});
