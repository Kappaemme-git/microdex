# Contributing to Microdex

Thanks for looking. Read this first — the setup requirements are unusual and
there is no way around them.

## What you need before you can run anything

- **A Mac.** The bridge drives the Codex desktop app through macOS
  accessibility APIs. There is no Linux or Windows equivalent.
- **The Codex desktop app installed and logged in.** The bridge starts the
  `codex app-server` runtime bundled inside the app. Without it the bridge has
  nothing to talk to.
- **Accessibility permission** granted to the `MicrodexDesktop` companion in
  System Settings → Privacy & Security → Accessibility.
- **An iPhone or Android device on the same Wi-Fi**, with Expo Go for
  development.

Without all four you can still work on the mobile UI, but you cannot verify that
a command actually reaches Codex, and that is where most of the bugs live.

## Running it

```bash
git clone <your-fork>
cd Microcodex
npm install
cd mobile && npm install && cd ..

# Bridge and Expo together, with the token wired to the app
npm run app
```

Scan the QR from Expo Go. Pairing is automatic in this mode.

## Before opening a pull request

```bash
npm test                          # bridge suite
cd mobile && npx tsc --noEmit     # types
cd mobile && npm run lint
```

Five tests in the bridge suite need macOS with Codex installed and will fail
elsewhere. If your run fails only on those, you are fine.

## Understanding the two halves

Changes land in two places that update differently, and this trips up everyone:

- **`bridge/` and `bridge/native/`** run on the Mac and ship through the
  `microdex-cli` npm package.
- **`mobile/`** runs on the phone and ships through TestFlight or an EAS update.

An app change with an old bridge, or the reverse, produces keys that silently do
nothing. Say in your pull request which half you touched.

## How the desktop control actually works

The Codex app hosts its interface in a Chromium web view. Those runtimes expose
**only the menu bar** to accessibility clients until a client asks for the window
content through the private `AXManualAccessibility` attribute. The companion does
that in `accessibilityElement(for:)`, and every application element must go
through that helper. Skip it and your lookups traverse an empty tree, find
nothing, and report success — which is exactly the bug this project spent a day
tracking down. There is a test that fails if a raw
`AXUIElementCreateApplication` call reappears.

When you need to know what the tree really contains:

```bash
node bridge/scripts/diagnose-desktop.mjs --actions
```

It dumps the accessibility tree, separates menu bar from window content, opens
the model picker and its submenus, and checks the labels the code depends on.
Nothing it does is destructive. Attach its output to any bug report about a
control that does not respond.

## Things that look wrong but are not

Please do not "clean up" these without reading why they exist:

- **`verified: true` in `withVerifiedCommand`** looks redundant next to
  `confirmed`. Older app builds read `verified` and would show an error on every
  key that actually works.
- **`max` and `ultra` in `findModelPicker`'s title list**, while both are absent
  from the effort ladder. Those strings *recognize* the model popup, which Codex
  names after the current model. Recognizing is not selecting.
- **Three slashes in `microdex:///pair`.** Two slashes parse `pair` as the host
  and leave the path empty, so Expo Router cannot match it and the app opens on
  "Unmatched Route".
- **UI labels matched with "equal, or the label followed by a space".** Codex
  packs a level and its explanation into one accessibility title, for example
  `Fast 1.5x speed, more usage`.

Each of these is covered by a test. If a test fails after your change, read the
comment above the assertion before changing the assertion.

## Reviewing and merging

Pull requests are proposals, not merges. Anything touching `bridge/native/` or
`bridge/lib/` gets read line by line, because the companion runs with
Accessibility permission on a contributor's Mac — effectively keyboard and screen
access. Publishing to npm stays with the maintainer.

## Security

Do not open a public issue for a security problem. Report it privately to the
maintainer instead.
