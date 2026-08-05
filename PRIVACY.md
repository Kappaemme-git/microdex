# Microdex Privacy Policy

Effective date: August 4, 2026

Microdex is an independent, open-source mobile companion for a Codex runtime
running on your own Mac. Microdex does not require a Microdex account and does
not include advertising, third-party tracking, or product analytics.

The in-app demo contains only fictional tasks and runs entirely on the device.
It does not contact a Mac, Cloudflare, Codex, or OpenAI.

## Data handled by Microdex

Microdex processes the commands you tap, messages you choose to send, and the
task state returned by your Mac so the remote controls can work. With a current
app and bridge, that content is end-to-end encrypted between the paired phone
and Mac. The relay carries ciphertext and cannot read the content.

Before live pairing or remote control is enabled, the app presents this data
flow and asks for explicit consent. Declining leaves the live connection
disabled. Consent can be reviewed or revoked at any time from **Settings → AI
data processing**; revocation blocks new live commands and messages until the
user consents again.

The iPhone stores the paired bridge address, bridge credential, and encryption
key in the iOS Keychain. The Mac stores its bridge credential, relay identity,
and paired-device encryption keys under `~/.microdex` with owner-only file
permissions. Microdex does not upload these secrets to a Microdex database.

The camera is used only to scan a pairing QR. Microdex does not save or upload
camera images. Voice Chat and dictation run on the Mac through Codex; phone
audio is not recorded or relayed by Microdex.

## Relay and service providers

Microdex does not authorize a service provider to use user content for
advertising or unrelated profiling. The project only selects providers that are
expected to protect personal data to the same or an equivalent standard as this
policy, subject to their published terms and applicable law.

The public relay is hosted on Cloudflare. Cloudflare processes network metadata
needed to deliver and protect requests, such as IP address, request time,
random relay path, response status, and encrypted payload size. Operational
logs may retain limited request metadata according to the configured Cloudflare
retention period. The relay stores a one-way digest of the Mac connector secret
until the relay room is purged; it does not store message plaintext, phone
credentials, or end-to-end encryption keys.

The distributed app may contact Expo services to check for signed app updates
and Apple services used by iOS and TestFlight. Their processing is governed by
their own privacy terms.

When you direct Microdex to send content to Codex, your local Codex runtime and
OpenAI process that content under the terms and privacy settings of your OpenAI
account. Microdex does not receive your OpenAI login credentials.

## Retention and deletion

Microdex has no operator-controlled user account or message database. Pairing
data remains on your phone and Mac until you remove it. **Forget this Mac and
consent** removes the phone pairing and consent record. Revoking only the
consent keeps the pairing but blocks every new live action. `microdex revoke-all`
invalidates every paired phone and rotates the Mac credential. `microdex
uninstall --purge` removes local bridge credentials and requests deletion of the
durable relay room.

## Contact and changes

Questions or privacy requests can be opened in the public Microdex repository:
https://github.com/Kappaemme-git/microdex/issues

Material changes to this policy will be published in the repository with an
updated effective date.
