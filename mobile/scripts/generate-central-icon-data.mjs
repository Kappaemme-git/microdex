#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceDirectory = path.resolve(
  process.argv[2] ?? '/Users/francescomistero/Desktop/central-icons-reversed',
);
const outputFile = path.resolve(
  process.argv[3] ?? 'components/central-icon-data.ts',
);

const iconNames = [
  '3d-package-2',
  'airplay',
  'apple-intelligence-icon',
  'archive',
  'arrow-left',
  'arrow-out-of-box',
  'arrow-right',
  'arrow-rotate-clockwise',
  'arrow-split-right',
  'arrow-up',
  'arrow-up-right',
  'bars-three',
  'book',
  'brain-1',
  'brain-2',
  'branch',
  'browser-tabs',
  'bug',
  'celebrate',
  'chain-link-2',
  'chat-bubble-7',
  'chat-bubbles',
  'check-circle-2',
  'checklist',
  'checkmark-2-small',
  'chevron-bottom',
  'chevron-right',
  'chevron-top',
  'circle',
  'circle-plus',
  'circle-x',
  'clipboard',
  'clock',
  'cloud-simple-download',
  'cloud-upload',
  'code-assistant',
  'code-lines',
  'code-tree',
  'commits',
  'cross-medium',
  'cursor-click',
  'difference-modified',
  'exclamation-circle-bold',
  'folder-1',
  'folder-add-right',
  'folder-delete',
  'folder-open',
  'folders-2',
  'fork-code',
  'gamepad-controls',
  'keyboard',
  'keyboard-down',
  'layout-bottom',
  'layout-grid-1',
  'layout-sidebar',
  'lightning',
  'merged',
  'microphone',
  'moon',
  'paint-brush',
  'paperclip-1',
  'pin',
  'play-circle',
  'plus-medium',
  'pull-request',
  'pull-request-simple',
  'puzzle',
  'qr-code',
  'rocket',
  'search-menu',
  'settings-gear-2',
  'settings-slider-three',
  'sparkle-central',
  'square-behind-square-4',
  'square-placeholder',
  'square-plus',
  'sun',
  'tag',
  'test-tube-2',
  'trash-can',
  'voice-3',
  'voice-mode',
];

const entries = [];
for (const name of iconNames) {
  const file = path.join(sourceDirectory, `${name}.svg`);
  const svg = (await readFile(file, 'utf8')).trim();
  if (!svg.startsWith('<svg') || !svg.includes('viewBox="0 0 24 24"')) {
    throw new Error(`${file} is not a supported 24px Central icon.`);
  }
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`);
}

const output = `/**
 * Generated from the central-icons-reversed source directory.
 * Do not edit by hand; run npm run icons:central to regenerate it.
 */
export const CENTRAL_ICON_XML = {
${entries.join('\n')}
} as const;

export type CentralIconSource = keyof typeof CENTRAL_ICON_XML;
`;

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, output);
console.log(`Generated ${iconNames.length} Central icons at ${outputFile}`);
