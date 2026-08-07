# TestFlight build 25 QA

Date: 2026-08-07

## Test 1 — Clean launch and offline experience

Status: Passed. Reported polish issues are fixed in code; physical retest pending.

Verified:

- The onboarding opens correctly.
- The offline experience is usable without pairing a Mac.
- No other functional or visual problems were observed during this pass.

Corrections implemented after the TestFlight pass:

- Remove from the customizable action picker every command that is already
  available as a default key. This includes the duplicate `Back` and `Forward`
  actions and prevents the same control from being added twice.
- Make the `Browser` action open Codex's in-app browser panel instead of its
  current behavior.
- Give actions distinct icons where the current action picker reuses the same
  icon for different commands.

Physical retest for the next build:

- Confirm every action appears exactly once.
- Confirm `Browser` opens the intended Codex panel.
- Confirm different actions no longer look identical unless they intentionally
  represent the same function.

## Test 2 — Real pairing and mobile data

Status: Passed.

Verified:

- The paired Mac remains available after fully closing and reopening Microdex.
- The connection works over mobile data with the phone disconnected from
  Wi-Fi.
- Pairing does not need to be repeated after reopening the app.

## Test 3 — Messages and Send action

Status: Passed.

Verified:

- The on-screen Send button sends text written in the Microdex chat.
- The default Send key sends text written in the Microdex chat.
- The default Send key sends text already entered directly in the Codex input
  on the Mac.
- The default Send key does nothing unintended when both the Microdex and Mac
  inputs are empty.

## Test 4 — Customizable keys

Status: Passed.

Verified:

- A customizable key can be assigned a different action.
- The selected icon remains consistent between the action picker and the
  keypad after saving.
- Custom key assignments persist after closing and reopening the app.
- Multiple custom keys can be configured.
- `Clear All` removes the customizable assignments without removing the
  default controls.
- A key can be assigned again after using `Clear All`.

## Test 5 — Dictation and Voice Mode

Status: Passed. Voice Mode closing was corrected in code; physical retest pending.

Verified:

- Pressing and holding Dictation activates Mac-managed dictation and spoken
  input is entered correctly.

- Voice Mode opens the actual Codex Voice Mode instead of Dictation.
- Starting Voice Mode does not show a false Mac timeout.
- Voice Mode can be started again after ending the first session.
- Dictation and Voice Mode use clearly distinct icons.

Correction implemented after the TestFlight pass:

- The Voice Mode key is now a predictable tap toggle: tap once to start and
  tap again to end. The unreliable long-press/mute interaction was removed.

## Test 6 — Codex controls

Status: Passed.

Verified:

- Reasoning level changes work.
- Fast Mode can be enabled and disabled.
- Previous and next task navigation works.
- Sidebar, Skills, Reviews, and Bottom Panel controls work.
- Approval and rejection controls work when a request is available.

The separate `Browser` panel issue remains tracked under Test 1.

## Test 7 — Settings, privacy, and consent

Status: Passed. Both follow-up items were resolved in code.

Verified:

- Light and dark themes work.
- Public information links open correctly.
- `Copy diagnostics` produces a report.
- Revoking consent disconnects and blocks the live connection as intended.
- Granting consent again reconnects successfully without requiring a new
  pairing.

Corrections implemented after the TestFlight pass:

- The outdated Microdex logo was removed from the About/Codex information area.
- `Copy diagnostics` now builds an explicit allowlisted report. Regression tests
  prove that credentials, pairing URLs, encryption keys, tokens, task content,
  messages, and free-form errors are not copied.

## Test 8 — Connection recovery

Status: Passed.

Verified:

- Microdex reconnects automatically after airplane mode is enabled and then
  disabled.
- The connection recovers over mobile data without another QR scan.
- The app resumes from the background and live commands continue working.
- Voice Mode can be started again after ending a previous session.

## Test 9 — Forget Mac and fresh pairing

Status: Passed.

Verified:

- `Forget Mac` removes the existing pairing.
- The app returns to the unpaired state as expected.
- Scanning a fresh QR code pairs the phone again successfully.
- The newly paired connection works normally.

## Automated regression status

Status: Passed.

- Mobile tests: 71 passed.
- Bridge tests: 120 passed.
- Relay tests: 6 passed.
- TypeScript check: passed.
- Lint: passed with no warnings.
- Patch whitespace validation: passed.

## Final physical retest for the next build

- Confirm the customizable picker no longer offers fixed controls.
- Confirm `Browser` opens Codex's in-app Browser panel.
- Confirm action icons are distinct in both the picker and keypad.
- Confirm tapping an active Voice Mode key ends the session cleanly.
- Confirm the About/Codex information area no longer shows the old logo.
