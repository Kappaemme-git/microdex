import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useMemo, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import type { ThemePalette } from '@/lib/theme';
import { useTheme } from '@/lib/theme';

/**
 * Codex Micro material tokens — frosted frame, PBT/PC keycaps, soft RGB bloom.
 * Light = paper white. Dark = near-black polycarbonate.
 */

export type SkeuoTokens = {
  frameTop: string;
  frameBottom: string;
  frameGlow: string;
  plate: string;
  plateEdge: string;
  keyTop: string;
  keyMid: string;
  keyBottom: string;
  keyBorder: string;
  keyShadow: string;
  rgb: string;
  rgbBloom: string;
  rgbCap: string;
  dial: string;
  dialRim: string;
  screw: string;
  screwSlot: string;
  icon: string;
  iconMuted: string;
  label: string;
  black: string;
  accent: string;
  stickTop: string;
  stickMid: string;
  stickBottom: string;
  stickTip: string;
  stickRim: string;
};

export function getSkeuo(theme: ThemePalette): SkeuoTokens {
  // The hardware keeps the real Micro's white polycarbonate palette even when
  // the surrounding app stage and sheets use dark mode.
  const dark = false;
  return {
    frameTop: dark ? 'rgba(36,36,34,0.96)' : 'rgba(252,252,251,0.96)',
    frameBottom: dark ? 'rgba(18,18,16,0.96)' : 'rgba(242,242,240,0.94)',
    frameGlow: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    plate: dark ? '#1A1A18' : '#F7F7F5',
    plateEdge: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.98)',

    keyTop: dark ? '#2C2C2A' : '#FFFFFF',
    keyMid: dark ? '#222220' : '#F6F6F4',
    keyBottom: dark ? '#181816' : '#ECECE9',
    keyBorder: dark ? 'rgba(255,255,255,0.08)' : '#E0E0DC',
    keyShadow: dark ? '#000000' : '#9A9A94',

    rgb: theme.rgb,
    rgbBloom: theme.rgbSoft,
    rgbCap: theme.rgbCap,

    dial: '#0A0A09',
    dialRim: '#000000',
    screw: dark ? '#0A0A09' : '#1A1A18',
    screwSlot: '#000000',

    icon: '#090A0A',
    iconMuted: '#3D4547',
    label: '#6D7373',
    black: '#000000',
    accent: theme.online,

    stickTop: '#343839',
    stickMid: '#141617',
    stickBottom: '#030404',
    stickTip: '#000000',
    stickRim: 'rgba(255,255,255,0.1)',
  };
}

/** @deprecated Prefer useSkeuo() — light-mode snapshot for static StyleSheets. */
export const SKEUO = getSkeuo({
  mode: 'light',
  bg: '#F7F7F5',
  ambientA: '',
  ambientB: '',
  surface: '',
  surfaceMuted: '',
  surfaceInput: '',
  surfaceInputBorder: '',
  deviceBaseGlow: '',
  deviceBody: '',
  deviceBorder: '',
  deviceLabel: '#8E8E8B',
  screw: '',
  screwBorder: '',
  keyFace: '',
  keyFaceTop: '',
  keyBorder: '',
  keyShadow: '',
  keyGlint: '',
  keyIcon: '#1A1A18',
  keyCaption: '',
  rgb: '#10A37F',
  rgbSoft: 'rgba(16,163,127,0.35)',
  rgbCap: 'rgba(232,247,242,0.95)',
  hardware: '',
  hardwareBorder: '',
  hardwareGroove: '',
  text: '',
  textMuted: '',
  textFaint: '',
  border: '',
  borderStrong: '',
  divider: '',
  accent: '',
  accentText: '',
  accentSoft: '',
  accentSoftBorder: '',
  blue: '',
  online: '#10A37F',
  syncing: '',
  danger: '',
  dangerText: '',
  dangerSurface: '',
  scrim: '',
  drawerScrim: '',
  invSurface: '',
  invText: '',
  invTextMuted: '',
} as ThemePalette);

export function useSkeuo() {
  const { theme } = useTheme();
  return useMemo(() => getSkeuo(theme), [theme]);
}

type ShellProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
};

/**
 * Frosted polycarbonate body + top plate.
 *
 * Every radius and inset is a fraction of the measured width, the way a moulded
 * object scales: the corners, the bezel rings and the clear plate keep the same
 * proportions on any screen instead of drifting apart at fixed pixel sizes.
 */
export function RaisedShell({
  children,
  style,
  contentStyle,
  radius = 34,
}: ShellProps) {
  const skeuo = useSkeuo();
  const dark = skeuo.plate === '#1A1A18';
  const [width, setWidth] = useState(0);
  const g = useMemo(() => shellGeometry(width, radius), [radius, width]);

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.frameLift,
        {
          borderRadius: g.body,
          shadowColor: skeuo.black,
          shadowOffset: { width: 0, height: g.shadowDrop },
          shadowRadius: g.shadowSpread,
          shadowOpacity: dark ? 0.7 : 0.34,
        },
        style,
      ]}>
      {/* Two soft rings read as the light catching the moulded lip of the body. */}
      <View
        pointerEvents="none"
        style={[
          styles.lip,
          {
            top: -g.lipOuter,
            right: -g.lipOuter,
            bottom: -g.lipOuter,
            left: -g.lipOuter,
            borderRadius: g.body + g.lipOuter,
            backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.62)',
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.lip,
          {
            top: -g.lipInner,
            right: -g.lipInner,
            bottom: -g.lipInner,
            left: -g.lipInner,
            borderRadius: g.body + g.lipInner,
            backgroundColor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(237,242,243,0.42)',
          },
        ]}
      />

      <LinearGradient
        colors={
          dark
            ? [skeuo.frameTop, skeuo.frameBottom, skeuo.frameTop]
            : ['rgba(255,255,255,0.99)', 'rgba(220,227,229,0.9)', 'rgba(255,255,255,0.98)']
        }
        locations={[0, 0.47, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={[
          styles.frame,
          {
            padding: g.plateInset,
            borderRadius: g.body,
            borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.9)',
          },
        ]}>
        {/* Bezel step 1 — the seam where the shell meets the inner tray. */}
        <View
          pointerEvents="none"
          style={[
            styles.bezel,
            {
              top: g.bezelA,
              right: g.bezelA,
              bottom: g.bezelA,
              left: g.bezelA,
              borderRadius: Math.max(g.body - g.bezelA, 2),
              borderColor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(111,126,129,0.34)',
            },
          ]}
        />
        {/* Bezel step 2 — the recessed tray the clear plate sits in. */}
        <View
          pointerEvents="none"
          style={[
            styles.bezel,
            {
              top: g.bezelB,
              right: g.bezelB,
              bottom: g.bezelB,
              left: g.bezelB,
              borderRadius: Math.max(g.body - g.bezelB, 2),
              borderColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(96,108,109,0.26)',
              backgroundColor: dark ? 'rgba(0,0,0,0.16)' : 'rgba(213,221,222,0.25)',
            },
          ]}
        />

        <View
          style={[
            styles.plate,
            {
              borderRadius: Math.max(g.body - g.plateInset, 2),
              backgroundColor: skeuo.plate,
              borderColor: skeuo.plateEdge,
              shadowColor: dark ? '#000000' : '#9BB0BC',
              shadowOpacity: dark ? 0.55 : 0.35,
            },
            contentStyle,
          ]}>
          <LinearGradient
            pointerEvents="none"
            colors={
              dark
                ? ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']
                : ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']
            }
            style={styles.plateSheen}
          />
          {children}
        </View>
      </LinearGradient>
    </View>
  );
}

/** Body proportions, expressed as fractions of the measured width. */
function shellGeometry(width: number, fallbackRadius: number) {
  if (width <= 0) {
    return {
      body: fallbackRadius,
      plateInset: 7,
      bezelA: 2.5,
      bezelB: 5,
      lipInner: 4,
      lipOuter: 6,
      shadowDrop: 14,
      shadowSpread: 22,
    };
  }
  return {
    body: width * 0.125,
    plateInset: width * 0.055,
    bezelA: width * 0.02,
    bezelB: width * 0.042,
    lipInner: width * 0.011,
    lipOuter: width * 0.019,
    shadowDrop: width * 0.05,
    shadowSpread: width * 0.11,
  };
}

/**
 * Pool of light the device sits in, so it reads as an object on a surface
 * instead of a card pasted onto the background.
 */
export function ShellPool({ style }: { style?: StyleProp<ViewStyle> }) {
  const dark = useSkeuo().plate === '#1A1A18';

  return (
    <View pointerEvents="none" style={[styles.pool, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="shellPool" cx="50%" cy="42%" r="62%">
            <Stop
              offset="0"
              stopColor={dark ? '#FFFFFF' : '#8898A4'}
              stopOpacity={dark ? 0.09 : 0.22}
            />
            <Stop
              offset="0.55"
              stopColor={dark ? '#FFFFFF' : '#8898A4'}
              stopOpacity={dark ? 0.03 : 0.08}
            />
            <Stop offset="1" stopColor={dark ? '#FFFFFF' : '#8898A4'} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shellPool)" />
      </Svg>
    </View>
  );
}

/**
 * Machined steel screw: an off-centre highlight sells the round head, and the
 * hex socket is what your eye actually recognises as a screw.
 */
export function Screw({ size = 12, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const dark = useSkeuo().plate === '#1A1A18';
  const half = size / 2;
  const socket = size * 0.29;

  return (
    <View
      style={[
        styles.screw,
        {
          width: size,
          height: size,
          borderRadius: half,
          shadowOpacity: dark ? 0.7 : 0.45,
        },
        style,
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="screwHead" cx="38%" cy="30%" r="78%">
            <Stop offset="0" stopColor="#5A5F60" />
            <Stop offset="0.48" stopColor="#272B2C" />
            <Stop offset="1" stopColor="#080909" />
          </RadialGradient>
        </Defs>
        <Circle cx={half} cy={half} r={half - 0.5} fill="url(#screwHead)" />
        <Polygon
          points={hexPoints(half, socket)}
          fill="#050606"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={0.4}
        />
      </Svg>
    </View>
  );
}

function hexPoints(center: number, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 6;
    return `${center + radius * Math.cos(angle)},${center + radius * Math.sin(angle)}`;
  }).join(' ');
}

/** Recessed key well in the top plate. */
export function InsetWell({
  children,
  style,
  radius = 14,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}) {
  return (
    <View style={[styles.well, { borderRadius: radius }, style]}>
      <View style={styles.wellContent}>{children}</View>
    </View>
  );
}

/** Raised keycap (PBT / PC). */
export function RaisedCap({
  children,
  style,
  radius = 13,
  rgb = false,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  rgb?: boolean;
}) {
  const skeuo = useSkeuo();
  const dark = skeuo.plate === '#1A1A18';

  return (
    <View
      style={[
        styles.capLift,
        {
          borderRadius: radius,
          shadowColor: rgb ? skeuo.rgb : skeuo.keyShadow,
        },
        rgb && styles.capLiftRgb,
        style,
      ]}>
      <LinearGradient
        colors={
          rgb
            ? dark
              ? ['rgba(44,52,48,0.98)', 'rgba(30,38,34,0.96)', 'rgba(22,28,26,0.94)']
              : ['rgba(255,255,255,0.96)', 'rgba(244,248,252,0.94)', 'rgba(228,236,244,0.9)']
            : [skeuo.keyTop, skeuo.keyMid, skeuo.keyBottom]
        }
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.cap,
          {
            borderRadius: radius,
            borderTopColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.98)',
            borderLeftColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)',
            borderRightColor: dark ? 'rgba(0,0,0,0.45)' : 'rgba(180,195,205,0.55)',
            borderBottomColor: dark ? 'rgba(0,0,0,0.55)' : 'rgba(150,168,178,0.55)',
          },
        ]}>
        {/* Specular highlight: a soft dome of light sitting on the top third of
            the cap, which is what makes moulded plastic read as curved. */}
        <LinearGradient
          pointerEvents="none"
          colors={
            dark
              ? ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']
              : ['rgba(255,255,255,0.62)', 'rgba(255,255,255,0)']
          }
          style={styles.capGlint}
        />
        <View
          pointerEvents="none"
          style={[
            styles.capEdgeLight,
            {
              backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)',
            },
          ]}
        />
        {children}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  frameLift: {
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 14,
  },
  lip: {
    position: 'absolute',
  },
  pool: {
    position: 'absolute',
    top: '-14%',
    right: '-16%',
    bottom: '-14%',
    left: '-16%',
  },
  screw: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowRadius: 2,
  },
  bezel: {
    position: 'absolute',
    borderWidth: 1,
  },
  frame: {
    flex: 1,
    borderWidth: 1.5,
    overflow: 'visible',
  },
  plate: {
    flex: 1,
    borderWidth: 1,
    overflow: 'visible',
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
  plateSheen: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: 0,
    height: '9%',
  },
  well: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  wellContent: {
    flex: 1,
    alignSelf: 'stretch',
  },
  capLift: {
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 6,
  },
  capLiftRgb: {
    shadowOpacity: 0.45,
    shadowRadius: 10,
  },
  cap: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  capGlint: {
    position: 'absolute',
    left: '13%',
    right: '13%',
    top: '6%',
    height: '26%',
    borderRadius: 999,
    opacity: 0.72,
  },
  capEdgeLight: {
    position: 'absolute',
    left: '14%',
    right: '14%',
    top: 2,
    height: 1,
    borderRadius: 1,
  },
});
