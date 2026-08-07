import { useCallback, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

type Direction = 'up' | 'right' | 'down' | 'left';

const TICKS = Array.from({ length: 7 }, (_, index) => index);
const DIRECTION_THRESHOLD = 0.45;

/** Black rubber navigation joystick used by the Microdex control deck. */
export function Joystick({ onDirection }: { onDirection: (direction: Direction) => void }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const travel = useSharedValue(12);
  const dragging = useSharedValue(false);

  const commitDirection = useCallback((direction: Direction) => {
    onDirection(direction);
  }, [onDirection]);

  const stickStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: dragging.value ? 0.985 : 1 },
    ],
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: dragging.value ? 0.5 : 0.64,
    transform: [
      { translateX: translateX.value * 0.35 },
      { translateY: 6 + translateY.value * 0.35 },
    ],
  }));

  const joystickGesture = useMemo(() => Gesture.Pan()
    .minDistance(2)
    .maxPointers(1)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      'worklet';
      dragging.value = true;
    })
    .onUpdate((event) => {
      'worklet';
      const distance = Math.hypot(event.translationX, event.translationY);
      const scale = distance > travel.value ? travel.value / distance : 1;
      translateX.value = event.translationX * scale;
      translateY.value = event.translationY * scale;
    })
    .onEnd(() => {
      'worklet';
      const x = translateX.value;
      const y = translateY.value;
      if (Math.hypot(x, y) < travel.value * DIRECTION_THRESHOLD) return;
      const direction: Direction = Math.abs(x) > Math.abs(y)
        ? x > 0 ? 'right' : 'left'
        : y > 0 ? 'down' : 'up';
      runOnJS(commitDirection)(direction);
    })
    .onFinalize(() => {
      'worklet';
      dragging.value = false;
      translateX.value = withSpring(0, {
        damping: 15,
        stiffness: 250,
        mass: 0.45,
      });
      translateY.value = withSpring(0, {
        damping: 15,
        stiffness: 250,
        mass: 0.45,
      });
    }), [commitDirection, dragging, translateX, translateY, travel]);

  return (
    <GestureDetector gesture={joystickGesture}>
      <Animated.View
        collapsable={false}
        accessibilityRole="adjustable"
        accessibilityLabel="Codex navigation joystick"
        accessibilityHint="Drag and release in a direction to control Codex."
        accessibilityActions={[
          { name: 'moveUp', label: 'Move joystick up' },
          { name: 'moveRight', label: 'Move joystick right' },
          { name: 'moveDown', label: 'Move joystick down' },
          { name: 'moveLeft', label: 'Move joystick left' },
        ]}
        onAccessibilityAction={(event) => {
          const directions = {
            moveUp: 'up',
            moveRight: 'right',
            moveDown: 'down',
            moveLeft: 'left',
          } as const;
          const direction = directions[event.nativeEvent.actionName as keyof typeof directions];
          if (direction) commitDirection(direction);
        }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          travel.value = Math.min(width, height) * 0.15;
        }}
        style={styles.module}>
        <LinearGradient
          colors={['#F8FBFB', '#BCC7C9', '#EEF2F2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.basePlate}>
          <View style={[styles.tickRail, styles.tickRailTop]}>
            {TICKS.map((tick) => <View key={`t-${tick}`} style={styles.tick} />)}
          </View>
          <View style={[styles.tickRail, styles.tickRailBottom]}>
            {TICKS.map((tick) => <View key={`b-${tick}`} style={styles.tick} />)}
          </View>
          <View style={[styles.tickRailVertical, styles.tickRailLeft]}>
            {TICKS.map((tick) => <View key={`l-${tick}`} style={styles.tickVertical} />)}
          </View>
          <View style={[styles.tickRailVertical, styles.tickRailRight]}>
            {TICKS.map((tick) => <View key={`r-${tick}`} style={styles.tickVertical} />)}
          </View>
        </LinearGradient>
        <View style={styles.baseRing} />
        <Animated.View style={[styles.stickShadow, shadowStyle]} />
        <Animated.View style={[styles.stickMotion, stickStyle]}>
          <LinearGradient
            colors={['#343839', '#141617', '#030404', '#000000']}
            locations={[0, 0.35, 0.75, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.stick}>
            <View style={styles.grip}>
              <View style={[styles.gripLine, styles.gripLineA]} />
              <View style={[styles.gripLine, styles.gripLineB]} />
            </View>
            <View style={styles.topGlint} />
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  module: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  basePlate: {
    position: 'absolute',
    inset: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8E999B',
    shadowColor: '#2C3739',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.36,
    shadowRadius: 7,
    overflow: 'hidden',
  },
  tickRail: {
    position: 'absolute',
    left: '7%',
    right: '7%',
    height: '5.5%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tickRailTop: { top: 0 },
  tickRailBottom: { bottom: 0 },
  tickRailVertical: {
    position: 'absolute',
    top: '7%',
    bottom: '7%',
    width: '5.5%',
    justifyContent: 'space-between',
  },
  tickRailLeft: { left: 0 },
  tickRailRight: { right: 0 },
  tick: { width: '7%', height: '100%', backgroundColor: '#131617' },
  tickVertical: { width: '100%', height: '7%', backgroundColor: '#131617' },
  baseRing: {
    position: 'absolute',
    width: '88%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#606B6D',
    backgroundColor: '#0C0E0F',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.65,
    shadowRadius: 5,
  },
  stickShadow: {
    position: 'absolute',
    width: '72%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: '#000000',
  },
  stickMotion: {
    width: '70%',
    aspectRatio: 1,
    borderRadius: 999,
    zIndex: 3,
  },
  stick: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 9,
    shadowOpacity: 0.72,
    elevation: 8,
  },
  grip: { position: 'absolute', inset: '19%', opacity: 0.78 },
  gripLine: {
    position: 'absolute',
    left: '4%',
    right: '4%',
    top: '46%',
    height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  gripLineA: { transform: [{ rotate: '45deg' }] },
  gripLineB: { transform: [{ rotate: '-45deg' }] },
  topGlint: {
    position: 'absolute',
    top: '12%',
    left: '22%',
    width: '36%',
    height: '14%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    transform: [{ rotate: '-18deg' }],
  },
});
