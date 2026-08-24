import { CameraView } from 'expo-camera';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MicrodexIcon } from '@/components/microdex-icon';
import type { ControllerStyles } from '@/features/controller/styles';

type PairingScannerModalProps = {
  visible: boolean;
  styles: ControllerStyles;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onCodeScanned: (value: string) => void;
};

export function PairingScannerModal({
  visible,
  styles,
  topInset,
  bottomInset,
  onClose,
  onCodeScanned,
}: PairingScannerModalProps) {
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.scannerScreen}>
        {visible ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onCodeScanned(data)}
          />
        ) : null}
        <View style={[styles.scannerHeader, { paddingTop: topInset + 12 }]}>
          <Pressable
            accessibilityLabel="Close QR scanner"
            onPress={onClose}
            style={styles.scannerClose}>
            <MicrodexIcon name="close" size={23} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.scannerTitle}>Scan your computer</Text>
          <View style={styles.scannerHeaderSpacer} />
        </View>
        <View style={styles.scannerFrame}>
          <View style={[styles.scannerCorner, styles.scannerCornerTopLeft]} />
          <View style={[styles.scannerCorner, styles.scannerCornerTopRight]} />
          <View style={[styles.scannerCorner, styles.scannerCornerBottomLeft]} />
          <View style={[styles.scannerCorner, styles.scannerCornerBottomRight]} />
        </View>
        <View style={[styles.scannerFooter, { paddingBottom: bottomInset + 24 }]}>
          <Text style={styles.scannerHint}>
            Point the camera at the pairing QR shown by the Microdex bridge.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
