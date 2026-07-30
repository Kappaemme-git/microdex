import { executeCodexDesktopAction } from './codex-desktop-control.mjs';

function settingMismatch(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'SETTING_NOT_APPLIED';
  return error;
}

function verifyFastSetting(state, expected) {
  const actual = state?.selected?.fastMode;
  if (actual !== expected) {
    throw settingMismatch(
      `Fast Mode was not applied by Codex. It is still ${actual ? 'enabled' : 'disabled'}. ` +
      'Update Codex and check that Fast Mode is available for this account and task.',
    );
  }
}

function verifyReasoningSetting(state, expected) {
  const actual = state?.selected?.reasoningEffort;
  if (actual !== expected) {
    throw settingMismatch(
      `The reasoning effort was not applied by Codex. It is still ${actual || 'unknown'}, ` +
      `not ${expected}. Update Codex and try again.`,
    );
  }
}

export async function applyFastSetting({
  body,
  codex,
  executeDesktopAction = executeCodexDesktopAction,
}) {
  // The visible Codex task is authoritative. The bridge App Server is a
  // separate process and can hold an unloaded copy of the same task.
  await executeDesktopAction('fast', String(body.fastMode));
  let state;
  let appServerSyncError = null;
  try {
    state = await codex.updateSettings(body);
  } catch (error) {
    appServerSyncError = error.message;
    // This is a readback only. Never write the requested value into the local
    // cache before reading it, otherwise Microdex can confirm its own
    // optimistic state even though Codex rejected the update.
    state = await codex.state();
  }
  verifyFastSetting(state, body.fastMode);
  return { state, desktopSyncError: null, appServerSyncError };
}

export async function applyReasoningSetting({
  body,
  codex,
  executeDesktopAction = executeCodexDesktopAction,
}) {
  const response = await executeDesktopAction(
    body.reasoningDirection ?? 'reasoning-up',
    body.reasoningEffort,
  );

  // Models expose different rungs of the effort ladder: 5.6 Sol stops at Extra
  // High. When the requested level does not exist the companion applies the
  // nearest one in the direction of travel and says so, so the verification and
  // the dial have to follow the real value rather than the requested one.
  const appliedEffort = response?.appliedEffort ?? body.reasoningEffort;
  const clamped = appliedEffort !== body.reasoningEffort;
  const effective = { ...body, reasoningEffort: appliedEffort };

  let state;
  let appServerSyncError = null;
  try {
    state = await codex.updateSettings(effective);
  } catch (error) {
    appServerSyncError = error.message;
    // See applyFastSetting: only an independently observed Codex value is
    // allowed to confirm the action.
    state = await codex.state();
  }
  verifyReasoningSetting(state, appliedEffort);
  return {
    state,
    desktopSyncError: null,
    appServerSyncError,
    appliedEffort,
    clamped,
    offeredEfforts: response?.offeredEfforts ?? null,
  };
}
