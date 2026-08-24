# Microdex App Review runbook

Use this for every App Store submission that Apple may test against a real Mac.
The app's **Explore without a Mac** path is the immediate no-login walkthrough, but it does
not replace live reviewer access unless Apple has approved demo-only review in
advance.

## Prepare the reviewer environment

1. Use a dedicated macOS user or clean review Mac, not a personal workstation.
2. Sign in to Codex with a review-only account permitted for this purpose.
3. Create only fictional tasks with no personal, customer, production, or
   confidential content.
4. Install the exact public CLI version referenced by the submitted build and
   run `microdex doctor`, `microdex setup`, and `microdex status`.
5. Keep the Mac awake, online, connected to power, and with Codex open for the
   expected review window.

## Create the reviewer QR

Run:

```bash
microdex review-pair
```

The QR is end-to-end encrypted, single-use, and expires after thirty days. A
bridge restart, a new pairing request, or `microdex revoke-all` invalidates it.
Generate it as close to submission as practical.

Attach the QR image privately in App Store Connect together with the exact CLI
and bridge versions. Do not paste the decoded URL in a public issue, repository,
screenshot, or release note. Interface icons come from a custom SVG collection
used with the creator's permission and are not presented as official OpenAI or
Codex assets; the asset notice is available from **Settings → Licenses &
Attributions**.

Suggested review instructions:

1. Open Microdex and tap **Explore without a Mac** to inspect every control without a Mac.
2. To verify live control, exit the demo, tap **Pair Mac**, review the data-flow
   notice, tap **Continue**, then scan the private QR attached to the review.
3. Select a fictional task and use Fast Mode, reasoning, chat, and Voice Chat.
4. Voice Chat and dictation execute on the review Mac; the iPhone does not
   capture or relay microphone audio.

For the resubmission after the August 24, 2026 review:

- confirm **China mainland is deselected** in Availability;
- explain that the subtitle and promotional text no longer use third-party
  product names;
- state that the scanner now displays progress on every tap, waits for modal
  dismissal on iOS/iPadOS compatibility mode, and presents a visible recovery
  dialog with an Open Settings action when camera access is unavailable;
- test the clean-install scanner flow on both iPhone and iPad compatibility mode.

## Revoke after review

Run:

```bash
microdex revoke-all
```

Confirm the submitted QR no longer pairs, then remove the review account and
review-only data. Generate a new QR for every resubmission.
