#!/usr/bin/env node
// Diagnostica del companion desktop.
//
//   node bridge/scripts/diagnose-desktop.mjs            # solo lettura, nessun effetto
//   node bridge/scripts/diagnose-desktop.mjs --actions   # prova anche le azioni non distruttive
//
// Scrive un report completo in /tmp/microdex-diagnose.json e stampa un riassunto.
// Nessuna azione distruttiva (send, new-chat, archive, fork) viene mai eseguita.

import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  desktopControlStatus,
  ensureDesktopCompanion,
} from '../lib/codex-desktop-control.mjs';

const executablePath = path.join(os.homedir(), '.microdex', 'bin', 'MicrodexDesktop');
const reportPath = '/tmp/microdex-diagnose.json';
const runActions = process.argv.includes('--actions');

// Etichette su cui il codice Swift fa affidamento. Se una manca, l'azione
// corrispondente "arriva" ma non fa nulla.
// `scope` dice quando l'etichetta puo esistere. Le voci del picker e quelle
// contestuali non sono a schermo a riposo: per quelle un MANCA non e' un
// problema, e la sezione del model picker qui sopra e' la verifica vera.
const LABEL_PROBES = [
  { query: 'Stop', role: 'AXButton', usedBy: 'status.working', scope: 'solo mentre Codex genera' },
  { query: 'Speed', role: 'AXMenuItem', usedBy: 'fast', scope: 'solo con il picker aperto' },
  { query: 'Effort', role: 'AXMenuItem', usedBy: 'reasoning', scope: 'solo con il picker aperto' },
  { query: 'Show advanced options', role: 'AXMenuItem', usedBy: 'fast + reasoning', scope: 'solo con il picker aperto in vista compatta' },
  { query: 'Fast', role: null, usedBy: 'fast on', scope: 'solo nel sottomenu Speed' },
  { query: 'Standard', role: null, usedBy: 'fast off', scope: 'solo nel sottomenu Speed' },
  { query: 'Light', role: null, usedBy: 'effort low', scope: 'solo nel sottomenu Effort' },
  { query: 'Medium', role: null, usedBy: 'effort medium', scope: 'solo nel sottomenu Effort' },
  { query: 'High', role: null, usedBy: 'effort high', scope: 'solo nel sottomenu Effort' },
  { query: 'Plan mode', role: null, usedBy: 'plan', scope: 'solo dopo aver digitato /plan' },
  { query: 'Approve', role: null, usedBy: 'approve', scope: 'solo con una richiesta pendente' },
  { query: 'Reject', role: null, usedBy: 'decline', scope: 'solo con una richiesta pendente' },
  { query: 'Show sidebar', role: 'AXButton', usedBy: 'sidebar' },
  { query: 'Back', role: 'AXButton', usedBy: 'back' },
  { query: 'Forward', role: 'AXButton', usedBy: 'forward' },
  { query: 'Toggle bottom panel', role: 'AXCheckBox', usedBy: 'terminal' },
];

// Azioni senza effetti irreversibili. Le toggle vengono rimesse a posto.
// Le azioni che aprono un overlay vanno chiuse subito: un modale aperto
// nasconde il resto dell'interfaccia all'accessibilita e fa fallire i test
// successivi. Il picker va provato prima di loro.
const SAFE_ACTIONS = [
  { action: 'sidebar', revert: 'sidebar' },
  { action: 'back', revert: 'forward' },
  { action: 'model-picker', dismissAfter: true },
  { action: 'command-menu-open', dismissAfter: true },
  { action: 'keyboard-shortcuts', dismissAfter: true },
];

function run(command, args, { timeoutMs = 25_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: String(error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function companion(args, options) {
  const result = await run(executablePath, args, options);
  try {
    return { ...result, json: JSON.parse(result.stdout) };
  } catch {
    return { ...result, json: null };
  }
}

async function installedCodexApps() {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
  const found = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      if (!/codex|chatgpt|openai/i.test(entry)) continue;
      const plistPath = path.join(root, entry, 'Contents', 'Info.plist');
      const bundleId = await run('/usr/libexec/PlistBuddy', [
        '-c', 'Print :CFBundleIdentifier', plistPath,
      ]);
      const version = await run('/usr/libexec/PlistBuddy', [
        '-c', 'Print :CFBundleShortVersionString', plistPath,
      ]);
      const build = await run('/usr/libexec/PlistBuddy', [
        '-c', 'Print :CFBundleVersion', plistPath,
      ]);
      found.push({
        app: path.join(root, entry),
        bundleId: bundleId.stdout || null,
        version: version.stdout || null,
        build: build.stdout || null,
      });
    }
  }
  return found;
}

async function runningCodexProcesses() {
  const result = await run('/bin/sh', [
    '-c',
    "ps -Ao pid,comm | grep -iE 'codex|chatgpt' | grep -v grep",
  ]);
  return result.stdout ? result.stdout.split('\n') : [];
}

async function bundleIdInSwiftSource() {
  const source = await readFile(
    path.resolve(import.meta.dirname, '..', 'native', 'MicrodexDesktop.swift'),
    'utf8',
  );
  return source.match(/let bundleIdentifier = "([^"]+)"/)?.[1] ?? null;
}

function condense(elements) {
  return elements
    .filter((element) => element.title || element.description || element.help)
    .map((element) => ({
      role: element.role,
      title: element.title,
      description: element.description,
      help: element.help,
      value: String(element.value ?? '').slice(0, 60),
    }));
}

function print(title) {
  console.log(`\n=== ${title} ===`);
}

const report = { generatedAt: new Date().toISOString(), platform: process.platform };

if (process.platform !== 'darwin') {
  console.error('Questo script va lanciato sul Mac dove gira Codex.');
  process.exit(1);
}

report.macos = (await run('/usr/bin/sw_vers', ['-productVersion'])).stdout;
report.locale = (await run('/usr/bin/defaults', ['read', '-g', 'AppleLocale'])).stdout;
report.appleLanguages = (await run('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'])).stdout;
report.expectedBundleId = await bundleIdInSwiftSource();
report.installedApps = await installedCodexApps();
report.runningProcesses = await runningCodexProcesses();

print('Ambiente');
console.log(`macOS ${report.macos} · locale ${report.locale}`);
console.log(`bundle id atteso dal companion: ${report.expectedBundleId}`);
for (const app of report.installedApps) {
  console.log(`app: ${app.app} · ${app.bundleId} · ${app.version} (${app.build})`);
}
const bundleMatch = report.installedApps.some(
  (app) => app.bundleId === report.expectedBundleId,
);
report.bundleIdMatches = bundleMatch;
if (!bundleMatch) {
  console.log('ATTENZIONE: nessuna app installata usa il bundle id atteso.');
}

print('Build companion');
try {
  await ensureDesktopCompanion();
  console.log('build ok');
  report.build = { ok: true };
} catch (error) {
  console.log(`build FALLITA: ${error.message}`);
  report.build = { ok: false, error: error.message };
}

print('Stato companion');
report.status = await desktopControlStatus().catch((error) => ({ error: error.message }));
console.log(JSON.stringify(report.status, null, 2));

print('Dump albero accessibilita');
// Un overlay rimasto aperto da una sessione precedente falserebbe tutto.
await companion(['action', 'dismiss']);
const inspect = await companion(['inspect'], { timeoutMs: 60_000 });
report.inspect = inspect.json;
if (inspect.json?.ok) {
  const condensed = condense(inspect.json.elements ?? []);
  report.elements = condensed;
  console.log(`${inspect.json.elements.length} elementi, ${condensed.length} con etichetta`);
  const byRole = condensed.reduce((counts, element) => {
    counts[element.role] = (counts[element.role] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify(byRole, null, 2));

  // Menu bar e contenuto finestra vanno guardati separatamente: il primo c'e'
  // sempre, il secondo esiste solo se la web view espone il suo albero.
  const isMenu = (element) => element.role === 'AXMenuItem' || element.role === 'AXMenuBarItem';
  const menuItems = condensed.filter(isMenu);
  const windowItems = condensed.filter((element) => !isMenu(element));
  report.menuItemCount = menuItems.length;
  report.windowItemCount = windowItems.length;

  console.log(`\nContenuto finestra: ${windowItems.length} elementi`);
  if (windowItems.length === 0) {
    console.log('  VUOTO: la finestra non espone nulla via accessibilita.');
  }
  for (const element of windowItems.slice(0, 120)) {
    const label = element.title || element.description || element.help;
    console.log(`  ${element.role.padEnd(22)} ${label}`);
  }

  console.log(`\nVoci di menu: ${menuItems.length}`);
  for (const element of menuItems) {
    const label = element.title || element.description || element.help;
    console.log(`  ${element.role.padEnd(16)} ${label}`);
  }
} else {
  console.log(`inspect FALLITO: ${inspect.stdout || inspect.stderr}`);
}

print('Contenuto del model picker (Speed / Effort)');
const picker = await companion(['inspect-model-picker'], { timeoutMs: 45_000 });
report.modelPicker = picker.json;
if (picker.json?.ok) {
  const label = (element) => element.title || element.description || element.value || element.help;
  console.log(`titolo picker: "${picker.json.pickerTitle}"`);
  console.log(`gia in vista avanzata: ${picker.json.alreadyAdvanced}`);

  // Le voci del menu bar sono rumore: interessano solo quelle del picker.
  const menuBarTitles = new Set(
    (report.elements ?? [])
      .filter((element) => element.role === 'AXMenuItem')
      .map((element) => element.title),
  );
  const pickerOnly = picker.json.opened.filter(
    (element) => !menuBarTitles.has(element.title),
  );
  console.log(`\nVoci proprie del picker (${pickerOnly.length}):`);
  for (const element of pickerOnly) console.log(`  ${label(element)}`);

  for (const [name, items] of Object.entries(picker.json.submenus ?? {})) {
    console.log(`\nSottomenu ${name} (${items.length}):`);
    for (const element of items) {
      console.log(`  ${element.error ? `ERRORE: ${element.error}` : label(element)}`);
    }
  }
} else {
  console.log(`inspect-model-picker FALLITO: ${picker.stdout || picker.stderr}`);
}

print('Verifica etichette usate dal codice');
report.labels = [];
for (const probe of LABEL_PROBES) {
  const args = ['exists', probe.query];
  if (probe.role) args.push(probe.role);
  const result = await companion(args);
  const found = Boolean(result.json?.found);
  // Un'etichetta contestuale assente a riposo e' normale, non un guasto.
  const verdict = found ? 'OK      ' : probe.scope ? 'ATTESA  ' : 'MANCA   ';
  report.labels.push({ ...probe, found, raw: result.json ?? result.stdout });
  console.log(
    `  ${verdict} "${probe.query}" (${probe.usedBy})${
      !found && probe.scope ? ` — ${probe.scope}` : ''
    }`,
  );
}

if (runActions) {
  print('Prova azioni non distruttive');
  report.actions = [];
  for (const probe of SAFE_ACTIONS) {
    const result = await companion(['action', probe.action]);
    const ok = Boolean(result.json?.ok);
    console.log(`  ${ok ? 'OK     ' : 'ERRORE '} ${probe.action}${ok ? '' : ` -> ${result.json?.error ?? result.stdout ?? result.stderr}`}`);
    report.actions.push({
      action: probe.action,
      ok,
      error: result.json?.error ?? null,
    });
    if (probe.dismissAfter) await companion(['action', 'dismiss']);
    if (probe.revert) await companion(['action', probe.revert]);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
} else {
  console.log('\n(Usa --actions per provare anche le azioni non distruttive.)');
}

await writeFile(reportPath, JSON.stringify(report, null, 2));
print('Fatto');
console.log(`Report completo: ${reportPath}`);
console.log('Mandami quel file, oppure incolla tutto quello che vedi sopra.');
