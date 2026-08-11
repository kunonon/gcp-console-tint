import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CURRENT_SCHEMA_VERSION } from '../../../utils/migrations';
import { migrateStoredSettings } from '../browser-settings-store';

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
