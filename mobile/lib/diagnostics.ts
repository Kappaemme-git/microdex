import type { BridgeStatus, RemoteState } from './bridge.ts';

type DiagnosticInput = {
  generatedAt: string;
  app: {
    version: string;
    buildNumber: string;
  };
  platform: string;
  status: BridgeStatus | null;
  remote: RemoteState | null;
  refreshFailed: boolean;
  networkType: string | null | undefined;
  networkConnected: boolean | null | undefined;
  transport: 'secure-remote' | 'local';
};

const REMOTE_ACCESS_STATES = new Set([
  'idle',
  'disabled',
  'installing',
  'connecting',
  'verifying',
  'ready',
  'cooldown',
  'offline',
  'error',
  'closed',
]);

const NETWORK_TYPES = new Set([
  'UNKNOWN',
  'NONE',
  'WIFI',
  'CELLULAR',
  'BLUETOOTH',
  'ETHERNET',
  'WIMAX',
  'VPN',
  'OTHER',
]);

function knownValue(value: string | null | undefined, allowed: Set<string>) {
  if (!value) return 'unknown';
  return allowed.has(value) || allowed.has(value.toUpperCase()) ? value : 'unknown';
}

/**
 * Build diagnostics from an explicit allowlist. Free-form errors, URLs,
 * credentials, task content, messages, and encryption material are omitted.
 */
export function createDiagnosticReport(input: DiagnosticInput) {
  const { status, remote } = input;
  const capabilities = status?.capabilities;
  const desktop = status?.desktop;
  const command = remote?.commandResult;

  return {
    microdexDiagnostics: 1,
    generatedAt: input.generatedAt,
    app: {
      version: input.app.version,
      buildNumber: input.app.buildNumber,
      platform: input.platform,
    },
    bridge: status?.bridge
      ? {
          name: status.bridge.name,
          version: status.bridge.version,
          protocolVersion: status.bridge.protocolVersion,
        }
      : {
          name: 'Microdex Bridge',
          version: 'legacy-or-unavailable',
          protocolVersion: 1,
        },
    capabilities: capabilities
      ? {
          verifiedSettings: capabilities.verifiedSettings,
          remoteChat: capabilities.remoteChat,
          taskControl: capabilities.taskControl,
          programmableActions: capabilities.programmableActions,
          programmableAssignments: capabilities.programmableAssignments ?? false,
          encoderModes: capabilities.encoderModes ?? false,
          desktopAutomation: capabilities.desktopAutomation,
          actionAvailability: capabilities.actionAvailability,
          visibleDesktopRouting: capabilities.visibleDesktopRouting ?? false,
          nativeHardware: capabilities.nativeHardware ?? false,
          endToEndEncryption: capabilities.endToEndEncryption ?? false,
        }
      : null,
    desktop: desktop
      ? {
          available: Boolean(desktop.available),
          trusted: Boolean(desktop.trusted),
          running: Boolean(desktop.running),
          hasIssue: Boolean(desktop.error || desktop.reason),
        }
      : null,
    connection: {
      connected: Boolean(status),
      refreshFailed: input.refreshFailed,
      networkType: knownValue(input.networkType, NETWORK_TYPES),
      networkConnected: Boolean(input.networkConnected),
      transport: input.transport,
      remoteAccess: knownValue(status?.connection?.remoteAccess, REMOTE_ACCESS_STATES),
      remoteReady: Boolean(status?.connection?.remoteReady),
    },
    remote: {
      online: Boolean(remote?.online),
      selectedTask: Boolean(remote?.selectedThreadId),
      lastCommand: command
        ? {
            present: true,
            applied: command.applied,
            verified: command.verified,
            confirmed: command.confirmed ?? null,
            evidence: command.evidence,
            desktopMirrored: command.desktopMirrored,
            hasWarning: Boolean(command.warning),
          }
        : null,
    },
  };
}
