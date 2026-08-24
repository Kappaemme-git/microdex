import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeVoiceModePress,
  getVoiceAction,
  getVoiceIntentMessage,
  getVoicePresentation,
  getVoiceResultMessage,
  VOICE_GLOW_COLOR,
  VOICE_LOADING_ACTION,
} from '../lib/voice-mode.ts';

test('Voice presentation preserves active, engaged, label, loading, and glow contracts', () => {
  const cases = [
    [undefined, 'inactive', false, false, 'Start Voice Chat on the Mac'],
    [{ state: 'inactive', muted: false }, 'inactive', false, false, 'Start Voice Chat on the Mac'],
    [{ state: 'setup', muted: false }, 'setup', false, true, 'Start Voice Chat on the Mac'],
    [{ state: 'launching', muted: false }, 'launching', false, true, 'Start Voice Chat on the Mac'],
    [{ state: 'active', muted: false }, 'active', true, true, 'End Voice Chat on the Mac'],
    [{ state: 'active', muted: true }, 'active', true, true, 'End Voice Chat on the Mac'],
  ];

  for (const [voice, state, active, engaged, accessibilityLabel] of cases) {
    assert.deepEqual(getVoicePresentation(voice), {
      state,
      active,
      engaged,
      accessibilityLabel,
    });
  }
  assert.equal(VOICE_LOADING_ACTION, 'voice');
  assert.equal(VOICE_GLOW_COLOR, '#8EA8FF');
});

test('Voice action and intent remain active-only end semantics', () => {
  for (const voice of [
    undefined,
    { state: 'inactive', muted: false },
    { state: 'setup', muted: false },
    { state: 'launching', muted: false },
  ]) {
    assert.equal(getVoiceAction(voice), 'voice-start');
    assert.equal(getVoiceIntentMessage(voice), 'Opening Voice Chat on your Mac…');
  }
  const active = { state: 'active', muted: false };
  assert.equal(getVoiceAction(active), 'voice-end');
  assert.equal(getVoiceIntentMessage(active), 'Ending Voice Chat…');
});

test('Voice result messages preserve every remote response branch', () => {
  assert.equal(
    getVoiceResultMessage({ state: 'setup', muted: false }, false),
    'Voice setup is open. Choose a voice on your Mac, then press VOICE again.',
  );
  assert.equal(
    getVoiceResultMessage({ state: 'launching', muted: false }, false),
    'Voice Chat opened on your Mac. Complete anything shown there, then press VOICE again.',
  );
  assert.equal(
    getVoiceResultMessage({ state: 'active', muted: false }, false),
    'Voice Chat is live on your Mac.',
  );
  assert.equal(
    getVoiceResultMessage({ state: 'active', muted: true }, false),
    'Voice Chat microphone muted.',
  );
  assert.equal(
    getVoiceResultMessage({ state: 'inactive', muted: false }, true),
    'Voice Chat ended on your Mac.',
  );
  assert.equal(
    getVoiceResultMessage({ state: 'inactive', muted: false }, false),
    'Voice Chat command sent to your Mac.',
  );
  assert.equal(
    getVoiceResultMessage(undefined, true),
    'Voice Chat command sent to your Mac.',
  );
});

function createDependencies({
  voice = { state: 'inactive', muted: false },
  nextVoice = { state: 'active', muted: false },
  bridgeReady = true,
  settingsReady = true,
  requestError,
  verifyError,
} = {}) {
  const events = [];
  const next = { voice: nextVoice };
  return {
    events,
    dependencies: {
      voice,
      requireBridge: () => {
        events.push('requireBridge');
        return bridgeReady;
      },
      requireVerifiedSettings: () => {
        events.push('requireVerifiedSettings');
        return settingsReady;
      },
      requestVoiceAction: async (action) => {
        events.push(`request:${action}`);
        if (requestError) throw requestError;
        return next;
      },
      verifyCommand: () => {
        events.push('verifyCommand');
        if (verifyError) throw verifyError;
      },
      setRemote: (remote) => events.push(`setRemote:${remote.voice?.state}`),
      setLoadingAction: (action) => events.push(`setLoading:${action}`),
      announce: (message) => events.push(`announce:${message}`),
      flashComplete: () => events.push('flashComplete'),
      flashError: () => events.push('flashError'),
      handleActionError: (error) => events.push(`handleError:${error.message}`),
      impact: () => events.push('impact'),
      notifySuccess: async () => events.push('notifySuccess'),
      notifyError: async () => events.push('notifyError'),
    },
  };
}

test('Voice execution preserves the successful side-effect order', async () => {
  const { events, dependencies } = createDependencies();
  await executeVoiceModePress(dependencies);
  assert.deepEqual(events, [
    'requireBridge',
    'requireVerifiedSettings',
    'setLoading:voice',
    'announce:Opening Voice Chat on your Mac…',
    'impact',
    'request:voice-start',
    'verifyCommand',
    'setRemote:active',
    'announce:Voice Chat is live on your Mac.',
    'flashComplete',
    'notifySuccess',
    'setLoading:null',
  ]);
});

test('Voice execution preserves the active-session end flow', async () => {
  const { events, dependencies } = createDependencies({
    voice: { state: 'active', muted: true },
    nextVoice: { state: 'inactive', muted: false },
  });
  await executeVoiceModePress(dependencies);
  assert.deepEqual(events, [
    'requireBridge',
    'requireVerifiedSettings',
    'setLoading:voice',
    'announce:Ending Voice Chat…',
    'impact',
    'request:voice-end',
    'verifyCommand',
    'setRemote:inactive',
    'announce:Voice Chat ended on your Mac.',
    'flashComplete',
    'notifySuccess',
    'setLoading:null',
  ]);
});

test('Voice execution short-circuits guards without entering loading state', async () => {
  const disconnected = createDependencies({ bridgeReady: false });
  await executeVoiceModePress(disconnected.dependencies);
  assert.deepEqual(disconnected.events, ['requireBridge', 'flashError']);

  const outdated = createDependencies({ settingsReady: false });
  await executeVoiceModePress(outdated.dependencies);
  assert.deepEqual(outdated.events, [
    'requireBridge',
    'requireVerifiedSettings',
    'flashError',
  ]);
});

test('Voice execution routes request and verification failures through error feedback', async () => {
  const requestFailure = createDependencies({ requestError: new Error('offline') });
  await executeVoiceModePress(requestFailure.dependencies);
  assert.deepEqual(requestFailure.events.slice(-4), [
    'handleError:offline',
    'flashError',
    'notifyError',
    'setLoading:null',
  ]);
  assert.doesNotMatch(requestFailure.events.join('|'), /setRemote/);

  const verificationFailure = createDependencies({ verifyError: new Error('unverified') });
  await executeVoiceModePress(verificationFailure.dependencies);
  assert.deepEqual(verificationFailure.events.slice(-5), [
    'verifyCommand',
    'handleError:unverified',
    'flashError',
    'notifyError',
    'setLoading:null',
  ]);
  assert.doesNotMatch(verificationFailure.events.join('|'), /setRemote/);
});
