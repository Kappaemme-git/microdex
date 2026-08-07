import { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { MicrodexIcon, type MicrodexIconName } from '@/components/microdex-icon';
import { RaisedCap, useSkeuo } from '@/components/skeuo';

type HardwareKeyProps = {
  accessibilityLabel: string;
  icon?: MicrodexIconName;
  symbol?: ReactNode;
  caption?: string;
  /** `rgb` = translucent task key with bloom. `command` = solid white icon key. */
  variant?: 'command' | 'rgb';
  /** Override bloom color (Agent Key status). Defaults to Codex blue. */
  glowColor?: string;
  /** Stronger bloom / selected agent key. */
  selected?: boolean;
  /** A restrained inner latch ring, used by hardware toggles such as Fast. */
  latchedColor?: string;
  active?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  /** 0–1 offset in the backlight cycle, so lit keys ripple instead of blinking together. */
  phase?: number;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onDoublePress?: () => void;
  onLongPress?: () => void;
};

const GLOW_CYCLE = 2000;

export function HardwareKey({
  accessibilityLabel,
  icon,
  symbol,
  caption,
  variant = 'command',
  glowColor,
  selected = false,
  latchedColor,
  active = false,
  disabled = false,
  unavailableReason,
  phase = 0,
  onPress,
  onPressIn,
  onPressOut,
  onDoublePress,
  onLongPress,
}: HardwareKeyProps) {
  const skeuo = useSkeuo();
  const dark = skeuo.plate === '#1A1A18';
  const rgb = variant === 'rgb';
  // RGB keys keep their translucent physical cap, but emit no colour at rest.
  // A bloom exists only while an actual status/action light is active.
  const bloom = active || selected || glowColor != null;
  // A key carrying a status colour reads as a lit LED, not just tinted plastic.
  const lit = active || selected || glowColor != null;
  const glow = glowColor ?? skeuo.rgb;
  const iconColor = skeuo.icon;
  const emptySymbol = symbol === null;
  const backlight = useRef(new Animated.Value(1)).current;
  const lastReleaseAt = useRef(0);
  const doublePress = useRef(false);
  const hasPressLifecycle = Boolean(onPressIn || onPressOut || onDoublePress);

  // Only the selected key breathes; the other zones hold a steady light, so the
  // deck reads as several independent LEDs instead of one blinking wave.
  useEffect(() => {
    if (!selected || disabled) {
      backlight.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(backlight, {
          toValue: 0,
          duration: GLOW_CYCLE / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(backlight, {
          toValue: 1,
          duration: GLOW_CYCLE / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const start = setTimeout(() => loop.start(), (phase % 1) * GLOW_CYCLE);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [backlight, disabled, phase, selected]);

  const backlightOpacity = backlight.interpolate({
    inputRange: [0, 1],
    outputRange: [0.52, 1],
  });

  const handlePressIn = () => {
    const now = Date.now();
    const isDoublePress = Boolean(
      onDoublePress && lastReleaseAt.current && now - lastReleaseAt.current <= 350,
    );
    doublePress.current = isDoublePress;
    if (isDoublePress) onDoublePress?.();
    else onPressIn?.();
  };

  const handlePressOut = () => {
    if (!doublePress.current) onPressOut?.();
    lastReleaseAt.current = Date.now();
  };

  const handlePress = () => {
    if (!hasPressLifecycle) onPress?.();
    doublePress.current = false;
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={unavailableReason}
      accessibilityState={{ selected: active || selected, disabled }}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={hasPressLifecycle ? handlePressIn : undefined}
      onPressOut={hasPressLifecycle ? handlePressOut : undefined}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.shell,
        lit && {
          shadowColor: glow,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: selected ? 0.7 : 0.5,
          shadowRadius: selected ? 14 : 10,
        },
        disabled && styles.disabled,
        unavailableReason && styles.unavailable,
        pressed && styles.pressed,
        selected && styles.selectedShell,
      ]}>
      <RaisedCap style={styles.cap} radius={15} rgb={bloom}>
        {latchedColor ? (
          <View
            pointerEvents="none"
            style={[
              styles.latchRing,
              {
                borderColor: latchedColor,
                shadowColor: latchedColor,
              },
            ]}
          />
        ) : null}
        {bloom ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.fillGlow,
              {
                backgroundColor: withAlpha(glow, lit ? (selected ? 0.34 : 0.26) : 0.1),
                opacity: backlightOpacity,
              },
            ]}
          />
        ) : null}

        <View
          pointerEvents="none"
          style={[
            styles.dish,
            dark && styles.dishDark,
            bloom && { backgroundColor: withAlpha(glow, lit ? 0.3 : dark ? 0.14 : 0.1) },
          ]}>
          {bloom ? (
            <Animated.View style={[styles.bloomStack, { opacity: backlightOpacity }]}>
              <View
                style={[
                  styles.bloomOuter,
                  {
                    backgroundColor: withAlpha(glow, lit ? 0.4 : 0.22),
                    shadowColor: glow,
                    shadowOpacity: selected ? 0.45 : lit ? 0.4 : 0.28,
                    shadowRadius: selected ? 14 : lit ? 13 : 10,
                  },
                ]}
              />
              <View
                style={[
                  styles.bloomCore,
                  {
                    backgroundColor: withAlpha(glow, selected ? 0.8 : lit ? 0.7 : 0.4),
                    shadowColor: glow,
                  },
                ]}
              />
            </Animated.View>
          ) : (
            <View style={[styles.dishCore, dark && styles.dishCoreDark]} />
          )}
        </View>

        {!emptySymbol ? (
          <View style={[styles.symbol, caption ? styles.symbolWithCaption : null]}>
            {symbol ?? (
              <MicrodexIcon
                name={icon ?? 'circle-outline'}
                size={caption ? 17 : rgb ? 20 : 22}
                color={iconColor}
              />
            )}
            {caption ? (
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.58}
                numberOfLines={1}
                style={[styles.caption, { color: skeuo.icon }]}>
                {caption}
              </Text>
            ) : null}
          </View>
        ) : null}
      </RaisedCap>
    </Pressable>
  );
}

function withAlpha(hex: string, alpha: number) {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    height: '100%',
    padding: 1.5,
  },
  selectedShell: {
    transform: [{ scale: 1.03 }],
  },
  cap: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  latchRing: {
    position: 'absolute',
    zIndex: 4,
    top: 4,
    right: 4,
    bottom: 4,
    left: 4,
    borderWidth: 1,
    borderRadius: 11,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.72,
    shadowRadius: 8,
  },
  fillGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  dish: {
    position: 'absolute',
    width: '74%',
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(210,220,226,0.28)',
    borderWidth: 1,
    borderTopColor: 'rgba(150,165,175,0.3)',
    borderLeftColor: 'rgba(150,165,175,0.18)',
    borderRightColor: 'rgba(255,255,255,0.8)',
    borderBottomColor: 'rgba(255,255,255,0.92)',
  },
  dishDark: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderLeftColor: 'rgba(255,255,255,0.05)',
    borderRightColor: 'rgba(0,0,0,0.4)',
    borderBottomColor: 'rgba(0,0,0,0.5)',
  },
  dishCore: {
    width: '52%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dishCoreDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bloomStack: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloomOuter: {
    position: 'absolute',
    width: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 0 },
  },
  bloomCore: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 999,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    shadowOpacity: 1,
  },
  symbol: {
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolWithCaption: {
    alignSelf: 'stretch',
    gap: 2,
    paddingHorizontal: 2,
  },
  caption: {
    width: '100%',
    fontSize: 6.5,
    fontWeight: '900',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  pressed: {
    transform: [{ translateY: 2 }, { scale: 0.97 }],
  },
  disabled: { opacity: 0.45 },
  unavailable: { opacity: 0.62 },
});
