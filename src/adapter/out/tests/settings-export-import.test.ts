import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsImportError } from '../../../port/settings-store';
import { SettingsStoreImpl } from '../browser-settings-store';
import { effectiveSchemaVersion, toStored } from '../settings-repository';

const CURRENT_VERSION = '0.2.7';

function sampleSettings(): TintSettings {
  return new TintSettings([
    ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', ProjectSettings.DEFAULT),
  ]);
}

describe('SettingsStoreImpl.exportJson / importJson', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // @webext-core/fake-browser leaves runtime.getManifest() as an unimplemented stub that
    // throws; exportJson calls it (via the private manifestVersion() helper) to stamp the
    // schema version, so tests shim it here to return a fixed current version.
    (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({
      version: CURRENT_VERSION,
    });
  });

  it('exportJson output parses to the same object toStored(settings, effectiveSchemaVersion(manifestVersion())) produces', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const output = store.exportJson(settings);

    expect(JSON.parse(output)).toEqual(toStored(settings, effectiveSchemaVersion(CURRENT_VERSION)));
  });

  it('exportJson pretty-prints with 2-space indentation', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const output = store.exportJson(settings);

    expect(output).toBe(JSON.stringify(toStored(settings, effectiveSchemaVersion(CURRENT_VERSION)), null, 2));
  });

  it('importJson(exportJson(settings)) round-trips to an equal TintSettings', () => {
    const store = new SettingsStoreImpl();
    const settings = sampleSettings();

    const roundTripped = store.importJson(store.exportJson(settings));

    expect(roundTripped.equals(settings)).toBe(true);
  });

  it('importJson refuses a file stamped newer than the running extension version', () => {
    const store = new SettingsStoreImpl();
    const text = JSON.stringify(toStored(new TintSettings([]), '0.3.0'));
    expect(() => store.importJson(text)).toThrow(SettingsImportError);
    try {
      store.importJson(text);
    } catch (error) {
      expect((error as SettingsImportError).failure).toEqual({ reason: 'newer-version', version: '0.3.0' });
    }
  });

  it('importJson propagates SettingsImportError for text that is not a settings file', () => {
    const store = new SettingsStoreImpl();

    expect(() => store.importJson('not json{')).toThrow(SettingsImportError);
  });
});
