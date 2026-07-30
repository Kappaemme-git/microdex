import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useSkeuo } from '@/components/skeuo';

/** Total travel of the cap, matching the printed arc on the hardware. */
const SWEEP_DEGREES = 260;
const START_DEGREES = -130;
/**
 * Finger travel for one full level. With four levels the whole range is a short
 * swipe, so this is deliberately generous: at 30px the dial crossed two levels
 * on a twitch and felt nervous.
 */
const PIXELS_PER_STEP = 46;
/** Finger travel for one encoder notch, and notches in a full turn of the cap. */
const PIXELS_PER_DETENT = 22;
const DETENTS_PER_TURN = 11;
/** How long notches are collected before one batched request goes out. */
const ENCODER_FLUSH_MS = 55;

function angleForPosition(position: number, maxIndex: number) {
  'worklet';
  const span = Math.max(maxIndex, 1);
  return START_DEGREES + (SWEEP_DEGREES * position) / span;
}

type ReasoningDialProps = {
  mode: 'reasoning' | 'composer-navigation' | 'conversation-scroll';
  label: string;
  index: number;
  maxIndex: number;
  onPreview: (index: number) => void;
  onCommit: (index: number) => void;
  /** `steps` is how many notches were crossed since the last call. */
  onStep: (delta: -1 | 1, steps: number) => void;
  onPress: () => void;
  onLongPress: () => void;
};

/** Machined aluminium encoder — Codex Micro top-left dial. */
export function ReasoningDial({
  mode,
  label,
  index,
  maxIndex,
  onPreview,
  onCommit,
  onStep,
  onPress,
  onLongPress,
}: ReasoningDialProps) {
  const skeuo = useSkeuo();
  const lastIndex = useRef(index);
  const currentIndex = useRef(index);
  const panCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const encoderFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSteps = useRef(0);
  currentIndex.current = index;

  // Continuous cap angle, written by the gesture on the UI thread so the dial
  // tracks the finger every frame instead of stepping when React re-renders.
  const angle = useSharedValue(angleForPosition(index, maxIndex));
  // Fractional position held while dragging, so a slow drag moves smoothly
  // between levels rather than snapping at each threshold.
  const dragPosition = useSharedValue(index);
  const dragging = useSharedValue(false);
  const startPosition = useSharedValue(index);
  const lastPreviewed = useSharedValue(index);

  const capStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }],
  }));

  // Follows the value the parent settled on, including a level the bridge had to
  // clamp, so the cap animates back instead of lying about where it is. Only the
  // reasoning dial has a resting position: an encoder keeps whatever angle the
  // last spin left it at.
  useEffect(() => {
    if (mode !== 'reasoning' || dragging.value) return;
    startPosition.value = index;
    lastPreviewed.value = index;
    dragPosition.value = index;
    angle.value = withSpring(angleForPosition(index, maxIndex), {
      damping: 18,
      stiffness: 190,
      mass: 0.5,
    });
  }, [
    angle,
    dragPosition,
    dragging,
    index,
    lastPreviewed,
    maxIndex,
    mode,
    startPosition,
  ]);

  useEffect(() => () => {
    if (panCommitTimer.current) clearTimeout(panCommitTimer.current);
    if (encoderFlushTimer.current) clearTimeout(encoderFlushTimer.current);
  }, []);

  const preview = useCallback((nextIndex: number) => {
    const bounded = Math.min(maxIndex, Math.max(0, nextIndex));
    if (lastIndex.current === bounded) return bounded;
    lastIndex.current = bounded;
    onPreview(bounded);
    return bounded;
  }, [maxIndex, onPreview]);

  /**
   * Collects notches crossed during a spin. One request per notch meant each had
   * to wait for the previous round trip, so the desktop trailed the finger by
   * the depth of the queue.
   */
  const emitEncoderSteps = useCallback((crossed: number) => {
    if (!crossed) return;
    pendingSteps.current += crossed;
    void Haptics.selectionAsync();
    if (encoderFlushTimer.current) return;
    encoderFlushTimer.current = setTimeout(() => {
      encoderFlushTimer.current = null;
      const pending = pendingSteps.current;
      pendingSteps.current = 0;
      if (pending) onStep(pending > 0 ? 1 : -1, Math.abs(pending));
    }, ENCODER_FLUSH_MS);
  }, [onStep]);

  const flushEncoderSteps = useCallback(() => {
    if (encoderFlushTimer.current) {
      clearTimeout(encoderFlushTimer.current);
      encoderFlushTimer.current = null;
    }
    const pending = pendingSteps.current;
    pendingSteps.current = 0;
    if (pending) onStep(pending > 0 ? 1 : -1, Math.abs(pending));
  }, [onStep]);

  /**
   * Sends the level the drag landed on, debounced so a flick that crosses
   * several levels produces one request instead of one per level.
   *
   * It must not skip when the settled level equals `index`: the preview already
   * moved `index` while dragging, so comparing against it made every drag look
   * like a no-op and nothing ever reached Codex. Deduplication belongs to the
   * parent, which knows the level Codex actually holds.
   */
  const commitDragged = useCallback((settledIndex: number) => {
    if (panCommitTimer.current) clearTimeout(panCommitTimer.current);
    panCommitTimer.current = setTimeout(() => {
      panCommitTimer.current = null;
      onCommit(settledIndex);
    }, 90);
  }, [onCommit]);

  const dialGesture = useMemo(() => {
    const isReasoning = mode === 'reasoning';

    // Both gestures are worklets, so the cap never waits on React or on the
    // network. They differ in what they do: the reasoning dial has end stops and
    // commits a level, the encoder spins freely and emits notches.
    const reasoningPan = Gesture.Pan()
      .minDistance(2)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onBegin(() => {
        'worklet';
        dragging.value = true;
        dragPosition.value = startPosition.value;
      })
      .onUpdate((gesture) => {
        'worklet';
        const dominantDistance =
          Math.abs(gesture.translationY) >= Math.abs(gesture.translationX)
            ? -gesture.translationY
            : gesture.translationX;
        const raw = startPosition.value + dominantDistance / PIXELS_PER_STEP;
        // Rubber-banded ends: the cap resists past the last level instead of
        // stopping dead, which is what makes a slider feel physical.
        const clamped = Math.min(maxIndex, Math.max(0, raw));
        const overshoot = raw - clamped;
        dragPosition.value = clamped;
        angle.value = angleForPosition(clamped + overshoot * 0.12, maxIndex);
        const next = Math.round(clamped);
        if (next !== lastPreviewed.value) {
          lastPreviewed.value = next;
          runOnJS(preview)(next);
        }
      })
      .onFinalize(() => {
        'worklet';
        dragging.value = false;
        const settled = Math.round(dragPosition.value);
        startPosition.value = settled;
        // Settle onto the detent, then let the parent confirm or correct it.
        angle.value = withTiming(angleForPosition(settled, maxIndex), { duration: 140 });
        runOnJS(commitDragged)(settled);
      });

    // Also a worklet: the cap has to keep up with the finger even while the
    // bridge is still working through the notches already sent.
    const encoderPan = Gesture.Pan()
      .minDistance(2)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onBegin(() => {
        'worklet';
        dragging.value = true;
        startPosition.value = 0;
        lastPreviewed.value = 0;
        dragPosition.value = 0;
      })
      .onUpdate((gesture) => {
        'worklet';
        const dominantDistance =
          Math.abs(gesture.translationY) >= Math.abs(gesture.translationX)
            ? -gesture.translationY
            : gesture.translationX;
        const raw = dominantDistance / PIXELS_PER_DETENT;
        dragPosition.value = raw;
        // Free rotation, no end stops: an encoder spins.
        angle.value = angleForPosition(raw, DETENTS_PER_TURN);
        const notch = Math.round(raw);
        if (notch !== lastPreviewed.value) {
          const crossed = notch - lastPreviewed.value;
          lastPreviewed.value = notch;
          runOnJS(emitEncoderSteps)(crossed);
        }
      })
      .onFinalize(() => {
        'worklet';
        dragging.value = false;
        runOnJS(flushEncoderSteps)();
      });

    const pan = isReasoning ? reasoningPan : encoderPan;

    const tap = Gesture.Tap()
      .maxDuration(480)
      .maxDistance(8)
      .runOnJS(true)
      .onBegin(() => {
        lastIndex.current = currentIndex.current;
      })
      .onEnd((_event, success) => {
        if (!success) return;
        if (mode !== 'reasoning') {
          onPress();
          return;
        }
        const next = currentIndex.current < maxIndex ? currentIndex.current + 1 : 0;
        const bounded = preview(next);
        onCommit(bounded);
      });

    const longPress = Gesture.LongPress()
      .minDuration(500)
      .maxDistance(12)
      .runOnJS(true)
      .onStart(() => onLongPress());

    return Gesture.Simultaneous(
      pan,
      Gesture.Exclusive(longPress, tap),
    );
  }, [
    angle,
    commitDragged,
    dragPosition,
    dragging,
    lastPreviewed,
    maxIndex,
    mode,
    emitEncoderSteps,
    flushEncoderSteps,
    onCommit,
    onLongPress,
    onPress,
    preview,
    startPosition,
  ]);

  const accessibilityLabel = mode === 'reasoning'
    ? `Reasoning ${label}`
    : mode === 'composer-navigation'
      ? 'Composer navigation'
      : 'Conversation scroll';
  const accessibilityHint = mode === 'reasoning'
    ? 'Slide up or right to increase. Slide down or left to decrease. Tap to cycle, hold for settings.'
    : 'Rotate to move, tap to select, or hold for settings.';

  return (
    <GestureDetector gesture={dialGesture}>
      <View
        collapsable={false}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityValue={
          mode === 'reasoning'
            ? { min: 0, max: maxIndex, now: index, text: label }
            : { text: label }
        }
        accessibilityActions={[
          { name: 'increment', label: 'Increase reasoning effort' },
          { name: 'decrement', label: 'Decrease reasoning effort' },
        ]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment'
            ? 1
            : event.nativeEvent.actionName === 'decrement'
              ? -1
              : 0;
          if (!delta) return;
          if (mode === 'reasoning') {
            const bounded = preview(index + delta);
            onCommit(bounded);
          } else {
            onStep(delta, 1);
          }
        }}
        style={styles.module}>
        <View style={styles.shadow} />
        <LinearGradient
          colors={['#FEFFFF', '#AEB9BB', '#F9FBFB', '#8E999B', '#EEF2F2']}
          locations={[0, 0.24, 0.48, 0.72, 1]}
          start={{ x: 0.08, y: 0.06 }}
          end={{ x: 0.94, y: 0.95 }}
          style={styles.dialRing}>
          {/* The rotation lives on this wrapper so the gesture can drive it from
              the UI thread, without waiting for a React render. */}
          <Animated.View style={[styles.dialCapWrapper, capStyle]}>
            <LinearGradient
              colors={['#FAFCFC', '#B8C2C4', '#FFFFFF', '#929EA0', '#E9EEEE']}
              locations={[0, 0.25, 0.49, 0.74, 1]}
              start={{ x: 0.04, y: 0.08 }}
              end={{ x: 0.94, y: 0.92 }}
              style={styles.dialCap}>
              <LinearGradient
                colors={['#819092', '#DFE5E6', '#FBFCFC', '#9AA5A7']}
                locations={[0, 0.43, 0.6, 1]}
                style={styles.groove}
              />
              <View style={styles.capGlint} />
            </LinearGradient>
          </Animated.View>
        </LinearGradient>
        <Text pointerEvents="none" style={[styles.valueLabel, { color: skeuo.label }]}>
          {label.toUpperCase()}
        </Text>
      </View>
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
  shadow: {
    position: 'absolute',
    width: '82%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: '#000000',
    opacity: 0.27,
    transform: [{ translateY: 8 }],
  },
  dialRing: {
    width: '90%',
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#889496',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 8,
    shadowOpacity: 0.36,
    elevation: 8,
  },
  dialCapWrapper: {
    width: '91%',
    aspectRatio: 1,
    borderRadius: 999,
  },
  dialCap: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'stretch',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#435052',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.36,
    shadowRadius: 3,
  },
  groove: {
    position: 'absolute',
    left: '12%',
    right: '12%',
    top: '42%',
    height: '18%',
    borderRadius: 999,
    transform: [{ rotate: '-46deg' }],
    shadowColor: '#313B3D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  capGlint: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    top: '8%',
    height: '16%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  valueLabel: {
    position: 'absolute',
    bottom: -4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    fontSize: 5.2,
    fontWeight: '900',
    letterSpacing: 0.35,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
});
