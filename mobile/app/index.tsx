import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Directions,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatDrawer, { type ChatDrawerHandle } from '@/components/chat-drawer';
import { CentralIcon, type CentralIconName } from '@/components/central-icon';
import { CodexCommandGlyph } from '@/components/codex-command-glyph';
import {
  CodexMicroActionGlyph,
  CodexMicroGlyph,
  CodexVoiceGlyph,
} from '@/components/codex-micro-glyph';
import { DeckLighting, type MicLight } from '@/components/deck-lighting';
import { HardwareKey } from '@/components/hardware-key';
import { Joystick } from '@/components/joystick';
import { ReasoningDial } from '@/components/reasoning-dial';
import { DismissibleSheet, SheetHandlePill } from '@/components/sheet-dismiss-handle';
import { RaisedShell, Screw, ShellPool, getSkeuo, useSkeuo } from '@/components/skeuo';
import {
  BridgeStatus,
  QueuedMessage,
  RemoteState,
  ReasoningEffort,
  bridgeEventsUrl,
  bridgeRequest,
  inferBridgeUrl,
  isBridgeAuthError,
  isBridgeConnectionError,
  mobileAppInfo,
} from '@/lib/bridge';
import { Fonts } from '@/lib/fonts';
import { suggestedKeycapForCommand } from '@/lib/keycap-catalog';
import {
  DEFAULT_MICRO_LAYOUT,
  MICRO_ACTIONS,
  defaultActionForKeycap,
  defaultProgrammedKeys,
  findMicroAction,
  legacyActionIdForProgrammedKey,
  parseProgrammedKeys,
  programmedActionId,
} from '@/lib/micro-actions';
import type {
  MicroAction,
  MicroActionIcon,
  MicroKeycapId,
  ProgrammedKey,
  ProgrammableCommandId,
} from '@/lib/micro-actions';
import { claimPairingPayload, parsePairingUrl } from '@/lib/pairing';
import type { AgentStatusKey } from '@/lib/theme';
import { LED, LED_RECORDING, statusTone, ThemePalette, useTheme } from '@/lib/theme';

const STATUS_ICON: Partial<Record<AgentStatusKey, CentralIconName>> = {
  complete: 'successCircle',
  waiting: 'alert',
  error: 'alert',
};

type JoystickDirection = 'up' | 'right' | 'down' | 'left';
type EncoderMode = 'reasoning' | 'composer-navigation' | 'conversation-scroll';
type Styles = ReturnType<typeof createStyles>;

const STORAGE_URL = 'microdex.bridge.url';
const STORAGE_TOKEN = 'microdex.bridge.token';
const STORAGE_PROGRAMMED_KEYS = 'microdex.programmable.keys.v2';
const STORAGE_LEGACY_PROGRAMMED_KEYS = 'microdex.programmable.keys.v1';
const STORAGE_ENCODER_MODE = 'microdex.encoder.mode.v1';
const EXPO_BRIDGE_TOKEN = __DEV__
  ? process.env.EXPO_PUBLIC_MICRODEX_TOKEN?.trim() ?? ''
  : '';
const FALLBACK_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const COMPLETE_LIGHT_MS = 1_200;
const KEY_RESULT_LIGHT_MS = 900;
const LED_VOICE = '#8EA8FF';
const ACTION_PROGRESS: Record<string, string> = {
  fast: 'Updating Fast Mode',
  reasoning: 'Updating reasoning',
  send: 'Sending to Codex',
  select: 'Switching chat',
  approve: 'Approving request',
  decline: 'Declining request',
  fork: 'Creating fork',
  dictation: 'Opening dictation',
  voice: 'Controlling Voice Chat',
  plan: 'Changing mode',
  forward: 'Moving forward',
  sidebar: 'Toggling sidebar',
  back: 'Moving back',
};
const VISUAL_PREVIEW =
  __DEV__ &&
  Platform.OS === 'web' &&
  new URLSearchParams(globalThis.location?.search ?? '').get('preview') === '1';
const VISUAL_PREVIEW_REMOTE: RemoteState = {
  online: true,
  selectedThreadId: 'preview-thinking',
  selected: {
    id: 'preview-thinking',
    name: 'Build Microdex lighting',
    task: 'Faithful Codex Micro controller',
    project: 'Microdex',
    status: 'thinking',
    updatedAt: Date.now(),
    fastMode: true,
    reasoningEffort: 'high',
    supportedReasoningEfforts: FALLBACK_EFFORTS,
  },
  threads: [
    {
      id: 'preview-thinking',
      name: 'Build Microdex lighting',
      task: 'Faithful Codex Micro controller',
      project: 'Microdex',
      status: 'thinking',
      updatedAt: Date.now(),
      fastMode: true,
      reasoningEffort: 'high',
      supportedReasoningEfforts: FALLBACK_EFFORTS,
    },
    {
      id: 'preview-complete',
      name: 'Pairing CLI',
      task: 'Test pairing',
      project: 'Microdex',
      status: 'complete',
      updatedAt: Date.now() - 1_000,
      fastMode: false,
      reasoningEffort: 'medium',
      supportedReasoningEfforts: FALLBACK_EFFORTS,
    },
    {
      id: 'preview-waiting',
      name: 'TestFlight',
      task: 'Needs confirmation',
      project: 'Microdex',
      status: 'waiting',
      updatedAt: Date.now() - 2_000,
      fastMode: false,
      reasoningEffort: 'medium',
      supportedReasoningEfforts: FALLBACK_EFFORTS,
    },
  ],
  messageQueue: [],
  pendingApproval: null,
  actionAvailability: {},
  voice: { state: 'inactive', muted: false },
};
const VISUAL_PREVIEW_STATUS: BridgeStatus = {
  connected: true,
  bridge: { name: 'Microdex Preview', version: 'dev', protocolVersion: 2 },
  capabilities: {
    verifiedSettings: true,
    remoteChat: true,
    taskControl: true,
    programmableActions: MICRO_ACTIONS.length,
    programmableAssignments: true,
    encoderModes: true,
    desktopAutomation: true,
    actionAvailability: true,
    visibleDesktopRouting: true,
  },
  fastMode: true,
  reasoningEffort: 'high',
  configPath: 'preview',
  platform: 'web',
  remote: VISUAL_PREVIEW_REMOTE,
};

function readableError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Throws when the bridge could not run the command, and otherwise returns the
 * caveat to show when the command was delivered but its result could not be
 * read back. A key stroke has no return value, so treating "unconfirmed" as a
 * failure would make every working desktop key look broken.
 *
 * `confirmed` is only sent by newer bridges; when it is absent, fall back to
 * `verified` so an older bridge keeps working.
 */
function requireVerifiedCommand(state: RemoteState) {
  const result = state.commandResult;
  if (!result?.applied || !result.verified) {
    throw new Error(
      result?.warning ||
      'Codex received the command but did not confirm that it was applied.',
    );
  }
  const confirmed = result.confirmed ?? true;
  return confirmed ? null : result.warning ?? null;
}

async function readStoredValue(key: string) {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function writeStoredValue(key: string, value: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredValue(key: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function GuideItem({
  styles,
  theme,
  icon,
  actionId,
  title,
  body,
}: {
  styles: Styles;
  theme: ThemePalette;
  icon?: MicroActionIcon;
  actionId?: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.guideItem}>
      <View style={styles.guideIcon}>
        {actionId ? (
          <CodexMicroActionGlyph actionId={actionId} size={20} color={theme.text} />
        ) : (
          <MaterialCommunityIcons name={icon ?? 'circle-outline'} size={20} color={theme.text} />
        )}
      </View>
      <View style={styles.guideCopy}>
        <Text style={styles.guideTitle}>{title}</Text>
        <Text style={styles.guideBody}>{body}</Text>
      </View>
    </View>
  );
}

export default function ControllerScreen() {
  const { theme, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const skeuo = useSkeuo();
  const statusMeta = useMemo(() => statusTone(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [bridgeUrl, setBridgeUrl] = useState(inferBridgeUrl());
  const [token, setToken] = useState(EXPO_BRIDGE_TOKEN);
  const [status, setStatus] = useState<BridgeStatus | null>(
    VISUAL_PREVIEW ? VISUAL_PREVIEW_STATUS : null,
  );
  const [remote, setRemote] = useState<RemoteState | null>(
    VISUAL_PREVIEW ? VISUAL_PREVIEW_REMOTE : null,
  );
  const [liveChannel, setLiveChannel] = useState<'offline' | 'connecting' | 'live'>(
    VISUAL_PREVIEW ? 'live' : 'offline',
  );
  const [draft, setDraft] = useState('');
  const [composerVisible, setComposerVisible] = useState(true);
  const composerRef = useRef<TextInput>(null);
  const mainScrollRef = useRef<ScrollView>(null);
  const chatDrawerRef = useRef<ChatDrawerHandle>(null);
  const liveStatusPulse = useRef(new Animated.Value(0.62)).current;
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const commandCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [credentialsReady, setCredentialsReady] = useState(VISUAL_PREVIEW);
  const [bridgeConnecting, setBridgeConnecting] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState('Ready. Connect the desktop bridge to control Codex.');
  const [noticeError, setNoticeError] = useState(false);
  const [programmedKeys, setProgrammedKeys] = useState<(ProgrammedKey | null)[]>(
    defaultProgrammedKeys,
  );
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [actionSearch, setActionSearch] = useState('');
  const [chosenActionId, setChosenActionId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [encoderMode, setEncoderMode] = useState<EncoderMode>('reasoning');
  const [guideVisible, setGuideVisible] = useState(false);
  const [keyManagerVisible, setKeyManagerVisible] = useState(false);
  const [dictationActive, setDictationActive] = useState(false);
  const [completionLight, setCompletionLight] = useState(false);
  const [hardwareFeedbackColor, setHardwareFeedbackColor] = useState<string | null>(null);
  const [keyResultLights, setKeyResultLights] = useState<Record<number, string>>({});
  const dictationLocked = useRef(false);
  const dictationQueue = useRef<Promise<void>>(Promise.resolve());
  const encoderQueue = useRef<Promise<void>>(Promise.resolve());
  const completionLightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardwareFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyResultTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const dictationReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dictationUnlockPress = useRef(false);
  const previousActiveState = useRef<{ id: string; status: AgentStatusKey } | null>(null);
  const reconnectAttempt = useRef(0);
  const connectionInFlight = useRef(false);
  const pairingInFlight = useRef(false);
  /** Pairing link already attempted, so an incoming link is claimed once only. */
  const handledPairingUrl = useRef<string | null>(null);
  /** Set when the Mac rejected the saved credential, which stops the retry loop. */
  const credentialRejected = useRef(false);
  const incomingUrl = Linking.useLinkingURL();
  const networkState = Network.useNetworkState();

  const activeAgent = remote?.selected ?? {
    id: '0', name: 'No task selected', task: 'Connect to Codex App Server', status: 'idle' as const,
  };
  const activeThread = remote?.selected ?? null;
  const activeMessageQueue = remote?.messageQueue.filter(
    (message) => message.threadId === activeThread?.id,
  ) ?? [];
  const activeThreadIndex = remote?.threads.findIndex(
    (thread) => thread.id === activeThread?.id,
  ) ?? -1;
  const voiceState = remote?.voice?.state ?? 'inactive';
  const voiceActive = voiceState === 'active';
  const voiceMuted = remote?.voice?.muted ?? false;
  const supportedReasoningEfforts = activeThread?.supportedReasoningEfforts?.length
    ? activeThread.supportedReasoningEfforts
    : FALLBACK_EFFORTS;
  const effortIndex = Math.max(
    0,
    supportedReasoningEfforts.indexOf(activeThread?.reasoningEffort ?? 'medium'),
  );
  const [dialIndex, setDialIndex] = useState(effortIndex);
  const activeMeta = statusMeta[activeAgent.status];
  const chosenAction = findMicroAction(chosenActionId);
  const filteredActions = useMemo(() => {
    const query = actionSearch.trim().toLowerCase();
    if (!query) return MICRO_ACTIONS;
    return MICRO_ACTIONS.filter((action) =>
      `${action.label} ${action.description} ${action.category}`.toLowerCase().includes(query),
    );
  }, [actionSearch]);
  const guideGroups = useMemo(() => {
    const order: MicroAction['category'][] = [
      'Core', 'Task', 'Input', 'Workspace', 'Custom',
    ];
    const titles: Record<MicroAction['category'], string> = {
      Core: 'Core controls',
      Task: 'Task & chat',
      Input: 'Input & voice',
      Workspace: 'Workspace & navigation',
      Custom: 'Custom prompts',
    };
    return order
      .map((category) => ({
        category,
        title: titles[category],
        actions: MICRO_ACTIONS.filter((action) => action.category === category),
      }))
      .filter((group) => group.actions.length > 0);
  }, []);
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(liveStatusPulse, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(liveStatusPulse, {
          toValue: 0.62,
          duration: 720,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [liveStatusPulse]);

  const openChatSwitcher = useCallback(() => {
    chatDrawerRef.current?.open();
  }, []);

  const closeChatSwitcher = useCallback(() => {
    chatDrawerRef.current?.close();
  }, []);

  const announce = useCallback((message: string, isError = false) => {
    setNotice(message);
    setNoticeError(isError);
  }, []);

  const tryOpenChatFromSwipe = useCallback(() => {
    if (!status) {
      setSettingsVisible(true);
      announce('Connect the bridge first, then swipe to open chats.', true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    openChatSwitcher();
  }, [announce, openChatSwitcher, status]);

  // Fling left opens chat — more reliable vs ScrollView than a competing Pan.
  const homeFlingLeft = useMemo(
    () =>
      Gesture.Fling()
        .direction(Directions.LEFT)
        .onEnd(() => {
          runOnJS(tryOpenChatFromSwipe)();
        }),
    [tryOpenChatFromSwipe],
  );

  // Left-edge pull (drawer convention) as a backup hit target.
  const homeEdgeOpen = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(10)
        .failOffsetY([-28, 28])
        .onEnd((event) => {
          if (event.translationX >= 40 || event.velocityX >= 500) {
            runOnJS(tryOpenChatFromSwipe)();
          }
        }),
    [tryOpenChatFromSwipe],
  );

  useEffect(() => {
    if (VISUAL_PREVIEW) return;
    void (async () => {
      const [
        savedUrl,
        savedToken,
        savedKeys,
        savedLegacyKeys,
        savedEncoderMode,
      ] = await Promise.all([
        readStoredValue(STORAGE_URL),
        readStoredValue(STORAGE_TOKEN),
        readStoredValue(STORAGE_PROGRAMMED_KEYS),
        readStoredValue(STORAGE_LEGACY_PROGRAMMED_KEYS),
        readStoredValue(STORAGE_ENCODER_MODE),
      ]);
      if (savedUrl && !EXPO_BRIDGE_TOKEN) setBridgeUrl(savedUrl);
      if (EXPO_BRIDGE_TOKEN) setToken(EXPO_BRIDGE_TOKEN);
      else if (savedToken) setToken(savedToken);
      const storedKeys = savedKeys ?? savedLegacyKeys;
      if (storedKeys) {
        const migratedKeys = parseProgrammedKeys(storedKeys);
        setProgrammedKeys(migratedKeys);
        if (!savedKeys && savedLegacyKeys) {
          await writeStoredValue(
            STORAGE_PROGRAMMED_KEYS,
            JSON.stringify(migratedKeys),
          );
        }
      }
      if (
        savedEncoderMode === 'reasoning' ||
        savedEncoderMode === 'composer-navigation' ||
        savedEncoderMode === 'conversation-scroll'
      ) {
        setEncoderMode(savedEncoderMode);
      }
      setCredentialsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (loadingAction === 'reasoning') return;
    setDialIndex(effortIndex);
  }, [effortIndex, loadingAction]);

  // Status lights are notifications, not permanent decoration. Thinking,
  // waiting and error remain visible while they need attention; completion
  // flashes once when the active task actually transitions to complete.
  useEffect(() => {
    const current = activeThread
      ? { id: activeThread.id, status: activeAgent.status }
      : null;
    const previous = previousActiveState.current;

    if (
      current &&
      previous?.id === current.id &&
      previous.status !== current.status &&
      current.status === 'complete'
    ) {
      if (completionLightTimer.current) clearTimeout(completionLightTimer.current);
      setCompletionLight(true);
      completionLightTimer.current = setTimeout(() => {
        completionLightTimer.current = null;
        setCompletionLight(false);
      }, COMPLETE_LIGHT_MS);
    } else if (current?.status !== 'complete') {
      if (completionLightTimer.current) clearTimeout(completionLightTimer.current);
      completionLightTimer.current = null;
      setCompletionLight(false);
    }

    previousActiveState.current = current;
  }, [activeAgent.status, activeThread]);

  useEffect(() => () => {
    if (completionLightTimer.current) clearTimeout(completionLightTimer.current);
    if (hardwareFeedbackTimer.current) clearTimeout(hardwareFeedbackTimer.current);
    for (const timer of keyResultTimers.current.values()) clearTimeout(timer);
    keyResultTimers.current.clear();
  }, []);

  const flashHardwareFeedback = useCallback((color: string) => {
    if (hardwareFeedbackTimer.current) clearTimeout(hardwareFeedbackTimer.current);
    setHardwareFeedbackColor(color);
    hardwareFeedbackTimer.current = setTimeout(() => {
      hardwareFeedbackTimer.current = null;
      setHardwareFeedbackColor(null);
    }, KEY_RESULT_LIGHT_MS);
  }, []);

  const flashProgrammedKey = useCallback((slotIndex: number, color: string) => {
    const existing = keyResultTimers.current.get(slotIndex);
    if (existing) clearTimeout(existing);
    setKeyResultLights((current) => ({ ...current, [slotIndex]: color }));
    const timer = setTimeout(() => {
      keyResultTimers.current.delete(slotIndex);
      setKeyResultLights((current) => {
        const next = { ...current };
        delete next[slotIndex];
        return next;
      });
    }, KEY_RESULT_LIGHT_MS);
    keyResultTimers.current.set(slotIndex, timer);
  }, []);

  const revealRemoteComposer = useCallback(() => {
    requestAnimationFrame(() => {
      mainScrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const openRemoteComposer = useCallback(() => {
    setComposerVisible(true);
    requestAnimationFrame(() => {
      revealRemoteComposer();
      composerRef.current?.focus();
    });
  }, [revealRemoteComposer]);

  useEffect(() => {
    if (!activeMessageQueue.length) return;
    if (composerRef.current?.isFocused()) {
      revealRemoteComposer();
    }
  }, [activeMessageQueue.length, revealRemoteComposer]);

  const handleActionError = useCallback((error: unknown) => {
    if (isBridgeConnectionError(error)) {
      setStatus(null);
      setRemote(null);
    }
    announce(readableError(error), true);
  }, [announce]);

  const refreshRemote = useCallback(async () => {
    if (!status) return false;
    try {
      const next = await bridgeRequest<RemoteState>(bridgeUrl, token, '/api/remote/state');
      setRemote(next);
      return true;
    } catch (error) {
      handleActionError(error);
      return false;
    }
  }, [bridgeUrl, handleActionError, status, token]);

  useEffect(() => {
    if (VISUAL_PREVIEW) return;
    if (!status) {
      setLiveChannel('offline');
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let retries = 0;

    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => void refreshRemote(), 5_000);
    };
    const stopFallback = () => {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const connectLive = () => {
      if (cancelled) return;
      setLiveChannel('connecting');
      socket = new WebSocket(bridgeEventsUrl(bridgeUrl));
      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type: 'ready' | 'state' | 'error';
            state?: RemoteState;
            message?: string;
          };
          if (message.type === 'ready') {
            retries = 0;
            setLiveChannel('live');
            stopFallback();
          }
          if (message.type === 'state' && message.state) setRemote(message.state);
          if (message.type === 'error' && message.message) {
            announce(message.message, true);
          }
        } catch {
          // Ignore malformed frames and keep the last known good state.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (cancelled) return;
        setLiveChannel('connecting');
        startFallback();
        retries += 1;
        retryTimer = setTimeout(connectLive, Math.min(8_000, 500 * 2 ** Math.min(retries, 4)));
      };
    };

    void refreshRemote();
    connectLive();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopFallback();
      socket?.close();
    };
  }, [announce, bridgeUrl, refreshRemote, status, token]);

  const connectToBridge = useCallback(async (
    candidateUrl: string,
    candidateToken: string,
    interactive = false,
  ) => {
    if (!candidateUrl.trim() || !candidateToken.trim()) {
      if (interactive) announce('Enter the bridge address and access code.', true);
      return false;
    }
    if (connectionInFlight.current) return false;
    connectionInFlight.current = true;
    setBridgeConnecting(true);
    if (interactive) setLoadingAction('connect');
    try {
      const nextStatus = await bridgeRequest<BridgeStatus>(
        candidateUrl,
        candidateToken,
        '/api/status',
      );
      await Promise.all([
        writeStoredValue(STORAGE_URL, candidateUrl.trim()),
        writeStoredValue(STORAGE_TOKEN, candidateToken.trim()),
      ]);
      setBridgeUrl(candidateUrl.trim());
      setToken(candidateToken.trim());
      setStatus(nextStatus);
      if (nextStatus.remote?.online) setRemote(nextStatus.remote as RemoteState);
      setSettingsVisible(false);
      setScannerVisible(false);
      reconnectAttempt.current = 0;
      credentialRejected.current = false;
      announce('Bridge connected. The keys now control Codex.');
      if (interactive) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return true;
    } catch (error) {
      setStatus(null);
      setRemote(null);
      // A rejected credential is final. Say so once and drop the stale token, so
      // the reconnect loop stops and the pairing screen becomes reachable
      // instead of the app retrying an access code the Mac will never accept.
      if (isBridgeAuthError(error)) {
        credentialRejected.current = true;
        announce(readableError(error), true);
        await deleteStoredValue(STORAGE_TOKEN);
        setToken('');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }
      if (interactive) {
        announce(readableError(error), true);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return false;
    } finally {
      connectionInFlight.current = false;
      setBridgeConnecting(false);
      if (interactive) setLoadingAction(null);
    }
  }, [announce]);

  const acceptPairingCode = useCallback(async (value: string) => {
    if (pairingInFlight.current) return;
    pairingInFlight.current = true;
    // A fresh QR is exactly what clears a previously rejected credential.
    credentialRejected.current = false;
    try {
      const payload = parsePairingUrl(value);
      // Stop the camera after the first valid read. If the Mac is unreachable,
      // keeping the scanner mounted immediately reads the same QR again.
      setScannerVisible(false);
      announce('Secure pairing code recognized. Connecting to your Mac…');
      const credentials = await claimPairingPayload(payload);
      await Promise.all([
        writeStoredValue(STORAGE_URL, credentials.bridgeUrl),
        writeStoredValue(STORAGE_TOKEN, credentials.token),
      ]);
      setBridgeUrl(credentials.bridgeUrl);
      setToken(credentials.token);
      await connectToBridge(credentials.bridgeUrl, credentials.token, true);
    } catch (error) {
      announce(readableError(error), true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      pairingInFlight.current = false;
    }
  }, [announce, connectToBridge]);

  const openPairingScanner = useCallback(async () => {
    if (Platform.OS === 'web') {
      announce('QR pairing is available on iPhone and Android.', true);
      return;
    }
    let permission = cameraPermission;
    if (!permission?.granted) permission = await requestCameraPermission();
    if (!permission.granted) {
      announce('Camera permission is needed to scan the pairing QR.', true);
      return;
    }
    // iOS cannot reliably present the camera modal while the Settings modal
    // is still being dismissed. Close it first, then present the scanner.
    setSettingsVisible(false);
    setTimeout(() => setScannerVisible(true), Platform.OS === 'ios' ? 320 : 0);
  }, [announce, cameraPermission, requestCameraPermission]);

  const copyInstallCommand = useCallback(async () => {
    await Clipboard.setStringAsync('npx microdex-cli@latest setup');
    announce('Command copied. Paste it into Terminal on your Mac.');
    setCommandCopied(true);
    if (commandCopiedTimer.current) clearTimeout(commandCopiedTimer.current);
    commandCopiedTimer.current = setTimeout(() => setCommandCopied(false), 2200);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [announce]);

  useEffect(
    () => () => {
      if (commandCopiedTimer.current) clearTimeout(commandCopiedTimer.current);
    },
    [],
  );

  const copyDiagnostics = useCallback(async () => {
    let latestStatus = status;
    let refreshError: string | null = null;
    if (bridgeUrl.trim() && token.trim()) {
      try {
        latestStatus = await bridgeRequest<BridgeStatus>(
          bridgeUrl,
          token,
          '/api/status',
        );
        setStatus(latestStatus);
      } catch (error) {
        refreshError = readableError(error);
      }
    }

    const report = {
      microdexDiagnostics: 1,
      generatedAt: new Date().toISOString(),
      app: {
        ...mobileAppInfo(),
        platform: Platform.OS,
      },
      bridge: latestStatus?.bridge ?? {
        version: 'legacy-or-unavailable',
        protocolVersion: 1,
      },
      capabilities: latestStatus?.capabilities ?? null,
      desktop: latestStatus?.desktop ?? null,
      connection: {
        connected: Boolean(latestStatus),
        refreshError,
        networkType: networkState.type,
        networkConnected: networkState.isConnected,
      },
      remote: {
        online: Boolean(remote?.online),
        selectedTask: Boolean(remote?.selectedThreadId),
        lastCommand: remote?.commandResult ?? null,
      },
    };
    await Clipboard.setStringAsync(JSON.stringify(report, null, 2));
    announce('Diagnostic report copied. Send it with the failed button name.');
    await Haptics.selectionAsync();
  }, [
    announce,
    bridgeUrl,
    networkState.isConnected,
    networkState.type,
    remote,
    status,
    token,
  ]);

  const forgetPairedMac = useCallback(async () => {
    await Promise.all([
      deleteStoredValue(STORAGE_URL),
      deleteStoredValue(STORAGE_TOKEN),
    ]);
    setBridgeUrl(inferBridgeUrl());
    setToken('');
    setStatus(null);
    setRemote(null);
    setSettingsVisible(false);
    reconnectAttempt.current = 0;
    announce('Mac removed. Pair again to use Microdex.');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [announce]);

  useEffect(() => {
    if (!incomingUrl) return;
    // Accept both slash forms: links generated by older bridges use
    // `microdex://pair`, newer ones the `microdex:///pair` that Expo Router can
    // actually route.
    const isPairDeepLink = /^microdex:\/\/\/?pair\b/.test(incomingUrl);
    const isPairHttp = /\/pair(?:\?|$)/.test(incomingUrl);
    if (!isPairDeepLink && !isPairHttp) return;
    // One attempt per link. `incomingUrl` keeps its value, and this effect
    // re-runs whenever a state update gives `acceptPairingCode` a new identity —
    // including the state update the failure itself causes. That turned a single
    // spent code into an endless retry loop with no way out.
    if (handledPairingUrl.current === incomingUrl) return;
    handledPairingUrl.current = incomingUrl;
    void acceptPairingCode(incomingUrl);
  }, [acceptPairingCode, incomingUrl]);

  useEffect(() => {
    if (
      !credentialsReady ||
      status ||
      !bridgeUrl.trim() ||
      !token.trim() ||
      networkState.isConnected === false ||
      // Nothing to retry once the Mac has rejected the credential.
      credentialRejected.current
    ) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const reconnect = async () => {
      const connected = await connectToBridge(bridgeUrl, token);
      if (cancelled || connected || credentialRejected.current) return;
      reconnectAttempt.current += 1;
      const delay = Math.min(15_000, 1_000 * 2 ** Math.min(reconnectAttempt.current, 4));
      retryTimer = setTimeout(() => void reconnect(), delay);
    };
    void reconnect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    bridgeUrl,
    connectToBridge,
    credentialsReady,
    networkState.isConnected,
    networkState.type,
    status,
    token,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !status) {
        reconnectAttempt.current = 0;
        void connectToBridge(bridgeUrl, token);
      }
    });
    return () => subscription.remove();
  }, [bridgeUrl, connectToBridge, status, token]);

  const requireBridge = useCallback(() => {
    if (status) return true;
    setSettingsVisible(true);
    announce('Connect the bridge running on your computer first.', true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return false;
  }, [announce, status]);

  const requireVerifiedSettings = useCallback(() => {
    if (
      status?.capabilities?.verifiedSettings &&
      status.capabilities.actionAvailability &&
      status.capabilities.visibleDesktopRouting
    ) return true;
    announce(
      'The Mac bridge is outdated. Run npx microdex-cli@latest setup, then try again.',
      true,
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return false;
  }, [
    announce,
    status?.capabilities?.actionAvailability,
    status?.capabilities?.visibleDesktopRouting,
    status?.capabilities?.verifiedSettings,
  ]);

  const unavailableReason = useCallback((actionId: string) => {
    const availability = remote?.actionAvailability?.[actionId];
    return availability && availability.status !== 'available'
      ? availability.reason ?? 'This control is not available right now.'
      : undefined;
  }, [remote?.actionAvailability]);

  const requireActionAvailable = useCallback((actionId: string) => {
    const reason = unavailableReason(actionId);
    if (!reason) return true;
    announce(reason, true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return false;
  }, [announce, unavailableReason]);

  const toggleFast = useCallback(async () => {
    if (!requireBridge()) {
      flashHardwareFeedback(LED.error);
      return;
    }
    if (!requireVerifiedSettings()) {
      flashHardwareFeedback(LED.error);
      return;
    }
    if (!requireActionAvailable('FAST')) {
      flashHardwareFeedback(LED.error);
      return;
    }
    if (!activeThread) {
      announce('Select a Codex task first.', true);
      flashHardwareFeedback(LED.error);
      return;
    }
    const enabled = !activeThread.fastMode;
    const previousRemote = remote;
    setLoadingAction('fast');
    setRemote((current) => current?.selected
      ? {
          ...current,
          selected: { ...current.selected, fastMode: enabled },
          threads: current.threads.map((thread) =>
            thread.id === current.selected?.id ? { ...thread, fastMode: enabled } : thread
          ),
        }
      : current);
    announce(enabled ? 'Enabling Fast Mode…' : 'Disabling Fast Mode…');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const nextRemote = await bridgeRequest<RemoteState>(bridgeUrl, token, '/api/remote/settings', {
        method: 'POST',
        body: { threadId: activeThread.id, fastMode: enabled },
      });
      requireVerifiedCommand(nextRemote);
      setRemote(nextRemote);
      announce(enabled ? 'Fast Mode enabled.' : 'Fast Mode disabled.');
      flashHardwareFeedback(LED.complete);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setRemote(previousRemote);
      handleActionError(error);
      flashHardwareFeedback(LED.error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  }, [
    activeThread,
    announce,
    bridgeUrl,
    flashHardwareFeedback,
    handleActionError,
    remote,
    requireBridge,
    requireActionAvailable,
    requireVerifiedSettings,
    token,
  ]);

  const commitReasoning = useCallback(
    async (index: number) => {
      if (!requireBridge()) {
        flashHardwareFeedback(LED.error);
        return;
      }
      if (!requireVerifiedSettings()) {
        setDialIndex(effortIndex);
        flashHardwareFeedback(LED.error);
        return;
      }
      const bounded = Math.min(supportedReasoningEfforts.length - 1, Math.max(0, index));
      const effort = supportedReasoningEfforts[bounded];
      setDialIndex(bounded);
      // Compare against what Codex holds, not against the dial: the dial has
      // already moved optimistically while the finger was down.
      if (effort === activeThread?.reasoningEffort) {
        announce(`Reasoning already at ${effort}.`);
        return;
      }
      setLoadingAction('reasoning');
      try {
        if (!activeThread) throw new Error('Select a Codex task first.');
        const nextRemote = await bridgeRequest<RemoteState>(
          bridgeUrl,
          token,
          '/api/remote/settings',
          {
            method: 'POST',
            body: {
              threadId: activeThread.id,
              reasoningEffort: effort,
            },
          },
        );
        requireVerifiedCommand(nextRemote);
        setRemote(nextRemote);
        setDialIndex(bounded);
        announce(`Reasoning set to ${effort}.`);
        flashHardwareFeedback(LED.complete);
        await Haptics.selectionAsync();
      } catch (error) {
        setDialIndex(effortIndex);
        handleActionError(error);
        flashHardwareFeedback(LED.error);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setLoadingAction(null);
      }
    },
    [
      activeThread,
      announce,
      bridgeUrl,
      effortIndex,
      flashHardwareFeedback,
      handleActionError,
      requireBridge,
      requireVerifiedSettings,
      supportedReasoningEfforts,
      token,
    ],
  );

  const previewReasoning = useCallback((index: number) => {
    const bounded = Math.min(supportedReasoningEfforts.length - 1, Math.max(0, index));
    setDialIndex(bounded);
    void Haptics.selectionAsync();
  }, [supportedReasoningEfforts.length]);

  const sendEncoderAction = useCallback((
    action: 'step' | 'press',
    delta?: -1 | 1,
    steps = 1,
  ) => {
    if (
      encoderMode === 'reasoning' ||
      !requireBridge() ||
      !requireVerifiedSettings()
    ) {
      return;
    }
    // The dial already ticks per notch while spinning, so a batch must not add
    // another one on top.
    if (steps <= 1) void Haptics.selectionAsync();
    encoderQueue.current = encoderQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const next = await bridgeRequest<RemoteState>(
            bridgeUrl,
            token,
            '/api/encoder/action',
            {
              method: 'POST',
              body: {
                mode: encoderMode,
                action,
                delta,
                steps,
              },
            },
          );
          requireVerifiedCommand(next);
          setRemote(next);
        } catch (error) {
          handleActionError(error);
          flashHardwareFeedback(LED.error);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      });
  }, [
    bridgeUrl,
    encoderMode,
    flashHardwareFeedback,
    handleActionError,
    requireBridge,
    requireVerifiedSettings,
    token,
  ]);

  const changeEncoderMode = useCallback(async (nextMode: EncoderMode) => {
    if (
      nextMode !== 'reasoning' &&
      !status?.capabilities?.encoderModes
    ) {
      announce(
        'Update the Mac CLI before enabling Navigate or Scroll mode.',
        true,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    setEncoderMode(nextMode);
    await writeStoredValue(STORAGE_ENCODER_MODE, nextMode);
    const label = nextMode === 'reasoning'
      ? 'Reasoning'
      : nextMode === 'composer-navigation'
        ? 'Composer navigation'
        : 'Conversation scroll';
    announce(`Dial mode: ${label}.`);
    await Haptics.selectionAsync();
  }, [announce, status?.capabilities?.encoderModes]);

  const remoteAction = useCallback(async (
    path: string,
    body: Record<string, unknown>,
    actionId: string,
    successMessage: string,
  ) => {
    if (!requireBridge()) {
      flashHardwareFeedback(LED.error);
      return false;
    }
    if (!requireVerifiedSettings()) {
      flashHardwareFeedback(LED.error);
      return false;
    }
    setLoadingAction(actionId);
    announce(ACTION_PROGRESS[actionId] ?? 'Sending command…');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const next = await bridgeRequest<RemoteState>(bridgeUrl, token, path, { method: 'POST', body });
      const unconfirmed = requireVerifiedCommand(next);
      setRemote(next);
      announce(unconfirmed ? `${successMessage} ${unconfirmed}` : successMessage);
      flashHardwareFeedback(LED.complete);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (error) {
      handleActionError(error);
      flashHardwareFeedback(LED.error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    } finally {
      setLoadingAction(null);
    }
  }, [
    announce,
    bridgeUrl,
    flashHardwareFeedback,
    handleActionError,
    requireBridge,
    requireVerifiedSettings,
    token,
  ]);

  const queueDictation = useCallback((enabled: boolean) => {
    if (
      !requireBridge() ||
      !requireVerifiedSettings() ||
      !requireActionAvailable('MIC')
    ) {
      flashHardwareFeedback(LED.error);
      return;
    }
    setDictationActive(enabled);
    dictationQueue.current = dictationQueue.current
      .catch(() => undefined)
      .then(async () => {
        setLoadingAction('dictation');
        announce(enabled ? 'Listening on the Mac…' : 'Stopping dictation…');
        try {
          const next = await bridgeRequest<RemoteState>(
            bridgeUrl,
            token,
            '/api/desktop/action',
            {
              method: 'POST',
              body: { action: enabled ? 'dictation-start' : 'dictation-stop' },
            },
          );
          requireVerifiedCommand(next);
          setRemote(next);
          announce(enabled
            ? 'Listening. Release to stop; double-press to keep listening.'
            : 'Dictation stopped.');
          if (!enabled) flashHardwareFeedback(LED.complete);
        } catch (error) {
          setDictationActive(false);
          dictationLocked.current = false;
          handleActionError(error);
          flashHardwareFeedback(LED.error);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } finally {
          setLoadingAction(null);
        }
      });
  }, [
    announce,
    bridgeUrl,
    flashHardwareFeedback,
    handleActionError,
    requireActionAvailable,
    requireBridge,
    requireVerifiedSettings,
    token,
  ]);

  const handleDictationPressIn = useCallback(() => {
    if (dictationReleaseTimer.current) {
      clearTimeout(dictationReleaseTimer.current);
      dictationReleaseTimer.current = null;
    }
    if (dictationLocked.current) {
      dictationLocked.current = false;
      dictationUnlockPress.current = true;
      queueDictation(false);
      return;
    }
    dictationUnlockPress.current = false;
    queueDictation(true);
  }, [queueDictation]);

  const handleDictationPressOut = useCallback(() => {
    if (dictationUnlockPress.current) {
      dictationUnlockPress.current = false;
      return;
    }
    if (dictationLocked.current) return;
    if (dictationReleaseTimer.current) clearTimeout(dictationReleaseTimer.current);
    dictationReleaseTimer.current = setTimeout(() => {
      dictationReleaseTimer.current = null;
      if (!dictationLocked.current) queueDictation(false);
    }, 350);
  }, [queueDictation]);

  const handleDictationDoublePress = useCallback(() => {
    if (dictationReleaseTimer.current) {
      clearTimeout(dictationReleaseTimer.current);
      dictationReleaseTimer.current = null;
    }
    if (dictationLocked.current) {
      dictationLocked.current = false;
      queueDictation(false);
      return;
    }
    dictationLocked.current = true;
    announce('Listening hands-free. Press Talk once to stop.');
  }, [announce, queueDictation]);

  const handleVoicePress = useCallback(async () => {
    if (!requireBridge() || !requireVerifiedSettings()) {
      flashHardwareFeedback(LED.error);
      return;
    }
    const action = voiceActive ? 'voice-toggle-mute' : 'voice-start';
    setLoadingAction('voice');
    announce(voiceActive ? 'Updating the Voice microphone…' : 'Opening Voice Chat on your Mac…');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const next = await bridgeRequest<RemoteState>(
        bridgeUrl,
        token,
        '/api/desktop/action',
        { method: 'POST', body: { action } },
      );
      requireVerifiedCommand(next);
      setRemote(next);
      if (next.voice?.state === 'setup') {
        announce('Voice setup is open. Choose a voice on your Mac, then press VOICE again.');
      } else if (next.voice?.state === 'launching') {
        announce('Voice Chat opened on your Mac. Complete anything shown there, then press VOICE again.');
      } else if (next.voice?.state === 'active') {
        announce(next.voice.muted ? 'Voice Chat microphone muted.' : 'Voice Chat is live on your Mac.');
      } else {
        announce('Voice Chat command sent to your Mac.');
      }
      flashHardwareFeedback(LED.complete);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      handleActionError(error);
      flashHardwareFeedback(LED.error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  }, [
    announce,
    bridgeUrl,
    flashHardwareFeedback,
    handleActionError,
    requireBridge,
    requireVerifiedSettings,
    token,
    voiceActive,
  ]);

  const handleVoiceLongPress = useCallback(async () => {
    if (!requireBridge() || !requireVerifiedSettings()) {
      flashHardwareFeedback(LED.error);
      return;
    }
    setLoadingAction('voice');
    announce('Ending Voice Chat…');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const next = await bridgeRequest<RemoteState>(
        bridgeUrl,
        token,
        '/api/desktop/action',
        { method: 'POST', body: { action: 'voice-end' } },
      );
      requireVerifiedCommand(next);
      setRemote(next);
      announce('Voice Chat ended on your Mac.');
      flashHardwareFeedback(LED.complete);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      handleActionError(error);
      flashHardwareFeedback(LED.error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  }, [
    announce,
    bridgeUrl,
    flashHardwareFeedback,
    handleActionError,
    requireBridge,
    requireVerifiedSettings,
    token,
  ]);

  useEffect(() => () => {
    if (dictationReleaseTimer.current) {
      clearTimeout(dictationReleaseTimer.current);
      dictationReleaseTimer.current = null;
    }
  }, []);

  const switchRemoteThread = useCallback(async (threadId: string) => {
    if (!requireBridge() || !remote) return;
    const target = remote.threads.find((thread) => thread.id === threadId);
    if (!target) return;
    if (target.id === activeThread?.id) {
      closeChatSwitcher();
      return;
    }

    const previousRemote = remote;
    setLoadingAction('select');
    setRemote({
      ...remote,
      selectedThreadId: target.id,
      selected: target,
    });
    announce(`Opening ${target.name}…`);
    void Haptics.selectionAsync();

    try {
      const next = await bridgeRequest<RemoteState>(bridgeUrl, token, '/api/remote/select', {
        method: 'POST',
        body: { threadId: target.id },
      });
      setRemote(next);
      closeChatSwitcher();
      announce(`Now controlling ${next.selected?.name ?? target.name}.`);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setRemote(previousRemote);
      handleActionError(error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  }, [
    activeThread?.id,
    announce,
    bridgeUrl,
    closeChatSwitcher,
    handleActionError,
    remote,
    requireBridge,
    token,
  ]);

  const cycleRemoteThread = useCallback(() => {
    if (!remote?.threads.length) return;
    const nextIndex = activeThreadIndex < 0
      ? 0
      : (activeThreadIndex + 1) % remote.threads.length;
    void switchRemoteThread(remote.threads[nextIndex].id);
  }, [activeThreadIndex, remote?.threads, switchRemoteThread]);

  const archiveRemoteThread = useCallback((thread: NonNullable<RemoteState['selected']>) => {
    Alert.alert(
      'Archive this chat?',
      `“${thread.name}” will disappear from Microcodex and the active chats on your Mac. You can recover it from the Codex archive.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void remoteAction(
              '/api/remote/archive',
              { threadId: thread.id },
              `archive-${thread.id}`,
              `${thread.name} archived.`,
            );
          },
        },
      ],
    );
  }, [remoteAction]);

  const archiveRemoteProject = useCallback((
    project: string,
    projectThreads: NonNullable<RemoteState['selected']>[],
  ) => {
    Alert.alert(
      `Archive “${project}”?`,
      `${projectThreads.length} project chats will be archived. The folder and files on your Mac will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive project',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!requireBridge()) return;
              const actionId = `archive-project-${project}`;
              setLoadingAction(actionId);
              announce(`Archiving ${project}…`);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              try {
                let next: RemoteState | null = null;
                for (const thread of projectThreads) {
                  next = await bridgeRequest<RemoteState>(
                    bridgeUrl,
                    token,
                    '/api/remote/archive',
                    { method: 'POST', body: { threadId: thread.id } },
                  );
                  requireVerifiedCommand(next);
                }
                if (next) setRemote(next);
                announce(`${project} archived.`);
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (error) {
                handleActionError(error);
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              } finally {
                setLoadingAction(null);
              }
            })();
          },
        },
      ],
    );
  }, [announce, bridgeUrl, handleActionError, requireBridge, token]);

  const openKeyEditor = useCallback((slotIndex: number) => {
    const current = programmedKeys[slotIndex];
    const keycapId =
      current?.keycapId ??
      DEFAULT_MICRO_LAYOUT[slotIndex] ??
      (`EMPT${Math.min(slotIndex + 1, 5)}` as MicroKeycapId);
    const fallback = defaultActionForKeycap(keycapId);
    const currentActionId = programmedActionId(current);
    setEditingSlot(slotIndex);
    setChosenActionId(
      currentActionId ??
      (fallback?.type === 'command'
        ? fallback.commandId
        : fallback?.type === 'prompt'
          ? 'microdex.insertPrompt'
          : null),
    );
    setCustomPrompt(
      current?.action?.type === 'prompt'
        ? current.action.text
        : fallback?.type === 'prompt'
          ? fallback.text
          : '',
    );
    setActionSearch('');
    void Haptics.selectionAsync();
  }, [programmedKeys]);

  const saveProgrammedKey = useCallback(async () => {
    if (editingSlot === null || !chosenAction) return;
    if (chosenAction.custom && !customPrompt.trim()) {
      announce('Write the custom prompt for this key.', true);
      return;
    }
    // Keep keycapId in storage and in the bridge payload for compatibility
    // with existing installations. It is implementation metadata now: the UI
    // always renders the selected command's semantic icon.
    const currentKeycapId =
      programmedKeys[editingSlot]?.keycapId ??
      DEFAULT_MICRO_LAYOUT[editingSlot] ??
      (`EMPT${Math.min(editingSlot + 1, 5)}` as MicroKeycapId);
    const commandId = chosenAction.custom
      ? null
      : (chosenAction.id as ProgrammableCommandId);
    const keycapId = suggestedKeycapForCommand(commandId) ?? currentKeycapId;
    const nextKeys = programmedKeys.map((key, index) =>
      index === editingSlot
        ? {
            keycapId,
            action: chosenAction.custom
              ? {
                  type: 'prompt' as const,
                  text: customPrompt.trim(),
                }
              : {
                  type: 'command' as const,
                  commandId: chosenAction.id as ProgrammableCommandId,
                },
          }
        : key,
    );
    setProgrammedKeys(nextKeys);
    await writeStoredValue(STORAGE_PROGRAMMED_KEYS, JSON.stringify(nextKeys));
    setEditingSlot(null);
    announce(`${chosenAction.label} assigned to key ${editingSlot + 1}.`);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [
    announce,
    chosenAction,
    customPrompt,
    editingSlot,
    programmedKeys,
  ]);

  const removeProgrammedKey = useCallback(async (slotIndex: number) => {
    if (!programmedKeys[slotIndex]) return;
    const nextKeys = programmedKeys.map((key, index) =>
      index === slotIndex ? null : key,
    );
    setProgrammedKeys(nextKeys);
    await writeStoredValue(STORAGE_PROGRAMMED_KEYS, JSON.stringify(nextKeys));
    announce(`Key ${slotIndex + 1} removed and ready to program.`);
    await Haptics.selectionAsync();
  }, [announce, programmedKeys]);

  const clearProgrammedKey = useCallback(async () => {
    if (editingSlot === null) return;
    await removeProgrammedKey(editingSlot);
    setEditingSlot(null);
  }, [editingSlot, removeProgrammedKey]);

  const runProgrammedKey = useCallback(async (slotIndex: number) => {
    const programmed = programmedKeys[slotIndex];
    if (!programmed) {
      openKeyEditor(slotIndex);
      return;
    }
    const actionId = programmedActionId(programmed);
    const action = findMicroAction(actionId);
    if (!programmed.action || !actionId || !action) {
      openKeyEditor(slotIndex);
      announce(`${programmed.keycapId} needs a command assignment.`, true);
      return;
    }
    if (
      [
        'composer.toggleFastMode',
        'composer.increaseReasoningEffort',
        'composer.decreaseReasoningEffort',
      ].includes(actionId) &&
      !requireVerifiedSettings()
    ) {
      return;
    }
    if (!requireActionAvailable(actionId)) return;
    const succeeded = await remoteAction(
      '/api/programmable/action',
      {
        keycapId: programmed.keycapId,
        action: programmed.action,
        actionId: legacyActionIdForProgrammedKey(programmed),
        customText:
          programmed.action.type === 'prompt'
            ? programmed.action.text
            : undefined,
        threadId: activeThread?.id,
      },
      `programmable-${slotIndex}`,
      `${action?.label ?? 'Programmed action'} sent to Codex.`,
    );
    flashProgrammedKey(slotIndex, succeeded ? LED.complete : LED.error);
  }, [
    activeThread?.id,
    announce,
    flashProgrammedKey,
    openKeyEditor,
    programmedKeys,
    remoteAction,
    requireActionAvailable,
    requireVerifiedSettings,
  ]);

  const sendDraft = useCallback(async () => {
    if (!activeThread) {
      announce('Select a Codex task first.', true);
      return;
    }
    const hasMobileDraft = Boolean(draft.trim());
    const text = draft.trim();
    if (!hasMobileDraft) {
      if (!requireActionAvailable('CODEX')) return;
      await remoteAction(
        '/api/desktop/action',
        { action: 'send' },
        'send',
        'Desktop composer sent.',
      );
      return;
    }

    if (!requireBridge()) return;
    const optimisticId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: QueuedMessage = {
      id: optimisticId,
      threadId: activeThread.id,
      text,
      status: 'queued',
      createdAt: Date.now(),
    };
    setRemote((current) => current ? {
      ...current,
      messageQueue: [...(current.messageQueue ?? []), optimisticMessage],
    } : current);
    setDraft('');
    announce('Message added to the Codex queue.');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await bridgeRequest<{ messageQueue: QueuedMessage[] }>(
        bridgeUrl,
        token,
        '/api/remote/send',
        {
          method: 'POST',
          body: { threadId: activeThread.id, text },
        },
      );
    } catch (error) {
      setRemote((current) => current ? {
        ...current,
        messageQueue: (current.messageQueue ?? []).filter(
          (message) => message.id !== optimisticId,
        ),
      } : current);
      handleActionError(error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [
    activeThread,
    announce,
    bridgeUrl,
    draft,
    handleActionError,
    remoteAction,
    requireActionAvailable,
    requireBridge,
    token,
  ]);

  const removeQueuedMessage = useCallback(async (messageId: string) => {
    if (!requireBridge()) return;
    setLoadingAction(`queue-${messageId}`);
    try {
      const next = await bridgeRequest<{ messageQueue: QueuedMessage[] }>(
        bridgeUrl,
        token,
        '/api/remote/queue/remove',
        {
          method: 'POST',
          body: { messageId },
        },
      );
      setRemote((current) => current ? {
        ...current,
        messageQueue: next.messageQueue,
      } : current);
      announce('Queued message removed.');
      await Haptics.selectionAsync();
    } catch (error) {
      handleActionError(error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoadingAction(null);
    }
  }, [announce, bridgeUrl, handleActionError, requireBridge, token]);

  const handleJoystickDirection = useCallback(async (direction: JoystickDirection) => {
    const actionId = {
      up: 'PLAN',
      right: 'FORWARD',
      down: 'SIDEBAR',
      left: 'BACK',
    }[direction];
    if (!requireActionAvailable(actionId)) return;
    switch (direction) {
      case 'up':
        await remoteAction(
          '/api/desktop/action',
          { action: 'plan' },
          'plan',
          'Plan Mode toggled on the desktop.',
        );
        return;
      case 'right':
        await remoteAction(
          '/api/desktop/action',
          { action: 'forward' },
          'forward',
          'Moved forward in Codex history.',
        );
        return;
      case 'down':
        await remoteAction(
          '/api/desktop/action',
          { action: 'sidebar' },
          'sidebar',
          'Codex sidebar toggled.',
        );
        return;
      case 'left':
        await remoteAction(
          '/api/desktop/action',
          { action: 'back' },
          'back',
          'Moved back in Codex history.',
        );
    }
  }, [remoteAction, requireActionAvailable]);

  const resolveApproval = useCallback(async (decision: 'approve' | 'decline') => {
    if (!requireActionAvailable(decision === 'approve' ? 'APPR' : 'REJ')) return;
    await remoteAction(
      '/api/remote/approval',
      { decision },
      decision === 'approve' ? 'approve' : 'decline',
      decision === 'approve' ? 'Codex request approved.' : 'Codex request declined.',
    );
  }, [remoteAction, requireActionAvailable]);

  const forkCurrentTask = useCallback(async () => {
    if (!requireActionAvailable('SPLIT')) return;
    if (!activeThread) {
      announce('Select a Codex task first.', true);
      return;
    }
    await remoteAction(
      '/api/remote/fork',
      { threadId: activeThread.id },
      'fork',
      'Continued in a new Codex task.',
    );
  }, [activeThread, announce, remoteAction, requireActionAvailable]);

  const activityLabel = loadingAction
    ? ACTION_PROGRESS[loadingAction] ?? 'Sending command'
    : activeMeta.label;
  const statusIcon = STATUS_ICON[activeAgent.status];

  // The deck reports activity in the one selected chat. It is dark at rest:
  // thinking pulses, needs-input/error stay visible, and complete flashes once.
  const micLight: MicLight = dictationActive
    ? 'recording'
    : loadingAction === 'dictation'
      ? 'processing'
      : 'off';
  const persistentStatusLight =
    activeAgent.status === 'thinking' ||
    activeAgent.status === 'waiting' ||
    activeAgent.status === 'error';
  const hardwareActionRunning = Boolean(status) && Boolean(loadingAction);
  const statusLit =
    Boolean(status) &&
    Boolean(activeThread) &&
    Boolean(
      persistentStatusLight ||
      completionLight ||
      hardwareActionRunning ||
      hardwareFeedbackColor,
    );
  const ledColor = micLight !== 'off'
    ? LED_RECORDING
    : hardwareFeedbackColor
      ?? (hardwareActionRunning
        ? LED.thinking
        : completionLight
          ? LED.complete
          : LED[activeAgent.status]);
  const deckLightsOn = statusLit || (Boolean(status) && micLight !== 'off');
  const deckLightPulses =
    hardwareActionRunning ||
    (statusLit && hardwareFeedbackColor == null && activeAgent.status === 'thinking');

  const renderProgrammedKey = (slotIndex: number) => {
    const programmed = programmedKeys[slotIndex];
    const actionId = programmedActionId(programmed);
    const action = findMicroAction(actionId);
    const isMic = action?.id === 'composer.startDictation';
    const reason = action ? unavailableReason(action.id) : undefined;
    const running = loadingAction === `programmable-${slotIndex}`;
    const resultLight = keyResultLights[slotIndex];
    const glowColor = isMic && dictationActive
      ? LED_RECORDING
      : running
        ? LED.thinking
        : resultLight;

    return (
      <HardwareKey
        accessibilityLabel={
          action
            ? `${action.label}, key ${slotIndex + 1}, active chat only`
            : programmed
              ? `Key ${slotIndex + 1}, choose a command`
              : `Program empty key ${slotIndex + 1}`
        }
        variant="rgb"
        // Icon only, like the physical caps. The command name lives in the
        // accessibility label and in the editor, not printed on the key.
        symbol={
          actionId ? (
            <CodexCommandGlyph actionId={actionId} size={24} color={skeuo.icon} />
          ) : (
            <CentralIcon name="plus" size={22} color={skeuo.icon} />
          )
        }
        phase={slotIndex / 6}
        active={Boolean(glowColor)}
        glowColor={glowColor}
        unavailableReason={reason}
        disabled={
          running ||
          (isMic && loadingAction === 'dictation')
        }
        onPress={
          isMic
              ? undefined
              : action
                ? () => void runProgrammedKey(slotIndex)
              : () => openKeyEditor(slotIndex)
        }
        onPressIn={isMic ? handleDictationPressIn : undefined}
        onPressOut={isMic ? handleDictationPressOut : undefined}
        onDoublePress={isMic ? handleDictationDoublePress : undefined}
        onLongPress={isMic ? undefined : () => openKeyEditor(slotIndex)}
      />
    );
  };

  const copyCommandButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={commandCopied ? 'Command copied' : 'Copy bridge command'}
      onPress={() => void copyInstallCommand()}
      style={({ pressed }) => [
        styles.gateCopyButton,
        commandCopied && styles.gateCopyButtonDone,
        pressed && styles.gateButtonPressed,
      ]}>
      <CentralIcon
        name={commandCopied ? 'check' : 'copy'}
        size={15}
        color={commandCopied ? theme.online : theme.textMuted}
      />
      {commandCopied ? <Text style={styles.gateCopyButtonLabel}>Copied</Text> : null}
    </Pressable>
  );

  return (
      <View style={styles.screen}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {!status ? null : (
          <>
            <View style={styles.ambientBlue} />
            <View style={styles.ambientGreen} />
          </>
        )}
        {!status ? (
          <View style={styles.connectionGate}>
            <View style={[styles.gateBrandBar, { paddingTop: Math.max(insets.top, 14) }]}>
              <View style={styles.gateBrandMark}>
                <CodexMicroGlyph keycapId="CODEX" size={13} color={theme.bg} />
              </View>
              <Text style={styles.gateBrandName}>Microdex</Text>
            </View>
            <ScrollView
              style={styles.screenBody}
              contentContainerStyle={[
                styles.connectionGateContent,
                { paddingBottom: Math.max(insets.bottom, 24) },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {!credentialsReady || (bridgeConnecting && Boolean(token.trim())) ? (
                <View style={[styles.gateContent, styles.gateContentCentered]}>
                  <ActivityIndicator size="small" color={theme.textMuted} />
                  <Text style={styles.gateStateTitle}>
                    {credentialsReady ? 'Connecting to your Mac' : 'Opening Microdex'}
                  </Text>
                  <Text style={styles.gateStateBody}>
                    {credentialsReady
                      ? 'Checking the secure bridge and your Codex session.'
                      : 'Loading your saved pairing securely.'}
                  </Text>
                </View>
              ) : token.trim() ? (
                <View style={styles.gateContent}>
                  <View style={styles.gateHero}>
                    <Text style={styles.gateTitle}>Mac unavailable</Text>
                    <Text style={styles.gateTitleMono}>bridge not reachable</Text>
                  </View>
                  <Text style={styles.gateNote}>
                    Open Codex, then run the Microdex bridge on the Mac you paired with.
                  </Text>

                  <View style={styles.gateCommandRow}>
                    <Text style={styles.gatePrompt}>$</Text>
                    <Text selectable style={styles.gateCommandText}>
                      npx microdex-cli@latest setup
                    </Text>
                    {copyCommandButton}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    disabled={bridgeConnecting}
                    onPress={() => void connectToBridge(bridgeUrl, token, true)}
                    style={({ pressed }) => [
                      styles.gatePrimaryButton,
                      pressed && styles.gateButtonPressed,
                    ]}>
                    {bridgeConnecting ? (
                      <ActivityIndicator size="small" color={theme.bg} />
                    ) : (
                      <CentralIcon name="refresh" size={17} color={theme.bg} />
                    )}
                    <Text style={styles.gatePrimaryButtonText}>Retry connection</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void openPairingScanner()}
                    style={({ pressed }) => [
                      styles.gateSecondaryButton,
                      pressed && styles.gateButtonPressed,
                    ]}>
                    <CentralIcon name="qrCode" size={17} color={theme.text} />
                    <Text style={styles.gateSecondaryButtonText}>Pair another Mac</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void forgetPairedMac()}
                    style={({ pressed }) => [
                      styles.gateTertiaryButton,
                      pressed && styles.gateButtonPressed,
                    ]}>
                    <Text style={styles.gateTertiaryButtonText}>Forget this Mac</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.gateContent}>
                  <View style={styles.gateHero}>
                    <Text style={styles.gateTitle}>Control Codex</Text>
                    <Text style={styles.gateTitleMono}>from your phone</Text>
                  </View>

                  <View style={styles.gateSteps}>
                    <View style={styles.gateStep}>
                      <Text style={styles.gateStepMarker}>01</Text>
                      <View style={styles.gateStepCopy}>
                        <Text style={styles.gateStepTitle}>Start the Mac bridge</Text>
                        <Text style={styles.gateStepBody}>
                          Paste this in Terminal and leave the window open.
                        </Text>

                        <View style={styles.gateCommandRow}>
                          <Text style={styles.gatePrompt}>$</Text>
                          <Text selectable style={styles.gateCommandText}>
                            npx microdex-cli@latest setup
                          </Text>
                          {copyCommandButton}
                        </View>
                      </View>
                    </View>

                    <View style={styles.gateStep}>
                      <Text style={styles.gateStepMarker}>02</Text>
                      <View style={styles.gateStepCopy}>
                        <Text style={styles.gateStepTitle}>Scan the pairing QR</Text>
                        <Text style={styles.gateStepBody}>
                          The one-time code appears in Terminal after setup.
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.gateStep, styles.gateStepLast]}>
                      <Text style={styles.gateStepMarker}>03</Text>
                      <View style={styles.gateStepCopy}>
                        <Text style={styles.gateStepTitle}>Play with the keyboard</Text>
                        <Text style={styles.gateStepBody}>
                          Twelve keys, a joystick and a dial to drive Codex.
                        </Text>

                        <View style={styles.gateKeyPreview}>
                          {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => (
                            <View
                              key={slot}
                              style={[
                                styles.gatePreviewKey,
                                slot === 4 && styles.gatePreviewDial,
                              ]}
                            />
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void openPairingScanner()}
                    style={({ pressed }) => [
                      styles.gatePrimaryButton,
                      pressed && styles.gateButtonPressed,
                    ]}>
                    <CentralIcon name="qrCode" size={17} color={theme.bg} />
                    <Text style={styles.gatePrimaryButtonText}>Scan pairing code</Text>
                  </Pressable>

                  <Text style={styles.gateFootnote}>Login and projects stay on your Mac</Text>
                </View>
              )}
            </ScrollView>
          </View>
        ) : (
        <>
        <View style={styles.screenBody}>
        <ScrollView
          ref={mainScrollRef}
          style={styles.screenBody}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 18),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {activeThread?.project ?? 'CODEX REMOTE'}
            </Text>
            <Text style={styles.title}>Microdex</Text>
          </View>
          <View style={styles.headerControls}>
            <View style={[styles.threadSwitcher, !status && styles.threadSwitcherDisabled]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Codex chat switcher"
                disabled={!status || !remote?.threads.length}
                onPress={openChatSwitcher}
                style={({ pressed }) => [
                  styles.threadSwitcherMain,
                  pressed && styles.threadSwitcherPressed,
                ]}>
                <CentralIcon
                  name="chat"
                  size={14}
                  color={theme.textMuted}
                />
                <Text style={styles.threadSwitcherText}>
                  {activeThreadIndex >= 0 ? activeThreadIndex + 1 : '–'}/{remote?.threads.length ?? 0}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch to next Codex chat"
                disabled={!status || (remote?.threads.length ?? 0) < 2 || loadingAction === 'select'}
                onPress={cycleRemoteThread}
                style={({ pressed }) => [
                  styles.threadSwitcherNext,
                  pressed && styles.threadSwitcherPressed,
                ]}>
                {loadingAction === 'select' ? (
                  <ActivityIndicator size="small" color={theme.textMuted} />
                ) : (
                  <CentralIcon name="chevronRight" size={17} color={theme.textMuted} />
                )}
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onPress={() => {
                setMode(mode === 'dark' ? 'light' : 'dark');
                void Haptics.selectionAsync();
              }}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}>
              <CentralIcon
                name={mode === 'dark' ? 'sun' : 'moon'}
                size={17}
                color={theme.text}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Microdex settings"
              onPress={() => setSettingsVisible(true)}
              style={({ pressed }) => [styles.statusButton, pressed && styles.iconButtonPressed]}>
              <CentralIcon name="settings" size={18} color={theme.text} />
              <View
                style={[
                  styles.headerStatusDot,
                  {
                    backgroundColor:
                      liveChannel === 'live' ? theme.online : theme.syncing,
                  },
                ]}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.deviceGlow}>
          <ShellPool />
          <RaisedShell style={styles.device} contentStyle={styles.deviceInner} radius={28}>
            <DeckLighting
              color={ledColor}
              pulse={deckLightPulses}
              mic={micLight}
              intensity={deckLightsOn ? 1 : 0}
            />
            <Screw style={styles.screwTopLeft} />
            <Screw style={styles.screwTopRight} />
            <Screw style={styles.screwBottomLeft} />
            <Screw style={styles.screwBottomRight} />

            <Text style={styles.frameMarkTop} pointerEvents="none">↑</Text>
            <View style={styles.sideLabelLeftWrap} pointerEvents="none">
              <Text style={styles.sideLabelLeft} numberOfLines={1}>
                WORK LOUDER | OPENAI 2026
              </Text>
            </View>
            <View style={styles.sideLabelRightWrap} pointerEvents="none">
              <Text style={styles.sideLabelRight} numberOfLines={1}>
                You can just build things
              </Text>
            </View>

            <View style={[styles.hardwareArea, !status && styles.hardwareOffline]}>
              <View style={styles.fourRow}>
                <View style={styles.squareSlot}>
                  <ReasoningDial
                    mode={encoderMode}
                    label={
                      encoderMode === 'reasoning'
                        ? supportedReasoningEfforts[dialIndex]
                        : encoderMode === 'composer-navigation'
                          ? 'NAV'
                          : 'SCROLL'
                    }
                    index={dialIndex}
                    maxIndex={supportedReasoningEfforts.length - 1}
                    onPreview={previewReasoning}
                    onCommit={(index) => void commitReasoning(index)}
                    onStep={(delta, steps) => sendEncoderAction('step', delta, steps)}
                    onPress={() => {
                      if (encoderMode === 'composer-navigation') {
                        sendEncoderAction('press');
                      }
                    }}
                    onLongPress={() => {
                      setSettingsVisible(true);
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    }}
                  />
                </View>
                <View style={styles.squareSlot}>{renderProgrammedKey(0)}</View>
                <View style={styles.squareSlot}>{renderProgrammedKey(1)}</View>
                <View style={styles.squareSlot}>
                  <Joystick
                    onDirection={(direction) => void handleJoystickDirection(direction)}
                  />
                </View>
              </View>

              <View style={styles.fourRow}>
                {[2, 3, 4, 5].map((slotIndex) => (
                  <View key={slotIndex} style={styles.squareSlot}>
                    {renderProgrammedKey(slotIndex)}
                  </View>
                ))}
              </View>

              <View style={styles.fourRow}>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Toggle Fast Mode"
                    symbol={<CodexMicroGlyph keycapId="FAST" color={skeuo.icon} />}
                    unavailableReason={unavailableReason('FAST')}
                    disabled={loadingAction === 'fast'}
                    onPress={() => void toggleFast()}
                  />
                </View>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Approve current request"
                    symbol={<CodexMicroGlyph keycapId="APPR" color={skeuo.icon} />}
                    unavailableReason={unavailableReason('APPR')}
                    disabled={loadingAction === 'approve'}
                    active={Boolean(remote?.pendingApproval)}
                    glowColor={remote?.pendingApproval ? LED.waiting : undefined}
                    onPress={() => void resolveApproval('approve')}
                  />
                </View>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Decline current request"
                    symbol={<CodexMicroGlyph keycapId="REJ" color={skeuo.icon} />}
                    unavailableReason={unavailableReason('REJ')}
                    disabled={loadingAction === 'decline'}
                    onPress={() => void resolveApproval('decline')}
                  />
                </View>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Continue in a new chat"
                    symbol={<CodexMicroGlyph keycapId="SPLIT" color={skeuo.icon} />}
                    unavailableReason={unavailableReason('SPLIT')}
                    disabled={loadingAction === 'fork'}
                    onPress={() => void forkCurrentTask()}
                  />
                </View>
              </View>

              <View style={styles.bottomRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open bridge settings"
                  onPress={() => setSettingsVisible(true)}
                  style={({ pressed }) => [styles.touchModule, pressed && styles.touchPressed]}>
                  <View style={styles.ledStack}>
                    <View
                      style={[
                        styles.miniLed,
                        {
                          backgroundColor:
                            hardwareActionRunning || activeAgent.status === 'thinking'
                              ? LED.thinking
                              : theme.borderStrong,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.miniLed,
                        {
                          backgroundColor:
                            completionLight ||
                            hardwareFeedbackColor === LED.complete ||
                            dictationActive
                              ? LED.complete
                              : theme.borderStrong,
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.miniLed,
                        {
                          backgroundColor:
                            noticeError ||
                            hardwareFeedbackColor === LED.error ||
                            activeAgent.status === 'error'
                              ? LED.error
                              : theme.borderStrong,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.touchRing}>
                    <View style={styles.touchRingGlint} />
                    <View style={styles.touchCenter} />
                  </View>
                </Pressable>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Push to talk"
                    symbol={<CodexMicroGlyph keycapId="MIC" color={skeuo.icon} />}
                    active={dictationActive}
                    glowColor={dictationActive ? LED_RECORDING : undefined}
                    unavailableReason={unavailableReason('MIC')}
                    disabled={loadingAction === 'dictation'}
                    onPressIn={handleDictationPressIn}
                    onPressOut={handleDictationPressOut}
                    onDoublePress={handleDictationDoublePress}
                  />
                </View>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel={
                      voiceActive
                        ? `${voiceMuted ? 'Unmute' : 'Mute'} Voice Chat microphone; hold to end`
                        : 'Start Voice Chat on the Mac'
                    }
                    symbol={<CodexVoiceGlyph color={skeuo.icon} />}
                    active={voiceActive || voiceState === 'setup' || voiceState === 'launching'}
                    glowColor={
                      voiceActive || voiceState === 'setup' || voiceState === 'launching'
                        ? LED_VOICE
                        : undefined
                    }
                    disabled={loadingAction === 'voice'}
                    onPress={() => void handleVoicePress()}
                    onLongPress={() => void handleVoiceLongPress()}
                  />
                </View>
                <View style={styles.squareSlot}>
                  <HardwareKey
                    accessibilityLabel="Send message"
                    symbol={<CodexMicroGlyph keycapId="CODEX" color={skeuo.icon} />}
                    unavailableReason={unavailableReason('CODEX')}
                    disabled={loadingAction === 'send'}
                    onPress={openRemoteComposer}
                  />
                </View>
              </View>
              {status ? (
                <Text style={styles.buildLabel}>LET&apos;S BUILD.</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Connect your Mac to Codex Micro"
                  onPress={() => setSettingsVisible(true)}
                  style={({ pressed }) => [styles.buildLink, pressed && styles.buildLinkPressed]}>
                  <CentralIcon name="link" size={12} color={skeuo.accent} />
                  <Text style={styles.buildLinkText}>CONNECT YOUR MAC</Text>
                </Pressable>
              )}
            </View>
          </RaisedShell>
        </View>

        {composerVisible ? (
        <GestureDetector gesture={homeFlingLeft}>
        <View style={styles.composerPanel}>
          <View style={styles.composerHeader}>
            <View style={styles.composerIdentity}>
              <View style={styles.composerChatIcon}>
                <CentralIcon name="chat" size={16} color={theme.online} />
              </View>
              <View style={styles.composerIdentityText}>
                <Text style={styles.composerKicker}>Chat to Codex</Text>
                <Text style={styles.composerTitle} numberOfLines={1}>{activeAgent.name}</Text>
              </View>
            </View>
            <View style={styles.composerStatusTail}>
              {loadingAction ? (
                <ActivityIndicator size="small" color={theme.textMuted} />
              ) : statusIcon ? (
                <CentralIcon
                  name={statusIcon}
                  size={13}
                  color={activeMeta.textColor}
                />
              ) : (
                <View style={[styles.composerStatusDot, { backgroundColor: activeMeta.color }]} />
              )}
              <Text
                style={[
                  styles.composerStatusText,
                  { color: loadingAction ? theme.textMuted : activeMeta.textColor },
                ]}
                numberOfLines={1}>
                {activityLabel}
              </Text>
            </View>
          </View>

          <View style={styles.composerBox}>
            <CentralIcon
              name="chat"
              size={18}
              color={theme.textFaint}
              style={styles.composerLeadingIcon}
            />
            <TextInput
              ref={composerRef}
              autoCapitalize="sentences"
              multiline
              value={draft}
              onChangeText={setDraft}
              onFocus={revealRemoteComposer}
              placeholder={status ? 'Message Codex…' : 'Connect your Mac to write'}
              placeholderTextColor={theme.textFaint}
              editable={Boolean(status)}
              style={styles.composerInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send the message to Codex on your Mac"
              disabled={!status || !draft.trim() || loadingAction === 'send'}
              onPress={() => void sendDraft()}
              style={({ pressed }) => [
                styles.sendButton,
                (!status || !draft.trim() || loadingAction === 'send') && styles.sendButtonDisabled,
                pressed && styles.sendButtonPressed,
              ]}>
              {loadingAction === 'send' ? (
                <ActivityIndicator size="small" color={theme.accentText} />
              ) : (
                <CentralIcon name="arrowUp" size={20} color={theme.accentText} />
              )}
            </Pressable>
          </View>

          {activeMessageQueue.length ? (
            <View style={styles.queueWrap}>
              <Text style={styles.queueLabel}>QUEUED · {activeMessageQueue.length}</Text>
              {activeMessageQueue.map((message) => {
                const removing = loadingAction === `queue-${message.id}`;
                const sending = message.status === 'sending';
                return (
                  <View key={message.id} style={styles.queueRow}>
                    {sending ? (
                      <ActivityIndicator size="small" color={theme.online} style={styles.queueSpinner} />
                    ) : (
                      <View
                        style={[
                          styles.queueDotMark,
                          { backgroundColor: message.error ? theme.danger : theme.textFaint },
                        ]}
                      />
                    )}
                    <Text style={styles.queueText} numberOfLines={1}>{message.text}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove message from queue"
                      disabled={sending || removing}
                      onPress={() => void removeQueuedMessage(message.id)}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.queueRemove,
                        (sending || removing) && styles.queueRemoveDisabled,
                        pressed && styles.queueRemovePressed,
                      ]}>
                      {removing ? (
                        <ActivityIndicator size="small" color={theme.danger} />
                      ) : (
                        <CentralIcon name="close" size={15} color={theme.textFaint} />
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={styles.composerFooter}>
            <Text style={styles.composerMeta}>
              {activeThread?.fastMode ? 'Fast' : 'Standard'} · {supportedReasoningEfforts[dialIndex]}
            </Text>
            <View style={styles.composerRoute}>
              <CentralIcon name="output" size={12} color={theme.textFaint} />
              <Text style={styles.composerMeta}>OUTPUT ON MAC</Text>
            </View>
          </View>

          {noticeError ? (
            <View style={[styles.notice, styles.noticeError, styles.composerNotice]}>
              <CentralIcon name="alert" size={16} color={theme.dangerText} />
              <Text style={[styles.noticeText, styles.noticeTextError]}>{notice}</Text>
            </View>
          ) : null}
        </View>
        </GestureDetector>
        ) : null}
      </ScrollView>
        </View>

      <GestureDetector gesture={homeEdgeOpen}>
        <View
          collapsable={false}
          style={styles.edgeSwipeZone}
          accessibilityLabel="Swipe right to open chats"
        />
      </GestureDetector>

      <ChatDrawer
        ref={chatDrawerRef}
        activeThreadId={activeThread?.id ?? null}
        loadingAction={loadingAction}
        liveStatusPulse={liveStatusPulse}
        onArchive={archiveRemoteThread}
        onArchiveProject={archiveRemoteProject}
        onSelect={(threadId) => void switchRemoteThread(threadId)}
        theme={theme}
        threads={remote?.threads ?? []}
      />
        </>
        )}

      <Modal
        visible={keyManagerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setKeyManagerVisible(false)}>
        <GestureHandlerRootView style={styles.modalGestureRoot}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setKeyManagerVisible(false)} />
          <DismissibleSheet
            open={keyManagerVisible}
            onDismiss={() => setKeyManagerVisible(false)}
            style={[
              styles.sheet,
              styles.keyManagerSheet,
              { paddingBottom: Math.max(insets.bottom, 18) + 12 },
            ]}
            header={
              <>
                <SheetHandlePill color={theme.borderStrong} />
                <View style={styles.sheetTitleRow}>
                  <View>
                    <Text style={styles.sheetKicker}>YOUR MICRODEX</Text>
                    <Text style={styles.sheetTitle}>Customize keys</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Close key manager"
                    onPress={() => setKeyManagerVisible(false)}
                    style={styles.closeButton}>
                    <CentralIcon name="close" size={20} color={theme.text} />
                  </Pressable>
                </View>
              </>
            }>
            <Text style={styles.sheetBody}>
              Choose an empty key or replace an existing one. Use the trash button to remove an
              assignment and turn it back into an empty programmable key.
            </Text>
            <View style={styles.keyManagerGrid}>
              {programmedKeys.map((programmed, slotIndex) => {
                const actionId = programmedActionId(programmed);
                const action = findMicroAction(actionId);
                return (
                  <View key={slotIndex} style={styles.keyManagerCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        action
                          ? `Change key ${slotIndex + 1}, currently ${action.label}`
                          : `Choose action for key ${slotIndex + 1}`
                      }
                      onPress={() => {
                        setKeyManagerVisible(false);
                        openKeyEditor(slotIndex);
                      }}
                      style={({ pressed }) => [
                        styles.keyManagerChoice,
                        pressed && styles.actionCardPressed,
                      ]}>
                      <View style={[styles.keyManagerIcon, !action && styles.keyManagerIconEmpty]}>
                        {actionId ? (
                          <CodexCommandGlyph
                            actionId={actionId}
                            size={24}
                            color={action ? theme.text : theme.blue}
                          />
                        ) : (
                          <CentralIcon name="plus" size={24} color={theme.blue} />
                        )}
                      </View>
                      <Text style={styles.keyManagerSlot}>KEY {slotIndex + 1}</Text>
                      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.keyManagerLabel}>
                        {action?.label ?? (programmed ? 'Choose command' : 'Choose action')}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove key ${slotIndex + 1}`}
                      disabled={!programmed}
                      onPress={() => void removeProgrammedKey(slotIndex)}
                      style={({ pressed }) => [
                        styles.removeKeyButton,
                        !programmed && styles.removeKeyButtonDisabled,
                        pressed && styles.removeKeyButtonPressed,
                      ]}>
                      <CentralIcon name="trash" size={16} color={theme.danger} />
                      <Text style={styles.removeKeyText}>REMOVE</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </DismissibleSheet>
        </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={editingSlot !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingSlot(null)}>
        <GestureHandlerRootView style={styles.modalGestureRoot}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingSlot(null)} />
          <DismissibleSheet
            open={editingSlot != null}
            onDismiss={() => setEditingSlot(null)}
            style={[
              styles.sheet,
              styles.catalogSheet,
              { paddingBottom: Math.max(insets.bottom, 14) + 8 },
            ]}
            header={
              <>
                <SheetHandlePill color={theme.borderStrong} />
                <View style={styles.sheetTitleRow}>
                  <View>
                    <Text style={styles.sheetKicker}>PROGRAMMABLE KEY</Text>
                    <Text style={styles.sheetTitle}>
                      Choose key {editingSlot === null ? '' : editingSlot + 1}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Close key catalog"
                    onPress={() => setEditingSlot(null)}
                    style={styles.closeButton}>
                    <CentralIcon name="close" size={20} color={theme.text} />
                  </Pressable>
                </View>
              </>
            }>
            <Text style={styles.sheetBody}>
              Choose any Codex function. Its icon stays the same here, in the
              key manager, and on your Microdex key.
            </Text>
            <View style={styles.searchWrap}>
              <CentralIcon name="search" size={18} color={theme.textFaint} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={actionSearch}
                onChangeText={setActionSearch}
                placeholder="Search all Codex functions"
                placeholderTextColor={theme.textFaint}
                style={styles.searchInput}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.actionCatalog}>
              {filteredActions.map((action) => {
                const selected = chosenActionId === action.id;
                return (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setChosenActionId(action.id);
                      if (!action.custom) setCustomPrompt('');
                      void Haptics.selectionAsync();
                    }}
                    style={({ pressed }) => [
                      styles.actionRow,
                      pressed && styles.actionRowPressed,
                    ]}>
                    <View style={styles.actionRowIcon}>
                      <CodexCommandGlyph
                        actionId={action.id}
                        size={21}
                        color={selected ? theme.text : theme.textMuted}
                      />
                    </View>
                    <View style={styles.actionCopy}>
                      <View style={styles.actionTitleRow}>
                        <Text
                          style={[styles.actionTitle, selected && styles.actionTitleSelected]}
                          numberOfLines={1}>
                          {action.label}
                        </Text>
                        <Text style={styles.actionCategory}>{action.category}</Text>
                      </View>
                      <Text style={styles.actionDescription} numberOfLines={1}>
                        {action.description}
                      </Text>
                    </View>
                    <View style={styles.actionCheck}>
                      {selected ? (
                        <CentralIcon name="check" size={18} color={theme.text} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            {chosenAction?.custom ? (
              <TextInput
                autoCapitalize="sentences"
                multiline
                value={customPrompt}
                onChangeText={setCustomPrompt}
                placeholder="Example: Review the current changes and fix the tests."
                placeholderTextColor={theme.textFaint}
                style={[styles.input, styles.customPromptInput]}
              />
            ) : null}
            <View style={styles.editorButtons}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void clearProgrammedKey()}
                style={({ pressed }) => [styles.clearButton, pressed && styles.guideButtonPressed]}>
                <CentralIcon name="trash" size={18} color={theme.textMuted} />
                <Text style={styles.clearButtonText}>CLEAR</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!chosenAction}
                onPress={() => void saveProgrammedKey()}
                style={({ pressed }) => [
                  styles.saveKeyButton,
                  !chosenAction && styles.saveKeyButtonDisabled,
                  pressed && styles.connectButtonPressed,
                ]}>
                <Text style={styles.connectButtonText}>SAVE KEY</Text>
                <CentralIcon name="check" size={20} color={theme.accentText} />
              </Pressable>
            </View>
          </DismissibleSheet>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={guideVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuideVisible(false)}>
        <GestureHandlerRootView style={styles.modalGestureRoot}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setGuideVisible(false)} />
          <DismissibleSheet
            open={guideVisible}
            onDismiss={() => setGuideVisible(false)}
            style={[
              styles.sheet,
              styles.guideSheet,
              { paddingBottom: Math.max(insets.bottom, 14) + 8 },
            ]}
            header={
              <>
                <SheetHandlePill color={theme.borderStrong} />
                <View style={styles.sheetTitleRow}>
                  <View>
                    <Text style={styles.sheetKicker}>CODEX MICRO CONTROLS</Text>
                    <Text style={styles.sheetTitle}>What every control does</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Close key guide"
                    onPress={() => setGuideVisible(false)}
                    style={styles.closeButton}>
                    <CentralIcon name="close" size={20} color={theme.text} />
                  </Pressable>
                </View>
              </>
            }>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.guideContent}>
              <GuideItem
                styles={styles}
                theme={theme}
                icon="tune-variant"
                title="Three-mode dial"
                body="Choose Effort, Navigate, or Scroll in Settings. Rotate to adjust or move, tap to select in Navigate mode, and hold for 500 ms to reopen Settings."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                icon="plus-circle-outline"
                title="Six programmable keys"
                body="All six keys act on the currently selected chat. Choose a printed keycap label and assign its command separately."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                icon="gamepad-round-outline"
                title="Joystick"
                body="Up toggles Plan Mode, right moves forward, down shows or hides the sidebar, and left moves back."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                actionId="composer.toggleFastMode"
                title="Fast"
                body="Switches Fast Mode for the active Codex task. It responds faster and can use credits at a higher rate."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                icon="check-circle-outline"
                title="Approve and Reject"
                body="These only answer a request currently displayed by Codex, such as permission to run an important command. Approve allows it; Reject stops it."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                actionId="forkThread"
                title="Fork task"
                body="Creates a separate conversation from the current task so you can explore another direction without losing the original."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                actionId="composer.startDictation"
                title="Talk and Send"
                body="Hold Talk while speaking and release to stop. Double-press Talk to keep listening hands-free; press it once more to stop. Send submits the desktop composer."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                icon="waveform"
                title="Voice Chat"
                body="VOICE opens native Codex Voice Chat on the Mac. While it is live, tap to mute or unmute and hold to end. MIC remains desktop dictation. Audio never passes through the phone."
              />
              <GuideItem
                styles={styles}
                theme={theme}
                icon="label-outline"
                title="Official keycaps"
                body="Every printed cap from the tray has its official Codex default: GIT commits, PR opens a pull request, YOLO inserts :yolo:, and so on. You can still reassign any slot."
              />

              <View style={styles.guideSectionIntro}>
                <Text style={styles.guideSectionTitle}>Assignable keys</Text>
                <Text style={styles.guideSectionBody}>
                  These are the commands Microdex can execute. Open Customize keys, pick a
                  keycap from the tray artwork, confirm or change its command, and save.
                </Text>
              </View>
              {guideGroups.map((group) => (
                <View key={group.category} style={styles.guideGroup}>
                  <Text style={styles.guideGroupHeading}>{group.title.toUpperCase()}</Text>
                  {group.actions.map((action) => (
                    <GuideItem
                      key={action.id}
                      styles={styles}
                      theme={theme}
                      actionId={action.id}
                      title={action.label}
                      body={action.description}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          </DismissibleSheet>
        </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={settingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}>
        <GestureHandlerRootView style={styles.modalGestureRoot}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSettingsVisible(false)} />
          <DismissibleSheet
            open={settingsVisible}
            onDismiss={() => setSettingsVisible(false)}
            style={[styles.sheet, styles.settingsSheet, { paddingBottom: Math.max(insets.bottom, 18) + 12 }]}
            header={
              <>
                <SheetHandlePill color={theme.borderStrong} />
                <View style={styles.sheetTitleRow}>
                  <Text style={styles.sheetTitle}>Settings</Text>
                  <Pressable
                    accessibilityLabel="Close settings"
                    onPress={() => setSettingsVisible(false)}
                    style={styles.closeButton}>
                    <CentralIcon name="close" size={18} color={theme.text} />
                  </Pressable>
                </View>
              </>
            }>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.settingsContent}>
              <View style={styles.settingsGroup}>
                <Text style={styles.settingsGroupLabel}>Pairing</Text>
                <View style={styles.settingsCommandRow}>
                  <Text style={styles.settingsCommandPrompt}>$</Text>
                  <Text selectable style={styles.settingsCommandText}>
                    npx microdex-cli@latest setup
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={commandCopied ? 'Command copied' : 'Copy bridge command'}
                    onPress={() => void copyInstallCommand()}
                    style={({ pressed }) => [
                      styles.settingsCopyChip,
                      commandCopied && styles.settingsCopyChipDone,
                      pressed && styles.gateButtonPressed,
                    ]}>
                    <CentralIcon
                      name={commandCopied ? 'check' : 'copy'}
                      size={14}
                      color={commandCopied ? theme.online : theme.textMuted}
                    />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan computer pairing QR"
                  onPress={() => void openPairingScanner()}
                  style={({ pressed }) => [
                    styles.settingsPrimaryButton,
                    pressed && styles.gateButtonPressed,
                  ]}>
                  <CentralIcon name="qrCode" size={16} color={theme.bg} />
                  <Text style={styles.settingsPrimaryButtonText}>Scan pairing code</Text>
                </Pressable>
                {noticeError ? (
                  <View style={[styles.notice, styles.noticeError]}>
                    <CentralIcon name="alert" size={16} color={theme.dangerText} />
                    <Text style={[styles.noticeText, styles.noticeTextError]}>{notice}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.settingsGroup}>
                <Text style={styles.settingsGroupLabel}>Appearance</Text>
                <View style={styles.themeSegment}>
                  {(['light', 'dark'] as const).map((option) => {
                    const active = mode === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          setMode(option);
                          void Haptics.selectionAsync();
                        }}
                        style={[styles.themeSegmentOption, active && styles.themeSegmentOptionActive]}>
                        <CentralIcon
                          name={option === 'dark' ? 'moon' : 'sun'}
                          size={15}
                          color={active ? theme.text : theme.textMuted}
                        />
                        <Text style={[styles.themeSegmentText, active && styles.themeSegmentTextActive]}>
                          {option === 'dark' ? 'Dark' : 'Light'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.settingsGroup}>
                <Text style={styles.settingsGroupLabel}>Controller</Text>
                <Text style={styles.controllerFieldLabel}>Dial mode</Text>
                <View style={styles.encoderModeSegment}>
                  {([
                    ['reasoning', 'Effort'],
                    ['composer-navigation', 'Navigate'],
                    ['conversation-scroll', 'Scroll'],
                  ] as const).map(([option, label]) => {
                    const active = encoderMode === option;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => void changeEncoderMode(option)}
                        style={[
                          styles.encoderModeOption,
                          active && styles.encoderModeOptionActive,
                        ]}>
                        <Text
                          style={[
                            styles.encoderModeText,
                            active && styles.encoderModeTextActive,
                          ]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSettingsVisible(false);
                    setKeyManagerVisible(true);
                  }}
                  style={({ pressed }) => [styles.settingsLinkRow, pressed && styles.settingsLinkRowPressed]}>
                  <Text style={styles.settingsLinkTitle}>Customize keys</Text>
                  <CentralIcon name="chevronRight" size={18} color={theme.textFaint} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSettingsVisible(false);
                    setGuideVisible(true);
                  }}
                  style={({ pressed }) => [styles.settingsLinkRow, pressed && styles.settingsLinkRowPressed]}>
                  <Text style={styles.settingsLinkTitle}>Controls guide</Text>
                  <CentralIcon name="chevronRight" size={18} color={theme.textFaint} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy diagnostic report"
                  onPress={() => void copyDiagnostics()}
                  style={({ pressed }) => [styles.settingsLinkRow, pressed && styles.settingsLinkRowPressed]}>
                  <Text style={styles.settingsLinkTitle}>Copy diagnostics</Text>
                  <CentralIcon name="copy" size={16} color={theme.textFaint} />
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => void forgetPairedMac()}
                style={({ pressed }) => [
                  styles.settingsDangerLink,
                  pressed && styles.gateButtonPressed,
                ]}>
                <Text style={styles.settingsDangerLinkText}>Forget this Mac</Text>
              </Pressable>
            </ScrollView>
          </DismissibleSheet>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={scannerVisible}
        animationType="fade"
        onRequestClose={() => setScannerVisible(false)}>
        <View style={styles.scannerScreen}>
          {scannerVisible ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => void acceptPairingCode(data)}
            />
          ) : null}
          <View style={[styles.scannerHeader, { paddingTop: insets.top + 12 }]}>
            <Pressable
              accessibilityLabel="Close QR scanner"
              onPress={() => setScannerVisible(false)}
              style={styles.scannerClose}>
              <CentralIcon name="close" size={23} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.scannerTitle}>Scan your computer</Text>
            <View style={styles.scannerHeaderSpacer} />
          </View>
          <View style={styles.scannerFrame}>
            <View style={[styles.scannerCorner, styles.scannerCornerTopLeft]} />
            <View style={[styles.scannerCorner, styles.scannerCornerTopRight]} />
            <View style={[styles.scannerCorner, styles.scannerCornerBottomLeft]} />
            <View style={[styles.scannerCorner, styles.scannerCornerBottomRight]} />
          </View>
          <View style={[styles.scannerFooter, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.scannerHint}>
              Point the camera at the pairing QR shown by the Microdex bridge.
            </Text>
          </View>
        </View>
        </Modal>
      </View>
  );
}

function createStyles(theme: ThemePalette) {
  const skeuo = getSkeuo(theme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    screenBody: { flex: 1, backgroundColor: theme.bg },
    connectionGate: { flex: 1, backgroundColor: theme.bg },
    connectionGateContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 44,
    },
    gateBrandBar: {
      paddingHorizontal: 24,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    gateBrandMark: {
      width: 24,
      height: 24,
      borderRadius: 7,
      backgroundColor: theme.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gateBrandName: {
      fontFamily: Fonts.sansSemi,
      fontSize: 15,
      letterSpacing: -0.3,
      color: theme.text,
    },
    gateContent: {
      width: '100%', maxWidth: 430, alignSelf: 'stretch',
    },
    gateContentCentered: {
      flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80,
    },
    gateHero: {
      marginBottom: 34,
    },
    gateTitle: {
      fontFamily: Fonts.sansBold,
      fontSize: 34,
      lineHeight: 38,
      letterSpacing: -1.1,
      color: theme.text,
    },
    gateTitleMono: {
      marginTop: 2,
      fontFamily: Fonts.mono,
      fontSize: 25,
      lineHeight: 33,
      letterSpacing: 0.2,
      color: theme.textFaint,
    },
    gateNote: {
      marginBottom: 4,
      fontFamily: Fonts.sans,
      fontSize: 14,
      lineHeight: 21,
      color: theme.textMuted,
    },
    gateStateTitle: {
      fontFamily: Fonts.sansSemi,
      fontSize: 17,
      letterSpacing: -0.3,
      color: theme.text,
    },
    gateStateBody: {
      maxWidth: 280,
      textAlign: 'center',
      fontFamily: Fonts.sans,
      fontSize: 13.5,
      lineHeight: 20,
      color: theme.textMuted,
    },
    gateSteps: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    gateStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      paddingVertical: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    gateStepLast: {
      borderBottomWidth: 0,
    },
    gateStepMarker: {
      width: 20,
      paddingTop: 4,
      fontFamily: Fonts.monoMedium,
      fontSize: 11,
      letterSpacing: 0.6,
      color: theme.textFaint,
    },
    gateStepCopy: { flex: 1, minWidth: 0 },
    gateStepTitle: {
      fontFamily: Fonts.sansSemi,
      fontSize: 16,
      lineHeight: 21,
      letterSpacing: -0.2,
      color: theme.text,
    },
    gateStepBody: {
      marginTop: 4,
      maxWidth: 290,
      fontFamily: Fonts.sans,
      fontSize: 13.5,
      lineHeight: 20,
      color: theme.textMuted,
    },
    gateKeyPreview: {
      marginTop: 14,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      maxWidth: 208,
    },
    gatePreviewKey: {
      width: 46,
      height: 28,
      borderRadius: 7,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    gatePreviewDial: {
      borderRadius: 14,
      backgroundColor: theme.surface,
    },
    gateCommandRow: {
      marginTop: 14,
      minHeight: 46,
      paddingLeft: 12,
      paddingRight: 6,
      paddingVertical: 6,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    gatePrompt: {
      fontFamily: Fonts.mono,
      fontSize: 12.5,
      color: theme.textFaint,
    },
    gateCommandText: {
      flex: 1,
      fontFamily: Fonts.mono,
      fontSize: 12.5,
      color: theme.text,
    },
    gateCopyButton: {
      minWidth: 34,
      height: 34,
      paddingHorizontal: 9,
      borderRadius: 9,
      backgroundColor: theme.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    gateCopyButtonDone: {
      backgroundColor: theme.mode === 'dark' ? 'rgba(16,163,127,0.22)' : 'rgba(16,163,127,0.12)',
    },
    gateCopyButtonLabel: {
      fontFamily: Fonts.sansSemi,
      fontSize: 12,
      color: theme.online,
    },
    gatePrimaryButton: {
      marginTop: 28,
      height: 50,
      borderRadius: 12,
      backgroundColor: theme.text,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    gatePrimaryButtonText: {
      fontFamily: Fonts.sansSemi,
      fontSize: 15,
      letterSpacing: -0.2,
      color: theme.bg,
    },
    gateSecondaryButton: {
      marginTop: 10,
      height: 50,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
    },
    gateSecondaryButtonText: {
      fontFamily: Fonts.sansSemi,
      fontSize: 15,
      letterSpacing: -0.2,
      color: theme.text,
    },
    gateTertiaryButton: {
      height: 44, marginTop: 4, alignItems: 'center', justifyContent: 'center',
    },
    gateTertiaryButtonText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 13,
      color: theme.dangerText,
    },
    gateButtonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
    gateFootnote: {
      marginTop: 16,
      fontFamily: Fonts.sans,
      fontSize: 12.5,
      color: theme.textFaint,
    },
    edgeSwipeZone: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 32,
      zIndex: 30,
      backgroundColor: 'transparent',
    },
    modalGestureRoot: { flex: 1 },
    ambientBlue: {
      position: 'absolute', width: 430, height: 430, borderRadius: 215, top: 120, left: -20,
      backgroundColor: 'rgba(255,255,255,0.035)',
    },
    ambientGreen: {
      position: 'absolute', width: 360, height: 360, borderRadius: 180, top: 300, left: -200,
      backgroundColor: 'rgba(16,163,127,0.025)',
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
      paddingHorizontal: 2,
      gap: 10,
    },
    headerTitleBlock: { flex: 1, minWidth: 0 },
    headerControls: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
    headerIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    headerStatusDot: {
      position: 'absolute',
      right: 8,
      top: 8,
      width: 7,
      height: 7,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: theme.surface,
    },
    eyebrow: {
      fontFamily: Fonts.monoMedium,
      fontSize: 8,
      letterSpacing: 1,
      color: theme.textFaint,
    },
    title: {
      fontFamily: Fonts.sansSemi,
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.4,
      fontWeight: '600',
      color: theme.text,
    },
    iconButton: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    iconButtonPressed: { opacity: 0.72, backgroundColor: theme.surfaceMuted },
    statusButton: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    statusRing: {
      position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, opacity: 0.45,
    },
    statusDot: { width: 9, height: 9, borderRadius: 5 },
    threadSwitcher: {
      height: 40,
      borderRadius: 20,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    threadSwitcherDisabled: { opacity: 0.45 },
    threadSwitcherMain: {
      paddingLeft: 10, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 5,
    },
    threadSwitcherNext: {
      width: 30, alignItems: 'center', justifyContent: 'center',
      borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border,
    },
    threadSwitcherPressed: { backgroundColor: theme.surfaceMuted },
    threadSwitcherText: {
      fontSize: 13, fontWeight: '500', letterSpacing: -0.2, color: theme.textMuted,
    },

    deviceGlow: {
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      marginTop: 10,
      marginBottom: 18,
      marginHorizontal: 0,
    },
    device: { aspectRatio: 1377 / 1394 },
    deviceInner: {
      paddingLeft: '11.8%',
      paddingRight: '11.8%',
      paddingTop: '9.5%',
      paddingBottom: '13.8%',
    },
    hardwareArea: { flex: 1, justifyContent: 'flex-start', gap: 5 },
    hardwareOffline: { opacity: 0.5 },
    fourRow: { flexDirection: 'row', justifyContent: 'space-between' },
    bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'stretch' },
    squareSlot: { width: '23.2%', aspectRatio: 1 },
    wideSlot: { width: '48.8%', aspectRatio: 2.1 },
    agentSlotGlyph: {
      fontSize: 13,
      fontWeight: '500',
      color: skeuo.iconMuted,
      opacity: 0.5,
    },
    screwTopLeft: { position: 'absolute', zIndex: 4, left: '7.8%', top: '6.4%' },
    screwTopRight: { position: 'absolute', zIndex: 4, right: '7.8%', top: '6.4%' },
    screwBottomLeft: { position: 'absolute', zIndex: 4, left: '7.8%', bottom: '6.8%' },
    screwBottomRight: { position: 'absolute', zIndex: 4, right: '7.8%', bottom: '6.8%' },
    frameMarkTop: {
      position: 'absolute',
      zIndex: 5,
      top: '4.2%',
      left: 0,
      right: 0,
      textAlign: 'center',
      color: '#111516',
      fontSize: 17,
      fontWeight: '300',
    },
    sideLabelLeftWrap: {
      position: 'absolute',
      left: -92,
      top: '50%',
      marginTop: -9,
      width: 200,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 5,
      transform: [{ rotate: '-90deg' }],
    },
    sideLabelLeft: {
      width: 200,
      textAlign: 'center',
      fontSize: 5.4,
      fontWeight: '500',
      letterSpacing: 0.48,
      color: '#111516',
    },
    sideLabelRightWrap: {
      position: 'absolute',
      right: -92,
      top: '50%',
      marginTop: -9,
      width: 200,
      height: 18,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 5,
      transform: [{ rotate: '90deg' }],
    },
    sideLabelRight: {
      width: 200,
      textAlign: 'center',
      fontSize: 5.4,
      fontWeight: '500',
      letterSpacing: 0.6,
      color: '#111516',
    },
    buildLabel: {
      marginTop: 5, textAlign: 'center', fontSize: 6, fontWeight: '600',
      letterSpacing: 0.25, color: '#111516',
    },
    buildLink: {
      marginTop: 6, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingVertical: 4, paddingHorizontal: 4,
    },
    buildLinkPressed: { opacity: 0.6 },
    buildLinkText: { fontSize: 7, fontWeight: '800', letterSpacing: 0.9, color: skeuo.accent },
    touchModule: {
      width: '23.2%', aspectRatio: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 5,
    },
    touchPressed: { transform: [{ scale: 0.97 }, { translateY: 1 }] },
    ledStack: { gap: 3.5 },
    miniLed: {
      width: 5.5, height: 4.5, borderRadius: 1, borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(0,0,0,0.25)',
      shadowColor: skeuo.rgb, shadowOffset: { width: 0, height: 0 },
      shadowRadius: 3, shadowOpacity: 0.6,
    },
    touchRing: {
      width: '56%', aspectRatio: 1, borderRadius: 999, backgroundColor: '#171B1E', borderWidth: 1.5,
      borderColor: '#050708', alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3, shadowRadius: 5, elevation: 6, overflow: 'hidden',
    },
    touchRingGlint: {
      position: 'absolute', top: '14%', left: '20%', width: '45%', height: '20%',
      borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)',
      transform: [{ rotate: '-24deg' }],
    },
    touchCenter: {
      width: '66%', aspectRatio: 1, borderRadius: 999, backgroundColor: '#050708',
      borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.06)',
    },

    composerPanel: {
      borderRadius: 24, padding: 16, backgroundColor: theme.surface, borderWidth: 1,
      borderColor: theme.border, marginTop: 18, marginBottom: 8,
      shadowColor: '#000000', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.mode === 'dark' ? 0.3 : 0.04, shadowRadius: 18, elevation: 2,
    },
    composerHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    },
    composerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    composerChatIcon: {
      width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
    },
    composerIdentityText: { flex: 1, minWidth: 0 },
    composerKicker: {
      fontSize: 11, fontWeight: '500', letterSpacing: -0.1, color: theme.textFaint,
    },
    composerStatusDot: { width: 8, height: 8, borderRadius: 4 },
    composerTitle: {
      marginTop: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.3, color: theme.text,
    },
    composerStatusTail: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '38%' },
    composerStatusText: {
      fontSize: 11, fontWeight: '500', letterSpacing: -0.1, textAlign: 'right',
    },
    composerClose: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
    },
    composerBox: {
      minHeight: 56, maxHeight: 130, marginTop: 14, borderRadius: 18, paddingLeft: 12,
      paddingRight: 6, paddingVertical: 6, backgroundColor: theme.surfaceInput, borderWidth: 1,
      borderColor: theme.surfaceInputBorder, flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    },
    composerLeadingIcon: { marginBottom: 12, marginLeft: 2 },
    composerInput: {
      flex: 1, minHeight: 42, maxHeight: 114, paddingTop: 10, paddingBottom: 10,
      fontSize: 15, lineHeight: 21, color: theme.text, textAlignVertical: 'top',
    },
    sendButton: {
      width: 40, height: 40, borderRadius: 14, backgroundColor: theme.accent,
      alignItems: 'center', justifyContent: 'center',
    },
    sendButtonDisabled: { backgroundColor: theme.surfaceMuted, opacity: 0.7 },
    sendButtonPressed: { transform: [{ scale: 0.95 }] },
    queueWrap: { marginTop: 12 },
    queueLabel: {
      fontSize: 10, fontWeight: '600', letterSpacing: 0.2, color: theme.textFaint, marginBottom: 4,
    },
    queueRow: {
      minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, paddingVertical: 6,
    },
    queueSpinner: { width: 20, alignItems: 'center' },
    queueDotMark: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 7 },
    queueText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '500', color: theme.textMuted },
    queueRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    queueRemoveDisabled: { opacity: 0.4 },
    queueRemovePressed: { opacity: 0.5 },
    composerFooter: {
      marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    composerRoute: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    composerMeta: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2, color: theme.textFaint },
    composerNotice: { marginTop: 12 },
    notice: {
      marginTop: 12, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: theme.surfaceMuted, flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    },
    noticeError: { backgroundColor: theme.dangerSurface },
    noticeText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontWeight: '700', color: theme.textMuted },
    noticeTextError: { color: theme.dangerText },

    modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.scrim },
    sheet: {
      borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 11,
      backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.border,
    },
    settingsSheet: { maxHeight: '88%' },
    settingsContent: { paddingTop: 4, paddingBottom: 8 },
    catalogSheet: { maxHeight: '92%' },
    keyManagerSheet: { maxHeight: '88%' },
    guideSheet: { maxHeight: '88%' },
    sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: theme.borderStrong, alignSelf: 'center', marginBottom: 18 },
    sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetKicker: {
      fontSize: 13, fontWeight: '500', letterSpacing: -0.1, color: theme.textFaint,
    },
    sheetTitle: {
      fontSize: 26, letterSpacing: -0.7, fontWeight: '600', color: theme.text, marginTop: 2,
    },
    closeButton: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceMuted,
      alignItems: 'center', justifyContent: 'center',
    },
    sheetBody: {
      marginTop: 10, marginBottom: 12, fontSize: 14, lineHeight: 21,
      letterSpacing: -0.15, color: theme.textMuted,
    },
    cliCommand: {
      minHeight: 48, marginBottom: 14, paddingHorizontal: 14, borderRadius: 14,
      backgroundColor: theme.surfaceInput, borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    cliCommandPrompt: { fontSize: 13, fontWeight: '700', color: theme.textFaint },
    cliCommandText: {
      flex: 1, fontSize: 13, fontWeight: '600', color: theme.text,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },

    chatDrawerModal: { flex: 1 },
    chatDrawerScrim: {
      ...StyleSheet.absoluteFillObject, backgroundColor: theme.drawerScrim,
    },
    chatDrawer: {
      position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 18,
      backgroundColor: theme.surface, borderTopRightRadius: 28, borderBottomRightRadius: 28,
      borderRightWidth: 1, borderColor: theme.border,
      shadowColor: '#000000', shadowOffset: { width: 12, height: 0 },
      shadowOpacity: 0.28, shadowRadius: 30, elevation: 24,
    },
    chatDrawerHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    chatDrawerKicker: {
      fontSize: 8, fontWeight: '900', letterSpacing: 1.15, color: theme.textFaint,
    },
    chatDrawerTitle: {
      marginTop: 3, fontSize: 30, lineHeight: 33, fontWeight: '900',
      letterSpacing: -1.2, color: theme.text,
    },
    chatDrawerClose: {
      width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surfaceMuted, borderWidth: 1, borderColor: theme.border,
    },
    chatDrawerContent: { paddingTop: 20, paddingBottom: 20 },
    chatDrawerSectionText: {
      fontSize: 8, fontWeight: '900', letterSpacing: 1.05, color: theme.textFaint, marginBottom: 8,
    },
    projectGroup: { marginBottom: 18 },
    projectHeader: {
      minHeight: 32, paddingHorizontal: 2,
      flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    projectHeaderPressed: { opacity: 0.6 },
    projectName: {
      flex: 1, fontSize: 13, fontWeight: '900', letterSpacing: -0.2, color: theme.text,
    },
    projectCount: { fontSize: 11, fontWeight: '800', color: theme.textFaint },
    projectThreads: { marginTop: 2 },
    chatRow: {
      minHeight: 54, flexDirection: 'row', alignItems: 'stretch',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider,
    },
    chatRowBar: {
      position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: 2,
      backgroundColor: theme.blue,
    },
    chatRowOpen: {
      flex: 1, minWidth: 0, paddingLeft: 14, paddingVertical: 11,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    chatRowPressed: { opacity: 0.55 },
    chatDot: { width: 8, height: 8, borderRadius: 4 },
    chatRowCopy: { flex: 1, minWidth: 0 },
    chatRowName: { fontSize: 13.5, fontWeight: '700', color: theme.textMuted },
    chatRowNameSelected: { fontWeight: '900', color: theme.text },
    chatRowTask: { marginTop: 2, fontSize: 10.5, color: theme.textFaint },
    chatRowArchive: {
      width: 40, alignItems: 'center', justifyContent: 'center',
    },
    chatRowArchivePressed: { opacity: 0.5 },
    chatDrawerFooter: {
      minHeight: 42, paddingTop: 11, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 7, borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    chatDrawerFooterText: {
      fontSize: 8, fontWeight: '800', letterSpacing: 0.25, color: theme.textFaint,
    },

    inputLabel: {
      fontSize: 13, fontWeight: '500', letterSpacing: -0.1, color: theme.textMuted, marginBottom: 8,
    },
    input: {
      height: 50,
      borderRadius: 14,
      paddingHorizontal: 14,
      marginBottom: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.surfaceInputBorder,
      backgroundColor: theme.surfaceInput,
      color: theme.text,
      fontSize: 15,
      fontWeight: '400',
      letterSpacing: -0.2,
    },
    searchWrap: {
      height: 46, borderRadius: 14, paddingHorizontal: 13, marginBottom: 10, borderWidth: 1,
      borderColor: theme.surfaceInputBorder, backgroundColor: theme.surfaceInput, flexDirection: 'row',
      alignItems: 'center', gap: 8,
    },
    searchInput: { flex: 1, height: '100%', color: theme.text, fontSize: 13, fontWeight: '600' },
    actionCatalog: { paddingBottom: 10 },
    actionRow: {
      minHeight: 58, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 14,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider,
    },
    actionRowPressed: { opacity: 0.55 },
    actionRowIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
    actionCardPressed: { transform: [{ scale: 0.988 }] },
    actionCopy: { flex: 1, minWidth: 0 },
    actionTitleRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    },
    actionTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: theme.textMuted },
    actionTitleSelected: { fontWeight: '900', color: theme.text },
    actionCategory: {
      fontSize: 7, fontWeight: '900', letterSpacing: 0.6, color: theme.textFaint,
      textTransform: 'uppercase',
    },
    actionDescription: { marginTop: 2, fontSize: 10.5, lineHeight: 14, color: theme.textFaint },
    actionCheck: { width: 20, alignItems: 'center' },
    keyManagerGrid: {
      flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
      rowGap: 11, paddingBottom: 4,
    },
    keyManagerCard: {
      width: '48.4%', borderRadius: 17, borderWidth: 1, borderColor: theme.border,
      backgroundColor: theme.surfaceInput, overflow: 'hidden',
    },
    keyManagerChoice: { alignItems: 'center', paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10 },
    keyManagerIcon: {
      width: 48, height: 48, borderRadius: 15, backgroundColor: theme.surfaceMuted,
      alignItems: 'center', justifyContent: 'center',
    },
    keyManagerIconEmpty: { backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accentSoftBorder },
    keyManagerSlot: {
      marginTop: 9, fontSize: 7, fontWeight: '900', letterSpacing: 0.85, color: theme.textFaint,
    },
    keyManagerLabel: {
      width: '100%', marginTop: 3, textAlign: 'center', fontSize: 12,
      fontWeight: '900', color: theme.text,
    },
    removeKeyButton: {
      height: 36, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.dangerSurface,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    },
    removeKeyButtonDisabled: { opacity: 0.3 },
    removeKeyButtonPressed: { opacity: 0.8 },
    removeKeyText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.65, color: theme.danger },
    customPromptInput: {
      height: 82, paddingTop: 11, textAlignVertical: 'top', marginTop: 2, marginBottom: 8,
    },
    editorButtons: { flexDirection: 'row', gap: 9 },
    clearButton: {
      height: 52, paddingHorizontal: 16, borderRadius: 15, backgroundColor: theme.surfaceMuted,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    clearButtonText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7, color: theme.textMuted },
    saveKeyButton: {
      flex: 1, height: 52, borderRadius: 15, backgroundColor: theme.accent,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    saveKeyButtonDisabled: { opacity: 0.4 },
    guideContent: { gap: 10, paddingTop: 16, paddingBottom: 6 },
    guideItem: {
      borderRadius: 16, padding: 13, backgroundColor: theme.surfaceInput, borderWidth: 1,
      borderColor: theme.border, flexDirection: 'row', gap: 12,
    },
    guideIcon: {
      width: 42, height: 42, borderRadius: 13, backgroundColor: theme.surfaceMuted,
      alignItems: 'center', justifyContent: 'center',
    },
    guideCopy: { flex: 1 },
    guideTitle: { fontSize: 13, fontWeight: '900', color: theme.text },
    guideBody: { marginTop: 4, fontSize: 11, lineHeight: 15, color: theme.textMuted },
    guideButtonPressed: { opacity: 0.66, transform: [{ scale: 0.98 }] },
    guideSectionIntro: { marginTop: 22, marginBottom: 2 },
    guideSectionTitle: { fontSize: 15, fontWeight: '900', letterSpacing: -0.2, color: theme.text },
    guideSectionBody: { marginTop: 5, fontSize: 11.5, lineHeight: 16, color: theme.textMuted },
    guideGroup: { gap: 10 },
    guideGroupHeading: {
      marginTop: 10, marginBottom: -1, fontSize: 10, fontWeight: '900',
      letterSpacing: 0.8, color: theme.textFaint,
    },
    connectButton: {
      height: 52, borderRadius: 999, marginTop: 6, backgroundColor: theme.accent,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    connectButtonPressed: { opacity: 0.88 },
    connectButtonText: {
      fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: theme.accentText,
    },
    scanButton: {
      minHeight: 68, borderRadius: 18, marginBottom: 18, paddingHorizontal: 14,
      backgroundColor: theme.surfaceMuted, borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    scanButtonPressed: { opacity: 0.82 },
    scanButtonIcon: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: theme.accent,
      alignItems: 'center', justifyContent: 'center',
    },
    scanButtonCopy: { flex: 1 },
    scanButtonTitle: {
      fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: theme.text,
    },
    scanButtonBody: { marginTop: 2, fontSize: 13, color: theme.textFaint },
    manualDivider: {
      marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    manualDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
    manualDividerText: {
      fontSize: 12, fontWeight: '400', letterSpacing: -0.1, color: theme.textFaint,
    },
    settingsSectionDivider: {
      height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginTop: 8, marginBottom: 18,
    },
    forgetMacButton: {
      height: 48, marginBottom: 8, borderRadius: 14, backgroundColor: theme.dangerSurface,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    forgetMacButtonText: { fontSize: 14, fontWeight: '700', color: theme.dangerText },
    settingsSpace: { marginTop: 20 },
    settingsGroup: {
      marginBottom: 22,
    },
    settingsGroupLabel: {
      fontFamily: Fonts.sansMedium,
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: theme.textFaint,
      marginBottom: 10,
    },
    settingsCommandRow: {
      minHeight: 44,
      paddingLeft: 12,
      paddingRight: 6,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    settingsCommandPrompt: {
      fontFamily: Fonts.mono,
      fontSize: 12.5,
      color: theme.textFaint,
    },
    settingsCommandText: {
      flex: 1,
      fontFamily: Fonts.mono,
      fontSize: 12,
      color: theme.text,
    },
    settingsCopyChip: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    settingsCopyChipDone: {
      backgroundColor: theme.mode === 'dark' ? 'rgba(16,163,127,0.22)' : 'rgba(16,163,127,0.12)',
    },
    settingsPrimaryButton: {
      height: 46,
      borderRadius: 12,
      backgroundColor: theme.text,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    settingsPrimaryButtonText: {
      fontFamily: Fonts.sansSemi,
      fontSize: 14.5,
      letterSpacing: -0.2,
      color: theme.bg,
    },
    themeSegment: {
      flexDirection: 'row', gap: 8,
    },
    themeSegmentOption: {
      flex: 1, height: 42, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
      backgroundColor: theme.surfaceInput, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 7,
    },
    themeSegmentOptionActive: { borderColor: theme.text, backgroundColor: theme.surfaceMuted },
    themeSegmentText: { fontFamily: Fonts.sansMedium, fontSize: 13, letterSpacing: -0.1, color: theme.textMuted },
    themeSegmentTextActive: { color: theme.text },
    controllerFieldLabel: {
      marginBottom: 8, fontFamily: Fonts.sansMedium, fontSize: 12, color: theme.textMuted,
    },
    encoderModeSegment: {
      flexDirection: 'row', gap: 6, marginBottom: 10,
    },
    encoderModeOption: {
      flex: 1, height: 38, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border, backgroundColor: theme.surfaceInput,
      alignItems: 'center', justifyContent: 'center',
    },
    encoderModeOptionActive: {
      borderColor: theme.text, backgroundColor: theme.surfaceMuted,
    },
    encoderModeText: {
      fontFamily: Fonts.sansMedium, fontSize: 11.5, color: theme.textMuted,
    },
    encoderModeTextActive: { color: theme.text },
    settingsLinkRow: {
      minHeight: 48,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    settingsLinkRowPressed: { opacity: 0.55 },
    settingsLinkTitle: {
      fontFamily: Fonts.sansSemi,
      fontSize: 15,
      letterSpacing: -0.2,
      color: theme.text,
    },
    settingsDangerLink: {
      marginTop: 4,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingsDangerLinkText: {
      fontFamily: Fonts.sansMedium,
      fontSize: 14,
      color: theme.dangerText,
    },
    settingsRow: {
      minHeight: 56, borderRadius: 16, paddingHorizontal: 14, marginTop: 8,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: theme.surfaceMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    settingsRowPressed: { backgroundColor: theme.surfaceMuted },
    settingsRowIcon: {
      width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.surfaceMuted,
    },
    settingsRowCopy: { flex: 1 },
    settingsRowTitle: { fontSize: 13, fontWeight: '900', color: theme.text },
    settingsRowBody: { marginTop: 2, fontSize: 10.5, lineHeight: 14, color: theme.textMuted },

    scannerScreen: { flex: 1, backgroundColor: '#071014' },
    scannerHeader: {
      position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18,
      paddingBottom: 16, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', backgroundColor: 'rgba(4,12,15,0.58)',
    },
    scannerClose: {
      width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    scannerTitle: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
    scannerHeaderSpacer: { width: 42 },
    scannerFrame: {
      position: 'absolute', width: 252, height: 252, left: '50%', top: '50%',
      marginLeft: -126, marginTop: -126,
    },
    scannerCorner: { position: 'absolute', width: 42, height: 42, borderColor: theme.blue },
    scannerCornerTopLeft: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
    scannerCornerTopRight: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
    scannerCornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
    scannerCornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },
    scannerFooter: {
      position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 32,
      paddingTop: 22, backgroundColor: 'rgba(4,12,15,0.68)',
    },
    scannerHint: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  });
}
