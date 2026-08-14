import { useEffect, useState } from 'react';
import { CURRENT_SCHEMA_VERSION } from '../../../domain/migrations';
import { TintSettings } from '../../../domain/tint-settings';
import type { SettingsStore } from '../../../port/settings-store';

// Owns the side panel's settings state and its persistence via the injected SettingsStore
// port. The store instance comes from the composition root (main.tsx) through App's props.
export function useTintSettings(settingsStore: SettingsStore) {
  // Empty settings until the store's load() resolves. Seeded from CURRENT_SCHEMA_VERSION
  // rather than the manifest version so this hook stays browser-free; the seed's
  // schemaVersion is never persisted (save() re-stamps it).
  const [settings, setSettings] = useState<TintSettings>(() => TintSettings.fromStored(null, CURRENT_SCHEMA_VERSION));

  useEffect(() => {
    settingsStore.load().then(setSettings);
  }, [settingsStore]);

  // save() returns the stamped value; reflecting it into state keeps the UI in sync
  // with exactly what will be persisted.
  const save = (next: TintSettings) => {
    setSettings(settingsStore.save(next));
  };

  return { settings, save };
}
