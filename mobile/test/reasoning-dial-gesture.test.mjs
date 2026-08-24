import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dialSource = await readFile(
  new URL('../components/reasoning-dial.tsx', import.meta.url),
  'utf8',
);
const controllerSource = await readFile(
  new URL('../features/controller/controller-screen.tsx', import.meta.url),
  'utf8',
);

test('the reasoning dial owns its drag inside the screen gesture hierarchy', () => {
  assert.match(
    dialSource,
    /import\s*\{[^}]*Gesture[^}]*GestureDetector[^}]*\}\s*from 'react-native-gesture-handler'/s,
    'The dial must use the same native gesture system as its parent screen.',
  );
  assert.doesNotMatch(
    dialSource,
    /PanResponder/,
    'A nested PanResponder loses or terminates dial drags inside GestureDetector + ScrollView.',
  );
  assert.match(dialSource, /Gesture\.Pan\(\)/);
  assert.match(dialSource, /Gesture\.Tap\(\)/);
  assert.match(dialSource, /Gesture\.LongPress\(\)/);
  assert.match(dialSource, /Gesture\.Exclusive\(longPress, tap\)/);
  assert.match(dialSource, /Gesture\.Simultaneous\(/);
  assert.match(dialSource, /\.minDuration\(500\)/);
  assert.match(dialSource, /\.onFinalize\(\(\) => \{/);
  assert.match(dialSource, /<GestureDetector gesture=\{dialGesture\}>/);
  assert.match(dialSource, /mode === 'reasoning'/);
});

test('the cap angle is driven by the gesture, not by a React render', () => {
  // The rotation used to be computed from the `index` prop, so the cap only
  // moved once the parent re-rendered after a commit — never under the finger.
  assert.match(dialSource, /const angle = useSharedValue\(/);
  assert.match(dialSource, /useAnimatedStyle\(\(\) => \(\{\s*transform: \[\{ rotate: `\$\{angle\.value\}deg` \}\]/);
  assert.doesNotMatch(dialSource, /rotate: `\$\{rotation\}deg`/);
  assert.match(dialSource, /<Animated\.View style=\{\[styles\.dialCapWrapper, capStyle\]\}>/);

  const reasoningPan = dialSource.slice(
    dialSource.indexOf('const reasoningPan = Gesture.Pan()'),
    dialSource.indexOf('const encoderPan = Gesture.Pan()'),
  );
  assert.ok(reasoningPan.length > 0, 'the reasoning pan must stay identifiable');
  // A worklet, so no round trip to JS per frame.
  assert.match(reasoningPan, /'worklet'/);
  assert.doesNotMatch(reasoningPan, /runOnJS\(true\)/);
  // Fractional travel while dragging, integer only when a level is crossed.
  assert.match(reasoningPan, /dominantDistance \/ PIXELS_PER_STEP/);
  assert.match(reasoningPan, /if \(next !== lastPreviewed\.value\)/);
  assert.match(reasoningPan, /runOnJS\(preview\)\(next\)/);
  // The commit reports the level the finger settled on.
  assert.match(dialSource, /const commitDragged = useCallback\(/);
  assert.match(dialSource, /runOnJS\(commitDragged\)\(settled\)/);
});

test('the encoder modes batch their notches instead of one request each', () => {
  const encoderPan = dialSource.slice(dialSource.indexOf('const encoderPan = Gesture.Pan()'));
  assert.ok(encoderPan.length > 0, 'the encoder pan must stay identifiable');
  assert.match(encoderPan, /'worklet'/);
  assert.match(encoderPan, /dominantDistance \/ PIXELS_PER_DETENT/);
  assert.match(encoderPan, /runOnJS\(emitEncoderSteps\)\(crossed\)/);
  assert.match(encoderPan, /runOnJS\(flushEncoderSteps\)\(\)/);
  // One request per flick, not per notch: each used to wait for the previous.
  assert.match(dialSource, /onStep\(pending > 0 \? 1 : -1, Math\.abs\(pending\)\)/);
  assert.match(dialSource, /ENCODER_FLUSH_MS/);
});

test('the global chat swipe does not wrap the hardware controls', () => {
  assert.doesNotMatch(
    controllerSource,
    /<GestureDetector gesture=\{homeFlingLeft\}>\s*<View style=\{styles\.screenBody\}>/,
  );
  assert.match(
    controllerSource,
    /composerVisible \? \(\s*<GestureDetector gesture=\{homeFlingLeft\}>\s*<View style=\{styles\.composerPanel\}>/,
  );
  assert.match(controllerSource, /<GestureDetector gesture=\{homeEdgeOpen\}>/);
});
