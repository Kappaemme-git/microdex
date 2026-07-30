import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark';

export type AgentStatusKey = 'idle' | 'thinking' | 'complete' | 'waiting' | 'error';

export type StatusTone = { label: string; color: string; textColor: string };

export type ThemePalette = {
  mode: ThemeMode;

  // Canvas
  bg: string;
  ambientA: string;
  ambientB: string;

  // Surfaces / cards
  surface: string;
  surfaceMuted: string;
  surfaceInput: string;
  surfaceInputBorder: string;

  // Device (frosted acrylic on a glowing base)
  deviceBaseGlow: string;
  deviceBody: string;
  deviceBorder: string;
  deviceLabel: string;
  screw: string;
  screwBorder: string;

  // Keycaps
  keyFace: string;
  keyFaceTop: string;
  keyBorder: string;
  keyShadow: string;
  keyGlint: string;
  keyIcon: string;
  keyCaption: string;

  // RGB task keys
  rgb: string;
  rgbSoft: string;
  rgbCap: string;

  // Hardware neutrals (dial, joystick, round button)
  hardware: string;
  hardwareBorder: string;
  hardwareGroove: string;

  // Text
  text: string;
  textMuted: string;
  textFaint: string;

  // Lines
  border: string;
  borderStrong: string;
  divider: string;

  // Accents — refined near-black / soft signal green (OpenAI-like)
  accent: string;
  accentText: string;
  accentSoft: string;
  accentSoftBorder: string;
  blue: string;

  // Status / feedback
  online: string;
  syncing: string;
  danger: string;
  dangerText: string;
  dangerSurface: string;

  // Overlays
  scrim: string;
  drawerScrim: string;

  // Inverted chip
  invSurface: string;
  invText: string;
  invTextMuted: string;
};

/** OpenAI / Remodex-inspired: warm paper, charcoal type, quiet borders. */
const LIGHT: ThemePalette = {
  mode: 'light',

  bg: '#F7F7F5',
  ambientA: 'rgba(20,20,20,0.03)',
  ambientB: 'rgba(16,163,127,0.06)',

  surface: '#FFFFFF',
  surfaceMuted: '#F0F0EE',
  surfaceInput: '#F4F4F2',
  surfaceInputBorder: '#E6E6E3',

  deviceBaseGlow: 'rgba(0,0,0,0.06)',
  deviceBody: 'rgba(255,255,255,0.96)',
  deviceBorder: 'rgba(255,255,255,0.98)',
  deviceLabel: '#8A8A86',
  screw: '#1A1A18',
  screwBorder: '#0A0A09',

  keyFace: '#FCFCFB',
  keyFaceTop: '#FFFFFF',
  keyBorder: '#E8E8E5',
  keyShadow: '#9A9A94',
  keyGlint: 'rgba(255,255,255,0.96)',
  keyIcon: '#1A1A18',
  keyCaption: '#3D3D3A',

  rgb: '#10A37F',
  rgbSoft: 'rgba(16,163,127,0.22)',
  rgbCap: 'rgba(232,247,242,0.95)',

  hardware: '#141413',
  hardwareBorder: '#050505',
  hardwareGroove: '#050505',

  text: '#0D0D0D',
  textMuted: '#5C5C5A',
  textFaint: '#8E8E8B',

  border: '#E8E8E5',
  borderStrong: '#DCDCD8',
  divider: '#EEEEEC',

  accent: '#0D0D0D',
  accentText: '#FFFFFF',
  accentSoft: '#F0F0EE',
  accentSoftBorder: '#E0E0DC',
  blue: '#0D0D0D',

  online: '#10A37F',
  syncing: '#C9872A',
  danger: '#D1433F',
  dangerText: '#9E302C',
  dangerSurface: '#FBECEA',

  scrim: 'rgba(13,13,13,0.28)',
  drawerScrim: 'rgba(13,13,13,0.32)',

  invSurface: '#0D0D0D',
  invText: '#F7F7F5',
  invTextMuted: '#A8A8A4',
};

const DARK: ThemePalette = {
  mode: 'dark',

  bg: '#0D0D0D',
  ambientA: 'rgba(255,255,255,0.03)',
  ambientB: 'rgba(16,163,127,0.08)',

  surface: '#171716',
  surfaceMuted: '#1E1E1C',
  surfaceInput: '#141413',
  surfaceInputBorder: '#2A2A28',

  deviceBaseGlow: 'rgba(255,255,255,0.04)',
  deviceBody: 'rgba(28,28,26,0.92)',
  deviceBorder: 'rgba(255,255,255,0.08)',
  deviceLabel: '#7A7A76',
  screw: '#050505',
  screwBorder: '#000000',

  keyFace: '#222220',
  keyFaceTop: '#2A2A28',
  keyBorder: 'rgba(255,255,255,0.06)',
  keyShadow: '#000000',
  keyGlint: 'rgba(255,255,255,0.12)',
  keyIcon: '#F0F0EE',
  keyCaption: '#B0B0AC',

  rgb: '#10A37F',
  rgbSoft: 'rgba(16,163,127,0.35)',
  rgbCap: 'rgba(20,48,40,0.9)',

  hardware: '#050505',
  hardwareBorder: '#000000',
  hardwareGroove: '#000000',

  text: '#F5F5F3',
  textMuted: '#A3A3A0',
  textFaint: '#6E6E6B',

  border: '#2A2A28',
  borderStrong: '#343432',
  divider: '#222220',

  accent: '#F5F5F3',
  accentText: '#0D0D0D',
  accentSoft: 'rgba(255,255,255,0.08)',
  accentSoftBorder: 'rgba(255,255,255,0.14)',
  blue: '#F5F5F3',

  online: '#10A37F',
  syncing: '#D4A04A',
  danger: '#E85B57',
  dangerText: '#FFB0AD',
  dangerSurface: 'rgba(232,91,87,0.14)',

  scrim: 'rgba(0,0,0,0.55)',
  drawerScrim: 'rgba(0,0,0,0.6)',

  invSurface: '#F5F5F3',
  invText: '#0D0D0D',
  invTextMuted: '#5C5C5A',
};

const PALETTES: Record<ThemeMode, ThemePalette> = { light: LIGHT, dark: DARK };

export function statusTone(theme: ThemePalette): Record<AgentStatusKey, StatusTone> {
  const dark = theme.mode === 'dark';
  const thinking = dark ? '#E8C56A' : '#C9872A';
  const thinkingText = dark ? '#E8C56A' : '#8A5A12';
  const waiting = dark ? '#E0A06A' : '#C47A3A';
  const waitingText = dark ? '#E0A06A' : '#8A4E1C';
  return {
    idle: { label: 'Idle', color: dark ? '#5A5A58' : '#B8B8B4', textColor: theme.textFaint },
    thinking: { label: 'Thinking', color: thinking, textColor: thinkingText },
    complete: { label: 'Complete', color: theme.online, textColor: theme.online },
    waiting: { label: 'Needs input', color: waiting, textColor: waitingText },
    error: { label: 'Error', color: theme.danger, textColor: theme.danger },
  };
}

/**
 * Saturated LED colours for the deck lighting — these are light sources, not
 * text colours, so they stay vivid in both themes.
 */
export const LED: Record<AgentStatusKey, string> = {
  idle: '#FFFFFF',
  thinking: '#304FFE',
  complete: '#00FF4C',
  waiting: '#FF6D00',
  error: '#FF0033',
};

/** Dictation has its own colour so it reads as a different signal. */
export const LED_RECORDING = '#2E8B57';

const STORAGE_THEME = 'microdex.theme.mode.v1';

async function readStoredMode(): Promise<ThemeMode | null> {
  try {
    const value =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(STORAGE_THEME) ?? null
        : await SecureStore.getItemAsync(STORAGE_THEME);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

async function writeStoredMode(mode: ThemeMode) {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(STORAGE_THEME, mode);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_THEME, mode);
  } catch {
    // A failed preference write should never crash the controller.
  }
}

type ThemeContextValue = {
  theme: ThemePalette;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(
    () => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'),
  );

  useEffect(() => {
    void (async () => {
      const stored = await readStoredMode();
      if (stored) setModeState(stored);
    })();
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void writeStoredMode(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      void writeStoredMode(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: PALETTES[mode], mode, setMode, toggle }),
    [mode, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within a ThemeProvider');
  return value;
}
