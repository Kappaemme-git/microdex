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
const storeConfig = JSON.parse(await readFile(
  new URL('../store.config.json', import.meta.url),
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
const thirdPartyNotices = await readFile(
  new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url),
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
  assert.doesNotMatch(controllerSource, /MicrodexMark/);
});

test('copied diagnostics are built from an explicit secret-free allowlist', () => {
  const diagnostics = controllerSource.slice(
    controllerSource.indexOf('const copyDiagnostics'),
    controllerSource.indexOf('const forgetPairedMac'),
  );
  assert.match(diagnostics, /createDiagnosticReport/);
  assert.doesNotMatch(diagnostics, /latestStatus\?\.desktop/);
  assert.doesNotMatch(diagnostics, /remote\?\.commandResult/);
  assert.doesNotMatch(diagnostics, /refreshError/);
});

test('public policy and support links use stable main-branch URLs', () => {
  assert.match(controllerSource, /microdex\/blob\/main\/PRIVACY\.md/);
  assert.match(controllerSource, /microdex\/blob\/main\/SUPPORT\.md/);
  assert.match(supportPolicy, /issues\/new/);
  assert.match(supportPolicy, /security\/advisories\/new/);
  assert.match(privacyPolicy, /blob\/main\/SUPPORT\.md/);
});

test('the release uses an original Microdex icon and independent positioning', () => {
  assert.equal(appConfig.expo.icon, './assets/images/icon-microdex-faceplate-fullbleed.png');
  assert.equal(appConfig.expo.ios.supportsTablet, false);
  assert.equal(appConfig.expo.ios.config.usesNonExemptEncryption, true);
  assert.match(controllerSource, /independent open-source companion/i);
  assert.match(controllerSource, /not affiliated with or endorsed by OpenAI or Work Louder/i);
});

test('source-controlled App Store metadata is English-only and manually released', () => {
  assert.equal(storeConfig.apple.info['en-US'].title, 'Microdex');
  assert.equal(
    storeConfig.apple.info['en-US'].subtitle,
    'Control Codex from your phone',
  );
  assert.deepEqual(storeConfig.apple.categories, ['DEVELOPER_TOOLS', 'PRODUCTIVITY']);
  assert.equal(storeConfig.apple.release.automaticRelease, false);
  assert.equal(storeConfig.apple.copyright, '2026 Francesco Mistero');
  assert.equal(Object.keys(storeConfig.apple.info).length, 1);
  assert.match(thirdPartyNotices, /Tabler Icons/);
  assert.match(thirdPartyNotices, /Paweł Kuna/);
});

test('the English App Store set contains five real iPhone 17 Pro Max captures', async () => {
  const screenshots = storeConfig.apple.info['en-US'].screenshots.APP_IPHONE_67;
  assert.equal(screenshots.length, 5);
  assert.deepEqual(screenshots.map((path) => path.split('/').at(-1)), [
    '01-control-codex.png',
    '02-workflow-anywhere.png',
    '03-voice-chat.png',
    '04-control-deck.png',
    '05-encrypted-pairing.png',
  ]);

  for (const screenshot of screenshots) {
    const image = await readFile(new URL(`../${screenshot.replace('./', '')}`, import.meta.url));
    assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(image.readUInt32BE(16), 1320);
    assert.equal(image.readUInt32BE(20), 2868);
  }
});

test('the reviewer runbook requires live access, fictional data, and revocation', () => {
  assert.match(reviewRunbook, /microdex review-pair/);
  assert.match(reviewRunbook, /fictional tasks/i);
  assert.match(reviewRunbook, /single-use/i);
  assert.match(reviewRunbook, /microdex revoke-all/);
  assert.match(reviewRunbook, /Tabler Icons/i);
});
