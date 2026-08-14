import { browser } from 'wxt/browser';
import { CURRENT_SCHEMA_VERSION } from '../../domain/migrations';
import { TintSettings } from '../../domain/tint-settings';
import { compareVersions, VersionComparisonResult } from '../../domain/version';
import type { SettingsStore } from '../../port/settings-store';

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
    return TintSettings.fromStored(result[STORAGE_KEY], manifestVersion());
  }

  save(next: TintSettings): TintSettings {
    // Floor at CURRENT_SCHEMA_VERSION (see TintSettings.effectiveSchemaVersion): stamping the
    // raw manifest version here could label current-shape nested data with an older
    // schemaVersion, causing the next load to re-run migrations against already-migrated data
    // and silently reset the user's values to defaults.
    const stamped = next.withEffectiveVersion(manifestVersion());
    browser.storage.local.set({ [STORAGE_KEY]: stamped.toStored() });
    return stamped;
  }

  watch(onChange: (settings: TintSettings) => void): void {
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      const newValue = changes[STORAGE_KEY].newValue;
      if (newValue) onChange(TintSettings.fromStored(newValue, manifestVersion()));
    });
  }
}

// Persists storage in the newest shape, stamped with the running extension version. Called
// from the background script only, so there is a single writer (content scripts and the side
// panel migrate in memory on read via TintSettings.fromStored and never write back). No-ops
// when storage is empty — an unconfigured install stays unconfigured — or already current.
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
  const migrated = TintSettings.fromStored(stored, currentVersion).withEffectiveVersion(currentVersion);
  await browser.storage.local.set({ [STORAGE_KEY]: migrated.toStored() });
}
