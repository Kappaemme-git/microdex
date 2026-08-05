import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controllerSource = await readFile(
  new URL('../app/index.tsx', import.meta.url),
  'utf8',
);
const demoSource = await readFile(
  new URL('../lib/demo.ts', import.meta.url),
  'utf8',
);
const appConfig = JSON.parse(await readFile(
  new URL('../app.json', import.meta.url),
  'utf8',
));
const privacyPolicy = await readFile(
  new URL('../../PRIVACY.md', import.meta.url),
  'utf8',
);
const supportPolicy = await readFile(
  new URL('../../SUPPORT.md', import.meta.url),
  'utf8',
);
const reviewRunbook = await readFile(
  new URL('../../docs/APP_REVIEW_RUNBOOK.md', import.meta.url),
  'utf8',
);

test('App Review can open a local demo containing only fictional tasks', () => {
  assert.match(controllerSource, /Explore without a Mac/);
  assert.match(controllerSource, /enterDemo/);
  assert.doesNotMatch(controllerSource, /gateBrandBar/);
  assert.match(controllerSource, /<Text style=\{styles\.gateTitle\}>Control Codex<\/Text>/);
  assert.match(demoSource, /Microdex Demo/);
  assert.match(demoSource, /Release Demo/);
  assert.doesNotMatch(demoSource, /Kappaemme|francesco|mistero/i);
});

test('live pairing and controls require revocable AI data-processing consent', () => {
  assert.match(controllerSource, /STORAGE_AI_CONSENT/);
  assert.match(controllerSource, /How live controls process content/);
  assert.match(controllerSource, /Codex and OpenAI process that content/);
  assert.match(controllerSource, /if \(!aiConsent\)/);
  assert.match(controllerSource, /revokeAiConsent/);
  assert.match(privacyPolicy, /explicit consent/i);
});

test('Settings exposes privacy, support, licenses, about, and app version', () => {
  for (const label of [
    'Privacy Policy',
    'Support',
    'Licenses & Attributions',
    'About Microdex',
  ]) {
    assert.match(controllerSource, new RegExp(label));
  }
  assert.match(controllerSource, /appInfo\.version/);
  assert.match(controllerSource, /appInfo\.buildNumber/);
});

test('public policy and support links use stable main-branch URLs', () => {
  assert.match(controllerSource, /microdex\/blob\/main\/PRIVACY\.md/);
  assert.match(controllerSource, /microdex\/blob\/main\/SUPPORT\.md/);
  assert.doesNotMatch(controllerSource, /codex\/voice-mode-official-icons/);
  assert.match(supportPolicy, /issues\/new/);
  assert.match(supportPolicy, /security\/advisories\/new/);
  assert.match(privacyPolicy, /blob\/main\/SUPPORT\.md/);
});

test('the release uses an original Microdex icon and independent positioning', () => {
  assert.equal(appConfig.expo.icon, './assets/images/icon-microdex-faceplate-fullbleed.png');
  assert.equal(appConfig.expo.ios.supportsTablet, false);
  assert.match(controllerSource, /independent open-source companion/i);
  assert.match(controllerSource, /not affiliated with or endorsed by OpenAI or Work Louder/i);
});

test('the reviewer runbook requires live access, fictional data, and revocation', () => {
  assert.match(reviewRunbook, /microdex review-pair/);
  assert.match(reviewRunbook, /fictional tasks/i);
  assert.match(reviewRunbook, /single-use/i);
  assert.match(reviewRunbook, /microdex revoke-all/);
  assert.match(reviewRunbook, /written authorization/i);
});
