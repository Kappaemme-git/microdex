import type { ReactNode } from 'react';
import Svg, {
  Circle,
  G,
  Path,
  Text as SvgText,
  type CircleProps,
  type GProps,
  type PathProps,
} from 'react-native-svg';

import { suggestedKeycapForCommand } from '@/lib/keycap-catalog';
import {
  OFFICIAL_CODEX_MICRO_GLYPHS,
  OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS,
  type OfficialGlyphNode,
} from '@/lib/official-codex-micro-glyphs';
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
 * The official Codex Micro legends use different view boxes, fills and stroke
 * weights. Keeping those values on each SVG node preserves the actual keycap
 * artwork instead of forcing every symbol through one approximate line style.
 */
export function CodexMicroGlyph({
  keycapId,
  size = 24,
  color = '#111719',
}: GlyphProps) {
  const legend = OFFICIAL_CODEX_MICRO_KEYCAP_LEGENDS[keycapId];

  if (legend === 'empty') return null;

  if (legend === 'yolo' || legend === 'yeet') {
    return (
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        <SvgText
          x="10"
          y="11.7"
          fill={color}
          fontFamily="IBMPlexMono_500Medium"
          fontSize="5.2"
          fontWeight="500"
          textAnchor="middle"
        >
          {legend === 'yolo' ? 'yolo' : 'yeet'}
        </SvgText>
      </Svg>
    );
  }

  const glyph = OFFICIAL_CODEX_MICRO_GLYPHS[legend];
  return (
    <Svg
      width={size}
      height={size}
      viewBox={glyph.viewBox}
      color={color}
      fill={glyph.fill?.includes('currentColor') ? color : glyph.fill}
    >
      {glyph.nodes.map((node, index) =>
        renderNode(node, `${legend}-${index}`, color),
      )}
    </Svg>
  );
}

export function CodexMicroActionGlyph({
  actionId,
  size = 22,
  color = '#111719',
}: ActionGlyphProps) {
  const keycapId =
    actionId === 'microdex.insertPrompt'
      ? 'MAGIC'
      : (suggestedKeycapForCommand(actionId as ProgrammableCommandId) ??
        'MAGIC');
  return <CodexMicroGlyph keycapId={keycapId} size={size} color={color} />;
}

/** The AudioWaveform icon bundled with the native Codex Voice control. */
export function CodexVoiceGlyph({
  size = 24,
  color = '#111719',
}: VoiceGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function renderNode(
  node: OfficialGlyphNode,
  key: string,
  color: string,
): ReactNode {
  const props = resolveProps(node.props, color);
  const children = node.children?.map((child, index) =>
    renderNode(child, `${key}-${index}`, color),
  );

  switch (node.tag) {
    case 'circle':
      return <Circle key={key} {...(props as unknown as CircleProps)} />;
    case 'g':
      return (
        <G key={key} {...(props as unknown as GProps)}>
          {children}
        </G>
      );
    case 'path':
      return <Path key={key} {...(props as unknown as PathProps)} />;
  }
}

function resolveProps(
  props: Readonly<Record<string, string | number | boolean>>,
  color: string,
) {
  return Object.fromEntries(
    Object.entries(props).map(([name, value]) => [
      name,
      resolvePaint(value, color),
    ]),
  );
}

function resolvePaint(
  value: string | number | boolean | undefined,
  color: string,
) {
  if (typeof value === 'string' && value.includes('currentColor')) return color;
  return value;
}
