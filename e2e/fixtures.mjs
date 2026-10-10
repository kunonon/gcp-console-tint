import { readFile } from 'node:fs/promises';

export const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const SCHEMA_VERSION = '0.3.0';

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

// The schemaVersion storage writes carry: the manifest version floored at the schema version, so
// until package.json catches up with a schema bump the stamp is the schema version.
export const EFFECTIVE_VERSION = compareVersions(VERSION, SCHEMA_VERSION) < 0 ? SCHEMA_VERSION : VERSION;

export function projectSettings(overrides = {}) {
  return {
    palette: { enabled: false, entries: [] },
    topBar: { enabled: false, color: { paletteId: null, custom: '#123456' }, height: 4, stripes: false },
    platformBar: { enabled: false, color: { paletteId: null, custom: '#234567' }, stripes: false },
    platformBarText: { enabled: false, color: { paletteId: null, custom: '#345678' }, auto: false },
    ...overrides,
  };
}

export function rule(id, pattern, matchType = 'exact', settings = projectSettings()) {
  return { id, matchType, pattern, settings };
}

export function settings(...projectRules) {
  return { schemaVersion: EFFECTIVE_VERSION, theme: 'auto', projectRules };
}
