import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  createE2EEKeyMaterial,
  openE2EE as openBridgeEnvelope,
  sealE2EE as sealBridgeEnvelope,
} from '../../bridge/lib/e2ee.mjs';
import {
  openE2EE as openMobileEnvelope,
  sealE2EE as sealMobileEnvelope,
} from '../lib/e2ee-core.ts';

test('the Expo client and Mac bridge use the same authenticated encryption format', () => {
  const material = createE2EEKeyMaterial();
  const phoneEnvelope = sealMobileEnvelope(
    material,
    'request:session_1234567890',
    { path: '/api/status', private: 'phone-to-mac' },
    randomBytes(24),
  );
  assert.deepEqual(
    openBridgeEnvelope(material, 'request:session_1234567890', phoneEnvelope),
    { path: '/api/status', private: 'phone-to-mac' },
  );

  const bridgeEnvelope = sealBridgeEnvelope(
    material,
    'event:session_1234567890',
    { type: 'state', private: 'mac-to-phone' },
  );
  assert.deepEqual(
    openMobileEnvelope(material, 'event:session_1234567890', bridgeEnvelope),
    { type: 'state', private: 'mac-to-phone' },
  );
});
