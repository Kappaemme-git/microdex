import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

function runNode(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the desktop companion refreshes when its source changed despite a newer binary mtime', {
  skip: process.platform !== 'darwin',
  timeout: 30_000,
}, async () => {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'microdex-companion-test-'));
  const executable = path.join(temporaryHome, '.microdex', 'bin', 'MicrodexDesktop');
  const modulePath = fileURLToPath(
    new URL('../lib/codex-desktop-control.mjs', import.meta.url),
  );

  try {
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(
      executable,
      '#!/bin/sh\n# stale-companion\nprintf \'{"ok":true,"trusted":true,"running":true}\\n\'\n',
    );
    await chmod(executable, 0o755);
    const future = new Date(Date.now() + 60_000);
    await utimes(executable, future, future);

    const child = await runNode(
      `const module = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
       await module.ensureDesktopCompanion();`,
      { ...process.env, HOME: temporaryHome },
    );
    assert.equal(child.code, 0, child.stderr || child.stdout);

    const installedBytes = await readFile(executable);
    assert.equal(
      installedBytes.includes(Buffer.from('stale-companion')),
      false,
      'a newer timestamp must not preserve a companion built from different source code',
    );
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
});
