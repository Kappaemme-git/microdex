import { Text, View } from 'react-native';

import { MicrodexIcon } from '@/components/microdex-icon';
import { MicrodexActionGlyph } from '@/components/microdex-keycap-glyph';
import type { ControllerStyles } from '@/features/controller/styles';
import type { MicroActionIcon } from '@/lib/micro-actions';
import type { ThemePalette } from '@/lib/theme';

type GuideItemProps = {
  styles: ControllerStyles;
  theme: ThemePalette;
  icon?: MicroActionIcon;
  actionId?: string;
  title: string;
  body: string;
};

export function GuideItem({
  styles,
  theme,
  icon,
  actionId,
  title,
  body,
}: GuideItemProps) {
  return (
    <View style={styles.guideItem}>
      <View style={styles.guideIcon}>
        {actionId ? (
          <MicrodexActionGlyph actionId={actionId} size={20} color={theme.text} />
        ) : (
          <MicrodexIcon name={icon ?? 'circle-outline'} size={20} color={theme.text} />
        )}
      </View>
      <View style={styles.guideCopy}>
        <Text style={styles.guideTitle}>{title}</Text>
        <Text style={styles.guideBody}>{body}</Text>
      </View>
    </View>
  );
}
