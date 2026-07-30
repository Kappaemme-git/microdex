import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const desktopCalls = [];
let desktopHandler = async (...args) => {
  desktopCalls.push(args);
};

mock.module('../lib/codex-desktop-control.mjs', {
  namedExports: {
    executeCodexDesktopAction: (...args) => desktopHandler(...args),
  },
});

const {
  CODEX_PROGRAMMABLE_ACTIONS,
  executeProgrammedAction,
} = await import('../lib/programmed-actions.mjs');

function createCodex(overrides = {}) {
  const calls = [];
  let selected = {
    id: 'thread-1',
    fastMode: false,
    reasoningEffort: 'medium',
  };
  const codex = {
    calls,
    async state() {
      calls.push(['state']);
      return {
        selectedThreadId: selected.id,
        selected,
        pendingApproval: { requestId: 'approval-1' },
      };
    },
    async updateSettings(settings) {
      calls.push(['updateSettings', settings]);
      selected = {
        ...selected,
        fastMode: settings.fastMode ?? selected.fastMode,
        reasoningEffort: settings.reasoningEffort ?? selected.reasoningEffort,
      };
      return codex.state();
    },
    async resolveApproval(decision) {
      calls.push(['resolveApproval', decision]);
      return codex.state();
    },
    async forkThread(threadId) {
      calls.push(['forkThread', threadId]);
      return codex.state();
    },
    async openNewThread() {
      calls.push(['openNewThread']);
      return codex.state();
    },
    async archiveThread(threadId) {
      calls.push(['archiveThread', threadId]);
      return codex.state();
    },
    async selectThread(threadId) {
      calls.push(['selectThread', threadId]);
      return codex.state();
    },
    ...overrides,
  };
  return codex;
}

test.beforeEach(() => {
  desktopCalls.length = 0;
  desktopHandler = async (...args) => {
    desktopCalls.push(args);
  };
});

test('every available programmable key reaches a supported action path', async () => {
  for (const action of CODEX_PROGRAMMABLE_ACTIONS) {
    const codex = createCodex();
    await assert.doesNotReject(
      executeProgrammedAction({
        commandId: action.id,
        customText: action.kind === 'custom' ? `Prompt for ${action.id}` : undefined,
        threadId: 'thread-1',
        codex,
      }),
      `${action.id} did not reach a supported action path`,
    );
    assert.ok(
      codex.calls.length > 1 || desktopCalls.length > 0,
      `${action.id} produced no observable action`,
    );
  }
});

for (const commandId of [
  'composer.increaseReasoningEffort',
  'composer.decreaseReasoningEffort',
]) {
  test(`${commandId} does not report success when the visible effort control fails`, async () => {
    const codex = createCodex();
    desktopHandler = async (...args) => {
      desktopCalls.push(args);
      throw new Error('Codex reasoning effort did not change');
    };

    await assert.rejects(executeProgrammedAction({
      commandId,
      threadId: 'thread-1',
      codex,
    }), /did not change/);

    assert.equal(codex.calls.some(([name]) => name === 'updateSettings'), false);
  });
}

test('programmable FAST does not report success when the visible speed control fails', async () => {
  const codex = createCodex();
  desktopHandler = async (...args) => {
    desktopCalls.push(args);
    throw new Error('Codex Fast Mode control is not available');
  };

  await assert.rejects(executeProgrammedAction({
    commandId: 'composer.toggleFastMode',
    threadId: 'thread-1',
    codex,
  }), /not available/);

  assert.equal(codex.calls.some(([name]) => name === 'updateSettings'), false);
});

for (const commandId of ['approval.approve', 'approval.decline']) {
  test(`${commandId} cannot send desktop input without a pending approval`, async () => {
    const codex = createCodex({
      async state() {
        this.calls.push(['state']);
        return {
          selectedThreadId: 'thread-1',
          selected: {
            id: 'thread-1',
            fastMode: false,
            reasoningEffort: 'medium',
          },
          pendingApproval: null,
        };
      },
    });

    await assert.rejects(
      executeProgrammedAction({
        commandId,
        threadId: 'thread-1',
        codex,
      }),
      (error) => error.statusCode === 409 && /no pending approval/i.test(error.message),
    );
    assert.deepEqual(desktopCalls, []);
  });
}

test('a keycap name cannot be executed as if it were a command', async () => {
  const codex = createCodex();
  await assert.rejects(
    executeProgrammedAction({
      commandId: 'GIT',
      threadId: 'thread-1',
      codex,
    }),
    /Unknown programmable action: GIT/,
  );
  assert.deepEqual(desktopCalls, []);
});
