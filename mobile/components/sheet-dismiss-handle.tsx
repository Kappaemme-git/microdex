import { ReactNode, useCallback, useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type DismissibleSheetProps = {
  onDismiss: () => void;
  /** Remount / reopen signal so enter animation always starts clean. */
  open?: boolean;
  /** Top grab zone (handle pill + title). Pan starts here so ScrollViews below stay usable. */
  header: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  dismissDistance?: number;
};

/**
 * Bottom sheet that tracks the finger on the header and dismisses fluidly.
 * Parent Modal should use animationType="fade" (not "slide") to avoid double-animation jank.
 */
export function DismissibleSheet({
  onDismiss,
  open = true,
  header,
  children,
  style,
  dismissDistance = 96,
}: DismissibleSheetProps) {
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useSharedValue(screenHeight * 0.18);
  const dragStartY = useSharedValue(0);
  const closing = useSharedValue(false);
  const dismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    closing.value = false;
    translateY.value = screenHeight * 0.18;
    translateY.value = withTiming(0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [closing, open, screenHeight, translateY]);

  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-36, 36])
    .onBegin(() => {
      if (closing.value) return;
      dragStartY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (closing.value) return;
      // Follow the finger down; light rubber-band if pulled up.
      const next = dragStartY.value + event.translationY;
      translateY.value = next > 0 ? next : next * 0.08;
    })
    .onEnd((event) => {
      if (closing.value) return;
      const shouldClose =
        translateY.value > dismissDistance || event.velocityY > 750;
      if (shouldClose) {
        closing.value = true;
        const distance = Math.max(160, screenHeight - translateY.value);
        const velocity = Math.max(event.velocityY, 900);
        const duration = Math.max(140, Math.min(260, (distance / velocity) * 1000));
        translateY.value = withTiming(
          screenHeight,
          { duration, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (!finished) {
              closing.value = false;
              return;
            }
            runOnJS(dismiss)();
          },
        );
        return;
      }
      translateY.value = withSpring(0, {
        damping: 28,
        stiffness: 420,
        mass: 0.5,
        velocity: event.velocityY / 900,
      });
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[style, sheetStyle]}>
      <GestureDetector gesture={pan}>
        <Animated.View collapsable={false} style={styles.headerHit}>
          {header}
        </Animated.View>
      </GestureDetector>
      {children}
    </Animated.View>
  );
}

/** @deprecated Prefer DismissibleSheet */
export function SheetDismissHandle({
  onDismiss,
  children,
  style,
  dismissDistance = 96,
}: {
  onDismiss: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  dismissDistance?: number;
}) {
  return (
    <DismissibleSheet
      onDismiss={onDismiss}
      header={children}
      style={style}
      dismissDistance={dismissDistance}
    />
  );
}

export function SheetHandlePill({ color }: { color: string }) {
  return <View style={[styles.pill, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  headerHit: {
    paddingTop: 6,
    paddingBottom: 8,
    minHeight: 72,
  },
  pill: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 12,
  },
});
