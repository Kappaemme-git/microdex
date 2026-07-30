import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

type Direction = 'up' | 'right' | 'down' | 'left';

const TICKS = Array.from({ length: 7 }, (_, index) => index);

/** Black rubber navigation joystick — Codex Micro top-right stick. */
export function Joystick({ onDirection }: { onDirection: (direction: Direction) => void }) {
  return (
    <View style={styles.module}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Joystick up"
        onPress={() => onDirection('up')}
        style={[styles.hitArea, styles.up]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Joystick right"
        onPress={() => onDirection('right')}
        style={[styles.hitArea, styles.right]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Joystick down"
        onPress={() => onDirection('down')}
        style={[styles.hitArea, styles.down]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Joystick left"
        onPress={() => onDirection('left')}
        style={[styles.hitArea, styles.left]}
      />

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
      <View style={styles.stickShadow} />
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
    </View>
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
  hitArea: { position: 'absolute', zIndex: 4 },
  up: { top: 0, left: '25%', width: '50%', height: '42%' },
  right: { right: 0, top: '25%', width: '42%', height: '50%' },
  down: { bottom: 0, left: '25%', width: '50%', height: '42%' },
  left: { left: 0, top: '25%', width: '42%', height: '50%' },
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
    opacity: 0.64,
    backgroundColor: '#000000',
    transform: [{ translateY: 6 }],
  },
  stick: {
    width: '70%',
    aspectRatio: 1,
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
    zIndex: 3,
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
