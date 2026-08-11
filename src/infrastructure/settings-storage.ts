import { browser } from 'wxt/browser';
import { UnknownRecordSchema } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../utils/migrations';
import { effectiveSchemaVersion, loadSettings } from '../utils/settings';
import { compareVersions, VersionComparisonResult } from '../utils/version';

function isRecord(value: unknown): value is Record<string, unknown> {
  return UnknownRecordSchema.safeParse(value).success;
}

// Persists storage in the newest shape, stamped with the running extension version. Called
// from the background script only, so there is a single writer (content scripts and the side
// panel migrate in memory via loadSettings and never write back). No-ops when storage is
// empty — an unconfigured install stays unconfigured — or already current.
export async function migrateStoredSettings(currentVersion: string): Promise<void> {
  const result = await browser.storage.local.get('tintSettings');
  const stored: unknown = result.tintSettings;
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
  const migrated = loadSettings(stored, currentVersion);
  await browser.storage.local.set({
    tintSettings: { ...migrated, schemaVersion: effectiveSchemaVersion(currentVersion) },
  });
}
