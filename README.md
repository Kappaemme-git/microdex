# Microdex

<p align="center">
  <img src="microdex-preview.png" width="340" alt="Microdex Preview">
</p>

<h3 align="center">The missing mobile companion for Codex.</h3>

<p align="center">
Control your local Codex runtime directly from your iPhone.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/iOS-Supported-black?style=for-the-badge&logo=apple">
  <img src="https://img.shields.io/badge/Open%20Source-MIT-blue?style=for-the-badge">
</p>

---

Microdex is an independent React Native client for Codex, inspired by the Codex
Micro control layout: six RGB Task Keys, six Command Keys, an analog joystick,
and a reasoning dial.

It runs on iOS through Expo and connects to a desktop bridge backed by Codex
App Server. The pairing QR prefers an encrypted remote tunnel, so the phone can
use Wi-Fi or mobile data without sharing the Mac's network.

> Independent community project. Not affiliated with OpenAI or Work Louder.

---

## ✨ Features

- 📱 Control Codex remotely from your iPhone
- 🎮 Codex Micro-inspired interface
- ⚡ Fast Mode toggle
- 🧠 Reasoning control
- 🎤 Voice input
- ✅ Approval requests
- 🔄 Live task updates
- 🌈 RGB Task Keys
- 🌍 Secure remote control over Wi-Fi or mobile data

---

## 🚀 Quick Start

Requirements: macOS, Node.js 20+, and Codex installed and logged in. The phone
and Mac do not need to use the same Wi-Fi network.

1. Install the desktop CLI:

```bash
npm install --global microdex-cli@latest
```

2. Install and start the automatic desktop bridge:

```bash
microdex setup
```

The CLI installs a private runtime under `~/.microdex`, registers a macOS
LaunchAgent, starts the local Codex connection and a secure outbound tunnel,
then displays the pairing QR. No router port or public IP is required.

3. Open Microdex on your iPhone, tap **Pair Mac**, then scan the QR inside the
app. After pairing, the Terminal can be closed: the bridge starts
automatically when you log into the Mac.

You can check a Mac before pairing with `microdex doctor`, or see whether the
bridge is already active with `microdex status`. Use `microdex pair` for a fresh
one-time QR and `microdex restart` if the background service needs restarting.

During development, `microdex up` still runs the bridge in the current Terminal.

---

## 🌉 Why the bridge is required

iOS cannot directly reach the local Codex runtime. The authenticated
bridge starts the installed Codex App Server and:

- reads the six most recent real Codex tasks;
- sends phone messages through the visible Codex desktop composer;
- changes Fast Mode and reasoning for the selected task;
- sends or steers messages directly and follows live task state;
- resolves approval requests and forks conversations;
- opens a selected task through supported `codex://` desktop links.

The microphone key opens the mobile composer. Use iOS keyboard
dictation, then press the Codex key to send without macOS Accessibility access.

---

## 🎮 Native Micro Mode

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

---

## 🔗 How it connects to Codex

The CLI does not ask for OpenAI credentials and does not sign in as the user.
It starts the `codex app-server` runtime bundled with the installed Codex app,
then talks to it over a loopback WebSocket on the Mac. This provides tasks,
settings, approvals, and live state.

Actions that operate the visible desktop interface use the local
`MicrodexDesktop` accessibility companion. The iPhone connects to the
authenticated Microdex bridge through HTTPS/WSS; Codex and its login
credentials remain on the Mac.

No macOS Accessibility permission is needed for the core remote controls.

---

## ⚙️ Direct Codex Scripts

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

---

## 🔒 Security

- Every bridge action requires an authenticated credential stored with mode `0600` in `~/.microdex/access-token`.
- The QR contains a separate one-time pairing code, expires after 10 minutes, and cannot be reused after a successful claim.
- The persistent bridge credential is returned only after the one-time pairing exchange and is stored in the iOS Keychain by the app.
- Remote access uses an outbound-only Cloudflare Quick Tunnel and never opens a router port.
- The bundled `cloudflared` archive is pinned and verified with SHA-256 before execution.
- Public HTTP bridge addresses are rejected; remote pairing must use HTTPS.
- The phone cannot submit arbitrary commands.
- Local hooks use predefined names inside `bridge/hooks/`.

Useful environment variables:

```bash
MICRODEX_TOKEN=a-long-secret npm run bridge
MICRODEX_PORT=3210 npm run bridge
MICRODEX_CONFIG_PATH=/path/to/config.toml npm run bridge
MICRODEX_REMOTE_ACCESS=0 npm run bridge
MICRODEX_CLOUDFLARED_BIN=/path/to/cloudflared npm run bridge
```

Remote access is currently a beta powered by Cloudflare Quick Tunnels. Quick
Tunnel hostnames are temporary and have no uptime guarantee. If the tunnel or
Mac bridge restarts and receives a new hostname, run `microdex pair` and scan
the new QR. If Cloudflare temporarily rate limits tunnel creation, Microdex
keeps the local QR available and retries the remote connection after a cooldown.
Cloudflare's service transports the encrypted tunnel traffic; a stable
production relay or named tunnel will replace this beta path before general
availability.

---

## ⚠️ Current Limitation

Microdex controls turns that it resumes or starts through its own Codex App
Server connection. The original physical keyboard uses a private first-party
desktop channel, so a third-party app cannot attach to an already in-flight turn
owned by a different desktop process. Select the task in Microdex before sending
new work to keep subsequent status and approvals live.

Expo Go is a development preview. Public distribution will require signed EAS
builds and TestFlight.

---

## ❤️ Attribution

The optional native channel is adapted from the MIT-licensed
`maxxspotter/codex-micro-app`, including its `node-hid` interception layer based
on Marcel Pociot's MIT-licensed Codex Micro emulator. Both license notices are
included in `bridge/native-shim/`.
