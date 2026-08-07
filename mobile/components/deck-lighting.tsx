import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

export type MicLight = 'off' | 'recording' | 'processing';

type DeckLightingProps = {
  /** LED colour for the current agent status. */
  color: string;
  /** Plate radius. Derived from the measured width when left out. */
  radius?: number;
  /** Breathe while the agent is working. */
  pulse?: boolean;
  /** Orbiting light for dictation. */
  mic?: MicLight;
  /** Master brightness, 0 turns the deck lights off. */
  intensity?: number;
};

const PULSE_CYCLE = 2400;
const ORBIT_RECORDING = 1350;
const ORBIT_PROCESSING = 820;

/**
 * Microdex status lighting.
 *
 * The real device is not surrounded by one even neon stroke: most of the light
 * pools through the translucent left wall and lower edge, while a tighter rim
 * remains visible inside the clear plate. Keeping those layers separate is what
 * makes this read as light travelling through plastic instead of a CSS border.
 */
export function DeckLighting({
  color,
  radius,
  pulse = false,
  mic = 'off',
  intensity = 1,
}: DeckLightingProps) {
  const breathe = useRef(new Animated.Value(1)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  // Follow the plate corners, which are a fraction of the body width.
  const corner = radius ?? (width > 0 ? width * 0.08 : 24);

  useEffect(() => {
    if (!pulse || intensity <= 0) {
      breathe.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 0,
          duration: PULSE_CYCLE / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: PULSE_CYCLE / 2,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, intensity, pulse]);

  useEffect(() => {
    if (mic === 'off') {
      orbit.setValue(0);
      return;
    }
    orbit.setValue(0);
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: mic === 'processing' ? ORBIT_PROCESSING : ORBIT_RECORDING,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [mic, orbit]);

  const edgeOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55 * intensity, 0.96 * intensity],
  });
  const spin = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (intensity <= 0) return null;

  return (
    <View
      pointerEvents="none"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.lighting, { borderRadius: corner }]}>
      <Animated.View
        style={[
          styles.edge,
          {
            borderRadius: corner,
            opacity: pulse ? edgeOpacity : 0.72 * intensity,
          },
        ]}>
        <LinearGradient
          colors={[
            withAlpha(color, 0.03),
            withAlpha(color, 0.3),
            withAlpha(color, 0.1),
            withAlpha(color, 0),
          ]}
          locations={[0, 0.3, 0.62, 1]}
          start={{ x: 0, y: 0.42 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.leftLight, { borderRadius: corner }]}
        />
        <LinearGradient
          colors={[withAlpha(color, 0), withAlpha(color, 0.2), withAlpha(color, 0.03)]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.bottomLight, { borderRadius: corner }]}
        />
        <View
          style={[
            styles.outerAura,
            {
              borderRadius: corner + 8,
              borderColor: withAlpha(color, 0.24),
              shadowColor: color,
            },
          ]}
        />
        <View
          style={[
            styles.leftBloom,
            {
              backgroundColor: withAlpha(color, 0.2),
              shadowColor: color,
            },
          ]}
        />
        <View
          style={[
            styles.rim,
            {
              borderRadius: corner,
              borderColor: withAlpha(color, 0.66),
              borderWidth: 1.5,
              shadowColor: color,
            },
          ]}
        />
        <View
          style={[
            styles.innerRim,
            { borderRadius: corner - 2, borderColor: withAlpha(color, 0.32) },
          ]}
        />
        <View
          style={[
            styles.innerWash,
            {
              borderRadius: corner - 4,
              borderColor: withAlpha(color, 0.13),
              shadowColor: color,
            },
          ]}
        />
      </Animated.View>

      {mic !== 'off' ? (
        <View style={[styles.orbitClip, { borderRadius: corner }]}>
          <Animated.View style={[styles.orbit, { transform: [{ rotate: spin }] }]}>
            <LinearGradient
              colors={
                mic === 'processing'
                  ? ['rgba(255,255,255,0)', 'rgba(255,255,255,0.92)', 'rgba(255,255,255,0)']
                  : [withAlpha(LED_MIC, 0), withAlpha(LED_MIC, 0.96), withAlpha(LED_MIC, 0)]
              }
              locations={[0.34, 0.5, 0.66]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const LED_MIC = '#8CFFC0';

function withAlpha(hex: string, alpha: number) {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return hex;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  lighting: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
    zIndex: 0,
  },
  edge: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
  },
  leftLight: {
    position: 'absolute',
    left: -18,
    top: '5%',
    bottom: '4%',
    width: '58%',
  },
  bottomLight: {
    position: 'absolute',
    left: '-4%',
    right: '-2%',
    bottom: -13,
    height: '44%',
  },
  outerAura: {
    position: 'absolute',
    top: -8,
    right: -8,
    bottom: -10,
    left: -13,
    borderWidth: 3,
    shadowOffset: { width: -7, height: 4 },
    shadowOpacity: 0.78,
    shadowRadius: 24,
  },
  leftBloom: {
    position: 'absolute',
    left: -16,
    top: '17%',
    bottom: '12%',
    width: 15,
    borderRadius: 12,
    shadowOffset: { width: -7, height: 0 },
    shadowOpacity: 0.94,
    shadowRadius: 26,
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    shadowOffset: { width: -3, height: 2 },
    shadowOpacity: 0.62,
    shadowRadius: 10,
  },
  innerRim: {
    position: 'absolute',
    top: 5,
    right: 5,
    bottom: 5,
    left: 5,
    borderWidth: 5,
  },
  innerWash: {
    position: 'absolute',
    top: 9,
    right: 9,
    bottom: 9,
    left: 9,
    borderWidth: 10,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.48,
    shadowRadius: 14,
  },
  orbitClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  orbit: {
    position: 'absolute',
    left: '-40%',
    right: '-40%',
    top: '-40%',
    bottom: '-40%',
    opacity: 0.9,
  },
});
