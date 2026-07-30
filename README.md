# Microdex

Microdex is an independent React Native client for Codex, inspired by the Codex
Micro control layout: six RGB Task Keys, six Command Keys, an analog joystick,
and a reasoning dial. It runs on iOS and Android through Expo and connects over
your local network to a desktop bridge backed by Codex App Server.

> Independent community project. Not affiliated with OpenAI or Work Louder.

## Why the bridge is required

iOS and Android cannot directly reach the local Codex runtime. The authenticated
bridge starts the installed Codex App Server and:

- reads the six most recent real Codex tasks;
- sends phone messages through the visible Codex desktop composer;
- changes Fast Mode and reasoning for the selected task;
- sends or steers messages directly and follows live task state;
- resolves approval requests and forks conversations;
- opens a selected task through supported `codex://` desktop links.

The microphone key opens the mobile composer. Use iOS or Android keyboard
dictation, then press the Codex key to send without macOS Accessibility access.

## Quick start

Requirements: macOS, Node.js 20+, Codex installed and logged in, and both
devices on the same Wi-Fi network.

1. Install the desktop CLI:

   ```bash
   npm install --global microdex-cli@latest
   ```

2. Install and start the automatic desktop bridge:

   ```bash
   microdex setup
   ```

   The CLI installs a private runtime under `~/.microdex`, registers a macOS
   LaunchAgent, starts the local Codex connection, and displays the pairing QR.

3. Open Microdex on your iPhone, tap **Pair Mac**, then scan the QR inside the
   app. After pairing, the Terminal can be closed: the bridge starts
   automatically when you log into the Mac.

You can check a Mac before pairing with `microdex doctor`, or see whether the
bridge is already active with `microdex status`. Use `microdex pair` for a fresh
one-time QR and `microdex restart` if the background service needs restarting.

During development, `microdex up` still runs the bridge in the current Terminal.

## Native Micro mode

For the closest parity with the physical Codex Micro, start the optional native
channel after `microdex setup`:

```bash
microdex native
```

The command asks before closing and reopening Codex. It does not modify the
Codex app bundle. Codex sees a local synthetic Micro, so the standard Fast,
approval, split, microphone, send, joystick, dial, task-light, and frame-light
messages use Codex's own hardware channel. The six phone keys remain
programmable; actions that do not exist on the physical Micro continue through
the authenticated standard bridge.

Use `microdex native status`, `microdex native test`, or
`microdex native stop` to inspect, verify, or leave the mode.

## How it connects to Codex

The CLI does not ask for OpenAI credentials and does not sign in as the user.
It starts the `codex app-server` runtime bundled with the installed Codex app,
then talks to it over a loopback WebSocket on the Mac. This provides tasks,
settings, approvals, and live state.

Actions that operate the visible desktop interface use the local
`MicrodexDesktop` accessibility companion. The iPhone only connects to the
authenticated Microdex bridge over the local network; Codex and its credentials
remain on the Mac.

No macOS Accessibility permission is needed for the core remote controls.

## Direct Codex scripts

These commands modify the local Codex configuration:

```bash
npm run fast:on
npm run fast:off
npm run fast:status
node bridge/scripts/set-reasoning.mjs high
```

Test without touching your real configuration:

```bash
node bridge/scripts/set-fast.mjs on --config /tmp/microdex-test-config.toml
```

## Security

- Every bridge action requires an authenticated credential stored with mode
  `0600` in `~/.microdex/access-token`.
- The QR contains a separate one-time pairing code, expires after 10 minutes,
  and cannot be reused after a successful claim.
- The persistent bridge credential is returned only by the local pairing
  endpoint and is stored in the iOS Keychain by the app.
- The phone cannot submit arbitrary commands.
- Local hooks use predefined names inside `bridge/hooks/`.

Useful environment variables:

```bash
MICRODEX_TOKEN=a-long-secret npm run bridge
MICRODEX_PORT=3210 npm run bridge
MICRODEX_CONFIG_PATH=/path/to/config.toml npm run bridge
```

## Current limitation

Microdex controls turns that it resumes or starts through its own Codex App
Server connection. The original physical keyboard uses a private first-party
desktop channel, so a third-party app cannot attach to an already in-flight turn
owned by a different desktop process. Select the task in Microdex before sending
new work to keep subsequent status and approvals live.

Expo Go is a development preview. Public distribution will require signed EAS
builds, TestFlight, and Google Play submission.

## Attribution

The optional native channel is adapted from the MIT-licensed
`maxxspotter/codex-micro-app`, including its `node-hid` interception layer based
on Marcel Pociot's MIT-licensed Codex Micro emulator. Both license notices are
included in `bridge/native-shim/`.
