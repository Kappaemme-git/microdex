import { mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(bridgeDir, 'native', 'MicrodexQueue.swift');
const installDir = path.join(os.homedir(), '.microdex', 'bin');
const executablePath = path.join(installDir, 'MicrodexQueue');

let queueProcess = null;

async function needsBuild() {
  try {
    const [source, executable] = await Promise.all([stat(sourcePath), stat(executablePath)]);
    return source.mtimeMs > executable.mtimeMs;
  } catch {
    return true;
  }
}

async function compile() {
  if (!(await needsBuild())) return;
  await mkdir(installDir, { recursive: true, mode: 0o700 });
  await new Promise((resolve, reject) => {
    const child = spawn('xcrun', [
      'swiftc',
      '-O',
      '-framework',
      'AppKit',
      '-framework',
      'Foundation',
      sourcePath,
      '-o',
      executablePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errorOutput = '';
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `Queue companion build failed (${code}).`));
    });
  });
}

export async function launchDesktopQueueMenu({ port, token }) {
  if (process.platform !== 'darwin') return null;
  await compile();
  if (queueProcess && queueProcess.exitCode === null) return queueProcess;
  queueProcess = spawn(executablePath, [String(port)], {
    env: { ...process.env, MICRODEX_TOKEN: token },
    stdio: 'ignore',
  });
  queueProcess.on('exit', () => {
    queueProcess = null;
  });
  return queueProcess;
}

export function closeDesktopQueueMenu() {
  if (queueProcess && queueProcess.exitCode === null) queueProcess.kill('SIGTERM');
  queueProcess = null;
}
