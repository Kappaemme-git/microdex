import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { MicrodexIcon } from '@/components/microdex-icon';
import type { ControllerStyles } from '@/features/controller/styles';
import type { ThemePalette } from '@/lib/theme';

type ConnectionGateProps = {
  styles: ControllerStyles;
  theme: ThemePalette;
  topInset: number;
  bottomInset: number;
  credentialsReady: boolean;
  connecting: boolean;
  paired: boolean;
  scannerOpening: boolean;
  commandCopied: boolean;
  onCopyCommand: () => void;
  onRetry: () => void;
  onOpenScanner: () => void;
  onForgetMac: () => void;
  onEnterDemo: () => void;
};

export function ConnectionGate({
  styles,
  theme,
  topInset,
  bottomInset,
  credentialsReady,
  connecting,
  paired,
  scannerOpening,
  commandCopied,
  onCopyCommand,
  onRetry,
  onOpenScanner,
  onForgetMac,
  onEnterDemo,
}: ConnectionGateProps) {
  const copyCommandButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={commandCopied ? 'Command copied' : 'Copy bridge command'}
      onPress={onCopyCommand}
      style={({ pressed }) => [
        styles.gateCopyButton,
        commandCopied && styles.gateCopyButtonDone,
        pressed && styles.gateButtonPressed,
      ]}>
      <MicrodexIcon
        name={commandCopied ? 'check' : 'copy'}
        size={15}
        color={commandCopied ? theme.online : theme.textMuted}
      />
      {commandCopied ? <Text style={styles.gateCopyButtonLabel}>Copied</Text> : null}
    </Pressable>
  );

  return (
    <View style={styles.connectionGate}>
      <ScrollView
        style={styles.screenBody}
        contentContainerStyle={[
          styles.connectionGateContent,
          {
            paddingTop: Math.max(topInset + 32, 56),
            paddingBottom: Math.max(bottomInset, 24),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {!credentialsReady || (connecting && paired) ? (
          <View style={[styles.gateContent, styles.gateContentCentered]}>
            <ActivityIndicator size="small" color={theme.textMuted} />
            <Text style={styles.gateStateTitle}>
              {credentialsReady ? 'Connecting to your Mac' : 'Opening Microdex'}
            </Text>
            <Text style={styles.gateStateBody}>
              {credentialsReady
                ? 'Checking the secure bridge and your Codex session.'
                : 'Loading your saved pairing securely.'}
            </Text>
          </View>
        ) : paired ? (
          <View style={styles.gateContent}>
            <View style={styles.gateHero}>
              <Text style={styles.gateTitle}>Mac unavailable</Text>
              <Text style={styles.gateTitleMono}>bridge not reachable</Text>
            </View>
            <Text style={styles.gateNote}>
              Wake your Mac and open Codex. The background bridge reconnects automatically.
            </Text>
            <View style={styles.gateCommandRow}>
              <Text style={styles.gatePrompt}>$</Text>
              <Text selectable style={styles.gateCommandText}>
                npx microdex-cli@latest setup
              </Text>
              {copyCommandButton}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={connecting}
              onPress={onRetry}
              style={({ pressed }) => [
                styles.gatePrimaryButton,
                pressed && styles.gateButtonPressed,
              ]}>
              {connecting ? (
                <ActivityIndicator size="small" color={theme.bg} />
              ) : (
                <MicrodexIcon name="refresh" size={17} color={theme.bg} />
              )}
              <Text style={styles.gatePrimaryButtonText}>Retry connection</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: scannerOpening, disabled: scannerOpening }}
              disabled={scannerOpening}
              onPress={onOpenScanner}
              style={({ pressed }) => [
                styles.gateSecondaryButton,
                pressed && styles.gateButtonPressed,
              ]}>
              {scannerOpening ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <MicrodexIcon name="qrCode" size={17} color={theme.text} />
              )}
              <Text style={styles.gateSecondaryButtonText}>
                {scannerOpening ? 'Opening camera…' : 'Pair another Mac'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onForgetMac}
              style={({ pressed }) => [
                styles.gateTertiaryButton,
                pressed && styles.gateButtonPressed,
              ]}>
              <Text style={styles.gateTertiaryButtonText}>Forget this Mac</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.gateContent}>
            <View style={styles.gateHero}>
              <Text style={styles.gateTitle}>Control Codex</Text>
              <Text style={styles.gateTitleMono}>from your phone</Text>
            </View>
            <View style={styles.gateSteps}>
              <View style={styles.gateStep}>
                <Text style={styles.gateStepMarker}>01</Text>
                <View style={styles.gateStepCopy}>
                  <Text style={styles.gateStepTitle}>Start the Mac bridge</Text>
                  <Text style={styles.gateStepBody}>
                    Run this once on a Mac with Codex signed in. Setup installs an automatic background bridge, so Terminal can close after pairing.
                  </Text>
                  <View style={styles.gateCommandRow}>
                    <Text style={styles.gatePrompt}>$</Text>
                    <Text selectable style={styles.gateCommandText}>
                      npx microdex-cli@latest setup
                    </Text>
                    {copyCommandButton}
                  </View>
                </View>
              </View>
              <View style={styles.gateStep}>
                <Text style={styles.gateStepMarker}>02</Text>
                <View style={styles.gateStepCopy}>
                  <Text style={styles.gateStepTitle}>Scan the pairing QR</Text>
                  <Text style={styles.gateStepBody}>
                    The one-time code appears in Terminal after setup.
                  </Text>
                </View>
              </View>
              <View style={[styles.gateStep, styles.gateStepLast]}>
                <Text style={styles.gateStepMarker}>03</Text>
                <View style={styles.gateStepCopy}>
                  <Text style={styles.gateStepTitle}>Play with the keyboard</Text>
                  <Text style={styles.gateStepBody}>
                    Twelve keys, a joystick and a dial control your Mac. Or explore everything without a Mac first.
                  </Text>
                  <View style={styles.gateKeyPreview}>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => (
                      <View
                        key={slot}
                        style={[
                          styles.gatePreviewKey,
                          slot === 4 && styles.gatePreviewDial,
                        ]}
                      />
                    ))}
                  </View>
                </View>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: scannerOpening, disabled: scannerOpening }}
              disabled={scannerOpening}
              onPress={onOpenScanner}
              style={({ pressed }) => [
                styles.gatePrimaryButton,
                pressed && styles.gateButtonPressed,
              ]}>
              {scannerOpening ? (
                <ActivityIndicator size="small" color={theme.bg} />
              ) : (
                <MicrodexIcon name="qrCode" size={17} color={theme.bg} />
              )}
              <Text style={styles.gatePrimaryButtonText}>
                {scannerOpening ? 'Opening camera…' : 'Scan pairing code'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Explore Microdex without a Mac"
              onPress={onEnterDemo}
              style={({ pressed }) => [
                styles.gateDemoButton,
                pressed && styles.gateButtonPressed,
              ]}>
              <MicrodexIcon name="play-outline" size={15} color={theme.textMuted} />
              <Text style={styles.gateDemoButtonText}>Explore without a Mac</Text>
            </Pressable>
            <Text style={styles.gateFootnote}>
              Requires macOS, Codex signed in, Node.js 20.19+ and internet. Login and projects stay on your Mac.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
