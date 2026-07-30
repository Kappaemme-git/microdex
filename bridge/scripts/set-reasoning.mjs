#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';

import { REASONING_EFFORTS, applyReasoningEffort } from '../lib/codex-config.mjs';

const [effort, ...args] = process.argv.slice(2);
const configFlag = args.indexOf('--config');
const configPath =
  configFlag >= 0 && args[configFlag + 1]
    ? path.resolve(args[configFlag + 1])
    : path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

if (!REASONING_EFFORTS.includes(effort)) {
  console.error(`Usage: node bridge/scripts/set-reasoning.mjs <${REASONING_EFFORTS.join('|')}> [--config path]`);
  process.exit(2);
}

const status = await applyReasoningEffort(configPath, effort);
console.log(JSON.stringify({ reasoningEffort: status.reasoningEffort, configPath }, null, 2));
