import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serverSource = await readFile(
  new URL('../server.mjs', import.meta.url),
  'utf8',
);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in bridge/server.mjs`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Could not extract ${name} from bridge/server.mjs`);
}

const bridgeAddressesSource = extractFunction(serverSource, 'bridgeAddresses');

function runBridgeAddresses(networkInterfaces) {
  return Function(
    'os',
    'port',
    `"use strict"; ${bridgeAddressesSource}; return bridgeAddresses();`,
  )(
    { networkInterfaces: () => networkInterfaces },
    3210,
  );
}

test('pairing prefers the physical Wi-Fi address when a VPN is listed first', () => {
  const addresses = runBridgeAddresses({
    utun4: [
      {
        address: '100.80.239.60',
        family: 'IPv4',
        internal: false,
      },
    ],
    en0: [
      {
        address: '192.168.1.44',
        family: 'IPv4',
        internal: false,
      },
    ],
  });

  assert.deepEqual(addresses, [
    'http://192.168.1.44:3210',
    'http://100.80.239.60:3210',
  ]);
});
