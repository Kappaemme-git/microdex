import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridgeSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);
const queueSource = await readFile(
  new URL('../lib/remote-message-queue.mjs', import.meta.url),
  'utf8',
);
const desktopSource = await readFile(
  new URL('../native/MicrodexDesktop.swift', import.meta.url),
  'utf8',
);

test('mobile text is queued before it reaches the visible Codex desktop composer', () => {
  assert.match(bridgeSource, /messageQueue\.enqueue\(\{ threadId: body\.threadId, text \}\)/);
  assert.match(bridgeSource, /url\.pathname === '\/api\/remote\/queue'/);
  assert.match(bridgeSource, /return sendJson\(response, 200, queueState\(\)\)/);
  assert.match(bridgeSource, /executeCodexDesktopAction\('send-text', text\)/);
  assert.match(queueSource, /status: 'queued'/);
  assert.match(queueSource, /threadIsBusy\(state, item\.threadId\)/);
  assert.doesNotMatch(bridgeSource, /codex\.sendText\(text/);
  assert.match(desktopSource, /func sendTextToComposer/);
  assert.match(desktopSource, /postKey\(CGKeyCode\(kVK_Return\)\)/);
});
