import { HardwareKey } from '@/components/hardware-key';
import { MicrodexVoiceGlyph } from '@/components/microdex-keycap-glyph';
import {
  VOICE_GLOW_COLOR,
  type VoicePresentation,
} from '@/lib/voice-mode';

type VoiceKeyProps = {
  presentation: VoicePresentation;
  iconColor: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
};

export function VoiceKey({
  presentation,
  iconColor,
  disabled,
  onPress,
}: VoiceKeyProps) {
  return (
    <HardwareKey
      accessibilityLabel={presentation.accessibilityLabel}
      symbol={<MicrodexVoiceGlyph color={iconColor} />}
      active={presentation.engaged}
      glowColor={presentation.engaged ? VOICE_GLOW_COLOR : undefined}
      disabled={disabled}
      onPress={() => void onPress()}
    />
  );
}
