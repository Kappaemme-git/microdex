import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BUILT_IN_ACTIONS = new Set([
  'push-to-talk',
  'send',
  'new-chat',
  'review',
  'terminal',
  'sidebar',
  'back',
  'forward',
]);

const CUSTOM_ACTIONS = new Set(['approve', 'decline', 'fork-chat', 'plan']);

export class UnsupportedActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedActionError';
    this.statusCode = 501;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function macShortcut(action) {
  const event = {
    'push-to-talk': 'keystroke "d" using {control down, shift down}',
    send: 'key code 36',
    'new-chat': 'keystroke "n" using {command down}',
    review: 'keystroke "g" using {control down, shift down}',
    terminal: 'keystroke "`" using {control down}',
    sidebar: 'keystroke "b" using {command down}',
    back: 'keystroke "[" using {command down}',
    forward: 'keystroke "]" using {command down}',
  }[action];

  return run('osascript', [
    '-e',
    'tell application "ChatGPT" to activate',
    '-e',
    `tell application "System Events" to ${event}`,
  ]);
}

function windowsShortcut(action) {
  const keys = {
    'push-to-talk': '^+d',
    send: '{ENTER}',
    'new-chat': '^n',
    review: '^+g',
    terminal: '^`',
    sidebar: '^b',
    back: '^{[}',
    forward: '^{]}',
  }[action];
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    '$null = $shell.AppActivate("ChatGPT")',
    'Start-Sleep -Milliseconds 120',
    `$shell.SendKeys('${keys}')`,
  ].join('; ');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

async function runCustomHook(action, hooksDir) {
  const extension = process.platform === 'win32' ? '.ps1' : '.sh';
  const hookPath = path.join(hooksDir, `${action}${extension}`);
  try {
    await access(hookPath);
  } catch {
    throw new UnsupportedActionError(
      `“${action}” has no public shortcut. Create the local hook ${hookPath}.`,
    );
  }

  if (process.platform === 'win32') {
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      hookPath,
    ]);
  } else {
    await run('/bin/sh', [hookPath]);
  }
}

export async function executeDesktopAction(action, hooksDir) {
  if (CUSTOM_ACTIONS.has(action)) {
    await runCustomHook(action, hooksDir);
    return `Hook “${action}” executed.`;
  }
  if (!BUILT_IN_ACTIONS.has(action)) {
    throw new UnsupportedActionError(`Action is not allowed: ${action}`);
  }
  if (process.platform === 'darwin') await macShortcut(action);
  else if (process.platform === 'win32') await windowsShortcut(action);
  else {
    throw new UnsupportedActionError(
      'Automatic desktop shortcuts are available for macOS and Windows. Use a hook on Linux.',
    );
  }
  return `Action “${action}” sent to ChatGPT.`;
}
