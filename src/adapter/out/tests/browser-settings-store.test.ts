import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { migrateStoredSettings } from '../browser-settings-store';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { toStored } from '../settings-repository';

// A release above CURRENT_SCHEMA_VERSION ('0.3.0'), so the write stamp is this version as is.
const RELEASE = '0.3.7';

describe('migrateStoredSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no-ops when storage is empty (no write; storage stays empty)', async () => {
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings(RELEASE);

    expect(setSpy).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toBeUndefined();
  });

  it('no-ops when stored data is already at CURRENT_SCHEMA_VERSION (no write; storage untouched)', async () => {
    const current = { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'dark', projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: current });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings(RELEASE);

    expect(setSpy).not.toHaveBeenCalled();
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual(current);
  });

  it('no-ops when the stored schemaVersion is newer than CURRENT_SCHEMA_VERSION (no write)', async () => {
    const future = { schemaVersion: '9.9.9', theme: 'dark', projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: future });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings(RELEASE);

    expect(setSpy).not.toHaveBeenCalled();
  });

  // 0.1.0 (SCHEMA_MIN_VERSION) is below CURRENT_SCHEMA_VERSION, so the 0.3.0 step adds theme
  // 'auto' and the result is written back. No step understands the legacy flat rule settings, so
  // toDomain keeps the rule's id/matchType/pattern and recovers its settings to the defaults.
  it('migrates stored data at schemaVersion 0.1.0 and writes it back with theme auto', async () => {
    const legacyFlatShape = {
      schemaVersion: '0.1.0',
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#123456' } }],
    };
    await fakeBrowser.storage.local.set({ tintSettings: legacyFlatShape });

    await migrateStoredSettings(RELEASE);

    const expected = new TintSettings(
      [ProjectRule.recreate(ProjectRuleId.recreate('1'), 'exact', 'my-app', ProjectSettings.DEFAULT)],
      'auto',
    );
    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual(toStored(expected, RELEASE));
  });

  it('stamps migrated data at CURRENT_SCHEMA_VERSION when the release lags behind it', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: '0.2.1', projectRules: [] } });

    await migrateStoredSettings('0.2.1');

    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: 'auto',
      projectRules: [],
    });
  });

  it('normalizes corrupt stored data (non-object) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings(RELEASE);

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: RELEASE, theme: 'auto', projectRules: [] });
  });

  it('normalizes stored data with no schemaVersion key at all (versionless) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { projectRules: [] } });

    await migrateStoredSettings(RELEASE);

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: RELEASE, theme: 'auto', projectRules: [] });
  });

  it('normalizes corrupt stored data (invalid schemaVersion type) to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: 123, projectRules: [] } });

    await migrateStoredSettings(RELEASE);

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: RELEASE, theme: 'auto', projectRules: [] });
  });

  it('normalizes stored data whose schemaVersion is below SCHEMA_MIN_VERSION to fresh defaults and writes them', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: '0.0.9', projectRules: [] } });

    await migrateStoredSettings(RELEASE);

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: RELEASE, theme: 'auto', projectRules: [] });
  });

  it('normalizes corrupt stored data to fresh defaults floored at CURRENT_SCHEMA_VERSION, even when currentVersion lags behind it', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });

    await migrateStoredSettings('0.0.5'); // < CURRENT_SCHEMA_VERSION

    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: [] });
  });
});
