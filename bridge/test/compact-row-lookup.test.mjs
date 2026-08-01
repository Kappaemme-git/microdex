import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const swiftSource = await readFile(
  new URL('../native/MicrodexDesktop.swift', import.meta.url),
  'utf8',
);

/** The two matchers the companion uses, as observed in the Swift source. */
const substringMatch = (title, needle) =>
  title.toLowerCase().includes(needle.toLowerCase());
const prefixMatch = (title, needle) => {
  const value = title.toLowerCase();
  const target = needle.toLowerCase();
  return value === target || value.startsWith(`${target} `);
};

// Titles observed in the live Codex model picker (app 26.721.81911).
const COMPACT_ROWS = ['Speed Standard', 'Speed Fast', 'Effort Extra High'];
const SPEED_SUBMENU = ['Standard Default speed', 'Fast 1.5x speed, more usage'];

test('a substring search cannot tell the Speed row from its submenu', () => {
  // Why the lookup had to change: both submenu entries contain "speed", so a
  // breadth-first substring walk could return either one instead of the row.
  for (const title of SPEED_SUBMENU) {
    assert.ok(substringMatch(title, 'Speed'), `"${title}" also matches "Speed"`);
  }
});

test('prefix matching selects only the compact row', () => {
  assert.ok(prefixMatch('Speed Standard', 'Speed'));
  assert.ok(prefixMatch('Effort Extra High', 'Effort'));
  for (const title of SPEED_SUBMENU) {
    assert.ok(!prefixMatch(title, 'Speed'), `"${title}" must not match the row`);
  }
  // The submenu lookup keeps working: it asks for the value, not the row.
  assert.ok(prefixMatch('Standard Default speed', 'Standard'));
  assert.ok(prefixMatch('Fast 1.5x speed, more usage', 'Fast'));
  for (const row of COMPACT_ROWS) {
    assert.ok(!prefixMatch(row, 'Standard'), `"${row}" is not a value entry`);
    assert.ok(!prefixMatch(row, 'Fast'), `"${row}" is not a value entry`);
  }
});

test('the companion reads the compact row with the prefix matcher', () => {
  const helper = swiftSource.slice(
    swiftSource.indexOf('func compactMenuItem(named name: String)'),
    swiftSource.indexOf('func findMenuItem(startingWith'),
  );
  assert.match(helper, /findMenuItem\(startingWith: name\)/);
  // The ambiguous substring search must not come back.
  assert.doesNotMatch(helper, /findElement\(\s*matching: name/);
});

test('the picker is given time to render before it is read', () => {
  // inspect-model-picker reads the same rows successfully, and the only
  // structural difference was that it waited after opening. This lookup asked
  // once, immediately, and called the control missing while it was appearing.
  const prepare = swiftSource.slice(
    swiftSource.indexOf('func prepareAdvancedModelPicker()'),
    swiftSource.indexOf('func compactMenuSummary'),
  );
  assert.match(prepare, /try openModelPicker\(\)\s*\n\s*\/\/[^\n]*\n\s*Thread\.sleep\(forTimeInterval: 0\.4\)/);

  const lookup = swiftSource.slice(
    swiftSource.indexOf('func compactMenuItem(named name: String)'),
    swiftSource.indexOf('func findMenuItem(startingWith'),
  );
  assert.match(lookup, /for _ in 0\.\.<16/);
  assert.match(lookup, /Thread\.sleep\(forTimeInterval: 0\.05\)/);
});

test('only leaf menu entries are pressed through accessibility', () => {
  const clickElement = swiftSource.slice(
    swiftSource.indexOf('func clickElement(_ element: AXUIElement)'),
    swiftSource.indexOf('func clickPoint('),
  );
  // Measured with `describe "Fast"` on the submenu entry: it declares AXPress,
  // it is enabled, and its frame sits at a negative y on a second display —
  // where a warped mouse click has to land exactly and does not apply.
  assert.match(clickElement, /kAXMenuItemRole/);
  assert.match(clickElement, /\(children \?\? \[\]\)\.isEmpty/);
  assert.match(clickElement, /AXUIElementPerformAction\(element, kAXPressAction as CFString\) == \.success/);
  // Rows that own a submenu keep the pointer: AXPress activates them instead of
  // expanding them, and the leaf never appears.
  assert.match(clickElement, /leftMouseDown/);

  // The picker button is a popup, not a menu item, so it keeps the pointer too:
  // pressed through accessibility it opens nothing at all.
  const pressElement = swiftSource.slice(
    swiftSource.indexOf('func pressElement(matching query: String'),
    swiftSource.indexOf('let nonModelPopUpMarkers'),
  );
  assert.match(pressElement, /leftMouseDown/);
  assert.doesNotMatch(pressElement, /kAXMenuItemRole/);

  // AXPress stays where it was always correct: the application menu bar.
  assert.match(swiftSource, /AXUIElementPerformAction\(menuItem, kAXPressAction as CFString\)/);
});

test('the axpress probe matches menu items by prefix', () => {
  const probe = swiftSource.slice(
    swiftSource.indexOf('} else if operation == "axpress"'),
    swiftSource.indexOf('} else if operation == "exists"'),
  );
  // Asking for "Standard" used to press "Speed Standard", the compact row, and
  // report success — which is how a correct hypothesis got discarded.
  assert.match(probe, /findMenuItem\(startingWith: arguments\[1\]\)/);
  // The pressed title is reported back, so a manual check cannot be misread.
  assert.match(probe, /"pressed": title/);
});

test('the companion does not verify by fighting its own popover', () => {
  // The loop that reopened the picker to reread the row raced the animation: the
  // first command of a sequence failed and the second passed, on the same path.
  // Both had applied — "Fast Mode OFF" reading back "Speed Standard" is only
  // possible because the "failed" "Fast Mode ON" before it had worked.
  assert.doesNotMatch(swiftSource, /Codex speed did not change to/);
  assert.doesNotMatch(swiftSource, /Codex reasoning effort did not change to/);
  assert.doesNotMatch(swiftSource, /compactMenuSummary\(updatedSpeed\)/);
  assert.doesNotMatch(swiftSource, /compactMenuSummary\(updatedEffort\)/);

  // The short-circuit stays: if the row already reads the target, do nothing.
  assert.match(swiftSource, /let expectedSummary = "speed \\\(targetLabel\.lowercased\(\)\)"/);
  assert.match(swiftSource, /if compactMenuSummary\(speedItem\)\.contains\(expectedSummary\)/);

  // Verification lives where it is authoritative: the Codex App Server.
  const settings = readFileSync(
    new URL('../lib/remote-settings.mjs', import.meta.url),
    'utf8',
  );
  assert.match(settings, /verifyFastSetting\(state, body\.fastMode\)/);
  assert.match(settings, /verifyReasoningSetting\(state, appliedEffort\)/);
});
