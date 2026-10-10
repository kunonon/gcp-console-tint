import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsImportError } from '../../../port/settings-store';
import { SettingsStoreImpl } from '../browser-settings-store';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { effectiveSchemaVersion, toStored } from '../settings-repository';

// A release at/above CURRENT_SCHEMA_VERSION ('0.3.0'), so effectiveSchemaVersion keeps it as is.
const CURRENT_VERSION = '0.3.1';

function setManifestVersion(version: string): void {
  (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({ version });
}

function sampleSettings(): TintSettings {
  return new TintSettings(
    [ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', ProjectSettings.DEFAULT)],
    'dark',
  );
}

describe('SettingsStoreImpl.exportJson / importJson', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // @webext-core/fake-browser leaves runtime.getManifest() as an unimplemented stub that
    // throws; save and import use it for the release-version storage stamp and import ceiling.
    setManifestVersion(CURRENT_VERSION);
  });

  it('exportJson stamps the stored shape with CURRENT_SCHEMA_VERSION', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const output = store.exportJson(settings);

    expect(JSON.parse(output)).toEqual(toStored(settings, CURRENT_SCHEMA_VERSION));
  });

  it('exportJson pretty-prints with 2-space indentation', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const output = store.exportJson(settings);

    expect(output).toBe(JSON.stringify(toStored(settings, CURRENT_SCHEMA_VERSION), null, 2));
  });

  it('exports the same schema stamp across releases and an older release can import either file', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    setManifestVersion('0.3.1');
    const firstReleaseExport = store.exportJson(settings);
    setManifestVersion('0.3.2');
    const laterReleaseExport = store.exportJson(settings);

    expect(JSON.parse(firstReleaseExport).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(JSON.parse(laterReleaseExport).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    setManifestVersion('0.3.1');
    expect(store.importJson(firstReleaseExport).equals(settings)).toBe(true);
    expect(store.importJson(laterReleaseExport).equals(settings)).toBe(true);
  });

  it('accepts a legacy export stamped with this release version', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();
    const text = JSON.stringify(toStored(settings, CURRENT_VERSION));

    expect(store.importJson(text).equals(settings)).toBe(true);
  });

  it('importJson(exportJson(settings)) round-trips to an equal TintSettings', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const roundTripped = store.importJson(store.exportJson(settings));

    expect(roundTripped.equals(settings)).toBe(true);
  });

  it.each(['0.3.2', '0.4.0'])('importJson refuses the future schema stamp %s above this release cap', (version) => {
    const store = new SettingsStoreImpl();
    const text = JSON.stringify(toStored(sampleSettings(), version));
    expect(() => store.importJson(text)).toThrow(SettingsImportError);
    try {
      store.importJson(text);
    } catch (error) {
      expect((error as SettingsImportError).failure).toEqual({ reason: 'newer-version', version });
    }
  });

  it('still refuses a legacy file stamped with a release version above an older reader cap', () => {
    const store = new SettingsStoreImpl();
    setManifestVersion('0.3.2');
    const text = JSON.stringify(toStored(sampleSettings(), '0.3.3'));

    expect(() => store.importJson(text)).toThrow(SettingsImportError);
    try {
      store.importJson(text);
    } catch (error) {
      expect((error as SettingsImportError).failure).toEqual({ reason: 'newer-version', version: '0.3.3' });
    }
  });

  it('save resolves after writing the stamped stored shape', async () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    await store.save(settings);

    expect((await fakeBrowser.storage.local.get('tintSettings')).tintSettings).toEqual(
      toStored(settings, effectiveSchemaVersion(CURRENT_VERSION)),
    );
  });

  // The shipping state right after a schema bump: the manifest still says 0.2.1 while the shape
  // is 0.3.0. Without the floor, save would stamp '0.2.1', the next load would re-run the 0.3.0
  // step and reset the chosen theme to 'auto', and importJson would refuse this build's own
  // exports as newer-version.
  it('save and importJson floor a lagging manifest version at CURRENT_SCHEMA_VERSION', async () => {
    setManifestVersion('0.2.1');
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    await store.save(settings);
    const stored = (await fakeBrowser.storage.local.get('tintSettings')).tintSettings;
    expect(stored).toEqual(toStored(settings, CURRENT_SCHEMA_VERSION));
    expect((await store.load()).theme).toBe('dark');

    expect(store.importJson(store.exportJson(settings)).equals(settings)).toBe(true);
  });

  it('save rejects synchronous serialization failures', async () => {
    const store = new SettingsStoreImpl();

    await expect(store.save(null as unknown as TintSettings)).rejects.toThrow();
  });

  it('importJson propagates SettingsImportError for text that is not a settings file', () => {
    const store = new SettingsStoreImpl();

    expect(() => store.importJson('not json{')).toThrow(SettingsImportError);
  });
});
