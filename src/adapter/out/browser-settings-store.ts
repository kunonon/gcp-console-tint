import { browser } from 'wxt/browser';
import type { TintSettings } from '../../domain/tint-settings';
import type { SettingsStore } from '../../port/settings-store';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { parseSettingsFile } from './settings-file';
import { effectiveSchemaVersion, toDomain, toStored } from './settings-repository';
import { compareVersions, VersionComparisonResult } from './version';

const STORAGE_KEY = 'tintSettings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function manifestVersion(): string {
  return browser.runtime.getManifest().version;
}

// browser.storage.local implementation of the SettingsStore port. Instantiated by the
// composition roots (sidepanel main.tsx, content script) and injected into consumers.
export class SettingsStoreImpl implements SettingsStore {
  async load(): Promise<TintSettings> {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return toDomain(result[STORAGE_KEY]);
  }

  save(next: TintSettings): void {
    // Floor at CURRENT_SCHEMA_VERSION (see effectiveSchemaVersion): stamping the raw manifest
    // version here could label current-shape nested data with an older schemaVersion, causing
    // the next load to re-run migrations against already-migrated data and silently reset the
    // user's values to defaults.
    browser.storage.local.set({ [STORAGE_KEY]: toStored(next, effectiveSchemaVersion(manifestVersion())) });
  }

  watch(onChange: (settings: TintSettings) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      const newValue = changes[STORAGE_KEY].newValue;
      if (newValue) onChange(toDomain(newValue));
    });
  }

  exportJson(settings: TintSettings): string {
    return JSON.stringify(toStored(settings, effectiveSchemaVersion(manifestVersion())), null, 2);
  }

  importJson(text: string): TintSettings {
    // The same stamp exportJson writes: anything newer must come from a later release.
    return parseSettingsFile(text, effectiveSchemaVersion(manifestVersion()));
  }
}

// Persists storage in the newest shape, stamped with the running extension version. Called
// from the background script only, so there is a single writer (content scripts and the side
// panel migrate in memory on read via toDomain and never write back). No-ops when storage is
// empty — an unconfigured install stays unconfigured — or already current.
export async function migrateStoredSettings(currentVersion: string): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored: unknown = result[STORAGE_KEY];
  if (stored == null) return;
  if (isRecord(stored)) {
    const storedVersion = stored.schemaVersion;
    if (
      typeof storedVersion === 'string' &&
      compareVersions(storedVersion, CURRENT_SCHEMA_VERSION) !== VersionComparisonResult.Older
    ) {
      return;
    }
  }
  await browser.storage.local.set({
    [STORAGE_KEY]: toStored(toDomain(stored), effectiveSchemaVersion(currentVersion)),
  });
}
