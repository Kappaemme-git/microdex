import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexAppServer } from '../lib/codex-app-server.mjs';

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
const candidateSourcePath = path.join(
  projectRoot,
  'bridge/native/MicrodexDesktop.swift',
);
const latestSourcePath = path.join(
  os.homedir(),
  '.microdex/runtime/node_modules/microdex-cli/bridge/native/MicrodexDesktop.swift',
);

function run(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      const result = {
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(result.stderr || result.stdout || `${command} exited ${code}`));
    });
  });
}

async function compile(sourcePath, outputPath) {
  await run('xcrun', [
    'swiftc',
    '-O',
    '-framework',
    'AppKit',
    '-framework',
    'ApplicationServices',
    '-framework',
    'Carbon',
    sourcePath,
    '-o',
    outputPath,
  ]);
}

async function downloadPackageSource(version, relativePath, directory) {
  const metadata = await run('npm', [
    'view',
    `microdex-cli@${version}`,
    'dist.tarball',
  ]);
  const response = await fetch(metadata.stdout.trim());
  assert.equal(response.ok, true, `Could not download microdex-cli@${version}.`);
  const archivePath = path.join(directory, `microdex-cli-${version}.tgz`);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await run('tar', [
    '-xzf',
    archivePath,
    '-C',
    directory,
    `package/${relativePath}`,
  ]);
  return path.join(directory, 'package', relativePath);
}

async function companion(binary, args, { allowFailure = false } = {}) {
  const result = await run(binary, args, { allowFailure: true });
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    payload = { ok: false, error: result.stderr || result.stdout || 'Invalid JSON' };
  }
  if (!allowFailure && (result.code !== 0 || !payload.ok)) {
    throw new Error(payload.error || result.stderr || `Companion failed: ${args.join(' ')}`);
  }
  return { ...result, payload };
}

function withProbeOperation(source) {
  const marker = '    } else if operation == "inspect-model-picker" {';
  assert.ok(source.includes(marker), 'Could not inject the read-only live probe.');
  const probe = `    } else if operation == "read-model-settings" {
        try prepareAdvancedModelPicker()
        let speedSummary = compactMenuSummary(try compactMenuItem(named: "Speed"))
        let effort = currentEffortId() ?? ""
        let effortItem = try compactMenuItem(named: "Effort")
        try clickElement(effortItem)
        Thread.sleep(forTimeInterval: 0.25)
        let offered = try offeredEffortIds()
        postKey(CGKeyCode(kVK_Escape))
        postKey(CGKeyCode(kVK_Escape))
        json([
            "ok": true,
            "fastMode": speedSummary.contains("speed fast"),
            "reasoningEffort": effort,
            "offeredEfforts": offered,
            "speedSummary": speedSummary,
        ])
`;
  return source.replace(marker, `${probe}${marker}`);
}

async function readSettings(probeBinary) {
  const { payload } = await companion(probeBinary, ['read-model-settings']);
  return {
    fastMode: Boolean(payload.fastMode),
    reasoningEffort: String(payload.reasoningEffort),
    offeredEfforts: Array.isArray(payload.offeredEfforts)
      ? payload.offeredEfforts.map(String)
      : [],
    speedSummary: String(payload.speedSummary || ''),
  };
}

function differentEffort(initial, offered) {
  const ladder = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const candidates = ladder.filter((effort) => offered.includes(effort));
  const index = candidates.indexOf(initial);
  if (index === -1 || candidates.length < 2) return null;
  return candidates[index + 1] ?? candidates[index - 1] ?? null;
}

function direction(initial, target) {
  const ladder = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  return ladder.indexOf(target) >= ladder.indexOf(initial)
    ? 'reasoning-up'
    : 'reasoning-down';
}

async function restore(binary, initial) {
  await companion(binary, ['action', 'fast', String(initial.fastMode)]);
  if (initial.reasoningEffort) {
    await companion(binary, [
      'action',
      'reasoning-up',
      initial.reasoningEffort,
    ]);
  }
}

async function exercise(binary, probeBinary, initial, targetEffort) {
  const targetFast = !initial.fastMode;
  const fastResult = await companion(
    binary,
    ['action', 'fast', String(targetFast)],
    { allowFailure: true },
  );
  const afterFast = await readSettings(probeBinary);
  await restore(probeBinary, initial);

  let effortResult = null;
  let afterEffort = null;
  if (targetEffort) {
    effortResult = await companion(
      binary,
      ['action', direction(initial.reasoningEffort, targetEffort), targetEffort],
      { allowFailure: true },
    );
    afterEffort = await readSettings(probeBinary);
    await restore(probeBinary, initial);
  }

  return {
    fast: {
      commandOk: fastResult.code === 0 && fastResult.payload.ok === true,
      error: fastResult.payload.error ?? null,
      expected: targetFast,
      observed: afterFast.fastMode,
      applied: afterFast.fastMode === targetFast,
    },
    effort: targetEffort
      ? {
          commandOk: effortResult.code === 0 && effortResult.payload.ok === true,
          error: effortResult.payload.error ?? null,
          expected: targetEffort,
          observed: afterEffort.reasoningEffort,
          applied: afterEffort.reasoningEffort === targetEffort,
        }
      : {
          skipped: true,
          reason: 'The active model exposes only one drivable effort.',
        },
  };
}

async function exercisePipeline({
  mode,
  binary,
  codex,
  initial,
  targetEffort,
}) {
  const targetFast = !initial.fastMode;
  const results = {};

  const runSetting = async ({ body, helperArgs, expectedField, expectedValue }) => {
    let helperResult;
    let updateAttempted = false;
    if (mode === 'app-server-first') {
      await codex.updateSettings(body);
      updateAttempted = true;
      helperResult = await companion(binary, helperArgs, { allowFailure: true });
    } else {
      helperResult = await companion(binary, helperArgs, { allowFailure: true });
      if (helperResult.code === 0 && helperResult.payload.ok === true) {
        await codex.updateSettings(body);
        updateAttempted = true;
      }
    }
    const state = await codex.state();
    return {
      helperOk: helperResult.code === 0 && helperResult.payload.ok === true,
      helperError: helperResult.payload.error ?? null,
      updateAttempted,
      expected: expectedValue,
      observed: state.selected?.[expectedField] ?? null,
      applied: state.selected?.[expectedField] === expectedValue,
    };
  };

  results.fast = await runSetting({
    body: { threadId: initial.threadId, fastMode: targetFast },
    helperArgs: ['action', 'fast', String(targetFast)],
    expectedField: 'fastMode',
    expectedValue: targetFast,
  });
  await codex.updateSettings({
    threadId: initial.threadId,
    fastMode: initial.fastMode,
  });

  if (targetEffort) {
    results.effort = await runSetting({
      body: { threadId: initial.threadId, reasoningEffort: targetEffort },
      helperArgs: [
        'action',
        direction(initial.reasoningEffort, targetEffort),
        targetEffort,
      ],
      expectedField: 'reasoningEffort',
      expectedValue: targetEffort,
    });
    await codex.updateSettings({
      threadId: initial.threadId,
      reasoningEffort: initial.reasoningEffort,
    });
  } else {
    results.effort = {
      skipped: true,
      reason: 'The active model exposes only one drivable effort.',
    };
  }
  return results;
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'microdex-live-settings-'));
const baselineBinary = path.join(temporaryDirectory, 'MicrodexDesktop-0.1.6');
const latestBinary = path.join(temporaryDirectory, 'MicrodexDesktop-0.1.11');
const probeSourcePath = path.join(temporaryDirectory, 'MicrodexDesktop-probe.swift');
const probeBinary = path.join(temporaryDirectory, 'MicrodexDesktop-probe');

let initial = null;
let codex = null;
let pipelineInitial = null;
try {
  console.error('[1/6] Preparing CLI 0.1.6 and CLI 0.1.11 without touching the mobile app…');
  const candidateSource = await readFile(candidateSourcePath, 'utf8');
  const baselineSourcePath = await downloadPackageSource(
    '0.1.6',
    'bridge/native/MicrodexDesktop.swift',
    temporaryDirectory,
  );
  await writeFile(probeSourcePath, withProbeOperation(candidateSource));
  await Promise.all([
    compile(baselineSourcePath, baselineBinary),
    compile(latestSourcePath, latestBinary),
    compile(probeSourcePath, probeBinary),
  ]);

  console.error('[2/6] Reading the visible Codex Speed and Effort values…');
  initial = await readSettings(probeBinary);
  assert.ok(
    initial.speedSummary.startsWith('speed '),
    `Could not read the visible Speed row: ${initial.speedSummary || 'missing'}`,
  );
  assert.ok(initial.reasoningEffort, 'Could not read the visible Effort row.');
  const targetEffort = differentEffort(
    initial.reasoningEffort,
    initial.offeredEfforts,
  );

  console.error('[3/6] Exercising the last known working CLI 0.1.6…');
  const baseline = await exercise(
    baselineBinary,
    probeBinary,
    initial,
    targetEffort,
  );
  console.error('[4/6] Restored the initial state after the 0.1.6 test.');
  console.error('[5/6] Exercising the CLI 0.1.11 used by the current beta…');
  const latest = await exercise(
    latestBinary,
    probeBinary,
    initial,
    targetEffort,
  );

  console.error('[6/6] Comparing the complete App Server-first and picker-first pipelines…');
  codex = new CodexAppServer();
  await codex.ready();
  const liveState = await codex.state();
  assert.ok(liveState.selectedThreadId, 'No active Codex task is available.');
  await codex.selectThread(liveState.selectedThreadId);
  const selectedState = await codex.state();
  pipelineInitial = {
    threadId: selectedState.selectedThreadId,
    fastMode: selectedState.selected.fastMode,
    reasoningEffort: selectedState.selected.reasoningEffort,
  };
  const pipelineTargetEffort = differentEffort(
    pipelineInitial.reasoningEffort,
    selectedState.selected.supportedReasoningEfforts,
  );
  const baselinePipeline = await exercisePipeline({
    mode: 'app-server-first',
    binary: baselineBinary,
    codex,
    initial: pipelineInitial,
    targetEffort: pipelineTargetEffort,
  });
  const latestPipeline = await exercisePipeline({
    mode: 'picker-first',
    binary: latestBinary,
    codex,
    initial: pipelineInitial,
    targetEffort: pipelineTargetEffort,
  });

  const result = {
    initial,
    targetEffort,
    baseline016: baseline,
    latest011: latest,
    pipelineInitial,
    baseline016Pipeline: baselinePipeline,
    latest011Pipeline: latestPipeline,
    reproduced:
      baselinePipeline.fast.applied &&
      (baselinePipeline.effort.skipped === true || baselinePipeline.effort.applied) &&
      (!latestPipeline.fast.applied ||
        (latestPipeline.effort.skipped !== true && !latestPipeline.effort.applied)),
  };
  console.log(JSON.stringify(result, null, 2));
  assert.equal(
    result.reproduced,
    true,
    'The 0.1.6 → 0.1.11 live regression was not reproduced.',
  );
} finally {
  if (codex) {
    await codex.updateSettings({
      threadId: pipelineInitial?.threadId,
      fastMode: pipelineInitial?.fastMode,
      reasoningEffort: pipelineInitial?.reasoningEffort,
    }).catch(() => {});
    codex.close();
  }
  if (initial) await restore(probeBinary, initial).catch(() => {});
  await rm(temporaryDirectory, { recursive: true, force: true });
}
