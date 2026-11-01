import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { parseSettingsFile } from '../settings-file';
import { toDomain, toStored } from '../settings-repository';

// A rule as the released builds' own toStored wrote it, not as toStored writes it today: v0.3.0-v0.4.1
// export it with theme under stamp '0.3.0', v0.2.x without theme under '0.1.0', and their storage
// holds the same body stamped with the release version. The reader is strict, so a row it cannot
// read fails loudly; every value is also unlike ProjectSettings.DEFAULT and matchType 'regex', so a
// value swapped for a default would show. Frozen: never regenerate it from current code; a shape
// change that breaks a row needs a migration step, and only the expectation may change.
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

// The same rule as v0.1.3 could store it: its side panel saved any finite height (2.5 here), which
// it rounded only when painting. Frozen like the rows above.
const v013Rules = [
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
      topBar: { enabled: false, color: { paletteId: 'e2', custom: '#00ff00' }, height: 2.5, stripes: true },
      platformBar: { enabled: false, color: { paletteId: null, custom: '#123456' }, stripes: true },
      platformBarText: { enabled: false, color: { paletteId: 'default', custom: '#abcdef' }, auto: true },
    },
  },
];

// The rows above as toStored writes them today: since 0.5.0 the entries' and the bars' fills are
// tagged objects, while the text's custom stays a string.
const solid = (color: string) => ({ type: 'solid', color });
const expectedWithHeight = (height: number) => [
  {
    id: 'r1',
    matchType: 'prefix',
    pattern: 'prod-',
    settings: {
      palette: {
        enabled: false,
        entries: [
          { id: 'default', name: 'Primary', color: solid('#1a73e8') },
          { id: 'e2', name: 'Alert', color: solid('#d93025') },
        ],
      },
      topBar: { enabled: false, color: { paletteId: 'e2', custom: solid('#00ff00') }, height, stripes: true },
      platformBar: { enabled: false, color: { paletteId: null, custom: solid('#123456') }, stripes: true },
      platformBarText: { enabled: false, color: { paletteId: 'default', custom: '#abcdef' }, auto: true },
    },
  },
];
const expected = expectedWithHeight(9);

describe('files written by past releases', () => {
  it.each([
    ['a v0.3.0-v0.4.1 export', { schemaVersion: '0.3.0', theme: 'dark', projectRules: rules }, 'dark'],
    ['a v0.2.x export', { schemaVersion: '0.1.0', projectRules: rules }, 'auto'],
  ])('imports %s keeping every value', (_label, file, theme) => {
    const settings = parseSettingsFile(JSON.stringify(file), CURRENT_SCHEMA_VERSION);
    expect(toStored(settings, CURRENT_SCHEMA_VERSION)).toMatchObject({ theme, projectRules: expected });
  });

  // migrateStoredSettings persists exactly toStored(toDomain(stored)) (browser-settings-store.ts).
  it.each([
    ['v0.4.1 storage', { schemaVersion: '0.4.1', theme: 'dark', projectRules: rules }, 'dark', expected],
    ['v0.2.1 storage', { schemaVersion: '0.2.1', projectRules: rules }, 'auto', expected],
    // The 0.2.0 step stores the height v0.1.3 painted: 2.5 rounds to 3.
    ['v0.1.3 storage', { schemaVersion: '0.1.3', projectRules: v013Rules }, 'auto', expectedWithHeight(3)],
  ])('reads %s keeping every value', (_label, data, theme, projectRules) => {
    expect(toStored(toDomain(data, CURRENT_SCHEMA_VERSION), CURRENT_SCHEMA_VERSION)).toMatchObject({
      theme,
      projectRules,
    });
  });
});
