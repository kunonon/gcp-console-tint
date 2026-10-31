import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { parseSettingsFile } from '../settings-file';
import { toDomain, toStored } from '../settings-repository';

// A rule as the released builds' own toStored wrote it, not as toStored writes it today: v0.3.0-v0.4.1
// export it with theme under stamp '0.3.0', v0.2.x without theme under '0.1.0', and their storage
// holds the same body stamped with the release version. Every value differs from what the reader
// falls back to (ProjectSettings.DEFAULT, matchType 'regex') so a reset is visible. Frozen: never
// regenerate it from current code; a shape change that breaks a row needs a migration step, and only
// the expectation may change.
const rules = [
  {
    id: 'r1',
    matchType: 'prefix',
    pattern: 'prod-',
    settings: {
      palette: {
        enabled: false,
        entries: [
          { id: 'default', name: 'Primary', color: '#1a73e8' },
          { id: 'e2', name: 'Alert', color: '#d93025' },
        ],
      },
      topBar: { enabled: false, color: { paletteId: 'e2', custom: '#00ff00' }, height: 9, stripes: true },
      platformBar: { enabled: false, color: { paletteId: null, custom: '#123456' }, stripes: true },
      platformBarText: { enabled: false, color: { paletteId: 'default', custom: '#abcdef' }, auto: true },
    },
  },
];

describe('files written by past releases', () => {
  it.each([
    ['a v0.3.0-v0.4.1 export', { schemaVersion: '0.3.0', theme: 'dark', projectRules: rules }, 'dark'],
    ['a v0.2.x export', { schemaVersion: '0.1.0', projectRules: rules }, 'auto'],
  ])('imports %s keeping every value', (_label, file, theme) => {
    const settings = parseSettingsFile(JSON.stringify(file), CURRENT_SCHEMA_VERSION);
    expect(toStored(settings, CURRENT_SCHEMA_VERSION)).toMatchObject({ theme, projectRules: rules });
  });

  // migrateStoredSettings persists exactly toStored(toDomain(stored)) (browser-settings-store.ts).
  it.each([
    ['v0.4.1 storage', { schemaVersion: '0.4.1', theme: 'dark', projectRules: rules }, 'dark'],
    ['v0.2.1 storage', { schemaVersion: '0.2.1', projectRules: rules }, 'auto'],
  ])('reads %s keeping every value', (_label, data, theme) => {
    expect(toStored(toDomain(data), CURRENT_SCHEMA_VERSION)).toMatchObject({ theme, projectRules: rules });
  });
});
