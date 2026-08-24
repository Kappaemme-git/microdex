import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(
  new URL('../features/controller/controller-screen.tsx', import.meta.url),
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
const voiceModeSource = await readFile(
  new URL('../lib/voice-mode.ts', import.meta.url),
  'utf8',
);
const voiceKeySource = await readFile(
  new URL('../components/voice-key.tsx', import.meta.url),
  'utf8',
);

function componentBlock(source, marker, closingTag) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing component marker: ${marker}`);
  const end = source.indexOf(closingTag, start);
  assert.notEqual(end, -1, `Missing closing tag after: ${marker}`);
  return source.slice(start, end + closingTag.length);
}

test('the Mic key implements Microdex push-to-talk semantics', () => {
  assert.match(hardwareKeySource, /onPressIn\?:\s*\(\)\s*=>\s*void/);
  assert.match(hardwareKeySource, /onPressOut\?:\s*\(\)\s*=>\s*void/);
  assert.match(hardwareKeySource, /onDoublePress\?:\s*\(\)\s*=>\s*void/);

  const micKey = componentBlock(
    controllerSource,
    'accessibilityLabel="Push to talk"',
    '\n                  />',
  );
  assert.match(micKey, /onPressIn=/);
  assert.match(micKey, /onPressOut=/);
  assert.match(micKey, /onDoublePress=/);
  assert.doesNotMatch(micKey, /Desktop dictation toggled/);
});

test('Voice is a separate native Codex control with a predictable start-stop toggle', () => {
  assert.match(voiceModeSource, /'voice-start'/);
  assert.match(voiceModeSource, /'voice-end'/);
  assert.match(voiceModeSource, /voice\?\.state === 'active' \? 'voice-end' : 'voice-start'/);
  assert.match(controllerSource, /<VoiceKey/);
  assert.match(voiceKeySource, /<MicrodexVoiceGlyph/);
  assert.match(voiceKeySource, /onPress=\{\(\) => void onPress\(\)\}/);
  assert.doesNotMatch(`${controllerSource}\n${voiceKeySource}`, /handleVoiceLongPress/);
  assert.match(controllerSource, /Audio never passes through the phone/);

  // Voice must not replace or reuse the MIC push-to-talk lifecycle.
  const micKey = componentBlock(
    controllerSource,
    'accessibilityLabel="Push to talk"',
    '\n                  />',
  );
  assert.doesNotMatch(micKey, /voice-/);
});

test('the dial supports reasoning, navigation, scroll, click, and 500 ms settings hold', () => {
  assert.match(reasoningDialSource, /onPreview:\s*\(index:\s*number\)\s*=>\s*void/);
  assert.match(reasoningDialSource, /onCommit:\s*\(index:\s*number\)\s*=>\s*void/);
  assert.match(reasoningDialSource, /'composer-navigation'/);
  assert.match(reasoningDialSource, /'conversation-scroll'/);
  // `steps` carries how many notches a flick crossed, so a spin costs one
  // request instead of one per notch.
  assert.match(reasoningDialSource, /onStep:\s*\(delta:\s*-1 \| 1, steps:\s*number\)\s*=>\s*void/);
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
