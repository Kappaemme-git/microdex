import Svg, { Text as SvgText } from 'react-native-svg';

import { MicrodexIcon } from '@/components/microdex-icon';
import { keycapDescriptor, suggestedKeycapForCommand } from '@/lib/keycap-catalog';
import type {
  MicroKeycapId,
  ProgrammableCommandId,
} from '@/lib/programmed-keys';

type GlyphProps = {
  keycapId: MicroKeycapId;
  size?: number;
  color?: string;
};

type ActionGlyphProps = {
  actionId: string;
  size?: number;
  color?: string;
};

type VoiceGlyphProps = {
  size?: number;
  color?: string;
};

/**
 * Renders legacy keycap identifiers with the Microdex icon system. The IDs are
 * retained only for layout compatibility; the artwork is Tabler or original
 * Microdex typography and is not copied from a physical product.
 */
export function MicrodexKeycapGlyph({
  keycapId,
  size = 24,
  color = '#111719',
}: GlyphProps) {
  if (keycapId.startsWith('EMPT')) return null;

  if (keycapId === 'YOLO' || keycapId === 'YEET') {
    return (
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <SvgText
          x="10"
          y="11.7"
          fill={color}
          fontFamily="IBMPlexMono_500Medium"
          fontSize="5.2"
          fontWeight="500"
          textAnchor="middle">
          {keycapId === 'YOLO' ? 'yolo' : 'yeet'}
        </SvgText>
      </Svg>
    );
  }

  const descriptor = keycapDescriptor(keycapId);
  return descriptor ? (
    <MicrodexIcon name={descriptor.icon} size={size} color={color} />
  ) : null;
}

export function MicrodexActionGlyph({
  actionId,
  size = 22,
  color = '#111719',
}: ActionGlyphProps) {
  const keycapId =
    actionId === 'microdex.insertPrompt'
      ? 'MAGIC'
      : (suggestedKeycapForCommand(actionId as ProgrammableCommandId) ??
        'MAGIC');
  return <MicrodexKeycapGlyph keycapId={keycapId} size={size} color={color} />;
}

export function MicrodexVoiceGlyph({
  size = 24,
  color = '#111719',
}: VoiceGlyphProps) {
  return <MicrodexIcon name="voice-wave" size={size} color={color} strokeWidth={2} />;
}
