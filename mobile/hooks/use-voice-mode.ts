import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';

import type { RemoteState } from '@/lib/bridge';
import { LED } from '@/lib/theme';
import {
  executeVoiceModePress,
  getVoicePresentation,
  type VoiceAction,
  type VoiceSnapshot,
} from '@/lib/voice-mode';

type UseVoiceModeOptions = {
  voice: VoiceSnapshot;
  requireBridge: () => boolean;
  requireVerifiedSettings: () => boolean;
  requestVoiceAction: (action: VoiceAction) => Promise<RemoteState>;
  verifyCommand: (next: RemoteState) => unknown;
  setRemote: (next: RemoteState) => void;
  setLoadingAction: (action: string | null) => void;
  announce: (message: string, isError?: boolean) => void;
  flashHardwareFeedback: (color: string) => void;
  handleActionError: (error: unknown) => void;
};

export function useVoiceMode({
  voice,
  requireBridge,
  requireVerifiedSettings,
  requestVoiceAction,
  verifyCommand,
  setRemote,
  setLoadingAction,
  announce,
  flashHardwareFeedback,
  handleActionError,
}: UseVoiceModeOptions) {
  const presentation = getVoicePresentation(voice);

  const handleVoicePress = useCallback(
    () => executeVoiceModePress({
      voice,
      requireBridge,
      requireVerifiedSettings,
      requestVoiceAction,
      verifyCommand,
      setRemote,
      setLoadingAction,
      announce,
      flashComplete: () => flashHardwareFeedback(LED.complete),
      flashError: () => flashHardwareFeedback(LED.error),
      handleActionError,
      impact: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      notifySuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      notifyError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    }),
    [
      announce,
      flashHardwareFeedback,
      handleActionError,
      requestVoiceAction,
      requireBridge,
      requireVerifiedSettings,
      setLoadingAction,
      setRemote,
      verifyCommand,
      voice,
    ],
  );

  return {
    presentation,
    handleVoicePress,
  };
}
