import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const credentialDir = path.join(os.homedir(), '.microdex');
const credentialPath = path.join(credentialDir, 'access-token');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function persistentToken() {
  if (process.env.MICRODEX_TOKEN?.trim()) return process.env.MICRODEX_TOKEN.trim();
  try {
    const saved = (await readFile(credentialPath, 'utf8')).trim();
    if (saved) return saved;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const token = randomBytes(9).toString('base64url').toUpperCase();
  await mkdir(credentialDir, { recursive: true, mode: 0o700 });
  await writeFile(credentialPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

const token = await persistentToken();
const children = [];
let closing = false;

function start(args, extraEnvironment = {}) {
  const child = spawn(npmCommand, args, {
    cwd: rootDir,
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (!closing) {
      console.error(`Microdex service stopped (${signal || code || 'unknown'}).`);
      shutdown(code || 1);
    }
  });
}

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 250);
}

console.log('\nStarting Microdex for your phone');
console.log(`Access code: ${token}`);
console.log('Open Expo Go and scan the QR code that appears below.\n');

start(['run', 'bridge'], { MICRODEX_TOKEN: token });
start(['run', 'mobile:lan'], { EXPO_PUBLIC_MICRODEX_TOKEN: token });

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
