import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CURRENT_SCHEMA_VERSION, runMigrations, SCHEMA_MIGRATIONS } from './migrations';
import { loadSettings, migrateStoredSettings } from './settings';
import { compareVersions } from './version';

// Reads a nested path out of an untyped migration/storage result without a cast at every call
// site.
function get(obj: unknown, ...path: string[]): unknown {
  return path.reduce((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], obj);
}

describe('runMigrations', () => {
  it('applies nothing when fromVersion is already CURRENT_SCHEMA_VERSION', () => {
    const data = {
      projectRules: [{ id: '1', pattern: 'p', settings: { palette: { enabled: true, entries: [] } } }],
    };

    const result = runMigrations(data, CURRENT_SCHEMA_VERSION);

    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.data).toEqual(data);
  });

  it('applies nothing when fromVersion is newer than CURRENT_SCHEMA_VERSION', () => {
    const data = { projectRules: [] };

    const result = runMigrations(data, '9.9.9');

    expect(result.version).toBe('9.9.9');
    expect(result.data).toEqual(data);
  });

  it('applies the flat -> nested step when fromVersion is exactly 0.1.0', () => {
    const data = { projectRules: [{ id: '1', pattern: 'p', settings: { topBarColor: '#123456' } }] };

    const result = runMigrations(data, '0.1.0');

    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    const settings = get(result.data, 'projectRules') as Record<string, unknown>[];
    expect(get(settings[0].settings, 'topBar', 'color', 'custom')).toBe('#123456');
  });

  it('applies the flat -> nested step for an intermediate version below CURRENT_SCHEMA_VERSION (e.g. 0.1.5)', () => {
    const data = { projectRules: [{ id: '1', pattern: 'p', settings: { topBarColor: '#abcdef' } }] };

    const result = runMigrations(data, '0.1.5');

    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    const settings = get(result.data, 'projectRules') as Record<string, unknown>[];
    expect(get(settings[0].settings, 'topBar', 'color', 'custom')).toBe('#abcdef');
  });

  it("CURRENT_SCHEMA_VERSION equals the last migration step's `to`", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].to);
  });

  it('SCHEMA_MIGRATIONS is ordered ascending by `to` (so folding forward step by step is valid)', () => {
    expect(SCHEMA_MIGRATIONS.length).toBeGreaterThan(0);
    for (let i = 1; i < SCHEMA_MIGRATIONS.length; i++) {
      expect(compareVersions(SCHEMA_MIGRATIONS[i - 1].to, SCHEMA_MIGRATIONS[i].to)).toBeLessThan(0);
    }
  });
});

describe('migrateFlatSettingsToNested (the 0.1.0 -> 0.2.0 step) field mapping', () => {
  // Every old flat field gets a distinct sentinel value (including two distinct paletteId
  // sentinels, 'custom-top' vs 'custom-text') so a copy-paste cross-wiring bug between two
  // sections (e.g. reading topBarPaletteId into platformBarText's color) would surface as a
  // mismatch rather than an accidental pass by both fields sharing one value.
  const flatFixture = {
    paletteEnabled: false,
    palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
    topBarEnabled: false,
    topBarColor: '#111111',
    topBarPaletteId: 'custom-top',
    topBarHeight: 22,
    topBarStripes: true,
    platformBarEnabled: false,
    platformBarColor: '#222222',
    platformBarPaletteId: null,
    platformBarStripes: true,
    platformBarTextEnabled: false,
    platformBarTextColor: '#333333',
    platformBarTextPaletteId: 'custom-text',
    platformBarTextAuto: true,
  };

  const migrated = SCHEMA_MIGRATIONS[0].migrate({
    projectRules: [{ id: 'r1', pattern: 'p', settings: flatFixture }],
  });
  const nested = get(migrated, 'projectRules', '0', 'settings');

  it.each<[string, unknown, unknown]>([
    ['paletteEnabled -> palette.enabled', get(nested, 'palette', 'enabled'), flatFixture.paletteEnabled],
    ['palette -> palette.entries', get(nested, 'palette', 'entries'), flatFixture.palette],
    ['topBarEnabled -> topBar.enabled', get(nested, 'topBar', 'enabled'), flatFixture.topBarEnabled],
    [
      'topBarPaletteId -> topBar.color.paletteId',
      get(nested, 'topBar', 'color', 'paletteId'),
      flatFixture.topBarPaletteId,
    ],
    ['topBarColor -> topBar.color.custom', get(nested, 'topBar', 'color', 'custom'), flatFixture.topBarColor],
    ['topBarHeight -> topBar.height', get(nested, 'topBar', 'height'), flatFixture.topBarHeight],
    ['topBarStripes -> topBar.stripes', get(nested, 'topBar', 'stripes'), flatFixture.topBarStripes],
    [
      'platformBarEnabled -> platformBar.enabled',
      get(nested, 'platformBar', 'enabled'),
      flatFixture.platformBarEnabled,
    ],
    [
      'platformBarPaletteId -> platformBar.color.paletteId',
      get(nested, 'platformBar', 'color', 'paletteId'),
      flatFixture.platformBarPaletteId,
    ],
    [
      'platformBarColor -> platformBar.color.custom',
      get(nested, 'platformBar', 'color', 'custom'),
      flatFixture.platformBarColor,
    ],
    [
      'platformBarStripes -> platformBar.stripes',
      get(nested, 'platformBar', 'stripes'),
      flatFixture.platformBarStripes,
    ],
    [
      'platformBarTextEnabled -> platformBarText.enabled',
      get(nested, 'platformBarText', 'enabled'),
      flatFixture.platformBarTextEnabled,
    ],
    [
      'platformBarTextPaletteId -> platformBarText.color.paletteId',
      get(nested, 'platformBarText', 'color', 'paletteId'),
      flatFixture.platformBarTextPaletteId,
    ],
    [
      'platformBarTextColor -> platformBarText.color.custom',
      get(nested, 'platformBarText', 'color', 'custom'),
      flatFixture.platformBarTextColor,
    ],
    [
      'platformBarTextAuto -> platformBarText.auto',
      get(nested, 'platformBarText', 'auto'),
      flatFixture.platformBarTextAuto,
    ],
  ])('maps %s', (_label, actual, expected) => {
    expect(actual).toEqual(expected);
  });
});

describe('migrateFlatSettingsToNested defensive passes', () => {
  const migrate = SCHEMA_MIGRATIONS[0].migrate;

  it('treats a missing projectRules key as empty', () => {
    const result = migrate({});
    expect(result.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as empty', () => {
    const result = migrate({ projectRules: 'not-an-array' });
    expect(result.projectRules).toEqual([]);
  });

  it('passes through non-object rule entries unchanged (null, number, string)', () => {
    const result = migrate({ projectRules: [null, 42, 'x'] });
    expect(result.projectRules).toEqual([null, 42, 'x']);
  });

  it('passes through a rule whose settings is null unchanged', () => {
    const rule = { id: '1', pattern: 'p', settings: null };
    const result = migrate({ projectRules: [rule] });
    expect((result.projectRules as unknown[])[0]).toEqual(rule);
  });

  it('passes through a rule whose settings key is missing (undefined) unchanged', () => {
    const rule = { id: '1', pattern: 'p' };
    const result = migrate({ projectRules: [rule] });
    expect((result.projectRules as unknown[])[0]).toEqual(rule);
  });

  it('passes through a rule whose settings is an array unchanged (not reshaped)', () => {
    const rule = { id: '1', pattern: 'p', settings: ['x', 'y'] };
    const result = migrate({ projectRules: [rule] });
    expect((result.projectRules as unknown[])[0]).toEqual(rule);
  });

  it('reshapes a rule whose settings is an empty object into an all-undefined nested shape (not a no-op)', () => {
    const result = migrate({ projectRules: [{ id: '1', pattern: 'p', settings: {} }] });
    const settings = get(result, 'projectRules', '0', 'settings');

    expect(get(settings, 'palette', 'enabled')).toBeUndefined();
    expect(get(settings, 'topBar', 'color', 'custom')).toBeUndefined();
    expect(get(settings, 'platformBarText', 'auto')).toBeUndefined();
    // The shape itself is already nested (has the four section keys), not literally `{}` --
    // proving this is a genuine reshape that loadSettings' mergeDefined() later fills in, not a
    // pass-through no-op like the null/array/missing cases above.
    expect(Object.keys(settings as object).sort()).toEqual(['palette', 'platformBar', 'platformBarText', 'topBar']);
  });

  it('does not throw and preserves other top-level TintSettings keys via the spread', () => {
    const result = migrate({ schemaVersion: '0.1.0', someLegacyKey: 'kept', projectRules: [] });
    expect(result.someLegacyKey).toBe('kept');
  });
});

describe('migrateStoredSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no-ops when storage is empty (no write; storage stays empty)', async () => {
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings('0.2.7');

    expect(setSpy).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toBeUndefined();
  });

  it('no-ops when stored data is already at CURRENT_SCHEMA_VERSION (no write; storage untouched)', async () => {
    const current = { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: current });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings('0.2.7');

    expect(setSpy).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual(current);
  });

  it('no-ops when the stored schemaVersion is newer than CURRENT_SCHEMA_VERSION (no write)', async () => {
    const future = { schemaVersion: '9.9.9', projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: future });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings('0.2.7');

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('migrates 0.1.0 flat data and writes the nested result back, stamped with currentVersion (currentVersion above CURRENT_SCHEMA_VERSION: no floor applies)', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        projectRules: [{ id: '1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#123456' } }],
      },
    });

    // A distinct patch version from CURRENT_SCHEMA_VERSION ('0.2.0'), but still above it, so
    // effectiveSchemaVersion() is a no-op here: this proves the written schemaVersion is the
    // passed-in `currentVersion` parameter, not a hardcoded constant. The below-the-floor case
    // (currentVersion < CURRENT_SCHEMA_VERSION) is covered separately below.
    await migrateStoredSettings('0.2.7');

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(get(stored, 'schemaVersion')).toBe('0.2.7');
    const settings = get(stored, 'projectRules', '0', 'settings');
    expect(get(settings, 'topBar', 'color', 'custom')).toBe('#123456');
  });

  // Regression test for a real bug found and reproduced during this rework: migrateStoredSettings
  // used to stamp the write-back with the raw `currentVersion` verbatim. When currentVersion (the
  // extension's manifest version) lagged behind CURRENT_SCHEMA_VERSION -- e.g. a future migration
  // step ships without the manifest version being bumped to match -- the written data ended up
  // already in the NESTED shape but labeled with a schemaVersion still below CURRENT_SCHEMA_VERSION.
  // The next loadSettings() call would then see that low schemaVersion, decide the flat->nested
  // migration still needs to run, and apply it to already-nested data -- reading e.g.
  // `flat.topBarColor` off an object that only has `flat.topBar.color.custom`, silently resetting
  // every value to defaults. Fixed via effectiveSchemaVersion() flooring the write at
  // CURRENT_SCHEMA_VERSION.
  it('floors the written schemaVersion at CURRENT_SCHEMA_VERSION when currentVersion lags behind it, so the round-tripped data survives a subsequent load instead of being re-migrated and reset', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        projectRules: [{ id: '1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#123456' } }],
      },
    });

    const laggingCurrentVersion = '0.1.5'; // < CURRENT_SCHEMA_VERSION ('0.2.0')
    await migrateStoredSettings(laggingCurrentVersion);

    const written = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(get(written, 'schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);
    expect(get(written, 'projectRules', '0', 'settings', 'topBar', 'color', 'custom')).toBe('#123456');

    // Simulate the next app load reading back exactly what was just written, still under the
    // same lagging manifest version: the floored schemaVersion must prevent a second migration
    // pass from stripping the user's value back to the default.
    const reloaded = loadSettings(written, laggingCurrentVersion);
    expect(reloaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(reloaded.projectRules[0].settings.topBar.color.custom).toBe('#123456');
  });

  it('normalizes corrupt stored data (non-object) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings('0.2.7');

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: '0.2.7', projectRules: [] });
  });

  it('normalizes corrupt stored data (invalid schemaVersion type) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: 123, projectRules: [] } });

    await migrateStoredSettings('0.2.7');

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: '0.2.7', projectRules: [] });
  });

  it('normalizes corrupt stored data to fresh defaults floored at CURRENT_SCHEMA_VERSION, even when currentVersion lags behind it', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings('0.1.5'); // < CURRENT_SCHEMA_VERSION ('0.2.0')

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [] });
  });
});
