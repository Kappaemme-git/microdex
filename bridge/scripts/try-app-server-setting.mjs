#!/usr/bin/env node
// Applica Fast Mode passando SOLO dall'App Server di Codex, senza toccare
// l'interfaccia, e poi legge cosa dice davvero il picker.
//
//   node bridge/scripts/try-app-server-setting.mjs on
//   node bridge/scripts/try-app-server-setting.mjs off
//
// Serve a decidere una cosa sola: se l'API applica il valore e la finestra lo
// riflette, la modifica puo' passare da li' invece che da un clic. Se l'API dice
// di aver applicato ma il picker resta com'era, invertire l'ordine non
// risolverebbe niente.

import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { CodexAppServer } from '../lib/codex-app-server.mjs';
import { ensureDesktopCompanion } from '../lib/codex-desktop-control.mjs';

const executablePath = path.join(os.homedir(), '.microdex', 'bin', 'MicrodexDesktop');
const wanted = (process.argv[2] || 'on').toLowerCase() === 'on';

function readPicker() {
  return new Promise((resolve) => {
    const child = spawn(executablePath, ['inspect-model-picker'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout);
        const row = (parsed.opened ?? [])
          .map((entry) => String(entry.title || entry.description || ''))
          .find((label) => label.toLowerCase().startsWith('speed '));
        resolve(row ?? null);
      } catch {
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
  });
}

const dismiss = () => new Promise((resolve) => {
  spawn(executablePath, ['action', 'dismiss'], { stdio: 'ignore' }).on('close', resolve);
});

await ensureDesktopCompanion();
const codex = new CodexAppServer();

try {
  await codex.ready();
  const before = await codex.state();
  if (!before.selected) {
    console.log('\nSeleziona una chat in Codex e riprova.\n');
    process.exit(1);
  }

  console.log(`\nChat: ${before.selected.name ?? before.selectedThreadId}`);
  console.log(`App Server prima: fastMode = ${before.selected.fastMode}`);
  const pickerBefore = await readPicker();
  await dismiss();
  console.log(`Picker prima:     ${pickerBefore ?? 'non leggibile'}`);

  console.log(`\nChiedo fastMode = ${wanted} solo tramite App Server...`);
  let applied;
  try {
    applied = await codex.updateSettings({
      threadId: before.selectedThreadId,
      fastMode: wanted,
    });
    console.log(`App Server risponde: fastMode = ${applied.selected?.fastMode}`);
  } catch (error) {
    console.log(`App Server rifiuta: ${error.message}`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const pickerAfter = await readPicker();
  await dismiss();
  console.log(`Picker dopo:      ${pickerAfter ?? 'non leggibile'}`);

  const expected = wanted ? 'fast' : 'standard';
  const reflected = (pickerAfter ?? '').toLowerCase().includes(expected);

  console.log('\n--- verdetto ---');
  if (applied.selected?.fastMode === wanted && reflected) {
    console.log('L\'App Server applica E la finestra lo riflette.');
    console.log('La modifica puo\' passare dall\'API: il clic diventa superfluo.');
  } else if (applied.selected?.fastMode === wanted) {
    console.log('L\'App Server dice di aver applicato, ma il picker non e\' cambiato.');
    console.log('Sono due copie della stessa task: invertire l\'ordine non basta,');
    console.log('ed e\' esattamente il motivo per cui il clic era stato messo per primo.');
  } else {
    console.log('L\'App Server non ha applicato il valore.');
  }
  console.log('');
} finally {
  codex.close();
}
