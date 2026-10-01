import { readFile } from 'node:fs/promises';

export const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

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
  return { schemaVersion: VERSION, projectRules };
}
