import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiagnosticReport } from '../lib/diagnostics.ts';

test('diagnostics omit credentials, URLs, errors, task content, and messages', () => {
  const secret = 'PRIVATE-TOKEN-KEY-TASK-CONTENT';
  const report = createDiagnosticReport({
    generatedAt: '2026-08-07T12:00:00.000Z',
    app: { version: '1.0.0', buildNumber: '25' },
    platform: 'ios',
    refreshFailed: true,
    networkType: secret,
    networkConnected: true,
    transport: 'secure-remote',
    status: {
      connected: true,
      bridge: { name: 'Microdex Bridge', version: '0.1.15', protocolVersion: 2 },
      capabilities: {
        verifiedSettings: true,
        remoteChat: true,
        taskControl: true,
        programmableActions: 30,
        desktopAutomation: true,
        actionAvailability: true,
      },
      connection: { remoteAccess: secret, remoteReady: true, transport: 'relay' },
      fastMode: false,
      reasoningEffort: 'medium',
      configPath: `/Users/private/${secret}`,
      platform: 'darwin',
      desktop: { available: true, trusted: true, running: true, error: secret, reason: secret },
      remote: null,
    },
    remote: {
      online: true,
      selectedThreadId: secret,
      selected: {
        id: secret,
        name: secret,
        task: secret,
        project: secret,
        status: 'idle',
        updatedAt: 0,
        fastMode: false,
        reasoningEffort: 'medium',
        supportedReasoningEfforts: ['medium'],
      },
      threads: [],
      messageQueue: [{ id: secret, threadId: secret, text: secret, status: 'queued', createdAt: 0 }],
      pendingApproval: { requestId: secret, threadId: secret, reason: secret, command: secret },
      commandResult: {
        action: secret,
        applied: false,
        verified: false,
        evidence: 'desktop',
        desktopMirrored: false,
        warning: secret,
      },
    },
  });

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.equal(report.connection.networkType, 'unknown');
  assert.equal(report.connection.remoteAccess, 'unknown');
  assert.equal(report.desktop?.hasIssue, true);
  assert.equal(report.remote.lastCommand?.hasWarning, true);
});
