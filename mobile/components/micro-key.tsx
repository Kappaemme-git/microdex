import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MicrodexIcon, type MicrodexIconName } from '@/components/microdex-icon';

type MicroKeyProps = {
  label: string;
  sublabel?: string;
  icon?: MicrodexIconName;
  tone?: 'agent' | 'command';
  glow?: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

export function MicroKey({
  label,
  sublabel,
  icon,
  tone = 'command',
  glow = '#DDE5EA',
  active = false,
  disabled = false,
  onPress,
  onLongPress,
}: MicroKeyProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${sublabel ? `, ${sublabel}` : ''}`}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.key,
        tone === 'agent' ? styles.agentKey : styles.commandKey,
        tone === 'agent' && { borderColor: `${glow}66` },
        active && { borderColor: glow, shadowColor: glow, shadowOpacity: 0.65 },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {tone === 'agent' && (
        <View style={[styles.lightWell, { backgroundColor: glow, shadowColor: glow }]} />
      )}
      {icon ? (
        <MicrodexIcon
          name={icon}
          size={tone === 'agent' ? 22 : 25}
          color={active ? '#0A171D' : '#182127'}
        />
      ) : (
        <Text style={styles.monogram}>{label.slice(0, 2).toUpperCase()}</Text>
      )}
      <View style={styles.labelGroup}>
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {sublabel ? (
          <Text numberOfLines={1} style={styles.sublabel}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <View style={styles.keyShine} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  key: {
    width: '31.4%',
    aspectRatio: 0.94,
    minHeight: 82,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 11,
    paddingBottom: 9,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 13,
    shadowOpacity: 0.16,
    elevation: 5,
  },
  agentKey: {
    backgroundColor: 'rgba(226, 237, 242, 0.86)',
    borderColor: 'rgba(255,255,255,0.92)',
  },
  commandKey: {
    backgroundColor: '#F7F7F3',
    borderColor: '#D9DBD9',
    shadowColor: '#41515A',
  },
  pressed: {
    transform: [{ translateY: 3 }, { scale: 0.97 }],
    shadowOpacity: 0.05,
    elevation: 1,
  },
  disabled: {
    opacity: 0.48,
  },
  lightWell: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    right: 9,
    top: 9,
    opacity: 0.74,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    shadowOpacity: 0.9,
  },
  keyShine: {
    position: 'absolute',
    height: 1,
    left: 12,
    right: 12,
    top: 5,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  monogram: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    color: '#182127',
  },
  labelGroup: {
    gap: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.15,
    color: '#131A1E',
  },
  sublabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.65,
    textTransform: 'uppercase',
    color: '#69777E',
  },
});
