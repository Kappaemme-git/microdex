import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import {
  cameraPermissionMessage,
  cameraPermissionStep,
} from '@/lib/pairing-scanner';

type UsePairingScannerOptions = {
  announce: (message: string, isError?: boolean) => void;
  dismissSettings: () => void;
};

const IOS_MODAL_DISMISS_MS = 450;

export function usePairingScanner({
  announce,
  dismissSettings,
}: UsePairingScannerOptions) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerOpening, setScannerOpening] = useState(false);
  const openingRef = useRef(false);

  const presentPairingScanner = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setScannerOpening(true);

    try {
      if (Platform.OS === 'web') {
        announce('QR pairing is available on iPhone and Android.', true);
        return;
      }

      let permission = cameraPermission;
      let step = cameraPermissionStep(permission);
      if (step === 'request') {
        announce('Requesting camera access…');
        permission = await requestCameraPermission();
        step = cameraPermissionStep(permission);
      }

      if (step !== 'open') {
        const message = cameraPermissionMessage(step);
        announce(message, true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'Camera access needed',
          message,
          step === 'settings'
            ? [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: () => void Linking.openSettings(),
                },
              ]
            : [{ text: 'OK' }],
        );
        return;
      }

      announce('Opening the QR scanner…');
      dismissSettings();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Platform.OS === 'ios' ? IOS_MODAL_DISMISS_MS : 0);
      });
      setScannerVisible(true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown camera error';
      announce(`Could not open the camera: ${detail}`, true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Could not open camera',
        'Try again. If the problem continues, enable Camera for Microdex in Settings.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
    } finally {
      openingRef.current = false;
      setScannerOpening(false);
    }
  }, [announce, cameraPermission, dismissSettings, requestCameraPermission]);

  return {
    scannerVisible,
    scannerOpening,
    setScannerVisible,
    presentPairingScanner,
  };
}
