import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(
  new URL('../app/index.tsx', import.meta.url),
  'utf8',
);
const hardwareKeySource = await readFile(
  new URL('../components/hardware-key.tsx', import.meta.url),
  'utf8',
);
const reasoningDialSource = await readFile(
  new URL('../components/reasoning-dial.tsx', import.meta.url),
  'utf8',
);
const bridgeSource = await readFile(
  new URL('../lib/bridge.ts', import.meta.url),
  'utf8',
);
const actionCatalogSource = await readFile(
  new URL('../lib/micro-actions.ts', import.meta.url),
  'utf8',
);

function componentBlock(source, marker, closingTag) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing component marker: ${marker}`);
  const end = source.indexOf(closingTag, start);
  assert.notEqual(end, -1, `Missing closing tag after: ${marker}`);
  return source.slice(start, end + closingTag.length);
}

test('the Mic key implements Codex Micro push-to-talk semantics', () => {
  assert.match(hardwareKeySource, /onPressIn\?:\s*\(\)\s*=>\s*void/);
  assert.match(hardwareKeySource, /onPressOut\?:\s*\(\)\s*=>\s*void/);
  assert.match(hardwareKeySource, /onDoublePress\?:\s*\(\)\s*=>\s*void/);

  const micKey = componentBlock(
    controllerSource,
    'accessibilityLabel="Push to talk"',
    '/>',
  );
  assert.match(micKey, /onPressIn=/);
  assert.match(micKey, /onPressOut=/);
  assert.match(micKey, /onDoublePress=/);
  assert.doesNotMatch(micKey, /Desktop dictation toggled/);
});

test('the dial supports reasoning, navigation, scroll, click, and 500 ms settings hold', () => {
  assert.match(reasoningDialSource, /onPreview:\s*\(index:\s*number\)\s*=>\s*void/);
  assert.match(reasoningDialSource, /onCommit:\s*\(index:\s*number\)\s*=>\s*void/);
  assert.match(reasoningDialSource, /'composer-navigation'/);
  assert.match(reasoningDialSource, /'conversation-scroll'/);
  assert.match(reasoningDialSource, /onStep:\s*\(delta:\s*-1 \| 1\)\s*=>\s*void/);
  assert.match(reasoningDialSource, /Gesture\.Exclusive\(longPress, tap\)/);
  assert.match(reasoningDialSource, /Gesture\.LongPress\(\)/);
  assert.match(reasoningDialSource, /\.minDuration\(500\)/);
  assert.match(reasoningDialSource, /Gesture\.Pan\(\)/);
  assert.match(reasoningDialSource, /Gesture\.Tap\(\)/);
  assert.doesNotMatch(reasoningDialSource, /PanResponder/);

  const dial = componentBlock(
    controllerSource,
    '<ReasoningDial',
    '/>',
  );
  assert.match(dial, /onPreview=/);
  assert.match(dial, /onCommit=/);
  assert.match(dial, /onStep=/);
  assert.match(dial, /onPress=/);
  assert.match(dial, /onLongPress=/);
  assert.match(controllerSource, /'\/api\/encoder\/action'/);
  assert.match(controllerSource, /STORAGE_ENCODER_MODE/);
  assert.doesNotMatch(controllerSource, /reasoningTimer/);
});

test('advanced keys expose availability instead of failing after a press', () => {
  assert.match(bridgeSource, /actionAvailability/);
  assert.match(actionCatalogSource, /availability/);
  assert.match(controllerSource, /unavailableReason/);
});
