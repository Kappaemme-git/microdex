export type CameraPermissionSnapshot = {
  granted: boolean;
  canAskAgain?: boolean;
} | null;

export type CameraPermissionStep = 'open' | 'request' | 'settings';

export function cameraPermissionStep(
  permission: CameraPermissionSnapshot,
): CameraPermissionStep {
  if (permission?.granted) return 'open';
  if (permission?.canAskAgain === false) return 'settings';
  return 'request';
}

export function cameraPermissionMessage(step: CameraPermissionStep) {
  if (step === 'settings') {
    return 'Camera access is disabled. Enable Camera in Settings to scan the pairing QR.';
  }
  return 'Camera permission is needed to scan the pairing QR.';
}
