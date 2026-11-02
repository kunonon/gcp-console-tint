import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { StoredSettingsError } from '../../../port/settings-store';
import background from '../../in/entrypoints/background';
import { migrateStoredSettings, SettingsStoreImpl } from '../browser-settings-store';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { toStored } from '../settings-repository';

// A release above CURRENT_SCHEMA_VERSION ('0.5.0'), so the write stamp is this version as is.
const RELEASE = '0.5.7';

const storedValue = async () => (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;

// What `promise` rejects with. Fails the test if it resolves.
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

// fake-browser's set() deletes a key set to null, so a stored null is stubbed on get(). Cast: the
// spy's type follows get()'s callback overload, which returns void.
function stubStoredNull() {
  vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation((async () => ({ tintSettings: null })) as never);
}

function expectStoredSettingsError(error: unknown): StoredSettingsError {
  expect(error).toBeInstanceOf(StoredSettingsError);
  return error as StoredSettingsError;
}

// Values no release stores, each with the refusal the reader gives it. A stored null is refused
// too (see the null cases below): fake-browser's set() deletes a key set to null, so it cannot be
// seeded here.
const unreadable: [string, unknown, unknown][] = [
  ['a non-object', 'not-an-object', { reason: 'not-settings' }],
  ['a record without schemaVersion', { projectRules: [] }, { reason: 'not-settings' }],
  ['a non-string schemaVersion', { schemaVersion: 123, projectRules: [] }, { reason: 'not-settings' }],
  [
    'a schemaVersion below SCHEMA_MIN_VERSION',
    { schemaVersion: '0.0.9', projectRules: [] },
    { reason: 'unsupported-version', version: '0.0.9' },
  ],
  // No migration step reshapes the pre-release flat rule settings: the 0.2.0 step finds no topBar.
  [
    'the pre-release flat rule settings',
    {
      schemaVersion: '0.1.0',
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#123456' } }],
    },
    {
      reason: 'invalid-fields',
      issues: [{ path: 'projectRules[0].settings.topBar', message: 'expected an object' }],
    },
  ],
];

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
    expect(await storedValue()).toBeUndefined();
  });

  it('no-ops when stored data is already at CURRENT_SCHEMA_VERSION (no write; storage untouched)', async () => {
    const current = { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'dark', projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: current });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings(RELEASE);

    expect(setSpy).not.toHaveBeenCalled();
    expect(await storedValue()).toEqual(current);
  });

  // Not validated here either: the readers refuse it (see load below).
  it('no-ops when the stored schemaVersion is newer than CURRENT_SCHEMA_VERSION (no write)', async () => {
    const future = { schemaVersion: '9.9.9', theme: 'dark', projectRules: [] };
    await fakeBrowser.storage.local.set({ tintSettings: future });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    await migrateStoredSettings(RELEASE);

    expect(setSpy).not.toHaveBeenCalled();
    expect(await storedValue()).toEqual(future);
  });

  it('stamps migrated data at CURRENT_SCHEMA_VERSION when the release lags behind it', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: '0.2.1', projectRules: [] } });

    await migrateStoredSettings('0.2.1');

    expect(await storedValue()).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: [] });
  });

  // The stored shape of a fill since 0.5.0: v0.4.1 stored the '#rrggbb' strings, and the write-back
  // wraps them as { type: 'solid', color } while the text's custom stays a string. None of the
  // colors is a default, so a fill swapped for a default would show.
  it("writes v0.4.1's solid fills back as tagged solid objects", async () => {
    const rule = (entryColor: unknown, topBarCustom: unknown, platformBarCustom: unknown) => ({
      id: '1',
      matchType: 'exact',
      pattern: 'my-app',
      settings: {
        palette: { enabled: true, entries: [{ id: 'teal', name: 'Teal', color: entryColor }] },
        topBar: { enabled: true, color: { paletteId: null, custom: topBarCustom }, height: 4, stripes: false },
        platformBar: { enabled: true, color: { paletteId: 'teal', custom: platformBarCustom }, stripes: true },
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#123456' }, auto: true },
      },
    });
    await fakeBrowser.storage.local.set({
      tintSettings: { schemaVersion: '0.4.1', theme: 'dark', projectRules: [rule('#009688', '#e91e63', '#3f51b5')] },
    });

    await migrateStoredSettings(RELEASE);

    expect(await storedValue()).toEqual({
      schemaVersion: RELEASE,
      theme: 'dark',
      projectRules: [
        rule(
          { type: 'solid', color: '#009688' },
          { type: 'solid', color: '#e91e63' },
          { type: 'solid', color: '#3f51b5' },
        ),
      ],
    });
  });

  // The 0.2.0 step stores the height v0.1.3 painted.
  it('writes a v0.1.3 fractional height back rounded, as v0.1.3 painted it', async () => {
    const rule = (height: number, fill: (color: string) => unknown) => ({
      id: '1',
      matchType: 'exact',
      pattern: 'my-app',
      settings: {
        palette: { enabled: true, entries: [{ id: 'teal', name: 'Teal', color: fill('#009688') }] },
        topBar: { enabled: true, color: { paletteId: null, custom: fill('#e91e63') }, height, stripes: false },
        platformBar: { enabled: true, color: { paletteId: 'teal', custom: fill('#3f51b5') }, stripes: true },
        platformBarText: { enabled: true, color: { paletteId: null, custom: '#123456' }, auto: true },
      },
    });
    await fakeBrowser.storage.local.set({
      tintSettings: { schemaVersion: '0.1.3', projectRules: [rule(2.5, (color) => color)] },
    });

    await migrateStoredSettings(RELEASE);

    expect(await storedValue()).toEqual({
      schemaVersion: RELEASE,
      theme: 'auto',
      projectRules: [rule(3, (color) => ({ type: 'solid', color }))],
    });
  });

  // Nothing is repaired with a default: the value stays as it was, for the side panel to show and export.
  it.each(unreadable)('writes nothing for %s and rejects with the refusal', async (_label, stored, failure) => {
    await fakeBrowser.storage.local.set({ tintSettings: stored });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    const error = expectStoredSettingsError(await rejectionOf(migrateStoredSettings(RELEASE)));

    expect(error.failure).toEqual(failure);
    expect(error.raw).toEqual(stored);
    expect(setSpy).not.toHaveBeenCalled();
    expect(await storedValue()).toEqual(stored);
  });

  // Only an absent key is an unconfigured install.
  it('writes nothing for a stored null and rejects it as not-settings', async () => {
    stubStoredNull();
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    const error = expectStoredSettingsError(await rejectionOf(migrateStoredSettings(RELEASE)));

    expect(error.failure).toEqual({ reason: 'not-settings' });
    expect(error.raw).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('writes nothing for unreadable data even when currentVersion lags behind CURRENT_SCHEMA_VERSION', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: 'not-an-object' });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

    expectStoredSettingsError(await rejectionOf(migrateStoredSettings('0.0.5')));

    expect(setSpy).not.toHaveBeenCalled();
    expect(await storedValue()).toBe('not-an-object');
  });
});

describe('SettingsStoreImpl', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // @webext-core/fake-browser leaves runtime.getManifest() as a stub that throws; the store reads
    // the manifest version for its effective schema version.
    (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({ version: RELEASE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rule = ProjectRule.recreate(ProjectRuleId.recreate('1'), 'exact', 'my-app', ProjectSettings.DEFAULT);
  const settings = new TintSettings([rule], 'dark');

  describe('load', () => {
    // Reading never writes, so an unconfigured install stays unconfigured (no key at all).
    it('reads an absent value as no rules under the default theme, writing nothing', async () => {
      const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

      expect(await new SettingsStoreImpl().load()).toEqual(new TintSettings([], 'auto'));
      expect(setSpy).not.toHaveBeenCalled();
      expect(await storedValue()).toBeUndefined();
    });

    // The migration happens in memory only; the background script is the single writer.
    it('reads an older stamp migrated in memory, leaving storage as it was', async () => {
      const legacy = { schemaVersion: '0.2.1', projectRules: [] };
      await fakeBrowser.storage.local.set({ tintSettings: legacy });
      const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');

      expect(await new SettingsStoreImpl().load()).toEqual(new TintSettings([], 'auto'));
      expect(setSpy).not.toHaveBeenCalled();
      expect(await storedValue()).toEqual(legacy);
    });

    it('reads what save wrote', async () => {
      const store = new SettingsStoreImpl();
      await store.save(settings);

      expect(await storedValue()).toEqual(toStored(settings, RELEASE));
      expect(await store.load()).toEqual(settings);
    });

    it.each(unreadable)(
      'rejects %s with a StoredSettingsError carrying the stored value',
      async (_label, stored, failure) => {
        await fakeBrowser.storage.local.set({ tintSettings: stored });

        const error = expectStoredSettingsError(await rejectionOf(new SettingsStoreImpl().load()));

        expect(error.failure).toEqual(failure);
        expect(error.raw).toEqual(stored);
        expect(await storedValue()).toEqual(stored);
      },
    );

    it('rejects a stored null as not-settings', async () => {
      stubStoredNull();

      const error = expectStoredSettingsError(await rejectionOf(new SettingsStoreImpl().load()));

      expect(error.failure).toEqual({ reason: 'not-settings' });
      expect(error.raw).toBeNull();
    });

    it("rejects a stamp above the manifest's effective version as newer-version", async () => {
      await fakeBrowser.storage.local.set({
        tintSettings: { schemaVersion: '9.9.9', theme: 'dark', projectRules: [] },
      });

      const error = expectStoredSettingsError(await rejectionOf(new SettingsStoreImpl().load()));

      expect(error.failure).toEqual({ reason: 'newer-version', version: '9.9.9' });
    });

    // Only unreadable data is a StoredSettingsError; the storage API's own failure passes through.
    it("passes the storage API's failure through as is", async () => {
      const storageError = new Error('storage is unavailable');
      vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(storageError);

      expect(await rejectionOf(new SettingsStoreImpl().load())).toBe(storageError);
    });
  });

  describe('watch', () => {
    function watching() {
      const onChange = vi.fn();
      const onError = vi.fn();
      new SettingsStoreImpl().watch(onChange, onError);
      return { onChange, onError };
    }

    it('hands a readable new value to onChange', async () => {
      const { onChange, onError } = watching();

      await fakeBrowser.storage.local.set({ tintSettings: toStored(settings, RELEASE) });

      expect(onChange).toHaveBeenCalledExactlyOnceWith(settings);
      expect(onError).not.toHaveBeenCalled();
    });

    // The newer stamp is listed here rather than in `unreadable`, which migrateStoredSettings also
    // uses: the background skips current and newer stamps without reading them.
    it.each([
      ...unreadable,
      ['an empty string', '', { reason: 'not-settings' }] as [string, unknown, unknown],
      [
        "a stamp above the manifest's effective version",
        { schemaVersion: '9.9.9', theme: 'dark', projectRules: [] },
        { reason: 'newer-version', version: '9.9.9' },
      ] as [string, unknown, unknown],
    ])('hands %s to onError, not onChange', async (_label, stored, failure) => {
      const { onChange, onError } = watching();

      await fakeBrowser.storage.local.set({ tintSettings: stored });

      expect(onChange).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      const error = expectStoredSettingsError(onError.mock.calls[0]![0]);
      expect(error.failure).toEqual(failure);
      expect(error.raw).toEqual(stored);
    });

    // A stored null is a value to refuse, not a removal. Dispatched by hand: fake-browser's set()
    // turns a null into a removal.
    it('hands a stored null to onError', async () => {
      const { onChange, onError } = watching();

      await fakeBrowser.storage.onChanged.trigger({ tintSettings: { newValue: null } }, 'local');

      expect(onChange).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      expect(expectStoredSettingsError(onError.mock.calls[0]![0]).failure).toEqual({ reason: 'not-settings' });
    });

    // Chrome and Firefox report a removal with an oldValue and no newValue. Dispatched by hand:
    // fake-browser's remove() reports newValue: null instead, which no browser does.
    it('calls neither on removal', async () => {
      const { onChange, onError } = watching();

      await fakeBrowser.storage.onChanged.trigger({ tintSettings: { oldValue: toStored(settings, RELEASE) } }, 'local');

      expect(onChange).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    // Only the read is guarded: an error thrown by onChange itself is not unreadable data.
    it('does not hand an error thrown by onChange to onError', async () => {
      const onChange = vi.fn(() => {
        throw new Error('onChange broke');
      });
      const onError = vi.fn();
      new SettingsStoreImpl().watch(onChange, onError);

      await fakeBrowser.storage.local.set({ tintSettings: toStored(settings, RELEASE) }).catch(() => undefined);

      expect(onChange).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    });

    it('ignores other keys and other storage areas', async () => {
      const { onChange, onError } = watching();

      await fakeBrowser.storage.local.set({ someUnrelatedKey: 'value' });
      await fakeBrowser.storage.sync.set({ tintSettings: 'not-an-object' });

      expect(onChange).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });
});

describe('background', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({ version: RELEASE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the refusal when stored settings cannot be migrated, leaving storage as it was', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { schemaVersion: '0.0.9', projectRules: [] } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // fake-browser leaves it unimplemented; the background script calls it at start-up.
    vi.spyOn(fakeBrowser.sidePanel, 'setPanelBehavior').mockResolvedValue(undefined);

    (background.main as () => void)();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      '[gcp-console-tint] settings migration failed',
      expect.any(StoredSettingsError),
    );
    expect(await storedValue()).toEqual({ schemaVersion: '0.0.9', projectRules: [] });
  });
});
