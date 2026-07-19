import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CURRENT_SCHEMA_VERSION, runMigrations, SCHEMA_MIGRATIONS, type SchemaMigration } from './migrations';
import { migrateStoredSettings } from './settings';
import { compareVersions, VersionComparisonResult } from './version';

describe('runMigrations', () => {
  // SCHEMA_MIGRATIONS is currently EMPTY (see migrations.ts): the extension is unreleased, so
  // pre-release schema changes are destructive-read instead of migrated (see settings.test.ts's
  // "destructive pre-release read" tests). This assertion documents that invariant directly and
  // stays correct once real steps are added: it falls back to the empty-registry baseline only
  // while the registry is still empty.
  it("CURRENT_SCHEMA_VERSION equals the last migration step's `to` whenever steps exist, or the pre-release baseline while the registry is empty", () => {
    const expected = SCHEMA_MIGRATIONS.length > 0 ? SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].to : '0.1.0';
    expect(CURRENT_SCHEMA_VERSION).toBe(expected);
  });

  it('SCHEMA_MIGRATIONS is ordered ascending by `to` (vacuously true while the registry is empty)', () => {
    for (let i = 1; i < SCHEMA_MIGRATIONS.length; i++) {
      expect(compareVersions(SCHEMA_MIGRATIONS[i - 1].to, SCHEMA_MIGRATIONS[i].to)).toBe(VersionComparisonResult.Older);
    }
  });

  it('applies nothing via the real (currently empty) SCHEMA_MIGRATIONS registry, regardless of fromVersion', () => {
    const data = { projectRules: [{ id: '1', pattern: 'p', settings: { topBarColor: '#123456' } }] };

    expect(runMigrations(data, '0.1.0')).toEqual({ data, version: '0.1.0' });
    expect(runMigrations(data, '9.9.9')).toEqual({ data, version: '9.9.9' });
  });

  // The registry is empty today, but the folding service itself (this function plus the
  // injectable `steps` param) is dormant infrastructure for the first post-release migration.
  // These tests exercise that general capability against a synthetic multi-step chain so it's
  // proven correct now rather than only once a real step exists to test it against.
  describe('with an injected synthetic multi-step chain (proving the service for future post-release use)', () => {
    // Each step appends its own `to` to a `markers` array, so both WHICH steps ran and the
    // ORDER they ran in are directly observable in the output data.
    const markerStep = (to: string): SchemaMigration => ({
      to,
      migrate: (data) => ({
        ...data,
        markers: [...(Array.isArray(data.markers) ? data.markers : []), to],
      }),
    });
    const steps: SchemaMigration[] = [markerStep('0.1.1'), markerStep('0.2.0'), markerStep('0.3.0')];

    it('applies every step in order from the very first version (0.1.0)', () => {
      const result = runMigrations({}, '0.1.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.1.1', '0.2.0', '0.3.0']);
    });

    it('applies only the steps newer than an intermediate fromVersion, skipping earlier ones (0.1.5 skips the 0.1.1 step)', () => {
      const result = runMigrations({}, '0.1.5', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.2.0', '0.3.0']);
    });

    it("applies no steps when fromVersion is already at the last step's `to`", () => {
      const result = runMigrations({}, '0.3.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data).toEqual({});
    });

    it("applies no steps when fromVersion is above the last step's `to`", () => {
      const result = runMigrations({}, '9.9.9', steps);

      expect(result.version).toBe('9.9.9');
      expect(result.data).toEqual({});
    });
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

  // Pre-release: CURRENT_SCHEMA_VERSION was rolled back to '0.1.0' (== SCHEMA_MIN_VERSION), so
  // ANY stored data that passes loadSettings' floor check is now "already current" by
  // definition -- migrateStoredSettings never has anything left to migrate-and-write-back. This
  // supersedes the old flat->nested write-back test that used to live here (that migration step,
  // and the schemaVersion gap it needed, no longer exist).
  it('no-ops for stored data at schemaVersion 0.1.0 (now equal to CURRENT_SCHEMA_VERSION), regardless of its (now-legacy) shape', async () => {
    const legacyFlatShape = {
      schemaVersion: '0.1.0',
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#123456' } }],
    };
    await fakeBrowser.storage.local.set({ tintSettings: legacyFlatShape });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings('0.2.7');

    expect(setSpy).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual(legacyFlatShape);
  });

  it('normalizes corrupt stored data (non-object) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings('0.2.7');

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: '0.2.7', projectRules: [] });
  });

  it('normalizes stored data with no schemaVersion key at all (versionless) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { projectRules: [] } });

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

  it('normalizes stored data whose schemaVersion is below SCHEMA_MIN_VERSION to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: '0.0.9', projectRules: [] } });

    await migrateStoredSettings('0.2.7');

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: '0.2.7', projectRules: [] });
  });

  it('normalizes corrupt stored data to fresh defaults floored at CURRENT_SCHEMA_VERSION, even when currentVersion lags behind it', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings('0.0.5'); // < CURRENT_SCHEMA_VERSION ('0.1.0')

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [] });
  });
});
