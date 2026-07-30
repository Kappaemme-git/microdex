import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dialSource = await readFile(
  new URL('../components/reasoning-dial.tsx', import.meta.url),
  'utf8',
);
const controllerSource = await readFile(
  new URL('../app/index.tsx', import.meta.url),
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
  assert.match(dialSource, /\.runOnJS\(true\)/);
  assert.match(dialSource, /\.onTouchesUp\(\(\) => \{/);
  assert.match(
    dialSource,
    /\.onEnd\(\(\) => \{\s*if \(mode === 'reasoning'\) commitPan\(\)/,
  );
  assert.match(dialSource, /\.onFinalize\(\(\) => \{/);
  assert.match(dialSource, /const commitPan = useCallback\(\(\) => \{/);
  assert.match(dialSource, /onCommit\(lastIndex\.current\)/);
  assert.match(dialSource, /const schedulePanCommit = useCallback\(\(\) => \{/);
  assert.match(dialSource, /schedulePanCommit\(\)/);
  assert.match(dialSource, /\}, 220\)/);
  assert.match(dialSource, /<GestureDetector gesture=\{dialGesture\}>/);
  assert.match(dialSource, /mode === 'reasoning'/);
  assert.match(dialSource, /previewEncoderStep/);
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
