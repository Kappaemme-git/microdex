import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const cliPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../scripts/microdex.mjs',
);
const currentVersion = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Microdex setup timed out'));
    }, 12_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, output: `${stdout}\n${stderr}` });
    });
  });
}

test('setup reuses a healthy bridge when launchctl reports bootstrap error 5', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdex-setup-'));
  const stateDir = path.join(directory, 'state');
  const launchAgentsDir = path.join(directory, 'LaunchAgents');
  const fakeBin = path.join(directory, 'bin');
  await mkdir(fakeBin, { recursive: true });

  const fakeNpm = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const prefix = args[args.indexOf('--prefix') + 1];
const target = path.join(prefix, 'node_modules', 'microdex-cli', 'bridge', 'scripts');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'microdex.mjs'), '#!/usr/bin/env node\\n');
`;
  const fakeLaunchctl = `#!/usr/bin/env node
const operation = process.argv[2];
if (operation === 'bootout') process.exit(3);
if (operation === 'bootstrap') {
  console.error('Bootstrap failed: 5: Input/output error');
  console.error('Try re-running the command as root for richer errors.');
  process.exit(5);
}
process.exit(0);
`;
  await Promise.all([
    writeFile(path.join(fakeBin, 'npm'), fakeNpm, { mode: 0o755 }),
    writeFile(path.join(fakeBin, 'launchctl'), fakeLaunchctl, { mode: 0o755 }),
  ]);

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        version: currentVersion,
        protocolVersion: 2,
      }));
      return;
    }
    if (request.url === '/api/pair/new') {
      const address = server.address();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        pairingUrl: `http://127.0.0.1:${address.port}/pair?code=TEST`,
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    const address = await listen(server);
    const result = await runCli(['setup'], {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      MICRODEX_HOME: stateDir,
      MICRODEX_LAUNCH_AGENTS_DIR: launchAgentsDir,
      MICRODEX_LAUNCH_AGENT_LABEL: 'cc.microdex.test',
      MICRODEX_PACKAGE_SPEC: 'microdex-cli@test',
      MICRODEX_PORT: String(address.port),
    });

    assert.equal(
      result.status,
      0,
      `a healthy existing bridge should not be broken by a launchctl registration conflict:\n${result.output}`,
    );
    assert.match(result.output, /Scan pairing QR/);
    assert.doesNotMatch(result.output, /\bsudo\b|as root/i);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('setup never reports success while an outdated bridge owns the port', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdex-stale-setup-'));
  const stateDir = path.join(directory, 'state');
  const launchAgentsDir = path.join(directory, 'LaunchAgents');
  const fakeBin = path.join(directory, 'bin');
  await mkdir(fakeBin, { recursive: true });

  const fakeNpm = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const prefix = args[args.indexOf('--prefix') + 1];
const target = path.join(prefix, 'node_modules', 'microdex-cli', 'bridge', 'scripts');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'microdex.mjs'), '#!/usr/bin/env node\\n');
`;
  const fakeLaunchctl = `#!/usr/bin/env node
const operation = process.argv[2];
if (operation === 'bootout') process.exit(3);
process.exit(0);
`;
  await Promise.all([
    writeFile(path.join(fakeBin, 'npm'), fakeNpm, { mode: 0o755 }),
    writeFile(path.join(fakeBin, 'launchctl'), fakeLaunchctl, { mode: 0o755 }),
  ]);

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        version: '0.1.9',
        protocolVersion: 2,
      }));
      return;
    }
    if (request.url === '/api/pair/new') {
      const address = server.address();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        pairingUrl: `http://127.0.0.1:${address.port}/pair?code=STALE`,
      }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    const address = await listen(server);
    const result = await runCli(['setup'], {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      MICRODEX_HOME: stateDir,
      MICRODEX_LAUNCH_AGENTS_DIR: launchAgentsDir,
      MICRODEX_LAUNCH_AGENT_LABEL: 'cc.microdex.stale-test',
      MICRODEX_PACKAGE_SPEC: 'microdex-cli@test',
      MICRODEX_PORT: String(address.port),
    });

    assert.notEqual(
      result.status,
      0,
      `setup must not claim that an outdated bridge was updated:\n${result.output}`,
    );
    assert.doesNotMatch(result.output, /Starts automatically|Scan pairing QR/);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});
