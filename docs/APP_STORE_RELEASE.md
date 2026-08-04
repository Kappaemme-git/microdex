# Microdex App Store release checklist

This checklist describes the current app and relay. Revisit it whenever an SDK,
analytics service, permission, or data flow changes.

## Export compliance

Microdex implements XChaCha20-Poly1305 through `@noble/ciphers` in addition to
using operating-system HTTPS. Do not hard-code
`ITSAppUsesNonExemptEncryption=false` before completing Apple's export
compliance questionnaire.

In App Store Connect, open **App Information → App Encryption Documentation**
and answer using the actual implementation: the app uses an industry-standard
algorithm implemented outside the Apple operating system and does not use a
proprietary algorithm. Apple determines whether documentation is required for
the selected storefronts. Distribution in France may require a French
encryption declaration. If Apple supplies an export compliance code, add it as
`ITSEncryptionExportComplianceCode` in `mobile/app.json` before the final build.

Official references:

- https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance
- https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption/
- https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations

## App privacy answers

- No advertising or cross-app tracking.
- No Microdex account, contact list, location, payment, or phone audio collection.
- QR camera frames stay on the phone.
- Codex content is processed in real time and end-to-end encrypted through the
  relay; the Microdex operator cannot read it.
- Disclose any network metadata retained by Cloudflare or Expo according to the
  production logging and update settings in effect when the build is submitted.
- Use the public URL of `PRIVACY.md` as the App Store privacy policy URL until a
  dedicated project site is available.

Apple's definition of “collect” and current disclosure rules:
https://developer.apple.com/app-store/app-privacy-details/

## Final technical gate

1. Deploy the tested production relay and record its Worker version.
2. Publish the matching `microdex-cli` version to npm.
3. Install that public CLI on a clean macOS user and pair a fresh TestFlight app.
4. Test Wi-Fi → mobile-data switching, Mac sleep/wake, bridge restart, expired
   QR, replay rejection, `revoke-all`, and `uninstall --purge`.
5. Confirm only the camera permission is requested on the phone and that Voice
   Chat audio remains on the Mac.
6. Run TypeScript, lint, all mobile/bridge/relay tests, Expo Doctor, dependency
   audit, secret scan, and `npm pack --dry-run`.
7. Review App Store screenshots, support URL, privacy URL, export compliance,
   and the privacy nutrition label before submission.
