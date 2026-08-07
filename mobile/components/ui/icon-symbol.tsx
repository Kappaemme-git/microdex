import { type StyleProp, type ViewStyle } from 'react-native';

import { MicrodexIcon, type MicrodexIconName } from '@/components/microdex-icon';

const MAPPING = {
  'house.fill': 'folder',
  'paperplane.fill': 'robot-outline',
  'chevron.left.forwardslash.chevron.right': 'console',
  'chevron.right': 'chevronRight',
} as const satisfies Record<string, MicrodexIconName>;

type IconSymbolName = keyof typeof MAPPING;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: IconSymbolName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: 'regular' | 'medium' | 'bold';
}) {
  return (
    <MicrodexIcon
      color={color}
      size={size}
      name={MAPPING[name]}
      strokeWidth={weight === 'bold' ? 2.3 : weight === 'medium' ? 2 : 1.8}
      style={style}
    />
  );
}
