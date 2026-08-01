#!/usr/bin/env node
// Prova ogni comando che Microdex puo' eseguire e dice quali funzionano.
//
//   node bridge/scripts/check-all-actions.mjs
//
// Serve Codex aperto con una chat selezionata. Nessuna azione distruttiva:
// niente invii, niente archiviazioni, niente fork. Le azioni che aprono un
// pannello vengono richiuse subito.

import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ensureDesktopCompanion } from '../lib/codex-desktop-control.mjs';

const executablePath = path.join(os.homedir(), '.microdex', 'bin', 'MicrodexDesktop');

/**
 * `revert` riporta l'interfaccia dov'era. `verify` legge un valore dal picker
 * per dire se il comando ha davvero avuto effetto, invece di fidarsi dell'esito.
 */
// L'ordine conta. I comandi che cambiano vista — Scheduled tasks, Plan Mode,
// cambio chat — vanno per ultimi: nel primo giro stavano in mezzo e hanno fatto
// fallire quelli dopo, che cercavano controlli della chat in una schermata dove
// quei controlli non esistono. Erano errori dello script, non del prodotto.
const CHECKS = [
  // Pannelli e menu: non spostano la vista, si riportano indietro da soli.
  { action: 'sidebar', label: 'Sidebar', revert: 'sidebar' },
  { action: 'back', label: 'Indietro', revert: 'forward' },
  { action: 'file-tree', label: 'File tree', revert: 'file-tree' },
  { action: 'bottom-panel', label: 'Pannello inferiore', revert: 'bottom-panel' },
  { action: 'pinned-summary', label: 'Pinned summary', revert: 'pinned-summary' },
  { action: 'review', label: 'Review panel', revert: 'review' },
  { action: 'terminal', label: 'Terminale', revert: 'terminal' },
  { action: 'find', label: 'Find', dismiss: true },
  { action: 'keyboard-shortcuts', label: 'Scorciatoie', dismiss: true },
  { action: 'command-menu-open', label: 'Command menu', dismiss: true },
  { action: 'model-picker', label: 'Apertura picker', dismiss: true },
  // Composer e chat corrente: richiedono di essere dentro una conversazione.
  { action: 'clear-composer', label: 'Svuota composer' },
  { action: 'attach-files', label: 'Allega file', dismiss: true },
  { action: 'copy-markdown', label: 'Copia come Markdown' },
  // I comandi del picker vengono prima di Plan Mode: Plan cambia lo stato del
  // composer e nel primo giro ha reso il picker irriconoscibile ai comandi
  // successivi, che hanno riportato "model picker not found" per colpa
  // dell'ordine di questo script, non di un guasto loro.
  { action: 'fast', payload: 'true', label: 'Fast Mode ON', verify: 'Speed', expect: 'fast' },
  { action: 'fast', payload: 'false', label: 'Fast Mode OFF', verify: 'Speed', expect: 'standard' },
  { action: 'reasoning-up', payload: 'high', label: 'Effort High', verify: 'Effort', expect: 'high' },
  { action: 'reasoning-down', payload: 'medium', label: 'Effort Medium', verify: 'Effort', expect: 'medium' },
  // Per ultimi quelli che cambiano vista o modalita'.
  { action: 'plan', label: 'Plan Mode', dismiss: true, revert: 'plan' },
  { action: 'previous-chat', label: 'Chat precedente', revert: 'next-chat' },
  { action: 'scheduled', label: 'Scheduled tasks', dismiss: true },
];

function run(args, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const child = spawn(executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(error) });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, error: stdout.trim() || stderr.trim() || 'nessuna risposta' });
      }
    });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Legge la riga compatta del picker, es. "Speed Fast".
 *
 * Torna anche il motivo quando non ci riesce: "non leggibile" da solo non
 * distingue un picker che non si apre da una riga che si chiama diversamente, e
 * quella differenza e' tutto.
 */
async function readRow(name) {
  let titles = [];
  let lastError = null;

  // Fino a tre tentativi. Subito dopo un comando il picker puo' essere ancora
  // chiuso o in animazione, e la lettura cattura solo la barra dei menu: le voci
  // che trovava erano "Informazioni su questo Mac" e simili, cioe' il menu Apple.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await run(['action', 'dismiss']);
    await wait(500 + attempt * 500);
    const result = await run(['inspect-model-picker'], 45_000);
    if (!result?.ok) {
      lastError = String(result?.error ?? 'senza dettaglio').slice(0, 70);
      continue;
    }
    // Le righe compatte del picker hanno il titolo VUOTO: il testo sta in
    // `description`. Leggendo solo `title` questa verifica era cieca e riportava
    // "nessuna riga Speed" elencando le voci del menu Apple.
    titles = (result.opened ?? [])
      .map((entry) => String(entry.title || entry.description || ''))
      .filter(Boolean);
    const row = titles.find((title) =>
      title.toLowerCase().startsWith(`${name.toLowerCase()} `));
    if (row) {
      await run(['action', 'dismiss']);
      return { row, reason: null };
    }
  }

  await run(['action', 'dismiss']);
  if (lastError) return { row: null, reason: `picker non apribile: ${lastError}` };
  return {
    row: null,
    reason: `nessuna riga "${name} ..." dopo 3 tentativi · viste: ${titles.slice(0, 4).join(' | ') || 'nessuna voce'}`,
  };
}

console.log('\nControllo completo dei comandi Microdex');
console.log('Codex deve essere aperto con una chat selezionata.\n');

// Ricompila il companion se il sorgente Swift e' cambiato. Senza questo lo
// script provava l'eseguibile vecchio: le correzioni sembravano non avere
// effetto perche' non erano mai state compilate.
try {
  await ensureDesktopCompanion();
} catch (error) {
  console.log(`Compilazione del companion fallita: ${error.message}\n`);
  process.exit(1);
}

const status = await run(['status']);
console.log(`accessibilita: ${status.trusted ? 'ok' : 'NEGATA'} · ` +
  `Codex: ${status.running ? 'aperto' : 'CHIUSO'} · ` +
  `albero finestra: ${status.windowTree ? 'ok' : 'VUOTO'}\n`);

if (!status.trusted || !status.running || status.windowTree === false) {
  console.log('Prerequisiti mancanti: il resto del controllo non avrebbe senso.\n');
  process.exit(1);
}

const results = [];
for (const check of CHECKS) {
  await run(['action', 'dismiss']);
  await wait(250);

  const args = ['action', check.action];
  if (check.payload !== undefined) args.push(check.payload);
  const response = await run(args);

  let verdict = response?.ok ? 'OK' : 'ERRORE';
  let detail = response?.ok ? '' : String(response?.error ?? '').slice(0, 90);

  // Per i comandi del picker l'esito non basta: si controlla il valore vero.
  if (response?.ok && check.verify) {
    await wait(400);
    const { row, reason } = await readRow(check.verify);
    if (!row) {
      verdict = 'INCERTO';
      detail = reason ?? `riga ${check.verify} non leggibile`;
    } else if (!row.toLowerCase().includes(check.expect)) {
      verdict = 'NON APPLICATO';
      detail = `dice "${row}"`;
    } else {
      detail = `"${row}"`;
    }
  }

  results.push({ label: check.label, verdict, detail });
  console.log(`  ${verdict.padEnd(14)} ${check.label.padEnd(22)} ${detail}`);

  if (check.dismiss) await run(['action', 'dismiss']);
  if (check.revert) {
    await wait(250);
    await run(['action', check.revert]);
  }
  await wait(250);
}

// Torna sulla conversazione. Finire su Scheduled tasks lasciava Codex in una
// vista senza composer, e il comando lanciato subito dopo falliva con
// "model picker not found" senza che nulla fosse rotto.
await run(['action', 'dismiss']);
await run(['action', 'back']);
await wait(400);

const failed = results.filter((entry) => entry.verdict !== 'OK');
console.log(`\n${results.length - failed.length} su ${results.length} funzionano.`);
if (failed.length) {
  console.log('\nDa guardare:');
  for (const entry of failed) console.log(`  ${entry.verdict} · ${entry.label} · ${entry.detail}`);
}
console.log('');
