import type { RemoteState } from './bridge.ts';

export type VoiceSnapshot = RemoteState['voice'];
export type VoiceState = NonNullable<VoiceSnapshot>['state'];
export type VoiceAction = 'voice-start' | 'voice-end';

export const VOICE_GLOW_COLOR = '#8EA8FF';
export const VOICE_LOADING_ACTION = 'voice';

export type VoicePresentation = {
  state: VoiceState;
  active: boolean;
  engaged: boolean;
  accessibilityLabel: 'Start Voice Chat on the Mac' | 'End Voice Chat on the Mac';
};

export function getVoicePresentation(voice: VoiceSnapshot): VoicePresentation {
  const state = voice?.state ?? 'inactive';
  const active = state === 'active';
  return {
    state,
    active,
    engaged: active || state === 'setup' || state === 'launching',
    accessibilityLabel: active
      ? 'End Voice Chat on the Mac'
      : 'Start Voice Chat on the Mac',
  };
}

export function getVoiceAction(voice: VoiceSnapshot): VoiceAction {
  return voice?.state === 'active' ? 'voice-end' : 'voice-start';
}

export function getVoiceIntentMessage(voice: VoiceSnapshot) {
  return voice?.state === 'active'
    ? 'Ending Voice Chat…'
    : 'Opening Voice Chat on your Mac…';
}

export function getVoiceResultMessage(
  nextVoice: VoiceSnapshot,
  wasActive: boolean,
) {
  if (nextVoice?.state === 'setup') {
    return 'Voice setup is open. Choose a voice on your Mac, then press VOICE again.';
  }
  if (nextVoice?.state === 'launching') {
    return 'Voice Chat opened on your Mac. Complete anything shown there, then press VOICE again.';
  }
  if (nextVoice?.state === 'active') {
    return nextVoice.muted
      ? 'Voice Chat microphone muted.'
      : 'Voice Chat is live on your Mac.';
  }
  if (wasActive && nextVoice?.state === 'inactive') {
    return 'Voice Chat ended on your Mac.';
  }
  return 'Voice Chat command sent to your Mac.';
}

type MaybePromise = void | Promise<void>;

export type VoiceModeDependencies = {
  voice: VoiceSnapshot;
  requireBridge: () => boolean;
  requireVerifiedSettings: () => boolean;
  requestVoiceAction: (action: VoiceAction) => Promise<RemoteState>;
  verifyCommand: (next: RemoteState) => unknown;
  setRemote: (next: RemoteState) => void;
  setLoadingAction: (action: string | null) => void;
  announce: (message: string, isError?: boolean) => void;
  flashComplete: () => void;
  flashError: () => void;
  handleActionError: (error: unknown) => void;
  impact: () => MaybePromise;
  notifySuccess: () => Promise<void>;
  notifyError: () => Promise<void>;
};

export async function executeVoiceModePress({
  voice,
  requireBridge,
  requireVerifiedSettings,
  requestVoiceAction,
  verifyCommand,
  setRemote,
  setLoadingAction,
  announce,
  flashComplete,
  flashError,
  handleActionError,
  impact,
  notifySuccess,
  notifyError,
}: VoiceModeDependencies) {
  if (!requireBridge() || !requireVerifiedSettings()) {
    flashError();
    return;
  }

  const action = getVoiceAction(voice);
  const wasActive = voice?.state === 'active';
  setLoadingAction(VOICE_LOADING_ACTION);
  announce(getVoiceIntentMessage(voice));
  void impact();

  try {
    const next = await requestVoiceAction(action);
    verifyCommand(next);
    setRemote(next);
    announce(getVoiceResultMessage(next.voice, wasActive));
    flashComplete();
    await notifySuccess();
  } catch (error) {
    handleActionError(error);
    flashError();
    await notifyError();
  } finally {
    setLoadingAction(null);
  }
}
