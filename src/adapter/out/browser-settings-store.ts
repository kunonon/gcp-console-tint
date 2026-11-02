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
    return toDomain(result[STORAGE_KEY], effectiveSchemaVersion(manifestVersion()));
  }

  async save(next: TintSettings): Promise<void> {
    // Floor at CURRENT_SCHEMA_VERSION (see effectiveSchemaVersion): stamping the raw manifest
    // version here could label current-shape nested data with an older schemaVersion, causing
    // the next load to re-run migrations against already-migrated data and refuse it (the side
    // panel would open on its recovery screen).
    await browser.storage.local.set({ [STORAGE_KEY]: toStored(next, effectiveSchemaVersion(manifestVersion())) });
  }

  watch(onChange: (settings: TintSettings) => void, onError: (error: unknown) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      const newValue: unknown = changes[STORAGE_KEY].newValue;
      // Removal (see the port). Only undefined: a stored '', 0 or null is a value to refuse.
      if (newValue === undefined) return;
      // Only the read is guarded, so an error thrown by onChange itself is not reported as unreadable data.
      let settings: TintSettings;
      try {
        settings = toDomain(newValue, effectiveSchemaVersion(manifestVersion()));
      } catch (error) {
        onError(error);
        return;
      }
      onChange(settings);
    });
  }

  exportJson(settings: TintSettings): string {
    return JSON.stringify(toStored(settings, CURRENT_SCHEMA_VERSION), null, 2);
  }

  importJson(text: string): TintSettings {
    // Rejects stamps above this build's effective schema version. Older releases may have stamped
    // exports with their release version, so the cap can admit those files to applicable migrations.
    return parseSettingsFile(text, effectiveSchemaVersion(manifestVersion()));
  }
}

// Persists storage in the newest shape, stamped with the running extension version floored at
// CURRENT_SCHEMA_VERSION (see effectiveSchemaVersion). Called from the background script only,
// so there is a single writer (content scripts and the side panel migrate in memory on read via
// toDomain and never write back). No-ops when storage is empty — an unconfigured install stays
// unconfigured — or already current; a current or newer stamp is not validated here, the readers
// refuse it if it is unreadable. Data that cannot be read is never written: toDomain throws a
// StoredSettingsError before the set, storage keeps the value as it was, and the background
// script logs the rejection.
// The get and set are not atomic (storage.local has no compare-and-set): a side panel save landing
// between them is overwritten. Accepted: the window is one round trip, once per CURRENT_SCHEMA_VERSION
// bump, and a save that lands before the get already carries a current stamp and ends the migration.
export async function migrateStoredSettings(currentVersion: string): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored: unknown = result[STORAGE_KEY];
  if (stored === undefined) return;
  if (isRecord(stored)) {
    const storedVersion = stored.schemaVersion;
    if (
      typeof storedVersion === 'string' &&
      compareVersions(storedVersion, CURRENT_SCHEMA_VERSION) !== VersionComparisonResult.Older
    ) {
      return;
    }
  }
  const version = effectiveSchemaVersion(currentVersion);
  await browser.storage.local.set({ [STORAGE_KEY]: toStored(toDomain(stored, version), version) });
}
