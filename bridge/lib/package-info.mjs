import { readFile } from 'node:fs/promises';

const packageJsonUrl = new URL('../../package.json', import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8'));

export const BRIDGE_NAME = packageJson.name;
export const BRIDGE_VERSION = packageJson.version;
export const BRIDGE_PROTOCOL_VERSION = 2;
