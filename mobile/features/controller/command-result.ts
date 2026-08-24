import type { RemoteState } from '@/lib/bridge';

export function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Rejects commands the bridge did not apply. Older bridges omit `confirmed`,
 * so verification remains backward compatible while preserving any caveat.
 */
export function requireVerifiedCommand(state: RemoteState) {
  const result = state.commandResult;
  if (!result?.applied || !result.verified) {
    throw new Error(
      result?.warning ||
      'Codex received the command but did not confirm that it was applied.',
    );
  }
  const confirmed = result.confirmed ?? true;
  return confirmed ? null : result.warning ?? null;
}
