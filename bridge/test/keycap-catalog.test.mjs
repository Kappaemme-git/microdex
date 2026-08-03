import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CODEX_KEYCAP_IDS, CODEX_PROGRAMMABLE_ACTIONS } from '../lib/programmed-actions.mjs';

const catalogSource = await readFile(
  new URL('../../mobile/lib/keycap-catalog.ts', import.meta.url),
  'utf8',
);
const controllerSource = await readFile(
  new URL('../../mobile/app/index.tsx', import.meta.url),
  'utf8',
);
const hardwareKeySource = await readFile(
  new URL('../../mobile/components/hardware-key.tsx', import.meta.url),
  'utf8',
);
const glyphSource = await readFile(
  new URL('../../mobile/components/codex-micro-glyph.tsx', import.meta.url),
  'utf8',
);
const officialGlyphSource = await readFile(
  new URL('../../mobile/lib/official-codex-micro-glyphs.ts', import.meta.url),
  'utf8',
);

/** Entries in catalog order, which is also the order shown in the grid. */
function catalogEntries() {
  const body = catalogSource.slice(
    catalogSource.indexOf('export const KEYCAP_CATALOG'),
    catalogSource.indexOf('const byId = new Map'),
  );
  return [...body.matchAll(/id: '([^']+)',\s*name: '([^']+)',\s*icon: '([^']+)'(?:,\s*commands: \[([^\]]*)\])?/g)]
    .map(([, id, name, icon, commands]) => ({
      id,
      name,
      icon,
      commands: commands
        ? [...commands.matchAll(/'([^']+)'/g)].map((match) => match[1])
        : [],
    }));
}

test('the catalog covers every printed keycap exactly once', () => {
  const entries = catalogEntries();
  assert.equal(entries.length, CODEX_KEYCAP_IDS.length);
  const ids = entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate keycap');
  assert.deepEqual(
    [...ids].sort(),
    [...CODEX_KEYCAP_IDS].sort(),
    'the catalog and the bridge must describe the same set of caps',
  );
});

test('every keycap has a readable name and an icon', () => {
  for (const entry of catalogEntries()) {
    assert.ok(entry.name.length > 1, `${entry.id} needs a name`);
    assert.ok(entry.icon.length > 1, `${entry.id} needs an icon`);
    // A screen reader announces the name, so it must be prose rather than the
    // shouted abbreviation. FAST legitimately reads "Fast"; MIND+ must not read
    // "MIND+".
    assert.notEqual(entry.name, entry.id, `${entry.id} needs a spoken name`);
    assert.notEqual(
      entry.name,
      entry.name.toUpperCase(),
      `${entry.id} name should not be all caps`,
    );
    // Truncated ids have to expand into a real word.
    if (/^(APPR|REJ|TERM|DWN|DEL|BRCH|MRG|PR|UPL|FOLD|EMPT\d)$/.test(entry.id)) {
      assert.ok(
        entry.name.length > entry.id.length,
        `${entry.id} is an abbreviation and needs a longer name`,
      );
    }
  }
});

test('every printed keycap is mapped to official Codex Micro artwork', () => {
  const mapping = officialGlyphSource.slice(
    officialGlyphSource.indexOf('export const OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS'),
  );
  const mappedIds = [
    ...mapping.matchAll(
      /^\s*(?:["']([^"']+)["']|([A-Z][A-Z0-9+-]*)):\s*["'][^"']+["'],?$/gm,
    ),
  ].map((match) => match[1] ?? match[2]);

  assert.equal(new Set(mappedIds).size, mappedIds.length, 'no duplicate keycap mapping');
  assert.deepEqual(
    [...mappedIds].sort(),
    [...CODEX_KEYCAP_IDS].sort(),
    'the official vector set must cover every physical keycap',
  );
  assert.match(glyphSource, /OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS\[keycapId\]/);
  assert.match(glyphSource, /OFFICIAL_CODEX_MICRO_GLYPHS\[legend\]/);
});

test('Send uses the CODEX keycap rather than the decorative OpenAI cap', () => {
  const submitCaps = catalogEntries()
    .filter((entry) => entry.commands.includes('composer.submit'))
    .map((entry) => entry.id);
  assert.deepEqual(submitCaps, ['CODEX']);
});

test('every runnable command has a keycap printed for it', () => {
  const printed = new Set(catalogEntries().flatMap((entry) => entry.commands));
  const missing = CODEX_PROGRAMMABLE_ACTIONS
    .filter((action) => action.kind !== 'custom')
    .map((action) => action.id)
    .filter((id) => !printed.has(id));
  assert.deepEqual(missing, [], 'these commands would open the editor with no matching cap');
});

test('keycaps only reference commands the bridge can run', () => {
  const runnable = new Set(CODEX_PROGRAMMABLE_ACTIONS.map((action) => action.id));
  for (const entry of catalogEntries()) {
    for (const command of entry.commands) {
      assert.ok(runnable.has(command), `${entry.id} points at unknown command ${command}`);
    }
  }
});

test('the keys on the deck carry no printed name', () => {
  // Icon only, like the physical caps. A name on a key that small was noise.
  assert.doesNotMatch(controllerSource, /caption=\{/);
  // The command still has to be announced to screen readers.
  assert.match(controllerSource, /\$\{action\.label\}, \$\{programmed\?\.keycapId\} keycap/);
  assert.ok(hardwareKeySource.includes('caption?: string;'), 'caption stays available');
});

test('the visible Micro controls use official vectors instead of icon-font approximations', () => {
  for (const keycapId of ['FAST', 'APPR', 'REJ', 'SPLIT', 'MIC', 'CODEX']) {
    assert.match(
      controllerSource,
      new RegExp(`CodexMicroGlyph keycapId="${keycapId}"`),
      `${keycapId} should use its official vector`,
    );
  }
  assert.match(controllerSource, /CodexMicroGlyph keycapId=\{programmed\.keycapId\}/);
  assert.match(controllerSource, /CodexMicroActionGlyph/);
});

test('the editor lets the user pick a printed keycap and a command', () => {
  // Official tray artwork is selectable again, with defaults wired from the
  // Codex Micro catalog so GIT / PR / YOLO are not blank labels.
  assert.match(controllerSource, /styles\.keycapGrid/);
  assert.match(controllerSource, /styles\.keycapChip/);
  assert.match(controllerSource, /KEYCAP LABEL/);
  assert.match(controllerSource, /KEYCAP_CATALOG\.map/);
  assert.match(controllerSource, /defaultActionForKeycap\(keycap\.id\)/);
  assert.match(controllerSource, /suggestedKeycapForCommand/);
  assert.match(controllerSource, /contentContainerStyle=\{styles\.actionCatalog\}/);
});

test('the dial commits the level the finger landed on', () => {
  const dial = readFileSync(
    new URL('../../mobile/components/reasoning-dial.tsx', import.meta.url),
    'utf8',
  );
  const commit = dial.slice(
    dial.indexOf('const commitDragged'),
    dial.indexOf('const dialGesture'),
  );
  // The preview moves `index` mid-drag, so comparing the settled level against
  // it made every drag look unchanged and nothing reached Codex.
  assert.doesNotMatch(commit, /settledIndex === currentIndex\.current/);
  assert.match(commit, /onCommit\(settledIndex\)/);
  // Deduplication belongs to the parent, against the level Codex holds.
  assert.match(controllerSource, /if \(effort === activeThread\?\.reasoningEffort\)/);
});
