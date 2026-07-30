import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Max and Ultra are deliberately excluded. No model Microdex targets exposes a
// working Max rung, and Ultra burns usage limits, so offering them on the dial
// produced steps that Codex never applied. Extra High is the ceiling.
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

function splitLines(content) {
  return content.replace(/\r\n/g, '\n').split('\n');
}

function sectionName(line) {
  const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
  return match?.[1]?.trim() ?? null;
}

function keyMatch(line, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return line.match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*?)\\s*(?:#.*)?$`));
}

export function getTopLevelValue(content, key) {
  let section = '';
  for (const line of splitLines(content)) {
    const nextSection = sectionName(line);
    if (nextSection !== null) {
      section = nextSection;
      continue;
    }
    if (section) continue;
    const match = keyMatch(line, key);
    if (match) return match[1].trim();
  }
  return null;
}

export function setTopLevelKey(content, key, value) {
  const lines = splitLines(content);
  let section = '';
  let replaced = false;
  let firstSectionIndex = -1;

  const next = lines.map((line, index) => {
    const nextSection = sectionName(line);
    if (nextSection !== null) {
      if (firstSectionIndex === -1) firstSectionIndex = index;
      section = nextSection;
      return line;
    }
    if (!section && keyMatch(line, key)) {
      if (replaced) return null;
      replaced = true;
      return `${key} = ${value}`;
    }
    return line;
  }).filter((line) => line !== null);

  if (!replaced) {
    const insertion = firstSectionIndex === -1 ? next.length : firstSectionIndex;
    const prefix = insertion > 0 && next[insertion - 1] !== '' ? [''] : [];
    const suffix = insertion < next.length && next[insertion] !== '' ? [''] : [];
    next.splice(insertion, 0, ...prefix, `${key} = ${value}`, ...suffix);
  }

  return normalizeEnding(next.join('\n'));
}

export function removeTopLevelKey(content, key, onlyWhenValue) {
  const lines = splitLines(content);
  let section = '';
  const next = lines.filter((line) => {
    const nextSection = sectionName(line);
    if (nextSection !== null) {
      section = nextSection;
      return true;
    }
    if (section) return true;
    const match = keyMatch(line, key);
    if (!match) return true;
    if (onlyWhenValue && unquote(match[1]) !== onlyWhenValue) return true;
    return false;
  });
  return normalizeEnding(next.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export function setSectionKey(content, targetSection, key, value) {
  const lines = splitLines(content);
  let section = '';
  let sectionFound = false;
  let keyFound = false;
  let insertAt = -1;

  const next = lines.map((line, index) => {
    const nextSection = sectionName(line);
    if (nextSection !== null) {
      if (section === targetSection && insertAt === -1) insertAt = index;
      section = nextSection;
      if (section === targetSection) sectionFound = true;
      return line;
    }
    if (section === targetSection && keyMatch(line, key)) {
      if (keyFound) return null;
      keyFound = true;
      return `${key} = ${value}`;
    }
    return line;
  }).filter((line) => line !== null);

  if (sectionFound && !keyFound) {
    if (insertAt === -1) insertAt = next.length;
    while (insertAt > 0 && next[insertAt - 1] === '') insertAt -= 1;
    next.splice(insertAt, 0, `${key} = ${value}`);
  }

  if (!sectionFound) {
    while (next.length && next[next.length - 1] === '') next.pop();
    if (next.length) next.push('');
    next.push(`[${targetSection}]`, `${key} = ${value}`);
  }

  return normalizeEnding(next.join('\n'));
}

function normalizeEnding(content) {
  return `${content.replace(/\s+$/g, '')}\n`;
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function readCodexStatus(configPath) {
  let content = '';
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const serviceTier = unquote(getTopLevelValue(content, 'service_tier') ?? '');
  const configuredEffort = unquote(getTopLevelValue(content, 'model_reasoning_effort') ?? 'medium');
  const reasoningEffort = REASONING_EFFORTS.includes(configuredEffort)
    ? configuredEffort
    : 'medium';

  return {
    fastMode: serviceTier === 'fast',
    reasoningEffort,
    content,
  };
}

async function updateCodexConfig(configPath, transform) {
  const configDir = path.dirname(configPath);
  await mkdir(configDir, { recursive: true });

  let current = '';
  let existed = true;
  try {
    current = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    existed = false;
  }

  const next = transform(current);
  if (next === current) return readCodexStatus(configPath);

  if (existed) {
    await copyFile(configPath, `${configPath}.microdex.bak`);
  }

  const temporaryPath = path.join(
    configDir,
    `.microdex-${process.pid}-${Date.now()}-${path.basename(configPath)}.tmp`,
  );
  await writeFile(temporaryPath, next, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, configPath);
  return readCodexStatus(configPath);
}

export async function applyFastMode(configPath, enabled) {
  return updateCodexConfig(configPath, (current) => {
    let next = setSectionKey(current, 'features', 'fast_mode', 'true');
    if (enabled) return setTopLevelKey(next, 'service_tier', '"fast"');
    return removeTopLevelKey(next, 'service_tier', 'fast');
  });
}

export async function applyReasoningEffort(configPath, effort) {
  if (!REASONING_EFFORTS.includes(effort)) {
    throw new Error(`Invalid reasoning level: ${effort}`);
  }
  return updateCodexConfig(configPath, (current) =>
    setTopLevelKey(current, 'model_reasoning_effort', `"${effort}"`),
  );
}
