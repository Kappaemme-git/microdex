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
  new URL('../../mobile/features/controller/controller-screen.tsx', import.meta.url),
  'utf8',
);
const hardwareKeySource = await readFile(
  new URL('../../mobile/components/hardware-key.tsx', import.meta.url),
  'utf8',
);
const glyphSource = await readFile(
  new URL('../../mobile/components/microdex-keycap-glyph.tsx', import.meta.url),
  'utf8',
);
const iconSource = await readFile(
  new URL('../../mobile/components/microdex-icon.tsx', import.meta.url),
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

test('the catalog covers every stable key identifier exactly once', () => {
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

test('every key identifier resolves through the MIT-licensed Microdex icon system', () => {
  for (const entry of catalogEntries()) {
    const quoted = `  '${entry.icon}':`;
    const identifier = `  ${entry.icon}:`;
    assert.ok(
      iconSource.includes(quoted) || iconSource.includes(identifier),
      `${entry.id} points at missing Microdex icon alias ${entry.icon}`,
    );
  }
  assert.match(glyphSource, /keycapDescriptor\(keycapId\)/);
  assert.match(glyphSource, /<MicrodexIcon name=\{descriptor\.icon\}/);
  assert.doesNotMatch(glyphSource, /OFFICIAL_CODEX|official-codex/i);
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
  // The command and its position still have to be announced to screen readers.
  assert.match(
    controllerSource,
    /\$\{action\.label\}, key \$\{slotIndex \+ 1\}, active chat only/,
  );
  assert.ok(hardwareKeySource.includes('caption?: string;'), 'caption stays available');
});

test('the visible controls use the same Microdex icon renderer as saved keys', () => {
  for (const keycapId of ['FAST', 'APPR', 'REJ', 'SPLIT', 'MIC', 'CODEX']) {
    assert.match(
      controllerSource,
      new RegExp(`MicrodexKeycapGlyph keycapId="${keycapId}"`),
      `${keycapId} should use the Microdex renderer`,
    );
  }
  assert.match(
    controllerSource,
    /CodexCommandGlyph actionId=\{actionId\} size=\{24\} color=\{skeuo\.icon\}/,
  );
  assert.match(controllerSource, /MicrodexActionGlyph/);
});

test('the editor shows one scrolling command catalog and keeps keycap metadata internal', () => {
  assert.doesNotMatch(controllerSource, /styles\.keycapGrid/);
  assert.doesNotMatch(controllerSource, /styles\.keycapChip/);
  assert.doesNotMatch(controllerSource, /KEYCAP LABEL/);
  assert.doesNotMatch(controllerSource, /KEYCAP_CATALOG\.map/);
  assert.match(controllerSource, /placeholder="Search all Codex functions"/);
  assert.match(controllerSource, /filteredActions\.map/);
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
