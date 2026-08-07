const { defaultSocketPath, installHook } = require("./patch.cjs");

try {
  installHook({ socketPath: defaultSocketPath() });
} catch (error) {
  try {
    process.stderr.write(`[codex-micro-phone-shim] ${error.stack || error.message}\n`);
  } catch {
    // Never allow a failed probe to crash Codex.
  }
} finally {
  const previousNodeOptions = process.env.CODEX_MICRO_PREVIOUS_NODE_OPTIONS;
  if (previousNodeOptions) process.env.NODE_OPTIONS = previousNodeOptions;
  else delete process.env.NODE_OPTIONS;
  delete process.env.CODEX_MICRO_PREVIOUS_NODE_OPTIONS;
}

