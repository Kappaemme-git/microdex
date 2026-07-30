import { CodexAppServer } from '../lib/codex-app-server.mjs';
import { desktopControlStatus } from '../lib/codex-desktop-control.mjs';
import {
  buildActionAvailability,
  CODEX_KEYCAP_ACTIONS,
} from '../lib/programmed-actions.mjs';

const codex = new CodexAppServer();
let state = null;
let desktop = null;

try {
  await codex.ready();
  [state, desktop] = await Promise.all([
    codex.state(),
    desktopControlStatus(),
  ]);
} finally {
  codex.close();
}

const availability = buildActionAvailability({ state, desktop });
const rows = CODEX_KEYCAP_ACTIONS.map((action) => {
  const runtime = availability[action.id];
  return {
    id: action.id,
    label: action.label,
    result: runtime.status.toUpperCase(),
    reason: runtime.reason || (
      action.kind === 'fast' || action.kind === 'effort'
        ? 'Verified through the Codex App Server.'
        : 'Bridge prerequisites are ready.'
    ),
  };
});

console.table(rows);

const summary = rows.reduce((counts, row) => {
  counts[row.result] = (counts[row.result] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ total: rows.length, summary }, null, 2));

if (rows.some((row) => !row.reason)) {
  process.exitCode = 1;
}
