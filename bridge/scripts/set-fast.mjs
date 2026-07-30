#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';

import { applyFastMode, readCodexStatus } from '../lib/codex-config.mjs';

const [mode = 'status', ...args] = process.argv.slice(2);
const configFlag = args.indexOf('--config');
const configPath =
  configFlag >= 0 && args[configFlag + 1]
    ? path.resolve(args[configFlag + 1])
    : path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

if (!['on', 'off', 'status'].includes(mode)) {
  console.error('Usage: node bridge/scripts/set-fast.mjs <on|off|status> [--config path]');
  process.exit(2);
}

const status =
  mode === 'status' ? await readCodexStatus(configPath) : await applyFastMode(configPath, mode === 'on');

console.log(JSON.stringify({ fastMode: status.fastMode, configPath }, null, 2));
