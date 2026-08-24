import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const swiftSource = await readFile(
  new URL('../native/MicrodexDesktop.swift', import.meta.url),
  'utf8',
);
const desktopControlSource = await readFile(
  new URL('../lib/codex-desktop-control.mjs', import.meta.url),
  'utf8',
);
const serverSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);
const controllerSource = [
  await readFile(
    new URL('../../mobile/features/controller/controller-screen.tsx', import.meta.url),
    'utf8',
  ),
  await readFile(
    new URL('../../mobile/features/controller/command-result.ts', import.meta.url),
    'utf8',
  ),
].join('\n');

test('the companion asks the Codex web view to build its accessibility tree', () => {
  assert.match(swiftSource, /"AXManualAccessibility" as CFString/);
  assert.match(swiftSource, /"AXEnhancedUserInterface" as CFString/);
  // The request must be sent once per process, not on every lookup.
  assert.match(swiftSource, /manualAccessibilityRequested\.insert\(app\.processIdentifier\)/);
  // The tree is built asynchronously, so the helper has to wait for windows.
  assert.match(swiftSource, /kAXWindowsAttribute/);
});

test('every application element goes through the enabling helper', () => {
  const rawCalls = swiftSource.match(/AXUIElementCreateApplication\(/g) ?? [];
  // Exactly one: the call inside accessibilityElement(for:) itself.
  assert.equal(rawCalls.length, 1);
  const helper = swiftSource.slice(
    swiftSource.indexOf('func accessibilityElement(for app'),
    swiftSource.indexOf('func windowTreeReachable()'),
  );
  assert.match(helper, /AXUIElementCreateApplication\(app\.processIdentifier\)/);
});

test('status separates web view reachability from Codex activity', () => {
  assert.match(swiftSource, /"windowTree": trusted && running && windowTreeReachable\(\)/);
  // `working` still means "Codex is generating", which drives the thinking LED.
  assert.match(swiftSource, /exactly: "Stop"/);
  assert.match(swiftSource, /"working": working/);
});

test('actions needing the accessibility tree fail loudly when it is missing', () => {
  assert.match(desktopControlSource, /WINDOW_TREE_UNREACHABLE/);
  assert.match(desktopControlSource, /status\.windowTree === false/);
  const noTreeNeeded = desktopControlSource.slice(
    desktopControlSource.indexOf('const NO_WINDOW_TREE_ACTIONS'),
    desktopControlSource.indexOf('let buildPromise'),
  );
  // Key strokes and menu bar items work without the tree, so they must not be
  // blocked when the web view has not exposed its content.
  for (const action of [
    'send', 'approve', 'decline', 'sidebar', 'back', 'forward',
    'previous-chat', 'next-chat', 'find', 'file-tree',
  ]) {
    assert.ok(noTreeNeeded.includes(`'${action}'`), `${action} should stay allowed`);
  }
  // Anything that has to locate a control inside the web view must not be listed.
  for (const action of ['fast', 'plan', 'insert-text', 'reasoning-up', 'select-chat']) {
    assert.ok(!noTreeNeeded.includes(`'${action}'`), `${action} needs the tree`);
  }
});

test('the companion allowlist covers every action the Swift implements', () => {
  const allowlist = desktopControlSource.slice(
    desktopControlSource.indexOf('const ALLOWED_ACTIONS'),
    desktopControlSource.indexOf('// Actions that reach Codex as a key stroke'),
  );
  const executeBody = swiftSource.slice(swiftSource.indexOf('func execute(_ action: String'));
  const implemented = [...executeBody.matchAll(/^    case "([a-z-]+)":/gm)].map(
    (match) => match[1],
  );
  assert.ok(implemented.length > 30, 'expected the full action switch');
  const missing = implemented.filter((action) => !allowlist.includes(`'${action}'`));
  assert.deepEqual(missing, []);
});

test('Voice Chat uses the native Codex controls and remains separate from dictation', () => {
  for (const action of ['voice-start', 'voice-toggle-mute', 'voice-end']) {
    assert.match(swiftSource, new RegExp(`case "${action}"`));
    assert.match(desktopControlSource, new RegExp(`'${action}'`));
    assert.match(serverSource, new RegExp(`'${action}'`));
  }
  for (const label of [
    'Start new voice chat',
    'Mute microphone',
    'Unmute microphone',
    'End voice chat',
  ]) {
    assert.ok(swiftSource.includes(label), `missing native Voice control: ${label}`);
  }
  assert.match(swiftSource, /func visibleVoiceSessionStatus/);
  assert.match(swiftSource, /"voiceActive": voice\?\.active \?\? false/);
  assert.match(serverSource, /desktopResult\.voiceState/);

  const noTreeNeeded = desktopControlSource.slice(
    desktopControlSource.indexOf('const NO_WINDOW_TREE_ACTIONS'),
    desktopControlSource.indexOf('let buildPromise'),
  );
  assert.doesNotMatch(noTreeNeeded, /voice-start|voice-toggle-mute|voice-end/);
});

// Titles observed in the live Codex accessibility tree (app 26.721.81911).
// Codex packs the level and its explanation into a single title, which is why
// the companion matches on a leading word instead of on equality.
const OBSERVED_SPEED_TITLES = ['Standard Default speed', 'Fast 1.5x speed, more usage'];
const OBSERVED_EFFORT_TITLES = [
  ['Light', 'low'],
  ['Medium', 'medium'],
  ['High', 'high'],
  ['Extra High', 'xhigh'],
];
// Codex lists this one, but Microdex must never select it.
const EXCLUDED_EFFORT_TITLES = ['Ultra Consumes usage limits faster', 'Max'];

/** The rule findMenuItem uses: exact match, or the label followed by a space. */
function menuItemMatches(title, label) {
  const needle = label.toLowerCase();
  const value = title.toLowerCase();
  return value === needle || value.startsWith(`${needle} `);
}

function effortAliases(swift) {
  const start = swift.indexOf('let effortLabels: [String: [String]] = [');
  assert.ok(start > -1, 'the effort alias table must stay declared in one place');
  // Up to the line that closes the dictionary literal.
  const block = swift.slice(start, swift.indexOf('\n]', start));
  return Object.fromEntries(
    [...block.matchAll(/"(\w+)": \[([^\]]+)\]/g)].map(([, id, labels]) => [
      id,
      [...labels.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    ]),
  );
}

test('the effort aliases still cover the labels Codex shows', () => {
  const aliases = effortAliases(swiftSource);
  for (const [title, expectedId] of OBSERVED_EFFORT_TITLES) {
    const matched = Object.entries(aliases)
      .filter(([, labels]) => labels.some((label) => menuItemMatches(title, label)))
      .map(([id]) => id);
    assert.deepEqual(
      matched,
      [expectedId],
      `"${title}" should resolve to ${expectedId} and nothing else`,
    );
  }
  // Max and Ultra are excluded on purpose and must have no alias at all,
  // otherwise the dial could still land on them.
  assert.equal(aliases.max, undefined);
  assert.equal(aliases.ultra, undefined);
  for (const title of EXCLUDED_EFFORT_TITLES) {
    const matched = Object.entries(aliases).filter(([, labels]) =>
      labels.some((label) => menuItemMatches(title, label)));
    assert.deepEqual(matched, [], `"${title}" must not resolve to any level`);
  }
});

/** Mirror of resolveOfferedEffort in the companion. */
function resolveOfferedEffort(requested, direction, offered, ladder) {
  if (offered.includes(requested)) return requested;
  const index = ladder.indexOf(requested);
  if (index < 0) return null;
  const candidates = direction >= 0
    ? ladder.slice(index)
    : ladder.slice(0, index + 1).reverse();
  return candidates.find((id) => offered.includes(id)) ?? null;
}

test('the ladder stops at Extra High everywhere', () => {
  const ladder = [...swiftSource.matchAll(/let effortLadder = \[([^\]]+)\]/g)]
    .flatMap(([, ids]) => [...ids.matchAll(/"(\w+)"/g)].map((match) => match[1]));
  assert.deepEqual(ladder, ['minimal', 'low', 'medium', 'high', 'xhigh']);

  const config = readFileSync(new URL('../lib/codex-config.mjs', import.meta.url), 'utf8');
  assert.match(config, /REASONING_EFFORTS = \['low', 'medium', 'high', 'xhigh'\]/);
  // Every other list must derive from that one instead of repeating it.
  for (const file of ['../lib/codex-app-server.mjs', '../lib/programmed-actions.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /REASONING_EFFORTS/);
    assert.doesNotMatch(source, /'max'|'ultra'/);
  }
  // Codex may still advertise the excluded levels, so its list gets narrowed.
  const appServer = readFileSync(
    new URL('../lib/codex-app-server.mjs', import.meta.url),
    'utf8',
  );
  assert.match(appServer, /REASONING_EFFORTS\.includes\(effort\)/);
});

test('the dial stays put instead of failing at the top of the ladder', () => {
  const ladder = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const offered = ['low', 'medium', 'high', 'xhigh'];

  // Nothing above Extra High: going up keeps the current level, no error.
  assert.equal(resolveOfferedEffort('xhigh', 1, offered, ladder), 'xhigh');
  assert.equal(resolveOfferedEffort('minimal', -1, offered, ladder), null);
  // A model without the lowest rung: going down lands on the nearest one.
  const noLight = ['medium', 'high', 'xhigh'];
  assert.equal(resolveOfferedEffort('low', -1, noLight, ladder), null);
  assert.equal(resolveOfferedEffort('low', 1, noLight, ladder), 'medium');

  // Reaching the end is a clamp the bridge reports, never a thrown error.
  assert.match(swiftSource, /actionDetails\["clamped"\] = true/);
  assert.match(swiftSource, /actionDetails\["appliedEffort"\]/);
});

test('the dial rotates from the gesture, not from a React render', () => {
  const dial = readFileSync(
    new URL('../../mobile/components/reasoning-dial.tsx', import.meta.url),
    'utf8',
  );
  // The cap angle has to be a shared value driven on the UI thread, otherwise
  // the rotation only updates when the parent re-renders and feels stepped.
  assert.match(dial, /const angle = useSharedValue\(angleForPosition/);
  assert.match(dial, /transform: \[\{ rotate: `\$\{angle\.value\}deg` \}\]/);
  assert.doesNotMatch(dial, /rotate: `\$\{rotation\}deg`/);

  const reasoningPan = dial.slice(
    dial.indexOf('const reasoningPan = Gesture.Pan()'),
    dial.indexOf('const encoderPan = Gesture.Pan()'),
  );
  // Worklet, so no round trip to JS per frame.
  assert.match(reasoningPan, /'worklet'/);
  assert.doesNotMatch(reasoningPan, /runOnJS\(true\)/);
  // Fractional travel: the position is divided, not rounded, while dragging.
  assert.match(reasoningPan, /dominantDistance \/ PIXELS_PER_STEP/);
  // Only crossing a level notifies JS.
  assert.match(reasoningPan, /if \(next !== lastPreviewed\.value\)/);

  // The encoder modes stay detented, so they keep the stepped JS path.
  const encoderPan = dial.slice(dial.indexOf('const encoderPan = Gesture.Pan()'));
  assert.match(encoderPan, /runOnJS\(true\)/);
});

test('the bridge verifies the level Codex applied, not the one requested', () => {
  const settings = readFileSync(
    new URL('../lib/remote-settings.mjs', import.meta.url),
    'utf8',
  );
  assert.match(settings, /const appliedEffort = response\?\.appliedEffort \?\? body\.reasoningEffort/);
  assert.match(settings, /verifyReasoningSetting\(state, appliedEffort\)/);
  // Writing the requested value into Codex would defeat the clamp.
  assert.match(settings, /codex\.updateSettings\(effective\)/);
});

test('the Speed check reads the compact summary Codex renders', () => {
  // "Speed Standard" in the picker, and these titles inside the submenu.
  for (const [title, label] of [
    [OBSERVED_SPEED_TITLES[0], 'Standard'],
    [OBSERVED_SPEED_TITLES[1], 'Fast'],
  ]) {
    assert.ok(menuItemMatches(title, label), `${label} should match "${title}"`);
  }
  assert.match(swiftSource, /let expectedSummary = "speed \\\(targetLabel\.lowercased\(\)\)"/);
});

test('only App Server evidence counts as confirmed', () => {
  const helper = serverSource.slice(
    serverSource.indexOf('function withVerifiedCommand'),
    serverSource.indexOf('function actionNotApplied'),
  );
  assert.match(helper, /const confirmed = evidence === 'codex'/);
  assert.match(helper, /confirmed,/);
  assert.match(helper, /warning: confirmed/);
  // `verified` has to stay true, because older app builds read it and would
  // report an error on a desktop action that actually worked.
  assert.match(helper, /verified: true/);
});

test('the app treats an unconfirmed command as delivered, not as an error', () => {
  const guard = controllerSource.slice(
    controllerSource.indexOf('function requireVerifiedCommand'),
    controllerSource.indexOf('async function readStoredValue'),
  );
  assert.match(guard, /if \(!result\?\.applied \|\| !result\.verified\)/);
  // An older bridge sends no `confirmed`, and must not be treated as unconfirmed.
  assert.match(guard, /const confirmed = result\.confirmed \?\? true/);
  assert.match(controllerSource, /const unconfirmed = requireVerifiedCommand\(next\)/);
});
