# Microdex App Store metadata

Use this document as the source of truth for the first public iOS release.
Replace no text with beta, trial, preview-release, or test language in the public
store listing.

## Product page

**Name**

Microdex

**Subtitle**

Control Codex from your phone

**Primary category**

Developer Tools

**Secondary category**

Productivity

**Promotional text**

Control your Codex workflow from your iPhone with secure pairing, programmable
keys, chat, Voice Chat controls, and an offline experience that works without a
Mac.

**Keywords**

developer,remote,mac,productivity,workflow,voice,automation,controller,coding,companion

**Description**

Microdex turns your iPhone into a focused control surface for a Codex runtime
running on your own Mac.

Switch tasks, send messages, adjust reasoning, use Fast Mode, handle approval
requests, control Voice Chat on the Mac, and assign actions to a customizable
set of keys. A built-in offline experience lets you explore the complete
interface using fictional tasks before pairing a computer.

Pairing uses a one-time QR code. Commands, messages, and task state are
end-to-end encrypted between the paired iPhone and Mac. The relay carries
encrypted data and does not receive the encryption keys. The iPhone does not
capture or relay Voice Chat audio.

Live control requires a user-owned Mac with macOS, Node.js 20.19 or newer, and
Codex installed and signed in. The phone and Mac do not need to share the same
Wi-Fi network. Microdex does not include a Codex or OpenAI account.

Microdex is free and open source. It is an independent companion and is not
affiliated with or endorsed by OpenAI or Work Louder.

**Support URL**

https://github.com/Kappaemme-git/microdex/blob/main/SUPPORT.md

**Privacy Policy URL**

https://github.com/Kappaemme-git/microdex/blob/main/PRIVACY.md

**Marketing URL**

https://github.com/Kappaemme-git/microdex

## Screenshot set

Use fictional task names and content in every image. Capture the production
build rather than Expo Go. Do not show personal notifications, account names,
pairing QR codes, bridge URLs, tokens, or real task content.

1. Main controller — `Control Codex from your phone`
2. Task and chat drawer — `Your Codex workflow, anywhere`
3. Voice Chat control — `Control Voice Chat on your Mac`
4. Programmable keys — `Build your own control deck`
5. Secure pairing — `One scan. End-to-end encrypted.`

Screenshots must show the app in use. The onboarding screen can support the set
but must not be the only product image.

## Notes for App Review

Microdex is an independent control surface for a Codex runtime running on a
user-owned Mac. It is not a remote desktop client: it does not mirror or stream
the Mac display, does not stream audio, and does not expose a software store or
account-management interface. All Codex execution occurs on the review Mac.
The iPhone sends a fixed set of user-selected commands and receives encrypted
task state.

The app can be reviewed immediately without an account or external hardware:

1. Open Microdex.
2. Tap **Explore without a Mac**.
3. Use the fictional tasks to test task switching, programmable controls, chat,
   Fast Mode, reasoning, approvals, forking, and simulated Voice Chat state.

The offline experience never contacts a Mac, Cloudflare, Codex, or OpenAI.

To test the live integration:

1. Tap **Pair a real Mac**.
2. Review the data-processing disclosure and tap **Continue**.
3. Scan the private, single-use reviewer QR attached to this submission.
4. Select one of the fictional tasks on the dedicated review Mac.
5. Test chat, Fast Mode, reasoning, approvals, and Voice Chat controls.

The dedicated review Mac will remain awake, powered, online, and signed in to a
review-only Codex account during review. The submitted QR expires after seven
days, is single-use, and will be revoked after review. Voice Chat and dictation
execute on the Mac; the iPhone does not request microphone access or capture
phone audio.

The app uses XChaCha20-Poly1305 implemented through `@noble/ciphers` for
end-to-end encryption in addition to operating-system HTTPS. Written
authorization for the licensed keycap artwork and relevant third-party
integration is attached to the review information.

## App Privacy working answers

Confirm these answers against the production Cloudflare, Expo, Apple, and
OpenAI behavior in effect on submission day.

- Tracking: No.
- Advertising: No.
- Camera images: Not collected; frames remain on-device for QR scanning.
- Phone audio: Not collected; Voice Chat and dictation remain on the Mac.
- Other User Content: Used for app functionality when the user intentionally
  sends messages or commands to Codex through the paired Mac.
- Network and diagnostic metadata: Disclose any metadata retained by
  Cloudflare or Expo for app functionality, security, or diagnostics.
- Do not choose **Data Not Collected** while production observability retains
  request metadata.

## Required attachments

- Fresh QR generated by the exact public `microdex-cli` version.
- Exact CLI, bridge, relay Worker, app version, and build number.
- Written authorization for third-party keycap artwork.
- Written authorization or terms evidence for the Codex integration.
- App Review contact name, phone number, and email in App Store Connect.

## Release controls

- Use manual release after approval.
- Do not introduce unreviewed features through Expo Updates; use OTA updates
  only for compatible fixes within the reviewed app functionality.
- Keep the relay and dedicated review Mac online until the review finishes.
- After review, run `microdex revoke-all` and remove all reviewer-only data.
