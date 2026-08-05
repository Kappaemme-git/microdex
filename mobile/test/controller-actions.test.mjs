import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(
  new URL('../app/index.tsx', import.meta.url),
  'utf8',
);
const launcherSource = await readFile(
  new URL('../../bridge/scripts/start-mobile-dev.mjs', import.meta.url),
  'utf8',
);
const hardwareKeySource = await readFile(
  new URL('../components/hardware-key.tsx', import.meta.url),
  'utf8',
);
const joystickSource = await readFile(
  new URL('../components/joystick.tsx', import.meta.url),
  'utf8',
);
const chatDrawerSource = await readFile(
  new URL('../components/chat-drawer.tsx', import.meta.url),
  'utf8',
);
const themeSource = await readFile(
  new URL('../lib/theme.tsx', import.meta.url),
  'utf8',
);
const layoutSource = await readFile(
  new URL('../app/_layout.tsx', import.meta.url),
  'utf8',
);
const appJsonSource = await readFile(
  new URL('../app.json', import.meta.url),
  'utf8',
);
const deckLightingSource = await readFile(
  new URL('../components/deck-lighting.tsx', import.meta.url),
  'utf8',
);
const skeuoSource = await readFile(
  new URL('../components/skeuo.tsx', import.meta.url),
  'utf8',
);
const shellPoolSource = skeuoSource.slice(
  skeuoSource.indexOf('export function ShellPool'),
  skeuoSource.indexOf('export function Screw'),
);
const commandGlyphSource = await readFile(
  new URL('../components/codex-command-glyph.tsx', import.meta.url),
  'utf8',
);

test('the mobile controller never delegates keys to desktop keyboard shortcuts', () => {
  assert.doesNotMatch(controllerSource, /\/api\/actions\/shortcut/);
  assert.doesNotMatch(controllerSource, /\brunShortcut\b/);
});

test('every joystick direction controls the matching Codex Micro desktop action', () => {
  assert.match(controllerSource, /case 'up':/);
  assert.match(controllerSource, /case 'right':/);
  assert.match(controllerSource, /case 'down':/);
  assert.match(controllerSource, /case 'left':/);
  for (const action of ['plan', 'forward', 'sidebar', 'back']) {
    assert.match(controllerSource, new RegExp(`\\{ action: '${action}' \\}`));
  }
});

test('the joystick follows a real drag, commits on release, and springs home', () => {
  assert.match(joystickSource, /Gesture\.Pan\(\)/);
  assert.match(joystickSource, /Math\.hypot\(event\.translationX, event\.translationY\)/);
  assert.match(joystickSource, /travel\.value \/ distance/);
  assert.match(joystickSource, /runOnJS\(commitDirection\)\(direction\)/);
  assert.match(joystickSource, /translateX\.value = withSpring\(0/);
  assert.match(joystickSource, /translateY\.value = withSpring\(0/);
  assert.doesNotMatch(joystickSource, /<Pressable/);
});

test('remote command buttons use stable action ids', () => {
  for (const actionId of ['send', 'approve', 'decline', 'fork', 'dictation']) {
    assert.match(controllerSource, new RegExp(`'${actionId}'`));
  }
});

test('approval buttons explain when Codex has no pending request', () => {
  assert.match(controllerSource, /unavailableReason=\{unavailableReason\('APPR'\)\}/);
  assert.match(controllerSource, /unavailableReason=\{unavailableReason\('REJ'\)\}/);
  assert.match(controllerSource, /requireActionAvailable\(decision === 'approve' \? 'APPR' : 'REJ'\)/);
});

test('the six lit keys are programmable and never select another chat', () => {
  const programmableKeyHandler = controllerSource.slice(
    controllerSource.indexOf('const runProgrammedKey'),
    controllerSource.indexOf('const sendDraft'),
  );
  assert.match(controllerSource, /STORAGE_PROGRAMMED_KEYS/);
  assert.match(controllerSource, /STORAGE_LEGACY_PROGRAMMED_KEYS/);
  assert.match(controllerSource, /defaultProgrammedKeys/);
  assert.match(controllerSource, /programmedActionId/);
  assert.match(controllerSource, /keycapId: programmed\.keycapId/);
  assert.match(controllerSource, /action: programmed\.action/);
  assert.match(controllerSource, /\[2, 3, 4, 5\]/);
  assert.match(controllerSource, /\/api\/programmable\/action/);
  assert.match(controllerSource, /onLongPress=\{isMic \? undefined : \(\) => openKeyEditor/);
  assert.doesNotMatch(programmableKeyHandler, /\/api\/remote\/select/);
});

test('programmable keys have a visible manager with replace and remove controls', () => {
  assert.match(controllerSource, /Customize keys/i);
  assert.match(controllerSource, /visible=\{keyManagerVisible\}/);
  assert.match(controllerSource, /removeProgrammedKey/);
  assert.match(controllerSource, /clearAllProgrammedKeys/);
  assert.match(controllerSource, /accessibilityLabel="Clear all programmable keys"/);
  assert.match(controllerSource, /setProgrammedKeys\(nextKeys\)/);
  assert.match(controllerSource, /All programmable keys cleared/);
  assert.match(controllerSource, /<CentralIcon name="trash"/);
  assert.match(controllerSource, /Choose an empty key or replace an existing one/);
});

test('the controller exposes every programmable function and the in-app guide', () => {
  assert.match(controllerSource, /MICRO_ACTIONS/);
  // Keycap metadata remains internal for saved-layout compatibility. The user
  // chooses directly from one vertically scrolling list of Codex functions.
  assert.match(controllerSource, /suggestedKeycapForCommand/);
  assert.match(controllerSource, /Search all Codex functions/);
  assert.doesNotMatch(controllerSource, /KEYCAP_CATALOG/);
  assert.doesNotMatch(controllerSource, /KEYCAP LABEL/);
  assert.doesNotMatch(controllerSource, /keycapScroller/);
  assert.doesNotMatch(controllerSource, /keycapStrip/);
  assert.doesNotMatch(controllerSource, /keycapChip/);
  assert.match(controllerSource, /PROGRAMMABLE KEY/);
  assert.match(controllerSource, /CODEX MICRO CONTROLS/);
  assert.match(controllerSource, /Approve and Reject/);
  assert.match(controllerSource, /Assignable keys/);
});

test('semantic command icons stay consistent in the picker, manager, and deck', () => {
  assert.match(commandGlyphSource, /toggleSidebar: 'sidebarPanel'/);
  assert.match(commandGlyphSource, /'workspace\.openSkills': 'skillsBlock'/);
  assert.match(commandGlyphSource, /'git\.commit': 'gitCommit'/);
  assert.match(commandGlyphSource, /'workspace\.toggleReviewPanel': 'reviewPanel'/);
  assert.match(commandGlyphSource, /'workspace\.toggleBottomPanel': 'bottomPanel'/);
  assert.match(controllerSource, /<CodexCommandGlyph actionId=\{actionId\} size=\{24\} color=\{skeuo\.icon\}/);
  assert.match(controllerSource, /<CodexCommandGlyph\s+actionId=\{actionId\}\s+size=\{24\}/);
  assert.match(controllerSource, /<CodexCommandGlyph\s+actionId=\{action\.id\}\s+size=\{21\}/);
  assert.doesNotMatch(controllerSource, /keyManagerKeycap/);
});

test('the effort dial follows the levels supported by the active model', () => {
  assert.match(controllerSource, /activeThread\?\.supportedReasoningEfforts/);
  assert.match(controllerSource, /onPreview=\{previewReasoning\}/);
  assert.match(controllerSource, /onCommit=\{\(index\) => void commitReasoning\(index\)\}/);
  assert.match(controllerSource, /mode=\{encoderMode\}/);
  assert.match(controllerSource, /'composer-navigation'/);
  assert.match(controllerSource, /'conversation-scroll'/);
});

test('reasoning is authoritative and microphone actions have explicit start and stop', () => {
  assert.doesNotMatch(controllerSource, /reasoningDirection:/);
  assert.match(controllerSource, /'dictation-start'/);
  assert.match(controllerSource, /'dictation-stop'/);
  assert.match(controllerSource, /dictationReleaseTimer/);
  assert.match(controllerSource, /\}, 350\)/);
  assert.match(controllerSource, /\/api\/desktop\/action/);
});

test('native Voice Chat state is returned by the bridge', () => {
  assert.match(controllerSource, /remote\?\.voice\?\.state/);
  assert.match(controllerSource, /next\.voice\?\.state === 'setup'/);
  assert.match(controllerSource, /Choose a voice on your Mac/);
});

test('the Expo preview and bridge receive the same access token', () => {
  assert.match(launcherSource, /EXPO_PUBLIC_MICRODEX_TOKEN:\s*token/);
  assert.match(controllerSource, /process\.env\.EXPO_PUBLIC_MICRODEX_TOKEN/);
});

test('connection failures are visible inside the open settings sheet', () => {
  const settingsStart = controllerSource.indexOf('open={settingsVisible}');
  const settingsSheet = controllerSource.slice(
    settingsStart,
    controllerSource.indexOf('</Modal>', settingsStart),
  );
  assert.match(settingsSheet, /\{noticeError\s*\?/);
  assert.match(settingsSheet, /\{notice\}/);
  assert.match(settingsSheet, /settingsGroupLabel/);
  assert.match(settingsSheet, /Scan pairing code/);
});

test('live Codex state uses an authenticated WebSocket instead of rapid polling', () => {
  assert.match(controllerSource, /new WebSocket\(bridgeEventsUrl\(bridgeUrl\)\)/);
  assert.match(controllerSource, /JSON\.stringify\(\{ type: 'auth', token \}\)/);
  assert.match(controllerSource, /message\.type === 'state'/);
  assert.doesNotMatch(controllerSource, /setInterval\(\(\) => void refreshRemote\(\), 900\)/);
});

test('the deck follows the active theme instead of a walking sheen', () => {
  assert.doesNotMatch(controllerSource, /DeckSheen/);
  assert.match(controllerSource, /useSkeuo\(\)/);
  assert.match(hardwareKeySource, /useSkeuo\(\)/);
  assert.match(hardwareKeySource, /dishDark/);
});

test('commands provide immediate progress feedback', () => {
  assert.match(controllerSource, /ACTION_PROGRESS/);
  assert.match(controllerSource, /ImpactFeedbackStyle\.Light/);
  assert.match(controllerSource, /activityLabel/);
});

test('the lower panel is a chat-styled one-way remote composer', () => {
  assert.match(controllerSource, /styles\.composerPanel/);
  assert.match(controllerSource, /<CentralIcon name="chat"/);
  assert.match(controllerSource, /Chat to Codex/);
  assert.match(controllerSource, /OUTPUT ON MAC/);
  assert.match(controllerSource, /Message Codex/);
  assert.match(controllerSource, /Connect your Mac to write/);
  assert.doesNotMatch(controllerSource, /chatMessages\.map/);
  assert.doesNotMatch(controllerSource, /CODEX IS WRITING/);
  assert.doesNotMatch(controllerSource, /composeVisible/);
});

test('the remote composer remains visible when the phone keyboard opens', () => {
  assert.match(controllerSource, /const mainScrollRef = useRef<ScrollView>\(null\)/);
  assert.match(controllerSource, /ref=\{mainScrollRef\}/);
  assert.match(controllerSource, /automaticallyAdjustKeyboardInsets/);
  assert.match(controllerSource, /keyboardShouldPersistTaps="handled"/);
  assert.match(controllerSource, /onFocus=\{revealRemoteComposer\}/);
  assert.match(controllerSource, /mainScrollRef\.current\?\.scrollToEnd/);
  assert.match(appJsonSource, /"orientation": "portrait"/);
});

test('the mobile draft uses the desktop remote-send endpoint', () => {
  assert.match(controllerSource, /const optimisticMessage: QueuedMessage/);
  assert.match(controllerSource, /messageQueue: \[\.\.\.\(current\.messageQueue \?\? \[\]\), optimisticMessage\]/);
  assert.match(controllerSource, /setDraft\(''\)/);
  assert.match(controllerSource, /'\/api\/remote\/send'/);
  assert.match(controllerSource, /Message added to the Codex queue/);
  assert.doesNotMatch(controllerSource, /clientUserMessageId/);
});

test('the fixed Send key submits either the Microdex draft or the desktop composer', () => {
  const sendDraftHandler = controllerSource.slice(
    controllerSource.indexOf('const sendDraft'),
    controllerSource.indexOf('const removeQueuedMessage'),
  );
  assert.ok(
    sendDraftHandler.indexOf("if (!hasMobileDraft)") <
      sendDraftHandler.indexOf("if (!activeThread)"),
    'desktop Send must not require a selected Microdex thread',
  );
  assert.match(sendDraftHandler, /\{ action: 'send' \}/);
  assert.match(sendDraftHandler, /body: \{ threadId: activeThread\.id, text \}/);
  assert.doesNotMatch(sendDraftHandler, /requireActionAvailable\('CODEX'\)/);
  assert.match(controllerSource, /accessibilityLabel="Send Microdex draft or desktop composer"/);
  assert.match(controllerSource, /onPress=\{\(\) => void sendDraft\(\)\}/);
  assert.match(controllerSource, /onLongPress=\{openRemoteComposer\}/);
});

test('queued messages stay visible and can be removed before sending', () => {
  assert.match(controllerSource, /activeMessageQueue\.map/);
  assert.match(controllerSource, /QUEUED · \{activeMessageQueue\.length\}/);
  assert.match(controllerSource, /message\.status === 'sending'/);
  assert.match(controllerSource, /composerRef\.current\?\.isFocused\(\)/);
  assert.match(controllerSource, /\[activeMessageQueue\.length, revealRemoteComposer\]/);
  assert.match(controllerSource, /\/api\/remote\/queue\/remove/);
  assert.match(controllerSource, /disabled=\{sending \|\| removing\}/);
  assert.match(controllerSource, /removeQueuedMessage\(message\.id\)/);
  assert.match(controllerSource, /<CentralIcon name="trash"/);
});

test('the header opens a left project drawer and quickly switches synced Codex chats', () => {
  assert.match(controllerSource, /accessibilityLabel="Open Codex chat switcher"/);
  assert.doesNotMatch(controllerSource, /LINKED|modeStrip/);
  assert.match(controllerSource, /accessibilityLabel="Open bridge settings"/);
  assert.match(controllerSource, /const chatDrawerRef = useRef<ChatDrawerHandle>\(null\)/);
  assert.match(controllerSource, /chatDrawerRef\.current\?\.open\(\)/);
  assert.doesNotMatch(controllerSource, /setChatSwitcherVisible/);
  assert.match(chatDrawerSource, /memo\(forwardRef<ChatDrawerHandle/);
  assert.match(chatDrawerSource, /useImperativeHandle\(ref, \(\) => \(\{ open, close \}\)/);
  assert.match(chatDrawerSource, /const projectGroups = useMemo/);
  assert.match(chatDrawerSource, /const projectSections = useMemo/);
  assert.match(chatDrawerSource, /collapsedProjects\.has\(project\)/);
  assert.match(chatDrawerSource, /onPress=\{\(\) => toggleProject\(section\.project\)\}/);
  assert.match(chatDrawerSource, /accessibilityState=\{\{ expanded: !section\.collapsed \}\}/);
  assert.match(chatDrawerSource, /section\.collapsed \? 'chevronRight' : 'chevronDown'/);
  assert.match(chatDrawerSource, /thread\.status === 'thinking'/);
  assert.match(controllerSource, /Animated\.loop/);
  assert.match(chatDrawerSource, /Codex status: \$\{threadMeta\.label\}/);
  assert.match(chatDrawerSource, /synced with Codex/);
  assert.doesNotMatch(chatDrawerSource, /MICROCODEX NAVIGATOR/);
  assert.match(chatDrawerSource, /DrawerScope/);
  assert.match(chatDrawerSource, /chatThreads/);
  assert.match(chatDrawerSource, /scopeSegment/);
  assert.match(chatDrawerSource, /By project · \$\{projectGroups\.length\}/);
  assert.match(controllerSource, /\/api\/remote\/select/);
  assert.match(controllerSource, /body: \{ threadId: target\.id \}/);
  assert.match(controllerSource, /Alert\.alert\(/);
  assert.match(controllerSource, /\/api\/remote\/archive/);
  assert.match(controllerSource, /onArchive=\{archiveRemoteThread\}/);
  assert.match(controllerSource, /<CentralIcon name="trash"/);
  assert.match(chatDrawerSource, /Opens on your Mac/);
});

test('the controller keeps its fixed hardware palette while statuses remain legible', () => {
  assert.match(themeSource, /online: '#10A37F'/);
  assert.match(themeSource, /complete: \{ label: 'Complete', color: theme\.online/);
  assert.match(themeSource, /waiting: \{ label: 'Needs input', color: waiting/);
  assert.doesNotMatch(themeSource, /softColor|ambientColor/);
  assert.doesNotMatch(controllerSource, /activeMeta\.softColor|activeMeta\.ambientColor/);
  assert.match(controllerSource, /<View style=\{styles\.ambientBlue\} \/>/);
  assert.match(controllerSource, /<View style=\{styles\.deviceGlow\}>/);
});
test('the active chat drives event lighting without leaving completion green forever', () => {
  assert.match(themeSource, /export const LED: Record<AgentStatusKey, string>/);
  assert.match(themeSource, /thinking: '#304FFE'/);
  assert.match(themeSource, /complete: '#00FF4C'/);
  assert.match(themeSource, /waiting: '#FF6D00'/);
  assert.match(themeSource, /export const LED_RECORDING/);

  // Thinking, waiting and errors remain visible while relevant. Complete is a
  // short transition flash, so a finished chat cannot leave a permanent LED.
  assert.match(
    controllerSource,
    /const persistentStatusLight =\s*activeAgent\.status === 'thinking'/,
  );
  assert.match(controllerSource, /current\.status === 'complete'/);
  assert.match(controllerSource, /COMPLETE_LIGHT_MS = 1_200/);
  assert.match(controllerSource, /setCompletionLight\(false\)/);
  assert.match(controllerSource, /intensity=\{deckLightsOn \? 1 : 0\}/);
  assert.match(controllerSource, /pulse=\{deckLightPulses\}/);
  assert.match(controllerSource, /const hardwareActionRunning = Boolean\(status\) && Boolean\(loadingAction\)/);
  assert.match(controllerSource, /hardwareFeedbackColor/);
  assert.match(controllerSource, /flashHardwareFeedback\(LED\.complete\)/);
  assert.match(controllerSource, /flashHardwareFeedback\(LED\.error\)/);
  assert.match(controllerSource, /hardwareActionRunning \|\| activeAgent\.status === 'thinking'/);
  assert.match(controllerSource, /hardwareFeedbackColor === LED\.complete/);
  assert.match(controllerSource, /hardwareFeedbackColor === LED\.error/);
  assert.doesNotMatch(controllerSource, /activeThread\?\.fastMode \? skeuo\.rgb : theme\.borderStrong/);
  assert.match(controllerSource, /mic=\{micLight\}/);
  assert.match(controllerSource, /dictationActive\s*\?\s*'recording'/);
  assert.match(controllerSource, /loadingAction === 'dictation'\n\s*\?\s*'processing'/);

  // Keys light while their action runs and briefly report success or failure.
  assert.match(controllerSource, /running\s*\?\s*LED\.thinking/);
  assert.match(controllerSource, /succeeded \? LED\.complete : LED\.error/);
  assert.match(controllerSource, /KEY_RESULT_LIGHT_MS = 900/);
  assert.doesNotMatch(controllerSource, /latchedColor=\{activeThread\?\.fastMode/);
  assert.match(controllerSource, /glowColor=\{remote\?\.pendingApproval \? LED\.waiting : undefined\}/);
  assert.match(controllerSource, /glowColor=\{dictationActive \? LED_RECORDING : undefined\}/);
  assert.match(hardwareKeySource, /const lit = active \|\| selected \|\| glowColor != null/);
  assert.match(hardwareKeySource, /const bloom = active \|\| selected \|\| glowColor != null/);
  assert.match(hardwareKeySource, /rgb=\{bloom\}/);

  assert.match(deckLightingSource, /PULSE_CYCLE = 2400/);
  assert.match(deckLightingSource, /if \(intensity <= 0\) return null/);
  assert.match(deckLightingSource, /Easing\.linear/);
});

test('all six programmable keys target only the active chat', () => {
  const renderedKeys = controllerSource.slice(
    controllerSource.indexOf('const renderProgrammedKey'),
    controllerSource.indexOf('const copyCommandButton'),
  );
  assert.doesNotMatch(renderedKeys, /remote\?\.threads\[slotIndex\]/);
  assert.doesNotMatch(renderedKeys, /switchRemoteThread/);
  assert.doesNotMatch(renderedKeys, /Agent \$\{slotIndex/);
  assert.match(renderedKeys, /active chat only/);
  assert.match(renderedKeys, /variant="rgb"/);
  assert.match(renderedKeys, /action\s*\?\s*\(\) => void runProgrammedKey\(slotIndex\)/);
  assert.match(renderedKeys, /: \(\) => openKeyEditor\(slotIndex\)/);

  const programmableKeyHandler = controllerSource.slice(
    controllerSource.indexOf('const runProgrammedKey'),
    controllerSource.indexOf('const sendDraft'),
  );
  assert.match(programmableKeyHandler, /threadId: activeThread\?\.id/);
  assert.doesNotMatch(programmableKeyHandler, /\/api\/remote\/select/);
});

test('the device body keeps moulded-object proportions at any width', () => {
  // Radii and insets are fractions of the measured width, not fixed pixels.
  assert.match(skeuoSource, /function shellGeometry\(width: number, fallbackRadius: number\)/);
  assert.match(skeuoSource, /body: width \* 0\.125/);
  assert.match(skeuoSource, /plateInset: width \* 0\.055/);
  assert.match(skeuoSource, /onLayout=\{\(event\) => setWidth\(event\.nativeEvent\.layout\.width\)\}/);
  assert.doesNotMatch(controllerSource, /device: \{ borderRadius: 36 \}/);

  // Bezel steps, moulded lip, specular dome, steel screws and the light pool.
  assert.match(skeuoSource, /styles\.bezel/);
  assert.match(skeuoSource, /styles\.lip/);
  assert.match(skeuoSource, /capGlint: \{[^}]*height: '26%'/s);
  assert.match(skeuoSource, /export function Screw/);
  assert.match(skeuoSource, /export function ShellPool/);
  assert.match(controllerSource, /<Screw style=\{styles\.screwTopLeft\} \/>/);
  assert.match(controllerSource, /<ShellPool \/>/);
  assert.doesNotMatch(controllerSource, /screwSlotH/);
});

test('the device light pool follows dark mode and fades before its rectangular bounds', () => {
  assert.match(shellPoolSource, /const dark = theme\.mode === 'dark'/);
  assert.match(shellPoolSource, /cy="48%" r="52%"/);
  assert.match(shellPoolSource, /offset="0\.82"[^>]*stopOpacity=\{0\}/s);
});

test('chat rows reveal archive on a left swipe and projects can be archived safely', () => {
  assert.match(layoutSource, /GestureHandlerRootView/);
  assert.match(chatDrawerSource, /ReanimatedSwipeable/);
  assert.match(chatDrawerSource, /renderRightActions=/);
  assert.match(chatDrawerSource, /overshootRight=\{false\}/);
  assert.match(chatDrawerSource, />ARCHIVE<\/Text>/);
  assert.match(chatDrawerSource, /swipeable\.close\(\)/);
  assert.match(chatDrawerSource, /onArchive\(thread\)/);
  assert.match(chatDrawerSource, /name="folderRemove"/);
  assert.match(
    chatDrawerSource,
    /onArchiveProject\(section\.project, section\.allThreads\)/,
  );
  assert.match(controllerSource, /const archiveRemoteProject = useCallback/);
  assert.match(controllerSource, /The folder and files on your Mac will not be deleted/);
  assert.match(controllerSource, /for \(const thread of projectThreads\)/);
  assert.match(controllerSource, /onArchiveProject=\{archiveRemoteProject\}/);
});

test('the chat drawer stays mounted and virtualizes its animated swipe rows', () => {
  assert.match(chatDrawerSource, /<SectionList/);
  assert.doesNotMatch(chatDrawerSource, /<Modal/);
  assert.doesNotMatch(chatDrawerSource, /<ScrollView/);
  assert.match(chatDrawerSource, /\.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(chatDrawerSource, /pointerEvents=\{visible \? 'auto' : 'none'\}/);
  assert.match(chatDrawerSource, /initialNumToRender=\{8\}/);
  assert.match(chatDrawerSource, /maxToRenderPerBatch=\{6\}/);
  assert.match(chatDrawerSource, /windowSize=\{5\}/);
  assert.match(chatDrawerSource, /const renderItem = useCallback/);
  assert.match(chatDrawerSource, /renderItem=\{renderItem\}/);
});

test('the Home screen captures a horizontal swipe to open chats', () => {
  assert.match(controllerSource, /Gesture\.Fling\(\)/);
  assert.match(controllerSource, /Directions\.LEFT/);
  assert.match(controllerSource, /edgeSwipeZone/);
  assert.match(controllerSource, /GestureHandlerRootView/);
  assert.match(controllerSource, /GestureDetector gesture=\{homeFlingLeft\}/);
  assert.match(controllerSource, /DismissibleSheet/);
});
